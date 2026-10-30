// Base SQLite (module node:sqlite intégré à Node.js) et migrations additives.
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Chaque migration est appliquée une seule fois, dans une transaction. Ne jamais modifier une migration publiée :
// ajouter une nouvelle entrée à la fin du tableau.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    totp_secret_enc TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    totp_last_step INTEGER NOT NULL DEFAULT 0,
    recovery_codes TEXT,
    disabled INTEGER NOT NULL DEFAULT 0,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    password_changed_at INTEGER,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('asset', 'liability')),
    description TEXT,
    default_liquidity TEXT NOT NULL DEFAULT 'immediate' CHECK (default_liquidity IN ('immediate', 'short', 'locked')),
    target_pct REAL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE holdings (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    institution TEXT,
    owner TEXT,
    currency TEXT NOT NULL DEFAULT 'EUR',
    liquidity TEXT NOT NULL CHECK (liquidity IN ('immediate', 'short', 'locked')),
    notes TEXT,
    closed_at TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_holdings_category ON holdings(category_id);
  CREATE TABLE valuations (
    id INTEGER PRIMARY KEY,
    holding_id INTEGER NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
    valued_at TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    note TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (holding_id, valued_at)
  );
  CREATE TABLE fx_rates (
    currency TEXT PRIMARY KEY,
    rate REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'manuel',
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    ip TEXT
  );
  CREATE INDEX idx_audit_at ON audit_log(at);
  `,
  // 0.2.0 : prénom et nom des utilisateurs, repris du nom affiché existant (« Alex Martin » -> Alex / Martin).
  `
  ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT '';
  UPDATE users SET
    first_name = CASE WHEN instr(trim(display_name), ' ') > 0 THEN substr(trim(display_name), 1, instr(trim(display_name), ' ') - 1) ELSE trim(display_name) END,
    last_name = CASE WHEN instr(trim(display_name), ' ') > 0 THEN trim(substr(trim(display_name), instr(trim(display_name), ' ') + 1)) ELSE '' END;
  `,
];

export function openDatabase(dir) {
  const db = new DatabaseSync(path.join(dir, 'vigie.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (applied.has(version)) return;
    transaction(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now());
    });
  });
  return db;
}

export function schemaVersion() {
  return MIGRATIONS.length;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* déjà annulée */ }
    throw err;
  }
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

// Catégories proposées à l'installation (modifiables ensuite).
export const DEFAULT_CATEGORIES = [
  { name: 'Comptes courants', kind: 'asset', default_liquidity: 'immediate', description: 'Comptes de dépôt et espèces' },
  { name: 'Épargne réglementée', kind: 'asset', default_liquidity: 'immediate', description: 'Livret A, LDDS, LEP, PEL, CEL' },
  { name: 'Assurance-vie', kind: 'asset', default_liquidity: 'short', description: 'Contrats en euros et en unités de compte' },
  { name: 'Bourse', kind: 'asset', default_liquidity: 'short', description: 'PEA, compte-titres' },
  { name: 'Épargne retraite', kind: 'asset', default_liquidity: 'locked', description: 'PER, Madelin, contrats retraite' },
  { name: 'Épargne salariale', kind: 'asset', default_liquidity: 'locked', description: 'PEE, PERCOL, intéressement' },
  { name: 'Immobilier', kind: 'asset', default_liquidity: 'locked', description: 'Résidence principale, locatif, SCPI' },
  { name: 'Crypto-actifs', kind: 'asset', default_liquidity: 'short', description: 'Portefeuilles et plateformes' },
  { name: 'Métaux précieux', kind: 'asset', default_liquidity: 'short', description: 'Or, argent' },
  { name: 'Autres actifs', kind: 'asset', default_liquidity: 'locked', description: 'Véhicules, objets de valeur, parts de société' },
  { name: 'Crédits immobiliers', kind: 'liability', default_liquidity: 'locked', description: 'Capital restant dû' },
  { name: 'Autres crédits', kind: 'liability', default_liquidity: 'locked', description: 'Prêts personnels, auto, travaux' },
];

export function seedCategories(db) {
  const now = Date.now();
  const insert = db.prepare('INSERT INTO categories (name, kind, description, default_liquidity, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  DEFAULT_CATEGORIES.forEach((c, i) => insert.run(c.name, c.kind, c.description, c.default_liquidity, (i + 1) * 10, now));
}
