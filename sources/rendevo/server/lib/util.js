export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function addMinutes(d, m) {
  return new Date(new Date(d).getTime() + m * 60000);
}

export function addDays(d, n) {
  return new Date(new Date(d).getTime() + n * 86400000);
}

export function clampStr(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) : s;
}

export function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] || '', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export function normalizeLinkedinUrl(u) {
  if (!u) return null;
  let s = String(u).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (/^linkedin\.com|^www\.linkedin\.com/i.test(s)) s = 'https://' + s;
    else if (/^[a-z0-9-_%]+$/i.test(s)) s = 'https://www.linkedin.com/in/' + s;
    else return null;
  }
  try {
    const url = new URL(s);
    if (!/linkedin\.com$/i.test(url.hostname.replace(/^www\./, '')) && !/linkedin\.com$/i.test(url.hostname)) return null;
    const m = url.pathname.match(/\/in\/([^/?#]+)/i);
    if (!m) return null;
    return 'https://www.linkedin.com/in/' + decodeURIComponent(m[1]).toLowerCase().replace(/\/$/, '') ;
  } catch {
    return null;
  }
}

export function linkedinIdentifier(url) {
  const m = String(url || '').match(/\/in\/([^/?#]+)/i);
  return m ? m[1] : null;
}

/** Returns parts of a date in a given IANA time zone. */
export function zonedParts(date, timeZone) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  });
  const parts = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
  return {
    year: +parts.year, month: +parts.month, day: +parts.day,
    hour: +parts.hour, minute: +parts.minute, second: +parts.second, weekday: wd,
  };
}

/** Offset (ms) between UTC and the zone at a given instant. */
export function tzOffsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Builds a Date for a wall-clock time in a zone. */
export function zonedTime(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const off = tzOffsetMs(guess, timeZone);
  const d = new Date(guess.getTime() - off);
  const off2 = tzOffsetMs(d, timeZone);
  return off2 === off ? d : new Date(guess.getTime() - off2);
}

export function parseHHMM(s, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return fallback;
  return { h: Math.min(23, +m[1]), m: Math.min(59, +m[2]) };
}

const FR_DAYS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const FR_MONTHS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function formatSlotFr(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const mm = String(p.minute).padStart(2, '0');
  return `${FR_DAYS[p.weekday]} ${p.day} ${FR_MONTHS[p.month]} à ${p.hour}h${mm === '00' ? '' : mm}`;
}

export function formatSlotEn(date, timeZone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function startOfIsoWeek(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const d = zonedTime(p.year, p.month, p.day, 0, 0, timeZone);
  return addDays(d, -(p.weekday - 1));
}

export function safeJsonParse(s, fallback = null) {
  try { return JSON.parse(s); } catch { return fallback; }
}

export function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
