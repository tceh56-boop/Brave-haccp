/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
/**
 * ЦЕХ Стандарт — один генератор ППК (Мастер-промт 4.0, этап 4).
 *
 * «Конструктор ППК» (V35) и «ТТК → ППК» (V37) вели собственные реестры процессов, опасностей и ККТ параллельно
 * с ХАССП (V30) и ППК (V65). Теперь:
 *  - ППК формирует, согласует и вводит только V65; процессы, опасности и ККТ — только в V30;
 *  - изменяющие функции V35/V37 закрыты (понятный ответ вместо записи в параллельный реестр); данные остаются для просмотра;
 *  - перенос данных V35/V37 в V30 — по кнопке ответственного за ХАССП (ppkLegacyImport), идемпотентно, ничего не удаляет.
 * Решения о значимости переносятся только явные (V35: значима = да). «Нет» по умолчанию в V35 решением не считается.
 */
function _ppkLegacyClosed_(fn) {
  return _fail_('LEGACY_CLOSED', 'Раздел заменён: ППК формируется в разделе «ППК», процессы, опасности и ККТ — в «ХАССП», связь с ТТК — в «Процессы ТТК». ' +
    'Данные прежнего раздела доступны для просмотра; перенести их в ХАССП можно кнопкой «Перенести в ХАССП» (' + fn + ').');
}
/** Состояние прежних разделов: сколько данных и что уже перенесено. */
function _ppkLegacyState_() {
  var cnt = function (n) { var sh = _book_().getSheetByName(n); return sh ? Math.max(0, sh.getLastRow() - 1) : 0; };
  var v30 = function (n) { try { return _v30Rows_(n).map(function (r) { return String(r[0]); }); } catch (e) { return []; } };
  var ids = v30(MC_V30.PROCESS).concat(v30(MC_V30.HAZARD), v30(MC_V30.CCP)), imported = ids.filter(function (x) { return /^V3[57]-/.test(x); }).length;
  return { v35: { documents: cnt(MC_V35.DOC), processes: cnt(MC_V35.PROC), hazards: cnt(MC_V35.HAZ), controls: cnt(MC_V35.CCP) },
    v37: { documents: cnt(MC_V37.DOC), processes: cnt(MC_V37.PROC), controls: cnt(MC_V37.CONTROL) }, importedToV30: imported };
}
/** Перенос V35/V37 → V30. Повторный запуск ничего не дублирует; строки V30 предприятия не меняются. */
function _ppkLegacyImport_(who) {
  return _withLock_(function () {
    var P = _hzlV30_(MC_V30.PROCESS), H = _hzlV30_(MC_V30.HAZARD), K = _hzlV30_(MC_V30.CCP), now = new Date(), res = { processes: 0, hazards: 0, controls: 0, needBinding: 0 };
    var has = function (T, id) { return T.rows.some(function (r) { return String(r[T.h[0]]) === String(id); }); };
    var byName = {}; P.rows.forEach(function (p) { if (String(p.Status) !== 'ARCHIVED') byName[String(p.Name).trim().toLowerCase()] = p.ProcessID; });
    var procMap = {};
    // V35: процессы → опасности → ККТ/ОППУ
    _v35Rows_(MC_V35.PROC).forEach(function (r) {
      var id = 'V35-' + r[0], nm = String(r[1] || '').trim(); if (!nm) return;
      if (byName[nm.toLowerCase()] && !has(P, id)) { procMap[r[0]] = byName[nm.toLowerCase()]; return; }
      procMap[r[0]] = id; if (has(P, id)) return;
      P.put({ ProcessID: id, Code: '', Name: nm, Sequence: r[2] || '', Input: r[5] || '', Output: r[6] || '', Responsible: '', Status: 'DRAFT', Version: '1', ApprovedAt: '', ApprovedBy: '',
        Notes: 'Перенесено из «Конструктора ППК» (V35)' + (r[3] ? '; участок: ' + r[3] : '') + (r[4] ? '; оборудование: ' + r[4] : ''), CreatedAt: now, CreatedBy: who });
      byName[nm.toLowerCase()] = id; res.processes++;
    });
    _v35Rows_(MC_V35.HAZ).forEach(function (r) {
      var id = 'V35-' + r[0], pid = procMap[r[1]]; if (!pid || has(H, id) || !String(r[3] || '').trim()) return;
      var sig = r[8] === true || String(r[8]).toUpperCase() === 'TRUE';
      H.put({ HazardID: id, ProcessID: pid, Category: r[2] || '', Hazard: r[3], Cause: r[4] || '', PreventiveMeasure: r[5] || '', Severity: r[6] || '', Likelihood: r[7] || '', Risk: '',
        Significant: sig ? 'да' : '', ExistingControl: '', Evidence: r[9] && r[9] !== 'USER' ? 'Основание (V35): ' + r[9] : '', Status: sig ? 'ACTIVE' : 'PROPOSED', CreatedAt: now, CreatedBy: who + ' (перенос V35)' });
      res.hazards++;
    });
    _v35Rows_(MC_V35.CCP).forEach(function (r) {
      var id = 'V35-' + r[0], pid = procMap[r[1]]; if (!pid || has(K, id)) return;
      K.put({ ControlID: id, ProcessID: pid, HazardID: '', Type: r[2] || 'ККТ', ControlPoint: r[3] || '', CriticalLimit: r[4] || '', LimitUnit: r[5] || '', MonitoringMethod: r[6] || '', Frequency: r[7] || '',
        Responsible: r[8] || '', CorrectiveAction: r[9] || '', VerificationMethod: r[10] || '', RecordSource: r[11] || '', Status: 'DRAFT', Version: '1', ApprovedAt: '', ApprovedBy: '', CreatedAt: now, CreatedBy: who + ' (перенос V35)' });
      res.controls++;
    });
    // V37: меры по операциям ТТК → ККТ/ОППУ у процесса V30 этой операции (по справочнику операций); не распознано — «требует привязки»
    var v37proc = {}; _v37Rows_(MC_V37.PROC).forEach(function (r) { v37proc[r[1]] = r; });
    var dict = null, unb = null;
    _v37Rows_(MC_V37.CONTROL).forEach(function (r) {
      var id = 'V37-' + r[1]; if (has(K, id)) return;
      var pr = v37proc[r[2]], pid = '';
      if (pr) { if (!dict) dict = _ttkpDict_(); var ops = _ttkpOps_({ method: String(pr[4] || '') }, dict);
        ops.some(function (o) { var p = P.rows.filter(function (x) { return String(x.Status) !== 'ARCHIVED' && (x.Code === o.p.code || x.Code === HZL_V30_ALIAS_[o.p.code]); })[0]; if (p) pid = p.ProcessID; return !!p; }); }
      if (!pid) {
        if (!unb) { unb = P.rows.filter(function (x) { return x.ProcessID === 'V37-UNBOUND'; })[0];
          if (!unb) { unb = { ProcessID: 'V37-UNBOUND', Code: '', Name: 'Меры из «ТТК → ППК» (V37): требуется привязка к процессу', Sequence: 99, Input: '', Output: '', Responsible: '', Status: 'DRAFT', Version: '1', ApprovedAt: '', ApprovedBy: '',
            Notes: 'Операция не распознана — привяжите каждую меру к процессу ХАССП', CreatedAt: now, CreatedBy: who }; P.put(unb); } }
        pid = unb.ProcessID; res.needBinding++;
      }
      K.put({ ControlID: id, ProcessID: pid, HazardID: '', Type: r[3] || 'ККТ', ControlPoint: (r[4] || '') + (pr ? ' (ТТК ' + pr[2] + ': ' + String(pr[4] || '').slice(0, 80) + ')' : ''), CriticalLimit: r[5] || '', LimitUnit: r[6] || '', MonitoringMethod: r[7] || '',
        Frequency: r[8] || '', Responsible: r[9] || '', CorrectiveAction: r[10] || '', VerificationMethod: r[11] || '', RecordSource: r[12] || '', Status: 'DRAFT', Version: '1', ApprovedAt: '', ApprovedBy: '', CreatedAt: now, CreatedBy: who + ' (перенос V37)' });
      res.controls++;
    });
    return res;
  });
}
function ppkLegacyState(token) {
  try { _requireAuth_(token, 'haccp|haccp_view|haccp_approve|ppk_view|ppk_edit'); _v35Init_(); _v37Init_(); return _ok_(_ppkLegacyState_()); } catch (e) { return _failFrom_(e); }
}
function ppkLegacyImport(token) {
  try {
    var s = _requireAuth_(token, 'haccp|haccp_approve'); _v35Init_(); _v37Init_(); _v30Init_();
    var r = _ppkLegacyImport_((s && (s.fullName || s.name)) || '');
    _ts2Audit_('PPK_LEGACY_IMPORT', 'HACCP', 'V35/V37', undefined, r, 'перенос прежних разделов ППК в ХАССП (V30)');
    return _ok_(r);
  } catch (e) { return _failFrom_(e); }
}
