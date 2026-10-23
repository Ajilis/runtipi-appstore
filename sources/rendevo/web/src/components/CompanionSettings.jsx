import React, { useState } from 'react';
import { api, useApi, useAction, useToast, copy } from '../lib.jsx';
import { useSession } from '../session.js';

export function CompanionSettings() {
  const { session } = useSession();
  const { data, reload } = useApi('/api/companion/devices');
  const [pairing, setPairing] = useState(null);
  const [run, busy] = useAction();
  const toast = useToast();
  // A single code transports both the server origin and its short-lived pairing secret.
  // Prefer the configured HTTPS public address when Rendevo is opened over LAN.
  const base = session.public_url || window.location.origin;
  const makeCode = () => run(async () => {
    const result = await api('/api/companion/pairings', { method: 'POST', body: {} });
    const origin = new URL(base).origin;
    const portableCode = 'RDV1.' + encodeURIComponent(origin) + '.' + result.code;
    setPairing({ portableCode, origin, createdAt: Date.now(), expires_in_seconds: result.expires_in_seconds });
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
        <p className="small soft">L'extension Chrome dialogue directement avec Rendevo : elle affiche tes campagnes Companion et peut importer, après prévisualisation et validation, les profils de la page de recherche LinkedIn ouverte ou l'URL d'un profil sélectionné. Aucun cookie LinkedIn n'est transféré, aucun message n'est envoyé automatiquement.</p>
        <p className="small soft">Télécharge le Companion <strong>personnalisé pour {base}</strong> : Chrome connaît ainsi l’adresse du serveur dès l’installation. Le code unique sert ensuite uniquement à associer ton compte, sans nouvelle demande d’accès au site.</p>
        <div className="row wrap">
          <button className="btn primary" disabled={busy} onClick={makeCode}>Générer un code d'association</button>
          <a className="btn" href="/api/companion/download" download="Rendevo-Companion-V24.zip">Télécharger Companion pour mon serveur (.zip)</a>
        </div>
        <p className="small soft">Ce ZIP contient un <code>manifest.json</code> spécifique à ton serveur. Décompresse-le puis ouvre <code>chrome://extensions</code> → Mode développeur → Charger l’extension non empaquetée (ou remplace les fichiers du dossier Companion existant puis clique sur Actualiser). Vérifie les permissions du site dans les détails de l’extension. Chrome peut ne pas afficher de fenêtre distincte pour une extension non empaquetée ; l’autorisation reste contrôlable dans Chrome.</p>
        {pairing && (
          <div className="alert info stack" style={{ '--gap': '8px' }}>
            <strong>Code à usage unique — valable 5 minutes</strong>
            <div className="row wrap">
              <input className="input grow" value={pairing.portableCode} readOnly aria-label="Code unique d'association" autoComplete="off" />
              <button className="btn" onClick={() => copy(pairing.portableCode, toast)}>Copier le code unique</button>
            </div>
            <p className="small">Dans Companion V24 installé depuis ce serveur, colle ce seul code puis clique sur « Associer le Companion ». Aucun nouvel accès au site n’est demandé à ce moment : la permission pour <strong>{pairing.origin}</strong> est déjà déclarée à l’installation. Code valable 5 minutes, une seule utilisation.</p>
          </div>
        )}
        <div className="section-title">Extensions associées</div>
        {!data?.items?.length && <p className="small muted">Aucune extension associée pour cet utilisateur.</p>}
        {(data?.items || []).map((device) => (
          <div key={device.id} className="row spread wrap small" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
            <span><strong>{device.name}</strong><span className="muted"> · version {device.extension_version ? `v${device.extension_version}` : 'non communiquée'} · créée le {new Date(device.created_at).toLocaleDateString('fr-FR')}, dernière utilisation : {device.last_used_at ? new Date(device.last_used_at).toLocaleString('fr-FR') : 'jamais'}</span></span>
            <button className="btn sm danger" disabled={busy} onClick={() => revoke(device.id)}>Révoquer</button>
          </div>
        ))}
        <p className="small soft">L'accès de chaque extension expire après 90 jours ; tu peux aussi le révoquer immédiatement ici. Le jeton Companion n'autorise que la lecture des campagnes associées à Companion et l'ajout manuel d'une URL de profil, jamais la lecture des cookies ou les envois LinkedIn.</p>
      </div>
    </div>
  );
}
