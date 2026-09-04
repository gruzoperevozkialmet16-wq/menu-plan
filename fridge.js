/* ============================================================
   МЕНЮ-ПЛАН — «Что приготовить из остатков»
   Отмечаем, что есть дома, и ищем блюда с максимальным покрытием.
   ============================================================ */

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
  const k = storeK(state.store);
  const haveSet = {};
  fridge.have.forEach(id => { haveSet[id] = 1; });

  const rows = [];
  RECIPES.forEach(r => {
    const al = recipeAllergens(r);
    if (al.some(a => state.excluded.indexOf(a) !== -1)) return;
    if (state.veg && recipeHas(r, MEAT_IDS)) return;
    if (state.noPork && recipeHas(r, PORK_IDS)) return;

    const need = r.ing.filter(([id]) => !(fridge.staples && PRODUCT_BY_ID[id].staple));
    if (!need.length) return;
    const missing = need.filter(([id]) => !haveSet[id]);
    const used = need.length - missing.length;
    if (used === 0) return;

    /* стоимость докупки недостающего — целыми упаковками */
    let buyCost = 0;
    const buyList = missing.map(([id, g]) => {
      const p = PRODUCT_BY_ID[id];
      const packs = Math.max(1, Math.ceil(g * PORTION * state.people / 1000 / p.pack - 0.001));
      const cost = packs * p.pack * p.price * k;
      buyCost += cost;
      return { p, packs, cost };
    });

    rows.push({
      r, used, missingCount: missing.length, buyList, buyCost,
      coverage: used / need.length,
      mac: recipeMacro(r),
      cost: recipeCost(r, k),
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

/* ---------- инициализация ---------- */
(function initFridge() {
  fridgeLoad();
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
    $('#fridgeResult').innerHTML = '';
  });

  $('#fridgeStaples').addEventListener('change', e => {
    fridge.staples = e.target.checked;
    fridgeSave();
  });

  $('#fridgeBtn').addEventListener('click', renderFridgeResult);
})();
