// Faux serveur SMTP pour les tests : connexion simple, STARTTLS ou SSL/TLS, authentification PLAIN ou LOGIN,
// refus configurables. Les messages reçus sont conservés en mémoire, déjà « dé-pointés ».
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Certificat autosigné pour 127.0.0.1 et localhost (openssl), ou null si openssl est absent.
export function selfSignedCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-cert-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
      '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    return { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) };
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function startFakeSmtp({ mode = 'none', auth = null, cert = null, rejectRcpt = null, rejectFrom = null, silent = false, advertiseAuth = ['PLAIN', 'LOGIN'], port = 0 } = {}) {
  const messages = [];
  const transcripts = [];
  const handle = (raw) => {
    let socket = raw;
    let secure = mode === 'tls';
    let authed = !auth;
    let buf = '';
    let state = 'cmd';
    let data = [];
    let env = { from: null, to: [] };
    let loginStep = null;
    let loginUser = '';
    const log = [];
    transcripts.push(log);
    const send = (s) => { log.push(`S: ${s}`); socket.write(`${s}\r\n`); };
    const onLine = (line) => {
      if (state === 'data') {
        if (line === '.') {
          state = 'cmd';
          messages.push({ from: env.from, to: env.to, data: data.map((l) => (l.startsWith('..') ? l.slice(1) : l)).join('\r\n'), secure, authed });
          data = [];
          send('250 2.0.0 Ok: queued');
        } else data.push(line);
        return;
      }
      log.push(`C: ${/^AUTH|^[A-Za-z0-9+/=]{8,}$/.test(line) ? '(authentification)' : line}`);
      if (loginStep === 'user') { loginUser = Buffer.from(line, 'base64').toString(); loginStep = 'pass'; send('334 UGFzc3dvcmQ6'); return; }
      if (loginStep === 'pass') {
        loginStep = null;
        if (auth && loginUser === auth.user && Buffer.from(line, 'base64').toString() === auth.pass) { authed = true; send('235 2.7.0 Authentication successful'); } else send('535 5.7.8 Error: authentication failed');
        return;
      }
      const [verb, ...rest] = line.split(' ');
      const arg = rest.join(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO': {
          const caps = ['250-fake.smtp.test'];
          if (mode === 'starttls' && !secure) caps.push('250-STARTTLS');
          if (advertiseAuth.length && (secure || mode === 'none')) caps.push(`250-AUTH ${advertiseAuth.join(' ')}`);
          caps.push('250 8BITMIME');
          for (const c of caps) { log.push(`S: ${c}`); socket.write(`${c}\r\n`); }
          return;
        }
        case 'HELO': return send('250 fake.smtp.test');
        case 'STARTTLS': {
          if (mode !== 'starttls' || secure) return send('454 4.7.0 TLS not available');
          send('220 2.0.0 Ready to start TLS');
          socket.off('data', onData);
          const t = new tls.TLSSocket(socket, { isServer: true, key: cert.key, cert: cert.cert });
          socket = t;
          secure = true;
          t.on('data', onData);
          t.on('error', () => {});
          return;
        }
        case 'AUTH': {
          const [mech, initial] = arg.split(' ');
          if (mech.toUpperCase() === 'PLAIN') {
            const [, u, p] = Buffer.from(initial || '', 'base64').toString().split('\0');
            if (auth && u === auth.user && p === auth.pass) { authed = true; return send('235 2.7.0 Authentication successful'); }
            return send('535 5.7.8 Error: authentication failed');
          }
          if (mech.toUpperCase() === 'LOGIN') { loginStep = 'user'; return send('334 VXNlcm5hbWU6'); }
          return send('504 5.5.4 Unrecognized authentication type');
        }
        case 'MAIL':
          if (!authed) return send('530 5.7.0 Authentication required');
          if (rejectFrom && arg.includes(rejectFrom)) return send('553 5.7.1 Sender address rejected: not owned by user');
          env = { from: arg.replace(/^FROM:<(.*)>.*$/i, '$1'), to: [] };
          return send('250 2.1.0 Ok');
        case 'RCPT': {
          const to = arg.replace(/^TO:<(.*)>.*$/i, '$1');
          if (rejectRcpt && to.includes(rejectRcpt)) return send('550 5.1.1 Recipient address rejected: User unknown');
          env.to.push(to);
          return send('250 2.1.5 Ok');
        }
        case 'DATA': state = 'data'; data = []; return send('354 End data with <CR><LF>.<CR><LF>');
        case 'RSET': env = { from: null, to: [] }; return send('250 Ok');
        case 'NOOP': return send('250 Ok');
        case 'QUIT': send('221 2.0.0 Bye'); socket.end(); return undefined;
        default: return send('502 5.5.2 Error: command not recognized');
      }
    };
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); onLine(line); }
    };
    socket.on('data', onData);
    socket.on('error', () => {});
    if (!silent) send('220 fake.smtp.test ESMTP');
  };
  const server = mode === 'tls' ? tls.createServer({ key: cert.key, cert: cert.cert }, handle) : net.createServer(handle);
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    port: server.address().port, messages, transcripts,
    close: () => new Promise((r) => server.close(() => r())),
  })));
}

// Décode un message MIME produit par Vigie : en-têtes et parties texte et HTML (base64).
export function parseMessage(raw) {
  const [head, ...bodyParts] = raw.split('\r\n\r\n');
  const headers = {};
  for (const line of head.replace(/\r\n /g, ' ').split('\r\n')) { const i = line.indexOf(':'); headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim(); }
  // Les espaces entre deux mots encodés adjacents ne comptent pas (RFC 2047, 6.2).
  const decodeWord = (s) => s.replace(/\?=\s+=\?/g, '?==?').replace(/=\?UTF-8\?B\?([^?]*)\?=/gi, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  const body = bodyParts.join('\r\n\r\n');
  const boundary = /boundary="([^"]+)"/.exec(headers['content-type'] || '')[1];
  const parts = {};
  for (const chunk of body.split(`--${boundary}`)) {
    const m = /Content-Type: (text\/(?:plain|html))[^\r]*\r\n[^]*?\r\n\r\n([^]*)$/.exec(chunk.trim() + '\r\n');
    if (m) parts[m[1]] = Buffer.from(m[2].replace(/\s+/g, ''), 'base64').toString('utf8');
  }
  return { headers, subject: decodeWord(headers.subject || ''), from: decodeWord(headers.from || ''), text: parts['text/plain'] || '', html: parts['text/html'] || '' };
}
