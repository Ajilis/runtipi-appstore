import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LINKEDIN_CHECK_COOLDOWN_SECONDS, LINKEDIN_ERROR_CODES,
  linkedinCheckPatch, linkedinRetrySeconds,
} from '../server/services/providers/linkedin-diagnostics.js';
import cookieProvider from '../server/services/providers/linkedin-cookie.js';
import { linkedinVerificationChange } from '../server/services/providers/linkedin-status.js';

const account = { status: 'active', config: {
  li_at: 'AQED0000000000000000000000',
  jsessionid: 'ajax:1234567890',
  profile: { name: 'Camille Martin', photo_url: null },
} };

test('historique : succès, puis échec sans effacer le succès ni le profil', () => {
  const t1 = new Date('2026-10-20T09:00:00.000Z');
  const t2 = new Date('2026-10-20T09:05:00.000Z');
  const ok = linkedinCheckPatch({ ok: true, profile: account.config.profile }, t1);
  const fail = linkedinCheckPatch({ ok: false, error_code: 'http_rejected', http_status: 401,
    detail: 'something private: li_at=secret' }, t2);
  const saved = { ...ok, ...fail };
  assert.deepEqual(saved, {
    last_success_at: t1.toISOString(), last_outcome: 'failure',
    last_failure_at: t2.toISOString(), last_error_code: 'http_rejected',
    last_http_status: 401,
  });
  assert.equal(linkedinVerificationChange(account, { ok: false, error_code: 'http_rejected' }), null);
  assert.doesNotMatch(JSON.stringify(saved), /secret|li_at|cookie|detail/);
});

test('les diagnostics n’enregistrent pas de messages arbitraires ou des entêtes', () => {
  const result = linkedinCheckPatch({ ok: false, error_code: 'li_at=AQED-private',
    http_status: 34567, headers: { Cookie: 'JSESSIONID=private' }, detail: 'private' });
  assert.deepEqual(result.last_error_code, 'unexpected_error');
  assert.equal(result.last_http_status, null);
  assert.ok(LINKEDIN_ERROR_CODES.includes('network_error'));
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('le délai serveur empêche deux tests dans la même fenêtre de 90 secondes', () => {
  const t = Date.parse('2026-10-20T09:00:00.000Z');
  const diagnostic = { last_attempt_at: new Date(t).toISOString() };
  assert.equal(LINKEDIN_CHECK_COOLDOWN_SECONDS, 90);
  assert.equal(linkedinRetrySeconds(diagnostic, t), 90);
  assert.equal(linkedinRetrySeconds(diagnostic, t + 30000), 60);
  assert.equal(linkedinRetrySeconds(diagnostic, t + 90000), 0);
  assert.equal(linkedinRetrySeconds({}, t), 0);
});

test('catégorise les codes de refus et réponses invalides sans exposer la réponse HTML', async () => {
  for (const status of [401, 403, 999, 429, 500]) {
    const response = await cookieProvider.test(account, {
      fetcher: async () => status === 999
        ? { status: 999, ok: false, headers: new Headers() }
        : new Response('private cookie information', { status }),
    });
    assert.equal(response.ok, false);
    assert.equal(response.http_status, status);
    assert.equal(response.error_code, status === 429 ? 'rate_limited'
      : [401, 403, 999].includes(status) ? 'http_rejected' : 'http_error');
    assert.doesNotMatch(JSON.stringify(response), /private cookie information/);
  }
  const html = await cookieProvider.test(account, {
    fetcher: async () => new Response('<html>private cookie information</html>',
      { status: 200, headers: { 'content-type': 'text/html' } }),
  });
  assert.equal(html.error_code, 'unexpected_response');
  assert.equal(html.http_status, 200);
  assert.doesNotMatch(JSON.stringify(html), /private cookie information/);
});

test('distingue cookies indéchiffrables et erreurs réseau', async () => {
  const credentials = await cookieProvider.test({ config: { li_at: '', jsessionid: '' } });
  assert.equal(credentials.error_code, 'credentials_unavailable');
  const network = await cookieProvider.test(account, {
    fetcher: async () => { throw new Error('Secret from upstream header'); },
  });
  assert.equal(network.error_code, 'network_error');
  assert.doesNotMatch(JSON.stringify(network), /Secret from upstream header/);
});

test('contrôle de non-régression : verrou PostgreSQL atomique et nettoyage lors du renouvellement', () => {
  const route = fs.readFileSync(new URL('../server/routes/core.js', import.meta.url), 'utf8');
  assert.match(route, /UPDATE accounts SET config = jsonb_set/);
  assert.match(route, /RETURNING \*/);
  assert.match(route, /last_attempt_at/);
  assert.match(route, /LINKEDIN_CHECK_COOLDOWN_SECONDS/);
  assert.match(route, /delete cfg\.verification/);
  assert.match(route, /delete cfg\.profile/);
  assert.match(route, /config->>'li_at_enc'/);
  assert.match(route, /config->>'jsessionid_enc'/);
  const ui = fs.readFileSync(new URL('../web/src/pages/Settings.jsx', import.meta.url), 'utf8');
  assert.match(ui, /cooldownSeconds > 0/);
  assert.match(ui, /LinkedInAccountDiagnostics/);
});
