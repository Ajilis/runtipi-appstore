// On-demand classification from the existing workspace AI connector.
// No database writes, no LinkedIn request, and no automatic imports.
export function normalizeJobKeyword(value) {
  if (typeof value !== 'string') throw new Error('Saisissez un mot-clé dans « Poste recherché »');
  if (/[\x00-\x1f\x7f<>]/.test(value)) throw new Error('Saisissez un mot-clé valide de 2 à 90 caractères');
  const keyword = value.trim().replace(/\s+/g, ' ');
  if (keyword.length < 2 || keyword.length > 90 || /[\x00-\x1f\x7f<>]/.test(keyword)) {
    throw new Error('Saisissez un mot-clé valide de 2 à 90 caractères');
  }
  return keyword;
}

export function normalizeJobFormFields(fields = {}, keyword = '') {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error('Champs du formulaire IA invalides');
  }
  const clean = (value) => {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.length > 120) throw new Error('Champs du formulaire IA invalides');
    return value.trim().replace(/\s+/g, ' ').slice(0, 90);
  };
  return {
    title: clean(keyword || fields.title),
    industry: clean(fields.industry),
    location: clean(fields.location),
    keywords: clean(fields.keywords),
  };
}

export function professionalTitlePrompt(fields) {
  const source = typeof fields === 'string' ? { title: fields } : fields;
  const context = normalizeJobFormFields(source);
  const form = {
    'Poste recherché': context.title,
    Secteur: context.industry,
    Localisation: context.location,
    'Mots-clés': context.keywords,
  };
  return 'À partir de « ' + JSON.stringify(form) +
    ' », génère les intitulés de postes LinkedIn associés (variantes, fonctions proches, anciens titres), sans doublons. Réponds uniquement en JSON compact : ' +
    '[{"value":"identifiant","label":"Intitulé","keywords":["synonymes"]}].';
}

export function normalizeProfessionalTitles(data) {
  if (!Array.isArray(data?.rows)) throw new Error('Réponse IA incompatible : tableau de fonctions absent');
  const clean = (value, limit = 180) => typeof value === 'string'
    ? value.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
    : '';
  const normalized = [], seen = new Set();
  for (const raw of data.rows.slice(0, 100)) {
    const title = clean(raw?.label || raw?.title || raw?.intitule_principal || raw?.['Intitulé principal'], 120);
    if (!title) continue;
    const canonical = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const supplied = raw.keywords || raw.variants || raw.variantes || raw?.['Variantes et synonymes LinkedIn'];
    const list = Array.isArray(supplied) ? supplied
      : typeof supplied === 'string' ? supplied.split(/[;|]/) : [];
    const variantsSeen = new Set([canonical]);
    const variants = list.map((v) => clean(v, 120)).filter((v) => {
      if (!v) return false;
      const key = v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
      if (variantsSeen.has(key)) return false;
      variantsSeen.add(key);
      return true;
    }).slice(0, 10);
    normalized.push({
      category: clean(raw.category || raw.categorie || raw?.['Catégorie'], 90) || 'Autres fonctions',
      title, variants,
      relation: clean(raw.relation || raw.lien || raw?.['Lien avec le mot-clé'], 260),
    });
    if (normalized.length >= 60) break;
  }
  if (!normalized.length) throw new Error('Le modèle IA n’a proposé aucun intitulé utilisable');
  return normalized;
}
