// Sécurité du serveur : valeurs modifiables depuis Vigie, persistées dans SQLite.
// La double authentification imposée par le déploiement Runtipi reste obligatoire.
import { transaction, getSetting, setSetting } from './db.js';

const KEY = 'security_';
const RANGES = Object.freeze({
  SESSION_IDLE_MINUTES: [5, 10080],
  SESSION_MAX_HOURS: [1, 2160],
  LOGIN_MAX_ATTEMPTS: [3, 50],
  LOGIN_LOCK_MINUTES: [1, 1440],
});
const BOOLEAN = ['REQUIRE_2FA', 'INSTITUTION_LOGOS', 'INSTITUTION_LOGOS_FALLBACK'];

export function createServerSecuritySettings(db, cfg, { ipLimiter, logos } = {}) {
  const forced2fa = cfg.REQUIRE_2FA === true;
  const defaults = {};
  for (const field of [...Object.keys(RANGES), ...BOOLEAN]) defaults[field] = cfg[field];

  // Ne jamais faire échouer le démarrage pour une valeur corrompue : la replier
  // sur la configuration externe et journaliser via les tests/paramètres.
  for (const [field, [min, max]] of Object.entries(RANGES)) {
    const raw = getSetting(db, KEY + field, null);
    if (raw === null) continue;
    const value = Number(raw);
    if (raw.trim() && Number.isInteger(value) && value >= min && value <= max) cfg[field] = value;
  }
  for (const field of BOOLEAN) {
    const raw = getSetting(db, KEY + field, null);
    if (raw === 'true') cfg[field] = true;
    if (raw === 'false') cfg[field] = false;
  }
  // Ne pas contourner le choix 2FA obligatoire du fichier ou du formulaire Runtipi.
  if (forced2fa) cfg.REQUIRE_2FA = true;
  if (ipLimiter) ipLimiter.max = cfg.IP_MAX_FAILURES;
  if (logos) {
    logos.enabled = cfg.INSTITUTION_LOGOS;
    logos.fallback = cfg.INSTITUTION_LOGOS_FALLBACK;
  }

  const view = () => ({
    session_idle_minutes: cfg.SESSION_IDLE_MINUTES,
    session_max_hours: cfg.SESSION_MAX_HOURS,
    login_max_attempts: cfg.LOGIN_MAX_ATTEMPTS,
    login_lock_minutes: cfg.LOGIN_LOCK_MINUTES,
    require_2fa: cfg.REQUIRE_2FA,
    require_2fa_forced: forced2fa,
    institution_logos: cfg.INSTITUTION_LOGOS,
    institution_logos_fallback: cfg.INSTITUTION_LOGOS_FALLBACK,
  });

  function update(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Paramètres de sécurité invalides.');
    const changes = {};
    for (const [field, [min, max]] of Object.entries(RANGES)) {
      const key = field.toLowerCase();
      if (!(key in input)) continue;
      const value = input[key];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(key + ' : nombre entier attendu entre ' + min + ' et ' + max + '.');
      }
      changes[field] = value;
    }
    for (const field of BOOLEAN) {
      const key = field.toLowerCase();
      if (!(key in input)) continue;
      if (typeof input[key] !== 'boolean') throw new TypeError(key + ' : booléen attendu.');
      if (field === 'REQUIRE_2FA' && forced2fa && input[key] === false) {
        throw new RangeError('La double authentification est imposée par Runtipi ou vigie.env et ne peut pas être désactivée ici.');
      }
      changes[field] = input[key];
    }
    const allowed = new Set([...Object.keys(RANGES), ...BOOLEAN].map((x) => x.toLowerCase()));
    if (Object.keys(input).some((x) => !allowed.has(x))) throw new TypeError('Paramètre de sécurité non reconnu.');
    if (!Object.keys(changes).length) throw new TypeError('Aucun paramètre de sécurité fourni.');
    transaction(db, () => {
      for (const [key, value] of Object.entries(changes)) setSetting(db, KEY + key, value);
    });
    // Valeurs effectives immédiatement pour les nouvelles requêtes.
    Object.assign(cfg, changes);
    if (forced2fa) cfg.REQUIRE_2FA = true;
    if (logos) {
      logos.enabled = cfg.INSTITUTION_LOGOS;
      logos.fallback = cfg.INSTITUTION_LOGOS_FALLBACK;
    }
    return { security: view(), changes: Object.keys(changes).map((field) => field.toLowerCase()) };
  }
  return { view, update, defaults };
}
