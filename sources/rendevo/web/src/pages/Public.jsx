import React, { useMemo, useState } from 'react';
import { LuCalendarCheck, LuVideo } from 'react-icons/lu';
import { api, useApi, Loading, Field, Logo } from '../lib.jsx';

export function BookingPage({ token }) {
  const { data, error, loading, reload } = useApi(`/api/public/booking/${token}`);
  const [slot, setSlot] = useState(null);
  const [f, setF] = useState({ name: '', email: '', company: '', message: '' });
  const [done, setDone] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const days = useMemo(() => {
    const map = new Map();
    for (const s of data?.slots || []) {
      const d = new Date(s.iso);
      const key = d.toLocaleDateString('fr-CA', { timeZone: data.timezone });
      if (!map.has(key)) map.set(key, { key, label: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: data.timezone }), slots: [] });
      map.get(key).slots.push(s);
    }
    return [...map.values()];
  }, [data]);
  const [day, setDay] = useState(null);
  const current = days.find((d) => d.key === day) || days[0];

  if (loading) return <Loading />;
  if (error) return <div className="public"><div className="alert err">{error.message}</div></div>;

  const book = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      setDone(await api(`/api/public/booking/${token}`, { method: 'POST', body: { ...f, slot: slot.iso } }));
    } catch (x) {
      setErr(x.message);
      reload();
      setSlot(null);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="public">
        <div className="public-card panel panel-pad stack" style={{ '--gap': '14px', textAlign: 'center', maxWidth: 520 }}>
          <LuCalendarCheck size={40} color="var(--vert)" style={{ margin: '0 auto' }} />
          <h1 style={{ fontSize: 'var(--step-2)' }}>C'est réservé</h1>
          <p className="soft">{new Date(done.starts_at).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: data.timezone })} avec {data.host}.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            {done.meeting_url && <a className="btn primary" href={done.meeting_url} target="_blank" rel="noreferrer"><LuVideo />Lien de la visio</a>}
            {done.ics && <a className="btn" href={done.ics}>Ajouter à mon agenda</a>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="public">
      <div className="public-card stack" style={{ '--gap': '18px' }}>
        <div className="panel panel-pad">
          <p className="small muted">{data.offer || 'Rendez-vous'}</p>
          <h1 style={{ fontSize: 'var(--step-3)', marginTop: 4 }}>{data.title} avec {data.host}</h1>
          <p className="soft" style={{ marginTop: 8 }}>{data.duration} minutes en visio.{data.summary ? ` ${data.summary}` : ''}</p>
        </div>
        <div className="panel panel-pad stack" style={{ '--gap': '14px' }}>
          {days.length === 0 && <p className="soft">Aucun créneau disponible pour le moment. Revenez un peu plus tard.</p>}
          {days.length > 0 && (
            <>
              <div className="row wrap" role="tablist" aria-label="Jours disponibles">
                {days.map((d) => <button key={d.key} role="tab" aria-selected={current.key === d.key} className={`btn sm ${current.key === d.key ? 'primary' : ''}`} onClick={() => { setDay(d.key); setSlot(null); }}>{d.label}</button>)}
              </div>
              <div className="slot-grid">
                {current.slots.map((s) => (
                  <button key={s.iso} className={`slot-btn num ${slot?.iso === s.iso ? 'on' : ''}`} onClick={() => setSlot(s)}>
                    {new Date(s.iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: data.timezone })}
                  </button>
                ))}
              </div>
            </>
          )}
          {err && <div className="alert err">{err}</div>}
          {slot && (
            <form className="stack" style={{ '--gap': '12px', marginTop: 8 }} onSubmit={book}>
              <div className="alert info">{slot.label}</div>
              <div className="grid-2">
                <Field label="Nom"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></Field>
                <Field label="E-mail"><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></Field>
              </div>
              <Field label="Entreprise"><input className="input" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} autoComplete="organization" /></Field>
              <Field label="Ce dont vous souhaitez parler"><textarea className="textarea" style={{ minHeight: 70 }} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
              <button className="btn primary lg" disabled={busy} type="submit">Confirmer le rendez-vous</button>
            </form>
          )}
        </div>
        <p className="small muted row" style={{ justifyContent: 'center' }}><Logo size={16} />Réservation gérée par Rendevo</p>
      </div>
    </div>
  );
}

export function VideoPage({ token }) {
  const { data, error, loading } = useApi(`/api/public/media/${token}?meta=1`);
  if (loading) return <Loading />;
  if (error) return <div className="public"><div className="alert err">Cette vidéo n'est plus disponible.</div></div>;
  return (
    <div className="public">
      <div className="public-card stack" style={{ '--gap': '14px' }}>
        <h1 style={{ fontSize: 'var(--step-2)' }}>{data.title}</h1>
        <p className="soft">Un message de {data.sender}</p>
        {data.kind === 'video' && <video src={data.src} controls autoPlay playsInline style={{ width: '100%', borderRadius: 'var(--radius-m)', background: '#000' }} />}
        {data.kind === 'image' && <img src={data.src} alt={data.title} style={{ width: '100%', borderRadius: 'var(--radius-m)' }} />}
        {data.kind === 'document' && <a className="btn primary" href={data.src} target="_blank" rel="noreferrer">Ouvrir le document</a>}
      </div>
    </div>
  );
}
