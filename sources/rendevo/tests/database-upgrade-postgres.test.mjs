// Real PostgreSQL upgrade simulation: seed a V20/V21-era database with data,
// upgrade to the current migrations and check every original business row.
// Only run against the isolated, throwaway CI database, never production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '../server/lib/pg.js';
import { migrate } from '../server/db/index.js';

const url = process.env.RENDEVO_MIGRATION_TEST_URL;
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/db/migrations');
const tables = [
  'users', 'workspaces', 'memberships', 'sessions', 'accounts', 'campaigns',
  'prospects', 'messages', 'meetings', 'usage', 'media', 'webhooks',
  'api_tokens', 'events', 'companion_pairings', 'companion_devices',
];
const silent = { log() {} };

async function snapshot(pool) {
  const result = {};
  // Ignore only intentionally-added nullable schema columns; compare every
  // business field/record byte-for-byte across migrations.
  for (const table of tables) {
    const { rows } = await pool.query(`SELECT to_jsonb(t) - 'extension_version' - 'probe' AS document FROM "${table}" t`);
    result[table] = rows.map((r) => JSON.stringify(r.document)).sort();
  }
  return result;
}

test('upgrade: PostgreSQL legacy with real records survives multiple migrations, concurrency and failures',
  { skip: !url && 'requires dedicated PostgreSQL CI service' }, async () => {
    // Explicitly opt in to a dedicated *test-only* database. No DROP operations
    // exist in this script, but we still refuse a production connection.
    const target = new URL(url);
    assert.equal(target.pathname, '/rendevo_migration_ci', 'Unsafe test database name');
    assert.ok(['localhost', '127.0.0.1'].includes(target.hostname), 'Unsafe test database host');
    const pool = new Pool(url);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rendevo-upgrade-fixture-'));
    try {
      const { rows: existing } = await pool.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'schema_migrations'");
      assert.equal(existing.length, 0, 'CI migration test database must be empty');

      // Old deployments used schema_migrations without a checksum column.
      await pool.simple(`CREATE TABLE schema_migrations (
        version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      for (const version of ['001_init.sql', '002_companion.sql']) {
        await pool.simple(fs.readFileSync(path.join(dir, version), 'utf8'));
        await pool.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
      }

      const user = (await pool.query(
        'INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) RETURNING id',
        ['legacy@example.test', 'Ancienne utilisatrice', 'legacy-password-hash'])).rows[0].id;
      const ws = (await pool.query('INSERT INTO workspaces(name,settings) VALUES ($1,$2::jsonb) RETURNING id',
        ['Ancien espace', JSON.stringify({ discovery: { brave_api_key_enc: 'legacy-secret-cipher' },
          icp: { titles: ['Directeur commercial'] } })])).rows[0].id;
      await pool.query('INSERT INTO memberships(user_id,workspace_id) VALUES($1,$2)', [user, ws]);
      await pool.query("INSERT INTO sessions(id,user_id,workspace_id,expires_at) VALUES('legacy-session',$1,$2,now() + interval '1 day')", [user, ws]);
      const account = (await pool.query(
        "INSERT INTO accounts(workspace_id,name,provider) VALUES($1,'Compte historique','manual') RETURNING id", [ws])).rows[0].id;
      const campaign = (await pool.query(
        "INSERT INTO campaigns(workspace_id,account_id,name,icp) VALUES($1,$2,'Campagne conservée',$3::jsonb) RETURNING id",
        [ws, account, JSON.stringify({ keywords: ['SaaS'] })])).rows[0].id;
      const prospect = (await pool.query(
        "INSERT INTO prospects(workspace_id,campaign_id,full_name,linkedin_url) VALUES($1,$2,'Marie Durand','https://www.linkedin.com/in/legacy-marie/') RETURNING id",
        [ws, campaign])).rows[0].id;
      await pool.query(
        "INSERT INTO messages(workspace_id,prospect_id,campaign_id,direction,kind,status,body) VALUES($1,$2,$3,'outbound','message','sent','Message ancien à conserver')",
        [ws, prospect, campaign]);
      await pool.query(
        "INSERT INTO meetings(workspace_id,prospect_id,campaign_id,starts_at,ends_at) VALUES($1,$2,$3,now() + interval '5 days',now() + interval '5 days 1 hour')",
        [ws, prospect, campaign]);
      await pool.query("INSERT INTO usage(account_id,day,invites) VALUES($1,CURRENT_DATE,2)", [account]);
      await pool.query(
        "INSERT INTO media(workspace_id,title,filename,stored_name,mime) VALUES($1,'Vidéo historique','video.mp4','a-file.mp4','video/mp4')", [ws]);
      await pool.query(
        "INSERT INTO webhooks(workspace_id,url) VALUES($1,'https://hooks.example.test/keep')", [ws]);
      await pool.query(
        "INSERT INTO api_tokens(workspace_id,user_id,name,token_hash,prefix) VALUES($1,$2,'Ancienne clé','tokenhash-keep','prefix')",
        [ws, user]);
      await pool.query(
        "INSERT INTO events(workspace_id,prospect_id,campaign_id,type,data) VALUES($1,$2,$3,'historic',$4::jsonb)",
        [ws, prospect, campaign, JSON.stringify({ important: true })]);
      await pool.query(
        "INSERT INTO companion_pairings(code_hash,workspace_id,user_id,expires_at) VALUES('old-pairing',$1,$2,now() + interval '1 hour')",
        [ws, user]);
      await pool.query(
        "INSERT INTO companion_devices(workspace_id,user_id,name,token_hash,prefix,expires_at) VALUES($1,$2,'Chrome actuel','devicehash-keep','prefix',now() + interval '1 year')",
        [ws, user]);

      const before = await snapshot(pool);
      assert.ok(Object.values(before).every((rows) => rows.length === 1),
        'Every existing business table must have at least one sentinel record');
      await migrate(pool, silent);
      assert.deepEqual(await snapshot(pool), before, 'Historical records changed during upgrade');
      let history = (await pool.query('SELECT version, checksum FROM schema_migrations ORDER BY version')).rows;
      assert.deepEqual(history.map((r) => r.version),
        ['001_init.sql', '002_companion.sql', '003_companion_version.sql']);
      assert.ok(history.every((r) => /^[0-9a-f]{64}$/.test(r.checksum)),
        'Legacy history must receive checksums without changing business rows');
      const { rows: devices } = await pool.query('SELECT extension_version FROM companion_devices');
      assert.equal(devices[0].extension_version, null, 'Legacy devices remain valid after additive column');

      await Promise.all([migrate(pool, silent), migrate(pool, silent)]);
      assert.deepEqual(await snapshot(pool), before, 'Repeat migrations must be idempotent');

      for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
        fs.copyFileSync(path.join(dir, name), path.join(tmp, name));
      }
      const upgrade = path.join(tmp, '004_ci_additive_upgrade.sql');
      fs.writeFileSync(upgrade, 'ALTER TABLE prospects ADD COLUMN IF NOT EXISTS probe text;');
      const second = new Pool(url);
      try {
        await Promise.all([migrate(pool, silent, { directory: tmp }),
          migrate(second, silent, { directory: tmp })]);
      } finally { await second.end(); }
      history = (await pool.query('SELECT version FROM schema_migrations ORDER BY version')).rows;
      assert.equal(history.filter((r) => r.version === '004_ci_additive_upgrade.sql').length, 1,
        'Parallel app boots must apply each new migration exactly once');
      assert.deepEqual(await snapshot(pool), before);

      // A historically applied script cannot be changed; startup fails safely.
      fs.writeFileSync(upgrade, 'ALTER TABLE prospects ADD COLUMN IF NOT EXISTS probe_renamed text;');
      await assert.rejects(() => migrate(pool, silent, { directory: tmp }),
        /déjà appliquée modifiée/);
      assert.deepEqual(await snapshot(pool), before);
      fs.writeFileSync(upgrade, 'ALTER TABLE prospects ADD COLUMN IF NOT EXISTS probe text;');

      // A failed additive migration is rolled back including any earlier DDL.
      fs.writeFileSync(path.join(tmp, '005_ci_fails.sql'),
        'ALTER TABLE prospects ADD COLUMN IF NOT EXISTS uncommitted_probe text;\nALTER TABLE nonexistent_table ADD COLUMN safe text;');
      await assert.rejects(() => migrate(pool, silent, { directory: tmp }));
      const { rows: rollbackColumns } = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='prospects' AND column_name='uncommitted_probe'");
      assert.equal(rollbackColumns.length, 0, 'Failed migration must roll back DDL');
      const { rows: rollbackHistory } = await pool.query(
        "SELECT version FROM schema_migrations WHERE version='005_ci_fails.sql'");
      assert.equal(rollbackHistory.length, 0, 'Failed migration must not enter history');
      assert.deepEqual(await snapshot(pool), before, 'Failed migration must preserve existing rows');
    } finally {
      await pool.end();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
