import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.mjs';
import { totpAt, currentStep } from '../server/security.js';

let srv, c;
before(async () => { srv = await startServer({ REQUIRE_2FA: true }); c = client(srv.base); });
after(async () => { await srv.stop(); });

test('double authentification obligatoire : données bloquées tant qu\'elle n\'est pas activée', async () => {
  const setup = await c.post('/api/auth/setup', { username: 'alex', first_name: 'Alex', last_name: 'Martin', password: 'motdepasse-solide-42' });
  assert.equal(setup.status, 200);
  assert.equal(setup.data.needs_2fa_setup, true);
  const blocked = await c.get('/api/dashboard');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error, 'totp_setup_required');
  assert.equal((await c.get('/api/export.json')).status, 403);
  assert.equal((await c.get('/api/account')).status, 200);
  const s = await c.post('/api/account/totp/setup');
  const e = await c.post('/api/account/totp/enable', { code: totpAt(s.data.secret, currentStep()) });
  assert.equal(e.status, 200);
  assert.equal((await c.get('/api/dashboard')).status, 200);
  const disable = await c.post('/api/account/totp/disable', { password: 'motdepasse-solide-42' });
  assert.equal(disable.status, 403);
});
