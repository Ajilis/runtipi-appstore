// 1.4.0 : corriger la répartition d'un avoir partagé. Une part déjà acceptée ne change qu'avec l'accord
// de la personne concernée ; la part du titulaire et les demandes non encore acceptées changent tout de suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, client } from './helpers.mjs';
import { startFakeSmtp, parseMessage } from './smtp-fake.mjs';
import { todayIso } from '../server/portfolio.js';
import { openDatabase, MIGRATIONS } from '../server/db.js';

const PASSWORD = 'mot-de-passe-test-2026';

async function household(srv) {
  const alice = client(srv.base);
  assert.equal((await alice.post('/api/auth/setup', { username: 'alice', first_name: 'Alice', last_name: 'A', password: PASSWORD, base_currency: 'EUR' })).status, 200);
  const mk = async (username, first, email) => (await alice.post('/api/users', { username, first_name: first, last_name: 'X', password: PASSWORD, email })).data.user;
  const lea = await mk('lea', 'Léa', 'lea@example.fr');
  const paul = await mk('paul', 'Paul', 'paul@example.fr');
  const login = async (username) => { const c = client(srv.base); assert.equal((await c.post('/api/auth/login', { username, password: PASSWORD })).status, 200); return c; };
  return { alice, lea, paul, leaC: await login('lea'), paulC: await login('paul') };
}
const ownBp = async (c, id) => (await c.get(`/api/holdings/${id}`)).data.holding.total_ownership_bp;
const journal = async (c) => (await c.get('/api/audit/mine')).data.entries.map((e) => `${e.action} ${e.detail}`).join('\n');

test('correction directe : part du titulaire et demande non acceptée, sans accord nécessaire', async () => {
  const srv = await startServer();
  try {
    const { alice, lea, leaC } = await household(srv);
    const cat = (await alice.get('/api/categories')).data.categories.find((c) => c.name === 'Comptes courants');
    const id = (await alice.post('/api/holdings', { category_id: cat.id, name: 'Compte joint', amount: 1000, date: todayIso() })).data.id;
    const share = (await alice.post(`/api/holdings/${id}/shares`, { recipient_id: lea.id, ownership_pct: 50 })).data.invitation;

    // Total au-delà de 100 %, liste incomplète, part nulle : refusés.
    let r = await alice.post(`/api/holdings/${id}/split`, { owner_pct: 60, shares: [{ id: share.id, ownership_pct: 50 }] });
    assert.equal(r.status, 400);
    assert.match(r.data.message, /Le total fait 110 % : il ne peut pas dépasser 100 %/);
    assert.equal((await alice.post(`/api/holdings/${id}/split`, { owner_pct: 60, shares: [] })).data.error, 'split_changed');
    assert.equal((await alice.post(`/api/holdings/${id}/split`, { owner_pct: 60, shares: [{ id: share.id, ownership_pct: 0 }] })).status, 400);
    assert.equal((await alice.post(`/api/holdings/${id}/split`, { owner_pct: 100, shares: [{ id: share.id, ownership_pct: 50 }] })).data.error, 'split_over');
    assert.equal((await leaC.post(`/api/holdings/${id}/split`, { owner_pct: 50, shares: [{ id: share.id, ownership_pct: 50 }] })).status, 404, 'seul le titulaire corrige');

    // Demande pas encore acceptée : nouvelle part tout de suite, et une part laissée hors Vigie.
    r = await alice.post(`/api/holdings/${id}/split`, { owner_pct: 50, shares: [{ id: share.id, ownership_pct: '33,33' }] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.applied, true);
    const inbox = (await leaC.get('/api/shares/inbox')).data;
    assert.equal(inbox.invitations[0].ownership_bp, 3333, 'la demande affiche la part corrigée');
    assert.deepEqual(inbox.corrections, []);
    assert.equal(await ownBp(alice, id), 5000);
    const shares = (await alice.get(`/api/holdings/${id}/shares`)).data;
    assert.equal(shares.complement_bp, 10000 - 5000 - 3333, 'reste hors Vigie');
    assert.equal(shares.correction, null);
    assert.match(await journal(alice), /partage_repartition_corrigee Compte joint : vous 100 %, Léa X 50 % → vous 50 %, Léa X 33,33 %/);

    // Acceptée ensuite : aucune part retirée au titulaire, tout tient dans le total.
    assert.equal((await leaC.post(`/api/shares/${share.id}/decision`, { decision: 'accept' })).status, 200);
    assert.equal(await ownBp(alice, id), 5000);
    assert.equal(await ownBp(leaC, id), 3333);
    assert.equal((await alice.post(`/api/holdings/${id}/split`, { owner_pct: 50, shares: [{ id: share.id, ownership_pct: 33.33 }] })).data.error, 'no_change');
    // Augmenter seulement sa propre part (dans le reste hors Vigie) : immédiat, sans accord.
    r = await alice.post(`/api/holdings/${id}/split`, { owner_pct: 66.67, shares: [{ id: share.id, ownership_pct: 33.33 }] });
    assert.equal(r.data.applied, true);
    assert.equal(await ownBp(alice, id), 6667);
  } finally { await srv.stop(); }
});

test('correction d’une part acceptée : accord de la personne, refus, annulation, e-mail et journal', async () => {
  const smtp = await startFakeSmtp({ auth: { user: 'vigie', pass: 'secret' } });
  const srv = await startServer();
  try {
    const { alice, lea, paul, leaC, paulC } = await household(srv);
    assert.equal((await alice.put('/api/admin/mail', { host: '127.0.0.1', port: smtp.port, security: 'none', username: 'vigie', password: 'secret',
      from_address: 'vigie@example.fr', from_name: 'Vigie', public_url: 'https://vigie.exemple.fr' })).status, 200);
    const cat = (await alice.get('/api/categories')).data.categories.find((c) => c.name === 'Immobilier');
    const created = await alice.post('/api/holdings', { category_id: cat.id, name: 'Maison', amount: '300.000', date: todayIso(),
      property: { purchase_amount: '200.000', purchased_at: '2015-06-01', property_type: 'maison', ownership_pct: 100 } });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const id = created.data.id;
    // Erreur d'origine : 50 % proposés et acceptés au lieu de 30 %.
    const share = (await alice.post(`/api/holdings/${id}/shares`, { recipient_id: lea.id, ownership_pct: 50 })).data.invitation;
    assert.equal((await leaC.post(`/api/shares/${share.id}/decision`, { decision: 'accept' })).status, 200);
    assert.equal(await ownBp(alice, id), 5000);
    smtp.messages.length = 0;

    // Proposition : Alice 70 %, Léa 30 %. Rien ne change avant l'accord de Léa.
    let r = await alice.post(`/api/holdings/${id}/split`, { owner_pct: 70, shares: [{ id: share.id, ownership_pct: 30 }] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.applied, false);
    assert.equal(r.data.correction.status, 'pending');
    assert.deepEqual(r.data.mailed, ['Léa X']);
    assert.equal(await ownBp(alice, id), 5000);
    assert.equal(await ownBp(leaC, id), 5000);
    assert.deepEqual(smtp.messages[0].to, ['lea@example.fr']);
    const mail = parseMessage(smtp.messages[0].data);
    assert.match(mail.subject, /Alice A propose de corriger votre quote-part/);
    assert.match(mail.text, /« Maison » dans Vigie : 50 % → 30 %/);
    assert.match(mail.text, /votre quote-part reste de 50 %/);
    // Le titulaire voit la correction en attente dans la fiche et dans la liste.
    let detail = (await alice.get(`/api/holdings/${id}`)).data;
    assert.equal(detail.correction.status, 'pending');
    assert.deepEqual(detail.correction.items.map((i) => [i.recipient_name, i.bp_before, i.bp_after, i.needs_consent]), [['Léa X', 5000, 3000, true]]);
    assert.equal((await alice.get('/api/holdings')).data.holdings.find((h) => h.id === id).sharing.correction_pending, true);
    // Léa la voit en haut de ses Avoirs, avec la valeur de sa part avant et après.
    const inbox = (await leaC.get('/api/shares/inbox')).data.corrections;
    assert.equal(inbox.length, 1);
    assert.deepEqual([inbox[0].holding_name, inbox[0].sender_name, inbox[0].bp_before, inbox[0].bp_after, inbox[0].before_cents, inbox[0].after_cents],
      ['Maison', 'Alice A', 5000, 3000, 15_000_000, 9_000_000]);
    assert.equal((await leaC.get(`/api/holdings/${id}`)).data.correction.mine.bp_after, 3000);
    assert.equal((await leaC.get('/api/holdings')).data.holdings.find((h) => h.id === id).sharing.correction_pending, true);
    // Personne d'autre ne répond à sa place.
    assert.equal((await paulC.post(`/api/share-corrections/${r.data.correction.id}/decision`, { decision: 'accept' })).status, 404);
    assert.equal((await alice.post(`/api/share-corrections/${r.data.correction.id}/decision`, { decision: 'accept' })).status, 404);

    // Refus : la répartition reste 50/50, le titulaire le voit et le journal le garde.
    let d = await leaC.post(`/api/share-corrections/${r.data.correction.id}/decision`, { decision: 'decline' });
    assert.equal(d.data.status, 'declined');
    assert.equal(await ownBp(alice, id), 5000);
    detail = (await alice.get(`/api/holdings/${id}`)).data;
    assert.equal(detail.correction.status, 'declined');
    assert.equal(detail.correction.declined_by_name, 'Léa X');
    assert.match(await journal(alice), /partage_correction_refusee Maison : Léa X a refusé 50 % → 30 %/);
    assert.match(await journal(leaC), /partage_correction_refusee Maison : votre quote-part 50 % → 30 %/);
    assert.equal((await leaC.post(`/api/share-corrections/${r.data.correction.id}/decision`, { decision: 'accept' })).data.error, 'correction_closed');
    assert.equal((await leaC.get(`/api/holdings/${id}`)).data.correction, null);

    // Nouvelle proposition puis annulation par le titulaire.
    r = await alice.post(`/api/holdings/${id}/split`, { owner_pct: 70, shares: [{ id: share.id, ownership_pct: 30 }] });
    assert.equal((await alice.del(`/api/share-corrections/${r.data.correction.id}`)).status, 200);
    assert.equal((await leaC.get('/api/shares/inbox')).data.corrections.length, 0);
    assert.equal((await alice.get(`/api/holdings/${id}`)).data.correction.status, 'cancelled');

    // Proposition remplacée par une autre : une seule en attente.
    const first = (await alice.post(`/api/holdings/${id}/split`, { owner_pct: 60, shares: [{ id: share.id, ownership_pct: 40 }] })).data.correction;
    r = await alice.post(`/api/holdings/${id}/split`, { owner_pct: 70, shares: [{ id: share.id, ownership_pct: 30 }] });
    assert.equal((await leaC.get('/api/shares/inbox')).data.corrections.length, 1);
    assert.equal((await leaC.post(`/api/share-corrections/${first.id}/decision`, { decision: 'accept' })).data.message, 'Cette proposition a été annulée : remplacée par une nouvelle correction.');

    // Accord : nouvelle répartition appliquée aux deux comptes, pour tout l'historique.
    d = await leaC.post(`/api/share-corrections/${r.data.correction.id}/decision`, { decision: 'accept' });
    assert.equal(d.status, 200, JSON.stringify(d.data));
    assert.equal(d.data.status, 'applied');
    assert.equal(await ownBp(alice, id), 7000);
    assert.equal(await ownBp(leaC, id), 3000);
    assert.equal((await alice.get(`/api/holdings/${id}`)).data.property.ownership_bp, 7000, 'quote-part du bien mise à jour');
    assert.equal((await alice.get(`/api/holdings/${id}`)).data.correction, null);
    assert.equal((await leaC.get(`/api/holdings/${id}`)).data.holding.owned_cents, 9_000_000);
    assert.match(await journal(alice), /partage_repartition_corrigee Maison : vous 50 %, Léa X 50 % → vous 70 %, Léa X 30 %, acceptée par Léa X/);
    assert.match(await journal(leaC), /partage_correction_acceptee Maison : votre quote-part 50 % → 30 %/);
    // Si Léa renonce plus tard, Alice récupère la part qu'elle lui avait cédée (au plus 30 %) : 100 %.
    assert.equal((await leaC.del(`/api/shares/${share.id}`)).status, 200);
    assert.equal(await ownBp(alice, id), 10000);

    // Deux personnes : la correction attend les deux accords.
    const s1 = (await alice.post(`/api/holdings/${id}/shares`, { recipient_id: lea.id, ownership_pct: 40 })).data.invitation;
    const s2 = (await alice.post(`/api/holdings/${id}/shares`, { recipient_id: paul.id, ownership_pct: 20 })).data.invitation;
    await leaC.post(`/api/shares/${s1.id}/decision`, { decision: 'accept' });
    await paulC.post(`/api/shares/${s2.id}/decision`, { decision: 'accept' });
    assert.equal(await ownBp(alice, id), 4000);
    r = await alice.post(`/api/holdings/${id}/split`, { owner_pct: 50, shares: [{ id: s1.id, ownership_pct: 30 }, { id: s2.id, ownership_pct: 20 }] });
    assert.deepEqual(r.data.correction.items.map((i) => i.needs_consent), [true, false], 'Paul n’est pas concerné : sa part ne change pas');
    assert.equal((await paulC.get('/api/shares/inbox')).data.corrections.length, 0);
    r = await alice.post(`/api/holdings/${id}/split`, { owner_pct: 50, shares: [{ id: s1.id, ownership_pct: 25 }, { id: s2.id, ownership_pct: 25 }] });
    d = await leaC.post(`/api/share-corrections/${r.data.correction.id}/decision`, { decision: 'accept' });
    assert.deepEqual(d.data, { status: 'waiting', waiting: ['Paul X'] });
    assert.equal(await ownBp(alice, id), 4000, 'rien ne change avant le dernier accord');
    d = await paulC.post(`/api/share-corrections/${r.data.correction.id}/decision`, { decision: 'accept' });
    assert.equal(d.data.status, 'applied');
    assert.deepEqual([await ownBp(alice, id), await ownBp(leaC, id), await ownBp(paulC, id)], [5000, 2500, 2500]);

    // Une autre modification de la répartition rend la correction caduque, avec sa raison.
    r = await alice.post(`/api/holdings/${id}/split`, { owner_pct: 60, shares: [{ id: s1.id, ownership_pct: 20 }, { id: s2.id, ownership_pct: 20 }] });
    assert.equal((await paulC.del(`/api/shares/${s2.id}`)).status, 200);
    detail = (await alice.get(`/api/holdings/${id}`)).data;
    assert.equal(detail.correction.status, 'cancelled');
    assert.equal(detail.correction.cancel_reason, 'Paul X a renoncé à sa part.');
    assert.equal((await leaC.post(`/api/share-corrections/${r.data.correction.id}/decision`, { decision: 'accept' })).data.error, 'correction_closed');
    // Modifier sa quote-part dans la fiche du bien l'annule aussi.
    r = await alice.post(`/api/holdings/${id}/split`, { owner_pct: 60, shares: [{ id: s1.id, ownership_pct: 20 }] });
    const h = (await alice.get(`/api/holdings/${id}`)).data;
    const patch = await alice.patch(`/api/holdings/${id}`, { name: 'Maison', category_id: cat.id, currency: 'EUR', liquidity: h.holding.liquidity,
      property: { purchase_amount: '200.000', purchased_at: '2015-06-01', property_type: 'maison', ownership_pct: 55 } });
    assert.equal(patch.status, 200, JSON.stringify(patch.data));
    assert.equal((await alice.get(`/api/holdings/${id}`)).data.correction.cancel_reason, 'Votre quote-part a été modifiée dans la fiche de l’avoir.');
    // Garde-fou : si l'état a changé sans passer par ces chemins, l'accord n'applique rien.
    r = await alice.post(`/api/holdings/${id}/split`, { owner_pct: 60, shares: [{ id: s1.id, ownership_pct: 20 }] });
    srv.app.db.prepare('UPDATE holding_shares SET ownership_bp = 2600 WHERE id = ?').run(s1.id);
    d = await leaC.post(`/api/share-corrections/${r.data.correction.id}/decision`, { decision: 'accept' });
    assert.equal(d.status, 409);
    assert.equal(d.data.error, 'split_changed');
    assert.equal(await ownBp(alice, id), 5500);
  } finally { await srv.stop(); await smtp.close(); }
});

test('migration 1.4.0 : tables des corrections ajoutées, suppression en cascade avec l’avoir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-mig-'));
  const raw = new DatabaseSync(path.join(dir, 'vigie.sqlite'));
  raw.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (let i = 0; i < 21; i++) { raw.exec(MIGRATIONS[i]); raw.prepare('INSERT INTO schema_migrations VALUES (?, 0)').run(i + 1); }
  raw.prepare("INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES (1, 'alex', 'Alex', 'x', 'admin', 0), (2, 'lea', 'Léa', 'x', 'editor', 0)").run();
  raw.prepare("INSERT INTO categories (id, name, kind, icon, created_at, account_user_id) VALUES (1, 'Comptes courants', 'asset', 'wallet', 0, 1)").run();
  raw.prepare("INSERT INTO holdings (id, category_id, name, currency, liquidity, created_at, updated_at, account_user_id, ownership_bp) VALUES (1, 1, 'Joint', 'EUR', 'immediate', 0, 0, 1, 5000)").run();
  raw.prepare('INSERT INTO holding_shares (id, holding_id, sender_id, recipient_id, ownership_bp, created_at, expires_at, accepted_at) VALUES (1, 1, 1, 2, 5000, 0, 1, 1)').run();
  raw.close();
  const db = openDatabase(dir);
  db.prepare('INSERT INTO share_corrections (id, holding_id, sender_id, owner_bp_before, owner_bp_after, created_at) VALUES (1, 1, 1, 5000, 7000, 0)').run();
  db.prepare('INSERT INTO share_correction_items (correction_id, share_id, bp_before, bp_after, needs_consent) VALUES (1, 1, 5000, 3000, 1)').run();
  assert.throws(() => db.prepare('INSERT INTO share_corrections (holding_id, owner_bp_before, owner_bp_after, created_at) VALUES (1, 5000, 6000, 0)').run(), /UNIQUE/, 'une seule correction en attente par avoir');
  db.prepare('DELETE FROM holdings WHERE id = 1').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM share_corrections').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM share_correction_items').get().n, 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
