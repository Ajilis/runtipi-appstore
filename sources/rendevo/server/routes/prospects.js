import { bad, notFound } from '../lib/http.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { parseCsv, mapProspectColumns } from '../lib/csv.js';
import { normalizeSignal } from '../services/scoring.js';
import { normalizeJobKeyword, professionalTitlePrompt, normalizeProfessionalTitles } from '../services/job-titles.js';
import { normalizeDiscoveryCriteria, discoverPublicProfiles, discoverDegoogProfiles, discoverDegoogPage, DEGOOG_MAX_PAGES, DISCOVERY_IMPORT_MAX, normalizeDegoogUrl, normalizePublicProfileUrl } from '../services/discovery.js';

const LIST_FIELDS = `p.id, p.full_name, p.first_name, p.title, p.headline, p.company, p.location, p.linkedin_url, p.heat, p.fit_score,
  p.status, p.stage, p.tags, p.signals, p.campaign_id, p.needs_human, p.human_reason, p.last_reply_at, p.last_contact_at, p.created_at, p.updated_at, p.source, p.callback_at`;

export const STAGES = [
  { id: 'nouveau', label: 'Nouveau' },
  { id: 'en_discussion', label: 'En discussion' },
  { id: 'rdv_planifie', label: 'RDV planifié' },
  { id: 'proposition', label: 'Proposition' },
  { id: 'gagne', label: 'Gagné' },
  { id: 'perdu', label: 'Perdu' },
];

export function registerProspects(router, deps, { requireAuth, requireAdmin }, { fetcher = fetch } = {}) {
  const { db, agent, vault, ai } = deps;
  const recentTitleRequests = new Map();
  const recentSearches = new Map();
  // Single-use, short-lived proof that the *exact* pending DeGoog URL and
  // credentials have passed a real search. Never stores plaintext API keys.
  // Proofs are instance-local and deliberately invalidated on server restart.
  const testedConfigs = new Map();
  const TEST_VALIDITY_MS = 3 * 60 * 1000;

  // Legacy Brave workspaces keep their existing encrypted key until replaced.
  // New DeGoog workspaces store a validated URL and optionally an encrypted
  // Bearer token. Credentials never appear in config endpoints or logs.
  const providerOf = (settings = {}) => settings.provider
    || (settings.brave_api_key_enc ? 'brave' : 'degoog');
  const exposed = (settings = {}) => {
    const provider = providerOf(settings);
    return {
      provider,
      base_url: provider === 'degoog' ? settings.base_url || '' : '',
      has_api_key: !!(provider === 'brave' ? settings.brave_api_key_enc : settings.api_key_enc),
      configured: provider === 'brave' ? !!settings.brave_api_key_enc : !!settings.base_url,
    };
  };

  router.get('/api/discovery/config', requireAuth, async (ctx) =>
    exposed(ctx.state.ws.settings?.discovery));

  // Resolve a saved token only when testing the same DeGoog origin.
  // This avoids leaking an existing secret to a newly entered host.
  function degoogCandidate(body, previous) {
    const baseUrl = normalizeDegoogUrl(body.base_url ?? (providerOf(previous) === 'degoog' ? previous.base_url : ''));
    const sameOrigin = providerOf(previous) === 'degoog' && previous.base_url === baseUrl;
    const typedKey = String(body.api_key ?? '').trim();
    if (typedKey && !/^\S{8,512}$/.test(typedKey)) throw bad('Clé API invalide (8 à 512 caractères)');
    const key = body.clear_key === true ? '' : typedKey
      || (sameOrigin ? vault.decrypt(previous.api_key_enc || '') : '');
    return { baseUrl, key, sameOrigin, typedKey };
  }

  // Tests before saving, without changing the workspace settings.
  router.post('/api/discovery/test', requireAuth, requireAdmin, async (ctx) => {
    ctx.header('Cache-Control', 'no-store');
    const body = await ctx.json(4096);
    const previous = ctx.state.ws.settings?.discovery || {};
    let candidate;
    try { candidate = degoogCandidate(body, previous); }
    catch (err) { throw bad(err.message); }
    // Uses the same real DeGoog GET /api/search code and response validation
    // as prospect searches. Zero matching profiles is still a valid API response.
    let items;
    try {
      items = await discoverDegoogProfiles({
        baseUrl: candidate.baseUrl,
        apiKey: candidate.key,
        criteria: { searchQuery: 'site:linkedin.com/in/ "directeur"', limit: 3 },
        fetcher,
      });
    } catch (err) { throw bad(err.message); }
    if (testedConfigs.size > 1000) testedConfigs.clear();
    const proof = randomToken(24);
    testedConfigs.set(proof, {
      workspace: ctx.state.ws.id,
      user: ctx.state.user.id,
      baseUrl: candidate.baseUrl,
      keyHash: sha256(candidate.key),
      expires: Date.now() + TEST_VALIDITY_MS,
    });
    return { ok: true, test_token: proof, sample_profiles: items.length };
  });

  router.post('/api/discovery/config', requireAuth, requireAdmin, async (ctx) => {
    const body = await ctx.json(4096);
    const previous = ctx.state.ws.settings?.discovery || {};
    // Accept old clients posting only api_key (Brave), without changing them.
    const provider = body.provider || (body.base_url !== undefined ? 'degoog' : body.api_key && !previous.base_url ? 'brave' : providerOf(previous));
    if (!['brave', 'degoog'].includes(provider)) throw bad('Moteur de recherche inconnu');
    const oldProvider = providerOf(previous);
    const keyName = provider === 'brave' ? 'brave_api_key_enc' : 'api_key_enc';
    let encrypted = oldProvider === provider ? previous[keyName] || '' : '';
    if (body.clear_key === true) encrypted = '';
    else if (body.api_key !== undefined && String(body.api_key).trim()) {
      const key = String(body.api_key).trim();
      if (!/^\S{8,512}$/.test(key)) throw bad('Clé API invalide (8 à 512 caractères)');
      encrypted = vault.encrypt(key);
    }
    let settings;
    if (provider === 'brave') {
      settings = { provider, brave_api_key_enc: encrypted };
    } else {
      let candidate;
      try { candidate = degoogCandidate(body, previous); }
      catch (err) { throw bad(err.message); }
      const proof = testedConfigs.get(String(body.test_token || ''));
      if (!proof || proof.expires < Date.now()
        || proof.workspace !== ctx.state.ws.id || proof.user !== ctx.state.user.id
        || proof.baseUrl !== candidate.baseUrl || proof.keyHash !== sha256(candidate.key)) {
        throw bad('Teste d’abord la connexion avec cette URL et cette clé avant d’enregistrer.');
      }
      testedConfigs.delete(String(body.test_token));
      // Only preserve a prior encrypted token for exactly the same origin.
      encrypted = body.clear_key === true ? ''
        : candidate.typedKey ? vault.encrypt(candidate.typedKey)
        : candidate.sameOrigin ? previous.api_key_enc || '' : '';
      settings = { provider, base_url: candidate.baseUrl, api_key_enc: encrypted };
    }
    await db.query(
      "UPDATE workspaces SET settings = jsonb_set(settings, '{discovery}', $2::jsonb, true) WHERE id = $1",
      [ctx.state.ws.id, JSON.stringify(settings)],
    );
    // POST returns the masked settings in the same format as GET.
    return provider === 'brave'
      ? { provider, has_api_key: !!encrypted }
      : exposed(settings);
  });

  // Classify a keyword with the *active workspace AI model*.
  // This route is read-only: it does not save a search, modify a campaign, or
  // create prospects. Suggestions become search criteria only upon selection.
  router.post('/api/discovery/job-titles', requireAuth, async (ctx) => {
    ctx.header('Cache-Control', 'no-store');
    const body = await ctx.json(2048);
    let keyword;
    try { keyword = normalizeJobKeyword(body.keyword); }
    catch (error) { throw bad(error.message); }
    if (!ai?.enabled(ctx.state.ws)) {
      throw bad('Aucun connecteur IA actif : configurez un modèle dans Réglages → Intelligence artificielle');
    }
    const identity = ctx.state.ws.id + ':' + ctx.state.user.id;
    const last = recentTitleRequests.get(identity) || 0;
    if (Date.now() - last < 12000) throw bad('Une génération IA toutes les 12 secondes au maximum');
    if (recentTitleRequests.size > 2000) recentTitleRequests.clear();
    recentTitleRequests.set(identity, Date.now());
    try {
      const result = await ai.completeJson(ctx.state.ws, {
        system: 'Tu classes les intitulés professionnels en lien avec un mot-clé. Respecte toutes les instructions de l’utilisateur et produis exclusivement un objet JSON avec rows. Tu ne fournis ni conseil LinkedIn officiel ni texte hors JSON.',
        user: professionalTitlePrompt(keyword),
        maxTokens: 3800, temperature: 0.25,
      });
      return { keyword, rows: normalizeProfessionalTitles(result) };
    } catch (error) {
      // Prevent raw provider response, token or remote header from being exposed.
      if (/^(Réponse IA incompatible|Le modèle IA n’a proposé)/.test(error.message)) throw bad(error.message);
      throw bad('La génération des intitulés a échoué avec le modèle IA actif. Vérifiez sa compatibilité JSON dans Réglages → Intelligence artificielle.');
    }
  });

  router.post('/api/discovery/search', requireAuth, async (ctx) => {
    const settings = ctx.state.ws.settings?.discovery || {};
    const provider = providerOf(settings);
    const key = vault.decrypt(provider === 'brave' ? settings.brave_api_key_enc || '' : settings.api_key_enc || '');
    if (provider === 'brave' && !key) throw bad('Configurez une clé API Brave Search dans Réglages → Recherche');
    if (provider === 'degoog' && !settings.base_url) throw bad('Configurez l’URL DeGoog dans Réglages → Recherche');
    const input = await ctx.json(4096);
    let criteria;
    try { criteria = normalizeDiscoveryCriteria(input, ctx.state.ws.settings?.icp || {}); }
    catch (err) { throw bad(err.message); }
    const page = input.page === undefined ? 1 : Number(input.page);
    const dorkIndex = input.dork_index === undefined ? 0 : Number(input.dork_index);
    if (!Number.isInteger(page) || page < 1 || page > DEGOOG_MAX_PAGES
      || !Number.isInteger(dorkIndex) || dorkIndex < 0 || dorkIndex > 2) {
      throw bad('Page de recherche invalide');
    }
    if (provider === 'brave' && page !== 1) throw bad('Pagination disponible uniquement pour DeGoog');
    const id = ctx.state.user.id;
    const keyRate = String(ctx.state.ws.id) + ':' + id;
    const last = recentSearches.get(keyRate) || 0;
    // Full new searches remain limited to one every 10 seconds. Page turns
    // are paced at 1 second, with hard page limits to bound provider traffic.
    const delay = page === 1 ? 10000 : 1000;
    if (Date.now() - last < delay) throw bad(
      page === 1 ? 'Une nouvelle recherche toutes les 10 secondes au maximum'
        : 'Patientez une seconde avant de charger la page suivante',
    );
    if (recentSearches.size > 2000) recentSearches.clear();
    recentSearches.set(keyRate, Date.now());
    try {
      const attempts = [];
      if (provider === 'brave') {
        const items = await discoverPublicProfiles({ apiKey: key, criteria, fetcher });
        return { items, found: items.length, query: criteria.searchQuery, provider, attempts,
          page: 1, has_more: false, total_pages: null, dork_index: 0 };
      }
      const response = await discoverDegoogPage({
        baseUrl: settings.base_url, apiKey: key, criteria, fetcher, page,
        dorkIndex,
        onAttempt: (entry) => attempts.push(entry),
      });
      return {
        ...response, found: response.items.length, provider, attempts,
      };
    } catch (err) { throw bad(err.message); }
  });

  // A second, explicit click imports only reviewed and selected suggestions.
  router.post('/api/discovery/import', requireAuth, async (ctx) => {
    const body = await ctx.json(256 * 1024);
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > DISCOVERY_IMPORT_MAX) {
      throw bad('Sélectionnez entre 1 et ' + DISCOVERY_IMPORT_MAX + ' profils vérifiés');
    }
    const campaignId = body.campaign_id || null;
    if (campaignId) {
      const { rows } = await db.query(
        "SELECT c.id FROM campaigns c JOIN accounts a ON a.id = c.account_id AND a.workspace_id = c.workspace_id WHERE c.id = $1 AND c.workspace_id = $2 AND c.status <> 'archived' AND c.deleted_at IS NULL AND a.provider IN ('manual','linkedin_cookie','linkedin_companion')",
        [campaignId, ctx.state.ws.id],
      );
      if (!rows.length) throw bad('Campagne indisponible dans cet espace');
    }
    const items = body.items.map((item) => ({
      linkedin_url: normalizePublicProfileUrl(item?.linkedin_url),
      full_name: String(item?.full_name || '').trim().slice(0, 160),
    }));
    if (items.some((item) => !item.linkedin_url)) throw bad('URL de profil LinkedIn invalide');
    return agent.importProspects(ctx.state.ws, items, { campaignId, source: 'public_web_search' });
  });

  function filters(ctx) {
    const q = ctx.query;
    const where = ['p.workspace_id = $1'];
    const params = [ctx.state.ws.id];
    const ph = (v) => { params.push(v); return `$${params.length}`; };
    if (q.q) { const x = ph(`%${q.q}%`); where.push(`(p.full_name ILIKE ${x} OR p.company ILIKE ${x} OR p.title ILIKE ${x} OR p.headline ILIKE ${x})`); }
    if (q.heat) where.push(`p.heat = ${ph(q.heat)}`);
    if (q.status) where.push(`p.status = ANY(${ph(q.status.split(','))})`);
    if (q.stage) where.push(`p.stage = ${ph(q.stage)}`);
    if (q.campaign === 'none') where.push('p.campaign_id IS NULL');
    else if (q.campaign) where.push(`p.campaign_id = ${ph(q.campaign)}`);
    if (q.tag) where.push(`${ph(q.tag)} = ANY(p.tags)`);
    if (q.needs_human === '1') where.push('p.needs_human');
    return { where: where.join(' AND '), params };
  }

  router.get('/api/prospects', requireAuth, async (ctx) => {
    const { where, params } = filters(ctx);
    const limit = Math.min(500, parseInt(ctx.query.limit, 10) || 100);
    const offset = Math.max(0, parseInt(ctx.query.offset, 10) || 0);
    const order = {
      score: 'p.fit_score DESC NULLS LAST, p.created_at DESC',
      recent: 'p.created_at DESC',
      activity: 'greatest(p.last_reply_at, p.last_contact_at, p.updated_at) DESC NULLS LAST',
      name: 'p.full_name',
    }[ctx.query.sort] || "CASE p.heat WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END, p.fit_score DESC NULLS LAST, p.created_at DESC";
    const [{ rows }, count] = await Promise.all([
      db.query(`SELECT ${LIST_FIELDS}, c.name AS campaign_name FROM prospects p LEFT JOIN campaigns c ON c.id = p.campaign_id WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, params),
      db.query(`SELECT count(*)::int AS n FROM prospects p WHERE ${where}`, params),
    ]);
    return { items: rows, total: count.rows[0].n, stages: STAGES };
  });

  router.get('/api/prospects/export.csv', requireAuth, async (ctx) => {
    const { where, params } = filters(ctx);
    const { rows } = await db.query(
      `SELECT p.full_name, p.title, p.company, p.location, p.linkedin_url, p.email, p.phone, p.heat, p.fit_score, p.status, p.stage, array_to_string(p.tags, ';') AS tags, c.name AS campaign, p.fit_reasoning, p.created_at
         FROM prospects p LEFT JOIN campaigns c ON c.id = p.campaign_id WHERE ${where} ORDER BY p.created_at DESC`,
      params,
    );
    const cols = ['full_name', 'title', 'company', 'location', 'linkedin_url', 'email', 'phone', 'heat', 'fit_score', 'status', 'stage', 'tags', 'campaign', 'fit_reasoning', 'created_at'];
    const esc = (v) => { const s = v instanceof Date ? v.toISOString() : String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    ctx.header('Content-Disposition', 'attachment; filename="prospects-rendevo.csv"');
    ctx.send(200, csv, 'text/csv; charset=utf-8');
  });

  router.post('/api/prospects', requireAuth, async (ctx) => {
    const body = await ctx.json();
    const res = await agent.importProspects(ctx.state.ws, [{ ...body, source: 'manual' }], { campaignId: body.campaign_id || null, source: 'manual' });
    if (!res.created) throw bad(res.duplicates ? 'Ce prospect existe déjà' : 'Nom et URL LinkedIn (ou e-mail) requis');
    return { id: res.ids[0] };
  });

  router.post('/api/prospects/import', requireAuth, async (ctx) => {
    const body = await ctx.json(10 * 1024 * 1024);
    let items = [];
    if (body.csv) {
      const { headers, records } = parseCsv(body.csv);
      const map = { ...mapProspectColumns(headers), ...(body.mapping || {}) };
      if (!map.linkedin_url && !map.email) throw bad('Colonne LinkedIn introuvable. Nommez-la « linkedin_url » ou « LinkedIn ».', { headers });
      items = records.map((r) => Object.fromEntries(Object.entries(map).map(([field, col]) => [field, r[col]])));
    }
    if (body.urls) {
      items.push(...String(body.urls).split(/[\s,;]+/).filter(Boolean).map((u) => ({ linkedin_url: u })));
    }
    if (Array.isArray(body.items)) items.push(...body.items);
    if (!items.length) throw bad('Aucun prospect à importer');
    const signal = body.signal ? normalizeSignal(body.signal) : null;
    if (signal) items = items.map((i) => ({ ...i, signals: [...(i.signals || []), signal] }));
    return agent.importProspects(ctx.state.ws, items, { campaignId: body.campaign_id || null, source: body.source || 'import' });
  });

  async function owned(ctx) {
    const { rows } = await db.query('SELECT * FROM prospects WHERE id = $1 AND workspace_id = $2', [ctx.params.id, ctx.state.ws.id]);
    if (!rows[0]) throw notFound('Prospect introuvable');
    return rows[0];
  }

  router.get('/api/prospects/:id', requireAuth, async (ctx) => {
    const p = await owned(ctx);
    const [messages, meetings, events, campaign] = await Promise.all([
      db.query(`SELECT * FROM messages WHERE prospect_id = $1 AND status <> 'cancelled' ORDER BY coalesce(sent_at, scheduled_at, created_at)`, [p.id]),
      db.query('SELECT * FROM meetings WHERE prospect_id = $1 ORDER BY starts_at DESC', [p.id]),
      db.query('SELECT type, data, created_at FROM events WHERE prospect_id = $1 ORDER BY created_at DESC LIMIT 50', [p.id]),
      p.campaign_id ? db.query('SELECT id, name, status, account_id, settings FROM campaigns WHERE id = $1', [p.campaign_id]) : { rows: [] },
    ]);
    let account = null;
    if (campaign.rows[0]?.account_id) {
      const a = await db.query('SELECT id, name, provider, status FROM accounts WHERE id = $1', [campaign.rows[0].account_id]);
      account = a.rows[0] || null;
    }
    const sim = p.setter_state?.sim;
    const state = { ...p.setter_state };
    delete state.sim;
    return { ...p, setter_state: state, simulated: !!sim, messages: messages.rows, meetings: meetings.rows, events: events.rows, campaign: campaign.rows[0] || null, account, stages: STAGES };
  });

  router.patch('/api/prospects/:id', requireAuth, async (ctx) => {
    const p = await owned(ctx);
    const body = await ctx.json();
    const f = {};
    for (const k of ['full_name', 'title', 'headline', 'company', 'industry', 'location', 'email', 'phone', 'notes', 'language']) if (body[k] !== undefined) f[k] = String(body[k] ?? '').slice(0, 4000);
    if (body.stage && STAGES.some((s) => s.id === body.stage)) f.stage = body.stage;
    if (Array.isArray(body.tags)) f.tags = body.tags.map(String).slice(0, 20);
    if (body.campaign_id !== undefined) {
      f.campaign_id = body.campaign_id || null;
      if (f.campaign_id && ['qualified', 'low_fit', 'new'].includes(p.status)) { f.next_action_at = new Date(); f.status = 'qualified'; }
    }
    if (body.status === 'excluded') { f.status = 'excluded'; f.next_action_at = null; }
    if (body.status === 'qualified' && ['excluded', 'low_fit', 'new', 'not_accepted'].includes(p.status)) { f.status = 'qualified'; f.next_action_at = p.campaign_id || f.campaign_id ? new Date() : null; }
    if (body.status === 'won') { f.status = 'won'; f.stage = 'gagne'; }
    if (body.status === 'lost') { f.status = 'lost'; f.stage = 'perdu'; f.next_action_at = null; }
    if (body.callback_at !== undefined) { f.callback_at = body.callback_at ? new Date(body.callback_at) : null; if (f.callback_at) { f.status = 'callback'; f.next_action_at = f.callback_at; } }
    if (body.needs_human === false) { f.needs_human = false; f.human_reason = null; }
    if (Object.keys(f).length) await agent.updateProspect(p.id, f);
    if (body.setter_paused !== undefined) await agent.mergeSetterState(p.id, { paused: !!body.setter_paused });
    if (body.status === 'excluded' || body.status === 'lost') {
      await db.query(`UPDATE messages SET status = 'cancelled' WHERE prospect_id = $1 AND status IN ('queued', 'pending_approval')`, [p.id]);
    }
    return { ok: true };
  });

  router.delete('/api/prospects/:id', requireAuth, async (ctx) => {
    const p = await owned(ctx);
    await db.query('DELETE FROM prospects WHERE id = $1', [p.id]);
    return { ok: true };
  });

  router.post('/api/prospects/:id/requalify', requireAuth, async (ctx) => {
    const p = await owned(ctx);
    return agent.requalify(ctx.state.ws, p.id);
  });

  router.post('/api/prospects/:id/signals', requireAuth, async (ctx) => {
    const p = await owned(ctx);
    const body = await ctx.json();
    const sig = normalizeSignal(body);
    await db.query(`UPDATE prospects SET signals = $2::jsonb || signals, updated_at = now() WHERE id = $1`, [p.id, JSON.stringify([sig])]);
    return agent.requalify(ctx.state.ws, p.id);
  });

  router.post('/api/prospects/bulk', requireAuth, async (ctx) => {
    const body = await ctx.json();
    const ids = (body.ids || []).slice(0, 1000);
    if (!ids.length) throw bad('Aucun prospect sélectionné');
    const ws = ctx.state.ws.id;
    switch (body.action) {
      case 'assign_campaign': {
        const camp = body.value || null;
        await db.query(
          `UPDATE prospects SET campaign_id = $3,
              status = CASE WHEN status IN ('low_fit', 'new') AND $3::uuid IS NOT NULL THEN 'qualified' ELSE status END,
              next_action_at = CASE WHEN $3::uuid IS NOT NULL AND status IN ('qualified', 'low_fit', 'new') THEN now() ELSE next_action_at END,
              updated_at = now()
            WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
          [ws, ids, camp],
        );
        break;
      }
      case 'exclude':
        await db.query(`UPDATE prospects SET status = 'excluded', next_action_at = NULL, updated_at = now() WHERE workspace_id = $1 AND id = ANY($2::uuid[])`, [ws, ids]);
        await db.query(`UPDATE messages SET status = 'cancelled' WHERE prospect_id = ANY($1::uuid[]) AND status IN ('queued', 'pending_approval')`, [ids]);
        break;
      case 'stage':
        if (!STAGES.some((s) => s.id === body.value)) throw bad('Étape inconnue');
        await db.query('UPDATE prospects SET stage = $3, updated_at = now() WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [ws, ids, body.value]);
        break;
      case 'tag':
        await db.query('UPDATE prospects SET tags = array(SELECT DISTINCT unnest(tags || $3::text[])), updated_at = now() WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [ws, ids, [String(body.value || '').slice(0, 40)]]);
        break;
      case 'requalify':
        for (const id of ids) await agent.requalify(ctx.state.ws, id);
        break;
      case 'delete':
        await db.query('DELETE FROM prospects WHERE workspace_id = $1 AND id = ANY($2::uuid[])', [ws, ids]);
        break;
      default:
        throw bad('Action inconnue');
    }
    return { ok: true, count: ids.length };
  });
}
