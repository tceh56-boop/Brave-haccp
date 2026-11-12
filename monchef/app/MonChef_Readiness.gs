/**
 * MON CHEF — готовность к проверке по внутреннему контрольному листу.
 *
 * mcRunInspectionReadiness() проверяет каждое требование по фактам в таблице:
 *   PASS             — есть доказательство (EvidenceID), нарушений нет;
 *   FAIL             — найдено нарушение (с ID нарушающих записей);
 *   REVIEW           — нужна проверка человеком;
 *   MISSING_EVIDENCE — доказательств нет совсем;
 *   NOT_APPLICABLE   — требование к текущим данным не применимо.
 * Итог: NOT_READY — есть блокирующий FAIL или блокирующий MISSING_EVIDENCE;
 *       READY_WITH_WARNINGS — есть неблокирующие замечания; READY — замечаний нет.
 * Это НЕ заключение надзорного органа — только внутренний контрольный лист.
 */
var MC_RD_SHEET_ = 'Готовность_Проверки';
var MC_RD_HEAD_ = ['RunID', 'Время', 'Кто', 'Итог', 'PASS', 'FAIL', 'REVIEW', 'MISSING_EVIDENCE', 'NOT_APPLICABLE', 'Детали (JSON)'];

function _rdVals_(name) { var sh = _book_().getSheetByName(name); return sh && sh.getLastRow() > 1 ? sh.getDataRange().getValues().slice(1) : []; }
function _rdTime_(x) { var d = x instanceof Date ? x : _parseDate_(x); return d && d.getTime ? d.getTime() : 0; }
function _rdItem_(id, area, requirement, status, opts) {
  opts = opts || {};
  return { id: id, area: area, requirement: requirement, applicability: opts.applicability || 'все предприятия общепита', status: status,
    blocking: opts.blocking !== false, risk: opts.risk || (opts.blocking === false ? 'средний' : 'высокий'), evidence: (opts.evidence || []).slice(0, 10),
    lastFact: opts.lastFact || '', detail: opts.detail || '', correctiveAction: opts.action || '', go: opts.go || null };
}

function _mcReadinessCompute_() {
  var now = Date.now(), day = 86400000, out = [];
  // справочник нормативов (НПА, не факты предприятия) — заводится модулем «Нормативы», если ещё не заведён
  try { _v33SeedNorms_(); _v33SeedRequirements_(); } catch (e) {}
  // R01 нормативная база
  var norms = _rdVals_('Нормативы_V33').filter(function (r) { return /4282-26/.test(String(r[3]) + String(r[4])) && /ACTIVE|CURRENT/.test(String(r[2])); });
  out.push(_rdItem_('R01', 'Нормативы', 'Действующая редакция СанПиН 2.3/2.4.4282-26 (с 01.09.2026) в реестре с периодом действия',
    norms.length ? 'PASS' : 'MISSING_EVIDENCE', { evidence: norms.map(function (r) { return r[0]; }), action: 'Откройте «Нормативы» и проверьте реестр', go: { module: 'normative' } }));
  // R02 ППК
  var ppk = _rdVals_('ППК_V30').filter(function (r) { return /ACTIVE|APPROVED/.test(String(r[5])); });
  out.push(_rdItem_('R02', 'ППК', 'Утверждённая программа производственного контроля', ppk.length ? 'PASS' : 'FAIL',
    { evidence: ppk.map(function (r) { return r[0]; }), action: 'Утвердите ППК в «Конструкторе ППК»', go: { module: 'ppkbuilder' } }));
  // R03 HACCP план: ККТ с мониторингом
  var ccp = _rdVals_('HACCP_ТочкиКонтроля_V30').filter(function (r) { return /ACTIVE|APPROVED/.test(String(r[13])); });
  var mon = _rdVals_('HACCP_Мониторинг_V30');
  var noMon = ccp.filter(function (c) { return !mon.some(function (m) { return String(m[1]) === String(c[0]); }); });
  out.push(_rdItem_('R03', 'HACCP', 'Активные ККТ с критическими пределами и планом мониторинга',
    !ccp.length ? 'FAIL' : noMon.length ? 'FAIL' : 'PASS',
    { evidence: noMon.length ? noMon.map(function (r) { return r[0]; }) : ccp.map(function (r) { return r[0]; }), detail: !ccp.length ? 'ККТ не заданы' : noMon.length ? 'без мониторинга: ' + noMon.length : 'ККТ: ' + ccp.length,
      action: 'Задайте ККТ и мониторинг', go: { module: 'compliance' } }));
  // R04 открытые критические отклонения
  var dev = _rdVals_('Журналы_Отклонения').filter(function (r) { return r[0] && !/устран|закрыт|closed|resolved/i.test(String(r[7])); });
  var devCrit = dev.filter(function (r) { return r[6] === true || /true|да|ККТ|CCP/i.test(String(r[6])); });
  out.push(_rdItem_('R04', 'HACCP', 'Нет незакрытых критических отклонений', devCrit.length ? 'FAIL' : 'PASS',
    { evidence: (devCrit.length ? devCrit : _rdVals_('Журналы_Отклонения').slice(-3)).map(function (r) { return r[0]; }), detail: 'открыто критических: ' + devCrit.length + ', всего открыто: ' + dev.length,
      action: 'Внесите корректирующие действия и закройте отклонения', go: { sec: 'haccp' } }));
  // R05 температура холодильного оборудования
  // единый реестр температур (ТЗ §15): замеры холодильного оборудования + открытые отклонения
  var tm = _rdVals_('Температуры').filter(function (r) { return r[0] && /Холодильник|Морозильник|Склад|Витрина/.test(String(r[1])); });
  var tOpen = _rdVals_('Температуры').filter(function (r) { return r[0] && /^(OPEN|RECHECK_FAIL)$/.test(String(r[19])); });
  var lastT = 0; tm.forEach(function (r) { var t = _rdTime_(r[10]); if (t > lastT) lastT = t; });
  // записи журнала J01 до появления реестра тоже считаются фактами замеров
  var j01 = _rdVals_('Ж_Температуры_Холодильники').filter(function (r) { return r[1] && r[5] !== '' && r[5] !== null; });
  j01.forEach(function (r) { var t = _rdTime_(r[1]); if (t > lastT) lastT = t; });
  if (!tm.length && j01.length) tm = j01.slice(-3).map(function (r) { return ['J01#' + r[0]]; });
  out.push(_rdItem_('R05', 'Температуры', 'Температура холодильного оборудования замеряется ежедневно; отклонения отработаны (повторный замер, решение)',
    !tm.length ? 'MISSING_EVIDENCE' : tOpen.length ? 'FAIL' : (now - lastT > 2 * day ? 'FAIL' : 'PASS'),
    { evidence: tOpen.length ? tOpen.map(function (r) { return r[0] + ' ' + r[2] + ' ' + r[7] + ' ' + r[8]; }) : tm.slice(-3).map(function (r) { return r[0]; }), lastFact: lastT ? _bcDate_(new Date(lastT)) : '',
      detail: 'замеров: ' + tm.length + (tOpen.length ? ', открытых отклонений: ' + tOpen.length : '') + (lastT ? ', последний ' + _bcDate_(new Date(lastT)) : ''), action: tOpen.length ? 'Корректирующее действие и повторный замер' : 'Внесите замеры температуры', go: { module: 'temperatures' } }));
  // R06 входной контроль
  var bat = _rdVals_('Склад_Партии'), quar = bat.filter(function (r) { return r[1] && String(r[10]) === 'quarantine' && now - _rdTime_(r[4]) > day; });
  var ic = _rdVals_('Входной_Контроль');
  out.push(_rdItem_('R06', 'Приёмка', 'Входной контроль каждой партии сырья: t°, органолептика, документ, решение',
    quar.length ? 'FAIL' : ic.length ? 'PASS' : 'MISSING_EVIDENCE',
    { evidence: quar.length ? quar.map(function (r) { return r[0]; }) : ic.slice(-3).map(function (r) { return r[0]; }), detail: quar.length ? 'партий без решения больше суток: ' + quar.length : 'записей входного контроля: ' + ic.length,
      blocking: quar.length > 0 || !ic.length, action: 'Проведите входной контроль', go: { module: 'batchcontrol' } }));
  // R07 бракераж перед выдачей
  var rel = _rdVals_('Выпуск_Партий'), brkRel = {};
  rel.forEach(function (r) { if (String(r[3]) === 'BRAKERAGE' && String(r[4]) === 'RELEASE') brkRel[String(r[1])] = r[0]; });
  var iss = _rdVals_(typeof MC_V28_ISSUE_SHEET !== 'undefined' ? MC_V28_ISSUE_SHEET : 'Выдача_V28'), noBrk = [];
  iss.forEach(function (r) { if (now - _rdTime_(r[10]) > 30 * day) return; String(r[9] || '').split(',').forEach(function (b) { b = b.trim(); if (b && !brkRel[b]) noBrk.push(b); }); });
  var brkCount = Object.keys(brkRel).length;
  out.push(_rdItem_('R07', 'Бракераж', 'Готовая продукция выдаётся только после бракеража с решением «отпуск»',
    noBrk.length ? 'FAIL' : brkCount ? 'PASS' : 'MISSING_EVIDENCE',
    { evidence: noBrk.length ? noBrk : Object.keys(brkRel).slice(-3).map(function (k) { return brkRel[k]; }), detail: noBrk.length ? 'выдано без бракеража: ' + noBrk.length + ' партий (до включения запрета)' : 'решений «отпуск»: ' + brkCount,
      action: 'Проведите бракераж', go: { module: 'journals' } }));
  // R08 суточные пробы
  var miss = typeof _dsMissing_ === 'function' ? _dsMissing_() : [], ds = _rdVals_('Суточные_Пробы');
  var due = ds.filter(function (r) { return String(r[13]) === 'STORED' && _rdTime_(r[12]) && _rdTime_(r[12]) < now - day; });
  out.push(_rdItem_('R08', 'Суточные пробы', 'Суточная проба от каждой выпущенной партии, хранение 48 ч, уничтожение по сроку',
    miss.length ? 'FAIL' : due.length ? 'REVIEW' : ds.length ? 'PASS' : 'MISSING_EVIDENCE',
    { evidence: miss.length ? miss.map(function (x) { return x.batchId; }) : ds.slice(-3).map(function (r) { return r[0]; }), detail: miss.length ? 'партий без пробы: ' + miss.length : due.length ? 'просрочено уничтожение: ' + due.length : 'проб: ' + ds.length,
      action: 'Отберите пробы', go: { module: 'samples' } }));
  // R09 медицинский допуск пищевого персонала
  var emps = []; try { emps = JSON.parse(getEmployeesFull_()).filter(function (e) { return e.active !== false && e.fullName && MC_FOOD_ROLES_.indexOf(String(e.role || '').trim()) >= 0; }); } catch (e) {}
  _MC_ADM_CACHE = null;
  var bad = emps.map(function (e) { var a = _mcAdmissionByName_(e.fullName); return { name: e.fullName, a: a }; }).filter(function (x) { return x.a.status !== 'ADMITTED'; });
  out.push(_rdItem_('R09', 'Медкнижки', 'У каждого сотрудника с пищевой ролью действующий медосмотр и гигиеническая аттестация',
    !emps.length ? 'NOT_APPLICABLE' : bad.length ? 'FAIL' : 'PASS',
    { evidence: bad.length ? bad.map(function (x) { return x.name + ' (' + x.a.status + ')'; }) : emps.slice(0, 3).map(function (e) { return e.fullName; }), detail: 'без допуска: ' + bad.length + ' из ' + emps.length,
      action: 'Обновите медкнижки', go: { sec: 'haccp', tab: 'Медкнижки' } }));
  // R10 лабораторный контроль
  var lp = _rdVals_('Лаборатория_План').filter(function (r) { return r[0] && r[8] !== false; }), lt = _rdVals_('Лаборатория_Исследования');
  var overdue = lp.filter(function (p) {
    var last = 0; lt.forEach(function (t) { if (String(t[1]) === String(p[0])) { var tt = _rdTime_(t[6]); if (tt > last) last = tt; } });
    return !last || now - last > (Number(p[4]) || 0) * day;
  });
  var labFail = lt.filter(function (t) { return String(t[10]) === 'не соответствует' && now - _rdTime_(t[9]) < 90 * day; });
  out.push(_rdItem_('R10', 'Лаборатория', 'План лабораторного контроля выполняется в срок, несоответствия отработаны',
    !lp.length ? 'FAIL' : overdue.length ? 'FAIL' : labFail.length ? 'REVIEW' : 'PASS',
    { evidence: !lp.length ? [] : overdue.length ? overdue.map(function (r) { return r[0]; }) : lt.slice(-3).map(function (r) { return r[0]; }),
      detail: !lp.length ? 'плана нет' : 'просрочено по плану: ' + overdue.length + ', несоответствий за 90 дн.: ' + labFail.length, action: 'Составьте/выполните план', go: { sec: 'haccp' } }));
  // R11 дезсредства и санитария
  var dsm = _rdVals_('Дезсредства_V41').filter(function (r) { return String(r[11]) === 'APPROVED' && String(r[4]) === 'YES'; });
  var reg = _rdVals_('Дезсредства_Режимы_V41').filter(function (r) { return String(r[11]) === 'APPROVED'; });
  var dsFail = _rdVals_('Дезсредства_Факты_V41').filter(function (r) { return String(r[7]) === 'FAIL' && now - _rdTime_(r[3]) < 7 * day; });
  out.push(_rdItem_('R11', 'Санитария', 'Дезсредства с утверждёнными режимами; концентрации растворов в пределах режима',
    !dsm.length || !reg.length ? 'FAIL' : dsFail.length ? 'REVIEW' : 'PASS',
    { evidence: dsFail.length ? dsFail.map(function (r) { return r[0]; }) : reg.map(function (r) { return r[0]; }), detail: 'утверждённых средств: ' + dsm.length + ', режимов: ' + reg.length + ', несоответствий за 7 дн.: ' + dsFail.length,
      action: 'Утвердите режимы дезсредств', go: { module: 'disinfectants' } }));
  // R12 оборудование
  var eq = typeof _mcEqList_ === 'function' ? _mcEqList_().filter(function (e) { return e.measuring && e.status === 'ACTIVE'; }) : [];
  var eqBad = eq.filter(function (e) { return e.effective !== 'ACTIVE'; });
  out.push(_rdItem_('R12', 'Оборудование', 'Измерительные приборы поверены; прибор с истёкшей поверкой не используется',
    !eq.length ? 'MISSING_EVIDENCE' : eqBad.length ? 'FAIL' : 'PASS',
    { evidence: (eqBad.length ? eqBad : eq).map(function (e) { return e.id; }), detail: !eq.length ? 'приборы не внесены' : 'с истёкшей поверкой: ' + eqBad.length + ' из ' + eq.length,
      action: 'Внесите приборы и свидетельства поверки', go: { module: 'equipment' } }));
  // R13 прослеживаемость выпусков
  var tr = _rdVals_(typeof MC_TRACE_SHEET !== 'undefined' ? MC_TRACE_SHEET : 'TRACE_LINKS');
  var outs = _rdVals_(typeof MC_FACTS_SHEET !== 'undefined' ? MC_FACTS_SHEET : 'Факты').filter(function (r) { return String(r[1]) === 'PRODUCTION_OUTPUT' && now - _rdTime_(r[5]) < 30 * day; });
  var linked = {}; tr.forEach(function (r) { linked[String(r[2])] = true; linked[String(r[5])] = true; });
  var noTrace = outs.filter(function (r) { return !linked[String(r[13] || r[3])]; });
  out.push(_rdItem_('R13', 'Traceability', 'Каждая выпущенная партия прослеживается до сырья и поставщика',
    !outs.length ? 'NOT_APPLICABLE' : noTrace.length ? 'REVIEW' : 'PASS',
    { evidence: (noTrace.length ? noTrace : outs.slice(-3)).map(function (r) { return r[13] || r[3]; }), detail: 'выпусков за 30 дн.: ' + outs.length + ', без связей: ' + noTrace.length, blocking: false, go: { sec: 'production' } }));
  // R14 аудит
  var au = _rdVals_('Audit_Log'), lastA = 0; au.forEach(function (r) { var t = _rdTime_(r[0]); if (t > lastA) lastA = t; });
  out.push(_rdItem_('R14', 'Аудит', 'Критические действия фиксируются в журнале аудита', au.length ? 'PASS' : 'MISSING_EVIDENCE',
    { evidence: au.slice(-3).map(function (r) { return r[1]; }), lastFact: lastA ? _bcDate_(new Date(lastA)) : '', blocking: false }));
  // R15 резервное копирование и учения по восстановлению
  var drills = _rdVals_('Резерв_Восстановление');
  out.push(_rdItem_('R15', 'Резервные копии', 'Резервная копия с хешем и проведённое учение по восстановлению',
    drills.some(function (r) { return String(r[3]) === 'RESTORE_DRILL_OK'; }) ? 'PASS' : 'MISSING_EVIDENCE',
    { evidence: drills.slice(-3).map(function (r) { return r[0]; }), blocking: false, action: 'Сделайте копию и учение по восстановлению' }));

  // R16–R18 вода, отходы, вредители
  var env = typeof _envState_ === 'function' ? _envState_() : null;
  if (env) {
    var wOver = env.water.plans.filter(function (p) { return p.overdue; }), wFail = env.water.controls.filter(function (c) { return c.result === 'FAIL'; });
    out.push(_rdItem_('R16', 'Вода', 'План лабораторного контроля питьевой воды выполняется, результаты соответствуют',
      !env.water.plans.length ? 'MISSING_EVIDENCE' : wOver.length ? 'FAIL' : wFail.length ? 'REVIEW' : 'PASS',
      { evidence: wOver.length ? wOver.map(function (p) { return p.id; }) : env.water.controls.slice(0, 3).map(function (c) { return c.id; }),
        detail: !env.water.plans.length ? 'плана нет' : 'просрочено: ' + wOver.length + ', несоответствий в последних: ' + wFail.length, action: 'Внесите план и протоколы', go: { module: 'environment' } }));
    var wsOver = env.waste.records.filter(function (r) { return r.overdue; }), wsDone = env.waste.records.filter(function (r) { return r.status === 'ВЫВЕЗЕНО'; });
    out.push(_rdItem_('R17', 'Отходы', 'Отходы вывозятся в срок по договору, с документом',
      wsOver.length ? 'FAIL' : wsDone.length ? 'PASS' : 'MISSING_EVIDENCE',
      { evidence: wsOver.length ? wsOver.map(function (r) { return r.id; }) : wsDone.slice(0, 3).map(function (r) { return r.id + ' (' + r.document + ')'; }), blocking: wsOver.length > 0,
        detail: 'просрочен вывоз: ' + wsOver.length + ', вывозов с документом: ' + wsDone.length, action: 'Оформите вывоз', go: { module: 'environment' } }));
    var pBad = env.pests.plans.filter(function (p) { return p.expired || p.overdue; }), pFound = env.pests.events.filter(function (e) { return e.result === 'обнаружено'; });
    out.push(_rdItem_('R18', 'Вредители', 'Действующий договор на дезинсекцию/дератизацию, мероприятия в срок',
      !env.pests.plans.length ? 'MISSING_EVIDENCE' : pBad.length ? 'FAIL' : pFound.length ? 'REVIEW' : 'PASS',
      { evidence: pBad.length ? pBad.map(function (p) { return p.id + (p.expired ? ' (договор истёк)' : ' (просрочено)'); }) : env.pests.events.slice(0, 3).map(function (e) { return e.id + ' акт ' + e.act; }),
        detail: !env.pests.plans.length ? 'договора нет' : 'нарушений плана: ' + pBad.length + ', обнаружений: ' + pFound.length, action: 'Внесите договор и акты', go: { module: 'environment' } }));
  }
  // R20 документы на сырьё и ветконтроль (ТЗ §5–6)
  try {
    var t0d = new Date(); t0d = new Date(t0d.getFullYear(), t0d.getMonth(), t0d.getDate());
    var sdocs = _rdVals_('Документы_Сырьё').filter(function (r) { return r[0] && r[12] !== 'REVOKED'; });
    var sdExp = sdocs.filter(function (r) { var d = _parseDate_(r[4]); return d && d < t0d; }), sdNoVer = sdocs.filter(function (r) { return !r[13] && r[1] !== 'Этикетка производителя' && r[1] !== 'Фото товара при приёмке'; });   // оригинал этикетки подтверждает принявший при приёмке
    var vetBad = _rdVals_('Склад_Партии').filter(function (r) { return r[0] && String(r[10]) === 'active' && (parseFloat(r[9]) || 0) > 0 && _sdVetControlled_(r[17], r[1]) && !_sdBatchVet_(r[0]).extinguished; });
    out.push(_rdItem_('R20', 'Документы на сырьё', 'Документы на сырьё действующие и проверены; партии подконтрольной продукции — с погашенным ВСД',
      !sdocs.length ? 'MISSING_EVIDENCE' : vetBad.length ? 'FAIL' : (sdExp.length || sdNoVer.length) ? 'REVIEW' : 'PASS',
      { evidence: vetBad.length ? vetBad.map(function (r) { return r[0] + ' ' + r[1] + ' (нет погашенного ВСД)'; }) : sdExp.length ? sdExp.map(function (r) { return r[1] + ' № ' + r[2] + ' истёк'; }) : sdocs.slice(-3).map(function (r) { return r[0]; }),
        blocking: vetBad.length > 0 || !sdocs.length,
        detail: 'документов: ' + sdocs.length + ', истекло: ' + sdExp.length + ', не проверено: ' + sdNoVer.length + (vetBad.length ? ', партий без погашенного ВСД: ' + vetBad.length : ''),
        action: 'Внесите и проверьте документы, погасите ВСД', go: { module: 'supplydocs' } }));
  } catch (e) {}
  // R19 целостность: контроли не отключены, листы-доказательства защищены, ручные правки видны
  try {
    var ig = _mcIntegrityState_();
    out.push(_rdItem_('R19', 'Целостность данных', 'Карантин и медицинский допуск включены; листы-доказательства защищены от прямой правки',
      ig.off.length ? 'FAIL' : !ig.protectedAt ? 'REVIEW' : ig.lastManualEdit ? 'REVIEW' : 'PASS',
      { evidence: ig.off.length ? ig.off.map(function (w) { return w.prop + '=off'; }) : ig.protectedAt ? ['защита с ' + ig.protectedAt.slice(0, 10)] : [],
        blocking: ig.off.length > 0,
        detail: ig.off.length ? 'отключено: ' + ig.off.map(function (w) { return w.name; }).join(', ') : !ig.protectedAt ? 'защита листов не включена' : ig.lastManualEdit ? 'последняя ручная правка: ' + ig.lastManualEdit.sheet + ' ' + ig.lastManualEdit.range + ' (' + (ig.lastManualEdit.who || '?') + ')' : 'контроли включены, листы защищены',
        action: ig.off.length ? 'Включите контроль (удалите свойство скрипта)' : 'Настройки → «Защита журналов»', go: { sec: 'settings' } }));
  } catch (e) {}
  var cnt = { PASS: 0, FAIL: 0, REVIEW: 0, MISSING_EVIDENCE: 0, NOT_APPLICABLE: 0 };
  out.forEach(function (x) { cnt[x.status]++; });
  var blockingFail = out.some(function (x) { return x.blocking && (x.status === 'FAIL' || x.status === 'MISSING_EVIDENCE'); });
  var overall = blockingFail ? 'NOT_READY' : (cnt.FAIL + cnt.REVIEW + cnt.MISSING_EVIDENCE ? 'READY_WITH_WARNINGS' : 'READY');
  return { at: new Date().toISOString(), overall: overall, counts: cnt, items: out,
    note: 'Готовность по внутреннему контрольному листу. Не является заключением надзорного органа.' };
}

/** Запуск проверки готовности: результат сохраняется (доказательство прогона). */
function mcRunInspectionReadiness(token) {
  try {
    return _ok_(_mcReadinessRecord_(_requireAuth_(token, 'journals')));
  } catch (e) { return _failFrom_(e); }
}
/** Расчёт + запись прогона в «Готовность_Проверки» (общий для экрана и пакета проверки). */
function _mcReadinessRecord_(s) {
    var r = _mcReadinessCompute_();
    var id = 'RDY-' + Date.now();
    try {
      _bcSheet_(MC_RD_SHEET_, MC_RD_HEAD_).appendRow([id, new Date(), s.name || '', r.overall, r.counts.PASS, r.counts.FAIL, r.counts.REVIEW,
        r.counts.MISSING_EVIDENCE, r.counts.NOT_APPLICABLE, JSON.stringify(r.items.map(function (x) { return [x.id, x.status, x.evidence.slice(0, 3)]; })).slice(0, 45000)]);
    } catch (e) {}
    r.runId = id;
    try { CacheService.getScriptCache().put('mc_ready_v1', JSON.stringify(r), 600); } catch (e) {}
    return r;
}
/** Для главного экрана: последний результат (не старше 10 минут) или новый расчёт. */
function _mcReadinessCached_() {
  try { var c = CacheService.getScriptCache().get('mc_ready_v1'); if (c) return JSON.parse(c); } catch (e) {}
  var r = _mcReadinessCompute_();
  try { CacheService.getScriptCache().put('mc_ready_v1', JSON.stringify(r), 600); } catch (e) {}
  return r;
}
