// Échéancier de prêt : capital restant calculé chaque mois à partir du montant, du taux, de la durée et de la date
// de versement. Sert aux prêts accordés (actif) comme aux crédits souscrits (passif).
// Tous les montants sont en centimes ; les arrondis se font sur chaque ligne affichée.

export const LOAN_KINDS = ['amortizing', 'bullet']; // mensualités constantes, in fine
export const LOAN_ICONS = ['handshake', 'loanHouse', 'loanDoc'];

function addMonths(iso, months) {
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

// Tableau d'amortissement complet : une ligne par échéance mensuelle.
export function amortization(s) {
  const P = s.principal_cents;
  const n = s.months;
  const i = s.annual_rate / 100 / 12;
  const rows = [];
  if (s.kind === 'bullet') {
    for (let k = 1; k <= n; k++) {
      const interest = Math.round(P * i);
      const principal = k === n ? P : 0;
      rows.push({ n: k, date: addMonths(s.start_date, k), payment: interest + principal, interest, principal, remaining: k === n ? 0 : P });
    }
    return rows;
  }
  // Comme un tableau bancaire : mensualité arrondie au centime, identique chaque mois ; la dernière solde le capital.
  const M = Math.round(i === 0 ? P / n : (P * i) / (1 - (1 + i) ** -n));
  let remaining = P;
  for (let k = 1; k <= n; k++) {
    const interest = Math.round(remaining * i);
    const principal = k === n ? remaining : Math.min(remaining, M - interest);
    remaining -= principal;
    rows.push({ n: k, date: addMonths(s.start_date, k), payment: principal + interest, interest, principal, remaining });
  }
  return rows;
}

// Synthèse à une date : échéances passées, capital restant, prochaine échéance.
export function loanSummary(s, today) {
  const rows = amortization(s);
  const paid = rows.filter((r) => r.date <= today);
  const next = rows.find((r) => r.date > today) || null;
  const started = s.start_date <= today;
  return {
    kind: s.kind,
    principal_cents: s.principal_cents,
    annual_rate: s.annual_rate,
    months: s.months,
    start_date: s.start_date,
    end_date: rows.length ? rows[rows.length - 1].date : s.start_date,
    payment_cents: rows.length ? (s.kind === 'bullet' ? rows[0].payment : rows[0].payment) : 0,
    last_payment_cents: rows.length ? rows[rows.length - 1].payment : 0,
    total_interest_cents: rows.reduce((t, r) => t + r.interest, 0),
    paid_count: paid.length,
    remaining_cents: !started ? null : paid.length ? paid[paid.length - 1].remaining : s.principal_cents,
    repaid_cents: paid.reduce((t, r) => t + r.principal, 0),
    interest_received_cents: paid.reduce((t, r) => t + r.interest, 0),
    next_date: next ? next.date : null,
    next_payment_cents: next ? next.payment : null,
    done: rows.length > 0 && paid.length === rows.length,
  };
}

// Valeurs mensuelles jusqu'à aujourd'hui : versement initial, puis capital restant après chaque échéance.
export function loanValuations(s, today, until = today) {
  if (s.start_date > until) return [];
  const out = [{ valued_at: s.start_date, amount_cents: s.principal_cents, note: 'Versement du prêt', auto: true }];
  for (const r of amortization(s)) {
    if (r.date > until) break;
    out.push({ valued_at: r.date, amount_cents: r.remaining, note: r.remaining === 0 ? 'Prêt remboursé' : `Échéance ${r.n}`, auto: true });
  }
  return out;
}

export function isLoanCategory(cat) {
  return Boolean(cat) && (cat.kind === 'liability' || LOAN_ICONS.includes(cat.icon));
}
