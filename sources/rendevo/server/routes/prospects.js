import { bad, notFound } from '../lib/http.js';
import { parseCsv, mapProspectColumns } from '../lib/csv.js';
import { normalizeSignal } from '../services/scoring.js';
import { normalizeDiscoveryCriteria, discoverPublicProfiles, normalizePublicProfileUrl } from '../services/discovery.js';

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
  const { db, agent, vault } = deps;
  const recentSearches = new Map();

  // Only encrypted API keys are persisted; neither this endpoint nor /api/settings
  // should expose a search provider credential.
  router.get('/api/discovery/config', requireAuth, async (ctx) => ({
    provider: 'brave',
    has_api_key: !!ctx.state.ws.settings?.discovery?.brave_api_key_enc,
  }));

  router.post('/api/discovery/config', requireAuth, requireAdmin, async (ctx) => {
    const body = await ctx.json(4096);
    const previous = ctx.state.ws.settings?.discovery || {};
    let encrypted = previous.brave_api_key_enc || '';
    if (body.clear_key === true) encrypted = '';
    else if (body.api_key) {
      const key = String(body.api_key).trim();
      if (!/^\S{8,512}$/.test(key)) throw bad('Clé API Brave invalide');
      encrypted = vault.encrypt(key);
    }
    await db.query(
      "UPDATE workspaces SET settings = jsonb_set(settings, '{discovery}', $2::jsonb, true) WHERE id = $1",
      [ctx.state.ws.id, JSON.stringify({ brave_api_key_enc: encrypted })],
    );
    return { provider: 'brave', has_api_key: !!encrypted };
  });

  router.post('/api/discovery/search', requireAuth, async (ctx) => {
    const settings = ctx.state.ws.settings?.discovery || {};
    const key = vault.decrypt(settings.brave_api_key_enc || '');
    if (!key) throw bad('Configurez une clé API Brave Search pour activer la recherche web');
    const input = await ctx.json(4096);
    let criteria;
    try { criteria = normalizeDiscoveryCriteria(input, ctx.state.ws.settings?.icp || {}); }
    catch (err) { throw bad(err.message); }
    const id = ctx.state.user.id;
    const last = recentSearches.get(id) || 0;
    if (Date.now() - last < 10000) throw bad('Une recherche toutes les 10 secondes au maximum');
    if (recentSearches.size > 2000) recentSearches.clear();
    recentSearches.set(id, Date.now());
    try {
      const items = await discoverPublicProfiles({ apiKey: key, criteria, fetcher });
      return { items, found: items.length, query: criteria.searchQuery, provider: 'brave' };
    } catch (err) { throw bad(err.message); }
  });


  // A second, explicit click imports only reviewed and selected suggestions.
  router.post('/api/discovery/import', requireAuth, async (ctx) => {
    const body = await ctx.json(128 * 1024);
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 20) {
      throw bad('Sélectionnez entre 1 et 20 profils vérifiés');
    }
    const campaignId = body.campaign_id || null;
    if (campaignId) {
      const { rows } = await db.query(
        "SELECT c.id FROM campaigns c JOIN accounts a ON a.id = c.account_id AND a.workspace_id = c.workspace_id WHERE c.id = $1 AND c.workspace_id = $2 AND c.status <> 'archived' AND a.provider IN ('manual','linkedin_cookie','linkedin_companion')",
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
