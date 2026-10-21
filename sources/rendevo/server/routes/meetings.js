import { bad, notFound } from '../lib/http.js';
import { calendar as icsCalendar } from '../lib/ics.js';
import { addDays } from '../lib/util.js';

export function registerMeetings(router, deps, { requireAuth }) {
  const { db, agent, calendar } = deps;

  router.get('/api/meetings', requireAuth, async (ctx) => {
    const from = ctx.query.from ? new Date(ctx.query.from) : addDays(new Date(), -30);
    const to = ctx.query.to ? new Date(ctx.query.to) : addDays(new Date(), 60);
    const { rows } = await db.query(
      `SELECT m.*, p.full_name, p.title, p.company, p.linkedin_url, c.name AS campaign_name
         FROM meetings m LEFT JOIN prospects p ON p.id = m.prospect_id LEFT JOIN campaigns c ON c.id = m.campaign_id
        WHERE m.workspace_id = $1 AND m.starts_at >= $2 AND m.starts_at < $3 ORDER BY m.starts_at`,
      [ctx.state.ws.id, from, to],
    );
    return rows;
  });

  router.get('/api/availability/slots', requireAuth, async (ctx) => {
    return calendar.freeSlots(ctx.state.ws, { count: Math.min(60, parseInt(ctx.query.count, 10) || 20), spread: ctx.query.spread === '1' });
  });

  router.post('/api/meetings', requireAuth, async (ctx) => {
    const body = await ctx.json();
    const { rows } = await db.query('SELECT * FROM prospects WHERE id = $1 AND workspace_id = $2', [body.prospect_id, ctx.state.ws.id]);
    const p = rows[0];
    if (!p) throw bad('Prospect introuvable');
    if (!body.starts_at || Number.isNaN(new Date(body.starts_at).getTime())) throw bad('Date invalide');
    const m = await calendar.book(ctx.state.ws, { prospect: p, startIso: new Date(body.starts_at).toISOString(), source: 'manual', notes: String(body.notes || '') });
    await agent.updateProspect(p.id, { status: 'meeting', stage: 'rdv_planifie' });
    await deps.activity.log(ctx.state.ws.id, 'meeting.booked', { prospectId: p.id, campaignId: p.campaign_id, data: { meeting_id: m.id, starts_at: m.starts_at, name: p.full_name, manual: true } });
    return m;
  });

  router.patch('/api/meetings/:id', requireAuth, async (ctx) => {
    const body = await ctx.json();
    const { rows } = await db.query('SELECT * FROM meetings WHERE id = $1 AND workspace_id = $2', [ctx.params.id, ctx.state.ws.id]);
    const m = rows[0];
    if (!m) throw notFound();
    if (body.notes !== undefined) await db.query('UPDATE meetings SET notes = $2 WHERE id = $1', [m.id, String(body.notes).slice(0, 5000)]);
    if (body.starts_at) {
      const start = new Date(body.starts_at);
      const dur = new Date(m.ends_at) - new Date(m.starts_at);
      await db.query(`UPDATE meetings SET starts_at = $2, ends_at = $3, reminder_sent_at = NULL, status = 'confirmed' WHERE id = $1`, [m.id, start, new Date(start.getTime() + dur)]);
    }
    if (body.status && ['confirmed', 'done', 'no_show', 'cancelled'].includes(body.status) && body.status !== m.status) {
      await agent.meetingStatus(ctx.state.ws, m.id, body.status);
    }
    return { ok: true };
  });

  // ------------------------------------------------------------- public
  router.get('/api/public/calendar/:file', async (ctx) => {
    const token = ctx.params.file.replace(/\.ics$/, '');
    const { rows } = await db.query('SELECT * FROM workspaces WHERE calendar_token = $1', [token]);
    const ws = rows[0];
    if (!ws) throw notFound();
    const { rows: meetings } = await db.query(
      `SELECT m.*, p.full_name, p.title, p.company, p.linkedin_url FROM meetings m LEFT JOIN prospects p ON p.id = m.prospect_id
        WHERE m.workspace_id = $1 AND m.starts_at > now() - interval '60 days' AND m.status <> 'cancelled' ORDER BY m.starts_at`,
      [ws.id],
    );
    const pub = agent.publicUrl(ws);
    const events = meetings.map((m) => ({
      ...m,
      description: [m.full_name && `${m.full_name}${m.title ? `, ${m.title}` : ''}${m.company ? ` chez ${m.company}` : ''}`, m.linkedin_url, m.notes, pub && m.prospect_id ? `Fiche : ${pub}/prospects/${m.prospect_id}` : ''].filter(Boolean).join('\n'),
    }));
    ctx.send(200, icsCalendar(events, `Rendevo - ${ws.name}`), 'text/calendar; charset=utf-8');
  });

  router.get('/api/public/meetings/:file', async (ctx) => {
    const token = ctx.params.file.replace(/\.ics$/, '');
    const { rows } = await db.query(`SELECT m.*, w.name AS ws_name, w.settings->'voice'->>'sender_name' AS sender FROM meetings m JOIN workspaces w ON w.id = m.workspace_id WHERE m.token = $1`, [token]);
    const m = rows[0];
    if (!m) throw notFound();
    ctx.header('Content-Disposition', 'attachment; filename="rendez-vous.ics"');
    ctx.send(200, icsCalendar([{ ...m, title: m.title || `Rendez-vous avec ${m.sender || m.ws_name}`, description: `Lien de la visio : ${m.meeting_url || ''}` }], 'Rendez-vous'), 'text/calendar; charset=utf-8');
  });

  // Public booking page data (shared link for prospects).
  router.get('/api/public/booking/:token', async (ctx) => {
    const { rows } = await db.query('SELECT * FROM workspaces WHERE booking_token = $1', [ctx.params.token]);
    const ws = rows[0];
    if (!ws) throw notFound('Lien de réservation invalide');
    const av = calendar.availability(ws);
    const slots = await calendar.freeSlots(ws, { count: 300 });
    return {
      host: ws.settings?.voice?.sender_name || ws.name,
      title: ws.settings?.offer?.cta || 'Appel découverte',
      offer: ws.settings?.offer?.offer_name || '',
      summary: ws.settings?.offer?.value_prop || '',
      duration: av.slot_minutes,
      timezone: av.timezone,
      slots,
    };
  });

  router.post('/api/public/booking/:token', async (ctx) => {
    const { rows } = await db.query('SELECT * FROM workspaces WHERE booking_token = $1', [ctx.params.token]);
    const ws = rows[0];
    if (!ws) throw notFound('Lien de réservation invalide');
    const body = await ctx.json(20000);
    const name = String(body.name || '').trim().slice(0, 120);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Nom et e-mail valides requis');
    if (!(await calendar.isFree(ws, body.slot, null))) throw bad('Ce créneau n\'est plus disponible, choisissez-en un autre');
    let p = (await db.query('SELECT * FROM prospects WHERE workspace_id = $1 AND (lower(email) = $2 OR ($3::text IS NOT NULL AND lower(linkedin_url) = lower($3)))', [ws.id, email, body.linkedin_url || null])).rows[0];
    if (!p) {
      const res = await agent.importProspects(ws, [{ full_name: name, email, company: body.company || '', linkedin_url: body.linkedin_url || null, notes: body.message || '', source: 'booking' }], { source: 'booking' });
      p = await agent.prospect(res.ids[0]);
    }
    const m = await calendar.book(ws, { prospect: p, startIso: body.slot, source: 'booking_page', notes: String(body.message || '').slice(0, 2000) });
    await agent.updateProspect(p.id, { status: 'meeting', stage: 'rdv_planifie' });
    await deps.activity.log(ws.id, 'meeting.booked', { prospectId: p.id, data: { meeting_id: m.id, starts_at: m.starts_at, name, via: 'booking_page' } });
    await agent.checkGoal(ws);
    const pub = agent.publicUrl(ws);
    return { ok: true, starts_at: m.starts_at, meeting_url: m.meeting_url, ics: `${pub}/api/public/meetings/${m.token}.ics` };
  });
}
