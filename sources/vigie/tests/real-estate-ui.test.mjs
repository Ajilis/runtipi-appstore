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

function fixture(notes = 'Jardin clos, portail électrique.', result = null) {
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
      return estimate;
    },
    money: (centimes) => String(Math.round(centimes / 100)) + ' €',
    centsInput: (centimes) => String(centimes / 100),
    document: { createElement(tag) {
      assert.equal(tag, 'button');
      return {
        handlers: {},
        addEventListener(event, fn) { this.handlers[event] = fn; },
      };
    } },
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

test('estimation : la recherche ne modifie rien avant clic Appliquer, puis remplit valeur ET notes', async () => {
  const f = fixture();
  await f.button.handlers.click();
  assert.equal(f.amount.value, '520000', 'pas de mise à jour avant confirmation');
  assert.equal(f.noteInput.value, 'Jardin clos, portail électrique.');
  assert.equal(f.output.children.length, 1, 'le bouton d’application reste dans le formulaire');
  assert.equal(f.output.children[0].type, 'button');
  assert.equal(f.output.children[0].textContent, 'Appliquer à la valeur actuelle et aux notes');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].params.property_type, 'maison');
  assert.equal(f.requests[0].params.surface_m2, 180);
  assert.ok(!JSON.stringify(f.requests).includes('520000'), 'le prix actuel n’est pas transmis');
  f.output.children[0].handlers.click();
  assert.equal(f.amount.value, '756000');
  assert.ok(f.noteInput.value.startsWith('Jardin clos, portail électrique.'));
  assert.ok(f.noteInput.value.includes(REPORT));
  assert.deepEqual(f.amount.dispatched, ['input']);
  assert.deepEqual(f.noteInput.dispatched, ['input']);
  assert.match(f.output.textContent, /Enregistrez le bien/);
});

test('estimation : notes trop longues et caractéristiques changées sont refusées sans modification', async () => {
  const long = fixture('N'.repeat(970));
  await long.button.handlers.click();
  long.output.children[0].handlers.click();
  assert.equal(long.amount.value, '520000');
  assert.equal(long.noteInput.value, 'N'.repeat(970));
  assert.match(long.output.textContent, /Pas assez de place dans les notes/);

  const changed = fixture();
  await changed.button.handlers.click();
  changed.form.surface_m2.value = '200';
  changed.output.children[0].handlers.click();
  assert.equal(changed.amount.value, '520000');
  assert.equal(changed.noteInput.value, 'Jardin clos, portail électrique.');
  assert.match(changed.output.textContent, /Relancez l’estimation/);
});
