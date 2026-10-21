// Availability, free slots and meeting booking.
import { parseBusy } from '../lib/ics.js';
import { zonedParts, zonedTime, addDays, parseHHMM, formatSlotFr, formatSlotEn } from '../lib/util.js';

export const DEFAULT_AVAILABILITY = {
  timezone: 'Europe/Paris',
  days: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '18:00',
  lunch_start: '12:30',
  lunch_end: '14:00',
  slot_minutes: 30,
  buffer_minutes: 15,
  min_notice_hours: 20,
  horizon_days: 14,
  max_per_day: 4,
  meeting_url: '',
  busy_ics_url: '',
  reminder_hours: 3,
};

const busyCache = new Map();

export class CalendarService {
  constructor({ db, logger = console }) {
    this.db = db;
    this.logger = logger;
  }

  availability(ws) {
    return { ...DEFAULT_AVAILABILITY, ...((ws.settings || {}).availability || {}) };
  }

  async externalBusy(av, from, to) {
    if (!av.busy_ics_url) return [];
    const key = av.busy_ics_url;
    const hit = busyCache.get(key);
    let text = hit && Date.now() - hit.at < 10 * 60e3 ? hit.text : null;
    if (!text) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 12000);
        const res = await fetch(av.busy_ics_url.replace(/^webcal:/, 'https:'), { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
        busyCache.set(key, { at: Date.now(), text });
      } catch (e) {
        this.logger.warn('[calendar] agenda externe illisible:', e.message);
        return hit ? parseBusy(hit.text, from, to) : [];
      }
    }
    return parseBusy(text, from, to);
  }

  /** Lists free slots. opts: { count, spread (one per day), excludeProspectId, from } */
  async freeSlots(ws, opts = {}) {
    const av = this.availability(ws);
    const tz = av.timezone || 'Europe/Paris';
    const now = new Date();
    const from = new Date(Math.max(now.getTime() + av.min_notice_hours * 3600e3, opts.from ? new Date(opts.from).getTime() : 0));
    const to = addDays(now, av.horizon_days);
    const dur = av.slot_minutes;
    const buffer = av.buffer_minutes;

    const { rows: meetings } = await this.db.query(
      `SELECT starts_at, ends_at FROM meetings WHERE workspace_id = $1 AND status IN ('confirmed') AND ends_at > $2 AND starts_at < $3`,
      [ws.id, now, to],
    );
    // Slots currently proposed to other prospects are held for 48h to avoid double booking.
    const { rows: held } = await this.db.query(
      `SELECT setter_state->'proposed' AS proposed FROM prospects
        WHERE workspace_id = $1 AND id <> coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          AND status = 'replied' AND jsonb_typeof(setter_state->'proposed') = 'array'
          AND (setter_state->>'proposed_at')::timestamptz > now() - interval '48 hours'`,
      [ws.id, opts.excludeProspectId || null],
    );
    const busy = [
      ...meetings.map((m) => ({ start: new Date(m.starts_at), end: new Date(m.ends_at) })),
      ...held.flatMap((h) => (h.proposed || []).map((iso) => ({ start: new Date(iso), end: new Date(new Date(iso).getTime() + dur * 60e3) }))),
      ...(await this.externalBusy(av, now, to)),
    ];
    const perDay = new Map();
    for (const m of meetings) {
      const p = zonedParts(new Date(m.starts_at), tz);
      const k = `${p.year}-${p.month}-${p.day}`;
      perDay.set(k, (perDay.get(k) || 0) + 1);
    }

    const start = parseHHMM(av.start, { h: 9, m: 0 });
    const end = parseHHMM(av.end, { h: 18, m: 0 });
    const lunchS = parseHHMM(av.lunch_start, null);
    const lunchE = parseHHMM(av.lunch_end, null);
    const slots = [];
    const days = new Set((av.days || [1, 2, 3, 4, 5]).map(Number));
    let cursor = new Date(now);
    for (let d = 0; d <= av.horizon_days && slots.length < (opts.count || 50) * (opts.spread ? 6 : 1); d++) {
      const p = zonedParts(addDays(cursor, d), tz);
      if (!days.has(p.weekday)) continue;
      const key = `${p.year}-${p.month}-${p.day}`;
      if ((perDay.get(key) || 0) >= (av.max_per_day || 99)) continue;
      let t = zonedTime(p.year, p.month, p.day, start.h, start.m, tz);
      const dayEnd = zonedTime(p.year, p.month, p.day, end.h, end.m, tz);
      const lunch = lunchS && lunchE ? { start: zonedTime(p.year, p.month, p.day, lunchS.h, lunchS.m, tz), end: zonedTime(p.year, p.month, p.day, lunchE.h, lunchE.m, tz) } : null;
      while (t.getTime() + dur * 60e3 <= dayEnd.getTime()) {
        const sEnd = new Date(t.getTime() + dur * 60e3);
        const ok = t >= from
          && !(lunch && t < lunch.end && sEnd > lunch.start)
          && !busy.some((b) => t.getTime() < b.end.getTime() + buffer * 60e3 && sEnd.getTime() > b.start.getTime() - buffer * 60e3);
        if (ok) slots.push(new Date(t));
        t = new Date(t.getTime() + dur * 60e3);
      }
    }
    let result = slots;
    if (opts.spread) {
      // One slot per day, alternating morning / afternoon for choice.
      const byDay = new Map();
      for (const s of slots) {
        const p = zonedParts(s, tz);
        const k = `${p.year}-${p.month}-${p.day}`;
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(s);
      }
      result = [];
      let i = 0;
      for (const list of byDay.values()) {
        const wantAfternoon = i % 2 === 1;
        const preferred = list.find((s) => (zonedParts(s, tz).hour >= 14) === wantAfternoon) || list[0];
        result.push(preferred);
        i++;
        if (result.length >= (opts.count || 3)) break;
      }
    } else if (opts.count) result = slots.slice(0, opts.count);
    return result.map((d) => ({ iso: d.toISOString(), label: formatSlotFr(d, tz), label_en: formatSlotEn(d, tz) }));
  }

  async isFree(ws, startIso, prospectId) {
    const slots = await this.freeSlots(ws, { excludeProspectId: prospectId, count: 500 });
    return slots.some((s) => s.iso === new Date(startIso).toISOString());
  }

  meetingUrlFor(ws, token) {
    const av = this.availability(ws);
    return av.meeting_url || `https://meet.jit.si/rendevo-${token.slice(0, 16)}`;
  }

  async book(ws, { prospect, startIso, source = 'setter', notes = '' }) {
    const av = this.availability(ws);
    const start = new Date(startIso);
    const end = new Date(start.getTime() + av.slot_minutes * 60e3);
    const offerName = ws.settings?.offer?.offer_name || ws.name;
    const { rows } = await this.db.query(
      `INSERT INTO meetings (workspace_id, prospect_id, campaign_id, title, starts_at, ends_at, status, source, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $8) RETURNING *`,
      [ws.id, prospect?.id || null, prospect?.campaign_id || null, `${offerName} x ${prospect?.full_name || 'Rendez-vous'}`, start, end, source, notes],
    );
    const meeting = rows[0];
    const url = this.meetingUrlFor(ws, meeting.token);
    await this.db.query('UPDATE meetings SET meeting_url = $2 WHERE id = $1', [meeting.id, url]);
    meeting.meeting_url = url;
    return meeting;
  }
}
