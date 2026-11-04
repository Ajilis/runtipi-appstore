// Crypto-actifs (1.3.0) : quantité lue sur la blockchain à partir d'une adresse publique (ou saisie à la main),
// valorisée au cours du jour (CoinGecko). Une valeur est enregistrée chaque jour dans l'historique de l'avoir.
// Seuls l'adresse et le nom de l'actif sont transmis aux services publics ; jamais un montant ni un nom de personne.
import { formatNumber } from './format.js';
import { sniffImage } from './logos.js';
import { todayIso } from './portfolio.js';

// chain : réseau interrogé pour lire le solde d'une adresse ; sans chain, la quantité se saisit à la main.
export const CRYPTO_ASSETS = [
  { id: 'BTC', name: 'Bitcoin', coingecko: 'bitcoin', decimals: 8, chain: 'bitcoin' },
  { id: 'ETH', name: 'Ether (Ethereum)', coingecko: 'ethereum', decimals: 18, chain: 'ethereum' },
  { id: 'USDC', name: 'USD Coin (réseau Ethereum)', coingecko: 'usd-coin', decimals: 6, chain: 'erc20', contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
  { id: 'USDT', name: 'Tether USD (réseau Ethereum)', coingecko: 'tether', decimals: 6, chain: 'erc20', contract: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
  { id: 'SOL', name: 'Solana', coingecko: 'solana', decimals: 9, chain: 'solana' },
  { id: 'LTC', name: 'Litecoin', coingecko: 'litecoin', decimals: 8, chain: 'litecoin' },
  { id: 'DOGE', name: 'Dogecoin', coingecko: 'dogecoin', decimals: 8, chain: 'dogecoin' },
  { id: 'XRP', name: 'XRP', coingecko: 'ripple', decimals: 6, chain: 'xrpl' },
  { id: 'BNB', name: 'BNB', coingecko: 'binancecoin' },
  { id: 'ADA', name: 'Cardano', coingecko: 'cardano' },
  { id: 'DOT', name: 'Polkadot', coingecko: 'polkadot' },
  { id: 'AVAX', name: 'Avalanche', coingecko: 'avalanche-2' },
  { id: 'TRX', name: 'TRON', coingecko: 'tron' },
  { id: 'LINK', name: 'Chainlink', coingecko: 'chainlink' },
  { id: 'XLM', name: 'Stellar', coingecko: 'stellar' },
  { id: 'ATOM', name: 'Cosmos', coingecko: 'cosmos' },
  { id: 'XMR', name: 'Monero', coingecko: 'monero' },
];
export const ASSET_BY_ID = new Map(CRYPTO_ASSETS.map((a) => [a.id, a]));

const B58 = '[1-9A-HJ-NP-Za-km-z]';
const BECH32 = '[02-9ac-hj-np-z]';
const ADDRESS = {
  bitcoin: new RegExp(`^(bc1${BECH32}{11,87}|[13]${B58}{25,34})$`),
  litecoin: new RegExp(`^(ltc1${BECH32}{11,87}|[LM3]${B58}{25,34})$`),
  ethereum: /^0x[0-9a-fA-F]{40}$/,
  erc20: /^0x[0-9a-fA-F]{40}$/,
  solana: new RegExp(`^${B58}{32,44}$`),
  dogecoin: new RegExp(`^[DA9]${B58}{25,34}$`),
  xrpl: new RegExp(`^r${B58}{24,34}$`),
};
export const ADDRESS_EXAMPLE = {
  bitcoin: 'bc1q… ou 1… / 3…', litecoin: 'ltc1… ou L… / M…', ethereum: '0x suivi de 40 caractères', erc20: '0x suivi de 40 caractères',
  solana: '32 à 44 caractères', dogecoin: 'D…', xrpl: 'r…',
};
export const EXPLORER = {
  bitcoin: (a) => `https://mempool.space/address/${a}`,
  litecoin: (a) => `https://litecoinspace.org/address/${a}`,
  ethereum: (a) => `https://etherscan.io/address/${a}`,
  erc20: (a) => `https://etherscan.io/address/${a}`,
  solana: (a) => `https://explorer.solana.com/address/${a}`,
  dogecoin: (a) => `https://blockchair.com/dogecoin/address/${a}`,
  xrpl: (a) => `https://livenet.xrpl.org/accounts/${a}`,
};
const SOURCE = {
  bitcoin: 'mempool.space', litecoin: 'litecoinspace.org', ethereum: 'PublicNode (Ethereum)', erc20: 'PublicNode (Ethereum)',
  solana: 'Solana (RPC public)', dogecoin: 'BlockCypher', xrpl: 'XRPL Cluster',
};

export class CryptoError extends Error {}

// Adresse normalisée, ou exception avec un exemple du format attendu.
export function checkAddress(asset, address) {
  const a = ASSET_BY_ID.get(asset);
  if (!a || !a.chain) throw new CryptoError('Suivi par adresse indisponible pour cet actif : saisissez la quantité.');
  const v = String(address || '').trim();
  if (!ADDRESS[a.chain].test(v)) throw new CryptoError(`Adresse ${a.name} invalide (format attendu : ${ADDRESS_EXAMPLE[a.chain]}).`);
  return a.chain === 'ethereum' || a.chain === 'erc20' ? v.toLowerCase() : v;
}

// Quantité saisie (« 0,5 », « 1.234,56 », « 12500 ») en chaîne décimale « 1234.56 », ou null.
export function parseQuantity(raw) {
  let t = String(raw ?? '').replace(/[\s  ]/g, '');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // « 1.250 » = 1250 (point des milliers), « 0.012 » reste décimal
  else t = t.replace(',', '.');
  if (!/^\d+(\.\d{1,18})?$/.test(t) || t.length > 40 || !/[1-9]/.test(t)) return null; // zéro refusé
  return t.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

// Unités entières (BigInt) en quantité décimale exacte.
export function unitsToQuantity(units, decimals) {
  const neg = units < 0n;
  const s = (neg ? -units : units).toString().padStart(decimals + 1, '0');
  const int = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
}

export const quantityText = (q, asset) => `${formatNumber(Number(q), { max: 8 })} ${asset}`;

export class CryptoService {
  constructor(db, { fetcher = globalThis.fetch, log = null, enabled = () => true, apiKey = () => '' } = {}) {
    this.db = db;
    this.fetcher = fetcher;
    this.log = log;
    this.enabled = enabled;
    this.apiKey = apiKey;
    this.timeoutMs = 12_000;
  }

  async json(url, options = {}, label = new URL(url).hostname) {
    let res;
    try {
      res = await this.fetcher(url, { ...options, signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: 'application/json', 'user-agent': 'Vigie-Patrimoine', ...(options.headers || {}) } });
    } catch (err) {
      throw new CryptoError(`${label} injoignable (${err.name === 'TimeoutError' ? 'délai dépassé' : 'réseau'}).`);
    }
    if (res.status === 429) throw new CryptoError(`${label} limite les demandes : nouvel essai plus tard.`);
    if (!res.ok) throw new CryptoError(`${label} a répondu ${res.status}.`);
    try { return await res.json(); } catch { throw new CryptoError(`Réponse de ${label} illisible.`); }
  }

  rpc(url, method, params, label) {
    return this.json(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, label);
  }

  // Solde d'une adresse, en quantité décimale de l'actif.
  async balance(assetId, address) {
    const a = ASSET_BY_ID.get(assetId);
    const label = SOURCE[a.chain];
    const units = (v) => { try { return BigInt(v); } catch { throw new CryptoError(`Solde illisible renvoyé par ${label}.`); } };
    switch (a.chain) {
      case 'bitcoin':
      case 'litecoin': {
        const host = a.chain === 'bitcoin' ? 'https://mempool.space' : 'https://litecoinspace.org';
        const r = await this.json(`${host}/api/address/${encodeURIComponent(address)}`, {}, label);
        const c = r && r.chain_stats;
        if (!c) throw new CryptoError(`Solde illisible renvoyé par ${label}.`);
        return unitsToQuantity(units(c.funded_txo_sum) - units(c.spent_txo_sum), a.decimals);
      }
      case 'ethereum': {
        const r = await this.rpc('https://ethereum-rpc.publicnode.com', 'eth_getBalance', [address, 'latest'], label);
        if (!r || typeof r.result !== 'string') throw new CryptoError(r?.error?.message ? `${label} : ${r.error.message}` : `Solde illisible renvoyé par ${label}.`);
        return unitsToQuantity(units(r.result), a.decimals);
      }
      case 'erc20': {
        const data = '0x70a08231' + address.slice(2).padStart(64, '0');
        const r = await this.rpc('https://ethereum-rpc.publicnode.com', 'eth_call', [{ to: a.contract, data }, 'latest'], label);
        if (!r || typeof r.result !== 'string') throw new CryptoError(r?.error?.message ? `${label} : ${r.error.message}` : `Solde illisible renvoyé par ${label}.`);
        return unitsToQuantity(r.result === '0x' ? 0n : units(r.result), a.decimals);
      }
      case 'solana': {
        const r = await this.rpc('https://api.mainnet-beta.solana.com', 'getBalance', [address], label);
        if (!r || !r.result || r.result.value === undefined) throw new CryptoError(r?.error?.message ? `${label} : ${r.error.message}` : `Solde illisible renvoyé par ${label}.`);
        return unitsToQuantity(units(r.result.value), a.decimals);
      }
      case 'dogecoin': {
        const r = await this.json(`https://api.blockcypher.com/v1/doge/main/addrs/${encodeURIComponent(address)}/balance`, {}, label);
        if (!r || r.final_balance === undefined) throw new CryptoError(`Solde illisible renvoyé par ${label}.`);
        return unitsToQuantity(units(r.final_balance), a.decimals);
      }
      case 'xrpl': {
        const r = await this.json('https://xrplcluster.com/', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'account_info', params: [{ account: address, ledger_index: 'validated' }] }) }, label);
        const res = r && r.result;
        if (res && res.error === 'actNotFound') return '0'; // compte jamais approvisionné
        if (!res || !res.account_data) throw new CryptoError(res?.error_message ? `${label} : ${res.error_message}` : `Solde illisible renvoyé par ${label}.`);
        return unitsToQuantity(units(res.account_data.Balance), a.decimals);
      }
      default: throw new CryptoError('Suivi par adresse indisponible pour cet actif.');
    }
  }

  // Cours en devise(s) : { 'bitcoin:eur': 61234.5, … } en une seule demande.
  async prices(coingeckoIds, currencies) {
    const ids = [...new Set(coingeckoIds)].join(',');
    const vs = [...new Set(currencies.map((c) => c.toLowerCase()))].join(',');
    const key = String(this.apiKey() || '').trim();
    const r = await this.json(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(vs)}`,
      key ? { headers: { 'x-cg-demo-api-key': key } } : {}, 'CoinGecko');
    const out = {};
    for (const [id, byCur] of Object.entries(r || {})) for (const [cur, v] of Object.entries(byCur || {})) if (typeof v === 'number' && v >= 0) out[`${id}:${cur}`] = v;
    return out;
  }

  rows(holdingId = null) {
    return this.db.prepare(`SELECT c.*, h.currency, h.account_user_id, h.name AS holding_name FROM crypto_holdings c
      JOIN holdings h ON h.id = c.holding_id WHERE h.closed_at IS NULL AND c.mode <> 'manual' ${holdingId ? 'AND c.holding_id = ?' : ''}`)
      .all(...(holdingId ? [holdingId] : []));
  }

  // Lit les soldes et les cours, puis enregistre la valeur du jour de chaque avoir suivi.
  // Renvoie { updated, errors: [{ holding_id, message }] } ; une erreur garde la dernière valeur connue.
  async refresh({ holdingId = null } = {}) {
    const list = this.rows(holdingId);
    const result = { updated: 0, errors: [] };
    if (!list.length) return result;
    if (!this.enabled()) {
      for (const row of list) result.errors.push({ holding_id: row.holding_id, message: "Suivi automatique des crypto-actifs désactivé par l'administrateur." });
      return result;
    }
    const now = Date.now();
    const setError = (row, message) => {
      this.db.prepare('UPDATE crypto_holdings SET last_error = ?, last_checked_at = ? WHERE holding_id = ?').run(message, now, row.holding_id);
      result.errors.push({ holding_id: row.holding_id, message });
    };
    let prices = {};
    try {
      prices = await this.prices(list.map((r) => ASSET_BY_ID.get(r.asset)?.coingecko).filter(Boolean), list.map((r) => r.currency));
    } catch (err) {
      for (const row of list) setError(row, err instanceof CryptoError ? `Cours indisponible : ${err.message}` : 'Cours indisponible.');
      return result;
    }
    for (const row of list) {
      const a = ASSET_BY_ID.get(row.asset);
      if (!a) { setError(row, 'Actif inconnu.'); continue; }
      const price = prices[`${a.coingecko}:${row.currency.toLowerCase()}`];
      if (price === undefined) { setError(row, `Pas de cours ${a.id} en ${row.currency} sur CoinGecko.`); continue; }
      let quantity;
      try { quantity = row.mode === 'address' ? await this.balance(a.id, row.address) : row.quantity; }
      catch (err) { setError(row, err instanceof CryptoError ? err.message : 'Solde indisponible.'); continue; }
      const cents = Math.round(Number(quantity) * price * 100);
      if (!Number.isSafeInteger(cents)) { setError(row, 'Valeur hors limites.'); continue; }
      const note = `Auto : ${quantityText(quantity, a.id)} × ${formatNumber(price, { max: price < 1 ? 6 : 2 })} ${row.currency}`;
      this.db.prepare(`INSERT INTO valuations (holding_id, valued_at, amount_cents, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(holding_id, valued_at) DO UPDATE SET amount_cents = excluded.amount_cents, note = excluded.note, created_at = excluded.created_at`)
        .run(row.holding_id, todayIso(), cents, note.slice(0, 120), row.account_user_id, now);
      this.db.prepare(`UPDATE crypto_holdings SET last_quantity = ?, last_price = ?, last_checked_at = ?, last_ok_at = ?, last_error = NULL
        WHERE holding_id = ?`).run(quantity, price, now, now, row.holding_id);
      result.updated += 1;
    }
    return result;
  }

  // Actualisation peu après le démarrage puis toutes les 6 heures.
  // --- Logos des crypto-actifs (1.6.0) ---------------------------------------------------------------------
  // Image de chaque actif fournie par CoinGecko (champ « image » de /coins/markets), téléchargée une fois puis
  // servie par Vigie : le navigateur ne contacte aucun service extérieur. Nouvel essai après 30 jours, ou 3 jours
  // en cas d'échec. Seuls les noms d'actifs sont transmis.
  logoRow(assetId) { return this.db.prepare('SELECT * FROM crypto_logos WHERE asset = ?').get(assetId) || null; }
  logoVersions() {
    return Object.fromEntries(this.db.prepare('SELECT asset, fetched_at FROM crypto_logos WHERE ok = 1').all().map((r) => [r.asset, r.fetched_at]));
  }
  logoStale(row, now = Date.now()) { return !row || now - row.fetched_at > (row.ok ? LOGO_OK_TTL_MS : LOGO_FAIL_TTL_MS); }
  async downloadImage(url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== 'https:' || !LOGO_HOSTS.includes(u.hostname)) return null;
    const res = await this.fetcher(u.href, { redirect: 'follow', signal: AbortSignal.timeout(this.timeoutMs), headers: { accept: 'image/png,image/*;q=0.8', 'user-agent': 'Vigie-Patrimoine' } });
    if (!res.ok || (res.url && !LOGO_HOSTS.includes(new URL(res.url).hostname))) return null;
    if (Number(res.headers?.get?.('content-length') || 0) > LOGO_MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const type = buf.length >= 64 && buf.length <= LOGO_MAX_BYTES ? sniffImage(buf) : null;
    return type && type !== 'image/svg+xml' ? { type, data: buf, source: u.hostname } : null;
  }
  // Récupère d'un coup les logos manquants ou périmés des actifs demandés (une seule demande à CoinGecko).
  fetchLogos(assetIds) {
    if (this.logoPending) return this.logoPending.then(() => this.fetchLogos(assetIds));
    const want = [...new Set(assetIds)].map((id) => ASSET_BY_ID.get(id)).filter((a) => a && this.logoStale(this.logoRow(a.id)));
    if (!want.length || !this.enabled()) return Promise.resolve(0);
    this.logoPending = (async () => {
      const now = Date.now();
      const save = (asset, img) => this.db.prepare(`INSERT INTO crypto_logos (asset, content_type, data, ok, fetched_at, source) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset) DO UPDATE SET content_type = COALESCE(excluded.content_type, content_type), data = COALESCE(excluded.data, data),
        ok = MAX(excluded.ok, ok), fetched_at = excluded.fetched_at, source = COALESCE(excluded.source, source)`)
        .run(asset, img?.type || null, img?.data || null, img ? 1 : 0, now, img?.source || null);
      let list = [];
      try {
        const key = String(this.apiKey() || '').trim();
        list = await this.json(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(want.map((a) => a.coingecko).join(','))}&per_page=250&page=1`,
          key ? { headers: { 'x-cg-demo-api-key': key } } : {}, 'CoinGecko');
      } catch (err) {
        this.log?.debug?.('Logos crypto : ' + err.message);
        for (const a of want) save(a.id, null);
        return 0;
      }
      const imageOf = new Map((Array.isArray(list) ? list : []).map((c) => [c?.id, c?.image]));
      let found = 0;
      for (const a of want) {
        const img = await this.downloadImage(imageOf.get(a.coingecko)).catch(() => null);
        save(a.id, img);
        if (img) found += 1;
      }
      return found;
    })().finally(() => { this.logoPending = null; });
    return this.logoPending;
  }
  // Logo d'un actif pour l'interface : récupéré à la première demande. undefined : actif inconnu.
  async logo(assetId) {
    const a = ASSET_BY_ID.get(String(assetId || '').toUpperCase());
    if (!a) return undefined;
    // Les autres actifs suivis profitent de la même demande à CoinGecko.
    const inUse = this.db.prepare('SELECT DISTINCT asset FROM crypto_holdings').all().map((r) => r.asset);
    if (this.logoStale(this.logoRow(a.id))) await this.fetchLogos([a.id, ...inUse]).catch(() => 0);
    const row = this.logoRow(a.id);
    return row && row.data ? { type: row.content_type, data: row.data, fetched_at: row.fetched_at } : null;
  }

  startScheduler() {
    const run = () => this.refresh().then((r) => { if (r.errors.length && this.log) this.log.warn(`Crypto-actifs : ${r.errors.length} erreur(s)`); })
      .catch((err) => this.log && this.log.warn('Crypto-actifs : ' + err.message));
    const logos = () => this.fetchLogos(this.db.prepare('SELECT DISTINCT asset FROM crypto_holdings').all().map((r) => r.asset)).catch(() => 0);
    const first = setTimeout(() => { run(); setTimeout(logos, 15_000).unref?.(); }, 30_000);
    const every = setInterval(() => { run(); logos(); }, 6 * 3600_000);
    first.unref?.(); every.unref?.();
    return [first, every];
  }
}

const LOGO_HOSTS = ['coin-images.coingecko.com', 'assets.coingecko.com'];
const LOGO_MAX_BYTES = 256 * 1024;
const LOGO_OK_TTL_MS = 30 * 86400_000;
const LOGO_FAIL_TTL_MS = 3 * 86400_000;

// Vue publique d'un suivi crypto pour l'interface.
export function cryptoView(row, { enabled = true } = {}) {
  if (!row) return null;
  const a = ASSET_BY_ID.get(row.asset) || { id: row.asset, name: row.asset };
  return {
    asset: a.id, name: a.name, mode: row.mode, address: row.address || null, quantity: row.quantity || null,
    last_quantity: row.last_quantity ?? null, last_price: row.last_price ?? null, last_checked_at: row.last_checked_at ?? null,
    last_ok_at: row.last_ok_at ?? null, last_error: row.last_error ?? null,
    explorer_url: row.mode === 'address' && a.chain && row.address ? EXPLORER[a.chain](row.address) : null,
    source: row.mode === 'address' && a.chain ? SOURCE[a.chain] : null, lookups_enabled: enabled,
  };
}
