'use strict';

// No content script, no fetch, no LinkedIn cookies and no background polling.
// The popup reads the active tab URL only after the user opens it.
const baseInput = document.getElementById('base');
const profileEl = document.getElementById('profile');
const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('save');
const importBtn = document.getElementById('import');
const messagesBtn = document.getElementById('messages');
let rendevoOrigin = '';
let profileUrl = null;

function localOrigin(input) {
  try {
    const parsed = new URL(input.trim());
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
    const host = parsed.hostname.toLowerCase();
    const privateHttp = host === 'localhost' || host === '127.0.0.1'
      || /^192\.168\.(\d{1,3})\.(\d{1,3})$/.test(host)
      || /^10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\.(\d{1,3})\.(\d{1,3})$/.test(host);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && privateHttp)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizedLinkedinProfileUrl(input) {
  try {
    if (typeof input !== 'string' || input.length > 512) return null;
    const parsed = new URL(input);
    if (parsed.protocol !== 'https:' || !['www.linkedin.com', 'linkedin.com'].includes(parsed.hostname.toLowerCase())
      || parsed.username || parsed.password || parsed.port) return null;
    const matched = /^\/in\/([a-z0-9][a-z0-9_.%-]{0,199})\/?$/i.exec(parsed.pathname);
    if (!matched) return null;
    return 'https://www.linkedin.com/in/' + matched[1] + '/';
  } catch { return null; }
}

function status(message) { statusEl.textContent = message; }
function refreshButtons() {
  importBtn.disabled = !rendevoOrigin || !profileUrl;
  messagesBtn.disabled = !rendevoOrigin;
}

async function init() {
  const stored = await chrome.storage.local.get('rendevoOrigin');
  rendevoOrigin = localOrigin(stored.rendevoOrigin || '') || '';
  baseInput.value = rendevoOrigin;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  profileUrl = normalizedLinkedinProfileUrl(tabs[0]?.url);
  profileEl.textContent = profileUrl
    || "Ouvre une page de profil LinkedIn (linkedin.com/in/…), puis rouvre l'extension.";
  refreshButtons();
}

saveBtn.addEventListener('click', async () => {
  const origin = localOrigin(baseInput.value);
  if (!origin) {
    status("Utilise une adresse HTTPS Rendevo, ou HTTP uniquement sur un réseau local privé.");
    return;
  }
  await chrome.storage.local.set({ rendevoOrigin: origin });
  rendevoOrigin = origin;
  baseInput.value = origin;
  status("Adresse enregistrée. Connecte-toi à Rendevo dans le navigateur.");
  refreshButtons();
});

importBtn.addEventListener('click', async () => {
  if (!rendevoOrigin || !profileUrl) return;
  const link = new URL('/prospects', rendevoOrigin);
  link.searchParams.set('import', '1');
  link.searchParams.set('companion_url', profileUrl);
  await chrome.tabs.create({ url: link.href });
  status("Import à confirmer dans Rendevo.");
});

messagesBtn.addEventListener('click', async () => {
  if (!rendevoOrigin) return;
  await chrome.tabs.create({ url: new URL('/messages', rendevoOrigin).href });
});

init().catch(() => status("Chrome n'a pas autorisé l'accès à l'onglet actif."));
