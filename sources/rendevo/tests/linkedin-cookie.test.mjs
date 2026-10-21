import { test } from 'node:test';
import assert from 'node:assert/strict';
import linkedinCookie, { normalizeLinkedinCookies, LINKEDIN_USER_AGENT, classifyLinkedinTransportError, classifyLinkedinRedirect } from '../server/services/providers/linkedin-cookie.js';

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
    assert.equal(result.redirect_kind, 'external');
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

test('classifie la cible de redirection sans exposer URL, paramètres ni jetons', async () => {
  const cases = [
    ['https://www.linkedin.com/login?session_redirect=%2Ffeed&li_at=private', 'login'],
    ['/uas/login?session_redirect=%2Fvoyager&JSESSIONID=private', 'login'],
    ['https://login.linkedin.com/anything?token=secret', 'login'],
    ['https://www.linkedin.com/authwall?trk=secret', 'login'],
    ['https://www.linkedin.com/checkpoint/challenge?token=secret', 'security_check'],
    ['https://checkpoint.linkedin.com/path?token=secret', 'security_check'],
    ['/uas/checkpoint/lg/login-submit?csrfToken=secret', 'security_check'],
    ['https://www.linkedin.com/feed/?session=secret', 'linkedin_other'],
    ['https://www.linkedin.com/feed/?next=/login', 'linkedin_other'],
    ['https://linkedin.com.evil.example/login?secret=private', 'external'],
    ['https://evil.example/?token=secret', 'external'],
    ['//evil.example/checkpoint?token=secret', 'external'],
    ['http://www.linkedin.com/login?token=secret', 'external'],
    ['https://user:password@www.linkedin.com/login', 'external'],
    ['javascript:alert(1)', 'external'],
    [null, 'unknown'],
    ['', 'unknown'],
    ['x'.repeat(2049), 'unknown'],
  ];
  for (const [location, expected] of cases) {
    assert.equal(classifyLinkedinRedirect(location), expected, String(location).slice(0, 60));
    const result = await linkedinCookie.test({ config: valid }, {
      fetcher: async (_url, options) => {
        assert.equal(options.redirect, 'manual');
        return new Response(null, {
          status: 302,
          headers: location === null ? {} : { Location: location },
        });
      },
    });
    assert.equal(result.redirect_kind, expected);
    assert.equal(result.error_code, 'redirect_detected');
    assert.equal(result.http_status, 302);
    assert.doesNotMatch(JSON.stringify(result), /token=secret|session=secret|JSESSIONID=private|li_at=private|evil\.example|user:password|javascript:alert/);
  }
});
