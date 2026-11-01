import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.js';
import { createServerSecuritySettings } from '../server/security-settings.js';
import { startServer, client } from './helpers.mjs';

const PASSWORD = 'un-mot-de-passe-solide-2026';

test('réglages sécurité : persistés dans SQLite, appliqués au redémarrage et 2FA Runtipi non contournable', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-security-'));
  try {
    let db = openDatabase(tmp);
    const base = () => ({ SESSION_IDLE_MINUTES: 120, SESSION_MAX_HOURS: 72,
      LOGIN_MAX_ATTEMPTS: 5, LOGIN_LOCK_MINUTES: 15, REQUIRE_2FA: false,
      INSTITUTION_LOGOS: true, INSTITUTION_LOGOS_FALLBACK: true, IP_MAX_FAILURES: 20 });
    let cfg = base();
    const logos = { enabled: true, fallback: true };
    let security = createServerSecuritySettings(db, cfg, { logos });
    assert.equal(security.view().session_idle_minutes, 120);
    security.update({ session_idle_minutes: 25, session_max_hours: 48, login_max_attempts: 7,
      login_lock_minutes: 30, require_2fa: true, institution_logos: false, institution_logos_fallback: false });
    assert.equal(cfg.SESSION_IDLE_MINUTES, 25);
    assert.equal(cfg.REQUIRE_2FA, true);
    assert.equal(logos.enabled, false);
    db.close();
    db = openDatabase(tmp);
    cfg = base();
    security = createServerSecuritySettings(db, cfg);
    assert.equal(cfg.SESSION_IDLE_MINUTES, 25);
    assert.equal(cfg.SESSION_MAX_HOURS, 48);
    assert.equal(cfg.LOGIN_MAX_ATTEMPTS, 7);
    assert.equal(cfg.LOGIN_LOCK_MINUTES, 30);
    assert.equal(cfg.REQUIRE_2FA, true);
    assert.equal(cfg.INSTITUTION_LOGOS, false);
    security.update({ require_2fa: false });
    assert.equal(cfg.REQUIRE_2FA, false, 'possible si non imposée par Runtipi');
    db.close();
    db = openDatabase(tmp);
    cfg = { ...base(), REQUIRE_2FA: true };
    security = createServerSecuritySettings(db, cfg);
    assert.equal(security.view().require_2fa_forced, true);
    assert.equal(cfg.REQUIRE_2FA, true, 'la configuration Runtipi reste prioritaire sur SQLite');
    assert.throws(() => security.update({ require_2fa: false }), /imposée/);
    assert.throws(() => security.update({ session_idle_minutes: 0 }), /entre 5 et 10080/);
    assert.throws(() => security.update({ login_max_attempts: '7' }), /nombre entier/);
    assert.throws(() => security.update({ require_2fa: 'false' }), /booléen/);
    assert.throws(() => security.update({ SECRET: 'hacker' }), /non reconnu/);
    assert.equal(cfg.LOGIN_MAX_ATTEMPTS, 7, 'la validation des erreurs ne modifie rien');
    db.close();
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('API sécurité : modifiable par admin seulement, mot de passe exigé, audit et prise en compte immédiate', async () => {
  const srv = await startServer({ INSTITUTION_LOGOS: false, INSTITUTION_LOGOS_FALLBACK: false });
  try {
    const admin = client(srv.base);
    const initial = await admin.post('/api/auth/setup', {
      username: 'adminsec', first_name: 'Camille', last_name: 'Aubert', password: PASSWORD,
      base_currency: 'EUR',
    });
    assert.equal(initial.status, 200, JSON.stringify(initial.data));
    let prefs = (await admin.get('/api/settings')).data.security;
    assert.equal(prefs.require_2fa, false);
    assert.equal(prefs.require_2fa_forced, false);
    assert.equal(prefs.session_idle_minutes, 120);

    const viewerNew = await admin.post('/api/users', {
      username: 'lecteursec', first_name: 'Louis', last_name: 'Aubert',
      role: 'viewer', password: PASSWORD,
    });
    assert.equal(viewerNew.status, 200, JSON.stringify(viewerNew.data));
    const viewer = client(srv.base);
    assert.equal((await viewer.post('/api/auth/login', { username: 'lecteursec', password: PASSWORD })).status, 200);
    assert.equal((await viewer.get('/api/settings')).data.security, undefined, 'ne divulgue pas les paramètres aux lecteurs');
    assert.equal((await viewer.put('/api/admin/security', { session_idle_minutes: 6, current_password: PASSWORD })).status, 403);

    const wrong = await admin.put('/api/admin/security', { session_idle_minutes: 15, current_password: 'incorrect' });
    assert.equal(wrong.status, 403);
    assert.equal((await admin.get('/api/settings')).data.security.session_idle_minutes, 120);
    const invalid = await admin.put('/api/admin/security', { session_idle_minutes: 4, current_password: PASSWORD });
    assert.equal(invalid.status, 400);
    const invalid2 = await admin.put('/api/admin/security', { session_idle_minutes: 15, login_lock_minutes: 0, current_password: PASSWORD });
    assert.equal(invalid2.status, 400);
    assert.equal((await admin.get('/api/settings')).data.security.session_idle_minutes, 120, 'écriture atomique');

    const update = await admin.put('/api/admin/security', {
      session_idle_minutes: 30, session_max_hours: 24, login_max_attempts: 6,
      login_lock_minutes: 21, require_2fa: false,
      institution_logos: false, institution_logos_fallback: false,
      current_password: PASSWORD,
    });
    assert.equal(update.status, 200, JSON.stringify(update.data));
    prefs = (await admin.get('/api/settings')).data.security;
    assert.equal(prefs.session_idle_minutes, 30);
    assert.equal(prefs.session_max_hours, 24);
    assert.equal(prefs.login_max_attempts, 6);
    assert.equal(prefs.login_lock_minutes, 21);
    assert.equal(srv.cfg.SESSION_IDLE_MINUTES, 30);
    assert.equal(srv.cfg.LOGIN_MAX_ATTEMPTS, 6);
    assert.equal(srv.app.logos.enabled, false);
    assert.ok((await admin.get('/api/audit')).data.entries.some((x) => x.action === 'securite_modifiee'));

    // Rendre la 2FA obligatoire sans 2FA active force l'activation via « Mon compte ».
    const enabled = await admin.put('/api/admin/security', { require_2fa: true, current_password: PASSWORD });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.data.needs_2fa_setup, true);
    assert.equal((await admin.get('/api/dashboard')).status, 403);
    assert.equal((await admin.get('/api/account')).status, 200, 'accès possible pour configurer la 2FA');
  } finally { await srv.stop(); }
});
