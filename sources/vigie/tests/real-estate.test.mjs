import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RealEstateEstimator, EstimateError, isRealEstateCategory, latentGain } from '../server/real-estate.js';
import { startServer, client } from './helpers.mjs';

test('plus-value latente : gain et moins-value, sans toucher au prix d’achat', () => {
  assert.deepEqual(latentGain(31000000, 25000000), { gain_cents: 6000000, gain_pct: 24 });
  assert.deepEqual(latentGain(18000000, 20000000), { gain_cents: -2000000, gain_pct: -10 });
  assert.equal(latentGain(null, 20000000), null);
  assert.equal(isRealEstateCategory({ name: 'Immobilier', kind: 'asset', icon: 'house' }), true);
  assert.equal(isRealEstateCategory({ name: 'Crédit immobilier', kind: 'liability', icon: 'loanHouse' }), false);
});

test('baguette magique : moteur interrogé uniquement sur demande, sans envoyer prix d’achat', async () => {
  const calls = [];
  const estimator = new RealEstateEstimator({ fetcher: async (url, opts) => {
    calls.push({ url, opts, payload: JSON.parse(opts.body) });
    return new Response(JSON.stringify({
      data: { estimate: 310000, range: { low: 280000, high: 340000 }, confidence: 'medium', comparables_count: 12 },
    }));
  } });
  const input = { property_type: 'appartement', surface_m2: 85, address: '15 rue de la République, Lyon',
    condition: 'bon', purchase_amount: '250000', purchased_at: '2018-06-01' };
  assert.equal(calls.length, 0);
  const result = await estimator.estimate(input);
  assert.equal(result.estimate_cents, 31000000);
  assert.equal(result.low_cents, 28000000);
  assert.equal(result.high_cents, 34000000);
  assert.equal(result.comparables, 12);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload, { type_local: 2, surface_bati: 85, adresse: input.address, etat: 'bon' });
  assert.ok(!calls[0].opts.body.includes('250000'));
  assert.ok(!calls[0].opts.body.includes('2018-06-01'));
  await estimator.estimate(input);
  assert.equal(calls.length, 1, 'la seconde estimation est servie depuis le cache');
});

test('baguette magique : données insuffisantes ou service hors ligne n’écrasent jamais la saisie', async () => {
  const p = { property_type: 'maison', surface_m2: 125, address: '1 rue de Paris, Angers' };
  const invalid = new RealEstateEstimator({ fetcher: async () => new Response(JSON.stringify({
    data: { estimate: 280000, range: { low: 220000, high: 340000 }, comparables_count: 1 },
  })) });
  await assert.rejects(invalid.estimate(p), (e) => e instanceof EstimateError && e.status === 422);
  const offline = new RealEstateEstimator({ fetcher: async () => { throw Error('offline'); } });
  await assert.rejects(offline.estimate(p), (e) => e instanceof EstimateError && e.status === 503);
  await assert.rejects(invalid.estimate({ ...p, address: '' }), (e) => e.status === 400);
});

test('API : acquisition et valeur actuelle dans deux champs et historique indépendant', async () => {
  const srv = await startServer({}, { fetcher: async () => new Response(JSON.stringify({
    data: { estimate: 306000, range: { low: 284000, high: 327000 }, comparables_count: 9, confidence: 'high' },
  })) });
  try {
    const admin = client(srv.base);
    assert.equal((await admin.post('/api/auth/setup', {
      username: 'proprio', first_name: 'Marie', last_name: 'Dupont', password: 'motdepasse-solide-42', base_currency: 'EUR',
    })).status, 200);
    const cats = (await admin.get('/api/categories')).data.categories;
    const cat = cats.find((x) => x.name === 'Immobilier');
    const property = { purchase_amount: '250 000', purchased_at: '2018-04-30', property_type: 'maison',
      address: '8 boulevard du Roi René, Angers', surface_m2: 110, condition: 'bon' };
    const newHolding = await admin.post('/api/holdings', {
      category_id: cat.id, name: 'Maison principale', currency: 'EUR',
      amount: '280000', date: '2026-10-20', property,
    });
    assert.equal(newHolding.status, 200, JSON.stringify(newHolding.data));
    const id = newHolding.data.id;
    let current = (await admin.get('/api/holdings/' + id)).data;
    assert.equal(current.property.purchase_cents, 25000000);
    assert.equal(current.property.purchased_at, '2018-04-30');
    assert.equal(current.holding.value_cents, 28000000);
    assert.equal(current.latent_gain.gain_cents, 3000000);
    assert.equal(current.latent_gain.gain_pct, 12);
    assert.equal(current.valuations.length, 1);
    const listed = (await admin.get('/api/holdings')).data.holdings.find((h) => h.id === id);
    assert.equal(listed.latent_gain_cents, 3000000);

    const suggested = await admin.post('/api/real-estate/estimate', {
      property_type: 'maison', address: property.address, surface_m2: 110, condition: 'bon',
    });
    assert.equal(suggested.status, 200);
    assert.equal(suggested.data.estimate_cents, 30600000);
    current = (await admin.get('/api/holdings/' + id)).data;
    assert.equal(current.holding.value_cents, 28000000, 'l’estimation ne modifie pas la valeur sans validation');

    const changed = await admin.patch('/api/holdings/' + id, {
      category_id: cat.id, name: 'Maison principale', amount: '306000', date: '2026-11-01', property,
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    current = (await admin.get('/api/holdings/' + id)).data;
    assert.equal(current.holding.value_cents, 30600000);
    assert.equal(current.property.purchase_cents, 25000000);
    assert.equal(current.latent_gain.gain_cents, 5600000);
    assert.equal(current.valuations.length, 2);
    const noUpdate = await admin.patch('/api/holdings/' + id, {
      category_id: cat.id, name: 'Maison principale', amount: '306000', date: '2026-11-01', property,
    });
    assert.equal(noUpdate.status, 200);
    assert.equal((await admin.get('/api/holdings/' + id)).data.valuations.length, 2);

    const bad = await admin.post('/api/holdings', {
      category_id: cat.id, name: 'Achat sans date', property: { ...property, purchased_at: '' },
    });
    assert.equal(bad.status, 400);
    assert.equal((await admin.get('/api/holdings')).data.holdings.filter((h) => h.name === 'Achat sans date').length, 0);
  } finally { await srv.stop(); }
});


test('DVF : si l’estimation principale ne trouve pas assez de ventes, médiane des ventes proches', async () => {
  const calls = [];
  const rows = [
    { id_mutation: 's1', type_local: 'Appartement', surface_bati: 82, prix_m2: 3500, valeur_fonciere: 287000, distance_m: 280, mutation_date: '2026-04-02', nature: 'Vente' },
    { id_mutation: 's2', type_local: 'Appartement', surface_bati: 88, prix_m2: 3700, valeur_fonciere: 325600, distance_m: 470, mutation_date: '2025-03-02', nature: 'Vente' },
    { id_mutation: 's3', type_local: 'Appartement', surface_bati: 79, prix_m2: 3600, valeur_fonciere: 284400, distance_m: 350, mutation_date: '2024-06-03', nature: 'Vente' },
    { id_mutation: 's3', type_local: 'Appartement', surface_bati: 79, prix_m2: 3600, valeur_fonciere: 284400, distance_m: 350, mutation_date: '2024-06-03', nature: 'Vente' },
    { id_mutation: 's4', type_local: 'Maison', surface_bati: 80, prix_m2: 9000, valeur_fonciere: 720000, distance_m: 220, mutation_date: '2025-09-12', nature: 'Vente' },
    { id_mutation: 's5', type_local: 'Appartement', surface_bati: 20, prix_m2: 2500, valeur_fonciere: 50000, distance_m: 260, mutation_date: '2025-08-12', nature: 'Vente' },
  ];
  const estimator = new RealEstateEstimator({ fetcher: async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === 'POST') return new Response(JSON.stringify({
      data: { estimate: null, range: { low: null, high: null }, comparables_count: 1 },
    }));
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/api/v1/dvf/ventes/address');
    assert.equal(parsed.searchParams.get('type_local'), '2');
    assert.equal(parsed.searchParams.get('adresse'), '15 rue de Paris, Angers');
    return new Response(JSON.stringify({ data: rows, meta: { address: { label: '15 rue de Paris' } } }));
  } });
  const value = await estimator.estimate({
    address: '15 rue de Paris, Angers', property_type: 'appartement',
    surface_m2: 85, condition: 'bon', purchase_amount: '220000', purchased_at: '2018-01-01',
  });
  assert.equal(value.estimate_cents, 30600000, 'médiane des prix 3600 €/m², soit 306000 €');
  assert.equal(value.comparables, 3, 'ventes en double et biens différents écartés');
  assert.equal(value.confidence, 'low');
  assert.equal(value.method, 'dvf_median_nearby');
  assert.equal(value.radius_m, 1500);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.ok(!JSON.stringify(call).includes('220000'), 'ne transmet jamais la valeur d’achat');
    assert.ok(!JSON.stringify(call).includes('2018-01-01'), 'ne transmet jamais la date d’acquisition');
  }
  await estimator.estimate({ address: '15 rue de Paris, Angers', property_type: 'appartement', surface_m2: 85 });
  assert.equal(calls.length, 2, 'cache de la proposition, y compris après bascule en DVF');
});

test('DVF : élargit modérément le rayon sans inventer de valeur quand les ventes manquent', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    if (options.method === 'POST') return new Response(JSON.stringify({
      data: { estimate: 0, range: { low: 0, high: 0 }, comparables_count: 0 },
    }));
    const radius = new URL(url).searchParams.get('radius');
    return new Response(JSON.stringify({ data: radius === '1500' ? [] : [{
      id_mutation: 's1', surface_bati: 98, prix_m2: 3200,
      mutation_date: '2025-04-21', type_local: 'Maison', distance_m: 3000, nature: 'Vente',
    }], meta: { address: { label: 'Angers' } } }));
  };
  const estimator = new RealEstateEstimator({ fetcher });
  await assert.rejects(estimator.estimate({
    address: '8 boulevard du Roi René, Angers', property_type: 'maison', surface_m2: 100,
  }), (err) => err instanceof EstimateError && err.status === 422 &&
     err.message.includes('1 vente(s)') && err.message.includes('minimum 3'));
  assert.deepEqual(calls.map((x) => x.method), ['POST', 'GET', 'GET']);
  assert.equal(new URL(calls[2].url).searchParams.get('radius'), '5000');
});

test('DVF : refuse adresse non reconnue et mutation manifestement atypique', async () => {
  const estimator = new RealEstateEstimator({ fetcher: async (_url, options) =>
    options.method === 'POST'
      ? new Response(JSON.stringify({ data: { comparables_count: 1 } }))
      : new Response(JSON.stringify({ data: [
          { mutation_date: '2025-11-01', type_local: 'Appartement', surface_bati: 45, prix_m2: 3200 },
          { mutation_date: '2025-11-01', type_local: 'Appartement', surface_bati: 48, prix_m2: 3400 },
          { mutation_date: '2025-11-01', type_local: 'Appartement', surface_bati: 40, prix_m2: 3300 },
        ], meta: { address: null } })) });
  await assert.rejects(estimator.estimate({
    address: 'adresse inconnue fictive', property_type: 'appartement', surface_m2: 45,
  }), (err) => err.status === 422);
});
