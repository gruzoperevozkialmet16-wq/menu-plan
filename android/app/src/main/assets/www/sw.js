/* ============================================================
   Service worker: приложение работает без интернета.
   Стратегия: сначала кэш (мгновенный запуск), обновление в фоне.
   При каждом изменении файлов поднимайте VERSION — старый кэш
   удалится сам.
   ============================================================ */
const VERSION = 'planmenu-v2';
const ASSETS = [
  'app.html',
  'index.html',
  'fridge.html',
  'catalog.html',
  'about.html',
  'styles.css',
  'styles-extra.css',
  'styles-app.css',
  'styles-about.css',
  'data.js',
  'products2.js',
  'recipes.js',
  'recipes-ru2.js',
  'recipes-it.js',
  'recipes-asia.js',
  'recipes-cauc.js',
  'recipes-med.js',
  'recipes-mex.js',
  'recipes-eu.js',
  'recipes-east.js',
  'recipes-ind.js',
  'recipes-fit.js',
  'recipes-lean.js',
  'recipes-snacks.js',
  'app.js',
  'fridge-page.js',
  'catalog.js',
  'about.js',
  'nav.js',
  'app-shell.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  /* страницы и код берём сначала из сети: иначе после обновления приложения
     пользователь продолжал бы работать со старой версией из кэша.
     Картинки и шрифты — наоборот, сначала из кэша: они не меняются. */
  const codeLike = sameOrigin && /\.(html|js|css|webmanifest)$|\/$/.test(url.pathname);

  if (codeLike) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: sameOrigin }).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && (sameOrigin || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
