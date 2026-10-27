/**
 * MON CHEF — история изменений ТТК (этап 10.7, ТЗ §7.1–§7.2).
 *
 * Каждое создание и изменение ТТК записывается в «ТТК_История»: ФИО, роль, дата и точное время, ID ТТК, название,
 * операция, перечень изменённых полей и было → стало по каждому (ингредиент: брутто, нетто, единица; выход;
 * технология; условия хранения; срок реализации). Строки — с цепочкой хешей (_mcChainAppend_): удалить или
 * подменить запись нельзя незаметно (mcAuditVerify). Правок истории в системе нет.
 *
 * Версии — прежний лист «ТТК_Версии»: черновик → ввод в действие (прежняя — в архив). Новое:
 *   • сравнение любых двух версий (mcTtkCompare);
 *   • «Вернуть версию N» создаёт новую версию — копию N, история не переписывается (mcTtkRestoreVersion);
 *   • архив карты вместо удаления, с причиной (mcTtkArchive), лист «ТТК_Архив»;
 *   • одновременная правка: черновик сохраняется только на той версии, которую человек открыл (baseVersion);
 *   • импорт из папки ttk создаёт версию с автором «Импорт» по каждой изменённой карте и не стирает карты,
 *     если папка вдруг оказалась пустой или недоступной;
 *   • ввод в действие: новый аллерген в составе или карта с назначенными ККТ — уведомление ответственному за ХАССП.
 */
var MC_TTK_HIST_SHEET_ = 'ТТК_История';
var MC_TTK_HIST_HEAD_ = ['Время', 'Код ТТК', 'Название блюда', 'Версия', 'Операция', 'Изменённые поля', 'Изменения (было → стало)', 'ФИО', 'Роль', 'EmployeeID', 'OperationID', 'Комментарий'];
var MC_TTK_ARCH_SHEET_ = 'ТТК_Архив';
var MC_TTK_ARCH_HEAD_ = ['Код ТТК', 'Название', 'Статус', 'Причина', 'Кто', 'Когда', 'OperationID'];

function _ttkHistSheet_() {
  var ss = _book_(), sh = ss.getSheetByName(MC_TTK_HIST_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(MC_TTK_HIST_SHEET_); sh.appendRow(MC_TTK_HIST_HEAD_); sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, MC_TTK_HIST_HEAD_.length).setBackground('#6e1423').setFontColor('#ffffff').setFontWeight('bold');
    try { sh.getRange('B:N').setNumberFormat('@'); } catch (e) {}
  }
  return sh;
}
function _ttkArchSheet_() { return _bcSheet_(MC_TTK_ARCH_SHEET_, MC_TTK_ARCH_HEAD_); }
function _ttkNum_(x) { if (x === null || x === undefined || x === '') return null; var n = parseFloat(String(x).replace(',', '.')); return isFinite(n) ? Math.round(n * 1000) / 1000 : null; }

/** Снимок карты для сравнения: название, выход, технология, хранение, срок, состав (по названию ингредиента). */
function _ttkSnap_(d) {
  d = d || {}; var ing = {};
  (d.ingredients || []).forEach(function (x) {
    var nm = String(x.name || '').replace(/\s+/g, ' ').trim(); if (!nm) return;
    ing[nm.toLowerCase()] = { name: nm, unit: String(x.unit || 'г'), brutto: _ttkNum_(x.brutto !== undefined && x.brutto !== '' ? x.brutto : x.brutto_g), netto: _ttkNum_(x.netto !== undefined && x.netto !== '' ? x.netto : x.netto_g) };
  });
  return { name: String(d.name || ''), yield: _ttkNum_(d.yield), method: String(d.method || '').trim(), storage: String(d.storage || '').trim(), shelf: String(d.shelf || '').trim(), ing: ing };
}
/** Снимок версии из «ТТК_Версии». */
function _ttkVerSnap_(code, version) {
  var sh = _ttkVersionsSheet_(), v = sh.getDataRange().getValues();
  for (var i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === String(code) && Number(v[i][1]) === Number(version)) {
    var ing = []; try { ing = JSON.parse(v[i][6] || '[]'); } catch (e) {}
    return { version: Number(v[i][1]), status: String(v[i][2]), dish: { name: v[i][3], yield: v[i][4], method: v[i][5], ingredients: ing, storage: v[i][10], shelf: v[i][11] }, author: v[i][8], at: v[i][9] };
  }
  return null;
}
/** Действующая карта: действующая версия, а если версий нет — рабочие листы «Блюда»/«Состав». */
function _ttkEffective_(code) {
  var ev = _effectiveTTKVersion_(code);
  if (ev) { var s = _ttkVerSnap_(code, ev); if (s) return s; }
  var ss = _book_(), dv = ss.getSheetByName('Блюда').getDataRange().getValues(), sv = ss.getSheetByName('Состав').getDataRange().getValues(), d = null, ing = [];
  for (var i = 1; i < dv.length; i++) if (String(dv[i][0]) === String(code)) { d = dv[i]; break; }
  for (var j = 1; j < sv.length; j++) if (String(sv[j][0]) === String(code)) ing.push({ name: sv[j][1], unit: sv[j][2], brutto: sv[j][3], brutto_g: sv[j][4], netto_g: sv[j][5] });
  return d ? { version: 0, status: 'рабочая карта', dish: { name: d[1], yield: d[3], method: d[5], ingredients: ing } } : null;
}
function _ttkQ_(x) { return x ? (x.brutto === null ? '—' : x.brutto + ' ' + x.unit) + (x.netto !== null && x.netto !== x.brutto ? ' (нетто ' + x.netto + ')' : '') : '—'; }
/** Разница двух снимков: [{field, label, before, after}]. */
function _ttkDiff_(a, b) {
  a = _ttkSnap_(a); b = _ttkSnap_(b); var out = [];
  var add = function (field, label, x, y) { out.push({ field: field, label: label, before: x === null || x === undefined || x === '' ? '—' : String(x), after: y === null || y === undefined || y === '' ? '—' : String(y) }); };
  if (a.name !== b.name) add('name', 'Название', a.name, b.name);
  if (a.yield !== b.yield) add('yield', 'Выход', a.yield, b.yield);
  if (a.method !== b.method) add('method', 'Технология', a.method, b.method);
  if (b.storage && a.storage !== b.storage) add('storage', 'Условия хранения', a.storage, b.storage);
  if (b.shelf && a.shelf !== b.shelf) add('shelf', 'Срок реализации', a.shelf, b.shelf);
  Object.keys(b.ing).forEach(function (k) {
    var x = a.ing[k], y = b.ing[k];
    if (!x) { add('ingredient', y.name + ' — добавлен', '—', _ttkQ_(y)); return; }
    if (x.unit !== y.unit) add('ingredient', y.name + ' — единица', x.unit, y.unit);
    if (x.brutto !== y.brutto) add('ingredient', y.name + ' — брутто', x.brutto === null ? '—' : x.brutto + ' ' + x.unit, y.brutto === null ? '—' : y.brutto + ' ' + y.unit);
    if (x.netto !== y.netto && y.netto !== null) add('ingredient', y.name + ' — нетто', x.netto === null ? '—' : x.netto + ' ' + x.unit, y.netto + ' ' + y.unit);
  });
  Object.keys(a.ing).forEach(function (k) { if (!b.ing[k]) add('ingredient', a.ing[k].name + ' — удалён', _ttkQ_(a.ing[k]), '—'); });
  return out;
}
function _ttkChangesText_(ch) { return ch.map(function (c) { return c.label + ': ' + c.before + ' → ' + c.after; }).join('\n'); }
function _ttkFields_(ch) { var s = {}; ch.forEach(function (c) { s[c.field === 'ingredient' ? 'Состав' : c.label] = 1; }); return Object.keys(s).join(', '); }
/** Запись истории (с цепочкой хешей). op может быть null (импорт по расписанию). */
function _ttkHist_(op, code, name, version, operation, changes, comment, actor) {
  try {
    var s = op && op.session ? op.session : null, tech = !!(s && s.dev);
    var who = actor || (s ? (tech ? MC_RB_TECH_ : (s.name || s.fullName || s.user_id || '')) : 'Система');
    var role = actor ? '' : s ? (tech ? MC_RB_TECH_ : (s.role || '')) : '';
    var lim = function (t) { t = String(t || ''); return t.length > 45000 ? t.slice(0, 45000) + '…' : t; };
    _mcChainAppend_(_ttkHistSheet_(), [new Date(), String(code), String(name || ''), version === null || version === undefined ? '' : String(version), String(operation || ''),
      _ttkFields_(changes || []), lim(_ttkChangesText_(changes || [])), who, role, s ? String(s.user_id || '') : '', (op && op.id) || '', String(comment || '')]);
  } catch (e) { try { _log_('WARN', 'история ТТК не записана: ' + e); } catch (x) {} }
}

/* ------------------------------------------------------------------ архив карт ---- */
function _ttkArchived_() {
  var out = {}; try { var sh = _book_().getSheetByName(MC_TTK_ARCH_SHEET_); if (!sh) return out; var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (v[i][0]) out[String(v[i][0])] = String(v[i][2]) === 'АРХИВ' ? { reason: v[i][3], by: v[i][4], at: v[i][5] } : null; } catch (e) {}
  Object.keys(out).forEach(function (k) { if (!out[k]) delete out[k]; });
  return out;
}
/** Архив карты (вместо удаления) или возврат из архива. json: {code, reason, restore:true} */
function mcTtkArchive(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'ttk_approve', 'TTK_ARCHIVE', 'ТТК', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), code = String(d.code || ''), reason = String(d.reason || '').trim(), restore = d.restore === true;
    var eff = _ttkEffective_(code); if (!eff) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Карта не найдена', op.id); }
    if (!reason) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину', op.id); }
    var arch = _ttkArchived_();
    if (!restore && arch[code]) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Карта уже в архиве', op.id); }
    if (restore && !arch[code]) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Карта не в архиве', op.id); }
    var who = _author_(op), name = eff.dish.name;
    _withLock_(function () { _ttkArchSheet_().appendRow([code, name, restore ? 'ДЕЙСТВУЕТ' : 'АРХИВ', reason, who.фио, new Date(), op.id]); });
    _ttkHist_(op, code, name, eff.version, restore ? 'Возврат карты из архива' : 'Карта в архив (не удалена)', [], reason);
    _audit_(op, restore ? 'TTK_UNARCHIVE' : 'TTK_ARCHIVE', 'ТТК', code, null, { name: name, reason: reason });
    try { _dropCatalogCache_(); } catch (e) {}
    _endOp_(op);
    return _ok_({ code: code, archived: !restore, note: restore ? 'Карта снова в меню.' : 'Карта в архиве: в меню и новых банкетах её нет, история и версии сохранены. Уже запланированные банкеты и производство продолжают использовать свою версию.' }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ------------------------------------------------------------------ просмотр ---- */
/** История и версии карты (или последние изменения всех карт, если code пустой). */
function mcTtkHistory(code, token) {
  try {
    var s = _requireAuth_(token); if (!_mcRbHasExact_(s, 'ttk_history')) return _mcRbDenyJson_('История ТТК — для шеф-повара, су-шефа, кондитера, ответственного за ХАССП и директора.');
    var sh = _book_().getSheetByName(MC_TTK_HIST_SHEET_), v = sh ? sh.getDataRange().getValues() : [], rows = [];
    for (var i = v.length - 1; i >= 1 && rows.length < 300; i--) {
      if (code && String(v[i][1]) !== String(code)) continue;
      rows.push({ at: _mcRbFmt_(v[i][0] instanceof Date ? v[i][0] : new Date(v[i][0])), code: v[i][1], name: v[i][2], version: v[i][3], operation: v[i][4], fields: v[i][5], changes: String(v[i][6] || '').split('\n').filter(Boolean),
        who: v[i][7], role: v[i][8], comment: v[i][11] });
    }
    var versions = [];
    if (code) {
      var vv = _ttkVersionsSheet_().getDataRange().getValues();
      for (var k = 1; k < vv.length; k++) if (String(vv[k][0]) === String(code)) versions.push({ version: Number(vv[k][1]), status: String(vv[k][2]), author: vv[k][8], created: vv[k][9] instanceof Date ? _mcRbFmt_(vv[k][9]) : String(vv[k][9] || ''),
        approvedBy: vv[k][13] || '', approvedAt: vv[k][14] instanceof Date ? _mcRbFmt_(vv[k][14]) : '' });
      versions.sort(function (a, b) { return b.version - a.version; });
    }
    var arch = code ? _ttkArchived_()[String(code)] : null;
    return _ok_({ code: code || '', history: rows, versions: versions, archived: arch ? { reason: arch.reason, by: arch.by, at: arch.at instanceof Date ? _mcRbFmt_(arch.at) : '' } : null,
      canEdit: _mcRbHasExact_(s, 'ttk_edit'), canApprove: _mcRbHasExact_(s, 'ttk_approve') });
  } catch (e) { return _failFrom_(e); }
}
/** Сравнить две версии карты. */
function mcTtkCompare(code, v1, v2, token) {
  try {
    var s = _requireAuth_(token); if (!_mcRbHasExact_(s, 'ttk_history')) return _mcRbDenyJson_('Сравнение версий — для просмотра истории ТТК.');
    var a = _ttkVerSnap_(code, v1), b = _ttkVerSnap_(code, v2);
    if (!a || !b) return _fail_('NOT_FOUND', 'Версия не найдена');
    var ch = _ttkDiff_(a.dish, b.dish);
    return _ok_({ code: code, from: v1, to: v2, changes: ch, text: _ttkChangesText_(ch) || 'Различий нет' });
  } catch (e) { return _failFrom_(e); }
}
/** «Вернуть версию N»: новая версия-копия N (история не переписывается); activate — сразу ввести в действие. */
function mcTtkRestoreVersion(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'ttk_approve', 'TTK_RESTORE', 'ТТК', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), code = String(d.code || ''), src = _ttkVerSnap_(code, d.version);
    if (!src) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Версия не найдена', op.id); }
    var nv = _withLock_(function () { return _createTTKVersion_(code, src.dish, op); });
    var eff = _ttkEffective_(code);
    _ttkHist_(op, code, src.dish.name, nv, 'Возврат к версии ' + src.version + ' → черновик версии ' + nv, eff ? _ttkDiff_(eff.dish, src.dish) : [], String(d.reason || ''));
    _audit_(op, 'TTK_RESTORE', 'ТТК', code, null, { from: src.version, newVersion: nv });
    _endOp_(op);
    if (d.activate) {
      var ap = approveTTKVersion(code, nv, JSON.stringify({ 'условияХранения': d.storage || src.dish.storage || '', 'срокРеализации': d.shelf || src.dish.shelf || '', 'комментарий': 'возврат к версии ' + src.version }), token);
      var j = typeof ap === 'string' ? JSON.parse(ap) : ap; if (!j || j.success === false) return ap;
    }
    return _ok_({ code: code, version: nv, from: src.version, activated: !!d.activate }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ------------------------------------------------------------------ ввод в действие: безопасность ---- */
/** Аллергены карты (коды) по текущим рабочим листам. */
function _ttkAllergenCodes_(code) {
  try { _dropCatalogCache_(); var r = _alDishAllergens_(_buildDishIndexes_(), code); return r ? r.allergens.map(function (a) { return a.code; }) : []; } catch (e) { return []; }
}
/** После ввода в действие: новый аллерген или карта с ККТ — ответственному за ХАССП. */
function _ttkSafetyNotify_(op, code, name, version, before, after, changes) {
  var added = after.filter(function (c) { return before.indexOf(c) < 0; });
  if (added.length) {
    var names = added.map(function (c) { var a = MC_ALLERGENS_.filter(function (x) { return x.code === c; })[0]; return a ? a.name : c; });
    _notify_('ttk_allergen', 'critical', 'Новый аллерген в ТТК: ' + name, 'Версия ' + version + ' добавила: ' + names.join(', ') + '. Проверьте меню банкетов и информацию для гостей.', 'Ответственный за ХАССП', 'ttkal|' + code + '|' + version, op);
  }
  var ccp = []; try { ccp = _tccpFor_(code); } catch (e) {}
  if (ccp.length && changes.length) _notify_('ttk_ccp', 'warning', 'Изменена ТТК с ККТ: ' + name, 'Версия ' + version + ' введена в действие. Назначено ККТ: ' + ccp.length + '. Проверьте пределы ККТ: ' + changes.slice(0, 6).map(function (c) { return c.label; }).join('; '), 'Ответственный за ХАССП', 'ttkccp|' + code + '|' + version, op);
  return added;
}

/* ------------------------------------------------------------------ импорт из папки ttk ---- */
/** Сравнить карты до и после импорта; по изменённым — версия «действующая» с автором «Импорт» и запись истории. */
function _ttkImportHistory_(oldDishes, oldSostav, newDishes, newSostav, actor) {
  var snap = function (dRows, sRows) {
    var by = {}; dRows.forEach(function (d) { if (d[0]) by[String(d[0])] = { name: d[1], yield: d[3], method: d[5], ingredients: [] }; });
    sRows.forEach(function (s) { var x = by[String(s[0])]; if (x) x.ingredients.push({ name: s[1], unit: s[2], brutto: s[3], brutto_g: s[4], netto_g: s[5] }); });
    return by;
  };
  var A = snap(oldDishes, oldSostav), B = snap(newDishes, newSostav), changed = 0, created = 0, op = { id: '', type: 'TTK_IMPORT', tenant: _defaultTenant_(), session: null };
  Object.keys(B).forEach(function (code) {
    var a = A[code], b = B[code], ch = a ? _ttkDiff_(a, b) : [];
    if (a && !ch.length) return;
    try {
      var sh = _ttkVersionsSheet_(), v = sh.getDataRange().getValues();
      for (var i = 1; i < v.length; i++) if (String(v[i][0]) === code && v[i][2] === 'действующая') sh.getRange(i + 1, 3).setValue('архив');
      var next = _currentTTKVersion_(code) + 1;
      sh.appendRow([code, next, 'действующая', b.name || '', b.yield || '', b.method || '', JSON.stringify(b.ingredients || []), '', actor, new Date()]);
      _ttkHist_(op, code, b.name, next, a ? 'Импорт из папки ttk: карта изменена' : 'Импорт из папки ttk: новая карта', a ? ch : _ttkDiff_({}, b), '', actor);
      if (a) changed++; else created++;
    } catch (e) {}
  });
  return { changed: changed, created: created };
}
