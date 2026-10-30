// Sessions, limitation des tentatives et contrôle des rôles.
import { randomToken, sha256, hashPassword } from './security.js';
import { HttpError, serializeCookie } from './http.js';

export const SESSION_COOKIE = 'vigie_sid';
export const ROLES = ['admin', 'editor', 'viewer'];
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };

export function roleAtLeast(role, needed) {
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[needed] || 99);
}

export function isPrivateIp(ip) {
  const v = String(ip || '').replace(/^::ffff:/, '');
  return v === '127.0.0.1' || v === '::1' || /^10\./.test(v) || /^192\.168\./.test(v)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(v) || /^169\.254\./.test(v) || /^f[cd][0-9a-f]{2}:/i.test(v) || /^fe80:/i.test(v);
}

export function cameThroughCloudflare(req) {
  return Boolean(req.headers['cf-ray'] || req.headers['cf-connecting-ip'] || req.headers['cf-visitor']);
}

export function clientIp(req, cfg) {
  const direct = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (cfg.TRUST_CLOUDFLARE_HEADERS) {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    if (cf && /^[0-9a-fA-F:.]{3,45}$/.test(cf)) return cf;
  }
  return direct;
}

export function isHttps(req) {
  if (req.socket.encrypted) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto === 'https') return true;
  return /"scheme"\s*:\s*"https"/.test(String(req.headers['cf-visitor'] || ''));
}

export function cookieSecure(req, cfg) {
  if (cfg.SESSION_COOKIE_SECURE === 'true') return true;
  if (cfg.SESSION_COOKIE_SECURE === 'false') return false;
  return isHttps(req);
}

export class SessionStore {
  constructor(db, cfg) {
    this.db = db;
    this.cfg = cfg;
  }

  create(userId, ip, userAgent) {
    const token = randomToken(32);
    const now = Date.now();
    const expires = now + this.cfg.SESSION_MAX_HOURS * 3600_000;
    this.db.prepare('INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sha256(token), userId, now, now, expires, ip, String(userAgent || '').slice(0, 300));
    return { token, expires };
  }

  // Renvoie { session, user } ou null ; prolonge l'activité au plus une fois par minute.
  resolve(token) {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    const id = sha256(token);
    const row = this.db.prepare(`SELECT s.id AS sid, s.created_at AS s_created, s.last_seen_at, s.expires_at, s.ip AS s_ip, u.*
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(id);
    if (!row) return null;
    const now = Date.now();
    const idleLimit = this.cfg.SESSION_IDLE_MINUTES * 60_000;
    if (row.expires_at < now || row.last_seen_at + idleLimit < now || row.disabled) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      return null;
    }
    if (now - row.last_seen_at > 60_000) this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, id);
    const { sid, s_created, last_seen_at, expires_at, s_ip, ...user } = row;
    return { session: { id: sid, created_at: s_created, last_seen_at, expires_at, ip: s_ip }, user };
  }

  destroy(sessionId) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  destroyAllForUser(userId, exceptSessionId = null) {
    if (exceptSessionId) this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, exceptSessionId);
    else this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  purgeExpired() {
    const now = Date.now();
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?').run(now, now - this.cfg.SESSION_IDLE_MINUTES * 60_000);
  }

  cookie(req, token, maxAgeSeconds) {
    return serializeCookie(SESSION_COOKIE, token, { maxAge: maxAgeSeconds, secure: cookieSecure(req, this.cfg) });
  }

  clearCookie(req) {
    return serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: cookieSecure(req, this.cfg) });
  }
}

// Limitation des échecs par adresse IP (fenêtre glissante de 15 minutes, en mémoire).
export class IpLimiter {
  constructor(maxFailures, windowMs = 15 * 60_000) {
    this.max = maxFailures;
    this.windowMs = windowMs;
    this.map = new Map();
  }
  check(ip) {
    const e = this.map.get(ip);
    if (e && e.reset > Date.now() && e.count >= this.max) {
      throw new HttpError(429, 'too_many_attempts', 'Trop de tentatives depuis cette adresse. Réessayez dans quelques minutes.', { retry_after: Math.ceil((e.reset - Date.now()) / 1000) });
    }
  }
  fail(ip) {
    const now = Date.now();
    const e = this.map.get(ip);
    if (!e || e.reset <= now) this.map.set(ip, { count: 1, reset: now + this.windowMs });
    else e.count += 1;
    if (this.map.size > 10_000) for (const [k, v] of this.map) if (v.reset <= now) this.map.delete(k);
  }
  success(ip) {
    this.map.delete(ip);
  }
}

// Défis de double authentification en attente (après un mot de passe correct), valables 5 minutes.
export class PendingChallenges {
  constructor() { this.map = new Map(); }
  create(userId) {
    const token = randomToken(24);
    this.map.set(token, { userId, expires: Date.now() + 5 * 60_000, attempts: 0 });
    for (const [k, v] of this.map) if (v.expires < Date.now()) this.map.delete(k);
    return token;
  }
  get(token) {
    const e = this.map.get(String(token || ''));
    if (!e || e.expires < Date.now() || e.attempts >= 5) { this.map.delete(String(token || '')); return null; }
    return e;
  }
  consume(token) { this.map.delete(token); }
}

let dummyHash = null;
// Hachage factice : même durée de vérification qu'un compte existe ou non.
export async function getDummyHash() {
  if (!dummyHash) dummyHash = await hashPassword(randomToken(16));
  return dummyHash;
}

export function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    role: u.role,
    totp_enabled: Boolean(u.totp_enabled),
    disabled: Boolean(u.disabled),
    created_at: u.created_at,
    last_login_at: u.last_login_at,
    locked: Boolean(u.locked_until && u.locked_until > Date.now()),
    recovery_codes_left: u.recovery_codes ? JSON.parse(u.recovery_codes).length : 0,
  };
}
