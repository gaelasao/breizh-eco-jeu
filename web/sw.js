/* Living Business — service worker minimal (application installable sur téléphone et ordinateur).
   - Pages (navigations) : toujours le réseau d'abord ; sans connexion, la page « Pas de connexion ».
   - Rien d'autre n'est gardé : jamais l'API (/api/, /mcp), jamais les données de l'entreprise.
   En cache : la page hors ligne, ses feuilles de style (bz.css, thème), ses polices et l'icône ; et, pour la carte 3D
   (direction de design §5.10), les modèles KayKit et les bibliothèques versionnées (cache d'abord), three.js et ses
   modules (réseau d'abord, cache hors ligne). L'image instantanée de la carte (lb-carte-instantanee) est rangée par
   scene.js et n'est jamais effacée ici. Jamais l'API ni les données de l'entreprise. */
const CACHE = 'lb-hors-ligne-v3';
const CACHE_CARTE = 'lb-carte-modeles-v1';
const GARDES = new Set([CACHE, CACHE_CARTE, 'lb-carte-instantanee']);
const HORS_LIGNE = ['/hors-ligne.html', '/hors-ligne.css', '/icone-192.png', '/bz/bz.css', '/bz/theme.js', '/polices/inter-fr-4.1.woff2', '/polices/fraunces-fr-titre.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(HORS_LIGNE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((k) => !GARDES.has(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const depuisCache = (chemin) => caches.match(chemin).then((r) => r ?? Response.error());

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  // autre site, API, flux temps réel, MCP : le navigateur s'en occupe, sans cache
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/mcp') return;
  if (r.mode === 'navigate') {
    // réseau coupé, ou serveur du jeu arrêté derrière le proxy (502, 503, 504) : page « Pas de connexion »
    e.respondWith(fetch(r).then((x) => ([502, 503, 504].includes(x.status) ? depuisCache('/hors-ligne.html') : x)).catch(() => depuisCache('/hors-ligne.html')));
    return;
  }
  if (HORS_LIGNE.includes(url.pathname)) { e.respondWith(fetch(r).catch(() => depuisCache(url.pathname))); return; }
  // carte 3D : modèles et bibliothèques à version dans le chemin, immuables → cache d'abord
  if (url.pathname.startsWith('/modeles/') || /^\/vendor\/[\w.-]+@\d+\.\d+\.\d+\.js$/.test(url.pathname)) {
    e.respondWith(caches.open(CACHE_CARTE).then((c) => c.match(r).then((x) => x ?? fetch(r).then((rep) => { if (rep.ok) c.put(r, rep.clone()); return rep; }))));
    return;
  }
  // three.js, ses modules et les modules de la carte : réseau d'abord, la copie sert hors ligne
  if (url.pathname.startsWith('/vendor/three') || url.pathname.startsWith('/vendor/addons/') || url.pathname.startsWith('/carte/') || url.pathname === '/scene.js') {
    e.respondWith(fetch(r).then((rep) => { if (rep.ok) { const copie = rep.clone(); caches.open(CACHE_CARTE).then((c) => c.put(r, copie)); } return rep; }).catch(() => caches.open(CACHE_CARTE).then((c) => c.match(r)).then((x) => x ?? Response.error())));
  }
});
