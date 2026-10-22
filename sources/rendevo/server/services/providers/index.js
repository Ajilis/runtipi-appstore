import simulation from './simulation.js';
import unipile from './unipile.js';
import linkedinCookie from './linkedin-cookie.js';

// "manual": Rendevo prepares every invitation and message, you send them from
// LinkedIn yourself and paste replies back. No automation, no third party.
const manual = {
  id: 'manual',
  label: 'Manuel (copier-coller)',
  auto: false,
  capabilities: { search: false, invite: false, message: false },
  async test() { return { ok: true, detail: 'Mode manuel : les messages préparés apparaissent dans "À envoyer".' }; },
};

// Optional browser companion: no session cookies, no LinkedIn network activity.
const linkedinCompanion = {
  id: 'linkedin_companion',
  label: 'LinkedIn Companion (extension Chrome, assisté)',
  auto: false,
  capabilities: { search: false, invite: false, message: false },
  async test() {
    return { ok: true, detail: 'Compte Companion prêt pour les actions manuelles. Aucun accès réseau à LinkedIn ni session vérifiée.' };
  },
};

export const PROVIDERS = { simulation, unipile, linkedin_cookie: linkedinCookie, linkedin_companion: linkedinCompanion, manual };

export function getProvider(id) {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Fournisseur inconnu : ${id}`);
  return p;
}

export function providerList() {
  return Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, auto: p.auto, capabilities: p.capabilities }));
}
