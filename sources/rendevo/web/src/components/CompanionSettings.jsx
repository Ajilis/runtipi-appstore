import React, { useState } from 'react';
import { api, useApi, useAction, useToast, copy } from '../lib.jsx';
import { useSession } from '../session.js';

export function CompanionSettings() {
  const { session } = useSession();
  const { data, reload } = useApi('/api/companion/devices');
  const [pairing, setPairing] = useState(null);
  const [run, busy] = useAction();
  const toast = useToast();
  const base = session.public_url || window.location.origin;
  const makeCode = () => run(async () => {
    const result = await api('/api/companion/pairings', { method: 'POST', body: {} });
    setPairing({ ...result, createdAt: Date.now() });
  }, 'Code d’association créé (5 minutes)');
  const revoke = (id) => {
    if (!window.confirm("Révoquer cette extension ? Elle perdra immédiatement l'accès à Rendevo.")) return;
    run(async () => {
      await api('/api/companion/devices/' + encodeURIComponent(id), { method: 'DELETE' });
      reload();
    }, 'Extension révoquée');
  };

  return (
    <div className="panel">
      <div className="panel-head"><h3>Rendevo Companion — connexion directe</h3></div>
      <div className="panel-pad stack" style={{ '--gap': '12px' }}>
        <p className="small soft">L'extension Chrome dialogue directement avec Rendevo : elle affiche tes campagnes Companion et peut y importer l'URL du profil LinkedIn que tu sélectionnes. Aucun cookie LinkedIn n'est transféré, aucun message n'est envoyé automatiquement.</p>
        <div className="row wrap">
          <input className="input grow" readOnly value={base} aria-label="URL de Rendevo" />
          <button className="btn" onClick={() => copy(base, toast)}>Copier l'URL</button>
        </div>
        <div className="row wrap">
          <button className="btn primary" disabled={busy} onClick={makeCode}>Générer un code d'association</button>
          <a className="btn" href="/api/companion/download" download="Rendevo-Companion-V18.zip">Télécharger l’extension Chrome (.zip)</a>
        </div>
        <p className="small soft">Téléchargement direct depuis ton serveur Rendevo, sans GitHub. Décompresse le ZIP, puis ouvre <code>chrome://extensions</code> → Mode développeur → Charger l’extension non empaquetée et sélectionne le dossier contenant <code>manifest.json</code>.</p>
        {pairing && (
          <div className="alert info stack" style={{ '--gap': '8px' }}>
            <strong>Code à usage unique — valable 5 minutes</strong>
            <div className="row wrap">
              <input className="input grow" value={pairing.code} readOnly aria-label="Code d'association" autoComplete="off" />
              <button className="btn" onClick={() => copy(pairing.code, toast)}>Copier le code</button>
            </div>
            <p className="small">Dans l'extension Chrome : enregistre cette URL Rendevo, colle le code, puis clique sur « Associer directement ». Le code ne sera plus affiché après fermeture de cet encart et expirera au bout de 5 minutes.</p>
          </div>
        )}
        <div className="section-title">Extensions associées</div>
        {!data?.items?.length && <p className="small muted">Aucune extension associée pour cet utilisateur.</p>}
        {(data?.items || []).map((device) => (
          <div key={device.id} className="row spread wrap small" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
            <span><strong>{device.name}</strong><span className="muted"> · créée le {new Date(device.created_at).toLocaleDateString('fr-FR')}, dernière utilisation : {device.last_used_at ? new Date(device.last_used_at).toLocaleString('fr-FR') : 'jamais'}</span></span>
            <button className="btn sm danger" disabled={busy} onClick={() => revoke(device.id)}>Révoquer</button>
          </div>
        ))}
        <p className="small soft">L'accès de chaque extension expire après 90 jours ; tu peux aussi le révoquer immédiatement ici. Le jeton Companion n'autorise que la lecture des campagnes associées à Companion et l'ajout manuel d'une URL de profil, jamais la lecture des cookies ou les envois LinkedIn.</p>
      </div>
    </div>
  );
}
