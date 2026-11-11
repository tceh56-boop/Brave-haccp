/* ==========================================================================
   ЦЕХ Стандарт — экраны модулей подписки, охраны труда, договоров, AI и базы ТТК.
   Встраивается в конец Console.html (tools/inject_ts_console.py). Опирается на
   помощники главного окна: VIEWS, openView, vCall, vCard, vTable, vForm, vV, vMsg, vBody, vChip.
   Ограничения тарифа на экране — подсказка; запрещает шлюз сервера (_tsPlanGate_).
   ========================================================================== */
var TS = { plan: null, chat: [] };
var TS_NAV = [
  ['tsLabor', 'Охрана труда и нормативы', 'labor_safety', '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>'],
  ['tsContracts', 'Договоры', 'contracts', '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>'],
  ['tsTtkLib', 'База ТТК', 'ttk_library', '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M9 7h6"/>'],
  ['tsAi', 'ЦЕХ AI', 'ai', '<rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9.5 15h5"/>'],
  ['tsNow', 'Сейчас (смена)', 'journals', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
  ['tsSetup', 'Настройка и готовность', '', '<path d="M4 6h16M4 12h10M4 18h6"/><circle cx="18" cy="16" r="3"/>'],
  ['tsGen', 'ТТК → ТУ / СТО / ППК', 'ppk', '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5M15 3v4h4"/>'],
  ['tsData', 'Данные и сверка', '', '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>'],
  ['tsPlan', 'Подписка', '', '<path d="M3 7h18v10H3z"/><path d="M3 10h18M7 14h4"/>']
];
function tsHas(f) { return !f || !TS.plan || !TS.plan.features || TS.plan.features[f] === true; }
function tsPlanName(code) { var p = (TS.plan && TS.plan.plans || []).filter(function (x) { return x.code === code; })[0]; return p ? p.name : code; }
function tsMinPlan(f) { var ps = TS.plan && TS.plan.plans || []; for (var i = 0; i < ps.length; i++) if (ps[i].features.indexOf(TS.plan.featureNames[f]) >= 0) return ps[i].name; return 'Pro Max'; }
function tsUpgradeCard(what, plan) {
  return '<div class="card noacc"><div class="nac">ТАРИФ</div><h2>' + esc(what) + '</h2><p>Раздел входит в тариф <b>' + esc(plan) + '</b> и выше. Ваш тариф — <b>' +
    esc(TS.plan ? TS.plan.planName : '') + '</b>.</p><button class="btn pri" onclick="openView(\'tsPlan\')">Тарифы и подписка</button></div>';
}
function tsPrint(html, title) {
  var w = window.open('', '_blank'); if (!w) { alert('Разрешите всплывающие окна для печати'); return; }
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title || 'Документ') + '</title><style>body{font:13px/1.5 Arial,sans-serif;margin:24px;color:#111}pre{white-space:pre-wrap;font:inherit}</style></head><body>' + html + '<script>setTimeout(function(){print()},300)<\/script></body></html>');
  w.document.close();
}

/* ---------- меню: плашка тарифа, новые пункты, замки на разделах ---------- */
(function () {
  var baseBuild = buildNav, baseOpenSec = openSec;
  buildNav = function () {
    baseBuild();
    if (ACC) { ACC.modules = ACC.modules || {}; TS_NAV.forEach(function (n) { ACC.modules[n[0]] = true; }); }
    tsDecorate();
    run('tsGetPlanInfo', [TOKEN], function (r) { r = vJ(r); if (r && r.success) { TS.plan = r.data; tsDecorate(); } }, function () {});
  };
  openSec = function (sec, g) {
    var lock = TS.plan && TS.plan.lockedSections && TS.plan.lockedSections[sec];
    if (lock) {
      VIEW = null; CUR = sec;
      [].forEach.call(document.querySelectorAll('#nav button'), function (b) { b.classList.toggle('on', b.getAttribute('data-s') === sec); });
      var nm = (SECTIONS.filter(function (s) { return s[0] === sec; })[0] || [sec, sec])[1];
      document.getElementById('content').innerHTML = tsUpgradeCard(nm, tsPlanName(lock)); return;
    }
    return baseOpenSec(sec, g);
  };
})();
function tsDecorate() {
  var n = document.getElementById('nav'); if (!n) return;
  [].forEach.call(n.querySelectorAll('[data-ts]'), function (b) { b.remove(); });
  var h = '';
  TS_NAV.forEach(function (x) {
    h += '<button data-ts="' + x[0] + '"' + (tsHas(x[2]) ? '' : ' class="ts-plan-lock"') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + x[3] + '</svg>' + x[1] +
      (tsHas(x[2]) ? '' : '<span class="ts-lock">' + esc(tsMinPlan(x[2])) + '</span>') + '</button>';
  });
  n.insertAdjacentHTML('beforeend', h);
  if (TS.plan && TS.plan.lockedSections) [].forEach.call(n.querySelectorAll('button[data-s]'), function (b) {
    var l = TS.plan.lockedSections[b.getAttribute('data-s')]; if (l && !b.querySelector('.ts-lock')) { b.classList.add('ts-plan-lock'); b.insertAdjacentHTML('beforeend', '<span class="ts-lock">' + esc(tsPlanName(l)) + '</span>'); }
  });
  var side = document.querySelector('.side'), old = document.getElementById('tsPlanBadge'); if (old) old.remove();
  if (side && TS.plan) {
    var p = TS.plan, warn = p.mode === 'readonly' || (p.daysLeft !== null && p.daysLeft <= 7);
    var sub = p.status === 'TRIAL' ? 'Пробный период · осталось ' + p.daysLeft + ' дн.' : p.mode === 'readonly' ? 'Только просмотр' : p.expiresAt ? 'до ' + p.expiresAt + (p.daysLeft !== null && p.daysLeft <= 14 ? ' · ' + p.daysLeft + ' дн.' : '') : '';
    side.querySelector('.brand').insertAdjacentHTML('afterend', '<div id="tsPlanBadge" class="ts-plan' + (warn ? ' warn' : '') + '" onclick="openView(\'tsPlan\')"><b>Тариф ' + esc(p.planName) + '</b>' + esc(sub) + '</div>');
  }
  if (!n.__tsClick) {
    n.__tsClick = true;
    n.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-ts]'); if (!b) return;
      e.stopImmediatePropagation(); document.body.classList.remove('menu');
      [].forEach.call(n.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
      openView(b.getAttribute('data-ts')); b.classList.add('on');
    }, true);
  }
}

/* ---------- Подписка ---------- */
VIEWS.tsPlan = {
  title: 'Подписка', sub: 'Тариф, срок действия, ключ лицензии ЦЕХ Стандарт',
  open: function () { this.h.load(); },
  h: {
    load: function () {
      vCall('tsGetPlanInfo', [TOKEN]).then(function (r) {
        var e = vErr(r); if (e) { vMsg(e, 'err'); vBody(''); return; }
        var p = TS.plan = vData(r); tsDecorate();
        var st = { ACTIVE: 'активна', TRIAL: 'пробный период', EXPIRED: 'истекла', BLOCKED: 'заблокирована', NO_LICENSE: 'нет лицензии', UNVERIFIED: 'не подтверждена', OFFLINE: 'нет связи' }[p.status] || p.status;
        var h = vKpis([['Тариф', p.planName, 'gold'], ['Статус', st, p.mode === 'readonly' ? 'red' : 'green'], ['Действует до', p.expiresAt || '—'], ['Осталось дней', p.daysLeft === null ? '—' : p.daysLeft]]);
        if (p.message) h += '<div class="' + (p.mode === 'readonly' ? 'err' : 'ttnote') + '" style="margin-bottom:14px;border-radius:12px">' + esc(p.message) + '</div>';
        (p.notices || []).forEach(function (n) { h += '<div class="ttnote" style="margin-bottom:10px;border-radius:12px">' + esc(n.text || n) + '</div>'; });
        h += '<div class="pwdays">' + p.plans.map(function (x) {
          return '<div class="pwday' + (x.code === p.plan ? ' today' : '') + '"><div class="pwdh"><b>' + esc(x.name) + '</b>' + (x.code === p.plan ? vChip('ваш тариф', 'g') : '') + '</div>' +
            x.features.map(function (f) { return '<div style="font-size:13px;padding:2px 0">✓ ' + esc(f) + '</div>'; }).join('') + '</div>';
        }).join('') + '</div><div class="rdnote">Каждый тариф включает всё из предыдущего. Сменить тариф или продлить подписку — через вашего менеджера ЦЕХ Стандарт; изменения приходят автоматически при следующей проверке лицензии.</div>';
        if (p.canManage) h += vCard('Ключ лицензии', '<div class="rdnote">Текущий ключ: <b>' + esc(p.keyMasked || 'не введён') + '</b>' + (p.adminUrl ? ' · админ-панель подключена' : '') + '</div>' +
          vForm([['key', 'Ключ лицензии', 'text', '', 'TS-XXXX-XXXX-XXXX'], ['secret', 'Секрет лицензии', 'password', '', 'из письма поставщика'], ['url', 'Адрес админ-панели', 'text', p.adminUrl || '', 'https://script.google.com/macros/s/…/exec']]) +
          '<div class="mvbar"><button class="btn pri" data-mv="activate">Подключить</button><button class="btn" data-mv="refresh">Проверить сейчас</button></div>');
        if ((p.supportRequests || []).length && p.canManage) h += vCard('Запрос доступа поддержки ЦЕХ Стандарт', (p.supportRequests || []).map(function (q) {
          return '<p><b>' + esc(q.reason) + '</b> — на ' + esc(q.minutes) + ' мин., запросил ' + esc(q.requestedBy) + '. Поддержка получит доступ только после вашего разрешения; решение записывается в журнал аудита.</p><div class="mvbar">' +
            '<button class="btn pri" data-mv="consent" data-a="' + esc(q.sessionId) + '|1">Разрешить</button><button class="btn" data-mv="consent" data-a="' + esc(q.sessionId) + '|0">Отказать</button></div>'; }).join(''));
        if (p.supportUntil && p.supportUntil > Date.now()) h += '<div class="ttnote" style="margin-bottom:10px;border-radius:12px">Доступ поддержки разрешён до ' + esc(new Date(p.supportUntil).toLocaleString('ru-RU')) + '.</div>';
        h += vCard('Написать в поддержку', vForm([['supSubj', 'Тема', 'text'], ['supText', 'Вопрос', 'textarea', '', 'Опишите, что происходит. Не указывайте персональные данные сотрудников.']]) + '<div class="mvbar"><button class="btn" data-mv="support">Отправить</button></div>');
        h += '<div class="rdnote" style="margin-top:12px">Версия ЦЕХ Стандарт ' + esc(p.version) + (p.enterpriseId ? ' · предприятие ' + esc(p.enterpriseId) : '') + (p.channel === 'pilot' ? ' · пилотный канал обновлений' : '') + '</div>';
        vBody(h);
      }, function (e) { vMsg(String(e), 'err'); });
    },
    activate: function (a, btn) { vDo(btn, 'tsActivateLicense', [TOKEN, vV('key'), vV('url'), vV('secret')], 'Лицензия подключена', function () { VIEWS.tsPlan.h.load(); }); },
    refresh: function (a, btn) { vDo(btn, 'tsRefreshLicense', [TOKEN], function (d) { return 'Проверено: ' + d.status; }, function () { VIEWS.tsPlan.h.load(); }); },
    consent: function (a, btn) { var x = a.split('|'); vDo(btn, 'tsSupportConsent', [TOKEN, x[0], x[1] === '1'], x[1] === '1' ? 'Доступ разрешён' : 'В доступе отказано', function () { VIEWS.tsPlan.h.load(); }); },
    support: function (a, btn) { vDo(btn, 'tsSupportRequest', [TOKEN, vV('supSubj'), vV('supText')], function (d) { return 'Обращение ' + d.ticketId + ' отправлено'; }); }
  }
};

/* ---------- Охрана труда и нормативы ---------- */
var TS_LS = { tab: 'norms', data: null, q: '' };
VIEWS.tsLabor = {
  title: 'Охрана труда и нормативы', sub: 'ГОСТ, СанПиН, ТР ТС, охрана и условия труда, должностные инструкции, акты',
  open: function () { this.h.load(); },
  h: {
    load: function () {
      vCall('tsLsGetAll', [TOKEN]).then(function (r) { var e = vErr(r); if (e) { vMsg(e, 'err'); vBody(''); return; } TS_LS.data = vData(r); VIEWS.tsLabor.h.draw(); }, function (e) { vMsg(String(e), 'err'); });
    },
    tab: function (t) { TS_LS.tab = t; VIEWS.tsLabor.h.draw(); },
    draw: function () {
      var d = TS_LS.data, t = TS_LS.tab;
      var tabs = [['norms', 'Нормативы'], ['ot', 'Инструкции по ОТ'], ['jobs', 'Должностные'], ['haccp', 'Инструкции ХАССП'], ['brief', 'Инструктажи'], ['sout', 'СОУТ'], ['ppe', 'СИЗ'], ['acts', 'Акты']];
      var h = '';
      if (d.alerts.length) h += vCard('Сроки', vTable([{ k: 'kind', l: 'Что' }, { k: 'what', l: 'Кто / где' }, { k: 'due', l: 'Срок', t: 'date' }, { l: 'Состояние', html: true, f: function (x) { return x.overdue ? vChip('просрочено', 'r') : vChip('скоро', 'a'); } }], d.alerts));
      h += '<div class="tabs" style="margin:6px 0 12px">' + tabs.map(function (x) { return '<button class="' + (x[0] === t ? 'on' : '') + '" data-mv="tab" data-a="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
      var body = '';
      if (t === 'norms') {
        var groups = {}; d.norms.forEach(function (n) { (groups[n['Группа']] = groups[n['Группа']] || []).push(n); });
        body = '<div class="rdnote">Статус «ПРОВЕРИТЬ» — редакцию документа нужно сверить с первоисточником (КонсультантПлюс, Гарант, pravo.gov.ru) и отметить «Действует». Система нормы не выдумывает.</div>' +
          Object.keys(groups).map(function (g) {
            return vCard(g + ' · ' + groups[g].length, vTable([{ k: 'Документ', l: 'Документ' }, { k: 'Название', l: 'Название' }, { k: 'Что требует', l: 'Что требует' }, { k: 'Где в системе', l: 'Где в системе' },
              { l: 'Статус', html: true, f: function (x) { return vChip(x['Статус'], x['Статус'] === 'ДЕЙСТВУЕТ' ? 'g' : x['Статус'] === 'УТРАТИЛ СИЛУ' ? 'r' : 'a') + (x['Проверил'] ? '<div class="rdnote">' + esc(x['Проверил']) + ', ' + esc(x['Дата проверки']) + '</div>' : ''); } }],
              groups[g], function (x) { return x['Статус'] !== 'ДЕЙСТВУЕТ' ? vBtn('Действует', 'verify', x['Код']) : ''; }));
          }).join('');
      } else if (t === 'ot' || t === 'jobs') {
        var list = d[t];
        body = vCard(t === 'ot' ? 'Инструкции по охране труда' : 'Должностные инструкции', vTable([{ k: 'code', l: 'Код' }, { k: t === 'ot' ? 'who' : 'name', l: t === 'ot' ? 'Профессия / вид работ' : 'Должность' }, { k: 'ver', l: 'Версия' }, { k: 'approved', l: 'Утверждена' }],
          list, function (x) { return vBtn('Открыть', 'doc', t + '|' + x.code) + vBtn('Печать', 'docprint', t + '|' + x.code); }));
        body += '<div class="rdnote">Тексты — шаблоны (структура инструкций по ОТ — приказ Минтруда № 772н; должностные — профстандарт «Повар», № 113н). Перед применением утвердите приказом работодателя и укажите дату утверждения.</div>';
      } else if (t === 'haccp') {
        body = vCard('Санитарные инструкции ХАССП (34)', vTable([{ k: '№', l: '№' }, { k: 'Раздел', l: 'Раздел' }, { k: 'Название', l: 'Название' }, { k: 'Файл на Диске', l: 'Файл на Диске' }], d.haccp));
      } else if (t === 'brief') {
        body = vCard('Записать инструктаж', vForm([['Дата', 'Дата *', 'date', vIso()], ['Сотрудник', 'Сотрудник *', 'text'], ['Должность', 'Должность', 'text'],
          ['Вид', 'Вид *', 'select', 'Первичный', ['Вводный', 'Первичный', 'Повторный', 'Внеплановый', 'Целевой', 'Пожарный']], ['Инструкции', 'Инструкции (коды)', 'text', '', 'ИОТ-01, ИОТ-05'], ['Провёл', 'Провёл', 'text'],
          ['Следующий до', 'Следующий до (для повторного — +6 мес. сам)', 'date'], ['Комментарий', 'Комментарий', 'text']]) + '<div class="mvbar"><button class="btn pri" data-mv="save" data-a="brief">Записать</button></div>') +
          vCard('Журнал инструктажей', vTable([{ k: 'Дата', l: 'Дата', t: 'date' }, { k: 'Сотрудник', l: 'Сотрудник' }, { k: 'Должность', l: 'Должность' }, { k: 'Вид', l: 'Вид' }, { k: 'Инструкции', l: 'Инструкции' }, { k: 'Провёл', l: 'Провёл' }, { k: 'Следующий до', l: 'Следующий до', t: 'date' }], d.briefings));
      } else if (t === 'sout') {
        body = vCard('Рабочее место (отчёт СОУТ)', vForm([['Рабочее место', 'Рабочее место *', 'text', '', 'Горячий цех, повар'], ['Должности', 'Должности', 'text'], ['Работников', 'Работников', 'number'],
          ['Класс условий', 'Класс условий *', 'select', '2', ['1', '2', '3.1', '3.2', '3.3', '3.4', '4']], ['Вредные факторы', 'Вредные факторы', 'text', '', 'микроклимат, тяжесть'], ['Дата отчёта', 'Дата отчёта *', 'date'],
          ['Действует до', 'Действует до (+5 лет сам)', 'date'], ['Гарантии и компенсации', 'Гарантии и компенсации', 'text'], ['Рекомендации', 'Рекомендации', 'textarea']]) + '<div class="mvbar"><button class="btn pri" data-mv="save" data-a="sout">Сохранить</button></div>') +
          vCard('Реестр СОУТ', vTable([{ k: 'Рабочее место', l: 'Рабочее место' }, { k: 'Класс условий', l: 'Класс' }, { k: 'Работников', l: 'Работников' }, { k: 'Вредные факторы', l: 'Факторы' }, { k: 'Дата отчёта', l: 'Отчёт', t: 'date' }, { k: 'Действует до', l: 'Действует до', t: 'date' }], d.sout));
      } else if (t === 'ppe') {
        body = vCard('Выдача СИЗ', vForm([['Сотрудник', 'Сотрудник *', 'text'], ['Должность', 'Должность', 'text'], ['СИЗ', 'СИЗ *', 'text', '', 'Костюм для защиты от общих загрязнений'], ['Количество', 'Количество', 'number', 1],
          ['Выдано', 'Выдано *', 'date', vIso()], ['Срок носки, мес', 'Срок носки, мес', 'number', 12], ['Основание', 'Основание', 'text', 'Нормы выдачи СИЗ (приказ № 767н), локальные нормы']]) + '<div class="mvbar"><button class="btn pri" data-mv="save" data-a="ppe">Записать</button></div>') +
          vCard('Выдано', vTable([{ k: 'Сотрудник', l: 'Сотрудник' }, { k: 'СИЗ', l: 'СИЗ' }, { k: 'Количество', l: 'Кол-во', t: 'num' }, { k: 'Выдано', l: 'Выдано', t: 'date' }, { k: 'Следующая выдача', l: 'Следующая', t: 'date' }], d.ppe));
      } else if (t === 'acts') {
        body = vCard('Составить акт', '<div class="bqf mvf"><div class="mvwide"><label>Вид акта</label><select id="tsActType" onchange="VIEWS.tsLabor.h.actForm()">' + d.actTypes.map(function (a) { return '<option value="' + a.code + '">' + esc(a.name) + '</option>'; }).join('') + '</select></div></div><div id="tsActForm"></div>') +
          vCard('Составленные акты', vTable([{ k: 'no', l: 'Номер' }, { k: 'kind', l: 'Вид' }, { k: 'date', l: 'Дата', t: 'date' }, { k: 'who', l: 'Составил' }], d.actsIssued, function (x) { return vBtn('Печать', 'actprint', x.no); }));
      }
      vBody(h + body);
      if (t === 'acts') VIEWS.tsLabor.h.actForm();
    },
    actForm: function () {
      var c = document.getElementById('tsActType').value, a = TS_LS.data.actTypes.filter(function (x) { return x.code === c; })[0];
      document.getElementById('tsActForm').innerHTML = '<div class="rdnote">Основание: ' + esc(a.basis) + '</div>' + vForm(a.fields.map(function (f) { return ['act_' + f[0], f[1], f[2] || 'text']; })) +
        '<div class="mvbar"><button class="btn pri" data-mv="act">Сохранить и распечатать</button></div>';
    },
    act: function (x, btn) {
      var c = document.getElementById('tsActType').value, a = TS_LS.data.actTypes.filter(function (y) { return y.code === c; })[0], f = {};
      a.fields.forEach(function (x) { f[x[0]] = vV('act_' + x[0]); });
      vDo(btn, 'tsLsCreateAct', [TOKEN, c, f], function (d) { return 'Акт ' + d.no + ' сохранён'; }, function (d) { tsPrint(d.html, d.no); VIEWS.tsLabor.h.load(); });
    },
    actprint: function (no) { vCall('tsLsGetAct', [TOKEN, no]).then(function (r) { var e = vErr(r); if (e) { vMsg(e, 'err'); return; } tsPrint(vData(r).html, no); }); },
    save: function (kind, btn) {
      var heads = { brief: ['Дата', 'Сотрудник', 'Должность', 'Вид', 'Инструкции', 'Провёл', 'Следующий до', 'Комментарий'], sout: ['Рабочее место', 'Должности', 'Работников', 'Класс условий', 'Вредные факторы', 'Дата отчёта', 'Действует до', 'Гарантии и компенсации', 'Рекомендации'],
        ppe: ['Сотрудник', 'Должность', 'СИЗ', 'Количество', 'Выдано', 'Срок носки, мес', 'Основание'] }[kind], rec = {};
      heads.forEach(function (k) { rec[k] = vV(k); });
      vDo(btn, 'tsLsSaveRecord', [TOKEN, kind, rec], 'Записано', function () { VIEWS.tsLabor.h.load(); });
    },
    verify: function (code, btn) { vDo(btn, 'tsLsVerifyNorm', [TOKEN, code, 'ДЕЙСТВУЕТ', ''], 'Отмечено: действует', function () { VIEWS.tsLabor.h.load(); }); },
    doc: function (arg) {
      var p = arg.split('|');
      vCall('tsLsGetDoc', [TOKEN, p[0], p[1]]).then(function (r) {
        var e = vErr(r); if (e) { vMsg(e, 'err'); return; }
        var d = vData(r), row = d.row, keys = p[0] === 'ot' ? ['Профессия / вид работ', 'Название', 'Текст', 'Утверждена', 'Кем утверждена'] : ['Должность', 'Подчиняется', 'Требования', 'Обязанности', 'ХАССП', 'Охрана труда', 'Права', 'Ответственность', 'Утверждена'];
        var mdl = document.getElementById('mdl'), box = document.getElementById('mdlBox'); mdl.classList.remove('dish'); mdl.classList.add('on');
        box.innerHTML = '<button class="x" onclick="closeMdl()">×</button><h2>' + esc(row['Название'] || row['Должность']) + '</h2><div class="dsub">' + esc(row['Код']) + ' · версия ' + esc(row['Версия']) + ' · ' + esc(row['Основание'] || '') + '</div>' +
          '<div class="bqf mvf">' + keys.map(function (k) { var big = /Текст|Обязанности|Требования|ХАССП|Охрана|Права|Ответств/.test(k); return '<div class="' + (big ? 'mvwide' : '') + '"><label>' + esc(k) + '</label>' + (big ? '<textarea data-tsk="' + esc(k) + '" rows="' + (k === 'Текст' ? 18 : 4) + '">' + esc(row[k]) + '</textarea>' : '<input data-tsk="' + esc(k) + '" type="' + (k === 'Утверждена' ? 'date' : 'text') + '" value="' + esc(row[k]) + '">') + '</div>'; }).join('') + '</div>' +
          '<div class="mvbar"><button class="btn pri" id="tsDocSave">Сохранить новую версию</button><button class="btn" id="tsDocPrint">Печать</button></div><div id="tsDocMsg" class="bqmsg"></div>';
        document.getElementById('tsDocPrint').onclick = function () { VIEWS.tsLabor.h.docprint(arg); };
        document.getElementById('tsDocSave').onclick = function () {
          var rec = { 'Код': row['Код'] }; [].forEach.call(box.querySelectorAll('[data-tsk]'), function (el) { rec[el.getAttribute('data-tsk')] = el.value; });
          var m = document.getElementById('tsDocMsg'); m.textContent = 'Сохраняю…';
          vCall('tsLsSaveDoc', [TOKEN, p[0], rec]).then(function (r2) { var e2 = vErr(r2); m.className = 'bqmsg ' + (e2 ? 'err' : 'ok'); m.textContent = e2 || 'Сохранено, версия ' + vData(r2).version; if (!e2) VIEWS.tsLabor.h.load(); });
        };
      });
    },
    docprint: function (arg) {
      var p = arg.split('|');
      vCall('tsLsGetDoc', [TOKEN, p[0], p[1]]).then(function (r) {
        var e = vErr(r); if (e) { vMsg(e, 'err'); return; }
        var d = vData(r), row = d.row, org = d.org || '______________________';
        var head = '<table style="width:100%"><tr><td></td><td style="width:45%;font-size:12px">УТВЕРЖДАЮ<br>Руководитель ' + esc(org) + '<br>____________ /____________/<br>«___» __________ 20__ г.</td></tr></table>';
        var body = p[0] === 'ot' ? '<h2 style="text-align:center">' + esc(row['Название']) + '</h2><div style="text-align:center">' + esc(row['Код']) + '</div><pre>' + esc(row['Текст']) + '</pre>'
          : '<h2 style="text-align:center">ДОЛЖНОСТНАЯ ИНСТРУКЦИЯ<br>' + esc(row['Должность']) + '</h2>' + ['Подчиняется', 'Требования', 'Обязанности', 'ХАССП', 'Охрана труда', 'Права', 'Ответственность'].map(function (k, i) { return '<h3>' + (i + 1) + '. ' + esc(k === 'ХАССП' ? 'Обязанности по ХАССП и санитарии' : k === 'Охрана труда' ? 'Обязанности по охране труда' : k) + '</h3><p>' + esc(row[k]) + '</p>'; }).join('');
        tsPrint(head + body + '<p style="margin-top:30px">С инструкцией ознакомлен(а): ____________ /____________/ «___» ________ 20__ г.</p>', row['Код']);
      });
    }
  }
};

/* ---------- Договоры ---------- */
VIEWS.tsContracts = {
  title: 'Договоры', sub: 'Реестр договоров: поставщики, услуги, аренда, банкеты — со сроками и файлами',
  open: function () { if (!tsHas('contracts')) { vBody(tsUpgradeCard('Договоры', tsMinPlan('contracts'))); return; } this.h.load(); },
  h: {
    load: function () {
      vCall('tsContractsList', [TOKEN]).then(function (r) {
        var e = vErr(r); if (e) { vMsg(e, 'err'); vBody(''); return; }
        var d = vData(r); TS.ct = d;
        vBody(vKpis([['Договоров', d.rows.length], ['Истекают / истекли', d.expiring, d.expiring ? 'red' : 'green']]) +
          vCard('Новый договор', vForm([['Номер', 'Номер *', 'text'], ['Дата', 'Дата *', 'date', vIso()], ['Контрагент', 'Контрагент *', 'text'], ['ИНН', 'ИНН', 'text'],
            ['Вид', 'Вид *', 'select', d.kinds[0], d.kinds], ['Предмет', 'Предмет', 'text'], ['Сумма', 'Сумма, ₽', 'number'], ['Начало', 'Начало', 'date'], ['Окончание', 'Окончание', 'date'],
            ['Автопролонгация', 'Автопролонгация', 'select', 'нет', ['нет', 'да']], ['Ответственный', 'Ответственный', 'text'], ['Комментарий', 'Комментарий', 'textarea']]) +
            '<div class="mvbar"><button class="btn pri" data-mv="save">Сохранить</button></div>') +
          vCard('Реестр', vTable([{ k: 'Номер', l: 'Номер' }, { k: 'Дата', l: 'Дата', t: 'date' }, { k: 'Контрагент', l: 'Контрагент' }, { k: 'Вид', l: 'Вид' }, { k: 'Сумма', l: 'Сумма', t: 'num' }, { k: 'Окончание', l: 'Окончание', t: 'date' },
            { l: 'Состояние', html: true, f: function (x) { return vChip(x.state, x.state === 'ДЕЙСТВУЕТ' || x.state === 'ПРОДЛЁН АВТОМАТИЧЕСКИ' ? 'g' : x.state === 'ИСТЕКАЕТ' ? 'a' : 'r'); } },
            { l: 'Файл', html: true, f: function (x) { return x['Файл'] ? '<a class="dpath" target="_blank" href="' + esc(x['Файл']) + '">открыть</a>' : ''; } }],
            d.rows, function (x) { return vBtn('Файл', 'upload', x.ID); }, 'Договоров пока нет')));
      }, function (e) { vMsg(String(e), 'err'); });
    },
    save: function (a, btn) {
      var rec = {}; ['Номер', 'Дата', 'Контрагент', 'ИНН', 'Вид', 'Предмет', 'Сумма', 'Начало', 'Окончание', 'Автопролонгация', 'Ответственный', 'Комментарий'].forEach(function (k) { rec[k] = vV(k); });
      vDo(btn, 'tsContractSave', [TOKEN, rec], 'Договор сохранён', function () { VIEWS.tsContracts.h.load(); });
    },
    upload: function (id) {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf,image/*';
      inp.onchange = function () {
        var f = inp.files[0]; if (!f) return; var rd = new FileReader();
        rd.onload = function () { vDo(null, 'tsContractUpload', [TOKEN, id, rd.result, f.name], 'Файл прикреплён', function () { VIEWS.tsContracts.h.load(); }); };
        rd.readAsDataURL(f);
      };
      inp.click();
    }
  }
};

/* ---------- ЦЕХ AI ---------- */
VIEWS.tsAi = {
  title: 'ЦЕХ AI', sub: 'Ассистент технолога: ХАССП, СанПиН, охрана труда, ТТК. Ответ — совет; сверяйте с первоисточником.',
  open: function () { if (!tsHas('ai')) { vBody(tsUpgradeCard('AI-ассистент', tsMinPlan('ai'))); return; } this.h.draw(); },
  h: {
    draw: function () {
      var msgs = TS.chat.map(function (m) { return '<div style="margin:8px 0;padding:10px 14px;border-radius:14px;max-width:85%;white-space:pre-wrap;' + (m.role === 'user' ? 'margin-left:auto;background:var(--ts-grad);color:#fff' : 'background:#fff;border:1px solid var(--line)') + '">' + esc(m.text) + '</div>'; }).join('');
      vBody(vCard('Диалог', '<div id="tsChat" style="display:flex;flex-direction:column;min-height:120px">' + (msgs || '<div class="empty">Спросите, например: «Как правильно охладить бульон после варки?», «Какие инструктажи нужны новому повару?», «Что проверить при приёмке рыбы?»</div>') + '</div>' +
        vForm([['q', 'Вопрос', 'textarea', '', 'Ваш вопрос…', 3], ['ttk', 'Код ТТК для контекста (необязательно)', 'text']]) +
        '<div class="mvbar"><button class="btn pri" data-mv="ask">Спросить</button><button class="btn" data-mv="clear">Новый диалог</button></div>'));
    },
    ask: function (a, btn) {
      var q = vV('q'); if (!q) return;
      var hist = TS.chat.slice(-6); TS.chat.push({ role: 'user', text: q }); VIEWS.tsAi.h.draw();
      vDo(btn, 'tsAiAsk', [TOKEN, q, hist, vV('ttk')], 'Ответ получен', function (d) { TS.chat.push({ role: 'assistant', text: d.answer }); VIEWS.tsAi.h.draw(); });
    },
    clear: function () { TS.chat = []; VIEWS.tsAi.h.draw(); }
  }
};

/* ---------- База отработанных ТТК ---------- */
VIEWS.tsTtkLib = {
  title: 'База отработанных ТТК', sub: 'Проверенные технико-технологические карты ЦЕХ Стандарт — добавьте в свои ТТК в один клик',
  open: function () { if (!tsHas('ttk_library')) { vBody(tsUpgradeCard('База отработанных ТТК', tsMinPlan('ttk_library'))); return; } this.h.search(); },
  h: {
    search: function (a, btn, refresh) {
      var q = document.getElementById('mvf_lq') ? vV('lq') : '';
      vCall('tsTtkLibrary', [TOKEN, q, !!refresh]).then(function (r) {
        var e = vErr(r); if (e) { vMsg(e, 'err'); vBody(''); return; }
        var d = vData(r);
        if (d.sync && d.sync.error) vMsg(d.sync.error, 'err');
        vBody(vCard('Поиск', vForm([['lq', 'Название или категория', 'text', q]]) + '<div class="mvbar"><button class="btn pri" data-mv="search">Найти</button><button class="btn" data-mv="refresh">Обновить базу</button></div>' +
          '<div class="rdnote">В базе карт: ' + d.total + '. Категории: ' + Object.keys(d.categories).map(function (c) { return esc(c) + ' (' + d.categories[c] + ')'; }).join(', ') + '</div>') +
          vCard('Карты', vTable([{ k: 'name', l: 'Название' }, { k: 'category', l: 'Категория' }, { k: 'yield', l: 'Выход' }, { k: 'kcal', l: 'Ккал' }], d.items, function (x) { return vBtn('Открыть', 'card', x.id); }, 'Ничего не найдено')));
      }, function (e) { vMsg(String(e), 'err'); });
    },
    refresh: function (a, btn) { VIEWS.tsTtkLib.h.search(a, btn, true); },
    card: function (id) {
      vCall('tsTtkLibraryCard', [TOKEN, id]).then(function (r) {
        var e = vErr(r); if (e) { vMsg(e, 'err'); return; }
        var c = vData(r), mdl = document.getElementById('mdl'), box = document.getElementById('mdlBox'); mdl.classList.remove('dish'); mdl.classList.add('on');
        box.innerHTML = '<button class="x" onclick="closeMdl()">×</button><h2>' + esc(c.name) + '</h2><div class="dsub">' + esc(c.category || '') + ' · выход ' + esc(c.yield || '—') + ' г · ' + esc(c.source || '') + '</div>' +
          '<div class="kb"><div><b>' + esc(c.protein || '—') + '</b><small>Белки</small></div><div><b>' + esc(c.fat || '—') + '</b><small>Жиры</small></div><div><b>' + esc(c.carbs || '—') + '</b><small>Углеводы</small></div><div><b>' + esc(c.kcal || '—') + '</b><small>Ккал</small></div></div>' +
          '<h4>Состав</h4>' + vTable([{ k: 'name', l: 'Продукт' }, { k: 'brutto', l: 'Брутто', t: 'num' }, { k: 'netto', l: 'Нетто', t: 'num' }, { k: 'unit', l: 'Ед.' }], c.ingredients || []) +
          (c.method ? '<h4>Технология</h4><div class="dmeth">' + esc(c.method) + '</div>' : '') + (c.shelfLife || c.storage ? '<h4>Хранение</h4><div>' + esc([c.storage, c.shelfLife].filter(Boolean).join(' · ')) + '</div>' : '') +
          '<div class="mvbar"><button class="btn pri" id="tsLibAdd">Добавить в мои ТТК</button></div><div id="tsLibMsg" class="bqmsg"></div>';
        document.getElementById('tsLibAdd').onclick = function () {
          var m = document.getElementById('tsLibMsg'); m.textContent = 'Добавляю…';
          var json = JSON.stringify({ name: c.name, yield: c.yield, method: c.method, ingredients: (c.ingredients || []).map(function (x) { return { name: x.name, qty: x.brutto || x.netto, unit: x.unit || 'г' }; }) });
          vCall('createDish', [json, TOKEN]).then(function (r2) { var e2 = vErr(r2); m.className = 'bqmsg ' + (e2 ? 'err' : 'ok'); m.textContent = e2 || 'Карта добавлена в «Меню и ТТК». Проверьте и утвердите её.'; });
        };
      });
    }
  }
};


/* ==========================================================================
   ЦЕХ Стандарт 2.1 — «Сейчас»: экран повара. Только «Да / Нет» и разрешённые физические замеры.
   ========================================================================== */
var TS2N = { tasks: [] };
VIEWS.tsNow = {
  title: 'Сейчас', sub: 'Задачи смены: подтвердите «Да» или «Нет». Цифры вводятся только для замеров (холодильник, помещение, фритюр, лампа)',
  open: function () { this.h.load(); },
  h: {
    load: function () {
      vLoading();
      Promise.all([vCall('ts2Now', [TOKEN]), vCall('ts2Exceptions', [TOKEN])]).then(function (rs) {
        var e = vErr(rs[0]); if (e) { vMsg(e, 'err'); vBody(''); return; }
        var d = vData(rs[0]), x = vErr(rs[1]) ? { exceptions: [], overdue: [], autoToday: 0 } : vData(rs[1]); TS2N.tasks = d.tasks;
        if (!d.mode) { vBody(vCard('Режим «Готов к работе» не включён', '<p>Директор или ответственный за ХАССП включает его в разделе «Настройка и готовность» — система сама создаст документы, зоны, журналы и правила.</p><div class="mvbar"><button class="btn pri" onclick="openView(\'tsSetup\')">Открыть настройку</button></div>')); return; }
        var h = vKpis([['Задач сейчас', d.tasks.length, d.tasks.length ? 'gold' : 'green'], ['Просрочено', d.tasks.filter(function (t) { return t.overdue; }).length, 'red'], ['Отклонения', x.exceptions.length, x.exceptions.length ? 'red' : 'green'], ['Записей сделано системой сегодня', x.autoToday]]);
        if (d.mode === 'PILOT') h += '<div class="ttnote" style="margin-bottom:12px;border-radius:12px">Пилотный режим: записи помечаются «ПИЛОТ» и не идут в официальные журналы до протокола запуска.</div>';
        h += d.tasks.length ? d.tasks.map(function (t) {
          var head = '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b style="font-size:16px">' + esc(t.title) + '</b>' + vChip(t.overdue ? 'просрочено ' + t.due : 'до ' + t.due, t.overdue ? 'r' : 'a') + '</div>';
          var body;
          if (t.measure) {
            var m = t.measure, lim = m.min !== '' || m.max !== '' ? 'Норма: ' + (m.min !== '' ? 'от ' + m.min : '') + (m.max !== '' ? ' до ' + m.max : '') + ' ' + m.unit : '';
            body = '<div class="rdnote">' + esc(lim) + '</div><div class="bqf mvf"><div><label>' + (m.kind === 'FRYER' ? 'Состояние жира' : 'Значение, ' + esc(m.unit)) + '</label>' +
              (m.kind === 'FRYER' ? '<select id="ts2v_' + t.id + '"><option>годен</option><option>заменён</option><option>требует замены</option></select>' : '<input id="ts2v_' + t.id + '" type="number" step="0.1" inputmode="decimal" style="font-size:22px">') +
              '</div><div class="mvwide"><label>Комментарий (обязателен вне нормы)</label><input id="ts2c_' + t.id + '"></div></div><div class="mvbar"><button class="btn pri" data-mv="measure" data-a="' + t.id + '">Записать</button></div>';
          } else body = '<div class="mvbar"><button class="btn pri" style="min-width:120px;font-size:18px" data-mv="yes" data-a="' + t.id + '">Да</button><button class="btn" style="min-width:120px;font-size:18px" data-mv="no" data-a="' + t.id + '">Нет</button></div>';
          return '<div class="card" style="margin-bottom:10px">' + head + body + '</div>';
        }).join('') : vCard('Все задачи выполнены', '<p>Новых задач нет. Записи о выпуске, приёмке и вскрытии система делает сама.</p>');
        if (x.exceptions.length) h += vCard('Отклонения — нужно решение', vTable([{ k: 'createdAt', l: 'Когда' }, { k: 'value', l: 'Что случилось' }, { k: 'confirmedByEmployee', l: 'Кто' }], x.exceptions, function (r) { return vBtn('Устранено', 'resolve', r.autoRecordId); }));
        vBody(h);
      }, function (e) { vMsg(String(e), 'err'); });
    },
    yes: function (id, btn) { vDo(btn, 'ts2Confirm', [TOKEN, id, true, '', ''], 'Подтверждено', function () { VIEWS.tsNow.h.load(); }); },
    no: function (id, btn) {
      var r = prompt('Почему «Нет»? Например: не выполнено, оборудование неисправно, продукт не соответствует'); if (!r) return;
      vDo(btn, 'ts2Confirm', [TOKEN, id, false, r, ''], 'Записано отклонение — ответственный получит уведомление', function () { VIEWS.tsNow.h.load(); });
    },
    measure: function (id, btn) {
      var v = document.getElementById('ts2v_' + id).value, c = document.getElementById('ts2c_' + id).value;
      if (v === '') { vMsg('Введите значение', 'err'); return; }
      vDo(btn, 'ts2Measure', [TOKEN, id, v, c], function (d) { return d.result === 'FAIL' ? 'Вне нормы — записано отклонение' : 'Записано: ' + d.value + ' ' + d.unit; }, function () { VIEWS.tsNow.h.load(); });
    },
    resolve: function (id, btn) { var a = prompt('Корректирующее действие (что сделано):'); if (!a) return; vDo(btn, 'ts2ResolveException', [TOKEN, id, a], 'Отклонение закрыто', function () { VIEWS.tsNow.h.load(); }); }
  }
};

/* ---------- Настройка за 15 минут, очередь утверждения, готовность ---------- */
var TS2S = { st: null, step: 1 };
VIEWS.tsSetup = {
  title: 'Настройка и готовность', sub: 'Мастер из 7 шагов: система готовит документы, журналы и правила сама — вы подтверждаете только то, что знает предприятие',
  open: function () { this.h.load(); },
  h: {
    load: function () {
      vLoading();
      Promise.all([vCall('ts2Wizard', [TOKEN]), vCall('ts2ApprovalQueue', [TOKEN])]).then(function (rs) {
        var e = vErr(rs[0]); if (e) { vMsg(e, 'err'); vBody(''); return; }
        TS2S.st = vData(rs[0]); TS2S.q = vErr(rs[1]) ? { queue: [], documents: [] } : vData(rs[1]); VIEWS.tsSetup.h.draw();
      }, function (e) { vMsg(String(e), 'err'); });
    },
    go: function (n) { TS2S.step = Number(n); VIEWS.tsSetup.h.draw(); },
    draw: function () {
      var s = TS2S.st, n = TS2S.step, sm = s.summary;
      var steps = ['Организация', 'Тип предприятия', 'Цеха и зоны', 'Оборудование', 'Сотрудники', 'ТТК', 'Готовность'];
      var h = vKpis([['Создано автоматически', sm.created, 'green'], ['Требует решения', sm.requiresDecision, sm.requiresDecision ? 'gold' : 'green'], ['Объекты замеров', sm.numericObjects], ['Блокирующие проблемы', sm.blockers, sm.blockers ? 'red' : 'green']]);
      h += '<div class="tabs" style="margin:6px 0 12px">' + steps.map(function (x, i) { return '<button class="' + (i + 1 === n ? 'on' : '') + '" data-mv="go" data-a="' + (i + 1) + '">' + (i + 1) + '. ' + x + '</button>'; }).join('') + '</div>';
      var b = '';
      if (n === 1) b = vCard('Шаг 1. Организация', vForm([['name', 'Название', 'text', s.org.name], ['inn', 'ИНН', 'text', s.org.inn], ['actualAddress', 'Адрес площадки', 'text', s.org.address], ['responsibleName', 'Ответственный за ХАССП (ФИО)', 'text', s.org.responsible], ['tz', 'Часовой пояс', 'text', s.timezone]]) +
        '<div class="rdnote">' + (s.org.complete ? 'Реквизиты заполнены.' : 'Реквизиты нужны для документов. Полную карточку организации можно заполнить в «Организация».') + '</div><div class="mvbar"><button class="btn pri" data-mv="save1">Сохранить и дальше</button></div>');
      if (n === 2) b = vCard('Шаг 2. Тип предприятия и режим', vForm([['type', 'Тип предприятия', 'select', s.enterpriseType || 'RESTAURANT', Object.keys(s.types).map(function (k) { return [k, s.types[k]]; })],
        ['mode', 'Режим', 'select', s.mode || 'READY_TO_WORK', [['READY_TO_WORK', 'Готов к работе (рекомендуется)'], ['PILOT', 'Пилот — записи не идут в официальные журналы'], ['CUSTOM', 'Свои настройки']]]]) +
        '<div class="rdnote">При включении система создаст: 25 системных документов, 9 зон, роли и права, правила событий для ККТ и расписания журналов. Перед этим делается резервная копия.</div><div class="mvbar"><button class="btn pri" data-mv="save2">' + (s.mode ? 'Сохранить' : 'Включить «Готов к работе»') + '</button></div>');
      if (n === 3) b = vCard('Шаг 3. Цеха и зоны', s.workshops.length ? s.workshops.map(function (w) { return '<div class="bqf mvf" style="align-items:center"><div><label class="mvchk"><input type="checkbox" class="ts2ws" data-id="' + esc(w.workshopId) + '"' + (w.status === 'ACTIVE' ? ' checked' : '') + '> ' + esc(w.name) + '</label></div><div class="mvwide"><input placeholder="если не используется — причина" class="ts2wr" data-id="' + esc(w.workshopId) + '" value="' + esc(w.notApplicableReason || '') + '"></div></div>'; }).join('') +
        '<div class="mvbar"><button class="btn pri" data-mv="save3">Сохранить</button></div>' : '<p>Сначала выполните шаг 2.</p>');
      if (n === 4) b = vCard('Шаг 4. Оборудование для замеров', '<div class="rdnote">Здесь — только то, что измеряется физически. Диапазон берите из инструкции оборудования или условий хранения: система не подставляет числа сама.</div>' +
        vForm([['otype', 'Тип', 'select', 'FRIDGE', [['FRIDGE', 'Холодильник'], ['FREEZER', 'Морозильник'], ['ROOM', 'Помещение (t° и влажность)'], ['FRYER', 'Фритюрница'], ['UV_LAMP', 'Бактерицидная лампа']]], ['oname', 'Название', 'text', '', 'Холодильник мясной №1'],
          ['omin', 'Мин.', 'number'], ['omax', 'Макс.', 'number'], ['oset', 'Уставка', 'number'], ['otimes', 'Время проверок', 'text', '09:00,18:00']]) + '<div class="mvbar"><button class="btn pri" data-mv="save4">Добавить</button></div>' +
        vTable([{ k: 'name', l: 'Объект' }, { k: 'objectType', l: 'Тип' }, { k: 'minValue', l: 'Мин.' }, { k: 'maxValue', l: 'Макс.' }, { k: 'checkTimes', l: 'Проверки' }, { k: 'status', l: 'Статус' }], s.objects, null, 'Объектов пока нет'));
      if (n === 5) b = vCard('Шаг 5. Сотрудники', '<p>В системе сотрудников: <b>' + s.employees + '</b>. Добавить: Фамилия Имя;Роль;ПИН — по одному в строке.</p>' + vForm([['emps', 'Сотрудники', 'textarea', '', 'Иванова Анна;Повар горячего цеха;1234', 6]]) +
        '<div class="mvbar"><button class="btn pri" data-mv="save5">Добавить сотрудников</button><button class="btn" onclick="openSec(\'staff\')">Открыть раздел «Персонал»</button></div>');
      if (n === 6) b = vCard('Шаг 6. ТТК', '<p>В системе ТТК: <b>' + s.dishes + '</b>.</p>' + vForm([['ttk', 'Как начать', 'select', 'OWN', [['OWN', 'Загружу свои ТТК (файлы — в «Данные и сверка»)'], ['LIBRARY', 'Возьму из базы отработанных ТТК (Pro Max)'], ['LATER', 'Позже']]]]) +
        '<div class="mvbar"><button class="btn pri" data-mv="save6">Сохранить</button><button class="btn" onclick="openView(\'tsData\')">Загрузить файлы</button><button class="btn" onclick="openView(\'tsGen\')">ТТК → ТУ/СТО/ППК</button></div>');
      if (n === 7) b = vCard('Шаг 7. Проверка готовности', '<div id="ts2ready"><div class="mvbar"><button class="btn pri" data-mv="ready">Проверить готовность</button></div></div>');
      var q = (TS2S.q.queue || []).filter(function (x) { return x.status === 'PENDING'; });
      b += vCard('Ждут утверждения предприятием · ' + q.length, vTable([{ k: 'title', l: 'Документ' }, { k: 'reason', l: 'Почему' }, { k: 'requiredRole', l: 'Утверждает' }], q, function (r) { return (r.objectType === 'SYSTEM_DOCUMENT' ? vBtn('Открыть', 'sdoc', r.objectId) : '') + vBtn('Утвердить', 'approve', r.approvalId, true) + vBtn('Отклонить', 'reject', r.approvalId); }, 'Всё утверждено'));
      var docs = TS2S.q.documents || [];
      if (docs.length) b += vCard('Системные документы · ' + docs.length, '<div class="rdnote">Документ формируется из данных предприятия при первом открытии. Изменили данные (сотрудники, оборудование, ТТК) — нажмите «Обновить»: появится новая версия, утверждённый документ вернётся на утверждение.</div>' +
        vTable([{ k: 'templateId', l: 'Код' }, { k: 'title', l: 'Документ' }, { k: 'status', l: 'Статус' }, { k: 'approvedByEnterprise', l: 'Утвердил' }], docs, function (d) { return vBtn('Открыть', 'sdoc', d.documentId) + (d.fileId ? vBtn('Обновить', 'sdocr', d.documentId) : ''); }));
      vBody(h + b);
    },
    save: function (step, data, btn, next) { vDo(btn, 'ts2WizardSave', [TOKEN, step, data], 'Сохранено', function (d) { if (step === 5 && d && d.errors && d.errors.length) vMsg('Не добавлены: ' + d.errors.join('; '), 'err'); if (next) TS2S.step = next; VIEWS.tsSetup.h.load(); }); },
    save1: function (a, btn) { this.save(1, { org: { name: vV('name'), inn: vV('inn'), actualAddress: vV('actualAddress'), responsibleName: vV('responsibleName') }, timezone: vV('tz') }, btn, 2); },
    save2: function (a, btn) { this.save(2, { type: vV('type'), mode: vV('mode') }, btn, 3); },
    save3: function (a, btn) { var w = [].map.call(document.querySelectorAll('.ts2ws'), function (c) { return { workshopId: c.getAttribute('data-id'), active: c.checked, reason: document.querySelector('.ts2wr[data-id="' + c.getAttribute('data-id') + '"]').value }; }); this.save(3, { workshops: w }, btn, 4); },
    save4: function (a, btn) { this.save(4, { object: { objectType: vV('otype'), name: vV('oname'), minValue: vV('omin'), maxValue: vV('omax'), setpoint: vV('oset'), checkTimes: vV('otimes') } }, btn); },
    save5: function (a, btn) {
      var list = vV('emps').split('\n').map(function (l) { var p = l.split(';').map(function (x) { return x.trim(); }), fio = (p[0] || '').split(/\s+/); return p[0] ? { lastName: fio[0], firstName: fio[1] || '', middleName: fio[2] || '', role: p[1] || 'Повар горячего цеха', pin: p[2] || '' } : null; }).filter(Boolean);
      if (!list.length) { vMsg('Введите хотя бы одного сотрудника', 'err'); return; } this.save(5, { employees: list }, btn);
    },
    save6: function (a, btn) { this.save(6, { choice: vV('ttk') }, btn, 7); },
    ready: function (a, btn) {
      vDo(btn, 'ts2Readiness', [TOKEN], function (d) { return d.ready ? 'Готово к работе' : 'Выполнено ' + d.pass + ' из ' + d.total; }, function (d) {
        document.getElementById('ts2ready').innerHTML = vTable([{ k: 'title', l: 'Критерий' }, { l: 'Состояние', html: true, f: function (x) { return x.ok ? vChip('выполнено', 'g') : vChip('не выполнено', 'r'); } }], d.criteria) +
          '<div class="mvbar"><button class="btn" data-mv="protocol">Запросить протокол запуска у директора</button></div>';
      });
    },
    protocol: function (a, btn) { vDo(btn, 'ts2RequestLaunchProtocol', [TOKEN], 'Протокол запуска — в очереди утверждения', function () { VIEWS.tsSetup.h.load(); }); },
    sdoc: function (id, btn) { this.sdocGo(id, btn, false); },
    sdocr: function (id, btn) { this.sdocGo(id, btn, true); },
    sdocGo: function (id, btn, refresh) {
      var w = window.open('', '_blank');
      vDo(btn, 'ts2SystemDoc', [TOKEN, id, refresh], function (d) { return (d.changed ? 'Сформирована версия ' + d.version : 'Документ без изменений') + (d.gaps && d.gaps.length ? '. Не хватает данных: ' + d.gaps.join(', ') : ''); },
        function (d) { if (w) w.location = d.url; else window.open(d.url, '_blank'); VIEWS.tsSetup.h.load(); }).then(function (r) { if (!r && w) w.close(); });
    },
    approve: function (id, btn) { vDo(btn, 'ts2ApproveQueueItem', [TOKEN, id, true, ''], 'Утверждено', function () { VIEWS.tsSetup.h.load(); }); },
    reject: function (id, btn) { var c = prompt('Причина отклонения:'); if (!c) return; vDo(btn, 'ts2ApproveQueueItem', [TOKEN, id, false, c], 'Отклонено', function () { VIEWS.tsSetup.h.load(); }); }
  }
};

/* ---------- 2.2: ТТК → ТУ / СТО / ППК ---------- */
var TS2G = { list: null, card: null };
VIEWS.tsGen = {
  title: 'ТТК → ТУ / СТО / ППК', sub: 'Система готовит изменения документов из ТТК; у каждого значения — источник. Утверждает предприятие одной кнопкой',
  open: function () { this.h.load(); },
  h: {
    load: function () { vLoading(); vCall('ts2GenList', [TOKEN]).then(function (r) { var e = vErr(r); if (e) { vMsg(e, 'err'); vBody(''); return; } TS2G.list = vData(r); VIEWS.tsGen.h.draw(); }, function (e) { vMsg(String(e), 'err'); }); },
    draw: function () {
      var d = TS2G.list, h = vCard('Подготовить документы по ТТК', vForm([['ttk', 'ТТК', 'select', '', d.dishes.map(function (x) { return [x.code, x.name + ' (' + x.code + ')']; })]]) + '<div class="mvbar"><button class="btn pri" data-mv="preview">Предпросмотр</button></div>');
      h += vCard('Пакеты', vTable([{ k: 'at', l: 'Когда' }, { k: 'name', l: 'ТТК' }, { k: 'types', l: 'Документы' }, { k: 'status', l: 'Статус' }, { k: 'issues', l: 'Проблем', t: 'num' }], d.jobs, function (j) { return vBtn('Открыть', 'card', j.id); }, 'Пакетов пока нет'));
      var docs = function (list, num) { return vTable([{ k: num, l: 'Номер' }, { k: 'title', l: 'Документ' }, { k: 'version', l: 'Версия' }, { k: 'status', l: 'Статус' }], list.map(function (x) { x.title = x.title || x.name; return x; }), function (x) { return x.fileId ? '<a class="btn" target="_blank" href="https://docs.google.com/document/d/' + esc(x.fileId) + '">Открыть</a>' : ''; }, 'Нет'); };
      h += vCard('ТУ', docs(d.tu, 'tuNumber')) + vCard('СТО', docs(d.sto, 'stoNumber')) + vCard('ППК', docs(d.ppk, 'changeType'));
      vBody(h);
    },
    preview: function (a, btn) { vDo(btn, 'ts2GenPreview', [TOKEN, vV('ttk'), []], function (c) { return c.existing ? 'Эта версия ТТК уже обработана — открыт существующий пакет' : 'Предпросмотр готов'; }, function (c) { TS2G.card = c; VIEWS.tsGen.h.showCard(); }); },
    card: function (id) { vCall('ts2GenCard', [TOKEN, id]).then(function (r) { var e = vErr(r); if (e) { vMsg(e, 'err'); return; } TS2G.card = vData(r); VIEWS.tsGen.h.showCard(); }); },
    showCard: function () {
      var c = TS2G.card, j = c.job;
      var h = vKpis([['ТТК', c.name], ['Статус', vRu(j.status)], ['Заполнено автоматически', c.counts.auto + ' из ' + c.counts.facts, 'green'], ['Требует решения', c.counts.issues, c.counts.blocking ? 'red' : 'gold']]);
      if (c.tuSkipped) h += '<div class="ttnote" style="margin-bottom:10px;border-radius:12px">ТУ создаются в тарифе Pro (лабораторные исследования). Подготовлены СТО и ППК.</div>';
      h += vCard('Процессы и ККТ', vTable([{ k: 'name', l: 'ККТ' }, { l: 'Критический предел', html: true, f: function (x) { return x.criticalLimit ? esc(x.criticalLimit) : vChip('нужен источник', 'r'); } }, { k: 'limitSource', l: 'Источник' }, { k: 'journalCode', l: 'Журнал' }], c.controls, null, 'ККТ не выявлены'));
      h += vCard('Опасности', vTable([{ k: 'process', l: 'Операция' }, { k: 'hazardType', l: 'Тип' }, { k: 'description', l: 'Опасность' }], c.hazards));
      h += vCard('Проблемы и конфликты', vTable([{ k: 'severity', l: 'Важность' }, { k: 'message', l: 'Что' }, { k: 'suggestedAction', l: 'Что сделать' }, { k: 'status', l: 'Статус' }], c.issues, function (i) { return i.status === 'OPEN' && i.severity !== 'BLOCKER' ? vBtn('Решено', 'resolve', i.issueId) : ''; }, 'Проблем нет'));
      h += vCard('Факты из ТТК', vTable([{ k: 'fieldCode', l: 'Поле' }, { k: 'normalizedValue', l: 'Значение' }, { k: 'sourceText', l: 'Источник' }, { k: 'confidence', l: 'Уверенность', t: 'num' }, { k: 'status', l: 'Статус' }], c.facts));
      h += '<div class="mvbar">' + (c.canApply ? '<button class="btn pri" data-mv="apply" data-a="' + j.generationJobId + '">Создать документы (Google Doc + PDF)</button>' : '') +
        (j.status === 'APPLIED' ? '<button class="btn pri" data-mv="approve" data-a="' + j.generationJobId + '"' + (c.canApprove ? '' : ' disabled title="Сначала решите блокирующие проблемы и конфликты"') + '>Утвердить пакет</button>' : '') +
        '<button class="btn" data-mv="load">‹ К списку</button></div>';
      vBody(h);
    },
    apply: function (id, btn) { vDo(btn, 'ts2GenApply', [TOKEN, id], 'Документы созданы — ждут утверждения', function (c) { TS2G.card = c; VIEWS.tsGen.h.showCard(); }); },
    approve: function (id, btn) { vDo(btn, 'ts2GenApprove', [TOKEN, id], 'Пакет утверждён, правила ККТ включены', function () { VIEWS.tsGen.h.card(id); }); },
    resolve: function (id, btn) { var r = prompt('Как решено (это попадёт в журнал аудита):'); if (!r) return; vDo(btn, 'ts2GenResolveIssue', [TOKEN, id, r], 'Отмечено', function () { VIEWS.tsGen.h.card(TS2G.card.job.generationJobId); }); }
  }
};

/* ---------- 2.0: данные — загрузка документов, сверка, миграция, резервные копии, аудит ---------- */
var TS2D = { tab: 'recon' };
VIEWS.tsData = {
  title: 'Данные и сверка', sub: 'Загрузка документов и ТТК, проверка данных, предложения исправлений, миграция, резервные копии и журнал аудита',
  open: function () { this.h.draw(); },
  h: {
    tab: function (t) { TS2D.tab = t; VIEWS.tsData.h.draw(); },
    draw: function () {
      var tabs = [['recon', 'Сверка'], ['import', 'Загрузка'], ['migr', 'Миграция'], ['backup', 'Резервные копии'], ['audit', 'Аудит']];
      vBody('<div class="tabs" style="margin:6px 0 12px">' + tabs.map(function (x) { return '<button class="' + (x[0] === TS2D.tab ? 'on' : '') + '" data-mv="tab" data-a="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div><div id="ts2d"><div class="loading"><div class="spin"></div>Загрузка…</div></div>');
      var box = function (h) { var b = document.getElementById('ts2d'); if (b) b.innerHTML = h; }, fail = function (r) { var e = vErr(r); if (e) { box('<div class="err">' + esc(e) + '</div>'); return true; } return false; };
      var t = TS2D.tab;
      if (t === 'recon') vCall('ts2Reconciliation', [TOKEN]).then(function (r) { if (fail(r)) return; var d = vData(r), open = d.issues.filter(function (i) { return i.status === 'OPEN'; });
        box(vKpis([['Блокирующие', open.filter(function (i) { return i.severity === 'BLOCKER'; }).length, 'red'], ['Критичные', open.filter(function (i) { return i.severity === 'CRITICAL'; }).length, 'red'], ['Прочие', open.length], ['Предложений', d.proposals.filter(function (p) { return p.status === 'PROPOSED'; }).length, 'gold']]) +
          '<div class="mvbar"><button class="btn pri" data-mv="recon">Запустить сверку</button><button class="btn" data-mv="applyAll">Применить согласованные</button></div>' +
          vCard('Проблемы', vTable([{ k: 'severity', l: 'Важность' }, { k: 'entityType', l: 'Область' }, { k: 'message', l: 'Что' }, { k: 'suggestedAction', l: 'Что сделать' }, { k: 'entityId', l: 'Объект' }], open, null, 'Проблем нет')) +
          vCard('Предложения исправлений', vTable([{ k: 'operationType', l: 'Действие' }, { k: 'entityId', l: 'Объект' }, { k: 'reason', l: 'Почему' }, { k: 'status', l: 'Статус' }], d.proposals, function (p) {
            return p.status === 'PROPOSED' ? vBtn('Согласовать', 'pok', p.changeProposalId, true) + vBtn('Отклонить', 'pno', p.changeProposalId) : p.status === 'APPLIED' && String(p.rollbackAvailable) === 'true' ? vBtn('Откатить', 'prb', p.changeProposalId) : ''; }, 'Предложений нет'))); });
      if (t === 'import') vCall('ts2Imports', [TOKEN]).then(function (r) { if (fail(r)) return; var jobs = vData(r);
        box(vCard('Загрузить файлы', '<div class="rdnote">ТТК, договоры, акты, сертификаты — PDF, фото, Word, Excel. Дубликаты (по контрольной сумме) не загружаются второй раз. Распознанное попадает на проверку — в рабочие таблицы ничего не пишется без вашего подтверждения.</div>' +
          '<input type="file" id="ts2files" multiple><div class="mvbar"><button class="btn pri" data-mv="upload">Загрузить и распознать</button></div>') +
          jobs.map(function (j) { return vCard(j.importJobId + ' · ' + vRu(j.status), vTable([{ k: 'sourceObjectName', l: 'Файл / объект' }, { k: 'sourceObjectType', l: 'Тип' }, { k: 'confidence', l: 'Уверенность', t: 'num' }, { k: 'status', l: 'Статус' }], j.items || [], function (i) { return i.status === 'READY_FOR_REVIEW' ? vBtn('Принять', 'iok', i.importItemId) + vBtn('Отклонить', 'ino', i.importItemId) : ''; }) +
            '<div class="mvbar">' + (j.status === 'QUEUED' || j.status === 'FAILED' ? vBtn('Распознать', 'proc', j.importJobId, true) : '') + (j.status === 'READY_FOR_REVIEW' || j.status === 'PARTIAL' || j.status === 'APPROVED' ? vBtn('Применить принятые', 'iapply', j.importJobId, true) : '') + '</div>'); }).join('')); });
      if (t === 'migr') Promise.all([vCall('ts2MigrationAnalyze', [TOKEN]), vCall('ts2MigrationPreview', [TOKEN])]).then(function (rs) { if (fail(rs[0])) return; var a = vData(rs[0]), p = vErr(rs[1]) ? [] : vData(rs[1]);
        box(vCard('Анализ', vTable([{ k: 'sheet', l: 'Лист' }, { k: 'rows', l: 'Строк', t: 'num' }, { k: 'mapped', l: 'Сопоставлено', t: 'num' }, { k: 'toMap', l: 'К сопоставлению', t: 'num' }, { k: 'duplicateKeys', l: 'Дубли ключей', t: 'num' }], a)) +
          vCard('Предпросмотр (первые 300)', vTable([{ k: 'sheet', l: 'Лист' }, { k: 'key', l: 'Ключ' }, { k: 'legacyValue', l: 'Значение' }, { k: 'conflict', l: 'Конфликт' }], p, null, 'Всё сопоставлено')) +
          vCard('Выполнить', '<div class="rdnote">Перед выполнением создаётся резервная копия. Старые листы не меняются — создаётся карта соответствия ID.</div>' + vForm([['confirm', 'Введите слово ВЫПОЛНИТЬ', 'text']]) + '<div class="mvbar"><button class="btn pri" data-mv="migrate">Выполнить миграцию</button></div>')); });
      if (t === 'backup') vCall('ts2Backups', [TOKEN]).then(function (r) { if (fail(r)) return;
        box('<div class="mvbar"><button class="btn pri" data-mv="backup">Создать резервную копию</button><button class="btn" data-mv="schema">Проверить структуру 2.0</button></div>' +
          vCard('Резервные копии', vTable([{ k: 'createdAt', l: 'Когда' }, { k: 'backupType', l: 'Тип' }, { k: 'scope', l: 'Что' }, { k: 'createdBy', l: 'Кто' }, { k: 'status', l: 'Статус' }], vData(r), function (b) { return b.fileUrl ? '<a class="btn" target="_blank" href="' + esc(b.fileUrl) + '">Открыть</a>' : ''; }, 'Копий пока нет'))); });
      if (t === 'audit') vCall('ts2VerifyAudit', [TOKEN]).then(function (r) { if (fail(r)) return; var d = vData(r);
        box(vCard('Целостность журнала аудита', d.broken.length ? '<div class="err">Цепочка нарушена в записях: ' + esc(d.broken.slice(0, 20).join(', ')) + '. Записи изменены вручную — сообщите ответственному.</div>' : '<p>' + vChip('цепочка не нарушена', 'g') + ' Проверено записей: ' + d.records + '. Каждая запись содержит хеш предыдущей — изменение задним числом обнаруживается.</p>')); });
    },
    recon: function (a, btn) { vDo(btn, 'ts2RunReconciliation', [TOKEN], function (d) { return 'Сверка выполнена: проблем ' + d.issues + ', новых предложений ' + d.proposals; }, function () { VIEWS.tsData.h.draw(); }); },
    pok: function (id, btn) { vDo(btn, 'ts2ApproveProposal', [TOKEN, id, true, ''], 'Согласовано', function () { VIEWS.tsData.h.draw(); }); },
    pno: function (id, btn) { var c = prompt('Причина:'); if (!c) return; vDo(btn, 'ts2ApproveProposal', [TOKEN, id, false, c], 'Отклонено', function () { VIEWS.tsData.h.draw(); }); },
    prb: function (id, btn) { if (!confirm('Откатить изменение?')) return; vDo(btn, 'ts2RollbackProposal', [TOKEN, id], 'Откатано', function () { VIEWS.tsData.h.draw(); }); },
    applyAll: function (a, btn) { vDo(btn, 'ts2ApplyProposals', [TOKEN, []], function (d) { return 'Применено: ' + ((d.applied || []).length) + (d.failed && d.failed.length ? ', ошибок: ' + d.failed.length : ''); }, function () { VIEWS.tsData.h.draw(); }); },
    upload: function (a, btn) {
      var fs = document.getElementById('ts2files').files; if (!fs.length) { vMsg('Выберите файлы', 'err'); return; }
      Promise.all([].map.call(fs, function (f) { return new Promise(function (ok) { var r = new FileReader(); r.onload = function () { ok({ name: f.name, dataUrl: r.result }); }; r.readAsDataURL(f); }); }))
        .then(function (files) { vDo(btn, 'ts2Upload', [TOKEN, files, ''], function (d) { return 'Загружено файлов: ' + (d.files || []).length; }, function () { VIEWS.tsData.h.draw(); }); });
    },
    proc: function (id, btn) { vDo(btn, 'ts2ProcessImport', [TOKEN, id], 'Распознано — проверьте результат', function () { VIEWS.tsData.h.draw(); }); },
    iok: function (id, btn) { vDo(btn, 'ts2ReviewImportItem', [TOKEN, id, 'APPROVED', null], 'Принято', function () { VIEWS.tsData.h.draw(); }); },
    ino: function (id, btn) { vDo(btn, 'ts2ReviewImportItem', [TOKEN, id, 'REJECTED', null], 'Отклонено', function () { VIEWS.tsData.h.draw(); }); },
    iapply: function (id, btn) { vDo(btn, 'ts2ApplyImport', [TOKEN, id], 'Применено (перед этим создана резервная копия)', function () { VIEWS.tsData.h.draw(); }); },
    migrate: function (a, btn) { vDo(btn, 'ts2MigrationExecute', [TOKEN, vV('confirm')], 'Миграция выполнена', function () { VIEWS.tsData.h.draw(); }); },
    backup: function (a, btn) { vDo(btn, 'ts2CreateBackup', [TOKEN], function (d) { return 'Создана копия ' + d.backupId; }, function () { VIEWS.tsData.h.draw(); }); },
    schema: function (a, btn) { vDo(btn, 'ts2InstallSchema', [TOKEN], function (d) { return 'Структура ' + d.schemaVersion + ': создано листов ' + d.sheetsCreated + ', проверено ' + d.sheetsVerified + ', папок ' + d.folders; }); }
  }
};
// статусы 2.x по-русски
(function () { var m = { PENDING_CONFIRMATION: 'ждёт подтверждения', CONFIRMED_BY_OPERATOR: 'подтверждено', AUTO_PREPARED: 'подготовлено системой', REQUIRES_ENTERPRISE_APPROVAL: 'ждёт утверждения',
  REQUIRES_SOURCE: 'нужен источник', REQUIRES_LOCAL_CONFIRMATION: 'подтвердите применимость', SYSTEM_APPROVED: 'утверждено поставщиком', ACTIVE_TEMPLATE: 'типовой шаблон', SUPERSEDED: 'заменено новой версией',
  PREVIEW: 'предпросмотр', APPLIED: 'применено', BLOCKER: 'блокирует', CRITICAL: 'критично', MAJOR: 'важно', MINOR: 'незначительно', CONFLICT: 'конфликт', READY_FOR_REVIEW: 'на проверку', QUEUED: 'в очереди',
  PROPOSED: 'предложено', ROLLED_BACK: 'откатано', NOT_APPLICABLE: 'не используется', PILOT: 'пилот', RESOLVED: 'устранено', FAILED: 'ошибка', PARTIAL: 'частично', INITIAL: 'первичная', TTK_ADDENDUM: 'дополнение по ТТК',
  ACCEPTED: 'принято', REQUIRES_CONFIRMATION: 'подтвердите', FRIDGE: 'холодильник', FREEZER: 'морозильник', ROOM: 'помещение', FRYER: 'фритюрница', UV_LAMP: 'бактерицидная лампа', MANUAL: 'вручную',
  PRE_UPDATE: 'перед обновлением', PRE_IMPORT: 'перед импортом', PRE_RECONCILIATION_APPLY: 'перед исправлениями', PRE_GENERATION: 'перед генерацией документов', PRE_RESTORE: 'перед откатом', DUPLICATE_KEY: 'дубль ключа' };
  if (typeof V_RU === 'object') Object.keys(m).forEach(function (k) { if (!V_RU[k]) V_RU[k] = m[k]; }); })();
