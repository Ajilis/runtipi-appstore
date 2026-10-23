import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Router } from '../server/lib/http.js';
import { registerProspects } from '../server/routes/prospects.js';
import { makeVault } from '../server/lib/crypto.js';
import {
  normalizeDiscoveryCriteria, buildLinkedInDorks, titleOrGroup,
  MAX_SEARCH_TITLES, normalizePublicProfileUrl,
} from '../server/services/discovery.js';

test('multi-postes : le dork crée un OU logique entre chaque titre, les autres filtres restent en ET', () => {
  const criteria = normalizeDiscoveryCriteria({
    titles: ['Directeur commercial', 'Directrice commerciale', 'Head of Sales'],
    title: 'poste initial à remplacer',
    industry: 'SaaS', location: 'Paris', keywords: 'B2B',
  });
  const group = '("Directeur commercial" OR "Directrice commerciale" OR "Head of Sales")';
  assert.equal(titleOrGroup(criteria.titles), group);
  assert.deepEqual(criteria.titles, ['Directeur commercial', 'Directrice commerciale', 'Head of Sales']);
  assert.equal(criteria.title, 'Directeur commercial');
  assert.equal(criteria.searchQuery,
    'site:linkedin.com/in/ ' + group + ' "SaaS" "Paris" "B2B"');
  assert.doesNotMatch(criteria.searchQuery, /poste initial à remplacer/);
  const dorks = buildLinkedInDorks(criteria);
  assert.equal(dorks.length, 3);
  assert.equal(dorks[0], 'site:linkedin.com/in/ ' + group + ' "SaaS" "Paris" "B2B"');
  assert.equal(dorks[1], 'site:linkedin.com/in/ ' + group + ' "Paris"');
  assert.equal(dorks[2], 'site:linkedin.com/in ' + group);
  assert.ok(dorks.every((query) => query.includes(group)));
});

test('multi-postes : suppression de tag ne modifie pas les autres termes du OU', () => {
  const input = { titles: ['CTO', 'Chief Technology Officer', 'Directeur technique'] };
  const first = normalizeDiscoveryCriteria(input);
  assert.equal(first.titles.length, 3);
  const last = normalizeDiscoveryCriteria({ ...input,
    titles: input.titles.filter((name) => name !== 'Chief Technology Officer'),
  });
  assert.equal(last.searchQuery, 'site:linkedin.com/in/ ("CTO" OR "Directeur technique")');
  assert.doesNotMatch(last.searchQuery, /Chief Technology Officer/);
  assert.equal(normalizeDiscoveryCriteria({ title: 'CTO' }).searchQuery, 'site:linkedin.com/in/ "CTO"');
  assert.equal(normalizeDiscoveryCriteria({ titles: ['CTO'] }).searchQuery, 'site:linkedin.com/in/ "CTO"');
  assert.equal(MAX_SEARCH_TITLES, 8);
});

test('multi-postes : validation stricte, limites, pas d’injection de dork ou suppression implicite', () => {
  assert.throws(() => normalizeDiscoveryCriteria({ titles: new Array(9).fill('CTO') }), /8 intitulés/);
  assert.throws(() => normalizeDiscoveryCriteria({ titles: 'CTO' }), /8 intitulés/);
  assert.throws(() => normalizeDiscoveryCriteria({ titles: [null] }), /8 intitulés/);
  assert.throws(() => normalizeDiscoveryCriteria({ titles: ['x'.repeat(71)] }), /8 intitulés/);
  assert.throws(() => normalizeDiscoveryCriteria({ titles: [] }), /Indiquez/);
  const sanitized = normalizeDiscoveryCriteria({
    titles: ['  Directrice RH  ', 'directrice rh', 'DRH " OR site:evil.com', 'CFO\nCTO'],
  });
  assert.equal(sanitized.titles.length, 3);
  assert.ok(sanitized.searchQuery.startsWith('site:linkedin.com/in/ ('));
  assert.doesNotMatch(sanitized.searchQuery, /" OR site:evil\.com/);
  assert.match(sanitized.searchQuery, /"DRH OR site:evil.com"/);
  assert.equal(normalizeDiscoveryCriteria({
    titles: [], location: 'Paris', title: 'ne doit pas être réinjecté',
  }).searchQuery, 'site:linkedin.com/in/ "Paris"');
  assert.equal(normalizePublicProfileUrl('https://fr.linkedin.com/in/marie-dupont'),
    'https://www.linkedin.com/in/marie-dupont/');
});

function makeRoute() {
  const vault = makeVault('tag-search-tester');
  const calls = [], mutations = [];
  const ws = { id: 'w1', settings: {
    discovery: { provider: 'degoog', base_url: 'https://moteur.example.fr', api_key_enc: vault.encrypt('secret-token-test') },
    icp: { titles: ['Mot-clé campagne original'] },
  } };
  const router = new Router();
  registerProspects(router, {
    vault, ai: {}, agent: {},
    db: { async query(...args) { mutations.push(args); throw Error('No SQL writes during search'); } },
  }, { requireAuth: async (ctx) => { ctx.state.ws = ws; ctx.state.user = { id: 'tester' }; },
    requireAdmin: async () => {},
  }, {
    fetcher: async (url, options) => {
      calls.push({ url, options });
      const page = Number(url.searchParams.get('page'));
      return { ok: true, status: 200, json: async () => ({
        totalPages: 3, results: [
          { url: 'https://www.linkedin.com/in/profil-page-' + page + '/', title: 'Profil | LinkedIn' },
        ],
      }) };
    },
  });
  const invoke = async (body, id = 'tester') => {
    const matched = router.match('POST', '/api/discovery/search');
    const ctx = { state: {}, json: async () => body };
    let out;
    for (const fn of matched.route.handlers) out = await fn(ctx);
    return out;
  };
  return { calls, invoke, mutations };
}

test('DeGoog : OR réellement envoyé sur page 1 et page 2, sans lecture LinkedIn ni import', async () => {
  const h = makeRoute();
  const titles = ['Responsable RH', 'Human Resources Director'];
  const input = { titles, location: 'Lyon', limit: 20 };
  const first = await h.invoke(input);
  assert.equal(first.items.length, 1);
  assert.equal(first.query, 'site:linkedin.com/in/ ("Responsable RH" OR "Human Resources Director") "Lyon"');
  assert.equal(first.page, 1);
  // Existing DeGoog rate limit requires one second between page loads.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const page2 = await h.invoke({ ...input, page: 2, dork_index: first.dork_index });
  assert.equal(page2.page, 2);
  assert.equal(page2.query, first.query);
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every((c) => c.url.hostname === 'moteur.example.fr'));
  assert.ok(h.calls.every((c) => c.url.searchParams.get('q') === first.query));
  assert.ok(h.calls.every((c) => c.options.headers.Authorization === 'Bearer secret-token-test'));
  assert.equal(h.mutations.length, 0);
});

test('interface : tags colorés, croix par tag, choix cumulatif et pagination sans perte des filtres', () => {
  const ui = fs.readFileSync(new URL('../web/src/pages/Prospects.jsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../web/src/styles.css', import.meta.url), 'utf8');
  assert.match(ui, /titleTags\.map/);
  assert.match(ui, /className=\{.job-title-tag job-title-tag-/);
  assert.match(ui, /aria-label=\{.Retirer le poste/);
  assert.match(ui, /<LuX \/>/);
  assert.match(ui, /setTitleTags\(\(prev\) => \[\.\.\.prev, title\]\)/);
  assert.match(ui, /titleTags\.length\s*\?\s*\{ titles: titleTags \}/);
  assert.match(ui, /titleTagsEdited \? '' : fromCampaign/);
  assert.match(ui, /body: \{ \.\.\.searchedInput, page: searchInfo.page \+ 1, dork_index: searchInfo.dork_index \}/);
  assert.match(ui, /Ajouter ce poste/);
  assert.match(css, /\.job-title-selector/);
  assert.match(css, /\.job-title-tag-0/);
  assert.match(css, /\.job-title-tag-remove/);
});
