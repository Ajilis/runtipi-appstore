// LLM access (OpenAI-compatible or Anthropic) + every generation task of the
// agent. Each task has a deterministic fallback so the product keeps working
// without an API key (useful for tests and for the "manual" mode).
import { formatSlotFr, formatSlotEn, pick } from '../lib/util.js';
import { listOpenAIModels, normalizeOpenAIBaseUrl } from './ai-models.js';

export class AiService {
  constructor({ config, vault, logger = console, fetcher = fetch }) {
    this.fetcher = fetcher;
    this.config = config;
    this.vault = vault;
    this.logger = logger;
  }

  settingsFor(ws) {
    const s = (ws && ws.settings && ws.settings.ai) || {};
    const base = this.config.ai || {};
    const provider = s.provider || base.provider || 'none';
    const baseUrl = (s.base_url || base.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
    // Never send an API key configured for one host to a different host.
    const sameDefault = provider === base.provider
      && baseUrl === String(base.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
    return {
      provider, base_url: baseUrl,
      model: s.model || base.model || '',
      api_key: s.api_key_enc ? this.vault.decrypt(s.api_key_enc)
        : sameDefault ? base.api_key || '' : '',
      temperature: s.temperature ?? base.temperature ?? 0.7,
    };
  }

  enabled(ws) {
    const s = this.settingsFor(ws);
    if (s.provider === 'none' || !s.model) return false;
    if (s.provider === 'anthropic') return !!s.api_key;
    return true; // OpenAI-compatible endpoints like Ollama may not need a key
  }

  async complete(ws, { system, user, maxTokens = 700, temperature, settingsOverride }) {
    const s = settingsOverride || this.settingsFor(ws);
    if (s.provider === 'none' || !s.model || (s.provider === 'anthropic' && !s.api_key)) throw new Error('IA non configurée');
    const t = temperature ?? s.temperature;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      if (s.provider === 'anthropic') {
        const base = s.base_url.includes('anthropic.com') ? s.base_url : 'https://api.anthropic.com/v1';
        const res = await this.fetcher(`${base}/messages`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': s.api_key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: s.model, max_tokens: maxTokens, temperature: t, system, messages: [{ role: 'user', content: user }] }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error?.message || `Anthropic HTTP ${res.status}`);
        return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
      }
      const headers = { 'content-type': 'application/json' };
      if (s.api_key) headers.authorization = `Bearer ${s.api_key}`;
      const res = await this.fetcher(`${normalizeOpenAIBaseUrl(s.base_url)}/chat/completions`, {
        redirect: 'error',
        method: 'POST',
        signal: ctrl.signal,
        headers,
        body: JSON.stringify({
          model: s.model,
          temperature: t,
          max_tokens: maxTokens,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = String(data.error?.message || '').slice(0, 220).replaceAll(s.api_key || '\\0', '[secret]');
        throw new Error('LLM HTTP ' + res.status + (detail ? ' : ' + detail : ''));
      }
      const message = data.choices?.[0]?.message?.content;
      if (typeof message !== 'string' || !message.trim()) throw new Error('Réponse IA vide ou format incompatible');
      return message.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  async completeJson(ws, opts) {
    const text = await this.complete(ws, opts);
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Réponse IA sans JSON');
    return JSON.parse(m[0]);
  }

  async listModels({ baseUrl, apiKey = '' }) {
    return listOpenAIModels({ baseUrl, apiKey, fetcher: this.fetcher });
  }

  async test(ws, { settingsOverride } = {}) {
    const t0 = Date.now();
    const out = await this.complete(ws, {
      system: 'Tu réponds en un mot.', user: 'Réponds simplement: OK',
      maxTokens: 16, temperature: 0, settingsOverride,
    });
    return { ok: true, sample: out.slice(0, 50), ms: Date.now() - t0 };
  }

  // ---------------------------------------------------------------- context
  context(ws, campaign) {
    const st = ws.settings || {};
    const offer = st.offer || {};
    const voice = st.voice || {};
    return {
      offer,
      voice,
      offerText: [
        campaign?.offer || offer.summary || '',
        offer.value_prop ? `Proposition de valeur : ${offer.value_prop}` : '',
        offer.proof ? `Preuves : ${offer.proof}` : '',
        offer.cta ? `Objectif de conversation : ${offer.cta}` : '',
      ].filter(Boolean).join('\n'),
      sender: voice.sender_name || ws.ownerName || '',
      formality: voice.formality || 'vous',
      tone: voice.tone || 'direct, chaleureux, sans jargon commercial',
      examples: (voice.examples || []).filter(Boolean).slice(0, 4),
      signature: voice.signature || '',
    };
  }

  prospectCard(p) {
    const signals = (p.signals || []).map((s) => `- ${s.label}${s.detail ? ` : ${s.detail}` : ''}${s.date ? ` (${String(s.date).slice(0, 10)})` : ''}`).join('\n');
    return [
      `Nom : ${p.full_name}`,
      p.title ? `Poste : ${p.title}` : '',
      p.headline ? `Titre LinkedIn : ${p.headline}` : '',
      p.company ? `Entreprise : ${p.company}` : '',
      p.industry ? `Secteur : ${p.industry}` : '',
      p.location ? `Lieu : ${p.location}` : '',
      signals ? `Signaux récents :\n${signals}` : '',
      p.notes ? `Notes : ${p.notes}` : '',
    ].filter(Boolean).join('\n');
  }

  languageFor(p, campaign) {
    const lang = campaign?.settings?.language;
    if (lang && lang !== 'auto') return lang;
    if (p.language) return p.language;
    const txt = `${p.headline} ${p.location}`.toLowerCase();
    if (/\b(france|paris|lyon|marseille|bordeaux|lille|toulouse|nantes|belgique|bruxelles|québec|montréal|suisse|genève|lausanne)\b/.test(txt)) return 'fr';
    if (/\b(the|and|of|manager|head|london|new york|berlin|usa|uk)\b/.test(txt) && !/\b(responsable|directeur|directrice|fondateur|gérant)\b/.test(txt)) return 'en';
    return 'fr';
  }

  // -------------------------------------------------------- offer analysis
  async analyzeOffer(ws, { url, pageText, title, description, extra }) {
    if (this.enabled(ws)) {
      try {
        const out = await this.completeJson(ws, {
          system: "Tu es un expert en prospection B2B. Tu analyses une offre pour configurer un agent de prospection LinkedIn. Réponds uniquement en JSON valide, en français.",
          user: `Analyse cette offre et déduis la cible idéale.\nURL : ${url || '-'}\nTitre : ${title || '-'}\nDescription : ${description || '-'}\nTexte :\n${(pageText || '').slice(0, 7000)}\n${extra ? `Précisions de l'utilisateur : ${extra}` : ''}\n\nJSON attendu : {"offer_name": "", "summary": "2 phrases", "value_prop": "1 phrase", "proof": "chiffres ou références trouvés", "cta": "objectif de conversation, ex: appel découverte de 30 min", "icp": {"titles": ["5 à 8 intitulés de poste"], "industries": ["3 à 6"], "locations": ["pays ou villes"], "company_sizes": ["ex: 11-50"], "keywords": ["mots-clés de besoin"], "exclusions": ["profils à exclure"]}, "angles": ["3 angles d'accroche liés à des signaux d'achat"], "tone": "ton recommandé"}`,
          maxTokens: 1200,
          temperature: 0.3,
        });
        return { ...out, source: 'ai' };
      } catch (e) {
        this.logger.warn('[ai] analyzeOffer fallback:', e.message);
      }
    }
    const text = `${extra || ''} ${title || ''}. ${description || ''}. ${pageText || ''}`.replace(/^\s*\.\s*/, '');
    const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 30 && s.length < 260);
    const lower = text.toLowerCase();
    const titles = [];
    if (/startup|scale|saas|logiciel|software/.test(lower)) titles.push('Fondateur', 'CEO', 'CTO');
    if (/vente|sales|commercial|prospection|leads/.test(lower)) titles.push('Directeur commercial', 'Head of Sales');
    if (/marketing|marque|contenu|seo|ads/.test(lower)) titles.push('Directeur marketing', 'Head of Marketing');
    if (/rh|recrutement|talent|onboarding|formation/.test(lower)) titles.push('DRH', 'Responsable RH');
    if (/finance|comptab|cfo|trésorerie/.test(lower)) titles.push('DAF', 'CFO');
    if (/cyber|sécurité|security|it\b|informatique/.test(lower)) titles.push('DSI', 'RSSI');
    if (!titles.length) titles.push('Fondateur', 'Dirigeant', 'Gérant');
    return {
      offer_name: title || '',
      summary: sentences.slice(0, 2).join(' ') || description || String(extra || '').trim(),
      value_prop: description || (sentences[0] || '').replace(/^J'aide /, 'Aider ') || '',
      proof: (text.match(/[+-]?\d+[ \u00a0]?(%|clients|ans|projets|entreprises|PME|missions|rendez-vous|k€|M€)/gi) || []).slice(0, 4).join(', '),
      cta: 'Appel découverte de 30 minutes',
      icp: { titles: [...new Set(titles)], industries: [], locations: ['France'], company_sizes: ['2-10', '11-50', '51-200'], keywords: [], exclusions: ['Étudiant', 'Stagiaire', 'Recruteur'] },
      angles: ['Nouveau poste : premiers chantiers', 'Recrutement en cours : montée en charge', 'Levée de fonds : accélération'],
      tone: 'Direct et chaleureux',
      source: 'heuristic',
    };
  }

  // ------------------------------------------------------------- messages
  async writeMessage(ws, campaign, p, { kind, step = {}, history = [], media = null, slots = null }) {
    const c = this.context(ws, campaign);
    const lang = this.languageFor(p, campaign);
    if (this.enabled(ws)) {
      try {
        const kindLabel = {
          invite: "note d'invitation LinkedIn (300 caractères maximum, sans pitch, juste une raison crédible de se connecter)",
          first: 'premier message après acceptation (court, 3 à 5 phrases, une seule question ouverte à la fin)',
          followup: `relance n°${step.number || 1} (courte, apporte un nouvel élément, ne répète pas les messages précédents)`,
          callback: 'reprise de contact à la date demandée par le prospect',
          noshow: "message après un rendez-vous manqué (bienveillant, propose de reprogrammer)",
          reminder: 'rappel chaleureux le jour du rendez-vous',
        }[kind] || kind;
        const hist = history.slice(-8).map((m) => `${m.direction === 'out' ? 'Moi' : 'Prospect'} : ${m.body}`).join('\n');
        const out = await this.complete(ws, {
          system: [
            `Tu écris des messages LinkedIn au nom de ${c.sender || "l'expéditeur"}, comme un humain, jamais comme un robot.`,
            `Langue : ${lang === 'fr' ? 'français' : lang === 'en' ? 'anglais' : lang}. ${lang === 'fr' ? `Utilise le ${c.formality}.` : ''}`,
            `Ton : ${c.tone}. Pas d'emoji sauf s'ils figurent dans les exemples. Pas de formules creuses ("j'espère que vous allez bien"). Pas de liens sauf ceux fournis.`,
            'Ne mentionne jamais que tu es une IA ou un outil. N\'invente aucun chiffre, client ou fait absent du contexte.',
            c.examples.length ? `Exemples de messages de l'expéditeur à imiter :\n${c.examples.map((e) => `---\n${e}`).join('\n')}` : '',
            'Réponds uniquement avec le texte du message, sans guillemets ni commentaire.',
          ].filter(Boolean).join('\n'),
          user: [
            `Type : ${kindLabel}.`,
            `Offre de l'expéditeur :\n${c.offerText || '(non renseignée)'}`,
            `Prospect :\n${this.prospectCard(p)}`,
            hist ? `Historique de la conversation :\n${hist}` : '',
            step.instructions ? `Consignes pour ce message : ${step.instructions}` : '',
            media ? `Ajoute ce lien vidéo à la fin, présenté simplement : ${media.url}` : '',
            slots ? `Propose ces créneaux exacts : ${slots.map((s) => s.label).join(' ; ')}` : '',
            c.signature && kind !== 'invite' ? `Signature : ${c.signature}` : '',
          ].filter(Boolean).join('\n\n'),
          maxTokens: kind === 'invite' ? 160 : 500,
        });
        let text = out.replace(/^["«]|["»]$/g, '').trim();
        if (kind === 'invite' && text.length > 300) text = text.slice(0, 297).replace(/\s+\S*$/, '') + '…';
        return text;
      } catch (e) {
        this.logger.warn(`[ai] writeMessage(${kind}) fallback:`, e.message);
      }
    }
    return templateMessage({ kind, p, c, lang, step, media, slots });
  }

  // ------------------------------------------------------------ AI setter
  async setterTurn(ws, campaign, p, { history, slots, timezone }) {
    const last = [...history].reverse().find((m) => m.direction === 'in');
    const lastText = last ? last.body : '';
    const proposed = (p.setter_state?.proposed || []).map((iso) => ({ iso, label: formatSlotFr(new Date(iso), timezone) }));
    const ruleChoice = matchSlotChoice(lastText, proposed, timezone);
    const c = this.context(ws, campaign);
    const lang = this.languageFor(p, campaign);
    if (this.enabled(ws)) {
      try {
        const hist = history.slice(-12).map((m) => `${m.direction === 'out' ? 'Moi' : 'Prospect'} : ${m.body}`).join('\n');
        const out = await this.completeJson(ws, {
          system: [
            `Tu es le setter commercial de ${c.sender || "l'expéditeur"} sur LinkedIn. Ton objectif : ${c.offer.cta || 'obtenir un appel découverte'}, sans forcer.`,
            'Règles : réponds comme un humain, court (2 à 5 phrases), dans la langue du prospect. Une réponse de politesse ("merci", "ok") n\'appelle pas de pitch.',
            'Si le prospect pose une question, réponds-y d\'abord avec les informations de l\'offre uniquement. Traite les objections avec empathie.',
            'Escalade vers un humain (handoff) pour : négociation de prix ou contrat, demande juridique ou sensible, demande de coordonnées non fournies, agressivité, cas ambigu.',
            `Formalité : ${c.formality}. Ton : ${c.tone}.`,
            'Réponds uniquement en JSON : {"intent": "interested|slot_choice|question|objection|later|not_interested|courtesy|handoff", "reply": "texte à envoyer ou vide", "chosen_slot": index du créneau choisi dans la liste proposée (0-based) ou null, "callback_date": "AAAA-MM-JJ ou null", "handoff_reason": "ou null", "propose_slots": true/false}',
          ].join('\n'),
          user: [
            `Offre :\n${c.offerText}`,
            `Prospect :\n${this.prospectCard(p)}`,
            `Conversation :\n${hist}`,
            proposed.length ? `Créneaux déjà proposés : ${proposed.map((s, i) => `[${i}] ${s.label}`).join(' ; ')}` : '',
            slots && slots.length ? `Créneaux libres à proposer si pertinent : ${slots.map((s) => s.label).join(' ; ')}` : 'Aucun créneau libre disponible pour le moment.',
            `Date du jour : ${new Date().toISOString().slice(0, 10)}`,
          ].filter(Boolean).join('\n\n'),
          maxTokens: 600,
          temperature: 0.4,
        });
        if (ruleChoice !== null && (out.chosen_slot === null || out.chosen_slot === undefined)) out.chosen_slot = ruleChoice;
        if (out.intent === 'slot_choice' && (out.chosen_slot === null || out.chosen_slot === undefined)) out.intent = 'interested';
        return { ...out, source: 'ai' };
      } catch (e) {
        this.logger.warn('[ai] setterTurn fallback:', e.message);
      }
    }
    return ruleSetter({ text: lastText, p, c, lang, slots, proposed, ruleChoice });
  }
}

// ------------------------------------------------------------ fallbacks
function signalHook(p, lang) {
  const s = (p.signals || [])[0];
  const company = p.company || (lang === 'fr' ? 'votre entreprise' : 'your company');
  if (!s) return lang === 'fr' ? `J'ai vu votre parcours chez ${company}.` : `I came across your work at ${company}.`;
  const fr = {
    new_role: `Félicitations pour votre nouveau poste chez ${company}.`,
    hiring: `J'ai vu que ${company} recrute en ce moment.`,
    funding: `Bravo pour la levée de fonds de ${company}.`,
    profile_visit: 'Merci pour la visite de mon profil.',
    post_engagement: 'Merci pour votre réaction à ma publication.',
    competitor_engagement: "J'ai vu que vous suiviez les sujets sur lesquels je travaille.",
    topic_post: "J'ai lu votre publication récente, elle m'a parlé.",
    company_news: `J'ai vu l'actualité de ${company}.`,
  };
  const en = {
    new_role: `Congrats on the new role at ${company}.`,
    hiring: `I noticed ${company} is hiring right now.`,
    funding: `Congrats on ${company}'s funding round.`,
    profile_visit: 'Thanks for checking out my profile.',
    post_engagement: 'Thanks for engaging with my post.',
    competitor_engagement: 'I saw you follow the topics I work on.',
    topic_post: 'I read your recent post, it resonated.',
    company_news: `I saw the latest news about ${company}.`,
  };
  return (lang === 'fr' ? fr : en)[s.type] || (lang === 'fr' ? fr.company_news : en.company_news);
}

function templateMessage({ kind, p, c, lang, step, media, slots }) {
  const first = p.first_name || p.full_name.split(' ')[0];
  const tu = c.formality === 'tu';
  const fr = lang === 'fr';
  const hook = signalHook(p, lang);
  const valueProp = c.offer.value_prop || c.offer.summary || '';
  const sig = c.signature ? `\n\n${c.signature}` : '';
  const vous = (a, b) => (tu ? a : b);
  switch (kind) {
    case 'invite':
      return fr ? `Bonjour ${first}, ${hook} ${vous('Je serais ravi de t\'ajouter', 'Je serais ravi de vous ajouter')} à mon réseau.`.slice(0, 300) : `Hi ${first}, ${hook} Would be glad to connect.`.slice(0, 300);
    case 'first':
      return fr
        ? `${hook.startsWith('Merci') ? `Ravi d'être connecté, ${first}.` : `Merci pour la connexion ${first}.`} ${hook}\n\n${valueProp ? `J'accompagne des profils comme ${vous('le tien', 'le vôtre')} : ${valueProp.charAt(0).toLowerCase() + valueProp.slice(1)}` : ''}\n\n${vous('Est-ce un sujet pour toi en ce moment ?', 'Est-ce un sujet pour vous en ce moment ?')}${sig}`
        : `${hook.startsWith('Thanks') ? `Glad we're connected, ${first}.` : `Thanks for connecting ${first}.`} ${hook}\n\n${valueProp ? `I help people in roles like yours: ${valueProp}` : ''}\n\nIs this on your radar right now?${sig}`;
    case 'followup': {
      const n = step.number || 1;
      const frLines = [
        `${first}, je me permets de revenir vers ${vous('toi', 'vous')}. ${c.offer.proof ? `Pour donner une idée : ${c.offer.proof}.` : ''} ${vous('Ça vaut un échange de 20 minutes ?', 'Cela vaudrait-il un échange de 20 minutes ?')}`,
        `Petite relance ${first} : ${vous('veux-tu', 'voulez-vous')} que je ${vous('t\'envoie', 'vous envoie')} un exemple concret de ce que l'on fait pour des ${p.title || 'profils similaires'} ?`,
        `${first}, dernier message de ma part sur ce sujet. Si le timing n'est pas bon, ${vous('dis-moi', 'dites-moi')} simplement quand revenir vers ${vous('toi', 'vous')}.`,
      ];
      const enLines = [
        `${first}, following up. ${c.offer.proof ? `For context: ${c.offer.proof}.` : ''} Worth a 20-minute chat?`,
        `Quick nudge ${first}: want me to share a concrete example of what we do for ${p.title || 'similar roles'}?`,
        `${first}, last note from me. If the timing is off, just tell me when to circle back.`,
      ];
      let text = (fr ? frLines : enLines)[Math.min(n - 1, 2)].replace(/\s+/g, ' ').trim();
      if (media) text += fr ? `\n\nJ'ai enregistré une courte vidéo pour ${vous('toi', 'vous')} : ${media.url}` : `\n\nI recorded a short video for you: ${media.url}`;
      return text + sig;
    }
    case 'callback':
      return fr ? `Bonjour ${first}, comme convenu je reviens vers ${vous('toi', 'vous')}. Est-ce un meilleur moment pour en parler ?${sig}` : `Hi ${first}, circling back as agreed. Is now a better time to talk?${sig}`;
    case 'noshow':
      return fr
        ? `${first}, je crois qu'on s'est manqués tout à l'heure, aucun souci. ${slots && slots.length ? `${vous('Veux-tu', 'Voulez-vous')} reprogrammer ? Je peux ${slots.map((s) => s.label).join(', ou ')}.` : `${vous('Dis-moi', 'Dites-moi')} quand ${vous('tu es', 'vous êtes')} disponible.`}`
        : `${first}, looks like we missed each other, no worries. ${slots && slots.length ? `Want to reschedule? I can do ${slots.map((s) => s.label).join(', or ')}.` : 'Let me know when works for you.'}`;
    case 'reminder':
      return fr ? `Bonjour ${first}, hâte d'échanger avec ${vous('toi', 'vous')} tout à l'heure. Le lien : ${step.meeting_url || ''}`.trim() : `Hi ${first}, looking forward to our call later today. Link: ${step.meeting_url || ''}`.trim();
    default:
      return fr ? `Bonjour ${first}` : `Hi ${first}`;
  }
}

const FR_WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const EN_WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** Finds which proposed slot a prospect picked, from ordinal or day/hour words. */
export function matchSlotChoice(text, proposed, timezone) {
  if (!text || !proposed || !proposed.length) return null;
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const ord = [
    /\b(le )?(1er|premier|1|first|option 1)\b/, /\b(le )?(2e|2eme|deuxieme|second|2|option 2)\b/, /\b(le )?(3e|3eme|troisieme|third|3|option 3)\b/,
  ];
  const scored = proposed.map((s, i) => {
    const d = new Date(s.iso);
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', day: 'numeric', hourCycle: 'h23' }).formatToParts(d);
    const obj = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const wdIdx = EN_WEEKDAYS.indexOf(obj.weekday.toLowerCase());
    let score = 0;
    if (t.includes(FR_WEEKDAYS[wdIdx]) || t.includes(EN_WEEKDAYS[wdIdx])) score += 2;
    const h = parseInt(obj.hour, 10);
    const hourRe = new RegExp(`\\b${h}\\s*(h|:|heures?|am|pm)`);
    if (hourRe.test(t)) score += 2;
    if (new RegExp(`\\b${parseInt(obj.day, 10)}\\b`).test(t)) score += 1;
    return { i, score };
  }).sort((a, b) => b.score - a.score);
  if (scored[0].score >= 2 && (scored.length === 1 || scored[0].score > scored[1].score)) return scored[0].i;
  for (let i = 0; i < Math.min(3, proposed.length); i++) {
    if (ord[i].test(t) && /(creneau|option|choix|va pour|ok pour|parfait|me va|works|go with|prefer|prefere)/.test(t)) return i;
  }
  return null;
}

function parseCallbackDate(text) {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const months = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  const monthsEn = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`\\b(${months[i]}|${monthsEn[i]})\\b`).test(t)) {
      let y = now.getUTCFullYear();
      if (i < now.getUTCMonth() || (i === now.getUTCMonth() && now.getUTCDate() > 5)) y++;
      return new Date(Date.UTC(y, i, 3, 8)).toISOString().slice(0, 10);
    }
  }
  const m = /dans (\d+) (semaines?|mois|jours)/.exec(t) || /in (\d+) (weeks?|months?|days?)/.exec(t);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2];
    const days = /mois|month/.test(unit) ? n * 30 : /semaine|week/.test(unit) ? n * 7 : n;
    return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  }
  if (/rentree/.test(t)) return new Date(Date.UTC(now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(), 8, 2)).toISOString().slice(0, 10);
  if (/annee prochaine|next year|l'an prochain/.test(t)) return new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 10)).toISOString().slice(0, 10);
  if (/plus tard|later|pas le moment|not now|pas maintenant|trop tot|busy|deborde|overbooke/.test(t)) return new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  return null;
}

function ruleSetter({ text, p, c, lang, slots, proposed, ruleChoice }) {
  const t = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const fr = lang === 'fr';
  const tu = c.formality === 'tu';
  const v = (a, b) => (tu ? a : b);
  const first = p.first_name || '';
  const slotList = (slots || []).map((s) => s.label);
  const propose = slotList.length
    ? (fr ? `${v('Je te propose', 'Je vous propose')} : ${slotList.join(', ou ')}. Lequel ${v('te', 'vous')} convient le mieux ?` : `How about ${slotList.join(', or ')}? Which works best?`)
    : (fr ? `${v('Quelles sont tes', 'Quelles sont vos')} disponibilités cette semaine ou la suivante ?` : 'What does your availability look like this week or next?');

  if (ruleChoice !== null && proposed.length) {
    return { intent: 'slot_choice', chosen_slot: ruleChoice, reply: '', source: 'rules' };
  }
  if (/(prix|tarif|combien|cout|devis|contrat|remise|negoci|price|cost|discount|contract|avocat|juridique|rgpd|legal)/.test(t)) {
    return { intent: 'handoff', reply: '', handoff_reason: 'Question tarifaire ou contractuelle', source: 'rules' };
  }
  if (/(pas interesse|non merci|ne m'interesse pas|pas pour nous|stop|desabonne|not interested|no thanks|unsubscribe|ne plus me contacter)/.test(t)) {
    return { intent: 'not_interested', reply: fr ? `Entendu ${first}, merci pour ${v('ton', 'votre')} retour. Belle continuation !` : `Understood ${first}, thanks for letting me know. All the best!`, source: 'rules' };
  }
  const cb = /(plus tard|pas le moment|pas maintenant|recontact|revenez|reviens|rentree|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|dans \d+|later|not now|next month|next year|circle back|reach out in)/.test(t) ? parseCallbackDate(t) : null;
  if (cb) {
    return { intent: 'later', callback_date: cb, reply: fr ? `Pas de souci ${first}, je ${v('te', 'vous')} recontacte à ce moment-là. Bonne journée !` : `No problem ${first}, I'll reach out then. Have a great day!`, source: 'rules' };
  }
  const interestWords = /(appel|call|rdv|rendez-vous|dispo|parlons|pourquoi pas|interess|echanger|discuter|talk)/;
  const shortNoQuestion = t.trim().length < 90 && !t.includes('?');
  if (shortNoQuestion && (p.status === 'meeting' || (/^(merci|thanks|thank you|top|super|parfait|genial|ok|d'accord|tres bien|c'est note|note|a bientot|a tres vite|see you|great|noted|👍)\b/.test(t.trim()) && !interestWords.test(t)))) {
    return { intent: 'courtesy', reply: '', source: 'rules' };
  }
  if (/(oui|volontiers|avec plaisir|pourquoi pas|ca m'interesse|interesse|d'accord|ok pour|parlons|appel|call|rdv|rendez-vous|dispo|disponible|yes|sure|happy to|let's talk|sounds good|interested)/.test(t)) {
    return { intent: 'interested', reply: fr ? `Super ${first} ! ${propose}` : `Great ${first}! ${propose}`, propose_slots: true, source: 'rules' };
  }
  if (/\?|(comment|concretement|c'est quoi|vous faites quoi|tu fais quoi|exemple|how|what do you|explain)/.test(t)) {
    const vp = c.offer.value_prop || c.offer.summary || '';
    return {
      intent: 'question',
      reply: fr
        ? `Bonne question ${first}. En bref : ${vp ? vp.charAt(0).toLowerCase() + vp.slice(1) : 'je vous explique volontiers de vive voix'}${c.offer.proof ? ` (${c.offer.proof})` : ''}. Le plus simple serait d'en parler 20 minutes. ${propose}`
        : `Good question ${first}. In short: ${vp || 'happy to walk you through it live'}. Easiest is a quick 20-minute call. ${propose}`,
      propose_slots: true,
      source: 'rules',
    };
  }
  if (/(deja|on a deja|prestataire|en interne|pas de budget|budget|already have|no budget|in-house)/.test(t)) {
    return {
      intent: 'objection',
      reply: fr
        ? `Je comprends tout à fait ${first}. Beaucoup de nos clients étaient dans la même situation avant d'échanger avec nous. Sans engagement, un appel de 20 minutes ${v('te', 'vous')} permettrait de comparer. ${propose}`
        : `Totally fair ${first}. Many of our clients were in the same spot before we talked. A no-strings 20-minute call would let you compare. ${propose}`,
      propose_slots: true,
      source: 'rules',
    };
  }
  return { intent: 'handoff', reply: '', handoff_reason: 'Réponse ambiguë, à traiter par vous', source: 'rules' };
}

export { formatSlotFr, formatSlotEn, pick };
