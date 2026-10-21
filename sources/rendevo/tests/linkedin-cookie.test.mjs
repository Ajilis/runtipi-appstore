import { test } from 'node:test';
import assert from 'node:assert/strict';
import linkedinCookie, { normalizeLinkedinCookies, LINKEDIN_USER_AGENT, classifyLinkedinTransportError } from '../server/services/providers/linkedin-cookie.js';

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
      assert.equal(opts.redirect, 'manual');
      assert.equal(opts.headers['csrf-token'], 'ajax:1234567890');
      assert.equal(opts.headers['user-agent'], LINKEDIN_USER_AGENT);
      assert.match(opts.headers['user-agent'], /^Mozilla\/5\.0 \(Macintosh; Intel Mac OS X 10_15_7\).*Chrome\/143\.0\.0\.0 Safari\/537\.36$/);
      assert.notEqual(opts.headers['user-agent'], 'Mozilla/5.0');
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

test('redirige sans suivre ni divulguer la cible ou les cookies', async () => {
  const account = { config: valid };
  for (const status of [301, 302, 303, 307, 308]) {
    let count = 0;
    const result = await linkedinCookie.test(account, { fetcher: async (_url, options) => {
      count++;
      assert.equal(options.redirect, 'manual');
      return new Response('do not read me', {
        status,
        headers: {
          location: 'https://example.invalid/unsafe?li_at=private-token',
          'set-cookie': 'JSESSIONID=private-token',
        },
      });
    } });
    assert.equal(count, 1, 'one request only');
    assert.equal(result.ok, false);
    assert.equal(result.error_code, 'redirect_detected');
    assert.equal(result.http_status, status);
    assert.doesNotMatch(JSON.stringify(result), /example\\.invalid|private-token|JSESSIONID|li_at/);
  }
});

test('distingue DNS TLS réseau coupé et dépassement de délai sans détails sensibles', () => {
  const cases = [
    ['ENOTFOUND', 'dns_error'],
    ['EAI_AGAIN', 'dns_error'],
    ['CERT_HAS_EXPIRED', 'tls_error'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_error'],
    ['EPROTO', 'tls_error'],
    ['ECONNRESET', 'connection_error'],
    ['ECONNREFUSED', 'connection_error'],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
    ['ETIMEDOUT', 'timeout'],
    ['unknown-error', 'network_error'],
  ];
  for (const [code, expected] of cases) {
    const err = new TypeError('Secret upstream URL and cookie');
    err.cause = Object.assign(new Error('Secret cookie information'), { code });
    const classified = classifyLinkedinTransportError(err);
    assert.equal(classified.error_code, expected, code);
    assert.doesNotMatch(JSON.stringify(classified), /Secret|cookie information|upstream URL/);
  }
  assert.equal(classifyLinkedinTransportError(new Error('abort'), true).error_code, 'timeout');
});
