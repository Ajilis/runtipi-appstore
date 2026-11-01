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
