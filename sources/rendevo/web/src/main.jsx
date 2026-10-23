import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LuLayoutDashboard, LuUsers, LuSend, LuMessagesSquare, LuCalendarDays, LuFilm, LuSettings, LuLogOut, LuMenu, LuChevronsUpDown, LuPlus } from 'react-icons/lu';
import './styles.css';
import { api, RouterProvider, ToastProvider, useRouter, matchPath, Link, Loading, Logo, useInterval, Modal, useAction, Field } from './lib.jsx';
import { AuthPage } from './pages/Auth.jsx';
import { Onboarding } from './pages/Onboarding.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Prospects } from './pages/Prospects.jsx';
import { Campaigns, CampaignEditor } from './pages/Campaigns.jsx';
import { Inbox } from './pages/Inbox.jsx';
import { Agenda } from './pages/Agenda.jsx';
import { Media } from './pages/Media.jsx';
import { Settings } from './pages/Settings.jsx';
import { BookingPage, VideoPage } from './pages/Public.jsx';
import { SessionCtx, useSession } from './session.js';


const NAV = [
  { to: '/', label: 'Tableau de bord', icon: LuLayoutDashboard, exact: true },
  { to: '/prospects', label: 'Prospects', icon: LuUsers },
  { to: '/campagnes', label: 'Campagnes', icon: LuSend },
  { to: '/messages', label: 'Messages', icon: LuMessagesSquare, badge: 'inbox' },
  { to: '/agenda', label: 'Agenda', icon: LuCalendarDays },
  { to: '/medias', label: 'Médias', icon: LuFilm },
  { to: '/reglages', label: 'Réglages', icon: LuSettings },
];

function Shell({ children }) {
  const { session, refresh } = useSession();
  const { pathname, navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({});
  const [newWs, setNewWs] = useState(false);
  const loadCounts = useCallback(() => api('/api/inbox?filter=approval').then((r) => setCounts(r.counts), () => {}), []);
  useEffect(() => { loadCounts(); }, [loadCounts, pathname]);
  useInterval(loadCounts, 30000);
  useEffect(() => setOpen(false), [pathname]);

  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }); await refresh(); navigate('/'); };
  const switchWs = async (id) => { if (id === '__new') { setNewWs(true); return; } await api(`/api/workspaces/${id}/switch`, { method: 'POST' }); await refresh(); navigate('/'); };
  const inboxCount = (counts.approval || 0) + (counts.human || 0) + (counts.to_send || 0);

  return (
    <div className="shell">
      <div className="topbar">
        <button className="btn ghost icon" aria-label="Menu" onClick={() => setOpen(true)}><LuMenu size={20} /></button>
        <span className="row" style={{ fontWeight: 700 }}><Logo size={22} />Rendevo</span>
        <span style={{ width: 36 }} />
      </div>
      {open && <div className="overlay" style={{ zIndex: 45 }} onClick={() => setOpen(false)} />}
      <aside className={`side ${open ? 'open' : ''}`}>
        <Link to="/" className="brand"><Logo />Rendevo</Link>
        <nav className="nav" aria-label="Navigation principale">
          {NAV.map((n) => {
            const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link key={n.to} to={n.to} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
                <Icon size={18} aria-hidden="true" />{n.label}
                {n.badge === 'inbox' && inboxCount > 0 && <span className="count num">{inboxCount}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="side-foot stack" style={{ '--gap': '10px' }}>
          <label className="field">
            <span className="label">Espace</span>
            <div style={{ position: 'relative' }}>
              <select className="select ws-switch" value={session.workspace.id} onChange={(e) => switchWs(e.target.value)} aria-label="Changer d'espace">
                {session.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                {['owner', 'admin'].includes(session.role) && <option value="__new">+ Nouvel espace client</option>}
              </select>
              <LuChevronsUpDown style={{ position: 'absolute', right: 10, top: 11, pointerEvents: 'none', display: 'none' }} />
            </div>
          </label>
          <div className="row spread">
            <div className="grow">
              <div className="ellipsis" style={{ fontWeight: 600 }}>{session.user.name || session.user.email}</div>
              <div className="ellipsis small muted">{session.user.email}</div>
              {session.version && <div className="small muted app-version" aria-label="Version de Rendevo">Rendevo v{session.version}</div>}
            </div>
            <button className="btn ghost icon" onClick={logout} aria-label="Se déconnecter" title="Se déconnecter"><LuLogOut size={18} /></button>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
      {newWs && <NewWorkspace onClose={() => setNewWs(false)} onDone={async () => { setNewWs(false); await refresh(); navigate('/bienvenue'); }} />}
    </div>
  );
}

function NewWorkspace({ onClose, onDone }) {
  const [name, setName] = useState('');
  const [run, busy] = useAction();
  return (
    <Modal title="Nouvel espace client" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Annuler</button>
      <button className="btn primary" disabled={!name || busy} onClick={() => run(() => api('/api/workspaces', { method: 'POST', body: { name } })).then((r) => r && onDone())}><LuPlus />Créer l'espace</button>
    </>}>
      <p className="soft" style={{ marginBottom: 14 }}>Chaque espace a sa propre offre, ses campagnes, son compte LinkedIn et son agenda. Idéal pour gérer plusieurs clients.</p>
      <Field label="Nom du client ou de l'espace"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Cabinet Durand" /></Field>
    </Modal>
  );
}

function Routes() {
  const { pathname, navigate } = useRouter();
  const { session } = useSession();
  useEffect(() => {
    if (session && !session.workspace.onboarding_done && pathname === '/') navigate('/bienvenue', { replace: true });
  }, [session, pathname, navigate]);
  if (pathname === '/bienvenue') return <Onboarding />;
  let m;
  let page;
  if (pathname === '/') page = <Dashboard />;
  else if (pathname === '/prospects') page = <Prospects />;
  else if ((m = matchPath('/prospects/:id', pathname))) page = <Prospects openId={m.id} />;
  else if (pathname === '/campagnes') page = <Campaigns />;
  else if ((m = matchPath('/campagnes/:id', pathname))) page = <CampaignEditor id={m.id} />;
  else if (pathname === '/messages') page = <Inbox />;
  else if ((m = matchPath('/messages/:id', pathname))) page = <Inbox openId={m.id} />;
  else if (pathname === '/agenda') page = <Agenda />;
  else if (pathname === '/medias') page = <Media />;
  else if (pathname.startsWith('/reglages')) page = <Settings />;
  else page = <div className="empty"><h3>Page introuvable</h3><Link to="/" className="btn">Retour au tableau de bord</Link></div>;
  return <Shell>{page}</Shell>;
}

function App() {
  const { pathname } = useRouter();
  const [state, setState] = useState({ loading: true });
  const refresh = useCallback(async () => {
    try {
      const auth = await api('/api/auth/state');
      if (!auth.authenticated) { setState({ loading: false, auth, session: null }); return; }
      const session = await api('/api/me');
      setState({ loading: false, auth, session });
    } catch (e) {
      setState({ loading: false, error: e });
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const on = () => refresh();
    window.addEventListener('rdv:unauthorized', on);
    return () => window.removeEventListener('rdv:unauthorized', on);
  }, [refresh]);

  let m;
  if ((m = matchPath('/r/:token', pathname))) return <BookingPage token={m.token} />;
  if ((m = matchPath('/v/:token', pathname))) return <VideoPage token={m.token} />;
  if (state.loading) return <Loading label="Ouverture de Rendevo" />;
  if (state.error) return <div className="public"><div className="alert err">Le serveur ne répond pas : {state.error.message}</div></div>;
  if (!state.session) return <AuthPage auth={state.auth} onDone={refresh} />;
  return (
    <SessionCtx.Provider value={{ session: state.session, refresh }}>
      <Routes />
    </SessionCtx.Provider>
  );
}

createRoot(document.getElementById('root')).render(
  <RouterProvider>
    <ToastProvider>
      <App />
    </ToastProvider>
  </RouterProvider>,
);
