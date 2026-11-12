/**
 * ЦЕХ Стандарт V68 — новые отчёты (ТЗ «Итоговая структура…», §20): финансовые, ППК, ТУ и лаборатории.
 * Каждый отчёт — таблица на экране и PDF с логотипом и реквизитами организации (_mcPdfSave_).
 * Отчёты только читают данные; финансовые строятся из того же журнала «Экономика потока» V64 (первичные листы не меняются).
 */
var MC_V68_REPORTS = [
  // финансовые
  ['F01', 'Себестоимость блюда по этапам', 'finance_view', ['dish', 'from', 'to']], ['F02', 'Себестоимость партии', 'finance_view', ['batch']],
  ['F03', 'Себестоимость выпуска', 'finance_view', ['production']], ['F04', 'Стоимость отходов', 'finance_view', ['from', 'to']], ['F05', 'Стоимость возвратов', 'finance_view', ['from', 'to']],
  ['F06', 'Цена и маржинальность блюда', 'finance_view', ['from', 'to']], ['F07', 'Отклонение плановой и фактической себестоимости', 'finance_view', ['from', 'to']],
  ['F08', 'Движение стоимости от поставщика до продажи', 'finance_view', ['product', 'from', 'to']], ['F09', 'Валовой вклад по блюду, банкету, цеху и периоду', 'finance_view', ['from', 'to']],
  ['F10', 'Позиции без цены', 'finance_view', ['from', 'to']], ['F11', 'Операции с неполной прослеживаемостью', 'finance_view', ['from', 'to']],
  // ППК, ТУ, лаборатория
  ['Q01', 'Действующие версии ППК', 'ppk_view', []], ['Q02', 'Просроченные мероприятия ППК', 'ppk_view', []], ['Q03', 'График лабораторных исследований', 'lab_view', []],
  ['Q04', 'Ожидаемые протоколы', 'lab_view', []], ['Q05', 'Несоответствующие результаты', 'lab_view', []], ['Q06', 'Партии на блокировке', 'lab_view|haccp_view', []],
  ['Q07', 'Повторные исследования', 'lab_view', []], ['Q08', 'Действующие и архивные ТУ', 'tu_view', []], ['Q09', 'Перечень нормативных ссылок', 'ppk_view|tu_view|haccp_view', []],
  ['Q10', 'Готовность предприятия к проверке', 'audit_view|haccp_view|reports', []]
];
var MC_V68_PARAM_RU = { dish: 'Блюдо (код ТТК)', batch: 'Партия', production: 'Выпуск', product: 'Продукт или ProductID', from: 'Период с', to: 'Период по' };
function _v68Def_(id) { return MC_V68_REPORTS.filter(function (r) { return r[0] === id; })[0] || null; }
function _v68Allowed_(s, def) { return _mcRbHasExact_(s, def[2] + '|' + def[2].split('|').map(function (p) { return { lab_view: 'lab|lab_edit|lab_upload|lab_approve', ppk_view: 'ppk_edit|ppk_approve', tu_view: 'tu_edit|tu_approve' }[p] || p; }).join('|')); }
function _v68C_(k, l, t) { return { k: k, l: l, t: t || 'text' }; }
function _v68Lines_(lines) { return lines.map(function (l) { return l.flagsRu ? l : _v64LineOut_(l); }); }
var MC_V68_LINE_COLS = [_v68C_('date', 'Дата'), _v68C_('stageRu', 'Этап'), _v68C_('dir', 'Движение'), _v68C_('batch', 'Партия'), _v68C_('product', 'Продукт / блюдо'), _v68C_('qty', 'Кол-во', 'num'),
  _v68C_('unit', 'Ед.'), _v68C_('unitPrice', 'Цена, ₽', 'num'), _v68C_('amount', 'Сумма, ₽', 'num'), _v68C_('trace', 'Статус'), _v68C_('flagsText', 'Признаки'), _v68C_('note', 'Примечание')];
function _v68Fl_(rows) { return rows.map(function (r) { r.flagsText = (r.flagsRu || []).join(', '); return r; }); }

function _v68Build_(id, p) {
  var D = function (x) { return x && x.data !== undefined ? x.data : x; }, tok = p.__tok, rg = function () { return _v64Range_(p.from, p.to); };
  var J = function (s) { var x = JSON.parse(s); if (x && x.success === false) throw new Error((x.error && x.error.message) || 'ошибка'); return D(x); };
  switch (id) {
    case 'F01': { if (!p.dish) throw new Error('VALIDATION: укажите блюдо'); var e = J(v64GetDishEconomics(p.dish, p.from, p.to, tok));
      return { subtitle: e.name + ' (' + e.code + ') · ' + e.from + ' — ' + e.to, columns: [_v68C_('n', '№'), _v68C_('title', 'Этап расчёта'), _v68C_('amount', 'Сумма, ₽', 'num'), _v68C_('detail', 'Детали')],
        rows: e.steps.map(function (s) { return { n: s.n, title: s.title, amount: s.amount === null ? '' : s.amount, detail: s.n === 1 ? s.items.map(function (i) { return i.product + ' ' + i.batch + ': ' + i.price + ' ₽/' + i.unit + (i.missingPrice ? ' (нет цены)' : ''); }).join('; ') : s.n === 15 ? 'маржинальность ' + (s.marginPct === null ? '—' : s.marginPct + ' %') : s.n === 16 ? 'после распределения: ' + (s.afterAllocation === null ? '—' : s.afterAllocation) : (s.lines ? s.lines.length + ' строк' : '') }; }),
        card: e.card, notes: [e.note].concat(e.card.warnings || []) }; }
    case 'F02': { if (!p.batch) throw new Error('VALIDATION: укажите партию'); var b = J(v64GetBatchEconomics(p.batch, tok));
      return { subtitle: b.product + ' · партия ' + b.batchId + (b.supplier ? ' · ' + b.supplier + ', накладная ' + b.invoice : ''), columns: MC_V68_LINE_COLS, rows: _v68Fl_(b.lines),
        totals: { 'Стоимость партии': b.startValue, 'Доп. расходы': b.extraCosts, 'Израсходовано': b.usedValue, 'Списано / потери': b.wasteValue, 'Возврат': b.returnValue, 'Остаток': b.remainValue }, notes: b.flagsRu }; }
    case 'F03': { if (!p.production) throw new Error('VALIDATION: укажите выпуск'); var pr = J(v64GetProductionEconomics(p.production, tok));
      return { subtitle: pr.product + ' · ' + pr.productionId + ' · ТТК ' + pr.ttk, columns: MC_V68_LINE_COLS, rows: _v68Fl_(pr.inputs.concat(pr.output, pr.losses)),
        totals: { 'План': pr.plan + ' ' + pr.unit, 'Факт': pr.fact + ' ' + pr.unit, 'Стоимость выпуска': pr.totalCost, 'Цена единицы': pr.unitCost, 'Норматив': pr.normativeCost === null ? '—' : pr.normativeCost, 'Отклонение': pr.deviation === null ? '—' : pr.deviation + ' (' + pr.deviationPct + ' %)' } }; }
    case 'F04': case 'F05': { var r = rg(), L = _v68Lines_(_v64Build_(r).lines.filter(function (l) { return id === 'F04' ? (l.stage === 'WASTE' || (l.stage === 'DEFROST' && l.dir === 'OUT') || l.wasteValue) : l.stage === 'RETURN'; }));
      var sum = L.reduce(function (a, l) { return a + (Number(l.amount) || 0) + (id === 'F04' && !l.amount ? Number(l.wasteValue) || 0 : 0); }, 0);
      return { subtitle: r.fromIso + ' — ' + r.toIso, columns: MC_V68_LINE_COLS.concat(id === 'F04' ? [_v68C_('wasteValue', 'Стоимость отходов, перенесённая на выход, ₽', 'num')] : []), rows: _v68Fl_(L), totals: { 'Итого, ₽': _v64R2_(sum) } }; }
    case 'F06': case 'F09': { var db = J(v64GetDashboard(tok, p.from, p.to)), cols = [_v68C_('key', 'Объект'), _v68C_('qty', 'Продано', 'num'), _v68C_('revenue', 'Выручка, ₽', 'num'), _v68C_('cost', 'Себестоимость, ₽', 'num'), _v68C_('gross', 'Валовой вклад, ₽', 'num'), _v68C_('marginPct', 'Маржа, %', 'num'), _v68C_('waste', 'Потери, ₽', 'num')];
      if (id === 'F06') return { subtitle: db.from + ' — ' + db.to, columns: cols, rows: db.dishes, notes: ['Цена продажи — из продажи, меню или договора; от себестоимости не рассчитывается.'] };
      var rows = [].concat(db.dishes.map(function (x) { x.group = 'Блюдо'; return x; }), db.banquets.map(function (x) { x.group = 'Банкет'; return x; }), db.workshops.map(function (x) { x.group = 'Цех'; return x; }));
      rows.push({ group: 'Период', key: db.from + ' — ' + db.to, revenue: db.totals.revenue, cost: db.totals.cogsWithPackaging, gross: db.totals.grossContribution, marginPct: db.totals.marginPct, waste: db.totals.wasteCost });
      return { subtitle: db.from + ' — ' + db.to, columns: [_v68C_('group', 'Разрез')].concat(cols), rows: rows, totals: { 'Выручка, ₽': db.totals.revenue, 'Валовой вклад, ₽': db.totals.grossContribution, 'Маржа, %': db.totals.marginPct, 'Вклад после потерь, ₽': db.totals.contributionAfterLosses } }; }
    case 'F07': { var r7 = rg(), res = _v64Build_(r7), out = [];
      Object.keys(res.production).forEach(function (k) { var x = res.production[k]; if (!_v64In_(x.date, r7)) return; var n = _v64NormCost_(x.code), d0 = _v64DishOf_(x.code), norm = null;
        if (n.cost > 0) norm = d0 && d0.semi ? (n.perUnit ? n.perUnit * (_v64Conv_(x.fact, x.unit, d0.yieldUnit || 'г') || 0) : null) : n.cost * x.fact;
        out.push({ production: k, product: x.name, fact: x.fact + ' ' + x.unit, actual: _v64R2_(x.total), normative: norm === null ? '' : _v64R2_(norm), deviation: norm === null ? '' : _v64R2_(x.total - norm), pct: norm ? Math.round((x.total - norm) / norm * 1000) / 10 : '' }); });
      return { subtitle: r7.fromIso + ' — ' + r7.toIso, columns: [_v68C_('production', 'Выпуск'), _v68C_('product', 'Продукт'), _v68C_('fact', 'Выход'), _v68C_('normative', 'Норматив, ₽', 'num'), _v68C_('actual', 'Факт, ₽', 'num'), _v68C_('deviation', 'Отклонение, ₽', 'num'), _v68C_('pct', 'Отклонение, %', 'num')], rows: out,
        notes: ['Норматив — по действующей ТТК и текущим ценам; факт — по партиям, фактически израсходованным (FEFO).'] }; }
    case 'F08': { if (!p.product) throw new Error('VALIDATION: укажите продукт'); var fl = J(v64GetProductFlow(p.product, p.from, p.to, tok));
      return { subtitle: fl.product + ' · ' + fl.from + ' — ' + fl.to, columns: [_v68C_('stageRu', 'Этап'), _v68C_('dir', 'Движение'), _v68C_('qty', 'Кол-во', 'num'), _v68C_('unit', 'Ед.'), _v68C_('amount', 'Сумма, ₽', 'num'), _v68C_('lines', 'Строк', 'num')], rows: fl.stages }; }
    case 'F10': case 'F11': { var db2 = J(v64GetDashboard(tok, p.from, p.to)), L2 = id === 'F10' ? db2.noPrice : db2.problems;
      return { subtitle: db2.from + ' — ' + db2.to, columns: MC_V68_LINE_COLS, rows: _v68Fl_(L2), totals: { 'Записей': L2.length } }; }
    case 'Q01': { var P = _v65Objs_('PPK').filter(function (x) { return x.Status === 'ACTIVE' || x.Status === 'APPROVED'; });
      return { columns: [_v68C_('id', 'ППК'), _v68C_('name', 'Название'), _v68C_('ver', 'Версия', 'num'), _v68C_('from', 'С'), _v68C_('to', 'По'), _v68C_('st', 'Статус'), _v68C_('by', 'Утвердил'), _v68C_('hash', 'Хеш PDF')],
        rows: P.map(function (x) { return { id: x.PPKID, name: x.Name, ver: x.Version, from: _v65Fmt_(x.DateFrom), to: _v65Fmt_(x.DateTo), st: MC_V65_ST_RU[x.Status], by: x.ApprovedBy, hash: String(x.Hash || '').slice(0, 16) }; }) }; }
    case 'Q02': { var rows2 = []; _v65Objs_('PPK').filter(function (x) { return x.Status === 'ACTIVE'; }).forEach(function (x) { _v65ScheduleState_(x.PPKID, '', '').filter(function (i) { return i.status === 'OVERDUE'; }).forEach(function (i) { i.ppk = x.PPKID; rows2.push(i); }); });
      return { columns: [_v68C_('due', 'Срок'), _v68C_('object', 'Объект'), _v68C_('parameter', 'Мероприятие'), _v68C_('role', 'Ответственный'), _v68C_('journal', 'Журнал'), _v68C_('ppk', 'ППК')], rows: rows2, totals: { 'Просрочено': rows2.length } }; }
    case 'Q03': case 'Q04': case 'Q05': case 'Q06': case 'Q07': { var L3 = J(v67GetLabDashboard(tok));
      if (id === 'Q03') return { columns: [_v68C_('object', 'Объект'), _v68C_('indicator', 'Показатель'), _v68C_('method', 'Метод'), _v68C_('frequencyDays', 'Раз в, дней', 'num'), _v68C_('last', 'Последний отбор'), _v68C_('next', 'Следующий'), _v68C_('laboratory', 'Лаборатория'), _v68C_('basis', 'Основание')],
        rows: L3.schedule.map(function (x) { x.next = x.next + (x.overdue ? ' (просрочено)' : ''); return x; }), totals: { 'Просрочено планов': L3.overduePlans } };
      if (id === 'Q04') return { columns: [_v68C_('sampleId', 'Проба'), _v68C_('batchId', 'Партия'), _v68C_('object', 'Объект'), _v68C_('sampledAt', 'Отбор'), _v68C_('laboratory', 'Лаборатория'), _v68C_('due', 'Ожидается до'), _v68C_('status', 'Статус')],
        rows: L3.expected.map(function (x) { x.status = (x.status === 'TAKEN' ? 'отобрана' : 'передана') + (x.overdue ? ', срок результата прошёл' : ''); return x; }) };
      if (id === 'Q05') return { columns: [_v68C_('protocol', 'Протокол'), _v68C_('batchId', 'Партия'), _v68C_('indicator', 'Показатель'), _v68C_('fact', 'Факт'), _v68C_('norm', 'Норматив'), _v68C_('deviationId', 'Отклонение'), _v68C_('decision', 'Решение')], rows: L3.nonconforming };
      if (id === 'Q07') return { columns: [_v68C_('researchId', 'Исследование'), _v68C_('batchId', 'Партия'), _v68C_('indicator', 'Показатель'), _v68C_('retestOf', 'Повтор к')], rows: L3.retests };
      var bl = []; try { var bs = _mcBlocksSheet_().getDataRange().getValues(); for (var i = 1; i < bs.length; i++) if (String(bs[i][1]) === 'BATCH' && String(bs[i][9]) === 'ACTIVE') bl.push({ batchId: bs[i][2], reason: bs[i][3], at: _v65Fmt_(bs[i][7]), by: bs[i][8], deviation: bs[i][5] }); } catch (e) {}
      return { columns: [_v68C_('batchId', 'Партия'), _v68C_('reason', 'Причина'), _v68C_('at', 'С'), _v68C_('by', 'Кто'), _v68C_('deviation', 'Отклонение')], rows: bl }; }
    case 'Q08': { var T8 = J(v66GetTuList(tok));
      return { columns: [_v68C_('number', 'Номер'), _v68C_('product', 'Продукция'), _v68C_('statusRu', 'Статус'), _v68C_('activeVersion', 'Действующая версия'), _v68C_('activeFrom', 'С'), _v68C_('currentStatus', 'Текущая версия — этап'), _v68C_('ttk', 'ТТК')], rows: T8.items }; }
    case 'Q09': { var docs = _v65Rows_('Нормативы_V33').map(function (d) { return { source: 'Нормативный реестр', number: d.Number, title: d.Title, status: d.Status, from: _v65Fmt_(d.EffectiveFrom), to: _v65Fmt_(d.EffectiveTo) }; });
      _v66Objs_('REF').forEach(function (x) { var dd = _v66Doc_(x.TUID); docs.push({ source: 'ТУ ' + (dd ? dd.Number : x.TUID), number: x.Number, title: x.Title + (x.Clause ? ', ' + x.Clause : ''), status: '', from: '', to: '' }); });
      return { columns: [_v68C_('source', 'Источник'), _v68C_('number', 'Документ'), _v68C_('title', 'Наименование'), _v68C_('status', 'Статус'), _v68C_('from', 'Действует с'), _v68C_('to', 'по')], rows: docs }; }
    case 'Q10': { var rd = _mcReadinessCompute_(), act = _v65Objs_('PPK').filter(function (x) { return x.Status === 'ACTIVE'; })[0], oc = _mcOrgCompleteness_();
      var rows10 = rd.items.map(function (x) { return { area: x.area, requirement: x.requirement, status: x.status, detail: x.detail, action: x.correctiveAction }; });
      rows10.push({ area: 'Организация', requirement: 'Реквизиты организации заполнены (подставляются в документы)', status: oc.complete ? 'PASS' : 'MISSING_EVIDENCE', detail: oc.missing.join(', '), action: oc.complete ? '' : 'Настройки → Организация' });
      if (act) { var c = _v65Check_(act.PPKID); c.checks.forEach(function (x) { rows10.push({ area: 'ППК ' + act.Version, requirement: x.title, status: x.status, detail: x.issues.slice(0, 5).join('; '), action: x.status === 'PASS' ? '' : 'ППК → сформировать и устранить пробелы' }); }); }
      else rows10.push({ area: 'ППК', requirement: 'Действующая программа производственного контроля', status: 'MISSING_EVIDENCE', detail: 'нет действующей версии', action: 'ППК → создать, утвердить, ввести в действие' });
      var bad = rows10.filter(function (x) { return x.status !== 'PASS' && x.status !== 'NOT_APPLICABLE'; }).length;
      return { subtitle: 'Итог: ' + (rd.overall === 'READY' && !bad ? 'READY' : rd.overall === 'READY' ? 'READY_WITH_WARNINGS' : rd.overall), columns: [_v68C_('area', 'Раздел'), _v68C_('requirement', 'Требование'), _v68C_('status', 'Статус'), _v68C_('detail', 'Доказательство / пробел'), _v68C_('action', 'Что сделать')],
        rows: rows10, notes: [rd.note], totals: { 'Требует действий': bad } }; }
  }
  throw new Error('NOT_FOUND: отчёт не найден');
}
function v68ListReports(token) {
  try { var s = _requireAuth_(token);
    return _ok_({ items: MC_V68_REPORTS.filter(function (d) { return s.dev || _v68Allowed_(s, d); }).map(function (d) { return { id: d[0], title: d[1], group: d[0].charAt(0) === 'F' ? 'Финансы' : 'ППК, ТУ, лаборатория', params: d[3].map(function (p) { return { key: p, label: MC_V68_PARAM_RU[p] }; }) }; }) });
  } catch (e) { return _failFrom_(e); }
}
function _v68Run_(json, token) {
  var s = _requireAuth_(token), d = _v64Json_(json), def = _v68Def_(String(d.id || ''));
  if (!def) throw new Error('NOT_FOUND: отчёт не найден');
  if (!s.dev && !_v68Allowed_(s, def)) { _mcRbAuditDenied_(s, 'report:' + def[0], def[2], ''); throw new Error('FORBIDDEN: отчёт «' + def[1] + '» недоступен для роли (нужно право: ' + def[2] + ')'); }
  var p = d.params || {}; p.__tok = token;
  var r = _v68Build_(def[0], p); r.id = def[0]; r.title = def[1]; r.generatedAt = Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH:mm');
  return r;
}
function v68RunReport(json, token) { try { var r = _v68Run_(json, token); return _ok_(JSON.parse(JSON.stringify(r))); } catch (e) { return _failFrom_(e); } }
/** PDF отчёта: шапка с логотипом и реквизитами из настроек; файл и SHA-256 — в журнале аудита. */
function v68ReportPdf(json, token) {
  var op = null; try { op = _beginOp_(token, null, 'V68_PDF', 'Отчёт', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var r = _v68Run_(json, token), E = _mcOrgEsc_;
    var h = (r.subtitle ? '<div class="muted">' + E(r.subtitle) + '</div>' : '') + '<table class="r"><tr>' + r.columns.map(function (c) { return '<th' + (c.t === 'num' ? ' class="n"' : '') + '>' + E(c.l) + '</th>'; }).join('') + '</tr>' +
      (r.rows || []).map(function (row) { return '<tr>' + r.columns.map(function (c) { var v = row[c.k]; if (v && typeof v === 'object') v = JSON.stringify(v); return '<td' + (c.t === 'num' ? ' class="n"' : '') + '>' + E(v === undefined || v === null ? '' : v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>' +
      (r.totals ? '<h3>Итоги</h3><table class="r">' + Object.keys(r.totals).map(function (k) { return '<tr><th>' + E(k) + '</th><td class="n">' + E(r.totals[k] === null ? '—' : r.totals[k]) + '</td></tr>'; }).join('') + '</table>' : '') +
      (r.card ? '<h3>Карточка блюда на порцию</h3><table class="r">' + [['Цена продажи', r.card.salePrice], ['Ингредиенты и п/ф', r.card.ingredients], ['Технологические потери', r.card.technologicalLosses], ['Упаковка', r.card.packaging], ['Прямой труд', r.card.directLabor],
        ['Переменные производственные расходы', r.card.variableCosts], ['Валовой вклад', r.card.grossContribution], ['Маржинальность, %', r.card.marginPct]].map(function (x) { return '<tr><th>' + E(x[0]) + '</th><td class="n">' + E(x[1] === null ? '—' : x[1]) + '</td></tr>'; }).join('') + '</table>' : '') +
      ((r.notes || []).filter(String).length ? '<p class="muted">' + r.notes.filter(String).map(E).join('<br>') + '</p>' : '');
    var f = _mcPdfSave_(r.title, h, { subtitle: 'Сформирован ' + r.generatedAt, fileName: r.title + ' ' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd HH-mm'), landscape: r.columns.length > 7 });
    _audit_(op, 'V68_PDF', 'Отчёт', r.id, null, { title: r.title, fileId: f.fileId, sha256: f.sha256, rows: (r.rows || []).length }); _endOp_(op);
    return _ok_(f, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
