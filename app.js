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
  /* ленивое питание: обед и ужин готовятся сразу на два дня */
  lazy: false,
  /* какая техника есть на кухне; по умолчанию — вся */
  tech: TECH.map(t => t.id),
  /* витамины и добавки: on — принимает ли вообще, items — id → порций в день,
     takers — сколько взрослых принимает (null = все взрослые) */
  supp: { on: false, items: {}, takers: null },
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

/* ---------- кухонная техника ----------
   Какая техника нужна рецепту, определяет recipeTech() из cooking.js. */
/* Хватает ли техники пользователя на это блюдо */
function techOk(r, have) {
  const list = have || state.tech;
  return recipeTech(r).every(g => g.some(t => list.indexOf(t) !== -1));
}

/* Какую технику показать в карточке: по одному прибору из каждой группы —
   тот, что есть у пользователя, а если нет — первый подходящий */
function techLabel(r) { return techLabelFor(r, state.tech); }

/* ---------- витамины и добавки ----------
   Возвращает дневную сумму КБЖУ добавок на всю семью. Добавки принимают
   только взрослые: детям без врача их не назначаем. */
function adultCount() { return state.persons.filter(p => p.type === 'adult').length; }
function suppTakers() {
  const a = adultCount();
  if (!a) return 0;
  const t = state.supp && state.supp.takers;
  return clamp(typeof t === 'number' && t > 0 ? t : a, 1, a);
}
function suppList() {
  if (!state.supp || !state.supp.on) return [];
  const items = state.supp.items || {};
  return SUPPLEMENTS
    .filter(s => items[s.id] > 0)
    .map(s => ({ s, serv: clamp(Math.round(items[s.id]), 1, s.maxServ) }));
}
function suppDaily() {
  const sum = { kc: 0, pr: 0, fa: 0, ca: 0, fi: 0 };
  const n = suppTakers();
  suppList().forEach(({ s, serv }) => {
    const q = serv * n;
    sum.kc += s.kc * q; sum.pr += s.pr * q; sum.fa += s.fa * q;
    sum.ca += s.ca * q; sum.fi += s.fi * q;
  });
  return sum;
}

/* Норма, которую должна закрыть ЕДА: общая норма минус то, что дают добавки.
   Калории не опускаем ниже половины нормы — добавки не заменяют еду. */
function foodTargets(T) {
  const s = suppDaily();
  if (!s.kc && !s.pr && !s.fi && !s.fa) return T;
  return Object.assign({}, T, {
    kcal: Math.max(T.kcal * 0.5, T.kcal - s.kc),
    protein: Math.max(T.protein * 0.25, T.protein - s.pr),
    fat: Math.max(T.fat * 0.5, T.fat - s.fa),
    carb: Math.max(T.carb * 0.3, T.carb - s.ca),
    fiber: Math.max(T.fiber * 0.3, T.fiber - s.fi),
  });
}

/* Масштаб порций дня: сколько базовых порций каждого блюда приготовить на всю
   семью, чтобы попасть в норму калорий и оставить запас под добор белка.
   Одна формула и для сборки меню, и для ручной замены блюда. */
function dayScaleFor(t, Tf) {
  const N = Math.max(1, Tf.people);
  const exp = expectedPortion();
  const lo = 0.55 * exp * N, hi = 2.2 * exp * N;
  let scale = clamp(Tf.kcal / t.kc, lo, hi);
  const prDeficit = Tf.protein - t.pr * scale;
  if (prDeficit > 0) {
    const reserve = Math.min(Tf.kcal * 0.42, prDeficit * kcalPerGramProtein());
    scale = clamp((Tf.kcal - reserve) / t.kc, lo, hi);
  }
  return scale;
}

/* Приёмы пищи, которые в ленивом режиме готовятся на два дня */
function lazyMeals() {
  return state.lazy ? activeMeals().filter(m => m === 'lunch' || m === 'dinner') : [];
}

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
    if (!techOk(r)) return;
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
  const list = BOOST_PROTEIN.map(x => PRODUCT_BY_ID[x.id]).filter(p => productAllowed(p) && p.pr > 5);
  if (!list.length) return 6;
  /* не меньше 6: добор идёт по кругу из разных продуктов, а не только из самого
     «чистого», поэтому реальная цена грамма белка выше минимальной */
  return clamp(Math.min.apply(null, list.map(p => p.kc / p.pr)), 6, 16);
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
  const lazy = lazyMeals();
  const menu = [];
  const lastUsed = {};
  const attempts = state.days > 30 ? 12 : 20;
  /* еда закрывает норму за вычетом того, что дают витамины и добавки */
  const Tf = foodTargets(T);

  /* опорная цена дня для этого уровня — чтобы подбор белка не разносил бюджет */
  let refCost = 0;
  meals.forEach(m => {
    const list = pool[m];
    if (list.length) refCost += list[Math.round(lvl * (list.length - 1))].cost;
  });

  const need = (fact, target) => target > 0 ? Math.max(0, (target - fact) / target) : 0;
  const over = (fact, target) => target > 0 ? Math.max(0, (fact - target) / target) : 0;

  /* Если пользователь не выбрал постное и не вегетарианец, в дне должно быть
     мясо или рыба — иначе меню выглядит постным даже в режиме «правильное
     питание»: растительные блюда дешевле, и подбор под бюджет тянет к ним. */
  const meaty = x => x.item.r.ing.some(([id]) => MEAT_IDS.indexOf(id) !== -1);
  const wantMeat = state.dietStyle !== 'lean' && !state.veg &&
    ['lunch', 'dinner'].some(m => pool[m] && pool[m].some(x => x.r.ing.some(([id]) => MEAT_IDS.indexOf(id) !== -1)));

  for (let d = 0; d < state.days; d++) {
    let best = null;
    /* Ленивое питание: на второй день пары обед и ужин — те же, что вчера,
       это остатки, готовить заново не нужно */
    const prev = menu[d - 1];
    const forced = {};
    if (lazy.length && d % 2 === 1 && prev) {
      lazy.forEach(m => {
        const pm = prev.meals.find(x => x.type === m);
        if (!pm) return;
        const it = pool[m].find(x => x.r.id === pm.id);
        if (it) forced[m] = it;
      });
    }

    for (let a = 0; a < attempts; a++) {
      const picked = [];
      meals.forEach(m => {
        if (forced[m]) { picked.push({ type: m, item: forced[m] }); return; }
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
      const scale = dayScaleFor(t, Tf);
      const pr = t.pr * scale, fi = t.fi * scale, fa = t.fa * scale, cost = t.cost * scale;

      let meatPenalty = 0;
      if (wantMeat) {
        const n = picked.filter(meaty).length;
        if (n === 0) meatPenalty = 85;        /* день без мяса и рыбы — так нельзя */
        else if (n === 1) meatPenalty = 12;   /* приемлемо, но лучше два раза */
      }

      const score =
        need(pr, Tf.protein) * 140 + over(pr, Tf.protein * 1.4) * 25 +
        need(fi, Tf.fiber) * 90 + over(fi, Tf.fiber * 1.7) * 10 +
        over(fa, Tf.fat * 1.6) * 30 +
        Math.abs(scale / Math.max(1, T.people) / expectedPortion() - 1) * 25 + meatPenalty +
        (refCost > 0 ? over(cost, refCost) * 35 : 0);

      if (!best || score < best.score) best = { picked, scale, score, t };
      /* когда все приёмы заданы заранее, перебирать нечего */
      if (Object.keys(forced).length === meals.length) break;
    }

    if (!best) {
      /* все блюда дня с нулевой калорийностью — так не бывает, но не падаем */
      const picked = meals.filter(m => pool[m].length).map(m => ({ type: m, item: forced[m] || pool[m][0] }));
      best = { picked, scale: Math.max(1, T.people), t: dayTotals(picked, pool) };
    }

    best.picked.forEach(p => { lastUsed[p.item.r.id] = d; });
    const sc = Math.round(best.scale * 100) / 100;
    const dm = {
      kc: best.t.kc * sc, pr: best.t.pr * sc, fa: best.t.fa * sc,
      ca: best.t.ca * sc, fi: best.t.fi * sc,
    };
    const dayMeals = best.picked.map(p => ({ type: p.type, id: p.item.r.id }));
    /* отмечаем пару «готовим на два дня → едим остатки» */
    dayMeals.forEach(mm => {
      if (!forced[mm.type]) return;
      mm.lazy = 'left';
      const pm = prev.meals.find(x => x.type === mm.type);
      if (pm) pm.lazy = 'cook2';
    });
    menu.push({
      day: d,
      scale: sc,
      boost: buildBoost(dm, Tf),
      meals: dayMeals,
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
  /* витамины и добавки входят в КБЖУ дня, но не в стоимость продуктов:
     их покупают отдельно и заранее */
  const sp = suppDaily();
  s.kc += sp.kc; s.pr += sp.pr; s.fa += sp.fa; s.ca += sp.ca; s.fi += sp.fi;
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
        '. Снимите часть исключений' +
        (state.tech.length < TECH.length ? ' или отметьте больше кухонной техники' : '') + '.'
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
      staplesOwned: state.staplesOwned, lazy: state.lazy, tech: state.tech.slice(),
      supp: JSON.parse(JSON.stringify(state.supp)),
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
  const sc = p.menu.map(d => d.scale).filter(x => isFinite(x) && x > 0);
  if (sc.length) p.avgScale = sc.reduce((a, b) => a + b, 0) / sc.length;
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
    <div class="macro-verdict">${verdict}</div>
    ${suppMacroNote()}`;
}

/* Сколько КБЖУ дают добавки — чтобы было видно, почему еды стало меньше */
function suppMacroNote() {
  const list = suppList();
  if (!list.length) return '';
  const sp = suppDaily();
  const names = list.map(({ s, serv }) => s.name + (serv > 1 ? ' ×' + serv : '')).join(', ');
  if (sp.kc < 1 && sp.pr < 0.5 && sp.fi < 0.5) {
    return `<div class="macro-supp">💊 Учтены добавки: ${names}. Калорий и белка в них нет,
      поэтому на подбор еды они не влияют. Стоимость добавок в бюджет продуктов не входит.</div>`;
  }
  return `<div class="macro-supp">💊 <b>Учтены добавки</b> (${names}, принимают ${suppTakers()} чел.):
    они дают семье <b>${[
      num(sp.kc) + ' ккал',
      sp.pr >= 1 ? num(sp.pr) + ' г белка' : '',
      sp.fa >= 1 ? num(sp.fa) + ' г жиров' : '',
      sp.ca >= 1 ? num(sp.ca) + ' г углеводов' : '',
      sp.fi >= 1 ? num(sp.fi) + ' г клетчатки' : '',
    ].filter(Boolean).join(', ')}</b> в день. Эти цифры уже входят в итог выше,
    а еды подобрано ровно на столько меньше. Стоимость добавок в бюджет продуктов не входит.</div>`;
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
          const lazyTag = m.lazy === 'cook2'
            ? '<div class="meal-lazy cook">🍳 Готовьте сразу на 2 дня</div>'
            : (m.lazy === 'left' ? '<div class="meal-lazy left">🔁 Остатки со вчера — готовить не нужно</div>' : '');
          return `<div class="meal${m.lazy === 'left' ? ' is-left' : ''}">
            <div class="meal-ic" style="background:${dishGradient(r)}">${dishEmoji(r)}</div>
            <div class="meal-body">
              <div class="meal-type">${info.name}</div>
              <div class="meal-name" data-recipe="${r.id}" data-day="${day.day}">${r.n}</div>
              <div class="meal-meta">${num(mac.kc * day.scale)} ккал · Б ${num(mac.pr * day.scale)} г · ${m.lazy === 'left' ? 'уже куплено вчера' : money(recipeCost(r, storeK(state.store)) * day.scale)}</div>
              ${lazyTag}
            </div>
            <button class="meal-swap" title="${m.lazy ? 'Заменить блюдо на оба дня' : 'Заменить блюдо'}" data-swap="${day.day}:${m.type}">⇄</button>
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
        ${suppDayHtml()}
      </div>`;
    }).join('');
    return `<div class="week">
      <div class="week-head"><h3>Неделя ${wi + 1}</h3><span>${w.length} дн. · продуктов примерно на ${money(wCost)}</span></div>
      <div class="days">${days}</div>
    </div>`;
  }).join('');
}

/* Строка с добавками в карточке дня */
function suppDayHtml() {
  const list = suppList();
  if (!list.length) return '';
  const n = suppTakers();
  return `<div class="day-supp">
    <b>💊 Витамины и добавки${n > 1 ? ' · ' + n + ' чел.' : ''}</b>
    ${list.map(({ s, serv }) => `<span>${s.icon} ${s.name}${serv > 1 ? ' ×' + serv : ''}</span>`).join('')}
  </div>`;
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

/* «Оставить как есть» сворачивает плашку в компактную строку, чтобы она
   не закрывала список, пока человек ходит по магазину */
let boughtCollapsed = false;

function renderBought() {
  const box = $('#boughtBar');
  if (!box || !state.plan) return;
  const all = state.plan.shop.items;
  const got = boughtItems();
  const sum = got.reduce((s, i) => s + i.cost, 0);

  if (!got.length) {
    box.hidden = true;
    boughtCollapsed = false;
    return;
  }
  box.hidden = false;
  const left = all.length - got.length;
  box.classList.toggle('collapsed', boughtCollapsed && left > 0);

  if (boughtCollapsed && left > 0) {
    box.innerHTML = `
      <div class="bought-info">
        <b>✓ ${got.length} из ${all.length} · ${money(sum)}</b>
      </div>
      <div class="bought-actions">
        <button type="button" class="bought-expand" id="btnBoughtExpand">Пересобрать…</button>
      </div>`;
    $('#btnBoughtExpand').addEventListener('click', () => { boughtCollapsed = false; renderBought(); });
    return;
  }

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
  if (kp) kp.addEventListener('click', () => {
    $('#boughtResult').hidden = true;
    boughtCollapsed = true;
    renderBought();
  });
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
    if (!matchesCuisine(r) || !matchesStyle(r) || !techOk(r)) return;
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
        <div class="rec-tech">${techLabel(x.r)}</div>
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

function openRecipe(id, dayIdx) {
  const r = RECIPE_BY_ID[id];
  if (!r) return;
  const k = storeK(state.store);
  /* Открыли из карточки дня — показываем порции именно этого дня.
     В ленивом режиме блюдо «на 2 дня» готовится на оба дня сразу. */
  let scale = state.plan ? state.plan.avgScale : 1;
  let lazyNote = '';
  const menu = state.plan ? state.plan.menu : null;
  const day = menu && typeof dayIdx === 'number' ? menu[dayIdx] : null;
  const mm = day ? day.meals.find(m => m.id === id) : null;
  if (mm) {
    scale = day.scale;
    if (mm.lazy === 'cook2' && menu[dayIdx + 1]) {
      scale = day.scale + menu[dayIdx + 1].scale;
      lazyNote = `<div class="m-lazy">🍳 <b>Ленивое питание:</b> готовьте сразу на 2 дня — количества ниже уже
        на оба дня. Половину уберите в холодильник в закрытом контейнере (до 48 часов) и завтра просто разогрейте.</div>`;
    } else if (mm.lazy === 'left') {
      lazyNote = `<div class="m-lazy left">🔁 <b>Сегодня готовить не нужно:</b> это вторая половина вчерашнего блюда.
        Разогрейте порцию на плите или в микроволновке до горячего состояния.</div>`;
    }
  }
  const info = MEALS.find(m => m.id === r.m);
  const al = recipeAllergens(r);
  const mac = recipeMacro(r);
  const tech = techUsedFor(r, state.tech);
  const ppl = `${peopleCount()} ${plural(peopleCount(), 'человека', 'человек', 'человек')}`;
  $('#modalContent').innerHTML = `
    <div class="m-photo" style="background:${dishGradient(r)}">${r.img
      ? `<img src="${r.img}" alt="${r.n}">`
      : `<span>${dishEmoji(r)}</span><i>${info.name}</i>`}</div>
    <h3>${r.n}</h3>
    <div class="m-meta">
      <span>${info.icon} ${info.name}</span>
      <span>⏱ ${r.t} мин</span>
      <span>💸 ${money(recipeCost(r, k) * scale)} на ${ppl}${mm && mm.lazy === 'cook2' ? ' на 2 дня' : ''}</span>
    </div>
    ${lazyNote}
    <div class="m-sec">Что понадобится из техники</div>
    <div class="m-tech">${tech.length
      ? tech.map(t => `<span class="m-tech-item">${t.icon} ${t.name}</span>`).join('')
      : '<span class="m-tech-item">🥄 Готовить не нужно — только нож и миска</span>'}</div>
    ${techTipsHtml(r, state.tech)}
    <div class="m-macro">
      <div><b>${num(mac.kc * scale)}</b><span>ккал всего</span></div>
      <div><b>${num(mac.pr * scale)} г</b><span>белки</span></div>
      <div><b>${num(mac.fa * scale)} г</b><span>жиры</span></div>
      <div><b>${num(mac.ca * scale)} г</b><span>углеводы</span></div>
      <div><b>${num(mac.fi * scale)} г</b><span>клетчатка</span></div>
    </div>
    ${servingSplitHtml(r, mm && mm.lazy === 'cook2' ? day.scale : scale)}
    <div class="m-sec">Продукты на ${ppl}${mm && mm.lazy === 'cook2' ? ' сразу на 2 дня' : ''} — порции под ваши нормы КБЖУ</div>
    ${r.ing.map(([pid, g]) => {
      const p = PRODUCT_BY_ID[pid];
      const total = g * PORTION * scale;
      return `<div class="m-ing"><span>${p.n}</span><span>${total >= 1000 ? kgLabel(total / 1000) : Math.round(total) + ' г'}</span></div>`;
    }).join('')}
    <div class="m-sec">Приготовление</div>
    ${stepsHtml(r)}
    ${al.length ? `<div class="m-sec">Содержит</div><div class="cr-tags">${al.map(a => {
      const A = ALLERGENS.find(x => x.id === a);
      return `<span class="cr-tag">${A.icon} ${A.name}</span>`;
    }).join('')}</div>` : ''}`;
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; }

/* ---------- замена блюда ----------
   Новое блюдо не должно повторять то, что уже есть в плане, и то, что
   уже показывалось в этой ячейке при прошлых заменах. Если уникальные
   блюда закончились (длинный план, мало рецептов), берём те, что не
   стоят в соседние дни. В ленивом режиме меняется сразу пара
   «готовим на два дня → едим остатки». */
function recalcDay(day) {
  const T = state.plan.targets;
  const Tf = foodTargets(T);
  const raw = { kc: 0, pr: 0, fa: 0, ca: 0, fi: 0 };
  day.meals.forEach(m => {
    const mac = recipeMacro(RECIPE_BY_ID[m.id]);
    raw.kc += mac.kc; raw.pr += mac.pr; raw.fa += mac.fa; raw.ca += mac.ca; raw.fi += mac.fi;
  });
  if (raw.kc > 0) day.scale = Math.round(dayScaleFor(raw, Tf) * 100) / 100;
  day.boost = buildBoost({
    kc: raw.kc * day.scale, pr: raw.pr * day.scale, fa: raw.fa * day.scale,
    ca: raw.ca * day.scale, fi: raw.fi * day.scale,
  }, Tf);
}

function swapCandidates(dayIdx, type) {
  const pool = buildPool();
  const list = pool[type];
  const menu = state.plan.menu;
  const day = menu[dayIdx];
  const cur = day.meals.find(m => m.type === type);
  if (!cur || list.length < 2) return null;

  const used = {};
  menu.forEach(d => d.meals.forEach(m => { used[m.id] = 1; }));
  const near = {};
  for (let i = dayIdx - 3; i <= dayIdx + 3; i++) {
    const d = menu[i];
    if (d) d.meals.forEach(m => { near[m.id] = 1; });
  }
  let tried = (cur.tried || []).slice();
  if (tried.indexOf(cur.id) === -1) tried.push(cur.id);

  let fresh = list.filter(x => !used[x.r.id] && tried.indexOf(x.r.id) === -1);
  let level = 'new';
  if (!fresh.length) {
    level = 'nearfree';
    fresh = list.filter(x => tried.indexOf(x.r.id) === -1 && !near[x.r.id]);
  }
  if (!fresh.length) {
    /* перебрали всё — начинаем круг заново, но без соседних дней */
    level = 'cycle';
    tried = [cur.id];
    fresh = list.filter(x => x.r.id !== cur.id && !near[x.r.id]);
    if (!fresh.length) fresh = list.filter(x => x.r.id !== cur.id);
  }
  return { list, cur, fresh, tried, level };
}

function swapMeal(dayIdx, type) {
  const c = swapCandidates(dayIdx, type);
  if (!c) {
    const msg = 'Заменить не на что: при выбранных ограничениях для этого приёма пищи подходит одно блюдо.';
    if (typeof window.appToast === 'function') window.appToast(msg);
    else { const el = $('#notice'); if (el) { el.className = 'notice warn'; el.innerHTML = '<b>' + msg + '</b> Снимите часть исключений или отметьте больше техники.'; el.hidden = false; } }
    return;
  }
  const menu = state.plan.menu;
  const day = menu[dayIdx];
  const { cur, list, fresh, tried } = c;
  const curItem = list.find(x => x.r.id === cur.id) || list[Math.floor(list.length / 2)];

  /* похожая цена и белок не хуже — чтобы не разнести бюджет и норму */
  const inPrice = fresh.filter(x => x.cost <= curItem.cost * 1.35 && x.cost >= curItem.cost * 0.6);
  const better = inPrice.filter(x => x.m.pr >= curItem.m.pr * 0.9);
  let pickFrom = better.length ? better : inPrice;
  if (!pickFrom.length) {
    pickFrom = fresh.slice()
      .sort((a, b) => Math.abs(a.cost - curItem.cost) - Math.abs(b.cost - curItem.cost))
      .slice(0, 8);
  }
  const pick = pickFrom[Math.floor(Math.random() * pickFrom.length)];

  /* пара в ленивом режиме */
  let partnerDay = null;
  if (cur.lazy === 'cook2') partnerDay = menu[dayIdx + 1];
  if (cur.lazy === 'left') partnerDay = menu[dayIdx - 1];
  const partner = partnerDay ? partnerDay.meals.find(m => m.type === type && m.id === cur.id) : null;

  const newTried = tried.slice(-60);
  cur.id = pick.r.id;
  cur.tried = newTried;
  if (partner) { partner.id = pick.r.id; partner.tried = newTried; }

  recalcDay(day);
  if (partner) recalcDay(partnerDay);

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
    (state.excluded.length ? ` · без: ${state.excluded.map(a => ALLERGENS.find(x => x.id === a).name.toLowerCase()).join(', ')}` : '') +
    (state.lazy ? ' · ленивое питание' : '') +
    (state.tech.length < TECH.length ? ` · техника: ${state.tech.length ? state.tech.map(t => TECH.find(x => x.id === t).name.toLowerCase()).join(', ') : 'без готовки'}` : '') +
    (suppList().length ? ` · добавки: ${suppList().length}` : '');
  /* Каждый блок рисуем отдельно: если один споткнётся на старых данных,
     остальные всё равно отрисуются — раньше падение в меню оставляло
     покупки и рецепты пустыми. */
  [renderNotice, renderStats, renderMacros, renderMenu, renderShopping, renderRecipesTab]
    .forEach(fn => {
      try { fn(); } catch (err) {
        console.error('Не удалось отрисовать блок:', fn.name, err);
      }
    });
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

  initExtraOptions();

  $('#planForm').addEventListener('submit', e => { e.preventDefault(); run(); });
}

/* ============================================================
   ТЕХНИКА, ДОБАВКИ, ЛЕНИВОЕ ПИТАНИЕ — элементы формы
   ============================================================ */
function renderTech() {
  const box = $('#techList');
  if (!box) return;
  box.innerHTML = TECH.map(t => `
    <button type="button" class="chip tech-chip${state.tech.indexOf(t.id) !== -1 ? ' active' : ''}" data-tech="${t.id}"
      aria-pressed="${state.tech.indexOf(t.id) !== -1}">
      <span class="tc-check" aria-hidden="true"></span>
      <span class="tc-ic">${t.icon}</span>
      <span class="tc-text"><b>${t.name}</b><small>${t.desc}</small></span>
    </button>`).join('');
}

/* сколько блюд можно приготовить имеющейся техникой */
function updateTechCount() {
  const el = $('#techCount');
  if (!el) return;
  const pool = buildPool();
  const n = activeMeals().reduce((a, m) => a + pool[m].length, 0);
  const empty = activeMeals().filter(m => !pool[m].length);
  el.textContent = empty.length
    ? `Сейчас нет ни одного блюда для: ${empty.map(m => MEALS.find(x => x.id === m).name.toLowerCase()).join(', ')} — отметьте ещё технику.`
    : `Подходит ${n} ${plural(n, 'блюдо', 'блюда', 'блюд')}.`;
  el.classList.toggle('warn-text', !!empty.length);
}

function renderSupp() {
  const box = $('#suppBox');
  const sw = $('#optSupp');
  if (!box || !sw) return;
  sw.checked = !!state.supp.on;
  box.hidden = !state.supp.on;
  if (!state.supp.on) return;
  const adults = adultCount();
  const items = state.supp.items || {};
  const takers = suppTakers();
  const takersRow = adults > 1 ? `
    <div class="supp-takers">
      <span>Сколько взрослых принимает</span>
      <div class="chips">${Array.from({ length: adults }, (_, i) => i + 1).map(n =>
        `<button type="button" class="chip${n === takers ? ' active' : ''}" data-takers="${n}">${n}</button>`).join('')}</div>
    </div>` : '';
  const card = s => {
    const on = items[s.id] > 0;
    const serv = on ? clamp(items[s.id], 1, s.maxServ) : 1;
    const macro = suppMacroText(s, serv);
    return `<div class="supp-item${on ? ' on' : ''}" data-supp="${s.id}">
      <label class="supp-check">
        <input type="checkbox" data-supp-cb="${s.id}"${on ? ' checked' : ''}>
        <span class="supp-ic">${s.icon}</span>
        <span class="supp-text"><b>${s.name}</b><small>${s.dose} · <span data-supp-macro="${s.id}">${macro}</span></small></span>
      </label>
      ${on && s.maxServ > 1 ? `<div class="supp-range">
        <span>Порций в день: <b data-supp-serv="${s.id}">${serv}</b></span>
        <input type="range" min="1" max="${s.maxServ}" step="1" value="${serv}" data-supp-range="${s.id}" aria-label="Порций в день: ${s.name}">
      </div>` : ''}
    </div>`;
  };
  const withKcal = SUPPLEMENTS.filter(s => s.kc > 0);
  const vitamins = SUPPLEMENTS.filter(s => !s.kc);
  box.innerHTML = `
    ${adults ? '' : '<p class="hint hint-warn">Добавки учитываются только для взрослых — в списке едоков сейчас одни дети.</p>'}
    ${takersRow}
    <div class="supp-group-title">Спортивное питание и клетчатка — засчитываются в КБЖУ</div>
    <div class="supp-grid">${withKcal.map(card).join('')}</div>
    <div class="supp-group-title">Витамины и минералы — отмечаются в меню, калорий не дают</div>
    <div class="supp-grid">${vitamins.map(card).join('')}</div>
    <p class="hint supp-note"><span data-supp-sum>${suppSummaryText()}</span> Детям добавки здесь не назначаются.
    Стоимость добавок в бюджет продуктов не входит. Дозировку согласуйте с врачом.</p>`;
}

/* «240 ккал · Б 48 г» — только ненулевые значения */
function suppMacroText(s, serv) {
  if (!s.kc) return 'без калорий';
  const parts = [num(s.kc * serv) + ' ккал'];
  if (s.pr >= 1) parts.push('Б ' + num(s.pr * serv) + ' г');
  if (s.fa >= 1 && s.pr < 1) parts.push('Ж ' + num(s.fa * serv) + ' г');
  if (s.ca >= 10) parts.push('У ' + num(s.ca * serv) + ' г');
  if (s.fi >= 1) parts.push('клетч. ' + num(s.fi * serv) + ' г');
  return parts.join(' · ');
}

function suppSummaryText() {
  const list = suppList();
  if (!list.length) return 'Отметьте, что принимаете.';
  const sp = suppDaily();
  if (sp.kc < 1 && sp.pr < 0.5) return `Отмечено: ${list.length}. На КБЖУ эти добавки не влияют.`;
  return `Отмечено: ${list.length}. В день добавки дадут ${num(sp.kc)} ккал и ${num(sp.pr)} г белка` +
    (sp.fi >= 1 ? `, ${num(sp.fi)} г клетчатки` : '') + ' — на столько меньше подберётся еды.';
}

function initExtraOptions() {
  renderTech();
  const tl = $('#techList');
  if (tl) tl.addEventListener('click', e => {
    const b = e.target.closest('[data-tech]');
    if (!b) return;
    const id = b.dataset.tech;
    const i = state.tech.indexOf(id);
    if (i === -1) state.tech.push(id); else state.tech.splice(i, 1);
    b.classList.toggle('active', i === -1);
    b.setAttribute('aria-pressed', String(i === -1));
    saveSettings();
  });

  const lz = $('#optLazy');
  if (lz) lz.addEventListener('change', e => { state.lazy = e.target.checked; saveSettings(); });

  const sw = $('#optSupp');
  if (sw) sw.addEventListener('change', e => {
    state.supp.on = e.target.checked;
    renderSupp();
    saveSettings();
  });
  const box = $('#suppBox');
  if (box) {
    box.addEventListener('change', e => {
      const cb = e.target.closest('[data-supp-cb]');
      if (cb) {
        const id = cb.dataset.suppCb;
        if (cb.checked) state.supp.items[id] = state.supp.items[id] > 0 ? state.supp.items[id] : 1;
        else delete state.supp.items[id];
        renderSupp();
        saveSettings();
        return;
      }
      const rg = e.target.closest('[data-supp-range]');
      if (rg) { saveSettings(); renderSupp(); }
    });
    /* ползунок: цифры меняем на лету, пересчёт — когда отпустили */
    box.addEventListener('input', e => {
      const rg = e.target.closest('[data-supp-range]');
      if (!rg) return;
      const id = rg.dataset.suppRange;
      const s = SUPPLEMENTS.find(x => x.id === id);
      const v = clamp(+rg.value, 1, s.maxServ);
      state.supp.items[id] = v;
      const sv = box.querySelector(`[data-supp-serv="${id}"]`);
      if (sv) sv.textContent = v;
      const mc = box.querySelector(`[data-supp-macro="${id}"]`);
      if (mc) mc.textContent = suppMacroText(s, v);
      const sum = box.querySelector('[data-supp-sum]');
      if (sum) sum.textContent = suppSummaryText();
    });
    box.addEventListener('click', e => {
      const t = e.target.closest('[data-takers]');
      if (!t) return;
      state.supp.takers = +t.dataset.takers;
      renderSupp();
      saveSettings();
    });
  }
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
  if (state.supp && state.supp.on) renderSupp();
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
  if ($('#optLazy')) $('#optLazy').checked = !!state.lazy;
  renderTech();
  renderSupp();
  updateTechCount();
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
          /* приложение слушает это событие, чтобы открыть экран результата */
          if (typeof window.onPlanReady === 'function') window.onPlanReady();
        }
        if (!document.body.classList.contains('app')) {
          $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
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
  if (suppList().length) {
    out += `--- ВИТАМИНЫ И ДОБАВКИ (не входят в сумму) ---\n`;
    suppList().forEach(({ s, serv }) => { out += `${s.name} — ${s.dose}${serv > 1 ? ' ×' + serv : ''} в день\n`; });
    out += '\n';
  }
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
    if (rec) { openRecipe(rec.dataset.recipe, rec.dataset.day !== undefined ? +rec.dataset.day : undefined); return; }
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
  updateTechCount();
  updateBudgetHint();
  resyncPlan();
  try {
    localStorage.setItem(LS_SET, JSON.stringify({
      goal: state.goal, dietStyle: state.dietStyle, cuisines: state.cuisines,
      persons: state.persons, budget: state.budget, days: state.days,
      mealsCount: state.mealsCount, store: state.store,
      excluded: state.excluded, veg: state.veg, noPork: state.noPork,
      staplesOwned: state.staplesOwned, lazy: state.lazy, tech: state.tech, supp: state.supp,
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
  /* новые поля: техника и добавки — проверяем формат, иначе берём по умолчанию */
  if (obj && 'tech' in obj) {
    obj.tech = Array.isArray(obj.tech)
      ? obj.tech.filter(id => TECH.some(t => t.id === id))
      : TECH.map(t => t.id);
  }
  if (obj && 'supp' in obj) {
    const sp = obj.supp && typeof obj.supp === 'object' ? obj.supp : {};
    const items = {};
    Object.keys(sp.items || {}).forEach(id => {
      if (SUPPLEMENTS.some(x => x.id === id) && sp.items[id] > 0) items[id] = +sp.items[id];
    });
    obj.supp = { on: !!sp.on, items, takers: typeof sp.takers === 'number' ? sp.takers : null };
  }
  if (obj && 'lazy' in obj) obj.lazy = !!obj.lazy;
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

    /* план мог быть сохранён прошлой версией: нормы тогда считались иначе,
       а у дней не было добора и масштаба порций — приводим к текущему формату */
    state.plan.targets = targets();
    state.plan.menu.forEach(d => {
      if (typeof d.scale !== 'number' || !isFinite(d.scale) || d.scale <= 0) d.scale = peopleCount();
      if (!Array.isArray(d.boost)) d.boost = [];
      d.meals = (d.meals || []).filter(m => RECIPE_BY_ID[m.id]);
    });
    state.plan.menu = state.plan.menu.filter(d => d.meals.length);
    if (!state.plan.menu.length) { state.plan = null; return; }
    if (typeof state.plan.avgScale !== 'number' || !isFinite(state.plan.avgScale)) {
      const sc = state.plan.menu.map(d => d.scale);
      state.plan.avgScale = sc.reduce((a, b) => a + b, 0) / sc.length;
    }
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

  const setText = (sel, val) => { const el = $(sel); if (el) el.textContent = val; };
  setText('#statProducts', PRODUCTS.length);
  setText('#statRecipes', RECIPES.length);
  setText('#statAllerg', ALLERGENS.length);
  setText('#statCuisines', CUISINES.length);
  setText('#priceDate', PRICE_DATE);
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
