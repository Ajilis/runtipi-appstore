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

test('seule une expiration explicite peut marquer le compte comme à reconnecter', () => {
  assert.deepEqual(linkedinVerificationChange(account, {
    ok: false, invalid_session: true, detail: 'Session refusée',
  }), { status: 'error', detail: 'Session refusée', profile: account.config.profile });
});

test('codes LinkedIn 403 et 999 sont des refus temporaires, 401 est non autorisé', async () => {
  for (const code of [401, 403, 999, 500]) {
    const result = await cookieProvider.test(credentials, {
      fetcher: async () => new Response('', { status: code }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.invalid_session === true, code === 401);
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
