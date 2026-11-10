/**
 * ЦЕХ Стандарт V66 — технические условия / стандарт предприятия (ТЗ «Итоговая структура…», §16).
 *
 * ТУ применяются к продукции, на которую организация разрабатывает собственные условия; обязательных требований
 * законодательства они не заменяют и проходят внутреннее утверждение и проверку применимости.
 * Жизненный цикл версии: PROJECT (Проект) → TECH_REVIEW (Техническая проверка) → LAB_REVIEW (Лабораторная проверка) →
 * AGREEMENT (Согласование) → APPROVAL (Утверждение) → ACTIVE (Действует) → REVISION (Пересмотр) → ARCHIVED (Архив).
 * Переходы проверяются: полнота карточки, проверяющий — не разработчик, лабораторное подтверждение обязательных показателей
 * (протоколы со ссылкой на ТУ), утверждение — с правом tu_approve и выпуском PDF с реквизитами и хешем.
 * Действующая версия создаёт строки лабораторного плана по своим показателям (связь ТУ → показатель → лабплан, §18).
 */
var MC_V66 = {
  DOC: ['ТУ_Документы', ['TUID', 'Number', 'ProductName', 'Scope', 'ProductCode', 'Purpose', 'ProductIDs', 'TTKCodes', 'Status', 'CurrentVersion', 'ActiveVersion', 'Developer', 'Approver', 'CreatedAt', 'CreatedBy', 'Notes']],
  VER: ['ТУ_Версии', ['VersionID', 'TUID', 'Version', 'Status', 'DateFrom', 'DateTo', 'RawRequirements', 'IngredientRequirements', 'Organoleptic', 'StorageConditions', 'ShelfLife', 'Transport',
    'AcceptanceRules', 'SamplingRules', 'SupplierDocs', 'NonconformingDisposal', 'Developer', 'Approver', 'ApprovedAt', 'FileID', 'Hash', 'ChangeReason', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy']],
  IND: ['ТУ_Показатели', ['IndicatorID', 'TUID', 'VersionID', 'Group', 'Indicator', 'NormMin', 'NormMax', 'NormText', 'Unit', 'MethodID', 'Mandatory', 'LabFrequencyDays', 'Notes']],
  MET: ['ТУ_МетодыКонтроля', ['MethodID', 'TUID', 'VersionID', 'Name', 'StandardRef', 'Laboratory', 'Notes']],
  RAW: ['ТУ_Сырье', ['LineID', 'TUID', 'VersionID', 'Material', 'ProductID', 'Requirements', 'SupplierDocs', 'Notes']],
  PKL: ['ТУ_УпаковкаМаркировка', ['LineID', 'TUID', 'VersionID', 'Kind', 'Requirement', 'Notes']],
  APR: ['ТУ_Согласование', ['ApprovalID', 'TUID', 'VersionID', 'Stage', 'Decision', 'Comment', 'EmployeeID', 'EmployeeName', 'Role', 'DateTime', 'FileID', 'Hash']],
  REF: ['ТУ_НормативныеСсылки', ['RefID', 'TUID', 'VersionID', 'DocID', 'Number', 'Title', 'Clause', 'Notes']]
};
var MC_V66_ST = ['PROJECT', 'TECH_REVIEW', 'LAB_REVIEW', 'AGREEMENT', 'APPROVAL', 'ACTIVE', 'REVISION', 'ARCHIVED'];
var MC_V66_ST_RU = { PROJECT: 'Проект', TECH_REVIEW: 'Техническая проверка', LAB_REVIEW: 'Лабораторная проверка', AGREEMENT: 'Согласование', APPROVAL: 'Утверждение',
  ACTIVE: 'Действует', REVISION: 'Пересмотр', ARCHIVED: 'Архив' };
var MC_V66_GROUPS = { ORGANOLEPTIC: 'Органолептические показатели', PHYSCHEM: 'Физико-химические показатели', MICRO: 'Микробиологические показатели', SAFETY: 'Показатели безопасности' };
var MC_V66_CARD = [['RawRequirements', 'Требования к сырью'], ['IngredientRequirements', 'Требования к ингредиентам'], ['Organoleptic', 'Органолептические показатели (описание)'],
  ['StorageConditions', 'Условия хранения'], ['ShelfLife', 'Срок годности'], ['Transport', 'Транспортирование'], ['AcceptanceRules', 'Правила приёмки'], ['SamplingRules', 'Правила отбора проб'],
  ['SupplierDocs', 'Требования к документам поставщика'], ['NonconformingDisposal', 'Порядок утилизации несоответствующей продукции']];

function _v66Sh_(k) { return _v64Sheet_(MC_V66[k][0], MC_V66[k][1]); }
function setupV66Tu(token) { try { _requireAuth_(token, 'tu_view|tu_edit'); Object.keys(MC_V66).forEach(_v66Sh_); return _ok_({ initialized: true }, 'V66_SETUP'); } catch (e) { return _failFrom_(e); } }
function _v66Objs_(k, filter) {
  var sh = _book_().getSheetByName(MC_V66[k][0]); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(String);
  return v.slice(1).map(function (r, i) { var o = { _row: i + 2 }; h.forEach(function (c, j) { o[c] = r[j]; }); return o; }).filter(function (o) { return o[h[0]] !== '' && (!filter || filter(o)); });
}
function _v66Set_(k, row, col, val) { _v66Sh_(k).getRange(row, MC_V66[k][1].indexOf(col) + 1).setValue(val); }
function _v66Add_(k, obj) { var h = MC_V66[k][1]; _v66Sh_(k).appendRow(h.map(function (c) { return obj[c] === undefined || obj[c] === null ? '' : obj[c]; })); }
function _v66Id_(p) { return p + '-' + Utilities.getUuid().slice(0, 8).toUpperCase(); }
function _v66Ver_(versionId) { return _v66Objs_('VER', function (v) { return v.VersionID === versionId; })[0] || null; }
function _v66Doc_(tuId) { return _v66Objs_('DOC', function (d) { return d.TUID === tuId; })[0] || null; }
function _v66Editable_(v) { return v && (v.Status === 'PROJECT' || v.Status === 'REVISION'); }
function _v66Fail_(op, code, msg) { _endOp_(op, 'FAILED'); return _fail_(code, msg, op.id); }
function _v66Apr_(tuId, verId, stage, decision, comment, op, fileId, hash) {
  var w = _v65Who_(op); _v66Add_('APR', { ApprovalID: _v66Id_('TUA'), TUID: tuId, VersionID: verId, Stage: stage, Decision: decision, Comment: String(comment || '').slice(0, 45000), EmployeeID: w.id, EmployeeName: w.name, Role: w.role, DateTime: new Date(), FileID: fileId || '', Hash: hash || '' });
}

/** Новая карточка ТУ и версия 1 «Проект». */
function v66CreateTu(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_edit', 'V66_CREATE', 'ТУ', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), num = String(d.number || '').trim(), name = String(d.productName || '').trim();
    if (!num || !name) return _v66Fail_(op, 'VALIDATION', 'Укажите номер ТУ и наименование продукции');
    return _withLock_(function () {
      Object.keys(MC_V66).forEach(_v66Sh_);
      if (_v66Objs_('DOC', function (x) { return String(x.Number).trim().toLowerCase() === num.toLowerCase() && x.Status !== 'ARCHIVED'; }).length) return _v66Fail_(op, 'VALIDATION', 'ТУ с номером ' + num + ' уже есть');
      var ttk = [].concat(d.ttkCodes || []).map(String).filter(String), bad = ttk.filter(function (c) { return !_v64DishOf_(c); });
      if (bad.length) return _v66Fail_(op, 'VALIDATION', 'ТТК не найдены: ' + bad.join(', '));
      var w = _v65Who_(op), id = _v66Id_('TU'), vid = _v66Id_('TUV');
      _v66Add_('DOC', { TUID: id, Number: num, ProductName: name, Scope: d.scope || '', ProductCode: d.productCode || '', Purpose: d.purpose || '', ProductIDs: [].concat(d.productIds || []).join(','),
        TTKCodes: ttk.join(','), Status: 'PROJECT', CurrentVersion: vid, ActiveVersion: '', Developer: d.developer || w.name, Approver: d.approver || '', CreatedAt: new Date(), CreatedBy: w.name, Notes: d.notes || '' });
      var v = { VersionID: vid, TUID: id, Version: 1, Status: 'PROJECT', DateFrom: '', DateTo: '', Developer: d.developer || w.name, Approver: d.approver || '', ChangeReason: 'первая редакция', CreatedAt: new Date(), CreatedBy: w.name };
      MC_V66_CARD.forEach(function (f) { v[f[0]] = d[f[0].charAt(0).toLowerCase() + f[0].slice(1)] || ''; });
      _v66Add_('VER', v); _v66Apr_(id, vid, 'Создание', 'PROJECT', '', op);
      _audit_(op, 'V66_CREATE', 'ТУ', id, null, { number: num, product: name, ttk: ttk }); _endOp_(op);
      return _ok_({ tuId: id, versionId: vid, status: 'PROJECT' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Поля карточки версии (только «Проект» / «Пересмотр»). */
function v66SaveVersion(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_edit', 'V66_SAVE', 'ТУ', null, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v64Json_(json);
    return _withLock_(function () { var v = _v66Ver_(d.versionId); if (!_v66Editable_(v)) return _v66Fail_(op, 'VALIDATION', 'Карточка меняется только в статусе «Проект» или «Пересмотр»');
      var ch = {}; MC_V66_CARD.concat([['DateFrom'], ['DateTo'], ['Approver'], ['ChangeReason']]).forEach(function (f) { var k = f[0].charAt(0).toLowerCase() + f[0].slice(1); if (d[k] !== undefined) { var val = /^Date/.test(f[0]) ? (_v64DateArg_(d[k], '', f[0]) || '') : String(d[k]); _v66Set_('VER', v._row, f[0], val); ch[f[0]] = val; } });
      var w = _v65Who_(op); _v66Set_('VER', v._row, 'UpdatedAt', new Date()); _v66Set_('VER', v._row, 'UpdatedBy', w.name);
      _audit_(op, 'V66_SAVE', 'ТУ', v.TUID, null, { version: v.Version, fields: Object.keys(ch) }); _endOp_(op); return _ok_({ versionId: v.VersionID, changed: Object.keys(ch) }, op.id); });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Строки версии: показатель, метод, сырьё, упаковка/маркировка, нормативная ссылка. kind: IND | MET | RAW | PKL | REF */
function v66SaveLine(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_edit', 'V66_LINE', 'ТУ', null, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v64Json_(json), k = String(d.kind || '').toUpperCase();
    if (['IND', 'MET', 'RAW', 'PKL', 'REF'].indexOf(k) < 0) return _v66Fail_(op, 'VALIDATION', 'Вид строки: IND, MET, RAW, PKL, REF');
    return _withLock_(function () { var v = _v66Ver_(d.versionId); if (!_v66Editable_(v)) return _v66Fail_(op, 'VALIDATION', 'Состав меняется только в статусе «Проект» или «Пересмотр»');
      var row = { TUID: v.TUID, VersionID: v.VersionID, Notes: d.notes || '' };
      if (k === 'IND') { if (!MC_V66_GROUPS[d.group]) return _v66Fail_(op, 'VALIDATION', 'Группа показателя: ' + Object.keys(MC_V66_GROUPS).join(', ')); if (!String(d.indicator || '').trim()) return _v66Fail_(op, 'VALIDATION', 'Укажите показатель');
        var mn = d.normMin === '' || d.normMin === undefined ? '' : _v64Num_(d.normMin), mx = d.normMax === '' || d.normMax === undefined ? '' : _v64Num_(d.normMax);
        if (mn === '' && mx === '' && !String(d.normText || '').trim()) return _v66Fail_(op, 'VALIDATION', 'Укажите норматив: границы или текст («не допускается в 25 г»)');
        if (mn !== '' && mx !== '' && mn > mx) return _v66Fail_(op, 'VALIDATION', 'Нижняя граница больше верхней');
        if (d.methodId && !_v66Objs_('MET', function (m) { return m.MethodID === d.methodId && m.VersionID === v.VersionID; }).length) return _v66Fail_(op, 'VALIDATION', 'Метод не найден в этой версии');
        Object.assign(row, { IndicatorID: d.id || _v66Id_('TUI'), Group: d.group, Indicator: d.indicator, NormMin: mn, NormMax: mx, NormText: d.normText || '', Unit: d.unit || '', MethodID: d.methodId || '', Mandatory: d.mandatory !== false, LabFrequencyDays: d.labFrequencyDays ? _v64Num_(d.labFrequencyDays) : '' }); }
      else if (k === 'MET') { if (!String(d.name || '').trim()) return _v66Fail_(op, 'VALIDATION', 'Укажите метод'); Object.assign(row, { MethodID: d.id || _v66Id_('TUM'), Name: d.name, StandardRef: d.standardRef || '', Laboratory: d.laboratory || '' }); }
      else if (k === 'RAW') { if (!String(d.material || '').trim()) return _v66Fail_(op, 'VALIDATION', 'Укажите сырьё'); Object.assign(row, { LineID: d.id || _v66Id_('TUR'), Material: d.material, ProductID: d.productId || '', Requirements: d.requirements || '', SupplierDocs: d.supplierDocs || '' }); }
      else if (k === 'PKL') { if (['PACKAGING', 'LABELING'].indexOf(d.pkKind) < 0 || !String(d.requirement || '').trim()) return _v66Fail_(op, 'VALIDATION', 'Укажите вид (PACKAGING / LABELING) и требование'); Object.assign(row, { LineID: d.id || _v66Id_('TUP'), Kind: d.pkKind, Requirement: d.requirement }); }
      else { if (!String(d.number || '').trim()) return _v66Fail_(op, 'VALIDATION', 'Укажите номер документа'); Object.assign(row, { RefID: d.id || _v66Id_('TUN'), DocID: d.docId || '', Number: d.number, Title: d.title || '', Clause: d.clause || '' }); }
      var idCol = MC_V66[k][1][0], ex = _v66Objs_(k, function (x) { return x[idCol] === row[idCol]; })[0];
      if (ex) _v66Sh_(k).getRange(ex._row, 1, 1, MC_V66[k][1].length).setValues([MC_V66[k][1].map(function (c) { return row[c] === undefined ? '' : row[c]; })]); else _v66Add_(k, row);
      _audit_(op, 'V66_LINE', 'ТУ', v.TUID, ex ? { id: row[idCol] } : null, { kind: k, id: row[idCol] }); _endOp_(op); return _ok_({ id: row[idCol], kind: k }, op.id); });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Полнота карточки ТУ (§16.2) перед технической проверкой. */
function _v66Completeness_(v) {
  var doc = _v66Doc_(v.TUID), iss = [], vid = v.VersionID;
  ['Scope', 'Purpose', 'ProductCode'].forEach(function (k) { if (!String(doc[k] || '').trim()) iss.push({ Scope: 'область применения', Purpose: 'назначение', ProductCode: 'код продукции' }[k] + ' не указан(а)'); });
  MC_V66_CARD.forEach(function (f) { if (!String(v[f[0]] || '').trim()) iss.push(f[1] + ': не заполнено'); });
  var ind = _v66Objs_('IND', function (x) { return x.VersionID === vid; }), met = _v66Objs_('MET', function (x) { return x.VersionID === vid; });
  ['ORGANOLEPTIC', 'PHYSCHEM', 'MICRO', 'SAFETY'].forEach(function (g) { if (!ind.some(function (x) { return x.Group === g; })) iss.push(MC_V66_GROUPS[g] + ': нет ни одного показателя'); });
  ind.forEach(function (x) { if (!x.MethodID || !met.some(function (m) { return m.MethodID === x.MethodID; })) iss.push('показатель «' + x.Indicator + '»: не указан метод контроля'); });
  if (!_v66Objs_('RAW', function (x) { return x.VersionID === vid; }).length) iss.push('требования к сырью: нет строк');
  var pk = _v66Objs_('PKL', function (x) { return x.VersionID === vid; });
  if (!pk.some(function (x) { return x.Kind === 'PACKAGING'; })) iss.push('требования к упаковке: нет'); if (!pk.some(function (x) { return x.Kind === 'LABELING'; })) iss.push('требования к маркировке: нет');
  if (!_v66Objs_('REF', function (x) { return x.VersionID === vid; }).length) iss.push('нормативные ссылки: нет');
  if (!String(v.Developer || '').trim()) iss.push('разработчик не указан'); if (!String(v.Approver || doc.Approver || '').trim()) iss.push('утверждающий не указан');
  return iss;
}
/** Лабораторное подтверждение: по каждому обязательному показателю есть протокол со ссылкой на ТУ и результатом PASS. */
function _v66LabConfirmed_(v) {
  var ind = _v66Objs_('IND', function (x) { return x.VersionID === v.VersionID && _v65On_(x.Mandatory) && x.Group !== 'ORGANOLEPTIC'; }), res = _v65Rows_('Лаборатория_Исследования'), miss = [];
  ind.forEach(function (x) { if (!res.some(function (r) { return String(r.TUID) === String(v.TUID) && _v64Key_(r.Indicator) === _v64Key_(x.Indicator) && String(r.Result) === 'PASS'; })) miss.push(x.Indicator); });
  return miss;
}
var MC_V66_NEXT = { PROJECT: 'TECH_REVIEW', REVISION: 'TECH_REVIEW', TECH_REVIEW: 'LAB_REVIEW', LAB_REVIEW: 'AGREEMENT', AGREEMENT: 'APPROVAL', APPROVAL: 'ACTIVE' };
/** Перевести версию на следующий этап с проверками этапа. */
function v66Advance(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_edit|tu_approve|lab_approve', 'V66_ADVANCE', 'ТУ', null, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v64Json_(json), s = op.session;
    return _withLock_(function () {
      var v = _v66Ver_(d.versionId); if (!v) return _v66Fail_(op, 'NOT_FOUND', 'Версия ТУ не найдена');
      var next = MC_V66_NEXT[v.Status]; if (!next) return _v66Fail_(op, 'VALIDATION', 'Из статуса «' + (MC_V66_ST_RU[v.Status] || v.Status) + '» дальше не переводится');
      var w = _v65Who_(op), has = function (p) { return _mcRbHasExact_(s, p); }, doc = _v66Doc_(v.TUID);
      if (next === 'TECH_REVIEW') { if (!has('tu_edit')) return _v66Fail_(op, 'FORBIDDEN', 'Нужно право tu_edit'); var iss = _v66Completeness_(v); if (iss.length) return _v66Fail_(op, 'TU_INCOMPLETE', 'Карточка ТУ не заполнена: ' + iss.join('; ')); }
      if (next === 'LAB_REVIEW') { if (!has('tu_edit') && !has('tu_approve')) return _v66Fail_(op, 'FORBIDDEN', 'Нужно право tu_edit или tu_approve');
        if (!s.dev && w.name === String(v.Developer)) return _v66Fail_(op, 'FORBIDDEN', 'Техническую проверку проводит не разработчик'); }
      if (next === 'AGREEMENT') { if (!has('lab_approve')) return _v66Fail_(op, 'FORBIDDEN', 'Лабораторную проверку подтверждает сотрудник с правом lab_approve');
        var miss = _v66LabConfirmed_(v); if (miss.length) return _v66Fail_(op, 'LAB_NOT_CONFIRMED', 'Нет протоколов с результатом «соответствует» по показателям: ' + miss.join(', ') + ' (протокол должен ссылаться на эту ТУ)'); }
      if (next === 'APPROVAL') { if (!has('tu_edit') && !has('tu_approve')) return _v66Fail_(op, 'FORBIDDEN', 'Нужно право tu_edit или tu_approve'); }
      if (next === 'ACTIVE') {
        if (!has('tu_approve')) return _v66Fail_(op, 'FORBIDDEN', 'Утверждает сотрудник с правом tu_approve'); if (s.dev) return _v66Fail_(op, 'FORBIDDEN', 'Технический доступ ТУ не утверждает');
        var f = _mcPdfSave_('Технические условия ' + doc.Number + ' «' + doc.ProductName + '»', _v66Html_(v), { fileName: 'ТУ ' + doc.Number + ' v' + v.Version, folder: _v66Folder_() });
        var from = _v64Date_(v.DateFrom) || new Date();
        _v66Objs_('VER', function (x) { return x.TUID === v.TUID && x.Status === 'ACTIVE' && x.VersionID !== v.VersionID; }).forEach(function (x) { _v66Set_('VER', x._row, 'Status', 'ARCHIVED'); _v66Set_('VER', x._row, 'DateTo', new Date(from.getTime() - 86400000)); _v66Apr_(v.TUID, x.VersionID, 'Архив', 'ARCHIVED', 'заменена версией ' + v.Version, op); });
        _v66Set_('VER', v._row, 'ApprovedAt', new Date()); _v66Set_('VER', v._row, 'Approver', w.name); _v66Set_('VER', v._row, 'FileID', f.fileId); _v66Set_('VER', v._row, 'Hash', f.sha256); if (!v.DateFrom) _v66Set_('VER', v._row, 'DateFrom', from);
        _v66Set_('DOC', doc._row, 'ActiveVersion', v.VersionID);
        var lp = typeof _v67PlansFromTu_ === 'function' ? _v67PlansFromTu_(v, op) : 0;
        _v66Apr_(v.TUID, v.VersionID, MC_V66_ST_RU.APPROVAL, 'APPROVED', d.comment || '', op, f.fileId, f.sha256);
        d.__file = f; d.__plans = lp;
      }
      _v66Set_('VER', v._row, 'Status', next); _v66Set_('DOC', doc._row, 'Status', next === 'ACTIVE' ? 'ACTIVE' : (doc.ActiveVersion ? 'ACTIVE' : next)); _v66Set_('DOC', doc._row, 'CurrentVersion', v.VersionID);
      if (next !== 'ACTIVE') _v66Apr_(v.TUID, v.VersionID, MC_V66_ST_RU[next], 'PASSED_TO_' + next, d.comment || '', op);
      _audit_(op, 'V66_ADVANCE', 'ТУ', v.TUID, v.Status, { status: next, version: v.Version }); _endOp_(op);
      return _ok_({ versionId: v.VersionID, status: next, statusRu: MC_V66_ST_RU[next], file: d.__file || null, labPlans: d.__plans || 0 }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v66Return(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_edit|tu_approve|lab_approve', 'V66_RETURN', 'ТУ', null, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v64Json_(json); if (!String(d.comment || '').trim()) return _v66Fail_(op, 'VALIDATION', 'Укажите, что исправить');
    return _withLock_(function () { var v = _v66Ver_(d.versionId); if (!v || ['TECH_REVIEW', 'LAB_REVIEW', 'AGREEMENT', 'APPROVAL'].indexOf(v.Status) < 0) return _v66Fail_(op, 'VALIDATION', 'Вернуть можно версию на проверке, согласовании или утверждении');
      var back = v.Version > 1 ? 'REVISION' : 'PROJECT'; _v66Set_('VER', v._row, 'Status', back); _v66Apr_(v.TUID, v.VersionID, 'Возврат на доработку', 'RETURNED', d.comment, op);
      _audit_(op, 'V66_RETURN', 'ТУ', v.TUID, v.Status, { status: back, comment: d.comment }); _endOp_(op); return _ok_({ versionId: v.VersionID, status: back }, op.id); });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Пересмотр действующей ТУ: новая версия-копия «Пересмотр»; действующая остаётся в силе до утверждения новой. */
function v66Revise(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_edit', 'V66_REVISE', 'ТУ', null, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v64Json_(json); if (!String(d.reason || '').trim()) return _v66Fail_(op, 'VALIDATION', 'Укажите причину пересмотра');
    return _withLock_(function () { var doc = _v66Doc_(d.tuId); if (!doc || !doc.ActiveVersion) return _v66Fail_(op, 'VALIDATION', 'Пересматривается действующая ТУ');
      if (_v66Objs_('VER', function (x) { return x.TUID === doc.TUID && ['PROJECT', 'REVISION', 'TECH_REVIEW', 'LAB_REVIEW', 'AGREEMENT', 'APPROVAL'].indexOf(x.Status) >= 0; }).length) return _v66Fail_(op, 'VALIDATION', 'Пересмотр уже идёт');
      var a = _v66Ver_(doc.ActiveVersion), w = _v65Who_(op), nv = _v66Id_('TUV'), num = _v66Objs_('VER', function (x) { return x.TUID === doc.TUID; }).reduce(function (m, x) { return Math.max(m, Number(x.Version) || 0); }, 0) + 1;
      var v = {}; MC_V66.VER[1].forEach(function (c) { v[c] = a[c]; }); Object.assign(v, { VersionID: nv, Version: num, Status: 'REVISION', DateFrom: '', DateTo: '', ApprovedAt: '', FileID: '', Hash: '', ChangeReason: d.reason, CreatedAt: new Date(), CreatedBy: w.name, UpdatedAt: '', UpdatedBy: '' });
      _v66Add_('VER', v);
      var idMap = {}; ['MET', 'IND', 'RAW', 'PKL', 'REF'].forEach(function (k) { _v66Objs_(k, function (x) { return x.VersionID === a.VersionID; }).forEach(function (x) { var o = {}; MC_V66[k][1].forEach(function (c) { o[c] = x[c]; });
        var idc = MC_V66[k][1][0], nid = _v66Id_('TU' + k.charAt(0)); idMap[x[idc]] = nid; o[idc] = nid; o.VersionID = nv; if (k === 'IND' && o.MethodID) o.MethodID = idMap[o.MethodID] || o.MethodID; _v66Add_(k, o); }); });
      _v66Set_('DOC', doc._row, 'CurrentVersion', nv); _v66Apr_(doc.TUID, nv, 'Пересмотр', 'REVISION', d.reason, op);
      _audit_(op, 'V66_REVISE', 'ТУ', doc.TUID, { active: a.Version }, { revision: num, reason: d.reason }); _endOp_(op); return _ok_({ versionId: nv, version: num, status: 'REVISION' }, op.id); });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v66Archive(json, token) {
  var op = null; try { op = _beginOp_(token, 'tu_approve', 'V66_ARCHIVE', 'ТУ', null, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v64Json_(json); if (!String(d.comment || '').trim()) return _v66Fail_(op, 'VALIDATION', 'Укажите причину');
    return _withLock_(function () { var doc = _v66Doc_(d.tuId); if (!doc) return _v66Fail_(op, 'NOT_FOUND', 'ТУ не найдены');
      _v66Objs_('VER', function (x) { return x.TUID === doc.TUID && x.Status !== 'ARCHIVED'; }).forEach(function (x) { _v66Set_('VER', x._row, 'Status', 'ARCHIVED'); if (!x.DateTo) _v66Set_('VER', x._row, 'DateTo', new Date()); });
      _v66Set_('DOC', doc._row, 'Status', 'ARCHIVED'); _v66Apr_(doc.TUID, doc.ActiveVersion || doc.CurrentVersion, 'Архив', 'ARCHIVED', d.comment, op);
      _audit_(op, 'V66_ARCHIVE', 'ТУ', doc.TUID, doc.Status, { status: 'ARCHIVED' }); _endOp_(op); return _ok_({ tuId: doc.TUID, status: 'ARCHIVED' }, op.id); });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v66Folder_() { var pr = PropertiesService.getScriptProperties(), id = pr.getProperty('MC_TU_FOLDER_ID'); if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} } var f = _docsFolder_().createFolder('ТУ'); pr.setProperty('MC_TU_FOLDER_ID', f.getId()); return f; }
function _v66Html_(v) {
  var E = _mcOrgEsc_, doc = _v66Doc_(v.TUID), vid = v.VersionID, met = {}; _v66Objs_('MET', function (x) { return x.VersionID === vid; }).forEach(function (m) { met[m.MethodID] = m; });
  var h = '<div class="muted">ТУ ' + E(doc.Number) + ' · версия ' + E(v.Version) + ' · ' + E(MC_V66_ST_RU[v.Status] || v.Status) + (v.DateFrom ? ' · действует с ' + E(_v65Fmt_(v.DateFrom)) : '') + '</div>' +
    '<h2>Общие сведения</h2><table class="r"><tr><th>Наименование продукции</th><td>' + E(doc.ProductName) + '</td></tr><tr><th>Код продукции</th><td>' + E(doc.ProductCode) + '</td></tr><tr><th>Область применения</th><td>' + E(doc.Scope) +
    '</td></tr><tr><th>Назначение</th><td>' + E(doc.Purpose) + '</td></tr><tr><th>ТТК</th><td>' + E(doc.TTKCodes || '—') + '</td></tr></table>';
  MC_V66_CARD.forEach(function (f) { h += '<h3>' + E(f[1]) + '</h3><div style="white-space:pre-wrap">' + E(v[f[0]] || '—') + '</div>'; });
  Object.keys(MC_V66_GROUPS).forEach(function (g) { var ind = _v66Objs_('IND', function (x) { return x.VersionID === vid && x.Group === g; }); if (!ind.length) return;
    h += '<h2>' + E(MC_V66_GROUPS[g]) + '</h2><table class="r"><tr><th>Показатель</th><th>Норматив</th><th>Ед.</th><th>Метод контроля</th></tr>' + ind.map(function (x) { var m = met[x.MethodID];
      return '<tr><td>' + E(x.Indicator) + '</td><td>' + E(x.NormText || ((x.NormMin !== '' ? 'от ' + x.NormMin + ' ' : '') + (x.NormMax !== '' ? 'до ' + x.NormMax : ''))) + '</td><td>' + E(x.Unit) + '</td><td>' + E(m ? m.Name + (m.StandardRef ? ' (' + m.StandardRef + ')' : '') : '—') + '</td></tr>'; }).join('') + '</table>'; });
  var sec = function (k, title, f) { var r = _v66Objs_(k, function (x) { return x.VersionID === vid; }); if (r.length) h += '<h2>' + title + '</h2><table class="r">' + r.map(f).join('') + '</table>'; };
  sec('RAW', 'Требования к сырью', function (x) { return '<tr><td>' + E(x.Material) + '</td><td>' + E(x.Requirements) + '</td><td>' + E(x.SupplierDocs) + '</td></tr>'; });
  sec('PKL', 'Упаковка и маркировка', function (x) { return '<tr><td>' + (x.Kind === 'PACKAGING' ? 'Упаковка' : 'Маркировка') + '</td><td>' + E(x.Requirement) + '</td></tr>'; });
  sec('REF', 'Нормативные ссылки', function (x) { return '<tr><td>' + E(x.Number) + '</td><td>' + E(x.Title) + '</td><td>' + E(x.Clause) + '</td></tr>'; });
  sec('APR', 'Лист согласования', function (x) { return x.VersionID === vid ? '<tr><td>' + E(x.Stage) + '</td><td>' + E(x.Decision) + '</td><td>' + E(x.EmployeeName) + '</td><td>' + E(x.Role) + '</td><td>' + E(_v65Fmt_(x.DateTime)) + '</td></tr>' : ''; });
  h += '<div class="sign">Разработчик: ' + E(v.Developer) + '<br>Утверждаю: ____________ / ' + E(v.Approver || doc.Approver || '________') + '</div><p class="muted">Технические условия предприятия не заменяют обязательные требования законодательства.</p>';
  return h;
}
function v66TuPdf(versionId, token) {
  var op = null; try { op = _beginOp_(token, 'tu_view|tu_edit|tu_approve', 'V66_PDF', 'ТУ', versionId, null); } catch (e) { return _failFrom_(e); }
  try { var v = _v66Ver_(versionId); if (!v) return _v66Fail_(op, 'NOT_FOUND', 'Версия не найдена');
    if (v.FileID) { _endOp_(op); return _ok_({ fileId: v.FileID, url: DriveApp.getFileById(v.FileID).getUrl(), sha256: v.Hash, approved: true }, op.id); }
    var doc = _v66Doc_(v.TUID), f = _mcPdfSave_('Технические условия ' + doc.Number + ' «' + doc.ProductName + '» — проект', _v66Html_(v), { fileName: 'ТУ ' + doc.Number + ' v' + v.Version + ' (проект)', folder: _v66Folder_() });
    _audit_(op, 'V66_PDF', 'ТУ', v.TUID, null, { fileId: f.fileId }); _endOp_(op); f.approved = false; return _ok_(f, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v66GetTuList(token) {
  try { _requireAuth_(token, 'tu_view|tu_edit|tu_approve|lab_view');
    return _ok_({ items: _v66Objs_('DOC').map(function (d) { var a = d.ActiveVersion ? _v66Ver_(d.ActiveVersion) : null, c = _v66Ver_(d.CurrentVersion);
      return { tuId: d.TUID, number: d.Number, product: d.ProductName, status: d.Status, statusRu: MC_V66_ST_RU[d.Status] || d.Status, activeVersion: a ? a.Version : '', activeFrom: a ? _v65Fmt_(a.DateFrom) : '',
        currentVersion: c ? c.Version : '', currentStatus: c ? (MC_V66_ST_RU[c.Status] || c.Status) : '', ttk: d.TTKCodes }; }), groups: MC_V66_GROUPS, statuses: MC_V66_ST_RU, card: MC_V66_CARD });
  } catch (e) { return _failFrom_(e); }
}
function v66GetTu(tuId, token) {
  try { _requireAuth_(token, 'tu_view|tu_edit|tu_approve|lab_view'); var d = _v66Doc_(tuId); if (!d) return _fail_('NOT_FOUND', 'ТУ не найдены');
    var fm = function (o) { var x = {}; Object.keys(o).forEach(function (k) { if (k !== '_row') { var v = o[k]; x[k] = Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, _mcTz_(), 'yyyy-MM-dd') : v; } }); return x; };
    var vers = _v66Objs_('VER', function (v) { return v.TUID === tuId; }), cur = _v66Ver_(d.CurrentVersion);
    var lines = function (k) { return _v66Objs_(k, function (x) { return cur && x.VersionID === cur.VersionID; }).map(fm); };
    return _ok_({ doc: fm(d), versions: vers.map(fm), current: cur ? fm(cur) : null, indicators: lines('IND'), methods: lines('MET'), raw: lines('RAW'), packaging: lines('PKL'), refs: lines('REF'),
      approvals: _v66Objs_('APR', function (x) { return x.TUID === tuId; }).map(fm), completeness: cur && _v66Editable_(cur) ? _v66Completeness_(cur) : [], labMissing: cur && cur.Status === 'LAB_REVIEW' ? _v66LabConfirmed_(cur) : [] });
  } catch (e) { return _failFrom_(e); }
}
/** Действующая ТУ продукта (по ТТК или названию) — для отбора проб и протоколов. */
function _v66ActiveFor_(nameOrCode) {
  var dsh = _v64DishOf_(nameOrCode), key = _v64Key_(nameOrCode);
  var d = _v66Objs_('DOC', function (x) { return x.ActiveVersion && x.Status !== 'ARCHIVED' && ((dsh && String(x.TTKCodes).split(',').indexOf(String(dsh.code)) >= 0) || _v64Key_(x.ProductName) === key); })[0];
  if (!d) return null; var v = _v66Ver_(d.ActiveVersion); return v ? { tuId: d.TUID, versionId: v.VersionID, version: v.Version, number: d.Number } : null;
}
