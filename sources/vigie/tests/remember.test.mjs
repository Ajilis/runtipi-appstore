// 1.1.0 : case « Rester connecté » à la connexion (navigateur et application installée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer, client } from './helpers.mjs';
import { totpAt, currentStep } from '../server/security.js';

const PASSWORD = 'mot-de-passe-test-2026';
const cookieOf = (r) => r.headers.getSetCookie().find((c) => c.startsWith('vigie_sid=')) || '';

test('rester connecté : cookie conservé, inactivité tolérée, renouvellement, option retirée par l’administrateur', async () => {
  const srv = await startServer();
  const db = srv.app.db;
  try {
    const admin = client(srv.base);
    assert.equal((await admin.post('/api/auth/setup', { username: 'alice', first_name: 'Alice', last_name: 'A', password: PASSWORD, base_currency: 'EUR' })).status, 200);
    assert.equal((await client(srv.base).get('/api/auth/state')).data.remember_days, 30, 'case proposée, 30 jours par défaut');

    // Sans la case : cookie de navigateur (sans Max-Age), délai d'inactivité ordinaire.
    const plain = client(srv.base);
    const r1 = await plain.post('/api/auth/login', { username: 'alice', password: PASSWORD });
    assert.equal(r1.status, 200);
    assert.doesNotMatch(cookieOf(r1), /Max-Age/, 'cookie effacé à la fermeture du navigateur');
    // Avec la case : cookie conservé 30 jours.
    const kept = client(srv.base);
    const r2 = await kept.post('/api/auth/login', { username: 'alice', password: PASSWORD, remember: true });
    assert.match(cookieOf(r2), /Max-Age=2592000/);
    assert.match(cookieOf(r2), /HttpOnly/);
    const mine = (await kept.get('/api/account/sessions')).data.sessions;
    const current = mine.find((s) => s.current);
    assert.equal(current.remember, true);
    assert.ok(current.expires_at > Date.now() + 29 * 86400_000);
    assert.equal(mine.find((s) => !s.current).remember, false);
    assert.match((await admin.get('/api/audit/mine')).data.entries.map((e) => e.detail).join('\n'), /appareil mémorisé 30 jours/);

    // Trois heures sans activité : la session ordinaire est fermée, la session mémorisée continue et se prolonge.
    const ago = Date.now() - 3 * 3600_000;
    db.prepare('UPDATE sessions SET last_seen_at = ?').run(ago);
    assert.equal((await plain.get('/api/dashboard')).status, 401);
    const renewed = await kept.get('/api/dashboard');
    assert.equal(renewed.status, 200);
    assert.match(cookieOf(renewed), /Max-Age=2592000/, 'cookie renvoyé pour 30 nouveaux jours');
    const row = db.prepare('SELECT expires_at, last_seen_at FROM sessions WHERE remember = 1').get();
    assert.ok(row.last_seen_at > ago && row.expires_at > Date.now() + 29 * 86400_000);
    // 31 jours sans utilisation : fin de la connexion mémorisée.
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE remember = 1').run(Date.now() - 31 * 86400_000, Date.now() - 86400_000);
    assert.equal((await kept.get('/api/dashboard')).status, 401);

    // L'administrateur retire l'option : plus de case, les sessions mémorisées redeviennent ordinaires.
    assert.equal((await admin.post('/api/auth/login', { username: 'alice', password: PASSWORD })).status, 200);
    const again = client(srv.base);
    assert.match(cookieOf(await again.post('/api/auth/login', { username: 'alice', password: PASSWORD, remember: true })), /Max-Age/);
    const off = await admin.put('/api/admin/security', { session_remember_days: 0, current_password: PASSWORD });
    assert.equal(off.status, 200, JSON.stringify(off.data));
    assert.equal((await client(srv.base).get('/api/auth/state')).data.remember_days, 0);
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE remember = 1').run(Date.now() - 3 * 3600_000);
    assert.equal((await again.get('/api/dashboard')).status, 401, 'délai d’inactivité ordinaire de nouveau appliqué');
    const noOption = await client(srv.base).post('/api/auth/login', { username: 'alice', password: PASSWORD, remember: true });
    assert.doesNotMatch(cookieOf(noOption), /Max-Age/, 'case ignorée quand l’option est retirée');
    assert.equal((await admin.put('/api/admin/security', { session_remember_days: 400, current_password: PASSWORD })).status, 400);
    assert.equal((await admin.put('/api/admin/security', { session_remember_days: 90, current_password: PASSWORD })).status, 200);
    assert.match(cookieOf(await client(srv.base).post('/api/auth/login', { username: 'alice', password: PASSWORD, remember: true })), /Max-Age=7776000/);
  } finally { await srv.stop(); }
});

test('rester connecté avec la double authentification : le choix suit la vérification du code', async () => {
  const srv = await startServer();
  try {
    const admin = client(srv.base);
    assert.equal((await admin.post('/api/auth/setup', { username: 'bob', first_name: 'Bob', last_name: 'B', password: PASSWORD, base_currency: 'EUR' })).status, 200);
    const setup = await admin.post('/api/account/totp/setup');
    const enable = await admin.post('/api/account/totp/enable', { code: totpAt(setup.data.secret, currentStep()) });
    assert.equal(enable.status, 200);
    const c = client(srv.base);
    const step1 = await c.post('/api/auth/login', { username: 'bob', password: PASSWORD, remember: true });
    assert.equal(step1.data.totp_required, true);
    assert.equal(cookieOf(step1), '', 'aucune session avant le code');
    const step2 = await c.post('/api/auth/totp', { challenge: step1.data.challenge, code: enable.data.recovery_codes[0] });
    assert.equal(step2.status, 200, JSON.stringify(step2.data));
    assert.match(cookieOf(step2), /Max-Age=2592000/);
  } finally { await srv.stop(); }
});

test('interface : case « Rester connecté » et version au-dessus du nom', () => {
  const ui = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(ui, /name="remember"/);
  assert.match(ui, /Rester connecté sur cet appareil/);
  assert.match(ui, /return pwa\.standalone\(\);/, 'cochée par défaut dans l’application installée');
  assert.match(ui, /<div class="rail-foot">\s*<span class="version">Version \$\{state\.boot\.version\}<\/span>\s*<div class="who">/, 'version au-dessus du nom');
  assert.match(ui, /name="session_remember_days"/);
});
