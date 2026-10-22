import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Router } from '../server/lib/http.js';
import { sha256 } from '../server/lib/crypto.js';
import { registerCompanion, normalizeCompanionProfile } from '../server/routes/companion.js';

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
        name: params[2], token_hash: params[3], revoked: false,
        expires_at: '2030-01-01T00:00:00Z' };
      return { rows: [{ id: device.id, expires_at: device.expires_at }] };
    }
    if (q.startsWith('UPDATE companion_devices d SET last_used_at')) {
      if (!device || device.revoked || device.token_hash !== params[0]) return { rows: [] };
      return { rows: [{ id: device.id, workspace_id: device.workspace_id,
        user_id: device.user_id, expires_at: device.expires_at }] };
    }
    if (q.startsWith('SELECT c.id, c.name FROM campaigns')) {
      return { rows: [{ id: 'campaign-1', name: 'Campagne Companion' }] };
    }
    if (q.startsWith('SELECT 1 FROM campaigns c JOIN accounts')) {
      return { rows: params[0] === 'campaign-1' && params[1] === scope.wsId ? [{ '?column?': 1 }] : [] };
    }
    if (q.startsWith('SELECT id, name, prefix, created_at')) return { rows: [] };
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
  async function request(method, path, { body = {}, token = '' } = {}) {
    const matched = router.match(method, path);
    assert.ok(matched, 'route exists: ' + path);
    const ctx = {
      req: { headers: { authorization: token ? 'Bearer ' + token : '' } },
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
  assert.deepEqual(campaigns.items, [{ id: 'campaign-1', name: 'Campagne Companion' }]);
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

test('le bouton télécharge un vrai ZIP depuis Rendevo, sous contrôle d’accès', async () => {
  const router = new Router();
  let checked = false;
  registerCompanion(router, { db: {}, agent: {}, config: { staticDir: '/app/web/dist' } }, {
    requireAuth: async () => { checked = true; },
    requireAdmin: async () => {},
  });
  const matched = router.match('GET', '/api/companion/download');
  assert.ok(matched);
  assert.equal(matched.route.handlers.length, 2);
  const called = [];
  const ctx = {
    header: (key, value) => called.push({ key, value }),
    sendFile: async (file, options) => called.push({ file, options }),
  };
  for (const handler of matched.route.handlers) await handler(ctx);
  assert.equal(checked, true);
  assert.ok(called.some((x) => x.key === 'Cache-Control' && x.value === 'no-store'));
  assert.ok(called.some((x) => x.file === '/app/web/dist/Rendevo-Companion.zip'
    && x.options.download === 'Rendevo-Companion-V16.zip'));
  const ui = fs.readFileSync(new URL('../web/src/components/CompanionSettings.jsx', import.meta.url), 'utf8');
  assert.match(ui, /href="\/api\/companion\/download"/);
  assert.match(ui, /download="Rendevo-Companion-V16\.zip"/);
  assert.doesNotMatch(ui, /Télécharger Companion \(GitHub Actions\)/);
  const docker = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(docker, /COPY extension \/extension/);
  assert.match(docker, /zip -q -j \/Rendevo-Companion\.zip/);
  assert.match(docker, /COPY --from=companion-package \/Rendevo-Companion\.zip \.\/web\/dist\/Rendevo-Companion\.zip/);
});
