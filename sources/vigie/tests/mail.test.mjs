import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { sendMail, buildMessage, encodeHeader, templates, isEmail, SmtpError } from '../server/mail.js';
import { startFakeSmtp, selfSignedCert, parseMessage } from './smtp-fake.mjs';

let cert;
before(() => { cert = selfSignedCert(); });

const base = { host: '127.0.0.1', from_address: 'vigie@exemple.fr', hello_name: 'vigie.exemple.fr' };
const msg = (to = 'lea@exemple.fr', extra = {}) => buildMessage({ fromAddress: 'vigie@exemple.fr', fromName: 'Vigie Patrimoine', to, subject: 'Créer votre compte', text: 'Bonjour Léa\n.ligne commençant par un point', html: '<p>Bonjour</p>', ...extra });

test('adresses e-mail', () => {
  for (const ok of ['lea@exemple.fr', 'a.b+c@sous.domaine.example', 'x_y@a-b.co']) assert.ok(isEmail(ok), ok);
  for (const bad of ['', 'lea', 'lea@', '@exemple.fr', 'lea@exemple', 'a b@exemple.fr', 'lea@exemple.fr\r\nBcc: x@y.z', '<lea@exemple.fr>', 'lea@-exemple.fr']) assert.ok(!isEmail(bad), bad);
});

test('message MIME : en-têtes encodés, sans injection, parties texte et HTML en UTF-8', () => {
  const raw = buildMessage({ fromAddress: 'vigie@exemple.fr', fromName: 'Vigie Épargne', to: 'lea@exemple.fr', subject: 'Invitation\r\nBcc: pirate@exemple.fr', text: 'Héllo', html: '<b>Héllo</b>' });
  const head = raw.split('\r\n\r\n')[0];
  assert.ok(!/^Bcc:/mi.test(head), 'aucun en-tête injecté');
  const m = parseMessage(raw);
  assert.equal(m.subject, 'Invitation Bcc: pirate@exemple.fr');
  assert.equal(m.from, 'Vigie Épargne <vigie@exemple.fr>');
  assert.equal(m.text, 'Héllo');
  assert.equal(m.html, '<b>Héllo</b>');
  assert.match(m.headers['message-id'], /^<[0-9a-f]{32}@exemple\.fr>$/);
  assert.ok(raw.split('\r\n').every((l) => l.length <= 998), 'lignes de 998 caractères au plus');
  const long = encodeHeader('Réinitialisation de votre mot de passe Vigie Patrimoine — demande reçue');
  assert.ok(long.split('\r\n ').every((w) => w.length <= 75), 'mots encodés de 75 caractères au plus');
  assert.throws(() => buildMessage({ fromAddress: 'vigie@exemple.fr', to: 'pas une adresse', subject: 's', text: 't', html: 'h' }), SmtpError);
});

test('envoi simple avec authentification PLAIN, point en début de ligne préservé', async () => {
  const srv = await startFakeSmtp({ auth: { user: 'vigie', pass: 'secret' } });
  const r = await sendMail({ ...base, port: srv.port, security: 'none', username: 'vigie', password: 'secret' }, { to: 'lea@exemple.fr', raw: msg() });
  assert.match(r.response, /queued/);
  assert.equal(srv.messages.length, 1);
  assert.equal(srv.messages[0].from, 'vigie@exemple.fr');
  assert.deepEqual(srv.messages[0].to, ['lea@exemple.fr']);
  const m = parseMessage(srv.messages[0].data);
  assert.equal(m.subject, 'Créer votre compte');
  assert.equal(m.text, 'Bonjour Léa\r\n.ligne commençant par un point');
  const raw = 'Subject: test\r\n\r\n.ligne\r\n..deux\r\nfin';
  await sendMail({ ...base, port: srv.port, security: 'none', username: 'vigie', password: 'secret' }, { to: 'lea@exemple.fr', raw });
  assert.equal(srv.messages[1].data, raw, 'transparence des points (RFC 5321)');
  assert.ok(!srv.transcripts.flat().some((l) => l.includes('secret')), 'mot de passe jamais en clair dans les échanges');
  await srv.close();
});

test('authentification LOGIN si seule proposée, et mot de passe refusé', async () => {
  const srv = await startFakeSmtp({ auth: { user: 'vigie', pass: 'secret' }, advertiseAuth: ['LOGIN'] });
  await sendMail({ ...base, port: srv.port, security: 'none', username: 'vigie', password: 'secret' }, { to: 'lea@exemple.fr', raw: msg() });
  assert.equal(srv.messages.length, 1);
  await assert.rejects(sendMail({ ...base, port: srv.port, security: 'none', username: 'vigie', password: 'faux' }, { to: 'lea@exemple.fr', raw: msg() }),
    (e) => e instanceof SmtpError && e.stage === 'authentification' && /refusé/.test(e.message) && /535/.test(e.message));
  await srv.close();
});

test('refus du serveur expliqués : authentification exigée, expéditeur, destinataire, connexion', async () => {
  const srv = await startFakeSmtp({ auth: { user: 'vigie', pass: 'secret' }, rejectRcpt: 'inconnu', rejectFrom: 'autre@' });
  await assert.rejects(sendMail({ ...base, port: srv.port, security: 'none' }, { to: 'lea@exemple.fr', raw: msg() }), /exige une authentification/);
  const conf = { ...base, port: srv.port, security: 'none', username: 'vigie', password: 'secret' };
  await assert.rejects(sendMail(conf, { to: 'inconnu@exemple.fr', raw: msg('inconnu@exemple.fr') }), /Destinataire refusé.*550/);
  await assert.rejects(sendMail({ ...conf, from_address: 'autre@exemple.fr' }, { to: 'lea@exemple.fr', raw: msg() }), /Adresse d'expéditeur refusée/);
  await srv.close();
  const closed = net.createServer();
  await new Promise((r) => closed.listen(0, '127.0.0.1', r));
  const port = closed.address().port;
  await new Promise((r) => closed.close(r));
  await assert.rejects(sendMail({ ...base, port, security: 'none' }, { to: 'lea@exemple.fr', raw: msg() }), /Connexion refusée/);
  await assert.rejects(sendMail({ ...base, host: 'serveur-qui-n-existe-pas.invalid', port: 587, security: 'starttls' }, { to: 'lea@exemple.fr', raw: msg() }), /Serveur introuvable/);
});

test('STARTTLS : certificat vérifié par défaut, accepté sur demande, mot de passe envoyé chiffré', async (t) => {
  if (!cert) return t.skip('openssl absent');
  const srv = await startFakeSmtp({ mode: 'starttls', cert, auth: { user: 'vigie', pass: 'secret' } });
  const conf = { ...base, port: srv.port, security: 'starttls', username: 'vigie', password: 'secret' };
  await assert.rejects(sendMail(conf, { to: 'lea@exemple.fr', raw: msg() }), (e) => e.stage === 'chiffrement' && /Certificat du serveur refusé/.test(e.message));
  await sendMail({ ...conf, allow_invalid_cert: true }, { to: 'lea@exemple.fr', raw: msg() });
  assert.equal(srv.messages.length, 1);
  assert.equal(srv.messages[0].secure, true);
  await srv.close();
  const plain = await startFakeSmtp();
  await assert.rejects(sendMail({ ...base, port: plain.port, security: 'starttls' }, { to: 'lea@exemple.fr', raw: msg() }), /ne propose pas STARTTLS/);
  await assert.rejects(sendMail({ ...base, port: plain.port, security: 'tls' }, { to: 'lea@exemple.fr', raw: msg() }), (e) => e instanceof SmtpError && /SSL\/TLS|coupée|chiffrement|Échec/.test(e.message));
  await plain.close();
});

test('SSL/TLS implicite (port 465)', async (t) => {
  if (!cert) return t.skip('openssl absent');
  const srv = await startFakeSmtp({ mode: 'tls', cert, auth: { user: 'vigie', pass: 'secret' } });
  await sendMail({ ...base, port: srv.port, security: 'tls', username: 'vigie', password: 'secret', allow_invalid_cert: true }, { to: 'lea@exemple.fr', raw: msg() });
  assert.equal(srv.messages.length, 1);
  await srv.close();
});

test('modèles : valeurs saisies échappées, lien présent en texte et en HTML', () => {
  const url = 'https://patrimoine.exemple.fr/#/invitation/abc';
  const inv = templates.invitation({ firstName: 'Léa', inviter: 'Alex <script>alert(1)</script>', role: 'viewer', url, expiresAt: Date.now() + 86400_000 });
  assert.match(inv.subject, /^Alex <script>/);
  assert.ok(!inv.html.includes('<script>'), 'nom échappé dans le HTML');
  assert.ok(inv.text.includes(url) && inv.html.includes(`href="${url}"`));
  assert.match(inv.text, /lecture seule/);
  const reset = templates.reset({ firstName: 'Alex', username: 'alex', url, expiresAt: Date.now() + 3600_000, ip: '203.0.113.7', at: Date.now() });
  assert.match(reset.text, /203\.0\.113\.7/);
  assert.match(reset.text, /reste valable/);
  assert.match(templates.passwordChanged({ firstName: '', username: 'alex', ip: '::1', at: Date.now(), how: 'reset' }).text, /Mot de passe oublié/);
  assert.match(templates.test({ host: 'smtp.exemple.fr', port: 587, security: 'starttls', by: 'Alex', at: Date.now() }).html, /smtp\.exemple\.fr:587/);
});
