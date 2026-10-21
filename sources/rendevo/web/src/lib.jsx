import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LuX } from 'react-icons/lu';

// ---------------------------------------------------------------- API
export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

export async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { ...headers } };
  if (raw !== undefined) opts.body = raw;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
  const res = await fetch(path, opts);
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth')) window.dispatchEvent(new Event('rdv:unauthorized'));
    throw new ApiError(res.status, (data && data.error) || `Erreur ${res.status}`, data && data.details);
  }
  return data;
}

// -------------------------------------------------------------- router
const RouterCtx = createContext({ path: '/', navigate: () => {} });

export function RouterProvider({ children }) {
  const [path, setPath] = useState(window.location.pathname + window.location.search);
  useEffect(() => {
    const on = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = useCallback((to, { replace } = {}) => {
    if (replace) window.history.replaceState({}, '', to); else window.history.pushState({}, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  }, []);
  return <RouterCtx.Provider value={{ path, navigate }}>{children}</RouterCtx.Provider>;
}

export function useRouter() {
  const r = useContext(RouterCtx);
  const [pathname, search = ''] = r.path.split('?');
  const query = useMemo(() => Object.fromEntries(new URLSearchParams(search)), [search]);
  return { ...r, pathname, query };
}

export function matchPath(pattern, pathname) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z_]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  const m = re.exec(pathname);
  if (!m) return null;
  return Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
}

export function Link({ to, children, className, onClick, ...rest }) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onClick?.(e);
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

// --------------------------------------------------------------- toast
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'err' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- hooks
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!path) { setState({ data: null, error: null, loading: false }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api(path).then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error) => alive && setState({ data: null, error, loading: false }),
    );
    return () => { alive = false; };
  }, [path, tick, ...deps]);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data: typeof data === 'function' ? data(s.data) : data })) };
}

export function useInterval(fn, ms) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!ms) return undefined;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Wraps an async action with busy state + error toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, success) => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(typeof success === 'function' ? success(r) : success);
      return r;
    } catch (e) {
      toast(e.message || 'Erreur', 'err');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [run, busy];
}

// ------------------------------------------------------------ elements
export function Field({ label, hint, children, htmlFor }) {
  return (
    <div className="field">
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Chips({ value = [], onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  const add = (v) => {
    const parts = String(v).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...(value || []), ...parts])]);
    setDraft('');
  };
  return (
    <div className="chips">
      {(value || []).map((c) => (
        <span className="chip" key={c}>{c}<button type="button" aria-label={`Retirer ${c}`} onClick={() => onChange(value.filter((x) => x !== c))}>×</button></span>
      ))}
      <input
        value={draft}
        placeholder={(value || []).length ? '' : placeholder}
        onChange={(e) => (/[,;]$/.test(e.target.value) ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(draft); }
          if (e.key === 'Backspace' && !draft && value?.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft && add(draft)}
      />
    </div>
  );
}

export function Seg({ value, onChange, options }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="btn ghost icon" onClick={onClose} aria-label="Fermer"><LuX /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ onClose, children, head }) {
  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head"><div className="grow">{head}</div><button className="btn ghost icon" onClick={onClose} aria-label="Fermer"><LuX /></button></div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function Loading({ label = 'Chargement' }) {
  return <div className="loading"><span className="spinner" />{label}</div>;
}

export function ErrorBox({ error, retry }) {
  if (!error) return null;
  return <div className="alert err">{error.message} {retry && <button className="btn sm" onClick={retry}>Réessayer</button>}</div>;
}

export function Empty({ title, children, action }) {
  return <div className="empty"><h3>{title}</h3><p>{children}</p>{action}</div>;
}

// --------------------------------------------------------- formatting
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
export function ago(d) {
  if (!d) return '';
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'à l\'instant';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtDate(d, opts) {
  return new Date(d).toLocaleDateString('fr-FR', opts || { weekday: 'short', day: 'numeric', month: 'short' });
}
export function fmtTime(d, tz) {
  return new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
}
export function fmtDateTime(d, tz) {
  return new Date(d).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: tz });
}
export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
}

export const HEAT = { hot: 'Chaud', warm: 'Tiède', cold: 'Froid' };
export const STATUS = {
  new: 'Nouveau',
  qualified: 'Qualifié',
  low_fit: 'Hors cible',
  excluded: 'Exclu',
  invited: 'Invitation envoyée',
  not_accepted: 'Invitation sans réponse',
  connected: 'Connecté',
  contacted: 'Contacté',
  replied: 'En conversation',
  callback: 'À relancer plus tard',
  meeting: 'RDV planifié',
  won: 'Gagné',
  lost: 'Perdu',
};
export const STATUS_TONE = { meeting: 'ok', won: 'ok', replied: 'info', lost: 'err', excluded: 'err', callback: 'warn', low_fit: 'cold' };
export const KIND = {
  invite: 'Invitation', first: 'Premier message', followup: 'Relance', setter: 'Setter IA', confirmation: 'Confirmation RDV',
  reminder: 'Rappel RDV', noshow: 'Après absence', callback: 'Reprise de contact', manual: 'Vous', reply: 'Réponse',
};

export function HeatBadge({ heat }) {
  return <span className={`badge ${heat}`}>{HEAT[heat] || heat}</span>;
}
export function StatusBadge({ status }) {
  return <span className={`badge ${STATUS_TONE[status] || ''}`}>{STATUS[status] || status}</span>;
}

export function Logo({ size = 26, light = false }) {
  // Calendar leaf with a highlighter stroke: a meeting landing in the agenda.
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="4" y="8" width="56" height="52" rx="12" fill="#1f2f8a" stroke={light ? '#ffffff' : 'none'} strokeWidth={light ? 3 : 0} />
      <rect x="4" y="18" width="56" height="5" fill="#16226b" />
      <rect x="17" y="3" width="6" height="12" rx="3" fill={light ? '#ffffff' : '#161a2c'} />
      <rect x="41" y="3" width="6" height="12" rx="3" fill={light ? '#ffffff' : '#161a2c'} />
      <path d="M14 42.5 L50 36.5 L50 46 L14 52 Z" fill="#ffe94a" />
      <path d="M21 40 l7.5 7.5 L44 31" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function copy(text, toast) {
  navigator.clipboard?.writeText(text).then(() => toast && toast('Copié dans le presse-papiers'), () => toast && toast('Copie impossible', 'err'));
}
