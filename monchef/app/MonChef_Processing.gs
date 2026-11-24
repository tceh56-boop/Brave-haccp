/**
 * MON CHEF — обработка сырья: зачистка, разбор на полуфабрикаты, дефрост; план обработки из банкетов.
 *
 * Использует существующий модуль разбора Mon Cher (листы «Разбор_Акты», «Разбор_Строки», «BatchRelations»,
 * «Нормы_Разбора», «Шаблоны_Разбора») и жизненный цикл партии (паспорт, история, этикетка, прослеживаемость).
 * Второй системы партий нет: п/ф — обычная партия MC-… с ParentBatchID и связью BATCH → BATCH «ПРЕОБРАЗОВАНА_В».
 *
 * Правила:
 *   • Обрабатывается только допущенная партия: входной контроль пройден (ВСД погашен), срок не истёк, не заблокирована.
 *     Замороженная — сначала дефрост. FEFO: партия с более ранним сроком предлагается первой.
 *   • Баланс веса: выход + отходы = взятое количество (погрешность 1,5 %). Себестоимость сырья переходит на выход.
 *   • Срок п/ф не выдумывается: срок «после вскрытия» с этикетки производителя сырья (вскрыто при обработке)
 *     или утверждённый срок п/ф в профиле продукта (с основанием) — берётся более ранний, но не позже срока сырья.
 *     Для фарша и рубленых п/ф срок с этикетки сырья по умолчанию НЕ применяется. Нет срока — «ждёт решения по сроку».
 *   • Дефрост (ККТ 4 ППК): только в холодильнике, не дольше MC_DEFROST_MAX_H (12 ч), замер t° в толще каждые
 *     MC_DEFROST_MEASURE_H (4 ч). Превышение — отклонение и блокировка партии. После дефроста — срок «после размораживания»
 *     с этикетки или утверждённый срок продукта; замороженный срок больше не действует. Повторная заморозка запрещена.
 *   • Сотрудник, время, номер партии — только сервер. Списаний система сама не делает — только предупреждает.
 */
var MC_PR_TOL_PCT_ = 1.5;
var MC_PR_ACT_HEAD_ = ['ID', 'Дата', 'ПартияИсточник', 'Продукт', 'ИсходныйВес', 'ЕдИзм', 'Статус', 'Сотрудник', 'СуммаВыход', 'СуммаОтход', 'ПроцентОтход',
  'НормаПроцент', 'ТребуетПроверки', 'Создано', 'Тип', 'Взято', 'OperationID', 'EmployeeID', 'Роль', 'Себестоимость', 'Цена п/ф за ед.', 'Выход %', 'Партии п/ф',
  'Дефрост начат', 'Дефрост до', 'Дефрост окончен', 'Место', 'Детали'];
var MC_PR_LINE_HEAD_ = ['АктID', 'Тип', 'Название', 'Вес', 'НовыйBatchID', 'Ед.', 'Причина', 'Годен до', 'Источник срока', 'Основание срока', 'Цена за ед.'];
var MC_PR_MEAS_ = 'Дефрост_Замеры', MC_PR_MEAS_HEAD_ = ['ID', 'BatchID', 'АктID', 'Время', 't° в толще', 'Норма не выше', 'Результат', 'Итоговый', 'Сотрудник', 'Роль',
  'EquipmentID', 'OperationID', 'FactID', 'DeviationID'];
var MC_PR_TYPE_RU_ = { TRIM: 'Зачистка', CUT: 'Разбор', DEFROST: 'Дефрост' };
var MC_PR_NO_INHERIT_ = /фарш|рублен|котлет|тефтел|фрикадел|кебаб|люля/i;   // п/ф, к которым срок с этикетки сырья по умолчанию не применяется

/* ------------------------------------------------------------------ листы и настройки ---- */
function _prSheet_(sh, head) {
  if (String(sh.getRange(1, head.length).getValue() || '') !== head[head.length - 1]) sh.getRange(1, 1, 1, head.length).setValues([head]);
  return sh;
}
function _prActs_() { return _prSheet_(_disassemblyActsSheet_(), MC_PR_ACT_HEAD_); }
function _prLines_() { return _prSheet_(_disassemblyLinesSheet_(), MC_PR_LINE_HEAD_); }
function _prMeas_() { return _bcSheet_(MC_PR_MEAS_, MC_PR_MEAS_HEAD_); }
function _prCfg_() {
  var p = PropertiesService.getScriptProperties(), n = function (k, d) { var x = parseFloat(String(p.getProperty(k) || '').replace(',', '.')); return isFinite(x) ? x : d; };
  var core = String(p.getProperty('MC_DEFROST_CORE_MAX') || '').trim();
  return { maxH: n('MC_DEFROST_MAX_H', 12), measureH: n('MC_DEFROST_MEASURE_H', 4), coreMax: core === '' ? null : parseFloat(core.replace(',', '.')),
    prodStart: String(p.getProperty('MC_PRODUCTION_START') || '08:00'), basis: String(p.getProperty('MC_DEFROST_BASIS') || 'ППК, ККТ 4: размораживание не более 12 ч, контроль t° в толще каждые 4 ч') };
}
function _prEod_(d) { return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59) : null; }
function _prFmt_(d) { return d ? _mcRcvFmt_(d, true) : ''; }
/** Предел срока по партии-источнику: её действующий срок (с часами — как есть, без часов — конец дня). */
function _prLimit_(b, pass) { var e = _mcBlDate_(b.v[5]); return e ? (_mcBlWithTime_(pass) ? e : _prEod_(e)) : null; }
function _prPv_(pass, k) { return pass ? pass.v[MC_RCV_C_[k]] : ''; }
/** Заморожена и не разморожена: тип хранения «морозильник» по паспорту или место-морозильник. */
function _prFrozen_(b, pass) {
  if (_prPv_(pass, 'Разморожено')) return false;
  if (String(_prPv_(pass, 'Тип хранения')) === 'FREEZER') return true;
  var loc = b.v[14] ? _mcBlLoc_(b.v[14]) : null;
  return !!(loc && loc.type === 'FREEZER');
}
function _prDispUnit_(b, pass) { var u = String(_prPv_(pass, 'Ед.') || ''); return u && _unitsCompatible_(u, b.v[2]) ? u : String(b.v[2] || 'г'); }
function _prToDisp_(qBase, b, pass) { var du = _prDispUnit_(b, pass), k = _toBaseUnitServer_(1, du).qty / (_toBaseUnitServer_(1, b.v[2]).qty || 1); return { q: Math.round(qBase / (k || 1) * 1000) / 1000, u: du, k: k || 1 }; }

/* ------------------------------------------------------------------ сроки ---- */
/** Все этикетки партии (фото оригинала): данные распознавания. */
function _prLabels_(pass) {
  var ids = String(_prPv_(pass, 'Все этикетки') || _prPv_(pass, 'OriginalLabelID') || '').split(',').filter(Boolean), out = [];
  ids.forEach(function (id) { try { var c = _mcRcvCapture_(id); if (c && c.type !== 'PHOTO') out.push(c.data || {}); } catch (e) {} });
  return out;
}
/** Срок после размораживания: этикетка производителя → утверждённый срок продукта → не определён. */
function _prAfterDefrost_(b, pass) {
  var labs = _prLabels_(pass), noRefreeze = false;
  for (var i = 0; i < labs.length; i++) {
    var ad = labs[i].after_defrost || (labs[i].raw_text ? _lblAfterDefrost_(labs[i].raw_text) : null);
    if (ad && ad.noRefreeze) noRefreeze = true;
    if (ad && ad.hours) return { hours: Number(ad.hours), source: 'LABEL_AFTER_DEFROST', basis: 'этикетка производителя: «' + ad.raw + '»', noRefreeze: noRefreeze || !!ad.noRefreeze };
  }
  var prof = _mcBlProfile_(String(b.v[1]), String(b.v[17] || ''));
  if (prof.afterDefrostH) return { hours: prof.afterDefrostH, source: 'PRODUCT_RULE', basis: 'срок продукта после размораживания: ' + (prof.afterDefrostBasis || 'утверждён ' + (prof.by || '')), noRefreeze: noRefreeze };
  return { hours: null, source: 'NONE', basis: '', noRefreeze: noRefreeze };
}
/** Применять ли к п/ф срок с этикетки сырья: решение в профиле п/ф; по умолчанию — да, кроме фарша и рубленых. */
function _prInherit_(name) { var p = _mcBlProfile_(name, ''); return p.inheritLabel === null ? !MC_PR_NO_INHERIT_.test(String(name)) : p.inheritLabel; }
/**
 * Срок п/ф: { date, source, basis }. Кандидаты — срок сырья после вскрытия (вскрывается при обработке; если уже вскрыто или
 * разморожено — действующий срок сырья) и утверждённый срок п/ф; берётся более ранний, не позже срока сырья.
 */
function _prExpiryFor_(b, pass, name, now) {
  var limit = _prLimit_(b, pass), cands = [], prof = _mcBlProfile_(name, ''), inherit = _prInherit_(name);
  if (inherit) {
    if (_prPv_(pass, 'Вскрыто') || _prPv_(pass, 'Разморожено') || _prPv_(pass, 'Обработка')) {
      if (limit) cands.push({ date: limit, source: 'SOURCE', basis: 'действующий срок сырья ' + b.v[0] + (_prPv_(pass, 'Разморожено') ? ' (после размораживания)' : _prPv_(pass, 'Вскрыто') ? ' (после вскрытия)' : '') + ': ' + _prFmt_(limit) });
    } else {
      var r = _mcBlAfterOpenRule_(b, pass);
      if (r.hours) cands.push({ date: new Date(now.getTime() + r.hours * 3600000), source: r.source === 'LABEL' ? 'LABEL_AFTER_OPEN' : r.source, basis: r.basis + ' — упаковка вскрыта при обработке ' + _prFmt_(now) });
    }
  }
  if (prof.shelfH) cands.push({ date: new Date(now.getTime() + prof.shelfH * 3600000), source: 'PF_RULE', basis: 'срок п/ф «' + name + '»: ' + prof.shelfH + ' ч — ' + (prof.shelfBasis || 'утверждён ' + (prof.by || '')) });
  if (!cands.length) return { date: null, source: 'NONE', basis: 'НЕ ОПРЕДЕЛЁН — ' + (inherit ? 'на этикетке сырья нет срока «после вскрытия» и срок п/ф не утверждён' : 'срок с этикетки сырья к этому п/ф не применяется (' + (MC_PR_NO_INHERIT_.test(name) ? 'фарш / рубленый п/ф' : 'решение ответственного') + '), срок п/ф не утверждён') + '; нужно решение ответственного HACCP', limit: limit };
  cands.sort(function (a, c) { return a.date - c.date; });
  var best = cands[0];
  if (limit && limit < best.date) return { date: limit, source: best.source, basis: best.basis + ' · ограничено сроком сырья ' + _prFmt_(limit), limit: limit };
  return { date: best.date, source: best.source, basis: best.basis, limit: limit };
}

/* ------------------------------------------------------------------ партия п/ф ---- */
/** Новая партия из обработки: паспорт наследует поставщика, накладную, ВСД, этикетку производителя. */
function _prChild_(op, b, pass, o) {
  var who = _author_(op), now = o.now, C = MC_RCV_C_, du = _prDispUnit_(b, pass), k = _toBaseUnitServer_(1, du).qty / (_toBaseUnitServer_(1, b.v[2]).qty || 1) || 1;
  var id = _createBatch_(o.name, b.v[2], o.qtyBase, now, o.exp || '', o.priceBase, o.source, { status: o.status, manufactured: now, supplierBatch: String(b.v[12] || ''), docRef: o.actId });
  var c = _bcFind_(id);
  if (c) {
    c.sh.getRange(c.row, 19).setValue(String(b.v[18] || ''));   // SupplierID — как у сырья
    if (o.exp) c.sh.getRange(c.row, 16).setValue(o.exp.getTime());
    if (o.loc) _mcBlSetLocation_(c, o.loc);
  }
  var prow;
  if (pass) prow = pass.v.slice(); else { prow = []; for (var i = 0; i < MC_RCV_HEAD_.length; i++) prow.push(''); prow[C['Поставщик']] = ''; }
  while (prow.length < MC_RCV_HEAD_.length) prow.push('');
  var set = function (h, v) { prow[C[h]] = v === undefined || v === null ? '' : v; };
  set('BatchID', id); set('Продукт', o.name); set('Кол-во', Math.round(o.qtyBase / k * 1000) / 1000); set('Ед.', du); set('Принято', now);
  set('Годен до', o.exp || ''); set('Срок с часами', o.exp ? 'да' : ''); set('Источник срока', o.expSource); set('Основание срока', o.expBasis);
  set('Принял', who.фио); set('Должность', who.должность); set('ID сотрудника', who.id); set('OperationID', op.id); set('Печатей этикетки', 0); set('Последняя печать', '');
  set('Цена за ед.', Math.round(o.priceBase * k * 100) / 100); set('Стоимость', Math.round(o.priceBase * o.qtyBase * 100) / 100);
  set('ParentBatchID', String(b.v[0])); set('Вскрыто', ''); set('Вскрыл', ''); set('Срок после вскрытия', ''); set('Основание срока после вскрытия', ''); set('Печатей этикетки вскрытия', 0);
  set('Сопоставление', o.kindRu + ' из партии ' + b.v[0] + ' «' + b.v[1] + '»'); set('Обработка', o.kindRu); set('Акт обработки', o.actId);
  set('Разморожено', o.thawed || _prPv_(pass, 'Разморожено') || ''); set('Дефрост начат', ''); set('Дефрост до', '');
  set('Тип хранения', o.storageType || String(_prPv_(pass, 'Тип хранения') || '')); set('Хранить', o.store !== undefined ? o.store : String(_prPv_(pass, 'Хранить') || ''));
  set('Упаковок по фото', ''); set('По накладной', ''); set('Расхождение', ''); set('Обновлено', now); set('Обновил', who.фио);
  _mcRcvSheet_().appendRow(prow.slice(0, MC_RCV_HEAD_.length));
  _mcBlEvent_(op, id, 'BATCH_CREATED', { qty: o.qtyBase, unit: b.v[2], doc: o.actId, reason: o.kindRu + ' из партии ' + b.v[0] + ' «' + b.v[1] + '»' + (o.exp ? ' · годен до ' + _prFmt_(o.exp) : ' · срок не определён'), after: { parent: String(b.v[0]), price: o.priceBase, expirySource: o.expSource } });
  _mcCreateTraceLink_('BATCH', String(b.v[0]), 'ПРЕОБРАЗОВАНА_В', 'BATCH', id, { dateTime: now, actor: who.фио, source: o.actId, weight: o.qtyBase, unit: b.v[2] });
  _bcSheet_('BatchRelations', ['ParentBatch', 'ChildBatch', 'Вес', 'Дата', 'Документ', 'Пользователь']).appendRow([String(b.v[0]), id, o.qtyBase, now, o.actId, who.фио]);
  return id;
}
function _prActId_() { var d = new Date(); return 'PR-' + _mcBlYmd_(d) + '-' + Utilities.getUuid().slice(0, 8); }
function _prActRow_(f) { var r = []; MC_PR_ACT_HEAD_.forEach(function (h) { r.push(f[h] === undefined || f[h] === null ? '' : f[h]); }); return r; }
function _prLineRow_(f) { var r = []; MC_PR_LINE_HEAD_.forEach(function (h) { r.push(f[h] === undefined || f[h] === null ? '' : f[h]); }); return r; }
function _prFindAct_(actId) {
  var sh = _prActs_(), v = sh.getDataRange().getValues();
  for (var i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === String(actId)) { var o = { row: i + 1, sh: sh, v: v[i] }; MC_PR_ACT_HEAD_.forEach(function (h, j) { o[h] = v[i][j]; }); return o; }
  return null;
}
function _prSetAct_(a, fields) { Object.keys(fields).forEach(function (k) { var j = MC_PR_ACT_HEAD_.indexOf(k); if (j >= 0) a.sh.getRange(a.row, j + 1).setValue(fields[k]); }); }

/* ------------------------------------------------------------------ зачистка / разбор ---- */
/**
 * Расчёт обработки без записи: сроки п/ф, цена, баланс, отходы. Используется предпросмотром и проведением.
 * d: { batchId, type: TRIM|CUT, qty, unit, outputs:[{name, qty, unit, waste, reason}] }
 */
function _prCompute_(b, pass, d, now) {
  var errs = [], du = _prDispUnit_(b, pass), remain = _mcBlNum_(b.v[9]);
  var q = d.qty !== '' && d.qty !== undefined && d.qty !== null ? _mcBlToBatchUnit_(d.qty, d.unit || du, b.v[2]) : remain;
  if (!(q > 0)) errs.push('Укажите, сколько берёте в обработку');
  if (q > remain + 0.0005) errs.push('В партии осталось ' + _mcBlQtyText_(remain, b.v[2], du));
  var type = String(d.type || 'TRIM').toUpperCase();
  if (!MC_PR_TYPE_RU_[type] || type === 'DEFROST') errs.push('Вид обработки: зачистка или разбор');
  var outs = (d.outputs || []).filter(function (o) { return o && String(o.name || '').trim() && _mcBlNum_(o.qty) > 0; }).map(function (o) {
    return { name: _cleanProdName_(String(o.name).trim()), qtyBase: _mcBlToBatchUnit_(o.qty, o.unit || du, b.v[2]), waste: o.waste === true || o.waste === 'true', reason: String(o.reason || '').trim(), loc: o.location || '' };
  });
  var prods = outs.filter(function (o) { return !o.waste; }), wastes = outs.filter(function (o) { return o.waste; });
  if (!prods.length) errs.push('Укажите, что получилось (п/ф и вес)');
  if (type === 'TRIM' && prods.length > 1) errs.push('Зачистка: на выходе один продукт и отходы. Несколько п/ф — это «Разбор»');
  var sum = outs.reduce(function (a, o) { return a + o.qtyBase; }, 0), tol = Math.max(q * MC_PR_TOL_PCT_ / 100, 0.0005);
  var disp = function (x) { return _mcBlQtyText_(x, b.v[2], du); };
  if (q > 0 && Math.abs(sum - q) > tol) errs.push('Баланс веса не сходится: взято ' + disp(q) + ', выход + отходы = ' + disp(sum) + ' (расхождение ' + disp(Math.abs(sum - q)) + ', допустимо ' + MC_PR_TOL_PCT_ + ' %). ' +
    (sum < q ? 'Добавьте строку отходов (жилы, плёнка, обрезь) или исправьте веса' : 'Исправьте веса'));
  var price = _mcBlUnitPrice_(b), cost = Math.round(price * q * 100) / 100, P = prods.reduce(function (a, o) { return a + o.qtyBase; }, 0);
  var pPrice = P > 0 ? cost / P : price, waste = wastes.reduce(function (a, o) { return a + o.qtyBase; }, 0), wastePct = q > 0 ? Math.round(waste / q * 1000) / 10 : 0;
  var norm = null; try { norm = JSON.parse(getWasteNorm(String(b.v[1]))); } catch (e) {}
  prods.forEach(function (o) { o.exp = _prExpiryFor_(b, pass, o.name, now); });
  return { errors: errs, type: type, typeRu: MC_PR_TYPE_RU_[type] || type, q: q, outs: outs, prods: prods, wastes: wastes, cost: cost, priceBase: price, pPriceBase: pPrice,
    waste: waste, wastePct: wastePct, norm: norm, review: !!(norm && wastePct > norm.maxWastePercent), yieldPct: q > 0 ? Math.round(P / q * 1000) / 10 : 0, disp: disp, du: du };
}
function _prSourceCheck_(b, pass, st) {
  if (!st.usable) return 'Обрабатывать можно только допущенную партию (входной контроль пройден, ВСД погашен, срок не истёк). Сейчас: ' + st.statusRu;
  if (_prFrozen_(b, pass)) return 'Партия заморожена — сначала дефрост (ККТ 4)';
  return '';
}
/** Предпросмотр: что получится, сроки п/ф, цена, отходы — ничего не записывает. */
function mcProcessPreview(json, token) {
  try {
    _mcBlAuth_(token, ['stock', 'kanban']);
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), b = _bcFind_(d.batchId); if (!b) return _fail_('NOT_FOUND', 'Партия не найдена');
    var pass = _mcBlPass_(d.batchId), st = _mcBlState_(b, pass, _mcBlEvents_(d.batchId)), now = new Date(), r = _prCompute_(b, pass, d, now), bad = _prSourceCheck_(b, pass, st);
    if (bad) r.errors.unshift(bad);
    return _ok_({ errors: r.errors, type: r.typeRu, taken: r.disp(r.q), cost: r.cost, yieldPct: r.yieldPct, wastePct: r.wastePct, norm: r.norm, review: r.review,
      outputs: r.outs.map(function (o) { return { name: o.name, qty: r.disp(o.qtyBase), waste: o.waste, reason: o.reason, price: o.waste ? 0 : Math.round(r.pPriceBase * _prToDisp_(1, b, pass).k * 100) / 100 + ' ₽/' + r.du,
        expiry: o.exp ? (o.exp.date ? _prFmt_(o.exp.date) : 'НЕ ОПРЕДЕЛЁН') : '', expirySource: o.exp ? o.exp.source : '', basis: o.exp ? o.exp.basis : '' }; }) });
  } catch (e) { return _failFrom_(e); }
}
/** Ядро проведения зачистки/разбора (вызывается под блокировкой). */
function _prProcess_(op, d) {
  var b = _bcFind_(d.batchId); if (!b) throw new Error('NOT_FOUND: партия «' + d.batchId + '» не найдена');
  var pass = _mcBlPass_(d.batchId), st = _mcBlState_(b, pass, _mcBlEvents_(d.batchId)), now = new Date(), bad = _prSourceCheck_(b, pass, st);
  if (bad) return { fail: _fail_('BATCH_STATE', bad, op.id) };
  var r = _prCompute_(b, pass, d, now);
  if (r.errors.length) return { fail: _fail_('VALIDATION', r.errors.join('; '), op.id) };
  if (!(d.fefoAck === true || d.fefoAck === 'true')) {
    var card = _mcBlCard_(d.batchId, op.session), first = (card.fefo || [])[0];
    if (first && first.batchId !== String(d.batchId) && first.ts < ((st.expiry && st.expiry.getTime()) || 9e15))
      return { fail: _fail_('FEFO', 'По FEFO сначала партия ' + first.batchId + ' (годен до ' + first.expiry + (first.location ? ', ' + first.location : '') + '). Обработать эту партию всё равно?', op.id) };
  }
  var who = _author_(op), actId = _prActId_(), label = MC_PR_TYPE_RU_[r.type] + ' ' + actId, children = [], holds = [];
  var t = _mcBlTake_(b, r.q);
  if (t.remain <= 0.0005) { b.sh.getRange(b.row, 11).setValue('consumed'); b.v[10] = 'consumed'; }
  _logStockOp_('Расход', b.v[1], r.q, b.v[2], r.priceBase, label, r.typeRu + ' партии ' + b.v[0]);
  var lsh = _prLines_(), lrows = [];
  r.prods.forEach(function (o) {
    var status = o.exp.date ? 'active' : 'hold';
    var id = _prChild_(op, b, pass, { now: now, name: o.name, qtyBase: o.qtyBase, priceBase: r.pPriceBase, exp: o.exp.date, expSource: o.exp.source, expBasis: o.exp.basis, status: status,
      source: label, actId: actId, kindRu: r.typeRu, loc: o.loc || String(b.v[14] || '') });
    _logStockOp_('Приход', o.name, o.qtyBase, b.v[2], r.pPriceBase, label, 'п/ф из партии ' + b.v[0]);
    children.push(id); if (status === 'hold') holds.push(id + ' «' + o.name + '»');
    lrows.push(_prLineRow_({ 'АктID': actId, 'Тип': 'product', 'Название': o.name, 'Вес': o.qtyBase, 'НовыйBatchID': id, 'Ед.': b.v[2], 'Годен до': o.exp.date || '', 'Источник срока': o.exp.source, 'Основание срока': o.exp.basis,
      'Цена за ед.': Math.round(r.pPriceBase * 10000) / 10000 }));
  });
  r.wastes.forEach(function (o, i) {
    var wid = actId + '-W' + (i + 1);
    _mcCreateTraceLink_('BATCH', String(b.v[0]), 'ОТХОДЫ_ОБРАБОТКИ', 'WASTE', wid, { actor: who.фио, source: actId, weight: o.qtyBase, unit: b.v[2] });
    lrows.push(_prLineRow_({ 'АктID': actId, 'Тип': 'waste', 'Название': o.name, 'Вес': o.qtyBase, 'Ед.': b.v[2], 'Причина': o.reason || 'отходы обработки' }));
  });
  if (lrows.length) lsh.getRange(lsh.getLastRow() + 1, 1, lrows.length, MC_PR_LINE_HEAD_.length).setValues(lrows);
  _mcBlEvent_(op, String(b.v[0]), 'PROCESSED', { qty: r.q, unit: b.v[2], doc: actId, reason: r.typeRu + ': ' + r.prods.map(function (o) { return o.name + ' ' + r.disp(o.qtyBase); }).join(', ') +
    (r.wastes.length ? ' · отходы ' + r.disp(r.waste) + ' (' + r.wastePct + ' %)' : ''), before: { remain: t.remainBefore }, after: { remain: t.remain, children: children } });
  if (r.wastes.length) _mcBlEvent_(op, String(b.v[0]), 'PROCESSING_WASTE', { qty: r.waste, unit: b.v[2], doc: actId, reason: r.wastes.map(function (o) { return o.name + (o.reason ? ' (' + o.reason + ')' : '') + ' ' + r.disp(o.qtyBase); }).join(', ') });
  _prActs_().appendRow(_prActRow_({ 'ID': actId, 'Дата': now, 'ПартияИсточник': String(b.v[0]), 'Продукт': b.v[1], 'ИсходныйВес': t.remainBefore, 'ЕдИзм': b.v[2],
    'Статус': r.review ? 'Требует проверки' : 'Проведён', 'Сотрудник': who.фио, 'СуммаВыход': r.q - r.waste, 'СуммаОтход': r.waste, 'ПроцентОтход': r.wastePct, 'НормаПроцент': r.norm ? r.norm.maxWastePercent : '',
    'ТребуетПроверки': r.review, 'Создано': now, 'Тип': r.type, 'Взято': r.q, 'OperationID': op.id, 'EmployeeID': who.id, 'Роль': who.роль, 'Себестоимость': r.cost,
    'Цена п/ф за ед.': Math.round(r.pPriceBase * 10000) / 10000, 'Выход %': r.yieldPct, 'Партии п/ф': children.join(','), 'Место': String(b.v[14] || '') }));
  if (d.saveTemplate) try {
    var tsh = _disassemblyTemplatesSheet_(), tv = tsh.getDataRange().getValues(), tl = JSON.stringify(r.outs.map(function (o) { return { name: o.name, isWaste: o.waste }; })), tr = 0;
    for (var ti = 1; ti < tv.length; ti++) if (String(tv[ti][0]) === String(d.saveTemplate)) tr = ti + 1;
    if (tr) tsh.getRange(tr, 2, 1, 2).setValues([[String(b.v[1]), tl]]); else tsh.appendRow([String(d.saveTemplate), String(b.v[1]), tl, new Date()]);
  } catch (e) {}
  if (r.review) _notify_('processing_review', 'warning', 'Превышена норма отходов: ' + b.v[1], 'Акт ' + actId + ': отходы ' + r.wastePct + ' % при норме ' + r.norm.maxWastePercent + ' %. Проверьте разбор.', 'Шеф-повар', 'proc|' + actId, op);
  if (holds.length) _notify_('processing_expiry', 'warning', 'П/ф без срока — нужно решение', holds.join(', ') + ': срок не определён. Партии не допущены до решения ответственного HACCP.', 'Шеф-повар', 'prochold|' + actId, op);
  _audit_(op, 'BATCH_PROCESS', 'Партия', String(b.v[0]), { remain: t.remainBefore }, { act: actId, type: r.type, taken: r.q, unit: b.v[2], children: children, wastePct: r.wastePct, norm: r.norm ? r.norm.maxWastePercent : '', cost: r.cost, holds: holds });
  return { actId: actId, children: children, holds: holds, r: r, b: b };
}
/** ЗАЧИСТКА / РАЗБОР: партия сырья → партии п/ф + отходы, одна операция. */
function mcProcessBatch(json, token) {
  var op = null, d = {};
  try { d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}); op = _mcBlOp_(token, ['stock', 'kanban'], 'BATCH_PROCESS', d.batchId); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var res = _prProcess_(op, d);
      if (res.fail) { _endOp_(op, 'FAILED'); return res.fail; }
      _endOp_(op);
      return _ok_({ actId: res.actId, type: res.r.typeRu, children: res.children.map(function (id) { return _mcBlLabelData_(id, 'receipt'); }), holds: res.holds,
        wastePct: res.r.wastePct, norm: res.r.norm ? res.r.norm.maxWastePercent : null, review: res.r.review, yieldPct: res.r.yieldPct, cost: res.r.cost,
        note: res.r.review ? 'Отходы ' + res.r.wastePct + ' % — выше нормы ' + res.r.norm.maxWastePercent + ' %: акт отмечен «Требует проверки».' : '' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Прежний вызов разбора (экран Mon Cher): теперь с проверками партии, сроками п/ф и сотрудником из сессии. */
function _prLegacyDisassembly_(dataJson, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'PRODUCTION_DISASSEMBLY', 'Разбор сырья', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var data = JSON.parse(dataJson || '{}'); if (!data.sourceBatchId) { _endOp_(op, 'FAILED'); return JSON.stringify({ success: false, error: 'no-batch' }); }
    var b = _bcFind_(data.sourceBatchId); if (!b) { _endOp_(op, 'FAILED'); return JSON.stringify({ success: false, error: 'batch-not-found' }); }
    var lines = (data.lines || []).filter(function (l) { return l.name && parseFloat(l.weight) > 0; });
    if (!lines.length) { _endOp_(op, 'FAILED'); return JSON.stringify({ success: false, error: 'no-lines' }); }
    var sum = lines.reduce(function (a, l) { return a + parseFloat(l.weight); }, 0);
    return _withLock_(function () {
      var res = _prProcess_(op, { batchId: data.sourceBatchId, type: 'CUT', qty: sum, unit: b.v[2], fefoAck: true,
        outputs: lines.map(function (l) { return { name: l.name, qty: l.weight, unit: b.v[2], waste: !!l.isWaste }; }) });
      if (res.fail) { _endOp_(op, 'FAILED'); var f = JSON.parse(res.fail); return JSON.stringify({ success: false, error: f.error.code, message: f.error.message }); }
      _endOp_(op);
      return JSON.stringify({ ok: true, actId: res.actId, totalOutput: res.r.q - res.r.waste, totalWaste: res.r.waste, wastePercent: res.r.wastePct, normPercent: res.r.norm ? res.r.norm.maxWastePercent : null,
        requiresReview: res.r.review, deviationMessage: res.r.review ? 'Отходы ' + res.r.wastePct + ' % выше нормы ' + res.r.norm.maxWastePercent + ' %' : '', newBatchIds: res.children });
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return JSON.stringify({ success: false, error: String(e && e.message || e) }); }
}

/* ------------------------------------------------------------------ дефрост ---- */
function _prMeasure_(op, b, t, equipmentId, final, cfg, actId) {
  var who = _author_(op), res = cfg.coreMax === null ? 'NO_RANGE' : t <= cfg.coreMax ? 'OK' : 'DEVIATION', id = 'DM-' + Date.now() + '-' + Utilities.getUuid().slice(0, 4);
  var m = null; try { m = _tMirror_({ type: 'DEFROST', object: String(b.v[1]), objectId: String(b.v[0]), equipmentId: equipmentId || '', min: null, max: cfg.coreMax, value: t, batchId: String(b.v[0]), source: 'дефрост', op: op.id }, op.session); } catch (e) {}
  var devId = '';
  if (res === 'DEVIATION') devId = _bcDeviation_(String(b.v[0]), b.v[1], 'Дефрост «' + b.v[1] + '»: t° в толще ' + t + ' °C выше нормы ' + cfg.coreMax + ' °C', t, op.session);
  _prMeas_().appendRow([id, String(b.v[0]), actId || '', new Date(), t, cfg.coreMax === null ? '' : cfg.coreMax, res, final ? 'да' : '', who.фио, who.роль, equipmentId || '', op.id, m && m.factId || '', devId]);
  _mcBlEvent_(op, String(b.v[0]), 'DEFROST_MEASURE', { qty: t, unit: '°C', reason: (final ? 'итоговый замер' : 'замер') + ' t° в толще' + (res === 'NO_RANGE' ? ' (норма не задана — оценивает ответственный)' : res === 'OK' ? ' — в норме' : ' — ВЫШЕ НОРМЫ'), result: res, doc: id });
  return { id: id, result: res, deviationId: devId };
}
function _prMeasList_(batchId) {
  var v = _prMeas_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) if (String(v[i][1]) === String(batchId)) out.push({ id: v[i][0], at: _mcBlDate_(v[i][3]), t: v[i][4], limit: v[i][5], result: v[i][6], final: v[i][7] === 'да', who: v[i][8] });
  return out;
}
function _prEquipCheck_(equipmentId) {
  if (equipmentId) { var u = _mcEquipmentUsable_(equipmentId); if (!u.ok) return 'Измерение не принимается — ' + u.reason; return ''; }
  try { if (_mcEqList_().some(function (x) { return x.measuring && x.effective === 'ACTIVE'; })) return 'Выберите термометр-щуп, которым измеряли (из реестра приборов)'; } catch (e) {}
  return '';
}
function _prDefrostAct_(batchId) {
  var sh = _prActs_(), v = sh.getDataRange().getValues();
  for (var i = v.length - 1; i >= 1; i--) if (String(v[i][MC_PR_ACT_HEAD_.indexOf('Тип')]) === 'DEFROST' && String(v[i][MC_PR_ACT_HEAD_.indexOf('Партии п/ф')]) === String(batchId)) return _prFindAct_(v[i][0]);
  return null;
}
/** ДЕФРОСТ — начать: часть или вся замороженная партия переносится в холодильник; срок дефроста — не более MC_DEFROST_MAX_H. */
function mcDefrostStart(json, token) {
  var op = null, d = {};
  try { d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}); op = _mcBlOp_(token, ['stock', 'kanban'], 'DEFROST_START', d.batchId); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var b = _bcFind_(d.batchId); if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
      var pass = _mcBlPass_(d.batchId), st = _mcBlState_(b, pass, _mcBlEvents_(d.batchId)), cfg = _prCfg_();
      if (!st.usable) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Размораживать можно только допущенную партию со сроком (сейчас: ' + st.statusRu + ')', op.id); }
      if (_prPv_(pass, 'Разморожено')) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Партия уже разморожена ' + _prFmt_(_mcBlDate_(_prPv_(pass, 'Разморожено'))), op.id); }
      if (!_prFrozen_(b, pass)) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Партия не заморожена (тип хранения не «морозильник») — дефрост не нужен', op.id); }
      var fridges = _mcBlLocations_().filter(function (l) { return l.active && l.type === 'FRIDGE'; }), loc = d.locationId ? _mcBlLoc_(d.locationId) : null;
      if (d.locationId && (!loc || !loc.active)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Место не найдено', op.id); }
      if (loc && loc.type !== 'FRIDGE') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Размораживание — только в холодильнике (' + cfg.basis + '). «' + loc.name + '» — ' + (MC_BL_TYPE_RU_[loc.type] || loc.type), op.id); }
      if (!loc && fridges.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите холодильник, в котором размораживается продукт', op.id); }
      var du = _prDispUnit_(b, pass), q = d.qty ? _mcBlToBatchUnit_(d.qty, d.unit || du, b.v[2]) : _mcBlNum_(b.v[9]);
      if (!(q > 0) || q > _mcBlNum_(b.v[9]) + 0.0005) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Количество — больше нуля и не больше остатка ' + _mcBlQtyText_(b.v[9], b.v[2], du), op.id); }
      var target = q < _mcBlNum_(b.v[9]) - 0.0005 ? _mcBlSplitCore_(op, b, q, 'дефрост части партии' + (d.packs ? ' (' + d.packs + ' уп.)' : '')) : b;
      var tid = String(target.v[0]), tpass = _mcBlPass_(tid), now = new Date(), until = new Date(now.getTime() + cfg.maxH * 3600000), who = _author_(op), actId = _prActId_();
      target.sh.getRange(target.row, 11).setValue('defrost'); target.v[10] = 'defrost';
      var from = String(target.v[14] || '');
      if (loc) _mcBlSetLocation_(target, loc.id);
      if (tpass) _mcBlPassSet_(tpass, { 'Дефрост начат': now, 'Дефрост до': until, 'Акт обработки': actId, 'Обновлено': now, 'Обновил': who.фио });
      _prActs_().appendRow(_prActRow_({ 'ID': actId, 'Дата': now, 'ПартияИсточник': String(b.v[0]), 'Продукт': b.v[1], 'ИсходныйВес': _mcBlNum_(target.v[9]), 'ЕдИзм': b.v[2], 'Статус': 'Идёт дефрост',
        'Сотрудник': who.фио, 'Создано': now, 'Тип': 'DEFROST', 'Взято': _mcBlNum_(target.v[9]), 'OperationID': op.id, 'EmployeeID': who.id, 'Роль': who.роль, 'Партии п/ф': tid,
        'Дефрост начат': now, 'Дефрост до': until, 'Место': loc ? loc.id : '', 'Детали': d.packs ? d.packs + ' уп.' : '' }));
      var ev = _mcBlEvent_(op, tid, 'DEFROST_START', { qty: _mcBlNum_(target.v[9]), unit: target.v[2], from: from, to: loc ? loc.id : '', doc: actId,
        reason: 'в ' + (loc ? '«' + loc.name + '»' : 'место не указано') + ' · завершить до ' + _prFmt_(until) + ' (не более ' + cfg.maxH + ' ч) · замер t° в толще каждые ' + cfg.measureH + ' ч' });
      if (loc) _mcCreateTraceLink_('BATCH', tid, 'DEFROST', 'LOCATION', loc.id, { factId: ev, actor: who.фио, source: 'DEFROST', weight: _mcBlNum_(target.v[9]), unit: target.v[2] });
      _audit_(op, 'DEFROST_START', 'Партия', tid, { status: 'active', location: from }, { status: 'defrost', location: loc ? loc.id : '', until: _prFmt_(until), act: actId });
      _endOp_(op);
      return _ok_({ batchId: tid, split: target !== b, actId: actId, startedAt: _prFmt_(now), until: _prFmt_(until), nextMeasure: _prFmt_(new Date(now.getTime() + cfg.measureH * 3600000)),
        location: loc ? loc.name : '', note: loc ? '' : 'Места хранения не заведены — укажите холодильник в «Местах хранения»' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Замер t° в толще продукта во время дефроста (человек вводит измеренное значение). */
function mcDefrostMeasure(json, token) {
  var op = null, d = {};
  try { d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}); op = _mcBlOp_(token, ['stock', 'kanban'], 'DEFROST_MEASURE', d.batchId); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var b = _bcFind_(d.batchId); if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
      if (String(b.v[10]) !== 'defrost') { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Дефрост по этой партии не идёт', op.id); }
      var t = _bcNum_(d.temperature), cfg = _prCfg_();
      if (t === null || t < -40 || t > 40) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Введите измеренную температуру в толще продукта (°C)', op.id); }
      var eq = _prEquipCheck_(d.equipmentId); if (eq) { _endOp_(op, 'FAILED'); return _fail_('EQUIPMENT_BLOCKED', eq, op.id); }
      var a = _prDefrostAct_(d.batchId), m = _prMeasure_(op, b, t, d.equipmentId, false, cfg, a ? a['ID'] : '');
      if (m.result === 'DEVIATION') { _mcBlockObject_('BATCH', String(b.v[0]), 'Дефрост: t° в толще ' + t + ' °C выше нормы ' + cfg.coreMax + ' °C', { deviationId: m.deviationId, actor: _author_(op).фио });
        _mcBlEvent_(op, String(b.v[0]), 'DEFROST_DEVIATION', { reason: 'ККТ 4: t° в толще ' + t + ' °C выше ' + cfg.coreMax + ' °C — партия заблокирована до решения ответственного', result: 'BLOCKED' }); }
      _audit_(op, 'DEFROST_MEASURE', 'Партия', String(b.v[0]), null, { t: t, result: m.result, limit: cfg.coreMax, deviation: m.deviationId });
      _endOp_(op);
      return _ok_({ batchId: String(b.v[0]), result: m.result, blocked: m.result === 'DEVIATION', nextMeasure: _prFmt_(new Date(Date.now() + cfg.measureH * 3600000)) }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** ДЕФРОСТ — завершить: итоговый замер, проверка 12 ч, срок после размораживания, вес после (потери). */
function mcDefrostFinish(json, token) {
  var op = null, d = {};
  try { d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}); op = _mcBlOp_(token, ['stock', 'kanban'], 'DEFROST_FINISH', d.batchId); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var b = _bcFind_(d.batchId); if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
      if (String(b.v[10]) !== 'defrost') { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Дефрост по этой партии не идёт', op.id); }
      var t = _bcNum_(d.temperature), cfg = _prCfg_(), pass = _mcBlPass_(d.batchId), du = _prDispUnit_(b, pass);
      if (t === null || t < -40 || t > 40) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Итоговый замер: введите t° в толще продукта (°C)', op.id); }
      var eq = _prEquipCheck_(d.equipmentId); if (eq) { _endOp_(op, 'FAILED'); return _fail_('EQUIPMENT_BLOCKED', eq, op.id); }
      var after = d.weightAfter !== undefined && d.weightAfter !== '' && d.weightAfter !== null ? _mcBlToBatchUnit_(d.weightAfter, d.unit || du, b.v[2]) : null, remain = _mcBlNum_(b.v[9]);
      if (after !== null && (after <= 0 || after > remain + 0.0005)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Вес после размораживания — больше нуля и не больше ' + _mcBlQtyText_(remain, b.v[2], du), op.id); }
      var a = _prDefrostAct_(d.batchId), now = new Date(), who = _author_(op), started = _mcBlDate_(_prPv_(pass, 'Дефрост начат')) || (a ? _mcBlDate_(a['Дефрост начат']) : null);
      var hours = started ? Math.round((now - started) / 360000) / 10 : null, m = _prMeasure_(op, b, t, d.equipmentId, true, cfg, a ? a['ID'] : '');
      var reasons = [];
      if (hours !== null && hours > cfg.maxH) reasons.push('размораживание ' + hours + ' ч — больше ' + cfg.maxH + ' ч');
      if (m.result === 'DEVIATION') reasons.push('t° в толще ' + t + ' °C выше нормы ' + cfg.coreMax + ' °C');
      var loss = after !== null ? Math.round((remain - after) * 1000) / 1000 : 0;
      if (loss > 0.0005) { _mcBlTake_(b, loss); _logStockOp_('Расход', b.v[1], loss, b.v[2], _mcBlUnitPrice_(b), 'Дефрост ' + (a ? a['ID'] : ''), 'потеря массы при размораживании');
        _mcBlEvent_(op, String(b.v[0]), 'PROCESSING_WASTE', { qty: loss, unit: b.v[2], doc: a ? a['ID'] : '', reason: 'потеря массы при размораживании ' + _mcBlQtyText_(loss, b.v[2], du) });
        _mcCreateTraceLink_('BATCH', String(b.v[0]), 'ОТХОДЫ_ОБРАБОТКИ', 'WASTE', (a ? a['ID'] : 'DEF') + '-W1', { actor: who.фио, source: 'DEFROST', weight: loss, unit: b.v[2] }); }
      var ad = _prAfterDefrost_(b, pass), limit = _prLimit_(b, pass), exp = null, basis = '', src = ad.source;
      if (ad.hours) { exp = new Date(now.getTime() + ad.hours * 3600000); basis = ad.basis + ' — разморожено ' + _prFmt_(now); if (limit && limit < exp) { exp = limit; basis += ' · ограничено сроком производителя ' + _prFmt_(limit); } }
      else basis = 'НЕ ОПРЕДЕЛЁН — на этикетке нет срока «после размораживания» и срок продукта не утверждён; нужно решение ответственного HACCP';
      var loc = b.v[14] ? _mcBlLoc_(b.v[14]) : null;
      b.sh.getRange(b.row, 6).setValue(exp || ''); b.v[5] = exp || ''; b.sh.getRange(b.row, 16).setValue(exp ? exp.getTime() : Number.MAX_SAFE_INTEGER);
      var status = reasons.length ? 'blocked' : exp ? 'active' : 'hold';
      b.sh.getRange(b.row, 11).setValue(status); b.v[10] = status;
      if (pass) _mcBlPassSet_(pass, { 'Разморожено': now, 'Тип хранения': 'FRIDGE', 'Хранить': loc ? _mcBlRange_(loc.tmin, loc.tmax) : _prPv_(pass, 'Хранить'), 'Годен до': exp || '', 'Срок с часами': exp ? 'да' : '',
        'Источник срока': src, 'Основание срока': basis, 'Обработка': 'Дефрост', 'Обновлено': now, 'Обновил': who.фио });
      if (reasons.length) {
        var dev = _bcDeviation_(String(b.v[0]), b.v[1], 'ККТ 4 «Размораживание» нарушена: ' + reasons.join('; '), hours, op.session);
        _mcBlockObject_('BATCH', String(b.v[0]), 'ККТ 4: ' + reasons.join('; '), { deviationId: dev, actor: who.фио });
        _mcBlEvent_(op, String(b.v[0]), 'DEFROST_DEVIATION', { reason: 'ККТ 4: ' + reasons.join('; ') + ' — партия заблокирована до решения ответственного', result: 'BLOCKED' });
        _notify_('defrost_deviation', 'critical', 'Дефрост: нарушение ККТ 4 — ' + b.v[1], b.v[0] + ': ' + reasons.join('; ') + '. Партия заблокирована.', 'Шеф-повар', 'defdev|' + b.v[0], op);
      }
      _mcBlEvent_(op, String(b.v[0]), 'DEFROST_FINISH', { qty: _mcBlNum_(b.v[9]), unit: b.v[2], doc: a ? a['ID'] : '', reason: 'разморожено за ' + (hours === null ? '?' : hours) + ' ч · t° в толще ' + t + ' °C' + (loss > 0 ? ' · потеря ' + _mcBlQtyText_(loss, b.v[2], du) : '') + ' · повторная заморозка запрещена',
        after: { status: status, expiry: exp ? _prFmt_(exp) : '', source: src } });
      if (exp) _mcBlEvent_(op, String(b.v[0]), 'RECALCULATE_EXPIRY', { reason: basis, after: { expiry: _prFmt_(exp), source: src } });
      if (status === 'hold') _notify_('processing_expiry', 'warning', 'Срок после размораживания не определён — ' + b.v[1], b.v[0] + ': нужно решение ответственного HACCP.', 'Шеф-повар', 'defhold|' + b.v[0], op);
      if (a) _prSetAct_(a, { 'Статус': reasons.length ? 'Отклонение ККТ 4' : 'Проведён', 'Дефрост окончен': now, 'СуммаОтход': loss > 0 ? loss : 0, 'СуммаВыход': _mcBlNum_(b.v[9]), 'Детали': (a['Детали'] ? a['Детали'] + ' · ' : '') + hours + ' ч, t° ' + t + ' °C' });
      _audit_(op, 'DEFROST_FINISH', 'Партия', String(b.v[0]), { status: 'defrost' }, { status: status, hours: hours, t: t, loss: loss, expiry: exp ? _prFmt_(exp) : '', source: src, reasons: reasons });
      _endOp_(op);
      return _ok_({ batchId: String(b.v[0]), status: status, blocked: !!reasons.length, reasons: reasons, hours: hours, expiry: exp ? _prFmt_(exp) : '', basis: basis, label: _mcBlLabelData_(String(b.v[0]), 'receipt') }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Решение ответственного HACCP: срок п/ф или срок после размораживания (часы + основание), при желании — правило продукта. */
function mcSetProcessedExpiry(json, token) {
  var op = null, d = {};
  try { d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}); op = _beginOp_(token, 'haccp', 'EXPIRY_DECISION', 'Партия', d.batchId || null, null); } catch (e) { return _failFrom_(e); }
  try {
    var h = _mcBlNum_(d.hours), basis = String(d.basis || '').trim();
    if (!(h > 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите срок в часах', op.id); }
    if (!basis) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите основание (ТИ, документ производителя, решение HACCP-группы)', op.id); }
    return _withLock_(function () {
      var b = _bcFind_(d.batchId); if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена', op.id); }
      if (String(b.v[10]) !== 'hold') { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Партия не ждёт решения по сроку', op.id); }
      var pass = _mcBlPass_(d.batchId), who = _author_(op), defrost = String(_prPv_(pass, 'Обработка')) === 'Дефрост';
      var base = _mcBlDate_(defrost ? _prPv_(pass, 'Разморожено') : _prPv_(pass, 'Принято')) || new Date(), exp = new Date(base.getTime() + h * 3600000);
      var parent = _prPv_(pass, 'ParentBatchID') ? _bcFind_(_prPv_(pass, 'ParentBatchID')) : null, limit = parent ? _prLimit_(parent, _mcBlPass_(parent.v[0])) : _prEod_(_mcBlDate_(_prPv_(pass, 'Срок производителя')));
      if (defrost) limit = _prEod_(_mcBlDate_(_prPv_(pass, 'Срок производителя')));
      var txt = 'решение ответственного (' + who.фио + '): ' + h + ' ч — ' + basis;
      if (limit && limit < exp) { exp = limit; txt += ' · ограничено сроком сырья ' + _prFmt_(limit); }
      b.sh.getRange(b.row, 6).setValue(exp); b.sh.getRange(b.row, 16).setValue(exp.getTime()); b.sh.getRange(b.row, 11).setValue('active');
      if (pass) _mcBlPassSet_(pass, { 'Годен до': exp, 'Срок с часами': 'да', 'Источник срока': 'HACCP_DECISION', 'Основание срока': txt, 'Обновлено': new Date(), 'Обновил': who.фио });
      if (d.applyToProduct === true || d.applyToProduct === 'true') _mcBlProfileSet_(String(b.v[1]), String(b.v[17] || ''), defrost ? { afterDefrostH: h, afterDefrostBasis: basis + ' — утвердил ' + who.фио } : { shelfH: h, shelfBasis: basis + ' — утвердил ' + who.фио }, who.фио);
      _mcBlEvent_(op, String(b.v[0]), 'EXPIRY_DECISION', { reason: txt, after: { expiry: _prFmt_(exp), status: 'active' } });
      _audit_(op, 'EXPIRY_DECISION', 'Партия', String(b.v[0]), { status: 'hold' }, { expiry: _prFmt_(exp), hours: h, basis: basis, product: d.applyToProduct === true || d.applyToProduct === 'true' });
      _endOp_(op);
      return _ok_({ batchId: String(b.v[0]), expiry: _prFmt_(exp), label: _mcBlLabelData_(String(b.v[0]), 'receipt') }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Правила п/ф и дефроста продукта (ответственный HACCP): срок с этикетки сырья да/нет, срок п/ф, срок после размораживания, длительность дефроста. */
function mcSaveProcessingProfile(json, token) {
  var op = null, d = {};
  try { d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}); op = _beginOp_(token, 'haccp', 'PROCESSING_PROFILE', 'Профиль продукта', d.name || null, null); } catch (e) { return _failFrom_(e); }
  try {
    var name = String(d.name || '').trim(); if (!name) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите продукт / п/ф', op.id); }
    var f = {}, who = _author_(op);
    if (d.inheritLabel === true || d.inheritLabel === false || d.inheritLabel === 'да' || d.inheritLabel === 'нет') f.inheritLabel = d.inheritLabel === true || d.inheritLabel === 'да';
    if (d.shelfH !== undefined && d.shelfH !== '') { if (!String(d.shelfBasis || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Срок п/ф: укажите основание', op.id); } f.shelfH = _mcBlNum_(d.shelfH); f.shelfBasis = String(d.shelfBasis).trim() + ' — утвердил ' + who.фио; }
    if (d.afterDefrostH !== undefined && d.afterDefrostH !== '') { if (!String(d.afterDefrostBasis || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Срок после размораживания: укажите основание', op.id); } f.afterDefrostH = _mcBlNum_(d.afterDefrostH); f.afterDefrostBasis = String(d.afterDefrostBasis).trim() + ' — утвердил ' + who.фио; }
    if (d.defrostH !== undefined && d.defrostH !== '') { var dh = _mcBlNum_(d.defrostH), mx = _prCfg_().maxH; if (!(dh > 0) || dh > mx) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Длительность дефроста — от 0 до ' + mx + ' ч (ККТ 4)', op.id); } f.defrostH = dh; }
    var p = _withLock_(function () { return _mcBlProfileSet_(name, '', f, who.фио); });
    _audit_(op, 'PROCESSING_PROFILE', 'Профиль продукта', name, null, f);
    _endOp_(op);
    return _ok_({ name: name, inheritLabel: _prInherit_(name), shelfH: p.shelfH, afterDefrostH: p.afterDefrostH, defrostH: p.defrostH }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function mcSaveProcessingSettings(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp', 'PROCESSING_SETTINGS', 'Обработка сырья', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), p = PropertiesService.getScriptProperties(), ch = {};
    [['maxH', 'MC_DEFROST_MAX_H'], ['measureH', 'MC_DEFROST_MEASURE_H'], ['coreMax', 'MC_DEFROST_CORE_MAX'], ['prodStart', 'MC_PRODUCTION_START'], ['basis', 'MC_DEFROST_BASIS']].forEach(function (x) {
      if (d[x[0]] === undefined) return; var v = String(d[x[0]]).trim();
      if (x[0] !== 'basis' && x[0] !== 'prodStart' && v !== '' && !isFinite(parseFloat(v.replace(',', '.')))) throw new Error('VALIDATION: ' + x[1] + ' — число');
      if (x[0] === 'prodStart' && v && !/^\d{1,2}:\d{2}$/.test(v)) throw new Error('VALIDATION: время начала производства — ЧЧ:ММ');
      if (v === '') p.deleteProperty(x[1]); else p.setProperty(x[1], v); ch[x[1]] = v;
    });
    _audit_(op, 'PROCESSING_SETTINGS', 'Обработка сырья', '', null, ch);
    _endOp_(op);
    return _ok_(_prCfg_(), op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ------------------------------------------------------------------ данные экрана ---- */
function _prRunning_() {
  var cfg = _prCfg_(), v = _stockBatchesSheet_().getDataRange().getValues(), now = new Date(), out = [];
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][10]) !== 'defrost') continue;
    var id = String(v[i][0]), pass = _mcBlPass_(id), start = _mcBlDate_(_prPv_(pass, 'Дефрост начат')), until = _mcBlDate_(_prPv_(pass, 'Дефрост до')), ms = _prMeasList_(id), last = ms.slice(-1)[0];
    var next = new Date(((last && last.at) || start || now).getTime() + cfg.measureH * 3600000);
    out.push({ batchId: id, product: v[i][1], qty: _mcBlQtyText_(v[i][9], v[i][2], _prPv_(pass, 'Ед.')), started: _prFmt_(start), until: _prFmt_(until), overdue: !!(until && now > until),
      nextMeasure: _prFmt_(next), measureOverdue: now > next, location: _mcBlLocName_(v[i][14]), hours: start ? Math.round((now - start) / 360000) / 10 : null,
      measurements: ms.map(function (m) { return { at: _prFmt_(m.at), t: m.t, result: m.result, final: m.final, who: m.who }; }) });
  }
  return out;
}
function mcGetProcessing(token) {
  try {
    var s = _mcBlAuth_(token, ['stock', 'kanban', 'haccp']), p = s.permissions || {}, v = _stockBatchesSheet_().getDataRange().getValues(), holds = [];
    for (var i = 1; i < v.length; i++) if (String(v[i][10]) === 'hold') { var ps = _mcBlPass_(v[i][0]); holds.push({ batchId: String(v[i][0]), product: v[i][1], qty: _mcBlQtyText_(v[i][9], v[i][2], _prPv_(ps, 'Ед.')), kind: String(_prPv_(ps, 'Обработка') || ''), parent: String(_prPv_(ps, 'ParentBatchID') || ''), basis: String(_prPv_(ps, 'Основание срока') || '') }); }
    var av = _prActs_().getDataRange().getValues(), H = MC_PR_ACT_HEAD_, acts = [];
    for (var k = av.length - 1; k >= 1 && acts.length < 60; k--) { if (!av[k][0]) continue; var a = {}; H.forEach(function (h, j) { a[h] = av[k][j] instanceof Date ? _prFmt_(av[k][j]) : av[k][j]; }); acts.push(a); }
    var lv = _prLines_().getDataRange().getValues(), lines = {};
    for (var j = 1; j < lv.length; j++) { var aid = String(lv[j][0]); if (!lines[aid]) lines[aid] = []; lines[aid].push({ type: lv[j][1], name: lv[j][2], qty: lv[j][3], unit: lv[j][5] || '', batchId: lv[j][4], reason: lv[j][6] || '', expiry: lv[j][7] instanceof Date ? _prFmt_(lv[j][7]) : lv[j][7], source: lv[j][8] || '' }); }
    acts.forEach(function (a) { a.lines = lines[String(a['ID'])] || []; });
    var can = function (r) { return _mcRbHasExact_(s, r.join('|')); };   // этап 10.7
    return _ok_({ settings: _prCfg_(), running: _prRunning_(), holds: holds, acts: acts, norms: JSON.parse(getAllWasteNorms()), templates: JSON.parse(getDisassemblyTemplates()),
      fridges: _mcBlLocations_().filter(function (l) { return l.active && l.type === 'FRIDGE'; }).map(function (l) { return { id: l.id, name: l.name, range: _mcBlRange_(l.tmin, l.tmax) }; }),
      equipment: (function () { try { return _mcEqList_().filter(function (x) { return x.measuring && x.effective === 'ACTIVE'; }).map(function (x) { return { id: x.id, name: x.name }; }); } catch (e) { return []; } })(),
      canProcess: can(['batch_use']), canDecide: can(['haccp']), canPlanTasks: can(['plan_edit']) });
  } catch (e) { return _failFrom_(e); }
}
/** Партии для обработки: допущенные (охлаждённые — зачистка/разбор, замороженные — дефрост), по сроку. */
function mcProcessingSources(q, token) {
  try {
    _mcBlAuth_(token, ['stock', 'kanban']);
    var k = _mdNorm_(q || ''), v = _stockBatchesSheet_().getDataRange().getValues(), out = [];
    for (var i = 1; i < v.length; i++) {
      if (!v[i][0] || _mcBlNum_(v[i][9]) <= 0 || !/^(active)$/.test(String(v[i][10] || 'active'))) continue;
      if (k && _mdNorm_(v[i][0] + ' ' + v[i][1]).indexOf(k) < 0) continue;
      var b = { v: v[i], sh: null, row: i + 1 }, pass = _mcBlPass_(v[i][0]), st = _mcBlState_(b, pass, []);
      if (!st.usable) continue;
      out.push({ batchId: String(v[i][0]), product: v[i][1], qty: _mcBlQtyText_(v[i][9], v[i][2], _prPv_(pass, 'Ед.')), expiry: st.expiry ? _mcBlFmt_(st.expiry, st.withTime) : '', ts: st.expiry ? st.expiry.getTime() : 9e15,
        frozen: _prFrozen_(b, pass), thawed: !!_prPv_(pass, 'Разморожено'), pf: !!_prPv_(pass, 'Обработка'), location: _mcBlLocName_(v[i][14]), unit: _prDispUnit_(b, pass) });
    }
    out.sort(function (a, c) { return a.ts - c.ts; });
    return _ok_(out.slice(0, 200));
  } catch (e) { return _failFrom_(e); }
}

/* ------------------------------------------------------------------ план из банкетов ---- */
/** Фактический выход п/ф из сырья по актам: { 'сырьё|п/ф': {yield, acts} }. */
function _prYields_() {
  var av = _prActs_().getDataRange().getValues(), H = MC_PR_ACT_HEAD_, lv = _prLines_().getDataRange().getValues(), acts = {}, out = {};
  for (var i = 1; i < av.length; i++) { var t = String(av[i][H.indexOf('Тип')]); if (t === 'TRIM' || t === 'CUT') acts[String(av[i][0])] = { src: _prodKey_(av[i][3]), srcName: av[i][3], taken: _mcBlNum_(av[i][H.indexOf('Взято')]) || _mcBlNum_(av[i][4]) }; }
  for (var j = 1; j < lv.length; j++) {
    var a = acts[String(lv[j][0])]; if (!a || String(lv[j][1]) !== 'product' || !(a.taken > 0)) continue;
    var key = a.src + '|' + _prodKey_(lv[j][2]), o = out[key] || (out[key] = { raw: a.srcName, pf: lv[j][2], sum: 0, n: 0, list: [] });
    o.list.push(_mcBlNum_(lv[j][3]) / a.taken);
  }
  Object.keys(out).forEach(function (k) { var o = out[k], l = o.list.slice(-10); o.yield = l.reduce(function (s, x) { return s + x; }, 0) / l.length; o.acts = l.length; });
  return out;
}
/** Из какого сырья получается п/ф (по актам и шаблонам обработки). */
function _prPfSources_(yields) {
  var map = {};
  Object.keys(yields).forEach(function (k) { var y = yields[k], pk = _prodKey_(y.pf); if (!map[pk] || map[pk].acts < y.acts) map[pk] = { raw: y.raw, yield: y.yield, acts: y.acts, basis: 'по ' + y.acts + ' акт(ам) обработки' }; });
  try {
    JSON.parse(getDisassemblyTemplates()).forEach(function (t) {
      var prods = (t.lines || []).filter(function (l) { return !l.isWaste; });
      prods.forEach(function (l) { var pk = _prodKey_(l.name); if (map[pk]) return;
        var norm = null; try { norm = JSON.parse(getWasteNorm(t.rawMaterial)); } catch (e) {}
        map[pk] = { raw: t.rawMaterial, yield: prods.length === 1 && norm ? 1 - norm.maxWastePercent / 100 : null, acts: 0, basis: prods.length === 1 && norm ? 'шаблон «' + t.name + '», норма отходов ' + norm.maxWastePercent + ' % (выход не ниже)' : 'шаблон «' + t.name + '» — выход неизвестен до первого разбора' }; });
    });
  } catch (e) {}
  return map;
}
function _prAt_(dateStr, hhmm) { var p = String(hhmm || '08:00').split(':'); var d = new Date(dateStr + 'T00:00:00'); d.setHours(Number(p[0]) || 0, Number(p[1]) || 0, 0, 0); return d; }
/** Упаковка: вес одной упаковки (по фото этикеток) в единице партии. */
function _prPackBase_(b, pass) {
  var labs = _prLabels_(pass).filter(function (l) { return Number(l.net_weight_kg) > 0; });
  if (!labs.length) return null;
  var kg = labs.reduce(function (s, l) { return s + Number(l.net_weight_kg); }, 0) / labs.length;
  return _toBaseUnitServer_(kg, 'кг').qty / (_toBaseUnitServer_(1, b.v[2]).qty || 1);
}
/**
 * План обработки сырья из банкетов: что разморозить (целыми упаковками), когда начать, что зачистить/разобрать,
 * излишки, нехватка, п/ф с истекающим сроком без плана. Ничего не записывает и не списывает.
 */
function _prPlan_(fromStr, days) {
  var cfg = _prCfg_(), now = new Date(), from = fromStr || _mcV14Date_(now), toD = new Date(from + 'T00:00:00'); toD.setDate(toD.getDate() + Math.max(1, Math.min(21, days || 7)) - 1);
  var events = _mcV14Events_(from, _mcV14Date_(toD)).sort(function (a, c) { return a.date.localeCompare(c.date); }), idx = _buildDishIndexes_(), pfStock = _loadPfStockMap_();
  var yields = _prYields_(), pfSrc = _prPfSources_(yields), needs = [], noData = [], semis = [];
  events.forEach(function (e) {
    var pd = new Date(e.date + 'T00:00:00'); pd.setDate(pd.getDate() - 1); var prodDate = _mcV14Date_(pd);
    if (!(e.items || []).length) noData.push({ banquet: e.id, date: e.date, name: e.format || e.name || 'Банкет', reason: 'нет блюд / количества' });
    (e.items || []).forEach(function (it) {
      var q = Number(it.qty) || 0, d = idx.dishByCode[it.code]; if (!d || !q) { if (!d) noData.push({ banquet: e.id, date: e.date, name: it.name || it.code, reason: 'нет ТТК' }); return; }
      var raw = {}, meta = {}, nodes = [];
      _mcV24BuildTree_(it.code, q, idx, pfStock, raw, nodes, [], 0, it.code, meta);
      Object.keys(raw).forEach(function (k) { var b = _mcV14ToBase_(raw[k], meta[k].unit); needs.push({ key: _prodKey_(meta[k].name), name: meta[k].name, qty: b.qty, unit: b.unit, prodDate: prodDate, banquet: e.id, banquetDate: e.date, banquetName: e.format || e.name || 'Банкет', dish: d.name }); });
      nodes.filter(function (n) { return n.taskType === 'SEMI' && n.toProduce > 0.0001; }).forEach(function (n) { semis.push({ name: n.name, code: n.code, qty: n.toProduce, unit: n.unit, prodDate: prodDate, banquet: e.id }); });
    });
  });
  // склад по продукту: готовое (охлаждённое / размороженное / п/ф), идёт дефрост, заморожено
  var sv = _stockBatchesSheet_().getDataRange().getValues(), pool = {};
  for (var i = 1; i < sv.length; i++) {
    if (!sv[i][0] || _mcBlNum_(sv[i][9]) <= 0) continue;
    var st0 = String(sv[i][10] || 'active'); if (st0 !== 'active' && st0 !== 'defrost') continue;
    var b = { v: sv[i], sh: null, row: i + 1 }, pass = _mcBlPass_(sv[i][0]), stt = _mcBlState_(b, pass, []);
    if (st0 === 'active' && !stt.usable) continue;
    var kind = st0 === 'defrost' ? 'defrosting' : _prFrozen_(b, pass) ? 'frozen' : 'ready', k = _prodKey_(sv[i][1]), bu = _toBaseUnitServer_(1, sv[i][2]);
    (pool[k] = pool[k] || []).push({ batchId: String(sv[i][0]), name: sv[i][1], kind: kind, avail: _mcBlNum_(sv[i][9]) * (bu.qty || 1), unitBase: bu.unit || 'г', batchUnit: sv[i][2], exp: stt.expiry, withTime: stt.withTime,
      thawed: !!_prPv_(pass, 'Разморожено'), opened: !!(_prPv_(pass, 'Вскрыто') || _prPv_(pass, 'Обработка')), until: _mcBlDate_(_prPv_(pass, 'Дефрост до')), pack: kind === 'frozen' ? _prPackBase_(b, pass) : null,
      packFactor: bu.qty || 1, used: 0, b: b, pass: pass, location: _mcBlLocName_(sv[i][14]) });
  }
  Object.keys(pool).forEach(function (k) { pool[k].sort(function (a, c) { return ((a.exp && a.exp.getTime()) || 9e15) - ((c.exp && c.exp.getTime()) || 9e15); }); });
  var byKey = {}; needs.forEach(function (n) { var k2 = n.key + '|' + n.prodDate; if (!byKey[k2]) byKey[k2] = { key: n.key, name: n.name, unit: n.unit, prodDate: n.prodDate, qty: 0, banquets: [] }; var g = byKey[k2]; g.qty += n.qty;
    if (g.banquets.indexOf(n.banquet + ' (' + n.banquetDate + ')') < 0) g.banquets.push(n.banquet + ' (' + n.banquetDate + ')'); });
  var groups = Object.keys(byKey).map(function (k) { return byKey[k]; }).sort(function (a, c) { return a.prodDate.localeCompare(c.prodDate); });
  var defrost = [], shortages = [], covered = [], surplusPool = {}, processing = [], unknown = [];
  // покрыть потребность: излишек дефроста → готовое → идёт дефрост → (п/ф без ТТК: обработка сырья по выходу) → дефрост замороженного целыми упаковками
  var allocate = function (key, name, unit, qty, prodDate, banquets, via, depth) {
    var start = _prAt_(prodDate, cfg.prodStart), need = qty, list = (pool[key] || []).filter(function (x) { return x.unitBase === unit; }), from = [];
    (surplusPool[key] || []).forEach(function (s) { if (need <= 0.5 || s.left <= 0.5) return; if (s.expAt && s.expAt < _prAt_(prodDate, '23:59')) return; var t = Math.min(need, s.left); s.left -= t; need -= t; s.usedBy.push(prodDate + ': ' + banquets.join(', ')); from.push({ batchId: s.batchId, kind: 'surplus', qty: Math.round(t) }); });
    ['ready', 'defrosting'].forEach(function (kind) { list.filter(function (x) { return x.kind === kind; }).forEach(function (x) {
      if (need <= 0.5) return; var left = x.avail - x.used; if (left <= 0.5) return;
      var until = kind === 'defrosting' && x.until ? x.until : null; if (until && until > start) return;
      if (x.exp && (x.withTime ? x.exp : _prEod_(x.exp)) < start) return;
      var t = Math.min(need, left); x.used += t; need -= t; from.push({ batchId: x.batchId, kind: kind, qty: Math.round(t), thawed: x.thawed, opened: x.opened, expiry: x.exp ? _mcBlFmt_(x.exp, x.withTime) : '' }); }); });
    var src = pfSrc[key];
    if (need > 0.5 && src && !depth && !idx.dishByNormName[_normNameServer_(name)]) {
      var proc = { pf: name, qty: Math.round(need), unit: unit, raw: src.raw, yieldPct: src.yield ? Math.round(src.yield * 1000) / 10 : null, rawQty: src.yield ? Math.round(need / src.yield) : null, basis: src.basis, prodDate: prodDate, banquets: banquets };
      processing.push(proc);
      if (!src.yield) { unknown.push({ pf: name, raw: src.raw, qty: Math.round(need), unit: unit, prodDate: prodDate, reason: 'выход п/ф из «' + src.raw + '» неизвестен — проведите первый разбор, потом план посчитает сырьё' }); need = 0; }
      else { var rest = allocate(_prodKey_(src.raw), src.raw, unit, need / src.yield, prodDate, banquets, name, 1); proc.rawFrom = rest.from;
        if (rest.missing > 0.5) shortages.push({ product: src.raw, prodDate: prodDate, missing: Math.round(rest.missing), unit: unit, banquets: banquets, via: [name], processing: true });
        need = 0; }
    }
    if (need > 0.5) list.filter(function (x) { return x.kind === 'frozen'; }).forEach(function (x) {
      if (need <= 0.5) return; var left = x.avail - x.used; if (left <= 0.5) return;
      var packBase = x.pack ? x.pack * x.packFactor : null, packs = packBase ? Math.ceil(need / packBase - 1e-9) : null, plan = packBase ? Math.min(left, packs * packBase) : Math.min(left, need);
      if (packBase) packs = Math.ceil(plan / packBase - 1e-9);
      var ad = _prAfterDefrost_(x.b, x.pass), prof = _mcBlProfile_(x.name, ''), dH = prof.defrostH || cfg.maxH;
      var latest = new Date(start.getTime() - dH * 3600000), earliest = ad.hours ? new Date(_prAt_(prodDate, '23:59').getTime() - ad.hours * 3600000 - dH * 3600000) : latest;
      if (earliest > latest) earliest = latest;
      var use = Math.min(need, plan), sur = Math.max(0, plan - need);
      x.used += plan; need -= use;
      var item = { batchId: x.batchId, product: x.name, prodDate: prodDate, startByTs: latest.getTime(), need: Math.round(use), planned: Math.round(plan), unit: x.unitBase, packs: packs, packWeight: packBase ? Math.round(packBase) : null,
        startFrom: _prFmt_(earliest < now ? now : earliest), startBy: _prFmt_(latest), late: latest < now, defrostH: dH, afterDefrost: ad.hours ? ad.hours + ' ч — ' + ad.basis : 'не определён (нет на этикетке и в профиле продукта)',
        surplus: Math.round(sur), location: x.location, banquets: banquets, via: via ? [via] : [], note: packBase ? '' : 'вес упаковки неизвестен (нет фото этикеток с массой) — разморозьте около ' + Math.round(plan) + ' ' + x.unitBase + ' целыми упаковками' };
      defrost.push(item); from.push({ batchId: x.batchId, kind: 'frozen', qty: Math.round(use) });
      if (sur > 0.5) (surplusPool[key] = surplusPool[key] || []).push({ batchId: x.batchId, left: sur, expAt: ad.hours ? new Date(latest.getTime() + (dH + ad.hours) * 3600000) : null, usedBy: [], item: item });
    });
    return { from: from, missing: Math.max(0, need) };
  };
  var rawKeys = {}; Object.keys(pfSrc).forEach(function (k) { rawKeys[_prodKey_(pfSrc[k].raw)] = 1; });
  groups.forEach(function (g) {
    var res = allocate(g.key, g.name, g.unit, g.qty, g.prodDate, g.banquets, '', 0);
    covered.push({ product: g.name, prodDate: g.prodDate, need: Math.round(g.qty), unit: g.unit, from: res.from, banquets: g.banquets });
    if (res.missing > 0.5) shortages.push({ product: g.name, prodDate: g.prodDate, missing: Math.round(res.missing), unit: g.unit, banquets: g.banquets, via: [],
      processing: !!(pfSrc[g.key] || rawKeys[g.key] || (pool[g.key] || []).some(function (x) { return x.kind !== 'ready'; })) });
  });
  Object.keys(surplusPool).forEach(function (k) { surplusPool[k].forEach(function (s) { s.item.surplusLeft = Math.round(s.left); s.item.surplusUse = s.usedBy; }); });
  // готовые п/ф / вскрытое / размороженное, истекающее в ближайшие 36 ч и не взятое в план
  var soon = new Date(now.getTime() + 36 * 3600000), expiring = [];
  Object.keys(pool).forEach(function (k) { pool[k].forEach(function (x) {
    if (x.kind !== 'ready' || !(x.thawed || x.opened) || !x.exp) return; var e = x.withTime ? x.exp : _prEod_(x.exp); if (e > soon) return;
    var left = x.avail - x.used; if (left <= 0.5) return;
    expiring.push({ batchId: x.batchId, product: x.name, left: Math.round(left), unit: x.unitBase, expiry: _mcBlFmt_(x.exp, x.withTime), note: 'в плане банкетов не используется — направьте в меню или примите решение (система сама не списывает)' }); }); });
  var pfNoSource = needs.filter(function (n) { return /п\/ф/i.test(n.name) && !(pool[n.key] || []).length && !pfSrc[n.key] && !idx.dishByNormName[_normNameServer_(n.name)]; })
    .reduce(function (a, n) { if (!a.some(function (x) { return x.pf === n.name; })) a.push({ pf: n.name, reason: 'нет ТТК, нет шаблона обработки и нет на складе — непонятно, из какого сырья его делать' }); return a; }, []);
  return { from: from, to: _mcV14Date_(toD), events: events.map(function (e) { return { id: e.id, date: e.date, name: e.format || e.name || 'Банкет', guests: e.guests || e.persons || '' }; }),
    defrost: defrost, processing: processing,
    semis: semis.map(function (s) { return Object.assign(s, { qty: Math.round(s.qty) }); }), covered: covered, shortages: shortages.filter(function (x) { return x.processing; }),
    otherShortages: shortages.filter(function (x) { return !x.processing; }).length, expiring: expiring, unknownYield: unknown, pfNoSource: pfNoSource, noData: noData,
    yields: Object.keys(yields).map(function (k) { var y = yields[k]; return { raw: y.raw, pf: y.pf, yieldPct: Math.round(y.yield * 1000) / 10, acts: y.acts }; }), settings: cfg, generatedAt: _prFmt_(now) };
}
function mcProcessingPlan(json, token) {
  try { _mcBlAuth_(token, ['stock', 'kanban', 'plan']); var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}); return _ok_(_prPlan_(d.from, d.days)); }
  catch (e) { return _failFrom_(e); }
}
/** Поставить задачи дефроста в доску заданий (повтор той же задачи не создаётся). */
function mcPublishDefrostTasks(json, token) {
  var op = null;
  try { op = _mcBlOp_(token, ['stock', 'kanban', 'plan'], 'DEFROST_TASKS', null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), plan = _prPlan_(d.from, d.days);
    return _withLock_(function () {
      var kb = _kanbanSheet_(), kv = kb.getDataRange().getValues(), have = {}, now = new Date(), n = 0;
      for (var i = 1; i < kv.length; i++) if (String(kv[i][1] || '').indexOf('DEFROST:') === 0 && String(kv[i][9]) !== 'done') have[String(kv[i][1])] = true;
      plan.defrost.forEach(function (x) {
        var src = 'DEFROST:' + x.batchId + '|' + x.prodDate; if (have[src]) return;
        var txt = 'Дефрост «' + x.product + '», партия ' + x.batchId + ': ' + (x.packs ? x.packs + ' уп. (' + x.planned + ' ' + x.unit + ')' : x.planned + ' ' + x.unit) + ' — начать с ' + x.startFrom + ' до ' + x.startBy + ', в холодильнике, не более ' + x.defrostH + ' ч, замер t° каждые ' + plan.settings.measureH + ' ч';
        kb.appendRow([_nextTaskId_(), src, x.prodDate, 'Дефрост', '', x.product, x.planned, 0, txt, 'todo', '', now, now, String(x.startBy).slice(-5), '']); n++;
      });
      _audit_(op, 'DEFROST_TASKS', 'План обработки', plan.from + '…' + plan.to, null, { tasks: n, defrost: plan.defrost.length });
      _endOp_(op);
      return _ok_({ created: n, total: plan.defrost.length }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Расписание: просроченный дефрост → отклонение и блокировка; пропущенный замер и «пора начинать дефрост» → уведомление. */
function mcProcessingWatchSystem() {
  try {
    var cfg = _prCfg_(), now = new Date(), op = _createOperation_('PROCESSING_WATCH', null, '');
    _prRunning_().forEach(function (r) {
      if (r.overdue && !_mcIsObjectBlocked_('BATCH', r.batchId)) {
        var b = _bcFind_(r.batchId), dev = _bcDeviation_(r.batchId, r.product, 'ККТ 4 «Размораживание»: дефрост идёт дольше ' + cfg.maxH + ' ч (начат ' + r.started + ')', r.hours, null);
        _mcBlockObject_('BATCH', r.batchId, 'ККТ 4: дефрост дольше ' + cfg.maxH + ' ч', { deviationId: dev, actor: 'расписание' });
        _mcBlEvent_(op, r.batchId, 'DEFROST_DEVIATION', { reason: 'ККТ 4: дефрост дольше ' + cfg.maxH + ' ч — партия заблокирована до решения ответственного', result: 'BLOCKED' });
        _notify_('defrost_deviation', 'critical', 'Дефрост дольше ' + cfg.maxH + ' ч — ' + r.product, r.batchId + ' начат ' + r.started + '. Партия заблокирована.', 'Шеф-повар', 'defover|' + r.batchId, op);
      } else if (r.measureOverdue) _notify_('defrost_measure', 'warning', 'Замер t° при дефросте — ' + r.product, r.batchId + ': замер t° в толще нужен был до ' + r.nextMeasure, 'Повар', 'defmeas|' + r.batchId + '|' + r.nextMeasure, op);
    });
    var plan = _prPlan_(_mcV14Date_(now), 3), running = {}; _prRunning_().forEach(function (r) { running[r.batchId] = 1; });
    plan.defrost.forEach(function (x) { var by = new Date(x.startByTs);
      if (by - now < 3 * 3600000 && !running[x.batchId]) _notify_('defrost_start', x.late ? 'critical' : 'warning', 'Начать дефрост: ' + x.product, x.batchId + ': ' + (x.packs ? x.packs + ' уп. ' : '') + x.planned + ' ' + x.unit + ' — начать до ' + x.startBy + ' (производство ' + x.prodDate + ')', 'Повар', 'defplan|' + x.batchId + '|' + x.prodDate, op); });
    _closeOperation_(op.id, 'COMPLETED');
  } catch (e) { try { _log_('WARN', 'обработка сырья: проверка расписания: ' + e); } catch (x) {} }
}
