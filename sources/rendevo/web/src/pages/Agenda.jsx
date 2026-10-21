import React, { useMemo, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuCopy, LuVideo, LuExternalLink } from 'react-icons/lu';
import { api, useApi, Loading, ErrorBox, Modal, Field, useAction, useToast, copy, fmtTime, Link } from '../lib.jsx';

const MEETING_STATUS = { confirmed: 'Confirmé', done: 'Effectué', no_show: 'Absent', cancelled: 'Annulé' };
const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function mondayOf(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const wd = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - wd);
  return x;
}

export function Agenda() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const from = weekStart.toISOString();
  const to = new Date(weekStart.getTime() + 7 * 86400e3).toISOString();
  const { data, error, loading, reload } = useApi(`/api/meetings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const settings = useApi('/api/settings');
  const slots = useApi('/api/availability/slots?count=12');
  const [open, setOpen] = useState(null);
  const toast = useToast();

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86400e3)), [weekStart]);
  const byDay = (d) => (data || []).filter((m) => new Date(m.starts_at).toDateString() === d.toDateString());
  const hasWeekend = (data || []).some((m) => [0, 6].includes(new Date(m.starts_at).getDay()));
  const shown = hasWeekend ? days : days.slice(0, 5);
  const todayStr = new Date().toDateString();
  const label = `${weekStart.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} au ${new Date(weekStart.getTime() + 6 * 86400e3).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Agenda</h1>
          <p>Les rendez-vous réservés par le setter, par votre lien de réservation ou par vous. Abonnez votre agenda habituel au flux iCal pour les voir partout.</p>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <div className="row">
            <button className="btn sm icon" aria-label="Semaine précédente" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * 86400e3))}><LuChevronLeft /></button>
            <button className="btn sm" onClick={() => setWeekStart(mondayOf(new Date()))}>Cette semaine</button>
            <button className="btn sm icon" aria-label="Semaine suivante" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 86400e3))}><LuChevronRight /></button>
          </div>
          <h3 className="num">{label}</h3>
        </div>
        {loading && !data && <Loading />}
        {error && <ErrorBox error={error} />}
        {data && (
          <div className="week" style={{ '--days': shown.length }}>
            {shown.map((d, i) => {
              const items = byDay(d);
              return (
                <div key={i} className={`week-day ${d.toDateString() === todayStr ? 'today' : ''} ${d < new Date(new Date().toDateString()) ? 'past' : ''}`} style={{ minHeight: 240 }}>
                  <div className="dname"><span>{DAY_NAMES[i]}</span><span className="num">{d.getDate()}</span></div>
                  {items.map((m) => (
                    <button key={m.id} className={`mtg ${m.status}`} style={{ textAlign: 'left', border: 0, cursor: 'pointer', borderLeft: '3px solid' }} onClick={() => setOpen(m)}>
                      <div className="t num">{fmtTime(m.starts_at)} {m.status !== 'confirmed' && `, ${MEETING_STATUS[m.status].toLowerCase()}`}</div>
                      <div className="n">{m.full_name || m.title}</div>
                      {m.company && <div className="small muted ellipsis">{m.company}</div>}
                    </button>
                  ))}
                  {items.length === 0 && <div className="slot-line" aria-hidden="true" />}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="panel panel-pad stack" style={{ '--gap': '14px' }}>
          <div className="section-title">Partager et synchroniser</div>
          {settings.data && (
            <>
              <Field label="Lien de réservation" hint="À envoyer à un prospect ou à mettre dans votre profil. Seuls vos créneaux libres sont proposés.">
                <div className="row">
                  <input className="input" readOnly value={absolute(settings.data.booking_link)} onFocus={(e) => e.target.select()} />
                  <button className="btn icon" aria-label="Copier le lien de réservation" onClick={() => copy(absolute(settings.data.booking_link), toast)}><LuCopy /></button>
                  <a className="btn icon" aria-label="Ouvrir la page de réservation" href={settings.data.booking_link} target="_blank" rel="noreferrer"><LuExternalLink /></a>
                </div>
              </Field>
              <Field label="Flux iCal de vos rendez-vous" hint="Google Agenda : Autres agendas > À partir de l'URL. Outlook : Ajouter un calendrier > À partir d'Internet.">
                <div className="row">
                  <input className="input" readOnly value={absolute(settings.data.calendar_feed)} onFocus={(e) => e.target.select()} />
                  <button className="btn icon" aria-label="Copier le flux iCal" onClick={() => copy(absolute(settings.data.calendar_feed), toast)}><LuCopy /></button>
                </div>
              </Field>
              <Link className="btn sm" style={{ alignSelf: 'flex-start' }} to="/reglages?tab=agenda">Modifier mes disponibilités</Link>
            </>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h3>Prochains créneaux libres</h3></div>
          <div className="panel-pad">
            {slots.data?.length === 0 && <p className="small muted">Aucun créneau libre sur la période. Élargissez vos disponibilités.</p>}
            <div className="slot-grid">
              {(slots.data || []).map((s) => <span key={s.iso} className="badge" style={{ padding: '6px 10px', fontSize: '0.8rem' }}>{s.label}</span>)}
            </div>
          </div>
        </section>
      </div>
      {open && <MeetingModal m={open} onClose={() => setOpen(null)} onChange={() => { setOpen(null); reload(); slots.reload(); }} />}
    </>
  );
}

function absolute(u) {
  if (!u) return '';
  return u.startsWith('http') ? u : window.location.origin + u;
}

function MeetingModal({ m, onClose, onChange }) {
  const [run, busy] = useAction();
  const [notes, setNotes] = useState(m.notes || '');
  const [when, setWhen] = useState(() => { const d = new Date(m.starts_at); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); });
  const patch = (body, msg) => run(async () => { await api(`/api/meetings/${m.id}`, { method: 'PATCH', body }); onChange(); }, msg);
  return (
    <Modal title={m.full_name || m.title} onClose={onClose} footer={<>
      {m.status === 'confirmed' && <button className="btn danger" disabled={busy} onClick={() => patch({ status: 'cancelled' }, 'Rendez-vous annulé')}>Annuler le RDV</button>}
      {m.status === 'confirmed' && <button className="btn" disabled={busy} onClick={() => patch({ status: 'no_show' }, 'Absence notée : une nouvelle proposition part au prospect')}>Absent</button>}
      {m.status === 'confirmed' && <button className="btn primary" disabled={busy} onClick={() => patch({ status: 'done', notes }, 'Rendez-vous effectué')}>Effectué</button>}
      {m.status !== 'confirmed' && <button className="btn" onClick={onClose}>Fermer</button>}
    </>}>
      <div className="stack" style={{ '--gap': '14px' }}>
        <div className="soft">{new Date(m.starts_at).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} ({Math.round((new Date(m.ends_at) - new Date(m.starts_at)) / 60000)} min), {MEETING_STATUS[m.status]}</div>
        <div className="small soft">{m.title}{m.campaign_name ? `, campagne ${m.campaign_name}` : ''}</div>
        <div className="row wrap">
          {m.meeting_url && <a className="btn sm" href={m.meeting_url} target="_blank" rel="noreferrer"><LuVideo />Rejoindre la visio</a>}
          {m.linkedin_url && <a className="btn sm" href={m.linkedin_url} target="_blank" rel="noreferrer"><LuExternalLink />LinkedIn</a>}
          {m.prospect_id && <Link className="btn sm" to={`/prospects/${m.prospect_id}`}>Fiche prospect</Link>}
        </div>
        <Field label="Notes"><textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (m.notes || '') && patch({ notes })} /></Field>
        {m.status === 'confirmed' && (
          <Field label="Déplacer le rendez-vous">
            <div className="row"><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /><button className="btn" disabled={busy} onClick={() => patch({ starts_at: new Date(when).toISOString() }, 'Rendez-vous déplacé')}>Déplacer</button></div>
          </Field>
        )}
      </div>
    </Modal>
  );
}
