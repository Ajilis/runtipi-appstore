// 1.2.0 : renvoyer l'e-mail d'une demande de partage (en attente ou expirée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer, client } from './helpers.mjs';
import { startFakeSmtp, parseMessage } from './smtp-fake.mjs';
import { todayIso } from '../server/portfolio.js';

const PASSWORD = 'mot-de-passe-test-2026';

test('renvoi de l’e-mail de partage : relance, délai prolongé, garde-fous', async () => {
  const smtp = await startFakeSmtp({ auth: { user: 'vigie', pass: 'secret' } });
  const srv = await startServer();
  const db = srv.app.db;
  try {
    const admin = client(srv.base);
    assert.equal((await admin.post('/api/auth/setup', { username: 'alice', first_name: 'Alice', last_name: 'A', password: PASSWORD, base_currency: 'EUR' })).status, 200);
    const sam = (await admin.post('/api/users', { username: 'sam', first_name: 'Sam', last_name: 'S', password: PASSWORD, email: 'sam@example.fr' })).data.user;
    const noMail = (await admin.post('/api/users', { username: 'lea', first_name: 'Léa', last_name: 'L', password: PASSWORD })).data.user;
    const samClient = client(srv.base);
    assert.equal((await samClient.post('/api/auth/login', { username: 'sam', password: PASSWORD })).status, 200);
    const cat = (await admin.get('/api/categories')).data.categories.find((c) => c.name === 'Comptes courants');
    const id = (await admin.post('/api/holdings', { category_id: cat.id, name: 'Compte joint', amount: 1000, date: todayIso() })).data.id;
    const id2 = (await admin.post('/api/holdings', { category_id: cat.id, name: 'Livret', amount: 500, date: todayIso() })).data.id;

    // Sans envoi d'e-mails configuré : la demande existe, la relance explique pourquoi elle est impossible.
    let r = await admin.post(`/api/holdings/${id}/shares`, { recipient_id: sam.id });
    assert.equal(r.status, 200);
    assert.equal(r.data.sent, false);
    assert.equal(r.data.invitation.send_count, 0);
    const shareId = r.data.invitation.id;
    let resend = await admin.post(`/api/shares/${shareId}/resend`, {});
    assert.equal(resend.status, 409);
    assert.equal(resend.data.error, 'mail_not_configured');
    assert.equal((await admin.get(`/api/holdings/${id}`)).data.mail_ready, false);

    assert.equal((await admin.put('/api/admin/mail', {
      host: '127.0.0.1', port: smtp.port, security: 'none', username: 'vigie', password: 'secret',
      from_address: 'vigie@example.fr', from_name: 'Vigie', public_url: 'https://vigie.exemple.fr',
    })).status, 200);
    assert.equal((await admin.get(`/api/holdings/${id}`)).data.mail_ready, true);
    assert.equal((await samClient.post(`/api/shares/${shareId}/resend`, {})).status, 404, 'seul le titulaire relance');

    // Relance : e-mail envoyé, 7 jours de plus.
    db.prepare('UPDATE holding_shares SET expires_at = ? WHERE id = ?').run(Date.now() + 86400_000, shareId);
    resend = await admin.post(`/api/shares/${shareId}/resend`, {});
    assert.equal(resend.status, 200, JSON.stringify(resend.data));
    assert.equal(smtp.messages.length, 1);
    assert.deepEqual(smtp.messages[0].to, ['sam@example.fr']);
    const mail = parseMessage(smtp.messages[0].data);
    assert.match(mail.text, /Compte joint/);
    assert.match(mail.text, /https:\/\/vigie\.exemple\.fr\/#\/avoirs/);
    assert.equal(resend.data.invitation.send_count, 1);
    assert.ok(resend.data.invitation.sent_at);
    assert.ok(resend.data.invitation.expires_at > Date.now() + 6.9 * 86400_000, 'délai de réponse prolongé');
    assert.equal((await admin.post(`/api/shares/${shareId}/resend`, {})).status, 429, 'pas deux e-mails dans la même minute');
    db.prepare('UPDATE holding_shares SET sent_at = ? WHERE id = ?').run(Date.now() - 120_000, shareId);
    resend = await admin.post(`/api/shares/${shareId}/resend`, {});
    assert.equal(resend.status, 200);
    assert.equal(resend.data.invitation.send_count, 2);
    const detail = (await admin.get(`/api/holdings/${id}`)).data.sharing.shares[0];
    assert.equal(detail.send_count, 2);
    assert.equal(detail.recipient_has_email, true);
    assert.ok((await admin.get('/api/audit/mine')).data.entries.some((e) => e.action === 'partage_relance'));

    // Demande expirée : la relance la remet en attente pour 7 jours.
    db.prepare('UPDATE holding_shares SET expires_at = ?, sent_at = ? WHERE id = ?').run(Date.now() - 1000, Date.now() - 8 * 86400_000, shareId);
    assert.equal((await admin.get(`/api/holdings/${id}`)).data.sharing.shares[0].status, 'expired');
    resend = await admin.post(`/api/shares/${shareId}/resend`, {});
    assert.equal(resend.status, 200, JSON.stringify(resend.data));
    assert.equal(resend.data.invitation.status, 'pending');
    assert.equal((await samClient.get('/api/shares/inbox')).data.invitations.length, 1, 'de nouveau dans le bandeau du destinataire');

    // Acceptée : plus de relance. Destinataire sans adresse : refus expliqué.
    assert.equal((await samClient.post(`/api/shares/${shareId}/decision`, { decision: 'accept' })).status, 200);
    assert.equal((await admin.post(`/api/shares/${shareId}/resend`, {})).status, 409);
    r = await admin.post(`/api/holdings/${id2}/shares`, { recipient_id: noMail.id });
    assert.equal(r.status, 200);
    resend = await admin.post(`/api/shares/${r.data.invitation.id}/resend`, {});
    assert.equal(resend.status, 409);
    assert.equal(resend.data.error, 'no_email');
    assert.match(resend.data.message, /n'a pas d'adresse e-mail/);
  } finally { await srv.stop(); await smtp.close(); }
});

test('interface : bouton « Renvoyer l’e-mail » et historique des envois', () => {
  const ui = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(ui, /data-action="share-resend"/);
  assert.match(ui, /Renvoyer l'e-mail/);
  assert.match(ui, /e-mail renvoyé le \$\{msAt\(x\.sent_at\)\}/);
  assert.match(ui, /'share-resend': async/);
});
