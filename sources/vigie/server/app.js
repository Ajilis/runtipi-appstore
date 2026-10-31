// Assemblage : base, sessions, routes, fichiers statiques et contrôles communs à chaque requête.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { Router, HttpError, readJson, sendJson, sendFile, parseCookies, createStatic } from './http.js';
import { SessionStore, IpLimiter, PendingChallenges, SESSION_COOKIE, roleAtLeast, clientIp } from './auth.js';
import { registerRoutes } from './routes.js';
import { startBackupScheduler } from './backup.js';
import { LogoService } from './logos.js';

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

export function createLogger(level = 'info') {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  const min = order[level] || 20;
  const out = (lvl, msg) => { if (order[lvl] >= min) console[lvl === 'debug' ? 'log' : lvl](`${new Date().toISOString()} [${lvl}] ${msg}`); };
  return { debug: (m) => out('debug', m), info: (m) => out('info', m), warn: (m) => out('warn', m), error: (m) => out('error', m) };
}

// Requêtes modifiantes : en-tête propre à l'application obligatoire et origine identique à l'hôte (anti-CSRF).
function checkSameOrigin(req) {
  if (req.headers['x-vigie-request'] !== '1') throw new HttpError(403, 'csrf', 'Requête refusée (en-tête de sécurité manquant).');
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return;
  let host;
  try { host = new URL(origin).host; } catch { throw new HttpError(403, 'csrf', 'Origine invalide.'); }
  const expected = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (host.toLowerCase() !== expected.toLowerCase() && host.toLowerCase() !== String(req.headers.host || '').toLowerCase()) {
    throw new HttpError(403, 'csrf', 'Origine de la requête non autorisée.');
  }
}

export function createApp({ cfg, paths, log = createLogger(cfg.LOG_LEVEL), withScheduler = true, fetcher = globalThis.fetch }) {
  const db = openDatabase(paths.db);
  const sessions = new SessionStore(db, cfg);
  const ipLimiter = new IpLimiter(cfg.IP_MAX_FAILURES);
  const challenges = new PendingChallenges();
  const router = new Router();
  const logos = new LogoService(db, { enabled: cfg.INSTITUTION_LOGOS, fetcher, log });
  registerRoutes(router, { db, cfg, sessions, ipLimiter, challenges, paths, log, logos });
  const serveStatic = createStatic(WEB_DIR, cfg.VERSION);

  async function handleApi(req, res, url) {
    const cookieHeaders = [];
    const ctx = {
      req, res, query: url.searchParams, params: {}, body: {}, user: null, session: null,
      ip: clientIp(req, cfg),
      setCookie: (c) => cookieHeaders.push(c),
      handled: false,
      sendBody(status, buffer, type, headers = {}) {
        this.handled = true;
        sendFile(res, status, buffer, type, { ...headers, ...(cookieHeaders.length ? { 'Set-Cookie': cookieHeaders } : {}) });
      },
      sendRaw(status, buffer, type, filename) {
        this.handled = true;
        sendFile(res, status, buffer, type, { 'Content-Disposition': `attachment; filename="${filename}"`, ...(cookieHeaders.length ? { 'Set-Cookie': cookieHeaders } : {}) });
      },
    };
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) {
        const resolved = sessions.resolve(token);
        if (resolved) { ctx.user = resolved.user; ctx.session = resolved.session; }
        else ctx.setCookie(sessions.clearCookie(req));
      }
      const match = router.match(req.method, url.pathname);
      if (!match) throw new HttpError(404, 'not_found', 'Ressource introuvable.');
      if (match.methodNotAllowed) throw new HttpError(405, 'method_not_allowed', 'Méthode non autorisée.');
      const { route, params } = match;
      ctx.params = params;
      if (!['GET', 'HEAD'].includes(req.method)) checkSameOrigin(req);
      if (route.auth !== 'public') {
        if (!ctx.user) throw new HttpError(401, 'unauthenticated', 'Session expirée : reconnectez-vous.');
        if (!roleAtLeast(ctx.user.role, route.auth)) throw new HttpError(403, 'forbidden', "Votre rôle ne permet pas cette action.");
        if (cfg.REQUIRE_2FA && !ctx.user.totp_enabled && !route.allowWithout2fa) {
          throw new HttpError(403, 'totp_setup_required', 'Activez la double authentification pour accéder à vos données.');
        }
      }
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) ctx.body = await readJson(req, route.bodyLimit || 1024 * 1024);
      const result = await route.handler(ctx);
      if (!ctx.handled) sendJson(res, 200, result ?? { ok: true }, cookieHeaders.length ? { 'Set-Cookie': cookieHeaders } : {});
    } catch (err) {
      if (res.headersSent) { res.destroy(); return; }
      if (err instanceof HttpError) {
        const headers = cookieHeaders.length ? { 'Set-Cookie': cookieHeaders } : {};
        if (err.extra && err.extra.retry_after) headers['Retry-After'] = String(err.extra.retry_after);
        sendJson(res, err.status, { error: err.code, message: err.message, ...err.extra }, headers);
      } else {
        log.error(`${req.method} ${url.pathname} : ${err.stack || err.message}`);
        sendJson(res, 500, { error: 'internal', message: 'Erreur interne du serveur. Consultez les journaux du conteneur.' });
      }
    }
  }

  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://vigie.local'); } catch { res.writeHead(400).end(); return; }
    if (url.pathname.startsWith('/api/')) { handleApi(req, res, url); return; }
    if (serveStatic(req, res, url.pathname)) return;
    sendFile(res, 404, Buffer.from('Page introuvable'), 'text/plain; charset=utf-8');
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;

  const timers = [];
  const purge = setInterval(() => { try { sessions.purgeExpired(); } catch (e) { log.warn(e.message); } }, 15 * 60_000);
  purge.unref();
  timers.push(purge);
  if (withScheduler) { const t = startBackupScheduler(db, paths.backups, cfg, log); if (t) timers.push(t); }

  return {
    server, db,
    close() {
      timers.forEach(clearInterval);
      return new Promise((resolve) => server.close(() => { try { db.close(); } catch { /* déjà fermée */ } resolve(); }));
    },
  };
}
