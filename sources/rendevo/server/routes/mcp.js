// MCP connector (Streamable HTTP, JSON responses). Lets Claude, ChatGPT or any
// MCP client drive the agent with an API token: stats, prospects, campaigns,
// escalations and replies. Same safeguards as the web app.
import { sha256 } from '../lib/crypto.js';
import { overview } from './misc.js';

const TOOLS = [
  {
    name: 'get_stats',
    description: "Résumé de la semaine : invitations, acceptations, réponses, rendez-vous, objectif, file d'attente et prospects chauds.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_prospects',
    description: 'Liste les prospects, filtrables par chaleur (hot, warm, cold), statut ou texte.',
    inputSchema: {
      type: 'object',
      properties: {
        heat: { type: 'string', enum: ['hot', 'warm', 'cold'] },
        status: { type: 'string', description: 'qualified, invited, connected, contacted, replied, meeting, callback, lost, won, excluded' },
        search: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'import_prospects',
    description: 'Importe des prospects (URL LinkedIn obligatoire) dans une campagne. Ils sont dédupliqués et qualifiés automatiquement.',
    inputSchema: {
      type: 'object',
      required: ['prospects'],
      properties: {
        campaign_id: { type: 'string' },
        prospects: {
          type: 'array',
          items: {
            type: 'object',
            required: ['linkedin_url'],
            properties: { full_name: { type: 'string' }, linkedin_url: { type: 'string' }, title: { type: 'string' }, company: { type: 'string' }, location: { type: 'string' }, notes: { type: 'string' } },
          },
        },
      },
    },
  },
  {
    name: 'list_campaigns',
    description: 'Liste les campagnes avec leurs statistiques.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_campaign_status',
    description: 'Active ou met en pause une campagne.',
    inputSchema: { type: 'object', required: ['campaign_id', 'status'], properties: { campaign_id: { type: 'string' }, status: { type: 'string', enum: ['active', 'paused'] } } },
  },
  {
    name: 'set_agent',
    description: "Démarre ou met en pause toute l'automatisation de l'espace.",
    inputSchema: { type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } },
  },
  {
    name: 'list_escalations',
    description: 'Conversations qui demandent une intervention humaine et messages en attente de validation.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_conversation',
    description: "Historique complet des messages avec un prospect.",
    inputSchema: { type: 'object', required: ['prospect_id'], properties: { prospect_id: { type: 'string' } } },
  },
  {
    name: 'send_reply',
    description: "Programme l'envoi d'un message à un prospect (au rythme humain du compte) et clôt l'escalade.",
    inputSchema: { type: 'object', required: ['prospect_id', 'text'], properties: { prospect_id: { type: 'string' }, text: { type: 'string' } } },
  },
  {
    name: 'list_meetings',
    description: 'Rendez-vous à venir.',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 60 } } },
  },
];

export function registerMcp(router, deps) {
  const { db, agent } = deps;

  async function authWs(ctx) {
    const h = ctx.req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : ctx.query.token;
    if (!token) return null;
    const { rows } = await db.query('UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1 RETURNING workspace_id, user_id', [sha256(token)]);
    if (!rows[0]) return null;
    return { ws: await agent.workspace(rows[0].workspace_id), userId: rows[0].user_id };
  }

  async function callTool(name, args, { ws }) {
    switch (name) {
      case 'get_stats': {
        const o = await overview(deps, ws, { days: 7 });
        return { week: o.week, goal: o.goal, agent_enabled: o.agent_enabled, queue: o.queue, hot_prospects: o.hot.map((p) => ({ id: p.id, name: p.full_name, title: p.title, company: p.company, signals: p.signals.map((s) => s.label) })), upcoming_meetings: o.upcoming.map((m) => ({ at: m.starts_at, with: m.full_name })) };
      }
      case 'list_prospects': {
        const params = [ws.id];
        const where = ['workspace_id = $1'];
        if (args.heat) { params.push(args.heat); where.push(`heat = $${params.length}`); }
        if (args.status) { params.push(args.status); where.push(`status = $${params.length}`); }
        if (args.search) { params.push(`%${args.search}%`); where.push(`(full_name ILIKE $${params.length} OR company ILIKE $${params.length} OR title ILIKE $${params.length})`); }
        const { rows } = await db.query(`SELECT id, full_name, title, company, location, heat, fit_score, status, stage, linkedin_url, fit_reasoning FROM prospects WHERE ${where.join(' AND ')} ORDER BY fit_score DESC NULLS LAST LIMIT ${Math.min(100, args.limit || 25)}`, params);
        return rows;
      }
      case 'import_prospects': {
        if (args.campaign_id) {
          const c = await db.query('SELECT 1 FROM campaigns WHERE id = $1 AND workspace_id = $2', [args.campaign_id, ws.id]);
          if (!c.rows.length) throw new Error('Campagne introuvable');
        }
        const res = await agent.importProspects(ws, (args.prospects || []).slice(0, 200), { campaignId: args.campaign_id || null, source: 'mcp' });
        return { created: res.created, duplicates: res.duplicates, invalid: res.invalid, excluded: res.excluded };
      }
      case 'list_campaigns': {
        const { rows } = await db.query(
          `SELECT c.id, c.name, c.status, c.goal,
                  (SELECT count(*)::int FROM prospects p WHERE p.campaign_id = c.id) AS prospects,
                  (SELECT count(*)::int FROM prospects p WHERE p.campaign_id = c.id AND p.last_reply_at IS NOT NULL) AS replies,
                  (SELECT count(*)::int FROM meetings m WHERE m.campaign_id = c.id AND m.status IN ('confirmed','done')) AS meetings
             FROM campaigns c WHERE c.workspace_id = $1 AND c.status <> 'archived' ORDER BY c.created_at DESC`,
          [ws.id],
        );
        return rows;
      }
      case 'set_campaign_status': {
        const c = (await db.query('SELECT * FROM campaigns WHERE id = $1 AND workspace_id = $2', [args.campaign_id, ws.id])).rows[0];
        if (!c) throw new Error('Campagne introuvable');
        if (args.status === 'active' && !c.account_id) throw new Error('Associez un compte LinkedIn à la campagne avant de l\'activer');
        await db.query('UPDATE campaigns SET status = $2, updated_at = now() WHERE id = $1', [c.id, args.status]);
        if (args.status === 'active') await db.query(`UPDATE prospects SET next_action_at = now() WHERE campaign_id = $1 AND status = 'qualified' AND next_action_at IS NULL`, [c.id]);
        return { ok: true, status: args.status };
      }
      case 'set_agent':
        await db.query('UPDATE workspaces SET agent_enabled = $2 WHERE id = $1', [ws.id, !!args.enabled]);
        await deps.activity.log(ws.id, args.enabled ? 'agent.started' : 'agent.paused', { data: { by: 'mcp' } });
        return { agent_enabled: !!args.enabled };
      case 'list_escalations': {
        const human = await db.query('SELECT id, full_name, company, human_reason, last_reply_at FROM prospects WHERE workspace_id = $1 AND needs_human ORDER BY last_reply_at DESC NULLS LAST LIMIT 50', [ws.id]);
        const pending = await db.query(`SELECT m.id, m.kind, m.body, p.id AS prospect_id, p.full_name FROM messages m JOIN prospects p ON p.id = m.prospect_id WHERE m.workspace_id = $1 AND m.status = 'pending_approval' ORDER BY m.created_at LIMIT 50`, [ws.id]);
        return { needs_human: human.rows, pending_approval: pending.rows };
      }
      case 'get_conversation': {
        const p = (await db.query('SELECT id, full_name, title, company, status, fit_reasoning, signals FROM prospects WHERE id = $1 AND workspace_id = $2', [args.prospect_id, ws.id])).rows[0];
        if (!p) throw new Error('Prospect introuvable');
        const { rows } = await db.query(`SELECT direction, kind, body, status, coalesce(sent_at, scheduled_at, created_at) AS at FROM messages WHERE prospect_id = $1 AND status <> 'cancelled' ORDER BY 5`, [p.id]);
        return { prospect: p, messages: rows };
      }
      case 'send_reply': {
        const p = (await db.query('SELECT * FROM prospects WHERE id = $1 AND workspace_id = $2', [args.prospect_id, ws.id])).rows[0];
        if (!p) throw new Error('Prospect introuvable');
        const text = String(args.text || '').trim();
        if (!text) throw new Error('Message vide');
        const campaign = await agent.campaign(p.campaign_id);
        const accountId = campaign?.account_id || (await db.query('SELECT id FROM accounts WHERE workspace_id = $1 ORDER BY created_at LIMIT 1', [ws.id])).rows[0]?.id;
        if (!accountId) throw new Error('Aucun compte LinkedIn configuré');
        const m = await agent.enqueue(ws, p, { kind: 'manual', body: text, campaign, accountId, approval: false, meta: { by: 'mcp' } });
        await agent.updateProspect(p.id, { needs_human: false, human_reason: null });
        return { queued: true, message_id: m.id };
      }
      case 'list_meetings': {
        const { rows } = await db.query(
          `SELECT m.id, m.starts_at, m.status, m.meeting_url, p.full_name, p.company FROM meetings m LEFT JOIN prospects p ON p.id = m.prospect_id
            WHERE m.workspace_id = $1 AND m.starts_at >= now() AND m.starts_at < now() + make_interval(days => $2) AND m.status = 'confirmed' ORDER BY m.starts_at`,
          [ws.id, args.days || 14],
        );
        return rows;
      }
      default:
        throw Object.assign(new Error(`Outil inconnu : ${name}`), { rpc: -32602 });
    }
  }

  async function handle(msg, auth) {
    const { id, method, params = {} } = msg;
    const reply = (result) => ({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    switch (method) {
      case 'initialize':
        return reply({
          protocolVersion: params.protocolVersion || '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'rendevo', title: 'Rendevo', version: deps.config.version },
          instructions: "Rendevo est un agent de prospection LinkedIn. Utilisez get_stats pour un point rapide, list_escalations pour ce qui attend une décision humaine, et send_reply pour répondre à un prospect.",
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call':
        try {
          const out = await callTool(params.name, params.arguments || {}, auth);
          return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: Array.isArray(out) ? { items: out } : out });
        } catch (e) {
          if (e.rpc) return fail(e.rpc, e.message);
          return reply({ content: [{ type: 'text', text: e.message }], isError: true });
        }
      case 'resources/list':
        return reply({ resources: [] });
      case 'prompts/list':
        return reply({ prompts: [] });
      default:
        if (id === undefined) return null; // notification
        return fail(-32601, `Méthode inconnue : ${method}`);
    }
  }

  router.get('/mcp', async (ctx) => {
    ctx.header('Allow', 'POST');
    ctx.send(405, { error: 'Utilisez POST (MCP Streamable HTTP)' });
  });

  router.post('/mcp', async (ctx) => {
    const auth = await authWs(ctx);
    if (!auth) {
      ctx.header('WWW-Authenticate', 'Bearer');
      ctx.send(401, { jsonrpc: '2.0', error: { code: -32001, message: 'Jeton API Rendevo requis (Réglages > Intégrations)' } });
      return;
    }
    const body = await ctx.json();
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handle(m, auth)))).filter(Boolean);
      if (!out.length) { ctx.send(202, null); return; }
      ctx.send(200, out);
      return;
    }
    const out = await handle(body, auth);
    if (!out) { ctx.send(202, null); return; }
    ctx.send(200, out);
  });
}
