/* ============================================================
   ОБОЛОЧКА ПРИЛОЖЕНИЯ
   Экраны, складные секции, нижняя навигация и установка на телефон.
   Вся расчётная логика — та же, что на сайте (app.js, fridge-page.js,
   catalog.js): здесь только интерфейс поверх неё.
   ============================================================ */
(function () {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const SCREENS = {
    plan:    { title: 'План<em>Меню</em>', sub: 'меню под бюджет и КБЖУ', tab: 'plan' },
    result:  { title: 'Ваш план', sub: 'меню, покупки и рецепты', tab: 'plan', back: 'plan' },
    fridge:  { title: 'Холодильник', sub: 'блюда из того, что есть дома', tab: 'fridge' },
    catalog: { title: 'Каталог и цены', sub: 'продукты, цены и КБЖУ', tab: 'catalog' },
    info:    { title: 'Информация', sub: 'как это работает', tab: 'info' },
  };

  let current = 'plan';
  const history = [];

  function show(name, isBack) {
    const info = SCREENS[name];
    if (!info || name === current) return;

    const from = $('#screen-' + current);
    const to = $('#screen-' + name);
    if (!to) return;

    if (!isBack) history.push(current);
    from.classList.remove('active', 'back');
    to.classList.toggle('back', !!isBack);
    to.classList.add('active');
    current = name;

    $('#appTitle').innerHTML = info.title;
    $('#appSub').textContent = info.sub;
    $('#appTop').classList.toggle('has-back', !!info.back || history.length > 0);
    $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.screen === info.tab));
    /* новый экран всегда открывается сверху, без плавной прокрутки */
    const html = document.documentElement;
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    html.style.scrollBehavior = prev;
  }

  function goBack() {
    const prev = history.pop();
    if (prev) show(prev, true);
    else show('plan', true);
    if (!history.length) $('#appTop').classList.remove('has-back');
  }

  /* ---------- складные секции ---------- */
  function initFolds() {
    $$('.fold').forEach(fold => {
      const head = fold.querySelector('.fold-head');
      head.addEventListener('click', () => {
        const willOpen = !fold.classList.contains('open');
        /* в одной группе открыта одна секция — как в мобильных приложениях */
        const group = fold.closest('form') || fold.parentElement;
        if (willOpen && group) {
          Array.from(group.querySelectorAll('.fold.open')).forEach(f => {
            if (f !== fold) f.classList.remove('open');
          });
        }
        fold.classList.toggle('open', willOpen);
        if (willOpen) {
          setTimeout(() => {
            const y = fold.getBoundingClientRect().top + window.scrollY - 72;
            window.scrollTo({ top: y, behavior: 'smooth' });
          }, 120);
        }
      });
    });
  }

  /* ---------- подписи в заголовках секций ---------- */
  function money(v) { return Math.round(v).toLocaleString('ru-RU') + ' ₽'; }

  function updateFoldLabels() {
    if (typeof state === 'undefined') return;
    const g = GOALS.find(x => x.id === state.goal);
    const st = DIET_STYLES.find(x => x.id === state.dietStyle);
    const store = STORES.find(x => x.id === state.store);

    $('#foldGoal').textContent = g ? g.name : '';
    $('#foldStyle').textContent = st ? st.name : '';
    $('#foldCuisine').textContent = state.cuisines.length
      ? state.cuisines.map(c => CUISINES.find(x => x.id === c).name).join(', ')
      : 'Любая';
    $('#foldPeople').textContent = typeof peopleLabel === 'function' ? peopleLabel() : '';
    const days = { 7: 'неделя', 14: '2 недели', 30: 'месяц', 60: '2 месяца' }[state.days] || state.days + ' дн.';
    $('#foldBudget').textContent = money(state.budget) + ' · ' + days;
    $('#foldMeals').textContent = state.mealsCount + ' ' +
      (typeof plural === 'function' ? plural(state.mealsCount, 'приём', 'приёма', 'приёмов') : 'приёмов');
    $('#foldStore').textContent = store ? store.name : '';
    $('#foldAllergens').textContent = state.excluded.length
      ? 'без: ' + state.excluded.map(a => ALLERGENS.find(x => x.id === a).name.toLowerCase()).join(', ')
      : (state.veg ? 'вегетарианское' : 'ничего не исключено');
  }

  /* ---------- всплывающие подсказки ---------- */
  let toastTimer = null;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }
  window.appToast = toast;

  /* ---------- установка приложения ---------- */
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installEvent = e;
    $('#installBar').hidden = false;
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!installEvent) { toast('Меню браузера → «Установить приложение»'); return; }
    installEvent.prompt();
    const res = await installEvent.userChoice;
    installEvent = null;
    $('#installBar').hidden = true;
    if (res && res.outcome === 'accepted') toast('Приложение установлено');
  });
  window.addEventListener('appinstalled', () => {
    $('#installBar').hidden = true;
    toast('Готово: иконка на экране');
  });

  /* ---------- заявка об ошибке ---------- */
  function initBugForm() {
    const btn = $('#appBugSend');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const text = $('#appBugText').value.trim();
      const box = $('#appBugResult');
      if (text.length < 10) { toast('Опишите проблему подробнее'); return; }
      const id = 'BUG-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      const report = 'ЗАЯВКА ОБ ОШИБКЕ — ПланМеню (приложение)\n' +
        'Номер: ' + id + '\nДата: ' + new Date().toLocaleString('ru-RU') + '\n\n' +
        text + '\n\nЭкран: ' + window.innerWidth + '×' + window.innerHeight +
        '\nБраузер: ' + navigator.userAgent;
      try {
        const list = JSON.parse(localStorage.getItem('menuplan_bugs_v1') || '[]');
        list.push({ id, type: 'Из приложения', text: report, date: new Date().toLocaleDateString('ru-RU') });
        localStorage.setItem('menuplan_bugs_v1', JSON.stringify(list.slice(-20)));
      } catch (e) { /* приватный режим */ }
      box.hidden = false;
      box.innerHTML = '<div class="notice ok"><b>Заявка ' + id + ' готова.</b> ' +
        'Скопируйте её и отправьте владельцу приложения.</div>' +
        '<button type="button" class="btn btn-ghost btn-block btn-sm" id="appBugCopy" style="margin-top:10px">Скопировать текст</button>';
      $('#appBugCopy').addEventListener('click', () => {
        navigator.clipboard.writeText(report).then(() => toast('Заявка скопирована'));
      });
    });
  }

  /* ---------- регистрация офлайн-режима ---------- */
  function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн просто не включится */ });
  }

  /* ---------- запуск ---------- */
  function init() {
    initFolds();
    initBugForm();
    initServiceWorker();

    $('#appBack').addEventListener('click', goBack);
    $$('#tabbar button').forEach(b => b.addEventListener('click', () => {
      history.length = 0;
      show(b.dataset.screen);
    }));
    $$('[data-go]').forEach(b => b.addEventListener('click', () => show(b.dataset.go)));

    /* статистика на первом экране */
    if ($('#statRecipes')) $('#statRecipes').textContent = RECIPES.length;
    if ($('#statProducts')) $('#statProducts').textContent = PRODUCTS.length;
    if ($('#statCuisines')) $('#statCuisines').textContent = CUISINES.length;

    /* после построения плана — уводим на экран результата */
    const result = $('#result');
    if (result) {
      new MutationObserver(() => {
        if (!result.hidden && current === 'plan') show('result');
      }).observe(result, { attributes: true, attributeFilter: ['hidden'] });
    }
    $('#btnEdit').addEventListener('click', e => { e.preventDefault(); show('plan', true); });

    /* подписи секций держим в актуальном виде */
    updateFoldLabels();
    document.addEventListener('click', () => setTimeout(updateFoldLabels, 60));
    document.addEventListener('input', () => setTimeout(updateFoldLabels, 60));

    /* если план уже был сохранён, открываем его сразу */
    if (typeof state !== 'undefined' && state.plan) show('result');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
