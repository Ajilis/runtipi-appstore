// iCalendar helpers: generate events/feeds, parse busy times from a feed.
function fmt(d) {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function esc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function fold(line) {
  const out = [];
  let s = line;
  while (Buffer.byteLength(s, 'utf8') > 74) {
    let cut = 74;
    while (Buffer.byteLength(s.slice(0, cut), 'utf8') > 74) cut--;
    out.push(s.slice(0, cut));
    s = ' ' + s.slice(cut);
  }
  out.push(s);
  return out.join('\r\n');
}

export function vevent(m) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${m.id}@rendevo`,
    `DTSTAMP:${fmt(m.created_at || new Date())}`,
    `DTSTART:${fmt(m.starts_at)}`,
    `DTEND:${fmt(m.ends_at)}`,
    `SUMMARY:${esc(m.title)}`,
  ];
  if (m.description) lines.push(`DESCRIPTION:${esc(m.description)}`);
  if (m.meeting_url) { lines.push(`LOCATION:${esc(m.meeting_url)}`); lines.push(`URL:${esc(m.meeting_url)}`); }
  if (m.organizer) lines.push(`ORGANIZER;CN=${esc(m.organizer.name)}:mailto:${m.organizer.email}`);
  lines.push(`STATUS:${m.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push('BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Rappel', 'END:VALARM');
  lines.push('END:VEVENT');
  return lines.map(fold).join('\r\n');
}

export function calendar(events, name = 'Rendevo') {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rendevo//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
    ...events.map(vevent),
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function parseIcsDate(value, params) {
  // Supports UTC (Z), floating local time (treated as UTC offset of TZID if possible) and all-day dates.
  const v = value.trim();
  if (/^\d{8}$/.test(v)) {
    return { date: new Date(Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8))), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const [_, y, mo, d, h, mi, s, z] = m;
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
  const tzid = /TZID=([^;:]+)/.exec(params || '');
  if (tzid) {
    try {
      const guess = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
      const f = new Intl.DateTimeFormat('en-GB', { timeZone: tzid[1], hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const p = Object.fromEntries(f.formatToParts(guess).map((x) => [x.type, x.value]));
      const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      return { date: new Date(guess.getTime() - (asUtc - guess.getTime())), allDay: false };
    } catch { /* fall through */ }
  }
  return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
}

/** Extracts busy intervals from an ICS feed (non-recurring events, plus simple weekly RRULE). */
export function parseBusy(icsText, from, to) {
  const text = String(icsText || '').replace(/\r?\n[ \t]/g, '');
  const busy = [];
  const blocks = text.split('BEGIN:VEVENT').slice(1);
  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0];
    const get = (key) => {
      const m = new RegExp(`^${key}([^:\\n]*):(.*)$`, 'm').exec(body);
      return m ? { params: m[1], value: m[2].trim() } : null;
    };
    if (/^TRANSP:TRANSPARENT/m.test(body)) continue;
    if (/^STATUS:CANCELLED/m.test(body)) continue;
    const ds = get('DTSTART');
    const de = get('DTEND');
    if (!ds) continue;
    const s = parseIcsDate(ds.value, ds.params);
    if (!s) continue;
    let e = de ? parseIcsDate(de.value, de.params) : null;
    const end = e ? e.date : new Date(s.date.getTime() + (s.allDay ? 86400000 : 3600000));
    const dur = end - s.date;
    const rrule = get('RRULE');
    if (rrule && /FREQ=WEEKLY/.test(rrule.value)) {
      const until = /UNTIL=(\w+)/.exec(rrule.value);
      const untilDate = until ? (parseIcsDate(until[1], '') || {}).date : null;
      let cur = new Date(s.date);
      while (cur < to && (!untilDate || cur <= untilDate)) {
        if (cur.getTime() + dur > from.getTime()) busy.push({ start: new Date(cur), end: new Date(cur.getTime() + dur) });
        cur = new Date(cur.getTime() + 7 * 86400000);
      }
      continue;
    }
    if (end > from && s.date < to) busy.push({ start: s.date, end });
  }
  return busy;
}
