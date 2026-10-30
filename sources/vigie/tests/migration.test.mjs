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
