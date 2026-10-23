import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Router } from '../server/lib/http.js';
import { makeVault } from '../server/lib/crypto.js';
import { registerProspects } from '../server/routes/prospects.js';
import {
  normalizeDegoogUrl, normalizeDegoogResults, discoverDegoogProfiles, normalizeDiscoveryCriteria,
} from '../server/services/discovery.js';

test('DeGoog : valide strictement l’adresse du moteur, pas de protocoles dangereux', () => {
  assert.equal(normalizeDegoogUrl('https://search.exemple.fr/'), 'https://search.exemple.fr');
  assert.equal(normalizeDegoogUrl('https://search.exemple.fr/api/search'), 'https://search.exemple.fr');
  assert.equal(normalizeDegoogUrl('http://192.168.1.21:4444'), 'http://192.168.1.21:4444');
  assert.equal(normalizeDegoogUrl('http://127.0.0.1:4444'), 'http://127.0.0.1:4444');
  for (const url of [
    '', 'http://exemple.fr', 'ftp://exemple.fr', 'file:///etc/passwd', 'http://169.254.169.254/latest',
    'https://search.exemple.fr/admin', 'https://search.exemple.fr/api/search?token=test',
    'https://user:pass@search.exemple.fr', 'https://search.exemple.fr/#fragment',
    'http://192.168.300.1:4444', 'https://*.example.fr', 'http://8.8.8.8:4444',
  ]) assert.throws(() => normalizeDegoogUrl(url), url);
});

test('DeGoog : recherche JSON native, Bearer optionnel, filtrage LinkedIn sécurisé', async () => {
  const criteria = normalizeDiscoveryCriteria({ title: 'Responsable marketing', location: 'Paris', limit: 5 });
  const calls = [];
  const mock = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({
      results: [
        { url: 'https://www.linkedin.com/in/lea-dupond/?trk=evil', title: 'Léa Dupond | LinkedIn', snippet: '<b>Directrice</b> commerciale' },
        { url: 'https://www.linkedin.com/in/lea-dupond/', title: 'Duplicate' },
        { url: 'https://linkedin.com.attacker.test/in/fake', title: 'Fake' },
        { url: 'https://www.linkedin.com/feed/', title: 'Feed' },
        { url: 'https://www.linkedin.com/in/pierre/', title: 'Pierre | LinkedIn', snippet: 'CTO' },
      ],
    }) };
  };
  const items = await discoverDegoogProfiles({ baseUrl: 'https://recherche.exemple.fr', criteria, apiKey: 'secret-private-123', fetcher: mock });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.href.startsWith('https://recherche.exemple.fr/api/search?q='), true);
  assert.equal(calls[0].url.searchParams.get('type'), 'web');
  assert.equal(calls[0].url.searchParams.get('lang'), 'fr');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-private-123');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(items.length, 2);
  assert.equal(items[0].linkedin_url, 'https://www.linkedin.com/in/lea-dupond/');
  assert.equal(items[0].description, 'Directrice commerciale');
  assert.equal(items[1].linkedin_url, 'https://www.linkedin.com/in/pierre/');
  assert.doesNotMatch(JSON.stringify(items), /secret-private-123/);
  calls.length = 0;
  await discoverDegoogProfiles({ baseUrl: 'https://recherche.exemple.fr', criteria, fetcher: mock });
  assert.equal(calls[0].options.headers.Authorization, undefined, 'no API token needed for open instance');
  assert.deepEqual(normalizeDegoogResults({ results: [] }, 10), []);
});

test('DeGoog : erreurs filtrées, aucune fuite des secrets du fournisseur', async () => {
  const criteria = normalizeDiscoveryCriteria({ title: 'CTO' });
  await assert.rejects(
    () => discoverDegoogProfiles({ baseUrl: 'https://search.exemple.fr', apiKey: 'super-secret-key', criteria,
      fetcher: async () => { throw Error('credentials super-secret-key'); } }),
    /temporairement inaccessible/,
  );
  await assert.rejects(
    () => discoverDegoogProfiles({ baseUrl: 'https://search.exemple.fr', criteria,
      fetcher: async () => ({ ok: false, status: 401 }) }),
    /Clé API DeGoog invalide/,
  );
  await assert.rejects(
    () => discoverDegoogProfiles({ baseUrl: 'https://search.exemple.fr', criteria,
      fetcher: async () => ({ ok: true, status: 200, json: async () => ({ wrong: true }) }) }),
    /Format de réponse DeGoog invalide/,
  );
});

function harness() {
  const ws = { id: 'ws-degoog', settings: { icp: { titles: ['Directeur'] }, discovery: {} } };
  const vault = makeVault('encryption-key-test');
  const calls = [], saved = [];
  const db = { async query(sql, params) {
    if (sql.startsWith('UPDATE workspaces SET settings = jsonb_set')) {
      ws.settings.discovery = JSON.parse(params[1]);
      return { rows: [] };
    }
    throw Error('Unexpected SQL ' + sql);
  } };
  const router = new Router();
  registerProspects(router, {
    db, vault,
    agent: { importProspects: async () => { saved.push(true); return { created: 1 }; } },
  }, {
    requireAuth: async (ctx) => { ctx.state.user = { id: 'user-test' }; ctx.state.ws = ws; },
    requireAdmin: async () => {},
  }, {
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ results: [
        { url: 'https://www.linkedin.com/in/julie/', title: 'Julie | LinkedIn', snippet: 'Directrice' },
      ] }) };
    },
  });
  async function invoke(method, path, body = {}) {
    const m = router.match(method, path);
    assert.ok(m, path);
    const ctx = { state: {}, params: m.params, json: async () => body, header: () => {} };
    let value;
    for (const handler of m.route.handlers) value = await handler(ctx);
    return value;
  }
  return { ws, vault, calls, saved, invoke };
}

async function tested(h, payload) {
  const result = await h.invoke('POST', '/api/discovery/test', payload);
  assert.equal(result.ok, true);
  assert.match(result.test_token, /^[a-zA-Z0-9_-]{32}$/);
  return result.test_token;
}

test('API : URL DeGoog et clé chiffrée, lecture masquée, pas d’import automatique', async () => {
  const h = harness();
  assert.deepEqual(await h.invoke('GET', '/api/discovery/config'), {
    provider: 'degoog', base_url: '', has_api_key: false, configured: false,
  });
  const firstPayload = {
    provider: 'degoog', base_url: 'https://search.exemple.fr/', api_key: 'my-degoog-secret-123',
  };
  await assert.rejects(() => h.invoke('POST', '/api/discovery/config', firstPayload),
    /Teste d’abord la connexion/);
  assert.equal(h.ws.settings.discovery.base_url, undefined, 'aucune écriture avant le test');
  const token = await tested(h, firstPayload);
  const configured = await h.invoke('POST', '/api/discovery/config', {
    ...firstPayload, test_token: token,
  });
  assert.deepEqual(configured, {
    provider: 'degoog', base_url: 'https://search.exemple.fr', has_api_key: true, configured: true,
  });
  assert.notEqual(h.ws.settings.discovery.api_key_enc, 'my-degoog-secret-123');
  assert.equal(h.vault.decrypt(h.ws.settings.discovery.api_key_enc), 'my-degoog-secret-123');
  const get = await h.invoke('GET', '/api/discovery/config');
  assert.doesNotMatch(JSON.stringify(get), /my-degoog-secret-123|api_key_enc/);
  const results = await h.invoke('POST', '/api/discovery/search', { title: 'CTO', limit: 5 });
  assert.equal(results.provider, 'degoog');
  assert.equal(results.items.length, 1);
  assert.equal(h.calls.at(-1).options.headers.Authorization, 'Bearer my-degoog-secret-123');
  assert.equal(h.saved.length, 0);
  const keepPayload = { provider: 'degoog', base_url: 'https://search.exemple.fr' };
  const keepToken = await tested(h, keepPayload);
  assert.equal(h.calls.at(-1).options.headers.Authorization, 'Bearer my-degoog-secret-123',
    'utilise la clé enregistrée pour le même serveur');
  const retained = await h.invoke('POST', '/api/discovery/config', {
    ...keepPayload, test_token: keepToken,
  });
  assert.equal(retained.has_api_key, true);
  const clearPayload = { provider: 'degoog', base_url: 'https://search.exemple.fr', clear_key: true };
  const clearToken = await tested(h, clearPayload);
  assert.equal(h.calls.at(-1).options.headers.Authorization, undefined,
    'ne transmet pas la clé quand supprimer est coché');
  const cleared = await h.invoke('POST', '/api/discovery/config', {
    ...clearPayload, test_token: clearToken,
  });
  assert.equal(cleared.has_api_key, false);
  assert.equal(h.ws.settings.discovery.api_key_enc, '');
});

test('API : refuse URLs invalides, requiert admin pour enregistrer, préserve la clé Brave existante', async () => {
  const h = harness();
  await assert.rejects(
    () => h.invoke('POST', '/api/discovery/config', { provider: 'degoog', base_url: 'http://public.example.fr' }),
    /URL DeGoog refusée/,
  );
  const saved = await h.invoke('POST', '/api/discovery/config', { api_key: 'existing-brave-token' });
  assert.deepEqual(saved, { provider: 'brave', has_api_key: true });
  assert.equal(h.ws.settings.discovery.provider, 'brave');
  assert.equal(h.vault.decrypt(h.ws.settings.discovery.brave_api_key_enc), 'existing-brave-token');
  const payload = { provider: 'degoog', base_url: 'https://search.exemple.fr' };
  const token = await tested(h, payload);
  const migrated = await h.invoke('POST', '/api/discovery/config', { ...payload, test_token: token });
  assert.equal(migrated.configured, true);
  assert.equal(migrated.has_api_key, false);
});

test('interface : le moteur est exclusivement dans Réglages → Recherche et le popup affiche les versions', () => {
  const settings = fs.readFileSync(new URL('../web/src/pages/Settings.jsx', import.meta.url), 'utf8');
  const engineUi = fs.readFileSync(new URL('../web/src/components/SearchSettings.jsx', import.meta.url), 'utf8');
  const prospects = fs.readFileSync(new URL('../web/src/pages/Prospects.jsx', import.meta.url), 'utf8');
  const popup = fs.readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  const extensionJs = fs.readFileSync(new URL('../extension/popup.js', import.meta.url), 'utf8');
  const companionServer = fs.readFileSync(new URL('../server/routes/companion.js', import.meta.url), 'utf8');
  assert.match(settings, /'recherche', 'Recherche'/);
  assert.match(settings, /<SearchSettings \/>/);
  assert.match(engineUi, /type="url"/);
  assert.match(engineUi, /type="password"/);
  assert.match(engineUi, /\/api\/discovery\/config/);
  assert.match(engineUi, /\/api\/discovery\/test/);
  assert.match(engineUi, /Tester la connexion/);
  assert.match(engineUi, /!proof \|\| proof\.fingerprint !== fingerprint/);
  assert.doesNotMatch(prospects, /saveKey|Enregistrer la clé|Clé API Brave Search/);
  assert.match(prospects, /tab=recherche/);
  assert.match(popup, /id="rendevoVersion"/);
  assert.match(popup, /id="companionVersion"/);
  assert.match(extensionJs, /state\.rendevo_version/);
  assert.match(companionServer, /rendevo_version: deps\.config/);
});

test('DeGoog : le serveur interdit la sauvegarde sans test, un test modifié ou réutilisé', async () => {
  const h = harness();
  const payload = { provider: 'degoog', base_url: 'https://search.exemple.fr', api_key: 'secret-one-1234' };
  const proof = await tested(h, payload);
  const original = h.ws.settings.discovery;
  await assert.rejects(() => h.invoke('POST', '/api/discovery/config', {
    ...payload, api_key: 'secret-two-1234', test_token: proof,
  }), /Teste d’abord/);
  await assert.rejects(() => h.invoke('POST', '/api/discovery/config', {
    ...payload, base_url: 'https://nouveau.exemple.fr', test_token: proof,
  }), /Teste d’abord/);
  assert.deepEqual(h.ws.settings.discovery, original);
  const saved = await h.invoke('POST', '/api/discovery/config', { ...payload, test_token: proof });
  assert.equal(saved.configured, true);
  await assert.rejects(() => h.invoke('POST', '/api/discovery/config', {
    ...payload, test_token: proof,
  }), /Teste d’abord/, 'preuve à usage unique');
});

test('DeGoog : test invalide, clé refusée et réponse malformée n’enregistrent rien', async () => {
  const payload = { base_url: 'https://search.exemple.fr', api_key: 'secret-failure-123' };
  for (const mode of ['bad-key', 'bad-format', 'timeout']) {
    const h = harness();
    // Tests on an isolated router using the same workspace object but failing remote API.
    const router = new Router();
    registerProspects(router, { db: { query: async () => { throw Error('Should never persist'); } },
      vault: h.vault, agent: {} }, {
      requireAuth: async (ctx) => { ctx.state.ws = h.ws; ctx.state.user = { id: 'user-test' }; },
      requireAdmin: async () => {},
    }, {
      fetcher: async () => {
        if (mode === 'bad-key') return { ok: false, status: 401 };
        if (mode === 'bad-format') return { ok: true, status: 200, json: async () => ({ invalid: true }) };
        throw Error('external response leaked secret-failure-123');
      },
    });
    const route = router.match('POST', '/api/discovery/test');
    const ctx = { state: {}, json: async () => payload, header: () => {} };
    await assert.rejects(async () => {
      for (const handler of route.route.handlers) await handler(ctx);
    }, mode === 'bad-key' ? /Clé API DeGoog invalide/
      : mode === 'bad-format' ? /Format de réponse DeGoog invalide/
        : /temporairement inaccessible/);
    assert.deepEqual(h.ws.settings.discovery, {});
  }
});

test('DeGoog : changement de serveur sans nouvelle clé ne transmet pas une ancienne clé', async () => {
  const h = harness();
  const first = { provider: 'degoog', base_url: 'https://premier.exemple.fr', api_key: 'secret-premier-123' };
  await h.invoke('POST', '/api/discovery/config', { ...first, test_token: await tested(h, first) });
  const second = { provider: 'degoog', base_url: 'https://second.exemple.fr' };
  const proof = await tested(h, second);
  assert.equal(h.calls.at(-1).options.headers.Authorization, undefined,
    'ancienne clé jamais envoyée au nouveau serveur');
  const result = await h.invoke('POST', '/api/discovery/config', { ...second, test_token: proof });
  assert.equal(result.has_api_key, false);
  assert.equal(h.ws.settings.discovery.api_key_enc, '');
});
