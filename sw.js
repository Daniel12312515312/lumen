// Network-first service worker: always the latest version when online, still opens offline.
// GitHub Pages tells browsers to keep files for 10 minutes; every request here revalidates
// with the server instead (a tiny "not modified" check), so updates show up on the next open.
const CACHE = 'lumen-v7';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/util.js', 'js/auth.js', 'js/client.js', 'js/spotify.js', 'js/mock.js', 'js/normalize.js',
  'js/player.js', 'js/background.js', 'js/lyrics.js', 'js/nowplaying.js', 'js/views.js', 'js/rows.js',
  'js/sheets.js', 'js/ui.js', 'js/nav.js', 'js/lib.js', 'js/install.js', 'js/pins.js', 'js/stats.js', 'js/sleeptimer.js',
  'js/version.js', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))),
  );
});
