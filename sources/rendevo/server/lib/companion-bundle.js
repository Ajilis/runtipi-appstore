// Generates a per-instance Chrome Companion package at download time.
// The manifest grants installation-time access to ONE Rendevo host, not every website.
// Chrome MV3 match patterns are host/scheme scoped (they cannot restrict a port).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { bad } from './http.js';

const exec = promisify(execFile);
const FILES = ['manifest.json', 'popup.html', 'popup.js', 'popup.css', 'README.md'];
const ORIGIN_PLACEHOLDER = "const installedRendevoOrigin = '';";
const EXTENSION_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../extension');

function privateHttpHost(host) {
  if (host === 'localhost') return true;
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((n) => /^\d{1,3}$/.test(n) && Number(n) <= 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31);
}

export function companionOriginAndPermission(configuredUrl) {
  if (typeof configuredUrl !== 'string' || !configuredUrl.trim()) {
    throw bad('Configure une URL publique Rendevo avant de télécharger Companion.');
  }
  const supplied = configuredUrl.trim();
  let url;
  try { url = new URL(supplied); } catch { throw bad('URL publique Rendevo invalide.'); }
  const host = url.hostname.toLowerCase();
  // No wildcard, username, query, path or fragment; deny untrusted public HTTP.
  if (url.username || url.password || url.search || url.hash || !/^[a-z0-9.-]+$/.test(host)
    || host.startsWith('.') || host.endsWith('.') || host.includes('..')
    || ![url.origin, url.origin + '/'].includes(supplied)
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && privateHttpHost(host)))) {
    throw bad('URL Rendevo non autorisée : HTTPS obligatoire, sauf HTTP sur réseau local privé.');
  }
  return {
    origin: url.origin,
    // Chrome host permissions apply to all ports of this host. Requests still use the exact origin.
    permission: url.protocol + '//' + host + '/*',
  };
}

export function personalizedManifest(template, origin) {
  const { permission } = companionOriginAndPermission(origin);
  const { optional_host_permissions: _optional, host_permissions: _old, ...rest } = template;
  return { ...rest, host_permissions: [permission] };
}

export function personalizedPopup(template, origin) {
  const { origin: normalized } = companionOriginAndPermission(origin);
  if (!template.includes(ORIGIN_PLACEHOLDER)) throw new Error('Companion origin placeholder absent');
  return template.replace(ORIGIN_PLACEHOLDER,
    'const installedRendevoOrigin = ' + JSON.stringify(normalized) + ';');
}

export async function createPersonalizedCompanionArchive(publicUrl, { sourceDir = EXTENSION_DIR } = {}) {
  const { origin, permission } = companionOriginAndPermission(publicUrl);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rendevo-companion-'));
  const archive = path.join(directory, 'Rendevo-Companion.zip');
  try {
    for (const name of FILES) {
      const src = await fs.readFile(path.join(sourceDir, name));
      let contents = src;
      if (name === 'manifest.json') {
        contents = Buffer.from(JSON.stringify(personalizedManifest(JSON.parse(src.toString('utf8')), origin), null, 2) + '\n');
      }
      if (name === 'popup.js') {
        contents = Buffer.from(personalizedPopup(src.toString('utf8'), origin));
      }
      await fs.writeFile(path.join(directory, name), contents, { mode: 0o600 });
    }
    await exec('zip', ['-q', '-X', '-j', archive, ...FILES], { cwd: directory, timeout: 15000 });
    return { archive, directory, origin, permission };
  } catch (err) {
    await fs.rm(directory, { recursive: true, force: true });
    throw err;
  }
}
