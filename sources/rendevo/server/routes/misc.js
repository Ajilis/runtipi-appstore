import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { bad, notFound } from '../lib/http.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { WEBHOOK_EVENTS } from '../services/activity.js';
import { startOfIsoWeek, addDays, zonedParts } from '../lib/util.js';

export function registerMisc(router, deps, { requireAuth, requireAdmin }) {
  const { db, agent, config, calendar } = deps;

  // --------------------------------------------------------------- media
  router.get('/api/media', requireAuth, async (ctx) => {
    const { rows } = await db.query('SELECT * FROM media WHERE workspace_id = $1 ORDER BY created_at DESC', [ctx.state.ws.id]);
    const pub = agent.publicUrl(ctx.state.ws);
    return rows.map((m) => ({ ...m, share_url: `${pub}/v/${m.share_token}` }));
  });

  router.post('/api/media', requireAuth, async (ctx) => {
    const filename = decodeURIComponent(String(ctx.req.headers['x-filename'] || 'fichier')).replace(/[^\w.\- ()À-ÿ]/g, '_').slice(0, 120);
    const title = decodeURIComponent(String(ctx.req.headers['x-title'] || filename)).slice(0, 160);
    const mime = String(ctx.req.headers['content-type'] || 'application/octet-stream').split(';')[0];
    const allowed = /^(video|image)\//.test(mime) || mime === 'application/pdf';
    if (!allowed) throw bad('Formats acceptés : vidéo, image ou PDF');
    const max = (config.uploads?.max_mb || 200) * 1024 * 1024;
    const stored = `${crypto.randomUUID()}${path.extname(filename).toLowerCase().slice(0, 8)}`;
    const dest = path.join(config.uploadsDir, stored);
    let size = 0;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(dest, { mode: 0o640 });
      ctx.req.on('data', (c) => {
        size += c.length;
        if (size > max) { ctx.req.destroy(); out.destroy(); fs.rmSync(dest, { force: true }); reject(bad(`Fichier trop lourd (max ${config.uploads?.max_mb || 200} Mo)`)); }
      });
      ctx.req.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
    });
    const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : 'document';
    const { rows } = await db.query(
      'INSERT INTO media (workspace_id, kind, title, filename, stored_name, mime, size) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [ctx.state.ws.id, kind, title, filename, stored, mime, size],
    );
    return rows[0];
  });

  router.delete('/api/media/:id', requireAuth, async (ctx) => {
    const { rows } = await db.query('DELETE FROM media WHERE id = $1 AND workspace_id = $2 RETURNING stored_name', [ctx.params.id, ctx.state.ws.id]);
    if (rows[0]) fs.rmSync(path.join(config.uploadsDir, rows[0].stored_name), { force: true });
    return { ok: true };
  });

  router.get('/api/public/media/:token', async (ctx) => {
    const { rows } = await db.query('SELECT m.*, w.name AS ws_name, w.settings->\'voice\'->>\'sender_name\' AS sender FROM media m JOIN workspaces w ON w.id = m.workspace_id WHERE m.share_token = $1', [ctx.params.token]);
    const m = rows[0];
    if (!m) throw notFound();
    if (ctx.query.meta === '1') return { title: m.title, kind: m.kind, mime: m.mime, sender: m.sender || m.ws_name, src: `/api/public/media/${m.share_token}` };
    if (!ctx.state.viewLogged && m.kind === 'video' && !ctx.req.headers.range) {
      await deps.activity.log(m.workspace_id, 'media.viewed', { data: { media_id: m.id, title: m.title } }).catch(() => {});
    }
    await ctx.sendFile(path.join(config.uploadsDir, m.stored_name), { cache: 'private, max-age=3600' });
  });

  // ------------------------------------------------------------ webhooks
  router.get('/api/webhooks', requireAuth, async (ctx) => {
    const { rows } = await db.query('SELECT * FROM webhooks WHERE workspace_id = $1 ORDER BY created_at', [ctx.state.ws.id]);
    return { items: rows, events: WEBHOOK_EVENTS };
  });

  router.post('/api/webhooks', requireAuth, requireAdmin, async (ctx) => {
    const body = await ctx.json();
    let url;
    try { url = new URL(String(body.url)); } catch { throw bad('URL invalide'); }
    if (!/^https?:$/.test(url.protocol)) throw bad('URL http(s) requise');
    const events = (body.events || []).filter((e) => WEBHOOK_EVENTS.includes(e));
    const { rows } = await db.query('INSERT INTO webhooks (workspace_id, url, events) VALUES ($1, $2, $3) RETURNING *', [ctx.state.ws.id, url.toString(), events]);
    return rows[0];
  });

  router.delete('/api/webhooks/:id', requireAuth, requireAdmin, async (ctx) => {
    await db.query('DELETE FROM webhooks WHERE id = $1 AND workspace_id = $2', [ctx.params.id, ctx.state.ws.id]);
    return { ok: true };
  });

  router.post('/api/webhooks/:id/test', requireAuth, async (ctx) => {
    const { rows } = await db.query('SELECT * FROM webhooks WHERE id = $1 AND workspace_id = $2', [ctx.params.id, ctx.state.ws.id]);
    if (!rows[0]) throw notFound();
    const status = await deps.activity.deliver(rows[0], 'test', { message: 'Webhook de test Rendevo' });
    return { status };
  });

  // ---------------------------------------------------- API tokens (MCP)
  router.get('/api/tokens', requireAuth, async (ctx) => {
    const { rows } = await db.query('SELECT id, name, prefix, last_used_at, created_at FROM api_tokens WHERE workspace_id = $1 ORDER BY created_at DESC', [ctx.state.ws.id]);
    return rows;
  });

  router.post('/api/tokens', requireAuth, requireAdmin, async (ctx) => {
    const body = await ctx.json();
    const token = 'rdv_' + randomToken(30);
    await db.query('INSERT INTO api_tokens (workspace_id, user_id, name, token_hash, prefix) VALUES ($1, $2, $3, $4, $5)', [ctx.state.ws.id, ctx.state.user.id, String(body.name || 'Assistant IA').slice(0, 80), sha256(token), token.slice(0, 10)]);
    return { token, mcp_url: `${agent.publicUrl(ctx.state.ws) || ''}/mcp` };
  });

  router.delete('/api/tokens/:id', requireAuth, requireAdmin, async (ctx) => {
    await db.query('DELETE FROM api_tokens WHERE id = $1 AND workspace_id = $2', [ctx.params.id, ctx.state.ws.id]);
    return { ok: true };
  });

  // --------------------------------------------------------------- stats
  router.get('/api/stats/overview', requireAuth, async (ctx) => {
    return overview(deps, ctx.state.ws, { days: parseInt(ctx.query.days, 10) || 14 });
  });

  router.get('/api/activity', requireAuth, async (ctx) => {
    const { rows } = await db.query(
      `SELECT e.type, e.data, e.created_at, e.prospect_id, p.full_name FROM events e LEFT JOIN prospects p ON p.id = e.prospect_id
        WHERE e.workspace_id = $1 ORDER BY e.created_at DESC LIMIT $2`,
      [ctx.state.ws.id, Math.min(200, parseInt(ctx.query.limit, 10) || 50)],
    );
    return rows;
  });

  void calendar;
}

export async function overview(deps, ws, { days = 14 } = {}) {
  const { db, calendar } = deps;
  const tz = calendar.availability(ws).timezone;
  const weekStart = startOfIsoWeek(new Date(), tz);
  const since = addDays(new Date(), -days);
  const [week, daily, hot, upcoming, queue, accounts, recent, funnel] = await Promise.all([
    db.query(
      `SELECT type, count(*)::int AS n FROM events WHERE workspace_id = $1 AND created_at >= $2
          AND type IN ('prospect.found', 'invite.sent', 'invite.accepted', 'message.sent', 'prospect.replied', 'meeting.booked') GROUP BY type`,
      [ws.id, weekStart],
    ),
    db.query(
      `SELECT date_trunc('day', created_at AT TIME ZONE $3) AS day, type, count(*)::int AS n FROM events
        WHERE workspace_id = $1 AND created_at >= $2 AND type IN ('invite.sent', 'invite.accepted', 'prospect.replied', 'meeting.booked', 'message.sent')
        GROUP BY 1, 2 ORDER BY 1`,
      [ws.id, since, tz],
    ),
    db.query(
      `SELECT id, full_name, title, company, heat, fit_score, signals, status FROM prospects
        WHERE workspace_id = $1 AND heat = 'hot' AND status NOT IN ('excluded', 'lost', 'won')
        ORDER BY (SELECT max((s->>'date')::timestamptz) FROM jsonb_array_elements(signals) s) DESC NULLS LAST, fit_score DESC LIMIT 6`,
      [ws.id],
    ),
    db.query(
      `SELECT m.id, m.starts_at, m.ends_at, m.status, m.meeting_url, p.id AS prospect_id, p.full_name, p.title, p.company FROM meetings m LEFT JOIN prospects p ON p.id = m.prospect_id
        WHERE m.workspace_id = $1 AND m.starts_at >= $2 AND m.starts_at < $3 AND m.status <> 'cancelled' ORDER BY m.starts_at`,
      [ws.id, weekStart, addDays(weekStart, 14)],
    ),
    db.query(
      `SELECT
         (SELECT count(*)::int FROM messages WHERE workspace_id = $1 AND status = 'pending_approval') AS approval,
         (SELECT count(*)::int FROM prospects WHERE workspace_id = $1 AND needs_human) AS human,
         (SELECT count(*)::int FROM messages WHERE workspace_id = $1 AND status = 'queued') AS queued,
         (SELECT count(*)::int FROM prospects WHERE workspace_id = $1 AND status = 'qualified' AND campaign_id IS NOT NULL) AS waiting,
         (SELECT count(*)::int FROM campaigns WHERE workspace_id = $1 AND status = 'active') AS active_campaigns,
         (SELECT count(*)::int FROM accounts WHERE workspace_id = $1) AS accounts,
         (SELECT count(*)::int FROM accounts WHERE workspace_id = $1 AND status = 'error') AS accounts_error,
         (SELECT count(*)::int FROM prospects WHERE workspace_id = $1) AS prospects`,
      [ws.id],
    ),
    db.query(`SELECT id, name, provider, status, status_detail, account_type FROM accounts WHERE workspace_id = $1`, [ws.id]),
    db.query(
      `SELECT e.type, e.data, e.created_at, e.prospect_id, p.full_name FROM events e LEFT JOIN prospects p ON p.id = e.prospect_id
        WHERE e.workspace_id = $1 AND e.type IN ('invite.accepted', 'prospect.replied', 'meeting.booked', 'prospect.handoff', 'callback.scheduled', 'goal.reached', 'agent.started', 'agent.paused', 'media.viewed', 'meeting.no_show')
        ORDER BY e.created_at DESC LIMIT 12`,
      [ws.id],
    ),
    db.query(
      `SELECT count(*) FILTER (WHERE invited_at IS NOT NULL)::int AS invited,
              count(*) FILTER (WHERE connected_at IS NOT NULL)::int AS connected,
              count(*) FILTER (WHERE last_reply_at IS NOT NULL)::int AS replied,
              (SELECT count(*)::int FROM meetings WHERE workspace_id = $1 AND status IN ('confirmed', 'done')) AS meetings
         FROM prospects WHERE workspace_id = $1`,
      [ws.id],
    ),
  ]);
  const w = Object.fromEntries(week.rows.map((r) => [r.type, r.n]));
  const series = {};
  for (let i = days - 1; i >= 0; i--) {
    const p = zonedParts(addDays(new Date(), -i), tz);
    const key = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    series[key] = { day: key, invites: 0, accepted: 0, replies: 0, meetings: 0, messages: 0 };
  }
  for (const r of daily.rows) {
    const key = new Date(r.day).toISOString().slice(0, 10);
    if (!series[key]) continue;
    const field = { 'invite.sent': 'invites', 'invite.accepted': 'accepted', 'prospect.replied': 'replies', 'meeting.booked': 'meetings', 'message.sent': 'messages' }[r.type];
    series[key][field] += r.n;
  }
  return {
    agent_enabled: ws.agent_enabled,
    onboarding_done: !!ws.settings?.onboarding_done,
    goal: ws.settings?.goal?.meetings_per_week || 5,
    week: {
      start: weekStart,
      found: w['prospect.found'] || 0,
      invites: w['invite.sent'] || 0,
      accepted: w['invite.accepted'] || 0,
      messages: w['message.sent'] || 0,
      replies: w['prospect.replied'] || 0,
      meetings: w['meeting.booked'] || 0,
    },
    funnel: funnel.rows[0],
    series: Object.values(series),
    hot: hot.rows,
    upcoming: upcoming.rows,
    queue: queue.rows[0],
    accounts: accounts.rows,
    recent: recent.rows,
    timezone: tz,
    public_url: deps.agent.publicUrl(ws),
  };
}
