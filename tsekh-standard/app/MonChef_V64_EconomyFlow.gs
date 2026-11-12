/**
 * ЦЕХ Стандарт V64 — «Экономика потока» (ТЗ «Итоговая структура системы прослеживаемости продуктов и экономики», §4, §14, §21).
 *
 * Нормализованный журнал «Экономика_Движение_V64» собирается из первичных листов и ПЕРВИЧНЫЕ ЛИСТЫ НЕ МЕНЯЕТ:
 *   закупка (Склад_Партии + паспорт Приёмка_Партии, доп. расходы из Финансы_Операции),
 *   хранение (Партии_События: расход, списание, возврат поставщику, перемещение, вскрытие),
 *   дефрост (потеря массы — отдельной строкой, цена единицы после дефроста = стоимость / фактический выход),
 *   зачистка и разделка (Разбор_Акты / Разбор_Строки: стоимость взятого сырья → выход п/ф по массе полезного выхода, отходы),
 *   производство п/ф и блюда (Производство + TRACE_LINKS «РАСХОДОВАНА_НА»: расход по каждой партии по её цене),
 *   упаковка и выдача (Выдача_V28 + TRACE_LINKS «ВЫДАНА_НА_БАНКЕТ», Упаковка_Нормы),
 *   продажа (Ж_Продажи J36 — выручка; Факт_Банкет_V29 — обслужено, возврат, брак), лабораторные расходы партии, корректировки;
 *   ручная продажа в зал (V71) — себестоимость по партиям, списанным при продаже (TRACE_LINKS «РЕАЛИЗОВАНА_В», Продажи_Списание_V71).
 *
 * Цена продажи не выводится из себестоимости: нет цены в продаже — ищется в «Цены_Меню» (договор банкета или меню),
 * нет и там — строка получает MISSING_SALE_PRICE. Партия без цены закупки — MISSING_PRICE, а не нулевая оценка без предупреждения.
 * Статус прослеживаемости строки: PASS / REVIEW / MISSING_EVIDENCE / NOT_APPLICABLE.
 * Показатели — управленческие (валовой вклад), бухгалтерский учёт не заменяют.
 */
var MC_V64 = { LEDGER: 'Экономика_Движение_V64' };
var MC_V64_HEAD = ['LedgerID', 'RunID', 'Date', 'Stage', 'Direction', 'ObjectType', 'ObjectID', 'BatchID', 'ParentBatchID', 'ProductionID', 'EventID',
  'ProductID', 'Product', 'Qty', 'Unit', 'UnitPrice', 'Amount', 'Source', 'SourceRef', 'Employee', 'OperationID', 'TraceStatus', 'Flags', 'Note'];
var MC_V64_STAGE_RU = { PURCHASE: 'Закупка', STORAGE: 'Хранение', DEFROST: 'Дефрост', PROCESSING: 'Зачистка и разделка', SEMI: 'Полуфабрикат', DISH: 'Блюдо',
  PACKAGING: 'Упаковка', ISSUE: 'Выдача', SALE: 'Продажа', RETURN: 'Возврат', WASTE: 'Отходы и брак', LAB: 'Лабораторный контроль', CORRECTION: 'Корректировка', EXPENSE: 'Управленческие расходы' };
var MC_V64_FLAG_RU = { MISSING_PRICE: 'нет цены закупки', MISSING_SALE_PRICE: 'нет цены продажи', NO_BATCH: 'расход без партии', NO_PASSPORT: 'нет паспорта приёмки',
  NO_SUPPLIER_DOC: 'нет поставщика или накладной', COST_DIFF: 'себестоимость выпуска отличается от расчёта по партиям', PRICE_FROM_MENU: 'цена из меню / договора',
  NO_ISSUE_BATCH: 'продажа без выдачи по партии', NORMATIVE_COST: 'себестоимость по нормативу ТТК', SALE_STOCK_SHORT: 'продажа: на складе не хватило', EXTRA_ALLOCATED: 'с доп. расходами партии',
  CHANGED_AFTER_SNAPSHOT: 'изменилось после снимка', CLOSED_PERIOD_CHANGED: 'изменение в закрытом периоде', BANQUET_NOT_CLOSED: 'банкет не закрыт',
  WASTE_ABOVE_NORM: 'отходы выше нормы', NO_UNIT_MATCH: 'единицы не сопоставимы', MASS_NOT_MEASURED: 'масса не измерялась' };

/* ---------------- служебное ---------------- */
function _v64Sheet_(name, head) {
  var ss = _book_(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]); sh.setFrozenRows(1); sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#3d5c35').setFontColor('#ffffff'); }
  else if (sh.getLastColumn() < head.length) sh.getRange(1, 1, 1, head.length).setValues([head]);
  return sh;
}
var _V64_TAB_ = {};
/** Лист как { idx: {заголовок → колонка}, rows } — чтение по названиям колонок (колонки других модулей дописываются в конец). */
function _v64Tab_(name) {
  if (_V64_TAB_[name]) return _V64_TAB_[name];
  var sh = _book_().getSheetByName(name), t = { idx: {}, rows: [], exists: !!sh };
  if (sh && sh.getLastRow() >= 1) {
    var v = sh.getDataRange().getValues(), h = v[0];
    for (var i = 0; i < h.length; i++) { var k = String(h[i] || '').trim(); if (k && !(k in t.idx)) t.idx[k] = i; }
    t.rows = v.slice(1).filter(function (r) { return r.some(function (x) { return x !== '' && x !== null; }); });
  }
  return (_V64_TAB_[name] = t);
}
function _v64Drop_() { _V64_TAB_ = {}; _V64_DISH_ = null; }
function _v64G_(t, r, names, dflt) { names = [].concat(names); for (var i = 0; i < names.length; i++) { var c = t.idx[names[i]]; if (c !== undefined && r[c] !== '' && r[c] !== null && r[c] !== undefined) return r[c]; } return dflt === undefined ? '' : dflt; }
function _v64Num_(x) { if (typeof x === 'number') return isFinite(x) ? x : 0; var n = parseFloat(String(x === null || x === undefined ? '' : x).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
function _v64R2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function _v64R3_(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
function _v64Date_(x) {
  if (!x && x !== 0) return null;
  if (Object.prototype.toString.call(x) === '[object Date]') return isNaN(x.getTime()) ? null : x;
  var s = String(x).replace(/^'/, '').trim(), m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m && /T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) { var dz = new Date(s); return isNaN(dz.getTime()) ? null : dz; }
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  var d = new Date(s); return isNaN(d.getTime()) ? null : d;
}
function _v64Day_(d) { return Utilities.formatDate(d, _mcTz_(), 'yyyy-MM-dd'); }
/** Период: from..to включительно (даты yyyy-MM-dd или dd.MM.yyyy); пусто — с начала текущего месяца по сегодня. */
function _v64Range_(fromDate, toDate) {
  var now = new Date(), f = _v64Date_(fromDate), t = _v64Date_(toDate);
  if (!f) f = new Date(now.getFullYear(), now.getMonth(), 1);
  if (!t) t = now;
  f = new Date(f.getFullYear(), f.getMonth(), f.getDate(), 0, 0, 0);
  t = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 59, 999);
  if (t < f) throw new Error('VALIDATION: дата «по» раньше даты «с»');
  return { from: f, to: t, fromIso: _v64Day_(f), toIso: _v64Day_(t) };
}
function _v64In_(d, rg) { return !rg || (d && d >= rg.from && d <= rg.to); }
/** Количество из одной единицы в другую (г↔кг, мл↔л, шт↔порц.); null — единицы несопоставимы. */
function _v64Conv_(qty, fromU, toU) {
  var a = _toBaseUnitServer_(Number(qty) || 0, fromU || 'г'), b = _toBaseUnitServer_(1, toU || 'г');
  if (a.unit !== b.unit || !b.qty) return null;
  return a.qty / b.qty;
}
function _v64Key_(name) { try { return _prodKey_(name); } catch (e) { return String(name || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); } }
var _V64_DISH_ = null;
function _v64Dishes_() {
  if (_V64_DISH_) return _V64_DISH_;
  var idx = { dishByCode: {}, dishByNormName: {} }, ws = {};
  try { idx = _buildDishIndexes_(); } catch (e) {}
  try { ws = _dishWorkshopMap_() || {}; } catch (e) {}
  var byKey = {};
  Object.keys(idx.dishByCode || {}).forEach(function (c) { var d = idx.dishByCode[c]; byKey[_v64Key_(d.name)] = d; byKey[_v64Key_(String(d.name).replace(/\s*п\s*[\/\-]\s*ф\s*/i, ' '))] = byKey[_v64Key_(String(d.name).replace(/\s*п\s*[\/\-]\s*ф\s*/i, ' '))] || d; });
  return (_V64_DISH_ = { byCode: idx.dishByCode || {}, byKey: byKey, ws: ws });
}
function _v64DishOf_(nameOrCode) { var D = _v64Dishes_(); return D.byCode[nameOrCode] || D.byKey[_v64Key_(nameOrCode)] || null; }

/* ---------------- партии и цены ---------------- */
/** Партии: цена по приёмке (за единицу партии), доп. расходы, паспорт. */
function _v64Batches_() {
  var t = _v64Tab_('Склад_Партии'), p = _v64Tab_('Приёмка_Партии'), out = {};
  var pass = {}; p.rows.forEach(function (r) { var id = String(_v64G_(p, r, 'BatchID')); if (id) pass[id] = r; });
  t.rows.forEach(function (r) {
    var id = String(r[0] || ''); if (!id) return;
    var pr = pass[id] || null;
    out[id] = { id: id, product: String(r[1] || ''), unit: String(r[2] || 'г'), qty: _v64Num_(r[3]), received: _v64Date_(r[4]), expiry: r[5], price: _v64Num_(r[6]),
      source: String(r[7] || ''), used: _v64Num_(r[8]), remain: _v64Num_(r[9]), status: String(r[10] || ''), doc: String(r[13] || ''),
      productId: String(_v64G_(t, r, 'ProductID', r[17] || '')), supplierId: String(_v64G_(t, r, 'SupplierID', r[18] || '')),
      pass: pr ? { supplier: String(_v64G_(p, pr, 'Поставщик')), invoice: String(_v64G_(p, pr, 'Накладная')), docId: String(_v64G_(p, pr, 'DocumentID накладной')),
        docDate: _v64Date_(_v64G_(p, pr, 'Дата накладной')), cost: _v64G_(p, pr, 'Стоимость', null), price: _v64G_(p, pr, 'Цена за ед.', null), unit: String(_v64G_(p, pr, 'Ед.')),
        qty: _v64Num_(_v64G_(p, pr, 'Кол-во')), by: String(_v64G_(p, pr, 'Принял')), op: String(_v64G_(p, pr, 'OperationID')), parent: String(_v64G_(p, pr, 'ParentBatchID')),
        vsd: String(_v64G_(p, pr, 'ВСД')) } : null,
      extra: 0, extraNotes: [] };
  });
  return out;
}
function _v64Produced_(b) { return /^Производство\s/.test(b.source) || /^Выпуск/.test(b.source); }
function _v64ProcessedChild_(b) { return /^(Зачистка|Разбор)\s/.test(b.source) || !!(b.pass && b.pass.parent); }
/** Цена единицы партии с доп. расходами (доставка, скидки, лаборатория партии) — для оценки расхода. */
function _v64EffPrice_(b) { if (!b) return 0; return b.price > 0 ? b.price + (b.qty > 0 ? b.extra / b.qty : 0) : 0; }

/** Финансовые операции к закупке: доставка, доп. расходы, скидки, лаборатория партии — распределяются по правилу операции. */
function _v64ApplyFinOps_(B, lines, rg) {
  var t = _v64Tab_('Финансы_Операции'); if (!t.exists) return;
  t.rows.forEach(function (r) {
    if (String(_v64G_(t, r, 'Status', 'ACTIVE')) === 'CANCELLED') return;
    var type = String(_v64G_(t, r, 'Type')), amount = _v64Num_(_v64G_(t, r, 'Amount')), mode = String(_v64G_(t, r, 'AllocationMode', 'NONE')).toUpperCase();
    var d = _v64Date_(_v64G_(t, r, 'Date')) || new Date(), id = String(_v64G_(t, r, 'FinOpID')), batch = String(_v64G_(t, r, 'BatchID')), doc = String(_v64G_(t, r, 'DocumentRef'));
    if (!/^(DELIVERY|EXTRA_COST|DISCOUNT|SUPPLIER_RETURN_MONEY|LAB_COST)$/.test(type)) return;
    var sign = /^(DISCOUNT|SUPPLIER_RETURN_MONEY)$/.test(type) ? -1 : 1;
    if (mode === 'NONE' && !batch) {   // не включается в продуктовую себестоимость — управленческий слой
      if (_v64In_(d, rg)) lines.push({ date: d, stage: 'EXPENSE', dir: 'OUT', objType: 'FIN_OPERATION', objId: id, amount: sign * amount, source: 'Финансы_Операции', ref: id,
        note: type + ' без распределения на партии' + (doc ? ' · ' + doc : ''), trace: 'NOT_APPLICABLE', flags: [] });
      return;
    }
    var targets = batch ? [B[batch]].filter(Boolean) : Object.keys(B).map(function (k) { return B[k]; }).filter(function (b) {
      return b.pass && (b.pass.invoice === doc || b.pass.docId === doc || ('накладная ' + b.pass.invoice) === doc);
    });
    if (!targets.length) { lines.push({ date: d, stage: 'PURCHASE', dir: 'IN', objType: 'FIN_OPERATION', objId: id, amount: sign * amount, source: 'Финансы_Операции', ref: id,
      note: 'не найдены партии документа «' + (doc || batch) + '»', trace: 'MISSING_EVIDENCE', flags: ['NO_BATCH'] }); return; }
    var w = targets.map(function (b) {
      if (mode === 'VALUE') return b.qty * b.price;
      if (mode === 'LINES' || mode === 'BATCH') return 1;
      var kg = _v64Conv_(b.qty, b.unit, 'кг'); return kg === null ? 0 : kg;   // WEIGHT
    });
    var W = w.reduce(function (a, x) { return a + x; }, 0);
    if (!(W > 0)) { w = targets.map(function () { return 1; }); W = targets.length; }
    targets.forEach(function (b, i) {
      var part = sign * amount * w[i] / W; b.extra += part; b.extraNotes.push(type + ' ' + _v64R2_(part));
      if (_v64In_(d, rg)) lines.push({ date: d, stage: type === 'LAB_COST' ? 'LAB' : 'PURCHASE', dir: 'IN', objType: 'BATCH', objId: b.id, batch: b.id, product: b.product, productId: b.productId,
        amount: _v64R2_(part), source: 'Финансы_Операции', ref: id, note: type + ' (' + mode + ')' + (doc ? ' · ' + doc : ''), trace: 'PASS', flags: ['EXTRA_ALLOCATED'] });
    });
  });
}

/* ---------------- сборка журнала ---------------- */
/** Собрать строки журнала за период (rg = null — вся история). Ничего не пишет. */
function _v64Build_(rg) {
  _v64Drop_();
  var lines = [], B = _v64Batches_(), D = _v64Dishes_();
  _v64ApplyFinOps_(B, lines, rg);
  var push = function (o) { if (_v64In_(o.date, rg)) lines.push(o); };
  // 1. закупка
  Object.keys(B).forEach(function (id) {
    var b = B[id]; if (_v64Produced_(b) || _v64ProcessedChild_(b)) return;
    var flags = [], trace = 'PASS', amount = 0;
    if (!(b.price > 0)) { flags.push('MISSING_PRICE'); trace = 'REVIEW'; }
    else amount = b.pass && _v64Num_(b.pass.cost) > 0 && Math.abs(_v64Num_(b.pass.cost) - b.qty * b.price) <= Math.max(1, b.qty * b.price * 0.02) ? _v64Num_(b.pass.cost) : b.qty * b.price;
    if (!b.pass) { flags.push('NO_PASSPORT'); trace = 'MISSING_EVIDENCE'; }
    else if (!b.pass.supplier || !b.pass.invoice) { flags.push('NO_SUPPLIER_DOC'); if (trace === 'PASS') trace = 'REVIEW'; }
    push({ date: b.received || (b.pass && b.pass.docDate) || null, stage: 'PURCHASE', dir: 'IN', objType: 'BATCH', objId: id, batch: id, product: b.product, productId: b.productId,
      qty: b.qty, unit: b.unit, price: b.price, amount: _v64R2_(amount), source: b.pass ? 'Приёмка_Партии' : 'Склад_Партии',
      ref: b.pass ? (b.pass.supplier + ' · накладная ' + b.pass.invoice) : b.source, employee: b.pass ? b.pass.by : '', op: b.pass ? b.pass.op : '', trace: trace, flags: flags });
  });
  // 2. хранение, дефрост, отходы обработки, списание, возврат — по истории партии
  var ev = _v64Tab_('Партии_События');
  ev.rows.forEach(function (r) {
    var type = String(_v64G_(ev, r, 'Тип')), bid = String(_v64G_(ev, r, 'BatchID')), b = B[bid], d = _v64Date_(_v64G_(ev, r, 'Время'));
    var q = _v64Num_(_v64G_(ev, r, 'Кол-во')), u = String(_v64G_(ev, r, 'Ед.') || (b ? b.unit : '')), reason = String(_v64G_(ev, r, 'Причина'));
    var base = { date: d, objType: 'BATCH', objId: bid, batch: bid, product: b ? b.product : '', productId: b ? b.productId : '', employee: String(_v64G_(ev, r, 'Сотрудник')),
      op: String(_v64G_(ev, r, 'OperationID')), source: 'Партии_События', ref: String(_v64G_(ev, r, 'EventID')), trace: b ? 'PASS' : 'MISSING_EVIDENCE', flags: b ? [] : ['NO_BATCH'] };
    var qb = b ? _v64Conv_(q, u, b.unit) : null, pr = _v64EffPrice_(b), val = qb === null ? 0 : qb * pr;
    var mk = function (stage, dir, note, amount) { var o = JSON.parse(JSON.stringify(base)); o.date = d; o.stage = stage; o.dir = dir; o.qty = q; o.unit = u; o.price = qb === null ? '' : pr; o.amount = _v64R2_(amount); o.note = note;
      if (b && !(b.price > 0) && amount === 0 && dir !== 'INFO') { o.flags.push('MISSING_PRICE'); o.trace = 'REVIEW'; } if (b && qb === null && q) o.flags.push('NO_UNIT_MATCH'); return o; };
    if (type === 'BATCH_WASTE') push(mk('WASTE', 'OUT', 'списание партии: ' + reason, val));
    else if (type === 'BATCH_RETURN') push(mk('RETURN', 'OUT', 'возврат поставщику: ' + reason, val));
    else if (type === 'BATCH_USE' || type === 'BATCH_PARTIAL_USE') push(mk('STORAGE', 'OUT', 'расход партии: ' + reason, val));
    else if (type === 'PROCESSING_WASTE' && /размораж/i.test(reason)) push(mk('DEFROST', 'OUT', 'потеря массы при дефросте (отдельно, не снижает цену единицы): ' + reason, val));
    else if (type === 'PROCESSING_WASTE') { var o = mk('PROCESSING', 'INFO', 'отходы обработки (стоимость перенесена на выход п/ф): ' + reason, 0); o.wasteValue = _v64R2_(val); push(o); }
    else if (type === 'MOVE' || type === 'OPEN_CONTAINER' || type === 'STORAGE_ASSIGNED' || type === 'RECALCULATE_EXPIRY') push(mk('STORAGE', 'INFO', (MC_BL_EVT_RU_[type] || type) + (reason ? ': ' + reason : ''), 0));
    else if (type === 'DEFROST_FINISH') push(mk('DEFROST', 'INFO', 'разморожена' + (reason ? ': ' + reason : ''), 0));
    else if (type === 'CORRECTION') push(mk('CORRECTION', 'INFO', 'корректировка партии: ' + reason, 0));
  });
  // 3. зачистка и разделка: стоимость взятого сырья → выход по массе полезного выхода
  var acts = _v64Tab_('Разбор_Акты'), al = _v64Tab_('Разбор_Строки'), linesByAct = {};
  al.rows.forEach(function (r) { var a = String(_v64G_(al, r, 'АктID')); (linesByAct[a] = linesByAct[a] || []).push(r); });
  acts.rows.forEach(function (r) {
    var type = String(_v64G_(acts, r, 'Тип')); if (type === 'DEFROST') return;
    var id = String(_v64G_(acts, r, 'ID')), d = _v64Date_(_v64G_(acts, r, 'Дата')), src = String(_v64G_(acts, r, 'ПартияИсточник')), b = B[src];
    var taken = _v64Num_(_v64G_(acts, r, ['Взято', 'ИсходныйВес'])), unit = String(_v64G_(acts, r, 'ЕдИзм') || (b ? b.unit : 'г'));
    var pr = _v64EffPrice_(b), cost = taken * pr, outs = (linesByAct[id] || []).filter(function (x) { return /product|выход/i.test(String(_v64G_(al, x, 'Тип'))); });
    var wastes = (linesByAct[id] || []).filter(function (x) { return /waste|отход/i.test(String(_v64G_(al, x, 'Тип'))); });
    var P = outs.reduce(function (a, x) { return a + _v64Num_(_v64G_(al, x, 'Вес')); }, 0), W = wastes.reduce(function (a, x) { return a + _v64Num_(_v64G_(al, x, 'Вес')); }, 0);
    var review = String(_v64G_(acts, r, 'ТребуетПроверки')) === 'true' || _v64G_(acts, r, 'ТребуетПроверки') === true;
    var flags = []; if (!b) flags.push('NO_BATCH'); if (b && !(b.price > 0)) flags.push('MISSING_PRICE'); if (review) flags.push('WASTE_ABOVE_NORM');
    var tr = !b ? 'MISSING_EVIDENCE' : (flags.length ? 'REVIEW' : 'PASS');
    push({ date: d, stage: 'PROCESSING', dir: 'OUT', objType: 'PROCESSING_ACT', objId: id, batch: src, product: b ? b.product : String(_v64G_(acts, r, 'Продукт')), productId: b ? b.productId : '',
      qty: taken, unit: unit, price: pr, amount: _v64R2_(cost), source: 'Разбор_Акты', ref: id, employee: String(_v64G_(acts, r, 'Сотрудник')), op: String(_v64G_(acts, r, 'OperationID')),
      trace: tr, flags: flags.slice(), note: (MC_PR_TYPE_RU_[type] || 'обработка') + ': взято ' + _v64R3_(taken) + ' ' + unit + ', выход ' + _v64R3_(P) + ', отходы ' + _v64R3_(W) });
    outs.forEach(function (x) {
      var w = _v64Num_(_v64G_(al, x, 'Вес')), cid = String(_v64G_(al, x, 'НовыйBatchID')), cb = B[cid], share = P > 0 ? cost * w / P : 0, fl = flags.slice();
      var recorded = cb ? cb.price : _v64Num_(_v64G_(al, x, 'Цена за ед.'));
      if (w > 0 && recorded > 0 && Math.abs(recorded - share / w) > Math.max(0.0001, recorded * 0.01)) fl.push('COST_DIFF');
      push({ date: d, stage: 'PROCESSING', dir: 'IN', objType: 'BATCH', objId: cid, batch: cid, parent: src, product: String(_v64G_(al, x, 'Название')), productId: cb ? cb.productId : '',
        qty: w, unit: unit, price: w > 0 ? share / w : 0, amount: _v64R2_(share), source: 'Разбор_Строки', ref: id, trace: cb ? (fl.length ? 'REVIEW' : 'PASS') : 'MISSING_EVIDENCE', flags: fl,
        note: 'выход п/ф: стоимость сырья × ' + _v64R3_(w) + ' / ' + _v64R3_(P) });
    });
    wastes.forEach(function (x) {
      var w = _v64Num_(_v64G_(al, x, 'Вес'));
      push({ date: d, stage: 'PROCESSING', dir: 'INFO', objType: 'WASTE', objId: id, batch: src, product: String(_v64G_(al, x, 'Название')), qty: w, unit: unit, price: pr, amount: 0,
        wasteValue: _v64R2_(w * pr), source: 'Разбор_Строки', ref: id, trace: 'PASS', flags: review ? ['WASTE_ABOVE_NORM'] : [], note: 'отходы: ' + String(_v64G_(al, x, 'Причина') || '') + ' — стоимость включена в выход п/ф (правило: отходы без отдельной стоимости)' });
    });
  });
  // 4. производство: расход по партиям (TRACE_LINKS) → партия выпуска
  var tl = _v64Tab_('TRACE_LINKS'), use = {}, issueTl = {}, saleTl = {};
  tl.rows.forEach(function (r) {
    var rel = String(_v64G_(tl, r, 'Relation'));
    if (rel === 'РЕАЛИЗОВАНА_В' && String(_v64G_(tl, r, 'ToType')) === 'SALE') { var sk = String(_v64G_(tl, r, 'ToID')); (saleTl[sk] = saleTl[sk] || []).push(r); }
    if (rel === 'РАСХОДОВАНА_НА' && String(_v64G_(tl, r, 'ToType')) === 'PRODUCTION') { var k = String(_v64G_(tl, r, 'ToID')).replace(/^Производство\s+/, ''); (use[k] = use[k] || []).push(r); }
    if (rel === 'ВЫДАНА_НА_БАНКЕТ') { var s = String(_v64G_(tl, r, 'Source')); (issueTl[s] = issueTl[s] || []).push(r); }
  });
  var pt = _v64Tab_('Производство'), prodUnit = {}, dishUnitCost = {};
  pt.rows.forEach(function (r) {
    var pid = String(r[0] || ''), st = String(r[12] || ''); if (!pid || st !== 'COMPLETED') return;
    var name = String(r[2] || ''), code = String(r[3] || ''), fact = _v64Num_(r[6]), plan = _v64Num_(r[5]), unit = String(r[7] || 'г'), d = _v64Date_(r[11]) || _v64Date_(r[17]);
    var outBatch = String(r[14] || ''), recorded = _v64Num_(r[13]), dish = D.byCode[code], semi = dish ? !!dish.semi : _isPfName_(name), stage = semi ? 'SEMI' : 'DISH', who = String(r[9] || '');
    var sum = 0, missing = false, inputs = use[pid] || [];
    inputs.forEach(function (x) {
      var bid = String(_v64G_(tl, x, 'FromID')), b = B[bid], q = _v64Num_(_v64G_(tl, x, 'Weight')), u = String(_v64G_(tl, x, 'Unit') || (b ? b.unit : 'г'));
      var qb = b ? _v64Conv_(q, u, b.unit) : null, pr = _v64EffPrice_(b), c = qb === null ? 0 : qb * pr, fl = [];
      if (!b) fl.push('NO_BATCH'); else if (!(b.price > 0)) { fl.push('MISSING_PRICE'); missing = true; }
      if (b && b.extra) fl.push('EXTRA_ALLOCATED');
      sum += c;
      push({ date: d, stage: stage, dir: 'OUT', objType: 'PRODUCTION', objId: pid, batch: bid, production: pid, product: b ? b.product : '', productId: b ? b.productId : '', qty: q, unit: u, price: pr,
        amount: _v64R2_(c), source: 'TRACE_LINKS', ref: 'Производство ' + pid, employee: who, op: String(r[1] || ''), trace: b ? (fl.indexOf('MISSING_PRICE') >= 0 ? 'REVIEW' : 'PASS') : 'MISSING_EVIDENCE', flags: fl,
        note: 'расход на выпуск «' + name + '» по цене партии (FEFO)' });
    });
    var fl2 = [], tr2 = 'PASS';
    if (!inputs.length) { fl2.push('NO_BATCH'); tr2 = 'MISSING_EVIDENCE'; }
    if (missing) { fl2.push('MISSING_PRICE'); tr2 = 'REVIEW'; }
    var gap = recorded - sum;
    if (inputs.length && gap > Math.max(0.5, recorded * 0.01)) { fl2.push('NO_BATCH'); if (tr2 === 'PASS') tr2 = 'REVIEW'; }   // часть сырья списана без партии (по средней цене)
    else if (inputs.length && Math.abs(gap) > Math.max(0.5, recorded * 0.01)) { fl2.push('COST_DIFF'); if (tr2 === 'PASS') tr2 = 'REVIEW'; }
    var total = Math.max(sum, recorded > 0 && fl2.indexOf('NO_BATCH') >= 0 ? recorded : sum), uc = fact > 0 ? total / fact : 0;
    prodUnit[pid] = { unitCost: uc, total: total, fact: fact, plan: plan, unit: unit, batch: outBatch, name: name, code: code, stage: stage, date: d, recorded: recorded, inputs: sum };
    if (!semi && fact > 0) { var dk = _v64Key_(name); (dishUnitCost[dk] = dishUnitCost[dk] || []).push({ d: d, uc: uc, unit: unit }); }
    push({ date: d, stage: stage, dir: 'IN', objType: 'BATCH', objId: outBatch, batch: outBatch, production: pid, product: name, qty: fact, unit: unit, price: uc, amount: _v64R2_(total),
      source: 'Производство', ref: pid, employee: who, op: String(r[1] || ''), trace: tr2, flags: fl2,
      note: 'выпуск ' + (semi ? 'п/ф' : 'блюда') + ' по ТТК ' + code + ': стоимость израсходованных партий ' + _v64R2_(sum) + (Math.abs(gap) > 0.5 ? ' · в выпуске записано ' + _v64R2_(recorded) : '') });
    if (plan > fact + 1e-9) push({ date: d, stage: stage, dir: 'INFO', objType: 'PRODUCTION', objId: pid, production: pid, product: name, qty: _v64R3_(plan - fact), unit: unit, price: uc, amount: 0,
      wasteValue: _v64R2_((plan - fact) * uc), source: 'Производство', ref: pid, trace: 'PASS', flags: [], note: 'выход меньше плана: цена единицы выросла, стоимость выпущенной партии не меняется' });
  });
  // 5. выдача на банкет (по партиям) и упаковка
  var pack = _v64PackNorms_(), it = _v64Tab_('Выдача_V28'), issueByEv = {};
  it.rows.forEach(function (r) {
    var id = String(_v64G_(it, r, 'IssueID')), ev2 = String(_v64G_(it, r, 'EventID')), d = _v64Date_(_v64G_(it, r, 'IssuedAt')), q = _v64Num_(_v64G_(it, r, 'IssuedQty'));
    var name = String(_v64G_(it, r, 'DishName')), code = String(_v64G_(it, r, 'DishCode')), cost = _v64Num_(_v64G_(it, r, 'Cost')), unit = String(_v64G_(it, r, 'Unit') || 'порц.');
    (issueByEv[ev2] = issueByEv[ev2] || []).push({ id: id, name: name, code: code, qty: q, cost: cost, date: d });
    var per = issueTl[id] || [], sum = 0;
    if (per.length) per.forEach(function (x) {
      var bid = String(_v64G_(tl, x, 'FromID')), b = B[bid], qq = _v64Num_(_v64G_(tl, x, 'Weight')) || q, u = String(_v64G_(tl, x, 'Unit') || (b ? b.unit : unit));
      var qb = b ? _v64Conv_(qq, u, b.unit) : null, pr = _v64EffPrice_(b), c = qb === null ? 0 : qb * pr; sum += c;
      push({ date: d, stage: 'ISSUE', dir: 'OUT', objType: 'ISSUE', objId: id, batch: bid, event: ev2, product: name, qty: qq, unit: unit, price: pr, amount: _v64R2_(c), source: 'Выдача_V28',
        ref: id, employee: String(_v64G_(it, r, 'IssuedBy')), trace: b ? 'PASS' : 'MISSING_EVIDENCE', flags: b ? (b.price > 0 ? [] : ['MISSING_PRICE']) : ['NO_BATCH'], note: 'выдача на банкет ' + ev2 + ' по партии' });
    });
    else push({ date: d, stage: 'ISSUE', dir: 'OUT', objType: 'ISSUE', objId: id, batch: String(_v64G_(it, r, 'BatchIDs')), event: ev2, product: name, qty: q, unit: unit, price: q > 0 ? cost / q : 0,
      amount: _v64R2_(cost), source: 'Выдача_V28', ref: id, employee: String(_v64G_(it, r, 'IssuedBy')), trace: 'REVIEW', flags: ['NO_BATCH'], note: 'количество по партиям не записано — стоимость из выдачи' });
    (pack[_v64Key_(name)] || []).forEach(function (n) {
      push({ date: d, stage: 'PACKAGING', dir: 'OUT', objType: 'ISSUE', objId: id, event: ev2, dish: name, product: n.item, qty: _v64R3_(n.qty * q), unit: n.unit, price: n.price, amount: _v64R2_(n.qty * q * n.price),
        source: 'Упаковка_Нормы', ref: n.id, trace: n.price > 0 ? 'PASS' : 'REVIEW', flags: n.price > 0 ? [] : ['MISSING_PRICE'], note: n.kind + ' к выдаче «' + name + '»' });
    });
  });
  // 6. банкет: обслужено / возврат / брак (себестоимость реализации банкета)
  var ft = _v64Tab_('Факт_Банкет_V29'), closedEv = {};
  ft.rows.forEach(function (r) {
    var ev3 = String(_v64G_(ft, r, 'EventID')), d = _v64Date_(_v64G_(ft, r, 'RecordedAt')), name = String(_v64G_(ft, r, 'DishName')), unit = String(_v64G_(ft, r, 'Unit') || 'порц.');
    var issued = _v64Num_(_v64G_(ft, r, 'IssuedQty')), cost = _v64Num_(_v64G_(ft, r, 'Cost')), uc = issued > 0 ? cost / issued : 0, id = String(_v64G_(ft, r, 'FactID'));
    closedEv[ev3] = true;
    var base = { date: d, objType: 'BANQUET', objId: ev3, event: ev3, product: name, unit: unit, price: uc, source: 'Факт_Банкет_V29', ref: id, employee: String(_v64G_(ft, r, 'RecordedBy')), trace: 'PASS', flags: [] };
    var mk = function (stage, dir, q, note) { var o = JSON.parse(JSON.stringify(base)); o.date = d; o.stage = stage; o.dir = dir; o.qty = q; o.amount = _v64R2_(q * uc); o.note = note; return o; };
    var sv = _v64Num_(_v64G_(ft, r, 'ServedQty')), rt = _v64Num_(_v64G_(ft, r, 'ReturnedQty')), ws = _v64Num_(_v64G_(ft, r, 'WasteQty'));
    if (sv > 0) push(mk('SALE', 'OUT', sv, 'себестоимость обслуженного количества'));
    if (rt > 0) push(mk('RETURN', 'TRANSFER', rt, 'возврат в карантин (не на свободный склад)'));
    if (ws > 0) push(mk('WASTE', 'OUT', ws, 'брак / остаток банкета: ' + String(_v64G_(ft, r, 'WasteReason') || '')));
  });
  // выдано, но банкет не закрыт — себестоимость выданного ждёт закрытия
  Object.keys(issueByEv).forEach(function (e) { if (closedEv[e]) return; issueByEv[e].forEach(function (x) {
    push({ date: x.date, stage: 'SALE', dir: 'OUT', objType: 'BANQUET', objId: e, event: e, product: x.name, qty: x.qty, unit: 'порц.', price: x.qty > 0 ? x.cost / x.qty : 0, amount: _v64R2_(x.cost),
      source: 'Выдача_V28', ref: x.id, trace: 'REVIEW', flags: ['BANQUET_NOT_CLOSED'], note: 'банкет не закрыт: себестоимость выданного (обслужено/возврат/брак не распределены)' }); }); });
  // 7. продажи: выручка (J36) и себестоимость продаж в зал
  var prices = _v64MenuPrices_(), st7 = _v64Tab_('Ж_Продажи'), wt = _v64Tab_('Продажи_Списание_V71'), v71 = {};
  wt.rows.forEach(function (r) { var k = String(_v64G_(wt, r, 'SaleID', '')); if (k) v71[k] = r; });
  var ucFor = function (name, d) {
    var arr = (dishUnitCost[_v64Key_(name)] || []).filter(function (x) { return !d || !x.d || x.d <= d; });
    if (!arr.length) arr = dishUnitCost[_v64Key_(name)] || [];
    if (arr.length) return { uc: arr[arr.length - 1].uc, how: 'NO_ISSUE_BATCH' };
    var n = _v64NormCost_(name); return n.cost > 0 ? { uc: n.cost, how: 'NORMATIVE_COST', missing: n.missing } : null;
  };
  st7.rows.forEach(function (r, i) {
    var dish = String(_v64G_(st7, r, 'Блюдо')); if (!dish) return;
    var d = _v64Date_(_v64G_(st7, r, 'Внесено')) || _v64Date_(_v64G_(st7, r, 'Дата')), dd = _v64Date_(_v64G_(st7, r, 'Дата')) || d;
    var q = _v64Num_(_v64G_(st7, r, 'Количество')), p = _v64G_(st7, r, 'Цена'), sum = _v64G_(st7, r, 'Сумма'), seller = String(_v64G_(st7, r, 'ФИО продавца'));
    var m = /Выдача банкета\s+(\S+)/.exec(seller), ev4 = m ? m[1] : '', flags = [], trace = 'PASS', price = _v64Num_(p), amount = sum !== '' ? _v64Num_(sum) : q * price;
    if (!(price > 0) && !(amount > 0)) {
      var mp = _v64PriceFor_(prices, dish, ev4, dd);
      if (mp) { price = mp.price; amount = q * price; flags.push('PRICE_FROM_MENU'); }
      else { flags.push('MISSING_SALE_PRICE'); trace = 'REVIEW'; amount = 0; }
    }
    var dobj = _v64DishOf_(dish);
    var sm = /\b(SL-\d{8}-[0-9A-F]{8})\b/.exec(String(_v64G_(st7, r, 'Источник записи', ''))), sid = sm ? sm[1] : '', wrow = sid ? v71[sid] : null;
    push({ date: dd, stage: 'SALE', dir: 'IN', objType: 'SALE', objId: 'J36-' + (i + 2), event: ev4, product: dish, productId: dobj ? dobj.code : '', qty: q, unit: wrow ? String(_v64G_(wt, wrow, 'Ед.', 'порц.')) : 'порц.', price: price, amount: _v64R2_(amount),
      source: 'Ж_Продажи', ref: 'строка ' + (i + 2), employee: seller, trace: trace, flags: flags, note: ev4 ? 'выручка банкета ' + ev4 : 'продажа в зал' });
    if (!ev4 && wrow) {   // V71: склад списан при продаже — себестоимость по списанным партиям (их цена, FEFO)
      (saleTl[sid] || []).forEach(function (x) {
        var bid = String(_v64G_(tl, x, 'FromID')), b = B[bid], q = _v64Num_(_v64G_(tl, x, 'Weight')), u = String(_v64G_(tl, x, 'Unit') || (b ? b.unit : ''));
        var qb = b ? _v64Conv_(q, u, b.unit) : null, pr = _v64EffPrice_(b), c = qb === null ? 0 : qb * pr, fl = [];
        if (!b) fl.push('NO_BATCH'); else if (!(b.price > 0)) fl.push('MISSING_PRICE');
        if (b && b.extra) fl.push('EXTRA_ALLOCATED');
        push({ date: dd, stage: 'SALE', dir: 'OUT', objType: 'SALE', objId: 'J36-' + (i + 2), batch: bid, product: dish, productId: dobj ? dobj.code : '', qty: q, unit: u, price: pr, amount: _v64R2_(c),
          source: 'TRACE_LINKS', ref: sid, employee: seller, trace: !b ? 'MISSING_EVIDENCE' : (fl.indexOf('MISSING_PRICE') >= 0 ? 'REVIEW' : 'PASS'), flags: fl,
          note: 'себестоимость продажи в зал: ' + (b ? b.product : bid) + ', партия списана при продаже ' + sid + ' (FEFO)' });
      });
      var sf = []; try { sf = JSON.parse(String(_v64G_(wt, wrow, 'Не хватило (JSON)', '[]')) || '[]'); } catch (eSf) {}
      sf.forEach(function (x) {
        var est = _v64Num_(x.est), q = _v64Num_(x.qty);
        push({ date: dd, stage: 'SALE', dir: 'OUT', objType: 'SALE', objId: 'J36-' + (i + 2), product: dish, productId: dobj ? dobj.code : '', qty: q, unit: String(x.unit || ''), price: q > 0 ? est / q : 0,
          amount: _v64R2_(est), source: 'Продажи_Списание_V71', ref: sid, employee: seller, trace: 'REVIEW', flags: ['SALE_STOCK_SHORT'],
          note: 'не хватило на складе: ' + String(x.product || '') + ' ' + _v64R3_(q) + ' ' + String(x.unit || '') + ' — ' + String(x.reason || '') + (est > 0 ? '; оценка по средней цене' : '; цены нет — оценка 0') });
      });
      (pack[_v64Key_(dish)] || []).forEach(function (n) {
        push({ date: dd, stage: 'PACKAGING', dir: 'OUT', objType: 'SALE', objId: 'J36-' + (i + 2), dish: dish, product: n.item, qty: _v64R3_(n.qty * q), unit: n.unit, price: n.price, amount: _v64R2_(n.qty * q * n.price),
          source: 'Упаковка_Нормы', ref: n.id, trace: n.price > 0 ? 'PASS' : 'REVIEW', flags: n.price > 0 ? [] : ['MISSING_PRICE'], note: n.kind + ' к продаже «' + dish + '»' });
      });
    } else if (!ev4) {   // себестоимость продажи в зал: по последнему выпуску блюда, иначе по нормативу ТТК
      var c = ucFor(dish, dd), fl = [];
      if (c) fl.push(c.how); else fl.push('MISSING_PRICE');
      push({ date: dd, stage: 'SALE', dir: 'OUT', objType: 'SALE', objId: 'J36-' + (i + 2), product: dish, productId: dobj ? dobj.code : '', qty: q, unit: 'порц.', price: c ? c.uc : 0, amount: _v64R2_(c ? c.uc * q : 0),
        source: c && c.how === 'NORMATIVE_COST' ? 'ТТК (норматив)' : 'Производство', ref: 'строка ' + (i + 2), trace: 'REVIEW', flags: fl, note: 'себестоимость продажи в зал (нет выдачи по партии)' });
      (pack[_v64Key_(dish)] || []).forEach(function (n) {
        push({ date: dd, stage: 'PACKAGING', dir: 'OUT', objType: 'SALE', objId: 'J36-' + (i + 2), dish: dish, product: n.item, qty: _v64R3_(n.qty * q), unit: n.unit, price: n.price, amount: _v64R2_(n.qty * q * n.price),
          source: 'Упаковка_Нормы', ref: n.id, trace: n.price > 0 ? 'PASS' : 'REVIEW', flags: n.price > 0 ? [] : ['MISSING_PRICE'], note: n.kind + ' к продаже «' + dish + '»' });
      });
    }
  });
  // скидки и возвраты денег по продажам
  var fo = _v64Tab_('Финансы_Операции');
  fo.rows.forEach(function (r) {
    var type = String(_v64G_(fo, r, 'Type')); if (!/^(SALE_DISCOUNT|REFUND)$/.test(type) || String(_v64G_(fo, r, 'Status', 'ACTIVE')) === 'CANCELLED') return;
    push({ date: _v64Date_(_v64G_(fo, r, 'Date')), stage: 'SALE', dir: 'IN', objType: 'FIN_OPERATION', objId: String(_v64G_(fo, r, 'FinOpID')), event: String(_v64G_(fo, r, 'EventID')),
      product: String(_v64G_(fo, r, 'DishName')), amount: -_v64R2_(_v64Num_(_v64G_(fo, r, 'Amount'))), source: 'Финансы_Операции', ref: String(_v64G_(fo, r, 'FinOpID')), trace: 'PASS', flags: [],
      note: type === 'REFUND' ? 'возврат денег покупателю' : 'скидка по продаже' });
  });
  // 8. подтверждённые корректировки и управленческие расходы
  var ct = _v64Tab_('Финансы_Корректировки');
  ct.rows.forEach(function (r) {
    if (String(_v64G_(ct, r, 'Status')) !== 'CONFIRMED') return;
    push({ date: _v64Date_(_v64G_(ct, r, 'ConfirmedAt')) || _v64Date_(_v64G_(ct, r, 'CreatedAt')), stage: 'CORRECTION', dir: String(_v64G_(ct, r, 'Direction', 'OUT')), objType: String(_v64G_(ct, r, 'ObjectType')),
      objId: String(_v64G_(ct, r, 'ObjectID')), amount: _v64R2_(_v64Num_(_v64G_(ct, r, 'Amount'))), source: 'Финансы_Корректировки', ref: String(_v64G_(ct, r, 'CorrectionID')),
      employee: String(_v64G_(ct, r, 'Author')), trace: 'PASS', flags: [], note: 'корректировка к периоду ' + String(_v64G_(ct, r, 'PeriodID')) + ': ' + String(_v64G_(ct, r, 'Reason')) + ' · подтвердил ' + String(_v64G_(ct, r, 'ConfirmedBy')) });
  });
  var xt = _v64Tab_('Финансы_Расходы');
  xt.rows.forEach(function (r) {
    if (String(_v64G_(xt, r, 'Status', 'ACTIVE')) === 'CANCELLED') return;
    push({ date: _v64Date_(_v64G_(xt, r, 'Date')) || _v64Date_(_v64G_(xt, r, 'PeriodFrom')), stage: 'EXPENSE', dir: 'OUT', objType: 'EXPENSE', objId: String(_v64G_(xt, r, 'ExpenseID')),
      product: String(_v64G_(xt, r, 'Category')), amount: _v64R2_(_v64Num_(_v64G_(xt, r, 'Amount'))), source: 'Финансы_Расходы', ref: String(_v64G_(xt, r, 'Document')), trace: 'NOT_APPLICABLE', flags: [],
      note: 'управленческий слой — не входит в продуктовую себестоимость' + (String(_v64G_(xt, r, 'Workshop')) ? ' · ' + _v64G_(xt, r, 'Workshop') : '') });
  });
  lines.sort(function (a, b) { return (a.date ? a.date.getTime() : 0) - (b.date ? b.date.getTime() : 0); });
  return { lines: lines, batches: B, production: prodUnit };
}

/** Нормы упаковки и комплектующих: по ключу блюда. */
function _v64PackNorms_() {
  var t = _v64Tab_('Упаковка_Нормы'), out = {}, now = new Date();
  t.rows.forEach(function (r) {
    if (String(_v64G_(t, r, 'Status', 'ACTIVE')) !== 'ACTIVE') return;
    var to = _v64Date_(_v64G_(t, r, 'DateTo')); if (to && to < now) return;
    var name = String(_v64G_(t, r, 'DishName')) || ((_v64DishOf_(String(_v64G_(t, r, 'DishCode'))) || {}).name || '');
    var item = String(_v64G_(t, r, 'Item')), unit = String(_v64G_(t, r, 'Unit') || 'шт'), price = _v64Num_(_v64G_(t, r, 'UnitPrice'));
    if (!(price > 0)) { try { price = _currentAvgPrice_(item, unit) || 0; } catch (e) {} }
    (out[_v64Key_(name)] = out[_v64Key_(name)] || []).push({ id: String(_v64G_(t, r, 'NormID')), item: item, qty: _v64Num_(_v64G_(t, r, 'QtyPerPortion')), unit: unit, price: price, kind: String(_v64G_(t, r, 'Kind') || 'Упаковка') });
  });
  return out;
}
/** Цены меню и договоров банкетов. */
function _v64MenuPrices_() {
  var t = _v64Tab_('Цены_Меню'), out = [];
  t.rows.forEach(function (r) { if (String(_v64G_(t, r, 'Status', 'ACTIVE')) === 'CANCELLED') return;
    out.push({ key: _v64Key_(String(_v64G_(t, r, 'DishName')) || ((_v64DishOf_(String(_v64G_(t, r, 'DishCode'))) || {}).name || '')), code: String(_v64G_(t, r, 'DishCode')), price: _v64Num_(_v64G_(t, r, 'Price')),
      from: _v64Date_(_v64G_(t, r, 'DateFrom')), to: _v64Date_(_v64G_(t, r, 'DateTo')), event: String(_v64G_(t, r, 'EventID')), source: String(_v64G_(t, r, 'Source')) }); });
  return out;
}
function _v64PriceFor_(prices, dish, eventId, d) {
  var k = _v64Key_(dish), at = d || new Date();
  var ok = function (p) { return p.key === k && p.price > 0 && (!p.from || p.from <= at) && (!p.to || p.to >= new Date(at.getFullYear(), at.getMonth(), at.getDate())); };
  var ev = eventId ? prices.filter(function (p) { return p.event === eventId && ok(p); }) : [];
  if (ev.length) return ev[ev.length - 1];
  var menu = prices.filter(function (p) { return !p.event && ok(p); });
  return menu.length ? menu[menu.length - 1] : null;
}
/** Нормативная себестоимость порции по действующей ТТК и текущим ценам (п/ф — по своей цене единицы, без раскрытия). */
function _v64NormCost_(nameOrCode) {
  var d = _v64DishOf_(nameOrCode), out = { cost: 0, lines: [], missing: [] };
  if (!d) return out;
  var perPortion = !d.semi;   // у блюда состав в индексе уже на одну порцию
  (d.ing || []).forEach(function (x) {
    var nm = x[0], q = Number(x[1]) || 0, u = x[2] || 'г', p = 0;
    try { p = _currentAvgPrice_(nm, u) || 0; } catch (e) { p = 0; }
    var c = q * p; out.cost += c;
    out.lines.push({ ingredient: nm, qty: _v64R3_(q), unit: u, price: p, cost: _v64R2_(c), semi: _isPfName_(nm) });
    if (!(p > 0)) out.missing.push(nm);
  });
  if (!perPortion && d.yieldBase > 0) out.perUnit = out.cost / d.yieldBase;
  out.cost = _v64R2_(out.cost);
  return out;
}

/* ---------------- снимки ---------------- */
var MC_V64_SNAP_HEAD = ['SnapshotID', 'Type', 'ObjectID', 'PeriodFrom', 'PeriodTo', 'Amount', 'Qty', 'Unit', 'UnitCost', 'Details', 'Hash', 'CreatedAt', 'CreatedBy', 'OperationID'];
function _v64SnapSheet_() { return _v64Sheet_('Финансы_Снимки', MC_V64_SNAP_HEAD); }
function _v64SnapIndex_() {
  var t = _v64Tab_('Финансы_Снимки'), m = {};
  t.rows.forEach(function (r) { m[String(_v64G_(t, r, 'Type')) + '|' + String(_v64G_(t, r, 'ObjectID'))] = { amount: _v64Num_(_v64G_(t, r, 'Amount')), id: String(_v64G_(t, r, 'SnapshotID')) }; });
  return m;
}
function _v64SnapRow_(type, objectId, amount, qty, unit, details, op, rg) {
  var det = JSON.stringify(details || {}).slice(0, 40000), id = 'SNAP-' + type.split('_')[0] + '-' + Utilities.getUuid().slice(0, 8);
  var who = op && op.session ? (op.session.dev ? MC_RB_TECH_ : (op.session.fullName || op.session.name || '')) : 'система';
  var row = [id, type, String(objectId), rg ? rg.fromIso : '', rg ? rg.toIso : '', _v64R2_(amount), qty === '' || qty === undefined ? '' : _v64R3_(qty), unit || '',
    qty > 0 ? Math.round(amount / qty * 10000) / 10000 : '', det, '', new Date(), who, op ? op.id : ''];
  row[10] = _bkHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(row.slice(0, 10)), Utilities.Charset.UTF_8));
  return row;
}
/** Первый расчёт стоимости партии / выпуска / выдачи / продажи фиксируется снимком; расхождение позже — признак CHANGED_AFTER_SNAPSHOT. */
function _v64Snapshots_(lines, op) {
  var idx = _v64SnapIndex_(), rows = [];
  var typeOf = function (l) {
    if (l.stage === 'PURCHASE' && l.dir === 'IN' && l.objType === 'BATCH' && l.source !== 'Финансы_Операции') return 'BATCH_COST_SNAPSHOT';
    if ((l.stage === 'SEMI' || l.stage === 'DISH') && l.dir === 'IN') return 'PRODUCTION_COST_SNAPSHOT';
    if (l.stage === 'ISSUE' && l.dir === 'OUT') return 'ISSUE_COST_SNAPSHOT';
    if (l.stage === 'SALE' && l.dir === 'OUT') return 'SALE_COST_SNAPSHOT';
    return '';
  };
  var agg = {};
  lines.forEach(function (l) { var t = typeOf(l); if (!t || !l.objId) return; var k = t + '|' + l.objId; (agg[k] = agg[k] || { t: t, id: l.objId, amount: 0, qty: 0, unit: l.unit, lines: [] }); agg[k].amount += Number(l.amount) || 0; agg[k].qty += Number(l.qty) || 0; agg[k].lines.push(l); });
  Object.keys(agg).forEach(function (k) {
    var a = agg[k], s = idx[k];
    if (!s) { rows.push(_v64SnapRow_(a.t, a.id, a.amount, a.qty, a.unit, { batch: a.lines[0].batch || '', product: a.lines[0].product || '', source: a.lines[0].source }, op, null)); return; }
    if (Math.abs(s.amount - _v64R2_(a.amount)) > 0.01) a.lines.forEach(function (l) { if (l.flags.indexOf('CHANGED_AFTER_SNAPSHOT') < 0) l.flags.push('CHANGED_AFTER_SNAPSHOT'); if (l.trace === 'PASS') l.trace = 'REVIEW'; l.note = (l.note ? l.note + ' · ' : '') + 'снимок ' + s.id + ': ' + s.amount; });
  });
  if (rows.length) { var sh = _v64SnapSheet_(); sh.getRange(sh.getLastRow() + 1, 1, rows.length, MC_V64_SNAP_HEAD.length).setValues(rows); }
  return rows.length;
}

/* ---------------- итоги ---------------- */
function _v64Totals_(lines) {
  var t = { purchases: 0, extraCosts: 0, consumption: 0, semiOutput: 0, dishOutput: 0, issueCost: 0, packaging: 0, revenue: 0, cogs: 0, wasteCost: 0, defrostLoss: 0, returnsCost: 0,
    quarantineReturns: 0, processingWasteValue: 0, labCost: 0, corrections: 0, expenses: 0, missingPrice: 0, missingSalePrice: 0, review: 0, missingEvidence: 0, lines: lines.length };
  lines.forEach(function (l) {
    var a = Number(l.amount) || 0;
    if (l.stage === 'PURCHASE' && l.dir === 'IN') { if (l.source === 'Финансы_Операции') t.extraCosts += a; else t.purchases += a; }
    if ((l.stage === 'SEMI' || l.stage === 'DISH') && l.dir === 'OUT') t.consumption += a;
    if (l.stage === 'SEMI' && l.dir === 'IN') t.semiOutput += a;
    if (l.stage === 'DISH' && l.dir === 'IN') t.dishOutput += a;
    if (l.stage === 'ISSUE' && l.dir === 'OUT') t.issueCost += a;
    if (l.stage === 'PACKAGING') t.packaging += a;
    if (l.stage === 'SALE' && l.dir === 'IN') t.revenue += a;
    if (l.stage === 'SALE' && l.dir === 'OUT') t.cogs += a;
    if (l.stage === 'WASTE') t.wasteCost += a;
    if (l.stage === 'DEFROST' && l.dir === 'OUT') t.defrostLoss += a;
    if (l.stage === 'RETURN' && l.dir === 'OUT') t.returnsCost += a;
    if (l.stage === 'RETURN' && l.dir === 'TRANSFER') t.quarantineReturns += a;
    if (l.wasteValue) t.processingWasteValue += Number(l.wasteValue) || 0;
    if (l.stage === 'LAB') t.labCost += a;
    if (l.stage === 'CORRECTION') t.corrections += a;
    if (l.stage === 'EXPENSE') t.expenses += a;
    if (l.flags.indexOf('MISSING_PRICE') >= 0) t.missingPrice++;
    if (l.flags.indexOf('MISSING_SALE_PRICE') >= 0) t.missingSalePrice++;
    if (l.trace === 'REVIEW') t.review++;
    if (l.trace === 'MISSING_EVIDENCE') t.missingEvidence++;
  });
  Object.keys(t).forEach(function (k) { if (typeof t[k] === 'number' && !/^(missing|review|lines)/.test(k)) t[k] = _v64R2_(t[k]); });
  t.cogsWithPackaging = _v64R2_(t.cogs + t.packaging);
  t.grossContribution = _v64R2_(t.revenue - t.cogsWithPackaging);
  t.marginPct = t.revenue > 0 ? Math.round(t.grossContribution / t.revenue * 1000) / 10 : null;
  t.contributionAfterLosses = _v64R2_(t.grossContribution - t.wasteCost - t.defrostLoss - t.returnsCost);
  return t;
}
function _v64LineOut_(l) {
  return { date: l.date ? Utilities.formatDate(l.date, _mcTz_(), 'yyyy-MM-dd HH:mm') : '', stage: l.stage, stageRu: MC_V64_STAGE_RU[l.stage] || l.stage, dir: l.dir, objectType: l.objType || '', objectId: l.objId || '',
    batch: l.batch || '', parent: l.parent || '', production: l.production || '', event: l.event || '', dish: l.dish || '', productId: l.productId || '', product: l.product || '', qty: l.qty === undefined ? '' : _v64R3_(l.qty),
    unit: l.unit || '', unitPrice: l.price === '' || l.price === undefined ? '' : Math.round(Number(l.price) * 10000) / 10000, amount: _v64R2_(l.amount), source: l.source || '', ref: l.ref || '', employee: l.employee || '',
    op: l.op || '', trace: l.trace || 'PASS', flags: l.flags || [], flagsRu: (l.flags || []).map(function (f) { return MC_V64_FLAG_RU[f] || f; }), note: l.note || '', wasteValue: l.wasteValue || '' };
}

/* ---------------- публичные функции (ТЗ §4.2) ---------------- */
/** Пересобрать журнал «Экономика_Движение_V64» за период. Строки периода заменяются, первичные листы не меняются. */
function v64RebuildLedger(fromDate, toDate, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_view', 'V64_REBUILD', 'Экономика', null, { from: fromDate || '', to: toDate || '' }); } catch (e) { return _failFrom_(e); }
  try {
    var rg = _v64Range_(fromDate, toDate);
    return _withLock_(function () {
      var res = _v64Build_(rg), runId = 'V64-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 4);
      var snaps = _v64Snapshots_(res.lines, op);
      _v64MarkClosed_(res.lines, rg);
      var sh = _v64Sheet_(MC_V64.LEDGER, MC_V64_HEAD), v = sh.getDataRange().getValues(), keep = [v[0]], removed = 0;
      for (var i = 1; i < v.length; i++) { var d = _v64Date_(v[i][2]); if (d && d >= rg.from && d <= rg.to) removed++; else keep.push(v[i]); }
      var rows = res.lines.map(function (l, k) { var o = _v64LineOut_(l);
        return [runId + '-' + (k + 1), runId, l.date || '', l.stage, l.dir, o.objectType, o.objectId, o.batch, o.parent, o.production, o.event, o.productId, o.product, o.qty, o.unit, o.unitPrice, o.amount,
          o.source, o.ref, o.employee, o.op, o.trace, o.flags.join(','), o.note]; });
      if (removed) { sh.clearContents(); if (keep.length) sh.getRange(1, 1, keep.length, MC_V64_HEAD.length).setValues(keep.map(function (r) { var x = r.slice(0, MC_V64_HEAD.length); while (x.length < MC_V64_HEAD.length) x.push(''); return x; })); }
      if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, MC_V64_HEAD.length).setValues(rows);
      var totals = _v64Totals_(res.lines);
      PropertiesService.getScriptProperties().setProperty('MC_V64_LAST', JSON.stringify({ runId: runId, at: new Date().toISOString(), from: rg.fromIso, to: rg.toIso, lines: rows.length }));
      _audit_(op, 'V64_REBUILD', 'Экономика', runId, null, { from: rg.fromIso, to: rg.toIso, lines: rows.length, replaced: removed, snapshots: snaps, revenue: totals.revenue, gross: totals.grossContribution });
      _endOp_(op);
      return _ok_({ runId: runId, from: rg.fromIso, to: rg.toIso, lines: rows.length, replaced: removed, snapshotsCreated: snaps, totals: totals,
        note: 'Журнал пересобран из первичных листов; первичные листы не изменялись.' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Экономика партии: закупка, доп. расходы, движение, расход в производство, выдачу и продажу в зал, отходы, возвраты; куда ушла стоимость. */
function v64GetBatchEconomics(batchId, token) {
  try {
    _requireAuth_(token, 'finance_view');
    var id = String(batchId || '').trim(); if (!id) return _fail_('VALIDATION', 'Укажите партию');
    var res = _v64Build_(null), b = res.batches[id];
    if (!b) return _fail_('NOT_FOUND', 'Партия ' + id + ' не найдена');
    var own = res.lines.filter(function (l) { return l.batch === id || l.objId === id || l.parent === id; });
    var start = own.filter(function (l) { return l.dir === 'IN' && (l.stage === 'PURCHASE' || l.stage === 'PROCESSING' || l.stage === 'SEMI' || l.stage === 'DISH' || l.stage === 'LAB') && (l.batch === id || l.objId === id); })
      .reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0);
    var sum = function (f) { return _v64R2_(own.filter(f).reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0)); };
    var used = sum(function (l) { return l.batch === id && l.dir === 'OUT' && /SEMI|DISH|STORAGE|PROCESSING|ISSUE|SALE/.test(l.stage); });   // V71: и продажа в зал со списанием партии
    var sold = sum(function (l) { return l.batch === id && l.dir === 'OUT' && l.stage === 'SALE'; });
    var waste = sum(function (l) { return l.batch === id && (l.stage === 'WASTE' || (l.stage === 'DEFROST' && l.dir === 'OUT')); });
    var ret = sum(function (l) { return l.batch === id && l.stage === 'RETURN' && l.dir === 'OUT'; });
    var remainValue = _v64R2_(b.remain * _v64EffPrice_(b));
    var children = res.lines.filter(function (l) { return l.parent === id && l.dir === 'IN'; }).map(function (l) { return { batch: l.batch, product: l.product, qty: _v64R3_(l.qty), unit: l.unit, amount: _v64R2_(l.amount) }; });
    var productions = {}; own.forEach(function (l) { if (l.production && l.dir === 'OUT') { var p = res.production[l.production] || {}; productions[l.production] = { production: l.production, product: p.name || '', outBatch: p.batch || '', unitCost: _v64R2_(p.unitCost), consumed: _v64R2_((productions[l.production] || { consumed: 0 }).consumed + (Number(l.amount) || 0)) }; } });
    var flags = []; own.forEach(function (l) { l.flags.forEach(function (f) { if (flags.indexOf(f) < 0) flags.push(f); }); });
    return _ok_({ batchId: id, product: b.product, productId: b.productId, unit: b.unit, qty: b.qty, remain: b.remain, status: b.status, unitPrice: b.price, extraCosts: _v64R2_(b.extra),
      effectiveUnitPrice: Math.round(_v64EffPrice_(b) * 10000) / 10000, supplier: b.pass ? b.pass.supplier : '', invoice: b.pass ? b.pass.invoice : '', received: b.received ? _v64Day_(b.received) : '',
      startValue: _v64R2_(start), usedValue: used, soldValue: sold, wasteValue: waste, returnValue: ret, remainValue: remainValue, children: children, productions: Object.keys(productions).map(function (k) { return productions[k]; }),
      flags: flags, flagsRu: flags.map(function (f) { return MC_V64_FLAG_RU[f] || f; }), status64: flags.indexOf('MISSING_PRICE') >= 0 ? 'MISSING_PRICE' : (flags.length ? 'REVIEW' : 'PASS'),
      lines: own.map(_v64LineOut_) });
  } catch (e) { return _failFrom_(e); }
}

/** Экономика выпуска: какие партии израсходованы и по какой цене, выход, цена единицы, отклонение от записанной себестоимости и от норматива. */
function v64GetProductionEconomics(productionId, token) {
  try {
    _requireAuth_(token, 'finance_view');
    var pid = String(productionId || '').trim().replace(/^Производство\s+/, ''); if (!pid) return _fail_('VALIDATION', 'Укажите выпуск');
    var res = _v64Build_(null), p = res.production[pid];
    if (!p) return _fail_('NOT_FOUND', 'Выпуск ' + pid + ' не найден или не завершён');
    var own = res.lines.filter(function (l) { return l.production === pid; });
    var norm = _v64NormCost_(p.code), normTotal = null;
    if (norm.cost > 0) { var dsh = _v64DishOf_(p.code); normTotal = dsh && dsh.semi ? (norm.perUnit ? norm.perUnit * (_v64Conv_(p.fact, p.unit, dsh.yieldUnit || 'г') || 0) : null) : norm.cost * p.fact; }
    var dev = normTotal ? _v64R2_(p.total - normTotal) : null;
    return _ok_({ productionId: pid, product: p.name, ttk: p.code, stage: p.stage, plan: p.plan, fact: p.fact, unit: p.unit, outBatch: p.batch, date: p.date ? _v64Day_(p.date) : '',
      inputsCost: _v64R2_(p.inputs), totalCost: _v64R2_(p.total), unitCost: Math.round(p.unitCost * 10000) / 10000, recordedCost: _v64R2_(p.recorded),
      normativeCost: normTotal === null ? null : _v64R2_(normTotal), deviation: dev, deviationPct: normTotal ? Math.round(dev / normTotal * 1000) / 10 : null, normative: norm,
      inputs: own.filter(function (l) { return l.dir === 'OUT'; }).map(_v64LineOut_), output: own.filter(function (l) { return l.dir === 'IN'; }).map(_v64LineOut_),
      losses: own.filter(function (l) { return l.dir === 'INFO'; }).map(_v64LineOut_) });
  } catch (e) { return _failFrom_(e); }
}

/** Движение продукта за период: закупка → хранение → обработка → производство → выдача → продажа, по этапам. */
function v64GetProductFlow(product, fromDate, toDate, token) {
  try {
    _requireAuth_(token, 'finance_view');
    var q = String(product || '').trim(); if (!q) return _fail_('VALIDATION', 'Укажите продукт или ProductID');
    var rg = _v64Range_(fromDate, toDate), res = _v64Build_(rg), k = _v64Key_(q);
    var own = res.lines.filter(function (l) { return l.productId === q || _v64Key_(l.product) === k || (l.batch && res.batches[l.batch] && (_v64Key_(res.batches[l.batch].product) === k || res.batches[l.batch].productId === q)); });
    var stages = {};
    own.forEach(function (l) { var key = l.stage + '|' + l.dir, s = stages[key] || (stages[key] = { stage: l.stage, stageRu: MC_V64_STAGE_RU[l.stage] || l.stage, dir: l.dir, qty: 0, unit: l.unit, amount: 0, lines: 0 });
      var qq = _v64Conv_(l.qty || 0, l.unit, s.unit); s.qty += qq === null ? 0 : qq; s.amount += Number(l.amount) || 0; s.lines++; });
    var order = ['PURCHASE', 'LAB', 'STORAGE', 'DEFROST', 'PROCESSING', 'SEMI', 'DISH', 'PACKAGING', 'ISSUE', 'SALE', 'RETURN', 'WASTE', 'CORRECTION'];
    var list = Object.keys(stages).map(function (x) { var s = stages[x]; s.qty = _v64R3_(s.qty); s.amount = _v64R2_(s.amount); return s; })
      .sort(function (a, b) { return order.indexOf(a.stage) - order.indexOf(b.stage); });
    return _ok_({ product: q, from: rg.fromIso, to: rg.toIso, stages: list, totals: _v64Totals_(own), lines: own.map(_v64LineOut_) });
  } catch (e) { return _failFrom_(e); }
}

/** Сводка руководителя: выручка, себестоимость реализации, валовой вклад, маржа, потери, проблемные записи; закрытые периоды. */
function v64GetDashboard(token, fromDate, toDate) {
  try {
    _requireAuth_(token, 'finance_view');
    var rg = _v64Range_(fromDate, toDate), res = _v64Build_(rg), t = _v64Totals_(res.lines);
    var by = function (keyFn, filter) { var m = {}; res.lines.filter(filter || function () { return true; }).forEach(function (l) { var k = keyFn(l); if (!k) return; var x = m[k] || (m[k] = { key: k, revenue: 0, cost: 0, packaging: 0, waste: 0, qty: 0 });
      if (l.stage === 'SALE' && l.dir === 'IN') { x.revenue += Number(l.amount) || 0; x.qty += Number(l.qty) || 0; } if (l.stage === 'SALE' && l.dir === 'OUT') x.cost += Number(l.amount) || 0;
      if (l.stage === 'PACKAGING') x.packaging += Number(l.amount) || 0; if (l.stage === 'WASTE' || (l.stage === 'RETURN' && l.dir === 'OUT')) x.waste += Number(l.amount) || 0; });
      return Object.keys(m).map(function (k) { var x = m[k]; x.revenue = _v64R2_(x.revenue); x.cost = _v64R2_(x.cost + x.packaging); x.waste = _v64R2_(x.waste); x.qty = _v64R3_(x.qty);
        x.gross = _v64R2_(x.revenue - x.cost); x.marginPct = x.revenue > 0 ? Math.round(x.gross / x.revenue * 1000) / 10 : null; delete x.packaging; return x; })
        .sort(function (a, b) { return b.gross - a.gross; }); };
    var D = _v64Dishes_();
    var dishes = by(function (l) { if (l.objType === 'FIN_OPERATION') return ''; if (l.stage === 'PACKAGING') return l.dish || ''; return (l.stage === 'SALE' || l.stage === 'WASTE') ? l.product : ''; });
    var banquets = by(function (l) { return l.event || ''; });
    var shops = by(function (l) { if (l.stage !== 'SALE' && l.stage !== 'WASTE') return ''; var d = _v64DishOf_(l.product); return d ? (D.ws[d.code] || 'Без цеха') : 'Без цеха'; });
    var problems = res.lines.filter(function (l) { return l.trace !== 'PASS' && l.trace !== 'NOT_APPLICABLE'; }).slice(-200).map(_v64LineOut_);
    var last = null; try { last = JSON.parse(PropertiesService.getScriptProperties().getProperty('MC_V64_LAST') || 'null'); } catch (e) {}
    return _ok_({ from: rg.fromIso, to: rg.toIso, totals: t, dishes: dishes, banquets: banquets, workshops: shops, problems: problems,
      noPrice: res.lines.filter(function (l) { return l.flags.indexOf('MISSING_PRICE') >= 0 || l.flags.indexOf('MISSING_SALE_PRICE') >= 0; }).map(_v64LineOut_),
      periods: _v64Periods_(), lastRebuild: last, closedHere: _v64ClosedIn_(rg),
      note: 'Управленческие показатели (валовой вклад) для кухни, меню, закупок и банкетов; бухгалтерский учёт не заменяют.' });
  } catch (e) { return _failFrom_(e); }
}
