import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Router } from '../server/lib/http.js';
import { registerCore, validateCampaignName } from '../server/routes/core.js';

test('le renommage normalise le texte et refuse un titre vide ou invalide', () => {
  assert.equal(validateCampaignName('  Campagne grands comptes  '), 'Campagne grands comptes');
  assert.equal(validateCampaignName('x'.repeat(120)).length, 120);
  for (const name of ['', '   ', 'x'.repeat(121), 'Nom\nmalveillant', 12, null]) {
    assert.throws(() => validateCampaignName(name), /nom de la campagne/i);
  }
});

test('la route de renommage ne modifie que le nom de la campagne dans son espace', async () => {
  const saved = { id: 'camp-1', workspace_id: 'ws-1', name: 'Ancienne campagne', goal: 'meeting' };
  const queries = [];
  const db = { async query(sql, params = []) {
    queries.push({ sql, params });
    if (sql.startsWith('SELECT * FROM campaigns WHERE id =')) {
      return { rows: saved.id === params[0] && saved.workspace_id === params[1] ? [{ ...saved }] : [] };
    }
    if (sql.startsWith('UPDATE campaigns SET name = $2, updated_at = now()')) {
      assert.equal(params[2], 'ws-1');
      saved.name = params[1];
      return { rows: [{ id: saved.id, name: saved.name }] };
    }
    throw new Error('SQL inattendue : ' + sql);
  } };
  const router = new Router();
  registerCore(router, { db, config: {}, agent: {} }, { requireAuth: async () => {}, requireAdmin: async () => {} });
  const route = router.match('PATCH', '/api/campaigns/camp-1/name');
  assert.ok(route);
  assert.equal(route.route.handlers.length, 3);
  const handler = route.route.handlers.at(-1);
  const context = (workspace, name) => ({
    state: { ws: { id: workspace } },
    params: { id: 'camp-1' },
    json: async () => ({ name }),
  });
  assert.deepEqual(await handler(context('ws-1', '  Nouvelle campagne  ')), { id: 'camp-1', name: 'Nouvelle campagne' });
  assert.equal(saved.goal, 'meeting');
  await assert.rejects(() => handler(context('ws-2', 'Interdite')), /introuvable/i);
  await assert.rejects(() => handler(context('ws-1', '  ')), /nom de la campagne/i);
  assert.equal(queries.filter((q) => q.sql.startsWith('UPDATE campaigns')).length, 1);
});

test('l’interface propose le renommage en liste et les versions app et Companion', () => {
  const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(read('../web/src/pages/Campaigns.jsx'), /Modifier la campagne/);
  assert.match(read('../web/src/pages/Campaigns.jsx'), /\/api\/campaigns\/\$\{rename.id\}\/name/);
  assert.match(read('../web/src/pages/Auth.jsx'), /auth\.version/);
  assert.match(read('../web/src/main.jsx'), /session\.version/);
  assert.match(read('../web/src/pages/Settings.jsx'), /latestCompanion\.extension_version/);
  assert.match(read('../web/src/components/CompanionSettings.jsx'), /device\.extension_version/);
});
