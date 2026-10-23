// Some OpenAI-compatible chat models return fenced JSON, a raw array, or a
// Markdown table when prompted for four columns. Accept those common shapes,
// then pass all data through the same bounded sanitization as the JSON route.
// Never execute remote text or infer nonexistent job titles.
import { normalizeProfessionalTitles } from './job-titles.js';

function rowsFromJson(value) {
  if (Array.isArray(value)) {
    return value.map((row) => typeof row === 'string'
      ? { category: 'Fonctions associées', title: row, variants: [], relation: '' } : row);
  }
  if (!value || typeof value !== 'object') return null;
  const keys = ['rows', 'results', 'resultats', 'résultats', 'titles', 'titres',
    'intitules', 'intitulés', 'suggestions', 'items', 'data', 'fonctions', 'postes'];
  for (const key of keys) {
    if (Array.isArray(value[key])) return rowsFromJson(value[key]);
  }
  if (value.categories && typeof value.categories === 'object' && !Array.isArray(value.categories)) {
    return Object.entries(value.categories).flatMap(([category, list]) =>
      (Array.isArray(list) ? list : []).map((entry) => typeof entry === 'string'
        ? { category, title: entry, variants: [], relation: '' }
        : { category, ...entry }));
  }
  return null;
}

function balancedJsonFragments(text) {
  const snippets = [];
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    const stack = [], openers = { '{': '}', '[': ']' };
    let inString = false, escaped = false;
    for (let cursor = start; cursor < text.length; cursor++) {
      const c = text[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '{' || c === '[') stack.push(openers[c]);
      else if (c === '}' || c === ']') {
        if (stack.pop() !== c) break;
        if (!stack.length) {
          snippets.push(text.slice(start, cursor + 1));
          start = cursor;
          break;
        }
      }
    }
    if (snippets.length >= 24) break;
  }
  return snippets;
}

function parseMarkdownTable(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'));
  if (lines.length < 3) return null;
  const cells = (line) => line.slice(1, -1).split(/(?<!\\)\|/)
    .map((s) => s.replace(/\\\|/g, '|').trim());
  let headerIndex = -1;
  for (let i = 0; i < lines.length - 2; i++) {
    const header = cells(lines[i]).map((cell) => cell.toLocaleLowerCase('fr'));
    if (header.length >= 4 && header.some((h) => /cat[eé]gorie/.test(h))
      && header.some((h) => /intitul[eé]/.test(h))) {
      headerIndex = i; break;
    }
  }
  if (headerIndex < 0) return null;
  const sep = cells(lines[headerIndex + 1]);
  if (!sep.every((col) => /^:?-{3,}:?$/.test(col))) return null;
  const rows = [];
  for (const line of lines.slice(headerIndex + 2)) {
    const columns = cells(line);
    if (columns.length < 4) continue;
    const variants = columns[2].split(/[,;•]|\s+\/\s+/).map((v) => v.trim())
      .filter((v) => v && v !== '—' && v !== '-');
    rows.push({ category: columns[0], title: columns[1], variants, relation: columns[3] });
    if (rows.length >= 60) break;
  }
  return rows.length ? rows : null;
}

export function parseProfessionalTitleResponse(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Réponse vide du modèle IA');
  }
  const trimmed = text.slice(0, 120000).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const attempts = [trimmed, ...balancedJsonFragments(trimmed)];
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      const rows = rowsFromJson(parsed);
      if (rows) return normalizeProfessionalTitles({ rows });
    } catch { /* Try another balanced fragment or Markdown table. */ }
  }
  const table = parseMarkdownTable(trimmed);
  if (table) return normalizeProfessionalTitles({ rows: table });
  if (/[{\[]/.test(trimmed) && !/[}\]]\s*$/.test(trimmed)) {
    throw new Error('Réponse IA tronquée ou JSON incomplet');
  }
  throw new Error('Réponse IA sans tableau JSON ou Markdown exploitable');
}
