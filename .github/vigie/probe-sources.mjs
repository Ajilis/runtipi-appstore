// Sonde : couverture des sources de données d'établissements (Wikidata, OpenFinTech, registres français).
import { loadCatalogue, sniffImage, imageSize } from '../../sources/vigie/server/logos.js';
const UA = 'VigiePatrimoine/0.9 (https://github.com/Ajilis/runtipi-appstore; contact via GitHub)';
const get = async (url, opts = {}) => fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(90_000) });
async function sparql(q) {
  const r = await get('https://query.wikidata.org/sparql', { method: 'POST', headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'query=' + encodeURIComponent(q) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).results.bindings;
}
const v = (b, k) => (b[k] ? b[k].value : '');
const section = (t) => console.log(`\n===== ${t} =====`);

section('Wikidata : établissements financiers en France');
try {
  const rows = await sparql(`SELECT ?item ?itemLabel (SAMPLE(?tl) AS ?type) (SAMPLE(?logo) AS ?logo) (SAMPLE(?icon) AS ?icon) (SAMPLE(?site) AS ?site) WHERE {
    VALUES ?root { wd:Q22687 wd:Q6881511 wd:Q650241 }
    ?item wdt:P31/wdt:P279* ?root ; wdt:P17 wd:Q142 .
    FILTER NOT EXISTS { ?item wdt:P576 [] }
    OPTIONAL { ?item wdt:P31 ?t . ?t rdfs:label ?tl FILTER(lang(?tl) = 'fr') }
    OPTIONAL { ?item wdt:P154 ?logo } OPTIONAL { ?item wdt:P8972 ?icon } OPTIONAL { ?item wdt:P856 ?site }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
  } GROUP BY ?item ?itemLabel`);
  console.log(`total ${rows.length}, logo ${rows.filter((r) => v(r, 'logo')).length}, icône ${rows.filter((r) => v(r, 'icon')).length}, site ${rows.filter((r) => v(r, 'site')).length}`);
  const types = {};
  for (const r of rows) types[v(r, 'type')] = (types[v(r, 'type')] || 0) + 1;
  console.log(Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `${n} ${k}`).join(' | '));
  for (const r of rows.filter((x) => v(x, 'logo')).slice(0, 50)) console.log(`${v(r, 'itemLabel')} | ${v(r, 'type')} | ${v(r, 'site')} | ${decodeURIComponent(v(r, 'logo').split('/').pop())}`);
} catch (err) { console.log('ERREUR', err.message); }

section('Wikidata : établissements du catalogue Vigie');
const cat = [...loadCatalogue().values()];
const found = [];
for (const e of cat) {
  try {
    const s = await (await get(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=fr&uselang=fr&type=item&limit=5&search=${encodeURIComponent(e.name)}`)).json();
    const hit = (s.search || []).find((x) => /banque|bank|assur|insur|financ|courtier|broker|bours|crypto|épargne|gestion|paiement|payment|mutuelle|néobanque|investment|investissement|asset|or |gold|scpi|portefeuille|wallet|exchange/i.test(x.description || '')) || null;
    if (!hit) { console.log(`${e.id.padEnd(24)} —`); continue; }
    const ent = (await (await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${hit.id}`)).json()).entities[hit.id];
    const c = (p) => (ent.claims[p] || []).map((x) => x.mainsnak.datavalue && x.mainsnak.datavalue.value).filter(Boolean);
    const logo = c('P154')[0] || '', icon = (c('P8972')[0] || c('P2910')[0] || ''), site = c('P856')[0] || '', lei = c('P1278')[0] || '';
    found.push({ id: e.id, q: hit.id, logo, icon });
    console.log(`${e.id.padEnd(24)} ${hit.id.padEnd(11)} ${(hit.label || '').slice(0, 26).padEnd(27)} logo:${logo ? 'oui' : 'non'} icône:${icon ? 'oui' : 'non'} lei:${lei ? 'oui' : 'non'} ${site}`);
  } catch (err) { console.log(`${e.id} ERREUR ${err.message}`); }
}
console.log(`catalogue : ${found.length}/${cat.length} trouvés, ${found.filter((f) => f.logo).length} avec logo, ${found.filter((f) => f.icon).length} avec icône`);

section('Wikimedia Commons : forme des logos (vignette 256 px)');
const shapes = { carré: 0, large: 0, haut: 0, illisible: 0 };
for (const f of found.filter((x) => x.logo || x.icon)) {
  const file = f.icon || f.logo;
  try {
    const r = await get(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=256`);
    const buf = Buffer.from(await r.arrayBuffer());
    const t = sniffImage(buf); const s = t ? imageSize(buf, t) : null;
    const ratio = s ? s.width / s.height : 0;
    const shape = !s ? 'illisible' : ratio > 1.6 ? 'large' : ratio < 0.62 ? 'haut' : 'carré';
    shapes[shape]++;
    console.log(`${f.id.padEnd(24)} ${f.icon ? 'icône' : 'logo '} ${r.status} ${t || '-'} ${s ? `${s.width}x${s.height}` : ''} ${shape} ${file}`);
  } catch (err) { console.log(`${f.id} ERREUR ${err.message}`); }
}
console.log(JSON.stringify(shapes));

section('OpenFinTech');
try {
  const r = await get('https://raw.githubusercontent.com/openfintechio/openfintech/master/data/vendors.json');
  const vendors = await r.json();
  const fr = vendors.filter((x) => (x.countries || []).includes('FR'));
  console.log(`vendors ${vendors.length}, FR ${fr.length}`);
  const ic = await get('https://raw.githubusercontent.com/openfintechio/openfintech/master/resources/vendors/revolut/icon.png');
  const b = Buffer.from(await ic.arrayBuffer());
  console.log('icône revolut', ic.status, sniffImage(b), JSON.stringify(imageSize(b)));
  console.log(fr.slice(0, 60).map((x) => x.name.en).join(', '));
} catch (err) { console.log('ERREUR', err.message); }

section('Registres français');
for (const [label, url] of [
  ['REGAFI accueil', 'https://www.regafi.fr/'],
  ['data.gouv.fr établissements de crédit', 'https://www.data.gouv.fr/api/1/datasets/?q=%C3%A9tablissements%20de%20cr%C3%A9dit&page_size=8'],
  ['data.gouv.fr REGAFI', 'https://www.data.gouv.fr/api/1/datasets/?q=regafi&page_size=8'],
  ['data.gouv.fr ACPR', 'https://www.data.gouv.fr/api/1/datasets/?q=ACPR%20liste&page_size=8'],
  ['Annuaire des entreprises', 'https://recherche-entreprises.api.gouv.fr/search?q=boursobank&per_page=3'],
  ['GLEIF', 'https://api.gleif.org/api/v1/fuzzycompletions?field=entity.legalName&q=BoursoBank'],
]) {
  try {
    const r = await get(url, { headers: { Accept: 'application/json,text/html' } });
    const text = await r.text();
    let out = text.slice(0, 200).replace(/\s+/g, ' ');
    if (/json/.test(r.headers.get('content-type') || '')) {
      const j = JSON.parse(text);
      if (j.data && Array.isArray(j.data) && j.data[0] && j.data[0].title) out = j.data.map((d) => `${d.title} [${(d.organization || {}).name || ''}] ${(d.resources || []).map((x) => x.format).join('/')} ${d.last_update || ''}`).join('\n   ');
      else if (j.results) out = j.results.map((x) => `${x.nom_complet} ${x.siren} ${x.activite_principale}`).join(' | ');
      else if (j.data) out = j.data.map((x) => x.attributes && x.attributes.value).join(' | ');
    } else {
      const links = [...text.matchAll(/href="([^"]*(?:export|csv|xlsx|api|telecharg|download)[^"]*)"/gi)].map((m) => m[1]).slice(0, 10);
      out += `\n   liens : ${links.join(' ')}`;
    }
    console.log(`${label} : ${r.status}\n   ${out}`);
  } catch (err) { console.log(`${label} : ERREUR ${err.message}`); }
}
