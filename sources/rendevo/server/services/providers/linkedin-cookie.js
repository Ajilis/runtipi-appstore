import { profileDisplay } from './profile-display.js';
// Experimental LinkedIn browser-session connector (read-only verification).
// A session cookie is a bearer credential: never log it, send it to other hosts,
// or expose it through the Rendevo API.
const LINKEDIN_ME = 'https://www.linkedin.com/voyager/api/me';
// Reduced Chrome desktop User-Agent on macOS, documented by MDN/Chromium.
// This is only an HTTP header: it does not turn Node.js fetch into Chrome.
export const LINKEDIN_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

// Convert only known, non-sensitive transport error codes to fixed labels.
// Neither the exception message nor the redirect target is persisted or sent to clients.
export function classifyLinkedinTransportError(error, aborted = false) {
  if (aborted) return {
    error_code: 'timeout',
    detail: 'Le contrôle LinkedIn a dépassé 12 secondes. Aucun identifiant supprimé.',
  };
  const code = error?.cause?.code || error?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return {
    error_code: 'dns_error',
    detail: 'Impossible de résoudre le nom de domaine LinkedIn depuis le serveur (DNS).',
  };
  if (['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID', 'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'EPROTO'].includes(code)
    || (typeof code === 'string' && (code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_')))) return {
    error_code: 'tls_error',
    detail: 'La connexion HTTPS à LinkedIn a échoué lors de la vérification TLS/certificat.',
  };
  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT'].includes(code)) return {
    error_code: 'timeout',
    detail: 'La connexion à LinkedIn a dépassé le délai de réponse.',
  };
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
    'UND_ERR_SOCKET'].includes(code)) return {
    error_code: 'connection_error',
    detail: 'La connexion réseau à LinkedIn a été refusée, coupée ou est inaccessible.',
  };
  return {
    error_code: 'network_error',
    detail: 'Impossible de terminer la vérification LinkedIn (cause réseau non déterminée).',
  };
}

export function normalizeLinkedinCookies(liAtInput, jsessionInput) {
  const liAt = String(liAtInput || '').trim();
  const jsession = String(jsessionInput || '').trim().replace(/^"|"$/g, '');
  if (!/^[A-Za-z0-9_+./:=-]{16,4096}$/.test(liAt)) {
    throw new Error('Le cookie li_at est manquant ou mal formé');
  }
  if (!/^ajax:[A-Za-z0-9_-]{4,256}$/.test(jsession)) {
    throw new Error('Le cookie JSESSIONID est manquant ou mal formé (format ajax:...)');
  }
  return { liAt, jsession };
}

export default {
  id: 'linkedin_cookie',
  label: 'Mon LinkedIn (cookie, expérimental)',
  auto: false,
  capabilities: { search: false, invite: false, message: false },

  async test(account, { fetcher = fetch } = {}) {
    let liAt, jsession;
    try {
      ({ liAt, jsession } = normalizeLinkedinCookies(account.config?.li_at, account.config?.jsessionid));
    } catch {
      return {
        ok: false, error_code: 'credentials_unavailable',
        detail: 'Identifiants LinkedIn indisponibles ou illisibles sur le serveur. Vérifiez la configuration et la clé de chiffrement.',
      };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetcher(LINKEDIN_ME, {
        method: 'GET',
        redirect: 'manual', // Observe 3xx safely; never follow a redirect with session cookies.
        signal: ctrl.signal,
        headers: {
          'Cookie': `li_at=${liAt}; JSESSIONID="${jsession}"`,
          'csrf-token': jsession,
          'x-restli-protocol-version': '2.0.0',
          'accept': 'application/vnd.linkedin.normalized+json+2.1',
          'user-agent': LINKEDIN_USER_AGENT,
        },
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        return {
          ok: false, error_code: 'redirect_detected', http_status: res.status,
          detail: 'LinkedIn a demandé une redirection (HTTP ' + res.status
            + '). Elle n\'a pas été suivie : vérifiez votre session depuis votre navigateur.',
        };
      }
      if ([401, 403, 999].includes(res.status)) {
        return {
          ok: false, error_code: 'http_rejected', http_status: res.status,
          detail: 'LinkedIn a refusé la vérification (HTTP ' + res.status + '). Dernier état validé conservé ; réessayez plus tard.',
        };
      }
      if (res.status === 429) {
        return {
          ok: false, error_code: 'rate_limited', http_status: 429,
          detail: 'LinkedIn limite les requêtes (HTTP 429). Évitez les tests répétés.',
        };
      }
      if (!res.ok) return {
        ok: false, error_code: 'http_error', http_status: res.status,
        detail: 'LinkedIn indisponible pour ce contrôle (HTTP ' + res.status + ').',
      };
      const type = res.headers.get('content-type') || '';
      if (!type.toLowerCase().includes('json')) {
        return {
          ok: false, error_code: 'unexpected_response', http_status: res.status,
          detail: 'LinkedIn a renvoyé une réponse non JSON : contrôle non concluant.',
        };
      }
      const data = await res.json().catch(() => null);
      if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.keys(data).length) {
        return {
          ok: false, error_code: 'unexpected_response', http_status: res.status,
          detail: 'LinkedIn a renvoyé une réponse JSON inexploitable : contrôle non concluant.',
        };
      }
      return {
        ok: true, http_status: res.status,
        detail: 'Session LinkedIn reconnue (lecture seule ; messages et recherche manuels).',
        profile: profileDisplay(data),
      };
    } catch (error) {
      return { ok: false, ...classifyLinkedinTransportError(error, ctrl.signal.aborted) };
    } finally {
      clearTimeout(timer);
    }
  },
};
