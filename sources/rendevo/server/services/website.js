// Reads a public web page to understand the user's offer.
import { stripHtml } from '../lib/util.js';

export async function readWebsite(rawUrl) {
  let url = String(rawUrl || '').trim();
  if (!url) throw new Error('URL vide');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const u = new URL(url);
  if (/linkedin\.com$/i.test(u.hostname.replace(/^www\./, ''))) {
    return { url, linkedin: true, title: '', description: '', text: '' };
  }
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname)) throw new Error('Adresse locale refusée');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  let res;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; RendevoBot/1.0)', accept: 'text/html,application/xhtml+xml' },
    });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new Error(`Le site a répondu ${res.status}`);
  const html = (await res.text()).slice(0, 1_500_000);
  const title = stripHtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const meta = (name) => {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i');
    return stripHtml((html.match(re) || html.match(re2) || [])[1] || '');
  };
  const description = meta('description') || meta('og:description');
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => stripHtml(m[1])).filter(Boolean).slice(0, 20);
  const text = stripHtml(html).slice(0, 8000);
  return { url, linkedin: false, title, description, headings, text: `${headings.join('. ')}\n${text}` };
}
