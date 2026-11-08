/* ============================================================
   ЛИЧНЫЙ КАБИНЕТ — страница
   Работает поверх account.js. Данные для истории записаны так,
   чтобы страница читалась без каталога продуктов и рецептов.
   ============================================================ */
(function () {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const money = v => Math.round(v).toLocaleString('ru-RU') + ' ₽';
  const num = v => Math.round(v).toLocaleString('ru-RU');
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  };

  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  function dateFull(ts) {
    const d = new Date(ts);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function dateTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return dateFull(ts) + ', ' + hh + ':' + mm;
  }
  function kgLabel(kg) {
    return kg >= 1 ? (Math.round(kg * 100) / 100).toString().replace('.', ',') + ' кг'
                   : Math.round(kg * 1000) + ' г';
  }

  /* login | register | reset-request | reset-code | confirm-signup */
  let mode = 'login';
  let tab = 'orders';
  let pendingEmail = '';   /* почта, ожидающая подтверждения */

  /* ============================================================
     ВХОД, РЕГИСТРАЦИЯ И ВОССТАНОВЛЕНИЕ ПАРОЛЯ
     Все четыре шага живут в одной форме: показываем и прячем поля,
     а не перекидываем человека по страницам.
     ============================================================ */
  function setMode(next) {
    mode = next;
    const reset = mode === 'reset-request' || mode === 'reset-code';
    const codeStep = mode === 'reset-code' || mode === 'confirm-signup';
    const hintStep = reset || mode === 'confirm-signup';

    $$('#authTabs button').forEach(b =>
      b.classList.toggle('active', !hintStep && b.dataset.mode === mode));

    $('#fieldName').hidden = mode !== 'register';
    $('#fieldCode').hidden = !codeStep;
    /* при подтверждении почты пароль уже задан на шаге регистрации */
    $('#fieldPassword').hidden = mode === 'reset-request' || mode === 'confirm-signup';
    $('#authEmail').readOnly = codeStep;

    /* Скрытое поле с required браузер проверить не может и молча
       отменяет отправку формы — поэтому снимаем обязательность вместе с полем. */
    $('#authPassword').required = mode === 'login' || mode === 'register' || mode === 'reset-code';
    $('#authCode').required = codeStep;
    $('#forgotRow').hidden = mode !== 'login';
    $('#resetHint').hidden = !hintStep;

    if (mode === 'reset-request') {
      $('#resetHint').innerHTML = 'Укажите почту, на которую заведён аккаунт — пришлём на неё код из письма.';
    } else if (mode === 'reset-code') {
      $('#resetHint').innerHTML = 'Письмо с кодом отправлено на <b>' + escapeText($('#authEmail').value) +
        '</b>. Введите код и придумайте новый пароль. Если письма нет — посмотрите в папке «Спам».';
    } else if (mode === 'confirm-signup') {
      $('#resetHint').innerHTML = 'Почти готово! Мы отправили код на <b>' + escapeText(pendingEmail || $('#authEmail').value) +
        '</b>. Введите его, чтобы подтвердить почту. Письма нет? Загляните в «Спам» или ' +
        '<button type="button" class="link-btn" data-resend>вышлите код ещё раз</button>.';
    }

    $('#authSubmit').textContent = submitLabel();

    $('#authPassword').setAttribute('autocomplete',
      mode === 'login' ? 'current-password' : 'new-password');
    $('#authPassword').placeholder =
      mode === 'reset-code' ? 'новый пароль, не короче 6 символов' : 'не короче 6 символов';

    $('#authSwitchText').textContent =
      hintStep ? '' : (mode === 'register' ? 'Уже есть аккаунт?' : 'Ещё нет аккаунта?');
    $('#authSwitch').textContent =
      hintStep ? 'Вернуться ко входу' : (mode === 'register' ? 'Войти' : 'Зарегистрироваться');

    const resend = $('#resetHint [data-resend]');
    if (resend) resend.addEventListener('click', doResend);

    hideError();
  }

  function escapeText(v) {
    return String(v == null ? '' : v).replace(/[<>&"]/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  }

  async function doResend(e) {
    hideError();
    const link = e && e.target;
    if (link) { link.textContent = 'высылаем…'; link.disabled = true; }
    try {
      await Account.resendSignup(pendingEmail || $('#authEmail').value);
      if (link) link.textContent = 'код выслан ✓';
    } catch (err) {
      showError(err.message || 'Не получилось выслать код.');
      if (link) { link.textContent = 'вышлите код ещё раз'; link.disabled = false; }
    }
  }

  /* подпись кнопки зависит только от шага — держим её в одном месте,
     иначе после перехода на следующий шаг возвращалась подпись предыдущего */
  function submitLabel() {
    return mode === 'register' ? 'Создать аккаунт'
         : mode === 'reset-request' ? 'Прислать код'
         : mode === 'reset-code' ? 'Сохранить новый пароль'
         : mode === 'confirm-signup' ? 'Подтвердить почту'
         : 'Войти';
  }

  function showError(msg) {
    const el = $('#authError');
    el.textContent = msg;
    el.hidden = false;
  }
  function hideError() { $('#authError').hidden = true; }

  async function submitAuth(e) {
    e.preventDefault();
    hideError();
    const email = $('#authEmail').value;
    const pass = $('#authPassword').value;
    const name = $('#authName').value;
    const code = $('#authCode').value;
    const btn = $('#authSubmit');
    btn.disabled = true;
    btn.textContent = 'Секунду…';
    try {
      if (mode === 'register') {
        const res = await Account.register(email, pass, name);
        if (res && res.needConfirm) {
          /* включено подтверждение почты — просим код из письма */
          pendingEmail = res.email || email;
          setMode('confirm-signup');
          $('#authCode').focus();
        } else {
          $('#authForm').reset();   /* вошли сразу — кабинет откроется сам */
        }
      } else if (mode === 'confirm-signup') {
        await Account.confirmSignup(pendingEmail || email, code);
        $('#authForm').reset();     /* подтвердил — вошёл */
      } else if (mode === 'reset-request') {
        await Account.requestReset(email);
        setMode('reset-code');
        $('#authCode').focus();
      } else if (mode === 'reset-code') {
        await Account.confirmReset(email, code, pass);
        $('#authForm').reset();
        setMode('login');
      } else {
        await Account.login(email, pass);
        $('#authForm').reset();
      }
    } catch (err) {
      showError(err.message || 'Не получилось. Попробуйте ещё раз.');
    } finally {
      btn.disabled = false;
      btn.textContent = submitLabel();
    }
  }

  /* ============================================================
     ПРОФИЛЬ И ПОДПИСКА
     ============================================================ */
  function renderProfile(u) {
    $('#profAvatar').textContent = u.name.slice(0, 1).toUpperCase();
    $('#profName').textContent = u.name;
    $('#profEmail').textContent = u.email;
    $('#profSince').textContent = 'С нами с ' + dateFull(u.createdAt);
    $('#accHeroTitle').textContent = 'Здравствуйте, ' + u.name;
    $('#accHeroSub').textContent =
      'Здесь подписка и вся история: составленные меню и походы в магазин по списку покупок.';
  }

  function renderSubscription() {
    const s = Account.subscription();

    /* Подписка ещё не продаётся: ничего не закрыто, аккаунт нужен,
       чтобы будущая оплата закрепилась за человеком. */
    if (!Account.limitsOn()) {
      const badge = $('#subBadge');
      badge.textContent = 'Готовится';
      badge.className = 'acc-badge';
      $('#subCard').classList.remove('is-pro');
      $('#subTitle').textContent = 'Подписка появится позже';
      $('#subText').innerHTML =
        'Сейчас открыто всё: любой срок меню и вся история без ограничений. ' +
        'Аккаунт нужен, чтобы потом оплаченная подписка закрепилась именно за вами — ' +
        'вместе с историей покупок и меню.';
      const box0 = $('#subActions');
      box0.innerHTML = '';
      const look = document.createElement('a');
      look.className = 'btn btn-ghost btn-sm';
      look.href = '#tiersBlock';
      look.textContent = 'Посмотреть тарифы';
      box0.appendChild(look);
      return;
    }
    const badge = $('#subBadge');
    badge.textContent = s.active ? (s.trial ? 'Пробный период' : s.name) : 'Базовый';
    badge.className = 'acc-badge' + (s.active ? ' on' : '');
    $('#subCard').classList.toggle('is-pro', s.active);

    if (s.active) {
      $('#subTitle').textContent = s.trial
        ? 'Пробный период — тариф Про'
        : 'Тариф ' + s.name + ' активен';
      $('#subText').innerHTML = s.until
        ? `Действует до <b>${dateFull(s.until)}</b> — осталось ${s.daysLeft} ${plural(s.daysLeft, 'день', 'дня', 'дней')}.
           Доступны меню на месяц и два, полная история и экспорт списка.`
        : 'Доступны меню на месяц и два, полная история и экспорт списка покупок.';
    } else if (s.expired) {
      $('#subTitle').textContent = 'Подписка закончилась';
      $('#subText').innerHTML = 'Планы длиннее ' + Account.FREE_MAX_DAYS + ' дней и полная история снова скрыты. ' +
        'История никуда не делась — она вернётся сразу после продления.';
    } else {
      $('#subTitle').textContent = 'Базовый тариф';
      $('#subText').innerHTML = 'Меню на неделю и на две, все 525 рецептов, список покупок и холодильник. ' +
        'Бесплатно и без ограничения по времени.';
    }

    const box = $('#subActions');
    box.innerHTML = '';
    if (!s.active && !s.trialUsed) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-primary btn-sm';
      b.textContent = 'Попробовать Про ' + Account.TRIAL_DAYS + ' дней бесплатно';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await Account.startTrial(); }
        catch (err) { alert(err.message); b.disabled = false; }
      });
      box.appendChild(b);
    }
    const goTiers = document.createElement('a');
    goTiers.className = 'btn btn-ghost btn-sm';
    goTiers.href = '#tiersBlock';
    goTiers.textContent = s.active ? 'Тарифы' : 'Смотреть тарифы';
    box.appendChild(goTiers);

    if (s.active) {
      const off = document.createElement('button');
      off.type = 'button';
      off.className = 'link-btn danger';
      off.textContent = 'Отключить подписку';
      off.addEventListener('click', async () => {
        if (!confirm('Вернуть базовый тариф? История сохранится, но длинные планы станут недоступны.')) return;
        try { await Account.cancel(); } catch (err) { alert(err.message); }
      });
      box.appendChild(off);
    }
  }

  /* Пока подписка не продаётся, базовый тариф — это весь сервис целиком:
     нечестно перечислять в нём ограничения, которых сейчас нет. */
  const FREE_NOW = [
    'Меню на любой срок: неделя, месяц, два месяца',
    'Все 525 рецептов и 9 кухонь',
    'Список покупок с ценами',
    'Холодильник и каталог',
    'История меню и покупок без ограничений',
  ];

  function renderTiers() {
    const s = Account.subscription();
    const selling = Account.limitsOn();

    const sub = $('#tiersSub');
    if (sub) {
      sub.textContent = selling
        ? 'Базовый остаётся бесплатным навсегда. Подписка нужна только для длинных планов и полной истории.'
        : 'Подписка ещё не запущена — сейчас весь сервис работает бесплатно и без ограничений. Так будут выглядеть тарифы, когда мы её запустим.';
    }

    $('#tierCards').innerHTML = Account.TIERS.map(t => {
      const current = selling && (s.active ? s.tier : 'free') === t.id;
      return `<div class="tier${t.best ? ' best' : ''}${current ? ' current' : ''}">
        ${t.best ? '<span class="tier-flag">Выбирают чаще всего</span>' : ''}
        <h4>${t.name}</h4>
        <div class="tier-price">${t.price ? money(t.price) : 'Бесплатно'}
          ${t.period ? '<small>' + t.period + '</small>' : ''}</div>
        <p class="tier-note">${t.id === 'free' && !selling ? 'Сейчас доступно всё' : t.note}</p>
        <ul>${(t.id === 'free' && !selling ? FREE_NOW : t.feats).map(f => '<li>' + f + '</li>').join('')}</ul>
        ${current
          ? '<span class="tier-current">Ваш тариф</span>'
          : (t.id === 'free' || !selling
              ? (selling ? '' : (t.id === 'free'
                  ? '<span class="tier-current">Ваш тариф</span>'
                  : '<span class="tier-current">Скоро</span>'))
              : `<button type="button" class="btn btn-outline btn-sm" data-tier="${t.id}">Оформить ${t.name}</button>`)}
      </div>`;
    }).join('');

    $$('#tierCards [data-tier]').forEach(b => b.addEventListener('click', () => openPay(b.dataset.tier)));

    $('#payNote').innerHTML = selling
      ? 'Онлайн-оплата пока не подключена: карту на сайте ввести нельзя и деньги ' +
        'через сайт не проходят. Кнопка тарифа покажет, как оплатить и что делать дальше.'
      : 'Так будет выглядеть подписка, когда мы её запустим. Сейчас ничего не закрыто: ' +
        'все сроки меню и вся история доступны в базовом тарифе.';
  }

  function openPay(tierId) {
    const t = Account.TIERS.find(x => x.id === tierId);
    if (!t) return;
    $('#modalContent').innerHTML = `
      <span class="eyebrow">Оформление</span>
      <h3 class="modal-title">Тариф ${t.name} — ${money(t.price)} ${t.period}</h3>
      <p class="modal-sub">Приём платежей на сайте не подключён, поэтому оформление проходит вручную.</p>
      <ol class="pay-steps">
        <li>Напишите нам с почты <b>${Account.current().email}</b> и укажите тариф «${t.name}».</li>
        <li>Мы пришлём реквизиты для оплаты и включим подписку в вашем аккаунте.</li>
        <li>Статус обновится на этой странице — история и длинные планы откроются сразу.</li>
      </ol>
      <div class="pay-owner">
        <b>Владельцу сервиса</b>
        <p>Когда оплата получена, включите подписку кнопкой ниже — она привязана к аккаунту,
        в который сейчас выполнен вход.</p>
        <button type="button" class="btn btn-primary btn-sm" id="payActivate">
          Включить «${t.name}» на ${tierId === 'pro_year' ? '12 месяцев' : '1 месяц'}
        </button>
      </div>`;
    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
    const act = $('#payActivate');
    if (act) act.addEventListener('click', async () => {
      act.disabled = true;
      try { await Account.activate(tierId); closeModal(); }
      catch (err) { alert(err.message); act.disabled = false; }
    });
  }

  function closeModal() {
    $('#modal').hidden = true;
    document.body.style.overflow = '';
  }

  /* ============================================================
     ЦИФРЫ
     ============================================================ */
  function renderStats() {
    const orders = Account.ordersTotal();
    const buys = Account.purchasesTotal();
    const all = Account.purchases();
    const spent = all.reduce((s, p) => s + (p.sum || 0), 0);
    const items = all.reduce((s, p) => s + ((p.items && p.items.length) || 0), 0);

    const cells = [
      { v: num(orders), l: plural(orders, 'план меню', 'плана меню', 'планов меню') },
      { v: num(buys), l: plural(buys, 'покупка', 'покупки', 'покупок') },
      { v: money(spent), l: 'потрачено по спискам' },
      { v: num(items), l: plural(items, 'позиция куплена', 'позиции куплено', 'позиций куплено') },
    ];
    $('#accStats').innerHTML = cells.map(c =>
      `<div class="acc-stat"><b>${c.v}</b><span>${c.l}</span></div>`).join('');
  }

  /* ============================================================
     ИСТОРИЯ
     ============================================================ */
  function renderHistory() {
    $('#cntOrders').textContent = Account.ordersTotal();
    $('#cntPurchases').textContent = Account.purchasesTotal();
    $$('#histTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

    const list = tab === 'orders' ? Account.orders() : Account.purchases();
    const total = tab === 'orders' ? Account.ordersTotal() : Account.purchasesTotal();
    const box = $('#histBody');

    if (!total) {
      box.innerHTML = tab === 'orders'
        ? `<div class="acc-empty"><i>🗂️</i><b>Планов пока нет</b>
             <span>Составьте меню — оно сохранится сюда автоматически.</span>
             <a class="btn btn-primary btn-sm" href="./#planner">Составить меню</a></div>`
        : `<div class="acc-empty"><i>🧾</i><b>Покупок пока нет</b>
             <span>В списке покупок отметьте галочками, что взяли, и нажмите «Сохранить покупку».</span>
             <a class="btn btn-primary btn-sm" href="./#planner">Открыть список покупок</a></div>`;
      return;
    }

    let html = '<div class="hist-list">' +
      list.map(tab === 'orders' ? orderCard : purchaseCard).join('') + '</div>';

    const hidden = total - list.length;
    if (hidden > 0) {
      html += `<div class="acc-locked">
        <b>Скрыто ещё ${hidden} ${plural(hidden, 'запись', 'записи', 'записей')}</b>
        <span>Без подписки видно последние ${Account.FREE_HISTORY}. Записи не удалены — они вернутся с подпиской.</span>
        <a class="btn btn-primary btn-sm" href="#tiersBlock">Смотреть тарифы</a>
      </div>`;
    }

    html += `<div class="hist-foot">
      <button type="button" class="link-btn danger" id="btnClearHist">Очистить ${tab === 'orders' ? 'историю меню' : 'историю покупок'}</button>
    </div>`;

    box.innerHTML = html;

    $$('#histBody .hist-card').forEach(card => {
      const head = card.querySelector('.hist-head');
      head.addEventListener('click', e => {
        if (e.target.closest('.hist-del')) return;
        card.classList.toggle('open');
      });
    });
    $$('#histBody .hist-del').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Удалить эту запись?')) return;
      await Account.removeEntry(tab, b.dataset.id);
    }));
    const clr = $('#btnClearHist');
    if (clr) clr.addEventListener('click', async () => {
      if (!confirm('Удалить всю историю в этой вкладке? Отменить будет нельзя.')) return;
      await Account.clearHistory(tab);
    });
  }

  function orderCard(o) {
    const rows = [
      ['Цель', o.goal || '—'],
      ['Бюджет', money(o.budget || 0)],
      ['Магазин', o.store || '—'],
      ['Состав', o.people || '—'],
      ['Приёмов пищи', (o.meals || '—') + ' в день'],
      ['Кухни', o.cuisines || 'любые'],
      ['Стоимость списка', money(o.total || 0)],
      ['Калории в день', num(o.kcal || 0) + ' ккал'],
      ['Белок в день', num(o.protein || 0) + ' г'],
      ['Клетчатка в день', num(o.fiber || 0) + ' г'],
    ];
    return `<article class="hist-card">
      <div class="hist-head">
        <span class="hist-ic">🍽️</span>
        <div class="hist-main">
          <b>Меню на ${o.days} ${plural(o.days, 'день', 'дня', 'дней')}</b>
          <span>${dateTime(o.at)} · ${o.goal || ''} · ${o.store || ''}</span>
        </div>
        <span class="hist-sum">${money(o.total || 0)}</span>
        <button type="button" class="hist-del" data-id="${o.id}" aria-label="Удалить">×</button>
      </div>
      <div class="hist-body">
        <div class="hist-grid">
          ${rows.map(r => `<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}
        </div>
        ${o.dishes && o.dishes.length
          ? `<div class="hist-dishes"><b>Блюда плана</b><p>${o.dishes.join(' · ')}</p></div>` : ''}
      </div>
    </article>`;
  }

  function purchaseCard(p) {
    const items = p.items || [];
    return `<article class="hist-card">
      <div class="hist-head">
        <span class="hist-ic">🧾</span>
        <div class="hist-main">
          <b>Покупка · ${items.length} ${plural(items.length, 'позиция', 'позиции', 'позиций')}</b>
          <span>${dateTime(p.at)} · ${p.store || ''}${p.partial ? ' · куплено не всё по списку' : ''}</span>
        </div>
        <span class="hist-sum">${money(p.sum || 0)}</span>
        <button type="button" class="hist-del" data-id="${p.id}" aria-label="Удалить">×</button>
      </div>
      <div class="hist-body">
        <div class="check-list">
          ${items.map(i => `<div class="check-row">
            <span>${i.name}</span>
            <em>${i.qty || (i.kg ? kgLabel(i.kg) : '')}</em>
            <b>${money(i.cost || 0)}</b>
          </div>`).join('')}
        </div>
        <div class="check-total"><span>Итого</span><b>${money(p.sum || 0)}</b></div>
        ${p.planDays ? `<p class="hist-src">Из плана на ${p.planDays} ${plural(p.planDays, 'день', 'дня', 'дней')}${p.left ? ', не отмечено ' + p.left + ' ' + plural(p.left, 'позиция', 'позиции', 'позиций') : ''}.</p>` : ''}
      </div>
    </article>`;
  }

  /* ============================================================
     ГДЕ ХРАНЯТСЯ ДАННЫЕ — честная плашка
     ============================================================ */
  function renderStorageNote() {
    const cloud = Account.cloudEnabled;
    const note = $('#storageNote');
    if (note) {
      note.innerHTML = cloud
        ? `<b>☁️ Облачный аккаунт</b><span>Логин один на всех устройствах: войдите на телефоне и на компьютере — подписка и история будут одинаковыми.</span>`
        : `<b>📱 Аккаунт на этом устройстве</b><span>Пока сервер не подключён, аккаунт, подписка и история хранятся в памяти браузера. На другом устройстве их не будет, а очистка данных браузера удалит их безвозвратно.</span>`;
    }
    const where = $('#legalWhere');
    if (where) {
      where.innerHTML = '<b>Где лежат данные.</b> ' + (cloud
        ? 'Аккаунт, подписка и история хранятся на защищённом сервере во Франкфурте. ' +
          'База отдаёт каждому только его записи: чужую историю покупок прочитать нельзя. ' +
          'Удалите аккаунт — вместе с ним удалится и вся история.'
        : 'Сервер не подключён, поэтому аккаунт, подписка и история находятся только ' +
          'в памяти вашего браузера — очистка данных браузера удалит их без возможности восстановления.');
    }

    const legal = $('#legalStorage');
    if (legal) {
      legal.textContent = cloud
        ? 'Аккаунты и история хранятся в защищённом облаке'
        : 'Аккаунт и история хранятся только на вашем устройстве';
    }
  }

  /* ============================================================
     СБОРКА
     ============================================================ */
  function paint(u) {
    $('#authBlock').hidden = !!u;
    $('#panelBlock').hidden = !u;
    if (!u) {
      $('#accHeroTitle').textContent = 'Ваш аккаунт';
      $('#accHeroSub').textContent =
        'Аккаунт хранит подписку, все составленные меню и покупки: видно, что и на какую сумму вы брали в каждый поход в магазин.';
      return;
    }
    renderProfile(u);
    renderSubscription();
    renderTiers();
    renderStats();
    renderHistory();
  }

  function init() {
    renderStorageNote();

    $$('#authTabs button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $('#authSwitch').addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));
    $('#forgotLink').addEventListener('click', () => setMode('reset-request'));
    $('#authCode').addEventListener('input', e => {
      /* в письме приходят цифры — остальное молча отсекаем */
      e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
    });
    $('#authForm').addEventListener('submit', submitAuth);
    $('#authEye').addEventListener('click', () => {
      const f = $('#authPassword');
      f.type = f.type === 'password' ? 'text' : 'password';
    });
    $('#btnLogout').addEventListener('click', () => {
      if (confirm('Выйти из аккаунта? История останется и вернётся при следующем входе.')) Account.logout();
    });
    $$('#histTabs button').forEach(b => b.addEventListener('click', () => {
      tab = b.dataset.tab;
      renderHistory();
    }));
    $$('#modal [data-close]').forEach(el => el.addEventListener('click', closeModal));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    setMode('login');
    Account.on(paint);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
