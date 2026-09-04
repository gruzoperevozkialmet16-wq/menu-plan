/* ============================================================
   МЕНЮ-ПЛАН — логика
   ============================================================ */

/* ---------- состояние ---------- */
const state = {
  goal: 'normal',
  dietStyle: 'any',   /* any | healthy | lean */
  cuisines: [],       /* пусто = любая кухня */
  budget: 7000,
  days: 7,
  persons: [
    { type: 'adult', sex: 'm', weight: 78, height: 176, age: 30, activity: 'light' },
    { type: 'adult', sex: 'f', weight: 62, height: 165, age: 30, activity: 'light' },
  ],
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

/* ---------- нормы КБЖУ ----------
   Норма считается для каждого едока отдельно: у взрослого от веса и цели,
   у ребёнка — от возраста (цель к нему не применяется). Меню собирается
   на суммарную норму семьи, а порции делятся пропорционально. */

function childNorm(age) {
  return CHILD_NORMS.find(n => age <= n.max) || CHILD_NORMS[CHILD_NORMS.length - 1];
}
function activityOf(p) {
  return ACTIVITY.find(a => a.id === (p.activity || 'light')) || ACTIVITY[1];
}
function sexOf(p) {
  return SEXES.find(s => s.id === (p.sex || 'm')) || SEXES[0];
}

/* Основной обмен по формуле Миффлина — Сан Жеора: это медицинский стандарт,
   и именно он объясняет, почему женщине нужно заметно меньше калорий, чем
   мужчине того же веса: разная безжировая масса и метаболизм. */
function bmr(p) {
  const w = p.weight || 70;
  const h = p.height || sexOf(p).height;
  const age = p.age || 30;
  const base = 10 * w + 6.25 * h - 5 * age;
  return p.sex === 'f' ? base - 161 : base + 5;
}

function personTargets(p) {
  if (p.type === 'child') {
    const n = childNorm(p.age || 7);
    const kcal = p.sex === 'f' ? n.kcalF : n.kcalM;
    const protein = Math.max(20, Math.round((p.weight || 25) * n.prPerKg));
    const fat = Math.round(kcal * 0.32 / 9);
    const fiber = Math.max(10, Math.round((p.age || 7) + 5));
    const carb = Math.max(60, Math.round((kcal - protein * 4 - fat * 9) / 4));
    return { kcal, protein, fat, carb, fiber, ageLabel: n.label, isChild: true, bmr: 0, tdee: kcal };
  }
  const g = GOALS.find(x => x.id === state.goal) || GOALS[1];
  const w = p.weight || 70;
  const b = bmr(p);
  const tdee = b * activityOf(p).k;
  /* ниже основного обмена не опускаемся даже на диете — это уже голодание */
  const kcal = Math.max(Math.round(b * 1.05), Math.round(tdee * g.kcalFactor));
  const protein = Math.round(w * g.proteinPerKg);
  const fat = Math.round(w * g.fatPerKg);
  const fiber = Math.max(20, Math.round(kcal / 1000 * 14));
  const carb = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return {
    kcal, protein, fat, carb, fiber, isChild: false,
    bmr: Math.round(b), tdee: Math.round(tdee),
  };
}

function peopleCount() { return state.persons.length; }
function childCount() { return state.persons.filter(p => p.type === 'child').length; }

/* Суммарная норма семьи + персональные нормы */
function targets() {
  const g = GOALS.find(x => x.id === state.goal) || GOALS[1];
  const per = state.persons.map(p => ({ person: p, t: personTargets(p) }));
  const sum = { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 };
  per.forEach(x => {
    sum.kcal += x.t.kcal; sum.protein += x.t.protein;
    sum.fat += x.t.fat; sum.carb += x.t.carb; sum.fiber += x.t.fiber;
  });
  return {
    kcal: sum.kcal, protein: sum.protein, fat: sum.fat, carb: sum.carb, fiber: sum.fiber,
    goal: g, per, people: per.length,
  };
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

/* ---------- стиль питания ----------
   Постное и «правильное» определяются по составу блюда, а не вручную:
   так новые рецепты попадают в фильтры автоматически. */
const ANIMAL_EXTRA = ['milk', 'kefir', 'sour_cream', 'cottage_cheese', 'cheese_russian',
  'processed_cheese', 'butter', 'yogurt_natural', 'greek_yogurt', 'cream_10', 'cream_20',
  'cream_cheese', 'eggs', 'honey', 'parmesan', 'mozzarella', 'ricotta', 'mascarpone', 'feta',
  'suluguni', 'adygea', 'cheddar', 'condensed_milk', 'mayo', 'noodles_egg', 'burger_buns',
  'cookies', 'chocolate'];
const JUNK_IDS = ['sausage_doctor', 'sausages_milk', 'mayo', 'cookies', 'chocolate', 'salami',
  'bacon', 'crab_sticks', 'condensed_milk', 'jam', 'juice', 'ketchup'];
const FAT_IDS = ['sunflower_oil', 'olive_oil', 'sesame_oil', 'butter'];

/* Постное: ни мяса, ни рыбы, ни молочного, ни яиц, ни мёда */
function isLean(r) {
  return !r.ing.some(([id]) =>
    MEAT_IDS.indexOf(id) !== -1 || ANIMAL_EXTRA.indexOf(id) !== -1);
}

/* Правильное питание: без колбас, майонеза и сладостей, немного масла
   и сахара, и при этом блюдо что-то даёт — белок или клетчатку */
function isHealthy(r) {
  if (r.ing.some(([id]) => JUNK_IDS.indexOf(id) !== -1)) return false;
  const sugar = r.ing.find(([id]) => id === 'sugar');
  if (sugar && sugar[1] > 10) return false;
  const fat = r.ing.filter(([id]) => FAT_IDS.indexOf(id) !== -1).reduce((s, [, g]) => s + g, 0);
  if (fat > 16) return false;
  const m = recipeMacro(r);
  return m.pr >= 12 || m.fi >= 3;
}

function matchesStyle(r) {
  if (state.dietStyle === 'lean') return isLean(r);
  if (state.dietStyle === 'healthy') return isHealthy(r);
  return true;
}
function matchesCuisine(r) {
  return !state.cuisines.length || state.cuisines.indexOf(r.cuisine) !== -1;
}

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
    if (!matchesCuisine(r)) return;
    if (!matchesStyle(r)) return;
    pool[r.m].push({ r, cost: recipeCost(r, k), m: recipeMacro(r) });
  });
  Object.keys(pool).forEach(m => pool[m].sort((a, b) => a.cost - b.cost));
  return pool;
}

function activeMeals() {
  /* при одном приёме в день это основная еда — ужин; при двух добавляется обед */
  if (state.mealsCount === 1) return ['dinner'];
  if (state.mealsCount === 2) return ['lunch', 'dinner'];
  if (state.mealsCount === 3) return ['breakfast', 'lunch', 'dinner'];
  return ['breakfast', 'lunch', 'dinner', 'snack'];
}

/* Сколько базовых порций приходится на человека при таком числе приёмов.
   При одном приёме в день тарелка закономерно больше, и штрафовать за это
   размером порции нельзя — иначе алгоритм не соберёт дневную норму. */
function expectedPortion() {
  return 4 / Math.max(1, state.mealsCount);
}

/* ---------- добор белка и клетчатки ----------
   Одними блюдами норму белка на диете и на массе часто не закрыть.
   Поэтому к дню добавляется «добавка»: творог, яйца, грудка, отруби —
   ровно столько, сколько нужно, и только если остаётся запас по калориям. */
/* Добавки к рациону. step — разумная разовая порция на человека,
   max — сколько максимум можно съесть за день, meal — к какому приёму
   логично добавить. Без этих границ добор превращался в «800 г гороха». */
const BOOST_PROTEIN = [
  { id: 'cottage_cheese',    step: 100, max: 250, meal: 'breakfast' },
  { id: 'eggs',              step: 60,  max: 180, meal: 'breakfast' },
  { id: 'chicken_fillet',    step: 80,  max: 200, meal: 'dinner' },
  { id: 'greek_yogurt',      step: 150, max: 300, meal: 'snack' },
  { id: 'kefir',             step: 200, max: 500, meal: 'snack' },
  { id: 'turkey_fillet',     step: 80,  max: 200, meal: 'dinner' },
  { id: 'canned_tuna',       step: 60,  max: 120, meal: 'lunch' },
  { id: 'tofu',              step: 80,  max: 200, meal: 'lunch' },
  { id: 'cheese_russian',    step: 30,  max: 60,  meal: 'snack' },
  { id: 'milk',              step: 200, max: 400, meal: 'breakfast' },
  { id: 'lentils',           step: 30,  max: 60,  meal: 'lunch' },
  { id: 'chickpeas',         step: 30,  max: 60,  meal: 'lunch' },
  { id: 'peas_dry',          step: 30,  max: 60,  meal: 'lunch' },
  { id: 'red_beans',         step: 30,  max: 60,  meal: 'lunch' },
  { id: 'white_beans_canned',step: 80,  max: 160, meal: 'lunch' },
  { id: 'peanut',            step: 20,  max: 40,  meal: 'snack' },
];
const BOOST_FIBER = [
  { id: 'bran',            step: 15,  max: 30,  meal: 'breakfast' },
  { id: 'apple',           step: 150, max: 300, meal: 'snack' },
  { id: 'carrot',          step: 100, max: 200, meal: 'snack' },
  { id: 'cabbage',         step: 120, max: 240, meal: 'dinner' },
  { id: 'broccoli_frozen', step: 120, max: 240, meal: 'dinner' },
  { id: 'beans_canned',    step: 80,  max: 160, meal: 'lunch' },
  { id: 'dried_apricots',  step: 40,  max: 80,  meal: 'snack' },
];

function productAllowed(p) {
  if (!p) return false;
  if (p.a.some(a => state.excluded.indexOf(a) !== -1)) return false;
  if (state.veg && MEAT_IDS.indexOf(p.id) !== -1) return false;
  if (state.noPork && PORK_IDS.indexOf(p.id) !== -1) return false;
  /* добор и добавки тоже подчиняются стилю питания */
  if (state.dietStyle === 'lean' &&
      (MEAT_IDS.indexOf(p.id) !== -1 || ANIMAL_EXTRA.indexOf(p.id) !== -1)) return false;
  if (state.dietStyle === 'healthy' && JUNK_IDS.indexOf(p.id) !== -1) return false;
  return true;
}

/* Во сколько калорий обходится грамм белка из лучшего доступного источника.
   На обычном меню это грудка или творог (~5–7 ккал/г), на постном — бобовые
   и тофу (до 15 ккал/г), поэтому резерв калорий под добор нужен больше. */
function kcalPerGramProtein() {
  const list = BOOST_PROTEIN.map(id => PRODUCT_BY_ID[id]).filter(p => productAllowed(p) && p.pr > 5);
  if (!list.length) return 6;
  return clamp(Math.min.apply(null, list.map(p => p.kc / p.pr)), 4, 16);
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
  const N = Math.max(1, T.people);
  const room = () => T.kcal * kcalRoomFactor() - kc;

  const add = (item, p, g) => {
    const ex = boost.find(b => b.id === p.id);
    if (ex) ex.g += g; else boost.push({ id: p.id, g, meal: item.meal });
    kc += p.kc * g / 100; pr += p.pr * g / 100; fi += p.fi * g / 100;
  };
  const takenOf = id => { const b = boost.find(x => x.id === id); return b ? b.g : 0; };

  /* Можно ли добавить ещё порцию этого продукта: не превышаем ни дневной
     максимум на человека, ни калорийный запас. */
  const canAdd = item => {
    const p = PRODUCT_BY_ID[item.id];
    if (!p || !productAllowed(p)) return null;
    const step = item.step * N;
    if (takenOf(item.id) + step > item.max * N + 0.1) return null;
    if (p.kc * step / 100 > room()) return null;
    return { p, step };
  };

  /* Белок: сначала постные продукты, среди них — самые дешёвые за грамм белка.
     Порции идут по кругу, чтобы вместо горы одного продукта получился
     нормальный набор: творог утром, грудка вечером, кефир на перекус. */
  const lean = state.dietStyle === 'lean' ? 0.065 : (state.goal === 'diet' ? 0.09 : 0.05);
  const allPr = BOOST_PROTEIN.filter(x => {
    const p = PRODUCT_BY_ID[x.id];
    return p && productAllowed(p) && p.pr > 5;
  });
  let prList = allPr.filter(x => {
    const p = PRODUCT_BY_ID[x.id];
    return p.pr / Math.max(p.kc, 1) >= lean;
  });
  if (!prList.length) prList = allPr;
  prList.sort((a, b) => {
    const pa = PRODUCT_BY_ID[a.id], pb = PRODUCT_BY_ID[b.id];
    return (pa.price / pa.pr) - (pb.price / pb.pr);
  });

  let guard = 0;
  while (pr < T.protein * 0.98 && room() > 50 && guard < 40) {
    guard++;
    /* по кругу: каждый раз берём продукт, которого пока взяли меньше всего порций */
    const options = prList.map(x => ({ x, can: canAdd(x) })).filter(o => o.can);
    if (!options.length) break;
    options.sort((a, b) =>
      (takenOf(a.x.id) / a.x.step) - (takenOf(b.x.id) / b.x.step));
    const pick = options[0];
    add(pick.x, pick.can.p, pick.can.step);
  }

  /* Клетчатка: овощи, фрукты и отруби — калорий почти не добавляют */
  const fiList = BOOST_FIBER.filter(x => {
    const p = PRODUCT_BY_ID[x.id];
    return p && productAllowed(p) && p.fi > 1.5;
  }).sort((a, b) => {
    const pa = PRODUCT_BY_ID[a.id], pb = PRODUCT_BY_ID[b.id];
    return (pb.fi / Math.max(pb.kc, 1)) - (pa.fi / Math.max(pa.kc, 1));
  });

  guard = 0;
  while (fi < T.fiber * 0.98 && room() > 30 && guard < 40) {
    guard++;
    const options = fiList.map(x => ({ x, can: canAdd(x) })).filter(o => o.can);
    if (!options.length) break;
    options.sort((a, b) =>
      (takenOf(a.x.id) / a.x.step) - (takenOf(b.x.id) / b.x.step));
    const pick = options[0];
    add(pick.x, pick.can.p, pick.can.step);
  }

  return boost.map(b => ({ id: b.id, g: Math.round(b.g), meal: b.meal }));
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

  /* Если пользователь не выбрал постное и не вегетарианец, в дне должно быть
     мясо или рыба — иначе меню выглядит постным даже в режиме «правильное
     питание»: растительные блюда дешевле, и подбор под бюджет тянет к ним. */
  const meaty = x => x.item.r.ing.some(([id]) => MEAT_IDS.indexOf(id) !== -1);
  const wantMeat = state.dietStyle !== 'lean' && !state.veg &&
    ['lunch', 'dinner'].some(m => pool[m] && pool[m].some(x => x.r.ing.some(([id]) => MEAT_IDS.indexOf(id) !== -1)));

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
      const N = Math.max(1, T.people);
      const exp = expectedPortion();
      const lo = 0.55 * exp * N, hi = 2.2 * exp * N;
      let scale = clamp(T.kcal / t.kc, lo, hi);
      const prDeficit = T.protein - t.pr * scale;
      if (prDeficit > 0) {
        const reserve = Math.min(T.kcal * 0.42, prDeficit * kcalPerGramProtein());
        scale = clamp((T.kcal - reserve) / t.kc, lo, hi);
      }
      const pr = t.pr * scale, fi = t.fi * scale, fa = t.fa * scale, cost = t.cost * scale;

      let meatPenalty = 0;
      if (wantMeat) {
        const n = picked.filter(meaty).length;
        if (n === 0) meatPenalty = 85;        /* день без мяса и рыбы — так нельзя */
        else if (n === 1) meatPenalty = 12;   /* приемлемо, но лучше два раза */
      }

      const score =
        need(pr, T.protein) * 140 + over(pr, T.protein * 1.4) * 25 +
        need(fi, T.fiber) * 90 + over(fi, T.fiber * 1.7) * 10 +
        over(fa, T.fat * 1.6) * 30 +
        Math.abs(scale / Math.max(1, T.people) / expectedPortion() - 1) * 25 + meatPenalty +
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
        grams[id] = (grams[id] || 0) + g * PORTION * day.scale;
      });
    });
    (day.boost || []).forEach(b => {
      grams[b.id] = (grams[b.id] || 0) + b.g;
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
    .filter(productAllowed)
    .map(p => ({ id: p.id, cost: p.pack * p.price * k }))
    .sort((a, b) => a.cost - b.cost);
  if (!cands.length) return [];
  const out = [];
  const perItemCap = Math.max(2, Math.ceil(state.days * peopleCount() / 10));
  const maxPacks = Math.max(4, Math.round(state.days * peopleCount() * 0.6));
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
      goal: state.goal, dietStyle: state.dietStyle, cuisines: state.cuisines.slice(),
      persons: JSON.parse(JSON.stringify(state.persons)), budget: state.budget, days: state.days,
      mealsCount: state.mealsCount, store: state.store,
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
    { b: money(perDay / peopleCount()), s: 'В день на человека' },
    { b: p.targets.goal.icon + ' ' + p.targets.goal.name, s: p.targets.goal.short },
  ];
  $('#stats').innerHTML = stats.map(s =>
    `<div class="stat ${s.c || ''}"><b>${s.b}</b><span>${s.s}</span></div>`).join('');
}

/* Подпись состава семьи: «2 взрослых и 1 ребёнок» */
function peopleLabel() {
  const a = state.persons.filter(p => p.type === 'adult').length;
  const c = childCount();
  const parts = [];
  if (a) parts.push(a + ' ' + plural(a, 'взрослый', 'взрослых', 'взрослых'));
  if (c) parts.push(c + ' ' + plural(c, 'ребёнок', 'ребёнка', 'детей'));
  return parts.join(' и ') || 'никого';
}

function personName(p) {
  const sx = sexOf(p);
  if (p.type === 'child') {
    return sx.childName + (p.age ? ', ' + p.age + ' ' + plural(p.age, 'год', 'года', 'лет') : '');
  }
  return sx.name + (p.weight ? ', ' + p.weight + ' кг' : '');
}

/* Блок КБЖУ: сначала разбивка по едокам, затем итог по семье */
function renderMacros() {
  const p = state.plan;
  const T = p.targets, M = p.macros;

  /* Еда делится между едоками по каждому нутриенту отдельно: калории — по норме
     калорий, белок — по норме белка. Иначе взрослому на диете, которому нужно
     много белка при малых калориях, доставалось бы слишком мало. */
  const share = (val, total) => (total > 0 ? val / total : 1 / Math.max(1, T.people));
  const persons = (T.per || []).map((x, i) => {
    const fact = {
      kc: M.kc * share(x.t.kcal, T.kcal),
      pr: M.pr * share(x.t.protein, T.protein),
      fa: M.fa * share(x.t.fat, T.fat),
      ca: M.ca * share(x.t.carb, T.carb),
      fi: M.fi * share(x.t.fiber, T.fiber),
    };
    const prPct = fact.pr / x.t.protein, fiPct = fact.fi / x.t.fiber;
    const okAll = prPct >= 0.9 && fiPct >= 0.9;
    return `<div class="person-macro${x.t.isChild ? ' is-child' : ''}">
      <div class="pm-head">
        <b>${x.t.isChild ? '🧒' : '🧑'} ${personName(x.person, i)}</b>
        <span>${x.t.isChild ? 'нормы по возрасту' : 'цель «' + T.goal.name.toLowerCase() + '»'}</span>
      </div>
      <div class="pm-rows">
        <div><i>Калории</i><b>${num(fact.kc)}</b><em>из ${num(x.t.kcal)}</em></div>
        <div><i>Белки</i><b class="${prPct >= 0.9 ? 'ok' : 'low'}">${num(fact.pr)} г</b><em>из ${num(x.t.protein)} г</em></div>
        <div><i>Жиры</i><b>${num(fact.fa)} г</b><em>из ${num(x.t.fat)} г</em></div>
        <div><i>Углеводы</i><b>${num(fact.ca)} г</b><em>из ${num(x.t.carb)} г</em></div>
        <div><i>Клетчатка</i><b class="${fiPct >= 0.9 ? 'ok' : 'low'}">${num(fact.fi)} г</b><em>из ${num(x.t.fiber)} г</em></div>
      </div>
      ${okAll ? '' : '<div class="pm-warn">Белок или клетчатка ниже нормы</div>'}
    </div>`;
  }).join('');

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

  const kidNote = childCount()
    ? `<div class="macro-kids">🧒 Детские нормы считаются по возрасту, а не по цели взрослых:
       даже в режиме «Диетическое» ребёнку рассчитывается полноценный рацион для роста.</div>`
    : '';

  $('#macros').innerHTML = `
    <div class="macro-head">
      <div>
        <h3>КБЖУ по едокам</h3>
        <p>Еда распределяется пропорционально норме каждого: ${peopleLabel()}.
        Итого на семью в день — ${num(T.kcal)} ккал, ${num(T.protein)} г белка, ${num(T.fiber)} г клетчатки.</p>
      </div>
      <div class="macro-portion">Порции блюд: <b>×${(p.avgScale / Math.max(1, T.people)).toFixed(2)}</b><span>на человека</span></div>
    </div>
    <div class="person-macros">${persons}</div>
    ${kidNote}
    <h4 class="macro-sub">Итого на всю семью за день</h4>
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
      ? `<b>Бюджета не хватает.</b> Меню собрано из самых дешёвых блюд, но минимум для цели «${p.targets.goal.name.toLowerCase()}» на ${state.days} дн. для ${peopleCount()} чел. — <b>${money(p.minTotal)}</b>. Не хватает ${money(-diff)}.${extraWarn}`
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
    w.forEach(d => { wCost += dayMacros(d).cost; });
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
              <div class="meal-meta">${num(mac.kc * day.scale)} ккал · Б ${num(mac.pr * day.scale)} г · ${money(recipeCost(r, storeK(state.store)) * day.scale)}</div>
            </div>
            <button class="meal-swap" title="Заменить блюдо" data-swap="${day.day}:${m.type}">⇄</button>
          </div>`;
        }).join('')}
        ${(day.boost && day.boost.length) ? `<div class="day-boost">
          <b>Добавить к приёмам пищи</b>
          ${day.boost.map(b => {
            const p = PRODUCT_BY_ID[b.id];
            const info = MEALS.find(x => x.id === (b.meal || 'snack'));
            const per = b.g / Math.max(1, peopleCount());
            const label = p.id === 'eggs'
              ? Math.round(per / 60) + ' ' + plural(Math.round(per / 60), 'яйцо', 'яйца', 'яиц')
              : (per >= 1000 ? kgLabel(per / 1000) : Math.round(per) + ' г');
            return `<span title="на одного человека">${info.icon} ${p.n} — ${label}</span>`;
          }).join('')}
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
        <label class="shop-item" data-pid="${i.p.id}">
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
    cb.addEventListener('change', () => {
      cb.closest('.shop-item').classList.toggle('checked', cb.checked);
      renderBought();
    });
  });
  renderBought();
}

/* ============================================================
   ЧТО РЕАЛЬНО КУПИЛИ
   Человек отмечает в магазине галочками, что взял. Если часть
   позиций осталась неотмеченной, можно пересобрать меню только из
   купленного — и увидеть, на сколько дней его хватит.
   ============================================================ */
function boughtItems() {
  const out = [];
  $$('#shopList .shop-item').forEach(el => {
    const cb = el.querySelector('input');
    if (!cb || !cb.checked) return;
    const item = state.plan.shop.items.find(i => i.p.id === el.dataset.pid);
    if (item) out.push(item);
  });
  return out;
}

function renderBought() {
  const box = $('#boughtBar');
  if (!box || !state.plan) return;
  const all = state.plan.shop.items;
  const got = boughtItems();
  const sum = got.reduce((s, i) => s + i.cost, 0);

  if (!got.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const left = all.length - got.length;
  box.innerHTML = `
    <div class="bought-info">
      <b>Отмечено ${got.length} из ${all.length}</b>
      <span>на ${money(sum)}${left ? ' · не отмечено ' + left + ' ' + plural(left, 'позиция', 'позиции', 'позиций') : ''}</span>
    </div>
    ${left ? `<div class="bought-actions">
      <button type="button" class="btn btn-primary btn-sm" id="btnRebuildBought">Пересобрать меню из купленного</button>
      <button type="button" class="btn btn-ghost btn-sm" id="btnKeepPlan">Оставить как есть</button>
    </div>` : `<div class="bought-actions"><span class="bought-done">✓ Куплено всё по списку</span></div>`}`;

  const rb = $('#btnRebuildBought');
  if (rb) rb.addEventListener('click', () => rebuildFromBought(got, sum));
  const kp = $('#btnKeepPlan');
  if (kp) kp.addEventListener('click', () => { $('#boughtResult').hidden = true; });
}

/* Собираем меню, пока хватает купленных продуктов */
function rebuildFromBought(got, sum) {
  const stock = {};
  got.forEach(i => { stock[i.p.id] = (stock[i.p.id] || 0) + i.buyKg * 1000; });

  const T = targets();
  const meals = activeMeals();
  const k = storeK(state.store);

  /* блюда, которые вообще можно приготовить из купленного */
  const pool = { breakfast: [], lunch: [], dinner: [], snack: [] };
  RECIPES.forEach(r => {
    const al = recipeAllergens(r);
    if (al.some(a => state.excluded.indexOf(a) !== -1)) return;
    if (state.veg && recipeHas(r, MEAT_IDS)) return;
    if (state.noPork && recipeHas(r, PORK_IDS)) return;
    if (!matchesCuisine(r) || !matchesStyle(r)) return;
    const ok = r.ing.every(([id]) =>
      stock[id] > 0 || (state.staplesOwned && PRODUCT_BY_ID[id].staple));
    if (ok) pool[r.m].push({ r, cost: recipeCost(r, k), m: recipeMacro(r) });
  });

  const menu = [];
  const lastUsed = {};
  let day = 0;
  const maxDays = state.days;

  const missedMeals = {};
  while (day < maxDays) {
    const picked = [];

    for (const m of meals) {
      const list = pool[m].filter(x => {
        const lu = lastUsed[x.r.id];
        return lu === undefined || day - lu > 2;
      });
      const cands = list.length ? list : pool[m];
      /* берём блюдо, на которое хватает остатка */
      const fits = cands.find(x => x.r.ing.every(([id, g]) => {
        const need = g * PORTION * peopleCount();
        return (stock[id] || 0) >= need || (state.staplesOwned && PRODUCT_BY_ID[id].staple);
      }));
      /* если на приём пищи продуктов нет, день всё равно засчитываем —
         человеку полезнее увидеть «обед и ужин закрыты», чем пустой экран */
      if (!fits) { missedMeals[m] = (missedMeals[m] || 0) + 1; continue; }
      picked.push({ type: m, item: fits });
    }

    if (!picked.length) break;

    picked.forEach(p => {
      p.item.r.ing.forEach(([id, g]) => {
        if (state.staplesOwned && PRODUCT_BY_ID[id].staple) return;
        stock[id] = Math.max(0, (stock[id] || 0) - g * PORTION * peopleCount());
      });
      lastUsed[p.item.r.id] = day;
    });

    menu.push({
      day,
      scale: peopleCount(),
      boost: [],
      meals: picked.map(p => ({ type: p.type, id: p.item.r.id })),
    });
    day++;
  }

  const leftovers = Object.keys(stock)
    .filter(id => stock[id] > 60)
    .map(id => ({ p: PRODUCT_BY_ID[id], g: stock[id] }))
    .sort((a, b) => b.g * b.p.price - a.g * a.p.price)
    .slice(0, 12);

  const box = $('#boughtResult');
  box.hidden = false;

  if (!menu.length) {
    box.innerHTML = `<div class="notice warn">
      <b>Из отмеченного не собирается ни одно блюдо целиком.</b> Обычно не хватает основы —
      крупы, макарон или овощей. Отметьте ещё несколько позиций или загляните
      в <a href="fridge.html">Холодильник</a>: там видно, где до готового блюда не хватает
      одного продукта.</div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  /* какие приёмы пищи закрыть не удалось */
  const missNames = Object.keys(missedMeals)
    .filter(m => missedMeals[m] >= menu.length)
    .map(m => MEALS.find(x => x.id === m).name.toLowerCase());

  const dishes = menu.map(d => d.meals.map(m => RECIPE_BY_ID[m.id].n));
  box.innerHTML = `
    <div class="bought-plan">
      <div class="bought-plan-head">
        <div>
          <h3>Купленного хватит на ${menu.length} ${plural(menu.length, 'день', 'дня', 'дней')}</h3>
          <p>Потрачено ${money(sum)} · ${peopleLabel()}${missNames.length
            ? ' · на ' + missNames.join(' и ') + ' продуктов не хватило'
            : ' · все ' + state.mealsCount + ' ' + plural(state.mealsCount, 'приём', 'приёма', 'приёмов') + ' пищи закрыты'}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="btnCloseBought">Закрыть</button>
      </div>
      <div class="bought-days">
        ${menu.map((d, i) => `<div class="bought-day">
          <b>День ${i + 1}</b>
          <ul>${d.meals.map((m, j) => `<li><span>${MEALS.find(x => x.id === m.type).icon}</span>
            <a data-recipe="${m.id}">${dishes[i][j]}</a></li>`).join('')}</ul>
        </div>`).join('')}
      </div>
      ${leftovers.length ? `<div class="bought-left">
        <b>Останется после этих дней:</b>
        ${leftovers.map(l => `<span>${l.p.n} ~${l.g >= 1000 ? kgLabel(l.g / 1000) : Math.round(l.g) + ' г'}</span>`).join('')}
      </div>` : ''}
      <p class="bought-note">Это меню только из того, что вы отметили: докупать ничего не нужно.
      Основной план выше не изменился — если он больше подходит, просто продолжайте по нему.</p>
    </div>`;

  $('#btnCloseBought').addEventListener('click', () => { box.hidden = true; });
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
          <span><b>${money(x.cost * p.avgScale)}</b> за подачу</span>
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

/* ---------- кому сколько положить ----------
   Блюдо готовится на всю семью, а нормы у всех разные. Делим готовое
   блюдо пропорционально суточной норме калорий каждого едока. */
function servingSplit(r, scale) {
  const T = targets();
  let grams = 0;
  const mac = { kc: 0, pr: 0, fa: 0, ca: 0, fi: 0 };
  r.ing.forEach(([id, g]) => {
    const p = PRODUCT_BY_ID[id], q = g * PORTION * scale;
    grams += q;
    mac.kc += q * p.kc / 100; mac.pr += q * p.pr / 100;
    mac.fa += q * p.fa / 100; mac.ca += q * p.ca / 100; mac.fi += q * p.fi / 100;
  });
  const rows = (T.per || []).map((x, i) => {
    const share = T.kcal > 0 ? x.t.kcal / T.kcal : 1 / Math.max(1, T.people);
    return {
      name: personName(x.person, i),
      icon: x.t.isChild ? (x.person.sex === 'f' ? '👧' : '👦') : sexOf(x.person).icon,
      isChild: x.t.isChild,
      share,
      grams: grams * share,
      kc: mac.kc * share,
      pr: mac.pr * share,
    };
  });
  return { rows, grams, mac };
}

function servingSplitHtml(r, scale) {
  const s = servingSplit(r, scale);
  if (!s.rows.length) return '';
  return `
    <div class="m-sec">Кому сколько положить</div>
    <div class="serving-split">
      ${s.rows.map(x => `<div class="ss-row${x.isChild ? ' is-child' : ''}">
        <span class="ss-who">${x.icon} ${x.name}</span>
        <b class="ss-g">${Math.round(x.grams)} г</b>
        <span class="ss-kc">${num(x.kc)} ккал</span>
        <span class="ss-pr">Б ${num(x.pr)} г</span>
      </div>`).join('')}
      <div class="ss-total">
        <span>Всего готового блюда</span>
        <b>${s.grams >= 1000 ? kgLabel(s.grams / 1000) : Math.round(s.grams) + ' г'}</b>
        <span>${num(s.mac.kc)} ккал</span>
        <span>Б ${num(s.mac.pr)} г</span>
      </div>
    </div>
    <p class="ss-note">Порции разделены по суточной норме каждого: кому нужно больше калорий,
    тому и тарелка больше. Вес — по сырым продуктам: крупы и макароны при варке прибавляют,
    мясо и овощи немного теряют.</p>`;
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
      <span>💸 ${money(recipeCost(r, k) * scale)} на ${peopleCount()} ${plural(peopleCount(), 'человека', 'человек', 'человек')}</span>
    </div>
    <div class="m-macro">
      <div><b>${num(mac.kc * scale)}</b><span>ккал всего</span></div>
      <div><b>${num(mac.pr * scale)} г</b><span>белки</span></div>
      <div><b>${num(mac.fa * scale)} г</b><span>жиры</span></div>
      <div><b>${num(mac.ca * scale)} г</b><span>углеводы</span></div>
      <div><b>${num(mac.fi * scale)} г</b><span>клетчатка</span></div>
    </div>
    ${servingSplitHtml(r, scale)}
    <div class="m-sec">Продукты на ${peopleCount()} ${plural(peopleCount(), 'человека', 'человек', 'человек')} — порции под ваши нормы КБЖУ</div>
    ${r.ing.map(([pid, g]) => {
      const p = PRODUCT_BY_ID[pid];
      const total = g * PORTION * scale;
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
    `${p.targets.goal.name} · ${DIET_STYLES.find(s => s.id === state.dietStyle).name.toLowerCase()} · ` +
    `${state.cuisines.length ? state.cuisines.map(c => CUISINES.find(x => x.id === c).name.toLowerCase()).join(', ') : 'все кухни'} · ` +
    `${state.days} ${plural(state.days, 'день', 'дня', 'дней')} · ${peopleLabel()} · ` +
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

  /* стиль питания */
  $('#styleList').innerHTML = DIET_STYLES.map(s => `
    <button type="button" class="style ${s.id === state.dietStyle ? 'active' : ''}" data-style="${s.id}">
      <span class="style-ic">${s.icon}</span>
      <span class="style-name">${s.name}</span>
      <span class="style-desc">${s.desc}</span>
      <span class="style-count" data-stylecount="${s.id}"></span>
    </button>`).join('');
  $$('#styleList .style').forEach(b => b.addEventListener('click', () => {
    state.dietStyle = b.dataset.style;
    $$('#styleList .style').forEach(x => x.classList.toggle('active', x === b));
    saveSettings();
  }));

  /* кухни */
  $('#cuisineList').innerHTML =
    `<button type="button" class="chip cuisine-any ${state.cuisines.length ? '' : 'active'}" data-cuisine="">🌍 Любая</button>` +
    CUISINES.map(c => `<button type="button" class="chip" data-cuisine="${c.id}">${c.icon} ${c.name}</button>`).join('');
  $$('#cuisineList .chip').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.cuisine;
    if (!id) { state.cuisines = []; }
    else {
      const i = state.cuisines.indexOf(id);
      if (i === -1) state.cuisines.push(id); else state.cuisines.splice(i, 1);
    }
    syncCuisineChips();
    saveSettings();
  }));

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
    updateMealsHint();
    saveSettings();
  }));

  $('#addAdult').addEventListener('click', () => {
    if (state.persons.length >= 10) return;
    state.persons.push({ type: 'adult', sex: 'f', weight: 60, height: 165, age: 30, activity: 'light' });
    renderPersons(); saveSettings();
  });
  $('#addChild').addEventListener('click', () => {
    if (state.persons.length >= 10) return;
    state.persons.push({ type: 'child', sex: 'm', weight: 25, age: 7 });
    renderPersons(); saveSettings();
  });

  $('#optVeg').addEventListener('change', e => { state.veg = e.target.checked; saveSettings(); });
  $('#optNoPork').addEventListener('change', e => { state.noPork = e.target.checked; saveSettings(); });
  $('#optStaples').addEventListener('change', e => { state.staplesOwned = e.target.checked; saveSettings(); });

  $('#planForm').addEventListener('submit', e => { e.preventDefault(); run(); });
}

/* ---------- список едоков ---------- */
function personSubtitle(p) {
  const t = personTargets(p);
  return p.type === 'child'
    ? `${num(t.kcal)} ккал · ${num(t.protein)} г белка · ${t.ageLabel}`
    : `${num(t.kcal)} ккал · ${num(t.protein)} г белка · обмен ${num(t.bmr)}, расход ${num(t.tdee)}`;
}

function renderPersons() {
  const html = state.persons.map((p, i) => {
    const isChild = p.type === 'child';
    const sx = sexOf(p);
    return `<div class="person${isChild ? ' person-child' : ''}" data-i="${i}">
      <div class="person-top">
        <span class="person-ic">${isChild ? (p.sex === 'f' ? '👧' : '👦') : sx.icon}</span>
        <div class="person-title">
          <b>${isChild ? sx.childName : sx.name}</b>
          <span>${personSubtitle(p)}</span>
        </div>
        ${state.persons.length > 1
          ? `<button type="button" class="person-del" data-del="${i}" title="Убрать" aria-label="Убрать">×</button>`
          : ''}
      </div>

      <div class="sex-switch" role="group" aria-label="Пол">
        ${SEXES.map(s => `<button type="button" class="${p.sex === s.id ? 'active' : ''}"
          data-sex="${s.id}" data-i="${i}">${s.icon} ${isChild ? s.childName : s.name}</button>`).join('')}
      </div>

      <div class="person-fields">
        <label>
          <span>Вес</span>
          <div class="input-unit">
            <input type="number" min="${isChild ? 8 : 35}" max="${isChild ? 120 : 250}" step="1"
                   value="${p.weight}" data-field="weight" data-i="${i}" inputmode="numeric"><span>кг</span>
          </div>
        </label>
        <label>
          <span>Возраст</span>
          <div class="input-unit">
            <input type="number" min="${isChild ? 1 : 14}" max="${isChild ? 17 : 100}" step="1" value="${p.age}"
                   data-field="age" data-i="${i}" inputmode="numeric"><span>лет</span>
          </div>
        </label>
        ${isChild ? '' : `<label>
          <span>Рост</span>
          <div class="input-unit">
            <input type="number" min="120" max="230" step="1" value="${p.height || sx.height}"
                   data-field="height" data-i="${i}" inputmode="numeric"><span>см</span>
          </div>
        </label>`}
      </div>

      ${isChild ? '' : `<label class="person-activity">
        <span>Активность</span>
        <select data-field="activity" data-i="${i}">
          ${ACTIVITY.map(a => `<option value="${a.id}"${(p.activity || 'light') === a.id ? ' selected' : ''}>${a.name} — ${a.desc}</option>`).join('')}
        </select>
      </label>`}
    </div>`;
  }).join('');

  $('#personList').innerHTML = html;

  $$('#personList [data-sex]').forEach(b => b.addEventListener('click', () => {
    const p = state.persons[+b.dataset.i];
    if (!p) return;
    p.sex = b.dataset.sex;
    if (p.type === 'adult') p.height = SEXES.find(s => s.id === p.sex).height;
    renderPersons(); saveSettings();
  }));

  $$('#personList select[data-field]').forEach(sel => sel.addEventListener('change', () => {
    const p = state.persons[+sel.dataset.i];
    if (!p) return;
    p.activity = sel.value;
    sel.closest('.person').querySelector('.person-title span').textContent = personSubtitle(p);
    saveSettings();
  }));

  $$('#personList [data-del]').forEach(b => b.addEventListener('click', () => {
    state.persons.splice(+b.dataset.del, 1);
    renderPersons(); saveSettings();
  }));

  $$('#personList input[data-field]').forEach(inp => inp.addEventListener('input', () => {
    const i = +inp.dataset.i, f = inp.dataset.field;
    const p = state.persons[i];
    if (!p) return;
    const v = parseInt(inp.value, 10);
    if (isNaN(v)) return;
    if (f === 'weight') p.weight = clamp(v, p.type === 'child' ? 8 : 35, p.type === 'child' ? 120 : 250);
    if (f === 'age') p.age = clamp(v, p.type === 'child' ? 1 : 14, p.type === 'child' ? 17 : 100);
    if (f === 'height') p.height = clamp(v, 120, 230);
    /* подпись с нормой обновляем без перерисовки поля, чтобы не сбить курсор */
    inp.closest('.person').querySelector('.person-title span').textContent = personSubtitle(p);
    saveSettings();
  }));

  $('#kidsNote').hidden = !childCount();
  $('#peopleSummary').textContent = peopleLabel();
  updateMealsHint();
}

/* Подсказка под выбором числа приёмов пищи */
function updateMealsHint() {
  const el = $('#mealsHint');
  if (!el) return;
  const kids = childCount();
  if (state.mealsCount === 1) {
    el.innerHTML = 'Вся суточная норма в один приём — это режим OMAD. Порция получится очень большой, ' +
      'и такой график подходит не всем: при гастрите, диабете и во время беременности так питаться нельзя.' +
      (kids ? ' <b>Детям один приём в день не подходит категорически</b> — им нужно 4–5 раз.' : '');
  } else if (state.mealsCount === 2) {
    el.innerHTML = 'Обед и ужин без завтрака — вариант интервального питания. Порции будут крупными, ' +
      'следите за самочувствием.' +
      (kids ? ' <b>Детям двух приёмов мало</b> — им нужно 4–5 раз в день.' : '');
  } else if (state.mealsCount === 3) {
    el.textContent = 'Классический режим: завтрак, обед и ужин.';
  } else {
    el.textContent = 'Три основных приёма и перекус — так проще набрать норму и не переедать за раз.';
  }
  el.classList.toggle('hint-warn', state.mealsCount < 3);
}

function syncCuisineChips() {
  $$('#cuisineList .chip').forEach(b => {
    const id = b.dataset.cuisine;
    b.classList.toggle('active', id ? state.cuisines.indexOf(id) !== -1 : !state.cuisines.length);
  });
}

/* сколько блюд остаётся в каждом стиле питания при текущих ограничениях */
function updateStyleCounts() {
  const save = state.dietStyle;
  DIET_STYLES.forEach(s => {
    state.dietStyle = s.id;
    const pool = buildPool();
    const n = activeMeals().reduce((a, m) => a + pool[m].length, 0);
    const el = $(`[data-stylecount="${s.id}"]`);
    if (el) el.textContent = 'подходит ' + n + ' ' + plural(n, 'блюдо', 'блюда', 'блюд');
  });
  state.dietStyle = save;
}

/* подписи с нормой под каждой целью */
function updateGoalNumbers() {
  const save = state.goal;
  const adult = state.persons.find(p => p.type === 'adult') ||
    { type: 'adult', sex: 'm', weight: 78, height: 176, age: 30, activity: 'light' };
  GOALS.forEach(g => {
    state.goal = g.id;
    const t = personTargets(adult);
    const el = $(`[data-goalnum="${g.id}"]`);
    if (el) el.textContent = `${num(t.kcal)} ккал · ${num(t.protein)} г белка · ${num(t.fiber)} г клетчатки` +
      ` · ${sexOf(adult).name.toLowerCase()}, ${adult.weight} кг, ${adult.age} лет`;
  });
  state.goal = save;
}

function applySettingsToForm() {
  $('#budget').value = state.budget;
  $$('#budgetChips .chip').forEach(c => c.classList.toggle('active', +c.dataset.budget === state.budget));
  $$('#periodChips .chip').forEach(c => c.classList.toggle('active', +c.dataset.days === state.days));
  $$('#mealsChips .chip').forEach(c => c.classList.toggle('active', +c.dataset.meals === state.mealsCount));
  renderPersons();
  $$('#goalList .goal').forEach(b => b.classList.toggle('active', b.dataset.goal === state.goal));
  $$('#styleList .style').forEach(b => b.classList.toggle('active', b.dataset.style === state.dietStyle));
  syncCuisineChips();
  $$('#storeList .store').forEach(b => b.classList.toggle('active', b.dataset.store === state.store));
  $$('#allergenList .chip').forEach(b => b.classList.toggle('active', state.excluded.indexOf(b.dataset.allergen) !== -1));
  $('#optVeg').checked = state.veg;
  $('#optNoPork').checked = state.noPork;
  $('#optStaples').checked = state.staplesOwned;
  updateGoalNumbers();
  updateStyleCounts();
  updateMealsHint();
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
  out += `${p.targets.goal.name} · ${state.days} дн. · ${peopleLabel()} · бюджет ${money(state.budget)}\n`;
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
      `для ${peopleLabel()}, ` +
      `нужно минимум около <b>${money(shop.total)}</b>.`;
  } catch (e) {
    el.innerHTML = 'Это вся сумма на выбранный период, а не в день.';
  }
}

/* Если план уже показан, а настройки изменились — пересобираем его сразу,
   без экрана загрузки. Иначе на экране оставался бы результат от прежних
   настроек: выбрал «любые блюда», а меню всё ещё постное. */
let resyncTimer = null;
function resyncPlan() {
  if (!state.plan) return;
  /* если галочки уже расставлены, человек стоит в магазине — не трогаем список */
  if ($$('#shopList .shop-item input:checked').length) {
    const el = $('#notice');
    if (el && !el.dataset.locked) {
      el.dataset.locked = '1';
      el.className = 'notice warn';
      el.innerHTML = '<b>Настройки изменились, но список покупок не тронут</b> — в нём уже ' +
        'отмечены купленные позиции. Нажмите «Пересобрать», когда закончите с покупками.';
      el.hidden = false;
    }
    return;
  }
  if ($('#notice')) delete $('#notice').dataset.locked;
  clearTimeout(resyncTimer);
  resyncTimer = setTimeout(() => {
    const res = generatePlan(Date.now() % 100000);
    const el = $('#notice');
    if (res.error) {
      state.plan = null;
      $('#stats').innerHTML = '';
      $('#macros').innerHTML = '';
      $('#panel-menu').innerHTML = '';
      $('#shopList').innerHTML = '';
      $('#shopTotal').innerHTML = '';
      $('#panel-recipes').innerHTML = '';
      $('#resultSub').textContent = '';
      el.className = 'notice warn';
      el.innerHTML = '<b>Не получилось собрать меню.</b> ' + res.error;
      el.hidden = false;
      return;
    }
    state.plan = res;
    renderAll();
    savePlan();
    const card = $('#result');
    card.classList.remove('updated');
    void card.offsetWidth;   /* перезапуск анимации */
    card.classList.add('updated');
  }, 350);
}

function saveSettings() {
  updateStyleCounts();
  updateBudgetHint();
  resyncPlan();
  try {
    localStorage.setItem(LS_SET, JSON.stringify({
      goal: state.goal, dietStyle: state.dietStyle, cuisines: state.cuisines,
      persons: state.persons, budget: state.budget, days: state.days,
      mealsCount: state.mealsCount, store: state.store,
      excluded: state.excluded, veg: state.veg, noPork: state.noPork,
      staplesOwned: state.staplesOwned,
    }));
  } catch (e) { /* приватный режим */ }
}
function migratePersons(obj) {
  /* старый формат: people — число, weight — общий вес */
  if (obj && !Array.isArray(obj.persons) && typeof obj.people === 'number') {
    const w = typeof obj.weight === 'number' ? obj.weight : 70;
    obj.persons = [];
    for (let i = 0; i < Math.max(1, obj.people); i++) {
      obj.persons.push({ type: 'adult', sex: i % 2 ? 'f' : 'm', weight: w, height: i % 2 ? 165 : 176, age: 30, activity: 'light' });
    }
  }
  if (obj && Array.isArray(obj.persons)) {
    obj.persons = obj.persons
      .filter(p => p && (p.type === 'adult' || p.type === 'child'))
      .map(p => p.type === 'child'
        ? { type: 'child', sex: p.sex || 'm', weight: p.weight || 25, age: p.age || 7 }
        : {
            type: 'adult', sex: p.sex || 'm', weight: p.weight || 70,
            height: p.height || (p.sex === 'f' ? 165 : 176),
            age: p.age || 30, activity: p.activity || 'light',
          });
    if (!obj.persons.length) obj.persons = [{ type: 'adult', sex: 'm', weight: 78, height: 176, age: 30, activity: 'light' }];
  }
  delete obj.people; delete obj.weight;
  return obj;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SET);
    if (raw) Object.assign(state, migratePersons(JSON.parse(raw)));
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
    Object.assign(state, migratePersons(p.settings || {}));
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

  $('#statProducts').textContent = PRODUCTS.length;
  $('#statRecipes').textContent = RECIPES.length;
  $('#statAllerg').textContent = ALLERGENS.length;
  if ($('#statCuisines')) $('#statCuisines').textContent = CUISINES.length;
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
