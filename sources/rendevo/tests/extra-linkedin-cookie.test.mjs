import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Router } from '../server/lib/http.js';
import { makeVault } from '../server/lib/crypto.js';
import { registerCore } from '../server/routes/core.js';
import linkedinCookie from '../server/services/providers/linkedin-cookie.js';

const creds = {
  li_at: 'AQED0000000000000000000000',
  jsessionid: 'ajax:1234567890',
};

function setup() {
  let saved = null;
  const vault = makeVault('un-secret-de-test');
  const db = { async query(sql, params) {
    if (sql.startsWith('INSERT INTO accounts')) {
      saved = { id: 'account1', workspace_id: 'workspace1', name: params[1], provider: params[2],
        account_type: params[3], config: JSON.parse(params[4]), status: params[5],
        status_detail: params[6] };
      return { rows: [saved] };
    }
    if (sql.startsWith('SELECT * FROM accounts WHERE id')) {
      return { rows: saved && params[0] === saved.id ? [saved] : [] };
    }
    if (sql.startsWith('UPDATE accounts SET name = $2')) {
      saved = { ...saved, name: params[1], account_type: params[2],
        config: JSON.parse(params[3]), status: params[4] };
      return { rows: [saved] };
    }
    throw new Error('Unexpected SQL: ' + sql);
  } };
  const router = new Router();
  registerCore(router, { db, vault, agent: {}, config: {} }, {
    requireAuth: async () => {},
    requireAdmin: async () => {},
  });
  const invoke = (method, url, body) => {
    const matched = router.match(method, url);
    assert.ok(matched);
    const action = matched.route.handlers.at(-1);
    return action({ json: async () => body,
      state: { ws: { id: 'workspace1' } },
      params: matched.params,
    });
  };
  return { vault, invoke, getSaved: () => saved };
}

test('champ TEST initial et valeur vide facultative : pas de secret ajouté', async () => {
  const { invoke, getSaved } = setup();
  const account = await invoke('POST', '/api/accounts', { provider: 'linkedin_cookie',
    name: 'Mon LinkedIn', config: { ...creds, extra_cookie_name: 'TEST', extra_cookie_value: '' } });
  assert.equal(account.config.extra_cookie_name, 'TEST');
  assert.equal(account.config.has_extra_cookie, false);
  assert.equal(getSaved().config.extra_cookie_value_enc, undefined);
});

test('le cookie supplémentaire est chiffré et jamais exposé dans la réponse API', async () => {
  const { invoke, getSaved, vault } = setup();
  const secret = 'v=2&opaque-test-value';
  const account = await invoke('POST', '/api/accounts', { provider: 'linkedin_cookie',
    config: { ...creds, extra_cookie_name: 'Cookie_perso', extra_cookie_value: secret } });
  assert.equal(account.config.extra_cookie_name, 'Cookie_perso');
  assert.equal(account.config.has_extra_cookie, true);
  assert.doesNotMatch(JSON.stringify(account), /opaque-test-value|extra_cookie_value_enc/);
  assert.equal(vault.decrypt(getSaved().config.extra_cookie_value_enc), secret);
  assert.equal(getSaved().config.extra_cookie_value, undefined);
});

test('modification du nom, conservation de la valeur vide et suppression explicite', async () => {
  const { invoke, getSaved, vault } = setup();
  await invoke('POST', '/api/accounts', { provider: 'linkedin_cookie',
    config: { ...creds, extra_cookie_name: 'TEST', extra_cookie_value: 'original-secret' } });
  const retained = await invoke('PATCH', '/api/accounts/account1', {
    name: 'Mon LinkedIn', config: { extra_cookie_name: 'Autre_cookie', extra_cookie_value: '' },
  });
  assert.equal(retained.config.extra_cookie_name, 'Autre_cookie');
  assert.equal(retained.config.has_extra_cookie, true);
  assert.equal(vault.decrypt(getSaved().config.extra_cookie_value_enc), 'original-secret');
  const cleared = await invoke('PATCH', '/api/accounts/account1', {
    name: 'Mon LinkedIn', config: { clear_extra_cookie: true },
  });
  assert.equal(cleared.config.has_extra_cookie, false);
  assert.equal(getSaved().config.extra_cookie_value_enc, undefined);
  assert.equal(getSaved().config.clear_extra_cookie, undefined);
});

test('refuse les noms réservés, les séparateurs et les caractères de contrôle', async () => {
  const { invoke } = setup();
  for (const extra of [
    { extra_cookie_name: 'li_at', extra_cookie_value: 'secret' },
    { extra_cookie_name: 'JSESSIONID', extra_cookie_value: 'secret' },
    { extra_cookie_name: 'TEST; OTHER', extra_cookie_value: 'secret' },
    { extra_cookie_name: 'TEST', extra_cookie_value: 'data; Path=/' },
    { extra_cookie_name: 'TEST', extra_cookie_value: 'a\r\nSet-Cookie: forged' },
    { extra_cookie_name: 'TEST', extra_cookie_value: 'A'.repeat(4100) },
  ]) {
    await assert.rejects(
      () => invoke('POST', '/api/accounts', { provider: 'linkedin_cookie',
        config: { ...creds, ...extra } }),
      /cookie supplémentaire invalide|cookie supplémentaire invalide ou réservé/i,
    );
  }
});

test('le cookie supplémentaire ne participe pas au test LinkedIn ni aux appels sortants', async () => {
  let calls = 0;
  const response = await linkedinCookie.test({ config: { ...creds,
    extra_cookie_name: 'TEST', extra_cookie_value: 'another-secret' } }, {
    fetcher: async (_url, req) => {
      calls++;
      assert.doesNotMatch(req.headers.Cookie, /another-secret|TEST=/);
      return new Response(JSON.stringify({ data: { publicIdentifier: 'moi' } }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(response.ok, true);
});

test('interface : valeur initiale vide, nom TEST modifiable et suppression disponible', () => {
  const ui = fs.readFileSync(new URL('../web/src/components/AccountForm.jsx', import.meta.url), 'utf8');
  assert.match(ui, /extra_cookie_name \?\? 'TEST'/);
  assert.match(ui, /extra_cookie_value \|\| ''/);
  assert.match(ui, /type="password"/);
  assert.match(ui, /clear_extra_cookie/);
  assert.match(ui, /Il n'est pas envoyé à LinkedIn/);
});
