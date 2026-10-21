import React from 'react';
import { LuCircleAlert } from 'react-icons/lu';
import { api, useApi, useInterval, Link, Loading, ErrorBox, initials, ago, fmtTime, useAction, Switch } from '../lib.jsx';
import { useSession } from '../session.js';

const EVENT_TEXT = {
  'invite.accepted': (e) => <><strong>{e.full_name}</strong> a accepté votre invitation</>,
  'prospect.replied': (e) => <><strong>{e.full_name}</strong> a répondu</>,
  'meeting.booked': (e) => <>Rendez-vous réservé avec <strong>{e.full_name || e.data?.name}</strong></>,
  'prospect.handoff': (e) => <><strong>{e.full_name}</strong> vous attend : {e.data?.reason}</>,
  'callback.scheduled': (e) => <>Relance de <strong>{e.full_name}</strong> prévue le {new Date(e.data?.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</>,
  'goal.reached': (e) => <>Objectif de la semaine atteint : {e.data?.goal} rendez-vous</>,
  'agent.started': () => <>Agent démarré</>,
  'agent.paused': () => <>Agent mis en pause</>,
  'media.viewed': (e) => <>Vidéo « {e.data?.title} » regardée</>,
  'meeting.no_show': (e) => <><strong>{e.full_name}</strong> absent au rendez-vous, nouvelle proposition envoyée</>,
};

const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function WeekAgenda({ data }) {
  const tz = data.timezone;
  const start = new Date(data.week.start);
  const showWeekend = data.upcoming.some((m) => { const d = new Date(m.starts_at).getDay(); return d === 0 || d === 6; });
  const n = showWeekend ? 7 : 5;
  const todayKey = new Date().toLocaleDateString('fr-CA', { timeZone: tz });
  const days = Array.from({ length: n }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400e3 + 3600e3 * 12);
    const key = d.toLocaleDateString('fr-CA', { timeZone: tz });
    return {
      key,
      label: DAY_NAMES[i],
      date: d.toLocaleDateString('fr-FR', { day: 'numeric', timeZone: tz }),
      meetings: data.upcoming.filter((m) => new Date(m.starts_at).toLocaleDateString('fr-CA', { timeZone: tz }) === key),
    };
  });
  return (
    <div className="week" style={{ '--days': n }}>
      {days.map((d) => (
        <div key={d.key} className={`week-day ${d.key === todayKey ? 'today' : ''} ${d.key < todayKey ? 'past' : ''}`}>
          <div className="dname"><span>{d.label}</span><span className="num">{d.date}</span></div>
          {d.meetings.map((m) => (
            <Link key={m.id} to={m.prospect_id ? `/prospects/${m.prospect_id}` : '/agenda'} className={`mtg ${m.status}`}>
              <div className="t num">{fmtTime(m.starts_at, tz)}</div>
              <div className="n">{m.full_name || 'Rendez-vous'}</div>
              {m.company && <div className="small muted ellipsis">{m.company}</div>}
            </Link>
          ))}
          {Array.from({ length: Math.max(0, 2 - d.meetings.length) }, (_, i) => <div key={i} className="slot-line" aria-hidden="true" />)}
        </div>
      ))}
    </div>
  );
}

function rate(a, b) {
  if (!b) return '';
  return `${Math.round((a / b) * 100)} %`;
}

export function Dashboard() {
  const { session, refresh } = useSession();
  const { data, error, loading, reload } = useApi('/api/stats/overview');
  useInterval(reload, 20000);
  const [run, busy] = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;

  const toggle = (enabled) => run(async () => {
    await api('/api/agent', { method: 'POST', body: { enabled } });
    await refresh();
    reload();
  }, enabled ? 'Agent démarré' : 'Agent en pause');

  const w = data.week;
  const goal = data.goal;
  const maxBar = Math.max(1, ...data.series.map((s) => s.invites + s.messages));
  const firstName = (session.user.name || '').split(' ')[0];
  const q = data.queue;
  const todos = [
    q.approval > 0 && { n: q.approval, label: q.approval > 1 ? 'messages à valider' : 'message à valider', to: '/messages?filter=approval' },
    q.human > 0 && { n: q.human, label: q.human > 1 ? 'conversations attendent votre réponse' : 'conversation attend votre réponse', to: '/messages?filter=human' },
    data.accounts.some((a) => ['manual', 'linkedin_cookie'].includes(a.provider)) && { n: '', label: 'Messages préparés à envoyer depuis LinkedIn', to: '/messages?filter=to_send' },
  ].filter(Boolean);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bonjour{firstName ? ` ${firstName}` : ''}</h1>
          <p>{w.meetings === 0 ? 'Aucun rendez-vous réservé cette semaine pour l\'instant.' : `${w.meetings} rendez-vous réservé${w.meetings > 1 ? 's' : ''} cette semaine.`} {data.agent_enabled ? 'Votre agent travaille.' : 'Votre agent est en pause.'}</p>
        </div>
        <div className={`agent-switch ${data.agent_enabled ? 'on' : ''}`}>
          <span className="pulse" aria-hidden="true" />
          <div>
            <div className="state">{data.agent_enabled ? 'Agent actif' : 'Agent en pause'}</div>
            <div className="small muted">{data.agent_enabled ? 'Rythme humain, dans vos limites LinkedIn' : 'Aucune action n\'est envoyée'}</div>
          </div>
          <Switch checked={data.agent_enabled} disabled={busy} onChange={toggle} />
        </div>
      </div>

      {(q.accounts === 0 || q.active_campaigns === 0 || q.accounts_error > 0 || !data.public_url) && (
        <div className="stack" style={{ '--gap': '8px', marginBottom: 16 }}>
          {q.accounts === 0 && <div className="alert warn row"><LuCircleAlert />Aucun compte LinkedIn n'est connecté. <Link to="/reglages?tab=comptes">Ajouter un compte</Link></div>}
          {q.accounts > 0 && q.active_campaigns === 0 && <div className="alert warn row"><LuCircleAlert />Aucune campagne active. <Link to="/campagnes">Activer une campagne</Link></div>}
          {data.accounts.filter((a) => a.status === 'error').map((a) => <div key={a.id} className="alert err row"><LuCircleAlert />{a.name} : {a.status_detail || 'session à reconnecter'} <Link to="/reglages?tab=comptes">Vérifier</Link></div>)}
          {!data.public_url && <div className="alert row"><LuCircleAlert />Adresse publique non définie : les liens d'agenda et de vidéo envoyés aux prospects seront incomplets. <Link to="/reglages?tab=general">Renseigner l'URL Cloudflare</Link></div>}
        </div>
      )}

      <section className="panel" aria-label="Semaine en cours" style={{ marginBottom: 16 }}>
        <div className="panel-pad row spread wrap">
          <div className="goal">
            <span className="big num">{w.meetings}<span className="muted" style={{ fontSize: 'var(--step-2)', fontWeight: 500 }}> / {goal}</span></span>
            <div>
              <div style={{ fontWeight: 600 }}>rendez-vous cette semaine</div>
              <div className="goal-boxes" aria-hidden="true">{Array.from({ length: goal }, (_, i) => <span key={i} className={i < w.meetings ? 'f' : ''} />)}</div>
            </div>
          </div>
          <Link to="/agenda" className="btn">Ouvrir l'agenda</Link>
        </div>
        <WeekAgenda data={data} />
      </section>

      <section className="panel" style={{ marginBottom: 16 }} aria-label="Indicateurs de la semaine">
        <div className="kpis">
          <div className="kpi"><div className="v num">{w.invites}</div><div className="l">invitations envoyées</div><div className="r">{w.found} prospects trouvés</div></div>
          <div className="kpi"><div className="v num">{w.accepted}</div><div className="l">invitations acceptées</div><div className="r">{rate(data.funnel.connected, data.funnel.invited) && `${rate(data.funnel.connected, data.funnel.invited)} au total`}</div></div>
          <div className="kpi"><div className="v num">{w.replies}</div><div className="l">nouvelles réponses</div><div className="r">{rate(data.funnel.replied, data.funnel.connected) && `${rate(data.funnel.replied, data.funnel.connected)} des connectés`}</div></div>
          <div className="kpi">
            <div className="l" style={{ marginBottom: 6 }}>Activité, 14 jours</div>
            <div className="bars" aria-label="Actions envoyées par jour">
              {data.series.map((s) => (
                <div key={s.day} title={`${s.day} : ${s.invites} invitations, ${s.messages} messages, ${s.meetings} RDV`} style={{ height: `${Math.max(4, ((s.invites + s.messages) / maxBar) * 100)}%` }}>
                  <i style={{ height: `${s.invites + s.messages ? (s.messages / (s.invites + s.messages)) * 100 : 0}%` }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="panel" aria-label="Signaux chauds">
          <div className="panel-head"><h3>Signaux chauds</h3><Link to="/prospects?heat=hot" className="btn sm ghost">Tout voir</Link></div>
          {data.hot.length === 0 && <div className="empty small">Les prospects avec un signal d'achat récent (nouveau poste, recrutement, levée, visite de profil) apparaîtront ici.</div>}
          {data.hot.map((p) => (
            <Link key={p.id} to={`/prospects/${p.id}`} className="list-item">
              <span className="avatar hot">{initials(p.full_name)}</span>
              <div className="grow">
                <div className="ellipsis"><span className="hl" style={{ fontWeight: 600 }}>{p.full_name}</span> <span className="soft small">{p.title}{p.company ? `, ${p.company}` : ''}</span></div>
                <div className="small soft ellipsis">{(p.signals || []).map((s) => s.detail || s.label).join(' ; ')}</div>
              </div>
              <span className="num small muted">{p.fit_score}</span>
            </Link>
          ))}
        </section>

        <div className="stack" style={{ '--gap': '16px' }}>
          <section className="panel" aria-label="À traiter">
            <div className="panel-head"><h3>À traiter</h3></div>
            {todos.length === 0 && <div className="empty small">Rien ne vous attend. L'agent s'occupe du reste.</div>}
            {todos.map((t) => (
              <Link key={t.label} to={t.to} className="todo"><span className="n num">{t.n}</span><span>{t.label}</span></Link>
            ))}
          </section>
          <section className="panel" aria-label="Activité récente">
            <div className="panel-head"><h3>Activité récente</h3></div>
            {data.recent.length === 0 && <div className="empty small">L'activité de votre agent s'affichera ici.</div>}
            {data.recent.map((e, i) => (
              <div key={i} className="list-item">
                <div className="grow small">{(EVENT_TEXT[e.type] || (() => e.type))(e)}</div>
                <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{ago(e.created_at)}</span>
              </div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
