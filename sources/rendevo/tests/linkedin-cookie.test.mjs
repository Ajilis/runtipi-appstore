import { test } from 'node:test';
import assert from 'node:assert/strict';
import linkedinCookie, { normalizeLinkedinCookies } from '../server/services/providers/linkedin-cookie.js';

const valid = {
  li_at: 'AQED0000000000000000000000',
  jsessionid: '"ajax:1234567890"',
};

test('normalise les cookies sans recopier les guillemets dans csrf-token', () => {
  assert.deepEqual(normalizeLinkedinCookies(valid.li_at, valid.jsessionid), {
    liAt: valid.li_at, jsession: 'ajax:1234567890',
  });
  assert.throws(() => normalizeLinkedinCookies('', valid.jsessionid), /li_at/);
  assert.throws(() => normalizeLinkedinCookies(valid.li_at, 'bad; Path=/'), /JSESSIONID/);
});

test('le test de session n’envoie les identifiants qu’à www.linkedin.com et n’écrit aucun message', async () => {
  let calls = 0;
  const result = await linkedinCookie.test({ config: valid }, {
    fetcher: async (url, opts) => {
      calls++;
      assert.equal(url, 'https://www.linkedin.com/voyager/api/me');
      assert.equal(opts.method, 'GET');
      assert.equal(opts.redirect, 'error');
      assert.equal(opts.headers['csrf-token'], 'ajax:1234567890');
      assert.match(opts.headers.Cookie, /^li_at=/);
      assert.ok(!opts.body);
      return new Response(JSON.stringify({ data: { publicIdentifier: 'example' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
});

test('refuse les erreurs de session et les réponses HTML de connexion', async () => {
  const account = { config: valid };
  const restricted = await linkedinCookie.test(account, {
    fetcher: async () => new Response('', { status: 403 }),
  });
  assert.equal(restricted.ok, false);
  const html = await linkedinCookie.test(account, {
    fetcher: async () => new Response('<html>Login</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
  });
  assert.equal(html.ok, false);
});
