// Estimation indicative de la valeur actuelle d'un bien immobilier.
// Les montants de l'achat et les avoirs ne sont jamais transmis au fournisseur.
// Une estimation est une proposition : l'utilisateur décide de l'enregistrer.
export const REAL_ESTATE_TYPES = ['maison', 'appartement'];
export const REAL_ESTATE_CONDITIONS = ['a_renover', 'travaux', 'correct', 'bon', 'renove', 'neuf'];

const ENDPOINT = 'https://georegistry.fr/api/v1/dvf/estimate';
const MAX_RESPONSE_BYTES = 80_000;

export function isRealEstateCategory(cat) {
  return Boolean(cat && cat.kind === 'asset' &&
    (['house', 'building'].includes(cat.icon) ||
    /immobilier|maison|appartement|immeuble|résidence/i.test(cat.name)));
}

export function latentGain(currentCents, purchaseCents) {
  if (!Number.isSafeInteger(currentCents) || !Number.isSafeInteger(purchaseCents) || purchaseCents <= 0) return null;
  const diff = currentCents - purchaseCents;
  return { gain_cents: diff, gain_pct: Math.round(diff / purchaseCents * 10000) / 100 };
}


export const ESTIMATION_NOTE_START = '[Estimation Vigie]';
export const ESTIMATION_NOTE_END = '[/Estimation Vigie]';

export function buildEstimateNote(result, params) {
  const euro = (cents) => Math.round(cents / 100).toLocaleString('fr-FR') + ' €';
  const n = (value) => Number(value).toLocaleString('fr-FR');
  const method = result.method;
  const type = params.type_local === 1 ? 'maisons' : 'appartements';
  const confidence = { high: 'élevée', medium: 'moyenne', low: 'faible' }[result.confidence] || 'non précisée';
  const lines = [
    ESTIMATION_NOTE_START,
    result.as_of + ' | ' + euro(result.estimate_cents) +
      ' | fourchette ' + euro(result.low_cents) + ' à ' + euro(result.high_cents) +
      ' | fiabilité ' + confidence + '.',
    'Source : DVF (DGFiP) via GeoRegistry ; fournisseur unique, pas de recoupement indépendant.',
  ];
  if (method === 'dvf_local_price_m2' || method === 'dvf_median_nearby') {
    const local = method === 'dvf_local_price_m2';
    lines.push('Méthode : médiane de ' + result.comparables + ' ventes de ' + type +
      ' à ' + n(result.radius_m / 1000) + ' km max. ' +
      (local ? 'Prix local au m² sans exigence de surface équivalente' : 'Surfaces retenues : 55 à 180 % de celle du bien') +
      ' ; ' + n(result.price_per_m2) + ' €/m² × ' + n(params.surface_bati) + ' m².');
    if (result.sale_first && result.sale_last)
      lines.push('Ventes retenues : ' + result.sale_first + ' à ' + result.sale_last +
        ', surfaces ' + n(result.sale_surface_min) + ' à ' + n(result.sale_surface_max) + ' m² ; prix retenus ' +
        n(result.sale_price_m2_min) + ' à ' + n(result.sale_price_m2_max) + ' €/m².');
    lines.push('Limites : fourchette de précaution ±' +
      (local ? '35' : result.comparables < 7 ? '20' : '15') +
      ' % fixée par Vigie (pas un intervalle statistique). Ventes anciennes ou atypiques, doublons et prix/m² invalides exclus.');
    lines.push(local
      ? 'Incertitude forte : tailles des ventes parfois très différentes ; terrain, DPE, état intérieur et travaux non corrigés.'
      : 'Terrain, DPE, état intérieur et travaux non corrigés ; la proximité ne garantit pas l’équivalence.');
  } else {
    lines.push('Méthode : estimation du fournisseur sur ' + result.comparables +
      ' ventes comparables ; adresse, type, ' + n(params.surface_bati) + ' m² et état transmis.');
    lines.push('Limites : rayon, dates des ventes, filtres, coefficients et méthode de fourchette non détaillés par le fournisseur. Terrain, DPE et travaux non vérifiés.');
  }
  lines.push('Valeur indicative, non expertise immobilière ; prix d’achat et fiscalité non inclus.',
    ESTIMATION_NOTE_END);
  return lines.join('\n');
}

export class EstimateError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function validateEstimateInput(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new EstimateError(400, 'Renseignez les caractéristiques du bien.');
  if (!REAL_ESTATE_TYPES.includes(p.property_type)) throw new EstimateError(400, 'Type de bien invalide.');
  if (typeof p.address !== 'string' || p.address.trim().length < 5 || p.address.trim().length > 180) {
    throw new EstimateError(400, 'Indiquez une adresse ou une commune suffisamment précise.');
  }
  const surface = Number(p.surface_m2);
  if (!Number.isInteger(surface) || surface < 9 || surface > 10000) throw new EstimateError(400, 'Surface habitable invalide (9 à 10 000 m²).');
  const condition = p.condition || 'correct';
  if (!REAL_ESTATE_CONDITIONS.includes(condition)) throw new EstimateError(400, 'État général invalide.');
  return { type_local: p.property_type === 'maison' ? 1 : 2, surface_bati: surface, adresse: p.address.trim(), etat: condition };
}

export class RealEstateEstimator {
  constructor({ fetcher = globalThis.fetch, log = console } = {}) {
    this.fetcher = fetcher;
    this.log = log;
    this.cache = new Map();
    this.pending = new Map();
  }

  async estimate(input) {
    const params = validateEstimateInput(input);
    const key = JSON.stringify(params);
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    if (this.pending.has(key)) return this.pending.get(key);
    const p = this.resolve(params).then((result) => {
      result.estimation_note = buildEstimateNote(result, params);
      if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, { value: result, until: Date.now() + 15 * 60_000 });
      return result;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  // Utiliser des mutations réelles auprès du même fournisseur quand le calcul
  // principal est inexploitable. Ce n'est PAS une source indépendante.
  // Les ventes utilisées pour les deux niveaux de secours restent issues de DVF,
  // du même fournisseur. Jamais de moyenne mêlant maisons et appartements.
  async getComparableSales(params, initialError) {
    const surface = params.surface_bati;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const after = new Date(Date.UTC(now.getUTCFullYear() - 5, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
    const median = (values) => values.length % 2
      ? values[(values.length - 1) / 2]
      : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
    const trimOutliers = (values) => {
      if (!values.length) return [];
      const sorted = values.slice().sort((a, b) => a - b);
      const mid = median(sorted);
      return sorted.filter((price) => price >= mid * 0.6 && price <= mid * 1.6);
    };
    // Une médiane locale au m² sur des biens de tailles différentes est moins
    // probante qu'un comparable direct, même si elle utilise plus de ventes.
    const makeResult = (prices, radius, areaPriceOnly, records) => {
      const eurosPerM2 = median(prices);
      const estimate = Math.round(eurosPerM2 * surface);
      const variance = areaPriceOnly ? 0.35 : prices.length < 7 ? 0.20 : 0.15;
      return {
        estimate_cents: estimate * 100,
        low_cents: Math.round(estimate * (1 - variance)) * 100,
        high_cents: Math.round(estimate * (1 + variance)) * 100,
        price_per_m2: Math.round(eurosPerM2),
        comparables: prices.length,
        confidence: areaPriceOnly ? 'low' : prices.length >= 10 && radius <= 1500 ? 'medium' : 'low',
        source: 'GeoRegistry / DVF (DGFiP), médiane des ventes de ' + (params.type_local === 1 ? 'maisons' : 'appartements'),
        source_url: 'https://georegistry.fr/docs/api',
        method: areaPriceOnly ? 'dvf_local_price_m2' : 'dvf_median_nearby',
        radius_m: radius,
        sale_first: records.map((r) => r.date).sort()[0],
        sale_last: records.map((r) => r.date).sort().at(-1),
        sale_surface_min: Math.min(...records.map((r) => r.size)),
        sale_surface_max: Math.max(...records.map((r) => r.size)),
        sale_price_m2_min: Math.round(Math.min(...prices)),
        sale_price_m2_max: Math.round(Math.max(...prices)),
        as_of: today,
        disclaimer: areaPriceOnly
          ? 'Prix médian au m² des ventes locales du même type, appliqué à la surface du bien. Les surfaces des ventes peuvent différer fortement. Estimation très approximative, hors terrain, travaux, frais et fiscalité.'
          : 'Estimation indicative par ventes proches de surface comparable, non expertise ni seconde source indépendante.',
      };
    };

    let lastCount = 0;
    let lastRadius = 0;
    let localPriceFallback = null;
    for (const radius of [1500, 5000]) {
      lastRadius = radius;
      const search = new URLSearchParams({
        adresse: params.adresse, type_local: String(params.type_local),
        radius: String(radius), limit: '100',
      });
      let response;
      try {
        response = await this.fetcher('https://georegistry.fr/api/v1/dvf/ventes/address?' + search, {
          method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8500),
          headers: { accept: 'application/json', 'User-Agent': 'Vigie-Patrimoine/real-estate-estimation' },
        });
      } catch { break; }
      if (!response.ok) break;
      let payload;
      try {
        if (Number(response.headers?.get('content-length') || 0) > MAX_RESPONSE_BYTES) break;
        const raw = await response.text();
        if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) break;
        payload = JSON.parse(raw);
      } catch { break; }
      // Si la BAN ne reconnaît pas l'adresse, il ne faut pas se rabattre
      // silencieusement sur un autre quartier ou une autre commune.
      if (payload?.meta?.address === null) break;
      if (!Array.isArray(payload?.data)) break;

      const seen = new Set();
      const sales = [];
      for (const row of payload.data) {
        if (!row || typeof row !== 'object') continue;
        const type = String(row.type_local ?? '').trim().toLowerCase();
        const expected = params.type_local === 1 ? 'maison' : 'appartement';
        if (type !== String(params.type_local) && type !== expected) continue;
        const date = String(row.mutation_date || row.date_mutation || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < after || date > today) continue;
        const nature = String(row.nature || row.nature_mutation || '').trim().toLowerCase();
        if (nature && nature !== 'vente') continue;
        const size = Number(row.surface_bati);
        // GeoRegistry ne fournit prix_m2 que pour les ventes à lot unique :
        // reconstruire valeur_fonciere/surface_bati sur un multi-lot tromperait.
        const unitPrice = Number(row.prix_m2);
        const distance = row.distance_m === undefined || row.distance_m === null
          ? null : Number(row.distance_m);
        if (!Number.isFinite(size) || size < 25 || size > 600 ||
            !Number.isFinite(unitPrice) || unitPrice < 400 || unitPrice > 30000 ||
            (distance !== null && (!Number.isFinite(distance) || distance > radius))) continue;
        const mutation = String(row.id_mutation || row.mutation_id || '').trim();
        const id = mutation
          ? 'mutation:' + mutation
          : 'sale:' + date + '|' + size + '|' + unitPrice + '|' + String(row.adresse || '');
        if (seen.has(id)) continue;
        seen.add(id);
        sales.push({ size, price: unitPrice, date });
      }

      // Niveau 2 : ventes de maisons/appartements de surface voisine.
      const comparable = trimOutliers(sales
        .filter((sale) => sale.size >= surface * 0.55 && sale.size <= surface * 1.8)
        .map((sale) => sale.price));
      lastCount = Math.max(lastCount, comparable.length);
      if (comparable.length >= 3) return makeResult(comparable, radius, false,
        sales.filter((sale) => sale.size >= surface * 0.55 && sale.size <= surface * 1.8 && comparable.includes(sale.price)));

      // Niveau 3 : prix local au m², même type de bien, sans imposer une
      // surface équivalente. Conserver le rayon le plus proche disponible.
      const localPrices = trimOutliers(sales.map((sale) => sale.price));
      if (!localPriceFallback && localPrices.length >= 3)
        localPriceFallback = makeResult(localPrices, radius, true,
          sales.filter((sale) => localPrices.includes(sale.price)));
    }
    if (localPriceFallback) return localPriceFallback;
    throw new EstimateError(422, lastCount > 0
      ? 'Estimation indisponible : ' + lastCount + ' vente(s) comparable(s) de surface voisine retenue(s), et moins de 3 ventes locales fiables du même type à ' + (lastRadius / 1000) + ' km. Valeur actuelle inchangée.'
      : initialError + ' Moins de 3 ventes locales fiables du même type ont été trouvées. Vérifiez l’adresse et la surface ou saisissez une valeur manuelle.');
  }

  async resolve(params) {
    let response;
    try {
      response = await this.fetcher(ENDPOINT, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { 'content-type': 'application/json', accept: 'application/json', 'User-Agent': 'Vigie-Patrimoine/real-estate-estimation' },
        body: JSON.stringify(params),
      });
    } catch {
      throw new EstimateError(503, "Source immobilière inaccessible. Aucune valeur n'a été modifiée.");
    }
    if (!response.ok) {
      const msg = response.status === 429 ? 'Source temporairement limitée : réessayez plus tard.'
        : response.status === 422 ? 'Le fournisseur n’a pas pu estimer ce bien.'
        : 'Estimation indisponible pour ce secteur.';
      if (response.status === 422) return this.getComparableSales(params, msg);
      throw new EstimateError(503, msg);
    }
    if (Number(response.headers?.get('content-length') || 0) > MAX_RESPONSE_BYTES)
      throw new EstimateError(502, 'Réponse immobilière trop volumineuse.');
    let payload;
    try {
      const raw = await response.text();
      if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw Error('too large');
      payload = JSON.parse(raw);
    } catch { throw new EstimateError(502, 'Réponse immobilière invalide.'); }

    const result = payload?.data;
    const estimate = Number(result?.estimate);
    const low = Number(result?.range?.low);
    const high = Number(result?.range?.high);
    const samples = Number(result?.comparables_count);
    if (!Number.isInteger(samples) || samples < 3)
      return this.getComparableSales(params, Number.isInteger(samples) && samples >= 0
        ? 'Le moteur principal a retenu ' + samples + ' vente(s) comparable(s).'
        : 'Le moteur principal n’a pas fourni le nombre de ventes comparables.');
    if (![estimate, low, high].every(Number.isFinite) ||
      estimate < 10000 || estimate > 100_000_000 || low <= 0 || low > estimate || high < estimate ||
      high > estimate * 4)
      return this.getComparableSales(params, 'Le moteur principal a renvoyé une fourchette de prix inexploitable.');
    return {
      estimate_cents: Math.round(estimate * 100),
      low_cents: Math.round(low * 100),
      high_cents: Math.round(high * 100),
      comparables: samples,
      confidence: ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : 'low',
      source: 'GeoRegistry / DVF (DGFiP)',
      source_url: 'https://georegistry.fr/docs/api',
      method: 'georegistry_estimate',
      as_of: new Date().toISOString().slice(0, 10),
      disclaimer: "Estimation indicative sur ventes comparables, non expertise. Valeur d'achat et frais non inclus.",
    };
  }
}
