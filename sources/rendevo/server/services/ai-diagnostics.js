// Translate provider failures to stable diagnostics. Never pass raw upstream
// error bodies, headers, URLs or credentials to the browser. Network codes are
// obtained from Node/undici's error metadata, not from the remote text.
export function classifyAiGenerationFailure(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const http = /(?:LLM|Anthropic) HTTP (\d{3})/.exec(message);
  const status = http ? Number(http[1]) : null;
  if (status) {
    if ([401, 403].includes(status)) return {
      code: 'AI_AUTH', retryable: false,
      message: 'Le fournisseur IA refuse la clé API (HTTP ' + status + '). Vérifiez les identifiants dans Réglages → Intelligence artificielle.',
    };
    if (status === 404) return {
      code: 'AI_MODEL', retryable: false,
      message: 'Le modèle ou la route /chat/completions est introuvable (HTTP 404). Vérifiez le modèle sélectionné.',
    };
    if (status === 429) return {
      code: 'AI_RATE_LIMIT', retryable: false,
      message: 'Le fournisseur IA limite les requêtes (HTTP 429). Réessayez après son délai de régulation.',
    };
    if ([400, 422].includes(status)) return {
      code: 'AI_PARAMETERS', retryable: false,
      message: 'Le fournisseur IA refuse les paramètres de génération (HTTP ' + status + '). Vérifiez la prise en charge de /chat/completions et du paramètre max_tokens.',
    };
    return {
      code: 'AI_HTTP_' + status, retryable: [408, 500, 502, 503, 504].includes(status),
      message: 'Le fournisseur IA a répondu HTTP ' + status
        + '. Vérifiez son état et ses journaux, puis réessayez.',
    };
  }

  if (message === 'AI_OUTPUT_TRUNCATED') return {
    code: 'AI_OUTPUT_TRUNCATED', retryable: true,
    message: 'Le modèle IA a épuisé sa limite de génération avant de terminer le tableau.',
  };
  if (message === 'AI_EMPTY_CONTENT' || /Réponse IA vide|format incompatible/.test(message)) return {
    code: 'AI_EMPTY_CONTENT', retryable: true,
    message: 'Le modèle IA n’a pas renvoyé de contenu textuel exploitable.',
  };
  if (message === 'AI_CONTENT_FILTER') return {
    code: 'AI_FILTER', retryable: false,
    message: 'Le modèle IA a refusé la génération du contenu demandé.',
  };

  const codes = [error?.code, error?.cause?.code, error?.cause?.cause?.code].filter(Boolean);
  if (codes.some((code) => ['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code))) {
    return {
      code: 'AI_DNS', retryable: false,
      message: 'Le serveur Rendevo ne parvient pas à résoudre ou à joindre le nom du serveur IA. Vérifiez le DNS et le réseau Docker.',
    };
  }
  if (codes.includes('ECONNREFUSED')) return {
    code: 'AI_CONNECTION_REFUSED', retryable: false,
    message: 'La connexion au serveur IA est refusée depuis Rendevo. Vérifiez son port et son accessibilité depuis le réseau Docker.',
  };
  if (codes.some((code) => /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code))) return {
    code: 'AI_TLS', retryable: false,
    message: 'Échec de vérification HTTPS/TLS du serveur IA. Vérifiez son certificat ou sa chaîne de confiance.',
  };
  if (error?.name === 'AbortError' || codes.some((code) =>
    ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT'].includes(code))
    || /timed?\s*out|timeout|aborted|dépassé/i.test(message)) return {
    code: 'AI_TIMEOUT', retryable: true,
    message: 'Le serveur IA a dépassé le délai de réponse. Un modèle plus rapide ou une réponse plus courte peut résoudre ce problème.',
  };
  if (codes.some((code) => ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(code))
    || /fetch failed|socket hang up|other side closed/i.test(message)) return {
    code: 'AI_CONNECTION_RESET', retryable: true,
    message: 'La connexion au serveur IA a été interrompue pendant la génération. Vérifiez ses journaux, sa mémoire et les délais du proxy.',
  };
  return {
    code: 'AI_UNKNOWN', retryable: false,
    message: 'Le fournisseur IA a échoué sans diagnostic réseau identifiable. Vérifiez ses journaux et l’accès au modèle depuis le conteneur Rendevo.',
  };
}
