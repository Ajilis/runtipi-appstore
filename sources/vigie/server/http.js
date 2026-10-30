// Outils HTTP sans dépendance : routeur, lecture JSON, cookies, en-têtes de sécurité, fichiers statiques.
import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const fail = (status, code, message, extra) => { throw new HttpError(status, code, message, extra); };

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, options, handler) {
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    this.routes.push({ method, regex, keys, handler, ...options });
  }
  get(p, o, h) { this.add('GET', p, o, h); }
  post(p, o, h) { this.add('POST', p, o, h); }
  put(p, o, h) { this.add('PUT', p, o, h); }
  patch(p, o, h) { this.add('PATCH', p, o, h); }
  delete(p, o, h) { this.add('DELETE', p, o, h); }
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

export function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new HttpError(413, 'payload_too_large', 'Contenu trop volumineux.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limitBytes = 1024 * 1024) {
  const type = String(req.headers['content-type'] || '');
  const buf = await readBody(req, limitBytes);
  if (buf.length === 0) return {};
  if (!type.includes('application/json')) fail(415, 'unsupported_media_type', 'Le contenu doit être au format JSON.');
  try {
    const value = JSON.parse(buf.toString('utf8'));
    if (value === null || typeof value !== 'object') fail(400, 'invalid_json', 'Objet JSON attendu.');
    return value;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    fail(400, 'invalid_json', 'JSON invalide.');
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* cookie illisible ignoré */ }
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Strict', path: p = '/' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${p}; SameSite=${sameSite}`;
  if (maxAge !== undefined) c += `; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
  if (httpOnly) c += '; HttpOnly';
  if (secure) c += '; Secure';
  return c;
}

export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(payload), ...headers });
  res.end(payload);
}

export function sendFile(res, status, buffer, contentType, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': contentType, 'Content-Length': buffer.length, 'Cache-Control': 'no-store', ...headers });
  res.end(buffer);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

// Sert web/ en mémoire : petit volume, fichiers figés dans l'image.
export function createStatic(rootDir, version) {
  const cache = new Map();
  const root = path.resolve(rootDir);
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel);
    const full = path.resolve(root, '.' + rel);
    if (!full.startsWith(root + path.sep)) return null;
    let entry = null;
    try {
      const stat = fs.statSync(full);
      if (stat.isFile()) {
        let buf = fs.readFileSync(full);
        if (rel === '/index.html') buf = Buffer.from(buf.toString('utf8').replaceAll('__VERSION__', version));
        entry = { buf, type: MIME[path.extname(full)] || 'application/octet-stream' };
      }
    } catch { entry = null; }
    cache.set(rel, entry);
    return entry;
  }
  return function serve(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const rel = pathname === '/' ? '/index.html' : pathname;
    if (rel.includes('\0') || rel.includes('..')) return false;
    const entry = load(rel);
    if (!entry) return false;
    const immutable = /^\/(fonts|vendor)\//.test(rel) || /\?v=/.test(req.url);
    const headers = { 'Cache-Control': rel === '/index.html' ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300' };
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': entry.type, 'Content-Length': entry.buf.length, ...headers });
    res.end(req.method === 'HEAD' ? undefined : entry.buf);
    return true;
  };
}
