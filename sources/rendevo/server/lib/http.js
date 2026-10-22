// Tiny HTTP framework on top of node:http: routing, JSON bodies, cookies,
// raw uploads and static files with SPA fallback.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const bad = (msg, details) => new HttpError(400, msg, details);
export const notFound = (msg = 'Introuvable') => new HttpError(404, msg);
export const forbidden = (msg = 'Accès refusé') => new HttpError(403, msg);
export const unauthorized = (msg = 'Connexion requise') => new HttpError(401, msg);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8',
};

export function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
  }

  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  put(p, ...h) { this.add('PUT', p, ...h); }
  patch(p, ...h) { this.add('PATCH', p, ...h); }
  delete(p, ...h) { this.add('DELETE', p, ...h); }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { route: r, params };
      }
    }
    return null;
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Requête trop volumineuse')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

class Ctx {
  constructor(req, res, url) {
    this.req = req;
    this.res = res;
    this.url = url;
    this.query = Object.fromEntries(url.searchParams);
    this.params = {};
    this.cookies = parseCookies(req.headers.cookie);
    this.state = {};
    this._headers = {};
  }

  header(k, v) { this._headers[k] = v; return this; }

  setCookie(name, value, opts = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
    if (opts.secure) parts.push('Secure');
    const prev = this._headers['Set-Cookie'] || [];
    this._headers['Set-Cookie'] = [...prev, parts.join('; ')];
  }

  async json(limit = 2 * 1024 * 1024) {
    if (this._json !== undefined) return this._json;
    const buf = await readBody(this.req, limit);
    if (!buf.length) { this._json = {}; return this._json; }
    try { this._json = JSON.parse(buf.toString('utf8')); } catch { throw bad('JSON invalide'); }
    return this._json;
  }

  raw(limit) { return readBody(this.req, limit); }

  send(status, body, type) {
    if (this.res.headersSent) return;
    const headers = { ...this._headers };
    if (body === undefined || body === null) {
      this.res.writeHead(status, headers);
      this.res.end();
      return;
    }
    if (Buffer.isBuffer(body) || typeof body === 'string') {
      headers['Content-Type'] = type || headers['Content-Type'] || 'text/plain; charset=utf-8';
      this.res.writeHead(status, headers);
      this.res.end(body);
      return;
    }
    headers['Content-Type'] = 'application/json; charset=utf-8';
    this.res.writeHead(status, headers);
    this.res.end(JSON.stringify(body));
  }

  redirect(location) {
    this.res.writeHead(302, { ...this._headers, Location: location });
    this.res.end();
  }

  sendFile(file, { cache = 'no-cache', download } = {}) {
    return new Promise((resolve) => {
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { this.send(404, { error: 'Fichier introuvable' }); resolve(); return; }
        const headers = { ...this._headers, 'Content-Type': mimeFor(file), 'Content-Length': st.size, 'Cache-Control': cache };
        if (download) headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(download)}"`;
        const range = this.req.headers.range;
        if (range && /^bytes=\d*-\d*$/.test(range)) {
          let [s, e] = range.slice(6).split('-');
          const start = s ? parseInt(s, 10) : 0;
          const end = e ? Math.min(parseInt(e, 10), st.size - 1) : st.size - 1;
          headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
          headers['Content-Length'] = end - start + 1;
          headers['Accept-Ranges'] = 'bytes';
          this.res.writeHead(206, headers);
          fs.createReadStream(file, { start, end }).pipe(this.res).on('finish', resolve);
          return;
        }
        this.res.writeHead(200, headers);
        fs.createReadStream(file).pipe(this.res).on('finish', resolve);
      });
    });
  }
}

export function createServer({ router, staticDir, logger = console, onError }) {
  const indexFile = staticDir ? path.join(staticDir, 'index.html') : null;
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const ctx = new Ctx(req, res, url);
    ctx.header('X-Content-Type-Options', 'nosniff');
    ctx.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    const started = Date.now();
    try {
      const m = router.match(req.method === 'HEAD' ? 'GET' : req.method, url.pathname);
      if (m) {
        ctx.params = m.params;
        let result;
        for (const h of m.route.handlers) {
          result = await h(ctx);
          if (res.headersSent) break;
        }
        if (!res.headersSent) ctx.send(result === undefined ? 204 : 200, result === undefined ? null : result);
      } else if (url.pathname.startsWith('/api/') || url.pathname === '/mcp') {
        ctx.send(404, { error: 'Route inconnue' });
      } else if (staticDir && (req.method === 'GET' || req.method === 'HEAD')) {
        const safe = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
        const file = path.join(staticDir, safe);
        if (file.startsWith(staticDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          const immutable = /\/assets\//.test(url.pathname);
          await ctx.sendFile(file, { cache: immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
        } else {
          await ctx.sendFile(indexFile);
        }
      } else {
        ctx.send(404, { error: 'Introuvable' });
      }
    } catch (err) {
      if (err instanceof HttpError) {
        ctx.send(err.status, { error: err.message, details: err.details });
      } else {
        logger.error(`[http] ${req.method} ${url.pathname}:`, err);
        if (onError) onError(err);
        ctx.send(500, { error: 'Erreur interne du serveur' });
      }
    } finally {
      const ms = Date.now() - started;
      if (url.pathname.startsWith('/api/') && ms > 1500) logger.warn(`[http] lent: ${req.method} ${url.pathname} ${ms}ms`);
    }
  });
}
