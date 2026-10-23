import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Router } from '../server/lib/http.js';
import { makeVault } from '../server/lib/crypto.js';
import { registerProspects } from '../server/routes/prospects.js';
import {
  normalizeDiscoveryCriteria, normalizePublicProfileUrl, normalizeSearchResults, discoverPublicProfiles,
} from '../server/services/discovery.js';

test('critères : requête index public, limite stricte et garde-fous', () => {
  const a = normalizeDiscoveryCriteria({ limit: 90 }, {
    titles: ['Directeur marketing'], industries: ['SaaS'], locations: ['Paris'], keywords: [],
  });
  assert.equal(a.limit, 50);
  assert.match(a.searchQuery, /^site:linkedin\.com\/in\//);
  assert.match(a.searchQuery, /Directeur marketing/);
  assert.match(a.searchQuery, /Paris/);
  assert.throws(() => normalizeDiscoveryCriteria({}, {}), /Indiquez/);
  assert.equal(normalizeDiscoveryCriteria({ title: '  CFO " OR site:evil.test  ', limit: -7 }).limit, 1);
});

test('ne retient que les profils LinkedIn valides, normalisés et uniques', () => {
  const data = { web: { results: [
    { url: 'https://www.linkedin.com/in/camille-dupont/?trk=abc', title: 'Camille Dupont - LinkedIn', description: 'Directrice marketing' },
    { url: 'https://linkedin.com/in/camille-dupont/', title: 'doublon' },
    { url: 'https://www.linkedin.com/feed/', title: 'Feed LinkedIn' },
    { url: 'https://linkedin.com.attacker.example/in/moi/', title: 'Faux LinkedIn' },
    { url: 'http://linkedin.com/in/sam/', title: 'HTTP exclu' },
    { url: 'https://www.linkedin.com/in/leo-bernard/', title: 'Léo Bernard | LinkedIn', description: '<b>PDG</b>' },
  ] } };
  const found = normalizeSearchResults(data, 20);
  assert.equal(found.length, 2);
  assert.equal(found[0].linkedin_url, 'https://www.linkedin.com/in/camille-dupont/');
  assert.equal(found[0].title, 'Camille Dupont');
  assert.equal(found[1].description, 'PDG');
  assert.equal(normalizePublicProfileUrl('https://www.linkedin.com/in/leo-bernard/#about'), 'https://www.linkedin.com/in/leo-bernard/');
});

test('appel API Brave seulement (jamais LinkedIn), clé dans en-tête non exposée', async () => {
  let calls = 0;
  const criteria = normalizeDiscoveryCriteria({ title: 'Directeur marketing', location: 'Paris', limit: 3 });
  const result = await discoverPublicProfiles({
    apiKey: 'test-api-key-0123456', criteria,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url.hostname, 'api.search.brave.com');
      assert.equal(url.pathname, '/res/v1/web/search');
      assert.match(url.searchParams.get('q'), /site:linkedin\.com\/in\//);
      assert.equal(url.searchParams.get('count'), '3');
      assert.equal(options.headers['X-Subscription-Token'], 'test-api-key-0123456');
      assert.equal(options.redirect, 'error');
      assert.equal(options.method, 'GET');
      return { ok: true, status: 200, json: async () => ({ web: { results: [
        { url: 'https://www.linkedin.com/in/camille/', title: 'Camille Dupont | LinkedIn' },
      ] } }) };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /test-api-key-0123456/);
});

test('réponse erreur externe ne divulgue jamais la clé ni le corps du fournisseur', async () => {
  const criteria = normalizeDiscoveryCriteria({ title: 'CEO' });
  await assert.rejects(
    () => discoverPublicProfiles({ apiKey: 'api-secret-123456', criteria,
      fetcher: async () => { throw new Error('API KEY api-secret-123456'); } }),
    /temporairement inaccessible/,
  );
  await assert.rejects(
    () => discoverPublicProfiles({ apiKey: 'api-secret-123456', criteria,
      fetcher: async () => ({ status: 429, ok: false }) }),
    /Limite de requêtes Brave/,
  );
});

function harness() {
  const vault = makeVault('test-discovery-secret');
  const saved = [];
  const searches = [];
  const ws = { id: 'workspace-a', settings: { icp: { titles: ['Directeur marketing'] }, discovery: {} } };
  const db = { async query(sql, params) {
    if (sql.startsWith('UPDATE workspaces SET settings = jsonb_set')) {
      ws.settings.discovery = JSON.parse(params[1]);
      return { rows: [] };
    }
    if (sql.includes('SELECT c.id FROM campaigns c JOIN accounts a')) {
      return { rows: params[0] === 'assisted-campaign' && params[1] === ws.id ? [{ id: params[0] }] : [] };
    }
    throw new Error('Unexpected SQL: ' + sql);
  } };
  const agent = { importProspects: async (workspace, items, options) => {
    saved.push({ workspace, items, options });
    return { created: items.length, duplicates: 0, invalid: 0, ids: [] };
  } };
  const router = new Router();
  registerProspects(router, { db, agent, vault }, {
    requireAuth: async (ctx) => { ctx.state.user = { id: 'user-a' }; ctx.state.ws = ws; },
    requireAdmin: async () => {},
  }, {
    fetcher: async (url, options) => {
      searches.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ web: { results: [
        { url: 'https://www.linkedin.com/in/camille/', title: 'Camille Dupont - LinkedIn' },
        { url: 'https://www.linkedin.com/in/sam/', title: 'Sam Martin - LinkedIn' },
      ] } }) };
    },
  });
  async function invoke(method, path, body = {}) {
    const match = router.match(method, path);
    assert.ok(match);
    const ctx = { state: {}, params: match.params, json: async () => body };
    let data;
    for (const handler of match.route.handlers) data = await handler(ctx);
    return data;
  }
  return { ws, vault, saved, searches, invoke };
}

test('la clé Brave est chiffrée, masquée, et la recherche ne crée aucun prospect', async () => {
  const h = harness();
  assert.equal((await h.invoke('GET', '/api/discovery/config')).has_api_key, false);
  await assert.rejects(() => h.invoke('POST', '/api/discovery/search', { title: 'CEO' }), /Configurez/);
  const saved = await h.invoke('POST', '/api/discovery/config', { api_key: 'my-very-private-brave-key' });
  assert.deepEqual(saved, { provider: 'brave', has_api_key: true });
  assert.notEqual(h.ws.settings.discovery.brave_api_key_enc, 'my-very-private-brave-key');
  assert.equal(h.vault.decrypt(h.ws.settings.discovery.brave_api_key_enc), 'my-very-private-brave-key');
  const response = await h.invoke('POST', '/api/discovery/search', { title: 'marketing', limit: 10 });
  assert.equal(response.items.length, 2);
  assert.equal(h.saved.length, 0);
  assert.equal(h.searches.length, 1);
  assert.doesNotMatch(JSON.stringify(response), /my-very-private-brave-key/);
  await assert.rejects(() => h.invoke('POST', '/api/discovery/search', { title: 'CEO' }), /10 secondes/);
});

test('import explicitement validé : isolation et nombre maximum de profils', async () => {
  const h = harness();
  const items = [{ linkedin_url: 'https://www.linkedin.com/in/camille/?trk=web', full_name: 'Camille Dupont' }];
  await assert.rejects(
    () => h.invoke('POST', '/api/discovery/import', { items, campaign_id: 'outside-workspace' }),
    /Campagne indisponible/,
  );
  assert.equal(h.saved.length, 0);
  await assert.rejects(
    () => h.invoke('POST', '/api/discovery/import', { items: new Array(201).fill(items[0]) }),
    /1 et 200/,
  );
  await assert.rejects(
    () => h.invoke('POST', '/api/discovery/import', { items: [{ linkedin_url: 'https://evil.example.com/in/test/' }] }),
    /URL de profil/,
  );
  const result = await h.invoke('POST', '/api/discovery/import', { items, campaign_id: 'assisted-campaign' });
  assert.equal(result.created, 1);
  assert.equal(h.saved[0].items[0].linkedin_url, 'https://www.linkedin.com/in/camille/');
  assert.equal(h.saved[0].options.campaignId, 'assisted-campaign');
  assert.equal(h.saved[0].options.source, 'public_web_search');
});

test('interface : résultats affichés pour approbation avant appel d’import et clé jamais réaffichée', () => {
  const ui = fs.readFileSync(new URL('../web/src/pages/Prospects.jsx', import.meta.url), 'utf8');
  const core = fs.readFileSync(new URL('../server/routes/core.js', import.meta.url), 'utf8');
  assert.match(ui, /api\/discovery\/search/);
  assert.match(ui, /api\/discovery\/import/);
  assert.match(ui, /api\/discovery\/config/); // lecture de l'état uniquement
  assert.doesNotMatch(ui, /Enregistrer la clé|saveKey/);
  assert.match(fs.readFileSync(new URL('../web/src/components/SearchSettings.jsx', import.meta.url), 'utf8'), /api\/discovery\/config/);
  assert.match(ui, /checked=\{!!chosen\[item\.linkedin_url\]\}/);
  assert.match(ui, /Import(er|er les).*profils sélectionnés/);
  assert.match(core, /delete out\.ai\.api_key_enc/);
  assert.match(core, /out\.discovery = \{/);
});
