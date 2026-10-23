import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { companionOriginAndPermission, personalizedManifest, personalizedPopup } from '../server/lib/companion-bundle.js';
import { Router } from '../server/lib/http.js';
import { sha256 } from '../server/lib/crypto.js';
import { registerCompanion, normalizeCompanionProfile, normalizeCompanionVersion, companionSearchTerms } from '../server/routes/companion.js';

function harness() {
  let pairing = null, device = null;
  const saved = [];
  const scope = { wsId: 'ws-test', userId: 'user-test' };
  const db = { async query(sql, params = []) {
    const q = sql.trim();
    if (q.startsWith('DELETE FROM companion_pairings WHERE expires_at')) {
      pairing = null; return { rows: [] };
    }
    if (q.startsWith('INSERT INTO companion_pairings')) {
      pairing = { hash: params[0], wsId: params[1], userId: params[2] };
      return { rows: [] };
    }
    if (q.startsWith('DELETE FROM companion_pairings WHERE code_hash')) {
      if (!pairing || pairing.hash !== params[0]) return { rows: [] };
      const old = pairing; pairing = null;
      return { rows: [{ workspace_id: old.wsId, user_id: old.userId }] };
    }
    if (q.startsWith('INSERT INTO companion_devices')) {
      device = { id: 'device-1', workspace_id: params[0], user_id: params[1],
        name: params[2], token_hash: params[3], revoked: false, extension_version: params[5] || null,
        expires_at: '2030-01-01T00:00:00Z' };
      return { rows: [{ id: device.id, expires_at: device.expires_at }] };
    }
    if (q.startsWith('UPDATE companion_devices d SET last_used_at')) {
      if (!device || device.revoked || device.token_hash !== params[0]) return { rows: [] };
      if (params[1]) device.extension_version = params[1];
      return { rows: [{ id: device.id, workspace_id: device.workspace_id,
        user_id: device.user_id, expires_at: device.expires_at }] };
    }
    if (q.startsWith('SELECT c.id, c.name, c.icp FROM campaigns')) {
      return { rows: [{ id: 'campaign-1', name: 'Campagne Companion', icp: { titles: ['Directeur commercial'], industries: ['SaaS'], locations: ['Paris'] } }] };
    }
    if (q.startsWith('SELECT 1 FROM campaigns c JOIN accounts')) {
      return { rows: params[0] === 'campaign-1' && params[1] === scope.wsId ? [{ '?column?': 1 }] : [] };
    }
    if (q.startsWith('SELECT id, name, prefix, created_at')) return { rows: device && !device.revoked ? [{ id: device.id, name: device.name, extension_version: device.extension_version }] : [] };
    if (q.startsWith('UPDATE companion_devices SET revoked_at')) {
      if (device && params[0] === device.id && params[1] === scope.wsId
        && params[2] === scope.userId && !device.revoked) {
        device.revoked = true; return { rows: [{ id: device.id }] };
      }
      return { rows: [] };
    }
    throw new Error('Unknown SQL: ' + q);
  } };
  const agent = {
    workspace: async (id) => ({ id, name: 'Mon espace' }),
    importProspects: async (ws, items, options) => {
      saved.push({ ws, items, options });
      return { created: 1, duplicates: 0, invalid: 0 };
    },
  };
  const router = new Router();
  registerCompanion(router, { db, agent }, {
    requireAuth: async () => {}, requireAdmin: async () => {},
  });
  async function request(method, path, { body = {}, token = '', version = '' } = {}) {
    const matched = router.match(method, path);
    assert.ok(matched, 'route exists: ' + path);
    const ctx = {
      req: { headers: { authorization: token ? 'Bearer ' + token : '', 'x-companion-version': version } },
      state: { ws: { id: scope.wsId }, user: { id: scope.userId } },
      params: matched.params,
      json: async () => body,
      header: () => {},
    };
    let result;
    for (const action of matched.route.handlers) result = await action(ctx);
    return result;
  }
  return { request, saved, getDevice: () => device, getPairing: () => pairing };
}

test('l’association produit un code aléatoire à usage unique, seul le hash est stocké', async () => {
  const h = harness();
  const { code } = await h.request('POST', '/api/companion/pairings');
  assert.match(code, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(h.getPairing().hash, sha256(code));
  assert.notEqual(h.getPairing().hash, code);
  await assert.rejects(
    () => h.request('POST', '/api/companion/exchange', { body: { code: '0'.repeat(32) } }),
    /expiré|déjà utilisé/,
  );
  const first = await h.request('POST', '/api/companion/exchange', { body: { code } });
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(h.getDevice().token_hash, sha256(first.token));
  await assert.rejects(
    () => h.request('POST', '/api/companion/exchange', { body: { code } }),
    /expiré|déjà utilisé/,
  );
});

test('l’extension lit ses campagnes et importe directement uniquement dans son espace', async () => {
  const h = harness();
  const pair = await h.request('POST', '/api/companion/pairings');
  const { token } = await h.request('POST', '/api/companion/exchange', { body: { code: pair.code } });
  await assert.rejects(() => h.request('GET', '/api/companion/campaigns'), /Associez/);
  const campaigns = await h.request('GET', '/api/companion/campaigns', { token });
  assert.deepEqual(campaigns.items, [{ id: 'campaign-1', name: 'Campagne Companion', search_keywords: 'Directeur commercial SaaS Paris' }]);
  await assert.rejects(() => h.request('POST', '/api/companion/prospects',
    { token, body: { linkedin_url: 'https://evil.test/in/me/' } }), /LinkedIn valide/);
  await assert.rejects(() => h.request('POST', '/api/companion/prospects',
    { token, body: { linkedin_url: 'https://www.linkedin.com/in/moi/', campaign_id: 'autre-espace' } }),
  /Cette campagne/);
  assert.equal(h.saved.length, 0);
  const result = await h.request('POST', '/api/companion/prospects',
    { token, body: { linkedin_url: 'https://www.linkedin.com/in/moi/?tracking=x',
      campaign_id: 'campaign-1' } });
  assert.deepEqual(result, { created: 1, duplicates: 0, invalid: 0 });
  assert.equal(h.saved[0].ws.id, 'ws-test');
  assert.deepEqual(h.saved[0].items, [{ linkedin_url: 'https://www.linkedin.com/in/moi/', source: 'companion' }]);
  assert.deepEqual(h.saved[0].options, { campaignId: 'campaign-1', source: 'companion' });
});

test('révoquer un périphérique invalide immédiatement son jeton', async () => {
  const h = harness();
  const pair = await h.request('POST', '/api/companion/pairings');
  const { token } = await h.request('POST', '/api/companion/exchange', { body: { code: pair.code } });
  assert.equal((await h.request('GET', '/api/companion/status', { token })).connected, true);
  assert.deepEqual(await h.request('DELETE', '/api/companion/devices/device-1'), { ok: true });
  await assert.rejects(() => h.request('GET', '/api/companion/status', { token }), /révoquée/);
});

test('ne conserve ni paramètres de tracking ni fausses URLs LinkedIn', () => {
  assert.equal(normalizeCompanionProfile('https://linkedin.com/in/perso/?trk=tracking'),
    'https://www.linkedin.com/in/perso/');
  for (const url of ['https://linkedin.com.evil.com/in/test/', 'http://linkedin.com/in/test',
    'https://www.linkedin.com/feed/', 'https://www.linkedin.com/in/user/a',
    'https://me:password@linkedin.com/in/nom/']) {
    assert.equal(normalizeCompanionProfile(url), null, url);
  }
});

test('le serveur livre un ZIP Chrome personnalisé, protégé et sans permission générale', async () => {
  const router = new Router();
  let checked = false;
  const configuredOrigin = 'https://rdv.exemple.fr';
  registerCompanion(router, {
    db: {}, agent: {}, config: { staticDir: '/app/web/dist', publicUrl: configuredOrigin },
  }, {
    requireAuth: async () => { checked = true; },
    requireAdmin: async () => {},
  });
  const matched = router.match('GET', '/api/companion/download');
  assert.ok(matched);
  assert.equal(matched.route.handlers.length, 2);
  const called = [];
  let downloadedZip;
  const ctx = {
    header: (key, value) => called.push({ key, value }),
    sendFile: async (file, options) => {
      downloadedZip = file;
      assert.equal(fs.existsSync(file), true);
      assert.equal(options.cache, 'no-store');
      assert.equal(options.download, 'Rendevo-Companion-V36.zip');
      const entries = execFileSync('unzip', ['-Z', '-1', file], { encoding: 'utf8' }).trim().split('\n').sort();
      assert.deepEqual(entries, ['README.md', 'manifest.json', 'popup.css', 'popup.html', 'popup.js']);
      const manifest = JSON.parse(execFileSync('unzip', ['-p', file, 'manifest.json'], { encoding: 'utf8' }));
      assert.deepEqual(manifest.host_permissions, ['https://rdv.exemple.fr/*']);
      assert.equal(manifest.optional_host_permissions, undefined);
      assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage', 'permissions']);
      assert.equal(manifest.version, '0.2.25');
      const script = execFileSync('unzip', ['-p', file, 'popup.js'], { encoding: 'utf8' });
      assert.match(script, /const installedRendevoOrigin = 'https:\/\/rdv\.exemple\.fr'|const installedRendevoOrigin = "https:\/\/rdv\.exemple\.fr"/);
      assert.doesNotMatch(script, /chrome\.permissions\.request/);
    },
  };
  for (const handler of matched.route.handlers) await handler(ctx);
  assert.equal(checked, true);
  assert.ok(called.some((x) => x.key === 'Cache-Control' && x.value === 'no-store'));
  assert.equal(fs.existsSync(downloadedZip), false, 'ZIP temporaire supprimé après réponse');
  assert.equal(downloadedZip.startsWith('/app/web/dist'), false, 'ZIP absent du répertoire public');
  const ui = fs.readFileSync(new URL('../web/src/components/CompanionSettings.jsx', import.meta.url), 'utf8');
  assert.match(ui, /href="\/api\/companion\/download"/);
  assert.match(ui, /download="Rendevo-Companion-V36\.zip"/);
  const docker = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(docker, /COPY extension \.\/extension/);
  assert.match(docker, /tzdata zip/);
  assert.doesNotMatch(docker, /COPY --from=companion-package/);
});

test('la génération d’une extension refuse URL hostile et permission globale', () => {
  assert.deepEqual(companionOriginAndPermission('https://rdv.exemple.fr:8443'), {
    origin: 'https://rdv.exemple.fr:8443',
    permission: 'https://rdv.exemple.fr/*',
  });
  assert.deepEqual(companionOriginAndPermission('http://192.168.1.16:8288'), {
    origin: 'http://192.168.1.16:8288',
    permission: 'http://192.168.1.16/*',
  });
  for (const invalid of [
    '', 'http://public.example.com', 'https://foo.example.com/path',
    'https://foo.example.com?origin=evil', 'https://foo.example.com#x',
    'https://user:password@rdv.example.com', 'https://*.example.com',
    'https://bad.example.com.evil.test/other', 'javascript:alert(1)',
    'http://8.8.8.8:8288', 'http://192.168.300.1:8288',
  ]) {
    if (invalid === 'https://bad.example.com.evil.test/other') {
      assert.throws(() => companionOriginAndPermission(invalid));
    } else assert.throws(() => companionOriginAndPermission(invalid), invalid);
  }
  const manifest = personalizedManifest({
    manifest_version: 3,
    optional_host_permissions: ['https://*/*', 'http://*/*'],
  }, 'https://rdv.exemple.fr');
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.deepEqual(manifest.host_permissions, ['https://rdv.exemple.fr/*']);
  assert.equal(personalizedPopup("const installedRendevoOrigin = '';", 'http://10.0.0.2:8288'),
    'const installedRendevoOrigin = "http://10.0.0.2:8288";');
});

test('les campagnes fournissent uniquement des mots-clés de ciblage pour la recherche manuelle', () => {
  assert.equal(companionSearchTerms({
    titles: ['Directeur marketing'], industries: ['Logiciel B2B'], locations: ['Paris'],
    keywords: ['prospection'], exclusions: ['SECRET'], excluded_companies: ['ACME'],
  }), 'Directeur marketing Logiciel B2B Paris prospection');
  assert.equal(companionSearchTerms({}), '');
  assert.equal(companionSearchTerms(null), '');
  assert.equal(companionSearchTerms({ titles: ['X'.repeat(500)] }).length, 70);
});

test('import groupé : n’enregistre que les URLs soumises, vérifiées et dédoublonnées', async () => {
  const h = harness();
  const pair = await h.request('POST', '/api/companion/pairings');
  const { token } = await h.request('POST', '/api/companion/exchange', { body: { code: pair.code } });
  const link = 'https://www.linkedin.com/in/camille/?trk=search';
  const result = await h.request('POST', '/api/companion/prospects/batch', { token, body: {
    campaign_id: 'campaign-1',
    items: [
      { linkedin_url: link }, { linkedin_url: 'https://linkedin.com/in/camille/' },
      { linkedin_url: 'https://www.linkedin.com/in/autre-profil/' },
    ],
  } });
  assert.equal(result.submitted, 2);
  assert.equal(result.repeated_in_list, 1);
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].items.length, 2);
  assert.equal(h.saved[0].items[0].linkedin_url, 'https://www.linkedin.com/in/camille/');
  assert.equal(h.saved[0].items[1].source, 'companion_manual_list');
  assert.deepEqual(h.saved[0].options, { campaignId: 'campaign-1', source: 'companion_manual_list' });
});

test('import groupé : refus de profils malformés, faux domaines et campagnes non autorisées', async () => {
  const h = harness();
  const pair = await h.request('POST', '/api/companion/pairings');
  const { token } = await h.request('POST', '/api/companion/exchange', { body: { code: pair.code } });
  const valid = [{ linkedin_url: 'https://linkedin.com/in/profil/' }];
  await assert.rejects(
    () => h.request('POST', '/api/companion/prospects/batch', { body: { items: valid } }),
    /Associez de nouveau/,
  );
  for (const items of [[], new Array(101).fill(valid[0]), [
    valid[0], { linkedin_url: 'https://linkedin.com.evil.test/in/intrus/' },
  ], [{ linkedin_url: 'http://linkedin.com/in/profil/' }]]) {
    await assert.rejects(
      () => h.request('POST', '/api/companion/prospects/batch', { token, body: { items } }),
      /1 et 100|profils LinkedIn/,
    );
  }
  await assert.rejects(
    () => h.request('POST', '/api/companion/prospects/batch', {
      token, body: { items: valid, campaign_id: 'autre-espace' },
    }), /Cette campagne/,
  );
  assert.equal(h.saved.length, 0);
});


test('Companion conserve la version annoncée sur association et mise à jour sans réassociation', async () => {
  const h = harness();
  const { code } = await h.request('POST', '/api/companion/pairings');
  const { token } = await h.request('POST', '/api/companion/exchange', { body: {
    code, version: '0.2.9',
  } });
  assert.equal(h.getDevice().extension_version, '0.2.9');
  await h.request('GET', '/api/companion/status', { token, version: '0.2.10' });
  assert.equal(h.getDevice().extension_version, '0.2.10');
  const devices = await h.request('GET', '/api/companion/devices');
  assert.equal(devices.items[0].extension_version, '0.2.10');
  await h.request('GET', '/api/companion/status', { token, version: '<script>alert(1)</script>' });
  assert.equal(h.getDevice().extension_version, '0.2.10');
});

test('Companion ancien : version inconnue sans perturber la session', async () => {
  const h = harness();
  const { code } = await h.request('POST', '/api/companion/pairings');
  const { token } = await h.request('POST', '/api/companion/exchange', { body: { code } });
  assert.equal(h.getDevice().extension_version, null);
  assert.equal((await h.request('GET', '/api/companion/status', { token })).connected, true);
  assert.equal(normalizeCompanionVersion(' 0.2.10 '), '0.2.10');
  for (const invalid of ['unknown', '0.2', 'a.b.c', '<svg>', '1.2.3\ninjection']) {
    assert.equal(normalizeCompanionVersion(invalid), null);
  }
});
