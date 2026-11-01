import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, schemaVersion, MIGRATIONS } from '../server/db.js';

// Construit une base telle que la laissait une version antérieure : seulement les `upTo` premières migrations.
function legacyDatabase(upTo, fill) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-mig-'));
  const raw = new DatabaseSync(path.join(dir, 'vigie.sqlite'));
  raw.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (let i = 0; i < upTo; i++) { raw.exec(MIGRATIONS[i]); raw.prepare('INSERT INTO schema_migrations VALUES (?, 0)').run(i + 1); }
  fill(raw);
  raw.close();
  return dir;
}

test('base 0.1.0 : prénom et nom repris du nom affiché, pictogrammes déduits des noms de catégorie', () => {
  const dir = legacyDatabase(1, (raw) => {
    const u = raw.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, 'x', 'admin', 0)");
    u.run('alex', 'Alex Martin'); u.run('sam', '  Sam  '); u.run('jb', 'Jean Baptiste de la Tour');
    const c = raw.prepare('INSERT INTO categories (name, kind, sort_order, created_at) VALUES (?, ?, 0, 0)');
    for (const [n, k] of [['Comptes courants', 'asset'], ['Épargne réglementée', 'asset'], ['Assurance-vie', 'asset'], ['Bourse', 'asset'], ['Épargne retraite', 'asset'],
      ['Épargne salariale', 'asset'], ['Immobilier', 'asset'], ['SCPI', 'asset'], ['Crypto-actifs', 'asset'], ['Métaux précieux', 'asset'], ['Véhicules', 'asset'],
      ['Autres actifs', 'asset'], ['Ma collection', 'asset'], ['Crédits immobiliers', 'liability'], ['Autres crédits', 'liability']]) c.run(n, k);
  });
  const db = openDatabase(dir);
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, schemaVersion());
  const users = db.prepare('SELECT username, first_name, last_name FROM users ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(users, [
    { username: 'alex', first_name: 'Alex', last_name: 'Martin' },
    { username: 'sam', first_name: 'Sam', last_name: '' },
    { username: 'jb', first_name: 'Jean', last_name: 'Baptiste de la Tour' },
  ]);
  const icons = Object.fromEntries(db.prepare('SELECT name, icon FROM categories').all().map((r) => [r.name, r.icon]));
  assert.deepEqual(icons, {
    'Comptes courants': 'wallet', 'Épargne réglementée': 'piggy', 'Assurance-vie': 'umbrella', Bourse: 'chart', 'Épargne retraite': 'hourglass',
    'Épargne salariale': 'briefcase', Immobilier: 'house', SCPI: 'building', 'Crypto-actifs': 'crypto', 'Métaux précieux': 'gold', 'Véhicules': 'car',
    'Autres actifs': 'gem', 'Ma collection': 'cube', 'Crédits immobiliers': 'loanHouse', 'Autres crédits': 'loanDoc',
    'Prêts accordés': 'handshake',
  });
  db.close();
  const again = openDatabase(dir);
  assert.equal(again.prepare('SELECT COUNT(*) AS n FROM users').get().n, 3, 'rien n\'est rejoué à la deuxième ouverture');
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('base 0.2.0 : seule la migration des pictogrammes est appliquée', () => {
  const dir = legacyDatabase(2, (raw) => {
    raw.prepare("INSERT INTO users (username, display_name, first_name, last_name, password_hash, role, created_at) VALUES ('alex', 'Alex Martin', 'Alex', 'Martin', 'x', 'admin', 0)").run();
    raw.prepare("INSERT INTO categories (name, kind, sort_order, created_at) VALUES ('Bourse', 'asset', 0, 0)").run();
  });
  const db = openDatabase(dir);
  assert.equal(db.prepare("SELECT icon FROM categories WHERE name = 'Bourse'").get().icon, 'chart');
  assert.equal(db.prepare("SELECT first_name FROM users").get().first_name, 'Alex');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('base 0.5.0 : catégorie « Prêts accordés » ajoutée une seule fois, table des échéanciers créée', () => {
  const dir = legacyDatabase(4, (raw) => {
    const c = raw.prepare("INSERT INTO categories (name, kind, icon, sort_order, created_at) VALUES (?, 'asset', ?, ?, 0)");
    c.run('Comptes courants', 'wallet', 10); c.run('Autres actifs', 'gem', 20);
  });
  const db = openDatabase(dir);
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, schemaVersion());
  const rows = db.prepare('SELECT name, kind, icon, default_liquidity, sort_order FROM categories ORDER BY sort_order').all().map((r) => ({ ...r }));
  assert.deepEqual(rows.map((r) => r.name), ['Comptes courants', 'Prêts accordés', 'Autres actifs']);
  assert.equal(rows[1].icon, 'handshake');
  assert.equal(rows[1].default_liquidity, 'locked');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'loan_schedules'").get().n, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('base 0.5.0 : une catégorie de créances existante est respectée, base vide laissée vide', () => {
  const dir = legacyDatabase(4, (raw) => {
    raw.prepare("INSERT INTO categories (name, kind, icon, sort_order, created_at) VALUES ('Créances familiales', 'asset', 'cube', 10, 0)").run();
  });
  const db = openDatabase(dir);
  assert.deepEqual(db.prepare('SELECT name FROM categories').all().map((r) => r.name), ['Créances familiales']);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  const empty = legacyDatabase(4, () => {});
  const db2 = openDatabase(empty);
  assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM categories').get().n, 0, "l'installation crée les catégories par défaut, pas la migration");
  db2.close();
  fs.rmSync(empty, { recursive: true, force: true });
});

test('base 0.6.0 : logos en échec oubliés pour être recherchés de nouveau, logos trouvés conservés', () => {
  const dir = legacyDatabase(5, (raw) => {
    const l = raw.prepare('INSERT INTO logo_cache (host, content_type, data, ok, fetched_at) VALUES (?, ?, ?, ?, 0)');
    l.run('www.boursobank.com', 'image/png', Buffer.from('png'), 1);
    l.run('www.fortuneo.fr', null, null, 0);
  });
  const db = openDatabase(dir);
  const rows = db.prepare('SELECT host, ok, width FROM logo_cache').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ host: 'www.boursobank.com', ok: 1, width: null }], 'dimensions inconnues : le logo sera amélioré au prochain préchargement');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'institution_logos'").get().n, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
