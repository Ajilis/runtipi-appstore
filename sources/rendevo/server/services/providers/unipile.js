// LinkedIn through Unipile (https://www.unipile.com), the third-party
// messaging infrastructure. The LinkedIn account is connected in the Unipile
// dashboard; Rendevo only stores the DSN, API key and account id.
// Your LinkedIn password is never stored by Rendevo.
import { linkedinIdentifier } from '../../lib/util.js';

function base(cfg) {
  let dsn = String(cfg.dsn || '').trim().replace(/\/+$/, '');
  if (!dsn) throw new Error('DSN Unipile manquant');
  if (!/^https?:\/\//.test(dsn)) dsn = 'https://' + dsn;
  return dsn.replace(/\/api\/v1$/, '') + '/api/v1';
}

async function call(cfg, method, path, { query, json, form } = {}) {
  const url = new URL(base(cfg) + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const headers = { 'X-API-KEY': cfg.api_key, accept: 'application/json' };
  let body;
  if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) {
    body = new FormData();
    for (const [k, v] of Object.entries(form)) {
      if (Array.isArray(v)) v.forEach((x) => body.append(k, x));
      else if (v !== undefined && v !== null) body.append(k, v);
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error(data.detail || data.message || data.title || `Unipile HTTP ${res.status}`);
      err.status = res.status;
      err.fatal = res.status === 401 || res.status === 403;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function itemsOf(data) {
  return data.items || data.data || (Array.isArray(data) ? data : []);
}

export default {
  id: 'unipile',
  label: 'LinkedIn via Unipile',
  auto: true,
  capabilities: { search: true, invite: true, message: true },

  async test(account) {
    const cfg = account.config;
    const acc = await call(cfg, 'GET', `/accounts/${encodeURIComponent(cfg.account_id)}`);
    const status = acc.sources?.[0]?.status || acc.status || 'OK';
    return { ok: !/CREDENTIALS|ERROR|STOPPED/i.test(status), detail: `Compte ${acc.name || cfg.account_id} : ${status}` };
  },

  async getProfile(account, prospect) {
    const cfg = account.config;
    const ident = prospect.provider_id || linkedinIdentifier(prospect.linkedin_url);
    if (!ident) throw new Error('Profil LinkedIn sans identifiant');
    const p = await call(cfg, 'GET', `/users/${encodeURIComponent(ident)}`, { query: { account_id: cfg.account_id } });
    return {
      provider_id: p.provider_id || p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      headline: p.headline,
      location: p.location,
      network_distance: p.network_distance,
      is_relationship: p.is_relationship,
    };
  },

  async search(account, icp, { limit = 10 } = {}) {
    // Classic LinkedIn people search. Keywords mix target titles and needs.
    const cfg = account.config;
    const keywords = [...(icp.titles || []).slice(0, 3), ...(icp.keywords || []).slice(0, 2)].join(' OR ');
    const data = await call(cfg, 'POST', '/linkedin/search', {
      query: { account_id: cfg.account_id, limit },
      json: { api: 'classic', category: 'people', keywords: keywords || 'fondateur' },
    });
    return itemsOf(data).slice(0, limit).map((it) => {
      const name = it.name || [it.first_name, it.last_name].filter(Boolean).join(' ');
      const ident = it.public_identifier || it.public_profile_url?.match(/\/in\/([^/?#]+)/)?.[1];
      return {
        full_name: name || 'Profil LinkedIn',
        headline: it.headline || '',
        title: it.headline ? it.headline.split(/ chez | at | @ | - | \| /)[0] : '',
        company: it.headline && / chez | at | @ /.test(it.headline) ? it.headline.split(/ chez | at | @ /)[1]?.split(/ \| | - /)[0] || '' : '',
        location: it.location || '',
        linkedin_url: ident ? `https://www.linkedin.com/in/${ident}` : it.profile_url || null,
        provider_id: it.id || it.provider_id || null,
        network_distance: it.network_distance,
        signals: [],
        source: 'search',
      };
    }).filter((p) => p.linkedin_url);
  },

  async invite(account, prospect, note) {
    const cfg = account.config;
    let providerId = prospect.provider_id;
    if (!providerId || providerId.startsWith('sim-')) providerId = (await this.getProfile(account, prospect)).provider_id;
    const body = { provider_id: providerId, account_id: cfg.account_id };
    if (note) body.message = note.slice(0, 300);
    await call(cfg, 'POST', '/users/invite', { json: body });
    return { provider_id: providerId };
  },

  async sendMessage(account, prospect, text) {
    const cfg = account.config;
    if (prospect.chat_id) {
      const r = await call(cfg, 'POST', `/chats/${encodeURIComponent(prospect.chat_id)}/messages`, { form: { text } });
      return { chat_id: prospect.chat_id, message_id: r.message_id || r.id || null };
    }
    let providerId = prospect.provider_id;
    if (!providerId) providerId = (await this.getProfile(account, prospect)).provider_id;
    const r = await call(cfg, 'POST', '/chats', { form: { account_id: cfg.account_id, attendees_ids: providerId, text } });
    return { chat_id: r.chat_id || r.id, message_id: r.message_id || null };
  },

  /** Polls relations (acceptances) and recent chats (replies). */
  async sync(account, ctx) {
    const cfg = account.config;
    const { db } = ctx;
    const events = [];
    const state = account.sync_state || {};

    // 1. Acceptances: compare recent relations with invited prospects.
    const invited = await db.query(
      `SELECT id, provider_id, linkedin_url FROM prospects WHERE status = 'invited' AND campaign_id IN (SELECT id FROM campaigns WHERE account_id = $1)`,
      [account.id],
    );
    if (invited.rows.length) {
      const rel = await call(cfg, 'GET', '/users/relations', { query: { account_id: cfg.account_id, limit: 200 } });
      const byProvider = new Set();
      const byIdent = new Set();
      for (const r of itemsOf(rel)) {
        if (r.member_id) byProvider.add(r.member_id);
        if (r.provider_id) byProvider.add(r.provider_id);
        if (r.public_identifier) byIdent.add(String(r.public_identifier).toLowerCase());
      }
      for (const p of invited.rows) {
        const ident = (linkedinIdentifier(p.linkedin_url) || '').toLowerCase();
        if ((p.provider_id && byProvider.has(p.provider_id)) || (ident && byIdent.has(ident))) events.push({ type: 'accepted', prospect_id: p.id });
      }
    }

    // 2. New inbound messages since the last sync.
    const since = state.messages_since || new Date(Date.now() - 2 * 86400000).toISOString();
    const chats = await call(cfg, 'GET', '/chats', { query: { account_id: cfg.account_id, limit: 50, after: since } });
    const known = await db.query(
      `SELECT id, provider_id, chat_id FROM prospects WHERE workspace_id = $1 AND (chat_id IS NOT NULL OR provider_id IS NOT NULL)`,
      [account.workspace_id],
    );
    const byChat = new Map(known.rows.filter((r) => r.chat_id).map((r) => [r.chat_id, r.id]));
    const byProv = new Map(known.rows.filter((r) => r.provider_id).map((r) => [r.provider_id, r.id]));
    let newest = since;
    for (const chat of itemsOf(chats)) {
      const prospectId = byChat.get(chat.id) || byProv.get(chat.attendee_provider_id);
      if (!prospectId) continue;
      const msgs = await call(cfg, 'GET', `/chats/${encodeURIComponent(chat.id)}/messages`, { query: { limit: 20 } });
      for (const m of itemsOf(msgs)) {
        const at = m.timestamp || m.date;
        if (!at || at <= since) continue;
        if (at > newest) newest = at;
        if (m.is_sender === 1 || m.is_sender === true) continue;
        if (!m.text) continue;
        events.push({ type: 'message', prospect_id: prospectId, chat_id: chat.id, text: m.text, at, provider_message_id: m.id });
      }
    }
    events.push({ type: 'state', sync_state: { ...state, messages_since: newest } });
    return events;
  },
};
