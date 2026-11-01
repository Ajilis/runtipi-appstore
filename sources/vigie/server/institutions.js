// Annuaire vivant : la liste embarquée reste toujours disponible. Les sources externes
// sont lues uniquement par le serveur, sans transmettre les avoirs ni les utilisateurs.
import { createHash } from 'node:crypto';
import { loadCatalogue } from './logos.js';

const OFT = 'https://static.openfintech.io/raw/';
const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const FRANCE = 'https://recherche-entreprises.api.gouv.fr/search';
const DAY = 86400_000;
const QUERY_TTL = 30 * 60_000;
const WIKIDATA_POSITIVE_TTL = 30 * DAY;
const WIKIDATA_NEGATIVE_TTL = 3 * DAY;
const MAX_ITEMS = 1800;
// Correspondances vérifiées sur les mentions légales officielles, jamais par similarité approximative.
const VERIFIED_LEGAL_BRANDS = Object.freeze({ 'n26 bank se': 'n26', 'vivid money s a': 'vivid-money' });
const FINANCE = /banqu|bank|financ|assuran|insuran|courtier|broker|invest|gestion d.actifs|asset manag|paiement|payment|néobanqu|credit institution|établissement de crédit|société de crédit|bourse|stock exchang|cryptocurrency exchang|épargn|epargn|savings|mutuelle|mutual/i;

export const normalizeInstitution = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function officialHost(link) {
  try {
    const u = new URL(link);
    const h = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.port || u.username || u.password ||
        !h.includes('.') || h.startsWith('[') || /^[0-9.]+$/.test(h) ||
        /(^localhost$|\.(local|internal|lan|home|localhost|test|invalid)$)/.test(h)) return null;
    return h;
  } catch { return null; }
}

const short = (s, n = 80) => typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, n) : '';
const sha = (s) => createHash('sha256').update(s).digest('hex');

export class InstitutionDirectory {
  constructor(db, { fetcher = globalThis.fetch, log = console, enabled = true } = {}) {
    this.db = db;
    this.fetcher = fetcher;
    this.log = log;
    this.enabled = enabled;
    this.catalogue = loadCatalogue();
    this.searchCache = new Map();
    this.searchPending = new Map();
    this.logoPending = new Map();
    this.syncPending = null;
    this.closed = false;
    this.lastSync = null;
    this.loadStored();
  }

  loadStored() {
    for (const r of this.db.prepare('SELECT * FROM institution_directory ORDER BY name LIMIT ?').all(MAX_ITEMS)) {
      try {
        this.accept({
          id: r.id, name: r.name, kind: r.kind, host: r.host, aliases: JSON.parse(r.aliases),
          logo_url: r.logo_url, source: r.source,
        }, false);
      } catch { /* ligne de cache anciennement invalide : ignorer sans perdre le reste */ }
    }
  }

  accept(entry, persist = true) {
    const id = short(entry.id, 90).toLowerCase();
    const name = short(entry.name);
    const kind = short(entry.kind, 60) || 'Établissement financier';
    if (!/^[a-z0-9][a-z0-9-]{2,89}$/.test(id) || name.length < 3 || !['Wikidata', 'OpenFinTech', 'Sirene'].includes(entry.source)) return false;
    const key = normalizeInstitution(name);
    if (key.length < 3) return false;
    const current = this.catalogue.get(id);
    // Une dénomination Sirene peut différer de la marque utilisée par le client.
    // Préserver la fiche Sirene et son identifiant, mais y associer le site et le logo de marque vérifiés.
    const brand = this.catalogue.get(VERIFIED_LEGAL_BRANDS[key]);
    if (!current && this.catalogue.size >= MAX_ITEMS) return false;
    // L'identifiant et le libellé des établissements historiques restent inchangés.
    if (!current && [...this.catalogue.values()].some((e) => normalizeInstitution(e.name) === key)) return false;
    const site = brand?.host || entry.host;
    const host = officialHost(site ? 'https://' + site : '');
    const candidateLogo = brand?.logo_url || entry.logo_url;
    const url = typeof candidateLogo === 'string' && (
      /^https:\/\/static\.openfintech\.io\/vendors\/[a-z0-9._-]+\/icon\.png$/.test(candidateLogo) ||
      /^https:\/\/commons\.wikimedia\.org\/wiki\/Special:Redirect\/file\/[^?#]{3,200}\?width=256$/.test(candidateLogo)
    ) ? candidateLogo : null;
    const aliases = Array.isArray(entry.aliases) ? entry.aliases.map((s) => short(s)).filter((s) => s.length > 1 && s !== name).slice(0, 10) : [];
    const clean = { id, name, kind, host, aliases, logo_url: url, source: entry.source };
    this.catalogue.set(id, clean);
    if (persist) this.db.prepare(
      'INSERT INTO institution_directory (id,name,kind,host,aliases,logo_url,source,updated_at) VALUES (?,?,?,?,?,?,?,?) ' +
      'ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,host=excluded.host,aliases=excluded.aliases,logo_url=excluded.logo_url,source=excluded.source,updated_at=excluded.updated_at'
    ).run(id, name, kind, host, JSON.stringify(aliases), url, entry.source, Date.now());
    return true;
  }

  list() {
    return [...this.catalogue.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  async getText(url, maxBytes = 2_000_000) {
    const response = await this.fetcher(url, {
      redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Vigie-Patrimoine/0.9 (open-source institution directory; Ajilis/runtipi-appstore)', Accept: 'application/json,text/plain;q=0.9' },
    });
    if (!response.ok || Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('Source indisponible ou trop volumineuse');
    const txt = await response.text();
    if (Buffer.byteLength(txt) > maxBytes) throw new Error('Réponse trop volumineuse');
    return txt;
  }

  async getJson(url, maxBytes = 2_000_000) {
    return JSON.parse(await this.getText(url, maxBytes));
  }

  // Le fichier OpenFinTech n'est publié que sur validation du descripteur et des sommes SHA-256.
  async syncOpenFinTech() {
    if (!this.enabled || this.closed) return { added: 0, disabled: true };
    if (this.syncPending) return this.syncPending;
    this.syncPending = (async () => {
      const desc = await this.getJson(OFT + 'latest.json', 10_000);
      if (!/^v[0-9.]+$/.test(desc.version || '') || !/^[a-f0-9]{64}$/.test(desc.sha256sums || '')) throw new Error('Version OpenFinTech invalide');
      const previous = this.db.prepare("SELECT value FROM settings WHERE key='institutions_oft_logo_version'").get();
      if (previous?.value === desc.version) return { added: 0, unchanged: true, version: desc.version };
      const sums = await this.getText(OFT + 'SHA256SUMS', 150_000);
      if (sha(sums) !== desc.sha256sums) throw new Error('Signature OpenFinTech SHA256SUMS incohérente');
      const record = sums.split('\n').find((line) => /^[a-f0-9]{64}\s+\*?data\/vendors\.json$/.test(line.trim()));
      if (!record) throw new Error('Checksum vendors.json absent');
      const expected = record.trim().split(/\s+/)[0];
      const raw = await this.getText(OFT + 'data/vendors.json', 3_000_000);
      if (sha(raw) !== expected) throw new Error('Checksum vendors.json incohérent : publication en cours');
      const vendors = JSON.parse(raw);
      if (!Array.isArray(vendors)) throw new Error('Catalogue OpenFinTech invalide');
      let added = 0;
      const upsertLogo = this.db.prepare(
        'INSERT INTO institution_logo_sources(id,openfintech_url) VALUES(?,?) ' +
        'ON CONFLICT(id) DO UPDATE SET openfintech_url=excluded.openfintech_url'
      );
      for (const v of vendors) {
        if (this.closed || !v || v.status !== 'active' || !Array.isArray(v.countries) || !v.countries.includes('FR')) continue;
        const code = short(v.code, 65).toLowerCase();
        if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(code)) continue;
        const name = short(v.name?.fr || v.name?.en);
        const host = officialHost(v.links?.website);
        const id = 'oft-' + code.replace(/[^a-z0-9]+/g, '-').replace(/-+$/g, '');
        const logoUrl = 'https://static.openfintech.io/vendors/' + encodeURIComponent(code) + '/icon.png';
        // Un nom exact ou un même domaine officiel permet de rapprocher un fournisseur et
        // un établissement historique sans changer son identifiant ni toucher aux avoirs.
        const names = new Set([v.name?.en, v.name?.fr].map(normalizeInstitution).filter(Boolean));
        const canonicalHost = (h) => String(h || '').replace(/^www\./, '').toLowerCase();
        for (const entry of this.catalogue.values()) {
          if (!entry.id || entry.id.startsWith('oft-')) continue;
          const sameName = [entry.name, ...(entry.aliases || [])].some((n) => names.has(normalizeInstitution(n)));
          const sameSite = host && entry.host && canonicalHost(host) === canonicalHost(entry.host);
          if (sameName || sameSite) upsertLogo.run(entry.id, logoUrl);
        }
        if (this.accept({ id, name, host, kind: 'Services financiers', source: 'OpenFinTech',
          aliases: [v.name?.en, v.name?.fr].filter(Boolean),
          logo_url: logoUrl,
        })) added++;
      }
      this.db.prepare("INSERT INTO settings(key,value) VALUES('institutions_oft_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(desc.version);
      this.db.prepare("INSERT INTO settings(key,value) VALUES('institutions_oft_logo_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(desc.version);
      this.lastSync = Date.now();
      this.onUpdated?.();
      this.log.info?.('Annuaire OpenFinTech : ' + added + ' fiches mises à jour (' + desc.version + ')');
      return { added, version: desc.version };
    })().finally(() => { this.syncPending = null; });
    return this.syncPending;
  }

  // Priorité des logos : OpenFinTech (fournisseurs vérifiés), puis Wikidata (P154),
  // enfin le site officiel. Les sources ne reçoivent que le nom de l'établissement.
  openFinTechLogo(entry) {
    if (!this.enabled || !entry) return null;
    const row = this.db.prepare('SELECT openfintech_url FROM institution_logo_sources WHERE id = ?').get(entry.id);
    return row?.openfintech_url || (entry.source === 'OpenFinTech' ? entry.logo_url : null) || null;
  }

  async wikidataLogo(entry) {
    if (!this.enabled || this.closed || !entry?.name) return null;
    const row = this.db.prepare('SELECT wikidata_url, wikidata_checked_at FROM institution_logo_sources WHERE id = ?').get(entry.id);
    const age = row ? Date.now() - row.wikidata_checked_at : Infinity;
    if (age >= 0 && age < (row?.wikidata_url ? WIKIDATA_POSITIVE_TTL : WIKIDATA_NEGATIVE_TTL)) return row.wikidata_url;
    if (this.logoPending.has(entry.id)) return this.logoPending.get(entry.id);
    const pending = (async () => {
      const known = this.catalogue.get(VERIFIED_LEGAL_BRANDS[normalizeInstitution(entry.name)]);
      const names = [...new Set([known?.name, entry.name, ...(entry.aliases || [])].filter((v) => typeof v === 'string' && v.length >= 3))].slice(0, 2);
      let url = null;
      let success = false;
      for (const name of names) {
        if (url) break;
        for (const lang of ['fr', 'en']) {
          const params = new URLSearchParams({ action: 'wbsearchentities', search: name, language: lang, uselang: lang, type: 'item', limit: '8', format: 'json' });
          const search = await this.getJson(WIKIDATA + '?' + params, 100_000);
          success = true;
          const exact = (search.search || []).filter((item) =>
            /^Q\d+$/.test(item.id || '') &&
            normalizeInstitution(item.label) === normalizeInstitution(name) &&
            FINANCE.test(item.description || '')).slice(0, 3);
          if (!exact.length) continue;
          const req = new URLSearchParams({ action: 'wbgetentities', ids: exact.map((e) => e.id).join('|'), props: 'claims', format: 'json' });
          const data = await this.getJson(WIKIDATA + '?' + req, 150_000);
          for (const item of exact) {
            const entity = data.entities?.[item.id];
            const claim = (p) => entity?.claims?.[p]?.find((x) => x.rank !== 'deprecated' && x.mainsnak?.datavalue?.value)?.mainsnak?.datavalue?.value;
            const filename = claim('P154');
            const official = officialHost(claim('P856'));
            // Le nom exact et une description financière sont obligatoires.
            // Une URL du site discordante n'est jamais utilisée pour modifier la fiche.
            if (official && entry.host && official.replace(/^www\./, '') !== entry.host.replace(/^www\./, '') &&
                normalizeInstitution(item.label) !== normalizeInstitution(entry.name)) continue;
            if (typeof filename === 'string' && filename.length >= 3 && filename.length <= 150) {
              url = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/' + encodeURIComponent(filename) + '?width=256';
              break;
            }
          }
          if (url) break;
        }
      }
      if (success) this.db.prepare(
        'INSERT INTO institution_logo_sources(id,wikidata_url,wikidata_checked_at) VALUES(?,?,?) ' +
        'ON CONFLICT(id) DO UPDATE SET wikidata_url=excluded.wikidata_url,wikidata_checked_at=excluded.wikidata_checked_at'
      ).run(entry.id, url, Date.now());
      return url;
    })().finally(() => this.logoPending.delete(entry.id));
    this.logoPending.set(entry.id, pending);
    return pending;
  }

  async searchWikidata(q) {
    const qs = new URLSearchParams({ action: 'wbsearchentities', search: q, language: 'fr', uselang: 'fr', type: 'item', limit: '12', format: 'json' });
    const found = await this.getJson(WIKIDATA + '?' + qs);
    const filtered = (found.search || []).filter((e) => /^Q\d+$/.test(e.id || '') && FINANCE.test(e.description || '')).slice(0, 7);
    if (!filtered.length) return [];
    const params = new URLSearchParams({ action: 'wbgetentities', ids: filtered.map((x) => x.id).join('|'), props: 'claims|aliases', languages: 'fr|en', format: 'json' });
    const details = await this.getJson(WIKIDATA + '?' + params, 150_000);
    return filtered.map((item) => {
      const data = details.entities?.[item.id] || {};
      const claim = (p) => data.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
      const logo = claim('P154');
      const website = claim('P856');
      return {
        id: 'wd-' + item.id.toLowerCase(), name: item.label, source: 'Wikidata',
        kind: short(item.description, 60), host: officialHost(website),
        aliases: (data.aliases?.fr || []).slice(0, 7).map((a) => a.value),
        logo_url: typeof logo === 'string' && logo.length < 150
          ? 'https://commons.wikimedia.org/wiki/Special:Redirect/file/' + encodeURIComponent(logo) + '?width=256'
          : null,
      };
    });
  }

  async searchFrance(q) {
    const url = FRANCE + '?' + new URLSearchParams({ q, per_page: '10', page: '1' });
    const data = await this.getJson(url, 250_000);
    return (data.results || []).filter((e) => /^(64|65|66)/.test(e.activite_principale || '')).slice(0, 7).map((e) => ({
      id: 'fr-' + String(e.siren || '').replace(/\D/g, ''), name: e.nom_complet || e.nom_raison_sociale,
      source: 'Sirene', kind: 'Établissement financier (Sirene)', aliases: [], host: null, logo_url: null,
    }));
  }

  async search(q) {
    const query = short(q, 65);
    if (normalizeInstitution(query).length < 3) return this.list().filter((e) => normalizeInstitution(e.name).includes(normalizeInstitution(query))).slice(0, 15);
    const normalized = normalizeInstitution(query);
    const local = () => this.list().filter((e) =>
      normalizeInstitution(e.name).includes(normalized) || e.aliases.some((a) => normalizeInstitution(a).includes(normalized))).slice(0, 15);
    if (!this.enabled || this.closed) return local();
    if (this.searchCache.get(normalized) > Date.now()) return local();
    if (this.searchPending.has(normalized)) return this.searchPending.get(normalized);
    const p = (async () => {
      const results = await Promise.allSettled([this.searchWikidata(query), this.searchFrance(query)]);
      let success = false;
      for (const res of results) {
        if (res.status === 'fulfilled') {
          success = true;
          for (const e of res.value) this.accept(e);
        } else this.log.debug?.('Recherche annuaire : ' + res.reason?.message);
      }
      if (success) this.searchCache.set(normalized, Date.now() + QUERY_TTL);
      return local();
    })().finally(() => this.searchPending.delete(normalized));
    this.searchPending.set(normalized, p);
    return p;
  }

  startScheduler() {
    if (!this.enabled) return [];
    const run = () => this.syncOpenFinTech().catch((e) => this.log.warn?.('Annuaire OpenFinTech : ' + e.message));
    const first = setTimeout(run, 1_000);
    const daily = setInterval(run, DAY);
    first.unref?.(); daily.unref?.();
    return [first, daily];
  }

  close() { this.closed = true; }
}
