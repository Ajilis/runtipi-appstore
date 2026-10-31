// Logos des établissements : le serveur récupère l'icône publiée par le site officiel de l'établissement
// (uniquement les sites du catalogue web/institutions.json, jamais une adresse saisie par l'utilisateur),
// puis la conserve en base. Aucun logo n'est fourni avec Vigie.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CATALOGUE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'institutions.json');
const TIMEOUT_MS = 5000;
const MAX_ICON_BYTES = 256 * 1024;
const MAX_HTML_BYTES = 768 * 1024;
const OK_TTL_MS = 30 * 86400_000;
const FAIL_TTL_MS = 3 * 86400_000;
const WAIT_MS = 4000;

// PNG 1 × 1 transparent : réponse quand aucun logo n'est disponible (le monogramme reste visible dessous).
export const TRANSPARENT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export function loadCatalogue(file = CATALOGUE_FILE) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Map(data.institutions.map((i) => [i.id, i]));
}

// Reconnaît le format réel d'une image à partir de ses premiers octets (SVG refusé : il peut contenir du script).
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  return null;
}

// Seules les adresses https vers un nom de domaine public sont suivies.
export function safeUrl(value, base) {
  let url;
  try { url = new URL(value, base); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const h = url.hostname.toLowerCase();
  if (!h.includes('.') || h === 'localhost' || /^[\d.]+$/.test(h) || h.startsWith('[') || /\.(local|internal|lan|home|localhost)$/.test(h)) return null;
  return url;
}

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}

// Icônes déclarées dans la page d'accueil, de la plus adaptée à la moins adaptée.
export function parseIconLinks(html, baseUrl) {
  const found = [];
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    const href = attr(tag, 'href');
    if (!href || !/\bicon\b|apple-touch-icon/.test(rel)) continue;
    if (/\.svg(\?|#|$)/i.test(href) || /svg/i.test(attr(tag, 'type') || '') || rel.includes('mask-icon')) continue;
    const sizes = (attr(tag, 'sizes') || '').split(/\s+/).map((s) => Number.parseInt(s, 10)).filter(Number.isFinite);
    const size = sizes.length ? Math.max(...sizes) : rel.includes('apple-touch-icon') ? 180 : 32;
    const url = safeUrl(href, baseUrl);
    if (url) found.push({ url: url.href, score: (rel.includes('apple-touch-icon') ? 1000 : 0) + Math.min(size, 512) });
  }
  return [...new Map(found.sort((a, b) => b.score - a.score).map((f) => [f.url, f])).values()].map((f) => f.url);
}

async function fetchLimited(fetcher, url, limit, accept) {
  const res = await fetcher(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VigiePatrimoine; +icon)', Accept: accept },
  });
  if (!res.ok) return null;
  if (res.url && !safeUrl(res.url)) return null;
  if (Number(res.headers.get('content-length') || 0) > limit) return null;
  const chunks = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return { buf: Buffer.concat(chunks), url: res.url || url };
}

// Ordre d'essai : /apple-touch-icon.png, icônes déclarées par la page d'accueil, /favicon.ico.
export async function fetchLogo(host, fetcher = globalThis.fetch) {
  const base = safeUrl(`https://${host}/`);
  if (!base) return null;
  const tryIcon = async (u) => {
    const url = safeUrl(u);
    if (!url) return null;
    const r = await fetchLimited(fetcher, url.href, MAX_ICON_BYTES, 'image/avif,image/webp,image/png,image/*;q=0.8').catch(() => null);
    const type = r ? sniffImage(r.buf) : null;
    return type && r.buf.length >= 64 ? { type, data: r.buf } : null;
  };
  let hit = await tryIcon(new URL('/apple-touch-icon.png', base).href);
  if (hit) return hit;
  const page = await fetchLimited(fetcher, base.href, MAX_HTML_BYTES, 'text/html').catch(() => null);
  if (page) {
    for (const u of parseIconLinks(page.buf.toString('utf8'), page.url).slice(0, 4)) {
      hit = await tryIcon(u);
      if (hit) return hit;
    }
  }
  return tryIcon(new URL('/favicon.ico', base).href);
}

export class LogoService {
  constructor(db, { enabled = true, fetcher = globalThis.fetch, log = console } = {}) {
    this.db = db;
    this.enabled = enabled;
    this.fetcher = fetcher;
    this.log = log;
    this.catalogue = loadCatalogue();
    this.pending = new Map();
  }

  cached(host) {
    return this.db.prepare('SELECT content_type, data, ok, fetched_at FROM logo_cache WHERE host = ?').get(host);
  }

  refresh(host) {
    if (this.pending.has(host)) return this.pending.get(host);
    const p = (async () => {
      let logo = null;
      try { logo = await fetchLogo(host, this.fetcher); } catch (err) { this.log.debug?.(`Logo ${host} : ${err.message}`); }
      this.db.prepare(`INSERT INTO logo_cache (host, content_type, data, ok, fetched_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(host) DO UPDATE SET content_type = excluded.content_type, data = excluded.data, ok = excluded.ok, fetched_at = excluded.fetched_at`)
        .run(host, logo ? logo.type : null, logo ? logo.data : null, logo ? 1 : 0, Date.now());
      if (!logo) this.log.info?.(`Logo indisponible pour ${host} : monogramme affiché`);
      return logo;
    })().finally(() => this.pending.delete(host));
    this.pending.set(host, p);
    return p;
  }

  // Renvoie { type, data } du logo, ou null (monogramme). N'attend jamais plus de quelques secondes.
  async get(id) {
    const entry = this.catalogue.get(id);
    if (!entry) return undefined;
    if (!this.enabled || !entry.host) return null;
    const row = this.cached(entry.host);
    const age = row ? Date.now() - row.fetched_at : Infinity;
    if (row && row.ok && age < OK_TTL_MS) return { type: row.content_type, data: row.data };
    if (row && !row.ok && age < FAIL_TTL_MS) return null;
    const job = this.refresh(entry.host);
    const fresh = await Promise.race([job, new Promise((r) => { const t = setTimeout(() => r(undefined), WAIT_MS); t.unref?.(); })]);
    if (fresh) return fresh;
    // Pas encore de réponse : ancien logo s'il existe, sinon monogramme (le prochain affichage aura le logo).
    return row && row.ok ? { type: row.content_type, data: row.data } : null;
  }

  clearFailures() {
    return this.db.prepare('DELETE FROM logo_cache WHERE ok = 0').run().changes;
  }
}
