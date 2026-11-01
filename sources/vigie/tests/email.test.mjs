import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.mjs';
import { startFakeSmtp, parseMessage } from './smtp-fake.mjs';
import { getSetting } from '../server/db.js';

const PASSWORD = 'motdepasse-solide-42';
let srv, smtp, admin;
const PUBLIC = 'https://patrimoine.exemple.fr';
const mailForm = () => ({ host: '127.0.0.1', port: smtp.port, security: 'none', username: 'vigie', password: 'secret-smtp', from_address: 'vigie@exemple.fr', from_name: 'Vigie Patrimoine', public_url: `${PUBLIC}/` });

// Attend le prochain message reçu par le faux serveur SMTP (envois faits en arrière-plan).
async function nextMail(count, timeout = 3000) {
  const end = Date.now() + timeout;
  while (smtp.messages.length < count && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  assert.ok(smtp.messages.length >= count, `message n°${count} attendu`);
  const m = smtp.messages[count - 1];
  return { ...parseMessage(m.data), to: m.to };
}
const tokenIn = (m, kind) => {
  const match = new RegExp(`${PUBLIC.replace(/\./g, '\\.')}/#/${kind}/([A-Za-z0-9_-]+)`).exec(m.text);
  assert.ok(match, `lien ${kind} dans le message : ${m.text}`);
  return match[1];
};

before(async () => {
  smtp = await startFakeSmtp({ auth: { user: 'vigie', pass: 'secret-smtp' } });
  srv = await startServer();
  admin = client(srv.base);
  await admin.post('/api/auth/setup', { username: 'alex', first_name: 'Alex', last_name: 'Martin', password: PASSWORD });
});
after(async () => { await srv.stop(); await smtp.close(); });

test('réglages SMTP : validation, mot de passe chiffré jamais renvoyé, test avant et après enregistrement', async () => {
  assert.equal((await client(srv.base).get('/api/auth/state')).data.password_reset, false);
  let r = await admin.get('/api/admin/mail');
  assert.equal(r.data.settings, null);
  assert.match(r.data.suggested_public_url, /^http:\/\/127\.0\.0\.1:\d+$/);
  for (const [bad, why] of [[{ port: 0 }, /Port/], [{ host: 'smtp exemple' }, /Serveur/], [{ security: 'ssl3' }, /Sécurité/], [{ from_address: 'vigie' }, /expédition/],
    [{ public_url: 'patrimoine.exemple.fr' }, /Adresse de Vigie/], [{ public_url: 'https://patrimoine.exemple.fr/chemin' }, /Adresse de Vigie/], [{ public_url: 'javascript:alert(1)' }, /Adresse de Vigie/]]) {
    r = await admin.put('/api/admin/mail', { ...mailForm(), ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.match(r.data.message, why);
  }
  r = await admin.post('/api/admin/mail/test', { ...mailForm(), password: 'faux', to: 'alex@exemple.fr' });
  assert.equal(r.status, 502);
  assert.match(r.data.message, /refusé/);
  assert.equal(r.data.stage, 'authentification');
  r = await admin.post('/api/admin/mail/test', { ...mailForm(), to: 'alex@exemple.fr' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const m = await nextMail(1);
  assert.equal(m.subject, "Test d'envoi de Vigie Patrimoine");
  assert.deepEqual(m.to, ['alex@exemple.fr']);
  assert.equal((await admin.get('/api/admin/mail')).data.settings, null, 'le test n\'enregistre rien');

  r = await admin.put('/api/admin/mail', mailForm());
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.settings.password_set, true);
  assert.equal(r.data.settings.public_url, PUBLIC, 'barre finale retirée');
  assert.ok(!JSON.stringify(r.data).includes('secret-smtp'));
  const stored = getSetting(srv.app.db, 'mail');
  assert.ok(!stored.includes('secret-smtp'), 'mot de passe chiffré en base');
  r = await admin.put('/api/admin/mail', { ...mailForm(), password: '' });
  assert.equal(r.data.settings.password_set, true, 'champ vide : mot de passe conservé');
  r = await admin.post('/api/admin/mail/test', { to: 'alex@exemple.fr' });
  assert.equal(r.status, 200, 'test avec les réglages enregistrés');
  await nextMail(2);
  assert.equal((await client(srv.base).get('/api/auth/state')).data.password_reset, true);
  const viewer = client(srv.base);
  assert.equal((await viewer.get('/api/admin/mail')).status, 401);
});

let lea;
test('invitation : e-mail avec lien, acceptation, compte créé et connecté', async () => {
  let r = await admin.post('/api/admin/invitations', { email: 'Lea@Exemple.fr', first_name: 'Léa', last_name: 'Martin', role: 'viewer' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.sent, true);
  assert.equal(r.data.invitation.email, 'lea@exemple.fr');
  const m = await nextMail(3);
  assert.equal(m.subject, 'Alex Martin vous invite sur Vigie Patrimoine');
  assert.deepEqual(m.to, ['lea@exemple.fr']);
  assert.match(m.text, /Bonjour Léa/);
  const token = tokenIn(m, 'invitation');
  assert.equal(r.data.link, `${PUBLIC}/#/invitation/${token}`);
  assert.equal((await admin.post('/api/admin/invitations', { email: 'lea@exemple.fr' })).status, 409, 'invitation déjà en attente');
  assert.equal((await admin.get('/api/admin/invitations')).data.invitations.length, 1);

  lea = client(srv.base);
  r = await lea.post('/api/auth/invitation', { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.invited_by, 'Alex Martin');
  assert.equal(r.data.role, 'viewer');
  assert.equal(r.data.suggested_username, 'lea');
  assert.equal((await lea.post('/api/auth/invitation', { token: 'x'.repeat(43) })).status, 410);
  r = await lea.post('/api/auth/invitation/accept', { token, username: 'lea', first_name: 'Léa', last_name: 'Martin', password: 'court' });
  assert.equal(r.status, 400);
  r = await lea.post('/api/auth/invitation/accept', { token, username: 'alex', first_name: 'Léa', last_name: 'Martin', password: PASSWORD });
  assert.equal(r.status, 409, "nom d'utilisateur déjà pris");
  r = await lea.post('/api/auth/invitation/accept', { token, username: 'lea', first_name: 'Léa', last_name: 'Martin', password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.role, 'viewer');
  assert.equal(r.data.user.email, 'lea@exemple.fr');
  assert.equal((await lea.get('/api/account')).data.user.username, 'lea', 'connectée après acceptation');
  assert.equal((await client(srv.base).post('/api/auth/invitation/accept', { token, username: 'lea2', first_name: 'L', last_name: 'M', password: PASSWORD })).status, 410, 'lien à usage unique');
  assert.equal((await admin.get('/api/admin/invitations')).data.invitations.length, 0);
  assert.equal((await admin.post('/api/admin/invitations', { email: 'lea@exemple.fr' })).status, 409, 'adresse déjà utilisée par un compte');
  const actions = (await admin.get('/api/audit')).data.entries.map((e) => e.action);
  assert.ok(actions.includes('invitation_envoyee') && actions.includes('invitation_acceptee'));
});

test('invitation : renvoi (ancien lien invalidé), annulation, lien à transmettre sans e-mail', async () => {
  let r = await admin.post('/api/admin/invitations', { email: 'sam@exemple.fr', role: 'editor' });
  const first = tokenIn(await nextMail(4), 'invitation');
  r = await admin.post(`/api/admin/invitations/${r.data.invitation.id}/resend`);
  assert.equal(r.status, 200);
  const second = tokenIn(await nextMail(5), 'invitation');
  assert.notEqual(first, second);
  const anon = client(srv.base);
  assert.equal((await anon.post('/api/auth/invitation', { token: first })).status, 410, 'ancien lien invalidé');
  assert.equal((await anon.post('/api/auth/invitation', { token: second })).status, 200);
  assert.equal((await admin.del(`/api/admin/invitations/${r.data.invitation.id}`)).status, 200);
  assert.equal((await anon.post('/api/auth/invitation', { token: second })).status, 410, 'invitation annulée');

  r = await admin.post('/api/admin/invitations', { email: 'jo@exemple.fr', role: 'viewer', send: false });
  assert.equal(r.status, 200);
  assert.equal(r.data.sent, false);
  assert.match(r.data.link, new RegExp(`^${PUBLIC.replace(/\./g, '\\.')}/#/invitation/`));
  assert.equal(smtp.messages.length, 5, 'aucun e-mail');
  await admin.del(`/api/admin/invitations/${r.data.invitation.id}`);
  assert.equal((await lea.post('/api/admin/invitations', { email: 'x@exemple.fr' })).status, 403, 'réservé aux administrateurs');
});

test('mot de passe oublié : réponse identique, lien envoyé, réinitialisation, sessions fermées, avis envoyé', async () => {
  const anon = client(srv.base, { 'x-forwarded-host': 'pirate.exemple' });
  let r = await anon.post('/api/auth/forgot', { login: 'personne' });
  const unknown = r.data.message;
  assert.equal(r.status, 200);
  r = await anon.post('/api/auth/forgot', { login: 'LEA@exemple.fr' });
  assert.equal(r.data.message, unknown, 'même réponse pour un compte inconnu');
  const m = await nextMail(6);
  assert.equal(m.subject, 'Réinitialisation de votre mot de passe Vigie Patrimoine');
  assert.deepEqual(m.to, ['lea@exemple.fr']);
  assert.ok(!m.text.includes('pirate.exemple'), "le lien utilise l'adresse enregistrée, jamais l'en-tête de la requête");
  const token = tokenIn(m, 'mot-de-passe');
  await anon.post('/api/auth/forgot', { login: 'lea' });
  await new Promise((r2) => setTimeout(r2, 300));
  assert.equal(smtp.messages.length, 6, 'nouvelle demande en moins d\'une minute ignorée');

  r = await anon.post('/api/auth/reset/check', { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.username, 'lea');
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'court' })).status, 400);
  r = await anon.post('/api/auth/reset', { token, password: 'nouveau-mot-de-passe-99' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await lea.get('/api/account')).status, 401, 'sessions fermées');
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'encore-un-autre-55' })).status, 410, 'lien à usage unique');
  const notice = await nextMail(7);
  assert.equal(notice.subject, 'Votre mot de passe Vigie Patrimoine a été modifié');
  const again = client(srv.base);
  assert.equal((await again.post('/api/auth/login', { username: 'lea', password: PASSWORD })).status, 401);
  assert.equal((await again.post('/api/auth/login', { username: 'lea', password: 'nouveau-mot-de-passe-99' })).status, 200);
  lea = again;
  const actions = (await admin.get('/api/audit')).data.entries.map((e) => e.action);
  assert.ok(actions.includes('mot_de_passe_oublie') && actions.includes('mot_de_passe_reinitialise'));
});

test('mot de passe oublié : compte désactivé ignoré, limite par adresse IP, désactivé sans e-mail configuré', async () => {
  const users = (await admin.get('/api/users')).data.users;
  const leaId = users.find((u) => u.username === 'lea').id;
  await admin.patch(`/api/users/${leaId}`, { disabled: true });
  const n = smtp.messages.length;
  const anon = client(srv.base);
  let status = 200;
  for (let i = 0; i < 6 && status === 200; i++) status = (await anon.post('/api/auth/forgot', { login: 'lea' })).status;
  assert.equal(status, 429, 'limite de demandes par adresse IP');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(smtp.messages.length, n, 'rien envoyé à un compte désactivé');
  await admin.patch(`/api/users/${leaId}`, { disabled: false });

  const saved = getSetting(srv.app.db, 'mail');
  assert.equal((await admin.del('/api/admin/mail')).status, 200);
  assert.equal((await client(srv.base).get('/api/auth/state')).data.password_reset, false);
  assert.equal((await client(srv.base).post('/api/auth/forgot', { login: 'lea' })).status, 409);
  assert.equal((await admin.post('/api/admin/invitations', { email: 'zoe@exemple.fr' })).status, 409, 'invitation par e-mail impossible sans SMTP');
  srv.app.db.prepare("INSERT INTO settings (key, value) VALUES ('mail', ?)").run(saved);
});

test('adresse e-mail : profil (mot de passe exigé), unicité, lien envoyé par l\'administrateur', async () => {
  let r = await admin.patch('/api/account', { first_name: 'Alex', last_name: 'Martin', email: 'alex@exemple.fr' });
  assert.equal(r.status, 400, 'mot de passe actuel exigé pour changer d\'adresse');
  r = await admin.patch('/api/account', { first_name: 'Alex', last_name: 'Martin', email: 'lea@exemple.fr', current_password: PASSWORD });
  assert.equal(r.status, 409, 'adresse déjà prise');
  r = await admin.patch('/api/account', { first_name: 'Alex', last_name: 'Martin', email: 'Alex@Exemple.fr', current_password: PASSWORD });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email, 'alex@exemple.fr');
  r = await admin.patch('/api/account', { first_name: 'Alexandre', last_name: 'Martin', email: 'alex@exemple.fr' });
  assert.equal(r.status, 200, 'adresse inchangée : mot de passe inutile');

  r = await admin.post('/api/users', { username: 'max', first_name: 'Max', last_name: 'Martin', password: PASSWORD, role: 'editor', email: 'max@exemple.fr' });
  assert.equal(r.status, 200);
  assert.equal((await admin.post('/api/users', { username: 'max2', first_name: 'M', last_name: 'M', password: PASSWORD, role: 'editor', email: 'MAX@exemple.fr' })).status, 409);
  const n = smtp.messages.length;
  r = await admin.post(`/api/users/${r.data.user.id}/reset-link`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const m = await nextMail(n + 1);
  assert.deepEqual(m.to, ['max@exemple.fr']);
  tokenIn(m, 'mot-de-passe');
  const noMail = (await admin.post('/api/users', { username: 'nomail', first_name: 'N', last_name: 'M', password: PASSWORD, role: 'viewer' })).data.user;
  assert.equal((await admin.post(`/api/users/${noMail.id}/reset-link`)).status, 400);
});
