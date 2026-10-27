/**
 * MON CHEF — обязательные ККТ при выпуске продукции (ТЗ §9).
 *
 * Технолог/HACCP назначает карте (ТТК п/ф или блюда) обязательные ККТ из плана HACCP
 * (лист «HACCP_ТочкиКонтроля_V30», тип CCP, статус ACTIVE). Пока по производственному
 * заказу нет факта по каждой назначенной ККТ в пределах (HACCP_Факты_V31, RelatedBatchID =
 * номер заказа), выпуск (completeProduction) блокируется. Факт «вне предела» тоже блокирует:
 * отклонение → корректирующее действие → повторный замер.
 * Значения вносит человек; система их не подставляет.
 * Лист «ТТК_ККТ» — назначения (история, действует последняя запись по паре ТТК+ККТ).
 */
var MC_TCCP_SHEET_ = 'ТТК_ККТ';
var MC_TCCP_HEAD_ = ['Код ТТК', 'ControlID', 'Статус', 'Кто', 'Когда', 'OperationID'];

function _tccpActiveControls_() {
  var out = {};
  try {
    var mons = _v30Rows_(MC_V30.MON);
    _v30Rows_(MC_V30.CCP).forEach(function (r) {
      if (String(r[13]) !== 'ACTIVE' || String(r[3]).toUpperCase() !== 'CCP') return;
      var m = mons.filter(function (x) { return String(x[1]) === String(r[0]); })[0];
      out[String(r[0])] = { id: String(r[0]), point: String(r[4] || ''), limit: String(r[5] || ''), unit: String(r[6] || (m ? m[4] : '') || ''),
        min: m ? m[5] : '', max: m ? m[6] : '', parameter: m ? String(m[3] || '') : '', monitoring: !!m };
    });
  } catch (e) {}
  return out;
}
/** Назначенные ККТ карты: [{id, point, ...}] (только действующие ККТ плана). */
function _tccpFor_(code) {
  var sh = _book_().getSheetByName(MC_TCCP_SHEET_); if (!sh) return [];
  var v = sh.getDataRange().getValues(), last = {};
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(code)) last[String(v[i][1])] = String(v[i][2]);
  var act = _tccpActiveControls_();
  return Object.keys(last).filter(function (k) { return last[k] === 'ACTIVE'; }).map(function (k) { return act[k] || { id: k, point: k, inactive: true }; });
}
/** Состояние ККТ по заказу: по каждой назначенной ККТ последний факт с RelatedBatchID = заказ. */
function _tccpState_(code, prodId) {
  var req = _tccpFor_(code), facts = [];
  try { facts = _v31Rows_(MC_V31.FACT).filter(function (r) { return String(r[13]) === String(prodId); }); } catch (e) {}
  var items = req.map(function (c) {
    var f = facts.filter(function (r) { return String(r[1]) === c.id; }).slice(-1)[0];
    var st = c.inactive ? 'INACTIVE' : !f ? 'MISSING' : String(f[7]) === 'OK' ? 'OK' : 'DEVIATION';
    return { controlId: c.id, point: c.point, limit: c.limit || '', unit: c.unit || '', min: c.min, max: c.max, status: st,
      factId: f ? f[0] : '', value: f ? f[5] : '', at: f ? _bcDate_(f[9]) : '', who: f ? f[11] : '' };
  });
  var blocking = items.filter(function (x) { return x.status !== 'OK'; });
  return { required: items.length, items: items, blocking: blocking, ok: !blocking.length };
}
function _tccpBlockText_(st) {
  return st.blocking.map(function (x) {
    return x.status === 'MISSING' ? '«' + x.point + '» — нет замера' : x.status === 'DEVIATION' ? '«' + x.point + '» — последний замер ' + x.value + ' ' + x.unit + ' вне предела: корректирующее действие и повторный замер'
      : '«' + x.point + '» — ККТ не действует в плане HACCP (проверьте назначение)';
  }).join('; ');
}

function mcGetTtkCcp(code, token) {
  try {
    var s = _requireAuth_(token);
    var act = _tccpActiveControls_(), mine = _tccpFor_(code), ids = mine.map(function (x) { return x.id; });
    var perm = s.permissions || {};
    return _ok_({ code: code, assigned: mine, available: Object.keys(act).filter(function (k) { return ids.indexOf(k) < 0; }).map(function (k) { return act[k]; }),
      canEdit: perm.all === true || perm.haccp === true });
  } catch (e) { return _failFrom_(e); }
}
function mcSetTtkCcp(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp', 'TTK_CCP_SET', 'ТТК_ККТ', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var code = String(d.code || ''), cid = String(d.controlId || ''), remove = d.remove === true;
    if (!code || !_buildDishIndexes_().dishByCode[code]) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'ТТК не найдена', op.id); }
    var c = _tccpActiveControls_()[cid];
    if (!remove && !c) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Назначить можно только действующую ККТ плана HACCP (тип CCP, статус ACTIVE)', op.id); }
    if (!remove && !c.monitoring) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'У ККТ нет плана мониторинга с пределами — замер нельзя будет оценить', op.id); }
    return _withLock_(function () {
      var was = _tccpFor_(code).some(function (x) { return x.id === cid; });
      if (was === !remove) { _endOp_(op, 'COMPLETED'); return _ok_({ code: code, controlId: cid, status: remove ? 'REMOVED' : 'ACTIVE', unchanged: true }, op.id); }
      _bcSheet_(MC_TCCP_SHEET_, MC_TCCP_HEAD_).appendRow([code, cid, remove ? 'REMOVED' : 'ACTIVE', (op.session && (op.session.fullName || op.session.name)) || '', new Date(), op.id]);
      _audit_(op, 'TTK_CCP_SET', 'ТТК_ККТ', code, was ? 'ACTIVE' : null, { controlId: cid, status: remove ? 'REMOVED' : 'ACTIVE' });
      _endOp_(op, 'COMPLETED');
      return _ok_({ code: code, controlId: cid, status: remove ? 'REMOVED' : 'ACTIVE' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function mcGetProductionCcp(prodId, token) {
  try {
    _requireAuth_(token);
    var f = _findProduction_(_productionSheet_(), prodId); if (!f) return _fail_('NOT_FOUND', 'Заказ не найден');
    var st = _tccpState_(f.data[PROD_COL_.code], prodId);
    st.production = { id: prodId, code: f.data[PROD_COL_.code], name: f.data[PROD_COL_.name], status: f.data[PROD_COL_.status] };
    return _ok_(st);
  } catch (e) { return _failFrom_(e); }
}
/** Замер ККТ по заказу: обычный факт HACCP (V31) с привязкой к номеру заказа. */
function mcRecordProductionCcp(json, token) {
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var f = _findProduction_(_productionSheet_(), d.productionId);
    if (!f) return _fail_('NOT_FOUND', 'Заказ не найден');
    var stt = f.data[PROD_COL_.status];
    if (stt !== 'PLANNED' && stt !== 'IN_PROGRESS') return _fail_('VALIDATION', 'Замер вносится по заказу в работе (сейчас ' + stt + ')');
    var code = f.data[PROD_COL_.code], ctl = _tccpFor_(code).filter(function (x) { return x.id === String(d.controlId); })[0];
    if (!ctl) return _fail_('VALIDATION', 'Эта ККТ не назначена карте «' + f.data[PROD_COL_.name] + '»');
    // этап 10.7: тепловую обработку, охлаждение, разогрев, фритюр вносит повар горячего цеха, шеф-повар, су-шеф —
    // по заказу любого цеха (варка овощей для салата холодного цеха идёт на плите горячего); кондитер — выпечку своего цеха.
    // Остальные ККТ — повар цеха, которому назначен заказ.
    var s = _requireAuth_(token), ws = String(f.data[PROD_COL_.ws] || '');
    var thermal = MC_RB_HOT_CCP_RE_.test(String(ctl.point || '') + ' ' + String(ctl.parameter || ''));
    if (thermal) {
      if (!_mcRbHasExact_(s, 'hot_ccp') && !(_mcRbHasExact_(s, 'shop_pastry') && /кондитер/i.test(ws))) {
        _mcRbAuditDenied_(s, 'mcRecordProductionCcp', 'hot_ccp', d.productionId);
        return _mcRbDenyJson_('ККТ «' + ctl.point + '» (тепловая обработка, охлаждение, разогрев, фритюр) вносит повар горячего цеха, шеф-повар или су-шеф.');
      }
    } else if (!_mcRbShopAllowed_(s, ws)) { _mcRbAuditDenied_(s, 'mcRecordProductionCcp', 'shop:' + ws, d.productionId); return _mcRbDenyJson_('Заказ «' + ws + '»: ККТ вносит повар этого цеха.'); }
    var r = v31RecordHaccpFact(JSON.stringify({ controlId: d.controlId, value: d.value, equipmentId: d.equipmentId || '', relatedBatchId: String(d.productionId),
      object: 'Производство ' + d.productionId + ' · ' + f.data[PROD_COL_.name], correctiveAction: d.correctiveAction || '' }), token);
    var j = typeof r === 'string' ? JSON.parse(r) : r;
    if (j && (j.success || j.ok)) { var st = _tccpState_(code, d.productionId); j.data = j.data || {}; j.data.state = st; }
    return typeof r === 'string' ? JSON.stringify(j) : j;
  } catch (e) { return _failFrom_(e); }
}
