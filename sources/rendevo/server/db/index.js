import fs from 'node:fs';
import path from 'node:path';
import { Pool, json } from '../lib/pg.js';

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

export async function migrate(pool, logger = console) {
  await pool.simple(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  // Serialize migrations across instances with an advisory lock.
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query('SELECT version FROM schema_migrations');
  const done = new Set(rows.map((r) => r.version));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    logger.log(`[db] migration ${f}`);
    await pool.simple(`BEGIN; SELECT pg_advisory_xact_lock(424242); ${sql}; INSERT INTO schema_migrations(version) VALUES ('${f}'); COMMIT;`);
  }
}
