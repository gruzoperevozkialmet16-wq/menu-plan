/* ============================================================
   АККАУНТ, ПОДПИСКА И ИСТОРИЯ
   ------------------------------------------------------------
   Один модуль на все страницы и на приложение.

   Два режима работы:
     • «на устройстве» — по умолчанию. Логин, подписка и история
       лежат в памяти браузера. Работает офлайн и без сервера,
       но не переносится на другое устройство.
     • «облако» — включается сам, если в config.js вписаны адрес
       и ключ проекта Supabase. Тогда это настоящий аккаунт:
       один логин на телефоне и на компьютере.

   Наружу отдаёт window.Account.
   ============================================================ */
(function () {

  /* ---------- ключи хранения ---------- */
  const LS_USERS   = 'menuplan_users_v1';     /* аккаунты этого устройства */
  const LS_SESSION = 'menuplan_session_v1';   /* кто сейчас вошёл */
  const LS_CLOUD   = 'menuplan_cloud_v1';     /* токены Supabase */

  /* ---------- тарифы ---------- */
  const TIERS = [
    {
      id: 'free', name: 'Базовый', price: 0, period: '',
      note: 'Навсегда бесплатно',
      feats: [
        'Меню на неделю и на две',
        'Все 525 рецептов и 9 кухонь',
        'Список покупок с ценами',
        'Холодильник и каталог',
        'История: последние 5 планов',
      ],
    },
    {
      id: 'pro', name: 'Про', price: 199, period: 'в месяц',
      note: 'Для семьи, которая планирует надолго',
      best: true,
      feats: [
        'Всё из базового',
        'Меню на месяц и на два месяца',
        'История планов и покупок без ограничений',
        'Сохранение чеков: что и на сколько купили',
        'Экспорт списка покупок в файл',
      ],
    },
    {
      id: 'pro_year', name: 'Про на год', price: 1490, period: 'в год',
      note: 'Два месяца в подарок',
      feats: [
        'Всё из тарифа Про',
        'Цена как за 10 месяцев',
        'Фиксируется на весь год',
      ],
    },
  ];

  const REQUEST_TIMEOUT = 20000;  /* сколько ждём ответа сервера, мс */

  const TRIAL_DAYS = 7;
  const FREE_MAX_DAYS = 14;      /* сколько дней меню доступно без подписки */
  const FREE_HISTORY = 5;        /* сколько записей истории видно без подписки */

  /* ---------- мелкие помощники ---------- */
  const now = () => Date.now();
  const day = 86400000;

  function read(key, def) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; }
    catch (e) { return def; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }
  /* Экранируем то, что человек ввёл сам (имя), прежде чем вставлять
     в разметку — чтобы символы < > & не ломали страницу. */
  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function normEmail(v) { return String(v || '').trim().toLowerCase(); }

  function validEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[a-zа-я]{2,}$/i.test(normEmail(v));
  }

  /* Пароль не храним. Храним отпечаток: соль + SHA-256.
     Если браузер не даёт crypto.subtle (старый WebView, file://),
     считаем запасным способом — он слабее, но пароль всё равно
     не лежит в открытом виде. */
  async function hashPassword(password, salt) {
    const data = salt + '::' + password;
    try {
      if (window.crypto && window.crypto.subtle) {
        const buf = new TextEncoder().encode(data);
        const out = await window.crypto.subtle.digest('SHA-256', buf);
        return Array.from(new Uint8Array(out))
          .map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) { /* переходим к запасному варианту */ }

    let h1 = 0x811c9dc5, h2 = 0x1000193;
    for (let round = 0; round < 5000; round++) {
      for (let i = 0; i < data.length; i++) {
        h1 = ((h1 ^ data.charCodeAt(i)) * 16777619) >>> 0;
        h2 = ((h2 + data.charCodeAt(i) * (i + round + 1)) * 2654435761) >>> 0;
      }
    }
    return ('f' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
  }

  /* ============================================================
     ОБЛАКО (Supabase). Включается само, если заполнен config.js.
     ============================================================ */
  const cfg = window.MENUPLAN_CLOUD || {};
  const CLOUD = !!(cfg.url && cfg.key);

  /* Пока подписка не продаётся, ограничений нет: тарифы видно,
     но все сроки меню и вся история открыты каждому. */
  const LIMITS = !!((window.MENUPLAN_SUB || {}).active);

  /* Supabase отвечает по-английски. Переводим то, что человек
     реально может увидеть, остальное показываем как есть. */
  function humanError(msg, status) {
    const m = String(msg || '');
    const has = t => m.toLowerCase().indexOf(t) !== -1;

    if (has('already registered') || has('already been registered'))
      return 'На эту почту аккаунт уже создан. Перейдите на вкладку «Вход».';
    if (has('invalid login credentials'))
      return 'Неверная почта или пароль.';
    if (has('email not confirmed'))
      return 'Почта ещё не подтверждена — откройте письмо и нажмите кнопку в нём.';
    if (has('password should be at least') || has('password is too short'))
      return 'Пароль должен быть не короче 6 символов.';
    if (has('password') && has('compromised'))
      return 'Такой пароль есть в списках утечек. Придумайте другой.';
    if (has('token has expired') || has('invalid token') || has('otp_expired') || has('token not found'))
      return 'Код неверный или устарел. Запросите новый код.';
    if (has('should be different'))
      return 'Новый пароль должен отличаться от старого.';
    if (has('unable to validate email') || has('invalid email'))
      return 'Проверьте адрес почты — похоже, в нём опечатка.';
    if (status === 429 || has('rate limit') || has('for security purposes'))
      return 'Слишком много попыток подряд. Подождите минуту и попробуйте снова.';
    if (status >= 500)
      return 'Сервер временно не отвечает. Попробуйте через минуту.';
    return m || 'Не получилось. Попробуйте ещё раз.';
  }

  const cloud = {
    tokens() { return read(LS_CLOUD, null); },
    setTokens(t) { t ? write(LS_CLOUD, t) : localStorage.removeItem(LS_CLOUD); },

    async call(path, opts) {
      opts = opts || {};
      const t = cloud.tokens();
      const headers = Object.assign({
        'apikey': cfg.key,
        'Content-Type': 'application/json',
      }, opts.headers || {});
      if (t && t.access_token && !opts.noAuth) {
        headers['Authorization'] = 'Bearer ' + t.access_token;
      }
      /* Без ограничения по времени зависший запрос оставлял бы человека
         с надписью «Секунду…» навсегда. Лучше честно сказать, что связи нет. */
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, REQUEST_TIMEOUT);

      let res;
      try {
        res = await fetch(cfg.url.replace(/\/+$/, '') + path, {
          method: opts.method || 'GET',
          headers,
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: ctrl ? ctrl.signal : undefined,
        });
      } catch (e) {
        clearTimeout(timer);
        if (e && e.name === 'AbortError') {
          throw new Error('Сервер не ответил за ' + Math.round(REQUEST_TIMEOUT / 1000) +
            ' секунд. Проверьте интернет и попробуйте ещё раз.');
        }
        throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
      } finally {
        clearTimeout(timer);
      }

      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      if (!res.ok) {
        const msg = (data && (data.msg || data.message || data.error_description || data.error)) || '';
        throw new Error(humanError(msg, res.status));
      }
      return data;
    },

    /* обновляем протухший токен и повторяем запрос один раз */
    async withAuth(fn) {
      try { return await fn(); }
      catch (e) {
        const t = cloud.tokens();
        if (!t || !t.refresh_token) throw e;
        const fresh = await cloud.call('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', noAuth: true, body: { refresh_token: t.refresh_token },
        });
        cloud.setTokens(fresh);
        return await fn();
      }
    },

    async signUp(email, password, name) {
      const data = await cloud.call('/auth/v1/signup', {
        method: 'POST', noAuth: true,
        body: { email, password, data: { name } },
      });
      if (data.access_token) cloud.setTokens(data);
      return data;
    },

    async signIn(email, password) {
      const data = await cloud.call('/auth/v1/token?grant_type=password', {
        method: 'POST', noAuth: true, body: { email, password },
      });
      cloud.setTokens(data);
      return data;
    },

    async me() {
      return cloud.withAuth(() => cloud.call('/auth/v1/user'));
    },

    async profile() {
      const rows = await cloud.withAuth(() => cloud.call('/rest/v1/profiles?select=*&limit=1'));
      return (rows && rows[0]) || null;
    },

    async saveProfile(patch) {
      return cloud.withAuth(() => cloud.call('/rest/v1/profiles', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body: [patch],
      }));
    },

    async list(table, limit) {
      return cloud.withAuth(() => cloud.call(
        '/rest/v1/' + table + '?select=*&order=at.desc&limit=' + (limit || 200)));
    },

    async insert(table, row) {
      return cloud.withAuth(() => cloud.call('/rest/v1/' + table, {
        method: 'POST', headers: { 'Prefer': 'return=representation' }, body: [row],
      }));
    },

    async remove(table, id) {
      return cloud.withAuth(() => cloud.call('/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
        method: 'DELETE',
      }));
    },
  };

  /* ============================================================
     СОСТОЯНИЕ
     ============================================================ */
  let user = null;          /* {email, name, sub, createdAt} или null */
  let orders = [];          /* созданные планы меню */
  let purchases = [];       /* сохранённые покупки */
  const listeners = [];

  function emit() {
    listeners.forEach(fn => { try { fn(user); } catch (e) { console.error(e); } });
    paintHeader();
  }

  function users() { return read(LS_USERS, {}); }
  function saveUsers(map) { write(LS_USERS, map); }

  function freshSub() {
    return { tier: 'free', since: now(), until: 0, trialUsed: false, source: 'local' };
  }

  function publicUser(rec) {
    if (!rec) return null;
    return {
      email: rec.email,
      name: rec.name || rec.email.split('@')[0],
      createdAt: rec.createdAt,
      sub: rec.sub || freshSub(),
      cloud: !!rec.cloud,
    };
  }

  /* ---------- локальное хранилище истории аккаунта ---------- */
  function localBucket(email) {
    const map = users();
    const rec = map[email];
    if (!rec) return { orders: [], purchases: [] };
    rec.orders = rec.orders || [];
    rec.purchases = rec.purchases || [];
    return rec;
  }

  function persistLocal(email, patch) {
    const map = users();
    if (!map[email]) return;
    Object.assign(map[email], patch);
    saveUsers(map);
  }

  /* ============================================================
     ВХОД И РЕГИСТРАЦИЯ
     ============================================================ */
  async function register(email, password, name) {
    email = normEmail(email);
    if (!validEmail(email)) throw new Error('Проверьте адрес почты — похоже, в нём опечатка.');
    if (!password || password.length < 6) throw new Error('Пароль должен быть не короче 6 символов.');

    if (CLOUD) {
      const res = await cloud.signUp(email, password, name);
      if (!res.access_token) {
        /* Включено подтверждение почты: аккаунт создан, но войти можно
           только после ввода кода из письма. Просим страницу показать
           поле кода, а не бросаем ошибку. */
        return { needConfirm: true, email: email };
      }
      /* Подтверждение почты выключено — вошли сразу. Имя в профиль
         пишет триггер базы; если запись не прошла — молчим. */
      try {
        await cloud.saveProfile({ email, name: name || email.split('@')[0], tier: 'free', until: null });
      } catch (e) { console.warn('Имя в профиль не записалось:', e.message); }
      await loadCloudUser();
      emit();
      return user;
    }

    const map = users();
    if (map[email]) throw new Error('Такой аккаунт уже есть на этом устройстве. Войдите в него.');

    const salt = uid();
    map[email] = {
      email,
      name: (name || '').trim() || email.split('@')[0],
      salt,
      hash: await hashPassword(password, salt),
      createdAt: now(),
      sub: freshSub(),
      orders: [],
      purchases: [],
    };
    saveUsers(map);
    return signInLocal(email);
  }

  async function login(email, password) {
    email = normEmail(email);
    if (!email || !password) throw new Error('Введите почту и пароль.');

    if (CLOUD) {
      await cloud.signIn(email, password);
      await loadCloudUser();
      emit();
      return user;
    }

    const map = users();
    const rec = map[email];
    if (!rec) throw new Error('Аккаунт с такой почтой не найден на этом устройстве.');
    const hash = await hashPassword(password, rec.salt);
    if (hash !== rec.hash) throw new Error('Неверный пароль.');
    return signInLocal(email);
  }

  /* ============================================================
     ВОССТАНОВЛЕНИЕ ПАРОЛЯ
     Шаг 1 — просим прислать код на почту.
     Шаг 2 — меняем пароль по коду; человек сразу оказывается внутри.
     ============================================================ */
  async function requestReset(email) {
    email = normEmail(email);
    if (!validEmail(email)) throw new Error('Проверьте адрес почты — похоже, в нём опечатка.');
    if (!CLOUD) {
      throw new Error('Восстановление пароля работает только с подключённым сервером.');
    }
    /* Ответ одинаковый и для существующей почты, и для несуществующей:
       иначе форма превращается в способ проверять, кто здесь зарегистрирован. */
    await cloud.call('/auth/v1/recover', { method: 'POST', noAuth: true, body: { email } });
    return true;
  }

  async function confirmReset(email, code, password) {
    email = normEmail(email);
    const token = String(code || '').replace(/[^0-9]/g, '');
    if (token.length < 4 || token.length > 10) throw new Error('Введите код из письма (несколько цифр).');
    if (!password || password.length < 6) throw new Error('Новый пароль должен быть не короче 6 символов.');
    if (!CLOUD) throw new Error('Восстановление пароля работает только с подключённым сервером.');

    const data = await cloud.call('/auth/v1/verify', {
      method: 'POST', noAuth: true,
      body: { email, token, type: 'recovery' },
    });
    if (!data || !data.access_token) {
      throw new Error('Код не подошёл. Запросите новый и попробуйте ещё раз.');
    }
    cloud.setTokens(data);

    await cloud.call('/auth/v1/user', { method: 'PUT', body: { password } });
    await loadCloudUser();
    emit();
    return user;
  }

  /* Подтверждение почты при регистрации: человек ввёл код из письма.
     Проверяем его — и сразу оказывается внутри. */
  async function confirmSignup(email, code) {
    email = normEmail(email);
    const token = String(code || '').replace(/[^0-9]/g, '');
    if (token.length < 4 || token.length > 10) throw new Error('Введите код из письма (несколько цифр).');
    if (!CLOUD) throw new Error('Подтверждение почты работает только с подключённым сервером.');

    const data = await cloud.call('/auth/v1/verify', {
      method: 'POST', noAuth: true,
      body: { email, token, type: 'signup' },
    });
    if (!data || !data.access_token) {
      throw new Error('Код не подошёл. Запросите новый и попробуйте ещё раз.');
    }
    cloud.setTokens(data);
    await loadCloudUser();
    emit();
    return user;
  }

  /* Повторно выслать письмо с кодом подтверждения регистрации */
  async function resendSignup(email) {
    email = normEmail(email);
    if (!CLOUD) return false;
    await cloud.call('/auth/v1/resend', {
      method: 'POST', noAuth: true,
      body: { email, type: 'signup' },
    });
    return true;
  }

  function signInLocal(email) {
    write(LS_SESSION, { email, at: now() });
    const rec = users()[email];
    user = publicUser(rec);
    orders = (rec.orders || []).slice();
    purchases = (rec.purchases || []).slice();
    emit();
    return user;
  }

  async function loadCloudUser() {
    const me = await cloud.me();
    let prof = null;
    try { prof = await cloud.profile(); } catch (e) { prof = null; }
    const meta = me.user_metadata || {};
    user = {
      email: me.email,
      name: (prof && prof.name) || meta.name || me.email.split('@')[0],
      createdAt: new Date(me.created_at).getTime(),
      sub: {
        tier: (prof && prof.tier) || 'free',
        since: prof && prof.since ? new Date(prof.since).getTime() : now(),
        until: prof && prof.until ? new Date(prof.until).getTime() : 0,
        trialUsed: !!(prof && prof.trial_used),
        source: 'cloud',
      },
      cloud: true,
    };
    try {
      orders = (await cloud.list('orders', 300)).map(fromRow);
      purchases = (await cloud.list('purchases', 300)).map(fromRow);
    } catch (e) { orders = []; purchases = []; }
  }

  function fromRow(r) {
    const data = r.data || {};
    return Object.assign({ id: r.id, at: new Date(r.at).getTime() }, data);
  }

  function logout() {
    localStorage.removeItem(LS_SESSION);
    if (CLOUD) cloud.setTokens(null);
    user = null;
    orders = [];
    purchases = [];
    emit();
  }

  /* Человек вернулся по ссылке из письма «подтвердите почту»:
     Supabase дописывает в адрес токены после решётки. Забираем их,
     чтобы вход произошёл сам, и убираем из адресной строки. */
  function takeTokensFromUrl() {
    const raw = (location.hash || '').replace(/^#/, '');
    if (!raw || raw.indexOf('access_token=') === -1) return false;
    const p = new URLSearchParams(raw);
    const access = p.get('access_token');
    const refresh = p.get('refresh_token');
    if (!access) return false;
    cloud.setTokens({
      access_token: access,
      refresh_token: refresh || '',
      token_type: p.get('token_type') || 'bearer',
      expires_in: +(p.get('expires_in') || 3600),
    });
    stripHash();
    return true;
  }

  /* Токены в адресной строке — это ключ от аккаунта: он попадёт
     в историю браузера и уедет вместе со скопированной ссылкой.
     Поэтому сразу открываем чистый адрес вместо текущего. Токены
     уже сохранены, так что после перезагрузки вход остаётся.
     replaceState здесь ненадёжен: браузер дописывает решётку
     обратно, когда загрузка страницы завершается. */
  function stripHash() {
    try {
      location.replace(location.pathname + location.search);
    } catch (e) { /* если не вышло — оставляем как есть, вход всё равно работает */ }
  }

  /* Восстанавливаем сессию при загрузке страницы */
  async function restore() {
    if (CLOUD) {
      takeTokensFromUrl();
      if (!cloud.tokens()) return;
      try { await loadCloudUser(); } catch (e) { cloud.setTokens(null); user = null; }
      emit();
      return;
    }
    const s = read(LS_SESSION, null);
    if (!s || !s.email) return;
    const rec = users()[s.email];
    if (!rec) { localStorage.removeItem(LS_SESSION); return; }
    user = publicUser(rec);
    orders = (rec.orders || []).slice();
    purchases = (rec.purchases || []).slice();
    emit();
  }

  /* ============================================================
     ПОДПИСКА
     ============================================================ */
  function subscription() {
    const sub = (user && user.sub) || freshSub();
    const active = sub.tier !== 'free' && (!sub.until || sub.until > now());
    return {
      tier: active ? sub.tier : 'free',
      raw: sub.tier,
      name: (TIERS.find(t => t.id === (active ? sub.tier : 'free')) || TIERS[0]).name,
      until: sub.until || 0,
      active,
      trial: sub.trial === true && active,
      trialUsed: !!sub.trialUsed,
      daysLeft: sub.until ? Math.max(0, Math.ceil((sub.until - now()) / day)) : 0,
      expired: sub.tier !== 'free' && !!sub.until && sub.until <= now(),
    };
  }

  function isPro() { return subscription().active; }

  async function setSubscription(patch) {
    if (!user) throw new Error('Сначала войдите в аккаунт.');
    user.sub = Object.assign({}, user.sub, patch);
    if (CLOUD) {
      await cloud.saveProfile({
        email: user.email,
        name: user.name,
        tier: user.sub.tier,
        until: user.sub.until ? new Date(user.sub.until).toISOString() : null,
        trial_used: !!user.sub.trialUsed,
      });
    } else {
      persistLocal(user.email, { sub: user.sub });
    }
    emit();
    return subscription();
  }

  async function startTrial() {
    if (!user) throw new Error('Сначала войдите в аккаунт.');
    if (user.sub.trialUsed) throw new Error('Пробный период уже использован на этом аккаунте.');
    return setSubscription({
      tier: 'pro',
      trial: true,
      trialUsed: true,
      since: now(),
      until: now() + TRIAL_DAYS * day,
    });
  }

  /* Приём оплаты не подключён — деньги через сайт не проходят.
     Метод меняет только статус подписки в аккаунте: им пользуется
     владелец сервиса, когда оплата пришла другим способом. */
  async function activate(tierId, months) {
    const tier = TIERS.find(t => t.id === tierId);
    if (!tier || tier.id === 'free') throw new Error('Неизвестный тариф.');
    const len = months || (tierId === 'pro_year' ? 12 : 1);
    const from = isPro() && user.sub.until > now() ? user.sub.until : now();
    return setSubscription({
      tier: tierId, trial: false, since: now(), until: from + len * 30 * day,
    });
  }

  async function cancel() {
    return setSubscription({ tier: 'free', trial: false, until: 0 });
  }

  /* ============================================================
     ИСТОРИЯ ПЛАНОВ И ПОКУПОК
     ============================================================ */
  async function push(kind, entry) {
    if (!user) return null;                      /* гостю историю не ведём */
    const row = Object.assign({ id: uid(), at: now() }, entry);
    const list = kind === 'orders' ? orders : purchases;

    /* один и тот же план не пишем дважды подряд */
    if (kind === 'orders' && list[0] && list[0].sig && list[0].sig === row.sig
        && now() - list[0].at < 60000) return list[0];

    list.unshift(row);
    if (list.length > 300) list.length = 300;

    if (CLOUD) {
      try {
        const { id, at } = row;
        const data = Object.assign({}, row);
        delete data.id; delete data.at;
        await cloud.insert(kind, { id, at: new Date(at).toISOString(), data });
      } catch (e) { console.warn('История не ушла в облако:', e.message); }
    } else {
      persistLocal(user.email, kind === 'orders' ? { orders } : { purchases });
    }
    emit();
    return row;
  }

  function history(kind) {
    const list = (kind === 'purchases' ? purchases : orders).slice();
    if (!LIMITS || isPro()) return list;
    return list.slice(0, FREE_HISTORY);
  }

  function historyTotal(kind) {
    return (kind === 'purchases' ? purchases : orders).length;
  }

  async function removeEntry(kind, id) {
    const list = kind === 'purchases' ? purchases : orders;
    const i = list.findIndex(x => x.id === id);
    if (i === -1) return;
    list.splice(i, 1);
    if (CLOUD) { try { await cloud.remove(kind, id); } catch (e) { /* не критично */ } }
    else if (user) persistLocal(user.email, kind === 'orders' ? { orders } : { purchases });
    emit();
  }

  async function clearHistory(kind) {
    const list = kind === 'purchases' ? purchases : orders;
    const ids = list.map(x => x.id);
    list.length = 0;
    if (CLOUD) { for (const id of ids) { try { await cloud.remove(kind, id); } catch (e) {} } }
    else if (user) persistLocal(user.email, kind === 'orders' ? { orders } : { purchases });
    emit();
  }

  /* ============================================================
     ЗНАЧОК АККАУНТА В ШАПКЕ САЙТА
     Разметку добавляем сами, чтобы не дублировать в каждом файле.
     ============================================================ */
  function paintHeader() {
    const nav = document.querySelector('.site-header .header-nav');
    if (!nav) return;
    let link = nav.querySelector('.acc-chip');
    if (!link) {
      link = document.createElement('a');
      link.className = 'acc-chip';
      link.href = 'account.html';
      const cta = nav.querySelector('.btn-primary');
      if (cta) nav.insertBefore(link, cta); else nav.appendChild(link);
    }
    if (user) {
      const s = subscription();
      const esc = escapeHtml(user.name);
      link.innerHTML = `<i>${escapeHtml(user.name.slice(0, 1).toUpperCase())}</i>` +
        `<span>${esc}</span>` +
        (s.active ? `<em class="acc-pro">Про</em>` : '');
      link.classList.add('signed');
    } else {
      link.innerHTML = '<i>👤</i><span>Войти</span>';
      link.classList.remove('signed');
    }
  }

  /* ============================================================
     НАРУЖУ
     ============================================================ */
  window.Account = {
    TIERS, TRIAL_DAYS, FREE_MAX_DAYS, FREE_HISTORY,
    cloudEnabled: CLOUD,
    limitsOn: () => LIMITS,

    current: () => user,
    isSignedIn: () => !!user,
    register, login, logout, restore,
    requestReset, confirmReset,
    confirmSignup, resendSignup,

    subscription, isPro, startTrial, activate, cancel, setSubscription,

    addOrder: entry => push('orders', entry),
    addPurchase: entry => push('purchases', entry),
    orders: () => history('orders'),
    purchases: () => history('purchases'),
    ordersTotal: () => historyTotal('orders'),
    purchasesTotal: () => historyTotal('purchases'),
    removeEntry, clearHistory,

    on(fn) { listeners.push(fn); if (user !== undefined) fn(user); },
    refreshHeader: paintHeader,
  };

  /* стартуем */
  const boot = () => { paintHeader(); restore(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
