import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer, client } from './helpers.mjs';
import { ownedCents, ownershipBasisPoints, latentGain } from '../server/real-estate.js';
import { todayIso, addDays } from '../server/portfolio.js';

test('quote-part : 100 % par défaut, 33,33 % précis et pourcentages invalides refusés', () => {
  assert.equal(ownershipBasisPoints(undefined), 10000);
  assert.equal(ownershipBasisPoints('100'), 10000);
  assert.equal(ownershipBasisPoints('50'), 5000);
  assert.equal(ownershipBasisPoints('33,33'), 3333);
  assert.equal(ownershipBasisPoints('0.01'), 1);
  for (const val of ['0', '-1', '101', '100.01', '33.333', 'infini', '10abc', '', '0.001']) {
    assert.equal(ownershipBasisPoints(val), null, 'refuser ' + JSON.stringify(val));
  }
  assert.equal(ownedCents(80000000, 5000), 40000000);
  assert.equal(ownedCents(80000000, 3333), 26664000);
  assert.deepEqual(latentGain(80000000, 50000000, 5000), { gain_cents: 15000000, gain_pct: 60 });
  assert.deepEqual(latentGain(40000000, 50000000, 2500), { gain_cents: -2500000, gain_pct: -20 });
  assert.equal(ownedCents(80000000, -2), null);
});

test('quote-part : les droits détenus entrent dans le patrimoine, la valeur enregistrée reste celle du bien entier', async () => {
  const srv = await startServer();
  const today = todayIso();
  const yesterday = addDays(today, -1);
  try {
    const admin = client(srv.base);
    assert.equal((await admin.post('/api/auth/setup', {
      username: 'indivisaire', first_name: 'Marie', last_name: 'Durand',
      password: 'motdepasse-solide-2026', base_currency: 'EUR',
    })).status, 200);
    const categories = (await admin.get('/api/categories')).data.categories;
    const immobilier = categories.find((x) => x.name === 'Immobilier').id;
    const house = {
      purchase_amount: '500000', purchased_at: '2010-06-12', property_type: 'maison',
      address: '128 avenue des Frères Lumière, 69008 Lyon', condition: 'bon',
      surface_m2: 180, ownership_pct: '40',
    };
    const created = await admin.post('/api/holdings', {
      name: 'Maison en indivision', category_id: immobilier,
      amount: 800000, date: yesterday, property: house,
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const id = created.data.id;
    let detail = (await admin.get('/api/holdings/' + id)).data;
    assert.equal(detail.property.ownership_bp, 4000);
    assert.equal(detail.property.purchase_cents, 50000000);
    assert.equal(detail.holding.value_cents, 80000000);
    assert.equal(detail.holding.owned_cents, 32000000);
    assert.equal(detail.latent_gain.gain_cents, 12000000);
    assert.equal(detail.latent_gain.gain_pct, 60);

    let list = (await admin.get('/api/holdings')).data.holdings;
    let found = list.find((x) => x.id === id);
    assert.equal(found.value_cents, 80000000);
    assert.equal(found.owned_cents, 32000000);
    assert.equal(found.value_base, 32000000);
    assert.equal(found.latent_gain_cents, 12000000);
    let board = (await admin.get('/api/dashboard')).data;
    assert.equal(board.totals.assets, 32000000);
    assert.equal(board.totals.net, 32000000);
    assert.equal(board.categories.find((x) => x.id === immobilier).value, 32000000);
    assert.equal(board.groups.owner.reduce((sum,x)=>sum+x.value,0), 32000000);

    const newVal = await admin.post('/api/holdings/' + id + '/valuations', {
      amount: 1000000, date: today, note: 'Évaluation du bien entier',
    });
    assert.equal(newVal.status, 200, JSON.stringify(newVal.data));
    detail = (await admin.get('/api/holdings/' + id)).data;
    assert.equal(detail.holding.owned_cents, 40000000);
    assert.equal(detail.latent_gain.gain_cents, 20000000);
    board = (await admin.get('/api/dashboard')).data;
    assert.equal(board.totals.assets, 40000000);
    let trend = (await admin.get('/api/history?range=all')).data;
    assert.equal(trend.points[0].net, 32000000);
    assert.equal(trend.points.at(-1).net, 40000000);

    const updated = await admin.patch('/api/holdings/' + id, {
      category_id: immobilier, name: 'Maison en indivision', property: { ...house, ownership_pct: '12,5' },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    detail = (await admin.get('/api/holdings/' + id)).data;
    assert.equal(detail.property.ownership_bp, 1250);
    assert.equal(detail.holding.value_cents, 100000000);
    assert.equal(detail.holding.owned_cents, 12500000);
    assert.equal(detail.latent_gain.gain_cents, 6250000);
    assert.equal(detail.valuations.length, 2, 'changer la quote-part ne crée pas une estimation');
    trend = (await admin.get('/api/history?range=all')).data;
    assert.equal(trend.points[0].net, 10000000, 'la quote-part actuelle s’applique au patrimoine historique');
    assert.equal(trend.points.at(-1).net, 12500000);
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets, 12500000);
    list = (await admin.get('/api/holdings')).data.holdings;
    found = list.find((x) => x.id === id);
    assert.equal(found.latent_gain_cents, 6250000);

    const json = await admin.get('/api/export.json');
    assert.equal(json.status, 200);
    const saved = json.data;
    assert.equal(saved.real_estate.find((p) => p.holding_id === id).ownership_bp, 1250);
    const csv = await admin.get('/api/export/holdings.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.data.toString('utf8'), /Quote-part \(%\)/);
    assert.match(csv.data.toString('utf8'), /12,5/);

    const restored = await admin.post('/api/admin/import', saved);
    assert.equal(restored.status, 200, JSON.stringify(restored.data));
    detail = (await admin.get('/api/holdings/' + id)).data;
    assert.equal(detail.property.ownership_bp, 1250);
    assert.equal(detail.holding.owned_cents, 12500000);
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets, 12500000);
    const legacy = JSON.parse(JSON.stringify(saved));
    delete legacy.real_estate[0].ownership_bp;
    const legacyImport = await admin.post('/api/admin/import', legacy);
    assert.equal(legacyImport.status, 200, JSON.stringify(legacyImport.data));
    detail = (await admin.get('/api/holdings/' + id)).data;
    assert.equal(detail.property.ownership_bp, 10000, 'ancien export sans quote-part : 100 %');
    assert.equal(detail.holding.owned_cents, 100000000);

    const invalid = await admin.patch('/api/holdings/' + id, {
      category_id: immobilier, name: 'Maison en indivision',
      property: { ...house, ownership_pct: 120 },
    });
    assert.equal(invalid.status, 400);
    assert.equal((await admin.get('/api/holdings/' + id)).data.property.ownership_bp, 10000);
  } finally { await srv.stop(); }
});

test('interface : valeur totale distincte de la quote-part sur fiche, liste et mise à jour rapide', () => {
  const ui = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(ui, /name="ownership_pct"[^>]*min="0\.01" max="100"/);
  assert.match(ui, /ownership_pct: body\.ownership_pct/);
  assert.match(ui, /property\.ownership_bp \/ 100/);
  assert.match(ui, /Valeur actuelle du bien entier/);
  assert.match(ui, /Valeur de votre part/);
  assert.match(ui, /Prix d'achat de votre part/);
  assert.match(ui, /Math\.round\(owned \* r\)/);
  assert.match(ui, /h\.owned_cents/);
});
