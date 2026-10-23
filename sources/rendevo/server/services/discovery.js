// Explicit, human-reviewed discovery from Brave's independent web index.
// No LinkedIn cookies, sessions, API calls, login, page crawling or scraping.
const BRAVE_SEARCH = 'https://api.search.brave.com/res/v1/web/search';

export function normalizePublicProfileUrl(input) {
  if (typeof input !== 'string' || input.length > 1024) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !(['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase())
      || /^[a-z]{2}(?:-[a-z]{2})?\.linkedin\.com$/i.test(url.hostname))
      || url.username || url.password || url.port) return null;
    const match = /^\/in\/([a-z0-9][a-z0-9_.%-]{0,199})\/?$/i.exec(url.pathname);
    return match ? 'https://www.linkedin.com/in/' + match[1] + '/' : null;
  } catch { return null; }
}

export function normalizeDiscoveryCriteria(input = {}, defaults = {}) {
  const clean = (value, max = 90) => String(value ?? '').trim()
    .replace(/[\r\n\t"\\<>|]/g, ' ').replace(/\s+/g, ' ').slice(0, max);
  const first = (key) => Array.isArray(defaults[key]) ? defaults[key][0] : '';
  const title = clean(input.title === undefined ? first('titles') : input.title);
  const industry = clean(input.industry === undefined ? first('industries') : input.industry);
  const location = clean(input.location === undefined ? first('locations') : input.location);
  const keywords = clean(input.keywords === undefined ? first('keywords') : input.keywords);
  const limit = Math.max(1, Math.min(20, Math.trunc(Number(input.limit) || 10)));
  if (![title, industry, location, keywords].some(Boolean)) {
    throw new Error('Indiquez un poste, un secteur, une localisation ou des mots-clés');
  }
  const searchQuery = ['site:linkedin.com/in/', ...[title, industry, location, keywords]
    .filter(Boolean).map((term) => '"' + term + '"')].join(' ');
  return { title, industry, location, keywords, limit, searchQuery: searchQuery.slice(0, 580) };
}

// Search only public, independently indexed LinkedIn *profile* URLs.
// The first dork is specific to the chosen ICP; if it yields no valid profile,
// broaden in two bounded stages to compensate for limited search-engine support
// for long quoted queries and /in/ path filters.
export function buildLinkedInDorks(criteria) {
  const site = 'site:linkedin.com/in/';
  const terms = [criteria.title, criteria.industry, criteria.location, criteria.keywords].filter(Boolean);
  if (!terms.length) return [criteria.searchQuery].filter(Boolean);
  const phrase = (term) => '"' + term + '"';
  const focus = [criteria.title, criteria.location].filter(Boolean);
  const queries = [
    site + ' ' + terms.map(phrase).join(' '),
    site + ' ' + (focus.length ? focus : terms.slice(0, 2)).map(phrase).join(' '),
    'site:linkedin.com/in ' + phrase(criteria.title || criteria.keywords || criteria.industry || criteria.location),
  ];
  return [...new Set(queries.map((x) => x.trim()))].slice(0, 3);
}

export function normalizeSearchResults(data, limit = 10) {
  const used = new Set();
  const out = [];
  for (const result of (Array.isArray(data?.web?.results) ? data.web.results : [])) {
    const url = normalizePublicProfileUrl(result?.url);
    if (!url || used.has(url)) continue;
    used.add(url);
    const title = String(result.title || '').replace(/<[^>]*>/g, '').replace(/\s*[|–—-]\s*LinkedIn.*$/i, '').trim().slice(0, 160);
    const description = String(result.description || '').replace(/<[^>]*>/g, '').trim().slice(0, 280);
    out.push({ linkedin_url: url, title, description, source: 'Brave Search (index public)' });
    if (out.length >= limit) break;
  }
  return out;
}

// Degoog's native JSON API uses GET /api/search?q=... and returns { results:
// [{ url, title, snippet }] }. The optional search API key is a Bearer token.
// URLs are restricted to an HTTP(S) origin or its exact /api/search endpoint.
export function normalizeDegoogUrl(input) {
  if (typeof input !== 'string' || input.length > 400) throw new Error('URL DeGoog invalide');
  let parsed;
  try { parsed = new URL(input.trim()); } catch { throw new Error('URL DeGoog invalide'); }
  const host = parsed.hostname.toLowerCase();
  const octets = host.split('.');
  const ipv4 = octets.length === 4 && octets.every((n) => /^\d{1,3}$/.test(n) && Number(n) <= 255);
  const privateIp = ipv4 && (Number(octets[0]) === 10 || Number(octets[0]) === 127
    || (Number(octets[0]) === 192 && Number(octets[1]) === 168)
    || (Number(octets[0]) === 172 && Number(octets[1]) >= 16 && Number(octets[1]) <= 31));
  const privateHttp = host === 'localhost' || host === '[::1]' || privateIp;
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && privateHttp))
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || !['/', '/api/search'].includes(parsed.pathname)
    || !host || host.includes('*') || (ipv4 && !privateIp && parsed.protocol === 'http:')) {
    throw new Error('URL DeGoog refusée : HTTPS ou HTTP sur IP privée/localhost uniquement');
  }
  return parsed.origin;
}

export function normalizeDegoogResults(data, limit = 10) {
  const seen = new Set(), items = [];
  for (const item of Array.isArray(data?.results) ? data.results.slice(0, 250) : []) {
    const url = normalizePublicProfileUrl(item?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({
      linkedin_url: url,
      title: String(item.title || '').replace(/<[^>]*>/g, '').replace(/\s*[|–—-]\s*LinkedIn.*$/i, '').trim().slice(0, 160),
      description: String(item.snippet || item.content || '').replace(/<[^>]*>/g, '').trim().slice(0, 280),
      source: 'DeGoog (index web)',
    });
    if (items.length >= limit) break;
  }
  return items;
}

export async function discoverDegoogProfiles({ baseUrl, apiKey = '', criteria, fetcher = fetch, onAttempt }) {
  const base = normalizeDegoogUrl(baseUrl);
  const queries = buildLinkedInDorks(criteria);
  const controller = new AbortController();
  // One total timeout shared across all attempts, not one 12s timeout per dork.
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    for (const query of queries) {
      const url = new URL('/api/search', base);
      url.searchParams.set('q', query);
      url.searchParams.set('type', 'web');
      url.searchParams.set('lang', 'fr');
      const response = await fetcher(url, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}),
        },
      });
      if ([401, 403].includes(response.status)) throw new Error('Clé API DeGoog invalide ou accès non autorisé');
      if (response.status === 429) throw new Error('Limite de requêtes DeGoog atteinte');
      if (!response.ok) throw new Error('Le moteur DeGoog a renvoyé HTTP ' + response.status);
      const data = await response.json();
      if (!Array.isArray(data?.results)) throw new Error('Format de réponse DeGoog invalide');
      const items = normalizeDegoogResults(data, criteria.limit);
      if (onAttempt) onAttempt({ query, results: data.results.length, profiles: items.length });
      if (items.length) return items;
    }
    return [];
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('La recherche a dépassé 12 secondes');
    if (/^(Clé API DeGoog|Limite de requêtes DeGoog|Le moteur DeGoog|Format de réponse DeGoog|La recherche a dépassé)/.test(err?.message || '')) throw err;
    throw new Error('Le service DeGoog est temporairement inaccessible');
  } finally { clearTimeout(timeout); }
}

export async function discoverPublicProfiles({ apiKey, criteria, fetcher = fetch }) {
  if (!apiKey || !/^\S{8,512}$/.test(apiKey)) throw new Error('Clé de recherche Brave manquante');
  const url = new URL(BRAVE_SEARCH);
  url.searchParams.set('q', criteria.searchQuery);
  url.searchParams.set('count', String(criteria.limit));
  url.searchParams.set('search_lang', 'fr');
  url.searchParams.set('safesearch', 'moderate');
  url.searchParams.set('text_decorations', 'false');
  url.searchParams.set('result_filter', 'web');
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12000);
  try {
    const response = await fetcher(url, {
      method: 'GET',
      redirect: 'error',
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
    });
    if (response.status === 429) throw new Error('Limite de requêtes Brave atteinte. Réessayez plus tard.');
    if (response.status === 401 || response.status === 403) throw new Error('Clé API Brave invalide ou non autorisée.');
    if (!response.ok) throw new Error('Le moteur de recherche a renvoyé HTTP ' + response.status);
    const data = await response.json();
    return normalizeSearchResults(data, criteria.limit);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('La recherche a dépassé 12 secondes');
    // Do not include the remote body, API key, headers or raw fetch exceptions.
    if (/^Limite de requêtes Brave|^Clé API Brave|^Le moteur de recherche|^La recherche a dépassé/.test(err.message)) throw err;
    throw new Error('Le service de recherche est temporairement inaccessible');
  } finally {
    clearTimeout(timeout);
  }
}
