// Affichage des nombres à la française avec un point comme séparateur de milliers : 12.500,50.
// Les exports CSV gardent des nombres sans séparateur de milliers (lisibles tels quels par un tableur).
const cache = new Map();

export function formatNumber(value, { min = 0, max = 2 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const key = min + ':' + max;
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat('fr-FR', { minimumFractionDigits: min, maximumFractionDigits: max }));
  return cache.get(key).formatToParts(n)
    .map((p) => (p.type === 'group' ? '.' : p.type === 'minusSign' ? '−' : p.value)).join('');
}

// Centimes en montant lisible : 1250050 → « 12.500,50 ».
export const formatCents = (cents) => formatNumber(cents / 100, { min: 2, max: 2 });
