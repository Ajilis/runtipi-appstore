import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../server/lib/http.js';
import { hashPassword } from '../server/lib/crypto.js';
import { makeAuth } from '../server/routes/auth.js';

const passwordHash = hashPassword('mot-de-passe-actuel-123');

function setup() {
  const user = {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Ancien nom', email: 'ancien@example.fr',
    password_hash: passwordHash, is_admin: true,
  };
  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT password_hash FROM users')) {
        return { rows: [{ password_hash: user.password_hash }] };
      }
      if (sql.startsWith('UPDATE users SET name')) {
        const [, name, email] = params;
        if (email === 'occupe@example.fr') {
          const err = new Error('duplicate key'); err.code = '23505'; throw err;
        }
        Object.assign(user, { name, email });
        return { rows: [{ id: user.id, name: user.name, email: user.email }] };
      }
      throw new Error('Unexpected SQL: ' + sql);
    },
  };
  const router = new Router();
  makeAuth({ db, config: {}, agent: {} }).register(router);
  const endpoint = router.match('PATCH', '/api/me/profile');
  assert.ok(endpoint);
  const handler = endpoint.route.handlers.at(-1);
  const invoke = (body) => handler({
    state: { user: { id: user.id, name: user.name, email: user.email } },
    json: async () => body,
  });
  return { user, queries, invoke };
}

test('modifier uniquement le nom ne requiert pas de mot de passe ni de nouveau compte', async () => {
  const { user, queries, invoke } = setup();
  const oldId = user.id;
  const result = await invoke({ name: '  Nouveau nom  ', email: user.email });
  assert.deepEqual(result, {
    user: { id: oldId, name: 'Nouveau nom', email: 'ancien@example.fr' },
    email_changed: false,
  });
  assert.equal(user.id, oldId);
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0].sql, /DELETE FROM sessions|password_hash/);
});

test('modifier l’adresse e-mail exige le mot de passe actuel et normalise l’adresse', async () => {
  const { user, queries, invoke } = setup();
  await assert.rejects(
    () => invoke({ email: 'nouveau@example.fr', name: user.name }),
    /Mot de passe actuel incorrect/,
  );
  assert.equal(user.email, 'ancien@example.fr');
  const result = await invoke({
    name: '  Nouveau nom  ',
    email: '  NOUVEAU@EXAMPLE.FR  ',
    current_password: 'mot-de-passe-actuel-123',
  });
  assert.equal(result.user.name, 'Nouveau nom');
  assert.equal(result.user.email, 'nouveau@example.fr');
  assert.equal(result.email_changed, true);
  assert.equal(queries.filter((q) => q.sql.startsWith('UPDATE users SET name')).length, 1);
  assert.equal(queries.some((q) => /DELETE FROM (sessions|memberships)/.test(q.sql)), false);
});

test('les adresses déjà utilisées sont refusées sans modifier les identifiants', async () => {
  const { user, invoke } = setup();
  await assert.rejects(
    () => invoke({ name: 'Nouveau', email: 'occupe@example.fr', current_password: 'mot-de-passe-actuel-123' }),
    /Cette adresse e-mail est déjà utilisée/,
  );
  assert.equal(user.email, 'ancien@example.fr');
  assert.equal(user.name, 'Ancien nom');
});

test('valide les champs et ne laisse pas le mot de passe modifier le compte en cas de saisie invalide', async () => {
  const { user, queries, invoke } = setup();
  for (const data of [
    { name: ' ', email: user.email },
    { name: 'A'.repeat(121), email: user.email },
    { name: 'Nom', email: 'invalide' },
    { name: 'Nom', email: 'x'.repeat(255) + '@example.fr' },
  ]) {
    await assert.rejects(() => invoke(data), /nom|e-mail/i);
  }
  assert.equal(queries.length, 0);
});

test('le formulaire réutilise la session existante et ne demande le mot de passe que pour un nouvel e-mail', async () => {
  const fs = await import('node:fs');
  const ui = fs.readFileSync(new URL('../web/src/pages/Settings.jsx', import.meta.url), 'utf8');
  const auth = fs.readFileSync(new URL('../server/routes/auth.js', import.meta.url), 'utf8');
  assert.match(ui, /api\/me\/profile/);
  assert.match(ui, /emailChanged &&/);
  assert.match(ui, /await refresh\(\)/);
  assert.ok(auth.includes('(password|profile)'));
  assert.match(auth, /requireAuth, async \(ctx\)/);
});
