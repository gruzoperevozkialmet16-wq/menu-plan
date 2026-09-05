/* ============================================================
   ХОЛОДИЛЬНИК — отдельная страница
   Отмечаем, что есть дома, и ищем блюда с максимальным покрытием.
   Страница автономна: нужны только data.js, products2.js и файлы
   рецептов. Настройки (аллергии, вегетарианство) читаются из тех же
   ключей localStorage, что использует планировщик на главной.
   ============================================================ */

window.FridgeModule = (function () {
/* ---------- утилиты ---------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function money(v) { return Math.round(v).toLocaleString('ru-RU') + ' ₽'; }
function num(v) { return Math.round(v).toLocaleString('ru-RU'); }
function kgLabel(kg) { return kg >= 1 ? (Math.round(kg * 100) / 100).toString().replace('.', ',') + ' кг' : Math.round(kg * 1000) + ' г'; }
function storeK(id) { const s = STORES.find(x => x.id === id); return s ? s.k : 1; }
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/* ---------- настройки, общие с планировщиком ---------- */
/* Если на странице уже работает планировщик (app.js), берём его настройки —
   так холодильник в приложении сразу учитывает аллергии и состав семьи. */
const shared = (typeof state !== 'undefined' && state && Array.isArray(state.persons)) ? state : null;
const st = shared || {
  goal: 'normal', store: 'p5', excluded: [], veg: false, noPork: false,
  persons: [{ type: 'adult', sex: 'm', weight: 78, height: 176, age: 30, activity: 'light' }],
};
try {
  const raw = shared ? null : localStorage.getItem('menuplan_settings_v2');
  if (raw) {
    const d = JSON.parse(raw);
    if (d.store) st.store = d.store;
    if (d.goal) st.goal = d.goal;
    if (Array.isArray(d.excluded)) st.excluded = d.excluded;
    st.veg = !!d.veg;
    st.noPork = !!d.noPork;
    if (Array.isArray(d.persons) && d.persons.length) st.persons = d.persons;
    else if (typeof d.people === 'number') {
      st.persons = [];
      for (let i = 0; i < Math.max(1, d.people); i++) st.persons.push({ type: 'adult', weight: d.weight || 70 });
    }
  }
} catch (e) { /* приватный режим */ }

function fpPeopleCount() { return st.persons.length; }

/* ---------- нормы едоков (та же логика, что в планировщике) ---------- */
function fpSexOf(p) { return SEXES.find(s => s.id === (p.sex || 'm')) || SEXES[0]; }
function fpActivityOf(p) { return ACTIVITY.find(a => a.id === (p.activity || 'light')) || ACTIVITY[1]; }
function fpChildNorm(age) { return CHILD_NORMS.find(n => age <= n.max) || CHILD_NORMS[CHILD_NORMS.length - 1]; }

function fpPersonTargets(p) {
  if (p.type === 'child') {
    const n = fpChildNorm(p.age || 7);
    return { kcal: p.sex === 'f' ? n.kcalF : n.kcalM, isChild: true, ageLabel: n.label };
  }
  const g = GOALS.find(x => x.id === (st.goal || 'normal')) || GOALS[1];
  const w = p.weight || 70, h = p.height || fpSexOf(p).height, age = p.age || 30;
  const base = 10 * w + 6.25 * h - 5 * age + (p.sex === 'f' ? -161 : 5);
  const tdee = base * fpActivityOf(p).k;
  return { kcal: Math.max(Math.round(base * 1.05), Math.round(tdee * g.kcalFactor)), isChild: false };
}

function fpPersonName(p) {
  const sx = fpSexOf(p);
  if (p.type === 'child') return sx.childName + (p.age ? ', ' + p.age + ' ' + plural(p.age, 'год', 'года', 'лет') : '');
  return sx.name + (p.weight ? ', ' + p.weight + ' кг' : '');
}

/* Делим готовое блюдо между едоками по их суточной норме калорий */
function fpServingSplitHtml(r) {
  const per = st.persons.map(p => ({ p, t: fpPersonTargets(p) }));
  const totalKcal = per.reduce((s, x) => s + x.t.kcal, 0);
  if (!per.length || !totalKcal) return '';

  let grams = 0;
  const mac = { kc: 0, pr: 0 };
  r.ing.forEach(([id, g]) => {
    const pr = PRODUCT_BY_ID[id], q = g * PORTION * fpPeopleCount();
    grams += q;
    mac.kc += q * pr.kc / 100;
    mac.pr += q * pr.pr / 100;
  });

  return `
    <div class="m-sec">Кому сколько положить</div>
    <div class="serving-split">
      ${per.map(x => {
        const share = x.t.kcal / totalKcal;
        const icon = x.t.isChild ? (x.p.sex === 'f' ? '👧' : '👦') : fpSexOf(x.p).icon;
        return `<div class="ss-row${x.t.isChild ? ' is-child' : ''}">
          <span class="ss-who">${icon} ${fpPersonName(x.p)}</span>
          <b class="ss-g">${Math.round(grams * share)} г</b>
          <span class="ss-kc">${num(mac.kc * share)} ккал</span>
          <span class="ss-pr">Б ${num(mac.pr * share)} г</span>
        </div>`;
      }).join('')}
      <div class="ss-total">
        <span>Всего готового блюда</span>
        <b>${grams >= 1000 ? kgLabel(grams / 1000) : Math.round(grams) + ' г'}</b>
        <span>${num(mac.kc)} ккал</span>
        <span>Б ${num(mac.pr)} г</span>
      </div>
    </div>
    <p class="ss-note">Порции разделены по суточной норме каждого. Вес — по сырым продуктам:
    крупы и макароны при варке прибавляют, мясо и овощи немного теряют.
    Состав семьи задаётся <a href="./#planner">в планировщике</a>.</p>`;
}

/* ---------- расчёты по рецептам ---------- */
const RECIPE_BY_ID = {};
RECIPES.forEach(r => { RECIPE_BY_ID[r.id] = r; });

function fpRecipeAllergens(r) {
  const set = {};
  r.ing.forEach(([id]) => (PRODUCT_BY_ID[id].a || []).forEach(a => { set[a] = 1; }));
  return Object.keys(set);
}
function fpRecipeMacro(r) {
  let kc = 0, pr = 0, fa = 0, ca = 0, fi = 0;
  r.ing.forEach(([id, g]) => {
    const p = PRODUCT_BY_ID[id], q = g * PORTION / 100;
    kc += q * p.kc; pr += q * p.pr; fa += q * p.fa; ca += q * p.ca; fi += q * p.fi;
  });
  return { kc, pr, fa, ca, fi };
}
function fpRecipeCost(r, k) {
  let sum = 0;
  r.ing.forEach(([id, g]) => { sum += (g * PORTION / 1000) * PRODUCT_BY_ID[id].price * k; });
  return sum;
}
function fpRecipeHas(r, ids) { return r.ing.some(([id]) => ids.indexOf(id) !== -1); }

/* ---------- модалка рецепта ---------- */
function fpOpenRecipe(id) {
  const r = RECIPE_BY_ID[id];
  if (!r) return;
  const k = storeK(st.store);
  const info = MEALS.find(m => m.id === r.m);
  const al = fpRecipeAllergens(r);
  const mac = fpRecipeMacro(r);
  const n = fpPeopleCount();
  $('#modalContent').innerHTML = `
    <div class="m-photo" style="background:${dishGradient(r)}"><span>${dishEmoji(r)}</span><i>${info.name}</i></div>
    <h3>${r.n}</h3>
    <div class="m-meta">
      <span>${info.icon} ${info.name}</span>
      <span>⏱ ${r.t} мин</span>
      <span>💸 ${money(fpRecipeCost(r, k) * n)} на ${n} ${plural(n, 'человека', 'человек', 'человек')}</span>
    </div>
    <div class="m-macro">
      <div><b>${num(mac.kc)}</b><span>ккал</span></div>
      <div><b>${num(mac.pr)} г</b><span>белки</span></div>
      <div><b>${num(mac.fa)} г</b><span>жиры</span></div>
      <div><b>${num(mac.ca)} г</b><span>углеводы</span></div>
      <div><b>${num(mac.fi)} г</b><span>клетчатка</span></div>
    </div>
    ${fpServingSplitHtml(r)}
    <div class="m-sec">Продукты на ${n} ${plural(n, 'человека', 'человек', 'человек')}</div>
    ${r.ing.map(([pid, g]) => {
      const p = PRODUCT_BY_ID[pid];
      const total = g * PORTION * n;
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
function fpCloseModal() { $('#modal').hidden = true; document.body.style.overflow = ''; }

document.addEventListener('click', e => {
  const rec = e.target.closest('[data-recipe]');
  if (rec) { openRecipe(rec.dataset.recipe); return; }
  if (e.target.closest('[data-close]')) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

const fridge = {
  have: [],          /* id продуктов, которые есть дома */
  staples: true,     /* соль/специи/масло/мука считаем имеющимися */
};

const LS_FRIDGE = 'menuplan_fridge_v1';

function fridgeSave() {
  try { localStorage.setItem(LS_FRIDGE, JSON.stringify(fridge)); } catch (e) { /* игнор */ }
}
function fridgeLoad() {
  try {
    const raw = localStorage.getItem(LS_FRIDGE);
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d.have)) fridge.have = d.have.filter(id => PRODUCT_BY_ID[id]);
      if (typeof d.staples === 'boolean') fridge.staples = d.staples;
    }
  } catch (e) { /* игнор */ }
}

function fridgeToggle(id, on) {
  const i = fridge.have.indexOf(id);
  if (on === undefined) on = i === -1;
  if (on && i === -1) fridge.have.push(id);
  if (!on && i !== -1) fridge.have.splice(i, 1);
  fridgeSave();
  renderFridgeSelected();
  syncFridgeChecks();
  updateHaveCount();
}

/* ---------- выбранные продукты ---------- */
function renderFridgeSelected() {
  const el = $('#fridgeSelected');
  if (!fridge.have.length) {
    el.innerHTML = `<p class="fridge-empty">Пока ничего не отмечено. Начните вводить название продукта или раскройте полный список ниже.</p>`;
    return;
  }
  const byCat = {};
  fridge.have.forEach(id => {
    const p = PRODUCT_BY_ID[id];
    (byCat[p.c] = byCat[p.c] || []).push(p);
  });
  el.innerHTML = `<div class="fridge-count">В холодильнике: <b>${fridge.have.length}</b> ${plural(fridge.have.length, 'продукт', 'продукта', 'продуктов')}</div>` +
    CATEGORIES.filter(c => byCat[c.id]).map(c => `
      <div class="fridge-group">
        <span class="fridge-group-name">${c.icon} ${c.name}</span>
        <div class="chips">${byCat[c.id].map(p =>
          `<button type="button" class="chip active fridge-chip" data-fridge-del="${p.id}">${p.n} <i>×</i></button>`).join('')}</div>
      </div>`).join('');
}

/* ---------- полный список ---------- */
function renderFridgeAll() {
  $('#fridgeAll').innerHTML = CATEGORIES.map(c => {
    const list = PRODUCTS.filter(p => p.c === c.id);
    return `<div class="fridge-cat">
      <h5>${c.icon} ${c.name}</h5>
      <div class="fridge-boxes">${list.map(p => `
        <label class="fridge-box"><input type="checkbox" data-fridge-id="${p.id}"><span>${p.n}</span></label>`).join('')}</div>
    </div>`;
  }).join('');
  $$('#fridgeAll input[data-fridge-id]').forEach(cb => {
    cb.addEventListener('change', () => fridgeToggle(cb.dataset.fridgeId, cb.checked));
  });
  syncFridgeChecks();
}

function syncFridgeChecks() {
  $$('#fridgeAll input[data-fridge-id]').forEach(cb => {
    cb.checked = fridge.have.indexOf(cb.dataset.fridgeId) !== -1;
  });
}

/* ---------- поиск с подсказками ---------- */
function renderFridgeSuggest() {
  const q = $('#fridgeSearch').value.trim().toLowerCase();
  const box = $('#fridgeSuggest');
  if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
  const found = PRODUCTS.filter(p => p.n.toLowerCase().includes(q)).slice(0, 8);
  if (!found.length) {
    box.innerHTML = `<div class="fs-empty">Такого продукта нет в каталоге</div>`;
  } else {
    box.innerHTML = found.map(p => {
      const has = fridge.have.indexOf(p.id) !== -1;
      return `<button type="button" class="fs-item${has ? ' has' : ''}" data-fridge-add="${p.id}">
        <span>${p.n}</span><small>${p.kc} ккал · Б ${p.pr} · ${money(p.price)}/кг</small>
        <i>${has ? '✓ уже есть' : '+ добавить'}</i></button>`;
    }).join('');
  }
  box.hidden = false;
}

/* ---------- подбор блюд ---------- */
function fridgeMatch() {
  const k = storeK(st.store);
  const haveSet = {};
  fridge.have.forEach(id => { haveSet[id] = 1; });

  const rows = [];
  RECIPES.forEach(r => {
    const al = fpRecipeAllergens(r);
    if (al.some(a => st.excluded.indexOf(a) !== -1)) return;
    if (st.veg && fpRecipeHas(r, MEAT_IDS)) return;
    if (st.noPork && fpRecipeHas(r, PORK_IDS)) return;

    const need = r.ing.filter(([id]) => !(fridge.staples && PRODUCT_BY_ID[id].staple));
    if (!need.length) return;
    const missing = need.filter(([id]) => !haveSet[id]);
    const used = need.length - missing.length;
    if (used === 0) return;

    /* стоимость докупки недостающего — целыми упаковками */
    let buyCost = 0;
    const buyList = missing.map(([id, g]) => {
      const p = PRODUCT_BY_ID[id];
      const packs = Math.max(1, Math.ceil(g * PORTION * fpPeopleCount() / 1000 / p.pack - 0.001));
      const cost = packs * p.pack * p.price * k;
      buyCost += cost;
      return { p, packs, cost };
    });

    rows.push({
      r, used, missingCount: missing.length, buyList, buyCost,
      coverage: used / need.length,
      mac: fpRecipeMacro(r),
      cost: fpRecipeCost(r, k),
    });
  });

  rows.sort((a, b) =>
    a.missingCount - b.missingCount ||
    b.used - a.used ||
    a.buyCost - b.buyCost);

  return rows;
}

function renderFridgeResult() {
  const rows = fridgeMatch();
  const box = $('#fridgeResult');

  if (!fridge.have.length) {
    box.innerHTML = `<div class="notice warn">Сначала отметьте, что у вас есть дома.</div>`;
    return;
  }

  const ready = rows.filter(x => x.missingCount === 0);
  const near1 = rows.filter(x => x.missingCount === 1).slice(0, 12);
  const near2 = rows.filter(x => x.missingCount === 2).slice(0, 9);

  const card = x => {
    const info = MEALS.find(m => m.id === x.r.m);
    return `<div class="fr-card" data-recipe="${x.r.id}">
      <div class="fr-art" style="background:${dishGradient(x.r)}"><span>${dishEmoji(x.r)}</span></div>
      <div class="fr-body">
        <h4>${x.r.n}</h4>
        <div class="rec-meta"><span>${info.icon} ${info.name}</span><span>⏱ ${x.r.t} мин</span></div>
        <div class="rec-macro">
          <span>${num(x.mac.kc)} ккал</span>
          <span class="pr">Б ${num(x.mac.pr)} г</span>
          <span>Ж ${num(x.mac.fa)} г</span>
          <span>У ${num(x.mac.ca)} г</span>
          <span class="fi">кл. ${num(x.mac.fi)} г</span>
        </div>
        ${x.missingCount === 0
          ? `<div class="fr-ok">✓ Всё есть — можно готовить</div>`
          : `<div class="fr-miss">Докупить: ${x.buyList.map(b => b.p.n).join(', ')} — <b>${money(x.buyCost)}</b></div>`}
      </div>
    </div>`;
  };

  let html = '';
  if (ready.length) {
    html += `<div class="fr-block"><h3>✓ Можно приготовить прямо сейчас <span>${ready.length}</span></h3>
      <div class="fr-grid">${ready.map(card).join('')}</div></div>`;
  } else {
    html += `<div class="notice warn"><b>Полностью готовых блюд нет.</b> Из отмеченного не набирается ни один рецепт целиком — посмотрите, где не хватает одного продукта.</div>`;
  }
  if (near1.length) {
    html += `<div class="fr-block"><h3>Не хватает одного продукта <span>${near1.length}</span></h3>
      <div class="fr-grid">${near1.map(card).join('')}</div></div>`;
  }
  if (near2.length) {
    html += `<div class="fr-block"><h3>Не хватает двух продуктов <span>${near2.length}</span></h3>
      <div class="fr-grid">${near2.map(card).join('')}</div></div>`;
  }
  if (!ready.length && !near1.length && !near2.length) {
    html = `<div class="notice warn"><b>Ничего не нашлось.</b> Отмеченные продукты почти не встречаются в рецептах вместе — добавьте ещё несколько позиций.</div>`;
  }

  box.innerHTML = html;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- сводка активных ограничений ---------- */
function renderLimits() {
  const parts = [];
  st.excluded.forEach(id => {
    const a = ALLERGENS.find(x => x.id === id);
    if (a) parts.push(a.icon + ' без ' + a.name.toLowerCase());
  });
  if (st.veg) parts.push('🌿 вегетарианское');
  if (st.noPork) parts.push('🚫 без свинины');
  const el = $('#fridgeLimits');
  if (!el) return;
  el.innerHTML = parts.length
    ? `Учитываются ваши ограничения из планировщика: <b>${parts.join(', ')}</b>. <a href="./#planner">Изменить</a>`
    : `Ограничений нет — показываем все блюда. Аллергии задаются <a href="./#planner">в планировщике</a>.`;
}

/* ---------- инициализация ---------- */
(function initFridge() {
  fridgeLoad();
  renderLimits();
  renderFridgeAll();
  renderFridgeSelected();
  $('#fridgeStaples').checked = fridge.staples;

  $('#fridgeSearch').addEventListener('input', renderFridgeSuggest);
  $('#fridgeSearch').addEventListener('focus', renderFridgeSuggest);

  document.addEventListener('click', e => {
    const add = e.target.closest('[data-fridge-add]');
    if (add) {
      fridgeToggle(add.dataset.fridgeAdd, true);
      $('#fridgeSearch').value = '';
      $('#fridgeSuggest').hidden = true;
      return;
    }
    const del = e.target.closest('[data-fridge-del]');
    if (del) { fridgeToggle(del.dataset.fridgeDel, false); return; }
    if (!e.target.closest('.fridge-search') && !e.target.closest('#fridgeSuggest')) {
      const s = $('#fridgeSuggest');
      if (s) s.hidden = true;
    }
  });

  $('#fridgeClear').addEventListener('click', () => {
    fridge.have = [];
    fridgeSave();
    renderFridgeSelected();
    syncFridgeChecks();
    updateHaveCount();
    $('#fridgeResult').innerHTML = '';
  });

  $('#fridgeStaples').addEventListener('change', e => {
    fridge.staples = e.target.checked;
    fridgeSave();
  });

  $('#fridgeBtn').addEventListener('click', renderFridgeResult);

  if ($('#statRecipes')) $('#statRecipes').textContent = RECIPES.length;
  if ($('#statProducts')) $('#statProducts').textContent = PRODUCTS.length;
  updateHaveCount();
})();

function updateHaveCount() {
  const el = $('#statHave');
  if (el) el.textContent = fridge.have.length;
}

  return { render: renderFridgeResult, refreshLimits: renderLimits, selected: () => fridge.have };
})();
