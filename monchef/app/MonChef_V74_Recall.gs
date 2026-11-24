/**
 * MON CHEF V74 — отзыв (изъятие из обращения) продукции: процедура ХАССП.
 *
 * Основания (текст сверен по локальной копии ТР ТС 021/2011 ред. 22.04.2024 и СанПиН 2.3/2.4.4282-26 — см. MC_V74_LAW_):
 *   ТР ТС 021/2011 ст. 5 ч. 4 — несоответствующая продукция подлежит изъятию из обращения владельцем самостоятельно
 *   либо по предписанию; ст. 18 ч. 3 — до утилизации хранится без несанкционированного доступа и учитывается;
 *   ст. 18 ч. 4, 7, 8 — утилизация по предписанию, обеззараживание, документ об утилизации; ст. 10 ч. 3 п. 12 и ст. 4 —
 *   прослеживаемость (кроме конечного потребителя). 29-ФЗ (копия КонсультантПлюс, ред. 13.07.2020): ст. 3 п. 2–4 — когда
 *   обращение запрещено, «опасная» и «некачественная» продукция; ст. 24 — изъятие владельцем; ст. 25 — экспертиза в случаях,
 *   определённых Правительством, временное хранение без доступа и строгий учёт, утилизация (в т. ч. подрядчиком),
 *   обеззараживание, документ об утилизации. ГОСТ Р ИСО 22000-2019 (добровольного применения) п. 8.3, 8.9.4, 8.9.5, 9.3.2 e:
 *   назначенные ответственные, документированный порядок, ответы заинтересованных сторон, основания выпуска и способы
 *   ликвидации, сведения руководству, верификация симуляцией изъятия. Сроки и форма уведомлений в проверенных текстах
 *   не установлены — их задаёт предприятие (настройки «Порядок отзыва»); система их не придумывает.
 *
 * Как работает:
 *   1. Охват: перечень партий или «продукт + поставщик / изготовитель / партия изготовителя / даты приёмки».
 *      Продукт без уточнения не принимается — иначе отзыв захватил бы все партии продукта.
 *   2. Прослеживание вперёд только по связям движения продукции (TRACE_LINKS): партия → производство → выпущенная
 *      партия, обработка и разделение, продажа, выдача на банкет, акт списания, отходы, возврат, пробы. Связи «накладная»,
 *      «место», «ВСД» в охват не ведут (иначе отзыв одной партии захватил бы всю накладную).
 *   3. Блокировка сразу при открытии: каждая затронутая партия с остатком блокируется отдельной записью «Блокировки»
 *      с RuleID «RECALL:<id>», прежний статус запоминается. Такую блокировку не снимает ни лабораторное «допустить»,
 *      ни бракераж, ни общее «снять блокировку» — только решение по отзыву.
 *   4. Решение по каждой заблокированной партии: возврат поставщику (документ), уничтожение по акту списания (способ),
 *      снятие с отзыва (документальное основание; прежний статус восстанавливается).
 *   5. Уведомления: поставщик, орган контроля (если основание — предписание), заказчики банкетов — обязательны к отметке
 *      (уведомлён или «не требуется» с причиной). Продажи в зале — конечный потребитель, отметка по решению.
 *   6. Закрытие: всё решено и отмечено, причина, меры, заключение → PDF «Отчёт об отзыве продукции».
 *   Учебный отзыв — то же прослеживание и баланс без блокировок, без изменения склада и без внешних уведомлений.
 * Сотрудник, роль, время и номера определяет сервер; количество берётся из учёта, ничего не подставляется.
 */
var MC_V74_ = { R: 'Отзывы_V74', B: 'Отзывы_Партии_V74', D: 'Отзывы_Получатели_V74', L: 'Отзывы_Журнал_V74', S: 'Отзывы_Настройки_V74' };
var MC_V74_HEAD_ = {
  R: ['RecallID', 'Номер', 'Учебный', 'Статус', 'Основание (код)', 'Основание', 'Документ основания', 'Опасность (код)', 'Опасность', 'Описание',
    'Охват (JSON)', 'Охват', 'Место изоляции', 'Открыт', 'Открыл', 'Должность', 'ID открывшего', 'Закрыт', 'Закрыл', 'Причина несоответствия',
    'Принятые меры', 'Заключение', 'PDF', 'PDF SHA-256', 'Отменён', 'Причина отмены', 'OperationID',
    'Правовая категория', 'Длительность, мин', 'Рассмотрено руководством', 'Рассмотрел', 'Решения руководства'],
  B: ['RowID', 'RecallID', 'BatchID', 'Продукт', 'Роль', 'Путь', 'Ед.', 'Получено', 'Остаток при открытии', 'Статус до', 'BlockID', 'Решение',
    'Кол-во по решению', 'Документ', 'Основание / способ', 'Акт списания', 'Решил', 'Решено', 'Поставщик', 'Партия изготовителя', 'Годен до', 'OperationID',
    'Основание выпуска', 'Ликвидация', 'Экспертиза', 'Обеззараживание'],
  D: ['RowID', 'RecallID', 'Тип', 'ObjectID', 'Получатель', 'Контакт', 'Дата', 'Через партию', 'Продукт', 'Кол-во', 'Ед.', 'Что', 'Нужно уведомить',
    'Уведомлён', 'Способ', 'Содержание / документ', 'Уведомил', 'Когда', 'Не требуется — причина', 'OperationID', 'Ответ получателя', 'Ответ записан'],
  L: ['EventID', 'RecallID', 'Время', 'Действие', 'Подробно', 'Сотрудник', 'Должность', 'OperationID'],
  S: ['Ключ', 'Значение', 'Изменил', 'Изменено']
};
var MC_V74_BASIS_ = [
  ['SUPPLIER_NOTICE', 'Уведомление поставщика или изготовителя', true],
  ['AUTHORITY_ORDER', 'Предписание органа государственного контроля (надзора)', true],
  ['LAB_RESULT', 'Протокол лабораторных исследований', true],
  ['COMPLAINT', 'Жалоба потребителя', false],
  ['INTERNAL', 'Несоответствие выявлено на предприятии', false]
];
// [код, несоответствие, основание запрета обращения, правовая категория] — 29-ФЗ ст. 3 п. 2; категория — ст. 3 п. 3 (абз. 2–3: опасная)
// и п. 4 (абз. 4–7: некачественная). Порядок экспертизы, утилизации и уничтожения устанавливает Правительство РФ (в комплекте нет).
var MC_V74_HAZ_ = [
  ['BIO', 'Микробиологические показатели не соответствуют (микроорганизмы, паразиты)', '29-ФЗ ст. 3 п. 2 абз. 3', 'опасная'],
  ['CHEM', 'Химические загрязнители, нормируемые вещества сверх установленных значений', '29-ФЗ ст. 3 п. 2 абз. 3', 'опасная'],
  ['PHYS', 'Посторонние предметы, частицы (загрязнители)', '29-ФЗ ст. 3 п. 2 абз. 3', 'опасная'],
  ['ALLERGEN', 'Состав не соответствует информации: незаявленный аллерген', '29-ФЗ ст. 3 п. 2 абз. 3', 'опасная'],
  ['EXPIRED', 'Нет установленного срока годности или срок годности истёк', '29-ФЗ ст. 3 п. 2 абз. 3', 'опасная'],
  ['ORGANOLEPTIC', 'Опасная или некачественная по органолептическим показателям', '29-ФЗ ст. 3 п. 2 абз. 2', 'опасная'],
  ['FALSIFIED', 'Установлен факт фальсификации', '29-ФЗ ст. 3 п. 2 абз. 4', 'некачественная'],
  ['TRACE', 'Прослеживаемость не может быть подтверждена', '29-ФЗ ст. 3 п. 2 абз. 5', 'некачественная'],
  ['LABEL', 'Нет маркировки или в ней нет обязательных сведений', '29-ФЗ ст. 3 п. 2 абз. 6', 'некачественная'],
  ['DOCS', 'Нет товаросопроводительных документов', '29-ФЗ ст. 3 п. 2 абз. 7', 'некачественная'],
  ['CONFORMITY', 'Не подтверждено соответствие (нет декларации или сертификата)', '29-ФЗ ст. 3 п. 1', ''],
  ['OTHER', 'Иное (с пояснением)', '', '']
];
var MC_V74_DISINFECT_ = { BIO: 1, CHEM: 1, PHYS: 1 };   // ТР ТС 021/2011 ст. 18 ч. 7 (инфицированная); 29-ФЗ ст. 25 п. 3.1 (загрязнители)
// основания выпуска (снятия с отзыва) — ГОСТ Р ИСО 22000-2019 п. 8.9.4.2 и 8.9.4.3 a
var MC_V74_RELEASE_ = [
  ['NOT_AFFECTED', 'Партия не входит в отзываемую (документ поставщика, изготовителя или органа)'],
  ['TEST_OK', 'Выборочный контроль или анализ подтверждает соответствие (8.9.4.2 c)'],
  ['EVIDENCE', 'Иное свидетельство результативности мер управления (8.9.4.2 a, b)'],
  ['REWORKED', 'Переработана или обработана до приемлемого уровня опасности (8.9.4.3 a)']
];
// ликвидация — п. 8.9.4.3 b, c
var MC_V74_DISPOSAL_ = [
  ['DESTROY', 'Уничтожение или удаление как отходов (8.9.4.3 c)'],
  ['OTHER_USE', 'Использование по другому назначению (8.9.4.3 b); на корм животным — по решению органов ветеринарного надзора (ТР ТС 021/2011 ст. 18 ч. 2)']
];
var MC_V74_DEC_ = { RETURN: 'Возврат поставщику', DESTROY: 'Уничтожение (утилизация) по акту', RELEASE: 'Снята с отзыва — партия не затронута',
  NO_STOCK: 'Остатка нет — решение не требуется', CANCELLED: 'Отзыв отменён — блокировка снята' };
var MC_V74_LAW_ = [
  ['ТР ТС 021/2011, ст. 5 ч. 4', 'Пищевая продукция, не соответствующая требованиям технических регламентов, в том числе с истёкшим сроком годности, подлежит изъятию из обращения участником хозяйственной деятельности (владельцем) самостоятельно либо по предписанию уполномоченных органов государственного контроля (надзора).'],
  ['ТР ТС 021/2011, ст. 18 ч. 3', 'Такая продукция до утилизации направляется на хранение в условиях, исключающих несанкционированный доступ к ней, и подлежит учёту.'],
  ['ТР ТС 021/2011, ст. 18 ч. 4', 'При утилизации по предписанию органа контроля владелец выбирает способы и условия утилизации; если уничтожается продукция, опасная для людей и животных, — письменно уведомляет орган, вынесший предписание, о месте, времени, способах и условиях утилизации.'],
  ['ТР ТС 021/2011, ст. 18 ч. 7', 'Инфицированная пищевая продукция, опасная для людей и животных, перед уничтожением или в процессе уничтожения подвергается обеззараживанию.'],
  ['ТР ТС 021/2011, ст. 18 ч. 8', 'При утилизации по предписанию органа контроля в этот орган представляется документ, подтверждающий факт утилизации.'],
  ['ТР ТС 021/2011, ст. 10 ч. 3 п. 12; ст. 4', 'Прослеживаемость — возможность документарно установить изготовителя и последующих собственников продукции, кроме конечного потребителя, а также место происхождения продукции и сырья.'],
  ['СанПиН 2.3/2.4.4282-26, п. 4', 'Производственный контроль на предприятии общественного питания основан на принципах ХАССП.'],
  ['СанПиН 2.3/2.4.4282-26, п. 6', 'Пищевая продукция предприятия общественного питания, срок годности которой истёк, подлежит утилизации.'],
  ['29-ФЗ, ст. 3 пп. 2–4', 'Запрещено обращение продукции: опасной или некачественной по органолептике; не соответствующей информации (загрязнители, нет срока годности или он истёк, показатели); фальсифицированной; без подтверждённой прослеживаемости; без маркировки; без товаросопроводительных документов. Первые два основания — продукция признаётся опасной, остальные — некачественной; порядок экспертизы, утилизации, уничтожения устанавливает Правительство РФ.'],
  ['29-ФЗ, ст. 24 п. 1', 'Владелец некачественных и (или) опасных пищевых продуктов обязан изъять их из обращения самостоятельно или на основании предписания органов государственного надзора и контроля.'],
  ['29-ФЗ, ст. 25 пп. 1–5', 'Экспертиза — в случаях, определяемых Правительством РФ; временное хранение без доступа и строгий учёт обеспечивает владелец; утилизация или уничтожение — в том числе с привлечением специализированной организации; загрязнённая продукция обеззараживается; расходы несёт владелец; документ об утилизации — в орган, вынесший предписание.'],
  ['ГОСТ Р ИСО 22000-2019, п. 8.9.5', 'Своевременное изъятие/отзыв назначенными компетентными лицами; документированный порядок уведомления заинтересованных сторон, обращения с изъятой продукцией и последовательности действий; изоляция и контроль; сведения о причине, объёме и результате — высшему руководству; верификация результативности, например симуляцией изъятия. Стандарт добровольного применения.'],
  ['ГОСТ Р ИСО 22000-2019, п. 8.9.4', 'Потенциально опасная продукция — под контролем до оценки и распоряжения; ответные реакции заинтересованных сторон и разрешения сохраняются; выпуск — только по свидетельству (8.9.4.2); ликвидация — переработка, другое назначение или уничтожение, с указанием лиц, санкционировавших решение (8.9.4.3).'],
  ['ГОСТ Р ИСО 22000-2019, п. 8.3', 'Прослеживаемость партий сырья до первого этапа распределения конечного продукта; верификация, в том числе сверкой количества продукции с количеством ингредиентов.']
];
// связи движения продукции: куда ушла партия (остальные связи в охват не ведут)
var MC_V74_FLOW_ = { 'РАСХОДОВАНА_НА': 'PROD', 'ИЗРАСХОДОВАНА_В': 'PROD', 'ПРЕОБРАЗОВАНА_В': 'BATCH', 'SPLIT': 'BATCH', 'РЕАЛИЗОВАНА_В': 'SALE',
  'ВЫДАНА_НА_БАНКЕТ': 'BANQUET', 'СПИСАНА_ПО_АКТУ': 'WRITEOFF', 'WASTE': 'WASTE', 'ОТХОДЫ_ОБРАБОТКИ': 'WASTE', 'RETURN': 'RETURN',
  'BATCH_USE': 'USE', 'BATCH_PARTIAL_USE': 'USE', 'ОТОБРАНА_ПРОБА': 'SAMPLE', 'ОТОБРАНА_ЛАБ_ПРОБА': 'SAMPLE' };
var MC_V74_OUT_ = { 'ВЫПУЩЕНА_ПАРТИЯ': 1, 'ВЫПУСК': 1 };
var MC_V74_KIND_RU_ = { SALE: 'Продажа в зале', BANQUET: 'Банкет', WRITEOFF: 'Акт списания', WASTE: 'Списание / отходы', RETURN: 'Возврат поставщику',
  USE: 'Использовано без привязки к выпуску', SAMPLE: 'Проба', SUPPLIER: 'Поставщик', AUTHORITY: 'Орган контроля', OTHER: 'Иной получатель' };
var MC_V74_BLOCKABLE_ = { active: 1, quarantine: 1, recheck: 1, hold: 1, defrost: 1, blocked: 1, expired: 1 };

/* ---------------- листы ---------------- */
function _v74Sh_(k) {
  var H = MC_V74_HEAD_[k], sh = _bcSheet_(MC_V74_[k], H);
  if (String(sh.getRange(1, H.length).getValue() || '') !== H[H.length - 1]) sh.getRange(1, 1, 1, H.length).setValues([H]);   // лист прежней сборки — дописать колонки
  return sh;
}
function _v74Rows_(k, recallId) {
  var H = MC_V74_HEAD_[k], v = _v74Sh_(k).getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    if (recallId && k !== 'R' && String(v[i][1]) !== String(recallId)) continue;
    var o = { _row: i + 1 }; H.forEach(function (h, j) { o[h] = v[i][j]; }); out.push(o);
  }
  return out;
}
function _v74Append_(k, o) { _v74Sh_(k).appendRow(MC_V74_HEAD_[k].map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; })); }
function _v74Set_(k, row, fields) {
  var H = MC_V74_HEAD_[k], sh = _v74Sh_(k);
  Object.keys(fields).forEach(function (f) { var c = H.indexOf(f); if (c >= 0) sh.getRange(row, c + 1).setValue(fields[f]); });
}
function _v74Id_(p) { return p + '-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd') + '-' + Utilities.getUuid().slice(0, 8).toUpperCase(); }
function _v74Lo_(s) { return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”]/g, '').replace(/\s+/g, ' ').trim(); }
function _v74N_(x) { if (x === '' || x === null || x === undefined) return null; var n = parseFloat(String(x).replace(',', '.')); return isFinite(n) ? n : null; }
function _v74R3_(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
function _v74Fmt_(d) { if (!d) return ''; if (!(d instanceof Date)) { var p = _mcBlDate_(d); if (!p) return String(d); d = p; } return _mcRbFmt_(d); }
function _v74Day_(d) { if (!d) return ''; if (!(d instanceof Date)) { var p = _mcBlDate_(d); if (!p) return String(d); d = p; } return Utilities.formatDate(d, _mcTz_(), 'dd.MM.yyyy'); }
function _v74Conv_(qty, unit, toUnit) {
  var n = _v74N_(qty); if (n === null) return null;
  if (!unit || !toUnit || String(unit) === String(toUnit)) return n;
  try { if (!_unitsCompatible_(unit, toUnit)) return null; return _toBaseUnitServer_(n, unit).qty / (_toBaseUnitServer_(1, toUnit).qty || 1); } catch (e) { return null; }
}
function _v74Ref_(list, code) { for (var i = 0; i < list.length; i++) if (list[i][0] === code) return list[i]; return null; }
function _v74Log_(op, recallId, action, details) {
  var a = _author_(op);
  _v74Append_('L', { EventID: _v74Id_('RE'), RecallID: recallId, 'Время': new Date(), 'Действие': action, 'Подробно': details || '', 'Сотрудник': a.фио, 'Должность': a.должность || a.роль || '', OperationID: (op && op.id) || '' });
}

/* ---------------- порядок отзыва: настройки предприятия ---------------- */
var MC_V74_SET_KEYS_ = { responsible: 'Ответственные за отзыв', authority: 'Орган контроля и контакты', notifyOrder: 'Порядок и сроки уведомлений',
  drillMonths: 'Периодичность учебного отзыва, мес.', isolation: 'Место изоляции по умолчанию', retention: 'Срок хранения записей' };
function _v74Settings_() {
  var out = { responsible: [], authority: '', notifyOrder: '', drillMonths: null, isolation: '', retention: '', changedBy: '', changedAt: '' };
  _v74Rows_('S').forEach(function (r) {
    var k = String(r['Ключ']), v = r['Значение'];
    if (k === 'responsible') { try { out.responsible = JSON.parse(String(v || '[]')) || []; } catch (e) { out.responsible = []; } }
    else if (k === 'drillMonths') out.drillMonths = _v74N_(v);
    else if (k in out) out[k] = String(v || '');
    if (r['Изменено'] && (!out.changedAt || r['Изменено'] > out.changedAt)) { out.changedAt = r['Изменено']; out.changedBy = String(r['Изменил'] || ''); }
  });
  out.changedAt = _v74Fmt_(out.changedAt);
  return out;
}
/** Назначенные ответственные (ГОСТ Р ИСО 22000-2019 п. 8.9.5): если назначены — открывают, решают, закрывают и отменяют реальный отзыв
 *  только они или руководство (право «ХАССП — утверждение»). Не назначены — по правам роли, экран предупреждает. */
function _v74Responsible_(op) {
  var st = _v74Settings_(), list = st.responsible || [];
  if (!list.length) return '';
  var who = _author_(op), me = _v74Lo_(who.фио);
  if (list.some(function (x) { return _v74Lo_(x.name || x) === me; })) return '';
  if (op && op.session && typeof _mcRbHas_ === 'function' && _mcRbHas_(op.session, 'haccp_approve')) return '';
  return 'Отзыв ведут назначенные ответственные: ' + list.map(function (x) { return x.name || x; }).join(', ') + ' (ГОСТ Р ИСО 22000-2019 п. 8.9.5; назначает руководство в «Порядке отзыва»)';
}

/* ---------------- партии и паспорта ---------------- */
function _v74Batches_() {
  var v = _stockBatchesSheet_().getDataRange().getValues(), m = {};
  for (var i = 1; i < v.length; i++) if (v[i][0]) m[String(v[i][0])] = v[i];
  return m;
}
function _v74Passes_() {
  var m = {};
  try { var v = _mcRcvSheet_().getDataRange().getValues(); for (var i = 1; i < v.length; i++) if (v[i][0]) m[String(v[i][0])] = v[i]; } catch (e) {}
  return m;
}
function _v74Info_(id, B, P) {
  var r = B[id], p = P[id], C = MC_RCV_C_;
  if (!r) return { id: id, missing: true, product: '', unit: '', received: null, remain: 0, status: '' };
  var sup = p ? String(p[C['Поставщик']] || '') : '';
  if (!sup && /Поставщик|ООО|ИП /.test(String(r[7] || ''))) sup = String(r[7] || '');
  return { id: id, product: String(r[1] || ''), unit: String(r[2] || ''), received: _v74N_(r[3]), used: _v74N_(r[8]) || 0, remain: _v74N_(r[9]) || 0,
    status: String(r[10] || 'active'), expiry: r[5], receivedAt: r[4], pid: String(r[17] || ''), supplierId: String(r[18] || (p ? p[C['SupplierID']] : '') || ''),
    supplier: sup, lot: p ? String(p[C['Партия изготовителя']] || '') : '', maker: p ? String(p[C['Изготовитель']] || '') : '', invoice: p ? String(p[C['Накладная']] || '') : '', pass: !!p };
}

/* ---------------- охват ---------------- */
function _v74Scope_(sc) {
  sc = sc || {};
  var B = _v74Batches_(), P = _v74Passes_(), ids = [];
  var list = Array.isArray(sc.batchIds) ? sc.batchIds : String(sc.batchIds || '').split(/[\s,;]+/);
  list = list.map(function (x) { return String(x || '').trim(); }).filter(function (x) { return x; });
  if (list.length) {
    var miss = list.filter(function (x) { return !B[x]; });
    if (miss.length) throw new Error('VALIDATION: партии не найдены: ' + miss.join(', '));
    list.forEach(function (x) { if (ids.indexOf(x) < 0) ids.push(x); });
    return { ids: ids, text: 'партии: ' + ids.join(', '), json: { batchIds: ids } };
  }
  var prod = String(sc.product || '').trim(), sup = String(sc.supplier || '').trim(), lot = String(sc.lot || '').trim(), man = String(sc.manufacturer || '').trim();
  var from = sc.from ? _mcBlDate_(sc.from) : null, to = sc.to ? _mcBlDate_(sc.to) : null;
  if (!prod) throw new Error('VALIDATION: Укажите продукт или перечислите партии');
  if (!sup && !lot && !man && !from && !to) throw new Error('VALIDATION: Уточните охват: поставщик, изготовитель, партия изготовителя или даты приёмки — либо перечислите партии. Продукт без уточнения захватил бы все его партии.');
  if (from) from = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (to) to = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59);
  var key = _prodKey_(prod);
  Object.keys(B).forEach(function (id) {
    var i = _v74Info_(id, B, P);
    if (_prodKey_(i.product) !== key && i.pid !== prod) return;
    if (sup && _v74Lo_(i.supplier).indexOf(_v74Lo_(sup)) < 0 && i.supplierId !== sup) return;
    if (man && _v74Lo_(i.maker).indexOf(_v74Lo_(man)) < 0) return;
    if (lot && _v74Lo_(i.lot) !== _v74Lo_(lot)) return;
    if (from || to) {
      var at = _mcBlDate_(i.receivedAt);
      if (!at || (from && at < from) || (to && at > to)) return;
    }
    ids.push(id);
  });
  var t = ['продукт «' + prod + '»'];
  if (sup) t.push('поставщик «' + sup + '»'); if (man) t.push('изготовитель «' + man + '»'); if (lot) t.push('партия изготовителя «' + lot + '»');
  if (from || to) t.push('приняты ' + (from ? 'с ' + _v74Day_(from) : '') + (to ? ' по ' + _v74Day_(to) : ''));
  return { ids: ids, text: t.join(', '), json: { product: prod, supplier: sup, manufacturer: man, lot: lot, from: sc.from || '', to: sc.to || '' } };
}

/* ---------------- прослеживание вперёд ---------------- */
function _v74Links_() {
  try { if (typeof _mcSyncBatchRelationsToTrace_ === 'function') _mcSyncBatchRelationsToTrace_(); } catch (e) {}
  var v = _mcTraceSheet_().getDataRange().getValues(), from = {};
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0] || String(r[12]) === 'REVOKED') continue;
    var k = String(r[1]) + '|' + String(r[2]);
    (from[k] = from[k] || []).push({ rel: String(r[3]), toType: String(r[4]), toId: String(r[5]), at: r[7], actor: String(r[8] || ''), w: r[10], unit: String(r[11] || '') });
  }
  return from;
}
function _v74Trace_(srcIds) {
  var from = _v74Links_(), batches = [], seen = {}, outs = [];
  var q = srcIds.map(function (id) { seen[String(id)] = true; return { id: String(id), role: 'SOURCE', path: String(id), depth: 0, via: '' }; });
  while (q.length) {
    var cur = q.shift(); batches.push(cur);
    (from['BATCH|' + cur.id] || []).forEach(function (e) {
      var kind = MC_V74_FLOW_[e.rel]; if (!kind) return;
      outs.push({ kind: kind, rel: e.rel, batchId: cur.id, toType: e.toType, toId: e.toId, at: e.at, qty: e.w, unit: e.unit });
      if (cur.depth >= 10) return;
      if (kind === 'PROD') {
        (from['PRODUCTION|' + e.toId] || []).forEach(function (p) {
          if (!MC_V74_OUT_[p.rel] || p.toType !== 'BATCH' || seen[p.toId]) return;
          seen[p.toId] = true;
          q.push({ id: p.toId, role: 'DERIVED', path: cur.path + ' → ' + e.toId + ' → ' + p.toId, depth: cur.depth + 1, via: cur.id });
        });
      } else if (kind === 'BATCH' && e.toType === 'BATCH' && !seen[e.toId]) {
        seen[e.toId] = true;
        q.push({ id: e.toId, role: 'DERIVED', path: cur.path + ' → ' + (e.rel === 'SPLIT' ? 'разделение' : 'обработка') + ' → ' + e.toId, depth: cur.depth + 1, via: cur.id });
      }
    });
  }
  return { batches: batches, outs: outs, from: from };
}
/** Получатели и выбытие по связям: одна строка на (тип, объект, партия). */
function _v74Recipients_(outs, from, B, P) {
  var rows = {}, acts = {}, dishName = {};
  try { var av = _woSheet_().getDataRange().getValues(); for (var i = 1; i < av.length; i++) if (av[i][0]) acts[String(av[i][0])] = { code: String(av[i][2] || ''), name: String(av[i][3] || '') }; } catch (e) {}
  try { var idx = _buildDishIndexes_(); Object.keys(idx.dishByCode || {}).forEach(function (c) { dishName[c] = idx.dishByCode[c].name; }); } catch (e) {}
  outs.forEach(function (o) {
    if (o.kind === 'PROD' || o.kind === 'BATCH') return;
    var k = o.kind + '|' + o.toId + '|' + o.batchId, info = _v74Info_(o.batchId, B, P), r = rows[k];
    var q = _v74Conv_(o.qty, o.unit || info.unit, info.unit);
    if (r) { if (q !== null) r.qty = _v74R3_((r.qty || 0) + q); return; }
    r = rows[k] = { type: o.kind, objectId: o.toId, batchId: o.batchId, product: info.product, qty: q === null ? null : _v74R3_(q), unit: info.unit, at: o.at, atText: _v74Day_(o.at), to: '', contact: '', what: info.product, need: false };
    if (o.kind === 'SALE') {
      var d = (from['SALE|' + o.toId] || []).filter(function (x) { return x.rel === 'ПО_БЛЮДУ' || x.rel === 'ПО_ТОВАРУ'; })[0];
      r.to = 'Конечный потребитель (продажа в зале)'; r.what = d ? (dishName[d.toId] || d.toId) : 'продажа ' + o.toId;
    } else if (o.kind === 'BANQUET') {
      var ev = null; try { ev = _getEventById_(o.toId); } catch (e) {}
      r.to = 'Банкет ' + (ev && ev.date ? ev.date + ' ' : '') + (ev && ev.format ? '«' + ev.format + '»' : o.toId) + (ev && ev.name ? ' — заказчик ' + ev.name : ' — заказчик не указан в карточке банкета');
      r.contact = ev && ev.contact ? String(ev.contact) : ''; r.need = true; r.at = o.at || (ev && ev.date) || ''; r.atText = _v74Day_(r.at);
    } else if (o.kind === 'WRITEOFF') {
      var a = acts[o.toId] || {}; r.to = a.code === 'STAFF' ? 'Сотрудники (акт ' + o.toId + ', питание персонала)' : 'Списано по акту ' + o.toId + (a.name ? ' (' + a.name + ')' : '');
    } else if (o.kind === 'WASTE') r.to = o.rel === 'ОТХОДЫ_ОБРАБОТКИ' ? 'Отходы обработки' : 'Списано (порча, брак)';
    else if (o.kind === 'RETURN') r.to = 'Возвращено поставщику';
    else if (o.kind === 'USE') r.to = 'Использовано без привязки к выпуску (куда ушло — не прослежено)';
    else if (o.kind === 'SAMPLE') r.to = o.toType === 'LAB_SAMPLE' ? 'Лабораторная проба ' + o.toId : 'Суточная проба ' + o.toId;
  });
  return Object.keys(rows).map(function (k) { return rows[k]; });
}
/** Баланс партии: получено = остаток + прослеженное выбытие (в единице партии). */
function _v74Balance_(ids, from, B, P) {
  return ids.map(function (id) {
    var i = _v74Info_(id, B, P), traced = 0, unknown = 0;
    (from['BATCH|' + id] || []).forEach(function (e) {
      if (!MC_V74_FLOW_[e.rel] || MC_V74_FLOW_[e.rel] === 'SAMPLE') return;   // проба остаток партии не уменьшает
      var q = _v74Conv_(e.w, e.unit || i.unit, i.unit);
      if (q === null) unknown++; else traced += q;
    });
    var acc = _v74R3_(i.remain + traced), got = i.received || 0;
    return { batchId: id, product: i.product, unit: i.unit, received: got, remain: _v74R3_(i.remain), traced: _v74R3_(traced), accounted: acc, unknownLinks: unknown,
      gap: got > 0 ? _v74R3_(Math.max(0, got - acc)) : 0, over: got > 0 && acc > got * 1.001, pct: got > 0 ? Math.min(100, Math.round(acc / got * 1000) / 10) : null };
  });
}
/** Предпросмотр: охват + прослеживание без изменений. */
function _v74Plan_(scope) {
  var sc = _v74Scope_(scope);
  if (!sc.ids.length) throw new Error('NOT_FOUND: по охвату не найдено ни одной партии (' + sc.text + ')');
  var tr = _v74Trace_(sc.ids), B = _v74Batches_(), P = _v74Passes_();
  var batches = tr.batches.map(function (x) {
    var i = _v74Info_(x.id, B, P);
    return { batchId: x.id, role: x.role, path: x.path, via: x.via, product: i.product, unit: i.unit, received: i.received, remain: _v74R3_(i.remain), status: i.status,
      supplier: i.supplier, lot: i.lot, expiry: _v74Day_(i.expiry), blockable: i.remain > 0.0005 && !!MC_V74_BLOCKABLE_[i.status] };
  });
  var rec = _v74Recipients_(tr.outs, tr.from, B, P);
  return { scope: sc, batches: batches, recipients: rec, balance: _v74Balance_(tr.batches.map(function (x) { return x.id; }), tr.from, B, P),
    suppliers: _v74Suppliers_(batches) };
}
function _v74Suppliers_(batches) {
  var m = {};
  batches.forEach(function (b) { if (b.role !== 'SOURCE' || !b.supplier) return; var x = m[b.supplier] || (m[b.supplier] = { name: b.supplier, products: {}, lots: {} }); x.products[b.product] = 1; if (b.lot) x.lots[b.lot] = 1; });
  return Object.keys(m).map(function (k) { return { name: k, what: Object.keys(m[k].products).join(', ') + (Object.keys(m[k].lots).length ? ' (партии изготовителя: ' + Object.keys(m[k].lots).join(', ') + ')' : '') }; });
}

/* ---------------- блокировка отзыва ---------------- */
function _v74IsRecallBlock_(row) { return String(row[6] || '').indexOf('RECALL:') === 0; }
function _v74ActiveBlocks_(batchId) {
  var v = _mcBlocksSheet_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) if (String(v[i][1]) === 'BATCH' && String(v[i][2]) === String(batchId) && String(v[i][9]) === 'ACTIVE') out.push({ row: i + 1, v: v[i], recall: _v74IsRecallBlock_(v[i]) });
  return out;
}
function _v74HeldByRecall_(batchId) { return _v74ActiveBlocks_(batchId).some(function (b) { return b.recall; }); }
function _v74Block_(op, rec, id, prev, place) {
  var bid = 'BLK-' + Utilities.getUuid(), who = _author_(op), why = 'Отзыв ' + rec['Номер'] + ': ' + rec['Опасность'] + (rec['Описание'] ? ' — ' + String(rec['Описание']).slice(0, 120) : '');
  _mcBlocksSheet_().appendRow([bid, 'BATCH', id, why, '', '', 'RECALL:' + rec.RecallID, new Date(), who.фио, 'ACTIVE', '', '', '']);
  var b = _bcFind_(id); if (b) { b.sh.getRange(b.row, 11).setValue('blocked'); b.v[10] = 'blocked'; }
  _mcBlEvent_(op, id, 'BATCH_BLOCK', { reason: why, doc: rec['Документ основания'] || '', to: place || '', before: { status: prev }, after: { status: 'blocked' } });
  return bid;
}
function _v74CloseBlock_(blockId, status, who, reason) {
  var sh = _mcBlocksSheet_(), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(blockId)) { sh.getRange(i + 1, 10, 1, 4).setValues([[status, new Date(), who, reason]]); return true; }
  return false;
}
/** После снятия блокировки — прежний статус, если других активных блокировок нет. */
function _v74Restore_(batchId, prev) {
  var b = _bcFind_(batchId); if (!b) return '';
  if (String(b.v[10]) !== 'blocked') return String(b.v[10]);
  if (_v74ActiveBlocks_(batchId).length) return 'blocked';
  var st = prev && prev !== 'blocked' && MC_V74_BLOCKABLE_[prev] ? prev : (prev === 'blocked' ? 'blocked' : 'active');
  b.sh.getRange(b.row, 11).setValue(st); b.v[10] = st;
  return st;
}

/* Защита: блокировку по отзыву снимает только решение по отзыву. */
(function () {
  var orig = typeof _bcSetStatus_ === 'function' ? _bcSetStatus_ : null;
  if (!orig) return;
  _bcSetStatus_ = function (b, status) {
    var keep = { consumed: 1, returned: 1, blocked: 1 };
    if (b && b.v && !keep[String(status)] && _v74HeldByRecall_(b.v[0])) status = 'blocked';
    return orig(b, status);
  };
})();
if (typeof _v67ReleaseBlocks_ === 'function') {
  _v67ReleaseBlocks_ = function (batchId, reason, who) {
    var sh = _mcBlocksSheet_(), v = sh.getDataRange().getValues(), n = 0;
    for (var i = 1; i < v.length; i++) if (String(v[i][1]) === 'BATCH' && String(v[i][2]) === String(batchId) && String(v[i][9]) === 'ACTIVE' && !_v74IsRecallBlock_(v[i])) {
      sh.getRange(i + 1, 10, 1, 4).setValues([['RELEASED', new Date(), who, reason]]); n++; }
    if (n && !_v74ActiveBlocks_(batchId).length) { var b = _bcFind_(batchId); if (b && String(b.v[10]) === 'blocked') { b.sh.getRange(b.row, 11).setValue('active'); b.v[10] = 'active'; } }
    return n;
  };
}
releaseObjectBlock = function (blockId, reason, token) {
  try {
    var s = _requireAuth_(token, 'audit_create');
    var sh = _mcBlocksSheet_(), v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(blockId)) {
      if (String(v[i][9]) !== 'ACTIVE') return coreErr('BLOCK_NOT_ACTIVE', 'Блокировка уже закрыта');
      if (_v74IsRecallBlock_(v[i])) return coreErr('BLOCK_RECALL', 'Партия заблокирована по отзыву продукции — блокировку снимает только решение по отзыву (ХАССП → Отзыв продукции)');
      sh.getRange(i + 1, 10).setValue('RELEASED'); sh.getRange(i + 1, 11).setValue(new Date()); sh.getRange(i + 1, 12).setValue(_mcSessionFullName_(s)); sh.getRange(i + 1, 13).setValue(reason || '');
      if (String(v[i][1]) === 'BATCH' && !_v74ActiveBlocks_(v[i][2]).length) {
        var b = _bcFind_(v[i][2]); if (b && String(b.v[10]) === 'blocked') { b.sh.getRange(b.row, 11).setValue('active'); b.v[10] = 'active'; }
      }
      return coreOk({ blockId: blockId, releasedBy: _mcSessionFullName_(s) });
    }
    return coreErr('BLOCK_NOT_FOUND', 'Блокировка не найдена');
  } catch (e) { return coreErr('BLOCK_RELEASE_ERROR', String(e)); }
};

/* ---------------- карточка отзыва ---------------- */
function _v74Find_(id) {
  var rs = _v74Rows_('R'); for (var i = 0; i < rs.length; i++) if (String(rs[i].RecallID) === String(id) || String(rs[i]['Номер']) === String(id)) return rs[i];
  return null;
}
function _v74Drill_(r) { return r['Учебный'] === true || String(r['Учебный']) === 'да' || String(r['Учебный']) === 'true'; }
function _v74Card_(r) {
  var drill = _v74Drill_(r), id = String(r.RecallID), B = _v74Batches_(), P = _v74Passes_();
  var batches = _v74Rows_('B', id).map(function (x) {
    var i = _v74Info_(String(x.BatchID), B, P), blk = String(x.BlockID || ''), dec = String(x['Решение'] || '');
    return { rowId: x.RowID, batchId: String(x.BatchID), product: String(x['Продукт'] || ''), role: String(x['Роль']), roleText: x['Роль'] === 'SOURCE' ? 'исходная' : 'производная',
      path: String(x['Путь'] || ''), unit: String(x['Ед.'] || ''), received: _v74N_(x['Получено']), remainAtOpen: _v74N_(x['Остаток при открытии']), remainNow: _v74R3_(i.remain),
      statusBefore: String(x['Статус до'] || ''), statusNow: i.status, blockId: blk, decision: dec, decisionText: MC_V74_DEC_[dec] || '', decisionQty: _v74N_(x['Кол-во по решению']),
      doc: String(x['Документ'] || ''), basis: String(x['Основание / способ'] || ''), actId: String(x['Акт списания'] || ''), decidedBy: String(x['Решил'] || ''), decidedAt: _v74Fmt_(x['Решено']),
      supplier: String(x['Поставщик'] || ''), lot: String(x['Партия изготовителя'] || ''), expiry: String(x['Годен до'] || ''), pending: !drill && !!blk && !dec,
      releaseGround: String(x['Основание выпуска'] || ''), disposal: String(x['Ликвидация'] || ''), expertise: String(x['Экспертиза'] || ''), disinfection: String(x['Обеззараживание'] || '') };
  });
  var recipients = _v74Rows_('D', id).map(function (x) {
    var need = x['Нужно уведомить'] === true || String(x['Нужно уведомить']) === 'да';
    var done = x['Уведомлён'] === true || String(x['Уведомлён']) === 'да', nr = String(x['Не требуется — причина'] || '');
    return { rowId: x.RowID, type: String(x['Тип']), typeText: MC_V74_KIND_RU_[x['Тип']] || String(x['Тип']), objectId: String(x.ObjectID || ''), to: String(x['Получатель'] || ''),
      contact: String(x['Контакт'] || ''), at: _v74Day_(x['Дата']), batchId: String(x['Через партию'] || ''), product: String(x['Продукт'] || ''), qty: _v74N_(x['Кол-во']), unit: String(x['Ед.'] || ''),
      what: String(x['Что'] || ''), need: need, notified: done, method: String(x['Способ'] || ''), content: String(x['Содержание / документ'] || ''), notifiedBy: String(x['Уведомил'] || ''),
      notifiedAt: _v74Fmt_(x['Когда']), notRequired: nr, pending: !drill && need && !done && !nr,
      response: String(x['Ответ получателя'] || ''), responseAt: _v74Fmt_(x['Ответ записан']) };
  });
  var log = _v74Rows_('L', id).map(function (x) { return { at: _v74Fmt_(x['Время']), action: String(x['Действие']), details: String(x['Подробно'] || ''), who: String(x['Сотрудник'] || ''), role: String(x['Должность'] || '') }; });
  var ids = batches.map(function (b) { return b.batchId; }), from = _v74Links_(), bal = _v74Balance_(ids, from, B, P);
  var todo = [], warn = [];
  batches.forEach(function (b) { if (b.pending) todo.push('Решение по партии ' + b.batchId + ' «' + b.product + '» (остаток ' + b.remainNow + ' ' + b.unit + '): возврат, уничтожение или снятие с отзыва'); });
  recipients.forEach(function (x) { if (x.pending) todo.push('Уведомить: ' + x.to + (x.what ? ' — ' + x.what : '') + ' (или отметить «не требуется» с причиной)'); });
  if (!drill && String(r['Основание (код)']) === 'AUTHORITY_ORDER') batches.forEach(function (b) {
    if (b.decision === 'DESTROY' && !b.doc) todo.push('Документ, подтверждающий утилизацию партии ' + b.batchId + ' (ТР ТС 021/2011 ст. 18 ч. 8 — для органа, вынесшего предписание)'); });
  bal.forEach(function (x) {
    if (x.gap > 0.0005) warn.push('Партия ' + x.batchId + ' «' + x.product + '»: не прослежено ' + x.gap + ' ' + x.unit + ' из ' + x.received + ' — установите по журналам склада, куда ушла продукция');
    if (x.over) warn.push('Партия ' + x.batchId + ': по связям учтено больше, чем получено (' + x.accounted + ' из ' + x.received + ' ' + x.unit + ') — проверьте задвоенные записи');
    if (x.unknownLinks) warn.push('Партия ' + x.batchId + ': ' + x.unknownLinks + ' связ. без количества или в несовместимой единице');
  });
  recipients.forEach(function (x) { if (x.type === 'USE') warn.push('Партия ' + x.batchId + ': ' + (x.qty === null ? '' : x.qty + ' ' + x.unit + ' ') + 'использовано без привязки к выпуску — куда ушло, не прослежено'); });
  var traced = bal.length ? Math.round(bal.reduce(function (a, x) { return a + (x.pct === null ? 0 : x.pct); }, 0) / bal.length * 10) / 10 : null;
  var st = String(r['Статус']), hz = _v74Ref_(MC_V74_HAZ_, String(r['Опасность (код)'])) || [];
  var after = [];
  if (st === 'CLOSED' && !r['Рассмотрено руководством']) after.push('Передать руководству: сведения о причине, объёме и результате отзыва — входные данные анализа со стороны руководства (ГОСТ Р ИСО 22000-2019 п. 8.9.5, 9.3.2 e)');
  return { id: id, num: String(r['Номер']), drill: drill, status: st, statusText: st === 'OPEN' ? 'открыт' : st === 'CLOSED' ? 'закрыт' : st === 'CANCELLED' ? 'отменён' : st,
    basisCode: String(r['Основание (код)']), basis: String(r['Основание']), basisDoc: String(r['Документ основания'] || ''), hazardCode: String(r['Опасность (код)']), hazard: String(r['Опасность']),
    description: String(r['Описание'] || ''), scopeText: String(r['Охват'] || ''), place: String(r['Место изоляции'] || ''), openedAt: _v74Fmt_(r['Открыт']), openedBy: String(r['Открыл'] || ''),
    openedRole: String(r['Должность'] || ''), closedAt: _v74Fmt_(r['Закрыт']), closedBy: String(r['Закрыл'] || ''), cause: String(r['Причина несоответствия'] || ''), measures: String(r['Принятые меры'] || ''),
    conclusion: String(r['Заключение'] || ''), pdf: r.PDF ? { fileId: String(r.PDF), sha256: String(r['PDF SHA-256'] || '') } : null, cancelReason: String(r['Причина отмены'] || ''),
    legal: String(r['Правовая категория'] || ''), hazardGround: hz[2] || '', minutes: _v74N_(r['Длительность, мин']),
    reviewedAt: _v74Fmt_(r['Рассмотрено руководством']), reviewedBy: String(r['Рассмотрел'] || ''), reviewDecisions: String(r['Решения руководства'] || ''), afterClose: after,
    disinfectionNeeded: !!MC_V74_DISINFECT_[String(r['Опасность (код)'])],
    batches: batches, recipients: recipients, log: log, balance: bal, tracedPct: traced, todo: todo, warnings: warn,
    blocked: batches.filter(function (b) { return b.blockId && !b.decision; }).length, canClose: st === 'OPEN' && !todo.length,
    canCancel: st === 'OPEN' && !batches.some(function (b) { return b.decision === 'RETURN' || b.decision === 'DESTROY'; }) };
}
function _v74Short_(r) {
  var id = String(r.RecallID), bs = _v74Rows_('B', id), ds = _v74Rows_('D', id), drill = _v74Drill_(r);
  return { id: id, num: String(r['Номер']), drill: drill, status: String(r['Статус']), basis: String(r['Основание']), hazard: String(r['Опасность']), scopeText: String(r['Охват'] || ''),
    openedAt: _v74Fmt_(r['Открыт']), openedBy: String(r['Открыл'] || ''), closedAt: _v74Fmt_(r['Закрыт']), batches: bs.length, closedTs: r['Закрыт'] instanceof Date ? r['Закрыт'].getTime() : null,
    reviewed: !!r['Рассмотрено руководством'], minutes: _v74N_(r['Длительность, мин']), legal: String(r['Правовая категория'] || ''),
    blocked: drill ? 0 : bs.filter(function (b) { return b.BlockID && !b['Решение']; }).length,
    toNotify: drill ? 0 : ds.filter(function (d) { return (d['Нужно уведомить'] === true || d['Нужно уведомить'] === 'да') && !(d['Уведомлён'] === true || d['Уведомлён'] === 'да') && !d['Не требуется — причина']; }).length };
}

/* ---------------- API: просмотр ---------------- */
var MC_V74_VIEW_ = 'haccp|haccp_view|haccp_approve|stock';
var MC_V74_ACT_ = 'haccp|haccp_approve|stock';
var MC_V74_DECIDE_ = 'haccp|haccp_approve';

/** Экран: справочники, продукты и поставщики со склада, список отзывов. */
function v74Data(token) {
  try { _requireAuth_(token, MC_V74_VIEW_); } catch (e) { return _failFrom_(e); }
  try {
    var B = _v74Batches_(), P = _v74Passes_(), prods = {}, sups = {};
    Object.keys(B).forEach(function (id) { var i = _v74Info_(id, B, P); if (i.product) prods[i.product] = 1; if (i.supplier) sups[i.supplier] = 1; });
    var list = _v74Rows_('R').map(_v74Short_).reverse(), st = _v74Settings_(), staff = [];
    try { staff = JSON.parse(getEmployees() || '[]').filter(function (e) { return e.active !== false; }).map(function (e) { return { name: e.name, position: e.position || '' }; }); } catch (e) {}
    var drills = list.filter(function (x) { return x.drill && x.status === 'CLOSED' && x.closedTs; }).sort(function (a, b) { return b.closedTs - a.closedTs; });
    var last = drills[0] || null, due = null;
    if (st.drillMonths > 0) { var lim = new Date(); lim.setMonth(lim.getMonth() - st.drillMonths); due = !last || last.closedTs < lim.getTime(); }
    return _ok_({ bases: MC_V74_BASIS_.map(function (x) { return { code: x[0], name: x[1], docRequired: x[2] }; }),
      hazards: MC_V74_HAZ_.map(function (x) { return { code: x[0], name: x[1], ground: x[2], legal: x[3], disinfect: !!MC_V74_DISINFECT_[x[0]] }; }), decisions: MC_V74_DEC_, law: MC_V74_LAW_,
      releaseGrounds: MC_V74_RELEASE_.map(function (x) { return { code: x[0], name: x[1] }; }), disposals: MC_V74_DISPOSAL_.map(function (x) { return { code: x[0], name: x[1] }; }),
      settings: st, staff: staff, lastDrill: last ? { num: last.num, closedAt: last.closedAt, minutes: last.minutes } : null, drillDue: due,
      reviewPending: list.filter(function (x) { return x.status === 'CLOSED' && !x.reviewed; }).length,
      products: Object.keys(prods).sort(function (a, b) { return a.localeCompare(b, 'ru'); }), suppliers: Object.keys(sups).sort(function (a, b) { return a.localeCompare(b, 'ru'); }),
      recalls: list, open: list.filter(function (x) { return x.status === 'OPEN' && !x.drill; }).length });
  } catch (e) { return _failFrom_(e); }
}
/** Предпросмотр охвата: какие партии, куда ушли, что будет заблокировано. Ничего не меняет. */
function v74Preview(json, token) {
  try { _requireAuth_(token, MC_V74_ACT_); } catch (e) { return _failFrom_(e); }
  try {
    var d = {}; try { d = JSON.parse(json || '{}') || {}; } catch (e) {}
    var p = _v74Plan_(d.scope || d);
    return _ok_({ scopeText: p.scope.text, batches: p.batches, recipients: p.recipients, balance: p.balance, suppliers: p.suppliers,
      toBlock: p.batches.filter(function (b) { return b.blockable; }).length });
  } catch (e) { return _failFrom_(e); }
}
function v74Get(id, token) {
  try { _requireAuth_(token, MC_V74_VIEW_); } catch (e) { return _failFrom_(e); }
  try { var r = _v74Find_(id); if (!r) return _fail_('NOT_FOUND', 'Отзыв не найден'); return _ok_(_v74Card_(r)); } catch (e) { return _failFrom_(e); }
}

/* ---------------- API: открыть ---------------- */
function _v74Number_(drill) {
  var y = Utilities.formatDate(new Date(), _mcTz_(), 'yyyy'), pre = (drill ? 'УЧ-' : 'ОТЗ-') + y + '-', n = 0;
  _v74Rows_('R').forEach(function (r) { var m = String(r['Номер']); if (m.indexOf(pre) === 0) n = Math.max(n, parseInt(m.slice(pre.length), 10) || 0); });
  return pre + ('00' + (n + 1)).slice(-3);
}
/** Добавить партии и получателей, которых ещё нет в отзыве; заблокировать новые партии с остатком. */
function _v74Sync_(op, rec, plan, place) {
  var drill = _v74Drill_(rec), id = String(rec.RecallID), have = {}, haveD = {}, blocked = 0, added = 0, addedD = 0;
  _v74Rows_('B', id).forEach(function (x) { have[String(x.BatchID)] = x; });
  _v74Rows_('D', id).forEach(function (x) { haveD[x['Тип'] + '|' + x.ObjectID + '|' + x['Через партию']] = 1; });
  var who = _author_(op);
  plan.batches.forEach(function (b) {
    var ex = have[b.batchId];
    if (ex) {
      // партия уже в отзыве: остаток появился снова (исправление приёмки) — заблокировать
      if (!drill && !ex.BlockID && b.blockable && (!ex['Решение'] || ex['Решение'] === 'NO_STOCK')) {
        var bid0 = _v74Block_(op, rec, b.batchId, b.status, place);
        _v74Set_('B', ex._row, { BlockID: bid0, 'Решение': '', 'Статус до': b.status, 'Остаток при открытии': b.remain }); blocked++;
      }
      return;
    }
    var blk = '', dec = '';
    if (!drill) { if (b.blockable) { blk = _v74Block_(op, rec, b.batchId, b.status, place); blocked++; } else dec = 'NO_STOCK'; }
    _v74Append_('B', { RowID: _v74Id_('RB'), RecallID: id, BatchID: b.batchId, 'Продукт': b.product, 'Роль': b.role, 'Путь': b.path, 'Ед.': b.unit, 'Получено': b.received,
      'Остаток при открытии': b.remain, 'Статус до': b.status, BlockID: blk, 'Решение': dec, 'Решил': dec ? 'система: остатка нет' : '', 'Решено': dec ? new Date() : '',
      'Поставщик': b.supplier, 'Партия изготовителя': b.lot, 'Годен до': b.expiry, OperationID: op.id });
    added++;
  });
  plan.recipients.forEach(function (x) {
    var k = x.type + '|' + x.objectId + '|' + x.batchId; if (haveD[k]) return; haveD[k] = 1;
    _v74Append_('D', { RowID: _v74Id_('RD'), RecallID: id, 'Тип': x.type, ObjectID: x.objectId, 'Получатель': x.to, 'Контакт': x.contact, 'Дата': x.at, 'Через партию': x.batchId,
      'Продукт': x.product, 'Кол-во': x.qty === null ? '' : x.qty, 'Ед.': x.unit, 'Что': x.what, 'Нужно уведомить': x.need ? 'да' : 'нет', 'Уведомлён': 'нет', OperationID: op.id });
    addedD++;
  });
  plan.suppliers.forEach(function (s) {
    var k = 'SUPPLIER|' + s.name + '|'; if (haveD[k]) return; haveD[k] = 1;
    _v74Append_('D', { RowID: _v74Id_('RD'), RecallID: id, 'Тип': 'SUPPLIER', ObjectID: s.name, 'Получатель': s.name, 'Что': s.what, 'Нужно уведомить': 'да', 'Уведомлён': 'нет', OperationID: op.id });
    addedD++;
  });
  if (String(rec['Основание (код)']) === 'AUTHORITY_ORDER' && !haveD['AUTHORITY|AUTHORITY|']) {
    _v74Append_('D', { RowID: _v74Id_('RD'), RecallID: id, 'Тип': 'AUTHORITY', ObjectID: 'AUTHORITY', 'Получатель': 'Орган, выдавший предписание (' + (rec['Документ основания'] || 'реквизиты предписания') + ')',
      'Что': 'о принятых мерах; при уничтожении опасной продукции — о месте, времени, способах и условиях утилизации (ТР ТС 021/2011 ст. 18 ч. 4)', 'Нужно уведомить': 'да', 'Уведомлён': 'нет', OperationID: op.id });
    addedD++;
  }
  return { blocked: blocked, added: added, addedRecipients: addedD, by: who.фио };
}
/** Открыть отзыв. json: {drill, basis, basisDoc, hazard, description, place, scope:{batchIds | product, supplier, manufacturer, lot, from, to}} */
function v74Open(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V74_ACT_, 'RECALL_OPEN', 'Отзыв продукции', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = {}; try { d = JSON.parse(json || '{}') || {}; } catch (e) {}
    var drill = d.drill === true || d.drill === 'true', basis = _v74Ref_(MC_V74_BASIS_, String(d.basis || '')), haz = _v74Ref_(MC_V74_HAZ_, String(d.hazard || ''));
    var doc = String(d.basisDoc || '').trim(), desc = String(d.description || '').trim(), place = String(d.place || '').trim() || (drill ? '' : String(_v74Settings_().isolation || '').trim());
    var resp = drill ? '' : _v74Responsible_(op);
    if (resp) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', resp, op.id); }
    var err = !basis ? 'Выберите основание отзыва' : !haz ? 'Выберите вид опасности или несоответствия' : desc.length < 5 ? 'Опишите несоответствие: что не так с продукцией'
      : (basis[2] && !doc && !drill) ? 'Укажите документ основания: номер и дату (' + basis[1].toLowerCase() + ')' : (!drill && !place) ? 'Укажите место изоляции: где хранится заблокированная продукция (ТР ТС 021/2011 ст. 18 ч. 3; 29-ФЗ ст. 25 п. 2)' : '';
    if (err) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', err, op.id); }
    return _withLock_(function () {
      var plan = _v74Plan_(d.scope || {}), who = _author_(op), id = _v74Id_('RCL'), num = _v74Number_(drill);
      var rec = { RecallID: id, 'Номер': num, 'Учебный': drill ? 'да' : 'нет', 'Статус': 'OPEN', 'Основание (код)': basis[0], 'Основание': basis[1], 'Документ основания': doc,
        'Опасность (код)': haz[0], 'Опасность': haz[1], 'Описание': desc, 'Охват (JSON)': JSON.stringify(plan.scope.json), 'Охват': plan.scope.text, 'Место изоляции': place,
        'Открыт': new Date(), 'Открыл': who.фио, 'Должность': who.должность || who.роль || '', 'ID открывшего': who.id || '', OperationID: op.id,
        'Правовая категория': haz[3] ? haz[3] + ' (' + haz[2] + (haz[3] === 'опасная' ? ', п. 3' : ', п. 4') + ')' : (haz[2] || '') };
      _v74Append_('R', rec);
      var s = _v74Sync_(op, rec, plan, place);
      _v74Log_(op, id, drill ? 'Учебный отзыв открыт' : 'Отзыв открыт', basis[1] + (doc ? ' (' + doc + ')' : '') + '; охват: ' + plan.scope.text + '; партий ' + s.added +
        (drill ? ' (учебный: без блокировок и изменения склада)' : '; заблокировано ' + s.blocked + (place ? ', место изоляции: ' + place : '')) + '; получателей и выбытий ' + s.addedRecipients);
      _audit_(op, 'RECALL_OPEN', 'Отзыв продукции', id, null, { num: num, drill: drill, basis: basis[0], hazard: haz[0], scope: plan.scope.text, batches: s.added, blocked: s.blocked });
      _endOp_(op);
      return _ok_(_v74Card_(_v74Find_(id)), op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Повторное прослеживание: новые связи, новые партии с остатком — в отзыв и под блокировку. */
function v74Rescan(id, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V74_ACT_, 'RECALL_RESCAN', 'Отзыв продукции', id, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var r = _v74Find_(id); if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Отзыв не найден', op.id); }
      if (String(r['Статус']) !== 'OPEN') { _endOp_(op, 'FAILED'); return _fail_('RECALL_STATE', 'Отзыв не открыт', op.id); }
      var src = _v74Rows_('B', r.RecallID).filter(function (x) { return x['Роль'] === 'SOURCE'; }).map(function (x) { return String(x.BatchID); });
      var plan = _v74Plan_({ batchIds: src }), s = _v74Sync_(op, r, plan, String(r['Место изоляции'] || ''));
      _v74Log_(op, r.RecallID, 'Повторное прослеживание', 'новых партий ' + s.added + ', заблокировано ' + s.blocked + ', новых получателей и выбытий ' + s.addedRecipients);
      _endOp_(op);
      return _ok_(_v74Card_(_v74Find_(r.RecallID)), op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- API: уведомления ---------------- */
/** json: {recallId, rowId, to?, method, content} | {recallId, rowId, notRequired} | {recallId, kind:'OTHER'|'SUPPLIER'|'AUTHORITY', to, contact, method, content} */
function v74Notify(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V74_ACT_, 'RECALL_NOTIFY', 'Отзыв продукции', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = {}; try { d = JSON.parse(json || '{}') || {}; } catch (e) {}
    var method = String(d.method || '').trim(), content = String(d.content || '').trim(), nr = String(d.notRequired || '').trim();
    return _withLock_(function () {
      var r = _v74Find_(d.recallId); if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Отзыв не найден', op.id); }
      if (String(r['Статус']) !== 'OPEN') { _endOp_(op, 'FAILED'); return _fail_('RECALL_STATE', 'Отзыв не открыт', op.id); }
      var who = _author_(op), drill = _v74Drill_(r);
      if (!nr && (!method || content.length < 3)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите способ (телефон, письмо, электронная почта, ЭДО, лично) и что сообщили — номер письма или кратко содержание', op.id); }
      if (d.rowId) {
        var x = _v74Rows_('D', r.RecallID).filter(function (y) { return String(y.RowID) === String(d.rowId); })[0];
        if (!x) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Получатель не найден в отзыве', op.id); }
        if (nr) {
          if (nr.length < 5) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Напишите, почему уведомление не требуется', op.id); }
          _v74Set_('D', x._row, { 'Не требуется — причина': nr, 'Уведомил': who.фио, 'Когда': new Date(), OperationID: op.id });
          _v74Log_(op, r.RecallID, 'Уведомление не требуется', x['Получатель'] + ': ' + nr);
        } else {
          _v74Set_('D', x._row, { 'Уведомлён': 'да', 'Способ': method, 'Содержание / документ': (drill ? '[учебный] ' : '') + content, 'Уведомил': who.фио, 'Когда': new Date(),
            'Контакт': d.contact ? String(d.contact) : x['Контакт'], OperationID: op.id });
          _v74Log_(op, r.RecallID, drill ? 'Уведомление (учебное)' : 'Уведомление', x['Получатель'] + ' — ' + method + ': ' + content);
        }
      } else {
        var kind = { SUPPLIER: 1, AUTHORITY: 1, OTHER: 1 }[String(d.kind)] ? String(d.kind) : 'OTHER', to = String(d.to || '').trim();
        if (!to) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Кого уведомили', op.id); }
        _v74Append_('D', { RowID: _v74Id_('RD'), RecallID: r.RecallID, 'Тип': kind, ObjectID: to, 'Получатель': to, 'Контакт': String(d.contact || ''), 'Что': String(d.what || ''),
          'Нужно уведомить': 'да', 'Уведомлён': 'да', 'Способ': method, 'Содержание / документ': (drill ? '[учебный] ' : '') + content, 'Уведомил': who.фио, 'Когда': new Date(), OperationID: op.id });
        _v74Log_(op, r.RecallID, drill ? 'Уведомление (учебное)' : 'Уведомление', to + ' — ' + method + ': ' + content);
      }
      _audit_(op, 'RECALL_NOTIFY', 'Отзыв продукции', r.RecallID, null, { rowId: d.rowId || '', notRequired: nr, method: method });
      _endOp_(op);
      return _ok_(_v74Card_(_v74Find_(r.RecallID)), op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Ответ получателя уведомления (ГОСТ Р ИСО 22000-2019 п. 8.9.4.1 — ответные реакции заинтересованных сторон сохраняются). json: {recallId, rowId, response} */
function v74NotifyResponse(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V74_ACT_, 'RECALL_RESPONSE', 'Отзыв продукции', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = {}; try { d = JSON.parse(json || '{}') || {}; } catch (e) {}
    var resp = String(d.response || '').trim();
    if (resp.length < 3) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Запишите ответ получателя: что ответил, номер письма', op.id); }
    return _withLock_(function () {
      var r = _v74Find_(d.recallId); if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Отзыв не найден', op.id); }
      if (String(r['Статус']) !== 'OPEN') { _endOp_(op, 'FAILED'); return _fail_('RECALL_STATE', 'Отзыв не открыт', op.id); }
      var x = _v74Rows_('D', r.RecallID).filter(function (y) { return String(y.RowID) === String(d.rowId); })[0];
      if (!x) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Получатель не найден в отзыве', op.id); }
      if (!(x['Уведомлён'] === true || String(x['Уведомлён']) === 'да')) { _endOp_(op, 'FAILED'); return _fail_('RECALL_STATE', 'Сначала отметьте уведомление', op.id); }
      var prev = String(x['Ответ получателя'] || ''), who = _author_(op), line = Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH:mm') + ' ' + who.фио + ': ' + resp;
      _v74Set_('D', x._row, { 'Ответ получателя': prev ? prev + '\n' + line : line, 'Ответ записан': new Date() });
      _v74Log_(op, r.RecallID, 'Ответ получателя', x['Получатель'] + ': ' + resp);
      _audit_(op, 'RECALL_RESPONSE', 'Отзыв продукции', r.RecallID, null, { rowId: String(d.rowId), response: resp });
      _endOp_(op);
      return _ok_(_v74Card_(_v74Find_(r.RecallID)), op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- API: решение по партии ---------------- */
/** Акт списания по отзыву: та же книга «Акты_Списания», строка — конкретная заблокированная партия (не FEFO). */
function _v74DestroyAct_(op, rec, b, qty, method, disposal) {
  var sh = _woSheet_(), now = new Date(), ymd = Utilities.formatDate(now, _mcTz_(), 'yyyyMMdd'), n = 1, v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).indexOf('АС-' + ymd + '-') === 0) n++;
  var actId = 'АС-' + ymd + '-' + ('00' + n).slice(-3), who = _author_(op), price = _mcBlUnitPrice_(b), name = String(b.v[1]), unit = String(b.v[2]);
  var dz = _v74Ref_(MC_V74_DISPOSAL_, disposal || 'DESTROY') || MC_V74_DISPOSAL_[0];
  var note = 'Изъятие из обращения: отзыв ' + rec['Номер'] + ' · ' + (dz[0] === 'OTHER_USE' ? 'использование по другому назначению' : 'уничтожение') + ' · ' + method;
  _logStockOp_('Списание', name, qty, unit, price, 'Акт ' + actId, note);
  var t = _mcBlTake_(b, qty);
  if (t.remain <= 0.0005) { b.sh.getRange(b.row, 11).setValue('consumed'); b.v[10] = 'consumed'; }
  var lines = [{ kind: 'PRODUCT', name: name, qty: t.taken, unit: unit, batchId: String(b.v[0]) }];
  var done = [{ name: name, qty: t.taken, unit: unit, price: _woR2_(price), sum: _woR2_(price * t.taken), pf: false, batches: [{ batchId: String(b.v[0]), qty: t.taken, unit: unit }] }];
  sh.appendRow([actId, now, 'RECALL', 'Изъятие из обращения (отзыв продукции)', rec['Номер'] + ' · ' + (dz[0] === 'OTHER_USE' ? 'другое назначение' : 'уничтожение') + ' · ' + method, 1, _woR2_(price * t.taken), who.фио, who.роль, JSON.stringify(lines), JSON.stringify(done), op.id]);
  var ev = _mcBlEvent_(op, String(b.v[0]), 'BATCH_WASTE', { qty: t.taken, unit: unit, reason: note, doc: actId, before: { remain: t.remainBefore, status: 'blocked' }, after: { remain: t.remain } });
  _mcCreateTraceLink_('BATCH', String(b.v[0]), 'СПИСАНА_ПО_АКТУ', 'WRITEOFF_ACT', actId, { factId: ev, dateTime: now, actor: who.фио, source: 'Отзыв ' + rec['Номер'], weight: t.taken, unit: unit });
  return { actId: actId, taken: t.taken, sum: _woR2_(price * t.taken) };
}
/** json: {recallId, batchId, decision: RETURN|DESTROY|RELEASE, doc, basis} */
function v74Decide(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V74_DECIDE_, 'RECALL_DECIDE', 'Отзыв продукции', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = {}; try { d = JSON.parse(json || '{}') || {}; } catch (e) {}
    var dec = String(d.decision || ''), doc = String(d.doc || '').trim(), basis = String(d.basis || '').trim();
    var rg = _v74Ref_(MC_V74_RELEASE_, String(d.releaseGround || '')), dz = _v74Ref_(MC_V74_DISPOSAL_, String(d.disposal || 'DESTROY'));
    var expertise = String(d.expertise || '').trim(), disinfection = String(d.disinfection || '').trim();
    if (!{ RETURN: 1, DESTROY: 1, RELEASE: 1 }[dec]) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите решение: возврат, уничтожение или снятие с отзыва', op.id); }
    var err = dec === 'RETURN' && !doc ? 'Укажите документ возврата: номер и дату накладной на возврат или акта передачи'
      : dec === 'DESTROY' && basis.length < 5 ? 'Укажите способ уничтожения (утилизации) и кто выполняет — например, «передано по договору … на утилизацию», «уничтожено с обеззараживанием»'
      : dec === 'DESTROY' && !dz ? 'Выберите способ ликвидации'
      : dec === 'RELEASE' && !rg ? 'Выберите основание выпуска (ГОСТ Р ИСО 22000-2019 п. 8.9.4.2, 8.9.4.3 a)'
      : dec === 'RELEASE' && (!doc || basis.length < 10) ? 'Снять с отзыва можно только по документу: номер документа и основание — почему партия не затронута или безопасна (письмо поставщика, протокол исследований, способ переработки)' : '';
    if (err) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', err, op.id); }
    return _withLock_(function () {
      var r = _v74Find_(d.recallId); if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Отзыв не найден', op.id); }
      if (String(r['Статус']) !== 'OPEN') { _endOp_(op, 'FAILED'); return _fail_('RECALL_STATE', 'Отзыв не открыт', op.id); }
      if (_v74Drill_(r)) { _endOp_(op, 'FAILED'); return _fail_('RECALL_DRILL', 'Учебный отзыв: решения по партиям не оформляются, склад не меняется', op.id); }
      var resp = _v74Responsible_(op); if (resp) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', resp, op.id); }
      if (dec === 'DESTROY' && dz[0] === 'DESTROY' && MC_V74_DISINFECT_[String(r['Опасность (код)'])] && disinfection.length < 5) {
        _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите обеззараживание перед уничтожением или в процессе: как и кто (ТР ТС 021/2011 ст. 18 ч. 7; 29-ФЗ ст. 25 п. 3.1)', op.id); }
      var x = _v74Rows_('B', r.RecallID).filter(function (y) { return String(y.BatchID) === String(d.batchId); })[0];
      if (!x) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не входит в отзыв', op.id); }
      if (!x.BlockID || x['Решение']) { _endOp_(op, 'FAILED'); return _fail_('RECALL_STATE', 'По партии решение уже принято или она не блокировалась (остатка не было)', op.id); }
      var b = _bcFind_(x.BatchID); if (!b) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Партия не найдена на складе', op.id); }
      var who = _author_(op), remain = _mcBlNum_(b.v[9]), out = { batchId: String(x.BatchID), decision: dec }, P = _v74Passes_(), info = _v74Info_(String(x.BatchID), _v74Batches_(), P);
      var by = who.фио + (who.должность || who.роль ? ', ' + (who.должность || who.роль) : '');   // кто санкционировал решение (8.9.4.3)
      if (dec === 'RETURN') {
        if (x['Роль'] !== 'SOURCE' || !info.supplier) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Вернуть поставщику можно только полученную от поставщика партию; продукцию собственного производства — уничтожить или снять с отзыва', op.id); }
        if (!(remain > 0)) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Остаток партии 0', op.id); }
        var t = _mcBlTake_(b, remain);
        _logStockOp_('Возврат поставщику', b.v[1], t.taken, b.v[2], _mcBlUnitPrice_(b), info.supplier, 'Отзыв ' + r['Номер'] + ' · ' + doc);
        b.sh.getRange(b.row, 11).setValue('returned'); b.v[10] = 'returned';
        var ev = _mcBlEvent_(op, x.BatchID, 'BATCH_RETURN', { qty: t.taken, unit: b.v[2], reason: 'Отзыв ' + r['Номер'] + (basis ? ' · ' + basis : ''), doc: doc, before: { status: 'blocked', remain: remain }, after: { status: 'returned', remain: 0 } });
        _mcCreateTraceLink_('BATCH', String(x.BatchID), 'RETURN', 'SUPPLIER', String(info.supplierId || info.supplier), { factId: ev, actor: who.фио, source: 'Отзыв ' + r['Номер'], weight: t.taken, unit: b.v[2] });
        _v74CloseBlock_(x.BlockID, 'CLOSED', who.фио, 'возвращена поставщику по отзыву ' + r['Номер'] + ' (' + doc + ')');
        _v74Set_('B', x._row, { 'Решение': 'RETURN', 'Кол-во по решению': t.taken, 'Документ': doc, 'Основание / способ': basis, 'Решил': by, 'Решено': new Date(), OperationID: op.id, 'Экспертиза': expertise });
        out.qty = t.taken; out.unit = b.v[2];
        _v74Log_(op, r.RecallID, 'Возврат поставщику', x.BatchID + ' «' + x['Продукт'] + '» ' + t.taken + ' ' + b.v[2] + ' — ' + info.supplier + ', ' + doc);
      } else if (dec === 'DESTROY') {
        if (!(remain > 0)) { _endOp_(op, 'FAILED'); return _fail_('BATCH_STATE', 'Остаток партии 0', op.id); }
        var a = _v74DestroyAct_(op, r, b, remain, basis, dz[0]);
        _v74CloseBlock_(x.BlockID, 'CLOSED', who.фио, 'уничтожена по акту ' + a.actId + ' (отзыв ' + r['Номер'] + ')');
        _v74Set_('B', x._row, { 'Решение': 'DESTROY', 'Кол-во по решению': a.taken, 'Документ': doc, 'Основание / способ': basis, 'Акт списания': a.actId, 'Решил': by, 'Решено': new Date(), OperationID: op.id,
          'Ликвидация': dz[1], 'Экспертиза': expertise, 'Обеззараживание': disinfection });
        out.qty = a.taken; out.unit = b.v[2]; out.actId = a.actId; out.sum = a.sum;
        _v74Log_(op, r.RecallID, dz[0] === 'OTHER_USE' ? 'Другое назначение по акту' : 'Уничтожение по акту', x.BatchID + ' «' + x['Продукт'] + '» ' + a.taken + ' ' + b.v[2] + ' — акт ' + a.actId + '; способ: ' + basis +
          (disinfection ? '; обеззараживание: ' + disinfection : '') + (expertise ? '; экспертиза: ' + expertise : '') + (doc ? '; документ: ' + doc : ''));
      } else {
        _v74CloseBlock_(x.BlockID, 'RELEASED', who.фио, 'снята с отзыва ' + r['Номер'] + ': ' + basis + ' (' + doc + ')');
        var st = _v74Restore_(String(x.BatchID), String(x['Статус до'] || ''));
        _mcBlEvent_(op, x.BatchID, 'BATCH_RELEASE', { reason: 'Снята с отзыва ' + r['Номер'] + ': ' + basis, doc: doc, before: { status: 'blocked' }, after: { status: st } });
        _v74Set_('B', x._row, { 'Решение': 'RELEASE', 'Кол-во по решению': remain, 'Документ': doc, 'Основание / способ': basis, 'Решил': by, 'Решено': new Date(), OperationID: op.id,
          'Основание выпуска': rg[1], 'Экспертиза': expertise });
        out.status = st;
        _v74Log_(op, r.RecallID, 'Снята с отзыва', x.BatchID + ' «' + x['Продукт'] + '» — ' + rg[1] + ': ' + basis + ' (' + doc + '); статус партии: ' + st);
      }
      _audit_(op, 'RECALL_DECIDE', 'Отзыв продукции', r.RecallID, { batchId: String(x.BatchID), status: 'blocked' }, { decision: dec, doc: doc, basis: basis, actId: out.actId || '',
        releaseGround: rg ? rg[0] : '', disposal: dec === 'DESTROY' ? dz[0] : '', expertise: expertise, disinfection: disinfection, by: by });
      _endOp_(op);
      var card = _v74Card_(_v74Find_(r.RecallID)); card.result = out;
      return _ok_(card, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Документ к уже принятому решению (акт утилизации от подрядчика, накладная на возврат пришли позже). json: {recallId, batchId, doc} */
function v74DecisionDoc(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V74_DECIDE_, 'RECALL_DOC', 'Отзыв продукции', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = {}; try { d = JSON.parse(json || '{}') || {}; } catch (e) {}
    var doc = String(d.doc || '').trim();
    if (doc.length < 3) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите документ: номер и дату', op.id); }
    return _withLock_(function () {
      var r = _v74Find_(d.recallId); if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Отзыв не найден', op.id); }
      if (String(r['Статус']) !== 'OPEN') { _endOp_(op, 'FAILED'); return _fail_('RECALL_STATE', 'Отзыв не открыт', op.id); }
      var resp = _v74Drill_(r) ? '' : _v74Responsible_(op); if (resp) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', resp, op.id); }
      var x = _v74Rows_('B', r.RecallID).filter(function (y) { return String(y.BatchID) === String(d.batchId); })[0];
      if (!x || !{ RETURN: 1, DESTROY: 1, RELEASE: 1 }[String(x['Решение'])]) { _endOp_(op, 'FAILED'); return _fail_('RECALL_STATE', 'По партии нет решения, к которому прикладывается документ', op.id); }
      if (String(x['Документ'] || '')) { _endOp_(op, 'FAILED'); return _fail_('RECALL_STATE', 'Документ уже указан: ' + x['Документ'] + '. Исправление — через журнал операций партии', op.id); }
      _v74Set_('B', x._row, { 'Документ': doc });
      _v74Log_(op, r.RecallID, 'Документ к решению', x.BatchID + ' (' + (MC_V74_DEC_[x['Решение']] || x['Решение']) + '): ' + doc);
      _audit_(op, 'RECALL_DOC', 'Отзыв продукции', r.RecallID, null, { batchId: String(x.BatchID), doc: doc });
      _endOp_(op);
      return _ok_(_v74Card_(_v74Find_(r.RecallID)), op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- API: закрыть, отменить ---------------- */
function _v74PdfBody_(c) {
  var E = _mcOrgEsc_, h = '', row = function (a) { return '<tr>' + a.map(function (x) { return '<td>' + E(x === null || x === undefined ? '' : x) + '</td>'; }).join('') + '</tr>'; };
  h += '<table class="r"><tr><th style="width:28%">Номер</th><td>' + E(c.num) + (c.drill ? ' — УЧЕБНЫЙ ОТЗЫВ (проверка процедуры; партии не блокировались, склад не менялся)' : '') + '</td></tr>' +
    '<tr><th>Основание</th><td>' + E(c.basis) + (c.basisDoc ? ' — ' + E(c.basisDoc) : '') + '</td></tr><tr><th>Опасность / несоответствие</th><td>' + E(c.hazard) + '</td></tr>' +
    (c.legal ? '<tr><th>Правовая категория</th><td>' + E(c.legal) + '</td></tr>' : '') +
    '<tr><th>Описание</th><td>' + E(c.description) + '</td></tr><tr><th>Охват</th><td>' + E(c.scopeText) + '</td></tr>' +
    (c.drill ? '' : '<tr><th>Место изоляции</th><td>' + E(c.place) + '</td></tr>') +
    '<tr><th>Открыт</th><td>' + E(c.openedAt) + ' — ' + E(c.openedBy) + (c.openedRole ? ', ' + E(c.openedRole) : '') + '</td></tr>' +
    '<tr><th>Закрыт</th><td>' + E(c.closedAt) + ' — ' + E(c.closedBy) + '</td></tr></table>';
  h += '<h2>1. Затронутые партии</h2><table class="r"><tr><th>Партия</th><th>Продукт</th><th>Роль и путь</th><th>Поставщик, партия изготовителя</th><th class="n">Получено</th><th class="n">Остаток при открытии</th><th>Решение</th><th>Документ, способ, акт</th></tr>';
  c.batches.forEach(function (b) {
    h += row([b.batchId, b.product, b.roleText + (b.role === 'DERIVED' ? ': ' + b.path : ''), [b.supplier, b.lot].filter(String).join(', '), b.received === null ? '' : b.received + ' ' + b.unit,
      b.remainAtOpen === null ? '' : b.remainAtOpen + ' ' + b.unit, c.drill ? '—' : (b.decisionText || 'не принято') + (b.decidedBy ? ' (' + b.decidedBy + ', ' + b.decidedAt + ')' : ''),
      [b.releaseGround, b.disposal, b.doc, b.basis, b.actId ? 'акт ' + b.actId : '', b.disinfection ? 'обеззараживание: ' + b.disinfection : '', b.expertise ? 'экспертиза: ' + b.expertise : ''].filter(String).join('; ')]);
  });
  h += '</table><h2>2. Куда ушла продукция и уведомления</h2><table class="r"><tr><th>Вид</th><th>Получатель</th><th>Через партию</th><th>Что</th><th class="n">Кол-во</th><th>Дата</th><th>Уведомление</th></tr>';
  c.recipients.forEach(function (x) {
    h += row([x.typeText, x.to + (x.contact ? ' (' + x.contact + ')' : ''), x.batchId, x.what, x.qty === null ? '' : x.qty + ' ' + x.unit, x.at,
      (x.notified ? x.method + ': ' + x.content + ' — ' + x.notifiedBy + ', ' + x.notifiedAt : x.notRequired ? 'не требуется: ' + x.notRequired : x.need ? 'НЕ УВЕДОМЛЁН' : '—') + (x.response ? '. Ответ: ' + x.response : '')]);
  });
  h += '</table><h2>3. Баланс прослеживания</h2><table class="r"><tr><th>Партия</th><th>Продукт</th><th class="n">Получено</th><th class="n">Остаток</th><th class="n">Прослежено выбытие</th><th class="n">Учтено, %</th></tr>';
  c.balance.forEach(function (x) { h += row([x.batchId, x.product, x.received + ' ' + x.unit, x.remain + ' ' + x.unit, x.traced + ' ' + x.unit, x.pct === null ? '—' : x.pct]); });
  h += '</table>' + (c.warnings.length ? '<div class="bad">' + c.warnings.map(E).join('<br>') + '</div>' : '');
  h += '<h2>4. Причина, меры, заключение</h2><table class="r"><tr><th style="width:28%">Причина несоответствия</th><td>' + E(c.cause) + '</td></tr><tr><th>Принятые меры</th><td>' + E(c.measures) +
    '</td></tr><tr><th>Заключение</th><td>' + E(c.conclusion) + '</td></tr>' + (c.minutes !== null && c.minutes !== undefined ? '<tr><th>Длительность (открыт → закрыт)</th><td>' + E(c.minutes) + ' мин</td></tr>' : '') + '</table>';
  h += '<h2>5. Хронология</h2><table class="r"><tr><th>Время</th><th>Действие</th><th>Подробно</th><th>Сотрудник</th></tr>';
  c.log.forEach(function (l) { h += row([l.at, l.action, l.details, l.who + (l.role ? ', ' + l.role : '')]); });
  h += '</table><h3>Основания</h3><div class="muted">' + MC_V74_LAW_.map(function (l) { return E(l[0]) + ' — ' + E(l[1]); }).join('<br>') +
    '<br>Сроки и форма уведомлений в этих текстах не установлены — их задаёт предприятие («Порядок отзыва»).</div>';
  h += '<div class="sign">Ответственный за ХАССП: ____________________ / ' + E(c.closedBy) + '<br><br>Руководитель: ____________________ / ____________________</div>';
  return h;
}
/** json: {recallId, cause, measures, conclusion} */
function v74Close(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V74_DECIDE_, 'RECALL_CLOSE', 'Отзыв продукции', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = {}; try { d = JSON.parse(json || '{}') || {}; } catch (e) {}
    var cause = String(d.cause || '').trim(), measures = String(d.measures || '').trim(), concl = String(d.conclusion || '').trim();
    return _withLock_(function () {
      var r = _v74Find_(d.recallId); if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Отзыв не найден', op.id); }
      if (String(r['Статус']) !== 'OPEN') { _endOp_(op, 'FAILED'); return _fail_('RECALL_STATE', 'Отзыв не открыт', op.id); }
      var c = _v74Card_(r), drill = c.drill;
      var resp = drill ? '' : _v74Responsible_(op); if (resp) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', resp, op.id); }
      if (c.todo.length) { _endOp_(op, 'FAILED'); return _fail_('RECALL_INCOMPLETE', 'Отзыв не закрыт, осталось: ' + c.todo.join('; '), op.id); }
      if (concl.length < 10 || (!drill && (cause.length < 5 || measures.length < 5))) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', drill ? 'Напишите заключение по учебному отзыву: что сработало, что исправить' : 'Заполните причину несоответствия, принятые меры и заключение', op.id); }
      var who = _author_(op), now = new Date();
      var opened = r['Открыт'] instanceof Date ? r['Открыт'] : _mcBlDate_(r['Открыт']), mins = opened ? Math.max(0, Math.round((now.getTime() - opened.getTime()) / 60000)) : '';
      _v74Set_('R', r._row, { 'Статус': 'CLOSED', 'Закрыт': now, 'Закрыл': who.фио, 'Причина несоответствия': cause, 'Принятые меры': measures, 'Заключение': concl, 'Длительность, мин': mins });
      _v74Log_(op, r.RecallID, drill ? 'Учебный отзыв закрыт' : 'Отзыв закрыт', 'прослежено в среднем ' + (c.tracedPct === null ? '—' : c.tracedPct + ' %') + '; длительность ' + mins + ' мин; ' + concl.slice(0, 200));
      var card = _v74Card_(_v74Find_(r.RecallID)), pdf = null;
      try {
        pdf = _mcPdfSave_((drill ? 'Учебный отзыв продукции ' : 'Отчёт об отзыве продукции ') + card.num, _v74PdfBody_(card), { fileName: 'Отзыв ' + card.num, subtitle: card.basis + (card.basisDoc ? ' — ' + card.basisDoc : '') });
        _v74Set_('R', r._row, { PDF: pdf.fileId, 'PDF SHA-256': pdf.sha256 });
      } catch (pe) { try { _log_('WARN', 'V74 PDF: ' + pe, op.id); } catch (ignore) {} }
      _audit_(op, 'RECALL_CLOSE', 'Отзыв продукции', r.RecallID, { status: 'OPEN' }, { status: 'CLOSED', pdf: pdf ? pdf.sha256 : '', traced: card.tracedPct });
      _endOp_(op);
      card = _v74Card_(_v74Find_(r.RecallID)); if (pdf) card.pdf = { fileId: pdf.fileId, url: pdf.url, sha256: pdf.sha256 };
      return _ok_(card, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Отменить отзыв, открытый по ошибке (пока нет возвратов и уничтожений): блокировки снимаются, прежние статусы восстанавливаются. */
function v74Cancel(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V74_DECIDE_, 'RECALL_CANCEL', 'Отзыв продукции', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = {}; try { d = JSON.parse(json || '{}') || {}; } catch (e) {}
    var reason = String(d.reason || '').trim();
    if (reason.length < 5) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Напишите причину отмены', op.id); }
    return _withLock_(function () {
      var r = _v74Find_(d.recallId); if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Отзыв не найден', op.id); }
      if (String(r['Статус']) !== 'OPEN') { _endOp_(op, 'FAILED'); return _fail_('RECALL_STATE', 'Отзыв не открыт', op.id); }
      var resp = _v74Drill_(r) ? '' : _v74Responsible_(op); if (resp) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', resp, op.id); }
      var rows = _v74Rows_('B', r.RecallID);
      if (rows.some(function (x) { return x['Решение'] === 'RETURN' || x['Решение'] === 'DESTROY'; })) { _endOp_(op, 'FAILED'); return _fail_('RECALL_STATE', 'По отзыву уже были возврат или уничтожение — отменить нельзя, закройте отзыв с заключением', op.id); }
      var who = _author_(op), n = 0;
      rows.forEach(function (x) {
        if (!x.BlockID || x['Решение']) return;
        _v74CloseBlock_(x.BlockID, 'RELEASED', who.фио, 'отзыв ' + r['Номер'] + ' отменён: ' + reason);
        var st = _v74Restore_(String(x.BatchID), String(x['Статус до'] || ''));
        _mcBlEvent_(op, x.BatchID, 'BATCH_RELEASE', { reason: 'Отзыв ' + r['Номер'] + ' отменён: ' + reason, before: { status: 'blocked' }, after: { status: st } });
        _v74Set_('B', x._row, { 'Решение': 'CANCELLED', 'Решил': who.фио, 'Решено': new Date(), OperationID: op.id }); n++;
      });
      _v74Set_('R', r._row, { 'Статус': 'CANCELLED', 'Отменён': new Date(), 'Причина отмены': reason, 'Закрыл': who.фио });
      _v74Log_(op, r.RecallID, 'Отзыв отменён', reason + '; снято блокировок: ' + n);
      _audit_(op, 'RECALL_CANCEL', 'Отзыв продукции', r.RecallID, { status: 'OPEN' }, { status: 'CANCELLED', reason: reason, released: n });
      _endOp_(op);
      return _ok_(_v74Card_(_v74Find_(r.RecallID)), op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- руководство и порядок отзыва (ГОСТ Р ИСО 22000-2019 п. 8.9.5, 9.3) ---------------- */
var MC_V74_TOP_ = 'haccp_approve';   // высшее руководство — директор
/** Сведения об отзыве переданы и рассмотрены руководством. json: {recallId, decisions} */
function v74Review(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V74_TOP_, 'RECALL_REVIEW', 'Отзыв продукции', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = {}; try { d = JSON.parse(json || '{}') || {}; } catch (e) {}
    var dec = String(d.decisions || '').trim();
    if (dec.length < 5) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Запишите решения и действия руководства: что улучшить, что изменить в системе (п. 9.3.3)', op.id); }
    return _withLock_(function () {
      var r = _v74Find_(d.recallId); if (!r) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Отзыв не найден', op.id); }
      if (String(r['Статус']) !== 'CLOSED') { _endOp_(op, 'FAILED'); return _fail_('RECALL_STATE', 'Руководству передаётся закрытый отзыв', op.id); }
      if (r['Рассмотрено руководством']) { _endOp_(op, 'FAILED'); return _fail_('RECALL_STATE', 'Уже рассмотрено: ' + _v74Fmt_(r['Рассмотрено руководством']) + ', ' + r['Рассмотрел'], op.id); }
      var who = _author_(op);
      _v74Set_('R', r._row, { 'Рассмотрено руководством': new Date(), 'Рассмотрел': who.фио + (who.должность ? ', ' + who.должность : ''), 'Решения руководства': dec });
      _v74Log_(op, r.RecallID, 'Рассмотрено руководством', dec);
      _audit_(op, 'RECALL_REVIEW', 'Отзыв продукции', r.RecallID, null, { decisions: dec });
      _endOp_(op);
      return _ok_(_v74Card_(_v74Find_(r.RecallID)), op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Порядок отзыва предприятия: ответственные, орган контроля, порядок и сроки уведомлений, периодичность учебного отзыва. Назначает руководство. */
function v74SaveSettings(json, token) {
  var op = null;
  try { op = _beginOp_(token, MC_V74_TOP_, 'RECALL_SETTINGS', 'Отзыв продукции', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = {}; try { d = JSON.parse(json || '{}') || {}; } catch (e) {}
    var staff = []; try { staff = JSON.parse(getEmployees() || '[]').filter(function (e) { return e.active !== false; }); } catch (e) {}
    var names = Array.isArray(d.responsible) ? d.responsible.map(function (x) { return String(x && x.name || x || '').trim(); }).filter(String) : [];
    var bad = names.filter(function (n) { return !staff.some(function (e) { return _v74Lo_(e.name) === _v74Lo_(n); }); });
    if (bad.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Нет среди действующих сотрудников: ' + bad.join(', '), op.id); }
    var months = d.drillMonths === '' || d.drillMonths === null || d.drillMonths === undefined ? '' : _v74N_(d.drillMonths);
    if (months !== '' && !(months > 0 && months <= 60)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Периодичность учебного отзыва — число месяцев от 1 до 60 или пусто', op.id); }
    return _withLock_(function () {
      var who = _author_(op), now = new Date(), have = {}, before = _v74Settings_();
      _v74Rows_('S').forEach(function (r) { have[String(r['Ключ'])] = r._row; });
      var vals = { responsible: JSON.stringify(names.map(function (n) { var e = staff.filter(function (x) { return _v74Lo_(x.name) === _v74Lo_(n); })[0]; return { name: e.name, position: e.position || '' }; })),
        authority: String(d.authority || '').trim(), notifyOrder: String(d.notifyOrder || '').trim(), drillMonths: months, isolation: String(d.isolation || '').trim(), retention: String(d.retention || '').trim() };
      Object.keys(vals).forEach(function (k) {
        if (have[k]) _v74Set_('S', have[k], { 'Значение': vals[k], 'Изменил': who.фио, 'Изменено': now });
        else _v74Append_('S', { 'Ключ': k, 'Значение': vals[k], 'Изменил': who.фио, 'Изменено': now });
      });
      _audit_(op, 'RECALL_SETTINGS', 'Отзыв продукции', 'Порядок отзыва', before, vals);
      _endOp_(op);
      return _ok_(_v74Settings_(), op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** PDF «Порядок изъятия (отзыва) продукции» — документированная информация по п. 8.9.5 a–c из настроек предприятия и порядка, который ведёт система. */
function v74ProcedurePdf(token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp|haccp_approve', 'RECALL_PROCEDURE_PDF', 'Отзыв продукции', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var st = _v74Settings_(), E = _mcOrgEsc_, nf = '<span class="bad">не заполнено — задаёт предприятие</span>';
    var li = function (a) { return '<ol>' + a.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>'; };
    var h = '<h2>1. Назначение</h2><div>Порядок своевременного изъятия из обращения (отзыва) несоответствующей, опасной и некачественной пищевой продукции, сырья и полуфабрикатов собственного производства, ' +
      'обращения с изъятой продукцией и уведомления заинтересованных сторон. Записи ведутся в MON CHEF: ХАССП → «Отзыв продукции».</div>';
    h += '<h2>2. Ответственные (назначает руководство)</h2>' + (st.responsible.length ? li(st.responsible.map(function (x) { return E(x.name) + (x.position ? ', ' + E(x.position) : ''); })) +
      '<div class="muted">Открывают отзыв, принимают решения по партиям, закрывают и отменяют — только они и руководство.</div>' : '<div>' + nf + ' (ГОСТ Р ИСО 22000-2019 п. 8.9.5)</div>');
    h += '<h2>3. Когда открывается отзыв</h2>' + li(MC_V74_BASIS_.map(function (x) { return E(x[1]) + (x[2] ? ' — с номером и датой документа' : ''); })) +
      '<div>Несоответствие (29-ФЗ ст. 3 п. 2):</div>' + li(MC_V74_HAZ_.filter(function (x) { return x[2]; }).map(function (x) { return E(x[1]) + ' — ' + E(x[2]) + (x[3] ? ', продукция ' + E(x[3]) : ''); }));
    h += '<h2>4. Последовательность действий</h2>' + li([
      'Определить охват: партии или продукт с уточнением (поставщик, изготовитель, партия изготовителя, даты приёмки); проверить охват — какие партии затронуты и куда ушла продукция.',
      'Открыть отзыв: основание, документ, несоответствие, место изоляции. Все затронутые партии с остатком блокируются сразу и не используются.',
      'Изолировать продукцию в месте изоляции; хранить без доступа посторонних, вести учёт (ТР ТС 021/2011 ст. 18 ч. 3; 29-ФЗ ст. 25 п. 2). Место по умолчанию: ' + (st.isolation ? E(st.isolation) : nf) + '.',
      'Уведомить заинтересованные стороны (п. 5) и записать уведомления и ответы.',
      'По каждой партии принять решение: возврат поставщику с документом; ликвидация по акту — уничтожение или другое назначение (8.9.4.3 b, c); снятие с отзыва — только по документу (8.9.4.2, 8.9.4.3 a). При биологической, химической, физической опасности — обеззараживание перед уничтожением или в процессе (ТР ТС 021/2011 ст. 18 ч. 7; 29-ФЗ ст. 25 п. 3.1). Экспертиза — в случаях, определённых Правительством РФ (29-ФЗ ст. 25 п. 1).',
      'При утилизации по предписанию — документ, подтверждающий утилизацию, в орган, вынесший предписание (ТР ТС 021/2011 ст. 18 ч. 8; 29-ФЗ ст. 25 п. 5).',
      'Закрыть отзыв: причина, меры, заключение, баланс прослеживания → отчёт PDF.',
      'Передать сведения о причине, объёме и результате руководству для анализа (ГОСТ Р ИСО 22000-2019 п. 8.9.5, 9.3.2 e).']);
    h += '<h2>5. Уведомление заинтересованных сторон</h2>' + li(['Поставщик или изготовитель — по каждому поставщику исходных партий.', 'Орган государственного контроля (надзора) — если отзыв по предписанию; контакты: ' + (st.authority ? E(st.authority) : nf) + '.',
      'Заказчики банкетов, которым выдана продукция.', 'Потребители в зале — конечный потребитель не прослеживается (ТР ТС 021/2011 ст. 4); информирование — по решению предприятия.']) +
      '<div><b>Порядок и сроки уведомлений:</b> ' + (st.notifyOrder ? E(st.notifyOrder) : nf) + '</div>';
    h += '<h2>6. Записи</h2><div>Отзыв, партии, решения, уведомления и ответы, хронология — в MON CHEF; отчёт PDF с SHA-256. Срок хранения записей: ' + (st.retention ? E(st.retention) : nf + ' (ГОСТ Р ИСО 22000-2019 п. 8.3 — не меньше срока годности продукции)') + '.</div>';
    h += '<h2>7. Проверка результативности</h2><div>Учебный отзыв (симуляция изъятия, ГОСТ Р ИСО 22000-2019 п. 8.9.5): прослеживание, баланс и получатели без блокировок и изменения склада; заключение и PDF. Периодичность: ' +
      (st.drillMonths ? 'не реже одного раза в ' + E(st.drillMonths) + ' мес.' : nf) + '.</div>';
    h += '<h3>Основания</h3><div class="muted">' + MC_V74_LAW_.map(function (l) { return E(l[0]) + ' — ' + E(l[1]); }).join('<br>') + '</div>';
    h += '<div class="sign">Утверждаю: руководитель ____________________ / ____________________ «___» __________ 20__ г.</div>';
    var pdf = _mcPdfSave_('Порядок изъятия (отзыва) продукции', h, { folder: (typeof _mcFolderSafe_ === 'function' ? _mcFolderSafe_('ppk') : null) || undefined, fileName: 'Порядок отзыва продукции ' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd'),
      subtitle: 'ТР ТС 021/2011 ст. 5, 18; 29-ФЗ ст. 3, 24, 25; ГОСТ Р ИСО 22000-2019 п. 8.9.4, 8.9.5' });
    _audit_(op, 'RECALL_PROCEDURE_PDF', 'Отзыв продукции', 'Порядок отзыва', null, { fileId: pdf.fileId, sha256: pdf.sha256, responsible: st.responsible.length });
    _endOp_(op);
    return _ok_({ fileId: pdf.fileId, url: pdf.url, sha256: pdf.sha256, missing: ['responsible', 'authority', 'notifyOrder', 'drillMonths', 'isolation', 'retention'].filter(function (k) {
      return k === 'responsible' ? !st.responsible.length : !st[k]; }).map(function (k) { return MC_V74_SET_KEYS_[k]; }) }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- главное окно: кнопки разделов, показатель «открытые отзывы» ---------------- */
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  var add = function (sec, extra, kpi) {
    var orig = _UI_BUILDERS_[sec]; if (typeof orig !== 'function') return;
    _UI_BUILDERS_[sec] = function (token, opts, s) {
      var r = orig(token, opts, s) || {}; r.actions = (r.actions || []).concat(extra);
      if (kpi) { try { var n = _v74Rows_('R').filter(function (x) { return String(x['Статус']) === 'OPEN' && !_v74Drill_(x); }).length;
        r.kpis = (r.kpis || []).concat([{ label: 'Открытые отзывы продукции', value: n, tone: n ? 'red' : 'green' }]); } catch (e) {} }
      return r;
    };
  };
  var btn = [{ label: 'Отзыв продукции: прослеживание, блокировка, решения', module: 'recall' }];
  add('haccp', btn, true); add('stock', btn, false);
})();
try { if (MC_UI_VIEWS_.indexOf('recall') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['recall']); } catch (e) {}

/** Миграция, шаг 14: требование об изъятии продукции в реестр требований установленной системы (новая установка получает его сразу). */
var MC_V74_REQ_ = ['REQ-RECALL-001','TRTS_021_2011','ст.5 ч.4; ст.18 чч.3, 4, 7, 8 / 29-ФЗ ст.3, 24, 25 / ГОСТ Р ИСО 22000-2019 п. 8.9.4, 8.9.5','Изъятие из обращения несоответствующей продукции: блокировка, учёт, решение, утилизация','TRACEABILITY',true,'TRACE','RECALL_RECORD+PDF','При выявлении несоответствия','Ответственный за ХАССП',true,'Отзыв продукции (V74): прослеживание вперёд, блокировка, решения, уведомления, PDF'];
var MC_V74_NORM_ = ['FZ_29_2000','LAW','ACTIVE','Федеральный закон от 02.01.2000 № 29-ФЗ','О качестве и безопасности пищевых продуктов','','',true,'http://www.kremlin.ru/acts/bank/14882','Вводится в действие со дня официального опубликования (ст. 30 п. 1). Текст сверен по копии КонсультантПлюс, ред. от 13.07.2020 (сохранена 03.06.2025): ст. 3, 22, 24, 25. Более поздние изменения не сверены.'];
function _v74AddRequirement_() {
  var out = { added: 0, kept: 0, normAdded: 0 };
  var ns = _book_().getSheetByName(typeof MC_V33 !== 'undefined' ? MC_V33.NORM : '');
  if (ns && ns.getLastRow() >= 2) {
    var nv = ns.getDataRange().getValues(), hasN = false;
    for (var j = 1; j < nv.length; j++) if (String(nv[j][0]) === MC_V74_NORM_[0]) hasN = true;
    if (!hasN) { ns.appendRow(MC_V74_NORM_.slice(0, nv[0].length)); out.normAdded = 1; }
  }
  var sh = _book_().getSheetByName(typeof MC_V33 !== 'undefined' ? MC_V33.REQ : '');
  if (!sh || sh.getLastRow() < 2) { out.skipped = 'реестра требований ещё нет — его заполнит первая настройка'; return out; }
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === MC_V74_REQ_[0]) {
    if (String(v[i][2]) !== MC_V74_REQ_[2] && /^ст\.5 ч\.4; ст\.18 чч\.3, 4, 7, 8$/.test(String(v[i][2]))) { sh.getRange(i + 1, 3).setValue(MC_V74_REQ_[2]); out.refUpdated = 1; }   // ссылка сборки 16.11 — дополнить; своя ссылка предприятия не трогается
    out.kept = 1; return out;
  }
  sh.appendRow(MC_V74_REQ_.slice(0, v[0].length)); out.added = 1;
  return out;
}
