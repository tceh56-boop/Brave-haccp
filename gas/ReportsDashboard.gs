// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

// ЦЕХ — ReportsDashboard.gs
// Единый контур управленческих отчётов и dashboard руководителя (Stage 20, перенесён в CORE100).
// Только чтение первичных данных; агрегаты не подменяют журнал/учёт.
//
// При переносе (2026-10-06): «сегодня» — по часовому поясу скрипта (todayDateStr_), а не UTC;
// каждый смежный дашборд вызывается через _rdSafe_ — сбой одного раздела не роняет всю сводку;
// добавлен блок кассы (Pos.gs) и отчёты кассы в каталог.

function _rdInPeriod_(v, from, to) {
  if (!v) return false;
  var k = String(v).slice(0,10);
  return (!from || k >= from) && (!to || k <= to);
}
function _rdScope_(session, row) {
  if (!row) return false;
  if (row.organization_id && row.organization_id !== session.organization_id) return false;
  var scope = CONFIG.ROLE_DATA_SCOPE[session.role || session.роль || ''];
  if (scope === 'LOCATION' && row.location_id && row.location_id !== session.location_id) return false;
  return !session.location_id || !row.location_id || row.location_id === session.location_id || scope !== 'LOCATION';
}
function _rdRows_(sheet, session, from, to, dateField) {
  dateField = dateField || 'дата';
  return findRows_(sheet, function(r){ return _rdScope_(session,r) && _rdInPeriod_(r[dateField],from,to); });
}
function _rdCountOpen_(rows, statuses) { return rows.filter(function(r){return statuses.indexOf(String(r.статус||r.status||'').toUpperCase())!==-1;}).length; }

/** Вызов смежного дашборда: при ошибке — fallback и запись раздела в errors (видно в интерфейсе). */
function _rdSafe_(name, fn, fallback, errors) {
  try { return fn(); } catch (e) { errors.push({ раздел: name, ошибка: String((e && e.message) || e) }); return fallback; }
}

/** Касса за период: смены по дате открытия, деньги по строкам оплат (нетто после возвратов), гости, бонусы, стопы. */
function _rdPosSummary_(session, from, to) {
  if (typeof _posShiftTotals_ !== 'function') return null;
  var shifts = findRows_('POS_SHIFTS', function (s) {
    return s.organization_id === session.organization_id && (!session.location_id || s.location_id === session.location_id) && _rdInPeriod_(_posShiftDate_(s), from, to);
  });
  var t = { смен: shifts.length, открытых_смен: 0, продажи: 0, возвраты: 0, выручка: 0, нал: 0, карта: 0, прочее: 0, заказов: 0 };
  shifts.forEach(function (s) {
    if (s.статус === 'открыта') t.открытых_смен++;
    var x = _posShiftTotals_(s);
    ['продажи', 'возвраты', 'выручка', 'нал', 'карта', 'прочее'].forEach(function (k) { t[k] = round2_(t[k] + (Number(x[k]) || 0)); });
    t.заказов += Number(x.заказов) || 0;
  });
  t.средний_чек = t.заказов ? round2_(t.продажи / t.заказов) : 0;
  var bonus = { начислено: 0, списано: 0 };
  findRows_('BONUS_TXNS', function (b) { return b.organization_id === session.organization_id && _rdInPeriod_(b.создано, from, to); }).forEach(function (b) {
    if (b.тип === 'начисление') bonus.начислено = round2_(bonus.начислено + (Number(b.сумма) || 0));
    if (b.тип === 'списание') bonus.списано = round2_(bonus.списано - (Number(b.сумма) || 0));
  });
  t.новых_гостей = findRows_('GUESTS', function (g) { return g.organization_id === session.organization_id && _rdInPeriod_(g.создано, from, to); }).length;
  t.бонусы = bonus;
  t.в_стопе = typeof _posActiveStops_ === 'function' && session.location_id ? _posActiveStops_(session).length : 0;
  return t;
}

function getExecutiveDashboard_(session, data) {
  data=data||{};
  var today = todayDateStr_();
  // days: «последние N дней» считаются на сервере по его часовому поясу — браузер может жить в другом поясе.
  var days = Math.max(0, Math.min(366, Math.floor(Number(data.days) || 0)));
  var start = days ? new Date(new Date(today + 'T12:00:00Z').getTime() - days * 86400000).toISOString().slice(0, 10) : today;
  var from=data.dateFrom || start, to=data.dateTo || today;
  var errors = [];
  var pnl=_rdSafe_('P&L', function(){ return getPnl_(session.organization_id, resolveLocationScope_(session,data.locationId), from, to); }, {}, errors);
  var eco=_rdSafe_('Экономика', function(){ return getDashboard_(session.organization_id, session.location_id); }, {}, errors);
  var sales=findRows_('SALES',function(r){return _rdScope_(session,r)&&_rdInPeriod_(r.дата,from,to);});
  var production=findRows_('PRODUCTION',function(r){return _rdScope_(session,r)&&_rdInPeriod_(r.дата,from,to);});
  var writeoffs=findRows_('WRITE_OFFS',function(r){return _rdScope_(session,r)&&_rdInPeriod_(r.дата,from,to);});
  var journals=findRows_('JOURNALS',function(r){return _rdScope_(session,r)&&_rdInPeriod_(r.дата,from,to);});
  var deviations=findRows_('JOURNAL_DEVIATIONS',function(r){var j=findOne_('JOURNALS','journal_id',r.journal_id);return _rdScope_(session,j||r)&&_rdInPeriod_(r.дата,from,to);});
  var actions=findRows_('CORRECTIVE_ACTIONS',function(r){var d=findOne_('JOURNAL_DEVIATIONS','deviation_id',r.deviation_id);return _rdScope_(session,d||r)&&_rdInPeriod_(r.дата,from,to);});
  var incidents=findRows_('CRITICAL_INCIDENTS',function(r){return _rdScope_(session,r)&&_rdInPeriod_(r.created_at,from,to);});
  var quarantine=findRows_('QUARANTINE_CASES',function(r){return _rdScope_(session,r)&&_rdInPeriod_(r.created_at,from,to);});
  var warehouse=findRows_('WAREHOUSE_OPS',function(r){return _rdScope_(session,r)&&_rdInPeriod_(r.дата,from,to);});
  var waste=findRows_('WASTE_RECORDS',function(r){return _rdScope_(session,r)&&_rdInPeriod_(r.дата,from,to);});
  var markings=findRows_('MARKINGS',function(r){return _rdScope_(session,r)&&_rdInPeriod_(r.created_at,from,to);});
  var pending=findRows_('AUTO_JOURNAL_PENDING',function(r){return _rdScope_(session,r)&&String(r.статус||'').toUpperCase()!=='COMPLETED';});
  var tasks=findRows_('TASKS',function(r){return _rdScope_(session,r);});
  var purchases=findRows_('PURCHASE_REQUESTS',function(r){return _rdScope_(session,r)&&_rdInPeriod_(r.дата,from,to);});
  var equipment=findRows_('EQUIPMENT',function(r){return _rdScope_(session,r);});
  var compliance=_rdSafe_('Комплаенс', function(){ return getComplianceDashboard_(session.organization_id); }, {}, errors);
  var critical=_rdSafe_('Инциденты', function(){ return getCriticalIncidentDashboard_(session); }, { open: 0, quarantines: 0 }, errors);
  var safety=_rdSafe_('Охрана труда', function(){ return getSafetyDashboard_(session); }, null, errors);
  var analytics=_rdSafe_('ABC/XYZ', function(){ return getAnalyticsDashboard_(session,{dateFrom:from,dateTo:to}); }, {}, errors);
  var pos=_rdSafe_('Касса', function(){ return _rdPosSummary_(session, from, to); }, null, errors);
  var stockValue=eco.экономика ? eco.экономика.стоимость_склада : 0;
  var writeoffSum=writeoffs.reduce(function(s,r){return s+(Number(r.сумма)||0);},0);
  var wasteSum=waste.reduce(function(s,r){return s+(Number(r.сумма)||0);},0);
  return {
    period:{from:from,to:to},
    kpi:{revenue:round2_(Number(pnl.выручка)||0),gross_profit:round2_(Number(pnl.валовая_прибыль)||0),gross_margin_pct:round2_(Number(pnl.валовая_маржа_pct)||0),food_cost_pct:round2_(Number(eco.экономика&&eco.экономика.средний_food_cost)||0),stock_value:round2_(stockValue),writeoffs:round2_(writeoffSum),waste:round2_(wasteSum),sales_count:sales.length,production_count:production.length},
    operations:{open_tasks:tasks.filter(function(r){return ['ОТКРЫТА','OPEN','В РАБОТЕ'].indexOf(String(r.статус||r.status||'').toUpperCase())>=0;}).length,pending_journals:pending.length,open_deviations:deviations.filter(function(r){return String(r.статус||'').toLowerCase()!=='закрыто';}).length,open_corrective_actions:actions.filter(function(r){return String(r.статус||'').toLowerCase()!=='выполнено';}).length,open_incidents:Number(critical.open)||0,quarantines:Number(critical.quarantines)||0},
    pos:pos,
    safety:safety,
    compliance:compliance,
    counts:{sales:sales.length,production:production.length,warehouse_operations:warehouse.length,waste:waste.length,journals:journals.length,markings:markings.length,purchase_requests:purchases.length},
    reports:{sales:pnl,abc_xyz:analytics,critical_incidents:incidents.slice(0,50),quarantines:quarantine.slice(0,50),deviations:deviations.slice(0,100),corrective_actions:actions.slice(0,100),equipment:equipment},
    top:{dishes:analytics.top_dishes||[],products:analytics.top_products||[]},
    errors:errors
  };
}

function getManagementReports_(session,data){
  data=data||{}; var d=getExecutiveDashboard_(session,data);
  return {period:d.period, executive:d, catalog:[
    {id:'EXECUTIVE',name:'Дашборд руководителя',group:'Управление',action:'GET_EXECUTIVE_DASHBOARD'},
    {id:'P_AND_L',name:'P&L / прибыль и маржа',group:'Экономика',action:'GET_PNL'},
    {id:'ABC_XYZ',name:'ABC/XYZ блюда и продукты',group:'Экономика',action:'GET_ANALYTICS_DASHBOARD'},
    {id:'SALES',name:'Продажи',group:'Экономика',action:'GET_PNL'},
    {id:'POS_STAFF',name:'Касса: выручка по сотрудникам и сменам',group:'Касса',action:'POS_GET_STAFF_REPORT'},
    {id:'POS_GUESTS',name:'Гости и бонусная программа',group:'Касса',action:'POS_GET_GUESTS'},
    {id:'POS_STOP',name:'Стоп-лист',group:'Касса',action:'POS_GET_STOP_LIST'},
    {id:'STOCK',name:'Остатки и стоимость склада',group:'Склад',action:'GET_ECONOMICS'},
    {id:'WRITE_OFFS',name:'Списания и потери',group:'Склад',action:'GET_EXECUTIVE_DASHBOARD'},
    {id:'PRODUCTION',name:'Производство и выход',group:'Производство',action:'GET_PRODUCTION_ENTERPRISE_DASHBOARD'},
    {id:'WASTE',name:'Отходы',group:'Производство',action:'GET_EXECUTIVE_DASHBOARD'},
    {id:'JOURNALS',name:'Журналы и выполнение контрольных точек',group:'HACCP / ППК',action:'GET_EXECUTIVE_DASHBOARD'},
    {id:'DEVIATIONS',name:'Отклонения и корректирующие действия',group:'HACCP / ППК',action:'GET_EXECUTIVE_DASHBOARD'},
    {id:'INCIDENTS',name:'Критические инциденты и карантин',group:'HACCP / ППК',action:'GET_CRITICAL_INCIDENT_DASHBOARD'},
    {id:'COMPLIANCE',name:'Комплаенс документов',group:'HACCP / Документы',action:'GET_COMPLIANCE_DASHBOARD'},
    {id:'MARKING',name:'Маркировка и проверка этикеток',group:'Прослеживаемость',action:'GET_EXECUTIVE_DASHBOARD'},
    {id:'PURCHASES',name:'Закупки и заявки',group:'Закупки',action:'GET_EXECUTIVE_DASHBOARD'},
    {id:'EQUIPMENT',name:'Оборудование и обслуживание',group:'Эксплуатация',action:'GET_EXECUTIVE_DASHBOARD'},
    {id:'SAFETY',name:'Охрана труда / инструктажи',group:'Безопасность',action:'GET_SAFETY_DASHBOARD'},
    {id:'RECALL',name:'Отзыв и прослеживаемость партий',group:'Качество',action:'GET_EXECUTIVE_DASHBOARD'}
  ]};
}
