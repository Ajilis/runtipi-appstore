import { bad, unauthorized, forbidden, HttpError } from '../lib/http.js';
import { hashPassword, verifyPassword, randomToken, sha256 } from '../lib/crypto.js';
import { DEFAULT_AVAILABILITY } from '../services/calendar.js';
import { DEFAULT_SCHEDULE } from '../services/worker.js';

const COOKIE = 'rdv_session';
const attempts = new Map();

function throttle(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60e3);
  if (list.length >= 10) throw new HttpError(429, 'Trop de tentatives, réessayez dans 15 minutes');
  list.push(now);
  attempts.set(key, list);
}

export function defaultSettings() {
  return {
    offer: {},
    icp: { titles: [], industries: [], locations: ['France'], company_sizes: [], keywords: [], exclusions: ['Étudiant', 'Stagiaire'] },
    voice: { formality: 'vous', tone: 'Direct et chaleureux', examples: [], signature: '', sender_name: '' },
    availability: { ...DEFAULT_AVAILABILITY },
    schedule: { ...DEFAULT_SCHEDULE },
    goal: { meetings_per_week: 5 },
    onboarding_done: false,
  };
}

export function makeAuth(deps) {
  const { db } = deps;

  async function load(ctx) {
    let userId = null;
    let workspaceId = null;
    let sessionId = null;
    const header = ctx.req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      const { rows } = await db.query('UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1 RETURNING user_id, workspace_id', [sha256(header.slice(7).trim())]);
      if (rows[0]) { userId = rows[0].user_id; workspaceId = rows[0].workspace_id; }
    } else if (ctx.cookies[COOKIE]) {
      sessionId = sha256(ctx.cookies[COOKIE]);
      const { rows } = await db.query('SELECT user_id, workspace_id FROM sessions WHERE id = $1 AND expires_at > now()', [sessionId]);
      if (rows[0]) { userId = rows[0].user_id; workspaceId = rows[0].workspace_id; }
    }
    if (!userId) return false;
    const { rows: users } = await db.query('SELECT id, email, name, is_admin, created_at FROM users WHERE id = $1', [userId]);
    if (!users[0]) return false;
    let membership = null;
    if (workspaceId) {
      const { rows } = await db.query('SELECT * FROM memberships WHERE user_id = $1 AND workspace_id = $2', [userId, workspaceId]);
      membership = rows[0];
    }
    if (!membership) {
      const { rows } = await db.query('SELECT * FROM memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1', [userId]);
      membership = rows[0];
      if (membership && sessionId) await db.query('UPDATE sessions SET workspace_id = $2 WHERE id = $1', [sessionId, membership.workspace_id]);
    }
    if (!membership) return false;
    ctx.state.user = users[0];
    ctx.state.role = users[0].is_admin ? 'owner' : membership.role;
    ctx.state.sessionId = sessionId;
    ctx.state.ws = await deps.agent.workspace(membership.workspace_id);
    return true;
  }

  const CLIENT_WRITE_OK = [/^\/api\/auth\//, /^\/api\/me\/(password|profile)$/, /^\/api\/workspaces\/[^/]+\/switch$/];
  const requireAuth = async (ctx) => {
    if (!(await load(ctx))) throw unauthorized();
    // "client" members (agency customers) can look but not touch.
    if (ctx.state.role === 'client' && ctx.req.method !== 'GET' && !CLIENT_WRITE_OK.some((re) => re.test(ctx.url.pathname))) {
      throw forbidden('Accès en lecture seule');
    }
  };
  const requireAdmin = async (ctx) => {
    if (!['owner', 'admin'].includes(ctx.state.role)) throw forbidden('Réservé aux administrateurs de l\'espace');
  };

  async function createSession(ctx, userId, workspaceId) {
    const token = randomToken(32);
    const days = deps.config.server?.session_days || 30;
    await db.query('INSERT INTO sessions (id, user_id, workspace_id, expires_at) VALUES ($1, $2, $3, now() + make_interval(days => $4))', [sha256(token), userId, workspaceId, days]);
    const secure = (ctx.req.headers['x-forwarded-proto'] || '') === 'https';
    ctx.setCookie(COOKIE, token, { maxAge: days * 86400, secure });
  }

  async function createWorkspace(name, userId, role = 'owner') {
    const { rows } = await db.query('INSERT INTO workspaces (name, settings) VALUES ($1, $2) RETURNING *', [name, JSON.stringify(defaultSettings())]);
    await db.query('INSERT INTO memberships (user_id, workspace_id, role) VALUES ($1, $2, $3)', [userId, rows[0].id, role]);
    return rows[0];
  }

  function validateCredentials({ email, password, name }) {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Adresse e-mail invalide');
    if (String(password || '').length < 10) throw bad('Le mot de passe doit contenir au moins 10 caractères');
    return { email, password: String(password), name: String(name || '').trim().slice(0, 120) };
  }

  function register(router) {
    router.get('/api/health', async () => {
      await db.query('SELECT 1');
      return { ok: true, version: deps.config.version };
    });

    router.get('/api/auth/state', async (ctx) => {
      const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
      const authed = await load(ctx);
      return {
        needsSetup: rows[0].n === 0,
        allowSignup: !!deps.config.server?.allow_signup,
        authenticated: authed,
        version: deps.config.version,
      };
    });

    router.post('/api/auth/setup', async (ctx) => {
      const body = await ctx.json();
      const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
      if (rows[0].n > 0) throw forbidden('Le compte administrateur existe déjà');
      const c = validateCredentials(body);
      const user = (await db.query('INSERT INTO users (email, name, password_hash, is_admin) VALUES ($1, $2, $3, true) RETURNING id', [c.email, c.name || c.email.split('@')[0], hashPassword(c.password)])).rows[0];
      const ws = await createWorkspace(String(body.workspaceName || 'Mon espace').slice(0, 80), user.id, 'owner');
      if (c.name) await db.query(`UPDATE workspaces SET settings = jsonb_set(settings, '{voice,sender_name}', to_jsonb($2::text)) WHERE id = $1`, [ws.id, c.name]);
      await createSession(ctx, user.id, ws.id);
      return { ok: true };
    });

    router.post('/api/auth/signup', async (ctx) => {
      if (!deps.config.server?.allow_signup) throw forbidden('Les inscriptions sont fermées. Demandez un accès à votre administrateur.');
      throttle('signup:' + (ctx.req.socket.remoteAddress || ''));
      const body = await ctx.json();
      const c = validateCredentials(body);
      const exists = await db.query('SELECT 1 FROM users WHERE email = $1', [c.email]);
      if (exists.rows.length) throw bad('Un compte existe déjà avec cette adresse');
      const user = (await db.query('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id', [c.email, c.name, hashPassword(c.password)])).rows[0];
      const ws = await createWorkspace(String(body.workspaceName || `Espace de ${c.name || c.email}`).slice(0, 80), user.id);
      await createSession(ctx, user.id, ws.id);
      return { ok: true };
    });

    router.post('/api/auth/login', async (ctx) => {
      const body = await ctx.json();
      const email = String(body.email || '').trim().toLowerCase();
      throttle('login:' + email);
      const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
      const user = rows[0];
      if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) throw bad('E-mail ou mot de passe incorrect');
      attempts.delete('login:' + email);
      await createSession(ctx, user.id, null);
      return { ok: true };
    });

    router.post('/api/auth/logout', async (ctx) => {
      if (ctx.cookies[COOKIE]) await db.query('DELETE FROM sessions WHERE id = $1', [sha256(ctx.cookies[COOKIE])]);
      ctx.setCookie(COOKIE, '', { maxAge: 0 });
      return { ok: true };
    });

    router.get('/api/me', requireAuth, async (ctx) => {
      const { rows } = await db.query(
        `SELECT w.id, w.name, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY m.created_at`,
        [ctx.state.user.id],
      );
      let all = rows;
      if (ctx.state.user.is_admin) {
        const extra = await db.query(`SELECT id, name, 'owner' AS role FROM workspaces WHERE id <> ALL($1::uuid[]) ORDER BY created_at`, [rows.map((r) => r.id)]);
        all = [...rows, ...extra.rows];
      }
      const ws = ctx.state.ws;
      return {
        user: ctx.state.user,
        role: ctx.state.role,
        workspace: { id: ws.id, name: ws.name, agent_enabled: ws.agent_enabled, onboarding_done: !!ws.settings?.onboarding_done },
        workspaces: all,
        public_url: deps.agent.publicUrl(ws),
        version: deps.config.version,
      };
    });

    // Allow each authenticated user (including client/read-only members) to edit
    // their own identity without altering their workspace or permissions.
    router.patch('/api/me/profile', requireAuth, async (ctx) => {
      const body = await ctx.json();
      const name = String(body.name ?? ctx.state.user.name).trim();
      const email = String(body.email ?? ctx.state.user.email).trim().toLowerCase();
      if (!name || name.length > 120) throw bad('Le nom doit contenir entre 1 et 120 caractères');
      if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw bad('Adresse e-mail invalide');
      }

      const emailChanged = email !== ctx.state.user.email;
      if (emailChanged) {
        throttle('profile-email:' + ctx.state.user.id);
        const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [ctx.state.user.id]);
        if (!rows[0] || !verifyPassword(String(body.current_password || ''), rows[0].password_hash)) {
          throw bad('Mot de passe actuel incorrect');
        }
        attempts.delete('profile-email:' + ctx.state.user.id);
      }

      try {
        const { rows } = await db.query(
          'UPDATE users SET name = $2, email = $3 WHERE id = $1 RETURNING id, name, email',
          [ctx.state.user.id, name, email],
        );
        if (!rows[0]) throw unauthorized();
        // The login session is attached to the immutable user id, not the e-mail.
        return { user: rows[0], email_changed: emailChanged };
      } catch (error) {
        if (error.code === '23505') throw bad('Cette adresse e-mail est déjà utilisée');
        throw error;
      }
    });

    router.post('/api/me/password', requireAuth, async (ctx) => {
      const body = await ctx.json();
      const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [ctx.state.user.id]);
      if (!verifyPassword(String(body.current || ''), rows[0].password_hash)) throw bad('Mot de passe actuel incorrect');
      if (String(body.next || '').length < 10) throw bad('Le nouveau mot de passe doit contenir au moins 10 caractères');
      await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [ctx.state.user.id, hashPassword(String(body.next))]);
      await db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [ctx.state.user.id, ctx.state.sessionId || '']);
      return { ok: true };
    });

    // Client spaces (agency): each workspace has its own offer, campaigns and accounts.
    router.post('/api/workspaces', requireAuth, requireAdmin, async (ctx) => {
      const body = await ctx.json();
      const name = String(body.name || '').trim();
      if (!name) throw bad('Nom requis');
      const ws = await createWorkspace(name.slice(0, 80), ctx.state.user.id, 'owner');
      if (ctx.state.sessionId) await db.query('UPDATE sessions SET workspace_id = $2 WHERE id = $1', [ctx.state.sessionId, ws.id]);
      return { id: ws.id };
    });

    router.post('/api/workspaces/:id/switch', requireAuth, async (ctx) => {
      const { rows } = await db.query('SELECT 1 FROM memberships WHERE user_id = $1 AND workspace_id = $2', [ctx.state.user.id, ctx.params.id]);
      if (!rows.length && !ctx.state.user.is_admin) throw forbidden();
      if (!rows.length) await db.query(`INSERT INTO memberships (user_id, workspace_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`, [ctx.state.user.id, ctx.params.id]);
      if (ctx.state.sessionId) await db.query('UPDATE sessions SET workspace_id = $2 WHERE id = $1', [ctx.state.sessionId, ctx.params.id]);
      return { ok: true };
    });

    router.patch('/api/workspace', requireAuth, requireAdmin, async (ctx) => {
      const body = await ctx.json();
      if (body.name) await db.query('UPDATE workspaces SET name = $2 WHERE id = $1', [ctx.state.ws.id, String(body.name).slice(0, 80)]);
      return { ok: true };
    });

    router.get('/api/workspace/members', requireAuth, async (ctx) => {
      const { rows } = await db.query(
        `SELECT u.id, u.email, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY m.created_at`,
        [ctx.state.ws.id],
      );
      return rows;
    });

    router.post('/api/workspace/members', requireAuth, requireAdmin, async (ctx) => {
      const body = await ctx.json();
      const c = validateCredentials(body);
      const role = ['admin', 'member', 'client'].includes(body.role) ? body.role : 'member';
      let user = (await db.query('SELECT id FROM users WHERE email = $1', [c.email])).rows[0];
      if (!user) user = (await db.query('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id', [c.email, c.name, hashPassword(c.password)])).rows[0];
      await db.query('INSERT INTO memberships (user_id, workspace_id, role) VALUES ($1, $2, $3) ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = $3', [user.id, ctx.state.ws.id, role]);
      return { ok: true };
    });

    router.delete('/api/workspace/members/:id', requireAuth, requireAdmin, async (ctx) => {
      if (ctx.params.id === ctx.state.user.id) throw bad('Vous ne pouvez pas vous retirer vous-même');
      await db.query(`DELETE FROM memberships WHERE user_id = $1 AND workspace_id = $2 AND role <> 'owner'`, [ctx.params.id, ctx.state.ws.id]);
      return { ok: true };
    });
  }

  return { register, requireAuth, requireAdmin };
}
