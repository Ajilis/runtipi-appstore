// OpenAI-compatible model discovery. Never return credentials, remote error
// bodies, or follow redirects to another host when sending a Bearer token.
export function normalizeOpenAIBaseUrl(input) {
  if (typeof input !== 'string' || input.length > 512) throw new Error('URL de l’API IA invalide');
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error('URL de l’API IA invalide'); }
  const host = url.hostname.toLowerCase();
  const parts = host.split('.');
  const ipv4 = parts.length === 4 && parts.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255);
  const privateIp = ipv4 && (+parts[0] === 127 || +parts[0] === 10
    || (+parts[0] === 192 && +parts[1] === 168)
    || (+parts[0] === 172 && +parts[1] >= 16 && +parts[1] <= 31));
  const localHost = host === 'localhost' || host === '[::1]' || (host && !host.includes('.') && !host.includes(':'));
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && (localHost || privateIp)))
    || !host || url.username || url.password || url.search || url.hash
    || /\/\//.test(url.pathname) || /[\\%]/.test(url.pathname)
    || !/^\/(?:[A-Za-z0-9._-]+\/?)*$/.test(url.pathname)) {
    throw new Error('URL IA refusée : HTTPS ou HTTP local, sans identifiants ni paramètres');
  }
  return url.href.replace(/\/+$/, '');
}

export async function listOpenAIModels({ baseUrl, apiKey = '', fetcher = fetch }) {
  const url = normalizeOpenAIBaseUrl(baseUrl) + '/models';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher(url, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}) },
    });
    if (response.status === 401 || response.status === 403) throw new Error('Clé API IA refusée ou accès non autorisé');
    if (response.status === 404) throw new Error('L’API ne propose pas /models ; saisissez le nom du modèle manuellement');
    if (response.status === 429) throw new Error('Limite de requêtes du fournisseur IA atteinte');
    if (!response.ok) throw new Error('Liste des modèles indisponible (HTTP ' + response.status + ')');
    const body = await response.json();
    if (!Array.isArray(body?.data)) throw new Error('Format des modèles incompatible : tableau data[] attendu');
    const models = [...new Set(body.data.map((entry) => entry?.id).filter(
      (id) => typeof id === 'string' && id.length > 0 && id.length <= 200,
    ))].sort((a, b) => a.localeCompare(b)).slice(0, 500);
    return models;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('La récupération des modèles a dépassé 12 secondes');
    if (/^(Clé API IA|L’API ne propose pas|Limite de requêtes|Liste des modèles|Format des modèles|La récupération)/.test(error?.message || '')) throw error;
    throw new Error('Serveur IA inaccessible ou réponse invalide');
  } finally { clearTimeout(timeout); }
}
