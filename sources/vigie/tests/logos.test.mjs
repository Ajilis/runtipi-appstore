import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, client } from './helpers.mjs';
import { sniffImage, safeUrl, parseIconLinks, fetchLogo, loadCatalogue } from '../server/logos.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]);
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0]), Buffer.alloc(300, 1)]);

// Faux Internet : chaque URL renvoie la réponse décrite (statut, contenu, adresse finale après redirection).
function fakeWeb(routes, calls = []) {
  return async (url) => {
    calls.push(url);
    const r = routes[url];
    if (!r) return new Response('introuvable', { status: 404 });
    const res = new Response(r.body, { status: r.status || 200, headers: r.headers || {} });
    if (r.finalUrl) Object.defineProperty(res, 'url', { value: r.finalUrl });
    return res;
  };
}

test('reconnaissance des images et adresses autorisées', () => {
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(ICO), 'image/x-icon');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffImage(Buffer.from('<!doctype html><html>…</html>')), null);
  assert.ok(safeUrl('https://www.banque.fr/icon.png'));
  for (const bad of ['http://www.banque.fr/', 'https://127.0.0.1/', 'https://10.0.0.5/x', 'https://localhost/', 'https://nas.local/', 'https://[::1]/', 'file:///etc/passwd', 'https://user:pass@banque.fr/']) {
    assert.equal(safeUrl(bad), null, bad);
  }
});

test('icônes déclarées par la page : apple-touch-icon et plus grande taille en premier, SVG ignorés', () => {
  const html = `<head>
    <link rel="icon" href="/favicon-16.png" sizes="16x16">
    <link rel="icon" type="image/svg+xml" href="/logo.svg">
    <link rel="icon" href="/favicon-96.png" sizes="96x96">
    <link rel='apple-touch-icon' href='/static/apple.png'>
    <link rel="mask-icon" href="/safari.svg">
    <link rel="stylesheet" href="/x.css">
    <link rel="icon" href="http://cdn.banque.fr/insecure.png"></head>`;
  assert.deepEqual(parseIconLinks(html, 'https://www.banque.fr/accueil'), [
    'https://www.banque.fr/static/apple.png', 'https://www.banque.fr/favicon-96.png', 'https://www.banque.fr/favicon-16.png',
  ]);
});

test('récupération : apple-touch-icon, puis icône de la page, puis favicon.ico', async () => {
  const direct = await fetchLogo('www.a.fr', fakeWeb({ 'https://www.a.fr/apple-touch-icon.png': { body: PNG } }));
  assert.equal(direct.type, 'image/png');

  const viaPage = await fetchLogo('www.b.fr', fakeWeb({
    'https://www.b.fr/apple-touch-icon.png': { body: '<html>page introuvable</html>' }, // fausse page 200 : refusée
    'https://www.b.fr/': { body: '<link rel="icon" sizes="192x192" href="/img/logo-192.png">' },
    'https://www.b.fr/img/logo-192.png': { body: PNG },
  }));
  assert.equal(viaPage.type, 'image/png');

  const ico = await fetchLogo('www.c.fr', fakeWeb({ 'https://www.c.fr/favicon.ico': { body: ICO } }));
  assert.equal(ico.type, 'image/x-icon');

  assert.equal(await fetchLogo('www.d.fr', fakeWeb({})), null, 'aucune icône : monogramme');
});

test('récupération : redirections vers le réseau local et fichiers trop lourds refusés', async () => {
  const redirected = await fetchLogo('www.e.fr', fakeWeb({ 'https://www.e.fr/apple-touch-icon.png': { body: PNG, finalUrl: 'https://192.168.1.1/admin.png' } }));
  assert.equal(redirected, null);
  const huge = await fetchLogo('www.f.fr', fakeWeb({ 'https://www.f.fr/apple-touch-icon.png': { body: Buffer.concat([PNG, Buffer.alloc(400 * 1024)]) } }));
  assert.equal(huge, null);
  const lying = await fetchLogo('www.g.fr', fakeWeb({ 'https://www.g.fr/apple-touch-icon.png': { body: PNG, headers: { 'content-length': String(10 * 1024 * 1024) } } }));
  assert.equal(lying, null);
});

test('catalogue des établissements cohérent', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('../web/institutions.json', import.meta.url), 'utf8')).institutions;
  const cat = loadCatalogue();
  assert.equal(cat.size, raw.length, 'identifiants uniques');
  const names = new Set();
  for (const i of raw) {
    assert.match(i.id, /^[a-z0-9-]{1,40}$/, i.id);
    assert.ok(i.name && i.kind && Array.isArray(i.aliases), i.id);
    assert.ok(!names.has(i.name.toLowerCase()), `nom en double : ${i.name}`);
    names.add(i.name.toLowerCase());
    if (i.host !== null) assert.ok(safeUrl(`https://${i.host}/`), `site invalide : ${i.host}`);
  }
  assert.ok(raw.length >= 60);
});

let srv, admin, calls;
before(async () => {
  calls = [];
  srv = await startServer({}, { fetcher: fakeWeb({ 'https://www.boursobank.com/apple-touch-icon.png': { body: PNG } }, calls) });
  admin = client(srv.base);
  await admin.post('/api/auth/setup', { username: 'alex', first_name: 'Alex', last_name: 'Martin', password: 'motdepasse-solide-42' });
});
after(async () => { await srv.stop(); });

test('API : logo servi puis conservé en base, monogramme si indisponible', async () => {
  assert.equal((await client(srv.base).get('/api/institutions/logo/boursobank')).status, 401, 'connexion requise');
  const r = await admin.get('/api/institutions/logo/boursobank');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.match(r.headers.get('cache-control'), /max-age=604800/);
  assert.ok(Buffer.compare(r.data, PNG) === 0);
  const n = calls.length;
  await admin.get('/api/institutions/logo/boursobank');
  assert.equal(calls.length, n, 'deuxième affichage servi depuis la base, sans nouvelle requête');

  const none = await admin.get('/api/institutions/logo/fortuneo');
  assert.equal(none.status, 200);
  assert.match(none.headers.get('cache-control'), /max-age=600/, 'image transparente, nouvel essai plus tard');
  assert.ok(none.data.length < 100);
  assert.equal((await admin.get('/api/institutions/logo/inconnu')).status, 404);
  assert.equal((await admin.get('/api/institutions/logo/..%2F..%2Fetc')).status, 404);

  const before = calls.length;
  await admin.get('/api/institutions/logo/fortuneo');
  assert.equal(calls.length, before, 'échec mémorisé : pas de nouvel essai immédiat');
  const retry = await admin.post('/api/admin/logos/retry');
  assert.equal(retry.data.cleared, 1);
  assert.equal((await admin.get('/api/settings')).data.logos_enabled, true);
});

test('API : logos désactivés, aucune connexion sortante', async () => {
  const c = [];
  const s = await startServer({ INSTITUTION_LOGOS: false }, { fetcher: fakeWeb({ 'https://www.boursobank.com/apple-touch-icon.png': { body: PNG } }, c) });
  const a = client(s.base);
  await a.post('/api/auth/setup', { username: 'alex', first_name: 'Alex', last_name: 'Martin', password: 'motdepasse-solide-42' });
  const r = await a.get('/api/institutions/logo/boursobank');
  assert.ok(r.data.length < 100);
  assert.equal(c.length, 0);
  assert.equal((await a.get('/api/settings')).data.logos_enabled, false);
  await s.stop();
});
