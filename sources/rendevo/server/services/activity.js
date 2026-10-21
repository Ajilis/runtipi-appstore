// Activity log + outgoing webhooks.
import { hmacHex } from '../lib/crypto.js';

export const WEBHOOK_EVENTS = [
  'prospect.replied',
  'prospect.handoff',
  'meeting.booked',
  'meeting.cancelled',
  'meeting.no_show',
  'invite.accepted',
  'goal.reached',
];

export class Activity {
  constructor({ db, logger = console }) {
    this.db = db;
    this.logger = logger;
  }

  async log(workspaceId, type, { prospectId = null, campaignId = null, data = {} } = {}) {
    await this.db.query(
      'INSERT INTO events (workspace_id, prospect_id, campaign_id, type, data) VALUES ($1, $2, $3, $4, $5)',
      [workspaceId, prospectId, campaignId, type, JSON.stringify(data)],
    );
    if (WEBHOOK_EVENTS.includes(type)) this.dispatch(workspaceId, type, { prospect_id: prospectId, campaign_id: campaignId, ...data }).catch(() => {});
  }

  async dispatch(workspaceId, event, payload) {
    const { rows } = await this.db.query(
      'SELECT * FROM webhooks WHERE workspace_id = $1 AND active AND ($2 = ANY(events) OR cardinality(events) = 0)',
      [workspaceId, event],
    );
    for (const hook of rows) await this.deliver(hook, event, payload);
  }

  async deliver(hook, event, payload) {
    const body = JSON.stringify({ event, created_at: new Date().toISOString(), data: payload });
    let status = 0;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(hook.url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Rendevo-Webhook/1.0',
          'x-rendevo-event': event,
          'x-rendevo-signature': 'sha256=' + hmacHex(hook.secret, body),
        },
        body,
      });
      clearTimeout(t);
      status = res.status;
    } catch (e) {
      this.logger.warn(`[webhook] ${hook.url} : ${e.message}`);
    }
    await this.db.query('UPDATE webhooks SET last_status = $2, last_at = now() WHERE id = $1', [hook.id, status]);
    return status;
  }
}
