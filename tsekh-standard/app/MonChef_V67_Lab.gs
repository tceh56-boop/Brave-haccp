/**
 * ЦЕХ Стандарт V67 — лабораторные исследования (ТЗ «Итоговая структура…», §17) и связка ТУ → ППК → лаборатория → финансы (§18).
 *
 * Листы «Лаборатория_План» и «Лаборатория_Исследования» — прежние колонки сохраняются (их читают готовность к проверке,
 * архив и прежние экраны), колонки ТЗ дописываются справа; новый лист «Лаборатория_Отбор».
 * Цикл: план → задание на отбор → отбор и маркировка → передача в лабораторию → протокол (файл и хеш) → сравнение с нормативом →
 * решение по партии / процессу → корректирующее действие / допуск.
 * Результат показателя: PASS / FAIL / REVIEW / NOT_APPLICABLE / PENDING — считает система по границам норматива, не человек.
 * FAIL по партии: партия блокируется, открываются отклонение и корректирующее действие (DeviationID ↔ BatchID ↔ ResearchID ↔
 * CorrectiveActionID ↔ OperationID), ставится повторное исследование, уведомляется ответственный за ХАССП.
 * Допуск после исследования и снятие блокировки — решение сотрудника с правом lab_approve.
 * Проба не привязывается к партии задним числом: время отбора не позже текущего и не раньше чем за 24 часа и не раньше
 * появления партии; исправление связи — отдельной корректировкой с причиной и аудитом.
 */
var MC_V67_PLAN_EXT = ['PlanID', 'PPKID', 'TUID', 'ObjectType', 'ObjectName', 'ProductID', 'Indicator', 'Normative', 'Method', 'FrequencyDays', 'SampleCount', 'Laboratory', 'ResponsibleRole',
  'Active', 'DateFrom', 'DateTo', 'SourceDocumentID', 'NormMin', 'NormMax', 'NormText', 'Unit', 'ResultDays', 'ActionOnFail', 'Basis', 'CostPerTest', 'TUIndicatorID'];
var MC_V67_RES_EXT = ['ResearchID', 'PlanID', 'SampleID', 'BatchID', 'ProductID', 'TTKID', 'TUID', 'Laboratory', 'ProtocolNo', 'SamplingDate', 'ResultDate', 'Indicator', 'Method', 'NormMin', 'NormMax',
  'FactValue', 'Unit', 'Result', 'Status', 'FileID', 'Hash', 'Responsible', 'OperationID', 'DeviationID', 'CreatedAt', 'NormText', 'Decision', 'DecisionBy', 'DecisionAt', 'RetestOf', 'CostAmount',
  'CostLevel', 'CorrectiveActionID', 'BlockID'];
var MC_V67_SAMPLE = ['Лаборатория_Отбор', ['SampleID', 'PlanID', 'BatchID', 'ProductID', 'TTKID', 'TTKVersion', 'TUID', 'TUVersion', 'ObjectType', 'ObjectName', 'SampledAt', 'RecordedAt', 'Quantity', 'Unit',
  'Container', 'StorageTransport', 'Temperature', 'Place', 'EmployeeID', 'EmployeeName', 'LabelMethod', 'Laboratory', 'TransferDocument', 'TransferredAt', 'EvidenceFileID', 'EvidenceHash', 'Status',
  'OperationID', 'CorrectionOf', 'CorrectionReason', 'HoldBlockID']];
var MC_V67_OBJ = { RAW: 'сырьё при поступлении', FINISHED: 'готовая продукция', SEMI: 'полуфабрикаты', WATER: 'вода', SWAB: 'смывы с оборудования и инвентаря', AIR: 'воздух и производственная среда',
  DISINFECTANT: 'дезрастворы', FRYING_OIL: 'фритюрное масло', PACKAGING: 'упаковочные материалы', COMPLAINT: 'продукция по жалобе или расследованию', DAILY_SAMPLE: 'контрольные образцы и суточные пробы' };
var MC_V67_BATCH_OBJ = ['RAW', 'FINISHED', 'SEMI', 'DAILY_SAMPLE', 'COMPLAINT'];
var MC_V67_RES_RU = { PASS: 'соответствует', FAIL: 'не соответствует', REVIEW: 'требует экспертной оценки', NOT_APPLICABLE: 'неприменим', PENDING: 'ожидается' };
var MC_V67_BASIS = ['ППК', 'ТУ', 'ТР', 'Договор', 'Внутренний стандарт'];

/* ---------------- листы ---------------- */
function _v67Ext_(sh, ext) {
  var lc = Math.max(1, sh.getLastColumn()), h = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (x) { return String(x || '').trim(); });
  while (h.length && !h[h.length - 1]) h.pop();
  var add = ext.filter(function (c) { return h.indexOf(c) < 0; });
  if (add.length) { sh.getRange(1, h.length + 1, 1, add.length).setValues([add]); h = h.concat(add); }
  return h;
}
function _v67Plan_() { var sh = _labPlanSheet_(); return { sh: sh, h: _v67Ext_(sh, MC_V67_PLAN_EXT) }; }
function _v67Res_() { var sh = _labTestSheet_(); return { sh: sh, h: _v67Ext_(sh, MC_V67_RES_EXT) }; }
function _v67Smp_() { return { sh: _v64Sheet_(MC_V67_SAMPLE[0], MC_V67_SAMPLE[1]), h: MC_V67_SAMPLE[1] }; }
function setupV67Lab(token) { try { _requireAuth_(token, 'lab|lab_view|lab_edit'); _v67Plan_(); _v67Res_(); _v67Smp_(); return _ok_({ initialized: true }, 'V67_SETUP'); } catch (e) { return _failFrom_(e); } }
function _v67Arr_(t, o) { return t.h.map(function (c) { return o[c] === undefined || o[c] === null ? '' : o[c]; }); }
function _v67Add_(t, o) { t.sh.appendRow(_v67Arr_(t, o)); }
function _v67Objs_(t, filter) {
  if (t.sh.getLastRow() < 2) return [];
  var v = t.sh.getRange(1, 1, t.sh.getLastRow(), t.h.length).getValues();
  return v.slice(1).map(function (r, i) { var o = { _row: i + 2 }; t.h.forEach(function (c, j) { if (c && !(c in o)) o[c] = r[j]; }); return o; }).filter(function (o) { return (!filter || filter(o)); });
}
function _v67Set_(t, row, col, val) { var c = t.h.indexOf(col); if (c >= 0) t.sh.getRange(row, c + 1).setValue(val); }
function _v67Id_(p) { return p + '-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd') + '-' + Utilities.getUuid().slice(0, 6).toUpperCase(); }
function _v67Fail_(op, code, msg) { _endOp_(op, 'FAILED'); return _fail_(code, msg, op.id); }
function _v67PlanOf_(id) { var t = _v67Plan_(); return _v67Objs_(t, function (p) { return String(p.PlanID || p.ID) === String(id); })[0] || null; }
function _v67File_(dataUrl, name) {
  if (!dataUrl) return null;
  var m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl)); if (!m) throw new Error('VALIDATION: файл не распознан (нужен PDF или фото)');
  if (!/^(application\/pdf|image\/(jpeg|png))$/.test(m[1])) throw new Error('VALIDATION: протокол — PDF, JPEG или PNG');
  var bytes = Utilities.base64Decode(m[2]); if (bytes.length > 15 * 1024 * 1024) throw new Error('VALIDATION: файл больше 15 МБ');
  var pr = PropertiesService.getScriptProperties(), id = pr.getProperty('MC_LAB_FOLDER_ID'), folder = null;
  if (id) { try { folder = DriveApp.getFolderById(id); } catch (e) {} }
  if (!folder) { folder = _docsFolder_().createFolder('Лаборатория'); pr.setProperty('MC_LAB_FOLDER_ID', folder.getId()); }
  var f = folder.createFile(Utilities.newBlob(bytes, m[1], name));
  return { fileId: f.getId(), sha256: _bkHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)) };
}

/* ---------------- план ---------------- */
/** План исследования (§17.3): объект, показатель, норматив, метод, периодичность, образцы, лаборатория, ответственный, основание, срок результата, действие при несоответствии. */
function v67SaveLabPlan(json, token) {
  var op = null; try { op = _beginOp_(token, 'lab_edit|lab', 'V67_PLAN', 'Лаборатория', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), type = String(d.objectType || '').toUpperCase(), errs = [];
    if (!MC_V67_OBJ[type]) errs.push('Объект контроля: ' + Object.keys(MC_V67_OBJ).map(function (k) { return MC_V67_OBJ[k]; }).join(', '));
    if (!String(d.objectName || '').trim()) errs.push('укажите объект (продукт, источник воды, зону смыва…)');
    if (!String(d.indicator || '').trim()) errs.push('укажите показатель');
    var mn = d.normMin === '' || d.normMin === undefined ? '' : _v64Num_(d.normMin), mx = d.normMax === '' || d.normMax === undefined ? '' : _v64Num_(d.normMax);
    if (mn === '' && mx === '' && !String(d.normText || d.normative || '').trim()) errs.push('укажите норматив (границы или текст)');
    if (!String(d.method || '').trim()) errs.push('укажите метод исследования');
    var fd = _v64Num_(d.frequencyDays); if (!(fd > 0)) errs.push('периодичность — число дней больше нуля');
    var sc = d.sampleCount === undefined || d.sampleCount === '' ? 1 : _v64Num_(d.sampleCount); if (!(sc >= 1)) errs.push('количество образцов — не меньше 1');
    if (!String(d.laboratory || '').trim()) errs.push('укажите лабораторию');
    if (!String(d.responsibleRole || '').trim()) errs.push('укажите ответственного');
    var basis = String(d.basis || 'ППК'); if (MC_V67_BASIS.indexOf(basis) < 0) errs.push('основание: ' + MC_V67_BASIS.join(', '));
    if (errs.length) return _v67Fail_(op, 'VALIDATION', errs.join('; '));
    var normative = String(d.normative || d.normText || '').trim() || ((mn !== '' ? 'от ' + mn + ' ' : '') + (mx !== '' ? 'до ' + mx : '') + (d.unit ? ' ' + d.unit : ''));
    return _withLock_(function () {
      var t = _v67Plan_(), ex = d.planId ? _v67Objs_(t, function (p) { return String(p.PlanID || p.ID) === String(d.planId); })[0] : null, id = ex ? String(ex.PlanID || ex.ID) : 'LP' + Date.now();
      var who = _v65Who_(op), now = new Date();
      var o = { ID: id, 'Объект контроля': d.objectName, 'Тип объекта': MC_V67_OBJ[type], 'Вид исследования': d.indicator, 'Периодичность, дней': fd, 'Норматив': normative, 'Лаборатория': d.laboratory,
        'Ответственный': d.responsibleRole, 'Активен': d.active === false ? false : true, 'Создано': ex ? ex['Создано'] : now,
        PlanID: id, PPKID: d.ppkId || '', TUID: d.tuId || '', ObjectType: type, ObjectName: d.objectName, ProductID: d.productId || '', Indicator: d.indicator, Normative: normative, Method: d.method,
        FrequencyDays: fd, SampleCount: sc, Laboratory: d.laboratory, ResponsibleRole: d.responsibleRole, Active: d.active === false ? false : true, DateFrom: _v64DateArg_(d.dateFrom, now, 'Действует с'),
        DateTo: _v64DateArg_(d.dateTo, '', 'Действует по') || '', SourceDocumentID: d.sourceDocumentId || '', NormMin: mn, NormMax: mx, NormText: d.normText || '', Unit: d.unit || '',
        ResultDays: d.resultDays ? _v64Num_(d.resultDays) : '', ActionOnFail: d.actionOnFail || 'блокировка партии, повторное исследование, отклонение и корректирующее действие', Basis: basis,
        CostPerTest: d.costPerTest ? _v64Num_(d.costPerTest) : '', TUIndicatorID: d.tuIndicatorId || '' };
      if (ex) t.sh.getRange(ex._row, 1, 1, t.h.length).setValues([_v67Arr_(t, o)]); else _v67Add_(t, o);
      _audit_(op, 'V67_PLAN', 'Лаборатория_План', id, ex ? { indicator: ex.Indicator || ex['Вид исследования'] } : null, { object: d.objectName, indicator: d.indicator, method: d.method, days: fd, basis: basis });
      _endOp_(op); return _ok_({ planId: id, by: who.name }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Действующая версия ТУ создаёт строки плана по своим показателям (вызывается из v66Advance). Прежние строки этой ТУ выключаются. */
function _v67PlansFromTu_(v, op) {
  var t = _v67Plan_(), n = 0, doc = _v66Doc_(v.TUID), met = {}, now = new Date();
  _v66Objs_('MET', function (m) { return m.VersionID === v.VersionID; }).forEach(function (m) { met[m.MethodID] = m; });
  _v67Objs_(t, function (p) { return String(p.TUID) === String(v.TUID) && _v65On_(p.Active); }).forEach(function (p) { _v67Set_(t, p._row, 'Active', false); _v67Set_(t, p._row, 'Активен', false); _v67Set_(t, p._row, 'DateTo', now); });
  _v66Objs_('IND', function (x) { return x.VersionID === v.VersionID && Number(x.LabFrequencyDays) > 0; }).forEach(function (x) {
    var m = met[x.MethodID] || {}, id = 'LP' + Date.now() + '-' + (++n), norm = x.NormText || ((x.NormMin !== '' ? 'от ' + x.NormMin + ' ' : '') + (x.NormMax !== '' ? 'до ' + x.NormMax : '') + (x.Unit ? ' ' + x.Unit : ''));
    _v67Add_(t, { ID: id, 'Объект контроля': doc.ProductName, 'Тип объекта': MC_V67_OBJ.FINISHED, 'Вид исследования': x.Indicator, 'Периодичность, дней': x.LabFrequencyDays, 'Норматив': norm, 'Лаборатория': m.Laboratory || '',
      'Ответственный': 'Ответственный за ХАССП', 'Активен': true, 'Создано': now, PlanID: id, TUID: v.TUID, ObjectType: 'FINISHED', ObjectName: doc.ProductName, ProductID: String(doc.ProductIDs || '').split(',')[0] || '',
      Indicator: x.Indicator, Normative: norm, Method: m.Name ? m.Name + (m.StandardRef ? ' (' + m.StandardRef + ')' : '') : '', FrequencyDays: x.LabFrequencyDays, SampleCount: 1, Laboratory: m.Laboratory || '',
      ResponsibleRole: 'Ответственный за ХАССП', Active: true, DateFrom: v.DateFrom || now, SourceDocumentID: 'ТУ ' + doc.Number + ' v' + v.Version, NormMin: x.NormMin, NormMax: x.NormMax, NormText: x.NormText, Unit: x.Unit,
      ActionOnFail: 'блокировка партии, повторное исследование, отклонение и корректирующее действие', Basis: 'ТУ', TUIndicatorID: x.IndicatorID });
  });
  return n;
}

/* ---------------- отбор проб ---------------- */
function _v67BatchCtx_(batchId) {
  var b = _bcFind_(batchId); if (!b) return null;
  var src = String(b.v[7] || ''), pid = /^Производство\s+(\S+)/.exec(src), ttk = '', ttkVer = '';
  if (pid) { try { var pr = _productionSheet_().getDataRange().getValues(); for (var i = 1; i < pr.length; i++) if (String(pr[i][0]) === pid[1]) { ttk = String(pr[i][3]); ttkVer = pr[i][4] || ''; break; } } catch (e) {} }
  if (!ttk) { var dd = _v64DishOf_(String(b.v[1])); if (dd) { ttk = dd.code; try { ttkVer = _effectiveTTKVersion_(dd.code) || ''; } catch (e) {} } }
  var tu = null; try { tu = _v66ActiveFor_(ttk || String(b.v[1])); } catch (e) {}
  return { b: b, product: String(b.v[1]), productId: String(b.v[17] || ''), received: _v64Date_(b.v[4]), status: String(b.v[10] || ''), ttk: ttk, ttkVer: ttkVer, tu: tu };
}
/** Отбор пробы (§17.4). Время отбора — не позже текущего, не раньше чем за 24 ч и не раньше появления партии. */
function v67TakeSample(json, token) {
  var op = null; try { op = _beginOp_(token, 'lab_edit|lab', 'V67_SAMPLE', 'Лаборатория', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), plan = d.planId ? _v67PlanOf_(d.planId) : null;
    if (d.planId && !plan) return _v67Fail_(op, 'NOT_FOUND', 'План исследования не найден');
    var type = String(d.objectType || (plan && plan.ObjectType) || '').toUpperCase(); if (!MC_V67_OBJ[type]) return _v67Fail_(op, 'VALIDATION', 'Укажите вид объекта отбора');
    var ctx = d.batchId ? _v67BatchCtx_(d.batchId) : null;
    if (MC_V67_BATCH_OBJ.indexOf(type) >= 0 && !ctx) return _v67Fail_(op, 'VALIDATION', 'Для «' + MC_V67_OBJ[type] + '» проба отбирается от существующей партии — укажите партию');
    var now = new Date(), at = d.sampledAt ? _v64Date_(d.sampledAt) : now;
    if (!at) return _v67Fail_(op, 'VALIDATION', 'Время отбора не распознано');
    if (at.getTime() > now.getTime() + 5 * 60000) return _v67Fail_(op, 'VALIDATION', 'Время отбора позже текущего');
    if (at.getTime() < now.getTime() - 24 * 3600000) return _v67Fail_(op, 'BACKDATED', 'Отбор фиксируется в момент отбора: время отбора раньше чем за 24 часа — оформляется корректировкой с причиной');
    if (ctx && ctx.received && at.getTime() < ctx.received.getTime() - 60000) return _v67Fail_(op, 'BACKDATED', 'Проба не может быть отобрана раньше появления партии (' + _v65Fmt_(ctx.received) + ')');
    var q = _v64Num_(d.quantity); if (!(q > 0)) return _v67Fail_(op, 'VALIDATION', 'Масса или объём образца — больше нуля');
    if (!String(d.container || '').trim()) return _v67Fail_(op, 'VALIDATION', 'Укажите тару');
    if (!String(d.labelMethod || '').trim()) return _v67Fail_(op, 'VALIDATION', 'Укажите способ маркировки образца');
    var lab = String(d.laboratory || (plan && plan.Laboratory) || '').trim(); if (!lab) return _v67Fail_(op, 'VALIDATION', 'Укажите лабораторию-получателя');
    var t = d.temperature === '' || d.temperature === undefined ? '' : _v64Num_(d.temperature);
    var tuX = d.tuId ? _v66Doc_(d.tuId) : null;   // проба для разработки / подтверждения ТУ (лабораторная проверка ТУ)
    if (d.tuId && !tuX) return _v67Fail_(op, 'NOT_FOUND', 'ТУ не найдены');
    return _withLock_(function () {
      var id = _v67Id_('SMP'), w = _v65Who_(op), ev = d.evidence ? _v67File_(d.evidence, 'Проба ' + id) : null, hold = '';
      if (ctx && (d.holdBatch === true || d.holdBatch === 'true')) hold = _mcBlockObject_('BATCH', ctx.b.v[0], 'лабораторный контроль: до получения протокола по пробе ' + id, { actor: w.name }) || '';
      _v67Add_(_v67Smp_(), { SampleID: id, PlanID: plan ? (plan.PlanID || plan.ID) : '', BatchID: ctx ? ctx.b.v[0] : '', ProductID: ctx ? ctx.productId : (plan ? plan.ProductID : ''), TTKID: ctx ? ctx.ttk : '', TTKVersion: ctx ? ctx.ttkVer : '',
        TUID: tuX ? tuX.TUID : (ctx && ctx.tu ? ctx.tu.tuId : (plan ? plan.TUID : '')), TUVersion: tuX ? (_v66Ver_(tuX.CurrentVersion) || {}).Version || '' : (ctx && ctx.tu ? ctx.tu.version : ''), ObjectType: type, ObjectName: d.objectName || (ctx ? ctx.product : (plan ? plan.ObjectName : '')),
        SampledAt: at, RecordedAt: now, Quantity: q, Unit: d.unit || 'г', Container: d.container, StorageTransport: d.storageTransport || '', Temperature: t, Place: d.place || '', EmployeeID: w.id, EmployeeName: w.name,
        LabelMethod: d.labelMethod, Laboratory: lab, TransferDocument: '', TransferredAt: '', EvidenceFileID: ev ? ev.fileId : '', EvidenceHash: ev ? ev.sha256 : '', Status: 'TAKEN', OperationID: op.id, HoldBlockID: hold });
      if (ctx) try { _mcCreateTraceLink_('BATCH', String(ctx.b.v[0]), 'ОТОБРАНА_ЛАБ_ПРОБА', 'LAB_SAMPLE', id, { actor: w.name, source: 'V67', weight: q, unit: d.unit || 'г' }); } catch (e) {}
      _audit_(op, 'V67_SAMPLE', 'Лаборатория_Отбор', id, null, { batch: ctx ? ctx.b.v[0] : '', plan: plan ? (plan.PlanID || plan.ID) : '', at: at.toISOString(), hold: hold });
      _endOp_(op); return _ok_({ sampleId: id, batchId: ctx ? ctx.b.v[0] : '', tu: ctx && ctx.tu ? ctx.tu : null, ttk: ctx ? ctx.ttk : '', holdBlockId: hold }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v67SampleOf_(id) { return _v67Objs_(_v67Smp_(), function (s) { return s.SampleID === id; })[0] || null; }
function v67TransferSample(json, token) {
  var op = null; try { op = _beginOp_(token, 'lab_edit|lab', 'V67_TRANSFER', 'Лаборатория', null, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v64Json_(json); if (!String(d.document || '').trim()) return _v67Fail_(op, 'VALIDATION', 'Укажите документ передачи (акт / направление)');
    return _withLock_(function () { var s = _v67SampleOf_(d.sampleId); if (!s) return _v67Fail_(op, 'NOT_FOUND', 'Проба не найдена'); if (s.Status !== 'TAKEN') return _v67Fail_(op, 'VALIDATION', 'Проба уже передана или отменена');
      var t = _v67Smp_(); _v67Set_(t, s._row, 'TransferDocument', d.document); _v67Set_(t, s._row, 'TransferredAt', new Date()); _v67Set_(t, s._row, 'Status', 'TRANSFERRED');
      _audit_(op, 'V67_TRANSFER', 'Лаборатория_Отбор', d.sampleId, 'TAKEN', { document: d.document }); _endOp_(op); return _ok_({ sampleId: d.sampleId, status: 'TRANSFERRED' }, op.id); });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Исправить связь пробы с партией (или время отбора): только корректировкой с причиной; прежняя запись — «отменена». */
function v67CorrectSample(json, token) {
  var op = null; try { op = _beginOp_(token, 'lab_approve', 'V67_SAMPLE_CORRECT', 'Лаборатория', null, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v64Json_(json); if (String(d.reason || '').trim().length < 5) return _v67Fail_(op, 'VALIDATION', 'Укажите причину корректировки');
    return _withLock_(function () { var s = _v67SampleOf_(d.sampleId), t = _v67Smp_(); if (!s || s.Status === 'CANCELLED') return _v67Fail_(op, 'NOT_FOUND', 'Проба не найдена или отменена');
      var ctx = d.batchId ? _v67BatchCtx_(d.batchId) : null; if (d.batchId && !ctx) return _v67Fail_(op, 'NOT_FOUND', 'Партия не найдена');
      var at = d.sampledAt ? _v64Date_(d.sampledAt) : _v64Date_(s.SampledAt); if (!at || at > new Date()) return _v67Fail_(op, 'VALIDATION', 'Время отбора не распознано или позже текущего');
      if (ctx && ctx.received && at < ctx.received) return _v67Fail_(op, 'VALIDATION', 'Проба не может быть раньше появления партии');
      var o = {}; t.h.forEach(function (c) { o[c] = s[c]; }); var id = _v67Id_('SMP');
      Object.assign(o, { SampleID: id, BatchID: ctx ? ctx.b.v[0] : s.BatchID, ProductID: ctx ? ctx.productId : s.ProductID, TTKID: ctx ? ctx.ttk : s.TTKID, TUID: ctx && ctx.tu ? ctx.tu.tuId : s.TUID, SampledAt: at, RecordedAt: new Date(),
        CorrectionOf: s.SampleID, CorrectionReason: d.reason, OperationID: op.id, Status: s.Status === 'TAKEN' ? 'TAKEN' : 'TRANSFERRED' });
      _v67Add_(t, o); _v67Set_(t, s._row, 'Status', 'CANCELLED');
      _audit_(op, 'V67_SAMPLE_CORRECT', 'Лаборатория_Отбор', s.SampleID, { batch: s.BatchID, at: String(s.SampledAt) }, { newSample: id, batch: o.BatchID, at: at.toISOString(), reason: d.reason });
      _endOp_(op); return _ok_({ sampleId: id, correctionOf: s.SampleID }, op.id); });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- протокол и сравнение ---------------- */
/** Сравнение факта с нормативом: числа — по границам (поддерживается «<10», «>1000»); текст — «не обнаружено» против «не допускается». */
function _v67Eval_(fact, min, max, normText) {
  var f = String(fact === null || fact === undefined ? '' : fact).trim(), nt = String(normText || '').toLowerCase();
  if (!f) return 'PENDING';
  if (/^(не применим|неприменим|n\/a|na)$/i.test(f)) return 'NOT_APPLICABLE';
  var lo = min === '' || min === null || min === undefined ? null : Number(min), hi = max === '' || max === null || max === undefined ? null : Number(max);
  // научная запись протоколов: 1,5×10^3 · 1,5·10³ · 1.5x10(3) · 2.0e2 — показатель степени обязателен к учёту
  var sup = { '⁰': 0, '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9, '⁻': '-' };
  var g = f.replace(/\s+/g, ' ').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, function (x) { return '^' + x.split('').map(function (c) { return sup[c]; }).join(''); });
  var m = /^([<>]=?|≤|≥|менее|более|не более|не менее)?\s*(-?\d+(?:[.,]\d+)?)(?:\s*(?:[×xх*·]\s*10\s*(?:\^|\()?\s*([+-]?\d+)\)?|[eе]([+-]?\d+)))?\s*([^\d]*)$/i.exec(g);
  if (/\d/.test(g) && (lo !== null || hi !== null) && !m) return 'REVIEW';   // запись с числом, но нераспознанная — экспертная оценка, не угадывание
  if (m && (lo !== null || hi !== null)) {
    var v = parseFloat(m[2].replace(',', '.')), ex = m[3] !== undefined ? m[3] : m[4]; if (ex !== undefined) v = v * Math.pow(10, +ex);
    var op = String(m[1] || '').toLowerCase().replace('≤', '<=').replace('≥', '>=');
    if (op === '<' || op === '<=' || op === 'менее' || op === 'не более') { if (hi !== null && v <= hi) return 'PASS'; if (lo !== null && v <= lo) return 'FAIL'; return hi !== null ? 'FAIL' : 'REVIEW'; }
    if (op === '>' || op === '>=' || op === 'более' || op === 'не менее') { if (hi !== null && v >= hi) return 'FAIL'; if (lo !== null && v >= lo && hi === null) return 'PASS'; return 'REVIEW'; }
    if (lo !== null && v < lo) return 'FAIL'; if (hi !== null && v > hi) return 'FAIL'; return 'PASS';
  }
  var notFound = /не\s*обнаруж|не\s*выявл|отсутств|не\s*найден/i.test(f), found = !notFound && /обнаруж|выявл|присутств/i.test(f);
  if (/не\s*допуска|отсутств|не\s*обнаруж|не\s*должн/.test(nt)) { if (notFound) return 'PASS'; if (found) return 'FAIL'; }
  return 'REVIEW';
}
/** Загрузка протокола (§17.5): файл и хеш, строки показателей, сравнение с нормативом, автоматические действия, стоимость. */
function v67UploadProtocol(json, token) {
  var op = null; try { op = _beginOp_(token, 'lab_upload|lab', 'V67_PROTOCOL', 'Лаборатория', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), s = d.sampleId ? _v67SampleOf_(d.sampleId) : null, plan = (s && s.PlanID) || d.planId ? _v67PlanOf_((s && s.PlanID) || d.planId) : null;
    if (d.sampleId && (!s || s.Status === 'CANCELLED')) return _v67Fail_(op, 'NOT_FOUND', 'Проба не найдена или отменена');
    if (!s && MC_V67_BATCH_OBJ.indexOf(String((plan && plan.ObjectType) || '').toUpperCase()) >= 0) return _v67Fail_(op, 'VALIDATION', 'Протокол по продукции загружается к отобранной пробе');
    if (!String(d.protocolNo || '').trim()) return _v67Fail_(op, 'VALIDATION', 'Укажите номер протокола');
    var lab = String(d.laboratory || (s && s.Laboratory) || (plan && plan.Laboratory) || '').trim(); if (!lab) return _v67Fail_(op, 'VALIDATION', 'Укажите лабораторию');
    var rd = _v64DateArg_(d.resultDate, new Date(), 'Дата результата'); if (rd > new Date()) return _v67Fail_(op, 'VALIDATION', 'Дата результата позже сегодняшней');
    var lines = (d.results || []).filter(function (x) { return x && String(x.indicator || '').trim(); });
    if (!lines.length && plan) lines = [{ indicator: plan.Indicator || plan['Вид исследования'], factValue: d.factValue, unit: d.unit }];
    if (!lines.length) return _v67Fail_(op, 'VALIDATION', 'Добавьте показатели протокола');
    if (!d.file && !d.fileId) return _v67Fail_(op, 'VALIDATION', 'Приложите файл протокола (PDF или фото) — без файла протокол не принимается');
    var cost = d.cost ? _v64Num_(d.cost) : 0, level = String(d.costLevel || (s && s.BatchID ? 'BATCH' : 'ENTERPRISE')).toUpperCase();
    if (cost && ['ENTERPRISE', 'BATCH', 'TU'].indexOf(level) < 0) return _v67Fail_(op, 'VALIDATION', 'Уровень стоимости: ENTERPRISE (контроль предприятия), BATCH (партия), TU (разработка ТУ)');
    if (cost && level === 'BATCH' && !(s && s.BatchID)) return _v67Fail_(op, 'VALIDATION', 'Стоимость на партию — только для пробы от партии');
    if (cost && level === 'TU' && !((s && s.TUID) || (plan && plan.TUID) || d.tuId)) return _v67Fail_(op, 'VALIDATION', 'Стоимость разработки ТУ — укажите ТУ');
    return _withLock_(function () {
      var file = d.file ? _v67File_(d.file, 'Протокол ' + d.protocolNo) : { fileId: String(d.fileId), sha256: String(d.fileHash || '') };
      var t = _v67Res_(), w = _v65Who_(op), now = new Date(), out = [], tuId = (s && s.TUID) || (plan && plan.TUID) || d.tuId || '';
      // нормы показателей — из версии ТУ, к которой отобрана проба (на лабораторной проверке — проверяемая версия), иначе из действующей
      var tuInd = {}; if (tuId) { try { var tv = _v66Doc_(tuId), vv = null;
        if (tv && s && s.TUVersion !== '') vv = _v66Objs_('VER', function (x) { return x.TUID === tuId && String(x.Version) === String(s.TUVersion); })[0];
        var vid = vv ? vv.VersionID : (tv ? (tv.ActiveVersion || tv.CurrentVersion) : '');
        if (vid) _v66Objs_('IND', function (x) { return x.VersionID === vid; }).forEach(function (x) { tuInd[_v64Key_(x.Indicator)] = x; }); } catch (e) {} }
      lines.forEach(function (x, i) {
        var ti = tuInd[_v64Key_(x.indicator)] || {}, pm = plan && _v64Key_(plan.Indicator || plan['Вид исследования']) === _v64Key_(x.indicator) ? plan : null;
        var mn = x.normMin !== undefined && x.normMin !== '' ? x.normMin : (pm && pm.NormMin !== '' ? pm.NormMin : (ti.NormMin !== undefined ? ti.NormMin : ''));
        var mx = x.normMax !== undefined && x.normMax !== '' ? x.normMax : (pm && pm.NormMax !== '' ? pm.NormMax : (ti.NormMax !== undefined ? ti.NormMax : ''));
        var nt = x.normText || (pm && (pm.NormText || pm.Normative)) || ti.NormText || '';
        var res = x.result === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : _v67Eval_(x.factValue, mn, mx, nt), id = _v67Id_('RES') + '-' + (i + 1);
        var o = { ID: id, 'ID плана': plan ? (plan.PlanID || plan.ID) : '', 'Объект контроля': (s && s.ObjectName) || (plan && plan.ObjectName) || '', 'Тип объекта': MC_V67_OBJ[(s && s.ObjectType) || (plan && plan.ObjectType)] || '',
          'Вид исследования': x.indicator, 'Партия': s ? s.BatchID : '', 'Дата отбора': s ? s.SampledAt : '', 'Лаборатория': lab, 'Номер протокола': d.protocolNo, 'Дата результата': rd,
          'Результат': res === 'PASS' ? 'соответствует' : res === 'FAIL' ? 'не соответствует' : MC_V67_RES_RU[res], 'Показатели (JSON)': JSON.stringify([{ показатель: x.indicator, факт: x.factValue, норма: nt || (mn + '…' + mx) }]),
          'Ссылка на протокол': file.fileId ? 'https://drive.google.com/file/d/' + file.fileId + '/view' : '', 'Ответственный': w.name, 'Статус': res === 'PENDING' ? 'ожидает результата' : 'завершено', operation_id: op.id, 'Создано': now,
          ResearchID: id, PlanID: plan ? (plan.PlanID || plan.ID) : '', SampleID: s ? s.SampleID : '', BatchID: s ? s.BatchID : '', ProductID: s ? s.ProductID : (plan ? plan.ProductID : ''), TTKID: s ? s.TTKID : '', TUID: tuId,
          Laboratory: lab, ProtocolNo: d.protocolNo, SamplingDate: s ? s.SampledAt : (d.samplingDate ? _v64Date_(d.samplingDate) : ''), ResultDate: rd, Indicator: x.indicator, Method: x.method || (pm && pm.Method) || '', NormMin: mn, NormMax: mx,
          FactValue: x.factValue === undefined ? '' : String(x.factValue), Unit: x.unit || (pm && pm.Unit) || ti.Unit || '', Result: res, Status: res === 'PASS' ? 'ADMIT_PROPOSED' : res === 'FAIL' ? 'NONCONFORMING' : res === 'REVIEW' ? 'EXPERT_REVIEW' : res,
          FileID: file.fileId, Hash: file.sha256, Responsible: w.name, OperationID: op.id, DeviationID: '', CreatedAt: now, NormText: nt, Decision: '', CostAmount: i === 0 && cost ? cost : '', CostLevel: i === 0 && cost ? level : '' };
        // повторное исследование: протокол закрывает задачу RETEST_REQUIRED той же партии / пробы и показателя
        var rt = _v67Objs_(t, function (r) { return r.Status === 'RETEST_REQUIRED' && r.Result === 'PENDING' && _v64Key_(r.Indicator) === _v64Key_(x.indicator) &&
          ((s && s.BatchID && String(r.BatchID) === String(s.BatchID)) || (s && String(r.SampleID) === String(s.SampleID)) || (!s && plan && String(r.PlanID) === String(plan.PlanID || plan.ID))); })[0];
        if (rt) { o.ResearchID = rt.ResearchID; o.ID = rt.ID || rt.ResearchID; o.RetestOf = rt.RetestOf; o.DeviationID = rt.DeviationID; o.CreatedAt = rt.CreatedAt || now; o['Создано'] = rt['Создано'] || now;
          t.sh.getRange(rt._row, 1, 1, t.h.length).setValues([_v67Arr_(t, o)]); }
        else _v67Add_(t, o);
        out.push(o);
      });
      if (s) _v67Set_(_v67Smp_(), s._row, 'Status', 'TESTED');
      var fails = out.filter(function (x) { return x.Result === 'FAIL'; }), reviews = out.filter(function (x) { return x.Result === 'REVIEW'; }), actions = [];
      if (fails.length) {
        var msg = 'Лаборатория: ' + fails.map(function (x) { return x.Indicator + ' = ' + x.FactValue + ' (норматив ' + (x.NormText || (x.NormMin + '…' + x.NormMax)) + ')'; }).join('; ') + ' — протокол ' + d.protocolNo + (s && s.BatchID ? ', партия ' + s.BatchID : '');
        var dev = _mcOpenDeviationAndAction_({ journalId: 'LAB', objectId: (s && s.BatchID) || (plan && (plan.PlanID || plan.ID)) || d.protocolNo, batchId: s ? s.BatchID : '', value: fails[0].FactValue, critical: true, description: msg },
          op.session, 'LAB_PROTOCOL', msg, s && s.BatchID ? 'CRITICAL' : 'HIGH') || {};
        fails.forEach(function (x) { var row = _v67Objs_(t, function (r) { return r.ResearchID === x.ResearchID; })[0];
          _v67Set_(t, row._row, 'DeviationID', dev.deviationId || ''); _v67Set_(t, row._row, 'CorrectiveActionID', dev.correctiveActionId || ''); _v67Set_(t, row._row, 'BlockID', dev.blockId || '');
          var rid = _v67Id_('RET'); _v67Add_(t, { ID: rid, 'ID плана': x.PlanID, 'Объект контроля': x['Объект контроля'], 'Вид исследования': x.Indicator, 'Партия': x.BatchID, 'Лаборатория': lab, 'Статус': 'ожидает результата', 'Создано': now,
            ResearchID: rid, PlanID: x.PlanID, SampleID: x.SampleID, BatchID: x.BatchID, ProductID: x.ProductID, TTKID: x.TTKID, TUID: x.TUID, Laboratory: lab, Indicator: x.Indicator, Method: x.Method, NormMin: x.NormMin, NormMax: x.NormMax,
            NormText: x.NormText, Unit: x.Unit, Result: 'PENDING', Status: 'RETEST_REQUIRED', RetestOf: x.ResearchID, DeviationID: dev.deviationId || '', Responsible: '', CreatedAt: now }); });
        try { _notify_('lab_failed', 'critical', 'Лаборатория: несоответствие — ' + ((s && s.ObjectName) || (plan && plan.ObjectName) || ''), msg + (dev.blockId ? '. Партия заблокирована.' : '') + ' Назначено повторное исследование.', 'Ответственный за ХАССП', 'v67fail|' + d.protocolNo, op); } catch (e) {}
        actions = ['отклонение ' + (dev.deviationId || ''), 'корректирующее действие ' + (dev.correctiveActionId || ''), dev.blockId ? 'партия заблокирована' : '', 'повторное исследование назначено', 'уведомлён ответственный за ХАССП'].filter(String);
      } else if (reviews.length) {
        try { _notify_('lab_review', 'warning', 'Лаборатория: нужна экспертная оценка — ' + ((s && s.ObjectName) || ''), reviews.map(function (x) { return x.Indicator + ' = ' + x.FactValue; }).join('; ') + ', протокол ' + d.protocolNo, 'Ответственный за ХАССП', 'v67rev|' + d.protocolNo, op); } catch (e) {}
        actions = ['нужна экспертная оценка (решение ответственного с правом lab_approve)'];
      } else actions = [s && s.BatchID ? 'результаты соответствуют — допуск партии подтверждает ответственный с правом lab_approve' : 'результаты соответствуют'];
      if (cost) _v67Cost_(cost, level, s, tuId, d.protocolNo, op);
      _audit_(op, 'V67_PROTOCOL', 'Лаборатория_Исследования', d.protocolNo, null, { sample: s ? s.SampleID : '', batch: s ? s.BatchID : '', results: out.map(function (x) { return x.Indicator + ':' + x.Result; }), file: file.sha256, cost: cost, level: cost ? level : '' });
      _endOp_(op);
      return _ok_({ protocolNo: d.protocolNo, results: out.map(function (x) { return { researchId: x.ResearchID, indicator: x.Indicator, fact: x.FactValue, result: x.Result, resultRu: MC_V67_RES_RU[x.Result], deviationId: x.DeviationID }; }),
        overall: fails.length ? 'FAIL' : reviews.length ? 'REVIEW' : (out.every(function (x) { return x.Result === 'NOT_APPLICABLE'; }) ? 'NOT_APPLICABLE' : 'PASS'), actions: actions, fileId: file.fileId, sha256: file.sha256 }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Стоимость исследования (§17.6): партия — доп. расход партии; предприятие — управленческий расход ППК; ТУ — разработка и подтверждение ТУ. */
function _v67Cost_(amount, level, s, tuId, protocolNo, op) {
  var who = _v64Who_(op), now = new Date();
  if (level === 'BATCH') _v64Append_('OPS', { FinOpID: _v64Id_('FOP'), Date: now, Type: 'LAB_COST', DocumentRef: 'протокол ' + protocolNo, BatchID: s.BatchID, Amount: _v64R2_(amount), AllocationMode: 'BATCH',
    Comment: 'лабораторное исследование партии', Status: 'ACTIVE', CreatedAt: now, CreatedBy: who, OperationID: op.id });
  else _v64Append_('EXP', { ExpenseID: _v64Id_('EXP'), Date: now, PeriodFrom: now, PeriodTo: now, Category: level === 'TU' ? 'Разработка и подтверждение ТУ' : 'Лабораторный контроль (ППК)', Amount: _v64R2_(amount),
    Document: 'протокол ' + protocolNo, Workshop: '', Comment: level === 'TU' ? 'ТУ ' + tuId : 'программа производственного контроля', Status: 'ACTIVE', CreatedAt: now, CreatedBy: who, OperationID: op.id });
}

/* ---------------- решения ---------------- */
function _v67ReleaseBlocks_(batchId, reason, who) {
  var sh = _mcBlocksSheet_(), v = sh.getDataRange().getValues(), n = 0;
  for (var i = 1; i < v.length; i++) if (String(v[i][1]) === 'BATCH' && String(v[i][2]) === String(batchId) && String(v[i][9]) === 'ACTIVE') {
    sh.getRange(i + 1, 10, 1, 4).setValues([['RELEASED', new Date(), who, reason]]); n++; }
  if (n) { var b = _bcFind_(batchId); if (b && String(b.v[10]) === 'blocked') _bcSetStatus_(b, 'active'); }
  return n;
}
/**
 * Решение по результатам (lab_approve): ADMIT — допуск партии (снятие лабораторных блокировок; нельзя при несоответствии без
 * повторного исследования «соответствует»); BLOCK — блокировка; RETEST — повторное исследование; WASTE / RETURN — партия остаётся
 * заблокированной, списание или возврат оформляет склад; ACCEPT / REJECT — экспертная оценка результата REVIEW.
 */
function v67Decide(json, token) {
  var op = null; try { op = _beginOp_(token, 'lab_approve', 'V67_DECIDE', 'Лаборатория', null, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v64Json_(json), dec = String(d.decision || '').toUpperCase(), cm = String(d.comment || '').trim();
    if (['ADMIT', 'BLOCK', 'RETEST', 'WASTE', 'RETURN', 'ACCEPT', 'REJECT'].indexOf(dec) < 0) return _v67Fail_(op, 'VALIDATION', 'Решение: ADMIT, BLOCK, RETEST, WASTE, RETURN, ACCEPT, REJECT');
    if (!cm) return _v67Fail_(op, 'VALIDATION', 'Укажите обоснование решения');
    return _withLock_(function () {
      var t = _v67Res_(), r = _v67Objs_(t, function (x) { return x.ResearchID === d.researchId; })[0]; if (!r) return _v67Fail_(op, 'NOT_FOUND', 'Исследование не найдено');
      var w = _v65Who_(op), batch = String(r.BatchID || ''), now = new Date(), extra = {};
      var mark = function (row, status) { _v67Set_(t, row._row, 'Decision', dec); _v67Set_(t, row._row, 'DecisionBy', w.name); _v67Set_(t, row._row, 'DecisionAt', now); if (status) _v67Set_(t, row._row, 'Status', status); };
      if (dec === 'ACCEPT' || dec === 'REJECT') {
        if (r.Result !== 'REVIEW') return _v67Fail_(op, 'VALIDATION', 'Экспертная оценка — для результата «требует экспертной оценки»');
        _v67Set_(t, r._row, 'Result', dec === 'ACCEPT' ? 'PASS' : 'FAIL'); _v67Set_(t, r._row, 'Результат', dec === 'ACCEPT' ? 'соответствует' : 'не соответствует'); mark(r, dec === 'ACCEPT' ? 'ADMIT_PROPOSED' : 'NONCONFORMING');
        if (dec === 'REJECT') { var dv = _mcOpenDeviationAndAction_({ journalId: 'LAB', objectId: batch || r.ResearchID, batchId: batch, value: r.FactValue, critical: true, description: 'Экспертная оценка: ' + r.Indicator + ' не соответствует — ' + cm }, op.session, 'LAB_EXPERT', cm, batch ? 'CRITICAL' : 'HIGH') || {};
          _v67Set_(t, r._row, 'DeviationID', dv.deviationId || ''); _v67Set_(t, r._row, 'CorrectiveActionID', dv.correctiveActionId || ''); _v67Set_(t, r._row, 'BlockID', dv.blockId || ''); extra.deviationId = dv.deviationId; }
      } else if (dec === 'ADMIT') {
        if (!batch) return _v67Fail_(op, 'VALIDATION', 'Допуск — решение по партии');
        var all = _v67Objs_(t, function (x) { return String(x.BatchID) === batch; });
        // несоответствие закрыто, если цепочка повторных исследований (повтор повтора…) закончилась результатом «соответствует»
        var resolved = function (x, depth) { return depth < 10 && all.some(function (y) { return y.RetestOf === x.ResearchID && (y.Result === 'PASS' || (y.Result === 'FAIL' && resolved(y, depth + 1))); }); };
        var openFail = all.filter(function (x) { return x.Result === 'FAIL' && !resolved(x, 0); });
        var pending = all.filter(function (x) { return x.Result === 'PENDING' || x.Result === 'REVIEW'; });
        if (openFail.length) return _v67Fail_(op, 'LAB_FAIL_OPEN', 'Допуск невозможен: несоответствие без повторного исследования «соответствует» — ' + openFail.map(function (x) { return x.Indicator; }).join(', '));
        if (pending.length) return _v67Fail_(op, 'LAB_PENDING', 'Допуск невозможен: ожидаются результаты или экспертная оценка — ' + pending.map(function (x) { return x.Indicator; }).join(', '));
        var b = _bcFind_(batch); if (!b) return _v67Fail_(op, 'NOT_FOUND', 'Партия не найдена');
        extra.released = _v67ReleaseBlocks_(batch, 'лабораторный допуск: ' + cm, w.name);
        _bcRelease_(b, 'LAB', 'RELEASE', 'лабораторный допуск: ' + cm, { name: w.name, role: w.role }, op.id, '');
        all.filter(function (x) { return x.Result === 'PASS' && !x.Decision; }).forEach(function (x) { mark(x, 'ADMITTED'); }); mark(r, 'ADMITTED');
      } else if (dec === 'BLOCK') {
        if (!batch) return _v67Fail_(op, 'VALIDATION', 'Блокировка — решение по партии'); extra.blockId = _mcBlockObject_('BATCH', batch, 'решение лаборатории: ' + cm, { actor: w.name }); mark(r, 'BLOCKED');
      } else if (dec === 'RETEST') {
        var rid = _v67Id_('RET'); _v67Add_(t, { ID: rid, 'ID плана': r.PlanID, 'Объект контроля': r['Объект контроля'], 'Вид исследования': r.Indicator, 'Партия': batch, 'Лаборатория': r.Laboratory, 'Статус': 'ожидает результата', 'Создано': now,
          ResearchID: rid, PlanID: r.PlanID, SampleID: r.SampleID, BatchID: batch, ProductID: r.ProductID, TUID: r.TUID, Laboratory: r.Laboratory, Indicator: r.Indicator, Method: r.Method, NormMin: r.NormMin, NormMax: r.NormMax,
          NormText: r.NormText, Unit: r.Unit, Result: 'PENDING', Status: 'RETEST_REQUIRED', RetestOf: r.ResearchID, DeviationID: r.DeviationID, CreatedAt: now }); mark(r, ''); extra.retestId = rid;
      } else { if (!batch) return _v67Fail_(op, 'VALIDATION', 'Списание / возврат — решение по партии'); extra.blockId = _mcBlockObject_('BATCH', batch, (dec === 'WASTE' ? 'к списанию' : 'к возврату поставщику') + ' по решению лаборатории: ' + cm, { actor: w.name });
        mark(r, dec === 'WASTE' ? 'TO_WASTE' : 'TO_RETURN'); try { _notify_('lab_decision', 'warning', 'Партия ' + batch + ': ' + (dec === 'WASTE' ? 'списать' : 'вернуть поставщику'), cm + ' — оформите на складе', 'Шеф-повар', 'v67dec|' + r.ResearchID, op); } catch (e) {} }
      _audit_(op, 'V67_DECIDE', 'Лаборатория_Исследования', r.ResearchID, { result: r.Result, status: r.Status }, { decision: dec, comment: cm, batch: batch, extra: extra }); _endOp_(op);
      return _ok_({ researchId: r.ResearchID, decision: dec, batchId: batch, extra: extra }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- сводка, цепочка, финансовое влияние ---------------- */
function _v67Impact_(devId) {
  var t = _v67Res_(), rows = _v67Objs_(t, function (x) { return String(x.DeviationID) === String(devId); }); if (!rows.length) return null;
  var batch = rows[0].BatchID, out = { deviationId: devId, batchId: batch, research: rows.map(function (x) { return x.ResearchID; }), items: [] };
  try {
    var B = _v64Batches_(), b = B[batch];
    if (b) out.items.push({ kind: 'Блокировка партии: замороженная стоимость остатка', amount: _v64R2_(b.remain * _v64EffPrice_(b)), status: b.status });
    // исследования по отклонению: исходный протокол и повторные (у повторных тот же DeviationID)
    out.items.push({ kind: 'Стоимость исследований по отклонению (включая повторные)', amount: _v64R2_(rows.reduce(function (a, x) { return a + (Number(x.CostAmount) || 0); }, 0)) });
    if (batch) { var L = _v64Build_(null).lines.filter(function (l) { return l.batch === batch && (l.stage === 'WASTE' || (l.stage === 'RETURN' && l.dir === 'OUT')); });
      out.items.push({ kind: 'Списание и возврат поставщику по партии', amount: _v64R2_(L.reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0)) }); }
    var ct = _v64Tab_('Финансы_Корректировки'); out.items.push({ kind: 'Корректировки себестоимости по отклонению', amount: _v64R2_(ct.rows.filter(function (r) { return String(_v64G_(ct, r, 'DeviationID')) === String(devId) && String(_v64G_(ct, r, 'Status')) === 'CONFIRMED'; }).reduce(function (a, r) { return a + _v64Num_(_v64G_(ct, r, 'Amount')); }, 0)) });
  } catch (e) { out.error = String(e); }
  out.total = _v64R2_(out.items.reduce(function (a, x) { return a + (Number(x.amount) || 0); }, 0));
  return out;
}
/** Цепочка §18: ТУ → показатель → ППК → лабораторный план → проба и партия → протокол → решение → финансовое влияние отклонения. */
function v67GetChain(json, token) {
  try { _requireAuth_(token, 'lab_view|lab|lab_edit|lab_approve|tu_view|ppk_view|audit_view');
    var d = _v64Json_(json), t = _v67Res_(), all = _v67Objs_(t), smp = _v67Objs_(_v67Smp_()), plans = _v67Objs_(_v67Plan_());
    var res = all.filter(function (x) { return (d.researchId && x.ResearchID === d.researchId) || (d.batchId && String(x.BatchID) === String(d.batchId)) || (d.deviationId && String(x.DeviationID) === String(d.deviationId)) || (d.tuId && String(x.TUID) === String(d.tuId)); });
    var fmt = function (v) { return Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, _mcTz_(), 'yyyy-MM-dd HH:mm') : v; };
    var acts = []; try { acts = _v65Objs_('ACT'); } catch (e) {}
    var chain = res.filter(function (x) { return x.ResearchID; }).map(function (x) {
      var pl = plans.filter(function (p) { return String(p.PlanID || p.ID) === String(x.PlanID); })[0] || null, s = smp.filter(function (y) { return y.SampleID === x.SampleID; })[0] || null;
      var tu = null, ind = null; if (x.TUID) { try { tu = _v66Doc_(x.TUID); var av = tu && tu.ActiveVersion; ind = av ? _v66Objs_('IND', function (i) { return i.VersionID === av && _v64Key_(i.Indicator) === _v64Key_(x.Indicator); })[0] : null; } catch (e) {} }
      var ppk = pl ? acts.filter(function (a) { return String(a.JournalID) === 'LAB:' + String(pl.PlanID || pl.ID); }) : [];
      return { tu: tu ? { tuId: tu.TUID, number: tu.Number, product: tu.ProductName } : null, indicator: ind ? { indicator: ind.Indicator, norm: ind.NormText || (ind.NormMin + '…' + ind.NormMax), method: ind.MethodID } : { indicator: x.Indicator },
        ppk: ppk.map(function (a) { return { ppkId: a.PPKID, controlPlanId: a.ControlPlanID, frequency: a.Frequency }; }),
        plan: pl ? { planId: pl.PlanID || pl.ID, frequencyDays: pl.FrequencyDays || pl['Периодичность, дней'], method: pl.Method, basis: pl.Basis } : null,
        sample: s ? { sampleId: s.SampleID, batchId: s.BatchID, sampledAt: fmt(s.SampledAt), by: s.EmployeeName, lab: s.Laboratory, transfer: s.TransferDocument } : null,
        protocol: { researchId: x.ResearchID, protocolNo: x.ProtocolNo, resultDate: fmt(x.ResultDate), fact: x.FactValue, norm: x.NormText || (x.NormMin + '…' + x.NormMax), result: x.Result, fileId: x.FileID, hash: x.Hash, retestOf: x.RetestOf },
        decision: { decision: x.Decision || '', by: x.DecisionBy || '', at: fmt(x.DecisionAt), status: x.Status },
        deviation: x.DeviationID ? { deviationId: x.DeviationID, correctiveActionId: x.CorrectiveActionID, blockId: x.BlockID, operationId: x.OperationID, impact: _v67Impact_(x.DeviationID) } : null };
    });
    return _ok_({ query: d, chain: chain });
  } catch (e) { return _failFrom_(e); }
}
function v67GetLabDashboard(token) {
  try { _requireAuth_(token, 'lab_view|lab|lab_edit|lab_upload|lab_approve');
    var t = _v67Res_(), res = _v67Objs_(t), smp = _v67Objs_(_v67Smp_()), plans = _v67Objs_(_v67Plan_(), function (p) { return _v65On_(p.Active === '' ? p['Активен'] : p.Active) && (p.PlanID || p.ID); }), now = new Date(), day = 86400000;
    var fmt = function (v) { var x = _v64Date_(v); return x ? Utilities.formatDate(x, _mcTz_(), 'yyyy-MM-dd') : ''; };
    var schedule = plans.map(function (p) { var id = String(p.PlanID || p.ID), f = Number(p.FrequencyDays || p['Периодичность, дней']) || 0;
      var last = smp.filter(function (s) { return String(s.PlanID) === id && s.Status !== 'CANCELLED'; }).map(function (s) { return _v64Date_(s.SampledAt); }).concat(res.filter(function (r) { return String(r.PlanID || r['ID плана']) === id; }).map(function (r) { return _v64Date_(r.SamplingDate || r['Дата отбора']); })).filter(Boolean).sort(function (a, b) { return b - a; })[0];
      var next = last ? new Date(last.getTime() + f * day) : (_v64Date_(p.DateFrom) || now);
      return { planId: id, object: p.ObjectName || p['Объект контроля'], indicator: p.Indicator || p['Вид исследования'], method: p.Method || '', frequencyDays: f, laboratory: p.Laboratory || p['Лаборатория'], basis: p.Basis || '', tuId: p.TUID || '', ppkId: p.PPKID || '',
        last: last ? fmt(last) : '', next: fmt(next), overdue: next < now }; });
    var expected = smp.filter(function (s) { return s.Status === 'TAKEN' || s.Status === 'TRANSFERRED'; }).map(function (s) { var p = plans.filter(function (x) { return String(x.PlanID || x.ID) === String(s.PlanID); })[0], rdays = p ? Number(p.ResultDays) || 0 : 0, at = _v64Date_(s.SampledAt);
      return { sampleId: s.SampleID, batchId: s.BatchID, object: s.ObjectName, sampledAt: fmt(at), laboratory: s.Laboratory, status: s.Status, due: rdays && at ? fmt(new Date(at.getTime() + rdays * day)) : '', overdue: !!(rdays && at && at.getTime() + rdays * day < now.getTime()) }; });
    var bad = res.filter(function (r) { return r.Result === 'FAIL'; }).map(function (r) { return { researchId: r.ResearchID, batchId: r.BatchID, indicator: r.Indicator, fact: r.FactValue, norm: r.NormText || (r.NormMin + '…' + r.NormMax), protocol: r.ProtocolNo, deviationId: r.DeviationID, decision: r.Decision || '', status: r.Status }; });
    var review = res.filter(function (r) { return r.Result === 'REVIEW' || r.Status === 'ADMIT_PROPOSED'; }).map(function (r) { return { researchId: r.ResearchID, batchId: r.BatchID, indicator: r.Indicator, fact: r.FactValue, result: r.Result, status: r.Status }; });
    var retests = res.filter(function (r) { return r.Status === 'RETEST_REQUIRED' && r.Result === 'PENDING'; }).map(function (r) { return { researchId: r.ResearchID, batchId: r.BatchID, indicator: r.Indicator, retestOf: r.RetestOf }; });
    var blocks = []; try { var bs = _mcBlocksSheet_().getDataRange().getValues(); for (var i = 1; i < bs.length; i++) if (String(bs[i][1]) === 'BATCH' && String(bs[i][9]) === 'ACTIVE' && /лаборатор|Лаборатория/.test(String(bs[i][3]))) blocks.push({ blockId: bs[i][0], batchId: bs[i][2], reason: bs[i][3], at: fmt(bs[i][7]) }); } catch (e) {}
    var cost = res.reduce(function (a, r) { return a + (Number(r.CostAmount) || 0); }, 0);
    return _ok_({ schedule: schedule, overduePlans: schedule.filter(function (x) { return x.overdue; }).length, expected: expected, nonconforming: bad, decisions: review, retests: retests, blockedBatches: blocks,
      totalCost: _v64R2_(cost), objectTypes: MC_V67_OBJ, results: MC_V67_RES_RU, basis: MC_V67_BASIS });
  } catch (e) { return _failFrom_(e); }
}
