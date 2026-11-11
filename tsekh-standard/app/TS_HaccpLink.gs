/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
/**
 * ЦЕХ Стандарт — связь «процессы ТТК → опасности ХАССП → меры → журналы» (Мастер-промт 4.0, этап 3).
 *
 * Реестр решений не дублируется: процессы и опасности ведутся в V30 (HACCP_Процессы_V30, HACCP_Опасности_V30),
 * их читает генератор ППК V65. Этот модуль:
 *  - по производственной модели (действующие ТТК, этап 2) предлагает в V30 процессы и опасности
 *    из мастер-справочника поставщика (TS2_MASTER_HAZARDS_) — со статусом PROPOSED и без решения о значимости;
 *  - не меняет решения людей (значима/нет, мера, доказательство) и строки, заведённые вручную;
 *  - ведёт PPK_HACCP_RISK_MAP: процесс → опасность → решение → мера/ККТ → журнал, со статусом пробела;
 *  - процессы, исчезнувшие из ТТК: нерешённые предложения → ARCHIVED, решённые остаются и помечаются «пересмотреть».
 * Решение о значимости принимает только человек с правом утверждения ХАССП (ЦЕХ AI не утверждает).
 */
// операция справочника → процесс V30, заведённый при первичной настройке (чтобы не плодить «Хранение» дважды)
var HZL_V30_ALIAS_ = { RECEIVE: 'RECEIVING', STORE: 'STORAGE', COOL: 'COOLING', REHEAT: 'REHEAT', PORTION: 'PORTION', SALE: 'DISPATCH' };
// операция справочника → журнал контроля (TS2_OP_JOURNAL_)
var HZL_JOURNAL_ = { BOIL: 'THERMAL', BAKE: 'THERMAL', STEW: 'THERMAL', SOUSVIDE: 'THERMAL', PASTEUR: 'THERMAL', BLANCH: 'THERMAL', STEAM: 'THERMAL', FRY: 'FRYING', DEEPFRY: 'FRYING',
  COOL: 'COOLING', BLAST: 'COOLING', REHEAT: 'REHEAT', DEFROST: 'DEFROST', STORE: 'STORAGE', COLDHOLD: 'STORAGE', HOTHOLD: 'STORAGE' };
var HZL_CAT_ORDER_ = { PRIMARY: 10, THERMAL: 40, COLD: 60, EXTRA: 80 };
var HZL_CAT_RU_ = { B: 'Биологическая', C: 'Химическая', P: 'Физическая', A: 'Аллерген' };

function _hzlMaster_() {
  var by = {}; Object.keys(TS2_MASTER_HAZARDS_).forEach(function (k) { TS2_MASTER_HAZARDS_[k].forEach(function (h) { if (!by[h[2]]) by[h[2]] = { code: h[2], cat: h[0], text: h[1] }; }); });
  return by;
}
/** Лист V30 как массив объектов + запись строк по номеру (лист ведёт V30 — заголовки берём из листа). */
function _hzlV30_(name) {
  _v30Init_(); var sh = _book_().getSheetByName(name), v = sh.getDataRange().getValues(), h = v[0].map(String), rows = [];
  for (var i = 1; i < v.length; i++) { if (v[i][0] === '' || v[i][0] === null) continue; var o = { _row: i + 1 }; h.forEach(function (k, j) { o[k] = v[i][j]; }); rows.push(o); }
  return { sh: sh, h: h, rows: rows,
    put: function (o) { var r = h.map(function (k) { return o[k] === undefined ? '' : o[k]; }); if (o._row) sh.getRange(o._row, 1, 1, h.length).setValues([r]); else { sh.appendRow(r); o._row = sh.getLastRow(); rows.push(o); } } };
}
function _hzlDecided_(hz) { return String(hz.Significant === undefined || hz.Significant === null ? '' : hz.Significant).trim() !== ''; }

/** Синхронизация: модель ТТК → предложения в V30 → карта рисков. Идемпотентна. */
function _hzlSync_() {
  return _withLock_(function () {
    _ttkpDict_();
    var dict = {}; _ts2Rows_('TTK_PROCESS_DICTIONARY').forEach(function (d) { dict[d.code] = d; });
    var model = _ttkpActiveModel_(), inModel = {}, master = _hzlMaster_(), now = new Date(), who = (_ts2Actor_().name || 'Система ЦЕХ Стандарт'), ent = _ts2Ent_();
    model.forEach(function (m) { inModel[m.processCode] = m; });
    var P = _hzlV30_(MC_V30.PROCESS), H = _hzlV30_(MC_V30.HAZARD), K = _hzlV30_(MC_V30.CCP);
    var byCode = {}; P.rows.forEach(function (p) { if (p.Code && String(p.Status) !== 'ARCHIVED') byCode[String(p.Code)] = p; });
    var res = { processesAdded: 0, hazardsProposed: 0, archived: 0, needDecision: 0, noControl: 0, obsolete: 0 };
    var procOf = {};
    // 1. процессы
    Object.keys(inModel).forEach(function (code) {
      var d = dict[code] || { name: code, category: 'EXTRA' }, m = inModel[code];
      var p = byCode[code] || byCode[HZL_V30_ALIAS_[code]] || P.rows.filter(function (x) { return x.ProcessID === 'PROC-TTK-' + code; })[0];
      var note = 'Из ТТК: ' + m.ttkCount + ' (' + m.ttk.slice(0, 5).join(', ') + (m.ttk.length > 5 ? '…' : '') + ')';
      if (!p) { p = { ProcessID: 'PROC-TTK-' + code, Code: code, Name: d.name, Sequence: HZL_CAT_ORDER_[d.category] || 90, Input: '', Output: '', Responsible: '', Status: 'DRAFT', Version: '1', ApprovedAt: '', ApprovedBy: '', Notes: note, CreatedAt: now, CreatedBy: who }; P.put(p); res.processesAdded++; }
      else if (String(p.Status) === 'ARCHIVED' && /^PROC-TTK-/.test(p.ProcessID)) { p.Status = 'DRAFT'; p.Notes = note; P.put(p); }
      else if (/^PROC-TTK-/.test(p.ProcessID) && p.Notes !== note) { p.Notes = note; P.put(p); }
      procOf[code] = p;
    });
    // 2. опасности: предложения поставщика по каждой операции
    Object.keys(procOf).forEach(function (code) {
      var p = procOf[code], d = dict[code] || {};
      String(d.hazards || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (hc) {
        var mh = master[hc]; if (!mh) return;
        var id = 'HZ-' + p.ProcessID + '-' + hc;
        var dup = H.rows.filter(function (x) { return String(x.ProcessID) === String(p.ProcessID) && (x.HazardID === id || String(x.Hazard).trim().toLowerCase() === mh.text.toLowerCase()); })[0];
        if (dup) { if (dup.HazardID === id && String(dup.Status) === 'ARCHIVED' && !_hzlDecided_(dup)) { dup.Status = 'PROPOSED'; H.put(dup); } return; }
        H.put({ HazardID: id, ProcessID: p.ProcessID, Category: mh.cat, Hazard: mh.text, Cause: 'Операция «' + (d.name || code) + '» в действующих ТТК', PreventiveMeasure: d.controlMeasures || '', Severity: '', Likelihood: '', Risk: '',
          Significant: '', ExistingControl: '', Evidence: '', Status: 'PROPOSED', CreatedAt: now, CreatedBy: 'ЦЕХ Стандарт (предложение)' });
        res.hazardsProposed++;
      });
    });
    // 3. операции, которых больше нет в действующих ТТК
    P.rows.forEach(function (p) {
      if (!/^PROC-TTK-/.test(p.ProcessID) || inModel[p.Code] || String(p.Status) === 'ARCHIVED') return;
      var hz = H.rows.filter(function (h) { return String(h.ProcessID) === String(p.ProcessID) && String(h.Status) !== 'ARCHIVED'; });
      hz.forEach(function (h) { if (!_hzlDecided_(h) && String(h.Status) === 'PROPOSED') { h.Status = 'ARCHIVED'; H.put(h); res.archived++; } });
      if (!hz.some(_hzlDecided_)) { p.Status = 'ARCHIVED'; P.put(p); }
    });
    // 4. карта рисков: пересчёт целиком
    var codeOfProc = {}; Object.keys(procOf).forEach(function (c) { codeOfProc[procOf[c].ProcessID] = c; });
    P.rows.forEach(function (p) { if (/^PROC-TTK-/.test(p.ProcessID) && !codeOfProc[p.ProcessID]) codeOfProc[p.ProcessID] = String(p.Code); });
    var out = [];
    H.rows.forEach(function (h) {
      if (String(h.Status) === 'ARCHIVED') return;
      var code = codeOfProc[h.ProcessID]; if (!code) return;   // процесс, не связанный с ТТК (ручной), остаётся в V30 как есть
      var m = inModel[code], p = P.rows.filter(function (x) { return x.ProcessID === h.ProcessID; })[0] || {};
      var ctl = K.rows.filter(function (c) { return String(c.Status) !== 'ARCHIVED' && (String(c.HazardID) === String(h.HazardID) || !c.HazardID && String(c.ProcessID) === String(h.ProcessID)); })[0];
      var hc = /-(MH-[A-Z]-[A-Z]+)$/.exec(h.HazardID), decided = _hzlDecided_(h), sig = decided && _v65Bool_(h.Significant), st, note = '';
      if (!m) { st = 'OBSOLETE'; note = 'Операции больше нет в действующих ТТК — пересмотрите решение'; res.obsolete++; }
      else if (!decided) { st = 'NEEDS_DECISION'; note = 'Решите, значима ли опасность'; res.needDecision++; }
      else if (!sig) st = 'NOT_SIGNIFICANT';
      else if (ctl) st = 'CONTROLLED';
      else if (String(h.ExistingControl || '').trim() && String(h.Evidence || '').trim()) st = 'CONTROLLED';
      else { st = 'NO_CONTROL'; note = 'Значимая опасность без ККТ/ОППУ и доказательства'; res.noControl++; }
      var j = HZL_JOURNAL_[code] && TS2_OP_JOURNAL_[HZL_JOURNAL_[code]] || '';
      out.push({ organizationId: ent, processCode: code, processName: p.Name || code, v30ProcessId: h.ProcessID, hazardCode: hc ? hc[1] : '', hazardCategory: h.Category, hazard: h.Hazard, v30HazardId: h.HazardID,
        ttkCount: m ? m.ttkCount : 0, ttkSample: m ? m.ttk.slice(0, 10).join(', ') : '', significant: decided ? (sig ? 'да' : 'нет') : '', controlType: ctl ? ctl.Type : (sig && st === 'CONTROLLED' ? 'ОППУ/ППУ' : ''),
        controlId: ctl ? ctl.ControlID : '', controlMeasure: ctl ? ctl.ControlPoint : (h.ExistingControl || h.PreventiveMeasure || ''), evidence: h.Evidence || '', journalId: j, status: st, statusNote: note,
        rowKey: h.ProcessID + '|' + h.HazardID, updatedAt: _ts2Iso_() });
    });
    var sh = _ts2Sheet_('PPK_HACCP_RISK_MAP'), head = _ts2Head_(sh), old = {}; _ts2Rows_('PPK_HACCP_RISK_MAP').forEach(function (r) { old[r.rowKey] = r.riskId; });
    var need = out.filter(function (o) { return !old[o.rowKey]; }).length, ids = _ttkpIds_('PPK_HACCP_RISK_MAP', need), k = 0;
    out.forEach(function (o) { o.riskId = old[o.rowKey] || ids[k++]; });
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, head.length).setValues(_hzlBlank_(sh.getLastRow() - 1, head.length));
    if (out.length) sh.getRange(2, 1, out.length, head.length).setValues(out.map(function (o) { return head.map(function (c) { return _ts2Cell_(o[c]); }); }));
    res.rows = out.length;
    try { if (res.processesAdded || res.hazardsProposed || res.archived) _ts2Audit_('HACCP_LINK_SYNC', 'HACCP', 'TTK_MODEL', undefined, res, 'процессы ТТК → опасности ХАССП (предложения)'); } catch (e) {}
    return res;
  });
}
function _hzlBlank_(n, w) { var o = []; for (var i = 0; i < n; i++) { var r = []; for (var j = 0; j < w; j++) r.push(''); o.push(r); } return o; }
/** Пробелы связи ТТК → ХАССП для проверки ППК V65 (пустой список — пробелов нет). */
function _hzlGaps_() {
  var out = [], model = _ttkpActiveModel_(); if (!model.length) return out;
  var map = _ts2Rows_('PPK_HACCP_RISK_MAP'), covered = {}; map.forEach(function (r) { covered[r.processCode] = 1; });
  model.forEach(function (m) { if (!covered[m.processCode]) out.push('операция ' + m.processCode + ' из действующих ТТК не связана с анализом опасностей (ХАССП → «Связать с ТТК»)'); });
  map.forEach(function (r) {
    if (r.status === 'NO_CONTROL') out.push('значимая опасность «' + r.hazard + '» (' + r.processName + '): нет ККТ/ОППУ и доказательства');
    else if (r.status === 'OBSOLETE') out.push('опасность «' + r.hazard + '»: операции «' + r.processName + '» больше нет в ТТК — пересмотрите');
    // нерешённые опасности уже показывает проверка ККТ (CCP)
  });
  return out;
}

/* ------------------------------------------------------------------ API */
function haccpLinkSync(token) {
  try { _requireAuth_(token, 'haccp|haccp_approve|ppk_edit'); _ts2EnsureSchema_(false); return _ok_(_hzlSync_()); } catch (e) { return _failFrom_(e); }
}
function haccpLinkMap(token) {
  try {
    _requireAuth_(token, 'haccp|haccp_view|haccp_approve|ppk_view|ppk_edit'); _ts2EnsureSchema_(false);
    var rows = _ts2Rows_('PPK_HACCP_RISK_MAP').map(function (r) { delete r._row; return r; }), cnt = {};
    rows.forEach(function (r) { cnt[r.status] = (cnt[r.status] || 0) + 1; });
    return _ok_({ rows: rows, counts: cnt, gaps: _hzlGaps_() });
  } catch (e) { return _failFrom_(e); }
}
/** Решение человека по опасности: значима («да»/«нет») + мера и доказательство (для значимой без ККТ) или обоснование (для незначимой). */
function haccpHazardDecide(token, hazardId, significant, existingControl, evidence) {
  try {
    var s = _requireAuth_(token, 'haccp_approve');
    var sig = String(significant || '').trim().toLowerCase(); if (['да', 'нет'].indexOf(sig) < 0) return _fail_('VALIDATION', 'Решение — «да» или «нет»');
    existingControl = String(existingControl || '').trim().slice(0, 500); evidence = String(evidence || '').trim().slice(0, 500);
    if (sig === 'нет' && !evidence) return _fail_('VALIDATION', 'Для незначимой опасности укажите обоснование');
    return _withLock_(function () {
      var H = _hzlV30_(MC_V30.HAZARD), h = H.rows.filter(function (x) { return String(x.HazardID) === String(hazardId); })[0];
      if (!h) return _fail_('NOT_FOUND', 'Опасность не найдена');
      var before = { significant: h.Significant, control: h.ExistingControl, evidence: h.Evidence, status: h.Status };
      h.Significant = sig; if (existingControl) h.ExistingControl = existingControl; h.Evidence = evidence || h.Evidence; h.Status = 'ACTIVE';
      h.CreatedBy = String(h.CreatedBy || '').replace(/ \(решение:.*\)$/, '') + ' (решение: ' + ((s && (s.fullName || s.name)) || '') + ', ' + _ts2Iso_().slice(0, 10) + ')';
      H.put(h);
      _ts2Audit_('HACCP_HAZARD_DECIDE', 'HAZARD', h.HazardID, before, { significant: sig, control: h.ExistingControl, evidence: h.Evidence, status: 'ACTIVE' }, '');
      var r = _hzlSync_();
      return _ok_({ hazardId: h.HazardID, significant: sig, needDecision: r.needDecision, noControl: r.noControl });
    });
  } catch (e) { return _failFrom_(e); }
}
