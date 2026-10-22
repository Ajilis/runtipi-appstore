'use strict';

// Direct Rendevo communication uses a *scoped* device token obtained through a
// short-lived pairing code. LinkedIn DOM is read only on explicit user request;
// no LinkedIn cookies, external search API calls or background crawling.
const byId = (id) => document.getElementById(id);
const base = byId('base'), code = byId('paircode'), campaign = byId('campaign');
const profile = byId('profile'), statusEl = byId('status');
const save = byId('save'), connect = byId('connect');
const pairing = byId('pairing'), connected = byId('connected');
const importBtn = byId('import'), refresh = byId('refresh');
const messages = byId('messages'), disconnect = byId('disconnect');
const searchTerms = byId('searchterms'), searchLinkedin = byId('searchLinkedin');
const bulkUrls = byId('bulkUrls'), analyzeBulk = byId('analyzeBulk');
const bulkPreview = byId('bulkPreview'), submitBulk = byId('submitBulk');
const readLinkedinPage = byId('readLinkedinPage');
let rendevoOrigin = '';
let deviceToken = '';
let profileUrl = null;
let searchPageUrl = null;
let busy = false;
let campaignSuggestions = new Map();
let preparedBulk = [];

function localOrigin(input) {
  try {
    const parsed = new URL(String(input || '').trim());
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
    const host = parsed.hostname.toLowerCase();
    const privateHttp = host === 'localhost' || host === '127.0.0.1'
      || /^192\.168\.(\d{1,3})\.(\d{1,3})$/.test(host)
      || /^10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\.(\d{1,3})\.(\d{1,3})$/.test(host);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && privateHttp)) return null;
    return parsed.origin;
  } catch { return null; }
}

function normalizedLinkedinProfileUrl(input) {
  try {
    if (typeof input !== 'string' || input.length > 512) return null;
    const parsed = new URL(input);
    if (parsed.protocol !== 'https:' || !['www.linkedin.com', 'linkedin.com'].includes(parsed.hostname.toLowerCase())
      || parsed.username || parsed.password || parsed.port) return null;
    const matched = /^\/in\/([a-z0-9][a-z0-9_.%-]{0,199})\/?$/i.exec(parsed.pathname);
    return matched ? 'https://www.linkedin.com/in/' + matched[1] + '/' : null;
  } catch { return null; }
}

function isLinkedinPeopleSearchPage(input) {
  try {
    const url = new URL(input);
    return url.protocol === 'https:'
      && ['www.linkedin.com', 'linkedin.com'].includes(url.hostname.toLowerCase())
      && !url.username && !url.password && !url.port
      && /^\/search\/results\/people\/?$/.test(url.pathname);
  } catch { return false; }
}

function say(message) { statusEl.textContent = message; }
function update() {
  pairing.hidden = !!deviceToken;
  connected.hidden = !deviceToken;
  connect.disabled = busy || !rendevoOrigin || !code.value.trim() || !!deviceToken;
  importBtn.disabled = busy || !deviceToken || !profileUrl;
  refresh.disabled = busy || !deviceToken;
  searchLinkedin.disabled = busy || !deviceToken || !searchTerms.value.trim();
  analyzeBulk.disabled = busy || !deviceToken || !bulkUrls.value.trim();
  readLinkedinPage.disabled = busy || !deviceToken || !searchPageUrl;
  submitBulk.disabled = busy || !deviceToken || !preparedBulk.length;
  save.disabled = busy;
  disconnect.disabled = busy;
  messages.disabled = busy;
}
function setBusy(next) { busy = next; update(); }

async function api(path, { method = 'GET', body, token = deviceToken } = {}) {
  if (!rendevoOrigin) throw new Error('Renseigne ton instance Rendevo');
  const url = new URL(path, rendevoOrigin);
  const response = await fetch(url.href, {
    method,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token) {
      deviceToken = '';
      await chrome.storage.local.remove('companionToken');
      update();
    }
    throw new Error(result.error || 'Erreur Rendevo HTTP ' + response.status);
  }
  return result;
}

async function loadCampaigns() {
  const [state, list] = await Promise.all([
    api('/api/companion/status'), api('/api/companion/campaigns'),
  ]);
  byId('workspace').textContent = state.workspace || 'Rendevo';
  const previous = campaign.value;
  const previousSearch = searchTerms.value;
  campaignSuggestions = new Map((list.items || []).map(({ id, search_keywords }) => [
    id, String(search_keywords || '').slice(0, 240),
  ]));
  campaign.replaceChildren();
  const none = document.createElement('option');
  none.value = ''; none.textContent = 'Sans campagne (à classer plus tard)';
  campaign.append(none);
  for (const item of list.items || []) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.name;
    campaign.append(opt);
  }
  if (Array.from(campaign.options).some((x) => x.value === previous)) campaign.value = previous;
  if (!previousSearch) searchTerms.value = campaignSuggestions.get(campaign.value) || '';
  update();
}

async function init() {
  const stored = await chrome.storage.local.get(['rendevoOrigin', 'companionToken']);
  rendevoOrigin = localOrigin(stored.rendevoOrigin) || '';
  deviceToken = String(stored.companionToken || '');
  base.value = rendevoOrigin;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  profileUrl = normalizedLinkedinProfileUrl(tabs[0]?.url);
  searchPageUrl = isLinkedinPeopleSearchPage(tabs[0]?.url) ? tabs[0].url : null;
  profile.textContent = profileUrl || 'Ouvre une URL de profil LinkedIn /in/… puis rouvre l’extension.';
  update();
  if (deviceToken) {
    try { await loadCampaigns(); }
    catch (err) { say(err.message); }
  }
}

save.addEventListener('click', async () => {
  const origin = localOrigin(base.value);
  if (!origin) { say('Adresse HTTPS requise (HTTP autorisé seulement sur réseau privé).'); return; }
  // Chrome requests access to this specific Rendevo origin, not all websites.
  const granted = await chrome.permissions.request({ origins: [origin + '/*'] });
  if (!granted) { say("L'autorisation de communiquer avec Rendevo a été refusée."); return; }
  if (origin !== rendevoOrigin) {
    deviceToken = '';
    await chrome.storage.local.remove('companionToken');
  }
  rendevoOrigin = origin;
  base.value = origin;
  await chrome.storage.local.set({ rendevoOrigin: origin });
  say('Instance autorisée. Crée un code dans Rendevo → Réglages → Intégrations.');
  update();
});

code.addEventListener('input', update);
searchTerms.addEventListener('input', update);
campaign.addEventListener('change', () => {
  searchTerms.value = campaignSuggestions.get(campaign.value) || '';
  preparedBulk = [];
  bulkPreview.textContent = 'La campagne a changé : prévisualise de nouveau les liens.';
  update();
});

bulkUrls.addEventListener('input', () => {
  preparedBulk = [];
  bulkPreview.textContent = 'Contenu modifié : clique sur Prévisualiser les liens.';
  update();
});

analyzeBulk.addEventListener('click', () => {
  if (!deviceToken || busy) return;
  // Only links that the user pastes into the popup. Never read the tab DOM.
  const candidates = bulkUrls.value.match(/https?:\/\/[^\s<>"',;]+/gi) || [];
  const seen = new Set(), profiles = [];
  let invalid = 0, repeated = 0;
  for (const candidate of candidates) {
    const valid = normalizedLinkedinProfileUrl(candidate);
    if (!valid) { invalid++; continue; }
    if (seen.has(valid.toLowerCase())) { repeated++; continue; }
    seen.add(valid.toLowerCase());
    profiles.push(valid);
  }
  if (!profiles.length || profiles.length > 100 || invalid) {
    preparedBulk = [];
    bulkPreview.textContent = !profiles.length
      ? 'Aucun lien LinkedIn /in/ valide dans la liste. Copie les adresses complètes des profils.'
      : profiles.length > 100 ? 'Maximum : 100 profils par import.'
        : invalid + ' lien(s) non valide(s) : corrige la liste avant de continuer.';
  } else {
    preparedBulk = profiles;
    bulkPreview.textContent = profiles.length + ' profil(s) prêt(s) à importer'
      + (repeated ? ' (' + repeated + ' doublon(s) retiré(s))' : '')
      + ' :\n' + profiles.join('\n');
  }
  update();
});

submitBulk.addEventListener('click', async () => {
  if (!deviceToken || !preparedBulk.length || busy) return;
  setBusy(true);
  try {
    const result = await api('/api/companion/prospects/batch', {
      method: 'POST',
      body: {
        campaign_id: campaign.value || null,
        items: preparedBulk.map((url) => ({ linkedin_url: url })),
      },
    });
    preparedBulk = [];
    bulkUrls.value = '';
    bulkPreview.textContent = 'Import terminé : ' + result.created + ' créé(s), '
      + result.duplicates + ' déjà présent(s), ' + result.invalid + ' invalide(s).';
    say('Import groupé terminé dans Rendevo.');
  } catch (err) { say(err.message); }
  finally { setBusy(false); }
});

readLinkedinPage.addEventListener('click', async () => {
  if (!deviceToken || !searchPageUrl || busy) return;
  setBusy(true);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isLinkedinPeopleSearchPage(tab.url)) {
      throw new Error('Ouvre la page LinkedIn de recherche Personnes, puis rouvre Companion.');
    }
    // Only runs after this click, on this LinkedIn tab (activeTab + scripting).
    // No cookies, network request, infinite scroll or pagination.
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const main = document.querySelector('main') || document.querySelector('[role="main"]');
        if (!main) return [];
        const urls = [];
        for (const link of main.querySelectorAll('a[href*="/in/"]')) {
          if (!link.closest('li, .entity-result, .reusable-search__result-container')) continue;
          if (!link.getClientRects().length) continue;
          urls.push(link.href);
        }
        return urls;
      },
    });
    const candidates = execution?.result;
    if (!Array.isArray(candidates) || !candidates.length) {
      throw new Error('Aucun profil sur cette page. Vérifie que les résultats sont chargés.');
    }
    const profiles = [], seen = new Set();
    for (const candidate of candidates) {
      const valid = normalizedLinkedinProfileUrl(candidate);
      if (!valid || seen.has(valid.toLowerCase())) continue;
      seen.add(valid.toLowerCase());
      profiles.push(valid);
    }
    if (!profiles.length) throw new Error('Aucun lien de profil LinkedIn valide détecté.');
    if (profiles.length > 100) throw new Error('Plus de 100 profils : réduis les résultats avant de continuer.');
    // The existing V19 reviewed batch-import flow remains unchanged.
    // Editing the textarea invalidates the approval and requires a new preview.
    preparedBulk = profiles;
    bulkUrls.value = profiles.join('\n');
    bulkPreview.textContent = profiles.length + ' profil(s) trouvés sur la page active, à vérifier :\n'
      + profiles.join('\n');
    say('Liste préparée localement : vérifie les liens, puis confirme pour importer.');
  } catch (err) {
    preparedBulk = [];
    bulkPreview.textContent = 'Lecture impossible. Aucun prospect importé.';
    say(err.message || 'Impossible de lire les résultats LinkedIn.');
  } finally { setBusy(false); }
});

searchLinkedin.addEventListener('click', async () => {
  if (!deviceToken || busy) return;
  const words = searchTerms.value.trim().replace(/\s+/g, ' ').slice(0, 240);
  if (!words) return;
  // Navigate Chrome's ordinary LinkedIn page in the user's existing browser
  // session. No background requests, DOM access, cookies or result extraction.
  const url = new URL('https://www.linkedin.com/search/results/people/');
  url.searchParams.set('keywords', words);
  await chrome.tabs.create({ url: url.href });
});

connect.addEventListener('click', async () => {
  if (!rendevoOrigin || deviceToken || busy) return;
  setBusy(true);
  try {
    const result = await api('/api/companion/exchange', {
      method: 'POST', body: { code: code.value.trim(), device_name: 'Chrome Companion' }, token: '',
    });
    deviceToken = result.token;
    await chrome.storage.local.set({ companionToken: deviceToken });
    code.value = '';
    await loadCampaigns();
    say('Extension associée directement à Rendevo.');
  } catch (err) { say(err.message); }
  finally { setBusy(false); }
});

refresh.addEventListener('click', async () => {
  if (!deviceToken || busy) return;
  setBusy(true);
  try { await loadCampaigns(); say('Campagnes actualisées.'); }
  catch (err) { say(err.message); }
  finally { setBusy(false); }
});

importBtn.addEventListener('click', async () => {
  if (!deviceToken || !profileUrl || busy) return;
  setBusy(true);
  try {
    const result = await api('/api/companion/prospects', {
      method: 'POST',
      body: { linkedin_url: profileUrl, campaign_id: campaign.value || null },
    });
    say(result.created ? 'Profil ajouté dans Rendevo.' : result.duplicates
      ? 'Ce prospect existe déjà dans Rendevo.' : 'Profil non importé : données insuffisantes.');
  } catch (err) { say(err.message); }
  finally { setBusy(false); }
});

messages.addEventListener('click', async () => {
  if (rendevoOrigin) await chrome.tabs.create({ url: new URL('/messages', rendevoOrigin).href });
});

disconnect.addEventListener('click', async () => {
  deviceToken = '';
  await chrome.storage.local.remove('companionToken');
  byId('workspace').textContent = '';
  update();
  say("Extension dissociée localement. Pour révoquer l'ancien jeton, ouvre Rendevo → Réglages → Intégrations.");
});

init().catch((err) => say(err.message || 'Impossible de lire les réglages Chrome.'));
