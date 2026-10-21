import { profileDisplay } from './profile-display.js';
// Experimental LinkedIn browser-session connector (read-only verification).
// A session cookie is a bearer credential: never log it, send it to other hosts,
// or expose it through the Rendevo API.
const LINKEDIN_ME = 'https://www.linkedin.com/voyager/api/me';

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
    const { liAt, jsession } = normalizeLinkedinCookies(account.config?.li_at, account.config?.jsessionid);
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
          'user-agent': 'Mozilla/5.0',
        },
      });
      if (res.status === 401 || res.status === 403 || res.status === 999) {
        return { ok: false, invalid_session: res.status === 401, detail: 'Session refusée ou vérification supplémentaire demandée par LinkedIn. Vérifiez la session dans votre navigateur avant de renouveler les cookies.' };
      }
      if (!res.ok) return { ok: false, detail: `LinkedIn n'a pas pu être vérifié (HTTP ${res.status}).` };
      const type = res.headers.get('content-type') || '';
      if (!type.toLowerCase().includes('json')) {
        return { ok: false, detail: 'Réponse LinkedIn inattendue : impossible de confirmer la session.' };
      }
      const data = await res.json().catch(() => null);
      if (!data || typeof data !== 'object' || !Object.keys(data).length) {
        return { ok: false, detail: 'Réponse LinkedIn vide : impossible de confirmer la session.' };
      }
      return { ok: true, detail: 'Session LinkedIn reconnue. Connexion expérimentale en lecture seule : envois et recherche restent manuels.', profile: profileDisplay(data) };
    } catch {
      return { ok: false, detail: 'Vérification LinkedIn impossible (réseau, cookies expirés ou accès bloqué).' };
    } finally {
      clearTimeout(timer);
    }
  },
};
