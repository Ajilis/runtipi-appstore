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

test('réglages : sécurité du serveur modifiable par formulaire administrateur', () => {
  assert.match(settings, /id="security-settings-form"/);
  for (const field of ['session_idle_minutes', 'session_max_hours', 'login_max_attempts', 'login_lock_minutes', 'require_2fa', 'institution_logos', 'institution_logos_fallback', 'current_password']) {
    assert.match(settings, new RegExp('name="' + field + '"'));
  }
  assert.match(settings, /require_2fa_forced/);
  assert.match(settings, /securityForm\.addEventListener\('submit'/);
  assert.match(settings, /api\('PUT', '\/api\/admin\/security'/);
  assert.match(settings, /response\.needs_2fa_setup/);
  assert.match(settings, /Enregistrer la sécurité/);
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

 
// Régression de 0.9.1 : querySelector() renvoie un seul élément, pas une liste.
// Exécuter le code réel d'initialisation avec un DOM minimal permet de vérifier
// la sélection, les sections multiples, le clavier et les droits sans navigateur.
import { runInNewContext } from 'node:vm';

const tabsStart = settings.indexOf("    const nav = $('#settings-tabs', el);");
const tabsEnd = settings.indexOf('    if (mail) bindMailForm(mail);', tabsStart);
assert.ok(tabsStart >= 0 && tabsEnd > tabsStart, 'initialisation des onglets introuvable');
const tabInitialization = settings.slice(tabsStart, tabsEnd);

function simulateSettingsTabs(keys, requested = null) {
  const nav = {
    handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    contains(button) { return buttons.includes(button); },
  };
  const buttons = keys.map((key) => ({
    dataset: { settingsTab: key },
    attributes: {},
    tabIndex: -1,
    setAttribute(name, value) { this.attributes[name] = String(value); },
    focus() { this.focused = true; },
  }));
  const sections = [
    { group: 'general', name: 'preferences' },
    { group: 'titulaires', name: 'owners' },
    { group: 'devises', name: 'rates' },
    { group: 'donnees', name: 'export' },
    { group: 'donnees', name: 'import' },
    { group: 'donnees', name: 'backups' },
    { group: 'etablissements', name: 'logos' },
    { group: 'emails', name: 'smtp' },
    { group: 'securite', name: 'security' },
  ];
  const el = { children: [], appendChild(panel) { this.children.push(panel); } };
  const storeData = {};
  const location = { hash: requested ? '#/reglages/' + requested : '#/reglages' };
  const context = {
    el, route: { arg: requested }, location,
    history: { replaceState(_state, _title, hash) { location.hash = hash; } },
    store: { get(k, fallback) { return storeData[k] ?? fallback; }, set(k, v) { storeData[k] = v; } },
    settingsTabs: keys.map((key) => [key, key, 'icon']),
    document: { createElement() { return {
      children: [], attributes: {}, hidden: false,
      setAttribute(name, value) { this.attributes[name] = String(value); },
      appendChild(child) { this.children.push(child); },
    }; } },
    $: (selector, root) => {
      assert.equal(selector, '#settings-tabs');
      assert.equal(root, el);
      return nav;
    },
    $$: (selector, root) => {
      if (selector === '[data-settings-tab]') {
        assert.equal(root, nav);
        return buttons;
      }
      const match = /^\[data-settings-group="([^"]+)"\]$/.exec(selector);
      if (!match) throw Error('Unexpected selector: ' + selector);
      assert.equal(root, el);
      return sections.filter((section) => section.group === match[1]);
    },
  };
  const output = runInNewContext('(() => {\n' + tabInitialization + '\nreturn {panels,buttons};\n})()', context);
  return { ...output, nav, el, buttons, storeData, location };
}

test('réglages : monte les sections avec querySelectorAll sans TypeError', () => {
  const result = simulateSettingsTabs(['general', 'titulaires', 'devises', 'donnees', 'etablissements', 'emails', 'securite']);
  assert.equal(result.el.children.length, 7);
  assert.deepEqual(Array.from(result.panels.get('donnees').children, (x) => x.name), ['export', 'import', 'backups']);
  assert.deepEqual(Array.from(result.panels.get('etablissements').children, (x) => x.name), ['logos']);
  assert.equal(result.panels.get('general').hidden, false);
  assert.equal(result.panels.get('securite').hidden, true);
  assert.equal(result.buttons[0].attributes['aria-selected'], 'true');
  assert.equal(result.buttons[0].tabIndex, 0);
});

test('réglages : sélection d’un onglet et contrôle clavier fonctionnels', () => {
  const result = simulateSettingsTabs(['general', 'titulaires', 'devises', 'donnees']);
  result.nav.handlers.click({ target: { closest: () => result.buttons[2] } });
  assert.equal(result.panels.get('devises').hidden, false);
  assert.equal(result.panels.get('general').hidden, true);
  assert.equal(result.storeData.settingsTab, 'devises');
  assert.equal(result.location.hash, '#/reglages/devises');

  let prevented = false;
  result.nav.handlers.keydown({
    key: 'ArrowRight', target: { closest: () => result.buttons[2] },
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(result.panels.get('donnees').hidden, false);
  assert.equal(result.buttons[3].attributes['aria-selected'], 'true');
  assert.equal(result.buttons[3].focused, true);
});

test('réglages : un lien direct ouvre le bon onglet, même sans droits administrateur', () => {
  const result = simulateSettingsTabs(['general', 'titulaires', 'devises', 'donnees'], 'devises');
  assert.equal(result.panels.get('devises').hidden, false);
  assert.equal(result.panels.get('general').hidden, true);
  assert.equal(result.el.children.length, 4);
  assert.equal(result.panels.get('securite'), undefined);
});
