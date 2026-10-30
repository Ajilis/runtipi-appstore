// Calculs du patrimoine : valeurs actuelles, conversions de devises, répartitions et historique.
import { getSetting } from './db.js';

export const LIQUIDITY = ['immediate', 'short', 'locked'];

export function todayIso(now = new Date()) {
  // Date locale du conteneur (TZ fourni par Runtipi), au format AAAA-MM-JJ.
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(iso, months) {
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

// Accepte 1234.5, "1234,50", "1 234,50 €", "-12" ; renvoie des centimes entiers ou null.
export function parseAmountToCents(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) >= 1e13) return null;
    return Math.round(value * 100);
  }
  if (typeof value !== 'string') return null;
  let s = value.replace(/[\s  €$£]/g, '').replace(/[A-Za-z]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    // Le dernier séparateur est le séparateur décimal.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || Math.abs(n) >= 1e13) return null;
  return Math.round(n * 100);
}

export function getBaseCurrency(db) {
  return getSetting(db, 'base_currency', 'EUR');
}

export function getRates(db) {
  const base = getBaseCurrency(db);
  const rates = { [base]: 1 };
  for (const r of db.prepare('SELECT currency, rate FROM fx_rates').all()) if (r.currency !== base) rates[r.currency] = r.rate;
  return { base, rates };
}

// Charge l'état complet en mémoire : quelques centaines de lignes pour un patrimoine personnel.
export function loadState(db) {
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
  const holdings = db.prepare('SELECT * FROM holdings ORDER BY sort_order, id').all();
  const valuations = db.prepare('SELECT id, holding_id, valued_at, amount_cents, note FROM valuations ORDER BY holding_id, valued_at').all();
  const byHolding = new Map();
  for (const v of valuations) {
    if (!byHolding.has(v.holding_id)) byHolding.set(v.holding_id, []);
    byHolding.get(v.holding_id).push(v);
  }
  const catById = new Map(categories.map((c) => [c.id, c]));
  const { base, rates } = getRates(db);
  return { categories, holdings, byHolding, catById, base, rates };
}

function lastOnOrBefore(list, date) {
  // Recherche dichotomique dans la liste triée par date.
  let lo = 0, hi = list.length - 1, found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].valued_at <= date) { found = list[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

export function toBase(state, cents, currency) {
  const rate = state.rates[currency];
  if (rate === undefined) return null;
  return Math.round(cents * rate);
}

export function holdingSnapshot(state, h, date = null) {
  const list = state.byHolding.get(h.id) || [];
  const v = date ? lastOnOrBefore(list, date) : list[list.length - 1] || null;
  const cents = v ? v.amount_cents : null;
  const base = cents === null ? null : toBase(state, cents, h.currency);
  return { valuation: v, cents, base, missingRate: cents !== null && base === null };
}

// Patrimoine à une date : somme des dernières valeurs connues à cette date.
export function totalsAt(state, date) {
  let assets = 0, liabilities = 0;
  for (const h of state.holdings) {
    const cat = state.catById.get(h.category_id);
    if (!cat) continue;
    const snap = holdingSnapshot(state, h, date);
    if (snap.base === null) continue;
    if (cat.kind === 'liability') liabilities += snap.base; else assets += snap.base;
  }
  return { assets, liabilities, net: assets - liabilities };
}

function firstValuationDate(state) {
  let first = null;
  for (const list of state.byHolding.values()) if (list.length && (!first || list[0].valued_at < first)) first = list[0].valued_at;
  return first;
}

function variation(state, today, from, currentNet) {
  const first = firstValuationDate(state);
  if (!first || first > from) return null;
  const past = totalsAt(state, from).net;
  return { from, net: past, delta: currentNet - past, pct: past !== 0 ? (currentNet - past) / Math.abs(past) : null };
}

function groupSum(items) {
  const map = new Map();
  for (const { key, label, value } of items) {
    const e = map.get(key) || { key, label, value: 0, count: 0 };
    e.value += value; e.count += 1;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

export function dashboard(db, options = {}) {
  const state = loadState(db);
  const today = options.today || todayIso();
  const staleDays = Number(getSetting(db, 'stale_days', '45'));
  let assets = 0, liabilities = 0;
  const liquidity = { immediate: 0, short: 0, locked: 0 };
  const catTotals = new Map(state.categories.map((c) => [c.id, { value: 0, count: 0 }]));
  const forGroups = [];
  const stale = [];
  const missingRates = new Set();
  let openCount = 0;

  for (const h of state.holdings) {
    const cat = state.catById.get(h.category_id);
    if (!cat) continue;
    const snap = holdingSnapshot(state, h);
    if (!h.closed_at) {
      openCount += 1;
      const last = snap.valuation ? snap.valuation.valued_at : null;
      const age = last ? daysBetween(last, today) : null;
      if (staleDays > 0 && (age === null || age > staleDays)) stale.push({ id: h.id, name: h.name, category: cat.name, category_icon: cat.icon, kind: cat.kind, last_date: last, age_days: age });
    }
    if (snap.missingRate) { missingRates.add(h.currency); continue; }
    if (snap.base === null || (h.closed_at && snap.base === 0)) continue;
    const ct = catTotals.get(cat.id);
    ct.value += snap.base; ct.count += 1;
    if (cat.kind === 'liability') { liabilities += snap.base; continue; }
    assets += snap.base;
    liquidity[h.liquidity] += snap.base;
    forGroups.push({ h, value: snap.base });
  }

  const net = assets - liabilities;
  const categories = state.categories.map((c) => {
    const t = catTotals.get(c.id);
    const denom = c.kind === 'liability' ? liabilities : assets;
    const pct = denom > 0 ? t.value / denom : 0;
    const target = c.kind === 'asset' && c.target_pct !== null && c.target_pct !== undefined ? c.target_pct / 100 : null;
    return {
      id: c.id, name: c.name, kind: c.kind, icon: c.icon, value: t.value, count: t.count, pct,
      target_pct: target, gap: target === null ? null : Math.round(target * assets - t.value),
    };
  });

  const groups = {
    institution: groupSum(forGroups.map(({ h, value }) => ({ key: (h.institution || '').trim().toLowerCase() || '—', label: (h.institution || '').trim() || 'Sans établissement', value }))),
    owner: groupSum(forGroups.map(({ h, value }) => ({ key: (h.owner || '').trim().toLowerCase() || '—', label: (h.owner || '').trim() || 'Non précisé', value }))),
    currency: groupSum(forGroups.map(({ h, value }) => ({ key: h.currency, label: h.currency, value }))),
  };

  const yearStart = `${today.slice(0, 4)}-01-01`;
  return {
    base_currency: state.base,
    today,
    totals: { assets, liabilities, net },
    liquidity,
    categories,
    groups,
    variations: {
      month: variation(state, today, addMonths(today, -1), net),
      quarter: variation(state, today, addMonths(today, -3), net),
      year: variation(state, today, addMonths(today, -12), net),
      ytd: variation(state, today, addDays(yearStart, -1), net),
    },
    stale: stale.sort((a, b) => (b.age_days ?? 1e9) - (a.age_days ?? 1e9)),
    stale_days: staleDays,
    missing_rates: [...missingRates].sort(),
    counts: { open: openCount, total: state.holdings.length },
    first_date: firstValuationDate(state),
  };
}

// Points de la courbe : chaque date de valorisation de la période, plus ses bornes.
export function history(db, range = '1y', options = {}) {
  const state = loadState(db);
  const today = options.today || todayIso();
  const first = firstValuationDate(state);
  if (!first) return { base_currency: state.base, points: [] };
  const starts = { '3m': addMonths(today, -3), '6m': addMonths(today, -6), '1y': addMonths(today, -12), '3y': addMonths(today, -36), '5y': addMonths(today, -60), all: first };
  let start = starts[range] || starts['1y'];
  if (start < first) start = first;
  const dates = new Set([start, today]);
  for (const list of state.byHolding.values()) for (const v of list) if (v.valued_at > start && v.valued_at <= today) dates.add(v.valued_at);
  const points = [...dates].sort().map((date) => ({ date, ...totalsAt(state, date) }));
  return { base_currency: state.base, range, points };
}

// Liste des avoirs avec leur valeur actuelle et une mini-série pour l'aperçu.
export function holdingsView(db) {
  const state = loadState(db);
  const today = todayIso();
  const staleDays = Number(getSetting(db, 'stale_days', '45'));
  return {
    base_currency: state.base,
    stale_days: staleDays,
    categories: state.categories,
    holdings: state.holdings.map((h) => {
      const list = state.byHolding.get(h.id) || [];
      const snap = holdingSnapshot(state, h);
      const prev = list.length > 1 ? list[list.length - 2] : null;
      const last = snap.valuation ? snap.valuation.valued_at : null;
      return {
        ...h,
        value_cents: snap.cents,
        value_base: snap.base,
        missing_rate: snap.missingRate,
        last_date: last,
        age_days: last ? daysBetween(last, today) : null,
        previous_cents: prev ? prev.amount_cents : null,
        previous_date: prev ? prev.valued_at : null,
        valuation_count: list.length,
        spark: list.slice(-24).map((v) => [v.valued_at, v.amount_cents]),
      };
    }),
  };
}
