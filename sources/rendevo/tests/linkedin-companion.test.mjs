import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizedLinkedinProfileUrl } from '../web/src/lib/companion.js';
import { getProvider } from '../server/services/providers/index.js';
import { assistedCampaignSettings, assistedMessageApproval } from '../server/services/providers/linkedin-assisted.js';

const extensionFile = new URL('../extension/popup.js', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

test('extension Manifest V3 sans autorisation cookie, injection ou domaine LinkedIn', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.background, undefined);
  const js = fs.readFileSync(extensionFile, 'utf8');
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'document.cookie', 'chrome.cookies', 'chrome.scripting',
    'executeScript', 'chrome.webRequest', 'querySelector(', 'innerHTML']) {
    assert.equal(js.includes(forbidden), false, forbidden);
  }
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
      value: '', textContent: '', disabled: true,
      events: {},
      addEventListener(name, callback) { this.events[name] = callback; },
    });
    return elements.get(id);
  }
  const createdTabs = [];
  const storage = {};
  const context = {
    document: { getElementById: elem },
    chrome: {
      storage: { local: {
        get: async () => ({ rendevoOrigin: storage.rendevoOrigin }),
        set: async (patch) => Object.assign(storage, patch),
      } },
      tabs: {
        query: async () => [{ url: currentTabUrl }],
        create: async (opts) => createdTabs.push(opts.url),
      },
    },
    URL,
  };
  vm.runInNewContext(fs.readFileSync(extensionFile, 'utf8'), context, { filename: 'popup.js' });
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
  return { elem, storage, createdTabs };
}

test('l’extension attend une action explicite et ouvre le formulaire sans importer automatiquement', async () => {
  const { elem, storage, createdTabs } = await simulatePopup('https://www.linkedin.com/in/camille/?trk=tracking');
  assert.equal(elem('import').disabled, true);
  elem('base').value = 'https://rendevo.exemple.fr/';
  await elem('save').events.click();
  assert.equal(storage.rendevoOrigin, 'https://rendevo.exemple.fr');
  assert.equal(elem('import').disabled, false);
  assert.equal(createdTabs.length, 0);
  await elem('import').events.click();
  assert.equal(createdTabs.length, 1);
  const link = new URL(createdTabs[0]);
  assert.equal(link.origin, 'https://rendevo.exemple.fr');
  assert.equal(link.pathname, '/prospects');
  assert.equal(link.searchParams.get('import'), '1');
  assert.equal(link.searchParams.get('companion_url'), 'https://www.linkedin.com/in/camille/');
  assert.equal(createdTabs.length, 1);
});

test('l’extension refuse un faux LinkedIn et les origines Rendevo non sécurisées', async () => {
  const { elem, storage, createdTabs } = await simulatePopup('https://www.linkedin.com.evil.test/in/camille/');
  elem('base').value = 'https://attacker.example/?trick=1';
  await elem('save').events.click();
  assert.equal(storage.rendevoOrigin, undefined);
  assert.equal(elem('messages').disabled, true);
  elem('base').value = 'http://public.example.com';
  await elem('save').events.click();
  assert.equal(storage.rendevoOrigin, undefined);
  elem('base').value = 'https://rendevo.exemple.fr';
  await elem('save').events.click();
  assert.equal(elem('import').disabled, true);
  assert.equal(elem('messages').disabled, false);
  assert.equal(createdTabs.length, 0);
});

test('l’interface Rendevo impose une confirmation d’import et n’envoie pas la page automatiquement', () => {
  const prospects = fs.readFileSync(new URL('../web/src/pages/Prospects.jsx', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../web/src/pages/Settings.jsx', import.meta.url), 'utf8');
  assert.match(prospects, /normalizedLinkedinProfileUrl\(query\.companion_url\)/);
  assert.match(prospects, /initialUrls=\{companionUrl \|\| ''\}/);
  assert.match(prospects, /setMode\]\s*=\s*useState\(initialUrls \? 'urls'/);
  assert.match(prospects, /onClick=\{submit\}/);
  assert.match(settings, /Rendevo Companion — extension Chrome/);
});
