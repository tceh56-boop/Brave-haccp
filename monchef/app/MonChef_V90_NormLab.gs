/**
 * MonChef V90 — нормативная сверка и лаборатория по аудитам владельца 20–23.11.2026.
 *
 *  1. Реестр нормативов «Нормативы_V33» дополняется документами из реестра предприятия от 20.11.2026, которых в системе не было
 *     (исторические, условно применимые ТР ЕАЭС, федеральные законы, приказы, профстандарт, методические указания 1991 г.).
 *     Статус и применимость — дословно по реестру предприятия; реквизиты и редакции сверяются по официальной публикации.
 *     Существующие строки не перезаписываются; каждое добавление — в «Нормативы_Изменения_V33».
 *  2. Суточные пробы. В СанПиН 2.3/2.4.4282-26 суточная проба (не менее 100 г, хранение не менее 48 ч при +2…+6 °C)
 *     предусмотрена для медицинских организаций (п. 56 подп. 4), организаций стационарного социального обслуживания
 *     (п. 56 подп. 12), организованных детских коллективов (п. 59 подп. 10), детских лагерей палаточного типа (п. 65 подп. 3).
 *     Профиль предприятия задаёт ответственный за ХАССП: по профилю — основание, параметры и отсчёт срока хранения
 *     (для медицинских и социальных — с момента окончания срока реализации блюд); «по ППК» — параметры предприятия;
 *     «не применяется» — с причиной, тогда выдача партии без пробы не блокируется. Профиль не задан — как раньше (проба нужна).
 *  3. Лаборатория. Старый экран «План и исследования» (Labs.html) вносил результат номером протокола и ссылкой — без файла
 *     и SHA-256, в обход V67. Запись через него закрыта, адрес ?labs=1 открывает экран V67. Подтверждение ТУ (V66) —
 *     только протоколом PASS с файлом и SHA-256 по пробе этой версии ТУ, получившей статус TESTED.
 */
var MC_V90_SRC_ = 'реестр нормативов предприятия от 20.11.2026';
var MC_V90_NORMS_ = [
  // [DocID, Class, Status, Number, Title, From, To, Mandatory, URL, Статус по реестру, Применимость]
  ['SP_2_1_3678_20', 'SANPIN', 'HISTORICAL', 'СП 2.1.3678-20', 'Санитарные правила (историческая редакция)', '', '', false, 'http://publication.pravo.gov.ru/', 'Историческая редакция; заменён СП 2.1.4284-26', 'Исторические записи и сравнение редакций.'],
  ['SANPIN_2_3_6_1079_01', 'SANPIN', 'REVIEW', 'СанПиН 2.3.6.1079-01', 'Санитарные правила (старая редакция)', '', '', false, '', 'Старая редакция; точный статус и преемник не подтверждены', 'Архив и историческое сравнение; не применять как действующее основание без отдельной проверки.'],
  ['TRTS_029_2012', 'TECH_REG', 'CONDITIONAL', 'ТР ТС 029/2012', 'Требования безопасности пищевых добавок, ароматизаторов и технологических вспомогательных средств', '', '', true, 'https://eec.eaeunion.org/comission/department/deptexreg/tr/bezopPischDobavok.php', 'Условный по ингредиентам', 'Если в составе сырья и рецептур есть регулируемые пищевые добавки, ароматизаторы или вспомогательные средства.'],
  ['TRTS_033_2013', 'TECH_REG', 'CONDITIONAL', 'ТР ТС 033/2013', 'О безопасности молока и молочной продукции', '', '', true, 'https://eec.eaeunion.org/comission/department/deptexreg/tr/tr-ts-033.php', 'Условный по товарной категории', 'Молоко и молочная продукция в составе закупаемых ингредиентов.'],
  ['TREAES_040_2016', 'TECH_REG', 'CONDITIONAL', 'ТР ЕАЭС 040/2016', 'О безопасности рыбы и рыбной продукции', '', '', true, 'https://eec.eaeunion.org/comission/department/deptexreg/tr/TR_EEU_040_2016.php', 'Условный по товарной категории', 'Рыба и рыбная продукция, если соответствующие позиции входят в ассортимент.'],
  ['TREAES_044_2017', 'TECH_REG', 'CONDITIONAL', 'ТР ЕАЭС 044/2017', 'О безопасности упакованной питьевой воды, включая природную минеральную воду', '', '', true, 'https://eec.eaeunion.org/comission/department/deptexreg/tr/tr_EAEU_044-2017.php', 'Условный по товарной категории', 'Упакованная питьевая вода; не вода из водопровода.'],
  ['TRTS_015_2011', 'TECH_REG', 'CONDITIONAL', 'ТР ТС 015/2011', 'О безопасности зерна', '', '', true, 'https://eec.eaeunion.org/comission/department/deptexreg/tr/TR_general.php', 'Условный по продукту', 'Зерно в сфере регламента; не назначать автоматически на крупы, муку или блюда.'],
  ['TRTS_023_2011', 'TECH_REG', 'CONDITIONAL', 'ТР ТС 023/2011', 'Технический регламент на соковую продукцию из фруктов и овощей', '', '', true, 'https://eec.eaeunion.org/comission/department/deptexreg/tr/TR_general.php', 'Условный по продукту', 'Соковая продукция; не каждый напиток или смузи.'],
  ['TRTS_024_2011', 'TECH_REG', 'CONDITIONAL', 'ТР ТС 024/2011', 'Технический регламент на масложировую продукцию', '', '', true, 'https://eec.eaeunion.org/comission/department/deptexreg/tr/TR_general.php', 'Условный по продукту', 'Масложировая продукция как ингредиент или товар.'],
  ['TRTS_027_2012', 'TECH_REG', 'CONDITIONAL', 'ТР ТС 027/2012', 'О безопасности отдельных видов специализированной пищевой продукции, в том числе диетического лечебного и диетического профилактического питания', '', '', true, 'https://eec.eaeunion.org/comission/department/deptexreg/tr/TR_general.php', 'Условный по назначению', 'Специализированная пищевая продукция, например лечебное и профилактическое питание.'],
  ['TREAES_047_2018', 'TECH_REG', 'REVIEW', 'ТР ЕАЭС 047/2018', 'О безопасности алкогольной продукции', '', '', false, 'https://eec.eaeunion.org/comission/department/deptexreg/tr/TR_EAEU_047.php', 'Условный; дата вступления и переходные положения не подтверждены', 'Алкогольная продукция (бар, алкоголь в блюдах); не отмечать действующим без проверки официальных переходных положений.'],
  ['FZ_52_1999', 'LAW', 'ACTIVE', 'Федеральный закон № 52-ФЗ', 'О санитарно-эпидемиологическом благополучии населения', '', '', true, 'http://pravo.gov.ru/', 'Обязателен в применимой части; полная редакция на дату аудита требует сверки', 'Санитарные обязанности и производственный контроль.'],
  ['FZ_248_2020', 'LAW', 'ACTIVE', 'Федеральный закон № 248-ФЗ', 'О государственном контроле (надзоре) и муниципальном контроле в Российской Федерации', '', '', true, 'http://pravo.gov.ru/', 'Процедурный закон контроля; редакция на дату аудита требует сверки', 'Права и обязанности контролируемого лица и процедуры надзора; не заменяет материальные требования.'],
  ['FZ_152_2006', 'LAW', 'CONDITIONAL', 'Федеральный закон № 152-ФЗ', 'О персональных данных', '', '', true, 'http://pravo.gov.ru/', 'Обязателен при обработке персональных данных; основания зависят от цели и данных', 'В MON CHEF есть сведения сотрудников и статусы медосмотров: цели, основания, минимизация, сроки хранения.'],
  ['FZ_402_2011', 'LAW', 'CONDITIONAL', 'Федеральный закон № 402-ФЗ', 'О бухгалтерском учёте', '', '', true, 'http://publication.pravo.gov.ru/Document/View/0001201112070017', 'Применяется к учёту субъекта и первичным документам', 'Формы ОП применять, если утверждены организацией; проверить учётную политику и реквизиты первички.'],
  ['FZ_54_2003', 'LAW', 'CONDITIONAL', 'Федеральный закон № 54-ФЗ', 'О применении контрольно-кассовой техники при осуществлении расчётов в Российской Федерации', '', '', true, 'http://pravo.gov.ru/', 'Применимость зависит от фактических расчётов и исключений', 'ККТ и кассовая дисциплина; продажи в MON CHEF не заменяют фискальные документы.'],
  ['LAW_RF_4979_1', 'LAW', 'CONDITIONAL', 'Закон РФ № 4979-1', 'О ветеринарии', '', '', true, 'https://fsvps.gov.ru/ru/fsvps/laws/197.html', 'Применяется к подконтрольным товарам', 'Ветеринарное сопровождение только для товаров и операций по точным позициям перечня; не назначать ВСД всем позициям.'],
  ['PRIKAZ_MSH_317', 'ORDER', 'REVIEW', 'Приказ Минсельхоза России № 317', 'Изменения к правилам оформления ветеринарных сопроводительных документов (наименование и редакцию сверить по официальной публикации)', '', '', true, 'http://publication.pravo.gov.ru/Document/View/0001202301250002', 'Правила ВСД; консолидированная редакция требует сверки', 'Входящие эВСД подпадающих партий; срок гашения — по действующей редакции.'],
  ['PRIKAZ_MSH_648', 'ORDER', 'REVIEW', 'Приказ Минсельхоза России № 648', 'Перечень подконтрольных товаров (наименование и редакцию сверить по официальной публикации)', '', '', true, 'http://publication.pravo.gov.ru/Document/View/0001201602200002', 'Перечень подконтрольных товаров; актуальная редакция требует сверки', 'Обязанность ВСД определять по точной позиции перечня, условиям и исключениям, а не по названию категории.'],
  ['PRIKAZ_MSH_646', 'ORDER', 'REVIEW', 'Приказ Минсельхоза России № 646', 'Перечень по полномочиям оформления ветеринарных документов (наименование и редакцию сверить по официальной публикации)', '', '', false, '', 'Отдельный перечень по полномочиям оформления; актуальная редакция требует сверки', 'Не смешивать с обязательностью ВСД (приказ № 648).'],
  ['PRIKAZ_MZ_229', 'ORDER', 'REVIEW', 'Приказ Минздрава России № 229', 'О профессиональной гигиенической подготовке и аттестации (наименование и редакцию сверить по официальной публикации)', '', '', false, '', 'Текущая редакция и периодичность требуют отдельной проверки', 'Гигиеническое обучение и аттестация для применимых категорий работников.'],
  ['PROFSTD_COOK_113N', 'ORDER', 'GUIDANCE', 'Профессиональный стандарт «Повар» (приказ № 113н)', 'Квалификационные требования (наименование и редакцию сверить по официальной публикации)', '', '', false, '', 'Идентифицирован; применимость зависит от кадровой задачи', 'Должностные требования и квалификационные ориентиры; не санитарный акт общественного питания.'],
  ['MU_LAB_1991', 'GUIDANCE', 'REVIEW', 'Методические указания по лабораторному контролю качества продукции общественного питания (1991)', 'Методические указания 23.10.1991 № 122-5/72, 11.11.1991 № 1-40/3805', '', '', false, '', 'Методические рекомендации 1991 г.; актуальная обязательность и применимость не подтверждены', 'Условно: лабораторный контроль рецептуры и качества; методы и область применения проверять по текущим ГОСТ и лаборатории.']
];
var MC_V90_STATUS_RU_ = { ACTIVE: 'действует', HISTORICAL: 'историческая редакция', GUIDANCE: 'добровольный / справочный', CONDITIONAL: 'обязателен, если применимо', REVIEW: 'статус не подтверждён — не применять' };
var MC_V90_CLASS_RU_ = { SANPIN: 'санитарные правила', TECH_REG: 'технический регламент ЕАЭС', LAW: 'федеральный закон', ORDER: 'приказ', GOST: 'стандарт', GUIDANCE: 'методический документ' };
var _V90_SYNCED = false;

/** Дописать в «Нормативы_V33» документы реестра предприятия, которых нет (по DocID и по номеру); существующие не трогаются. */
function _v90NormSync_() {
  if (_V90_SYNCED) return { added: 0 };
  _V90_SYNCED = true;
  var ss = _book_(), sh = ss.getSheetByName('Нормативы_V33'); if (!sh) return { added: 0 };
  var v = sh.getDataRange().getValues(), ids = {}, nums = {}, add = [];
  for (var i = 1; i < v.length; i++) { ids[String(v[i][0])] = 1; nums[String(v[i][3]).replace(/\s+/g, '').toLowerCase()] = 1; }
  (typeof MC_V70_CATALOG_ !== 'undefined' ? MC_V70_CATALOG_ : []).forEach(function (c) { nums[String(c.number).replace(/\s+/g, '').toLowerCase()] = nums[String(c.number).replace(/\s+/g, '').toLowerCase()] || 0; });
  MC_V90_NORMS_.forEach(function (r) {
    if (ids[r[0]] || nums[String(r[3]).replace(/\s+/g, '').toLowerCase()] === 1) return;
    add.push([r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], 'По ' + MC_V90_SRC_ + ': ' + r[9] + '. Применимость: ' + r[10] + ' Реквизиты и редакцию сверить по официальной публикации.']);
  });
  if (!add.length) return { added: 0 };
  sh.getRange(sh.getLastRow() + 1, 1, add.length, add[0].length).setValues(add);
  try { var ch = _v33Sheet_(MC_V33.CHANGE, ['ChangeID', 'DocID', 'DetectedAt', 'OldStatus', 'NewStatus', 'Summary', 'SourceURL', 'AppliedAt', 'AppliedBy']), now = new Date();
    ch.getRange(ch.getLastRow() + 1, 1, add.length, 9).setValues(add.map(function (r) { return ['V90-' + r[0], r[0], now, '', r[2], 'Добавлен в реестр по ' + MC_V90_SRC_, r[8], now, 'Система (V90)']; })); } catch (e) {}
  return { added: add.length };
}
(function () {
  try {
    var orig = _v33SeedNorms_;
    _v33SeedNorms_ = function () { var r = orig.apply(this, arguments); try { _v90NormSync_(); } catch (e) {} return r; };
  } catch (e) {}
  // распознавание файлов папки нормативов (V70): только документы с однозначным номером в имени файла
  try {
    [['SP_2_1_3678_20', '3678[^0-9]?20'], ['SANPIN_2_3_6_1079_01', '1079[^0-9]?01'], ['TRTS_029_2012', '029[^0-9]?2012'], ['TRTS_033_2013', '033[^0-9]?2013'], ['TREAES_040_2016', '040[^0-9]?2016'],
      ['TREAES_044_2017', '044[^0-9]?2017'], ['TRTS_015_2011', '015[^0-9]?2011'], ['TRTS_023_2011', '023[^0-9]?2011'], ['TRTS_024_2011', '024[^0-9]?2011'], ['TRTS_027_2012', '027[^0-9]?2012'], ['TREAES_047_2018', '047[^0-9]?2018']].forEach(function (p) {
      if (MC_V70_CATALOG_.some(function (c) { return c.id === p[0]; })) return;
      var r = MC_V90_NORMS_.filter(function (x) { return x[0] === p[0]; })[0]; if (!r) return;
      MC_V70_CATALOG_.push({ id: r[0], number: r[3], title: r[4], cls: r[1], status: r[2], mandatory: r[7], from: r[5], to: r[6], re: '(?:^|[^0-9])' + p[1] + '(?:[^0-9]|$)', sha: [], note: 'По ' + MC_V90_SRC_ + ': ' + r[9] });
    });
  } catch (e) {}
})();
/** Реестр документов для экрана «Нормативы»: статус, применимость, источник. */
function _v90Registry_() {
  try { if (typeof _v33SeedNorms_ === 'function') _v33SeedNorms_(); } catch (e) {}
  var sh = _book_().getSheetByName('Нормативы_V33'); if (!sh || sh.getLastRow() < 2) return [];
  var order = { ACTIVE: 0, CONDITIONAL: 1, GUIDANCE: 2, REVIEW: 3, HISTORICAL: 4 };
  return sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues().filter(function (r) { return r[0]; }).map(function (r) {
    return { id: String(r[0]), cls: String(r[1]), clsRu: MC_V90_CLASS_RU_[String(r[1])] || String(r[1]), status: String(r[2]), statusRu: MC_V90_STATUS_RU_[String(r[2])] || String(r[2]), number: String(r[3]), title: String(r[4]),
      from: r[5] instanceof Date ? Utilities.formatDate(r[5], _mcTz_(), 'dd.MM.yyyy') : String(r[5] || '').split('-').reverse().join('.'), to: r[6] instanceof Date ? Utilities.formatDate(r[6], _mcTz_(), 'dd.MM.yyyy') : String(r[6] || '').split('-').reverse().join('.'),
      mandatory: r[7] === true || String(r[7]).toUpperCase() === 'TRUE', url: String(r[8] || ''), note: String(r[9] || '') };
  }).sort(function (a, b) { return (order[a.status] === undefined ? 9 : order[a.status]) - (order[b.status] === undefined ? 9 : order[b.status]) || a.number.localeCompare(b.number, 'ru'); });
}
(function (g) {
  var orig = g.v70GetBase; if (typeof orig !== 'function') return;
  g.v70GetBase = function (token) { var r = orig.call(this, token); try { var o = typeof r === 'string' ? JSON.parse(r) : r; if (o && (o.success || o.ok) && o.data) { o.data.registry = _v90Registry_(); return typeof r === 'string' ? JSON.stringify(o) : o; } } catch (e) {} return r; };
})(this);

/* ГОСТ — добровольный стандарт: в источнике нормы это видно (например, 75 °C при реализации — ГОСТ 30390-2013 п. 8.4, не СанПиН; п. 50 СанПиН 4282-26 — «по технологическим документам») */
(function (g) {
  var src = g._v70Source_; if (typeof src !== 'function') return;
  g._v70Source_ = function (n) { var t = src.apply(this, arguments);
    try { if (n && n.Origin !== 'TABLE') { var c = MC_V70_CATALOG_.filter(function (x) { return x.id === n.DocID; })[0]; if (c && c.cls === 'GOST' && c.status === 'GUIDANCE' && !/добровольн/.test(t)) t += ' — добровольный стандарт (применяется по решению предприятия или договору)'; } } catch (e) {}
    return t; };
})(this);

/* ---------------- суточные пробы: профиль предприятия по СанПиН 2.3/2.4.4282-26 ---------------- */
var MC_V90_DS_PROP_ = 'MC_DS_PROFILE';
var MC_V90_DS_PROFILES_ = {
  MEDICAL: { ru: 'медицинская организация (пищеблок)', ref: 'СанПиН 2.3/2.4.4282-26, п. 56 подп. 4', min: 100, hours: 48, tMin: 2, tMax: 6, start: 'END_OF_SALE', required: true },
  SOCIAL: { ru: 'организация стационарного социального обслуживания', ref: 'СанПиН 2.3/2.4.4282-26, п. 56 подп. 12 (отбор — по подп. 4)', min: 100, hours: 48, tMin: 2, tMax: 6, start: 'END_OF_SALE', required: true },
  CHILDREN: { ru: 'организованный детский коллектив', ref: 'СанПиН 2.3/2.4.4282-26, п. 59 подп. 10', min: 100, hours: 48, tMin: 2, tMax: 6, start: 'TAKEN', required: true },
  CAMP: { ru: 'детский лагерь палаточного типа', ref: 'СанПиН 2.3/2.4.4282-26, п. 65 подп. 3 (от всех блюд и кулинарных изделий)', min: 0, hours: 48, tMin: 2, tMax: 6, start: 'TAKEN', required: true },
  PPK: { ru: 'по программе производственного контроля предприятия', ref: 'ППК предприятия', start: 'TAKEN', required: true },
  NONE: { ru: 'не применяется', ref: '', required: false }
};
function _v90DsProfile_() {
  var code = ''; try { code = String(PropertiesService.getScriptProperties().getProperty(MC_V90_DS_PROP_) || ''); } catch (e) {}
  var p = MC_V90_DS_PROFILES_[code], why = ''; try { why = String(PropertiesService.getScriptProperties().getProperty(MC_V90_DS_PROP_ + '_REASON') || ''); } catch (e) {}
  if (!p) return { code: '', ru: 'профиль не задан', required: true, ref: '', start: 'TAKEN', reason: '',
    text: 'Профиль предприятия не задан — проба требуется, как раньше. В СанПиН 2.3/2.4.4282-26 суточная проба предусмотрена для медицинских организаций и организаций социального обслуживания (п. 56 подп. 4, 12), организованных детских коллективов (п. 59 подп. 10) и детских лагерей палаточного типа (п. 65 подп. 3). Укажите профиль или закрепите пробы в ППК.' };
  return { code: code, ru: p.ru, required: p.required, ref: p.ref, start: p.start || 'TAKEN', reason: why,
    text: !p.required ? 'Суточные пробы не применяются (' + (why || 'причина не указана') + '). Выдача партий без пробы не блокируется; пробу можно отобрать по желанию.'
      : code === 'PPK' ? 'Суточные пробы — по ППК предприятия (' + (why || 'основание не указано') + '): масса, срок и температура — из настроек проб предприятия.'
      : 'Основание: ' + p.ref + ' — не менее ' + (p.min ? p.min + ' г (порционные — целиком)' : 'всех блюд и кулинарных изделий') + ', хранение не менее ' + p.hours + ' ч' + (p.start === 'END_OF_SALE' ? ' с момента окончания срока реализации блюд' : '') + ' при +' + p.tMin + '…+' + p.tMax + ' °C.' };
}
function _v90DsRequired_() { return _v90DsProfile_().required; }
(function (g) {
  // выдача партии: без пробы блокируется, только если проба требуется по профилю
  var rel = g._bcReleaseState_;
  if (typeof rel === 'function') g._bcReleaseState_ = function (batchId) {
    var r = rel.apply(this, arguments); if (r && r.reasons && !_v90DsRequired_()) { r.reasons = r.reasons.filter(function (x) { return x !== 'нет суточной пробы'; }); r.ok = !r.reasons.length; } return r; };
  var miss = g._dsMissing_;
  if (typeof miss === 'function') g._dsMissing_ = function () { return _v90DsRequired_() ? miss.apply(this, arguments) : []; };
  // параметры по профилю (масса, срок, температура); «по ППК» и «не задан» — настройки предприятия
  var cfg = g._dsCfg_;
  if (typeof cfg === 'function') g._dsCfg_ = function () {
    var c = cfg.apply(this, arguments), p = MC_V90_DS_PROFILES_[_v90DsProfile_().code];
    // норма — нижняя граница: «не менее 100 г», «не менее 48 ч»; температура — не шире +2…+6 °C; более строгие настройки предприятия сохраняются
    if (p && p.required && p.hours) { if (p.min) c.minWeightG = Math.max(Number(c.minWeightG) || 0, p.min); c.retentionHours = Math.max(Number(c.retentionHours) || 0, p.hours);
      c.tMin = Math.max(Number(c.tMin), p.tMin); c.tMax = Math.min(Number(c.tMax), p.tMax); if (!(c.tMin <= c.tMax)) { c.tMin = p.tMin; c.tMax = p.tMax; } }
    return c;
  };
  // медицинские и социальные: 48 ч — с момента окончания срока реализации блюд (срок годности партии)
  var take = g.mcTakeDailySample;
  if (typeof take === 'function') g.mcTakeDailySample = function (json, token) {
    var r = take.call(this, json, token), o = typeof r === 'string' ? JSON.parse(r) : r;
    try {
      var P = _v90DsProfile_();
      if (o && (o.success || o.ok) && o.data && P.start === 'END_OF_SALE') {
        var b = _bcFind_(o.data.batchId), exp = b ? b.v[5] : null, end = exp instanceof Date ? new Date(exp.getTime()) : exp ? _parseDate_(exp) : null;
        if (!(end instanceof Date) || isNaN(end.getTime())) end = null;
        if (end && end.getHours() === 0 && end.getMinutes() === 0) end = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59);
        var sh = _dsSheet_(), v = sh.getDataRange().getValues();
        for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(o.data.sampleId)) {
          var taken = v[i][11] instanceof Date ? v[i][11] : new Date(), until0 = v[i][12] instanceof Date ? v[i][12] : new Date(), base = end && end > taken ? end : taken, until = new Date(base.getTime() + _dsCfg_().retentionHours * 3600000);
          if (until > until0) { sh.getRange(i + 1, 13).setValue(until); o.data.keepUntil = _bcDate_(until); o.data.basis = P.ref + ': ' + _dsCfg_().retentionHours + ' ч с момента окончания срока реализации (' + (end ? _bcDate_(end) : 'срок партии не указан — от отбора') + ')'; }
          break;
        }
      }
      if (o && (o.success || o.ok) && o.data && !o.data.basis) o.data.basis = P.ref || P.ru;
    } catch (e) {}
    return typeof r === 'string' ? JSON.stringify(o) : o;
  };
  var list = g.mcGetDailySamples;
  if (typeof list === 'function') g.mcGetDailySamples = function (token) {
    var r = list.call(this, token), o = typeof r === 'string' ? JSON.parse(r) : r;
    try { if (o && (o.success || o.ok) && o.data) { var s = _requireAuth_(token); o.data.profile = _v90DsProfile_(); o.data.profiles = Object.keys(MC_V90_DS_PROFILES_).map(function (k) { return { code: k, ru: MC_V90_DS_PROFILES_[k].ru, ref: MC_V90_DS_PROFILES_[k].ref }; });
      o.data.canSetProfile = !s.dev && _mcRbHasExact_(s, 'haccp|haccp_approve'); } } catch (e) {}
    return typeof r === 'string' ? JSON.stringify(o) : o;
  };
})(this);
/** Профиль предприятия для суточных проб: ответственный за ХАССП или директор; «не применяется» и «по ППК» — с причиной. */
function v90SetSampleProfile(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp|haccp_approve', 'V90_SAMPLE_PROFILE', 'Суточные пробы', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), code = String(d.profile || '').toUpperCase(), why = String(d.reason || '').trim();
    if (!MC_V90_DS_PROFILES_[code]) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите профиль', op.id); }
    if ((code === 'NONE' || code === 'PPK') && why.length < 10) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', code === 'NONE' ? 'Укажите, почему суточные пробы не применяются (вид деятельности, решение по ППК)' : 'Укажите основание в ППК (раздел, пункт, дата утверждения)', op.id); }
    if (d.confirm !== true) { _endOp_(op, 'FAILED'); return _fail_('CONFIRM_REQUIRED', 'Подтвердите профиль: от него зависит запрет выдачи партии без пробы', op.id); }
    var P = PropertiesService.getScriptProperties(), was = _v90DsProfile_();
    P.setProperty(MC_V90_DS_PROP_, code); P.setProperty(MC_V90_DS_PROP_ + '_REASON', why);
    var now = _v90DsProfile_();
    _audit_(op, 'V90_SAMPLE_PROFILE', 'Суточные пробы', code, { profile: was.code, reason: was.reason }, { profile: code, reason: why, required: now.required, ref: now.ref });
    _endOp_(op); return _ok_(now, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- лаборатория: старый путь записи закрыт ---------------- */
var MC_V90_LAB_MSG_ = 'Этот экран устарел: результат исследования вносится в «Лаборатория: план, отбор, протоколы, решения» — проба от партии, протокол файлом (PDF, JPEG, PNG) с SHA-256, сравнение показателей с нормой, решение — сотрудник с правом «Лаборатория — подтверждение».';
(function (g) {
  ['createLabPlan', 'createLabTest', 'recordLabResult'].forEach(function (fn) {
    if (typeof g[fn] !== 'function') return;
    g[fn] = function (json, token) { try { _requireAuth_(token); } catch (e) { return _failFrom_(e); } return _fail_('USE_V67', MC_V90_LAB_MSG_); };
  });
})(this);
