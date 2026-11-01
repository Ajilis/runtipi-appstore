// Vérifie, depuis Internet, que Vigie trouve le logo de chaque établissement du catalogue.
// N'enregistre aucune image : affiche seulement le résultat (dimensions, format, provenance).
import { fetchLogo, loadCatalogue } from '../../sources/vigie/server/logos.js';

// Usage : check-logos.mjs [id…] | --hosts site1 site2… (sites candidats, hors catalogue)
const args = process.argv.slice(2);
const only = args[0] === '--hosts' ? [] : args;
const catalogue = args[0] === '--hosts' ? args.slice(1).map((h) => ({ id: h, host: h })) : [...loadCatalogue().values()].filter((e) => !only.length || only.includes(e.id));
const rows = [];
const queue = [...catalogue];
async function worker() {
  while (queue.length) {
    const e = queue.shift();
    const trace = [];
    const fetcher = async (url, opts) => {
      try {
        const res = await fetch(url, opts);
        trace.push(`${res.status} ${url.replace(/^https:\/\//, '')}${res.redirected ? ` -> ${res.url}` : ''}`);
        return res;
      } catch (err) {
        trace.push(`ERR ${url.replace(/^https:\/\//, '')} ${err.cause?.code || err.name}`);
        throw err;
      }
    };
    const t0 = Date.now();
    const logo = e.host ? await fetchLogo(e.host, fetcher, { fallback: process.env.FALLBACK !== 'false' }).catch(() => null) : null;
    rows.push({ id: e.id, host: e.host, ok: Boolean(logo), size: logo ? `${logo.width ?? '?'}x${logo.height ?? '?'}` : '', type: logo ? logo.type.replace('image/', '') : '',
      bytes: logo ? logo.data.length : 0, source: logo ? logo.source : '', ms: Date.now() - t0, trace });
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
rows.sort((a, b) => a.id.localeCompare(b.id));
const side = (r) => Math.min(...r.size.split('x').map(Number).filter(Number.isFinite), 0) || Number(r.size.split('x')[0]) || 0;
for (const r of rows) console.log([r.ok ? 'OK  ' : 'FAIL', r.id.padEnd(24), r.size.padEnd(9), r.type.padEnd(7), String(r.bytes).padStart(7), `${r.ms} ms`.padStart(8), r.source].join(' '));
console.log('');
for (const r of rows.filter((x) => !x.ok || Number(x.size.split('x')[0]) < 96)) console.log(`${r.ok ? 'PETIT' : 'ÉCHEC'} ${r.id} (${r.host})\n  ${r.trace.join('\n  ')}`);
const ok = rows.filter((r) => r.ok);
const sharp = ok.filter((r) => Number(r.size.split('x')[0]) >= 96);
console.log(`\nRésumé : ${ok.length}/${rows.length} logos trouvés, dont ${sharp.length} d'au moins 96 px.`);
