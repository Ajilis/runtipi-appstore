import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.js';
import { InstitutionDirectory, officialHost } from '../server/institutions.js';
import { fetchDirectoryLogo, LogoService } from '../server/logos.js';

const hash = (s) => createHash('sha256').update(s).digest('hex');
const silent = { info() {}, warn() {}, debug() {} };

function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-institutions-'));
  const db = openDatabase(dir);
  return Promise.resolve().then(() => fn(db)).finally(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
}

function published(routes = {}) {
  const vendors = JSON.stringify([
    { code: 'finpay', status: 'active', name: { en: 'FinPay' }, countries: ['FR'], links: { website: 'https://www.finpay.fr/' } },
    { code: 'logo-only', status: 'active', name: { fr: 'Épargne Nouvelle' }, countries: ['FR'] },
    { code: 'other', status: 'active', name: { en: 'OtherCountry' }, countries: ['US'] },
    { code: 'closed', status: 'inactive', name: { en: 'ClosedFin' }, countries: ['FR'] },
  ]);
  const sums = hash(vendors) + '  data/vendors.json\n';
  const latest = { version: 'v0.2.582', sha256sums: hash(sums) };
  const files = {
    'https://static.openfintech.io/raw/latest.json': JSON.stringify(latest),
    'https://static.openfintech.io/raw/SHA256SUMS': sums,
    'https://static.openfintech.io/raw/data/vendors.json': vendors,
    ...routes,
  };
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    return Object.prototype.hasOwnProperty.call(files, String(url))
      ? new Response(files[String(url)], { status: 200 })
      : new Response('Non trouvé', { status: 404 });
  };
  return { fetcher, calls };
}

test('annuaire : catalogue local conservé et URLs non fiables rejetées', async () => fixture(async (db) => {
  let calls = 0;
  const service = new InstitutionDirectory(db, { enabled: false, fetcher: () => { calls++; throw Error('offline'); }, log: silent });
  assert.ok(service.catalogue.has('boursobank'));
  assert.ok(service.list().length >= 70);
  assert.equal(officialHost('https://www.example.fr/path'), 'www.example.fr');
  for (const url of ['http://example.fr', 'https://127.0.0.1/', 'https://localhost/', 'https://dev.local/', 'https://[::1]/']) assert.equal(officialHost(url), null);
  assert.equal((await service.search('Bourso')).some((e) => e.id === 'boursobank'), true);
  assert.equal(calls, 0);
  service.close();
}));

test('annuaire : synchronisation OpenFinTech vérifiée SHA-256, dédoublonnée et conservée en SQLite', async () => fixture(async (db) => {
  const { fetcher, calls } = published();
  const service = new InstitutionDirectory(db, { fetcher, log: silent });
  const first = await service.syncOpenFinTech();
  assert.equal(first.added, 2);
  assert.equal(service.catalogue.get('oft-finpay').host, 'www.finpay.fr');
  assert.equal(service.catalogue.get('oft-logo-only').logo_url, 'https://static.openfintech.io/vendors/logo-only/icon.png');
  assert.equal(service.catalogue.has('oft-other'), false);
  assert.equal(service.catalogue.has('oft-closed'), false);
  assert.ok(service.catalogue.has('boursobank'));
  assert.equal((await service.syncOpenFinTech()).unchanged, true);
  assert.equal(calls.filter((u) => u.endsWith('/data/vendors.json')).length, 1, 'pas de nouveau téléchargement si version identique');
  const reloaded = new InstitutionDirectory(db, { enabled: false, fetcher: () => { throw Error('offline'); }, log: silent });
  assert.equal(reloaded.catalogue.get('oft-finpay').name, 'FinPay');
  reloaded.close();
  service.close();
}));

test('annuaire : un SHA-256 invalide ne remplace pas le catalogue en cache', async () => fixture(async (db) => {
  const bad = published({ 'https://static.openfintech.io/raw/data/vendors.json': '[]' });
  const service = new InstitutionDirectory(db, { fetcher: bad.fetcher, log: silent });
  await assert.rejects(service.syncOpenFinTech(), /Checksum/);
  assert.equal(service.catalogue.has('oft-finpay'), false);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='institutions_oft_version'").get(), undefined);
  service.close();
}));

test('annuaire : recherche Wikidata et Sirene, filtrage des entités financières', async () => fixture(async (db) => {
  const calls = [];
  const fetcher = async (u) => {
    const url = new URL(u);
    calls.push(url);
    if (url.hostname === 'www.wikidata.org' && url.searchParams.get('action') === 'wbsearchentities') {
      return new Response(JSON.stringify({ search: [
        { id: 'Q123', label: 'Banque Exemple', description: 'banque française' },
        { id: 'Q124', label: 'Banque Géographique', description: 'station de métro' },
      ] }));
    }
    if (url.hostname === 'www.wikidata.org' && url.searchParams.get('action') === 'wbgetentities') {
      return new Response(JSON.stringify({ entities: {
        Q123: { claims: { P856: [{ mainsnak: { datavalue: { value: 'https://banque-exemple.fr/' } } }],
          P154: [{ mainsnak: { datavalue: { value: 'Banque exemple logo.svg' } } }] },
        aliases: { fr: [{ value: 'B. Exemple' }] } },
      } }));
    }
    if (url.hostname === 'recherche-entreprises.api.gouv.fr') {
      return new Response(JSON.stringify({ results: [
        { siren: '123456789', nom_complet: 'Courtier Exemple', activite_principale: '66.22Z' },
        { siren: '789456123', nom_complet: 'Boulangerie Exemple', activite_principale: '10.71C' },
      ] }));
    }
    return new Response('absent', { status: 404 });
  };
  const service = new InstitutionDirectory(db, { fetcher, log: silent });
  const results = await service.search('Exemple');
  assert.ok(results.some((e) => e.id === 'wd-q123'));
  assert.ok(results.some((e) => e.id === 'fr-123456789'));
  assert.equal(service.catalogue.has('wd-q124'), false);
  assert.equal(service.catalogue.has('fr-789456123'), false);
  assert.equal(service.catalogue.get('wd-q123').host, 'banque-exemple.fr');
  assert.ok(service.catalogue.get('wd-q123').logo_url.startsWith('https://commons.wikimedia.org/'));
  await service.search('Exemple');
  assert.equal(calls.filter((url) => url.hostname === 'recherche-entreprises.api.gouv.fr').length, 1, 'requête mise en cache');
  service.close();
}));

test('logos : les sources externes sont limitées aux hébergeurs autorisés', async () => {
  const image = Buffer.alloc(200, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(image);
  image.writeUInt32BE(13, 8);
  image.write('IHDR', 12);
  image.writeUInt32BE(128, 16);
  image.writeUInt32BE(128, 20);
  const fetcher = async () => new Response(image, { headers: { 'Content-Type': 'image/png' } });
  assert.equal(await fetchDirectoryLogo('https://bad.example/logo.png', fetcher), null);
  const logo = await fetchDirectoryLogo('https://static.openfintech.io/vendors/finpay/icon.png', fetcher);
  assert.equal(logo.type, 'image/png');
  assert.equal(logo.width, 128);
});

test('N26 BANK SE et VIVID MONEY S.A. : fiches Sirene existantes reliées aux marques vérifiées', async () => fixture(async (db) => {
  const insert = db.prepare('INSERT INTO institution_directory (id, name, kind, host, aliases, logo_url, source, updated_at) VALUES (?, ?, ?, NULL, ?, NULL, ?, ?)');
  insert.run('fr-840460943', 'N26 BANK SE', 'Établissement financier (Sirene)', '[]', 'Sirene', Date.now());
  insert.run('fr-123456789', 'VIVID MONEY S.A.', 'Établissement financier (Sirene)', '[]', 'Sirene', Date.now());
  // La migration doit préserver les avoirs, les fiches et leurs identifiants.
  const dir = new InstitutionDirectory(db, { enabled: false, fetcher: () => { throw Error('offline'); }, log: silent });
  const n26 = dir.catalogue.get('fr-840460943');
  const vivid = dir.catalogue.get('fr-123456789');
  assert.equal(n26.name, 'N26 BANK SE');
  assert.equal(n26.host, 'n26.com');
  assert.ok(n26.logo_url.endsWith('/N26_logo.svg?width=256'));
  assert.equal(vivid.name, 'VIVID MONEY S.A.');
  assert.equal(vivid.host, 'vivid.money');
  assert.ok(vivid.logo_url.endsWith('/Vivid-money-logo.svg?width=256'));

  const image = Buffer.alloc(200, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(image);
  image.writeUInt32BE(13, 8); image.write('IHDR', 12);
  image.writeUInt32BE(128, 16); image.writeUInt32BE(128, 20);
  const calls = [];
  const logos = new LogoService(db, { fetcher: async (url) => {
    calls.push(String(url));
    return String(url).startsWith('https://commons.wikimedia.org/wiki/Special:Redirect/file/')
      ? new Response(image, { status: 200 }) : new Response('Introuvable', { status: 404 });
  }, log: silent });
  logos.catalogue = dir.catalogue;
  assert.equal(logos.status().catalogue['fr-840460943'].status, 'missing');
  assert.equal(logos.status().catalogue['fr-123456789'].status, 'missing');
  assert.equal((await logos.get('fr-840460943')).type, 'image/png');
  assert.equal((await logos.get('fr-123456789')).type, 'image/png');
  assert.equal(logos.status().catalogue['fr-840460943'].status, 'ok');
  assert.equal(logos.status().catalogue['fr-123456789'].status, 'ok');
  assert.equal(calls.filter((u) => u.startsWith('https://commons.wikimedia.org/')).length, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM institution_directory").get().count, 2);
  logos.close(); dir.close();
}));

test('fiches Sirene nouvelles : enrichissement exact sans affecter les autres établissements', async () => fixture(async (db) => {
  const dir = new InstitutionDirectory(db, { enabled: false, log: silent });
  assert.equal(dir.accept({ id: 'fr-987654321', name: 'VIVID MONEY S.A.', source: 'Sirene' }), true);
  assert.equal(dir.catalogue.get('fr-987654321').host, 'vivid.money');
  assert.equal(dir.accept({ id: 'fr-987654322', name: 'Autre Société Bancaire', source: 'Sirene' }), true);
  assert.equal(dir.catalogue.get('fr-987654322').host, null);
  assert.equal(dir.catalogue.get('fr-987654322').logo_url, null);
  dir.close();
}));

