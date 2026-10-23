import { bad, notFound } from '../lib/http.js';
import { readWebsite } from '../services/website.js';
import { providerList, getProvider } from '../services/providers/index.js';
import { DEFAULT_SEQUENCE, DEFAULT_CAMPAIGN_SETTINGS } from '../services/agent.js';
import { fakeProspects } from '../services/providers/simulation.js';
import { normalizeLinkedinCookies } from '../services/providers/linkedin-cookie.js';
import { linkedinVerificationChange } from '../services/providers/linkedin-status.js';
import { linkedinCheckPatch, linkedinRetrySeconds, LINKEDIN_CHECK_COOLDOWN_SECONDS } from '../services/providers/linkedin-diagnostics.js';
import { assistedCampaignSettings } from '../services/providers/linkedin-assisted.js';

const SECTIONS = ['offer', 'icp', 'voice', 'availability', 'schedule', 'goal', 'ai', 'public_url', 'onboarding_done'];

function maskSettings(s) {
  const out = { ...s };
  if (out.ai) {
    out.ai = { ...out.ai, has_api_key: !!out.ai.api_key_enc };
    delete out.ai.api_key_enc;
  }
  if (out.discovery) {
    const current = out.discovery;
    const provider = current.provider || (current.brave_api_key_enc ? 'brave' : 'degoog');
    out.discovery = {
      provider,
      base_url: provider === 'degoog' ? current.base_url || '' : '',
      has_api_key: !!(provider === 'brave' ? current.brave_api_key_enc : current.api_key_enc),
      configured: provider === 'brave' ? !!current.brave_api_key_enc : !!current.base_url,
    };
  }
  return out;
}

function maskAccount(a) {
  const cfg = { ...a.config };
  const hasKey = !!cfg.api_key_enc;
  const hasSession = !!(cfg.li_at_enc && cfg.jsessionid_enc);
  const hasExtraCookie = !!cfg.extra_cookie_value_enc;
  for (const name of ['api_key_enc', 'api_key', 'li_at_enc', 'jsessionid_enc', 'li_at', 'jsessionid', 'extra_cookie_value_enc', 'extra_cookie_value', 'clear_extra_cookie']) delete cfg[name];
  return { ...a, config: { ...cfg, has_api_key: hasKey, has_session: hasSession, has_extra_cookie: hasExtraCookie } };
}

function cleanList(v) {
  return (Array.isArray(v) ? v : String(v || '').split(/[,\n]/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
}

// The same validation applies to quick-rename, campaign creation and full editing.
export function validateCampaignName(value) {
  if (typeof value !== 'string') throw bad('Le nom de la campagne doit être un texte');
  const name = value.trim();
  if (!name || name.length > 120 || /[\x00-\x1f\x7f]/.test(name)) {
    throw bad('Le nom de la campagne doit contenir entre 1 et 120 caractères valides');
  }
  return name;
}

export function registerCore(router, deps, { requireAuth, requireAdmin }) {
  const { db, ai, agent, vault, calendar } = deps;

  // ------------------------------------------------------------ settings
  router.get('/api/settings', requireAuth, async (ctx) => {
    const ws = ctx.state.ws;
    return {
      settings: maskSettings(ws.settings),
      ai_defaults: { provider: deps.config.ai?.provider, model: deps.config.ai?.model, base_url: deps.config.ai?.base_url, configured: ai.enabled({ settings: {} }) },
      ai_enabled: ai.enabled(ws),
      config_file: deps.config.configFile,
      public_url: agent.publicUrl(ws),
      public_url_from_env: !!deps.config.publicUrl,
      calendar_feed: agent.publicUrl(ws) ? `${agent.publicUrl(ws)}/api/public/calendar/${ws.calendar_token}.ics` : `/api/public/calendar/${ws.calendar_token}.ics`,
      booking_link: agent.publicUrl(ws) ? `${agent.publicUrl(ws)}/r/${ws.booking_token}` : `/r/${ws.booking_token}`,
      limits: deps.config.limits,
    };
  });

  router.patch('/api/settings', requireAuth, requireAdmin, async (ctx) => {
    const body = await ctx.json();
    const ws = ctx.state.ws;
    const settings = { ...ws.settings };
    for (const key of Object.keys(body)) {
      if (!SECTIONS.includes(key)) continue;
      let value = body[key];
      if (key === 'ai') {
        const prev = settings.ai || {};
        value = {
          provider: ['none', 'openai', 'anthropic'].includes(value.provider) ? value.provider : prev.provider || 'none',
          base_url: String(value.base_url ?? prev.base_url ?? '').trim(),
          model: String(value.model ?? prev.model ?? '').trim(),
          temperature: Math.min(1.2, Math.max(0, Number(value.temperature ?? prev.temperature ?? 0.7))),
          api_key_enc: value.api_key === '' && value.clear_key ? '' : value.api_key ? vault.encrypt(value.api_key) : prev.api_key_enc || '',
        };
      }
      if (key === 'icp') {
        value = Object.fromEntries(['titles', 'industries', 'locations', 'company_sizes', 'keywords', 'exclusions', 'excluded_companies'].map((k) => [k, cleanList(value[k])]));
      }
      if (key === 'voice' && value.examples) value.examples = (value.examples || []).map(String).filter(Boolean).slice(0, 6);
      if (key === 'public_url') value = String(value || '').trim().replace(/\/+$/, '');
      if (typeof value === 'object' && value !== null && !Array.isArray(value) && key !== 'ai' && key !== 'icp') value = { ...(settings[key] || {}), ...value };
      settings[key] = value;
    }
    await db.query('UPDATE workspaces SET settings = $2 WHERE id = $1', [ws.id, JSON.stringify(settings)]);
    return { settings: maskSettings(settings) };
  });

  router.post('/api/settings/ai/test', requireAuth, async (ctx) => {
    const ws = await agent.workspace(ctx.state.ws.id);
    if (!ai.enabled(ws)) throw bad('Renseignez un fournisseur et un modèle (et une clé pour Anthropic).');
    try { return await ai.test(ws); } catch (e) { throw bad(`Échec du test : ${e.message}`); }
  });

  router.post('/api/offer/analyze', requireAuth, async (ctx) => {
    const body = await ctx.json();
    let page = { title: '', description: '', text: '', url: body.url };
    if (body.url) {
      try { page = await readWebsite(body.url); } catch (e) {
        if (!body.text) throw bad(`Impossible de lire ${body.url} : ${e.message}. Collez la description de votre offre à la place.`);
      }
      if (page.linkedin && !body.text) throw bad('LinkedIn ne peut pas être lu directement. Collez votre titre et votre section « Infos » dans le champ description.');
    }
    const analysis = await ai.analyzeOffer(ctx.state.ws, { url: page.url, pageText: page.text, title: page.title, description: page.description, extra: body.text });
    return { analysis, page: { title: page.title, description: page.description, url: page.url } };
  });

  router.post('/api/agent', requireAuth, async (ctx) => {
    const body = await ctx.json();
    const enabled = !!body.enabled;
    await db.query('UPDATE workspaces SET agent_enabled = $2 WHERE id = $1', [ctx.state.ws.id, enabled]);
    await deps.activity.log(ctx.state.ws.id, enabled ? 'agent.started' : 'agent.paused', { data: { by: ctx.state.user.email } });
    return { agent_enabled: enabled };
  });

  // ------------------------------------------------------------ accounts
  router.get('/api/providers', requireAuth, async () => providerList());

  router.get('/api/accounts', requireAuth, async (ctx) => {
    const { rows } = await db.query(
      `SELECT a.*, coalesce(u.invites, 0) AS invites_today, coalesce(u.messages, 0) AS messages_today,
              (SELECT coalesce(sum(invites), 0)::int FROM usage WHERE account_id = a.id AND day > current_date - 7) AS invites_week
         FROM accounts a LEFT JOIN usage u ON u.account_id = a.id AND u.day = current_date
        WHERE a.workspace_id = $1 ORDER BY a.created_at`,
      [ctx.state.ws.id],
    );
    return rows.map((a) => ({ ...maskAccount(a), limits: { ...(deps.config.limits?.[a.account_type] || {}), ...(a.config?.limits || {}) } }));
  });

  function accountConfig(provider, input = {}, prev = {}) {
    const cfg = { ...prev };
    if (provider === 'unipile') {
      if (input.dsn !== undefined) cfg.dsn = String(input.dsn).trim();
      if (input.account_id !== undefined) cfg.account_id = String(input.account_id).trim();
      if (input.api_key) cfg.api_key_enc = vault.encrypt(String(input.api_key).trim());
    }
    if (provider === 'linkedin_cookie' && (input.li_at || input.jsessionid)) {
      let credentials;
      try { credentials = normalizeLinkedinCookies(input.li_at, input.jsessionid); }
      catch (e) { throw bad(e.message); }
      cfg.li_at_enc = vault.encrypt(credentials.liAt);
      cfg.jsessionid_enc = vault.encrypt(credentials.jsession);
      delete cfg.profile; // A different session may refer to another member.
      delete cfg.verification; // The previous test results belong to the old credentials.
    }
    if (provider === 'linkedin_cookie') {
      // Supplementary cookie metadata is optional and never sent during verification.
      const name = String(input.extra_cookie_name ?? cfg.extra_cookie_name ?? 'TEST').trim();
      if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name)
        || ['li_at', 'jsessionid'].includes(name.toLowerCase())) {
        throw bad('Nom du cookie supplémentaire invalide ou réservé');
      }
      cfg.extra_cookie_name = name;
      if (input.clear_extra_cookie) {
        delete cfg.extra_cookie_value_enc;
      } else if (input.extra_cookie_value) {
        const value = String(input.extra_cookie_value).trim();
        if (value.length > 4096 || /[;\r\n\x00-\x1F\x7F]/.test(value)) {
          throw bad('Valeur du cookie supplémentaire invalide');
        }
        cfg.extra_cookie_value_enc = vault.encrypt(value);
      }
    }
    if (input.ignore_window !== undefined) cfg.ignore_window = !!input.ignore_window;
    if (input.limits) cfg.limits = Object.fromEntries(Object.entries(input.limits).filter(([, v]) => v !== '' && v !== null).map(([k, v]) => [k, Math.max(0, parseInt(v, 10) || 0)]));
    for (const name of ['api_key', 'li_at', 'jsessionid', 'extra_cookie_value', 'clear_extra_cookie']) delete cfg[name];
    return cfg;
  }

  router.post('/api/accounts', requireAuth, requireAdmin, async (ctx) => {
    const body = await ctx.json();
    getProvider(body.provider);
    const type = ['free', 'premium', 'sales_navigator'].includes(body.account_type) ? body.account_type : 'free';
    const cfg = accountConfig(body.provider, { ignore_window: body.provider === 'simulation', ...body.config });
    if (body.provider === 'unipile' && (!cfg.dsn || !cfg.account_id || !cfg.api_key_enc)) throw bad('DSN, identifiant de compte et clé API Unipile requis');
    if (body.provider === 'linkedin_cookie' && (!cfg.li_at_enc || !cfg.jsessionid_enc)) throw bad('Cookies li_at et JSESSIONID requis');
    const needsVerification = body.provider === 'linkedin_cookie';
    const { rows } = await db.query(
      'INSERT INTO accounts (workspace_id, name, provider, account_type, config, status, status_detail) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [ctx.state.ws.id, String(body.name || 'Mon compte LinkedIn').slice(0, 80), body.provider, type, JSON.stringify(cfg),
        needsVerification ? 'error' : 'active', needsVerification ? 'Session à vérifier : cliquez sur Tester.' : null],
    );
    return maskAccount(rows[0]);
  });

  router.patch('/api/accounts/:id', requireAuth, requireAdmin, async (ctx) => {
    const body = await ctx.json();
    const { rows } = await db.query('SELECT * FROM accounts WHERE id = $1 AND workspace_id = $2', [ctx.params.id, ctx.state.ws.id]);
    const a = rows[0];
    if (!a) throw notFound();
    const cfg = accountConfig(a.provider, body.config || {}, a.config);
    const sessionUpdated = a.provider === 'linkedin_cookie' && (body.config?.li_at || body.config?.jsessionid);
    const status = sessionUpdated ? 'error' : ['active', 'paused'].includes(body.status) ? body.status : a.status;
    const type = ['free', 'premium', 'sales_navigator'].includes(body.account_type) ? body.account_type : a.account_type;
    const r = await db.query(
      'UPDATE accounts SET name = $2, account_type = $3, config = $4, status = $5, status_detail = CASE WHEN $6 THEN \'Session à vérifier : cliquez sur Tester.\' WHEN $5 = \'active\' THEN NULL ELSE status_detail END WHERE id = $1 RETURNING *',
      [a.id, String(body.name || a.name).slice(0, 80), type, JSON.stringify(cfg), status, !!sessionUpdated],
    );
    return maskAccount(r.rows[0]);
  });

  router.delete('/api/accounts/:id', requireAuth, requireAdmin, async (ctx) => {
    await db.query('DELETE FROM accounts WHERE id = $1 AND workspace_id = $2', [ctx.params.id, ctx.state.ws.id]);
    return { ok: true };
  });

  router.post('/api/accounts/:id/test', requireAuth, async (ctx) => {
    const { rows } = await db.query('SELECT * FROM accounts WHERE id = $1 AND workspace_id = $2', [ctx.params.id, ctx.state.ws.id]);
    if (!rows[0]) throw notFound();
    const saved = rows[0];

    if (saved.provider === 'linkedin_cookie') {
      // Claim the next check atomically in PostgreSQL to prevent concurrent
      // requests or page reloads from circumventing the cooldown.
      // This statement touches only the verification metadata, not credentials.
      const { rows: claimed } = await db.query(
        `UPDATE accounts SET config = jsonb_set(
           config, '{verification}',
           coalesce(config->'verification', '{}'::jsonb) || jsonb_build_object('last_attempt_at', now()), true)
         WHERE id = $1 AND workspace_id = $2 AND provider = 'linkedin_cookie'
           AND (config->'verification'->>'last_attempt_at' IS NULL
                OR (config->'verification'->>'last_attempt_at')::timestamptz
                   <= now() - ($3::integer * interval '1 second'))
         RETURNING *`,
        [saved.id, ctx.state.ws.id, LINKEDIN_CHECK_COOLDOWN_SECONDS],
      );
      if (!claimed.length) {
        const recent = await db.query(
          "SELECT config->'verification' AS verification FROM accounts WHERE id = $1 AND workspace_id = $2",
          [saved.id, ctx.state.ws.id],
        );
        return {
          ok: false, cooldown: true,
          retry_after_seconds: linkedinRetrySeconds(recent.rows[0]?.verification),
          detail: 'Test trop rapproché : attendez avant de vérifier à nouveau. Aucun appel LinkedIn effectué.',
        };
      }

      const account = agent.decryptAccount(claimed[0]);
      let res;
      try {
        res = await getProvider('linkedin_cookie').test(account);
      } catch {
        res = { ok: false, error_code: 'unexpected_error', detail: 'Contrôle interrompu. Les cookies restent enregistrés.' };
      }
      const patch = JSON.stringify(linkedinCheckPatch(res));
      // Guard against a user replacing the credentials while the check is running:
      // the outcome of the old session must not affect the new one.
      const match = " AND config->>'li_at_enc' = $3 AND config->>'jsessionid_enc' = $4";
      const keys = [account.id, patch, claimed[0].config.li_at_enc, claimed[0].config.jsessionid_enc];
      if (res.ok) {
        const change = linkedinVerificationChange(account, res);
        await db.query(
          `UPDATE accounts SET
             status = CASE WHEN status = 'paused' THEN 'paused' ELSE 'active' END,
             status_detail = NULL,
             config = jsonb_set(
               jsonb_set(config, '{verification}', coalesce(config->'verification', '{}'::jsonb) || $2::jsonb, true),
               '{profile}', $5::jsonb, true)
           WHERE id = $1${match}`,
          [...keys, JSON.stringify(change.profile)],
        );
      } else {
        await db.query(
          `UPDATE accounts SET config = jsonb_set(
              config, '{verification}', coalesce(config->'verification', '{}'::jsonb) || $2::jsonb, true)
            WHERE id = $1${match}`,
          keys,
        );
      }
      return res;
    }

    const account = agent.decryptAccount(saved);
    try {
      const res = await getProvider(account.provider).test(account);
      if (res.ok && account.status === 'error') {
        await db.query(`UPDATE accounts SET status = 'active', status_detail = NULL WHERE id = $1`, [account.id]);
      }
      return res;
    } catch (e) {
      return { ok: false, detail: e.message };
    }
  });

  // ----------------------------------------------------------- campaigns
  const campaignStats = `
    (SELECT count(*)::int FROM prospects p WHERE p.campaign_id = c.id) AS prospects,
    (SELECT count(*)::int FROM prospects p WHERE p.campaign_id = c.id AND p.status = 'qualified') AS waiting,
    (SELECT count(*)::int FROM prospects p WHERE p.campaign_id = c.id AND p.invited_at IS NOT NULL) AS invited,
    (SELECT count(*)::int FROM prospects p WHERE p.campaign_id = c.id AND p.connected_at IS NOT NULL) AS connected,
    (SELECT count(*)::int FROM prospects p WHERE p.campaign_id = c.id AND p.last_reply_at IS NOT NULL) AS replied,
    (SELECT count(*)::int FROM meetings m WHERE m.campaign_id = c.id AND m.status IN ('confirmed', 'done')) AS meetings`;

  router.get('/api/campaigns', requireAuth, async (ctx) => {
    const { rows } = await db.query(
      `SELECT c.*, a.name AS account_name, a.provider AS account_provider, ${campaignStats}
         FROM campaigns c LEFT JOIN accounts a ON a.id = c.account_id
        WHERE c.workspace_id = $1 AND c.deleted_at IS NULL AND ($2::boolean OR c.status <> 'archived') ORDER BY c.created_at DESC`,
      [ctx.state.ws.id, ctx.query.archived === '1'],
    );
    return rows.map((c) => ({ ...c, settings: { ...DEFAULT_CAMPAIGN_SETTINGS, ...c.settings } }));
  });

  function sanitizeSequence(seq) {
    if (!Array.isArray(seq) || !seq.length) return DEFAULT_SEQUENCE;
    const out = [{ type: 'invite', with_note: !!seq[0]?.with_note }];
    out.push({ type: 'message', delay_hours: Math.max(0, Number(seq[1]?.delay_hours ?? 3)), instructions: String(seq[1]?.instructions || '').slice(0, 1000) });
    for (const s of seq.slice(2, 10)) {
      out.push({ type: 'followup', delay_days: Math.max(1, Number(s.delay_days) || 3), instructions: String(s.instructions || '').slice(0, 1000), media_id: s.media_id || null });
    }
    return out;
  }

  function sanitizeSettings(s = {}, prev = {}) {
    const out = { ...DEFAULT_CAMPAIGN_SETTINGS, ...prev };
    if (['none', 'first', 'all'].includes(s.validation)) out.validation = s.validation;
    for (const k of ['setter_enabled', 'followups_enabled', 'auto_discovery']) if (s[k] !== undefined) out[k] = !!s[k];
    if (s.language) out.language = String(s.language).slice(0, 10);
    if (s.min_score !== undefined) out.min_score = Math.min(100, Math.max(0, parseInt(s.min_score, 10) || 0));
    if (s.weekly_prospects !== undefined) out.weekly_prospects = Math.min(1000, Math.max(1, parseInt(s.weekly_prospects, 10) || 100));
    return out;
  }

  async function campaignAccountProvider(accountId, workspaceId) {
    if (!accountId) return null;
    const { rows } = await db.query(
      'SELECT provider FROM accounts WHERE id = $1 AND workspace_id = $2',
      [accountId, workspaceId],
    );
    if (!rows.length) throw bad('Compte LinkedIn non trouvé dans cet espace');
    return rows[0].provider;
  }

  router.post('/api/campaigns', requireAuth, requireAdmin, async (ctx) => {
    const body = await ctx.json();
    const ws = ctx.state.ws;
    const icp = body.icp ? Object.fromEntries(Object.entries(body.icp).map(([k, v]) => [k, cleanList(v)])) : ws.settings.icp || {};
    let accountId = body.account_id || null;
    if (!accountId) {
      const a = await db.query('SELECT id FROM accounts WHERE workspace_id = $1 ORDER BY created_at LIMIT 1', [ws.id]);
      accountId = a.rows[0]?.id || null;
    }
    const provider = await campaignAccountProvider(accountId, ws.id);
    const { rows } = await db.query(
      `INSERT INTO campaigns (workspace_id, account_id, name, goal, offer, icp, sequence, settings) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [ws.id, accountId, validateCampaignName(body.name ?? 'Nouvelle campagne'), String(body.goal || 'meeting'), String(body.offer || ws.settings.offer?.summary || ''),
        JSON.stringify(icp), JSON.stringify(sanitizeSequence(body.sequence)), JSON.stringify(assistedCampaignSettings(sanitizeSettings(body.settings), provider))],
    );
    return rows[0];
  });

  async function ownedCampaign(ctx) {
    const { rows } = await db.query('SELECT * FROM campaigns WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL', [ctx.params.id, ctx.state.ws.id]);
    if (!rows[0]) throw notFound('Campagne introuvable');
    return rows[0];
  }

  // A campaign 'deletion' is intentionally reversible at the database level.
  // It only hides the campaign and cancels pending outbound messages. All
  // prospects, conversations, meetings, events and links remain untouched.
  // Name confirmation is checked server-side; the workspace is always scoped.
  router.delete('/api/campaigns/:id', requireAuth, requireAdmin, async (ctx) => {
    const body = await ctx.json(2048);
    if (typeof body.confirm_name !== 'string' || !body.confirm_name.trim()) {
      throw bad('Saisissez le nom exact de la campagne pour confirmer la suppression');
    }
    const result = await db.tx(async (tx) => {
      const { rows } = await tx.query(
        'SELECT id, name FROM campaigns WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL FOR UPDATE',
        [ctx.params.id, ctx.state.ws.id],
      );
      const campaign = rows[0];
      if (!campaign) throw notFound('Campagne introuvable');
      if (body.confirm_name !== campaign.name) throw bad('Le nom saisi ne correspond pas à cette campagne');
      await tx.query(
        "UPDATE campaigns SET deleted_at = now(), status = 'archived', archived_at = now(), updated_at = now() WHERE id = $1 AND workspace_id = $2",
        [campaign.id, ctx.state.ws.id],
      );
      await tx.query(
        "UPDATE messages SET status = 'cancelled' WHERE campaign_id = $1 AND workspace_id = $2 AND status IN ('queued', 'pending_approval')",
        [campaign.id, ctx.state.ws.id],
      );
      // Preserve all child rows; no SQL DELETE FROM anywhere in this route.
      return { id: campaign.id, name: campaign.name };
    });
    await deps.activity.log(ctx.state.ws.id, 'campaign.deleted', {
      campaignId: result.id, data: { name: result.name, retained_data: true },
    });
    return { ok: true, preserved_data: true };
  });

  // Rename independently from campaign settings to avoid overwriting unsaved or
  // concurrent edits to the target, sequence or account.
  router.patch('/api/campaigns/:id/name', requireAuth, requireAdmin, async (ctx) => {
    const campaign = await ownedCampaign(ctx);
    const body = await ctx.json(2048);
    const name = validateCampaignName(body.name);
    const { rows } = await db.query(
      'UPDATE campaigns SET name = $2, updated_at = now() WHERE id = $1 AND workspace_id = $3 RETURNING id, name',
      [campaign.id, name, ctx.state.ws.id],
    );
    return rows[0];
  });

  router.get('/api/campaigns/:id', requireAuth, async (ctx) => {
    await ownedCampaign(ctx);
    const { rows } = await db.query(
      `SELECT c.*, a.name AS account_name, a.provider AS account_provider, ${campaignStats} FROM campaigns c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
      [ctx.params.id],
    );
    const c = rows[0];
    return { ...c, settings: { ...DEFAULT_CAMPAIGN_SETTINGS, ...c.settings }, sequence: Array.isArray(c.sequence) && c.sequence.length ? c.sequence : DEFAULT_SEQUENCE };
  });

  router.patch('/api/campaigns/:id', requireAuth, requireAdmin, async (ctx) => {
    const c = await ownedCampaign(ctx);
    const body = await ctx.json();
    const icp = body.icp ? Object.fromEntries(Object.entries(body.icp).map(([k, v]) => [k, cleanList(v)])) : c.icp;
    const accountId = body.account_id !== undefined ? body.account_id || null : c.account_id;
    const provider = await campaignAccountProvider(accountId, ctx.state.ws.id);
    const { rows } = await db.query(
      `UPDATE campaigns SET name = $2, goal = $3, offer = $4, icp = $5, sequence = $6, settings = $7, account_id = $8, updated_at = now() WHERE id = $1 RETURNING *`,
      [c.id, validateCampaignName(body.name ?? c.name), String(body.goal ?? c.goal), String(body.offer ?? c.offer),
        JSON.stringify(icp), JSON.stringify(body.sequence ? sanitizeSequence(body.sequence) : c.sequence),
        JSON.stringify(assistedCampaignSettings(sanitizeSettings(body.settings || {}, c.settings), provider)), accountId],
    );
    return rows[0];
  });

  router.post('/api/campaigns/:id/status', requireAuth, async (ctx) => {
    const c = await ownedCampaign(ctx);
    const { status } = await ctx.json();
    if (!['active', 'paused', 'archived', 'draft'].includes(status)) throw bad('Statut invalide');
    if (status === 'active' && !c.account_id) throw bad('Associez un compte LinkedIn avant d\'activer la campagne');
    await db.query(`UPDATE campaigns SET status = $2, archived_at = CASE WHEN $2 = 'archived' THEN now() ELSE NULL END, updated_at = now() WHERE id = $1`, [c.id, status]);
    if (status === 'active') {
      // Kick off prospects waiting in this campaign.
      await db.query(`UPDATE prospects SET next_action_at = now() WHERE campaign_id = $1 AND status IN ('qualified') AND next_action_at IS NULL`, [c.id]);
    }
    if (status === 'archived') {
      await db.query(`UPDATE messages SET status = 'cancelled' WHERE campaign_id = $1 AND status IN ('queued', 'pending_approval')`, [c.id]);
    }
    await deps.activity.log(ctx.state.ws.id, `campaign.${status}`, { campaignId: c.id, data: { name: c.name } });
    return { ok: true, status };
  });

  router.post('/api/campaigns/:id/discover', requireAuth, async (ctx) => {
    const c = await agent.campaign((await ownedCampaign(ctx)).id);
    const body = await ctx.json();
    try {
      return await agent.discover(ctx.state.ws, c, { limit: Math.min(50, Math.max(1, parseInt(body.limit, 10) || 15)) });
    } catch (e) {
      throw bad(e.message);
    }
  });

  // Playground: generates sample messages for a real or synthetic prospect, nothing is sent.
  router.post('/api/campaigns/:id/preview', requireAuth, async (ctx) => {
    const c = await agent.campaign((await ownedCampaign(ctx)).id);
    const body = await ctx.json();
    const ws = await agent.workspace(ctx.state.ws.id);
    let p;
    if (body.prospect_id) p = await agent.prospect(body.prospect_id);
    if (!p || p.workspace_id !== ws.id) p = { ...fakeProspects(c.icp, 1)[0], id: 'preview', setter_state: {} };
    const kind = ['invite', 'first', 'followup'].includes(body.kind) ? body.kind : 'first';
    const stepIdx = kind === 'invite' ? 0 : kind === 'first' ? 1 : Math.max(2, parseInt(body.step, 10) || 2);
    const step = { ...(c.sequence[stepIdx] || {}), number: stepIdx - 1 };
    const media = await agent.mediaLink(ws, step.media_id);
    const text = await ai.writeMessage(ws, c, p, { kind, step, media });
    let setter = null;
    if (body.reply) {
      const slots = await calendar.freeSlots(ws, { count: 3, spread: true });
      setter = await ai.setterTurn(ws, c, { ...p, setter_state: {} }, {
        history: [{ direction: 'out', body: text }, { direction: 'in', body: String(body.reply) }],
        slots,
        timezone: calendar.availability(ws).timezone,
      });
    }
    return { prospect: { full_name: p.full_name, title: p.title, company: p.company, signals: p.signals }, text, setter, ai: ai.enabled(ws) };
  });
}
