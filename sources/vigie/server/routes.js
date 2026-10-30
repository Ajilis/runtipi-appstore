// Routes de l'API JSON.
import fs from 'node:fs';
import path from 'node:path';
import { fail, readJson } from './http.js';
import { transaction, getSetting, setSetting, seedCategories, schemaVersion } from './db.js';
import {
  hashPassword, verifyPassword, passwordProblem, encrypt, decrypt, generateTotpSecret, verifyTotp,
  otpauthUri, generateRecoveryCodes, normalizeRecoveryCode, sha256,
} from './security.js';
import { ROLES, publicUser, getDummyHash, isPrivateIp, cameThroughCloudflare } from './auth.js';
import {
  LIQUIDITY, dashboard, history, holdingsView, loadState, holdingSnapshot, parseAmountToCents, isIsoDate, todayIso, addDays,
} from './portfolio.js';
import { fetchEcbRates, ratesToBase } from './fx.js';
import { createBackup, listBackups, pruneBackups, BACKUP_NAME } from './backup.js';

export const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP', 'CAD', 'JPY', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'CNY', 'HKD', 'SGD', 'NZD', 'ZAR', 'BRL', 'MXN', 'INR', 'KRW', 'TRY', 'ILS', 'THB', 'IDR', 'MYR', 'PHP', 'ISK'];

// --- Validation -------------------------------------------------------------------------------------------
function text(value, label, { max = 80, required = false, min = 0 } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') fail(400, 'invalid_field', `${label} : texte attendu.`);
  const v = value.trim().replace(/\s+/g, ' ');
  if (required && !v) fail(400, 'invalid_field', `${label} : champ obligatoire.`);
  if (v.length < min) fail(400, 'invalid_field', `${label} : au moins ${min} caractères.`);
  if (v.length > max) fail(400, 'invalid_field', `${label} : ${max} caractères au maximum.`);
  return v;
}

function longText(value, label, max = 1000) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fail(400, 'invalid_field', `${label} : texte attendu.`);
  const v = value.trim();
  if (v.length > max) fail(400, 'invalid_field', `${label} : ${max} caractères au maximum.`);
  return v;
}

function username(value) {
  const v = text(value, "Nom d'utilisateur", { required: true, min: 3, max: 40 });
  if (!/^[a-zA-Z0-9._@-]+$/.test(v)) fail(400, 'invalid_field', "Nom d'utilisateur : lettres sans accent, chiffres et . _ @ - uniquement.");
  return v;
}

function oneOf(value, list, label) {
  if (!list.includes(value)) fail(400, 'invalid_field', `${label} : valeur non reconnue.`);
  return value;
}

function currency(value) {
  const v = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(v)) fail(400, 'invalid_field', 'Devise : code ISO à 3 lettres attendu (EUR, USD…).');
  return v;
}

function intId(value, label = 'Identifiant') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) fail(400, 'invalid_field', `${label} invalide.`);
  return n;
}

function valuationDate(value) {
  const v = value === undefined || value === null || value === '' ? todayIso() : String(value);
  if (!isIsoDate(v)) fail(400, 'invalid_field', 'Date : format AAAA-MM-JJ attendu.');
  if (v < '1900-01-01' || v > addDays(todayIso(), 1)) fail(400, 'invalid_field', 'Date : elle ne peut pas être dans le futur.');
  return v;
}

function amount(value, label = 'Montant') {
  const cents = parseAmountToCents(value);
  if (cents === null) fail(400, 'invalid_field', `${label} : nombre attendu, par exemple 12500 ou 12 500,50.`);
  return cents;
}

function targetPct(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100) fail(400, 'invalid_field', 'Allocation cible : pourcentage entre 0 et 100.');
  return Math.round(n * 10) / 10;
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function frNumber(cents) {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

const LIQ_LABEL = { immediate: 'Disponible', short: 'Sous quelques semaines', locked: 'Bloqué ou illiquide' };
export const DEFAULT_OWNERS = ['Moi', 'Conjoint', 'Commun'];

// Prénom et nom ; accepte aussi l'ancien champ display_name (« Prénom Nom ») pour les clients 0.1.
function personFields(b, existing = null) {
  let first = b.first_name, last = b.last_name;
  if (first === undefined && last === undefined && typeof b.display_name === 'string') {
    const parts = b.display_name.trim().split(/\s+/);
    first = parts.shift() || '';
    last = parts.join(' ');
  }
  const first_name = text(first ?? existing?.first_name ?? '', 'Prénom', { required: true, max: 60 });
  const last_name = text(last ?? existing?.last_name ?? '', 'Nom', { required: true, max: 60 });
  return { first_name, last_name, display_name: `${first_name} ${last_name}`.trim() };
}
const hasPerson = (b) => b.first_name !== undefined || b.last_name !== undefined || b.display_name !== undefined;

export function registerRoutes(router, deps) {
  const { db, cfg, sessions, ipLimiter, challenges, paths, log } = deps;

  const audit = (ctx, action, detail = '') => {
    db.prepare('INSERT INTO audit_log (at, user_id, username, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
      .run(Date.now(), ctx.user ? ctx.user.id : null, ctx.user ? ctx.user.username : (ctx.auditName || null), action, String(detail).slice(0, 500), ctx.ip);
  };
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const setupAllowed = (req, ip) => cfg.ALLOW_SETUP_THROUGH_TUNNEL || (!cameThroughCloudflare(req) && isPrivateIp(ip));
  const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  // --- Titulaires : liste enregistrée (réglage « owners ») complétée par ceux utilisés dans les avoirs ---
  function storedOwners() {
    try {
      const v = JSON.parse(getSetting(db, 'owners', 'null'));
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : null;
    } catch { return null; }
  }
  function ownerCounts() {
    const map = new Map();
    for (const r of db.prepare("SELECT owner, COUNT(*) AS n FROM holdings WHERE owner IS NOT NULL AND owner <> '' GROUP BY owner").all()) {
      const k = r.owner.toLowerCase();
      const e = map.get(k) || { name: r.owner, count: 0 };
      e.count += r.n;
      map.set(k, e);
    }
    return map;
  }
  function ownersList() {
    const list = storedOwners() || [...DEFAULT_OWNERS];
    const seen = new Set(list.map((x) => x.toLowerCase()));
    const counts = ownerCounts();
    for (const [k, e] of [...counts].sort((a, b) => a[1].name.localeCompare(b[1].name, 'fr'))) if (!seen.has(k)) { list.push(e.name); seen.add(k); }
    return list.map((name) => ({ name, count: (counts.get(name.toLowerCase()) || { count: 0 }).count }));
  }
  const saveOwners = (names) => setSetting(db, 'owners', JSON.stringify(names));
  // Renvoie le titulaire avec l'orthographe de la liste, et l'ajoute à la liste s'il est nouveau.
  function canonicalOwner(name) {
    if (!name) return '';
    const list = ownersList().map((o) => o.name);
    const found = list.find((x) => x.toLowerCase() === name.toLowerCase());
    if (found) return found;
    saveOwners([...list, name]);
    return name;
  }
  const ownerName = (v) => text(v, 'Titulaire', { required: true, max: 40 });

  const activeAdmins = (exceptId = 0) => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id <> ?").get(exceptId).n;

  function completeLogin(ctx, user) {
    const now = Date.now();
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(now, user.id);
    const { token } = sessions.create(user.id, ctx.ip, ctx.req.headers['user-agent']);
    ctx.setCookie(sessions.cookie(ctx.req, token, cfg.SESSION_MAX_HOURS * 3600));
    ipLimiter.success(ctx.ip);
    ctx.user = { ...user, last_login_at: now };
    audit(ctx, 'connexion', 'Connexion réussie');
    return { user: publicUser(ctx.user), needs_2fa_setup: cfg.REQUIRE_2FA && !user.totp_enabled };
  }

  function registerFailure(ctx, user, reason) {
    ipLimiter.fail(ctx.ip);
    if (!user) { audit(ctx, 'connexion_refusee', reason); return; }
    const attempts = user.failed_attempts + 1;
    if (attempts >= cfg.LOGIN_MAX_ATTEMPTS) {
      db.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?').run(Date.now() + cfg.LOGIN_LOCK_MINUTES * 60_000, user.id);
      audit({ ...ctx, user }, 'compte_bloque', `${cfg.LOGIN_MAX_ATTEMPTS} échecs consécutifs, blocage ${cfg.LOGIN_LOCK_MINUTES} min`);
    } else {
      db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, user.id);
      audit({ ...ctx, user }, 'connexion_refusee', reason);
    }
  }

  // --- Santé et état ---------------------------------------------------------------------------------
  router.get('/api/health', { auth: 'public' }, () => {
    db.prepare('SELECT 1').get();
    return { ok: true, version: cfg.VERSION, schema: schemaVersion() };
  });

  router.get('/api/auth/state', { auth: 'public' }, (ctx) => {
    const required = userCount() === 0;
    return {
      version: cfg.VERSION,
      setup_required: required,
      setup_allowed: required ? setupAllowed(ctx.req, ctx.ip) : false,
      user: ctx.user ? publicUser(ctx.user) : null,
      needs_2fa_setup: Boolean(ctx.user && cfg.REQUIRE_2FA && !ctx.user.totp_enabled),
      require_2fa: cfg.REQUIRE_2FA,
      currencies: CURRENCIES,
    };
  });

  router.post('/api/auth/setup', { auth: 'public' }, async (ctx) => {
    if (userCount() > 0) fail(409, 'already_setup', "L'application est déjà initialisée.");
    if (!setupAllowed(ctx.req, ctx.ip)) fail(403, 'setup_local_only', 'Créez le premier compte depuis votre réseau local (http://IP_DU_SERVEUR:port), pas via Cloudflare.');
    const b = ctx.body;
    const uname = username(b.username);
    const person = personFields(b);
    const problem = passwordProblem(b.password);
    if (problem) fail(400, 'weak_password', problem);
    const base = currency(b.base_currency || 'EUR');
    const hash = await hashPassword(b.password);
    const user = transaction(db, () => {
      if (userCount() > 0) fail(409, 'already_setup', "L'application est déjà initialisée.");
      const now = Date.now();
      const r = db.prepare("INSERT INTO users (username, display_name, first_name, last_name, password_hash, role, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?, 'admin', ?, ?)")
        .run(uname, person.display_name, person.first_name, person.last_name, hash, now, now);
      if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n === 0) seedCategories(db);
      setSetting(db, 'base_currency', base);
      setSetting(db, 'stale_days', '45');
      if (getSetting(db, 'owners') === null) saveOwners(DEFAULT_OWNERS);
      return getUser(Number(r.lastInsertRowid));
    });
    ctx.user = user;
    audit(ctx, 'installation', `Compte administrateur ${uname} créé, devise ${base}`);
    return completeLogin(ctx, user);
  });

  router.post('/api/auth/login', { auth: 'public' }, async (ctx) => {
    ipLimiter.check(ctx.ip);
    const name = typeof ctx.body.username === 'string' ? ctx.body.username.trim().slice(0, 40) : '';
    const password = typeof ctx.body.password === 'string' ? ctx.body.password.slice(0, 200) : '';
    ctx.auditName = name || null;
    const user = name ? db.prepare('SELECT * FROM users WHERE username = ?').get(name) : null;
    if (!user) {
      await verifyPassword(password, await getDummyHash());
      registerFailure(ctx, null, 'Utilisateur inconnu');
      fail(401, 'invalid_credentials', "Nom d'utilisateur ou mot de passe incorrect.");
    }
    if (user.locked_until && user.locked_until > Date.now()) {
      ipLimiter.fail(ctx.ip);
      fail(423, 'account_locked', `Compte bloqué temporairement après plusieurs échecs. Réessayez dans ${Math.ceil((user.locked_until - Date.now()) / 60_000)} min.`);
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      registerFailure(ctx, user, 'Mot de passe incorrect');
      fail(401, 'invalid_credentials', "Nom d'utilisateur ou mot de passe incorrect.");
    }
    if (user.disabled) {
      audit({ ...ctx, user }, 'connexion_refusee', 'Compte désactivé');
      fail(403, 'account_disabled', 'Ce compte est désactivé. Contactez un administrateur.');
    }
    if (user.totp_enabled) return { totp_required: true, challenge: challenges.create(user.id) };
    return completeLogin(ctx, user);
  });

  router.post('/api/auth/totp', { auth: 'public' }, (ctx) => {
    ipLimiter.check(ctx.ip);
    const challenge = challenges.get(ctx.body.challenge);
    if (!challenge) fail(401, 'challenge_expired', 'La vérification a expiré. Saisissez à nouveau votre mot de passe.');
    const user = getUser(challenge.userId);
    if (!user || user.disabled || !user.totp_enabled) { challenges.consume(ctx.body.challenge); fail(401, 'challenge_expired', 'Saisissez à nouveau votre mot de passe.'); }
    const code = String(ctx.body.code || '').trim();
    let ok = false;
    if (/^\d{3}\s?\d{3}$/.test(code)) {
      const step = verifyTotp(decrypt(cfg.APP_SECRET, user.totp_secret_enc), code, user.totp_last_step);
      if (step) { db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, user.id); ok = true; }
    } else {
      const rc = normalizeRecoveryCode(code);
      const list = user.recovery_codes ? JSON.parse(user.recovery_codes) : [];
      const idx = rc ? list.indexOf(sha256(rc)) : -1;
      if (idx >= 0) {
        list.splice(idx, 1);
        db.prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(list), user.id);
        audit({ ...ctx, user }, 'code_secours_utilise', `${list.length} code(s) de secours restant(s)`);
        ok = true;
      }
    }
    if (!ok) {
      challenge.attempts += 1;
      registerFailure(ctx, user, 'Code de double authentification incorrect');
      fail(401, 'invalid_code', 'Code incorrect ou déjà utilisé.');
    }
    challenges.consume(ctx.body.challenge);
    return completeLogin(ctx, user);
  });

  router.post('/api/auth/logout', { auth: 'public' }, (ctx) => {
    if (ctx.session) { sessions.destroy(ctx.session.id); audit(ctx, 'deconnexion'); }
    ctx.setCookie(sessions.clearCookie(ctx.req));
    return { ok: true };
  });

  // --- Mon compte --------------------------------------------------------------------------------------
  router.get('/api/account', { auth: 'viewer', allowWithout2fa: true }, (ctx) => ({ user: publicUser(ctx.user), require_2fa: cfg.REQUIRE_2FA }));

  router.patch('/api/account', { auth: 'viewer', allowWithout2fa: true }, (ctx) => {
    const p = personFields(ctx.body, ctx.user);
    db.prepare('UPDATE users SET display_name = ?, first_name = ?, last_name = ? WHERE id = ?').run(p.display_name, p.first_name, p.last_name, ctx.user.id);
    return { user: publicUser(getUser(ctx.user.id)) };
  });

  router.post('/api/account/password', { auth: 'viewer', allowWithout2fa: true }, async (ctx) => {
    if (!(await verifyPassword(String(ctx.body.current_password || ''), ctx.user.password_hash))) fail(400, 'wrong_password', 'Mot de passe actuel incorrect.');
    const problem = passwordProblem(ctx.body.new_password);
    if (problem) fail(400, 'weak_password', problem);
    const hash = await hashPassword(ctx.body.new_password);
    db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(hash, Date.now(), ctx.user.id);
    sessions.destroyAllForUser(ctx.user.id, ctx.session.id);
    audit(ctx, 'mot_de_passe_modifie', 'Autres sessions fermées');
    return { ok: true };
  });

  router.post('/api/account/totp/setup', { auth: 'viewer', allowWithout2fa: true }, (ctx) => {
    if (ctx.user.totp_enabled) fail(409, 'totp_already_enabled', 'La double authentification est déjà active.');
    const secret = generateTotpSecret();
    db.prepare('UPDATE users SET totp_secret_enc = ?, totp_last_step = 0 WHERE id = ?').run(encrypt(cfg.APP_SECRET, secret), ctx.user.id);
    return { secret, uri: otpauthUri(secret, ctx.user.username) };
  });

  router.post('/api/account/totp/enable', { auth: 'viewer', allowWithout2fa: true }, (ctx) => {
    if (ctx.user.totp_enabled) fail(409, 'totp_already_enabled', 'La double authentification est déjà active.');
    if (!ctx.user.totp_secret_enc) fail(400, 'totp_not_started', "Commencez par afficher le QR code.");
    const step = verifyTotp(decrypt(cfg.APP_SECRET, ctx.user.totp_secret_enc), ctx.body.code, 0);
    if (!step) fail(400, 'invalid_code', "Code incorrect. Vérifiez l'heure de votre téléphone et réessayez.");
    const codes = generateRecoveryCodes();
    db.prepare('UPDATE users SET totp_enabled = 1, totp_last_step = ?, recovery_codes = ? WHERE id = ?').run(step, JSON.stringify(codes.map(sha256)), ctx.user.id);
    sessions.destroyAllForUser(ctx.user.id, ctx.session.id);
    audit(ctx, 'double_auth_activee');
    return { recovery_codes: codes };
  });

  router.post('/api/account/totp/disable', { auth: 'viewer', allowWithout2fa: true }, async (ctx) => {
    if (cfg.REQUIRE_2FA) fail(403, 'totp_required', 'La double authentification est obligatoire sur ce serveur.');
    if (!(await verifyPassword(String(ctx.body.password || ''), ctx.user.password_hash))) fail(400, 'wrong_password', 'Mot de passe incorrect.');
    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_last_step = 0, recovery_codes = NULL WHERE id = ?').run(ctx.user.id);
    audit(ctx, 'double_auth_desactivee');
    return { ok: true };
  });

  router.post('/api/account/recovery-codes', { auth: 'viewer', allowWithout2fa: true }, async (ctx) => {
    if (!ctx.user.totp_enabled) fail(400, 'totp_not_enabled', "Activez d'abord la double authentification.");
    if (!(await verifyPassword(String(ctx.body.password || ''), ctx.user.password_hash))) fail(400, 'wrong_password', 'Mot de passe incorrect.');
    const codes = generateRecoveryCodes();
    db.prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes.map(sha256)), ctx.user.id);
    audit(ctx, 'codes_secours_regeneres');
    return { recovery_codes: codes };
  });

  router.get('/api/account/sessions', { auth: 'viewer', allowWithout2fa: true }, (ctx) => {
    const rows = db.prepare('SELECT id, created_at, last_seen_at, expires_at, ip, user_agent FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC').all(ctx.user.id);
    return { sessions: rows.map((s) => ({ ...s, current: s.id === ctx.session.id })) };
  });

  router.delete('/api/account/sessions/:id', { auth: 'viewer', allowWithout2fa: true }, (ctx) => {
    const r = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(ctx.params.id, ctx.user.id);
    if (!r.changes) fail(404, 'not_found', 'Session introuvable.');
    if (ctx.params.id === ctx.session.id) ctx.setCookie(sessions.clearCookie(ctx.req));
    audit(ctx, 'session_fermee');
    return { ok: true };
  });

  router.post('/api/account/sessions/revoke-others', { auth: 'viewer', allowWithout2fa: true }, (ctx) => {
    sessions.destroyAllForUser(ctx.user.id, ctx.session.id);
    audit(ctx, 'autres_sessions_fermees');
    return { ok: true };
  });

  // --- Lecture du patrimoine -----------------------------------------------------------------------------
  router.get('/api/dashboard', { auth: 'viewer' }, () => dashboard(db));

  router.get('/api/history', { auth: 'viewer' }, (ctx) => {
    const range = ctx.query.get('range') || '1y';
    return history(db, ['3m', '6m', '1y', '3y', '5y', 'all'].includes(range) ? range : '1y');
  });

  router.get('/api/holdings', { auth: 'viewer' }, () => holdingsView(db));

  router.get('/api/holdings/:id', { auth: 'viewer' }, (ctx) => {
    const id = intId(ctx.params.id);
    const h = db.prepare('SELECT * FROM holdings WHERE id = ?').get(id);
    if (!h) fail(404, 'not_found', 'Avoir introuvable.');
    const state = loadState(db);
    const snap = holdingSnapshot(state, h);
    const valuations = db.prepare(`SELECT v.id, v.valued_at, v.amount_cents, v.note, v.created_at, u.display_name AS created_by
      FROM valuations v LEFT JOIN users u ON u.id = v.created_by WHERE v.holding_id = ? ORDER BY v.valued_at DESC`).all(id);
    return { holding: { ...h, value_cents: snap.cents, value_base: snap.base, missing_rate: snap.missingRate }, valuations, base_currency: state.base };
  });

  router.get('/api/categories', { auth: 'viewer' }, () => {
    const rows = db.prepare('SELECT c.*, (SELECT COUNT(*) FROM holdings h WHERE h.category_id = c.id) AS holding_count FROM categories c ORDER BY sort_order, id').all();
    return { categories: rows };
  });

  router.get('/api/settings', { auth: 'viewer' }, (ctx) => {
    const base = getSetting(db, 'base_currency', 'EUR');
    const used = db.prepare('SELECT DISTINCT currency FROM holdings').all().map((r) => r.currency);
    const rates = db.prepare('SELECT currency, rate, source, updated_at FROM fx_rates ORDER BY currency').all();
    const out = {
      base_currency: base,
      stale_days: Number(getSetting(db, 'stale_days', '45')),
      rates,
      currencies_in_use: used.filter((c) => c !== base),
      missing_rates: used.filter((c) => c !== base && !rates.some((r) => r.currency === c)),
      currencies: CURRENCIES,
      ecb_enabled: cfg.ECB_RATES_ENABLED,
      owners: ownersList().map((o) => o.name),
      institutions: db.prepare("SELECT DISTINCT institution FROM holdings WHERE institution IS NOT NULL AND institution <> '' ORDER BY institution").all().map((r) => r.institution),
    };
    if (ctx.user.role === 'admin') {
      out.security = {
        session_idle_minutes: cfg.SESSION_IDLE_MINUTES, session_max_hours: cfg.SESSION_MAX_HOURS, login_max_attempts: cfg.LOGIN_MAX_ATTEMPTS,
        login_lock_minutes: cfg.LOGIN_LOCK_MINUTES, require_2fa: cfg.REQUIRE_2FA, backup_hour: cfg.BACKUP_HOUR, backup_keep_days: cfg.BACKUP_KEEP_DAYS,
      };
    }
    return out;
  });

  // --- Titulaires -----------------------------------------------------------------------------------------------
  router.get('/api/owners', { auth: 'viewer' }, () => ({ owners: ownersList() }));

  router.post('/api/owners', { auth: 'editor' }, (ctx) => {
    const name = ownerName(ctx.body.name);
    const list = ownersList().map((o) => o.name);
    if (list.some((x) => x.toLowerCase() === name.toLowerCase())) fail(409, 'owner_exists', 'Ce titulaire existe déjà.');
    saveOwners([...list, name]);
    audit(ctx, 'titulaire_ajoute', name);
    return { owners: ownersList() };
  });

  router.post('/api/owners/rename', { auth: 'editor' }, (ctx) => {
    const from = ownerName(ctx.body.from);
    const to = ownerName(ctx.body.to);
    const list = ownersList().map((o) => o.name);
    const idx = list.findIndex((x) => x.toLowerCase() === from.toLowerCase());
    if (idx < 0) fail(404, 'not_found', 'Titulaire introuvable.');
    const target = list.find((x, i) => i !== idx && x.toLowerCase() === to.toLowerCase());
    const original = list[idx];
    transaction(db, () => {
      const finalName = target || to;
      db.prepare('UPDATE holdings SET owner = ?, updated_at = ? WHERE lower(owner) = lower(?)').run(finalName, Date.now(), list[idx]);
      if (target) list.splice(idx, 1); else list[idx] = to;
      saveOwners(list);
    });
    audit(ctx, 'titulaire_renomme', `${original} → ${target || to}${target ? ' (fusion)' : ''}`);
    return { owners: ownersList(), merged: Boolean(target) };
  });

  router.post('/api/owners/delete', { auth: 'editor' }, (ctx) => {
    const name = ownerName(ctx.body.name);
    const entry = ownersList().find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (!entry) fail(404, 'not_found', 'Titulaire introuvable.');
    if (entry.count > 0) fail(409, 'owner_in_use', `Ce titulaire est indiqué sur ${entry.count} avoir(s) : renommez-le ou modifiez ces avoirs d'abord.`);
    saveOwners(ownersList().map((o) => o.name).filter((x) => x.toLowerCase() !== name.toLowerCase()));
    audit(ctx, 'titulaire_supprime', entry.name);
    return { owners: ownersList() };
  });

  // --- Catégories ---------------------------------------------------------------------------------------------
  function categoryFields(b, existing = {}) {
    const name = text(b.name ?? existing.name, 'Nom', { required: true, max: 60 });
    const kind = oneOf(b.kind ?? existing.kind ?? 'asset', ['asset', 'liability'], 'Type');
    const description = text(b.description ?? existing.description ?? '', 'Description', { max: 120 });
    const liquidity = oneOf(b.default_liquidity ?? existing.default_liquidity ?? 'immediate', LIQUIDITY, 'Liquidité');
    const target = kind === 'asset' ? targetPct(b.target_pct !== undefined ? b.target_pct : existing.target_pct) : null;
    return { name, kind, description, liquidity, target };
  }

  router.post('/api/categories', { auth: 'editor' }, (ctx) => {
    const f = categoryFields(ctx.body);
    const order = (db.prepare('SELECT MAX(sort_order) AS m FROM categories').get().m || 0) + 10;
    const r = db.prepare('INSERT INTO categories (name, kind, description, default_liquidity, target_pct, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(f.name, f.kind, f.description, f.liquidity, f.target, order, Date.now());
    audit(ctx, 'categorie_creee', f.name);
    return { category: db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(r.lastInsertRowid)) };
  });

  router.patch('/api/categories/:id', { auth: 'editor' }, (ctx) => {
    const id = intId(ctx.params.id);
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existing) fail(404, 'not_found', 'Catégorie introuvable.');
    const f = categoryFields(ctx.body, existing);
    if (f.kind !== existing.kind && db.prepare('SELECT COUNT(*) AS n FROM holdings WHERE category_id = ?').get(id).n > 0) {
      fail(409, 'category_not_empty', "Impossible de changer le type d'une catégorie qui contient des avoirs.");
    }
    db.prepare('UPDATE categories SET name = ?, kind = ?, description = ?, default_liquidity = ?, target_pct = ? WHERE id = ?')
      .run(f.name, f.kind, f.description, f.liquidity, f.target, id);
    audit(ctx, 'categorie_modifiee', f.name);
    return { category: db.prepare('SELECT * FROM categories WHERE id = ?').get(id) };
  });

  router.delete('/api/categories/:id', { auth: 'editor' }, (ctx) => {
    const id = intId(ctx.params.id);
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existing) fail(404, 'not_found', 'Catégorie introuvable.');
    if (db.prepare('SELECT COUNT(*) AS n FROM holdings WHERE category_id = ?').get(id).n > 0) {
      fail(409, 'category_not_empty', "Cette catégorie contient des avoirs : déplacez-les ou supprimez-les d'abord.");
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    audit(ctx, 'categorie_supprimee', existing.name);
    return { ok: true };
  });

  router.post('/api/categories/reorder', { auth: 'editor' }, (ctx) => {
    const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids.map((x) => intId(x)) : fail(400, 'invalid_field', 'Liste attendue.');
    transaction(db, () => ids.forEach((id, i) => db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').run((i + 1) * 10, id)));
    return { ok: true };
  });

  // --- Avoirs -----------------------------------------------------------------------------------------------
  function holdingFields(b, existing = {}) {
    const categoryId = intId(b.category_id ?? existing.category_id, 'Catégorie');
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
    if (!cat) fail(400, 'invalid_field', 'Catégorie introuvable.');
    return {
      category_id: categoryId,
      name: text(b.name ?? existing.name, 'Nom', { required: true, max: 80 }),
      institution: text(b.institution ?? existing.institution ?? '', 'Établissement', { max: 80 }),
      owner: canonicalOwner(text(b.owner ?? existing.owner ?? '', 'Titulaire', { max: 40 })),
      currency: currency(b.currency ?? existing.currency ?? getSetting(db, 'base_currency', 'EUR')),
      liquidity: oneOf(b.liquidity ?? existing.liquidity ?? cat.default_liquidity, LIQUIDITY, 'Liquidité'),
      notes: longText(b.notes ?? existing.notes ?? '', 'Notes'),
    };
  }

  const upsertValuation = db.prepare(`INSERT INTO valuations (holding_id, valued_at, amount_cents, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(holding_id, valued_at) DO UPDATE SET amount_cents = excluded.amount_cents, note = excluded.note, created_by = excluded.created_by, created_at = excluded.created_at`);

  router.post('/api/holdings', { auth: 'editor' }, (ctx) => {
    const f = holdingFields(ctx.body);
    const hasInitial = ctx.body.amount !== undefined && ctx.body.amount !== null && ctx.body.amount !== '';
    const cents = hasInitial ? amount(ctx.body.amount, 'Valeur actuelle') : null;
    const date = valuationDate(ctx.body.date);
    const id = transaction(db, () => {
      const now = Date.now();
      const order = (db.prepare('SELECT MAX(sort_order) AS m FROM holdings WHERE category_id = ?').get(f.category_id).m || 0) + 10;
      const r = db.prepare(`INSERT INTO holdings (category_id, name, institution, owner, currency, liquidity, notes, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.category_id, f.name, f.institution, f.owner, f.currency, f.liquidity, f.notes, order, now, now);
      const newId = Number(r.lastInsertRowid);
      if (cents !== null) upsertValuation.run(newId, date, cents, '', ctx.user.id, now);
      return newId;
    });
    audit(ctx, 'avoir_cree', f.name);
    return { id };
  });

  router.patch('/api/holdings/:id', { auth: 'editor' }, (ctx) => {
    const id = intId(ctx.params.id);
    const existing = db.prepare('SELECT * FROM holdings WHERE id = ?').get(id);
    if (!existing) fail(404, 'not_found', 'Avoir introuvable.');
    const f = holdingFields(ctx.body, existing);
    db.prepare('UPDATE holdings SET category_id = ?, name = ?, institution = ?, owner = ?, currency = ?, liquidity = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(f.category_id, f.name, f.institution, f.owner, f.currency, f.liquidity, f.notes, Date.now(), id);
    audit(ctx, 'avoir_modifie', f.name);
    return { id };
  });

  router.delete('/api/holdings/:id', { auth: 'editor' }, (ctx) => {
    const id = intId(ctx.params.id);
    const existing = db.prepare('SELECT * FROM holdings WHERE id = ?').get(id);
    if (!existing) fail(404, 'not_found', 'Avoir introuvable.');
    db.prepare('DELETE FROM holdings WHERE id = ?').run(id);
    audit(ctx, 'avoir_supprime', `${existing.name} et son historique`);
    return { ok: true };
  });

  router.post('/api/holdings/:id/close', { auth: 'editor' }, (ctx) => {
    const id = intId(ctx.params.id);
    const existing = db.prepare('SELECT * FROM holdings WHERE id = ?').get(id);
    if (!existing) fail(404, 'not_found', 'Avoir introuvable.');
    const date = valuationDate(ctx.body.date);
    transaction(db, () => {
      upsertValuation.run(id, date, 0, 'Clôture', ctx.user.id, Date.now());
      db.prepare('UPDATE holdings SET closed_at = ?, updated_at = ? WHERE id = ?').run(date, Date.now(), id);
    });
    audit(ctx, 'avoir_cloture', `${existing.name} au ${date}`);
    return { ok: true };
  });

  router.post('/api/holdings/:id/reopen', { auth: 'editor' }, (ctx) => {
    const id = intId(ctx.params.id);
    const existing = db.prepare('SELECT * FROM holdings WHERE id = ?').get(id);
    if (!existing) fail(404, 'not_found', 'Avoir introuvable.');
    db.prepare('UPDATE holdings SET closed_at = NULL, updated_at = ? WHERE id = ?').run(Date.now(), id);
    audit(ctx, 'avoir_rouvert', existing.name);
    return { ok: true };
  });

  router.post('/api/holdings/:id/valuations', { auth: 'editor' }, (ctx) => {
    const id = intId(ctx.params.id);
    const existing = db.prepare('SELECT * FROM holdings WHERE id = ?').get(id);
    if (!existing) fail(404, 'not_found', 'Avoir introuvable.');
    const cents = amount(ctx.body.amount, 'Valeur');
    const date = valuationDate(ctx.body.date);
    const note = text(ctx.body.note || '', 'Note', { max: 120 });
    upsertValuation.run(id, date, cents, note, ctx.user.id, Date.now());
    db.prepare('UPDATE holdings SET updated_at = ? WHERE id = ?').run(Date.now(), id);
    audit(ctx, 'valeur_enregistree', `${existing.name} : ${frNumber(cents)} ${existing.currency} au ${date}`);
    return { ok: true };
  });

  router.delete('/api/valuations/:id', { auth: 'editor' }, (ctx) => {
    const id = intId(ctx.params.id);
    const v = db.prepare('SELECT v.*, h.name, h.currency FROM valuations v JOIN holdings h ON h.id = v.holding_id WHERE v.id = ?').get(id);
    if (!v) fail(404, 'not_found', 'Valeur introuvable.');
    db.prepare('DELETE FROM valuations WHERE id = ?').run(id);
    audit(ctx, 'valeur_supprimee', `${v.name} : ${frNumber(v.amount_cents)} ${v.currency} au ${v.valued_at}`);
    return { ok: true };
  });

  router.post('/api/valuations/bulk', { auth: 'editor' }, (ctx) => {
    const date = valuationDate(ctx.body.date);
    const items = Array.isArray(ctx.body.items) ? ctx.body.items : fail(400, 'invalid_field', 'Liste de valeurs attendue.');
    if (items.length === 0) fail(400, 'invalid_field', 'Aucune valeur à enregistrer.');
    if (items.length > 1000) fail(400, 'invalid_field', '1000 valeurs au maximum par envoi.');
    const parsed = items.map((it, i) => {
      const hid = intId(it.holding_id, `Ligne ${i + 1}`);
      if (!db.prepare('SELECT 1 FROM holdings WHERE id = ?').get(hid)) fail(400, 'invalid_field', `Ligne ${i + 1} : avoir introuvable.`);
      return { hid, cents: amount(it.amount, `Ligne ${i + 1}`) };
    });
    transaction(db, () => {
      const now = Date.now();
      for (const p of parsed) {
        upsertValuation.run(p.hid, date, p.cents, '', ctx.user.id, now);
        db.prepare('UPDATE holdings SET updated_at = ? WHERE id = ?').run(now, p.hid);
      }
    });
    audit(ctx, 'mise_a_jour_rapide', `${parsed.length} valeur(s) au ${date}`);
    return { saved: parsed.length, date };
  });

  // --- Devises -------------------------------------------------------------------------------------------------
  router.put('/api/fx', { auth: 'editor' }, (ctx) => {
    const base = getSetting(db, 'base_currency', 'EUR');
    const rates = ctx.body.rates && typeof ctx.body.rates === 'object' ? ctx.body.rates : fail(400, 'invalid_field', 'Taux attendus.');
    const entries = Object.entries(rates).map(([cur, val]) => {
      const c = currency(cur);
      if (c === base) fail(400, 'invalid_field', `${c} est la devise de référence.`);
      const n = typeof val === 'number' ? val : Number(String(val).replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0 || n > 1e6) fail(400, 'invalid_field', `Taux ${c} : nombre positif attendu.`);
      return [c, n];
    });
    transaction(db, () => {
      for (const [c, n] of entries) {
        db.prepare("INSERT INTO fx_rates (currency, rate, source, updated_at) VALUES (?, ?, 'manuel', ?) ON CONFLICT(currency) DO UPDATE SET rate = excluded.rate, source = excluded.source, updated_at = excluded.updated_at")
          .run(c, n, Date.now());
      }
    });
    audit(ctx, 'taux_modifies', entries.map(([c, n]) => `1 ${c} = ${n} ${base}`).join(', '));
    return { ok: true };
  });

  router.delete('/api/fx/:currency', { auth: 'editor' }, (ctx) => {
    const c = currency(ctx.params.currency);
    db.prepare('DELETE FROM fx_rates WHERE currency = ?').run(c);
    audit(ctx, 'taux_supprime', c);
    return { ok: true };
  });

  router.post('/api/fx/ecb', { auth: 'editor' }, async (ctx) => {
    if (!cfg.ECB_RATES_ENABLED) fail(403, 'ecb_disabled', 'La récupération des taux BCE est désactivée dans le fichier de configuration.');
    const base = getSetting(db, 'base_currency', 'EUR');
    const wanted = new Set([
      ...db.prepare('SELECT DISTINCT currency FROM holdings').all().map((r) => r.currency),
      ...db.prepare('SELECT currency FROM fx_rates').all().map((r) => r.currency),
    ]);
    wanted.delete(base);
    if (wanted.size === 0) return { date: null, updated: [], missing: [] };
    let ecb;
    try { ecb = await fetchEcbRates(); } catch (err) {
      log.warn('Taux BCE indisponibles : ' + err.message);
      fail(502, 'ecb_unreachable', "La BCE n'a pas pu être jointe depuis le serveur. Saisissez les taux à la main.");
    }
    if (!ecb.perEur[base]) fail(400, 'ecb_base_unsupported', `La BCE ne publie pas de taux pour ${base}.`);
    const { rates, missing } = ratesToBase(ecb.perEur, base, [...wanted]);
    transaction(db, () => {
      for (const [c, n] of Object.entries(rates)) {
        db.prepare('INSERT INTO fx_rates (currency, rate, source, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(currency) DO UPDATE SET rate = excluded.rate, source = excluded.source, updated_at = excluded.updated_at')
          .run(c, n, `BCE ${ecb.date || ''}`.trim(), Date.now());
      }
    });
    audit(ctx, 'taux_bce', `${Object.keys(rates).join(', ')} au ${ecb.date}`);
    return { date: ecb.date, updated: Object.keys(rates), missing };
  });

  // --- Réglages (administrateur) -----------------------------------------------------------------------------------
  router.put('/api/settings', { auth: 'admin' }, (ctx) => {
    const changes = [];
    let warning = null;
    if (ctx.body.stale_days !== undefined) {
      const n = Number(ctx.body.stale_days);
      if (!Number.isInteger(n) || n < 0 || n > 3650) fail(400, 'invalid_field', 'Rappel : nombre de jours entre 0 et 3650.');
      setSetting(db, 'stale_days', n);
      changes.push(`rappel ${n} j`);
    }
    if (ctx.body.base_currency !== undefined) {
      const c = currency(ctx.body.base_currency);
      const old = getSetting(db, 'base_currency', 'EUR');
      if (c !== old) {
        transaction(db, () => { db.prepare('DELETE FROM fx_rates').run(); setSetting(db, 'base_currency', c); });
        changes.push(`devise de référence ${old} → ${c}`);
        warning = 'Les taux de change ont été effacés : saisissez-les à nouveau par rapport à la nouvelle devise.';
      }
    }
    if (changes.length) audit(ctx, 'reglages_modifies', changes.join(', '));
    return { ok: true, warning };
  });

  // --- Utilisateurs (administrateur) -------------------------------------------------------------------------------
  router.get('/api/users', { auth: 'admin' }, () => ({ users: db.prepare('SELECT * FROM users ORDER BY id').all().map(publicUser) }));

  router.post('/api/users', { auth: 'admin' }, async (ctx) => {
    const uname = username(ctx.body.username);
    const person = personFields(ctx.body);
    const role = oneOf(ctx.body.role, ROLES, 'Rôle');
    const problem = passwordProblem(ctx.body.password);
    if (problem) fail(400, 'weak_password', problem);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(uname)) fail(409, 'username_taken', "Ce nom d'utilisateur existe déjà.");
    const hash = await hashPassword(ctx.body.password);
    const now = Date.now();
    const r = db.prepare('INSERT INTO users (username, display_name, first_name, last_name, password_hash, role, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uname, person.display_name, person.first_name, person.last_name, hash, role, now, now);
    audit(ctx, 'utilisateur_cree', `${uname} (${role})`);
    return { user: publicUser(getUser(Number(r.lastInsertRowid))) };
  });

  router.patch('/api/users/:id', { auth: 'admin' }, (ctx) => {
    const id = intId(ctx.params.id);
    const u = getUser(id);
    if (!u) fail(404, 'not_found', 'Utilisateur introuvable.');
    const person = hasPerson(ctx.body) ? personFields(ctx.body, u) : { display_name: u.display_name, first_name: u.first_name, last_name: u.last_name };
    const role = ctx.body.role !== undefined ? oneOf(ctx.body.role, ROLES, 'Rôle') : u.role;
    const disabled = ctx.body.disabled !== undefined ? (ctx.body.disabled ? 1 : 0) : u.disabled;
    if (id === ctx.user.id && (role !== 'admin' || disabled)) fail(400, 'self_protection', 'Vous ne pouvez pas retirer vos propres droits administrateur ni désactiver votre compte.');
    if (u.role === 'admin' && !u.disabled && (role !== 'admin' || disabled) && activeAdmins(id) === 0) fail(400, 'last_admin', 'Il doit rester au moins un administrateur actif.');
    const unlock = ctx.body.unlock === true;
    db.prepare(`UPDATE users SET display_name = ?, first_name = ?, last_name = ?, role = ?, disabled = ?${unlock ? ', locked_until = NULL, failed_attempts = 0' : ''} WHERE id = ?`)
      .run(person.display_name, person.first_name, person.last_name, role, disabled, id);
    if (disabled || role !== u.role) sessions.destroyAllForUser(id);
    audit(ctx, 'utilisateur_modifie', `${u.username} : rôle ${role}${disabled ? ', désactivé' : ''}${unlock ? ', débloqué' : ''}`);
    return { user: publicUser(getUser(id)) };
  });

  router.post('/api/users/:id/password', { auth: 'admin' }, async (ctx) => {
    const id = intId(ctx.params.id);
    const u = getUser(id);
    if (!u) fail(404, 'not_found', 'Utilisateur introuvable.');
    const problem = passwordProblem(ctx.body.password);
    if (problem) fail(400, 'weak_password', problem);
    const hash = await hashPassword(ctx.body.password);
    db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, locked_until = NULL, failed_attempts = 0 WHERE id = ?').run(hash, Date.now(), id);
    sessions.destroyAllForUser(id, id === ctx.user.id ? ctx.session.id : null);
    audit(ctx, 'mot_de_passe_reinitialise', u.username);
    return { ok: true };
  });

  router.post('/api/users/:id/reset-2fa', { auth: 'admin' }, (ctx) => {
    const id = intId(ctx.params.id);
    const u = getUser(id);
    if (!u) fail(404, 'not_found', 'Utilisateur introuvable.');
    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_last_step = 0, recovery_codes = NULL WHERE id = ?').run(id);
    sessions.destroyAllForUser(id, id === ctx.user.id ? ctx.session.id : null);
    audit(ctx, 'double_auth_reinitialisee', u.username);
    return { ok: true };
  });

  router.delete('/api/users/:id', { auth: 'admin' }, (ctx) => {
    const id = intId(ctx.params.id);
    const u = getUser(id);
    if (!u) fail(404, 'not_found', 'Utilisateur introuvable.');
    if (id === ctx.user.id) fail(400, 'self_protection', 'Vous ne pouvez pas supprimer votre propre compte.');
    if (u.role === 'admin' && !u.disabled && activeAdmins(id) === 0) fail(400, 'last_admin', 'Il doit rester au moins un administrateur actif.');
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    audit(ctx, 'utilisateur_supprime', u.username);
    return { ok: true };
  });

  // --- Journal ---------------------------------------------------------------------------------------------------------
  router.get('/api/audit', { auth: 'admin' }, (ctx) => {
    const before = Number(ctx.query.get('before')) || Number.MAX_SAFE_INTEGER;
    const limit = Math.min(200, Math.max(1, Number(ctx.query.get('limit')) || 100));
    const rows = db.prepare('SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?').all(before, limit);
    return { entries: rows, more: rows.length === limit };
  });

  // --- Export, import, sauvegardes -------------------------------------------------------------------------------
  function exportObject() {
    return {
      format: 'vigie-export',
      version: 1,
      app_version: cfg.VERSION,
      exported_at: new Date().toISOString(),
      settings: { base_currency: getSetting(db, 'base_currency', 'EUR'), stale_days: Number(getSetting(db, 'stale_days', '45')), owners: ownersList().map((o) => o.name) },
      fx_rates: db.prepare('SELECT currency, rate, source, updated_at FROM fx_rates').all(),
      categories: db.prepare('SELECT id, name, kind, description, default_liquidity, target_pct, sort_order FROM categories ORDER BY sort_order, id').all(),
      holdings: db.prepare('SELECT id, category_id, name, institution, owner, currency, liquidity, notes, closed_at, sort_order FROM holdings ORDER BY id').all(),
      valuations: db.prepare('SELECT holding_id, valued_at, amount_cents, note FROM valuations ORDER BY holding_id, valued_at').all(),
    };
  }

  const stampName = () => todayIso();

  router.get('/api/export.json', { auth: 'viewer' }, (ctx) => {
    audit(ctx, 'export', 'JSON complet');
    ctx.sendRaw(200, Buffer.from(JSON.stringify(exportObject(), null, 2)), 'application/json; charset=utf-8', `vigie-export-${stampName()}.json`);
  });

  router.get('/api/export/holdings.csv', { auth: 'viewer' }, (ctx) => {
    const v = holdingsView(db);
    const cats = new Map(v.categories.map((c) => [c.id, c]));
    const rows = [['Catégorie', 'Type', 'Avoir', 'Établissement', 'Titulaire', 'Liquidité', 'Devise', 'Valeur', `Valeur en ${v.base_currency}`, 'Date de la valeur', 'Clôturé le']];
    for (const h of v.holdings) {
      const c = cats.get(h.category_id) || {};
      rows.push([c.name, c.kind === 'liability' ? 'Passif' : 'Actif', h.name, h.institution, h.owner, LIQ_LABEL[h.liquidity], h.currency, frNumber(h.value_cents), frNumber(h.value_base), h.last_date, h.closed_at]);
    }
    audit(ctx, 'export', 'CSV des avoirs');
    ctx.sendRaw(200, Buffer.from('﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n')), 'text/csv; charset=utf-8', `vigie-avoirs-${stampName()}.csv`);
  });

  router.get('/api/export/history.csv', { auth: 'viewer' }, (ctx) => {
    const rows = [['Date', 'Avoir', 'Catégorie', 'Devise', 'Valeur', 'Note']];
    const data = db.prepare(`SELECT v.valued_at, h.name, c.name AS category, h.currency, v.amount_cents, v.note FROM valuations v
      JOIN holdings h ON h.id = v.holding_id JOIN categories c ON c.id = h.category_id ORDER BY v.valued_at, c.sort_order, h.name`).all();
    for (const r of data) rows.push([r.valued_at, r.name, r.category, r.currency, frNumber(r.amount_cents), r.note]);
    audit(ctx, 'export', "CSV de l'historique");
    ctx.sendRaw(200, Buffer.from('﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n')), 'text/csv; charset=utf-8', `vigie-historique-${stampName()}.csv`);
  });

  router.post('/api/admin/import', { auth: 'admin', bodyLimit: 25 * 1024 * 1024 }, (ctx) => {
    const d = ctx.body;
    if (d.format !== 'vigie-export' || d.version !== 1) fail(400, 'invalid_import', "Ce fichier n'est pas un export Vigie (format vigie-export, version 1).");
    for (const k of ['categories', 'holdings', 'valuations', 'fx_rates']) if (!Array.isArray(d[k])) fail(400, 'invalid_import', `Section ${k} manquante.`);
    const base = currency(d.settings?.base_currency || 'EUR');
    const backup = createBackup(db, paths.backups, 'avantimport');
    transaction(db, () => {
      db.exec('DELETE FROM valuations; DELETE FROM holdings; DELETE FROM categories; DELETE FROM fx_rates;');
      const now = Date.now();
      for (const c of d.categories) {
        db.prepare('INSERT INTO categories (id, name, kind, description, default_liquidity, target_pct, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(intId(c.id), text(c.name, 'Catégorie', { required: true, max: 60 }), oneOf(c.kind, ['asset', 'liability'], 'Type'), text(c.description || '', 'Description', { max: 120 }),
            oneOf(c.default_liquidity || 'immediate', LIQUIDITY, 'Liquidité'), targetPct(c.target_pct), Number(c.sort_order) || 0, now);
      }
      for (const h of d.holdings) {
        if (h.closed_at && !isIsoDate(h.closed_at)) fail(400, 'invalid_import', `Date de clôture invalide pour ${h.name}.`);
        db.prepare('INSERT INTO holdings (id, category_id, name, institution, owner, currency, liquidity, notes, closed_at, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(intId(h.id), intId(h.category_id), text(h.name, 'Avoir', { required: true, max: 80 }), text(h.institution || '', 'Établissement', { max: 80 }), text(h.owner || '', 'Titulaire', { max: 40 }),
            currency(h.currency), oneOf(h.liquidity, LIQUIDITY, 'Liquidité'), longText(h.notes || '', 'Notes'), h.closed_at || null, Number(h.sort_order) || 0, now, now);
      }
      for (const v of d.valuations) {
        if (!isIsoDate(v.valued_at) || !Number.isInteger(v.amount_cents)) fail(400, 'invalid_import', 'Valeur historique invalide.');
        db.prepare('INSERT INTO valuations (holding_id, valued_at, amount_cents, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(intId(v.holding_id), v.valued_at, v.amount_cents, text(v.note || '', 'Note', { max: 120 }), ctx.user.id, now);
      }
      for (const r of d.fx_rates) {
        const c = currency(r.currency);
        if (c === base || !(r.rate > 0)) continue;
        db.prepare('INSERT INTO fx_rates (currency, rate, source, updated_at) VALUES (?, ?, ?, ?)').run(c, Number(r.rate), String(r.source || 'import').slice(0, 40), Number(r.updated_at) || now);
      }
      setSetting(db, 'base_currency', base);
      if (Number.isInteger(d.settings?.stale_days)) setSetting(db, 'stale_days', d.settings.stale_days);
      if (Array.isArray(d.settings?.owners)) saveOwners(d.settings.owners.filter((x) => typeof x === 'string' && x.trim()).map((x) => ownerName(x)));
    });
    audit(ctx, 'import', `${d.holdings.length} avoir(s), ${d.valuations.length} valeur(s) ; sauvegarde préalable ${backup.name}`);
    return { ok: true, backup: backup.name, holdings: d.holdings.length, valuations: d.valuations.length };
  });

  router.get('/api/admin/backups', { auth: 'admin' }, () => ({ backups: listBackups(paths.backups), keep_days: cfg.BACKUP_KEEP_DAYS, hour: cfg.BACKUP_HOUR }));

  router.post('/api/admin/backups', { auth: 'admin' }, (ctx) => {
    const b = createBackup(db, paths.backups, 'manuelle');
    pruneBackups(paths.backups, cfg.BACKUP_KEEP_DAYS);
    audit(ctx, 'sauvegarde', b.name);
    return { backup: b };
  });

  router.get('/api/admin/backups/:name', { auth: 'admin' }, (ctx) => {
    const name = ctx.params.name;
    if (!BACKUP_NAME.test(name)) fail(400, 'invalid_field', 'Nom de sauvegarde invalide.');
    const full = path.join(paths.backups, name);
    if (!fs.existsSync(full)) fail(404, 'not_found', 'Sauvegarde introuvable.');
    audit(ctx, 'sauvegarde_telechargee', name);
    ctx.sendRaw(200, fs.readFileSync(full), 'application/vnd.sqlite3', name);
  });
}
