/* ============================================================
   ГОТОВКА — общий модуль для сайта, приложения и «Холодильника»
   1. Какая кухонная техника нужна рецепту (recipeTech).
   2. Сколько времени занимает каждый шаг (stepTimeInfo) и таймер.
   3. Подсказки, как приготовить в аэрогриле, мультиварке, рисоварке.
   ============================================================ */

/* ---------- 1. техника ----------
   Ответ — список групп: в каждой группе достаточно ОДНОГО прибора.
   [['oven','airfryer']] — «нужна духовка или аэрогриль».
   Пустой список — готовить не нужно (салат, бутерброд, фрукты).
   Если в рецепте задано поле tech, оно главнее, иначе разбираем шаги. */
const RX_OVEN = /духовк|запека|запеч|выпека|противн|°\s*[CС]/i;
const RX_BLENDER = /блендер|пюрир|измельчит|пробить(?!\s+толкушк)/i;
const RX_FRY = /жар|сковород|пассеров|туши|тушён|казан|сотейник|растопит|карамелиз|(^|[^а-яё])вок([^а-яё]|$)|в воке/i;
const RX_BOIL = /вари|варк|отвар|кипя|кипят|кипени|довести|томит|бланшир|припуст|уварит|сварит|на пару|пароварк/i;
const RX_WARM = /прогре|разогре|нагре/i;
const RX_TOAST = /подсуш|подрумян|тостер/i;
const RX_GRAIN = /каша|рис(?![а-яё])|рисов|гречк|гречнев|пшён|перлов|кускус|булгур|киноа|плов|овсян/i;

function recipeTech(r) {
  if (r._tech) return r._tech;
  if (Array.isArray(r.tech)) { r._tech = r.tech; return r._tech; }
  const text = r.steps.join(' ');
  const groups = [];
  const oven = RX_OVEN.test(text);
  const fry = RX_FRY.test(text);
  const boil = RX_BOIL.test(text);
  if (oven) groups.push(['oven', 'airfryer']);
  if (fry) {
    groups.push(['stove', 'multicooker']);
  } else if (boil) {
    /* каши и крупы без жарки умеют и рисоварка, и мультиварка */
    groups.push(RX_GRAIN.test(r.n + ' ' + text)
      ? ['stove', 'multicooker', 'ricecooker']
      : ['stove', 'multicooker']);
  } else if (RX_WARM.test(text) && !oven) {
    groups.push(['stove', 'micro', 'multicooker']);
  } else if (RX_TOAST.test(text) && !oven) {
    groups.push(['stove', 'oven', 'airfryer']);
  }
  if (RX_BLENDER.test(text)) groups.push(['blender']);
  r._tech = groups;
  return groups;
}

/* Какую технику показать: по одному прибору из каждой группы — тот, что есть
   у человека, а если такого нет — первый подходящий */
function techUsedFor(r, have) {
  const list = have || TECH.map(t => t.id);
  const out = [];
  recipeTech(r).forEach(g => {
    const own = g.find(t => list.indexOf(t) !== -1) || g[0];
    if (out.indexOf(own) === -1) out.push(own);
  });
  return out.map(id => TECH.find(t => t.id === id)).filter(Boolean);
}
function techLabelFor(r, have) {
  const list = techUsedFor(r, have);
  return list.length ? list.map(t => t.icon + ' ' + t.name).join(' · ') : '🥄 Без готовки';
}

/* Подсказки по замене техники: если духовки нет, а аэрогриль есть, и т. п. */
function techTipsHtml(r, have) {
  const list = have || TECH.map(t => t.id);
  const has = id => list.indexOf(id) !== -1;
  const groups = recipeTech(r);
  const tips = [];
  const needOven = groups.some(g => g.indexOf('oven') !== -1 && g.indexOf('airfryer') !== -1);
  if (needOven && has('airfryer')) {
    const m = r.steps.join(' ').match(/(\d{3})\s*°/);
    const t = m ? Math.max(150, +m[1] - 20) : 180;
    const tm = stepTimesTotal(r, /запека|запеч|выпека|духовк/i);
    tips.push(`🌀 <b>В аэрогриле:</b> ${t} °C${tm ? ', примерно ' + Math.max(5, Math.round(tm * 0.8)) + ' мин' : ', время на 20 % меньше, чем в духовке'}.
      Выкладывайте в один слой и не накрывайте фольгой целиком. ${has('oven') ? 'Можно и в духовке — как в рецепте.' : ''}`);
  }
  const needStove = groups.some(g => g.indexOf('stove') !== -1);
  if (needStove && !has('stove') && has('multicooker')) {
    tips.push('🍲 <b>В мультиварке:</b> обжаривайте в режиме «Жарка» с открытой крышкой, ' +
      'варите и тушите в режимах «Варка» и «Тушение» — время то же, что в шагах рецепта.');
  } else if (needStove && !has('stove') && !has('multicooker') && has('ricecooker')) {
    tips.push('🍚 <b>В рисоварке:</b> крупа и вода в той же пропорции, режим «Каша» или «Белый рис».');
  }
  const warmOnly = groups.length && groups.every(g => g.indexOf('micro') !== -1);
  if (warmOnly && has('micro') && !has('stove')) {
    tips.push('📡 <b>В микроволновке:</b> грейте на средней мощности по 1 минуте, перемешивая.');
  }
  return tips.length ? `<div class="m-tech-tips">${tips.map(t => `<p>${t}</p>`).join('')}</div>` : '';
}

/* ---------- 2. время шагов ----------
   Сначала ищем время в тексте шага («варить 15 минут», «по 3 минуты
   с каждой стороны», «2 часа»). Если его нет, ставим ориентир по действию
   и помечаем «≈»: нарезать — около 5 минут, обжарить — 7 и т. д. */
const COOK_GUESS = [
  { re: /размороз/i, label: 'заранее', min: 0 },
  { re: /замоч|на ночь|заранее/i, label: 'заранее', min: 0 },
  { re: /остуд|охлад/i, min: 15 },
  { re: /отвар|свар|вари/i, min: 0, boil: true },
  { re: /тушит/i, min: 20 },
  { re: /запека|запеч|выпека/i, min: 25 },
  { re: /обжар|поджар|жарит|пассеров/i, min: 7 },
  { re: /прогре|разогре|нагре|довести до кип/i, min: 3 },
  { re: /нареза|нашинк|натере|почист|очист|порез|измельч|наруб|рубл/i, min: 5 },
  { re: /взби|смеша|перемеша|размя|замес|вымес|сформир|отби|обвал/i, min: 3 },
  { re: /промы|помыт|помой/i, min: 2 },
  { re: /посып|поли|выложи|подат|подай|украс|нали|намаз|сбрызн|заправ|положи|завари/i, min: 1 },
  { re: /добав|влить|влей|всып|залит|соедин|заложи|разби|вбит|обсуш|скатат|достат|отлом/i, min: 1 },
];
/* время варки, если в шаге не сказано, сколько варить */
const BOIL_GUESS = [
  [/макарон|паст|спагет|пенне|лапш|вермиш/i, 10], [/гречк|гречнев/i, 18], [/рис/i, 18],
  [/картоф|картош/i, 20], [/яйц|яйко/i, 10], [/чечевиц/i, 20], [/горох/i, 50],
  [/перлов/i, 45], [/пшен|пшён/i, 20], [/булгур/i, 15], [/кускус/i, 5], [/киноа/i, 15],
  [/фасол|нут/i, 60], [/свёкл|свекл/i, 50], [/кур|филе|мяс|говяд|свин/i, 25],
];

function fmtMin(m) {
  if (m >= 60) {
    const h = Math.floor(m / 60), r = Math.round(m % 60);
    return h + ' ч' + (r ? ' ' + r + ' мин' : '');
  }
  return Math.round(m) + ' мин';
}

function stepTimeInfo(text, r) {
  const t = String(text);
  /* «по 3 минуты с каждой стороны» */
  let m = t.match(/по\s+(\d+)(?:\s*[–-]\s*(\d+))?\s*мин[а-яё]*\s+с\s+каждой\s+стороны/i);
  if (m) {
    const a = +m[1], b = m[2] ? +m[2] : a;
    return { min: b * 2, label: 'по ' + (m[2] ? a + '–' + b : a) + ' мин с каждой стороны', approx: false };
  }
  /* все упоминания времени: «15 минут», «5–7 минут», «2 часа», «30 секунд».
     Если их несколько («замочить на 2 часа, отварить 45 минут»), показываем
     все, а таймер ставим на последнее — это обычно сама готовка. */
  const re = /(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?\s*(час|ч(?![а-яё])|минут|мин|секунд|сек)/gi;
  const found = [];
  let mm;
  while ((mm = re.exec(t)) !== null) {
    const unit = /сек/i.test(mm[3]) ? 's' : (/^ч/i.test(mm[3]) ? 'h' : 'm');
    const a = parseFloat(mm[1].replace(',', '.'));
    const b = mm[2] ? parseFloat(mm[2].replace(',', '.')) : a;
    const k = unit === 'h' ? 60 : (unit === 's' ? 1 / 60 : 1);
    let label;
    if (unit === 's') label = (mm[2] ? mm[1] + '–' + mm[2] : mm[1]) + ' сек';
    else if (unit === 'h') label = mm[2] ? mm[1] + '–' + mm[2] + ' ч' : fmtMin(a * 60);
    else label = mm[2] ? Math.round(a) + '–' + Math.round(b) + ' мин' : fmtMin(a);
    found.push({ min: b * k, label });
  }
  if (found.length) {
    return { min: found[found.length - 1].min, label: found.map(f => f.label).join(' + '), approx: false };
  }
  if (/полчаса/i.test(t)) return { min: 30, label: '30 мин', approx: false };
  if (/(^|[^а-яё])час([^а-яё]|$)/i.test(t)) return { min: 60, label: '1 ч', approx: false };

  /* ориентир по действию */
  for (const g of COOK_GUESS) {
    if (!g.re.test(t)) continue;
    if (g.label) return { min: 0, label: g.label, approx: true, ahead: true };
    let min = g.min;
    if (g.boil) {
      const src = t + ' ' + (r ? r.n : '');
      const hit = BOIL_GUESS.find(([re]) => re.test(src));
      min = hit ? hit[1] : 15;
    }
    return { min, label: '≈ ' + fmtMin(min), approx: true };
  }
  return null;
}

/* Сумма времени по шагам (для подсказки про аэрогриль) */
function stepTimesTotal(r, onlyRe) {
  let sum = 0;
  r.steps.forEach(s => {
    if (onlyRe && !onlyRe.test(s)) return;
    const i = stepTimeInfo(s, r);
    if (i && !i.approx) sum += i.min;
  });
  return sum;
}

/* Шаги рецепта с бейджами времени и кнопкой таймера */
function stepsHtml(r) {
  let active = 0;
  const items = r.steps.map((s, i) => {
    const info = stepTimeInfo(s, r);
    if (info && !info.ahead) active += info.min;
    const badge = info
      ? (info.min >= 1
        ? `<button type="button" class="step-time${info.approx ? ' approx' : ''}" data-timer="${Math.round(info.min * 60)}" data-timer-label="${(r.n + ': шаг ' + (i + 1)).replace(/"/g, '&quot;')}" title="Запустить таймер">⏱ ${info.label}</button>`
        : `<span class="step-time${info.approx ? ' approx' : ''}${info.ahead ? ' ahead' : ''}">${info.ahead ? '🕘 ' : '⏱ '}${info.label}</span>`)
      : '';
    return `<li><span class="step-text">${s}</span>${badge}</li>`;
  }).join('');
  const sum = Math.round(active);
  return `<div class="m-steps-head">
      <span>Общее время по рецепту: <b>${fmtMin(r.t)}</b></span>
      ${sum ? `<span>по шагам ≈ <b>${fmtMin(sum)}</b></span>` : ''}
    </div>
    <ol class="m-steps m-steps-timed">${items}</ol>
    <p class="m-steps-note">⏱ — время из рецепта, нажмите, чтобы запустить таймер. «≈» — ориентир,
    если в шаге время не указано. 🕘 «заранее» — шаг делается до начала готовки.</p>`;
}

/* ---------- таймеры ----------
   Несколько таймеров сразу (например, гречка и котлеты). Живут, пока
   открыта страница; по окончании — вибрация, короткий сигнал и надпись. */
const CookTimers = (function () {
  const list = [];
  let box = null, tick = null;

  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.className = 'cook-timers';
    document.body.appendChild(box);
    box.addEventListener('click', e => {
      const x = e.target.closest('[data-timer-stop]');
      if (!x) return;
      const i = list.findIndex(t => t.id === +x.dataset.timerStop);
      if (i !== -1) list.splice(i, 1);
      render();
    });
    return box;
  }
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      [0, 0.35, 0.7].forEach(off => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.18, ctx.currentTime + off);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + off + 0.3);
        o.start(ctx.currentTime + off); o.stop(ctx.currentTime + off + 0.3);
      });
    } catch (e) { /* звук недоступен — ничего страшного */ }
  }
  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  function render() {
    ensureBox();
    const now = Date.now();
    box.innerHTML = list.map(t => {
      const left = (t.end - now) / 1000;
      return `<div class="cook-timer${left <= 0 ? ' done' : ''}">
        <span class="ct-label">${t.label}</span>
        <b>${left <= 0 ? 'Готово!' : fmt(left)}</b>
        <button type="button" data-timer-stop="${t.id}" aria-label="Убрать таймер">×</button>
      </div>`;
    }).join('');
    box.hidden = !list.length;
    if (!list.length && tick) { clearInterval(tick); tick = null; }
  }
  function loop() {
    const now = Date.now();
    list.forEach(t => {
      if (!t.rang && t.end <= now) {
        t.rang = true;
        beep();
        if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
      }
    });
    render();
  }
  function start(seconds, label) {
    if (!(seconds > 0)) return;
    list.push({ id: Date.now() + Math.random(), end: Date.now() + seconds * 1000, label, rang: false });
    render();
    if (!tick) tick = setInterval(loop, 1000);
  }
  /* клик по бейджу времени в любом месте страницы */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-timer]');
    if (!b) return;
    e.preventDefault();
    start(+b.dataset.timer, b.dataset.timerLabel || 'Таймер');
    b.classList.add('started');
    setTimeout(() => b.classList.remove('started'), 900);
  });
  return { start };
})();
