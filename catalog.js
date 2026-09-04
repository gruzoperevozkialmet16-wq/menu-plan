/* ============================================================
   КАТАЛОГ — отдельная страница
   Работает автономно: нужны только data.js и products2.js
   ============================================================ */

(function () {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const money = v => Math.round(v).toLocaleString('ru-RU') + ' ₽';
  const storeK = id => { const s = STORES.find(x => x.id === id); return s ? s.k : 1; };
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  };

  let sortMode = 'name';   /* name | price-asc | price-desc | protein | kcal */

  function currentList() {
    const q = $('#catalogSearch').value.trim().toLowerCase();
    const cat = $('#catalogCategory').value;
    const allergen = $('#catalogAllergen').value;
    return PRODUCTS.filter(p => {
      if (q && !p.n.toLowerCase().includes(q)) return false;
      if (cat && p.c !== cat) return false;
      if (allergen && p.a.indexOf(allergen) === -1) return false;
      return true;
    });
  }

  function sortList(list, k) {
    const arr = list.slice();
    if (sortMode === 'price-asc') arr.sort((a, b) => a.price * k - b.price * k);
    else if (sortMode === 'price-desc') arr.sort((a, b) => b.price * k - a.price * k);
    else if (sortMode === 'protein') arr.sort((a, b) => b.pr - a.pr);
    else if (sortMode === 'kcal') arr.sort((a, b) => a.kc - b.kc);
    else arr.sort((a, b) => a.n.localeCompare(b.n, 'ru'));
    return arr;
  }

  function row(p, k) {
    return `<div class="cat-row">
      <span class="cr-name">${p.n}${p.staple ? ' <i class="cr-staple" title="Базовый продукт — обычно уже есть дома">базовое</i>' : ''}</span>
      <span class="cr-tags">${p.a.map(a => {
        const A = ALLERGENS.find(x => x.id === a);
        return A ? `<span class="cr-tag">${A.icon} ${A.name}</span>` : '';
      }).join('')}</span>
      <span class="cr-macro">${p.kc} ккал · Б ${p.pr} · Ж ${p.fa} · У ${p.ca} · кл. ${p.fi}</span>
      <span class="cr-pack">${p.packName}</span>
      <span class="cr-price">${money(p.price * k)}<small>за кг/л</small></span>
    </div>`;
  }

  function render() {
    const k = storeK($('#catalogStore').value);
    const list = currentList();
    const grouped = !$('#catalogCategory').value && sortMode === 'name';

    let html = '';
    if (grouped) {
      CATEGORIES.forEach(cat => {
        const sub = sortList(list.filter(p => p.c === cat.id), k);
        if (!sub.length) return;
        const min = Math.min.apply(null, sub.map(p => p.price * k));
        html += `<div class="cat-block">
          <h4>${cat.icon} ${cat.name}
            <span class="cat-count">· ${sub.length} ${plural(sub.length, 'позиция', 'позиции', 'позиций')}, от ${money(min)}/кг</span>
          </h4>
          ${sub.map(p => row(p, k)).join('')}
        </div>`;
      });
    } else {
      const sorted = sortList(list, k);
      html = `<div class="cat-block"><h4>Найдено <span class="cat-count">· ${sorted.length} ${plural(sorted.length, 'позиция', 'позиции', 'позиций')}</span></h4>
        ${sorted.map(p => row(p, k)).join('')}</div>`;
    }

    $('#catalogTable').innerHTML = html || '<p class="section-sub">Ничего не нашлось. Попробуйте изменить запрос или снять фильтры.</p>';
    $('#catalogSummary').textContent =
      `${list.length} ${plural(list.length, 'продукт', 'продукта', 'продуктов')} из ${PRODUCTS.length} · ` +
      `магазин «${STORES.find(s => s.id === $('#catalogStore').value).name}»`;
  }

  function init() {
    $('#catalogStore').innerHTML = STORES.map(s =>
      `<option value="${s.id}">${s.name}${s.k !== 1 ? ' (' + (s.k > 1 ? '+' : '−') + Math.round(Math.abs(s.k - 1) * 100) + '%)' : ''}</option>`).join('');

    $('#catalogCategory').innerHTML = '<option value="">Все категории</option>' +
      CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');

    $('#catalogAllergen').innerHTML = '<option value="">Любые аллергены</option>' +
      ALLERGENS.map(a => `<option value="${a.id}">Содержит: ${a.name.toLowerCase()}</option>`).join('');

    $$('#catalogSort .chip').forEach(b => b.addEventListener('click', () => {
      sortMode = b.dataset.sort;
      $$('#catalogSort .chip').forEach(x => x.classList.toggle('active', x === b));
      render();
    }));

    ['#catalogSearch', '#catalogStore', '#catalogCategory', '#catalogAllergen'].forEach(sel => {
      $(sel).addEventListener('input', render);
      $(sel).addEventListener('change', render);
    });

    $('#catalogReset').addEventListener('click', () => {
      $('#catalogSearch').value = '';
      $('#catalogCategory').value = '';
      $('#catalogAllergen').value = '';
      sortMode = 'name';
      $$('#catalogSort .chip').forEach(x => x.classList.toggle('active', x.dataset.sort === 'name'));
      render();
    });

    $('#statProducts').textContent = PRODUCTS.length;
    $('#statCategories').textContent = CATEGORIES.length;
    $('#statStores').textContent = STORES.length;
    $$('.pd').forEach(el => { el.textContent = PRICE_DATE; });

    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
