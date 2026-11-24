/**
 * MonChef V89 — сменные email-уведомления: утро (за 2 ч до начала смены), середина смены, за 2 ч до закрытия (23.11.2026).
 *
 * ТЗ «Промт для MonChef: email-триггеры по сменам, финансам, поставщикам и срокам годности», разделы 1–15.
 *  • Время — от расписания смены площадки (лист «Смены_Расписание») в часовом поясе площадки. Нет расписания — резервное
 *    время из настроек и пометка «по резервному расписанию»; нет ни того, ни другого — SHIFT_SCHEDULE_REQUIRED, писем нет.
 *    Нет времени окончания смены — SHIFT_END_ESTIMATED (по резервному времени) или ошибка конфигурации, письма о закрытии нет.
 *  • Смена короче 4 ч — «середина» и «закрытие» одним письмом с двумя блоками. Ночная смена через полночь — по дате начала.
 *  • Пропущенное окно (система была недоступна) — одно догоняющее письмо LATE_NOTIFICATION, без серии дублей.
 *  • Ключ письма: OrganizationID + LocationID + ShiftID + ShiftDate + NotificationType + ReportVersion; SENT — повтора нет.
 *    Отчёт изменился после отправки — запись REPORT_CHANGED_AFTER_SEND, повтор только ручной командой с причиной.
 *  • Временная ошибка почты — до 3 повторов (5, 15, 45 мин), затем FAILED и критическое уведомление администратору.
 *  • Состав письма — по правам адресата: без права «финансы» — без закупочных цен, себестоимости, прибыли, маржи и ФОТ.
 *  • Заявки — отдельно по каждому поставщику, формула ТЗ 6.2; без поставщика — SUPPLIER_NOT_MAPPED. Заявки, перемещения,
 *    списания система не создаёт: письмо — отчёт и список действий.
 *  • Сроки: EXPIRED, EXPIRING_24H/48H/72H/7D, OK, NO_EXPIRY_DATE; пороги — по категории, типу, продукту и площадке.
 *  • Предложения (ТЗ 10): FEFO раньше, в производство / меню дня, списание просроченного, задача по качеству, сверка остатка —
 *    статусы SUGGESTED / ACCEPTED / DECLINED / EXECUTED / EXPIRED; исполнение — только вручную в своём экране.
 *  • Вложения PDF, Excel (листы Итоги, Финансы, Поставщики, Просрочки, Пересорт, Задачи, Ошибки), TXT — на Диске в папке
 *    «09 Отчёты / Сменные письма / организация / площадка / дата / смена»; в письме — ссылки и SHA-256.
 *  • Ничего не придумывается: неизвестная сумма — «НЕТ ДАННЫХ» с причиной, не ноль; неполные данные — PARTIAL_DATA.
 */
var MC_V89_VER_ = 'R1';
var MC_V89_CFG_ = 'Настройки_Email_Триггеры', MC_V89_CFG_HEAD_ = ['TriggerConfigID', 'Active', 'OrganizationID', 'LocationID', 'LocationName', 'Timezone', 'ShiftCalendarSource',
  'ShiftStartOffsetMinutes', 'ShiftMidpointEnabled', 'ShiftCloseOffsetMinutes', 'FallbackMorningTime', 'FallbackMiddayTime', 'FallbackClosingTime',
  'RecipientGroupMorning', 'RecipientGroupMidday', 'RecipientGroupClosing', 'IncludeFinancialReport', 'IncludeSupplierRequests', 'IncludeExpiryReport',
  'IncludeResortRecommendations', 'MinimumSeverityToSend', 'SendEmptyReport', 'AttachExcel', 'AttachPDF', 'AttachTXT', 'DryRun', 'ActiveFrom', 'ActiveTo', 'UpdatedBy', 'UpdatedAt'];
var MC_V89_SH_ = 'Смены_Расписание', MC_V89_SH_HEAD_ = ['ShiftID', 'LocationID', 'Название', 'Дни недели', 'Дата', 'Начало', 'Окончание', 'Активна', 'Обновил', 'Обновлено'];
var MC_V89_RC_ = 'Email_Адресаты', MC_V89_RC_HEAD_ = ['RecipientID', 'Группа', 'Email', 'EmployeeID', 'Сотрудник', 'LocationID', 'Активен', 'Обновил', 'Обновлено'];
var MC_V89_PP_ = 'Закупка_Параметры', MC_V89_PP_HEAD_ = ['Продукт', 'Ед.', 'SupplierID', 'Поставщик', 'Мин. запас', 'Целевой запас', 'Страховой запас', 'Мин. партия', 'Кратность',
  'Срок поставки, дн', 'Коэффициент', 'Активен', 'Обновил', 'Обновлено'];
var MC_V89_XR_ = 'Пороги_Сроков', MC_V89_XR_HEAD_ = ['RuleID', 'Область', 'Значение', 'LocationID', 'Срочно, ч', 'Показывать, ч', 'Активно', 'Обновил', 'Обновлено'];
var MC_V89_BG_ = 'Бюджет', MC_V89_BG_HEAD_ = ['BudgetID', 'Тип периода', 'Период', 'Статья', 'Сумма', 'LocationID', 'Обновил', 'Обновлено'];
var MC_V89_SG_ = 'Предложения_Склад', MC_V89_SG_HEAD_ = ['SuggestionID', 'Ключ', 'Создано', 'LocationID', 'BatchID', 'Продукт', 'Остаток', 'Ед.', 'Срок годности', 'Причина',
  'Действие', 'Рекомендация', 'Срок выполнения', 'Ответственная роль', 'Эффект, ₽', 'Риск', 'Ссылка', 'Статус', 'Решил', 'Решено', 'Комментарий'];
var MC_V89_LOG_ = 'Email_Триггеры_Журнал', MC_V89_LOG_HEAD_ = ['NotificationID', 'TriggerConfigID', 'OrganizationID', 'LocationID', 'ShiftID', 'ShiftDate', 'NotificationType',
  'PlannedAt', 'ActualStartedAt', 'SentAt', 'RecipientsHash', 'ReportHash', 'Status', 'LateFlag', 'DuplicateKey', 'EmailMessageID', 'AttachmentFileIDs', 'ErrorCode',
  'ErrorMessage', 'OperationID', 'CreatedAt', 'Примечание'];
var MC_V89_ERR_ = 'Email_Триггеры_Ошибки', MC_V89_ERR_HEAD_ = ['ErrorID', 'NotificationID', 'ErrorType', 'Severity', 'Message', 'Retryable', 'Attempts', 'NextRetryAt',
  'ResolvedAt', 'ResolvedBy', 'OperationID', 'CreatedAt', 'Ключ'];

var MC_V89_TYPES_ = { MORNING: 'УТРО', MIDDAY: 'ДЕНЬ', CLOSING: 'ЗАКРЫТИЕ' };
var MC_V89_GROUPS_ = { OWNER: 'Руководитель / владелец', ACCOUNTANT: 'Бухгалтер / экономист', CHEF: 'Шеф-повар', PURCHASER: 'Закупщик', STOREKEEPER: 'Кладовщик',
  SITE_ADMIN: 'Администратор площадки', SHIFT_LEAD: 'Руководитель смены' };
// права группы, если адресат не привязан к сотруднику (привязан — права сотрудника по роли и индивидуальным правам)
var MC_V89_GROUP_RIGHTS_ = { OWNER: 'FPWE', ACCOUNTANT: 'FPWE', CHEF: 'PE', PURCHASER: 'PE', STOREKEEPER: 'PE', SITE_ADMIN: 'E', SHIFT_LEAD: 'E' };
var MC_V89_PRIO_ = ['КРИТИЧНО', 'ВАЖНО', 'ОБЫЧНО'];
var MC_V89_CATS_ = { EXPIRED: 'срок истёк', EXPIRING_24H: 'истекает в течение 24 ч', EXPIRING_48H: 'в течение 48 ч', EXPIRING_72H: 'в течение 72 ч',
  EXPIRING_7D: 'в течение 7 дней', OK: 'срочного действия не требует', NO_EXPIRY_DATE: 'срок не указан' };
var MC_V89_ACTIONS_ = { FEFO_FIRST: 'Использовать раньше партий с более поздним сроком (FEFO)', TO_PRODUCTION: 'Направить в производство п/ф', MENU_OF_DAY: 'Включить в меню дня / go-лист',
  WRITE_OFF: 'Оформить списание с причиной', QUALITY_TASK: 'Задача ответственному по качеству', INVENTORY_CHECK: 'Инвентаризационная проверка', TRANSFER: 'Переместить на другую площадку',
  RETURN_SUPPLIER: 'Вернуть поставщику' };
var MC_V89_SG_ST_ = ['SUGGESTED', 'ACCEPTED', 'DECLINED', 'EXECUTED', 'EXPIRED'];
// кто решает предложение (ТЗ, приложение 13): списание — склад, перемещение — право перемещения, производство и меню — шеф-повар, качество — ХАССП
var MC_V89_SG_BY_ = { WRITE_OFF: 'stock_writeoff_create|stock', TRANSFER: 'stock_transfer_create', TO_PRODUCTION: 'prod_manage', MENU_OF_DAY: 'prod_manage', FEFO_FIRST: 'stock|prod_manage', INVENTORY_CHECK: 'stock', QUALITY_TASK: 'haccp', RETURN_SUPPLIER: 'stock|procurement' };
var MC_V89_SG_NEED_ = 'stock|prod_manage|haccp|procurement|stock_writeoff_create|stock_transfer_create|notification_manage';
var MC_V89_RETRY_MIN_ = [5, 15, 45], MC_V89_CATCHUP_H_ = 6, MC_V89_LATE_MIN_ = 20, MC_V89_SHORT_MIN_ = 240;
var MC_V89_CODES_RU_ = { SHIFT_END_ESTIMATED: 'окончание смены не задано — время закрытия по резервному расписанию', FALLBACK_SCHEDULE: 'расписание смены не задано — письмо по резервному расписанию',
  PARTIAL_DATA: 'часть данных недоступна или неполна', SUPPLIER_NOT_MAPPED: 'товар нужно заказать, но поставщик не указан', LATE_NOTIFICATION: 'письмо сформировано с опозданием',
  RECIPIENTS_NOT_CONFIGURED: 'нет адресатов', SHIFT_SCHEDULE_REQUIRED: 'нет расписания смены и резервного времени', CONFIGURATION_REQUIRED: 'не заполнены обязательные настройки',
  REPORT_CHANGED_AFTER_SEND: 'отчёт изменился после отправки', SHIFT_END_REQUIRED: 'нет времени окончания смены и резервного времени закрытия' };

function _v89Sh_(name, head) { return _bcSheet_(name, head); }
function _v89Rows_(name, head) {
  var sh = _v89Sh_(name, head), n = sh.getLastRow(); if (n < 2) return [];
  var v = sh.getRange(1, 1, n, Math.max(head.length, sh.getLastColumn())).getValues(), h = v[0].map(String);
  return v.slice(1).map(function (r, i) { var o = { _row: i + 2 }; head.forEach(function (k) { var j = h.indexOf(k); o[k] = j >= 0 ? r[j] : ''; }); return o; })
    .filter(function (o) { return head.some(function (k) { return o[k] !== '' && o[k] !== null && o[k] !== undefined; }); });
}
function _v89Put_(name, head, o, row) {
  var sh = _v89Sh_(name, head), h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var vals = head.map(function (k) { return o[k] === undefined ? '' : o[k]; });
  if (row) { head.forEach(function (k, i) { var j = h.indexOf(k); if (j >= 0 && o[k] !== undefined) sh.getRange(row, j + 1).setValue(vals[i]); }); return row; }
  sh.appendRow(h.map(function (k) { var i = head.indexOf(k); return i >= 0 ? vals[i] : ''; })); return sh.getLastRow();
}
function _v89B_(x, d) { if (x === true || x === false) return x; var s = String(x === undefined || x === null ? '' : x).trim().toLowerCase(); if (!s) return !!d; return /^(true|да|1|yes|вкл)$/.test(s); }
function _v89N_(x) { var n = Number(String(x === undefined || x === null ? '' : x).replace(',', '.').replace(/\s/g, '')); return isFinite(n) ? n : NaN; }
function _v89Hm_(x) {
  if (x instanceof Date) return Utilities.formatDate(x, _mcTz_(), 'HH:mm');
  var m = /^(\d{1,2})[:.](\d{2})/.exec(String(x || '').trim()); if (!m) return ''; var h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return ''; return ('0' + h).slice(-2) + ':' + ('0' + mi).slice(-2);
}
function _v89Iso_(x, tz) { if (!x) return ''; if (x instanceof Date) return Utilities.formatDate(x, tz || _mcTz_(), 'yyyy-MM-dd'); var s = String(x).trim(), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return m[0]; m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s); return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : ''; }
function _v89R2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function _v89Money_(x) { return _v88N_(x, 2).replace(/,00$/, '') + ' ₽'; }
function _v89Hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function _v89Sha_(x) { return _v89Hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, typeof x === 'string' ? x : x, Utilities.Charset.UTF_8)); }
function _v89ShaBytes_(bytes) { return _v89Hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)); }
function _v89Id_(p) { return p + '-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd') + '-' + Utilities.getUuid().slice(0, 8).toUpperCase(); }
function _v89Who_(s) { return s ? String(s.fullName || s.name || '') : 'Система'; }
function _v89Props_() { return PropertiesService.getScriptProperties(); }
function _v89Prop_(k, d) { try { var v = _v89Props_().getProperty(k); return v === null || v === undefined || v === '' ? d : v; } catch (e) { return d; } }

/* ---------------- время в часовом поясе площадки ---------------- */
function _v89TzOk_(tz) { if (!tz) return false; try { Utilities.formatDate(new Date(), tz, 'HH:mm'); return /\//.test(tz) || /^(GMT|UTC)/.test(tz); } catch (e) { return false; } }
function _v89Tz_(cfg) { var t = String(cfg && cfg.Timezone || '').trim(); return _v89TzOk_(t) ? t : _mcTz_(); }
function _v89Off_(t, tz) { var s = Utilities.formatDate(new Date(t), tz, 'yyyy-MM-dd HH:mm:ss'), m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - Math.floor(t / 1000) * 1000) / 60000); }
/** Местные дата и время площадки → момент времени. */
function _v89At_(iso, hm, tz) {
  var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso), t = /^(\d{2}):(\d{2})$/.exec(hm); if (!d || !t) return null;
  var g = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]), o1 = _v89Off_(g, tz), x = g - o1 * 60000, o2 = _v89Off_(x, tz);
  return new Date(o2 === o1 ? x : g - o2 * 60000);
}
function _v89AddDays_(iso, n) { var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso), u = new Date(Date.UTC(+d[1], +d[2] - 1, +d[3] + n)); return u.toISOString().slice(0, 10); }
function _v89Wd_(iso) { var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso), w = new Date(Date.UTC(+d[1], +d[2] - 1, +d[3])).getUTCDay(); return w === 0 ? 7 : w; }
function _v89Fmt_(t, tz, p) { return t ? Utilities.formatDate(t instanceof Date ? t : new Date(t), tz, p || 'dd.MM.yyyy HH:mm') : ''; }

/* ---------------- настройки ---------------- */
function _v89Cfgs_() {
  return _v89Rows_(MC_V89_CFG_, MC_V89_CFG_HEAD_).map(function (c) {
    c.TriggerConfigID = String(c.TriggerConfigID || ''); c.LocationID = String(c.LocationID || 'MAIN'); c.OrganizationID = String(c.OrganizationID || 'ORG');
    c.active = _v89B_(c.Active, false); c.tz = _v89Tz_(c);
    var n = function (k, d) { var x = _v89N_(c[k]); return isFinite(x) && String(c[k]) !== '' ? x : d; };
    c.startOff = n('ShiftStartOffsetMinutes', 120); c.closeOff = n('ShiftCloseOffsetMinutes', 120); c.midOn = _v89B_(c.ShiftMidpointEnabled, true);
    c.fb = { MORNING: _v89Hm_(c.FallbackMorningTime), MIDDAY: _v89Hm_(c.FallbackMiddayTime), CLOSING: _v89Hm_(c.FallbackClosingTime) };
    c.groups = { MORNING: _v89GroupList_(c.RecipientGroupMorning), MIDDAY: _v89GroupList_(c.RecipientGroupMidday), CLOSING: _v89GroupList_(c.RecipientGroupClosing) };
    c.inc = { fin: _v89B_(c.IncludeFinancialReport, true), sup: _v89B_(c.IncludeSupplierRequests, true), exp: _v89B_(c.IncludeExpiryReport, true), rs: _v89B_(c.IncludeResortRecommendations, true) };
    c.minSev = MC_V89_PRIO_.indexOf(String(c.MinimumSeverityToSend || '').toUpperCase()) >= 0 ? String(c.MinimumSeverityToSend).toUpperCase() : 'ОБЫЧНО';
    c.sendEmpty = _v89B_(c.SendEmptyReport, true); c.att = { xlsx: _v89B_(c.AttachExcel, false), pdf: _v89B_(c.AttachPDF, true), txt: _v89B_(c.AttachTXT, true) };
    c.dry = _v89B_(c.DryRun, false); c.from = _v89Iso_(c.ActiveFrom, c.tz); c.to = _v89Iso_(c.ActiveTo, c.tz);
    c.name = String(c.LocationName || '') || (c.LocationID === 'MAIN' ? (_v89OrgName_() || 'Основная площадка') : c.LocationID);
    return c;
  });
}
function _v89GroupList_(x) { return String(x || '').split(/[,;\s]+/).map(function (g) { g = g.trim().toUpperCase(); return MC_V89_GROUPS_[g] ? g : ''; }).filter(Boolean); }
function _v89OrgName_() { try { return String(_mcOrg_().name || ''); } catch (e) { return ''; } }
function _v89Shifts_() {
  return _v89Rows_(MC_V89_SH_, MC_V89_SH_HEAD_).map(function (r) {
    return { row: r._row, id: String(r.ShiftID || ''), loc: String(r.LocationID || ''), name: String(r['Название'] || ''), days: String(r['Дни недели'] || '').split(/[,;\s]+/).map(Number).filter(function (x) { return x >= 1 && x <= 7; }),
      date: _v89Iso_(r['Дата']), start: _v89Hm_(r['Начало']), end: _v89Hm_(r['Окончание']), active: _v89B_(r['Активна'], true) };
  });
}
function _v89Recipients_() {
  return _v89Rows_(MC_V89_RC_, MC_V89_RC_HEAD_).map(function (r) { return { row: r._row, id: String(r.RecipientID || ''), group: String(r['Группа'] || '').toUpperCase(), email: String(r.Email || '').trim(),
    emp: String(r.EmployeeID || ''), empName: String(r['Сотрудник'] || ''), loc: String(r.LocationID || ''), active: _v89B_(r['Активен'], true) }; });
}
function _v89EmailOk_(e) { return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(String(e || '')); }
/** Права адресата: F — финансы (цены, себестоимость, прибыль, маржа), P — закупки, W — ФОТ, E — сроки и склад. */
function _v89Rights_(r) {
  if (r.emp) {
    var st = (_mcRbEmpState_() || {})[r.emp]; if (!st) return { ok: false, why: 'сотрудник ' + (r.empName || r.emp) + ' не найден' };
    if (st.active === false) return { ok: false, why: 'сотрудник ' + st.name + ' отключён' };
    var p = _mcRbEffective_(st.role, r.emp), s = { permissions: p };
    return { ok: true, F: _mcRbHasExact_(s, 'finance_view'), P: _mcRbHasExact_(s, 'procurement_view|procurement'), W: _mcRbHasExact_(s, 'payroll_view'),
      E: _mcRbHasExact_(s, 'stock_expiry_view|stock_view|stock|haccp_view') };
  }
  var g = MC_V89_GROUP_RIGHTS_[r.group] || '';
  return { ok: true, F: g.indexOf('F') >= 0, P: g.indexOf('P') >= 0, W: g.indexOf('W') >= 0, E: g.indexOf('E') >= 0 };
}
function _v89VariantKey_(R) { return (R.F ? 'F' : 'f') + (R.P ? 'P' : 'p') + (R.W ? 'W' : 'w') + (R.E ? 'E' : 'e'); }
function _v89VariantRu_(k) { return [k[0] === 'F' ? 'с финансами' : 'без финансов', k[1] === 'P' ? 'закупки' : '', k[2] === 'W' ? 'ФОТ' : '', k[3] === 'E' ? 'сроки' : ''].filter(Boolean).join(', '); }

/** Что не настроено для площадки (CONFIGURATION_REQUIRED). */
function _v89Missing_(c, types) {
  var miss = [], rc = _v89Recipients_().filter(function (r) { return r.active && _v89EmailOk_(r.email) && (!r.loc || r.loc === '*' || r.loc === c.LocationID); });
  if (!String(c.Timezone || '').trim()) miss.push('часовой пояс площадки (Timezone) — пока берётся часовой пояс таблицы ' + _mcTz_());
  else if (!_v89TzOk_(String(c.Timezone).trim())) miss.push('часовой пояс «' + c.Timezone + '» не распознан');
  (types || ['MORNING', 'MIDDAY', 'CLOSING']).forEach(function (t) {
    if (!c.groups[t].length) miss.push('группы адресатов для письма «' + MC_V89_TYPES_[t] + '»');
    else if (!rc.some(function (r) { return c.groups[t].indexOf(r.group) >= 0; })) miss.push('нет адресатов с почтой в группах письма «' + MC_V89_TYPES_[t] + '» (' + c.groups[t].map(function (g) { return MC_V89_GROUPS_[g]; }).join(', ') + ') — RECIPIENTS_NOT_CONFIGURED');
  });
  var sh = _v89Shifts_().filter(function (s) { return s.active && (!s.loc || s.loc === '*' || s.loc === c.LocationID) && s.start; });
  if (!sh.length && !c.fb.MORNING && !c.fb.MIDDAY && !c.fb.CLOSING) miss.push('расписание смен площадки или резервное время писем — SHIFT_SCHEDULE_REQUIRED');
  if (sh.length && sh.every(function (s) { return !s.end; }) && !c.fb.CLOSING) miss.push('время окончания смены или резервное время письма о закрытии — без него письма о закрытии не будет');
  return miss;
}
function _v89Blocking_(miss) { return miss.filter(function (m) { return !/^часовой пояс площадки \(Timezone\) — пока/.test(m) && !/письма о закрытии не будет/.test(m); }); }

/* ---------------- окна писем по расписанию смены ---------------- */
/** Окна писем площадки на местные даты вокруг now: [{types, at, shift, flags}], и ошибки конфигурации. */
function _v89Windows_(c, nowMs) {
  var tz = c.tz, today = Utilities.formatDate(new Date(nowMs), tz, 'yyyy-MM-dd'), out = [], errs = [];
  var all = _v89Shifts_().filter(function (s) { return s.active && s.start && (!s.loc || s.loc === '*' || s.loc === c.LocationID); });
  [-1, 0, 1].forEach(function (k) {
    var D = _v89AddDays_(today, k), list;
    if (all.length) {
      var dated = all.filter(function (s) { return s.date === D; });
      list = dated.length ? dated : all.filter(function (s) { return !s.date && (!s.days.length || s.days.indexOf(_v89Wd_(D)) >= 0); });
      list.forEach(function (s) {
        var st = _v89At_(D, s.start, tz), en = s.end ? _v89At_(D, s.end, tz) : null; if (en && en <= st) en = new Date(en.getTime() + 864e5);
        var sh = { id: s.id || ('S' + s.start.replace(':', '')), name: s.name, date: D, startAt: st, endAt: en, source: 'SCHEDULE', flags: [] }, W = [];
        W.push({ types: ['MORNING'], at: new Date(st.getTime() - c.startOff * 60000) });
        var mid = null, clo = null, fl = [];
        if (en) { mid = new Date(st.getTime() + (en.getTime() - st.getTime()) / 2); clo = new Date(en.getTime() - c.closeOff * 60000); }
        else {
          if (c.fb.CLOSING) { clo = _v89At_(D, c.fb.CLOSING, tz); if (clo < st) clo = new Date(clo.getTime() + 864e5); fl.push('SHIFT_END_ESTIMATED'); }
          else errs.push({ code: 'SHIFT_END_REQUIRED', key: c.LocationID + '|' + sh.id + '|' + D, text: 'Смена ' + (s.name || sh.id) + ' ' + D + ': нет времени окончания и резервного времени письма о закрытии — письмо о закрытии не отправляется' });
          if (c.midOn && c.fb.MIDDAY) { mid = _v89At_(D, c.fb.MIDDAY, tz); if (mid < st) mid = new Date(mid.getTime() + 864e5); fl.push('SHIFT_END_ESTIMATED'); }
        }
        if (!c.midOn) mid = null;
        if (en && en.getTime() - st.getTime() < MC_V89_SHORT_MIN_ * 60000 && mid && clo) W.push({ types: ['MIDDAY', 'CLOSING'], at: new Date(Math.min(mid.getTime(), clo.getTime())), merged: 'SHORT_SHIFT' });
        else { if (mid) W.push({ types: ['MIDDAY'], at: mid }); if (clo) W.push({ types: ['CLOSING'], at: clo }); }
        W = _v89MergeClose_(W);
        W.forEach(function (w) { w.shift = sh; w.flags = fl.filter(function (f, i, a) { return a.indexOf(f) === i; }); out.push(w); });
      });
    } else if (c.fb.MORNING || c.fb.MIDDAY || c.fb.CLOSING) {
      var sh2 = { id: 'FALLBACK', name: 'резервное расписание', date: D, startAt: null, endAt: null, source: 'FALLBACK', flags: ['FALLBACK_SCHEDULE'] }, W2 = [];
      ['MORNING', 'MIDDAY', 'CLOSING'].forEach(function (t) { if (c.fb[t] && (t !== 'MIDDAY' || c.midOn)) W2.push({ types: [t], at: _v89At_(D, c.fb[t], tz) }); });
      if (!c.fb.CLOSING) errs.push({ code: 'SHIFT_END_REQUIRED', key: c.LocationID + '|FALLBACK|' + D, text: D + ': расписания смены нет, резервного времени письма о закрытии нет — письмо о закрытии не отправляется' });
      _v89MergeClose_(W2).forEach(function (w) { w.shift = sh2; w.flags = ['FALLBACK_SCHEDULE'].concat(w.types.indexOf('CLOSING') >= 0 ? ['SHIFT_END_ESTIMATED'] : []); out.push(w); });
    } else errs.push({ code: 'SHIFT_SCHEDULE_REQUIRED', key: c.LocationID + '|' + D, text: D + ': нет расписания смены и резервного времени писем — письма не отправляются' });
  });
  out.sort(function (a, b) { return a.at - b.at; });
  return { windows: out, errors: errs.filter(function (e, i, a) { return a.map(function (x) { return x.key + x.code; }).indexOf(e.key + e.code) === i; }) };
}
/** Окна ближе 15 минут друг к другу — одно письмо с несколькими блоками. */
function _v89MergeClose_(W) {
  W.sort(function (a, b) { return a.at - b.at; }); var out = [];
  W.forEach(function (w) { var p = out[out.length - 1]; if (p && w.at - p.at < 15 * 60000) { p.types = p.types.concat(w.types); p.merged = p.merged || 'CLOSE_WINDOWS'; } else out.push({ types: w.types.slice(), at: w.at, merged: w.merged }); });
  return out;
}
function _v89Key_(c, sh, type) { return [c.OrganizationID, c.LocationID, sh.id, sh.date, type, MC_V89_VER_].join('|'); }

/* ---------------- данные: финансы ---------------- */
function _v89FinRange_(types, sh, c, nowMs) {
  var today = Utilities.formatDate(new Date(nowMs), _mcTz_(), 'yyyy-MM-dd');
  if (types.length === 1 && types[0] === 'MORNING') { var prev = _v89AddDays_(sh.date, -1); return { from: prev, to: prev, cmp: _v89AddDays_(prev, -7), label: 'за предыдущий день ' + prev.split('-').reverse().join('.'), closed: true }; }
  var from = sh.date <= today ? sh.date : today;
  return { from: from, to: today, cmp: _v89AddDays_(from, -7), label: 'за день смены ' + from.split('-').reverse().join('.') + (from !== today ? ' – ' + today.split('-').reverse().join('.') : '') + ' на ' + _v89Fmt_(new Date(nowMs), c.tz, 'HH:mm'), closed: false };
}
function _v89FinCalc_(from, to) {
  var rg = _v64Range_(from, to), L = _v64Build_(rg).lines || [], o = { gross: 0, hall: 0, banquet: 0, disc: 0, refund: 0, cogs: 0, lines: 0, costBad: 0, revBad: 0 };
  L.forEach(function (l) {
    var a = Number(l.amount) || 0;
    if (l.stage === 'SALE' && l.dir === 'IN' && l.objType === 'SALE') { o.gross += a; o.lines++; if (l.event) o.banquet += a; else o.hall += a; if ((l.flags || []).indexOf('MISSING_SALE_PRICE') >= 0) o.revBad++; }
    if (l.stage === 'SALE' && l.dir === 'IN' && l.objType === 'FIN_OPERATION') { if (/возврат/.test(String(l.note))) o.refund += -a; else o.disc += -a; }
    if ((l.stage === 'SALE' && l.dir === 'OUT') || l.stage === 'PACKAGING') { o.cogs += a; if ((l.trace && l.trace !== 'PASS' && l.trace !== 'NOT_APPLICABLE') || (l.flags || []).indexOf('MISSING_PRICE') >= 0) o.costBad++; }
  });
  Object.keys(o).forEach(function (k) { if (!/lines|Bad/.test(k)) o[k] = _v89R2_(o[k]); });
  o.net = _v89R2_(o.gross - o.disc - o.refund);
  return o;
}
function _v89Expenses_(from, to) {
  var out = { total: 0, n: 0, commission: 0, delivery: 0, payroll: 0, payrollN: 0, rows: [] };
  try {
    var sh = _book_().getSheetByName('Финансы_Расходы'); if (!sh || sh.getLastRow() < 2) return out;
    var v = sh.getDataRange().getValues(), h = v[0].map(String), ix = function (k) { return h.indexOf(k); };
    v.slice(1).forEach(function (r) {
      if (/CANCEL/i.test(String(r[ix('Status')]))) return;
      var d = _v89Iso_(r[ix('Date')]); if (!d || d < from || d > to) return;
      var cat = String(r[ix('Category')] || ''), a = Number(r[ix('Amount')]) || 0;
      if (/оплаты труда/i.test(cat)) { out.payroll += a; out.payrollN++; return; }
      out.total += a; out.n++; if (/комисс|эквайр|банковск/i.test(cat)) out.commission += a; if (/доставк/i.test(cat)) out.delivery += a;
      out.rows.push({ date: d, cat: cat, amount: a });
    });
  } catch (e) { out.error = String(e.message || e); }
  return out;
}
function _v89Budget_(from, to, loc) {
  var rows = _v89Rows_(MC_V89_BG_, MC_V89_BG_HEAD_).filter(function (r) { return !r.LocationID || r.LocationID === '*' || String(r.LocationID) === loc; }), plan = { revenue: null, expenses: null, how: '' };
  var sum = function (art) {
    var t = 0, hit = false, how = [];
    var R = rows.filter(function (r) { return String(r['Статья']).trim().toLowerCase() === art; });
    for (var d = from; d <= to; d = _v89AddDays_(d, 1)) {
      var day = R.filter(function (r) { return !/мес/i.test(String(r['Тип периода'])) && _v89Iso_(r['Период']) === d; })[0];
      if (day) { t += Number(day['Сумма']) || 0; hit = true; how.push('план дня'); continue; }
      var m = d.slice(0, 7), mon = R.filter(function (r) { return /мес/i.test(String(r['Тип периода'])) && _v89Iso_(r['Период']).slice(0, 7) === m; })[0];
      if (mon) { var dim = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate(); t += (Number(mon['Сумма']) || 0) / dim; hit = true; how.push('месячный план / ' + dim + ' дн.'); }
    }
    return hit ? { v: _v89R2_(t), how: how.filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', ') } : null;
  };
  var r = sum('выручка'), e = sum('расходы'); if (r) { plan.revenue = r.v; plan.how = r.how; } if (e) plan.expenses = e.v;
  return plan;
}
function _v89V79Open_(from, to) {
  try { var sh = _book_().getSheetByName('Продажи_Смена_V79'); if (!sh || sh.getLastRow() < 2) return [];
    var v = sh.getDataRange().getValues(), h = v[0].map(String), iD = h.indexOf('Дата смены'), iS = h.indexOf('Статус'), iF = h.indexOf('Файл'), iI = h.indexOf('ImportID');
    return v.slice(1).filter(function (r) { var d = _v89Iso_(r[iD]); return r[iI] && /DRAFT|ERROR/.test(String(r[iS])) && d >= _v89AddDays_(from, -1) && d <= to; })
      .map(function (r) { return { id: String(r[iI]), date: _v89Iso_(r[iD]), status: String(r[iS]), file: String(r[iF] || '') }; });
  } catch (e) { return []; }
}
function _v89Fin_(c, types, sh, nowMs) {
  var R = _v89FinRange_(types, sh, c, nowMs), F = { label: R.label, closed: R.closed, status: 'OK', reasons: [], from: R.from, to: R.to };
  try {
    var a = _v89FinCalc_(R.from, R.to); F.a = a;
    try { var b = _v89FinCalc_(R.cmp, R.cmp); F.cmp = b.lines ? { date: R.cmp, net: b.net } : null; } catch (e) { F.cmp = null; }
    if (!a.lines) { F.reasons.push('продаж за период в журнале продаж нет — выручка не подтверждена'); }
    if (a.revBad) F.reasons.push('продаж без цены: ' + a.revBad + ' (MISSING_SALE_PRICE)');
    F.cogsKnown = a.lines > 0 && !a.costBad; if (a.costBad) F.reasons.push('себестоимость неполная: ' + a.costBad + ' строк без цены партии или на проверке');
    var ex = _v89Expenses_(R.from, R.to); F.ex = ex; if (ex.error) F.reasons.push('расходы не прочитаны: ' + ex.error); else if (!ex.n) F.reasons.push('расходы за период не внесены');
    F.plan = _v89Budget_(R.from, R.to, c.LocationID); if (F.plan.revenue === null) F.reasons.push('план выручки (бюджет) не задан');
    F.v79 = _v89V79Open_(R.from, R.to); if (F.v79.length) F.reasons.push('не подтверждено документов о продажах: ' + F.v79.length + ' — в отчёт не входят');
    if (F.reasons.length) F.status = 'PARTIAL_DATA';
  } catch (e) { F.status = 'ERROR'; F.error = String(e.message || e); F.reasons.push('экономика не рассчитана: ' + F.error); }
  return F;
}

/* ---------------- данные: склад, партии, закупки ---------------- */
function _v89Base_(q, u) { var b = _toBaseUnitServer_(Number(q) || 0, u || 'г'); return { q: b.qty, u: b.unit }; }
function _v89InUnit_(baseQ, unit) { var one = _toBaseUnitServer_(1, unit || 'г').qty || 1; return baseQ / one; }
function _v89Q_(baseQ, bu) { return _v88Fmt_(baseQ, bu); }
/** Партии склада (один проход по листу): остатки по продукту, карантин, сроки. */
function _v89Stock_(nowMs) {
  var sh = _stockBatchesSheet_(), v = sh.getDataRange().getValues(), h = v[0].map(String), blk = _v71Blocked_(), today = _v71Day_(new Date(nowMs));
  var iMade = h.indexOf('Дата изготовления'), iSup = h.indexOf('SupplierID'), out = { batches: [], byKey: {} };
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0]) continue;
    var rem = parseFloat(r[9]) || 0, st = String(r[10] || 'active'); if (!(rem > 0.0005)) continue;
    if (/^(consumed|wasted|written_off|returned)$/.test(st)) continue;
    var unit = String(r[2] || 'г'), b = _v89Base_(rem, unit), ed = r[5] ? _v71Day_(r[5]) : '', key = _prodKey_(r[1]) + '|' + b.u;
    var x = { id: String(r[0]), product: String(r[1]), unit: unit, rem: rem, base: b.q, bu: b.u, expiry: ed, received: r[4] ? _v71Day_(r[4]) : '', made: iMade >= 0 && r[iMade] ? _v71Day_(r[iMade]) : '',
      price: parseFloat(r[6]) || 0, status: blk[String(r[0])] ? 'blocked' : st, supplierId: iSup >= 0 ? String(r[iSup] || '') : '', source: String(r[7] || ''), key: key };
    x.value = _v89R2_(rem * x.price);
    out.batches.push(x);
    var k = out.byKey[key] || (out.byKey[key] = { avail: 0, quarantine: 0, expired: 0, name: x.product, bu: b.u });
    if (x.status === 'quarantine') k.quarantine += b.q; else if (x.status === 'active' && (!ed || ed >= today)) k.avail += b.q; else if (ed && ed < today) k.expired += b.q;
  }
  return out;
}
function _v89Reserved_() {
  var m = {};
  try { if (typeof _mcV22Res_ !== 'function') return m; var v = _mcV22Res_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (String(v[i][9]) === 'ACTIVE') { var b = _v89Base_(v[i][5], v[i][6]), k = _prodKey_(v[i][1]) + '|' + b.u; m[k] = (m[k] || 0) + b.q; } } catch (e) {}
  return m;
}
function _v89Orders_() {
  var out = { byKey: {}, list: [] };
  try {
    var v = _supplierOrdersSheet_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      var r = v[i]; if (!r[0]) continue; var st = String(r[3] || 'draft'); if (!/^(draft|sent|confirmed|partial)$/.test(st)) continue;
      var items = [], got = []; try { items = JSON.parse(r[4] || '[]'); } catch (e) {} try { got = JSON.parse(r[8] || '[]'); } catch (e) {}
      var o = { id: String(r[0]), supplier: String(r[2] || ''), status: st, due: r[7] instanceof Date ? _v71Day_(r[7]) : String(r[7] || ''), items: items.length };
      out.list.push(o);
      items.forEach(function (it) {
        if (!it || !it.name) return; var b = _v89Base_(it.qty, it.unit), k = _prodKey_(it.name) + '|' + b.u, rec = 0;
        got.forEach(function (g) { if (g && _prodKey_(g.name) === _prodKey_(it.name)) { var gb = _v89Base_(g.qty, g.unit); if (gb.u === b.u) rec += gb.q; } });
        var left = Math.max(0, b.q - rec), e = out.byKey[k] || (out.byKey[k] = { incoming: 0, draft: 0, orders: [] });
        if (st === 'draft') e.draft += left; else e.incoming += left;
        e.orders.push(o.id + ' (' + ({ draft: 'черновик', sent: 'отправлена', confirmed: 'подтверждена', partial: 'частично получена' })[st] + (o.due ? ', срок ' + String(o.due).split('-').reverse().join('.') : '') + ')');
      });
    }
  } catch (e) { out.error = String(e.message || e); }
  return out;
}
function _v89Balances_() {
  var m = {};
  try { var v = _stockBalanceSheet_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) { if (!v[i][0]) continue; var u = String(v[i][1] || 'г'), b = _v89Base_(1, u), k = _prodKey_(v[i][0]) + '|' + b.u;
      m[k] = { name: String(v[i][0]), unit: u, rest: parseFloat(v[i][2]) || 0, min: parseFloat(v[i][3]) || 0, lastPrice: parseFloat(v[i][5]) || parseFloat(v[i][4]) || 0 }; } } catch (e) {}
  return m;
}
function _v89Sup_() { var m = {}; try { _mdSuppliers_().forEach(function (s) { m[String(s.id || s.SupplierID)] = s; m['N:' + _mdNorm_(s.name || s['Название'])] = s; }); } catch (e) {} return m; }
function _v89SupName_(S, id, name) { var s = S[String(id)] || S['N:' + _mdNorm_(name)]; return s ? { id: String(s.id || s.SupplierID || id), name: String(s.name || s['Название'] || name), contact: String(s.contacts || s['Контакты'] || ''), status: String(s.status || s['Статус'] || '') } : (name ? { id: String(id || ''), name: name, contact: '' } : null); }
/** Заявка по поставщикам (ТЗ 6.2): max(0, целевой × коэф. + страховой − доступно − приход + резерв), мин. партия, кратность. */
function _v89Proc_(c, nowMs, ST) {
  var P = { status: 'OK', suppliers: [], unmapped: [], warnings: [], reasons: [], avgDays: Math.max(7, Math.min(56, parseInt(_v89Prop_('MC_V89_AVG_DAYS', '14'), 10) || 14)) };
  try {
    var bal = _v89Balances_(), res = _v89Reserved_(), O = _v89Orders_(), S = _v89Sup_(), turn = _turnoverByProduct_(P.avgDays), today = _v71Day_(new Date(nowMs)), lastSup = {};
    if (O.error) P.reasons.push('заказы поставщикам не прочитаны: ' + O.error);
    ST.batches.forEach(function (b) { if (b.supplierId && !lastSup[b.key]) lastSup[b.key] = b.supplierId; });
    var prm = {}; _v89Rows_(MC_V89_PP_, MC_V89_PP_HEAD_).forEach(function (r) { if (!_v89B_(r['Активен'], true) || !r['Продукт']) return; var u = String(r['Ед.'] || (bal[_prodKey_(r['Продукт']) + '|г'] || {}).unit || 'кг'), b = _v89Base_(1, u); prm[_prodKey_(r['Продукт']) + '|' + b.u] = { r: r, unit: u }; });
    var keys = Object.keys(prm); Object.keys(bal).forEach(function (k) { if (bal[k].min > 0 && keys.indexOf(k) < 0) keys.push(k); });
    var groups = {};
    keys.forEach(function (k) {
      var p = prm[k] ? prm[k].r : null, B = bal[k] || {}, unit = prm[k] ? prm[k].unit : (B.unit || 'кг'), name = p ? String(p['Продукт']) : B.name, bu = k.split('|')[1];
      var num = function (col) { var x = p ? _v89N_(p[col]) : NaN; return isFinite(x) && String(p[col]) !== '' ? x : null; };
      var toB = function (x) { return x === null ? null : _v89Base_(x, unit).q; };
      var minB = toB(num('Мин. запас')), tgtB = toB(num('Целевой запас')), safB = toB(num('Страховой запас')) || 0, mbB = toB(num('Мин. партия')), mulB = toB(num('Кратность')), lead = num('Срок поставки, дн'), coef = num('Коэффициент') || 1, basis = [];
      if (minB === null && B.min > 0) { minB = _v89Base_(B.min, B.unit).q; basis.push('мин. запас — «Норма запаса» склада'); }
      if (tgtB === null && minB !== null) { tgtB = minB; basis.push('целевой запас не задан — взят минимальный'); }
      if (tgtB === null) return;
      var stk = ST.byKey[k] || { avail: 0, quarantine: 0 }, avail = stk.avail, inc = (O.byKey[k] || {}).incoming || 0, draft = (O.byKey[k] || {}).draft || 0, rsv = res[k] || 0;
      var t = turn[k], avg = t ? t.qty / P.avgDays : 0, days = avg > 0 ? avail / avg : null;
      var need = Math.max(0, tgtB * coef + safB - avail - inc + rsv), q = need;
      if (q > 0 && mbB && q < mbB) { q = mbB; basis.push('мин. партия поставщика'); }
      if (q > 0 && mulB) { var qq = Math.ceil(q / mulB - 1e-9) * mulB; if (qq !== q) basis.push('кратность упаковки'); q = qq; }
      if (!(q > 0)) return;
      var leadD = lead === null ? null : lead, rd = today;
      if (leadD !== null) rd = _v89AddDays_(today, leadD);
      if (days !== null) { var ro = _v89AddDays_(today, Math.max(0, Math.floor(days) - 1)); if (ro > rd) rd = ro; }
      var prio = (avail <= 0 && avg > 0) || (days !== null && leadD !== null && days < leadD) ? 'КРИТИЧНО' : (minB !== null && avail < minB ? 'ВАЖНО' : 'ОБЫЧНО');
      var fu = function (x) { return _v89Q_(x, bu); };
      var row = { product: name, code: (p && p.ProductID) || '', unit: unit, bu: bu, avail: avail, availText: fu(avail), quarantineText: stk.quarantine > 0 ? fu(stk.quarantine) : '', min: minB, minText: minB === null ? '—' : fu(minB),
        target: tgtB, targetText: fu(tgtB), avgDay: avg, avgText: avg > 0 ? fu(avg) + '/день' : 'нет расхода за ' + P.avgDays + ' дн.', daysLeft: days === null ? null : Math.round(days * 10) / 10,
        incomingText: inc > 0 ? fu(inc) : '', draftText: draft > 0 ? fu(draft) : '', reservedText: rsv > 0 ? fu(rsv) : '', qty: q, qtyText: fu(q), qtyUnit: _v89R2_(_v89InUnit_(q, unit)), recDate: rd, lead: leadD, prio: prio,
        orders: (O.byKey[k] || {}).orders || [], lastPrice: B.lastPrice || 0, sum: B.lastPrice ? _v89R2_(_v89InUnit_(q, B.unit || unit) * B.lastPrice) : null,
        basis: 'целевой ' + fu(tgtB) + (coef !== 1 ? ' × ' + String(coef).replace('.', ',') : '') + (safB ? ' + страховой ' + fu(safB) : '') + ' − доступно ' + fu(avail) + (inc ? ' − в пути ' + fu(inc) : '') + (rsv ? ' + резерв ' + fu(rsv) : '') + ' = ' + fu(need) + (q !== need ? ' → ' + fu(q) : '') + (basis.length ? ' (' + basis.join('; ') + ')' : '') + (leadD === null ? '; срок поставки не задан' : '') };
      var sup = p ? _v89SupName_(S, p.SupplierID, String(p['Поставщик'] || '')) : null;
      if (!sup) { var ls = lastSup[k] ? _v89SupName_(S, lastSup[k], '') : null; row.hint = ls ? 'последняя поставка — ' + ls.name : ''; P.unmapped.push(row); return; }
      var g = groups[sup.id || sup.name] || (groups[sup.id || sup.name] = { id: sup.id, name: sup.name, contact: sup.contact, blocked: /BLOCK/i.test(sup.status), rows: [] });
      g.rows.push(row);
    });
    P.suppliers = Object.keys(groups).map(function (k) { var g = groups[k]; g.rows.sort(function (a, b) { return MC_V89_PRIO_.indexOf(a.prio) - MC_V89_PRIO_.indexOf(b.prio) || a.product.localeCompare(b.product, 'ru'); });
      g.sum = g.rows.every(function (r) { return r.sum !== null; }) ? _v89R2_(g.rows.reduce(function (a, r) { return a + r.sum; }, 0)) : null; return g; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
    if (P.unmapped.length) P.warnings.push({ code: 'SUPPLIER_NOT_MAPPED', prio: 'ВАЖНО', text: 'Нужно заказать, но поставщик не указан: ' + P.unmapped.map(function (r) { return r.product; }).join(', ') + ' — укажите поставщика в «Параметрах закупки»' });
    P.suppliers.filter(function (g) { return g.blocked; }).forEach(function (g) { P.warnings.push({ code: 'SUPPLIER_BLOCKED', prio: 'ВАЖНО', text: 'Поставщик «' + g.name + '» заблокирован — заявку ему не отправлять' }); });
    P.open = O.list; P.showContact = _v89B_(_v89Prop_('MC_V89_SHOW_CONTACT', ''), false);
    if (P.reasons.length) P.status = 'PARTIAL_DATA';
  } catch (e) { P.status = 'ERROR'; P.error = String(e.message || e); P.reasons.push('заявки не рассчитаны: ' + P.error); }
  return P;
}

/* ---------------- данные: сроки годности ---------------- */
function _v89XRules_(loc) { return _v89Rows_(MC_V89_XR_, MC_V89_XR_HEAD_).filter(function (r) { return _v89B_(r['Активно'], true) && (!r.LocationID || r.LocationID === '*' || String(r.LocationID) === loc); }); }
/** Пороги партии: самое точное правило (продукт → категория → тип); по умолчанию срочно ≤ 24 ч, короткий срок (≤ 72 ч всего) — ≤ 48 ч; показывать ≤ 7 дней. */
function _v89Thr_(b, rules) {
  var nm = _mdNorm_(b.product), pf = /п\s*\/\s*ф|полуфабрикат/i.test(b.product) || /производств|выпуск/i.test(b.source), shelfH = b.expiry && b.received ? (Date.parse(b.expiry) - Date.parse(b.received)) / 36e5 + 24 : null;
  var pick = function (area) { return rules.filter(function (r) { var a = String(r['Область']).toLowerCase(), val = String(r['Значение'] || '');
    if (area === 'продукт') return /продукт/.test(a) && _mdNorm_(val) === nm;
    if (area === 'категория') return /категор/.test(a) && val.split('|').some(function (w) { w = _mdNorm_(w); return w && nm.indexOf(w) >= 0; });
    if (area === 'тип') return /тип/.test(a) && (/п\/?ф|полуф/i.test(val) ? pf : /сыр/i.test(val) ? !pf : /корот/i.test(val) ? shelfH !== null && shelfH <= 72 : false);
    return false; })[0]; };
  var r = pick('продукт') || pick('категория') || pick('тип'), u = r ? _v89N_(r['Срочно, ч']) : NaN, s = r ? _v89N_(r['Показывать, ч']) : NaN;
  var defU = shelfH !== null && shelfH <= 72 ? 48 : 24;
  return { urgent: isFinite(u) && u > 0 ? u : defU, show: isFinite(s) && s > 0 ? s : 168, rule: r ? String(r['Область']) + ': ' + r['Значение'] : (defU === 48 ? 'короткий срок годности — по умолчанию 48 ч' : 'по умолчанию') };
}
function _v89Cat_(h) { return h === null ? 'NO_EXPIRY_DATE' : h < 0 ? 'EXPIRED' : h <= 24 ? 'EXPIRING_24H' : h <= 48 ? 'EXPIRING_48H' : h <= 72 ? 'EXPIRING_72H' : h <= 168 ? 'EXPIRING_7D' : 'OK'; }
function _v89Exp_(c, nowMs, ST) {
  var E = { status: 'OK', rows: [], counts: {}, reasons: [] };
  try {
    var rules = _v89XRules_(c.LocationID), tz = _mcTz_();
    Object.keys(MC_V89_CATS_).forEach(function (k) { E.counts[k] = 0; });
    ST.batches.forEach(function (b) {
      var end = b.expiry ? _v89At_(b.expiry, '23:59', tz) : null, h = end ? (end.getTime() + 59999 - nowMs) / 36e5 : null, cat = _v89Cat_(h), T = _v89Thr_(b, rules);
      E.counts[cat]++;
      if (cat === 'OK') return; if (cat !== 'EXPIRED' && cat !== 'NO_EXPIRY_DATE' && h > T.show) return;
      var prio = cat === 'EXPIRED' ? 'КРИТИЧНО' : cat === 'NO_EXPIRY_DATE' ? 'ВАЖНО' : h <= T.urgent ? 'ВАЖНО' : 'ОБЫЧНО';
      if (b.status === 'quarantine' && prio === 'ОБЫЧНО') prio = 'ВАЖНО';
      var act = cat === 'EXPIRED' ? 'Продавать и использовать нельзя: заблокировать, оформить списание (причина «Истёк срок») или возврат поставщику'
        : b.status === 'quarantine' ? 'Завершить входной контроль — до решения в работу не идёт' : b.status === 'blocked' ? 'Решение ответственного за ХАССП по блокировке'
        : cat === 'NO_EXPIRY_DATE' ? 'Установить срок по этикетке производителя или таблице сроков — до этого не использовать' : h <= T.urgent ? 'Использовать в первую очередь: go-лист, заготовки, питание персонала' : 'Планировать расход по FEFO';
      E.rows.push({ batchId: b.id, product: b.product, qtyText: _v89Q_(b.base, b.bu), loc: c.name, made: b.made ? b.made.split('-').reverse().join('.') : '—', expiry: b.expiry ? b.expiry.split('-').reverse().join('.') : '—',
        hours: h === null ? null : Math.round(h), daysText: h === null ? '—' : h < 0 ? 'истёк ' + Math.ceil(-h / 24) + ' дн. назад' : h < 24 ? 'менее суток (' + Math.max(0, Math.floor(h)) + ' ч)' : Math.floor(h / 24) + ' дн.',
        price: b.price, priceText: b.price ? _v88PriceTxt_(b.price / (_toBaseUnitServer_(1, b.unit).qty || 1), b.bu) : 'нет цены', value: b.value, status: b.status,
        statusRu: ({ active: 'в работе', quarantine: 'входной контроль', blocked: 'заблокирована', expired: 'просрочена' })[b.status] || b.status, owner: cat === 'EXPIRED' || b.status !== 'active' ? 'Ответственный за ХАССП, кладовщик' : 'Шеф-повар, кладовщик',
        action: act, cat: cat, catRu: MC_V89_CATS_[cat], prio: prio, rule: T.rule });
    });
    E.rows.sort(function (a, b) { return MC_V89_PRIO_.indexOf(a.prio) - MC_V89_PRIO_.indexOf(b.prio) || (a.hours === null ? 1e9 : a.hours) - (b.hours === null ? 1e9 : b.hours); });
  } catch (e) { E.status = 'ERROR'; E.error = String(e.message || e); E.reasons.push('сроки не рассчитаны: ' + E.error); }
  return E;
}

/* ---------------- предложения по складу (ТЗ 10): только предложения, остатки не меняются ---------------- */
function _v89SgRows_() { return _v89Rows_(MC_V89_SG_, MC_V89_SG_HEAD_); }
function _v89Sugg_(c, sh, nowMs, ST, E, persist) {
  var G = { status: 'OK', rows: [], skipped: [], reasons: [], note: 'Перемещение между площадками и возврат поставщику не предлагаются: в MON CHEF один склад, условий возврата поставщиков в системе нет.' };
  try {
    var day = Utilities.formatDate(new Date(nowMs), c.tz, 'yyyy-MM-dd'), idx = _buildDishIndexes_(), lp = _v88LastPrice_(), byKey = {}, due = sh && sh.endAt ? sh.endAt : _v89At_(day, '23:59', c.tz);
    ST.batches.forEach(function (b) { (byKey[b.key] = byKey[b.key] || []).push(b); });
    var B = {}; ST.batches.forEach(function (b) { B[b.id] = b; });
    var add = function (b, action, reason, rec, prio, effect, link, dueAt, role) {
      G.rows.push({ key: day + '|' + c.LocationID + '|' + (b ? b.id : rec.slice(0, 40)) + '|' + action, batchId: b ? b.id : '', product: b ? b.product : rec.split(':')[0], remText: b ? _v89Q_(b.base, b.bu) : '', unit: b ? b.bu : '',
        expiry: b && b.expiry ? b.expiry.split('-').reverse().join('.') : '', reason: reason, action: action, actionRu: MC_V89_ACTIONS_[action], rec: rec, due: dueAt || due, role: role, effect: effect, risk: prio, prio: prio, link: link || '' });
    };
    E.rows.forEach(function (x) {
      var b = B[x.batchId]; if (!b) return;
      if (!b.bu || !/^(г|мл|шт|порц\.?)$/.test(b.bu)) { G.skipped.push(b.product + ' (партия ' + b.id + '): единица измерения не подтверждена'); return; }
      if (x.cat === 'EXPIRED') { add(b, 'WRITE_OFF', 'срок годности истёк ' + x.expiry, 'Заблокировать и оформить списание с причиной «Истёк срок» (или возврат поставщику по договору) — продавать и использовать нельзя', 'КРИТИЧНО', b.value, '', due, 'Кладовщик, ответственный за ХАССП'); return; }
      if (x.cat === 'NO_EXPIRY_DATE') { add(b, 'QUALITY_TASK', 'срок годности не указан', 'Установить срок по этикетке производителя или таблице сроков предприятия; до этого партию не использовать', 'ВАЖНО', null, '', due, 'Ответственный за ХАССП'); return; }
      if (b.status !== 'active') { G.skipped.push(b.product + ' (партия ' + b.id + '): ' + x.statusRu + ' — предложения не формируются'); return; }
      var exEnd = _v89At_(b.expiry, '23:59', _mcTz_()), dAt = exEnd && exEnd < due ? exEnd : due;
      var later = (byKey[b.key] || []).filter(function (o) { return o.id !== b.id && o.status === 'active' && o.expiry && o.expiry > b.expiry; });
      if (later.length) add(b, 'FEFO_FIRST', x.catRu, 'Брать эту партию раньше партий ' + later.map(function (o) { return o.id + ' (до ' + o.expiry.split('-').reverse().join('.') + ')'; }).join(', '), x.prio, b.value, '', dAt, 'Кладовщик, повара');
      var D = _v88DishesFor_(b.product, b.base, b.bu, idx, lp).filter(function (d) { return d.portions > 0; });
      var pf = D.filter(function (d) { return d.via; }).map(function (d) { return d.via; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      if (pf.length) add(b, 'TO_PRODUCTION', x.catRu, 'Заготовить из этой партии: ' + pf.join(', ') + ' (по ТТК)', x.prio, b.value, pf.join(', '), dAt, 'Шеф-повар');
      if (D.length) add(b, 'MENU_OF_DAY', x.catRu, 'Включить в меню дня / go-лист: ' + D.slice(0, 5).map(function (d) { return d.name + ' — до ' + d.portions + ' порц.'; }).join('; '), x.prio, b.value, D.slice(0, 5).map(function (d) { return d.name; }).join(', '), dAt, 'Шеф-повар, администратор');
      if (!later.length && !D.length) G.skipped.push(b.product + ' (партия ' + b.id + '): в блюдах ТТК не используется — решение руководителя (персонал, пересорт, списание)');
    });
    // сверка: агрегированный остаток склада и сумма остатков партий
    var bal = _v89Balances_();
    Object.keys(bal).forEach(function (k) {
      var a = bal[k], agg = _v89Base_(a.rest, a.unit).q, sum = (byKey[k] || []).reduce(function (t, b) { return t + (b.status === 'active' || b.status === 'quarantine' ? b.base : 0); }, 0), bu = k.split('|')[1];
      if (Math.abs(agg - sum) > Math.max(0.05 * Math.max(agg, sum), bu === 'шт' ? 0.5 : 50)) add(null, 'INVENTORY_CHECK', 'остаток склада ' + _v89Q_(agg, bu) + ', по партиям ' + _v89Q_(sum, bu), a.name + ': проверить фактический остаток и провести корректировку с основанием', 'ОБЫЧНО', null, '', due, 'Кладовщик');
    });
    // сохранить (один раз за день на партию и действие), просроченные предложения — EXPIRED
    var have = {}; _v89SgRows_().forEach(function (r) { have[String(r['Ключ'])] = r; });
    G.rows.forEach(function (x) {
      var r = have[x.key];
      if (r) { x.id = String(r.SuggestionID); x.status = String(r['Статус'] || 'SUGGESTED'); x.by = String(r['Решил'] || ''); return; }
      x.id = _v89Id_('SG'); x.status = 'SUGGESTED';
      if (persist) _v89Put_(MC_V89_SG_, MC_V89_SG_HEAD_, { SuggestionID: x.id, 'Ключ': x.key, 'Создано': new Date(nowMs), LocationID: c.LocationID, BatchID: x.batchId, 'Продукт': x.product, 'Остаток': x.remText, 'Ед.': x.unit,
        'Срок годности': x.expiry, 'Причина': x.reason, 'Действие': x.action, 'Рекомендация': x.rec, 'Срок выполнения': x.due, 'Ответственная роль': x.role, 'Эффект, ₽': x.effect === null ? '' : x.effect, 'Риск': x.risk, 'Ссылка': x.link, 'Статус': 'SUGGESTED' });
    });
    if (persist) _v89SgRows_().forEach(function (r) { var d = r['Срок выполнения']; if (String(r['Статус']) === 'SUGGESTED' && d instanceof Date && d.getTime() < nowMs) _v89Put_(MC_V89_SG_, MC_V89_SG_HEAD_, { 'Статус': 'EXPIRED', 'Комментарий': 'срок выполнения прошёл без решения' }, r._row); });
    G.rows.sort(function (a, b) { return MC_V89_PRIO_.indexOf(a.prio) - MC_V89_PRIO_.indexOf(b.prio); });
    try { G.resort = _v88ActiveRs_().map(function (a) { return a.product + ' вместо «' + a.target + '», осталось ' + _v88Fmt_(a.remainBase, a.baseUnit); }); } catch (e) { G.resort = []; }
    try { var rep = _v88Report_(_v71Day_(new Date(nowMs))); G.resortReport = rep && rep.items && rep.items.length ? rep : null; } catch (e) { G.resortReport = null; }
  } catch (e) { G.status = 'ERROR'; G.error = String(e.message || e); G.reasons.push('предложения не сформированы: ' + G.error); }
  return G;
}

/* ---------------- незавершённые задачи смены ---------------- */
function _v89Tasks_(c, types, sh, nowMs, ST, E, P) {
  var T = { status: 'OK', rows: [], reasons: [], runout: [], critical: [] }, tz = c.tz, today = Utilities.formatDate(new Date(nowMs), _mcTz_(), 'yyyy-MM-dd'), due = sh && sh.endAt ? sh.endAt : null;
  var add = function (prio, text, role, src, dueAt) { T.rows.push({ prio: prio, text: text, role: role, src: src, due: dueAt || due }); };
  var safe = function (name, fn) { try { fn(); } catch (e) { T.reasons.push(name + ': ' + String(e.message || e)); } };
  safe('приёмка', function () { ST.batches.filter(function (b) { return b.status === 'quarantine'; }).forEach(function (b) {
    add(b.received && b.received < today ? 'КРИТИЧНО' : 'ВАЖНО', 'Незакрытая приёмка: входной контроль партии ' + b.id + ' «' + b.product + '» (получена ' + (b.received ? b.received.split('-').reverse().join('.') : '—') + ')', 'Ответственный за ХАССП, кладовщик', 'Приёмка'); }); });
  safe('производство', function () { var v = _productionSheet_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) { var r = v[i]; if (!r[0]) continue; var st = String(r[PROD_COL_.status]), cr = r[PROD_COL_.created] instanceof Date ? _v71Day_(r[PROD_COL_.created]) : '';
      if (st === 'IN_PROGRESS') add('ВАЖНО', 'Производство не завершено: ' + r[PROD_COL_.name] + ' (' + r[PROD_COL_.id] + ') — нет фактического выхода', 'Повар, шеф-повар', 'Производство');
      else if (st === 'PLANNED' && cr && cr < today) add('ОБЫЧНО', 'Запланировано и не начато с ' + cr.split('-').reverse().join('.') + ': ' + r[PROD_COL_.name], 'Шеф-повар', 'Производство'); } });
  safe('продажи', function () { _v89V79Open_(today, today).forEach(function (d) { add(d.status === 'ERROR' ? 'ВАЖНО' : 'ОБЫЧНО', (d.status === 'ERROR' ? 'Ошибка импорта документа о продажах ' : 'Документ о продажах не подтверждён ') + (d.file || d.id) + ' за ' + d.date.split('-').reverse().join('.') + ' — в выручку не входит', 'Администратор, руководитель смены', 'Продажи за смену'); }); });
  safe('ТТК', function () {
    var sh7 = _book_().getSheetByName('Ж_Продажи'); if (!sh7 || sh7.getLastRow() < 2) return; var v = sh7.getDataRange().getValues(), h = v[0].map(String), iD = h.indexOf('Дата'), iB = h.indexOf('Блюдо'), idx = _buildDishIndexes_(), bal = _v89Balances_(), seen = {};
    v.slice(1).forEach(function (r) { var d = _v89Iso_(r[iD]); if (d !== today) return; var n = String(r[iB] || ''); if (!n || seen[n]) return; seen[n] = 1;
      if (_findSubDish_(n, idx.dishByNormName, idx.dishByLooseName)) return; if (Object.keys(bal).some(function (k) { return k.split('|')[0] === _prodKey_(n); })) return;
      add('ВАЖНО', 'Продажа без ТТК и без товара склада: «' + n + '» — себестоимость не считается', 'Шеф-повар', 'Журнал продаж'); });
  });
  safe('санитария', function () { var s = _book_().getSheetByName('Санитария_Планы_V42'); if (!s || s.getLastRow() < 2) return; var v = s.getDataRange().getValues(), h = v[0].map(String), ix = function (k) { return h.indexOf(k); };
    v.slice(1).forEach(function (r) { if (!r[0] || /DONE|COMPLETED|CANCEL|ВЫПОЛН/i.test(String(r[ix('Status')]))) return; var d = r[ix('DueAt')] instanceof Date ? r[ix('DueAt')] : null; if (!d || (due && d > due) || (!due && _v71Day_(d) > today)) return;
      add(d.getTime() < nowMs ? 'КРИТИЧНО' : 'ОБЫЧНО', 'Санитарная обработка не отмечена: ' + r[ix('TaskName')] + ' (срок ' + _v89Fmt_(d, tz, 'dd.MM HH:mm') + ')', 'Ответственный по зоне, руководитель смены', 'Санитария', d); }); });
  safe('отклонения', function () { var v = _devSheet_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) { var r = v[i]; if (!r[0] || /закрыт|устранен|выполнен|CLOSED|RESOLVED|DONE/i.test(String(r[7])) || r[12]) continue;
      var crit = r[6] === true || /да|true/i.test(String(r[6])); add(crit ? 'КРИТИЧНО' : 'ВАЖНО', (crit ? 'Критическое отклонение не закрыто: ' : 'Отклонение не закрыто: ') + _journalName_(r[2]) + ' — ' + (r[3] || '') + ' ' + String(r[4] || '').slice(0, 80), 'Ответственный за ХАССП', 'Журналы'); } });
  safe('корректирующие действия', function () { var v = _corrSheet_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) { var r = v[i]; if (!r[0] || /выполн|закрыт|DONE|CLOSED/i.test(String(r[5]))) continue; var d = r[4] instanceof Date ? r[4] : null; if (d && d.getTime() < nowMs) add('ВАЖНО', 'Просрочено корректирующее действие: ' + String(r[2]).slice(0, 80) + ' (исполнитель ' + (r[3] || '—') + ')', 'Ответственный за ХАССП', 'Корректирующие действия', d); } });
  safe('вопросы журналов', function () { var v = _pendSheet_().getDataRange().getValues(), n = 0, late = 0, close = 0;
    for (var i = 1; i < v.length; i++) { var r = v[i]; if (!r[0]) continue; var d = r[5] instanceof Date ? Utilities.formatDate(r[5], _mcTz_(), 'yyyy-MM-dd') : String(r[5]); if (d !== today || r[8] === 'выполнено' || r[8] === 'отменено') continue;
      n++; if (/закрыти/i.test(String(r[4]) + ' ' + String(r[3]))) close++; var dl = _v89Hm_(r[7]); if (dl && _v89At_(today, dl, _mcTz_()).getTime() < nowMs) late++; }
    if (close && types.indexOf('CLOSING') >= 0) add('ВАЖНО', 'Чек-лист закрытия смены: не отвечено пунктов — ' + close, 'Руководитель смены, повара', 'Журналы');
    if (late) add('ВАЖНО', 'Просрочены вопросы журналов на сегодня: ' + late, 'Сотрудники по журналам', 'Журналы'); else if (n - close > 0) add('ОБЫЧНО', 'Вопросов журналов на сегодня без ответа: ' + (n - close), 'Сотрудники по журналам', 'Журналы'); });
  // остатки, которые закончатся до закрытия смены (средний расход за день → в час)
  if (types.indexOf('MORNING') < 0 || types.length > 1) safe('остатки', function () {
    var bal = _v89Balances_(), days = (P && P.avgDays) || 14, turn = _turnoverByProduct_(days), left = due ? Math.max(0, (due.getTime() - nowMs) / 36e5) : null;
    Object.keys(bal).forEach(function (k) { var a = bal[k], s = ST.byKey[k] || { avail: 0 }, t = turn[k], perH = t ? t.qty / days / 24 : 0, bu = k.split('|')[1], min = a.min ? _v89Base_(a.min, a.unit).q : 0;
      if (left !== null && perH > 0 && s.avail < perH * left) T.runout.push({ prio: 'КРИТИЧНО', product: a.name, availText: _v89Q_(s.avail, bu), needText: _v89Q_(perH * left, bu), text: a.name + ': доступно ' + _v89Q_(s.avail, bu) + ', до закрытия уйдёт около ' + _v89Q_(perH * left, bu) + ' (средний расход за ' + days + ' дн.)' });
      else if (min && s.avail < min) T.critical.push({ prio: 'ВАЖНО', product: a.name, text: a.name + ': доступно ' + _v89Q_(s.avail, bu) + ' — ниже минимального запаса ' + _v89Q_(min, bu) }); });
  });
  if (types.indexOf('CLOSING') >= 0) (E.rows || []).filter(function (x) { return x.status === 'active' && (x.cat === 'EXPIRING_24H' || x.cat === 'EXPIRED'); }).forEach(function (x) {
    add(x.cat === 'EXPIRED' ? 'КРИТИЧНО' : 'ВАЖНО', 'Нельзя оставить на следующую смену без решения: ' + x.product + ' (партия ' + x.batchId + ', ' + x.daysText + ') — ' + (x.cat === 'EXPIRED' ? 'списать или вернуть' : 'использовать, переработать или списать по правилам'), x.owner, 'Сроки годности'); });
  T.rows.sort(function (a, b) { return MC_V89_PRIO_.indexOf(a.prio) - MC_V89_PRIO_.indexOf(b.prio); });
  if (T.reasons.length) T.status = 'PARTIAL_DATA';
  return T;
}

/* ---------------- сбор отчёта ---------------- */
function _v89Collect_(c, w, nowMs, persist) {
  var types = w.types, sh = w.shift, D = { c: { id: c.TriggerConfigID, org: c.OrganizationID, orgName: _v89OrgName_() || c.OrganizationID, loc: c.LocationID, locName: c.name, tz: c.tz, inc: c.inc },
    types: types, shift: sh, plannedAt: w.at, late: !!w.late, flags: (w.flags || []).slice(), merged: w.merged || '', generatedAt: new Date(nowMs), warnings: [] };
  if (w.late) D.flags.push('LATE_NOTIFICATION');
  var ST = null; try { ST = _v89Stock_(nowMs); } catch (e) { ST = { batches: [], byKey: {} }; D.warnings.push({ code: 'PARTIAL_DATA', prio: 'ВАЖНО', text: 'Партии склада не прочитаны: ' + String(e.message || e) }); }
  if (c.inc.fin) D.fin = _v89Fin_(c, types, sh, nowMs);
  if (c.inc.sup) { D.proc = _v89Proc_(c, nowMs, ST); D.warnings = D.warnings.concat(D.proc.warnings || []); }
  D.exp = _v89Exp_(c, nowMs, ST);
  if (c.inc.rs) D.sugg = _v89Sugg_(c, sh, nowMs, ST, D.exp, persist);
  D.tasks = _v89Tasks_(c, types, sh, nowMs, ST, D.exp, D.proc);
  try { D.openOrders = _v89Orders_().list; } catch (e) { D.openOrders = []; }
  var parts = [['Финансы', D.fin], ['Закупки', D.proc], ['Сроки годности', D.exp], ['Предложения', D.sugg], ['Задачи', D.tasks]].filter(function (p) { return p[1]; });
  D.completeness = { status: parts.some(function (p) { return p[1].status === 'ERROR' || p[1].status === 'PARTIAL_DATA'; }) || D.warnings.some(function (x) { return x.code === 'PARTIAL_DATA'; }) ? 'PARTIAL_DATA' : 'OK',
    parts: parts.map(function (p) { return { name: p[0], status: p[1].status, reasons: p[1].reasons || [] }; }) };
  if (D.completeness.status === 'PARTIAL_DATA' && D.flags.indexOf('PARTIAL_DATA') < 0) D.flags.push('PARTIAL_DATA');
  D.hash = _v89Sha_(JSON.stringify(_v89Facts_(D)));
  return D;
}
/** Содержательная часть отчёта для хеша (без времени формирования). */
function _v89Facts_(D) {
  return { t: D.types, s: [D.shift.id, D.shift.date], f: D.fin && D.fin.a ? [D.fin.a.net, D.fin.a.cogs, D.fin.a.lines, D.fin.ex && D.fin.ex.total] : null,
    p: D.proc ? D.proc.suppliers.map(function (g) { return [g.name, g.rows.map(function (r) { return [r.product, r.qtyText]; })]; }).concat([(D.proc.unmapped || []).map(function (r) { return r.product + r.qtyText; })]) : null,
    e: (D.exp.rows || []).map(function (x) { return [x.batchId, x.cat, x.prio, x.status]; }), g: D.sugg ? D.sugg.rows.map(function (x) { return x.key; }) : null,
    k: D.tasks.rows.map(function (x) { return x.prio + x.text; }).concat(D.tasks.runout.map(function (x) { return x.text; })) };
}

/* ---------------- письмо: HTML, текст, таблицы вложений ---------------- */
function _v89E_(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
var MC_V89_PCOL_ = { 'КРИТИЧНО': '#b3261e', 'ВАЖНО': '#c25e00', 'ОБЫЧНО': '#8a6d00' };
function _v89Chip_(p) { return '<span style="display:inline-block;padding:1px 6px;border-radius:9px;font-size:11px;font-weight:bold;color:#fff;background:' + (MC_V89_PCOL_[p] || '#666') + '">' + _v89E_(p) + '</span>'; }
function _v89Subject_(D) {
  var t = D.types, loc = D.c.locName, tag = '[MonChef][' + t.map(function (x) { return MC_V89_TYPES_[x]; }).join('+') + ']' + (D.late ? '[LATE_NOTIFICATION]' : '') + (D.manual ? '[ПОВТОР]' : '');
  if (t.length === 1 && t[0] === 'MORNING') return tag + ' ' + loc + ' — смена ' + (D.shift.startAt ? _v89Fmt_(D.shift.startAt, D.c.tz) : D.shift.date.split('-').reverse().join('.')) + ': финансы, закупки и сроки годности';
  if (t.length === 1 && t[0] === 'MIDDAY') return tag + ' ' + loc + ' — контроль смены: продажи, склад и задачи';
  if (t.length === 1 && t[0] === 'CLOSING') return tag + ' ' + loc + ' — за 2 часа до закрытия: финансы, склад и незавершённые задачи';
  return tag + ' ' + loc + ' — ' + t.map(function (x) { return ({ MORNING: 'утро', MIDDAY: 'контроль смены', CLOSING: 'закрытие' })[x]; }).join(' и ') + ': финансы, склад и задачи';
}
function _v89Sev_(D, V) {
  var all = [].concat(D.warnings || [], D.tasks.rows, D.tasks.runout, D.tasks.critical, V.E ? D.exp.rows : [], V.P && D.proc ? [].concat.apply([], D.proc.suppliers.map(function (g) { return g.rows; })).concat(D.proc.unmapped) : [], D.sugg ? D.sugg.rows.filter(function (x) { return x.status === 'SUGGESTED'; }) : []);
  var best = 3; all.forEach(function (x) { var i = MC_V89_PRIO_.indexOf(x.prio); if (i >= 0 && i < best) best = i; });
  return { level: best < 3 ? MC_V89_PRIO_[best] : '', items: all.length };
}
/** Письмо для варианта прав V {F,P,W,E}. Возвращает {subject, html, text, sheets}. */
function _v89Render_(D, V, att) {
  var tz = D.c.tz, H = [], X = [], S = { 'Итоги': [['Показатель', 'Значение']], 'Финансы': [['Показатель', 'Значение', 'Примечание']], 'Поставщики': [['Поставщик', 'Товар', 'Код', 'Остаток', 'Мин. запас', 'Целевой запас', 'Расход в день', 'Дней до исчерпания', 'В пути / в заявке', 'Заказать', 'Поставка до', 'Приоритет', 'Основание', 'Открытые заявки'].concat(V.F ? ['Цена', 'Сумма'] : [])],
    'Просрочки': [['Категория', 'Приоритет', 'Товар', 'Партия', 'Количество', 'Площадка', 'Изготовлено', 'Годен до', 'Осталось', 'Статус', 'Ответственный', 'Рекомендуемое действие'].concat(V.F ? ['Цена за ед.', 'Стоимость остатка'] : [])],
    'Пересорт': [['Приоритет', 'Товар', 'Партия', 'Причина', 'Предложение', 'Срок', 'Ответственный', 'Риск', 'Ссылка', 'Статус'].concat(V.F ? ['Эффект, ₽'] : [])], 'Задачи': [['Приоритет', 'Задача', 'Ответственный', 'Срок', 'Источник']], 'Ошибки': [['Раздел', 'Статус', 'Описание']] };
  var tbl = function (head, rows) { return '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:12px;margin:4px 0 10px">' + '<tr>' + head.map(function (h) { return '<th style="text-align:left;background:#f3ece8;border:1px solid #ddd;padding:4px">' + _v89E_(h) + '</th>'; }).join('') + '</tr>' +
    rows.map(function (r) { return '<tr>' + r.map(function (x, i) { return '<td style="border:1px solid #ddd;padding:4px;vertical-align:top">' + (typeof x === 'object' && x && x.h ? x.h : _v89E_(x)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>'; };
  var h2 = function (t) { H.push('<h3 style="margin:14px 0 4px;color:#6e1423;font-size:15px">' + _v89E_(t) + '</h3>'); X.push('', '== ' + t.toUpperCase() + ' =='); };
  var p = function (t, html) { H.push('<p style="margin:3px 0">' + (html || _v89E_(t)) + '</p>'); X.push(t); };
  var ND = function (why) { return 'НЕТ ДАННЫХ — ' + why; };
  var subj = _v89Subject_(D), sh = D.shift, codes = D.flags.slice();
  // шапка
  H.push('<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#222">');
  H.push('<div style="background:#6e1423;color:#fff;padding:10px 12px;border-radius:6px"><b>MON CHEF</b> · ' + _v89E_(D.types.map(function (x) { return MC_V89_TYPES_[x]; }).join(' + ')) + (D.late ? ' · <b>LATE_NOTIFICATION</b>' : '') + (D.manual ? ' · <b>повторная отправка</b>' : '') + '</div>');
  X.push(subj, '');
  [['Организация', D.c.orgName && D.c.orgName !== D.c.org ? D.c.orgName : 'реквизиты не заполнены (код ' + D.c.org + ')'], ['Площадка', D.c.locName + ' (' + D.c.loc + ')'], ['Смена', sh.date.split('-').reverse().join('.') + ' · ' + (sh.name || sh.id) + ' (' + sh.id + ')'],
    ['Начало и окончание (план)', sh.startAt ? _v89Fmt_(sh.startAt, tz, 'dd.MM HH:mm') + ' – ' + (sh.endAt ? _v89Fmt_(sh.endAt, tz, 'dd.MM HH:mm') : 'окончание не задано') : 'не заданы'],
    ['Расписание', sh.source === 'FALLBACK' ? 'резервное (из настроек уведомлений) — FALLBACK_SCHEDULE' : 'расписание смен площадки' + (codes.indexOf('SHIFT_END_ESTIMATED') >= 0 ? '; окончание по резервному времени — SHIFT_END_ESTIMATED' : '')],
    ['Плановое время письма', _v89Fmt_(D.plannedAt, tz) + ' (' + tz + ')'], ['Сформировано', _v89Fmt_(D.generatedAt, tz) + (D.late ? ' — с опозданием, LATE_NOTIFICATION' : '')],
    ['Полнота данных', D.completeness.status === 'OK' ? 'полные' : 'PARTIAL_DATA — часть данных неполна (см. «Полнота данных»)']].forEach(function (r) { p(r[0] + ': ' + r[1], '<b>' + _v89E_(r[0]) + ':</b> ' + _v89E_(r[1])); S['Итоги'].push(r); });
  if (D.manual) p('Повторная отправка: ' + D.manual, '<b>Повторная отправка:</b> ' + _v89E_(D.manual));
  // критические предупреждения
  var crit = [].concat(D.warnings.map(function (w) { return { prio: w.prio, text: w.code + ': ' + w.text }; }), codes.filter(function (k) { return MC_V89_CODES_RU_[k]; }).map(function (k) { return { prio: 'ВАЖНО', text: k + ': ' + MC_V89_CODES_RU_[k] }; }),
    D.tasks.rows.filter(function (t) { return t.prio === 'КРИТИЧНО'; }), V.E ? D.exp.rows.filter(function (x) { return x.prio === 'КРИТИЧНО'; }).slice(0, 10).map(function (x) { return { prio: 'КРИТИЧНО', text: 'EXPIRED: ' + x.product + ' (партия ' + x.batchId + ', ' + x.daysText + ')' }; }) : []);
  h2('Критические предупреждения');
  if (!crit.length) p('Нет.'); else crit.forEach(function (x) { p('[' + x.prio + '] ' + x.text, _v89Chip_(x.prio) + ' ' + _v89E_(x.text)); S['Ошибки'].push(['Предупреждение', x.prio, x.text]); });
  // резюме
  h2('Кратко');
  var F = D.fin, A = F && F.a, sum = [];
  if (F && V.F) sum.push(A && A.lines ? 'Чистая выручка ' + F.label + ': ' + _v89Money_(A.net) + (F.cogsKnown ? ', маржинальность ' + (A.net > 0 ? _v88N_((A.net - A.cogs) / A.net * 100, 1) + ' %' : '—') : ', себестоимость: НЕТ ДАННЫХ') : 'Выручка ' + F.label + ': НЕТ ДАННЫХ — продаж в журнале нет');
  if (D.proc && V.P) sum.push('Заявки: ' + D.proc.suppliers.length + ' поставщ., позиций ' + D.proc.suppliers.reduce(function (a, g) { return a + g.rows.length; }, 0) + (D.proc.unmapped.length ? ', без поставщика ' + D.proc.unmapped.length + ' (SUPPLIER_NOT_MAPPED)' : ''));
  if (V.E) sum.push('Сроки: истёк — ' + D.exp.counts.EXPIRED + ', ≤ 24 ч — ' + D.exp.counts.EXPIRING_24H + ', ≤ 48 ч — ' + D.exp.counts.EXPIRING_48H + ', ≤ 72 ч — ' + D.exp.counts.EXPIRING_72H + ', ≤ 7 дн. — ' + D.exp.counts.EXPIRING_7D + ', без срока — ' + D.exp.counts.NO_EXPIRY_DATE);
  var tc = function (pr) { return D.tasks.rows.filter(function (t) { return t.prio === pr; }).length; };
  sum.push('Задачи: критично ' + tc('КРИТИЧНО') + ', важно ' + tc('ВАЖНО') + ', обычно ' + tc('ОБЫЧНО') + (D.tasks.runout.length ? '; закончится до закрытия: ' + D.tasks.runout.length : ''));
  sum.forEach(function (x) { p('• ' + x); S['Итоги'].push(['Кратко', x]); });
  // финансы
  if (F) {
    h2('Финансовые показатели');
    if (!V.F) p('Финансовый блок — только адресатам с правом «Экономика — просмотр».');
    else if (F.status === 'ERROR') p(ND(F.error));
    else {
      var cogsTxt = !A.lines ? ND('продаж нет') : F.cogsKnown ? _v89Money_(A.cogs) : ND('себестоимость неполная (' + A.costBad + ' строк без цены партии или на проверке); известная часть ' + _v89Money_(A.cogs));
      var gp = A.lines && F.cogsKnown ? A.net - A.cogs : null, ex = F.ex || {};
      var rows = [['Период', F.label, F.closed ? 'закрытый период (предыдущий день)' : 'на текущий момент'],
        ['Выручка по продажам', A.lines ? _v89Money_(A.gross) : ND('продаж за период в журнале нет'), A.revBad ? 'без цены: ' + A.revBad : ''],
        ['  зал', A.lines ? _v89Money_(A.hall) : '—', ''], ['  банкеты', A.lines ? _v89Money_(A.banquet) : '—', ''],
        ['Скидки', _v89Money_(A.disc), 'Финансы_Операции'], ['Возвраты денег', _v89Money_(A.refund), 'Финансы_Операции'],
        ['Чистая выручка', A.lines ? _v89Money_(A.net) : ND('продаж нет'), F.cmp ? 'неделей раньше (' + F.cmp.date.split('-').reverse().join('.') + '): ' + _v89Money_(F.cmp.net) : 'сравнение: нет данных за тот же день неделей раньше'],
        ['Фактическая себестоимость', cogsTxt, 'по списанным партиям и упаковке (V64)'],
        ['Валовая прибыль', gp === null ? ND('нужны выручка и полная себестоимость') : _v89Money_(gp), ''],
        ['Маржинальность', gp === null || !(A.net > 0) ? ND('нужны выручка и полная себестоимость') : _v88N_(gp / A.net * 100, 1) + ' %', ''],
        ['Комиссии и эквайринг', ex.n ? _v89Money_(ex.commission) : ND('расходы за период не внесены'), ''], ['Доставка', ex.n ? _v89Money_(ex.delivery) : ND('расходы за период не внесены'), ''],
        ['Расходы (управленческие)', ex.n ? _v89Money_(ex.total) : ND('расходы за период не внесены'), 'Финансы_Расходы, без ФОТ']];
      if (V.W) rows.push(['ФОТ за период', ex.payrollN ? _v89Money_(ex.payroll) : ND('начисления ФОТ за период не внесены'), 'только адресатам с правом ФОТ']);
      rows.push(['План выручки', F.plan.revenue === null ? ND('бюджет не задан') : _v89Money_(F.plan.revenue), F.plan.how || ''],
        ['Отклонение от плана', F.plan.revenue === null || !A.lines ? ND('нужны план и выручка') : _v89Money_(A.net - F.plan.revenue) + (F.plan.revenue ? ' (' + _v88N_(A.net / F.plan.revenue * 100, 1) + ' % плана)' : ''), ''],
        ['Заказы и средний чек', ND('в журнале продаж строки блюд, чеков нет'), ''],
        ['Полнота финансовых данных', F.status === 'OK' ? 'полные' : 'PARTIAL_DATA', (F.reasons || []).join('; ')]);
      if (D.types.indexOf('CLOSING') >= 0) rows.splice(7, 0, ['Оплаты и расхождения', ND('оплаты (касса, эквайринг) в MON CHEF не ведутся'), '']);
      H.push(tbl(['Показатель', 'Значение', 'Примечание'], rows)); rows.forEach(function (r) { X.push(r[0] + ': ' + r[1] + (r[2] ? ' (' + r[2] + ')' : '')); S['Финансы'].push(r); });
      if (F.v79 && F.v79.length) p('Не подтверждены документы о продажах: ' + F.v79.map(function (x) { return (x.file || x.id) + ' (' + x.status + ')'; }).join(', ') + ' — неподтверждённые данные в отчёт не входят.');
    }
  }
  // заявки поставщикам
  if (D.proc) {
    h2('Заявки на закупку — по поставщикам');
    if (!V.P) p('Заявки — только адресатам с правом «Закупки».');
    else if (D.proc.status === 'ERROR') p(ND(D.proc.error));
    else {
      if (!D.proc.suppliers.length && !D.proc.unmapped.length) p('Заказывать нечего: доступный остаток, приход и заявки покрывают целевой запас (или параметры закупки не заданы).');
      D.proc.suppliers.forEach(function (g) {
        p('Поставщик: ' + g.name + (g.id ? ' (' + g.id + ')' : '') + (D.proc.showContact && g.contact ? ' · ' + g.contact : '') + (g.blocked ? ' · ЗАБЛОКИРОВАН' : '') + (V.F && g.sum !== null ? ' · сумма ≈ ' + _v89Money_(g.sum) : ''),
          '<b>Поставщик: ' + _v89E_(g.name) + '</b>' + (g.id ? ' <span style="color:#777">(' + _v89E_(g.id) + ')</span>' : '') + (D.proc.showContact && g.contact ? ' · ' + _v89E_(g.contact) : '') + (g.blocked ? ' · <b style="color:#b3261e">ЗАБЛОКИРОВАН</b>' : '') + (V.F && g.sum !== null ? ' · сумма ≈ ' + _v89E_(_v89Money_(g.sum)) : ''));
        var rows = g.rows.map(function (r) { var x = [{ h: _v89Chip_(r.prio) }, r.product + (r.code ? ' · ' + r.code : ''), r.availText + (r.quarantineText ? ' (+ на входном контроле ' + r.quarantineText + ')' : ''), r.minText + ' / ' + r.targetText, r.avgText, r.daysLeft === null ? '—' : String(r.daysLeft).replace('.', ','),
          [r.incomingText ? 'в пути ' + r.incomingText : '', r.draftText ? 'черновик ' + r.draftText : '', r.reservedText ? 'резерв ' + r.reservedText : ''].filter(Boolean).join('; ') || '—', r.qtyText, r.recDate.split('-').reverse().join('.'), r.basis + (r.orders.length ? '; заявки: ' + r.orders.join(', ') : '')];
          if (V.F) x.push(r.lastPrice ? _v89Money_(r.lastPrice) + '/' + (r.unit || '') : 'нет цены', r.sum === null ? 'НЕТ ДАННЫХ' : _v89Money_(r.sum));
          S['Поставщики'].push([g.name, r.product, r.code, r.availText, r.minText, r.targetText, r.avgText, r.daysLeft === null ? '' : r.daysLeft, [r.incomingText, r.draftText].filter(Boolean).join('; '), r.qtyText, r.recDate, r.prio, r.basis, r.orders.join(', ')].concat(V.F ? [r.lastPrice || '', r.sum === null ? 'НЕТ ДАННЫХ' : r.sum] : []));
          X.push('  [' + r.prio + '] ' + r.product + ': заказать ' + r.qtyText + ' до ' + r.recDate.split('-').reverse().join('.') + ' — ' + r.basis + (V.F && r.sum !== null ? ' ≈ ' + _v89Money_(r.sum) : ''));
          return x; });
        H.push(tbl(['', 'Товар', 'Остаток', 'Мин. / целевой', 'Расход', 'Дней до исчерпания', 'В пути / заявка / резерв', 'Заказать', 'Поставка до', 'Основание'].concat(V.F ? ['Цена', 'Сумма'] : []), rows));
      });
      if (D.proc.unmapped.length) { p('SUPPLIER_NOT_MAPPED — нужно заказать, поставщик не указан (товар не распределяется произвольно):', '<b style="color:#c25e00">SUPPLIER_NOT_MAPPED</b> — нужно заказать, поставщик не указан (товар не распределяется произвольно):');
        H.push(tbl(['Товар', 'Остаток', 'Заказать', 'Основание', 'Подсказка'], D.proc.unmapped.map(function (r) { X.push('  ' + r.product + ': заказать ' + r.qtyText + ' — ' + r.basis + (r.hint ? ' (' + r.hint + ')' : '')); S['Поставщики'].push(['SUPPLIER_NOT_MAPPED', r.product, r.code, r.availText, r.minText, r.targetText, r.avgText, r.daysLeft === null ? '' : r.daysLeft, '', r.qtyText, r.recDate, r.prio, r.basis, '']); return [r.product, r.availText, r.qtyText, r.basis, r.hint || '']; }))); }
      p('Система не создаёт и не отправляет заказ поставщику: заявку оформляет сотрудник с правом «Закупки» в разделе «Заказы поставщикам».');
    }
  }
  // сроки годности
  if (D.c.inc.exp) {
    h2('Просрочки и короткие сроки годности');
    if (!V.E) p('Сроки годности — адресатам с правом на склад или ХАССП.');
    else if (D.exp.status === 'ERROR') p(ND(D.exp.error));
    else {
      var exRows = D.exp.rows; if (!exRows.length) p('Партий с истёкшим или подходящим сроком нет.');
      [['EXPIRED', 'Срок истёк — продавать, перемещать в свободный остаток и использовать нельзя'], ['EXPIRING_24H', 'Истекает в течение 24 ч'], ['EXPIRING_48H', 'В течение 48 ч'], ['EXPIRING_72H', 'В течение 72 ч'], ['EXPIRING_7D', 'В течение 7 дней'], ['NO_EXPIRY_DATE', 'Срок не указан']].forEach(function (cc) {
        var rr = exRows.filter(function (x) { return x.cat === cc[0]; }); if (!rr.length) return;
        p(cc[0] + ' — ' + cc[1] + ': ' + rr.length, '<b>' + _v89E_(cc[0]) + '</b> — ' + _v89E_(cc[1]) + ': ' + rr.length);
        H.push(tbl(['', 'Товар', 'Партия', 'Количество', 'Изготовлено', 'Годен до', 'Осталось', 'Статус', 'Ответственный', 'Действие'].concat(V.F ? ['Цена', 'Стоимость остатка'] : []), rr.map(function (x) {
          S['Просрочки'].push([x.cat, x.prio, x.product, x.batchId, x.qtyText, x.loc, x.made, x.expiry, x.daysText, x.statusRu, x.owner, x.action].concat(V.F ? [x.priceText, x.value || ''] : []));
          X.push('  [' + x.prio + '] ' + x.product + ', партия ' + x.batchId + ', ' + x.qtyText + ', до ' + x.expiry + ' (' + x.daysText + '), ' + x.statusRu + ' — ' + x.action + (V.F && x.value ? '; остаток на ' + _v89Money_(x.value) : ''));
          var o = [{ h: _v89Chip_(x.prio) }, x.product, x.batchId, x.qtyText, x.made, x.expiry, x.daysText, x.statusRu, x.owner, x.action]; if (V.F) o.push(x.priceText, x.value ? _v89Money_(x.value) : 'нет цены'); return o; })));
      });
    }
  }
  // предложения
  if (D.sugg && (V.E || V.P)) {
    h2('Предложения по перераспределению и пересорту');
    var G = D.sugg; if (G.status === 'ERROR') p(ND(G.error));
    else {
      p('Это предложения, а не действия: система не меняет остатки. Решение — «принять / отклонить / выполнено» в разделе «Сменные письма»; списание и перемещение — отдельно, с причиной.');
      if (!G.rows.length) p('Предложений нет.');
      else H.push(tbl(['', 'Товар / партия', 'Причина', 'Предложение', 'Срок', 'Ответственный', 'Статус', 'Ссылка'].concat(V.F ? ['Эффект, ₽'] : []), G.rows.map(function (x) {
        S['Пересорт'].push([x.prio, x.product, x.batchId, x.reason, x.actionRu + ': ' + x.rec, _v89Fmt_(x.due, tz), x.role, x.risk, x.link, x.status].concat(V.F ? [x.effect === null ? '' : x.effect] : []));
        X.push('  [' + x.prio + '] ' + x.actionRu + ' — ' + x.product + (x.batchId ? ' (' + x.batchId + ')' : '') + ': ' + x.rec + '; срок ' + _v89Fmt_(x.due, tz, 'dd.MM HH:mm') + '; ' + x.role + '; ' + x.status + (V.F && x.effect ? '; эффект до ' + _v89Money_(x.effect) : ''));
        var o = [{ h: _v89Chip_(x.prio) }, x.product + (x.batchId ? ' · ' + x.batchId : ''), x.reason, x.actionRu + ': ' + x.rec, _v89Fmt_(x.due, tz, 'dd.MM HH:mm'), x.role, x.status, x.link]; if (V.F) o.push(x.effect === null || x.effect === undefined ? '—' : 'до ' + _v89Money_(x.effect)); return o; })));
      p(G.note); (G.skipped || []).slice(0, 10).forEach(function (s) { p('Не предлагается: ' + s); });
      if ((G.resort || []).length) p('Действующий пересорт (V88): ' + G.resort.join('; '));
      if (V.F && G.resortReport) { p('Пересорт сегодня: ' + G.resortReport.items.map(function (x) { return x.text; }).join(' ') + ' Итого меньше из-за пересорта: ' + _v89Money_(G.resortReport.loss)); }
    }
  }
  // задачи
  var showTasks = D.types.some(function (t) { return t !== 'MORNING'; });
  if (showTasks) {
    h2('Незавершённые задачи смены');
    if (D.tasks.runout.length) { p('Могут закончиться до закрытия смены:', '<b>Могут закончиться до закрытия смены:</b>'); D.tasks.runout.forEach(function (x) { p('[КРИТИЧНО] ' + x.text, _v89Chip_('КРИТИЧНО') + ' ' + _v89E_(x.text)); }); }
    if (D.tasks.critical.length) { p('Остатки ниже минимального запаса:', '<b>Остатки ниже минимального запаса:</b>'); D.tasks.critical.forEach(function (x) { p('[ВАЖНО] ' + x.text, _v89Chip_('ВАЖНО') + ' ' + _v89E_(x.text)); }); }
    var open = (D.openOrders || []).filter(function (o) { return o.status !== 'draft'; });
    if (open.length && V.P) p('Открытые заказы поставщикам: ' + open.map(function (o) { return o.id + ' ' + o.supplier + ' (' + o.status + (o.due ? ', срок ' + String(o.due).split('-').reverse().join('.') : '') + ')'; }).join('; '));
  }
  var TT = D.tasks.rows.filter(function (t) { return showTasks || t.prio === 'КРИТИЧНО'; });
  TT.forEach(function (t) { S['Задачи'].push([t.prio, t.text, t.role, t.due ? _v89Fmt_(t.due, tz, 'dd.MM HH:mm') : '', t.src]); });
  if (showTasks) { if (!TT.length) p('Незавершённых задач нет.'); else H.push(tbl(['', 'Задача', 'Ответственный', 'Срок', 'Источник'], TT.map(function (t) { X.push('  [' + t.prio + '] ' + t.text + ' — ' + t.role + (t.due ? ', до ' + _v89Fmt_(t.due, tz, 'dd.MM HH:mm') : '')); return [{ h: _v89Chip_(t.prio) }, t.text, t.role, t.due ? _v89Fmt_(t.due, tz, 'dd.MM HH:mm') : '—', t.src]; }))); }
  // что закрыть до окончания смены
  if (D.types.indexOf('CLOSING') >= 0) {
    h2('Что нужно закрыть до окончания смены');
    var todo = [].concat(D.tasks.rows, D.tasks.runout.map(function (x) { return { prio: x.prio, text: x.text, role: 'Шеф-повар, закупщик' }; }),
      D.sugg && (V.E || V.P) ? D.sugg.rows.filter(function (x) { return x.status === 'SUGGESTED'; }).map(function (x) { return { prio: x.prio, text: x.actionRu + ': ' + x.product + (x.batchId ? ' (' + x.batchId + ')' : ''), role: x.role, due: x.due }; }) : [],
      V.P ? (D.openOrders || []).filter(function (o) { return o.status === 'draft'; }).map(function (o) { return { prio: 'ОБЫЧНО', text: 'Черновик заказа поставщику ' + o.id + ' (' + o.supplier + ') не отправлен', role: 'Закупщик' }; }) : []);
    MC_V89_PRIO_.forEach(function (pr) { var L = todo.filter(function (t) { return t.prio === pr; }); p(pr + ': ' + (L.length ? '' : 'нет'), _v89Chip_(pr) + (L.length ? '' : ' нет'));
      L.forEach(function (t) { p('  — ' + t.text + ' (' + (t.role || '—') + (t.due || sh.endAt ? ', до ' + _v89Fmt_(t.due || sh.endAt, tz, 'dd.MM HH:mm') : '') + ')', '&nbsp;&nbsp;— ' + _v89E_(t.text) + ' <span style="color:#666">(' + _v89E_(t.role || '—') + (t.due || sh.endAt ? ', до ' + _v89E_(_v89Fmt_(t.due || sh.endAt, tz, 'dd.MM HH:mm')) : '') + ')</span>'); }); });
  }
  // полнота данных
  h2('Полнота данных и ошибки');
  D.completeness.parts.forEach(function (pp) { p(pp.name + ': ' + (pp.status === 'OK' ? 'полные' : pp.status) + (pp.reasons.length ? ' — ' + pp.reasons.join('; ') : '')); S['Ошибки'].push([pp.name, pp.status, pp.reasons.join('; ')]); });
  if (att && att.length) { h2('Вложения');
    att.forEach(function (a) { p(a.name + (a.url ? ' — ' + a.url : ' (во вложении письма)') + ' · SHA-256 ' + a.sha, _v89E_(a.name) + (a.url ? ' — <a href="' + _v89E_(a.url) + '">открыть на Диске</a>' : ' (во вложении письма)') + '<br><span style="font-size:11px;color:#666">SHA-256 ' + _v89E_(a.sha) + '</span>'); }); }
  if (att && att.error) p('Вложения: ' + att.error);
  p('Письмо — отчёт и список действий. MON CHEF не меняет склад, финансы, закупки и сроки по письму; заявки, перемещения и списания — только вручную, с правом и причиной. Ссылки открываются только у тех, у кого есть доступ к папке на Диске.',
    '<span style="font-size:11px;color:#666">Письмо — отчёт и список действий. MON CHEF не меняет склад, финансы, закупки и сроки по письму; заявки, перемещения и списания — только вручную, с правом и причиной. Ссылки открываются только у тех, у кого есть доступ к папке на Диске.</span>');
  H.push('</div>');
  return { subject: subj, html: H.join(''), text: X.join('\n'), sheets: S, sev: _v89Sev_(D, V) };
}

/* ---------------- вложения: PDF, Excel, TXT на Диске, SHA-256 ---------------- */
function _v89Sub_(parent, name) { var it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function _v89Folder_(D) {
  var root = _mcFolder_('reports'), f = _v89Sub_(root, 'Сменные письма');
  [D.c.orgName || D.c.org, D.c.locName + ' (' + D.c.loc + ')', D.shift.date, D.shift.id].forEach(function (n) { f = _v89Sub_(f, String(n).replace(/[\\\/:*?"<>|]+/g, ' ').trim() || '—'); });
  return f;
}
function _v89Attach_(c, D, V, R) {
  var out = [], blobs = [], base = D.types.join('+') + '_' + D.shift.date + '_' + D.shift.id + '_' + (V.F ? 'полный' : 'без_финансов') + '_' + _v89VariantKey_(V);
  if (!c.att.pdf && !c.att.xlsx && !c.att.txt) return { list: out, blobs: blobs };
  var folder = null, ferr = '';
  try { folder = _v89Folder_(D); } catch (e) { ferr = 'папка на Диске недоступна: ' + String(e.message || e); }
  var keep = function (blob, kind) {
    var bytes = blob.getBytes(), a = { name: blob.getName(), kind: kind, sha: _v89ShaBytes_(bytes), url: '', id: '' };
    if (folder) try { var f = folder.createFile(blob); a.url = f.getUrl(); a.id = f.getId(); } catch (e) { ferr = 'файл не сохранён на Диске: ' + String(e.message || e); }
    out.push(a); blobs.push(blob);
  };
  try { if (c.att.txt) keep(Utilities.newBlob(R.text, 'text/plain', base + '.txt'), 'TXT'); } catch (e) { out.error = (out.error ? out.error + '; ' : '') + 'TXT: ' + String(e.message || e); }
  try { if (c.att.pdf) { var pb = HtmlService.createHtmlOutput('<html><head><meta charset="utf-8"></head><body>' + R.html + '</body></html>').getAs('application/pdf'); pb.setName(base + '.pdf'); keep(pb, 'PDF'); } } catch (e) { out.error = (out.error ? out.error + '; ' : '') + 'PDF: ' + String(e.message || e); }
  try { if (c.att.xlsx) keep(_v89Xlsx_(R.sheets, base + '.xlsx'), 'Excel'); } catch (e) { out.error = (out.error ? out.error + '; ' : '') + 'Excel: ' + String(e.message || e); }
  if (ferr) out.error = (out.error ? out.error + '; ' : '') + ferr;
  return { list: out, blobs: blobs };
}
function _v89Xlsx_(sheets, name) {
  var ss = SpreadsheetApp.create(name.replace(/\.xlsx$/, '')), first = true, id = ss.getId();
  try {
    ['Итоги', 'Финансы', 'Поставщики', 'Просрочки', 'Пересорт', 'Задачи', 'Ошибки'].forEach(function (k) {
      var rows = sheets[k] || [[k]], w = rows.reduce(function (a, r) { return Math.max(a, r.length); }, 1), sh = first ? ss.getSheets()[0] : ss.insertSheet(k); if (first) { sh.setName(k); first = false; }
      sh.getRange(1, 1, rows.length, w).setValues(rows.map(function (r) { var x = r.map(function (v) { return v === null || v === undefined ? '' : (typeof v === 'object' && v.h !== undefined ? '' : v); }); while (x.length < w) x.push(''); return x; }));
    });
    SpreadsheetApp.flush();
    var resp = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (resp.getResponseCode && resp.getResponseCode() !== 200) throw new Error('выгрузка Excel: ответ ' + resp.getResponseCode());
    var b = resp.getBlob(); b.setName(name); return b;
  } finally { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} }
}

/* ---------------- журнал, ошибки, отправка ---------------- */
function _v89Log_() { return _v89Rows_(MC_V89_LOG_, MC_V89_LOG_HEAD_); }
function _v89Errs_() { return _v89Rows_(MC_V89_ERR_, MC_V89_ERR_HEAD_); }
function _v89ErrAdd_(o) {
  var row = { ErrorID: _v89Id_('EML-ERR'), NotificationID: o.nid || '', ErrorType: o.type, Severity: o.sev || 'ВАЖНО', Message: String(o.msg || '').slice(0, 900), Retryable: !!o.retry, Attempts: o.attempts || 1,
    NextRetryAt: o.retry ? new Date((o.now || Date.now()) + MC_V89_RETRY_MIN_[Math.min((o.attempts || 1) - 1, MC_V89_RETRY_MIN_.length - 1)] * 60000) : '', OperationID: o.op || '', CreatedAt: new Date(), 'Ключ': o.key || '' };
  _v89Put_(MC_V89_ERR_, MC_V89_ERR_HEAD_, row); return row.ErrorID;
}
function _v89ErrOnce_(type, key, msg, sev) { if (_v89Errs_().some(function (e) { return String(e['Ключ']) === type + '|' + key; })) return false; _v89ErrAdd_({ type: type, key: type + '|' + key, msg: msg, sev: sev }); return true; }
/** Адресаты письма по группам типов писем; без прав/почты — в пропущенные с причиной. */
function _v89Who4_(c, types) {
  var groups = []; types.forEach(function (t) { c.groups[t].forEach(function (g) { if (groups.indexOf(g) < 0) groups.push(g); }); });
  var seen = {}, ok = [], bad = [];
  _v89Recipients_().forEach(function (r) {
    if (!r.active || groups.indexOf(r.group) < 0 || (r.loc && r.loc !== '*' && r.loc !== c.LocationID)) return;
    if (!_v89EmailOk_(r.email)) { bad.push((r.empName || r.id) + ': адрес почты не распознан'); return; }
    var R = _v89Rights_(r); if (!R.ok) { bad.push(r.email + ': ' + R.why); return; }
    var k = r.email.toLowerCase(); if (seen[k]) { ['F', 'P', 'W', 'E'].forEach(function (x) { seen[k].R[x] = seen[k].R[x] && R[x]; }); return; }   // один адрес в двух группах — права по меньшей
    seen[k] = { email: r.email, group: r.group, R: R }; ok.push(seen[k]);
  });
  return { list: ok, skipped: bad, groups: groups };
}
/** Сформировать и отправить (или DRY_RUN) письмо окна. opt: {persist, manual: 'причина', retry: {base, rows, err}}. */
function _v89Deliver_(c, w, nowMs, opt) {
  opt = opt || {};
  var base = opt.retry ? opt.retry.base : _v89Id_('NTF'), started = new Date(nowMs), keyOf = function (t) { return _v89Key_(c, w.shift, t) + (opt.manual ? '#manual-' + Utilities.formatDate(started, _mcTz_(), 'yyyyMMddHHmmss') : ''); };
  var rowsIdx = {};
  var put = function (t, o) { if (rowsIdx[t]) { _v89Put_(MC_V89_LOG_, MC_V89_LOG_HEAD_, o, rowsIdx[t]); return; }
    rowsIdx[t] = _v89Put_(MC_V89_LOG_, MC_V89_LOG_HEAD_, Object.assign({ NotificationID: base + '/' + t.charAt(0), TriggerConfigID: c.TriggerConfigID, OrganizationID: c.OrganizationID, LocationID: c.LocationID, ShiftID: w.shift.id, ShiftDate: "'" + w.shift.date,
      NotificationType: t, PlannedAt: w.at, ActualStartedAt: started, LateFlag: !!w.late, DuplicateKey: keyOf(t), CreatedAt: new Date(), OperationID: opt.op || '' }, o)); };
  if (opt.retry) opt.retry.rows.forEach(function (r) { rowsIdx[String(r.NotificationType)] = r._row; });
  var all = function (o) { w.types.forEach(function (t) { put(t, o); }); };
  var note = (w.merged === 'SHORT_SHIFT' ? 'смена короче 4 ч — ' : w.merged ? 'окна рядом — ' : '') + (w.types.length > 1 ? 'одно письмо: ' + w.types.join(' + ') : '') + (opt.manual ? (w.types.length > 1 ? '; ' : '') + 'ручная повторная отправка: ' + opt.manual : '') + (opt.retry ? 'повтор после ошибки почты' : '');
  all({ Status: 'GENERATED', 'Примечание': note });
  var D, who = _v89Who4_(c, w.types);
  try { D = _v89Collect_(c, w, nowMs, opt.persist !== false); if (opt.manual) D.manual = opt.manual; }
  catch (e) { all({ Status: 'FAILED', ErrorCode: 'REPORT_FAILED', ErrorMessage: String(e.message || e).slice(0, 400) }); _v89ErrAdd_({ nid: base, type: 'REPORT_FAILED', sev: 'КРИТИЧНО', msg: String(e.stack || e) }); return { status: 'FAILED' }; }
  if (!who.list.length) { all({ Status: 'SKIPPED', ReportHash: D.hash, ErrorCode: 'RECIPIENTS_NOT_CONFIGURED', ErrorMessage: 'Нет адресатов для групп ' + who.groups.join(', ') + (who.skipped.length ? '; пропущены: ' + who.skipped.join('; ') : '') });
    _v89ErrOnce_('RECIPIENTS_NOT_CONFIGURED', c.LocationID + '|' + w.shift.date, 'Письмо ' + w.types.join('+') + ' ' + w.shift.date + ': нет адресатов', 'ВАЖНО'); return { status: 'SKIPPED', code: 'RECIPIENTS_NOT_CONFIGURED' }; }
  var byV = {}; who.list.forEach(function (r) { var k = _v89VariantKey_(r.R); (byV[k] = byV[k] || { V: r.R, to: [] }).to.push(r.email); });
  var files = [], sentTo = [], skippedV = [], err = null, minI = MC_V89_PRIO_.indexOf(c.minSev), hashes = [];
  var sentKey = 'MC_V89_SENT_' + base, already = []; try { already = JSON.parse(_v89Props_().getProperty(sentKey) || '[]'); } catch (e) {}
  Object.keys(byV).forEach(function (k) {
    if (err) return;
    var V = byV[k].V, R0 = _v89Render_(D, V, null), sv = R0.sev, sevI = sv.level ? MC_V89_PRIO_.indexOf(sv.level) : 3;
    if (!c.sendEmpty && !opt.manual && (sv.items === 0 || sevI > minI)) { skippedV.push(_v89VariantRu_(k) + ': ' + (sv.items === 0 ? 'EMPTY_REPORT' : 'BELOW_MIN_SEVERITY (' + (sv.level || 'нет') + ' < ' + c.minSev + ')')); return; }
    var A = _v89Attach_(c, D, V, R0), R = _v89Render_(D, V, A.list.length ? A.list : (A.list.error ? { error: A.list.error, length: 0 } : null));
    if (A.list.error) R.text += '\nВложения: ' + A.list.error;
    A.list.forEach(function (a) { if (a.id) files.push(a.id); }); hashes.push(k + ':' + _v89Sha_(R.text));
    if (c.dry) return;
    var to = byV[k].to.filter(function (e) { return already.indexOf(_v89Sha_(e.toLowerCase())) < 0; });
    try {
      var q = MailApp.getRemainingDailyQuota(); if (q < to.length) throw new Error('QUOTA: осталось писем на сегодня ' + q + ', нужно ' + to.length);
      to.forEach(function (e) { MailApp.sendEmail({ to: e, subject: R.subject, htmlBody: R.html, body: R.text, name: 'MON CHEF', attachments: A.blobs }); sentTo.push(e); already.push(_v89Sha_(e.toLowerCase())); });
    } catch (e) { err = e; }
  });
  try { if (already.length) _v89Props_().setProperty(sentKey, JSON.stringify(already)); } catch (e) {}
  var rh = _v89Sha_(who.list.map(function (r) { return r.email.toLowerCase(); }).sort().join(','));
  var common = { RecipientsHash: rh, ReportHash: D.hash, AttachmentFileIDs: files.join(','), EmailMessageID: '' };
  var extra = (who.skipped.length ? 'пропущены адресаты: ' + who.skipped.join('; ') : '') + (skippedV.length ? (who.skipped.length ? '; ' : '') + 'не отправлено: ' + skippedV.join('; ') : '');
  if (c.dry) { all(Object.assign({ Status: 'DRY_RUN', 'Примечание': [note, 'DryRun — письмо сформировано, не отправлено', extra].filter(Boolean).join('; ') }, common)); return { status: 'DRY_RUN', D: D }; }
  if (err) {
    var temp = !/RECIPIENT|INVALID_EMAIL|Invalid email/i.test(String(err)), att = opt.retry ? (Number(opt.retry.err.Attempts) || 1) + 1 : 1, final = !temp || att > MC_V89_RETRY_MIN_.length;
    all(Object.assign({ Status: final ? 'FAILED' : 'GENERATED', SentAt: sentTo.length ? new Date(nowMs) : '', ErrorCode: final ? 'SEND_FAILED' : 'SEND_RETRY', ErrorMessage: String(err.message || err).slice(0, 400),
      'Примечание': [note, 'отправлено ' + sentTo.length + ' из ' + who.list.length, extra].filter(Boolean).join('; ') }, common));
    if (opt.retry) _v89Put_(MC_V89_ERR_, MC_V89_ERR_HEAD_, { Attempts: att, Retryable: !final, NextRetryAt: final ? '' : new Date(nowMs + MC_V89_RETRY_MIN_[att - 1] * 60000), Message: String(err.message || err).slice(0, 900) }, opt.retry.err._row);
    else _v89ErrAdd_({ nid: base, type: temp ? 'MAIL_TEMPORARY' : 'MAIL_REJECTED', sev: final ? 'КРИТИЧНО' : 'ВАЖНО', msg: String(err.message || err), retry: !final, attempts: 1, key: base, now: nowMs });
    if (final) { _v89Alarm_(c, w, err, sentTo.length, who.list.length); try { _v89Props_().deleteProperty(sentKey); } catch (e) {} }
    return { status: final ? 'FAILED' : 'RETRY', error: String(err) };
  }
  if (!sentTo.length && skippedV.length) { all(Object.assign({ Status: 'SKIPPED', ErrorCode: /EMPTY/.test(skippedV.join()) ? 'EMPTY_REPORT' : 'BELOW_MIN_SEVERITY', 'Примечание': [note, extra].filter(Boolean).join('; ') }, common)); return { status: 'SKIPPED' }; }
  all(Object.assign({ Status: 'SENT', SentAt: new Date(nowMs), ErrorCode: '', ErrorMessage: '', 'Примечание': [note, 'адресатов ' + sentTo.length + ', вариантов ' + Object.keys(byV).length, extra].filter(Boolean).join('; ') }, common));
  if (opt.retry) _v89Put_(MC_V89_ERR_, MC_V89_ERR_HEAD_, { ResolvedAt: new Date(nowMs), ResolvedBy: 'Система: повтор отправки', Retryable: false }, opt.retry.err._row);
  try { _v89Props_().deleteProperty(sentKey); } catch (e) {}
  return { status: 'SENT', to: sentTo.length, D: D };
}
function _v89Alarm_(c, w, err, sent, total) {
  var t = 'Сменное письмо ' + w.types.join('+') + ' (' + c.name + ', смена ' + w.shift.date + ') не отправлено после ' + MC_V89_RETRY_MIN_.length + ' повторов: ' + String(err.message || err).slice(0, 200) + '. Отправлено ' + sent + ' из ' + total + '.';
  try { _notify_('email', 'critical', 'Сменное письмо не отправлено', t, MC_RB_J_.D, 'v89fail|' + c.LocationID + '|' + w.shift.date + '|' + w.types.join('+'), null); } catch (e) {}
  try { _mcRbAlertOwner_('сменное письмо не отправлено', t); } catch (e) {}
}

/* ---------------- плановый запуск (каждые 10 минут, из планировщика) ---------------- */
function _v89Today_(c, nowMs) { return Utilities.formatDate(new Date(nowMs), c.tz, 'yyyy-MM-dd'); }
function _v89CfgLive_(c, nowMs) { var d = _v89Today_(c, nowMs); return c.active && (!c.from || d >= c.from) && (!c.to || d <= c.to); }
function v89EmailTick_(nowArg) {
  var nowMs = nowArg ? Number(nowArg) : Date.now(), res = { sent: 0, skipped: 0, failed: 0, dry: 0, retried: 0, late: 0, config: [], changed: 0 };
  return _withLock_(function () {
    var cfgs = _v89Cfgs_(), log = _v89Log_(), done = {};
    log.forEach(function (r) {
      done[String(r.DuplicateKey)] = r;
      // отправка прервалась (лимит времени, сбой): неизвестно, ушло ли письмо — автоматически не повторяем, только вручную
      if (String(r.Status) === 'GENERATED' && !r.ErrorCode && r.ActualStartedAt instanceof Date && nowMs - r.ActualStartedAt.getTime() > 15 * 60000)
        _v89Put_(MC_V89_LOG_, MC_V89_LOG_HEAD_, { Status: 'FAILED', ErrorCode: 'SEND_STATE_UNKNOWN', ErrorMessage: 'Формирование или отправка прервались — неизвестно, ушло ли письмо. Проверьте почту; повтор — ручной командой с причиной' }, r._row);
    });
    cfgs.forEach(function (c) {
      if (!_v89CfgLive_(c, nowMs)) return;
      var miss = _v89Blocking_(_v89Missing_(c));
      if (miss.length) { res.config.push(c.LocationID + ': ' + miss.join('; ')); _v89ErrOnce_('CONFIGURATION_REQUIRED', c.LocationID + '|' + _v89Today_(c, nowMs), 'Площадка ' + c.name + ': автоматическая отправка отключена до заполнения: ' + miss.join('; '), 'ВАЖНО'); return; }
      var W = _v89Windows_(c, nowMs), act = Number(_v89Prop_('MC_V89_ACT_' + c.TriggerConfigID, '0')) || 0;
      W.errors.forEach(function (e) { _v89ErrOnce_(e.code, e.key, e.text, 'ВАЖНО'); });
      var due = [];
      W.windows.forEach(function (w) {
        if (w.at.getTime() > nowMs || w.at.getTime() < act) return;
        var pend = w.types.filter(function (t) { return !done[_v89Key_(c, w.shift, t)]; }); if (!pend.length) return;
        if (nowMs - w.at.getTime() > MC_V89_CATCHUP_H_ * 36e5) {
          pend.forEach(function (t) { _v89Put_(MC_V89_LOG_, MC_V89_LOG_HEAD_, { NotificationID: _v89Id_('NTF') + '/' + t.charAt(0), TriggerConfigID: c.TriggerConfigID, OrganizationID: c.OrganizationID, LocationID: c.LocationID, ShiftID: w.shift.id, ShiftDate: "'" + w.shift.date,
            NotificationType: t, PlannedAt: w.at, ActualStartedAt: new Date(nowMs), Status: 'SKIPPED', LateFlag: true, DuplicateKey: _v89Key_(c, w.shift, t), ErrorCode: 'WINDOW_MISSED', ErrorMessage: 'окно пропущено более чем на ' + MC_V89_CATCHUP_H_ + ' ч — письмо не отправляется', CreatedAt: new Date() }); res.skipped++; });
          return;
        }
        due.push({ types: pend, at: w.at, shift: w.shift, flags: w.flags, merged: w.merged });
      });
      // догоняющее письмо: пропущенные окна одной смены — одним письмом
      var byShift = {}; due.forEach(function (w) { var k = w.shift.id + '|' + w.shift.date; (byShift[k] = byShift[k] || []).push(w); });
      Object.keys(byShift).forEach(function (k) {
        var L = byShift[k], w = L[0];
        if (L.length > 1) { w = { types: [], at: L[0].at, shift: L[0].shift, flags: [], merged: 'CATCH_UP' }; L.forEach(function (x) { x.types.forEach(function (t) { if (w.types.indexOf(t) < 0) w.types.push(t); }); x.flags.forEach(function (f) { if (w.flags.indexOf(f) < 0) w.flags.push(f); }); }); }
        w.late = nowMs - w.at.getTime() > MC_V89_LATE_MIN_ * 60000 || L.length > 1; if (w.late) res.late++;
        var r = _v89Deliver_(c, w, nowMs, { persist: true });
        if (r.status === 'SENT') res.sent++; else if (r.status === 'DRY_RUN') res.dry++; else if (r.status === 'FAILED') res.failed++; else res.skipped++;
      });
    });
    // повторы после временной ошибки почты
    var log2 = _v89Log_();
    _v89Errs_().forEach(function (e) {
      if (!_v89B_(e.Retryable, false) || e.ResolvedAt || !(e.NextRetryAt instanceof Date) || e.NextRetryAt.getTime() > nowMs) return;
      var base = String(e.NotificationID), rows = log2.filter(function (r) { return String(r.NotificationID).split('/')[0] === base; }); if (!rows.length) return;
      var c = cfgs.filter(function (x) { return x.TriggerConfigID === String(rows[0].TriggerConfigID); })[0]; if (!c) return;
      var w = _v89WindowOf_(c, rows, nowMs); res.retried++;
      _v89Deliver_(c, w, nowMs, { persist: false, retry: { base: base, rows: rows, err: e } });
    });
    // отчёт изменился после отправки — запись в журнал, без автоматического повтора
    var chk = {}; try { chk = JSON.parse(_v89Props_().getProperty('MC_V89_CHANGED_CHK') || '{}'); } catch (e) {}
    _v89Log_().forEach(function (r) {
      if (String(r.Status) !== 'SENT' || !(r.SentAt instanceof Date) || /#/.test(String(r.DuplicateKey))) return; var age = nowMs - r.SentAt.getTime(); if (age < 30 * 60000 || age > 90 * 60000 || chk[r.NotificationID]) return;
      chk[r.NotificationID] = 1; var c = cfgs.filter(function (x) { return x.TriggerConfigID === String(r.TriggerConfigID); })[0]; if (!c) return;
      var sib = _v89Log_().filter(function (x) { return String(x.NotificationID).split('/')[0] === String(r.NotificationID).split('/')[0]; });
      try { var D = _v89Collect_(c, _v89WindowOf_(c, sib, nowMs), nowMs, false); if (D.hash !== String(r.ReportHash)) { res.changed++;
        _v89Put_(MC_V89_LOG_, MC_V89_LOG_HEAD_, { NotificationID: r.NotificationID + '-CH', TriggerConfigID: r.TriggerConfigID, OrganizationID: r.OrganizationID, LocationID: r.LocationID, ShiftID: r.ShiftID, ShiftDate: "'" + (_v89Iso_(r.ShiftDate, c.tz) || r.ShiftDate), NotificationType: r.NotificationType,
          PlannedAt: r.PlannedAt, ActualStartedAt: new Date(nowMs), Status: 'SKIPPED', DuplicateKey: r.DuplicateKey + '#changed', ReportHash: D.hash, ErrorCode: 'REPORT_CHANGED_AFTER_SEND',
          ErrorMessage: 'Отчёт изменился после отправки — автоматически не отправляется; повтор — ручной командой с причиной', CreatedAt: new Date() }); } } catch (e) {}
    });
    try { var keys = Object.keys(chk); if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(function (k) { delete chk[k]; }); _v89Props_().setProperty('MC_V89_CHANGED_CHK', JSON.stringify(chk)); } catch (e) {}
    return res;
  });
}
/** Окно письма по строкам журнала (для повтора и проверки изменений). */
function _v89WindowOf_(c, rows, nowMs) {
  var r0 = rows[0], date = _v89Iso_(r0.ShiftDate, c.tz) || String(r0.ShiftDate), sid = String(r0.ShiftID), types = rows.map(function (r) { return String(r.NotificationType); }).filter(function (t, i, a) { return MC_V89_TYPES_[t] && a.indexOf(t) === i; });
  var W = _v89Windows_(c, _v89At_(date, '12:00', c.tz).getTime()).windows.filter(function (w) { return w.shift.id === sid && w.shift.date === date; });
  var sh = W.length ? W[0].shift : { id: sid, name: '', date: date, startAt: null, endAt: null, source: sid === 'FALLBACK' ? 'FALLBACK' : 'SCHEDULE', flags: [] };
  var fl = []; W.forEach(function (w) { if (w.types.some(function (t) { return types.indexOf(t) >= 0; })) (w.flags || []).forEach(function (f) { if (fl.indexOf(f) < 0) fl.push(f); }); });
  return { types: types, at: r0.PlannedAt instanceof Date ? r0.PlannedAt : new Date(nowMs), shift: sh, flags: fl, late: _v89B_(r0.LateFlag, false) };
}
try { if (typeof MC_SCHEDULE !== 'undefined' && !MC_SCHEDULE.some(function (j) { return j.fn === 'v89EmailTick_'; })) MC_SCHEDULE.push({ fn: 'v89EmailTick_', everyMin: 10 }); } catch (e) {}

/* ---------------- экран «Сменные письма» ---------------- */
function _v89J_(json) { return typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}); }
function _v89Op_(token, perm, type) { return _beginOp_(token, perm, type, 'Уведомления', null, null); }
function _v89Run_(token, perm, type, fn) {
  var op = null;
  try { op = _v89Op_(token, perm, type); } catch (e) { return _failFrom_(e); }
  try { var r = _withLock_(function () { return fn(op, op.session); }); if (r && r.__fail) { _endOp_(op, 'FAILED'); return _fail_(r.code, r.msg, op.id); } _endOp_(op); return _ok_(r, op.id); }
  catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v89Bad_(code, msg) { return { __fail: true, code: code, msg: msg }; }
function _v89Can_(s) {
  var h = function (k) { return _mcRbHasExact_(s, k); };
  return { view: h('notification_view|notification_manage|notification_send'), manage: h('notification_manage'), send: h('notification_send'), fin: h('finance_view'), finEdit: h('finance_edit'),
    proc: h('procurement_view|procurement|procurement_create'), procEdit: h('procurement|procurement_create|notification_manage'), exp: h('stock_expiry_view|stock_view|stock|haccp_view'),
    writeoff: h('stock_writeoff_create|stock'), transfer: h('stock_transfer_create'), decide: h(MC_V89_SG_NEED_), exportFiles: h('report_export') };
}
function _v89Fmt2_(x, tz) { return x instanceof Date ? Utilities.formatDate(x, tz || _mcTz_(), 'dd.MM.yyyy HH:mm') : String(x || ''); }
function v89NotifyData(token) {
  try {
    var s = _requireAuth_(token, 'notification_view|notification_manage|notification_send|stock_expiry_view|procurement_view'), can = _v89Can_(s), nowMs = Date.now();
    var cfgs = _v89Cfgs_().map(function (c) {
      var miss = _v89Missing_(c), blk = _v89Blocking_(miss), next = [];
      try { if (!blk.length) next = _v89Windows_(c, nowMs).windows.filter(function (w) { return w.at.getTime() > nowMs - 3 * 36e5; }).slice(0, 8)
        .map(function (w) { return { types: w.types.map(function (t) { return MC_V89_TYPES_[t]; }).join(' + '), at: _v89Fmt_(w.at, c.tz), shift: (w.shift.name || w.shift.id) + ' ' + w.shift.date.split('-').reverse().join('.'), flags: w.flags.join(', ') }; }); } catch (e) {}
      var o = {}; MC_V89_CFG_HEAD_.forEach(function (k) { o[k] = c[k] instanceof Date ? _v89Iso_(c[k], c.tz) : c[k]; });
      o.status = !c.active ? 'ВЫКЛЮЧЕНО' : blk.length ? 'CONFIGURATION_REQUIRED' : c.dry ? 'DRY_RUN' : 'ВКЛЮЧЕНО'; o.missing = miss; o.next = next; o.tzUsed = c.tz; o.name = c.name;
      ['FallbackMorningTime', 'FallbackMiddayTime', 'FallbackClosingTime'].forEach(function (k) { o[k] = _v89Hm_(c[k]); });
      return o;
    });
    var tz = _mcTz_(), out = { can: can, cfgs: cfgs, groups: MC_V89_GROUPS_, tz: tz, prio: MC_V89_PRIO_, avgDays: _v89Prop_('MC_V89_AVG_DAYS', '14'), showContact: _v89B_(_v89Prop_('MC_V89_SHOW_CONTACT', ''), false),
      shifts: _v89Shifts_().map(function (x) { return { id: x.id, loc: x.loc, name: x.name, days: x.days.join(','), date: x.date, start: x.start, end: x.end, active: x.active }; }) };
    if (can.manage) {
      out.recipients = _v89Recipients_().map(function (r) { var R = _v89Rights_(r); return { id: r.id, group: r.group, groupRu: MC_V89_GROUPS_[r.group] || r.group, email: r.email, emp: r.emp, empName: r.empName, loc: r.loc, active: r.active,
        rights: R.ok ? _v89VariantRu_(_v89VariantKey_(R)) : R.why }; });
      var E = _mcRbEmpState_(); out.employees = Object.keys(E).filter(function (k) { return !E[k].hidden && E[k].active !== false; }).map(function (k) { return { id: k, name: E[k].name, role: E[k].role }; });
      out.expRules = _v89Rows_(MC_V89_XR_, MC_V89_XR_HEAD_).map(function (r) { return { id: String(r.RuleID), area: String(r['Область']), value: String(r['Значение']), loc: String(r.LocationID || ''), urgent: r['Срочно, ч'], show: r['Показывать, ч'], active: _v89B_(r['Активно'], true) }; });
    } else out.recipientsCount = _v89Recipients_().filter(function (r) { return r.active; }).length;
    if (can.proc || can.manage) out.procParams = _v89Rows_(MC_V89_PP_, MC_V89_PP_HEAD_).map(function (r) { return { product: String(r['Продукт']), unit: String(r['Ед.']), supplierId: String(r.SupplierID || ''), supplier: String(r['Поставщик'] || ''),
      min: r['Мин. запас'], target: r['Целевой запас'], safety: r['Страховой запас'], minBatch: r['Мин. партия'], mult: r['Кратность'], lead: r['Срок поставки, дн'], coef: r['Коэффициент'], active: _v89B_(r['Активен'], true) }; });
    if (can.proc || can.manage) try { out.suppliers = _mdSuppliers_().map(function (x) { return { id: x.id, name: String(x.name) }; }); } catch (e) { out.suppliers = []; }
    if (can.fin || can.finEdit) out.budget = _v89Rows_(MC_V89_BG_, MC_V89_BG_HEAD_).map(function (r) { return { id: String(r.BudgetID), kind: String(r['Тип периода']), period: _v89Iso_(r['Период']), art: String(r['Статья']), sum: r['Сумма'], loc: String(r.LocationID || '') }; });
    out.log = _v89Log_().slice(-120).reverse().map(function (r) { return { id: String(r.NotificationID), cfg: String(r.TriggerConfigID), loc: String(r.LocationID), shift: String(r.ShiftID), date: _v89Iso_(r.ShiftDate) || String(r.ShiftDate), type: String(r.NotificationType),
      typeRu: MC_V89_TYPES_[String(r.NotificationType)] || String(r.NotificationType), planned: _v89Fmt2_(r.PlannedAt, tz), sent: _v89Fmt2_(r.SentAt, tz), status: String(r.Status), late: _v89B_(r.LateFlag, false), code: String(r.ErrorCode || ''), msg: String(r.ErrorMessage || ''),
      note: String(r['Примечание'] || ''), files: String(r.AttachmentFileIDs || '').split(',').filter(Boolean).length, hash: String(r.ReportHash || '').slice(0, 12) }; });
    out.errors = _v89Errs_().filter(function (e) { return !e.ResolvedAt; }).slice(-60).reverse().map(function (e) { return { id: String(e.ErrorID), nid: String(e.NotificationID), type: String(e.ErrorType), sev: String(e.Severity), msg: String(e.Message), retry: _v89B_(e.Retryable, false),
      attempts: e.Attempts, next: _v89Fmt2_(e.NextRetryAt, tz), at: _v89Fmt2_(e.CreatedAt, tz) }; });
    if (can.decide || can.view) out.suggestions = _v89SgRows_().slice(-150).reverse().map(function (r) { return { id: String(r.SuggestionID), batch: String(r.BatchID), product: String(r['Продукт']), rem: String(r['Остаток']), expiry: String(r['Срок годности'] || ''),
      reason: String(r['Причина']), action: String(r['Действие']), actionRu: MC_V89_ACTIONS_[String(r['Действие'])] || String(r['Действие']), rec: String(r['Рекомендация']), due: _v89Fmt2_(r['Срок выполнения'], tz), role: String(r['Ответственная роль']),
      effect: can.fin && r['Эффект, ₽'] !== '' ? Number(r['Эффект, ₽']) : null, risk: String(r['Риск']), status: String(r['Статус']), by: String(r['Решил'] || ''), at: _v89Fmt2_(r['Решено'], tz), comment: String(r['Комментарий'] || '') }; });
    return _ok_(out);
  } catch (e) { return _failFrom_(e); }
}
function v89SaveConfig(json, token) {
  return _v89Run_(token, 'notification_manage', 'V89_CONFIG', function (op, s) {
    var d = _v89J_(json), rows = _v89Rows_(MC_V89_CFG_, MC_V89_CFG_HEAD_), cur = d.id ? rows.filter(function (r) { return String(r.TriggerConfigID) === String(d.id); })[0] : null;
    if (d.id && !cur) return _v89Bad_('NOT_FOUND', 'Настройка площадки не найдена');
    var loc = String(d.LocationID || (cur && cur.LocationID) || 'MAIN').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!loc) return _v89Bad_('VALIDATION', 'Код площадки (LocationID): латиница, цифры, «-» и «_»');
    if (rows.some(function (r) { return String(r.LocationID) === loc && (!cur || r._row !== cur._row); })) return _v89Bad_('CONFLICT', 'Для площадки ' + loc + ' настройка уже есть — откройте её');
    var tzv = String(d.Timezone || '').trim(); if (tzv && !_v89TzOk_(tzv)) return _v89Bad_('VALIDATION', 'Часовой пояс не распознан: укажите как «Asia/Yekaterinburg», «Europe/Moscow»');
    var bad = []; ['ShiftStartOffsetMinutes', 'ShiftCloseOffsetMinutes'].forEach(function (k) { if (d[k] !== undefined && d[k] !== '') { var n = _v89N_(d[k]); if (!(n >= 0 && n <= 720)) bad.push(k + ': от 0 до 720 минут'); } });
    ['FallbackMorningTime', 'FallbackMiddayTime', 'FallbackClosingTime'].forEach(function (k) { if (d[k] && !_v89Hm_(d[k])) bad.push(k + ': время ЧЧ:ММ'); });
    ['RecipientGroupMorning', 'RecipientGroupMidday', 'RecipientGroupClosing'].forEach(function (k) { String(d[k] || '').split(/[,;\s]+/).filter(Boolean).forEach(function (g) { if (!MC_V89_GROUPS_[g.toUpperCase()]) bad.push(k + ': нет группы ' + g); }); });
    if (d.MinimumSeverityToSend && MC_V89_PRIO_.indexOf(String(d.MinimumSeverityToSend).toUpperCase()) < 0) bad.push('MinimumSeverityToSend: КРИТИЧНО, ВАЖНО или ОБЫЧНО');
    if (d.ActiveFrom && !_v89Iso_(d.ActiveFrom)) bad.push('ActiveFrom: дата'); if (d.ActiveTo && !_v89Iso_(d.ActiveTo)) bad.push('ActiveTo: дата');
    if (bad.length) return _v89Bad_('VALIDATION', bad.join('; '));
    var o = { LocationID: loc, UpdatedBy: _v89Who_(s), UpdatedAt: new Date() };
    MC_V89_CFG_HEAD_.forEach(function (k) { if (/^(TriggerConfigID|LocationID|UpdatedBy|UpdatedAt)$/.test(k) || d[k] === undefined) return; var v = d[k];
      if (/^(Active|ShiftMidpointEnabled|Include|SendEmptyReport|Attach|DryRun)/.test(k)) v = _v89B_(v, false); if (/Fallback/.test(k)) v = v ? "'" + _v89Hm_(v) : ''; if (/RecipientGroup/.test(k)) v = _v89GroupList_(v).join(',');
      if (/^Active(From|To)$/.test(k)) v = v ? "'" + _v89Iso_(v) : ''; if (k === 'MinimumSeverityToSend') v = String(v || 'ОБЫЧНО').toUpperCase(); o[k] = v; });
    if (!cur) { o.TriggerConfigID = _v89Id_('ETC'); if (o.OrganizationID === undefined) o.OrganizationID = 'ORG'; if (o.Active === undefined) o.Active = false; ['ShiftStartOffsetMinutes', 'ShiftCloseOffsetMinutes'].forEach(function (k) { if (o[k] === undefined || o[k] === '') o[k] = 120; });
      ['ShiftMidpointEnabled', 'IncludeFinancialReport', 'IncludeSupplierRequests', 'IncludeExpiryReport', 'IncludeResortRecommendations', 'SendEmptyReport', 'AttachPDF', 'AttachTXT'].forEach(function (k) { if (o[k] === undefined) o[k] = true; });
      if (o.AttachExcel === undefined) o.AttachExcel = false; if (o.DryRun === undefined) o.DryRun = false; if (!o.MinimumSeverityToSend) o.MinimumSeverityToSend = 'ОБЫЧНО'; if (!o.ShiftCalendarSource) o.ShiftCalendarSource = MC_V89_SH_; }
    _v89Put_(MC_V89_CFG_, MC_V89_CFG_HEAD_, o, cur ? cur._row : null);
    var c0 = _v89Cfgs_().filter(function (x) { return x.LocationID === loc; })[0];
    // момент включения отправки: окна до него не считаются пропущенными (нет серии «пропущено» после первой настройки)
    if (c0 && c0.active && (!cur || !_v89B_(cur.Active, false))) _v89Props_().setProperty('MC_V89_ACT_' + c0.TriggerConfigID, String(Date.now()));
    var c = _v89Cfgs_().filter(function (x) { return x.LocationID === loc; })[0], miss = _v89Missing_(c), blk = _v89Blocking_(miss);
    _audit_(op, 'V89_CONFIG', MC_V89_CFG_, c.TriggerConfigID, cur ? { active: cur.Active } : null, { loc: loc, active: c.active, dry: c.dry, missing: blk.length });
    return { id: c.TriggerConfigID, status: !c.active ? 'ВЫКЛЮЧЕНО' : blk.length ? 'CONFIGURATION_REQUIRED' : c.dry ? 'DRY_RUN' : 'ВКЛЮЧЕНО', missing: miss };
  });
}
function v89SaveShift(json, token) {
  return _v89Run_(token, 'notification_manage', 'V89_SHIFT', function (op, s) {
    var d = _v89J_(json), rows = _v89Rows_(MC_V89_SH_, MC_V89_SH_HEAD_), cur = d.id ? rows.filter(function (r) { return String(r.ShiftID) === String(d.id); })[0] : null;
    if (d.remove) { if (!cur) return _v89Bad_('NOT_FOUND', 'Смена не найдена'); _v89Put_(MC_V89_SH_, MC_V89_SH_HEAD_, { 'Активна': false, 'Обновил': _v89Who_(s), 'Обновлено': new Date() }, cur._row); _audit_(op, 'V89_SHIFT_OFF', MC_V89_SH_, d.id, null, null); return { id: d.id, active: false }; }
    var st = _v89Hm_(d.start), en = d.end ? _v89Hm_(d.end) : ''; if (!st) return _v89Bad_('VALIDATION', 'Начало смены — время ЧЧ:ММ'); if (d.end && !en) return _v89Bad_('VALIDATION', 'Окончание смены — время ЧЧ:ММ или пусто, если не задано');
    var days = String(d.days || '').split(/[,;\s]+/).filter(Boolean).map(Number); if (days.some(function (x) { return !(x >= 1 && x <= 7); })) return _v89Bad_('VALIDATION', 'Дни недели — числа 1–7 (1 — понедельник), через запятую; пусто — каждый день');
    var date = d.date ? _v89Iso_(d.date) : ''; if (d.date && !date) return _v89Bad_('VALIDATION', 'Дата — ГГГГ-ММ-ДД');
    var o = { ShiftID: cur ? String(cur.ShiftID) : (String(d.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') || _v89Id_('SH')), LocationID: String(d.loc || '').trim().toUpperCase(), 'Название': String(d.name || '').slice(0, 60),
      'Дни недели': "'" + days.join(','), 'Дата': date ? "'" + date : '', 'Начало': "'" + st, 'Окончание': en ? "'" + en : '', 'Активна': d.active === undefined ? true : _v89B_(d.active, true), 'Обновил': _v89Who_(s), 'Обновлено': new Date() };
    if (!cur && rows.some(function (r) { return String(r.ShiftID) === o.ShiftID; })) return _v89Bad_('CONFLICT', 'Смена с кодом ' + o.ShiftID + ' уже есть');
    _v89Put_(MC_V89_SH_, MC_V89_SH_HEAD_, o, cur ? cur._row : null); _audit_(op, 'V89_SHIFT', MC_V89_SH_, o.ShiftID, null, { start: st, end: en, days: days, date: date });
    return { id: o.ShiftID, warning: en ? '' : 'Окончание не задано: письмо о закрытии — только по резервному времени (SHIFT_END_ESTIMATED), без него не отправляется' };
  });
}
function v89SaveRecipient(json, token) {
  return _v89Run_(token, 'notification_manage', 'V89_RECIPIENT', function (op, s) {
    var d = _v89J_(json), rows = _v89Rows_(MC_V89_RC_, MC_V89_RC_HEAD_), cur = d.id ? rows.filter(function (r) { return String(r.RecipientID) === String(d.id); })[0] : null;
    if (d.remove) { if (!cur) return _v89Bad_('NOT_FOUND', 'Адресат не найден'); _v89Put_(MC_V89_RC_, MC_V89_RC_HEAD_, { 'Активен': false, 'Обновил': _v89Who_(s), 'Обновлено': new Date() }, cur._row); _audit_(op, 'V89_RECIPIENT_OFF', MC_V89_RC_, d.id, null, null); return { id: d.id, active: false }; }
    var g = String(d.group || '').toUpperCase(), e = String(d.email || '').trim(); if (!MC_V89_GROUPS_[g]) return _v89Bad_('VALIDATION', 'Выберите группу адресатов'); if (!_v89EmailOk_(e)) return _v89Bad_('VALIDATION', 'Адрес почты не распознан');
    var emp = String(d.emp || ''), E = _mcRbEmpState_(); if (emp && !E[emp]) return _v89Bad_('VALIDATION', 'Сотрудник не найден');
    var o = { RecipientID: cur ? String(cur.RecipientID) : _v89Id_('RCP'), 'Группа': g, Email: e, EmployeeID: emp, 'Сотрудник': emp ? E[emp].name : '', LocationID: String(d.loc || '').trim().toUpperCase(), 'Активен': true, 'Обновил': _v89Who_(s), 'Обновлено': new Date() };
    _v89Put_(MC_V89_RC_, MC_V89_RC_HEAD_, o, cur ? cur._row : null); _audit_(op, 'V89_RECIPIENT', MC_V89_RC_, o.RecipientID, null, { group: g, emp: emp, emailHash: _v89Sha_(e.toLowerCase()).slice(0, 16) });
    var R = _v89Rights_({ group: g, emp: emp, empName: o['Сотрудник'] });
    return { id: o.RecipientID, rights: R.ok ? _v89VariantRu_(_v89VariantKey_(R)) : R.why };
  });
}
function v89SaveProcParam(json, token) {
  return _v89Run_(token, 'procurement|procurement_create|notification_manage', 'V89_PROC_PARAM', function (op, s) {
    var d = _v89J_(json), name = String(d.product || '').trim(); if (!name) return _v89Bad_('VALIDATION', 'Укажите продукт');
    var unit = String(d.unit || '').trim(); if (!unit) return _v89Bad_('VALIDATION', 'Укажите единицу (кг, л, шт)'); if (_toBaseUnitServer_(1, unit).unit === unit && !/^(г|мл|шт)$/.test(unit)) return _v89Bad_('VALIDATION', 'Единица не распознана: ' + unit);
    var nums = {}, bad = []; [['min', 'Мин. запас'], ['target', 'Целевой запас'], ['safety', 'Страховой запас'], ['minBatch', 'Мин. партия'], ['mult', 'Кратность'], ['lead', 'Срок поставки, дн'], ['coef', 'Коэффициент']].forEach(function (f) {
      if (d[f[0]] === undefined || d[f[0]] === '' || d[f[0]] === null) { nums[f[1]] = ''; return; } var n = _v89N_(d[f[0]]); if (!(n >= 0)) bad.push(f[1] + ': число ≥ 0'); else nums[f[1]] = n; });
    if (nums['Коэффициент'] === 0) bad.push('Коэффициент: больше 0'); if (nums['Целевой запас'] !== '' && nums['Мин. запас'] !== '' && nums['Целевой запас'] < nums['Мин. запас']) bad.push('Целевой запас не меньше минимального');
    if (bad.length) return _v89Bad_('VALIDATION', bad.join('; '));
    var sup = null; if (d.supplierId || d.supplier) { sup = _v89SupName_(_v89Sup_(), d.supplierId, String(d.supplier || '')); if (!sup || !sup.id) return _v89Bad_('VALIDATION', 'Поставщик не найден в справочнике «Поставщики»'); }
    var rows = _v89Rows_(MC_V89_PP_, MC_V89_PP_HEAD_), cur = rows.filter(function (r) { return _prodKey_(r['Продукт']) === _prodKey_(name); })[0];
    var o = Object.assign({ 'Продукт': name, 'Ед.': unit, SupplierID: sup ? sup.id : '', 'Поставщик': sup ? sup.name : '', 'Активен': d.active === undefined ? true : _v89B_(d.active, true), 'Обновил': _v89Who_(s), 'Обновлено': new Date() }, nums);
    _v89Put_(MC_V89_PP_, MC_V89_PP_HEAD_, o, cur ? cur._row : null); _audit_(op, 'V89_PROC_PARAM', MC_V89_PP_, name, null, o);
    return { product: name, supplier: o['Поставщик'] || '' };
  });
}
function v89SaveExpiryRule(json, token) {
  return _v89Run_(token, 'notification_manage', 'V89_EXPIRY_RULE', function (op, s) {
    var d = _v89J_(json), rows = _v89Rows_(MC_V89_XR_, MC_V89_XR_HEAD_), cur = d.id ? rows.filter(function (r) { return String(r.RuleID) === String(d.id); })[0] : null;
    if (d.remove) { if (!cur) return _v89Bad_('NOT_FOUND', 'Правило не найдено'); _v89Put_(MC_V89_XR_, MC_V89_XR_HEAD_, { 'Активно': false, 'Обновил': _v89Who_(s), 'Обновлено': new Date() }, cur._row); return { id: d.id, active: false }; }
    var area = String(d.area || '').toLowerCase(); if (!/^(продукт|категория|тип)$/.test(area)) return _v89Bad_('VALIDATION', 'Область: продукт, категория или тип');
    if (!String(d.value || '').trim()) return _v89Bad_('VALIDATION', area === 'тип' ? 'Тип: п/ф, сырьё или короткий срок' : area === 'категория' ? 'Категория: слова в названии через «|», например «молок|сливк|творог»' : 'Укажите продукт');
    var u = _v89N_(d.urgent), sh = _v89N_(d.show); if (!(u > 0 && u <= 720) || !(sh > 0 && sh <= 2160) || sh < u) return _v89Bad_('VALIDATION', 'Часы: «срочно» 1–720, «показывать» 1–2160 и не меньше «срочно»');
    var o = { RuleID: cur ? String(cur.RuleID) : _v89Id_('XR'), 'Область': area, 'Значение': String(d.value).trim(), LocationID: String(d.loc || '').trim().toUpperCase(), 'Срочно, ч': u, 'Показывать, ч': sh, 'Активно': true, 'Обновил': _v89Who_(s), 'Обновлено': new Date() };
    _v89Put_(MC_V89_XR_, MC_V89_XR_HEAD_, o, cur ? cur._row : null); _audit_(op, 'V89_EXPIRY_RULE', MC_V89_XR_, o.RuleID, null, o); return { id: o.RuleID };
  });
}
function v89SaveBudget(json, token) {
  return _v89Run_(token, 'finance_edit', 'V89_BUDGET', function (op, s) {
    var d = _v89J_(json), kind = /мес/i.test(String(d.kind)) ? 'месяц' : 'день', per = _v89Iso_(d.period); if (!per) return _v89Bad_('VALIDATION', 'Период — дата (для месяца — любой день месяца)');
    var art = String(d.art || '').toLowerCase(); if (!/^(выручка|расходы)$/.test(art)) return _v89Bad_('VALIDATION', 'Статья: выручка или расходы'); var sum = _v89N_(d.sum); if (!(sum >= 0)) return _v89Bad_('VALIDATION', 'Сумма — число ≥ 0');
    var rows = _v89Rows_(MC_V89_BG_, MC_V89_BG_HEAD_), loc = String(d.loc || '').trim().toUpperCase(), cur = rows.filter(function (r) { return String(r['Тип периода']) === kind && (kind === 'месяц' ? _v89Iso_(r['Период']).slice(0, 7) === per.slice(0, 7) : _v89Iso_(r['Период']) === per) && String(r['Статья']).toLowerCase() === art && String(r.LocationID || '') === loc; })[0];
    var o = { BudgetID: cur ? String(cur.BudgetID) : _v89Id_('BG'), 'Тип периода': kind, 'Период': "'" + (kind === 'месяц' ? per.slice(0, 7) + '-01' : per), 'Статья': art, 'Сумма': sum, LocationID: loc, 'Обновил': _v89Who_(s), 'Обновлено': new Date() };
    _v89Put_(MC_V89_BG_, MC_V89_BG_HEAD_, o, cur ? cur._row : null); _audit_(op, 'V89_BUDGET', MC_V89_BG_, o.BudgetID, cur ? { sum: cur['Сумма'] } : null, { kind: kind, period: per, art: art, sum: sum }); return { id: o.BudgetID };
  });
}
function v89SaveGlobal(json, token) {
  return _v89Run_(token, 'notification_manage', 'V89_GLOBAL', function (op, s) {
    var d = _v89J_(json), n = parseInt(d.avgDays, 10); if (!(n >= 7 && n <= 56)) return _v89Bad_('VALIDATION', 'Средний расход — за 7–56 дней');
    _v89Props_().setProperty('MC_V89_AVG_DAYS', String(n)); _v89Props_().setProperty('MC_V89_SHOW_CONTACT', _v89B_(d.showContact, false) ? 'true' : 'false');
    _audit_(op, 'V89_GLOBAL', 'Уведомления', null, null, { avgDays: n, showContact: _v89B_(d.showContact, false) }); return { avgDays: n };
  });
}
/** Предпросмотр письма: формирует, ничего не отправляет и не записывает. Вариант — не шире прав того, кто смотрит. */
function v89Preview(json, token) {
  try {
    var s = _requireAuth_(token, 'notification_view|notification_manage|notification_send'), d = _v89J_(json), can = _v89Can_(s), nowMs = Date.now();
    var c = _v89Cfgs_().filter(function (x) { return x.TriggerConfigID === String(d.id); })[0]; if (!c) return _fail_('NOT_FOUND', 'Настройка площадки не найдена');
    var types = String(d.types || 'MORNING').split('+').filter(function (t) { return MC_V89_TYPES_[t]; }); if (!types.length) types = ['MORNING'];
    var W = _v89Windows_(c, nowMs), w = W.windows.filter(function (x) { return types.every(function (t) { return x.types.indexOf(t) >= 0; }); }).sort(function (a, b) { return Math.abs(a.at - nowMs) - Math.abs(b.at - nowMs); })[0];
    if (!w) { var td = _v89Today_(c, nowMs); w = { types: types, at: new Date(nowMs), shift: { id: 'PREVIEW', name: 'предпросмотр без расписания', date: td, startAt: null, endAt: null, source: 'FALLBACK', flags: [] }, flags: ['FALLBACK_SCHEDULE'] }; }
    else w = { types: types, at: w.at, shift: w.shift, flags: w.flags, merged: w.merged };
    var V = { F: !!d.F && can.fin, P: !!d.P && can.proc, W: !!d.W && _mcRbHasExact_(s, 'payroll_view'), E: d.E === undefined ? true : !!d.E };
    var D = _v89Collect_(c, w, nowMs, false), R = _v89Render_(D, V, null);
    return _ok_({ subject: R.subject, html: R.html, text: R.text, variant: _v89VariantRu_(_v89VariantKey_(V)), missing: _v89Missing_(c), sev: R.sev, hash: D.hash.slice(0, 16), errors: W.errors.map(function (e) { return e.code + ': ' + e.text; }) });
  } catch (e) { return _failFrom_(e); }
}
/** Ручная повторная отправка (ТЗ 5): только с причиной; повторная отправка помечается в теме и журнале. */
function v89Resend(json, token) {
  return _v89Run_(token, 'notification_send', 'V89_RESEND', function (op, s) {
    var d = _v89J_(json), reason = String(d.reason || '').trim(); if (reason.length < 5) return _v89Bad_('VALIDATION', 'Укажите причину повторной отправки');
    var log = _v89Log_(), r = log.filter(function (x) { return String(x.NotificationID) === String(d.id); })[0]; if (!r) return _v89Bad_('NOT_FOUND', 'Запись журнала не найдена');
    var c = _v89Cfgs_().filter(function (x) { return x.TriggerConfigID === String(r.TriggerConfigID); })[0]; if (!c) return _v89Bad_('NOT_FOUND', 'Настройка площадки удалена');
    var sib = log.filter(function (x) { return String(x.NotificationID).split('/')[0] === String(r.NotificationID).split('/')[0] && !/#/.test(String(x.DuplicateKey)); }); if (!sib.length) sib = [r];
    var w = _v89WindowOf_(c, sib, Date.now()); w.late = false;
    var res = _v89Deliver_(c, w, Date.now(), { persist: false, manual: reason + ' (' + _v89Who_(s) + ')', op: op.id });
    _audit_(op, 'V89_RESEND', MC_V89_LOG_, r.NotificationID, null, { reason: reason, status: res.status });
    if (res.status === 'FAILED' || res.status === 'RETRY') return _v89Bad_('SEND_FAILED', 'Письмо не отправлено: ' + (res.error || '') + (res.status === 'RETRY' ? ' — система повторит отправку' : ''));
    if (res.status === 'SKIPPED') return _v89Bad_(res.code || 'SKIPPED', 'Письмо не отправлено: ' + (res.code === 'RECIPIENTS_NOT_CONFIGURED' ? 'нет адресатов' : 'нечего отправлять'));
    return { status: res.status, to: res.to || 0 };
  });
}
function v89SuggestionDecide(json, token) {
  return _v89Run_(token, MC_V89_SG_NEED_, 'V89_SUGGESTION', function (op, s) {
    var d = _v89J_(json), dec = String(d.decision || '').toUpperCase(), cm = String(d.comment || '').trim(), r = _v89SgRows_().filter(function (x) { return String(x.SuggestionID) === String(d.id); })[0];
    if (!r) return _v89Bad_('NOT_FOUND', 'Предложение не найдено'); if (!/^(ACCEPTED|DECLINED|EXECUTED)$/.test(dec)) return _v89Bad_('VALIDATION', 'Решение: принять, отклонить или выполнено');
    var st = String(r['Статус']); if (/^(EXECUTED|DECLINED|EXPIRED)$/.test(st)) return _v89Bad_('CONFLICT', 'Предложение уже закрыто: ' + st);
    var act = String(r['Действие']), need = MC_V89_SG_BY_[act] || 'notification_manage';
    if (!_mcRbHasExact_(s, need + '|notification_manage')) return _v89Bad_('FORBIDDEN', 'Решение «' + (MC_V89_ACTIONS_[act] || act) + '» принимает ответственная роль: ' + String(r['Ответственная роль'] || '') + ' (право ' + need.split('|').join(' или ') + ')');
    if (dec === 'DECLINED' && cm.length < 3) return _v89Bad_('VALIDATION', 'Отклонение — с причиной');
    if (dec === 'EXECUTED' && cm.length < 3) return _v89Bad_('VALIDATION', 'Укажите, что сделано и где (номер акта, задания, документа)');
    _v89Put_(MC_V89_SG_, MC_V89_SG_HEAD_, { 'Статус': dec, 'Решил': _v89Who_(s), 'Решено': new Date(), 'Комментарий': cm }, r._row);
    _audit_(op, 'V89_SUGGESTION', MC_V89_SG_, d.id, { status: st }, { status: dec, comment: cm });
    return { id: d.id, status: dec, note: dec === 'ACCEPTED' ? 'Принято. Само действие (списание, заготовка, перемещение) оформите в своём экране — система по предложению ничего не меняет.' : '' };
  });
}
function v89ResolveError(json, token) {
  return _v89Run_(token, 'notification_manage', 'V89_ERROR_RESOLVE', function (op, s) {
    var d = _v89J_(json), e = _v89Errs_().filter(function (x) { return String(x.ErrorID) === String(d.id); })[0]; if (!e) return _v89Bad_('NOT_FOUND', 'Ошибка не найдена');
    if (String(d.comment || '').trim().length < 3) return _v89Bad_('VALIDATION', 'Укажите, что сделано');
    _v89Put_(MC_V89_ERR_, MC_V89_ERR_HEAD_, { ResolvedAt: new Date(), ResolvedBy: _v89Who_(s) + ': ' + String(d.comment).trim(), Retryable: false }, e._row);
    _audit_(op, 'V89_ERROR_RESOLVE', MC_V89_ERR_, d.id, null, { comment: d.comment }); return { id: d.id };
  });
}
/** «Проверить расписание сейчас»: то же, что плановый запуск (отправит только наступившие и не отправленные окна). */
function v89RunNow(token) {
  var op = null; try { op = _v89Op_(token, 'notification_manage', 'V89_RUN_NOW'); } catch (e) { return _failFrom_(e); }
  try { var r = v89EmailTick_(); _audit_(op, 'V89_RUN_NOW', 'Уведомления', null, null, r); _endOp_(op); return _ok_(r, op.id); } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op.id); }
}

/* ---------------- права, раздел меню, «Моя смена» ---------------- */
(function () {
  var add = [['notification_view', 'Сменные письма — просмотр журнала уведомлений и предпросмотр', 'Уведомления'], ['notification_manage', 'Сменные письма — расписание смен, адресаты, пороги и состав писем', 'Уведомления'],
    ['notification_send', 'Сменные письма — ручная повторная отправка с причиной', 'Уведомления'], ['procurement_view', 'Закупки — предложения заявок по поставщикам', 'Закупки'],
    ['procurement_create', 'Закупки — ручное создание заявки и параметры закупки', 'Закупки'], ['stock_expiry_view', 'Склад — сроки годности и просрочки', 'Склад'],
    ['stock_transfer_create', 'Склад — ручное подтверждение перемещения', 'Склад'], ['stock_writeoff_create', 'Склад — ручное подтверждение списания', 'Склад'],
    ['report_export', 'Отчёты — создание вложений (PDF, Excel, TXT)', 'Отчёты'], ['payroll_view', 'ФОТ и начисления в управленческих отчётах', 'Экономика']];
  try { add.forEach(function (p) { if (!MC_RB_PERMS_.some(function (x) { return x[0] === p[0]; })) MC_RB_PERMS_.push(p); }); } catch (e) {}
  var give = function (role, list) { try { var a = MC_RB_MATRIX_[role]; if (a) list.forEach(function (k) { if (a.indexOf(k) < 0) a.push(k); }); } catch (e) {} };
  give('Директор', add.map(function (p) { return p[0]; }));
  ['Шеф-повар', 'Су-шеф'].forEach(function (r) { give(r, ['notification_view', 'procurement_view', 'procurement_create', 'stock_expiry_view', 'stock_writeoff_create', 'report_export']); });
  give('Ответственный за ХАССП', ['notification_view', 'stock_expiry_view', 'stock_writeoff_create']);
  give('Администратор', ['notification_view']);
  try { MC_RB_GRANTABLE_.notification_manage = ['Шеф-повар', 'Су-шеф']; MC_RB_GRANTABLE_.notification_send = ['Шеф-повар', 'Су-шеф', 'Ответственный за ХАССП']; MC_RB_GRANTABLE_.payroll_view = ['Администратор']; MC_RB_GRANTABLE_.procurement_view = ['Ответственный за ХАССП', 'Кондитер']; } catch (e) {}
  try { MC_RB_MODULES_.notify = 'notification_view|notification_manage|notification_send|stock_expiry_view|procurement_view'; MC_RB_MODULE_RU_.notify = 'Сменные письма'; } catch (e) {}
  try { if (MC_UI_VIEWS_.indexOf('notify') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['notify']); } catch (e) {}
  try {
    var sec = function (k, btn) { var orig = _UI_BUILDERS_[k]; if (typeof orig !== 'function') return; _UI_BUILDERS_[k] = function (token, opts, s) { var r = orig(token, opts, s) || {}; r.actions = (r.actions || []).concat([btn]); return r; }; };
    sec('settings', { label: 'Сменные письма: расписание, адресаты, журнал', module: 'notify' });
    sec('stock', { label: 'Сроки, go-лист и пересорт', module: 'expiry' });
    sec('stock', { label: 'Сменные письма: заявки, сроки, предложения', module: 'notify' });
  } catch (e) {}
})();
try {
  MC_V87_SOURCES_.push(function (ctx) {
    var s = ctx.s, out = []; if (!s || s.dev) return out;
    if (_mcRbHasExact_(s, 'notification_manage')) {
      var cf = _v89Cfgs_().filter(function (c) { return c.active; }), bad = cf.filter(function (c) { return _v89Blocking_(_v89Missing_(c)).length; });
      if (bad.length) out.push({ key: 'V89|cfg', group: 'error', source: 'Сменные письма', title: 'Сменные письма не отправляются: CONFIGURATION_REQUIRED', detail: bad.map(function (c) { return c.name + ': ' + _v89Blocking_(_v89Missing_(c)).join('; '); }).join(' · ').slice(0, 300), who: 'вы', act: { kind: 'open', module: 'notify', label: 'Настроить' } });
      var er = _v89Errs_().filter(function (e) { return !e.ResolvedAt && /КРИТИЧНО/.test(String(e.Severity)); });
      if (er.length) out.push({ key: 'V89|err', group: 'error', source: 'Сменные письма', title: 'Ошибки сменных писем: ' + er.length, detail: String(er[er.length - 1].Message).slice(0, 200), who: 'вы', act: { kind: 'open', module: 'notify', label: 'Открыть журнал' } });
    }
    if (_mcRbHasExact_(s, 'stock|prod_manage|haccp|stock_writeoff_create')) {
      var sg = _v89SgRows_().filter(function (r) { return String(r['Статус']) === 'SUGGESTED' && /КРИТИЧНО|ВАЖНО/.test(String(r['Риск'])); });
      if (sg.length) out.push({ key: 'V89|sg', group: 'now', source: 'Сменные письма', title: 'Предложения по складу ждут решения: ' + sg.length, detail: sg.slice(0, 3).map(function (r) { return (MC_V89_ACTIONS_[String(r['Действие'])] || r['Действие']) + ' — ' + r['Продукт']; }).join('; '), who: 'склад, шеф-повар', act: { kind: 'open', module: 'notify', label: 'Решить' } });
    }
    return out;
  });
} catch (e) {}
