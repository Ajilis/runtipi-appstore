// Taux de change de référence de la Banque centrale européenne (exprimés pour 1 EUR).
export const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

export function parseEcbXml(xml) {
  const date = (/time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml) || [])[1] || null;
  const perEur = { EUR: 1 };
  const re = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g;
  let m;
  while ((m = re.exec(xml))) perEur[m[1]] = Number(m[2]);
  return { date, perEur };
}

// Convertit des taux « pour 1 EUR » en taux « 1 unité de devise = x devise de référence ».
export function ratesToBase(perEur, base, currencies) {
  const baseRate = perEur[base];
  if (!baseRate) return { rates: {}, missing: currencies };
  const rates = {}, missing = [];
  for (const cur of currencies) {
    if (cur === base) continue;
    const r = perEur[cur];
    if (!r) { missing.push(cur); continue; }
    rates[cur] = Number((baseRate / r).toPrecision(10));
  }
  return { rates, missing };
}

export async function fetchEcbRates(timeoutMs = 10000) {
  const res = await fetch(ECB_URL, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'Vigie-Patrimoine' } });
  if (!res.ok) throw new Error(`La BCE a répondu ${res.status}`);
  const text = await res.text();
  const parsed = parseEcbXml(text);
  if (Object.keys(parsed.perEur).length < 5) throw new Error('Réponse de la BCE illisible');
  return parsed;
}
