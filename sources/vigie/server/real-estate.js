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
      const msg = response.status === 429 ? "Source temporairement limitée : réessayez plus tard."
        : response.status === 422 ? 'Adresse ou caractéristiques non reconnues par la source.'
        : 'Estimation indisponible pour ce secteur.';
      throw new EstimateError(response.status === 429 ? 503 : response.status === 422 ? 422 : 503, msg);
    }
    if (Number(response.headers?.get('content-length') || 0) > MAX_RESPONSE_BYTES) throw new EstimateError(502, 'Réponse immobilière trop volumineuse.');
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
    if (![estimate, low, high, samples].every(Number.isFinite) ||
      estimate < 10000 || estimate > 100_000_000 || low <= 0 || low > estimate || high < estimate ||
      high > estimate * 4 || !Number.isInteger(samples) || samples < 3) {
      throw new EstimateError(422, "Données comparables insuffisantes ou incohérentes : estimation refusée.");
    }
    return {
      estimate_cents: Math.round(estimate * 100),
      low_cents: Math.round(low * 100),
      high_cents: Math.round(high * 100),
      comparables: samples,
      confidence: ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : 'low',
      source: 'GeoRegistry / DVF (DGFiP)',
      source_url: 'https://georegistry.fr/docs/api',
      as_of: new Date().toISOString().slice(0, 10),
      disclaimer: "Estimation indicative sur ventes comparables, non expertise. Valeur d'achat et frais non inclus.",
    };
  }
}
