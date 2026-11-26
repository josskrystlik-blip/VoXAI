/**
 * VoxAI - Service worker : l'application s'ouvre et le dictaphone fonctionne sans réseau.
 *
 * - Les fichiers de l'application sont mis en cache à l'installation (une version = un cache).
 *   La version doit correspondre à celle affichée dans l'application (contrôle en CI).
 * - Réglages de l'administrateur (voxai-defaults.json, confluence-proxy.json) : réseau d'abord,
 *   copie en cache sinon, pour que la politique « sans cloud » s'applique aussi hors ligne.
 * - Aucune autre requête n'est interceptée : appels à l'IA, à Confluence (y compris le relais
 *   /confluence/) et données (IndexedDB) ne passent jamais par ce cache.
 */
const VERSION = 'v1.12.5';
const CACHE = `voxai-${VERSION}`;
const APP_FILES = [
  './', 'index.html', 'theme-init.js', 'db.js', 'app.js', 'series.js', 'live.js', 'confluence.js', 'onboarding.js',
  'style.css', 'vendor/tailwind.css', 'vendor/fonts.css',
  'vendor/fonts/plus-jakarta-sans-latin-wght-normal.woff2', 'vendor/fonts/plus-jakarta-sans-latin-ext-wght-normal.woff2',
  'vendor/fonts/jetbrains-mono-latin-wght-normal.woff2', 'vendor/fonts/jetbrains-mono-latin-ext-wght-normal.woff2',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];
const NETWORK_FIRST = ['voxai-defaults.json', 'confluence-proxy.json'];

self.addEventListener('install', (event) => {
  // cache: 'reload' : toujours la version publiée, jamais une copie du cache HTTP
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(APP_FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('voxai-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // IA, Gemini, Confluence direct : jamais interceptés
  const scope = new URL(self.registration.scope);
  const path = url.pathname.slice(scope.pathname.length);
  if (path.startsWith('confluence/') || path === 'healthz') return; // relais Confluence et sonde : réseau uniquement

  if (NETWORK_FIRST.includes(path)) {
    event.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || new Response('{}', { headers: { 'Content-Type': 'application/json' } }))));
    return;
  }

  // Page et fichiers de l'application : cache d'abord (même version partout), réseau en secours
  event.respondWith(
    caches.match(req, { ignoreSearch: req.mode === 'navigate' })
      .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : null))
      .then(hit => hit || fetch(req))
  );
});
