/**
 * MON CHEF V76 — ГОСТ Р ИСО 22000-2019 (добровольного применения; текст сверен по присланному PDF):
 *   п. 8.4  готовность к чрезвычайным ситуациям и реагирование на них;
 *   п. 8.7  управление мониторингом и измерениями.
 * Обязательная основа: СанПиН 2.3/2.4.4282-26 п. 18 (исправные системы водоснабжения, водоотведения, теплоснабжения,
 * вентиляции, освещения) и п. 48 (ртутные термометры не допускаются).
 *
 * 8.4.1 сценарии (процедуры) реагирования утверждает руководство (директор); типы ситуаций — из примечания к 8.4.2;
 * 8.4.2 a) событие ЧС: применимые требования, уведомление персонала, решения по внешним сторонам (поставщики,
 *         потребители, органы, СМИ — «уведомлены» или «не требуется» с причиной);
 *       b) действия по устранению и смягчению, решения по продукции (кандидаты — партии с остатком в затронутых местах
 *          хранения; отзыв — модулем V74);
 *       c) тестирование процедур с периодичностью предприятия (или «неосуществимо» с причиной);
 *       d) анализ после события и после теста: нужна ли актуализация — сценарий помечается «требует актуализации».
 * 8.7  у средства измерения: вид, ртутный или нет (ртутный — блокируется, СанПиН п. 48), защита от регулировок (d) и
 *      повреждений (e); история поверок, калибровок и внутренних проверок с документом и прослеживаемостью (a, b);
 *      «не соответствует» или неисправность → прибор блокируется, открывается оценка прежних измерений этим прибором
 *      с последней положительной поверки: измерения и партии из журнала «Температуры»; закрывается выводом,
 *      мерами по прибору и по продукции; снова использовать — после положительной поверки или проверки;
 *      этикетки статуса поверки (c); валидация и одобрение программы (сборки) перед применением.
 * Значения (сроки, пределы, действия, контакты) вносит предприятие; система их не придумывает.
 */
var MC_V76_ = { SC: 'ЧС_Сценарии_V76', IN: 'ЧС_События_V76', TS: 'ЧС_Тесты_V76', EQ: 'СИ_Сведения_V76', CAL: 'СИ_Поверки_V76', EV: 'СИ_Оценки_V76', SW: 'ПО_Валидация_V76' };
var MC_V76_HEAD_ = {
  SC: ['ScenarioID', 'Тип', 'Название', 'Применимо', 'Причина неприменимости', 'Влияние на безопасность', 'Немедленные действия', 'Решения по продукции',
    'Уведомить внутри', 'Уведомить вне', 'Применимые требования', 'Ответственный', 'Тест: раз в, мес.', 'Тест неосуществим — причина', 'Версия', 'Статус',
    'Актуализировать', 'Внёс', 'Внесено', 'Утвердил', 'Утверждено', 'Последний тест', 'OperationID'],
  IN: ['IncidentID', 'Номер', 'ScenarioID', 'Тип', 'Начало', 'Окончание', 'Описание', 'Места (JSON)', 'Оборудование', 'Применимые требования', 'Уведомления (JSON)',
    'Действия', 'Решения по продукции', 'RecallID', 'Нужна актуализация', 'Что актуализировать', 'Статус', 'Открыл', 'Должность', 'Открыто', 'Закрыл', 'Закрыто',
    'PDF', 'PDF SHA-256', 'OperationID'],
  TS: ['TestID', 'ScenarioID', 'Версия сценария', 'Дата', 'Способ', 'Участники', 'Результат', 'Выявлено', 'Нужна актуализация', 'Что актуализировать', 'Провёл', 'Внесено', 'OperationID'],
  EQ: ['EquipmentID', 'Вид', 'Ртутный', 'Межповерочный интервал, мес.', 'Защита от регулировок', 'Защита от повреждений', 'Изменил', 'Изменено', 'OperationID'],
  CAL: ['CalID', 'EquipmentID', 'Вид работ', 'Дата', 'Действует до', 'Результат', 'Документ', 'Выполнил', 'Прослеживаемость / база', 'Регулировка', 'Что отрегулировано',
    'Примечание', 'Внёс', 'Внесено', 'OperationID'],
  EV: ['EvalID', 'EquipmentID', 'Прибор', 'Причина', 'Что обнаружено', 'Обнаружено', 'Период с', 'Измерений', 'Отклонений', 'Партии (JSON)', 'Вывод', 'Обоснование',
    'Меры по прибору', 'Меры по продукции', 'RecallID', 'Статус', 'Открыл', 'Открыто', 'Закрыл', 'Закрыто', 'OperationID'],
  SW: ['SwID', 'Программа', 'Версия', 'Кто валидировал', 'Свидетельство', 'Результат', 'Ограничения', 'Изменения', 'Статус', 'Внёс', 'Внесено', 'Одобрил', 'Одобрено', 'OperationID']
};
/** Сборка, которую предприятие валидирует и одобряет (п. 8.7). Меняется с каждой сборкой. */
var MC_V76_BUILD_ = 'MON CHEF 1.0, сборка 18.11.2026';
// типы ситуаций: ГОСТ Р ИСО 22000-2019 п. 8.4.2, примечание; требование — только сверенное по тексту
var MC_V76_ETYPE_ = [
  ['WATER', 'Отключение холодного или горячего водоснабжения', 'СанПиН 2.3/2.4.4282-26, п. 18 — исправные системы холодного и горячего водоснабжения'],
  ['SEWAGE', 'Авария водоотведения (канализации)', 'СанПиН 2.3/2.4.4282-26, п. 18 — исправная система водоотведения'],
  ['POWER', 'Отключение электроэнергии', 'СанПиН 2.3/2.4.4282-26, п. 18 — исправные системы вентиляции и освещения'],
  ['COLD', 'Отказ холодильного оборудования', ''],
  ['HEAT', 'Отказ теплоснабжения или вентиляции', 'СанПиН 2.3/2.4.4282-26, п. 18 — исправные системы теплоснабжения и вентиляции'],
  ['FIRE', 'Пожар, задымление', ''],
  ['NATURAL', 'Природное бедствие, экологическое происшествие', ''],
  ['PUBLIC_HEALTH', 'Чрезвычайная ситуация, угрожающая здоровью населения', ''],
  ['BIOTERROR', 'Биотерроризм, умышленное загрязнение продукции', ''],
  ['ACCIDENT', 'Несчастный случай на производстве', ''],
  ['OTHER', 'Другое', '']];
var MC_V76_PARTY_ = [['INTERNAL', 'Персонал (внутри организации)'], ['SUPPLIER', 'Поставщики'], ['CONSUMER', 'Потребители, заказчики'], ['AUTHORITY', 'Органы власти, надзор'], ['MEDIA', 'СМИ']];
var MC_V76_TMETHOD_ = [['TABLETOP', 'разбор по шагам (без остановки работы)'], ['PRACTICAL', 'практическая отработка']];
var MC_V76_KIND_ = [['THERMO_PROBE', 'Термометр-щуп (электронный)'], ['THERMO_IR', 'Инфракрасный термометр'], ['THERMO_FRIDGE', 'Термометр для холодильного оборудования'],
  ['THERMO_LIQ', 'Жидкостный термометр'], ['HYGRO', 'Гигрометр, психрометр'], ['SCALE', 'Весы'], ['OTHER', 'Другое']];
var MC_V76_CALKIND_ = [['VERIFICATION', 'Поверка (свидетельство или запись о поверке)'], ['CALIBRATION', 'Калибровка (сертификат калибровки)'], ['CHECK', 'Внутренняя проверка по контрольному прибору']];
var MC_V76_EQACT_ = [['ADJUSTED', 'отрегулирован'], ['REPAIRED', 'отремонтирован'], ['REPLACED', 'заменён другим прибором'], ['RETIRED', 'выведен из эксплуатации'], ['OTHER', 'другое']];
var MC_V76_CONCL_ = [['VALID', 'измерения достоверны'], ['PARTIAL', 'достоверны частично'], ['INVALID', 'недостоверны']];
var MC_V76_EVREASON_ = [['FAILED', 'поверка, калибровка или проверка: не соответствует'], ['FAULT', 'неисправность, повреждение, расхождение показаний']];
var MC_V76_SWBY_ = [['SUPPLIER', 'поставщик программы'], ['THIRD_PARTY', 'третья сторона'], ['ORGANIZATION', 'организация (своя проверка)']];
var MC_V76_SWRES_ = [['VALIDATED', 'валидирована'], ['LIMITED', 'валидирована с ограничениями'], ['NOT_VALIDATED', 'не валидирована']];
var MC_V76_EM_VIEW_ = 'haccp|haccp_view|haccp_approve|ttk_approve', MC_V76_EM_DECL_ = 'haccp|haccp_approve|ttk_approve', MC_V76_EM_EDIT_ = 'haccp|haccp_approve';
var MC_V76_ME_VIEW_ = 'haccp|haccp_view|haccp_approve|ttk_approve', MC_V76_ME_EDIT_ = 'haccp|haccp_approve', MC_V76_ME_FAULT_ = 'haccp|haccp_approve|ttk_approve';
var MC_V76_TOP_ = 'haccp_approve';

/* ---------------- листы и помощники ---------------- */
function _v76Sh_(k) {
  var H = MC_V76_HEAD_[k], sh = _bcSheet_(MC_V76_[k], H);
  if (String(sh.getRange(1, H.length).getValue() || '') !== H[H.length - 1]) sh.getRange(1, 1, 1, H.length).setValues([H]);
  return sh;
}
function _v76Rows_(k) {
  var v = _v76Sh_(k).getDataRange().getValues(), H = MC_V76_HEAD_[k], out = [];
  for (var i = 1; i < v.length; i++) { if (!v[i][0]) continue; var o = { _row: i + 1 }; H.forEach(function (h, j) { o[h] = v[i][j]; }); out.push(o); }
  return out;
}
function _v76Append_(k, o) { _v76Sh_(k).appendRow(MC_V76_HEAD_[k].map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; })); }
function _v76Set_(k, row, f) { var H = MC_V76_HEAD_[k], sh = _v76Sh_(k); Object.keys(f).forEach(function (h) { var c = H.indexOf(h); if (c >= 0) sh.getRange(row, c + 1).setValue(f[h]); }); }
function _v76Id_(p) { return p + '-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd') + '-' + Utilities.getUuid().slice(0, 8).toUpperCase(); }
function _v76J_(x, d) { if (x && typeof x === 'object') return x; try { return JSON.parse(String(x || '')) || d; } catch (e) { return d; } }
function _v76Ref_(list, code) { for (var i = 0; i < list.length; i++) if (list[i][0] === code) return list[i]; return null; }
function _v76Lo_(s) { return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
function _v76S_(x) { return String(x == null ? '' : x).trim(); }
function _v76Yes_(x) { return x === true || x === 'true' || x === 'да' || x === 1 || x === '1'; }
function _v76No_(x) { return x === false || x === 'false' || x === 'нет' || x === 0 || x === '0'; }
function _v76Date_(x) {
  if (x instanceof Date) return isNaN(x.getTime()) ? null : x;
  var s = _v76S_(x), m; if (!s) return null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s))) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  if ((m = /^(\d{2})\.(\d{2})\.(\d{4})(?:,? (\d{2}):(\d{2}))?/.exec(s))) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  return null;
}
function _v76Fmt_(d) { d = _v76Date_(d); return d ? Utilities.formatDate(d, _mcTz_(), 'dd.MM.yyyy HH:mm') : ''; }
function _v76Day_(d) { d = _v76Date_(d); return d ? Utilities.formatDate(d, _mcTz_(), 'dd.MM.yyyy') : ''; }
function _v76Who_(op) { var a = _author_(op); return { name: a.фио, role: a.должность || a.роль || '', id: a.id || '' }; }
function _v76Fail_(op, code, msg) { _endOp_(op, 'FAILED'); return _fail_(code, msg, op.id); }
function _v76Staff_() { try { return JSON.parse(getEmployees() || '[]').filter(function (e) { return e.active !== false; }).map(function (e) { return { name: e.name, position: e.position || '' }; }); } catch (e) { return []; } }
function _v76AddMonths_(d, n) { var x = new Date(d.getTime()); x.setMonth(x.getMonth() + n); return x; }
function _v76Today_() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function _v76Batches_() {
  var B = {}, P = {};
  try { B = _v74Batches_(); P = _v74Passes_(); } catch (e) { try { var v = _stockBatchesSheet_().getDataRange().getValues(); for (var i = 1; i < v.length; i++) if (v[i][0]) B[String(v[i][0])] = v[i]; } catch (e2) {} }
  return { B: B, P: P };
}
function _v76Batch_(id, X) {
  var r = X.B[id]; if (!r) return { id: id, missing: true, product: '', remain: 0, unit: '', status: '', location: '' };
  return { id: id, product: String(r[1] || ''), unit: String(r[2] || ''), remain: Number(String(r[9] || 0).replace(',', '.')) || 0, status: String(r[10] || 'active'),
    location: String(r[14] || ''), locationName: typeof _mcBlLocName_ === 'function' ? _mcBlLocName_(r[14]) : String(r[14] || ''), expiry: _v76Day_(r[5]) };
}
function _v76RecallExists_(id) {
  if (!id) return true;
  try { return _v74Rows_('R').some(function (r) { return String(r.RecallID) === String(id) || String(r['Номер']) === String(id); }); } catch (e) { return false; }
}

/* ======================= п. 8.4 — чрезвычайные ситуации ======================= */
function _v76Scenarios_() {
  var today = _v76Today_();
  return _v76Rows_('SC').filter(function (r) { return String(r['Статус']) !== 'ARCHIVED'; }).map(function (r) {
    var t = _v76Ref_(MC_V76_ETYPE_, String(r['Тип'])) || ['', String(r['Тип']), ''], app = _v76Yes_(r['Применимо']), months = Number(r['Тест: раз в, мес.']) || null;
    var last = _v76Date_(r['Последний тест']), st = String(r['Статус']), live = st === 'APPROVED' || st === 'NEEDS_UPDATE';
    var due = !!(app && live && months && (!last || _v76AddMonths_(last, months).getTime() < today.getTime()));
    return { id: String(r.ScenarioID), type: String(r['Тип']), typeName: t[1], name: String(r['Название']), applicable: app, naReason: String(r['Причина неприменимости'] || ''),
      impact: String(r['Влияние на безопасность'] || ''), actions: String(r['Немедленные действия'] || ''), productRule: String(r['Решения по продукции'] || ''),
      internal: String(r['Уведомить внутри'] || ''), external: String(r['Уведомить вне'] || ''), requirements: String(r['Применимые требования'] || ''),
      responsible: String(r['Ответственный'] || ''), testMonths: months, testNA: String(r['Тест неосуществим — причина'] || ''), version: Number(r['Версия']) || 1,
      status: st, updateWhat: String(r['Актуализировать'] || ''), by: String(r['Внёс'] || ''), at: _v76Fmt_(r['Внесено']), approvedBy: String(r['Утвердил'] || ''),
      approvedAt: _v76Fmt_(r['Утверждено']), lastTest: _v76Day_(last), testDue: due, nextTest: app && months ? (last ? _v76Day_(_v76AddMonths_(last, months)) : 'не проводился') : '', _row: r._row };
  });
}
/** Сценарий (процедура) реагирования. Изменение утверждённого — новая версия, снова на утверждение руководства (8.4.1). */
function v76SaveScenario(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_EM_EDIT_, 'EMERGENCY_SCENARIO', 'ЧС', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v76J_(json, {}), t = _v76Ref_(MC_V76_ETYPE_, String(d.type || ''));
    if (!t) return _v76Fail_(op, 'VALIDATION', 'Выберите тип ситуации');
    if (!_v76Yes_(d.applicable) && !_v76No_(d.applicable)) return _v76Fail_(op, 'VALIDATION', 'Укажите, применима ли ситуация к предприятию');
    var app = _v76Yes_(d.applicable), name = _v76S_(d.name) || t[1], f = {};
    if (!app) {
      if (_v76S_(d.naReason).length < 10) return _v76Fail_(op, 'VALIDATION', 'Неприменимо — напишите почему (не короче 10 знаков)');
      f = { 'Применимо': 'нет', 'Причина неприменимости': _v76S_(d.naReason) };
      ['Влияние на безопасность', 'Немедленные действия', 'Решения по продукции', 'Уведомить внутри', 'Уведомить вне', 'Применимые требования', 'Ответственный', 'Тест: раз в, мес.', 'Тест неосуществим — причина'].forEach(function (k) { f[k] = ''; });
    } else {
      var need = [['impact', 'Как ситуация влияет на безопасность продукции', 10], ['actions', 'Немедленные действия', 10], ['productRule', 'Как решать судьбу продукции', 10],
        ['internal', 'Кого уведомить внутри', 3], ['external', 'Кого уведомить вне (поставщики, потребители, органы, СМИ)', 3]];
      var miss = need.filter(function (x) { return _v76S_(d[x[0]]).length < x[2]; }).map(function (x) { return x[1]; });
      if (miss.length) return _v76Fail_(op, 'VALIDATION', 'Заполните: ' + miss.join('; '));
      var staff = _v76Staff_(), resp = _v76S_(d.responsible);
      if (!resp || !staff.some(function (e) { return _v76Lo_(e.name) === _v76Lo_(resp); })) return _v76Fail_(op, 'VALIDATION', 'Ответственный — из действующих сотрудников');
      var m = d.testMonths === '' || d.testMonths == null ? '' : Number(d.testMonths), na = _v76S_(d.testNA);
      if (m !== '' && !(m >= 1 && m <= 36 && Math.round(m) === m)) return _v76Fail_(op, 'VALIDATION', 'Тестирование: раз в 1–36 месяцев');
      if (m === '' && na.length < 5) return _v76Fail_(op, 'VALIDATION', 'Укажите, как часто тестировать процедуру, или почему тестирование неосуществимо (п. 8.4.2 c)');
      f = { 'Применимо': 'да', 'Причина неприменимости': '', 'Влияние на безопасность': _v76S_(d.impact), 'Немедленные действия': _v76S_(d.actions), 'Решения по продукции': _v76S_(d.productRule),
        'Уведомить внутри': _v76S_(d.internal), 'Уведомить вне': _v76S_(d.external), 'Применимые требования': _v76S_(d.requirements), 'Ответственный': staff.filter(function (e) { return _v76Lo_(e.name) === _v76Lo_(resp); })[0].name,
        'Тест: раз в, мес.': m, 'Тест неосуществим — причина': m === '' ? na : '' };
    }
    return _withLock_(function () {
      var who = _v76Who_(op), now = new Date(), ex = d.id ? _v76Rows_('SC').filter(function (r) { return String(r.ScenarioID) === String(d.id); })[0] : null;
      if (d.id && !ex) return _v76Fail_(op, 'NOT_FOUND', 'Сценарий не найден');
      f['Тип'] = t[0]; f['Название'] = name; f['Статус'] = 'DRAFT'; f['Внёс'] = who.name; f['Внесено'] = now; f['Утвердил'] = ''; f['Утверждено'] = ''; f.OperationID = op.id;
      var id;
      if (ex) { id = String(ex.ScenarioID); f['Версия'] = (Number(ex['Версия']) || 1) + 1; f['Актуализировать'] = ex['Актуализировать'] || ''; _v76Set_('SC', ex._row, f); }
      else { id = _v76Id_('SCN'); f.ScenarioID = id; f['Версия'] = 1; _v76Append_('SC', f); }
      _audit_(op, 'EMERGENCY_SCENARIO', 'ЧС', id, ex ? { version: ex['Версия'], status: ex['Статус'] } : null, { type: t[0], name: name, applicable: app, version: f['Версия'] });
      _endOp_(op); return _ok_({ id: id, version: f['Версия'], status: 'DRAFT' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Утверждение руководством (8.4.1: высшее руководство обеспечивает внедрение процедур). */
function v76ApproveScenario(id, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_TOP_, 'EMERGENCY_SCENARIO_APPROVE', 'ЧС', id, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var r = _v76Rows_('SC').filter(function (x) { return String(x.ScenarioID) === String(id); })[0];
      if (!r) return _v76Fail_(op, 'NOT_FOUND', 'Сценарий не найден');
      if (String(r['Статус']) !== 'DRAFT') return _v76Fail_(op, 'STATE', 'Утверждается только новая версия (черновик)');
      var who = _v76Who_(op);
      _v76Set_('SC', r._row, { 'Статус': 'APPROVED', 'Актуализировать': '', 'Утвердил': who.name + (who.role ? ', ' + who.role : ''), 'Утверждено': new Date() });
      _audit_(op, 'EMERGENCY_SCENARIO_APPROVE', 'ЧС', id, { status: 'DRAFT' }, { status: 'APPROVED', version: r['Версия'] });
      _endOp_(op); return _ok_({ id: String(id), version: Number(r['Версия']) || 1 }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v76MarkUpdate_(scenarioId, what) {
  if (!scenarioId) return;
  var r = _v76Rows_('SC').filter(function (x) { return String(x.ScenarioID) === String(scenarioId); })[0];
  if (r && String(r['Статус']) !== 'DRAFT') _v76Set_('SC', r._row, { 'Статус': 'NEEDS_UPDATE', 'Актуализировать': what });
}
/** Тест процедуры (8.4.2 c) и анализ по его итогам (8.4.2 d). */
function v76SaveTest(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_EM_EDIT_, 'EMERGENCY_TEST', 'ЧС', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v76J_(json, {}), dt = _v76Date_(d.date), m = _v76Ref_(MC_V76_TMETHOD_, String(d.method || ''));
    if (!dt || dt.getTime() > Date.now()) return _v76Fail_(op, 'VALIDATION', 'Дата теста — не позже сегодняшней');
    if (!m) return _v76Fail_(op, 'VALIDATION', 'Укажите способ: разбор по шагам или практическая отработка');
    if (_v76S_(d.participants).length < 3) return _v76Fail_(op, 'VALIDATION', 'Укажите участников');
    if (['OK', 'ISSUES'].indexOf(String(d.result)) < 0) return _v76Fail_(op, 'VALIDATION', 'Укажите результат');
    if (String(d.result) === 'ISSUES' && _v76S_(d.findings).length < 5) return _v76Fail_(op, 'VALIDATION', 'Опишите, что выявлено');
    if (!_v76Yes_(d.needUpdate) && !_v76No_(d.needUpdate)) return _v76Fail_(op, 'VALIDATION', 'Ответьте, нужна ли актуализация процедуры (п. 8.4.2 d)');
    if (_v76Yes_(d.needUpdate) && _v76S_(d.updateWhat).length < 5) return _v76Fail_(op, 'VALIDATION', 'Напишите, что актуализировать');
    return _withLock_(function () {
      var s = _v76Scenarios_().filter(function (x) { return x.id === String(d.scenarioId); })[0];
      if (!s) return _v76Fail_(op, 'NOT_FOUND', 'Сценарий не найден');
      if (!s.applicable || (s.status !== 'APPROVED' && s.status !== 'NEEDS_UPDATE')) return _v76Fail_(op, 'STATE', 'Тестируется утверждённая и применимая процедура');
      var who = _v76Who_(op), id = _v76Id_('EMT');
      _v76Append_('TS', { TestID: id, ScenarioID: s.id, 'Версия сценария': s.version, 'Дата': dt, 'Способ': m[0], 'Участники': _v76S_(d.participants), 'Результат': String(d.result),
        'Выявлено': _v76S_(d.findings), 'Нужна актуализация': _v76Yes_(d.needUpdate) ? 'да' : 'нет', 'Что актуализировать': _v76S_(d.updateWhat), 'Провёл': who.name, 'Внесено': new Date(), OperationID: op.id });
      var last = _v76Date_(s.lastTest); if (!last || dt.getTime() > last.getTime()) _v76Set_('SC', s._row, { 'Последний тест': dt });
      if (_v76Yes_(d.needUpdate)) _v76MarkUpdate_(s.id, 'по тесту ' + _v76Day_(dt) + ': ' + _v76S_(d.updateWhat));
      _audit_(op, 'EMERGENCY_TEST', 'ЧС', id, null, { scenario: s.id, result: d.result, needUpdate: _v76Yes_(d.needUpdate) });
      _endOp_(op); return _ok_({ id: id, needUpdate: _v76Yes_(d.needUpdate) }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v76Incidents_() {
  return _v76Rows_('IN').map(function (r) {
    var t = _v76Ref_(MC_V76_ETYPE_, String(r['Тип'])) || ['', String(r['Тип'])];
    return { id: String(r.IncidentID), num: String(r['Номер']), scenarioId: String(r.ScenarioID || ''), type: String(r['Тип']), typeName: t[1], startedAt: _v76Fmt_(r['Начало']),
      endedAt: _v76Fmt_(r['Окончание']), description: String(r['Описание'] || ''), locations: _v76J_(r['Места (JSON)'], []), equipment: String(r['Оборудование'] || ''),
      requirements: String(r['Применимые требования'] || ''), notes: _v76J_(r['Уведомления (JSON)'], {}), actions: String(r['Действия'] || ''), productDecision: String(r['Решения по продукции'] || ''),
      recallId: String(r.RecallID || ''), needUpdate: String(r['Нужна актуализация'] || ''), updateWhat: String(r['Что актуализировать'] || ''), status: String(r['Статус']),
      openedBy: String(r['Открыл'] || ''), openedRole: String(r['Должность'] || ''), openedAt: _v76Fmt_(r['Открыто']), closedBy: String(r['Закрыл'] || ''), closedAt: _v76Fmt_(r['Закрыто']),
      pdf: String(r.PDF || ''), sha: String(r['PDF SHA-256'] || ''), _start: _v76Date_(r['Начало']), _end: _v76Date_(r['Окончание']), _row: r._row };
  });
}
/** Сообщить о ЧС (аварии) — шеф-повар может сразу, ночью и без ответственного за ХАССП. */
function v76OpenIncident(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_EM_DECL_, 'EMERGENCY_OPEN', 'ЧС', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v76J_(json, {}), st = _v76Date_(d.startedAt);
    if (!st || st.getTime() > Date.now() + 60000) return _v76Fail_(op, 'VALIDATION', 'Укажите, когда началось (не позже текущего времени)');
    if (_v76S_(d.description).length < 10) return _v76Fail_(op, 'VALIDATION', 'Опишите, что произошло (не короче 10 знаков)');
    var s = d.scenarioId ? _v76Scenarios_().filter(function (x) { return x.id === String(d.scenarioId); })[0] : null;
    if (d.scenarioId && !s) return _v76Fail_(op, 'NOT_FOUND', 'Сценарий не найден');
    var type = s ? s.type : String(d.type || ''); if (!_v76Ref_(MC_V76_ETYPE_, type)) return _v76Fail_(op, 'VALIDATION', 'Выберите сценарий или тип ситуации');
    var locs = (Array.isArray(d.locations) ? d.locations : []).map(String).filter(String);
    if (locs.length && typeof _mcBlLoc_ === 'function') { var bad = locs.filter(function (l) { return !_mcBlLoc_(l); }); if (bad.length) return _v76Fail_(op, 'VALIDATION', 'Место хранения не найдено: ' + bad.join(', ')); }
    return _withLock_(function () {
      var who = _v76Who_(op), now = new Date(), y = Utilities.formatDate(now, _mcTz_(), 'yyyy'), rs = _v76Rows_('IN');
      var n = rs.filter(function (r) { return String(r['Номер']).indexOf('ЧС-' + y + '-') === 0; }).length + 1, num = 'ЧС-' + y + '-' + ('00' + n).slice(-3), id = _v76Id_('INC');
      var req = _v76S_(d.requirements) || (s && s.requirements) || (_v76Ref_(MC_V76_ETYPE_, type) || [])[2] || '';
      _v76Append_('IN', { IncidentID: id, 'Номер': num, ScenarioID: s ? s.id : '', 'Тип': type, 'Начало': st, 'Описание': _v76S_(d.description), 'Места (JSON)': JSON.stringify(locs),
        'Оборудование': _v76S_(d.equipment), 'Применимые требования': req, 'Уведомления (JSON)': '{}', 'Статус': 'OPEN', 'Открыл': who.name, 'Должность': who.role, 'Открыто': now, OperationID: op.id });
      _audit_(op, 'EMERGENCY_OPEN', 'ЧС', id, null, { num: num, type: type, scenario: s ? s.id : '', locations: locs });
      _endOp_(op); return _ok_({ id: id, num: num, scenarioActions: s ? s.actions : '' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v76Inc_(op, id) {
  var c = _v76Incidents_().filter(function (x) { return x.id === String(id) || x.num === String(id); })[0];
  if (!c) return { err: _v76Fail_(op, 'NOT_FOUND', 'ЧС не найдена') };
  if (c.status !== 'OPEN') return { err: _v76Fail_(op, 'STATE', 'ЧС ' + c.num + ' уже закрыта') };
  return { c: c };
}
/** Уведомление (8.4.2 a 2–3): персонал — обязательно; поставщики, потребители, органы, СМИ — «уведомлены» или «не требуется» с причиной. */
function v76IncidentNote(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_EM_DECL_, 'EMERGENCY_NOTE', 'ЧС', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v76J_(json, {}), p = _v76Ref_(MC_V76_PARTY_, String(d.party || '')), nr = _v76Yes_(d.notRequired);
    if (!p) return _v76Fail_(op, 'VALIDATION', 'Кого уведомляли?');
    if (nr && p[0] === 'INTERNAL') return _v76Fail_(op, 'VALIDATION', 'Персонал уведомляется всегда (п. 8.4.2 a 2)');
    if (nr && _v76S_(d.reason).length < 5) return _v76Fail_(op, 'VALIDATION', 'Напишите, почему уведомление не требуется');
    if (!nr && (_v76S_(d.whom).length < 2 || _v76S_(d.how).length < 2 || _v76S_(d.what).length < 5)) return _v76Fail_(op, 'VALIDATION', 'Укажите кого, как и что сообщили');
    return _withLock_(function () {
      var x = _v76Inc_(op, d.id); if (x.err) return x.err; var c = x.c, who = _v76Who_(op), n = c.notes || {};
      n[p[0]] = nr ? { notRequired: true, reason: _v76S_(d.reason), by: who.name, at: _v76Fmt_(new Date()) } : { whom: _v76S_(d.whom), how: _v76S_(d.how), what: _v76S_(d.what), by: who.name, at: _v76Fmt_(new Date()) };
      _v76Set_('IN', c._row, { 'Уведомления (JSON)': JSON.stringify(n) });
      _audit_(op, 'EMERGENCY_NOTE', 'ЧС', c.id, null, { party: p[0], notRequired: nr });
      _endOp_(op); return _ok_({ id: c.id, party: p[0] }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Ход ЧС: действия (8.4.2 b), применимые требования (a 1), решения по продукции, места хранения, отзыв. */
function v76IncidentUpdate(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_EM_DECL_, 'EMERGENCY_UPDATE', 'ЧС', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v76J_(json, {});
    if (d.recallId && !_v76RecallExists_(d.recallId)) return _v76Fail_(op, 'NOT_FOUND', 'Отзыв ' + d.recallId + ' не найден');
    return _withLock_(function () {
      var x = _v76Inc_(op, d.id); if (x.err) return x.err; var c = x.c, f = {};
      if (d.actions !== undefined) f['Действия'] = _v76S_(d.actions);
      if (d.requirements !== undefined) f['Применимые требования'] = _v76S_(d.requirements);
      if (d.productDecision !== undefined) f['Решения по продукции'] = _v76S_(d.productDecision);
      if (d.recallId !== undefined) f.RecallID = _v76S_(d.recallId);
      if (Array.isArray(d.locations)) {
        var locs = d.locations.map(String).filter(String);
        if (typeof _mcBlLoc_ === 'function') { var bad = locs.filter(function (l) { return !_mcBlLoc_(l); }); if (bad.length) return _v76Fail_(op, 'VALIDATION', 'Место хранения не найдено: ' + bad.join(', ')); }
        f['Места (JSON)'] = JSON.stringify(locs);
      }
      _v76Set_('IN', c._row, f);
      _audit_(op, 'EMERGENCY_UPDATE', 'ЧС', c.id, null, Object.keys(f));
      _endOp_(op); return _ok_({ id: c.id }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Кандидаты: партии с остатком в затронутых местах хранения; отклонения температур за время ЧС. */
function _v76IncidentEvidence_(c) {
  var out = { batches: [], deviations: [] }, locs = c.locations || [];
  if (locs.length) {
    var X = _v76Batches_();
    Object.keys(X.B).forEach(function (id) { var b = _v76Batch_(id, X); if (b.remain > 0 && locs.indexOf(b.location) >= 0) out.batches.push(b); });
  }
  try {
    var v = _tSheet_().getDataRange().getValues(), a = c._start ? c._start.getTime() : 0, z = c._end ? c._end.getTime() : Date.now();
    for (var i = 1; i < v.length && out.deviations.length < 50; i++) {
      if (!v[i][0] || String(v[i][11]) !== 'DEVIATION') continue;
      var t = _v76Date_(v[i][10]); if (!t || t.getTime() < a || t.getTime() > z) continue;
      out.deviations.push({ at: _v76Fmt_(t), object: String(v[i][2] || ''), value: v[i][7], unit: String(v[i][8] || ''), range: [v[i][5], v[i][6]].join('…'), batchId: String(v[i][14] || '') });
    }
  } catch (e) {}
  return out;
}
/** Закрыть ЧС: окончание, действия, требования, решения по продукции, все уведомления, анализ (8.4.2 d) → отчёт PDF. */
function v76CloseIncident(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_EM_EDIT_, 'EMERGENCY_CLOSE', 'ЧС', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v76J_(json, {});
    if (d.recallId && !_v76RecallExists_(d.recallId)) return _v76Fail_(op, 'NOT_FOUND', 'Отзыв ' + d.recallId + ' не найден');
    return _withLock_(function () {
      var x = _v76Inc_(op, d.id); if (x.err) return x.err; var c = x.c;
      var end = _v76Date_(d.endedAt);
      if (!end || end.getTime() > Date.now() + 60000 || (c._start && end.getTime() < c._start.getTime())) return _v76Fail_(op, 'VALIDATION', 'Окончание — после начала и не позже текущего времени');
      var actions = _v76S_(d.actions !== undefined ? d.actions : c.actions), reqs = _v76S_(d.requirements !== undefined ? d.requirements : c.requirements),
        prod = _v76S_(d.productDecision !== undefined ? d.productDecision : c.productDecision), rid = _v76S_(d.recallId !== undefined ? d.recallId : c.recallId);
      if (actions.length < 10) return _v76Fail_(op, 'VALIDATION', 'Опишите действия по устранению и смягчению последствий (п. 8.4.2 b)');
      if (reqs.length < 3) return _v76Fail_(op, 'VALIDATION', 'Укажите применимые требования (п. 8.4.2 a 1)');
      if (prod.length < 3) return _v76Fail_(op, 'VALIDATION', 'Укажите решения по продукции (или «продукция не затронута» с основанием)');
      var n = c.notes || {}, miss = MC_V76_PARTY_.filter(function (p) { return !n[p[0]]; }).map(function (p) { return p[1]; });
      if (miss.length) return _v76Fail_(op, 'VALIDATION', 'Нет решения об уведомлении: ' + miss.join(', '));
      if (!_v76Yes_(d.needUpdate) && !_v76No_(d.needUpdate)) return _v76Fail_(op, 'VALIDATION', 'Анализ: нужна ли актуализация процедуры (п. 8.4.2 d)?');
      if (_v76Yes_(d.needUpdate) && _v76S_(d.updateWhat).length < 5) return _v76Fail_(op, 'VALIDATION', 'Напишите, что актуализировать');
      var who = _v76Who_(op), now = new Date();
      _v76Set_('IN', c._row, { 'Окончание': end, 'Действия': actions, 'Применимые требования': reqs, 'Решения по продукции': prod, RecallID: rid,
        'Нужна актуализация': _v76Yes_(d.needUpdate) ? 'да' : 'нет', 'Что актуализировать': _v76S_(d.updateWhat), 'Статус': 'CLOSED', 'Закрыл': who.name + (who.role ? ', ' + who.role : ''), 'Закрыто': now });
      if (_v76Yes_(d.needUpdate)) _v76MarkUpdate_(c.scenarioId, 'по ' + c.num + ': ' + _v76S_(d.updateWhat));
      var c2 = _v76Incidents_().filter(function (z) { return z.id === c.id; })[0], pdf = null;
      try { pdf = _mcPdfSave_('Отчёт о чрезвычайной ситуации (аварии) ' + c2.num, _v76IncidentBody_(c2), { fileName: 'ЧС ' + c2.num, subtitle: 'ГОСТ Р ИСО 22000-2019 п. 8.4.2' });
        _v76Set_('IN', c._row, { PDF: pdf.fileId, 'PDF SHA-256': pdf.sha256 }); } catch (e) {}
      _audit_(op, 'EMERGENCY_CLOSE', 'ЧС', c.id, { status: 'OPEN' }, { status: 'CLOSED', needUpdate: _v76Yes_(d.needUpdate), pdf: pdf ? pdf.fileId : '', sha256: pdf ? pdf.sha256 : '' });
      _endOp_(op); return _ok_({ id: c.id, num: c.num, fileId: pdf ? pdf.fileId : '', url: pdf ? pdf.url : '', sha256: pdf ? pdf.sha256 : '' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v76IncidentBody_(c) {
  var E = _mcOrgEsc_, row = function (a) { return '<tr>' + a.map(function (x) { return '<td>' + E(x === undefined || x === null ? '' : x) + '</td>'; }).join('') + '</tr>'; };
  var s = c.scenarioId ? _v76Scenarios_().filter(function (x) { return x.id === c.scenarioId; })[0] : null, ev = _v76IncidentEvidence_(c);
  var h = '<table class="r">' + row(['Номер', c.num]) + row(['Тип', c.typeName]) + row(['Сценарий', s ? s.name + ' (версия ' + s.version + ')' : 'не выбран']) + row(['Начало', c.startedAt]) + row(['Окончание', c.endedAt]) +
    row(['Что произошло', c.description]) + row(['Места хранения', (c.locations || []).map(function (l) { return typeof _mcBlLocName_ === 'function' ? _mcBlLocName_(l) : l; }).join(', ')]) + row(['Оборудование', c.equipment]) +
    row(['Сообщил', c.openedBy + (c.openedRole ? ', ' + c.openedRole : '') + ', ' + c.openedAt]) + '</table>';
  h += '<h2>Применимые требования (8.4.2 a 1)</h2><div>' + E(c.requirements) + '</div>';
  h += '<h2>Уведомления (8.4.2 a 2, a 3)</h2><table class="r"><tr><th>Кому</th><th>Кого, как</th><th>Что сообщили / почему не требуется</th><th>Кто, когда</th></tr>' + MC_V76_PARTY_.map(function (p) {
    var n = (c.notes || {})[p[0]] || null; return row([p[1], n ? (n.notRequired ? 'не требуется' : n.whom + ', ' + n.how) : 'нет решения', n ? (n.notRequired ? n.reason : n.what) : '', n ? n.by + ', ' + n.at : '']); }).join('') + '</table>';
  h += '<h2>Действия по устранению и смягчению (8.4.2 b)</h2><div>' + E(c.actions) + '</div>';
  h += '<h2>Продукция</h2><div>' + E(c.productDecision) + (c.recallId ? '<br>Отзыв: ' + E(c.recallId) : '') + '</div>';
  if (ev.batches.length) h += '<h3>Партии с остатком в затронутых местах (на момент отчёта)</h3><table class="r"><tr><th>Партия</th><th>Продукт</th><th>Остаток</th><th>Место</th><th>Статус</th></tr>' +
    ev.batches.map(function (b) { return row([b.id, b.product, b.remain + ' ' + b.unit, b.locationName, b.status]); }).join('') + '</table>';
  if (ev.deviations.length) h += '<h3>Отклонения температур за время ЧС</h3><table class="r"><tr><th>Когда</th><th>Объект</th><th>Факт</th><th>Норма</th><th>Партия</th></tr>' +
    ev.deviations.map(function (x) { return row([x.at, x.object, x.value + ' ' + x.unit, x.range, x.batchId]); }).join('') + '</table>';
  h += '<h2>Анализ после ЧС (8.4.2 d)</h2><div>' + (c.needUpdate === 'да' ? 'Процедура требует актуализации: ' + E(c.updateWhat) : 'Актуализация процедуры не требуется.' + (c.updateWhat ? ' ' + E(c.updateWhat) : '')) + '</div>';
  h += '<div class="sign">Закрыл: ' + E(c.closedBy) + ', ' + E(c.closedAt) + '<br><br>Подпись ____________________</div>';
  return h;
}
function _v76EmReady_(S, I) {
  var it = [], add = function (ok, name, detail, ref) { it.push({ ok: !!ok, name: name, detail: detail, ref: ref }); };
  var drafts = S.filter(function (s) { return s.status === 'DRAFT'; }), live = S.filter(function (s) { return s.status === 'APPROVED' || s.status === 'NEEDS_UPDATE'; });
  add(S.length > 0 && !drafts.length, 'Процедуры на случай ЧС и аварий утверждены руководством', S.length ? (drafts.length ? 'на утверждении: ' + drafts.map(function (s) { return s.name + ' (в. ' + s.version + ')'; }).join(', ') : 'утверждено: ' + live.length) : 'сценариев нет', '8.4.1');
  var miss = ['WATER', 'POWER', 'COLD'].filter(function (t) { return !live.some(function (s) { return s.type === t; }); });
  add(!miss.length, 'Рассмотрены сбои водоснабжения, электроэнергии, холода', miss.length ? 'нет утверждённого сценария: ' + miss.map(function (t) { return _v76Ref_(MC_V76_ETYPE_, t)[1]; }).join('; ') : 'да', '8.4.2, примечание');
  var noPlan = live.filter(function (s) { return s.applicable && !s.testMonths && !s.testNA; }), due = live.filter(function (s) { return s.testDue; });
  add(live.length > 0 && !noPlan.length && !due.length, 'Процедуры тестируются по графику', !live.length ? 'нет утверждённых процедур' : due.length ? 'пора провести: ' + due.map(function (s) { return s.name; }).join(', ') : noPlan.length ? 'периодичность не задана: ' + noPlan.map(function (s) { return s.name; }).join(', ') : 'в срок', '8.4.2 c');
  var nu = S.filter(function (s) { return s.status === 'NEEDS_UPDATE'; });
  add(!nu.length, 'После ЧС и тестов процедуры проанализированы и актуализированы', nu.length ? 'актуализировать: ' + nu.map(function (s) { return s.name + ' — ' + s.updateWhat; }).join('; ') : 'да', '8.4.2 d');
  var open = I.filter(function (c) { return c.status === 'OPEN'; });
  add(!open.length, 'Открытых ЧС нет', open.length ? 'открыты: ' + open.map(function (c) { return c.num + ' (' + c.typeName + ', с ' + c.startedAt + ')'; }).join('; ') : 'нет', '8.4.2 a, b');
  return it;
}
function v76EmData(token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_EM_VIEW_, 'EMERGENCY_VIEW', 'ЧС', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var S = _v76Scenarios_(), I = _v76Incidents_(), items = _v76EmReady_(S, I), T = _v76Rows_('TS');
    var incidents = I.slice().reverse().map(function (c) {
      var ev = c.status === 'OPEN' ? _v76IncidentEvidence_(c) : { batches: [], deviations: [] };
      var o = {}; Object.keys(c).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = c[k]; });
      o.locationNames = (c.locations || []).map(function (l) { return typeof _mcBlLocName_ === 'function' ? _mcBlLocName_(l) : l; });
      o.candidates = ev.batches; o.deviations = ev.deviations; return o;
    });
    var tests = T.slice().reverse().map(function (r) { var s = S.filter(function (x) { return x.id === String(r.ScenarioID); })[0];
      return { id: String(r.TestID), scenario: s ? s.name : String(r.ScenarioID), version: Number(r['Версия сценария']) || 1, date: _v76Day_(r['Дата']), method: (_v76Ref_(MC_V76_TMETHOD_, String(r['Способ'])) || ['', ''])[1],
        participants: String(r['Участники'] || ''), result: String(r['Результат']), findings: String(r['Выявлено'] || ''), needUpdate: String(r['Нужна актуализация']), updateWhat: String(r['Что актуализировать'] || ''), by: String(r['Провёл'] || '') }; });
    var locs = []; try { locs = _mcBlLocations_().filter(function (l) { return l.active; }).map(function (l) { return { id: l.id, name: l.name }; }); } catch (e) {}
    _endOp_(op);
    return _ok_({ ready: items, score: Math.round(items.filter(function (x) { return x.ok; }).length / items.length * 100), scenarios: S.map(function (s) { var o = {}; Object.keys(s).forEach(function (k) { if (k !== '_row') o[k] = s[k]; }); return o; }),
      incidents: incidents, tests: tests, types: MC_V76_ETYPE_.map(function (t) { return { code: t[0], name: t[1], req: t[2] }; }), parties: MC_V76_PARTY_.map(function (p) { return { code: p[0], name: p[1] }; }),
      methods: MC_V76_TMETHOD_.map(function (m) { return { code: m[0], name: m[1] }; }), locations: locs, staff: _v76Staff_() }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** PDF «Порядок действий при чрезвычайных ситуациях и авариях» (документированная информация 8.4.1). */
function v76ProcedurePdf(token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_EM_EDIT_, 'EMERGENCY_PROC_PDF', 'ЧС', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var S = _v76Scenarios_(), E = _mcOrgEsc_, nf = '<span class="bad">не заполнено</span>', h = '';
    var live = S.filter(function (s) { return s.status === 'APPROVED' || s.status === 'NEEDS_UPDATE'; }), drafts = S.filter(function (s) { return s.status === 'DRAFT'; });
    h += '<div class="muted">Процедуры утверждает руководство (п. 8.4.1). Действия, сроки и контакты внесены предприятием.</div>';
    live.filter(function (s) { return s.applicable; }).forEach(function (s, i) {
      h += '<h2>' + (i + 1) + '. ' + E(s.name) + ' <span class="muted">(' + E(s.typeName) + ', версия ' + s.version + ', утвердил ' + E(s.approvedBy) + ', ' + E(s.approvedAt) + ')</span></h2>' +
        (s.status === 'NEEDS_UPDATE' ? '<div class="bad">Требует актуализации: ' + E(s.updateWhat) + '</div>' : '') + '<table class="r">' +
        [['Как влияет на безопасность продукции', s.impact], ['Немедленные действия', s.actions], ['Решения по продукции', s.productRule], ['Уведомить внутри', s.internal],
          ['Уведомить вне (поставщики, потребители, органы, СМИ)', s.external], ['Применимые требования', s.requirements], ['Ответственный', s.responsible],
          ['Тестирование', s.testMonths ? 'не реже раза в ' + s.testMonths + ' мес.; последний — ' + (s.lastTest || 'не проводился') : 'неосуществимо: ' + s.testNA]].map(function (r) {
          return '<tr><th style="width:28%">' + E(r[0]) + '</th><td>' + (r[1] ? E(r[1]) : nf) + '</td></tr>'; }).join('') + '</table>';
    });
    var na = live.filter(function (s) { return !s.applicable; });
    if (na.length) h += '<h2>Неприменимо к предприятию</h2><table class="r">' + na.map(function (s) { return '<tr><td>' + E(s.name) + '</td><td>' + E(s.naReason) + '</td></tr>'; }).join('') + '</table>';
    if (drafts.length) h += '<h2>Не утверждено (в документ не вошло)</h2><div class="bad">' + drafts.map(function (s) { return E(s.name) + ' (версия ' + s.version + ')'; }).join(', ') + '</div>';
    if (!live.length) h += '<div class="bad">Утверждённых процедур нет.</div>';
    h += '<div class="sign">Утверждаю: руководитель ____________________ / ____________________ «___» __________ 20__ г.</div>';
    var pdf = _mcPdfSave_('Порядок действий при чрезвычайных ситуациях и авариях', h, { folder: (typeof _mcFolderSafe_ === 'function' ? _mcFolderSafe_('ppk') : null) || undefined, fileName: 'Порядок действий при ЧС ' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd'),
      subtitle: 'ГОСТ Р ИСО 22000-2019 п. 8.4; СанПиН 2.3/2.4.4282-26 п. 18' });
    _audit_(op, 'EMERGENCY_PROC_PDF', 'ЧС', 'Порядок действий', null, { fileId: pdf.fileId, sha256: pdf.sha256, approved: live.length, drafts: drafts.length });
    _endOp_(op); return _ok_({ fileId: pdf.fileId, url: pdf.url, sha256: pdf.sha256, approved: live.length, drafts: drafts.length }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ======================= п. 8.7 — средства измерения ======================= */
function _v76EqInfo_() {
  var m = {}, cal = {}, ev = {};
  try { _v76Rows_('EQ').forEach(function (r) { m[String(r.EquipmentID)] = r; }); } catch (e) {}
  try { _v76Rows_('CAL').forEach(function (r) { (cal[String(r.EquipmentID)] = cal[String(r.EquipmentID)] || []).push(r); }); } catch (e) {}
  try { _v76Rows_('EV').forEach(function (r) { (ev[String(r.EquipmentID)] = ev[String(r.EquipmentID)] || []).push(r); }); } catch (e) {}
  return { info: m, cal: cal, ev: ev };
}
/** Последняя положительная поверка (для начала периода оценки); неисправность или «не соответствует» без последующей положительной
 *  поверки/проверки → нужна новая. В один день «после» определяется по времени записи (поверка, внесённая до неисправности, её не снимает). */
function _v76CalState_(id, I) {
  var lastPass = null, passes = [], bads = [], open = null, day = function (d) { return Math.floor(_v76Today0_(d).getTime() / 86400000); };
  (I.cal[id] || []).forEach(function (r) {
    var d = _v76Date_(r['Дата']); if (!d) return; var ent = _v76Date_(r['Внесено']) || d;
    if (String(r['Результат']) === 'PASS') { passes.push({ day: day(d), t: ent }); if (!lastPass || d > lastPass) lastPass = d; }
    else bads.push({ day: day(d), t: ent });
  });
  (I.ev[id] || []).forEach(function (r) { var d = _v76Date_(r['Обнаружено']); if (d) bads.push({ day: day(d), t: d }); if (String(r['Статус']) === 'OPEN') open = r; });
  var lastBad = null; bads.forEach(function (b) { if (!lastBad || b.t > lastBad.t) lastBad = b; });
  var covered = !lastBad || passes.some(function (p) { return p.day > lastBad.day || (p.day === lastBad.day && p.t.getTime() > lastBad.t.getTime()); });
  return { lastPass: lastPass, lastBad: lastBad ? lastBad.t : null, open: open, needCal: !covered };
}
function _v76Today0_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
// Реестр приборов дополняется сведениями V76: ртутный термометр, открытая оценка и неисправность без новой поверки — прибор нельзя использовать.
(function () {
  if (typeof _mcEqList_ !== 'function') return;
  var orig = _mcEqList_;
  _mcEqList_ = function () {
    var list = orig.apply(this, arguments);
    try {
      var I = _v76EqInfo_();
      list.forEach(function (e) {
        var x = I.info[String(e.id)], st = _v76CalState_(String(e.id), I), k = x ? _v76Ref_(MC_V76_KIND_, String(x['Вид'])) : null;
        e.kind = x ? String(x['Вид'] || '') : ''; e.kindName = k ? k[1] : ''; e.mercury = x ? _v76Yes_(x['Ртутный']) || x['Ртутный'] === 'да' : false;
        e.interval = x ? x['Межповерочный интервал, мес.'] : ''; e.protectAdjust = x ? String(x['Защита от регулировок'] || '') : ''; e.protectDamage = x ? String(x['Защита от повреждений'] || '') : '';
        e.openEval = st.open ? String(st.open.EvalID) : ''; e.needCal = st.needCal;
        if (e.status !== 'ACTIVE' || e.effective !== 'ACTIVE') return;
        if (e.mercury) { e.effective = 'BLOCKED'; e.reason = 'ртутный термометр не допускается (СанПиН 2.3/2.4.4282-26, п. 48)'; }
        else if (st.open) { e.effective = 'BLOCKED'; e.reason = 'неисправность: оценка прежних измерений не закрыта'; }
        else if (st.needCal) { e.effective = 'BLOCKED'; e.reason = 'после неисправности нужна поверка или проверка с положительным результатом'; }
      });
    } catch (err) {}
    return list;
  };
})();
function _v76Eq_(id) { return _mcEqList_().filter(function (x) { return String(x.id) === String(id); })[0] || null; }
/** Сведения о средстве измерения: вид, ртутный, интервал по паспорту, защита от регулировок и повреждений (8.7 d, e). */
function v76SaveInstrument(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_ME_EDIT_, 'INSTRUMENT_INFO', 'Средства измерения', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v76J_(json, {}), e = _v76Eq_(d.equipmentId);
    if (!e) return _v76Fail_(op, 'NOT_FOUND', 'Прибор не найден в реестре');
    if (!_v76Ref_(MC_V76_KIND_, String(d.kind || ''))) return _v76Fail_(op, 'VALIDATION', 'Выберите вид средства измерения');
    if (!_v76Yes_(d.mercury) && !_v76No_(d.mercury)) return _v76Fail_(op, 'VALIDATION', 'Укажите, ртутный ли прибор');
    var iv = d.interval === '' || d.interval == null ? '' : Number(d.interval);
    if (iv !== '' && !(iv >= 1 && iv <= 120)) return _v76Fail_(op, 'VALIDATION', 'Межповерочный интервал — 1–120 месяцев (по паспорту, свидетельству или описанию типа) или пусто');
    return _withLock_(function () {
      var who = _v76Who_(op), ex = _v76Rows_('EQ').filter(function (r) { return String(r.EquipmentID) === String(e.id); })[0];
      var f = { EquipmentID: String(e.id), 'Вид': String(d.kind), 'Ртутный': _v76Yes_(d.mercury) ? 'да' : 'нет', 'Межповерочный интервал, мес.': iv, 'Защита от регулировок': _v76S_(d.protectAdjust),
        'Защита от повреждений': _v76S_(d.protectDamage), 'Изменил': who.name, 'Изменено': new Date(), OperationID: op.id };
      if (ex) _v76Set_('EQ', ex._row, f); else _v76Append_('EQ', f);
      _audit_(op, 'INSTRUMENT_INFO', 'Средства измерения', String(e.id), ex ? { kind: ex['Вид'], mercury: ex['Ртутный'] } : null, { kind: d.kind, mercury: f['Ртутный'] });
      _endOp_(op);
      return _ok_({ id: String(e.id), blocked: _v76Yes_(d.mercury), warning: _v76Yes_(d.mercury) ? 'Ртутный термометр использовать нельзя (СанПиН 2.3/2.4.4282-26, п. 48) — измерения им не принимаются' : '' }, op.id);
    });
  } catch (e2) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e2, op && op.id); }
}
function _v76Impact_(eqId, from, to) {
  var out = { count: 0, deviations: 0, byType: {}, items: [], batches: [] }, seen = {};
  try {
    var v = _tSheet_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      if (!v[i][0] || String(v[i][4]) !== String(eqId)) continue;
      var at = _v76Date_(v[i][10]); if (!at) continue;
      if (from && at.getTime() < from.getTime()) continue; if (to && at.getTime() > to.getTime()) continue;
      out.count++; var res = String(v[i][11]); if (res === 'DEVIATION') out.deviations++;
      var t = String(v[i][1] || ''); out.byType[t] = (out.byType[t] || 0) + 1;
      if (out.items.length < 200) out.items.push({ at: _v76Fmt_(at), type: t, object: String(v[i][2] || ''), value: v[i][7], unit: String(v[i][8] || ''), result: res, batchId: String(v[i][14] || ''), by: String(v[i][9] || '') });
      var b = String(v[i][14] || ''); if (b) seen[b] = 1;
    }
  } catch (e) {}
  var X = _v76Batches_(); out.batches = Object.keys(seen).map(function (id) { return _v76Batch_(id, X); });
  return out;
}
function _v76OpenEval_(op, e, reason, what, detected, I) {
  var st = _v76CalState_(String(e.id), I), from = st.lastPass || _v76Date_(e.calibrated) || null;
  if (from && from.getTime() > detected.getTime()) from = null;
  var imp = _v76Impact_(e.id, from, detected), id = _v76Id_('EVL'), who = _v76Who_(op);
  _v76Append_('EV', { EvalID: id, EquipmentID: String(e.id), 'Прибор': e.name + (e.serial ? ', зав. № ' + e.serial : ''), 'Причина': reason, 'Что обнаружено': what, 'Обнаружено': detected,
    'Период с': from || '', 'Измерений': imp.count, 'Отклонений': imp.deviations, 'Партии (JSON)': JSON.stringify(imp.batches.map(function (b) { return { id: b.id, product: b.product, remain: b.remain, unit: b.unit }; })),
    'Статус': 'OPEN', 'Открыл': who.name, 'Открыто': new Date(), OperationID: op.id });
  _audit_(op, 'INSTRUMENT_EVAL_OPEN', 'Средства измерения', String(e.id), null, { evalId: id, reason: reason, measurements: imp.count, batches: imp.batches.length });
  return { id: id, impact: imp, from: from };
}
/** Поверка, калибровка или внутренняя проверка (8.7 a, b): документ, прослеживаемость; «не соответствует» → оценка прежних измерений. */
function v76SaveCalibration(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_ME_EDIT_, 'INSTRUMENT_CAL', 'Средства измерения', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v76J_(json, {}), e = _v76Eq_(d.equipmentId), k = _v76Ref_(MC_V76_CALKIND_, String(d.kind || '')), dt = _v76Date_(d.date), till = _v76Date_(d.validUntil);
    if (!e) return _v76Fail_(op, 'NOT_FOUND', 'Прибор не найден в реестре');
    if (!e.measuring) return _v76Fail_(op, 'VALIDATION', 'Прибор не отмечен как измерительный');
    if (!k) return _v76Fail_(op, 'VALIDATION', 'Выберите вид работ: поверка, калибровка или внутренняя проверка');
    if (!dt || dt.getTime() > Date.now()) return _v76Fail_(op, 'VALIDATION', 'Дата — не позже сегодняшней');
    if (['PASS', 'FAIL'].indexOf(String(d.result)) < 0) return _v76Fail_(op, 'VALIDATION', 'Укажите результат: соответствует или не соответствует');
    if (_v76S_(d.document).length < 3) return _v76Fail_(op, 'VALIDATION', 'Укажите документ: номер свидетельства, сертификата или протокола проверки');
    if (_v76S_(d.performer).length < 3) return _v76Fail_(op, 'VALIDATION', 'Укажите, кто выполнил (организация или сотрудник)');
    if (k[0] === 'CHECK' && _v76S_(d.traceability).length < 5) return _v76Fail_(op, 'VALIDATION', 'Внутренняя проверка: укажите контрольный прибор и его поверку или иную базу проверки (п. 8.7)');
    if (String(d.result) === 'PASS' && (!till || till.getTime() <= dt.getTime())) return _v76Fail_(op, 'VALIDATION', 'Укажите, до какой даты действует результат (по документу)');
    if (_v76Yes_(d.adjusted) && _v76S_(d.adjustment).length < 3) return _v76Fail_(op, 'VALIDATION', 'Опишите, что отрегулировано (п. 8.7 b)');
    if (String(d.result) === 'FAIL' && _v76S_(d.note).length < 5) return _v76Fail_(op, 'VALIDATION', 'Не соответствует — опишите, в чём несоответствие');
    return _withLock_(function () {
      var who = _v76Who_(op), id = _v76Id_('CAL'), pass = String(d.result) === 'PASS';
      _v76Append_('CAL', { CalID: id, EquipmentID: String(e.id), 'Вид работ': k[0], 'Дата': dt, 'Действует до': pass ? till : '', 'Результат': pass ? 'PASS' : 'FAIL', 'Документ': _v76S_(d.document),
        'Выполнил': _v76S_(d.performer), 'Прослеживаемость / база': _v76S_(d.traceability), 'Регулировка': _v76Yes_(d.adjusted) ? 'да' : 'нет', 'Что отрегулировано': _v76S_(d.adjustment),
        'Примечание': _v76S_(d.note), 'Внёс': who.name, 'Внесено': new Date(), OperationID: op.id });
      var out = { id: id, result: pass ? 'PASS' : 'FAIL' };
      if (pass) {
        var cur = _v76Date_(e.calibrated);
        if (!cur || dt.getTime() >= cur.getTime()) {
          var sh = _mcEqSheet_(), v = sh.getDataRange().getValues();
          for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(e.id)) { sh.getRange(i + 1, 10, 1, 3).setValues([[dt, till, _v76S_(d.document)]]); sh.getRange(i + 1, 14, 1, 2).setValues([[new Date(), who.name]]); break; }
          out.registryUpdated = true;
        }
      } else {
        var ev = _v76OpenEval_(op, e, 'FAILED', k[1] + ' ' + _v76Day_(dt) + ': не соответствует — ' + _v76S_(d.note), dt, _v76EqInfo_());
        out.evalId = ev.id; out.measurements = ev.impact.count; out.batches = ev.impact.batches.length;
      }
      _audit_(op, 'INSTRUMENT_CAL', 'Средства измерения', String(e.id), null, { calId: id, kind: k[0], result: out.result, document: _v76S_(d.document) });
      _endOp_(op); return _ok_(out, op.id);
    });
  } catch (e2) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e2, op && op.id); }
}
/** Прибор неисправен, повреждён или показывает неверно — сообщить может шеф-повар. Прибор блокируется, открывается оценка. */
function v76ReportFault(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_ME_FAULT_, 'INSTRUMENT_FAULT', 'Средства измерения', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v76J_(json, {}), e = _v76Eq_(d.equipmentId), at = d.detectedAt ? _v76Date_(d.detectedAt) : new Date();
    if (!e) return _v76Fail_(op, 'NOT_FOUND', 'Прибор не найден в реестре');
    if (!at || at.getTime() > Date.now() + 60000) return _v76Fail_(op, 'VALIDATION', 'Когда обнаружено — не позже текущего времени');
    if (_v76S_(d.what).length < 10) return _v76Fail_(op, 'VALIDATION', 'Опишите неисправность (не короче 10 знаков): что видно, с чем сравнивали');
    return _withLock_(function () {
      var I = _v76EqInfo_(), st = _v76CalState_(String(e.id), I);
      if (st.open) return _v76Fail_(op, 'STATE', 'По прибору уже открыта оценка измерений');
      var ev = _v76OpenEval_(op, e, 'FAULT', _v76S_(d.what), at, I);
      _endOp_(op); return _ok_({ evalId: ev.id, measurements: ev.impact.count, batches: ev.impact.batches.length, from: ev.from ? _v76Day_(ev.from) : '' }, op.id);
    });
  } catch (e2) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e2, op && op.id); }
}
/** Оценка валидности прежних измерений и меры (8.7): вывод, обоснование, меры по прибору и по продукции. */
function v76CloseEval(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_ME_EDIT_, 'INSTRUMENT_EVAL_CLOSE', 'Средства измерения', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v76J_(json, {}), cc = _v76Ref_(MC_V76_CONCL_, String(d.conclusion || '')), ea = _v76Ref_(MC_V76_EQACT_, String(d.equipmentAction || ''));
    if (!cc) return _v76Fail_(op, 'VALIDATION', 'Вывод: измерения достоверны, достоверны частично или недостоверны');
    if (_v76S_(d.basis).length < 10) return _v76Fail_(op, 'VALIDATION', 'Обоснуйте вывод (не короче 10 знаков): с чем сравнили, на сколько расходились показания');
    if (!ea) return _v76Fail_(op, 'VALIDATION', 'Укажите меру по прибору');
    if (d.recallId && !_v76RecallExists_(d.recallId)) return _v76Fail_(op, 'NOT_FOUND', 'Отзыв ' + d.recallId + ' не найден');
    return _withLock_(function () {
      var r = _v76Rows_('EV').filter(function (x) { return String(x.EvalID) === String(d.id); })[0];
      if (!r) return _v76Fail_(op, 'NOT_FOUND', 'Оценка не найдена');
      if (String(r['Статус']) !== 'OPEN') return _v76Fail_(op, 'STATE', 'Оценка уже закрыта');
      var from = _v76Date_(r['Период с']), to = _v76Date_(r['Обнаружено']), imp = _v76Impact_(r.EquipmentID, from, to);
      var withStock = imp.batches.filter(function (b) { return b.remain > 0; });
      if (cc[0] !== 'VALID' && (imp.count > 0) && _v76S_(d.productAction).length < 10 && !d.recallId)
        return _v76Fail_(op, 'VALIDATION', 'Измерения не (вполне) достоверны — опишите меры по продукции' + (withStock.length ? ' (партий с остатком: ' + withStock.length + ')' : '') + ' или укажите отзыв');
      var who = _v76Who_(op), now = new Date();
      _v76Set_('EV', r._row, { 'Измерений': imp.count, 'Отклонений': imp.deviations, 'Партии (JSON)': JSON.stringify(imp.batches.map(function (b) { return { id: b.id, product: b.product, remain: b.remain, unit: b.unit }; })),
        'Вывод': cc[0], 'Обоснование': _v76S_(d.basis), 'Меры по прибору': ea[0] + (_v76S_(d.equipmentNote) ? ': ' + _v76S_(d.equipmentNote) : ''), 'Меры по продукции': _v76S_(d.productAction),
        RecallID: _v76S_(d.recallId), 'Статус': 'CLOSED', 'Закрыл': who.name + (who.role ? ', ' + who.role : ''), 'Закрыто': now });
      if (ea[0] === 'RETIRED') { var sh = _mcEqSheet_(), v = sh.getDataRange().getValues(); for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(r.EquipmentID)) { sh.getRange(i + 1, 13).setValue('RETIRED'); sh.getRange(i + 1, 14, 1, 2).setValues([[now, who.name]]); break; } }
      _audit_(op, 'INSTRUMENT_EVAL_CLOSE', 'Средства измерения', String(r.EquipmentID), { status: 'OPEN' }, { evalId: String(r.EvalID), conclusion: cc[0], equipment: ea[0], recall: _v76S_(d.recallId) });
      var e = _v76Eq_(r.EquipmentID);
      _endOp_(op); return _ok_({ id: String(r.EvalID), usable: !!(e && e.effective === 'ACTIVE'), reason: e ? e.reason || '' : '' }, op.id);
    });
  } catch (e2) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e2, op && op.id); }
}
/** Этикетки статуса поверки (8.7 c) — лист для печати. */
function v76LabelsPdf(token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_ME_EDIT_, 'INSTRUMENT_LABELS', 'Средства измерения', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var L = _mcEqList_().filter(function (e) { return (e.measuring || e.mercury) && e.status !== 'RETIRED'; }), E = _mcOrgEsc_;
    if (!L.length) return _v76Fail_(op, 'VALIDATION', 'В реестре нет измерительных приборов');
    var cell = function (e) {
      var ok = e.effective === 'ACTIVE';
      return '<td style="width:33%;border:1px dashed #888;padding:6px;vertical-align:top"><div style="font-size:11px;font-weight:bold">' + E(e.name) + '</div>' +
        '<div>' + E([e.model, e.serial ? 'зав. № ' + e.serial : '', 'ID ' + e.id].filter(String).join(' · ')) + '</div>' +
        '<div>Поверка / калибровка: ' + E(e.calibrated || '—') + '</div><div>Действует до: <b>' + E(e.nextCalibration || '—') + '</b></div>' +
        '<div style="margin-top:4px;font-size:12px;font-weight:bold;color:' + (ok ? '#2d6a2d' : '#a33') + '">' + (ok ? 'ГОДЕН К ПРИМЕНЕНИЮ' : 'НЕ ПРИМЕНЯТЬ') + '</div>' +
        (ok ? '' : '<div class="bad">' + E(e.reason || e.status) + '</div>') + '</td>';
    };
    var rows = []; for (var i = 0; i < L.length; i += 3) rows.push('<tr>' + L.slice(i, i + 3).map(cell).join('') + (L.length - i < 3 ? new Array(4 - (L.length - i)).join('<td></td>') : '') + '</tr>');
    var pdf = _mcPdfSave_('Этикетки статуса поверки средств измерения', '<div class="muted">Вырежьте и закрепите на приборе. Статус на дату печати; при новой поверке или неисправности напечатайте заново.</div><table style="width:100%;border-collapse:collapse">' + rows.join('') + '</table>',
      { fileName: 'Этикетки поверки ' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd'), subtitle: 'ГОСТ Р ИСО 22000-2019 п. 8.7 c' });
    _audit_(op, 'INSTRUMENT_LABELS', 'Средства измерения', 'Этикетки', null, { count: L.length, fileId: pdf.fileId, sha256: pdf.sha256 });
    _endOp_(op); return _ok_({ fileId: pdf.fileId, url: pdf.url, sha256: pdf.sha256, count: L.length }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Валидация программы (8.7): кто валидировал, свидетельство, результат; одобряет руководитель перед применением. */
function v76SaveSoftware(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_ME_EDIT_, 'SOFTWARE_VALIDATION', 'Программа', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v76J_(json, {}), by = _v76Ref_(MC_V76_SWBY_, String(d.validatedBy || '')), res = _v76Ref_(MC_V76_SWRES_, String(d.result || ''));
    if (_v76S_(d.version).length < 3) return _v76Fail_(op, 'VALIDATION', 'Укажите версию (сборку)');
    if (!by) return _v76Fail_(op, 'VALIDATION', 'Кто валидировал: поставщик, третья сторона или организация');
    if (_v76S_(d.evidence).length < 5) return _v76Fail_(op, 'VALIDATION', 'Укажите свидетельство валидации (документ, отчёт о проверках)');
    if (!res) return _v76Fail_(op, 'VALIDATION', 'Укажите результат');
    if (res[0] !== 'VALIDATED' && _v76S_(d.limits).length < 5) return _v76Fail_(op, 'VALIDATION', 'Опишите ограничения или что не валидировано');
    return _withLock_(function () {
      var who = _v76Who_(op), id = _v76Id_('SW');
      _v76Append_('SW', { SwID: id, 'Программа': _v76S_(d.program) || 'MON CHEF', 'Версия': _v76S_(d.version), 'Кто валидировал': by[0], 'Свидетельство': _v76S_(d.evidence), 'Результат': res[0],
        'Ограничения': _v76S_(d.limits), 'Изменения': _v76S_(d.changes), 'Статус': 'DRAFT', 'Внёс': who.name, 'Внесено': new Date(), OperationID: op.id });
      _audit_(op, 'SOFTWARE_VALIDATION', 'Программа', id, null, { version: _v76S_(d.version), by: by[0], result: res[0] });
      _endOp_(op); return _ok_({ id: id }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v76ApproveSoftware(id, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_TOP_, 'SOFTWARE_APPROVE', 'Программа', id, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var rs = _v76Rows_('SW'), r = rs.filter(function (x) { return String(x.SwID) === String(id); })[0];
      if (!r) return _v76Fail_(op, 'NOT_FOUND', 'Запись не найдена');
      if (String(r['Статус']) !== 'DRAFT') return _v76Fail_(op, 'STATE', 'Одобряется только новая запись');
      if (String(r['Результат']) === 'NOT_VALIDATED') return _v76Fail_(op, 'VALIDATION', 'Невалидированную программу одобрить к применению нельзя (п. 8.7)');
      rs.forEach(function (x) { if (String(x['Статус']) === 'APPROVED' && _v76Lo_(x['Программа']) === _v76Lo_(r['Программа'])) _v76Set_('SW', x._row, { 'Статус': 'SUPERSEDED' }); });
      var who = _v76Who_(op);
      _v76Set_('SW', r._row, { 'Статус': 'APPROVED', 'Одобрил': who.name + (who.role ? ', ' + who.role : ''), 'Одобрено': new Date() });
      _audit_(op, 'SOFTWARE_APPROVE', 'Программа', String(id), { status: 'DRAFT' }, { status: 'APPROVED', version: r['Версия'] });
      _endOp_(op); return _ok_({ id: String(id), version: String(r['Версия']) }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v76MeReady_(L, evals, sw) {
  var it = [], add = function (ok, name, detail, ref) { it.push({ ok: !!ok, name: name, detail: detail, ref: ref }); };
  var act = L.filter(function (e) { return e.status === 'ACTIVE' && (e.measuring || e.mercury); });
  add(act.length > 0, 'Средства измерения внесены в реестр', act.length + ' в работе', '8.7');
  var noKind = act.filter(function (e) { return !e.kind; }), merc = act.filter(function (e) { return e.mercury; });
  add(act.length > 0 && !noKind.length && !merc.length, 'Вид указан у всех; ртутных термометров нет', merc.length ? 'ртутные: ' + merc.map(function (e) { return e.name; }).join(', ') : noKind.length ? 'вид не указан: ' + noKind.map(function (e) { return e.name; }).join(', ') : act.length ? 'да' : 'приборов нет', 'СанПиН п. 48');
  var blocked = act.filter(function (e) { return e.effective !== 'ACTIVE'; });
  add(act.length > 0 && !blocked.length, 'Все используемые приборы поверены и исправны', blocked.length ? blocked.map(function (e) { return e.name + ': ' + e.reason; }).join('; ') : act.length ? 'да' : 'приборов нет', '8.7 a');
  var noProt = act.filter(function (e) { return !e.protectAdjust || !e.protectDamage; });
  add(act.length > 0 && !noProt.length, 'Защита от регулировок и повреждений описана', noProt.length ? 'не описана: ' + noProt.map(function (e) { return e.name; }).join(', ') : act.length ? 'да' : 'приборов нет', '8.7 d, e');
  var open = evals.filter(function (x) { return x.status === 'OPEN'; });
  add(!open.length, 'После неисправностей прежние измерения оценены', open.length ? 'открыто оценок: ' + open.map(function (x) { return x.instrument; }).join(', ') : 'да', '8.7');
  var cur = sw.filter(function (x) { return x.status === 'APPROVED' && x.version === MC_V76_BUILD_; })[0];
  add(!!cur, 'Текущая сборка программы валидирована и одобрена', cur ? cur.resultName + ', одобрил ' + cur.approvedBy + ', ' + cur.approvedAt : 'нет одобрения для «' + MC_V76_BUILD_ + '»', '8.7 (ПО)');
  return it;
}
function v76MeData(token) {
  var op = null;
  try { op = _beginOp_(token, MC_V76_ME_VIEW_, 'INSTRUMENT_VIEW', 'Средства измерения', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var L = _mcEqList_(), I = _v76EqInfo_();
    var instruments = L.filter(function (e) { return e.measuring || e.mercury; }).map(function (e) {
      var o = {}; Object.keys(e).forEach(function (k) { o[k] = e[k]; });
      o.history = (I.cal[String(e.id)] || []).map(function (r) { return { date: _v76Day_(r['Дата']), kind: (_v76Ref_(MC_V76_CALKIND_, String(r['Вид работ'])) || ['', ''])[1], till: _v76Day_(r['Действует до']),
        result: String(r['Результат']), document: String(r['Документ'] || ''), performer: String(r['Выполнил'] || ''), trace: String(r['Прослеживаемость / база'] || ''),
        adjusted: String(r['Регулировка']) === 'да', adjustment: String(r['Что отрегулировано'] || ''), note: String(r['Примечание'] || ''), by: String(r['Внёс'] || '') }; }).reverse();
      return o;
    });
    var evals = _v76Rows_('EV').slice().reverse().map(function (r) {
      var open = String(r['Статус']) === 'OPEN', imp = open ? _v76Impact_(r.EquipmentID, _v76Date_(r['Период с']), _v76Date_(r['Обнаружено'])) : null;
      return { id: String(r.EvalID), equipmentId: String(r.EquipmentID), instrument: String(r['Прибор'] || ''), reason: (_v76Ref_(MC_V76_EVREASON_, String(r['Причина'])) || ['', ''])[1], what: String(r['Что обнаружено'] || ''),
        detected: _v76Fmt_(r['Обнаружено']), from: _v76Day_(r['Период с']) || 'с начала записей', count: imp ? imp.count : Number(r['Измерений']) || 0, deviations: imp ? imp.deviations : Number(r['Отклонений']) || 0,
        items: imp ? imp.items : [], batches: imp ? imp.batches : _v76J_(r['Партии (JSON)'], []), conclusion: (_v76Ref_(MC_V76_CONCL_, String(r['Вывод'])) || ['', ''])[1], basis: String(r['Обоснование'] || ''),
        equipmentAction: String(r['Меры по прибору'] || ''), productAction: String(r['Меры по продукции'] || ''), recallId: String(r.RecallID || ''), status: String(r['Статус']),
        openedBy: String(r['Открыл'] || ''), openedAt: _v76Fmt_(r['Открыто']), closedBy: String(r['Закрыл'] || ''), closedAt: _v76Fmt_(r['Закрыто']) };
    });
    var sw = _v76Rows_('SW').slice().reverse().map(function (r) { return { id: String(r.SwID), program: String(r['Программа']), version: String(r['Версия']), by: (_v76Ref_(MC_V76_SWBY_, String(r['Кто валидировал'])) || ['', ''])[1],
      evidence: String(r['Свидетельство'] || ''), result: String(r['Результат']), resultName: (_v76Ref_(MC_V76_SWRES_, String(r['Результат'])) || ['', ''])[1], limits: String(r['Ограничения'] || ''),
      changes: String(r['Изменения'] || ''), status: String(r['Статус']), author: String(r['Внёс'] || ''), at: _v76Fmt_(r['Внесено']), approvedBy: String(r['Одобрил'] || ''), approvedAt: _v76Fmt_(r['Одобрено']) }; });
    var items = _v76MeReady_(L, evals, sw);
    _endOp_(op);
    var ref = function (l) { return l.map(function (x) { return { code: x[0], name: x[1] }; }); };
    return _ok_({ ready: items, score: Math.round(items.filter(function (x) { return x.ok; }).length / items.length * 100), build: MC_V76_BUILD_, instruments: instruments, evals: evals, software: sw,
      kinds: ref(MC_V76_KIND_), calKinds: ref(MC_V76_CALKIND_), eqActs: ref(MC_V76_EQACT_), conclusions: ref(MC_V76_CONCL_), swBy: ref(MC_V76_SWBY_), swRes: ref(MC_V76_SWRES_) }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- главное окно ---------------- */
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  var add = function (sec, extra, kpi) {
    var orig = _UI_BUILDERS_[sec]; if (typeof orig !== 'function') return;
    _UI_BUILDERS_[sec] = function (token, opts, s) {
      var r = orig(token, opts, s) || {}; r.actions = (r.actions || []).concat(extra);
      if (kpi) { try { var n = _v76Rows_('IN').filter(function (x) { return String(x['Статус']) === 'OPEN'; }).length; r.kpis = (r.kpis || []).concat([{ label: 'Открытые ЧС и аварии', value: n, tone: n ? 'red' : 'green' }]); } catch (e) {} }
      return r;
    };
  };
  add('haccp', [{ label: 'Чрезвычайные ситуации и аварии (ГОСТ Р ИСО 22000, п. 8.4)', module: 'emergency' }, { label: 'Средства измерения: поверка, неисправности, ПО (п. 8.7)', module: 'metrology' }], true);
  add('equipment', [{ label: 'Средства измерения: поверка, неисправности, ПО (п. 8.7)', module: 'metrology' }], false);
})();
try { ['emergency', 'metrology'].forEach(function (v) { if (MC_UI_VIEWS_.indexOf(v) < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat([v]); }); } catch (e) {}
