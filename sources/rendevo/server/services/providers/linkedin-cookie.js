import { profileDisplay } from './profile-display.js';
// Experimental LinkedIn browser-session connector (read-only verification).
// A session cookie is a bearer credential: never log it, send it to other hosts,
// or expose it through the Rendevo API.
const LINKEDIN_ME = 'https://www.linkedin.com/voyager/api/me';
// Reduced Chrome desktop User-Agent on macOS, documented by MDN/Chromium.
// This is only an HTTP header: it does not turn Node.js fetch into Chrome.
export const LINKEDIN_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

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
        redirect: 'error',
        signal: ctrl.signal,
        headers: {
          'Cookie': `li_at=${liAt}; JSESSIONID="${jsession}"`,
          'csrf-token': jsession,
          'x-restli-protocol-version': '2.0.0',
          'accept': 'application/vnd.linkedin.normalized+json+2.1',
          'user-agent': LINKEDIN_USER_AGENT,
        },
      });
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
      if (ctrl.signal.aborted) return {
        ok: false, error_code: 'timeout',
        detail: 'Le contrôle LinkedIn a dépassé 12 secondes. Aucun identifiant supprimé.',
      };
      return {
        ok: false, error_code: 'network_error',
        detail: 'Vérification LinkedIn impossible (réseau ou connexion interrompue).',
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
