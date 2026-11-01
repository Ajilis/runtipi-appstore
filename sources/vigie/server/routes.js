// Routes de l'API JSON.
import fs from 'node:fs';
import path from 'node:path';
import { fail, readJson } from './http.js';
import { transaction, getSetting, setSetting, seedCategories, schemaVersion, CATEGORY_ICONS } from './db.js';
import {
  hashPassword, verifyPassword, passwordProblem, encrypt, decrypt, generateTotpSecret, verifyTotp,
  otpauthUri, generateRecoveryCodes, normalizeRecoveryCode, sha256, randomToken,
} from './security.js';
import { ROLES, publicUser, getDummyHash, isPrivateIp, cameThroughCloudflare, isHttps } from './auth.js';
import { sendMail, buildMessage, templates, isEmail, SmtpError, SECURITY_MODES } from './mail.js';
import {
  LIQUIDITY, dashboard, history, holdingsView, loadState, holdingSnapshot, parseAmountToCents, isIsoDate, todayIso, addDays,
} from './portfolio.js';
import { fetchEcbRates, ratesToBase } from './fx.js';
import { createBackup, listBackups, pruneBackups, BACKUP_NAME } from './backup.js';
import { TRANSPARENT_PNG, CUSTOM_KEY, sniffImage, imageSize } from './logos.js';
import { LOAN_KINDS, amortization, loanSummary, loanValuations } from './loans.js';
import { isRealEstateCategory, latentGain, ownedCents, ownershipBasisPoints, REAL_ESTATE_TYPES, REAL_ESTATE_CONDITIONS, EstimateError } from './real-estate.js';

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

// Adresse e-mail en minuscules ; '' ou null si facultative et vide.
function emailField(value, { required = false, label = 'Adresse e-mail' } = {}) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) { if (required) fail(400, 'invalid_field', `${label} : champ obligatoire.`); return null; }
  if (!isEmail(v)) fail(400, 'invalid_field', `${label} : adresse invalide, par exemple prenom@exemple.fr.`);
  return v;
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
  const { db, cfg, sessions, ipLimiter, challenges, paths, log, logos, institutions, estimator, securitySettings } = deps;

  const audit = (ctx, action, detail = '') => {
    db.prepare('INSERT INTO audit_log (at, user_id, username, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
      .run(Date.now(), ctx.user ? ctx.user.id : null, ctx.user ? ctx.user.username : (ctx.auditName || null), action, String(detail).slice(0, 500), ctx.ip);
  };
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const setupAllowed = (req, ip) => cfg.ALLOW_SETUP_THROUGH_TUNNEL || (!cameThroughCloudflare(req) && isPrivateIp(ip));
  const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

  // --- E-mails : réglages SMTP (mot de passe chiffré au repos), envoi d'un modèle ----------------------------------
  function mailSettings() {
    try { const v = JSON.parse(getSetting(db, 'mail', 'null')); return v && v.host ? v : null; } catch { return null; }
  }
  function mailConf(s = mailSettings()) {
    if (!s) return null;
    let password = '';
    if (s.password_enc) { try { password = decrypt(cfg.APP_SECRET, s.password_enc); } catch { password = ''; } }
    let helloName = 'localhost';
    try { const h = new URL(s.public_url).hostname; if (/[a-z]/i.test(h) && h.includes('.')) helloName = h; } catch { /* adresse absente */ }
    return { host: s.host, port: s.port, security: s.security, username: s.username || '', password, from_address: s.from_address,
      from_name: s.from_name || 'Vigie Patrimoine', allow_invalid_cert: Boolean(s.allow_invalid_cert), hello_name: helloName };
  }
  // Les liens envoyés par e-mail utilisent toujours l'adresse enregistrée, jamais l'en-tête Host de la requête.
  function mailReady() { const s = mailSettings(); return Boolean(s && s.public_url); }
  async function deliver(to, kind, data, conf = mailConf()) {
    if (!conf) fail(409, 'mail_not_configured', "L'envoi d'e-mails n'est pas configuré : Réglages → Envoi d'e-mails.");
    const t = templates[kind](data);
    const raw = buildMessage({ fromAddress: conf.from_address, fromName: conf.from_name, to, subject: t.subject, text: t.text, html: t.html });
    return sendMail(conf, { to, raw });
  }
  function maskEmail(email) {
    const [local, domain] = String(email || '').split('@');
    return domain ? `${local.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(6, local.length - 1)))}@${domain}` : '';
  }
  function assertEmailFree(email, exceptUserId = 0) {
    if (email && db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(email, exceptUserId)) fail(409, 'email_taken', 'Un autre utilisateur a déjà cette adresse e-mail.');
  }
  // Avertit l'utilisateur d'un changement de mot de passe, sans faire attendre ni échouer la requête.
  function notifyPasswordChanged(ctx, user, how) {
    if (!user.email || !mailSettings()) return;
    deliver(user.email, 'passwordChanged', { firstName: user.first_name, username: user.username, ip: ctx.ip, at: Date.now(), how })
      .catch((err) => log.warn(`Avis de changement de mot de passe non envoyé à ${maskEmail(user.email)} : ${err.message}`));
  }
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
      logos_enabled: cfg.INSTITUTION_LOGOS,
      password_reset: mailReady(),
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

  router.patch('/api/account', { auth: 'viewer', allowWithout2fa: true }, async (ctx) => {
    const p = personFields(ctx.body, ctx.user);
    let email = ctx.user.email || null;
    if (ctx.body.email !== undefined && emailField(ctx.body.email) !== email) {
      // Changer d'adresse permet de recevoir un lien de réinitialisation : le mot de passe actuel est exigé.
      if (!(await verifyPassword(String(ctx.body.current_password || ''), ctx.user.password_hash))) fail(400, 'wrong_password', "Mot de passe actuel incorrect : il est demandé pour changer d'adresse e-mail.");
      email = emailField(ctx.body.email);
      assertEmailFree(email, ctx.user.id);
      audit(ctx, 'email_modifie', email ? `Nouvelle adresse ${maskEmail(email)}` : 'Adresse retirée');
    }
    db.prepare('UPDATE users SET display_name = ?, first_name = ?, last_name = ?, email = ? WHERE id = ?').run(p.display_name, p.first_name, p.last_name, email, ctx.user.id);
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
    notifyPasswordChanged(ctx, ctx.user, 'account');
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

  // --- Partage immobilier entre comptes du même serveur --------------------------------------------
  // Le patrimoine est un registre partagé par les comptes, pas un espace privé
  // par utilisateur. Une seule fiche, des droits distincts, consentement exprès.
  const SHARE_TTL = 7 * 86400_000;
  const shareRow = db.prepare(`SELECT s.*, h.name AS property_name, u.display_name AS sender_name,
    r.display_name AS recipient_name, r.email AS recipient_email
    FROM real_estate_shares s JOIN holdings h ON h.id = s.holding_id
    LEFT JOIN users u ON u.id = s.sender_id
    JOIN users r ON r.id = s.recipient_id WHERE s.id = ?`);
  const sumReserved = db.prepare(`SELECT COALESCE(SUM(ownership_bp),0) AS bp FROM real_estate_shares
    WHERE holding_id = ? AND declined_at IS NULL AND revoked_at IS NULL
    AND (accepted_at IS NOT NULL OR expires_at > ?)`);
  const sumAccepted = db.prepare(`SELECT COALESCE(SUM(ownership_bp),0) AS bp FROM real_estate_shares
    WHERE holding_id = ? AND accepted_at IS NOT NULL AND declined_at IS NULL AND revoked_at IS NULL`);
  const shareStatus = (r, now = Date.now()) => r.revoked_at ? 'revoked' : r.declined_at ? 'declined'
    : r.accepted_at ? 'accepted' : r.expires_at <= now ? 'expired' : 'pending';
  function shareView(row) {
    return { id: row.id, holding_id: row.holding_id, property_name: row.property_name,
      sender_name: row.sender_name, recipient_id: row.recipient_id, recipient_name: row.recipient_name,
      ownership_bp: row.ownership_bp, status: shareStatus(row), created_at: row.created_at,
      expires_at: row.expires_at, accepted_at: row.accepted_at, sent_at: row.sent_at };
  }
  function shareProperty(holdingId) {
    const h = db.prepare(`SELECT h.id, h.name, p.ownership_bp FROM holdings h
      JOIN real_estate p ON p.holding_id = h.id WHERE h.id = ?`).get(holdingId);
    if (!h) fail(404, 'not_found', 'Bien immobilier introuvable.');
    return h;
  }
  router.get('/api/property-shares/recipients', { auth: 'admin' }, (ctx) => ({
    recipients: db.prepare(`SELECT id, display_name, email FROM users
      WHERE id <> ? AND disabled = 0 AND email IS NOT NULL AND email <> '' ORDER BY display_name`).all(ctx.user.id),
    mail_ready: Boolean(mailReady() && mailConf()),
  }));
  router.get('/api/property-shares/inbox', { auth: 'viewer' }, (ctx) => ({
    invitations: db.prepare(`SELECT s.id FROM real_estate_shares s
      WHERE s.recipient_id = ? AND s.declined_at IS NULL AND s.revoked_at IS NULL
      AND s.accepted_at IS NULL AND s.expires_at > ? ORDER BY s.created_at DESC`)
      .all(ctx.user.id, Date.now()).map((r) => shareView(shareRow.get(r.id))),
    accepted: db.prepare(`SELECT s.id FROM real_estate_shares s
      WHERE s.recipient_id = ? AND s.accepted_at IS NOT NULL AND s.revoked_at IS NULL
      ORDER BY s.accepted_at DESC`).all(ctx.user.id).map((r) => shareView(shareRow.get(r.id))),
  }));
  router.get('/api/holdings/:id/shares', { auth: 'viewer' }, (ctx) => {
    const id = intId(ctx.params.id);
    const property = shareProperty(id);
    const list = db.prepare('SELECT id FROM real_estate_shares WHERE holding_id = ? ORDER BY created_at DESC').all(id);
    const reserved = sumReserved.get(id, Date.now()).bp;
    return { holding_id: id, ownership_bp: property.ownership_bp,
      available_bp: Math.max(0, 10000 - property.ownership_bp - reserved),
      accepted_bp: sumAccepted.get(id).bp, shares: list.map((r) => shareView(shareRow.get(r.id))) };
  });

  router.post('/api/holdings/:id/shares', { auth: 'admin' }, async (ctx) => {
    const id = intId(ctx.params.id);
    const property = shareProperty(id);
    const targetId = intId(ctx.body.recipient_id, 'Destinataire');
    if (targetId === ctx.user.id) fail(400, 'invalid_field', 'Choisissez un autre utilisateur.');
    const recipient = getUser(targetId);
    if (!recipient || recipient.disabled || !recipient.email)
      fail(400, 'invalid_field', 'Choisissez un compte actif possédant une adresse e-mail.');
    if (!mailReady() || !mailConf()) fail(409, 'mail_not_configured',
      'Configurez le serveur SMTP et une URL publique dans Réglages → Envoi d’e-mails avant le partage.');
    // Permet la proposition automatique du complément à 100 %, mais ne
    // transmet pas une quote-part nulle ou supérieure aux parts disponibles.
    const reserved = sumReserved.get(id, Date.now()).bp;
    const complement = 10000 - property.ownership_bp - reserved;
    const pct = ctx.body.ownership_pct === undefined || ctx.body.ownership_pct === null || ctx.body.ownership_pct === ''
      ? complement : ownershipBasisPoints(ctx.body.ownership_pct);
    if (pct === null || pct < 1 || pct > complement)
      fail(400, 'invalid_field', 'Quote-part proposée invalide ou supérieure au complément disponible (' + (complement / 100) + ' %).');
    const now = Date.now();
    const invitationId = transaction(db, () => {
      // Libérer les invitations expirées avant l'index d'unicité.
      db.prepare(`UPDATE real_estate_shares SET revoked_at = ?
        WHERE holding_id = ? AND accepted_at IS NULL AND declined_at IS NULL
        AND revoked_at IS NULL AND expires_at <= ?`).run(now, id, now);
      const fresh = shareProperty(id);
      const left = 10000 - fresh.ownership_bp - sumReserved.get(id, now).bp;
      if (pct > left) fail(409, 'share_capacity', 'La quote-part disponible a changé. Rechargez la fiche.');
      if (db.prepare(`SELECT 1 FROM real_estate_shares WHERE holding_id = ? AND recipient_id = ?
          AND declined_at IS NULL AND revoked_at IS NULL`).get(id, targetId))
        fail(409, 'already_shared', 'Ce compte a déjà un partage en attente ou accepté sur ce bien.');
      const r = db.prepare(`INSERT INTO real_estate_shares
        (holding_id, sender_id, recipient_id, ownership_bp, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, ctx.user.id, targetId, pct, now, now + SHARE_TTL);
      return Number(r.lastInsertRowid);
    });
    const url = String(mailSettings().public_url).replace(/\/$/, '') + '/#/partages';
    try {
      await deliver(recipient.email, 'propertyShare', {
        firstName: recipient.first_name, inviter: ctx.user.display_name,
        propertyName: property.name, ownershipPct: pct / 100, url, expiresAt: now + SHARE_TTL,
      });
    } catch (err) {
      db.prepare('DELETE FROM real_estate_shares WHERE id = ? AND accepted_at IS NULL').run(invitationId);
      if (err instanceof SmtpError) fail(502, 'smtp_error', 'Demande non envoyée : ' + err.message);
      throw err;
    }
    db.prepare('UPDATE real_estate_shares SET sent_at = ? WHERE id = ?').run(Date.now(), invitationId);
    audit(ctx, 'partage_immobilier_envoye', property.name + ' : ' + (pct / 100) + ' % à ' + recipient.display_name);
    return { invitation: shareView(shareRow.get(invitationId)), sent: true };
  });

  router.post('/api/property-shares/:id/decision', { auth: 'viewer' }, (ctx) => {
    const id = intId(ctx.params.id);
    const decision = oneOf(ctx.body.decision, ['accept', 'decline'], 'Décision');
    const data = transaction(db, () => {
      const row = shareRow.get(id);
      if (!row || row.recipient_id !== ctx.user.id) fail(404, 'not_found', 'Proposition de partage introuvable.');
      if (shareStatus(row) !== 'pending') fail(409, 'share_inactive', 'Cette proposition est déjà traitée ou a expiré.');
      const now = Date.now();
      if (decision === 'accept') {
        const property = shareProperty(row.holding_id);
        const total = sumAccepted.get(row.holding_id).bp;
        if (property.ownership_bp + total + row.ownership_bp > 10000)
          fail(409, 'share_capacity', 'Les quote-parts dépasseraient 100 %. Contactez l’administrateur.');
        db.prepare('UPDATE real_estate_shares SET accepted_at = ? WHERE id = ?').run(now, id);
      } else db.prepare('UPDATE real_estate_shares SET declined_at = ? WHERE id = ?').run(now, id);
      return shareView(shareRow.get(id));
    });
    audit(ctx, decision === 'accept' ? 'partage_immobilier_accepte' : 'partage_immobilier_refuse',
      data.property_name + ' : ' + (data.ownership_bp / 100) + ' %');
    return { invitation: data, ok: true };
  });

  router.delete('/api/property-shares/:id', { auth: 'viewer' }, (ctx) => {
    const id = intId(ctx.params.id);
    const data = transaction(db, () => {
      const row = shareRow.get(id);
      if (!row || (ctx.user.role !== 'admin' && row.recipient_id !== ctx.user.id))
        fail(404, 'not_found', 'Partage introuvable.');
      if (shareStatus(row) !== 'accepted' && shareStatus(row) !== 'pending')
        fail(409, 'share_inactive', 'Ce partage n’est plus actif.');
      db.prepare('UPDATE real_estate_shares SET revoked_at = ? WHERE id = ?').run(Date.now(), id);
      return shareView(shareRow.get(id));
    });
    audit(ctx, 'partage_immobilier_revoque', data.property_name + ' : ' + (data.ownership_bp / 100) + ' %');
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
    const today = todayIso();
    const state = loadState(db, today);
    const snap = holdingSnapshot(state, h);
    let valuations = db.prepare(`SELECT v.id, v.valued_at, v.amount_cents, v.note, v.created_at, u.display_name AS created_by
      FROM valuations v LEFT JOIN users u ON u.id = v.created_by WHERE v.holding_id = ? ORDER BY v.valued_at DESC`).all(id);
    const sched = state.schedules.get(id);
    let schedule = null;
    if (sched) {
      valuations = [...valuations.filter((v) => v.valued_at < sched.start_date), ...loanValuations(sched, today).map((v) => ({ ...v, id: null }))]
        .sort((a, b) => (a.valued_at < b.valued_at ? 1 : -1));
      schedule = { ...loanSummary(sched, today), rows: amortization(sched) };
    }
    const property = db.prepare('SELECT * FROM real_estate WHERE holding_id = ?').get(id) || null;
    return { holding: { ...h, value_cents: snap.cents, owned_cents: snap.owned, owner_owned_cents: snap.owner_owned_cents,
      total_ownership_bp: snap.ownership_bp, value_base: snap.base, missing_rate: snap.missingRate },
      property, latent_gain: property ? latentGain(snap.cents, property.purchase_cents, snap.ownership_bp) : null,
      valuations, schedule, base_currency: state.base };
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
      logos_enabled: cfg.INSTITUTION_LOGOS,
      owners: ownersList().map((o) => o.name),
      institutions: db.prepare("SELECT DISTINCT institution FROM holdings WHERE institution IS NOT NULL AND institution <> '' ORDER BY institution").all().map((r) => r.institution),
    };
    if (ctx.user.role === 'admin') {
      out.security = { ...securitySettings.view(),
        backup_hour: cfg.BACKUP_HOUR, backup_keep_days: cfg.BACKUP_KEEP_DAYS };
    }
    return out;
  });

  // Annuaire dynamique, toujours servi depuis le cache SQLite lorsque les sources sont indisponibles.
  router.get('/api/institutions/catalogue', { auth: 'viewer' }, () => ({
    institutions: institutions.list(), enabled: institutions.enabled, last_sync: institutions.lastSync,
  }));
  router.get('/api/institutions/search', { auth: 'viewer' }, async (ctx) => {
    const q = text(ctx.query.get('q'), 'Recherche', { max: 65, min: 3 });
    if (q.length < 3) fail(400, 'invalid_field', 'Saisissez trois caractères au minimum.');
    return { institutions: await institutions.search(q) };
  });

  // --- Logos des établissements ----------------------------------------------------------------------------------
  router.get('/api/institutions/logos', { auth: 'viewer' }, () => ({ enabled: cfg.INSTITUTION_LOGOS, versions: logos.versions() }));

  router.get('/api/institutions/logo/:id', { auth: 'viewer' }, async (ctx) => {
    if (!/^[a-z0-9-]{1,90}$/.test(ctx.params.id)) fail(404, 'not_found', 'Établissement inconnu.');
    const logo = await logos.get(ctx.params.id);
    if (logo === undefined) fail(404, 'not_found', 'Établissement inconnu.');
    if (logo) ctx.sendBody(200, Buffer.from(logo.data), logo.type, { 'Cache-Control': 'private, max-age=604800' });
    else ctx.sendBody(200, TRANSPARENT_PNG, 'image/png', { 'Cache-Control': 'private, max-age=600' });
  });

  // Clé d'un logo : identifiant du catalogue, ou « perso-nom » pour un établissement hors catalogue.
  const logoKey = (value) => {
    const key = String(value || '');
    if (logos.catalogue.has(key) || CUSTOM_KEY.test(key)) return key;
    return fail(400, 'invalid_field', 'Établissement inconnu.');
  };

  router.get('/api/admin/logos', { auth: 'admin' }, () => ({
    ...logos.status(),
    in_use: db.prepare("SELECT institution AS name, COUNT(*) AS count FROM holdings WHERE institution <> '' GROUP BY institution ORDER BY institution").all().map((r) => ({ ...r })),
  }));

  router.post('/api/admin/logos/fetch', { auth: 'admin' }, async (ctx) => {
    if (!cfg.INSTITUTION_LOGOS) fail(409, 'disabled', 'La récupération des logos est désactivée (INSTITUTION_LOGOS=false dans data/config/vigie.env). Vous pouvez déposer vos propres images.');
    if (ctx.body.id) {
      const id = logoKey(ctx.body.id);
      const host = logos.hostOf(id);
      if (!host) fail(400, 'no_site', "Aucun site officiel connu pour cet établissement : déposez votre propre image.");
      const wait = new Promise((r) => { const t = setTimeout(() => r('pending'), 25_000); t.unref?.(); });
      const logo = await Promise.race([logos.refresh(host), wait]);
      const name = logos.catalogue.get(id).name;
      audit(ctx, 'logo_recherche', `${name} : ${logo === 'pending' ? 'en cours' : logo ? `trouvé (${logo.width || '?'} × ${logo.height || '?'} px)` : 'introuvable'}`);
      return { id, status: logo === 'pending' ? 'fetching' : logo ? 'ok' : 'failed', width: logo && logo !== 'pending' ? logo.width : null, height: logo && logo !== 'pending' ? logo.height : null };
    }
    const batch = logos.prefetchAll({ includeFailed: true });
    audit(ctx, 'logos_recherche', `${batch.total} établissement(s) à rechercher`);
    return { started: true, total: batch.total, done: batch.done };
  });

  router.post('/api/admin/logos/retry', { auth: 'admin' }, (ctx) => {
    const n = logos.clearFailures();
    audit(ctx, 'logos_reessai', `${n} établissement(s) sans logo seront réessayés`);
    return { cleared: n };
  });

  router.put('/api/admin/logos/:key', { auth: 'admin', bodyLimit: 1024 * 1024 }, (ctx) => {
    const key = logoKey(ctx.params.key);
    const entry = logos.catalogue.get(key);
    const name = text(entry ? entry.name : ctx.body.name, 'Établissement', { required: true, max: 80 });
    if (typeof ctx.body.data !== 'string' || !ctx.body.data || ctx.body.data.length > 700_000) fail(400, 'invalid_image', 'Image trop lourde : 500 Ko au maximum.');
    const buf = Buffer.from(ctx.body.data, 'base64');
    const type = sniffImage(buf);
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) fail(400, 'invalid_image', 'Format refusé : image PNG, JPEG, WebP ou GIF attendue.');
    const size = imageSize(buf, type);
    if (!size || size.width < 16 || size.height < 16 || size.width > 1024 || size.height > 1024) fail(400, 'invalid_image', 'Image de 16 à 1024 pixels de côté attendue.');
    const saved = logos.setCustom(key, name, buf, ctx.user.id);
    audit(ctx, 'logo_personnalise', `${name} (${size.width} × ${size.height} px)`);
    return { key, version: `c${saved.updated_at}` };
  });

  router.delete('/api/admin/logos/:key', { auth: 'admin' }, (ctx) => {
    const key = logoKey(ctx.params.key);
    const own = logos.custom(key);
    if (!own) fail(404, 'not_found', 'Aucune image personnalisée pour cet établissement.');
    logos.removeCustom(key);
    audit(ctx, 'logo_retire', own.name);
    return { ok: true };
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
    const icon = oneOf(b.icon ?? existing.icon ?? (kind === 'liability' ? 'loanDoc' : 'cube'), CATEGORY_ICONS, 'Pictogramme');
    return { name, kind, description, liquidity, target, icon };
  }

  router.post('/api/categories', { auth: 'editor' }, (ctx) => {
    const f = categoryFields(ctx.body);
    const order = (db.prepare('SELECT MAX(sort_order) AS m FROM categories').get().m || 0) + 10;
    const r = db.prepare('INSERT INTO categories (name, kind, description, default_liquidity, target_pct, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(f.name, f.kind, f.description, f.liquidity, f.target, f.icon, order, Date.now());
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
    db.prepare('UPDATE categories SET name = ?, kind = ?, description = ?, default_liquidity = ?, target_pct = ?, icon = ? WHERE id = ?')
      .run(f.name, f.kind, f.description, f.liquidity, f.target, f.icon, id);
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

  // L'estimation reste une simple proposition, l'utilisateur doit enregistrer la valeur.
  // Aucune donnée de montant d'achat ou d'avoirs n'est transmise à l'API externe.
  router.post('/api/real-estate/estimate', { auth: 'editor' }, async (ctx) => {
    try { return await estimator.estimate(ctx.body); }
    catch (err) {
      if (err instanceof EstimateError) fail(err.status, 'estimate_unavailable', err.message);
      throw err;
    }
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

  const saveProperty = db.prepare(`INSERT INTO real_estate
    (holding_id,purchase_cents,purchased_at,property_type,address,surface_m2,condition,ownership_bp,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(holding_id) DO UPDATE SET purchase_cents=excluded.purchase_cents,
    purchased_at=excluded.purchased_at,property_type=excluded.property_type,address=excluded.address,
    surface_m2=excluded.surface_m2,condition=excluded.condition,ownership_bp=excluded.ownership_bp,updated_at=excluded.updated_at`);

  function propertyFields(b, cat, currencyCode, holdingId = null) {
    if (b.property === undefined || b.property === null) return null;
    if (!isRealEstateCategory(cat)) fail(400, 'invalid_field', 'Ces informations sont réservées aux biens immobiliers.');
    if (typeof b.property !== 'object' || Array.isArray(b.property)) fail(400, 'invalid_field', 'Caractéristiques immobilières invalides.');
    const p = b.property;
    const purchase = amount(p.purchase_amount, "Prix d'achat");
    if (purchase <= 0) fail(400, 'invalid_field', "Prix d'achat positif attendu.");
    const date = valuationDate(p.purchased_at);
    if (!p.purchased_at) fail(400, 'invalid_field', "Date d'achat obligatoire.");
    const type = oneOf(p.property_type, REAL_ESTATE_TYPES, 'Type de bien');
    const condition = oneOf(p.condition || 'correct', REAL_ESTATE_CONDITIONS, 'État général');
    const address = text(p.address || '', 'Adresse / commune', { max: 180 });
    const surface = p.surface_m2 === '' || p.surface_m2 === null || p.surface_m2 === undefined
      ? null : Number(p.surface_m2);
    if (surface !== null && (!Number.isInteger(surface) || surface < 9 || surface > 10000))
      fail(400, 'invalid_field', 'Surface habitable : 9 à 10 000 m².');
    const old = holdingId ? db.prepare('SELECT ownership_bp FROM real_estate WHERE holding_id = ?').get(holdingId)?.ownership_bp : null;
    const ownership = ownershipBasisPoints(p.ownership_pct ?? (old === null || old === undefined ? 100 : old / 100));
    if (ownership === null) fail(400, 'invalid_field', 'Quote-part de propriété : pourcentage de 0,01 à 100, avec 2 décimales maximum.');
    if (holdingId && ownership + sumReserved.get(holdingId, Date.now()).bp > 10000)
      fail(409, 'share_capacity', 'La nouvelle quote-part dépasserait 100 % avec les partages en attente ou acceptés. Révoquez un partage avant de modifier ce pourcentage.');
    return { purchase, date, type, condition, address, surface, ownership };
  }
  function writeProperty(id, p) {
    saveProperty.run(id, p.purchase, p.date, p.type, p.address, p.surface, p.condition, p.ownership, Date.now());
  }

  // --- Échéancier de prêt ---------------------------------------------------------------------------------------
  function parseSchedule(v) {
    if (v === null) return null;
    if (typeof v !== 'object' || Array.isArray(v)) fail(400, 'invalid_field', 'Échéancier invalide.');
    const kind = oneOf(v.kind || 'amortizing', LOAN_KINDS, 'Type de remboursement');
    const principal = amount(v.principal, 'Montant du prêt');
    if (principal <= 0) fail(400, 'invalid_field', 'Montant du prêt : nombre positif attendu.');
    const rate = typeof v.rate === 'number' ? v.rate : Number(String(v.rate ?? '').replace(/[%\s]/g, '').replace(',', '.'));
    if (String(v.rate ?? '').trim() === '' || !Number.isFinite(rate) || rate < 0 || rate > 50) fail(400, 'invalid_field', 'Taux annuel : pourcentage entre 0 et 50, par exemple 3,5.');
    const months = Number(v.months);
    if (!Number.isInteger(months) || months < 1 || months > 600) fail(400, 'invalid_field', 'Durée : nombre de mois entre 1 et 600.');
    if (!isIsoDate(v.start_date) || v.start_date < '1950-01-01' || v.start_date > todayIso()) fail(400, 'invalid_field', 'Date du versement : date passée ou du jour.');
    return { kind, principal_cents: principal, annual_rate: Math.round(rate * 1000) / 1000, months, start_date: v.start_date };
  }
  const getSchedule = (id) => db.prepare('SELECT * FROM loan_schedules WHERE holding_id = ?').get(id);
  const saveSchedule = (id, sc) => db.prepare(`INSERT INTO loan_schedules (holding_id, kind, principal_cents, annual_rate, months, start_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(holding_id) DO UPDATE SET kind = excluded.kind, principal_cents = excluded.principal_cents,
    annual_rate = excluded.annual_rate, months = excluded.months, start_date = excluded.start_date, updated_at = excluded.updated_at`)
    .run(id, sc.kind, sc.principal_cents, sc.annual_rate, sc.months, sc.start_date, Date.now(), Date.now());
  // Retour en saisie manuelle : les valeurs calculées deviennent des valeurs enregistrées, rien ne disparaît de l'historique.
  function materializeSchedule(id, userId, until = todayIso()) {
    const sc = getSchedule(id);
    if (!sc) return 0;
    db.prepare('DELETE FROM valuations WHERE holding_id = ? AND valued_at >= ?').run(id, sc.start_date);
    const points = loanValuations(sc, until, until);
    for (const pt of points) upsertValuation.run(id, pt.valued_at, pt.amount_cents, pt.note, userId, Date.now());
    db.prepare('DELETE FROM loan_schedules WHERE holding_id = ?').run(id);
    return points.length;
  }
  const scheduleText = (sc) => `${frNumber(sc.principal_cents)} à ${String(sc.annual_rate).replace('.', ',')} % sur ${sc.months} mois depuis le ${sc.start_date}${sc.kind === 'bullet' ? ', in fine' : ''}`;

  const upsertValuation = db.prepare(`INSERT INTO valuations (holding_id, valued_at, amount_cents, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(holding_id, valued_at) DO UPDATE SET amount_cents = excluded.amount_cents, note = excluded.note, created_by = excluded.created_by, created_at = excluded.created_at`);

  router.post('/api/holdings', { auth: 'editor' }, (ctx) => {
    const f = holdingFields(ctx.body);
    const schedule = ctx.body.schedule ? parseSchedule(ctx.body.schedule) : null;
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(f.category_id);
    const prop = propertyFields(ctx.body, cat, f.currency);
    const hasInitial = !schedule && ctx.body.amount !== undefined && ctx.body.amount !== null && ctx.body.amount !== '';
    const cents = hasInitial ? amount(ctx.body.amount, 'Valeur actuelle') : null;
    const date = valuationDate(ctx.body.date);
    const id = transaction(db, () => {
      const now = Date.now();
      const order = (db.prepare('SELECT MAX(sort_order) AS m FROM holdings WHERE category_id = ?').get(f.category_id).m || 0) + 10;
      const r = db.prepare(`INSERT INTO holdings (category_id, name, institution, owner, currency, liquidity, notes, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.category_id, f.name, f.institution, f.owner, f.currency, f.liquidity, f.notes, order, now, now);
      const newId = Number(r.lastInsertRowid);
      if (cents !== null) upsertValuation.run(newId, date, cents, '', ctx.user.id, now);
      if (schedule) saveSchedule(newId, schedule);
      if (prop) writeProperty(newId, prop);
      return newId;
    });
    audit(ctx, 'avoir_cree', schedule ? `${f.name}, échéancier ${scheduleText(schedule)}` : f.name);
    return { id };
  });

  router.patch('/api/holdings/:id', { auth: 'editor' }, (ctx) => {
    const id = intId(ctx.params.id);
    const existing = db.prepare('SELECT * FROM holdings WHERE id = ?').get(id);
    if (!existing) fail(404, 'not_found', 'Avoir introuvable.');
    const f = holdingFields(ctx.body, existing);
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(f.category_id);
    const prop = propertyFields(ctx.body, cat, f.currency, id);
    const amountChange = ctx.body.amount !== undefined && ctx.body.amount !== ''
      ? amount(ctx.body.amount, 'Valeur actuelle') : null;
    const valuationOn = amountChange !== null ? valuationDate(ctx.body.date) : null;
    const scheduleChange = 'schedule' in ctx.body ? parseSchedule(ctx.body.schedule) : undefined;
    const had = getSchedule(id);
    if (scheduleChange && existing.closed_at) fail(409, 'closed', "Rouvrez l'avoir avant de lui associer un échéancier.");
    transaction(db, () => {
      db.prepare('UPDATE holdings SET category_id = ?, name = ?, institution = ?, owner = ?, currency = ?, liquidity = ?, notes = ?, updated_at = ? WHERE id = ?')
        .run(f.category_id, f.name, f.institution, f.owner, f.currency, f.liquidity, f.notes, Date.now(), id);
      if (scheduleChange === null && had) materializeSchedule(id, ctx.user.id);
      else if (scheduleChange) {
        // Nouveau départ (remboursement anticipé, renégociation) : l'historique calculé jusque-là est enregistré.
        if (had && scheduleChange.start_date > had.start_date) materializeSchedule(id, ctx.user.id, addDays(scheduleChange.start_date, -1));
        saveSchedule(id, scheduleChange);
      }
      if (prop) writeProperty(id, prop);
      else if (!isRealEstateCategory(cat)) db.prepare('DELETE FROM real_estate WHERE holding_id = ?').run(id);
      if (amountChange !== null) {
        if (had || scheduleChange) fail(409, 'invalid_field', 'Retirez d’abord l’échéancier avant de saisir une valeur manuelle.');
        // Une modification de la valeur actuelle crée une nouvelle entrée de suivi.
        const current = db.prepare('SELECT amount_cents FROM valuations WHERE holding_id = ? ORDER BY valued_at DESC LIMIT 1').get(id);
        if (!current || current.amount_cents !== amountChange)
          upsertValuation.run(id, valuationOn, amountChange, '', ctx.user.id, Date.now());
      }
    });
    audit(ctx, 'avoir_modifie', f.name);
    if (scheduleChange) audit(ctx, 'echeancier_defini', `${f.name} : ${scheduleText(scheduleChange)}`);
    else if (scheduleChange === null && had) audit(ctx, 'echeancier_retire', `${f.name} : retour en saisie manuelle, valeurs calculées conservées`);
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
      materializeSchedule(id, ctx.user.id, date);
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
    if (getSchedule(id)) fail(409, 'scheduled', "Cet avoir suit un échéancier automatique : modifiez l'échéancier ou repassez en saisie manuelle.");
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
      if (getSchedule(hid)) fail(400, 'scheduled', `Ligne ${i + 1} : cet avoir suit un échéancier automatique.`);
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

  // Paramètres de protection effectifs immédiatement, persistés dans SQLite.
  // Le secret Runtipi et les garde-fous 2FA externes ne sont pas modifiables par l'interface.
  router.put('/api/admin/security', { auth: 'admin' }, async (ctx) => {
    if (!(await verifyPassword(String(ctx.body.current_password || ''), ctx.user.password_hash)))
      fail(403, 'wrong_password', 'Mot de passe administrateur incorrect.');
    const changes = { ...ctx.body };
    delete changes.current_password;
    let result;
    try { result = securitySettings.update(changes); }
    catch (err) {
      if (err instanceof TypeError || err instanceof RangeError)
        fail(400, 'invalid_field', err.message);
      throw err;
    }
    audit(ctx, 'securite_modifiee', result.changes.join(', '));
    return { ok: true, ...result, needs_2fa_setup: cfg.REQUIRE_2FA && !ctx.user.totp_enabled };
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
    const email = emailField(ctx.body.email);
    assertEmailFree(email);
    const hash = await hashPassword(ctx.body.password);
    const now = Date.now();
    const r = db.prepare('INSERT INTO users (username, display_name, first_name, last_name, email, password_hash, role, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uname, person.display_name, person.first_name, person.last_name, email, hash, role, now, now);
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
    const email = ctx.body.email !== undefined ? emailField(ctx.body.email) : u.email;
    if (email !== u.email) assertEmailFree(email, id);
    db.prepare(`UPDATE users SET display_name = ?, first_name = ?, last_name = ?, email = ?, role = ?, disabled = ?${unlock ? ', locked_until = NULL, failed_attempts = 0' : ''} WHERE id = ?`)
      .run(person.display_name, person.first_name, person.last_name, email, role, disabled, id);
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

  // --- Envoi d'e-mails (administrateur) ------------------------------------------------------------------------------
  const requestOrigin = (req) => `${isHttps(req) ? 'https' : 'http'}://${String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim()}`;
  function publicUrl(value) {
    const s = String(value || '').trim().replace(/\/+$/, '');
    let u = null;
    try { u = new URL(s); } catch { /* invalide */ }
    if (!u || !['http:', 'https:'].includes(u.protocol) || u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
      fail(400, 'invalid_field', 'Adresse de Vigie : adresse complète attendue, par exemple https://patrimoine.exemple.fr');
    }
    return u.origin;
  }
  // Réglages SMTP saisis : validés, mot de passe repris de la configuration enregistrée s'il n'est pas fourni.
  function mailFields(b, stored = mailSettings()) {
    const host = String(b.host || '').trim().toLowerCase();
    if (!/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) fail(400, 'invalid_field', 'Serveur SMTP : nom de serveur attendu, par exemple smtp.exemple.fr.');
    const port = Number(b.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail(400, 'invalid_field', 'Port : nombre entre 1 et 65535 (587, 465 ou 25 en général).');
    const security = oneOf(b.security, SECURITY_MODES, 'Sécurité');
    const user = typeof b.username === 'string' ? b.username.trim() : '';
    if (user.length > 200 || /[\r\n\0]/.test(user)) fail(400, 'invalid_field', 'Identifiant : 200 caractères au maximum.');
    if (b.password !== undefined && b.password !== null && (typeof b.password !== 'string' || b.password.length > 500 || /[\r\n\0]/.test(b.password))) fail(400, 'invalid_field', 'Mot de passe SMTP invalide.');
    let passwordEnc = stored && stored.password_enc ? stored.password_enc : null;
    if (typeof b.password === 'string' && b.password !== '') passwordEnc = encrypt(cfg.APP_SECRET, b.password);
    if (b.clear_password === true || !user) passwordEnc = null;
    return {
      host, port, security, username: user, password_enc: passwordEnc,
      from_address: emailField(b.from_address, { required: true, label: "Adresse d'expédition" }),
      from_name: text(b.from_name || 'Vigie Patrimoine', "Nom de l'expéditeur", { max: 80 }),
      public_url: publicUrl(b.public_url),
      allow_invalid_cert: b.allow_invalid_cert === true,
    };
  }
  const mailView = (s) => (s ? { host: s.host, port: s.port, security: s.security, username: s.username, password_set: Boolean(s.password_enc), from_address: s.from_address,
    from_name: s.from_name, public_url: s.public_url, allow_invalid_cert: s.allow_invalid_cert, updated_at: s.updated_at } : null);

  router.get('/api/admin/mail', { auth: 'admin' }, (ctx) => ({ settings: mailView(mailSettings()), suggested_public_url: requestOrigin(ctx.req) }));

  router.put('/api/admin/mail', { auth: 'admin' }, (ctx) => {
    const s = { ...mailFields(ctx.body), updated_at: Date.now() };
    setSetting(db, 'mail', JSON.stringify(s));
    audit(ctx, 'email_reglages', `${s.host}:${s.port} (${s.security}), expéditeur ${s.from_address}`);
    return { settings: mailView(s) };
  });

  router.delete('/api/admin/mail', { auth: 'admin' }, (ctx) => {
    db.prepare("DELETE FROM settings WHERE key = 'mail'").run();
    audit(ctx, 'email_desactive', "Envoi d'e-mails désactivé");
    return { ok: true };
  });

  // Test d'envoi avec les réglages saisis (même non enregistrés) ou, à défaut, enregistrés.
  router.post('/api/admin/mail/test', { auth: 'admin' }, async (ctx) => {
    const to = emailField(ctx.body.to, { required: true, label: 'Destinataire du test' });
    const s = ctx.body.host ? mailFields(ctx.body) : mailSettings();
    if (!s) fail(409, 'mail_not_configured', "Renseignez d'abord le serveur SMTP.");
    try {
      const r = await deliver(to, 'test', { host: s.host, port: s.port, security: s.security, by: ctx.user.display_name, at: Date.now() }, mailConf(s));
      audit(ctx, 'email_test', `Envoyé à ${to} par ${s.host}:${s.port}`);
      return { ok: true, to, response: r.response };
    } catch (err) {
      if (!(err instanceof SmtpError)) throw err;
      audit(ctx, 'email_test', `Échec vers ${to} par ${s.host}:${s.port} : ${err.message}`);
      return fail(502, 'smtp_error', err.message, { stage: err.stage });
    }
  });

  // --- Invitations par e-mail (administrateur) ------------------------------------------------------------------------
  const INVITE_TTL_MS = 7 * 86400_000;
  const RESET_TTL_MS = 3600_000;
  const linkBase = (ctx) => (mailSettings() || {}).public_url || requestOrigin(ctx.req);
  function invitationView(i) {
    const by = i.invited_by ? getUser(i.invited_by) : null;
    return { id: i.id, email: i.email, first_name: i.first_name, last_name: i.last_name, role: i.role, invited_by: by ? by.display_name : null,
      created_at: i.created_at, expires_at: i.expires_at, sent_at: i.sent_at, status: i.expires_at < Date.now() ? 'expired' : 'pending' };
  }
  // Nouveau jeton (l'ancien lien cesse de fonctionner), puis envoi éventuel. Renvoie le lien.
  async function issueInvitation(ctx, inv, send) {
    const token = randomToken(32);
    const now = Date.now();
    db.prepare('UPDATE invitations SET token_hash = ?, expires_at = ?, sent_at = NULL WHERE id = ?').run(sha256(token), now + INVITE_TTL_MS, inv.id);
    const link = `${linkBase(ctx)}/#/invitation/${token}`;
    if (send) {
      await deliver(inv.email, 'invitation', { firstName: inv.first_name, inviter: ctx.user.display_name, role: inv.role, url: link, expiresAt: now + INVITE_TTL_MS });
      db.prepare('UPDATE invitations SET sent_at = ? WHERE id = ?').run(Date.now(), inv.id);
    }
    return link;
  }
  const smtpFail = (err) => (err instanceof SmtpError ? fail(502, 'smtp_error', `E-mail non envoyé : ${err.message}`, { stage: err.stage }) : Promise.reject(err));

  router.get('/api/admin/invitations', { auth: 'admin' }, () => ({
    invitations: db.prepare('SELECT * FROM invitations WHERE accepted_at IS NULL AND canceled_at IS NULL ORDER BY created_at DESC').all().map(invitationView),
    mail_ready: mailReady(),
  }));

  router.post('/api/admin/invitations', { auth: 'admin' }, async (ctx) => {
    const email = emailField(ctx.body.email, { required: true });
    const first = text(ctx.body.first_name, 'Prénom', { max: 60 });
    const last = text(ctx.body.last_name, 'Nom', { max: 60 });
    const role = oneOf(ctx.body.role || 'viewer', ROLES, 'Rôle');
    const send = ctx.body.send !== false;
    assertEmailFree(email);
    if (db.prepare('SELECT 1 FROM invitations WHERE email = ? AND accepted_at IS NULL AND canceled_at IS NULL').get(email)) {
      fail(409, 'already_invited', 'Une invitation est déjà en attente pour cette adresse : renvoyez-la depuis la liste.');
    }
    if (send && !mailSettings()) fail(409, 'mail_not_configured', "L'envoi d'e-mails n'est pas configuré : Réglages → Envoi d'e-mails, ou créez un lien à transmettre vous-même.");
    const now = Date.now();
    const r = db.prepare('INSERT INTO invitations (email, first_name, last_name, role, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(email, first, last, role, sha256(randomToken(32)), ctx.user.id, now, now + INVITE_TTL_MS);
    const inv = db.prepare('SELECT * FROM invitations WHERE id = ?').get(Number(r.lastInsertRowid));
    let link;
    try { link = await issueInvitation(ctx, inv, send); } catch (err) { db.prepare('DELETE FROM invitations WHERE id = ?').run(inv.id); return smtpFail(err); }
    audit(ctx, send ? 'invitation_envoyee' : 'invitation_creee', `${email} (${role})`);
    return { invitation: invitationView(db.prepare('SELECT * FROM invitations WHERE id = ?').get(inv.id)), link, sent: send };
  });

  router.post('/api/admin/invitations/:id/resend', { auth: 'admin' }, async (ctx) => {
    const inv = db.prepare('SELECT * FROM invitations WHERE id = ? AND accepted_at IS NULL AND canceled_at IS NULL').get(intId(ctx.params.id));
    if (!inv) fail(404, 'not_found', 'Invitation introuvable ou déjà utilisée.');
    const send = ctx.body.send !== false;
    if (send && !mailSettings()) fail(409, 'mail_not_configured', "L'envoi d'e-mails n'est pas configuré : Réglages → Envoi d'e-mails.");
    let link;
    try { link = await issueInvitation(ctx, inv, send); } catch (err) { return smtpFail(err); }
    audit(ctx, send ? 'invitation_renvoyee' : 'invitation_lien', inv.email);
    return { invitation: invitationView(db.prepare('SELECT * FROM invitations WHERE id = ?').get(inv.id)), link, sent: send };
  });

  router.delete('/api/admin/invitations/:id', { auth: 'admin' }, (ctx) => {
    const inv = db.prepare('SELECT * FROM invitations WHERE id = ? AND accepted_at IS NULL AND canceled_at IS NULL').get(intId(ctx.params.id));
    if (!inv) fail(404, 'not_found', 'Invitation introuvable ou déjà utilisée.');
    db.prepare('UPDATE invitations SET canceled_at = ? WHERE id = ?').run(Date.now(), inv.id);
    audit(ctx, 'invitation_annulee', inv.email);
    return { ok: true };
  });

  // Lien « Mot de passe oublié » envoyé par l'administrateur à un utilisateur.
  router.post('/api/users/:id/reset-link', { auth: 'admin' }, async (ctx) => {
    const u = getUser(intId(ctx.params.id));
    if (!u) fail(404, 'not_found', 'Utilisateur introuvable.');
    if (!u.email) fail(400, 'no_email', "Cet utilisateur n'a pas d'adresse e-mail : ajoutez-la d'abord.");
    if (u.disabled) fail(400, 'account_disabled', 'Ce compte est désactivé.');
    if (!mailReady()) fail(409, 'mail_not_configured', "L'envoi d'e-mails n'est pas configuré : Réglages → Envoi d'e-mails.");
    try { await sendResetLink(ctx, u); } catch (err) { return smtpFail(err); }
    audit(ctx, 'lien_mot_de_passe', `${u.username}, envoyé à ${maskEmail(u.email)}`);
    return { sent: true, to: u.email };
  });

  // --- Invitation : acceptation (sans connexion) ---------------------------------------------------------------------
  const validToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{30,100}$/.test(t);
  function findInvitation(token) {
    if (!validToken(token)) return null;
    const inv = db.prepare('SELECT * FROM invitations WHERE token_hash = ?').get(sha256(token));
    return inv && !inv.accepted_at && !inv.canceled_at && inv.expires_at >= Date.now() ? inv : null;
  }
  const INVALID_INVITE = "Ce lien d'invitation n'est plus valable : il a expiré, a déjà servi ou a été annulé. Demandez une nouvelle invitation à l'administrateur.";
  function suggestUsername(email) {
    let base = email.split('@')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._-]+/g, '.').replace(/^[._-]+|[._-]+$/g, '').slice(0, 36);
    if (base.length < 3) base = `${base}user`.slice(0, 36);
    let name = base;
    for (let i = 2; db.prepare('SELECT 1 FROM users WHERE username = ?').get(name); i++) name = `${base}${i}`;
    return name;
  }

  router.post('/api/auth/invitation', { auth: 'public' }, (ctx) => {
    ipLimiter.check(ctx.ip);
    const inv = findInvitation(ctx.body.token);
    if (!inv) { ipLimiter.fail(ctx.ip); fail(410, 'invalid_link', INVALID_INVITE); }
    const by = inv.invited_by ? getUser(inv.invited_by) : null;
    return { email: inv.email, first_name: inv.first_name, last_name: inv.last_name, role: inv.role, invited_by: by ? by.display_name : null,
      expires_at: inv.expires_at, suggested_username: suggestUsername(inv.email), require_2fa: cfg.REQUIRE_2FA };
  });

  router.post('/api/auth/invitation/accept', { auth: 'public' }, async (ctx) => {
    ipLimiter.check(ctx.ip);
    if (!findInvitation(ctx.body.token)) { ipLimiter.fail(ctx.ip); fail(410, 'invalid_link', INVALID_INVITE); }
    const uname = username(ctx.body.username);
    const person = personFields(ctx.body);
    const problem = passwordProblem(ctx.body.password);
    if (problem) fail(400, 'weak_password', problem);
    const hash = await hashPassword(ctx.body.password);
    const user = transaction(db, () => {
      const inv = findInvitation(ctx.body.token);
      if (!inv) fail(410, 'invalid_link', INVALID_INVITE);
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(uname)) fail(409, 'username_taken', "Ce nom d'utilisateur est déjà pris : choisissez-en un autre.");
      assertEmailFree(inv.email);
      const now = Date.now();
      const r = db.prepare('INSERT INTO users (username, display_name, first_name, last_name, email, password_hash, role, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uname, person.display_name, person.first_name, person.last_name, inv.email, hash, inv.role, now, now);
      const id = Number(r.lastInsertRowid);
      db.prepare('UPDATE invitations SET accepted_at = ?, user_id = ? WHERE id = ?').run(now, id, inv.id);
      return getUser(id);
    });
    ctx.user = user;
    audit(ctx, 'invitation_acceptee', `${uname} (${user.role}), ${user.email}`);
    return completeLogin(ctx, user);
  });

  // --- Mot de passe oublié (sans connexion) ---------------------------------------------------------------------------
  const forgotByIp = new Map();
  function forgotAllowed(ip) {
    const now = Date.now();
    const e = forgotByIp.get(ip);
    if (!e || e.reset <= now) { forgotByIp.set(ip, { count: 1, reset: now + 15 * 60_000 }); return true; }
    e.count += 1;
    if (forgotByIp.size > 10_000) for (const [k, v] of forgotByIp) if (v.reset <= now) forgotByIp.delete(k);
    return e.count <= 5;
  }
  // Un seul lien valable à la fois par utilisateur ; l'ancien cesse de fonctionner.
  async function sendResetLink(ctx, user) {
    const token = randomToken(32);
    const now = Date.now();
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(user.id);
    db.prepare('INSERT INTO password_resets (user_id, token_hash, created_at, expires_at, ip) VALUES (?, ?, ?, ?, ?)').run(user.id, sha256(token), now, now + RESET_TTL_MS, ctx.ip);
    const url = `${mailSettings().public_url}/#/mot-de-passe/${token}`;
    await deliver(user.email, 'reset', { firstName: user.first_name, username: user.username, url, expiresAt: now + RESET_TTL_MS, ip: ctx.ip, at: now });
  }
  const FORGOT_DONE = "Si un compte actif correspond et possède une adresse e-mail, un lien de réinitialisation vient d'y être envoyé. Il est valable 1 heure.";

  router.post('/api/auth/forgot', { auth: 'public' }, (ctx) => {
    if (!mailReady()) fail(409, 'reset_unavailable', "La réinitialisation par e-mail n'est pas disponible sur ce serveur : demandez à un administrateur de changer votre mot de passe.");
    if (!forgotAllowed(ctx.ip)) fail(429, 'too_many_requests', 'Trop de demandes depuis cette adresse. Réessayez dans quelques minutes.', { retry_after: 900 });
    const login = typeof ctx.body.login === 'string' ? ctx.body.login.trim().slice(0, 254) : '';
    if (!login) fail(400, 'invalid_field', "Indiquez votre nom d'utilisateur ou votre adresse e-mail.");
    ctx.auditName = login.slice(0, 40);
    // Réponse identique et immédiate dans tous les cas : impossible de savoir si un compte existe.
    setImmediate(async () => {
      try {
        const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(login, login.toLowerCase());
        if (!user || !user.email || user.disabled) { audit(ctx, 'mot_de_passe_oublie', 'Aucun compte actif avec adresse e-mail : rien envoyé'); return; }
        const last = db.prepare('SELECT MAX(created_at) AS t FROM password_resets WHERE user_id = ?').get(user.id).t;
        if (last && Date.now() - last < 60_000) { audit({ ...ctx, user }, 'mot_de_passe_oublie', 'Demande répétée en moins d\'une minute : ignorée'); return; }
        await sendResetLink(ctx, user);
        audit({ ...ctx, user }, 'mot_de_passe_oublie', `Lien envoyé à ${maskEmail(user.email)}`);
      } catch (err) {
        log.warn(`Lien « Mot de passe oublié » non envoyé : ${err.message}`);
        try { audit(ctx, 'mot_de_passe_oublie', `Échec de l'envoi : ${err.message}`); } catch { /* base fermée */ }
      }
    });
    return { ok: true, message: FORGOT_DONE };
  });

  function findReset(token) {
    if (!validToken(token)) return null;
    const r = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(token));
    if (!r || r.used_at || r.expires_at < Date.now()) return null;
    const user = getUser(r.user_id);
    return user && !user.disabled ? { reset: r, user } : null;
  }
  const INVALID_RESET = "Ce lien n'est plus valable : il a expiré (1 heure), a déjà servi ou a été remplacé par une demande plus récente. Faites une nouvelle demande.";

  router.post('/api/auth/reset/check', { auth: 'public' }, (ctx) => {
    ipLimiter.check(ctx.ip);
    const found = findReset(ctx.body.token);
    if (!found) { ipLimiter.fail(ctx.ip); fail(410, 'invalid_link', INVALID_RESET); }
    return { username: found.user.username, first_name: found.user.first_name, expires_at: found.reset.expires_at, totp_enabled: Boolean(found.user.totp_enabled) };
  });

  router.post('/api/auth/reset', { auth: 'public' }, async (ctx) => {
    ipLimiter.check(ctx.ip);
    if (!findReset(ctx.body.token)) { ipLimiter.fail(ctx.ip); fail(410, 'invalid_link', INVALID_RESET); }
    const problem = passwordProblem(ctx.body.password);
    if (problem) fail(400, 'weak_password', problem);
    const hash = await hashPassword(ctx.body.password);
    const user = transaction(db, () => {
      const found = findReset(ctx.body.token);
      if (!found) fail(410, 'invalid_link', INVALID_RESET);
      const now = Date.now();
      db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, locked_until = NULL, failed_attempts = 0 WHERE id = ?').run(hash, now, found.user.id);
      db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(now, found.reset.id);
      db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(found.user.id);
      return found.user;
    });
    sessions.destroyAllForUser(user.id);
    audit({ ...ctx, user }, 'mot_de_passe_reinitialise', 'Par le lien « Mot de passe oublié », toutes les sessions fermées');
    notifyPasswordChanged(ctx, user, 'reset');
    return { ok: true, username: user.username };
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
      categories: db.prepare('SELECT id, name, kind, description, default_liquidity, target_pct, icon, sort_order FROM categories ORDER BY sort_order, id').all(),
      holdings: db.prepare('SELECT id, category_id, name, institution, owner, currency, liquidity, notes, closed_at, sort_order FROM holdings ORDER BY id').all(),
      valuations: db.prepare('SELECT holding_id, valued_at, amount_cents, note FROM valuations ORDER BY holding_id, valued_at').all(),
      loan_schedules: db.prepare('SELECT holding_id, kind, principal_cents, annual_rate, months, start_date FROM loan_schedules ORDER BY holding_id').all(),
      real_estate: db.prepare('SELECT holding_id,purchase_cents,purchased_at,property_type,address,surface_m2,condition,ownership_bp FROM real_estate ORDER BY holding_id').all(),
      real_estate_shares: db.prepare(`SELECT holding_id,recipient_id,ownership_bp FROM real_estate_shares
        WHERE accepted_at IS NOT NULL AND revoked_at IS NULL AND declined_at IS NULL ORDER BY holding_id,recipient_id`).all(),
      institution_logos: db.prepare('SELECT key, name, data FROM institution_logos ORDER BY key').all().map((r) => ({ key: r.key, name: r.name, data: Buffer.from(r.data).toString('base64') })),
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
    const rows = [['Catégorie', 'Type', 'Avoir', 'Établissement', 'Titulaire', 'Liquidité', 'Devise', 'Valeur du bien entier', `Valeur du patrimoine commun en ${v.base_currency}`, 'Date de la valeur', 'Clôturé le', "Prix d'achat du bien entier", "Date d'achat", 'Plus-value latente du patrimoine commun', 'Quote-part initiale (%)', 'Valeur de la part commune', "Prix d'achat de la part commune", 'Quote-part approuvée des autres (%)', 'Quote-part commune totale (%)']];
    for (const h of v.holdings) {
      const c = cats.get(h.category_id) || {};
      rows.push([c.name, c.kind === 'liability' ? 'Passif' : 'Actif', h.name, h.institution, h.owner, LIQ_LABEL[h.liquidity], h.currency, frNumber(h.value_cents), frNumber(h.value_base), h.last_date, h.closed_at, h.property ? frNumber(h.property.purchase_cents) : '', h.property?.purchased_at || '', frNumber(h.latent_gain_cents), h.property ? String(h.property.ownership_bp / 100).replace('.', ',') : '', h.property ? frNumber(h.owned_cents) : '', h.property ? frNumber(ownedCents(h.property.purchase_cents, h.total_ownership_bp)) : '', h.property ? String((h.total_ownership_bp - h.property.ownership_bp) / 100).replace('.', ',') : '', h.property ? String(h.total_ownership_bp / 100).replace('.', ',') : '']);
    }
    audit(ctx, 'export', 'CSV des avoirs');
    ctx.sendRaw(200, Buffer.from('﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n')), 'text/csv; charset=utf-8', `vigie-avoirs-${stampName()}.csv`);
  });

  router.get('/api/export/history.csv', { auth: 'viewer' }, (ctx) => {
    const st = loadState(db);
    const rows = [['Date', 'Avoir', 'Catégorie', 'Devise', 'Valeur', 'Note']];
    const data = [];
    for (const h of st.holdings) {
      const c = st.catById.get(h.category_id) || {};
      for (const v of st.byHolding.get(h.id) || []) data.push([v.valued_at, h.name, c.name, h.currency, frNumber(v.amount_cents), v.note || '', c.sort_order || 0]);
    }
    data.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[6] - b[6] || String(a[1]).localeCompare(String(b[1]), 'fr')));
    for (const r of data) rows.push(r.slice(0, 6));
    audit(ctx, 'export', "CSV de l'historique");
    ctx.sendRaw(200, Buffer.from('\ufeff' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n')), 'text/csv; charset=utf-8', `vigie-historique-${stampName()}.csv`);
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
        const icon = CATEGORY_ICONS.includes(c.icon) ? c.icon : (c.kind === 'liability' ? 'loanDoc' : 'cube');
        db.prepare('INSERT INTO categories (id, name, kind, description, default_liquidity, target_pct, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(intId(c.id), text(c.name, 'Catégorie', { required: true, max: 60 }), oneOf(c.kind, ['asset', 'liability'], 'Type'), text(c.description || '', 'Description', { max: 120 }),
            oneOf(c.default_liquidity || 'immediate', LIQUIDITY, 'Liquidité'), targetPct(c.target_pct), icon, Number(c.sort_order) || 0, now);
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
      for (const p of Array.isArray(d.real_estate) ? d.real_estate : []) {
        const id = intId(p.holding_id);
        const holding = db.prepare('SELECT * FROM holdings WHERE id = ?').get(id);
        if (!holding) fail(400, 'invalid_import', 'Bien immobilier sans avoir correspondant.');
        const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(holding.category_id);
        const validated = propertyFields({ property: {
          purchase_amount: p.purchase_cents / 100,
          purchased_at: p.purchased_at,
          property_type: p.property_type,
          address: p.address || '', surface_m2: p.surface_m2,
          condition: p.condition || 'correct',
          ownership_pct: p.ownership_bp === undefined ? 100 : p.ownership_bp / 100,
        } }, cat, holding.currency);
        writeProperty(id, validated);
      }
      // Export JSON : seuls les partages déjà approuvés sont restaurés ;
      // les invitations non acceptées ne sont pas réémises silencieusement.
      for (const share of Array.isArray(d.real_estate_shares) ? d.real_estate_shares : []) {
        const hid = intId(share.holding_id), target = intId(share.recipient_id);
        const property = db.prepare('SELECT ownership_bp FROM real_estate WHERE holding_id = ?').get(hid);
        if (!property || !getUser(target) || target === ctx.user.id)
          fail(400, 'invalid_import', 'Partage immobilier invalide ou destinataire absent sur ce serveur.');
        if (!Number.isInteger(share.ownership_bp) || share.ownership_bp < 1 ||
            property.ownership_bp + sumAccepted.get(hid).bp + share.ownership_bp > 10000)
          fail(400, 'invalid_import', 'Quote-parts immobilières supérieures à 100 %.');
        db.prepare(`INSERT INTO real_estate_shares
          (holding_id,sender_id,recipient_id,ownership_bp,created_at,expires_at,accepted_at,sent_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(hid,ctx.user.id,target,share.ownership_bp,now,now,now,now);
      }
      for (const sc of Array.isArray(d.loan_schedules) ? d.loan_schedules : []) {
        if (!LOAN_KINDS.includes(sc.kind) || !Number.isInteger(sc.principal_cents) || sc.principal_cents <= 0 || !Number.isInteger(sc.months) || sc.months < 1 || sc.months > 600
          || typeof sc.annual_rate !== 'number' || !(sc.annual_rate >= 0 && sc.annual_rate <= 50) || !isIsoDate(sc.start_date)) fail(400, 'invalid_import', 'Échéancier invalide.');
        const hid = intId(sc.holding_id);
        if (!db.prepare('SELECT 1 FROM holdings WHERE id = ?').get(hid)) fail(400, 'invalid_import', 'Échéancier rattaché à un avoir absent du fichier.');
        saveSchedule(hid, sc);
      }
      for (const r of d.fx_rates) {
        const c = currency(r.currency);
        if (c === base || !(r.rate > 0)) continue;
        db.prepare('INSERT INTO fx_rates (currency, rate, source, updated_at) VALUES (?, ?, ?, ?)').run(c, Number(r.rate), String(r.source || 'import').slice(0, 40), Number(r.updated_at) || now);
      }
      for (const l of Array.isArray(d.institution_logos) ? d.institution_logos : []) {
        const buf = typeof l.data === 'string' ? Buffer.from(l.data, 'base64') : null;
        const type = buf ? sniffImage(buf) : null;
        if ((!logos.catalogue.has(l.key) && !CUSTOM_KEY.test(String(l.key))) || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type) || buf.length > 600_000) fail(400, 'invalid_import', 'Image de logo invalide.');
        logos.setCustom(l.key, text(l.name, 'Établissement', { required: true, max: 80 }), buf, ctx.user.id);
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
