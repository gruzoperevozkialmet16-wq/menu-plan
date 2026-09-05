/* ============================================================
   Service worker: приложение работает без интернета.
   Стратегия: сначала кэш (мгновенный запуск), обновление в фоне.
   При каждом изменении файлов поднимайте VERSION — старый кэш
   удалится сам.
   ============================================================ */
const VERSION = 'menu-plan-v1';
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
  /* шрифты и прочую стороннюю статику просто пропускаем в сеть с запасом из кэша */
  const sameOrigin = url.origin === self.location.origin;

  e.respondWith(
    caches.match(req, { ignoreSearch: sameOrigin }).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && (sameOrigin || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);

      /* отдаём кэш сразу, сеть обновит его к следующему запуску */
      return cached || network;
    })
  );
});
