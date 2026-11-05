// Prix de revient d'un crypto-actif à partir des achats et ventes datés (1.8.0).
// Méthode du coût unitaire moyen pondéré (PRU) : chaque achat ajoute sa quantité et son coût, frais compris ;
// chaque vente retire une part du coût proportionnelle à la quantité vendue, et l'écart avec le montant reçu
// (frais déduits) est la plus-value réalisée. Le PRU de ce qui reste ne change donc pas à la vente.
// Quantités en chaînes décimales exactes (18 décimales au plus), calculées en BigInt ; montants en centimes.

const DECIMALS = 18;
const SCALE = 10n ** BigInt(DECIMALS);

export function toUnits(quantity) {
  const [int, frac = ''] = String(quantity).split('.');
  return BigInt(int || '0') * SCALE + BigInt((frac + '0'.repeat(DECIMALS)).slice(0, DECIMALS));
}

export function fromUnits(units) {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const int = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${frac ? '.' + frac : ''}`;
}

const asNumber = (units) => Number(units) / Number(SCALE);
const chrono = (a, b) => (a.moved_at < b.moved_at ? -1 : a.moved_at > b.moved_at ? 1 : a.id - b.id);

// movements : [{ id, kind: 'buy'|'sell', moved_at, quantity, amount_cents, fee_cents }]
// until : date ISO incluse (bilan à une date passée), ou null pour toutes les opérations.
// Renvoie { error } si une vente dépasse la quantité détenue à sa date.
export function cryptoCost(movements, until = null) {
  let units = 0n, cost = 0, invested = 0, realized = 0, received = 0, first = null, sells = 0;
  const steps = [];
  for (const m of [...movements].sort(chrono)) {
    if (until && m.moved_at > until) break;
    const q = toUnits(m.quantity);
    const total = m.amount_cents + (m.fee_cents || 0);
    let gain = null, out = null;
    if (m.kind === 'buy') {
      units += q; cost += total; invested += total;
      first = first || m.moved_at;
    } else {
      if (q > units) return { error: { id: m.id, moved_at: m.moved_at, held: fromUnits(units), sold: fromUnits(q) } };
      out = units === 0n ? 0 : Math.round(cost * (asNumber(q) / asNumber(units)));
      const net = m.amount_cents - (m.fee_cents || 0);
      gain = net - out;
      realized += gain; received += net; cost -= out; units -= q; sells += 1;
      if (units === 0n) cost = 0;
    }
    steps.push({ id: m.id, quantity_after: fromUnits(units), cost_after_cents: cost,
      pru_after_cents: units > 0n ? cost / asNumber(units) : null, cost_out_cents: out, realized_cents: gain });
  }
  return { quantity: fromUnits(units), cost_cents: cost, pru_cents: units > 0n ? cost / asNumber(units) : null,
    invested_cents: invested, realized_cents: realized, received_cents: received, sells, first_date: first, count: steps.length, steps };
}
