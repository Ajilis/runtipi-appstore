import fs from 'node:fs/promises';
import { createPersonalizedCompanionArchive } from '../lib/companion-bundle.js';
import { bad, forbidden, unauthorized } from '../lib/http.js';
import { randomToken, sha256 } from '../lib/crypto.js';

// Accept semver-like browser extension versions only (untrusted client metadata).
export function normalizeCompanionVersion(input) {
  if (typeof input !== 'string') return null;
  const version = input.trim();
  return /^\d{1,3}\.\d{1,3}\.\d{1,4}(?:-[a-zA-Z0-9.-]{1,32})?$/.test(version)
    ? version : null;
}

export function normalizeCompanionProfile(input) {
  if (typeof input !== 'string' || input.length > 512) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !['www.linkedin.com', 'linkedin.com'].includes(url.hostname.toLowerCase())
      || url.username || url.password || url.port) return null;
    const matched = /^\/in\/([a-z0-9][a-z0-9_.%-]{0,199})\/?$/i.exec(url.pathname);
    return matched ? 'https://www.linkedin.com/in/' + matched[1] + '/' : null;
  } catch { return null; }
}

// Only campaign targeting keywords; never send AI settings, credentials or CRM data.
export function companionSearchTerms(icp = {}) {
  if (!icp || typeof icp !== 'object') return '';
  const fields = ['titles', 'industries', 'locations', 'keywords'];
  const terms = fields.map((field) => {
    const values = Array.isArray(icp[field]) ? icp[field] : [];
    return String(values[0] || '').replace(/[\r\n\t<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
  }).filter(Boolean);
  return terms.join(' ').slice(0, 240);
}

// A browser extension exchanges a five-minute, single-use code for a narrowly
// scoped, revocable bearer. It never gets a Rendevo API token or LinkedIn cookie.
export function registerCompanion(router, deps, { requireAuth, requireAdmin }) {
  const { db, agent } = deps;

  // Generate a per-instance extension only for authenticated users.
  // The ZIP is temporary, never exposed from the static web directory.
  router.get('/api/companion/download', requireAuth, async (ctx) => {
    ctx.header('Cache-Control', 'no-store');
    const bundle = await createPersonalizedCompanionArchive(deps.config.publicUrl);
    try {
      await ctx.sendFile(bundle.archive, {
        cache: 'no-store',
        download: 'Rendevo-Companion-V30.zip',
      });
    } finally {
      await fs.rm(bundle.directory, { recursive: true, force: true });
    }
  });

  router.post('/api/companion/pairings', requireAuth, requireAdmin, async (ctx) => {
    await db.query('DELETE FROM companion_pairings WHERE expires_at <= now() OR (workspace_id = $1 AND user_id = $2)',
      [ctx.state.ws.id, ctx.state.user.id]);
    const code = randomToken(24);
    await db.query(
      "INSERT INTO companion_pairings(code_hash, workspace_id, user_id, expires_at) VALUES ($1,$2,$3,now() + interval '5 minutes')",
      [sha256(code), ctx.state.ws.id, ctx.state.user.id],
    );
    ctx.header('Cache-Control', 'no-store');
    return { code, expires_in_seconds: 300 };
  });

  router.get('/api/companion/devices', requireAuth, async (ctx) => {
    const { rows } = await db.query(
      'SELECT id, name, prefix, created_at, last_used_at, expires_at, extension_version FROM companion_devices WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC',
      [ctx.state.ws.id, ctx.state.user.id],
    );
    ctx.header('Cache-Control', 'no-store');
    return { items: rows };
  });

  router.delete('/api/companion/devices/:id', requireAuth, async (ctx) => {
    const { rows } = await db.query(
      'UPDATE companion_devices SET revoked_at = now() WHERE id = $1 AND workspace_id = $2 AND user_id = $3 AND revoked_at IS NULL RETURNING id',
      [ctx.params.id, ctx.state.ws.id, ctx.state.user.id],
    );
    if (!rows.length) throw bad('Extension introuvable ou déjà révoquée');
    return { ok: true };
  });

  router.post('/api/companion/exchange', async (ctx) => {
    const body = await ctx.json(4096);
    const code = String(body.code || '').trim();
    if (!/^[A-Za-z0-9_-]{32}$/.test(code)) throw bad('Code d’association invalide');
    const { rows } = await db.query(
      'DELETE FROM companion_pairings WHERE code_hash = $1 AND expires_at > now() RETURNING workspace_id, user_id',
      [sha256(code)],
    );
    if (!rows.length) throw unauthorized('Code d’association expiré ou déjà utilisé');
    const deviceName = String(body.device_name || 'Chrome Companion').trim().slice(0, 80) || 'Chrome Companion';
    const token = randomToken(32);
    const { rows: devices } = await db.query(
      "INSERT INTO companion_devices(workspace_id,user_id,name,token_hash,prefix,expires_at,extension_version) VALUES ($1,$2,$3,$4,$5,now() + interval '90 days',$6) RETURNING id, expires_at",
      [rows[0].workspace_id, rows[0].user_id, deviceName, sha256(token), token.slice(0, 10), normalizeCompanionVersion(body.version)],
    );
    ctx.header('Cache-Control', 'no-store');
    return { token, expires_at: devices[0].expires_at };
  });

  async function requireDevice(ctx) {
    const header = String(ctx.req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized('Associez de nouveau Rendevo Companion');
    const { rows } = await db.query(
      `UPDATE companion_devices d SET last_used_at = now(), extension_version = COALESCE($2, d.extension_version)
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE d.token_hash = $1 AND d.user_id = m.user_id AND d.workspace_id = m.workspace_id
         AND d.revoked_at IS NULL AND d.expires_at > now() AND m.role <> 'client'
       RETURNING d.id, d.workspace_id, d.user_id, d.expires_at`,
      [sha256(token), normalizeCompanionVersion(ctx.req.headers['x-companion-version'])],
    );
    if (!rows.length) throw unauthorized('Extension révoquée, expirée ou accès retiré');
    ctx.state.companion = rows[0];
    ctx.state.ws = await agent.workspace(rows[0].workspace_id);
    ctx.header('Cache-Control', 'no-store');
  }

  router.get('/api/companion/status', requireDevice, async (ctx) => ({
    connected: true,
    workspace: ctx.state.ws.name,
    rendevo_version: deps.config?.version || '',
    expires_at: ctx.state.companion.expires_at,
  }));

  router.get('/api/companion/campaigns', requireDevice, async (ctx) => {
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.icp FROM campaigns c
       JOIN accounts a ON a.id = c.account_id AND a.workspace_id = c.workspace_id
       WHERE c.workspace_id = $1 AND a.provider = 'linkedin_companion' AND c.status <> 'archived'
       ORDER BY c.created_at DESC LIMIT 100`,
      [ctx.state.ws.id],
    );
    return { items: rows.map(({ id, name, icp }) => ({ id, name, search_keywords: companionSearchTerms(icp) })) };
  });

  // Explicitly reviewed profile URLs from manually pasted links or the current
  // LinkedIn search page, read on request in Chrome. Nothing is imported until
  // confirmation; the server never accesses the LinkedIn session or DOM.
  router.post('/api/companion/prospects/batch', requireDevice, async (ctx) => {
    const body = await ctx.json(48 * 1024);
    const raw = body.items;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) {
      throw bad('Sélectionnez entre 1 et 100 liens de profils à importer');
    }
    const items = [];
    const seen = new Set();
    for (const rawItem of raw) {
      if (!rawItem || typeof rawItem !== 'object') throw bad('Format du profil invalide');
      const linkedinUrl = normalizeCompanionProfile(rawItem.linkedin_url);
      if (!linkedinUrl) throw bad('Tous les liens doivent correspondre à des profils LinkedIn /in/ valides');
      const uniqueKey = linkedinUrl.toLowerCase();
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      items.push({
        linkedin_url: linkedinUrl,
        full_name: String(rawItem.full_name || '').trim().slice(0, 160),
        source: 'companion_manual_list',
      });
    }
    const campaignId = body.campaign_id || null;
    if (campaignId) {
      const { rows } = await db.query(
        `SELECT 1 FROM campaigns c JOIN accounts a ON a.id = c.account_id
         WHERE c.id = $1 AND c.workspace_id = $2 AND a.workspace_id = $2
         AND a.provider = 'linkedin_companion' AND c.status <> 'archived'`,
        [campaignId, ctx.state.ws.id],
      );
      if (!rows.length) throw forbidden('Cette campagne ne peut pas être utilisée par Companion');
    }
    const result = await agent.importProspects(ctx.state.ws, items,
      { campaignId, source: 'companion_manual_list' });
    return { created: result.created, duplicates: result.duplicates, invalid: result.invalid,
      submitted: items.length, repeated_in_list: raw.length - items.length };
  });

  router.post('/api/companion/prospects', requireDevice, async (ctx) => {
    const body = await ctx.json(4096);
    const linkedinUrl = normalizeCompanionProfile(body.linkedin_url);
    if (!linkedinUrl) throw bad('Ouvrez un profil LinkedIn valide dans Chrome');
    const campaignId = body.campaign_id || null;
    if (campaignId) {
      const { rows } = await db.query(
        `SELECT 1 FROM campaigns c JOIN accounts a ON a.id = c.account_id
         WHERE c.id = $1 AND c.workspace_id = $2 AND a.workspace_id = $2
         AND a.provider = 'linkedin_companion' AND c.status <> 'archived'`,
        [campaignId, ctx.state.ws.id],
      );
      if (!rows.length) throw forbidden('Cette campagne ne peut pas être utilisée par Companion');
    }
    const result = await agent.importProspects(ctx.state.ws,
      [{ linkedin_url: linkedinUrl, source: 'companion' }],
      { campaignId, source: 'companion' });
    return { created: result.created, duplicates: result.duplicates, invalid: result.invalid };
  });
}
