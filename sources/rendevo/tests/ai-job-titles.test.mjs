import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Router } from '../server/lib/http.js';
import { registerProspects } from '../server/routes/prospects.js';
import { normalizeJobKeyword, normalizeJobFormFields, professionalTitlePrompt, normalizeProfessionalTitles } from '../server/services/job-titles.js';
import { parseProfessionalTitleResponse } from '../server/services/job-title-parser.js';

test('mot-clé : respecte le champ Poste recherché, interdit valeurs vides et caractères de contrôle', () => {
  assert.equal(normalizeJobKeyword('  Directeur   commercial  '), 'Directeur commercial');
  for (const v of [undefined, null, '', '  ', 'a', 'x'.repeat(91), 'chef\nDROP', '<command>']) {
    assert.throws(() => normalizeJobKeyword(v), /mot-clé|Poste recherché/);
  }
});

test('prompt IA : nouveau JSON compact value-label-keywords, avec tous les champs du formulaire', () => {
  const form = normalizeJobFormFields({
    title: 'Directeur technique', industry: 'Industrie', location: 'Lyon', keywords: 'B2B',
  });
  const p = professionalTitlePrompt(form);
  for (const fragment of [
    'À partir de « ', 'génère les intitulés de postes LinkedIn associés',
    '(variantes, fonctions proches, anciens titres)', 'sans doublons',
    'Réponds uniquement en JSON compact',
    '[{"value":"identifiant","label":"Intitulé","keywords":["synonymes"]}]',
    '"Poste recherché":"Directeur technique"', '"Secteur":"Industrie"',
    '"Localisation":"Lyon"', '"Mots-clés":"B2B"',
  ]) assert.ok(p.includes(fragment), fragment);
  assert.doesNotMatch(p, /"rows"|Catégorie|Intitulé principal|Markdown/);
  assert.equal(professionalTitlePrompt('Directeur technique').includes('Directeur technique'), true);
  assert.throws(() => normalizeJobFormFields('texte'), /invalides/);
  assert.throws(() => normalizeJobFormFields({ industry: ['bad'] }), /invalides/);
  assert.throws(() => normalizeJobFormFields({ keywords: 'x'.repeat(121) }), /invalides/);
});

test('nouveau format IA : label devient le tag, value reste un identifiant et keywords des synonymes', () => {
  const entries = [
    { value: 'directeur-technique', label: 'Directeur technique', keywords: ['CTO', 'Technical Director', 'CTO'] },
    { value: 'doublon', label: 'directeur technique', keywords: [] },
    { value: 'responsable-it', label: 'Responsable informatique', keywords: ['IT Manager'] },
  ];
  const rows = parseProfessionalTitleResponse(JSON.stringify(entries));
  assert.deepEqual(rows.map((row) => row.title), ['Directeur technique', 'Responsable informatique']);
  assert.deepEqual(rows[0].variants, ['CTO', 'Technical Director']);
  assert.ok(!rows.some((row) => row.title === 'directeur-technique'));
  const fenced = parseProfessionalTitleResponse('Voici les postes :\n' + '```json\n'
    + JSON.stringify(entries) + '\n```');
  assert.deepEqual(fenced, rows);
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
    async complete(ws, opts) {
      assert.equal(ws, workspace);
      prompts.push(opts);
      if (failure) throw Error('private-provider-token-DO-NOT-EXPOSE');
      return typeof output === 'string' ? output : JSON.stringify(output || { rows: [{
        category: 'Fonctions actuelles',
        title: 'Directeur commercial',
        variants: ['Directrice commerciale', 'Head of Sales'],
        relation: 'Fonction directement associée',
      }] });
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
  const result = await h.invoke({
    keyword: 'Commercial',
    fields: { title: 'Commercial', industry: 'Logiciel', location: 'Paris', keywords: 'SaaS' },
  });
  assert.equal(result.keyword, 'Commercial');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].title, 'Directeur commercial');
  assert.equal(h.mutated.length, 0);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.prompts[0].maxTokens, 1200);
  assert.match(h.prompts[0].user, /Commercial/);
  assert.match(h.prompts[0].user, /"Secteur":"Logiciel"/);
  assert.match(h.prompts[0].user, /"Localisation":"Paris"/);
  assert.match(h.prompts[0].user, /"Mots-clés":"SaaS"/);
  assert.deepEqual(h.headers, [['Cache-Control', 'no-store']]);
  await assert.rejects(() => h.invoke({ keyword: 'Autre métier' }), /12 secondes/);
});

test('route : aucun modèle actif, requête invalide ou erreur fournisseur ne révèle de secret', async () => {
  await assert.rejects(() => harness({ aiEnabled: false }).invoke({ keyword: 'Architecte' }),
    /Aucun connecteur IA actif/);
  await assert.rejects(() => harness().invoke({ keyword: '' }), /mot-clé/);
  const h = harness({ failure: true });
  await assert.rejects(() => h.invoke({ keyword: 'Chef de projet' }), (error) => {
    assert.match(error.message, /sans diagnostic réseau identifiable.*code AI_UNKNOWN/);
    assert.doesNotMatch(error.message, /private-provider-token/);
    return true;
  });
  assert.equal(h.mutated.length, 0);
});

test('interface : baguette magique alimente uniquement les tags, sans panneau détaillé de propositions', () => {
  const src = fs.readFileSync(new URL('../web/src/pages/Prospects.jsx', import.meta.url), 'utf8');
  assert.match(src, /LuWandSparkles/);
  assert.match(src, /Générer les intitulés de poste avec l’IA/);
  assert.match(src, /api\/discovery\/job-titles/);
  assert.match(src, /setTitleTags\(recommended\)/);
  assert.match(src, /setCriteria\(\(previous\) => \(\{ \.\.\.previous, title: '' \}\)\)/);
  assert.match(src, /removeTitleTag/);
  assert.match(src, /<LuSearch \/>}Rechercher des profils/);
  assert.doesNotMatch(src, /Fonctions proposées pour/);
  assert.doesNotMatch(src, /jobTitles\.map/);
  assert.doesNotMatch(src, /titleSource|selectedSuggestedTitle|<optgroup/);
  assert.doesNotMatch(src, /Variantes et synonymes LinkedIn|Lien avec le mot-clé/);
  assert.doesNotMatch(src, /aria-label="Intitulés de postes suggérés par l’IA"/);
});

test('interface : les quatre champs et les options de recherche sont empilés verticalement', () => {
  const src = fs.readFileSync(new URL('../web/src/pages/Prospects.jsx', import.meta.url), 'utf8');
  const searchArea = src.slice(src.indexOf('<Field label="Campagne de destination">'),
    src.indexOf('<p className="small soft">DeGoog définit le nombre'));
  assert.match(searchArea, /className="stack" style=\{\{ '--gap': '12px' \}\}>\s*\{\[/);
  assert.match(searchArea, /className="stack" style=\{\{ '--gap': '12px' \}\}>\s*<Field label="Profils retenus/);
  for (const field of ['Poste recherché', 'Secteur', 'Localisation', 'Mots-clés',
    'Profils retenus par page', 'Affichage des résultats DeGoog']) {
    assert.ok(searchArea.includes(field), field);
  }
  assert.doesNotMatch(searchArea, /className="grid-2"/);
});


test('parseur IA : JSON sous balises Markdown et texte de présentation', () => {
  const fence = String.fromCharCode(96).repeat(3);
  const response = 'Voici votre réponse :\n' + fence + 'json\n' +
    JSON.stringify({ rows: [
      { category: 'Direction', title: 'Directeur technique',
        variants: ['Directrice technique', 'CTO'], relation: 'Fonction actuelle' },
      { category: 'Direction', title: 'Directeur technique', variants: [], relation: '' },
    ] }) + '\n' + fence;
  const rows = parseProfessionalTitleResponse(response);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].variants, ['Directrice technique', 'CTO']);
  assert.equal(rows[0].relation, 'Fonction actuelle');
});

test('parseur IA : tableau JSON brut, clés alternatives et tableau Markdown', () => {
  const alternate = parseProfessionalTitleResponse(JSON.stringify({
    suggestions: [{ 'Catégorie': 'Direction',
      'Intitulé principal': 'DRH', 'Variantes et synonymes LinkedIn': 'Directrice RH; HR Director',
      'Lien avec le mot-clé': 'Fonction actuelle' }],
  }));
  assert.equal(alternate[0].title, 'DRH');
  assert.deepEqual(alternate[0].variants, ['Directrice RH', 'HR Director']);
  const direct = parseProfessionalTitleResponse(JSON.stringify([
    { category: 'Métier', title: 'Directeur marketing', variants: [], relation: 'Direct' },
  ]));
  assert.equal(direct[0].title, 'Directeur marketing');
  const markdown = [
    'Voici un tableau :',
    '| Catégorie | Intitulé principal | Variantes et synonymes LinkedIn | Lien avec le mot-clé |',
    '| --- | --- | --- | --- |',
    '| Direction | Directeur commercial | Directrice commerciale, Head of Sales | Fonction actuelle |',
    '| Postes voisins | Responsable grands comptes | Key Account Manager | Fonction voisine |',
  ].join('\n');
  const parsed = parseProfessionalTitleResponse(markdown);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].title, 'Directeur commercial');
  assert.deepEqual(parsed[0].variants, ['Directrice commerciale', 'Head of Sales']);
  assert.equal(parsed[1].category, 'Postes voisins');
});

test('parseur IA : tronquage identifié et texte libre refusé', () => {
  assert.throws(() => parseProfessionalTitleResponse('{"rows":[{"title":"DRH"'),
    /tronquée|incomplet/);
  assert.throws(() => parseProfessionalTitleResponse('Voici des métiers possibles : responsable RH.'),
    /sans tableau JSON ou Markdown exploitable/);
  assert.throws(() => parseProfessionalTitleResponse(''), /Réponse vide/);
});

test('route : modèle qui renvoie du Markdown accepté sans second appel', async () => {
  const h = harness({ output: [
    '| Catégorie | Intitulé principal | Variantes et synonymes LinkedIn | Lien avec le mot-clé |',
    '| --- | --- | --- | --- |',
    '| Direction | Directeur commercial | Directrice commerciale, Head of Sales | Fonction actuelle |',
  ].join('\n') });
  const result = await h.invoke({ keyword: 'commercial' });
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].variants, ['Directrice commerciale', 'Head of Sales']);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.mutated.length, 0);
});

test('route : réponse mal formatée -> seconde génération courte sans écriture SQL', async () => {
  const h = harness({ output: 'Réponse libre sans structure.' });
  await assert.rejects(() => h.invoke({ keyword: 'juriste' }), /seconde tentative/);
  assert.equal(h.prompts.length, 2);
  assert.match(h.prompts[0].user, /JSON compact/);
  assert.match(h.prompts[1].user, /6 intitulés/);
  assert.ok(h.prompts[1].maxTokens < h.prompts[0].maxTokens);
  assert.equal(h.mutated.length, 0);
});

test('route : erreurs HTTP fournisseur précises sans fuite de secrets', async () => {
  for (const [detail, expected] of [
    ['LLM HTTP 401 : secret-api-key', /refuse la clé API \(HTTP 401\)/],
    ['LLM HTTP 400 : secret-api-key', /refuse les paramètres de génération/],
    ['LLM HTTP 404 : secret-api-key', /modèle ou la route/],
    ['LLM HTTP 429 : secret-api-key', /limite les requêtes/],
  ]) {
    const h = harness({ failure: true });
    h.ai.complete = async () => { throw Error(detail); };
    await assert.rejects(() => h.invoke({ keyword: 'architecte' }), (error) => {
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /secret-api-key/);
      return true;
    });
  }
});
