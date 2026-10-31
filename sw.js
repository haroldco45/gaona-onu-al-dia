// Service worker — Gaona en la ONU al Día
// Noticias: siempre primero la red (para que "Hoy" esté fresco). Resto: caché con respaldo de red.
const CACHE = 'gaona-onu-v1';
const BASE = ['./', 'index.html', 'manifest.json', 'foto-gaona.jpg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const esFresco = url.pathname.endsWith('noticias.json') || e.request.mode === 'navigate';
  if (esFresco) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return r; })
        .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
    );
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
