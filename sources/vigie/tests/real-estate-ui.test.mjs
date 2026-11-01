// Régressions de l'interface immobilière : exécute les callbacks réels du formulaire.
// Notamment, ne pas utiliser confirmDialog() : il remplacerait le DOM du formulaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/app.css', import.meta.url), 'utf8');
const mergeStart = app.indexOf('  function mergeEstimationNote(');
const mergeEnd = app.indexOf('  async function holdingForm(', mergeStart);
assert.ok(mergeStart >= 0 && mergeEnd > mergeStart, 'fusion des notes immobilières introuvable');
const mergeEstimationNote = runInNewContext('(() => {\n' + app.slice(mergeStart, mergeEnd) +
  '\nreturn mergeEstimationNote;\n})()');

const bindStart = app.indexOf("    estimateButtons.forEach((button) => button.addEventListener('click', async () => {");
const bindEnd = app.indexOf("    const modeWrap = $('[data-mode-wrap]', form);", bindStart);
assert.ok(bindStart >= 0 && bindEnd > bindStart, 'bouton d’estimation introuvable');
const realEstimateClickCode = app.slice(bindStart, bindEnd);

const REPORT = '[Estimation Vigie]\n2026-11-01 | 756 000 € | 3 ventes de maisons.\n' +
  'Médiane : 4 200 €/m² × 180 m². Incertitude ±35 %, terrain et DPE inconnus.\n[/Estimation Vigie]';

function fixture(notes = 'Jardin clos, portail électrique.', result = null, apiResponder = null) {
  const output = {
    textContent: '', children: [],
    appendChild(node) { this.children.push(node); },
  };
  const amount = { value: '520000', dispatched: [], dispatchEvent(e) { this.dispatched.push(e.type); } };
  const noteInput = { value: notes, maxLength: 1000, dispatched: [],
    dispatchEvent(e) { this.dispatched.push(e.type); } };
  const form = {
    currency: { value: 'EUR' }, property_address: { value: '128 avenue des Frères Lumière 69008 Lyon' },
    surface_m2: { value: '180' }, property_type: { value: 'maison' },
    property_condition: { value: 'bon' },
    querySelector(selector) {
      assert.equal(selector, '[name="notes"]');
      return noteInput;
    },
  };
  const button = {
    disabled: false, handlers: {},
    closest(selector) { assert.equal(selector, '.field'); return { marker: 'holding-value-field' }; },
    addEventListener(type, cb) { this.handlers[type] = cb; },
  };
  const estimate = result || {
    estimate_cents: 75600000, low_cents: 49140000, high_cents: 102060000,
    confidence: 'low', comparables: 3, method: 'dvf_local_price_m2',
    price_per_m2: 4200, radius_m: 1500, estimation_note: REPORT,
  };
  const requests = [];
  const messages = [];
  const context = {
    estimateButtons: [button], estateSection: { hidden: false }, form,
    $: (selector, root) => {
      if (selector === '[name="amount"]') {
        assert.equal(root.marker, 'holding-value-field');
        return amount;
      }
      if (selector === '[data-estimate-result]') {
        assert.equal(root, form);
        return output;
      }
      throw Error('Sélecteur inattendu ' + selector);
    },
    api: async (method, uri, params) => {
      requests.push({ method, uri, params });
      return apiResponder ? apiResponder(method, uri, params) : estimate;
    },
    money: (centimes) => String(Math.round(centimes / 100)) + ' €',
    centsInput: (centimes) => String(centimes / 100),
    mergeEstimationNote,
    Event: class { constructor(type) { this.type = type; } },
    toast: (msg) => messages.push(msg),
  };
  runInNewContext('(() => {\n' + realEstimateClickCode + '\n})()', context);
  return { button, output, amount, noteInput, form, estimate, requests, messages, context };
}

test('estimation : baguette SVG visible et libellé Estimer sur création et modification', () => {
  const buttons = [...app.matchAll(/class="btn estimate-magic"[^>]*>([^<]*<svg[^]*?<\/svg>|[^]*?)<\/button>/g)];
  // Le balisage est une chaîne HTML interpolant le composant SVG.
  assert.equal((app.match(/class="btn estimate-magic"/g) || []).length, 2);
  assert.equal((app.match(/data-estimate hidden title="Estimer à partir des ventes immobilières"/g) || []).length, 2);
  assert.equal((app.match(/\$\{icon\('magic'\)\}<span>Estimer<\/span>/g) || []).length, 2);
  assert.match(app, /magic: '<path d="/);
  assert.match(css, /\.estate-value-input \.estimate-magic svg \{ width: 23px/);
  assert.match(css, /\.estimate-magic:hover/);
});

test('notes : conserve le texte personnel, remplace le bilan précédent et ne tronque rien', () => {
  const personal = 'Maison individuelle.\nTerrain arboré.';
  const once = mergeEstimationNote(personal, REPORT);
  assert.ok(once.startsWith(personal));
  assert.ok(once.endsWith(REPORT));
  const twice = mergeEstimationNote(once, '[Estimation Vigie]\n2027-01-02 | révision.\n[/Estimation Vigie]');
  assert.equal((twice.match(/\[Estimation Vigie\]/g) || []).length, 1);
  assert.ok(twice.startsWith(personal));
  assert.match(twice, /2027-01-02/);
  assert.equal(mergeEstimationNote('X'.repeat(985), REPORT), null);
  assert.equal(mergeEstimationNote('Notes utilisateur', 'une réponse JSON sans bilan signé'), null);
});

test('estimation : un seul clic remplit immédiatement la valeur actuelle ET les notes, sans enregistrement automatique', async () => {
  const f = fixture();
  await f.button.handlers.click();
  assert.equal(f.amount.value, '756000');
  assert.ok(f.noteInput.value.startsWith('Jardin clos, portail électrique.'));
  assert.ok(f.noteInput.value.includes(REPORT));
  assert.equal(f.output.children.length, 0, 'aucun second bouton Appliquer');
  assert.equal(f.requests.length, 1, 'aucune requête de sauvegarde en base');
  assert.equal(f.requests[0].method, 'POST');
  assert.equal(f.requests[0].uri, '/api/real-estate/estimate');
  assert.equal(f.requests[0].params.property_type, 'maison');
  assert.equal(f.requests[0].params.surface_m2, 180);
  assert.ok(!JSON.stringify(f.requests).includes('520000'), 'la valeur actuelle n’est pas transmise à GeoRegistry');
  assert.deepEqual(f.amount.dispatched, ['input']);
  assert.deepEqual(f.noteInput.dispatched, ['input']);
  assert.match(f.output.textContent, /remplies automatiquement/);
  assert.match(f.output.textContent, /Enregistrer/);
  assert.match(f.output.textContent, /valeur d’achat reste inchangée/);
  assert.equal(f.button.disabled, false);
});

test('estimation : une nouvelle estimation remplace seulement le bilan auto sans perdre les notes personnelles', async () => {
  const f = fixture();
  await f.button.handlers.click();
  const second = '[Estimation Vigie]\n2026-11-02 | 800 000 € | fiabilité faible.\n[/Estimation Vigie]';
  f.estimate.estimate_cents = 80000000;
  f.estimate.estimation_note = second;
  await f.button.handlers.click();
  assert.equal(f.amount.value, '800000');
  assert.equal((f.noteInput.value.match(/\[Estimation Vigie\]/g) || []).length, 1);
  assert.ok(f.noteInput.value.startsWith('Jardin clos, portail électrique.'));
  assert.ok(f.noteInput.value.includes(second));
  assert.ok(!f.noteInput.value.includes(REPORT));
  assert.equal(f.requests.length, 2);
});

test('estimation : notes trop longues et réponses invalides ne changent aucun des deux champs', async () => {
  const long = fixture('N'.repeat(970));
  await long.button.handlers.click();
  assert.equal(long.amount.value, '520000');
  assert.equal(long.noteInput.value, 'N'.repeat(970));
  assert.match(long.output.textContent, /Pas assez de place dans les notes/);
  assert.equal(long.output.children.length, 0);
  assert.equal(long.button.disabled, false);

  const malformed = fixture('Notes personnelles.', {
    estimate_cents: NaN, estimation_note: REPORT,
  });
  await malformed.button.handlers.click();
  assert.equal(malformed.amount.value, '520000');
  assert.equal(malformed.noteInput.value, 'Notes personnelles.');
  assert.match(malformed.output.textContent, /valeur invalide/);

  const incomplete = fixture('Notes personnelles.', {
    estimate_cents: 70000000, estimation_note: 'texte non vérifié',
  });
  await incomplete.button.handlers.click();
  assert.equal(incomplete.amount.value, '520000');
  assert.equal(incomplete.noteInput.value, 'Notes personnelles.');
  assert.match(incomplete.output.textContent, /Pas assez de place/);
});

test('estimation : un changement de surface pendant la recherche empêche l’écrasement des champs', async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const f = fixture(undefined, null, () => wait);
  const pending = f.button.handlers.click();
  assert.equal(f.button.disabled, true);
  f.form.surface_m2.value = '200';
  release(f.estimate);
  await pending;
  assert.equal(f.amount.value, '520000');
  assert.equal(f.noteInput.value, 'Jardin clos, portail électrique.');
  assert.match(f.output.textContent, /Relancez l’estimation/);
  assert.equal(f.button.disabled, false);
});

test('estimation : ne remplace pas une valeur saisie pendant la recherche, mais conserve les nouvelles notes', async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const changed = fixture(undefined, null, () => wait);
  const pending = changed.button.handlers.click();
  changed.amount.value = '600000';
  release(changed.estimate);
  await pending;
  assert.equal(changed.amount.value, '600000');
  assert.equal(changed.noteInput.value, 'Jardin clos, portail électrique.');
  assert.match(changed.output.textContent, /éviter d’écraser votre saisie/);

  let release2;
  const wait2 = new Promise((resolve) => { release2 = resolve; });
  const notesChanged = fixture(undefined, null, () => wait2);
  const pending2 = notesChanged.button.handlers.click();
  notesChanged.noteInput.value = 'Notes nouvelles ajoutées pendant la recherche.';
  release2(notesChanged.estimate);
  await pending2;
  assert.equal(notesChanged.amount.value, '756000');
  assert.ok(notesChanged.noteInput.value.startsWith('Notes nouvelles ajoutées pendant la recherche.'));
  assert.ok(notesChanged.noteInput.value.includes(REPORT));
});

test('estimation : une erreur réseau ne modifie ni valeur ni notes', async () => {
  const f = fixture(undefined, null, () => Promise.reject(new Error('Service indisponible')));
  await f.button.handlers.click();
  assert.equal(f.amount.value, '520000');
  assert.equal(f.noteInput.value, 'Jardin clos, portail électrique.');
  assert.equal(f.output.textContent, 'Service indisponible');
  assert.equal(f.button.disabled, false);
});
