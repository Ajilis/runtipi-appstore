// Logos des établissements : le serveur récupère l'icône publiée par le site officiel de l'établissement
// (uniquement les sites du catalogue web/institutions.json, jamais une adresse saisie par l'utilisateur),
// puis la conserve en base. Aucun logo n'est fourni avec Vigie. L'administrateur peut aussi déposer sa propre
// image pour un établissement : elle remplace alors le logo récupéré.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CATALOGUE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'institutions.json');
const TIMEOUT_MS = 6000;
const MAX_ICON_BYTES = 512 * 1024;
const MAX_HTML_BYTES = 1536 * 1024;
const MAX_MANIFEST_BYTES = 96 * 1024;
const MAX_ATTEMPTS = 8;
const GOOD_SIDE = 120; // une icône d'au moins 120 px reste nette dans toutes les pastilles
export const OK_TTL_MS = 30 * 86400_000;
export const FAIL_TTL_MS = 3 * 86400_000;
const WAIT_MS = 4000;
const PREFETCH_DELAY_MS = 15_000;
const PREFETCH_EVERY_MS = 24 * 3600_000;
const PREFETCH_CONCURRENCY = 3;
// Certains sites refusent les clients qui ne se présentent pas comme un navigateur.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6',
};
export const CUSTOM_KEY = /^perso-[a-z0-9-]{1,80}$/;
// Dernier recours, pour un site qui bloque les serveurs ou n'offre qu'une petite icône : le service d'icônes de
// Google, qui ne reçoit que le nom de domaine de l'établissement (jamais une donnée de l'utilisateur).
const FALLBACK_BELOW = 64;
export const FALLBACK_SOURCE = "service d'icônes Google";
export const fallbackUrl = (host) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=256`;

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

// Dimensions en pixels lues dans l'en-tête de l'image ; pour un .ico, la plus grande image qu'il contient.
export function imageSize(buf, type = sniffImage(buf)) {
  try {
    if (type === 'image/png' && buf.length >= 24 && buf.toString('ascii', 12, 16) === 'IHDR') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (type === 'image/gif' && buf.length >= 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (type === 'image/x-icon' && buf.length >= 6) {
      const count = buf.readUInt16LE(4);
      let best = null;
      for (let i = 0; i < count && 6 + i * 16 + 2 <= buf.length; i++) {
        const w = buf[6 + i * 16] || 256, h = buf[7 + i * 16] || 256;
        if (!best || Math.min(w, h) > Math.min(best.width, best.height)) best = { width: w, height: h };
      }
      return best;
    }
    if (type === 'image/webp' && buf.length >= 30) {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const b = buf.subarray(21, 25); return { width: 1 + (b[0] | ((b[1] & 0x3f) << 8)), height: 1 + ((b[1] >> 6) | (b[2] << 2) | ((b[3] & 0x0f) << 10)) }; }
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (type === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* en-tête tronqué */ }
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
const decodeEntities = (s) => String(s).replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');
const declaredSize = (sizes) => {
  const list = String(sizes || '').toLowerCase().split(/\s+/).map((s) => (s === 'any' ? 512 : Number.parseInt(s, 10))).filter(Number.isFinite);
  return list.length ? Math.max(...list) : null;
};
// Préférence : autour de 192 à 256 px (net sans être lourd), puis les plus grandes, puis les petites.
const scoreForSize = (size) => (size >= 120 ? 1000 - Math.abs(Math.min(size, 1024) - 224) / 4 : size);
const DATA_ICON = /^data:image\/(png|x-icon|vnd\.microsoft\.icon|jpeg|gif|webp);base64,([a-z0-9+/=\s]+)$/i;

// Icônes déclarées dans la page d'accueil : <link rel="icon">, <link rel="apple-touch-icon">, tuile Windows,
// et icônes en ligne (data:). Les SVG sont ignorés.
export function parseIconCandidates(html, baseUrl) {
  const found = [];
  const text = String(html);
  for (const tag of text.match(/<link\b[^>]*>/gi) || []) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    const href = decodeEntities(attr(tag, 'href') || '').trim();
    if (!href || !/(^|\s)(shortcut\s+)?icon(\s|$)|apple-touch-icon|fluid-icon/.test(rel)) continue;
    if (/\.svg(\?|#|$)/i.test(href) || /svg/i.test(attr(tag, 'type') || '') || rel.includes('mask-icon') || /^data:image\/svg/i.test(href)) continue;
    const apple = rel.includes('apple-touch-icon');
    const size = declaredSize(attr(tag, 'sizes')) ?? (apple ? 180 : 32);
    const via = apple ? 'apple-touch-icon' : 'icon';
    const inline = DATA_ICON.exec(href);
    if (inline) { found.push({ data: Buffer.from(inline[2].replace(/\s/g, ''), 'base64'), url: `data:${via}`, score: scoreForSize(size) + 1, via: 'icône intégrée à la page' }); continue; }
    const url = safeUrl(href, baseUrl);
    if (url) found.push({ url: url.href, score: scoreForSize(size) + (apple ? 2 : 0), via });
  }
  for (const tag of text.match(/<meta\b[^>]*>/gi) || []) {
    if (!/msapplication-tileimage/i.test(attr(tag, 'name') || '')) continue;
    const url = safeUrl(decodeEntities(attr(tag, 'content') || '').trim(), baseUrl);
    if (url && !/\.svg(\?|#|$)/i.test(url.pathname)) found.push({ url: url.href, score: scoreForSize(144) - 5, via: 'tuile Windows' });
  }
  return found;
}

// Compatibilité : adresses des icônes déclarées, de la plus adaptée à la moins adaptée.
export function parseIconLinks(html, baseUrl) {
  return dedupe(parseIconCandidates(html, baseUrl).filter((c) => !c.data)).map((c) => c.url);
}

export function parseManifestLink(html, baseUrl) {
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
    if (!/(^|\s)manifest(\s|$)/i.test(attr(tag, 'rel') || '')) continue;
    const url = safeUrl(decodeEntities(attr(tag, 'href') || '').trim(), baseUrl);
    if (url) return url.href;
  }
  return null;
}

// Icônes du manifeste d'application web (souvent 192 et 512 px, en couleur).
export function parseManifestIcons(json, baseUrl) {
  let m;
  try { m = JSON.parse(json); } catch { return []; }
  const out = [];
  for (const icon of Array.isArray(m && m.icons) ? m.icons.slice(0, 30) : []) {
    if (!icon || typeof icon.src !== 'string') continue;
    const purpose = String(icon.purpose || 'any').toLowerCase();
    if (/svg/i.test(String(icon.type || '')) || /\.svg(\?|#|$)/i.test(icon.src) || (!/\bany\b/.test(purpose) && !/\bmaskable\b/.test(purpose))) continue;
    const url = safeUrl(icon.src, baseUrl);
    const size = declaredSize(icon.sizes) ?? 192;
    if (url) out.push({ url: url.href, score: scoreForSize(size) - (/\bany\b/.test(purpose) ? 0 : 150), via: 'manifeste du site' });
  }
  return out;
}

function dedupe(list) {
  const best = new Map();
  for (const c of list) if (!best.has(c.url) || best.get(c.url).score < c.score) best.set(c.url, c);
  return [...best.values()].sort((a, b) => b.score - a.score);
}

async function fetchLimited(fetcher, url, limit, accept) {
  const res = await fetcher(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { ...HEADERS, Accept: accept } });
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

const side = (logo) => (logo && logo.width && logo.height ? Math.min(logo.width, logo.height) : 0);

// Cherche la meilleure icône du site : celles que la page et son manifeste déclarent, puis les emplacements
// habituels (/apple-touch-icon.png, /favicon.ico). S'arrête dès qu'une icône d'au moins 120 px est trouvée,
// sinon garde la plus grande. fallback : service d'icônes Google si rien d'au moins 64 px n'a été trouvé.
export async function fetchLogo(host, fetcher = globalThis.fetch, { fallback = false } = {}) {
  const base = safeUrl(`https://${host}/`);
  if (!base) return null;
  const candidates = [];
  const page = await fetchLimited(fetcher, base.href, MAX_HTML_BYTES, 'text/html,application/xhtml+xml').catch(() => null);
  if (page) {
    const html = page.buf.toString('utf8');
    candidates.push(...parseIconCandidates(html, page.url));
    const manifest = parseManifestLink(html, page.url);
    if (manifest) {
      const m = await fetchLimited(fetcher, manifest, MAX_MANIFEST_BYTES, 'application/manifest+json,application/json').catch(() => null);
      if (m) candidates.push(...parseManifestIcons(m.buf.toString('utf8'), m.url));
    }
  }
  candidates.push({ url: new URL('/apple-touch-icon.png', base).href, score: scoreForSize(180) - 8, via: 'apple-touch-icon' });
  candidates.push({ url: new URL('/apple-touch-icon-precomposed.png', base).href, score: scoreForSize(180) - 9, via: 'apple-touch-icon' });
  candidates.push({ url: new URL('/favicon.ico', base).href, score: 8, via: 'favicon.ico' });

  let best = null;
  let attempts = 0;
  for (const c of dedupe(candidates)) {
    if (attempts >= MAX_ATTEMPTS) break;
    let buf = c.data || null;
    let source = c.url;
    if (!buf) {
      attempts++;
      const r = await fetchLimited(fetcher, c.url, MAX_ICON_BYTES, 'image/avif,image/webp,image/png,image/*;q=0.8').catch(() => null);
      if (!r) continue;
      buf = r.buf;
      source = r.url;
    } else if (buf.length > MAX_ICON_BYTES) continue;
    const type = sniffImage(buf);
    if (!type || buf.length < 64) continue;
    const size = imageSize(buf, type) || { width: null, height: null };
    const hit = { type, data: buf, width: size.width, height: size.height, source: c.data ? c.via : source };
    if (!best || side(hit) > side(best)) best = hit;
    if (side(best) >= GOOD_SIDE) break;
  }
  if (fallback && side(best) < FALLBACK_BELOW) {
    const r = await fetchLimited(fetcher, fallbackUrl(host), MAX_ICON_BYTES, 'image/png,image/*;q=0.8').catch(() => null);
    const type = r ? sniffImage(r.buf) : null;
    if (type && r.buf.length >= 64) {
      const size = imageSize(r.buf, type) || { width: null, height: null };
      const hit = { type, data: r.buf, width: size.width, height: size.height, source: FALLBACK_SOURCE };
      if (!best || side(hit) > side(best)) best = hit;
    }
  }
  return best;
}

// Les URLs externes ne proviennent jamais d'un champ libre : seuls les deux
// hébergeurs de ressources du catalogue ouvert sont acceptés.
export async function fetchDirectoryLogo(url, fetcher = globalThis.fetch) {
  const source = safeUrl(url);
  if (!source || !['static.openfintech.io', 'commons.wikimedia.org'].includes(source.hostname)) return null;
  const image = await fetchLimited(fetcher, source.href, MAX_ICON_BYTES, 'image/png,image/*;q=0.8').catch(() => null);
  if (!image) return null;
  const destination = safeUrl(image.url);
  if (!destination || !['static.openfintech.io', 'commons.wikimedia.org', 'upload.wikimedia.org'].includes(destination.hostname)) return null;
  const type = sniffImage(image.buf);
  if (!type || image.buf.length < 64) return null;
  const size = imageSize(image.buf, type);
  return { type, data: image.buf, width: size?.width || null, height: size?.height || null, source: source.hostname };
}

export class LogoService {
  constructor(db, { enabled = true, fallback = false, fetcher = globalThis.fetch, log = console } = {}) {
    this.db = db;
    this.enabled = enabled;
    this.fallback = fallback;
    this.fetcher = fetcher;
    this.log = log;
    this.catalogue = loadCatalogue();
    this.pending = new Map();
    this.batch = null;
    this.lastBatch = null;
    this.closed = false;
  }

  cacheKeyOf(e) { return e.host || (e.logo_url || this.directory?.enabled ? 'catalogue:' + e.id : null); }

  hostOf(id) {
    const e = this.catalogue.get(id);
    return e ? this.cacheKeyOf(e) : undefined;
  }

  cached(host) {
    return this.db.prepare('SELECT content_type, data, ok, fetched_at, width, height FROM logo_cache WHERE host = ?').get(host);
  }

  refresh(host) {
    if (this.pending.has(host)) return this.pending.get(host);
    const p = (async () => {
      let logo = null;
      try {
        const entry = [...this.catalogue.values()].find((e) => this.cacheKeyOf(e) === host);
        // Les sources ouvertes sont recherchées en premier, pour les fiches historiques
        // comme pour les établissements Sirene (même sans site officiel connu).
        const candidates = [this.directory?.openFinTechLogo(entry), entry?.logo_url].filter(Boolean);
        for (const url of new Set(candidates)) {
          logo = await fetchDirectoryLogo(url, this.fetcher);
          if (logo) break;
        }
        if (!logo && entry && this.directory?.enabled) {
          const wikidataUrl = await this.directory.wikidataLogo(entry).catch((err) => {
            this.log.debug?.('Wikidata logo ' + entry.id + ' : ' + err.message);
            return null;
          });
          if (wikidataUrl && !candidates.includes(wikidataUrl)) logo = await fetchDirectoryLogo(wikidataUrl, this.fetcher);
        }
        if (!logo && entry?.host) logo = await fetchLogo(entry.host, this.fetcher, { fallback: this.fallback });
      } catch (err) { this.log.debug?.(`Logo ${host} : ${err.message}`); }
      if (this.closed) return logo;
      try {
        this.db.prepare(`INSERT INTO logo_cache (host, content_type, data, ok, fetched_at, width, height, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(host) DO UPDATE SET content_type = excluded.content_type, data = excluded.data, ok = excluded.ok, fetched_at = excluded.fetched_at,
          width = excluded.width, height = excluded.height, source = excluded.source`)
          .run(host, logo ? logo.type : null, logo ? logo.data : null, logo ? 1 : 0, Date.now(), logo ? logo.width : null, logo ? logo.height : null, logo ? String(logo.source).slice(0, 300) : null);
      } catch (err) { this.log.warn?.(`Logo ${host} non enregistré : ${err.message}`); }
      if (!logo) this.log.info?.(`Logo indisponible pour ${host} : monogramme affiché`);
      return logo;
    })().finally(() => this.pending.delete(host));
    this.pending.set(host, p);
    return p;
  }

  // Renvoie { type, data } du logo, null (monogramme) ou undefined (établissement inconnu).
  // L'image déposée par l'administrateur passe avant le logo récupéré. N'attend jamais plus de quelques secondes.
  async get(id) {
    const own = this.custom(id);
    if (own) return { type: own.content_type, data: own.data };
    const entry = this.catalogue.get(id);
    if (!entry) return CUSTOM_KEY.test(id) ? null : undefined;
    const key = this.cacheKeyOf(entry);
    if (!this.enabled || !key) return null;
    const row = this.cached(key);
    const age = row ? Date.now() - row.fetched_at : Infinity;
    if (row && row.ok && age < OK_TTL_MS) return { type: row.content_type, data: row.data };
    if (row && !row.ok && age < FAIL_TTL_MS) return null;
    const job = this.refresh(key);
    const fresh = await Promise.race([job, new Promise((r) => { const t = setTimeout(() => r(undefined), WAIT_MS); t.unref?.(); })]);
    if (fresh) return fresh;
    // Pas encore de réponse : ancien logo s'il existe, sinon monogramme (le prochain affichage aura le logo).
    return row && row.ok ? { type: row.content_type, data: row.data } : null;
  }

  // --- Images déposées par l'administrateur ---------------------------------------------------------------------
  custom(key) {
    return this.db.prepare('SELECT key, name, content_type, data, width, height, updated_at FROM institution_logos WHERE key = ?').get(key);
  }

  setCustom(key, name, data, userId) {
    const type = sniffImage(data);
    const size = imageSize(data, type) || {};
    this.db.prepare(`INSERT INTO institution_logos (key, name, content_type, data, width, height, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET name = excluded.name, content_type = excluded.content_type, data = excluded.data, width = excluded.width,
      height = excluded.height, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .run(key, name, type, data, size.width ?? null, size.height ?? null, Date.now(), userId ?? null);
    return this.custom(key);
  }

  removeCustom(key) {
    return this.db.prepare('DELETE FROM institution_logos WHERE key = ?').run(key).changes;
  }

  // Version de chaque logo disponible, pour que le navigateur recharge l'image quand elle change.
  versions() {
    const out = {};
    const ok = new Map(this.db.prepare('SELECT host, fetched_at FROM logo_cache WHERE ok = 1').all().map((r) => [r.host, r.fetched_at]));
    if (this.enabled) for (const [id, e] of this.catalogue) { const k = this.cacheKeyOf(e); if (k && ok.has(k)) out[id] = `f${ok.get(k)}`; }
    for (const r of this.db.prepare('SELECT key, updated_at FROM institution_logos').all()) out[r.key] = `c${r.updated_at}`;
    return out;
  }

  // État détaillé pour la page « Logos des établissements ».
  status() {
    const rows = new Map(this.db.prepare('SELECT host, ok, fetched_at, width, height, source FROM logo_cache').all().map((r) => [r.host, r]));
    const catalogue = {};
    for (const [id, e] of this.catalogue) {
      const key = this.cacheKeyOf(e);
      const r = key ? rows.get(key) : null;
      let status = !key ? 'no_site' : !r ? 'missing' : r.ok ? 'ok' : 'failed';
      if (key && this.pending.has(key)) status = 'fetching';
      catalogue[id] = {
        status, host: e.host || (this.directory?.enabled || e.logo_url ? 'Wikidata / OpenFinTech' : null),
        fetched_at: r ? r.fetched_at : null, width: r && r.ok ? r.width : null, height: r && r.ok ? r.height : null, source: r && r.ok ? r.source : null,
        retry_after: r && !r.ok ? r.fetched_at + FAIL_TTL_MS : null,
      };
    }
    const custom = {};
    for (const r of this.db.prepare('SELECT key, name, width, height, updated_at FROM institution_logos ORDER BY name').all()) custom[r.key] = { ...r };
    return { enabled: this.enabled, fallback: this.enabled && this.fallback, batch: this.batch, last_batch: this.lastBatch, catalogue, custom };
  }

  // Récupère d'avance les logos de tout le catalogue : absents, expirés, ou issus d'une ancienne version
  // (dimensions inconnues). includeFailed : réessaie aussi les échecs récents.
  prefetchAll({ includeFailed = false } = {}) {
    if (!this.enabled || this.closed) return null;
    if (this.batch) return this.batch;
    const now = Date.now();
    const rows = new Map(this.db.prepare('SELECT host, ok, fetched_at, width FROM logo_cache').all().map((r) => [r.host, r]));
    const hosts = [...new Set([...this.catalogue.values()].map((e) => this.cacheKeyOf(e)).filter(Boolean))].filter((h) => {
      const r = rows.get(h);
      if (!r) return true;
      if (r.ok) return now - r.fetched_at >= OK_TTL_MS || r.width === null;
      return includeFailed || now - r.fetched_at >= FAIL_TTL_MS;
    });
    const batch = { total: hosts.length, done: 0, found: 0, started_at: now };
    if (!hosts.length) {
      this.lastBatch = { ...batch, finished_at: now };
      Object.defineProperty(batch, 'promise', { value: Promise.resolve(this.lastBatch), enumerable: false });
      return batch;
    }
    this.batch = batch;
    const queue = [...hosts];
    const worker = async () => {
      while (queue.length && !this.closed) {
        const host = queue.shift();
        const logo = await this.refresh(host).catch(() => null);
        batch.done++;
        if (logo) batch.found++;
      }
    };
    batch.promise = Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, hosts.length) }, worker)).then(() => {
      this.lastBatch = { total: batch.total, done: batch.done, found: batch.found, started_at: batch.started_at, finished_at: Date.now() };
      this.batch = null;
      if (batch.total) this.log.info?.(`Logos des établissements : ${batch.found} récupéré(s) sur ${batch.total}`);
      return this.lastBatch;
    });
    Object.defineProperty(batch, 'promise', { enumerable: false });
    return batch;
  }

  // Préchargement peu après le démarrage, puis une fois par jour.
  startScheduler() {
    if (!this.enabled) return [];
    const first = setTimeout(() => this.prefetchAll(), PREFETCH_DELAY_MS);
    const daily = setInterval(() => this.prefetchAll(), PREFETCH_EVERY_MS);
    first.unref?.();
    daily.unref?.();
    return [first, daily];
  }

  clearFailures() {
    return this.db.prepare('DELETE FROM logo_cache WHERE ok = 0').run().changes;
  }

  close() {
    this.closed = true;
  }
}
