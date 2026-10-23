// Minimal PostgreSQL client (protocol v3) with no external dependency.
// Supports SCRAM-SHA-256, MD5 and cleartext auth, extended query protocol with
// text parameters, simple query protocol (multi-statement scripts), pooling
// and transactions.
import net from 'node:net';
import crypto from 'node:crypto';

const TYPES = {
  16: (v) => v === 't',
  20: (v) => Number(v),
  21: (v) => parseInt(v, 10),
  23: (v) => parseInt(v, 10),
  26: (v) => parseInt(v, 10),
  700: (v) => parseFloat(v),
  701: (v) => parseFloat(v),
  1700: (v) => parseFloat(v),
  114: (v) => JSON.parse(v),
  3802: (v) => JSON.parse(v),
  1114: (v) => new Date(v.replace(' ', 'T') + 'Z'),
  1184: (v) => new Date(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')),
  17: (v) => Buffer.from(v.slice(2), 'hex'),
  1009: (v) => parseArray(v),
  1015: (v) => parseArray(v),
  1007: (v) => parseArray(v).map((x) => (x === null ? null : parseInt(x, 10))),
  1016: (v) => parseArray(v).map((x) => (x === null ? null : Number(x))),
  2951: (v) => parseArray(v),
};

export function parseArray(text) {
  // Parses one-dimensional Postgres array literals: {a,"b c",NULL}
  if (text === '{}') return [];
  const out = [];
  let i = 1;
  while (i < text.length - 1) {
    if (text[i] === '"') {
      let s = '';
      i++;
      while (text[i] !== '"') {
        if (text[i] === '\\') i++;
        s += text[i++];
      }
      i++;
      out.push(s);
    } else {
      let j = i;
      while (j < text.length - 1 && text[j] !== ',') j++;
      const raw = text.slice(i, j);
      out.push(raw === 'NULL' ? null : raw);
      i = j;
    }
    if (text[i] === ',') i++;
  }
  return out;
}

function arrayLiteral(arr) {
  return '{' + arr.map((v) => {
    if (v === null || v === undefined) return 'NULL';
    const s = String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return '"' + s + '"';
  }).join(',') + '}';
}

function serialize(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return '\\x' + v.toString('hex');
  if (Array.isArray(v)) return arrayLiteral(v);
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/** Wraps a value so it is sent as JSON text (for json/jsonb columns). */
export function json(v) {
  return { __json: true, value: v };
}

class Writer {
  constructor() { this.parts = []; }
  str(s) { this.parts.push(Buffer.from(s + '\0', 'utf8')); return this; }
  int32(n) { const b = Buffer.alloc(4); b.writeInt32BE(n); this.parts.push(b); return this; }
  int16(n) { const b = Buffer.alloc(2); b.writeInt16BE(n); this.parts.push(b); return this; }
  bytes(buf) { this.parts.push(buf); return this; }
  build(type) {
    const body = Buffer.concat(this.parts);
    const head = Buffer.alloc(type ? 5 : 4);
    if (type) { head.write(type, 0, 'ascii'); head.writeInt32BE(body.length + 4, 1); } else head.writeInt32BE(body.length + 4, 0);
    return Buffer.concat([head, body]);
  }
}

export class PgError extends Error {
  constructor(fields) {
    super(fields.M || 'PostgreSQL error');
    this.code = fields.C;
    this.detail = fields.D;
    this.severity = fields.S;
    this.constraint = fields.n;
    this.table = fields.t;
  }
}

class Connection {
  constructor(opts) {
    this.opts = opts;
    this.buffer = Buffer.alloc(0);
    this.queue = Promise.resolve();
    this.handler = null;
    this.dead = false;
    this.inTx = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: this.opts.host, port: this.opts.port });
      this.sock = sock;
      sock.setNoDelay(true);
      sock.setKeepAlive(true, 30000);
      let settled = false;
      const fail = (err) => {
        this.dead = true;
        if (!settled) { settled = true; reject(err); }
        if (this.handler) { const h = this.handler; this.handler = null; h.reject(err); }
      };
      sock.on('error', fail);
      sock.on('close', () => fail(new Error('Connection closed')));
      sock.on('data', (chunk) => this.onData(chunk));
      sock.on('connect', () => {
        const w = new Writer().int32(196608)
          .str('user').str(this.opts.user)
          .str('database').str(this.opts.database)
          .str('client_encoding').str('UTF8')
          .str('application_name').str('rendevo')
          .str('TimeZone').str('UTC')
          .bytes(Buffer.from([0]));
        sock.write(w.build());
        this.startupAuth().then(() => { settled = true; resolve(this); }, fail);
      });
    });
  }

  onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.buffer.length >= 5) {
      const len = this.buffer.readInt32BE(1);
      if (this.buffer.length < len + 1) break;
      const type = String.fromCharCode(this.buffer[0]);
      const body = this.buffer.subarray(5, len + 1);
      this.buffer = this.buffer.subarray(len + 1);
      this.dispatch(type, body);
    }
  }

  dispatch(type, body) {
    if (type === 'N' || type === 'S' || type === 'A') return; // notices, params, notifications
    if (type === 'K') return;
    if (this.handler) this.handler.onMessage(type, body);
  }

  expect(onMessage) {
    return new Promise((resolve, reject) => {
      this.handler = {
        reject,
        onMessage: (type, body) => {
          try {
            const r = onMessage(type, body);
            if (r && r.done) { this.handler = null; resolve(r.value); }
          } catch (e) { this.handler = null; reject(e); }
        },
      };
    });
  }

  async startupAuth() {
    let scram = null;
    await this.expect((type, body) => {
      if (type === 'E') throw new PgError(parseFields(body));
      if (type === 'R') {
        const code = body.readInt32BE(0);
        if (code === 0) return null;
        if (code === 3) {
          this.sock.write(new Writer().str(this.opts.password).build('p'));
        } else if (code === 5) {
          const salt = body.subarray(4, 8);
          const inner = md5(this.opts.password + this.opts.user);
          const outer = 'md5' + crypto.createHash('md5').update(Buffer.concat([Buffer.from(inner), salt])).digest('hex');
          this.sock.write(new Writer().str(outer).build('p'));
        } else if (code === 10) {
          const mechs = body.subarray(4).toString('utf8').split('\0');
          if (!mechs.includes('SCRAM-SHA-256')) throw new Error('Unsupported SASL mechanism: ' + mechs.join(','));
          const nonce = crypto.randomBytes(18).toString('base64');
          scram = { nonce, bare: 'n=*,r=' + nonce };
          const first = Buffer.from('n,,' + scram.bare, 'utf8');
          this.sock.write(new Writer().str('SCRAM-SHA-256').int32(first.length).bytes(first).build('p'));
        } else if (code === 11) {
          const serverFirst = body.subarray(4).toString('utf8');
          const attrs = Object.fromEntries(serverFirst.split(',').map((p) => [p[0], p.slice(2)]));
          if (!attrs.r.startsWith(scram.nonce)) throw new Error('SCRAM nonce mismatch');
          const salted = crypto.pbkdf2Sync(this.opts.password, Buffer.from(attrs.s, 'base64'), parseInt(attrs.i, 10), 32, 'sha256');
          const clientKey = hmac(salted, 'Client Key');
          const storedKey = crypto.createHash('sha256').update(clientKey).digest();
          const withoutProof = 'c=biws,r=' + attrs.r;
          const authMessage = scram.bare + ',' + serverFirst + ',' + withoutProof;
          const sig = hmac(storedKey, authMessage);
          const proof = Buffer.alloc(clientKey.length);
          for (let i = 0; i < proof.length; i++) proof[i] = clientKey[i] ^ sig[i];
          scram.serverSig = hmac(hmac(salted, 'Server Key'), authMessage).toString('base64');
          this.sock.write(new Writer().bytes(Buffer.from(withoutProof + ',p=' + proof.toString('base64'), 'utf8')).build('p'));
        } else if (code === 12) {
          const final = body.subarray(4).toString('utf8');
          const v = final.split(',').find((p) => p.startsWith('v='));
          if (!v || v.slice(2) !== scram.serverSig) throw new Error('SCRAM server signature mismatch');
        } else {
          throw new Error('Unsupported auth method ' + code);
        }
        return null;
      }
      if (type === 'Z') return { done: true };
      return null;
    });
  }

  run(fn) {
    const p = this.queue.then(fn);
    this.queue = p.catch(() => {});
    return p;
  }

  query(text, params = []) {
    return this.run(() => this._extended(text, params));
  }

  simple(text) {
    return this.run(() => this._simple(text));
  }

  _extended(text, params) {
    const values = params.map((p) => (p && p.__json ? JSON.stringify(p.value) : serialize(p)));
    const parse = new Writer().str('').str(text).int16(0).build('P');
    const bindW = new Writer().str('').str('').int16(0).int16(values.length);
    for (const v of values) {
      if (v === null) bindW.int32(-1);
      else { const b = Buffer.from(v, 'utf8'); bindW.int32(b.length).bytes(b); }
    }
    bindW.int16(0);
    const bind = bindW.build('B');
    const describe = new Writer().bytes(Buffer.from('P\0')).build('D');
    const execute = new Writer().str('').int32(0).build('E');
    const sync = new Writer().build('S');
    const result = { rows: [], rowCount: 0, fields: [] };
    let error = null;
    const p = this.expect((type, body) => {
      switch (type) {
        case 'T': result.fields = parseRowDescription(body); break;
        case 'D': result.rows.push(parseDataRow(body, result.fields)); break;
        case 'C': result.rowCount = commandCount(body); break;
        case 'E': error = new PgError(parseFields(body)); break;
        case 'Z':
          this.inTx = body[0] !== 73; // 'I' idle
          if (error) throw error;
          return { done: true, value: result };
        default: break;
      }
      return null;
    });
    this.sock.write(Buffer.concat([parse, bind, describe, execute, sync]));
    return p;
  }

  _simple(text) {
    let error = null;
    const p = this.expect((type, body) => {
      if (type === 'E') error = new PgError(parseFields(body));
      if (type === 'Z') {
        if (error) throw error;
        return { done: true, value: true };
      }
      return null;
    });
    this.sock.write(new Writer().str(text).build('Q'));
    return p;
  }

  end() {
    try { this.sock.write(new Writer().build('X')); this.sock.end(); } catch { /* ignore */ }
    this.dead = true;
  }
}

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }
function hmac(key, msg) { return crypto.createHmac('sha256', key).update(msg).digest(); }

function parseFields(body) {
  const fields = {};
  let i = 0;
  while (i < body.length && body[i] !== 0) {
    const code = String.fromCharCode(body[i]);
    const end = body.indexOf(0, i + 1);
    fields[code] = body.subarray(i + 1, end).toString('utf8');
    i = end + 1;
  }
  return fields;
}

function parseRowDescription(body) {
  const n = body.readInt16BE(0);
  const fields = [];
  let i = 2;
  for (let k = 0; k < n; k++) {
    const end = body.indexOf(0, i);
    const name = body.subarray(i, end).toString('utf8');
    i = end + 1;
    const typeOid = body.readInt32BE(i + 6);
    fields.push({ name, typeOid });
    i += 18;
  }
  return fields;
}

function parseDataRow(body, fields) {
  const n = body.readInt16BE(0);
  const row = {};
  let i = 2;
  for (let k = 0; k < n; k++) {
    const len = body.readInt32BE(i);
    i += 4;
    const f = fields[k];
    if (len === -1) { row[f.name] = null; continue; }
    const raw = body.subarray(i, i + len).toString('utf8');
    i += len;
    const conv = TYPES[f.typeOid];
    row[f.name] = conv ? conv(raw) : raw;
  }
  return row;
}

function commandCount(body) {
  const tag = body.subarray(0, body.length - 1).toString('utf8');
  const last = tag.split(' ').pop();
  const n = parseInt(last, 10);
  return Number.isNaN(n) ? 0 : n;
}

export function parseUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname || 'localhost',
    port: parseInt(u.port || '5432', 10),
    user: decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''),
    database: decodeURIComponent(u.pathname.replace(/^\//, '') || 'postgres'),
  };
}

export class Pool {
  constructor(opts) {
    this.opts = typeof opts === 'string' ? parseUrl(opts) : opts;
    this.max = this.opts.max || 10;
    this.idle = [];
    this.total = 0;
    this.waiters = [];
  }

  async acquire() {
    while (this.idle.length) {
      const c = this.idle.pop();
      if (!c.dead) return c;
      this.total--;
    }
    if (this.total < this.max) {
      this.total++;
      try {
        return await new Connection(this.opts).connect();
      } catch (e) {
        this.total--;
        throw e;
      }
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(c) {
    if (c.dead) {
      this.total--;
      if (this.waiters.length) this.acquire().then(this.waiters.shift(), () => {});
      return;
    }
    if (c.inTx) {
      // Never hand back a connection stuck in a transaction.
      c.simple('ROLLBACK').catch(() => {}).finally(() => this.release(c));
      c.inTx = false;
      return;
    }
    const w = this.waiters.shift();
    if (w) w(c); else this.idle.push(c);
  }

  async query(text, params) {
    const c = await this.acquire();
    try { return await c.query(text, params); } finally { this.release(c); }
  }

  async simple(text) {
    const c = await this.acquire();
    try { return await c.simple(text); } finally { this.release(c); }
  }

  /** Runs fn inside one transaction and connection; exposes query() and simple(). */
  async tx(fn) {
    const c = await this.acquire();
    try {
      await c.simple('BEGIN');
      const res = await fn({ query: (t, p) => c.query(t, p), simple: (sql) => c.simple(sql) });
      await c.simple('COMMIT');
      return res;
    } catch (e) {
      await c.simple('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      this.release(c);
    }
  }

  async end() {
    for (const c of this.idle) c.end();
    this.idle = [];
  }
}
