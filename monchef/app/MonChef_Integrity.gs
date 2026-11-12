/**
 * MON CHEF — целостность доказательной базы.
 *
 * 1. mcProtectEvidenceSheets — защита листов-доказательств (журналы, FACT, аудит, HACCP,
 *    приёмка, бракераж/выпуск, пробы, версии ТТК, подписи…): редактировать может только
 *    владелец скрипта, от имени которого работает приложение. Сотрудники с доступом к таблице
 *    править их напрямую не могут — только через приложение (с проверкой прав и аудитом).
 * 2. mcOnEditAudit — устанавливаемый триггер «при изменении»: любая ручная правка листа-
 *    доказательства (в том числе владельцем) пишется в Audit_Log: кто, лист, ячейка, было/стало.
 * 3. mcSwitchWatchSystem — контроль выключателей MC_INCOMING_CONTROL / MC_MEDICAL_GATE:
 *    смена состояния пишется в Audit_Log и уведомлением; выключенный контроль блокирует
 *    готовность (R19).
 */
var MC_EVIDENCE_FIXED_ = ['Audit_Log', 'Факты', 'HACCP_Факты_V31', 'HACCP_Действия_V31', 'Отклонения', 'Корректирующие_Действия',
  'Входной_Контроль', 'Выпуск_Партий', 'Суточные_Пробы', 'ТТК_Версии', 'ТТК_ККТ', 'Аллергены_Продукты', 'Резерв_Восстановление',
  'Готовность_Проверки', 'Вода_Контроль', 'Вредители_Мероприятия', 'Отходы', 'Лаборатория_Исследования', 'Медкнижки',
  'Оборудование_Реестр', 'Дезсредства_Факты_V41', 'Подписи_Журналов', 'Склад_Партии', 'Партии_События', 'Приёмка_Партии', 'OCR_Этикетки', 'Склад_Резервы', 'Корректировки', 'Температуры', 'Температурные_Объекты', 'Документы_Сырьё', 'ВСД', 'Меркурий_Обмен', 'Меркурий_Поставщики', 'Разбор_Акты', 'Разбор_Строки', 'Дефрост_Замеры', 'BatchRelations', 'Ветконтроль_Продукты', 'Маркировка', 'Миграции'];
var MC_SWITCHES_ = [{ prop: 'MC_INCOMING_CONTROL', name: 'Карантин и входной контроль партий' }, { prop: 'MC_MEDICAL_GATE', name: 'Медицинский допуск' }];

function _mcEvidenceSheets_() {
  var names = MC_EVIDENCE_FIXED_.slice().concat(['ТТК_История', 'ТТК_Архив', 'Права_Индивидуальные', 'Корректировки_Накладных']);   // этап 10.7
  try { (typeof JOURNALS !== 'undefined' ? JOURNALS : []).forEach(function (j) { if (j.sheetName) names.push(j.sheetName); }); } catch (e) {}
  try { names.push(_devSheet_().getName(), _corrSheet_().getName(), _mcSignatureSheet_().getName()); } catch (e) {}
  return names.filter(function (n, i, a) { return n && a.indexOf(n) === i; });
}

function mcProtectEvidenceSheets(token) {
  try {
    var s = _requireAuth_(token, 'personnel');
    if (!s.dev) return _fail_('FORBIDDEN', '403 — защиту листов включает технический доступ');
    var book = _book_(), me = '', done = [], already = [], missing = [], errors = [];
    try { me = Session.getEffectiveUser().getEmail(); } catch (e) {}
    _mcEvidenceSheets_().forEach(function (n) {
      var sh = book.getSheetByName(n); if (!sh) { missing.push(n); return; }
      try {
        var ps = sh.getProtections(SpreadsheetApp.ProtectionType ? SpreadsheetApp.ProtectionType.SHEET : 'SHEET') || [];
        var p = ps.length ? ps[0] : sh.protect();
        if (ps.length) already.push(n); else done.push(n);
        p.setDescription('MON CHEF: доказательная база — изменения только через приложение');
        try { if (me) p.addEditor(me); } catch (e) {}
        try { var eds = p.getEditors() || []; var others = eds.filter(function (u) { try { return u.getEmail() !== me; } catch (e) { return true; } }); if (others.length) p.removeEditors(others); } catch (e) {}
        try { if (p.canDomainEdit()) p.setDomainEdit(false); } catch (e) {}
        try { p.setWarningOnly(false); } catch (e) {}
      } catch (e) { errors.push(n + ': ' + e); }
    });
    try { PropertiesService.getScriptProperties().setProperty('MC_PROTECTED_AT', new Date().toISOString()); } catch (e) {}
    try { _audit_({ id: '', session: s }, 'EVIDENCE_PROTECT', 'Таблица', 'листы-доказательства', null, { protectedNow: done.length, already: already.length, missing: missing.length, errors: errors.length }); } catch (e) {}
    return _ok_({ protectedNow: done, alreadyProtected: already, notCreatedYet: missing, errors: errors, owner: me,
      note: 'Править эти листы напрямую может только владелец скрипта; каждая его ручная правка пишется в журнал аудита.' });
  } catch (e) { return _failFrom_(e); }
}

/** Устанавливаемый триггер «при изменении» таблицы: ручная правка листа-доказательства → Audit_Log. */
function mcOnEditAudit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet(), n = sh.getName();
    if (n === 'Audit_Log' || _mcEvidenceSheets_().indexOf(n) < 0) {
      if (n !== 'Audit_Log') return;
    }
    var who = ''; try { who = (e.user && e.user.getEmail && e.user.getEmail()) || Session.getActiveUser().getEmail() || ''; } catch (x) {}
    _auditSheet_().appendRow([new Date(), '', who || 'неизвестный редактор таблицы', 'ручная правка таблицы', '', '', '',
      'MANUAL_SHEET_EDIT', n, e.range.getA1Notation(), e.oldValue === undefined ? '' : String(e.oldValue), e.value === undefined ? '(несколько ячеек / вставка)' : String(e.value), 'MANUAL']);
    try { PropertiesService.getScriptProperties().setProperty('MC_MANUAL_EDIT_LAST', JSON.stringify({ at: new Date().toISOString(), sheet: n, range: e.range.getA1Notation(), who: who })); } catch (x) {}
  } catch (err) {}
}
function mcInstallEditAudit() {
  try { ScriptApp.newTrigger('mcOnEditAudit').forSpreadsheet(SHEET_ID).onEdit().create(); return true; } catch (e) { _log_('WARN', 'триггер аудита правок не установлен: ' + e); return false; }
}

function _mcSwitchState_() {
  var p = PropertiesService.getScriptProperties(), out = {};
  MC_SWITCHES_.forEach(function (w) { out[w.prop] = String(p.getProperty(w.prop) || 'on') === 'off' ? 'off' : 'on'; });
  return out;
}
/** Сравнить выключатели с прошлым состоянием; смену — в аудит и уведомление. */
function mcSwitchWatchSystem() {
  var p = PropertiesService.getScriptProperties(), now = _mcSwitchState_(), prev = {};
  try { prev = JSON.parse(p.getProperty('MC_SWITCH_STATE') || '{}'); } catch (e) {}
  var changed = MC_SWITCHES_.filter(function (w) { return (prev[w.prop] || 'on') !== now[w.prop]; });
  changed.forEach(function (w) {
    try { _audit_({ id: '', session: { fullName: 'система (контроль настроек)', role: 'SYSTEM' } }, 'CONTROL_SWITCH', 'Настройки', w.prop, prev[w.prop] || 'on', now[w.prop]); } catch (e) {}
    try { if (now[w.prop] === 'off') _notify_('control_off', 'critical', 'Отключён контроль: ' + w.name, 'Свойство ' + w.prop + '=off. Это нарушает требования; готовность к проверке заблокирована.', 'Руководитель', 'switch|' + w.prop + '|' + Date.now(), null); } catch (e) {}
  });
  p.setProperty('MC_SWITCH_STATE', JSON.stringify(now));
  return { ok: true, state: now, changed: changed.map(function (w) { return w.prop; }) };
}
/** Для готовности (R19). */
function _mcIntegrityState_() {
  var p = PropertiesService.getScriptProperties(), sw = {};
  try { mcSwitchWatchSystem(); } catch (e) {}
  sw = _mcSwitchState_();
  var off = MC_SWITCHES_.filter(function (w) { return sw[w.prop] === 'off'; });
  var manual = null; try { manual = JSON.parse(p.getProperty('MC_MANUAL_EDIT_LAST') || 'null'); } catch (e) {}
  return { off: off, protectedAt: p.getProperty('MC_PROTECTED_AT') || '', lastManualEdit: manual };
}
