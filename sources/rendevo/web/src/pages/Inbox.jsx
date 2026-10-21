import React, { useEffect, useRef, useState } from 'react';
import { LuCheck, LuX, LuSparkles, LuSend, LuArrowLeft, LuCopy, LuBot, LuUser, LuRefreshCw } from 'react-icons/lu';
import { api, useApi, useRouter, useInterval, Loading, ErrorBox, Empty, Seg, useAction, useToast, HeatBadge, StatusBadge, KIND, ago, copy, Link } from '../lib.jsx';

const FILTERS = [
  { value: 'all', label: 'Toutes' },
  { value: 'approval', label: 'À valider' },
  { value: 'human', label: 'Pour vous' },
  { value: 'to_send', label: 'À envoyer' },
  { value: 'replies', label: 'Réponses' },
];

export function Inbox({ openId }) {
  const { query, navigate } = useRouter();
  const [filter, setFilter] = useState(query.filter || 'all');
  const list = useApi(`/api/inbox?filter=${filter}`);
  useInterval(list.reload, 15000);
  const [run, busy] = useAction();
  const counts = list.data?.counts || {};

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Messages</h1>
          <p>Toutes les conversations au même endroit. Validez, modifiez ou reprenez la main à tout moment : le setter s'efface dès que vous écrivez.</p>
        </div>
        {counts.approval > 0 && <button className="btn primary" disabled={busy} onClick={() => run(async () => { await api('/api/messages/approve-all', { method: 'POST' }); list.reload(); }, (r) => 'Messages validés')}><LuCheck />Tout valider ({counts.approval})</button>}
      </div>
      <div style={{ marginBottom: 12, overflowX: 'auto' }}>
        <Seg value={filter} onChange={(f) => { setFilter(f); navigate(openId ? `/messages/${openId}?filter=${f}` : `/messages?filter=${f}`, { replace: true }); }}
          options={FILTERS.map((f) => ({ value: f.value, label: <>{f.label}{counts[f.value] ? <span className="num" style={{ marginLeft: 6, color: 'var(--encre)' }}>{counts[f.value]}</span> : null}</> }))} />
      </div>
      <div className={`panel inbox ${openId ? 'has-thread' : ''}`}>
        <div className="inbox-list" role="list">
          {list.loading && !list.data && <Loading />}
          {list.error && <ErrorBox error={list.error} />}
          {list.data && list.data.items.length === 0 && <Empty title="Rien ici">{filter === 'approval' ? 'Aucun message n\'attend votre validation.' : filter === 'human' ? 'Aucune conversation ne demande votre intervention.' : 'Les conversations apparaîtront dès les premiers messages.'}</Empty>}
          {list.data?.items.map((it) => (
            <button key={it.id} role="listitem" className={`inbox-item ${openId === it.id ? 'active' : ''}`} onClick={() => navigate(`/messages/${it.id}?filter=${filter}`)}>
              <div className="row spread" style={{ gap: 8 }}>
                <span className="ellipsis" style={{ fontWeight: 600 }}>{it.heat === 'hot' ? <span className="hl">{it.full_name}</span> : it.full_name}</span>
                <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{it.last ? ago(it.last.at) : ''}</span>
              </div>
              <div className="row" style={{ gap: 6, marginTop: 3 }}>
                {it.needs_human && <span className="badge warn">Pour vous</span>}
                {it.pending > 0 && <span className="badge info">À valider</span>}
                {it.last?.status === 'queued' && <span className="badge">Programmé</span>}
              </div>
              {it.last && <div className="preview">{it.last.direction === 'in' ? '' : 'Vous : '}{it.last.body || 'Invitation'}</div>}
            </button>
          ))}
        </div>
        {openId ? <Thread id={openId} onBack={() => navigate(`/messages?filter=${filter}`)} onChange={list.reload} /> : <div className="thread"><Empty title="Choisissez une conversation">Sélectionnez un prospect à gauche pour lire l'échange.</Empty></div>}
      </div>
    </>
  );
}

function Thread({ id, onBack, onChange }) {
  const { data: p, error, loading, reload } = useApi(`/api/prospects/${id}`);
  useInterval(reload, 15000);
  const [draft, setDraft] = useState('');
  const [incoming, setIncoming] = useState('');
  const [edit, setEdit] = useState({});
  const [run, busy] = useAction();
  const toast = useToast();
  const bodyRef = useRef(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [p?.messages?.length]);

  if (loading && !p) return <div className="thread"><Loading /></div>;
  if (error) return <div className="thread"><ErrorBox error={error} /></div>;
  const manual = p.account?.provider === 'manual';
  const refresh = () => { reload(); onChange(); };

  const act = (fn, msg) => run(async () => { await fn(); refresh(); }, msg);
  const approve = (m) => act(() => api(`/api/messages/${m.id}/approve`, { method: 'POST', body: { body: edit[m.id] ?? m.body } }), 'Message validé, envoi au prochain créneau');
  const reject = (m) => act(() => api(`/api/messages/${m.id}/reject`, { method: 'POST' }), 'Message écarté');
  const markSent = (m) => act(() => api(`/api/messages/${m.id}/mark-sent`, { method: 'POST' }), 'Marqué comme envoyé');
  const regenerate = (m) => run(async () => { const r = await api(`/api/messages/${m.id}/regenerate`, { method: 'POST', body: {} }); setEdit({ ...edit, [m.id]: r.body }); reload(); });
  const send = () => act(async () => { await api(`/api/prospects/${p.id}/reply`, { method: 'POST', body: { text: draft, resolve: true } }); setDraft(''); }, manual ? 'Message ajouté à « À envoyer »' : 'Message programmé');
  const suggest = () => run(async () => { const r = await api(`/api/prospects/${p.id}/suggest`, { method: 'POST' }); setDraft(r.text || ''); if (r.handoff_reason) toast(`Conseil : ${r.handoff_reason}`); });
  const record = () => act(async () => { await api(`/api/prospects/${p.id}/incoming`, { method: 'POST', body: { text: incoming } }); setIncoming(''); }, 'Réponse enregistrée');
  const setterPaused = !!p.setter_state?.paused;

  return (
    <div className="thread">
      <div className="thread-head row spread wrap">
        <div className="row" style={{ minWidth: 0 }}>
          <button className="btn ghost icon" onClick={onBack} aria-label="Retour à la liste"><LuArrowLeft /></button>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}><Link to={`/prospects/${p.id}`} style={{ fontWeight: 650, color: 'var(--ink)' }}>{p.full_name}</Link><HeatBadge heat={p.heat} /><StatusBadge status={p.status} /></div>
            <div className="small soft ellipsis">{p.title}{p.company ? `, ${p.company}` : ''}{p.campaign ? `, campagne ${p.campaign.name}` : ''}</div>
          </div>
        </div>
        <div className="row">
          {p.campaign?.settings?.setter_enabled !== false && (
            setterPaused || p.needs_human
              ? <button className="btn sm" disabled={busy} onClick={() => act(() => api(`/api/prospects/${p.id}/setter`, { method: 'POST' }), 'Le setter IA reprend la conversation')}><LuBot />Rendre la main au setter</button>
              : <button className="btn sm" disabled={busy} onClick={() => act(() => api(`/api/prospects/${p.id}`, { method: 'PATCH', body: { setter_paused: true } }), 'Vous avez la main sur cette conversation')}><LuUser />Reprendre la main</button>
          )}
        </div>
      </div>
      {p.needs_human && <div className="handoff">{p.human_reason || 'Cette conversation attend votre réponse.'} <button className="btn sm ghost" onClick={() => act(() => api(`/api/prospects/${p.id}`, { method: 'PATCH', body: { needs_human: false } }), 'Marqué comme traité')}>Marquer traité</button></div>}
      <div className="thread-body" ref={bodyRef}>
        {p.messages.length === 0 && <p className="small muted" style={{ textAlign: 'center' }}>Aucun message.</p>}
        {p.messages.map((m) => {
          const pending = m.status === 'pending_approval' || (manual && m.status === 'queued') || m.status === 'failed';
          if (pending) {
            return (
              <div key={m.id} className="bubble pending">
                <div className="small" style={{ fontWeight: 650, marginBottom: 6 }}>{KIND[m.kind]} {m.status === 'failed' ? `en échec : ${m.error}` : manual && m.status === 'queued' ? 'à envoyer depuis LinkedIn' : 'à valider'}</div>
                <textarea className="textarea" style={{ minHeight: 90, background: 'var(--surface)' }} value={edit[m.id] ?? m.body} onChange={(e) => setEdit({ ...edit, [m.id]: e.target.value })} aria-label="Contenu du message" placeholder={m.kind === 'invite' ? 'Invitation sans note' : ''} />
                <div className="row wrap" style={{ marginTop: 8 }}>
                  {manual && m.status === 'queued' ? (
                    <>
                      <button className="btn sm" onClick={() => copy(edit[m.id] ?? m.body, toast)}><LuCopy />Copier</button>
                      {p.linkedin_url && <a className="btn sm" href={p.linkedin_url} target="_blank" rel="noreferrer">Ouvrir LinkedIn</a>}
                      <button className="btn sm primary" disabled={busy} onClick={() => markSent(m)}><LuCheck />Marquer envoyé</button>
                    </>
                  ) : (
                    <>
                      <button className="btn sm primary" disabled={busy} onClick={() => approve(m)}><LuCheck />{m.status === 'failed' ? 'Réessayer' : 'Valider'}</button>
                      <button className="btn sm" disabled={busy} onClick={() => regenerate(m)}><LuRefreshCw />Régénérer</button>
                    </>
                  )}
                  <button className="btn sm ghost" disabled={busy} onClick={() => reject(m)}><LuX />Écarter</button>
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className={`bubble ${m.direction === 'in' ? 'in' : m.status === 'queued' ? 'queued' : 'out'}`}>
              {m.body || <em>Invitation envoyée sans note</em>}
              <div className="bubble-meta">{KIND[m.kind] || m.kind}, {m.status === 'queued' ? `programmé ${ago(m.scheduled_at)}` : ago(m.sent_at || m.created_at)}</div>
            </div>
          );
        })}
      </div>
      <div className="thread-foot stack" style={{ '--gap': '8px' }}>
        {manual && (
          <div className="row">
            <input className="input grow" placeholder="Collez ici la réponse reçue sur LinkedIn" value={incoming} onChange={(e) => setIncoming(e.target.value)} />
            <button className="btn" disabled={busy || !incoming} onClick={record}>Enregistrer la réponse</button>
          </div>
        )}
        <textarea className="textarea" style={{ minHeight: 70 }} placeholder={`Écrire à ${p.first_name || p.full_name}…`} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft) send(); }} aria-label="Votre message" />
        <div className="row spread">
          <button className="btn sm ghost" disabled={busy} onClick={suggest}><LuSparkles />Suggérer une réponse</button>
          <button className="btn primary" disabled={busy || !draft.trim()} onClick={send}><LuSend />{manual ? 'Préparer l\'envoi' : 'Envoyer'}</button>
        </div>
      </div>
    </div>
  );
}
