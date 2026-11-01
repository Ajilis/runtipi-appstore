import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer, client } from './helpers.mjs';
import { startFakeSmtp, parseMessage } from './smtp-fake.mjs';
import { todayIso } from '../server/portfolio.js';

const PASSWORD = 'mot-de-passe-test-2026';

test('immobilier partagé : e-mail, proposition complémentaire, approbation ciblée, totaux consolidés et révocation', async () => {
  const smtp = await startFakeSmtp({ auth: { user: 'vigie', pass: 'secret' } });
  const srv = await startServer();
  try {
    const admin = client(srv.base);
    let r = await admin.post('/api/auth/setup', {
      username:'adminpartage',first_name:'Camille',last_name:'Dupont',password:PASSWORD,base_currency:'EUR',
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    r = await admin.put('/api/admin/mail', {
      host:'127.0.0.1',port:smtp.port,security:'none',username:'vigie',password:'secret',
      from_address:'vigie@example.fr',from_name:'Vigie',public_url:'https://vigie.exemple.fr',
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const lea = (await admin.post('/api/users', {
      username:'lea',first_name:'Léa',last_name:'Martin',role:'viewer',password:PASSWORD,email:'lea@example.fr',
    })).data.user;
    const luc = (await admin.post('/api/users', {
      username:'luc',first_name:'Luc',last_name:'Martin',role:'editor',password:PASSWORD,email:'luc@example.fr',
    })).data.user;
    const noEmail = (await admin.post('/api/users', {
      username:'noemail',first_name:'Sam',last_name:'Martin',role:'viewer',password:PASSWORD,
    })).data.user;
    const leaClient = client(srv.base);
    const lucClient = client(srv.base);
    assert.equal((await leaClient.post('/api/auth/login',{username:'lea',password:PASSWORD})).status,200);
    assert.equal((await lucClient.post('/api/auth/login',{username:'luc',password:PASSWORD})).status,200);
    const cats = (await admin.get('/api/categories')).data.categories;
    const cat = cats.find(x=>x.name==='Immobilier');
    const created = await admin.post('/api/holdings', {
      category_id:cat.id,name:'Maison indivise',amount:800000,date:todayIso(),
      property:{purchase_amount:425000,purchased_at:'2004-04-01',property_type:'maison',
        address:'12 rue de la Roë, Angers',surface_m2:180,condition:'bon',ownership_pct:60},
    });
    assert.equal(created.status,200,JSON.stringify(created.data));
    const id = created.data.id;
    let totals = (await admin.get('/api/dashboard')).data.totals;
    assert.equal(totals.assets,48000000,'avant accord, seulement 60 % pris en compte');
    const initial = await admin.get('/api/holdings/'+id+'/shares');
    assert.equal(initial.data.available_bp,4000);
    assert.equal(initial.data.accepted_bp,0);
    const recipients = await admin.get('/api/property-shares/recipients');
    assert.ok(recipients.data.mail_ready);
    assert.ok(recipients.data.recipients.some(x=>x.id===lea.id));
    assert.ok(!recipients.data.recipients.some(x=>x.id===noEmail.id));
    assert.equal((await leaClient.get('/api/property-shares/recipients')).status,403);
    assert.equal((await lucClient.post('/api/holdings/'+id+'/shares',{recipient_id:lea.id})).status,403);
    assert.equal((await admin.post('/api/holdings/'+id+'/shares',{recipient_id:noEmail.id})).status,400);
    assert.equal((await admin.post('/api/holdings/'+id+'/shares',{recipient_id:lea.id,ownership_pct:41})).status,400);
    r = await admin.post('/api/holdings/'+id+'/shares',{recipient_id:lea.id});
    assert.equal(r.status,200,JSON.stringify(r.data));
    assert.equal(r.data.invitation.ownership_bp,4000,'proposition complémentaire de 40 %');
    assert.equal(r.data.invitation.status,'pending');
    assert.equal(smtp.messages.length,1,'un e-mail est envoyé au compte destinataire');
    assert.deepEqual(smtp.messages[0].to,['lea@example.fr']);
    const mail = parseMessage(smtp.messages[0].data);
    assert.match(mail.text,/Maison indivise/);
    assert.match(mail.text,/40 %/);
    assert.match(mail.text,/https:\/\/vigie\.exemple\.fr\/#\/partages/);
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,48000000,
      'demande en attente : aucune modification du patrimoine');
    assert.equal((await lucClient.get('/api/property-shares/inbox')).data.invitations.length,0);
    assert.equal((await leaClient.get('/api/property-shares/inbox')).data.invitations.length,1);
    assert.equal((await admin.post('/api/holdings/'+id+'/shares',{recipient_id:luc.id})).status,400,
      'quote-part en attente réserve le complément');
    const shareId = r.data.invitation.id;
    assert.equal((await lucClient.post('/api/property-shares/'+shareId+'/decision',{decision:'accept'})).status,404,
      'un autre compte ne peut pas accepter');
    assert.equal((await leaClient.post('/api/property-shares/'+shareId+'/decision',{decision:'unknown'})).status,400);
    const accepted = await leaClient.post('/api/property-shares/'+shareId+'/decision',{decision:'accept'});
    assert.equal(accepted.status,200,JSON.stringify(accepted.data));
    assert.equal(accepted.data.invitation.status,'accepted');
    assert.equal((await leaClient.post('/api/property-shares/'+shareId+'/decision',{decision:'accept'})).status,409,
      'double acceptation refusée');
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,48000000,
      'le compte de Camille ne conserve que ses 60 %');
    assert.equal((await leaClient.get('/api/dashboard')).data.totals.assets,32000000,
      'le compte de Léa ne compte que les 40 % acceptés');
    assert.equal((await lucClient.get('/api/dashboard')).data.totals.assets,0,
      'aucun accès aux biens des autres comptes');
    assert.equal((await leaClient.get('/api/holdings/'+id)).status,200,
      'le bien partagé apparaît dans le compte destinataire');
    assert.equal((await lucClient.get('/api/holdings/'+id)).status,404,
      'le même bien reste invisible aux tiers sans accord');
    assert.equal((await lucClient.patch('/api/holdings/'+id,{name:'vol'})).status,404,
      'un éditeur ne peut jamais modifier un bien d’autrui');
    assert.equal((await leaClient.get('/api/holdings')).data.holdings.find(x=>x.id===id).owned_cents,32000000);
    assert.equal((await lucClient.get('/api/holdings')).data.holdings.length,0);
    const detail = (await admin.get('/api/holdings/'+id)).data;
    assert.equal(detail.holding.value_cents,80000000,'valeur unique du bien entier');
    assert.equal(detail.holding.owned_cents,48000000,'60 % dans le patrimoine du titulaire original');
    assert.equal(detail.holding.total_ownership_bp,6000);
    assert.equal((await leaClient.get('/api/holdings/'+id)).data.holding.total_ownership_bp,4000);
    assert.equal(detail.holding.owner_owned_cents,48000000);
    assert.equal(detail.property.ownership_bp,6000,'quote-part initiale inchangée');
    const listing = (await admin.get('/api/holdings')).data.holdings.find(x=>x.id===id);
    assert.equal(listing.total_ownership_bp,6000);
    assert.equal(listing.latent_gain_cents,22500000,'plus-value de la quote-part du compte original');
    assert.equal((await admin.get('/api/holdings/'+id+'/shares')).data.accepted_bp,4000);
    const csv = (await admin.get('/api/export/holdings.csv')).data.toString('utf8');
    assert.match(csv,/Votre quote-part totale/);
    const exported = (await admin.get('/api/export.json')).data;
    assert.equal(exported.real_estate_shares.length,1);
    assert.equal(exported.real_estate_shares[0].recipient_id,lea.id);
    assert.equal(exported.real_estate_shares[0].ownership_bp,4000);

    const imported = await admin.post('/api/admin/import',exported);
    assert.equal(imported.status,200,JSON.stringify(imported.data));
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,48000000);
    assert.equal((await leaClient.get('/api/dashboard')).data.totals.assets,32000000);
    assert.equal((await leaClient.get('/api/property-shares/inbox')).data.accepted.length,1);
    const newShareId = (await leaClient.get('/api/property-shares/inbox')).data.accepted[0].id;
    assert.equal((await lucClient.del('/api/property-shares/'+newShareId)).status,404);
    const revoked = await leaClient.del('/api/property-shares/'+newShareId);
    assert.equal(revoked.status,200,JSON.stringify(revoked.data));
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,48000000);
    assert.equal((await admin.get('/api/holdings/'+id+'/shares')).data.available_bp,4000);

    // Le destinataire refuse une nouvelle proposition : aucune attribution.
    r = await admin.post('/api/holdings/'+id+'/shares',{recipient_id:luc.id,ownership_pct:20});
    assert.equal(r.status,200,JSON.stringify(r.data));
    assert.equal(smtp.messages.length,2);
    const declined = await lucClient.post('/api/property-shares/'+r.data.invitation.id+'/decision',{decision:'decline'});
    assert.equal(declined.status,200);
    assert.equal(declined.data.invitation.status,'declined');
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,48000000);
    assert.equal((await admin.get('/api/holdings/'+id+'/shares')).data.available_bp,4000);

    // Une quote-part réduite peut être acceptée et empêche de dépasser 100 %.
    r = await admin.post('/api/holdings/'+id+'/shares',{recipient_id:luc.id,ownership_pct:25});
    assert.equal(r.status,200);
    assert.equal((await lucClient.post('/api/property-shares/'+r.data.invitation.id+'/decision',{decision:'accept'})).status,200);
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,48000000);
    assert.equal((await lucClient.get('/api/dashboard')).data.totals.assets,20000000); // 25 % du bien
    const badUpdate=await admin.patch('/api/holdings/'+id,{
      category_id:cat.id,name:'Maison indivise',property:{purchase_amount:425000,
        purchased_at:'2004-04-01',property_type:'maison',surface_m2:180,
        address:'12 rue de la Roë, Angers',condition:'bon',ownership_pct:90},
    });
    assert.equal(badUpdate.status,409,'un admin ne peut augmenter sa part au-delà des 100 % avec partage');
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,68000000);
  } finally { await srv.stop(); await smtp.close(); }
});

test('immobilier partagé : interface, courriel et consentement ne sont pas une création d’avoir dupliqué', () => {
  const ui=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
  assert.match(ui,/Partager ce bien/);
  assert.match(ui,/Complément disponible/);
  assert.match(ui,/partages: \{ title: 'Partages immobiliers'/);
  assert.match(ui,/share-decision/);
  assert.match(ui,/share-request-form/);
  assert.match(ui,/En attente/);
});
