/* ============================================================
   МЕНЮ-ПЛАН — логика
   ============================================================ */

/* ---------- состояние ---------- */
const state = {
  goal: 'normal',
  weight: 70,
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

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/* ---------- утилиты ---------- */
function money(v) { return Math.round(v).toLocaleString('ru-RU') + ' ₽'; }
function num(v) { return Math.round(v).toLocaleString('ru-RU'); }
function kgLabel(kg) { return kg >= 1 ? (Math.round(kg * 100) / 100).toString().replace('.', ',') + ' кг' : Math.round(kg * 1000) + ' г'; }
function storeK(id) { const s = STORES.find(x => x.id === id); return s ? s.k : 1; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---------- нормы КБЖУ ---------- */
function targets() {
  const g = GOALS.find(x => x.id === state.goal) || GOALS[1];
  const kcal = Math.round(state.weight * g.kcalPerKg);
  const protein = Math.round(state.weight * g.proteinPerKg);
  const fat = Math.round(state.weight * g.fatPerKg);
  const fiber = Math.max(25, Math.round(kcal / 1000 * 14));
  const carb = Math.max(60, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, fat, carb, fiber, goal: g };
}

/* ---------- расчёты по рецептам ---------- */
function recipeAllergens(r) {
  const set = {};
  r.ing.forEach(([id]) => (PRODUCT_BY_ID[id].a || []).forEach(a => { set[a] = 1; }));
  return Object.keys(set);
}
/* КБЖУ одной порции (базовая порция взрослого) */
function recipeMacro(r) {
  let kc = 0, pr = 0, fa = 0, ca = 0, fi = 0;
  r.ing.forEach(([id, g]) => {
    const p = PRODUCT_BY_ID[id], q = g * PORTION / 100;
    kc += q * p.kc; pr += q * p.pr; fa += q * p.fa; ca += q * p.ca; fi += q * p.fi;
  });
  return { kc, pr, fa, ca, fi };
}
function recipeCost(r, k) {
  let sum = 0;
  r.ing.forEach(([id, g]) => { sum += (g * PORTION / 1000) * PRODUCT_BY_ID[id].price * k; });
  return sum;
}
function recipeHas(r, ids) { return r.ing.some(([id]) => ids.indexOf(id) !== -1); }

const RECIPE_BY_ID = {};
RECIPES.forEach(r => { RECIPE_BY_ID[r.id] = r; });

/* Пул разрешённых рецептов по типам приёмов пищи */
function buildPool() {
  const k = storeK(state.store);
  const pool = { breakfast: [], lunch: [], dinner: [], snack: [] };
  RECIPES.forEach(r => {
    const al = recipeAllergens(r);
    if (al.some(a => state.excluded.indexOf(a) !== -1)) return;
    if (state.veg && recipeHas(r, MEAT_IDS)) return;
    if (state.noPork && recipeHas(r, PORK_IDS)) return;
    pool[r.m].push({ r, cost: recipeCost(r, k), m: recipeMacro(r) });
  });
  Object.keys(pool).forEach(m => pool[m].sort((a, b) => a.cost - b.cost));
  return pool;
}

function activeMeals() {
  return state.mealsCount === 4 ? ['breakfast', 'lunch', 'dinner', 'snack']
    : ['breakfast', 'lunch', 'dinner'];
}

/* ---------- добор белка и клетчатки ----------
   Одними блюдами норму белка на диете и на массе часто не закрыть.
   Поэтому к дню добавляется «добавка»: творог, яйца, грудка, отруби —
   ровно столько, сколько нужно, и только если остаётся запас по калориям. */
const BOOST_PROTEIN = ['cottage_cheese', 'chicken_fillet', 'eggs', 'canned_tuna', 'turkey_fillet',
  'kefir', 'cheese_russian', 'lentils', 'chickpeas', 'peas_dry', 'peanut', 'milk'];
const BOOST_FIBER = ['bran', 'cabbage', 'carrot', 'apple', 'broccoli_frozen', 'beans_canned', 'dried_apricots'];

function productAllowed(p) {
  if (!p) return false;
  if (p.a.some(a => state.excluded.indexOf(a) !== -1)) return false;
  if (state.veg && MEAT_IDS.indexOf(p.id) !== -1) return false;
  if (state.noPork && PORK_IDS.indexOf(p.id) !== -1) return false;
  return true;
}

/* dm — КБЖУ дня уже с учётом масштаба порций */
/* Запас по калориям, в пределах которого разрешено добирать белок.
   На диете он минимальный — там важнее не превысить норму. */
function kcalRoomFactor() {
  return state.goal === 'diet' ? 1.02 : (state.goal === 'mass' ? 1.08 : 1.05);
}

function buildBoost(dm, T) {
  const boost = [];
  let pr = dm.pr, fi = dm.fi, kc = dm.kc;
  const room = () => T.kcal * kcalRoomFactor() - kc;
  const add = (p, g) => {
    const ex = boost.find(b => b.id === p.id);
    if (ex) ex.g += g; else boost.push({ id: p.id, g });
    kc += p.kc * g / 100; pr += p.pr * g / 100; fi += p.fi * g / 100;
  };

  /* белок: берём постные продукты, а среди них — самые дешёвые за грамм белка.
     На диете планка «постности» выше: лишние калории там критичнее. */
  const lean = state.goal === 'diet' ? 0.09 : 0.05;
  const all = BOOST_PROTEIN.map(id => PRODUCT_BY_ID[id]).filter(p => productAllowed(p) && p.pr > 5);
  let prList = all.filter(p => p.pr / Math.max(p.kc, 1) >= lean);
  if (!prList.length) prList = all;
  prList.sort((a, b) => (a.price / a.pr) - (b.price / b.pr));
  let guard = 0;
  while (pr < T.protein * 0.98 && room() > 50 && guard < 10) {
    guard++;
    const g = 80;
    const p = prList.find(x => x.kc * g / 100 <= room() && x.pr > 5);
    if (!p) break;
    add(p, g);
  }

  /* клетчатка: овощи и отруби почти не тратят калорийный запас */
  const fiList = BOOST_FIBER.map(id => PRODUCT_BY_ID[id]).filter(productAllowed)
    .sort((a, b) => (b.fi / Math.max(b.kc, 1)) - (a.fi / Math.max(a.kc, 1)));
  guard = 0;
  while (fi < T.fiber * 0.98 && room() > 30 && guard < 10) {
    guard++;
    const p = fiList.find(x => x.fi > 1.5);
    if (!p) break;
    const g = p.id === 'bran' ? 25 : 120;
    if (p.kc * g / 100 > room()) break;
    add(p, g);
  }

  return boost.map(b => ({ id: b.id, g: Math.round(b.g) }));
}

function boostMacro(boost) {
  const s = { kc: 0, pr: 0, fa: 0, ca: 0, fi: 0, cost: 0 };
  const k = storeK(state.store);
  (boost || []).forEach(b => {
    const p = PRODUCT_BY_ID[b.id], q = b.g / 100;
    s.kc += p.kc * q; s.pr += p.pr * q; s.fa += p.fa * q; s.ca += p.ca * q; s.fi += p.fi * q;
    s.cost += p.price * k * b.g / 1000;
  });
  return s;
}

/* Суммарные КБЖУ и стоимость дня (порции без подгонки) */
function dayTotals(mealIds, pool) {
  const t = { kc: 0, pr: 0, fa: 0, ca: 0, fi: 0, cost: 0 };
  mealIds.forEach(x => {
    t.kc += x.item.m.kc; t.pr += x.item.m.pr; t.fa += x.item.m.fa;
    t.ca += x.item.m.ca; t.fi += x.item.m.fi; t.cost += x.item.cost;
  });
  return t;
}

/* ---------- сборка меню ----------
   Для каждого дня перебираем несколько наборов блюд и берём тот,
   что лучше закрывает норму белка и клетчатки, не вылезая по цене.
   Порции дня масштабируются, чтобы попасть в норму калорий. */
function buildMenu(pool, lvl, seed, T) {
  const rand = rng(seed);
  const meals = activeMeals();
  const menu = [];
  const lastUsed = {};
  const attempts = state.days > 30 ? 12 : 20;

  /* опорная цена дня для этого уровня — чтобы подбор белка не разносил бюджет */
  let refCost = 0;
  meals.forEach(m => {
    const list = pool[m];
    if (list.length) refCost += list[Math.round(lvl * (list.length - 1))].cost;
  });

  const need = (fact, target) => Math.max(0, (target - fact) / target);
  const over = (fact, target) => Math.max(0, (fact - target) / target);

  for (let d = 0; d < state.days; d++) {
    let best = null;

    for (let a = 0; a < attempts; a++) {
      const picked = [];
      meals.forEach(m => {
        const list = pool[m];
        if (!list.length) return;
        const n = list.length;
        const gap = Math.min(n - 1, 8);
        const jitter = (rand() - 0.5) * 2 * Math.max(1, n * 0.22);
        let idx = clamp(Math.round(lvl * (n - 1) + jitter), 0, n - 1);
        let item = null;
        for (let off = 0; off < n && !item; off++) {
          const cands = off === 0 ? [idx] : [idx - off, idx + off];
          for (const c of cands) {
            if (c < 0 || c >= n) continue;
            const cand = list[c];
            if (picked.some(p => p.item.r.id === cand.r.id)) continue;
            const lu = lastUsed[cand.r.id];
            if (lu === undefined || d - lu > gap) { item = cand; break; }
          }
        }
        if (!item) item = list[idx];
        picked.push({ type: m, item });
      });

      const t = dayTotals(picked, pool);
      if (t.kc <= 0) continue;
      /* Если блюда не закрывают белок, резервируем часть калорий под добор
         (примерно 6 ккал на грамм белка из творога, грудки, яиц) и слегка
         уменьшаем порции — так и норма белка закрыта, и калории не превышены. */
      let scale = clamp(T.kcal / t.kc, 0.7, 1.7);
      const prDeficit = T.protein - t.pr * scale;
      if (prDeficit > 0) {
        const reserve = Math.min(T.kcal * 0.3, prDeficit * 6);
        scale = clamp((T.kcal - reserve) / t.kc, 0.7, 1.7);
      }
      const pr = t.pr * scale, fi = t.fi * scale, fa = t.fa * scale, cost = t.cost * scale;

      const score =
        need(pr, T.protein) * 140 + over(pr, T.protein * 1.4) * 25 +
        need(fi, T.fiber) * 90 + over(fi, T.fiber * 1.7) * 10 +
        over(fa, T.fat * 1.6) * 30 +
        Math.abs(scale - 1) * 25 +
        (refCost > 0 ? over(cost, refCost) * 35 : 0);

      if (!best || score < best.score) best = { picked, scale, score, t };
    }

    best.picked.forEach(p => { lastUsed[p.item.r.id] = d; });
    const sc = Math.round(best.scale * 100) / 100;
    const dm = {
      kc: best.t.kc * sc, pr: best.t.pr * sc, fa: best.t.fa * sc,
      ca: best.t.ca * sc, fi: best.t.fi * sc,
    };
    menu.push({
      day: d,
      scale: sc,
      boost: buildBoost(dm, T),
      meals: best.picked.map(p => ({ type: p.type, id: p.item.r.id })),
    });
  }
  return menu;
}

/* ---------- корзина ---------- */
function computeShopping(menu, extras) {
  const k = storeK(state.store);
  const grams = {};
  menu.forEach(day => {
    day.meals.forEach(mm => {
      const r = RECIPE_BY_ID[mm.id];
      r.ing.forEach(([id, g]) => {
        grams[id] = (grams[id] || 0) + g * PORTION * day.scale * state.people;
      });
    });
    (day.boost || []).forEach(b => {
      grams[b.id] = (grams[b.id] || 0) + b.g * state.people;
    });
  });

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

/* ---------- средние КБЖУ плана (на человека в день) ---------- */
function planMacros(menu) {
  const sum = { kc: 0, pr: 0, fa: 0, ca: 0, fi: 0 };
  menu.forEach(day => {
    const d = dayMacros(day);
    sum.kc += d.kc; sum.pr += d.pr; sum.fa += d.fa; sum.ca += d.ca; sum.fi += d.fi;
  });
  const n = menu.length || 1;
  return { kc: sum.kc / n, pr: sum.pr / n, fa: sum.fa / n, ca: sum.ca / n, fi: sum.fi / n };
}
function dayMacros(day) {
  const s = { kc: 0, pr: 0, fa: 0, ca: 0, fi: 0, cost: 0 };
  const k = storeK(state.store);
  day.meals.forEach(mm => {
    const r = RECIPE_BY_ID[mm.id];
    const m = recipeMacro(r);
    s.kc += m.kc * day.scale; s.pr += m.pr * day.scale; s.fa += m.fa * day.scale;
    s.ca += m.ca * day.scale; s.fi += m.fi * day.scale;
    s.cost += recipeCost(r, k) * day.scale;
  });
  const b = boostMacro(day.boost);
  s.kc += b.kc; s.pr += b.pr; s.fa += b.fa; s.ca += b.ca; s.fi += b.fi; s.cost += b.cost;
  return s;
}

/* ---------- добор до бюджета ---------- */
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
      const anyFits = cands.some(x => {
        const e = out.find(o => o.id === x.id);
        return x.cost <= left && (!e || e.packs < perItemCap);
      });
      if (!anyFits) break;
    }
  }
  return out;
}

/* ---------- генерация плана ---------- */
function generatePlan(seed) {
  const pool = buildPool();
  const meals = activeMeals();
  const missing = meals.filter(m => !pool[m].length);
  if (missing.length) {
    return {
      error: 'Из-за выбранных ограничений не осталось рецептов для: ' +
        missing.map(m => MEALS.find(x => x.id === m).name.toLowerCase()).join(', ') +
        '. Снимите часть исключений.'
    };
  }

  const T = targets();
  const k = storeK(state.store);
  const build = lvl => {
    const menu = buildMenu(pool, lvl, seed, T);
    return { menu, shop: computeShopping(menu), lvl };
  };

  const cheapest = build(0);
  const richest = build(1);
  let best, status;

  if (cheapest.shop.total > state.budget) {
    best = cheapest; status = 'low';
  } else if (richest.shop.total <= state.budget) {
    best = richest; status = 'high';
  } else {
    let lo = 0, hi = 1;
    best = cheapest;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const res = build(mid);
      if (res.shop.total <= state.budget) { best = res; lo = mid; } else { hi = mid; }
    }
    status = 'ok';
  }

  /* добор до бюджета: не больше 18 % корзины, иначе честно оставляем деньги */
  let extras = [];
  const gapMoney = state.budget - best.shop.total;
  if (gapMoney > 300) {
    extras = pickExtras(Math.min(gapMoney, best.shop.total * 0.18), k);
    if (extras.length) best.shop = computeShopping(best.menu, extras);
  }

  const uniq = {};
  best.menu.forEach(d => d.meals.forEach(m => { uniq[m.id] = 1; }));
  const scales = best.menu.map(d => d.scale);

  return {
    menu: best.menu,
    shop: best.shop,
    lvl: best.lvl,
    status,
    targets: T,
    macros: planMacros(best.menu),
    avgScale: scales.reduce((a, b) => a + b, 0) / scales.length,
    uniqCount: Object.keys(uniq).length,
    minTotal: cheapest.shop.total,
    maxTotal: richest.shop.total,
    extras,
    settings: {
      goal: state.goal, weight: state.weight, budget: state.budget, days: state.days,
      people: state.people, mealsCount: state.mealsCount, store: state.store,
      excluded: state.excluded.slice(), veg: state.veg, noPork: state.noPork,
      staplesOwned: state.staplesOwned,
    },
    startDate: Date.now(),
  };
}

/* пересчёт после ручной замены блюда */
function recalcPlan() {
  const p = state.plan;
  p.shop = computeShopping(p.menu, p.extras);
  p.macros = planMacros(p.menu);
  const uniq = {};
  p.menu.forEach(d => d.meals.forEach(m => { uniq[m.id] = 1; }));
  p.uniqCount = Object.keys(uniq).length;
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
    { b: p.targets.goal.icon + ' ' + p.targets.goal.name, s: p.targets.goal.short },
  ];
  $('#stats').innerHTML = stats.map(s =>
    `<div class="stat ${s.c || ''}"><b>${s.b}</b><span>${s.s}</span></div>`).join('');
}

/* блок КБЖУ: факт против нормы */
function renderMacros() {
  const p = state.plan;
  const T = p.targets, M = p.macros;
  const rows = [
    { key: 'kc', name: 'Калории', unit: 'ккал', fact: M.kc, target: T.kcal, hard: true },
    { key: 'pr', name: 'Белки', unit: 'г', fact: M.pr, target: T.protein, hard: true },
    { key: 'fa', name: 'Жиры', unit: 'г', fact: M.fa, target: T.fat },
    { key: 'ca', name: 'Углеводы', unit: 'г', fact: M.ca, target: T.carb },
    { key: 'fi', name: 'Клетчатка', unit: 'г', fact: M.fi, target: T.fiber, hard: true },
  ];
  const bars = rows.map(r => {
    const pct = r.target > 0 ? r.fact / r.target : 0;
    const ok = pct >= 0.9 && pct <= 1.15;
    const low = pct < 0.9;
    const cls = ok ? 'ok' : (low ? 'low' : 'high');
    return `<div class="macro">
      <div class="macro-top"><span>${r.name}</span><b>${num(r.fact)} <i>/ ${num(r.target)} ${r.unit}</i></b></div>
      <div class="macro-bar"><span class="${cls}" style="width:${clamp(pct * 100, 2, 100)}%"></span></div>
      <div class="macro-note ${cls}">${ok ? 'норма закрыта' : (low ? 'ниже нормы на ' + num((1 - pct) * 100) + ' %' : 'выше нормы на ' + num((pct - 1) * 100) + ' %')}</div>
    </div>`;
  }).join('');

  const proteinPct = M.pr / T.protein, fiberPct = M.fi / T.fiber;
  let verdict;
  if (proteinPct >= 0.9 && fiberPct >= 0.9) {
    verdict = `<span class="ok">✓ Норма белка и клетчатки закрыта</span> — меню подобрано под цель «${T.goal.name.toLowerCase()}».`;
  } else {
    const miss = [];
    if (proteinPct < 0.9) miss.push('белка');
    if (fiberPct < 0.9) miss.push('клетчатки');
    verdict = `<span class="low">⚠ Не хватает ${miss.join(' и ')}</span> — из доступных при ваших ограничениях и бюджете продуктов больше не набирается. Поднимите бюджет или снимите часть исключений.`;
  }

  $('#macros').innerHTML = `
    <div class="macro-head">
      <div>
        <h3>КБЖУ на человека в день</h3>
        <p>Норма для веса ${state.weight} кг и цели «${T.goal.name}»: ${num(T.kcal)} ккал, ${num(T.protein)} г белка, ${num(T.fiber)} г клетчатки.</p>
      </div>
      <div class="macro-portion">Порции блюд: <b>×${(p.avgScale).toFixed(2)}</b><span>от базовой</span></div>
    </div>
    <div class="macro-grid">${bars}</div>
    <div class="macro-verdict">${verdict}</div>`;
}

function renderNotice() {
  const p = state.plan;
  const el = $('#notice');
  const diff = state.budget - p.shop.total;
  let extraWarn = '';
  if (p.uniqCount && p.uniqCount < 10) {
    extraWarn = `<br><br>⚠ С такими исключениями осталось всего ${p.uniqCount} ${plural(p.uniqCount, 'подходящее блюдо', 'подходящих блюда', 'подходящих блюд')} — меню будет однообразным.`;
  }
  if (diff < 0) {
    el.className = 'notice warn';
    el.innerHTML = p.status === 'low'
      ? `<b>Бюджета не хватает.</b> Меню собрано из самых дешёвых блюд, но минимум для цели «${p.targets.goal.name.toLowerCase()}» на ${state.days} дн. для ${state.people} чел. — <b>${money(p.minTotal)}</b>. Не хватает ${money(-diff)}.${extraWarn}`
      : `<b>Корзина вышла за бюджет на ${money(-diff)}</b> — так бывает после ручной замены блюд. Верните блюдо подешевле или нажмите «Пересобрать».${extraWarn}`;
  } else if (p.status === 'high') {
    el.className = 'notice ok';
    el.innerHTML = `<b>Бюджет с запасом.</b> Меню под вашу норму КБЖУ стоит ${money(p.shop.total)}. Часть свободных денег добрана фруктами и молочкой (помечено «добор»), остаётся ${money(diff)}.${extraWarn}`;
  } else {
    el.className = 'notice ok';
    el.innerHTML = `<b>Уложились в бюджет.</b> Корзина ${money(p.shop.total)} из ${money(state.budget)}, свободно ${money(diff)}.${extraWarn}`;
  }
  el.hidden = false;
}

function renderMenu() {
  const p = state.plan;
  const weeks = [];
  for (let i = 0; i < p.menu.length; i += 7) weeks.push(p.menu.slice(i, i + 7));

  $('#panel-menu').innerHTML = weeks.map((w, wi) => {
    let wCost = 0;
    w.forEach(d => { wCost += dayMacros(d).cost * state.people; });
    const days = w.map(day => {
      const dt = dateFor(day.day, p.startDate);
      const dm = dayMacros(day);
      return `<div class="day">
        <div class="day-head">
          <b>${DOW_SHORT[dt.getDay()]}, ${dt.getDate()} ${MON[dt.getMonth()]}</b>
          <span>${num(dm.kc)} ккал</span>
        </div>
        <div class="day-macro">Б ${num(dm.pr)} · Ж ${num(dm.fa)} · У ${num(dm.ca)} · клетчатка ${num(dm.fi)} г</div>
        ${day.meals.map(m => {
          const r = RECIPE_BY_ID[m.id];
          const info = MEALS.find(x => x.id === m.type);
          const mac = recipeMacro(r);
          return `<div class="meal">
            <div class="meal-ic" style="background:${dishGradient(r)}">${dishEmoji(r)}</div>
            <div class="meal-body">
              <div class="meal-type">${info.name}</div>
              <div class="meal-name" data-recipe="${r.id}">${r.n}</div>
              <div class="meal-meta">${num(mac.kc * day.scale)} ккал · Б ${num(mac.pr * day.scale)} г · ${money(recipeCost(r, storeK(state.store)) * day.scale * state.people)}</div>
            </div>
            <button class="meal-swap" title="Заменить блюдо" data-swap="${day.day}:${m.type}">⇄</button>
          </div>`;
        }).join('')}
        ${(day.boost && day.boost.length) ? `<div class="day-boost">
          <b>+ добор до нормы</b>
          ${day.boost.map(b => `<span>${PRODUCT_BY_ID[b.id].n} ${b.g} г</span>`).join('')}
        </div>` : ''}
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
  p.shop.items.forEach(it => { (byCat[it.p.c] = byCat[it.p.c] || []).push(it); });

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
          <span class="si-name">${i.p.n}${i.extra ? ' <small class="si-extra">· добор</small>' : ''}</span>
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
  p.menu.forEach(d => d.meals.forEach(m => { used[m.id] = (used[m.id] || 0) + 1; }));
  const k = storeK(state.store);
  const list = Object.keys(used).map(id => {
    const r = RECIPE_BY_ID[id];
    return { r, count: used[id], mac: recipeMacro(r), cost: recipeCost(r, k) };
  }).sort((a, b) =>
    MEALS.findIndex(m => m.id === a.r.m) - MEALS.findIndex(m => m.id === b.r.m) ||
    b.mac.pr - a.mac.pr);

  $('#panel-recipes').innerHTML = `<p class="section-sub">В плане ${list.length} разных блюд, отсортированы по количеству белка. Нажмите на карточку — откроется рецепт с граммовками.</p>
    <div class="rec-grid">${list.map(x => `
      <div class="rec-card" data-recipe="${x.r.id}">
        <div class="rec-art" style="background:${dishGradient(x.r)}">${x.r.img
          ? `<img src="${x.r.img}" alt="${x.r.n}" loading="lazy">`
          : `<span>${dishEmoji(x.r)}</span>`}</div>
        <h4>${x.r.n}</h4>
        <div class="rec-meta">
          <span>${MEALS.find(m => m.id === x.r.m).icon} ${MEALS.find(m => m.id === x.r.m).name}</span>
          <span>⏱ ${x.r.t} мин</span>
          <span><b>${money(x.cost * p.avgScale * state.people)}</b> за подачу</span>
        </div>
        <div class="rec-macro">
          <span>${num(x.mac.kc * p.avgScale)} ккал</span>
          <span class="pr">Б ${num(x.mac.pr * p.avgScale)} г</span>
          <span>Ж ${num(x.mac.fa * p.avgScale)} г</span>
          <span>У ${num(x.mac.ca * p.avgScale)} г</span>
          <span class="fi">кл. ${num(x.mac.fi * p.avgScale)} г</span>
        </div>
        <div class="rec-times">в плане ${x.count} ${plural(x.count, 'раз', 'раза', 'раз')}</div>
      </div>`).join('')}</div>`;
}

function openRecipe(id) {
  const r = RECIPE_BY_ID[id];
  if (!r) return;
  const k = storeK(state.store);
  const scale = state.plan ? state.plan.avgScale : 1;
  const info = MEALS.find(m => m.id === r.m);
  const al = recipeAllergens(r);
  const mac = recipeMacro(r);
  $('#modalContent').innerHTML = `
    <div class="m-photo" style="background:${dishGradient(r)}">${r.img
      ? `<img src="${r.img}" alt="${r.n}">`
      : `<span>${dishEmoji(r)}</span><i>${info.name}</i>`}</div>
    <h3>${r.n}</h3>
    <div class="m-meta">
      <span>${info.icon} ${info.name}</span>
      <span>⏱ ${r.t} мин</span>
      <span>💸 ${money(recipeCost(r, k) * scale * state.people)} на ${state.people} ${plural(state.people, 'человека', 'человек', 'человек')}</span>
    </div>
    <div class="m-macro">
      <div><b>${num(mac.kc * scale)}</b><span>ккал</span></div>
      <div><b>${num(mac.pr * scale)} г</b><span>белки</span></div>
      <div><b>${num(mac.fa * scale)} г</b><span>жиры</span></div>
      <div><b>${num(mac.ca * scale)} г</b><span>углеводы</span></div>
      <div><b>${num(mac.fi * scale)} г</b><span>клетчатка</span></div>
    </div>
    <div class="m-sec">Продукты на ${state.people} ${plural(state.people, 'человека', 'человек', 'человек')}${scale !== 1 ? ' (порции под вашу норму калорий)' : ''}</div>
    ${r.ing.map(([pid, g]) => {
      const p = PRODUCT_BY_ID[pid];
      const total = g * PORTION * scale * state.people;
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
  const curItem = list.find(x => x.r.id === cur.id) || list[0];
  const neighbours = [];
  [dayIdx - 2, dayIdx - 1, dayIdx + 1, dayIdx + 2].forEach(i => {
    const d = state.plan.menu[i];
    if (d) { const mm = d.meals.find(m => m.type === type); if (mm) neighbours.push(mm.id); }
  });
  /* берём блюдо схожей цены, но с белком не хуже текущего, если такие есть */
  const cands = list.filter(x => x.r.id !== cur.id && neighbours.indexOf(x.r.id) === -1
    && x.cost <= curItem.cost * 1.35 && x.cost >= curItem.cost * 0.6);
  const better = cands.filter(x => x.m.pr >= curItem.m.pr * 0.9);
  const pickFrom = better.length ? better : (cands.length ? cands : list.filter(x => x.r.id !== cur.id));
  const pick = pickFrom[Math.floor(Math.random() * pickFrom.length)];
  cur.id = pick.r.id;

  /* пересчитываем масштаб порций и добор дня под норму */
  const T = state.plan.targets;
  const raw = { kc: 0, pr: 0, fa: 0, ca: 0, fi: 0 };
  day.meals.forEach(m => {
    const mac = recipeMacro(RECIPE_BY_ID[m.id]);
    raw.kc += mac.kc; raw.pr += mac.pr; raw.fa += mac.fa; raw.ca += mac.ca; raw.fi += mac.fi;
  });
  if (raw.kc > 0) day.scale = Math.round(clamp(T.kcal / raw.kc, 0.7, 1.7) * 100) / 100;
  day.boost = buildBoost({
    kc: raw.kc * day.scale, pr: raw.pr * day.scale, fa: raw.fa * day.scale,
    ca: raw.ca * day.scale, fi: raw.fi * day.scale,
  }, T);

  recalcPlan();
  renderAll();
  savePlan();
}

/* ---------- общий рендер ---------- */
function renderAll() {
  const p = state.plan;
  if (!p) return;
  $('#resultSub').textContent =
    `${p.targets.goal.name} · ${state.days} ${plural(state.days, 'день', 'дня', 'дней')} · ${state.people} ${plural(state.people, 'человек', 'человека', 'человек')} · ` +
    `${state.mealsCount} ${plural(state.mealsCount, 'приём', 'приёма', 'приёмов')} пищи · «${STORES.find(s => s.id === state.store).name}»` +
    (state.excluded.length ? ` · без: ${state.excluded.map(a => ALLERGENS.find(x => x.id === a).name.toLowerCase()).join(', ')}` : '');
  renderNotice();
  renderStats();
  renderMacros();
  renderMenu();
  renderShopping();
  renderRecipesTab();
}

/* ============================================================
   ФОРМА
   ============================================================ */
function initForm() {
  /* цели */
  $('#goalList').innerHTML = GOALS.map(g => `
    <button type="button" class="goal ${g.id === state.goal ? 'active' : ''}" data-goal="${g.id}">
      <span class="goal-ic">${g.icon}</span>
      <span class="goal-name">${g.name}</span>
      <span class="goal-desc">${g.desc}</span>
      <span class="goal-num" data-goalnum="${g.id}"></span>
    </button>`).join('');
  $$('#goalList .goal').forEach(b => b.addEventListener('click', () => {
    state.goal = b.dataset.goal;
    $$('#goalList .goal').forEach(x => x.classList.toggle('active', x === b));
    updateGoalNumbers();
    saveSettings();
  }));

  $('#weight').addEventListener('input', () => {
    state.weight = clamp(parseInt($('#weight').value, 10) || 70, 30, 200);
    updateGoalNumbers();
    saveSettings();
  });

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

  $$('#periodChips .chip').forEach(c => c.addEventListener('click', () => {
    state.days = +c.dataset.days;
    $$('#periodChips .chip').forEach(x => x.classList.toggle('active', x === c));
    saveSettings();
  }));

  $$('#mealsChips .chip').forEach(c => c.addEventListener('click', () => {
    state.mealsCount = +c.dataset.meals;
    $$('#mealsChips .chip').forEach(x => x.classList.toggle('active', x === c));
    saveSettings();
  }));

  const upd = () => { $('#peopleValue').textContent = state.people; saveSettings(); };
  $('#peopleMinus').addEventListener('click', () => { state.people = Math.max(1, state.people - 1); upd(); });
  $('#peoplePlus').addEventListener('click', () => { state.people = Math.min(8, state.people + 1); upd(); });

  $('#optVeg').addEventListener('change', e => { state.veg = e.target.checked; saveSettings(); });
  $('#optNoPork').addEventListener('change', e => { state.noPork = e.target.checked; saveSettings(); });
  $('#optStaples').addEventListener('change', e => { state.staplesOwned = e.target.checked; saveSettings(); });

  $('#planForm').addEventListener('submit', e => { e.preventDefault(); run(); });
}

/* подписи с нормой под каждой целью */
function updateGoalNumbers() {
  const save = state.goal;
  GOALS.forEach(g => {
    state.goal = g.id;
    const T = targets();
    const el = $(`[data-goalnum="${g.id}"]`);
    if (el) el.textContent = `${num(T.kcal)} ккал · ${num(T.protein)} г белка · ${num(T.fiber)} г клетчатки`;
  });
  state.goal = save;
}

function applySettingsToForm() {
  $('#budget').value = state.budget;
  $('#weight').value = state.weight;
  $$('#budgetChips .chip').forEach(c => c.classList.toggle('active', +c.dataset.budget === state.budget));
  $$('#periodChips .chip').forEach(c => c.classList.toggle('active', +c.dataset.days === state.days));
  $$('#mealsChips .chip').forEach(c => c.classList.toggle('active', +c.dataset.meals === state.mealsCount));
  $('#peopleValue').textContent = state.people;
  $$('#goalList .goal').forEach(b => b.classList.toggle('active', b.dataset.goal === state.goal));
  $$('#storeList .store').forEach(b => b.classList.toggle('active', b.dataset.store === state.store));
  $$('#allergenList .chip').forEach(b => b.classList.toggle('active', state.excluded.indexOf(b.dataset.allergen) !== -1));
  $('#optVeg').checked = state.veg;
  $('#optNoPork').checked = state.noPork;
  $('#optStaples').checked = state.staplesOwned;
  updateGoalNumbers();
  updateBudgetHint();
}

/* ============================================================
   ЗАПУСК С ЗАГРУЗКОЙ
   ============================================================ */
const LOADER_STEPS = [
  'Загружаем каталог магазина и цены',
  'Считаем вашу норму КБЖУ',
  'Убираем продукты с вашими аллергенами',
  'Подбираем блюда под белок и клетчатку',
  'Подгоняем корзину под бюджет',
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
    if (i > 0) {
      lis[i - 1].classList.remove('on');
      lis[i - 1].classList.add('done');
      lis[i - 1].querySelector('.ic').textContent = '✓';
    }
    if (i < lis.length) {
      lis[i].classList.add('on');
      const pct = Math.round(((i + 1) / lis.length) * 100);
      $('#loaderPct').textContent = pct + '%';
      $('#ringFg').style.strokeDashoffset = 327 - (327 * pct / 100);
      if (i === 3) setTimeout(() => { result = generatePlan(Date.now() % 100000); }, 30);
      i++;
      setTimeout(tick, 380 + Math.random() * 240);
    } else {
      setTimeout(() => {
        loader.hidden = true;
        document.body.style.overflow = '';
        if (!result) result = generatePlan(Date.now() % 100000);
        $('#result').hidden = false;
        if (result.error) {
          state.plan = null;
          $('#resultSub').textContent = '';
          $('#stats').innerHTML = '';
          $('#macros').innerHTML = '';
          $('#panel-menu').innerHTML = '';
          $('#shopList').innerHTML = '';
          $('#shopTotal').innerHTML = '';
          $('#panel-recipes').innerHTML = '';
          const el = $('#notice');
          el.className = 'notice warn';
          el.innerHTML = '<b>Не получилось собрать меню.</b> ' + result.error;
          el.hidden = false;
        } else {
          state.plan = result;
          renderAll();
          savePlan();
        }
        $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 260);
    }
  };
  tick();
}

/* ============================================================
   ЭКСПОРТ
   ============================================================ */
function shoppingText() {
  const p = state.plan;
  const store = STORES.find(s => s.id === state.store).name;
  let out = `СПИСОК ПОКУПОК — ${store}\n`;
  out += `${p.targets.goal.name} · ${state.days} дн. · ${state.people} чел. · бюджет ${money(state.budget)}\n`;
  out += `Норма: ${num(p.targets.kcal)} ккал, ${num(p.targets.protein)} г белка, ${num(p.targets.fiber)} г клетчатки в день\n`;
  out += `Факт: ${num(p.macros.kc)} ккал, ${num(p.macros.pr)} г белка, ${num(p.macros.fi)} г клетчатки\n`;
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
      const b = $('#btnCopy'), t = b.textContent;
      b.textContent = '✓ Скопировано';
      setTimeout(() => { b.textContent = t; }, 1800);
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
  const k = storeK($('#catalogStore').value);
  const q = $('#catalogSearch').value.trim().toLowerCase();
  let html = '';
  CATEGORIES.forEach(cat => {
    const list = PRODUCTS.filter(p => p.c === cat.id && (!q || p.n.toLowerCase().includes(q)));
    if (!list.length) return;
    html += `<div class="cat-block"><h4>${cat.icon} ${cat.name} <span class="cat-count">· ${list.length}</span></h4>
      ${list.map(p => `<div class="cat-row">
        <span class="cr-name">${p.n}</span>
        <span class="cr-tags">${p.a.map(a => {
          const A = ALLERGENS.find(x => x.id === a);
          return A ? `<span class="cr-tag">${A.icon} ${A.name}</span>` : '';
        }).join('')}</span>
        <span class="cr-macro">${p.kc} ккал · Б ${p.pr} · Ж ${p.fa} · У ${p.ca} · кл. ${p.fi}</span>
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
const LS_SET = 'menuplan_settings_v2';
const LS_PLAN = 'menuplan_plan_v2';

/* живая подсказка: сколько минимально стоит рацион при текущих настройках */
function updateBudgetHint() {
  const el = $('#budgetHint');
  if (!el) return;
  try {
    const pool = buildPool();
    if (activeMeals().some(m => !pool[m].length)) {
      el.innerHTML = 'Это вся сумма на выбранный период, а не в день.';
      return;
    }
    const T = targets();
    const shop = computeShopping(buildMenu(pool, 0, 20260904, T));
    el.innerHTML = `Это вся сумма на весь период, а не в день. Чтобы закрыть норму КБЖУ для цели ` +
      `«${T.goal.name.toLowerCase()}» на ${state.days} ${plural(state.days, 'день', 'дня', 'дней')} ` +
      `для ${state.people} ${plural(state.people, 'человека', 'человек', 'человек')}, ` +
      `нужно минимум около <b>${money(shop.total)}</b>.`;
  } catch (e) {
    el.innerHTML = 'Это вся сумма на выбранный период, а не в день.';
  }
}

function saveSettings() {
  updateBudgetHint();
  try {
    localStorage.setItem(LS_SET, JSON.stringify({
      goal: state.goal, weight: state.weight, budget: state.budget, days: state.days,
      people: state.people, mealsCount: state.mealsCount, store: state.store,
      excluded: state.excluded, veg: state.veg, noPork: state.noPork,
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
    if (!p || !p.menu || !p.targets) return;
    Object.assign(state, p.settings || {});
    state.plan = p;
    recalcPlan();           /* вдруг обновились цены в data.js */
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

  /* мягкое появление блоков при прокрутке */
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: .08, rootMargin: '0px 0px -40px 0px' });
    $$('.reveal').forEach(el => io.observe(el));
  } else {
    $$('.reveal').forEach(el => el.classList.add('in'));
  }
})();
