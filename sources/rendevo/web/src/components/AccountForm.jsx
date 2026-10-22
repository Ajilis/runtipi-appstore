import React, { useState } from 'react';
import { Field } from '../lib.jsx';

const PROVIDERS = [
  {
    id: 'simulation',
    title: 'Bac à sable',
    text: "Un faux LinkedIn qui accepte, répond et réserve. Pour tester vos messages et le setter sans rien envoyer.",
  },
  {
    id: 'unipile',
    title: 'LinkedIn via Unipile',
    text: "Automatisation réelle à rythme humain. Connectez votre LinkedIn dans Unipile, puis collez ici vos accès API.",
  },
  {
    id: 'linkedin_cookie',
    title: 'Mon LinkedIn (cookie)',
    text: "Connexion expérimentale avec les cookies de votre session. Vérification uniquement : les messages et invitations restent manuels.",
  },
  {
    id: 'manual',
    title: 'Manuel',
    text: "Rendevo prépare chaque message, vous l'envoyez depuis LinkedIn et collez la réponse. Aucune automatisation.",
  },
];

export function AccountForm({ value, onChange, existing }) {
  const v = value;
  const set = (k) => (e) => onChange({ ...v, [k]: e.target.value });
  const setCfg = (k) => (e) => onChange({ ...v, config: { ...v.config, [k]: e.target.value } });
  return (
    <div className="stack" style={{ '--gap': '16px' }}>
      {!existing && (
        <div className="grid-3" role="radiogroup" aria-label="Type de compte">
          {PROVIDERS.map((p) => (
            <button type="button" key={p.id} role="radio" aria-checked={v.provider === p.id}
              className="panel panel-pad" onClick={() => onChange({ ...v, provider: p.id })}
              style={{ textAlign: 'left', cursor: 'pointer', borderColor: v.provider === p.id ? 'var(--encre)' : undefined, boxShadow: v.provider === p.id ? '0 0 0 3px var(--encre-weak)' : undefined }}>
              <div style={{ fontWeight: 650, marginBottom: 4 }}>{p.title}</div>
              <div className="small soft">{p.text}</div>
            </button>
          ))}
        </div>
      )}
      <div className="grid-2">
        <Field label="Nom du compte"><input className="input" value={v.name || ''} onChange={set('name')} placeholder="Ex. LinkedIn d'Alex" /></Field>
        <Field label="Abonnement LinkedIn" hint="Fixe les budgets quotidiens d'invitations et de messages.">
          <select className="select" value={v.account_type || 'free'} onChange={set('account_type')}>
            <option value="free">Gratuit</option>
            <option value="premium">Premium</option>
            <option value="sales_navigator">Sales Navigator</option>
          </select>
        </Field>
      </div>
      {v.provider === 'linkedin_cookie' && (
        <>
          <div className="alert warn small">
            Expérimental : cette méthode utilise l'API interne non officielle de LinkedIn. LinkedIn interdit l'utilisation de cookies copiés et l'automatisation non autorisée, et peut restreindre votre compte. Aucun message, invitation ou scraping automatique ne sera réalisé via ce connecteur.
          </div>
          <div className="alert info small">
            Récupérez uniquement vos propres cookies de session depuis votre navigateur connecté à LinkedIn : <code>li_at</code> et <code>JSESSIONID</code>. Ne les transmettez jamais par e-mail ou messagerie. Ils sont équivalents à un mot de passe, chiffrés côté serveur et jamais affichés après enregistrement.
          </div>
          <Field label="Cookie d'identification li_at" hint={existing && v.config?.has_session ? "Deux cookies enregistrés. Laissez les deux champs vides pour les conserver." : "Valeur du cookie li_at de votre propre session LinkedIn."}>
            <input className="input" type="password" autoComplete="off" spellCheck={false} value={v.config?.li_at || ''} onChange={setCfg('li_at')} placeholder="Coller le cookie li_at" />
          </Field>
          <Field label="Cookie de session JSESSIONID" hint="Nécessaire au jeton CSRF ; collez la valeur complète, avec ou sans guillemets.">
            <input className="input" type="password" autoComplete="off" spellCheck={false} value={v.config?.jsessionid || ''} onChange={setCfg('jsessionid')} placeholder="ajax:..." />
          </Field>
          <div className="grid-2">
            <Field label="Nom du cookie supplémentaire" hint="Facultatif. Nom prérempli, modifiable.">
              <input className="input" value={v.config?.extra_cookie_name ?? 'TEST'}
                onChange={setCfg('extra_cookie_name')} placeholder="TEST" maxLength={64} spellCheck={false} />
            </Field>
            <Field label="Valeur du cookie supplémentaire" hint={existing && v.config?.has_extra_cookie ? 'Une valeur chiffrée est enregistrée ; laissez vide pour la conserver.' : 'Facultative : laisser vide pour ne rien enregistrer.'}>
              <input className="input" type="password" autoComplete="off" spellCheck={false}
                value={v.config?.extra_cookie_value || ''} onChange={setCfg('extra_cookie_value')}
                placeholder="" />
            </Field>
          </div>
          {existing && v.config?.has_extra_cookie && (
            <label className="check small">
              <input type="checkbox" checked={!!v.config?.clear_extra_cookie}
                onChange={(e) => onChange({ ...v, config: { ...v.config, clear_extra_cookie: e.target.checked } })} />
              Supprimer la valeur du cookie supplémentaire enregistré
            </label>
          )}
          <p className="small soft">Le cookie supplémentaire, s'il est renseigné, est stocké chiffré. Il n'est pas envoyé à LinkedIn par le bouton « Tester ».</p>
                    <p className="small soft">Après l'ajout, utilisez « Tester » pour vérifier la session. Rendevo fonctionnera en mode d'envoi manuel avec ce connecteur.</p>
        </>
      )}
      {v.provider === 'unipile' && (
        <>
          <div className="alert info small">
            Dans votre tableau de bord Unipile : connectez votre compte LinkedIn, puis copiez le DSN (ex. api8.unipile.com:13851), un jeton d'accès et l'identifiant du compte connecté. Rendevo ne stocke jamais votre mot de passe LinkedIn ; la clé est chiffrée en base.
          </div>
          <div className="grid-2">
            <Field label="DSN Unipile"><input className="input" value={v.config?.dsn || ''} onChange={setCfg('dsn')} placeholder="api8.unipile.com:13851" /></Field>
            <Field label="Identifiant du compte"><input className="input" value={v.config?.account_id || ''} onChange={setCfg('account_id')} /></Field>
          </div>
          <Field label="Jeton d'accès (X-API-KEY)" hint={existing && v.config?.has_api_key ? 'Une clé est enregistrée. Laissez vide pour la conserver.' : undefined}>
            <input className="input" type="password" autoComplete="off" value={v.config?.api_key || ''} onChange={setCfg('api_key')} />
          </Field>
          <div className="alert warn small">
            Les conditions de LinkedIn restreignent l'automatisation par des tiers. Rendevo applique des délais aléatoires et des budgets prudents, mais vous restez responsable de votre compte. La pause est disponible en un clic.
          </div>
        </>
      )}
    </div>
  );
}

export function emptyAccount(provider = 'simulation') {
  return { provider, name: provider === 'simulation' ? 'Bac à sable' : '', account_type: 'free', config: {} };
}

export function useAccountDraft(initial) {
  return useState(initial || emptyAccount());
}
