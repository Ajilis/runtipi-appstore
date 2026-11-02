/* Vigie Patrimoine : interface web (sans framework ni dépendance, hors générateur de QR code). */
'use strict';
(() => {
  // ---------------------------------------------------------------------------------------------------------
  // Outils de base
  // ---------------------------------------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const raw = (s) => new Raw(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const part = (v) => (v === null || v === undefined || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : esc(v));
  const html = (strings, ...vals) => raw(strings.reduce((acc, s, i) => acc + s + (i < vals.length ? part(vals[i]) : ''), ''));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('vigie.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('vigie.' + k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
  };

  const state = {
    boot: null,
    user: null,
    discret: store.get('discret', false),
    range: store.get('range', '1y'),
    breakdown: store.get('breakdown', 'institution'),
    showClosed: false,
    inst: { list: [], map: new Map() },
    logos: false,
    logoVersions: null,
    logoFull: {},
    filter: '',
    base: 'EUR',
    charts: [],
  };
  const canEdit = () => state.user && (state.user.role === 'admin' || state.user.role === 'editor');
  const isAdmin = () => state.user && state.user.role === 'admin';

  // ---------------------------------------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------------------------------------
  async function api(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'x-vigie-request': '1', accept: 'application/json' } };
    if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, opts); } catch { throw Object.assign(new Error('Le serveur ne répond pas. Vérifiez votre connexion.'), { status: 0 }); }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const err = Object.assign(new Error((data && data.message) || `Erreur ${res.status}`), { status: res.status, code: data && data.error, data });
      if (res.status === 401 && !url.startsWith('/api/auth/')) sessionLost();
      if (err.code === 'totp_setup_required' && state.boot) { state.boot.needs_2fa_setup = true; if (location.hash !== '#/compte') location.hash = '#/compte'; }
      throw err;
    }
    return data;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Formats
  // ---------------------------------------------------------------------------------------------------------
  const nfCache = new Map();
  function nf(cur, digits) {
    const key = cur + digits;
    if (!nfCache.has(key)) {
      try { nfCache.set(key, new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, minimumFractionDigits: digits, maximumFractionDigits: digits })); }
      catch { nfCache.set(key, new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })); }
    }
    return nfCache.get(key);
  }
  const MASK = '••••••';
  function symbol(cur) {
    const p = nf(cur, 0).formatToParts(0).find((x) => x.type === 'currency');
    return p ? p.value : cur;
  }
  function money(cents, cur = state.base, { digits = 0, sign = false } = {}) {
    if (cents === null || cents === undefined) return '—';
    if (state.discret) return `${MASK} ${symbol(cur)}`;
    const s = nf(cur, digits).format(cents / 100);
    return sign && cents > 0 ? '+' + s : s.replace('-', '−');
  }
  const exact = (cents, cur) => money(cents, cur, { digits: 2 });
  function compactMoney(cents, cur = state.base) {
    if (state.discret) return '•••';
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 1 }).format(cents / 100).replace('-', '−');
  }
  function pct(x, { digits = 1, sign = false } = {}) {
    if (x === null || x === undefined || !Number.isFinite(x)) return '—';
    const s = new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x);
    return (sign && x > 0 ? '+' : '') + s.replace('-', '−');
  }
  const asDate = (iso) => new Date(iso + 'T12:00:00');
  const dateFr = (iso) => (iso ? asDate(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const dateLong = (iso) => asDate(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const dateTime = (ms) => (ms ? new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  function ago(days) {
    if (days === null || days === undefined) return 'jamais';
    if (days <= 0) return "aujourd'hui";
    if (days === 1) return 'hier';
    if (days < 45) return `il y a ${days} jours`;
    if (days < 365) return `il y a ${Math.round(days / 30.4)} mois`;
    const y = Math.floor(days / 365);
    return `il y a ${y} an${y > 1 ? 's' : ''}`;
  }
  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const LIQ = { immediate: 'Disponible', short: 'Sous quelques semaines', locked: 'Bloqué ou illiquide' };
  const LIQ_SHORT = { immediate: 'Disponible', short: 'Court terme', locked: 'Bloqué' };
  const ROLE = { admin: 'Administrateur', editor: 'Éditeur', viewer: 'Lecture seule' };
  const LIQ_ICON = { immediate: 'drop', short: 'clock', locked: 'lock' };
  const ROLE_ICON = { admin: 'crown', editor: 'pencil', viewer: 'eye' };

  // Montant saisi (12 500,50 ou 12,500.50) en centimes ; null si vide, NaN si illisible.
  function parseCents(s) {
    let t = String(s ?? '').replace(/[\s\u00a0\u202f€$£]/g, '');
    if (!t) return null;
    if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    else t = t.replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(t) ? Math.round(Number(t) * 100) : NaN;
  }
  const centsInput = (cents) => (cents / 100).toFixed(2).replace('.', ',').replace(',00', '');

  // Échéancier de prêt : même calcul que server/loans.js, pour l'aperçu immédiat du formulaire.
  const LOAN_ICONS = ['handshake', 'loanHouse', 'loanDoc'];
  const isLoanCat = (c) => Boolean(c) && (c.kind === 'liability' || LOAN_ICONS.includes(c.icon));
  const LOAN_KIND = { amortizing: 'Mensualités constantes', bullet: 'In fine' };
  function addMonthsIso(iso, months) {
    const d = new Date(iso + 'T00:00:00Z');
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
    return d.toISOString().slice(0, 10);
  }
  function amortize(s) {
    const P = s.principal_cents, n = s.months, i = s.annual_rate / 100 / 12, rows = [];
    if (s.kind === 'bullet') {
      for (let k = 1; k <= n; k++) { const interest = Math.round(P * i); rows.push({ n: k, date: addMonthsIso(s.start_date, k), payment: interest + (k === n ? P : 0), interest, principal: k === n ? P : 0, remaining: k === n ? 0 : P }); }
      return rows;
    }
    const M = Math.round(i === 0 ? P / n : (P * i) / (1 - (1 + i) ** -n));
    let remaining = P;
    for (let k = 1; k <= n; k++) {
      const interest = Math.round(remaining * i);
      const principal = k === n ? remaining : Math.min(remaining, M - interest);
      remaining -= principal;
      rows.push({ n: k, date: addMonthsIso(s.start_date, k), payment: principal + interest, interest, principal, remaining });
    }
    return rows;
  }
  // Libellés selon le sens : argent prêté (actif) ou emprunté (passif).
  const loanWords = (liability) => (liability
    ? { principal: 'Montant emprunté', start: 'Date du déblocage', remaining: 'Capital restant dû', payment: 'Mensualité hors assurance', interest: 'Coût total des intérêts', interestToDate: 'Intérêts payés à ce jour', end: 'Dernière échéance' }
    : { principal: 'Montant prêté', start: 'Date du versement', remaining: 'Capital restant à recevoir', payment: 'Mensualité reçue', interest: 'Intérêts à percevoir au total', interestToDate: 'Intérêts perçus à ce jour', end: 'Dernière échéance' });
  const monthYear = (iso) => asDate(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const durationText = (m) => { const y = Math.floor(m / 12), r = m % 12; return [y ? `${y} an${y > 1 ? 's' : ''}` : '', r ? `${r} mois` : ''].filter(Boolean).join(' et '); };
  const catIconKey = (c) => (c && c.icon && CAT_ICONS[c.icon] ? c.icon : (c && c.kind === 'liability' ? 'loanDoc' : 'cube'));
  const pict = (key, cls = '') => html`<span class="pict ${cls}" aria-hidden="true">${icon(key)}</span>`;
  const catPict = (c, cls = '') => pict(catIconKey(c), `${c && c.kind === 'liability' ? 'liability' : ''} ${cls}`.trim());
  const nameInitials = (name) => { const w = String(name || '?').trim().split(/\s+/); return ((w[0] || '?').charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase(); };
  const avatar = (name, cls = '') => html`<span class="avatar ${cls}" aria-hidden="true">${nameInitials(name)}</span>`;
  const h2i = (name, text) => html`<h2 class="ti">${icon(name)}<span>${text}</span></h2>`;
  const h3i = (name, text) => html`<h3 class="ti">${icon(name)}<span>${text}</span></h3>`;
  const il = (name, text) => html`<span class="il">${icon(name)}<span>${text}</span></span>`;
  // Établissements : le serveur enrichit le catalogue local depuis Wikidata, OpenFinTech et Sirene.
  const fold = (s) => [...String(s || '')].map((c) => c.normalize('NFD')[0].toLowerCase()).join('');
  const normKey = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
  function indexInstitutions(list) {
    const map = new Map();
    for (const e of list) for (const n of [e.name, ...(Array.isArray(e.aliases) ? e.aliases : [])]) for (const k of [normKey(n), normKey(n).replace(/ /g, '')]) if (k && !map.has(k)) map.set(k, e);
    return { list, map };
  }
  function mergeInstitutions(entries) {
    if (!Array.isArray(entries)) return;
    const byId = new Map(state.inst.list.map((e) => [e.id, e]));
    for (const e of entries) if (e && typeof e.id === 'string' && typeof e.name === 'string') byId.set(e.id, e);
    state.inst = indexInstitutions([...byId.values()]);
  }
  const findInstitution = (name) => { const k = normKey(name); return k ? state.inst.map.get(k) || state.inst.map.get(k.replace(/ /g, '')) || null : null; };
  const MONO_STOP = new Set(['la', 'le', 'les', 'de', 'du', 'des', 'd', 'l', 'et', 'the', 'and']);
  function monoText(name) {
    const words = String(name).replace(/[&!'’.,()/+-]/g, ' ').split(/\s+/).filter(Boolean);
    let sig = words.filter((w) => !MONO_STOP.has(fold(w)));
    if (!sig.length) sig = words;
    if (!sig.length) return '?';
    if (sig.length === 1) return /^[A-Z0-9]{2,4}$/.test(sig[0]) ? sig[0].slice(0, 3) : sig[0].charAt(0).toUpperCase();
    return (sig[0].charAt(0) + sig[1].charAt(0)).toUpperCase();
  }
  const MONO_HUES = [168, 196, 214, 250, 286, 330, 18, 38, 130];
  const monoHue = (name) => { let h = 0; for (const c of normKey(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return MONO_HUES[h % MONO_HUES.length]; };
  // Pastille d'établissement : monogramme coloré, recouvert par le logo dès qu'il est chargé.
  // Clé du logo : identifiant du catalogue, ou « perso-nom » pour un établissement saisi librement (image déposée).
  const logoKeyFor = (name) => {
    const e = findInstitution(name);
    if (e) return e.id;
    const k = normKey(name).replace(/ /g, '-').slice(0, 80).replace(/-+$/, '');
    return k ? `perso-${k}` : null;
  };
  function instLogo(name, cls = '') {
    if (!String(name || '').trim()) return pict('bank', `neutral ${cls}`);
    const entry = findInstitution(name);
    const label = entry ? entry.name : name;
    const txt = monoText(label);
    const key = logoKeyFor(name);
    const v = key && state.logoVersions ? state.logoVersions[key] : null;
    const img = key && (v || (entry && state.logos));
    return html`<span class="inst ${cls} ${txt.length > 2 ? 'm3' : ''}" style="--h:${monoHue(label)}" aria-hidden="true"><span class="mono">${txt}</span>${img ? html`<img class="inst-img" src="/api/institutions/logo/${key}${v ? `?v=${v}` : ''}" alt="" loading="lazy" decoding="async">` : ''}</span>`;
  }
  async function loadLogoVersions() {
    try { const r = await api('GET', '/api/institutions/logos'); state.logoVersions = r.versions || {}; state.logoFull = r.full || {}; state.logos = Boolean(r.enabled); }
    catch { state.logoVersions = {}; state.logoFull = {}; }
  }
  // Logo complet (souvent horizontal) d'un établissement, sur fond blanc : seulement là où la place le permet.
  function instFullLogo(name) {
    const key = String(name || '').trim() ? logoKeyFor(name) : null;
    const v = key && state.logoFull ? state.logoFull[key] : null;
    if (!v) return '';
    const entry = findInstitution(name);
    return html`<span class="inst-full"><img src="/api/institutions/logo/${key}/full?v=${v}" alt="Logo ${entry ? entry.name : name}" loading="lazy" decoding="async"></span>`;
  }
  const initials = (u) => (((u.first_name || u.display_name || u.username || '?').trim().charAt(0)) + ((u.last_name || '').trim().charAt(0))).toUpperCase();
  const nameFields = (u = {}, autofocus = false) => html`<div class="grid-2">
    <label class="field"><span>Prénom</span><input class="input" name="first_name" autocomplete="given-name" required maxlength="60" value="${u.first_name || ''}" ${autofocus ? raw('autofocus') : ''}></label>
    <label class="field"><span>Nom</span><input class="input" name="last_name" autocomplete="family-name" required maxlength="60" value="${u.last_name || ''}"></label></div>`;
  const ROLE_HINT = { admin: 'Tout, y compris les comptes, les sauvegardes et la restauration', editor: 'Avoirs, valeurs, catégories et taux de change', viewer: 'Consultation et export, sans modification' };

  // ---------------------------------------------------------------------------------------------------------
  // Icônes (traits, 24 × 24)
  // ---------------------------------------------------------------------------------------------------------
  const P = {
    dashboard: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM14 4v4h6V4zM4 20h6v-3H4z"/>',
    holdings: '<path d="M4 7h16M4 12h16M4 17h10"/><circle cx="19" cy="17" r="1.5"/>',
    update: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    categories: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4z"/><circle cx="16.5" cy="16.5" r="3.5"/>',
    settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 19c1.2-3 3.7-4.5 6.5-4.5s5.3 1.5 6.5 4.5"/><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.7.7 2.9 2.1 3.5 4.2"/>',
    journal: '<path d="M6 3h10l3 3v15H6z"/><path d="M9 9h7M9 13h7M9 17h4"/>',
    logout: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6C3.8 8.3 2 12 2 12s3.6 7 10 7c1.9 0 3.5-.6 4.9-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    magic: '<path d="m4 20 12-12"/><path d="m15 6 3 3"/><path d="M18 2v3M22 6h-3M3 8l2 1M8 2l1 3M18 15l1 2M22 19l-2-1"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    chevUp: '<path d="M6 15l6-6 6 6"/>',
    chevDown: '<path d="M6 9l6 6 6-6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  };
  // Pictogrammes complémentaires (web/icons.js) : interface et catégories.
  const CAT_ICONS = (window.VIGIE_ICONS && window.VIGIE_ICONS.categories) || {};
  Object.assign(P, (window.VIGIE_ICONS && window.VIGIE_ICONS.ui) || {});
  for (const [k, v] of Object.entries(CAT_ICONS)) if (!P[k]) P[k] = v.d;
  const icon = (name) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`);
  const MARK = raw('<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#1e5a4e"/><g fill="none" stroke-width="5" stroke-linecap="round" transform="rotate(-90 32 32)"><circle cx="32" cy="32" r="18" stroke="#e3efeb" stroke-dasharray="55 58.1" /><circle cx="32" cy="32" r="18" stroke="#8fd1bf" stroke-dasharray="30 83.1" stroke-dashoffset="-63"/><circle cx="32" cy="32" r="18" stroke="#d8b26a" stroke-dasharray="6 107.1" stroke-dashoffset="-101"/></g><circle cx="32" cy="32" r="5" fill="#ffffff"/></svg>');

  // ---------------------------------------------------------------------------------------------------------
  // Gravure guillochée (motif de billet de banque), générée une fois
  // ---------------------------------------------------------------------------------------------------------
  let engravingCache = null;
  function engraving() {
    if (engravingCache) return engravingCache;
    // Rosace de billet : anneaux sinusoïdaux déphasés qui forment une moire, centrée en haut à droite.
    const paths = [];
    const ring = (cx, cy, r0, amp, petals, copies, steps = 720) => {
      for (let k = 0; k < copies; k++) {
        const phase = (k / copies) * (Math.PI * 2) / petals;
        let d = '';
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps) * Math.PI * 2;
          const r = r0 + amp * Math.sin(petals * t + phase * petals);
          d += (i ? 'L' : 'M') + (cx + r * Math.cos(t)).toFixed(1) + ' ' + (cy + r * Math.sin(t)).toFixed(1);
        }
        paths.push(d);
      }
    };
    ring(1040, 120, 150, 16, 24, 12);
    ring(1040, 120, 96, 12, 16, 10);
    ring(1040, 120, 52, 8, 10, 8, 480);
    engravingCache = raw(`<svg class="engraving" viewBox="0 0 1200 400" preserveAspectRatio="xMaxYMin slice" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="0.7" vector-effect="non-scaling-stroke">${paths.map((d) => `<path d="${d}"/>`).join('')}</g></svg>`);
    return engravingCache;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Graphiques SVG
  // ---------------------------------------------------------------------------------------------------------
  function niceTicks(min, max, count = 4) {
    if (min === max) { const pad = Math.abs(min) * 0.1 || 100; min -= pad; max += pad; }
    const step0 = (max - min) / count;
    const mag = 10 ** Math.floor(Math.log10(step0));
    const norm = step0 / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
    return { lo, hi, ticks };
  }

  // Courbe interactive : réticule, info-bulle, navigation au clavier, tableau de données pour les lecteurs d'écran.
  function lineChart(container, points, { height = 230, cur = state.base, label = 'Valeur', compact = false } = {}) {
    const draw = () => {
      if (!container.isConnected) return;
      const W = Math.max(260, container.clientWidth);
      const H = height;
      const pad = { l: 2, r: 4, t: compact ? 8 : 18, b: compact ? 6 : 26 };
      if (!points.length) { container.innerHTML = '<p class="chart-empty">Pas encore de données sur cette période.</p>'; return; }
      const t0 = asDate(points[0].date).getTime();
      const t1 = asDate(points[points.length - 1].date).getTime();
      const vals = points.map((p) => p.value);
      const { lo, hi, ticks } = niceTicks(Math.min(...vals), Math.max(...vals), compact ? 2 : 4);
      const x = (d) => pad.l + (t1 === t0 ? (W - pad.l - pad.r) : ((asDate(d).getTime() - t0) / (t1 - t0)) * (W - pad.l - pad.r));
      const y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
      const pts = points.map((p) => [x(p.date), y(p.value)]);
      if (pts.length === 1) pts.push([W - pad.r, pts[0][1]]);
      const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
      const area = `${line}L${pts[pts.length - 1][0].toFixed(1)} ${H - pad.b}L${pts[0][0].toFixed(1)} ${H - pad.b}Z`;
      let grid = '';
      if (!compact) {
        for (const v of ticks) grid += `<line class="gridline" x1="0" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="0" y="${(y(v) - 5).toFixed(1)}">${esc(compactMoney(v, cur))}</text>`;
        const labels = [];
        const span = (t1 - t0) / 86400000;
        const maxLabels = Math.max(2, Math.floor(W / 110));
        const months = span > 900 ? 12 : span > 400 ? 6 : span > 160 ? 3 : 1;
        const start = new Date(t0); start.setDate(1); start.setMonth(start.getMonth() + 1);
        for (let d = new Date(start); d.getTime() <= t1; d.setMonth(d.getMonth() + months)) labels.push(new Date(d));
        const step = Math.ceil(labels.length / maxLabels) || 1;
        labels.filter((_, i) => i % step === 0).forEach((d) => {
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
          const lx = x(iso);
          if (lx < 24 || lx > W - 24) return;
          const txt = d.toLocaleDateString('fr-FR', months >= 12 ? { year: 'numeric' } : { month: 'short', year: '2-digit' });
          grid += `<text x="${lx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(txt)}</text>`;
        });
      }
      const rows = points.map((p) => `<tr><td>${esc(dateLong(p.date))}</td><td>${esc(exact(p.value, cur))}</td></tr>`).join('');
      container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(label)} : ${points.length} points, de ${esc(dateLong(points[0].date))} à ${esc(dateLong(points[points.length - 1].date))}">
        <g class="axis">${grid}</g><path class="area" d="${area}"/><path class="line" d="${line}"/>
        <line class="cross" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/><circle class="dot" r="5" visibility="hidden"/></svg>
        <div class="tooltip" hidden></div>
        <table class="sr-only"><caption>${esc(label)}</caption><thead><tr><th>Date</th><th>Valeur</th></tr></thead><tbody>${rows}</tbody></table>`;
      const svg = container.querySelector('svg');
      const cross = svg.querySelector('.cross'), dot = svg.querySelector('.dot'), tip = container.querySelector('.tooltip');
      let active = -1;
      const show = (i) => {
        active = Math.max(0, Math.min(points.length - 1, i));
        const [px, py] = [x(points[active].date), y(points[active].value)];
        cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('visibility', 'visible');
        const prev = active > 0 ? points[active].value - points[active - 1].value : null;
        tip.innerHTML = `${esc(dateLong(points[active].date))}<b>${esc(money(points[active].value, cur))}</b>${prev ? `<span>${esc(money(prev, cur, { sign: true }))} depuis le point précédent</span>` : ''}`;
        tip.hidden = false;
        const scale = svg.getBoundingClientRect().width / W;
        let left = px * scale;
        left = Math.max(tip.offsetWidth / 2, Math.min(container.clientWidth - tip.offsetWidth / 2, left));
        tip.style.left = left + 'px';
        tip.style.top = py * scale + 'px';
      };
      const hide = () => { active = -1; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; };
      const nearest = (clientX) => {
        const r = svg.getBoundingClientRect();
        const mx = ((clientX - r.left) / r.width) * W;
        let best = 0, bd = Infinity;
        points.forEach((p, i) => { const dd = Math.abs(x(p.date) - mx); if (dd < bd) { bd = dd; best = i; } });
        return best;
      };
      svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
      svg.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
      svg.addEventListener('pointerleave', hide);
      container.tabIndex = 0;
      container.onkeydown = (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(active < 0 ? points.length - 1 : active + (e.key === 'ArrowRight' ? 1 : -1)); }
        else if (e.key === 'Escape') hide();
      };
      container.onblur = hide;
    };
    draw();
    state.charts.push(draw);
  }

  function spark(series) {
    if (!series || series.length < 2) return '';
    const vals = series.map((s) => s[1]);
    const min = Math.min(...vals), max = Math.max(...vals);
    const W = 70, H = 22;
    const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * (W - 2) + 1).toFixed(1)},${(H - 2 - ((v - min) / (max - min || 1)) * (H - 4)).toFixed(1)}`).join(' ');
    return raw(`<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`);
  }

  function bars(items, { total, targets = false, liability = false, empty = 'Rien à afficher.', lead = null } = {}) {
    const rows = items.filter((i) => i.value !== 0 || (targets && i.target_pct));
    if (!rows.length) return html`<p class="muted">${empty}</p>`;
    const maxPct = Math.max(...rows.map((i) => Math.max(total ? i.value / total : 0, i.target_pct || 0)), 0.0001);
    return html`<div class="bars ${liability ? 'liability' : ''}">${rows.map((i) => {
      const share = total ? i.value / total : 0;
      const hasTarget = targets && i.target_pct !== null && i.target_pct !== undefined;
      const sub = hasTarget ? html`${pct(share)}, cible ${pct(i.target_pct, { digits: 0 })}` : pct(share);
      const right = hasTarget && Math.abs(i.gap) >= 100
        ? html`<span>${i.gap > 0 ? 'manque' : 'excédent'} ${money(Math.abs(i.gap))}</span>`
        : html`<span>${i.count} avoir${i.count > 1 ? 's' : ''}</span>`;
      return html`<div class="bar-row">
        <div class="label">${lead ? lead(i) : ''}<div class="txt"><b>${i.label || i.name}</b><span>${sub}</span></div></div>
        <div class="track" aria-hidden="true"><div class="fill" style="width:${((share / maxPct) * 100).toFixed(2)}%"></div>${hasTarget && i.target_pct ? html`<div class="target" style="left:${((i.target_pct / maxPct) * 100).toFixed(2)}%"></div>` : ''}</div>
        <div class="value"><b>${money(i.value)}</b>${right}</div>
      </div>`;
    })}</div>`;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Retours visuels : messages, dialogues
  // ---------------------------------------------------------------------------------------------------------
  function toast(message, type = 'ok') {
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.innerHTML = part(html`${icon(type === 'error' ? 'alert' : 'check')}<span>${message}</span>`);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 3200);
  }
  const fail = (err) => toast(err.message || String(err), 'error');

  const modal = () => $('#modal');
  // Une seule fenêtre <dialog> sert à tout. Remplacer son contenu ne la referme pas : l'événement « close »
  // est asynchrone et viderait sinon la nouvelle fenêtre (bouton Modifier, confirmations, codes de secours).
  function openDialog(content, { drawer = false, onClose } = {}) {
    const d = modal();
    const previous = d._onClose;
    d._onClose = null;
    if (previous) previous();
    d.className = drawer ? 'drawer' : '';
    d.innerHTML = part(content);
    d._onClose = onClose || null;
    d.scrollTop = 0;
    if (!d.open) d.showModal();
    const first = d.querySelector('[autofocus]') || d.querySelector('input:not([type=hidden]), select, textarea, button');
    if (first) first.focus();
    return d;
  }
  const closeDialog = () => { if (modal().open) modal().close(); };
  modal().addEventListener('close', () => {
    const d = modal();
    if (d.open) return; // rouverte avant la livraison de l'événement
    const cb = d._onClose;
    d._onClose = null;
    d.innerHTML = '';
    if (cb) cb();
  });
  modal().addEventListener('click', (e) => { if (e.target === modal()) closeDialog(); });

  function dialogHead(title, sub, lead = '') {
    return html`<div class="dialog-head"><div class="dh">${lead}<div><h2 id="modal-title">${title}</h2>${sub ? html`<p>${sub}</p>` : ''}</div></div>
      <button class="btn icon ghost" type="button" data-action="close-dialog" aria-label="Fermer">${icon('close')}</button></div>`;
  }

  function confirmDialog({ title, message, confirm = 'Confirmer', danger = false }) {
    return new Promise((resolve) => {
      let answered = false;
      const d = openDialog(html`<form class="dialog-body" method="dialog">${dialogHead(title)}<p>${message}</p>
        <div class="form-actions"><button class="btn" value="no" type="submit">Annuler</button><button class="btn ${danger ? 'danger' : 'primary'}" value="yes" type="submit" autofocus>${confirm}</button></div></form>`,
      { onClose: () => { if (!answered) resolve(false); } });
      d.querySelector('form').addEventListener('submit', (e) => { answered = true; resolve(e.submitter && e.submitter.value === 'yes'); });
    });
  }

  function passwordDialog({ title, message, confirm = 'Valider' }) {
    return new Promise((resolve) => {
      let answered = false;
      const d = openDialog(html`<form class="dialog-body">${dialogHead(title)}<p class="muted">${message}</p>
        <label class="field"><span>Votre mot de passe</span><input class="input" type="password" name="password" autocomplete="current-password" required autofocus></label>
        <div class="form-actions"><button class="btn" type="button" data-action="close-dialog">Annuler</button><button class="btn primary" type="submit">${confirm}</button></div></form>`,
      { onClose: () => { if (!answered) resolve(null); } });
      d.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); answered = true; const v = e.target.password.value; closeDialog(); resolve(v); });
    });
  }

  function formData(form) {
    const out = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    }
    return out;
  }

  async function withBusy(button, fn) {
    if (button) button.disabled = true;
    try { return await fn(); } finally { if (button) button.disabled = false; }
  }

  function download(name, text, type = 'text/plain') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Écrans d'accès : installation, connexion, double authentification
  // ---------------------------------------------------------------------------------------------------------
  const app = $('#app');

  function gate(content) {
    app.innerHTML = part(html`<main class="gate">${engraving()}<div class="gate-card">
      <a class="mark" href="#/">${MARK}<div><b>Vigie Patrimoine</b><span>Vue d'ensemble privée</span></div></a>${content}</div></main>`);
  }

  function showSetup() {
    if (!state.boot.setup_allowed) {
      gate(html`<h1>Créez le compte administrateur depuis votre réseau local</h1>
        <p class="lead">Par sécurité, le premier compte ne peut pas être créé à travers Cloudflare Tunnel. Ouvrez Vigie avec l'adresse locale du serveur, par exemple <b>http://192.168.1.10:8289</b>, puis revenez ici.</p>`);
      return;
    }
    const cur = state.boot.currencies.map((c) => html`<option ${c === 'EUR' ? 'selected' : ''}>${c}</option>`);
    gate(html`<div><h1>Bienvenue</h1><p class="lead">Créez le compte administrateur. Il pourra ensuite inviter d'autres personnes.</p></div>
      <form class="form" id="setup-form">
        ${nameFields({}, true)}
        <label class="field"><span>Nom d'utilisateur</span><input class="input" name="username" autocomplete="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9._@\\-]+"><small>Lettres sans accent, chiffres et . _ @ -</small></label>
        <label class="field"><span>Mot de passe</span><input class="input" type="password" name="password" autocomplete="new-password" required minlength="10"><small>10 caractères minimum. Une phrase facile à retenir est idéale.</small></label>
        <label class="field"><span>Confirmation du mot de passe</span><input class="input" type="password" name="confirm" autocomplete="new-password" required minlength="10"></label>
        <label class="field"><span>Devise de référence</span><select class="select" name="base_currency">${cur}</select><small>Tous les totaux seront exprimés dans cette devise.</small></label>
        <p class="error-text" id="setup-error" hidden></p>
        <button class="btn primary" type="submit">${icon('crown')}Créer mon compte administrateur</button>
      </form>`);
    $('#setup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const errEl = $('#setup-error');
      if (f.password !== f.confirm) { errEl.textContent = 'Les deux mots de passe ne correspondent pas.'; errEl.hidden = false; return; }
      await withBusy(e.submitter, async () => {
        try {
          const r = await api('POST', '/api/auth/setup', f);
          state.user = r.user;
          location.hash = '#/';
          await boot();
        } catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
      });
    });
  }

  function showLogin(message, username = '') {
    gate(html`<div><h1>Connexion</h1>${message ? html`<p class="lead">${message}</p>` : ''}</div>
      <form class="form" id="login-form">
        <label class="field"><span>Nom d'utilisateur</span><input class="input" name="username" autocomplete="username" required value="${username}" ${username ? '' : raw('autofocus')}></label>
        <label class="field"><span>Mot de passe</span><input class="input" type="password" name="password" autocomplete="current-password" required ${username ? raw('autofocus') : ''}></label>
        <p class="error-text" id="login-error" role="alert" hidden></p>
        <button class="btn primary" type="submit">${icon('login')}Se connecter</button>
      </form>
      ${state.boot && state.boot.password_reset ? html`<button class="link-btn" type="button" id="forgot-link">Mot de passe oublié ?</button>`
        : html`<p class="small muted">Mot de passe oublié ? Demandez à un administrateur de Vigie de le réinitialiser.</p>`}`);
    const forgot = $('#forgot-link');
    if (forgot) forgot.addEventListener('click', () => showForgot($('#login-form').username.value.trim()));
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $('#login-error');
      await withBusy(e.submitter, async () => {
        try {
          const r = await api('POST', '/api/auth/login', formData(e.target));
          if (r.totp_required) return showTotp(r.challenge);
          await boot();
        } catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
      });
    });
  }

  // --- Écrans ouverts depuis un e-mail : mot de passe oublié, invitation, nouveau mot de passe ---------------------
  // Le jeton est retiré de l'adresse (et de l'historique) dès la lecture du lien.
  function gateRoute() {
    const m = /^#\/(invitation|mot-de-passe)\/([A-Za-z0-9_-]{30,100})$/.exec(location.hash);
    return m ? { kind: m[1], token: m[2] } : null;
  }
  function gateError(title, message) {
    gate(html`<div><h1>${title}</h1><p class="lead">${message}</p></div>
      <button class="btn primary" type="button" id="gate-login">${icon('login')}Aller à la connexion</button>`);
    $('#gate-login').addEventListener('click', () => showLogin());
  }

  function showForgot(prefill = '') {
    gate(html`<div><h1>Mot de passe oublié</h1><p class="lead">Indiquez votre nom d'utilisateur ou votre adresse e-mail : vous recevrez un lien pour choisir un nouveau mot de passe.</p></div>
      <form class="form" id="forgot-form">
        <label class="field"><span>Nom d'utilisateur ou adresse e-mail</span><input class="input" name="login" autocomplete="username" required maxlength="254" value="${prefill}" autofocus></label>
        <p class="error-text" role="alert" hidden></p>
        <button class="btn primary" type="submit">${icon('send')}Recevoir le lien</button>
      </form>
      <button class="link-btn" type="button" id="back-login">Retour à la connexion</button>`);
    $('#back-login').addEventListener('click', () => showLogin());
    $('#forgot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = e.target.querySelector('.error-text');
      await withBusy(e.submitter, async () => {
        try {
          const r = await api('POST', '/api/auth/forgot', formData(e.target));
          gate(html`<div><h1>Vérifiez vos e-mails</h1><p class="lead">${r.message}</p></div>
            <p class="small muted">Rien reçu après quelques minutes ? Regardez dans les courriers indésirables, ou demandez à un administrateur.</p>
            <button class="btn" type="button" id="back-login">${icon('login')}Retour à la connexion</button>`);
          $('#back-login').addEventListener('click', () => showLogin());
        } catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
      });
    });
  }

  async function showInvitation(token) {
    gate(html`<p class="loading">Vérification de l'invitation…</p>`);
    let inv;
    try { inv = await api('POST', '/api/auth/invitation', { token }); } catch (err) { gateError('Invitation expirée', err.message); return; }
    gate(html`<div><h1>Bienvenue sur Vigie</h1><p class="lead">${inv.invited_by ? `${inv.invited_by} vous invite` : 'Vous êtes invité'} avec le rôle <b>${ROLE[inv.role]}</b> : ${ROLE_HINT[inv.role].toLowerCase()}. Créez votre compte pour <b>${inv.email}</b>.</p></div>
      <form class="form" id="invite-accept">
        ${nameFields({ first_name: inv.first_name, last_name: inv.last_name }, !inv.first_name)}
        <label class="field"><span>Nom d'utilisateur</span><input class="input" name="username" autocomplete="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9._@\\-]+" value="${inv.suggested_username}" ${inv.first_name ? raw('autofocus') : ''}><small>Pour vous connecter. Lettres sans accent, chiffres et . _ @ -</small></label>
        <label class="field"><span>Mot de passe</span><input class="input" type="password" name="password" autocomplete="new-password" required minlength="10"><small>10 caractères minimum. Une phrase facile à retenir est idéale.</small></label>
        <label class="field"><span>Confirmation du mot de passe</span><input class="input" type="password" name="confirm" autocomplete="new-password" required minlength="10"></label>
        ${inv.require_2fa ? html`<div class="notice info">${icon('shield')}<div>La double authentification est obligatoire sur ce serveur : vous l'activerez juste après, avec une application comme Aegis, 2FAS ou Google Authenticator.</div></div>` : ''}
        <p class="error-text" role="alert" hidden></p>
        <button class="btn primary" type="submit">${icon('check')}Créer mon compte</button>
        <p class="small muted">Lien valable jusqu'au ${dateTime(inv.expires_at)}.</p>
      </form>`);
    $('#invite-accept').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const errEl = e.target.querySelector('.error-text');
      if (f.password !== f.confirm) { errEl.textContent = 'Les deux mots de passe ne correspondent pas.'; errEl.hidden = false; return; }
      await withBusy(e.submitter, async () => {
        try {
          await api('POST', '/api/auth/invitation/accept', { ...f, token });
          history.replaceState(null, '', '#/');
          await boot();
          toast('Bienvenue ! Votre compte est créé.');
        } catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
      });
    });
  }

  async function showReset(token) {
    gate(html`<p class="loading">Vérification du lien…</p>`);
    let info;
    try { info = await api('POST', '/api/auth/reset/check', { token }); } catch (err) { gateError('Lien expiré', err.message); return; }
    gate(html`<div><h1>Nouveau mot de passe</h1><p class="lead">Choisissez le nouveau mot de passe du compte <b>${info.username}</b>.</p></div>
      <form class="form" id="reset-form">
        <input type="text" name="username" value="${info.username}" autocomplete="username" hidden>
        <label class="field"><span>Nouveau mot de passe</span><input class="input" type="password" name="password" autocomplete="new-password" required minlength="10" autofocus><small>10 caractères minimum. Toutes vos sessions ouvertes seront fermées.</small></label>
        <label class="field"><span>Confirmation</span><input class="input" type="password" name="confirm" autocomplete="new-password" required minlength="10"></label>
        ${info.totp_enabled ? html`<p class="small muted">${il('shield', 'La double authentification restera demandée à la connexion.')}</p>` : ''}
        <p class="error-text" role="alert" hidden></p>
        <button class="btn primary" type="submit">${icon('key')}Enregistrer le mot de passe</button>
        <p class="small muted">Lien valable jusqu'au ${dateTime(info.expires_at)}.</p>
      </form>`);
    $('#reset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const errEl = e.target.querySelector('.error-text');
      if (f.password !== f.confirm) { errEl.textContent = 'Les deux mots de passe ne correspondent pas.'; errEl.hidden = false; return; }
      await withBusy(e.submitter, async () => {
        try {
          const r = await api('POST', '/api/auth/reset', { token, password: f.password });
          state.user = null;
          showLogin('Mot de passe modifié. Connectez-vous avec votre nouveau mot de passe.', r.username);
        } catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
      });
    });
  }

  function showTotp(challenge) {
    gate(html`<div><h1>Double authentification</h1><p class="lead">Saisissez le code à 6 chiffres affiché par votre application d'authentification, ou l'un de vos codes de secours.</p></div>
      <form class="form" id="totp-form">
        <label class="field"><span>Code</span><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="12" autofocus></label>
        <p class="error-text" id="totp-error" role="alert" hidden></p>
        <button class="btn primary" type="submit">${icon('shield')}Valider</button>
        <button class="btn ghost" type="button" id="totp-back">Revenir à la connexion</button>
      </form>`);
    $('#totp-back').addEventListener('click', () => showLogin());
    $('#totp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $('#totp-error');
      await withBusy(e.submitter, async () => {
        try {
          await api('POST', '/api/auth/totp', { challenge, code: e.target.code.value });
          await boot();
        } catch (err) {
          if (err.code === 'challenge_expired') return showLogin(err.message);
          errEl.textContent = err.message; errEl.hidden = false; e.target.code.select();
        }
      });
    });
  }

  let lostShown = false;
  function sessionLost() {
    if (lostShown) return;
    lostShown = true;
    closeDialog();
    state.user = null;
    state.logoVersions = null;
    showLogin('Votre session a expiré. Reconnectez-vous pour continuer.');
  }

  // ---------------------------------------------------------------------------------------------------------
  // Charpente et navigation
  // ---------------------------------------------------------------------------------------------------------
  const PAGES = {
    '': { title: 'Tableau de bord', icon: 'dashboard', render: pageDashboard },
    avoirs: { title: 'Avoirs', icon: 'holdings', render: pageHoldings },
    partages: { title: 'Partages immobiliers', icon: 'users', render: pagePropertyShares },
    actualiser: { title: 'Mise à jour rapide', icon: 'update', render: pageQuick, edit: true },
    categories: { title: 'Catégories', icon: 'categories', render: pageCategories },
    reglages: { title: 'Réglages', icon: 'settings', render: pageSettings },
    compte: { title: 'Mon compte', icon: 'account', render: pageAccount },
    utilisateurs: { title: 'Utilisateurs', icon: 'users', render: pageUsers, admin: true },
    journal: { title: 'Journal', icon: 'journal', render: pageAudit, admin: true },
    logos: { title: 'Logos des établissements', icon: 'bank', render: pageLogos, admin: true, parent: 'reglages' },
  };

  function shell() {
    const u = state.user;
    const only2fa = state.boot.needs_2fa_setup;
    const link = (key) => {
      const p = PAGES[key];
      if ((p.admin && !isAdmin()) || (p.edit && !canEdit())) return '';
      if (only2fa && key !== 'compte') return '';
      return html`<a href="#/${key}" data-nav="${key}">${icon(p.icon)}<span class="txt">${p.title}</span></a>`;
    };
    app.innerHTML = part(html`<div class="shell">
      <aside class="rail" id="rail">
        <a class="mark" href="#/">${MARK}<div><b>Vigie</b><span>Patrimoine</span></div></a>
        <button class="btn icon ghost menu-toggle" type="button" data-action="toggle-menu" aria-expanded="false" aria-controls="rail-menu" aria-label="Ouvrir le menu"><span class="when-closed">${icon('menu')}</span><span class="when-open">${icon('close')}</span></button>
        <div class="rail-menu" id="rail-menu">
          <nav class="nav" aria-label="Navigation principale">
            ${link('')}${link('avoirs')}${link('partages')}${link('actualiser')}${link('categories')}${link('reglages')}
            <div class="sep" role="presentation"></div>
            ${link('compte')}${link('utilisateurs')}${link('journal')}
          </nav>
          <div class="rail-foot">
            <div class="who"><span class="avatar" aria-hidden="true">${initials(u)}</span><div><b>${u.display_name}</b><span>${ROLE[u.role]}</span></div></div>
            <button class="btn ghost small" type="button" data-action="install-app" data-install-btn ${pwa.state() === 'prompt' ? '' : raw('hidden')}>${icon('download')}<span class="txt">Installer l'application</span></button>
            <button class="btn ghost small" type="button" data-action="logout">${icon('logout')}<span class="txt">Se déconnecter</span></button>
            <span class="version">Version ${state.boot.version}</span>
          </div>
        </div>
      </aside>
      <main class="main" id="main" tabindex="-1">
        <header class="topbar"><div class="title"><h1 id="page-title"></h1><p id="page-sub"></p></div><div class="tools" id="page-tools"></div></header>
        <div class="page" id="page"></div>
      </main>
    </div>`);
  }

  function parseRoute() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name = '', arg] = h.split('/');
    return { name: PAGES[name] ? name : '', arg };
  }

  function setHeader(title, sub = '', tools = '') {
    $('#page-title').textContent = title;
    $('#page-sub').textContent = sub;
    $('#page-tools').innerHTML = part(tools);
    document.title = `${title} | Vigie Patrimoine`;
  }

  const discretButton = () => html`<button class="btn icon" type="button" data-action="toggle-discret" aria-pressed="${state.discret}" title="${state.discret ? 'Afficher les montants' : 'Masquer les montants'}" aria-label="${state.discret ? 'Afficher les montants' : 'Masquer les montants'}">${icon(state.discret ? 'eyeOff' : 'eye')}</button>`;

  let renderToken = 0;
  async function render() {
    if (!state.user) return;
    if (!$('#page')) shell();
    let route = parseRoute();
    if (state.boot.needs_2fa_setup && route.name !== 'compte') { location.hash = '#/compte'; return; }
    const page = PAGES[route.name];
    if ((page.admin && !isAdmin()) || (page.edit && !canEdit())) { location.hash = '#/'; return; }
    const navKey = page.parent ?? route.name;
    $$('[data-nav]').forEach((a) => (a.dataset.nav === navKey ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    if (!state.logoVersions && !state.boot.needs_2fa_setup) await loadLogoVersions();
    const token = ++renderToken;
    state.charts = [];
    const el = $('#page');
    setHeader(page.title);
    el.innerHTML = '<p class="loading">Chargement…</p>';
    try {
      await page.render(el, route, () => token === renderToken);
    } catch (err) {
      if (token !== renderToken || err.status === 401) return;
      el.innerHTML = part(html`<div class="notice">${icon('alert')}<div>${err.message}</div></div>`);
    }
  }
  const rerender = () => render();

  // ---------------------------------------------------------------------------------------------------------
  // Tableau de bord
  // ---------------------------------------------------------------------------------------------------------
  function groupLead(kind, g) {
    if (kind === 'currency') return html`<span class="pict neutral code" aria-hidden="true">${g.label}</span>`;
    if (kind === 'owner') return g.key === '—' ? pict('user', 'neutral') : avatar(g.label, 'pictsize');
    return g.key === '—' ? pict('cube', 'neutral') : instLogo(g.label, 's36');
  }

  async function pageDashboard(el, route, current) {
    const [d, h] = await Promise.all([api('GET', '/api/dashboard'), api('GET', `/api/history?range=${state.range}`)]);
    if (!current()) return;
    state.base = d.base_currency;
    setHeader('Tableau de bord', `Au ${dateLong(d.today)}`, discretButton());

    if (d.counts.total === 0) {
      el.innerHTML = part(html`<section class="hero">${engraving()}
        <p class="hero-label">Patrimoine net</p><p class="hero-value">${money(0)}</p>
        <div class="empty" style="justify-items:start;text-align:left;padding:8px 0 18px">${pict('stack', 'lg')}<h2>Commencez par vos comptes et vos biens</h2>
        <p>Ajoutez chaque avoir avec sa valeur du jour : comptes, livrets, assurance-vie, bourse, immobilier, crédits. Vigie conserve chaque mise à jour pour tracer l'évolution de votre patrimoine.</p>
        ${canEdit() ? html`<button class="btn primary" data-action="new-holding">${icon('plus')}Ajouter un avoir</button>` : html`<p>Un éditeur ou un administrateur doit d'abord saisir les avoirs.</p>`}</div></section>`);
      return;
    }

    const heroParts = state.discret ? null : nf(d.base_currency, 0).formatToParts(d.totals.net / 100);
    const heroNumber = heroParts
      ? html`${heroParts.filter((p) => p.type !== 'currency' && p.type !== 'literal').map((p) => (p.type === 'minusSign' ? '−' : p.value)).join('')}<span class="cur">${symbol(d.base_currency)}</span>`
      : html`${MASK}<span class="cur">${symbol(d.base_currency)}</span>`;
    const delta = (v, label) => {
      if (!v) return '';
      const cls = v.delta > 0 ? 'pos' : v.delta < 0 ? 'neg' : 'muted';
      return html`<span class="delta"><span class="${cls}">${v.delta !== 0 ? icon(v.delta > 0 ? 'up' : 'down') : ''}</span><b class="${cls}">${money(v.delta, d.base_currency, { sign: true })}</b><span class="${cls}">${v.pct !== null ? `(${pct(v.pct, { sign: true })})` : ''}</span><span class="muted">${label}</span></span>`;
    };
    const ranges = [['3m', '3 mois'], ['6m', '6 mois'], ['1y', '1 an'], ['3y', '3 ans'], ['all', 'Tout']];
    const assetsCats = d.categories.filter((c) => c.kind === 'asset');
    const liabCats = d.categories.filter((c) => c.kind === 'liability');
    const targets = assetsCats.some((c) => c.target_pct !== null);
    const L = d.liquidity, la = d.totals.assets || 1;
    const groupLabels = { institution: 'Établissement', owner: 'Titulaire', currency: 'Devise' };

    el.innerHTML = part(html`
      ${d.missing_rates.length ? html`<div class="notice">${icon('alert')}<div>Taux de change manquant pour ${d.missing_rates.join(', ')} : ces avoirs ne sont pas comptés dans les totaux.</div><a class="btn small" href="#/reglages/devises">Saisir les taux</a></div>` : ''}
      <section class="hero" aria-labelledby="net-label">${engraving()}
        <div class="hero-top">
          <div><p class="hero-label" id="net-label">Patrimoine net</p><p class="hero-value">${heroNumber}</p>
            <div class="deltas">${delta(d.variations.month, 'sur 1 mois')}${delta(d.variations.year, 'sur 1 an')}${delta(d.variations.ytd, 'depuis janvier')}</div></div>
          <div class="seg" role="group" aria-label="Période de la courbe">${ranges.map(([k, l]) => html`<button type="button" data-action="range" data-range="${k}" aria-pressed="${state.range === k}">${l}</button>`)}</div>
        </div>
        <div class="chart" id="net-chart"></div>
      </section>
      <div class="cols">
        <section class="section">
          <div class="section-head">${h2i('categories', 'Répartition des actifs')}${targets ? html`<div class="legend-inline"><span><i class="sw-bar"></i>Part actuelle</span><span><i class="sw-target"></i>Cible</span></div>` : html`<a class="small" href="#/categories">Définir des cibles</a>`}</div>
          <div class="panel">${bars(assetsCats.map((c) => ({ ...c, label: c.name })), { total: d.totals.assets, targets: true, empty: 'Aucun actif valorisé.', lead: (c) => catPict(c) })}</div>
          ${liabCats.some((c) => c.value) ? html`<div class="section-head">${h2i('debt', 'Passifs')}</div><div class="panel">${bars(liabCats.map((c) => ({ ...c, label: c.name })), { total: d.totals.liabilities, liability: true, lead: (c) => catPict(c) })}</div>` : ''}
        </section>
        <aside class="stack">
          <section class="section">${h2i('info', 'En bref')}<div class="panel figures">
            <div class="figure">${il('stack', 'Total des actifs')}<b>${money(d.totals.assets)}</b></div>
            <div class="figure">${il('debt', 'Total des passifs')}<b>${money(d.totals.liabilities ? -d.totals.liabilities : 0)}</b></div>
            <div class="figure">${il('drop', 'Disponible rapidement')}<b>${money(L.immediate)}</b></div>
            <div class="figure">${il('holdings', 'Avoirs suivis')}<b>${d.counts.open}</b></div>
          </div></section>
          <section class="section">${h2i('drop', 'Liquidité des actifs')}<div class="panel">
            <div class="strip" role="img" aria-label="Disponible ${pct(L.immediate / la)}, sous quelques semaines ${pct(L.short / la)}, bloqué ${pct(L.locked / la)}">
              ${['immediate', 'short', 'locked'].map((k, i) => (L[k] > 0 ? html`<span class="l${i + 1}" style="flex:${L[k]}"></span>` : ''))}</div>
            <div class="liq-legend">${['immediate', 'short', 'locked'].map((k, i) => html`<div><i style="background:var(--liq-${i + 1})"></i>${il(LIQ_ICON[k], LIQ[k])}<b>${money(L[k])}</b><span class="pct">${pct(L[k] / la, { digits: 0 })}</span></div>`)}</div>
          </div></section>
          <section class="section"><div class="section-head">${h2i('bell', 'À actualiser')}${d.stale.length && canEdit() ? html`<a class="small" href="#/actualiser">Tout mettre à jour</a>` : ''}</div><div class="panel">
            ${d.stale.length ? html`<div class="reminders">${d.stale.slice(0, 6).map((s) => html`<a class="reminder" href="#/avoirs/${s.id}"><span class="rl">${catPict({ icon: s.category_icon, kind: s.kind }, 'sm')}<span><b>${s.name}</b><br><span class="small muted">${s.category}</span></span></span><span class="small muted nowrap">${il('clock', s.last_date ? ago(s.age_days) : 'aucune valeur')}</span></a>`)}</div>${d.stale.length > 6 ? html`<p class="small muted" style="margin-top:8px">et ${d.stale.length - 6} autre(s)</p>` : ''}`
              : html`<p class="muted">${il('check', `Toutes les valeurs ont moins de ${d.stale_days} jours.`)}</p>`}
          </div></section>
        </aside>
      </div>
      <section class="section">
        <div class="section-head">${h2i({ institution: 'bank', owner: 'users', currency: 'exchange' }[state.breakdown], `Actifs par ${groupLabels[state.breakdown].toLowerCase()}`)}
          <div class="seg" role="group" aria-label="Regrouper par">${Object.entries(groupLabels).map(([k, l]) => html`<button type="button" data-action="breakdown" data-key="${k}" aria-pressed="${state.breakdown === k}">${l}</button>`)}</div></div>
        <div class="panel">${bars(d.groups[state.breakdown], { total: d.totals.assets, lead: (g) => groupLead(state.breakdown, g) })}</div>
      </section>`);
    lineChart($('#net-chart'), h.points.map((p) => ({ date: p.date, value: p.net })), { label: 'Évolution du patrimoine net', height: 240 });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Avoirs
  // ---------------------------------------------------------------------------------------------------------
  let holdingsCache = null;
  async function pageHoldings(el, route, current) {
    const v = await api('GET', '/api/holdings');
    if (!current()) return;
    holdingsCache = v;
    state.base = v.base_currency;
    setHeader('Avoirs', 'Comptes, placements, biens et crédits', html`${discretButton()}${canEdit() ? html`<button class="btn primary" data-action="new-holding">${icon('plus')}Ajouter un avoir</button>` : ''}`);
    const draw = () => {
      const q = state.filter.trim().toLowerCase();
      const visible = v.holdings.filter((h) => (state.showClosed || !h.closed_at) && (!q || [h.name, h.institution, h.owner, h.notes].some((s) => (s || '').toLowerCase().includes(q))));
      const closedCount = v.holdings.filter((h) => h.closed_at).length;
      const groups = v.categories.map((c) => ({ c, items: visible.filter((h) => h.category_id === c.id) })).filter((g) => g.items.length);
      $('#holdings-list').innerHTML = part(groups.length ? groups.map(({ c, items }) => {
        const sum = items.reduce((s, h) => s + (h.closed_at ? 0 : h.value_base || 0), 0);
        return html`<section class="panel flush group" aria-label="${c.name}">
          <div class="group-head"><div class="gh">${catPict(c)}<div><h3>${c.name}</h3><span class="sub">${c.kind === 'liability' ? 'Passif' : c.description || ''}</span></div></div><b>${money(c.kind === 'liability' ? -sum : sum)}</b></div>
          ${items.map((h) => {
            const stale = !h.closed_at && !h.schedule && v.stale_days > 0 && (h.age_days === null || h.age_days > v.stale_days);
            const diff = h.previous_cents !== null && h.value_cents !== null
              ? Math.round(h.value_cents * (h.total_ownership_bp ?? h.property?.ownership_bp ?? 10000) / 10000)
                - Math.round(h.previous_cents * (h.total_ownership_bp ?? h.property?.ownership_bp ?? 10000) / 10000)
              : null;
            const when = h.closed_at ? html`<span class="tag">${icon('lock')}Clôturé le ${dateFr(h.closed_at)}</span>`
              : h.schedule ? (h.schedule.done ? html`<span class="tag brand">${icon('check')}Remboursé</span>` : html`<span class="tag brand">${icon('calendar')}Échéancier</span><br>prochaine le ${dateFr(h.schedule.next_date)}`)
              : stale ? html`<span class="tag stale">${icon('clock')}À actualiser</span><br>${h.last_date ? ago(h.age_days) : 'sans valeur'}` : html`Mis à jour ${ago(h.age_days)}`;
            return html`<button type="button" class="holding ${h.closed_at ? 'closed' : ''}" data-action="open-holding" data-id="${h.id}">
              <span class="name">${h.institution ? instLogo(h.institution) : pict(catIconKey(c), 'neutral md')}<span class="nt"><b>${h.name}</b><span class="meta">${h.institution ? html`<span>${h.institution}</span>` : ''}${h.owner ? il('user', h.owner) : ''}${!h.institution && !h.owner ? il(LIQ_ICON[h.liquidity], LIQ[h.liquidity]) : ''}${h.schedule && !h.closed_at ? html`<span class="m-only">${il('calendar', h.schedule.done ? 'Remboursé' : 'Échéancier')}</span>` : ''}</span></span></span>
              ${spark(h.spark) || html`<span class="spark"></span>`}
              <span class="when">${when}</span>
              <span class="amount"><b>${h.owned_cents === null ? '—' : money(h.owned_cents, h.currency)}</b>
                ${h.property && h.total_ownership_bp < 10000 ? html`<span class="muted">Votre quote-part : ${h.total_ownership_bp / 100} % du bien (${money(h.value_cents, h.currency)})</span>` : ''}
                ${h.currency !== v.base_currency && h.value_base !== null ? html`<span class="muted">${money(h.value_base)}</span>` : ''}
                ${h.missing_rate ? html`<span class="tag bad">${icon('alert')}Taux ${h.currency} manquant</span>` : ''}
                ${h.latent_gain_cents !== null && h.latent_gain_cents !== undefined ? html`<span class="${h.latent_gain_cents >= 0 ? 'pos' : 'neg'}">Plus-value latente : ${money(h.latent_gain_cents, h.currency, { sign: true })}</span>` : ''}
                ${diff ? html`<span class="${(diff > 0) !== (c.kind === 'liability') ? 'pos' : 'neg'}">${money(diff, h.currency, { sign: true })}</span>` : ''}</span>
            </button>`;
          })}</section>`;
      }) : html`<div class="panel empty">${pict(v.holdings.length ? 'search' : 'holdings', 'lg')}<h2>${v.holdings.length ? 'Aucun avoir ne correspond' : 'Aucun avoir pour le moment'}</h2>
          <p>${v.holdings.length ? 'Modifiez la recherche ou affichez les avoirs clôturés.' : 'Ajoutez vos comptes, placements, biens et crédits avec leur valeur du jour.'}</p>
          ${!v.holdings.length && canEdit() ? html`<button class="btn primary" data-action="new-holding">${icon('plus')}Ajouter un avoir</button>` : ''}</div>`);
      $('#closed-toggle').hidden = closedCount === 0;
      $('#closed-count').textContent = closedCount;
    };
    const gainRows = v.holdings.filter(h => !h.closed_at && h.latent_gain_cents !== null && h.latent_gain_cents !== undefined && h.latent_basis_cents > 0 && h.value_base !== null && (h.owned_cents !== 0 || h.currency === v.base_currency));
    const gainBase = gainRows.reduce((s,h) => s + Math.round(h.latent_gain_cents * (h.owned_cents === 0 ? 1 : h.value_base / h.owned_cents)), 0);
    const basisBase = gainRows.reduce((s,h) => s + Math.round(h.latent_basis_cents * (h.owned_cents === 0 ? 1 : h.value_base / h.owned_cents)), 0);
    el.innerHTML = part(html`<div class="panel"><h2>Plus-values latentes</h2><p class="hero-value ${gainBase >= 0 ? 'pos' : 'neg'}">${money(gainBase, v.base_currency, { sign: true })}</p><p class="muted">${gainRows.length} avoir(s) · ${basisBase ? (gainBase / basisBase * 100).toLocaleString('fr-FR', {maximumFractionDigits:2})+' %' : '—'} · montant brut</p><p class="small muted">Hors fiscalité et mouvements. Les avoirs sans prix de revient ou taux de change sont exclus.</p></div><div class="toolbar">
        <input class="input" type="search" id="holding-search" placeholder="Rechercher un avoir, un établissement…" value="${state.filter}" aria-label="Rechercher">
        <label class="check" id="closed-toggle"><input type="checkbox" id="show-closed" ${state.showClosed ? 'checked' : ''}><span>Afficher les avoirs clôturés (<span id="closed-count"></span>)</span></label>
      </div><div class="stack" id="holdings-list"></div>`);
    $('#holding-search').addEventListener('input', (e) => { state.filter = e.target.value; draw(); });
    $('#show-closed').addEventListener('change', (e) => { state.showClosed = e.target.checked; draw(); });
    draw();
    if (route.arg) openHolding(Number(route.arg));
  }

  // Invitations immobilières : visibles uniquement par le compte destinataire.
  async function pagePropertyShares(el, route, current) {
    const inbox = await api('GET', '/api/property-shares/inbox');
    if (!current()) return;
    setHeader('Partages immobiliers', 'Demandes à approuver et quote-parts reçues sur ce serveur');
    el.innerHTML = part(html`
      <section class="section"><div class="section-head">${h2i('mail', 'Demandes reçues')}</div>
        ${inbox.invitations.length ? inbox.invitations.map((p) => html`<div class="panel form" style="margin-bottom:12px">
          <h3>${p.property_name}</h3>
          <p>${p.sender_name || 'Un administrateur'} vous propose <b>${(p.ownership_bp / 100).toLocaleString('fr-FR')} %</b> de ce bien immobilier. Après acceptation, votre quote-part apparaîtra dans vos avoirs Vigie.</p>
          <p class="small muted">Valable jusqu'au ${dateTime(p.expires_at)}. Aucune quote-part n'est ajoutée avant votre approbation.</p>
          <div class="form-actions" style="justify-content:flex-start">
            <button class="btn primary" data-action="share-decision" data-id="${p.id}" data-decision="accept">${icon('check')}Accepter</button>
            <button class="btn" data-action="share-decision" data-id="${p.id}" data-decision="decline">${icon('close')}Refuser</button>
          </div></div>`) : html`<div class="panel"><p class="muted">Aucune demande de partage en attente pour votre compte.</p></div>`}
      </section>
      <section class="section"><div class="section-head">${h2i('users', 'Quote-parts approuvées')}</div>
        ${inbox.accepted.length ? inbox.accepted.map((p) => html`<div class="panel">
          <b>${p.property_name} — ${(p.ownership_bp / 100).toLocaleString('fr-FR')} %</b>
          <p class="small muted">Cette quote-part figure dans votre compte Vigie avec sa propre valeur patrimoniale. La source reste la fiche et l’estimation du propriétaire initial.</p>
          <div class="form-actions" style="justify-content:flex-start">
            <button class="btn" data-action="open-holding" data-id="${p.holding_id}">${icon('house')}Consulter le bien</button>
            <button class="btn danger" data-action="share-revoke" data-id="${p.id}" data-no-dialog="1">${icon('close')}Renoncer à ma part</button>
          </div></div>`) : html`<div class="panel"><p class="muted">Aucun partage accepté.</p></div>`}
      </section>
      <p class="small muted">Chaque compte Vigie conserve ses propres avoirs. Le bien partagé apparaît ici uniquement après acceptation, à hauteur de votre part. L’accord n’est pas un transfert juridique de propriété.</p>
    `);
  }

  async function sharePropertyForm(holdingId) {
    const [recipients, data] = await Promise.all([
      api('GET', '/api/property-shares/recipients'),
      api('GET', `/api/holdings/${holdingId}/shares`),
    ]);
    const percent = (x) => (x / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
    const dialog = openDialog(html`<div class="dialog-body form">
      ${dialogHead('Partager le bien immobilier', 'Le bien apparaîtra dans les avoirs du compte destinataire après son accord, sans lui ouvrir l’accès à vos autres biens.')}
      <p class="muted">Quote-part initiale : <b>${percent(data.ownership_bp)} %</b> · Déjà acceptée : <b>${percent(data.accepted_bp)} %</b> · Complément disponible : <b>${percent(data.available_bp)} %</b>.</p>
      ${data.shares.length ? html`<div class="panel"><h3>Demandes et approbations</h3>
        ${data.shares.map((share) => html`<div class="row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:8px 0;flex-wrap:wrap">
          <span>${share.recipient_name} : <b>${percent(share.ownership_bp)} %</b> — ${({ pending: 'En attente', accepted: 'Accepté', declined: 'Refusé', revoked: 'Révoqué', expired: 'Expiré' })[share.status]}</span>
          ${['pending', 'accepted'].includes(share.status) ? html`<button class="btn small danger" data-action="share-revoke" data-id="${share.id}">${icon('close')}Révoquer</button>` : ''}
        </div>`)}
      </div>` : ''}
      ${data.available_bp === 0 ? html`<p class="notice">Aucun complément disponible. Pour proposer une quote-part, réduisez d'abord votre propre pourcentage dans la fiche du bien (par exemple 60 % pour proposer 40 %), ou révoquez une proposition existante.</p>` : ''}
      ${!recipients.mail_ready ? html`<p class="notice">Configurez d'abord le serveur SMTP et l'URL publique dans Réglages → Envoi d'e-mails.</p>` : ''}
      ${recipients.mail_ready && data.available_bp > 0 && recipients.recipients.length ? html`
        <form class="form" id="share-request-form">
          <label class="field"><span>Utilisateur du même serveur</span><select class="select" name="recipient_id" required>
            ${recipients.recipients.map((u) => html`<option value="${u.id}">${u.display_name} — ${u.email}</option>`)}
          </select></label>
          <label class="field"><span>Quote-part proposée (%)</span><input class="input" type="number" name="ownership_pct" min="0.01" max="${data.available_bp / 100}" step="0.01" required value="${data.available_bp / 100}">
            <small>Le complément à 100 % est proposé automatiquement. Il peut être réduit.</small></label>
          <div class="form-actions"><button class="btn primary" type="submit">${icon('mail')}Envoyer la demande d'approbation</button></div>
          <p class="error-text" hidden></p>
        </form>` : html`<p class="small muted">Aucun complément disponible ou aucun autre compte éligible.</p>`}
    </div>`);
    const form = $('#share-request-form', dialog);
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await withBusy(e.submitter, async () => {
        try {
          await api('POST', `/api/holdings/${holdingId}/shares`, formData(form));
          toast('Demande de partage envoyée par e-mail.');
          closeDialog();
          sharePropertyForm(holdingId).catch(fail);
        } catch (err) {
          const p = $('.error-text', form); p.textContent = err.message; p.hidden = false;
        }
      });
    });
  }

  // Conserver les notes personnelles et remplacer seulement le précédent bilan automatique.
  // Ne jamais tronquer silencieusement le texte fourni par l'utilisateur.
  function mergeEstimationNote(current, report, max = 1000) {
    if (typeof report !== 'string' || !report.startsWith('[Estimation Vigie]\n') ||
        !report.endsWith('[/Estimation Vigie]')) return null;
    const personal = String(current || '').replace(/\n{0,2}\[Estimation Vigie\][\s\S]*?\[\/Estimation Vigie\]/g, '');
    const combined = personal + (personal ? (personal.endsWith('\n') ? '\n' : '\n\n') : '') + report;
    return combined.length <= max ? combined : null;
  }

  async function holdingForm(existing = null) {
    const [cats, settings] = await Promise.all([api('GET', '/api/categories'), api('GET', '/api/settings')]);
    const h = existing || {};
    const catOptions = (kind, label) => html`<optgroup label="${label}">${cats.categories.filter((c) => c.kind === kind).map((c) => html`<option value="${c.id}" data-liq="${c.default_liquidity}" data-icon="${catIconKey(c)}" data-kind="${c.kind}" data-loan="${isLoanCat(c)}" ${h.category_id === c.id ? 'selected' : ''}>${c.name}</option>`)}</optgroup>`;
    const owners = [...settings.owners];
    if (h.owner && !owners.some((o) => o.toLowerCase() === h.owner.toLowerCase())) owners.push(h.owner);
    const curList = [...new Set([settings.base_currency, ...settings.currencies])];
    const sc = h.schedule || null;
    const property = h.property || null;
    const acquisition = h.acquisition || null;
    const d = openDialog(html`<form class="dialog-body form" id="holding-form">
      ${dialogHead(existing ? `Modifier ${existing.name}` : 'Ajouter un avoir', existing ? '' : 'Un compte, un placement, un bien ou un crédit. Seule sa valeur compte, pas ses mouvements.')}
      <label class="field"><span>Nom</span><input class="input" name="name" required maxlength="80" value="${h.name || ''}" placeholder="Livret A, PEA, Appartement Lyon…" autofocus></label>
      <div class="grid-2">
        <label class="field"><span>Catégorie</span><span class="with-pict"><span data-cat-pict></span><select class="select" name="category_id" required>${catOptions('asset', 'Actifs')}${catOptions('liability', 'Passifs')}</select></span></label>
        <label class="field"><span>Liquidité</span><select class="select" name="liquidity">${Object.entries(LIQ).map(([k, l]) => html`<option value="${k}" ${h.liquidity === k ? 'selected' : ''}>${l}</option>`)}</select></label>
      </div>
      <div class="grid-2">
        <div class="field"><label for="f-institution">Établissement</label>
          <div class="with-pict ac"><span data-inst-preview>${instLogo(h.institution || '', 's36')}</span>
            <input class="input" id="f-institution" name="institution" maxlength="80" value="${h.institution || ''}" autocomplete="off" spellcheck="false"
              role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="inst-list" aria-describedby="inst-hint" placeholder="Banque, courtier, assureur…">
            <ul class="ac-list" id="inst-list" role="listbox" aria-label="Établissements proposés" hidden></ul></div>
          <small id="inst-hint">Suggestions dès 3 lettres, ou saisissez librement.</small></div>
        <label class="field"><span>Titulaire</span><select class="select" name="owner_choice">
          <option value="">Non précisé</option>
          ${owners.map((o) => html`<option value="${o}" ${(h.owner || '').toLowerCase() === o.toLowerCase() ? 'selected' : ''}>${o}</option>`)}
          ${canEdit() ? html`<option value="__new__">Nouveau titulaire…</option>` : ''}
        </select></label>
      </div>
      <label class="field" data-new-owner hidden><span>Nom du nouveau titulaire</span><input class="input" name="owner_new" maxlength="40" autocomplete="off" placeholder="Prénom, enfant, SCI…"></label>
      <fieldset class="mode" data-mode-wrap hidden>
        <legend class="sr-only">Suivi de la valeur</legend>
        <div class="seg seg-radio">
          <label><input type="radio" name="mode" value="auto"><span>${icon('calendar')}Échéancier automatique</span></label>
          <label><input type="radio" name="mode" value="manual"><span>${icon('pencil')}Saisie manuelle</span></label>
        </div>
        <small class="muted" data-mode-hint></small>
      </fieldset>
      <div class="form loan-fields" data-schedule hidden>
        <div class="grid-2">
          <label class="field"><span data-w="principal">Montant prêté</span><input class="input amount" name="sc_principal" inputmode="decimal" autocomplete="off" placeholder="0" value="${sc ? centsInput(sc.principal_cents) : ''}"></label>
          <label class="field"><span data-w="start">Date du versement</span><input class="input" type="date" name="sc_start" value="${sc ? sc.start_date : todayIso()}" max="${todayIso()}"></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Taux annuel</span><span class="suffix"><input class="input amount" name="sc_rate" inputmode="decimal" autocomplete="off" placeholder="0" value="${sc ? String(sc.annual_rate).replace('.', ',') : ''}"><i aria-hidden="true">%</i></span></label>
          <label class="field"><span>Durée</span><span class="suffix"><input class="input amount" name="sc_months" inputmode="numeric" autocomplete="off" placeholder="240" value="${sc ? sc.months : ''}" aria-describedby="sc-years"><i aria-hidden="true">mois</i></span><small id="sc-years" data-years></small></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Remboursement</span><select class="select" name="sc_kind" aria-describedby="sc-kind-hint">${Object.entries(LOAN_KIND).map(([k, l]) => html`<option value="${k}" ${(sc ? sc.kind : 'amortizing') === k ? 'selected' : ''}>${l}</option>`)}</select></label>
          <p class="kind-hint" id="sc-kind-hint" data-kind-hint></p>
        </div>
        <div class="loan-preview" data-preview aria-live="polite"></div>
      </div>
      ${existing ? html`<label class="field"><span>Devise</span><select class="select" name="currency">${curList.map((c) => html`<option ${h.currency === c ? 'selected' : ''}>${c}</option>`)}</select></label>`
        : html`<div class="grid-3 value-row">
        <label class="field" data-manual><span>Valeur actuelle du bien entier</span><span class="estate-value-input"><input class="input amount" name="amount" inputmode="decimal" placeholder="0" autocomplete="off"><button class="btn estimate-magic" type="button" data-estimate hidden title="Estimer à partir des ventes immobilières" aria-label="Estimer la valeur actuelle avec la baguette magique">${icon('magic')}<span>Estimer</span></button></span></label>
        <label class="field"><span>Devise</span><select class="select" name="currency">${curList.map((c) => html`<option ${c === settings.base_currency ? 'selected' : ''}>${c}</option>`)}</select></label>
        <label class="field" data-manual><span>Date de la valeur</span><input class="input" type="date" name="date" value="${todayIso()}" max="${todayIso()}"></label>
      </div><small class="muted" data-manual data-credit-hint hidden>Pour un crédit, indiquez le capital restant dû, en positif.</small>`}
      ${existing ? html`<label class="field" data-real-current hidden><span>Valeur actuelle du bien entier (${h.currency || 'EUR'})</span><span class="estate-value-input"><input class="input amount" name="amount" inputmode="decimal" placeholder="0" autocomplete="off" value="${h.value_cents !== null && h.value_cents !== undefined ? centsInput(h.value_cents) : ''}"><button class="btn estimate-magic" type="button" data-estimate hidden title="Estimer à partir des ventes immobilières" aria-label="Estimer la valeur actuelle avec la baguette magique">${icon('magic')}<span>Estimer</span></button></span></label>` : ''}
      <section class="section real-estate-fields" data-real-estate hidden>
        ${h3i('house', 'Informations immobilières')}
        <div class="grid-2">
          <label class="field"><span>Valeur d'achat du bien entier</span><input class="input amount" name="purchase_amount" inputmode="decimal" placeholder="Ex. 220 000" autocomplete="off" value="${property ? centsInput(property.purchase_cents) : ''}"></label>
          <label class="field"><span>Date d'achat</span><input class="input" name="purchased_at" type="date" max="${todayIso()}" value="${property?.purchased_at || ''}"></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Quote-part de propriété (%)</span><input class="input amount" name="ownership_pct" inputmode="decimal" type="number" min="0.01" max="100" step="0.01" required value="${property ? property.ownership_bp / 100 : 100}"><small>100 % si vous possédez entièrement le bien ; ex. 50 % en indivision.</small></label>
          <p class="small muted">Les valeurs d'achat et actuelle concernent le bien entier. Seule votre quote-part est comptée dans le patrimoine et dans la plus-value latente.</p>
        </div>
        <div class="grid-2">
          <label class="field"><span>Type de bien</span><select class="select" name="property_type"><option value="maison" ${property?.property_type !== 'appartement' ? 'selected' : ''}>Maison</option><option value="appartement" ${property?.property_type === 'appartement' ? 'selected' : ''}>Appartement</option></select></label>
          <label class="field"><span>Surface habitable (m²)</span><input class="input" name="surface_m2" type="number" min="9" max="10000" placeholder="Ex. 85" value="${property?.surface_m2 || ''}"></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Adresse ou commune</span><input class="input" name="property_address" maxlength="180" placeholder="Adresse, code postal, commune" value="${property?.address || ''}"></label>
          <label class="field"><span>État général</span><select class="select" name="property_condition">${[['correct','Correct'],['bon','Bon'],['renove','Rénové'],['neuf','Neuf'],['travaux','Travaux à prévoir'],['a_renover','À rénover']].map(([key,label]) => html`<option value="${key}" ${(property?.condition || 'correct')===key ? 'selected' : ''}>${label}</option>`)}</select></label>
        </div>
        <p class="small muted">La baguette magique utilise l'adresse, le type et la surface pour chercher des ventes comparables DVF. L'adresse est envoyée à GeoRegistry uniquement sur demande.</p>
        <div data-estimate-result role="status" aria-live="polite"></div>
      </section>
      <section class="section" data-acquisition hidden>${h3i('chart', 'Plus-value latente (facultatif)')}
        <div class="grid-2"><label class="field"><span>Prix de revient total</span><input class="input amount" name="acquisition_amount" inputmode="decimal" value="${acquisition ? centsInput(acquisition.purchase_cents) : ''}" placeholder="Ex. 5 000"></label>
        <label class="field"><span>Date d'acquisition</span><input class="input" type="date" name="acquisition_date" max="${todayIso()}" value="${acquisition?.purchased_at || ''}"></label></div>
        <p class="small muted">Variation brute sans prise en compte des mouvements, frais et fiscalité.</p></section>
      <label class="field"><span>Notes</span><textarea class="textarea" name="notes" maxlength="1000">${h.notes || ''}</textarea></label>
      <p class="error-text" hidden></p>
      <div class="form-actions"><button class="btn" type="button" data-action="close-dialog">Annuler</button><button class="btn primary" type="submit">${icon(existing ? 'check' : 'plus')}${existing ? 'Enregistrer' : "Ajouter l'avoir"}</button></div>
    </form>`);
    const form = d.querySelector('form');
    const syncLiq = () => { if (!existing) form.liquidity.value = form.category_id.selectedOptions[0].dataset.liq; };
    const syncPict = () => { const o = form.category_id.selectedOptions[0]; $('[data-cat-pict]', form).innerHTML = part(catPict({ icon: o.dataset.icon, kind: o.dataset.kind })); };
    syncPict();
    institutionAutocomplete(form.institution, $('#inst-list', d), $('[data-inst-preview]', d), settings.institutions);
    form.category_id.addEventListener('change', syncPict);
    form.category_id.addEventListener('change', syncLiq);
    if (!existing) syncLiq();

    // Échéancier automatique : proposé pour les prêts accordés et les crédits.
    const estateSection = $('[data-real-estate]', form);
    const estimateButtons = $$('[data-estimate]', form);
    const acquisitionSection = $('[data-acquisition]', form);
    const syncRealEstate = () => {
      const sel = form.category_id.selectedOptions[0];
      const show = sel.dataset.kind === 'asset' && (['house', 'building'].includes(sel.dataset.icon) || /immobilier|maison|appartement|résidence/i.test(sel.textContent));
      estateSection.hidden = !show;
      $('[data-real-current]', form) && ($('[data-real-current]', form).hidden = !show);
      estimateButtons.forEach((b) => { b.hidden = !show; });
      form.purchase_amount.required = show;
      form.purchased_at.required = show;
      acquisitionSection.hidden = sel.dataset.kind !== 'asset' || show || sel.dataset.loan === 'true' || !!sc;
    };
    form.category_id.addEventListener('change', syncRealEstate);
    form.currency.addEventListener('change', syncRealEstate);
    syncRealEstate();
    estimateButtons.forEach((button) => button.addEventListener('click', async () => {
      const amountInput = $('[name="amount"]', button.closest('.field'));
      const noteInput = form.querySelector('[name="notes"]');
      if (form.currency.value !== 'EUR') return toast('Estimation disponible uniquement pour les biens en euros.');
      if (!form.property_address.value.trim() || !form.surface_m2.value.trim()) return toast('Indiquez une adresse et une surface pour estimer le bien.');
      const request = {
        property_type: form.property_type.value, surface_m2: Number(form.surface_m2.value),
        address: form.property_address.value, condition: form.property_condition.value,
      };
      // Ne pas écraser une valeur saisie manuellement pendant l'appel réseau.
      const amountBeforeRequest = amountInput.value;
      button.disabled = true;
      const output = $('[data-estimate-result]', form);
      output.textContent = 'Recherche des ventes comparables…';
      try {
        const result = await api('POST', '/api/real-estate/estimate', request);
        if (estateSection.hidden || form.currency.value !== 'EUR' ||
            form.property_type.value !== request.property_type || Number(form.surface_m2.value) !== request.surface_m2 ||
            form.property_address.value !== request.address || form.property_condition.value !== request.condition ||
            amountInput.value !== amountBeforeRequest) {
          output.textContent = 'Le bien ou sa valeur actuelle a changé pendant la recherche. Relancez l’estimation pour éviter d’écraser votre saisie.';
          return;
        }
        // Un rapport non conforme ne doit jamais remplacer partiellement le formulaire.
        if (!Number.isSafeInteger(result.estimate_cents) || result.estimate_cents <= 0) {
          output.textContent = 'Le service d’estimation a renvoyé une valeur invalide. Aucune modification effectuée.';
          return;
        }
        const notes = mergeEstimationNote(noteInput.value, result.estimation_note, noteInput.maxLength);
        if (notes === null) {
          output.textContent = 'Pas assez de place dans les notes pour conserver le bilan complet sans effacer vos notes. Raccourcissez vos notes personnelles puis relancez l’estimation. Valeur actuelle inchangée.';
          return;
        }
        const sampleText = result.comparables + ' ventes comparables, fiabilité ' + (result.confidence === 'high' ? 'élevée' : result.confidence === 'medium' ? 'moyenne' : 'faible');
        const methodText = result.method === 'dvf_local_price_m2'
          ? 'Prix médian local : ' + Number(result.price_per_m2).toLocaleString('fr-FR') + ' €/m² × ' + Number(form.surface_m2.value).toLocaleString('fr-FR') + ' m² ; les autres maisons peuvent être de taille différente.'
          : result.method === 'dvf_median_nearby'
            ? 'Médiane des ventes DVF de surface comparable (rayon de ' + (result.radius_m / 1000).toLocaleString('fr-FR') + ' km).'
            : 'Estimation par le moteur GeoRegistry sur ventes DVF.';
        const summary = 'Estimation du bien entier ' + money(result.estimate_cents, 'EUR') + ' (' + money(result.low_cents, 'EUR') + ' à ' + money(result.high_cents, 'EUR') + '). ' + sampleText + '. ' + methodText;

        // Un seul clic sur la baguette : les deux champs se remplissent.
        // Rien n'est enregistré en base tant que l'utilisateur n'a pas
        // enregistré le formulaire, et le prix d'achat reste inchangé.
        amountInput.value = centsInput(result.estimate_cents);
        noteInput.value = notes;
        amountInput.dispatchEvent(new Event('input', { bubbles: true }));
        noteInput.dispatchEvent(new Event('input', { bubbles: true }));
        output.textContent = summary + ' Valeur actuelle et notes remplies automatiquement. Cliquez sur « Enregistrer » pour les sauvegarder. La valeur d’achat reste inchangée.';
        toast('Estimation et bilan ajoutés automatiquement. Enregistrez le bien.');
      } catch (err) { output.textContent = err.message; }
      finally { button.disabled = false; }
    }));
    const modeWrap = $('[data-mode-wrap]', form);
    const block = $('[data-schedule]', form);
    let mode = sc ? 'auto' : 'manual';
    let modeTouched = Boolean(existing);
    const scNames = ['sc_principal', 'sc_rate', 'sc_months', 'sc_start'];
    const current = () => {
      const o = form.category_id.selectedOptions[0];
      return { loan: o.dataset.loan === 'true' || Boolean(sc), liability: o.dataset.kind === 'liability' };
    };
    const readSchedule = () => {
      const P = parseCents(form.sc_principal.value);
      const rateTxt = form.sc_rate.value.replace(/[%\s]/g, '').replace(',', '.');
      const rate = Number(rateTxt);
      const months = Number(form.sc_months.value.trim());
      const start = form.sc_start.value;
      const ok = P > 0 && rateTxt !== '' && rate >= 0 && rate <= 50 && Number.isInteger(months) && months >= 1 && months <= 600 && /^\d{4}-\d{2}-\d{2}$/.test(start) && start <= todayIso();
      return ok ? { kind: form.sc_kind.value, principal_cents: P, annual_rate: rate, months, start_date: start } : null;
    };
    const drawPreview = () => {
      if (block.hidden) return;
      const { liability } = current();
      const w = loanWords(liability);
      $('[data-kind-hint]', form).textContent = form.sc_kind.value === 'bullet'
        ? 'Seuls les intérêts sont versés chaque mois ; le capital est remboursé en une fois à la dernière échéance.'
        : 'Chaque mois, la même somme rembourse une part de capital et les intérêts.';
      const m = Number(form.sc_months.value.trim());
      $('[data-years]', form).textContent = Number.isInteger(m) && m >= 12 && m <= 600 ? durationText(m) : '';
      const s = readSchedule();
      const box = $('[data-preview]', form);
      if (!s) { box.innerHTML = part(html`<p class="il small muted">${icon('info')}<span>Renseignez le montant, le taux, la durée et la date : la mensualité et le capital restant s'affichent ici.</span></p>`); return; }
      const rows = amortize(s);
      const today = todayIso();
      const paid = rows.filter((r) => r.date <= today);
      const cur = form.currency.value;
      const total = rows.reduce((t, r) => t + r.interest, 0);
      box.innerHTML = part(html`
        <div><span>${s.kind === 'bullet' ? (liability ? 'Intérêts mensuels' : 'Intérêts reçus par mois') : w.payment}</span><b>${exact(rows[0].payment, cur)}</b></div>
        <div><span>${w.remaining} aujourd'hui</span><b>${exact(paid.length ? paid[paid.length - 1].remaining : s.principal_cents, cur)}</b><small>${paid.length} échéance${paid.length > 1 ? 's' : ''} passée${paid.length > 1 ? 's' : ''} sur ${rows.length}</small></div>
        <div><span>${w.end}</span><b>${dateFr(rows[rows.length - 1].date)}</b>${s.kind === 'bullet' ? html`<small>capital remboursé en une fois</small>` : ''}</div>
        <div><span>${w.interest}</span><b>${money(total, cur)}</b></div>`);
    };
    const syncMode = () => {
      const { loan, liability } = current();
      modeWrap.hidden = !loan;
      if (!loan) mode = 'manual';
      else if (!modeTouched) mode = 'auto';
      for (const r of form.querySelectorAll('[name="mode"]')) r.checked = r.value === mode;
      const auto = loan && mode === 'auto';
      block.hidden = !auto;
      $$('[data-manual]', form).forEach((el) => { el.hidden = auto; });
      const ch = $('[data-credit-hint]', form);
      if (ch) ch.hidden = auto || !liability;
      for (const n of scNames) form[n].required = auto;
      const w = loanWords(liability);
      $$('[data-w]', form).forEach((el) => { el.textContent = w[el.dataset.w]; });
      $('[data-mode-hint]', form).textContent = auto
        ? (sc ? 'Remboursement anticipé ou renégociation : indiquez le capital restant, la date de reprise et la durée restante. Les valeurs calculées jusque-là restent dans l\'historique.'
          : `Vigie calcule chaque mois le ${liability ? 'capital restant dû' : 'capital restant à recevoir'} à partir du montant, du taux et de la durée. Aucune valeur à saisir ensuite.`)
        : (sc ? "Les valeurs calculées jusqu'à aujourd'hui restent dans l'historique ; vous saisirez ensuite les nouvelles valeurs vous-même."
          : 'Vous saisissez la valeur vous-même, quand vous le souhaitez.');
      drawPreview();
    };
    form.addEventListener('change', (e) => {
      if (e.target.name === 'mode') { mode = e.target.value; modeTouched = true; syncMode(); }
      else if (e.target.name === 'category_id') syncMode();
      else if (e.target.name === 'currency' || e.target.name === 'sc_kind') drawPreview();
    });
    block.addEventListener('input', drawPreview);
    syncMode();
    const newOwner = $('[data-new-owner]', form);
    form.owner_choice.addEventListener('change', () => {
      newOwner.hidden = form.owner_choice.value !== '__new__';
      form.owner_new.required = !newOwner.hidden;
      if (!newOwner.hidden) form.owner_new.focus();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = formData(form);
      body.owner = body.owner_choice === '__new__' ? body.owner_new.trim() : body.owner_choice;
      const auto = !modeWrap.hidden && mode === 'auto';
      const schedule = { kind: body.sc_kind, principal: body.sc_principal, rate: body.sc_rate, months: Number(body.sc_months.trim()), start_date: body.sc_start };
      if (!acquisitionSection.hidden) {
        if (body.acquisition_amount.trim() || body.acquisition_date) body.acquisition = { purchase_amount: body.acquisition_amount, purchased_at: body.acquisition_date };
        else if (acquisition) body.acquisition = null;
      }
      if (!estateSection.hidden) body.property = {
        purchase_amount: body.purchase_amount, purchased_at: body.purchased_at,
        property_type: body.property_type, address: body.property_address,
        surface_m2: body.surface_m2, condition: body.property_condition,
        ownership_pct: body.ownership_pct,
      };
      for (const k of ['owner_choice', 'owner_new', 'mode', 'sc_kind', 'sc_principal', 'sc_rate', 'sc_months', 'sc_start',
        'acquisition_amount', 'acquisition_date', 'purchase_amount', 'purchased_at', 'property_type', 'property_address', 'surface_m2', 'property_condition', 'ownership_pct']) delete body[k];
      if (auto) { body.schedule = schedule; delete body.amount; delete body.date; } else if (sc) body.schedule = null;
      await withBusy(e.submitter, async () => {
        try {
          const r = existing ? await api('PATCH', `/api/holdings/${existing.id}`, body) : await api('POST', '/api/holdings', body);
          closeDialog();
          toast(existing ? 'Avoir enregistré' : 'Avoir ajouté');
          if (location.hash.startsWith('#/avoirs')) { await render(); openHolding(r.id); } else location.hash = '#/avoirs';
        } catch (err) { const p = form.querySelector('.error-text'); p.textContent = err.message; p.hidden = false; }
      });
    });
  }

  // Liste de suggestions du champ Établissement (motif ARIA « combobox ») : vos établissements, puis le catalogue.
  function suggestInstitutions(q, own) {
    const fq = fold(q.trim());
    if (fq.length < 3) return [];
    const seen = new Set(), out = [];
    const words = (s) => s.split(/[\s'’&().-]+/).filter(Boolean);
    const consider = (name, entry, mine) => {
      const key = entry ? `id:${entry.id}` : `n:${normKey(name)}`;
      if (seen.has(key)) return;
      const fn = fold(name);
      let score = fn.startsWith(fq) ? 0 : words(fn).some((w) => w.startsWith(fq)) ? 1 : fn.includes(fq) ? 3 : null;
      let via = null;
      if (score === null && entry) {
        for (const al of entry.aliases) {
          const fa = fold(al);
          if (fa.startsWith(fq) || words(fa).some((w) => w.startsWith(fq))) { score = 2; via = al; break; }
          if (fa.includes(fq) && score === null) { score = 4; via = al; }
        }
      }
      if (score === null) return;
      seen.add(key);
      out.push({ name, entry, mine, via, score: score - (mine ? 0.5 : 0) });
    };
    for (const n of own) consider(n, findInstitution(n), true);
    for (const e of state.inst.list) consider(e.name, e, false);
    return out.sort((x, y) => x.score - y.score || x.name.localeCompare(y.name, 'fr')).slice(0, 8);
  }

  function highlight(name, q) {
    const fq = fold(q.trim()), chars = [...name], i = fold(name).indexOf(fq);
    if (!fq || i < 0) return html`${name}`;
    return html`${chars.slice(0, i).join('')}<mark>${chars.slice(i, i + [...fq].length).join('')}</mark>${chars.slice(i + [...fq].length).join('')}`;
  }

  function institutionAutocomplete(input, list, preview, own) {
    let items = [], active = -1, closeTimer = null, remoteTimer = null;
    const setPreview = () => { preview.innerHTML = part(instLogo(input.value, 's36')); };
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
    const paint = () => {
      list.innerHTML = part(items.map((it, i) => {
        const desc = it.entry ? `${it.entry.kind}${it.entry.source ? ' · ' + it.entry.source : ''}${it.via ? `, ${it.via}` : ''}` : 'Établissement personnalisé';
        return html`<li class="ac-item" role="option" id="inst-opt-${i}" data-i="${i}" aria-selected="${i === active}">${instLogo(it.name, 's24')}<span class="ac-txt"><b>${highlight(it.name, input.value)}</b><span>${it.mine ? `Déjà utilisé, ${desc.charAt(0).toLowerCase()}${desc.slice(1)}` : desc}</span></span></li>`;
      }));
      if (active >= 0) { input.setAttribute('aria-activedescendant', `inst-opt-${active}`); const el = list.children[active]; if (el) el.scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    };
    const update = () => {
      items = suggestInstitutions(input.value, own);
      active = -1;
      if (!items.length || (items.length === 1 && fold(items[0].name) === fold(input.value.trim()))) { close(); return; }
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      paint();
    };
    const choose = (i) => {
      const it = items[i];
      if (!it) return;
      input.value = it.name;
      close();
      setPreview();
    };
    const remoteSearch = () => {
      clearTimeout(remoteTimer);
      const q = input.value.trim();
      if (q.length < 3 || !state.boot?.user) return;
      remoteTimer = setTimeout(async () => {
        try {
          const response = await api('GET', '/api/institutions/search?q=' + encodeURIComponent(q));
          mergeInstitutions(response.institutions);
          if (input.value.trim() === q) { update(); setPreview(); }
        } catch { /* La recherche locale reste fonctionnelle sans les sources externes. */ }
      }, 550);
    };
    input.addEventListener('input', () => { update(); setPreview(); remoteSearch(); });
    input.addEventListener('focus', () => { if (input.value.trim().length >= 3) { update(); remoteSearch(); } });
    input.addEventListener('blur', () => { clearTimeout(remoteTimer); closeTimer = setTimeout(close, 150); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (list.hidden) { update(); if (list.hidden) return; }
        e.preventDefault();
        active = e.key === 'ArrowDown' ? (active + 1) % items.length : (active <= 0 ? items.length - 1 : active - 1);
        paint();
      } else if (e.key === 'Enter' && !list.hidden && active >= 0) {
        e.preventDefault();
        choose(active);
      } else if (e.key === 'Escape' && !list.hidden) {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'Tab') close();
    });
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const li = e.target.closest('.ac-item');
      if (!li) return;
      clearTimeout(closeTimer);
      choose(Number(li.dataset.i));
      input.focus();
    });
  }

  async function openHolding(id) {
    let data;
    try { data = await api('GET', `/api/holdings/${id}`); } catch (err) { fail(err); return; }
    const { holding: h, valuations, schedule: sc, base_currency: base, property, acquisition, latent_gain: latent } = data;
    const mayEdit = canEdit() && !h.shared_with_me;
    const cats = holdingsCache ? holdingsCache.categories : (await api('GET', '/api/categories')).categories;
    const cat = cats.find((c) => c.id === h.category_id) || {};
    const asc = [...valuations].reverse();
    const w = loanWords(cat.kind === 'liability');
    const shown = sc ? valuations.filter((v) => v.id !== null) : valuations;
    const valueLine = sc
      ? (sc.done ? `Prêt entièrement remboursé le ${dateLong(sc.end_date)}`
        : sc.paid_count ? `${w.remaining} après l'échéance du ${dateLong(valuations[0].valued_at)}` : `${w.remaining}, première échéance le ${dateLong(sc.next_date)}`)
      : valuations[0] ? `Valeur au ${dateLong(valuations[0].valued_at)}` : 'Aucune valeur enregistrée';
    const d = openDialog(html`<div class="dialog-body">
      ${dialogHead(h.name, `${cat.name || ''}${h.closed_at ? `, clôturé le ${dateFr(h.closed_at)}` : ''}`, html`<span class="lead-stack">${catPict(cat, 'lg')}${h.institution ? instLogo(h.institution, 's24 badge') : ''}</span>`)}
      <div><p class="hero-value" style="font-size:2.4rem;margin:0">${h.owned_cents === null ? '—' : money(h.owned_cents, h.currency, { digits: 2 })}</p>
        <p class="muted">${property ? 'Valeur de votre quote-part sur votre compte Vigie' : ''}${property ? ' · ' : ''}${valueLine}${h.currency !== base && h.value_base !== null ? `, soit ${money(h.value_base, base)}` : ''}</p></div>
      ${property ? html`<div class="panel"><dl class="kv">
        <dt>Votre quote-part</dt><dd>${(h.total_ownership_bp / 100).toLocaleString('fr-FR')} %</dd>
        <dt>Origine du bien</dt><dd>${h.shared_with_me ? 'Bien reçu par partage approuvé' : 'Bien enregistré sur votre compte'}</dd>
        <dt>Valeur d'achat (bien entier)</dt><dd>${money(property.purchase_cents, h.currency, { digits: 2 })}</dd>
        <dt>Prix d'achat de votre part</dt><dd>${money(Math.round(property.purchase_cents * h.total_ownership_bp / 10000), h.currency, { digits: 2 })}</dd>
        <dt>Date d'achat</dt><dd>${dateFr(property.purchased_at)}</dd>
        <dt>Valeur actuelle (bien entier)</dt><dd>${h.value_cents !== null ? money(h.value_cents, h.currency, { digits: 2 }) : 'Non renseignée'}</dd>
        <dt>Valeur de votre part</dt><dd>${h.owned_cents !== null ? money(h.owned_cents, h.currency, { digits: 2 }) : 'Non renseignée'}</dd>
        <dt>Plus-value latente de votre quote-part</dt><dd class="${latent ? (latent.gain_cents >= 0 ? 'pos' : 'neg') : 'muted'}">${latent ? money(latent.gain_cents, h.currency, { digits: 2, sign: true }) + ' (' + String(latent.gain_pct).replace('.', ',') + ' %)' : '—'}</dd>
      </dl><p class="small muted">Gain brut théorique, hors frais, travaux, crédit restant dû et fiscalité.</p></div>` : ''}
      ${acquisition ? html`<div class="panel"><dl class="kv"><dt>Prix de revient</dt><dd>${money(acquisition.purchase_cents, h.currency, { digits: 2 })}</dd><dt>Date d'acquisition</dt><dd>${dateFr(acquisition.purchased_at)}</dd><dt>Plus ou moins-value latente</dt><dd class="${latent ? (latent.gain_cents >= 0 ? 'pos' : 'neg') : 'muted'}">${latent ? `${money(latent.gain_cents, h.currency, { sign: true })} (${String(latent.gain_pct).replace('.', ',')} %)` : 'Valeur non renseignée'}</dd></dl></div>` : ''}
      ${asc.length > 1 ? html`<div class="chart" id="holding-chart"></div>` : ''}
      ${sc ? loanPanel(h, sc, w) : ''}
      ${mayEdit && !sc ? html`<form class="panel form" id="valuation-form" style="padding:16px">
        ${h3i('plus', 'Nouvelle valeur')}
        <div class="grid-2"><label class="field"><span>${property ? 'Valeur du bien entier' : 'Valeur'} en ${h.currency}</span><input class="input amount" name="amount" inputmode="decimal" required autocomplete="off" autofocus placeholder="${h.value_cents !== null ? exact(h.value_cents, h.currency).replace(/[^\d,\s−-]/g, '').trim() : '0'}"></label>
        <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${todayIso()}" max="${todayIso()}" required></label></div>
        <label class="field"><span>Note (facultative)</span><input class="input" name="note" maxlength="120" placeholder="Relevé annuel, estimation notaire…"></label>
        <div class="form-actions"><button class="btn primary" type="submit">${icon('check')}Enregistrer la valeur</button></div>
        <small class="muted">Une seule valeur par date : enregistrer à une date existante remplace la valeur de ce jour.</small>
      </form>` : ''}
      <dl class="kv">
        <dt>${icon('bank')}Établissement</dt><dd>${h.institution ? html`<span class="cell-lead">${instLogo(h.institution, 's24')}<span>${h.institution}</span></span>${instFullLogo(h.institution) ? html`<span class="inst-full-row">${instFullLogo(h.institution)}</span>` : ''}` : '—'}</dd>
        <dt>${icon('user')}Titulaire</dt><dd>${h.owner || '—'}</dd>
        <dt>${icon('exchange')}Devise</dt><dd>${h.currency}</dd>
        <dt>${icon(LIQ_ICON[h.liquidity])}Liquidité</dt><dd>${LIQ[h.liquidity]}</dd>
        ${h.notes ? html`<dt>${icon('journal')}Notes</dt><dd style="white-space:pre-wrap">${h.notes}</dd>` : ''}
      </dl>
      ${sc && !shown.length ? '' : html`<section class="section">${h3i('clock', sc ? "Valeurs saisies avant l'échéancier" : 'Historique des valeurs')}
        ${shown.length ? html`<div class="panel flush table-wrap"><table class="table"><thead><tr><th>Date</th><th class="num">Valeur</th><th class="num">Écart</th>${mayEdit ? html`<th><span class="sr-only">Actions</span></th>` : ''}</tr></thead><tbody>
          ${shown.map((v, i) => {
            const prev = shown[i + 1];
            const diff = prev ? v.amount_cents - prev.amount_cents : null;
            return html`<tr><td>${dateFr(v.valued_at)}${v.note ? html`<br><span class="small muted">${v.note}</span>` : ''}</td><td class="num">${exact(v.amount_cents, h.currency)}</td>
              <td class="num ${!diff ? 'muted' : (diff > 0) !== (cat.kind === 'liability') ? 'pos' : 'neg'}">${diff === null ? '' : money(diff, h.currency, { sign: true })}</td>
              ${mayEdit ? html`<td class="num"><button class="btn icon ghost small" type="button" data-action="delete-valuation" data-id="${v.id}" data-holding="${h.id}" aria-label="Supprimer la valeur du ${dateFr(v.valued_at)}">${icon('trash')}</button></td>` : ''}</tr>`;
          })}</tbody></table></div>` : html`<p class="muted">Aucune valeur.</p>`}
      </section>`}
      ${property && mayEdit ? html`<div class="form-actions" style="justify-content:flex-start"><button class="btn" type="button" data-action="share-property" data-id="${h.id}">${icon('users')}Partager ce bien</button></div>` : ''}
      ${mayEdit ? html`<div class="form-actions" style="justify-content:flex-start">
        <button class="btn" type="button" data-action="edit-holding" data-id="${h.id}">${icon('edit')}Modifier</button>
        ${h.closed_at ? html`<button class="btn" type="button" data-action="reopen-holding" data-id="${h.id}">${icon('unlock')}Rouvrir</button>` : html`<button class="btn" type="button" data-action="close-holding" data-id="${h.id}">${icon('lock')}Clôturer</button>`}
        <button class="btn danger" type="button" data-action="delete-holding" data-id="${h.id}" data-name="${h.name}">${icon('trash')}Supprimer</button></div>` : ''}
    </div>`, { drawer: true, onClose: () => { if (location.hash.match(/^#\/avoirs\/\d+/)) history.replaceState(null, '', '#/avoirs'); } });
    d.dataset.holding = h.id;
    d._holding = { ...h, schedule: sc, property };
    if (asc.length > 1) lineChart($('#holding-chart', d), asc.map((v) => ({ date: v.valued_at, value: v.amount_cents })), { cur: h.currency, height: 150, label: `Valeur de ${h.name}` });
    const form = $('#valuation-form', d);
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await withBusy(e.submitter, async () => {
        try {
          await api('POST', `/api/holdings/${h.id}/valuations`, formData(form));
          toast('Valeur enregistrée');
          await refreshAfterChange(h.id);
        } catch (err) { fail(err); }
      });
    });
  }

  // Panneau « Échéancier » d'un avoir : progression, chiffres clés, prochaine échéance et tableau d'amortissement.
  function loanPanel(h, sc, w) {
    const today = todayIso();
    const cur = h.currency;
    const done = Math.round((sc.repaid_cents / sc.principal_cents) * 100);
    const next = sc.rows.find((r) => r.n === sc.paid_count + 1);
    const plain = (cents) => (state.discret ? MASK : (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const shortDate = (iso) => asDate(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    return html`<section class="panel loan" aria-label="Échéancier">
      <div class="loan-head">${h3i('calendar', 'Échéancier automatique')}<span class="tag brand">${LOAN_KIND[sc.kind]}</span></div>
      <div class="progress" role="progressbar" aria-label="Capital remboursé" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${done}"><span style="width:${done}%"></span></div>
      <p class="small muted">${sc.paid_count} échéance${sc.paid_count > 1 ? 's' : ''} sur ${sc.months} · ${money(sc.repaid_cents, cur)} de capital remboursé (${done} %)</p>
      <div class="loan-preview">
        <div><span>${w.principal}</span><b>${money(sc.principal_cents, cur)}</b><small>le ${dateFr(sc.start_date)}</small></div>
        <div><span>Taux annuel</span><b>${String(sc.annual_rate).replace('.', ',')} %</b><small>sur ${durationText(sc.months)}</small></div>
        <div><span>${sc.kind === 'bullet' ? 'Intérêts mensuels' : w.payment}</span><b>${exact(sc.payment_cents, cur)}</b></div>
        <div><span>${w.end}</span><b>${dateFr(sc.end_date)}</b></div>
      </div>
      ${sc.done ? html`<div class="notice info">${icon('check')}<div>Prêt entièrement remboursé le ${dateLong(sc.end_date)}.${canEdit() && !h.closed_at ? ' Vous pouvez le clôturer pour le retirer de la liste.' : ''}</div></div>`
        : next ? html`<div class="notice info">${icon('clock')}<div>Prochaine échéance le <b>${dateLong(next.date)}</b> : ${exact(next.payment, cur)}, dont ${exact(next.interest, cur)} d'intérêts et ${exact(next.principal, cur)} de capital.</div></div>` : ''}
      <dl class="kv">
        <dt>${icon('percent')}${w.interestToDate}</dt><dd>${exact(sc.interest_received_cents, cur)}</dd>
        <dt>${icon('sum')}${w.interest}</dt><dd>${exact(sc.total_interest_cents, cur)}</dd>
      </dl>
      <details class="amort">
        <summary>${icon('chevDown')}<span>Tableau d'amortissement</span><span class="muted">${sc.rows.length} échéances</span></summary>
        <div class="amort-wrap" tabindex="0" aria-label="Tableau d'amortissement, défilable"><table class="amort-table">
          <thead><tr><th class="opt">N°</th><th>Date</th><th class="num opt">Échéance</th><th class="num">Intérêts</th><th class="num">Capital</th><th class="num">Restant</th></tr></thead>
          <tbody>${sc.rows.map((r) => html`<tr class="${r.date <= today ? 'paid' : ''}${next && r.n === next.n ? ' next' : ''}"><td class="opt">${r.n}</td><td>${shortDate(r.date)}</td><td class="num opt">${plain(r.payment)}</td><td class="num">${plain(r.interest)}</td><td class="num">${plain(r.principal)}</td><td class="num">${plain(r.remaining)}</td></tr>`)}</tbody>
        </table></div>
        <p class="small muted">Montants en ${cur}. Les lignes passées sont grisées. Calcul au centime, sans assurance ni frais.</p>
      </details>
      ${canEdit() ? html`<div class="form-actions" style="justify-content:flex-start">
        <button class="btn" type="button" data-action="edit-holding" data-id="${h.id}">${icon('edit')}Modifier l'échéancier</button>
        <button class="btn" type="button" data-action="schedule-manual" data-id="${h.id}">${icon('pencil')}Passer en saisie manuelle</button></div>` : ''}
    </section>`;
  }

  async function refreshAfterChange(holdingId) {
    closeDialog();
    await render();
    if (holdingId && location.hash.startsWith('#/avoirs')) openHolding(holdingId);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Mise à jour rapide
  // ---------------------------------------------------------------------------------------------------------
  async function pageQuick(el, route, current) {
    const [v, s] = await Promise.all([api('GET', '/api/holdings'), api('GET', '/api/settings')]);
    if (!current()) return;
    state.base = v.base_currency;
    setHeader('Mise à jour rapide', 'Saisissez les nouvelles valeurs, les autres restent inchangées', discretButton());
    const open = v.holdings.filter((h) => !h.closed_at && !h.shared_with_me); // bien reçu en partage : lecture seule
    const manualOpen = open.filter((h) => !h.schedule);
    if (!open.length) { el.innerHTML = part(html`<div class="panel empty">${pict('update', 'lg')}<h2>Aucun avoir à mettre à jour</h2><p>Ajoutez d'abord vos avoirs.</p><a class="btn primary" href="#/avoirs">Voir les avoirs</a></div>`); return; }
    const rate = (cur) => (cur === v.base_currency ? 1 : (s.rates.find((r) => r.currency === cur) || {}).rate);
    const kind = new Map(v.categories.map((c) => [c.id, c.kind]));
    const signFor = (h) => (kind.get(h.category_id) === 'liability' ? -1 : 1);
    const netNow = open.reduce((sum, h) => sum + (h.value_base || 0) * signFor(h), 0);
    let onlyStale = false;
    const groups = v.categories.map((c) => ({ c, items: open.filter((h) => h.category_id === c.id) })).filter((g) => g.items.length);
    el.innerHTML = part(html`
      <form id="quick-form" class="stack">
        <div class="toolbar"><label class="field" style="max-width:200px"><span>${il('calendar', 'Date des valeurs')}</span><input class="input" type="date" name="date" value="${todayIso()}" max="${todayIso()}" required></label>
          <label class="check" style="align-self:end;margin-bottom:9px"><input type="checkbox" id="only-stale"><span>Seulement les valeurs à actualiser</span></label></div>
        ${groups.map(({ c, items }) => html`<section class="panel flush group" data-group>
          <div class="group-head"><div class="gh">${catPict(c, 'sm')}<h3>${c.name}</h3></div><span class="sub">${c.kind === 'liability' ? 'Capital restant dû' : ''}</span></div>
          ${items.map((h) => {
            if (h.schedule) return html`<div class="quick auto" data-line data-stale="false">
              <div class="cell-lead">${h.institution ? instLogo(h.institution) : pict(catIconKey(c), 'neutral md')}<div><b>${h.name}</b><br><span class="small muted">${h.institution || ''}</span></div></div>
              <div class="prev"><b>${h.value_cents === null ? '—' : exact(h.value_cents, h.currency)}</b><span>${h.last_date ? dateFr(h.last_date) : '—'}</span></div>
              <div class="auto-note">${il('calendar', h.schedule.done ? 'Prêt remboursé' : `Calculé par l'échéancier, prochaine échéance le ${dateFr(h.schedule.next_date)}`)}</div>
            </div>`;
            const stale = v.stale_days > 0 && (h.age_days === null || h.age_days > v.stale_days);
            return html`<div class="quick" data-row data-line data-stale="${stale}" data-id="${h.id}">
              <div class="cell-lead">${h.institution ? instLogo(h.institution) : pict(catIconKey(c), 'neutral md')}<div><b>${h.name}</b><br><span class="small muted">${h.institution || ''}${h.property && h.property.ownership_bp < 10000 ? ' · Quote-part ' + (h.property.ownership_bp / 100).toLocaleString('fr-FR') + ' % (saisir valeur du bien entier)' : ''}</span>${stale ? html` <span class="tag stale">${icon('clock')}À actualiser</span>` : ''}</div></div>
              <div class="prev"><b>${h.value_cents === null ? '—' : exact(h.value_cents, h.currency)}</b><span>${h.last_date ? dateFr(h.last_date) : 'aucune valeur'}</span></div>
              <input class="input amount" name="h${h.id}" inputmode="decimal" autocomplete="off" aria-label="Nouvelle valeur de ${h.name} en ${h.currency}${h.property ? ' (valeur du bien entier)' : ''}" placeholder="${h.currency}">
              <button class="btn small keep" type="button" data-action="keep-value" data-id="${h.id}" ${h.value_cents === null ? 'disabled' : ''} title="Reprendre la dernière valeur à la date choisie">${icon('equal')}Inchangée</button>
            </div>`;
          })}</section>`)}
        <div class="sticky-foot"><div><b id="quick-count">Aucune valeur saisie</b><br><span class="small muted" id="quick-preview">Patrimoine net actuel : ${money(netNow)}</span></div>
          <button class="btn primary" type="submit" id="quick-save" disabled>${icon('check')}Enregistrer les valeurs</button></div>
      </form>`);
    const form = $('#quick-form');
    const byId = new Map(manualOpen.map((h) => [String(h.id), h]));
    const parse = parseCents;
    const update = () => {
      let count = 0, invalid = 0, net = netNow, missing = false;
      $$('[data-row]', form).forEach((row) => {
        const h = byId.get(row.dataset.id);
        const input = row.querySelector('input');
        const cents = parse(input.value);
        row.classList.toggle('changed', cents !== null && !Number.isNaN(cents));
        input.setAttribute('aria-invalid', Number.isNaN(cents) ? 'true' : 'false');
        if (cents === null) return;
        if (Number.isNaN(cents)) { invalid++; return; }
        count++;
        const r = rate(h.currency);
        if (r === undefined) { missing = true; return; }
        const owned = Math.round(cents * (h.total_ownership_bp ?? h.property?.ownership_bp ?? 10000) / 10000);
        net += (Math.round(owned * r) - (h.value_base || 0)) * signFor(h);
      });
      $('#quick-count').textContent = invalid ? `${invalid} montant(s) illisible(s)` : count ? `${count} valeur${count > 1 ? 's' : ''} à enregistrer` : 'Aucune valeur saisie';
      $('#quick-preview').textContent = count ? `Patrimoine net après mise à jour : ${money(net)} (${money(net - netNow, state.base, { sign: true })})${missing ? ', hors devises sans taux' : ''}` : `Patrimoine net actuel : ${money(netNow)}`;
      $('#quick-save').disabled = !count || invalid > 0;
    };
    form.addEventListener('input', update);
    $('#only-stale').addEventListener('change', (e) => {
      onlyStale = e.target.checked;
      $$('[data-line]', form).forEach((r) => { r.hidden = onlyStale && r.dataset.stale !== 'true'; });
      $$('[data-group]', form).forEach((g) => { g.hidden = $$('[data-line]', g).every((r) => r.hidden); });
    });
    form.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action="keep-value"]');
      if (!b) return;
      const h = byId.get(b.dataset.id);
      const input = form.querySelector(`[name="h${h.id}"]`);
      input.value = (h.value_cents / 100).toFixed(2).replace('.', ',');
      update();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const items = $$('[data-row]', form).map((row) => ({ holding_id: Number(row.dataset.id), amount: row.querySelector('input').value.trim() })).filter((i) => i.amount);
      await withBusy($('#quick-save'), async () => {
        try {
          const r = await api('POST', '/api/valuations/bulk', { date: form.date.value, items });
          toast(`${r.saved} valeur${r.saved > 1 ? 's' : ''} enregistrée${r.saved > 1 ? 's' : ''} au ${dateFr(r.date)}`);
          location.hash = '#/';
        } catch (err) { fail(err); }
      });
    });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Catégories
  // ---------------------------------------------------------------------------------------------------------
  async function pageCategories(el, route, current) {
    const [{ categories }, d] = await Promise.all([api('GET', '/api/categories'), api('GET', '/api/dashboard')]);
    if (!current()) return;
    state.base = d.base_currency;
    setHeader('Catégories', 'Regroupez vos avoirs et fixez une allocation cible', canEdit() ? html`<button class="btn primary" data-action="new-category">${icon('plus')}Ajouter une catégorie</button>` : '');
    const totals = new Map(d.categories.map((c) => [c.id, c]));
    const targetSum = categories.filter((c) => c.kind === 'asset').reduce((s, c) => s + (c.target_pct || 0), 0);
    const table = (kind, title) => {
      const list = categories.filter((c) => c.kind === kind);
      return html`<section class="section"><div class="section-head">${h2i(kind === 'asset' ? 'stack' : 'debt', title)}${kind === 'asset' && targetSum > 0 ? html`<p>Total des cibles : <b class="${Math.abs(targetSum - 100) > 0.05 ? 'neg' : ''}">${targetSum.toLocaleString('fr-FR')} %</b>${Math.abs(targetSum - 100) > 0.05 ? ', idéalement 100 %' : ''}</p>` : ''}</div>
        <div class="panel flush table-wrap"><table class="table"><thead><tr><th>Catégorie</th><th>Liquidité par défaut</th>${kind === 'asset' ? html`<th class="num">Part actuelle</th><th class="num">Cible</th>` : ''}<th class="num">Montant</th>${canEdit() ? html`<th><span class="sr-only">Actions</span></th>` : ''}</tr></thead><tbody>
        ${list.length ? list.map((c, i) => {
          const t = totals.get(c.id) || {};
          return html`<tr><td><div class="cell-lead">${catPict(c)}<div><b style="font-weight:500">${c.name}</b><br><span class="small muted">${c.description || ''}${c.holding_count ? ` (${c.holding_count} avoir${c.holding_count > 1 ? 's' : ''})` : ''}</span></div></div></td>
            <td>${il(LIQ_ICON[c.default_liquidity], LIQ_SHORT[c.default_liquidity])}</td>
            ${kind === 'asset' ? html`<td class="num">${pct(t.pct || 0)}</td><td class="num">${c.target_pct !== null ? il('target', `${c.target_pct.toLocaleString('fr-FR')} %`) : '—'}</td>` : ''}
            <td class="num">${money(t.value || 0)}</td>
            ${canEdit() ? html`<td class="num nowrap">
              <button class="btn icon ghost small" data-action="move-category" data-id="${c.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Monter ${c.name}">${icon('chevUp')}</button>
              <button class="btn icon ghost small" data-action="move-category" data-id="${c.id}" data-dir="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Descendre ${c.name}">${icon('chevDown')}</button>
              <button class="btn icon ghost small" data-action="edit-category" data-id="${c.id}" aria-label="Modifier ${c.name}">${icon('edit')}</button>
              <button class="btn icon ghost small" data-action="delete-category" data-id="${c.id}" data-name="${c.name}" ${c.holding_count ? 'disabled title="Contient des avoirs"' : ''} aria-label="Supprimer ${c.name}">${icon('trash')}</button></td>` : ''}</tr>`;
        }) : html`<tr><td colspan="6" class="muted">Aucune catégorie.</td></tr>`}</tbody></table></div></section>`;
    };
    el.innerHTML = part(html`${table('asset', 'Actifs')}${table('liability', 'Passifs')}`);
    el._categories = categories;
  }

  function categoryForm(existing = null) {
    const c = existing || { kind: 'asset', default_liquidity: 'immediate' };
    const current = catIconKey(c);
    const d = openDialog(html`<form class="dialog-body form">
      ${dialogHead(existing ? `Modifier ${existing.name}` : 'Ajouter une catégorie', '', html`<span data-icon-preview>${catPict(c, 'lg')}</span>`)}
      <label class="field"><span>Nom</span><input class="input" name="name" required maxlength="60" value="${c.name || ''}" autofocus></label>
      <label class="field"><span>Description</span><input class="input" name="description" maxlength="120" value="${c.description || ''}"></label>
      <div class="grid-2">
        <label class="field"><span>Type</span><select class="select" name="kind" ${existing && existing.holding_count ? 'disabled' : ''}><option value="asset" ${c.kind === 'asset' ? 'selected' : ''}>Actif</option><option value="liability" ${c.kind === 'liability' ? 'selected' : ''}>Passif (crédit, dette)</option></select></label>
        <label class="field"><span>Liquidité par défaut</span><select class="select" name="default_liquidity">${Object.entries(LIQ).map(([k, l]) => html`<option value="${k}" ${c.default_liquidity === k ? 'selected' : ''}>${l}</option>`)}</select></label>
      </div>
      <fieldset class="field icon-picker"><legend>Pictogramme : <b data-icon-label>${(CAT_ICONS[current] || {}).label || ''}</b></legend>
        <div class="picker">${Object.entries(CAT_ICONS).map(([k, v]) => html`<label class="pick" title="${v.label}"><input type="radio" name="icon" value="${k}" ${k === current ? 'checked' : ''}><span class="pict">${icon(k)}</span><span class="sr-only">${v.label}</span></label>`)}</div>
      </fieldset>
      <label class="field" data-target><span>${il('target', 'Allocation cible (%)')}</span><input class="input" name="target_pct" inputmode="decimal" value="${c.target_pct ?? ''}" placeholder="Aucune"><small>Part visée de cette catégorie dans vos actifs. Laissez vide pour ne pas en fixer.</small></label>
      <p class="error-text" hidden></p>
      <div class="form-actions"><button class="btn" type="button" data-action="close-dialog">Annuler</button><button class="btn primary" type="submit">${icon(existing ? 'check' : 'plus')}${existing ? 'Enregistrer' : 'Ajouter la catégorie'}</button></div>
    </form>`);
    const form = d.querySelector('form');
    let iconTouched = false;
    const preview = () => {
      const k = (form.querySelector('input[name=icon]:checked') || {}).value;
      $('[data-icon-preview]', d).innerHTML = part(catPict({ icon: k, kind: form.kind.value }, 'lg'));
      $('[data-icon-label]', d).textContent = (CAT_ICONS[k] || {}).label || '';
    };
    form.addEventListener('change', (e) => {
      if (e.target.name === 'icon') iconTouched = true;
      // Nouvelle catégorie : passer en « Passif » propose le pictogramme Crédit tant qu'aucun choix n'a été fait.
      if (e.target.name === 'kind' && !existing && !iconTouched) {
        const def = form.kind.value === 'liability' ? 'loanDoc' : 'cube';
        const r = form.querySelector(`input[name=icon][value="${def}"]`);
        if (r) r.checked = true;
      }
      preview();
    });
    const sync = () => { $('[data-target]', form).hidden = form.kind.value !== 'asset'; };
    form.kind.addEventListener('change', sync); sync();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = formData(form);
      if (body.target_pct === '') body.target_pct = null;
      await withBusy(e.submitter, async () => {
        try {
          await (existing ? api('PATCH', `/api/categories/${existing.id}`, body) : api('POST', '/api/categories', body));
          closeDialog(); toast('Catégorie enregistrée'); render();
        } catch (err) { const p = form.querySelector('.error-text'); p.textContent = err.message; p.hidden = false; }
      });
    });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Réglages : devise, taux, export, import, sauvegardes
  // ---------------------------------------------------------------------------------------------------------
  async function pageSettings(el, route, current) {
    const [s, backups, { owners }, logoSt, mail] = await Promise.all([api('GET', '/api/settings'), isAdmin() ? api('GET', '/api/admin/backups') : null, api('GET', '/api/owners'),
      isAdmin() ? api('GET', '/api/admin/logos') : null, isAdmin() ? api('GET', '/api/admin/mail') : null]);
    if (!current()) return;
    state.base = s.base_currency;
    setHeader('Réglages', 'Paramètres organisés par thème');
    const settingsTabs = [
      ['general', 'Général', 'settings'],
      ['titulaires', 'Titulaires', 'users'],
      ['devises', 'Devises', 'exchange'],
      ...(logoSt ? [['etablissements', 'Établissements', 'bank']] : []),
      ['donnees', 'Données', 'database'],
      ...(mail ? [['emails', 'E-mails', 'mail']] : []),
      ...(isAdmin() ? [['securite', 'Sécurité', 'shield']] : []),
    ];
    const curOptions = (sel) => [...new Set([s.base_currency, ...s.currencies])].map((c) => html`<option ${c === sel ? 'selected' : ''}>${c}</option>`);
    const addable = [...new Set([...s.currencies_in_use, ...s.currencies])].filter((c) => c !== s.base_currency);
    el.innerHTML = part(html`
      <nav class="settings-tabs" id="settings-tabs" role="tablist" aria-label="Rubriques des réglages">
        ${settingsTabs.map(([key, label, pictogram]) => html`<button type="button" role="tab" id="settings-tab-${key}"
          aria-controls="settings-panel-${key}" aria-selected="false" tabindex="-1" data-settings-tab="${key}">${icon(pictogram)}<span>${label}</span></button>`)}
      </nav>
      <section class="section" data-settings-group="general">${h2i('bell', 'Devise et rappels')}<div class="panel">
        ${isAdmin() ? html`<form class="form" id="settings-form"><div class="grid-2">
          <label class="field"><span>Devise de référence</span><select class="select" name="base_currency">${curOptions(s.base_currency)}</select><small>Changer de devise efface les taux de change saisis.</small></label>
          <label class="field"><span>Rappel d'actualisation (jours)</span><input class="input" type="number" name="stale_days" min="0" max="3650" value="${s.stale_days}"><small>Un avoir est signalé « à actualiser » au-delà de ce délai. 0 désactive le rappel.</small></label>
        </div><div class="form-actions"><button class="btn primary" type="submit">${icon('check')}Enregistrer</button></div></form>`
        : html`<dl class="kv"><dt>Devise de référence</dt><dd>${s.base_currency}</dd><dt>Rappel d'actualisation</dt><dd>${s.stale_days ? `${s.stale_days} jours` : 'désactivé'}</dd></dl>`}
      </div></section>

      <section class="section" data-settings-group="titulaires"><div class="section-head">${h2i('users', 'Titulaires')}<p>Personnes à qui appartiennent les avoirs</p></div>
        <div class="panel flush table-wrap"><table class="table"><thead><tr><th>Titulaire</th><th class="num">Avoirs</th>${canEdit() ? html`<th><span class="sr-only">Actions</span></th>` : ''}</tr></thead><tbody>
          ${owners.map((o) => html`<tr><td><span class="cell-lead">${avatar(o.name, 'sm')}<span>${o.name}</span></span></td><td class="num">${o.count}</td>
            ${canEdit() ? html`<td class="num nowrap"><button class="btn small" data-action="rename-owner" data-name="${o.name}">${icon('edit')}Renommer</button>
              <button class="btn icon ghost small" data-action="delete-owner" data-name="${o.name}" ${o.count ? raw('disabled title="Indiqué sur des avoirs"') : ''} aria-label="Supprimer ${o.name}">${icon('trash')}</button></td>` : ''}</tr>`)}
        </tbody></table></div>
        ${canEdit() ? html`<form class="toolbar" id="owner-form"><input class="input" name="name" required maxlength="40" placeholder="Nouveau titulaire" aria-label="Nouveau titulaire" style="max-width:240px"><button class="btn" type="submit">${icon('plus')}Ajouter le titulaire</button></form>` : ''}
      </section>

      <section class="section" data-settings-group="devises"><div class="section-head">${h2i('exchange', 'Taux de change')}<p>1 unité de la devise vaut x ${s.base_currency}</p></div>
        ${s.missing_rates.length ? html`<div class="notice">${icon('alert')}<div>Taux manquant pour ${s.missing_rates.join(', ')}.</div></div>` : ''}
        <div class="panel flush table-wrap"><table class="table"><thead><tr><th>Devise</th><th class="num">Taux</th><th>Source</th><th>Mis à jour</th>${canEdit() ? html`<th><span class="sr-only">Actions</span></th>` : ''}</tr></thead><tbody>
          ${s.rates.length ? s.rates.map((r) => html`<tr><td>${r.currency}</td><td class="num">1 ${r.currency} = ${r.rate.toLocaleString('fr-FR', { maximumFractionDigits: 6 })} ${s.base_currency}</td><td>${r.source}</td><td>${dateTime(r.updated_at)}</td>
            ${canEdit() ? html`<td class="num"><button class="btn icon ghost small" data-action="delete-rate" data-cur="${r.currency}" aria-label="Supprimer le taux ${r.currency}">${icon('trash')}</button></td>` : ''}</tr>`)
            : html`<tr><td colspan="5" class="muted">Aucun taux : seuls les avoirs en ${s.base_currency} sont comptés.</td></tr>`}
        </tbody></table></div>
        ${canEdit() ? html`<form class="toolbar" id="rate-form">
          <select class="select" name="currency" aria-label="Devise" style="max-width:120px">${addable.map((c) => html`<option ${s.missing_rates[0] === c ? 'selected' : ''}>${c}</option>`)}</select>
          <input class="input amount" name="rate" inputmode="decimal" placeholder="Taux, ex. 0,92" required style="max-width:180px" aria-label="Taux">
          <button class="btn" type="submit">${icon('check')}Enregistrer le taux</button>
          ${s.ecb_enabled ? html`<button class="btn" type="button" data-action="ecb-rates">${icon('globe')}Récupérer les taux de la BCE</button>` : ''}
        </form>` : ''}
      </section>

      <section class="section" data-settings-group="donnees">${h2i('download', 'Exporter mes données')}<div class="panel"><div class="toolbar">
        <a class="btn" href="/api/export.json" download>${icon('download')}Export complet (JSON)</a>
        <a class="btn" href="/api/export/holdings.csv" download>${icon('download')}Avoirs (CSV)</a>
        <a class="btn" href="/api/export/history.csv" download>${icon('download')}Historique des valeurs (CSV)</a>
      </div><p class="small muted" style="margin-top:10px">Les fichiers CSV utilisent le point-virgule et la virgule décimale, pour s'ouvrir directement dans Excel ou LibreOffice.</p></div></section>

      ${isAdmin() ? html`
      <section class="section" data-settings-group="donnees">${h2i('upload', 'Restaurer un export')}<div class="panel form">
        <p class="muted">Remplace toutes les catégories, tous les avoirs, l'historique et les taux par ceux d'un export JSON de Vigie. Les comptes utilisateurs ne changent pas. Une sauvegarde de la base est créée juste avant.</p>
        <div class="toolbar"><input type="file" id="import-file" accept="application/json,.json" class="input" style="max-width:360px"><button class="btn" type="button" data-action="import">${icon('upload')}Restaurer cet export</button></div>
      </div></section>

      <section class="section" data-settings-group="donnees"><div class="section-head">${h2i('database', 'Sauvegardes de la base')}<p>${backups.keep_days ? `Automatique chaque jour vers ${backups.hour} h, conservée ${backups.keep_days} jours` : 'Sauvegarde automatique désactivée'}</p></div>
        <div class="panel flush table-wrap"><table class="table"><thead><tr><th>Fichier</th><th>Date</th><th class="num">Taille</th><th><span class="sr-only">Télécharger</span></th></tr></thead><tbody>
        ${backups.backups.length ? backups.backups.slice(0, 15).map((b) => html`<tr><td>${b.name}</td><td>${dateTime(b.created_at)}</td><td class="num">${(b.size / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Ko</td>
          <td class="num"><a class="btn icon ghost small" href="/api/admin/backups/${encodeURIComponent(b.name)}" download aria-label="Télécharger ${b.name}">${icon('download')}</a></td></tr>`)
          : html`<tr><td colspan="4" class="muted">Aucune sauvegarde pour l'instant.</td></tr>`}
        </tbody></table></div>
        <div class="toolbar"><button class="btn" type="button" data-action="backup-now">${icon('database')}Créer une sauvegarde maintenant</button>
          <span class="small muted">Fichiers SQLite dans le dossier data/backups de l'application, inclus dans les sauvegardes Runtipi.</span></div>
      </section>

      ${mail ? mailSection(mail) : ''}

      ${logoSt ? logoSummarySection(logoSt) : ''}

      <section class="section" data-settings-group="securite">
        <div class="section-head">${h2i('shield', 'Sécurité du serveur')}<p>Paramètres modifiables par l'administrateur</p></div>
        <form class="panel form" id="security-settings-form">
          <div class="grid-2">
            <label class="field"><span>Déconnexion après inactivité (minutes)</span><input class="input" type="number" name="session_idle_minutes" min="5" max="10080" step="1" required value="${s.security.session_idle_minutes}"><small>De 5 à 10 080 minutes. Applicable aux sessions ouvertes.</small></label>
            <label class="field"><span>Durée maximale d'une session (heures)</span><input class="input" type="number" name="session_max_hours" min="1" max="2160" step="1" required value="${s.security.session_max_hours}"><small>De 1 à 2 160 heures. Applicable aux nouvelles sessions.</small></label>
            <label class="field"><span>Échecs avant blocage du compte</span><input class="input" type="number" name="login_max_attempts" min="3" max="50" step="1" required value="${s.security.login_max_attempts}"><small>De 3 à 50 échecs consécutifs.</small></label>
            <label class="field"><span>Durée du blocage (minutes)</span><input class="input" type="number" name="login_lock_minutes" min="1" max="1440" step="1" required value="${s.security.login_lock_minutes}"><small>De 1 à 1 440 minutes.</small></label>
          </div>
          <label class="check"><input type="checkbox" name="require_2fa" ${s.security.require_2fa ? 'checked' : ''} ${s.security.require_2fa_forced ? raw('disabled') : ''}><span><b>Double authentification obligatoire pour tous</b><span class="small muted" style="display:block">${s.security.require_2fa_forced ? 'Imposée par Runtipi ou vigie.env : impossible à désactiver ici.' : 'Les utilisateurs sans 2FA devront l’activer avant d’accéder à leurs données.'}</span></span></label>
          <div class="section-head">${h3i('bank', 'Services externes : logos')}</div>
          <label class="check"><input type="checkbox" name="institution_logos" ${s.security.institution_logos ? 'checked' : ''}><span><b>Récupérer les logos des établissements</b><span class="small muted" style="display:block">Autorise les requêtes externes sur les sites des établissements.</span></span></label>
          <label class="check"><input type="checkbox" name="institution_logos_fallback" ${s.security.institution_logos_fallback ? 'checked' : ''}><span><b>Utiliser le service d'icônes de secours</b><span class="small muted" style="display:block">Si nécessaire, le domaine de l'établissement peut être transmis à Google.</span></span></label>
          <label class="field"><span>Mot de passe administrateur pour confirmer</span><input class="input" name="current_password" type="password" required autocomplete="current-password" placeholder="Mot de passe actuel"></label>
          <p class="error-text" role="alert" hidden></p>
          <div class="form-actions"><button class="btn primary" type="submit">${icon('shield')}Enregistrer la sécurité</button></div>
          <p class="small muted">Appliqué sans redémarrage et conservé dans SQLite. L'obligation 2FA imposée par Runtipi reste prioritaire. Le secret de l'application n'est pas modifiable ici.</p>
        </form>
      </section>` : ''}`);

    // Les formulaires restent montés et fonctionnent comme avant ; seul le panneau
    // actif est affiché. Déplacer les sections préserve les écouteurs et leurs identifiants.
    const nav = $('#settings-tabs', el);
    const panels = new Map();
    for (const [key] of settingsTabs) {
      const panel = document.createElement('div');
      panel.className = 'settings-tab-panel';
      panel.id = 'settings-panel-' + key;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', 'settings-tab-' + key);
      panel.setAttribute('tabindex', '0');
      for (const section of $$('[data-settings-group="' + key + '"]', el)) panel.appendChild(section);
      el.appendChild(panel);
      panels.set(key, panel);
    }
    const buttons = $$('[data-settings-tab]', nav);
    const activate = (key, focus = false) => {
      if (!panels.has(key)) return;
      for (const btn of buttons) {
        const selected = btn.dataset.settingsTab === key;
        btn.setAttribute('aria-selected', String(selected));
        btn.tabIndex = selected ? 0 : -1;
        if (selected && focus) btn.focus();
      }
      for (const [id, panel] of panels) panel.hidden = id !== key;
      store.set('settingsTab', key);
      if (location.hash.startsWith('#/reglages')) history.replaceState(null, '', '#/reglages/' + key);
    };
    nav.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-settings-tab]');
      if (btn && nav.contains(btn)) activate(btn.dataset.settingsTab);
    });
    nav.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const focused = event.target.closest('[data-settings-tab]');
      if (!focused || !nav.contains(focused)) return;
      event.preventDefault();
      const index = buttons.indexOf(focused);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      activate(buttons[next].dataset.settingsTab, true);
    });
    const previous = store.get('settingsTab', 'general');
    const requested = route.arg && panels.has(route.arg) ? route.arg : null;
    activate(requested || (panels.has(previous) ? previous : 'general'));

    if (mail) bindMailForm(mail);
    const securityForm = $('#security-settings-form');
    if (securityForm) securityForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = formData(securityForm);
      const error = $('.error-text', securityForm);
      error.hidden = true;
      const policy = {
        session_idle_minutes: Number(values.session_idle_minutes),
        session_max_hours: Number(values.session_max_hours),
        login_max_attempts: Number(values.login_max_attempts),
        login_lock_minutes: Number(values.login_lock_minutes),
        institution_logos: values.institution_logos,
        institution_logos_fallback: values.institution_logos_fallback,
        current_password: values.current_password,
      };
      if (!securityForm.elements.namedItem('require_2fa').disabled) policy.require_2fa = values.require_2fa;
      await withBusy(e.submitter, async () => {
        try {
          const response = await api('PUT', '/api/admin/security', policy);
          securityForm.elements.namedItem('current_password').value = '';
          toast('Sécurité du serveur enregistrée');
          if (response.needs_2fa_setup) {
            state.boot.needs_2fa_setup = true;
            location.hash = '#/compte';
          } else await render();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      });
    });
    const sf = $('#settings-form');
    if (sf) sf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = formData(sf);
      if (body.base_currency !== s.base_currency && !(await confirmDialog({ title: 'Changer de devise de référence ?', message: `Tous les totaux seront exprimés en ${body.base_currency} et les taux de change actuels seront effacés.`, confirm: 'Changer de devise' }))) return;
      try { const r = await api('PUT', '/api/settings', { base_currency: body.base_currency, stale_days: Number(body.stale_days) }); toast(r.warning || 'Réglages enregistrés'); render(); } catch (err) { fail(err); }
    });
    const of = $('#owner-form');
    if (of) of.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/owners', { name: of.name.value }); toast(`Titulaire ${of.name.value.trim()} ajouté`); render(); } catch (err) { fail(err); }
    });
    const rf = $('#rate-form');
    if (rf) rf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(rf);
      try { await api('PUT', '/api/fx', { rates: { [f.currency]: f.rate } }); toast(`Taux ${f.currency} enregistré`); render(); } catch (err) { fail(err); }
    });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Mon compte : profil, mot de passe, double authentification, sessions
  // ---------------------------------------------------------------------------------------------------------
  // ---------------------------------------------------------------------------------------------------------
  // Logos des établissements : état de chaque logo, recherche à la demande, images personnelles
  // ---------------------------------------------------------------------------------------------------------
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const msDate = (ms) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

  // Une ligne par établissement du catalogue, plus ceux saisis librement dans les avoirs ou dotés d'une image.
  function logoRows(st) {
    const usage = new Map();
    const perso = new Map();
    for (const u of st.in_use) {
      const key = logoKeyFor(u.name);
      if (!key) continue;
      usage.set(key, (usage.get(key) || 0) + u.count);
      if (!findInstitution(u.name) && !perso.has(key)) perso.set(key, u.name);
    }
    for (const [key, c] of Object.entries(st.custom)) if (key.startsWith('perso-') && !perso.has(key)) perso.set(key, c.name);
    const rows = state.inst.list.map((e) => ({ key: e.id, name: e.name, kind: e.kind, st: st.catalogue[e.id] || null, custom: st.custom[e.id] || null, used: usage.get(e.id) || 0 }));
    for (const [key, name] of perso) rows.push({ key, name, kind: 'Hors catalogue', st: null, custom: st.custom[key] || null, used: usage.get(key) || 0 });
    for (const r of rows) r.state = r.custom ? 'custom' : st.enabled && r.st && r.st.status === 'ok' ? 'ok' : 'none';
    return rows.sort((a, b) => (b.used > 0) - (a.used > 0) || a.name.localeCompare(b.name, 'fr'));
  }

  function logoSummarySection(st) {
    const rows = logoRows(st);
    const n = (k) => rows.filter((r) => r.state === k).length;
    const mine = rows.filter((r) => r.used);
    const sample = (mine.length ? mine : rows.filter((r) => r.state !== 'none')).slice(0, 14);
    return html`<section class="section" data-settings-group="etablissements"><div class="section-head">${h2i('bank', 'Logos des établissements')}<p>${st.enabled ? 'Récupérés sur OpenFinTech, Wikidata et les sites officiels, ou vos propres images' : 'Récupération désactivée : vos images, sinon monogrammes'}</p></div>
      <div class="panel logo-summary">
        ${sample.length ? html`<div class="logo-strip" aria-hidden="true">${sample.map((r) => instLogo(r.name, 's36'))}</div>` : ''}
        <p>${plural(n('ok'), 'logo officiel', 'logos officiels')} · ${plural(n('custom'), 'image personnelle', 'images personnelles')} · ${plural(n('none'), 'monogramme', 'monogrammes')}${mine.length ? html`<br><span class="small muted">Vos établissements : ${mine.filter((r) => r.state !== 'none').length} sur ${mine.length} avec un logo</span>` : ''}</p>
        <a class="btn" href="#/logos">${icon('bank')}Gérer les logos</a>
      </div></section>`;
  }

  // Image choisie sur l'appareil : lue par le navigateur (PNG, JPEG, WebP, GIF, SVG…), réduite à 256 px, envoyée en PNG.
  async function imageFileToPng(file) {
    if (file.size > 5 * 1024 * 1024) throw new Error('Image trop lourde : 5 Mo au maximum.');
    const url = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
      r.readAsDataURL(file);
    });
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error("Ce fichier n'est pas une image que le navigateur sait lire.")); img.src = url; });
    const w0 = img.naturalWidth || 256, h0 = img.naturalHeight || 256;
    if (Math.max(w0, h0) < 16) throw new Error('Image trop petite : 16 pixels de côté au minimum.');
    const scale = Math.min(1, 256 / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(16, Math.round(w0 * scale));
    canvas.height = Math.max(16, Math.round(h0 * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  }

  async function pageLogos(el, route, current) {
    let st = await api('GET', '/api/admin/logos');
    if (!current()) return;
    setHeader('Logos des établissements', 'Logos récupérés sur OpenFinTech, Wikidata et les sites officiels, ou vos propres images', html`<a class="btn" href="#/reglages/etablissements">${icon('settings')}Réglages</a>
      ${st.enabled ? html`<button class="btn primary" type="button" id="logos-fetch-all">${icon('update')}Rechercher les logos manquants</button>` : ''}`);
    let filter = store.get('logoFilter', 'all');
    let q = '';
    let timer = null;
    el.innerHTML = part(html`<div class="stack" id="logos-page">
      ${st.enabled ? '' : html`<div class="notice">${icon('info')}<div>La récupération des logos est désactivée (<b>INSTITUTION_LOGOS=false</b> dans data/config/vigie.env) : aucune connexion n'est faite vers les sites des établissements. Vos images personnelles s'affichent, sinon les monogrammes.</div></div>`}
      <div id="logo-summary"></div>
      <div class="toolbar">
        <input class="input" type="search" id="logo-search" placeholder="Rechercher un établissement…" aria-label="Rechercher un établissement">
        <div class="seg" role="group" aria-label="Établissements affichés">${[['all', 'Tous'], ['mine', 'Mes établissements'], ['none', 'Sans logo']].map(([k, l]) => html`<button type="button" data-filter="${k}" aria-pressed="${filter === k}">${l}</button>`)}</div>
      </div>
      <div id="logo-list"></div>
      <p class="small muted">Vigie recherche d'abord les logos dans OpenFinTech et Wikidata, y compris pour les établissements issus de Sirene. Si aucune image n'est disponible, le serveur cherche l'icône du site officiel (apple-touch-icon, favicon) et garde le résultat en base.${st.fallback ? " Si le site bloque la récupération ou n'offre qu'une petite icône, Vigie la demande au service d'icônes de Google, qui ne reçoit que le nom de domaine de l'établissement." : ''} Les logos sont recherchés de nouveau tous les 30 jours, et 3 jours après un échec. Une image personnelle (PNG, JPEG, WebP ou SVG, réduite à 256 pixels) remplace le logo pour tous les utilisateurs et sert aussi pour un établissement hors catalogue.</p>
      <input type="file" id="logo-file" accept="image/*" hidden></div>`);
    const root = $('#logos-page');

    // Logo complet (horizontal) trouvé en plus de la pastille : aperçu et provenance.
    const fullCell = (r) => (r.st && r.st.full && state.logoFull && state.logoFull[r.key]
      ? html`<span class="sub full-line">${instFullLogo(r.name)}<span>Logo complet ${r.st.full.width} × ${r.st.full.height} px${r.st.full.source === 'commons.wikimedia.org' ? ', Wikimedia Commons' : ''}</span></span>` : '');
    const statusCell = (r) => {
      if (r.custom) return html`<span class="tag brand">${icon('pencil')}Image personnelle</span><span class="sub">${r.custom.width && r.custom.height ? `${r.custom.width} × ${r.custom.height} px, ` : ''}ajoutée le ${msDate(r.custom.updated_at)}</span>`;
      if (!r.st) return html`<span class="tag">${icon('info')}Monogramme</span><span class="sub">Hors catalogue : ajoutez une image</span>`;
      if (!st.enabled) return html`<span class="tag">${icon('info')}Monogramme</span><span class="sub">Récupération désactivée</span>`;
      const s = r.st;
      if (s.status === 'ok') {
        const small = s.width && Math.min(s.width, s.height) < 64;
        let from = '';
        try { from = new URL(s.source).host; } catch { from = s.source || ''; }
        const provenance = s.source === 'commons.wikimedia.org' ? 'Wikimedia Commons' : s.source === 'static.openfintech.io' ? 'OpenFinTech' : 'Logo trouvé';
        return html`<span class="tag brand">${icon('check')}${provenance}</span><span class="sub">${s.width ? `${s.width} × ${s.height} px` : 'taille inconnue'}${from ? `, ${from}` : ''}, le ${msDate(s.fetched_at)}</span>${small ? html`<span class="sub warn">${icon('alert')}Petite icône : une image plus grande sera plus nette</span>` : ''}${fullCell(r)}`;
      }
      if (s.status === 'wide_only') return html`<span class="tag">${icon('info')}Monogramme</span><span class="sub">Seul un logo horizontal existe : il s'affiche dans le détail des avoirs. Pour la pastille, ajoutez une image carrée.</span>${fullCell(r)}`;
      if (s.status === 'fetching') return html`<span class="tag">${icon('clock')}Recherche en cours…</span>`;
      if (s.status === 'failed') return html`<span class="tag stale">${icon('alert')}Introuvable</span><span class="sub">Site inaccessible ou sans icône. Nouvel essai automatique le ${msDate(s.retry_after)}</span>`;
      if (s.status === 'no_site') return html`<span class="tag">${icon('info')}Monogramme</span><span class="sub">Aucun site officiel connu</span>`;
      return html`<span class="tag">${icon('clock')}Pas encore recherché</span>`;
    };
    const draw = () => {
      const rows = logoRows(st);
      const n = (k) => rows.filter((r) => r.state === k).length;
      const b = st.batch;
      $('#logo-summary').innerHTML = part(html`<div class="figures-row">
          <div><b>${n('ok')}</b><span>${n('ok') > 1 ? 'logos officiels' : 'logo officiel'}</span></div>
          <div><b>${n('custom')}</b><span>${n('custom') > 1 ? 'images personnelles' : 'image personnelle'}</span></div>
          <div><b>${n('none')}</b><span>${n('none') > 1 ? 'monogrammes' : 'monogramme'}</span></div>
        </div>
        ${b ? html`<div class="batch"><div class="progress" role="progressbar" aria-label="Recherche des logos" aria-valuemin="0" aria-valuemax="${b.total}" aria-valuenow="${b.done}"><span style="width:${b.total ? Math.round((b.done / b.total) * 100) : 0}%"></span></div>
          <p class="small muted">Recherche en cours : ${b.done} sur ${b.total}, ${plural(b.found, 'logo trouvé', 'logos trouvés')}</p></div>`
          : st.last_batch && st.last_batch.total ? html`<p class="small muted">Dernière recherche le ${dateTime(st.last_batch.finished_at)} : ${plural(st.last_batch.found, 'logo trouvé', 'logos trouvés')} sur ${st.last_batch.total}.</p>` : ''}`);
      const fq = fold(q.trim());
      const shown = rows.filter((r) => (filter === 'all' || (filter === 'mine' ? r.used > 0 : r.state === 'none')) && (!fq || fold(r.name).includes(fq) || fold(r.kind).includes(fq)));
      $('#logo-list').innerHTML = part(shown.length ? html`<div class="panel flush table-wrap"><table class="table logos-table"><thead><tr><th>Établissement</th><th>Logo</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${shown.map((r) => html`<tr>
          <td><span class="cell-lead">${instLogo(r.name, 's36')}<span><b>${r.name}</b><br><span class="small muted">${r.kind}${r.used ? `, ${plural(r.used, 'avoir', 'avoirs')}` : ''}</span></span></span></td>
          <td class="logo-status">${statusCell(r)}</td>
          <td class="num"><div class="row-actions">
            ${st.enabled && r.st && r.st.host && !r.custom ? html`<button class="btn small" type="button" data-logo="fetch" data-key="${r.key}" data-name="${r.name}" aria-label="${r.state === 'ok' ? 'Actualiser' : 'Rechercher'} le logo de ${r.name}">${icon('update')}<span>${r.state === 'ok' ? 'Actualiser' : 'Rechercher'}</span></button>` : ''}
            <button class="btn small" type="button" data-logo="upload" data-key="${r.key}" data-name="${r.name}" aria-label="${r.custom ? "Remplacer l'image" : 'Choisir une image'} de ${r.name}">${icon('upload')}<span>${r.custom ? 'Remplacer' : 'Image…'}</span></button>
            ${r.custom ? html`<button class="btn small danger" type="button" data-logo="remove" data-key="${r.key}" data-name="${r.name}" aria-label="Retirer l'image de ${r.name}">${icon('trash')}<span>Retirer</span></button>` : ''}
          </div></td></tr>`)}
        </tbody></table></div>` : html`<div class="panel empty">${pict('search', 'lg')}<p>${filter === 'none' && !fq ? 'Tous les établissements ont un logo.' : 'Aucun établissement ne correspond.'}</p></div>`);
    };
    const schedule = () => {
      clearTimeout(timer);
      if (st.batch || Object.values(st.catalogue).some((r) => r.status === 'fetching')) timer = setTimeout(() => { if (current()) load().catch(() => {}); }, 2000);
    };
    const load = async () => {
      st = await api('GET', '/api/admin/logos');
      if (!current()) return;
      await loadLogoVersions();
      draw();
      schedule();
    };
    draw();
    schedule();

    $('#logo-search').addEventListener('input', (e) => { q = e.target.value; draw(); });
    $$('[data-filter]', root).forEach((b) => b.addEventListener('click', () => {
      filter = b.dataset.filter;
      store.set('logoFilter', filter);
      $$('[data-filter]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      draw();
    }));
    const all = $('#logos-fetch-all');
    if (all) all.addEventListener('click', () => withBusy(all, async () => {
      try {
        const r = await api('POST', '/api/admin/logos/fetch', {});
        toast(r.total ? `Recherche de ${plural(r.total, 'logo', 'logos')} lancée` : 'Tous les logos sont à jour');
        await load();
      } catch (err) { fail(err); }
    }));
    const fileInput = $('#logo-file');
    let target = null;
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file || !target) return;
      try {
        const data = await imageFileToPng(file);
        await api('PUT', `/api/admin/logos/${target.key}`, { name: target.name, data });
        toast(`Image enregistrée pour ${target.name}`);
        await load();
      } catch (err) { fail(err); }
    });
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-logo]');
      if (!b) return;
      const { key, name } = b.dataset;
      if (b.dataset.logo === 'upload') { target = { key, name }; fileInput.click(); return; }
      if (b.dataset.logo === 'remove') {
        if (!(await confirmDialog({ title: `Retirer l'image de ${name} ?`, message: 'Le logo officiel récupéré par Vigie, ou à défaut le monogramme, s\'affichera de nouveau.', confirm: 'Retirer', danger: true }))) return;
        try { await api('DELETE', `/api/admin/logos/${key}`); toast(`Image retirée pour ${name}`); await load(); } catch (err) { fail(err); }
        return;
      }
      if (b.dataset.logo === 'fetch') await withBusy(b, async () => {
        try {
          const r = await api('POST', '/api/admin/logos/fetch', { id: key });
          toast(r.status === 'ok' ? `Logo trouvé pour ${name}${r.width ? ` (${r.width} × ${r.height} px)` : ''}` : r.status === 'fetching' ? `Recherche toujours en cours pour ${name}` : `Aucun logo trouvé pour ${name} : vous pouvez déposer une image`, r.status === 'failed' ? 'error' : 'ok');
          await load();
        } catch (err) { fail(err); }
      });
    });
  }

  function uaLabel(ua) {
    if (!ua) return 'Appareil inconnu';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${browser} sur ${os}` : browser;
  }

  // Installation de l'application (PWA) : état selon le navigateur et l'appareil.
  function installSection() {
    const st = pwa.state();
    const body = {
      installed: html`<p><span class="tag brand">${icon('check')}Installée</span></p><p class="muted">Vous utilisez Vigie comme une application sur cet appareil.</p>`,
      prompt: html`<p class="muted">Ajoutez Vigie à l'écran d'accueil ou au menu des applications : elle s'ouvre dans sa propre fenêtre, sans barre d'adresse.</p>
        <div><button class="btn primary" type="button" data-action="install-app">${icon('download')}Installer Vigie</button></div>`,
      ios: html`<p class="muted">Sur iPhone et iPad, dans <b>Safari</b> : touchez ${il('upload', 'Partager')}, puis <b>Sur l'écran d'accueil</b>, puis <b>Ajouter</b>.</p>`,
      insecure: html`<div class="notice">${icon('lock')}<div>L'installation demande une connexion sécurisée (HTTPS). Ouvrez Vigie avec son adresse Cloudflare, par exemple <b>https://patrimoine.exemple.fr</b>, puis revenez ici. Par l'adresse locale http://IP:port, Vigie reste utilisable dans le navigateur.</div></div>`,
      manual: html`<p class="muted">Dans le menu du navigateur, choisissez <b>Installer Vigie</b> ou <b>Ajouter à l'écran d'accueil</b>. Sur Mac avec Safari : menu Fichier, <b>Ajouter au Dock</b>.</p>`,
    }[st];
    return html`${h2i('phone', 'Application sur cet appareil')}<div class="panel form">${body}
      <p class="small muted">${il('shield', "Aucune donnée de patrimoine n'est enregistrée sur l'appareil : l'application affiche les chiffres de votre serveur à chaque ouverture.")}</p></div>`;
  }

  async function pageAccount(el, route, current) {
    const [{ user, require_2fa }, { sessions }] = await Promise.all([api('GET', '/api/account'), api('GET', '/api/account/sessions')]);
    if (!current()) return;
    state.user = user;
    setHeader('Mon compte', `${user.username}, ${ROLE[user.role].toLowerCase()}`);
    el.innerHTML = part(html`
      ${state.boot.needs_2fa_setup && !user.totp_enabled ? html`<div class="notice">${icon('shield')}<div>La double authentification est obligatoire sur ce serveur. Activez-la pour accéder à vos données.</div></div>` : ''}
      <div class="cols">
        <div class="stack">
          <section class="section" id="install-section">${installSection()}</section>
          <section class="section">${h2i('shield', 'Double authentification')}<div class="panel form" id="totp-panel">
            ${user.totp_enabled ? html`<p><span class="tag brand">${icon('check')} Active</span></p>
              <p class="muted">À chaque connexion, un code de votre application d'authentification est demandé après le mot de passe. Codes de secours restants : <b>${user.recovery_codes_left}</b>.</p>
              <div class="toolbar"><button class="btn" data-action="regen-codes">${icon('key')}Générer de nouveaux codes de secours</button>${require_2fa ? '' : html`<button class="btn danger" data-action="disable-totp">${icon('unlock')}Désactiver</button>`}</div>`
            : html`<p class="muted">Protégez l'accès à votre patrimoine avec un code temporaire, généré par une application comme Aegis, 2FAS, Google Authenticator, Microsoft Authenticator ou Bitwarden.</p>
              <div><button class="btn primary" data-action="setup-totp">${icon('shield')}Activer la double authentification</button></div>`}
          </div></section>
          <section class="section"><div class="section-head">${h2i('devices', 'Sessions ouvertes')}${sessions.length > 1 ? html`<button class="btn small" data-action="revoke-others">${icon('logout')}Fermer les autres sessions</button>` : ''}</div>
            <div class="panel flush table-wrap"><table class="table"><thead><tr><th>Appareil</th><th>Adresse IP</th><th>Dernière activité</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
            ${sessions.map((x) => html`<tr><td>${il(/iPhone|Android|Mobile/.test(x.user_agent || '') ? 'phone' : 'devices', uaLabel(x.user_agent))}${x.current ? html` <span class="tag brand">Cette session</span>` : ''}</td><td>${x.ip || '—'}</td><td>${dateTime(x.last_seen_at)}</td>
              <td class="num">${x.current ? '' : html`<button class="btn small" data-action="revoke-session" data-id="${x.id}">${icon('logout')}Fermer</button>`}</td></tr>`)}
            </tbody></table></div></section>
        </div>
        <div class="stack">
          <section class="section">${h2i('user', 'Profil')}<form class="panel form" id="profile-form">
            <div class="cell-lead">${avatar(user.display_name, 'lg')}<div><b>${user.display_name}</b><br><span class="small muted">${il(ROLE_ICON[user.role], ROLE[user.role])}</span></div></div>
            ${nameFields(user)}
            <label class="field"><span>Adresse e-mail</span><input class="input" type="email" name="email" value="${user.email}" autocomplete="email" autocapitalize="off"><small>Pour recevoir un lien « Mot de passe oublié ».</small></label>
            <label class="field" data-email-pw hidden><span>Mot de passe actuel</span><input class="input" type="password" name="current_password" autocomplete="current-password"><small>Demandé pour changer d'adresse e-mail.</small></label>
            <div class="form-actions"><button class="btn" type="submit">${icon('check')}Enregistrer</button></div></form></section>
          <section class="section">${h2i('key', 'Mot de passe')}<form class="panel form" id="password-form">
            <input type="text" name="username" value="${user.username}" autocomplete="username" hidden>
            <label class="field"><span>Mot de passe actuel</span><input class="input" type="password" name="current_password" autocomplete="current-password" required></label>
            <label class="field"><span>Nouveau mot de passe</span><input class="input" type="password" name="new_password" autocomplete="new-password" minlength="10" required><small>10 caractères minimum. Les autres sessions seront fermées.</small></label>
            <label class="field"><span>Confirmation</span><input class="input" type="password" name="confirm" autocomplete="new-password" minlength="10" required></label>
            <div class="form-actions"><button class="btn" type="submit">${icon('key')}Changer le mot de passe</button></div></form></section>
        </div>
      </div>`);
    const pf = $('#profile-form');
    pf.email.addEventListener('input', () => {
      const changed = pf.email.value.trim().toLowerCase() !== (user.email || '');
      $('[data-email-pw]', pf).hidden = !changed;
      pf.current_password.required = changed;
    });
    $('#profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api('PATCH', '/api/account', formData(e.target)); state.user = r.user; toast('Profil enregistré'); shell(); render(); } catch (err) { fail(err); }
    });
    $('#password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      if (f.new_password !== f.confirm) { fail(new Error('Les deux nouveaux mots de passe ne correspondent pas.')); return; }
      try { await api('POST', '/api/account/password', f); e.target.reset(); toast('Mot de passe modifié'); render(); } catch (err) { fail(err); }
    });
  }

  function showRecoveryCodes(codes) {
    const text = `Vigie Patrimoine : codes de secours de ${state.user.username}\nChaque code ne fonctionne qu'une fois.\n\n${codes.join('\n')}\n`;
    openDialog(html`<div class="dialog-body">${dialogHead('Vos codes de secours', "Ils remplacent le code de l'application si vous perdez votre téléphone. Chacun ne sert qu'une fois.")}
      <div class="codes">${codes.map((c) => html`<span>${c}</span>`)}</div>
      <p class="notice">${icon('alert')}<span>Ces codes ne seront plus affichés. Conservez-les dans un gestionnaire de mots de passe ou sur papier.</span></p>
      <div class="form-actions"><button class="btn" type="button" id="dl-codes">${icon('download')}Télécharger</button><button class="btn primary" type="button" data-action="close-dialog">J'ai conservé mes codes</button></div></div>`,
    { onClose: () => render() });
    $('#dl-codes').addEventListener('click', () => download('vigie-codes-de-secours.txt', text));
  }

  async function setupTotp() {
    let r;
    try { r = await api('POST', '/api/account/totp/setup'); } catch (err) { fail(err); return; }
    let qrSvg = '';
    try { const q = window.qrcode(0, 'M'); q.addData(r.uri); q.make(); qrSvg = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch { qrSvg = ''; }
    const d = openDialog(html`<form class="dialog-body form">${dialogHead('Activer la double authentification')}
      <div class="qr"><div class="code" aria-label="QR code à scanner">${raw(qrSvg)}</div>
        <div class="form"><p>Scannez ce QR code avec votre application d'authentification.</p><p class="small muted">Impossible de scanner ? Saisissez cette clé :</p><p class="secret">${r.secret.replace(/(.{4})/g, '$1 ').trim()}</p></div></div>
      <label class="field"><span>Code à 6 chiffres affiché par l'application</span><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="7" autofocus></label>
      <p class="error-text" hidden></p>
      <div class="form-actions"><button class="btn" type="button" data-action="close-dialog">Annuler</button><button class="btn primary" type="submit">Activer</button></div></form>`);
    const form = d.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await withBusy(e.submitter, async () => {
        try {
          const res = await api('POST', '/api/account/totp/enable', { code: form.code.value });
          state.boot.needs_2fa_setup = false;
          state.user.totp_enabled = true;
          shell();
          showRecoveryCodes(res.recovery_codes);
        } catch (err) { const p = form.querySelector('.error-text'); p.textContent = err.message; p.hidden = false; }
      });
    });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Utilisateurs (administrateur)
  // ---------------------------------------------------------------------------------------------------------
  // --- Envoi d'e-mails (Réglages, administrateur) ------------------------------------------------------------------
  const SEC_LABEL = { starttls: 'STARTTLS', tls: 'SSL/TLS', none: 'sans chiffrement' };
  const SEC_PORT = { starttls: 587, tls: 465, none: 25 };
  // Réglages usuels de quelques messageries : appliqués quand on choisit le serveur dans la liste.
  const SMTP_PRESETS = {
    'smtp.gmail.com': [587, 'starttls', "Gmail : créez un mot de passe d'application (compte Google → Sécurité → Validation en deux étapes) ; l'identifiant est l'adresse Gmail."],
    'smtp.mail.me.com': [587, 'starttls', "iCloud : mot de passe d'application obligatoire (compte Apple) ; l'identifiant est l'adresse iCloud."],
    'ssl0.ovh.net': [465, 'tls', "OVHcloud : l'identifiant est l'adresse e-mail complète."],
    'smtp.free.fr': [465, 'tls', "Free : l'identifiant est l'adresse e-mail complète."],
    'smtp.orange.fr': [465, 'tls', "Orange : l'identifiant est l'adresse e-mail complète."],
    'smtp.sfr.fr': [465, 'tls', "SFR : l'identifiant est l'adresse e-mail complète."],
    'smtp-relay.brevo.com': [587, 'starttls', "Brevo : identifiant et clé SMTP indiqués dans votre compte Brevo ; l'adresse d'expédition doit y être validée."],
  };

  function mailSection(m) {
    const s = m.settings || {};
    return html`<section class="section" id="mail-section" data-settings-group="emails"><div class="section-head">${h2i('mail', "Envoi d'e-mails")}<p>Invitations et « Mot de passe oublié »</p></div>
      <div class="panel form">
        ${m.settings ? html`<div class="notice info">${icon('check')}<div>Envoi configuré : <b>${s.host}:${s.port}</b> (${SEC_LABEL[s.security]}), expéditeur ${s.from_address}.</div></div>`
          : html`<div class="notice">${icon('info')}<div>Envoi non configuré : les invitations par e-mail et « Mot de passe oublié » sont indisponibles. Renseignez le serveur SMTP de votre messagerie ou de votre hébergeur.</div></div>`}
        <form class="form" id="mail-form" autocomplete="off" novalidate>
          <div class="grid-3 mail-server">
            <label class="field"><span>Serveur SMTP</span><input class="input" name="host" list="smtp-hosts" required value="${s.host || ''}" placeholder="smtp.exemple.fr" spellcheck="false" autocapitalize="off">
              <datalist id="smtp-hosts">${Object.keys(SMTP_PRESETS).map((h) => html`<option value="${h}"></option>`)}</datalist></label>
            <label class="field"><span>Port</span><input class="input" name="port" type="number" inputmode="numeric" min="1" max="65535" required value="${s.port || 587}"></label>
            <label class="field"><span>Sécurité</span><select class="select" name="security">${[['starttls', 'STARTTLS (port 587)'], ['tls', 'SSL/TLS (port 465)'], ['none', 'Aucune (relais local, port 25)']].map(([k, l]) => html`<option value="${k}" ${(s.security || 'starttls') === k ? 'selected' : ''}>${l}</option>`)}</select></label>
          </div>
          <p class="small muted" id="smtp-hint" ${SMTP_PRESETS[s.host] ? '' : raw('hidden')}>${SMTP_PRESETS[s.host] ? SMTP_PRESETS[s.host][2] : ''}</p>
          <div class="grid-2">
            <label class="field"><span>Identifiant</span><input class="input" name="username" value="${s.username || ''}" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="Souvent l'adresse e-mail complète"></label>
            <label class="field"><span>Mot de passe</span><input class="input" name="password" type="password" autocomplete="new-password" placeholder="${s.password_set ? 'Enregistré : laisser vide pour le garder' : ''}"><small>Chiffré dans la base de Vigie.</small></label>
          </div>
          <div class="grid-2">
            <label class="field"><span>Adresse d'expédition</span><input class="input" name="from_address" type="email" required value="${s.from_address || ''}" placeholder="vigie@exemple.fr" autocapitalize="off"><small>Souvent la même que l'identifiant.</small></label>
            <label class="field"><span>Nom de l'expéditeur</span><input class="input" name="from_name" maxlength="80" value="${s.from_name || 'Vigie Patrimoine'}"></label>
          </div>
          <label class="field"><span>Adresse de Vigie dans les liens</span><input class="input" name="public_url" required value="${s.public_url || m.suggested_public_url}" spellcheck="false" autocapitalize="off" placeholder="https://patrimoine.exemple.fr">
            <small>Adresse qu'ouvriront vos invités. Mettez l'adresse Cloudflare (https://…) pour que les liens fonctionnent hors de chez vous.</small></label>
          <label class="check"><input type="checkbox" name="allow_invalid_cert" ${s.allow_invalid_cert ? 'checked' : ''}><span>Accepter un certificat non vérifié (relais de votre réseau local uniquement)</span></label>
          <div class="mail-test">
            <label class="field"><span>Envoyer un test à</span><input class="input" name="test_to" type="email" value="${state.user.email || ''}" placeholder="vous@exemple.fr" autocapitalize="off"></label>
            <button class="btn" type="button" id="mail-test">${icon('send')}Envoyer un e-mail de test</button>
          </div>
          <div id="mail-test-result" aria-live="polite"></div>
          <p class="error-text" role="alert" hidden></p>
          <div class="form-actions">${m.settings ? html`<button class="btn danger" type="button" id="mail-disable">${icon('close')}Désactiver l'envoi</button>` : ''}<button class="btn primary" type="submit">${icon('check')}Enregistrer</button></div>
        </form>
      </div></section>`;
  }

  function bindMailForm() {
    const f = $('#mail-form');
    const errEl = f.querySelector('.error-text');
    const values = () => { const v = formData(f); v.port = Number(v.port); const to = v.test_to; delete v.test_to; return { v, to }; };
    const hint = $('#smtp-hint');
    f.host.addEventListener('change', () => {
      const p = SMTP_PRESETS[f.host.value.trim().toLowerCase()];
      hint.hidden = !p;
      if (!p) return;
      hint.textContent = p[2];
      f.port.value = p[0];
      f.security.value = p[1];
      if (!f.from_address.value && /@/.test(f.username.value)) f.from_address.value = f.username.value.trim();
    });
    f.security.addEventListener('change', () => { if (['587', '465', '25', ''].includes(f.port.value)) f.port.value = SEC_PORT[f.security.value]; });
    f.username.addEventListener('change', () => { if (!f.from_address.value && /@/.test(f.username.value)) f.from_address.value = f.username.value.trim(); });
    const check = () => { errEl.hidden = true; return f.reportValidity(); };
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!check()) return;
      await withBusy(e.submitter, async () => {
        try { await api('PUT', '/api/admin/mail', values().v); toast("Envoi d'e-mails enregistré"); state.boot.password_reset = true; await render(); }
        catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
      });
    });
    $('#mail-test').addEventListener('click', async (e) => {
      if (!check()) return;
      const { v, to } = values();
      const out = $('#mail-test-result');
      if (!to) { f.test_to.focus(); out.innerHTML = part(html`<p class="error-text">Indiquez l'adresse qui doit recevoir le test.</p>`); return; }
      out.innerHTML = part(html`<p class="small muted">${il('clock', 'Connexion au serveur…')}</p>`);
      await withBusy(e.currentTarget, async () => {
        try {
          await api('POST', '/api/admin/mail/test', { ...v, to });
          out.innerHTML = part(html`<div class="notice info">${icon('check')}<div>E-mail de test envoyé à <b>${to}</b>. Vérifiez la boîte de réception, et les courriers indésirables. ${values().v.host && !$('#mail-disable') ? 'Pensez à enregistrer.' : ''}</div></div>`);
        } catch (err) {
          out.innerHTML = part(html`<div class="notice bad">${icon('alert')}<div><b>Échec de l'envoi${err.data && err.data.stage ? ` (${err.data.stage})` : ''}.</b> ${err.message}</div></div>`);
        }
      });
    });
    const off = $('#mail-disable');
    if (off) off.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: "Désactiver l'envoi d'e-mails ?", message: "Les réglages SMTP sont effacés. Les invitations par e-mail et « Mot de passe oublié » ne seront plus disponibles. Les comptes existants ne changent pas.", confirm: 'Désactiver', danger: true }))) return;
      try { await api('DELETE', '/api/admin/mail'); state.boot.password_reset = false; toast("Envoi d'e-mails désactivé"); render(); } catch (err) { fail(err); }
    });
  }

  // --- Invitations (Utilisateurs) ----------------------------------------------------------------------------------
  async function copyText(value, input) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(value); return true; } } catch { /* repli ci-dessous */ }
    if (!input) return false;
    input.focus();
    input.select();
    try { return document.execCommand('copy'); } catch { return false; }
  }

  function inviteResult(r) {
    const name = [r.invitation.first_name, r.invitation.last_name].filter(Boolean).join(' ') || r.invitation.email;
    openDialog(html`<div class="dialog-body">
      ${dialogHead(r.sent ? 'Invitation envoyée' : "Lien d'invitation prêt", r.sent ? `Un e-mail a été envoyé à ${r.invitation.email}.` : `Transmettez ce lien à ${name} par le moyen de votre choix.`, pict(r.sent ? 'send' : 'link', 'lg'))}
      <p>${name} choisira son nom d'utilisateur et son mot de passe, avec le rôle <b>${ROLE[r.invitation.role]}</b>. Le lien est valable jusqu'au ${dateTime(r.invitation.expires_at)} et ne sert qu'une fois.</p>
      <div class="field"><label for="invite-link">Lien d'invitation</label><div class="copy-row"><input class="input" id="invite-link" readonly value="${r.link}"><button class="btn" type="button" id="copy-invite">${icon('copy')}Copier</button></div>
        <small>Ne le publiez pas : toute personne qui l'ouvre peut créer ce compte.</small></div>
      <div class="form-actions"><button class="btn primary" type="button" data-action="close-dialog">Terminé</button></div>
    </div>`, { onClose: () => render() });
    $('#copy-invite').addEventListener('click', async () => toast((await copyText(r.link, $('#invite-link'))) ? 'Lien copié' : 'Sélectionnez le lien et copiez-le', 'ok'));
  }

  function inviteForm() {
    const ready = Boolean($('#page')._mailReady);
    const d = openDialog(html`<form class="dialog-body form" id="invite-form">
      ${dialogHead('Inviter par e-mail', "La personne reçoit un lien pour créer son compte : elle choisit elle-même son nom d'utilisateur et son mot de passe.", pict('mail', 'lg'))}
      ${ready ? '' : html`<div class="notice">${icon('info')}<div>L'envoi d'e-mails n'est pas configuré (Réglages → Envoi d'e-mails). Vous pouvez quand même créer un lien et le transmettre vous-même.</div></div>`}
      <label class="field"><span>Adresse e-mail</span><input class="input" type="email" name="email" required autocomplete="off" autocapitalize="off" autofocus></label>
      <div class="grid-2">
        <label class="field"><span>Prénom <span class="muted">(facultatif)</span></span><input class="input" name="first_name" maxlength="60" autocomplete="off"></label>
        <label class="field"><span>Nom <span class="muted">(facultatif)</span></span><input class="input" name="last_name" maxlength="60" autocomplete="off"></label>
      </div>
      <label class="field"><span>Rôle</span><select class="select" name="role">${Object.entries(ROLE).map(([k, l]) => html`<option value="${k}" ${k === 'viewer' ? 'selected' : ''}>${l}</option>`)}</select><small data-role-hint>${ROLE_HINT.viewer}</small></label>
      <p class="error-text" role="alert" hidden></p>
      <div class="form-actions"><button class="btn" type="button" data-action="close-dialog">Annuler</button>
        ${ready ? html`<button class="btn" type="submit" value="link">${icon('link')}Lien sans e-mail</button><button class="btn primary" type="submit" value="send">${icon('send')}Envoyer l'invitation</button>`
          : html`<button class="btn primary" type="submit" value="link">${icon('link')}Créer le lien</button>`}</div>
    </form>`);
    const form = $('#invite-form', d);
    form.role.addEventListener('change', () => { $('[data-role-hint]', form).textContent = ROLE_HINT[form.role.value]; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const send = ready && (!e.submitter || e.submitter.value === 'send');
      await withBusy(e.submitter, async () => {
        try { inviteResult(await api('POST', '/api/admin/invitations', { ...formData(form), send })); }
        catch (err) { const p = form.querySelector('.error-text'); p.textContent = err.message; p.hidden = false; }
      });
    });
  }

  async function pageUsers(el, route, current) {
    const [{ users }, inv] = await Promise.all([api('GET', '/api/users'), api('GET', '/api/admin/invitations')]);
    if (!current()) return;
    setHeader('Utilisateurs', 'Qui peut consulter ou modifier le patrimoine', html`<button class="btn" data-action="new-user">${icon('plus')}Ajouter directement</button><button class="btn primary" data-action="invite-user">${icon('mail')}Inviter par e-mail</button>`);
    el.innerHTML = part(html`
      ${inv.invitations.length ? html`<section class="section"><div class="section-head">${h2i('mail', 'Invitations en attente')}<p>Le compte est créé quand la personne ouvre le lien</p></div>
        <div class="panel flush table-wrap"><table class="table invites"><thead><tr><th>Invité</th><th>Rôle</th><th>Envoi</th><th>Validité</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${inv.invitations.map((i) => html`<tr><td><div class="cell-lead">${avatar([i.first_name, i.last_name].filter(Boolean).join(' ') || i.email, 'sm')}<div><b style="font-weight:500">${[i.first_name, i.last_name].filter(Boolean).join(' ') || i.email}</b><br><span class="small muted">${i.email}</span></div></div></td>
          <td>${il(ROLE_ICON[i.role], ROLE[i.role])}</td>
          <td>${i.sent_at ? il('mail', `E-mail du ${dateTime(i.sent_at)}`) : il('link', 'Lien à transmettre')}<br><span class="small muted">par ${i.invited_by || 'un administrateur'}</span></td>
          <td>${i.status === 'expired' ? html`<span class="tag stale">${icon('clock')}Expirée</span>` : html`jusqu'au ${dateTime(i.expires_at)}`}</td>
          <td class="num"><div class="row-actions">
            ${inv.mail_ready ? html`<button class="btn small" type="button" data-action="invite-resend" data-id="${i.id}" data-email="${i.email}">${icon('send')}Renvoyer</button>` : ''}
            <button class="btn small" type="button" data-action="invite-link" data-id="${i.id}">${icon('link')}Nouveau lien</button>
            <button class="btn small danger" type="button" data-action="invite-cancel" data-id="${i.id}" data-email="${i.email}">${icon('trash')}Annuler</button>
          </div></td></tr>`)}
        </tbody></table></div></section>` : ''}
      <div class="panel flush table-wrap"><table class="table"><thead><tr><th>Utilisateur</th><th>Rôle</th><th>Double authentification</th><th>Dernière connexion</th><th>État</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${users.map((u) => html`<tr><td><div class="cell-lead">${avatar(u.display_name, 'sm')}<div><b style="font-weight:500">${u.display_name}</b><br><span class="small muted">${u.username}${u.email ? ` · ${u.email}` : ''}</span></div></div></td><td>${il(ROLE_ICON[u.role], ROLE[u.role])}</td>
        <td>${u.totp_enabled ? html`<span class="tag brand">${icon('shield')}Active</span>` : html`<span class="tag">${icon('unlock')}Inactive</span>`}</td><td>${dateTime(u.last_login_at)}</td>
        <td>${u.disabled ? html`<span class="tag bad">${icon('close')}Désactivé</span>` : u.locked ? html`<span class="tag stale">${icon('lock')}Bloqué</span>` : il('check', 'Actif')}</td>
        <td class="num"><button class="btn small" data-action="edit-user" data-id="${u.id}">${icon('settings')}Gérer</button></td></tr>`)}
      </tbody></table></div>
      <section class="section">${h2i('users', 'Les rôles')}<div class="panel"><dl class="kv">${Object.entries(ROLE).map(([k, l]) => html`<dt>${icon(ROLE_ICON[k])}${l}</dt><dd>${ROLE_HINT[k]}</dd>`)}</dl></div></section>`);
    el._users = users;
    el._mailReady = inv.mail_ready;
  }

  function userForm(u = null) {
    const roles = Object.entries(ROLE).map(([k, l]) => html`<option value="${k}" ${u ? (u.role === k ? 'selected' : '') : k === 'viewer' ? 'selected' : ''}>${l}</option>`);
    const self = u && u.id === state.user.id;
    const d = openDialog(html`<div class="dialog-body">
      ${dialogHead(u ? u.display_name : 'Ajouter un utilisateur', u ? `Identifiant : ${u.username}` : "Communiquez-lui son mot de passe provisoire : il pourra le changer dans « Mon compte ».", u ? avatar(u.display_name, 'lg') : pict('user', 'lg'))}
      <form class="form" id="user-form">
        ${u ? '' : html`<label class="field"><span>Nom d'utilisateur</span><input class="input" name="username" required minlength="3" maxlength="40" autocomplete="off" autofocus></label>`}
        ${nameFields(u || {}, Boolean(u))}
        <label class="field"><span>Adresse e-mail <span class="muted">(facultative)</span></span><input class="input" type="email" name="email" value="${u ? u.email : ''}" autocomplete="off" autocapitalize="off"><small>Permet d'utiliser « Mot de passe oublié ».</small></label>
        <label class="field"><span>Rôle</span><select class="select" name="role" ${self ? 'disabled' : ''}>${roles}</select></label>
        ${u ? (self ? '' : html`<label class="check"><input type="checkbox" name="disabled" ${u.disabled ? 'checked' : ''}><span>Compte désactivé (connexion impossible)</span></label>`)
          : html`<label class="field"><span>Mot de passe provisoire</span><input class="input" name="password" type="text" required minlength="10" autocomplete="off"><small>10 caractères minimum.</small></label>`}
        <p class="error-text" hidden></p>
        <div class="form-actions"><button class="btn" type="button" data-action="close-dialog">Annuler</button><button class="btn primary" type="submit">${icon(u ? 'check' : 'plus')}${u ? 'Enregistrer' : "Ajouter l'utilisateur"}</button></div>
      </form>
      ${u ? html`<section class="section">${h3i('settings', 'Autres actions')}<div class="toolbar">
        <button class="btn small" data-action="user-password" data-id="${u.id}">${icon('key')}Définir un nouveau mot de passe</button>
        ${u.email && $('#page')._mailReady && !u.disabled ? html`<button class="btn small" data-action="user-reset-link" data-id="${u.id}" data-email="${u.email}">${icon('send')}Envoyer un lien de réinitialisation</button>` : ''}
        ${u.totp_enabled ? html`<button class="btn small" data-action="user-reset-2fa" data-id="${u.id}">${icon('shield')}Réinitialiser la double authentification</button>` : ''}
        ${u.locked ? html`<button class="btn small" data-action="user-unlock" data-id="${u.id}">${icon('unlock')}Débloquer</button>` : ''}
        ${self ? '' : html`<button class="btn small danger" data-action="user-delete" data-id="${u.id}" data-name="${u.username}">${icon('trash')}Supprimer</button>`}
      </div></section>` : ''}
    </div>`);
    const form = $('#user-form', d);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = formData(form);
      await withBusy(e.submitter, async () => {
        try {
          await (u ? api('PATCH', `/api/users/${u.id}`, body) : api('POST', '/api/users', body));
          closeDialog(); toast(u ? 'Utilisateur enregistré' : 'Utilisateur ajouté'); render();
        } catch (err) { const p = form.querySelector('.error-text'); p.textContent = err.message; p.hidden = false; }
      });
    });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Journal (administrateur)
  // ---------------------------------------------------------------------------------------------------------
  const ACTION = {
    installation: 'Installation', connexion: 'Connexion', connexion_refusee: 'Connexion refusée', compte_bloque: 'Compte bloqué', deconnexion: 'Déconnexion',
    code_secours_utilise: 'Code de secours utilisé', mot_de_passe_modifie: 'Mot de passe modifié', double_auth_activee: 'Double authentification activée',
    double_auth_desactivee: 'Double authentification désactivée', codes_secours_regeneres: 'Codes de secours régénérés', session_fermee: 'Session fermée',
    autres_sessions_fermees: 'Autres sessions fermées', categorie_creee: 'Catégorie ajoutée', categorie_modifiee: 'Catégorie modifiée', categorie_supprimee: 'Catégorie supprimée',
    avoir_cree: 'Avoir ajouté', avoir_modifie: 'Avoir modifié', avoir_supprime: 'Avoir supprimé', avoir_cloture: 'Avoir clôturé', avoir_rouvert: 'Avoir rouvert',
    valeur_enregistree: 'Valeur enregistrée', valeur_supprimee: 'Valeur supprimée', mise_a_jour_rapide: 'Mise à jour rapide', taux_modifies: 'Taux modifiés',
    taux_supprime: 'Taux supprimé', taux_bce: 'Taux BCE récupérés', reglages_modifies: 'Réglages modifiés', securite_modifiee: 'Réglages de sécurité modifiés', utilisateur_cree: 'Utilisateur ajouté',
    utilisateur_modifie: 'Utilisateur modifié', mot_de_passe_reinitialise: 'Mot de passe redéfini', double_auth_reinitialisee: 'Double authentification réinitialisée',
    utilisateur_supprime: 'Utilisateur supprimé', email_reglages: "Envoi d'e-mails configuré", email_desactive: "Envoi d'e-mails désactivé", email_test: "Test d'envoi d'e-mail",
    email_modifie: 'Adresse e-mail modifiée', invitation_envoyee: 'Invitation envoyée', invitation_creee: "Lien d'invitation créé", invitation_renvoyee: 'Invitation renvoyée',
    invitation_lien: "Nouveau lien d'invitation", invitation_annulee: 'Invitation annulée', invitation_acceptee: 'Invitation acceptée', mot_de_passe_oublie: 'Mot de passe oublié',
    lien_mot_de_passe: 'Lien de réinitialisation envoyé', logo_personnalise: 'Logo personnalisé', logo_retire: 'Logo personnalisé retiré', logo_recherche: 'Logo recherché', logos_recherche: 'Logos recherchés', logos_reessai: 'Logos réessayés', titulaire_ajoute: 'Titulaire ajouté', titulaire_renomme: 'Titulaire renommé', titulaire_supprime: 'Titulaire supprimé', export: 'Export', import: 'Restauration', sauvegarde: 'Sauvegarde', sauvegarde_telechargee: 'Sauvegarde téléchargée',
  };
  const actionIcon = (a) => (/refusee|bloque/.test(a) ? 'alert' : /^connexion$|installation/.test(a) ? 'login' : a === 'deconnexion' ? 'logout'
    : /double_auth|code_secours|codes_secours/.test(a) ? 'shield' : /mot_de_passe/.test(a) ? 'key' : /^email|^invitation|^lien_/.test(a) ? 'mail' : /logo/.test(a) ? 'bank' : /session/.test(a) ? 'devices'
    : /supprim/.test(a) ? 'trash' : /export|telecharg/.test(a) ? 'download' : a === 'import' ? 'upload' : /sauvegarde/.test(a) ? 'database'
    : /taux/.test(a) ? 'exchange' : /titulaire/.test(a) ? 'user' : /utilisateur/.test(a) ? 'users' : /cloture/.test(a) ? 'lock' : /rouvert/.test(a) ? 'unlock'
    : /valeur|mise_a_jour/.test(a) ? 'update' : /categorie/.test(a) ? 'categories' : /reglages/.test(a) ? 'settings' : /cree/.test(a) ? 'plus' : 'edit');

  async function pageAudit(el, route, current) {
    let entries = [];
    const load = async (before) => {
      const r = await api('GET', `/api/audit?limit=100${before ? `&before=${before}` : ''}`);
      entries = entries.concat(r.entries);
      return r.more;
    };
    const more = await load();
    if (!current()) return;
    setHeader('Journal', 'Connexions et modifications, les plus récentes en premier');
    const draw = (hasMore) => {
      el.innerHTML = part(html`<div class="panel flush table-wrap"><table class="table"><thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Détail</th><th>Adresse IP</th></tr></thead><tbody>
        ${entries.map((a) => html`<tr><td class="nowrap">${dateTime(a.at)}</td><td>${a.username || '—'}</td>
          <td class="${/refusee|bloque/.test(a.action) ? 'neg' : ''}">${il(actionIcon(a.action), ACTION[a.action] || a.action)}</td><td class="small">${a.detail || ''}</td><td class="small muted">${a.ip || ''}</td></tr>`)}
        </tbody></table></div>${hasMore ? html`<div><button class="btn" id="audit-more">Afficher les entrées plus anciennes</button></div>` : ''}`);
      const b = $('#audit-more');
      if (b) b.addEventListener('click', async () => { draw(await load(entries[entries.length - 1].id)); });
    };
    draw(more);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Actions déclenchées par data-action
  // ---------------------------------------------------------------------------------------------------------
  const actions = {
    'close-dialog': () => closeDialog(),
    reload: () => location.reload(),
    retry: () => boot(),
    'logos-retry': async () => {
      try { const r = await api('POST', '/api/admin/logos/retry', {}); toast(r.cleared ? `${r.cleared} logo(s) seront recherchés à nouveau` : 'Aucun logo manquant'); } catch (err) { fail(err); }
    },
    'install-app': async () => {
      const ev = pwa.prompt;
      if (!ev) { location.hash = '#/compte'; return; }
      ev.prompt();
      const choice = await ev.userChoice.catch(() => null);
      pwa.prompt = null;
      pwa.refresh();
      if (choice && choice.outcome === 'accepted') toast('Installation de Vigie en cours');
    },
    'toggle-discret': () => { state.discret = !state.discret; store.set('discret', state.discret); render(); },
    range: (b) => { state.range = b.dataset.range; store.set('range', state.range); render(); },
    breakdown: (b) => { state.breakdown = b.dataset.key; store.set('breakdown', state.breakdown); render(); },
    logout: async () => { try { await api('POST', '/api/auth/logout'); } catch { /* déjà déconnecté */ } state.user = null; state.logoVersions = null; location.hash = '#/'; showLogin('Vous êtes déconnecté.'); },
    'share-property': (b) => sharePropertyForm(Number(b.dataset.id)).catch(fail),
    'share-decision': async (b) => withBusy(b, async () => {
      try {
        await api('POST', `/api/property-shares/${b.dataset.id}/decision`, { decision: b.dataset.decision });
        toast(b.dataset.decision === 'accept' ? 'Quote-part approuvée dans le patrimoine commun.' : 'Demande refusée.');
        render();
      } catch (err) { fail(err); }
    }),
    'share-revoke': async (b) => {
      if (!(await confirmDialog({ title: 'Retirer cette quote-part ?', message: 'La quote-part ne sera plus comptabilisée dans le patrimoine commun. Le bien et ses valeurs restent enregistrés.', confirm: 'Retirer', danger: true }))) return;
      try {
        await api('DELETE', `/api/property-shares/${b.dataset.id}`);
        toast('Partage retiré.');
        if (b.dataset.noDialog) render();
        else { const h = modal()?._holding; closeDialog(); if (h) sharePropertyForm(h.id).catch(fail); }
      } catch (err) { fail(err); }
    },
    'new-holding': () => holdingForm().catch(fail),
    'open-holding': (b) => { history.replaceState(null, '', `#/avoirs/${b.dataset.id}`); openHolding(Number(b.dataset.id)); },
    'edit-holding': () => { const h = modal()._holding; holdingForm(h).catch(fail); },
    'schedule-manual': async (b) => {
      const id = Number(b.dataset.id);
      const h = modal()._holding;
      if (!(await confirmDialog({ title: `Passer ${h.name} en saisie manuelle ?`, message: "Les valeurs calculées jusqu'à aujourd'hui sont enregistrées dans l'historique. Vous saisirez ensuite les nouvelles valeurs vous-même. Vous pourrez redéfinir un échéancier plus tard.", confirm: 'Passer en saisie manuelle' }))) { openHolding(id); return; }
      try { await api('PATCH', `/api/holdings/${id}`, { schedule: null }); toast('Échéancier retiré, valeurs conservées'); await refreshAfterChange(id); } catch (err) { fail(err); }
    },
    'close-holding': async (b) => {
      const id = b.dataset.id;
      const h = modal()._holding;
      if (!(await confirmDialog({ title: `Clôturer ${h.name} ?`, message: "Une valeur nulle est enregistrée aujourd'hui : l'avoir sort des totaux mais son historique reste visible. Vous pourrez le rouvrir.", confirm: 'Clôturer' }))) { openHolding(Number(id)); return; }
      try { await api('POST', `/api/holdings/${id}/close`, {}); toast('Avoir clôturé'); await refreshAfterChange(Number(id)); } catch (err) { fail(err); }
    },
    'reopen-holding': async (b) => { try { await api('POST', `/api/holdings/${b.dataset.id}/reopen`, {}); toast('Avoir rouvert, saisissez sa nouvelle valeur'); await refreshAfterChange(Number(b.dataset.id)); } catch (err) { fail(err); } },
    'delete-holding': async (b) => {
      if (!(await confirmDialog({ title: `Supprimer ${b.dataset.name} ?`, message: "L'avoir et tout son historique disparaissent définitivement. Pour seulement le sortir des totaux, clôturez-le plutôt.", confirm: 'Supprimer définitivement', danger: true }))) { openHolding(Number(b.dataset.id)); return; }
      try { await api('DELETE', `/api/holdings/${b.dataset.id}`); toast('Avoir supprimé'); history.replaceState(null, '', '#/avoirs'); render(); } catch (err) { fail(err); }
    },
    'delete-valuation': async (b) => {
      if (!(await confirmDialog({ title: 'Supprimer cette valeur ?', message: "Elle disparaît de l'historique et des courbes.", confirm: 'Supprimer', danger: true }))) { openHolding(Number(b.dataset.holding)); return; }
      try { await api('DELETE', `/api/valuations/${b.dataset.id}`); toast('Valeur supprimée'); await refreshAfterChange(Number(b.dataset.holding)); } catch (err) { fail(err); }
    },
    'new-category': () => categoryForm(),
    'edit-category': (b) => categoryForm(($('#page')._categories || []).find((c) => c.id === Number(b.dataset.id))),
    'delete-category': async (b) => {
      if (!(await confirmDialog({ title: `Supprimer ${b.dataset.name} ?`, message: 'La catégorie est vide : sa suppression est sans effet sur vos avoirs.', confirm: 'Supprimer', danger: true }))) return;
      try { await api('DELETE', `/api/categories/${b.dataset.id}`); toast('Catégorie supprimée'); render(); } catch (err) { fail(err); }
    },
    'move-category': async (b) => {
      const cats = $('#page')._categories || [];
      const c = cats.find((x) => x.id === Number(b.dataset.id));
      const same = cats.filter((x) => x.kind === c.kind);
      const i = same.indexOf(c), j = i + Number(b.dataset.dir);
      if (j < 0 || j >= same.length) return;
      [same[i], same[j]] = [same[j], same[i]];
      const other = cats.filter((x) => x.kind !== c.kind);
      const ordered = c.kind === 'asset' ? [...same, ...other] : [...other, ...same];
      try { await api('POST', '/api/categories/reorder', { ids: ordered.map((x) => x.id) }); render(); } catch (err) { fail(err); }
    },
    'toggle-menu': () => setMenu(!$('#rail').classList.contains('open')),
    'rename-owner': (b) => {
      const from = b.dataset.name;
      const d = openDialog(html`<form class="dialog-body form">${dialogHead(`Renommer ${from}`, 'Tous les avoirs de ce titulaire sont mis à jour. Choisir un nom existant fusionne les deux titulaires.')}
        <label class="field"><span>Nouveau nom</span><input class="input" name="to" required maxlength="40" value="${from}" autofocus></label>
        <div class="form-actions"><button class="btn" type="button" data-action="close-dialog">Annuler</button><button class="btn primary" type="submit">Renommer</button></div></form>`);
      d.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const r = await api('POST', '/api/owners/rename', { from, to: e.target.to.value });
          closeDialog(); toast(r.merged ? 'Titulaires fusionnés' : 'Titulaire renommé'); render();
        } catch (err) { fail(err); }
      });
    },
    'delete-owner': async (b) => {
      if (!(await confirmDialog({ title: `Supprimer ${b.dataset.name} ?`, message: "Il disparaît de la liste des titulaires proposés. Aucun avoir n'est modifié.", confirm: 'Supprimer', danger: true }))) return;
      try { await api('POST', '/api/owners/delete', { name: b.dataset.name }); toast('Titulaire supprimé'); render(); } catch (err) { fail(err); }
    },
    'delete-rate': async (b) => { try { await api('DELETE', `/api/fx/${b.dataset.cur}`); toast(`Taux ${b.dataset.cur} supprimé`); render(); } catch (err) { fail(err); } },
    'ecb-rates': async (b) => withBusy(b, async () => {
      try {
        const r = await api('POST', '/api/fx/ecb', {});
        if (!r.updated.length && !r.missing.length) toast('Aucune devise étrangère à mettre à jour');
        else toast(`Taux BCE du ${r.date ? dateFr(r.date) : '—'} : ${r.updated.join(', ') || 'aucun'}${r.missing.length ? ` (non publiés : ${r.missing.join(', ')})` : ''}`);
        render();
      } catch (err) { fail(err); }
    }),
    import: async (b) => {
      const file = $('#import-file').files[0];
      if (!file) { fail(new Error("Choisissez d'abord un fichier d'export JSON.")); return; }
      let data;
      try { data = JSON.parse(await file.text()); } catch { fail(new Error("Ce fichier n'est pas un JSON valide.")); return; }
      if (!(await confirmDialog({ title: 'Remplacer toutes les données ?', message: `Les avoirs, l'historique, les catégories et les taux actuels seront remplacés par ceux de ${file.name}. Une sauvegarde est créée juste avant.`, confirm: 'Remplacer les données', danger: true }))) return;
      await withBusy(b, async () => {
        try { const r = await api('POST', '/api/admin/import', data); toast(`Restauration terminée : ${r.holdings} avoirs, ${r.valuations} valeurs`); render(); } catch (err) { fail(err); }
      });
    },
    'backup-now': async (b) => withBusy(b, async () => { try { const r = await api('POST', '/api/admin/backups', {}); toast(`Sauvegarde ${r.backup.name} créée`); render(); } catch (err) { fail(err); } }),
    'setup-totp': () => setupTotp(),
    'disable-totp': async () => {
      const pw = await passwordDialog({ title: 'Désactiver la double authentification', message: 'Votre compte ne sera plus protégé que par son mot de passe.', confirm: 'Désactiver' });
      if (pw === null) return;
      try { await api('POST', '/api/account/totp/disable', { password: pw }); toast('Double authentification désactivée'); render(); } catch (err) { fail(err); }
    },
    'regen-codes': async () => {
      const pw = await passwordDialog({ title: 'Nouveaux codes de secours', message: 'Les anciens codes cesseront de fonctionner.', confirm: 'Générer' });
      if (pw === null) return;
      try { const r = await api('POST', '/api/account/recovery-codes', { password: pw }); showRecoveryCodes(r.recovery_codes); } catch (err) { fail(err); }
    },
    'revoke-session': async (b) => { try { await api('DELETE', `/api/account/sessions/${b.dataset.id}`); toast('Session fermée'); render(); } catch (err) { fail(err); } },
    'revoke-others': async () => { try { await api('POST', '/api/account/sessions/revoke-others', {}); toast('Les autres sessions sont fermées'); render(); } catch (err) { fail(err); } },
    'new-user': () => userForm(),
    'invite-user': () => inviteForm(),
    'invite-resend': async (b) => {
      await withBusy(b, async () => {
        try { await api('POST', `/api/admin/invitations/${b.dataset.id}/resend`, {}); toast(`Invitation renvoyée à ${b.dataset.email}`); render(); } catch (err) { fail(err); }
      });
    },
    'invite-link': async (b) => {
      if (!(await confirmDialog({ title: 'Créer un nouveau lien ?', message: "Le lien envoyé précédemment cessera de fonctionner. Vous pourrez copier le nouveau lien et le transmettre vous-même.", confirm: 'Créer le lien' }))) return;
      try { inviteResult(await api('POST', `/api/admin/invitations/${b.dataset.id}/resend`, { send: false })); } catch (err) { fail(err); }
    },
    'invite-cancel': async (b) => {
      if (!(await confirmDialog({ title: "Annuler l'invitation ?", message: `Le lien envoyé à ${b.dataset.email} cessera de fonctionner.`, confirm: "Annuler l'invitation", danger: true }))) return;
      try { await api('DELETE', `/api/admin/invitations/${b.dataset.id}`); toast('Invitation annulée'); render(); } catch (err) { fail(err); }
    },
    'user-reset-link': async (b) => {
      await withBusy(b, async () => {
        try { await api('POST', `/api/users/${b.dataset.id}/reset-link`, {}); toast(`Lien de réinitialisation envoyé à ${b.dataset.email}`); } catch (err) { fail(err); }
      });
    },
    'edit-user': (b) => userForm(($('#page')._users || []).find((u) => u.id === Number(b.dataset.id))),
    'user-password': (b) => {
      const id = b.dataset.id;
      const d = openDialog(html`<form class="dialog-body form">${dialogHead('Nouveau mot de passe', "Ses sessions ouvertes seront fermées. Communiquez-lui le nouveau mot de passe.")}
        <label class="field"><span>Nouveau mot de passe</span><input class="input" name="password" type="text" required minlength="10" autocomplete="off" autofocus></label>
        <div class="form-actions"><button class="btn" type="button" data-action="close-dialog">Annuler</button><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
      d.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api('POST', `/api/users/${id}/password`, { password: e.target.password.value }); closeDialog(); toast('Mot de passe enregistré'); render(); } catch (err) { fail(err); }
      });
    },
    'user-reset-2fa': async (b) => {
      if (!(await confirmDialog({ title: 'Réinitialiser la double authentification ?', message: "Utile si la personne a perdu son téléphone et ses codes de secours. Elle pourra l'activer à nouveau.", confirm: 'Réinitialiser' }))) return;
      try { await api('POST', `/api/users/${b.dataset.id}/reset-2fa`, {}); toast('Double authentification réinitialisée'); render(); } catch (err) { fail(err); }
    },
    'user-unlock': async (b) => { try { await api('PATCH', `/api/users/${b.dataset.id}`, { unlock: true }); closeDialog(); toast('Compte débloqué'); render(); } catch (err) { fail(err); } },
    'user-delete': async (b) => {
      if (!(await confirmDialog({ title: `Supprimer ${b.dataset.name} ?`, message: "Le compte est supprimé. Les données de patrimoine ne changent pas.", confirm: 'Supprimer', danger: true }))) return;
      try { await api('DELETE', `/api/users/${b.dataset.id}`); toast('Utilisateur supprimé'); render(); } catch (err) { fail(err); }
    },
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) return;
    const fn = actions[b.dataset.action];
    if (!fn) return;
    e.preventDefault();
    Promise.resolve(fn(b, e)).catch(fail);
  });

  function setMenu(open) {
    const rail = $('#rail');
    if (!rail) return;
    rail.classList.toggle('open', open);
    const t = $('.menu-toggle', rail);
    t.setAttribute('aria-expanded', String(open));
    t.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
  }
  document.addEventListener('click', (e) => {
    const rail = $('#rail');
    if (!rail || !rail.classList.contains('open')) return;
    // composedPath() : chemin du clic figé au moment de l'événement, même si le DOM change entre-temps.
    const path = e.composedPath();
    if (!path.includes(rail) || path.some((el) => el instanceof Element && el.matches('.nav a, [data-action="logout"]'))) setMenu(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#rail.open')) setMenu(false); });

  // Tableaux : chaque cellule reçoit l'intitulé de sa colonne, affiché en mode carte sur téléphone.
  function labelTables(root = document) {
    for (const table of root.querySelectorAll('table.table:not([data-labelled])')) {
      const heads = [...table.querySelectorAll('thead th')].map((th) => (th.querySelector('.sr-only') ? '' : th.textContent.trim()));
      for (const tr of table.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => { if (!td.hasAttribute('colspan')) td.dataset.label = heads[i] || ''; });
      table.dataset.labelled = '1';
    }
  }
  new MutationObserver(() => labelTables()).observe(document.body, { childList: true, subtree: true });

  // Un logo réellement chargé (plus grand que l'image transparente de secours) recouvre le monogramme.
  document.addEventListener('load', (e) => {
    const t = e.target;
    if (t instanceof HTMLImageElement && t.classList.contains('inst-img') && t.naturalWidth > 1) t.parentElement.classList.add('has-logo');
  }, true);

  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => state.charts.forEach((draw) => draw()), 120); });
  window.addEventListener('hashchange', () => { setMenu(false); if (gateRoute()) { boot(); return; } if (state.user) render(); });

  // ---------------------------------------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------------------------------------
  // ---------------------------------------------------------------------------------------------------------
  // Application installable (PWA) et hors ligne
  // ---------------------------------------------------------------------------------------------------------
  var pwa = {
    prompt: null,
    standalone: () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
    ios: () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    state() {
      if (this.standalone()) return 'installed';
      if (this.prompt) return 'prompt';
      if (!window.isSecureContext) return 'insecure';
      if (this.ios()) return 'ios';
      return 'manual';
    },
    refresh() {
      $$('[data-install-btn]').forEach((b) => { b.hidden = this.state() !== 'prompt'; });
      const sec = $('#install-section');
      if (sec) sec.innerHTML = part(installSection());
    },
  };
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pwa.prompt = e; pwa.refresh(); });
  window.addEventListener('appinstalled', () => { pwa.prompt = null; pwa.refresh(); toast('Vigie est installée sur cet appareil'); });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => console.warn('Service worker non enregistré :', err.message)); });
  }

  const netbar = $('#netbar');
  function setOnline(online) {
    netbar.hidden = online;
    if (!online) netbar.innerHTML = part(html`${icon('alert')}<span>Hors ligne : les chiffres affichés ne sont plus actualisés et les modifications sont impossibles.</span>`);
  }
  window.addEventListener('offline', () => setOnline(false));
  window.addEventListener('online', () => {
    setOnline(true);
    if (state.user) render(); else if (!state.boot) boot();
  });
  if (!navigator.onLine) setOnline(false);

  // Serveur injoignable : nouvel essai automatique (5 s, puis de plus en plus espacé jusqu'à 1 min),
  // au retour du réseau et quand l'application revient au premier plan.
  let retryTimer = null, retryCount = 0;
  function showUnreachable(err) {
    const offline = !navigator.onLine;
    const delay = Math.min(60_000, 5_000 * 2 ** retryCount);
    retryCount += 1;
    gate(html`<div>${pict(offline ? 'alert' : 'database', 'lg')}</div>
      <div><h1>${offline ? 'Vous êtes hors ligne' : 'Le serveur Vigie ne répond pas'}</h1>
      <p class="lead">${offline
        ? "Vigie a besoin d'une connexion à votre serveur pour afficher vos données : rien n'est conservé sur cet appareil."
        : err.status === 0 ? 'Vérifiez que le serveur est allumé et que le tunnel Cloudflare fonctionne.' : err.message}</p>
      <p class="small muted">${il('clock', `Nouvel essai automatique dans ${Math.round(delay / 1000)} s.`)}</p></div>
      <button class="btn primary" type="button" data-action="retry">${icon('update')}Réessayer</button>`);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (!state.boot) boot(); }, delay);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !state.boot) boot(); });

  async function boot() {
    lostShown = false;
    clearTimeout(retryTimer);
    try { state.boot = await api('GET', '/api/auth/state'); }
    catch (err) { state.boot = null; showUnreachable(err); return; }
    retryCount = 0;
    state.logos = Boolean(state.boot.logos_enabled);
    if (!state.inst.list.length) {
      try { state.inst = indexInstitutions((await (await fetch(`/institutions.json?v=${encodeURIComponent(state.boot.version)}`)).json()).institutions); }
      catch { state.inst = indexInstitutions([]); }
    }
    if (state.boot.user && !state.boot.needs_2fa_setup) {
      try { mergeInstitutions((await api('GET', '/api/institutions/catalogue')).institutions); }
      catch { /* Le catalogue local reste disponible. */ }
    }
    if (state.boot.setup_required) return showSetup();
    const link = gateRoute();
    if (link) {
      history.replaceState(null, '', '#/');
      state.user = null;
      return link.kind === 'invitation' ? showInvitation(link.token) : showReset(link.token);
    }
    if (!state.boot.user) return showLogin();
    state.user = state.boot.user;
    shell();
    render();
  }
  boot();
})();
