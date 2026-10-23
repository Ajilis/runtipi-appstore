import React, { useEffect, useState } from 'react';
import { api, useApi, useAction, Field, Loading, ErrorBox } from '../lib.jsx';

// Search engine credentials belong in workspace settings, never in the prospect
// discovery dialog and never exposed back to browsers after saving.
export function SearchSettings() {
  const config = useApi('/api/discovery/config');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [run, busy] = useAction();
  useEffect(() => {
    if (config.data) setBaseUrl(config.data.provider === 'degoog' ? config.data.base_url || '' : '');
  }, [config.data]);

  const save = () => run(async () => {
    await api('/api/discovery/config', {
      method: 'POST',
      body: {
        provider: 'degoog',
        base_url: baseUrl.trim(),
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        ...(clearKey ? { clear_key: true } : {}),
      },
    });
    setApiKey('');
    setClearKey(false);
    config.reload();
  }, 'Moteur DeGoog enregistré');

  if (config.loading && !config.data) return <Loading />;
  if (config.error) return <ErrorBox error={config.error} />;
  const legacy = config.data?.provider === 'brave';
  return (
    <div className="panel">
      <div className="panel-head"><h3>Recherche — moteur web</h3></div>
      <div className="panel-pad stack" style={{ '--gap': '14px' }}>
        <p className="small soft">
          Configure ici le moteur utilisé par « Trouver des prospects » → « Recherche web publique ».
          Rendevo interroge ton instance DeGoog via <code>GET /api/search</code> et propose les profils LinkedIn indexés, à valider avant import.
        </p>
        {legacy && <div className="alert info">
          Brave Search est actuellement configuré et reste utilisable. Enregistrer une URL DeGoog fera passer les prochaines recherches sur DeGoog.
        </div>}
        <Field label="URL du moteur DeGoog">
          <input className="input" type="url" value={baseUrl} maxLength={400}
            onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false}
            placeholder="https://recherche.exemple.fr" autoComplete="url" />
        </Field>
        <p className="small muted">
          Indique l’adresse de base de ton instance DeGoog (ou son URL /api/search).
          HTTPS requis pour un serveur public ; HTTP accepté pour localhost et les IP privées.
        </p>
        <Field label={config.data?.has_api_key && !legacy ? 'Remplacer la clé API (facultatif)' : 'Clé API DeGoog (facultative)'}>
          <input className="input" type="password" value={apiKey} spellCheck={false}
            maxLength={512} autoComplete="new-password"
            onChange={(e) => { setApiKey(e.target.value); if (e.target.value) setClearKey(false); }}
            placeholder={config.data?.has_api_key && !legacy ? 'Clé enregistrée — laisser vide pour conserver' : 'Laisser vide si DeGoog ne demande pas de clé'} />
        </Field>
        {!legacy && config.data?.has_api_key && (
          <label className="row small" style={{ alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={clearKey} onChange={(e) => { setClearKey(e.target.checked); if (e.target.checked) setApiKey(''); }} />
            Supprimer la clé API enregistrée
          </label>
        )}
        <p className="small soft">
          La clé est chiffrée côté serveur et n’est jamais affichée après enregistrement.
          Si ton instance DeGoog protège l’API, utilise sa clé d’accès serveur dans l’en-tête Bearer.
          <a href="https://github.com/degoog-org/degoog" target="_blank" rel="noopener noreferrer"> Documentation DeGoog</a>
        </p>
        <div className="row spread wrap">
          <span className="small muted">État : {config.data?.provider === 'degoog' && config.data?.configured
            ? 'DeGoog configuré' : legacy ? 'Brave actif (hérité)' : 'Moteur non configuré'}</span>
          <button className="btn primary" disabled={busy || !baseUrl.trim() || (clearKey && !!apiKey.trim())} onClick={save}>
            {busy ? 'Enregistrement…' : 'Enregistrer le moteur'}
          </button>
        </div>
      </div>
    </div>
  );
}
