import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Router } from '../server/lib/http.js';
import { registerCore } from '../server/routes/core.js';
import {
  normalizePublicProfileUrl, normalizeDiscoveryCriteria, buildLinkedInDorks, discoverDegoogProfiles,
} from '../server/services/discovery.js';

test('campagne : suppression logique admin, nom exact, sans jamais supprimer les prospects', async () => {
  const campaign = { id: 'camp-a', workspace_id: 'ws-a', name: 'Marché français', status: 'active', deleted_at: null };
  const sentinel = { prospects: ['prospect-1'], messages: ['message-1'], meetings: ['meeting-1'] };
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM campaigns') && sql.includes('SELECT c.*')) return { rows: [] };
      throw new Error('Outside tx: ' + sql);
    },
    async tx(fn) {
      const state = { ...campaign };
      const result = await fn({ query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.startsWith('SELECT id, name FROM campaigns')) {
          return { rows: state.id === params[0] && state.workspace_id === params[1] && !state.deleted_at
            ? [{ id: state.id, name: state.name }] : [] };
        }
        if (sql.startsWith('UPDATE campaigns SET deleted_at')) {
          assert.equal(params[0], state.id);
          assert.equal(params[1], state.workspace_id);
          state.status = 'archived';
          state.deleted_at = 'now';
          return { rows: [] };
        }
        if (sql.startsWith('UPDATE messages SET status')) {
          assert.deepEqual(params, [state.id, state.workspace_id]);
          return { rows: [] };
        }
        throw Error('Unexpected SQL: ' + sql);
      } });
      Object.assign(campaign, state);
      return result;
    },
  };
  let audit = 0;
  const router = new Router();
  const auth = { requireAuth: async () => {}, requireAdmin: async () => {} };
  registerCore(router, { db, config: {}, agent: {}, activity: { log: async () => { audit++; } } }, auth);
  const route = router.match('DELETE', '/api/campaigns/camp-a');
  assert.ok(route);
  assert.equal(route.route.handlers.length, 3);
  const handle = route.route.handlers.at(-1);
  const ctx = (workspace, confirm_name) => ({
    state: { ws: { id: workspace } }, params: { id: 'camp-a' },
    json: async () => ({ confirm_name }),
  });
  await assert.rejects(() => handle(ctx('ws-a', 'Marché francais')), /nom saisi/);
  await assert.rejects(() => handle(ctx('ws-b', 'Marché français')), /introuvable/i);
  await assert.rejects(() => handle(ctx('ws-a', '')), /Saisissez/);
  assert.equal(campaign.deleted_at, null);
  assert.equal(audit, 0);
  assert.deepEqual(await handle(ctx('ws-a', 'Marché français')), { ok: true, preserved_data: true });
  assert.equal(campaign.status, 'archived');
  assert.equal(campaign.deleted_at, 'now');
  assert.deepEqual(sentinel, { prospects: ['prospect-1'], messages: ['message-1'], meetings: ['meeting-1'] });
  assert.ok(queries.every(({ sql }) => !/DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i.test(sql)));
  assert.equal(audit, 1);
  await assert.rejects(() => handle(ctx('ws-a', 'Marché français')), /introuvable/i);
});

test('liste campagnes : suppression masquée y compris dans les archives, édition par icône', () => {
  const core = fs.readFileSync(new URL('../server/routes/core.js', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../web/src/pages/Campaigns.jsx', import.meta.url), 'utf8');
  const migration = fs.readFileSync(new URL('../server/db/migrations/004_campaign_soft_delete.sql', import.meta.url), 'utf8');
  assert.match(core, /c\.deleted_at IS NULL AND/);
  assert.match(core, /deleted_at IS NULL FOR UPDATE/);
  assert.match(core, /SELECT \* FROM campaigns WHERE id = \$1 AND workspace_id = \$2 AND deleted_at IS NULL/);
  assert.match(core, /requireAuth, requireAdmin, async \(ctx\) => \{/);
  assert.match(ui, /<LuPencil \/>/);
  assert.match(ui, /<LuTrash2 \/>/);
  assert.match(ui, /confirmation !== deleting\.name/);
  assert.match(ui, /aria-label=\{\x60Supprimer la campagne/);
  assert.doesNotMatch(migration, /DELETE FROM|DROP TABLE/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS deleted_at timestamptz/);
});

test('dork : requêtes exactes puis relâchées, pour profils publics indexés', () => {
  const criteria = normalizeDiscoveryCriteria({
    title: 'Directeur marketing', industry: 'SaaS', location: 'Paris', keywords: 'B2B', limit: 20,
  });
  const dorks = buildLinkedInDorks(criteria);
  assert.equal(dorks.length, 3);
  assert.equal(dorks[0], 'site:linkedin.com/in/ "Directeur marketing" "SaaS" "Paris" "B2B"');
  assert.equal(dorks[1], 'site:linkedin.com/in/ "Directeur marketing" "Paris"');
  assert.equal(dorks[2], 'site:linkedin.com/in "Directeur marketing"');
  assert.equal(normalizePublicProfileUrl('https://fr.linkedin.com/in/marie-durand/?trk=public'),
    'https://www.linkedin.com/in/marie-durand/');
  assert.equal(normalizePublicProfileUrl('https://de.linkedin.com/in/marie-durand'),
    'https://www.linkedin.com/in/marie-durand/');
  assert.equal(normalizePublicProfileUrl('https://linkedin.com.evil.test/in/marie-durand'), null);
});

test('DeGoog : fallback dorks sur vrais résultats non LinkedIn sans jamais consulter LinkedIn', async () => {
  const criteria = normalizeDiscoveryCriteria({ title: 'Directeur marketing', location: 'Paris' });
  const observed = [], attempts = [];
  const mock = async (url, opts) => {
    observed.push({ host: url.hostname, q: url.searchParams.get('q'), opts });
    return { ok: true, status: 200, json: async () => ({
      results: observed.length < 3
        ? [{ url: 'https://www.example.org/page', title: 'Unrelated' }]
        : [{ url: 'https://fr.linkedin.com/in/charlotte/', title: 'Charlotte | LinkedIn', snippet: 'Directrice' }],
    }) };
  };
  const items = await discoverDegoogProfiles({ baseUrl: 'https://moteur.example.fr', criteria,
    apiKey: 'saved-token-123', fetcher: mock, onAttempt: (x) => attempts.push(x) });
  assert.equal(observed.length, 3);
  assert.ok(observed.every(({ host }) => host === 'moteur.example.fr'));
  assert.ok(observed.every(({ opts }) => opts.headers.Authorization === 'Bearer saved-token-123'));
  assert.ok(observed.every(({ q }) => q.startsWith('site:linkedin.com/in')));
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts.map((v) => v.profiles), [0, 0, 1]);
  assert.equal(items[0].linkedin_url, 'https://www.linkedin.com/in/charlotte/');
});

test('DeGoog : aucun dork exploitable donne un résultat vide avec diagnostic, sans boucle infinie', async () => {
  const criteria = normalizeDiscoveryCriteria({ title: 'CTO' });
  const attempts = [];
  const items = await discoverDegoogProfiles({
    baseUrl: 'https://moteur.example.fr', criteria, onAttempt: (x) => attempts.push(x),
    fetcher: async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }),
  });
  assert.deepEqual(items, []);
  assert.ok(attempts.length >= 2 && attempts.length <= 3);
  assert.ok(attempts.every((x) => x.query.startsWith('site:linkedin.com/in')));
});
