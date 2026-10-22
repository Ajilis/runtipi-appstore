import React, { useEffect, useMemo, useState } from 'react';
import { LuUpload, LuDownload, LuSearch, LuPlus, LuExternalLink, LuSparkles, LuList, LuColumns3, LuRefreshCw } from 'react-icons/lu';
import { api, useApi, useRouter, Loading, ErrorBox, Empty, Modal, Drawer, Field, Seg, useAction, useToast, HeatBadge, StatusBadge, STATUS, KIND, initials, ago, fmtDateTime, Link } from '../lib.jsx';
import { normalizedLinkedinProfileUrl } from '../lib/companion.js';

const SIGNAL_OPTIONS = [
  ['new_role', 'Nouveau poste'], ['hiring', 'Recrute'], ['funding', 'Levée de fonds'], ['profile_visit', 'A visité votre profil'],
  ['post_engagement', 'A réagi à votre publication'], ['competitor_engagement', "Engagé auprès d'un concurrent"], ['topic_post', 'A publié sur votre sujet'], ['company_news', 'Actualité de son entreprise'],
];

export function Prospects({ openId }) {
  const { query, navigate } = useRouter();
  const [filters, setFilters] = useState({ q: '', heat: query.heat || '', status: '', campaign: query.campaign || '', needs_human: '' });
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(new Set());
  const companionUrl = normalizedLinkedinProfileUrl(query.companion_url);
  const [modal, setModal] = useState(query.import === '1' ? 'import' : null);
  const qs = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString(), [filters]);
  const { data, error, loading, reload } = useApi(`/api/prospects?limit=300&${qs}`);
  const campaigns = useApi('/api/campaigns');
  const [run, busy] = useAction();
  const toast = useToast();

  useEffect(() => setSelected(new Set()), [qs]);
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target ? e.target.value : e });
  const items = data?.items || [];
  const allSel = items.length > 0 && items.every((p) => selected.has(p.id));

  const bulk = (action, value) => run(async () => {
    await api('/api/prospects/bulk', { method: 'POST', body: { ids: [...selected], action, value } });
    setSelected(new Set());
    reload();
  }, 'Modifications appliquées');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Prospects</h1>
          <p>Chaque profil est qualifié selon votre cible et ses signaux d'achat récents. Les plus chauds sont contactés en premier.</p>
        </div>
        <div className="row wrap">
          <a className="btn" href={`/api/prospects/export.csv?${qs}`}><LuDownload />Exporter</a>
          <button className="btn" onClick={() => setModal('add')}><LuPlus />Ajouter</button>
          <button className="btn" onClick={() => setModal('import')}><LuUpload />Importer</button>
          <button className="btn primary" onClick={() => setModal('discover')}><LuSparkles />Trouver des prospects</button>
        </div>
      </div>

      <div className="row wrap" style={{ marginBottom: 14 }}>
        <div className="row grow" style={{ minWidth: 220, position: 'relative' }}>
          <LuSearch style={{ position: 'absolute', left: 11, color: 'var(--ink-3)' }} aria-hidden="true" />
          <input className="input" style={{ paddingLeft: 34 }} placeholder="Nom, entreprise, poste…" value={filters.q} onChange={set('q')} aria-label="Rechercher" />
        </div>
        <select className="select" style={{ width: 'auto' }} value={filters.heat} onChange={set('heat')} aria-label="Chaleur">
          <option value="">Toutes chaleurs</option><option value="hot">Chauds</option><option value="warm">Tièdes</option><option value="cold">Froids</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={filters.status} onChange={set('status')} aria-label="Statut">
          <option value="">Tous statuts</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={filters.campaign} onChange={set('campaign')} aria-label="Campagne">
          <option value="">Toutes campagnes</option><option value="none">Sans campagne</option>
          {(campaigns.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <Seg value={view} onChange={setView} options={[{ value: 'list', label: <span className="row" style={{ gap: 6 }}><LuList />Liste</span> }, { value: 'pipeline', label: <span className="row" style={{ gap: 6 }}><LuColumns3 />Pipeline</span> }]} />
      </div>

      {selected.size > 0 && (
        <div className="panel panel-pad row wrap" style={{ marginBottom: 12, padding: '10px 14px' }}>
          <strong className="num">{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</strong>
          <select className="select" style={{ width: 'auto' }} defaultValue="" onChange={(e) => e.target.value && bulk('assign_campaign', e.target.value === 'none' ? null : e.target.value)} disabled={busy}>
            <option value="">Ajouter à une campagne…</option>
            {(campaigns.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="none">Retirer de la campagne</option>
          </select>
          <select className="select" style={{ width: 'auto' }} defaultValue="" onChange={(e) => e.target.value && bulk('stage', e.target.value)} disabled={busy}>
            <option value="">Étape du pipeline…</option>
            {(data?.stages || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button className="btn sm" onClick={() => bulk('requalify')} disabled={busy}><LuRefreshCw />Requalifier</button>
          <button className="btn sm" onClick={() => bulk('exclude')} disabled={busy}>Exclure</button>
          <button className="btn sm danger" onClick={() => window.confirm('Supprimer définitivement ces prospects et leurs conversations ?') && bulk('delete')} disabled={busy}>Supprimer</button>
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>Annuler</button>
        </div>
      )}

      {error && <ErrorBox error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && items.length === 0 && (
        <div className="panel"><Empty title="Aucun prospect" action={<button className="btn primary" onClick={() => setModal('discover')}><LuSparkles />Trouver des prospects</button>}>
          Lancez une recherche depuis une campagne, importez un fichier CSV ou collez des URLs LinkedIn.
        </Empty></div>
      )}
      {data && items.length > 0 && view === 'list' && (
        <div className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="sel"><input type="checkbox" aria-label="Tout sélectionner" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(items.map((p) => p.id)))} /></th>
                <th>Prospect</th><th>Signal</th><th>Chaleur</th><th>Statut</th><th>Campagne</th><th>Activité</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} onClick={() => navigate(`/prospects/${p.id}`)}>
                  <td className="sel" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Sélectionner ${p.full_name}`} checked={selected.has(p.id)} onChange={() => { const n = new Set(selected); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); setSelected(n); }} />
                  </td>
                  <td style={{ minWidth: 220 }}>
                    <div className="row" style={{ gap: 10 }}>
                      <span className={`avatar ${p.heat === 'hot' ? 'hot' : ''}`}>{initials(p.full_name)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{p.heat === 'hot' ? <span className="hl">{p.full_name}</span> : p.full_name}{p.needs_human && <span className="badge warn" style={{ marginLeft: 8 }}>À traiter</span>}</div>
                        <div className="small soft ellipsis" style={{ maxWidth: 320 }}>{p.title || p.headline}{p.company ? `, ${p.company}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td className="small soft" style={{ maxWidth: 220 }}><span className="ellipsis" style={{ display: 'block' }}>{p.signals?.[0] ? (p.signals[0].detail || p.signals[0].label) : '–'}</span></td>
                  <td><HeatBadge heat={p.heat} /> <span className="small muted num">{p.fit_score ?? ''}</span></td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="small soft">{p.campaign_name || '–'}</td>
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{ago(p.last_reply_at || p.last_contact_at || p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.total > items.length && <div className="small muted" style={{ padding: 12 }}>{items.length} affichés sur {data.total}. Affinez les filtres pour voir les autres.</div>}
        </div>
      )}
      {data && items.length > 0 && view === 'pipeline' && <Pipeline items={items} stages={data.stages} onMove={async (id, stage) => { await api(`/api/prospects/${id}`, { method: 'PATCH', body: { stage } }); reload(); }} onOpen={(id) => navigate(`/prospects/${id}`)} />}

      {modal === 'import' && <ImportModal campaigns={campaigns.data || []} initialUrls={companionUrl || ''} initialCampaign={filters.campaign} onClose={() => setModal(null)} onDone={(r) => { setModal(null); reload(); toast(`${r.created} importés, ${r.duplicates} doublons ignorés${r.invalid ? `, ${r.invalid} lignes invalides` : ''}.`); }} />}
      {modal === 'add' && <AddModal campaigns={campaigns.data || []} onClose={() => setModal(null)} onDone={(id) => { setModal(null); reload(); navigate(`/prospects/${id}`); }} />}
      {modal === 'discover' && <DiscoverModal campaigns={campaigns.data || []} onClose={() => setModal(null)} onDone={(r) => { setModal(null); reload(); toast(`${r.created} nouveaux prospects qualifiés sur ${r.found} trouvés.`); }} />}
      {openId && <ProspectDrawer id={openId} campaigns={campaigns.data || []} onClose={() => navigate('/prospects')} onChange={reload} />}
    </>
  );
}

function Pipeline({ items, stages, onMove, onOpen }) {
  const [over, setOver] = useState(null);
  return (
    <div className="kanban">
      {stages.map((s) => {
        const col = items.filter((p) => p.stage === s.id);
        return (
          <div key={s.id} className={`kcol ${over === s.id ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(s.id); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) onMove(id, s.id); }}>
            <h4><span>{s.label}</span><span className="num muted">{col.length}</span></h4>
            {col.map((p) => (
              <div key={p.id} className="kcard" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)} onClick={() => onOpen(p.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(p.id)}>
                <div style={{ fontWeight: 600 }}>{p.heat === 'hot' ? <span className="hl">{p.full_name}</span> : p.full_name}</div>
                <div className="small soft ellipsis">{p.company || p.title}</div>
                <div className="row" style={{ marginTop: 6, gap: 6 }}><StatusBadge status={p.status} /></div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function CampaignSelect({ campaigns, value, onChange, allowNone = true }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowNone && <option value="">Aucune campagne (à trier plus tard)</option>}
      {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

function ImportModal({ campaigns, initialCampaign, initialUrls = '', onClose, onDone }) {
  const [mode, setMode] = useState(initialUrls ? 'urls' : 'csv');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [urls, setUrls] = useState(initialUrls);
  const [campaign, setCampaign] = useState(initialCampaign && initialCampaign !== 'none' ? initialCampaign : campaigns[0]?.id || '');
  const [signal, setSignal] = useState('');
  const [signalDetail, setSignalDetail] = useState('');
  const [run, busy] = useAction();
  const submit = () => run(async () => {
    const body = { campaign_id: campaign || null };
    if (initialUrls && mode === 'urls') body.source = 'companion';
    if (mode === 'csv') body.csv = csv; else body.urls = urls;
    if (signal) body.signal = { type: signal, detail: signalDetail };
    const r = await api('/api/prospects/import', { method: 'POST', body });
    onDone(r);
  });
  return (
    <Modal title="Importer des prospects" onClose={onClose} wide footer={<>
      <button className="btn ghost" onClick={onClose}>Annuler</button>
      <button className="btn primary" disabled={busy || (mode === 'csv' ? !csv : !urls)} onClick={submit}><LuUpload />Importer</button>
    </>}>
      <div className="stack" style={{ '--gap': '16px' }}>
        <Seg value={mode} onChange={setMode} options={[{ value: 'csv', label: 'Fichier CSV' }, { value: 'urls', label: 'URLs LinkedIn' }]} />
        {mode === 'csv' ? (
          <Field label="Fichier CSV" hint="Colonnes reconnues : nom, prénom, poste, entreprise, localisation, linkedin_url, e-mail. Export Sales Navigator, Waalaxy ou tableur.">
            <input className="input" type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files[0]; if (f) { setFileName(f.name); setCsv(await f.text()); } }} />
            {fileName && <div className="small soft">{fileName} : {Math.max(0, csv.split(/\r?\n/).filter(Boolean).length - 1)} lignes</div>}
          </Field>
        ) : (
          <Field label="URLs de profils" hint="Une par ligne. Rendevo prépare les brouillons, sans lire automatiquement les profils ni envoyer de messages. Ajoutez ensuite le poste et l'entreprise si besoin.">
            <textarea className="textarea" value={urls} onChange={(e) => setUrls(e.target.value)} placeholder={'https://www.linkedin.com/in/…\nhttps://www.linkedin.com/in/…'} />
          </Field>
        )}
        <Field label="Campagne"><CampaignSelect campaigns={campaigns} value={campaign} onChange={setCampaign} /></Field>
        <div className="grid-2">
          <Field label="Signal commun (facultatif)" hint="Ex. ils ont tous commenté le même post.">
            <select className="select" value={signal} onChange={(e) => setSignal(e.target.value)}>
              <option value="">Aucun</option>
              {SIGNAL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          {signal && <Field label="Détail du signal"><input className="input" value={signalDetail} onChange={(e) => setSignalDetail(e.target.value)} placeholder="Ex. Commentaire sur le post de X du 12/10" /></Field>}
        </div>
      </div>
    </Modal>
  );
}

function AddModal({ campaigns, onClose, onDone }) {
  const [f, setF] = useState({ full_name: '', linkedin_url: '', title: '', company: '', location: '', email: '', campaign_id: campaigns[0]?.id || '' });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target ? e.target.value : e });
  return (
    <Modal title="Ajouter un prospect" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Annuler</button>
      <button className="btn primary" disabled={busy || !f.full_name} onClick={() => run(async () => { const r = await api('/api/prospects', { method: 'POST', body: { ...f, campaign_id: f.campaign_id || null } }); onDone(r.id); })}>Ajouter</button>
    </>}>
      <div className="stack" style={{ '--gap': '12px' }}>
        <Field label="Nom complet"><input className="input" value={f.full_name} onChange={set('full_name')} autoFocus /></Field>
        <Field label="URL LinkedIn"><input className="input" value={f.linkedin_url} onChange={set('linkedin_url')} placeholder="https://www.linkedin.com/in/…" /></Field>
        <div className="grid-2">
          <Field label="Poste"><input className="input" value={f.title} onChange={set('title')} /></Field>
          <Field label="Entreprise"><input className="input" value={f.company} onChange={set('company')} /></Field>
          <Field label="Localisation"><input className="input" value={f.location} onChange={set('location')} /></Field>
          <Field label="E-mail (facultatif)"><input className="input" value={f.email} onChange={set('email')} /></Field>
        </div>
        <Field label="Campagne"><CampaignSelect campaigns={campaigns} value={f.campaign_id} onChange={set('campaign_id')} /></Field>
      </div>
    </Modal>
  );
}

function DiscoverModal({ campaigns, onClose, onDone }) {
  const usable = campaigns.filter((c) => c.account_provider && !['manual', 'linkedin_cookie', 'linkedin_companion'].includes(c.account_provider));
  const [campaign, setCampaign] = useState(usable[0]?.id || '');
  const [limit, setLimit] = useState(15);
  const [run, busy] = useAction();
  return (
    <Modal title="Trouver des prospects" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Annuler</button>
      <button className="btn primary" disabled={busy || !campaign} onClick={() => run(async () => onDone(await api(`/api/campaigns/${campaign}/discover`, { method: 'POST', body: { limit } })))}>{busy ? <span className="spinner" /> : <LuSparkles />}Lancer la recherche</button>
    </>}>
      {usable.length === 0 ? (
        <div className="alert warn">La recherche automatique n'est pas disponible pour les comptes LinkedIn assistés. Importez manuellement des URLs de profils (depuis Chrome Companion) ou un CSV.</div>
      ) : (
        <div className="stack" style={{ '--gap': '12px' }}>
          <p className="soft">L'agent cherche des profils correspondant à la cible de la campagne, les enrichit et les qualifie. Les exclusions et doublons sont écartés.</p>
          <Field label="Campagne"><CampaignSelect campaigns={usable} value={campaign} onChange={setCampaign} allowNone={false} /></Field>
          <Field label="Nombre de profils à analyser"><input className="input num" type="number" min="1" max="50" value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ maxWidth: 120 }} /></Field>
        </div>
      )}
    </Modal>
  );
}

export function ProspectDrawer({ id, campaigns, onClose, onChange }) {
  const { data: p, error, loading, reload } = useApi(`/api/prospects/${id}`);
  const [run, busy] = useAction();
  const [notes, setNotes] = useState(null);
  const [sig, setSig] = useState({ type: 'new_role', detail: '' });
  const [incoming, setIncoming] = useState('');

  const patch = (body, msg) => run(async () => { await api(`/api/prospects/${id}`, { method: 'PATCH', body }); reload(); onChange?.(); }, msg);

  return (
    <Drawer onClose={onClose} head={p ? (
      <div>
        <div className="row wrap" style={{ gap: 8 }}>
          <h2 style={{ fontSize: 'var(--step-1)' }}>{p.heat === 'hot' ? <span className="hl">{p.full_name}</span> : p.full_name}</h2>
          <HeatBadge heat={p.heat} /><StatusBadge status={p.status} />
          {p.simulated && <span className="badge">Bac à sable</span>}
        </div>
        <div className="soft small" style={{ marginTop: 4 }}>{p.title || p.headline}{p.company ? `, ${p.company}` : ''}{p.location ? `, ${p.location}` : ''}</div>
      </div>
    ) : null}>
      {loading && !p && <Loading />}
      {error && <ErrorBox error={error} />}
      {p && (
        <div className="stack" style={{ '--gap': '22px' }}>
          <div className="row wrap">
            {p.linkedin_url && <a className="btn sm" href={p.linkedin_url} target="_blank" rel="noreferrer"><LuExternalLink />Profil LinkedIn</a>}
            <Link className="btn sm" to={`/messages/${p.id}`}>Ouvrir la conversation</Link>
            {['excluded', 'low_fit', 'not_accepted'].includes(p.status) && <button className="btn sm" disabled={busy} onClick={() => patch({ status: 'qualified' }, 'Prospect requalifié')}>Contacter quand même</button>}
            {!['excluded', 'lost', 'won'].includes(p.status) && <button className="btn sm" disabled={busy} onClick={() => patch({ status: 'excluded' }, 'Prospect exclu')}>Exclure</button>}
            {p.status === 'invited' && ['manual', 'linkedin_cookie', 'linkedin_companion'].includes(p.account?.provider) && <button className="btn sm" disabled={busy} onClick={() => run(async () => { await api(`/api/prospects/${p.id}/accepted`, { method: 'POST' }); reload(); }, 'Invitation acceptée')}>Invitation acceptée</button>}
            {!['won', 'lost'].includes(p.status) && <button className="btn sm" disabled={busy} onClick={() => patch({ status: 'won' }, 'Marqué gagné')}>Gagné</button>}
            {!['won', 'lost'].includes(p.status) && <button className="btn sm ghost" disabled={busy} onClick={() => patch({ status: 'lost' }, 'Marqué perdu')}>Perdu</button>}
          </div>

          {p.needs_human && <div className="alert warn">{p.human_reason || 'Ce prospect attend votre réponse.'} <Link to={`/messages/${p.id}`}>Répondre</Link></div>}

          <section>
            <div className="section-title">Pourquoi ce prospect</div>
            <p className="soft">{p.fit_reasoning || 'Pas encore qualifié.'}</p>
            {(p.signals || []).length > 0 && (
              <div style={{ marginTop: 8 }}>
                {p.signals.map((s, i) => (
                  <div key={i} className="signal"><span className="hl small" style={{ fontWeight: 650, whiteSpace: 'nowrap' }}>{s.label}</span><span className="small soft grow">{s.detail}</span><span className="small muted">{s.date ? ago(s.date) : ''}</span></div>
                ))}
              </div>
            )}
            <div className="row wrap" style={{ marginTop: 10 }}>
              <select className="select" style={{ width: 'auto' }} value={sig.type} onChange={(e) => setSig({ ...sig, type: e.target.value })} aria-label="Type de signal">
                {SIGNAL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input className="input grow" style={{ minWidth: 160 }} placeholder="Détail du signal" value={sig.detail} onChange={(e) => setSig({ ...sig, detail: e.target.value })} />
              <button className="btn sm" disabled={busy} onClick={() => run(async () => { await api(`/api/prospects/${p.id}/signals`, { method: 'POST', body: sig }); setSig({ ...sig, detail: '' }); reload(); onChange?.(); }, 'Signal ajouté, prospect requalifié')}>Ajouter un signal</button>
            </div>
          </section>

          <section className="grid-2">
            <Field label="Campagne">
              <select className="select" value={p.campaign_id || ''} onChange={(e) => patch({ campaign_id: e.target.value || null }, 'Campagne mise à jour')}>
                <option value="">Aucune</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Étape commerciale" hint="Indépendante du statut LinkedIn.">
              <select className="select" value={p.stage} onChange={(e) => patch({ stage: e.target.value })}>
                {p.stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
          </section>

          <section>
            <div className="section-title">Coordonnées</div>
            <dl className="kv">
              <dt>Source</dt><dd>{p.source}</dd>
              <dt>E-mail</dt><dd>{p.email || '–'}</dd>
              <dt>Téléphone</dt><dd>{p.phone || '–'}</dd>
              <dt>Ajouté</dt><dd>{ago(p.created_at)}</dd>
              {p.callback_at && <><dt>À relancer le</dt><dd>{new Date(p.callback_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</dd></>}
            </dl>
          </section>

          <section>
            <div className="section-title">Notes</div>
            <textarea className="textarea" value={notes ?? p.notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== null && notes !== p.notes && patch({ notes }, 'Notes enregistrées')} placeholder="Contexte utile à l'IA et à vous" />
          </section>

          {p.meetings.length > 0 && (
            <section>
              <div className="section-title">Rendez-vous</div>
              {p.meetings.map((m) => <div key={m.id} className="row spread small" style={{ padding: '4px 0' }}><span>{fmtDateTime(m.starts_at)}</span><span className={`badge ${m.status === 'confirmed' ? 'ok' : m.status === 'no_show' ? 'err' : ''}`}>{{ confirmed: 'Confirmé', done: 'Effectué', no_show: 'Absent', cancelled: 'Annulé' }[m.status]}</span></div>)}
            </section>
          )}

          <section>
            <div className="section-title">Conversation</div>
            {p.messages.length === 0 && <p className="small muted">Aucun message pour l'instant.</p>}
            <div className="stack" style={{ '--gap': '8px' }}>
              {p.messages.map((m) => (
                <div key={m.id} className={`bubble ${m.direction === 'in' ? 'in' : m.status === 'pending_approval' ? 'pending' : m.status === 'queued' ? 'queued' : 'out'}`} style={{ maxWidth: '100%' }}>
                  {m.body || <em className="muted">Invitation sans note</em>}
                  <div className="bubble-meta">{KIND[m.kind] || m.kind}, {m.status === 'pending_approval' ? 'à valider' : m.status === 'queued' ? 'programmé' : m.status === 'failed' ? `échec : ${m.error}` : ago(m.sent_at || m.created_at)}</div>
                </div>
              ))}
            </div>
            {p.account?.provider !== 'unipile' && (
              <div className="row" style={{ marginTop: 10 }}>
                <input className="input grow" placeholder="Coller une réponse reçue sur LinkedIn" value={incoming} onChange={(e) => setIncoming(e.target.value)} />
                <button className="btn sm" disabled={busy || !incoming} onClick={() => run(async () => { await api(`/api/prospects/${p.id}/incoming`, { method: 'POST', body: { text: incoming } }); setIncoming(''); reload(); }, 'Réponse enregistrée, le setter prend le relais')}>Enregistrer</button>
              </div>
            )}
          </section>

          <section>
            <div className="section-title">Historique</div>
            <div className="timeline">
              {p.events.map((e, i) => <div key={i} className="ev"><span className="soft">{eventLabel(e)}</span> <span className="muted">{ago(e.created_at)}</span></div>)}
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}

function eventLabel(e) {
  return {
    'prospect.found': 'Trouvé et qualifié',
    'invite.sent': 'Invitation envoyée',
    'invite.accepted': 'Invitation acceptée',
    'message.sent': `Message envoyé (${KIND[e.data?.kind] || e.data?.kind || ''})`,
    'message.received': 'Réponse reçue',
    'prospect.replied': 'Première réponse',
    'meeting.booked': 'Rendez-vous réservé',
    'meeting.no_show': 'Absent au rendez-vous',
    'meeting.cancelled': 'Rendez-vous annulé',
    'meeting.done': 'Rendez-vous effectué',
    'prospect.handoff': `Transmis à vous : ${e.data?.reason || ''}`,
    'callback.scheduled': 'Relance programmée',
  }[e.type] || e.type;
}
