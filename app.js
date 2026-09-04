/* ============================================================
   МЕНЮ-ПЛАН — логика
   ============================================================ */

/* ---------- состояние ---------- */
const state = {
  budget: 7000,
  days: 7,
  people: 2,
  mealsCount: 4,
  store: 'p5',
  excluded: [],
  veg: false,
  noPork: false,
  staplesOwned: true,
  plan: null,
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const DOW = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/* ---------- утилиты ---------- */
function money(v) { return Math.round(v).toLocaleString('ru-RU') + ' ₽'; }
function num(v) { return Math.round(v).toLocaleString('ru-RU'); }
function kgLabel(kg) { return kg >= 1 ? (Math.round(kg * 100) / 100).toString().replace('.', ',') + ' кг' : Math.round(kg * 1000) + ' г'; }
function storeK(id) { const s = STORES.find(x => x.id === id); return s ? s.k : 1; }
function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---------- расчёты по рецептам ---------- */
function recipeAllergens(r) {
  const set = {};
  r.ing.forEach(([id]) => (PRODUCT_BY_ID[id].a || []).forEach(a => { set[a] = 1; }));
  return Object.keys(set);
}
function recipeCost(r, k) {
  let sum = 0;
  r.ing.forEach(([id, g]) => { sum += (g * PORTION / 1000) * PRODUCT_BY_ID[id].price * k; });
  return sum;
}
function recipeKcal(r) {
  let sum = 0;
  r.ing.forEach(([id, g]) => { sum += (g * PORTION / 100) * PRODUCT_BY_ID[id].kc; });
  return Math.round(sum);
}
function recipeHas(r, ids) { return r.ing.some(([id]) => ids.indexOf(id) !== -1); }

/* Пул разрешённых рецептов по типам приёмов пищи */
function buildPool() {
  const k = storeK(state.store);
  const pool = { breakfast: [], lunch: [], dinner: [], snack: [] };
  RECIPES.forEach(r => {
    const al = recipeAllergens(r);
    if (al.some(a => state.excluded.indexOf(a) !== -1)) return;
    if (state.veg && recipeHas(r, MEAT_IDS)) return;
    if (state.noPork && recipeHas(r, PORK_IDS)) return;
    pool[r.m].push({ r, cost: recipeCost(r, k), kcal: recipeKcal(r) });
  });
  Object.keys(pool).forEach(m => pool[m].sort((a, b) => a.cost - b.cost));
  return pool;
}

function activeMeals() {
  return state.mealsCount === 4 ? ['breakfast', 'lunch', 'dinner', 'snack']
    : ['breakfast', 'lunch', 'dinner'];
}

/* ---------- сборка меню ---------- */
function buildMenu(pool, lvl, seed) {
  const rand = rng(seed);
  const meals = activeMeals();
  const menu = [];
  const lastUsed = {};

  for (let d = 0; d < state.days; d++) {
    const day = { day: d, meals: [] };
    meals.forEach(m => {
      const list = pool[m];
      if (!list.length) return;
      const n = list.length;
      const gap = Math.min(n - 1, 8);
      const jitter = (rand() - 0.5) * 2 * Math.max(1, n * 0.2);
      let idx = Math.round(lvl * (n - 1) + jitter);
      idx = Math.max(0, Math.min(n - 1, idx));
      /* не повторять блюдо чаще, чем раз в `gap` дней */
      let pick = null;
      for (let off = 0; off < n; off++) {
        const cands = off === 0 ? [idx] : [idx - off, idx + off];
        for (const c of cands) {
          if (c < 0 || c >= n) continue;
          const item = list[c];
          const lu = lastUsed[item.r.id];
          if (lu === undefined || d - lu > gap) { pick = item; break; }
        }
        if (pick) break;
      }
      if (!pick) pick = list[idx];
      lastUsed[pick.r.id] = d;
      day.meals.push({ type: m, id: pick.r.id, cost: pick.cost, kcal: pick.kcal });
    });
    menu.push(day);
  }
  return menu;
}

/* ---------- корзина ---------- */
function computeShopping(menu, extras) {
  const k = storeK(state.store);
  const grams = {};
  menu.forEach(day => day.meals.forEach(mm => {
    const r = RECIPES.find(x => x.id === mm.id);
    r.ing.forEach(([id, g]) => { grams[id] = (grams[id] || 0) + g * PORTION * state.people; });
  }));

  const items = [];
  const staples = [];
  let total = 0;

  Object.keys(grams).forEach(id => {
    const p = PRODUCT_BY_ID[id];
    const needKg = grams[id] / 1000;
    if (state.staplesOwned && p.staple) { staples.push({ p, needKg }); return; }
    const packs = Math.max(1, Math.ceil(needKg / p.pack - 0.001));
    const buyKg = packs * p.pack;
    const cost = buyKg * p.price * k;
    total += cost;
    items.push({ p, needKg, packs, buyKg, cost, extra: false });
  });

  (extras || []).forEach(ex => {
    const p = PRODUCT_BY_ID[ex.id];
    const buyKg = ex.packs * p.pack;
    const cost = buyKg * p.price * k;
    total += cost;
    const found = items.find(i => i.p.id === p.id);
    if (found) { found.packs += ex.packs; found.buyKg += buyKg; found.cost += cost; found.extra = true; }
    else items.push({ p, needKg: 0, packs: ex.packs, buyKg, cost, extra: true });
  });

  items.sort((a, b) => b.cost - a.cost);
  return { items, staples, total };
}

/* ---------- подбор уровня под бюджет ---------- */
const EXTRA_IDS = ['apple', 'banana', 'pear', 'orange', 'yogurt_natural', 'kefir', 'juice',
  'cookies', 'chocolate', 'frozen_berries', 'dried_apricots', 'cheese_russian', 'cottage_cheese', 'honey', 'walnut'];

function pickExtras(remaining, k) {
  const cands = EXTRA_IDS
    .map(id => PRODUCT_BY_ID[id])
    .filter(p => p && !p.a.some(a => state.excluded.indexOf(a) !== -1))
    .map(p => ({ id: p.id, cost: p.pack * p.price * k }))
    .sort((a, b) => a.cost - b.cost);
  if (!cands.length) return [];
  const out = [];
  /* потолок на одно наименование, чтобы не было «12 упаковок кураги» */
  const perItemCap = Math.max(2, Math.ceil(state.days * state.people / 10));
  const maxPacks = Math.max(4, Math.round(state.days * state.people * 0.6));
  let left = remaining, guard = 0, i = 0, packsTotal = 0;
  while (left > 60 && packsTotal < maxPacks && guard < 600) {
    guard++;
    const c = cands[i % cands.length];
    i++;
    const ex = out.find(o => o.id === c.id);
    if (c.cost <= left && (!ex || ex.packs < perItemCap)) {
      if (ex) ex.packs++; else out.push({ id: c.id, packs: 1 });
      left -= c.cost;
      packsTotal++;
    } else if (i % cands.length === 0) {
      /* прошли полный круг и ничего не поместилось — выходим */
      const anyFits = cands.some(x => {
        const e = out.find(o => o.id === x.id);
        return x.cost <= left && (!e || e.packs < perItemCap);
      });
      if (!anyFits) break;
    }
  }
  return out;
}

function generatePlan(seed) {
  const pool = buildPool();
  const meals = activeMeals();
  const missing = meals.filter(m => !pool[m].length);
  if (missing.length) {
    return { error: 'Из-за выбранных ограничений не осталось рецептов для: ' +
      missing.map(m => MEALS.find(x => x.id === m).name.toLowerCase()).join(', ') +
      '. Снимите часть исключений.' };
  }

  const k = storeK(state.store);
  const build = lvl => {
    const menu = buildMenu(pool, lvl, seed);
    const shop = computeShopping(menu);
    return { menu, shop, lvl };
  };

  const cheapest = build(0);
  const richest = build(1);
  let best, status;

  if (cheapest.shop.total > state.budget) {
    best = cheapest;
    status = 'low';
  } else if (richest.shop.total <= state.budget) {
    best = richest;
    status = 'high';
  } else {
    let lo = 0, hi = 1;
    best = cheapest;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      const res = build(mid);
      if (res.shop.total <= state.budget) { best = res; lo = mid; } else { hi = mid; }
    }
    status = 'ok';
  }

  /* добор до бюджета, если остаётся много.
     Ограничиваем 25 % от корзины — иначе на большой бюджет сервис
     насыпал бы гору яблок вместо честного «остались свободные деньги». */
  let extras = [];
  const gapMoney = state.budget - best.shop.total;
  if (gapMoney > 300) {
    const cap = Math.min(gapMoney, best.shop.total * 0.18);
    extras = pickExtras(cap, k);
    if (extras.length) best.shop = computeShopping(best.menu, extras);
  }

  /* сводка */
  let kcalDay = 0;
  best.menu.forEach(d => { d.meals.forEach(m => { kcalDay += m.kcal; }); });
  kcalDay = Math.round(kcalDay / state.days);

  const uniq = {};
  best.menu.forEach(d => d.meals.forEach(m => { uniq[m.id] = 1; }));
  const poolSize = meals.reduce((s, m) => s + pool[m].length, 0);

  return {
    uniqCount: Object.keys(uniq).length,
    poolSize,
    menu: best.menu,
    shop: best.shop,
    lvl: best.lvl,
    status,
    kcalDay,
    minTotal: cheapest.shop.total,
    maxTotal: richest.shop.total,
    extras,
    settings: JSON.parse(JSON.stringify({
      budget: state.budget, days: state.days, people: state.people,
      mealsCount: state.mealsCount, store: state.store, excluded: state.excluded,
      veg: state.veg, noPork: state.noPork, staplesOwned: state.staplesOwned,
    })),
    startDate: Date.now(),
  };
}

/* ============================================================
   РЕНДЕР
   ============================================================ */
function dateFor(i, start) {
  const d = new Date(start || Date.now());
  d.setDate(d.getDate() + i);
  return d;
}

function renderStats() {
  const p = state.plan;
  const diff = state.budget - p.shop.total;
  const perDay = p.shop.total / state.days;
  const stats = [
    { b: money(state.budget), s: 'Ваш бюджет' },
    { b: money(p.shop.total), s: 'Стоимость корзины', c: p.shop.total <= state.budget ? 'green' : 'red' },
    { b: (diff >= 0 ? '+' : '−') + money(Math.abs(diff)), s: diff >= 0 ? 'Остаётся' : 'Не хватает', c: diff >= 0 ? 'green' : 'red' },
    { b: money(perDay), s: 'В день на семью' },
    { b: money(perDay / state.people), s: 'В день на человека' },
    { b: num(p.kcalDay) + ' ккал', s: 'В день на человека' },
  ];
  $('#stats').innerHTML = stats.map(s =>
    `<div class="stat ${s.c || ''}"><b>${s.b}</b><span>${s.s}</span></div>`).join('');
}

function renderNotice() {
  const p = state.plan;
  const el = $('#notice');
  const diff = state.budget - p.shop.total;
  let extraWarn = '';
  if (p.uniqCount && p.uniqCount < 10) {
    extraWarn = `<br><br>⚠ С такими исключениями в базе осталось всего ${p.uniqCount} ${plural(p.uniqCount, 'подходящее блюдо', 'подходящих блюда', 'подходящих блюд')} — меню будет однообразным. Снимите пару ограничений, если это возможно.`;
  }
  if (diff < 0) {
    /* превышение — либо бюджета изначально мало, либо его добрала замена блюда */
    el.className = 'notice warn';
    el.innerHTML = p.status === 'low'
      ? `<b>Бюджета не хватает.</b> Меню собрано из самых дешёвых блюд, но минимум на ${state.days} дн. для ${state.people} чел. — <b>${money(p.minTotal)}</b>. Не хватает ${money(-diff)}. Поднимите сумму, уменьшите срок или переключитесь на 3 приёма пищи.${extraWarn}`
      : `<b>Корзина вышла за бюджет на ${money(-diff)}</b> — так бывает после ручной замены блюд. Верните блюдо подешевле или нажмите «Пересобрать».${extraWarn}`;
    el.hidden = false;
  } else if (p.status === 'high') {
    el.className = 'notice ok';
    el.innerHTML = `<b>Бюджет с запасом.</b> Даже самое «богатое» меню из базы стоит ${money(p.maxTotal)}. Часть свободных денег добрана фруктами, молочкой и сладким — эти позиции помечены как «добор». Остаётся ${money(diff)}.${extraWarn}`;
    el.hidden = false;
  } else {
    el.className = 'notice ok';
    el.innerHTML = `<b>Уложились в бюджет.</b> Корзина ${money(p.shop.total)} из ${money(state.budget)}, свободно ${money(diff)}.${extraWarn}`;
    el.hidden = false;
  }
}

function renderMenu() {
  const p = state.plan;
  const weeks = [];
  for (let i = 0; i < p.menu.length; i += 7) weeks.push(p.menu.slice(i, i + 7));

  $('#panel-menu').innerHTML = weeks.map((w, wi) => {
    const wCost = w.reduce((s, d) => s + d.meals.reduce((a, m) => a + m.cost * state.people, 0), 0);
    const days = w.map(day => {
      const dt = dateFor(day.day, p.startDate);
      const dayKcal = day.meals.reduce((a, m) => a + m.kcal, 0);
      return `<div class="day">
        <div class="day-head">
          <b>${DOW_SHORT[dt.getDay()]}, ${dt.getDate()} ${MON[dt.getMonth()]}</b>
          <span>${num(dayKcal)} ккал</span>
        </div>
        ${day.meals.map(m => {
          const r = RECIPES.find(x => x.id === m.id);
          const info = MEALS.find(x => x.id === m.type);
          return `<div class="meal">
            <div class="meal-ic">${info.icon}</div>
            <div class="meal-body">
              <div class="meal-type">${info.name}</div>
              <div class="meal-name" data-recipe="${r.id}">${r.n}</div>
              <div class="meal-meta">${r.t} мин · ${money(m.cost * state.people)} · ${num(m.kcal)} ккал</div>
            </div>
            <button class="meal-swap" title="Заменить блюдо" data-swap="${day.day}:${m.type}">⇄</button>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');
    return `<div class="week">
      <div class="week-head"><h3>Неделя ${wi + 1}</h3><span>${w.length} дн. · продуктов примерно на ${money(wCost)}</span></div>
      <div class="days">${days}</div>
    </div>`;
  }).join('');
}

function renderShopping() {
  const p = state.plan;
  const byCat = {};
  p.shop.items.forEach(it => {
    const c = it.p.c;
    (byCat[c] = byCat[c] || []).push(it);
  });

  let html = '';
  CATEGORIES.forEach(cat => {
    const list = byCat[cat.id];
    if (!list || !list.length) return;
    const sum = list.reduce((s, i) => s + i.cost, 0);
    html += `<div class="shop-cat">
      <div class="shop-cat-head"><span>${cat.icon} ${cat.name}</span><b>${money(sum)}</b></div>
      ${list.map(i => `
        <label class="shop-item">
          <input type="checkbox">
          <span class="si-name">${i.p.n}${i.extra ? ' <small style="color:#17915a">· добор</small>' : ''}</span>
          <span class="si-qty">${i.packs} × ${i.p.packName} = ${kgLabel(i.buyKg)}</span>
          <span class="si-price">${money(i.cost)}</span>
        </label>`).join('')}
    </div>`;
  });

  if (p.shop.staples.length) {
    html += `<div class="shop-staples"><b>Не считали в бюджет</b> (вы отметили, что это уже есть дома):
      ${p.shop.staples.map(s => s.p.n + ' — нужно ~' + kgLabel(s.needKg)).join(', ')}.</div>`;
  }

  $('#shopList').innerHTML = html;
  $('#shopTotal').innerHTML = `Итого по списку: <b>${money(p.shop.total)}</b> · ${p.shop.items.length} позиций · магазин «${STORES.find(s => s.id === state.store).name}»`;

  $$('#shopList .shop-item input').forEach(cb => {
    cb.addEventListener('change', () => cb.closest('.shop-item').classList.toggle('checked', cb.checked));
  });
}

function renderRecipesTab() {
  const p = state.plan;
  const used = {};
  p.menu.forEach(d => d.meals.forEach(m => {
    used[m.id] = used[m.id] || { count: 0, cost: m.cost, kcal: m.kcal };
    used[m.id].count++;
  }));
  const k = storeK(state.store);
  const list = Object.keys(used).map(id => {
    const r = RECIPES.find(x => x.id === id);
    return { r, ...used[id] };
  }).sort((a, b) => MEALS.findIndex(m => m.id === a.r.m) - MEALS.findIndex(m => m.id === b.r.m) || a.r.n.localeCompare(b.r.n));

  $('#panel-recipes').innerHTML = `<p class="section-sub">В плане ${list.length} разных блюд. Нажмите на карточку — откроется рецепт с граммовками на ${state.people} чел.</p>
    <div class="rec-grid">${list.map(x => `
      <div class="rec-card" data-recipe="${x.r.id}">
        <h4>${x.r.n}</h4>
        <div class="rec-meta">
          <span>${MEALS.find(m => m.id === x.r.m).icon} ${MEALS.find(m => m.id === x.r.m).name}</span>
          <span>⏱ ${x.r.t} мин</span>
          <span><b>${money(x.cost * state.people)}</b> за подачу</span>
        </div>
        <div class="rec-times">${num(x.kcal)} ккал на порцию · в плане ${x.count} ${plural(x.count, 'раз', 'раза', 'раз')}</div>
      </div>`).join('')}</div>`;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function openRecipe(id) {
  const r = RECIPES.find(x => x.id === id);
  if (!r) return;
  const k = storeK(state.store);
  const info = MEALS.find(m => m.id === r.m);
  const al = recipeAllergens(r);
  $('#modalContent').innerHTML = `
    <h3>${r.n}</h3>
    <div class="m-meta">
      <span>${info.icon} ${info.name}</span>
      <span>⏱ ${r.t} мин</span>
      <span>🔥 ${num(recipeKcal(r))} ккал / порция</span>
      <span>💸 ${money(recipeCost(r, k) * state.people)} на ${state.people} чел.</span>
    </div>
    <div class="m-sec">Продукты на ${state.people} ${plural(state.people, 'человека', 'человек', 'человек')}</div>
    ${r.ing.map(([pid, g]) => {
      const p = PRODUCT_BY_ID[pid];
      const total = g * PORTION * state.people;
      return `<div class="m-ing"><span>${p.n}</span><span>${total >= 1000 ? kgLabel(total / 1000) : Math.round(total) + ' г'}</span></div>`;
    }).join('')}
    <div class="m-sec">Приготовление</div>
    <ol class="m-steps">${r.steps.map(s => `<li>${s}</li>`).join('')}</ol>
    ${al.length ? `<div class="m-sec">Содержит</div><div class="cr-tags">${al.map(a => {
      const A = ALLERGENS.find(x => x.id === a);
      return `<span class="cr-tag">${A.icon} ${A.name}</span>`;
    }).join('')}</div>` : ''}`;
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; }

/* ---------- замена блюда ---------- */
function swapMeal(dayIdx, type) {
  const pool = buildPool();
  const list = pool[type];
  if (list.length < 2) return;
  const day = state.plan.menu[dayIdx];
  const cur = day.meals.find(m => m.type === type);
  const neighbours = [];
  [dayIdx - 2, dayIdx - 1, dayIdx + 1, dayIdx + 2].forEach(i => {
    const d = state.plan.menu[i];
    if (d) { const mm = d.meals.find(m => m.type === type); if (mm) neighbours.push(mm.id); }
  });
  const cands = list.filter(x => x.r.id !== cur.id && neighbours.indexOf(x.r.id) === -1
    && x.cost <= cur.cost * 1.35 && x.cost >= cur.cost * 0.6);
  const pickFrom = cands.length ? cands : list.filter(x => x.r.id !== cur.id);
  const pick = pickFrom[Math.floor(Math.random() * pickFrom.length)];
  cur.id = pick.r.id; cur.cost = pick.cost; cur.kcal = pick.kcal;

  state.plan.shop = computeShopping(state.plan.menu, state.plan.extras);
  let kcalDay = 0;
  state.plan.menu.forEach(d => d.meals.forEach(m => { kcalDay += m.kcal; }));
  state.plan.kcalDay = Math.round(kcalDay / state.days);
  renderAll();
  savePlan();
}

/* ---------- общий рендер ---------- */
function renderAll() {
  const p = state.plan;
  if (!p) return;
  $('#resultSub').textContent =
    `${state.days} ${plural(state.days, 'день', 'дня', 'дней')} · ${state.people} ${plural(state.people, 'человек', 'человека', 'человек')} · ` +
    `${state.mealsCount} ${plural(state.mealsCount, 'приём', 'приёма', 'приёмов')} пищи в день · «${STORES.find(s => s.id === state.store).name}»` +
    (state.excluded.length ? ` · без: ${state.excluded.map(a => ALLERGENS.find(x => x.id === a).name.toLowerCase()).join(', ')}` : '');
  renderNotice();
  renderStats();
  renderMenu();
  renderShopping();
  renderRecipesTab();
}

/* ============================================================
   ФОРМА
   ============================================================ */
function initForm() {
  /* магазины */
  $('#storeList').innerHTML = STORES.map(s => `
    <button type="button" class="store ${s.id === state.store ? 'active' : ''}" data-store="${s.id}">
      <span class="store-name"><i class="store-dot" style="background:${s.color}"></i>${s.name}</span>
      <span class="store-note">${s.note}</span>
    </button>`).join('');
  $$('#storeList .store').forEach(b => b.addEventListener('click', () => {
    state.store = b.dataset.store;
    $$('#storeList .store').forEach(x => x.classList.toggle('active', x === b));
    saveSettings();
  }));

  /* аллергены */
  $('#allergenList').innerHTML = ALLERGENS.map(a =>
    `<button type="button" class="chip" data-allergen="${a.id}">${a.icon} ${a.name}</button>`).join('');
  $$('#allergenList .chip').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.allergen;
    const i = state.excluded.indexOf(id);
    if (i === -1) state.excluded.push(id); else state.excluded.splice(i, 1);
    b.classList.toggle('active', i === -1);
    saveSettings();
  }));

  /* бюджет */
  $('#budget').addEventListener('input', () => {
    state.budget = Math.max(0, parseInt($('#budget').value, 10) || 0);
    $$('#budgetChips .chip').forEach(c => c.classList.toggle('active', +c.dataset.budget === state.budget));
    saveSettings();
  });
  $$('#budgetChips .chip').forEach(c => c.addEventListener('click', () => {
    state.budget = +c.dataset.budget;
    $('#budget').value = state.budget;
    $$('#budgetChips .chip').forEach(x => x.classList.toggle('active', x === c));
    saveSettings();
  }));

  /* период */
  $$('#periodChips .chip').forEach(c => c.addEventListener('click', () => {
    state.days = +c.dataset.days;
    $$('#periodChips .chip').forEach(x => x.classList.toggle('active', x === c));
    saveSettings();
  }));

  /* приёмы пищи */
  $$('#mealsChips .chip').forEach(c => c.addEventListener('click', () => {
    state.mealsCount = +c.dataset.meals;
    $$('#mealsChips .chip').forEach(x => x.classList.toggle('active', x === c));
    saveSettings();
  }));

  /* люди */
  const upd = () => { $('#peopleValue').textContent = state.people; saveSettings(); };
  $('#peopleMinus').addEventListener('click', () => { state.people = Math.max(1, state.people - 1); upd(); });
  $('#peoplePlus').addEventListener('click', () => { state.people = Math.min(8, state.people + 1); upd(); });

  /* переключатели */
  $('#optVeg').addEventListener('change', e => { state.veg = e.target.checked; saveSettings(); });
  $('#optNoPork').addEventListener('change', e => { state.noPork = e.target.checked; saveSettings(); });
  $('#optStaples').addEventListener('change', e => { state.staplesOwned = e.target.checked; saveSettings(); });

  $('#planForm').addEventListener('submit', e => { e.preventDefault(); run(); });
}

function applySettingsToForm() {
  $('#budget').value = state.budget;
  $$('#budgetChips .chip').forEach(c => c.classList.toggle('active', +c.dataset.budget === state.budget));
  $$('#periodChips .chip').forEach(c => c.classList.toggle('active', +c.dataset.days === state.days));
  $$('#mealsChips .chip').forEach(c => c.classList.toggle('active', +c.dataset.meals === state.mealsCount));
  $('#peopleValue').textContent = state.people;
  $$('#storeList .store').forEach(b => b.classList.toggle('active', b.dataset.store === state.store));
  $$('#allergenList .chip').forEach(b => b.classList.toggle('active', state.excluded.indexOf(b.dataset.allergen) !== -1));
  $('#optVeg').checked = state.veg;
  $('#optNoPork').checked = state.noPork;
  $('#optStaples').checked = state.staplesOwned;
}

/* ============================================================
   ЗАПУСК С ЗАГРУЗКОЙ
   ============================================================ */
const LOADER_STEPS = [
  'Загружаем каталог магазина и цены',
  'Убираем продукты с вашими аллергенами',
  'Подбираем рецепты под бюджет',
  'Считаем граммовки и упаковки',
  'Собираем список покупок',
];

function run() {
  const loader = $('#loader');
  $('#loaderSteps').innerHTML = LOADER_STEPS.map(s =>
    `<li><span class="ic"></span><span>${s}</span></li>`).join('');
  $('#loaderPct').textContent = '0%';
  $('#ringFg').style.strokeDashoffset = 327;
  loader.hidden = false;
  document.body.style.overflow = 'hidden';

  const lis = $$('#loaderSteps li');
  let i = 0;
  let result = null;

  const tick = () => {
    if (i > 0) { lis[i - 1].classList.remove('on'); lis[i - 1].classList.add('done'); lis[i - 1].querySelector('.ic').textContent = '✓'; }
    if (i < lis.length) {
      lis[i].classList.add('on');
      const pct = Math.round(((i + 1) / lis.length) * 100);
      $('#loaderPct').textContent = pct + '%';
      $('#ringFg').style.strokeDashoffset = 327 - (327 * pct / 100);
      /* реальный расчёт — на третьем шаге */
      if (i === 2) setTimeout(() => { result = generatePlan(Date.now() % 100000); }, 30);
      i++;
      setTimeout(tick, 380 + Math.random() * 260);
    } else {
      setTimeout(() => {
        loader.hidden = true;
        document.body.style.overflow = '';
        if (!result) result = generatePlan(Date.now() % 100000);
        if (result.error) {
          state.plan = null;
          $('#result').hidden = false;
          $('#resultSub').textContent = '';
          $('#stats').innerHTML = '';
          $('#panel-menu').innerHTML = '';
          $('#shopList').innerHTML = '';
          $('#shopTotal').innerHTML = '';
          $('#panel-recipes').innerHTML = '';
          const el = $('#notice');
          el.className = 'notice warn';
          el.innerHTML = '<b>Не получилось собрать меню.</b> ' + result.error;
          el.hidden = false;
          $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        state.plan = result;
        $('#result').hidden = false;
        renderAll();
        savePlan();
        $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 260);
    }
  };
  tick();
}

/* ============================================================
   ЭКСПОРТ СПИСКА
   ============================================================ */
function shoppingText() {
  const p = state.plan;
  const store = STORES.find(s => s.id === state.store).name;
  let out = `СПИСОК ПОКУПОК — ${store}\n`;
  out += `${state.days} дн. · ${state.people} чел. · бюджет ${money(state.budget)}\n`;
  out += `Итого: ${money(p.shop.total)}\n\n`;
  CATEGORIES.forEach(cat => {
    const list = p.shop.items.filter(i => i.p.c === cat.id);
    if (!list.length) return;
    out += `--- ${cat.name.toUpperCase()} ---\n`;
    list.forEach(i => {
      out += `[ ] ${i.p.n} — ${i.packs} × ${i.p.packName} (${kgLabel(i.buyKg)}) — ${money(i.cost)}\n`;
    });
    out += '\n';
  });
  if (p.shop.staples.length) {
    out += `--- УЖЕ ЕСТЬ ДОМА ---\n`;
    p.shop.staples.forEach(s => { out += `${s.p.n} — ~${kgLabel(s.needKg)}\n`; });
  }
  return out;
}

function initResultActions() {
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(x => x.classList.toggle('active', x === t));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + t.dataset.tab));
  }));

  $('#btnRegen').addEventListener('click', () => run());
  $('#btnEdit').addEventListener('click', () => $('#planner').scrollIntoView({ behavior: 'smooth' }));
  $('#btnPrint').addEventListener('click', () => window.print());
  $('#btnCopy').addEventListener('click', () => {
    navigator.clipboard.writeText(shoppingText()).then(() => {
      const b = $('#btnCopy'); const t = b.textContent;
      b.textContent = '✓ Скопировано'; setTimeout(() => { b.textContent = t; }, 1800);
    });
  });
  $('#btnDownload').addEventListener('click', () => {
    const blob = new Blob([shoppingText()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Список покупок ${state.days} дн.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  document.addEventListener('click', e => {
    const rec = e.target.closest('[data-recipe]');
    if (rec) { openRecipe(rec.dataset.recipe); return; }
    const sw = e.target.closest('[data-swap]');
    if (sw) { const [d, t] = sw.dataset.swap.split(':'); swapMeal(+d, t); return; }
    if (e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

/* ============================================================
   КАТАЛОГ
   ============================================================ */
function renderCatalog() {
  const store = $('#catalogStore').value;
  const k = storeK(store);
  const q = $('#catalogSearch').value.trim().toLowerCase();
  let html = '';
  CATEGORIES.forEach(cat => {
    const list = PRODUCTS.filter(p => p.c === cat.id && (!q || p.n.toLowerCase().includes(q)));
    if (!list.length) return;
    html += `<div class="cat-block"><h4>${cat.icon} ${cat.name} <span style="color:#7d8d85;font-weight:600">· ${list.length}</span></h4>
      ${list.map(p => `<div class="cat-row">
        <span class="cr-name">${p.n}</span>
        <span class="cr-tags">${p.a.map(a => { const A = ALLERGENS.find(x => x.id === a); return A ? `<span class="cr-tag">${A.icon} ${A.name}</span>` : ''; }).join('')}</span>
        <span class="cr-pack">${p.packName}</span>
        <span class="cr-price">${money(p.price * k)}<small>за кг/л</small></span>
      </div>`).join('')}</div>`;
  });
  $('#catalogTable').innerHTML = html || '<p class="section-sub">Ничего не нашлось.</p>';
}

function initCatalog() {
  $('#catalogStore').innerHTML = STORES.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  $('#catalogStore').addEventListener('change', renderCatalog);
  $('#catalogSearch').addEventListener('input', renderCatalog);
  renderCatalog();
}

/* ============================================================
   ХРАНЕНИЕ
   ============================================================ */
const LS_SET = 'menuplan_settings_v1';
const LS_PLAN = 'menuplan_plan_v1';

function saveSettings() {
  try {
    localStorage.setItem(LS_SET, JSON.stringify({
      budget: state.budget, days: state.days, people: state.people, mealsCount: state.mealsCount,
      store: state.store, excluded: state.excluded, veg: state.veg, noPork: state.noPork,
      staplesOwned: state.staplesOwned,
    }));
  } catch (e) { /* приватный режим */ }
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SET);
    if (raw) Object.assign(state, JSON.parse(raw));
  } catch (e) { /* игнор */ }
}
function savePlan() {
  try { localStorage.setItem(LS_PLAN, JSON.stringify(state.plan)); } catch (e) { /* план большой */ }
}
function loadPlan() {
  try {
    const raw = localStorage.getItem(LS_PLAN);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (!p || !p.menu) return;
    Object.assign(state, p.settings || {});
    state.plan = p;
    /* корзину пересчитываем — вдруг обновились цены */
    state.plan.shop = computeShopping(state.plan.menu, state.plan.extras);
    $('#result').hidden = false;
    applySettingsToForm();
    renderAll();
  } catch (e) { /* игнор */ }
}

/* ============================================================
   СТАРТ
   ============================================================ */
(function init() {
  loadSettings();
  initForm();
  applySettingsToForm();
  initResultActions();
  initCatalog();

  $('#statProducts').textContent = PRODUCTS.length;
  $('#statRecipes').textContent = RECIPES.length;
  $('#statAllerg').textContent = ALLERGENS.length;
  $('#priceDate').textContent = PRICE_DATE;
  $$('.pd').forEach(el => { el.textContent = PRICE_DATE; });

  loadPlan();
})();
