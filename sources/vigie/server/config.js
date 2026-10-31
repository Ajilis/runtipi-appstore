// Configuration de Vigie : variables d'environnement (Runtipi) > fichier vigie.env > valeurs par défaut.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.env.DATA_DIR || '/data');

export const paths = {
  data: DATA_DIR,
  config: path.join(DATA_DIR, 'config'),
  db: path.join(DATA_DIR, 'db'),
  backups: path.join(DATA_DIR, 'backups'),
};

export const CONFIG_FILE = path.join(paths.config, 'vigie.env');
const SECRET_FILE = path.join(paths.config, 'secret.key');

// Chaque réglage : type, valeur par défaut, bornes et commentaire écrit dans le fichier créé au premier démarrage.
const SPEC = {
  SESSION_IDLE_MINUTES: { type: 'int', def: 120, min: 5, max: 10080, doc: "Déconnexion automatique après cette durée d'inactivité (minutes)." },
  SESSION_MAX_HOURS: { type: 'int', def: 72, min: 1, max: 2160, doc: 'Durée de vie maximale d\'une session, même active (heures).' },
  LOGIN_MAX_ATTEMPTS: { type: 'int', def: 5, min: 3, max: 50, doc: 'Nombre d\'échecs de connexion avant blocage temporaire du compte.' },
  LOGIN_LOCK_MINUTES: { type: 'int', def: 15, min: 1, max: 1440, doc: 'Durée du blocage temporaire du compte (minutes).' },
  IP_MAX_FAILURES: { type: 'int', def: 20, min: 5, max: 1000, doc: 'Nombre d\'échecs tolérés par adresse IP sur 15 minutes avant refus.' },
  REQUIRE_2FA: { type: 'bool', def: false, doc: 'true : chaque utilisateur doit activer la double authentification avant d\'accéder aux données.' },
  SESSION_COOKIE_SECURE: { type: 'enum', def: 'auto', values: ['auto', 'true', 'false'], doc: 'auto : cookie « Secure » seulement en HTTPS (Cloudflare), pour garder la connexion possible sur http://IP:port.' },
  TRUST_CLOUDFLARE_HEADERS: { type: 'bool', def: true, doc: 'Lire l\'adresse IP réelle des visiteurs dans l\'en-tête CF-Connecting-IP ajouté par Cloudflare.' },
  ALLOW_SETUP_THROUGH_TUNNEL: { type: 'bool', def: false, doc: 'false : le premier compte ne peut être créé que depuis le réseau local, jamais via Cloudflare.' },
  BACKUP_HOUR: { type: 'int', def: 3, min: 0, max: 23, doc: 'Heure de la sauvegarde quotidienne automatique de la base (0 à 23).' },
  BACKUP_KEEP_DAYS: { type: 'int', def: 30, min: 0, max: 3650, doc: 'Nombre de jours de sauvegardes conservées (0 désactive la sauvegarde automatique).' },
  ECB_RATES_ENABLED: { type: 'bool', def: true, doc: 'Autoriser la récupération des taux de change de la Banque centrale européenne.' },
  INSTITUTION_LOGOS: { type: 'bool', def: true, doc: 'Afficher le logo des établissements connus, récupéré par le serveur sur leur site officiel (false : monogrammes uniquement, aucune connexion sortante).' },
  LOG_LEVEL: { type: 'enum', def: 'info', values: ['debug', 'info', 'warn', 'error'], doc: 'Niveau de détail des journaux du conteneur.' },
};

function defaultFileContent() {
  const lines = [
    '# Vigie Patrimoine : fichier de configuration',
    '# Créé au premier démarrage puis jamais écrasé, même lors des mises à jour.',
    '# Modifier une valeur, puis redémarrer l\'application dans Runtipi.',
    '# Le secret de l\'application vient du formulaire Runtipi (VIGIE_APP_SECRET), pas de ce fichier.',
    '# La case « Double authentification obligatoire » du formulaire Runtipi peut activer REQUIRE_2FA, jamais le désactiver.',
    '',
  ];
  for (const [key, s] of Object.entries(SPEC)) {
    lines.push(`# ${s.doc}`);
    lines.push(`${key}=${s.def}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const hash = value.search(/\s#/);
    if (hash >= 0) value = value.slice(0, hash).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function coerce(key, raw, warnings) {
  const s = SPEC[key];
  if (raw === undefined || raw === '') return s.def;
  const v = String(raw).trim();
  if (s.type === 'int') {
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n) || n < s.min || n > s.max) { warnings.push(`${key}=${v} ignoré (attendu entre ${s.min} et ${s.max})`); return s.def; }
    return n;
  }
  if (s.type === 'bool') {
    if (/^(true|1|yes|oui|on)$/i.test(v)) return true;
    if (/^(false|0|no|non|off)$/i.test(v)) return false;
    warnings.push(`${key}=${v} ignoré (attendu true ou false)`); return s.def;
  }
  if (s.type === 'enum') {
    if (s.values.includes(v.toLowerCase())) return v.toLowerCase();
    warnings.push(`${key}=${v} ignoré (valeurs possibles : ${s.values.join(', ')})`); return s.def;
  }
  return v;
}

export function loadConfig() {
  for (const dir of [paths.config, paths.db, paths.backups]) fs.mkdirSync(dir, { recursive: true });
  let created = false;
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, defaultFileContent(), { mode: 0o600 });
    created = true;
  }
  const fileValues = parseEnvFile(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const warnings = [];
  const cfg = {};
  for (const key of Object.keys(SPEC)) {
    const fromEnv = process.env[`VIGIE_${key}`];
    const fromFile = coerce(key, fileValues[key], warnings);
    if (fromEnv === undefined || fromEnv === '') { cfg[key] = fromFile; continue; }
    const envValue = coerce(key, fromEnv, warnings);
    // Une case Runtipi décochée (false) ne désactive pas un réglage activé dans vigie.env : elle ne peut que l'activer.
    cfg[key] = SPEC[key].type === 'bool' && envValue === false ? fromFile : envValue;
  }
  for (const key of Object.keys(fileValues)) if (!SPEC[key]) warnings.push(`Réglage inconnu ignoré : ${key}`);

  // Secret : fourni par Runtipi ; sinon secret de secours généré une fois et conservé dans config/secret.key.
  let secret = (process.env.VIGIE_APP_SECRET || '').trim();
  let secretSource = 'runtipi';
  if (secret.length < 32) {
    secretSource = 'fichier';
    if (fs.existsSync(SECRET_FILE)) secret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (secret.length < 32) {
      secret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(SECRET_FILE, secret + '\n', { mode: 0o600 });
      secretSource = 'généré';
    }
  }
  cfg.APP_SECRET = secret;
  cfg.PORT = Number.parseInt(process.env.PORT || '8080', 10);
  cfg.VERSION = process.env.APP_VERSION || '0.1.0';
  return { cfg, created, warnings, secretSource };
}

export const configSpec = SPEC;
