import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeMigration, migrationChecksum, migrationStatements } from '../server/db/migration-safety.js';

const migrationDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/db/migrations');

test('all existing migrations comply with additive-only policy without removing data', () => {
  const names = fs.readdirSync(migrationDir).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(names, ['001_init.sql', '002_companion.sql', '003_companion_version.sql', '004_campaign_soft_delete.sql']);
  for (const name of names) {
    const script = fs.readFileSync(path.join(migrationDir, name), 'utf8');
    assert.ok(assertSafeMigration(name, script) >= 1);
    assert.match(migrationChecksum(script), /^[0-9a-f]{64}$/);
  }
});

test('migration safety rejects destructive operations even with comments and multiple statements', () => {
  const forbidden = [
    'DROP TABLE prospects;',
    'TRUNCATE TABLE prospects;',
    'DELETE FROM users;',
    'UPDATE prospects SET title = NULL;',
    'ALTER TABLE prospects DROP COLUMN linkedin_url;',
    'ALTER TABLE prospects RENAME COLUMN full_name TO new_name;',
    'ALTER TABLE prospects ALTER COLUMN full_name TYPE integer;',
    'CREATE OR REPLACE VIEW demo AS SELECT 1;',
    'CREATE TABLE harmless (id integer); DELETE FROM prospects;',
    'DO $$ BEGIN DELETE FROM users; END $$;',
    'ALTER TABLE prospects ADD COLUMN notes_2 text; UPDATE prospects SET notes_2 = NULL;',
  ];
  for (const sql of forbidden) {
    assert.throws(() => assertSafeMigration('004_not_destructive.sql', sql), /interdite/, sql);
  }
  assert.throws(() => assertSafeMigration('malicious.sql', 'CREATE TABLE safe(id int);'), /Nom de migration/);
  assert.throws(() => assertSafeMigration('004_a.sql', '/* never closed'), /non terminé/);
});

test('migration safety allows adding tables, indices, and nullable columns without altering old rows', () => {
  const sql = `
    -- This comment contains DROP TABLE and DELETE FROM: it must not execute.
    CREATE TABLE IF NOT EXISTS optional_new_data (id uuid PRIMARY KEY);
    CREATE INDEX IF NOT EXISTS optional_new_data_id_idx ON optional_new_data(id);
    ALTER TABLE companion_devices ADD COLUMN IF NOT EXISTS other_extension_version text;
    ALTER TABLE prospects ADD COLUMN remark text DEFAULT 'DROP TABLE old; DELETE FROM users;';
  `;
  assert.equal(assertSafeMigration('004_safe_extension.sql', sql), 4);
  assert.equal(migrationStatements("CREATE TABLE example (label text DEFAULT 'hi; there');").length, 1);
  assert.throws(() => assertSafeMigration('004_empty.sql', '-- only a comment'), /Migration vide/);
});
