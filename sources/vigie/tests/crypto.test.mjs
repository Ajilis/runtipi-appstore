// 1.3.0 : crypto-actif choisi dans une liste, quantité lue à une adresse blockchain (ou saisie),
// valorisée au cours du jour. Les services publics sont simulés : aucun accès réseau pendant les tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, client } from './helpers.mjs';
import { parseQuantity, unitsToQuantity, checkAddress, CRYPTO_ASSETS } from '../server/crypto.js';
import { openDatabase, MIGRATIONS } from '../server/db.js';

const PASSWORD = 'mot-de-passe-test-2026';
const BTC_ADDR = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const ETH_ADDR = '0xDE0B295669A9FD93D5F28D9EC85E40F4CB697BAE';
const SOL_ADDR = '7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs';

test('quantités : virgule décimale, point des milliers, zéro et texte refusés', () => {
  assert.equal(parseQuantity('0,25'), '0.25');
  assert.equal(parseQuantity('0.012'), '0.012', '« 0.012 » reste une décimale');
  assert.equal(parseQuantity('1.250'), '1250', 'point des milliers, comme les montants de Vigie');
  assert.equal(parseQuantity('1.250,5'), '1250.5');
  assert.equal(parseQuantity('1,234.56'), '1234.56');
  assert.equal(parseQuantity(' 12 500 '), '12500');
  assert.equal(parseQuantity('0,000000012345678900'), '0.0000000123456789');
  for (const bad of ['', '0', '0,0', '-1', 'abc', '1e5', '1,2,3']) assert.equal(parseQuantity(bad), null, bad);
  assert.equal(unitsToQuantity(125000000n, 8), '1.25');
  assert.equal(unitsToQuantity(1n, 18), '0.000000000000000001');
  assert.equal(unitsToQuantity(0n, 6), '0');
  assert.equal(unitsToQuantity(4200000000000000000000n, 18), '4200');
});

test('adresses : format vérifié par réseau, Ethereum en minuscules, actifs sans lecture par adresse', () => {
  assert.equal(checkAddress('BTC', ` ${BTC_ADDR} `), BTC_ADDR);
  assert.equal(checkAddress('BTC', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'), '1BoatSLRHtKNngkdXEeobR76b53LETtpyT');
  assert.equal(checkAddress('ETH', ETH_ADDR), ETH_ADDR.toLowerCase());
  assert.equal(checkAddress('USDC', ETH_ADDR), ETH_ADDR.toLowerCase());
  assert.equal(checkAddress('SOL', SOL_ADDR), SOL_ADDR);
  assert.throws(() => checkAddress('BTC', ETH_ADDR), /Adresse Bitcoin invalide \(format attendu : bc1q/);
  assert.throws(() => checkAddress('ETH', '0x123'), /format attendu : 0x suivi de 40 caractères/);
  assert.throws(() => checkAddress('ADA', 'addr1qx'), /saisissez la quantité/);
  // Chaque actif a un identifiant CoinGecko ; ceux qui se lisent par adresse ont un nombre de décimales.
  for (const a of CRYPTO_ASSETS) {
    assert.ok(a.coingecko, a.id);
    if (a.chain) assert.ok(Number.isInteger(a.decimals), a.id);
  }
});

// Services publics simulés : mempool.space, PublicNode (Ethereum), Solana, CoinGecko.
function fakeNetwork() {
  const net = {
    calls: [], down: new Set(),
    btc: { funded: 150_000_000, spent: 25_000_000 }, // 1,25 BTC
    eth: 1_500_000_000_000_000_000n, // 1,5 ETH
    usdc: 2_500_000_000n, // 2 500 USDC
    sol: 3_250_000_000, // 3,25 SOL
    prices: { bitcoin: { eur: 60000, usd: 65000 }, ethereum: { eur: 3000 }, 'usd-coin': { eur: 0.92 }, solana: { eur: 150 }, cardano: { eur: 0.4 } },
  };
  const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  net.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    net.calls.push({ host: u.hostname, url: String(url), body, headers: opts.headers || {} });
    if (net.down.has(u.hostname)) return reply({}, 503);
    if (u.hostname === 'api.coingecko.com') {
      const ids = u.searchParams.get('ids').split(','), vs = u.searchParams.get('vs_currencies').split(',');
      const out = {};
      for (const id of ids) if (net.prices[id]) out[id] = Object.fromEntries(vs.filter((c) => net.prices[id][c] !== undefined).map((c) => [c, net.prices[id][c]]));
      return reply(out);
    }
    if (u.hostname === 'mempool.space') return reply({ address: u.pathname.split('/').pop(), chain_stats: { funded_txo_sum: net.btc.funded, spent_txo_sum: net.btc.spent } });
    if (u.hostname === 'ethereum-rpc.publicnode.com') {
      if (body.method === 'eth_getBalance') return reply({ jsonrpc: '2.0', id: 1, result: '0x' + net.eth.toString(16) });
      if (body.method === 'eth_call') return reply({ jsonrpc: '2.0', id: 1, result: '0x' + net.usdc.toString(16).padStart(64, '0') });
    }
    if (u.hostname === 'api.mainnet-beta.solana.com') return reply({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: net.sol } });
    throw new Error('hôte inattendu ' + u.hostname);
  };
  return net;
}

test('crypto-actif : actif choisi, quantité lue à l’adresse, valeur du jour, erreurs et désactivation', async () => {
  const net = fakeNetwork();
  const srv = await startServer({ COINGECKO_API_KEY: 'cle-demo' }, { fetcher: net.fetch });
  try {
    const alice = client(srv.base);
    assert.equal((await alice.post('/api/auth/setup', { username: 'alice', first_name: 'Alice', last_name: 'A', password: PASSWORD, base_currency: 'EUR' })).status, 200);
    const cats = (await alice.get('/api/categories')).data.categories;
    const cryptoCat = cats.find((c) => c.icon === 'crypto').id;
    const debtCat = cats.find((c) => c.kind === 'liability').id;

    // Liste déroulante : actifs lisibles par adresse, avec le format attendu, puis actifs en quantité.
    const settings = (await alice.get('/api/settings')).data;
    assert.equal(settings.crypto_lookups, true);
    const btc = settings.crypto_assets.find((a) => a.id === 'BTC');
    assert.deepEqual(btc, { id: 'BTC', name: 'Bitcoin', by_address: true, address_hint: 'bc1q… ou 1… / 3…' });
    assert.equal(settings.crypto_assets.find((a) => a.id === 'ADA').by_address, false);

    // Bitcoin suivi par adresse : 1,25 BTC × 60 000 € = 75 000 €, valorisé dès l'enregistrement.
    const created = await alice.post('/api/holdings', { name: 'Ledger BTC', category_id: cryptoCat, currency: 'EUR', liquidity: 'short', amount: '999', crypto: { asset: 'btc', mode: 'address', address: BTC_ADDR } });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.warning, null);
    const id = created.data.id;
    let detail = (await alice.get(`/api/holdings/${id}`)).data;
    assert.equal(detail.valuations.length, 1, 'le montant saisi est ignoré : la valeur est calculée');
    assert.equal(detail.valuations[0].amount_cents, 7_500_000);
    assert.equal(detail.valuations[0].note, 'Auto : 1,25 BTC × 60.000 EUR');
    assert.equal(detail.crypto.asset, 'BTC');
    assert.equal(detail.crypto.mode, 'address');
    assert.equal(detail.crypto.last_quantity, '1.25');
    assert.equal(detail.crypto.last_price, 60000);
    assert.equal(detail.crypto.explorer_url, `https://mempool.space/address/${BTC_ADDR}`);
    assert.equal(detail.crypto.source, 'mempool.space');
    assert.equal(detail.crypto.last_error, null);
    const gecko = net.calls.find((c) => c.host === 'api.coingecko.com');
    assert.match(gecko.url, /ids=bitcoin&vs_currencies=eur$/);
    assert.equal(gecko.headers['x-cg-demo-api-key'], 'cle-demo', 'clé CoinGecko facultative transmise');
    assert.ok(net.calls.every((c) => !JSON.stringify(c).includes('alice') && !JSON.stringify(c).includes('Ledger')), 'ni nom ni libellé envoyés');
    const listed = (await alice.get('/api/holdings')).data.holdings.find((h) => h.id === id);
    assert.equal(listed.crypto.asset, 'BTC');
    assert.equal(listed.crypto.last_quantity, '1.25');
    assert.equal(listed.value_cents, 7_500_000);
    // Jamais « à actualiser » : la valeur se calcule seule, même ancienne (lecture en échec).
    srv.app.db.prepare("UPDATE valuations SET valued_at = '2025-01-01' WHERE holding_id = ?").run(id);
    const dash = (await alice.get('/api/dashboard')).data;
    assert.ok(Array.isArray(dash.stale) && !dash.stale.some((s) => s.id === id));
    srv.app.db.prepare("UPDATE valuations SET valued_at = date('now', 'localtime') WHERE holding_id = ?").run(id);

    // Adresse au mauvais format, actif inconnu, passif : refusés avec un message clair.
    let bad = await alice.post('/api/holdings', { name: 'X', category_id: cryptoCat, currency: 'EUR', liquidity: 'short', crypto: { asset: 'BTC', mode: 'address', address: ETH_ADDR } });
    assert.equal(bad.status, 400);
    assert.match(bad.data.message, /Adresse Bitcoin invalide \(format attendu/);
    bad = await alice.post('/api/holdings', { name: 'X', category_id: cryptoCat, currency: 'EUR', liquidity: 'short', crypto: { asset: 'ADA', mode: 'address', address: 'addr1' } });
    assert.match(bad.data.message, /saisissez la quantité/);
    bad = await alice.post('/api/holdings', { name: 'X', category_id: cryptoCat, currency: 'EUR', liquidity: 'short', crypto: { asset: 'NOPE', mode: 'quantity', quantity: '1' } });
    assert.equal(bad.status, 400);
    bad = await alice.post('/api/holdings', { name: 'X', category_id: debtCat, currency: 'EUR', liquidity: 'short', crypto: { asset: 'BTC', mode: 'quantity', quantity: '1' } });
    assert.match(bad.data.message, /actif, pas un passif/);
    bad = await alice.post('/api/holdings', { name: 'X', category_id: cryptoCat, currency: 'EUR', liquidity: 'short', crypto: { asset: 'ADA', mode: 'quantity', quantity: '0' } });
    assert.match(bad.data.message, /Quantité : nombre positif/);

    // Ether par adresse (adresse en majuscules normalisée), USDC (jeton ERC-20) et Solana.
    const eth = await alice.post('/api/holdings', { name: 'ETH', category_id: cryptoCat, currency: 'EUR', liquidity: 'short', crypto: { asset: 'ETH', mode: 'address', address: ETH_ADDR } });
    assert.equal((await alice.get(`/api/holdings/${eth.data.id}`)).data.valuations[0].amount_cents, 450_000);
    assert.equal((await alice.get(`/api/holdings/${eth.data.id}`)).data.crypto.address, ETH_ADDR.toLowerCase());
    const usdc = await alice.post('/api/holdings', { name: 'USDC', category_id: cryptoCat, currency: 'EUR', liquidity: 'short', crypto: { asset: 'USDC', mode: 'address', address: ETH_ADDR } });
    assert.equal((await alice.get(`/api/holdings/${usdc.data.id}`)).data.valuations[0].amount_cents, 230_000, '2 500 USDC × 0,92 €');
    const call = net.calls.filter((c) => c.body?.method === 'eth_call').pop();
    assert.equal(call.body.params[0].to, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    assert.equal(call.body.params[0].data, '0x70a08231' + ETH_ADDR.slice(2).toLowerCase().padStart(64, '0'));
    const sol = await alice.post('/api/holdings', { name: 'Phantom', category_id: cryptoCat, currency: 'EUR', liquidity: 'short', crypto: { asset: 'SOL', mode: 'address', address: SOL_ADDR } });
    assert.equal((await alice.get(`/api/holdings/${sol.data.id}`)).data.valuations[0].amount_cents, 48_750, '3,25 SOL × 150 €');

    // Cardano en quantité saisie : 1 250,5 ADA × 0,40 € = 500,20 €.
    const ada = await alice.post('/api/holdings', { name: 'Cardano', category_id: cryptoCat, currency: 'EUR', liquidity: 'short', crypto: { asset: 'ADA', mode: 'quantity', quantity: '1.250,5' } });
    assert.equal(ada.status, 200, JSON.stringify(ada.data));
    detail = (await alice.get(`/api/holdings/${ada.data.id}`)).data;
    assert.equal(detail.crypto.quantity, '1250.5');
    assert.equal(detail.valuations[0].amount_cents, 50_020);
    assert.equal(detail.crypto.explorer_url, null);

    // Pas de saisie manuelle sur une valeur calculée.
    assert.equal((await alice.post(`/api/holdings/${id}/valuations`, { amount: '1', date: '2026-01-01' })).data.error, 'tracked');
    const bulk = await alice.post('/api/valuations/bulk', { date: '2026-01-01', items: [{ holding_id: id, amount: '1' }] });
    assert.equal(bulk.status, 400);
    assert.equal(bulk.data.error, 'tracked');

    // Le solde change : « Actualiser maintenant » remplace la valeur du jour (une seule par date).
    net.btc.spent = 50_000_000; // 1 BTC
    let r = await alice.post(`/api/holdings/${id}/crypto/refresh`);
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.equal(r.data.crypto.last_quantity, '1');
    detail = (await alice.get(`/api/holdings/${id}`)).data;
    assert.equal(detail.valuations.length, 1);
    assert.equal(detail.valuations[0].amount_cents, 6_000_000);

    // Explorateur indisponible : erreur conservée, dernière valeur gardée, avoir toujours affiché.
    net.down.add('mempool.space');
    r = await alice.post(`/api/holdings/${id}/crypto/refresh`);
    assert.equal(r.data.ok, false);
    assert.equal(r.data.error, 'mempool.space a répondu 503.');
    detail = (await alice.get(`/api/holdings/${id}`)).data;
    assert.equal(detail.valuations[0].amount_cents, 6_000_000);
    assert.equal(detail.crypto.last_error, 'mempool.space a répondu 503.');
    assert.ok(detail.crypto.last_checked_at >= detail.crypto.last_ok_at);
    assert.equal((await alice.get('/api/holdings')).data.holdings.find((h) => h.id === id).crypto.last_error, 'mempool.space a répondu 503.');
    net.down.delete('mempool.space');

    // Actualisation périodique (toutes les 6 heures) : une seule demande de cours pour tous les avoirs suivis.
    net.calls.length = 0;
    net.btc.spent = 0; // 1,5 BTC
    const all = await srv.app.crypto.refresh();
    assert.deepEqual(all, { updated: 5, errors: [] });
    assert.equal(net.calls.filter((c) => c.host === 'api.coingecko.com').length, 1);
    assert.match(net.calls.find((c) => c.host === 'api.coingecko.com').url, /ids=bitcoin%2Cethereum%2Cusd-coin%2Csolana%2Ccardano&vs_currencies=eur$/);
    assert.equal((await alice.get(`/api/holdings/${id}`)).data.crypto.last_error, null, 'erreur effacée au succès suivant');
    assert.equal((await alice.get(`/api/holdings/${id}`)).data.valuations[0].amount_cents, 9_000_000);

    // Pas de cours dans la devise de l'avoir : message explicite.
    const chf = await alice.post('/api/holdings', { name: 'Cardano CHF', category_id: cryptoCat, currency: 'CHF', liquidity: 'short', crypto: { asset: 'ADA', mode: 'quantity', quantity: '10' } });
    assert.equal(chf.data.warning, 'Pas de cours ADA en CHF sur CoinGecko.');

    // L'administrateur coupe les services externes : plus aucune requête, message clair.
    assert.equal((await alice.put('/api/admin/security', { crypto_lookups: false, current_password: PASSWORD })).status, 200);
    assert.equal((await alice.get('/api/admin/security')).data.crypto_lookups ?? (await alice.get('/api/settings')).data.crypto_lookups, false);
    net.calls.length = 0;
    r = await alice.post(`/api/holdings/${id}/crypto/refresh`);
    assert.equal(r.data.ok, false);
    assert.match(r.data.error, /désactivé par l'administrateur/);
    assert.equal(r.data.crypto.lookups_enabled, false);
    assert.equal(net.calls.length, 0);
    assert.equal((await alice.put('/api/admin/security', { crypto_lookups: true, current_password: PASSWORD })).status, 200);

    // Modifier le suivi : passer en valeur à la main garde l'historique et rouvre la saisie manuelle.
    const manual = await alice.patch(`/api/holdings/${id}`, { name: 'Ledger BTC', category_id: cryptoCat, currency: 'EUR', liquidity: 'short', crypto: { asset: 'BTC', mode: 'manual' } });
    assert.equal(manual.status, 200, JSON.stringify(manual.data));
    assert.equal((await alice.post(`/api/holdings/${id}/valuations`, { amount: '1.000', date: '2026-01-02' })).status, 200);
    assert.equal((await alice.post(`/api/holdings/${id}/crypto/refresh`)).data.error, 'not_tracked');
    detail = (await alice.get(`/api/holdings/${id}`)).data;
    assert.equal(detail.crypto.mode, 'manual');
    assert.ok(detail.valuations.some((v) => v.note.startsWith('Auto : ')), 'valeurs calculées conservées');
    // Retirer complètement le suivi.
    assert.equal((await alice.patch(`/api/holdings/${id}`, { name: 'Ledger BTC', category_id: cryptoCat, currency: 'EUR', liquidity: 'short', crypto: null })).status, 200);
    assert.equal((await alice.get(`/api/holdings/${id}`)).data.crypto, null);

    // Avoir clôturé : plus d'actualisation.
    assert.equal((await alice.post(`/api/holdings/${ada.data.id}/close`, {})).status, 200);
    assert.equal((await alice.post(`/api/holdings/${ada.data.id}/crypto/refresh`)).data.error, 'closed');
    assert.ok(!srv.app.crypto.rows().some((row) => row.holding_id === ada.data.id));

    // Export puis restauration : l'actif, le mode et l'adresse suivent l'avoir.
    const exp = (await alice.get('/api/export.json')).data;
    const exported = JSON.parse(Buffer.isBuffer(exp) ? exp.toString('utf8') : JSON.stringify(exp));
    assert.ok(exported.crypto_holdings.some((c) => c.asset === 'SOL' && c.mode === 'address' && c.address === SOL_ADDR));
    assert.ok(exported.crypto_holdings.every((c) => !('last_price' in c)), 'les lectures ne sont pas exportées');
    const imp = await alice.post('/api/import', exported);
    assert.equal(imp.status, 200, JSON.stringify(imp.data));
    const after = (await alice.get('/api/holdings')).data.holdings;
    const phantom = after.find((h) => h.name === 'Phantom');
    assert.equal(phantom.crypto.asset, 'SOL');
    assert.equal((await alice.get(`/api/holdings/${phantom.id}`)).data.crypto.address, SOL_ADDR);
    assert.equal(after.find((h) => h.name === 'Cardano').crypto.mode, 'quantity');
  } finally { await srv.stop(); }
});

test('crypto-actif : un autre compte ne peut ni lire l’adresse ni actualiser l’avoir', async () => {
  const net = fakeNetwork();
  const srv = await startServer({}, { fetcher: net.fetch });
  try {
    const alice = client(srv.base);
    await alice.post('/api/auth/setup', { username: 'alice', first_name: 'Alice', last_name: 'A', password: PASSWORD, base_currency: 'EUR' });
    const cat = (await alice.get('/api/categories')).data.categories.find((c) => c.icon === 'crypto').id;
    const h = await alice.post('/api/holdings', { name: 'BTC', category_id: cat, currency: 'EUR', liquidity: 'short', crypto: { asset: 'BTC', mode: 'address', address: BTC_ADDR } });
    assert.equal((await alice.post('/api/users', { username: 'bob', first_name: 'Bob', last_name: 'B', password: PASSWORD, role: 'editor' })).status, 200);
    const bob = client(srv.base);
    assert.equal((await bob.post('/api/auth/login', { username: 'bob', password: PASSWORD })).status, 200);
    assert.equal((await bob.get(`/api/holdings/${h.data.id}`)).status, 404);
    assert.equal((await bob.post(`/api/holdings/${h.data.id}/crypto/refresh`)).status, 404);
    assert.equal((await bob.get('/api/holdings')).data.holdings.length, 0);
  } finally { await srv.stop(); }
});

test('migration 1.3.0 : table des crypto-actifs ajoutée sans toucher aux avoirs, suppression en cascade', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-mig-'));
  const raw = new DatabaseSync(path.join(dir, 'vigie.sqlite'));
  raw.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (let i = 0; i < 20; i++) { raw.exec(MIGRATIONS[i]); raw.prepare('INSERT INTO schema_migrations VALUES (?, 0)').run(i + 1); }
  const u = raw.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('alex', 'Alex', 'x', 'admin', 0)").run();
  const c = raw.prepare("INSERT INTO categories (name, kind, icon, created_at, account_user_id) VALUES ('Crypto-actifs', 'asset', 'crypto', 0, ?)").run(Number(u.lastInsertRowid));
  raw.prepare("INSERT INTO holdings (category_id, name, currency, liquidity, created_at, updated_at, account_user_id) VALUES (?, 'Wallet', 'EUR', 'short', 0, 0, ?)").run(Number(c.lastInsertRowid), Number(u.lastInsertRowid));
  raw.close();
  const db = openDatabase(dir);
  const h = db.prepare("SELECT id FROM holdings WHERE name = 'Wallet'").get();
  assert.ok(h);
  db.prepare("INSERT INTO crypto_holdings (holding_id, asset, mode, address, updated_at) VALUES (?, 'BTC', 'address', ?, 0)").run(h.id, BTC_ADDR);
  assert.throws(() => db.prepare("INSERT INTO crypto_holdings (holding_id, asset, mode, updated_at) VALUES (?, 'ETH', 'magic', 0)").run(h.id), /CHECK|UNIQUE/);
  db.prepare('DELETE FROM holdings WHERE id = ?').run(h.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM crypto_holdings').get().n, 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
