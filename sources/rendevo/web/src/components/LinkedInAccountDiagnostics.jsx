import React from 'react';

// Only public, bounded server-generated diagnostics. No credentials or
// upstream response bodies reach this component.
const ERROR_LABELS = {
  http_rejected: 'Accès refusé par LinkedIn',
  http_error: 'Erreur HTTP LinkedIn',
  rate_limited: 'Limitation des requêtes',
  unexpected_response: 'Réponse LinkedIn inattendue',
  timeout: 'Délai de réponse dépassé (12 s)',
  network_error: 'Erreur réseau',
  credentials_unavailable: 'Cookies manquants ou impossibles à déchiffrer',
  unexpected_error: 'Échec de vérification',
};

function dateLabel(value) {
  if (!value) return 'Jamais';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Inconnue' : date.toLocaleString('fr-FR');
}

export function LinkedInAccountDiagnostics({ verification, hasSession, cooldownSeconds }) {
  const d = verification || {};
  const outcome = d.last_outcome === 'success'
    ? 'Réussite'
    : d.last_outcome === 'failure' ? 'Échec (état du compte conservé)' : 'Aucun test enregistré';
  const failureLabel = ERROR_LABELS[d.last_error_code] || 'Non déterminée';
  return (
    <div className="small soft" style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
      <strong>Diagnostic de session (lecture seule)</strong>
      <div>Cookies chiffrés enregistrés : <strong>{hasSession ? 'Oui' : 'Non'}</strong> — présence uniquement, pas une validation LinkedIn</div>
      <div>Dernier test réussi : <strong>{dateLabel(d.last_success_at)}</strong></div>
      <div>Dernier test échoué : <strong>{dateLabel(d.last_failure_at)}</strong></div>
      <div>Dernier résultat : <strong>{outcome}</strong></div>
      {d.last_outcome === 'failure' && <div>Motif : {failureLabel}{Number.isInteger(d.last_http_status) ? ' (HTTP ' + d.last_http_status + ')' : ''}</div>}
      {cooldownSeconds > 0 && <div>Prochaine vérification possible dans {cooldownSeconds} s.</div>}
      <div>Le statut reflète la dernière vérification positive, et non une session LinkedIn permanente.</div>
    </div>
  );
}
