import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assistedCampaignSettings, assistedMessageApproval, isLinkedinAssisted } from '../server/services/providers/linkedin-assisted.js';
import { Agent } from '../server/services/agent.js';
import linkedinCookie from '../server/services/providers/linkedin-cookie.js';

test('le compte cookie reste à lecture seule, sans automatisation d’envoi', () => {
  assert.equal(isLinkedinAssisted('linkedin_cookie'), true);
  assert.equal(isLinkedinAssisted('manual'), false);
  assert.equal(linkedinCookie.auto, false);
  assert.deepEqual(linkedinCookie.capabilities, { search: false, invite: false, message: false });
});

test('une campagne par cookies impose approbation humaine et désactive recherche automatique', () => {
  const settings = assistedCampaignSettings({
    validation: 'none', auto_discovery: true, followups_enabled: true, setter_enabled: true,
  }, 'linkedin_cookie');
  assert.equal(settings.validation, 'all');
  assert.equal(settings.auto_discovery, false);
  assert.equal(settings.followups_enabled, true);
  assert.equal(assistedMessageApproval('linkedin_cookie', 'invite', false), true);
  assert.equal(assistedMessageApproval('linkedin_cookie', 'first', false), true);
  assert.equal(assistedMessageApproval('linkedin_cookie', 'followup', undefined), true);
  assert.equal(assistedMessageApproval('linkedin_cookie', 'manual', false), false);
  assert.deepEqual(assistedCampaignSettings({ validation: 'none', auto_discovery: true }, 'simulation'),
    { validation: 'none', auto_discovery: true });
});

test('les brouillons liés à un compte cookie attendent une validation, même sans note d’invitation', async () => {
  const args = [];
  const db = { query: async (...values) => {
    args.push(values);
    return { rows: [{ id: 'message1' }] };
  } };
  const agent = new Agent({ db, config: {}, ai: {}, calendar: {}, activity: {}, providers: {} });
  const campaign = { id: 'campaign1', account_id: 'account1', account_provider: 'linkedin_cookie', settings: { validation: 'none' } };
  for (const [kind, approval] of [['invite', false], ['first', false], ['followup', undefined]]) {
    await agent.enqueue({ id: 'workspace1' }, { id: 'prospect1', campaign_id: campaign.id },
      { kind, body: kind === 'invite' ? '' : 'Bonjour', campaign, approval });
    const last = args.at(-1)[1];
    assert.equal(last[6], 'pending_approval', kind);
    assert.equal(last[3], 'account1');
  }
  await agent.enqueue({ id: 'workspace1' }, { id: 'prospect1', campaign_id: campaign.id },
    { kind: 'manual', body: 'Un message écrit par un humain', campaign, approval: false });
  assert.equal(args.at(-1)[1][6], 'queued');
});

test('la confirmation ne contourne pas la validation et ne double pas les compteurs', () => {
  const inbox = fs.readFileSync(new URL('../server/routes/inbox.js', import.meta.url), 'utf8');
  const agent = fs.readFileSync(new URL('../server/services/agent.js', import.meta.url), 'utf8');
  const core = fs.readFileSync(new URL('../server/routes/core.js', import.meta.url), 'utf8');
  assert.match(inbox, /body\.confirmed !== true/);
  assert.match(inbox, /m\.status !== 'queued'/);
  assert.match(inbox, /\['linkedin_cookie', 'manual'\]\.includes/);
  assert.match(inbox, /status = 'queued' RETURNING id/);
  assert.match(agent, /AND status IN \('queued','sending'\) RETURNING/);
  assert.match(core, /assistedCampaignSettings\(sanitizeSettings/);
  assert.match(core, /campaignAccountProvider/);
  assert.match(core, /Compte LinkedIn non trouvé dans cet espace/);
});

test('l’interface relie campagne, import, validation et confirmation sans envoi direct', () => {
  const campaigns = fs.readFileSync(new URL('../web/src/pages/Campaigns.jsx', import.meta.url), 'utf8');
  const prospects = fs.readFileSync(new URL('../web/src/pages/Prospects.jsx', import.meta.url), 'utf8');
  const inbox = fs.readFileSync(new URL('../web/src/pages/Inbox.jsx', import.meta.url), 'utf8');
  assert.match(campaigns, /import=1/);
  assert.match(campaigns, /filter=approval/);
  assert.match(campaigns, /filter=to_send/);
  assert.match(prospects, /query\.import === '1'/);
  assert.match(inbox, /window\.confirm/);
  assert.match(inbox, /J’ai envoyé sur LinkedIn/);
  assert.match(inbox, /Invitation acceptée/);
  assert.match(inbox, /confirmed: true/);
});
