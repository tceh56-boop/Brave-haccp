/**
 * MON CHEF V75 — управление опасностями по ГОСТ Р ИСО 22000-2019, п. 8.5 (стандарт добровольного применения; текст сверен
 * по присланному PDF, идентичен ISO 22000:2018). Обязательная основа: СанПиН 2.3/2.4.4282-26 п. 4 (производственный контроль
 * на принципах ХАССП), ТР ТС 021/2011 ст. 10 ч. 3, ст. 11 ч. 3.
 *
 * Строится поверх V30 («ХАССП: процессы и ККТ»): процессы, опасности, ККТ/ОПРП, мониторинг и верификация остаются там же,
 * их читают ППК (V65) и «Проверка». Здесь добавлено то, чего не было:
 *   8.5.1.1 группа безопасности пищевой продукции (назначает руководство);
 *   8.5.1.2–8.5.1.4 описания сырья, конечной продукции и предусмотренного применения — по продукту, блюду или группе блюд,
 *           со справкой из ТТК (состав, аллергены, срок), которая не подставляется в описание сама;
 *   8.5.1.5 технологические схемы из процессов V30 (ввод сырья, переделка, выход и отходы, аутсорсинг) и их подтверждение
 *           на производственной площадке — подтверждение относится к версии схемы;
 *   8.5.2.2 опасности: вид по п. 3.22 (биологическая, химическая, физическая, аллерген, радиоактивные вещества), источник
 *           идентификации, как проявляется на этапе, приемлемый уровень и его обоснование;
 *   8.5.2.3 оценка по методике предприятия: шкалы вероятности и тяжести и порог значимости задаёт и утверждает предприятие
 *           (утверждает не автор), риск = вероятность × тяжесть; решение, отличное от расчёта, — только с обоснованием;
 *   8.5.2.4 меры управления: вероятность и тяжесть сбоя, факторы 1–4, осуществимость a–c; предложение системы
 *           (ККТ — если возможны измеримый предел, мониторинг и своевременная коррекция, иначе ППОПМ), решение группы
 *           с обоснованием; мера становится ККТ/ОПРП в V30 (пределы система не придумывает);
 *   8.5.3   валидация мер: метод, свидетельство, результат; изменение предела, метода или периодичности ККТ после валидации
 *           требует повторной валидации;
 *   8.5.4   PDF «План управления опасностями (план ХАССП/ППОПМ)»;
 *   8.6     пересмотр с периодичностью предприятия и перечнем изменений после прошлого пересмотра.
 * Сотрудник, время, номера и расчёты определяет сервер; значения, пределы и формулировки вносит группа безопасности.
 */
var MC_V75_ = { SET: 'ХАССП_Настройки_V75', MTH: 'ХАССП_Методика_V75', HZ: 'ХАССП_Оценка_V75', MS: 'ХАССП_Меры_V75', VAL: 'ХАССП_Валидация_V75',
  DSC: 'ХАССП_Описания_V75', FLW: 'ХАССП_Схемы_V75', CNF: 'ХАССП_Подтверждения_V75', REV: 'ХАССП_Пересмотр_V75' };
var MC_V75_HEAD_ = {
  SET: ['Ключ', 'Значение', 'Изменил', 'Изменено'],
  MTH: ['MethodID', 'Версия', 'Статус', 'Уровней', 'Вероятность (JSON)', 'Тяжесть (JSON)', 'Порог значимости', 'Пояснение', 'Внёс', 'Внесено', 'Утвердил', 'Утверждено', 'OperationID'],
  HZ: ['HazardID', 'Вид (код)', 'Источник идентификации', 'Как проявляется на этапе', 'Приемлемый уровень', 'Обоснование уровня', 'Вероятность', 'Тяжесть', 'Риск',
    'Значимая по расчёту', 'Значимая (решение)', 'Обоснование решения', 'MethodID', 'Оценил', 'Оценено', 'OperationID'],
  MS: ['MeasureID', 'Опасности (JSON)', 'ProcessID', 'Мера', 'Вероятность сбоя', 'Тяжесть сбоя', 'Влияние на опасность', 'Место среди мер', 'Специально для снижения',
    'Одна или в комбинации', 'Измеримый предел возможен', 'Мониторинг выявит нарушение', 'Своевременная коррекция возможна', 'Предложение системы', 'Классификация',
    'Обоснование', 'Внешние требования', 'Обоснование предела', 'ControlID', 'Решил', 'Решено', 'Статус', 'OperationID'],
  VAL: ['ValidationID', 'ControlID', 'Метод', 'Свидетельство', 'Результат', 'Вывод', 'Снимок параметров', 'Выполнил', 'Выполнено', 'OperationID'],
  DSC: ['DescID', 'Тип', 'Ключ', 'Название', 'Поля (JSON)', 'Внёс', 'Внесено', 'Обновил', 'Обновлено', 'OperationID'],
  FLW: ['FlowID', 'Название', 'Для продукции (JSON)', 'Шаги (JSON)', 'Описание (JSON)', 'Версия', 'Статус', 'Внёс', 'Внесено', 'Обновил', 'Обновлено', 'OperationID'],
  CNF: ['ConfID', 'FlowID', 'Версия схемы', 'Результат', 'Расхождения', 'Подтвердил', 'Должность', 'Подтверждено', 'OperationID'],
  REV: ['ReviewID', 'Пересмотрено', 'Кто', 'Что проверено', 'Изменения', 'Следующий пересмотр', 'OperationID']
};
var MC_V75_KIND_ = [['BIO', 'Биологическая'], ['CHEM', 'Химическая'], ['PHYS', 'Физическая'], ['ALLERGEN', 'Аллерген'], ['RADIO', 'Радиоактивные вещества']];   // п. 3.22, прим. 2
var MC_V75_SOURCE_ = [['PRELIM', 'Предварительная информация (описания, схемы — 8.5.1)'], ['EXPERIENCE', 'Опыт работы (персонал, внешние эксперты)'],
  ['SCIENCE', 'Эпидемиологические, научные и другие данные'], ['CHAIN', 'Информация от цепи поставок'], ['LEGAL', 'Законодательные и обязательные требования, требования потребителей']];   // 8.5.2.2.1 a–e
var MC_V75_STAGE_ = [['PRESENT', 'присутствует'], ['INTRODUCED', 'вносится'], ['INCREASED', 'увеличивается'], ['PERSISTS', 'сохраняется']];   // 8.5.2.2.2
var MC_V75_VMETHOD_ = [['NORM', 'Нормативный документ, научные данные'], ['TECHDOC', 'Технологическая документация (ТТК, ТУ, инструкция изготовителя оборудования)'],
  ['HISTORY', 'Данные предприятия за период'], ['TRIAL', 'Испытание на предприятии (замеры)'], ['LAB', 'Лабораторные исследования']];
var MC_V75_ORIGIN_ = [['ANIMAL', 'животное'], ['PLANT', 'растительное'], ['MINERAL', 'минеральное'], ['MIXED', 'смешанное']];
var MC_V75_DIST_ = [['HALL', 'зал'], ['BANQUET', 'банкет'], ['TAKEAWAY', 'на вынос'], ['DELIVERY', 'доставка'], ['CATERING', 'кейтеринг']];
// поля описаний: [ключ, подпись, обязательное] — 8.5.1.2 a–i, 8.5.1.3 a–g, 8.5.1.4
var MC_V75_DFIELDS_ = {
  RAW: [['legal', 'Применимые обязательные требования (ТР ТС, СанПиН)', false], ['bcp', 'Биологические, химические, физические характеристики (a)', true],
    ['composition', 'Состав, добавки, вещества в производстве (b)', false], ['origin', 'Происхождение (c)', false], ['place', 'Место происхождения (d)', false],
    ['method', 'Метод производства (e)', false], ['packaging', 'Упаковка и поставка (f)', false], ['storage', 'Условия хранения и срок годности (g)', true],
    ['preparation', 'Подготовка или обработка перед использованием (h)', false], ['acceptance', 'Критерии приёмки, относящиеся к безопасности (i)', true]],
  END: [['legal', 'Применимые обязательные требования', false], ['composition', 'Состав (b)', false], ['bcp', 'Биологические, химические, физические характеристики (c)', true],
    ['shelfStorage', 'Срок годности и условия хранения (d)', true], ['packaging', 'Упаковка (e)', false], ['labeling', 'Маркировка, инструкции по обращению и применению (f)', false],
    ['distribution', 'Способ реализации и поставки (g)', true]],
  USE: [['intended', 'Предусмотренное применение и обращение', true], ['misuse', 'Ожидаемое непредусмотренное применение и обращение', false],
    ['consumers', 'Группы потребителей', true], ['vulnerable', 'Уязвимые группы (дети, беременные, пожилые, люди с аллергией …)', false]]
};
var MC_V75_VIEW_ = 'haccp|haccp_view|haccp_approve', MC_V75_EDIT_ = 'haccp|haccp_approve', MC_V75_DESC_ = 'haccp|haccp_approve|ttk_approve', MC_V75_TOP_ = 'haccp_approve';

/* ---------------- листы ---------------- */
function _v75Sh_(k) {
  var H = MC_V75_HEAD_[k], sh = _bcSheet_(MC_V75_[k], H);
  if (String(sh.getRange(1, H.length).getValue() || '') !== H[H.length - 1]) sh.getRange(1, 1, 1, H.length).setValues([H]);
  return sh;
}
function _v75Rows_(k) {
  var H = MC_V75_HEAD_[k], v = _v75Sh_(k).getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) { if (!v[i][0]) continue; var o = { _row: i + 1 }; H.forEach(function (h, j) { o[h] = v[i][j]; }); out.push(o); }
  return out;
}
function _v75Append_(k, o) { _v75Sh_(k).appendRow(MC_V75_HEAD_[k].map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; })); }
function _v75Set_(k, row, f) { var H = MC_V75_HEAD_[k], sh = _v75Sh_(k); Object.keys(f).forEach(function (h) { var c = H.indexOf(h); if (c >= 0) sh.getRange(row, c + 1).setValue(f[h]); }); }
function _v75Id_(p) { return p + '-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd') + '-' + Utilities.getUuid().slice(0, 8).toUpperCase(); }
function _v75J_(x, d) { if (x && typeof x === 'object') return x; try { return JSON.parse(String(x || '')) || d; } catch (e) { return d; } }
function _v75Ref_(list, code) { for (var i = 0; i < list.length; i++) if (list[i][0] === code) return list[i]; return null; }
function _v75Lo_(s) { return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”]/g, '').replace(/\s+/g, ' ').trim(); }
function _v75Fmt_(d) { if (!d) return ''; if (!(d instanceof Date)) { var p = _mcBlDate_(d); if (!p) return String(d); d = p; } return _mcRbFmt_(d); }
function _v75Day_(d) { if (!d) return ''; if (!(d instanceof Date)) { var p = _mcBlDate_(d); if (!p) return String(d); d = p; } return Utilities.formatDate(d, _mcTz_(), 'dd.MM.yyyy'); }
function _v75Yes_(x) { return x === true || x === 'true' || x === 'да' || x === 1 || x === '1'; }
function _v75Who_(op) { var a = _author_(op); return { name: a.фио, role: a.должность || a.роль || '', id: a.id || '' }; }
function _v75Fail_(op, code, msg) { _endOp_(op, 'FAILED'); return _fail_(code, msg, op.id); }

/* ---------------- V30 ---------------- */
function _v75V30_() {
  _v30Init_();
  var P = {}, H = {}, C = {}, M = [];
  _v30Rows_(MC_V30.PROCESS).forEach(function (r) { if (r[0]) P[String(r[0])] = { id: String(r[0]), code: String(r[1] || ''), name: String(r[2] || ''), seq: Number(r[3]) || 0, status: String(r[7] || '') }; });
  _v30Rows_(MC_V30.HAZARD).forEach(function (r) { if (r[0]) H[String(r[0])] = { id: String(r[0]), processId: String(r[1] || ''), category: String(r[2] || ''), hazard: String(r[3] || ''), cause: String(r[4] || ''),
    preventive: String(r[5] || ''), severity: r[6], likelihood: r[7], risk: r[8], significant: _v30Bool_(r[9]), existing: String(r[10] || ''), evidence: String(r[11] || ''), status: String(r[12] || '') }; });
  _v30Rows_(MC_V30.CCP).forEach(function (r) { if (r[0]) C[String(r[0])] = { id: String(r[0]), processId: String(r[1] || ''), hazardId: String(r[2] || ''), type: String(r[3] || ''), point: String(r[4] || ''),
    limit: String(r[5] === undefined ? '' : r[5]), unit: String(r[6] || ''), method: String(r[7] || ''), frequency: String(r[8] || ''), responsible: String(r[9] || ''), corrective: String(r[10] || ''),
    verification: String(r[11] || ''), record: String(r[12] || ''), status: String(r[13] || '') }; });
  _v30Rows_(MC_V30.MON).forEach(function (r) { if (r[0]) M.push({ id: String(r[0]), controlId: String(r[1] || ''), parameter: String(r[3] || ''), unit: String(r[4] || ''), min: r[5], max: r[6],
    frequency: String(r[7] || ''), responsible: String(r[8] || ''), journal: String(r[9] || ''), enabled: r[12], status: String(r[13] || '') }); });
  return { P: P, H: H, C: C, M: M };
}
function _v75Row_(sheetName, id) {
  var sh = _book_().getSheetByName(sheetName), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) return { sh: sh, row: i + 1, v: v[i] };
  return null;
}
/** Снимок параметров ККТ/ОПРП для валидации: предел, единица, метод мониторинга, периодичность, коррекция и мониторинг V30. */
function _v75Snap_(c, M) {
  var mon = M.filter(function (m) { return m.controlId === c.id; }).map(function (m) { return [m.parameter, m.unit, m.min, m.max, m.frequency].join('|'); }).sort();
  return _mcBlHash_(JSON.stringify([c.type, c.limit, c.unit, c.method, c.frequency, c.corrective, mon]));
}

/* ---------------- настройки: группа безопасности, пересмотр ---------------- */
function _v75Settings_() {
  var out = { team: [], reviewMonths: null, changedBy: '', changedAt: '' };
  _v75Rows_('SET').forEach(function (r) {
    var k = String(r['Ключ']);
    if (k === 'team') out.team = _v75J_(r['Значение'], []);
    else if (k === 'reviewMonths') out.reviewMonths = r['Значение'] === '' ? null : Number(r['Значение']);
    if (r['Изменено']) { out.changedBy = String(r['Изменил'] || ''); out.changedAt = _v75Fmt_(r['Изменено']); }
  });
  return out;
}
/** Группа безопасности пищевой продукции и периодичность пересмотра плана — назначает руководство (директор). */
function v75SaveSettings(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V75_TOP_, 'HACCP_TEAM', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v75J_(json, {}), staff = [];
    try { staff = JSON.parse(getEmployees() || '[]').filter(function (e) { return e.active !== false; }); } catch (e) {}
    var names = (Array.isArray(d.team) ? d.team : []).map(function (x) { return String(x && x.name || x || '').trim(); }).filter(String);
    var bad = names.filter(function (n) { return !staff.some(function (e) { return _v75Lo_(e.name) === _v75Lo_(n); }); });
    if (bad.length) return _v75Fail_(op, 'VALIDATION', 'Нет среди действующих сотрудников: ' + bad.join(', '));
    var m = d.reviewMonths === '' || d.reviewMonths === null || d.reviewMonths === undefined ? '' : Number(d.reviewMonths);
    if (m !== '' && !(m >= 1 && m <= 36)) return _v75Fail_(op, 'VALIDATION', 'Периодичность пересмотра — от 1 до 36 месяцев или пусто');
    return _withLock_(function () {
      var who = _v75Who_(op), now = new Date(), have = {};
      _v75Rows_('SET').forEach(function (r) { have[String(r['Ключ'])] = r._row; });
      var vals = { team: JSON.stringify(names.map(function (n) { var e = staff.filter(function (x) { return _v75Lo_(x.name) === _v75Lo_(n); })[0]; return { name: e.name, position: e.position || '' }; })), reviewMonths: m };
      Object.keys(vals).forEach(function (k) { if (have[k]) _v75Set_('SET', have[k], { 'Значение': vals[k], 'Изменил': who.name, 'Изменено': now }); else _v75Append_('SET', { 'Ключ': k, 'Значение': vals[k], 'Изменил': who.name, 'Изменено': now }); });
      _audit_(op, 'HACCP_TEAM', 'ХАССП', 'Группа безопасности', null, vals);
      _endOp_(op); return _ok_(_v75Settings_(), op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- методика оценки (8.5.2.3) ---------------- */
var MC_V75_TEMPLATE_ = { levels: 4,
  likelihood: ['практически исключена', 'маловероятна', 'возможна', 'вероятна (известны случаи)'],
  severity: ['незначительная: без вреда здоровью', 'умеренная: кратковременное недомогание', 'серьёзная: заболевание, обращение к врачу', 'критическая: госпитализация, угроза жизни'] };
function _v75Method_(id) {
  var rs = _v75Rows_('MTH'), pick = null;
  rs.forEach(function (r) { if (id ? String(r.MethodID) === String(id) : String(r['Статус']) === 'APPROVED') pick = r; });
  if (!pick) return null;
  return { id: String(pick.MethodID), version: Number(pick['Версия']) || 1, status: String(pick['Статус']), levels: Number(pick['Уровней']) || 0,
    likelihood: _v75J_(pick['Вероятность (JSON)'], []), severity: _v75J_(pick['Тяжесть (JSON)'], []), threshold: Number(pick['Порог значимости']) || 0,
    note: String(pick['Пояснение'] || ''), by: String(pick['Внёс'] || ''), at: _v75Fmt_(pick['Внесено']), approvedBy: String(pick['Утвердил'] || ''), approvedAt: _v75Fmt_(pick['Утверждено']), _row: pick._row };
}
function v75SaveMethod(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V75_EDIT_, 'HACCP_METHOD', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v75J_(json, {}), n = Number(d.levels);
    if (!(n >= 3 && n <= 5)) return _v75Fail_(op, 'VALIDATION', 'Уровней в шкале — от 3 до 5');
    var L = (d.likelihood || []).map(function (x) { return String(x || '').trim(); }), S = (d.severity || []).map(function (x) { return String(x || '').trim(); });
    if (L.length !== n || S.length !== n || L.concat(S).some(function (x) { return x.length < 3; })) return _v75Fail_(op, 'VALIDATION', 'Опишите каждый уровень вероятности и тяжести');
    var t = Number(d.threshold);
    if (!(t >= 1 && t <= n * n) || Math.round(t) !== t) return _v75Fail_(op, 'VALIDATION', 'Порог значимости — целое число от 1 до ' + (n * n) + ' (риск = вероятность × тяжесть); его выбирает группа безопасности');
    return _withLock_(function () {
      var rs = _v75Rows_('MTH'), ver = rs.reduce(function (a, r) { return Math.max(a, Number(r['Версия']) || 0); }, 0) + 1, who = _v75Who_(op), id = _v75Id_('MTH');
      rs.forEach(function (r) { if (String(r['Статус']) === 'DRAFT') _v75Set_('MTH', r._row, { 'Статус': 'SUPERSEDED' }); });
      _v75Append_('MTH', { MethodID: id, 'Версия': ver, 'Статус': 'DRAFT', 'Уровней': n, 'Вероятность (JSON)': JSON.stringify(L), 'Тяжесть (JSON)': JSON.stringify(S), 'Порог значимости': t,
        'Пояснение': String(d.note || '').trim(), 'Внёс': who.name, 'Внесено': new Date(), OperationID: op.id });
      _audit_(op, 'HACCP_METHOD', 'ХАССП', id, null, { version: ver, levels: n, threshold: t });
      _endOp_(op); return _ok_(_v75Method_(id), op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v75ApproveMethod(id, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V75_EDIT_, 'HACCP_METHOD_APPROVE', 'ХАССП', id, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var m = _v75Method_(id); if (!m) return _v75Fail_(op, 'NOT_FOUND', 'Методика не найдена');
      if (m.status !== 'DRAFT') return _v75Fail_(op, 'STATE', 'Утверждается только черновик методики');
      var who = _v75Who_(op); if (_v75Lo_(who.name) === _v75Lo_(m.by)) return _v75Fail_(op, 'VALIDATION', 'Методику утверждает не автор: другой член группы безопасности или руководитель');
      _v75Rows_('MTH').forEach(function (r) { if (String(r['Статус']) === 'APPROVED') _v75Set_('MTH', r._row, { 'Статус': 'SUPERSEDED' }); });
      _v75Set_('MTH', m._row, { 'Статус': 'APPROVED', 'Утвердил': who.name + (who.role ? ', ' + who.role : ''), 'Утверждено': new Date() });
      _audit_(op, 'HACCP_METHOD_APPROVE', 'ХАССП', id, { status: 'DRAFT' }, { status: 'APPROVED', version: m.version });
      _endOp_(op); return _ok_(_v75Method_(id), op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- опасности (8.5.2.2, 8.5.2.3) ---------------- */
function _v75Assess_() { var m = {}; _v75Rows_('HZ').forEach(function (r) { m[String(r.HazardID)] = r; }); return m; }
function v75SaveHazard(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V75_EDIT_, 'HACCP_HAZARD', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v75J_(json, {}), kind = _v75Ref_(MC_V75_KIND_, String(d.kind || '')), stage = _v75Ref_(MC_V75_STAGE_, String(d.stage || ''));
    var src = (Array.isArray(d.sources) ? d.sources : []).filter(function (c) { return _v75Ref_(MC_V75_SOURCE_, c); });
    var hz = String(d.hazard || '').trim(), L = Number(d.likelihood), S = Number(d.severity), lvl = String(d.acceptableLevel || '').trim(), basis = String(d.acceptableBasis || '').trim();
    if (!d.processId) return _v75Fail_(op, 'VALIDATION', 'Выберите этап (процесс)');
    if (!kind) return _v75Fail_(op, 'VALIDATION', 'Выберите вид опасности (п. 3.22)');
    if (hz.length < 3) return _v75Fail_(op, 'VALIDATION', 'Опишите опасность');
    if (!src.length) return _v75Fail_(op, 'VALIDATION', 'Укажите, на чём основана идентификация (п. 8.5.2.2.1 a–e)');
    if (!stage) return _v75Fail_(op, 'VALIDATION', 'Укажите, как опасность проявляется на этапе: присутствует, вносится, увеличивается или сохраняется (п. 8.5.2.2.2)');
    if (lvl && basis.length < 5) return _v75Fail_(op, 'VALIDATION', 'Обоснуйте приемлемый уровень: документ, пункт (п. 8.5.2.2.3)');
    return _withLock_(function () {
      var m = _v75Method_(); if (!m) return _v75Fail_(op, 'STATE', 'Нет утверждённой методики оценки опасностей (п. 8.5.2.3): шкалы и порог задаёт и утверждает группа безопасности');
      if (!(L >= 1 && L <= m.levels) || !(S >= 1 && S <= m.levels)) return _v75Fail_(op, 'VALIDATION', 'Вероятность и тяжесть — уровни от 1 до ' + m.levels + ' по методике');
      var V = _v75V30_(); if (!V.P[String(d.processId)]) return _v75Fail_(op, 'NOT_FOUND', 'Процесс не найден');
      var risk = L * S, auto = risk >= m.threshold, dec = d.decision === 'SIGNIFICANT' ? true : d.decision === 'NOT_SIGNIFICANT' ? false : auto, note = String(d.decisionNote || '').trim();
      if (dec !== auto && note.length < 10) return _v75Fail_(op, 'VALIDATION', 'Решение отличается от расчёта (риск ' + risk + ', порог ' + m.threshold + ') — обоснуйте');
      var who = _v75Who_(op), now = new Date(), sh = _book_().getSheetByName(MC_V30.HAZARD), id = String(d.id || ''), ex = id ? _v75Row_(MC_V30.HAZARD, id) : null;
      if (id && !ex) return _v75Fail_(op, 'NOT_FOUND', 'Опасность не найдена');
      if (!id) id = _v30Id_('HZ');
      var row = [id, String(d.processId), kind[1], hz, String(d.cause || '').trim(), String(d.preventive || '').trim(), S, L, risk, dec, ex ? ex.v[10] : '',
        src.map(function (c) { return _v75Ref_(MC_V75_SOURCE_, c)[1]; }).join('; '), String(d.status || (ex ? ex.v[12] : '') || 'ACTIVE'), now, who.name];
      if (ex) sh.getRange(ex.row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
      var A = _v75Assess_()[id], rec = { HazardID: id, 'Вид (код)': kind[0], 'Источник идентификации': JSON.stringify(src), 'Как проявляется на этапе': stage[0], 'Приемлемый уровень': lvl,
        'Обоснование уровня': basis, 'Вероятность': L, 'Тяжесть': S, 'Риск': risk, 'Значимая по расчёту': auto ? 'да' : 'нет', 'Значимая (решение)': dec ? 'да' : 'нет', 'Обоснование решения': note,
        MethodID: m.id, 'Оценил': who.name, 'Оценено': now, OperationID: op.id };
      if (A) _v75Set_('HZ', A._row, rec); else _v75Append_('HZ', rec);
      _audit_(op, 'HACCP_HAZARD', 'ХАССП', id, ex ? { risk: ex.v[8], significant: ex.v[9] } : null, { kind: kind[0], risk: risk, threshold: m.threshold, significant: dec, method: m.version });
      _endOp_(op); return _ok_({ id: id, risk: risk, auto: auto, significant: dec, method: m.version }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- меры управления и классификация (8.5.2.4) ---------------- */
function _v75Suggest_(d) { return _v75Yes_(d.feasLimit) && _v75Yes_(d.feasMonitor) && _v75Yes_(d.feasCorrect) ? 'CCP' : 'OPRP'; }
function v75SaveMeasure(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V75_EDIT_, 'HACCP_MEASURE', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v75J_(json, {}), ids = (Array.isArray(d.hazardIds) ? d.hazardIds : [d.hazardIds]).map(String).filter(String), ms = String(d.measure || '').trim();
    var cls = { CCP: 'CCP', OPRP: 'OPRP' }[String(d.classification || '')], why = String(d.rationale || '').trim(), fL = Number(d.failLikelihood), fS = Number(d.failSeverity);
    if (!ids.length) return _v75Fail_(op, 'VALIDATION', 'Выберите значимую опасность (одну или несколько)');
    if (ms.length < 5) return _v75Fail_(op, 'VALIDATION', 'Опишите мероприятие по управлению');
    if (!cls) return _v75Fail_(op, 'VALIDATION', 'Классифицируйте меру: ККТ или ППОПМ (п. 8.5.2.4.1)');
    if (why.length < 10) return _v75Fail_(op, 'VALIDATION', 'Запишите обоснование классификации — процесс принятия решения сохраняется (п. 8.5.2.4.2)');
    if (['feasLimit', 'feasMonitor', 'feasCorrect', 'designed'].some(function (k) { return d[k] === undefined || d[k] === ''; }) || !{ SINGLE: 1, COMBINATION: 1 }[String(d.combination)])
      return _v75Fail_(op, 'VALIDATION', 'Ответьте на вопросы оценки меры: специально ли для снижения опасности, одна или в комбинации, осуществимость предела, мониторинга и коррекции');
    return _withLock_(function () {
      var m = _v75Method_(); if (!m) return _v75Fail_(op, 'STATE', 'Нет утверждённой методики оценки (п. 8.5.2.3)');
      if (!(fL >= 1 && fL <= m.levels) || !(fS >= 1 && fS <= m.levels)) return _v75Fail_(op, 'VALIDATION', 'Вероятность и тяжесть сбоя меры — уровни от 1 до ' + m.levels);
      var V = _v75V30_(), H = ids.map(function (i) { return V.H[i]; });
      if (H.some(function (h) { return !h; })) return _v75Fail_(op, 'NOT_FOUND', 'Опасность не найдена');
      if (H.some(function (h) { return !h.significant; })) return _v75Fail_(op, 'VALIDATION', 'Мера выбирается для значимых опасностей (п. 8.5.2.4.1)');
      var proc = String(d.processId || H[0].processId), sug = _v75Suggest_(d), who = _v75Who_(op), now = new Date();
      var ex = d.id ? _v75Rows_('MS').filter(function (r) { return String(r.MeasureID) === String(d.id); })[0] : null;
      if (d.id && !ex) return _v75Fail_(op, 'NOT_FOUND', 'Мера не найдена');
      var cid = ex ? String(ex.ControlID || '') : '', csh = _book_().getSheetByName(MC_V30.CCP), cr = cid ? _v75Row_(MC_V30.CCP, cid) : null;
      if (cr) { csh.getRange(cr.row, 2, 1, 4).setValues([[proc, ids[0], cls, ms]]); }
      else {
        cid = _v30Id_('CCP');
        csh.appendRow([cid, proc, ids[0], cls, ms, '', '', '', '', '', '', '', '', 'DRAFT', '1', '', '', now, who.name]);   // пределы, мониторинг, коррекцию вносит группа — система не придумывает
      }
      var rec = { MeasureID: ex ? ex.MeasureID : _v75Id_('MS'), 'Опасности (JSON)': JSON.stringify(ids), ProcessID: proc, 'Мера': ms, 'Вероятность сбоя': fL, 'Тяжесть сбоя': fS,
        'Влияние на опасность': String(d.effect || '').trim(), 'Место среди мер': String(d.position || '').trim(), 'Специально для снижения': _v75Yes_(d.designed) ? 'да' : 'нет',
        'Одна или в комбинации': d.combination === 'SINGLE' ? 'одна' : 'в комбинации', 'Измеримый предел возможен': _v75Yes_(d.feasLimit) ? 'да' : 'нет',
        'Мониторинг выявит нарушение': _v75Yes_(d.feasMonitor) ? 'да' : 'нет', 'Своевременная коррекция возможна': _v75Yes_(d.feasCorrect) ? 'да' : 'нет',
        'Предложение системы': sug, 'Классификация': cls, 'Обоснование': why, 'Внешние требования': String(d.external || '').trim(), 'Обоснование предела': String(d.limitBasis || '').trim(),
        ControlID: cid, 'Решил': who.name + (who.role ? ', ' + who.role : ''), 'Решено': now, 'Статус': 'ACTIVE', OperationID: op.id };
      if (ex) _v75Set_('MS', ex._row, rec); else _v75Append_('MS', rec);
      _audit_(op, 'HACCP_MEASURE', 'ХАССП', rec.MeasureID, null, { hazards: ids, suggestion: sug, classification: cls, controlId: cid });
      _endOp_(op); return _ok_({ id: rec.MeasureID, controlId: cid, suggestion: sug, classification: cls }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Обоснование критического предела / критерия действия (п. 8.5.4.2) — к уже классифицированной мере. */
function v75LimitBasis(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V75_EDIT_, 'HACCP_LIMIT_BASIS', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v75J_(json, {}), b = String(d.basis || '').trim();
    if (b.length < 5) return _v75Fail_(op, 'VALIDATION', 'Обоснование: документ и пункт, протокол, инструкция изготовителя (п. 8.5.4.2)');
    return _withLock_(function () {
      var r = _v75Rows_('MS').filter(function (x) { return String(x.ControlID) === String(d.controlId); })[0];
      if (!r) return _v75Fail_(op, 'NOT_FOUND', 'Для этой ККТ/ОПРП нет классифицированной меры (п. 8.5.2.4)');
      _v75Set_('MS', r._row, { 'Обоснование предела': b });
      _audit_(op, 'HACCP_LIMIT_BASIS', 'ХАССП', String(d.controlId), null, { basis: b });
      _endOp_(op); return _ok_({ controlId: String(d.controlId), basis: b }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- валидация (8.5.3) ---------------- */
function _v75ValState_(c, M, vals) {
  var mine = vals.filter(function (v) { return String(v.ControlID) === c.id; });
  if (!mine.length) return { state: 'NONE', text: 'не проводилась' };
  var last = mine[mine.length - 1];
  if (String(last['Результат']) !== 'VALID') return { state: 'NOT_VALID', text: 'не подтверждена: ' + String(last['Вывод'] || ''), last: last };
  if (String(last['Снимок параметров']) !== _v75Snap_(c, M)) return { state: 'CHANGED', text: 'параметры изменены после валидации — нужна повторная (п. 8.5.3)', last: last };
  return { state: 'VALID', text: 'подтверждена ' + _v75Day_(last['Выполнено']) + ' (' + (_v75Ref_(MC_V75_VMETHOD_, String(last['Метод'])) || ['', ''])[1] + ')', last: last };
}
function v75Validate(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V75_EDIT_, 'HACCP_VALIDATE', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v75J_(json, {}), meth = _v75Ref_(MC_V75_VMETHOD_, String(d.method || '')), ev = String(d.evidence || '').trim(), res = { VALID: 1, NOT_VALID: 1 }[String(d.result)] ? String(d.result) : '';
    var concl = String(d.conclusion || '').trim();
    if (!meth) return _v75Fail_(op, 'VALIDATION', 'Выберите метод валидации');
    if (ev.length < 5) return _v75Fail_(op, 'VALIDATION', 'Укажите свидетельство: документ, протокол, записи замеров (п. 8.5.3)');
    if (!res) return _v75Fail_(op, 'VALIDATION', 'Результат: мера обеспечивает управление опасностью или нет');
    if (concl.length < 5) return _v75Fail_(op, 'VALIDATION', 'Запишите вывод');
    return _withLock_(function () {
      var V = _v75V30_(), c = V.C[String(d.controlId)];
      if (!c || !{ CCP: 1, OPRP: 1 }[c.type]) return _v75Fail_(op, 'NOT_FOUND', 'ККТ или ОПРП не найдена');
      if (!String(c.limit).trim()) return _v75Fail_(op, 'VALIDATION', 'Сначала задайте ' + (c.type === 'CCP' ? 'критический предел' : 'критерий действия') + ' в «ХАССП: процессы и ККТ» (п. 8.5.4.2)');
      var who = _v75Who_(op), id = _v75Id_('VAL');
      _v75Append_('VAL', { ValidationID: id, ControlID: c.id, 'Метод': meth[0], 'Свидетельство': ev, 'Результат': res, 'Вывод': concl, 'Снимок параметров': _v75Snap_(c, V.M),
        'Выполнил': who.name + (who.role ? ', ' + who.role : ''), 'Выполнено': new Date(), OperationID: op.id });
      _audit_(op, 'HACCP_VALIDATE', 'ХАССП', c.id, null, { method: meth[0], result: res, limit: c.limit });
      _endOp_(op); return _ok_({ id: id, controlId: c.id, result: res }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- описания продукции (8.5.1.2–8.5.1.4) ---------------- */
function _v75Groups_(idx) { var g = {}; Object.keys(idx.dishByCode).forEach(function (c) { var x = idx.dishByCode[c]; if (!x.semi) g[String(x.cat || 'Без категории')] = 1; }); return Object.keys(g).sort(); }
function _v75RawList_(idx) {
  var own = {}, m = {};
  Object.keys(idx.dishByCode).forEach(function (c) { own[_normNameServer_(idx.dishByCode[c].name)] = 1; });
  Object.keys(idx.dishByCode).forEach(function (c) { (idx.dishByCode[c].ing || []).forEach(function (i) { var n = String(i[0] || '').trim(); if (!n || own[_normNameServer_(n)]) return; m[_v75Lo_(n)] = n; }); });
  return Object.keys(m).sort().map(function (k) { return m[k]; });
}
function v75SaveDescription(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V75_DESC_, 'HACCP_DESCRIPTION', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v75J_(json, {}), t = String(d.type || ''), F = MC_V75_DFIELDS_[t], key = String(d.key || '').trim(), f = d.fields || {};
    if (!F) return _v75Fail_(op, 'VALIDATION', 'Тип описания: сырьё, конечная продукция или предусмотренное применение');
    if (!key) return _v75Fail_(op, 'VALIDATION', t === 'RAW' ? 'Выберите продукт (сырьё)' : 'Выберите блюдо или группу блюд');
    var miss = F.filter(function (x) { return x[2] && String(f[x[0]] || '').trim().length < 3; }).map(function (x) { return x[1]; });
    if (miss.length) return _v75Fail_(op, 'VALIDATION', 'Заполните: ' + miss.join('; '));
    var clean = {}; F.forEach(function (x) { var v = String(f[x[0]] || '').trim(); if (v) clean[x[0]] = v; });
    return _withLock_(function () {
      var idx = _buildDishIndexes_(), name = key;
      if (t !== 'RAW') {
        if (key.indexOf('GROUP:') === 0) { if (_v75Groups_(idx).indexOf(key.slice(6)) < 0) return _v75Fail_(op, 'NOT_FOUND', 'Нет такой группы блюд в ТТК'); name = 'Группа «' + key.slice(6) + '»'; }
        else { var dish = idx.dishByCode[key]; if (!dish) return _v75Fail_(op, 'NOT_FOUND', 'Блюдо не найдено в ТТК'); name = dish.name; }
      }
      var who = _v75Who_(op), now = new Date(), ex = _v75Rows_('DSC').filter(function (r) { return String(r['Тип']) === t && _v75Lo_(r['Ключ']) === _v75Lo_(key); })[0];
      if (ex) _v75Set_('DSC', ex._row, { 'Поля (JSON)': JSON.stringify(clean), 'Название': name, 'Обновил': who.name, 'Обновлено': now, OperationID: op.id });
      else _v75Append_('DSC', { DescID: _v75Id_('DSC'), 'Тип': t, 'Ключ': key, 'Название': name, 'Поля (JSON)': JSON.stringify(clean), 'Внёс': who.name, 'Внесено': now, 'Обновил': who.name, 'Обновлено': now, OperationID: op.id });
      _audit_(op, 'HACCP_DESCRIPTION', 'ХАССП', t + ':' + key, null, { fields: Object.keys(clean) });
      _endOp_(op); return _ok_({ type: t, key: key, name: name }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Справка для описания из учёта: состав и аллергены ТТК, срок, профиль хранения сырья. В описание сама не подставляется. */
function v75Ref(type, key, token) {
  try { _requireAuth_(token, MC_V75_DESC_ + '|haccp_view'); } catch (e) { return _failFrom_(e); }
  try {
    var idx = _buildDishIndexes_(), out = { type: type, key: key, lines: [] };
    if (type === 'RAW') {
      var pv = []; try { pv = _mcBlProfSheet_().getDataRange().getValues(); } catch (e) {}
      var k = _prodKey_(key), p = pv.filter(function (r, i) { return i && _prodKey_(r[1]) === k; })[0];
      if (p) out.lines.push('Профиль хранения: ' + [p[2], p[5] !== '' || p[6] !== '' ? p[5] + '…' + p[6] + ' °C' : '', p[7] ? 'срок ' + p[7] + ' ч' : '', p[16] ? 'основание: ' + p[16] : ''].filter(String).join(', '));
      try { var prof = _alProfiles_()[_alKey_(key)]; out.lines.push('Аллергены: ' + (prof ? (prof.status === 'NONE' ? 'нет (подтверждено)' : prof.status === 'CONFIRMED' ? prof.codes.join(', ') : 'не подтверждено') : 'профиль не заполнен')); } catch (e) {}
      var used = Object.keys(idx.dishByCode).filter(function (c) { return (idx.dishByCode[c].ing || []).some(function (i) { return _v75Lo_(i[0]) === _v75Lo_(key); }); });
      out.lines.push('Входит в ТТК: ' + used.length + (used.length ? ' (' + used.slice(0, 5).map(function (c) { return idx.dishByCode[c].name; }).join(', ') + (used.length > 5 ? ' …' : '') + ')' : ''));
    } else if (String(key).indexOf('GROUP:') === 0) {
      var g = String(key).slice(6), ds = Object.keys(idx.dishByCode).filter(function (c) { return !idx.dishByCode[c].semi && String(idx.dishByCode[c].cat || 'Без категории') === g; });
      out.lines.push('Блюд в группе: ' + ds.length + (ds.length ? ' (' + ds.slice(0, 8).map(function (c) { return idx.dishByCode[c].name; }).join(', ') + (ds.length > 8 ? ' …' : '') + ')' : ''));
    } else {
      var dish = idx.dishByCode[key];
      if (dish) {
        out.lines.push('Состав по ТТК: ' + (dish.ing || []).map(function (i) { return i[0]; }).join(', '));
        try { var al = _alDishAllergens_(idx, key); out.lines.push('Аллергены по ТТК: ' + (al.allergens.length ? al.allergens.map(function (a) { return a.name; }).join(', ') : 'нет подтверждённых') + (al.complete ? '' : ' (не у всех продуктов профиль подтверждён)')); } catch (e) {}
        try { var sl = _shelfLifeFor_(key); out.lines.push('Срок реализации: ' + (sl.часы ? sl.часы + ' ч (' + sl.источник + ')' : 'не задан')); } catch (e) {}
        out.lines.push('Группа: ' + (dish.cat || 'без категории'));
      }
    }
    return _ok_(out);
  } catch (e) { return _failFrom_(e); }
}

/* ---------------- технологические схемы (8.5.1.5) ---------------- */
function v75SaveFlow(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V75_EDIT_, 'HACCP_FLOW', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v75J_(json, {}), name = String(d.name || '').trim(), steps = Array.isArray(d.steps) ? d.steps : [], prods = (Array.isArray(d.products) ? d.products : []).map(String).filter(String);
    if (name.length < 3) return _v75Fail_(op, 'VALIDATION', 'Название схемы');
    if (!prods.length) return _v75Fail_(op, 'VALIDATION', 'Для какой продукции схема: блюда или группы блюд');
    if (steps.length < 2) return _v75Fail_(op, 'VALIDATION', 'В схеме не меньше двух этапов (процессы из «ХАССП: процессы и ККТ»)');
    return _withLock_(function () {
      var V = _v75V30_(), bad = steps.filter(function (s) { return !V.P[String(s.processId)]; });
      if (bad.length) return _v75Fail_(op, 'NOT_FOUND', 'Процесс не найден в «ХАССП: процессы и ККТ»');
      var st = steps.map(function (s) { return { processId: String(s.processId), inputs: String(s.inputs || '').trim(), rework: String(s.rework || '').trim(), outputs: String(s.outputs || '').trim(), outsourced: _v75Yes_(s.outsourced) }; });
      var desc = {}; ['premises', 'equipment', 'prp', 'external', 'variations'].forEach(function (k) { var v = String(d[k] || '').trim(); if (v) desc[k] = v; });
      var who = _v75Who_(op), now = new Date(), ex = d.id ? _v75Rows_('FLW').filter(function (r) { return String(r.FlowID) === String(d.id); })[0] : null;
      if (d.id && !ex) return _v75Fail_(op, 'NOT_FOUND', 'Схема не найдена');
      var ver = ex ? (Number(ex['Версия']) || 1) + 1 : 1, id = ex ? String(ex.FlowID) : _v75Id_('FLW');
      var rec = { FlowID: id, 'Название': name, 'Для продукции (JSON)': JSON.stringify(prods), 'Шаги (JSON)': JSON.stringify(st), 'Описание (JSON)': JSON.stringify(desc), 'Версия': ver, 'Статус': 'ACTIVE',
        'Обновил': who.name, 'Обновлено': now, OperationID: op.id };
      if (ex) _v75Set_('FLW', ex._row, rec); else { rec['Внёс'] = who.name; rec['Внесено'] = now; _v75Append_('FLW', rec); }
      _audit_(op, 'HACCP_FLOW', 'ХАССП', id, ex ? { version: ex['Версия'] } : null, { version: ver, steps: st.length, products: prods });
      _endOp_(op); return _ok_({ id: id, version: ver, confirmed: false }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Подтверждение схемы на производственной площадке (8.5.1.5.2): к текущей версии схемы. */
function v75ConfirmFlow(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V75_DESC_, 'HACCP_FLOW_CONFIRM', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v75J_(json, {}), res = { CONFIRMED: 1, DIFFERENCES: 1 }[String(d.result)] ? String(d.result) : '', diff = String(d.differences || '').trim();
    if (!res) return _v75Fail_(op, 'VALIDATION', 'Результат: схема соответствует или есть расхождения');
    if (res === 'DIFFERENCES' && diff.length < 5) return _v75Fail_(op, 'VALIDATION', 'Опишите расхождения — схему затем нужно исправить');
    return _withLock_(function () {
      var f = _v75Rows_('FLW').filter(function (r) { return String(r.FlowID) === String(d.flowId); })[0]; if (!f) return _v75Fail_(op, 'NOT_FOUND', 'Схема не найдена');
      var who = _v75Who_(op), id = _v75Id_('CNF');
      _v75Append_('CNF', { ConfID: id, FlowID: f.FlowID, 'Версия схемы': Number(f['Версия']) || 1, 'Результат': res, 'Расхождения': diff, 'Подтвердил': who.name, 'Должность': who.role, 'Подтверждено': new Date(), OperationID: op.id });
      _audit_(op, 'HACCP_FLOW_CONFIRM', 'ХАССП', String(f.FlowID), null, { version: f['Версия'], result: res });
      _endOp_(op); return _ok_({ id: id, flowId: String(f.FlowID), result: res }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- пересмотр (8.6) ---------------- */
function _v75Changes_(since) {
  var t = since ? since.getTime() : 0, n = function (k, col) { return _v75Rows_(k).filter(function (r) { var d = r[col]; d = d instanceof Date ? d : _mcBlDate_(d); return d && d.getTime() > t; }).length; };
  var V30 = 0; try { _v30Rows_(MC_V30.HAZARD).concat(_v30Rows_(MC_V30.CCP)).forEach(function (r) { var d = r[r.length - 2]; d = d instanceof Date ? d : null; if (d && d.getTime() > t) V30++; }); } catch (e) {}
  return { hazards: n('HZ', 'Оценено'), measures: n('MS', 'Решено'), validations: n('VAL', 'Выполнено'), descriptions: n('DSC', 'Обновлено'), flows: n('FLW', 'Обновлено'), confirmations: n('CNF', 'Подтверждено'), v30: V30 };
}
function v75Review(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V75_EDIT_, 'HACCP_REVIEW', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v75J_(json, {}), chk = String(d.checked || '').trim(), chg = String(d.changes || '').trim();
    if (chk.length < 10) return _v75Fail_(op, 'VALIDATION', 'Что проверено: сырьё, продукция, применение, схемы, опасности, меры (п. 8.6 a–d)');
    if (chg.length < 3) return _v75Fail_(op, 'VALIDATION', 'Что изменено (или «изменений нет»)');
    return _withLock_(function () {
      var st = _v75Settings_(), now = new Date(), next = '';
      if (st.reviewMonths) { next = new Date(now.getTime()); next.setMonth(next.getMonth() + st.reviewMonths); }
      var who = _v75Who_(op), id = _v75Id_('REV');
      _v75Append_('REV', { ReviewID: id, 'Пересмотрено': now, 'Кто': who.name + (who.role ? ', ' + who.role : ''), 'Что проверено': chk, 'Изменения': chg, 'Следующий пересмотр': next, OperationID: op.id });
      _audit_(op, 'HACCP_REVIEW', 'ХАССП', id, null, { checked: chk, changes: chg });
      _endOp_(op); return _ok_({ id: id, next: _v75Day_(next) }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- сводка: экран, готовность, план ---------------- */
function _v75Collect_() {
  var V = _v75V30_(), A = _v75Assess_(), method = _v75Method_(), draft = null, st = _v75Settings_(), idx = _buildDishIndexes_();
  _v75Rows_('MTH').forEach(function (r) { if (String(r['Статус']) === 'DRAFT') draft = _v75Method_(r.MethodID); });
  var hazards = Object.keys(V.H).map(function (k) { return V.H[k]; }).filter(function (h) { return h.status !== 'ARCHIVED'; }).map(function (h) {
    var a = A[h.id], p = V.P[h.processId] || {};
    return { id: h.id, processId: h.processId, process: p.name || h.processId, seq: p.seq || 0, kind: a ? String(a['Вид (код)']) : '', category: h.category, hazard: h.hazard, cause: h.cause, preventive: h.preventive,
      sources: a ? _v75J_(a['Источник идентификации'], []) : [], stage: a ? String(a['Как проявляется на этапе']) : '', acceptable: a ? String(a['Приемлемый уровень'] || '') : '', acceptableBasis: a ? String(a['Обоснование уровня'] || '') : '',
      likelihood: a ? Number(a['Вероятность']) : null, severity: a ? Number(a['Тяжесть']) : null, risk: a ? Number(a['Риск']) : null, auto: a ? String(a['Значимая по расчёту']) === 'да' : null,
      significant: h.significant, note: a ? String(a['Обоснование решения'] || '') : '', methodId: a ? String(a.MethodID) : '', assessed: !!a, assessedBy: a ? String(a['Оценил']) : '', assessedAt: a ? _v75Fmt_(a['Оценено']) : '',
      stale: !!(a && method && String(a.MethodID) !== method.id) };
  }).sort(function (x, y) { return x.seq - y.seq || x.process.localeCompare(y.process, 'ru'); });
  var measures = _v75Rows_('MS').filter(function (r) { return String(r['Статус']) !== 'ARCHIVED'; }).map(function (r) {
    return { id: String(r.MeasureID), hazardIds: _v75J_(r['Опасности (JSON)'], []), processId: String(r.ProcessID), process: (V.P[String(r.ProcessID)] || {}).name || '', measure: String(r['Мера']),
      failL: Number(r['Вероятность сбоя']), failS: Number(r['Тяжесть сбоя']), effect: String(r['Влияние на опасность'] || ''), position: String(r['Место среди мер'] || ''), designed: String(r['Специально для снижения']),
      combination: String(r['Одна или в комбинации']), feas: [String(r['Измеримый предел возможен']), String(r['Мониторинг выявит нарушение']), String(r['Своевременная коррекция возможна'])],
      suggestion: String(r['Предложение системы']), classification: String(r['Классификация']), rationale: String(r['Обоснование'] || ''), external: String(r['Внешние требования'] || ''),
      limitBasis: String(r['Обоснование предела'] || ''), controlId: String(r.ControlID || ''), by: String(r['Решил'] || ''), at: _v75Fmt_(r['Решено']) };
  });
  var vals = _v75Rows_('VAL');
  var controls = Object.keys(V.C).map(function (k) { return V.C[k]; }).filter(function (c) { return { CCP: 1, OPRP: 1 }[c.type] && c.status !== 'ARCHIVED'; }).map(function (c) {
    var ms = measures.filter(function (m) { return m.controlId === c.id; })[0], vs = _v75ValState_(c, V.M, vals), h = V.H[c.hazardId];
    return { id: c.id, type: c.type, point: c.point, process: (V.P[c.processId] || {}).name || '', hazard: h ? h.hazard : '', hazards: ms ? ms.hazardIds.map(function (i) { return V.H[i] ? V.H[i].hazard : i; }) : (h ? [h.hazard] : []),
      limit: c.limit, unit: c.unit, method: c.method, frequency: c.frequency, responsible: c.responsible, corrective: c.corrective, record: c.record, status: c.status,
      monitoring: V.M.filter(function (m) { return m.controlId === c.id; }), limitBasis: ms ? ms.limitBasis : '', measureId: ms ? ms.id : '', validation: vs };
  });
  var D = _v75Rows_('DSC').map(function (r) { return { id: String(r.DescID), type: String(r['Тип']), key: String(r['Ключ']), name: String(r['Название']), fields: _v75J_(r['Поля (JSON)'], {}), by: String(r['Обновил'] || ''), at: _v75Fmt_(r['Обновлено']) }; });
  var conf = _v75Rows_('CNF');
  var flows = _v75Rows_('FLW').filter(function (r) { return String(r['Статус']) !== 'ARCHIVED'; }).map(function (r) {
    var ver = Number(r['Версия']) || 1, cs = conf.filter(function (c) { return String(c.FlowID) === String(r.FlowID); }), cur = cs.filter(function (c) { return Number(c['Версия схемы']) === ver; }), last = cur[cur.length - 1];
    return { id: String(r.FlowID), name: String(r['Название']), products: _v75J_(r['Для продукции (JSON)'], []), steps: _v75J_(r['Шаги (JSON)'], []).map(function (s) { s.name = (V.P[s.processId] || {}).name || s.processId; return s; }),
      desc: _v75J_(r['Описание (JSON)'], {}), version: ver, updatedBy: String(r['Обновил'] || ''), updatedAt: _v75Fmt_(r['Обновлено']),
      confirmed: !!(last && String(last['Результат']) === 'CONFIRMED'), differences: last && String(last['Результат']) === 'DIFFERENCES' ? String(last['Расхождения']) : '',
      confirmedBy: last ? String(last['Подтвердил']) + (last['Должность'] ? ', ' + last['Должность'] : '') : '', confirmedAt: last ? _v75Fmt_(last['Подтверждено']) : '',
      history: cs.map(function (c) { return { version: Number(c['Версия схемы']), result: String(c['Результат']), differences: String(c['Расхождения'] || ''), by: String(c['Подтвердил']), at: _v75Fmt_(c['Подтверждено']) }; }) };
  });
  var reviews = _v75Rows_('REV').map(function (r) { return { id: String(r.ReviewID), at: _v75Fmt_(r['Пересмотрено']), ts: r['Пересмотрено'] instanceof Date ? r['Пересмотрено'] : _mcBlDate_(r['Пересмотрено']), by: String(r['Кто']),
    checked: String(r['Что проверено']), changes: String(r['Изменения']), next: _v75Day_(r['Следующий пересмотр']), nextTs: r['Следующий пересмотр'] instanceof Date ? r['Следующий пересмотр'] : _mcBlDate_(r['Следующий пересмотр']) }; });
  var lastRev = reviews[reviews.length - 1] || null;
  // покрытие описаниями
  var groups = _v75Groups_(idx), dishes = Object.keys(idx.dishByCode).filter(function (c) { return !idx.dishByCode[c].semi; }), raw = _v75RawList_(idx);
  var has = function (t, k) { return D.some(function (x) { return x.type === t && _v75Lo_(x.key) === _v75Lo_(k); }); };
  var covered = function (t) { return dishes.filter(function (c) { return has(t, c) || has(t, 'GROUP:' + String(idx.dishByCode[c].cat || 'Без категории')); }).length; };
  var flowCovered = dishes.filter(function (c) { var g = 'GROUP:' + String(idx.dishByCode[c].cat || 'Без категории'); return flows.some(function (f) { return f.products.indexOf(c) >= 0 || f.products.indexOf(g) >= 0; }); }).length;
  var cov = { dishes: dishes.length, end: covered('END'), use: covered('USE'), raw: raw.length, rawDone: raw.filter(function (n) { return has('RAW', n); }).length, flows: flowCovered };
  return { V: V, method: method, draft: draft, settings: st, hazards: hazards, measures: measures, controls: controls, descriptions: D, flows: flows, reviews: reviews, lastReview: lastRev,
    coverage: cov, groups: groups, dishList: dishes.map(function (c) { return { code: c, name: idx.dishByCode[c].name, cat: String(idx.dishByCode[c].cat || 'Без категории') }; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); }), rawList: raw };
}
function _v75Ready_(X) {
  var it = [], add = function (ok, name, detail, ref) { it.push({ ok: !!ok, name: name, detail: detail, ref: ref }); };
  var c = X.coverage, act = Object.keys(X.V.P).map(function (k) { return X.V.P[k]; }).filter(function (p) { return /ACTIVE|APPROVED/.test(p.status); });
  add(X.settings.team.length > 0, 'Группа безопасности пищевой продукции назначена', X.settings.team.length ? X.settings.team.map(function (t) { return t.name; }).join(', ') : 'не назначена — назначает руководство', '8.5.1.1');
  add(!!X.method, 'Методика оценки опасностей утверждена', X.method ? 'версия ' + X.method.version + ', порог ' + X.method.threshold + ', утвердил ' + X.method.approvedBy : 'нет утверждённой', '8.5.2.3 (методика)');
  add(c.rawDone >= c.raw && c.raw > 0, 'Описаны сырьё и ингредиенты', c.rawDone + ' из ' + c.raw, '8.5.1.2');
  add(c.end >= c.dishes && c.dishes > 0, 'Описана конечная продукция', c.end + ' из ' + c.dishes + ' блюд (по блюду или группе)', '8.5.1.3');
  add(c.use >= c.dishes && c.dishes > 0, 'Описано предусмотренное применение и группы потребителей', c.use + ' из ' + c.dishes, '8.5.1.4');
  add(c.flows >= c.dishes && c.dishes > 0, 'Блюда охвачены технологическими схемами', c.flows + ' из ' + c.dishes, '8.5.1.5.1');
  var unconf = X.flows.filter(function (f) { return !f.confirmed; });
  add(X.flows.length > 0 && !unconf.length, 'Схемы подтверждены на площадке (текущая версия)', X.flows.length ? (unconf.length ? 'не подтверждены: ' + unconf.map(function (f) { return f.name + (f.differences ? ' (расхождения)' : ''); }).join(', ') : 'все ' + X.flows.length) : 'схем нет', '8.5.1.5.2');
  var noHaz = act.filter(function (p) { return !X.hazards.some(function (h) { return h.processId === p.id; }); });
  add(act.length > 0 && !noHaz.length, 'Опасности определены для действующих этапов', act.length ? (noHaz.length ? 'нет опасностей: ' + noHaz.map(function (p) { return p.name; }).join(', ') : 'все ' + act.length + ' этапов') : 'действующих процессов нет', '8.5.2.2');
  var notAss = X.hazards.filter(function (h) { return !h.assessed || h.stale; });
  add(X.hazards.length > 0 && !notAss.length, 'Опасности оценены по действующей методике', notAss.length ? 'оценить: ' + notAss.length + ' (в т. ч. внесённые до методики)' : X.hazards.length + ' оценено', '8.5.2.3');
  var noLvl = X.hazards.filter(function (h) { return h.significant && !h.acceptable; });
  add(!noLvl.length, 'Для значимых опасностей определён приемлемый уровень', noLvl.length ? 'не определён: ' + noLvl.length : 'да', '8.5.2.2.3');
  var sig = X.hazards.filter(function (h) { return h.significant; }), noMs = sig.filter(function (h) { return !X.measures.some(function (m) { return m.hazardIds.indexOf(h.id) >= 0; }); });
  add(sig.length > 0 && !noMs.length, 'Для значимых опасностей выбраны и классифицированы меры', sig.length ? (noMs.length ? 'без меры: ' + noMs.map(function (h) { return h.hazard; }).join(', ') : 'все ' + sig.length) : 'значимых опасностей нет', '8.5.2.4');
  var incomplete = X.controls.filter(function (k) { return !String(k.limit).trim() || !k.monitoring.length || !k.corrective || !k.limitBasis; });
  add(X.controls.length > 0 && !incomplete.length, 'План: предел, обоснование, мониторинг и коррекция у каждой ККТ/ОПРП', incomplete.length ? 'не заполнено: ' + incomplete.map(function (k) { return k.point; }).join(', ') : X.controls.length + ' ККТ/ОПРП', '8.5.4.1–8.5.4.4');
  var nv = X.controls.filter(function (k) { return k.validation.state !== 'VALID'; });
  add(X.controls.length > 0 && !nv.length, 'Меры валидированы, после изменений — повторно', nv.length ? nv.map(function (k) { return k.point + ': ' + k.validation.text; }).join('; ') : 'все', '8.5.3');
  var due = X.lastReview && X.lastReview.nextTs ? X.lastReview.nextTs.getTime() < Date.now() : !X.lastReview;
  add(!due && !!X.lastReview, 'План пересматривается', X.lastReview ? 'последний ' + X.lastReview.at + (X.lastReview.next ? ', следующий ' + X.lastReview.next : '') : 'пересмотра не было' + (X.settings.reviewMonths ? '' : '; периодичность не задана'), '8.6');
  return it;
}
function v75Data(token) {
  try { _requireAuth_(token, MC_V75_VIEW_ + '|ttk_approve'); } catch (e) { return _failFrom_(e); }
  try {
    var X = _v75Collect_(), items = _v75Ready_(X), staff = [];
    try { staff = JSON.parse(getEmployees() || '[]').filter(function (e) { return e.active !== false; }).map(function (e) { return { name: e.name, position: e.position || '' }; }); } catch (e) {}
    var processes = Object.keys(X.V.P).map(function (k) { return X.V.P[k]; }).sort(function (a, b) { return a.seq - b.seq; });
    var since = X.lastReview && X.lastReview.ts ? X.lastReview.ts : null;
    return _ok_({ ready: items, score: Math.round(items.filter(function (x) { return x.ok; }).length / items.length * 100), settings: X.settings, staff: staff,
      method: X.method, draft: X.draft, template: MC_V75_TEMPLATE_, processes: processes, hazards: X.hazards, measures: X.measures, controls: X.controls,
      descriptions: X.descriptions, flows: X.flows, reviews: X.reviews.slice().reverse().map(function (r) { delete r.ts; delete r.nextTs; return r; }), changesSinceReview: _v75Changes_(since),
      coverage: X.coverage, groups: X.groups, dishes: X.dishList, raw: X.rawList,
      dict: { kinds: MC_V75_KIND_, sources: MC_V75_SOURCE_, stages: MC_V75_STAGE_, vmethods: MC_V75_VMETHOD_, origin: MC_V75_ORIGIN_, distribution: MC_V75_DIST_, fields: MC_V75_DFIELDS_ } });
  } catch (e) { return _failFrom_(e); }
}

/* ---------------- PDF плана (8.5.4) ---------------- */
function _v75PlanBody_(X, items) {
  var E = _mcOrgEsc_, nf = '<span class="bad">не заполнено</span>', h = '', row = function (a) { return '<tr>' + a.map(function (x) { return '<td>' + (x && x.__html ? x.__html : E(x === null || x === undefined ? '' : x)) + '</td>'; }).join('') + '</tr>'; };
  var kindName = function (k) { return (_v75Ref_(MC_V75_KIND_, k) || ['', ''])[1]; }, stageName = function (k) { return (_v75Ref_(MC_V75_STAGE_, k) || ['', ''])[1]; };
  h += '<h2>1. Группа безопасности пищевой продукции (8.5.1.1)</h2><div>' + (X.settings.team.length ? X.settings.team.map(function (t) { return E(t.name) + (t.position ? ', ' + E(t.position) : ''); }).join('; ') : nf) + '</div>';
  h += '<h2>2. Методика оценки опасностей (8.5.2.3)</h2>';
  if (X.method) {
    h += '<div>Версия ' + X.method.version + ', утверждена: ' + E(X.method.approvedBy) + ', ' + E(X.method.approvedAt) + '. Риск = вероятность × тяжесть; опасность значимая при риске ≥ ' + X.method.threshold + '.' + (X.method.note ? ' ' + E(X.method.note) : '') + '</div>' +
      '<table class="r"><tr><th>Уровень</th><th>Вероятность (до мер управления)</th><th>Тяжесть (с учётом предусмотренного применения)</th></tr>';
    for (var i = 0; i < X.method.levels; i++) h += row([i + 1, X.method.likelihood[i], X.method.severity[i]]);
    h += '</table>';
  } else h += '<div>' + nf + '</div>';
  h += '<h2>3. Описания сырья, продукции и предусмотренного применения (8.5.1.2–8.5.1.4)</h2>';
  ['RAW', 'END', 'USE'].forEach(function (t) {
    var list = X.descriptions.filter(function (d) { return d.type === t; }), F = MC_V75_DFIELDS_[t];
    h += '<h3>' + { RAW: 'Сырьё, ингредиенты, контактирующие материалы', END: 'Конечная продукция', USE: 'Предусмотренное применение' }[t] + ' — ' + list.length + '</h3>';
    if (!list.length) { h += '<div>' + nf + '</div>'; return; }
    h += '<table class="r"><tr><th>Продукция</th>' + F.map(function (f) { return '<th>' + E(f[1]) + '</th>'; }).join('') + '</tr>';
    list.forEach(function (d) { h += row([d.name].concat(F.map(function (f) { return d.fields[f[0]] || ''; }))); });
    h += '</table>';
  });
  h += '<h2>4. Технологические схемы (8.5.1.5)</h2>';
  if (!X.flows.length) h += '<div>' + nf + '</div>';
  X.flows.forEach(function (f) {
    h += '<h3>' + E(f.name) + ' — версия ' + f.version + '</h3><div class="muted">Для продукции: ' + E(f.products.map(function (p) { return p.indexOf('GROUP:') === 0 ? 'группа «' + p.slice(6) + '»' : ((X.dishList.filter(function (d) { return d.code === p; })[0] || {}).name || p); }).join(', ')) + '</div>' +
      '<table class="r"><tr><th>№</th><th>Этап</th><th>Вводится</th><th>Переделка, переработка</th><th>Выпуск, отходы</th><th>Внешняя организация</th></tr>';
    f.steps.forEach(function (s, i) { h += row([i + 1, s.name, s.inputs, s.rework, s.outputs, s.outsourced ? 'да' : '']); });
    h += '</table><div>Подтверждение на площадке (8.5.1.5.2): ' + (f.confirmed ? E(f.confirmedBy) + ', ' + E(f.confirmedAt) : f.differences ? '<span class="bad">расхождения: ' + E(f.differences) + '</span>' : nf) + '</div>';
    var dd = f.desc, dl = [['premises', 'помещения и зоны'], ['equipment', 'оборудование, контактирующие материалы'], ['prp', 'ПОПМ, параметры процесса'], ['external', 'внешние требования'], ['variations', 'сезонные и сменные изменения']];
    h += '<div class="muted">' + dl.filter(function (k) { return dd[k[0]]; }).map(function (k) { return E(k[1]) + ': ' + E(dd[k[0]]); }).join('<br>') + '</div>';
  });
  h += '<h2>5. Анализ опасностей (8.5.2)</h2><table class="r"><tr><th>Этап</th><th>Вид</th><th>Опасность, причина</th><th>Проявление</th><th>Источник</th><th>Приемлемый уровень, обоснование</th><th class="n">В</th><th class="n">Т</th><th class="n">Риск</th><th>Значимая</th></tr>';
  X.hazards.forEach(function (z) {
    h += row([z.process, kindName(z.kind) || z.category, z.hazard + (z.cause ? '; причина: ' + z.cause : ''), stageName(z.stage), z.sources.map(function (s) { return (_v75Ref_(MC_V75_SOURCE_, s) || ['', s])[1]; }).join('; '),
      z.acceptable ? z.acceptable + ' — ' + z.acceptableBasis : '', z.likelihood, z.severity, z.risk, z.assessed ? (z.significant ? 'да' : 'нет') + (z.note ? ' (решение: ' + z.note + ')' : '') : 'не оценена']);
  });
  h += '</table><h2>6. Мероприятия по управлению и классификация (8.5.2.4)</h2><table class="r"><tr><th>Мера</th><th>Опасности</th><th>Сбой: В / Т</th><th>Оценка меры</th><th>Осуществимость: предел / мониторинг / коррекция</th><th>Предложение</th><th>Решение, обоснование</th></tr>';
  X.measures.forEach(function (m) {
    h += row([m.measure + ' (' + m.process + ')', m.hazardIds.map(function (i) { return (X.V.H[i] || {}).hazard || i; }).join('; '), m.failL + ' / ' + m.failS,
      ['влияние: ' + m.effect, 'место: ' + m.position, 'специально для снижения: ' + m.designed, m.combination].filter(function (x) { return !/: $/.test(x); }).join('; '), m.feas.join(' / '),
      m.suggestion === 'CCP' ? 'ККТ' : 'ППОПМ', (m.classification === 'CCP' ? 'ККТ' : 'ППОПМ') + ': ' + m.rationale + (m.external ? '; внешние требования: ' + m.external : '') + ' — ' + m.by]);
  });
  h += '</table><h2>7. План управления опасностями (8.5.4)</h2><table class="r"><tr><th>ККТ / ППОПМ</th><th>Опасность</th><th>Критический предел / критерий действия, обоснование</th><th>Мониторинг</th><th>Коррекция</th><th>Ответственный</th><th>Записи</th><th>Валидация (8.5.3)</th></tr>';
  X.controls.forEach(function (k) {
    h += row([(k.type === 'CCP' ? 'ККТ' : 'ППОПМ') + ': ' + k.point + ' (' + k.process + ')', k.hazards.join('; '),
      { __html: (String(k.limit).trim() ? E(k.limit + ' ' + k.unit) : nf) + '<br>' + (k.limitBasis ? 'обоснование: ' + E(k.limitBasis) : nf) },
      { __html: k.monitoring.length ? k.monitoring.map(function (m) { return E(m.parameter + ' ' + (m.min !== '' ? 'от ' + m.min : '') + (m.max !== '' ? ' до ' + m.max : '') + ' ' + m.unit + '; ' + m.frequency + (m.journal ? '; журнал ' + m.journal : '')); }).join('<br>') : (k.method ? E(k.method + '; ' + k.frequency) : nf) },
      { __html: k.corrective ? E(k.corrective) : nf }, k.responsible, k.record, { __html: k.validation.state === 'VALID' ? E(k.validation.text) : '<span class="bad">' + E(k.validation.text) + '</span>' }]);
  });
  h += '</table><h2>8. Пересмотр (8.6)</h2>' + (X.reviews.length ? '<table class="r"><tr><th>Когда</th><th>Кто</th><th>Что проверено</th><th>Изменения</th><th>Следующий</th></tr>' + X.reviews.map(function (r) { return row([r.at, r.by, r.checked, r.changes, r.next]); }).join('') + '</table>' : '<div>' + nf + '</div>');
  h += '<h2>9. Готовность по п. 8.5</h2><table class="r"><tr><th>Пункт</th><th>Что</th><th>Состояние</th></tr>' + items.map(function (x) { return row([x.ref, x.name, { __html: (x.ok ? '<span class="ok">в порядке</span>' : '<span class="bad">нужно внести</span>') + ' — ' + E(x.detail) }]); }).join('') + '</table>';
  h += '<div class="muted">Основания: ГОСТ Р ИСО 22000-2019 п. 8.5, 8.6 (стандарт добровольного применения); СанПиН 2.3/2.4.4282-26 п. 4; ТР ТС 021/2011 ст. 10 ч. 3, ст. 11 ч. 3. Пределы, уровни и формулировки внесены группой безопасности — система их не придумывает.</div>';
  h += '<div class="sign">Группа безопасности: ____________________<br><br>Утверждаю: руководитель ____________________ / ____________________ «___» __________ 20__ г.</div>';
  return h;
}
function v75PlanPdf(token) {
  var op = null;
  try { op = _beginOp_(token, MC_V75_EDIT_, 'HACCP_PLAN_PDF', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var X = _v75Collect_(), items = _v75Ready_(X);
    var pdf = _mcPdfSave_('План управления опасностями (план ХАССП/ППОПМ)', _v75PlanBody_(X, items), { folder: (typeof _mcFolderSafe_ === 'function' ? _mcFolderSafe_('ppk') : null) || undefined, fileName: 'План ХАССП ' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd'),
      subtitle: 'ГОСТ Р ИСО 22000-2019 п. 8.5; СанПиН 2.3/2.4.4282-26 п. 4', landscape: true });
    _audit_(op, 'HACCP_PLAN_PDF', 'ХАССП', 'План ХАССП', null, { fileId: pdf.fileId, sha256: pdf.sha256, ready: items.filter(function (x) { return x.ok; }).length + '/' + items.length });
    _endOp_(op);
    return _ok_({ fileId: pdf.fileId, url: pdf.url, sha256: pdf.sha256, notReady: items.filter(function (x) { return !x.ok; }).map(function (x) { return x.ref + ' ' + x.name; }) }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- главное окно ---------------- */
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  var orig = _UI_BUILDERS_.haccp; if (typeof orig !== 'function') return;
  _UI_BUILDERS_.haccp = function (token, opts, s) { var r = orig(token, opts, s) || {}; r.actions = (r.actions || []).concat([{ label: 'Анализ опасностей и план ХАССП (ГОСТ Р ИСО 22000, п. 8.5)', module: 'hazards' }]); return r; };
})();
try { if (MC_UI_VIEWS_.indexOf('hazards') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['hazards']); } catch (e) {}
