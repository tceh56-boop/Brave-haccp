/**
 * MonChef V92 — «Моя смена» по ролям (приложение к промту владельца «email-триггеры по сменам…»: модуль «Моя смена»
 * и распределение отчётов по ролям, разделы 1–14).
 *
 *  Роли: добавлены «Кладовщик», «Закупщик», «Бухгалтер / экономист», «Кассир», «Руководитель смены»,
 *  «Администратор площадки» (прежние «Кладовщик» и «Закупщик» снова действуют — с правами по этому приложению).
 *  Права: revenue_view (выручка и план без себестоимости и закупочных цен), procurement_cost_view (цены и суммы закупок),
 *  cash_view (кассовая смена), task_assign (назначение и передача задач).
 *
 *  «Моя смена»: блоки по должности (финансы — только с правом; выручка без себестоимости — revenue_view; заявки по
 *  поставщикам — суммы только с правом цен; остатки и риск дефицита; сроки 24/48/72 ч и 7 дн.; предложения — только
 *  с подтверждением; касса; мои данные), у каждой задачи — приоритет цветом и текстом (КРИТИЧНО, ВАЖНО, ОБЫЧНО,
 *  ВЫПОЛНЕНО, НЕТ ДАННЫХ), ответственная роль, статус, комментарий, доказательство, передача другой роли, история.
 *  Назначение по владельцу данных (раздел 13): просрочка и остатки — кладовщику и руководителю смены; производство —
 *  шеф-повару; заявки — закупщику; финансовые расхождения и закрытие периода — бухгалтеру и руководителю;
 *  обучение — самому сотруднику и руководителю. Роли нет — ROLE_OWNER_NOT_CONFIGURED у руководителя; директор может
 *  закрепить задачи роли за другой ролью. Пока роль не назначена, задачи видят сотрудники с правами, как раньше.
 *  Ничего не перемещается, не списывается, не заказывается и не начисляется автоматически; премии в MON CHEF не
 *  рассчитываются. Все действия — в аудите.
 */
var MC_V92_NEW_ROLES_ = ['Кладовщик', 'Закупщик', 'Бухгалтер / экономист', 'Кассир', 'Руководитель смены', 'Администратор площадки'];
var MC_V92_PERMS_ = [['revenue_view', 'Выручка и выполнение плана — без себестоимости и закупочных цен', 'Экономика'],
  ['procurement_cost_view', 'Закупки — цены и суммы заявок и закупок', 'Закупки'], ['cash_view', 'Касса — своя кассовая смена', 'Касса'],
  ['task_assign', 'Моя смена — назначение и передача задач другим ролям', 'Персонал']];
var MC_V92_MATRIX_ = {
  'Кладовщик': ['stock_view', 'stock', 'receiving', 'labels', 'documents_view', 'journals', 'checklists', 'stock_expiry_view', 'procurement_view', 'notification_view'],
  'Закупщик': ['procurement_view', 'procurement_create', 'stock_view', 'stock_expiry_view', 'documents_view', 'notification_view'],
  'Бухгалтер / экономист': ['finance_view', 'finance_edit', 'payroll_view', 'report_export', 'reports', 'invoices_view', 'costs', 'documents_view', 'stock_view', 'procurement_view', 'notification_view', 'audit_view'],
  'Кассир': ['cash_view', 'checklists'],
  'Руководитель смены': ['stock_view', 'stock_expiry_view', 'journals', 'checklists', 'haccp_view', 'plan', 'kanban', 'task_assign', 'notification_view', 'procurement_view'],
  'Администратор площадки': ['revenue_view', 'stock_view', 'stock_expiry_view', 'procurement_view', 'checklists', 'haccp_view', 'notification_view', 'task_assign', 'banquets_view']
};
var MC_V92_TASKS_ = 'Смена_Задачи_V92', MC_V92_TASKS_HEAD_ = ['TaskKey', 'Day', 'Title', 'Detail', 'Source', 'Prio', 'OwnerRole', 'FromRole', 'Status', 'Comment', 'EvidenceFileID', 'EvidenceHash', 'ActModule', 'HistoryJSON', 'UpdatedAt', 'UpdatedBy', 'OperationID'];
var MC_V92_COVER_ = 'Смена_Роли_V92', MC_V92_COVER_HEAD_ = ['OwnerRole', 'CoveredBy', 'Reason', 'UpdatedBy', 'UpdatedAt'];
var MC_V92_PRIO_RU_ = { CRITICAL: 'КРИТИЧНО', IMPORTANT: 'ВАЖНО', NORMAL: 'ОБЫЧНО', DONE: 'ВЫПОЛНЕНО', NODATA: 'НЕТ ДАННЫХ' };
// владелец данных (раздел 13): ключ карточки → роли по порядку
var MC_V92_RULES_ = [
  { re: /^(X\|exp|EXP\||RSR\|)/, kind: 'stock', roles: ['Кладовщик', 'Руководитель смены'], ru: 'просрочка, сроки и остатки' },
  { re: /^V89\|sg/, kind: 'stock', roles: ['Кладовщик', 'Руководитель смены', 'Шеф-повар'], ru: 'предложения по складу' },
  { re: /^PREP\|/, kind: 'production', roles: ['Шеф-повар', 'Су-шеф', 'Повар горячего цеха', 'Повар холодного цеха', 'Кондитер', 'Повар'], ru: 'производство' },
  { re: /^V92\|proc/, kind: 'procurement', roles: ['Закупщик'], ru: 'заявки по поставщикам' },
  { re: /^V92\|fin/, kind: 'finance', roles: ['Бухгалтер / экономист', 'Директор'], ru: 'финансовые расхождения' },
  { re: /^V92\|period/, kind: 'period', roles: ['Бухгалтер / экономист'], ru: 'закрытие периода' },
  { re: /^V89\|(cfg|err)/, kind: 'settings', roles: ['Директор'], ru: 'настройки' },
  { re: /^T\|PRODUCTION\|/, kind: 'kitchen', roles: ['Шеф-повар', 'Су-шеф', 'Кондитер', 'Повар холодного цеха', 'Повар горячего цеха', 'Повар', 'Ответственный за ХАССП', 'Руководитель смены', 'Директор', 'Администратор'], ru: 'задания кухни' }
];

/* ---------------- роли и права ---------------- */
(function () {
  try { MC_V92_PERMS_.forEach(function (p) { if (!MC_RB_PERMS_.some(function (x) { return x[0] === p[0]; })) MC_RB_PERMS_.push(p); }); } catch (e) {}
  try { MC_V92_NEW_ROLES_.forEach(function (r) { if (MC_RB_ROLES_.indexOf(r) < 0) MC_RB_ROLES_.push(r); if (typeof MC_ROLES !== 'undefined' && MC_ROLES.indexOf(r) < 0) MC_ROLES.push(r); }); } catch (e) {}
  try { ['Кладовщик', 'Закупщик'].forEach(function (r) { var i = MC_RB_RETIRED_.indexOf(r); if (i >= 0) MC_RB_RETIRED_.splice(i, 1); }); } catch (e) {}
  try { Object.keys(MC_V92_MATRIX_).forEach(function (r) { MC_RB_MATRIX_[r] = MC_V92_MATRIX_[r].slice(); }); } catch (e) {}
  var give = function (role, list) { try { var a = MC_RB_MATRIX_[role]; if (a) list.forEach(function (k) { if (a.indexOf(k) < 0) a.push(k); }); } catch (e) {} };
  give('Директор', MC_V92_PERMS_.map(function (p) { return p[0]; }));
  ['Шеф-повар', 'Су-шеф', 'Ответственный за ХАССП'].forEach(function (r) { give(r, ['task_assign']); });
  var grant = function (perm, roles) { try { var a = MC_RB_GRANTABLE_[perm] || (MC_RB_GRANTABLE_[perm] = []); roles.forEach(function (r) { if (a.indexOf(r) < 0) a.push(r); }); } catch (e) {} };
  grant('procurement', ['Закупщик']); grant('procurement_cost_view', ['Закупщик', 'Администратор площадки', 'Руководитель смены']); grant('costs', ['Кладовщик']);
  grant('finance_close', ['Бухгалтер / экономист']); grant('revenue_view', ['Руководитель смены', 'Кассир']);
  try { ['Кладовщик', 'Руководитель смены'].forEach(function (r) { if (MC_FOOD_ROLES_.indexOf(r) < 0) MC_FOOD_ROLES_.push(r); }); } catch (e) {}
})();

/* ---------------- листы ---------------- */
function _v92Sh_(name, head) { var ss = _book_(), sh = ss.getSheetByName(name); if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]); sh.setFrozenRows(1); } return sh; }
function _v92Rows_(name) { var sh = _book_().getSheetByName(name); if (!sh || sh.getLastRow() < 2) return []; var v = sh.getDataRange().getValues(), h = v[0]; return v.slice(1).map(function (r, i) { var o = { _row: i + 2 }; h.forEach(function (c, j) { o[c] = r[j]; }); return o; }).filter(function (o) { return o[h[0]] !== ''; }); }
function _v92Day_() { return Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd'); }
function _v92Recs_() { var d = _v92Day_(); return _v92Rows_(MC_V92_TASKS_).filter(function (r) { return String(r.Day) === d || (r.Day instanceof Date && Utilities.formatDate(r.Day, _mcTz_(), 'yyyy-MM-dd') === d); }); }
function _v92Hist_(r) { try { return JSON.parse(r.HistoryJSON || '[]'); } catch (e) { return []; } }
function _v92Money_(x) { var n = Math.round((Number(x) || 0) * 100) / 100, s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); return (n < 0 ? '−' : '') + s + ' ₽'; }
function _v92NoMoney_(t) { return String(t || '').replace(/ на [\d\s .,−-]+ ?₽/g, '').replace(/[\d\s .,−-]*\d ?₽/g, 'сумма скрыта'); }

/** Кто есть в штате: роль → число действующих сотрудников (без служебной строки создателя). */
function _v92Staffed_() { var m = {}; try { var st = _mcRbEmpState_(); Object.keys(st).forEach(function (k) { var e = st[k]; if (e && e.active !== false && !e.hidden && e.role) m[e.role] = (m[e.role] || 0) + 1; }); } catch (e) {} return m; }
function _v92Covers_() { var m = {}; _v92Rows_(MC_V92_COVER_).forEach(function (r) { if (r.CoveredBy) m[String(r.OwnerRole)] = String(r.CoveredBy); }); return m; }
/** Роль без сотрудника закрыта: закреплена за ролью с сотрудником (V92) или — для прежних «Кладовщик» и «Закупщик» — её задачи по-прежнему получают роли из MC_RB_TARGETS_ (ППК, уведомления). */
function _v92RoleCovered_(role) {
  var st = _v92Staffed_(), cv = _v92Covers_()[role];
  if (cv && st[cv]) return true;
  if (['Кладовщик', 'Закупщик'].indexOf(role) >= 0) { try { return (MC_RB_TARGETS_[role] || []).some(function (r) { return st[r]; }); } catch (e) {} }
  return false;
}
function _v92RuleOf_(key) { key = String(key || ''); for (var i = 0; i < MC_V92_RULES_.length; i++) if (MC_V92_RULES_[i].re.test(key)) return MC_V92_RULES_[i]; return null; }
/** Владельцы по правилу: роли с сотрудниками или закреплённые за другой ролью; никого — configured: false. */
function _v92Resolve_(rule, staffed, covers) {
  var eff = [];
  rule.roles.forEach(function (r) { if (staffed[r]) eff.push(r); else if (covers[r] && staffed[covers[r]]) eff.push(covers[r]); });
  eff = eff.filter(function (x, i, a) { return a.indexOf(x) === i; });
  return { configured: eff.length > 0, eff: eff };
}
function _v92Prio_(c) {
  var t = String(c.title || '') + ' ' + String(c.detail || '');
  if (c.group === 'done') return 'DONE';
  if (c.group === 'overdue' || c.group === 'error' || c.critical || /^X\|exp/.test(c.key) || /истёк|просроч|карантин|КРИТИЧНО/.test(t)) return 'CRITICAL';
  if (/^EXP\|/.test(c.key)) return /\(сегодня\)|через 1 дн\./.test(t) ? 'IMPORTANT' : 'NORMAL';
  if (c.group === 'now' || c.group === 'prep' || c.group === 'expiry') return 'IMPORTANT';
  return 'NORMAL';
}

/* ---------------- данные блоков ---------------- */
function _v92Cfg_() {
  var c = null; try { var L = _v89Cfgs_() || []; c = L.filter(function (x) { return x.active; })[0] || L[0] || null; } catch (e) {}
  return c || { TriggerConfigID: 'V92', LocationID: 'MAIN', OrganizationID: 'ORG', name: 'площадка', tz: _mcTz_(), active: false };
}
function _v92Blocks_(s, role, staffed, covers, ctx) {
  var B = [], has = function (k) { return _mcRbHasExact_(s, k); }, now = Date.now(), c = _v92Cfg_(), today = _v92Day_(), ST = null, P = null, E = null;
  var st = function () { return ST || (ST = _v89Stock_(now)); }, pr = function () { return P || (P = _v89Proc_(c, now, st())); }, ex = function () { return E || (E = _v89Exp_(c, now, st())); };
  var cost = has('costs|finance_view|procurement_cost_view');
  var add = function (o) { o.prioRu = MC_V92_PRIO_RU_[o.prio] || ''; B.push(o); };
  // финансы (полный отчёт) / выручка без себестоимости
  if (has('finance_view') || has('revenue_view')) {
    var F = null; try { F = _v89Fin_(c, ['CLOSING'], { date: today }, now); } catch (e) { F = { status: 'ERROR', reasons: [String(e.message || e)] }; }
    var a = F.a || {}, nd = 'НЕТ ДАННЫХ', rows = [];
    var dev = F.plan && F.plan.revenue ? _v92Money_(a.net - F.plan.revenue) + ' (' + Math.round((a.net / F.plan.revenue - 1) * 1000) / 10 + ' %)' : nd;
    rows.push(['Чистая выручка (журнал продаж)', a.lines ? _v92Money_(a.net) : nd], ['План выручки', F.plan && F.plan.revenue !== null && F.plan.revenue !== undefined ? _v92Money_(F.plan.revenue) : nd], ['Отклонение от плана', a.lines ? dev : nd]);
    if (has('finance_view')) {
      rows.push(['Себестоимость списанного', F.cogsKnown ? _v92Money_(a.cogs) : nd], ['Валовая прибыль', F.cogsKnown ? _v92Money_(a.net - a.cogs) : nd],
        ['Маржинальность', F.cogsKnown && a.net ? Math.round((a.net - a.cogs) / a.net * 1000) / 10 + ' %' : nd], ['Расходы', F.ex && F.ex.n ? _v92Money_(F.ex.total) : nd]);
      if (has('payroll_view')) rows.push(['ФОТ', F.ex && F.ex.payrollN ? _v92Money_(F.ex.payroll) : nd]);
    }
    add({ id: has('finance_view') ? 'fin' : 'rev', title: has('finance_view') ? 'Финансы за сегодня' : 'Выручка и план за сегодня (без себестоимости и закупочных цен)', prio: F.status === 'OK' ? 'NORMAL' : 'IMPORTANT', rows: rows,
      notes: (F.reasons || []).filter(function (x) { return has('finance_view') || !/себестоим/.test(x); }) });
  }
  // заявки по поставщикам
  if (has('procurement_view|procurement_create|procurement')) {
    var Pp = pr(), rows2 = [];
    Pp.suppliers.forEach(function (g) { g.rows.forEach(function (r) { rows2.push([g.name, r.product, r.qtyText, String(r.recDate || '').split('-').reverse().join('.'), r.availText + ' / мин. ' + r.minText + ' / цель ' + r.targetText + (r.incomingText ? ' · в пути ' + r.incomingText : ''), MC_V92_PRIO_RU_[{ 'КРИТИЧНО': 'CRITICAL', 'ВАЖНО': 'IMPORTANT' }[r.prio] || 'NORMAL']].concat(cost ? [r.sum !== null ? _v92Money_(r.sum) : 'нет цены'] : [])); }); });
    add({ id: 'proc', title: 'Заявки по поставщикам' + (cost ? '' : ' (суммы скрыты — нет права «Закупки — цены»)'), prio: Pp.suppliers.some(function (g) { return g.rows.some(function (r) { return r.prio === 'КРИТИЧНО'; }); }) ? 'CRITICAL' : rows2.length ? 'IMPORTANT' : 'NORMAL',
      cols: ['Поставщик', 'Товар', 'Заказать', 'Поставка до', 'Запас', 'Приоритет'].concat(cost ? ['Сумма'] : []), rows: rows2, empty: 'Заказывать сейчас нечего (по параметрам закупки)',
      notes: Pp.reasons.concat(Pp.warnings.map(function (w) { return w.text; })).concat(Pp.open && Pp.open.length ? ['Открытые заказы: ' + Pp.open.map(function (o) { return o.id + ' (' + o.supplier + ', ' + o.status + ')'; }).join('; ')] : []) });
  }
  // остатки: что может закончиться до закрытия смены, карантин и блокировка
  if (has('stock|stock_expiry_view|procurement_view|procurement')) {
    var Pq = pr(), run = [], S2 = st(), q = 0, bl = 0;
    Pq.suppliers.forEach(function (g) { g.rows.forEach(function (r) { if (r.daysLeft !== null && r.daysLeft < 1) run.push([r.product, r.availText, r.avgText]); }); });
    Pq.unmapped.forEach(function (r) { if (r.daysLeft !== null && r.daysLeft < 1) run.push([r.product, r.availText, r.avgText]); });
    S2.batches.forEach(function (b) { if (b.status === 'quarantine') q++; if (b.status === 'blocked') bl++; });
    add({ id: 'stock', title: 'Остатки: может закончиться до закрытия смены', prio: run.length ? 'IMPORTANT' : 'NORMAL', cols: ['Товар', 'Доступно', 'Расход'], rows: run, empty: 'По среднему расходу запаса хватает до конца смены',
      notes: [(q ? 'на входном контроле (карантин): ' + q + ' парт.' : ''), (bl ? 'заблокировано: ' + bl + ' парт.' : '')].filter(String) });
  }
  // сроки годности
  if (has('stock_expiry_view|stock|haccp|prod_manage')) {
    var Ee = ex(), cnt = Ee.counts || {};
    add({ id: 'exp', title: 'Сроки годности: просрочено ' + (cnt.EXPIRED || 0) + ' · ≤ 24 ч ' + (cnt.EXPIRING_24H || 0) + ' · ≤ 48 ч ' + (cnt.EXPIRING_48H || 0) + ' · ≤ 72 ч ' + (cnt.EXPIRING_72H || 0) + ' · ≤ 7 дн. ' + (cnt.EXPIRING_7D || 0),
      prio: cnt.EXPIRED ? 'CRITICAL' : (cnt.EXPIRING_24H || cnt.EXPIRING_48H) ? 'IMPORTANT' : 'NORMAL', cols: ['Партия', 'Товар', 'Остаток', 'Годен до', 'Осталось', 'Статус', 'Что делать'],
      rows: Ee.rows.slice(0, 25).map(function (r) { return [r.batchId, r.product, r.qtyText, r.expiry, r.daysText, r.statusRu, r.action]; }), empty: 'Партий со сроком до 7 дней нет', notes: Ee.reasons });
  }
  // предложения: только подтверждением, по праву решения
  if (has('stock|prod_manage|haccp|stock_writeoff_create|stock_transfer_create')) {
    var sg = []; try { sg = _v89SgRows_().filter(function (r) { var need = (typeof MC_V89_SG_BY_ !== 'undefined' && MC_V89_SG_BY_[String(r['Действие'])]) || 'stock'; return String(r['Статус']) === 'SUGGESTED' && _mcRbHasExact_(s, need); }); } catch (e) {}
    add({ id: 'sugg', title: 'Предложения по складу — только после вашего подтверждения', prio: sg.length ? 'IMPORTANT' : 'NORMAL', cols: ['Товар', 'Партия', 'Предложение', 'Риск'],
      rows: sg.slice(0, 20).map(function (r) { return [r['Продукт'], r.BatchID, (typeof MC_V89_ACTIONS_ !== 'undefined' && MC_V89_ACTIONS_[String(r['Действие'])]) || r['Действие'], r['Риск']]; }), empty: 'Предложений нет',
      notes: ['Перемещение, списание и возврат система сама не делает: решение — на экране «Сменные письма» с причиной, исполнение — отдельным документом.'] });
  }
  // касса
  if (has('cash_view')) {
    var cr = [['Касса, оплаты, эквайринг, возвраты', 'НЕТ ДАННЫХ — в MON CHEF не ведутся; продажи в MON CHEF не заменяют фискальные документы ККТ']];
    if (has('revenue_view')) { try { var Fc = _v89Fin_(c, ['CLOSING'], { date: today }, now); cr.push(['Выручка смены по журналу продаж', Fc.a && Fc.a.lines ? _v92Money_(Fc.a.net) : 'НЕТ ДАННЫХ']); } catch (e) {} }
    add({ id: 'cash', title: 'Кассовая смена', prio: 'NODATA', rows: cr, notes: ['Чек-лист открытия и закрытия кассы — в «Чек-листах», если он заведён.'] });
  }
  // мои данные — только свои
  var me = (ctx && ctx.me) || '', adm = null; try { if (MC_FOOD_ROLES_.indexOf(role) >= 0 && typeof _mcAdmissionByName_ === 'function') { _MC_ADM_CACHE = null; adm = _mcAdmissionByName_(me); } } catch (e) {}
  var tr = []; try { tr = _trainingOverdue_(30).filter(function (x) { return _mdNorm_(x.сотрудник) === _mdNorm_(me); }); } catch (e) {}
  add({ id: 'me', title: 'Мои данные', prio: tr.some(function (x) { return x.статус === 'просрочено'; }) ? 'CRITICAL' : tr.length ? 'IMPORTANT' : 'NORMAL',
    rows: [['Сотрудник', me], ['Роль', role]].concat(adm ? [['Медицинский допуск', adm.status === 'ADMITTED' ? 'допущен' : String(adm.statusRu || adm.status)]] : [])
      .concat(tr.length ? tr.map(function (x) { return ['Обучение: ' + x.вид, x.статус + ' (до ' + x.действуетДо + ')']; }) : [['Обучение', 'просроченного нет']])
      .concat([['Рейтинг', 'НЕТ ДАННЫХ — рейтинг сотрудников в MON CHEF не рассчитывается']]) });
  // руководитель: роли без сотрудников и критическое по всем ролям
  if (role === 'Директор' || has('grants')) {
    var miss = _v92Missing_(staffed, covers);
    add({ id: 'roles', title: 'Ответственные роли', prio: miss.length ? 'IMPORTANT' : 'NORMAL', cols: ['Роль', 'Сотрудников', 'Задачи закреплены за'],
      rows: MC_RB_ROLES_.map(function (r) { return [r, String(staffed[r] || 0), covers[r] || '—']; }), notes: miss.map(function (m) { return 'ROLE_OWNER_NOT_CONFIGURED: ' + m.roles.join(' / ') + ' — ' + m.ru; }), covers: true });
  }
  if (role === 'Директор') {
    var crit = [], E2 = ex(), cn = E2.counts || {};
    if (cn.EXPIRED) crit.push(['Просроченные партии', String(cn.EXPIRED), 'кладовщик, руководитель смены']);
    var S3 = st(), qq = S3.batches.filter(function (b) { return b.status === 'quarantine' || b.status === 'blocked'; }).length; if (qq) crit.push(['Карантин и блокировка', String(qq), 'ответственный за ХАССП']);
    var P3 = pr(), zero = []; P3.suppliers.forEach(function (g) { g.rows.forEach(function (r) { if (r.prio === 'КРИТИЧНО') zero.push(r.product); }); }); if (zero.length) crit.push(['Риск остановки: нет запаса', zero.slice(0, 6).join(', '), 'закупщик']);
    try { var ve = _v89Errs_().filter(function (e) { return !e.ResolvedAt && /КРИТИЧНО/.test(String(e.Severity)); }).length; if (ve) crit.push(['Ошибки сменных писем', String(ve), 'директор']); } catch (e) {}
    _v92Missing_(staffed, covers).forEach(function (m) { crit.push(['ROLE_OWNER_NOT_CONFIGURED', m.roles.join(' / '), 'директор']); });
    add({ id: 'crit', title: 'Критическое по всем ролям', prio: crit.length ? 'CRITICAL' : 'DONE', cols: ['Что', 'Сколько / что именно', 'Кто отвечает'], rows: crit, empty: 'Критического нет' });
  }
  return B;
}
/** Правила, у которых нет ни одной роли с сотрудником и нет закрепления. */
function _v92Missing_(staffed, covers) {
  var seen = {}, out = [];
  MC_V92_RULES_.forEach(function (r) { var k = r.roles.join('|'); if (seen[k]) return; seen[k] = 1; if (!_v92Resolve_(r, staffed, covers).configured) out.push({ roles: r.roles, ru: r.ru, kind: r.kind }); });
  return out;
}

/* ---------------- задачи по ролям ---------------- */
try {
  MC_V87_SOURCES_.push(function (ctx) {
    var s = ctx.s, out = []; if (!s || s.dev) return out;
    var role = _mcRbNormRole_(s.role), staffed = _v92Staffed_(), covers = _v92Covers_(), mine = function (key) { var R = _v92Resolve_(_v92RuleOf_(key), staffed, covers); return R.configured && R.eff.indexOf(role) >= 0; };
    var c = _v92Cfg_(), now = Date.now();
    // заявки по поставщикам — закупщику
    if (mine('V92|proc') && _mcRbHasExact_(s, 'procurement_view|procurement_create|procurement')) {
      var P = _v89Proc_(c, now, _v89Stock_(now)), n = 0, k = 0; P.suppliers.forEach(function (g) { n += g.rows.length; k += g.rows.filter(function (r) { return r.prio === 'КРИТИЧНО'; }).length; });
      if (n || P.unmapped.length) out.push({ key: 'V92|proc', group: k ? 'overdue' : 'now', source: 'Закупки', title: 'Заявки по поставщикам: ' + P.suppliers.length + ' пост., позиций ' + n + (k ? ', критично ' + k : '') + (P.unmapped.length ? ', без поставщика ' + P.unmapped.length : ''),
        detail: 'Подготовить заявку можно на экране «Закупки»; отправка поставщику — только с правом «Закупки». Письмо и «Моя смена» заказ не создают.', who: 'закупщик', act: _v87ModOk_(s, 'procurement') ? { kind: 'open', module: 'procurement', label: 'Закупки' } : null });
    }
    // финансовые расхождения — бухгалтеру и руководителю
    if (mine('V92|fin') && _mcRbHasExact_(s, 'finance_view')) {
      var F = _v89Fin_(c, ['CLOSING'], { date: _v92Day_() }, now), a = F.a || {}, bad = [];
      if (a.revBad) bad.push('продаж без цены: ' + a.revBad); if (a.costBad) bad.push('строк без себестоимости: ' + a.costBad); if (F.v79 && F.v79.length) bad.push('не подтверждено документов о продажах: ' + F.v79.length);
      if (bad.length) out.push({ key: 'V92|fin', group: 'now', source: 'Финансы', title: 'Финансовое расхождение за сегодня', detail: bad.join('; '), who: 'бухгалтер, руководитель', act: _v87ModOk_(s, 'finance') ? { kind: 'open', module: 'finance', label: 'Экономика' } : null });
    }
    // закрытие прошлого месяца — бухгалтеру
    if (mine('V92|period') && _mcRbHasExact_(s, 'finance_view')) {
      var t = new Date(), m0 = new Date(t.getFullYear(), t.getMonth() - 1, 1), m1 = new Date(t.getFullYear(), t.getMonth(), 0), f = Utilities.formatDate(m0, _mcTz_(), 'yyyy-MM-dd'), to = Utilities.formatDate(m1, _mcTz_(), 'yyyy-MM-dd');
      var closed = false; try { closed = _v64Periods_().some(function (p) { return p.status === 'CLOSED' && p.from <= f && p.to >= to; }); } catch (e) {}
      if (!closed) out.push({ key: 'V92|period|' + f.slice(0, 7), group: 'now', source: 'Финансы', title: 'Закрыть период ' + Utilities.formatDate(m0, _mcTz_(), 'MM.yyyy'), detail: _mcRbHasExact_(s, 'finance_close') ? 'проверьте записи без цен и доказательств, затем закройте период' : 'подготовьте закрытие; закрывает сотрудник с правом «Экономика — закрытие периода»', who: 'бухгалтер', act: _v87ModOk_(s, 'finance') ? { kind: 'open', module: 'finance', label: 'Экономика' } : null });
    }
    // обучение: своё — сотруднику; по всем — руководителю
    try {
      var tr = _trainingOverdue_(14), me = ctx.me;
      tr.filter(function (x) { return _mdNorm_(x.сотрудник) === _mdNorm_(me); }).forEach(function (x, i) { out.push({ key: 'V92|train|' + i, group: x.статус === 'просрочено' ? 'overdue' : 'later', source: 'Обучение', title: 'Обучение «' + x.вид + '» ' + (x.статус === 'просрочено' ? 'просрочено' : 'истекает') + ' — до ' + x.действуетДо, detail: 'пройдите обучение и передайте документ руководителю', who: 'вы' }); });
      if (role === 'Директор') { var ov = tr.filter(function (x) { return x.статус === 'просрочено'; }); if (ov.length) out.push({ key: 'V92|trainall', group: 'now', source: 'Обучение', title: 'Просрочено обучение у сотрудников: ' + ov.length, detail: ov.slice(0, 5).map(function (x) { return x.сотрудник + ' — ' + x.вид; }).join('; '), who: 'руководитель', act: _v87ModOk_(s, 'staff') ? { kind: 'open', module: 'staff', label: 'Сотрудники' } : null }); }
    } catch (e) {}
    // роль не назначена — руководителю
    if (role === 'Директор') _v92Missing_(staffed, covers).forEach(function (m) {
      out.push({ key: 'V92|role|' + m.kind, group: 'error', source: 'Ответственные роли', title: 'ROLE_OWNER_NOT_CONFIGURED: нет сотрудника с ролью «' + m.roles.join('» или «') + '»', detail: 'Задачи «' + m.ru + '» пока видят сотрудники с правами, как раньше. Назначьте сотрудника на роль или закрепите задачи за другой ролью (блок «Ответственные роли»).', who: 'руководитель' });
    });
    return out;
  });
} catch (e) {}

/** Разметка карточек: приоритет, ответственная роль, передачи, история; деньги скрыты без права. */
function _v92Decorate_(d, s, ctx) {
  var role = _mcRbNormRole_(s.role), staffed = _v92Staffed_(), covers = _v92Covers_(), recs = _v92Recs_(), byKey = {}, money = _mcRbHasExact_(s, 'costs|finance_view|procurement_cost_view');
  recs.forEach(function (r) { byKey[String(r.TaskKey)] = r; });
  var cards = d.cards || [];
  cards.forEach(function (c) {
    if (!money) { c.title = _v92NoMoney_(c.title); c.detail = _v92NoMoney_(c.detail); }
    c.prio = _v92Prio_(c);
    var rule = _v92RuleOf_(c.key);
    if (!rule || /^V92\|(role|train)/.test(c.key)) { c.ownerRole = /^V92\|role/.test(c.key) ? 'Директор' : role; c.mine = true; }
    else { var R = _v92Resolve_(rule, staffed, covers); if (!R.configured) { c.ownerRole = rule.roles.join(' / ') + ' — роль не назначена'; c.ownerMissing = true; c.mine = true; } else { c.ownerRole = R.eff.join(', '); c.mine = R.eff.indexOf(role) >= 0; } }
    // передать другой роли можно только задачу владельца данных (раздел 13): склад, производство, закупки, финансы, период; журналы, контроль, банкеты и настройки выполняет назначенная роль
    c.transferable = !!rule && ['stock', 'production', 'procurement', 'finance', 'period'].indexOf(rule.kind) >= 0;
    var t = byKey[String(c.key)];
    if (t) { c.history = _v92Hist_(t); c.comment = String(t.Comment || '');
      if (t.Status === 'TRANSFERRED') { if (String(t.OwnerRole) === role) { c.mine = true; c.transferredFrom = String(t.FromRole); } else { c.mine = false; c.transferredTo = String(t.OwnerRole); c.group = 'waiting'; c.ownerRole = String(t.OwnerRole); } }
      if (t.Status === 'DONE') { c.group = 'done'; c.prio = 'DONE'; } }
    if (!c.mine && c.group !== 'done' && c.group !== 'waiting') c.group = 'info';
    c.prioRu = MC_V92_PRIO_RU_[c.prio];
  });
  recs.filter(function (r) { return r.Status === 'TRANSFERRED' && String(r.OwnerRole) === role && !cards.some(function (c) { return String(c.key) === String(r.TaskKey); }); }).forEach(function (r) {
    var mod = String(r.ActModule || ''), p = String(r.Prio || 'IMPORTANT');
    cards.push({ key: String(r.TaskKey), group: p === 'CRITICAL' ? 'overdue' : 'now', source: 'Передано: ' + r.FromRole, title: money ? String(r.Title) : _v92NoMoney_(r.Title), detail: money ? String(r.Detail || '') : _v92NoMoney_(r.Detail), who: role,
      prio: p, prioRu: MC_V92_PRIO_RU_[p], ownerRole: role, mine: true, transferredFrom: String(r.FromRole), comment: String(r.Comment || ''), history: _v92Hist_(r), v92done: true,
      act: mod && _v87ModOk_(s, mod) ? { kind: 'open', module: mod, label: 'Открыть' } : null });
  });
  var rank = { overdue: 0, error: 1, now: 2, prep: 3, expiry: 4, later: 5, waiting: 6, info: 7, done: 8 };
  cards.sort(function (a, b) { var r = (rank[a.group] === undefined ? 9 : rank[a.group]) - (rank[b.group] === undefined ? 9 : rank[b.group]); if (r) return r; return ['CRITICAL', 'IMPORTANT', 'NORMAL', 'NODATA', 'DONE'].indexOf(a.prio) - ['CRITICAL', 'IMPORTANT', 'NORMAL', 'NODATA', 'DONE'].indexOf(b.prio); });
  var sum = {}; Object.keys(rank).forEach(function (g) { sum[g] = cards.filter(function (c) { return c.group === g; }).length; });
  sum.critical = cards.filter(function (c) { return c.prio === 'CRITICAL' && c.mine && c.group !== 'done'; }).length;
  d.cards = cards; d.summary = sum; d.role = role;
  d.blocks = _v92Blocks_(s, role, staffed, covers, ctx);
  d.v92 = { canAssign: _mcRbHasExact_(s, 'task_assign'), canCover: _mcRbHasExact_(s, 'grants'), staffed: staffed, covers: covers,
    targets: MC_RB_ROLES_.filter(function (r) { return r !== role && (staffed[r] || Object.keys(covers).some(function (k) { return k === r && staffed[covers[k]]; })); }), roles: MC_RB_ROLES_.slice() };
  return d;
}
(function (g) {
  var orig = g.v87ShiftData; if (typeof orig !== 'function') return;
  g.v87ShiftData = function (token) {
    var r = orig.apply(this, arguments), o = typeof r === 'string' ? JSON.parse(r) : r;
    try { if (o && (o.success || o.ok) && o.data) { var s = _getSession_(token); if (s && !s.dev) _v92Decorate_(o.data, s, { me: o.data.employee }); } } catch (e) { if (o && o.data) o.data.v92error = String(e.message || e); }
    return typeof r === 'string' ? JSON.stringify(o) : o;
  };
})(this);

/* ---------------- действия ---------------- */
function _v92Find_(op, key, token) {
  var s = op.session, me = ''; try { me = _author_(op).фио; } catch (e) {}
  var x = _v87Cards_({ s: s, token: token, me: me }), d = { cards: x.cards, employee: me };
  _v92Decorate_(d, s, { me: me });
  return d.cards.filter(function (c) { return String(c.key) === String(key); })[0] || null;
}
function _v92Upsert_(key, o, hist) {
  var sh = _v92Sh_(MC_V92_TASKS_, MC_V92_TASKS_HEAD_), r = _v92Recs_().filter(function (x) { return String(x.TaskKey) === String(key); })[0], h = r ? _v92Hist_(r) : [];
  h.push(hist); o.HistoryJSON = JSON.stringify(h.slice(-50)); o.UpdatedAt = new Date();
  if (r) { Object.keys(o).forEach(function (k) { var j = MC_V92_TASKS_HEAD_.indexOf(k); if (j >= 0) sh.getRange(r._row, j + 1).setValue(o[k]); }); }
  else { o.TaskKey = key; o.Day = "'" + _v92Day_(); sh.appendRow(MC_V92_TASKS_HEAD_.map(function (k) { return o[k] === undefined || o[k] === null ? '' : o[k]; })); }
  return h;
}
/** Передать задачу другой роли (право «назначение и передача задач»): с комментарием, в историю и аудит. */
function v92TaskTransfer(json, token) {
  var op = null; try { op = _beginOp_(token, 'task_assign', 'V92_TRANSFER', 'Моя смена', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), to = _mcRbNormRole_(d.toRole), cm = String(d.comment || '').trim(), s = op.session, from = _mcRbNormRole_(s.role);
    if (MC_RB_ROLES_.indexOf(to) < 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите роль из списка', op.id); }
    if (to === from) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Задача уже у вашей роли', op.id); }
    if (cm.length < 5) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Напишите, что нужно сделать (комментарий к передаче)', op.id); }
    var staffed = _v92Staffed_(), covers = _v92Covers_();
    if (!staffed[to] && !(covers[to] && staffed[covers[to]])) { _endOp_(op, 'FAILED'); return _fail_('ROLE_OWNER_NOT_CONFIGURED', 'Нет сотрудника с ролью «' + to + '» — назначьте сотрудника или закрепите роль за другой', op.id); }
    var c = _v92Find_(op, d.key, token);
    if (!c) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Задача не найдена в вашей смене', op.id); }
    if (!c.mine) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Задача не у вашей роли' + (c.transferredTo ? ' (передана: ' + c.transferredTo + ')' : ''), op.id); }
    if (!c.transferable) { _endOp_(op, 'FAILED'); return _fail_('NOT_TRANSFERABLE', 'Эту задачу выполняет тот, кто ведёт журнал или контроль: ответ вносит роль, которой он назначен', op.id); }
    var who = ''; try { who = _author_(op).фио; } catch (e) {}
    return _withLock_(function () {
      var h = _v92Upsert_(String(c.key), { Title: c.title, Detail: c.detail || '', Source: c.source || '', Prio: c.prio || 'IMPORTANT', OwnerRole: to, FromRole: from, Status: 'TRANSFERRED', Comment: cm,
        ActModule: c.act && c.act.kind === 'open' ? c.act.module : '', UpdatedBy: who, OperationID: op.id }, { at: new Date().toISOString(), by: who, role: from, action: 'передано роли «' + to + '»', comment: cm });
      _audit_(op, 'V92_TRANSFER', 'Смена_Задачи_V92', String(c.key), { owner: c.ownerRole }, { owner: to, comment: cm });
      _endOp_(op); return _ok_({ key: c.key, to: to, history: h }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Комментарий и доказательство (фото, PDF) к задаче смены. */
function v92TaskNote(json, token) {
  var op = null; try { op = _beginOp_(token, '', 'V92_NOTE', 'Моя смена', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), cm = String(d.comment || '').trim();
    if (cm.length < 3 && !d.evidence) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Напишите комментарий или приложите файл', op.id); }
    var c = _v92Find_(op, d.key, token); if (!c) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Задача не найдена в вашей смене', op.id); }
    var f = d.evidence ? _v67File_(d.evidence, 'Задача ' + c.key) : null, who = ''; try { who = _author_(op).фио; } catch (e) {}
    return _withLock_(function () {
      var r = _v92Recs_().filter(function (x) { return String(x.TaskKey) === String(c.key); })[0], o = { Comment: cm || (r ? r.Comment : ''), UpdatedBy: who, OperationID: op.id };
      if (!r) { o.Title = c.title; o.Detail = c.detail || ''; o.Source = c.source || ''; o.Prio = c.prio; o.OwnerRole = _mcRbNormRole_(op.session.role); o.FromRole = ''; o.Status = 'OPEN'; o.ActModule = c.act && c.act.kind === 'open' ? c.act.module : ''; }
      if (f) { o.EvidenceFileID = f.fileId; o.EvidenceHash = f.sha256; }
      var h = _v92Upsert_(String(c.key), o, { at: new Date().toISOString(), by: who, role: _mcRbNormRole_(op.session.role), action: f ? 'комментарий и файл (SHA-256 ' + f.sha256.slice(0, 12) + '…)' : 'комментарий', comment: cm });
      _audit_(op, 'V92_NOTE', 'Смена_Задачи_V92', String(c.key), null, { comment: cm, file: f ? f.sha256 : '' }); _endOp_(op); return _ok_({ key: c.key, history: h }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Выполнено: задача, переданная вашей роли (что сделано — обязательно). */
function v92TaskDone(json, token) {
  var op = null; try { op = _beginOp_(token, '', 'V92_DONE', 'Моя смена', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), cm = String(d.comment || '').trim(), role = _mcRbNormRole_(op.session.role);
    var r = _v92Recs_().filter(function (x) { return String(x.TaskKey) === String(d.key); })[0];
    if (!r || r.Status !== 'TRANSFERRED' || String(r.OwnerRole) !== role) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Отметить «выполнено» можно задачу, переданную вашей роли; остальные закрываются своим действием', op.id); }
    if (cm.length < 5) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Напишите, что сделано', op.id); }
    var f = d.evidence ? _v67File_(d.evidence, 'Задача ' + d.key) : null, who = ''; try { who = _author_(op).фио; } catch (e) {}
    return _withLock_(function () {
      var o = { Status: 'DONE', Comment: cm, UpdatedBy: who, OperationID: op.id }; if (f) { o.EvidenceFileID = f.fileId; o.EvidenceHash = f.sha256; }
      var h = _v92Upsert_(String(d.key), o, { at: new Date().toISOString(), by: who, role: role, action: 'выполнено' + (f ? ' (файл)' : ''), comment: cm });
      _audit_(op, 'V92_DONE', 'Смена_Задачи_V92', String(d.key), 'TRANSFERRED', 'DONE'); _endOp_(op); return _ok_({ key: d.key, status: 'DONE', history: h }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Закрепить задачи роли без сотрудника за другой ролью (директор). */
function v92SaveCover(json, token) {
  var op = null; try { op = _beginOp_(token, 'grants', 'V92_COVER', 'Моя смена', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), r = _mcRbNormRole_(d.role), cv = _mcRbNormRole_(d.coverRole || ''), why = String(d.reason || '').trim();
    if (MC_RB_ROLES_.indexOf(r) < 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите роль', op.id); }
    if (cv && (MC_RB_ROLES_.indexOf(cv) < 0 || cv === r)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Закрепить можно за другой ролью из списка', op.id); }
    if (cv && !_v92Staffed_()[cv]) { _endOp_(op, 'FAILED'); return _fail_('ROLE_OWNER_NOT_CONFIGURED', 'В роли «' + cv + '» нет сотрудников', op.id); }
    if (cv && why.length < 5) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину (например, «кладовщика нет — склад ведёт шеф-повар»)', op.id); }
    var who = ''; try { who = _author_(op).фио; } catch (e) {}
    return _withLock_(function () {
      var sh = _v92Sh_(MC_V92_COVER_, MC_V92_COVER_HEAD_), ex = _v92Rows_(MC_V92_COVER_).filter(function (x) { return String(x.OwnerRole) === r; })[0], row = [r, cv, why, who, new Date()];
      if (ex) sh.getRange(ex._row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
      _audit_(op, 'V92_COVER', 'Смена_Роли_V92', r, ex ? ex.CoveredBy : null, { coveredBy: cv, reason: why }); _endOp_(op); return _ok_({ role: r, coveredBy: cv }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
