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
  const catIconKey = (c) => (c && c.icon && CAT_ICONS[c.icon] ? c.icon : (c && c.kind === 'liability' ? 'loanDoc' : 'cube'));
  const pict = (key, cls = '') => html`<span class="pict ${cls}" aria-hidden="true">${icon(key)}</span>`;
  const catPict = (c, cls = '') => pict(catIconKey(c), `${c && c.kind === 'liability' ? 'liability' : ''} ${cls}`.trim());
  const nameInitials = (name) => { const w = String(name || '?').trim().split(/\s+/); return ((w[0] || '?').charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase(); };
  const avatar = (name, cls = '') => html`<span class="avatar ${cls}" aria-hidden="true">${nameInitials(name)}</span>`;
  const h2i = (name, text) => html`<h2 class="ti">${icon(name)}<span>${text}</span></h2>`;
  const h3i = (name, text) => html`<h3 class="ti">${icon(name)}<span>${text}</span></h3>`;
  const il = (name, text) => html`<span class="il">${icon(name)}<span>${text}</span></span>`;
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

  function showLogin(message) {
    gate(html`<div><h1>Connexion</h1>${message ? html`<p class="lead">${message}</p>` : ''}</div>
      <form class="form" id="login-form">
        <label class="field"><span>Nom d'utilisateur</span><input class="input" name="username" autocomplete="username" required autofocus></label>
        <label class="field"><span>Mot de passe</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
        <p class="error-text" id="login-error" role="alert" hidden></p>
        <button class="btn primary" type="submit">${icon('login')}Se connecter</button>
      </form>`);
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
    showLogin('Votre session a expiré. Reconnectez-vous pour continuer.');
  }

  // ---------------------------------------------------------------------------------------------------------
  // Charpente et navigation
  // ---------------------------------------------------------------------------------------------------------
  const PAGES = {
    '': { title: 'Tableau de bord', icon: 'dashboard', render: pageDashboard },
    avoirs: { title: 'Avoirs', icon: 'holdings', render: pageHoldings },
    actualiser: { title: 'Mise à jour rapide', icon: 'update', render: pageQuick, edit: true },
    categories: { title: 'Catégories', icon: 'categories', render: pageCategories },
    reglages: { title: 'Réglages', icon: 'settings', render: pageSettings },
    compte: { title: 'Mon compte', icon: 'account', render: pageAccount },
    utilisateurs: { title: 'Utilisateurs', icon: 'users', render: pageUsers, admin: true },
    journal: { title: 'Journal', icon: 'journal', render: pageAudit, admin: true },
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
            ${link('')}${link('avoirs')}${link('actualiser')}${link('categories')}${link('reglages')}
            <div class="sep" role="presentation"></div>
            ${link('compte')}${link('utilisateurs')}${link('journal')}
          </nav>
          <div class="rail-foot">
            <div class="who"><span class="avatar" aria-hidden="true">${initials(u)}</span><div><b>${u.display_name}</b><span>${ROLE[u.role]}</span></div></div>
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
    $$('[data-nav]').forEach((a) => (a.dataset.nav === route.name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
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
    return pict(g.key === '—' ? 'cube' : 'bank', 'neutral');
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
      ${d.missing_rates.length ? html`<div class="notice">${icon('alert')}<div>Taux de change manquant pour ${d.missing_rates.join(', ')} : ces avoirs ne sont pas comptés dans les totaux.</div><a class="btn small" href="#/reglages">Saisir les taux</a></div>` : ''}
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
            const stale = !h.closed_at && v.stale_days > 0 && (h.age_days === null || h.age_days > v.stale_days);
            const diff = h.previous_cents !== null && h.value_cents !== null ? h.value_cents - h.previous_cents : null;
            return html`<button type="button" class="holding ${h.closed_at ? 'closed' : ''}" data-action="open-holding" data-id="${h.id}">
              <span class="name"><b>${h.name}</b><span class="meta">${h.institution ? il('bank', h.institution) : ''}${h.owner ? il('user', h.owner) : ''}${!h.institution && !h.owner ? il(LIQ_ICON[h.liquidity], LIQ[h.liquidity]) : ''}</span></span>
              ${spark(h.spark) || html`<span class="spark"></span>`}
              <span class="when">${h.closed_at ? html`<span class="tag">${icon('lock')}Clôturé le ${dateFr(h.closed_at)}</span>` : stale ? html`<span class="tag stale">${icon('clock')}À actualiser</span><br>${h.last_date ? ago(h.age_days) : 'sans valeur'}` : html`Mis à jour ${ago(h.age_days)}`}</span>
              <span class="amount"><b>${h.value_cents === null ? '—' : money(h.value_cents, h.currency)}</b>
                ${h.currency !== v.base_currency && h.value_base !== null ? html`<span class="muted">${money(h.value_base)}</span>` : ''}
                ${h.missing_rate ? html`<span class="tag bad">${icon('alert')}Taux ${h.currency} manquant</span>` : ''}
                ${diff ? html`<span class="${(diff > 0) !== (c.kind === 'liability') ? 'pos' : 'neg'}">${money(diff, h.currency, { sign: true })}</span>` : ''}</span>
            </button>`;
          })}</section>`;
      }) : html`<div class="panel empty">${pict(v.holdings.length ? 'search' : 'holdings', 'lg')}<h2>${v.holdings.length ? 'Aucun avoir ne correspond' : 'Aucun avoir pour le moment'}</h2>
          <p>${v.holdings.length ? 'Modifiez la recherche ou affichez les avoirs clôturés.' : 'Ajoutez vos comptes, placements, biens et crédits avec leur valeur du jour.'}</p>
          ${!v.holdings.length && canEdit() ? html`<button class="btn primary" data-action="new-holding">${icon('plus')}Ajouter un avoir</button>` : ''}</div>`);
      $('#closed-toggle').hidden = closedCount === 0;
      $('#closed-count').textContent = closedCount;
    };
    el.innerHTML = part(html`<div class="toolbar">
        <input class="input" type="search" id="holding-search" placeholder="Rechercher un avoir, un établissement…" value="${state.filter}" aria-label="Rechercher">
        <label class="check" id="closed-toggle"><input type="checkbox" id="show-closed" ${state.showClosed ? 'checked' : ''}><span>Afficher les avoirs clôturés (<span id="closed-count"></span>)</span></label>
      </div><div class="stack" id="holdings-list"></div>`);
    $('#holding-search').addEventListener('input', (e) => { state.filter = e.target.value; draw(); });
    $('#show-closed').addEventListener('change', (e) => { state.showClosed = e.target.checked; draw(); });
    draw();
    if (route.arg) openHolding(Number(route.arg));
  }

  async function holdingForm(existing = null) {
    const [cats, settings] = await Promise.all([api('GET', '/api/categories'), api('GET', '/api/settings')]);
    const h = existing || {};
    const catOptions = (kind, label) => html`<optgroup label="${label}">${cats.categories.filter((c) => c.kind === kind).map((c) => html`<option value="${c.id}" data-liq="${c.default_liquidity}" data-icon="${catIconKey(c)}" data-kind="${c.kind}" ${h.category_id === c.id ? 'selected' : ''}>${c.name}</option>`)}</optgroup>`;
    const owners = [...settings.owners];
    if (h.owner && !owners.some((o) => o.toLowerCase() === h.owner.toLowerCase())) owners.push(h.owner);
    const curList = [...new Set([settings.base_currency, ...settings.currencies])];
    const d = openDialog(html`<form class="dialog-body form" id="holding-form">
      ${dialogHead(existing ? `Modifier ${existing.name}` : 'Ajouter un avoir', existing ? '' : 'Un compte, un placement, un bien ou un crédit. Seule sa valeur compte, pas ses mouvements.')}
      <label class="field"><span>Nom</span><input class="input" name="name" required maxlength="80" value="${h.name || ''}" placeholder="Livret A, PEA, Appartement Lyon…" autofocus></label>
      <div class="grid-2">
        <label class="field"><span>Catégorie</span><span class="with-pict"><span data-cat-pict></span><select class="select" name="category_id" required>${catOptions('asset', 'Actifs')}${catOptions('liability', 'Passifs')}</select></span></label>
        <label class="field"><span>Liquidité</span><select class="select" name="liquidity">${Object.entries(LIQ).map(([k, l]) => html`<option value="${k}" ${h.liquidity === k ? 'selected' : ''}>${l}</option>`)}</select></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Établissement</span><input class="input" name="institution" maxlength="80" value="${h.institution || ''}" list="institutions"></label>
        <label class="field"><span>Titulaire</span><select class="select" name="owner_choice">
          <option value="">Non précisé</option>
          ${owners.map((o) => html`<option value="${o}" ${(h.owner || '').toLowerCase() === o.toLowerCase() ? 'selected' : ''}>${o}</option>`)}
          ${canEdit() ? html`<option value="__new__">Nouveau titulaire…</option>` : ''}
        </select></label>
      </div>
      <label class="field" data-new-owner hidden><span>Nom du nouveau titulaire</span><input class="input" name="owner_new" maxlength="40" autocomplete="off" placeholder="Prénom, enfant, SCI…"></label>
      <datalist id="institutions">${settings.institutions.map((i) => html`<option value="${i}">`)}</datalist>
      ${existing ? html`<label class="field"><span>Devise</span><select class="select" name="currency">${curList.map((c) => html`<option ${h.currency === c ? 'selected' : ''}>${c}</option>`)}</select></label>`
        : html`<div class="grid-3">
        <label class="field"><span>Valeur actuelle</span><input class="input amount" name="amount" inputmode="decimal" placeholder="0" autocomplete="off"></label>
        <label class="field"><span>Devise</span><select class="select" name="currency">${curList.map((c) => html`<option ${c === settings.base_currency ? 'selected' : ''}>${c}</option>`)}</select></label>
        <label class="field"><span>Date de la valeur</span><input class="input" type="date" name="date" value="${todayIso()}" max="${todayIso()}"></label>
      </div><small class="muted">Pour un crédit, indiquez le capital restant dû, en positif.</small>`}
      <label class="field"><span>Notes</span><textarea class="textarea" name="notes" maxlength="1000">${h.notes || ''}</textarea></label>
      <p class="error-text" hidden></p>
      <div class="form-actions"><button class="btn" type="button" data-action="close-dialog">Annuler</button><button class="btn primary" type="submit">${icon(existing ? 'check' : 'plus')}${existing ? 'Enregistrer' : "Ajouter l'avoir"}</button></div>
    </form>`);
    const form = d.querySelector('form');
    const syncLiq = () => { if (!existing) form.liquidity.value = form.category_id.selectedOptions[0].dataset.liq; };
    const syncPict = () => { const o = form.category_id.selectedOptions[0]; $('[data-cat-pict]', form).innerHTML = part(catPict({ icon: o.dataset.icon, kind: o.dataset.kind })); };
    syncPict();
    form.category_id.addEventListener('change', syncPict);
    form.category_id.addEventListener('change', syncLiq);
    if (!existing) syncLiq();
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
      delete body.owner_choice; delete body.owner_new;
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

  async function openHolding(id) {
    let data;
    try { data = await api('GET', `/api/holdings/${id}`); } catch (err) { fail(err); return; }
    const { holding: h, valuations, base_currency: base } = data;
    const cats = holdingsCache ? holdingsCache.categories : (await api('GET', '/api/categories')).categories;
    const cat = cats.find((c) => c.id === h.category_id) || {};
    const asc = [...valuations].reverse();
    const d = openDialog(html`<div class="dialog-body">
      ${dialogHead(h.name, `${cat.name || ''}${h.closed_at ? `, clôturé le ${dateFr(h.closed_at)}` : ''}`, catPict(cat, 'lg'))}
      <div><p class="hero-value" style="font-size:2.4rem;margin:0">${h.value_cents === null ? '—' : money(h.value_cents, h.currency, { digits: 2 })}</p>
        <p class="muted">${valuations[0] ? `Valeur au ${dateLong(valuations[0].valued_at)}` : 'Aucune valeur enregistrée'}${h.currency !== base && h.value_base !== null ? `, soit ${money(h.value_base, base)}` : ''}</p></div>
      ${asc.length > 1 ? html`<div class="chart" id="holding-chart"></div>` : ''}
      ${canEdit() ? html`<form class="panel form" id="valuation-form" style="padding:16px">
        ${h3i('plus', 'Nouvelle valeur')}
        <div class="grid-2"><label class="field"><span>Valeur en ${h.currency}</span><input class="input amount" name="amount" inputmode="decimal" required autocomplete="off" autofocus placeholder="${h.value_cents !== null ? exact(h.value_cents, h.currency).replace(/[^\d,\s−-]/g, '').trim() : '0'}"></label>
        <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${todayIso()}" max="${todayIso()}" required></label></div>
        <label class="field"><span>Note (facultative)</span><input class="input" name="note" maxlength="120" placeholder="Relevé annuel, estimation notaire…"></label>
        <div class="form-actions"><button class="btn primary" type="submit">${icon('check')}Enregistrer la valeur</button></div>
        <small class="muted">Une seule valeur par date : enregistrer à une date existante remplace la valeur de ce jour.</small>
      </form>` : ''}
      <dl class="kv">
        <dt>${icon('bank')}Établissement</dt><dd>${h.institution || '—'}</dd>
        <dt>${icon('user')}Titulaire</dt><dd>${h.owner || '—'}</dd>
        <dt>${icon('exchange')}Devise</dt><dd>${h.currency}</dd>
        <dt>${icon(LIQ_ICON[h.liquidity])}Liquidité</dt><dd>${LIQ[h.liquidity]}</dd>
        ${h.notes ? html`<dt>${icon('journal')}Notes</dt><dd style="white-space:pre-wrap">${h.notes}</dd>` : ''}
      </dl>
      <section class="section">${h3i('clock', 'Historique des valeurs')}
        ${valuations.length ? html`<div class="panel flush table-wrap"><table class="table"><thead><tr><th>Date</th><th class="num">Valeur</th><th class="num">Écart</th>${canEdit() ? html`<th><span class="sr-only">Actions</span></th>` : ''}</tr></thead><tbody>
          ${valuations.map((v, i) => {
            const prev = valuations[i + 1];
            const diff = prev ? v.amount_cents - prev.amount_cents : null;
            return html`<tr><td>${dateFr(v.valued_at)}${v.note ? html`<br><span class="small muted">${v.note}</span>` : ''}</td><td class="num">${exact(v.amount_cents, h.currency)}</td>
              <td class="num ${!diff ? 'muted' : (diff > 0) !== (cat.kind === 'liability') ? 'pos' : 'neg'}">${diff === null ? '' : money(diff, h.currency, { sign: true })}</td>
              ${canEdit() ? html`<td class="num"><button class="btn icon ghost small" type="button" data-action="delete-valuation" data-id="${v.id}" data-holding="${h.id}" aria-label="Supprimer la valeur du ${dateFr(v.valued_at)}">${icon('trash')}</button></td>` : ''}</tr>`;
          })}</tbody></table></div>` : html`<p class="muted">Aucune valeur.</p>`}
      </section>
      ${canEdit() ? html`<div class="form-actions" style="justify-content:flex-start">
        <button class="btn" type="button" data-action="edit-holding" data-id="${h.id}">${icon('edit')}Modifier</button>
        ${h.closed_at ? html`<button class="btn" type="button" data-action="reopen-holding" data-id="${h.id}">${icon('unlock')}Rouvrir</button>` : html`<button class="btn" type="button" data-action="close-holding" data-id="${h.id}">${icon('lock')}Clôturer</button>`}
        <button class="btn danger" type="button" data-action="delete-holding" data-id="${h.id}" data-name="${h.name}">${icon('trash')}Supprimer</button></div>` : ''}
    </div>`, { drawer: true, onClose: () => { if (location.hash.match(/^#\/avoirs\/\d+/)) history.replaceState(null, '', '#/avoirs'); } });
    d.dataset.holding = h.id;
    d._holding = h;
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
    const open = v.holdings.filter((h) => !h.closed_at);
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
            const stale = v.stale_days > 0 && (h.age_days === null || h.age_days > v.stale_days);
            return html`<div class="quick" data-row data-stale="${stale}" data-id="${h.id}">
              <div><b>${h.name}</b><br><span class="small muted">${h.institution || ''}</span>${stale ? html` <span class="tag stale">${icon('clock')}À actualiser</span>` : ''}</div>
              <div class="prev"><b>${h.value_cents === null ? '—' : exact(h.value_cents, h.currency)}</b><span>${h.last_date ? dateFr(h.last_date) : 'aucune valeur'}</span></div>
              <input class="input amount" name="h${h.id}" inputmode="decimal" autocomplete="off" aria-label="Nouvelle valeur de ${h.name} en ${h.currency}" placeholder="${h.currency}">
              <button class="btn small keep" type="button" data-action="keep-value" data-id="${h.id}" ${h.value_cents === null ? 'disabled' : ''} title="Reprendre la dernière valeur à la date choisie">${icon('equal')}Inchangée</button>
            </div>`;
          })}</section>`)}
        <div class="sticky-foot"><div><b id="quick-count">Aucune valeur saisie</b><br><span class="small muted" id="quick-preview">Patrimoine net actuel : ${money(netNow)}</span></div>
          <button class="btn primary" type="submit" id="quick-save" disabled>${icon('check')}Enregistrer les valeurs</button></div>
      </form>`);
    const form = $('#quick-form');
    const byId = new Map(open.map((h) => [String(h.id), h]));
    const parse = (s) => {
      let t = String(s).replace(/[\s  €$£]/g, '');
      if (!t) return null;
      if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
      else t = t.replace(',', '.');
      return /^-?\d+(\.\d+)?$/.test(t) ? Math.round(Number(t) * 100) : NaN;
    };
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
        net += (Math.round(cents * r) - (h.value_base || 0)) * signFor(h);
      });
      $('#quick-count').textContent = invalid ? `${invalid} montant(s) illisible(s)` : count ? `${count} valeur${count > 1 ? 's' : ''} à enregistrer` : 'Aucune valeur saisie';
      $('#quick-preview').textContent = count ? `Patrimoine net après mise à jour : ${money(net)} (${money(net - netNow, state.base, { sign: true })})${missing ? ', hors devises sans taux' : ''}` : `Patrimoine net actuel : ${money(netNow)}`;
      $('#quick-save').disabled = !count || invalid > 0;
    };
    form.addEventListener('input', update);
    $('#only-stale').addEventListener('change', (e) => {
      onlyStale = e.target.checked;
      $$('[data-row]', form).forEach((r) => { r.hidden = onlyStale && r.dataset.stale !== 'true'; });
      $$('[data-group]', form).forEach((g) => { g.hidden = $$('[data-row]', g).every((r) => r.hidden); });
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
    const [s, backups, { owners }] = await Promise.all([api('GET', '/api/settings'), isAdmin() ? api('GET', '/api/admin/backups') : null, api('GET', '/api/owners')]);
    if (!current()) return;
    state.base = s.base_currency;
    setHeader('Réglages', 'Devise, taux de change, exports et sauvegardes');
    const curOptions = (sel) => [...new Set([s.base_currency, ...s.currencies])].map((c) => html`<option ${c === sel ? 'selected' : ''}>${c}</option>`);
    const addable = [...new Set([...s.currencies_in_use, ...s.currencies])].filter((c) => c !== s.base_currency);
    el.innerHTML = part(html`
      <section class="section">${h2i('bell', 'Devise et rappels')}<div class="panel">
        ${isAdmin() ? html`<form class="form" id="settings-form"><div class="grid-2">
          <label class="field"><span>Devise de référence</span><select class="select" name="base_currency">${curOptions(s.base_currency)}</select><small>Changer de devise efface les taux de change saisis.</small></label>
          <label class="field"><span>Rappel d'actualisation (jours)</span><input class="input" type="number" name="stale_days" min="0" max="3650" value="${s.stale_days}"><small>Un avoir est signalé « à actualiser » au-delà de ce délai. 0 désactive le rappel.</small></label>
        </div><div class="form-actions"><button class="btn primary" type="submit">${icon('check')}Enregistrer</button></div></form>`
        : html`<dl class="kv"><dt>Devise de référence</dt><dd>${s.base_currency}</dd><dt>Rappel d'actualisation</dt><dd>${s.stale_days ? `${s.stale_days} jours` : 'désactivé'}</dd></dl>`}
      </div></section>

      <section class="section"><div class="section-head">${h2i('users', 'Titulaires')}<p>Personnes à qui appartiennent les avoirs</p></div>
        <div class="panel flush table-wrap"><table class="table"><thead><tr><th>Titulaire</th><th class="num">Avoirs</th>${canEdit() ? html`<th><span class="sr-only">Actions</span></th>` : ''}</tr></thead><tbody>
          ${owners.map((o) => html`<tr><td><span class="cell-lead">${avatar(o.name, 'sm')}<span>${o.name}</span></span></td><td class="num">${o.count}</td>
            ${canEdit() ? html`<td class="num nowrap"><button class="btn small" data-action="rename-owner" data-name="${o.name}">${icon('edit')}Renommer</button>
              <button class="btn icon ghost small" data-action="delete-owner" data-name="${o.name}" ${o.count ? raw('disabled title="Indiqué sur des avoirs"') : ''} aria-label="Supprimer ${o.name}">${icon('trash')}</button></td>` : ''}</tr>`)}
        </tbody></table></div>
        ${canEdit() ? html`<form class="toolbar" id="owner-form"><input class="input" name="name" required maxlength="40" placeholder="Nouveau titulaire" aria-label="Nouveau titulaire" style="max-width:240px"><button class="btn" type="submit">${icon('plus')}Ajouter le titulaire</button></form>` : ''}
      </section>

      <section class="section"><div class="section-head">${h2i('exchange', 'Taux de change')}<p>1 unité de la devise vaut x ${s.base_currency}</p></div>
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

      <section class="section">${h2i('download', 'Exporter mes données')}<div class="panel"><div class="toolbar">
        <a class="btn" href="/api/export.json" download>${icon('download')}Export complet (JSON)</a>
        <a class="btn" href="/api/export/holdings.csv" download>${icon('download')}Avoirs (CSV)</a>
        <a class="btn" href="/api/export/history.csv" download>${icon('download')}Historique des valeurs (CSV)</a>
      </div><p class="small muted" style="margin-top:10px">Les fichiers CSV utilisent le point-virgule et la virgule décimale, pour s'ouvrir directement dans Excel ou LibreOffice.</p></div></section>

      ${isAdmin() ? html`
      <section class="section">${h2i('upload', 'Restaurer un export')}<div class="panel form">
        <p class="muted">Remplace toutes les catégories, tous les avoirs, l'historique et les taux par ceux d'un export JSON de Vigie. Les comptes utilisateurs ne changent pas. Une sauvegarde de la base est créée juste avant.</p>
        <div class="toolbar"><input type="file" id="import-file" accept="application/json,.json" class="input" style="max-width:360px"><button class="btn" type="button" data-action="import">${icon('upload')}Restaurer cet export</button></div>
      </div></section>

      <section class="section"><div class="section-head">${h2i('database', 'Sauvegardes de la base')}<p>${backups.keep_days ? `Automatique chaque jour vers ${backups.hour} h, conservée ${backups.keep_days} jours` : 'Sauvegarde automatique désactivée'}</p></div>
        <div class="panel flush table-wrap"><table class="table"><thead><tr><th>Fichier</th><th>Date</th><th class="num">Taille</th><th><span class="sr-only">Télécharger</span></th></tr></thead><tbody>
        ${backups.backups.length ? backups.backups.slice(0, 15).map((b) => html`<tr><td>${b.name}</td><td>${dateTime(b.created_at)}</td><td class="num">${(b.size / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Ko</td>
          <td class="num"><a class="btn icon ghost small" href="/api/admin/backups/${encodeURIComponent(b.name)}" download aria-label="Télécharger ${b.name}">${icon('download')}</a></td></tr>`)
          : html`<tr><td colspan="4" class="muted">Aucune sauvegarde pour l'instant.</td></tr>`}
        </tbody></table></div>
        <div class="toolbar"><button class="btn" type="button" data-action="backup-now">${icon('database')}Créer une sauvegarde maintenant</button>
          <span class="small muted">Fichiers SQLite dans le dossier data/backups de l'application, inclus dans les sauvegardes Runtipi.</span></div>
      </section>

      <section class="section">${h2i('shield', 'Sécurité du serveur')}<div class="panel">
        <dl class="kv">
          <dt>${icon('clock')}Déconnexion après inactivité</dt><dd>${s.security.session_idle_minutes} min</dd>
          <dt>${icon('devices')}Durée maximale d'une session</dt><dd>${s.security.session_max_hours} h</dd>
          <dt>${icon('lock')}Blocage du compte</dt><dd>après ${s.security.login_max_attempts} échecs, pendant ${s.security.login_lock_minutes} min</dd>
          <dt>${icon('key')}Double authentification</dt><dd>${s.security.require_2fa ? 'obligatoire pour tous' : 'facultative'}</dd>
        </dl>
        <p class="small muted" style="margin-top:12px">Ces réglages se modifient dans le fichier <b>data/config/vigie.env</b> de l'application, puis en redémarrant Vigie dans Runtipi.</p>
      </div></section>` : ''}`);

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
  function uaLabel(ua) {
    if (!ua) return 'Appareil inconnu';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${browser} sur ${os}` : browser;
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
            <div class="form-actions"><button class="btn" type="submit">${icon('check')}Enregistrer</button></div></form></section>
          <section class="section">${h2i('key', 'Mot de passe')}<form class="panel form" id="password-form">
            <input type="text" name="username" value="${user.username}" autocomplete="username" hidden>
            <label class="field"><span>Mot de passe actuel</span><input class="input" type="password" name="current_password" autocomplete="current-password" required></label>
            <label class="field"><span>Nouveau mot de passe</span><input class="input" type="password" name="new_password" autocomplete="new-password" minlength="10" required><small>10 caractères minimum. Les autres sessions seront fermées.</small></label>
            <label class="field"><span>Confirmation</span><input class="input" type="password" name="confirm" autocomplete="new-password" minlength="10" required></label>
            <div class="form-actions"><button class="btn" type="submit">${icon('key')}Changer le mot de passe</button></div></form></section>
        </div>
      </div>`);
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
  async function pageUsers(el, route, current) {
    const { users } = await api('GET', '/api/users');
    if (!current()) return;
    setHeader('Utilisateurs', 'Qui peut consulter ou modifier le patrimoine', html`<button class="btn primary" data-action="new-user">${icon('plus')}Ajouter un utilisateur</button>`);
    el.innerHTML = part(html`<div class="panel flush table-wrap"><table class="table"><thead><tr><th>Utilisateur</th><th>Rôle</th><th>Double authentification</th><th>Dernière connexion</th><th>État</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${users.map((u) => html`<tr><td><div class="cell-lead">${avatar(u.display_name, 'sm')}<div><b style="font-weight:500">${u.display_name}</b><br><span class="small muted">${u.username}</span></div></div></td><td>${il(ROLE_ICON[u.role], ROLE[u.role])}</td>
        <td>${u.totp_enabled ? html`<span class="tag brand">${icon('shield')}Active</span>` : html`<span class="tag">${icon('unlock')}Inactive</span>`}</td><td>${dateTime(u.last_login_at)}</td>
        <td>${u.disabled ? html`<span class="tag bad">${icon('close')}Désactivé</span>` : u.locked ? html`<span class="tag stale">${icon('lock')}Bloqué</span>` : il('check', 'Actif')}</td>
        <td class="num"><button class="btn small" data-action="edit-user" data-id="${u.id}">${icon('settings')}Gérer</button></td></tr>`)}
      </tbody></table></div>
      <section class="section">${h2i('users', 'Les rôles')}<div class="panel"><dl class="kv">${Object.entries(ROLE).map(([k, l]) => html`<dt>${icon(ROLE_ICON[k])}${l}</dt><dd>${ROLE_HINT[k]}</dd>`)}</dl></div></section>`);
    el._users = users;
  }

  function userForm(u = null) {
    const roles = Object.entries(ROLE).map(([k, l]) => html`<option value="${k}" ${u ? (u.role === k ? 'selected' : '') : k === 'viewer' ? 'selected' : ''}>${l}</option>`);
    const self = u && u.id === state.user.id;
    const d = openDialog(html`<div class="dialog-body">
      ${dialogHead(u ? u.display_name : 'Ajouter un utilisateur', u ? `Identifiant : ${u.username}` : "Communiquez-lui son mot de passe provisoire : il pourra le changer dans « Mon compte ».", u ? avatar(u.display_name, 'lg') : pict('user', 'lg'))}
      <form class="form" id="user-form">
        ${u ? '' : html`<label class="field"><span>Nom d'utilisateur</span><input class="input" name="username" required minlength="3" maxlength="40" autocomplete="off" autofocus></label>`}
        ${nameFields(u || {}, Boolean(u))}
        <label class="field"><span>Rôle</span><select class="select" name="role" ${self ? 'disabled' : ''}>${roles}</select></label>
        ${u ? (self ? '' : html`<label class="check"><input type="checkbox" name="disabled" ${u.disabled ? 'checked' : ''}><span>Compte désactivé (connexion impossible)</span></label>`)
          : html`<label class="field"><span>Mot de passe provisoire</span><input class="input" name="password" type="text" required minlength="10" autocomplete="off"><small>10 caractères minimum.</small></label>`}
        <p class="error-text" hidden></p>
        <div class="form-actions"><button class="btn" type="button" data-action="close-dialog">Annuler</button><button class="btn primary" type="submit">${icon(u ? 'check' : 'plus')}${u ? 'Enregistrer' : "Ajouter l'utilisateur"}</button></div>
      </form>
      ${u ? html`<section class="section">${h3i('settings', 'Autres actions')}<div class="toolbar">
        <button class="btn small" data-action="user-password" data-id="${u.id}">${icon('key')}Définir un nouveau mot de passe</button>
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
    taux_supprime: 'Taux supprimé', taux_bce: 'Taux BCE récupérés', reglages_modifies: 'Réglages modifiés', utilisateur_cree: 'Utilisateur ajouté',
    utilisateur_modifie: 'Utilisateur modifié', mot_de_passe_reinitialise: 'Mot de passe redéfini', double_auth_reinitialisee: 'Double authentification réinitialisée',
    utilisateur_supprime: 'Utilisateur supprimé', titulaire_ajoute: 'Titulaire ajouté', titulaire_renomme: 'Titulaire renommé', titulaire_supprime: 'Titulaire supprimé', export: 'Export', import: 'Restauration', sauvegarde: 'Sauvegarde', sauvegarde_telechargee: 'Sauvegarde téléchargée',
  };
  const actionIcon = (a) => (/refusee|bloque/.test(a) ? 'alert' : /^connexion$|installation/.test(a) ? 'login' : a === 'deconnexion' ? 'logout'
    : /double_auth|code_secours|codes_secours/.test(a) ? 'shield' : /mot_de_passe/.test(a) ? 'key' : /session/.test(a) ? 'devices'
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
    'toggle-discret': () => { state.discret = !state.discret; store.set('discret', state.discret); render(); },
    range: (b) => { state.range = b.dataset.range; store.set('range', state.range); render(); },
    breakdown: (b) => { state.breakdown = b.dataset.key; store.set('breakdown', state.breakdown); render(); },
    logout: async () => { try { await api('POST', '/api/auth/logout'); } catch { /* déjà déconnecté */ } state.user = null; location.hash = '#/'; showLogin('Vous êtes déconnecté.'); },
    'new-holding': () => holdingForm().catch(fail),
    'open-holding': (b) => { history.replaceState(null, '', `#/avoirs/${b.dataset.id}`); openHolding(Number(b.dataset.id)); },
    'edit-holding': () => { const h = modal()._holding; holdingForm(h).catch(fail); },
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

  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => state.charts.forEach((draw) => draw()), 120); });
  window.addEventListener('hashchange', () => { setMenu(false); if (state.user) render(); });

  // ---------------------------------------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------------------------------------
  async function boot() {
    lostShown = false;
    try { state.boot = await api('GET', '/api/auth/state'); }
    catch (err) { app.innerHTML = part(html`<main class="gate"><div class="gate-card"><h1>Vigie est injoignable</h1><p class="lead">${err.message}</p><button class="btn primary" data-action="reload">Réessayer</button></div></main>`); return; }
    if (state.boot.setup_required) return showSetup();
    if (!state.boot.user) return showLogin();
    state.user = state.boot.user;
    shell();
    render();
  }
  boot();
})();
