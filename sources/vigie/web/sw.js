/* Vigie Patrimoine : service worker.
 * - La coquille de l'application (page, styles, scripts, polices, icônes) est mise en cache par version :
 *   l'application s'ouvre même hors ligne et affiche alors un message clair.
 * - Les données (/api/…) ne sont JAMAIS mises en cache : rien de votre patrimoine n'est stocké sur l'appareil.
 */
'use strict';
const VERSION = '__VERSION__';
const CACHE = `vigie-shell-${VERSION}`;
const SHELL = [
  '/',
  `/app.css?v=${VERSION}`,
  `/app.js?v=${VERSION}`,
  `/icons.js?v=${VERSION}`,
  `/institutions.json?v=${VERSION}`,
  `/icon.svg?v=${VERSION}`,
  '/vendor/qrcode.js',
  '/fonts/PublicSans-Light.woff2',
  '/fonts/PublicSans-Regular.woff2',
  '/fonts/PublicSans-Medium.woff2',
  '/fonts/PublicSans-SemiBold.woff2',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/favicon-32.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload', credentials: 'same-origin' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('vigie-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Données, exports et sauvegardes : toujours le serveur, jamais le cache.
  if (url.pathname.startsWith('/api/')) return;

  // Pages : le réseau d'abord (version la plus récente), la coquille en cache si le serveur est injoignable.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok && url.pathname === '/') (await caches.open(CACHE)).put('/', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('/', { cacheName: CACHE })) || Response.error();
      }
    })());
    return;
  }

  // Fichiers statiques versionnés : le cache d'abord, puis le réseau (et mise en cache des réponses valides).
  event.respondWith((async () => {
    const hit = await caches.match(req, { cacheName: CACHE });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') (await caches.open(CACHE)).put(req, res.clone());
    return res;
  })());
});
