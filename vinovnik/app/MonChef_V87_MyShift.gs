/**
 * MonChef V87 — «Моя смена»: один список дел и единый итог операции (18.11.2026).
 *
 * Основание — повторный аудит R2, этапы 1 и 2 плана (решение владельца от 18.11.2026):
 *  1. «Моя смена» — одно место, где сотрудник видит всё, что ему нужно сделать за смену, без открытия журналов:
 *     вопросы журналов (J01–J38 — кто их ведёт), контроли ХАССП и задания кухни, здоровье на смену и осмотр, фритюр,
 *     бракераж, обработка яиц, проверка приборов, суточные пробы, просроченное на складе, продажи за смену.
 *     Каждая карточка: откуда задача, срок, кто делает, одна основная кнопка. Простые действия (ответ «да / нет»,
 *     значение контроля, «Готово», «Здоров», «Дописать») — прямо в карточке; сложные — открывают нужный экран.
 *     Разделы: просрочено · сделать сейчас · позже сегодня · ждёт решения другого · система уже сделала · требует действия.
 *  2. Итог операции: ключевые действия смены возвращают data.outcome = {status, message, completed, pending, blocked, next}
 *     — «сделано / ждёт / заблокировано / что дальше» вместо одной строки; отказ — тоже с итогом: записано ли что-то и что делать.
 *     Итоги сотрудника за день — лист «Итоги_Операций_V87» (для раздела «Система уже сделала» и «Требует действия»).
 * Система ничего не подставляет за человека: значение, оценка и решение — в карточке вводит сотрудник.
 */
var MC_V87_RES_ = 'Итоги_Операций_V87', MC_V87_RES_HEAD_ = ['Время', 'Дата', 'Сотрудник', 'Операция', 'Статус', 'Итог', 'Сделано', 'Ждёт', 'Заблокировано', 'Код', 'operation_id'];
var MC_V87_GROUPS_ = ['overdue', 'now', 'later', 'waiting', 'done', 'error', 'prep', 'expiry'];   // prep, expiry — заготовки и сроки годности (V88)
var MC_V87_RANK_ = { overdue: 0, error: 1, now: 2, prep: 3, expiry: 4, later: 5, waiting: 6, done: 7 };

function _v87Day_() { return Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd'); }
/** Минуты от полуночи: «HH:mm», дата из таблицы (время хранится как 30.12.1899) или та же дата строкой ISO / Date.toString после JSON. */
function _v87Min_(hm) {
  var v = hm;
  if (typeof v === 'string' && (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v) || /GMT/.test(v))) { var d = new Date(v); if (!isNaN(d.getTime())) v = d; }
  var m = String(v instanceof Date ? Utilities.formatDate(v, _mcTz_(), 'HH:mm') : v || '').match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function _v87NowMin_() { return _v87Min_(Utilities.formatDate(new Date(), _mcTz_(), 'HH:mm')); }
function _v87HM_(v) { var m = _v87Min_(v); return m === null ? '' : ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
function _v87J_(x) { if (typeof x === 'string') { try { return JSON.parse(x); } catch (e) { return null; } } return x; }
function _v87ModOk_(s, mod) { if (!s || s.dev) return false; var need = (typeof MC_RB_MODULES_ === 'object' && MC_RB_MODULES_[mod]) || ''; return !need || _mcRbHasExact_(s, need); }
/** Группа по сроку: просрочено (после дедлайна), сейчас (за 30 мин до срока и позже), позже. */
function _v87Group_(due, deadline) {
  var now = _v87NowMin_(), dl = _v87Min_(deadline || ''), du = _v87Min_(due || '');
  if (dl !== null && now > dl) return 'overdue';
  if (du !== null && du - now > 30) return 'later';
  return 'now';
}
function _v87Roles_(jid) { try { return _mcRbJournalRoles_(jid).join(', '); } catch (e) { return ''; } }

/* ---------------- источники карточек ---------------- */
var MC_V87_SOURCES_ = [
  // 1. вопросы журналов — те, что сотрудник вправе внести
  function (ctx) {
    if (!_mcRbHasExact_(ctx.s, 'journals')) return [];
    var r = _v87J_(getPendingChecks(ctx.token)), L = (r && r.data && r.data.проверки) || [], out = [], others = 0;
    L.forEach(function (c) {
      if (!_mcRbJournalAllowed_(ctx.s, c.код)) { if (_v87Group_(c.время, c.дедлайн) === 'overdue') others++; return; }
      var mode = String(c.режим || 'да_нет');
      out.push({ key: 'Q|' + c.id, group: _v87Group_(c.время, c.дедлайн), source: c.журнал + ' (' + c.код + ')', title: String(c.вопрос || ''), detail: String(c.объект || ''),
        due: _v87HM_(c.время), deadline: _v87HM_(c.дедлайн), who: _v87Roles_(c.код), critical: !!c.критическая,
        act: mode === 'бракераж' ? { kind: 'open', module: 'brakerage', label: 'Бракераж' } : { kind: 'answer', id: String(c.id), mode: mode, unit: c.единица || '', min: c.пределМин, max: c.пределМакс } });
    });
    if (others && _mcRbHasExact_(ctx.s, 'haccp|haccp_view') && _v87ModOk_(ctx.s, 'haccptoday'))
      out.push({ key: 'Q|others', group: 'waiting', source: 'Журналы', title: 'У других сотрудников просрочено вопросов журналов: ' + others, detail: 'их вносят те, кто ведёт эти журналы', who: 'другие сотрудники', act: { kind: 'open', module: 'haccptoday', label: 'ХАССП — сегодня' } });
    return out;
  },
  // 2. контроли ХАССП по оборудованию и после выпуска, задания кухни (V18)
  function (ctx) {
    if (!_mcRbHasExact_(ctx.s, 'journals')) return [];
    var r = _v87J_(getMyOperationalTasks('', ctx.token)), T = (r && r.data && r.data.tasks) || [];
    return T.map(function (t) {
      var g = t.state === 'DONE' ? 'done' : t.state === 'OVERDUE' ? 'overdue' : (t.state === 'PLANNED' || t.state === 'UPCOMING') ? 'later' : 'now';
      if (t.deviationId && t.state !== 'DONE') g = 'error';
      var h = t.type === 'HACCP';
      return { key: 'T|' + t.type + '|' + t.id, group: g, source: h ? 'Контроль ХАССП' : 'Задания кухни', title: String(t.title || ''), detail: String(t.object || '') + (t.deviationId ? ' · отклонение ' + t.deviationId : '') + (g === 'done' && t.fact !== undefined && t.fact !== '' ? ' · факт ' + t.fact : ''),
        due: _v87HM_(t.due), deadline: _v87HM_(t.deadline), who: t.employee || '',
        act: g === 'done' ? null : (t.deviationId ? { kind: 'open', module: 'haccpevents', label: 'Отклонение' } : h ? { kind: 'value', type: 'HACCP', id: String(t.id), unit: t.unit || '' } : { kind: 'call', fn: 'completeMyOperationalTask', args: [{ type: 'PRODUCTION', id: String(t.id) }], label: 'Готово', confirm: 'Задание «' + t.title + '» выполнено?' }) };
    });
  },
  // 3. здоровье на смену и осмотр (J07)
  function (ctx) {
    var out = [], day = MC_V81_DAY_(), R = _v81HlRows_(day), me = R.filter(function (r) { return String(r['Сотрудник']) === ctx.me; })[0], J = _v86J07Day_(day), j = J[ctx.me];
    var adm = me && me['Допуск'] ? String(me['Допуск']) : (j && j.admit ? j.admit : '');
    if (!me && !adm) out.push({ key: 'H|self', group: 'now', source: 'Здоровье на смену', title: 'Отметьтесь: здоровы ли вы сегодня', detail: 'есть жалобы (температура, горло, кишечник, порез, гнойничок) — «Есть жалобы»', who: 'вы',
      act: { kind: 'call', fn: 'v81HealthSelf', args: [{ healthy: true }], label: '✓ Здоров, жалоб нет', confirm: 'Вы здоровы, жалоб нет?', alt: { module: 'health', label: 'Есть жалобы' } } });
    else if (!adm) out.push({ key: 'H|wait', group: 'waiting', source: 'Здоровье на смену', title: 'Допуск к работе ждёт осмотра', detail: 'отмечено: ' + String(me['Отметка']), who: _v87Roles_('J07'), act: null });
    else if (/^нет/.test(adm)) out.push({ key: 'H|no', group: 'error', source: 'Здоровье на смену', title: 'Вы не допущены к работе сегодня', detail: adm, who: _v87Roles_('J07'), act: null });
    else out.push({ key: 'H|ok', group: 'done', source: 'Здоровье на смену', title: 'Допущены к работе', detail: adm, who: '', act: null });
    if (_v81HlAllowed_(ctx.s)) { var w = _v86HlWaiting_(day, R).length; if (w) out.push({ key: 'H|approve', group: 'now', source: 'Осмотр персонала (J07)', title: 'Осмотрите отметившихся: ' + w, detail: 'кожа рук, признаки ОРВИ; допуск — списком', who: 'вы', act: { kind: 'open', module: 'health', label: 'Осмотр' } }); }
    return out;
  },
  // 4. фритюр (J38)
  function (ctx) {
    var out = [], can = _mcRbJournalAllowed_(ctx.s, 'J38'), rev = _v86FryReviewer_(ctx.s); if (!can && !rev) return out;
    _v81FryRows_().forEach(function (r) {
      var st = String(r['Статус']), f = String(r['Фритюр']);
      if (can && (st === 'STARTING' || st === 'CLOSING')) out.push({ key: 'F|' + r.CycleID, group: 'error', source: 'Фритюр (J38)', title: f + ': запись не завершена', detail: st === 'STARTING' ? 'начало цикла не дописано в журнал (сбой связи)' : 'окончание не дописано в журнал (сбой связи)', who: 'вы',
        act: { kind: 'call', fn: st === 'STARTING' ? 'v81FryerStart' : 'v81FryerEnd', args: [{ fryer: f, resume: true }], label: st === 'STARTING' ? 'Дописать начало' : 'Дописать окончание' } });
      else if (can && st === 'OPEN') { var t0 = r['Начало'] instanceof Date ? r['Начало'] : null, mn = t0 ? Math.round((Date.now() - t0.getTime()) / 60000) : 0;
        out.push({ key: 'F|' + r.CycleID, group: 'later', source: 'Фритюр (J38)', title: f + ' в работе ' + Math.floor(mn / 60) + ' ч ' + (mn % 60) + ' мин', detail: String(r['Вид жира']) + ' · по окончании — оценка, остаток, утилизация, причина', who: 'кто ведёт J38', act: { kind: 'open', module: 'fryer', label: 'Закончил / заменил' } }); }
      else if (rev && /^НУЖНА СВЕРКА/.test(String(r['Сверка']))) out.push({ key: 'F|rv|' + r.CycleID, group: 'now', source: 'Фритюр (J38)', title: f + ': сверьте баланс жира', detail: String(r['Сверка']).replace(/^НУЖНА СВЕРКА:\s*/, ''), who: 'вы', act: { kind: 'open', module: 'fryer', label: 'Сверить' } });
    });
    return out;
  },
  // 5. бракераж по продажам и ожидаемым блюдам (V77)
  function (ctx) {
    if (!_mcRbHasExact_(ctx.s, MC_V77_ACT_) || !_v87ModOk_(ctx.s, 'brakesales')) return [];
    var n = _v77Counts_(), out = [];
    if (n.sold) out.push({ key: 'B|sold', group: 'overdue', source: 'Бракераж (J02)', title: 'Продано без бракеража: ' + n.sold, detail: 'оцените внешний вид, запах, вкус — одной кнопкой по каждому блюду', who: _v87Roles_('J02'), act: { kind: 'open', module: 'brakesales', label: 'Бракераж' } });
    if (n.expected) out.push({ key: 'B|exp', group: 'now', source: 'Бракераж (J02)', title: 'Ждут бракеража: ' + n.expected, detail: 'блюда, ожидаемые к продаже сегодня', who: _v87Roles_('J02'), act: { kind: 'open', module: 'brakesales', label: 'Бракераж' } });
    return out;
  },
  // 6. обработка яиц по расходу (V83)
  function (ctx) {
    if (!_v83Can_(ctx.s) || !_v87ModOk_(ctx.s, 'eggs')) return [];
    var n = _v83Pending_().pending.length;
    return n ? [{ key: 'E|proc', group: 'now', source: 'Обработка яиц', title: 'Обработка яиц: ждут ' + n, detail: 'расход яиц без отметки об обработке по режиму', who: 'кто ведёт журналы', act: { kind: 'open', module: 'eggs', label: 'Обработка яиц' } }] : [];
  },
  // 7. проверка приборов по эталону (J19 / J20)
  function (ctx) {
    var D = _v84Due_().filter(function (x) { return _mcRbJournalAllowed_(ctx.s, x.journal); });
    return D.length && _v87ModOk_(ctx.s, 'metrology') ? [{ key: 'M|due', group: D.some(function (x) { return x.failed; }) ? 'error' : 'now', source: 'Проверка приборов (J19 / J20)', title: 'Проверка приборов по эталону: ждут ' + D.length, detail: D.map(function (x) { return x.name + (x.failed ? ' — вне допуска' : ''); }).slice(0, 4).join(', '), who: 'вы', act: { kind: 'open', module: 'metrology', label: 'Проверить' } }] : [];
  },
  // 8. суточные пробы
  function (ctx) {
    if (!_mcRbHasExact_(ctx.s, 'journals') || !_v87ModOk_(ctx.s, 'samples')) return [];
    var n = _dsMissing_().length;
    return n ? [{ key: 'S|ds', group: 'now', source: 'Суточные пробы', title: 'Суточные пробы: ждут ' + n, detail: 'выпущенные блюда без отобранной пробы', who: 'кто ведёт журналы', act: { kind: 'open', module: 'samples', label: 'Отобрать' } }] : [];
  },
  // 9. просроченное на складе
  function (ctx) {
    if (!_mcRbHasExact_(ctx.s, 'stock') || !_v87ModOk_(ctx.s, 'writeoff')) return [];
    var n = _v81ExpiredCount_();
    return n ? [{ key: 'X|exp', group: 'overdue', source: 'Склад', title: 'Просрочено на складе: ' + n, detail: 'использовать нельзя — акт списания', who: 'склад', act: { kind: 'open', module: 'writeoff', label: 'Акт списания' } }] : [];
  },
  // 10. продажи за смену — черновик
  function (ctx) {
    if (!_mcRbJournalAllowed_(ctx.s, 'J36') || !_mcRbHasExact_(ctx.s, MC_V79_NEED_) || !_v87ModOk_(ctx.s, 'shiftsales')) return [];
    var n = _v79Rows_(_book_().getSheetByName(MC_V79_SHEET_), MC_V79_HEAD_).filter(function (x) { return /^(DRAFT|PARTIAL)$/.test(String(x['Статус'])); }).length;
    return n ? [{ key: 'P|draft', group: 'now', source: 'Продажи за смену (J36)', title: 'Черновик продаж не подтверждён: ' + n, detail: 'склад спишется после подтверждения', who: _v87Roles_('J36'), act: { kind: 'open', module: 'shiftsales', label: 'Продажи за смену' } }] : [];
  },
  // 11. итоги операций сотрудника за день: «Система уже сделала» и «Требует действия»
  function (ctx) {
    var sh = _book_().getSheetByName(MC_V87_RES_); if (!sh || sh.getLastRow() < 2) return [];
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, MC_V87_RES_HEAD_.length).getValues(), day = _v87Day_(), out = [], seenOk = {};
    for (var i = v.length - 1; i >= 0 && out.length < 25; i--) {
      var dd = v[i][1] instanceof Date ? Utilities.formatDate(v[i][1], _mcTz_(), 'yyyy-MM-dd') : String(v[i][1]).slice(0, 10);   // таблица превращает «2026-11-18» в дату
      if (dd !== day || String(v[i][2]) !== ctx.me) continue;
      var op = String(v[i][3]), st = String(v[i][4]), at = v[i][0] instanceof Date ? Utilities.formatDate(v[i][0], _mcTz_(), 'HH:mm') : '';
      if (st === 'done' || st === 'partial') { seenOk[op] = true;
        out.push({ key: 'R|' + i, group: 'done', source: MC_V87_OPNAME_[op] || op, title: String(v[i][5] || ''), detail: [String(v[i][6] || ''), v[i][7] ? 'ждёт: ' + v[i][7] : ''].filter(String).join(' · '), due: at, who: '', act: null }); }
      else if (st === 'blocked' && !seenOk[op] && (Date.now() - (v[i][0] instanceof Date ? v[i][0].getTime() : 0)) < 2 * 3600000)
        out.push({ key: 'R|' + i, group: 'error', source: MC_V87_OPNAME_[op] || op, title: 'Не выполнено: ' + String(v[i][5] || ''), detail: String(v[i][8] || ''), due: at, who: 'вы', act: MC_V87_OPMOD_[op] ? { kind: 'open', module: MC_V87_OPMOD_[op], label: 'Открыть' } : null });
    }
    return out;
  }
];

/** Карточки сотрудника по всем источникам, по разделам и срокам. */
function _v87Cards_(ctx) {
  var cards = [], errors = [];
  MC_V87_SOURCES_.forEach(function (src, i) {
    try { (src(ctx) || []).forEach(function (c) { cards.push(c); }); }
    catch (e) { errors.push(i); cards.push({ key: 'ERR|' + i, group: 'error', source: 'Сбор задач', title: 'Часть задач не загрузилась (источник ' + (i + 1) + ')', detail: String(e && e.message || e).slice(0, 200), who: 'администратор', act: { kind: 'reload', label: 'Обновить' } }); }
  });
  var rank = MC_V87_RANK_;
  cards.sort(function (a, b) { var r = rank[a.group] - rank[b.group]; if (r) return r; if (!!b.critical !== !!a.critical) return b.critical ? 1 : -1; return String(a.due || '99:99').localeCompare(String(b.due || '99:99')); });
  var sum = {}; MC_V87_GROUPS_.forEach(function (g) { sum[g] = cards.filter(function (c) { return c.group === g; }).length; });
  try { CacheService.getScriptCache().put('v87n|' + ctx.me, String(sum.overdue + sum.error + sum.now + sum.prep) + '|' + sum.overdue, 60); } catch (e) {}
  return { cards: cards, summary: sum, errors: errors };
}
function _v87CountCached_(ctx) {
  try { var c = CacheService.getScriptCache().get('v87n|' + ctx.me); if (c) { var p = String(c).split('|'); return { open: Number(p[0]) || 0, overdue: Number(p[1]) || 0 }; } } catch (e) {}
  var x = _v87Cards_(ctx); return { open: x.summary.overdue + x.summary.error + x.summary.now + x.summary.prep, overdue: x.summary.overdue };
}
function _v87Forget_(who) { try { if (who) CacheService.getScriptCache().remove('v87n|' + who); } catch (e) {} }

/** «Моя смена»: все карточки сотрудника по разделам. */
function v87ShiftData(token) {
  var op = null;
  try { op = _beginOp_(token, '', 'SHIFT_VIEW', 'Смена', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var s = op.session;
    if (!s || s.dev) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Технический доступ — не сотрудник смены', op.id); }
    var a = _author_(op), ctx = { s: s, token: token, me: a.фио }, x = _v87Cards_(ctx);
    _endOp_(op);
    return _ok_({ day: Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy'), now: Utilities.formatDate(new Date(), _mcTz_(), 'HH:mm'), employee: ctx.me, position: a.должность || '', cards: x.cards, summary: x.summary, sourceErrors: x.errors.length }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- 2. итог операции ---------------- */
var MC_V87_OPNAME_ = { v81FryerStart: 'Фритюр: залил масло', v81FryerEnd: 'Фритюр: закончил / заменил', v86FryerReview: 'Фритюр: сверка', v81HealthSelf: 'Здоровье на смену', v81HealthApprove: 'Осмотр персонала',
  answerJournalCheck: 'Вопрос журнала', completeMyOperationalTask: 'Задача смены', v77BrakConfirm: 'Бракераж', v80BrakBatch: 'Бракераж партий', v83ProcessUsed: 'Обработка яиц', v84SaveCheck: 'Проверка прибора', mcTakeDailySample: 'Суточная проба' };
var MC_V87_OPMOD_ = { v81FryerStart: 'fryer', v81FryerEnd: 'fryer', v86FryerReview: 'fryer', v81HealthSelf: 'health', v81HealthApprove: 'health', answerJournalCheck: 'myshift', completeMyOperationalTask: 'myshift',
  v77BrakConfirm: 'brakesales', v80BrakBatch: 'brakesales', v83ProcessUsed: 'eggs', v84SaveCheck: 'metrology', mcTakeDailySample: 'samples' };
var MC_V87_NEXT_ = { label: 'Моя смена', module: 'myshift' };
function _v87Arr_(a) { return (a || []).filter(function (x) { return x !== '' && x !== null && x !== undefined; }).map(String); }
/** Описание успешной операции: {message, completed, pending, blocked, next}. */
var MC_V87_DESCRIBE_ = {
  v81FryerStart: function (d, a) {
    if (d.idempotent) return { message: 'Уже было записано — повтор ничего не изменил', completed: ['цикл ' + d.cycle + ' начат ранее'] };
    return { message: d.resumed ? 'Незавершённая запись дописана' : 'Фритюр: цикл начат', completed: ['строка журнала фритюрных жиров (J38) ' + (d.resumed ? 'дописана' : 'начата'), d.batch ? 'со склада списано, в партии осталось ' + d.batch.remainText : '', d.carry ? 'переходящий остаток прошлого цикла учтён: ' + d.carry + ' кг' : ''],
      pending: ['по окончании — «Закончил / заменил»: оценка жира, остаток, утилизация, причина'] };
  },
  v81FryerEnd: function (d) {
    if (d.idempotent) return { message: 'Уже было записано — повтор ничего не изменил', completed: ['цикл ' + d.cycle + ' закрыт ранее'] };
    var rv = /^НУЖНА СВЕРКА/.test(String(d.balance || ''));
    return { message: d.resumed ? 'Окончание дописано по ранее введённым данным' : 'Фритюр: цикл закрыт', completed: ['строка J38 дописана: оценка, остаток, утилизация, причина', rv ? '' : 'баланс жира: ' + d.balance],
      pending: rv ? ['баланс жира не сходится — сверка у шеф-повара (' + String(d.balance).replace(/^НУЖНА СВЕРКА:\s*/, '') + ')'] : [] };
  },
  v86FryerReview: function () { return { message: 'Сверка баланса записана', completed: ['в цикле и в строке J38'] }; },
  v81HealthSelf: function (d) { return { message: d.healthy ? 'Отмечено: здоров' : 'Жалобы переданы ответственному', completed: ['отметка за ' + d.day], pending: ['допуск к работе — после осмотра (' + _v87Roles_('J07') + ')'] }; },
  v81HealthApprove: function (d) {
    return { message: 'Осмотр записан: ' + (d.done || []).length, completed: (d.done || []).map(function (x) { return x.name + ' — ' + (x.admitted ? 'допущен' : 'не допущен') + (x.merged ? ' (дописана строка J07, вопрос журнала закрыт)' : ' (строка J07)'); }),
      blocked: (d.refused || []).map(function (x) { return x.name + ' — ' + x.reason; }) };
  },
  answerJournalCheck: function (d) {
    if (d.отклонение) return { message: 'Ответ записан — отклонение', completed: ['ответ в журнале', d.id_задачи ? 'задача по отклонению: ' + d.id_задачи : ''],
      pending: [d.критическая ? 'критическая точка: продукция на карантине до решения ответственного' : 'отклонение передано ответственному'], blocked: d.критическая ? ['продукцию не использовать до решения'] : [], nextText: d.следующий_шаг || '' };
    return { message: 'Ответ записан в журнал', completed: ['вопрос закрыт'] };
  },
  completeMyOperationalTask: function (d) { return { message: 'Задача выполнена', completed: [d.value !== undefined && d.value !== '' ? 'значение записано: ' + d.value : 'отмечено «выполнено»', d.deviationId ? '' : ''], pending: d.deviationId ? ['значение вне нормы — отклонение ' + d.deviationId + ', решение ответственного'] : [] }; },
  v77BrakConfirm: function (d) { return { message: 'Бракераж записан: ' + (d.done || []).length, completed: (d.done || []).map(function (x) { return x.dish + ' — ' + x.time; }), blocked: (d.refused || []).map(function (x) { return x.dish + ' — ' + x.reason; }), pending: (d.skipped || []).map(function (x) { return x.dish + ' — ' + x.reason; }) }; },
  v80BrakBatch: function (d) { return { message: 'Бракераж партий записан: ' + (d.done || []).length, completed: (d.done || []).map(function (x) { return x.dish + ' (' + x.batchId + ')'; }), blocked: (d.refused || []).map(function (x) { return x.batchId + ' — ' + x.reason; }) }; },
  v83ProcessUsed: function (d) { return { message: 'Обработка яиц записана', completed: [(d.done || []).length + ' записей'], blocked: (d.missing || []).length ? ['не найдено: ' + (d.missing || []).length] : [] }; },
  v84SaveCheck: function (d) { var f = d.result === 'FAIL'; return { message: f ? 'Прибор вне допуска' : 'Прибор годен', completed: ['строки ' + (d.journal || 'J19 / J20') + ' записаны'], blocked: f ? ['прибор заблокирован — использовать нельзя'] : [], pending: f ? ['оценка прежних измерений ' + (d.evalId || '') + ' — ответственный за ХАССП'] : [] }; },
  mcTakeDailySample: function (d) { return { message: 'Суточная проба отобрана', completed: ['проба ' + d.sampleId + ' партии ' + d.batchId], pending: ['хранить до ' + d.keepUntil] }; }
};
var MC_V87_FAILHINT_ = {
  VALIDATION: 'Ничего не записано. Исправьте и нажмите ещё раз.',
  FORBIDDEN: 'Ничего не записано: это делает другой сотрудник (по правам).',
  CONFLICT: 'Ничего нового не записано — см. причину.',
  DUPLICATE: 'Это уже записано раньше — повтор не нужен.',
  NOT_FOUND: 'Ничего не записано: объект не найден — обновите экран.',
  BATCH_STATE: 'Ничего не записано: партию использовать нельзя.',
  STOCK_SHORTAGE: 'Ничего не записано: на складе меньше, чем нужно.',
  FEFO: 'Ничего не записано: по FEFO сначала другая партия.'
};
function _v87Log_(fn, st, res, code, opId, who) {
  try {
    var sh = _bcSheet_(MC_V87_RES_, MC_V87_RES_HEAD_);
    sh.appendRow([new Date(), _v87Day_(), who, fn, st, String(res.message || '').slice(0, 300), _v87Arr_(res.completed).join('; ').slice(0, 500), _v87Arr_(res.pending).join('; ').slice(0, 300), _v87Arr_(res.blocked).join('; ').slice(0, 300), code || '', opId || '']);
  } catch (e) {}
}
function _v87Who_(token) { try { var s = _getSession_(token); return s && !s.dev ? _author_(token).фио : ''; } catch (e) { return ''; } }
/** Обёртка: к ответу операции добавляется итог (data.outcome или error.outcome); итог — в «Итоги_Операций_V87». */
function _v87Wrap_(g, fn) {
  var orig = g[fn]; if (typeof orig !== 'function') return;
  _V87O_[fn] = orig;
  // параметры названы как у исходной функции: шлюз находит токен по имени параметра «token»
  g[fn] = function (json, token) {
    var r = orig.call(this, json, token), x = _v87J_(r);
    try {
      if (!x || typeof x !== 'object') return r;
      var who = _v87Who_(token), mod = MC_V87_OPMOD_[fn], next = mod && mod !== 'myshift' ? [MC_V87_NEXT_, { label: (typeof MC_RB_MODULE_RU_ === 'object' && MC_RB_MODULE_RU_[mod]) || ({ samples: 'Суточные пробы' })[mod] || 'Открыть экран', module: mod }] : [MC_V87_NEXT_];
      if (x.success === true || x.ok === true) {
        var d = x.data || {}, res = (MC_V87_DESCRIBE_[fn] || function () { return { message: 'Выполнено' }; })(d);
        res.completed = _v87Arr_(res.completed); res.pending = _v87Arr_(res.pending); res.blocked = _v87Arr_(res.blocked);
        res.status = res.blocked.length && !res.completed.length ? 'blocked' : (res.pending.length || res.blocked.length) ? 'partial' : 'done';
        res.next = next; if (res.nextText) res.pending.push(res.nextText);
        if (typeof x.data === 'object' && x.data !== null) x.data.outcome = res; else x.data = { value: x.data, outcome: res };
        if (who && !d.idempotent) _v87Log_(fn, res.status, res, '', x.operation_id, who);
        _v87Forget_(who);
      } else if (x.error) {
        var code = String(x.error.code || ''), m = String(x.error.message || x.error || '');
        var hint = MC_V87_FAILHINT_[code] || (code === 'INTERNAL' || !code ? 'Сбой при записи: часть могла записаться. Откройте экран заново — незавершённое будет видно в «Моей смене» («Требует действия»).' : 'Ничего не записано.');
        var resF = { status: 'blocked', message: m, completed: [], pending: [], blocked: [m], hint: hint, next: next };
        if (typeof x.error === 'object') x.error.outcome = resF;
        if (who && code !== 'VALIDATION') _v87Log_(fn, 'blocked', resF, code, x.error.operation_id || '', who);
      }
      return typeof r === 'string' ? JSON.stringify(x) : x;
    } catch (e) { return r; }
  };
}
var _V87O_ = {};
(function (g) { Object.keys(MC_V87_OPNAME_).forEach(function (fn) { _v87Wrap_(g, fn); }); })(this);

/* ---------------- главное окно: «Моя смена» первой, со счётчиком ---------------- */
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  var orig = _UI_BUILDERS_.home; if (typeof orig !== 'function') return;
  _UI_BUILDERS_.home = function (token, opts, s) {
    var r = orig(token, opts, s) || {};
    try {
      if (s && !s.dev && _v87ModOk_(s, 'myshift')) {
        // плитка первой: сколько дел сейчас и просрочено; кнопка — первой (после «Бракеража», если он первый)
        var n = _v87CountCached_({ s: s, token: token, me: _author_(token).фио });
        r.kpis = [{ label: 'Моя смена', value: n.open, hint: n.open ? (n.overdue ? 'дел сейчас, просрочено ' + n.overdue : 'дел сейчас') : 'всё сделано', tone: n.overdue ? 'red' : n.open ? 'gold' : 'green', go: { module: 'myshift' } }].concat(r.kpis || []);
        var A0 = (r.actions || []).filter(function (x) { return !(x && x.module === 'myshift'); }), btn = { label: 'Моя смена' + (n.open ? ': ' + n.open : ''), module: 'myshift' };
        r.actions = A0[0] && A0[0].module === 'brakesales' ? [A0[0], btn].concat(A0.slice(1)) : [btn].concat(A0);
      }
    } catch (e) {}
    return r;
  };
})();
