/* ============================================================
   Страница «Информация» — форма сообщения об ошибке
   ------------------------------------------------------------
   Куда отправлять заявки: заполните нужное поле — и на странице
   появится кнопка отправки. Если оставить всё пустым, посетитель
   просто скопирует текст заявки и передаст его удобным способом.
   ============================================================ */
const SUPPORT = {
  email: 'ddass1477@gmail.com',
  telegram: 'https://t.me/tataralmet16',
  max: '',
};

(function () {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const LS_BUGS = 'menuplan_bugs_v1';

  let bugType = 'Ошибка в расчёте';
  let lastReport = null;

  /* ---------- отправка заявки к владельцу в базу ----------
     Если облако настроено (config.js) — заявка уходит прямо в базу,
     и человек видит честную галочку «доложено». Если нет — работает
     старый способ: готовый текст, который отправляют вручную. */
  const CLOUD = window.MENUPLAN_CLOUD && window.MENUPLAN_CLOUD.url && window.MENUPLAN_CLOUD.key;

  async function sendToServer(fields) {
    if (!CLOUD) return false;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), 15000);
    try {
      const res = await fetch(window.MENUPLAN_CLOUD.url.replace(/\/+$/, '') + '/rest/v1/bug_reports', {
        method: 'POST',
        headers: {
          apikey: window.MENUPLAN_CLOUD.key,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(fields),
        signal: ctrl ? ctrl.signal : undefined,
      });
      return res.ok;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- хранение ---------- */
  function loadBugs() {
    try { return JSON.parse(localStorage.getItem(LS_BUGS)) || []; } catch (e) { return []; }
  }
  function saveBugs(list) {
    try { localStorage.setItem(LS_BUGS, JSON.stringify(list.slice(-20))); } catch (e) { /* приватный режим */ }
  }

  function makeId() {
    return 'BUG-' + Math.random().toString(36).slice(2, 6).toUpperCase() +
      '-' + String(new Date().getDate()).padStart(2, '0') + String(new Date().getMonth() + 1).padStart(2, '0');
  }

  /* ---------- текст заявки ---------- */
  function buildReport(id) {
    const now = new Date();
    const date = now.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const where = $('#bugWhere').value.trim();
    const text = $('#bugText').value.trim();
    const steps = $('#bugSteps').value.trim();
    const contact = $('#bugContact').value.trim();

    let out = 'ЗАЯВКА ОБ ОШИБКЕ — ПланМеню\n';
    out += 'Номер: ' + id + '\n';
    out += 'Дата: ' + date + '\n';
    out += 'Тип: ' + bugType + '\n';
    if (where) out += 'Где: ' + where + '\n';
    out += '\nОписание:\n' + text + '\n';
    if (steps) out += '\nКак повторить:\n' + steps + '\n';
    if (contact) out += '\nКонтакт: ' + contact + '\n';
    out += '\n--- техническая информация ---\n';
    out += 'Страница: ' + location.href + '\n';
    out += 'Экран: ' + window.innerWidth + '×' + window.innerHeight + '\n';
    out += 'Браузер: ' + navigator.userAgent + '\n';
    return out;
  }

  /* ---------- подсказка со способом отправки ---------- */
  function sendHint(id) {
    const parts = [];
    if (SUPPORT.email) {
      const subj = encodeURIComponent('ПланМеню: ' + bugType + ' (' + id + ')');
      const body = encodeURIComponent(lastReport || '');
      parts.push(`<a class="btn btn-gold" href="mailto:${SUPPORT.email}?subject=${subj}&body=${body}">Отправить на почту</a>`);
    }
    if (SUPPORT.telegram) parts.push(`<a class="btn btn-ghost" href="${SUPPORT.telegram}" target="_blank" rel="noopener">Написать в Telegram</a>`);
    if (SUPPORT.max) parts.push(`<a class="btn btn-ghost" href="${SUPPORT.max}" target="_blank" rel="noopener">Написать в MAX</a>`);

    if (!parts.length) {
      return 'Скопируйте заявку кнопкой выше и отправьте её владельцу сайта любым удобным способом. ' +
        'Номер заявки <b>' + id + '</b> сохранён в вашем браузере — по нему можно вернуться к тексту.';
    }
    return '<span class="ab-send-row">' + parts.join('') + '</span>' +
      'Номер заявки <b>' + id + '</b> сохранён в вашем браузере.';
  }

  /* ---------- список сохранённых ---------- */
  function renderSaved() {
    const list = loadBugs();
    const box = $('#bugSaved');
    if (!list.length) { box.hidden = true; return; }
    box.hidden = false;
    $('#bugSavedList').innerHTML = list.slice().reverse().map(b => `
      <div class="ab-saved-item">
        <div>
          <b>${b.id}</b>
          <span>${b.type} · ${b.date}</span>
        </div>
        <div class="ab-saved-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-show="${b.id}">Показать</button>
          <button type="button" class="btn btn-ghost btn-sm" data-del="${b.id}">Удалить</button>
        </div>
      </div>`).join('');

    $$('#bugSavedList [data-show]').forEach(b => b.addEventListener('click', () => {
      const item = loadBugs().find(x => x.id === b.dataset.show);
      if (!item) return;
      lastReport = item.text;
      $('#bugPreview').textContent = item.text;
      $('#bugId').textContent = item.id;
      $('#bugSendHint').innerHTML = sendHint(item.id);
      $('#bugResult').hidden = false;
      $('#bugResult').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));

    $$('#bugSavedList [data-del]').forEach(b => b.addEventListener('click', () => {
      saveBugs(loadBugs().filter(x => x.id !== b.dataset.del));
      renderSaved();
    }));
  }

  /* ---------- инициализация ---------- */
  function init() {
    $$('#bugType .chip').forEach(b => b.addEventListener('click', () => {
      bugType = b.dataset.type;
      $$('#bugType .chip').forEach(x => x.classList.toggle('active', x === b));
    }));

    $('#bugForm').addEventListener('submit', async e => {
      e.preventDefault();
      const text = $('#bugText').value.trim();
      const field = $('#bugText');
      if (text.length < 10) {
        field.classList.add('invalid');
        $('#bugNote').innerHTML = '<b class="ab-error">Опишите проблему хотя бы одним предложением</b> — по строке «не работает» починить нельзя.';
        field.focus();
        return;
      }
      field.classList.remove('invalid');

      const id = makeId();
      lastReport = buildReport(id);

      const list = loadBugs();
      list.push({
        id, type: bugType, text: lastReport,
        date: new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      });
      saveBugs(list);

      const btn = $('#bugSubmit');
      const btnLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Отправляем…';

      /* пробуем доставить заявку прямо владельцу */
      const delivered = await sendToServer({
        type: bugType,
        where_at: $('#bugWhere').value.trim() || null,
        description: text,
        steps: $('#bugSteps').value.trim() || null,
        contact: $('#bugContact').value.trim() || null,
        page: location.href,
        screen: window.innerWidth + '×' + window.innerHeight,
        ua: navigator.userAgent,
      });

      btn.disabled = false;
      btn.textContent = btnLabel;

      $('#bugPreview').textContent = lastReport;
      $('#bugId').textContent = id;
      $('#bugResult').hidden = false;

      const ok = $('#bugOk');
      if (delivered) {
        /* заявка ушла в базу — показываем честную галочку */
        ok.hidden = false;
        ok.innerHTML = '<span class="ab-ok-mark">✓</span>' +
          '<span><b>Доложено об ошибке.</b> Спасибо! Мы получили вашу заявку' +
          ($('#bugContact').value.trim() ? ' и свяжемся с вами, если понадобятся детали.' : '. Если оставите контакт — сможем ответить.') +
          '</span>';
        $('#bugSendHint').innerHTML = 'Хотите продублировать напрямую? ' + sendHint(id);
        $('#bugNote').innerHTML = 'Номер заявки <b>' + id + '</b> сохранён в вашем браузере.';
      } else {
        /* база недоступна — старый способ, без ложной галочки */
        ok.hidden = true;
        $('#bugSendHint').innerHTML = sendHint(id);
        $('#bugNote').innerHTML = 'Заявка сформирована. Отправьте её кнопкой ниже или скопируйте текст.';
      }

      renderSaved();
      $('#bugResult').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    $('#bugClear').addEventListener('click', () => {
      ['#bugWhere', '#bugText', '#bugSteps', '#bugContact'].forEach(s => { $(s).value = ''; });
      $('#bugText').classList.remove('invalid');
      $('#bugResult').hidden = true;
      $('#bugNote').innerHTML = 'Заявка формируется прямо в браузере: вы получаете готовый текст ' +
        'и отправляете его удобным способом. Никакие данные никуда не уходят автоматически.';
    });

    $('#bugCopy').addEventListener('click', () => {
      if (!lastReport) return;
      navigator.clipboard.writeText(lastReport).then(() => {
        const b = $('#bugCopy'), t = b.textContent;
        b.textContent = '✓ Скопировано';
        setTimeout(() => { b.textContent = t; }, 1800);
      });
    });

    $('#bugDownload').addEventListener('click', () => {
      if (!lastReport) return;
      const blob = new Blob([lastReport], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = ($('#bugId').textContent || 'заявка') + '.txt';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });

    $('#bugEdit').addEventListener('click', () => {
      $('#bugResult').hidden = true;
      $('#bugText').focus();
    });

    renderSaved();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
