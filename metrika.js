/* ============================================================
   ЯНДЕКС.МЕТРИКА
   Подключается сама, если в config.js указан номер счётчика
   (window.MENUPLAN_METRIKA). Пока номера нет — ничего не грузит,
   так что на локальной разработке и без настройки сайт чистый.
   ============================================================ */
(function () {
  const id = window.MENUPLAN_METRIKA;
  if (!id || typeof id !== 'number') return;

  /* внутри приложения (WebView) счётчик тоже полезен, грузим везде */
  (function (m, e, t, r, i, k, a) {
    m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
    m[i].l = 1 * new Date();
    for (let j = 0; j < e.scripts.length; j++) {
      if (e.scripts[j].src === r) return;
    }
    k = e.createElement(t); a = e.getElementsByTagName(t)[0];
    k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
  })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=' + id, 'ym');

  ym(id, 'init', {
    ssr: true,
    clickmap: true,            /* карта кликов */
    trackLinks: true,          /* переходы по внешним ссылкам */
    accurateTrackBounce: true, /* точный показатель отказов */
    webvisor: true,            /* запись действий посетителя */
    ecommerce: 'dataLayer',
    referrer: document.referrer,
    url: location.href,
  });

  /* сайт из нескольких страниц (index, catalog, about…) — Метрика
     сама считает каждую как отдельный просмотр, дополнительно ничего
     не нужно. Но переходы между экранами приложения (app.html) — это
     одна страница, поэтому шлём просмотр вручную при смене экрана. */
  window.metrikaHit = function (path) {
    try { ym(id, 'hit', path || location.href); } catch (e) { /* счётчик ещё грузится */ }
  };
})();
