// Sandbox provider: behaves like a LinkedIn account (search, invitations,
// acceptances, replies) without touching LinkedIn. Lets you test campaigns,
// the AI setter and booking end to end.
import { pick, rand } from '../../lib/util.js';

const FIRST = ['Camille', 'Julien', 'Sophie', 'Thomas', 'Léa', 'Nicolas', 'Claire', 'Antoine', 'Inès', 'Mathieu', 'Sarah', 'Hugo', 'Manon', 'Romain', 'Élodie', 'Karim', 'Aurélie', 'Maxime', 'Nadia', 'Bastien', 'Chloé', 'Yanis', 'Pauline', 'Olivier'];
const LAST = ['Martin', 'Bernard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefèvre', 'Michel', 'Garcia', 'Roux', 'Fournier', 'Girard', 'Bonnet', 'Mercier', 'Benali', 'Rousseau', 'Faure', 'Chevalier'];
const COMPANIES = ['Novalys', 'Atelier Brume', 'Kiwano Tech', 'Grand Ouest Logistique', 'Lumen Conseil', 'Ferrante & Associés', 'Studio Oblique', 'Helio Santé', 'Vertigo Data', 'Maison Alba', 'Cobalt Industrie', 'Pragma RH', 'Tandem Finance', 'Orée Formation', 'Bleu Marine SaaS', 'Archipel Digital'];
const INDUSTRIES = ['Logiciels', 'Conseil', 'Industrie', 'Santé', 'Formation', 'Services financiers', 'E-commerce', 'Transport et logistique', 'Marketing et publicité'];
const CITIES = ['Paris', 'Lyon', 'Nantes', 'Bordeaux', 'Lille', 'Toulouse', 'Marseille', 'Rennes', 'Strasbourg', 'Montpellier'];
const DEFAULT_TITLES = ['Fondateur', 'CEO', 'Directeur commercial', 'Head of Sales', 'Directrice marketing', 'DRH', 'Directeur général'];

const REPLIES = {
  interested: ['Avec plaisir, quand seriez-vous disponible ?', 'Oui pourquoi pas, ça m\'intéresse. On s\'appelle ?', 'Bonjour, oui volontiers pour en parler.'],
  question: ['Ok, mais concrètement vous faites quoi ?', 'Merci. Vous avez un exemple de client comme nous ?', 'Intéressant. Comment ça marche exactement ?'],
  later: ['Pas le moment là, recontactez-moi en janvier.', 'On est débordés, revenez vers moi dans 2 mois.', 'C\'est trop tôt, plutôt à la rentrée.'],
  no: ['Merci mais pas intéressé.', 'Non merci, nous avons déjà un prestataire et ça nous convient.'],
  objection: ['On a déjà quelqu\'un en interne pour ça.', 'Pas de budget pour le moment.'],
  price: ['Combien ça coûte ?'],
};

const SCENARIOS = ['interested', 'interested', 'interested', 'question', 'question', 'later', 'no', 'objection', 'price'];

function slug(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function fakeProspects(icp = {}, n = 10) {
  const titles = (icp.titles && icp.titles.length ? icp.titles : DEFAULT_TITLES);
  const locations = (icp.locations && icp.locations.length ? icp.locations : ['France']);
  const industries = (icp.industries && icp.industries.length ? icp.industries : INDUSTRIES);
  const out = [];
  for (let i = 0; i < n; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const company = pick(COMPANIES);
    const title = Math.random() < 0.8 ? pick(titles) : pick(['Consultant indépendant', 'Chargé de projet', 'Étudiant', 'Office manager']);
    const city = pick(CITIES);
    const loc = /france/i.test(locations[0]) ? `${city}, France` : pick(locations);
    const signals = [];
    const r = Math.random();
    const daysAgo = () => new Date(Date.now() - Math.floor(rand(0, 40)) * 86400000).toISOString();
    if (r < 0.25) signals.push({ type: 'new_role', label: 'Nouveau poste', detail: `${title} chez ${company} depuis peu`, date: daysAgo() });
    else if (r < 0.45) signals.push({ type: 'hiring', label: 'Recrute', detail: `${company} recrute ${Math.ceil(rand(2, 6))} personnes`, date: daysAgo() });
    else if (r < 0.58) signals.push({ type: 'funding', label: 'Levée de fonds', detail: `${company} a levé ${Math.ceil(rand(1, 12))} M€`, date: daysAgo() });
    else if (r < 0.72) signals.push({ type: 'profile_visit', label: 'A visité votre profil', date: daysAgo() });
    else if (r < 0.85) signals.push({ type: 'post_engagement', label: 'A réagi à votre publication', detail: 'Commentaire sur votre dernier post', date: daysAgo() });
    const id = `sim-${slug(first)}-${slug(last)}-${Math.random().toString(36).slice(2, 7)}`;
    out.push({
      full_name: `${first} ${last}`,
      first_name: first,
      last_name: last,
      title,
      headline: `${title} chez ${company}`,
      company,
      industry: pick(industries),
      location: loc,
      linkedin_url: `https://www.linkedin.com/in/${id}`,
      provider_id: id,
      signals,
      source: 'simulation',
    });
  }
  return out;
}

export default {
  id: 'simulation',
  label: 'Simulation (bac à sable)',
  auto: true,
  capabilities: { search: true, invite: true, message: true },

  async test() {
    return { ok: true, detail: 'Compte de simulation prêt. Aucun message n\'est envoyé sur LinkedIn.' };
  },

  async search(account, icp, { limit = 10 } = {}) {
    return fakeProspects(icp, limit);
  },

  async invite(account, prospect) {
    return { provider_id: prospect.provider_id || `sim-${prospect.id}` };
  },

  async sendMessage(account, prospect) {
    return { chat_id: prospect.chat_id || `simchat-${prospect.id}`, message_id: `simmsg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
  },

  /**
   * ctx.db, ctx.config are provided by the worker. Returns provider events.
   */
  async sync(account, ctx) {
    const { db, config } = ctx;
    const speed = Math.max(1, Number(config.simulation?.speed) || 1);
    const acceptRate = Number(config.simulation?.accept_rate ?? 0.5);
    const replyRate = Number(config.simulation?.reply_rate ?? 0.55);
    const events = [];
    const now = Date.now();

    // Acceptances: invited prospects, after a simulated delay (2h to 2 days / speed).
    const invited = await db.query(
      `SELECT id, provider_id, invited_at, setter_state FROM prospects WHERE status = 'invited' AND campaign_id IN (SELECT id FROM campaigns WHERE account_id = $1)`,
      [account.id],
    );
    for (const p of invited.rows) {
      const sim = p.setter_state.sim || {};
      if (!sim.accept_at) {
        const willAccept = Math.random() < acceptRate;
        const delay = rand(2 * 3600e3, 48 * 3600e3) / speed;
        sim.accept_at = willAccept ? new Date(new Date(p.invited_at).getTime() + delay).toISOString() : 'never';
        sim.scenario = pick(SCENARIOS);
        sim.will_reply = Math.random() < replyRate;
        await db.query(`UPDATE prospects SET setter_state = setter_state || $2::jsonb WHERE id = $1`, [p.id, JSON.stringify({ sim })]);
      }
      if (sim.accept_at !== 'never' && new Date(sim.accept_at).getTime() <= now) {
        events.push({ type: 'accepted', prospect_id: p.id });
      }
    }

    // Replies: prospects whose last message is outbound and who are due to answer.
    const active = await db.query(
      `SELECT p.id, p.setter_state, p.status,
              (SELECT row_to_json(m) FROM (SELECT direction, body, sent_at, kind FROM messages WHERE prospect_id = p.id AND status IN ('sent','received') ORDER BY coalesce(sent_at, created_at) DESC LIMIT 1) m) AS last
         FROM prospects p
        WHERE p.status IN ('contacted', 'replied', 'meeting') AND p.campaign_id IN (SELECT id FROM campaigns WHERE account_id = $1)`,
      [account.id],
    );
    for (const p of active.rows) {
      const last = p.last;
      if (!last || last.direction !== 'out' || !last.sent_at) continue;
      if (last.kind === 'reminder' || last.kind === 'invite') continue;
      const sim = p.setter_state.sim || {};
      if (sim.done) continue;
      const turn = sim.turn || 0;
      if (turn === 0 && !sim.will_reply) continue;
      const key = `reply_at_${turn}`;
      if (!sim[key]) {
        sim[key] = new Date(new Date(last.sent_at).getTime() + rand(20 * 60e3, 20 * 3600e3) / speed).toISOString();
        await db.query(`UPDATE prospects SET setter_state = setter_state || $2::jsonb WHERE id = $1`, [p.id, JSON.stringify({ sim })]);
        continue;
      }
      if (new Date(sim[key]).getTime() > now) continue;

      let text = null;
      const proposed = p.setter_state.proposed || [];
      if (turn === 0) text = pick(REPLIES[sim.scenario] || REPLIES.interested);
      else if (proposed.length && p.status !== 'meeting') {
        const iso = pick(proposed);
        const d = new Date(iso);
        const label = new Intl.DateTimeFormat('fr-FR', { timeZone: ctx.timezone || 'Europe/Paris', weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(d).replace(':', 'h').replace(/h00$/, 'h');
        text = pick([`Parfait, va pour ${label}.`, `${label.charAt(0).toUpperCase() + label.slice(1)} me va très bien.`, `Ok pour ${label} !`]);
      } else if (['question', 'objection'].includes(sim.scenario) && turn === 1) {
        text = pick(['D\'accord, pourquoi pas un appel alors.', 'Ok, ça me parle. On peut en discuter.']);
      } else if (p.status === 'meeting' && turn < 4) {
        text = pick(['Merci, à bientôt !', 'Top, c\'est noté.']);
        sim.done = true;
      } else {
        sim.done = true;
      }
      sim.turn = turn + 1;
      await db.query(`UPDATE prospects SET setter_state = setter_state || $2::jsonb WHERE id = $1`, [p.id, JSON.stringify({ sim })]);
      if (text) events.push({ type: 'message', prospect_id: p.id, text, at: new Date().toISOString(), provider_message_id: `simin-${p.id}-${turn}` });
    }
    return events;
  },
};
