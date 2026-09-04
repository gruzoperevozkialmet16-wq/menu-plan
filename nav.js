/* ============================================================
   Мобильное меню: кнопка-бургер в шапке и выпадающая панель.
   Подключается на всех страницах, разметку добавляет сама —
   в HTML ничего дублировать не нужно.
   ============================================================ */
(function () {
  const header = document.querySelector('.site-header');
  const nav = header && header.querySelector('.header-nav');
  if (!nav) return;

  /* кнопка-бургер */
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-toggle';
  btn.setAttribute('aria-label', 'Меню');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span></span><span></span><span></span>';

  const inner = header.querySelector('.header-inner');
  inner.appendChild(btn);

  const close = () => {
    header.classList.remove('nav-open');
    btn.setAttribute('aria-expanded', 'false');
  };
  const toggle = () => {
    const open = header.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });

  /* закрываем по выбору пункта, клику вне и по Escape */
  nav.addEventListener('click', e => { if (e.target.closest('a')) close(); });
  document.addEventListener('click', e => {
    if (header.classList.contains('nav-open') && !e.target.closest('.site-header')) close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', () => { if (window.innerWidth > 980) close(); });
})();
