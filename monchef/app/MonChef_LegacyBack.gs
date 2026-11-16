/**
 * MON CHEF — возможности прежнего интерфейса, возвращённые в единое окно (после «списания по акту»).
 *
 * При переходе на единое окно часть экранов прежнего интерфейса не была перенесена. Здесь — серверная часть
 * возвращённого: выполнение чек-листов и история, перенос справочника дезсредств, журнал операций склада,
 * правка и удаление заказа поставщику, черновики и шаблоны разбора, центр задач, этикетка вручную,
 * подсказка места хранения, ручная запись в журнал продаж.
 *
 * Правила те же, что во всей системе: автор записи — из сессии (не из браузера), запись — под общей блокировкой
 * и с операцией в аудите, значения, которых человек не вводил (срок, концентрация, температура), не подставляются.
 */

/* ============================== Чек-листы: выполнение и история ============================== */

var MC_LB_SCHED_RU_ = { daily_1x: 'ежедневно', daily_2x: '2 раза в день', weekly: 'еженедельно', monthly: 'ежемесячно', once: 'разово' };
function _lbDateStr_(x) {
  if (Object.prototype.toString.call(x) === '[object Date]' && !isNaN(x.getTime())) return Utilities.formatDate(x, _mcTz_(), 'dd.MM.yyyy');
  return String(x || '');
}
function _lbTimeStr_(x) {
  if (Object.prototype.toString.call(x) === '[object Date]' && !isNaN(x.getTime())) return Utilities.formatDate(x, _mcTz_(), 'HH:mm');
  // время из ячейки «только время», прошедшее через JSON: «1899-12-30T05:57:27.000Z» — это 10:00 по часовому поясу таблицы
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(x || ''))) { var d = new Date(String(x)); if (!isNaN(d.getTime())) return Utilities.formatDate(d, _mcTz_(), 'HH:mm'); }
  var m = /(\d{1,2}):(\d{2})/.exec(String(x || '')); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : String(x || '');
}
/** «дд.мм.гггг» / Date / ISO → ключ сортировки гггг-мм-дд */
function _lbDayKey_(x) {
  var s = _lbDateStr_(x), m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  var d = _mcDateOnly_(x); return d ? Utilities.formatDate(d, _mcTz_(), 'yyyy-MM-dd') : '';
}

/** Экран «Чек-листы: выполнить»: чек-листы с пунктами, в какой журнал попадают, отметки за сегодня и последнее выполнение. */
function mcChecklistRunData(token) {
  try { _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var cls = JSON.parse(getChecklists() || '[]').filter(function (c) { return c.active !== false; });
    var v = _clExecSheet_().getDataRange().getValues(), today = Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy'), stat = {};
    for (var i = 1; i < v.length; i++) {
      var r = v[i]; if (!r[0]) continue;
      if (String(r[8]) !== '✓' && String(r[8]) !== '✗') continue;   // строки без отметки (заготовки прежней версии) — не выполнение
      var id = String(r[1]), s = stat[id] || (stat[id] = { done: 0, failed: 0, last: null });
      var ds = _lbDateStr_(r[6]);
      if (ds === today) { if (String(r[8]) === '✓') s.done++; else if (String(r[8]) === '✗') s.failed++; }
      var key = _lbDayKey_(r[6]) + ' ' + _lbTimeStr_(r[7]);
      if (!s.last || key > s.lastKey) { s.last = { date: ds, time: _lbTimeStr_(r[7]), who: String(r[11] || '') }; s.lastKey = key; }
    }
    var jn = {}; (typeof JOURNALS !== 'undefined' ? JOURNALS : []).forEach(function (j) { jn[j.id] = j.name; });
    return _ok_({ today: today, checklists: cls.map(function (c) {
      var s = stat[String(c.id)] || {}, jid = CHECKLIST_JOURNAL_MAP[c.id] || '';
      return { id: c.id, name: c.name, category: c.category, schedule: c.schedule, scheduleRu: MC_LB_SCHED_RU_[c.schedule] || c.schedule || '', time: c.time ? _lbTimeStr_(c.time) : '', role: c.role || '',
        description: c.description || '', journal: jid, journalName: jid ? (jn[jid] || jid) : '',
        items: (c.items || []).map(function (it) { return { id: it.id, order: it.order, text: it.text, dis: it.dis || '', conc: it.conc || '', method: it.method || '', exp: it.exp || '' }; }),
        todayDone: s.done || 0, todayFailed: s.failed || 0, last: s.last || null };
    }) });
  } catch (e) { return _failFrom_(e); }
}

/** История выполнения: {clId, from, to} (гггг-мм-дд, по умолчанию 30 дней) → выполнения, сгруппированные по чек-листу, дате, времени и сотруднику. */
function mcChecklistHistory(json, token) {
  try { _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var p = _mcBlJson_(json) || {}, tz = _mcTz_();
    var to = p.to || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var from = p.from || Utilities.formatDate(new Date(Date.now() - 30 * 864e5), tz, 'yyyy-MM-dd');
    var v = _clExecSheet_().getDataRange().getValues(), groups = {}, order = [];
    for (var i = 1; i < v.length; i++) {
      var r = v[i]; if (!r[0]) continue;
      if (String(r[8]) !== '✓' && String(r[8]) !== '✗') continue;   // без отметки — не выполнение
      if (p.clId && String(r[1]) !== String(p.clId)) continue;
      var dk = _lbDayKey_(r[6]); if (!dk || dk < from || dk > to) continue;
      var tm = _lbTimeStr_(r[7]), who = String(r[11] || ''), k = r[1] + '|' + dk + '|' + tm + '|' + who;
      var g = groups[k];
      if (!g) { g = groups[k] = { clId: String(r[1]), clName: String(r[2] || ''), date: _lbDateStr_(r[6]), time: tm, who: who, position: String(r[12] || ''), done: 0, failed: 0, items: [], key: dk + ' ' + tm }; order.push(k); }
      var st = String(r[8] || ''); if (st === '✓') g.done++; else if (st === '✗') g.failed++;
      g.items.push({ order: Number(r[4]) || 0, text: String(r[5] || ''), status: st, comment: String(r[9] || ''), disFact: String(r[10] || '') });
    }
    var out = order.map(function (k) { var g = groups[k]; g.items.sort(function (a, b) { return a.order - b.order; }); return g; })
      .sort(function (a, b) { return a.key < b.key ? 1 : a.key > b.key ? -1 : 0; });
    return _ok_({ from: from, to: to, total: out.length, executions: out.slice(0, 300) });
  } catch (e) { return _failFrom_(e); }
}

/* ============================== Дезсредства: перенос старого справочника, добавление вручную ============================== */

function _lbNorm_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
function _lbDsRows_(name) {
  var sh = _book_().getSheetByName(name); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0];
  return v.slice(1).map(function (r, i) { var o = { _row: i + 2 }; h.forEach(function (k, j) { o[k] = r[j]; }); return o; });
}
/** Сколько в старом справочнике «Справочник_Дезсредств» и сколько из этого уже есть в реестре экрана «Дезсредства». */
function mcDsLegacyStatus(token) {
  try { _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try { return _ok_(_lbDsPlan_()); } catch (e) { return _failFrom_(e); }
}
function _lbDsPlan_() {
  if (typeof setupV41Disinfectants === 'function') setupV41Disinfectants();
  var old = _book_().getSheetByName(typeof DISINFECTANTS_SHEET_NAME !== 'undefined' ? DISINFECTANTS_SHEET_NAME : 'Справочник_Дезсредств');
  var rows = old && old.getLastRow() > 1 ? old.getDataRange().getValues().slice(1).filter(function (r) { return String(r[0] || '').trim(); }) : [];
  var master = _lbDsRows_(V41_DS.MASTER), regs = _lbDsRows_(V41_DS.REGIME), byName = {}, have = {};
  master.forEach(function (m) { byName[_lbNorm_(m.ProductName)] = String(m.DisinfectantID); });
  regs.forEach(function (r) { have[String(r.DisinfectantID) + '|' + _lbNorm_(r.ConcentrationRaw) + '|' + _lbNorm_(r.ObjectScope)] = true; });
  var products = {}, todo = [];
  rows.forEach(function (r) {
    var name = String(r[0]).trim(), k = _lbNorm_(name); products[k] = name;
    var id = byName[k] || '';
    if (id && have[id + '|' + _lbNorm_(r[2]) + '|' + _lbNorm_(r[1])]) return;
    todo.push({ name: name, scope: String(r[1] || ''), conc: String(r[2] || ''), exposure: String(r[3] || ''), method: String(r[4] || ''), consumption: String(r[5] || ''), solShelf: String(r[6] || '') });
  });
  return { legacyRows: rows.length, legacyProducts: Object.keys(products).length, registry: master.length, toMigrate: todo.length, todo: todo };
}
/** Перенос: одно средство — одна запись реестра, каждая строка старого справочника — режим (объект, концентрация, экспозиция, способ, расход,
 *  срок раствора). Статус — «на проверке»: разрешает средство и утверждает режим ответственный за ХАССП. Повторный перенос дублей не создаёт. */
function mcDsMigrateLegacy(token) {
  var op = null;
  try { op = _beginOp_(token, 'sanitation', 'DS_LEGACY_MIGRATE', 'Дезсредства', null, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var plan = _lbDsPlan_(), msh = _book_().getSheetByName(V41_DS.MASTER), rsh = _book_().getSheetByName(V41_DS.REGIME), now = new Date();
      var byName = {}; _lbDsRows_(V41_DS.MASTER).forEach(function (m) { byName[_lbNorm_(m.ProductName)] = String(m.DisinfectantID); });
      var newProducts = 0, newRegimes = 0;
      plan.todo.forEach(function (t) {
        var k = _lbNorm_(t.name), id = byName[k];
        if (!id) { id = _v41Id_(t.name); byName[k] = id; newProducts++;
          msh.appendRow([id, '', t.name, t.scope, '', 'REVIEW', '', '', '', '', 'LEGACY_CATALOG', 'REVIEW', 'Перенесено из «Справочник_Дезсредств»', now, now]); }
        rsh.appendRow([_v41Id_('R'), id, t.conc, t.exposure, t.method, t.consumption, t.solShelf, t.scope, '', '', 'LEGACY_CATALOG', 'REVIEW', 'Перенесено из «Справочник_Дезсредств»', now]);
        newRegimes++;
      });
      _audit_(op, 'DS_LEGACY_MIGRATE', 'Дезсредства', null, null, { средств: newProducts, режимов: newRegimes, строк_в_старом: plan.legacyRows });
      _endOp_(op);
      return _ok_({ products: newProducts, regimes: newRegimes, legacyRows: plan.legacyRows }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Добавить средство вручную: {manufacturer, name, scope, conc, exposure, method, consumption, solShelf}. Есть средство с таким названием —
 *  добавляется режим к нему. Статус — «на проверке». */
function mcDsAdd(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'sanitation', 'DS_ADD', 'Дезсредства', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, name = String(d.name || '').trim();
    if (!name) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите название средства', op.id); }
    if (!String(d.conc || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите концентрацию раствора — как в инструкции к средству', op.id); }
    return _withLock_(function () {
      if (typeof setupV41Disinfectants === 'function') setupV41Disinfectants();
      var msh = _book_().getSheetByName(V41_DS.MASTER), rsh = _book_().getSheetByName(V41_DS.REGIME), now = new Date(), id = '', isNew = false;
      _lbDsRows_(V41_DS.MASTER).forEach(function (m) { if (!id && _lbNorm_(m.ProductName) === _lbNorm_(name)) id = String(m.DisinfectantID); });
      if (!id) { id = _v41Id_(name); isNew = true;
        msh.appendRow([id, String(d.manufacturer || ''), name, String(d.scope || ''), '', 'REVIEW', '', '', '', '', 'MANUAL', 'REVIEW', '', now, now]); }
      var rid = _v41Id_('R');
      rsh.appendRow([rid, id, String(d.conc || ''), String(d.exposure || ''), String(d.method || ''), String(d.consumption || ''), String(d.solShelf || ''), String(d.scope || ''), '', '', 'MANUAL', 'REVIEW', '', now]);
      _audit_(op, 'DS_ADD', 'Дезсредства', id, null, { средство: name, новое: isNew, режим: rid, концентрация: d.conc, объект: d.scope });
      _endOp_(op);
      return _ok_({ id: id, regimeId: rid, isNew: isNew }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ============================== Журнал операций склада ============================== */

/** {from, to (гггг-мм-дд), type, q} → операции (новые сверху, до 1000) и итоги по типам. Цены и суммы — только с правом «Себестоимость». */
function mcStockOpsData(json, token) {
  var s;
  try { s = _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var p = _mcBlJson_(json) || {}, tz = _mcTz_(), costs = _mcRbHasExact_(s, 'costs');
    var to = p.to || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var from = p.from || Utilities.formatDate(new Date(Date.now() - 7 * 864e5), tz, 'yyyy-MM-dd');
    var q = _lbNorm_(p.q), type = String(p.type || ''), v = _stockOpsSheet_().getDataRange().getValues(), rows = [], tot = {}, types = {};
    for (var i = v.length - 1; i >= 1; i--) {
      var r = v[i]; if (!r[0]) continue;
      types[String(r[2])] = true;
      var d = r[1] instanceof Date ? r[1] : (Object.prototype.toString.call(r[1]) === '[object Date]' ? r[1] : _parseDate_(r[1]));
      var dk = d ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : '';
      if (!dk || dk < from || dk > to) continue;
      if (type && String(r[2]) !== type) continue;
      if (q && _lbNorm_(r[3]).indexOf(q) < 0 && _lbNorm_(r[8]).indexOf(q) < 0 && _lbNorm_(r[9]).indexOf(q) < 0) continue;
      var t = tot[String(r[2])] || (tot[String(r[2])] = { count: 0, sum: 0 });
      t.count++; t.sum += Number(r[7]) || 0;
      if (rows.length < 1000) {
        var row = { id: String(r[0]), date: d ? Utilities.formatDate(d, tz, 'dd.MM.yyyy HH:mm') : '', type: String(r[2] || ''), name: String(r[3] || ''), qty: Number(r[4]) || 0, unit: String(r[5] || ''),
          source: String(r[8] || ''), comment: String(r[9] || '') };
        if (costs) { row.price = Math.round((Number(r[6]) || 0) * 100) / 100; row.sum = Math.round((Number(r[7]) || 0) * 100) / 100; }
        rows.push(row);
      }
    }
    var totals = Object.keys(tot).map(function (k) { var o = { type: k, count: tot[k].count }; if (costs) o.sum = Math.round(tot[k].sum * 100) / 100; return o; });
    return _ok_({ from: from, to: to, costs: costs, rows: rows, totals: totals, types: Object.keys(types).sort(), truncated: rows.length >= 1000 });
  } catch (e) { return _failFrom_(e); }
}

/* ============================== Заказ поставщику: правка позиций, удаление ============================== */

function _lbOrderRow_(id) {
  var sh = _supplierOrdersSheet_(), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) return { sh: sh, idx: i + 1, r: v[i] };
  return null;
}
var MC_LB_ORDER_EDITABLE_ = { draft: 1, sent: 1, confirmed: 1, new: 1, created: 1 };
/** Правка позиций заказа до приёмки: [{name, qty, unit, price}]. Принятый, частично принятый и отменённый заказ не правится. */
function mcOrderUpdateItems(orderId, itemsJson, token) {
  var op = null;
  try { op = _beginOp_(token, 'procurement', 'SUPPLIER_ORDER_UPDATE', 'Заказы поставщикам', orderId, null); } catch (e) { return _failFrom_(e); }
  try {
    var items = _mcBlJson_(itemsJson);
    if (!Array.isArray(items) || !items.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'В заказе должна остаться хотя бы одна позиция', op.id); }
    var clean = [];
    for (var k = 0; k < items.length; k++) {
      var it = items[k] || {}, nm = String(it.name || '').trim(), q = parseFloat(String(it.qty).replace(',', '.')), pr = it.price === '' || it.price === undefined ? 0 : parseFloat(String(it.price).replace(',', '.'));
      if (!nm) continue;
      if (!(q > 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', '«' + nm + '»: количество больше нуля', op.id); }
      if (!(pr >= 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', '«' + nm + '»: цена — число', op.id); }
      clean.push({ name: nm, qty: q, unit: String(it.unit || 'кг'), price: pr, sum: Math.round(q * pr * 100) / 100 });
    }
    if (!clean.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'В заказе должна остаться хотя бы одна позиция', op.id); }
    return _withLock_(function () {
      var o = _lbOrderRow_(orderId);
      if (!o) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Заказ не найден', op.id); }
      var st = String(o.r[3] || '');
      if (!MC_LB_ORDER_EDITABLE_[st]) { _endOp_(op, 'FAILED'); return _fail_('CONFLICT', 'Заказ в статусе «' + st + '» не правится: правят заказ до приёмки', op.id); }
      var before = String(o.r[4] || ''), total = Math.round(clean.reduce(function (s, x) { return s + x.sum; }, 0) * 100) / 100;
      o.sh.getRange(o.idx, 5, 1, 2).setValues([[JSON.stringify(clean), total]]);
      o.sh.getRange(o.idx, 11).setValue(new Date());
      _audit_(op, 'SUPPLIER_ORDER_UPDATE', 'Заказы поставщикам', orderId, before, { позиции: clean, сумма: total });
      _endOp_(op);
      return _ok_({ id: orderId, items: clean, total: total }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Удалить заказ, по которому ничего не принято. Содержимое заказа остаётся в журнале аудита. */
function mcOrderDelete(orderId, token) {
  var op = null;
  try { op = _beginOp_(token, 'procurement', 'SUPPLIER_ORDER_DELETE', 'Заказы поставщикам', orderId, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var o = _lbOrderRow_(orderId);
      if (!o) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Заказ не найден', op.id); }
      var st = String(o.r[3] || '');
      if (st === 'received' || st === 'partial') { _endOp_(op, 'FAILED'); return _fail_('CONFLICT', 'По заказу уже есть приёмка — его не удаляют (партии и журналы ссылаются на него)', op.id); }
      var snap = { id: String(o.r[0]), дата: String(o.r[1]), поставщик: String(o.r[2]), статус: st, позиции: String(o.r[4]), сумма: o.r[5], комментарий: String(o.r[6] || '') };
      o.sh.deleteRow(o.idx);
      _audit_(op, 'SUPPLIER_ORDER_DELETE', 'Заказы поставщикам', orderId, snap, null);
      _endOp_(op);
      return _ok_({ id: orderId, deleted: true }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ============================== Обработка сырья: шаблон без проведения, черновики ============================== */

/** Сохранить состав как шаблон, не проводя обработку: {name, rawMaterial, lines:[{name, isWaste}]}. Вес в шаблоне не хранится. */
function mcProcTemplateSave(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'batch_use', 'DISASSEMBLY_TEMPLATE', 'Шаблоны разбора', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, name = String(d.name || '').trim(), raw = String(d.rawMaterial || '').trim();
    var lines = (Array.isArray(d.lines) ? d.lines : []).filter(function (l) { return l && String(l.name || '').trim(); }).map(function (l) { return { name: String(l.name).trim(), isWaste: !!l.isWaste }; });
    if (!name) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите название шаблона', op.id); }
    if (!raw) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Не указано сырьё', op.id); }
    if (!lines.filter(function (l) { return !l.isWaste; }).length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'В шаблоне нет ни одного п/ф', op.id); }
    return _withLock_(function () {
      var sh = _disassemblyTemplatesSheet_(), v = sh.getDataRange().getValues(), upd = false;
      for (var i = 1; i < v.length; i++) if (String(v[i][0]) === name) { sh.getRange(i + 1, 2, 1, 2).setValues([[raw, JSON.stringify(lines)]]); upd = true; break; }
      if (!upd) sh.appendRow([name, raw, JSON.stringify(lines), new Date()]);
      _audit_(op, 'DISASSEMBLY_TEMPLATE', 'Шаблоны разбора', name, null, { сырьё: raw, строк: lines.length, обновлён: upd });
      _endOp_(op);
      return _ok_({ name: name, updated: upd }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

var MC_LB_DRAFT_SHEET_ = 'Обработка_Черновики', MC_LB_DRAFT_HEAD_ = ['DraftID', 'Создан', 'Обновлён', 'Сотрудник', 'EmployeeID', 'Партия', 'Продукт', 'Тип', 'Данные (JSON)'];
function _lbDraftSheet_() { return _bcSheet_(MC_LB_DRAFT_SHEET_, MC_LB_DRAFT_HEAD_); }
/** Черновик формы обработки: {draftId?, batchId, product, type, take, unit, outputs}. Склад и партии не меняются. */
function mcProcDraftSave(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'batch_use', 'PROC_DRAFT_SAVE', 'Обработка сырья', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {};
    if (!d.batchId) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Сначала выберите партию сырья', op.id); }
    var data = { batchId: String(d.batchId), product: String(d.product || ''), type: d.type === 'CUT' ? 'CUT' : 'TRIM', take: String(d.take || ''), unit: String(d.unit || ''),
      outputs: (Array.isArray(d.outputs) ? d.outputs : []).map(function (o) { return { name: String(o.name || ''), qty: String(o.qty || ''), waste: !!o.waste, reason: String(o.reason || '') }; }) };
    return _withLock_(function () {
      var a = _author_(op), sh = _lbDraftSheet_(), v = sh.getDataRange().getValues(), id = String(d.draftId || ''), row = -1, now = new Date();
      if (id) for (var i = 1; i < v.length; i++) if (String(v[i][0]) === id) { row = i + 1; break; }
      if (row > 0) sh.getRange(row, 3, 1, 7).setValues([[now, a.фио, a.id, data.batchId, data.product, data.type, JSON.stringify(data)]]);
      else { id = 'PD-' + Utilities.formatDate(now, _mcTz_(), 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 900 + 100); sh.appendRow([id, now, now, a.фио, a.id, data.batchId, data.product, data.type, JSON.stringify(data)]); }
      _audit_(op, 'PROC_DRAFT_SAVE', 'Обработка сырья', id, null, { партия: data.batchId, строк: data.outputs.length });
      _endOp_(op);
      return _ok_({ draftId: id }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function mcProcDraftList(token) {
  try { _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var v = _lbDraftSheet_().getDataRange().getValues(), out = [];
    for (var i = v.length - 1; i >= 1 && out.length < 50; i--) {
      if (!v[i][0]) continue; var data = {}; try { data = JSON.parse(String(v[i][8] || '{}')); } catch (e) {}
      out.push({ draftId: String(v[i][0]), updated: v[i][2] instanceof Date || Object.prototype.toString.call(v[i][2]) === '[object Date]' ? Utilities.formatDate(v[i][2], _mcTz_(), 'dd.MM.yyyy HH:mm') : String(v[i][2] || ''),
        who: String(v[i][3] || ''), batchId: String(v[i][5] || ''), product: String(v[i][6] || ''), type: String(v[i][7] || ''), data: data });
    }
    return _ok_(out);
  } catch (e) { return _failFrom_(e); }
}
function mcProcDraftDelete(draftId, token) {
  var op = null;
  try { op = _beginOp_(token, 'batch_use', 'PROC_DRAFT_DELETE', 'Обработка сырья', draftId, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var sh = _lbDraftSheet_(), v = sh.getDataRange().getValues();
      for (var i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === String(draftId)) {
        sh.deleteRow(i + 1); _audit_(op, 'PROC_DRAFT_DELETE', 'Обработка сырья', draftId, null, null); _endOp_(op); return _ok_({ draftId: draftId }, op.id);
      }
      _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Черновик не найден', op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ============================== Центр задач ============================== */

var MC_LB_PRIO_RU_ = { LOW: 'низкий', NORMAL: 'обычный', HIGH: 'высокий', CRITICAL: 'критический' };
var MC_LB_TSTATUS_RU_ = { PLANNED: 'запланирована', READY: 'готова к работе', IN_PROGRESS: 'в работе', OVERDUE: 'просрочена', DONE: 'выполнена', CANCELLED: 'отменена' };
/** {status: open|done|all, days} → задачи (ручные и из производства), сводка, сотрудники для назначения. */
function mcTaskData(json, token) {
  var s;
  try { s = _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    setupV44TaskCenter();
    var p = _mcBlJson_(json) || {}, st = p.status || 'open', now = new Date(), tz = _mcTz_(), from = new Date(now.getTime() - (Number(p.days) || 14) * 864e5);
    var isD = function (x) { return Object.prototype.toString.call(x) === '[object Date]' && !isNaN(x.getTime()); };
    var ex = {}; _v44Rows_(V44_TASK.EXEC).forEach(function (x) { ex[String(x.TaskID)] = x; });
    var rows = _v44Rows_(V44_TASK.TASK).filter(function (x) {
      var open = ['PLANNED', 'READY', 'IN_PROGRESS', 'OVERDUE'].indexOf(String(x.Status)) >= 0;
      if (st === 'open') return open;
      if (st === 'done') return !open && (!isD(x.CompletedAt) || x.CompletedAt >= from);
      return open || !isD(x.CreatedAt) || x.CreatedAt >= from;
    }).map(function (x) {
      var overdue = ['PLANNED', 'READY', 'IN_PROGRESS'].indexOf(String(x.Status)) >= 0 && isD(x.DueAt) && x.DueAt < now, e = ex[String(x.TaskID)] || {};
      var fmt = function (d) { return isD(d) ? Utilities.formatDate(d, tz, 'dd.MM.yyyy HH:mm') : ''; };
      return { taskId: String(x.TaskID), source: String(x.SourceType) === 'MANUAL' ? 'вручную' : String(x.SourceType) === 'PRODUCTION_SCHEDULE' ? 'производство' : String(x.SourceType || ''),
        title: String(x.Title || ''), description: String(x.Description || ''), due: fmt(x.DueAt), dueTs: isD(x.DueAt) ? x.DueAt.getTime() : 0,
        assignedTo: String(x.AssignedTo || ''), priority: String(x.Priority || 'NORMAL'), priorityRu: MC_LB_PRIO_RU_[String(x.Priority)] || String(x.Priority || ''),
        status: overdue ? 'OVERDUE' : String(x.Status), statusRu: MC_LB_TSTATUS_RU_[overdue ? 'OVERDUE' : String(x.Status)] || String(x.Status), createdBy: String(x.CreatedBy || ''),
        completedAt: fmt(x.CompletedAt), completedBy: String(x.CompletedBy || ''), result: String(e.Result || ''), comment: String(e.Comment || '') };
    }).sort(function (a, b) { return (a.dueTs || 0) - (b.dueTs || 0); });
    var emps = []; try { emps = JSON.parse(getEmployees()).filter(function (e) { return e.active !== false; }).map(function (e) { return { name: e.name, position: e.position }; }); } catch (e) {}
    var d = v44GetDashboard();
    return _ok_({ tasks: rows.slice(0, 400), dashboard: { open: d.open, overdue: d.overdue, manual: d.manual, total: d.total }, employees: emps,
      canCreate: _mcRbHasExact_(s, 'prod_manage'), me: _author_(token).фио });
  } catch (e) { return _failFrom_(e); }
}
/** Новая задача: {title, description, dueAt (гггг-мм-ддTчч:мм), priority, assignedTo}. Автор — из сессии. */
function mcTaskCreate(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'prod_manage', 'TASK_CREATE', 'Задачи', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {};
    if (!String(d.title || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Напишите, что сделать', op.id); }
    if (!d.dueAt || isNaN(new Date(d.dueAt).getTime())) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите срок: дату и время', op.id); }
    if (d.assignedTo) { var known = false; try { known = JSON.parse(getEmployees()).some(function (e) { return e.name === d.assignedTo; }); } catch (e) {}
      if (!known) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Исполнитель — из списка сотрудников', op.id); } }
    return _withLock_(function () {
      var a = _author_(op);
      var r = v44CreateTask({ title: String(d.title).trim(), description: String(d.description || ''), dueAt: new Date(d.dueAt), priority: d.priority || 'NORMAL', assignedTo: String(d.assignedTo || ''),
        taskType: 'GENERAL', createdBy: a.фио, notes: '' }, token);
      _audit_(op, 'TASK_CREATE', 'Задачи', r.taskId, null, { задача: d.title, срок: d.dueAt, приоритет: d.priority || 'NORMAL', исполнитель: d.assignedTo || '' });
      _endOp_(op);
      return _ok_({ taskId: r.taskId }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function mcTaskStart(taskId, token) {
  var op = null;
  try { op = _beginOp_(token, 'kanban|prod_manage', 'TASK_START', 'Задачи', taskId, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var t = _v44TaskRow_(taskId); if (!t) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Задача не найдена', op.id); }
      if (String(t.Status) === 'DONE') { _endOp_(op, 'FAILED'); return _fail_('CONFLICT', 'Задача уже выполнена', op.id); }
      var a = _author_(op); v44StartTask(taskId, String(t.AssignedTo || '') || a.фио, token);
      _audit_(op, 'TASK_START', 'Задачи', taskId, null, { кто: a.фио }); _endOp_(op);
      return _ok_({ taskId: taskId, status: 'IN_PROGRESS' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Выполнено или отклонение: {taskId, ok, comment}. Отклонение — с пояснением; создаёт сигнал в центре задач. Кто выполнил — из сессии. */
function mcTaskComplete(json, token) {
  var op = null, d = _mcBlJson_(json) || {};
  try { op = _beginOp_(token, 'kanban|prod_manage', 'TASK_COMPLETE', 'Задачи', d.taskId, null); } catch (e) { return _failFrom_(e); }
  try {
    var ok = d.ok !== false;
    if (!ok && !String(d.comment || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Отклонение — напишите, что не так', op.id); }
    return _withLock_(function () {
      var t = _v44TaskRow_(d.taskId); if (!t) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Задача не найдена', op.id); }
      if (String(t.Status) === 'DONE') { _endOp_(op, 'FAILED'); return _fail_('CONFLICT', 'Задача уже выполнена', op.id); }
      var a = _author_(op);
      v44CompleteTask({ taskId: d.taskId, status: ok ? 'DONE' : 'FAILED', comment: String(d.comment || ''), employeeId: a.фио }, token);
      _audit_(op, 'TASK_COMPLETE', 'Задачи', d.taskId, null, { результат: ok ? 'выполнено' : 'отклонение', комментарий: d.comment || '', кто: a.фио });
      _endOp_(op);
      return _ok_({ taskId: d.taskId, result: ok ? 'OK' : 'DEVIATION' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Подтянуть задачи производства банкетов на 7 дней (из плана производства) в центр задач. */
function mcTaskSyncProduction(token) {
  var op = null;
  try { op = _beginOp_(token, 'prod_manage', 'TASK_SYNC_PRODUCTION', 'Задачи', null, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () { var r = v44SyncProductionTasks(Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd'), token);
      _audit_(op, 'TASK_SYNC_PRODUCTION', 'Задачи', null, null, r); _endOp_(op); return _ok_(r, op.id); });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Задачи по дефицитам банкетов за период {from, to} (по умолчанию — 7 дней вперёд). Повторный вызов обновляет, а не дублирует. */
function mcDeficitTasks(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'plan_edit', 'DEFICIT_TASKS', 'Дефициты', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var p = _mcBlJson_(json) || {}, tz = _mcTz_();
    var from = p.from || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), to = p.to || Utilities.formatDate(new Date(Date.now() + 7 * 864e5), tz, 'yyyy-MM-dd');
    return _withLock_(function () {
      var r = v48CreateCorrectiveTasks(from, to, token), res = r && r.data ? r.data : r;
      _audit_(op, 'DEFICIT_TASKS', 'Дефициты', null, null, { с: from, по: to, итог: res }); _endOp_(op);
      return _ok_({ from: from, to: to, created: (res && res.createdTasks) || 0, updated: (res && res.existingTasks) || 0, deficits: (res && res.deficits) || 0, critical: (res && res.critical) || 0 }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ============================== Этикетка вручную на блюдо или п/ф ============================== */

/** Справочник экрана: блюда и п/ф ТТК со сроком из карты (если задан), история этикеток. */
function mcLabelData(token) {
  try { _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var idx = _buildDishIndexes_(), shelf = {};
    try { var sv = _shelfCol_().getDataRange().getValues(); for (var i = 1; i < sv.length; i++) { var h = parseFloat(sv[i][9]); if (h > 0) shelf[String(sv[i][0])] = h; } } catch (e) {}
    var dishes = Object.keys(idx.dishByCode).map(function (c) { var d = idx.dishByCode[c]; return { code: c, name: d.name, semi: !!d.semi, shelfH: shelf[c] || null }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
    var hist = []; try { hist = JSON.parse(getLabelHistory(60)); } catch (e) {}
    return _ok_({ dishes: dishes, history: hist, me: _author_(token).фио });
  } catch (e) { return _failFrom_(e); }
}
/** Данные этикетки: {code, made (гггг-мм-ддTчч:мм, пусто — сейчас), hours (только если введены по ТТК)}.
 *  Срок: из карты блюда («Срок реализации»); нет в карте — только введённый человеком; нет и его — «срок реализации не указан».
 *  Срок «по категории» здесь не подставляется. Ответственный — вошедший сотрудник. */
function _lbLabel_(d, token) {
  var idx = _buildDishIndexes_(), dish = idx.dishByCode[String(d.code || '')];
  if (!dish) throw new Error('VALIDATION: блюдо не найдено в ТТК — выберите из подсказки');
  var made = d.made ? new Date(d.made) : new Date();
  if (isNaN(made.getTime())) throw new Error('VALIDATION: дата изготовления не распознана');
  if (made.getTime() > Date.now() + 5 * 60000) throw new Error('VALIDATION: изготовлено позже, чем сейчас, — так не бывает');
  var card = _shelfLifeFor_(dish.code), hours = null, basis = '';
  if (card && card.источник === 'карта' && card.часы > 0) { hours = card.часы; basis = 'срок из карты блюда'; }
  else if (d.hours !== undefined && d.hours !== '' && d.hours !== null) {
    var hh = parseFloat(String(d.hours).replace(',', '.'));
    if (!(hh > 0 && hh <= 8760)) throw new Error('VALIDATION: срок — часы от 1 до 8760');
    hours = hh; basis = 'срок введён: ' + _author_(token).фио;
  }
  var fmt = function (x) { return Utilities.formatDate(x, _mcTz_(), 'dd.MM.yyyy HH:mm'); };
  var kb = null; try { var k = JSON.parse(calculateKBZHU(dish.code)); kb = k && k.per100 ? k.per100 : null; if (k && k.hasMissingData) kb = null; } catch (e) {}
  return { code: dish.code, name: dish.name, type: dish.semi ? 'Полуфабрикат' : 'Блюдо', made: fmt(made), madeIso: Utilities.formatDate(made, _mcTz_(), "yyyy-MM-dd'T'HH:mm"),
    expiry: hours ? fmt(new Date(made.getTime() + hours * 3600000)) : '', hours: hours, basis: basis,
    composition: (dish.ing || []).map(function (i) { return _cleanProdName_(i[0]); }).join(', '), kbzhu: kb, responsible: _author_(token).фио };
}
function mcLabelMake(json, token) {
  try { _requireAuth_(token, 'labels'); } catch (e) { return _failFrom_(e); }
  try { return _ok_(_lbLabel_(_mcBlJson_(json) || {}, token)); } catch (e) { return _fail_(/VALIDATION/.test(String(e)) ? 'VALIDATION' : 'ERROR', String(e.message || e).replace(/^VALIDATION:\s*/, '')); }
}
/** Напечатано: {code, made, hours, method: browser|bluetooth, copies}. Этикетка пересчитывается на сервере; запись — история этикеток и учёт маркировок. */
function mcLabelPrinted(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'labels', 'LABEL_PRINT', 'Маркировка', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, lb = _lbLabel_(d, token), copies = Math.max(1, Math.min(50, parseInt(d.copies, 10) || 1)), method = d.method === 'bluetooth' ? 'bluetooth' : 'browser';
    return _withLock_(function () {
      var sh = _labelsHistorySheet_(), id = 'LBL' + Date.now() + Math.floor(Math.random() * 1000), kb = lb.kbzhu || {};
      sh.appendRow([id, new Date(), lb.code, lb.name, lb.type, lb.made, lb.hours || '', lb.expiry || 'не указан', (kb.kcal || 0) + '|' + (kb.protein || 0) + '|' + (kb.fat || 0) + '|' + (kb.carbs || 0),
        lb.responsible, method + (copies > 1 ? ' ×' + copies : '')]);
      try { _autoMarking_({ name: lb.name, батч: '', партия: id, изготовлено: lb.made, годенДо: lb.expiry || 'срок не указан' }, lb.responsible, op); } catch (mk) {}
      _audit_(op, 'LABEL_PRINT', 'Маркировка', id, null, { блюдо: lb.name, изготовлено: lb.made, годен_до: lb.expiry || 'не указан', основание: lb.basis || 'нет', способ: method, копий: copies });
      _endOp_(op);
      lb.id = id; lb.copies = copies;
      return _ok_(lb, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _fail_(/VALIDATION/.test(String(e)) ? 'VALIDATION' : 'ERROR', String(e.message || e).replace(/^VALIDATION:\s*/, ''), op && op.id); }
}

/* ============================== Подсказка места хранения ============================== */

/** «Куда положить?» для партии: место по умолчанию из профиля хранения продукта; нет — правило места (V22); иначе — место,
 *  чей диапазон температуры подходит под условия хранения профиля. Подсказка ничего не меняет — переносит человек. */
function mcSuggestPlace(batchId, token) {
  try { _mcBlAuth_(token, ['stock', 'haccp', 'kanban', 'journals']); } catch (e) { return _failFrom_(e); }
  try {
    var v = _stockBatchesSheet_().getDataRange().getValues(), row = null;
    for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(batchId)) { row = v[i]; break; }
    if (!row) return _fail_('NOT_FOUND', 'Партия не найдена');
    var locs = _mcBlLocations_().filter(function (l) { return l.active; }), byId = {}; locs.forEach(function (l) { byId[l.id] = l; });
    var pr = _mcBlProfile_(row[1], String(row[17] || '')), cur = String(row[14] || '');
    var pick = function (id, reason) { var l = byId[id]; return l ? { locationId: l.id, name: l.name, range: _mcBlRange_(l.tmin, l.tmax), reason: reason, current: cur === l.id } : null; };
    var s = pr.defaultLocation ? pick(pr.defaultLocation, 'место по умолчанию для продукта (профиль хранения)') : null;
    if (!s) { try { var g = _mcV22FindLocation_(row[1], row[11], row[5]); if (g && g.locationId) s = pick(g.locationId, g.reason || 'правило размещения'); } catch (e) {} }
    if (!s && (pr.tmin !== null || pr.tmax !== null)) {
      var fit = locs.filter(function (l) { return l.tmin !== null && l.tmax !== null && (pr.tmin === null || l.tmin >= pr.tmin) && (pr.tmax === null || l.tmax <= pr.tmax); })[0];
      if (fit) s = pick(fit.id, 'диапазон места ' + _mcBlRange_(fit.tmin, fit.tmax) + ' — в условиях хранения продукта');
    }
    return _ok_({ batchId: String(batchId), product: String(row[1]), suggestion: s, note: s ? '' : 'Для продукта не задано место по умолчанию и условия хранения — выберите место сами; задать место по умолчанию можно в «Местах хранения».' });
  } catch (e) { return _failFrom_(e); }
}

/* ============================== Журнал продаж: ручная запись ============================== */

/** Экран «Журнал продаж»: блюда для подсказки, продавцы, последние записи (вручную и при выдаче банкета). */
function mcSaleData(token) {
  var s;
  try { s = _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var idx = _buildDishIndexes_(), dishes = Object.keys(idx.dishByCode).map(function (c) { return idx.dishByCode[c]; }).filter(function (d) { return !d.semi; })
      .map(function (d) { return { code: d.code, name: d.name }; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
    var emps = []; try { emps = JSON.parse(getEmployees()).filter(function (e) { return e.active !== false; }).map(function (e) { return { name: e.name, position: e.position }; }); } catch (e) {}
    var j = _mcJById_('J36'), sh = _book_().getSheetByName(j.sheetName), recent = [];
    if (sh && sh.getLastRow() > 1) {
      var v = sh.getDataRange().getValues(), n = j.columns.length, c = function (name) { return j.columns.indexOf(name); };
      for (var i = v.length - 1; i >= 1 && recent.length < 40; i--) {
        var r = v[i]; if (!r[c('Блюдо')] && !r[c('Сумма')]) continue;
        recent.push({ date: _lbDateStr_(r[c('Дата')]), time: _lbTimeStr_(r[c('Время')]), dish: String(r[c('Блюдо')] || ''), qty: r[c('Количество')], price: r[c('Цена')], sum: r[c('Сумма')],
          seller: String(r[c('ФИО продавца')] || ''), source: String(r[n + 3] || ''), author: String(r[n] || '') });
      }
    }
    return _ok_({ dishes: dishes, employees: emps, recent: recent, me: _author_(token).фио, canAdd: !s.dev && _mcRbJournalAllowed_(s, 'J36'), roles: _mcRbJournalRoles_('J36') });
  } catch (e) { return _failFrom_(e); }
}
/** Ручная продажа: {dish, qty, price, sum?, seller?, date?, time?, check?}. Ведут роли журнала J36 (директор, администратор, шеф-повар).
 *  Продавец — сотрудник из списка (по умолчанию — вносящий). В строке — метка «вручную»; продажи при выдаче банкета идут как раньше. */
function mcSaleAdd(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'banquets|journals', 'SALE_ENTRY', 'Журналы', 'J36', null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_mcRbJournalAllowed_(op.session, 'J36')) { _endOp_(op, 'FAILED'); return _mcRbDenyJson_('Журнал продаж ведут: ' + _mcRbJournalRoles_('J36').join(', ') + '.'); }
    var d = _mcBlJson_(json) || {}, dish = String(d.dish || '').trim(), qty = parseFloat(String(d.qty).replace(',', '.')), price = d.price === '' || d.price === undefined ? NaN : parseFloat(String(d.price).replace(',', '.'));
    if (!dish) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите блюдо', op.id); }
    if (!(qty > 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Количество больше нуля', op.id); }
    if (!(price >= 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите цену продажи', op.id); }
    var a = _author_(op), seller = { name: a.фио, position: a.должность };
    if (d.seller && d.seller !== a.фио) {
      var e = null; try { e = JSON.parse(getEmployees()).filter(function (x) { return x.name === d.seller && x.active !== false; })[0]; } catch (er) {}
      if (!e) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Продавец — из списка сотрудников', op.id); }
      seller = { name: e.name, position: e.position || '' };
    }
    var pad = function (n) { return ('0' + n).slice(-2); }, now = _mcNow_(), today = pad(now.getDate()) + '.' + pad(now.getMonth() + 1) + '.' + now.getFullYear();
    var date = today, time = pad(now.getHours()) + ':' + pad(now.getMinutes());
    if (d.date) { var d0 = _mcDateOnly_(d.date); if (!d0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Дата не распознана', op.id); }
      if (d0.getTime() > _mcDateOnly_(now).getTime()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Дата позже сегодняшней', op.id); }
      date = pad(d0.getDate()) + '.' + pad(d0.getMonth() + 1) + '.' + d0.getFullYear(); }
    if (d.time) { var tm = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(d.time)); if (!tm || +tm[1] > 23 || +tm[2] > 59) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Время — ЧЧ:ММ', op.id); }
      if (date === today) _mcEventTime_(d.time); time = pad(+tm[1]) + ':' + tm[2]; }
    _mcAssertJournalPeriodOpen_('J36', date);
    var sum = d.sum !== undefined && d.sum !== '' ? parseFloat(String(d.sum).replace(',', '.')) : Math.round(qty * price * 100) / 100;
    if (!(sum >= 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Сумма — число', op.id); }
    return _withLock_(function () {
      var j = _mcJById_('J36'), sh = _book_().getSheetByName(j.sheetName) || _createJournalSheet_(j);
      var row = j.columns.map(function (col) {
        switch (col) {
          case '№': return Math.max(0, sh.getLastRow() - 1) + 1;
          case 'Дата': return date; case 'Время': return time; case 'Блюдо': return dish; case 'Количество': return qty; case 'Цена': return price; case 'Сумма': return sum;
          case 'ФИО продавца': return seller.name; case 'Должность': return seller.position; default: return '';
        }
      });
      _mcJournalAppendTo_(sh, op, 'вручную' + (d.check ? ' · чек ' + String(d.check) : ''), row);
      try { if (typeof _mcMirrorRow_ === 'function') _mcMirrorRow_('J36', sh.getLastRow()); } catch (er) {}
      try { if (typeof _mcCreateFactInternal_ === 'function') _mcCreateFactInternal_({ factType: 'SALE', objectType: 'SALE', objectId: 'SALE-' + Date.now(), operationType: 'SALE', dateTime: new Date(),
        value: sum, unit: 'RUB', result: 'RECORDED', source: 'J36', employeeName: seller.name, description: 'Продажа (вручную) ' + dish + ' × ' + qty, skipRules: true }, op.session); } catch (er) {}
      _audit_(op, 'SALE_ENTRY', 'Журнал продаж', 'J36', null, { блюдо: dish, количество: qty, цена: price, сумма: sum, продавец: seller.name, дата: date, время: time, чек: d.check || '' });
      _endOp_(op);
      return _ok_({ dish: dish, qty: qty, price: price, sum: sum, seller: seller.name, date: date, time: time }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ============================== Канбан: банкеты для пересборки задач ============================== */

/** Банкеты на 14 дней вперёд — для «Пересобрать задачи банкета» (после правки ТТК или меню). */
function mcKanbanEvents(token) {
  try { _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var t0 = Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd'), t1 = Utilities.formatDate(new Date(Date.now() + 14 * 864e5), _mcTz_(), 'yyyy-MM-dd');
    var ev = JSON.parse(getEvents() || '[]').filter(function (e) { var d = String(e.date || '').slice(0, 10); return d >= t0 && d <= t1; })
      .map(function (e) { return { id: String(e.id), date: String(e.date || '').slice(0, 10), time: e.time || '', format: e.format || e.name || 'Банкет', guests: e.guests || '' }; })
      .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
    var ws = []; try { ws = JSON.parse(getWorkshopList() || '[]'); } catch (e) {}
    return _ok_({ events: ev, workshops: ws });
  } catch (e) { return _failFrom_(e); }
}
/** Пересобрать задачи кухни банкета (после правки ТТК или меню): невыполненные задачи банкета строятся заново, выполненные остаются. */
function mcKanbanRebuild(eventId, token) {
  var op = null;
  try { op = _beginOp_(token, 'prod_manage', 'KANBAN_REBUILD', 'Канбан', eventId, null); } catch (e) { return _failFrom_(e); }
  try {
    if (!eventId) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите банкет', op.id); }
    return _withLock_(function () {
      var r = _mcBlJson_(_rebuildKanbanForEvent_(String(eventId))) || {};
      if (r.error) { _endOp_(op, 'FAILED'); return _fail_(r.error === 'event-not-found' ? 'NOT_FOUND' : 'ERROR', r.error === 'event-not-found' ? 'Банкет не найден' : String(r.error), op.id); }
      _audit_(op, 'KANBAN_REBUILD', 'Канбан', eventId, null, { создано: r.created || 0 });
      _endOp_(op);
      return _ok_({ eventId: String(eventId), created: r.created || 0 }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
