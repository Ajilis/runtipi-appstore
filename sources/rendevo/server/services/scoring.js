// Prospect qualification: ICP fit + dated buying signals -> score, heat and
// a human-readable reasoning that is kept with the prospect.

export const SIGNAL_TYPES = {
  new_role: { label: 'Nouveau poste', weight: 22 },
  hiring: { label: 'Recrute', weight: 18 },
  funding: { label: 'Levée de fonds', weight: 20 },
  profile_visit: { label: 'A visité votre profil', weight: 26 },
  post_engagement: { label: 'A réagi à votre publication', weight: 18 },
  competitor_engagement: { label: "Engagé auprès d'un concurrent", weight: 16 },
  topic_post: { label: 'A publié sur votre sujet', weight: 12 },
  company_news: { label: 'Actualité de son entreprise', weight: 10 },
};

// Lowercase, strip accents and fold French feminine job titles onto the
// masculine form so "Directrice commerciale" matches "Directeur commercial".
const norm = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/([a-z]{2,})trices?\b/g, '$1teur')
  .replace(/([a-z]{4,})ales?\b/g, '$1al')
  .replace(/([a-z]{3,})antes?\b/g, '$1ant')
  .replace(/([a-z]{3,})entes?\b/g, '$1ent')
  .replace(/([a-z]{3,})ees?\b/g, '$1e')
  .replace(/([a-z]{3,})ieres?\b/g, '$1ier')
  .replace(/([a-z]{3,})euses?\b/g, '$1eur');

function anyMatch(haystack, needles) {
  const h = norm(haystack);
  return (needles || []).map((n) => String(n || '').trim()).filter(Boolean).filter((n) => {
    const nn = norm(n);
    if (nn.length <= 3) return new RegExp(`\\b${nn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(h);
    return h.includes(nn);
  });
}

export function qualify(prospect, icp = {}, opts = {}) {
  const reasons = [];
  let score = 0;
  const roleText = `${prospect.title} ${prospect.headline}`;
  const allText = `${prospect.title} ${prospect.headline} ${prospect.company} ${prospect.industry} ${prospect.notes}`;

  const exclusions = anyMatch(allText, icp.exclusions);
  const excludedCompanies = anyMatch(prospect.company, icp.excluded_companies);
  if (exclusions.length || excludedCompanies.length) {
    return {
      score: 0,
      heat: 'cold',
      excluded: true,
      reasoning: `Exclu : correspond à ${[...exclusions, ...excludedCompanies].map((x) => `« ${x} »`).join(', ')}.`,
    };
  }

  const titles = anyMatch(roleText, icp.titles);
  if (titles.length) { score += 38; reasons.push(`poste ciblé (${titles.slice(0, 2).join(', ')})`); }
  else if ((icp.titles || []).length) reasons.push('poste hors cible principale');
  else score += 20;

  const industries = anyMatch(`${prospect.industry} ${prospect.headline} ${prospect.company}`, icp.industries);
  if (industries.length) { score += 14; reasons.push(`secteur ${industries[0]}`); }
  else if (!(icp.industries || []).length) score += 6;

  const locations = anyMatch(prospect.location, icp.locations);
  if (locations.length) { score += 10; reasons.push(`zone ${locations[0]}`); }
  else if ((icp.locations || []).length && prospect.location) { score -= 15; reasons.push(`hors zone (${prospect.location})`); }
  else score += 4;

  const kw = anyMatch(allText, icp.keywords);
  if (kw.length) { score += Math.min(12, kw.length * 6); reasons.push(`besoin exprimé (${kw.slice(0, 2).join(', ')})`); }

  const now = opts.now || Date.now();
  let signalPts = 0;
  const sigLabels = [];
  for (const s of prospect.signals || []) {
    const def = SIGNAL_TYPES[s.type] || { weight: 8, label: s.label || s.type };
    const ageDays = s.date ? Math.max(0, (now - new Date(s.date).getTime()) / 86400000) : 20;
    const decay = ageDays <= 14 ? 1 : ageDays <= 45 ? 0.6 : 0.25;
    signalPts += def.weight * decay;
    sigLabels.push(`${s.label || def.label}${ageDays <= 14 ? ' récent' : ''}`);
  }
  if (signalPts) { score += Math.min(40, Math.round(signalPts)); reasons.push(`signaux : ${sigLabels.slice(0, 3).join(', ')}`); }

  if (prospect.network_distance === 'FIRST_DEGREE') { score += 5; reasons.push('déjà dans votre réseau'); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const heat = score >= 70 ? 'hot' : score >= 45 ? 'warm' : 'cold';
  const minScore = opts.minScore ?? 40;
  return {
    score,
    heat,
    excluded: false,
    qualified: score >= minScore,
    reasoning: `${score}/100 : ${reasons.join(' ; ') || 'peu d\'informations sur le profil'}.`,
  };
}

export function normalizeSignal(s) {
  const type = SIGNAL_TYPES[s.type] ? s.type : 'company_news';
  return {
    type,
    label: s.label || SIGNAL_TYPES[type].label,
    detail: s.detail ? String(s.detail).slice(0, 400) : '',
    date: s.date ? new Date(s.date).toISOString() : new Date().toISOString(),
  };
}
