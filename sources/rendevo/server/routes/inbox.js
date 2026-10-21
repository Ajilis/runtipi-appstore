import { bad, notFound } from '../lib/http.js';

export function registerInbox(router, deps, { requireAuth }) {
  const { db, agent, ai, calendar } = deps;

  // Conversation list. filter: all | approval | human | to_send | replies
  router.get('/api/inbox', requireAuth, async (ctx) => {
    const filter = ctx.query.filter || 'all';
    const ws = ctx.state.ws.id;
    const cond = {
      all: `EXISTS (SELECT 1 FROM messages m WHERE m.prospect_id = p.id AND m.status IN ('sent', 'received', 'pending_approval', 'queued'))`,
      replies: 'p.last_reply_at IS NOT NULL',
      approval: `EXISTS (SELECT 1 FROM messages m WHERE m.prospect_id = p.id AND m.status = 'pending_approval')`,
      human: 'p.needs_human',
      to_send: `EXISTS (SELECT 1 FROM messages m JOIN accounts a ON a.id = m.account_id WHERE m.prospect_id = p.id AND m.status = 'queued' AND a.provider IN ('manual', 'linkedin_cookie'))`,
    }[filter] || 'true';
    const { rows } = await db.query(
      `SELECT p.id, p.full_name, p.title, p.company, p.heat, p.status, p.needs_human, p.human_reason, p.last_reply_at,
              (SELECT row_to_json(x) FROM (SELECT id, direction, kind, body, status, coalesce(sent_at, scheduled_at, created_at) AS at FROM messages
                 WHERE prospect_id = p.id AND status <> 'cancelled' ORDER BY coalesce(sent_at, scheduled_at, created_at) DESC LIMIT 1) x) AS last,
              (SELECT count(*)::int FROM messages WHERE prospect_id = p.id AND status = 'pending_approval') AS pending
         FROM prospects p
        WHERE p.workspace_id = $1 AND ${cond}
        ORDER BY p.needs_human DESC, (SELECT max(coalesce(sent_at, scheduled_at, created_at)) FROM messages WHERE prospect_id = p.id AND status <> 'cancelled') DESC NULLS LAST
        LIMIT 200`,
      [ws],
    );
    const counts = await db.query(
      `SELECT
         (SELECT count(*)::int FROM messages WHERE workspace_id = $1 AND status = 'pending_approval') AS approval,
         (SELECT count(*)::int FROM prospects WHERE workspace_id = $1 AND needs_human) AS human,
         (SELECT count(*)::int FROM messages m JOIN accounts a ON a.id = m.account_id WHERE m.workspace_id = $1 AND m.status = 'queued' AND a.provider IN ('manual', 'linkedin_cookie')) AS to_send`,
      [ws],
    );
    return { items: rows, counts: counts.rows[0] };
  });

  async function ownedMessage(ctx) {
    const { rows } = await db.query('SELECT * FROM messages WHERE id = $1 AND workspace_id = $2', [ctx.params.id, ctx.state.ws.id]);
    if (!rows[0]) throw notFound('Message introuvable');
    return rows[0];
  }

  async function ownedProspect(ctx) {
    const { rows } = await db.query('SELECT * FROM prospects WHERE id = $1 AND workspace_id = $2', [ctx.params.id, ctx.state.ws.id]);
    if (!rows[0]) throw notFound('Prospect introuvable');
    return rows[0];
  }

  router.patch('/api/messages/:id', requireAuth, async (ctx) => {
    const m = await ownedMessage(ctx);
    const body = await ctx.json();
    if (!['pending_approval', 'queued', 'failed'].includes(m.status)) throw bad('Ce message a déjà été envoyé');
    const text = String(body.body || '').trim();
    if (!text && m.kind !== 'invite') throw bad('Message vide');
    await db.query('UPDATE messages SET body = $2 WHERE id = $1', [m.id, text.slice(0, m.kind === 'invite' ? 300 : 8000)]);
    return { ok: true };
  });

  router.post('/api/messages/:id/approve', requireAuth, async (ctx) => {
    const m = await ownedMessage(ctx);
    const body = await ctx.json();
    if (!['pending_approval', 'failed'].includes(m.status)) throw bad('Rien à valider');
    const text = body.body !== undefined ? String(body.body).trim() : m.body;
    await db.query(`UPDATE messages SET status = 'queued', body = $2, scheduled_at = now(), error = NULL, meta = meta || '{"approved": true}'::jsonb WHERE id = $1`, [m.id, text]);
    return { ok: true };
  });

  router.post('/api/messages/approve-all', requireAuth, async (ctx) => {
    const { rowCount } = await db.query(`UPDATE messages SET status = 'queued', scheduled_at = now() + (random() * interval '30 minutes') WHERE workspace_id = $1 AND status = 'pending_approval'`, [ctx.state.ws.id]);
    return { ok: true, count: rowCount };
  });

  router.post('/api/messages/:id/reject', requireAuth, async (ctx) => {
    const m = await ownedMessage(ctx);
    await db.query(`UPDATE messages SET status = 'cancelled' WHERE id = $1`, [m.id]);
    // Let the cadence continue later for cold steps.
    if (['first', 'followup', 'invite'].includes(m.kind)) await db.query(`UPDATE prospects SET next_action_at = now() + interval '1 day' WHERE id = $1 AND next_action_at IS NULL AND status IN ('qualified', 'connected', 'contacted')`, [m.prospect_id]);
    return { ok: true };
  });

  router.post('/api/messages/:id/regenerate', requireAuth, async (ctx) => {
    const m = await ownedMessage(ctx);
    if (!['pending_approval', 'queued', 'failed'].includes(m.status)) throw bad('Ce message a déjà été envoyé');
    const p = await agent.prospect(m.prospect_id);
    const ws = await agent.workspace(ctx.state.ws.id);
    const campaign = await agent.campaign(p.campaign_id);
    const body = await ctx.json();
    const step = campaign?.sequence?.[m.meta?.step ?? (m.kind === 'first' ? 1 : 0)] || {};
    const kind = ['invite', 'first', 'followup', 'callback', 'noshow', 'reminder'].includes(m.kind) ? m.kind : 'first';
    const text = await ai.writeMessage(ws, campaign, p, { kind, step: { ...step, instructions: [step.instructions, body.instructions].filter(Boolean).join(' ') }, history: await agent.history(p.id) });
    await db.query('UPDATE messages SET body = $2 WHERE id = $1', [m.id, text]);
    return { body: text };
  });

  // Manual mode: the user sent it from LinkedIn and confirms here.
  router.post('/api/messages/:id/mark-sent', requireAuth, async (ctx) => {
    const m = await ownedMessage(ctx);
    if (!['queued', 'pending_approval', 'failed'].includes(m.status)) throw bad('Déjà envoyé');
    await agent.onSent(m.id, {});
    return { ok: true };
  });

  router.post('/api/prospects/:id/reply', requireAuth, async (ctx) => {
    const p = await ownedProspect(ctx);
    const body = await ctx.json();
    const text = String(body.text || '').trim();
    if (!text) throw bad('Message vide');
    const campaign = await agent.campaign(p.campaign_id);
    let accountId = campaign?.account_id;
    if (!accountId) {
      const a = await db.query('SELECT id FROM accounts WHERE workspace_id = $1 ORDER BY created_at LIMIT 1', [ctx.state.ws.id]);
      accountId = a.rows[0]?.id;
    }
    if (!accountId) throw bad('Ajoutez un compte LinkedIn dans Réglages pour envoyer des messages');
    const m = await agent.enqueue(ctx.state.ws, p, { kind: 'manual', body: text, campaign, accountId, approval: false, meta: { by: ctx.state.user.email } });
    if (body.resolve) await agent.updateProspect(p.id, { needs_human: false, human_reason: null });
    return m;
  });

  // Manual mode: paste a reply received on LinkedIn; the AI setter takes it from there.
  router.post('/api/prospects/:id/incoming', requireAuth, async (ctx) => {
    const p = await ownedProspect(ctx);
    const body = await ctx.json();
    const text = String(body.text || '').trim();
    if (!text) throw bad('Message vide');
    if (['qualified', 'invited', 'new', 'low_fit'].includes(p.status)) await agent.updateProspect(p.id, { status: 'contacted', connected_at: p.connected_at || new Date() });
    await agent.onIncoming(p.id, { text, at: new Date() });
    return { ok: true };
  });

  router.post('/api/prospects/:id/accepted', requireAuth, async (ctx) => {
    const p = await ownedProspect(ctx);
    if (p.status !== 'invited') throw bad('Ce prospect n\'a pas d\'invitation en attente');
    await agent.onAccepted(p.id);
    return { ok: true };
  });

  router.post('/api/prospects/:id/setter', requireAuth, async (ctx) => {
    const p = await ownedProspect(ctx);
    await agent.updateProspect(p.id, { needs_human: false, human_reason: null });
    await agent.mergeSetterState(p.id, { paused: false });
    const turn = await agent.runSetter(p.id);
    return { ok: true, turn };
  });

  router.post('/api/prospects/:id/suggest', requireAuth, async (ctx) => {
    const p = await ownedProspect(ctx);
    const ws = await agent.workspace(ctx.state.ws.id);
    const campaign = await agent.campaign(p.campaign_id);
    const slots = await calendar.freeSlots(ws, { count: 3, spread: true, excludeProspectId: p.id });
    const turn = await ai.setterTurn(ws, campaign, p, { history: await agent.history(p.id), slots, timezone: calendar.availability(ws).timezone });
    let text = turn.reply || '';
    if (!text && slots.length) text = `Je vous propose : ${slots.map((s) => s.label).join(', ou ')}. Qu'est-ce qui vous arrange ?`;
    return { text, intent: turn.intent, handoff_reason: turn.handoff_reason || null };
  });
}
