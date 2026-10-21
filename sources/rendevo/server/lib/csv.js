// RFC 4180-ish CSV parser with delimiter detection (comma, semicolon, tab).
export function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of firstLine) if (ch in counts) counts[ch]++;
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',';
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, records };
}

const ALIASES = {
  full_name: ['full name', 'fullname', 'name', 'nom complet', 'nom et prénom', 'contact'],
  first_name: ['first name', 'firstname', 'prénom', 'prenom', 'given name'],
  last_name: ['last name', 'lastname', 'nom', 'surname', 'family name', 'nom de famille'],
  title: ['title', 'job title', 'poste', 'fonction', 'position', 'titre', 'job'],
  headline: ['headline', 'titre linkedin', 'accroche', 'summary'],
  company: ['company', 'entreprise', 'société', 'societe', 'organization', 'company name', 'organisation'],
  industry: ['industry', 'secteur', "secteur d'activité", 'sector'],
  location: ['location', 'localisation', 'ville', 'city', 'pays', 'country', 'region'],
  linkedin_url: ['linkedin', 'linkedin url', 'profile url', 'url', 'linkedin profile', 'profil linkedin', 'lien linkedin', 'person linkedin url'],
  email: ['email', 'e-mail', 'mail', 'adresse email'],
  phone: ['phone', 'téléphone', 'telephone', 'mobile', 'tel'],
  notes: ['notes', 'note', 'commentaire', 'comment'],
  tags: ['tags', 'étiquettes', 'labels'],
};

export function mapProspectColumns(headers) {
  const map = {};
  const lower = headers.map((h) => h.toLowerCase().replace(/[_-]+/g, ' ').trim());
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const idx = lower.findIndex((h) => h === field.replace('_', ' ') || aliases.includes(h));
    if (idx >= 0) map[field] = headers[idx];
  }
  return map;
}
