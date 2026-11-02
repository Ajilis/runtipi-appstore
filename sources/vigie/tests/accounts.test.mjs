// 0.11.0 : chaque compte a son patrimoine. Rôles Utilisateur / Administrateur / Lecture seule appliqués partout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer, client } from './helpers.mjs';
import { todayIso } from '../server/portfolio.js';

const PASSWORD = 'mot-de-passe-test-2026';

test('chaque compte : ses catégories, sa cible, son rappel, son journal ; taux manuels et devise réservés à l’administrateur', async () => {
  const srv = await startServer();
  try {
    const admin = client(srv.base), bruno = client(srv.base), claire = client(srv.base);
    assert.equal((await admin.post('/api/auth/setup', { username: 'alice', first_name: 'Alice', last_name: 'A', password: PASSWORD, base_currency: 'EUR' })).status, 200);
    const created = await admin.post('/api/users', { username: 'bruno', first_name: 'Bruno', last_name: 'B', password: PASSWORD });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.user.role, 'editor', 'sans précision, le rôle est Utilisateur');
    assert.equal((await admin.post('/api/users', { username: 'claire', first_name: 'Claire', last_name: 'C', password: PASSWORD, role: 'viewer' })).status, 200);
    assert.equal((await bruno.post('/api/auth/login', { username: 'bruno', password: PASSWORD })).status, 200);
    assert.equal((await claire.post('/api/auth/login', { username: 'claire', password: PASSWORD })).status, 200);

    // Catégories et cibles propres à chaque compte.
    const aCats = (await admin.get('/api/categories')).data.categories;
    const bCats = (await bruno.get('/api/categories')).data.categories;
    assert.ok(bCats.length >= 10 && bCats.length === aCats.length, 'catégories par défaut pour le nouveau compte');
    const bBourse = bCats.find((c) => c.name === 'Bourse');
    assert.equal((await bruno.patch('/api/categories/' + bBourse.id, { target_pct: 60 })).status, 200);
    assert.equal((await admin.get('/api/categories')).data.categories.find((c) => c.name === 'Bourse').target_pct, null, 'cible de Bruno sans effet chez Alice');
    const nc = await bruno.post('/api/categories', { name: 'Montres', kind: 'asset' });
    assert.equal(nc.status, 200);
    assert.ok(!(await admin.get('/api/categories')).data.categories.some((c) => c.name === 'Montres'), 'catégorie créée par Bruno invisible chez Alice');
    const pea = await bruno.post('/api/holdings', { category_id: bBourse.id, name: 'PEA de Bruno', institution: 'Banque Bruno', amount: 20000, date: todayIso() });
    assert.equal(pea.status, 200, JSON.stringify(pea.data));
    const dash = (await bruno.get('/api/dashboard')).data;
    assert.equal(dash.categories.find((c) => c.name === 'Bourse').target_pct, 0.6, 'le tableau de bord de Bruno suit sa cible');
    assert.equal((await claire.post('/api/holdings', { category_id: (await claire.get('/api/categories')).data.categories[0].id, name: 'x', amount: 1 })).status, 403,
      'lecture seule : ne crée rien');

    // Rappel par compte, devise commune.
    assert.equal((await bruno.put('/api/settings', { stale_days: 10 })).status, 200);
    assert.equal((await bruno.get('/api/settings')).data.stale_days, 10);
    assert.equal((await admin.get('/api/settings')).data.stale_days, 45, 'le rappel de Bruno ne change pas celui d’Alice');
    assert.equal((await bruno.get('/api/holdings')).data.stale_days, 10);
    assert.equal((await bruno.put('/api/settings', { base_currency: 'USD' })).status, 403);
    assert.equal((await bruno.put('/api/settings', { base_currency: 'EUR', stale_days: 12 })).status, 200, 'renvoyer la devise inchangée est sans effet');

    // Taux manuels : administrateur seulement.
    assert.equal((await bruno.put('/api/fx', { rates: { USD: 5 } })).status, 403);
    assert.equal((await bruno.del('/api/fx/USD')).status, 403);
    assert.equal((await admin.put('/api/fx', { rates: { USD: '0,92' } })).status, 200);
    assert.equal((await bruno.get('/api/settings')).data.rates.find((r) => r.currency === 'USD').rate, 0.92, 'taux communs à tous');

    // Journal : chacun le sien ; l'administrateur ne voit pas le détail du patrimoine des autres.
    const mine = (await bruno.get('/api/audit/mine')).data.entries;
    assert.ok(mine.some((e) => e.action === 'avoir_cree' && /PEA de Bruno/.test(e.detail)));
    assert.ok(mine.every((e) => e.username === 'bruno'));
    assert.equal((await bruno.get('/api/audit')).status, 403);
    const adminLog = (await admin.get('/api/audit')).data.entries;
    assert.ok(adminLog.some((e) => e.username === 'bruno' && e.action === 'connexion'), 'connexions de tous visibles');
    assert.ok(!adminLog.some((e) => e.username === 'bruno' && /^(avoir_|categorie_|valeur_)/.test(e.action)), 'patrimoine de Bruno masqué');
    assert.ok(!JSON.stringify(adminLog).includes('PEA de Bruno'));
    assert.ok(adminLog.some((e) => e.username === 'alice' && e.action === 'utilisateur_cree'));

    // Établissements : l'administrateur ne voit que les siens.
    assert.ok(!(await admin.get('/api/admin/logos')).data.in_use.some((x) => x.name === 'Banque Bruno'));

    // Avoir partagé : rangé dans la catégorie équivalente du destinataire.
    const share = await bruno.post('/api/holdings/' + pea.data.id + '/shares', { recipient_id: (await admin.get('/api/users')).data.users.find((u) => u.username === 'claire').id, ownership_pct: 50 });
    assert.equal(share.status, 200, JSON.stringify(share.data));
    assert.equal((await claire.post('/api/shares/' + share.data.invitation.id + '/decision', { decision: 'accept' })).status, 200);
    const cCats = (await claire.get('/api/categories')).data.categories;
    const seen = (await claire.get('/api/holdings')).data.holdings.find((h) => h.name === 'PEA de Bruno');
    assert.equal(seen.category_id, cCats.find((c) => c.name === 'Bourse').id, 'dans la catégorie Bourse de Claire');
    assert.equal(cCats.find((c) => c.name === 'Bourse').holding_count, 1);
    assert.equal((await claire.get('/api/holdings/' + pea.data.id)).data.holding.category_id, seen.category_id);
    // Sans équivalent (catégorie renommée chez Bruno) : celle de Bruno, en lecture seule.
    assert.equal((await bruno.patch('/api/categories/' + bBourse.id, { name: 'Actions' })).status, 200);
    const cCats2 = (await claire.get('/api/categories')).data.categories;
    const foreign = cCats2.find((c) => c.name === 'Actions');
    assert.ok(foreign && foreign.shared_only && foreign.holding_count === 1);
    assert.equal((await claire.get('/api/dashboard')).data.totals.assets, 1000000);

    // Restauration personnelle.
    const exp = (await bruno.get('/api/export.json')).data;
    assert.ok(exp.categories.some((c) => c.name === 'Montres') && !exp.categories.some((c) => aCats.some((a) => a.id === c.id)));
    const r = await bruno.post('/api/import', exp);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await bruno.get('/api/holdings')).data.holdings.length, 1);
    assert.equal((await claire.get('/api/dashboard')).data.totals.assets, 1000000, 'le partage accepté est restauré');
    assert.equal((await bruno.get('/api/settings')).data.stale_days, 12);

    // Supprimer un compte qui a des avoirs : seulement sur confirmation, avec ses avoirs.
    const brunoId = (await admin.get('/api/users')).data.users.find((u) => u.username === 'bruno').id;
    const refused = await admin.del('/api/users/' + brunoId);
    assert.equal(refused.status, 409);
    assert.equal(refused.data.holdings, 1);
    assert.equal((await admin.del('/api/users/' + brunoId + '?avec_avoirs=1')).status, 200);
    assert.equal((await claire.get('/api/holdings')).data.holdings.length, 0, 'l’avoir partagé disparaît avec son titulaire');
    assert.equal((await claire.get('/api/dashboard')).data.totals.assets, 0);
  } finally { await srv.stop(); }
});

test('libellés : Utilisateur, Administrateur, Lecture seule, sans patrimoine commun', () => {
  const ui = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const mail = readFileSync(new URL('../server/mail.js', import.meta.url), 'utf8');
  assert.match(ui, /const ROLE = \{ admin: 'Administrateur', editor: 'Utilisateur', viewer: 'Lecture seule' \}/);
  assert.doesNotMatch(ui, /Éditeur|éditeur ou un administrateur|Qui peut consulter ou modifier le patrimoine/);
  assert.doesNotMatch(mail, /de votre foyer|éditeur \(/);
  assert.match(ui, /k === 'editor' \? 'selected'/, 'rôle Utilisateur proposé par défaut');
  assert.match(ui, /Mon journal/);
  assert.match(ui, /'\/api\/import'/);
});
