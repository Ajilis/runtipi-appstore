// 1.5.0 : bilan patrimonial imprimable, à la date du jour ou à une date passée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer, client } from './helpers.mjs';
import { todayIso, addDays } from '../server/portfolio.js';

const PASSWORD = 'mot-de-passe-test-2026';

test('bilan : chiffres du tableau de bord, date passée, détail des avoirs, quote-parts et partages', async () => {
  const srv = await startServer();
  try {
    const alice = client(srv.base);
    assert.equal((await alice.post('/api/auth/setup', { username: 'alice', first_name: 'Alice', last_name: 'Martin', password: PASSWORD, base_currency: 'EUR' })).status, 200);
    const lea = (await alice.post('/api/users', { username: 'lea', first_name: 'Léa', last_name: 'Durand', password: PASSWORD })).data.user;
    const leaC = client(srv.base);
    assert.equal((await leaC.post('/api/auth/login', { username: 'lea', password: PASSWORD })).status, 200);
    const cats = (await alice.get('/api/categories')).data.categories;
    const cat = (n) => cats.find((c) => c.name === n).id;
    const today = todayIso(), past = addDays(today, -40), older = addDays(today, -400);
    const livret = (await alice.post('/api/holdings', { category_id: cat('Épargne réglementée'), name: 'Livret A', institution: 'La Banque Postale', owner: 'Moi', amount: '10.000', date: older })).data.id;
    await alice.post(`/api/holdings/${livret}/valuations`, { amount: '12.000', date: today });
    const joint = (await alice.post('/api/holdings', { category_id: cat('Comptes courants'), name: 'Compte joint', amount: '4.000', date: past })).data.id;
    const credit = (await alice.post('/api/holdings', { category_id: cat('Autres crédits'), name: 'Prêt auto', amount: '3.000', date: older })).data.id;
    const ferme = (await alice.post('/api/holdings', { category_id: cat('Comptes courants'), name: 'Ancien compte', amount: '500', date: older })).data.id;
    assert.equal((await alice.post(`/api/holdings/${ferme}/close`, { date: addDays(today, -10) })).status, 200);
    const share = (await alice.post(`/api/holdings/${joint}/shares`, { recipient_id: lea.id, ownership_pct: 50 })).data.invitation;
    // Plus-values latentes : un placement avec prix de revient et un bien détenu à 50 %.
    assert.equal((await alice.post('/api/holdings', { category_id: cat('Bourse'), name: 'PEA', amount: '10.000', date: past, acquisition: { purchase_amount: '8.000', purchased_at: older } })).status, 200);
    const maison = await alice.post('/api/holdings', { category_id: cat('Immobilier'), name: 'Maison', amount: '300.000', date: past,
      property: { purchase_amount: '200.000', purchased_at: older, property_type: 'maison', ownership_pct: 50 } });
    assert.equal(maison.status, 200, JSON.stringify(maison.data));
    await leaC.post(`/api/shares/${share.id}/decision`, { decision: 'accept' });

    // Aujourd'hui : mêmes totaux que le tableau de bord.
    const dash = (await alice.get('/api/dashboard')).data;
    const r = (await alice.get('/api/report')).data;
    assert.equal(r.date, today);
    assert.deepEqual(r.totals, dash.totals);
    assert.equal(r.totals.net, 1_200_000 + 200_000 + 1_000_000 + 15_000_000 - 300_000);
    assert.deepEqual(r.liquidity, dash.liquidity);
    assert.equal(r.liquidity.immediate, 1_200_000 + 200_000, 'disponibilités : comptes et livrets');
    assert.equal(r.user_name, 'Alice Martin');
    assert.ok(r.generated_at > Date.now() - 60_000);
    assert.ok(r.history.length >= 2 && r.history[r.history.length - 1].date === today);
    const byName = Object.fromEntries(r.holdings.map((h) => [h.name, h]));
    assert.deepEqual(Object.keys(byName).sort(), ['Compte joint', 'Livret A', 'Maison', 'PEA', 'Prêt auto'], 'avoir clôturé exclu');
    assert.deepEqual([byName['Livret A'].owned_cents, byName['Livret A'].valued_at, byName['Livret A'].institution], [1_200_000, today, 'La Banque Postale']);
    assert.deepEqual([byName['Compte joint'].value_cents, byName['Compte joint'].owned_cents, byName['Compte joint'].ownership_bp], [400_000, 200_000, 5000]);
    assert.equal(byName['Prêt auto'].kind, 'liability');
    // Plus-values latentes mises en avant : prix de revient de votre part, gain et pourcentage.
    assert.deepEqual(r.latent, { gain: 200_000 + 5_000_000, basis: 800_000 + 10_000_000, count: 2 });
    assert.deepEqual([byName.Maison.latent_basis_cents, byName.Maison.latent_gain_cents, byName.Maison.latent_pct], [10_000_000, 5_000_000, 50]);
    assert.deepEqual([byName.PEA.latent_basis_cents, byName.PEA.latent_gain_cents, byName.PEA.latent_pct], [800_000, 200_000, 25]);

    // Date passée : valeurs connues à cette date ; le compte clôturé ensuite y figure encore.
    const p = (await alice.get(`/api/report?date=${addDays(today, -20)}`)).data;
    const pastNames = Object.fromEntries(p.holdings.map((h) => [h.name, h]));
    assert.equal(pastNames['Livret A'].owned_cents, 1_000_000);
    assert.equal(pastNames['Livret A'].valued_at, older);
    assert.equal(pastNames['Ancien compte'].owned_cents, 50_000, 'clôturé après la date du bilan');
    assert.equal(p.totals.assets, 1_000_000 + 200_000 + 50_000 + 1_000_000 + 15_000_000);
    assert.equal(p.history[p.history.length - 1].date, addDays(today, -20));
    // Avant toute valeur du compte joint : absent.
    const before = (await alice.get(`/api/report?date=${addDays(past, -1)}`)).data;
    assert.ok(!before.holdings.some((h) => h.name === 'Compte joint'));

    // Léa : seulement sa part du compte joint, avec le nom du titulaire.
    const lr = (await leaC.get('/api/report')).data;
    assert.deepEqual(lr.holdings.map((h) => [h.name, h.owned_cents, h.shared_by]), [['Compte joint', 200_000, 'Alice Martin']]);
    assert.equal(lr.totals.net, 200_000);
    assert.equal(lr.user_name, 'Léa Durand');

    // Dates refusées.
    for (const bad of [addDays(today, 1), '2026-13-01', 'hier', '1900-01-01']) assert.equal((await alice.get(`/api/report?date=${bad}`)).status, 400, bad);
    assert.equal((await client(srv.base).get('/api/report')).status, 401);
  } finally { await srv.stop(); }
});

test('bilan : page dédiée, bouton sur le tableau de bord, impression en clair', () => {
  const ui = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../web/app.css', import.meta.url), 'utf8');
  assert.match(ui, /bilan: \{ title: 'Bilan patrimonial', icon: 'journal', render: pageReport, parent: '' \}/);
  assert.match(ui, /<a class="btn" href="#\/bilan">\$\{icon\('journal'\)\}Bilan à imprimer<\/a>/);
  assert.match(ui, /'print-report': \(\) => window\.print\(\)/);
  assert.match(ui, /Document indicatif établi par Vigie Patrimoine/);
  assert.match(ui, /<span>Disponibilités liquides<\/span>/);
  assert.match(ui, /<span>Plus-values latentes<\/span>/);
  assert.match(css, /@page \{ size: A4; margin: 12mm; \}/);
  assert.match(css, /\.report-sheet \{ display: block; max-width: none;/, 'pas de grille à l’impression');
});
