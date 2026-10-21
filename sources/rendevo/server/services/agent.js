// Business logic of the prospecting agent. Shared by the worker, the HTTP API
// and the MCP connector.
import { qualify, normalizeSignal } from './scoring.js';
import { normalizeLinkedinUrl, splitName, rand, addMinutes, startOfIsoWeek, formatSlotFr } from '../lib/util.js';
import { assistedMessageApproval } from './providers/linkedin-assisted.js';

export const DEFAULT_SEQUENCE = [
  { type: 'invite', with_note: false },
  { type: 'message', delay_hours: 3, instructions: '' },
  { type: 'followup', delay_days: 3, instructions: 'Apporte une preuve concrète (résultat client, chiffre).' },
  { type: 'followup', delay_days: 5, instructions: 'Propose une ressource utile ou un exemple adapté à son poste.' },
  { type: 'followup', delay_days: 7, instructions: 'Dernier message, léger, demande quand revenir vers lui.' },
];

export const DEFAULT_CAMPAIGN_SETTINGS = {
  validation: 'first', // none | first | all
  setter_enabled: true,
  followups_enabled: true,
  language: 'auto',
  min_score: 40,
  auto_discovery: false,
  weekly_prospects: 100,
};

const COLD_KINDS = ['invite', 'first', 'followup', 'callback'];

export class Agent {
  constructor({ db, config, ai, calendar, activity, providers, logger = console }) {
    this.db = db;
    this.config = config;
    this.ai = ai;
    this.calendar = calendar;
    this.activity = activity;
    this.providers = providers;
    this.logger = logger;
  }

  // ----------------------------------------------------------- loaders
  async workspace(id) {
    const { rows } = await this.db.query(
      `SELECT w.*, (SELECT u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = w.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner_name
         FROM workspaces w WHERE w.id = $1`,
      [id],
    );
    const ws = rows[0];
    if (ws) ws.ownerName = ws.owner_name;
    return ws;
  }

  async campaign(id) {
    if (!id) return null;
    const { rows } = await this.db.query('SELECT c.*, a.provider AS account_provider FROM campaigns c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = $1', [id]);
    const c = rows[0];
    if (c) {
      c.settings = { ...DEFAULT_CAMPAIGN_SETTINGS, ...c.settings };
      if (!Array.isArray(c.sequence) || !c.sequence.length) c.sequence = DEFAULT_SEQUENCE;
    }
    return c;
  }

  async prospect(id) {
    const { rows } = await this.db.query('SELECT * FROM prospects WHERE id = $1', [id]);
    return rows[0];
  }

  async account(id) {
    if (!id) return null;
    const { rows } = await this.db.query('SELECT * FROM accounts WHERE id = $1', [id]);
    return rows[0] ? this.decryptAccount(rows[0]) : null;
  }

  decryptAccount(a) {
    const cfg = { ...a.config };
    if (cfg.api_key_enc) cfg.api_key = this.ai.vault.decrypt(cfg.api_key_enc);
    if (cfg.li_at_enc) cfg.li_at = this.ai.vault.decrypt(cfg.li_at_enc);
    if (cfg.jsessionid_enc) cfg.jsessionid = this.ai.vault.decrypt(cfg.jsessionid_enc);
    return { ...a, config: cfg };
  }

  publicUrl(ws) {
    return (this.config.publicUrl || ws?.settings?.public_url || '').replace(/\/+$/, '');
  }

  isSimulation(account) {
    return account && account.provider === 'simulation';
  }

  speed(account) {
    return this.isSimulation(account) ? Math.max(1, Number(this.config.simulation?.speed) || 1) : 1;
  }

  // ------------------------------------------------------------ import
  /**
   * Imports prospects with deduplication and qualification.
   * items: [{ full_name | first_name/last_name, linkedin_url, title, company, ... signals }]
   */
  async importProspects(ws, items, { campaignId = null, source = 'import' } = {}) {
    const campaign = campaignId ? await this.campaign(campaignId) : null;
    const icp = campaign?.icp && Object.keys(campaign.icp).length ? campaign.icp : ws.settings?.icp || {};
    const result = { created: 0, duplicates: 0, invalid: 0, excluded: 0, ids: [] };
    for (const raw of items.slice(0, 2000)) {
      const url = normalizeLinkedinUrl(raw.linkedin_url);
      let full = String(raw.full_name || `${raw.first_name || ''} ${raw.last_name || ''}`).trim();
      if (!full && url) full = decodeURIComponent(url.split('/in/')[1] || '').replace(/[-_]+/g, ' ').replace(/\d+$/, '').trim();
      if (!full || (!url && !raw.email)) { result.invalid++; continue; }
      const names = splitName(full);
      const p = {
        full_name: full.slice(0, 200),
        first_name: (raw.first_name || names.first).slice(0, 100),
        last_name: (raw.last_name || names.last).slice(0, 100),
        title: String(raw.title || '').slice(0, 200),
        headline: String(raw.headline || raw.title || '').slice(0, 300),
        company: String(raw.company || '').slice(0, 200),
        industry: String(raw.industry || '').slice(0, 120),
        location: String(raw.location || '').slice(0, 160),
        linkedin_url: url,
        provider_id: raw.provider_id || null,
        email: raw.email || null,
        phone: raw.phone || null,
        notes: String(raw.notes || '').slice(0, 2000),
        tags: Array.isArray(raw.tags) ? raw.tags : String(raw.tags || '').split(/[,;]/).map((t) => t.trim()).filter(Boolean),
        signals: (raw.signals || []).map(normalizeSignal),
        network_distance: raw.network_distance,
        source: raw.source || source,
      };
      const q = qualify(p, icp, { minScore: campaign?.settings?.min_score });
      const status = q.excluded ? 'excluded' : q.qualified ? 'qualified' : 'low_fit';
      if (q.excluded) result.excluded++;
      const alreadyConnected = p.network_distance === 'FIRST_DEGREE';
      try {
        const { rows } = await this.db.query(
          `INSERT INTO prospects (workspace_id, campaign_id, full_name, first_name, last_name, title, headline, company, industry, location,
              linkedin_url, provider_id, email, phone, notes, tags, signals, source, fit_score, heat, fit_reasoning, status, step_index, next_action_at, connected_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
           ON CONFLICT DO NOTHING RETURNING id`,
          [ws.id, campaign?.id || null, p.full_name, p.first_name, p.last_name, p.title, p.headline, p.company, p.industry, p.location,
            p.linkedin_url, p.provider_id, p.email, p.phone, p.notes, p.tags, JSON.stringify(p.signals), p.source,
            q.score, q.heat, q.reasoning, status === 'qualified' && alreadyConnected ? 'connected' : status,
            status === 'qualified' && alreadyConnected ? 1 : 0,
            status === 'qualified' && campaign ? new Date() : null,
            alreadyConnected ? new Date() : null],
        );
        if (rows[0]) {
          result.created++;
          result.ids.push(rows[0].id);
          await this.activity.log(ws.id, 'prospect.found', { prospectId: rows[0].id, campaignId: campaign?.id, data: { source: p.source, heat: q.heat, score: q.score } });
        } else result.duplicates++;
      } catch (e) {
        if (e.code === '23505') result.duplicates++;
        else throw e;
      }
    }
    return result;
  }

  async requalify(ws, prospectId) {
    const p = await this.prospect(prospectId);
    const campaign = await this.campaign(p.campaign_id);
    const icp = campaign?.icp && Object.keys(campaign.icp).length ? campaign.icp : ws.settings?.icp || {};
    const q = qualify(p, icp, { minScore: campaign?.settings?.min_score });
    let status = p.status;
    if (['new', 'qualified', 'low_fit', 'excluded'].includes(p.status)) status = q.excluded ? 'excluded' : q.qualified ? 'qualified' : 'low_fit';
    await this.db.query(
      `UPDATE prospects SET fit_score = $2, heat = $3, fit_reasoning = $4, status = $5,
          next_action_at = CASE WHEN $5 = 'qualified' AND campaign_id IS NOT NULL AND next_action_at IS NULL THEN now() ELSE next_action_at END,
          updated_at = now() WHERE id = $1`,
      [p.id, q.score, q.heat, q.reasoning, status],
    );
    return { ...q, status };
  }

  // ---------------------------------------------------------- messaging
  needsApproval(campaign, kind) {
    const v = campaign?.settings?.validation || 'none';
    if (kind === 'manual') return false;
    if (v === 'all') return true;
    if (v === 'first') return kind === 'first' || (kind === 'invite');
    return false;
  }

  async enqueue(ws, p, { kind, body, campaign, accountId, scheduledAt, approval, meta = {} }) {
    const needs = assistedMessageApproval(campaign?.account_provider, kind, approval ?? this.needsApproval(campaign, kind));
    const { rows } = await this.db.query(
      `INSERT INTO messages (workspace_id, prospect_id, campaign_id, account_id, direction, kind, body, status, scheduled_at, meta)
       VALUES ($1, $2, $3, $4, 'out', $5, $6, $7, $8, $9) RETURNING *`,
      [ws.id, p.id, campaign?.id || p.campaign_id || null, accountId || campaign?.account_id || null, kind, body, needs ? 'pending_approval' : 'queued', scheduledAt || new Date(), JSON.stringify(meta)],
    );
    return rows[0];
  }

  async history(prospectId) {
    const { rows } = await this.db.query(
      `SELECT direction, kind, body, coalesce(sent_at, created_at) AS at FROM messages
        WHERE prospect_id = $1 AND status IN ('sent', 'received') ORDER BY coalesce(sent_at, created_at)`,
      [prospectId],
    );
    return rows;
  }

  async mediaLink(ws, mediaId) {
    if (!mediaId) return null;
    const { rows } = await this.db.query('SELECT * FROM media WHERE id = $1 AND workspace_id = $2', [mediaId, ws.id]);
    if (!rows[0]) return null;
    const pub = this.publicUrl(ws);
    return pub ? { ...rows[0], url: `${pub}/v/${rows[0].share_token}` } : null;
  }

  /** Called when a prospect's next_action_at is due. Generates the next step. */
  async advance(prospectId) {
    const p = await this.prospect(prospectId);
    if (!p || !p.campaign_id) return;
    const campaign = await this.campaign(p.campaign_id);
    const ws = await this.workspace(p.workspace_id);
    if (!campaign || campaign.status !== 'active' || !ws.agent_enabled) return;
    if (p.needs_human || p.setter_state?.paused) return;
    const steps = campaign.sequence;
    // Clear the trigger first so a failure never loops.
    await this.db.query('UPDATE prospects SET next_action_at = NULL, updated_at = now() WHERE id = $1', [p.id]);
    const pending = await this.db.query(`SELECT 1 FROM messages WHERE prospect_id = $1 AND status IN ('queued','pending_approval') AND kind = ANY($2)`, [p.id, COLD_KINDS]);
    if (pending.rows.length) return;

    if (p.status === 'qualified') {
      const step = steps[0] || { type: 'invite' };
      const body = step.with_note ? await this.ai.writeMessage(ws, campaign, p, { kind: 'invite', step }) : '';
      await this.enqueue(ws, p, { kind: 'invite', body, campaign, approval: step.with_note ? undefined : false });
      return;
    }
    if (p.status === 'connected' && p.step_index <= 1) {
      const step = steps[1] || { type: 'message' };
      const body = await this.ai.writeMessage(ws, campaign, p, { kind: 'first', step, history: await this.history(p.id) });
      await this.enqueue(ws, p, { kind: 'first', body, campaign });
      return;
    }
    if (p.status === 'contacted' && campaign.settings.followups_enabled && p.step_index >= 2 && p.step_index < steps.length) {
      const step = { ...steps[p.step_index], number: p.step_index - 1 };
      const media = await this.mediaLink(ws, step.media_id);
      const body = await this.ai.writeMessage(ws, campaign, p, { kind: 'followup', step, history: await this.history(p.id), media });
      await this.enqueue(ws, p, { kind: 'followup', body, campaign, meta: { step: p.step_index, media_id: step.media_id || null } });
      return;
    }
    if (p.status === 'callback') {
      const body = await this.ai.writeMessage(ws, campaign, p, { kind: 'callback', step: { instructions: p.callback_note ? `Le prospect avait dit : « ${p.callback_note} »` : '' }, history: await this.history(p.id) });
      await this.enqueue(ws, p, { kind: 'callback', body, campaign });
    }
  }

  /** Bookkeeping after a message has actually been sent (automatically or by hand). */
  async onSent(messageId, providerResult = {}) {
    const { rows } = await this.db.query(
      `UPDATE messages SET status = 'sent', sent_at = now(), error = NULL, provider_message_id = coalesce($2, provider_message_id) WHERE id = $1 AND status IN ('queued','sending') RETURNING *`,
      [messageId, providerResult.message_id || null],
    );
    const m = rows[0];
    if (!m) return;
    const p = await this.prospect(m.prospect_id);
    const campaign = await this.campaign(p.campaign_id);
    const steps = campaign?.sequence || DEFAULT_SEQUENCE;
    const account = await this.account(m.account_id);
    const speed = this.speed(account);
    if (m.account_id) {
      const col = m.kind === 'invite' ? 'invites' : 'messages';
      await this.db.query(
        `INSERT INTO usage (account_id, day, ${col}) VALUES ($1, current_date, 1)
         ON CONFLICT (account_id, day) DO UPDATE SET ${col} = usage.${col} + 1`,
        [m.account_id],
      );
    }
    const updates = { last_contact_at: new Date() };
    if (providerResult.chat_id) updates.chat_id = providerResult.chat_id;
    if (providerResult.provider_id) updates.provider_id = providerResult.provider_id;
    const delayAt = (days) => new Date(Date.now() + (days * 86400e3) / speed);
    switch (m.kind) {
      case 'invite':
        Object.assign(updates, { status: 'invited', invited_at: new Date(), step_index: 1 });
        await this.activity.log(p.workspace_id, 'invite.sent', { prospectId: p.id, campaignId: p.campaign_id });
        break;
      case 'first': {
        const next = steps[2];
        Object.assign(updates, { status: p.status === 'connected' ? 'contacted' : p.status, step_index: 2, next_action_at: next && campaign?.settings?.followups_enabled !== false ? delayAt(next.delay_days || 3) : null });
        await this.activity.log(p.workspace_id, 'message.sent', { prospectId: p.id, campaignId: p.campaign_id, data: { kind: m.kind } });
        break;
      }
      case 'followup': {
        const idx = (m.meta?.step ?? p.step_index) + 1;
        const next = steps[idx];
        Object.assign(updates, { step_index: idx, next_action_at: next && p.status === 'contacted' ? delayAt(next.delay_days || 4) : null });
        await this.activity.log(p.workspace_id, 'message.sent', { prospectId: p.id, campaignId: p.campaign_id, data: { kind: m.kind, step: idx - 1 } });
        break;
      }
      case 'callback':
        Object.assign(updates, { status: 'contacted', step_index: steps.length, callback_at: null });
        await this.activity.log(p.workspace_id, 'message.sent', { prospectId: p.id, campaignId: p.campaign_id, data: { kind: m.kind } });
        break;
      default:
        await this.activity.log(p.workspace_id, 'message.sent', { prospectId: p.id, campaignId: p.campaign_id, data: { kind: m.kind } });
    }
    await this.updateProspect(p.id, updates);
    return m;
  }

  async updateProspect(id, fields) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    const vals = keys.map((k) => (k === 'setter_state' ? JSON.stringify(fields[k]) : fields[k]));
    await this.db.query(`UPDATE prospects SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [id, ...vals]);
  }

  async mergeSetterState(id, patch) {
    await this.db.query(`UPDATE prospects SET setter_state = setter_state || $2::jsonb, updated_at = now() WHERE id = $1`, [id, JSON.stringify(patch)]);
  }

  async onAccepted(prospectId) {
    const p = await this.prospect(prospectId);
    if (!p || p.status !== 'invited') return;
    const campaign = await this.campaign(p.campaign_id);
    const account = await this.account(campaign?.account_id);
    const step = campaign?.sequence?.[1] || { delay_hours: 3 };
    const delayMs = ((step.delay_hours ?? 3) * 3600e3 * rand(0.8, 1.3)) / this.speed(account);
    await this.updateProspect(p.id, { status: 'connected', connected_at: new Date(), step_index: 1, next_action_at: new Date(Date.now() + delayMs) });
    await this.activity.log(p.workspace_id, 'invite.accepted', { prospectId: p.id, campaignId: p.campaign_id, data: { name: p.full_name } });
  }

  /** Records an inbound message and lets the AI setter answer if allowed. */
  async onIncoming(prospectId, { text, at, providerMessageId, chatId } = {}) {
    const p = await this.prospect(prospectId);
    if (!p) return null;
    if (providerMessageId) {
      const dup = await this.db.query('SELECT 1 FROM messages WHERE prospect_id = $1 AND provider_message_id = $2', [p.id, providerMessageId]);
      if (dup.rows.length) return null;
    }
    const { rows } = await this.db.query(
      `INSERT INTO messages (workspace_id, prospect_id, campaign_id, direction, kind, body, status, sent_at, provider_message_id)
       VALUES ($1, $2, $3, 'in', 'reply', $4, 'received', $5, $6) RETURNING *`,
      [p.workspace_id, p.id, p.campaign_id, String(text).slice(0, 8000), at ? new Date(at) : new Date(), providerMessageId || null],
    );
    // A reply stops the cadence.
    await this.db.query(
      `UPDATE messages SET status = 'cancelled' WHERE prospect_id = $1 AND status IN ('queued', 'pending_approval') AND kind = ANY($2)`,
      [p.id, COLD_KINDS],
    );
    const first = !p.last_reply_at;
    const newStatus = ['meeting', 'won', 'lost'].includes(p.status) ? p.status : 'replied';
    await this.updateProspect(p.id, { status: newStatus, last_reply_at: new Date(), next_action_at: null, ...(chatId ? { chat_id: chatId } : {}), ...(p.status === 'invited' ? { connected_at: new Date() } : {}) });
    await this.activity.log(p.workspace_id, 'message.received', { prospectId: p.id, campaignId: p.campaign_id, data: { first } });
    if (first) await this.activity.log(p.workspace_id, 'prospect.replied', { prospectId: p.id, campaignId: p.campaign_id, data: { name: p.full_name, text: String(text).slice(0, 500) } });

    const campaign = await this.campaign(p.campaign_id);
    if (campaign && campaign.settings.setter_enabled && !p.setter_state?.paused && !p.needs_human) {
      try {
        await this.runSetter(p.id);
      } catch (e) {
        this.logger.error('[setter]', e);
        await this.handoff(p, 'Le setter a rencontré une erreur : ' + e.message);
      }
    } else if (!p.needs_human) {
      await this.handoff(p, campaign ? 'Nouvelle réponse (setter désactivé ou en pause)' : 'Nouvelle réponse hors campagne');
    }
    return rows[0];
  }

  async handoff(p, reason) {
    await this.updateProspect(p.id, { needs_human: true, human_reason: reason });
    await this.activity.log(p.workspace_id, 'prospect.handoff', { prospectId: p.id, campaignId: p.campaign_id, data: { name: p.full_name, reason } });
  }

  setterDelay(account) {
    // Human-like reply delay: 3 to 25 minutes.
    return new Date(Date.now() + rand(3, 25) * 60e3 / this.speed(account));
  }

  async runSetter(prospectId) {
    const p = await this.prospect(prospectId);
    const ws = await this.workspace(p.workspace_id);
    const campaign = await this.campaign(p.campaign_id);
    const account = await this.account(campaign?.account_id);
    const tz = this.calendar.availability(ws).timezone;
    const state = p.setter_state || {};
    if ((state.auto_replies || 0) >= 8) return this.handoff(p, 'Conversation longue : reprise humaine conseillée');
    const history = await this.history(p.id);
    const slots = p.status === 'meeting' ? [] : await this.calendar.freeSlots(ws, { count: 3, spread: true, excludeProspectId: p.id });
    const turn = await this.ai.setterTurn(ws, campaign, p, { history, slots, timezone: tz });
    const lang = this.ai.languageFor(p, campaign);
    let reply = (turn.reply || '').trim();
    const statePatch = { auto_replies: (state.auto_replies || 0) + (reply ? 1 : 0), last_intent: turn.intent };
    let kind = 'setter';

    switch (turn.intent) {
      case 'slot_choice': {
        const proposed = state.proposed || [];
        const iso = proposed[turn.chosen_slot];
        if (iso && (await this.calendar.isFree(ws, iso, p.id))) {
          const meeting = await this.calendar.book(ws, { prospect: p, startIso: iso, source: 'setter' });
          const pub = this.publicUrl(ws);
          const label = formatSlotFr(new Date(iso), tz);
          const ics = pub ? `${pub}/api/public/meetings/${meeting.token}.ics` : '';
          reply = lang === 'fr'
            ? `Parfait, c'est noté pour ${label}. Le lien de la visio : ${meeting.meeting_url}${ics ? `\nL'invitation pour votre agenda : ${ics}` : ''}\nÀ très vite !`
            : `Great, you're booked for ${new Date(iso).toLocaleString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}. Video link: ${meeting.meeting_url}${ics ? `\nCalendar invite: ${ics}` : ''}\nTalk soon!`;
          kind = 'confirmation';
          statePatch.proposed = [];
          await this.updateProspect(p.id, { status: 'meeting', stage: p.stage === 'nouveau' || p.stage === 'en_discussion' ? 'rdv_planifie' : p.stage });
          await this.activity.log(ws.id, 'meeting.booked', { prospectId: p.id, campaignId: p.campaign_id, data: { meeting_id: meeting.id, starts_at: iso, name: p.full_name } });
          await this.checkGoal(ws);
        } else {
          const fresh = await this.calendar.freeSlots(ws, { count: 3, spread: true, excludeProspectId: p.id });
          statePatch.proposed = fresh.map((s) => s.iso);
          statePatch.proposed_at = new Date().toISOString();
          reply = lang === 'fr'
            ? `Ce créneau vient d'être pris, désolé. Je peux ${fresh.map((s) => s.label).join(', ou ')}. Lequel préférez-vous ?`
            : `That slot was just taken, sorry. I can do ${fresh.map((s) => s.label_en).join(', or ')}. Which works best?`;
        }
        break;
      }
      case 'interested':
      case 'question':
      case 'objection': {
        if (slots.length && (turn.propose_slots || turn.intent === 'interested')) {
          statePatch.proposed = slots.map((s) => s.iso);
          statePatch.proposed_at = new Date().toISOString();
          const mentioned = slots.some((s) => reply.includes(s.label) || reply.includes(s.label_en));
          if (reply && !mentioned) reply += lang === 'fr' ? `\n\nJe peux ${slots.map((s) => s.label).join(', ou ')}.` : `\n\nI can do ${slots.map((s) => s.label_en).join(', or ')}.`;
        }
        if (p.stage === 'nouveau') await this.updateProspect(p.id, { stage: 'en_discussion' });
        break;
      }
      case 'later': {
        const date = turn.callback_date ? new Date(`${turn.callback_date}T09:00:00Z`) : new Date(Date.now() + 45 * 86400e3);
        const last = [...history].reverse().find((m) => m.direction === 'in');
        await this.updateProspect(p.id, { status: 'callback', callback_at: date, callback_note: last ? last.body.slice(0, 500) : '', next_action_at: date });
        await this.activity.log(ws.id, 'callback.scheduled', { prospectId: p.id, campaignId: p.campaign_id, data: { date: date.toISOString() } });
        break;
      }
      case 'not_interested':
        await this.updateProspect(p.id, { status: 'lost', stage: 'perdu' });
        break;
      case 'handoff':
        reply = '';
        await this.mergeSetterState(p.id, statePatch);
        return this.handoff(p, turn.handoff_reason || 'Cas à traiter par vous');
      case 'courtesy':
      default:
        break;
    }
    await this.mergeSetterState(p.id, statePatch);
    if (reply) {
      await this.enqueue(ws, p, {
        kind,
        body: reply,
        campaign,
        scheduledAt: this.setterDelay(account),
        approval: campaign?.settings?.validation === 'all',
        meta: { intent: turn.intent, source: turn.source },
      });
    }
    return turn;
  }

  async checkGoal(ws) {
    const goal = ws.settings?.goal?.meetings_per_week || 5;
    const tz = this.calendar.availability(ws).timezone;
    const weekStart = startOfIsoWeek(new Date(), tz);
    const { rows } = await this.db.query(
      `SELECT count(*)::int AS n FROM events WHERE workspace_id = $1 AND type = 'meeting.booked' AND created_at >= $2`,
      [ws.id, weekStart],
    );
    if (rows[0].n === goal) await this.activity.log(ws.id, 'goal.reached', { data: { goal, week_start: weekStart.toISOString() } });
  }

  /** Meeting status changes coming from the user (agenda). */
  async meetingStatus(ws, meetingId, status) {
    const { rows } = await this.db.query('UPDATE meetings SET status = $3 WHERE id = $1 AND workspace_id = $2 RETURNING *', [meetingId, ws.id, status]);
    const m = rows[0];
    if (!m) return null;
    if (!m.prospect_id) return m;
    const p = await this.prospect(m.prospect_id);
    const campaign = await this.campaign(p.campaign_id);
    if (status === 'no_show') {
      const slots = await this.calendar.freeSlots(ws, { count: 3, spread: true, excludeProspectId: p.id });
      const body = await this.ai.writeMessage(ws, campaign, p, { kind: 'noshow', history: await this.history(p.id), slots });
      await this.mergeSetterState(p.id, { proposed: slots.map((s) => s.iso), proposed_at: new Date().toISOString() });
      await this.updateProspect(p.id, { status: 'replied' });
      if (campaign) await this.enqueue(ws, p, { kind: 'noshow', body, campaign });
      await this.activity.log(ws.id, 'meeting.no_show', { prospectId: p.id, campaignId: p.campaign_id, data: { meeting_id: m.id } });
    } else if (status === 'cancelled') {
      await this.updateProspect(p.id, { status: 'replied' });
      await this.activity.log(ws.id, 'meeting.cancelled', { prospectId: p.id, campaignId: p.campaign_id, data: { meeting_id: m.id } });
    } else if (status === 'done') {
      await this.updateProspect(p.id, { stage: p.stage === 'rdv_planifie' ? 'proposition' : p.stage });
      await this.activity.log(ws.id, 'meeting.done', { prospectId: p.id, campaignId: p.campaign_id, data: { meeting_id: m.id } });
    }
    return m;
  }

  async queueReminder(meeting) {
    const p = await this.prospect(meeting.prospect_id);
    if (!p) return;
    const ws = await this.workspace(meeting.workspace_id);
    const campaign = await this.campaign(p.campaign_id);
    if (!campaign) return;
    const body = await this.ai.writeMessage(ws, campaign, p, { kind: 'reminder', step: { meeting_url: meeting.meeting_url }, history: await this.history(p.id) });
    await this.enqueue(ws, p, { kind: 'reminder', body, campaign, approval: false });
  }

  async discover(ws, campaign, { limit = 15 } = {}) {
    const account = await this.account(campaign.account_id);
    if (!account) throw new Error('Associez un compte LinkedIn à la campagne');
    const provider = this.providers.getProvider(account.provider);
    if (!provider.capabilities.search) throw new Error('Ce compte ne permet pas la recherche automatique : importez des prospects (CSV ou URLs).');
    const icp = Object.keys(campaign.icp || {}).length ? campaign.icp : ws.settings?.icp || {};
    const found = await provider.search(account, icp, { limit });
    const res = await this.importProspects(ws, found, { campaignId: campaign.id, source: account.provider === 'simulation' ? 'simulation' : 'search' });
    await this.db.query(`UPDATE campaigns SET settings = settings || $2::jsonb WHERE id = $1`, [campaign.id, JSON.stringify({ last_discovery_at: new Date().toISOString() })]);
    return { ...res, found: found.length };
  }
}

export { addMinutes };
