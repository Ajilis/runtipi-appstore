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
    let cat = cats.find(x=>x.name==='Immobilier');
    const created = await admin.post('/api/holdings', {
      category_id:cat.id,name:'Maison indivise',amount:800000,date:todayIso(),
      property:{purchase_amount:425000,purchased_at:'2004-04-01',property_type:'maison',
        address:'12 rue de la Roë, Angers',surface_m2:180,condition:'bon',ownership_pct:60},
    });
    assert.equal(created.status,200,JSON.stringify(created.data));
    let id = created.data.id;
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,48000000,'avant accord, seulement 60 % pris en compte');
    const initial = (await admin.get('/api/holdings/'+id+'/shares')).data;
    assert.equal(initial.name,'Maison indivise');
    assert.equal(initial.complement_bp,4000,'40 % non attribués');
    assert.equal(initial.default_bp,4000,'le complément est proposé par défaut');
    assert.equal(initial.available_bp,9999,'le titulaire garde au moins 0,01 %');
    assert.equal(initial.accepted_bp,0);
    const recipients = await admin.get('/api/shares/recipients');
    assert.ok(recipients.data.mail_ready);
    assert.ok(recipients.data.recipients.some(x=>x.id===lea.id));
    assert.ok(recipients.data.recipients.some(x=>x.id===noEmail.id && x.email===null),'un compte sans e-mail peut recevoir un partage');
    assert.equal((await leaClient.get('/api/shares/recipients')).status,403);
    assert.equal((await lucClient.get('/api/shares/recipients')).status,200);
    assert.equal((await admin.get('/api/property-shares/inbox')).status,404,'ancienne route retirée');
    assert.equal((await lucClient.post('/api/holdings/'+id+'/shares',{recipient_id:lea.id})).status,404, 'éditeur non propriétaire interdit');
    assert.equal((await admin.post('/api/holdings/'+id+'/shares',{recipient_id:lea.id,ownership_pct:100})).status,400,'100 % impossible');
    r = await admin.post('/api/holdings/'+id+'/shares',{recipient_id:lea.id});
    assert.equal(r.status,200,JSON.stringify(r.data));
    assert.equal(r.data.invitation.ownership_bp,4000,'proposition complémentaire de 40 %');
    assert.equal(r.data.invitation.status,'pending');
    assert.equal(r.data.sent,true);
    assert.equal(smtp.messages.length,1,'un e-mail est envoyé au compte destinataire');
    assert.deepEqual(smtp.messages[0].to,['lea@example.fr']);
    const mail = parseMessage(smtp.messages[0].data);
    assert.match(mail.text,/Maison indivise/);
    assert.match(mail.text,/40 %/);
    assert.match(mail.text,/Immobilier/);
    assert.match(mail.text,/https:\/\/vigie\.exemple\.fr\/#\/avoirs/);
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,48000000,
      'demande en attente : aucune modification du patrimoine');
    let pending = (await admin.get('/api/holdings')).data.holdings.find(x=>x.id===id).sharing;
    assert.equal(pending.role,'owner');
    assert.equal(pending.shares[0].status,'pending','la fiche indique la demande en attente');
    assert.ok(pending.shares[0].created_at && pending.shares[0].sent_at);
    assert.equal((await lucClient.get('/api/shares/inbox')).data.invitations.length,0);
    const inbox = (await leaClient.get('/api/shares/inbox')).data.invitations;
    assert.equal(inbox.length,1);
    assert.equal(inbox[0].holding_name,'Maison indivise');
    assert.equal(inbox[0].category_name,'Immobilier');
    assert.equal(inbox[0].part_cents,32000000,'aperçu de la part proposée');
    assert.equal(inbox[0].sender_name,'Camille Dupont');
    assert.equal((await admin.post('/api/holdings/'+id+'/shares',{recipient_id:luc.id,ownership_pct:70})).status,400,
      'une demande en attente réserve sa quote-part');
    assert.equal((await admin.post('/api/holdings/'+id+'/shares',{recipient_id:lea.id,ownership_pct:10})).status,409,
      'une seule demande active par destinataire');
    const shareId = r.data.invitation.id;
    assert.equal((await lucClient.post('/api/shares/'+shareId+'/decision',{decision:'accept'})).status,404,
      'un autre compte ne peut pas accepter');
    assert.equal((await leaClient.post('/api/shares/'+shareId+'/decision',{decision:'unknown'})).status,400);
    const accepted = await leaClient.post('/api/shares/'+shareId+'/decision',{decision:'accept'});
    assert.equal(accepted.status,200,JSON.stringify(accepted.data));
    assert.equal(accepted.data.invitation.status,'accepted');
    assert.equal(accepted.data.invitation.deducted_bp,0,'la part tient dans le complément');
    assert.equal((await leaClient.post('/api/shares/'+shareId+'/decision',{decision:'accept'})).status,409,
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
    assert.equal(detail.sharing.role,'owner');
    assert.equal(detail.sharing.shares[0].recipient_name,'Léa Martin');
    assert.equal(detail.sharing.shares[0].status,'accepted','la fiche indique l’approbation');
    assert.ok(detail.sharing.shares[0].accepted_at >= detail.sharing.shares[0].created_at,'et sa date');
    const leaDetail = (await leaClient.get('/api/holdings/'+id)).data;
    assert.equal(leaDetail.holding.total_ownership_bp,4000);
    assert.equal(leaDetail.sharing.role,'recipient');
    assert.equal(leaDetail.sharing.owner_name,'Camille Dupont');
    assert.equal(leaDetail.sharing.share.status,'accepted');
    assert.equal(detail.holding.owner_owned_cents,48000000);
    assert.equal(detail.property.ownership_bp,6000,'quote-part initiale inchangée');
    const listing = (await admin.get('/api/holdings')).data.holdings.find(x=>x.id===id);
    assert.equal(listing.total_ownership_bp,6000);
    assert.equal(listing.latent_gain_cents,22500000,'plus-value de la quote-part du compte original');
    assert.equal((await admin.get('/api/holdings/'+id+'/shares')).data.accepted_bp,4000);
    const csv = (await admin.get('/api/export/holdings.csv')).data.toString('utf8');
    assert.match(csv,/Votre quote-part totale/);
    const exported = (await admin.get('/api/export.json')).data;
    assert.equal(exported.holding_shares.length,1);
    assert.equal(exported.holding_shares[0].recipient_id,lea.id);
    assert.equal(exported.holding_shares[0].ownership_bp,4000);
    assert.equal(exported.holdings.find(x=>x.id===id).ownership_bp,6000);

    const imported = await admin.post('/api/import',exported);
    assert.equal(imported.status,200,JSON.stringify(imported.data));
    // La restauration renumérote les avoirs et catégories du compte.
    id = (await admin.get('/api/holdings')).data.holdings.find(x=>x.name==='Maison indivise').id;
    cat = (await admin.get('/api/categories')).data.categories.find(x=>x.name==='Immobilier');
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,48000000);
    assert.equal((await leaClient.get('/api/dashboard')).data.totals.assets,32000000);
    assert.equal((await leaClient.get('/api/shares/inbox')).data.accepted.length,1);
    const newShareId = (await leaClient.get('/api/shares/inbox')).data.accepted[0].id;
    assert.equal((await lucClient.del('/api/shares/'+newShareId)).status,404);
    const revoked = await leaClient.del('/api/shares/'+newShareId);
    assert.equal(revoked.status,200,JSON.stringify(revoked.data));
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,48000000,'part non déduite : rien à rendre');
    assert.equal((await admin.get('/api/holdings/'+id+'/shares')).data.complement_bp,4000);

    // Le destinataire refuse une nouvelle proposition : aucune attribution, refus daté dans la fiche.
    r = await admin.post('/api/holdings/'+id+'/shares',{recipient_id:luc.id,ownership_pct:20});
    assert.equal(r.status,200,JSON.stringify(r.data));
    assert.equal(smtp.messages.length,2);
    const declined = await lucClient.post('/api/shares/'+r.data.invitation.id+'/decision',{decision:'decline'});
    assert.equal(declined.status,200);
    assert.equal(declined.data.invitation.status,'declined');
    assert.ok(declined.data.invitation.declined_at);
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,48000000);
    assert.equal((await admin.get('/api/holdings/'+id+'/shares')).data.complement_bp,4000);
    assert.equal((await admin.get('/api/holdings/'+id)).data.sharing.shares[0].status,'declined');

    // Une quote-part réduite peut être acceptée et empêche de dépasser 100 %.
    r = await admin.post('/api/holdings/'+id+'/shares',{recipient_id:luc.id,ownership_pct:25});
    assert.equal(r.status,200);
    assert.equal((await lucClient.post('/api/shares/'+r.data.invitation.id+'/decision',{decision:'accept'})).status,200);
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,48000000);
    assert.equal((await lucClient.get('/api/dashboard')).data.totals.assets,20000000); // 25 % du bien
    const badUpdate=await admin.patch('/api/holdings/'+id,{
      category_id:cat.id,name:'Maison indivise',property:{purchase_amount:425000,
        purchased_at:'2004-04-01',property_type:'maison',surface_m2:180,
        address:'12 rue de la Roë, Angers',condition:'bon',ownership_pct:90},
    });
    assert.equal(badUpdate.status,409,'un admin ne peut augmenter sa part au-delà des 100 % avec partage');

    // Une part plus grande que le complément réduit la part du titulaire à l'acceptation, puis la lui rend.
    r = await admin.post('/api/holdings/'+id+'/shares',{recipient_id:lea.id,ownership_pct:30});
    assert.equal(r.status,200,JSON.stringify(r.data));
    const bigger = await leaClient.post('/api/shares/'+r.data.invitation.id+'/decision',{decision:'accept'});
    assert.equal(bigger.data.invitation.deducted_bp,1500,'60 + 25 + 30 = 115 % : 15 points retirés au titulaire');
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,36000000,'Camille passe à 45 %');
    assert.equal((await admin.get('/api/holdings/'+id)).data.property.ownership_bp,4500);
    assert.equal((await leaClient.get('/api/dashboard')).data.totals.assets,24000000);
    assert.equal((await leaClient.del('/api/shares/'+r.data.invitation.id)).status,200);
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,48000000,'les 15 points sont rendus');
    assert.equal((await lucClient.get('/api/dashboard')).data.totals.assets,20000000);
  } finally { await srv.stop(); await smtp.close(); }
});

test('tout avoir se partage : compte joint sans e-mail, part du titulaire réduite puis rendue', async () => {
  const srv = await startServer();
  try {
    const admin = client(srv.base), sam = client(srv.base);
    assert.equal((await admin.post('/api/auth/setup', {
      username:'joint_admin',first_name:'Alex',last_name:'Durand',password:PASSWORD,base_currency:'EUR',
    })).status, 200);
    const samUser = (await admin.post('/api/users', {
      username:'sam',first_name:'Sam',last_name:'Durand',role:'viewer',password:PASSWORD,
    })).data.user;
    assert.equal((await sam.post('/api/auth/login',{username:'sam',password:PASSWORD})).status,200);
    const cats = (await admin.get('/api/categories')).data.categories;
    const courant = cats.find(x=>x.name==='Comptes courants').id;
    const created = await admin.post('/api/holdings',{category_id:courant,name:'Compte joint',institution:'Banque',amount:10000,date:todayIso()});
    assert.equal(created.status,200,JSON.stringify(created.data));
    const id = created.data.id;
    let summary = (await admin.get('/api/holdings/'+id+'/shares')).data;
    assert.equal(summary.ownership_bp,10000);
    assert.equal(summary.default_bp,5000,'moitié proposée par défaut pour un avoir détenu à 100 %');
    assert.equal((await admin.get('/api/holdings/'+id)).data.sharing,null,'non partagé');
    assert.equal((await admin.get('/api/shares/recipients')).data.mail_ready,false);
    const r = await admin.post('/api/holdings/'+id+'/shares',{recipient_id:samUser.id});
    assert.equal(r.status,200,JSON.stringify(r.data));
    assert.equal(r.data.sent,false,'pas d’e-mail : la demande attend dans les Avoirs');
    assert.equal(r.data.mail_error,null);
    assert.equal(r.data.invitation.ownership_bp,5000);
    const inbox = (await sam.get('/api/shares/inbox')).data.invitations;
    assert.equal(inbox.length,1);
    assert.equal(inbox[0].part_cents,500000);
    assert.equal(inbox[0].category_name,'Comptes courants');
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,1000000,'en attente : rien ne change');
    assert.equal((await sam.post('/api/shares/'+inbox[0].id+'/decision',{decision:'accept'})).status,200);
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,500000,'Alex garde 50 %');
    assert.equal((await sam.get('/api/dashboard')).data.totals.assets,500000,'Sam reçoit 50 %');
    const mine = (await admin.get('/api/holdings')).data.holdings.find(x=>x.id===id);
    assert.equal(mine.total_ownership_bp,5000);
    assert.equal(mine.sharing.shares[0].status,'accepted');
    assert.equal(mine.sharing.shares[0].deducted_bp,5000);
    const theirs = (await sam.get('/api/holdings')).data.holdings.find(x=>x.id===id);
    assert.equal(theirs.sharing.role,'recipient');
    assert.equal(theirs.sharing.owner_name,'Alex Durand');
    assert.equal(theirs.owned_cents,500000);
    assert.equal((await sam.patch('/api/holdings/'+id,{name:'vol'})).status,403,'lecture seule pour le destinataire');
    assert.equal((await admin.patch('/api/holdings/'+id,{ownership_pct:80})).status,409,'80 + 50 > 100 %');
    assert.equal((await admin.patch('/api/holdings/'+id,{ownership_pct:'abc'})).status,400);
    assert.equal((await admin.del('/api/shares/'+mine.sharing.shares[0].id)).status,200,'le titulaire retire le partage');
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,1000000,'la part retirée est rendue au titulaire');
    assert.equal((await sam.get('/api/dashboard')).data.totals.assets,0);
    assert.equal((await sam.get('/api/holdings/'+id)).status,404);
    assert.equal((await admin.get('/api/holdings/'+id)).data.sharing.shares[0].status,'revoked','historique conservé');
    // Quote-part d'un compte joint avec une personne sans compte Vigie.
    assert.equal((await admin.patch('/api/holdings/'+id,{ownership_pct:'50'})).status,200);
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,500000);
    summary = (await admin.get('/api/holdings/'+id+'/shares')).data;
    assert.equal(summary.complement_bp,5000);
    assert.equal(summary.default_bp,5000,'le complément est proposé');
    // Suppression du compte destinataire : la part retirée au titulaire lui est rendue.
    assert.equal((await admin.patch('/api/holdings/'+id,{ownership_pct:100})).status,200);
    const again = await admin.post('/api/holdings/'+id+'/shares',{recipient_id:samUser.id,ownership_pct:'30'});
    assert.equal(again.status,200,JSON.stringify(again.data));
    assert.equal((await sam.post('/api/shares/'+again.data.invitation.id+'/decision',{decision:'accept'})).status,200);
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,700000);
    const removed = await admin.del('/api/users/'+samUser.id);
    assert.equal(removed.status,200,JSON.stringify(removed.data));
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,1000000);
    // Avoir clôturé : pas de nouveau partage.
    const other = (await admin.post('/api/users', {username:'sam2',first_name:'Sam',last_name:'Bis',role:'viewer',password:PASSWORD})).data.user;
    assert.equal((await admin.post('/api/holdings/'+id+'/close',{date:todayIso()})).status,200);
    assert.equal((await admin.post('/api/holdings/'+id+'/shares',{recipient_id:other.id})).status,409);
  } finally { await srv.stop(); }
});

test('partage : plus de menu dédié, état affiché sur les avoirs, demandes en bandeau', () => {
  const ui=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
  assert.doesNotMatch(ui,/partages: \{ title:/,'plus de page « Partages immobiliers »');
  assert.doesNotMatch(ui,/\$\{link\('partages'\)\}/,'plus d’entrée de menu');
  assert.match(ui,/if \(name === 'partages'\) \{ name = 'avoirs'/,'anciens liens redirigés vers les Avoirs');
  assert.equal((ui.match(/\$\{shareBanner\(inbox\)\}/g) || []).length,3,'bandeau dans les Avoirs et le tableau de bord (vide ou non)');
  assert.match(ui,/\$\{shareTag\(h\)\}/,'étiquette dans la liste des avoirs');
  assert.match(ui,/\$\{sharePanel\(h, sharing, mayEdit\)\}/,'section Partage dans chaque avoir');
  assert.match(ui,/<dt>Partagé<\/dt>/);
  assert.match(ui,/Approuvé le/);
  assert.match(ui,/En attente de son accord/);
  assert.match(ui,/Refusé le/);
  assert.match(ui,/data-action="share-decision"/);
  assert.match(ui,/share-request-form/);
  assert.match(ui,/name="holding_pct"/);
  assert.match(ui,/\$\{shareHeadline\(sharing\)\}/,'état du partage en tête du détail de l’avoir');
  assert.match(ui,/En attente de validation par/);
  assert.match(ui,/Partage refusé par/);
});

test('comptes Vigie indépendants : patrimoines et exports séparés, contrôle des URL et de la mise à jour rapide', async () => {
  const srv=await startServer();
  try {
    const admin=client(srv.base), editor=client(srv.base), viewer=client(srv.base);
    assert.equal((await admin.post('/api/auth/setup',{
      username:'indep_admin',first_name:'Alice',last_name:'Privée',
      password:PASSWORD,base_currency:'EUR',
    })).status,200);
    assert.equal((await admin.post('/api/users',{
      username:'indep_editor',first_name:'Bruno',last_name:'Privé',
      email:'bruno@exemple.fr',role:'editor',password:PASSWORD,
    })).status,200);
    assert.equal((await admin.post('/api/users',{
      username:'indep_viewer',first_name:'Claire',last_name:'Privée',
      email:'claire@exemple.fr',role:'viewer',password:PASSWORD,
    })).status,200);
    assert.equal((await editor.post('/api/auth/login',{username:'indep_editor',password:PASSWORD})).status,200);
    assert.equal((await viewer.post('/api/auth/login',{username:'indep_viewer',password:PASSWORD})).status,200);
    const cats=(await admin.get('/api/categories')).data.categories;
    const editorCats=(await editor.get('/api/categories')).data.categories;
    const courant=cats.find(x=>x.name==='Comptes courants').id;
    const epargne=editorCats.find(x=>x.name==='Épargne réglementée').id;
    assert.equal(editorCats.length,cats.length,'chaque compte reçoit les catégories par défaut');
    assert.ok(!editorCats.some((c)=>cats.some((a)=>a.id===c.id)),'catégories propres à chaque compte');
    assert.equal((await editor.post('/api/holdings',{category_id:courant,name:'Intrus',amount:1})).status,400,
      'impossible de ranger un avoir dans la catégorie d’un autre compte');
    assert.equal((await editor.patch('/api/categories/'+courant,{name:'Piratée'})).status,404);
    assert.equal((await editor.del('/api/categories/'+courant)).status,404);
    assert.equal((await editor.patch('/api/categories/'+editorCats.find(x=>x.name==='Bourse').id,{name:'Actions de Bruno',target_pct:80})).status,200);
    assert.ok(cats.some(x=>x.name==='Bourse') && (await admin.get('/api/categories')).data.categories.find(x=>x.name==='Bourse').target_pct!==80,
      'la catégorie et la cible de l’administrateur ne changent pas');
    const privateA=await admin.post('/api/holdings',{
      category_id:courant,name:'Compte Alice privé',institution:'Banque privée Alice',
      owner:'Titulaire Alice unique',amount:10000,date:todayIso(),
    });
    const privateB=await editor.post('/api/holdings',{
      category_id:epargne,name:'Livret Bruno privé',institution:'Banque privée Bruno',
      owner:'Titulaire Bruno unique',amount:25000,date:todayIso(),
    });
    assert.equal(privateA.status,200,JSON.stringify(privateA.data));
    assert.equal(privateB.status,200,JSON.stringify(privateB.data));
    const aid=privateA.data.id,bid=privateB.data.id;
    assert.deepEqual((await admin.get('/api/holdings')).data.holdings.map(x=>x.id),[aid]);
    assert.deepEqual((await editor.get('/api/holdings')).data.holdings.map(x=>x.id),[bid]);
    assert.deepEqual((await viewer.get('/api/holdings')).data.holdings,[]);
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,1000000);
    assert.equal((await editor.get('/api/dashboard')).data.totals.assets,2500000);
    assert.equal((await viewer.get('/api/dashboard')).data.totals.assets,0);
    assert.equal((await admin.get('/api/holdings/'+bid)).status,404);
    assert.equal((await editor.get('/api/holdings/'+aid)).status,404);
    assert.equal((await viewer.get('/api/holdings/'+aid)).status,404);
    assert.equal((await viewer.get('/api/holdings/'+bid)).status,404);
    assert.equal((await editor.patch('/api/holdings/'+aid,{name:'usurpation'})).status,404);
    assert.equal((await admin.patch('/api/holdings/'+bid,{name:'usurpation'})).status,404);
    assert.equal((await editor.del('/api/holdings/'+aid)).status,404);
    assert.equal((await admin.post('/api/holdings/'+bid+'/valuations',{amount:999999})).status,404);
    assert.equal((await editor.post('/api/valuations/bulk',{
      date:todayIso(),items:[{holding_id:aid,amount:'999999'}],
    })).status,400);
    const detail=(await admin.get('/api/holdings/'+aid)).data;
    assert.equal((await editor.del('/api/valuations/'+detail.valuations[0].id)).status,404);
    const adminSettings=(await admin.get('/api/settings')).data;
    const editorSettings=(await editor.get('/api/settings')).data;
    assert.ok(adminSettings.institutions.includes('Banque privée Alice'));
    assert.ok(!adminSettings.institutions.includes('Banque privée Bruno'));
    assert.ok(editorSettings.institutions.includes('Banque privée Bruno'));
    assert.ok(!editorSettings.institutions.includes('Banque privée Alice'));
    const names=(await editor.get('/api/owners')).data.owners.map(x=>x.name);
    assert.ok(names.includes('Titulaire Bruno unique'));
    assert.ok(!names.includes('Titulaire Alice unique'));
    const expAdmin=(await admin.get('/api/export.json')).data;
    const expEditor=(await editor.get('/api/export.json')).data;
    assert.deepEqual(expAdmin.holdings.map(x=>x.id),[aid]);
    assert.deepEqual(expEditor.holdings.map(x=>x.id),[bid]);
    assert.ok(!JSON.stringify(expEditor).includes('Compte Alice privé'));
    assert.ok(!JSON.stringify(expAdmin).includes('Livret Bruno privé'));
    const csvEditor=(await editor.get('/api/export/holdings.csv')).data.toString('utf8');
    assert.match(csvEditor,/Livret Bruno privé/);
    assert.doesNotMatch(csvEditor,/Compte Alice privé/);
    const csvHistory=(await viewer.get('/api/export/history.csv')).data.toString('utf8');
    assert.doesNotMatch(csvHistory,/Compte Alice privé|Livret Bruno privé/);
    const restoredA=await admin.post('/api/import',expAdmin);
    assert.equal(restoredA.status,200,JSON.stringify(restoredA.data));
    assert.equal((await editor.get('/api/holdings/'+bid)).status,200,
      'la restauration de l’administrateur n’efface pas les avoirs de Bruno');
    assert.deepEqual((await admin.get('/api/holdings')).data.holdings.map(x=>x.name),['Compte Alice privé']);
    const restoredB=await editor.post('/api/import',expEditor);
    assert.equal(restoredB.status,200,'chacun restaure son propre export');
    assert.deepEqual((await editor.get('/api/holdings')).data.holdings.map(x=>x.name),['Livret Bruno privé']);
    assert.equal((await admin.get('/api/dashboard')).data.totals.assets,1000000);
    assert.equal((await viewer.post('/api/import',expEditor)).status,403,'lecture seule : pas de restauration');
  } finally { await srv.stop(); }
});
