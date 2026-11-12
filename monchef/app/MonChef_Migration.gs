/**
 * MON CHEF — единый миграционный скрипт (ТЗ §46 п.4).
 *
 * mcRunFullMigration(token) — администратор. Переводит рабочую таблицу предыдущих версий
 * на текущую модель данных. Порядок:
 *   0. резервная копия с манифестом (без неё миграция не начинается);
 *   1. ПИН-коды → хеш;
 *   2. ТТК → версии (исходный состав каждой карты фиксируется как v1 «действующая»);
 *   3. списания банкетов → резервы;
 *   4. поставщики из истории заказов → реестр (статус «на проверке»);
 *   5. состав ТТК → ProductID / ТТК п/ф;
 *   6. старые партии → ProductID и SupplierID;
 *   7. нормативный реестр;
 *   8. журналы → FACT (исторические, без новых отклонений).
 * Каждый шаг идемпотентен (повторный запуск ничего не дублирует) и пишется в лист «Миграции».
 * Ошибка шага не прерывает остальные — она видна в отчёте; данные не выдумываются.
 */
var MC_MIG_SHEET_ = 'Миграции', MC_MIG_HEAD_ = ['RunID', 'Шаг', 'Результат', 'Детали', 'Начало', 'Конец', 'Кто'];

function _migParse_(x) { if (x && typeof x === 'object') return x; try { return JSON.parse(x); } catch (e) { return { raw: String(x) }; } }
function _migOk_(r) { return !!r && !r.error && r.success !== false && r.ok !== false; }

/** Шаг 6: партии без ProductID/SupplierID (созданные до справочников) — проставить по реестрам. */
function _migStampOldBatches_() {
  var sh = _stockBatchesSheet_(), n = sh.getLastRow() - 1; if (n < 1) return { batches: 0, product: 0, supplier: 0 };
  var w = Math.max(19, sh.getLastColumn()), v = sh.getRange(2, 1, n, w).getValues(), map = _ttkIdIndex_(), sups = _mdSuppliers_(), np = 0, ns = 0;
  var hdr = sh.getRange(1, MC_BATCH_ID_COLS_.product, 1, 2).getValues()[0];
  if (!hdr[0] && !hdr[1]) sh.getRange(1, MC_BATCH_ID_COLS_.product, 1, 2).setValues([['ProductID', 'SupplierID']]);
  var out = v.map(function (r) {
    var pid = String(r[17] || ''), sid = String(r[18] || '');
    if (r[0] && !pid && r[1]) { pid = map[_v53Norm_(_cleanProdName_(r[1]))] || map[_v53Norm_(r[1])] || _v53Pid_(_cleanProdName_(r[1]), ''); np++; }
    if (r[0] && !sid) {
      var m = /\(([^)]+)\)\s*$/.exec(String(r[7] || '')), k = m ? _mdNorm_(m[1]) : '';
      var s = k ? sups.filter(function (x) { return _mdNorm_(x.name) === k; })[0] : null;
      if (s) { sid = s.id; ns++; }
    }
    return [pid, sid];
  });
  sh.getRange(2, MC_BATCH_ID_COLS_.product, n, 2).setValues(out);
  return { batches: n, product: np, supplier: ns };
}

function mcRunFullMigration(token) {
  var s;
  try { s = _requireAuth_(token, 'personnel'); } catch (e) { return _failFrom_(e); }
  if (!s.dev) return _fail_('FORBIDDEN', '403 — миграцию запускает технический доступ');
  var run = 'MIG-' + Date.now(), log = _bcSheet_(MC_MIG_SHEET_, MC_MIG_HEAD_), who = s.name || s.fullName || '', steps = [];
  function step(name, fn) {
    var t0 = new Date(), res, ok;
    try { res = fn(); ok = res && res.__skip ? 'SKIPPED' : (res && res.__ok === false) ? 'FAILED' : 'OK'; } catch (e) { res = { error: String(e && e.message || e) }; ok = 'FAILED'; }
    var det = JSON.stringify(res && res.__d !== undefined ? res.__d : res).slice(0, 2000);
    log.appendRow([run, name, ok, det, t0, new Date(), who]);
    steps.push({ step: name, result: ok, details: res && res.__d !== undefined ? res.__d : res });
    return ok;
  }
  // 0. резервная копия — обязательна
  var bk = step('0. Резервная копия', function () { var r = _migParse_(mcCreateBackup(token)); return { __ok: _migOk_(r), __d: r.data || r.error }; });
  if (bk !== 'OK') return _fail_('BACKUP_FAILED', 'Резервная копия не создана — миграция не выполнялась', run);
  step('1. ПИН-коды → хеш', function () { var r = _migParse_(migrateAllPinsToHash()); return { __ok: _migOk_(r) || !r.error, __d: r.data || r }; });
  step('2. ТТК → версии (v1 действующая)', function () { var r = _migParse_(migrateTTKToVersions(token)); return { __ok: _migOk_(r), __d: r.data || r.error }; });
  step('3. Списания банкетов → резервы', function () { var r = _migParse_(migrateEventWriteOffsToReservations(token)); return { __ok: _migOk_(r), __d: r.data || r.error }; });
  step('4. Поставщики → реестр', function () { var r = _migParse_(mcMigrateSuppliers(token)); return { __ok: _migOk_(r), __d: r.data || r.error }; });
  step('5. Состав ТТК → ProductID', function () { var r = _migParse_(mcMigrateTtkProductIds(token)); return { __ok: _migOk_(r), __d: r.data || r.error }; });
  step('6. Партии → ProductID / SupplierID', function () { return { __d: _withLock_(_migStampOldBatches_) }; });
  step('7. Нормативный реестр', function () { _v33SeedNorms_(); _v33SeedRequirements_(); return { __d: 'ok' }; });
  step('8. Журналы → FACT (история)', function () { var r = _migParse_(migrateExistingJournalsToFacts(token, 5000)); return { __ok: _migOk_(r), __d: r.data || r.error }; });
  var failed = steps.filter(function (x) { return x.result === 'FAILED'; });
  try { _audit_({ id: run, session: s }, 'FULL_MIGRATION', 'Таблица', run, null, steps.map(function (x) { return x.step + ': ' + x.result; })); } catch (e) {}
  return _ok_({ runId: run, ok: !failed.length, steps: steps, note: failed.length ? 'Не выполнены шаги: ' + failed.map(function (x) { return x.step; }).join(', ') + ' — данные не повреждены (перед миграцией сделана копия), повторите после устранения причины' : 'Миграция выполнена; повторный запуск безопасен' }, run);
}
