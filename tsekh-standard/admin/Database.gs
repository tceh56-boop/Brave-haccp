/**
 * ЦЕХ Стандарт Admin — слой данных над Google Sheets.
 * Записи — объекты с ключами = заголовками колонок. Строки ищутся по первой колонке (ключ).
 * Все изменения выполняются под LockService (withLock).
 */
var _DB_ = null;
function db() {
  if (_DB_) return _DB_;
  var id = PropertiesService.getScriptProperties().getProperty('ADMIN_SHEET_ID');
  if (!id) throw new Error('База не создана: запустите setupAdmin() из редактора');
  _DB_ = SpreadsheetApp.openById(id);
  return _DB_;
}
function sheet(name) {
  var ss = db(), sh = ss.getSheetByName(name);
  if (!sh) {
    var head = SHEETS[name]; if (!head) throw new Error('Неизвестный лист ' + name);
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#0b0b0b').setFontColor('#d4af37');
    sh.setFrozenRows(1);
  }
  return sh;
}
var _LOCK_DEPTH_ = 0;
/** Блокировка на запись. Вложенный вызов (уже под блокировкой) просто выполняет fn. */
function withLock(fn) {
  if (_LOCK_DEPTH_ > 0) { _LOCK_DEPTH_++; try { return fn(); } finally { _LOCK_DEPTH_--; } }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('BUSY: другая операция ещё выполняется, повторите');
  _LOCK_DEPTH_ = 1;
  try { return fn(); } finally { _LOCK_DEPTH_ = 0; lock.releaseLock(); }
}
/** Все строки листа как объекты (с полем _row). */
function readAll(name) {
  var sh = sheet(name), last = sh.getLastRow();
  if (last < 2) return [];
  var head = SHEETS[name], v = sh.getRange(2, 1, last - 1, head.length).getValues(), out = [];
  for (var i = 0; i < v.length; i++) {
    if (v[i][0] === '' || v[i][0] === null) continue;
    var o = { _row: i + 2 };
    for (var j = 0; j < head.length; j++) o[head[j]] = v[i][j] instanceof Date ? v[i][j].toISOString() : v[i][j];
    out.push(o);
  }
  return out;
}
function findBy(name, key, value) {
  var all = readAll(name);
  for (var i = 0; i < all.length; i++) if (String(all[i][key]) === String(value)) return all[i];
  return null;
}
function toRow(name, obj) { return SHEETS[name].map(function (h) { var v = obj[h]; return v === undefined || v === null ? '' : v; }); }
function insert(name, obj) { sheet(name).appendRow(toRow(name, obj)); return obj; }
/** Обновить поля записи (по первой колонке). Возвращает обновлённый объект. */
function update(name, keyValue, patch) {
  var key = SHEETS[name][0], cur = findBy(name, key, keyValue);
  if (!cur) throw new Error('NOT_FOUND: запись ' + keyValue + ' не найдена в ' + name);
  Object.keys(patch).forEach(function (k) { if (SHEETS[name].indexOf(k) >= 0) cur[k] = patch[k]; });
  sheet(name).getRange(cur._row, 1, 1, SHEETS[name].length).setValues([toRow(name, cur)]);
  return cur;
}
function removeRow(name, keyValue) {
  var cur = findBy(name, SHEETS[name][0], keyValue);
  if (!cur) return false;
  sheet(name).deleteRow(cur._row);
  return true;
}
/* --------- настройки (System_Settings) --------- */
function getSetting(key, dflt) {
  var r = findBy('System_Settings', 'Ключ', key);
  if (!r || r['Значение'] === '') return dflt;
  try { return JSON.parse(r['Значение']); } catch (e) { return r['Значение']; }
}
function setSetting(key, value, descr) {
  var v = typeof value === 'string' ? value : JSON.stringify(value);
  var r = findBy('System_Settings', 'Ключ', key);
  if (r) update('System_Settings', key, { 'Значение': v, 'Описание': descr || r['Описание'] });
  else insert('System_Settings', { 'Ключ': key, 'Значение': v, 'Описание': descr || '' });
}
function tariffs() { return getSetting('TARIFFS', DEFAULT_TARIFFS); }
function tariff(code) { return tariffs().filter(function (t) { return t.code === code; })[0] || null; }
