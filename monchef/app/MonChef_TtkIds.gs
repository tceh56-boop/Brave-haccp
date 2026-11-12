/**
 * MON CHEF — состав ТТК по ProductID (ТЗ §3: связи по ID, а не по названию).
 *
 * Лист «Состав», колонки 10–11: «ProductID» (сырьё — из реестра «Продукты_ID_V53»)
 * и «ТТК п/ф» (код карты полуфабриката, если строка — п/ф). Название остаётся для людей.
 * ID проставляются при утверждении версии ТТК, создании карты, синхронизации с папкой ttk
 * и миграцией (mcMigrateTtkProductIds). Сопоставление — по реестру V53: точное имя или
 * утверждённый синоним (Продукты_Сопоставление_V53, статус APPROVED). Неизвестное имя
 * регистрируется в реестре тем же стабильным ID, что получает партия при приходе.
 * Расход сырья при выпуске ищет партии по ProductID — синонимы названий («Сливки 33%» /
 * «сливки 33 %, Простоквашино») больше не теряют связь.
 */
var MC_TTK_ID_COLS_ = { pid: 10, sub: 11 };

/** Индекс «нормализованное имя → ProductID» по реестру V53 (точные имена + утверждённые синонимы). */
function _ttkIdIndex_() {
  setupV53ProductUnits();
  var idx = _v53ProductIndex_(), map = {};
  Object.keys(idx.byName).forEach(function (k) { var a = idx.byName[k]; if (a && a.length === 1) map[k] = String(a[0].ProductID); });
  _v53Rows_(V53.MAP, V53H.MAP).forEach(function (r) { if (String(r.Status) === 'APPROVED' && r.ProductID) map[_v53Norm_(r.SourceName)] = String(r.ProductID); });
  return map;
}
/** Проставить ProductID / код п/ф в «Состав» (codes — только эти карты; без codes — все строки без ID). */
function _ttkStampProductIds_(codes, force) {
  var ss = _book_(), ssh = ss.getSheetByName('Состав'); if (!ssh || ssh.getLastRow() < 2) return { stamped: 0, registered: 0, pf: 0 };
  ssh.getRange(1, MC_TTK_ID_COLS_.pid, 1, 2).setValues([['ProductID', 'ТТК п/ф']]);
  var n = ssh.getLastRow() - 1, v = ssh.getRange(2, 1, n, 11).getValues();
  var only = codes ? codes.map(String) : null, map = _ttkIdIndex_(), di = _buildDishIndexes_(), out = [], stamped = 0, pf = 0, reg = {}, regRows = [];
  for (var i = 0; i < n; i++) {
    var r = v[i], pid = String(r[9] || ''), sub = String(r[10] || '');
    if (!r[0] || !r[1] || (only && only.indexOf(String(r[0])) < 0) || (!force && (pid || sub))) { out.push([pid, sub]); continue; }
    var d = _findSubDish_(r[1], di.dishByNormName, di.dishByLooseName);
    if (d && d.ing && d.ing.length && String(d.code) !== String(r[0])) { out.push(['', d.code]); pf++; continue; }
    var k = _v53Norm_(_cleanProdName_(r[1])), id = map[k] || map[_v53Norm_(r[1])];
    if (!id) { id = _v53Pid_(_cleanProdName_(r[1]), ''); if (!reg[id]) { reg[id] = 1; regRows.push([id, _cleanProdName_(r[1]), '', '', '', 'UNKNOWN', 'YES', 'TTK_COMPOSITION', new Date()]); } map[k] = id; }
    out.push([id, '']); stamped++;
  }
  if (regRows.length) { var ps = _v53Sh_(V53.PRODUCTS, V53H.PRODUCTS); ps.getRange(ps.getLastRow() + 1, 1, regRows.length, regRows[0].length).setValues(regRows); }
  ssh.getRange(2, MC_TTK_ID_COLS_.pid, n, 2).setValues(out);
  try { _MC_PID_CACHE_ = null; } catch (e) {}
  return { stamped: stamped, registered: regRows.length, pf: pf };
}
/** «продукт (ключ склада) → ProductID» по составу ТТК — для расхода партий по ID. */
function _ttkPidByProdKey_() {
  var ssh = _book_().getSheetByName('Состав'), m = {};
  if (!ssh || ssh.getLastRow() < 2) return m;
  ssh.getRange(2, 1, ssh.getLastRow() - 1, 11).getValues().forEach(function (r) { if (r[1] && r[9]) m[_prodKey_(r[1])] = String(r[9]); });
  return m;
}

/** Миграция: проставить ID во всём составе (администратор/шеф с правом каталога). */
function mcMigrateTtkProductIds(token) {
  try {
    var s = _requireAuth_(token, 'catalog');
    var r = _withLock_(function () { return _ttkStampProductIds_(null, false); });
    var ssh = _book_().getSheetByName('Состав'), v = ssh && ssh.getLastRow() > 1 ? ssh.getRange(2, 1, ssh.getLastRow() - 1, 11).getValues() : [];
    var rows = v.filter(function (x) { return x[0] && x[1]; }), noId = rows.filter(function (x) { return !x[9] && !x[10]; });
    try { _audit_({ id: '', session: s }, 'TTK_PRODUCT_IDS', 'ТТК', 'Состав', null, { stamped: r.stamped, registered: r.registered, pf: r.pf, withoutId: noId.length }); } catch (e) {}
    return _ok_({ stamped: r.stamped, registeredNew: r.registered, semiLinks: r.pf, rows: rows.length, withoutId: noId.length,
      note: r.registered ? 'Новые названия зарегистрированы в реестре продуктов со статусом UNKNOWN — проверьте в «Товары и единицы» и при необходимости сопоставьте синонимы.' : '' });
  } catch (e) { return _failFrom_(e); }
}
