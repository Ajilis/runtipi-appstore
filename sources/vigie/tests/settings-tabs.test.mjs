import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/app.css', import.meta.url), 'utf8');
const settings = app.slice(app.indexOf('  async function pageSettings('), app.indexOf('  // Mon compte :'));
assert.ok(settings.length > 5000, 'la page Réglages doit être présente');

test('réglages : tous les thèmes visibles selon les permissions sont couverts', () => {
  for (const key of ['general', 'titulaires', 'devises', 'donnees', 'etablissements', 'emails', 'securite']) {
    assert.match(settings, new RegExp("'"+key+"'"), 'onglet manquant : ' + key);
  }
  for (const key of ['general', 'titulaires', 'devises', 'donnees', 'securite']) {
    assert.match(settings, new RegExp('data-settings-group="'+key+'"'), 'section orpheline : ' + key);
  }
  assert.match(app, /id="mail-section" data-settings-group="emails"/);
  assert.match(app, /data-settings-group="etablissements"/);
});

test('réglages : changement accessible, clavier et mémorisation', () => {
  assert.match(settings, /role="tablist"/);
  assert.match(settings, /role="tab"/);
  assert.match(settings, /setAttribute\('role', 'tabpanel'\)/);
  assert.match(settings, /setAttribute\('aria-labelledby', 'settings-tab-' \+ key\)/);
  assert.match(settings, /aria-controls="settings-panel-/);
  assert.match(settings, /aria-selected/);
  assert.match(settings, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
  assert.match(settings, /panel.hidden = id !== key/);
  assert.match(settings, /store\.get\('settingsTab'/);
  assert.match(settings, /store\.set\('settingsTab'/);
  assert.match(css, /\.settings-tabs button\[aria-selected="true"\]/);
  assert.match(css, /\.settings-tab-panel/);
});

test('réglages : gestion des données et formulaires existants conservés', () => {
  for (const id of ['settings-form', 'owner-form', 'rate-form', 'mail-form', 'import-file']) {
    assert.ok(app.includes('id="'+id+'"'), 'formulaire existant manquant : ' + id);
  }
  for (const action of ['backup-now', 'ecb-rates', 'import']) {
    assert.ok(settings.includes(action), 'action existante manquante : ' + action);
  }
  assert.match(settings, /\['donnees', 'Données'/);
  assert.match(settings, /\['securite', 'Sécurité'/);
  assert.match(settings, /\.appendChild\(section\)/);
});
