import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.mjs';
import { totpAt, currentStep } from '../server/security.js';
import { todayIso, addMonths, addDays } from '../server/portfolio.js';

let srv, admin;
const today = todayIso();
const PASSWORD = 'motdepasse-solide-42';

before(async () => { srv = await startServer(); admin = client(srv.base); });
after(async () => { await srv.stop(); });

test('santé et état initial', async () => {
  const h = await admin.get('/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.data.ok, true);
  const s = await admin.get('/api/auth/state');
  assert.equal(s.data.setup_required, true);
  assert.equal(s.data.setup_allowed, true);
});

test("l'installation est refusée à travers Cloudflare", async () => {
  const viaTunnel = client(srv.base, { 'cf-connecting-ip': '203.0.113.9', 'cf-ray': 'abc' });
  const s = await viaTunnel.get('/api/auth/state');
  assert.equal(s.data.setup_allowed, false);
  const r = await viaTunnel.post('/api/auth/setup', { username: 'pirate', display_name: 'X', password: PASSWORD });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'setup_local_only');
});

test('installation locale du compte administrateur', async () => {
  const weak = await admin.post('/api/auth/setup', { username: 'alex', display_name: 'Alex', password: 'court' });
  assert.equal(weak.status, 400);
  const r = await admin.post('/api/auth/setup', { username: 'alex', display_name: 'Alex Martin', password: PASSWORD, base_currency: 'EUR' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.role, 'admin');
  assert.ok(admin.jar.has('vigie_sid'));
  const again = await client(srv.base).post('/api/auth/setup', { username: 'bob', display_name: 'Bob', password: PASSWORD });
  assert.equal(again.status, 409);
  const cats = await admin.get('/api/categories');
  assert.equal(cats.data.categories.length, 12);
});

test('protection CSRF des requêtes modifiantes', async () => {
  const noHeader = await admin.post('/api/categories', { name: 'Test', kind: 'asset' }, { 'x-vigie-request': '' });
  assert.equal(noHeader.status, 403);
  const foreign = await admin.post('/api/categories', { name: 'Test', kind: 'asset' }, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  const same = await admin.post('/api/categories', { name: 'Test', kind: 'asset' }, { origin: srv.base });
  assert.equal(same.status, 200);
  await admin.del(`/api/categories/${same.data.category.id}`);
});

let ids = {};
test('avoirs, valeurs, devises et passifs', async () => {
  const cats = (await admin.get('/api/categories')).data.categories;
  const cat = (name) => cats.find((c) => c.name === name).id;
  const yearAgo = addMonths(today, -12);
  let r = await admin.post('/api/holdings', { category_id: cat('Épargne réglementée'), name: 'Livret A', institution: 'Banque Postale', owner: 'Moi', amount: '10 000,00', date: yearAgo });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  ids.livret = r.data.id;
  r = await admin.post(`/api/holdings/${ids.livret}/valuations`, { amount: 12000, date: today });
  assert.equal(r.status, 200);
  r = await admin.post('/api/holdings', { category_id: cat('Bourse'), name: 'PEA', institution: 'Boursorama', owner: 'Moi', amount: 50000, date: today });
  ids.pea = r.data.id;
  r = await admin.post('/api/holdings', { category_id: cat('Bourse'), name: 'Compte US', currency: 'USD', amount: 1000, date: today });
  ids.us = r.data.id;
  r = await admin.post('/api/holdings', { category_id: cat('Crédits immobiliers'), name: 'Prêt résidence', amount: 100000, date: today });
  ids.loan = r.data.id;

  let d = (await admin.get('/api/dashboard')).data;
  assert.deepEqual(d.missing_rates, ['USD']);
  assert.equal(d.totals.assets, 6_200_000);

  r = await admin.put('/api/fx', { rates: { USD: '0,9' } });
  assert.equal(r.status, 200);
  d = (await admin.get('/api/dashboard')).data;
  assert.deepEqual(d.missing_rates, []);
  assert.equal(d.totals.assets, 6_290_000);
  assert.equal(d.totals.liabilities, 10_000_000);
  assert.equal(d.totals.net, 6_290_000 - 10_000_000);
  assert.equal(d.liquidity.immediate, 1_200_000);
  assert.equal(d.liquidity.short, 5_090_000);
  const bourse = d.categories.find((c) => c.name === 'Bourse');
  assert.equal(bourse.value, 5_090_000);
  // Il y a un an : seul le Livret A existait (10 000 €).
  assert.equal(d.variations.year.net, 1_000_000);
  assert.equal(d.variations.year.delta, d.totals.net - 1_000_000);

  const hist = (await admin.get('/api/history?range=all')).data;
  assert.equal(hist.points[0].date, yearAgo);
  assert.equal(hist.points[0].net, 1_000_000);
  assert.equal(hist.points.at(-1).net, d.totals.net);
});

test('allocation cible et écart', async () => {
  const cats = (await admin.get('/api/categories')).data.categories;
  const bourseId = cats.find((c) => c.name === 'Bourse').id;
  const r = await admin.patch(`/api/categories/${bourseId}`, { target_pct: 60 });
  assert.equal(r.status, 200);
  const d = (await admin.get('/api/dashboard')).data;
  const b = d.categories.find((c) => c.id === bourseId);
  assert.equal(b.target_pct, 0.6);
  assert.equal(b.gap, Math.round(0.6 * 6_290_000 - 5_090_000));
  const bad = await admin.patch(`/api/categories/${bourseId}`, { target_pct: 150 });
  assert.equal(bad.status, 400);
});

test('mise à jour rapide et clôture', async () => {
  const r = await admin.post('/api/valuations/bulk', { date: today, items: [{ holding_id: ids.pea, amount: '52 500' }, { holding_id: ids.livret, amount: 12000 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.saved, 2);
  let d = (await admin.get('/api/dashboard')).data;
  assert.equal(d.totals.assets, 6_540_000);
  const c = await admin.post(`/api/holdings/${ids.us}/close`, { date: today });
  assert.equal(c.status, 200);
  d = (await admin.get('/api/dashboard')).data;
  assert.equal(d.totals.assets, 6_450_000);
  const detail = (await admin.get(`/api/holdings/${ids.us}`)).data;
  assert.equal(detail.holding.closed_at, today);
  const future = await admin.post(`/api/holdings/${ids.pea}/valuations`, { amount: 1, date: addDays(today, 10) });
  assert.equal(future.status, 400);
});

test('rôle lecture seule', async () => {
  const r = await admin.post('/api/users', { username: 'conjoint', display_name: 'Sam', role: 'viewer', password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const viewer = client(srv.base);
  const login = await viewer.post('/api/auth/login', { username: 'conjoint', password: PASSWORD });
  assert.equal(login.status, 200);
  assert.equal((await viewer.get('/api/dashboard')).status, 200);
  assert.equal((await viewer.post('/api/holdings', { category_id: 1, name: 'X' })).status, 403);
  assert.equal((await viewer.get('/api/users')).status, 403);
  assert.equal((await viewer.get('/api/audit')).status, 403);
  const anon = client(srv.base);
  assert.equal((await anon.get('/api/dashboard')).status, 401);
});

test('blocage du compte après plusieurs échecs', async () => {
  await admin.post('/api/users', { username: 'cible', display_name: 'Cible', role: 'editor', password: PASSWORD });
  const c = client(srv.base, { 'cf-connecting-ip': '198.51.100.7' });
  for (let i = 0; i < 5; i++) {
    const r = await c.post('/api/auth/login', { username: 'cible', password: 'mauvais-mot-de-passe' });
    assert.equal(r.status, 401);
  }
  const locked = await c.post('/api/auth/login', { username: 'cible', password: PASSWORD });
  assert.equal(locked.status, 423);
  const users = (await admin.get('/api/users')).data.users;
  const target = users.find((u) => u.username === 'cible');
  assert.equal(target.locked, true);
  const unlock = await admin.patch(`/api/users/${target.id}`, { unlock: true });
  assert.equal(unlock.status, 200);
  const ok = await client(srv.base, { 'cf-connecting-ip': '198.51.100.8' }).post('/api/auth/login', { username: 'cible', password: PASSWORD });
  assert.equal(ok.status, 200);
});

test('double authentification TOTP et codes de secours', async () => {
  const setup = await admin.post('/api/account/totp/setup');
  assert.equal(setup.status, 200);
  assert.match(setup.data.uri, /^otpauth:\/\/totp\//);
  const bad = await admin.post('/api/account/totp/enable', { code: '000000' });
  assert.equal(bad.status, 400);
  const enable = await admin.post('/api/account/totp/enable', { code: totpAt(setup.data.secret, currentStep()) });
  assert.equal(enable.status, 200, JSON.stringify(enable.data));
  assert.equal(enable.data.recovery_codes.length, 10);

  const c = client(srv.base, { 'cf-connecting-ip': '192.0.2.50' });
  const step1 = await c.post('/api/auth/login', { username: 'alex', password: PASSWORD });
  assert.equal(step1.data.totp_required, true);
  assert.equal(c.jar.has('vigie_sid'), false);
  const wrong = await c.post('/api/auth/totp', { challenge: step1.data.challenge, code: '123456' });
  assert.equal(wrong.status, 401);
  // Le code d'activation a déjà été consommé : on attend le pas suivant n'est pas possible ici, on utilise un code de secours.
  const rc = await c.post('/api/auth/totp', { challenge: step1.data.challenge, code: enable.data.recovery_codes[0].toUpperCase() });
  assert.equal(rc.status, 200, JSON.stringify(rc.data));
  assert.ok(c.jar.has('vigie_sid'));

  const c2 = client(srv.base, { 'cf-connecting-ip': '192.0.2.51' });
  const s2 = await c2.post('/api/auth/login', { username: 'alex', password: PASSWORD });
  const reuse = await c2.post('/api/auth/totp', { challenge: s2.data.challenge, code: enable.data.recovery_codes[0] });
  assert.equal(reuse.status, 401, 'un code de secours ne sert qu\'une fois');
  const me = (await c.get('/api/account')).data.user;
  assert.equal(me.recovery_codes_left, 9);
});

test('sessions : liste et fermeture des autres sessions', async () => {
  const list = (await admin.get('/api/account/sessions')).data.sessions;
  assert.ok(list.some((s) => s.current));
  const r = await admin.post('/api/account/sessions/revoke-others');
  assert.equal(r.status, 200);
  const after = (await admin.get('/api/account/sessions')).data.sessions;
  assert.equal(after.length, 1);
});

test('export, sauvegarde et import', async () => {
  const before = (await admin.get('/api/dashboard')).data;
  const exp = await admin.get('/api/export.json');
  assert.equal(exp.status, 200);
  assert.equal(exp.data.format, 'vigie-export');
  const csv = await admin.get('/api/export/holdings.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.data.toString('utf8'), /Livret A;Banque Postale/);

  const b = await admin.post('/api/admin/backups');
  assert.equal(b.status, 200);
  const list = (await admin.get('/api/admin/backups')).data.backups;
  assert.ok(list.some((x) => x.name === b.data.backup.name));
  const dl = await admin.get(`/api/admin/backups/${b.data.backup.name}`);
  assert.equal(dl.status, 200);
  assert.equal(dl.data.subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal((await admin.get('/api/admin/backups/..%2F..%2Fetc%2Fpasswd')).status, 400);

  await admin.del(`/api/holdings/${ids.pea}`);
  assert.notEqual((await admin.get('/api/dashboard')).data.totals.net, before.totals.net);
  const imp = await admin.post('/api/admin/import', exp.data);
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  const restored = (await admin.get('/api/dashboard')).data;
  assert.deepEqual(restored.totals, before.totals);
});

test('en-têtes de sécurité sur la page', async () => {
  const res = await fetch(srv.base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal((await fetch(srv.base + '/../server/index.js')).status, 404);
});

test('déconnexion', async () => {
  const r = await admin.post('/api/auth/logout');
  assert.equal(r.status, 200);
  assert.equal((await admin.get('/api/dashboard')).status, 401);
});
