import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.mjs';
import { amortization, loanSummary, loanValuations, isLoanCategory } from '../server/loans.js';
import { todayIso, addMonths } from '../server/portfolio.js';

const PASSWORD = 'motdepasse-solide-42';
const today = todayIso();

// --- Calculs ---------------------------------------------------------------------------------------------------

test('mensualités constantes : formule classique, capital entièrement remboursé, sans dérive', () => {
  const s = { kind: 'amortizing', principal_cents: 10_000_000, annual_rate: 3, months: 240, start_date: '2024-01-15' };
  const rows = amortization(s);
  assert.equal(rows.length, 240);
  assert.equal(rows[0].payment, 55_460, '554,60 € par mois pour 100 000 € à 3 % sur 20 ans');
  assert.equal(rows[0].interest, 25_000, '1er mois : 100 000 € × 3 % / 12');
  assert.equal(rows[0].remaining, 10_000_000 - rows[0].principal);
  assert.equal(rows.at(-1).remaining, 0);
  assert.equal(rows.reduce((t, r) => t + r.principal, 0), 10_000_000, 'la somme du capital remboursé égale le montant prêté');
  const interest = rows.reduce((t, r) => t + r.interest, 0);
  assert.ok(Math.abs(interest - 3_310_340) < 100, `coût total ≈ 33 103 € (${interest})`);
  for (const r of rows.slice(0, -1)) assert.equal(r.payment, 55_460, `mensualité identique au centime (${r.n})`);
  assert.ok(Math.abs(rows.at(-1).payment - 55_460) < 100, 'la dernière échéance solde les arrondis');
  for (const r of rows) assert.equal(r.payment, r.interest + r.principal);
  for (let k = 1; k < rows.length; k++) assert.ok(rows[k].remaining < rows[k - 1].remaining);
  assert.equal(rows[0].date, '2024-02-15');
  assert.equal(rows.at(-1).date, '2044-01-15');
});

test('taux zéro, fin de mois et in fine', () => {
  const zero = amortization({ kind: 'amortizing', principal_cents: 100_000, annual_rate: 0, months: 3, start_date: '2026-01-31' });
  assert.deepEqual(zero.map((r) => r.date), ['2026-02-28', '2026-03-31', '2026-04-30'], 'échéance ramenée au dernier jour du mois');
  assert.deepEqual(zero.map((r) => r.interest), [0, 0, 0]);
  assert.equal(zero.reduce((t, r) => t + r.principal, 0), 100_000);
  assert.deepEqual(zero.map((r) => r.remaining), [66_667, 33_334, 0]);
  assert.deepEqual(zero.map((r) => r.payment), [33_333, 33_333, 33_334]);

  const bullet = amortization({ kind: 'bullet', principal_cents: 1_000_000, annual_rate: 6, months: 12, start_date: '2025-03-10' });
  assert.equal(bullet.length, 12);
  assert.ok(bullet.slice(0, 11).every((r) => r.payment === 5_000 && r.remaining === 1_000_000), 'intérêts seuls : 50 € par mois');
  assert.deepEqual(bullet.at(-1), { n: 12, date: '2026-03-10', payment: 1_005_000, interest: 5_000, principal: 1_000_000, remaining: 0 });
});

test('synthèse et valeurs à une date', () => {
  const s = { kind: 'amortizing', principal_cents: 1_200_000, annual_rate: 0, months: 12, start_date: '2026-01-05' };
  assert.equal(loanSummary(s, '2026-01-04').remaining_cents, null, 'pas encore versé');
  let x = loanSummary(s, '2026-01-05');
  assert.equal(x.remaining_cents, 1_200_000);
  assert.equal(x.paid_count, 0);
  assert.equal(x.next_date, '2026-02-05');
  x = loanSummary(s, '2026-03-20');
  assert.equal(x.paid_count, 2);
  assert.equal(x.remaining_cents, 1_000_000);
  assert.equal(x.repaid_cents, 200_000);
  assert.equal(x.next_date, '2026-04-05');
  assert.equal(x.next_payment_cents, 100_000);
  assert.equal(x.end_date, '2027-01-05');
  assert.equal(x.done, false);
  x = loanSummary(s, '2027-02-01');
  assert.equal(x.done, true);
  assert.equal(x.remaining_cents, 0);
  assert.equal(x.next_date, null);

  const pts = loanValuations(s, '2026-03-20');
  assert.deepEqual(pts.map((p) => [p.valued_at, p.amount_cents]), [['2026-01-05', 1_200_000], ['2026-02-05', 1_100_000], ['2026-03-05', 1_000_000]]);
  assert.equal(pts[0].note, 'Versement du prêt');
  assert.ok(pts.every((p) => p.auto));
  assert.equal(loanValuations(s, '2027-06-01').at(-1).note, 'Prêt remboursé');
  assert.deepEqual(loanValuations(s, '2025-12-31'), []);

  assert.equal(isLoanCategory({ kind: 'asset', icon: 'handshake' }), true);
  assert.equal(isLoanCategory({ kind: 'liability', icon: 'cube' }), true);
  assert.equal(isLoanCategory({ kind: 'asset', icon: 'chart' }), false);
});

// --- API -------------------------------------------------------------------------------------------------------

let srv, admin, cats;
const cat = (name) => cats.find((c) => c.name === name).id;

before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  const r = await admin.post('/api/auth/setup', { username: 'alex', first_name: 'Alex', last_name: 'Martin', password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  cats = (await admin.get('/api/categories')).data.categories;
});
after(async () => { await srv.stop(); });

const start = addMonths(today, -5);
const plan = { kind: 'amortizing', principal: '12 000', rate: '4,5', months: 24, start_date: start };
const expected = (p = plan) => loanSummary({ kind: p.kind, principal_cents: Math.round(Number(String(p.principal).replace(/\s/g, '').replace(',', '.')) * 100),
  annual_rate: Number(String(p.rate).replace(',', '.')), months: p.months, start_date: p.start_date }, today);
const ids = {};

test('prêt accordé : capital restant calculé automatiquement', async () => {
  const pa = cats.find((c) => c.name === 'Prêts accordés');
  assert.equal(pa.icon, 'handshake');
  assert.equal(pa.default_liquidity, 'locked');
  const r = await admin.post('/api/holdings', { category_id: pa.id, name: 'Prêt à Camille', owner: 'Moi', amount: '999', schedule: plan });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  ids.loan = r.data.id;
  const want = expected();
  assert.equal(want.paid_count, 5);

  const list = (await admin.get('/api/holdings')).data.holdings;
  const h = list.find((x) => x.id === ids.loan);
  assert.equal(h.value_cents, want.remaining_cents, 'le montant saisi est ignoré au profit de l\'échéancier');
  assert.equal(h.schedule.payment_cents, want.payment_cents);
  assert.equal(h.schedule.paid_count, 5);
  assert.equal(h.valuation_count, 6, 'versement + 5 échéances');

  const detail = (await admin.get(`/api/holdings/${ids.loan}`)).data;
  assert.equal(detail.schedule.rows.length, 24);
  assert.equal(detail.schedule.remaining_cents, want.remaining_cents);
  assert.equal(detail.valuations.length, 6);
  assert.ok(detail.valuations.every((v) => v.auto && v.id === null));
  assert.equal(detail.valuations.at(-1).note, 'Versement du prêt');

  const d = (await admin.get('/api/dashboard')).data;
  assert.equal(d.totals.assets, want.remaining_cents);
  assert.ok(!(d.stale || []).some((s) => s.id === ids.loan), 'jamais signalé « à actualiser »');
  const hist = (await admin.get('/api/history?range=all')).data;
  assert.equal(hist.points[0].date, start);
  assert.equal(hist.points[0].net, 1_200_000);
  assert.equal(hist.points.at(-1).net, want.remaining_cents);

  const csv = (await admin.get('/api/export/history.csv')).data.toString('utf8');
  assert.match(csv, /Prêt à Camille;Prêts accordés;EUR;12000,00;Versement du prêt/);
  assert.match(csv, /Échéance 5/);
});

test('échéancier : valeurs manuelles refusées, validation des champs', async () => {
  let r = await admin.post(`/api/holdings/${ids.loan}/valuations`, { amount: 5000, date: today });
  assert.equal(r.status, 409);
  assert.match(r.data.message, /échéancier/);
  r = await admin.post('/api/valuations/bulk', { items: [{ holding_id: ids.loan, amount: 5000 }] });
  assert.equal(r.status, 400);

  const base = { category_id: cat('Prêts accordés'), name: 'Test' };
  for (const [bad, why] of [[{ rate: '60' }, /Taux/], [{ rate: '' }, /Taux/], [{ months: 0 }, /Durée/], [{ months: 601 }, /Durée/], [{ months: '12,5' }, /Durée/],
    [{ principal: '-5' }, /Montant/], [{ principal: 'abc' }, /Montant/], [{ start_date: addMonths(today, 1) }, /versement/], [{ kind: 'balloon' }, /Type/]]) {
    r = await admin.post('/api/holdings', { ...base, schedule: { ...plan, ...bad } });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.match(r.data.message, why);
  }
  r = await admin.post('/api/holdings', { ...base, schedule: 'oui' });
  assert.equal(r.status, 400);
});

test('échéancier modifié, crédit souscrit déduit du patrimoine', async () => {
  const changed = { ...plan, rate: 0, kind: 'bullet' };
  let r = await admin.patch(`/api/holdings/${ids.loan}`, { schedule: changed });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  let h = (await admin.get(`/api/holdings/${ids.loan}`)).data;
  assert.equal(h.holding.value_cents, 1_200_000, 'in fine sans intérêts : rien de remboursé avant la fin');
  assert.equal(h.schedule.kind, 'bullet');

  r = await admin.patch(`/api/holdings/${ids.loan}`, { name: 'Prêt à Camille D.' });
  assert.equal(r.status, 200);
  h = (await admin.get(`/api/holdings/${ids.loan}`)).data;
  assert.equal(h.schedule.kind, 'bullet', 'une modification sans le champ schedule conserve l\'échéancier');
  r = await admin.patch(`/api/holdings/${ids.loan}`, { schedule: plan });
  assert.equal(r.status, 200);

  const credit = { kind: 'amortizing', principal: 200000, rate: 3.2, months: 300, start_date: addMonths(today, -24) };
  r = await admin.post('/api/holdings', { category_id: cat('Crédits immobiliers'), name: 'Crédit résidence', schedule: credit });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  ids.credit = r.data.id;
  const d = (await admin.get('/api/dashboard')).data;
  const c = expected(credit);
  assert.equal(d.totals.liabilities, c.remaining_cents);
  assert.ok(c.remaining_cents < 20_000_000 && c.remaining_cents > 18_000_000);
  assert.equal(d.totals.net, expected().remaining_cents - c.remaining_cents);

  const audit = (await admin.get('/api/audit')).data.entries.map((e) => e.action);
  assert.ok(audit.includes('echeancier_defini'));
});

test('nouveau départ (remboursement anticipé) : l\'historique calculé avant est conservé', async () => {
  const r0 = await admin.post('/api/holdings', { category_id: cat('Autres crédits'), name: 'Crédit auto', schedule: { kind: 'amortizing', principal: 20000, rate: 5, months: 48, start_date: addMonths(today, -10) } });
  const id = r0.data.id;
  const old = (await admin.get(`/api/holdings/${id}`)).data;
  const restart = addMonths(today, -2);
  const r = await admin.patch(`/api/holdings/${id}`, { schedule: { kind: 'amortizing', principal: 8000, rate: 5, months: 24, start_date: restart } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const now = (await admin.get(`/api/holdings/${id}`)).data;
  const before = now.valuations.filter((v) => v.valued_at < restart);
  assert.deepEqual(before.map((v) => [v.valued_at, v.amount_cents]), old.valuations.filter((v) => v.valued_at < restart).map((v) => [v.valued_at, v.amount_cents]));
  assert.ok(before.every((v) => Number.isInteger(v.id)), 'enregistrées en base');
  assert.equal(now.valuations.find((v) => v.valued_at === restart).amount_cents, 800_000);
  assert.equal(now.schedule.months, 24);
  await admin.del(`/api/holdings/${id}`);
});

test('export et import conservent les échéanciers', async () => {
  const before = (await admin.get('/api/dashboard')).data.totals;
  const exp = (await admin.get('/api/export.json')).data;
  assert.equal(exp.loan_schedules.length, 2);
  const s = exp.loan_schedules.find((x) => x.holding_id === ids.loan);
  assert.deepEqual({ ...s }, { holding_id: ids.loan, kind: 'amortizing', principal_cents: 1_200_000, annual_rate: 4.5, months: 24, start_date: start });
  await admin.del(`/api/holdings/${ids.credit}`);
  let r = await admin.post('/api/admin/import', exp);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual((await admin.get('/api/dashboard')).data.totals, before);
  r = await admin.post('/api/admin/import', { ...exp, loan_schedules: [{ ...s, holding_id: 9999 }] });
  assert.equal(r.status, 400);
  r = await admin.post('/api/admin/import', { ...exp, loan_schedules: [{ ...s, annual_rate: '3' }] });
  assert.equal(r.status, 400);
  assert.deepEqual((await admin.get('/api/dashboard')).data.totals, before, 'import refusé : rien n\'a changé');
});

test('retour en saisie manuelle : les valeurs calculées sont conservées', async () => {
  const want = expected();
  let r = await admin.patch(`/api/holdings/${ids.loan}`, { schedule: null });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const h = (await admin.get(`/api/holdings/${ids.loan}`)).data;
  assert.equal(h.schedule, null);
  assert.equal(h.holding.value_cents, want.remaining_cents);
  assert.equal(h.valuations.length, 6);
  assert.ok(h.valuations.every((v) => Number.isInteger(v.id)), 'valeurs désormais enregistrées');
  r = await admin.post(`/api/holdings/${ids.loan}/valuations`, { amount: 100, date: today });
  assert.equal(r.status, 200, 'saisie manuelle de nouveau possible');
  assert.equal((await admin.get('/api/audit')).data.entries.some((e) => e.action === 'echeancier_retire'), true);
});

test('clôture d\'un avoir à échéancier : historique figé puis valeur nulle', async () => {
  const credit = (await admin.get('/api/holdings')).data.holdings.find((x) => x.name === 'Crédit résidence');
  const closeDate = addMonths(today, -3);
  let r = await admin.post(`/api/holdings/${credit.id}/close`, { date: closeDate });
  assert.equal(r.status, 200);
  const h = (await admin.get(`/api/holdings/${credit.id}`)).data;
  assert.equal(h.schedule, null);
  assert.equal(h.holding.value_cents, 0);
  assert.equal(h.valuations[0].valued_at, closeDate);
  assert.equal(h.valuations[0].note, 'Clôture');
  assert.ok(h.valuations.every((v) => v.valued_at <= closeDate));
  const sched = { kind: 'amortizing', principal_cents: 20_000_000, annual_rate: 3.2, months: 300, start_date: addMonths(today, -24) };
  const paidBefore = amortization(sched).filter((row) => row.date < closeDate);
  assert.equal(h.valuations.length, 1 + paidBefore.length + 1, 'versement, échéances avant la clôture, clôture');
  assert.equal(h.valuations[1].amount_cents, paidBefore.at(-1).remaining);
  r = await admin.patch(`/api/holdings/${credit.id}`, { schedule: { ...plan } });
  assert.equal(r.status, 409, 'rouvrir avant de redéfinir un échéancier');
});
