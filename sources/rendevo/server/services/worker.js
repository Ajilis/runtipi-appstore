// Automation loop: provider sync, sequence progression, rate-limited sending
// at a human pace, reminders, callbacks and auto-discovery.
import { zonedParts, parseHHMM, rand } from '../lib/util.js';

export const DEFAULT_SCHEDULE = { timezone: 'Europe/Paris', days: [1, 2, 3, 4, 5], start: '08:30', end: '19:00' };
const CONVERSATION_KINDS = ['setter', 'confirmation', 'reminder', 'noshow', 'manual'];

export class Worker {
  constructor({ db, config, agent, providers, logger = console }) {
    this.db = db;
    this.config = config;
    this.agent = agent;
    this.providers = providers;
    this.logger = logger;
    this.running = false;
    this.lastSync = new Map();
    this.timer = null;
    this.lastCleanup = 0;
  }

  start() {
    if (!this.config.worker?.enabled) {
      this.logger.log('[worker] désactivé par la configuration');
      return;
    }
    const every = Math.max(5, Number(this.config.worker.tick_seconds) || 20) * 1000;
    const loop = async () => {
      await this.tick();
      this.timer = setTimeout(loop, every);
    };
    this.timer = setTimeout(loop, 3000);
    this.logger.log(`[worker] démarré (toutes les ${every / 1000}s)`);
  }

  stop() { clearTimeout(this.timer); }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.syncAccounts();
      await this.advanceDue();
      await this.sendQueue();
      await this.reminders();
      await this.discovery();
      if (Date.now() - this.lastCleanup > 3600e3) await this.cleanup();
    } catch (e) {
      this.logger.error('[worker] erreur :', e);
    } finally {
      this.running = false;
    }
  }

  inWindow(ws, account) {
    if (account.config?.ignore_window) return true;
    const sch = { ...DEFAULT_SCHEDULE, ...(ws.settings?.schedule || {}) };
    const p = zonedParts(new Date(), sch.timezone);
    if (!(sch.days || []).map(Number).includes(p.weekday)) return false;
    const s = parseHHMM(sch.start, { h: 8, m: 30 });
    const e = parseHHMM(sch.end, { h: 19, m: 0 });
    const mins = p.hour * 60 + p.minute;
    return mins >= s.h * 60 + s.m && mins < e.h * 60 + e.m;
  }

  limitsFor(account) {
    const all = this.config.limits || {};
    const base = all[account.account_type] || all.free || {};
    return { ...base, ...(account.config?.limits || {}) };
  }

  async usage(accountId) {
    const { rows } = await this.db.query(
      `SELECT coalesce(sum(invites) FILTER (WHERE day = current_date), 0)::int AS invites_today,
              coalesce(sum(messages) FILTER (WHERE day = current_date), 0)::int AS messages_today,
              coalesce(sum(invites) FILTER (WHERE day > current_date - 7), 0)::int AS invites_week
         FROM usage WHERE account_id = $1 AND day > current_date - 7`,
      [accountId],
    );
    return rows[0];
  }

  async activeAccounts() {
    const { rows } = await this.db.query(
      `SELECT a.* FROM accounts a WHERE a.status = 'active' AND EXISTS (SELECT 1 FROM campaigns c WHERE c.account_id = a.id AND c.status = 'active')`,
    );
    return rows.map((a) => this.agent.decryptAccount(a));
  }

  async syncAccounts() {
    for (const account of await this.activeAccounts()) {
      const provider = this.providers.getProvider(account.provider);
      if (!provider.auto || !provider.sync) continue;
      const every = account.provider === 'simulation' ? 0 : 120e3;
      if (Date.now() - (this.lastSync.get(account.id) || 0) < every) continue;
      this.lastSync.set(account.id, Date.now());
      const ws = await this.agent.workspace(account.workspace_id);
      if (!ws.agent_enabled) continue;
      try {
        const tz = ws.settings?.availability?.timezone || this.config.timezone;
        const events = await provider.sync(account, { db: this.db, config: this.config, timezone: tz });
        for (const ev of events) {
          if (ev.type === 'accepted') await this.agent.onAccepted(ev.prospect_id);
          else if (ev.type === 'message') await this.agent.onIncoming(ev.prospect_id, { text: ev.text, at: ev.at, providerMessageId: ev.provider_message_id, chatId: ev.chat_id });
          else if (ev.type === 'state') await this.db.query('UPDATE accounts SET sync_state = $2 WHERE id = $1', [account.id, JSON.stringify(ev.sync_state)]);
        }
        await this.db.query(`UPDATE accounts SET last_sync_at = now(), status_detail = NULL WHERE id = $1`, [account.id]);
      } catch (e) {
        this.logger.warn(`[worker] sync ${account.name} :`, e.message);
        if (e.fatal) await this.db.query(`UPDATE accounts SET status = 'error', status_detail = $2 WHERE id = $1`, [account.id, `Session refusée : ${e.message}. Reconnectez le compte.`]);
        else await this.db.query(`UPDATE accounts SET status_detail = $2 WHERE id = $1`, [account.id, `Dernière synchronisation en échec : ${e.message}`]);
      }
    }
  }

  async advanceDue() {
    const { rows } = await this.db.query(
      `SELECT p.id FROM prospects p
         JOIN campaigns c ON c.id = p.campaign_id AND c.status = 'active'
         JOIN workspaces w ON w.id = p.workspace_id AND w.agent_enabled
        WHERE p.next_action_at IS NOT NULL AND p.next_action_at <= now()
          AND p.status IN ('qualified', 'connected', 'contacted', 'callback')
          AND NOT p.needs_human
        ORDER BY p.heat = 'hot' DESC, p.fit_score DESC NULLS LAST, p.next_action_at
        LIMIT 25`,
    );
    for (const r of rows) {
      try { await this.agent.advance(r.id); } catch (e) { this.logger.error('[worker] advance', r.id, e); }
    }
  }

  async sendQueue() {
    const { rows: accs } = await this.db.query(
      `SELECT a.* FROM accounts a WHERE a.status = 'active'
          AND EXISTS (SELECT 1 FROM messages m WHERE m.account_id = a.id AND m.status = 'queued' AND m.scheduled_at <= now())`,
    );
    for (const account of accs.map((a) => this.agent.decryptAccount(a))) {
      const provider = this.providers.getProvider(account.provider);
      if (!provider.auto) continue;
      if (account.next_action_at && new Date(account.next_action_at) > new Date()) continue;
      const ws = await this.agent.workspace(account.workspace_id);
      if (!this.inWindow(ws, account)) continue;
      const usage = await this.usage(account.id);
      const limits = this.limitsFor(account);
      const canInvite = ws.agent_enabled && usage.invites_today < (limits.invites_per_day ?? 15) && usage.invites_week < (limits.invites_per_week ?? 100);
      const canMessage = usage.messages_today < (limits.messages_per_day ?? 40);
      const kinds = [];
      if (canMessage) kinds.push(...(ws.agent_enabled ? ['setter', 'confirmation', 'reminder', 'noshow', 'manual', 'first', 'followup', 'callback'] : ['manual']));
      if (canInvite) kinds.push('invite');
      if (!kinds.length) continue;
      const { rows } = await this.db.query(
        `SELECT m.* FROM messages m
           JOIN prospects p ON p.id = m.prospect_id
          WHERE m.account_id = $1 AND m.status = 'queued' AND m.scheduled_at <= now() AND m.kind = ANY($2)
          ORDER BY (m.kind = ANY($3)) DESC, m.scheduled_at
          LIMIT 1`,
        [account.id, kinds, CONVERSATION_KINDS],
      );
      const msg = rows[0];
      if (!msg) continue;
      const claimed = await this.db.query(`UPDATE messages SET status = 'sending' WHERE id = $1 AND status = 'queued' RETURNING id`, [msg.id]);
      if (!claimed.rows.length) continue;
      const p = await this.agent.prospect(msg.prospect_id);
      try {
        const result = msg.kind === 'invite'
          ? await provider.invite(account, p, msg.body)
          : await provider.sendMessage(account, p, msg.body);
        await this.agent.onSent(msg.id, result || {});
      } catch (e) {
        const attempts = (msg.meta?.attempts || 0) + 1;
        this.logger.warn(`[worker] envoi ${msg.kind} vers ${p.full_name} échoué (${attempts}) :`, e.message);
        if (e.fatal) await this.db.query(`UPDATE accounts SET status = 'error', status_detail = $2 WHERE id = $1`, [account.id, `Envoi refusé : ${e.message}`]);
        await this.db.query(
          `UPDATE messages SET status = $2, error = $3, scheduled_at = now() + interval '20 minutes', meta = meta || $4::jsonb WHERE id = $1`,
          [msg.id, attempts >= 3 || e.fatal ? 'failed' : 'queued', e.message.slice(0, 500), JSON.stringify({ attempts })],
        );
      }
      // Human pace: random gap before the next action on this account.
      const min = Number(this.config.worker.min_gap_seconds) || 90;
      const max = Number(this.config.worker.max_gap_seconds) || 420;
      const gap = (rand(min, max) * 1000) / this.agent.speed(account);
      await this.db.query('UPDATE accounts SET next_action_at = $2 WHERE id = $1', [account.id, new Date(Date.now() + gap)]);
    }
  }

  async reminders() {
    const { rows } = await this.db.query(
      `SELECT m.* FROM meetings m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.status = 'confirmed' AND m.reminder_sent_at IS NULL AND m.prospect_id IS NOT NULL AND w.agent_enabled
          AND m.starts_at > now()
          AND m.starts_at <= now() + make_interval(hours => coalesce((w.settings->'availability'->>'reminder_hours')::int, 3))
          AND m.created_at < now() - interval '30 minutes'`,
    );
    for (const m of rows) {
      await this.db.query('UPDATE meetings SET reminder_sent_at = now() WHERE id = $1', [m.id]);
      try { await this.agent.queueReminder(m); } catch (e) { this.logger.warn('[worker] rappel', e.message); }
    }
  }

  async discovery() {
    const { rows } = await this.db.query(
      `SELECT c.id FROM campaigns c JOIN workspaces w ON w.id = c.workspace_id AND w.agent_enabled
        WHERE c.status = 'active' AND (c.settings->>'auto_discovery')::boolean IS TRUE
          AND coalesce((c.settings->>'last_discovery_at')::timestamptz, 'epoch') < now() - interval '6 hours'`,
    );
    for (const r of rows) {
      const campaign = await this.agent.campaign(r.id);
      const ws = await this.agent.workspace(campaign.workspace_id);
      const waiting = await this.db.query(`SELECT count(*)::int AS n FROM prospects WHERE campaign_id = $1 AND status = 'qualified'`, [campaign.id]);
      const week = await this.db.query(`SELECT count(*)::int AS n FROM prospects WHERE campaign_id = $1 AND created_at > now() - interval '7 days'`, [campaign.id]);
      if (waiting.rows[0].n >= 15 || week.rows[0].n >= (campaign.settings.weekly_prospects || 100)) {
        await this.db.query(`UPDATE campaigns SET settings = settings || $2::jsonb WHERE id = $1`, [campaign.id, JSON.stringify({ last_discovery_at: new Date().toISOString() })]);
        continue;
      }
      try {
        const res = await this.agent.discover(ws, campaign, { limit: 15 });
        this.logger.log(`[worker] découverte "${campaign.name}" : ${res.created} nouveaux prospects`);
      } catch (e) {
        this.logger.warn('[worker] découverte', e.message);
        await this.db.query(`UPDATE campaigns SET settings = settings || $2::jsonb WHERE id = $1`, [campaign.id, JSON.stringify({ last_discovery_at: new Date().toISOString(), last_discovery_error: e.message })]);
      }
    }
  }

  async cleanup() {
    this.lastCleanup = Date.now();
    await this.db.query(`DELETE FROM sessions WHERE expires_at < now()`);
    await this.db.query(`UPDATE prospects SET status = 'not_accepted', updated_at = now() WHERE status = 'invited' AND invited_at < now() - interval '30 days'`);
    await this.db.query(`UPDATE messages SET status = 'queued' WHERE status = 'sending' AND created_at < now() - interval '1 hour'`);
  }
}
