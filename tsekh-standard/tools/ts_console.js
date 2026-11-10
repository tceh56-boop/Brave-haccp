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
        h += '<div class="rdnote" style="margin-top:12px">Версия ЦЕХ Стандарт ' + esc(p.version) + '</div>';
        vBody(h);
      }, function (e) { vMsg(String(e), 'err'); });
    },
    activate: function (a, btn) { vDo(btn, 'tsActivateLicense', [TOKEN, vV('key'), vV('url'), vV('secret')], 'Лицензия подключена', function () { VIEWS.tsPlan.h.load(); }); },
    refresh: function (a, btn) { vDo(btn, 'tsRefreshLicense', [TOKEN], function (d) { return 'Проверено: ' + d.status; }, function () { VIEWS.tsPlan.h.load(); }); }
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
