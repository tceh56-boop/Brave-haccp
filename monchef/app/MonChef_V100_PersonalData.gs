/**
 * MON CHEF V100 — технические меры по 152-ФЗ (по предварительной правовой оценке комплекта от 24.11; правовые решения — за оператором).
 *
 *  1. Ключ входа не передаётся в адресах переходов: страница получает запас одноразовых «билетов» (действуют 10 мин, один раз);
 *     ссылка с ключом при нажатии заменяется ссылкой с билетом, сервер меняет билет на ключ и сразу его удаляет. Нет билета —
 *     ключ из адреса убирается, страница берёт его с устройства (как при QR партии). Повторно открытая ссылка ключа не содержит.
 *  2. Медицинские сведения сотрудника (номер медкнижки, даты осмотров) — только праву «медкнижки» (medical, medical_view);
 *     кадровым и техническому доступу — без них (разделение технического, кадрового и медицинского контуров). Остальным — только
 *     контакты скрыты, как раньше.
 *  3. Внешнее распознавание (Yandex Vision) можно выключить целиком (свойство MC_PD_EXTERNAL_OCR = off): документы вносятся вручную.
 *     Функции распознавания медицинских документов в системе нет; новые такие сценарии — только после оценки оператора.
 *  4. Реестр сроков хранения ПД — черновик по категориям и местам хранения; срок и основание утверждает оператор (система сроки
 *     не придумывает). Уничтожение — только для категории с утверждённым сроком: поля ПД в записях старше срока перезаписываются,
 *     составляется акт (дата, основание, категории, способ, ответственный, затронутые копии, результат — по разд. 8 оценки;
 *     форму акта оператор сверяет с приказом Роскомнадзора № 179 от 28.10.2022). Резервные копии и выгрузки не затрагиваются —
 *     это указано в акте.
 *  5. Реестр обработки ПД — черновик для оператора: категории, где лежат, кому передаются (Google, Yandex Cloud при ключе, почта).
 */
var MC_V100_RET_ = 'ПД_Сроки_V100', MC_V100_RET_HEAD_ = ['CategoryID', 'Категория ПД', 'Субъекты', 'Где хранится', 'Срок хранения, дней', 'Основание срока', 'Статус', 'Утвердил', 'Утверждено', 'Уничтожение'];
var MC_V100_ACT_ = 'ПД_Уничтожение_V100', MC_V100_ACT_HEAD_ = ['ActID', 'Дата', 'CategoryID', 'Категория ПД', 'Основание', 'Способ', 'Записей', 'Период записей', 'Затронутые копии', 'Не затронуто', 'Ответственный', 'Результат', 'OperationID'];
// Категории: где лежат в MON CHEF; auto — правило уничтожения (лист, столбец даты, поля ПД)
var MC_V100_CATS_ = [
  { id: 'HEALTH_DAILY', ru: 'Ежедневная отметка здоровья на смену (отметка, жалобы, допуск)', who: 'работники', where: ['Здоровье_Смена_V81'], special: true,
    auto: { sheet: 'Здоровье_Смена_V81', date: 'Дата', pd: ['Сотрудник', 'Должность', 'Отметка', 'Жалобы', 'Осмотрел'] } },
  { id: 'MED_BOOKS', ru: 'Медицинские книжки: номер, даты осмотров и аттестаций, допуск', who: 'работники', where: ['Медкнижки', 'Сотрудники (поля медкнижки)'], special: true },
  { id: 'STAFF', ru: 'Кадровые сведения: ФИО, должность, роль, контакты', who: 'работники', where: ['Сотрудники'] },
  { id: 'SCHEDULE', ru: 'График смен и отсутствия (без медицинских подробностей)', who: 'работники', where: ['График_Смен_V98'],
    auto: { sheet: 'График_Смен_V98', date: 'Дата', pd: ['Сотрудник', 'Причина', 'Назначил', 'История (JSON)'] } },
  { id: 'CUSTOMERS', ru: 'Заказчики банкетов: имя, телефон, параметры заказа', who: 'клиенты', where: ['банкетные листы и модули', 'Drive: заказы'] },
  { id: 'AUDIT', ru: 'Журнал действий: кто, когда, что сделал', who: 'работники', where: ['Audit_Log', 'журналы операций'] },
  { id: 'OCR', ru: 'Снимки и PDF документов, результаты распознавания', who: 'работники поставщиков, кассиры, заказчики (в документах)', where: ['Drive: папки отчётов, документов, предприятия', 'листы распознавания'] },
  { id: 'BACKUPS', ru: 'Резервные копии таблицы', who: 'все категории', where: ['Drive: «Бэкапы Mon Chef»'] },
  { id: 'EMAIL', ru: 'Получатели писем и отправленные письма', who: 'работники', where: ['Письма_Получатели_V89', 'журнал отправки писем'] }
];

/* ---------------- 1. одноразовые билеты вместо ключа в адресе ---------------- */
/** Запас билетов страницы: {n ≤ 10}. Билет действует 10 минут и один раз. */
function mcLinkTickets(json, token) {
  try {
    _requireAuth_(token);
    var d = (function () { try { return _mcBlJson_(json) || {}; } catch (e) { return {}; } })(), n = Math.min(10, Math.max(1, Number(d.n) || 5)), c = CacheService.getScriptCache(), out = [];
    for (var i = 0; i < n; i++) { var t = Utilities.getUuid().replace(/-/g, ''); c.put('mc_lt_' + t, String(token), 600); out.push(t); }
    return _ok_({ tickets: out, ttl: 600 });
  } catch (e) { return _failFrom_(e); }
}
/** Билет → ключ; билет удаляется сразу. */
function _mcTicketToken_(t) {
  if (!/^[0-9a-f]{32}$/.test(String(t || ''))) return '';
  try { var c = CacheService.getScriptCache(), k = 'mc_lt_' + t, v = c.get(k); if (v) c.remove(k); return v || ''; } catch (e) { return ''; }
}
(function () {
  if (typeof doGet !== 'function') return;
  var orig = doGet;
  doGet = function (e) {
    try { var p = e && e.parameter; if (p && p.t && !p.token) { var tk = _mcTicketToken_(String(p.t)); if (tk) p.token = tk; delete p.t; } } catch (er) {}
    return orig.apply(this, arguments);
  };
})();

/* ---------------- 2. медицинские сведения — только праву «медкнижки» ---------------- */
(function () {
  if (typeof getEmployeesFull !== 'function') return;
  var orig = getEmployeesFull;
  getEmployeesFull = function (token) {
    var res = orig.apply(this, arguments), s = null;
    try { s = token ? _requireAuth_(token) : (typeof _MC_GATE_SESSION !== 'undefined' ? _MC_GATE_SESSION : null); } catch (e) { s = null; }
    if (!s) return res;
    var med = !s.dev && _mcRbHasExact_(s, 'medical|medical_view');
    if (med) return res;
    try { var out = JSON.parse(res); out.forEach(function (e) { e.sanBookNumber = ''; e.sanBookExpiry = ''; e.lastMedicalExam = ''; e.medicalHidden = true; }); return JSON.stringify(out); } catch (e) { return res; }
  };
})();

/* ---------------- 3. внешнее распознавание: выключатель ---------------- */
function _mcPdOcrOff_() { try { return String(PropertiesService.getScriptProperties().getProperty('MC_PD_EXTERNAL_OCR') || 'on').toLowerCase() === 'off'; } catch (e) { return false; } }
var MC_V100_OCR_OFF_MSG_ = 'Внешнее распознавание выключено (152-ФЗ: передача документов в Yandex Cloud — после решения оператора). Внесите данные вручную.';
(function () {
  if (typeof _mcOcrAnn_ === 'function') { var o1 = _mcOcrAnn_; _mcOcrAnn_ = function () { if (_mcPdOcrOff_()) return { error: 'pd-off', message: MC_V100_OCR_OFF_MSG_ }; return o1.apply(this, arguments); }; }
  if (typeof _yandexVisionRecognize_ === 'function') { var o2 = _yandexVisionRecognize_; _yandexVisionRecognize_ = function () { if (_mcPdOcrOff_()) return { error: 'pd-off', message: MC_V100_OCR_OFF_MSG_ }; return o2.apply(this, arguments); }; }
})();

/* ---------------- 4–5. реестр сроков, уничтожение, реестр обработки ---------------- */
function _v100Can_(s) { return !!s && !s.dev && _mcRbHasExact_(s, 'grants|system'); }
function _v100Ret_() {
  var R = _v92Rows_(MC_V100_RET_), by = {}; R.forEach(function (r) { by[String(r.CategoryID)] = r; });
  return MC_V100_CATS_.map(function (c) {
    var r = by[c.id] || {}, days = Number(r['Срок хранения, дней']) || null;
    return { id: c.id, ru: c.ru, who: c.who, where: c.where.filter(function (w) { return !/^[А-Яа-яA-Za-z_]+_V\d+$/.test(w) || _book_().getSheetByName(w); }), special: !!c.special, auto: !!c.auto,
      days: days, basis: String(r['Основание срока'] || ''), status: String(r['Статус'] || 'DRAFT'), by: String(r['Утвердил'] || ''), at: r['Утверждено'] instanceof Date ? Utilities.formatDate(r['Утверждено'], _mcTz_(), 'dd.MM.yyyy') : '', _row: r._row };
  });
}
function _v100Old_(cat, days) {
  var a = cat.auto, sh = _book_().getSheetByName(a.sheet); if (!sh || sh.getLastRow() < 2) return { sh: sh, rows: [], cols: [] };
  var v = sh.getDataRange().getValues(), H = v[0].map(String), di = H.indexOf(a.date), cols = a.pd.map(function (k) { return H.indexOf(k); }).filter(function (i) { return i >= 0; });
  var lim = _v89AddDays_(_v71Day_(new Date()), -days), rows = [];
  for (var i = 1; i < v.length; i++) { var d = _v71Day_(v[i][di]); if (!d || d >= lim) continue; if (cols.every(function (c) { return /^\[уничтожено/.test(String(v[i][c])) || v[i][c] === ''; })) continue; rows.push({ i: i, day: d }); }
  return { sh: sh, rows: rows, cols: cols, lim: lim };
}
function v100Data(token) {
  var s; try { s = _requireAuth_(token, 'grants|system'); } catch (e) { return _failFrom_(e); }
  try {
    var R = _v100Ret_(), props = PropertiesService.getScriptProperties(), yk = !!String(props.getProperty('YANDEX_API_KEY') || '').trim();
    R.forEach(function (c) { if (c.auto && c.status === 'APPROVED' && c.days) { var cat = MC_V100_CATS_.filter(function (x) { return x.id === c.id; })[0], o = _v100Old_(cat, c.days); c.due = o.rows.length; c.dueBefore = o.lim; } });
    var rcp = 0; try { rcp = _v92Rows_('Письма_Получатели_V89').length; } catch (e) {}
    var recipients = [{ who: 'Google (таблица, Диск, Apps Script, почта Gmail)', what: 'все категории — хранение и обработка', note: 'договор, страна хранения и субобработчики — подтверждает оператор' }]
      .concat(yk ? [{ who: 'Yandex Cloud (Vision OCR' + (props.getProperty('BANQUET_GPT_MODEL') ? ', YandexGPT' : '') + ')', what: 'снимки и PDF документов при распознавании', note: _mcPdOcrOff_() ? 'выключено (MC_PD_EXTERNAL_OCR = off)' : 'включено — поручение и трансграничность (если применимо) оформляет оператор' }] : [])
      .concat(rcp ? [{ who: 'адресаты сменных писем (' + rcp + ')', what: 'сводки смены без медицинских сведений', note: 'перечень адресатов — «Сменные письма»' }] : []);
    var acts = _v92Rows_(MC_V100_ACT_).map(function (a) { return { id: String(a.ActID), date: a['Дата'] instanceof Date ? Utilities.formatDate(a['Дата'], _mcTz_(), 'dd.MM.yyyy HH:mm') : String(a['Дата']), cat: String(a['Категория ПД']), n: Number(a['Записей']) || 0,
      basis: String(a['Основание']), method: String(a['Способ']), copies: String(a['Затронутые копии']), untouched: String(a['Не затронуто']), who: String(a['Ответственный']), result: String(a['Результат']), period: String(a['Период записей']) }; }).reverse();
    return _ok_({ can: _v100Can_(s), retention: R, ocr: { external: !_mcPdOcrOff_(), keySet: yk }, recipients: recipients, acts: acts,
      operatorTodo: ['оператор, цели и правовые основания по каждой категории', 'уведомление Роскомнадзора (ст. 22) и, если применимо, о трансграничной передаче', 'основания статьи 10 для сведений о здоровье',
        'договоры (поручения) с обработчиками: Google, Yandex Cloud', 'сроки хранения по категориям (этот реестр)', 'политика обработки ПД, положения о доступе, формы согласий, регламент инцидентов'] });
  } catch (e) { return _failFrom_(e); }
}
function _v100Fail_(op, c, m) { _endOp_(op, 'FAILED'); return _fail_(c, m, op.id); }
/** Срок хранения категории: {id, days, basis, confirm}. Утверждает оператор (право «grants» или «system»), не технический доступ. */
function v100SaveRetention(json, token) {
  var op = null; try { op = _beginOp_(token, 'grants|system', 'V100_RETENTION', 'Персональные данные', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, cat = MC_V100_CATS_.filter(function (x) { return x.id === String(d.id || ''); })[0], days = Number(d.days), basis = String(d.basis || '').replace(/\s+/g, ' ').trim();
    if (!_v100Can_(op.session)) return _v100Fail_(op, 'FORBIDDEN', 'Срок утверждает ответственный оператора (право «grants» или «system»), не технический доступ');
    if (d.confirm !== true) return _v100Fail_(op, 'VALIDATION', 'Подтвердите галочкой');
    if (!cat) return _v100Fail_(op, 'NOT_FOUND', 'Категория не найдена');
    if (!(days >= 1) || Math.floor(days) !== days || days > 36500) return _v100Fail_(op, 'VALIDATION', 'Срок — целое число дней от 1');
    if (basis.length < 10) return _v100Fail_(op, 'VALIDATION', 'Основание срока обязательно: закон, приказ, локальный акт (не короче 10 символов)');
    return _withLock_(function () {
      var r = _v92Rows_(MC_V100_RET_).filter(function (x) { return String(x.CategoryID) === cat.id; })[0] || { CategoryID: cat.id };
      var before = { срок: r['Срок хранения, дней'] || '', основание: r['Основание срока'] || '' };
      r['Категория ПД'] = cat.ru; r['Субъекты'] = cat.who; r['Где хранится'] = cat.where.join('; '); r['Срок хранения, дней'] = days; r['Основание срока'] = basis.slice(0, 300); r['Статус'] = 'APPROVED';
      r['Утвердил'] = _author_(op).фио; r['Утверждено'] = new Date(); r['Уничтожение'] = cat.auto ? 'перезапись полей ПД в «' + cat.auto.sheet + '»' : 'вручную (автоматического правила нет)';
      _v93Write_(MC_V100_RET_, MC_V100_RET_HEAD_, r);
      _audit_(op, 'V100_RETENTION', MC_V100_RET_, cat.id, before, { срок: days, основание: basis });
      _endOp_(op); return _ok_({ id: cat.id, days: days }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Уничтожить ПД категории старше утверждённого срока: {id, confirm}. Акт — в «ПД_Уничтожение_V100». */
function v100Destroy(json, token) {
  var op = null; try { op = _beginOp_(token, 'grants|system', 'V100_DESTROY', 'Персональные данные', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {};
    if (!_v100Can_(op.session)) return _v100Fail_(op, 'FORBIDDEN', 'Уничтожение — ответственный оператора (право «grants» или «system»), не технический доступ');
    if (d.confirm !== true) return _v100Fail_(op, 'VALIDATION', 'Подтвердите уничтожение галочкой');
    return _withLock_(function () {
      var cat = MC_V100_CATS_.filter(function (x) { return x.id === String(d.id || ''); })[0], R = _v100Ret_().filter(function (x) { return x.id === String(d.id || ''); })[0];
      if (!cat || !R) return _v100Fail_(op, 'NOT_FOUND', 'Категория не найдена');
      if (!cat.auto) return _v100Fail_(op, 'VALIDATION', 'Для категории «' + cat.ru + '» автоматического уничтожения нет — только вручную по регламенту оператора');
      if (R.status !== 'APPROVED' || !R.days) return _v100Fail_(op, 'VALIDATION', 'Срок хранения категории не утверждён — уничтожать нельзя');
      var o = _v100Old_(cat, R.days), who = _author_(op).фио, stamp = Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy');
      if (!o.rows.length) return _v100Fail_(op, 'VALIDATION', 'Записей старше срока (' + R.days + ' дн.) нет');
      o.rows.forEach(function (x) { o.cols.forEach(function (c) { o.sh.getRange(x.i + 1, c + 1).setValue('[уничтожено ' + stamp + ']'); }); });
      var days = o.rows.map(function (x) { return x.day; }).sort(), id = 'PDA-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
      var act = { ActID: id, 'Дата': new Date(), CategoryID: cat.id, 'Категория ПД': cat.ru, 'Основание': 'истёк срок хранения ' + R.days + ' дн. по реестру сроков (утвердил ' + R.by + ' ' + R.at + '; основание: ' + R.basis + ')',
        'Способ': 'перезапись полей ПД (' + cat.auto.pd.join(', ') + ') в листе «' + cat.auto.sheet + '» значением «[уничтожено ' + stamp + ']»; даты и обезличенные факты сохранены',
        'Записей': o.rows.length, 'Период записей': days[0].split('-').reverse().join('.') + ' – ' + days[days.length - 1].split('-').reverse().join('.'), 'Затронутые копии': 'рабочая таблица MON CHEF',
        'Не затронуто': 'резервные копии на Диске, выгрузки и письма — уничтожаются отдельно по регламенту оператора; история версий Google Таблиц хранит прежние значения до её очистки',
        'Ответственный': who, 'Результат': 'выполнено: ' + o.rows.length + ' записей', OperationID: op.id };
      _v93Write_(MC_V100_ACT_, MC_V100_ACT_HEAD_, act);
      _audit_(op, 'V100_DESTROY', MC_V100_ACT_, id, null, { категория: cat.id, записей: o.rows.length, период: act['Период записей'] });
      _endOp_(op); return _ok_({ id: id, n: o.rows.length, period: act['Период записей'], untouched: act['Не затронуто'] }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Выключатель внешнего распознавания: {on: true|false, confirm}. */
function v100SetOcr(json, token) {
  var op = null; try { op = _beginOp_(token, 'grants|system', 'V100_OCR', 'Персональные данные', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {};
    if (!_v100Can_(op.session)) return _v100Fail_(op, 'FORBIDDEN', 'Решение принимает ответственный оператора (право «grants» или «system»)');
    if (d.confirm !== true) return _v100Fail_(op, 'VALIDATION', 'Подтвердите галочкой');
    PropertiesService.getScriptProperties().setProperty('MC_PD_EXTERNAL_OCR', d.on ? 'on' : 'off');
    _audit_(op, 'V100_OCR', 'Свойства скрипта', 'MC_PD_EXTERNAL_OCR', null, { внешнее_распознавание: d.on ? 'включено' : 'выключено' });
    _endOp_(op); return _ok_({ external: !!d.on }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
(function () {
  try { MC_RB_MODULES_.pd152 = 'grants|system'; MC_RB_MODULE_RU_.pd152 = 'Персональные данные (152-ФЗ)'; } catch (e) {}
  try { if (MC_UI_VIEWS_.indexOf('pd152') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['pd152']); } catch (e) {}
  try { var orig = _UI_BUILDERS_.settings; if (typeof orig === 'function') _UI_BUILDERS_.settings = function (token, opts, s) { var r = orig(token, opts, s) || {}; r.actions = (r.actions || []).concat([{ label: 'Персональные данные: сроки, уничтожение, распознавание', module: 'pd152' }]); return r; }; } catch (e) {}
})();
