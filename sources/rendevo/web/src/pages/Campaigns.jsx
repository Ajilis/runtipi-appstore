import React, { useEffect, useState } from 'react';
import { LuPlus, LuPlay, LuPause, LuTrash2, LuSparkles, LuArchive } from 'react-icons/lu';
import { api, useApi, useRouter, Loading, ErrorBox, Empty, Field, Switch, useAction, Link, Seg } from '../lib.jsx';
import { IcpEditor, CampaignToggles } from '../components/Editors.jsx';

const STATUS_LABEL = { draft: 'Brouillon', active: 'Active', paused: 'En pause', archived: 'Archivée' };
const STATUS_TONE = { active: 'ok', paused: 'warn', draft: '', archived: 'cold' };

function pct(a, b) { return b ? `${Math.round((a / b) * 100)} %` : '–'; }

export function Campaigns() {
  const { navigate } = useRouter();
  const [archived, setArchived] = useState(false);
  const { data, error, loading, reload } = useApi(`/api/campaigns${archived ? '?archived=1' : ''}`);
  const [run, busy] = useAction();
  const create = () => run(async () => { const c = await api('/api/campaigns', { method: 'POST', body: { name: 'Nouvelle campagne' } }); navigate(`/campagnes/${c.id}`); });
  const setStatus = (c, status) => run(async () => { await api(`/api/campaigns/${c.id}/status`, { method: 'POST', body: { status } }); reload(); }, status === 'active' ? 'Campagne activée' : 'Campagne mise en pause');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Campagnes</h1>
          <p>Une campagne réunit une cible, une offre, une séquence de messages et un compte LinkedIn. Les budgets d'envoi restent partagés au niveau du compte.</p>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={() => setArchived(!archived)}>{archived ? 'Masquer les archivées' : 'Voir les archivées'}</button>
          <button className="btn primary" onClick={create} disabled={busy}><LuPlus />Nouvelle campagne</button>
        </div>
      </div>
      {error && <ErrorBox error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && data.length === 0 && <div className="panel"><Empty title="Aucune campagne" action={<button className="btn primary" onClick={create}><LuPlus />Créer une campagne</button>}>Commencez par décrire qui vous voulez rencontrer.</Empty></div>}
      {data && data.length > 0 && (
        <div className="panel table-wrap">
          <table className="table">
            <thead><tr><th>Campagne</th><th>Statut</th><th>Prospects</th><th>Acceptation</th><th>Réponses</th><th>RDV</th><th /></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} onClick={() => navigate(`/campagnes/${c.id}`)}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div className="small soft">{c.account_name ? `Compte : ${c.account_name}` : 'Aucun compte associé'}{c.waiting ? `, ${c.waiting} en attente` : ''}</div>
                  </td>
                  <td><span className={`badge ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span></td>
                  <td className="num">{c.prospects}</td>
                  <td className="num">{pct(c.connected, c.invited)} <span className="small muted">({c.connected}/{c.invited})</span></td>
                  <td className="num">{pct(c.replied, c.connected)} <span className="small muted">({c.replied})</span></td>
                  <td className="num" style={{ fontWeight: 650 }}>{c.meetings}</td>
                  <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                    {c.status === 'active'
                      ? <button className="btn sm" disabled={busy} onClick={() => setStatus(c, 'paused')}><LuPause />Pause</button>
                      : c.status !== 'archived' && <button className="btn sm" disabled={busy} onClick={() => setStatus(c, 'active')}><LuPlay />Activer</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function CampaignEditor({ id }) {
  const { data, error, loading, reload } = useApi(`/api/campaigns/${id}`);
  const accounts = useApi('/api/accounts');
  const media = useApi('/api/media');
  const [c, setC] = useState(null);
  const [tab, setTab] = useState('cible');
  const [dirty, setDirty] = useState(false);
  const [run, busy] = useAction();

  useEffect(() => { if (data) { setC(data); setDirty(false); } }, [data]);
  if (loading && !c) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!c) return null;

  const assisted = (accounts.data || []).some((a) => a.id === c.account_id && a.provider === 'linkedin_cookie');
  const upd = (patch) => { setC({ ...c, ...patch }); setDirty(true); };
  const save = () => run(async () => {
    await api(`/api/campaigns/${id}`, { method: 'PATCH', body: { name: c.name, goal: c.goal, offer: c.offer, icp: c.icp, sequence: c.sequence, settings: c.settings, account_id: c.account_id } });
    reload();
  }, 'Campagne enregistrée');
  const setStatus = (status) => run(async () => {
    if (dirty) await api(`/api/campaigns/${id}`, { method: 'PATCH', body: { name: c.name, goal: c.goal, offer: c.offer, icp: c.icp, sequence: c.sequence, settings: c.settings, account_id: c.account_id } });
    await api(`/api/campaigns/${id}/status`, { method: 'POST', body: { status } });
    reload();
  }, { active: 'Campagne activée', paused: 'Campagne en pause', archived: 'Campagne archivée' }[status]);

  return (
    <>
      <div className="page-head">
        <div className="grow" style={{ minWidth: 260 }}>
          <Link to="/campagnes" className="small">Campagnes</Link>
          <input className="input" style={{ fontSize: 'var(--step-2)', fontWeight: 650, border: 0, padding: '4px 0', background: 'transparent', boxShadow: 'none' }} value={c.name} onChange={(e) => upd({ name: e.target.value })} aria-label="Nom de la campagne" />
          <div className="row small soft" style={{ gap: 14 }}>
            <span className={`badge ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
            <span className="num">{c.prospects} prospects</span><span className="num">{c.invited} invités</span><span className="num">{c.replied} réponses</span><span className="num">{c.meetings} RDV</span>
          </div>
        </div>
        <div className="row wrap">
          <Link className="btn" to={`/prospects?campaign=${c.id}`}>Voir les prospects</Link>
          {dirty && <button className="btn" onClick={save} disabled={busy}>Enregistrer</button>}
          {c.status === 'active'
            ? <button className="btn" onClick={() => setStatus('paused')} disabled={busy}><LuPause />Mettre en pause</button>
            : <button className="btn primary" onClick={() => setStatus('active')} disabled={busy || !c.account_id}><LuPlay />Activer</button>}
        </div>
      </div>
      {!c.account_id && <div className="alert warn" style={{ marginBottom: 14 }}>Choisissez un compte LinkedIn dans l'onglet Réglages pour pouvoir activer la campagne.</div>}
      {assisted && <div className="alert info" style={{ marginBottom: 14 }}>
        <strong>Campagne assistée avec votre session LinkedIn.</strong> Aucun envoi automatique, sans Unipile.
        <div className="row wrap" style={{ marginTop: 10 }}>
          <Link className="btn sm" to={`/prospects?campaign=${c.id}&import=1`}>Importer des profils CSV / URLs</Link>
          <Link className="btn sm" to="/messages?filter=approval">Brouillons à valider</Link>
          <Link className="btn sm" to="/messages?filter=to_send">À envoyer manuellement</Link>
        </div>
      </div>}

      <div className="tabs" role="tablist">
        {[['cible', 'Cible et offre'], ['sequence', 'Séquence'], ['reglages', 'Réglages'], ['test', 'Tester les messages']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'cible' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="panel panel-pad"><div className="section-title">Qui contacter</div><IcpEditor value={c.icp} onChange={(icp) => upd({ icp })} compact /></div>
          <div className="panel panel-pad stack" style={{ '--gap': '14px' }}>
            <div className="section-title">Ce que vous proposez à cette cible</div>
            <Field label="Offre" hint="Laissez votre offre générale ou adaptez-la à cette cible."><textarea className="textarea" style={{ minHeight: 140 }} value={c.offer} onChange={(e) => upd({ offer: e.target.value })} /></Field>
            <Field label="Objectif">
              <select className="select" value={c.goal} onChange={(e) => upd({ goal: e.target.value })}>
                <option value="meeting">Rendez-vous</option><option value="call">Appel téléphonique</option><option value="signup">Inscription (essai, démo)</option><option value="webinar">Webinaire</option><option value="other">Autre</option>
              </select>
            </Field>
            <Field label="Score minimum pour contacter" hint="Sous ce score, le prospect est classé hors cible.">
              <input className="input num" type="number" min="0" max="100" style={{ maxWidth: 120 }} value={c.settings.min_score} onChange={(e) => upd({ settings: { ...c.settings, min_score: Number(e.target.value) } })} />
            </Field>
          </div>
        </div>
      )}

      {tab === 'sequence' && <SequenceEditor sequence={c.sequence} media={media.data || []} onChange={(sequence) => upd({ sequence })} enabled={c.settings.followups_enabled} />}

      {tab === 'reglages' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="panel panel-pad stack" style={{ '--gap': '14px' }}>
            <div className="section-title">{assisted ? "Validation humaine et préparation" : "Automatisation"}</div>
            <CampaignToggles assisted={assisted} value={c.settings} onChange={(settings) => upd({ settings })} />
          </div>
          <div className="panel panel-pad stack" style={{ '--gap': '14px' }}>
            <div className="section-title">Compte et langue</div>
            <Field label="Compte LinkedIn">
              <select className="select" value={c.account_id || ''} onChange={(e) => upd({ account_id: e.target.value || null })}>
                <option value="">Choisir un compte…</option>
                {(accounts.data || []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.provider === "linkedin_cookie" ? " · Session LinkedIn (manuel)" : ""}</option>)}
              </select>
            </Field>
            <Field label="Langue des messages">
              <select className="select" value={c.settings.language} onChange={(e) => upd({ settings: { ...c.settings, language: e.target.value } })}>
                <option value="auto">Celle du prospect</option><option value="fr">Français</option><option value="en">Anglais</option><option value="es">Espagnol</option><option value="de">Allemand</option>
              </select>
            </Field>
            <Field label="Nouveaux prospects par semaine (recherche automatique)">
              <input className="input num" type="number" min="1" max="1000" style={{ maxWidth: 140 }} value={c.settings.weekly_prospects} onChange={(e) => upd({ settings: { ...c.settings, weekly_prospects: Number(e.target.value) } })} />
            </Field>
            <hr className="divider" />
            <button className="btn danger" style={{ alignSelf: 'flex-start' }} onClick={() => window.confirm('Archiver la campagne ? Les envois programmés sont annulés, l\'historique est conservé.') && setStatus('archived')}><LuArchive />Archiver la campagne</button>
          </div>
        </div>
      )}

      {tab === 'test' && <Playground campaignId={id} dirty={dirty} onSave={save} />}
      {dirty && tab !== 'test' && (
        <div className="row" style={{ position: 'sticky', bottom: 16, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn ghost" onClick={() => { setC(data); setDirty(false); }}>Annuler les modifications</button>
          <button className="btn primary lg" onClick={save} disabled={busy}>Enregistrer</button>
        </div>
      )}
    </>
  );
}

function SequenceEditor({ sequence, onChange, media, enabled }) {
  const steps = sequence;
  const set = (i, patch) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const followups = steps.slice(2);
  return (
    <div className="panel panel-pad">
      {!enabled && <div className="alert warn" style={{ marginBottom: 14 }}>Les relances sont désactivées dans Réglages : seuls l'invitation et le premier message seront envoyés.</div>}
      <div className="seq">
        <div className="seq-step">
          <div className="seq-n">1</div>
          <div className="seq-card stack" style={{ '--gap': '10px' }}>
            <div className="row spread"><strong>Invitation</strong><span className="small muted">dès que le prospect est qualifié</span></div>
            <Switch checked={steps[0]?.with_note} onChange={(v) => set(0, { with_note: v })} label="Ajouter une note personnalisée (300 caractères)" />
            <p className="small muted">Sans note, le taux d'acceptation est souvent meilleur ; le premier message fait le travail.</p>
          </div>
        </div>
        <div className="seq-step">
          <div className="seq-n">2</div>
          <div className="seq-card stack" style={{ '--gap': '10px' }}>
            <div className="row spread wrap">
              <strong>Premier message</strong>
              <label className="row small soft">après acceptation, attendre <input className="input num" type="number" min="0" max="72" style={{ width: 70, minHeight: 30 }} value={steps[1]?.delay_hours ?? 3} onChange={(e) => set(1, { delay_hours: Number(e.target.value) })} /> heures</label>
            </div>
            <Field label="Consignes pour l'IA" hint="L'IA part du signal du prospect et de votre offre. Ajoutez un angle, une preuve, une question."><textarea className="textarea" style={{ minHeight: 70 }} value={steps[1]?.instructions || ''} onChange={(e) => set(1, { instructions: e.target.value })} /></Field>
          </div>
        </div>
        {followups.map((s, k) => {
          const i = k + 2;
          return (
            <div className="seq-step" key={i}>
              <div className="seq-n">{i + 1}</div>
              <div className="seq-card stack" style={{ '--gap': '10px' }}>
                <div className="row spread wrap">
                  <strong>Relance {k + 1}</strong>
                  <div className="row">
                    <label className="row small soft">sans réponse depuis <input className="input num" type="number" min="1" max="60" style={{ width: 64, minHeight: 30 }} value={s.delay_days} onChange={(e) => set(i, { delay_days: Number(e.target.value) })} /> jours</label>
                    <button className="btn sm ghost icon" aria-label={`Supprimer la relance ${k + 1}`} onClick={() => onChange(steps.filter((_, j) => j !== i))}><LuTrash2 /></button>
                  </div>
                </div>
                <Field label="Consignes pour l'IA"><textarea className="textarea" style={{ minHeight: 60 }} value={s.instructions || ''} onChange={(e) => set(i, { instructions: e.target.value })} /></Field>
                <Field label="Vidéo ou document à joindre" hint="Le lien de visionnage est ajouté au message. Une courte vidéo réveille souvent un prospect silencieux.">
                  <select className="select" value={s.media_id || ''} onChange={(e) => set(i, { media_id: e.target.value || null })}>
                    <option value="">Aucun</option>
                    {media.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                  </select>
                </Field>
              </div>
            </div>
          );
        })}
      </div>
      {steps.length < 10 && <button className="btn" style={{ marginLeft: 48 }} onClick={() => onChange([...steps, { type: 'followup', delay_days: 5, instructions: '' }])}><LuPlus />Ajouter une relance</button>}
      <p className="small muted" style={{ marginTop: 14, marginLeft: 48 }}>Dès qu'un prospect répond, la séquence s'arrête et le setter IA prend la conversation.</p>
    </div>
  );
}

function Playground({ campaignId, dirty, onSave }) {
  const [kind, setKind] = useState('first');
  const [step, setStep] = useState(2);
  const [reply, setReply] = useState('');
  const [out, setOut] = useState(null);
  const [run, busy] = useAction();
  const generate = () => run(async () => {
    if (dirty) await onSave();
    setOut(await api(`/api/campaigns/${campaignId}/preview`, { method: 'POST', body: { kind, step, reply: reply || undefined } }));
  });
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="panel panel-pad stack" style={{ '--gap': '14px' }}>
        <p className="soft">Générez des messages pour un prospect fictif de votre cible. Rien n'est envoyé.</p>
        <Field label="Message à tester"><div><Seg value={kind} onChange={setKind} options={[{ value: 'invite', label: 'Note d\'invitation' }, { value: 'first', label: 'Premier message' }, { value: 'followup', label: 'Relance' }]} /></div></Field>
        {kind === 'followup' && <Field label="Numéro de relance"><input className="input num" type="number" min="1" max="8" style={{ maxWidth: 100 }} value={step - 1} onChange={(e) => setStep(Number(e.target.value) + 1)} /></Field>}
        <Field label="Réponse du prospect (facultatif)" hint="Pour voir comment le setter IA répond."><input className="input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Ex. Intéressant, vous avez un exemple ?" /></Field>
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={generate} disabled={busy}>{busy ? <span className="spinner" /> : <LuSparkles />}Générer</button>
      </div>
      <div className="panel">
        {!out && <div className="empty small">Le résultat apparaîtra ici.</div>}
        {out && (
          <div className="panel-pad stack" style={{ '--gap': '12px' }}>
            {!out.ai && <div className="alert small">Messages générés par les modèles intégrés. Configurez un fournisseur d'IA dans Réglages pour des messages vraiment personnalisés.</div>}
            <div className="small soft">Prospect : <strong>{out.prospect.full_name}</strong>, {out.prospect.title}{out.prospect.company ? `, ${out.prospect.company}` : ''}{out.prospect.signals?.[0] ? ` (${out.prospect.signals[0].label})` : ''}</div>
            <div className="bubble out" style={{ maxWidth: '100%' }}>{out.text || <em>Invitation sans note</em>}</div>
            {out.setter && (
              <>
                <div className="bubble in" style={{ maxWidth: '100%' }}>{reply}</div>
                <div className="small soft">Intention détectée : <strong>{out.setter.intent}</strong>{out.setter.handoff_reason ? `, transmis à vous : ${out.setter.handoff_reason}` : ''}</div>
                {out.setter.reply && <div className="bubble out" style={{ maxWidth: '100%' }}>{out.setter.reply}</div>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
