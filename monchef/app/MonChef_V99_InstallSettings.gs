/**
 * MON CHEF V99 — идентификатор рабочей таблицы (SHEET_ID) в настройках установки.
 *
 * Откуда берётся таблица (по порядку): свойство скрипта MC_SHEET_ID (этот экран, технический доступ или право «system») →
 *   файл MonChef_InstallConfig.gs, который пишет установщик (MC_INSTALL_SHEET_ID_) → запасная константа SHEET_ID в Code.gs
 *   (система работает, но показывает предупреждение «таблица задана в коде»).
 * Сменить таблицу — значит перевести всю систему на другие данные, поэтому: проверка, что таблица открывается; если в ней нет листов
 *   MON CHEF (сотрудники, журналы) — только с отметкой «новая пустая таблица»; галочка подтверждения; запись в аудите старой и новой
 *   таблиц. Вернуть — «Сбросить»: снова файл установки или запасное значение.
 */
var MC_V99_SRC_RU_ = { PROPERTY: 'настройки установки (свойство скрипта MC_SHEET_ID)', INSTALL_CONFIG: 'файл установки MonChef_InstallConfig.gs', CODE: 'запасное значение в коде (Code.gs, SHEET_ID)' };
var MC_V99_MARKERS_ = ['Ж_Продажи', 'Склад_Партии', 'Audit_Log', 'Сотрудники'];

(function () {
  try { MC_RB_MODULES_.install = 'system'; MC_RB_MODULE_RU_.install = 'Настройки установки'; } catch (e) {}
  try { if (MC_UI_VIEWS_.indexOf('install') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['install']); } catch (e) {}
  try {
    var orig = _UI_BUILDERS_.settings; if (typeof orig === 'function') _UI_BUILDERS_.settings = function (token, opts, s) { var r = orig(token, opts, s) || {}; r.actions = (r.actions || []).concat([{ label: 'Настройки установки: рабочая таблица', module: 'install' }]); return r; };
  } catch (e) {}
})();

function _v99Can_(s) { return !!s && (s.dev === true || _mcRbHasExact_(s, 'system')); }
function _v99Mask_(id) { id = String(id || ''); return id.length > 12 ? id.slice(0, 6) + '…' + id.slice(-4) : id; }
function _v99View_(full) {
  var I = _mcSheetIdInfo_(), name = '', sheets = 0, err = '';
  try { var b = _book_(); name = b.getName ? b.getName() : ''; sheets = b.getSheets ? b.getSheets().length : 0; } catch (e) { err = String(e.message || e); }
  var inst = typeof MC_INSTALL_SHEET_ID_ !== 'undefined' && MC_INSTALL_SHEET_ID_ ? String(MC_INSTALL_SHEET_ID_) : '';
  return { id: full ? I.id : _v99Mask_(I.id), source: I.src, sourceRu: MC_V99_SRC_RU_[I.src], name: name, sheets: sheets, error: err, installConfig: full ? inst : (inst ? _v99Mask_(inst) : ''),
    codeFallback: full ? SHEET_ID : _v99Mask_(SHEET_ID), bad: I.bad || '',
    warning: I.src === 'CODE' ? 'Таблица задана в коде (запасное значение). Укажите её в настройках установки — тогда обновление кода не меняет, с какой таблицей работает система.' : '' };
}
/** Настройки установки: откуда взята таблица. Полный ID — только техническому доступу и праву «system». */
function v99InstallData(token) {
  var s; try { s = _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try { var can = _v99Can_(s); return _ok_({ can: can, install: _v99View_(can) }); } catch (e) { return _failFrom_(e); }
}
function _v99Fail_(op, c, m) { _endOp_(op, 'FAILED'); return _fail_(c, m, op.id); }
/** Указать таблицу: {sheetId (ID или ссылка), empty?: true — новая пустая таблица, confirm}. */
function v99SetSheetId(json, token) {
  var op = null; try { op = _beginOp_(token, 'system', 'V99_SHEET_ID_SET', 'Настройки установки', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, raw = String(d.sheetId || '').trim(), m = /\/d\/([A-Za-z0-9_-]{25,})/.exec(raw), id = m ? m[1] : raw;
    if (!_v99Can_(op.session)) return _v99Fail_(op, 'FORBIDDEN', 'Таблицу меняет технический доступ или право «system»');
    if (d.confirm !== true) return _v99Fail_(op, 'VALIDATION', 'Подтвердите галочкой: система будет работать с указанной таблицей');
    if (!/^[A-Za-z0-9_-]{25,}$/.test(id)) return _v99Fail_(op, 'VALIDATION', 'Это не ID таблицы Google: вставьте ссылку на таблицу или её ID (длинная строка из адреса после /d/)');
    var book = null; try { book = SpreadsheetApp.openById(id); } catch (e) { return _v99Fail_(op, 'NOT_FOUND', 'Таблица не открывается: нет доступа или неверный ID'); }
    var names = (book.getSheets ? book.getSheets() : []).map(function (x) { return x.getName(); }), found = MC_V99_MARKERS_.filter(function (n) { return names.indexOf(n) >= 0; });
    if (!found.length && d.empty !== true) return _v99Fail_(op, 'VALIDATION', 'В таблице нет листов MON CHEF (' + MC_V99_MARKERS_.join(', ') + '). Если это новая пустая таблица для новой установки — отметьте «новая пустая таблица»');
    var before = _mcSheetIdInfo_(), props = PropertiesService.getScriptProperties();
    if (before.id === id && before.src === 'PROPERTY') return _v99Fail_(op, 'VALIDATION', 'Эта таблица уже указана в настройках установки');
    _audit_(op, 'V99_SHEET_ID_SET', 'Настройки установки', 'MC_SHEET_ID', { таблица: before.id, источник: before.src }, { таблица: id, название: book.getName ? book.getName() : '', листов_MON_CHEF: found.length, пустая: !found.length });
    props.setProperty('MC_SHEET_ID', id);
    _MC_SHEET_ID_ = null; _BOOK_CACHE_ = null;
    _endOp_(op);
    return _ok_({ id: id, name: book.getName ? book.getName() : '', markers: found, empty: !found.length, before: _v99Mask_(before.id), beforeSource: MC_V99_SRC_RU_[before.src] }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Сбросить свойство: снова файл установки или запасное значение. {confirm}. */
function v99ClearSheetId(json, token) {
  var op = null; try { op = _beginOp_(token, 'system', 'V99_SHEET_ID_CLEAR', 'Настройки установки', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {};
    if (!_v99Can_(op.session)) return _v99Fail_(op, 'FORBIDDEN', 'Таблицу меняет технический доступ или право «system»');
    if (d.confirm !== true) return _v99Fail_(op, 'VALIDATION', 'Подтвердите галочкой');
    var before = _mcSheetIdInfo_(); if (before.src !== 'PROPERTY') return _v99Fail_(op, 'VALIDATION', 'В настройках установки таблица не указана — сбрасывать нечего');
    var props = PropertiesService.getScriptProperties();
    _audit_(op, 'V99_SHEET_ID_CLEAR', 'Настройки установки', 'MC_SHEET_ID', { таблица: before.id }, null);
    props.deleteProperty('MC_SHEET_ID'); _MC_SHEET_ID_ = null; _BOOK_CACHE_ = null;
    var now = _mcSheetIdInfo_(); _endOp_(op);
    return _ok_({ source: now.src, sourceRu: MC_V99_SRC_RU_[now.src], id: _v99Mask_(now.id) }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* «Моя смена» директора: таблица задана в коде */
try {
  MC_V87_SOURCES_.push(function (ctx) {
    var s = ctx.s; if (!s || s.dev || _mcRbNormRole_(s.role) !== 'Директор') return [];
    var I = _mcSheetIdInfo_(); if (I.src !== 'CODE') return [];
    return [{ key: 'V99|code', group: 'later', source: 'Настройки установки', title: 'Рабочая таблица задана в коде — перенесите в настройки установки',
      detail: 'Система работает с запасным значением SHEET_ID из Code.gs. Код технического доступа → «Настройки» → «Настройки установки» → указать таблицу; новый установщик делает это сам.', act: null }];
  });
} catch (e) {}
