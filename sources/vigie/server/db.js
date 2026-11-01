// Base SQLite (module node:sqlite intégré à Node.js) et migrations additives.
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Chaque migration est appliquée une seule fois, dans une transaction. Ne jamais modifier une migration publiée :
// ajouter une nouvelle entrée à la fin du tableau.
export const MIGRATIONS = [
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
  // 0.3.0 : pictogramme de chaque catégorie, déduit du nom pour les catégories existantes.
  `
  ALTER TABLE categories ADD COLUMN icon TEXT;
  UPDATE categories SET icon = CASE
    WHEN lower(name) LIKE '%courant%' OR lower(name) LIKE '%esp_ce%' OR lower(name) LIKE '%liquidit%' THEN 'wallet'
    WHEN lower(name) LIKE '%r_glement_e%' OR lower(name) LIKE '%livret%' OR lower(name) LIKE '%_pargne de pr_caution%' THEN 'piggy'
    WHEN lower(name) LIKE '%assurance%' THEN 'umbrella'
    WHEN lower(name) LIKE '%bourse%' OR lower(name) LIKE '%action%' OR lower(name) LIKE '%pea%' OR lower(name) LIKE '%titre%' THEN 'chart'
    WHEN lower(name) LIKE '%retraite%' OR lower(name) LIKE '%per %' OR lower(name) = 'per' THEN 'hourglass'
    WHEN lower(name) LIKE '%salariale%' OR lower(name) LIKE '%entreprise%' OR lower(name) LIKE '%soci_t_%' THEN 'briefcase'
    WHEN kind = 'liability' AND (lower(name) LIKE '%immobilier%' OR lower(name) LIKE '%hypoth%') THEN 'loanHouse'
    WHEN lower(name) LIKE '%scpi%' OR lower(name) LIKE '%locatif%' THEN 'building'
    WHEN lower(name) LIKE '%immobilier%' OR lower(name) LIKE '%maison%' OR lower(name) LIKE '%appartement%' THEN 'house'
    WHEN lower(name) LIKE '%crypto%' OR lower(name) LIKE '%bitcoin%' THEN 'crypto'
    WHEN lower(name) LIKE '%m_taux%' OR lower(name) LIKE '%or %' OR lower(name) = 'or' THEN 'gold'
    WHEN lower(name) LIKE '%v_hicule%' OR lower(name) LIKE '%voiture%' THEN 'car'
    WHEN lower(name) LIKE '%art%' THEN 'art'
    WHEN kind = 'liability' THEN 'loanDoc'
    WHEN lower(name) LIKE '%autre%' THEN 'gem'
    ELSE 'cube' END;
  `,
  // 0.5.0 : logos des établissements récupérés sur leur site officiel.
  `
  CREATE TABLE logo_cache (
    host TEXT PRIMARY KEY,
    content_type TEXT,
    data BLOB,
    ok INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  `,
  // 0.6.0 : échéancier automatique des prêts, et catégorie « Prêts accordés » ajoutée aux installations existantes.
  `
  CREATE TABLE loan_schedules (
    holding_id INTEGER PRIMARY KEY REFERENCES holdings(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('amortizing', 'bullet')),
    principal_cents INTEGER NOT NULL CHECK (principal_cents > 0),
    annual_rate REAL NOT NULL CHECK (annual_rate >= 0),
    months INTEGER NOT NULL CHECK (months > 0),
    start_date TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  INSERT INTO categories (name, kind, description, default_liquidity, icon, sort_order, created_at)
  SELECT 'Prêts accordés', 'asset', 'Argent prêté à un proche ou à une société', 'locked', 'handshake',
    COALESCE((SELECT sort_order FROM categories WHERE name = 'Autres actifs') - 5, (SELECT MAX(sort_order) FROM categories) + 10),
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE EXISTS (SELECT 1 FROM categories)
    AND NOT EXISTS (SELECT 1 FROM categories WHERE icon = 'handshake' OR lower(name) LIKE '%prêt%accord%' OR lower(name) LIKE '%pret%accord%' OR lower(name) LIKE '%créance%' OR lower(name) LIKE '%creance%');
  `,
  // 0.7.0 : dimensions et provenance des logos récupérés, images déposées par l'administrateur.
  // Les échecs passés sont oubliés pour être réessayés avec la nouvelle recherche d'icônes.
  `
  ALTER TABLE logo_cache ADD COLUMN width INTEGER;
  ALTER TABLE logo_cache ADD COLUMN height INTEGER;
  ALTER TABLE logo_cache ADD COLUMN source TEXT;
  DELETE FROM logo_cache WHERE ok = 0;
  CREATE TABLE institution_logos (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    data BLOB NOT NULL,
    width INTEGER,
    height INTEGER,
    updated_at INTEGER NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  `,
  // 0.8.0 : adresse e-mail des utilisateurs, invitations par e-mail, liens « Mot de passe oublié ».
  `
  ALTER TABLE users ADD COLUMN email TEXT;
  CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
  CREATE TABLE invitations (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    token_hash TEXT NOT NULL UNIQUE,
    invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    sent_at INTEGER,
    accepted_at INTEGER,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    canceled_at INTEGER
  );
  CREATE TABLE password_resets (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    ip TEXT
  );
  CREATE INDEX idx_password_resets_user ON password_resets(user_id);
  `,
  // 0.9.0 : annuaire ouvert actualisé par le serveur, catalogue embarqué conservé.
  `
  CREATE TABLE institution_directory (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    host TEXT,
    aliases TEXT NOT NULL DEFAULT '[]',
    logo_url TEXT,
    source TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_institution_directory_name ON institution_directory(name);
  `,
  // 0.9.1 : nouveaux logos de référence pour N26 et Vivid ; réessayer les échecs sans attendre 3 jours.
  `
  DELETE FROM logo_cache WHERE ok = 0 AND host IN ('n26.com', 'vivid.money');
  `,
  // 0.9.2 : sources de logos par établissement, indépendantes du nom légal et du domaine du site.
  `
  CREATE TABLE institution_logo_sources (
    id TEXT PRIMARY KEY,
    openfintech_url TEXT,
    wikidata_url TEXT,
    wikidata_checked_at INTEGER NOT NULL DEFAULT 0
  );
  -- Rechercher les nouveaux logos ouverts immédiatement, tout en gardant les icônes déjà valides.
  DELETE FROM logo_cache WHERE ok = 0;
  UPDATE logo_cache SET fetched_at = 0 WHERE ok = 1;
  `,
  // 0.9.3 : prix d'achat distinct de la valeur actuelle du bien immobilier.
  `
  CREATE TABLE real_estate (
    holding_id INTEGER PRIMARY KEY REFERENCES holdings(id) ON DELETE CASCADE,
    purchase_cents INTEGER NOT NULL CHECK (purchase_cents > 0),
    purchased_at TEXT NOT NULL,
    property_type TEXT NOT NULL CHECK (property_type IN ('maison', 'appartement')),
    address TEXT NOT NULL DEFAULT '',
    surface_m2 INTEGER CHECK (surface_m2 IS NULL OR (surface_m2 > 0 AND surface_m2 <= 10000)),
    condition TEXT NOT NULL DEFAULT 'correct',
    updated_at INTEGER NOT NULL
  );
  `,
  // 0.9.4 : quote-part détenue, en centièmes de pourcentage (10000 = 100 %).
  `
  ALTER TABLE real_estate ADD COLUMN ownership_bp INTEGER NOT NULL DEFAULT 10000
    CHECK (ownership_bp BETWEEN 1 AND 10000);
  `,
  // 0.9.8 : partage entre comptes du même serveur avec acceptation préalable.
  // Une invitation en attente n'attribue aucune quote-part patrimoniale.
  `
  CREATE TABLE real_estate_shares (
    id INTEGER PRIMARY KEY,
    holding_id INTEGER NOT NULL REFERENCES real_estate(holding_id) ON DELETE CASCADE,
    sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ownership_bp INTEGER NOT NULL CHECK (ownership_bp BETWEEN 1 AND 10000),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    sent_at INTEGER,
    accepted_at INTEGER,
    declined_at INTEGER,
    revoked_at INTEGER,
    CHECK (accepted_at IS NULL OR declined_at IS NULL)
  );
  CREATE INDEX idx_real_estate_shares_holding ON real_estate_shares(holding_id);
  CREATE INDEX idx_real_estate_shares_recipient ON real_estate_shares(recipient_id, accepted_at);
  CREATE UNIQUE INDEX idx_real_estate_shares_active ON real_estate_shares(holding_id, recipient_id)
    WHERE declined_at IS NULL AND revoked_at IS NULL;
  `,
  // 0.9.8 : chaque avoir est lié au compte Vigie de son créateur.
  // Les avoirs historiques partagés sont rattachés au premier administrateur.
  `
  ALTER TABLE holdings ADD COLUMN account_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT;
  UPDATE holdings SET account_user_id = COALESCE(
    (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1),
    (SELECT id FROM users ORDER BY id LIMIT 1)
  );
  CREATE INDEX idx_holdings_account ON holdings(account_user_id);
  `,
  `CREATE TABLE holding_acquisitions (
    holding_id INTEGER PRIMARY KEY REFERENCES holdings(id) ON DELETE CASCADE,
    purchase_cents INTEGER NOT NULL CHECK (purchase_cents > 0),
    purchased_at TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );`,
];

// Pictogrammes de catégorie autorisés (voir web/icons.js).
export const CATEGORY_ICONS = ['wallet', 'card', 'bank', 'coins', 'piggy', 'umbrella', 'shield', 'chart', 'hourglass', 'briefcase', 'house',
  'building', 'crypto', 'gold', 'gem', 'car', 'art', 'leaf', 'cube', 'loanHouse', 'loanDoc', 'handshake'];

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
  { name: 'Comptes courants', kind: 'asset', default_liquidity: 'immediate', description: 'Comptes de dépôt et espèces', icon: 'wallet' },
  { name: 'Épargne réglementée', kind: 'asset', default_liquidity: 'immediate', description: 'Livret A, LDDS, LEP, PEL, CEL', icon: 'piggy' },
  { name: 'Assurance-vie', kind: 'asset', default_liquidity: 'short', description: 'Contrats en euros et en unités de compte', icon: 'umbrella' },
  { name: 'Bourse', kind: 'asset', default_liquidity: 'short', description: 'PEA, compte-titres', icon: 'chart' },
  { name: 'Épargne retraite', kind: 'asset', default_liquidity: 'locked', description: 'PER, Madelin, contrats retraite', icon: 'hourglass' },
  { name: 'Épargne salariale', kind: 'asset', default_liquidity: 'locked', description: 'PEE, PERCOL, intéressement', icon: 'briefcase' },
  { name: 'Immobilier', kind: 'asset', default_liquidity: 'locked', description: 'Résidence principale, locatif, SCPI', icon: 'house' },
  { name: 'Crypto-actifs', kind: 'asset', default_liquidity: 'short', description: 'Portefeuilles et plateformes', icon: 'crypto' },
  { name: 'Métaux précieux', kind: 'asset', default_liquidity: 'short', description: 'Or, argent', icon: 'gold' },
  { name: 'Prêts accordés', kind: 'asset', default_liquidity: 'locked', description: 'Argent prêté à un proche ou à une société', icon: 'handshake' },
  { name: 'Autres actifs', kind: 'asset', default_liquidity: 'locked', description: 'Véhicules, objets de valeur, parts de société', icon: 'gem' },
  { name: 'Crédits immobiliers', kind: 'liability', default_liquidity: 'locked', description: 'Capital restant dû', icon: 'loanHouse' },
  { name: 'Autres crédits', kind: 'liability', default_liquidity: 'locked', description: 'Prêts personnels, auto, travaux', icon: 'loanDoc' },
];

export function seedCategories(db) {
  const now = Date.now();
  const insert = db.prepare('INSERT INTO categories (name, kind, description, default_liquidity, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  DEFAULT_CATEGORIES.forEach((c, i) => insert.run(c.name, c.kind, c.description, c.default_liquidity, c.icon, (i + 1) * 10, now));
}
