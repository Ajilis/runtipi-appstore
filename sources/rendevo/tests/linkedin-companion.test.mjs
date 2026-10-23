import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizedLinkedinProfileUrl } from '../web/src/lib/companion.js';
import { getProvider } from '../server/services/providers/index.js';
import { assistedCampaignSettings, assistedMessageApproval } from '../server/services/providers/linkedin-assisted.js';

const extensionFile = new URL('../extension/popup.js', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const secret = 'A'.repeat(32);
const portableCode = (origin = 'https://rendevo.exemple.fr', rawSecret = secret) =>
  'RDV1.' + encodeURIComponent(origin) + '.' + rawSecret;
async function pair(elem, origin = 'https://rendevo.exemple.fr') {
  elem('paircode').value = portableCode(origin);
  elem('paircode').events.input();
  assert.equal(elem('connect').disabled, false);
  await elem('connect').events.click();
}

test('extension MV3 : lecture ponctuelle de l’onglet sans cookies ni permission LinkedIn permanente', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage', 'permissions']);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.background, undefined);
  const js = fs.readFileSync(extensionFile, 'utf8');
  for (const forbidden of ['document.cookie', 'chrome.cookies',
    'chrome.webRequest', 'innerHTML']) {
    assert.equal(js.includes(forbidden), false, forbidden);
  }
  assert.match(js, /chrome\.scripting\.executeScript/);
  assert.match(js, /chrome\.permissions\.contains/);
  assert.doesNotMatch(js, /chrome\.permissions\.request/);
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

async function simulatePopup(currentTabUrl, pageUrls = [], {
  grant = true, stored = {}, installedOrigin = 'https://rendevo.exemple.fr',
} = {}) {
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
  const createdTabs = [], requests = [], permissions = [], executions = [], storage = { ...stored };
  const context = {
    document: { getElementById: elem, createElement: () => ({ value: '', textContent: '' }) },
    chrome: {
      runtime: { getManifest: () => ({ version: '0.2.27' }) },
      permissions: { contains: async (x) => { permissions.push(x); return grant; } },
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
        '/api/companion/status': { connected: true, workspace: 'Mon espace', rendevo_version: '0.2.27' },
        '/api/companion/campaigns': { items: [{ id: 'campaign-1', name: 'Campagne test', search_keywords: 'Directeur commercial SaaS Paris' }] },
        '/api/companion/prospects': { created: 1, duplicates: 0, invalid: 0 },
        '/api/companion/prospects/batch': { created: 2, duplicates: 0, invalid: 0, submitted: 2, repeated_in_list: 1 },
      }[pathname];
      if (!response) throw Error('Unexpected call ' + pathname);
      return { ok: true, status: 200, json: async () => response };
    },
  };
  const popup = fs.readFileSync(extensionFile, 'utf8')
    .replace("const installedRendevoOrigin = '';", 'const installedRendevoOrigin = ' + JSON.stringify(installedOrigin) + ';');
  vm.runInNewContext(popup, context, { filename: 'popup.js' });
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
  return { elem, storage, createdTabs, requests, permissions, executions };
}

test('l’extension échange directement le code, lit les campagnes, importe uniquement sur clic', async () => {
  const { elem, storage, createdTabs, requests, permissions } = await simulatePopup('https://www.linkedin.com/in/camille/?trk=tracking');
  assert.equal(elem('import').disabled, true);
  assert.equal(storage.rendevoOrigin, undefined);
  assert.equal(permissions.length, 0);
  assert.equal(requests.length, 0);
  assert.equal(elem('pairing').hidden, false);
  assert.equal(elem('connected').hidden, true);
  assert.equal(elem('pairError').hidden, true);
  assert.equal(elem('status').hidden, true);
  await pair(elem);
  assert.equal(storage.rendevoOrigin, 'https://rendevo.exemple.fr');
  assert.equal(permissions.length, 1);
  assert.deepEqual(Array.from(permissions[0].origins), ['https://rendevo.exemple.fr/*']);
  assert.equal(createdTabs.length, 0);
  assert.equal(JSON.parse(requests[0].options.body).code, secret);
  assert.equal(requests[0].options.body.includes('RDV1.'), false);
  assert.ok(storage.companionToken);
  assert.equal(elem('connected').hidden, false);
  assert.equal(elem('workspace').textContent, 'Mon espace');
  assert.equal(elem('rendevoVersion').textContent, 'v0.2.27');
  assert.equal(elem('companionVersion').textContent, 'Companion v0.2.27');
  assert.equal(elem('campaign').options.length, 2);
  assert.equal(requests.length, 3); // exchange + status + campaigns; no upload yet
  elem('campaign').value = 'campaign-1';
  await elem('import').events.click();
  assert.equal(requests.length, 4);
  assert.equal(requests[3].url, 'https://rendevo.exemple.fr/api/companion/prospects');
  assert.equal(requests[3].options.method, 'POST');
  assert.equal(requests[3].options.credentials, 'omit');
  assert.equal(requests[3].options.headers['X-Companion-Version'], '0.2.27');
  assert.equal(JSON.parse(requests[0].options.body).version, '0.2.27');
  assert.equal(requests[3].options.headers.Authorization, 'Bearer ' + storage.companionToken);
  const sent = JSON.parse(requests[3].options.body);
  assert.equal(sent.campaign_id, 'campaign-1');
  assert.equal(sent.linkedin_url, 'https://www.linkedin.com/in/camille/');
  assert.equal(createdTabs.length, 0);
});

test('l’extension bloque les codes invalides, origines non conformes et faux profils LinkedIn', async () => {
  const { elem, storage, requests, createdTabs, permissions } = await simulatePopup('https://linkedin.com.attacker.example/in/camille/');
  const invalid = [
    'some-code', secret, 'RDV1.https://rendevo.exemple.fr.' + secret,
    portableCode('https://un-autre-serveur.example.fr'),
    portableCode('https://rendevo.exemple.fr/path'),
    portableCode('http://public.example.com'),
    portableCode('https://user:pass@rendevo.exemple.fr'),
    portableCode('https://rendevo.exemple.fr?query=secret'),
    'RDV1.%XX.' + secret,
    'RDV1.' + encodeURIComponent('https://rendevo.exemple.fr') + '.BAD',
  ];
  for (const candidate of invalid) {
    elem('paircode').value = candidate;
    elem('paircode').events.input();
    assert.equal(elem('connect').disabled, true, candidate);
    await elem('connect').events.click();
  }
  assert.equal(storage.rendevoOrigin, undefined);
  assert.equal(permissions.length, 0);
  assert.equal(requests.length, 0);
  await pair(elem);
  assert.equal(elem('import').disabled, true);
  assert.equal(requests.filter((r) => r.url.includes('/prospects')).length, 0);
  assert.equal(createdTabs.length, 0);
});

test('un accès au site révoqué dans Chrome ne transmet aucun code et ne conserve aucune origine', async () => {
  const { elem, requests, permissions, storage } =
    await simulatePopup('https://www.linkedin.com/feed/', [], { grant: false });
  elem('paircode').value = portableCode();
  elem('paircode').events.input();
  await elem('connect').events.click();
  assert.equal(permissions.length, 1);
  assert.equal(requests.length, 0);
  assert.equal(storage.companionToken, undefined);
  assert.equal(storage.rendevoOrigin, undefined);
  assert.equal(elem('connected').hidden, true);
});

test('l’interface Rendevo propose une association directe et la révocation', () => {
  const settings = fs.readFileSync(new URL('../web/src/pages/Settings.jsx', import.meta.url), 'utf8');
  const component = fs.readFileSync(new URL('../web/src/components/CompanionSettings.jsx', import.meta.url), 'utf8');
  assert.match(settings, /CompanionSettings/);
  assert.match(component, /api\/companion\/pairings/);
  assert.match(component, /api\/companion\/devices/);
  assert.match(component, /Générer un code d'association/);
  assert.match(component, /RDV1\./);
  assert.match(component, /Copier le code unique/);
  assert.match(component, /Télécharger Companion pour mon serveur/);
  const html = fs.readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  assert.match(html, /id="paircode"/);
  assert.doesNotMatch(html, /id="base"|id="save"/);
  assert.match(component, /Révoquer/);
});

test('recherche native LinkedIn lancée sur clic avec la cible fournie par Rendevo, sans scraping', async () => {
  const { elem, requests, createdTabs } = await simulatePopup('https://www.linkedin.com/feed/');
  assert.equal(elem('searchLinkedin').disabled, true);
  await pair(elem);
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
  assert.match(web, /sans moteur web externe/);
  assert.match(popup, /id="searchLinkedin"/);
  assert.match(popup, /id="searchterms"/);
  assert.match(fs.readFileSync(extensionFile, 'utf8'), /chrome\.scripting\.executeScript/);
  assert.doesNotMatch(fs.readFileSync(extensionFile, 'utf8'), /chrome\.cookies|fetch\(['"]https:\/\/www\.linkedin\.com/);
});

test('Companion : coller, prévisualiser puis importer un lot sans lire l’onglet LinkedIn', async () => {
  const { elem, requests, createdTabs } = await simulatePopup('https://www.linkedin.com/search/results/people/?keywords=directeur');
  await pair(elem);
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
  await pair(elem);
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
  await pair(elem);
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
  await pair(elem);
  assert.equal(elem('readLinkedinPage').disabled, true);
  assert.equal(executions.length, 0);
  assert.equal(requests.filter((r) => r.url.includes('/prospects')).length, 0);

  const page = await simulatePopup('https://www.linkedin.com/search/results/people/', [
    'https://www.linkedin.com/in/alice/',
  ]);
  await pair(page.elem);
  await page.elem('readLinkedinPage').events.click();
  assert.equal(page.elem('submitBulk').disabled, false);
  page.elem('bulkUrls').value += '\nhttps://www.linkedin.com/in/bob/';
  page.elem('bulkUrls').events.input();
  assert.equal(page.elem('submitBulk').disabled, true);
  assert.equal(page.requests.filter((r) => r.url.includes('/prospects')).length, 0);
});

test('une extension déjà associée reste connectée sans nouvelle saisie ni permission', async () => {
  const { elem, requests, permissions, storage } = await simulatePopup(
    'https://www.linkedin.com/feed/', [], {
      stored: { rendevoOrigin: 'https://rendevo.exemple.fr', companionToken: 'persisted-token' },
    },
  );
  assert.equal(elem('pairing').hidden, true);
  assert.equal(elem('connected').hidden, false);
  assert.equal(elem('connectedOrigin').textContent, 'https://rendevo.exemple.fr');
  assert.equal(permissions.length, 0);
  assert.equal(requests.length, 2);
  assert.equal(storage.companionToken, 'persisted-token');
});

test('un ZIP personnalisé HTTP privé associe sur le port exact sans nouvelle permission', async () => {
  const { elem, permissions, requests, storage } = await simulatePopup(
    'https://www.linkedin.com/feed/', [], { installedOrigin: 'http://192.168.1.16:8288' },
  );
  await pair(elem, 'http://192.168.1.16:8288');
  assert.equal(permissions.length, 1);
  assert.deepEqual(Array.from(permissions[0].origins), ['http://192.168.1.16/*']);
  assert.equal(requests[0].url, 'http://192.168.1.16:8288/api/companion/exchange');
  assert.equal(storage.rendevoOrigin, 'http://192.168.1.16:8288');
});

test('le code d’une autre instance est bloqué même si un Companion est déjà installé', async () => {
  const { elem, permissions, requests } = await simulatePopup('https://www.linkedin.com/feed/');
  elem('paircode').value = portableCode('https://autre.example.fr');
  elem('paircode').events.input();
  assert.equal(elem('connect').disabled, true);
  assert.match(elem('pairError').textContent, /autre serveur/);
  await elem('connect').events.click();
  assert.equal(permissions.length, 0);
  assert.equal(requests.length, 0);
});

test('un Companion non personnalisé refuse de contacter un serveur', async () => {
  const { elem, permissions, requests } = await simulatePopup('https://www.linkedin.com/feed/', [], {
    installedOrigin: '',
  });
  elem('paircode').value = portableCode();
  elem('paircode').events.input();
  assert.equal(elem('connect').disabled, true);
  assert.match(elem('pairError').textContent, /Télécharge Companion/);
  await elem('connect').events.click();
  assert.equal(permissions.length, 0);
  assert.equal(requests.length, 0);
});

test('première association : interface épurée, sans texte technique, permission ou confidentialité', async () => {
  const popup = fs.readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  const pairingMarkup = /<section id="pairing">([\s\S]*?)<\/section>/.exec(popup)?.[1];
  assert.ok(pairingMarkup);
  assert.match(pairingMarkup, /<label for="paircode">Code d’association<\/label>/);
  assert.match(pairingMarkup, /id="paircode"/);
  assert.match(pairingMarkup, /id="connect"/);
  assert.match(pairingMarkup, /id="pairError"[^>]*hidden/);
  assert.doesNotMatch(pairingMarkup, /Serveur intégré|permissions|Seules les URLs|5 minutes/);
  assert.doesNotMatch(popup, /Serveur intégré|Extension dissociée localement|Le serveur a été déclaré dans les permissions/);
  assert.ok(popup.indexOf('Seules les URLs validées') > popup.indexOf('id="connected"'));
  assert.ok(popup.indexOf('Seules les URLs validées') < popup.indexOf('</section>', popup.indexOf('id="connected"')));
  const { elem, requests, permissions } = await simulatePopup('https://www.linkedin.com/feed/');
  assert.equal(elem('pairing').hidden, false);
  assert.equal(elem('connected').hidden, true);
  assert.equal(elem('pairError').hidden, true);
  assert.equal(elem('status').hidden, true);
  assert.equal(requests.length, 0);
  assert.equal(permissions.length, 0);
  elem('paircode').value = portableCode();
  elem('paircode').events.input();
  assert.equal(elem('pairError').hidden, true);
  assert.equal(elem('connect').disabled, false);
});

test('après dissociation : seul le formulaire réapparaît, aucun ancien message ne reste', async () => {
  const { elem, storage } = await simulatePopup('https://www.linkedin.com/feed/');
  await pair(elem);
  assert.equal(elem('connected').hidden, false);
  assert.equal(elem('status').hidden, false);
  await elem('disconnect').events.click();
  assert.equal(storage.companionToken, undefined);
  assert.equal(elem('pairing').hidden, false);
  assert.equal(elem('connected').hidden, true);
  assert.equal(elem('pairError').hidden, true);
  assert.equal(elem('status').hidden, true);
  assert.equal(elem('status').textContent, '');
  assert.equal(elem('connect').disabled, true);
});

test('première association : seules les erreurs utiles sont rendues visibles', async () => {
  const { elem } = await simulatePopup('https://www.linkedin.com/feed/');
  elem('paircode').value = 'mauvais-code';
  elem('paircode').events.input();
  assert.equal(elem('pairError').hidden, false);
  assert.match(elem('pairError').textContent, /Code invalide/);
  elem('paircode').value = portableCode('https://autre.example.fr');
  elem('paircode').events.input();
  assert.equal(elem('pairError').hidden, false);
  assert.match(elem('pairError').textContent, /autre serveur/);
  elem('paircode').value = '';
  elem('paircode').events.input();
  assert.equal(elem('pairError').hidden, true);
});
