// Unipile v1 Hosted Auth. Credentials never reach the browser after this request.
import { bad } from '../../lib/http.js';

export function unipileOrigin(dsn) {
  const raw = String(dsn || '').trim().replace(/\/+$/, '');
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch { throw bad('DSN Unipile invalide'); }
  if (url.protocol !== 'https:' || !/^api[a-z0-9-]*\.unipile\.com$/i.test(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw bad('Utilisez le DSN HTTPS officiel de votre espace Unipile (ex. api8.unipile.com:13851)');
  }
  return url.origin;
}

async function request(dsn, key, method, path, payload, fetcher = fetch) {
  const endpoint = `${unipileOrigin(dsn)}/api/v1${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const response = await fetcher(endpoint, {
      method,
      headers: { 'X-API-KEY': key, accept: 'application/json', ...(payload ? { 'content-type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: ctrl.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw bad(`Unipile : ${String(result.detail || result.message || result.title || 'connexion impossible').slice(0, 200)} (HTTP ${response.status})`);
    return result;
  } finally { clearTimeout(timer); }
}

export async function hostedAuthUrl({ dsn, apiKey, publicUrl, accountId, token, reconnectAccountId }, fetcher = fetch) {
  const origin = unipileOrigin(dsn);
  if (!/^https:\/\//.test(publicUrl || '')) throw bad('Configurez une URL publique HTTPS Rendevo (Cloudflare Tunnel) avant de connecter LinkedIn.');
  const base = publicUrl.replace(/\/+$/, '');
  const target = `${base}/reglages?tab=comptes&linkedin_link=${encodeURIComponent(accountId)}`;
  const payload = {
    type: reconnectAccountId ? 'reconnect' : 'create',
    ...(reconnectAccountId ? { reconnect_account: reconnectAccountId } : { providers: ['LINKEDIN'] }),
    api_url: origin,
    expiresOn: new Date(Date.now() + 15 * 60_000).toISOString(),
    notify_url: `${base}/api/public/unipile/hosted-notify?token=${encodeURIComponent(token)}`,
    success_redirect_url: `${target}&linkedin_result=success`,
    failure_redirect_url: `${target}&linkedin_result=error`,
    name: accountId,
    unilogin: {},
  };
  const data = await request(dsn, apiKey, 'POST', '/hosted/accounts/link', payload, fetcher);
  let url;
  try { url = new URL(data.url); } catch { throw bad("Unipile n'a pas renvoyé de lien de connexion"); }
  if (url.protocol !== 'https:' || !/(^|\.)unipile\.com$/i.test(url.hostname)) {
    throw bad('Lien de connexion Unipile inattendu');
  }
  return url.href;
}

export async function retrieveLinkedinAccount(dsn, apiKey, accountId, fetcher = fetch) {
  if (!/^[A-Za-z0-9_-]{4,160}$/.test(String(accountId || ''))) throw bad('Identifiant de compte LinkedIn invalide');
  const account = await request(dsn, apiKey, 'GET', `/accounts/${encodeURIComponent(accountId)}`, null, fetcher);
  if (account.type !== 'LINKEDIN' || String(account.id) !== String(accountId)) {
    throw bad("Le compte renvoyé par Unipile n'est pas un compte LinkedIn");
  }
  return { id: account.id, name: String(account.name || '').slice(0, 80), status: account.sources?.[0]?.status || 'OK' };
}
