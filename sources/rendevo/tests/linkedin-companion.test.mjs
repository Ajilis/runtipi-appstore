import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizedLinkedinProfileUrl } from '../web/src/lib/companion.js';
import { getProvider } from '../server/services/providers/index.js';
import { assistedCampaignSettings, assistedMessageApproval } from '../server/services/providers/linkedin-assisted.js';

const extensionFile = new URL('../extension/popup.js', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

test('extension MV3 sans cookies, scripts, ni permissions d’hôtes permanentes', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'storage', 'permissions']);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://*/*']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.background, undefined);
  const js = fs.readFileSync(extensionFile, 'utf8');
  for (const forbidden of ['document.cookie', 'chrome.cookies', 'chrome.scripting',
    'executeScript', 'chrome.webRequest', 'innerHTML']) {
    assert.equal(js.includes(forbidden), false, forbidden);
  }
  assert.match(js, /chrome\.permissions\.request/);
  assert.match(js, /credentials: 'omit'/);
});

test('les URLs de profils LinkedIn ne laissent passer ni faux domaines, ni requêtes, ni liens tiers', () => {
  const valid = [
    'https://www.linkedin.com/in/camille-pro-123/?trk=invite#about',
    'https://linkedin.com/in/personne-678',
  ];
  assert.deepEqual(valid.map(normalizedLinkedinProfileUrl), [
    'https://www.linkedin.com/in/camille-pro-123/',
    'https://www.linkedin.com/in/personne-678/',
  ]);
  for (const invalid of [
    'http://www.linkedin.com/in/user/', 'https://linkedin.com.evil.test/in/user/',
    'https://www.linkedin.com/jobs/', 'https://www.linkedin.com/feed/',
    'https://www.linkedin.com/in/user/another', 'https://evil.test/',
    'javascript:alert(1)', 'https://user:pass@www.linkedin.com/in/user/',
  ]) assert.equal(normalizedLinkedinProfileUrl(invalid), null, invalid);
});

test('compte Companion n’effectue aucun appel externe et interdit les envois et recherches automatiques', async () => {
  const companion = getProvider('linkedin_companion');
  assert.equal(companion.auto, false);
  assert.deepEqual(companion.capabilities, { search: false, invite: false, message: false });
  assert.equal((await companion.test()).ok, true);
  assert.equal(assistedCampaignSettings({ validation: 'none', auto_discovery: true }, companion.id).validation, 'all');
  assert.equal(assistedCampaignSettings({ validation: 'none', auto_discovery: true }, companion.id).auto_discovery, false);
  for (const kind of ['invite', 'first', 'followup', 'setter']) {
    assert.equal(assistedMessageApproval(companion.id, kind, false), true);
  }
  const inbox = fs.readFileSync(new URL('../server/routes/inbox.js', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../web/src/pages/Inbox.jsx', import.meta.url), 'utf8');
  assert.match(inbox, /'linkedin_companion'/);
  assert.match(ui, /'linkedin_companion'/);
  assert.match(inbox, /body\.confirmed !== true/);
});

async function simulatePopup(currentTabUrl) {
  const elements = new Map();
  function elem(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', disabled: false, hidden: false, options: [], events: {},
      addEventListener(name, callback) { this.events[name] = callback; },
      replaceChildren() { this.options = []; },
      append(child) { this.options.push(child); },
    });
    return elements.get(id);
  }
  const createdTabs = [], requests = [], permissions = [], storage = {};
  const context = {
    document: { getElementById: elem, createElement: () => ({ value: '', textContent: '' }) },
    chrome: {
      permissions: { request: async (x) => { permissions.push(x); return true; } },
      storage: { local: {
        get: async () => ({ ...storage }),
        set: async (patch) => Object.assign(storage, patch),
        remove: async (k) => { delete storage[k]; },
      } },
      tabs: {
        query: async () => [{ url: currentTabUrl }],
        create: async (opts) => createdTabs.push(opts.url),
      },
    },
    URL,
    fetch: async (url, options) => {
      requests.push({ url, options });
      const pathname = new URL(url).pathname;
      const response = {
        '/api/companion/exchange': { token: 'example-' + 'A'.repeat(43), expires_at: '2030-01-01T00:00:00Z' },
        '/api/companion/status': { connected: true, workspace: 'Mon espace' },
        '/api/companion/campaigns': { items: [{ id: 'campaign-1', name: 'Campagne test', search_keywords: 'Directeur commercial SaaS Paris' }] },
        '/api/companion/prospects': { created: 1, duplicates: 0, invalid: 0 },
      }[pathname];
      if (!response) throw Error('Unexpected call ' + pathname);
      return { ok: true, status: 200, json: async () => response };
    },
  };
  vm.runInNewContext(fs.readFileSync(extensionFile, 'utf8'), context, { filename: 'popup.js' });
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
  return { elem, storage, createdTabs, requests, permissions };
}

test('l’extension échange directement le code, lit les campagnes, importe uniquement sur clic', async () => {
  const { elem, storage, createdTabs, requests, permissions } = await simulatePopup('https://www.linkedin.com/in/camille/?trk=tracking');
  assert.equal(elem('import').disabled, true);
  elem('base').value = 'https://rendevo.exemple.fr/';
  await elem('save').events.click();
  assert.equal(storage.rendevoOrigin, 'https://rendevo.exemple.fr');
  assert.equal(permissions.length, 1);
  assert.deepEqual(Array.from(permissions[0].origins), ['https://rendevo.exemple.fr/*']);
  assert.equal(createdTabs.length, 0);
  elem('paircode').value = 'example-one-time-code';
  elem('paircode').events.input();
  await elem('connect').events.click();
  assert.ok(storage.companionToken);
  assert.equal(elem('connected').hidden, false);
  assert.equal(elem('workspace').textContent, 'Mon espace');
  assert.equal(elem('campaign').options.length, 2);
  assert.equal(requests.length, 3); // exchange + status + campaigns; no upload yet
  elem('campaign').value = 'campaign-1';
  await elem('import').events.click();
  assert.equal(requests.length, 4);
  assert.equal(requests[3].url, 'https://rendevo.exemple.fr/api/companion/prospects');
  assert.equal(requests[3].options.method, 'POST');
  assert.equal(requests[3].options.credentials, 'omit');
  assert.equal(requests[3].options.headers.Authorization, 'Bearer ' + storage.companionToken);
  const sent = JSON.parse(requests[3].options.body);
  assert.equal(sent.campaign_id, 'campaign-1');
  assert.equal(sent.linkedin_url, 'https://www.linkedin.com/in/camille/');
  assert.equal(createdTabs.length, 0);
});

test('l’extension refuse les origines invalides et les faux domaines LinkedIn', async () => {
  const { elem, storage, requests, createdTabs } = await simulatePopup('https://linkedin.com.attacker.example/in/camille/');
  elem('base').value = 'https://rendevo.exemple.fr/path';
  await elem('save').events.click();
  assert.equal(storage.rendevoOrigin, undefined);
  elem('base').value = 'http://public.example.com';
  await elem('save').events.click();
  assert.equal(storage.rendevoOrigin, undefined);
  elem('base').value = 'https://rendevo.exemple.fr';
  await elem('save').events.click();
  elem('paircode').value = 'some-code';
  elem('paircode').events.input();
  await elem('connect').events.click();
  assert.equal(elem('import').disabled, true);
  assert.equal(requests.filter((r) => r.url.includes('/prospects')).length, 0);
  assert.equal(createdTabs.length, 0);
});

test('l’interface Rendevo propose une association directe et la révocation', () => {
  const settings = fs.readFileSync(new URL('../web/src/pages/Settings.jsx', import.meta.url), 'utf8');
  const component = fs.readFileSync(new URL('../web/src/components/CompanionSettings.jsx', import.meta.url), 'utf8');
  assert.match(settings, /CompanionSettings/);
  assert.match(component, /api\/companion\/pairings/);
  assert.match(component, /api\/companion\/devices/);
  assert.match(component, /Générer un code d'association/);
  assert.match(component, /Révoquer/);
});

test('recherche native LinkedIn lancée sur clic avec la cible fournie par Rendevo, sans scraping', async () => {
  const { elem, requests, createdTabs } = await simulatePopup('https://www.linkedin.com/feed/');
  elem('base').value = 'https://rendevo.exemple.fr';
  await elem('save').events.click();
  assert.equal(elem('searchLinkedin').disabled, true);
  elem('paircode').value = 'one-time-code';
  elem('paircode').events.input();
  await elem('connect').events.click();
  assert.equal(elem('searchLinkedin').disabled, true); // no campaign selected or search text
  elem('campaign').value = 'campaign-1';
  elem('campaign').events.change();
  assert.equal(elem('searchterms').value, 'Directeur commercial SaaS Paris');
  assert.equal(elem('searchLinkedin').disabled, false);
  const before = requests.length;
  await elem('searchLinkedin').events.click();
  assert.equal(requests.length, before); // no calls to LinkedIn, only local navigation
  assert.equal(createdTabs.length, 1);
  const opened = new URL(createdTabs[0]);
  assert.equal(opened.origin, 'https://www.linkedin.com');
  assert.equal(opened.pathname, '/search/results/people/');
  assert.equal(opened.searchParams.get('keywords'), 'Directeur commercial SaaS Paris');
  elem('searchterms').value = 'Dirigeant financier Lyon';
  elem('searchterms').events.input();
  await elem('searchLinkedin').events.click();
  assert.equal(new URL(createdTabs[1]).searchParams.get('keywords'), 'Dirigeant financier Lyon');
  assert.equal(requests.length, before);
});

test('l’interface propose le mode recherche LinkedIn Companion sans clé Brave', () => {
  const web = fs.readFileSync(new URL('../web/src/pages/Prospects.jsx', import.meta.url), 'utf8');
  const popup = fs.readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  assert.match(web, /Dans mon LinkedIn \(Companion\)/);
  assert.match(web, /sans clé Brave/);
  assert.match(popup, /id="searchLinkedin"/);
  assert.match(popup, /id="searchterms"/);
  assert.doesNotMatch(fs.readFileSync(extensionFile, 'utf8'), /chrome\.scripting|chrome\.cookies|fetch\(['"]https:\/\/www\.linkedin\.com/);
});
