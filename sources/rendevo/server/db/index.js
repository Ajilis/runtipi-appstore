import fs from 'node:fs';
import path from 'node:path';
import { Pool, json } from '../lib/pg.js';
import { assertSafeMigration, migrationChecksum } from './migration-safety.js';

export { json };

export async function connectDb(url, { retries = 40, logger = console } = {}) {
  const pool = new Pool(url);
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      return pool;
    } catch (e) {
      if (i === retries) throw e;
      logger.log(`[db] PostgreSQL indisponible (${e.code || e.message}), nouvel essai ${i}/${retries}...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return pool;
}

// All migrations are additive, checksum-protected, and run under one transaction
// and advisory lock. The lock *precedes* reading migration history, so a second
// Rendevo instance never executes the same migration against a concurrent boot.
export async function migrate(pool, logger = console, { directory } = {}) {
  const dir = directory || path.join(path.dirname(new URL(import.meta.url).pathname), 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  if (!files.length) throw new Error('Aucune migration SQL : démarrage refusé');
  // Preflight all files before making any change to the database.
  const migrations = files.map((filename) => {
    const sql = fs.readFileSync(path.join(dir, filename), 'utf8');
    assertSafeMigration(filename, sql);
    return { filename, sql, checksum: migrationChecksum(sql) };
  });
  const names = new Set(files);
  await pool.tx(async ({ query, simple }) => {
    await query('SELECT pg_advisory_xact_lock($1)', [424242]);
    await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(),
      checksum text
    )`);
    // Existing V1–V26 installations have no checksum column. This is additive.
    await query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
    const { rows } = await query('SELECT version, checksum FROM schema_migrations');
    const done = new Map(rows.map((r) => [r.version, r.checksum]));
    for (const [version] of done) {
      if (!names.has(version)) {
        throw new Error('Migration déjà appliquée absente du code : ' + version);
      }
    }
    for (const { filename, sql, checksum } of migrations) {
      if (done.has(filename)) {
        const previous = done.get(filename);
        if (previous && previous !== checksum) {
          throw new Error('Migration déjà appliquée modifiée : ' + filename);
        }
        if (!previous) {
          // One-time legacy backfill. No table or application row is touched.
          await query('UPDATE schema_migrations SET checksum = $2 WHERE version = $1', [filename, checksum]);
        }
        continue;
      }
      logger.log('[db] migration additive ' + filename);
      await simple(sql);
      await query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', [filename, checksum]);
    }
  });
}
