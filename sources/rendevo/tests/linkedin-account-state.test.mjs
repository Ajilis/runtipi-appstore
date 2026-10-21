import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { linkedinVerificationChange } from '../server/services/providers/linkedin-status.js';
import cookieProvider from '../server/services/providers/linkedin-cookie.js';

const account = {
  status: 'active',
  config: { profile: { name: 'Camille', headline: 'Conseil', profile_url: null, photo_url: null } },
};
const credentials = { config: { li_at: 'AQED0000000000000000000000', jsessionid: 'ajax:1234567890' } };

test('une erreur transitoire ne change jamais le statut du compte actif', () => {
  assert.equal(linkedinVerificationChange(account, { ok: false, detail: 'HTTP 500' }), null);
  assert.equal(linkedinVerificationChange(account, { ok: false, detail: 'Réponse inattendue' }), null);
  assert.equal(linkedinVerificationChange(account, { ok: false, detail: 'Protection anti-abus', invalid_session: false }), null);
});

test('un succès restaure le compte et conserve le profil entre les rechargements', () => {
  assert.deepEqual(linkedinVerificationChange({ ...account, status: 'error' }, {
    ok: true, profile: { name: 'Camille Martin', photo_url: null },
  }), {
    status: 'active', detail: null, profile: { name: 'Camille Martin', photo_url: null },
  });
  assert.equal(linkedinVerificationChange({ ...account, status: 'paused' }, { ok: true }).status, 'paused');
  assert.deepEqual(linkedinVerificationChange(account, { ok: true }).profile, account.config.profile);
});

test('aucun échec de contrôle, même HTTP 401, ne révoque un statut validé', () => {
  for (const code of [401, 403, 999, 500]) {
    assert.equal(linkedinVerificationChange(account, {
      ok: false, invalid_session: code === 401, detail: 'HTTP ' + code,
    }), null);
    assert.equal(linkedinVerificationChange({ ...account, status: 'paused' }, {
      ok: false, invalid_session: code === 401,
    }), null);
  }
});

test('deux clics Tester : succès puis refus LinkedIn ne déconnecte pas', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ data: { publicIdentifier: 'camille-martin' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
      : new Response('', { status: 401 });
  };
  const first = await cookieProvider.test(credentials, { fetcher });
  assert.equal(first.ok, true);
  const change = linkedinVerificationChange({ ...account, status: 'error' }, first);
  assert.equal(change.status, 'active');

  const second = await cookieProvider.test(credentials, { fetcher });
  assert.equal(second.ok, false);
  assert.match(second.detail, /HTTP 401/);
  assert.equal(linkedinVerificationChange({ ...account, status: change.status }, second), null);
  assert.equal(calls, 2);
});

test('les refus 401, 403 et 999 restent des erreurs de vérification, non des déconnexions', async () => {
  for (const code of [401, 403, 999, 500]) {
    const result = await cookieProvider.test(credentials, {
      fetcher: async () => new Response('', { status: code }),
    });
    assert.equal(result.ok, false);
    assert.notEqual(result.invalid_session, true);
    assert.equal(linkedinVerificationChange(account, result), null);
  }
});

test('la page des comptes ne teste plus LinkedIn au montage et garde le bouton Tester', () => {
  const component = fs.readFileSync(new URL('../web/src/components/LinkedInAccountProfile.jsx', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../web/src/pages/Settings.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(component, /api\s*\(/);
  assert.doesNotMatch(component, /useEffect\s*\(/);
  assert.match(settings, /onClick=\{\(\) => test\(a\)\}/);
  assert.doesNotMatch(settings, /a\.provider\s*!==\s*'linkedin_cookie'\s*&&\s*<button/);
});
