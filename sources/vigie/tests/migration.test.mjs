import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, schemaVersion } from '../server/db.js';

test('une base 0.1.0 est mise à jour sans perte : prénom et nom repris du nom affiché', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-mig-'));
  // Base créée par la 0.1.0 : uniquement la migration 1.
  const v1 = openDatabase(dir);
  v1.close();
  const raw = new DatabaseSync(path.join(dir, 'vigie.sqlite'));
  raw.exec('DELETE FROM schema_migrations WHERE version > 1');
  raw.exec('CREATE TABLE users_v1 AS SELECT id, username, display_name, password_hash, role, totp_secret_enc, totp_enabled, totp_last_step, recovery_codes, disabled, failed_attempts, locked_until, password_changed_at, created_at, last_login_at FROM users');
  raw.exec('DROP TABLE users');
  raw.exec('ALTER TABLE users_v1 RENAME TO users');
  const ins = raw.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, 'x', 'admin', 0)");
  ins.run('alex', 'Alex Martin');
  ins.run('sam', '  Sam  ');
  ins.run('jb', 'Jean Baptiste de la Tour');
  raw.close();

  const db = openDatabase(dir);
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, schemaVersion());
  const rows = db.prepare('SELECT username, display_name, first_name, last_name FROM users ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { username: 'alex', display_name: 'Alex Martin', first_name: 'Alex', last_name: 'Martin' },
    { username: 'sam', display_name: '  Sam  ', first_name: 'Sam', last_name: '' },
    { username: 'jb', display_name: 'Jean Baptiste de la Tour', first_name: 'Jean', last_name: 'Baptiste de la Tour' },
  ]);
  db.close();
  // Deuxième ouverture : rien n'est rejoué.
  const again = openDatabase(dir);
  assert.equal(again.prepare('SELECT COUNT(*) AS n FROM users').get().n, 3);
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
