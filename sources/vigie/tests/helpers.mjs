// Démarre une instance Vigie isolée (dossier de données temporaire) et fournit un client HTTP avec cookies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function startServer(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-test-'));
  process.env.DATA_DIR = dir;
  const { loadConfig, paths } = await import(`../server/config.js?dir=${encodeURIComponent(dir)}`);
  const { createApp, createLogger } = await import('../server/app.js');
  const { cfg } = loadConfig();
  Object.assign(cfg, { APP_SECRET: 'test-secret-'.padEnd(64, 'x'), VERSION: 'test' }, overrides);
  const app = createApp({ cfg, paths, log: createLogger('error'), withScheduler: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    base, cfg, paths, app, dir,
    async stop() { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

export function client(base, defaultHeaders = {}) {
  const jar = new Map();
  async function call(method, url, body, headers = {}) {
    const h = { 'x-vigie-request': '1', ...defaultHeaders, ...headers };
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const [k, v] = pair.split('=');
      if (attrs.some((a) => /max-age=0/i.test(a.trim()))) jar.delete(k.trim()); else jar.set(k.trim(), v);
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  return {
    jar,
    get: (u, h) => call('GET', u, undefined, h),
    post: (u, b = {}, h) => call('POST', u, b, h),
    put: (u, b = {}, h) => call('PUT', u, b, h),
    patch: (u, b = {}, h) => call('PATCH', u, b, h),
    del: (u, h) => call('DELETE', u, {}, h),
  };
}
