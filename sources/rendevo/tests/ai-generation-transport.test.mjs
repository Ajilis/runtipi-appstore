import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiService } from '../server/services/ai.js';
import { classifyAiGenerationFailure } from '../server/services/ai-diagnostics.js';
import { Router } from '../server/lib/http.js';
import { makeVault } from '../server/lib/crypto.js';
import { registerProspects } from '../server/routes/prospects.js';

function networkError(code, message = 'fetch failed') {
  const error = new TypeError(message);
  error.cause = Object.assign(new Error('network diagnostics must remain private'), { code });
  return error;
}

test('diagnostics : erreurs réseau, DNS, TLS, timeout et socket, codes sûrs sans données privées', () => {
  for (const [error, code, retry] of [
    [networkError('UND_ERR_SOCKET'), 'AI_CONNECTION_RESET', true],
    [networkError('ECONNRESET'), 'AI_CONNECTION_RESET', true],
    [networkError('ENOTFOUND'), 'AI_DNS', false],
    [networkError('ECONNREFUSED'), 'AI_CONNECTION_REFUSED', false],
    [networkError('DEPTH_ZERO_SELF_SIGNED_CERT'), 'AI_TLS', false],
    [networkError('UND_ERR_CONNECT_TIMEOUT'), 'AI_TIMEOUT', true],
    [Object.assign(Error('Aborted'), { name: 'AbortError' }), 'AI_TIMEOUT', true],
    [Error('AI_OUTPUT_TRUNCATED'), 'AI_OUTPUT_TRUNCATED', true],
    [Error('AI_EMPTY_CONTENT'), 'AI_EMPTY_CONTENT', true],
    [Error('LLM HTTP 429: secret-from-provider'), 'AI_RATE_LIMIT', false],
    [Error('LLM HTTP 503: secret-from-provider'), 'AI_HTTP_503', true],
    [Error('LLM HTTP 400: secret-from-provider'), 'AI_PARAMETERS', false],
  ]) {
    const result = classifyAiGenerationFailure(error);
    assert.equal(result.code, code);
    assert.equal(result.retryable, retry);
    assert.doesNotMatch(result.message, /secret-from-provider|network diagnostics must remain private/);
  }
});

test('AiService : détecte finish_reason=length et autorise les blocs de texte compatibles', async () => {
  const config = { ai: { provider: 'none' } };
  const ws = { settings: { ai: { provider: 'openai', model: 'custom', base_url: 'https://chat.example.fr/v1' } } };
  const failed = new AiService({ config, vault: makeVault('title-unit-v33'),
    fetcher: async () => ({ ok: true, status: 200, json: async () => ({
      choices: [{ finish_reason: 'length', message: { content: null } }],
    }) }),
  });
  await assert.rejects(() => failed.complete(ws, { system: 'test', user: 'test', maxTokens: 500 }),
    /AI_OUTPUT_TRUNCATED/);
  const parts = new AiService({ config, vault: makeVault('title-parts-v33'),
    fetcher: async () => ({ ok: true, status: 200, json: async () => ({
      choices: [{ finish_reason: 'stop', message: { content: [
        { type: 'text', text: 'Bonjour' }, { type: 'text', text: ' le monde' },
      ] } }],
    }) }),
  });
  const text = await parts.complete(ws, { system: 'test', user: 'test' });
  assert.equal(text, 'Bonjour le monde');
});

function routeWithFetcher(fetcher) {
  const secret = 'private-model-api-key-never-expose';
  const vault = makeVault('v33-test-secret');
  const ws = { id: 'v33-ws', settings: { ai: {
    provider: 'openai', model: 'local-custom', base_url: 'https://llm.example.fr/v1',
    api_key_enc: vault.encrypt(secret),
  } } };
  const ai = new AiService({ config: { ai: { provider: 'none' } }, vault, fetcher });
  const router = new Router();
  const db = { query() { throw Error('No database writes during title classification'); } };
  registerProspects(router, { db, ai, agent: {}, vault }, {
    requireAuth: async (ctx) => { ctx.state.ws = ws; ctx.state.user = { id: 'v33-user' }; },
    requireAdmin: async () => {},
  });
  const match = router.match('POST', '/api/discovery/job-titles');
  const invoke = async () => {
    const ctx = { state: {}, json: async () => ({ keyword: 'Directeur commercial' }),
      header: () => {} };
    let result;
    for (const handler of match.route.handlers) result = await handler(ctx);
    return result;
  };
  return { invoke, secret };
}

test('baguette magique : coupure de socket avant le premier résultat -> nouvelle requête plus courte et résultat utilisable', async () => {
  const requests = [];
  const { invoke, secret } = routeWithFetcher(async (url, opts) => {
    requests.push({ url, opts });
    if (requests.length === 1) throw networkError('UND_ERR_SOCKET');
    return { ok: true, status: 200, json: async () => ({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ rows: [{
        category: 'Direction', title: 'Directeur commercial',
        variants: ['Directrice commerciale', 'Head of Sales'], relation: 'Fonction actuelle',
      }] }) } }],
    }) };
  });
  const response = await invoke();
  assert.equal(response.rows.length, 1);
  assert.equal(response.rows[0].title, 'Directeur commercial');
  assert.equal(requests.length, 2);
  assert.ok(requests.every((req) => req.url === 'https://llm.example.fr/v1/chat/completions'));
  const first = JSON.parse(requests[0].opts.body);
  const second = JSON.parse(requests[1].opts.body);
  assert.equal(first.max_tokens, 1200);
  assert.equal(second.max_tokens, 700);
  assert.ok(second.messages[1].content.length < first.messages[1].content.length);
  assert.equal(requests[0].opts.headers.authorization, 'Bearer ' + secret);
  assert.doesNotMatch(JSON.stringify(response), /private-model-api-key-never-expose/);
});

test('baguette magique : épuisement de tokens -> tentative courte et retour structuré', async () => {
  let attempts = 0;
  const { invoke } = routeWithFetcher(async () => {
    attempts++;
    if (attempts === 1) return { ok: true, status: 200, json: async () => ({
      choices: [{ finish_reason: 'length', message: { content: '' } }],
    }) };
    return { ok: true, status: 200, json: async () => ({
      choices: [{ finish_reason: 'stop', message: { content:
        '{"rows":[{"category":"Direction","title":"Directeur commercial","variants":["Head of Sales"],"relation":"Direct"}]}' } }],
    }) };
  });
  const result = await invoke();
  assert.equal(result.rows[0].title, 'Directeur commercial');
  assert.equal(attempts, 2);
});

test('baguette magique : refus DNS ne réessaye pas et renvoie un code stable, sans clé', async () => {
  let attempts = 0;
  const { invoke, secret } = routeWithFetcher(async () => {
    attempts++;
    throw networkError('ENOTFOUND', 'fetch failed secret ' + secret);
  });
  await assert.rejects(() => invoke(), (error) => {
    assert.match(error.message, /AI_DNS/);
    assert.match(error.message, /DNS|résoudre/);
    assert.doesNotMatch(error.message, /private-model-api-key-never-expose/);
    return true;
  });
  assert.equal(attempts, 1);
});

test('baguette magique : deux interruptions successives produisent un diagnostic réseau spécifique', async () => {
  let attempts = 0;
  const { invoke } = routeWithFetcher(async () => {
    attempts++;
    throw networkError('ECONNRESET');
  });
  await assert.rejects(() => invoke(), /AI_CONNECTION_RESET/);
  assert.equal(attempts, 2);
});
