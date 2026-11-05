// 1.8.0 : achats et ventes datés d'un crypto-actif, prix de revient unitaire moyen pondéré (PRU),
// plus-value latente et plus-value réalisée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, client } from './helpers.mjs';
import { cryptoCost, toUnits, fromUnits } from '../server/crypto-cost.js';
import { openDatabase, MIGRATIONS } from '../server/db.js';

const PASSWORD = 'mot-de-passe-test-2026';
const BTC_ADDR = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

test('PRU : coût moyen pondéré, vente au PRU, plus-value réalisée, vente impossible au-delà du détenu', () => {
  assert.equal(fromUnits(toUnits('0.000000000000000001') + toUnits('1.5')), '1.500000000000000001');
  const buys = [
    { id: 1, kind: 'buy', moved_at: '2024-01-10', quantity: '0.1', amount_cents: 300_000, fee_cents: 1_000 },
    { id: 2, kind: 'buy', moved_at: '2024-06-01', quantity: '0.05', amount_cents: 300_000, fee_cents: 0 },
  ];
  let c = cryptoCost(buys);
  assert.equal(c.quantity, '0.15');
  assert.equal(c.cost_cents, 601_000);
  assert.equal(Math.round(c.pru_cents), 4_006_667, 'PRU 40.066,67 €');
  assert.equal(c.invested_cents, 601_000);
  assert.equal(c.first_date, '2024-01-10');
  // Vente d'un tiers : un tiers du coût sort, le PRU de ce qui reste ne change pas.
  const sell = { id: 3, kind: 'sell', moved_at: '2025-03-01', quantity: '0.05', amount_cents: 400_000, fee_cents: 2_000 };
  c = cryptoCost([...buys, sell]);
  assert.equal(c.quantity, '0.1');
  assert.equal(c.cost_cents, 601_000 - 200_333);
  assert.equal(c.realized_cents, 398_000 - 200_333);
  assert.equal(Math.round(c.pru_cents / 100), 40_067);
  assert.deepEqual(c.steps.map((s) => s.quantity_after), ['0.1', '0.15', '0.1']);
  // À une date passée : seules les opérations jusqu'à cette date.
  assert.equal(cryptoCost([...buys, sell], '2024-03-01').quantity, '0.1');
  // Tout vendu : coût nul.
  assert.equal(cryptoCost([...buys, { ...sell, quantity: '0.15' }]).cost_cents, 0);
  // Vente avant les achats ou au-delà du détenu.
  assert.deepEqual(cryptoCost([...buys, { ...sell, moved_at: '2023-12-31' }]).error, { id: 3, moved_at: '2023-12-31', held: '0', sold: '0.05' });
  assert.equal(cryptoCost([...buys, { ...sell, quantity: '0.2' }]).error.held, '0.15');
});

function prices(btcEur = 61000) {
  const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  return async (url) => {
    const u = new URL(url);
    if (u.pathname === '/api/v3/simple/price') return reply({ bitcoin: { eur: btcEur } });
    if (u.hostname === 'mempool.space') return reply({ chain_stats: { funded_txo_sum: 20_000_000, spent_txo_sum: 0 } });
    throw new Error('hôte inattendu ' + u.hostname);
  };
}

test('opérations d’un avoir crypto : quantité, PRU, plus-values, garde-fous, bilan, journal, export', async () => {
  const srv = await startServer({}, { fetcher: prices() });
  try {
    const alice = client(srv.base);
    await alice.post('/api/auth/setup', { username: 'alice', first_name: 'Alice', last_name: 'A', password: PASSWORD, base_currency: 'EUR' });
    const cat = (await alice.get('/api/categories')).data.categories.find((c) => c.icon === 'crypto').id;
    const id = (await alice.post('/api/holdings', { name: 'Bitcoin', category_id: cat, currency: 'EUR', liquidity: 'short', crypto: { asset: 'BTC', mode: 'quantity', quantity: '1' } })).data.id;
    // Avoir crypto sans actif choisi : pas d'opérations.
    const plain = (await alice.post('/api/holdings', { name: 'Autre', category_id: cat, currency: 'EUR', liquidity: 'short', amount: '100' })).data.id;
    assert.equal((await alice.post(`/api/holdings/${plain}/crypto/movements`, { kind: 'buy', date: '2024-01-10', quantity: '1', amount: '1' })).data.error, 'not_crypto');

    let r = await alice.post(`/api/holdings/${id}/crypto/movements`, { kind: 'buy', date: '2024-01-10', quantity: '0,1', amount: '3.000', fee: '10' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    r = await alice.post(`/api/holdings/${id}/crypto/movements`, { kind: 'buy', date: '2024-06-01', quantity: '0,05', amount: '3.000' });
    // La quantité suivie vient des opérations (elle remplace la quantité saisie) ; valeur du jour recalculée.
    assert.equal(r.data.crypto.quantity, '0.15');
    assert.equal(r.data.crypto.cost.quantity, '0.15');
    assert.equal(r.data.crypto.cost.cost_cents, 601_000);
    assert.equal(r.data.crypto.movements.length, 2);
    assert.equal(r.data.crypto.movements[0].moved_at, '2024-06-01', 'plus récente en premier');
    let detail = (await alice.get(`/api/holdings/${id}`)).data;
    assert.equal(detail.valuations[0].amount_cents, 915_000, '0,15 × 61.000 €');
    assert.deepEqual(detail.latent_gain, { gain_cents: 915_000 - 601_000, gain_pct: 52.25 });
    assert.equal(detail.acquisition.source, 'crypto');
    assert.equal(detail.acquisition.purchased_at, '2024-01-10');

    // Vente d'un tiers : plus-value réalisée, PRU inchangé, quantité 0,1.
    r = await alice.post(`/api/holdings/${id}/crypto/movements`, { kind: 'sell', date: '2025-03-01', quantity: '0,05', amount: '4.000', fee: '20' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.crypto.quantity, '0.1');
    assert.equal(r.data.crypto.cost.realized_cents, 197_667);
    assert.equal(r.data.crypto.movements[0].realized_cents, 197_667);
    detail = (await alice.get(`/api/holdings/${id}`)).data;
    assert.equal(detail.valuations[0].amount_cents, 610_000);
    assert.equal(detail.latent_gain.gain_cents, 610_000 - 400_667);
    const listed = (await alice.get('/api/holdings')).data.holdings.find((h) => h.id === id);
    assert.equal(listed.latent_gain_cents, 610_000 - 400_667);

    // Garde-fous : vente au-delà du détenu, vente avant les achats, suppression d'un achat déjà vendu.
    r = await alice.post(`/api/holdings/${id}/crypto/movements`, { kind: 'sell', date: '2025-04-01', quantity: '1', amount: '1' });
    assert.equal(r.status, 409);
    assert.match(r.data.message, /Vente du 01\/04\/2025 : 1 BTC vendus, pour 0,1 BTC détenus à cette date/);
    assert.equal((await alice.post(`/api/holdings/${id}/crypto/movements`, { kind: 'sell', date: '2023-01-01', quantity: '0,01', amount: '1' })).data.error, 'oversell');
    const moves = (await alice.get(`/api/holdings/${id}`)).data.crypto.movements;
    const firstBuy = moves.find((m) => m.moved_at === '2024-01-10');
    const firstSell = moves.find((m) => m.kind === 'sell');
    assert.equal((await alice.patch(`/api/crypto-movements/${firstSell.id}`, { kind: 'sell', date: '2025-03-01', quantity: '0,5', amount: '4.000' })).data.error, 'oversell');
    // Une seconde vente rend le premier achat indispensable : sa suppression est refusée.
    const second = (await alice.post(`/api/holdings/${id}/crypto/movements`, { kind: 'sell', date: '2025-05-01', quantity: '0,05', amount: '3.500' })).data.crypto.movements[0];
    assert.equal((await alice.del(`/api/crypto-movements/${firstBuy.id}`)).data.error, 'oversell');
    assert.equal((await alice.get(`/api/holdings/${id}`)).data.crypto.movements.length, 4, 'rien supprimé');
    assert.equal((await alice.del(`/api/crypto-movements/${second.id}`)).status, 200);
    for (const bad of [{ kind: 'buy', date: '', quantity: '1', amount: '1' }, { kind: 'buy', date: '2024-01-01', quantity: '0', amount: '1' },
      { kind: 'gift', date: '2024-01-01', quantity: '1', amount: '1' }, { kind: 'sell', date: '2024-07-01', quantity: '0,01', amount: '10', fee: '20' }])
      assert.equal((await alice.post(`/api/holdings/${id}/crypto/movements`, bad)).status, 400, JSON.stringify(bad));

    // Modifier une opération : le premier achat passe à 0,2 BTC.
    r = await alice.patch(`/api/crypto-movements/${firstBuy.id}`, { kind: 'buy', date: '2024-01-10', quantity: '0,2', amount: '6.000', fee: '10', note: 'Kraken' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.crypto.quantity, '0.2');
    assert.equal(r.data.crypto.movements.find((m) => m.id === firstBuy.id).note, 'Kraken');

    // Actif verrouillé et suivi impossible à retirer tant qu'il y a des opérations ; quantité imposée.
    const base = { name: 'Bitcoin', category_id: cat, currency: 'EUR', liquidity: 'short' };
    assert.equal((await alice.patch(`/api/holdings/${id}`, { ...base, crypto: { asset: 'ETH', mode: 'quantity', quantity: '1' } })).data.error, 'has_movements');
    assert.equal((await alice.patch(`/api/holdings/${id}`, { ...base, crypto: null })).data.error, 'has_movements');
    assert.equal((await alice.patch(`/api/holdings/${id}`, { ...base, crypto: { asset: 'BTC', mode: 'quantity', quantity: '9' } })).status, 200);
    assert.equal((await alice.get(`/api/holdings/${id}`)).data.crypto.quantity, '0.2', 'la quantité saisie est ignorée');
    // Suivi par adresse : la quantité lue reste celle de l'adresse ; le PRU vient des opérations.
    assert.equal((await alice.patch(`/api/holdings/${id}`, { ...base, crypto: { asset: 'BTC', mode: 'address', address: BTC_ADDR } })).status, 200);
    detail = (await alice.get(`/api/holdings/${id}`)).data;
    assert.equal(detail.crypto.last_quantity, '0.2');
    assert.equal(detail.crypto.cost.quantity, '0.2');

    // Bilan : prix de revient de la quantité restante.
    const rep = (await alice.get('/api/report')).data;
    const line = rep.holdings.find((h) => h.id === id);
    assert.equal(line.latent_basis_cents, detail.crypto.cost.cost_cents);
    // Journal personnel.
    const journal = (await alice.get('/api/audit/mine')).data.entries.map((e) => e.action);
    assert.ok(journal.includes('crypto_operation_ajoutee') && journal.includes('crypto_operation_modifiee'));

    // Un autre compte ne voit ni ne modifie les opérations.
    await alice.post('/api/users', { username: 'bob', first_name: 'Bob', last_name: 'B', password: PASSWORD });
    const bob = client(srv.base);
    await bob.post('/api/auth/login', { username: 'bob', password: PASSWORD });
    assert.equal((await bob.post(`/api/holdings/${id}/crypto/movements`, { kind: 'buy', date: '2024-01-01', quantity: '1', amount: '1' })).status, 404);
    assert.equal((await bob.del(`/api/crypto-movements/${firstBuy.id}`)).status, 404);

    // Suppression, puis export et restauration.
    const sellId = detail.crypto.movements.find((m) => m.kind === 'sell').id;
    assert.equal((await alice.del(`/api/crypto-movements/${sellId}`)).status, 200);
    const exp = (await alice.get('/api/export.json')).data;
    const exported = JSON.parse(Buffer.isBuffer(exp) ? exp.toString('utf8') : JSON.stringify(exp));
    assert.equal(exported.crypto_movements.length, 2);
    assert.equal((await alice.post('/api/import', exported)).status, 200);
    const back = (await alice.get('/api/holdings')).data.holdings.find((h) => h.name === 'Bitcoin');
    const bd = (await alice.get(`/api/holdings/${back.id}`)).data.crypto;
    assert.equal(bd.movements.length, 2);
    assert.equal(bd.cost.quantity, '0.25');
    assert.equal(bd.mode, 'address');
  } finally { await srv.stop(); }
});

test('migration 1.8.0 : table des opérations crypto, suppression en cascade', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-mig-'));
  const raw = new DatabaseSync(path.join(dir, 'vigie.sqlite'));
  raw.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (let i = 0; i < 23; i++) { raw.exec(MIGRATIONS[i]); raw.prepare('INSERT INTO schema_migrations VALUES (?, 0)').run(i + 1); }
  raw.prepare("INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES (1, 'alex', 'Alex', 'x', 'admin', 0)").run();
  raw.prepare("INSERT INTO categories (id, name, kind, icon, created_at, account_user_id) VALUES (1, 'Crypto-actifs', 'asset', 'crypto', 0, 1)").run();
  raw.prepare("INSERT INTO holdings (id, category_id, name, currency, liquidity, created_at, updated_at, account_user_id) VALUES (1, 1, 'BTC', 'EUR', 'short', 0, 0, 1)").run();
  raw.close();
  const db = openDatabase(dir);
  db.prepare("INSERT INTO crypto_movements (holding_id, kind, moved_at, quantity, amount_cents, created_at) VALUES (1, 'buy', '2024-01-01', '0.1', 300000, 0)").run();
  assert.throws(() => db.prepare("INSERT INTO crypto_movements (holding_id, kind, moved_at, quantity, amount_cents, created_at) VALUES (1, 'gift', '2024-01-01', '1', 0, 0)").run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO crypto_movements (holding_id, kind, moved_at, quantity, amount_cents, created_at) VALUES (1, 'buy', '2024-01-01', '1', -5, 0)").run(), /CHECK/);
  db.prepare('DELETE FROM holdings WHERE id = 1').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM crypto_movements').get().n, 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
