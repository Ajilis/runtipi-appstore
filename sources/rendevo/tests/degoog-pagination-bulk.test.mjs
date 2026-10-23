import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Router } from '../server/lib/http.js';
import { makeVault } from '../server/lib/crypto.js';
import { registerProspects } from '../server/routes/prospects.js';
import {
  discoverDegoogPage, normalizeDiscoveryCriteria, DEGOOG_MAX_PAGES, DISCOVERY_IMPORT_MAX,
} from '../server/services/discovery.js';

test('DeGoog accepte page=1,2,3 et totalPages pour paginer un dork stable', async () => {
  const criteria = normalizeDiscoveryCriteria({ title: 'Directeur technique', industry: 'SaaS', limit: 20 });
  const calls = [];
  const fetcher = async (url, options) => {
    const page = Number(url.searchParams.get('page'));
    calls.push({ url, options });
    return {
      status: 200, ok: true,
      json: async () => ({
        totalPages: 3,
        results: Array.from({ length: 12 }, (_, i) => ({
          url: `https://www.linkedin.com/in/test-page-${page}-${i}/`,
          title: `Profil page ${page} ${i} | LinkedIn`,
          snippet: 'CTO',
        })),
      }),
    };
  };
  const initial = await discoverDegoogPage({ baseUrl: 'https://degoog.example.fr', criteria, fetcher });
  assert.equal(initial.page, 1);
  assert.equal(initial.total_pages, 3);
  assert.equal(initial.has_more, true);
  assert.equal(initial.items.length, 12);
  assert.equal(calls[0].url.searchParams.get('page'), '1');
  const next = await discoverDegoogPage({
    baseUrl: 'https://degoog.example.fr', criteria, fetcher, page: 2, dorkIndex: initial.dork_index,
  });
  assert.equal(next.page, 2);
  assert.equal(next.items.length, 12);
  assert.equal(next.query, initial.query);
  assert.equal(next.items[0].linkedin_url, 'https://www.linkedin.com/in/test-page-2-0/');
  const last = await discoverDegoogPage({ baseUrl: 'https://degoog.example.fr', criteria, fetcher, page: 3 });
  assert.equal(last.has_more, false);
  assert.equal(last.total_pages, 3);
  assert.equal(calls[1].url.searchParams.get('page'), '2');
  assert.ok(calls.every((c) => c.url.hostname === 'degoog.example.fr'));
});

test('DeGoog without totalPages uses non-empty raw result pages to bound navigation', async () => {
  const criteria = normalizeDiscoveryCriteria({ title: 'CEO' });
  const attempts = [];
  const res = await discoverDegoogPage({
    baseUrl: 'https://degoog.example.fr', criteria, page: 2, dorkIndex: 0,
    onAttempt: (item) => attempts.push(item),
    fetcher: async (url) => ({
      status: 200, ok: true, json: async () => ({
        results: Number(url.searchParams.get('page')) === 2
          ? [{ url: 'https://www.linkedin.com/in/ceo-two/', title: 'CEO' }] : [],
      }),
    }),
  });
  assert.equal(res.has_more, true);
  assert.equal(res.total_pages, null);
  assert.equal(res.items.length, 1);
  assert.equal(attempts.length, 1, 'pages suivantes : pas de dorks différents mélangés');
  assert.equal(attempts[0].page, 2);
  const empty = await discoverDegoogPage({
    baseUrl: 'https://degoog.example.fr', criteria, page: 3,
    fetcher: async () => ({ status: 200, ok: true, json: async () => ({ results: [] }) }),
  });
  assert.equal(empty.has_more, false);
  for (const page of [0, -1, DEGOOG_MAX_PAGES + 1, 1.2]) {
    await assert.rejects(() => discoverDegoogPage({
      baseUrl: 'https://degoog.example.fr', criteria, page, fetcher: async () => { throw Error('Must not fetch'); },
    }), /Page de recherche DeGoog invalide/);
  }
  assert.equal(DISCOVERY_IMPORT_MAX, 200);
});

test('route DeGoog paginée : même moteur et clé chiffrée, métadonnées sans fuite', async () => {
  const vault = makeVault('secret-pages-testing');
  const ws = { id: 'ws-test-pages', settings: {
    icp: {}, discovery: {
      provider: 'degoog', base_url: 'https://moteur.example.fr',
      api_key_enc: vault.encrypt('secret-bearer-123'),
    },
  } };
  const requested = [];
  const router = new Router();
  const db = { query: async () => { throw Error('No DB mutation during public search'); } };
  registerProspects(router, { db, vault, agent: {} }, {
    requireAuth: async (ctx) => { ctx.state.user = { id: 'test-user' }; ctx.state.ws = ws; },
    requireAdmin: async () => {},
  }, {
    fetcher: async (url, opts) => {
      requested.push({ page: url.searchParams.get('page'), opts });
      return { status: 200, ok: true, json: async () => ({
        results: [{ url: `https://www.linkedin.com/in/profile-page-${url.searchParams.get('page')}/`, title: 'LinkedIn' }],
        totalPages: 4,
      }) };
    },
  });
  const matched = router.match('POST', '/api/discovery/search');
  const handle = async (body) => {
    const ctx = { state: {}, json: async () => body };
    let value;
    for (const fn of matched.route.handlers) value = await fn(ctx);
    return value;
  };
  const first = await handle({ title: 'CTO', page: 1 });
  assert.equal(first.found, 1);
  assert.equal(first.has_more, true);
  assert.equal(first.total_pages, 4);
  await assert.rejects(() => handle({ title: 'CTO', page: 1 }), /10 secondes/);
  // An earlier page request has already updated rate limits; wait-free test
  // uses a distinct scoped user to validate payload, then tests page 2.
  const other = router.match('POST', '/api/discovery/search');
  const secondCtx = { state: {}, json: async () => ({ title: 'CTO', page: 2, dork_index: first.dork_index }) };
  await other.route.handlers[0](secondCtx);
  secondCtx.state.user = { id: 'other-user' };
  const second = await other.route.handlers.at(-1)(secondCtx);
  assert.equal(second.page, 2);
  assert.equal(second.items[0].linkedin_url, 'https://www.linkedin.com/in/profile-page-2/');
  assert.equal(second.has_more, true);
  assert.equal(requested.length, 2);
  assert.equal(requested[1].opts.headers.Authorization, 'Bearer secret-bearer-123');
  assert.doesNotMatch(JSON.stringify(second), /secret-bearer-123/);
  for (const page of [0, 21, 'random', 1.5]) {
    await assert.rejects(() => handle({ title: 'CTO', page }), /Page de recherche invalide/);
  }
});

test('React : sélection conservée entre pages et import de 200 profils maximum', () => {
  const ui = fs.readFileSync(new URL('../web/src/pages/Prospects.jsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../server/routes/prospects.js', import.meta.url), 'utf8');
  assert.match(ui, /value="infinite"/);
  assert.match(ui, /value="pages"/);
  assert.match(ui, /IntersectionObserver/);
  assert.match(ui, /Charger la page suivante/);
  assert.match(ui, /dork_index: searchInfo.dork_index/);
  assert.match(ui, /new Set\(\(results \|\| \[\]\)\.map\(\(item\) => item.linkedin_url\)\)/);
  assert.match(ui, /chosenItems\.map/);
  assert.match(api, /DISCOVERY_IMPORT_MAX/);
  assert.match(api, /body\.items\.length > DISCOVERY_IMPORT_MAX/);
  assert.doesNotMatch(api, /Sélectionnez entre 1 et 20 profils/);
});
