// Calculs du patrimoine : valeurs actuelles, conversions de devises, répartitions et historique.
import { getSetting } from './db.js';
import { loanSummary, loanValuations } from './loans.js';
import { ownedCents, latentGain } from './real-estate.js';

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

// Texte d'un montant sans espaces ni symbole → nombre au format JavaScript ("12500.5"), ou null.
// Le point est le séparateur de milliers affiché par Vigie : « 12.500 » vaut douze mille cinq cents,
// « 1.234.567 » un million… ; « 12,5 », « 12.5 » et « 0.500 » restent des décimales.
// Avec virgule et point, le dernier des deux est le séparateur décimal (12.500,50 ou 12,500.50).
export function normalizeAmountText(s) {
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  } else if (/^-?[1-9]\d{0,2}(,\d{3}){2,}$/.test(s)) {
    s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}

// Accepte 1234.5, "1234,50", "1 234,50 €", "12.500,50", "12.500", "-12" ; renvoie des centimes entiers ou null.
export function parseAmountToCents(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) >= 1e13) return null;
    return Math.round(value * 100);
  }
  if (typeof value !== 'string') return null;
  let s = value.replace(/[\s  €$£]/g, '').replace(/[A-Za-z]/g, '').replace(/^\u2212/, '-');
  if (!s) return null;
  s = normalizeAmountText(s);
  if (s === null) return null;
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
export function getSchedules(db) {
  return new Map(db.prepare('SELECT * FROM loan_schedules').all().map((s) => [s.holding_id, s]));
}

// Valeurs d'un avoir : saisies manuelles, ou, s'il suit un échéancier, valeurs antérieures au versement
// puis capital restant calculé à chaque échéance jusqu'à aujourd'hui.
export function mergeSchedule(list, schedule, today) {
  if (!schedule) return list;
  return [...list.filter((v) => v.valued_at < schedule.start_date), ...loanValuations(schedule, today)];
}

// Délai de rappel propre au compte (0.11.0), à défaut le réglage général.
export function staleDaysFor(db, userId = null) {
  const own = userId === null ? null : getSetting(db, 'stale_days:' + userId, null);
  return Number(own ?? getSetting(db, 'stale_days', '45'));
}

export function loadState(db, today = todayIso(), userId = null) {
  // Chaque compte a ses propres catégories (et ses allocations cibles).
  const categories = userId === null
    ? db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all()
    : db.prepare('SELECT * FROM categories WHERE account_user_id = ? ORDER BY sort_order, id').all(userId);
  // Chaque compte ne voit que ses avoirs et les parts d'avoirs d'autrui qu'il a explicitement acceptées.
  let holdings = userId === null
    ? db.prepare('SELECT * FROM holdings ORDER BY sort_order, id').all()
    : db.prepare(`SELECT h.* FROM holdings h WHERE h.account_user_id = ?
        OR EXISTS (SELECT 1 FROM holding_shares s WHERE s.holding_id = h.id
          AND s.recipient_id = ? AND s.accepted_at IS NOT NULL
          AND s.revoked_at IS NULL AND s.declined_at IS NULL)
        ORDER BY h.sort_order,h.id`).all(userId,userId);
  // Un avoir reçu en partage est rangé dans la catégorie du destinataire de même nom et de même type ;
  // à défaut, la catégorie du titulaire est montrée telle quelle (lecture seule).
  if (userId !== null) {
    const own = new Set(categories.map((c) => c.id));
    const byName = new Map(categories.map((c) => [c.kind + ':' + c.name.trim().toLowerCase(), c.id]));
    holdings = holdings.map((h) => {
      if (own.has(h.category_id)) return h;
      const theirs = db.prepare('SELECT * FROM categories WHERE id = ?').get(h.category_id);
      const mine = theirs && byName.get(theirs.kind + ':' + theirs.name.trim().toLowerCase());
      if (mine) return { ...h, category_id: mine };
      if (theirs && !own.has(theirs.id)) { categories.push({ ...theirs, shared_only: true }); own.add(theirs.id); }
      return h;
    });
  }
  const visibleIds = new Set(holdings.map((h) => h.id));
  const valuations = db.prepare('SELECT id, holding_id, valued_at, amount_cents, note FROM valuations ORDER BY holding_id, valued_at')
    .all().filter((v) => visibleIds.has(v.holding_id));
  const byHolding = new Map();
  for (const v of valuations) {
    if (!byHolding.has(v.holding_id)) byHolding.set(v.holding_id, []);
    byHolding.get(v.holding_id).push(v);
  }
  const schedules = getSchedules(db);
  const acquisitions = new Map(db.prepare('SELECT * FROM holding_acquisitions').all().filter(p => visibleIds.has(p.holding_id)).map(p => [p.holding_id,p]));
  // La quote-part du titulaire est portée par l'avoir (holdings.ownership_bp), pour tous les avoirs.
  const ownerBp = new Map(holdings.map((h) => [h.id, h.ownership_bp ?? 10000]));
  const properties = new Map(db.prepare('SELECT * FROM real_estate').all()
    .filter((p) => visibleIds.has(p.holding_id)).map((p) => [p.holding_id, { ...p, ownership_bp: ownerBp.get(p.holding_id) }]));
  const shares = db.prepare(`SELECT holding_id, recipient_id, ownership_bp FROM holding_shares
    WHERE accepted_at IS NOT NULL AND revoked_at IS NULL AND declined_at IS NULL`)
    .all().filter((p) => visibleIds.has(p.holding_id));
  const acceptedByHolding = new Map();
  for (const share of shares) if (share.recipient_id === userId)
    acceptedByHolding.set(share.holding_id,
      (acceptedByHolding.get(share.holding_id) || 0) + share.ownership_bp);
  for (const [hid, s] of schedules) byHolding.set(hid, mergeSchedule(byHolding.get(hid) || [], s, today));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const { base, rates } = getRates(db);
  return { categories, holdings, byHolding, catById, base, rates, schedules, properties, acquisitions, acceptedByHolding, shares, userId, today };
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
  // Pour chacun des comptes Vigie, une seule valeur de l'avoir entier mais
  // uniquement sa propre quote-part ; aucun transfert des autres avoirs.
  const ownerBp = h.ownership_bp ?? state.properties.get(h.id)?.ownership_bp ?? 10000;
  const ownershipBp = state.userId !== null && h.account_user_id !== state.userId
    ? (state.acceptedByHolding.get(h.id) || 0) : ownerBp;
  const owned = cents === null ? null : ownedCents(cents, ownershipBp);
  const base = owned === null ? null : toBase(state, owned, h.currency);
  return { valuation: v, cents, owned, base, ownership_bp: ownershipBp, owner_owned_cents: owned,
    shared_with_me: state.userId !== null && h.account_user_id !== state.userId,
    missingRate: cents !== null && base === null };
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
  const today = options.today || todayIso();
  const state = loadState(db, today, options.userId ?? null);
  const staleDays = staleDaysFor(db, options.userId ?? null);
  let assets = 0, liabilities = 0;
  const liquidity = { immediate: 0, short: 0, locked: 0 };
  const catTotals = new Map(state.categories.map((c) => [c.id, { value: 0, count: 0 }]));
  const forGroups = [];
  const stale = [];
  const missingRates = new Set();
  let openCount = 0;
  // Crypto-actif suivi automatiquement : sa valeur se calcule seule, il n'est jamais « à actualiser » à la main.
  const autoCrypto = new Set(db.prepare("SELECT holding_id FROM crypto_holdings WHERE mode <> 'manual'").all().map((r) => r.holding_id));

  for (const h of state.holdings) {
    const cat = state.catById.get(h.category_id);
    if (!cat) continue;
    const snap = holdingSnapshot(state, h);
    if (!h.closed_at) {
      openCount += 1;
      const last = snap.valuation ? snap.valuation.valued_at : null;
      const age = last ? daysBetween(last, today) : null;
      if (!state.schedules.has(h.id) && !autoCrypto.has(h.id) && staleDays > 0 && (age === null || age > staleDays)) stale.push({ id: h.id, name: h.name, category: cat.name, category_icon: cat.icon, kind: cat.kind, last_date: last, age_days: age });
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
  const today = options.today || todayIso();
  const state = loadState(db, today, options.userId ?? null);
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

// --- Partage d'un avoir entre comptes du même serveur -------------------------------------------------
export const shareStatus = (r, now = Date.now()) => r.revoked_at ? 'revoked' : r.declined_at ? 'declined'
  : r.accepted_at ? 'accepted' : r.expires_at <= now ? 'expired' : 'pending';
export const SHARE_ROW_SQL = `SELECT s.*, h.name AS holding_name, h.account_user_id AS holding_owner_id,
    u.display_name AS sender_name, r.display_name AS recipient_name, o.display_name AS owner_name,
    (r.email IS NOT NULL AND r.email <> '') AS recipient_has_email
  FROM holding_shares s JOIN holdings h ON h.id = s.holding_id
  LEFT JOIN users u ON u.id = s.sender_id
  JOIN users r ON r.id = s.recipient_id
  LEFT JOIN users o ON o.id = h.account_user_id`;
export function shareView(row, now = Date.now()) {
  return { id: row.id, holding_id: row.holding_id, holding_name: row.holding_name,
    sender_name: row.sender_name, owner_name: row.owner_name, recipient_id: row.recipient_id, recipient_name: row.recipient_name,
    recipient_has_email: Boolean(row.recipient_has_email), send_count: row.send_count ?? (row.sent_at ? 1 : 0),
    ownership_bp: row.ownership_bp, deducted_bp: row.deducted_bp, status: shareStatus(row, now),
    created_at: row.created_at, sent_at: row.sent_at, expires_at: row.expires_at,
    accepted_at: row.accepted_at, declined_at: row.declined_at, revoked_at: row.revoked_at };
}
// État du partage de chaque avoir visible : le titulaire voit toutes ses propositions, le destinataire seulement la sienne.
export function sharingByHolding(db, state) {
  const out = new Map();
  const visible = new Map(state.holdings.map((h) => [h.id, h]));
  const now = Date.now();
  // Corrections de répartition en attente (1.4.0) : par avoir, et personnes dont l'accord manque encore.
  const pendingFix = new Map();
  for (const r of db.prepare(`SELECT c.holding_id, s.recipient_id, i.accepted_at FROM share_corrections c
      JOIN share_correction_items i ON i.correction_id = c.id JOIN holding_shares s ON s.id = i.share_id
      WHERE c.applied_at IS NULL AND c.declined_at IS NULL AND c.cancelled_at IS NULL AND i.needs_consent = 1`).all()) {
    if (!pendingFix.has(r.holding_id)) pendingFix.set(r.holding_id, new Set());
    if (!r.accepted_at) pendingFix.get(r.holding_id).add(r.recipient_id);
  }
  for (const row of db.prepare(SHARE_ROW_SQL + ' ORDER BY s.created_at DESC, s.id DESC').all()) {
    const h = visible.get(row.holding_id);
    if (!h) continue;
    const mine = state.userId === null || h.account_user_id === state.userId;
    if (mine) {
      if (!out.has(h.id)) out.set(h.id, { role: 'owner', owner_bp: h.ownership_bp ?? 10000, shares: [], correction_pending: pendingFix.has(h.id) });
      out.get(h.id).shares.push(shareView(row, now));
    } else if (row.recipient_id === state.userId && shareStatus(row, now) === 'accepted') {
      out.set(h.id, { role: 'recipient', owner_name: row.owner_name, share: shareView(row, now),
        correction_pending: Boolean(pendingFix.get(h.id)?.has(state.userId)) });
    }
  }
  return out;
}

// Liste des avoirs avec leur valeur actuelle et une mini-série pour l'aperçu.
export function holdingsView(db, userId = null) {
  const today = todayIso();
  const state = loadState(db, today, userId);
  const staleDays = staleDaysFor(db, userId);
  const properties = state.properties;
  const sharing = sharingByHolding(db, state);
  // Crypto-actifs : actif, mode de suivi et dernière quantité lue, pour la liste et la mise à jour rapide.
  const cryptos = new Map(db.prepare('SELECT holding_id, asset, mode, last_quantity, last_error, last_ok_at FROM crypto_holdings').all().map((c) => [c.holding_id, { ...c }]));
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
        value_cents: snap.cents, // valeur du bien entier, inchangée pour la saisie et l'historique
        owned_cents: snap.owned, // part détenue par ce compte
        owner_owned_cents: snap.owner_owned_cents,
        total_ownership_bp: snap.ownership_bp,
        shared_with_me: snap.shared_with_me,
        property: properties.get(h.id) || null,
        acquisition: state.acquisitions.get(h.id) || null,
        // Prix de revient et plus-value latente ramenés à la quote-part détenue par ce compte.
        latent_basis_cents: properties.has(h.id) ? Math.round(properties.get(h.id).purchase_cents * snap.ownership_bp / 10000)
          : state.acquisitions.has(h.id) ? Math.round(state.acquisitions.get(h.id).purchase_cents * snap.ownership_bp / 10000) : null,
        latent_gain_cents: properties.has(h.id) ? latentGain(snap.cents, properties.get(h.id).purchase_cents, snap.ownership_bp)?.gain_cents ?? null
          : state.acquisitions.has(h.id) && snap.cents !== null && !h.closed_at ? latentGain(snap.cents, state.acquisitions.get(h.id).purchase_cents, snap.ownership_bp)?.gain_cents ?? null : null,
        sharing: sharing.get(h.id) || null,
        crypto: cryptos.get(h.id) || null,
        value_base: snap.base,
        missing_rate: snap.missingRate,
        last_date: last,
        age_days: last ? daysBetween(last, today) : null,
        previous_cents: prev ? prev.amount_cents : null,
        previous_date: prev ? prev.valued_at : null,
        valuation_count: list.length,
        spark: list.slice(-24).map((v) => [v.valued_at, v.amount_cents]),
        schedule: state.schedules.has(h.id) ? loanSummary(state.schedules.get(h.id), today) : null,
      };
    }),
  };
}
