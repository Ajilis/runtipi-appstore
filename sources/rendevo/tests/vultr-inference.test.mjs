import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AiService } from '../server/services/ai.js';
import { makeVault } from '../server/lib/crypto.js';
import { Router } from '../server/lib/http.js';
import { registerProspects } from '../server/routes/prospects.js';
import { listOpenAIModels, isVultrInferenceBaseUrl } from '../server/services/ai-models.js';
import { classifyAiGenerationFailure } from '../server/services/ai-diagnostics.js';

const endpoint = 'https://api.vultrinference.com/v1';
const model = 'deepseek-v4.1-flash';

test('Vultr URL recognizer: only the exact HTTPS provider /v1, no credentials sent to other hosts', () => {
  assert.equal(isVultrInferenceBaseUrl(endpoint), true);
  assert.equal(isVultrInferenceBaseUrl(endpoint + '/'), true);
  for (const value of [
    'https://api.vultrinference.com.evil.org/v1',
    'https://other.vultrinference.com/v1',
    'https://api.vultrinference.com/docs',
    'http://api.vultrinference.com/v1',
    'https://api.openai.com/v1',
    'http://ollama:11434/v1',
  ]) assert.equal(isVultrInferenceBaseUrl(value), false, value);
});

test('Vultr model picker uses documented text-only OpenRouter model catalog query', async () => {
  const requests = [];
  const models = await listOpenAIModels({
    baseUrl: endpoint, apiKey: 'private-vultr-key',
    fetcher: async (url, opts) => {
      requests.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ data: [
        { id: model }, { id: 'glm-5.3-flash' }, { id: model },
      ] }) };
    },
  });
  assert.deepEqual(models, [model, 'glm-5.3-flash']);
  assert.equal(requests[0].url,
    endpoint + '/models?format=openrouter&output_modalities=text');
  assert.equal(requests[0].opts.headers.Authorization, 'Bearer private-vultr-key');
  assert.equal(requests[0].opts.redirect, 'error');
});

test('Vultr structured generation: documented max_completion_tokens and no reasoning budget waste', async () => {
  const requests = [];
  const vault = makeVault('vultr-compatibility-safe');
  const ws = { settings: { ai: {
    provider: 'openai', base_url: endpoint, model, temperature: 0.5,
    api_key_enc: vault.encrypt('secret-in-db'),
  } } };
  const ai = new AiService({ config: { ai: { provider: 'none' } }, vault,
    fetcher: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({
        model,
        choices: [{ finish_reason: 'stop', message: {
          content: '{"rows":[{"category":"Direction","title":"Directeur commercial","variants":["Head of Sales"],"relation":"Métier associé"}]}',
          reasoning: null,
        } }],
      }) };
    },
  });
  const result = await ai.complete(ws, {
    system: 'Classe les métiers', user: 'Commercial', maxTokens: 1200,
    structured: true, temperature: 0.2, timeoutMs: 45000,
  });
  assert.match(result, /Directeur commercial/);
  assert.equal(requests[0].url, endpoint + '/chat/completions');
  assert.equal(requests[0].options.headers.authorization, 'Bearer secret-in-db');
  assert.equal(requests[0].options.redirect, 'error');
  const body = JSON.parse(requests[0].options.body);
  assert.deepEqual(body.reasoning, { enabled: false });
  assert.equal(body.max_completion_tokens, 1200);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.model, model);
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
  assert.doesNotMatch(result, /secret-in-db/);
});

test('Vultr regular AI generation does not disable reasoning for other task types', async () => {
  let request;
  const vault = makeVault('vultr-normal-task');
  const ai = new AiService({ config: { ai: { provider: 'none' } }, vault,
    fetcher: async (_url, opts) => {
      request = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({
        model, choices: [{ finish_reason: 'stop', message: { content: 'Bonjour' } }],
      }) };
    },
  });
  const result = await ai.complete({ settings: { ai: {
    provider: 'openai', base_url: endpoint, model,
  } } }, { system: 'Test', user: 'Bonjour', maxTokens: 350 });
  assert.equal(result, 'Bonjour');
  assert.equal(request.max_completion_tokens, 350);
  assert.equal(request.max_tokens, undefined);
  assert.equal(request.reasoning, undefined);
});

test('Generic OpenAI-compatible connector retains max_tokens and never sends Vultr-specific fields', async () => {
  let request;
  const ai = new AiService({ config: { ai: { provider: 'none' } },
    vault: makeVault('generic-preserved'),
    fetcher: async (_url, opts) => {
      request = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({
        model: 'generic-chat', choices: [{ message: { content: '{"rows":[]}' } }],
      }) };
    },
  });
  await ai.complete({ settings: { ai: {
    provider: 'openai', base_url: 'https://llm.example.com/v1', model: 'generic-chat',
  } } }, { system: 'Test', user: 'Test', maxTokens: 700, structured: true });
  assert.equal(request.max_tokens, 700);
  assert.equal(request.max_completion_tokens, undefined);
  assert.equal(request.reasoning, undefined);
});

test('Vultr silently substituted default model is refused (even when HTTP 200)', async () => {
  const vault = makeVault('vultr-model-check');
  const ws = { settings: { ai: {
    provider: 'openai', base_url: endpoint, model: 'misspelled-chat-model',
  } } };
  const ai = new AiService({ config: { ai: { provider: 'none' } }, vault,
    fetcher: async () => ({ ok: true, status: 200, json: async () => ({
      model,
      choices: [{ finish_reason: 'stop', message: { content: 'OK' } }],
    }) }),
  });
  await assert.rejects(() => ai.complete(ws, { system: 'Test', user: 'Test' }),
    /AI_MODEL_MISMATCH/);
  const diagnostic = classifyAiGenerationFailure(Error('AI_MODEL_MISMATCH'));
  assert.equal(diagnostic.code, 'AI_MODEL_MISMATCH');
  assert.equal(diagnostic.retryable, false);
  assert.doesNotMatch(diagnostic.message, /misspelled-chat-model/);
});

test('Vultr recognizes requested :express alias and reasoning tokens in response', async () => {
  const ai = new AiService({ config: { ai: { provider: 'none' } },
    vault: makeVault('vultr-express-mode'),
    fetcher: async () => ({ ok: true, status: 200, json: async () => ({
      model, usage: { completion_tokens_details: { reasoning_tokens: 37 } },
      choices: [{ finish_reason: 'stop', message: { reasoning: '...', content: 'Valid output' } }],
    }) }),
  });
  assert.equal(await ai.complete({ settings: { ai: {
    provider: 'openai', base_url: endpoint, model: model + ':express',
  } } }, { system: 'hello', user: 'hello' }), 'Valid output');
});

test('Vultr endpoint in stored workspace config triggers long-enough classification and no SQL writes', async () => {
  const vault = makeVault('vultr-route-test');
  const ws = { id: 'vultr-ws', settings: { ai: {
    provider: 'openai', base_url: endpoint, model, api_key_enc: vault.encrypt('saved-key'),
  } } };
  const options = [];
  const ai = new AiService({ config: { ai: { provider: 'none' } }, vault,
    fetcher: async (_url, opts) => {
      options.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({
        model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
          rows: [{ category: 'Direction', title: 'Directeur commercial',
            variants: ['Directrice commerciale'], relation: 'Direct' }],
        }) } }],
      }) };
    },
  });
  const router = new Router();
  registerProspects(router, {
    db: { query: async () => { throw Error('Unexpected mutation'); } },
    ai, agent: {}, vault,
  }, { requireAuth: async (ctx) => {
    ctx.state.ws = ws; ctx.state.user = { id: 'reader' };
  }, requireAdmin: async () => {} });
  const match = router.match('POST', '/api/discovery/job-titles');
  const ctx = { state: {}, json: async () => ({ keyword: 'commercial' }), header: () => {} };
  let result;
  for (const fn of match.route.handlers) result = await fn(ctx);
  assert.equal(result.rows[0].title, 'Directeur commercial');
  assert.equal(options[0].max_completion_tokens, 1200);
  assert.deepEqual(options[0].reasoning, { enabled: false });
});

test('Vultr model preset is exposed in the AI settings UI', () => {
  const src = fs.readFileSync(new URL('../web/src/pages/Settings.jsx', import.meta.url), 'utf8');
  assert.match(src, /Vultr Serverless Inference/);
  assert.ok(src.includes('https://api.vultrinference.com/v1'));
});
