// Séparateur de milliers : un point (12.500,50 €), à l'affichage comme à la saisie, côté navigateur et serveur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { formatNumber, formatCents } from '../server/format.js';
import { parseAmountToCents, normalizeAmountText } from '../server/portfolio.js';
import { buildEstimateNote } from '../server/real-estate.js';

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
function slice(start, end) {
  const a = app.indexOf(start);
  const b = app.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `bloc introuvable : ${start}`);
  return app.slice(a, b);
}
const state = { base: 'EUR', discret: false };
const client = runInNewContext('(() => {\n' +
  slice('  // Conventions françaises', '  const asDate') +
  slice('  // Montant saisi en centimes', '  const centsInput') +
  '\nreturn { num, money, exact, compactMoney, pct, parseCents };\n})()', { state, Intl, Number, Math, Map, String });

// Saisies reconnues, en centimes (null : illisible ou vide).
const INPUTS = [
  ['12.500', 1_250_000], ['12.500,50', 1_250_050], ['12 500,50 €', 1_250_050], ['12,500.50', 1_250_050],
  ['1.234.567', 123_456_700], ['1,234,567', 123_456_700], ['-2.500', -250_000], ['−2.500', -250_000],
  ['12,5', 1250], ['12.5', 1250], ['12.50', 1250], ['1.2345', 123], ['0.500', 50], ['12,500', 1250],
  ['220.000', 22_000_000], ['1000', 100_000], ['1.234,5', 123_450], ['1,2,3', null], ['12.50.0', null], ['abc', null],
];

test('affichage : point pour les milliers, virgule pour les décimales', () => {
  state.discret = false;
  const nbsp = /[   ]/g;
  assert.equal(client.money(1_250_050).replace(nbsp, ' '), '12.501 €');
  assert.equal(client.exact(1_250_050).replace(nbsp, ' '), '12.500,50 €');
  assert.equal(client.exact(-123_456_789).replace(nbsp, ' '), '−1.234.567,89 €');
  assert.equal(client.money(99_900).replace(nbsp, ' '), '999 €');
  assert.equal(client.money(123_400).replace(nbsp, ' '), '1.234 €');
  assert.equal(client.money(250_000, 'EUR', { sign: true }).replace(nbsp, ' '), '+2.500 €');
  assert.equal(client.num(4200), '4.200');
  assert.equal(client.num(1234.5, { min: 2, max: 2 }), '1.234,50');
  assert.equal(client.num(0.000641, { max: 6 }), '0,000641');
  assert.equal(client.pct(12.345).replace(nbsp, ' '), '1.234,5 %');
  assert.match(client.compactMoney(250_000_000).replace(nbsp, ' '), /^2,5 ?M ?€$/);
  assert.ok(!/[   ]\d{3}/.test(client.money(987_654_321_00)), 'plus aucune espace entre les groupes de chiffres');
  state.discret = true;
  assert.ok(!/\d/.test(client.money(1_250_050)), 'mode discret : aucun chiffre');
  state.discret = false;
});

test('saisie : « 12.500 » vaut douze mille cinq cents, identique au navigateur et au serveur', () => {
  for (const [text, cents] of INPUTS) {
    assert.equal(parseAmountToCents(text), cents, `serveur : ${text}`);
    const c = client.parseCents(text);
    assert.equal(cents === null ? (Number.isNaN(c) ? null : c) : c, cents, `navigateur : ${text}`);
  }
  assert.equal(client.parseCents(''), null);
  assert.equal(normalizeAmountText('12.500'), '12500');
  // Ce qui est affiché se relit à l'identique.
  for (const cents of [1_250_050, 123_456_789, 99_999, 100_000, 5, -123_456_789]) {
    const shown = client.exact(cents).replace(/[^\d,.−-]/g, '');
    assert.equal(parseAmountToCents(shown), cents, shown);
    assert.equal(client.parseCents(shown), cents, shown);
  }
});

test('serveur : textes du journal et de l’estimation immobilière', () => {
  assert.equal(formatCents(1_250_050), '12.500,50');
  assert.equal(formatCents(-5), '−0,05');
  assert.equal(formatNumber(4200), '4.200');
  assert.equal(formatNumber(1.5), '1,5');
  assert.equal(formatNumber(NaN), '—');
  const note = buildEstimateNote({
    as_of: '2026-11-01', estimate_cents: 75_600_000, low_cents: 49_140_000, high_cents: 102_060_000,
    confidence: 'medium', method: 'dvf_local_price_m2', comparables: 3, radius_m: 1500, price_per_m2: 4200,
  }, { type_local: 1, surface_bati: 180 });
  assert.match(note, /756\.000 € \| fourchette 491\.400 € à 1\.020\.600 €/);
  assert.match(note, /1,5 km max/);
  assert.match(note, /4\.200 €\/m² × 180 m²/);
});
