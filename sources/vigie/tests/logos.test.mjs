import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, client } from './helpers.mjs';
import { sniffImage, safeUrl, parseIconLinks, parseIconCandidates, parseManifestLink, parseManifestIcons, imageSize, fetchLogo, loadCatalogue, LogoService } from '../server/logos.js';
import { openDatabase } from '../server/db.js';
import os from 'node:os';
import path from 'node:path';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]);
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0]), Buffer.alloc(300, 1)]);
// En-tête PNG réel (signature + IHDR) aux dimensions voulues, complété pour dépasser 64 octets.
function png(w, h) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'ascii'); ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12); ihdr[16] = 8; ihdr[17] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(120, 3)]);
}
function ico(sizes) {
  const head = Buffer.from([0, 0, 1, 0, sizes.length, 0]);
  const entries = sizes.map((s) => { const e = Buffer.alloc(16); e[0] = s % 256; e[1] = s % 256; return e; });
  return Buffer.concat([head, ...entries, Buffer.alloc(80, 1)]);
}

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
  const huge = await fetchLogo('www.f.fr', fakeWeb({ 'https://www.f.fr/apple-touch-icon.png': { body: Buffer.concat([PNG, Buffer.alloc(600 * 1024)]) } }));
  assert.ok(huge === null, 'fichier de plus de 512 Ko refusé');
  const lying = await fetchLogo('www.g.fr', fakeWeb({ 'https://www.g.fr/apple-touch-icon.png': { body: PNG, headers: { 'content-length': String(10 * 1024 * 1024) } } }));
  assert.equal(lying, null);
});

test('dimensions lues dans l\'en-tête des images', () => {
  assert.deepEqual(imageSize(png(180, 180)), { width: 180, height: 180 });
  assert.deepEqual(imageSize(ico([16, 32, 0])), { width: 256, height: 256 }, '0 vaut 256 dans un .ico');
  assert.deepEqual(imageSize(ico([16, 48])), { width: 48, height: 48 });
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([64, 0, 32, 0]), Buffer.alloc(60)]);
  assert.deepEqual(imageSize(gif), { width: 64, height: 32 });
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 120, 0, 200]), Buffer.alloc(60)]);
  assert.deepEqual(imageSize(jpeg), { width: 200, height: 120 });
  const webp = Buffer.alloc(40);
  webp.write('RIFF', 0, 'ascii'); webp.write('WEBP', 8, 'ascii'); webp.write('VP8X', 12, 'ascii'); webp.writeUIntLE(191, 24, 3); webp.writeUIntLE(191, 27, 3);
  assert.deepEqual(imageSize(webp), { width: 192, height: 192 });
  assert.equal(imageSize(PNG), null, 'en-tête illisible');
});

test('manifeste du site, tuile Windows et icônes intégrées à la page', () => {
  const html = `<link rel="manifest" href="/site.webmanifest"><meta name="msapplication-TileImage" content="/mstile-144.png">
    <link rel="icon" href="data:image/png;base64,${png(64, 64).toString('base64')}">`;
  assert.equal(parseManifestLink(html, 'https://www.banque.fr/'), 'https://www.banque.fr/site.webmanifest');
  const c = parseIconCandidates(html, 'https://www.banque.fr/');
  assert.ok(c.some((x) => x.url === 'https://www.banque.fr/mstile-144.png'));
  const inline = c.find((x) => x.data);
  assert.deepEqual(imageSize(inline.data), { width: 64, height: 64 });
  const icons = parseManifestIcons(JSON.stringify({ icons: [
    { src: 'icons/192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/512.png', sizes: '512x512', purpose: 'maskable' },
    { src: 'icons/mono.png', sizes: '192x192', purpose: 'monochrome' },
    { src: 'icons/logo.svg', sizes: 'any', type: 'image/svg+xml' },
  ] }), 'https://www.banque.fr/site.webmanifest');
  assert.deepEqual(icons.sort((a, b) => b.score - a.score).map((i) => i.url), ['https://www.banque.fr/icons/192.png', 'https://www.banque.fr/icons/512.png']);
  assert.deepEqual(parseManifestIcons('{pas du json', 'https://www.banque.fr/'), []);
});

test('récupération : la plus nette des icônes déclarées, petite icône gardée faute de mieux', async () => {
  const calls = [];
  const best = await fetchLogo('www.h.fr', fakeWeb({
    'https://www.h.fr/': { body: '<link rel="icon" href="/favicon-32.png" sizes="32x32"><link rel="manifest" href="/m.json">' },
    'https://www.h.fr/m.json': { body: JSON.stringify({ icons: [{ src: '/i/192.png', sizes: '192x192' }, { src: '/i/512.png', sizes: '512x512' }] }) },
    'https://www.h.fr/i/192.png': { body: png(192, 192) },
    'https://www.h.fr/i/512.png': { body: png(512, 512) },
    'https://www.h.fr/favicon-32.png': { body: png(32, 32) },
  }, calls));
  assert.equal(best.width, 192, 'icône de 192 px choisie');
  assert.match(best.source, /192\.png$/);
  assert.ok(!calls.includes('https://www.h.fr/favicon-32.png'), 'arrêt dès une icône nette');

  const small = await fetchLogo('www.i.fr', fakeWeb({
    'https://www.i.fr/': { body: '<link rel="apple-touch-icon" href="/apple.png">' },
    'https://www.i.fr/apple.png': { body: png(57, 57) },
    'https://www.i.fr/favicon.ico': { body: ico([16, 48]) },
  }));
  assert.equal(small.width, 57, 'la plus grande des petites icônes');

  const inline = await fetchLogo('www.j.fr', fakeWeb({ 'https://www.j.fr/': { body: `<link rel="icon" sizes="152x152" href="data:image/png;base64,${png(152, 152).toString('base64')}">` } }));
  assert.equal(inline.width, 152);
  assert.equal(inline.source, 'icône intégrée à la page');
});

test('dernier recours : service d\'icônes Google si le site bloque ou n\'offre qu\'une petite icône', async () => {
  const blocked = { 'https://www.k.fr/': { status: 403, body: 'refusé' } };
  assert.equal(await fetchLogo('www.k.fr', fakeWeb(blocked)), null, 'désactivé par défaut');
  const calls = [];
  const viaGoogle = await fetchLogo('www.k.fr', fakeWeb({ ...blocked, 'https://www.google.com/s2/favicons?domain=www.k.fr&sz=256': { body: png(180, 180), finalUrl: 'https://t1.gstatic.com/faviconV2?url=https://www.k.fr&size=256' } }, calls), { fallback: true });
  assert.equal(viaGoogle.width, 180);
  assert.equal(viaGoogle.source, "service d'icônes Google");
  assert.ok(calls.every((u) => /^https:\/\/(www\.k\.fr|www\.google\.com)\//.test(u)), 'seul le domaine de l\'établissement est transmis');

  const smallSite = { 'https://www.l.fr/favicon.ico': { body: ico([16]) } };
  const better = await fetchLogo('www.l.fr', fakeWeb({ ...smallSite, 'https://www.google.com/s2/favicons?domain=www.l.fr&sz=256': { body: png(128, 128) } }), { fallback: true });
  assert.equal(better.width, 128, 'icône Google plus nette que le favicon de 16 px');
  const unknown = await fetchLogo('www.l.fr', fakeWeb({ ...smallSite, 'https://www.google.com/s2/favicons?domain=www.l.fr&sz=256': { status: 404, body: png(16, 16) } }), { fallback: true });
  assert.equal(unknown.width, 16, 'globe générique de Google (404) ignoré');

  const c2 = [];
  await fetchLogo('www.h2.fr', fakeWeb({ 'https://www.h2.fr/apple-touch-icon.png': { body: png(180, 180) } }, c2), { fallback: true });
  assert.ok(!c2.some((u) => u.includes('google')), 'aucun appel à Google quand le site officiel suffit');
});

test('préchargement de tout le catalogue, sans refaire les logos récents', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-logos-'));
  const db = openDatabase(dir);
  const calls = [];
  const svc = new LogoService(db, { fetcher: fakeWeb({ 'https://www.boursobank.com/apple-touch-icon.png': { body: png(180, 180) } }, calls), log: { info() {}, debug() {}, warn() {} } });
  const hosts = new Set([...svc.catalogue.values()].map((e) => e.host).filter(Boolean));
  const batch = svc.prefetchAll();
  assert.equal(batch.total, hosts.size);
  assert.equal(svc.prefetchAll(), batch, 'un seul préchargement à la fois');
  const done = await batch.promise;
  assert.equal(done.done, hosts.size);
  assert.equal(done.found, 1);
  assert.equal(svc.status().catalogue.boursobank.status, 'ok');
  assert.equal(svc.status().catalogue.boursobank.width, 180);
  assert.equal(svc.status().catalogue.fortuneo.status, 'failed');
  assert.match(svc.versions().boursobank, /^f\d+$/);
  const n = calls.length;
  assert.equal(svc.prefetchAll().total, 0, 'tout est récent');
  assert.equal(svc.prefetchAll({ includeFailed: true }).total, hosts.size - 1, 'nouvel essai des seuls échecs');
  await svc.batch.promise;
  assert.ok(calls.length > n);
  svc.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
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
    assert.ok(i.host && safeUrl(`https://${i.host}/`), `site officiel manquant ou invalide : ${i.id}`);
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
  assert.equal((await a.post('/api/admin/logos/fetch', {})).status, 409);
  assert.equal((await a.put('/api/admin/logos/boursobank', { data: png(64, 64).toString('base64') })).status, 200, 'image personnelle possible sans connexion sortante');
  assert.equal((await a.get('/api/institutions/logo/boursobank')).data.length, png(64, 64).length);
  assert.equal(c.length, 0);
  await s.stop();
});

test('API : images déposées par l\'administrateur, prioritaires sur le logo récupéré', async () => {
  const viewer = client(srv.base);
  await admin.post('/api/users', { username: 'lea', first_name: 'Léa', last_name: 'Martin', password: 'motdepasse-solide-42', role: 'viewer' });
  await viewer.post('/api/auth/login', { username: 'lea', password: 'motdepasse-solide-42' });

  let v = (await admin.get('/api/institutions/logos')).data;
  assert.equal(v.enabled, true);
  assert.match(v.versions.boursobank, /^f/);
  const custom = png(200, 120);
  let r = await admin.put('/api/admin/logos/boursobank', { data: custom.toString('base64') });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.version, /^c\d+$/);
  r = await viewer.get('/api/institutions/logo/boursobank');
  assert.ok(Buffer.compare(r.data, custom) === 0, 'image personnalisée servie');
  v = (await viewer.get('/api/institutions/logos')).data;
  assert.match(v.versions.boursobank, /^c/);

  // Établissement hors catalogue
  r = await admin.put('/api/admin/logos/perso-banque-du-village', { name: 'Banque du Village', data: png(64, 64).toString('base64') });
  assert.equal(r.status, 200);
  assert.equal((await viewer.get('/api/institutions/logo/perso-banque-du-village')).data.length, png(64, 64).length);
  assert.ok((await viewer.get('/api/institutions/logo/perso-inconnue')).data.length < 100, 'sans image : transparente');

  for (const [body, why] of [[{ data: Buffer.from('<svg onload="alert(1)"/>').toString('base64') }, 'svg'], [{ data: png(8, 8).toString('base64') }, 'trop petite'],
    [{ data: 'pas-du-base64' }, 'illisible'], [{ data: '' }, 'vide']]) {
    assert.equal((await admin.put('/api/admin/logos/fortuneo', body)).status, 400, why);
  }
  assert.equal((await admin.put('/api/admin/logos/..%2Fetc', { data: png(64, 64).toString('base64') })).status, 400);
  assert.equal((await admin.put('/api/admin/logos/perso-x', { data: png(64, 64).toString('base64') })).status, 400, 'nom requis hors catalogue');
  assert.equal((await viewer.put('/api/admin/logos/fortuneo', { data: png(64, 64).toString('base64') })).status, 403);
  assert.equal((await viewer.get('/api/admin/logos')).status, 403);

  await admin.post('/api/holdings', { category_id: (await admin.get('/api/categories')).data.categories[0].id, name: 'Compte', institution: 'Banque du Village', amount: 10 });
  const st = (await admin.get('/api/admin/logos')).data;
  assert.equal(st.catalogue.boursobank.status, 'ok');
  assert.equal(st.custom['perso-banque-du-village'].name, 'Banque du Village');
  assert.deepEqual(st.in_use, [{ name: 'Banque du Village', count: 1 }]);

  const exp = (await admin.get('/api/export.json')).data;
  assert.equal(exp.institution_logos.length, 2);
  r = await admin.del('/api/admin/logos/boursobank');
  assert.equal(r.status, 200);
  assert.ok(Buffer.compare((await viewer.get('/api/institutions/logo/boursobank')).data, custom) !== 0, 'retour au logo récupéré');
  assert.equal((await admin.del('/api/admin/logos/boursobank')).status, 404);
  r = await admin.post('/api/admin/import', exp);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(Buffer.compare((await viewer.get('/api/institutions/logo/boursobank')).data, custom) === 0, 'image restaurée par l\'import');
  const audit = (await admin.get('/api/audit')).data.entries.map((e) => e.action);
  assert.ok(audit.includes('logo_personnalise') && audit.includes('logo_retire'));
});

test('API : recherche du logo d\'un établissement à la demande', async () => {
  let r = await admin.post('/api/admin/logos/fetch', { id: 'fortuneo' });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'failed');
  r = await admin.post('/api/admin/logos/fetch', { id: 'boursobank' });
  assert.equal(r.data.status, 'ok');
  assert.equal((await admin.post('/api/admin/logos/fetch', { id: 'inconnu' })).status, 400);
  r = await admin.post('/api/admin/logos/fetch', {});
  assert.equal(r.data.started, true);
  await srv.app.logos.batch?.promise;
});
