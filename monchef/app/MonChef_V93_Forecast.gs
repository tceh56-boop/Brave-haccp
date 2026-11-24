/**
 * MonChef V93 — прогнозы, риски и проекты акций (приложение к промту владельца «AI-прогнозирование, риски и акции», разд. 1–9).
 *
 *  Схема: данные → прогноз → уверенность → риск → рекомендация → проект действия → ручное подтверждение → публикация → аудит.
 *  Прогноз — статистика по журналу продаж (Ж_Продажи), а не нейросеть: среднее по тем же дням недели за последние 8 недель,
 *  диапазон — наименьшее и наибольшее из этих дней, уверенность — по числу наблюдений и разбросу (коэффициент вариации).
 *  Меньше 21 дня истории или меньше 3 таких же дней недели — INSUFFICIENT_DATA со списком недостающих данных.
 *  Вероятности дефицита и списания — «повтор прошлых недель»: доля прошлых недель, в которые при сегодняшнем остатке
 *  продукта не хватило бы (или партия не была бы израсходована до срока). Праздники, погода, мероприятия, акции, площадки
 *  и каналы продаж (кроме банкетов) не учитываются — это показано в каждом прогнозе.
 *
 *  Реестр AI_Риски: RiskScore = Probability × Impact × Exposure (вероятность 0–1, ущерб 1–5 по таблице, срочность 0,2–1).
 *  Исходные показатели и факторы видны. Закрывает риск только человек с правом «Риски — решение»; «Снижен» — только
 *  с подтверждённым результатом (файл-доказательство или последний расчёт риск не подтверждает).
 *
 *  AI_ПроектыАкций: AI создаёт только DRAFT; на утверждение отправляет человек (REVIEW); утверждает руководитель
 *  (APPROVED), публикует — отдельным действием (PUBLISHED), останавливает — человек (COMPLETED). Запреты: просроченная,
 *  карантинная или заблокированная партия; нет подтверждённой себестоимости (фактическая по V64); маржа ниже минимальной
 *  или скидка выше максимальной (только исключение с причиной, утверждает не автор); отрицательная маржа (только директор,
 *  не автор, отдельное подтверждение); товар нужен для заказа или банкета (резерв); блюдо без ТТК; нет периода, площадки,
 *  ответственного; правила маржи не заданы. Публикация не меняет цены и ничего не проводит в финансах.
 *  Аварийное правило (если утверждено в настройках): опубликованная акция с заблокированной, карантинной или
 *  просроченной партией останавливается системой; остальные остановки — по предложению, решением человека.
 */
var MC_V93_VER_ = 'R1';
var MC_V93_RISK_ = 'AI_Риски', MC_V93_RISK_HEAD_ = ['RiskID', 'RiskType', 'OrganizationID', 'LocationID', 'ObjectType', 'ObjectID', 'Description', 'Probability', 'Impact', 'Exposure', 'RiskScore',
  'Confidence', 'Priority', 'DetectedAt', 'ExpectedDate', 'RecommendedAction', 'OwnerRole', 'Status', 'DecisionComment', 'ResolvedAt', 'ResolvedBy', 'OperationID',
  'RiskKey', 'FactorsJSON', 'MoneyAtRisk', 'StillDetected', 'LastCheckedAt', 'EvidenceFileID', 'EvidenceHash', 'HistoryJSON'];
var MC_V93_PROMO_ = 'AI_ПроектыАкций', MC_V93_PROMO_HEAD_ = ['PromotionDraftID', 'Name', 'LocationID', 'PeriodFrom', 'PeriodTo', 'TargetProducts', 'TargetDishes', 'TargetChannel', 'PromotionType',
  'ProposedPrice', 'DiscountPercent', 'ExpectedSales', 'ExpectedRevenue', 'ExpectedCOGS', 'ExpectedMargin', 'ExpectedWriteoffReduction', 'CannibalizationRisk', 'MinimumMarginRule', 'Reason',
  'Confidence', 'Status', 'CreatedByAI', 'ApprovedBy', 'ApprovedAt', 'OperationID',
  'Problem', 'BatchIDs', 'BasePrice', 'UnitCost', 'CostSource', 'MarginPct', 'BaselineSales', 'TargetExtra', 'DeficitRisk', 'StopConditions', 'Responsible', 'Author',
  'ExceptionReason', 'ExceptionBy', 'NegativeApproved', 'BansJSON', 'RiskID', 'CreatedAt', 'CreatedBy', 'PublishedAt', 'PublishedBy', 'CompletedAt', 'CompletedBy', 'StopReason',
  'StopSuggested', 'ActualJSON', 'HistoryJSON', 'UpdatedAt'];
var MC_V93_FC_ = 'AI_Прогнозы', MC_V93_FC_HEAD_ = ['ForecastID', 'Day', 'Object', 'Kind', 'Value', 'Low', 'High', 'Confidence', 'Observations', 'HistoryFrom', 'HistoryTo', 'Method', 'CreatedAt', 'OperationID'];
var MC_V93_CFG_PROP_ = 'MC_V93_CFG';
var MC_V93_PERMS_ = [['ai_view', 'Прогнозы и риски — просмотр (по своей роли)', 'Аналитика'], ['risk_manage', 'Риски — решение по риску (на проверку, принять, снижен, отклонить)', 'Аналитика'],
  ['promo_manage', 'Акции — проекты акций (создать, изменить, отправить на утверждение)', 'Аналитика'], ['promo_approve', 'Акции — утвердить, опубликовать, остановить; правила маржи и скидки', 'Аналитика']];
var MC_V93_MATRIX_ = {
  'Директор': ['ai_view', 'risk_manage', 'promo_manage', 'promo_approve'], 'Шеф-повар': ['ai_view', 'risk_manage', 'promo_manage'], 'Су-шеф': ['ai_view', 'promo_manage'],
  'Ответственный за ХАССП': ['ai_view', 'risk_manage'], 'Администратор': ['ai_view', 'promo_manage'], 'Кладовщик': ['ai_view'], 'Закупщик': ['ai_view'],
  'Бухгалтер / экономист': ['ai_view', 'risk_manage'], 'Руководитель смены': ['ai_view', 'risk_manage'], 'Администратор площадки': ['ai_view', 'promo_manage']
};
var MC_V93_CONF_RU_ = { HIGH: 'высокая', MEDIUM: 'средняя', LOW: 'низкая', NONE: 'нет данных' };
var MC_V93_PRIO_RU_ = { CRITICAL: 'КРИТИЧНО', IMPORTANT: 'ВАЖНО', NORMAL: 'ОБЫЧНО' };
var MC_V93_RST_ = ['NEW', 'REVIEW', 'ACCEPTED', 'MITIGATED', 'REJECTED', 'EXPIRED'];
var MC_V93_RST_RU_ = { NEW: 'новый', REVIEW: 'на проверке', ACCEPTED: 'принят (меры в работе)', MITIGATED: 'снижен (результат подтверждён)', REJECTED: 'отклонён', EXPIRED: 'срок прошёл' };
var MC_V93_PST_RU_ = { DRAFT: 'проект', REVIEW: 'на утверждении', APPROVED: 'утверждена', REJECTED: 'отклонена', EXPIRED: 'срок прошёл', PUBLISHED: 'опубликована (действует)', COMPLETED: 'завершена' };
var MC_V93_PTYPES_ = ['скидка', 'комплект', 'подарок', 'специальная цена', 'меню дня', 'персональное предложение'];
var MC_V93_WD_RU_ = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
// типы рисков: владелец (по порядку, первая роль с сотрудником), кто ещё видит, какие суммы (cost — себестоимость, revenue — выручка), право для показа
var MC_V93_TYPES_ = {
  DEFICIT: { ru: 'риск дефицита', owner: ['Закупщик', 'Кладовщик', 'Шеф-повар'], aud: ['Кладовщик', 'Закупщик', 'Шеф-повар', 'Су-шеф', 'Руководитель смены'], money: 'revenue' },
  EXPIRY: { ru: 'риск просрочки', owner: ['Кладовщик', 'Руководитель смены', 'Ответственный за ХАССП'], aud: ['Кладовщик', 'Шеф-повар', 'Су-шеф', 'Ответственный за ХАССП', 'Руководитель смены'], money: 'cost' },
  WRITEOFF: { ru: 'риск списания', owner: ['Шеф-повар', 'Кладовщик'], aud: ['Кладовщик', 'Шеф-повар', 'Су-шеф', 'Руководитель смены', 'Бухгалтер / экономист'], money: 'cost' },
  REVENUE_DROP: { ru: 'риск падения выручки', owner: ['Директор'], aud: ['Бухгалтер / экономист', 'Администратор площадки'], money: 'revenue', need: 'revenue_view|finance_view' },
  COST_OVERRUN: { ru: 'риск превышения себестоимости', owner: ['Шеф-повар', 'Бухгалтер / экономист'], aud: ['Шеф-повар', 'Бухгалтер / экономист'], money: 'cost', need: 'costs|finance_view' },
  MARGIN_DROP: { ru: 'риск снижения маржинальности', owner: ['Бухгалтер / экономист', 'Директор'], aud: ['Бухгалтер / экономист'], money: 'cost', need: 'finance_view' },
  BUDGET: { ru: 'риск превышения бюджета', owner: ['Директор'], aud: ['Бухгалтер / экономист'], money: 'cost', need: 'finance_view' },
  SUPPLY_ERROR: { ru: 'риск ошибки поставки', owner: ['Закупщик', 'Кладовщик'], aud: ['Закупщик', 'Кладовщик', 'Шеф-повар'] },
  SHIFT_NOT_CLOSED: { ru: 'риск незакрытия смены', owner: ['Руководитель смены', 'Директор'], aud: ['Руководитель смены', 'Администратор площадки'] },
  SANITARY: { ru: 'риск санитарного нарушения', owner: ['Ответственный за ХАССП', 'Директор'], aud: ['Ответственный за ХАССП', 'Шеф-повар', 'Руководитель смены'] },
  TRAINING: { ru: 'риск отсутствия обязательного обучения', owner: ['Директор', 'Ответственный за ХАССП'], aud: ['Ответственный за ХАССП'] },
  STAFF_SHORTAGE: { ru: 'риск нехватки персонала', owner: ['Директор'], aud: ['Руководитель смены', 'Администратор площадки'] },
  INVENTORY: { ru: 'риск расхождения инвентаризации', owner: ['Кладовщик', 'Директор'], aud: ['Кладовщик', 'Бухгалтер / экономист'], money: 'cost' },
  FIN_DATA: { ru: 'риск неполноты финансовых данных', owner: ['Бухгалтер / экономист', 'Директор'], aud: ['Бухгалтер / экономист'], need: 'finance_view' }
};
var MC_V93_IMPACT_TXT_ = 'ущерб 1–5: сумма под риском до 1 000 ₽ — 1, до 5 000 ₽ — 2, до 20 000 ₽ — 3, до 100 000 ₽ — 4, больше — 5; просрочка на складе и санитарный риск — 5; обучение и поставка — 3; персонал и полнота данных — 2; сумма неизвестна — 3';
var MC_V93_EXPO_TXT_ = 'срочность: до конца смены или до 12 ч — 1; до 24 ч — 0,8; до 72 ч — 0,6; до 7 дн. — 0,4; позже — 0,2';
var MC_V93_PRIO_TXT_ = 'КРИТИЧНО — RiskScore от 2,5 (или просрочка / санитарный риск с вероятностью 1); ВАЖНО — от 1; ОБЫЧНО — меньше 1';

/* ---------------- права, роли, меню ---------------- */
(function () {
  try { MC_V93_PERMS_.forEach(function (p) { if (!MC_RB_PERMS_.some(function (x) { return x[0] === p[0]; })) MC_RB_PERMS_.push(p); }); } catch (e) {}
  try { Object.keys(MC_V93_MATRIX_).forEach(function (r) { var a = MC_RB_MATRIX_[r]; if (a) MC_V93_MATRIX_[r].forEach(function (k) { if (a.indexOf(k) < 0) a.push(k); }); }); } catch (e) {}
  var grant = function (perm, roles) { try { var a = MC_RB_GRANTABLE_[perm] || (MC_RB_GRANTABLE_[perm] = []); roles.forEach(function (r) { if (a.indexOf(r) < 0) a.push(r); }); } catch (e) {} };
  grant('promo_approve', ['Шеф-повар', 'Администратор площадки', 'Бухгалтер / экономист']); grant('risk_manage', ['Кладовщик', 'Закупщик', 'Су-шеф']); grant('ai_view', ['Повар горячего цеха', 'Повар холодного цеха', 'Кондитер', 'Кассир']);
  try { MC_RB_MODULES_.ai = 'ai_view|risk_manage|promo_manage|promo_approve'; MC_RB_MODULE_RU_.ai = 'Прогнозы, риски и акции'; } catch (e) {}
  try { if (MC_UI_VIEWS_.indexOf('ai') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['ai']); } catch (e) {}
  try { var o = _mcViewOfParams_; _mcViewOfParams_ = function (params) { if (params && (params.ai === '1' || params.forecast === '1' || params.promo === '1')) return 'ai'; return o.apply(this, arguments); }; } catch (e) {}
  try {
    var sec = function (k, btn) { var orig = _UI_BUILDERS_[k]; if (typeof orig !== 'function') return; _UI_BUILDERS_[k] = function (token, opts, s) { var r = orig(token, opts, s) || {}; r.actions = (r.actions || []).concat([btn]); return r; }; };
    sec('finance', { label: 'Прогнозы, риски и акции', module: 'ai' });
    sec('stock', { label: 'Прогноз дефицита и списания, акции', module: 'ai' });
  } catch (e) {}
  // V92: «Моя смена» — прогноз дефицита и списания ведут кладовщик, руководитель смены, шеф-повар
  try { MC_V92_RULES_.unshift({ re: /^V93\|(def|wo)\|/, kind: 'stock', roles: ['Кладовщик', 'Руководитель смены', 'Шеф-повар'], ru: 'прогноз дефицита и списания' }); } catch (e) {}
})();

/* ---------------- общие ---------------- */
function _v93J_(x) { return typeof x === 'string' ? JSON.parse(x || '{}') : (x || {}); }
function _v93Iso_(x) { if (!x) return ''; if (x instanceof Date) return Utilities.formatDate(x, _mcTz_(), 'yyyy-MM-dd'); var s = String(x).replace(/^'/, '');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) || /GMT/.test(s)) { var d = new Date(s); if (!isNaN(d.getTime())) return Utilities.formatDate(d, _mcTz_(), 'yyyy-MM-dd'); }
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''; }
function _v93Dmy_(iso) { return iso ? String(iso).split('-').reverse().join('.') : '—'; }
function _v93R_(x, d) { var p = Math.pow(10, d === undefined ? 2 : d); return Math.round((Number(x) || 0) * p) / p; }
function _v93Pct_(x) { return x === null || x === undefined || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + String(Math.abs(_v93R_(x * 100, 1))).replace('.', ',') + ' %'; }
function _v93Num_(x, d) { return String(_v93R_(x, d === undefined ? 1 : d)).replace('.', ','); }
function _v93Money_(x) { return x === null || x === undefined || !isFinite(x) ? 'НЕТ ДАННЫХ' : _v92Money_(x); }
function _v93Wd_(iso) { return _v89Wd_(iso); }
function _v93Id_(p) { return p + '-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd') + '-' + Utilities.getUuid().slice(0, 6).toUpperCase(); }
function _v93Who_(op) { try { return _author_(op).фио; } catch (e) { return ''; } }
function _v93Rows_(name) { return _v92Rows_(name); }
function _v93Write_(name, head, o) {
  var sh = _v92Sh_(name, head), vals = head.map(function (k) { var x = o[k]; return x === undefined || x === null ? '' : x; });
  if (o._row) sh.getRange(o._row, 1, 1, head.length).setValues([vals]); else sh.appendRow(vals);
}
function _v93Hist_(r) { try { return JSON.parse(r.HistoryJSON || '[]'); } catch (e) { return []; } }
function _v93Can_(s) {
  var h = function (k) { return _mcRbHasExact_(s, k); };
  var boss = !!s && !s.dev && (_mcRbNormRole_(s.role) === 'Директор' || h('grants'));
  return { view: h('ai_view|risk_manage|promo_manage|promo_approve'), risk: h('risk_manage'), manage: h('promo_manage'), approve: h('promo_approve'), boss: boss,
    cost: h('costs|finance_view|procurement_cost_view'), revenue: h('revenue_view|finance_view'), finance: h('finance_view'), stock: h('stock|stock_expiry_view|prod_manage|haccp|procurement_view|procurement'),
    proc: h('procurement_view|procurement|procurement_create|stock'), staff: boss || h('task_assign') };
}

/* ---------------- настройки ---------------- */
function _v93Cfg_() {
  var d = { minMarginPct: null, maxDiscountPct: null, minHistoryDays: 21, minObs: 3, weeks: 8, horizonDays: 3, riskMinP: 0.25, marginDropPp: 3, costRisePct: 10, revenueDropPct: 10, staffNorm: null,
    emergency: null, updatedBy: '', updatedAt: '' };
  try { var x = JSON.parse(PropertiesService.getScriptProperties().getProperty(MC_V93_CFG_PROP_) || '{}'); Object.keys(x).forEach(function (k) { if (x[k] !== undefined) d[k] = x[k]; }); } catch (e) {}
  var num = function (v) { var n = Number(v); return v === null || v === '' || v === undefined || !isFinite(n) ? null : n; };
  d.minMarginPct = num(d.minMarginPct); d.maxDiscountPct = num(d.maxDiscountPct); d.staffNorm = num(d.staffNorm);
  d.minHistoryDays = Math.max(21, num(d.minHistoryDays) || 21); d.minObs = Math.max(3, num(d.minObs) || 3); d.weeks = Math.min(12, Math.max(4, num(d.weeks) || 8));
  d.horizonDays = Math.min(6, Math.max(1, num(d.horizonDays) || 3)); d.riskMinP = Math.min(1, Math.max(0.1, num(d.riskMinP) || 0.25));
  d.marginDropPp = num(d.marginDropPp) || 3; d.costRisePct = num(d.costRisePct) || 10; d.revenueDropPct = num(d.revenueDropPct) || 10;
  d.promoReady = d.minMarginPct !== null && d.maxDiscountPct !== null;
  return d;
}

/* ---------------- данные: продажи (журнал Ж_Продажи) ---------------- */
function _v93Sales_() {
  var out = { rows: [], first: null, firstHall: null, today: _v71Day_(new Date()) }, j = _mcJById_('J36'), sh = j && _book_().getSheetByName(j.sheetName);
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getDataRange().getValues(), H = v[0].map(String), ix = function (k) { return H.indexOf(k); };
  var cD = ix('Дата'), cT = ix('Время'), cB = ix('Блюдо'), cQ = ix('Количество'), cP = ix('Цена'), cS = ix('Сумма'), cR = ix('Источник записи'), cA = ix('Внесено'), cSt = ix('Площадка'), cCh = ix('Канал продаж'), cSl = ix('ФИО продавца');
  for (var i = 1; i < v.length; i++) {
    var d = _v71Day_(v[i][cD]); if (!d || !v[i][cB]) continue;
    var q = parseFloat(v[i][cQ]) || 0; if (!(q > 0)) continue;
    var src = cR >= 0 ? String(v[i][cR] || '') : ''; if (typeof _v95IsVoid_ === 'function' && _v95IsVoid_(src)) continue;   // V95: отменённая продажа и её сторно
    var pr = parseFloat(v[i][cP]), sm = parseFloat(v[i][cS]), ch = /банкет/i.test(src) ? 'banquet' : 'hall';
    if (!out.first || d < out.first) out.first = d;
    if (ch === 'hall' && (!out.firstHall || d < out.firstHall)) out.firstHall = d;
    out.rows.push({ n: i + 1, day: d, min: cT >= 0 ? _v87Min_(v[i][cT]) : null, dish: String(v[i][cB]), key: _normNameServer_(v[i][cB]), qty: q,
      price: isFinite(pr) ? pr : null, sum: isFinite(sm) ? sm : (isFinite(pr) ? pr * q : null), ch: ch, at: cA >= 0 && v[i][cA] instanceof Date ? v[i][cA].getTime() : null,
      site: typeof _v97SiteOfCell_ === 'function' ? _v97SiteOfCell_(cSt >= 0 ? v[i][cSt] : '') : 'SITE-MAIN',
      channel: typeof _v97ChOfCell_ === 'function' ? _v97ChOfCell_(cCh >= 0 ? v[i][cCh] : '', cSl >= 0 ? v[i][cSl] : '', src) : (ch === 'banquet' ? 'BANQUET' : 'HALL') });
  }
  return out;
}
/** Окончание смены сегодня: из расписания сменных писем (V89), иначе — конец дня. */
function _v93ShiftEnd_(day) {
  var wd = _v93Wd_(day), best = null;
  try { _v89Shifts_().forEach(function (s) { if (!s.active || !s.end) return; if (!(s.date === day || (!s.date && (!s.days.length || s.days.indexOf(wd) >= 0)))) return; var m = _v87Min_(s.end), st = _v87Min_(s.start);
    if (m === null) return; if (st !== null && m <= st) m = 1440; if (best === null || m > best.min) best = { min: m, name: s.name || s.id }; }); } catch (e) {}
  return best ? { min: best.min, hm: best.min >= 1440 ? '24:00' : _v93HM_(best.min), src: 'расписание смены «' + best.name + '»' } : { min: 1440, hm: '24:00', src: 'окончание смены не задано — до конца дня' };
}
function _v93HM_(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
function _v93Stat_(a) {
  var n = a.length; if (!n) return null;
  var m = a.reduce(function (s, x) { return s + x; }, 0) / n, sd = n > 1 ? Math.sqrt(a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (n - 1)) : 0;
  return { n: n, mean: m, low: Math.min.apply(null, a), high: Math.max.apply(null, a), sd: sd, cv: m > 0 ? sd / m : null };
}
function _v93Conf_(st) { if (!st || !st.n) return 'NONE'; var cv = st.cv === null ? 1 : st.cv; return st.n >= 6 && cv <= 0.2 ? 'HIGH' : st.n >= 4 && cv <= 0.4 ? 'MEDIUM' : 'LOW'; }
function _v93ConfWhy_(st) { return st ? 'наблюдений ' + st.n + ', разброс (коэф. вариации) ' + (st.cv === null ? '—' : _v93Num_(st.cv * 100, 0) + ' %') + '; высокая — от 6 наблюдений и разброс до 20 %, средняя — от 4 и до 40 %' : ''; }

/* ---------------- прогноз продаж ---------------- */
/** Прогноз на день: по каждому блюду и итогам — среднее, диапазон, уверенность; до конца смены; факт к этому часу и отклонение. */
function _v93Forecast_(nowMs, S) {
  var cfg = _v93Cfg_(), tz = _mcTz_(), day = _v71Day_(new Date(nowMs)), wd = _v93Wd_(day), nowMin = _v87Min_(Utilities.formatDate(new Date(nowMs), tz, 'HH:mm')), end = _v93ShiftEnd_(day);
  S = S || _v93Sales_();
  var hall = S.rows.filter(function (r) { return r.ch === 'hall'; }), open = {}, first = S.firstHall;
  hall.forEach(function (r) { if (r.day < day) open[r.day] = 1; });
  var obs = []; for (var k = 1; k <= cfg.weeks; k++) { var od = _v89AddDays_(day, -7 * k); if (first && od < first) break; if (open[od]) obs.push(od); }
  var span = first ? Math.max(0, _v88DayDiff_(day, first)) : 0;
  var F = { day: day, wd: wd, wdRu: MC_V93_WD_RU_[wd], status: 'OK', missing: [], updatedAt: new Date(nowMs).toISOString(), nowHM: _v93HM_(nowMin), endHM: end.hm, endSrc: end.src,
    method: 'Статистика по журналу продаж (не нейросеть): среднее по тем же дням недели за последние ' + cfg.weeks + ' нед.; диапазон — наименьшее и наибольшее из этих дней; уверенность — по числу наблюдений и разбросу.',
    source: 'Журнал продаж (Ж_Продажи), продажи в зале; банкеты — по заказам, не прогнозируются',
    history: { from: first, to: _v89AddDays_(day, -1), days: span, obs: obs, weeks: cfg.weeks },
    limitations: ['праздники, погода, мероприятия и акции не учтены', 'площадки и каналы: в журнале продаж их нет — прогноз по площадке в целом (зал); банкеты — по заказам', 'тренд последних недель показан, но в прогноз не заложен'],
    decision: 'Шеф-повар (производство), кладовщик и закупщик (запасы), директор (выручка)' };
  if (!first) F.missing.push('продаж в журнале нет');
  else if (span < cfg.minHistoryDays) F.missing.push('история продаж — ' + span + ' дн. (с ' + _v93Dmy_(first) + '), нужно не меньше ' + cfg.minHistoryDays + ' дн.');
  if (obs.length < cfg.minObs) F.missing.push('наблюдений по дню недели «' + F.wdRu + '» — ' + obs.length + ', нужно не меньше ' + cfg.minObs);
  if (F.missing.length) F.status = 'INSUFFICIENT_DATA';
  try { var pr = _v93Rows_(MC_V93_PROMO_).filter(function (p) { return /PUBLISHED|COMPLETED/.test(p.Status) && _v93Iso_(p.PeriodTo) >= _v89AddDays_(day, -7 * cfg.weeks) && _v93Iso_(p.PeriodFrom) < day; });
    if (pr.length) F.limitations.push('в истории были акции (' + pr.map(function (p) { return p.Name; }).slice(0, 3).join('; ') + ') — спрос в эти дни мог быть выше обычного'); } catch (e) {}
  var by = {}; obs.forEach(function (d) { by[d] = []; }); hall.forEach(function (r) { if (by[r.day]) by[r.day].push(r); });
  var todayRows = hall.filter(function (r) { return r.day === day; }), noTime = 0, allN = 0;
  obs.forEach(function (d) { by[d].forEach(function (r) { allN++; if (r.min === null) noTime++; }); });
  var after = function (r) { return r.min === null || (r.min >= nowMin && r.min < end.min); }, before = function (r) { return r.min !== null && r.min < nowMin; };
  var series = function (pick, val) {
    var tot = [], aft = [], bef = [];
    obs.forEach(function (d) { var t = 0, a = 0, b = 0; by[d].forEach(function (r) { if (!pick(r)) return; var x = val(r); t += x; if (after(r)) a += x; if (before(r)) b += x; }); tot.push(t); aft.push(a); bef.push(b); });
    var fact = 0; todayRows.forEach(function (r) { if (pick(r)) fact += val(r); });
    var st = _v93Stat_(tot), sa = _v93Stat_(aft), sb = _v93Stat_(bef);
    var o = { value: st ? _v93R_(st.mean) : null, low: st ? st.low : null, high: st ? st.high : null, n: obs.length, cv: st && st.cv !== null ? _v93R_(st.cv, 3) : null,
      conf: F.status === 'OK' ? _v93Conf_(st) : 'NONE', remain: sa ? _v93R_(sa.mean) : null, remainLow: sa ? sa.low : null, remainHigh: sa ? sa.high : null,
      fact: _v93R_(fact), expected: sb ? _v93R_(sb.mean) : null, _tot: tot, _aft: aft };
    o.confRu = MC_V93_CONF_RU_[o.conf]; o.dev = o.expected > 0 ? _v93R_(fact / o.expected - 1, 4) : null;
    if (tot.length >= 4) { var last = (tot[0] + tot[1]) / 2, rest = tot.slice(2).reduce(function (s, x) { return s + x; }, 0) / (tot.length - 2); o.trend = rest > 0 ? _v93R_(last / rest - 1, 3) : null; }
    return o;
  };
  var keys = {}; obs.forEach(function (d) { by[d].forEach(function (r) { if (!keys[r.key]) keys[r.key] = r.dish; }); }); todayRows.forEach(function (r) { if (!keys[r.key]) keys[r.key] = r.dish; });
  F.dishes = Object.keys(keys).map(function (k) { var o = series(function (r) { return r.key === k; }, function (r) { return r.qty; }); o.dish = keys[k]; o.key = k; return o; })
    .sort(function (a, b) { return (b.value || 0) - (a.value || 0) || a.dish.localeCompare(b.dish, 'ru'); });
  F.totals = { portions: series(function () { return true; }, function (r) { return r.qty; }), revenue: series(function (r) { return r.sum !== null; }, function (r) { return r.sum || 0; }),
    orders: series(function () { return true; }, function () { return 1; }) };
  F.totals.orders.note = 'строк продаж (номеров чеков в журнале нет)';
  F.timeNote = !allN ? '' : noTime / allN > 0.2 ? 'у ' + Math.round(noTime / allN * 100) + ' % продаж не записано время — «до конца смены» считает их оставшимися (с запасом)' : '';
  // спрос по часам (тот же день недели) и по дням недели
  var hours = {}; obs.forEach(function (d) { by[d].forEach(function (r) { if (r.min === null) return; var h = Math.floor(r.min / 60); hours[h] = (hours[h] || 0) + r.qty; }); });
  F.byHour = Object.keys(hours).map(Number).sort(function (a, b) { return a - b; }).map(function (h) { return { hour: ('0' + h).slice(-2) + ':00', qty: _v93R_(hours[h] / Math.max(1, obs.length), 1) }; });
  var perDay = {}; hall.forEach(function (r) { perDay[r.day] = (perDay[r.day] || 0) + r.qty; });
  F.byWeekday = [1, 2, 3, 4, 5, 6, 7].map(function (w) {
    var off = (wd - w + 7) % 7 || 7, a = [];
    for (var k2 = 0; k2 < cfg.weeks; k2++) { var x = _v89AddDays_(day, -off - 7 * k2); if (first && x < first) break; if (open[x]) a.push(perDay[x] || 0); }
    var st = _v93Stat_(a); return { wd: w, ru: MC_V93_WD_RU_[w], mean: st ? _v93R_(st.mean, 1) : null, n: a.length };
  });
  // потребность в персонале — только с нормой выработки
  if (cfg.staffNorm && F.byHour.length) { var peak = F.byHour.reduce(function (m, x) { return x.qty > m.qty ? x : m; }, F.byHour[0]);
    F.staff = { status: 'OK', norm: cfg.staffNorm, peak: peak, rows: F.byHour.map(function (x) { return { hour: x.hour, qty: x.qty, staff: Math.ceil(x.qty / cfg.staffNorm - 1e-9) }; }) };
  } else F.staff = { status: 'INSUFFICIENT_DATA', missing: ['норма выработки: сколько порций в час готовит один сотрудник (настройка «Правила»)', 'график смен сотрудников в MON CHEF не ведётся — нехватка по графику не считается'] };
  // выполнение плана выручки (бюджет V89)
  try { var c = _v92Cfg_(), plan = _v89Budget_(day, day, c.LocationID); F.budget = { plan: plan.revenue, how: plan.how };
    if (plan.revenue !== null && F.totals.revenue.value !== null) { F.budget.dev = _v93R_(F.totals.revenue.value / plan.revenue - 1, 4); F.budget.pBelow = _v93R_(F.totals.revenue._tot.filter(function (x) { return x < plan.revenue; }).length / Math.max(1, obs.length), 2); }
  } catch (e) { F.budget = { plan: null, error: String(e.message || e) }; }
  F._S = S; F._obs = obs; F._by = by; F._first = first; F._nowMin = nowMin; F._end = end; F._open = open;
  return F;
}

/* ---------------- склад: дефицит до конца смены, списание, потребность ---------------- */
function _v93Content_(idx) {
  var memo = {}, C = {}, PF = {};
  Object.keys(idx.dishByCode).forEach(function (code) {
    var d = idx.dishByCode[code]; if (d.semi) return; var L = [];
    (d.ing || []).forEach(function (ing) {
      var b = _toBaseUnitServer_(Number(ing[1]) || 0, ing[2]); if (!(b.qty > 0)) return;
      var key = _prodKey_(ing[0]) + '|' + b.unit, pf = _v88PfOf_(ing[0], idx, memo), y = pf ? _subYield_(pf) : 0, sub = [];
      if (pf && y > 0) (pf.ing || []).forEach(function (si) { var sb = _toBaseUnitServer_(Number(si[1]) || 0, si[2]); if (sb.qty > 0) sub.push({ key: _prodKey_(si[0]) + '|' + sb.unit, name: String(si[0]), bu: sb.unit, per: sb.qty / y }); });
      if (pf && y > 0) PF[key] = { name: String(pf.name), sub: sub };
      L.push({ key: key, name: String(ing[0]), bu: b.unit, per: b.qty, pf: pf && y > 0 });
    });
    C[_normNameServer_(d.name)] = { name: String(d.name), code: String(d.code), L: L };
  });
  return { C: C, PF: PF };
}
function _v93DishOf_(key, name, idx, CC) { if (CC.C[key]) return CC.C[key]; var d = _v88Dish_(name, idx); return d ? CC.C[_normNameServer_(d.name)] || null : null; }
/** Потребность в продуктах для набора порций: п/ф — сначала из остатка п/ф, нехватка п/ф — в сырьё по ТТК п/ф. */
function _v93Need_(qmap, CC, avail, full) {
  var first = {}, names = {}, via = {}, raw = {}, pfNeed = {};
  Object.keys(qmap).forEach(function (k) { var c = CC.C[k]; if (!c || !(qmap[k] > 0)) return;
    c.L.forEach(function (l) { first[l.key] = (first[l.key] || 0) + l.per * qmap[k]; names[l.key] = l.name; (via[l.key] = via[l.key] || {})[c.name] = 1; }); });
  Object.keys(first).forEach(function (key) {
    var pf = CC.PF[key]; if (!pf) { raw[key] = (raw[key] || 0) + first[key]; return; }
    pfNeed[key] = first[key]; var short = full ? first[key] : Math.max(0, first[key] - (avail[key] || 0));
    if (short > 0) pf.sub.forEach(function (s) { raw[s.key] = (raw[s.key] || 0) + s.per * short; names[s.key] = s.name; (via[s.key] = via[s.key] || {})[pf.name] = 1; });
  });
  return { raw: raw, pf: pfNeed, names: names, via: via };
}
function _v93Avail_(ST) { var res = _v89Reserved_(), m = {}; Object.keys(ST.byKey).forEach(function (k) { m[k] = Math.max(0, ST.byKey[k].avail - (res[k] || 0)); }); return { free: m, res: res }; }
/** Сценарии «повтор прошлых недель»: для недели k — продажи блюд в дни (день − 7k) за [с, по]; сегодня — только после текущего часа. */
function _v93Replay_(F, fromIso, toIso) {
  var cfg = _v93Cfg_(), S = F._S, day = F.day, out = [];
  var hall = S.rows.filter(function (r) { return r.ch === 'hall'; }), byDay = {}; hall.forEach(function (r) { (byDay[r.day] = byDay[r.day] || []).push(r); });
  for (var k = 1; k <= cfg.weeks; k++) {
    var ok = true, q = {}, perDay = {};
    for (var d = fromIso; d <= toIso; d = _v89AddDays_(d, 1)) {
      var src = _v89AddDays_(d, -7 * k); if (!F._first || src < F._first || src >= day) { ok = false; break; }
      var L = byDay[src] || [], dq = {}; L.forEach(function (r) { if (d === day && !(r.min === null || (r.min >= F._nowMin && r.min < F._end.min))) return; q[r.key] = (q[r.key] || 0) + r.qty; dq[r.key] = (dq[r.key] || 0) + r.qty; });
      perDay[d] = dq;
    }
    if (ok) out.push({ k: k, q: q, perDay: perDay });
  }
  return out;
}
function _v93StockCalc_(F, nowMs, idx) {
  var cfg = _v93Cfg_(), ST = _v89Stock_(nowMs), CC = _v93Content_(idx), AV = _v93Avail_(ST), avail = AV.free, lp = _v93LastPrice_(F._S), day = F.day, R = { status: F.status, deficits: [], pfMake: [], writeoff: [], needs: [], surplus: [], notes: [] };
  R._ST = ST; R._CC = CC; R._avail = avail;
  // дефицит до конца смены
  var sc = _v93Replay_(F, day, day);
  if (F.status === 'OK' && sc.length >= cfg.minObs) {
    var needs = sc.map(function (s) { var m = {}; Object.keys(s.q).forEach(function (k) { var c = _v93DishOf_(k, k, idx, CC); if (c) m[_normNameServer_(c.name)] = (m[_normNameServer_(c.name)] || 0) + s.q[k]; }); return _v93Need_(m, CC, avail, false); });
    var meanQ = {}; F.dishes.forEach(function (d) { var c = _v93DishOf_(d.key, d.dish, idx, CC); if (c && d.remain > 0) meanQ[_normNameServer_(c.name)] = (meanQ[_normNameServer_(c.name)] || 0) + d.remain; });
    var NM = _v93Need_(meanQ, CC, avail, false), keys = {};
    needs.forEach(function (N) { Object.keys(N.raw).forEach(function (k) { keys[k] = 1; }); }); Object.keys(NM.raw).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var a = avail[k] || 0, arr = needs.map(function (N) { return N.raw[k] || 0; }), short = arr.filter(function (x) { return x > a + 1e-6; }).length, st = _v93Stat_(arr), bu = k.split('|')[1];
      if (!short) return;
      var nm = (needs.filter(function (N) { return N.names[k]; })[0] || NM).names[k] || k.split('|')[0], via = Object.keys((NM.via[k] || {})).concat(needs.reduce(function (acc, N) { return acc.concat(Object.keys(N.via[k] || {})); }, [])).filter(function (x, i, A) { return A.indexOf(x) === i; });
      var revenue = 0; F.dishes.forEach(function (d) { if (via.indexOf(d.dish) >= 0 || via.some(function (v) { var c = _v93DishOf_(d.key, d.dish, idx, CC); return c && c.L.some(function (l) { return l.name === v; }); })) revenue += (d.remain || 0) * ((lp[d.key] || {}).price || 0); });
      var meanNeed = st.mean, shortMean = Math.max(0, meanNeed - a);
      R.deficits.push({ key: k, product: nm, bu: bu, avail: a, availText: _v88Fmt_(a, bu), need: _v93R_(meanNeed, 3), needText: _v88Fmt_(meanNeed, bu), needHighText: _v88Fmt_(st.high, bu),
        short: _v93R_(shortMean, 3), shortText: _v88Fmt_(shortMean, bu), p: _v93R_(short / arr.length, 2), n: arr.length, dishes: via.slice(0, 6), reserved: AV.res[k] ? _v88Fmt_(AV.res[k], bu) : '',
        quarantine: ST.byKey[k] && ST.byKey[k].quarantine > 0 ? _v88Fmt_(ST.byKey[k].quarantine, bu) : '', money: meanNeed > 0 ? _v93R_(shortMean / meanNeed * revenue) : null });
    });
    R.deficits.sort(function (a, b) { return b.p - a.p || a.product.localeCompare(b.product, 'ru'); });
    Object.keys(NM.pf).forEach(function (k) { var a = avail[k] || 0, bu = k.split('|')[1]; if (NM.pf[k] > a + 1e-6) R.pfMake.push({ product: CC.PF[k].name, need: _v88Fmt_(NM.pf[k], bu), avail: _v88Fmt_(a, bu), make: _v88Fmt_(NM.pf[k] - a, bu) }); });
  } else R.notes.push('дефицит до конца смены: INSUFFICIENT_DATA — ' + (F.missing.join('; ') || 'мало полных недель истории'));
  // риск списания: партии со сроком в горизонте, расход по FEFO в повторе прошлых недель
  var horizon = _v89AddDays_(day, cfg.horizonDays), tz = _mcTz_(), use = {};
  Object.keys(CC.C).forEach(function (dk) { CC.C[dk].L.forEach(function (l) { (use[l.key] = use[l.key] || []).push({ dish: dk, per: l.per }); if (l.pf && CC.PF[l.key]) CC.PF[l.key].sub.forEach(function (s) { (use[s.key] = use[s.key] || []).push({ dish: dk, per: l.per * s.per, via: CC.PF[l.key].name }); }); }); });
  var dkMemo = {}, dkOf = function (sk) { if (!dkMemo.hasOwnProperty(sk)) { var c = _v93DishOf_(sk, sk, idx, CC); dkMemo[sk] = c ? _normNameServer_(c.name) : null; } return dkMemo[sk]; };
  var groups = {}; ST.batches.forEach(function (b) { if (b.status !== 'active' || !b.expiry || b.expiry < day) return; (groups[b.key] = groups[b.key] || []).push(b); });
  Object.keys(groups).forEach(function (k) {
    var L = groups[k].sort(function (a, b) { return a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0; });
    if (!L.some(function (b) { return b.expiry <= horizon; })) return;
    var last = L.filter(function (b) { return b.expiry <= horizon; }).slice(-1)[0].expiry, scen = _v93Replay_(F, day, last), U = use[k] || [];
    var useBy = function (s, until) { var t = 0; Object.keys(s.perDay).forEach(function (d) { if (d > until) return; var dq = s.perDay[d]; Object.keys(dq).forEach(function (sk) { var dk = dkOf(sk); if (!dk) return; U.forEach(function (u) { if (u.dish === dk) t += dq[sk] * u.per; }); }); }); return t; };
    var cum = 0;
    L.forEach(function (b) {
      var before = cum; cum += b.base; if (b.expiry > horizon) return;
      var hrs = (_v89At_(b.expiry, '23:59', tz).getTime() + 59999 - nowMs) / 36e5, onePrice = b.price / (_toBaseUnitServer_(1, b.unit).qty || 1);
      var o = { batchId: b.id, product: b.product, key: k, bu: b.bu, rem: b.base, remText: _v88Fmt_(b.base, b.bu), expiry: b.expiry, hours: Math.round(hrs), value: _v93R_(b.base * onePrice), dishes: U.map(function (u) { return CC.C[u.dish].name + (u.via ? ' (через ' + u.via + ')' : ''); }).filter(function (x, i, A) { return A.indexOf(x) === i; }).slice(0, 6) };
      if (!U.length) { o.p = 1; o.n = 0; o.left = b.base; o.leftText = o.remText; o.leftValue = o.value; o.why = 'ни одно блюдо по ТТК не использует продукт — расход продажами не ожидается'; o.conf = 'LOW'; R.writeoff.push(o); return; }
      if (F.status !== 'OK' || scen.length < cfg.minObs) { o.p = null; o.status = 'INSUFFICIENT_DATA'; o.why = 'мало истории продаж для повтора прошлых недель'; R.writeoff.push(o); return; }
      var lefts = scen.map(function (s) { return Math.max(0, b.base - Math.max(0, useBy(s, b.expiry) - before)); }), stl = _v93Stat_(lefts);
      o.n = scen.length; o.p = _v93R_(lefts.filter(function (x) { return x > b.base * 0.01; }).length / scen.length, 2); o.left = _v93R_(stl.mean, 3); o.leftText = _v88Fmt_(stl.mean, b.bu); o.leftValue = _v93R_(stl.mean * onePrice);
      o.use = _v93R_(stl.mean === null ? 0 : b.base - stl.mean, 3); o.conf = _v93Conf_(_v93Stat_(scen.map(function (s) { return useBy(s, b.expiry); })));
      o.why = 'расход по прошлым неделям до ' + _v93Dmy_(b.expiry) + ' (FEFO, сначала более ранние партии)';
      if (o.p > 0) R.writeoff.push(o);
    });
  });
  R.writeoff.sort(function (a, b) { return (b.p === null ? -1 : b.p) - (a.p === null ? -1 : a.p) || a.expiry.localeCompare(b.expiry); });
  // потребность на 7 дней (сырьё, п/ф готовятся из сырья) и изменение к прошлой неделе
  var sc7 = _v93Replay_(F, day, _v89AddDays_(day, 6));
  if (F.status === 'OK' && sc7.length >= cfg.minObs) {
    var N7 = sc7.map(function (s) { var m = {}; Object.keys(s.q).forEach(function (k) { var c = _v93DishOf_(k, k, idx, CC); if (c) m[_normNameServer_(c.name)] = (m[_normNameServer_(c.name)] || 0) + s.q[k]; }); return _v93Need_(m, CC, avail, true).raw; });
    var lastQ = {}; F._S.rows.forEach(function (r) { if (r.ch !== 'hall' || r.day >= day || r.day < _v89AddDays_(day, -7)) return; var c = _v93DishOf_(r.key, r.dish, idx, CC); if (c) lastQ[_normNameServer_(c.name)] = (lastQ[_normNameServer_(c.name)] || 0) + r.qty; });
    var L7 = _v93Need_(lastQ, CC, avail, true).raw, inc = _v89Orders_().byKey, ks = {};
    N7.forEach(function (N) { Object.keys(N).forEach(function (k) { ks[k] = 1; }); });
    Object.keys(ks).forEach(function (k) {
      var st = _v93Stat_(N7.map(function (N) { return N[k] || 0; })), bu = k.split('|')[1], a = avail[k] || 0, i = (inc[k] || {}).incoming || 0, buy = Math.max(0, st.mean - a - i);
      R.needs.push({ key: k, product: k.split('|')[0], bu: bu, need7: _v93R_(st.mean, 3), need7Text: _v88Fmt_(st.mean, bu), range: _v88Fmt_(st.low, bu) + ' – ' + _v88Fmt_(st.high, bu), availText: _v88Fmt_(a, bu),
        incomingText: i ? _v88Fmt_(i, bu) : '', toBuy: _v93R_(buy, 3), toBuyText: buy > 0 ? _v88Fmt_(buy, bu) : '—', last7Text: L7[k] ? _v88Fmt_(L7[k], bu) : '0', change: L7[k] ? _v93R_(st.mean / L7[k] - 1, 3) : null });
      if (a > 0 && st.mean > 0 && a > st.mean * 2) R.surplus.push({ product: k.split('|')[0], availText: _v88Fmt_(a, bu), days: _v93R_(a / (st.mean / 7), 0), why: 'запаса больше, чем на 14 дней прогноза' });
    });
    var nameOf = {}; ST.batches.forEach(function (b) { nameOf[b.key] = b.product; }); R.needs.forEach(function (x) { if (nameOf[x.key]) x.product = nameOf[x.key]; });
    R.needs.sort(function (a, b) { return b.toBuy - a.toBuy || a.product.localeCompare(b.product, 'ru'); });
    Object.keys(avail).forEach(function (k) { if (avail[k] > 0 && !ks[k] && !(use[k] || []).length) { R.surplus.push({ product: (ST.byKey[k] || {}).name || k, availText: _v88Fmt_(avail[k], k.split('|')[1]), days: null, why: 'в блюдах по ТТК не используется — продажами не расходуется' }); } });
  } else R.notes.push('потребность на 7 дней: INSUFFICIENT_DATA — мало полных недель истории продаж');
  return R;
}
function _v93LastPrice_(S) { var m = {}; S.rows.forEach(function (r) { if (r.ch !== 'hall' || r.price === null || !(r.price >= 0)) return; if (!m[r.key] || r.day >= m[r.key].day) m[r.key] = { day: r.day, price: r.price }; }); return m; }

/* ---------------- экономика по V64: фактическая себестоимость продаж ---------------- */
function _v93Econ_(today, days) {
  var from = _v89AddDays_(today, -(days || 28) + 1), E = { from: from, to: today, sales: {}, dish: {}, days: {} }, L = [];
  try { L = _v64Build_(_v64Range_(from, today)).lines || []; } catch (e) { E.error = String(e.message || e); return E; }
  L.forEach(function (l) {
    if (l.stage !== 'SALE' || l.objType !== 'SALE') return; var id = String(l.objId), x = E.sales[id] || (E.sales[id] = { id: id, date: '', dish: '', qty: 0, amount: 0, cost: 0, outs: 0, bad: 0 });
    if (l.dir === 'IN') { x.date = _v93Iso_(l.date) || _v71Day_(new Date(l.date)); x.dish = String(l.product); x.qty += Number(l.qty) || 0; x.amount += Number(l.amount) || 0; }
    else { x.cost += Number(l.amount) || 0; x.outs++; if ((l.trace && l.trace !== 'PASS' && l.trace !== 'NOT_APPLICABLE') || (l.flags || []).indexOf('MISSING_PRICE') >= 0) x.bad++; }
  });
  Object.keys(E.sales).forEach(function (id) {
    var x = E.sales[id]; if (!x.dish || !(x.qty > 0)) return; x.known = x.outs > 0 && !x.bad; x.cpp = x.known ? x.cost / x.qty : null;
    var k = _normNameServer_(x.dish), d = E.dish[k] || (E.dish[k] = { dish: x.dish, qty: 0, cost: 0, n: 0, unknown: 0, list: [] });
    if (x.known) { d.qty += x.qty; d.cost += x.cost; d.n++; d.list.push(x); } else d.unknown++;
    var dd = E.days[x.date] || (E.days[x.date] = { net: 0, cost: 0, knownNet: 0, n: 0, unknown: 0 }); dd.net += x.amount; dd.n++; if (x.known) { dd.cost += x.cost; dd.knownNet += x.amount; } else dd.unknown++;
  });
  Object.keys(E.dish).forEach(function (k) { var d = E.dish[k]; d.cpp = d.qty > 0 ? d.cost / d.qty : null; });
  return E;
}

/* ---------------- реестр рисков: обнаружение ---------------- */
function _v93ImpactMoney_(m) { return m === null || m === undefined || !isFinite(m) ? 3 : m < 1000 ? 1 : m < 5000 ? 2 : m < 20000 ? 3 : m < 100000 ? 4 : 5; }
function _v93Expo_(h) { return h === null || h === undefined ? 0.4 : h <= 12 ? 1 : h <= 24 ? 0.8 : h <= 72 ? 0.6 : h <= 168 ? 0.4 : 0.2; }
function _v93Risk_(o) {
  o.P = _v93R_(Math.max(0, Math.min(1, o.P)), 2); o.I = Math.max(1, Math.min(5, o.I)); o.E = _v93R_(o.E, 2);
  o.score = _v93R_(o.P * o.I * o.E, 2);
  o.prio = (o.type === 'EXPIRY' || o.type === 'SANITARY') && o.P >= 1 ? 'CRITICAL' : o.score >= 2.5 ? 'CRITICAL' : o.score >= 1 ? 'IMPORTANT' : 'NORMAL';
  o.key = [o.type, o.objectType, o.objectId, o.expected || ''].join('|');
  o.factors = [['Вероятность (P)', _v93Num_(o.P, 2) + ' — ' + o.pWhy], ['Ущерб (Impact)', o.I + ' — ' + o.iWhy], ['Срочность (Exposure)', _v93Num_(o.E, 2) + ' — ' + o.eWhy],
    ['RiskScore = P × Impact × Exposure', _v93Num_(o.P, 2) + ' × ' + o.I + ' × ' + _v93Num_(o.E, 2) + ' = ' + _v93Num_(o.score, 2)]].concat(o.extra || []);
  return o;
}
function _v93Detect_(nowMs, K) {
  var cfg = _v93Cfg_(), day = _v71Day_(new Date(nowMs)), out = [], nc = [], F = K.F, R = K.R, tz = _mcTz_(), endH = Math.max(0, (F._end.min - F._nowMin) / 60);
  var add = function (o) { out.push(_v93Risk_(o)); };
  // дефицит до конца смены
  R.deficits.filter(function (d) { return d.p >= cfg.riskMinP; }).forEach(function (d) {
    add({ type: 'DEFICIT', objectType: 'PRODUCT', objectId: d.product, expected: day, P: d.p, pWhy: 'в ' + Math.round(d.p * d.n) + ' из ' + d.n + ' прошлых таких же дней («' + F.wdRu + '») продажи до конца смены потребовали бы больше сегодняшнего остатка',
      I: _v93ImpactMoney_(d.money), iWhy: d.money === null ? 'сумма не оценена' : 'выручка блюд с продуктом под риском ≈ ' + _v93Money_(d.money), E: _v93Expo_(endH), eWhy: 'до конца смены ' + _v93Num_(endH, 1) + ' ч',
      desc: 'Может не хватить «' + d.product + '» до конца смены (' + F.endHM + '): нужно ≈ ' + d.needText + ' (до ' + d.needHighText + '), доступно ' + d.availText + (d.reserved ? ' (без резерва ' + d.reserved + ')' : '') + (d.quarantine ? '; на входном контроле ' + d.quarantine : ''),
      action: 'Проверить остаток, взять из резерва нельзя без решения по заказу; срочная закупка или замена в меню (стоп-лист) — решение шеф-повара и закупщика', money: d.money, conf: F.dishes.length ? F.totals.portions.conf : 'LOW',
      extra: [['Блюда', d.dishes.join(', ') || '—'], ['Источник', F.source], ['История', _v93Dmy_(F.history.from) + ' – ' + _v93Dmy_(F.history.to) + ', наблюдений ' + F._obs.length]] });
  });
  // просрочка на складе — сейчас
  var EX = null; try { EX = _v89Exp_(_v92Cfg_(), nowMs, R._ST); } catch (e) {}
  (EX ? EX.rows : []).filter(function (x) { return x.cat === 'EXPIRED'; }).forEach(function (x) {
    add({ type: 'EXPIRY', objectType: 'BATCH', objectId: x.batchId, expected: day, P: 1, pWhy: 'срок годности истёк (' + x.expiry + '), остаток ' + x.qtyText + ' на складе', I: 5, iWhy: 'просроченная продукция на складе — санитарный риск',
      E: 1, eWhy: 'уже сейчас', desc: 'Просрочено: «' + x.product + '», партия ' + x.batchId + ', остаток ' + x.qtyText + ' — продавать и использовать нельзя', action: x.action, money: x.value || null, conf: 'HIGH',
      extra: [['Статус партии', x.statusRu], ['Ответственный', x.owner]] });
  });
  // списание
  R.writeoff.filter(function (w) { return w.p !== null && w.p >= cfg.riskMinP; }).forEach(function (w) {
    add({ type: 'WRITEOFF', objectType: 'BATCH', objectId: w.batchId, expected: w.expiry, P: w.p, pWhy: w.n ? 'в ' + Math.round(w.p * w.n) + ' из ' + w.n + ' повторов прошлых недель партия не израсходована бы до срока' : w.why,
      I: _v93ImpactMoney_(w.leftValue), iWhy: 'ожидаемый остаток к сроку ' + w.leftText + ' ≈ ' + _v93Money_(w.leftValue), E: _v93Expo_(w.hours), eWhy: 'до конца срока ' + w.hours + ' ч',
      desc: 'Риск списания: «' + w.product + '», партия ' + w.batchId + ', остаток ' + w.remText + ', годен до ' + _v93Dmy_(w.expiry) + '; ожидаемый остаток к сроку ' + w.leftText,
      action: 'Использовать в первую очередь (go-лист, меню дня), рассмотреть проект акции; если не уйдёт — списание с причиной', money: w.leftValue, conf: w.conf || 'LOW',
      extra: [['Блюда', w.dishes.join(', ') || '—'], ['Как считали', w.why]] });
  });
  // выручка: последние 7 дней против тех же дней недели трёх недель до них; план выручки сегодня
  var hall = F._S.rows.filter(function (r) { return r.ch === 'hall'; }), net = {}; hall.forEach(function (r) { net[r.day] = (net[r.day] || 0) + (r.sum || 0); });
  if (F._first && _v88DayDiff_(day, F._first) >= 28) {
    var a7 = 0, b7 = 0, below = 0, days7 = 0;
    for (var i = 1; i <= 7; i++) { var d = _v89AddDays_(day, -i), base = [1, 2, 3].map(function (w) { return net[_v89AddDays_(d, -7 * w)] || 0; }), bm = (base[0] + base[1] + base[2]) / 3; a7 += net[d] || 0; b7 += bm; if (bm > 0) { days7++; if ((net[d] || 0) < bm) below++; } }
    if (b7 > 0 && a7 / b7 - 1 <= -cfg.revenueDropPct / 100) add({ type: 'REVENUE_DROP', objectType: 'LOCATION', objectId: 'выручка за 7 дней', expected: _v89AddDays_(day, 6), P: days7 ? below / days7 : 0,
      pWhy: below + ' из ' + days7 + ' последних дней ниже среднего тех же дней недели за 3 недели до них', I: _v93ImpactMoney_(b7 - a7), iWhy: 'недобор за неделю ≈ ' + _v93Money_(b7 - a7), E: 0.4, eWhy: 'тенденция недели',
      desc: 'Выручка за 7 дней ' + _v93Money_(a7) + ' против ' + _v93Money_(b7) + ' обычно (' + _v93Pct_(a7 / b7 - 1) + '), порог — ' + cfg.revenueDropPct + ' %', action: 'Разобрать причины по блюдам и дням; меню, загрузка зала, акции — решение руководителя', money: b7 - a7, conf: 'MEDIUM' });
  } else nc.push({ type: 'REVENUE_DROP', why: 'нужно не меньше 28 дней истории продаж (сравнение 7 дней с тремя предыдущими неделями)' });
  if (F.budget && F.budget.plan !== null && F.budget.plan !== undefined && F.status === 'OK' && F.budget.pBelow >= 0.5)
    add({ type: 'REVENUE_DROP', objectType: 'PLAN', objectId: 'план выручки ' + _v93Dmy_(day), expected: day, P: F.budget.pBelow, pWhy: 'в ' + Math.round(F.budget.pBelow * F._obs.length) + ' из ' + F._obs.length + ' таких же дней выручка была ниже плана',
      I: _v93ImpactMoney_(F.budget.plan - F.totals.revenue.value), iWhy: 'прогноз ' + _v93Money_(F.totals.revenue.value) + ' при плане ' + _v93Money_(F.budget.plan), E: _v93Expo_(endH), eWhy: 'до конца смены ' + _v93Num_(endH, 1) + ' ч',
      desc: 'Риск невыполнения плана выручки сегодня: прогноз ' + _v93Money_(F.totals.revenue.value) + ' (' + _v93Money_(F.totals.revenue.low) + ' – ' + _v93Money_(F.totals.revenue.high) + '), план ' + _v93Money_(F.budget.plan) + ' (' + _v93Pct_(F.budget.dev) + ')',
      action: 'Решение руководителя: загрузка зала, меню дня; без изменения цен в системе', money: Math.max(0, F.budget.plan - F.totals.revenue.value), conf: F.totals.revenue.conf });
  // маржинальность и себестоимость (фактическая, V64)
  var E = K.E, last7 = _v89AddDays_(day, -6);
  if (E.error) nc.push({ type: 'MARGIN_DROP', why: 'экономика V64 не рассчитана: ' + E.error });
  else {
    var A = { net: 0, cost: 0, days: [] }, B = { net: 0, cost: 0, n: 0 };
    Object.keys(E.days).forEach(function (d) { var x = E.days[d]; if (!(x.knownNet > 0)) return; if (d >= last7) { A.net += x.knownNet; A.cost += x.cost; A.days.push((x.knownNet - x.cost) / x.knownNet); } else { B.net += x.knownNet; B.cost += x.cost; B.n++; } });
    if (A.days.length >= 3 && B.n >= 3) {
      var mA = (A.net - A.cost) / A.net, mB = (B.net - B.cost) / B.net, dropPp = (mB - mA) * 100;
      if (dropPp >= cfg.marginDropPp) add({ type: 'MARGIN_DROP', objectType: 'LOCATION', objectId: 'маржа 7 дней', expected: _v89AddDays_(day, 6), P: A.days.filter(function (m) { return m < mB; }).length / A.days.length,
        pWhy: A.days.filter(function (m) { return m < mB; }).length + ' из ' + A.days.length + ' последних дней с маржой ниже средней за 3 недели до них', I: _v93ImpactMoney_(dropPp / 100 * A.net), iWhy: 'недополученная валовая прибыль за 7 дней ≈ ' + _v93Money_(dropPp / 100 * A.net),
        E: 0.4, eWhy: 'тенденция недели', desc: 'Маржинальность за 7 дней ' + _v93Num_(mA * 100, 1) + ' % против ' + _v93Num_(mB * 100, 1) + ' % (−' + _v93Num_(dropPp, 1) + ' п. п., порог ' + cfg.marginDropPp + ' п. п.)',
        action: 'Проверить цены закупки, выход и порции, продажи со скидками; пересчёт цен — решение руководителя', money: dropPp / 100 * A.net, conf: 'MEDIUM' });
    } else nc.push({ type: 'MARGIN_DROP', why: 'нужно не меньше 3 дней продаж с подтверждённой себестоимостью за последнюю неделю и 3 — за три недели до неё' });
    var cnt = 0;
    Object.keys(E.dish).forEach(function (k) {
      var d = E.dish[k], a = d.list.filter(function (x) { return x.date >= last7; }), b = d.list.filter(function (x) { return x.date < last7; });
      if (a.length < 2 || b.length < 2) return; cnt++;
      var ca = a.reduce(function (s, x) { return s + x.cost; }, 0) / a.reduce(function (s, x) { return s + x.qty; }, 0), cb = b.reduce(function (s, x) { return s + x.cost; }, 0) / b.reduce(function (s, x) { return s + x.qty; }, 0), qa = a.reduce(function (s, x) { return s + x.qty; }, 0);
      if (cb > 0 && ca / cb - 1 >= cfg.costRisePct / 100) add({ type: 'COST_OVERRUN', objectType: 'DISH', objectId: d.dish, expected: _v89AddDays_(day, 6), P: a.filter(function (x) { return x.cpp > cb; }).length / a.length,
        pWhy: a.filter(function (x) { return x.cpp > cb; }).length + ' из ' + a.length + ' продаж недели с себестоимостью порции выше прежней средней', I: _v93ImpactMoney_((ca - cb) * qa), iWhy: 'перерасход за неделю ≈ ' + _v93Money_((ca - cb) * qa),
        E: 0.4, eWhy: 'тенденция недели', desc: 'Себестоимость порции «' + d.dish + '» ' + _v93Money_(ca) + ' против ' + _v93Money_(cb) + ' (' + _v93Pct_(ca / cb - 1) + ', порог ' + cfg.costRisePct + ' %)',
        action: 'Проверить цены партий, выход п/ф и закладку по ТТК', money: (ca - cb) * qa, conf: 'MEDIUM' });
    });
    if (!cnt) nc.push({ type: 'COST_OVERRUN', why: 'нужно не меньше 2 продаж блюда с подтверждённой себестоимостью за последнюю неделю и 2 — до неё' });
    // полнота финансовых данных
    var unk = 0; Object.keys(E.days).forEach(function (d) { if (d >= last7) unk += E.days[d].unknown; });
    var Fn = null; try { Fn = _v89Fin_(_v92Cfg_(), ['CLOSING'], { date: day }, nowMs); } catch (e) {}
    var gaps = []; if (unk) gaps.push('продаж без подтверждённой себестоимости за 7 дней: ' + unk); if (Fn && Fn.a && Fn.a.revBad) gaps.push('продаж без цены сегодня: ' + Fn.a.revBad); if (Fn && Fn.v79 && Fn.v79.length) gaps.push('не подтверждено документов о продажах: ' + Fn.v79.length);
    if (Fn && Fn.ex && !Fn.ex.n) gaps.push('расходы за сегодня не внесены');
    try { if (typeof _v94ZRows_ === 'function') { var Zr = _v94ZRows_(), y1 = _v89AddDays_(day, -1);
      if (_v94KktOn_() && !Zr.some(function (z) { return z['Статус'] === 'POSTED' && _v93Iso_(z['Дата смены']) === y1; })) gaps.push('Z-отчёт кассы за ' + _v93Dmy_(y1) + ' не загружен');
      Zr.filter(function (z) { return z['Статус'] === 'POSTED' && _v93Iso_(z['Дата смены']) >= last7; }).forEach(function (z) { var rc = null; try { rc = JSON.parse(String(z['Сверка (JSON)'] || 'null')); } catch (e) {} if (rc && rc.status === 'MISMATCH') gaps.push('Z-отчёт и журнал продаж за ' + _v93Dmy_(rc.date) + ' расходятся на ' + _v93Money_(rc.diff)); }); } } catch (e) {}
    if (gaps.length) add({ type: 'FIN_DATA', objectType: 'LOCATION', objectId: 'финансовые данные', expected: day, P: 1, pWhy: 'пробелы есть в данных сейчас', I: 2, iWhy: 'отчёты и маржа неполные', E: 0.8, eWhy: 'закрыть в течение суток',
      desc: 'Неполные финансовые данные: ' + gaps.join('; '), action: 'Внести цены, расходы, подтвердить документы о продажах; партии без цены — уточнить по накладным', money: null, conf: 'HIGH' });
  }
  // бюджет расходов: с начала месяца против плана
  try {
    var loc = _v92Cfg_().LocationID, m0 = day.slice(0, 8) + '01', y = Number(day.slice(0, 4)), mo = Number(day.slice(5, 7)), dim = new Date(Date.UTC(y, mo, 0)).getUTCDate(), mEnd = day.slice(0, 8) + ('0' + dim).slice(-2);
    var ex = _v89Expenses_(m0, day), plan = _v89Budget_(m0, day, loc), mon = _v89Budget_(m0, mEnd, loc);
    if (plan.expenses === null || plan.expenses === undefined) nc.push({ type: 'BUDGET', why: 'план расходов (статья «Расходы» в листе «Бюджет») не задан' });
    else {
      var el = _v88DayDiff_(day, m0) + 1, cumOver = 0, s = 0;
      for (var dd = m0; dd <= day; dd = _v89AddDays_(dd, 1)) { ex.rows.forEach(function (r) { if (r.date === dd) s += r.amount; }); var pl = _v89Budget_(m0, dd, loc).expenses || 0; if (s > pl) cumOver++; }
      var proj = ex.total / el * dim, monPlan = mon.expenses;
      if (ex.total > plan.expenses || (monPlan && proj > monPlan)) add({ type: 'BUDGET', objectType: 'BUDGET', objectId: 'расходы ' + day.slice(0, 7), expected: mEnd, P: cumOver / el,
        pWhy: 'в ' + cumOver + ' из ' + el + ' дней месяца расходы нарастающим итогом были выше плана на ту же дату', I: _v93ImpactMoney_(monPlan ? proj - monPlan : ex.total - plan.expenses), iWhy: monPlan ? 'по линейному прогнозу на месяц ' + _v93Money_(proj) + ' при плане ' + _v93Money_(monPlan) : 'превышение на сегодня ' + _v93Money_(ex.total - plan.expenses),
        E: 0.4, eWhy: 'до конца месяца', desc: 'Расходы с начала месяца ' + _v93Money_(ex.total) + ' при плане на эту дату ' + _v93Money_(plan.expenses) + (monPlan ? '; прогноз на месяц ' + _v93Money_(proj) + ' / план ' + _v93Money_(monPlan) : ''),
        action: 'Проверить статьи расходов; перенос или сокращение — решение директора', money: monPlan ? proj - monPlan : ex.total - plan.expenses, conf: 'LOW' });
    }
  } catch (e) { nc.push({ type: 'BUDGET', why: 'бюджет не прочитан: ' + String(e.message || e) }); }
  // поставки: заказ поставщику просрочен
  try { _v89Orders_().list.forEach(function (o) { if (!/sent|confirmed|partial/.test(o.status) || !o.due || o.due >= day) return;
    add({ type: 'SUPPLY_ERROR', objectType: 'ORDER', objectId: o.id, expected: o.due, P: 1, pWhy: 'срок поставки ' + _v93Dmy_(o.due) + ' прошёл, заказ не получен полностью', I: 3, iWhy: 'возможен дефицит по позициям заказа', E: 1, eWhy: 'уже сейчас',
      desc: 'Поставка по заказу ' + o.id + ' (' + o.supplier + ') просрочена: срок ' + _v93Dmy_(o.due) + ', статус «' + o.status + '»', action: 'Связаться с поставщиком, при необходимости — замена поставщика или меню', money: null, conf: 'HIGH' }); }); } catch (e) {}
  // санитарный: сотрудники пищевых ролей без действующего допуска
  try { var stE = _mcRbEmpState_(); Object.keys(stE).forEach(function (id) { var e = stE[id]; if (!e || e.active === false || e.hidden || MC_FOOD_ROLES_.indexOf(e.role) < 0) return; _MC_ADM_CACHE = null; var a = _mcAdmissionByName_(e.name);
    if (a && a.status !== 'ADMITTED') add({ type: 'SANITARY', objectType: 'EMPLOYEE', objectId: e.name, expected: day, P: 1, pWhy: 'допуск: ' + (a.reason || a.statusRu || a.status), I: 5, iWhy: 'работа с пищевой продукцией без допуска', E: 1, eWhy: 'на смене сейчас',
      desc: 'Сотрудник «' + e.name + '» (' + e.role + ') без действующего медицинского допуска: ' + (a.reason || a.statusRu || a.status), action: 'Не допускать к работе с продукцией до оформления медосмотра и записи медкнижки', money: null, conf: 'HIGH' }); }); } catch (e) {}
  // обучение
  try { _trainingOverdue_(14).forEach(function (x) { var over = x.статус === 'просрочено', dl = _v93Iso_(x.действуетДо) || day, h = (Date.parse(dl) - Date.parse(day)) / 36e5;
    add({ type: 'TRAINING', objectType: 'EMPLOYEE', objectId: x.сотрудник + ' — ' + x.вид, expected: dl, P: 1, pWhy: over ? 'срок обучения истёк' : 'срок истекает ' + _v93Dmy_(dl), I: 3, iWhy: 'обязательное обучение', E: over ? 1 : _v93Expo_(h), eWhy: over ? 'уже сейчас' : 'до срока ' + Math.max(0, Math.round(h / 24)) + ' дн.',
      desc: 'Обучение «' + x.вид + '»: ' + x.сотрудник + ' — ' + (over ? 'просрочено' : 'истекает') + ' (до ' + _v93Dmy_(dl) + ')', action: 'Назначить обучение и внести запись в «Обучение»', money: null, conf: 'HIGH' }); }); } catch (e) {}
  // персонал: роли без сотрудника (V92)
  try { _v92Missing_(_v92Staffed_(), _v92Covers_()).forEach(function (m) { add({ type: 'STAFF_SHORTAGE', objectType: 'ROLE', objectId: m.roles.join(' / '), expected: day, P: 1, pWhy: 'в штате нет сотрудника с ролью и роль не закреплена', I: 2, iWhy: 'задачи «' + m.ru + '» без ответственного', E: 1, eWhy: 'сейчас',
    desc: 'ROLE_OWNER_NOT_CONFIGURED: ' + m.roles.join(' или ') + ' — ' + m.ru, action: 'Назначить сотрудника на роль или закрепить роль за другой («Моя смена» → «Ответственные роли»)', money: null, conf: 'HIGH' }); }); } catch (e) {}
  var v98 = null; try { if (typeof _v98Risks_ === 'function') v98 = _v98Risks_(day, cfg); } catch (e) {}   // V98: нехватка по графику смен
  if (v98) v98.forEach(function (x) { add(x); });
  else nc.push({ type: 'STAFF_SHORTAGE', why: 'нехватка по сменам не считается: график смен сотрудников не заполнен («График смен»); потребность по часам — только с нормой выработки (настройка)' });
  // незакрытие смены: переданные задачи не выполнены за 2 ч до окончания
  if (F._end.src.indexOf('расписание') === 0) {
    try { var open = _v92Recs_().filter(function (r) { return r.Status === 'TRANSFERRED'; }); if (open.length && endH <= 2) add({ type: 'SHIFT_NOT_CLOSED', objectType: 'SHIFT', objectId: 'смена ' + _v93Dmy_(day), expected: day, P: 1, pWhy: 'до окончания смены ' + _v93Num_(endH, 1) + ' ч, переданных задач не выполнено: ' + open.length,
      I: 2, iWhy: 'задачи смены остаются открытыми', E: 1, eWhy: 'до конца смены', desc: 'Смена может закрыться с невыполненными задачами: ' + open.slice(0, 5).map(function (r) { return r.Title; }).join('; '), action: 'Руководителю смены — проверить задачи в «Моя смена»', money: null, conf: 'HIGH' }); } catch (e) {}
  } else nc.push({ type: 'SHIFT_NOT_CLOSED', why: 'окончание смены не задано (расписание смен — в «Сменных письмах»); касса и ККТ в MON CHEF не ведутся' });
  // инвентаризация: расхождения ревизий (V49) за 30 дней — недостача и излишек по строкам, сумма по цене партии
  try {
    var revs = typeof _v49Rows_ === 'function' && _book_().getSheetByName('Ревизии_V49') ? _v49Rows_('Ревизии_V49', V49_H.DOC) : [], from30 = _v89AddDays_(day, -30), price = {};
    if (!revs.length) nc.push({ type: 'INVENTORY', why: 'ревизий (инвентаризаций) ещё не было — расхождение не с чем сравнить; ревизия — «Склад → Ревизии»' });
    else {
      R._ST.batches.forEach(function (b) { price[b.id] = b.price; });
      try { _stockBatchesSheet_().getDataRange().getValues().slice(1).forEach(function (r) { if (r[0] && price[String(r[0])] === undefined) price[String(r[0])] = parseFloat(r[6]) || 0; }); } catch (e) {}
      var lines = _book_().getSheetByName('Ревизии_Строки_V49') ? _v49Rows_('Ревизии_Строки_V49', V49_H.LINE) : [], recent = 0;
      revs.forEach(function (rv) {
        var rd = _v93Iso_(rv.DateTime); if (!rd || rd < from30) return; recent++;
        var L = lines.filter(function (l) { return String(l.RevisionID) === String(rv.RevisionID) && l.CountedQty !== '' && l.CountedQty !== null; });
        var bad = L.filter(function (l) { return Math.abs(Number(l.VarianceQty) || 0) > 1e-9; }); if (!L.length || !bad.length) return;
        var short = 0, extra = 0; bad.forEach(function (l) { var v = Number(l.VarianceQty) || 0, m = Math.abs(v) * (price[String(l.BatchID)] || 0); if (v < 0) short += m; else extra += m; });
        var money = short + extra, h = (Date.parse(rd) + 864e5 - nowMs) / 36e5;
        add({ type: 'INVENTORY', objectType: 'REVISION', objectId: String(rv.RevisionID), expected: rd, P: 1, pWhy: 'расхождение установлено ревизией от ' + _v93Dmy_(rd) + ': ' + bad.length + ' из ' + L.length + ' строк',
          I: _v93ImpactMoney_(money), iWhy: 'недостача ≈ ' + _v93Money_(short) + ', излишек ≈ ' + _v93Money_(extra) + ' (по цене партий)', E: 0.8, eWhy: 'разобрать в течение суток',
          desc: 'Ревизия ' + rv.RevisionID + ' от ' + _v93Dmy_(rd) + ': расхождение по ' + bad.length + ' строкам — ' + bad.slice(0, 4).map(function (l) { var q = Number(l.VarianceQty) || 0; return l.Product + ' ' + (q > 0 ? '+' : q < 0 ? '−' : '') + _v93Num_(Math.abs(q), 3) + ' ' + l.Unit; }).join('; '),
          action: 'Разобрать причины (не оформленные списания, пересорт, ошибки приёмки и продаж), провести корректировки ревизии с причиной', money: money, conf: 'HIGH',
          extra: [['Статус ревизии', String(rv.Status)], ['Строк с фактом', String(L.length)]] });
      });
      if (!recent) nc.push({ type: 'INVENTORY', why: 'ревизий за последние 30 дней нет — проведите ревизию («Склад → Ревизии»)' });
    }
  } catch (e) { nc.push({ type: 'INVENTORY', why: 'ревизии не прочитаны: ' + String(e.message || e) }); }
  return { risks: out, notComputed: nc };
}

/* ---------------- реестр: запись, видимость ---------------- */
function _v93Owner_(type) {
  var T = MC_V93_TYPES_[type], st = _v92Staffed_(), cv = _v92Covers_();
  for (var i = 0; i < T.owner.length; i++) { var r = T.owner[i]; if (st[r]) return { role: r, ok: true }; if (cv[r] && st[cv[r]]) return { role: cv[r], ok: true, via: r }; }
  return { role: 'Директор', ok: false, missing: T.owner.join(' / ') };
}
function _v93Persist_(D, op, who) {
  var rows = _v93Rows_(MC_V93_RISK_), open = {}, now = new Date(), day = _v71Day_(now), c = _v92Cfg_(), seen = {}, st = { added: 0, updated: 0 };
  rows.forEach(function (r) { if (/^(NEW|REVIEW|ACCEPTED)$/.test(String(r.Status))) open[String(r.RiskKey)] = r; });
  D.risks.forEach(function (x) {
    seen[x.key] = 1; var r = open[x.key], ow = _v93Owner_(x.type);
    var o = r || { _row: null, RiskID: _v93Id_('RSK'), Status: 'NEW', DetectedAt: now, RiskKey: x.key, HistoryJSON: '[]' };
    var changed = !r || Number(r.RiskScore) !== x.score || String(r.Description) !== x.desc;
    o.RiskType = x.type; o.OrganizationID = c.OrganizationID || ''; o.LocationID = c.LocationID || ''; o.ObjectType = x.objectType; o.ObjectID = x.objectId; o.Description = x.desc;
    o.Probability = x.P; o.Impact = x.I; o.Exposure = x.E; o.RiskScore = x.score; o.Confidence = x.conf || 'LOW'; o.Priority = x.prio; o.ExpectedDate = "'" + (x.expected || day);
    o.RecommendedAction = x.action; o.OwnerRole = ow.role + (ow.ok ? '' : ' (ROLE_OWNER_NOT_CONFIGURED: ' + ow.missing + ')'); o.FactorsJSON = JSON.stringify(x.factors); o.MoneyAtRisk = x.money === null || x.money === undefined ? '' : _v93R_(x.money);
    o.StillDetected = 'да'; o.LastCheckedAt = now; o.OperationID = op ? op.id : '';
    if (changed) { var h = r ? _v93Hist_(r) : []; h.push({ at: now.toISOString(), by: 'MON CHEF (расчёт' + (who ? ', открыл ' + who : '') + ')', action: r ? 'пересчитан' : 'обнаружен', score: x.score, p: x.P }); o.HistoryJSON = JSON.stringify(h.slice(-30)); }
    else o.HistoryJSON = r.HistoryJSON;
    if (r) o._row = r._row;
    _v93Write_(MC_V93_RISK_, MC_V93_RISK_HEAD_, o); if (r) st.updated++; else st.added++;
  });
  rows.forEach(function (r) { if (open[String(r.RiskKey)] && !seen[String(r.RiskKey)] && String(r.StillDetected) !== 'нет') { r.StillDetected = 'нет'; r.LastCheckedAt = now;
    var h = _v93Hist_(r); h.push({ at: now.toISOString(), by: 'MON CHEF (расчёт)', action: 'последний расчёт риск не подтверждает — закрыть может только ответственный' }); r.HistoryJSON = JSON.stringify(h.slice(-30)); _v93Write_(MC_V93_RISK_, MC_V93_RISK_HEAD_, r); } });
  return st;
}
function _v93Sees_(s, can, type, ownerRole) {
  if (can.boss) return true; var T = MC_V93_TYPES_[type] || { aud: [] }, role = _mcRbNormRole_(s.role);
  if (T.need && !_mcRbHasExact_(s, T.need)) return false;
  return T.aud.indexOf(role) >= 0 || String(ownerRole || '').indexOf(role) === 0;
}
function _v93MoneyOk_(can, type) { var T = MC_V93_TYPES_[type] || {}; if (!T.money) return true; return T.money === 'revenue' ? (can.revenue || can.cost) : can.cost; }
function _v93RiskView_(r, s, can) {
  var money = _v93MoneyOk_(can, r.RiskType), f = []; try { f = JSON.parse(r.FactorsJSON || '[]'); } catch (e) {}
  var strip = function (t) { return money ? String(t || '') : _v92NoMoney_(t); };
  return { riskId: String(r.RiskID), type: String(r.RiskType), typeRu: (MC_V93_TYPES_[r.RiskType] || {}).ru || r.RiskType, objectType: String(r.ObjectType), objectId: String(r.ObjectID), desc: strip(r.Description),
    p: Number(r.Probability), impact: Number(r.Impact), exposure: Number(r.Exposure), score: Number(r.RiskScore), conf: String(r.Confidence), confRu: MC_V93_CONF_RU_[r.Confidence] || r.Confidence,
    prio: String(r.Priority), prioRu: MC_V93_PRIO_RU_[r.Priority] || r.Priority, detectedAt: r.DetectedAt instanceof Date ? r.DetectedAt.toISOString() : String(r.DetectedAt || ''), expected: _v93Iso_(r.ExpectedDate),
    action: strip(r.RecommendedAction), owner: String(r.OwnerRole), status: String(r.Status), statusRu: MC_V93_RST_RU_[r.Status] || r.Status, comment: String(r.DecisionComment || ''),
    resolvedBy: String(r.ResolvedBy || ''), resolvedAt: r.ResolvedAt instanceof Date ? r.ResolvedAt.toISOString() : String(r.ResolvedAt || ''), still: String(r.StillDetected || ''),
    money: money && r.MoneyAtRisk !== '' ? Number(r.MoneyAtRisk) : null, moneyHidden: !money, factors: f.map(function (x) { return [x[0], strip(x[1])]; }), history: _v93Hist_(r).slice(-10),
    evidence: r.EvidenceFileID ? String(r.EvidenceHash || '').slice(0, 12) : '', opId: String(r.OperationID || '') };
}

/* ---------------- проекты акций: расчёт, запреты ---------------- */
function _v93Split_(x) { return String(x || '').split(/[;\n]+/).map(function (t) { return t.trim(); }).filter(String); }
/** Среднее продаж блюда в день d по тем же дням недели прошлых недель; только продажи со временем в [lo, hi) (без времени — как конец дня). */
function _v93DayMean_(K, dishKey, d, lo, hi) {
  var F = K.F, a = [];
  for (var k = 1; k <= K.cfg.weeks; k++) { var src = _v89AddDays_(d, -7 * k); if (src >= F.day || (F._first && src < F._first)) continue; if (!F._open[src]) continue;
    var q = 0; F._S.rows.forEach(function (r) { if (r.ch !== 'hall' || r.key !== dishKey || r.day !== src) return; var m = r.min === null ? 1439 : r.min; if (m >= lo && m < hi) q += r.qty; }); a.push(q); }
  var st = _v93Stat_(a); return st ? { mean: st.mean, n: st.n } : { mean: 0, n: 0 };
}
/** Обычные продажи блюда за период (без акции): сегодня — оставшаяся часть дня, дальше — средние тех же дней недели. */
function _v93Baseline_(K, dishKey, from, to) {
  var t = 0, n = 0;
  for (var d = from; d <= to; d = _v89AddDays_(d, 1)) { var x = _v93DayMean_(K, dishKey, d, d === K.F.day ? K.F._nowMin : 0, 1440); t += x.mean; n = Math.max(n, x.n); }
  return { qty: _v93R_(t, 1), n: n };
}
function _v93PromoCalc_(p, K) {
  var cfg = K.cfg, today = K.F.day, idx = K.idx, X = { dishes: [], bans: [], warnings: [] }, ban = function (code, text, ex) { X.bans.push({ code: code, text: text, exception: ex || '' }); };
  var from = _v93Iso_(p.PeriodFrom), to = _v93Iso_(p.PeriodTo), type = String(p.PromotionType || ''), disc = p.DiscountPercent === '' || p.DiscountPercent === null || p.DiscountPercent === undefined ? null : Number(p.DiscountPercent);
  var price0 = p.ProposedPrice === '' || p.ProposedPrice === null || p.ProposedPrice === undefined ? null : Number(p.ProposedPrice), dishes = _v93Split_(p.TargetDishes), batches = _v93Split_(p.BatchIDs), prods = _v93Split_(p.TargetProducts);
  if (!cfg.promoReady) ban('CONFIGURATION_REQUIRED', 'правила не заданы: минимальная маржа и максимальная скидка (экран «Прогнозы, риски и акции» → «Правила»)');
  if (!from || !to) ban('NO_PERIOD', 'не указан период акции'); else if (to < from) ban('NO_PERIOD', 'период: окончание раньше начала'); else if (to < today) ban('PERIOD_PASSED', 'период акции уже прошёл');
  if (!String(p.LocationID || '').trim()) ban('NO_LOCATION', 'не указана площадка');
  if (!String(p.Responsible || '').trim()) ban('NO_OWNER', 'не указан ответственный');
  if (MC_V93_PTYPES_.indexOf(type) < 0) ban('VALIDATION', 'тип акции: ' + MC_V93_PTYPES_.join(', '));
  if (type === 'персональное предложение') ban('PERSONAL_NO_DATA', 'в MON CHEF нет базы гостей и согласий на рассылку — персональное предложение не готовится');
  if (!dishes.length) ban('NO_TARGET', 'не указаны блюда');
  if (price0 !== null && dishes.length > 1) ban('VALIDATION', 'специальная цена задаётся для одного блюда; для нескольких — скидка в процентах');
  // партии: просрочка, карантин, блокировка, наличие
  var ST = K.R._ST, bmap = {}; ST.batches.forEach(function (b) { bmap[b.id] = b; });
  var bv = null; batches.forEach(function (id) {
    var b = bmap[id]; if (!b) { bv = bv || _stockBatchesSheet_().getDataRange().getValues(); var row = bv.filter(function (r) { return String(r[0]) === id; })[0];
      ban('BATCH_UNAVAILABLE', 'партия ' + id + (row ? ' израсходована или списана (статус «' + String(row[10] || '') + '»)' : ' не найдена')); return; }
    if (b.expiry && b.expiry < today) ban('EXPIRED_BATCH', 'партия ' + id + ' («' + b.product + '») просрочена — годен до ' + _v93Dmy_(b.expiry));
    else if (b.expiry && to && b.expiry < to) X.warnings.push('партия ' + id + ' годна до ' + _v93Dmy_(b.expiry) + ' — раньше окончания акции (' + _v93Dmy_(to) + '): после срока продавать нельзя');
    if (b.status === 'quarantine') ban('QUARANTINE_BATCH', 'партия ' + id + ' на входном контроле (карантин)'); if (b.status === 'blocked') ban('BLOCKED_BATCH', 'партия ' + id + ' заблокирована');
  });
  // блюда: ТТК, цена, подтверждённая себестоимость
  var expSales = p.ExpectedSales === '' || p.ExpectedSales === null || p.ExpectedSales === undefined ? null : Number(p.ExpectedSales), rev = 0, cogs = 0, cann = 0, base = 0, minMargin = null, sumBase = 0;
  dishes.forEach(function (name, i) {
    var dish = _v88Dish_(name, idx), k = dish ? _normNameServer_(dish.name) : _normNameServer_(name), c = K.R._CC.C[k];
    if (!dish || !c || !c.L.length) { ban('TTK_NOT_FOUND', 'блюдо «' + name + '» не найдено в ТТК (нет состава) — акция по ТТК не проверяется'); return; }
    var lp = K.lp[_normNameServer_(dish.name)] || K.lp[_normNameServer_(name)], bp = lp ? lp.price : null, ec = K.E.dish[_normNameServer_(dish.name)], cost = ec && ec.cpp !== null ? ec.cpp : null;
    if (bp === null || !(bp > 0)) ban('NO_PRICE', '«' + dish.name + '»: нет цены продажи в журнале продаж — данных для расчёта недостаточно');
    if (cost === null) ban('NO_CONFIRMED_COST', '«' + dish.name + '»: нет подтверждённой себестоимости (фактическая по продажам за 28 дней, V64)');
    var price = price0 !== null ? price0 : bp !== null && disc !== null ? bp * (1 - disc / 100) : bp, d = price0 !== null && bp ? (1 - price0 / bp) * 100 : disc || 0;
    var bl = from && to ? _v93Baseline_(K, k, from < today ? today : from, to) : { qty: 0, n: 0 };
    var o = { dish: dish.name, key: k, basePrice: bp, price: price === null ? null : _v93R_(price), discount: _v93R_(d, 1), cost: cost === null ? null : _v93R_(cost),
      costSrc: ec ? 'фактическая по V64: продаж ' + ec.n + ', порций ' + _v93Num_(ec.qty, 1) + ' (' + _v93Dmy_(K.E.from) + ' – ' + _v93Dmy_(K.E.to) + ')' + (ec.unknown ? '; продаж без подтверждённой себестоимости — ' + ec.unknown + ', в расчёт не взяты' : '') : 'нет',
      margin: price && cost !== null ? _v93R_((price - cost) / price * 100, 1) : null, baseline: bl.qty, baselineN: bl.n };
    X.dishes.push(o);
    if (o.margin !== null) { minMargin = minMargin === null ? o.margin : Math.min(minMargin, o.margin);
      if (o.margin < 0) ban('NEGATIVE_MARGIN', '«' + dish.name + '»: отрицательная маржа (' + _v93Num_(o.margin, 1) + ' %) — по умолчанию запрещено; только директор, не автор, с отдельным подтверждением', 'NEGATIVE');
      else if (cfg.minMarginPct !== null && o.margin < cfg.minMarginPct) ban('BELOW_MIN_MARGIN', '«' + dish.name + '»: маржа ' + _v93Num_(o.margin, 1) + ' % ниже минимальной ' + cfg.minMarginPct + ' % — только исключение с причиной, утверждает не автор', 'EXCEPTION'); }
    if (cfg.maxDiscountPct !== null && o.discount > cfg.maxDiscountPct + 1e-9) ban('DISCOUNT_ABOVE_MAX', '«' + dish.name + '»: скидка ' + _v93Num_(o.discount, 1) + ' % больше максимальной ' + cfg.maxDiscountPct + ' % — только исключение с причиной, утверждает не автор', 'EXCEPTION');
    sumBase += bl.qty;
  });
  // ожидаемые продажи: цель (AI) или ввод; иначе — обычные продажи
  var es = expSales !== null && isFinite(expSales) ? expSales : _v93R_(sumBase, 1);
  X.dishes.forEach(function (o) { var share = sumBase > 0 ? o.baseline / sumBase : 1 / Math.max(1, X.dishes.length), q = es * share; o.expected = _v93R_(q, 1);
    if (o.price !== null) rev += q * o.price; if (o.cost !== null) cogs += q * o.cost; if (o.basePrice !== null && o.price !== null) cann += o.baseline * (o.basePrice - o.price); });
  X.expectedSales = _v93R_(es, 1); X.baseline = _v93R_(sumBase, 1); X.revenue = _v93R_(rev); X.cogs = _v93R_(cogs); X.marginRub = _v93R_(rev - cogs); X.marginPct = minMargin;
  X.cannibal = { rub: _v93R_(cann), level: es > 0 ? (sumBase / es >= 0.5 ? 'ВЫСОКИЙ' : sumBase / es >= 0.2 ? 'СРЕДНИЙ' : 'НИЗКИЙ') : 'НЕТ ДАННЫХ' };
  X.cannibalText = X.cannibal.level + (sumBase > 0 ? ': обычные продажи ≈ ' + _v93Num_(sumBase, 1) + ' порц. пойдут по сниженной цене (−' + _v92Money_(cann) + ')' : ': обычных продаж блюда за период нет');
  // резерв для заказов и банкетов; нехватка других продуктов
  var need = _v93Need_((function () { var m = {}; X.dishes.forEach(function (o) { m[o.key] = (m[o.key] || 0) + o.expected; }); return m; })(), K.R._CC, K.R._avail, false), res = K.R._ST && _v89Reserved_(), short = [];
  Object.keys(need.raw).forEach(function (k) { var a = K.R._avail[k] || 0, total = (K.R._ST.byKey[k] || {}).avail || 0; if (res[k] && total - res[k] < need.raw[k] && prods.concat(batches.map(function (id) { return (bmap[id] || {}).product || ''; })).some(function (pn) { return _prodKey_(pn) === k.split('|')[0]; }))
      ban('RESERVED_FOR_ORDER', '«' + need.names[k] + '» зарезервирован для заказа или банкета (' + _v88Fmt_(res[k], k.split('|')[1]) + ') — без него не хватает на акцию');
    if (need.raw[k] > a + 1e-6) short.push(need.names[k] + ': нужно ' + _v88Fmt_(need.raw[k], k.split('|')[1]) + ', доступно ' + _v88Fmt_(a, k.split('|')[1])); });
  X.deficit = short.length ? 'да — ' + short.join('; ') : 'нет (по остаткам на складе)';
  if (short.length) X.warnings.push('может не хватить: ' + short.join('; '));
  X.bans.forEach(function (b) { b.hard = !b.exception; });
  X.hard = X.bans.filter(function (b) { return b.hard; }); X.exceptions = X.bans.filter(function (b) { return !b.hard; });
  X.minRule = cfg.minMarginPct === null ? 'не задано' : 'маржа не ниже ' + cfg.minMarginPct + ' %, скидка не больше ' + cfg.maxDiscountPct + ' % (правила акций; исключение — с причиной, утверждает не автор)';
  X.stop = ['маржа по факту ниже ' + (cfg.minMarginPct === null ? 'минимальной' : cfg.minMarginPct + ' %'), 'убыток (отрицательная маржа)', 'продажи за первые сутки не выше обычных', 'товар заканчивается быстрее прогноза',
    'партия заблокирована, на карантине или просрочена — ' + (cfg.emergency && cfg.emergency.on ? 'аварийная остановка системой (правило утверждено)' : 'предложение остановить (аварийное правило не утверждено)')].join('; ');
  return X;
}
function _v93PromoApply_(o, X, cfg) {
  o.ExpectedSales = X.expectedSales; o.ExpectedRevenue = X.revenue; o.ExpectedCOGS = X.cogs; o.ExpectedMargin = X.marginRub; o.MarginPct = X.marginPct === null ? '' : X.marginPct;
  o.CannibalizationRisk = X.cannibalText; o.MinimumMarginRule = X.minRule; o.DeficitRisk = X.deficit; o.StopConditions = X.stop; o.BaselineSales = X.baseline;
  o.BasePrice = X.dishes.length === 1 && X.dishes[0].basePrice !== null ? X.dishes[0].basePrice : ''; o.UnitCost = X.dishes.length === 1 && X.dishes[0].cost !== null ? X.dishes[0].cost : '';
  o.CostSource = X.dishes.map(function (d) { return d.dish + ': ' + d.costSrc; }).join('; '); o.BansJSON = JSON.stringify(X.bans); o.UpdatedAt = new Date();
  return o;
}
function _v93PromoView_(p, K, can) {
  var X = _v93PromoCalc_(p, K), money = can.cost, act = null; try { act = JSON.parse(p.ActualJSON || 'null'); } catch (e) {}
  var hideM = function (v) { return money ? v : null; };
  return { id: String(p.PromotionDraftID), name: String(p.Name), location: String(p.LocationID), from: _v93Iso_(p.PeriodFrom), to: _v93Iso_(p.PeriodTo), products: String(p.TargetProducts || ''), dishes: String(p.TargetDishes || ''),
    channel: String(p.TargetChannel || ''), type: String(p.PromotionType), price: hideM(p.ProposedPrice === '' ? null : Number(p.ProposedPrice)), discount: p.DiscountPercent === '' ? null : Number(p.DiscountPercent),
    expectedSales: Number(p.ExpectedSales) || 0, baseline: Number(p.BaselineSales) || 0, targetExtra: p.TargetExtra === '' ? null : Number(p.TargetExtra), revenue: hideM(Number(p.ExpectedRevenue)), cogs: hideM(Number(p.ExpectedCOGS)),
    margin: hideM(Number(p.ExpectedMargin)), marginPct: money && p.MarginPct !== '' ? Number(p.MarginPct) : null, writeoffReduction: hideM(p.ExpectedWriteoffReduction === '' ? null : Number(p.ExpectedWriteoffReduction)),
    cannibal: money ? String(p.CannibalizationRisk || '') : _v92NoMoney_(p.CannibalizationRisk), minRule: String(p.MinimumMarginRule || ''), reason: money ? String(p.Reason || '') : _v92NoMoney_(p.Reason), problem: money ? String(p.Problem || '') : _v92NoMoney_(p.Problem),
    confidence: String(p.Confidence || ''), status: String(p.Status), statusRu: MC_V93_PST_RU_[p.Status] || p.Status, ai: String(p.CreatedByAI) === 'да', approvedBy: String(p.ApprovedBy || ''), approvedAt: p.ApprovedAt instanceof Date ? p.ApprovedAt.toISOString() : String(p.ApprovedAt || ''),
    batches: String(p.BatchIDs || ''), deficit: String(p.DeficitRisk || ''), stop: String(p.StopConditions || ''), responsible: String(p.Responsible || ''), author: String(p.Author || ''), exceptionReason: String(p.ExceptionReason || ''), exceptionBy: String(p.ExceptionBy || ''),
    stopSuggested: String(p.StopSuggested || ''), stopReason: String(p.StopReason || ''), publishedAt: p.PublishedAt instanceof Date ? p.PublishedAt.toISOString() : String(p.PublishedAt || ''), publishedBy: String(p.PublishedBy || ''), completedBy: String(p.CompletedBy || ''),
    actual: act && !money ? { qty: act.qty, baseline: act.baseline, uplift: act.uplift, progress: act.progress, batch: act.batch, suggestions: (act.suggestions || []).map(_v92NoMoney_) } : act,
    calc: { dishes: X.dishes.map(function (d) { return { dish: d.dish, basePrice: hideM(d.basePrice), price: hideM(d.price), discount: d.discount, cost: hideM(d.cost), costSrc: money ? d.costSrc : (d.cost === null ? 'нет' : 'подтверждена (V64)'), margin: money ? d.margin : null, baseline: d.baseline, expected: d.expected }; }),
      bans: X.bans.map(function (b) { return { code: b.code, text: money ? b.text : _v92NoMoney_(b.text), hard: b.hard }; }), warnings: X.warnings, hard: X.hard.length, exceptions: X.exceptions.length },
    history: _v93Hist_(p).slice(-20), opId: String(p.OperationID || ''), riskId: String(p.RiskID || '') };
}

/* ---------------- контекст расчёта ---------------- */
/** Расчёт: прогноз, склад, экономика V64 за 28 дней, обнаружение рисков. lite — только прогноз и склад («Моя смена», письма). */
function _v93Ctx_(nowMs, lite) {
  nowMs = nowMs || Date.now(); var idx = _buildDishIndexes_(), F = _v93Forecast_(nowMs), R = _v93StockCalc_(F, nowMs, idx);
  var K = { nowMs: nowMs, idx: idx, F: F, R: R, cfg: _v93Cfg_(), lp: _v93LastPrice_(F._S) };
  if (!lite) { K.E = _v93Econ_(F.day, 28); K.D = _v93Detect_(nowMs, K); }
  return K;
}
var _V93_REQ_ = null;   // расчёт на один запрос (V87 «Моя смена»: карточки и блоки)
function _v93CtxCached_() { if (_V93_REQ_ && _V93_REQ_.K) return _V93_REQ_.K; var K = _v93Ctx_(Date.now(), true); if (_V93_REQ_) _V93_REQ_.K = K; return K; }

/* ---------------- сопровождение акций: факт, предложения остановить, аварийное правило ---------------- */
function _v93PromoActual_(p, K) {
  var from = _v93Iso_(p.PeriodFrom), to = _v93Iso_(p.PeriodTo), today = K.F.day, pub = p.PublishedAt instanceof Date ? _v71Day_(p.PublishedAt) : _v93Iso_(p.PublishedAt) || from;
  var f = from > pub ? from : pub, t = to < today ? to : today, dishes = _v93Split_(p.TargetDishes).map(function (n) { var d = _v88Dish_(n, K.idx); return d ? _normNameServer_(d.name) : _normNameServer_(n); });
  var A = { from: f, to: t, qty: 0, revenue: 0, cost: 0, costKnown: 0, n: 0 }, pubMin = p.PublishedAt instanceof Date ? _v87Min_(Utilities.formatDate(p.PublishedAt, _mcTz_(), 'HH:mm')) : 0;
  var pubMs = p.PublishedAt instanceof Date ? Math.floor(p.PublishedAt.getTime() / 1000) * 1000 : null;   // в таблице время с точностью до секунды
  K.F._S.rows.forEach(function (r) { if (r.ch !== 'hall' || dishes.indexOf(r.key) < 0 || r.day < f || r.day > t) return; if (r.day === pub && (pubMs && r.at ? r.at < pubMs : r.min !== null && r.min < pubMin)) return;
    A.qty += r.qty; A.revenue += r.sum || 0; A.n++; var e = K.E.sales['J36-' + r.n]; if (e && e.known) { A.cost += e.cost; A.costKnown++; } });
  var bl = 0; dishes.forEach(function (k) { for (var d = f; d <= t; d = _v89AddDays_(d, 1)) { var lo = d === pub ? pubMin : 0, hi = d === today ? K.F._nowMin : 1440; if (hi > lo) bl += _v93DayMean_(K, k, d, lo, hi).mean; } });
  A.baseline = _v93R_(bl, 1); A.uplift = A.baseline > 0 ? _v93R_(A.qty / A.baseline - 1, 3) : null; A.progress = Number(p.ExpectedSales) > 0 ? _v93R_(A.qty / Number(p.ExpectedSales), 3) : null;
  A.marginPct = A.costKnown && A.revenue > 0 ? _v93R_((A.revenue - A.cost) / A.revenue * 100, 1) : null; A.revenue = _v93R_(A.revenue); A.cost = _v93R_(A.cost);
  var bmap = {}, bad = [], left = []; K.R._ST.batches.forEach(function (b) { bmap[b.id] = b; });
  _v93Split_(p.BatchIDs).forEach(function (id) { var b = bmap[id]; if (!b) { left.push(id + ': израсходована или списана'); return; } left.push(id + ': остаток ' + _v88Fmt_(b.base, b.bu) + ', годен до ' + _v93Dmy_(b.expiry));
    if (b.status === 'blocked' || b.status === 'quarantine') bad.push('партия ' + id + (b.status === 'blocked' ? ' заблокирована' : ' на карантине')); else if (b.expiry && b.expiry < today) bad.push('партия ' + id + ' просрочена'); });
  A.batch = left.join('; '); A.emergency = bad;
  var sg = [], cfg = K.cfg, el = _v88DayDiff_(t, f) + 1;
  if (A.marginPct !== null && cfg.minMarginPct !== null && A.marginPct < cfg.minMarginPct) sg.push('фактическая маржа ' + _v93Num_(A.marginPct, 1) + ' % ниже минимальной ' + cfg.minMarginPct + ' %');
  if (A.marginPct !== null && A.marginPct < 0) sg.push('акция приводит к убытку');
  if (A.baseline > 0 && A.qty <= A.baseline && (el >= 2 || (t === today && K.F._nowMin >= 18 * 60) || (t > f))) sg.push('спрос не увеличился: продано ' + _v93Num_(A.qty, 1) + ' порц. при обычных ≈ ' + _v93Num_(A.baseline, 1));
  if (_v93Split_(p.BatchIDs).length && left.every(function (x) { return /израсходована/.test(x); }) && t < to) sg.push('товар закончился раньше срока акции — цель достигнута, акцию можно завершить');
  bad.forEach(function (x) { sg.push('санитарный или складской риск: ' + x); });
  A.suggestions = sg; A.at = new Date(K.nowMs).toISOString();
  return A;
}
/** Обслуживание акций при расчёте: истёкшие проекты, завершение по окончании периода, факт и предложения, аварийная остановка. */
function _v93PromoHousekeep_(K, op) {
  var today = K.F.day, now = new Date(), cfg = K.cfg, out = { expired: 0, completed: 0, emergency: 0, suggested: 0 };
  _v93Rows_(MC_V93_PROMO_).forEach(function (p) {
    var st = String(p.Status), to = _v93Iso_(p.PeriodTo), h = _v93Hist_(p), ch = false;
    if (/^(DRAFT|REVIEW|APPROVED)$/.test(st) && to && to < today) { p.Status = 'EXPIRED'; h.push({ at: now.toISOString(), by: 'MON CHEF', action: 'срок прошёл — акция не публиковалась' }); ch = true; out.expired++; }
    else if (st === 'PUBLISHED') {
      var A = _v93PromoActual_(p, K); p.ActualJSON = JSON.stringify(A); ch = true;
      if (A.emergency.length && cfg.emergency && cfg.emergency.on) { p.Status = 'COMPLETED'; p.CompletedAt = now; p.CompletedBy = 'MON CHEF — аварийное правило (утвердил ' + cfg.emergency.by + ')'; p.StopReason = 'EMERGENCY_STOP: ' + A.emergency.join('; ');
        h.push({ at: now.toISOString(), by: 'MON CHEF (аварийное правило)', action: 'акция остановлена: ' + A.emergency.join('; ') }); out.emergency++;
        try { _audit_(op, 'V93_PROMO_EMERGENCY_STOP', MC_V93_PROMO_, String(p.PromotionDraftID), 'PUBLISHED', { status: 'COMPLETED', reason: p.StopReason }); } catch (e) {} }
      else if (to && to < today) { p.Status = 'COMPLETED'; p.CompletedAt = now; p.CompletedBy = 'MON CHEF'; p.StopReason = 'период акции закончился'; h.push({ at: now.toISOString(), by: 'MON CHEF', action: 'период закончился — акция завершена, итог сохранён' }); out.completed++; }
      else { var s2 = A.suggestions.join('; '); if (s2 !== String(p.StopSuggested || '')) { p.StopSuggested = s2; if (s2) { h.push({ at: now.toISOString(), by: 'MON CHEF', action: 'предложение остановить или изменить: ' + s2 }); out.suggested++; } } }
    }
    if (ch) { p.HistoryJSON = JSON.stringify(h.slice(-40)); p.UpdatedAt = now; _v93Write_(MC_V93_PROMO_, MC_V93_PROMO_HEAD_, p); }
  });
  return out;
}
/** Снимок прогноза дня (один раз в день) — для «отклонение факта от прогноза». */
function _v93SaveForecast_(K, op) {
  var F = K.F; if (F.status !== 'OK') return 0;
  var have = _v93Rows_(MC_V93_FC_).some(function (r) { return _v93Iso_(r.Day) === F.day; }); if (have) return 0;
  var sh = _v92Sh_(MC_V93_FC_, MC_V93_FC_HEAD_), now = new Date(), rows = [];
  var push = function (obj, kind, s) { rows.push([_v93Id_('FC'), "'" + F.day, obj, kind, s.value, s.low, s.high, s.conf, s.n, "'" + (F.history.from || ''), "'" + F.history.to, 'среднее тех же дней недели (' + K.cfg.weeks + ' нед.)', now, op ? op.id : '']); };
  push('ИТОГО: порции', 'PORTIONS', F.totals.portions); push('ИТОГО: выручка', 'REVENUE', F.totals.revenue); push('ИТОГО: строки продаж', 'ORDERS', F.totals.orders);
  F.dishes.forEach(function (d) { push(d.dish, 'DISH', d); });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, MC_V93_FC_HEAD_.length).setValues(rows);
  return rows.length;
}
function _v93LastDay_(K) {
  var y = _v89AddDays_(K.F.day, -1), R = _v93Rows_(MC_V93_FC_).filter(function (r) { return _v93Iso_(r.Day) === y; }); if (!R.length) return { day: y, rows: [], note: 'прогноз на ' + _v93Dmy_(y) + ' не сохранялся' };
  var fact = { PORTIONS: 0, REVENUE: 0, ORDERS: 0 }, dish = {};
  K.F._S.rows.forEach(function (r) { if (r.ch !== 'hall' || r.day !== y) return; fact.PORTIONS += r.qty; fact.REVENUE += r.sum || 0; fact.ORDERS++; dish[r.key] = (dish[r.key] || 0) + r.qty; });
  return { day: y, rows: R.map(function (r) { var f = r.Kind === 'DISH' ? dish[_normNameServer_(r.Object)] || 0 : fact[r.Kind], v = Number(r.Value);
    return { object: String(r.Object), kind: String(r.Kind), forecast: v, low: Number(r.Low), high: Number(r.High), fact: _v93R_(f), dev: v > 0 ? _v93R_(f / v - 1, 4) : null, inRange: f >= Number(r.Low) && f <= Number(r.High) }; }) };
}

/* ---------------- данные экрана ---------------- */
/** Прогноз, риски, акции — по роли. Расчёт заносит риски в реестр (только новые и пересчёт; закрывает только человек) и обслуживает акции. */
function v93Data(token) {
  var op = null; try { op = _beginOp_(token, 'ai_view|risk_manage|promo_manage|promo_approve', 'V93_DATA', 'AI-прогноз', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var s = op.session, can = _v93Can_(s), K = _v93Ctx_(Date.now()), who = _v93Who_(op), st = null, hk = null, saved = 0;
    if (!s.dev) _withLock_(function () { st = _v93Persist_(K.D, op, who); hk = _v93PromoHousekeep_(K, op); saved = _v93SaveForecast_(K, op); });
    var F = K.F, R = K.R, money = can.cost, rev = can.revenue || can.cost;
    var fc = { status: F.status, day: F.day, wdRu: F.wdRu, missing: F.missing, method: F.method, source: F.source, history: { from: F.history.from, to: F.history.to, days: F.history.days, obs: F._obs, weeks: F.history.weeks },
      limitations: F.limitations, decision: F.decision, nowHM: F.nowHM, endHM: F.endHM, endSrc: F.endSrc, updatedAt: F.updatedAt, timeNote: F.timeNote, byHour: F.byHour, byWeekday: F.byWeekday,
      confWhy: _v93ConfWhy_(_v93Stat_(F.totals.portions._tot)),
      dishes: F.dishes.map(function (d) { return { dish: d.dish, value: d.value, low: d.low, high: d.high, conf: d.conf, confRu: d.confRu, remain: d.remain, remainLow: d.remainLow, remainHigh: d.remainHigh, fact: d.fact, expected: d.expected, dev: d.dev, trend: d.trend, n: d.n, cv: d.cv }; }),
      portions: _v93Pub_(F.totals.portions), orders: _v93Pub_(F.totals.orders), revenue: rev ? _v93Pub_(F.totals.revenue) : null, revenueHidden: !rev,
      budget: rev && F.budget ? { plan: F.budget.plan, dev: F.budget.dev, pBelow: F.budget.pBelow, how: F.budget.how } : null, staff: can.staff ? F.staff : null,
      channels: F.bySite ? [{ ch: 'зал', status: F.status, note: 'прогноз по журналу продаж (столбец «Канал продаж»)' }, { ch: 'доставка', status: F.bySite.some(function (x) { return x.channel === 'DELIVERY'; }) ? F.status : 'НЕТ ДАННЫХ', note: F.bySite.some(function (x) { return x.channel === 'DELIVERY'; }) ? 'прогноз по продажам с каналом «доставка»' : 'продаж с каналом «доставка» в журнале нет' },
        { ch: 'банкеты', status: 'ПО ЗАКАЗАМ', note: 'объём известен из заказов банкетов, не прогнозируется' }, { ch: 'сайт, агрегаторы', status: 'НЕТ ДАННЫХ', note: 'выгрузок агрегаторов нет — продажи доставки вносятся в журнал с каналом «доставка»' }] :
        [{ ch: 'зал', status: F.status, note: 'прогноз по журналу продаж' }, { ch: 'банкеты', status: 'ПО ЗАКАЗАМ', note: 'объём известен из заказов банкетов, не прогнозируется' }, { ch: 'доставка, сайт, агрегаторы', status: 'НЕТ ДАННЫХ', note: 'каналы в журнале продаж не записываются' }],
      locations: F.bySite ? 'по площадкам и каналам — таблица ниже; продажи до V97 — основная площадка, зал' : 'НЕТ ДАННЫХ — в журнале продаж нет площадки; прогноз по текущей площадке',
      bySite: F.bySite ? F.bySite.map(function (x) { var o = JSON.parse(JSON.stringify(x)); if (!rev) { o.revenue = null; o.factRevenue = null; } return o; }) : null,
      deficits: R.deficits.map(function (d) { var o = JSON.parse(JSON.stringify(d)); if (!rev) o.money = null; return o; }), pfMake: R.pfMake, notes: R.notes,
      writeoff: can.stock || can.boss || can.cost ? R.writeoff.map(function (w) { var o = { batchId: w.batchId, product: w.product, remText: w.remText, expiry: w.expiry, hours: w.hours, p: w.p, n: w.n, leftText: w.leftText, dishes: w.dishes, why: w.why, conf: w.conf, status: w.status || 'OK' }; if (money) { o.value = w.value; o.leftValue = w.leftValue; } return o; }) : null,
      needs: can.proc || can.boss ? R.needs : null, surplus: can.stock || can.proc || can.boss ? R.surplus : null, lastDay: _v93LastDay_(K) };
    if (!rev) fc.lastDay.rows = fc.lastDay.rows.filter(function (r) { return r.kind !== 'REVENUE'; });
    var risks = _v93Rows_(MC_V93_RISK_).filter(function (r) { return _v93Sees_(s, can, r.RiskType, r.OwnerRole); }).map(function (r) { return _v93RiskView_(r, s, can); })
      .sort(function (a, b) { var o = function (x) { return /NEW|REVIEW|ACCEPTED/.test(x.status) ? 0 : 1; }; return o(a) - o(b) || ['CRITICAL', 'IMPORTANT', 'NORMAL'].indexOf(a.prio) - ['CRITICAL', 'IMPORTANT', 'NORMAL'].indexOf(b.prio) || b.score - a.score; });
    var promos = (can.manage || can.approve || can.boss || _mcRbHasExact_(s, 'prod_manage|costs')) ? _v93Rows_(MC_V93_PROMO_).map(function (p) { return _v93PromoView_(p, K, can); }).reverse() : [];
    var cfg = K.cfg;
    _endOp_(op);
    return _ok_({ can: can, role: _mcRbNormRole_(s.role), forecast: fc, risks: risks, notComputed: K.D.notComputed.map(function (x) { return { type: x.type, typeRu: MC_V93_TYPES_[x.type].ru, why: x.why }; }),
      model: { impact: can.cost || can.revenue ? MC_V93_IMPACT_TXT_ : 'ущерб 1–5 по сумме под риском (пороги в рублях — при праве на суммы); просрочка на складе и санитарный риск — 5; обучение и поставка — 3; персонал и полнота данных — 2', exposure: MC_V93_EXPO_TXT_, prio: MC_V93_PRIO_TXT_, minP: cfg.riskMinP }, promos: promos, types: MC_V93_PTYPES_,
      cfg: { minMarginPct: cfg.minMarginPct, maxDiscountPct: cfg.maxDiscountPct, minHistoryDays: cfg.minHistoryDays, minObs: cfg.minObs, weeks: cfg.weeks, horizonDays: cfg.horizonDays, riskMinP: cfg.riskMinP,
        marginDropPp: cfg.marginDropPp, costRisePct: cfg.costRisePct, revenueDropPct: cfg.revenueDropPct, staffNorm: cfg.staffNorm, emergency: cfg.emergency, promoReady: cfg.promoReady, updatedBy: cfg.updatedBy, updatedAt: cfg.updatedAt },
      location: _v92Cfg_().LocationID, run: { risks: st, promos: hk, forecastSaved: saved } }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v93Pub_(x) { return { value: x.value, low: x.low, high: x.high, conf: x.conf, confRu: x.confRu, remain: x.remain, remainLow: x.remainLow, remainHigh: x.remainHigh, fact: x.fact, expected: x.expected, dev: x.dev, trend: x.trend, n: x.n, cv: x.cv, note: x.note || '' }; }

/* ---------------- решения по рискам ---------------- */
function v93RiskDecide(json, token) {
  var op = null; try { op = _beginOp_(token, 'risk_manage', 'V93_RISK_DECIDE', 'AI-риски', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v93J_(json), s = op.session, can = _v93Can_(s), to = String(d.status || ''), cm = String(d.comment || '').trim();
    if (['REVIEW', 'ACCEPTED', 'MITIGATED', 'REJECTED', 'EXPIRED'].indexOf(to) < 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Решение: на проверку, принять, снижен, отклонить или срок прошёл', op.id); }
    var r = _v93Rows_(MC_V93_RISK_).filter(function (x) { return String(x.RiskID) === String(d.riskId); })[0];
    if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Риск не найден', op.id); }
    if (!_v93Sees_(s, can, r.RiskType, r.OwnerRole)) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Этот риск ведёт другая роль: ' + r.OwnerRole, op.id); }
    if (/^(MITIGATED|REJECTED|EXPIRED)$/.test(String(r.Status))) { _endOp_(op, 'FAILED'); return _fail_('ALREADY_CLOSED', 'Риск уже закрыт: ' + MC_V93_RST_RU_[r.Status], op.id); }
    var closing = /^(MITIGATED|REJECTED|EXPIRED)$/.test(to);
    if ((closing || to === 'ACCEPTED') && cm.length < 5) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Напишите комментарий: какие меры приняты или почему риск не актуален', op.id); }
    var f = d.evidence ? _v67File_(d.evidence, 'Риск ' + r.RiskID) : null;
    if (to === 'MITIGATED' && !f && !r.EvidenceFileID && String(r.StillDetected) !== 'нет') { _endOp_(op, 'FAILED'); return _fail_('RESULT_NOT_CONFIRMED', '«Снижен» — только с подтверждённым результатом: приложите файл (фото, акт, накладную) или дождитесь, когда расчёт перестанет показывать риск', op.id); }
    if (to === 'EXPIRED' && _v93Iso_(r.ExpectedDate) >= _v71Day_(new Date())) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Срок риска (' + _v93Dmy_(_v93Iso_(r.ExpectedDate)) + ') ещё не прошёл', op.id); }
    var who = _v93Who_(op), from = String(r.Status);
    return _withLock_(function () {
      var h = _v93Hist_(r); h.push({ at: new Date().toISOString(), by: who, role: _mcRbNormRole_(s.role), action: MC_V93_RST_RU_[from] + ' → ' + MC_V93_RST_RU_[to] + (f ? ' (файл SHA-256 ' + f.sha256.slice(0, 12) + '…)' : ''), comment: cm });
      r.Status = to; r.DecisionComment = cm || r.DecisionComment; r.OperationID = op.id; r.HistoryJSON = JSON.stringify(h.slice(-30));
      if (f) { r.EvidenceFileID = f.fileId; r.EvidenceHash = f.sha256; }
      if (closing) { r.ResolvedAt = new Date(); r.ResolvedBy = who; }
      _v93Write_(MC_V93_RISK_, MC_V93_RISK_HEAD_, r);
      _audit_(op, 'V93_RISK_DECIDE', MC_V93_RISK_, String(r.RiskID), from, { status: to, comment: cm, file: f ? f.sha256 : '' }); _endOp_(op);
      return _ok_({ riskId: r.RiskID, status: to, statusRu: MC_V93_RST_RU_[to] }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- акции: AI-проекты, ручные, правка, утверждение, публикация, остановка ---------------- */
function _v93PromoOp_(token, perm, type) { return _beginOp_(token, perm, type, 'AI-акции', null, null); }
function _v93PromoGet_(id) { return _v93Rows_(MC_V93_PROMO_).filter(function (x) { return String(x.PromotionDraftID) === String(id); })[0] || null; }
/** AI предлагает проекты акций по партиям с риском списания (только DRAFT; запрещённые — не создаются, причина в ответе). */
function v93PromoSuggest(json, token) {
  var op = null; try { op = _v93PromoOp_(token, 'promo_manage', 'V93_PROMO_SUGGEST'); } catch (e) { return _failFrom_(e); }
  try {
    var K = _v93Ctx_(Date.now()), cfg = K.cfg, who = _v93Who_(op), made = [], skipped = [], today = K.F.day;
    if (!cfg.promoReady) { _endOp_(op, 'FAILED'); return _fail_('CONFIGURATION_REQUIRED', 'Сначала задайте правила акций: минимальная маржа и максимальная скидка (вкладка «Правила», право «Акции — утвердить»)', op.id); }
    var open = _v93Rows_(MC_V93_PROMO_).filter(function (p) { return /^(DRAFT|REVIEW|APPROVED|PUBLISHED)$/.test(String(p.Status)); }), busy = {};
    open.forEach(function (p) { _v93Split_(p.BatchIDs).forEach(function (b) { busy[b] = p.PromotionDraftID; }); });
    var loc = _v92Cfg_().LocationID || 'MAIN', owner = _v93Owner_('WRITEOFF');
    return _withLock_(function () {
      K.R.writeoff.filter(function (w) { return w.p !== null && w.p >= 0.5; }).forEach(function (w) {
        if (busy[w.batchId]) { skipped.push({ batchId: w.batchId, product: w.product, why: 'уже есть проект ' + busy[w.batchId] }); return; }
        var cands = [];
        _v88DishesFor_(w.product, w.rem, w.bu, K.idx, {}).forEach(function (dd) {
          var k = _normNameServer_(dd.name), lp = K.lp[k], ec = K.E.dish[k]; if (!lp || !(lp.price > 0) || !ec || ec.cpp === null) { skipped.push({ batchId: w.batchId, product: w.product, dish: dd.name, why: !lp ? 'нет цены продажи блюда' : 'нет подтверждённой себестоимости блюда' }); return; }
          cands.push({ dish: dd.name, key: k, per: dd.per, price: lp.price, cost: ec.cpp });
        });
        if (!cands.length) { if (!skipped.some(function (x) { return x.batchId === w.batchId; })) skipped.push({ batchId: w.batchId, product: w.product, why: 'нет блюд по ТТК, в которых используется продукт' }); return; }
        cands.sort(function (a, b) { return (b.price - b.cost) / b.price - (a.price - a.cost) / a.price; });
        var c = cands[0], dmax = Math.min(cfg.maxDiscountPct, 100 * (1 - c.cost / (c.price * (1 - cfg.minMarginPct / 100)))), disc = dmax >= 5 ? Math.floor(dmax / 5) * 5 : 0;
        var to = w.expiry, extra = Math.ceil((w.left || 0) / c.per - 1e-9), base = _v93Baseline_(K, c.key, today, to);
        var p = { PromotionDraftID: _v93Id_('PRM'), Name: (disc ? 'Специальная цена: ' : 'Меню дня: ') + c.dish + ' (до ' + _v93Dmy_(to) + ')', LocationID: loc, PeriodFrom: "'" + today, PeriodTo: "'" + to,
          TargetProducts: w.product, TargetDishes: c.dish, TargetChannel: 'зал', PromotionType: disc ? 'специальная цена' : 'меню дня', ProposedPrice: '', DiscountPercent: disc,
          ExpectedSales: _v93R_(base.qty + extra, 1), TargetExtra: extra, ExpectedWriteoffReduction: w.leftValue || '', Reason: 'Риск списания: партия ' + w.batchId + ' «' + w.product + '», ожидаемый остаток к сроку ' + w.leftText + ' (≈ ' + _v92Money_(w.leftValue || 0) + '), вероятность ' + Math.round(w.p * 100) + ' %',
          Problem: 'Списание партии с коротким сроком годности: ' + w.product + ' (' + w.batchId + '), годен до ' + _v93Dmy_(w.expiry), BatchIDs: w.batchId, Responsible: owner.role,
          Confidence: 'НИЗКАЯ — влияние скидки на спрос в MON CHEF не измерялось: нужно продать на ' + extra + ' порц. больше обычных (≈ ' + _v93Num_(base.qty, 1) + ')' + (base.qty > 0 ? ', прирост +' + Math.round(extra / base.qty * 100) + ' %' : ''),
          Status: 'DRAFT', CreatedByAI: 'да', Author: '', CreatedAt: new Date(), CreatedBy: 'MON CHEF (AI) по запросу ' + who, OperationID: op.id };
        var X = _v93PromoCalc_(p, K);
        if (X.hard.length || X.exceptions.length) { skipped.push({ batchId: w.batchId, product: w.product, dish: c.dish, why: X.bans.map(function (b) { return b.code + ': ' + b.text; }).join('; ') }); return; }
        _v93PromoApply_(p, X, cfg); p.HistoryJSON = JSON.stringify([{ at: new Date().toISOString(), by: 'MON CHEF (AI)', action: 'проект создан (DRAFT) по риску списания', comment: 'запрос: ' + who }]);
        var rk = _v93Rows_(MC_V93_RISK_).filter(function (r) { return String(r.RiskType) === 'WRITEOFF' && String(r.ObjectID) === w.batchId && /NEW|REVIEW|ACCEPTED/.test(r.Status); })[0]; if (rk) p.RiskID = rk.RiskID;
        _v93Write_(MC_V93_PROMO_, MC_V93_PROMO_HEAD_, p); made.push({ id: p.PromotionDraftID, name: p.Name, discount: disc });
        _audit_(op, 'V93_PROMO_AI_DRAFT', MC_V93_PROMO_, p.PromotionDraftID, null, { status: 'DRAFT', batch: w.batchId, dish: c.dish, discount: disc });
      });
      _endOp_(op);
      return _ok_({ created: made, skipped: skipped, note: 'AI создаёт только проекты (DRAFT). Отправить на утверждение, утвердить и опубликовать может только человек.' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v93PromoFields_(d) {
  var o = {}, map = { name: 'Name', location: 'LocationID', from: 'PeriodFrom', to: 'PeriodTo', products: 'TargetProducts', dishes: 'TargetDishes', channel: 'TargetChannel', type: 'PromotionType', price: 'ProposedPrice',
    discount: 'DiscountPercent', expectedSales: 'ExpectedSales', batches: 'BatchIDs', responsible: 'Responsible', reason: 'Reason', problem: 'Problem' };
  Object.keys(map).forEach(function (k) { if (d[k] === undefined) return; var v = d[k]; if (v === null) v = ''; if (k === 'from' || k === 'to') v = String(v).trim() ? "'" + String(v).trim() : ''; else if (k === 'price' || k === 'discount' || k === 'expectedSales') v = String(v).trim() === '' ? '' : Number(String(v).replace(',', '.'));
    else if (Array.isArray(v)) v = v.join('; '); else v = String(v).trim(); o[map[k]] = v; });
  return o;
}
function v93PromoCreate(json, token) {
  var op = null; try { op = _v93PromoOp_(token, 'promo_manage', 'V93_PROMO_CREATE'); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v93J_(json), f = _v93PromoFields_(d), who = _v93Who_(op);
    if (!f.Name || f.Name.length < 3) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Назовите акцию', op.id); }
    if (!f.Reason || f.Reason.length < 5) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Какую проблему решает акция (причина)', op.id); }
    if (f.ProposedPrice !== undefined && f.ProposedPrice !== '' && !(f.ProposedPrice > 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Цена — больше нуля', op.id); }
    if (f.DiscountPercent !== undefined && f.DiscountPercent !== '' && !(f.DiscountPercent >= 0 && f.DiscountPercent < 100)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Скидка — от 0 до 99 %', op.id); }
    var K = _v93Ctx_(Date.now()), p = { PromotionDraftID: _v93Id_('PRM'), Status: 'DRAFT', CreatedByAI: 'нет', Author: who, CreatedAt: new Date(), CreatedBy: who, OperationID: op.id, LocationID: _v92Cfg_().LocationID || 'MAIN', TargetChannel: 'зал', Confidence: '' };
    Object.keys(f).forEach(function (k) { p[k] = f[k]; });
    if (!p.Problem) p.Problem = p.Reason;
    var X = _v93PromoCalc_(p, K); _v93PromoApply_(p, X, K.cfg);
    p.Confidence = 'по обычным продажам: ' + (X.baseline > 0 ? '≈ ' + _v93Num_(X.baseline, 1) + ' порц. за период' : 'НЕТ ДАННЫХ') + '; влияние скидки на спрос не измерялось';
    p.HistoryJSON = JSON.stringify([{ at: new Date().toISOString(), by: who, action: 'проект создан (DRAFT) вручную' }]);
    return _withLock_(function () {
      _v93Write_(MC_V93_PROMO_, MC_V93_PROMO_HEAD_, p); _audit_(op, 'V93_PROMO_CREATE', MC_V93_PROMO_, p.PromotionDraftID, null, f); _endOp_(op);
      return _ok_({ id: p.PromotionDraftID, status: 'DRAFT', bans: X.bans, warnings: X.warnings }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Ручное изменение проекта: цена, скидка, период, площадка, исключить блюдо или товар, ответственный. Каждое поле — в истории и аудите; утверждённая акция после правки снова на утверждении. */
function v93PromoEdit(json, token) {
  var op = null; try { op = _v93PromoOp_(token, 'promo_manage|promo_approve', 'V93_PROMO_EDIT'); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v93J_(json), p = _v93PromoGet_(d.id), who = _v93Who_(op), cm = String(d.comment || '').trim();
    if (!p) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Проект акции не найден', op.id); }
    if (!/^(DRAFT|REVIEW|APPROVED)$/.test(String(p.Status))) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Изменить можно проект, акцию на утверждении или утверждённую до публикации (сейчас: ' + MC_V93_PST_RU_[p.Status] + ')', op.id); }
    if (cm.length < 3) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Напишите, почему меняете', op.id); }
    var f = _v93PromoFields_(d.changes || {}), changes = [];
    if (d.excludeDish) { var L = _v93Split_(p.TargetDishes).filter(function (x) { return _normNameServer_(x) !== _normNameServer_(d.excludeDish); }); f.TargetDishes = L.join('; '); }
    if (d.excludeProduct) { f.TargetProducts = _v93Split_(p.TargetProducts).filter(function (x) { return _prodKey_(x) !== _prodKey_(d.excludeProduct); }).join('; ');
      var bm = {}; _v89Stock_(Date.now()).batches.forEach(function (b) { bm[b.id] = b.product; }); f.BatchIDs = _v93Split_(p.BatchIDs).filter(function (b) { return _prodKey_(bm[b] || '') !== _prodKey_(d.excludeProduct); }).join('; '); }
    if (f.ProposedPrice !== undefined && f.ProposedPrice !== '' && !(f.ProposedPrice > 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Цена — больше нуля', op.id); }
    if (f.DiscountPercent !== undefined && f.DiscountPercent !== '' && !(f.DiscountPercent >= 0 && f.DiscountPercent < 100)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Скидка — от 0 до 99 %', op.id); }
    if (f.ProposedPrice !== undefined && f.ProposedPrice !== '' && f.DiscountPercent === undefined) f.DiscountPercent = '';
    if (f.DiscountPercent !== undefined && f.DiscountPercent !== '' && f.ProposedPrice === undefined) f.ProposedPrice = '';
    Object.keys(f).forEach(function (k) { var a = String(p[k] instanceof Date ? _v93Iso_(p[k]) : p[k] === undefined ? '' : p[k]).replace(/^'/, ''), b = String(f[k]).replace(/^'/, ''); if (k === 'PeriodFrom' || k === 'PeriodTo') a = _v93Iso_(p[k]); if (a !== b) changes.push({ field: k, from: a, to: b }); });
    if (!changes.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Изменений нет', op.id); }
    var K = _v93Ctx_(Date.now()), was = String(p.Status);
    return _withLock_(function () {
      changes.forEach(function (c) { p[c.field] = f[c.field]; });
      var X = _v93PromoCalc_(p, K); _v93PromoApply_(p, X, K.cfg);
      var h = _v93Hist_(p); changes.forEach(function (c) { h.push({ at: new Date().toISOString(), by: who, role: _mcRbNormRole_(op.session.role), action: 'изменено «' + c.field + '»: ' + (c.from || '—') + ' → ' + (c.to || '—'), comment: cm, field: c.field }); });
      if (was === 'APPROVED') { p.Status = 'REVIEW'; p.ApprovedBy = ''; p.ApprovedAt = ''; p.ExceptionBy = ''; p.NegativeApproved = ''; h.push({ at: new Date().toISOString(), by: who, action: 'утверждение снято — изменение требует нового утверждения' }); }
      p.HistoryJSON = JSON.stringify(h.slice(-40)); p.OperationID = op.id;
      _v93Write_(MC_V93_PROMO_, MC_V93_PROMO_HEAD_, p);
      _audit_(op, 'V93_PROMO_EDIT', MC_V93_PROMO_, String(p.PromotionDraftID), changes.map(function (c) { return c.field + '=' + c.from; }).join('; '), { changes: changes, comment: cm, status: p.Status }); _endOp_(op);
      return _ok_({ id: p.PromotionDraftID, status: p.Status, changes: changes, bans: X.bans, warnings: X.warnings }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v93Editors_(p) { var a = [String(p.Author || '')]; _v93Hist_(p).forEach(function (h) { if (/ProposedPrice|DiscountPercent/.test(String(h.field || '')) && h.by) a.push(String(h.by)); }); return a.filter(String); }
function v93PromoSubmit(json, token) {
  var op = null; try { op = _v93PromoOp_(token, 'promo_manage', 'V93_PROMO_SUBMIT'); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v93J_(json), p = _v93PromoGet_(d.id), who = _v93Who_(op), why = String(d.exceptionReason || '').trim();
    if (!p) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Проект акции не найден', op.id); }
    if (String(p.Status) !== 'DRAFT') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'На утверждение отправляется проект (сейчас: ' + MC_V93_PST_RU_[p.Status] + ')', op.id); }
    var K = _v93Ctx_(Date.now()), X = _v93PromoCalc_(p, K);
    if (X.hard.length) { _endOp_(op, 'FAILED'); return _fail_('PROMO_BANNED', 'Акция запрещена: ' + X.hard.map(function (b) { return b.text; }).join('; '), op.id); }
    if (X.exceptions.length && why.length < 10) { _endOp_(op, 'FAILED'); return _fail_('EXCEPTION_REASON_REQUIRED', 'Отклонение от правил (' + X.exceptions.map(function (b) { return b.text; }).join('; ') + ') — укажите причину исключения (не короче 10 знаков)', op.id); }
    return _withLock_(function () {
      _v93PromoApply_(p, X, K.cfg); p.Status = 'REVIEW'; if (!p.Author) p.Author = who; if (X.exceptions.length) p.ExceptionReason = why; p.OperationID = op.id;
      var h = _v93Hist_(p); h.push({ at: new Date().toISOString(), by: who, action: 'отправлено на утверждение' + (X.exceptions.length ? ' с исключением: ' + why : '') }); p.HistoryJSON = JSON.stringify(h.slice(-40));
      _v93Write_(MC_V93_PROMO_, MC_V93_PROMO_HEAD_, p); _audit_(op, 'V93_PROMO_SUBMIT', MC_V93_PROMO_, String(p.PromotionDraftID), 'DRAFT', { status: 'REVIEW', exception: why }); _endOp_(op);
      return _ok_({ id: p.PromotionDraftID, status: 'REVIEW', exceptions: X.exceptions }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v93PromoDecide(json, token) {
  var op = null; try { op = _v93PromoOp_(token, 'promo_approve', 'V93_PROMO_DECIDE'); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v93J_(json), p = _v93PromoGet_(d.id), who = _v93Who_(op), cm = String(d.comment || '').trim(), dec = String(d.decision || '');
    if (!p) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Проект акции не найден', op.id); }
    if (String(p.Status) !== 'REVIEW') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Решение принимается по акции на утверждении (сейчас: ' + MC_V93_PST_RU_[p.Status] + ')', op.id); }
    if (dec !== 'APPROVE' && dec !== 'REJECT') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Решение: утвердить или отклонить', op.id); }
    var h = _v93Hist_(p);
    if (dec === 'REJECT') {
      if (cm.length < 5) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Напишите причину отклонения', op.id); }
      return _withLock_(function () { p.Status = 'REJECTED'; p.OperationID = op.id; h.push({ at: new Date().toISOString(), by: who, action: 'отклонено', comment: cm }); p.HistoryJSON = JSON.stringify(h.slice(-40));
        _v93Write_(MC_V93_PROMO_, MC_V93_PROMO_HEAD_, p); _audit_(op, 'V93_PROMO_DECIDE', MC_V93_PROMO_, String(p.PromotionDraftID), 'REVIEW', { status: 'REJECTED', comment: cm }); _endOp_(op); return _ok_({ id: p.PromotionDraftID, status: 'REJECTED' }, op.id); });
    }
    if (d.confirm !== true) { _endOp_(op, 'FAILED'); return _fail_('CONFIRM_REQUIRED', 'Проверьте исходные данные, цену, себестоимость, маржу, риски, срок, товары и условия остановки — и подтвердите', op.id); }
    var K = _v93Ctx_(Date.now()), X = _v93PromoCalc_(p, K), eds = _v93Editors_(p), role = _mcRbNormRole_(op.session.role);
    if (X.hard.length) { _endOp_(op, 'FAILED'); return _fail_('PROMO_BANNED', 'Акция запрещена: ' + X.hard.map(function (b) { return b.text; }).join('; '), op.id); }
    var why = String(d.exceptionReason || p.ExceptionReason || '').trim(), neg = X.exceptions.some(function (b) { return b.code === 'NEGATIVE_MARGIN'; });
    if (X.exceptions.length) {
      if (why.length < 10) { _endOp_(op, 'FAILED'); return _fail_('EXCEPTION_REASON_REQUIRED', 'Отклонение от правил — нужна причина исключения', op.id); }
      if (eds.indexOf(who) >= 0) { _endOp_(op, 'FAILED'); return _fail_('EXCEPTION_NEEDS_OTHER_APPROVER', 'Акцию с отклонением от минимальной маржи или скидки не утверждает её автор (или тот, кто менял цену): нужен другой руководитель', op.id); }
      if (neg && (role !== 'Директор' || d.confirmNegative !== true)) { _endOp_(op, 'FAILED'); return _fail_('NEGATIVE_MARGIN_FORBIDDEN', 'Отрицательная маржа запрещена по умолчанию: только директор (не автор) с отдельным подтверждением «акция в убыток»', op.id); }
    }
    return _withLock_(function () {
      _v93PromoApply_(p, X, K.cfg); p.Status = 'APPROVED'; p.ApprovedBy = who; p.ApprovedAt = new Date(); p.OperationID = op.id;
      if (X.exceptions.length) { p.ExceptionReason = why; p.ExceptionBy = who; if (neg) p.NegativeApproved = 'да — ' + who; }
      h.push({ at: new Date().toISOString(), by: who, role: role, action: 'утверждено' + (X.exceptions.length ? ' с исключением из правил: ' + why : ''), comment: cm }); p.HistoryJSON = JSON.stringify(h.slice(-40));
      _v93Write_(MC_V93_PROMO_, MC_V93_PROMO_HEAD_, p); _audit_(op, 'V93_PROMO_DECIDE', MC_V93_PROMO_, String(p.PromotionDraftID), 'REVIEW', { status: 'APPROVED', exception: X.exceptions.map(function (b) { return b.code; }), reason: why }); _endOp_(op);
      return _ok_({ id: p.PromotionDraftID, status: 'APPROVED', next: 'Опубликовать — отдельным действием. Цены в кассе и меню MON CHEF не меняет.' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Публикация утверждённой акции: статус PUBLISHED и операция в аудите. Цены, касса и финансы не меняются — их меняет человек вручную. */
function v93PromoPublish(json, token) {
  var op = null; try { op = _v93PromoOp_(token, 'promo_approve', 'V93_PROMO_PUBLISH'); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v93J_(json), p = _v93PromoGet_(d.id), who = _v93Who_(op);
    if (!p) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Проект акции не найден', op.id); }
    if (String(p.Status) !== 'APPROVED') { _endOp_(op, 'FAILED'); return _fail_('NOT_APPROVED', 'Опубликовать можно только утверждённую акцию (сейчас: ' + MC_V93_PST_RU_[p.Status] + ')', op.id); }
    if (d.confirm !== true) { _endOp_(op, 'FAILED'); return _fail_('CONFIRM_REQUIRED', 'Подтвердите публикацию', op.id); }
    var K = _v93Ctx_(Date.now()), X = _v93PromoCalc_(p, K);
    if (X.hard.length) { _endOp_(op, 'FAILED'); return _fail_('PROMO_BANNED', 'Публикация запрещена: ' + X.hard.map(function (b) { return b.text; }).join('; '), op.id); }
    return _withLock_(function () {
      p.Status = 'PUBLISHED'; p.PublishedAt = new Date(); p.PublishedBy = who; p.OperationID = op.id;
      var h = _v93Hist_(p); h.push({ at: new Date().toISOString(), by: who, action: 'опубликовано (цены в кассе и меню — вручную; финансовых проводок нет)' }); p.HistoryJSON = JSON.stringify(h.slice(-40));
      _v93Write_(MC_V93_PROMO_, MC_V93_PROMO_HEAD_, p); _audit_(op, 'V93_PROMO_PUBLISH', MC_V93_PROMO_, String(p.PromotionDraftID), 'APPROVED', { status: 'PUBLISHED', price: p.ProposedPrice, discount: p.DiscountPercent, from: _v93Iso_(p.PeriodFrom), to: _v93Iso_(p.PeriodTo) }); _endOp_(op);
      return _ok_({ id: p.PromotionDraftID, status: 'PUBLISHED', note: 'Акция опубликована в MON CHEF. Цену в кассе и меню установите вручную; MON CHEF цены не меняет и финансовых операций не проводит.' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v93PromoStop(json, token) {
  var op = null; try { op = _v93PromoOp_(token, 'promo_approve', 'V93_PROMO_STOP'); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v93J_(json), p = _v93PromoGet_(d.id), who = _v93Who_(op), why = String(d.reason || '').trim();
    if (!p) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Акция не найдена', op.id); }
    if (String(p.Status) !== 'PUBLISHED') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Остановить можно действующую акцию', op.id); }
    if (why.length < 5) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Напишите причину остановки', op.id); }
    if (d.confirm !== true) { _endOp_(op, 'FAILED'); return _fail_('CONFIRM_REQUIRED', 'Подтвердите остановку', op.id); }
    var K = _v93Ctx_(Date.now()), A = _v93PromoActual_(p, K);
    return _withLock_(function () {
      p.Status = 'COMPLETED'; p.CompletedAt = new Date(); p.CompletedBy = who; p.StopReason = why; p.ActualJSON = JSON.stringify(A); p.OperationID = op.id;
      var h = _v93Hist_(p); h.push({ at: new Date().toISOString(), by: who, action: 'остановлено вручную', comment: why }); p.HistoryJSON = JSON.stringify(h.slice(-40));
      _v93Write_(MC_V93_PROMO_, MC_V93_PROMO_HEAD_, p); _audit_(op, 'V93_PROMO_STOP', MC_V93_PROMO_, String(p.PromotionDraftID), 'PUBLISHED', { status: 'COMPLETED', reason: why }); _endOp_(op);
      return _ok_({ id: p.PromotionDraftID, status: 'COMPLETED', actual: A }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Правила акций и параметры прогноза (право «Акции — утвердить»). Аварийное правило утверждается здесь же. */
function v93SaveSettings(json, token) {
  var op = null; try { op = _v93PromoOp_(token, 'promo_approve', 'V93_SETTINGS'); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v93J_(json), cur = _v93Cfg_(), who = _v93Who_(op), n = function (v) { var x = Number(String(v === undefined || v === null ? '' : v).replace(',', '.')); return String(v === undefined || v === null ? '' : v).trim() === '' || !isFinite(x) ? null : x; };
    var o = {};
    ['minMarginPct', 'maxDiscountPct', 'minHistoryDays', 'minObs', 'weeks', 'horizonDays', 'riskMinP', 'marginDropPp', 'costRisePct', 'revenueDropPct', 'staffNorm'].forEach(function (k) { o[k] = d[k] === undefined ? cur[k] : n(d[k]); });
    if (o.minMarginPct === null || o.minMarginPct < 0 || o.minMarginPct >= 100) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Минимальная маржа — от 0 до 99 %', op.id); }
    if (o.maxDiscountPct === null || o.maxDiscountPct < 0 || o.maxDiscountPct >= 100) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Максимальная скидка — от 0 до 99 %', op.id); }
    if (o.minHistoryDays !== null && o.minHistoryDays < 21) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'История для прогноза — не меньше 21 дня (короткий период не используется)', op.id); }
    if (o.minObs !== null && o.minObs < 3) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Наблюдений по дню недели — не меньше 3', op.id); }
    if (o.staffNorm !== null && !(o.staffNorm > 0)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Норма выработки — больше нуля или пусто', op.id); }
    var em = cur.emergency; if (d.emergency !== undefined) em = d.emergency ? { on: true, by: who, at: new Date().toISOString() } : { on: false, by: who, at: new Date().toISOString() };
    o.emergency = em; o.updatedBy = who; o.updatedAt = new Date().toISOString();
    return _withLock_(function () {
      PropertiesService.getScriptProperties().setProperty(MC_V93_CFG_PROP_, JSON.stringify(o));
      _audit_(op, 'V93_SETTINGS', 'Свойства', MC_V93_CFG_PROP_, { minMarginPct: cur.minMarginPct, maxDiscountPct: cur.maxDiscountPct, emergency: cur.emergency }, o); _endOp_(op);
      return _ok_({ cfg: _v93Cfg_() }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- «Моя смена»: карточки и блок ---------------- */
try {
  MC_V87_SOURCES_.push(function (ctx) {
    var s = ctx.s, out = []; if (!s || s.dev) return out;
    var can = _v93Can_(s), role = _mcRbNormRole_(s.role), mod = _v87ModOk_(s, 'ai') ? { kind: 'open', module: 'ai', label: 'Прогнозы и риски' } : null;
    var kitchen = can.view || _mcRbHasExact_(s, 'stock|prod_manage|procurement_view|procurement');
    if (!kitchen && !can.manage && !can.approve) return out;
    var K = _v93CtxCached_(), F = K.F, R = K.R;
    if (F.status === 'OK' && can.view) {
      var P = F.totals.portions, top = F.dishes.filter(function (d) { return d.remain > 0; }).slice(0, 5).map(function (d) { return d.dish + ' ≈ ' + _v93Num_(d.remain, 1) + ' (' + _v93Num_(d.remainLow, 0) + '–' + _v93Num_(d.remainHigh, 0) + ')'; });
      out.push({ key: 'V93|fc|' + F.day, group: 'later', source: 'Прогноз', title: 'Прогноз продаж до конца смены (' + F.endHM + '): ≈ ' + _v93Num_(P.remain, 1) + ' порц. (' + _v93Num_(P.remainLow, 0) + '–' + _v93Num_(P.remainHigh, 0) + '), уверенность ' + P.confRu,
        detail: (top.length ? top.join('; ') + '. ' : '') + 'Факт к ' + F.nowHM + ': ' + _v93Num_(P.fact, 1) + ' порц. при прогнозе к этому часу ' + _v93Num_(P.expected, 1) + (P.dev !== null ? ' (' + _v93Pct_(P.dev) + ')' : '') + '. Статистика по ' + F._obs.length + ' таким же дням недели; праздники, погода и акции не учтены.',
        who: 'шеф-повар, руководитель смены', act: mod });
    }
    if (kitchen && F.status === 'OK') {
      R.deficits.filter(function (d) { return d.p >= K.cfg.riskMinP; }).slice(0, 5).forEach(function (d) {
        out.push({ key: 'V93|def|' + d.key, group: 'now', source: 'Прогноз дефицита', critical: d.p >= 0.75, title: 'Может не хватить до конца смены: ' + d.product + ' (вероятность ' + Math.round(d.p * 100) + ' %)',
          detail: 'Нужно ≈ ' + d.needText + ' (до ' + d.needHighText + '), доступно ' + d.availText + '. Блюда: ' + d.dishes.join(', ') + '. Заказ и стоп-лист — решение шеф-повара и закупщика.', who: 'кладовщик, шеф-повар', act: mod });
      });
      R.writeoff.filter(function (w) { return w.p !== null && w.p >= 0.5; }).slice(0, 5).forEach(function (w) {
        out.push({ key: 'V93|wo|' + w.batchId, group: 'expiry', source: 'Прогноз списания', title: 'Риск списания: ' + w.product + ' — к ' + _v93Dmy_(w.expiry) + ' останется ≈ ' + w.leftText + ' (вероятность ' + Math.round(w.p * 100) + ' %)',
          detail: 'Партия ' + w.batchId + ', остаток ' + w.remText + '. Использовать в первую очередь: ' + (w.dishes.join(', ') || 'блюд по ТТК нет') + '. Проект акции — только с подтверждением руководителя.', who: 'шеф-повар, кладовщик', act: mod });
      });
    }
    // риски моей роли из реестра (открытые)
    try { var mine = _v93Rows_(MC_V93_RISK_).filter(function (r) { return /^(NEW|REVIEW)$/.test(String(r.Status)) && String(r.OwnerRole).indexOf(role) === 0 && _v93Sees_(s, can, r.RiskType, r.OwnerRole); });
      if (mine.length) { var cr = mine.filter(function (r) { return r.Priority === 'CRITICAL'; }).length;
        out.push({ key: 'V93|risk|' + role, group: cr ? 'now' : 'later', critical: cr > 0, source: 'Риски', title: 'Риски вашей роли: ' + mine.length + (cr ? ', критично ' + cr : '') + ' — решение нужно до ' + mine.map(function (r) { return _v93Iso_(r.ExpectedDate); }).sort()[0].split('-').reverse().join('.'),
          detail: mine.slice(0, 4).map(function (r) { return '[' + (MC_V93_PRIO_RU_[r.Priority] || r.Priority) + '] ' + r.Description; }).join(' · '), who: role, act: mod }); } } catch (e) {}
    // акции
    try { var PR = _v93Rows_(MC_V93_PROMO_);
      if (can.approve) { var rv = PR.filter(function (p) { return p.Status === 'REVIEW'; }); if (rv.length) out.push({ key: 'V93|promo|review', group: 'now', source: 'Акции', title: 'Акции ждут вашего утверждения: ' + rv.length, detail: rv.slice(0, 3).map(function (p) { return p.Name; }).join('; ') + '. Без утверждения акция не публикуется.', who: 'руководитель', act: mod }); }
      if (can.manage) { var nw = PR.filter(function (p) { return p.Status === 'DRAFT' && p.CreatedByAI === 'да'; }); if (nw.length) out.push({ key: 'V93|promo|new', group: 'later', source: 'Акции', title: 'Новые проекты акций (AI): ' + nw.length, detail: nw.slice(0, 3).map(function (p) { return p.Name; }).join('; ') + '. Проверьте и отправьте на утверждение или отклоните.', who: role, act: mod }); }
      if (can.manage || can.approve) { var run = PR.filter(function (p) { return p.Status === 'PUBLISHED'; });
        run.forEach(function (p) { var a = null; try { a = JSON.parse(p.ActualJSON || 'null'); } catch (e) {} var sg = String(p.StopSuggested || '');
          out.push({ key: 'V93|promo|run|' + p.PromotionDraftID, group: sg ? 'now' : 'later', critical: /санитарн|убыт/.test(sg), source: 'Акции', title: 'Действует акция «' + p.Name + '»' + (a ? ': продано ' + _v93Num_(a.qty, 1) + ' из ' + _v93Num_(Number(p.ExpectedSales), 1) + ' порц.' : ''),
            detail: (sg ? 'Предложение остановить или изменить: ' + sg + '. Остановка — решением руководителя. ' : '') + (a && a.uplift !== null ? 'К обычным продажам: ' + _v93Pct_(a.uplift) + '.' : ''), who: 'руководитель', act: mod }); }); }
    } catch (e) {}
    return out;
  });
} catch (e) {}
(function (g) {
  var orig = g.v87ShiftData; if (typeof orig !== 'function') return;
  g.v87ShiftData = function (token) { var prev = _V93_REQ_; _V93_REQ_ = {}; try { return orig.apply(this, arguments); } finally { _V93_REQ_ = prev; } };
  var ob = g._v92Blocks_; if (typeof ob !== 'function') return;
  g._v92Blocks_ = function (s, role, staffed, covers, ctx) {
    var B = ob.apply(this, arguments);
    try {
      var can = _v93Can_(s); if (!can.view) return B;
      var K = _v93CtxCached_(), F = K.F, rows = [], P = F.totals.portions;
      if (F.status === 'OK') { rows.push(['Прогноз продаж на сегодня', _v93Num_(P.value, 1) + ' порц. (' + _v93Num_(P.low, 0) + '–' + _v93Num_(P.high, 0) + '), уверенность ' + P.confRu], ['До конца смены (' + F.endHM + ')', '≈ ' + _v93Num_(P.remain, 1) + ' порц.'],
        ['Факт к ' + F.nowHM, _v93Num_(P.fact, 1) + ' порц.' + (P.dev !== null ? ' (' + _v93Pct_(P.dev) + ' к прогнозу этого часа)' : '')]);
        if (can.revenue || can.cost) { var Rv = F.totals.revenue; rows.push(['Выручка: прогноз дня', _v92Money_(Rv.value) + ' (' + _v92Money_(Rv.low) + ' – ' + _v92Money_(Rv.high) + ')' + (F.budget && F.budget.plan ? ', план ' + _v92Money_(F.budget.plan) : '')]); } }
      else rows.push(['Прогноз продаж', 'INSUFFICIENT_DATA — ' + F.missing.join('; ')]);
      rows.push(['Прогноз дефицита до конца смены', K.R.deficits.filter(function (d) { return d.p >= K.cfg.riskMinP; }).map(function (d) { return d.product + ' (' + Math.round(d.p * 100) + ' %)'; }).join(', ') || (F.status === 'OK' ? 'не ожидается' : 'НЕТ ДАННЫХ')]);
      rows.push(['Прогноз списания', K.R.writeoff.filter(function (w) { return w.p !== null && w.p >= 0.5; }).map(function (w) { return w.product + ' — ' + w.leftText + (can.cost ? ' ≈ ' + _v92Money_(w.leftValue) : ''); }).join('; ') || (F.status === 'OK' ? 'не ожидается' : 'НЕТ ДАННЫХ')]);
      var act = _v93Rows_(MC_V93_RISK_).filter(function (r) { return /^(NEW|REVIEW|ACCEPTED)$/.test(String(r.Status)) && _v93Sees_(s, can, r.RiskType, r.OwnerRole); });
      rows.push(['Активные риски', act.length ? act.length + ' (критично ' + act.filter(function (r) { return r.Priority === 'CRITICAL'; }).length + ')' : 'нет в реестре']);
      var PR = _v93Rows_(MC_V93_PROMO_); rows.push(['Акции', 'новых проектов ' + PR.filter(function (p) { return p.Status === 'DRAFT'; }).length + ', ждут утверждения ' + PR.filter(function (p) { return p.Status === 'REVIEW'; }).length + ', действуют ' + PR.filter(function (p) { return p.Status === 'PUBLISHED'; }).length]);
      if (!can.cost) rows = rows.map(function (r) { return [r[0], _v92NoMoney_(r[1])]; });
      var o = { id: 'ai', title: 'Прогноз, риски и акции', prio: act.some(function (r) { return r.Priority === 'CRITICAL'; }) ? 'CRITICAL' : act.length ? 'IMPORTANT' : F.status === 'OK' ? 'NORMAL' : 'NODATA', rows: rows,
        notes: ['Прогноз — статистика по журналу продаж (те же дни недели за ' + K.cfg.weeks + ' нед.), не нейросеть; праздники, погода, мероприятия и акции не учтены.'] };
      o.prioRu = MC_V92_PRIO_RU_[o.prio] || ''; B.push(o);
    } catch (e) { B.push({ id: 'ai', title: 'Прогноз, риски и акции', prio: 'NODATA', prioRu: 'НЕТ ДАННЫХ', rows: [['Ошибка расчёта', String(e.message || e)]] }); }
    return B;
  };
})(this);

/* ---------------- сменные письма (V89): раздел «Прогноз, риски и акции» ---------------- */
var _V93_MAIL_ = { d: null, k: null };   // один расчёт на письмо (варианты для разных адресатов)
(function (g) {
  var orig = g._v89Render_; if (typeof orig !== 'function') return;
  g._v89Render_ = function (D, V, att) {
    var r = orig.apply(this, arguments);
    try {
      if (_V93_MAIL_.d !== D) { _V93_MAIL_.d = D; _V93_MAIL_.k = _v93Ctx_(Date.now(), true); } var K = _V93_MAIL_.k, F = K.F, H = [], X = ['', '== ПРОГНОЗ, РИСКИ И АКЦИИ =='], money = !!V.F, rowsX = [['Раздел', 'Показатель', 'Значение']];
      var e = _v89E_, p = function (t) { H.push('<p style="margin:3px 0">' + e(t) + '</p>'); X.push(t); }, add = function (a, b, c) { rowsX.push([a, b, c]); };
      H.push('<h3 style="margin:14px 0 4px;color:#6e1423;font-size:15px">Прогноз, риски и акции</h3>');
      if (F.status === 'OK') { var P = F.totals.portions;
        p('Прогноз продаж до конца смены (' + F.endHM + '): ≈ ' + _v93Num_(P.remain, 1) + ' порц. (' + _v93Num_(P.remainLow, 0) + '–' + _v93Num_(P.remainHigh, 0) + '), уверенность ' + P.confRu + '; за день ≈ ' + _v93Num_(P.value, 1) + ' порц.'); add('Прогноз', 'Порций до конца смены', _v93Num_(P.remain, 1));
        p('Отклонение факта от прогноза к ' + F.nowHM + ': факт ' + _v93Num_(P.fact, 1) + ' порц., прогноз к этому часу ' + _v93Num_(P.expected, 1) + (P.dev !== null ? ' (' + _v93Pct_(P.dev) + ')' : ''));
        if (money) { var Rv = F.totals.revenue; p('Выручка (прогноз дня): ' + _v92Money_(Rv.value) + ' (' + _v92Money_(Rv.low) + ' – ' + _v92Money_(Rv.high) + ')' + (F.budget && F.budget.plan ? '; план ' + _v92Money_(F.budget.plan) + ' (' + _v93Pct_(F.budget.dev) + ')' : '')); add('Прогноз', 'Выручка дня', Rv.value); }
        F.dishes.filter(function (d) { return d.remain > 0; }).slice(0, 6).forEach(function (d) { p('  — ' + d.dish + ': до конца смены ≈ ' + _v93Num_(d.remain, 1) + ' (' + _v93Num_(d.remainLow, 0) + '–' + _v93Num_(d.remainHigh, 0) + ')'); add('Прогноз по блюдам', d.dish, d.remain); });
        var LD = _v93LastDay_(K); LD.rows.filter(function (x) { return x.kind === 'PORTIONS' || (money && x.kind === 'REVENUE'); }).forEach(function (x) { p('Вчера (' + _v93Dmy_(LD.day) + '): ' + x.object + ' — прогноз ' + _v93Num_(x.forecast, 1) + ', факт ' + _v93Num_(x.fact, 1) + ' (' + _v93Pct_(x.dev) + ')'); });
        p('Метод: статистика по журналу продаж (те же дни недели), не нейросеть; праздники, погода, мероприятия и акции не учтены.');
      } else p('Прогноз продаж: INSUFFICIENT_DATA — ' + F.missing.join('; '));
      if (V.E || V.P || money) {
        var df = K.R.deficits.filter(function (d) { return d.p >= K.cfg.riskMinP; }); p('Прогноз дефицита до конца смены: ' + (df.length ? df.map(function (d) { return d.product + ' (' + Math.round(d.p * 100) + ' %, нужно ' + d.needText + ', есть ' + d.availText + ')'; }).join('; ') : F.status === 'OK' ? 'не ожидается' : 'НЕТ ДАННЫХ'));
        df.forEach(function (d) { add('Дефицит', d.product, Math.round(d.p * 100) + ' %'); });
        var wo = K.R.writeoff.filter(function (w) { return w.p !== null && w.p >= 0.5; }); p('Прогноз списания: ' + (wo.length ? wo.map(function (w) { return w.product + ' (' + w.batchId + ') — к ' + _v93Dmy_(w.expiry) + ' останется ≈ ' + w.leftText + (money ? ' ≈ ' + _v92Money_(w.leftValue) : '') + ', ' + Math.round(w.p * 100) + ' %'; }).join('; ') : F.status === 'OK' ? 'не ожидается' : 'НЕТ ДАННЫХ'));
        wo.forEach(function (w) { add('Списание', w.product + ' ' + w.batchId, w.leftText); });
        if (V.P && K.R.needs.length) p('Изменение потребности на 7 дней: ' + K.R.needs.filter(function (n) { return n.change !== null && Math.abs(n.change) >= 0.15; }).slice(0, 6).map(function (n) { return n.product + ' ' + _v93Pct_(n.change); }).join('; ') || 'без заметных изменений');
      }
      var RK = _v93Rows_(MC_V93_RISK_).filter(function (x) { return /^(NEW|REVIEW|ACCEPTED)$/.test(String(x.Status)) && (money || !(MC_V93_TYPES_[x.RiskType] || {}).need) && (money || V.E || V.P || !/^(REVENUE_DROP|BUDGET|MARGIN_DROP|COST_OVERRUN|FIN_DATA)$/.test(x.RiskType)); });
      p('Активные риски: ' + (RK.length ? RK.length + ' (критично ' + RK.filter(function (x) { return x.Priority === 'CRITICAL'; }).length + ')' : 'в реестре нет'));
      RK.slice(0, 8).forEach(function (x) { var t = '[' + (MC_V93_PRIO_RU_[x.Priority] || x.Priority) + '] ' + x.Description + ' — ' + x.OwnerRole + ', срок ' + _v93Dmy_(_v93Iso_(x.ExpectedDate)) + ' (RiskScore ' + _v93Num_(x.RiskScore, 2) + ')'; p('  — ' + (money ? t : _v92NoMoney_(t))); add('Риски', x.RiskType, money ? x.Description : _v92NoMoney_(x.Description)); });
      var PR = _v93Rows_(MC_V93_PROMO_);
      p('Акции: новых проектов ' + PR.filter(function (x) { return x.Status === 'DRAFT'; }).length + ', ждут подтверждения ' + PR.filter(function (x) { return x.Status === 'REVIEW'; }).length + ', действуют ' + PR.filter(function (x) { return x.Status === 'PUBLISHED'; }).length);
      PR.filter(function (x) { return x.Status === 'PUBLISHED'; }).forEach(function (x) { var a = null; try { a = JSON.parse(x.ActualJSON || 'null'); } catch (e2) {} var t = '  — «' + x.Name + '»: ' + (a ? 'продано ' + _v93Num_(a.qty, 1) + ' из ' + _v93Num_(Number(x.ExpectedSales), 1) + ' порц.' + (money && a.marginPct !== null ? ', маржа ' + _v93Num_(a.marginPct, 1) + ' %' : '') : 'факта пока нет') + (x.StopSuggested ? '; предложено остановить: ' + x.StopSuggested : ''); p(money ? t : _v92NoMoney_(t)); });
      p('Ответственная роль и срок решения — в каждой строке риска; решения принимаются только вручную на экране «Прогнозы, риски и акции».');
      var html = r.html, i = html.lastIndexOf('</div>'); r.html = i >= 0 ? html.slice(0, i) + H.join('') + html.slice(i) : html + H.join('');
      r.text = r.text + '\n' + X.join('\n'); if (r.sheets) r.sheets['Прогноз и риски'] = rowsX;
    } catch (e) { r.text = r.text + '\n\nПрогноз, риски и акции: ошибка расчёта — ' + String(e.message || e); }
    return r;
  };
})(this);
