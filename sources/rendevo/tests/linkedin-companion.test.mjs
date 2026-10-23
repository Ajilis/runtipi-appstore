import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizedLinkedinProfileUrl } from '../web/src/lib/companion.js';
import { getProvider } from '../server/services/providers/index.js';
import { assistedCampaignSettings, assistedMessageApproval } from '../server/services/providers/linkedin-assisted.js';

const extensionFile = new URL('../extension/popup.js', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

test('extension MV3 : lecture ponctuelle de l’onglet sans cookies ni permission LinkedIn permanente', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage', 'permissions']);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://*/*']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.background, undefined);
  const js = fs.readFileSync(extensionFile, 'utf8');
  for (const forbidden of ['document.cookie', 'chrome.cookies',
    'chrome.webRequest', 'innerHTML']) {
    assert.equal(js.includes(forbidden), false, forbidden);
  }
  assert.match(js, /chrome\.scripting\.executeScript/);
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

async function simulatePopup(currentTabUrl, pageUrls = []) {
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
  const createdTabs = [], requests = [], permissions = [], executions = [], storage = {};
  const context = {
    document: { getElementById: elem, createElement: () => ({ value: '', textContent: '' }) },
    chrome: {
      runtime: { getManifest: () => ({ version: '0.2.10' }) },
      permissions: { request: async (x) => { permissions.push(x); return true; } },
      storage: { local: {
        get: async () => ({ ...storage }),
        set: async (patch) => Object.assign(storage, patch),
        remove: async (k) => { delete storage[k]; },
      } },
      tabs: {
        query: async () => [{ id: 12, url: currentTabUrl }],
        create: async (opts) => createdTabs.push(opts.url),
      },
      scripting: {
        executeScript: async ({ target, func }) => {
          executions.push(target);
          const main = {
            querySelectorAll: () => pageUrls.map((href) => ({
              href,
              closest: () => ({}),
              getClientRects: () => [{}],
            })),
          };
          const pageDocument = { querySelector: (selector) => selector === 'main' ? main : null };
          const result = vm.runInNewContext('(' + func.toString() + ')()', { document: pageDocument });
          return [{ result }];
        },
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
        '/api/companion/prospects/batch': { created: 2, duplicates: 0, invalid: 0, submitted: 2, repeated_in_list: 1 },
      }[pathname];
      if (!response) throw Error('Unexpected call ' + pathname);
      return { ok: true, status: 200, json: async () => response };
    },
  };
  vm.runInNewContext(fs.readFileSync(extensionFile, 'utf8'), context, { filename: 'popup.js' });
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
  return { elem, storage, createdTabs, requests, permissions, executions };
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
  assert.equal(requests[3].options.headers['X-Companion-Version'], '0.2.10');
  assert.equal(JSON.parse(requests[0].options.body).version, '0.2.10');
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
  assert.match(fs.readFileSync(extensionFile, 'utf8'), /chrome\.scripting\.executeScript/);
  assert.doesNotMatch(fs.readFileSync(extensionFile, 'utf8'), /chrome\.cookies|fetch\(['"]https:\/\/www\.linkedin\.com/);
});

test('Companion : coller, prévisualiser puis importer un lot sans lire l’onglet LinkedIn', async () => {
  const { elem, requests, createdTabs } = await simulatePopup('https://www.linkedin.com/search/results/people/?keywords=directeur');
  elem('base').value = 'https://rendevo.exemple.fr';
  await elem('save').events.click();
  elem('paircode').value = 'some-one-time-code';
  elem('paircode').events.input();
  await elem('connect').events.click();
  elem('campaign').value = 'campaign-1';
  elem('campaign').events.change();
  const before = requests.length;
  assert.equal(elem('submitBulk').disabled, true);
  elem('bulkUrls').value = [
    'https://www.linkedin.com/in/camille/?trk=results',
    'https://linkedin.com/in/camille/',
    'https://www.linkedin.com/in/marc/',
  ].join('\n');
  elem('bulkUrls').events.input();
  assert.equal(requests.length, before);
  await elem('analyzeBulk').events.click();
  assert.match(elem('bulkPreview').textContent, /2 profil\(s\) prêt\(s\)/);
  assert.match(elem('bulkPreview').textContent, /1 doublon\(s\)/);
  assert.equal(elem('submitBulk').disabled, false);
  assert.equal(requests.length, before);
  await elem('submitBulk').events.click();
  assert.equal(requests.length, before + 1);
  const call = requests.at(-1);
  assert.equal(call.url, 'https://rendevo.exemple.fr/api/companion/prospects/batch');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.credentials, 'omit');
  assert.deepEqual(JSON.parse(call.options.body), {
    campaign_id: 'campaign-1',
    items: [
      { linkedin_url: 'https://www.linkedin.com/in/camille/' },
      { linkedin_url: 'https://www.linkedin.com/in/marc/' },
    ],
  });
  assert.equal(elem('submitBulk').disabled, true);
  assert.equal(createdTabs.length, 0);
});

test('Companion : faux domaine LinkedIn et liste modifiée bloquent l’envoi jusqu’à nouvelle validation', async () => {
  const { elem, requests } = await simulatePopup('https://www.linkedin.com/search/results/people/');
  elem('base').value = 'https://rendevo.exemple.fr';
  await elem('save').events.click();
  elem('paircode').value = 'one-time-code';
  elem('paircode').events.input();
  await elem('connect').events.click();
  const before = requests.length;
  elem('bulkUrls').value = 'https://linkedin.com.evil.test/in/camille/';
  elem('bulkUrls').events.input();
  await elem('analyzeBulk').events.click();
  assert.equal(elem('submitBulk').disabled, true);
  elem('bulkUrls').value = 'https://www.linkedin.com/in/camille/';
  elem('bulkUrls').events.input();
  await elem('analyzeBulk').events.click();
  assert.equal(elem('submitBulk').disabled, false);
  elem('bulkUrls').value += '\nhttps://www.linkedin.com/in/marc/';
  elem('bulkUrls').events.input();
  assert.equal(elem('submitBulk').disabled, true);
  assert.equal(requests.length, before);
  const script = fs.readFileSync(extensionFile, 'utf8');
  assert.doesNotMatch(script, /document\.cookie|chrome\.cookies|chrome\.webRequest/);
});


test('Companion lit uniquement la page Personnes sur clic, prévisualise et importe après confirmation', async () => {
  const { elem, requests, executions } = await simulatePopup(
    'https://www.linkedin.com/search/results/people/?keywords=directeur',
    [
      'https://www.linkedin.com/in/alice/?trk=search',
      'https://www.linkedin.com/in/alice/',
      'https://www.linkedin.com/in/bob/',
      'https://linkedin.com.evil.test/in/intrus/',
      'https://www.linkedin.com/jobs/',
    ],
  );
  elem('base').value = 'https://rendevo.exemple.fr';
  await elem('save').events.click();
  elem('paircode').value = 'some-one-time-code';
  elem('paircode').events.input();
  await elem('connect').events.click();
  elem('campaign').value = 'campaign-1';
  elem('campaign').events.change();
  const before = requests.length;
  assert.equal(executions.length, 0);
  assert.equal(elem('readLinkedinPage').disabled, false);
  await elem('readLinkedinPage').events.click();
  assert.equal(executions.length, 1);
  assert.equal(executions[0].tabId, 12);
  assert.equal(requests.length, before);
  assert.equal(elem('submitBulk').disabled, false);
  assert.match(elem('bulkPreview').textContent, /2 profil\(s\) trouvés/);
  assert.deepEqual(elem('bulkUrls').value.split('\n'), [
    'https://www.linkedin.com/in/alice/',
    'https://www.linkedin.com/in/bob/',
  ]);
  await elem('submitBulk').events.click();
  assert.equal(requests.length, before + 1);
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), {
    campaign_id: 'campaign-1',
    items: [
      { linkedin_url: 'https://www.linkedin.com/in/alice/' },
      { linkedin_url: 'https://www.linkedin.com/in/bob/' },
    ],
  });
  assert.equal(elem('submitBulk').disabled, true);
});

test('Companion ne lit pas les pages LinkedIn non autorisées et invalide toute sélection modifiée', async () => {
  const { elem, requests, executions } = await simulatePopup('https://www.linkedin.com/feed/');
  elem('base').value = 'https://rendevo.exemple.fr';
  await elem('save').events.click();
  elem('paircode').value = 'some-one-time-code';
  elem('paircode').events.input();
  await elem('connect').events.click();
  assert.equal(elem('readLinkedinPage').disabled, true);
  assert.equal(executions.length, 0);
  assert.equal(requests.filter((r) => r.url.includes('/prospects')).length, 0);

  const page = await simulatePopup('https://www.linkedin.com/search/results/people/', [
    'https://www.linkedin.com/in/alice/',
  ]);
  page.elem('base').value = 'https://rendevo.exemple.fr';
  await page.elem('save').events.click();
  page.elem('paircode').value = 'some-one-time-code';
  page.elem('paircode').events.input();
  await page.elem('connect').events.click();
  await page.elem('readLinkedinPage').events.click();
  assert.equal(page.elem('submitBulk').disabled, false);
  page.elem('bulkUrls').value += '\nhttps://www.linkedin.com/in/bob/';
  page.elem('bulkUrls').events.input();
  assert.equal(page.elem('submitBulk').disabled, true);
  assert.equal(page.requests.filter((r) => r.url.includes('/prospects')).length, 0);
});
