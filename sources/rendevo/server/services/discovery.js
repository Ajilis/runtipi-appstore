// Explicit, human-reviewed discovery from Brave's independent web index.
// No LinkedIn cookies, sessions, API calls, login, page crawling or scraping.
const BRAVE_SEARCH = 'https://api.search.brave.com/res/v1/web/search';

export function normalizePublicProfileUrl(input) {
  if (typeof input !== 'string' || input.length > 1024) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase())
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
