// 0.9.10 : pastille carrée, logo horizontal gardé comme « logo complet ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, MIGRATIONS } from '../server/db.js';
import { InstitutionDirectory } from '../server/institutions.js';
import { LogoService, isSquarish, imageSize } from '../server/logos.js';
import { startServer, client } from './helpers.mjs';

const silent = { info() {}, warn() {}, debug() {} };
function png(w, h, fill = 3) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'ascii'); ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12); ihdr[16] = 8; ihdr[17] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(120, fill)]);
}
const WIDE = png(256, 40, 1);
const SQUARE_SITE = png(180, 180, 2);
const SQUARE_WD = png(256, 230, 4);

function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-shape-'));
  const db = openDatabase(dir);
  return Promise.resolve().then(() => fn(db)).finally(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
}

// Wikidata renvoie, pour le nom cherché, une entité financière dont le logo P154 est `file`.
function web({ file = 'Logo.svg', commons = WIDE, site = {} } = {}, calls = []) {
  return async (url) => {
    const a = new URL(url);
    calls.push(a.href);
    if (a.hostname === 'www.wikidata.org' && a.searchParams.get('action') === 'wbsearchentities') {
      const name = a.searchParams.get('search');
      return new Response(JSON.stringify({ search: [{ id: 'Q42', label: name, description: 'banque française' }] }));
    }
    if (a.hostname === 'www.wikidata.org') {
      return new Response(JSON.stringify({ entities: { Q42: { claims: { P154: [{ rank: 'normal', mainsnak: { datavalue: { value: file } } }] } } } }));
    }
    if (a.hostname === 'commons.wikimedia.org') return commons ? new Response(commons) : new Response('absent', { status: 404 });
    if (site[a.href]) return new Response(site[a.href]);
    return new Response('introuvable', { status: 404 });
  };
}
function services(db, fetcher) {
  const dir = new InstitutionDirectory(db, { fetcher, log: silent });
  const logos = new LogoService(db, { fetcher, log: silent });
  logos.directory = dir;
  logos.catalogue = dir.catalogue;
  return { dir, logos };
}

test('forme des images : carré, légèrement rectangulaire ou bandeau', () => {
  assert.equal(isSquarish({ width: 180, height: 180 }), true);
  assert.equal(isSquarish({ width: 330, height: 233 }), true, 'logo Crédit Agricole (1,42)');
  assert.equal(isSquarish({ width: 330, height: 51 }), false, 'bandeau BoursoBank');
  assert.equal(isSquarish({ width: 40, height: 256 }), false, 'image très haute');
  assert.equal(isSquarish({ width: null, height: 30 }), false, 'dimensions inconnues : jamais en pastille');
  assert.deepEqual(imageSize(WIDE), { width: 256, height: 40 });
});

test('logo Wikidata horizontal : icône carrée du site en pastille, logo complet conservé à part', async () => fixture(async (db) => {
  const calls = [];
  const { dir, logos } = services(db, web({ site: { 'https://www.boursobank.com/apple-touch-icon.png': SQUARE_SITE } }, calls));
  const badge = await logos.get('boursobank');
  assert.ok(Buffer.compare(Buffer.from(badge.data), SQUARE_SITE) === 0, "pastille : icône carrée du site officiel");
  const full = logos.full('boursobank');
  assert.ok(Buffer.compare(Buffer.from(full.data), WIDE) === 0, 'logo complet : bandeau Wikidata');
  const st = logos.status().catalogue.boursobank;
  assert.equal(st.status, 'ok');
  assert.equal(st.width, 180);
  assert.deepEqual(st.full, { width: 256, height: 40, source: 'commons.wikimedia.org' });
  assert.match(logos.fullVersions().boursobank, /^w\d+$/);
  assert.match(logos.versions().boursobank, /^f\d+$/);
  assert.ok(calls.some((u) => u.startsWith('https://www.boursobank.com/')), 'site officiel consulté pour la pastille');
  logos.close(); dir.close();
}));

test('logo Wikidata presque carré : utilisé en pastille, sans logo complet ni requête au site', async () => fixture(async (db) => {
  const calls = [];
  const { dir, logos } = services(db, web({ commons: SQUARE_WD }, calls));
  const badge = await logos.get('credit-agricole');
  assert.ok(Buffer.compare(Buffer.from(badge.data), SQUARE_WD) === 0);
  assert.equal(logos.full('credit-agricole'), null);
  assert.ok(!calls.some((u) => u.includes('credit-agricole.fr')), 'pas de requête au site officiel');
  logos.close(); dir.close();
}));

test('seul un logo horizontal existe : monogramme en pastille, logo complet disponible', async () => fixture(async (db) => {
  const { dir, logos } = services(db, web());
  assert.equal(await logos.get('boursobank'), null, 'monogramme plutôt qu\'un bandeau illisible');
  assert.equal(logos.status().catalogue.boursobank.status, 'wide_only');
  assert.ok(logos.full('boursobank'));
  assert.equal(logos.versions().boursobank, undefined);
  logos.close(); dir.close();
}));

test('icône OpenFinTech carrée en pastille et logo complet Wikidata en plus', async () => fixture(async (db) => {
  db.prepare('INSERT INTO institution_logo_sources(id,openfintech_url) VALUES(?,?)').run('revolut', 'https://static.openfintech.io/vendors/revolut/icon.png');
  const OFT = png(512, 512, 7);
  const base = web();
  const { dir, logos } = services(db, async (url) => (String(url).startsWith('https://static.openfintech.io/') ? new Response(OFT) : base(url)));
  const badge = await logos.get('revolut');
  assert.ok(Buffer.compare(Buffer.from(badge.data), OFT) === 0);
  assert.ok(Buffer.compare(Buffer.from(logos.full('revolut').data), WIDE) === 0);
  logos.close(); dir.close();
}));

test('migration 0.9.10 : bandeaux mis en pastille par 0.9.x oubliés, icônes carrées gardées puis complétées', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-mig16-'));
  const raw = new DatabaseSync(path.join(dir, 'vigie.sqlite'));
  raw.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (let i = 0; i < 15; i++) { raw.exec(MIGRATIONS[i]); raw.prepare('INSERT INTO schema_migrations VALUES (?, 0)').run(i + 1); }
  const ins = raw.prepare('INSERT INTO logo_cache (host, content_type, data, ok, fetched_at, width, height, source) VALUES (?, ?, ?, 1, ?, ?, ?, ?)');
  ins.run('www.boursobank.com', 'image/png', WIDE, Date.now(), 256, 40, 'commons.wikimedia.org');
  ins.run('www.lcl.fr', 'image/png', SQUARE_SITE, Date.now(), 180, 180, 'https://www.lcl.fr/apple-touch-icon.png');
  raw.close();
  const db = openDatabase(dir);
  const rows = db.prepare('SELECT host, full_checked_at FROM logo_cache ORDER BY host').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ host: 'www.lcl.fr', full_checked_at: null }]);
  const { dir: d, logos } = services(db, web({ commons: null }));
  const batch = logos.prefetchAll();
  assert.ok(batch.total >= 2, 'bandeau et icône sans logo complet repris au préchargement');
  await batch.promise;
  assert.ok(db.prepare("SELECT full_checked_at FROM logo_cache WHERE host = 'www.lcl.fr'").get().full_checked_at > 0);
  logos.close(); d.close(); db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('API : logo complet servi à part, 404 sinon', async () => {
  const srv = await startServer({ INSTITUTION_CATALOGUE: true }, { fetcher: web({ site: { 'https://www.boursobank.com/apple-touch-icon.png': SQUARE_SITE } }) });
  const admin = client(srv.base);
  await admin.post('/api/auth/setup', { username: 'alex', first_name: 'Alex', last_name: 'Martin', password: 'motdepasse-solide-42' });
  assert.equal((await admin.get('/api/institutions/logo/boursobank/full')).status, 404, 'pas encore cherché');
  const badge = await admin.get('/api/institutions/logo/boursobank');
  assert.ok(Buffer.compare(badge.data, SQUARE_SITE) === 0);
  const full = await admin.get('/api/institutions/logo/boursobank/full');
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.compare(full.data, WIDE) === 0);
  const v = (await admin.get('/api/institutions/logos')).data;
  assert.match(v.full.boursobank, /^w\d+$/);
  assert.equal((await admin.get('/api/institutions/logo/inconnu/full')).status, 404);
  assert.equal((await client(srv.base).get('/api/institutions/logo/boursobank/full')).status, 401);
  assert.equal((await admin.get('/api/admin/logos')).data.catalogue.boursobank.full.width, 256);
  await srv.stop();
});
