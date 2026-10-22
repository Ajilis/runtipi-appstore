import { bad, forbidden, unauthorized } from '../lib/http.js';
import { randomToken, sha256 } from '../lib/crypto.js';

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

// A browser extension exchanges a five-minute, single-use code for a narrowly
// scoped, revocable bearer. It never gets a Rendevo API token or LinkedIn cookie.
export function registerCompanion(router, deps, { requireAuth, requireAdmin }) {
  const { db, agent } = deps;

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
      'SELECT id, name, prefix, created_at, last_used_at, expires_at FROM companion_devices WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC',
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
      "INSERT INTO companion_devices(workspace_id,user_id,name,token_hash,prefix,expires_at) VALUES ($1,$2,$3,$4,$5,now() + interval '90 days') RETURNING id, expires_at",
      [rows[0].workspace_id, rows[0].user_id, deviceName, sha256(token), token.slice(0, 10)],
    );
    ctx.header('Cache-Control', 'no-store');
    return { token, expires_at: devices[0].expires_at };
  });

  async function requireDevice(ctx) {
    const header = String(ctx.req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized('Associez de nouveau Rendevo Companion');
    const { rows } = await db.query(
      `UPDATE companion_devices d SET last_used_at = now()
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE d.token_hash = $1 AND d.user_id = m.user_id AND d.workspace_id = m.workspace_id
         AND d.revoked_at IS NULL AND d.expires_at > now() AND m.role <> 'client'
       RETURNING d.id, d.workspace_id, d.user_id, d.expires_at`,
      [sha256(token)],
    );
    if (!rows.length) throw unauthorized('Extension révoquée, expirée ou accès retiré');
    ctx.state.companion = rows[0];
    ctx.state.ws = await agent.workspace(rows[0].workspace_id);
    ctx.header('Cache-Control', 'no-store');
  }

  router.get('/api/companion/status', requireDevice, async (ctx) => ({
    connected: true,
    workspace: ctx.state.ws.name,
    expires_at: ctx.state.companion.expires_at,
  }));

  router.get('/api/companion/campaigns', requireDevice, async (ctx) => {
    const { rows } = await db.query(
      `SELECT c.id, c.name FROM campaigns c
       JOIN accounts a ON a.id = c.account_id AND a.workspace_id = c.workspace_id
       WHERE c.workspace_id = $1 AND a.provider = 'linkedin_companion' AND c.status <> 'archived'
       ORDER BY c.created_at DESC LIMIT 100`,
      [ctx.state.ws.id],
    );
    return { items: rows };
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
