import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Router } from '../server/lib/http.js';
import { makeVault } from '../server/lib/crypto.js';
import { AiService } from '../server/services/ai.js';
import { listOpenAIModels, normalizeOpenAIBaseUrl } from '../server/services/ai-models.js';
import { registerCore } from '../server/routes/core.js';

test('AI générique : normalise un endpoint /v1 personnalisé, Ollama local, rejette protocoles risqués', () => {
  assert.equal(normalizeOpenAIBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
  assert.equal(normalizeOpenAIBaseUrl('https://llm.example.fr/api/v1'), 'https://llm.example.fr/api/v1');
  assert.equal(normalizeOpenAIBaseUrl('http://ollama:11434/v1/'), 'http://ollama:11434/v1');
  assert.equal(normalizeOpenAIBaseUrl('http://192.168.1.40:1234/v1'), 'http://192.168.1.40:1234/v1');
  for (const url of [
    '', 'file:///etc/passwd', 'ftp://api.example.com/v1', 'http://api.example.com/v1',
    'http://169.254.169.254/v1', 'https://someone:password@api.example.com/v1',
    'https://api.example.com/v1?token=secret', 'https://api.example.com/v1#fragment',
    'https://api.example.com//v1', 'https://api.example.com/v1%2Fmodels',
  ]) assert.throws(() => normalizeOpenAIBaseUrl(url), /URL/, url);
});

test('GET /models : liste standard compatible OpenAI, clé Bearer facultative, tri/dédoublonnage', async () => {
  const called = [];
  const fetcher = async (url, opts) => {
    called.push({ url, opts });
    return { status: 200, ok: true, json: async () => ({ object: 'list', data: [
      { id: 'generic-7b' }, { id: 'other-chat' }, { id: 'generic-7b' },
      { id: '' }, { id: 47 }, { nope: true },
    ] }) };
  };
  assert.deepEqual(await listOpenAIModels({
    baseUrl: 'https://model.local.test/v1',
    apiKey: 'secret-test-876', fetcher,
  }), ['generic-7b', 'other-chat']);
  assert.equal(called[0].url, 'https://model.local.test/v1/models');
  assert.equal(called[0].opts.headers.Authorization, 'Bearer secret-test-876');
  assert.equal(called[0].opts.redirect, 'error');
  assert.equal(called[0].opts.method, 'GET');
  assert.deepEqual(await listOpenAIModels({
    baseUrl: 'http://ollama:11434/v1', fetcher,
  }), ['generic-7b', 'other-chat']);
  assert.equal(called[1].url, 'http://ollama:11434/v1/models');
  assert.equal(called[1].opts.headers.Authorization, undefined);
});

test('GET /models : erreurs explicites sans fuite de clé ou de réponse brute', async () => {
  for (const [status, message] of [
    [401, /Clé API IA refusée/], [403, /Clé API IA refusée/],
    [404, /saisissez le nom du modèle manuellement/], [429, /Limite de requêtes/],
    [503, /HTTP 503/],
  ]) await assert.rejects(() => listOpenAIModels({
    baseUrl: 'https://my-llm.test/v1', apiKey: 'confidential-secret',
    fetcher: async () => ({ ok: false, status, json: async () => ({ error: 'confidential-secret' }) }),
  }), message);
  await assert.rejects(() => listOpenAIModels({
    baseUrl: 'https://my-llm.test/v1',
    fetcher: async () => ({ ok: true, status: 200, json: async () => ({ models: [] }) }),
  }), /Format des modèles incompatible/);
  await assert.rejects(() => listOpenAIModels({
    baseUrl: 'https://my-llm.test/v1', apiKey: 'sensitive-secret',
    fetcher: async () => { throw Error('sensitive-secret network trace'); },
  }), /Serveur IA inaccessible/);
});

test('AI générique : une véritable requête POST /chat/completions envoie le modèle et les messages', async () => {
  const calls = [];
  const ai = new AiService({
    config: { ai: { provider: 'none' } }, vault: makeVault('ai-unit-secret'),
    fetcher: async (url, opts) => {
      calls.push({ url, opts });
      return { status: 200, ok: true, json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'OK' } }],
      }) };
    },
  });
  const ws = { settings: { ai: { provider: 'none' } } };
  const testResult = await ai.test(ws, { settingsOverride: {
    provider: 'openai', base_url: 'https://generique.example.fr/api/v1',
    model: 'chat-model-personnalise', api_key: 'private-123',
    temperature: 0.7,
  } });
  assert.equal(testResult.ok, true);
  assert.equal(testResult.sample, 'OK');
  assert.equal(calls[0].url, 'https://generique.example.fr/api/v1/chat/completions');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.redirect, 'error');
  assert.equal(calls[0].opts.headers.authorization, 'Bearer private-123');
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.model, 'chat-model-personnalise');
  assert.equal(sent.messages.length, 2);
  assert.equal(sent.messages[0].role, 'system');
  assert.equal(sent.messages[1].role, 'user');
  const local = new AiService({
    config: { ai: { provider: 'none' } }, vault: makeVault('keyless-local'),
    fetcher: async (url, opts) => {
      assert.equal(url, 'http://ollama:11434/v1/chat/completions');
      assert.equal(opts.headers.authorization, undefined);
      return { status: 200, ok: true, json: async () => ({ choices: [{ message: { content: 'Oui' } }] }) };
    },
  });
  assert.equal((await local.test(ws, { settingsOverride: {
    provider: 'openai', base_url: 'http://ollama:11434/v1', model: 'local-llm', api_key: '',
  } })).sample, 'Oui');
});

function appHarness() {
  const vault = makeVault('generic-openai-tests');
  const settings = { ai: {
    provider: 'openai', base_url: 'https://existing.example.com/v1',
    model: 'previous-model', temperature: 0.7, api_key_enc: vault.encrypt('previous-secret-111'),
  } };
  const ws = { id: 'ws-test', settings };
  const called = [], updates = [], remote = [];
  const ai = new AiService({
    config: { ai: { provider: 'none' } }, vault,
    fetcher: async (url, opts) => {
      remote.push({ url, opts });
      if (String(url).endsWith('/models')) {
        return { ok: true, status: 200, json: async () => ({ data: [
          { id: 'current-chat-v1' }, { id: 'current-chat-v2' },
        ] }) };
      }
      return { ok: true, status: 200, json: async () => ({
        choices: [{ message: { content: 'OK' } }],
      }) };
    },
  });
  const db = { async query(sql, params) {
    called.push({ sql, params });
    if (sql.startsWith('UPDATE workspaces SET settings = $2')) {
      ws.settings = JSON.parse(params[1]);
      updates.push(params[1]);
      return { rows: [] };
    }
    throw Error('Unexpected SQL: ' + sql);
  } };
  const router = new Router();
  registerCore(router, {
    db, vault, ai, agent: { workspace: async () => ws, publicUrl: () => '' },
    config: { ai: { provider: 'none' }, limits: {} },
  }, {
    requireAuth: async (ctx) => { ctx.state.ws = ws; ctx.state.user = { id: 'user-1' }; },
    requireAdmin: async () => {},
  });
  const invoke = async (method, pathname, body = {}) => {
    const match = router.match(method, pathname);
    assert.ok(match, pathname);
    const ctx = { state: {}, query: {}, json: async () => body, params: match.params };
    let result;
    for (const fn of match.route.handlers) result = await fn(ctx);
    return result;
  };
  return { ws, called, updates, vault, ai, remote, invoke };
}

test('API : /models et /test travaillent sur le brouillon et ne changent aucun réglage existant', async () => {
  const h = appHarness();
  const preview = { provider: 'openai', base_url: 'https://other.example.net/v1',
    model: 'current-chat-v1', api_key: 'new-private-key' };
  const list = await h.invoke('POST', '/api/settings/ai/models', preview);
  assert.deepEqual(list.models, ['current-chat-v1', 'current-chat-v2']);
  assert.equal(list.total, 2);
  assert.equal(h.remote[0].opts.headers.Authorization, 'Bearer new-private-key');
  const testResult = await h.invoke('POST', '/api/settings/ai/test', preview);
  assert.equal(testResult.sample, 'OK');
  assert.equal(h.remote[1].opts.headers.authorization, 'Bearer new-private-key');
  assert.equal(h.updates.length, 0, 'GET models et le test ne doivent jamais écrire en base');
  assert.equal(h.ws.settings.ai.model, 'previous-model');
  assert.equal(h.vault.decrypt(h.ws.settings.ai.api_key_enc), 'previous-secret-111');
  assert.doesNotMatch(JSON.stringify(list), /new-private-key|previous-secret-111/);
});

test('API : URL différente ne réutilise jamais une ancienne clé, et lecture ne divulgue aucun ciphertext', async () => {
  const h = appHarness();
  const models = await h.invoke('POST', '/api/settings/ai/models', {
    provider: 'openai', base_url: 'https://another-provider.example.fr/v1',
  });
  assert.equal(models.total, 2);
  assert.equal(h.remote[0].opts.headers.Authorization, undefined);
  const masked = await h.invoke('GET', '/api/settings');
  assert.equal(masked.settings.ai.has_api_key, true);
  assert.equal(Object.hasOwn(masked.settings.ai, 'api_key_enc'), false);
  assert.doesNotMatch(JSON.stringify(masked), /previous-secret-111/);
  await h.invoke('PATCH', '/api/settings', { ai: {
    provider: 'openai', base_url: 'https://another-provider.example.fr/v1',
    model: 'current-chat-v2', temperature: 0.3,
  } });
  assert.equal(h.ws.settings.ai.api_key_enc, '');
  assert.equal(h.ws.settings.ai.model, 'current-chat-v2');
  assert.equal(h.ws.settings.ai.base_url, 'https://another-provider.example.fr/v1');
  assert.equal(h.updates.length, 1);
});

test('API : clé sauvegardée conservée à URL identique et chiffrée en remplacement', async () => {
  const h = appHarness();
  const fromSaved = await h.invoke('POST', '/api/settings/ai/models', {
    provider: 'openai', base_url: 'https://existing.example.com/v1',
  });
  assert.equal(fromSaved.total, 2);
  assert.equal(h.remote[0].opts.headers.Authorization, 'Bearer previous-secret-111');
  const saved = h.ws.settings.ai.api_key_enc;
  await h.invoke('PATCH', '/api/settings', { ai: {
    provider: 'openai', base_url: 'https://existing.example.com/v1',
    model: 'current-chat-v1',
  } });
  assert.equal(h.ws.settings.ai.api_key_enc, saved);
  await h.invoke('PATCH', '/api/settings', { ai: {
    provider: 'openai', base_url: 'https://existing.example.com/v1',
    model: 'current-chat-v1', api_key: 'replacement-secret-222',
  } });
  assert.equal(h.vault.decrypt(h.ws.settings.ai.api_key_enc), 'replacement-secret-222');
  assert.doesNotMatch(h.updates[1], /replacement-secret-222/);
});

test('UI : bouton de modèles, liste déroulante, test non destructif, sauvegarde explicite', () => {
  const src = fs.readFileSync(new URL('../web/src/pages/Settings.jsx', import.meta.url), 'utf8');
  assert.match(src, /OpenAI compatible \(serveur personnalisé\)/);
  assert.match(src, /Récupérer la liste des modèles/);
  assert.match(src, /Sélectionner un modèle récupéré/);
  assert.match(src, /availableModels\.map/);
  assert.match(src, /api\/settings\/ai\/models/);
  assert.match(src, /api\/settings\/ai\/test/);
  assert.match(src, /Tester la connexion \(sans enregistrer\)/);
  assert.match(src, /Configuration IA enregistrée/);
});
