import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Router } from '../server/lib/http.js';
import { registerProspects } from '../server/routes/prospects.js';
import { normalizeJobKeyword, professionalTitlePrompt, normalizeProfessionalTitles } from '../server/services/job-titles.js';

test('mot-clé : respecte le champ Poste recherché, interdit valeurs vides et caractères de contrôle', () => {
  assert.equal(normalizeJobKeyword('  Directeur   commercial  '), 'Directeur commercial');
  for (const v of [undefined, null, '', '  ', 'a', 'x'.repeat(91), 'chef\nDROP', '<command>']) {
    assert.throws(() => normalizeJobKeyword(v), /mot-clé|Poste recherché/);
  }
});

test('prompt : reprend les huit instructions demandées, sans catégories officielles LinkedIn', () => {
  const p = professionalTitlePrompt('Directeur technique');
  for (const fragment of [
    'Tu es un expert en classification des fonctions professionnelles',
    '**Mot-clé fourni :** "Directeur technique"',
    'variantes d'intitulés utilisées en France', 'formes masculines, féminines',
    'hiérarchiquement ou institutionnellement', 'anciennes fonctions et les titres honorifiques',
    'traductions anglaises pertinentes', 'sans doublons', 'fonctions voisines pertinentes',
    'catégories officielles de LinkedIn', 'Catégorie', 'Intitulé principal',
    'Variantes et synonymes LinkedIn', 'Lien avec le mot-clé',
  ]) assert.ok(p.includes(fragment), fragment);
  assert.match(p, /\{"rows":/);
});

test('tableau IA : retire doublons accents, variantes répétées, HTML et champs dangereux', () => {
  const result = normalizeProfessionalTitles({ rows: [
    { category: 'Direction', title: 'Directeur commercial', variants: [
      'Directrice commerciale', 'Head of Sales', 'HEAD OF SALES', 'Directeur commercial',
    ], relation: 'Fonction actuelle' },
    { category: 'Direction', title: 'Directeur commercial', variants: [], relation: '' },
    { category: 'Historique', title: 'Directeur commercial', variants: [], relation: 'Ancienne fonction' },
    { category: 'Proximité', title: 'Responsable grands comptes', variants: 'Key Account Manager; Directrice grands comptes',
      relation: '<b>Fonction voisine</b>' },
    { category: '<script>alert(1)</script>', title: '   ', variants: [], relation: 'ignorer' },
  ] });
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    category: 'Direction', title: 'Directeur commercial',
    variants: ['Directrice commerciale', 'Head of Sales'],
    relation: 'Fonction actuelle',
  });
  assert.equal(result[1].relation, 'Fonction voisine');
  assert.deepEqual(result[1].variants, ['Key Account Manager', 'Directrice grands comptes']);
  assert.throws(() => normalizeProfessionalTitles({ rows: [] }), /aucun intitulé/);
  assert.throws(() => normalizeProfessionalTitles({ data: [] }), /tableau de fonctions absent/);
});

function harness({ aiEnabled = true, output, failure } = {}) {
  const workspace = { id: 'ws-1', settings: { ai: { provider: 'openai', model: 'model-active' } } };
  const prompts = [], mutated = [], headers = [];
  const ai = {
    enabled(ws) { assert.equal(ws, workspace); return aiEnabled; },
    async completeJson(ws, opts) {
      assert.equal(ws, workspace);
      prompts.push(opts);
      if (failure) throw Error('private-provider-token-DO-NOT-EXPOSE');
      return output || { rows: [{
        category: 'Fonctions actuelles',
        title: 'Directeur commercial',
        variants: ['Directrice commerciale', 'Head of Sales'],
        relation: 'Fonction directement associée',
      }] };
    },
  };
  const db = { async query(...a) { mutated.push(a); throw Error('No database access expected'); } };
  const router = new Router();
  registerProspects(router, { db, ai, agent: {}, vault: {} }, {
    requireAuth: async (ctx) => { ctx.state.ws = workspace; ctx.state.user = { id: 'user-1' }; },
    requireAdmin: async () => {},
  });
  const invoke = async (body) => {
    const matched = router.match('POST', '/api/discovery/job-titles');
    assert.ok(matched);
    const ctx = { state: {}, json: async () => body,
      header: (key, value) => { headers.push([key, value]); } };
    let result;
    for (const handler of matched.route.handlers) result = await handler(ctx);
    return result;
  };
  return { ai, invoke, prompts, mutated, headers };
}

test('route : utilise uniquement le connecteur IA actif et retourne un tableau sans écriture de données', async () => {
  const h = harness();
  const result = await h.invoke({ keyword: 'Commercial' });
  assert.equal(result.keyword, 'Commercial');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].title, 'Directeur commercial');
  assert.equal(h.mutated.length, 0);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.prompts[0].maxTokens, 3800);
  assert.match(h.prompts[0].user, /Commercial/);
  assert.deepEqual(h.headers, [['Cache-Control', 'no-store']]);
  await assert.rejects(() => h.invoke({ keyword: 'Autre métier' }), /12 secondes/);
});

test('route : aucun modèle actif, requête invalide ou erreur fournisseur ne révèle de secret', async () => {
  await assert.rejects(() => harness({ aiEnabled: false }).invoke({ keyword: 'Architecte' }),
    /Aucun connecteur IA actif/);
  await assert.rejects(() => harness().invoke({ keyword: '' }), /Poste recherché/);
  const h = harness({ failure: true });
  await assert.rejects(() => h.invoke({ keyword: 'Chef de projet' }), (error) => {
    assert.match(error.message, /La génération des intitulés a échoué/);
    assert.doesNotMatch(error.message, /private-provider-token/);
    return true;
  });
  assert.equal(h.mutated.length, 0);
});

test('interface : baguette magique attenante au poste, table en quatre colonnes et sélection explicite', () => {
  const src = fs.readFileSync(new URL('../web/src/pages/Prospects.jsx', import.meta.url), 'utf8');
  assert.match(src, /LuWandSparkles/);
  assert.match(src, /Générer les intitulés de poste avec l’IA/);
  assert.match(src, /api\/discovery\/job-titles/);
  assert.match(src, /jobTitles\.map/);
  assert.match(src, /optgroup/);
  assert.match(src, /Utiliser ce poste/);
  assert.match(src, /Intitulé principal/);
  assert.match(src, /Variantes et synonymes LinkedIn/);
  assert.match(src, /Lien avec le mot-clé/);
  assert.match(src, /setCriteria\(\(previous\) => \(\{ \.\.\.previous, title: selectedSuggestedTitle \}\)\)/);
  assert.match(src, /<LuSearch \/>}Rechercher des profils/);
});
