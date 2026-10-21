import React, { useEffect, useState } from 'react';
import { LuPlus, LuTrash2, LuPlugZap, LuCopy, LuPause, LuPlay } from 'react-icons/lu';
import { api, useApi, useRouter, Loading, ErrorBox, Field, Modal, Switch, useAction, useToast, copy, ago } from '../lib.jsx';
import { useSession } from '../session.js';
import { OfferEditor, VoiceEditor, IcpEditor, AvailabilityEditor, ScheduleEditor } from '../components/Editors.jsx';
import { AccountForm, emptyAccount } from '../components/AccountForm.jsx';
import { LinkedInAccountProfile } from '../components/LinkedInAccountProfile.jsx';

const SECTIONS = [
  ['general', 'Général'],
  ['offre', 'Offre et voix'],
  ['cible', 'Cible par défaut'],
  ['comptes', 'Comptes LinkedIn'],
  ['agenda', 'Disponibilités'],
  ['horaires', 'Horaires et limites'],
  ['ia', 'Intelligence artificielle'],
  ['integrations', 'Intégrations'],
  ['equipe', 'Équipe'],
  ['moncompte', 'Mon compte'],
];

export function Settings() {
  const { query, navigate } = useRouter();
  const tab = query.tab || 'general';
  const { data, error, loading, reload } = useApi('/api/settings');
  const [draft, setDraft] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setDraft(data.settings); }, [data]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!draft) return null;
  const save = (keys, msg = 'Réglages enregistrés') => run(async () => {
    const body = Object.fromEntries(keys.map((k) => [k, draft[k]]));
    await api('/api/settings', { method: 'PATCH', body });
    reload();
  }, msg);
  const patch = (k) => (v) => setDraft({ ...draft, [k]: v });
  const SaveBar = ({ keys }) => <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}><button className="btn primary" disabled={busy} onClick={() => save(keys)}>Enregistrer</button></div>;

  return (
    <>
      <div className="page-head"><div><h1>Réglages</h1><p>Les réglages s'appliquent à l'espace courant. Le fichier de configuration du serveur est dans <code>{data.config_file}</code>.</p></div></div>
      <div className="settings-grid">
        <nav className="settings-nav" aria-label="Sections des réglages">
          {SECTIONS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => navigate(`/reglages?tab=${k}`, { replace: true })}>{l}</button>)}
        </nav>
        <div style={{ minWidth: 0 }}>
          {tab === 'general' && <General data={data} draft={draft} setDraft={setDraft} onSave={() => save(['public_url'])} busy={busy} />}
          {tab === 'offre' && (
            <>
              <div className="panel panel-pad"><div className="section-title">Votre offre</div><OfferEditor value={draft.offer} onChange={patch('offer')} /></div>
              <div className="panel panel-pad" style={{ marginTop: 16 }}><div className="section-title">Votre voix</div><VoiceEditor value={draft.voice} onChange={patch('voice')} /></div>
              <SaveBar keys={['offer', 'voice']} />
            </>
          )}
          {tab === 'cible' && (
            <>
              <div className="panel panel-pad"><p className="soft" style={{ marginBottom: 14 }}>Utilisée par les nouvelles campagnes et pour qualifier les prospects sans campagne.</p><IcpEditor value={draft.icp} onChange={patch('icp')} /></div>
              <SaveBar keys={['icp']} />
            </>
          )}
          {tab === 'comptes' && <Accounts limits={data.limits} />}
          {tab === 'agenda' && (
            <>
              <div className="panel panel-pad"><AvailabilityEditor value={draft.availability} onChange={patch('availability')} goal={draft.goal?.meetings_per_week} onGoal={(g) => setDraft({ ...draft, goal: { meetings_per_week: g } })} /></div>
              <SaveBar keys={['availability', 'goal']} />
            </>
          )}
          {tab === 'horaires' && (
            <>
              <div className="panel panel-pad">
                <div className="section-title">Fenêtre d'envoi</div>
                <p className="soft small" style={{ marginBottom: 14 }}>L'agent n'envoie des invitations et messages que sur ces horaires, avec un délai aléatoire entre chaque action, comme une personne.</p>
                <ScheduleEditor value={draft.schedule} onChange={patch('schedule')} />
              </div>
              <SaveBar keys={['schedule']} />
              <div className="panel" style={{ marginTop: 16 }}>
                <div className="panel-head"><h3>Budgets de sécurité par abonnement</h3></div>
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>Abonnement</th><th>Invitations / jour</th><th>Invitations / semaine</th><th>Messages / jour</th></tr></thead>
                  <tbody>{Object.entries(data.limits || {}).map(([k, v]) => (
                    <tr key={k} style={{ cursor: 'default' }}><td>{{ free: 'Gratuit', premium: 'Premium', sales_navigator: 'Sales Navigator' }[k] || k}</td><td className="num">{v.invites_per_day}</td><td className="num">{v.invites_per_week}</td><td className="num">{v.messages_per_day}</td></tr>
                  ))}</tbody>
                </table></div>
                <p className="small muted" style={{ padding: '10px 20px' }}>Modifiables dans le fichier de configuration (section limits) ou par compte dans Comptes LinkedIn.</p>
              </div>
            </>
          )}
          {tab === 'ia' && <AiSettings data={data} draft={draft} setDraft={setDraft} reload={reload} />}
          {tab === 'integrations' && <Integrations />}
          {tab === 'equipe' && <Team />}
          {tab === 'moncompte' && <MyAccount />}
        </div>
      </div>
    </>
  );
}

function General({ data, draft, setDraft, onSave, busy }) {
  const { session, refresh } = useSession();
  const [name, setName] = useState(session.workspace.name);
  const [run] = useAction();
  return (
    <div className="stack" style={{ '--gap': '16px' }}>
      <div className="panel panel-pad stack" style={{ '--gap': '14px' }}>
        <Field label="Nom de l'espace"><div className="row"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn" onClick={() => run(async () => { await api('/api/workspace', { method: 'PATCH', body: { name } }); await refresh(); }, 'Nom enregistré')}>Renommer</button></div></Field>
      </div>
      <div className="panel panel-pad stack" style={{ '--gap': '14px' }}>
        <div className="section-title">Adresse publique</div>
        <p className="soft small">L'URL HTTPS de votre Cloudflare Tunnel. Elle sert aux liens envoyés aux prospects : invitation d'agenda, vidéo, page de réservation.</p>
        {data.public_url_from_env
          ? <div className="alert ok">Définie par l'installation Runtipi : <strong>{data.public_url}</strong></div>
          : (
            <Field label="URL publique">
              <div className="row"><input className="input" value={draft.public_url || ''} onChange={(e) => setDraft({ ...draft, public_url: e.target.value })} placeholder="https://rdv.exemple.fr" /><button className="btn primary" disabled={busy} onClick={onSave}>Enregistrer</button></div>
            </Field>
          )}
      </div>
      <div className="panel panel-pad small soft">Version {session.version}. Données et fichier de configuration persistants dans le dossier de l'application Runtipi.</div>
    </div>
  );
}

function Accounts({ limits }) {
  const { data, error, loading, reload } = useApi('/api/accounts');
  const [draft, setDraft] = useState(null);
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const test = (a) => run(async () => { const r = await api(`/api/accounts/${a.id}/test`, { method: 'POST' }); toast(r.detail, r.ok ? 'ok' : 'err'); reload(); });
  const toggle = (a) => run(async () => { await api(`/api/accounts/${a.id}`, { method: 'PATCH', body: { status: a.status === 'paused' ? 'active' : 'paused' } }); reload(); }, a.status === 'paused' ? 'Compte réactivé' : 'Compte en pause');
  return (
    <div className="stack" style={{ '--gap': '16px' }}>
      <div className="row spread"><p className="soft">Chaque compte a son propre budget d'actions, partagé entre ses campagnes.</p><button className="btn primary" onClick={() => setDraft(emptyAccount())}><LuPlus />Ajouter un compte</button></div>
      {data.map((a) => {
        const lim = a.limits || limits?.[a.account_type] || {};
        return (
          <div key={a.id} className="panel panel-pad stack" style={{ '--gap': '12px' }}>
            <div className="row spread wrap">
              <div>
                <div className="row" style={{ gap: 8 }}><strong>{a.name}</strong><span className={`badge ${a.status === 'active' ? 'ok' : a.status === 'error' ? 'err' : 'warn'}`}>{{ active: 'Actif', paused: 'En pause', error: 'À reconnecter' }[a.status] || a.status}</span></div>
                <div className="small soft">{{ simulation: 'Bac à sable', unipile: 'LinkedIn via Unipile', linkedin_cookie: 'LinkedIn par cookie (manuel)', manual: 'Manuel' }[a.provider]}, {{ free: 'Gratuit', premium: 'Premium', sales_navigator: 'Sales Navigator' }[a.account_type]}{a.last_sync_at ? `, synchronisé ${ago(a.last_sync_at)}` : ''}</div>
              </div>
              <div className="row">
                {a.provider !== 'linkedin_cookie' && <button className="btn sm" disabled={busy} onClick={() => test(a)}><LuPlugZap />Tester</button>}
                <button className="btn sm" disabled={busy} onClick={() => toggle(a)}>{a.status === 'paused' ? <><LuPlay />Réactiver</> : <><LuPause />Pause</>}</button>
                <button className="btn sm" onClick={() => setEdit({ ...a, config: { ...a.config } })}>Modifier</button>
              </div>
            </div>
            {a.status_detail && <div className="alert warn small">{a.status_detail}</div>}
            {a.provider === "linkedin_cookie" && a.config?.has_session && <LinkedInAccountProfile accountId={a.id} onChecked={reload} />}
            <div className="row wrap small soft" style={{ gap: 18 }}>
              <span>Invitations aujourd'hui : <strong className="num">{a.invites_today}</strong> / {lim.invites_per_day}</span>
              <span>Cette semaine : <strong className="num">{a.invites_week}</strong> / {lim.invites_per_week}</span>
              <span>Messages aujourd'hui : <strong className="num">{a.messages_today}</strong> / {lim.messages_per_day}</span>
            </div>
          </div>
        );
      })}
      {data.length === 0 && <div className="panel"><div className="empty">Aucun compte. Ajoutez le bac à sable pour tester, ou votre LinkedIn via Unipile.</div></div>}
      {draft && (
        <Modal title="Ajouter un compte" wide onClose={() => setDraft(null)} footer={<>
          <button className="btn ghost" onClick={() => setDraft(null)}>Annuler</button>
          <button className="btn primary" disabled={busy} onClick={() => run(async () => { await api('/api/accounts', { method: 'POST', body: draft }); setDraft(null); reload(); }, 'Compte ajouté')}>Ajouter</button>
        </>}>
          <AccountForm value={draft} onChange={setDraft} />
        </Modal>
      )}
      {edit && (
        <Modal title={`Modifier ${edit.name}`} wide onClose={() => setEdit(null)} footer={<>
          <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => window.confirm('Supprimer ce compte ? Ses campagnes n\'enverront plus rien.') && run(async () => { await api(`/api/accounts/${edit.id}`, { method: 'DELETE' }); setEdit(null); reload(); }, 'Compte supprimé')}><LuTrash2 />Supprimer</button>
          <button className="btn ghost" onClick={() => setEdit(null)}>Annuler</button>
          <button className="btn primary" disabled={busy} onClick={() => run(async () => { await api(`/api/accounts/${edit.id}`, { method: 'PATCH', body: edit }); setEdit(null); reload(); }, 'Compte enregistré')}>Enregistrer</button>
        </>}>
          <div className="stack" style={{ '--gap': '16px' }}>
            <AccountForm value={edit} onChange={setEdit} existing />
            <Switch checked={edit.config?.ignore_window} onChange={(v) => setEdit({ ...edit, config: { ...edit.config, ignore_window: v } })} label="Ignorer la fenêtre d'envoi (utile pour le bac à sable)" />
            <div className="grid-3">
              {[['invites_per_day', 'Invitations / jour'], ['invites_per_week', 'Invitations / semaine'], ['messages_per_day', 'Messages / jour']].map(([k, l]) => (
                <Field key={k} label={l} hint="Vide : valeur par défaut">
                  <input className="input num" type="number" min="0" value={edit.config?.limits?.[k] ?? ''} placeholder={String(limits?.[edit.account_type]?.[k] ?? '')}
                    onChange={(e) => setEdit({ ...edit, config: { ...edit.config, limits: { ...(edit.config?.limits || {}), [k]: e.target.value } } })} />
                </Field>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const AI_PRESETS = [
  { id: 'none', label: 'Aucune (modèles intégrés)', provider: 'none' },
  { id: 'openai', label: 'OpenAI', provider: 'openai', base_url: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic (Claude)', provider: 'anthropic', base_url: 'https://api.anthropic.com/v1' },
  { id: 'mistral', label: 'Mistral AI', provider: 'openai', base_url: 'https://api.mistral.ai/v1' },
  { id: 'openrouter', label: 'OpenRouter', provider: 'openai', base_url: 'https://openrouter.ai/api/v1' },
  { id: 'ollama', label: 'Ollama (local)', provider: 'openai', base_url: 'http://192.168.1.10:11434/v1' },
];

function AiSettings({ data, draft, setDraft, reload }) {
  const ai = draft.ai || { provider: 'none' };
  const [key, setKey] = useState('');
  const [run, busy] = useAction();
  const toast = useToast();
  const set = (patch) => setDraft({ ...draft, ai: { ...ai, ...patch } });
  const save = () => run(async () => {
    await api('/api/settings', { method: 'PATCH', body: { ai: { ...ai, api_key: key || undefined } } });
    setKey('');
    reload();
  }, 'Réglages IA enregistrés');
  const test = () => run(async () => {
    await api('/api/settings', { method: 'PATCH', body: { ai: { ...ai, api_key: key || undefined } } });
    setKey('');
    const r = await api('/api/settings/ai/test', { method: 'POST' });
    toast(`Connexion réussie en ${r.ms} ms`);
    reload();
  });
  return (
    <div className="stack" style={{ '--gap': '16px' }}>
      <div className={`alert ${data.ai_enabled ? 'ok' : ''}`}>{data.ai_enabled ? 'L\'IA est active : messages, qualification de l\'offre et setter sont rédigés par le modèle.' : 'Sans IA, Rendevo utilise des modèles de messages intégrés et des règles pour le setter. Branchez un modèle pour des messages vraiment personnalisés.'}</div>
      <div className="panel panel-pad stack" style={{ '--gap': '14px' }}>
        <Field label="Fournisseur">
          <select className="select" value={AI_PRESETS.find((p) => p.provider === ai.provider && (p.provider !== 'openai' || p.base_url === ai.base_url))?.id || (ai.provider === 'openai' ? 'openai' : ai.provider || 'none')}
            onChange={(e) => { const p = AI_PRESETS.find((x) => x.id === e.target.value); set({ provider: p.provider, base_url: p.base_url || '' }); }}>
            {AI_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        {ai.provider !== 'none' && (
          <>
            <Field label="URL de l'API" hint="Toute API compatible OpenAI fonctionne (/chat/completions)."><input className="input" value={ai.base_url || ''} onChange={(e) => set({ base_url: e.target.value })} /></Field>
            <Field label="Modèle" hint="Nom exact du modèle chez votre fournisseur."><input className="input" value={ai.model || ''} onChange={(e) => set({ model: e.target.value })} placeholder="Nom du modèle" /></Field>
            <Field label="Clé API" hint={ai.has_api_key ? 'Une clé est enregistrée (chiffrée). Laissez vide pour la conserver.' : 'Chiffrée dans la base de données.'}>
              <input className="input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
            </Field>
            <Field label={`Créativité : ${Number(ai.temperature ?? 0.7).toFixed(1)}`}><input type="range" min="0" max="1.2" step="0.1" value={ai.temperature ?? 0.7} onChange={(e) => set({ temperature: Number(e.target.value) })} /></Field>
          </>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {ai.provider !== 'none' && <button className="btn" disabled={busy} onClick={test}>Tester la connexion</button>}
          <button className="btn primary" disabled={busy} onClick={save}>Enregistrer</button>
        </div>
      </div>
      {data.ai_defaults?.configured && <p className="small muted">Un modèle par défaut est aussi défini dans le fichier de configuration du serveur ({data.ai_defaults.provider}, {data.ai_defaults.model}).</p>}
    </div>
  );
}

function Integrations() {
  const hooks = useApi('/api/webhooks');
  const tokens = useApi('/api/tokens');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState(['meeting.booked', 'prospect.replied']);
  const [newToken, setNewToken] = useState(null);
  const [run, busy] = useAction();
  const toast = useToast();
  const { session } = useSession();
  const mcpUrl = `${session.public_url || window.location.origin}/mcp`;
  return (
    <div className="stack" style={{ '--gap': '16px' }}>
      <div className="panel">
        <div className="panel-head"><h3>Connecteur MCP</h3></div>
        <div className="panel-pad stack" style={{ '--gap': '12px' }}>
          <p className="soft small">Pilotez Rendevo depuis Claude, ChatGPT ou tout assistant compatible MCP : statistiques, prospects chauds, escalades, réponses. Créez un jeton, puis ajoutez un connecteur personnalisé avec cette URL et l'en-tête <code>Authorization: Bearer</code>.</p>
          <div className="row"><input className="input" readOnly value={mcpUrl} /><button className="btn icon" aria-label="Copier l'URL MCP" onClick={() => copy(mcpUrl, toast)}><LuCopy /></button></div>
          {newToken && (
            <div className="alert ok stack" style={{ '--gap': '6px' }}>
              <strong>Copiez ce jeton maintenant, il ne sera plus affiché.</strong>
              <div className="row"><code className="code grow">{newToken}</code><button className="btn sm" onClick={() => copy(newToken, toast)}><LuCopy />Copier</button></div>
            </div>
          )}
          {(tokens.data || []).map((t) => (
            <div key={t.id} className="row spread small"><span><strong>{t.name}</strong> <span className="muted">{t.prefix}…, {t.last_used_at ? `utilisé ${ago(t.last_used_at)}` : 'jamais utilisé'}</span></span><button className="btn sm ghost danger" onClick={() => run(async () => { await api(`/api/tokens/${t.id}`, { method: 'DELETE' }); tokens.reload(); }, 'Jeton révoqué')}>Révoquer</button></div>
          ))}
          <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => run(async () => { const name = window.prompt('Nom du jeton', 'Claude') || 'Assistant IA'; const r = await api('/api/tokens', { method: 'POST', body: { name } }); setNewToken(r.token); tokens.reload(); })}><LuPlus />Créer un jeton</button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Webhooks</h3></div>
        <div className="panel-pad stack" style={{ '--gap': '12px' }}>
          <p className="soft small">Envoyez les événements vers votre CRM (HubSpot, Pipedrive, Folk via Make, n8n ou Zapier). Chaque appel est signé avec l'en-tête <code>X-Rendevo-Signature</code> (HMAC SHA-256 du corps avec le secret du webhook).</p>
          {(hooks.data?.items || []).map((h) => (
            <div key={h.id} className="row spread wrap small" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div className="ellipsis"><strong>{h.url}</strong></div>
                <div className="muted">{h.events.length ? h.events.join(', ') : 'Tous les événements'}{h.last_at ? `, dernier appel ${ago(h.last_at)} (HTTP ${h.last_status || 'erreur'})` : ''}</div>
                <div className="muted">Secret : <code>{h.secret}</code></div>
              </div>
              <div className="row">
                <button className="btn sm" onClick={() => run(async () => { const r = await api(`/api/webhooks/${h.id}/test`, { method: 'POST' }); hooks.reload(); return r; }, (r) => `Réponse HTTP ${r.status || 'aucune'}`)}>Tester</button>
                <button className="btn sm ghost icon" aria-label="Supprimer le webhook" onClick={() => run(async () => { await api(`/api/webhooks/${h.id}`, { method: 'DELETE' }); hooks.reload(); })}><LuTrash2 /></button>
              </div>
            </div>
          ))}
          <Field label="Nouvelle URL"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hook.eu1.make.com/…" /></Field>
          <div className="row wrap">
            {(hooks.data?.events || []).map((e) => (
              <label key={e} className="check small"><input type="checkbox" checked={events.includes(e)} onChange={() => setEvents(events.includes(e) ? events.filter((x) => x !== e) : [...events, e])} />{e}</label>
            ))}
          </div>
          <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy || !url} onClick={() => run(async () => { await api('/api/webhooks', { method: 'POST', body: { url, events } }); setUrl(''); hooks.reload(); }, 'Webhook ajouté')}><LuPlus />Ajouter le webhook</button>
        </div>
      </div>
    </div>
  );
}

function Team() {
  const { data, reload } = useApi('/api/workspace/members');
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'member' });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="stack" style={{ '--gap': '16px' }}>
      <div className="panel">
        <div className="panel-head"><h3>Membres de l'espace</h3></div>
        {(data || []).map((m) => (
          <div key={m.id} className="list-item">
            <div className="grow"><div style={{ fontWeight: 600 }}>{m.name || m.email}</div><div className="small muted">{m.email}</div></div>
            <span className="badge">{{ owner: 'Propriétaire', admin: 'Administrateur', member: 'Membre', client: 'Client (lecture)' }[m.role] || m.role}</span>
            {m.role !== 'owner' && <button className="btn sm ghost" onClick={() => run(async () => { await api(`/api/workspace/members/${m.id}`, { method: 'DELETE' }); reload(); }, 'Accès retiré')}>Retirer</button>}
          </div>
        ))}
      </div>
      <div className="panel panel-pad stack" style={{ '--gap': '12px' }}>
        <div className="section-title">Donner accès</div>
        <p className="soft small">Pour un client d'agence, choisissez « Client » : il voit ses résultats sans pouvoir modifier les campagnes ni les réglages.</p>
        <div className="grid-2">
          <Field label="Nom"><input className="input" value={f.name} onChange={set('name')} /></Field>
          <Field label="E-mail"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Mot de passe provisoire" hint="10 caractères minimum, à transmettre à la personne."><input className="input" value={f.password} onChange={set('password')} /></Field>
          <Field label="Rôle"><select className="select" value={f.role} onChange={set('role')}><option value="admin">Administrateur</option><option value="member">Membre</option><option value="client">Client</option></select></Field>
        </div>
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy || !f.email || f.password.length < 10} onClick={() => run(async () => { await api('/api/workspace/members', { method: 'POST', body: f }); setF({ name: '', email: '', password: '', role: 'member' }); reload(); }, 'Accès créé')}><LuPlus />Ajouter</button>
      </div>
    </div>
  );
}

function MyAccount() {
  const [f, setF] = useState({ current: '', next: '' });
  const [run, busy] = useAction();
  return (
    <div className="panel panel-pad stack" style={{ '--gap': '12px', maxWidth: 480 }}>
      <div className="section-title">Changer de mot de passe</div>
      <Field label="Mot de passe actuel"><input className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
      <Field label="Nouveau mot de passe" hint="10 caractères minimum. Vos autres sessions seront déconnectées."><input className="input" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy || f.next.length < 10} onClick={() => run(async () => { await api('/api/me/password', { method: 'POST', body: f }); setF({ current: '', next: '' }); }, 'Mot de passe modifié')}>Modifier</button>
    </div>
  );
}
