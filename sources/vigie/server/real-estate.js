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
      if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, { value: result, until: Date.now() + 15 * 60_000 });
      return result;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  // Utiliser des mutations réelles auprès du même fournisseur quand le calcul
  // principal est inexploitable. Ce n'est PAS une source indépendante.
  async getComparableSales(params, initialError) {
    const surface = params.surface_bati;
    let lastCount = 0;
    let lastRadius = 0;
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
      if (payload?.meta?.address === null) break;
      if (!Array.isArray(payload?.data)) break;
      const today = new Date();
      const after = new Date(Date.UTC(today.getUTCFullYear() - 5, today.getUTCMonth(), today.getUTCDate())).toISOString().slice(0, 10);
      const seen = new Set();
      const prices = [];
      for (const row of payload.data) {
        if (!row || typeof row !== 'object') continue;
        const type = String(row.type_local ?? '').toLowerCase();
        if (type && type !== String(params.type_local) &&
            !(params.type_local === 1 && type === 'maison') &&
            !(params.type_local === 2 && type === 'appartement')) continue;
        const date = String(row.mutation_date || row.date_mutation || '');
        if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < after)) continue;
        const nature = String(row.nature || row.nature_mutation || '');
        if (nature && nature.toLowerCase() !== 'vente') continue;
        const size = Number(row.surface_bati);
        const price = Number(row.prix_m2) || Number(row.valeur_fonciere) / size;
        const distance = Number(row.distance_m);
        if (!Number.isFinite(size) || size < surface * 0.55 || size > surface * 1.8 ||
            !Number.isFinite(price) || price < 400 || price > 30000 ||
            (Number.isFinite(distance) && distance > radius)) continue;
        const id = String(row.id_mutation || row.mutation_id || '') + '|' + date + '|' + size + '|' + Number(row.valeur_fonciere || 0);
        if (seen.has(id)) continue;
        seen.add(id);
        prices.push(price);
      }
      prices.sort((a, b) => a - b);
      const median = (a) => a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
      const center = prices.length ? median(prices) : 0;
      const comparable = prices.filter((n) => n >= center * 0.6 && n <= center * 1.6);
      lastCount = Math.max(lastCount, comparable.length);
      if (comparable.length < 3) continue;
      const euros = median(comparable) * surface;
      const variance = comparable.length < 7 ? 0.2 : 0.15;
      const low = Math.round(euros * (1 - variance));
      const high = Math.round(euros * (1 + variance));
      return {
        estimate_cents: Math.round(euros * 100),
        low_cents: low * 100,
        high_cents: high * 100,
        comparables: comparable.length,
        confidence: comparable.length >= 10 && radius <= 1500 ? 'medium' : 'low',
        source: 'GeoRegistry / DVF (DGFiP), médiane des ventes proches',
        source_url: 'https://georegistry.fr/docs/api',
        method: 'dvf_median_nearby',
        radius_m: radius,
        as_of: new Date().toISOString().slice(0, 10),
        disclaimer: "Estimation indicative à partir des ventes voisines, non expertise. Calcul de secours sans validation indépendante. Prix d'achat et frais non inclus.",
      };
    }
    throw new EstimateError(422, lastCount > 0
      ? 'Estimation indisponible : ' + lastCount + ' vente(s) comparable(s) fiable(s) retenue(s) dans un rayon de ' + (lastRadius / 1000) + ' km (minimum 3 requis). Valeur actuelle inchangée.'
      : initialError + ' Aucune vente suffisamment comparable et vérifiable trouvée à proximité. Vérifiez l’adresse et la surface ou saisissez une valeur manuelle.');
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
