/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
/**
 * ЦЕХ Стандарт 2.2 — из ТТК автоматически готовятся изменения ТУ, СТО и ППК (ТЗ 2.2).
 *   ТТК → факты (TTK_SOURCE_FACTS, у каждого — источник и уверенность) → проверка полноты → процессы и опасности →
 *   ККТ (предел только из текста ТТК или утверждённого норматива, иначе REQUIRES_SOURCE) → предпросмотр →
 *   применение (резервная копия, Google Doc + PDF + JSON + hash, связи с источниками, правила событий неактивны) →
 *   утверждение предприятием одной кнопкой (блокируется при BLOCKER и конфликтах) → правила включаются, старые версии — SUPERSEDED.
 * Документы не перезаписываются: каждое изменение — новая версия. Повторный запуск по той же версии ТТК не создаёт дублей.
 */
var TS2_GEN_CONF_ = { AUTO: 0.95, REVIEW: 0.80, CONFIRM: 0.50 };
// словарь операций: код → [признаки в тексте технологии, название процесса, ККТ?]
var TS2_OPS_ = [
  ['DEFROST', /размор|дефрост/i, 'Размораживание', false],
  ['WASH', /промы|мыть|моют|замачив/i, 'Мойка / подготовка сырья', false],
  ['MECHANICAL', /нарез|нареж|измельч|фарш|шинку|очист|разделк|натир/i, 'Механическая обработка', false],
  ['MARINATE', /маринов/i, 'Маринование', false],
  ['FRYING', /обжар|жар(ят|ить|ь)|фритюр/i, 'Жарка', true],
  ['THERMAL', /вар(ят|ить|ка|и)|отвар|запек|запеч|туш(ат|ить|ение)|бланш|припуск|су-вид|sous|пассер|выпек|кипят|довест/i, 'Тепловая обработка', true],
  ['COOLING', /охлад|охлажд|шоков/i, 'Охлаждение', true],
  ['REHEAT', /разогр|регенер/i, 'Разогрев', true],
  ['ASSEMBLY', /собир|сборк|порцион|выклад|оформ|подав|отпуск/i, 'Порционирование и сборка', false],
  ['STORAGE', /хран/i, 'Хранение готовой продукции', false]
];
// опасности по типу операции (мастер-справочник поставщика; утверждается предприятием в составе плана ХАССП)
var TS2_MASTER_HAZARDS_ = {
  DEFROST: [['B', 'Рост патогенной микрофлоры при нарушении режима размораживания', 'MH-B-DEFROST']],
  WASH: [['P', 'Посторонние включения (песок, остатки упаковки)', 'MH-P-WASH'], ['B', 'Перекрёстное загрязнение сырья', 'MH-B-CROSS']],
  MECHANICAL: [['P', 'Металлические и иные посторонние примеси', 'MH-P-METAL'], ['B', 'Перекрёстное загрязнение через инвентарь', 'MH-B-CROSS']],
  MARINATE: [['B', 'Рост микрофлоры при нарушении температуры маринования', 'MH-B-MARINATE']],
  FRYING: [['B', 'Выживание патогенов при недостаточной прожарке', 'MH-B-THERMAL'], ['C', 'Продукты окисления фритюрного жира', 'MH-C-OIL']],
  THERMAL: [['B', 'Выживание патогенных микроорганизмов при недостаточной тепловой обработке', 'MH-B-THERMAL']],
  COOLING: [['B', 'Прорастание спор и рост микрофлоры при медленном охлаждении', 'MH-B-COOLING']],
  REHEAT: [['B', 'Выживание микрофлоры при недостаточном разогреве', 'MH-B-REHEAT']],
  ASSEMBLY: [['B', 'Повторное обсеменение готовой продукции (руки, инвентарь)', 'MH-B-RECONT'], ['A', 'Перекрёстный контакт с аллергенами', 'MH-A-CROSS']],
  STORAGE: [['B', 'Рост микрофлоры при нарушении температуры и сроков хранения', 'MH-B-STORAGE']]
};
var TS2_OP_JOURNAL_ = { FRYING: 'J-KKT-THERMAL', THERMAL: 'J-KKT-THERMAL', COOLING: 'J-COOLING', REHEAT: 'J-REHEAT', DEFROST: 'J-DEFROST', STORAGE: 'J-STORAGE-T' };
var TS2_OP_EVENT_ = { FRYING: 'PRODUCTION_RELEASE', THERMAL: 'PRODUCTION_RELEASE', COOLING: 'COOLING_FINISHED', REHEAT: 'REHEAT_FINISHED', DEFROST: 'DEFROST_FINISHED' };

/* ------------------------------------------------------------------ этап 1–2: факты ТТК */
function _ts2GenFacts_(code) {
  var d = _ts2Dishes_().filter(function (x) { return x.code === String(code); })[0];
  if (!d) throw new Error('NOT_FOUND: ТТК ' + code + ' не найдена');
  var F = [], add = function (field, raw, norm, unit, conf, src, method) { F.push({ fieldCode: field, rawValue: raw === undefined ? '' : raw, normalizedValue: norm === undefined ? '' : norm, unit: unit || '', confidence: conf, sourceText: String(src || '').slice(0, 400), extractionMethod: method || 'TABLE' }); };
  add('name', d.name, d.name, '', 1, 'Блюда!B' + d._row);
  if (d.category) add('category', d.category, d.category, '', 1, 'Блюда!C' + d._row);
  if (d.workshop) add('workshop', d.workshop, d.workshop, '', 1, 'Блюда!I' + d._row);
  var y = _ts2Num_(d.yield); if (y) add('yield', d.yield, y, String(d.yield).replace(/[\d.,\s]/g, '') || 'г', 1, 'Блюда!D' + d._row);
  d.comp.forEach(function (c, i) { add('ingredient.' + (i + 1), c.name + ' ' + c.qty + ' ' + c.unit, JSON.stringify({ name: c.name, qty: c.qty, unit: c.unit, netto: c.netto }), c.unit, 1, 'Состав, ' + d.code + ' строка ' + (i + 1)); });
  if (d.method) add('technology', d.method.slice(0, 2000), d.method, '', 1, 'Блюда!F' + d._row);
  if (d.shelfHours !== '' && d.shelfHours !== null && d.shelfHours !== undefined && _ts2Num_(d.shelfHours)) add('shelfLifeHours', d.shelfHours, _ts2Num_(d.shelfHours), 'ч', 1, 'Блюда, «Срок реализации (ч)»');
  var txt = String(d.method || '');
  // срок годности, указанный в тексте технологии
  var sm = /(?:срок\s+(?:реализации|годности|хранения)[^.\d]{0,40})(\d+(?:[.,]\d+)?)\s*(час|ч\b|сут|дн)/i.exec(txt);
  if (sm) { var h = parseFloat(sm[1].replace(',', '.')) * (/сут|дн/i.test(sm[2]) ? 24 : 1); add('shelfLifeText', sm[0], h, 'ч', 0.9, sm[0], 'TEXT_RULE'); }
  // условия хранения: «при t от +2 до +6 °C», «+2…+6»
  var st = /хран[^.]{0,60}?(?:при\s*)?(?:t\s*|температуре\s*)?(?:от\s*)?([+-]?\d+)\s*(?:°\s*C|°С|°)?\s*(?:до|…|\.\.\.|-|–)\s*([+-]?\d+)\s*(?:°\s*C|°С|°)?/i.exec(txt);
  if (st) add('storageConditions', st[0], JSON.stringify({ min: Number(st[1]), max: Number(st[2]) }), '°C', 0.9, st[0], 'TEXT_RULE');
  // операции и пределы
  var sentences = txt.split(/(?<=[.;!?\n])\s*/);
  TS2_OPS_.forEach(function (op) {
    var s = sentences.filter(function (x) { return op[1].test(x); });
    if (!s.length) return;
    add('operation.' + op[0], s[0], op[0], '', 0.9, s.join(' ').slice(0, 400), 'DICTIONARY');
    if (op[3]) s.forEach(function (x) {
      var m = /(?:в\s+толще|внутри|центр[еа]?\s+продукта|температур[аы]?)[^.]{0,40}?(не\s+(?:ниже|менее|выше|более)|до|≥|>=|≤|<=)\s*([+-]?\d+(?:[.,]\d+)?)\s*(?:°\s*C|°С|°)/i.exec(x);
      if (m) add('limit.' + op[0], m[0], JSON.stringify({ op: /ниже|менее|≥|>=/.test(m[1]) || (/до/.test(m[1]) && op[0] !== 'COOLING') ? '>=' : '<=', value: parseFloat(m[2].replace(',', '.')) }), '°C', 0.95, x, 'TEXT_RULE');
      var t = /(?:в\s+течение|не\s+более|за)\s*(\d+)\s*(мин|час|ч\b)/i.exec(x);
      if (t && op[0] === 'COOLING') add('limitTime.' + op[0], t[0], (/час|ч/.test(t[2]) ? Number(t[1]) * 60 : Number(t[1])), 'мин', 0.9, x, 'TEXT_RULE');
    });
  });
  var allergens = []; d.comp.forEach(function (c) { var n = _ts2NormName_(c.name);
    [['молок|сливк|сыр|творог|масло слив|сметан|кефир', 'молоко'], ['яйц|яичн', 'яйца'], ['мук|пшенич|хлеб|панир|макарон', 'глютен'], ['орех|миндал|фундук|кешью|фисташ', 'орехи'], ['арахис', 'арахис'], ['соя|соев', 'соя'], ['рыб|лосос|сёмг|семг|треск|тунец', 'рыба'], ['кревет|краб|мидии|кальмар', 'ракообразные/моллюски'], ['горчиц', 'горчица'], ['кунжут', 'кунжут'], ['сельдер', 'сельдерей']].forEach(function (a) { if (new RegExp(a[0]).test(n) && allergens.indexOf(a[1]) < 0) allergens.push(a[1]); }); });
  if (allergens.length) add('allergens', allergens.join(', '), JSON.stringify(allergens), '', 0.85, 'по составу (словарь аллергенов)', 'DICTIONARY');
  var hash = _ts2Sha_(JSON.stringify([d.code, d.name, d.category, d.yield, d.method, d.shelfHours, d.workshop, d.comp]));
  return { dish: d, facts: F, ttkVersionId: d.code + '@' + hash.slice(0, 12), hash: hash, allergens: allergens };
}

/* ------------------------------------------------------------------ этап 3–6: полнота, процессы, опасности, ККТ */
function _ts2GenAnalyze_(code, types) {
  var x = _ts2GenFacts_(code), f = {}, issues = [], d = x.dish;
  x.facts.forEach(function (q) { f[q.fieldCode] = q; });
  var issue = function (sev, section, field, msg, cur, req, act, role) { issues.push({ severity: sev, sectionCode: section, fieldCode: field, message: msg, currentValue: cur || '', requiredValue: req || '', suggestedAction: act || '', status: 'OPEN', assignedRole: role || 'Шеф-повар' }); };
  if (!f.yield) issue('BLOCKER', 'TTK', 'yield', 'В ТТК не указан выход', '', 'выход готового блюда, г', 'Заполните выход в карточке ТТК');
  if (!d.comp.length) issue('BLOCKER', 'TTK', 'composition', 'В ТТК нет состава', '', 'рецептура', 'Заполните состав');
  if (!f.technology) issue('MAJOR', 'STO', 'technology', 'Нет описания технологии — процессы не определены', '', 'текст технологии', 'Добавьте технологию приготовления');
  if (!f.shelfLifeHours && !f.shelfLifeText) issue('MAJOR', 'TU', 'shelfLife', 'Срок годности не указан — система не подставляет его сама (REQUIRES_SOURCE)', '', 'срок по документам изготовителя, ТТК или лабораторному обоснованию (СанПиН 2.3/2.4.4282-26 сроки не устанавливает)', 'Укажите срок и основание', 'Ответственный за ХАССП');
  if (f.shelfLifeHours && f.shelfLifeText && Number(f.shelfLifeHours.normalizedValue) !== Number(f.shelfLifeText.normalizedValue))
    issue('CONFLICT', 'TU', 'shelfLife', 'CONFLICT_SHELF_LIFE: срок в карточке (' + f.shelfLifeHours.normalizedValue + ' ч) не совпадает со сроком в тексте технологии (' + f.shelfLifeText.normalizedValue + ' ч)', f.shelfLifeHours.normalizedValue, f.shelfLifeText.normalizedValue, 'Выберите верный срок', 'Ответственный за ХАССП');
  if (!f.storageConditions) issue('MAJOR', 'TU', 'storageConditions', 'Условия хранения не найдены в ТТК (REQUIRES_SOURCE)', '', 'температурный режим хранения', 'Укажите условия хранения в технологии', 'Ответственный за ХАССП');
  if (!f.category) issue('MINOR', 'TU', 'category', 'Не указана категория — группа ТУ определяется как «Прочая продукция»', '', 'категория', 'Укажите категорию');
  // дубликаты ТТК: то же нормализованное название под другим кодом
  _ts2Dishes_().forEach(function (o) { if (o.code !== d.code && _ts2NormName_(o.name) === _ts2NormName_(d.name)) issue('CONFLICT', 'TTK', 'duplicate', 'CONFLICT_DUPLICATE_TTK: ТТК с тем же названием — ' + o.code, o.code, '', 'Архивируйте дубликат или переименуйте', 'Шеф-повар'); });
  var ops = TS2_OPS_.filter(function (op) { return f['operation.' + op[0]]; });
  var processes = [], hazards = [], controls = [];
  ops.forEach(function (op, i) {
    var p = { key: op[0], processCode: d.code + '-' + op[0], name: op[2] + ' — ' + d.name, operationOrder: i + 1, sourceText: f['operation.' + op[0]].sourceText };
    processes.push(p);
    (TS2_MASTER_HAZARDS_[op[0]] || []).forEach(function (h) { hazards.push({ process: op[0], hazardType: h[0], description: h[1], masterHazardCode: h[2], confidence: 0.9, basis: 'мастер-справочник опасностей ' + TS2_SCHEMA_VERSION + '; операция найдена в тексте ТТК' }); });
    if (op[0] === 'ASSEMBLY' && !x.allergens.length) hazards = hazards.filter(function (h) { return !(h.process === 'ASSEMBLY' && h.hazardType === 'A'); });
    if (op[3]) {
      var lim = f['limit.' + op[0]], lt = f['limitTime.' + op[0]], L = lim ? _ts2Json_(lim.normalizedValue, {}) : null;
      var c = { process: op[0], name: 'ККТ: ' + op[2].toLowerCase() + ' — ' + d.name, isCcp: true, journalCode: TS2_OP_JOURNAL_[op[0]] || 'J-KKT', eventType: TS2_OP_EVENT_[op[0]] || 'PRODUCTION_RELEASE',
        criticalLimit: L ? 't° ' + (L.op === '>=' ? 'не ниже ' : 'не выше ') + L.value + ' °C' + (lt ? ', за ' + lt.normalizedValue + ' мин' : '') : '',
        limitSource: L ? 'ТТК ' + d.code + ': «' + lim.rawValue + '»' : 'REQUIRES_SOURCE', monitoringMethod: 'термощуп, каждая партия', frequency: 'каждая партия', responsibleRole: d.workshop ? 'Повар (' + d.workshop + ')' : 'Повар',
        correctiveAction: op[0] === 'COOLING' ? 'Продукт не реализуется; оценка ответственным за ХАССП, утилизация по акту' : 'Продолжить обработку до достижения предела; повторный замер; при невозможности — списание по акту',
        status: L ? 'AUTO_PREPARED' : 'REQUIRES_SOURCE', confidence: L ? lim.confidence : 0 };
      controls.push(c);
      if (!L) issue('MAJOR', 'PPK', 'ccpLimit.' + op[0], 'Для ККТ «' + op[2] + '» в ТТК не найден критический предел — система не подставляет число (REQUIRES_SOURCE)', '', 'предел из ТТК или утверждённого норматива', 'Добавьте в технологию «до температуры в толще не ниже … °C» или утвердите норматив', 'Ответственный за ХАССП');
    }
  });
  if (f.technology && !ops.length) issue('MINOR', 'STO', 'operations', 'В технологии не распознаны операции — процессы нужно указать вручную', '', '', 'Проверьте текст технологии');
  x.facts.forEach(function (q) { q.status = q.confidence >= TS2_GEN_CONF_.AUTO ? 'ACCEPTED' : q.confidence >= TS2_GEN_CONF_.REVIEW ? 'REVIEW' : q.confidence >= TS2_GEN_CONF_.CONFIRM ? 'REQUIRES_CONFIRMATION' : 'REJECTED'; q.requiresReview = q.status !== 'ACCEPTED'; });
  var lab = false; try { lab = !!_tsPlanFeatures_(_tsLicense_(false).plan).lab; } catch (e) { lab = true; }
  types = (types && types.length ? types : ['TU', 'STO', 'PPK']).filter(function (t) { return t !== 'TU' || lab; });
  return { code: d.code, name: d.name, ttkVersionId: x.ttkVersionId, hash: x.hash, facts: x.facts, issues: issues, processes: processes, hazards: hazards, controls: controls, types: types, tuSkipped: !lab, allergens: x.allergens, dish: d, f: f };
}

/* ------------------------------------------------------------------ предпросмотр (ничего не создаёт, кроме задания и фактов) */
function _ts2GenPreview_(code, types) {
  _ts2EnsureSchema_(false);
  var a = _ts2GenAnalyze_(code, types);
  var same = _ts2Rows_('DOCUMENT_GENERATION_JOBS', function (j) { return j.ttkVersionId === a.ttkVersionId && ['PREVIEW', 'APPLIED', 'APPROVED'].indexOf(j.status) >= 0; }).pop();
  if (same) return _ts2GenCard_(same.generationJobId, true);
  var job = _ts2Id_('DOCUMENT_GENERATION_JOBS'), now = _ts2Iso_(), ent = _ts2Ent_();
  _ts2InsertMany_('TTK_SOURCE_FACTS', a.facts.map(function (q) { return { sourceFactId: _ts2Id_('TTK_SOURCE_FACTS'), enterpriseId: ent, ttkId: a.code, ttkVersionId: a.ttkVersionId, fieldCode: q.fieldCode, rawValue: String(q.rawValue).slice(0, 2000),
    normalizedValue: String(q.normalizedValue).slice(0, 2000), unit: q.unit, confidence: q.confidence, sourceFileId: '', sourcePage: '', sourceText: q.sourceText, extractionMethod: q.extractionMethod, status: q.status, requiresReview: q.requiresReview, createdAt: now }; }));
  _ts2InsertMany_('DOCUMENT_GENERATION_ISSUES', a.issues.map(function (i) { return Object.assign({ issueId: _ts2Id_('DOCUMENT_GENERATION_ISSUES'), generationJobId: job, enterpriseId: ent, resolvedBy: '', resolvedAt: '' }, i); }));
  var items = [];
  a.types.forEach(function (t) {
    a.facts.forEach(function (q) { items.push({ generationItemId: _ts2Id_('DOCUMENT_GENERATION_ITEMS'), generationJobId: job, documentType: t, sectionCode: q.fieldCode.split('.')[0], fieldCode: q.fieldCode, value: String(q.normalizedValue).slice(0, 500), sourceType: 'TTK_FACT', sourceId: a.code + ':' + q.fieldCode, confidence: q.confidence, status: q.status, requiresApproval: true, issueId: '' }); });
    a.controls.forEach(function (c) { if (t !== 'TU') items.push({ generationItemId: _ts2Id_('DOCUMENT_GENERATION_ITEMS'), generationJobId: job, documentType: t, sectionCode: 'CCP', fieldCode: c.process, value: c.criticalLimit || 'REQUIRES_SOURCE', sourceType: c.criticalLimit ? 'TTK_TEXT' : 'NONE', sourceId: c.limitSource, confidence: c.confidence, status: c.status, requiresApproval: true, issueId: '' }); });
  });
  _ts2InsertMany_('DOCUMENT_GENERATION_ITEMS', items);
  _ts2Insert_('DOCUMENT_GENERATION_JOBS', { generationJobId: job, enterpriseId: ent, ttkVersionId: a.ttkVersionId, generationType: a.types.join('+'), profileId: 'TTK_TO_TU_STO_PPK@' + TS2_SCHEMA_VERSION, status: 'PREVIEW', startedAt: now, completedAt: '',
    requestedBy: _ts2Actor_().name, backupId: '', createdDocumentCount: 0, createdIssueCount: a.issues.length, createdRuleCount: 0, errorMessage: '', reportFileId: '', ttkId: a.code,
    summaryJson: JSON.stringify({ name: a.name, processes: a.processes, hazards: a.hazards, controls: a.controls, allergens: a.allergens, types: a.types, tuSkipped: a.tuSkipped, hash: a.hash }) });
  _ts2Audit_('GENERATION_PREVIEW', 'TTK', a.code, undefined, { job: job, issues: a.issues.length }, '');
  return _ts2GenCard_(job, false);
}
function _ts2GenCard_(job, existing) {
  var j = _ts2Find_('DOCUMENT_GENERATION_JOBS', 'generationJobId', job); if (!j) throw new Error('NOT_FOUND: задание генерации не найдено');
  var s = _ts2Json_(j.summaryJson, {}), iss = _ts2Rows_('DOCUMENT_GENERATION_ISSUES', function (i) { return i.generationJobId === job; });
  var facts = _ts2Rows_('TTK_SOURCE_FACTS', function (q) { return q.ttkVersionId === j.ttkVersionId; });
  var auto = facts.filter(function (q) { return q.status === 'ACCEPTED'; }).length;
  var blocking = iss.filter(function (i) { return i.status === 'OPEN' && (i.severity === 'BLOCKER' || i.severity === 'CONFLICT'); });
  return { job: j, existing: !!existing, name: s.name, ttkId: j.ttkId, ttkVersionId: j.ttkVersionId, types: s.types || [], tuSkipped: s.tuSkipped, processes: s.processes || [], hazards: s.hazards || [], controls: s.controls || [], allergens: s.allergens || [],
    counts: { facts: facts.length, auto: auto, review: facts.length - auto, issues: iss.length, blocking: blocking.length }, issues: iss, facts: facts,
    documents: { tu: _ts2Rows_('TU_DOCUMENTS', function (d) { return d.generationJobId === job; }), sto: _ts2Rows_('STO_DOCUMENTS', function (d) { return d.generationJobId === job; }), ppk: _ts2Rows_('PPK_DOCUMENTS', function (d) { return d.generationJobId === job; }) },
    canApply: j.status === 'PREVIEW' && !iss.some(function (i) { return i.status === 'OPEN' && i.severity === 'BLOCKER'; }), canApprove: j.status === 'APPLIED' && !blocking.length };
}

/* ------------------------------------------------------------------ применение: документы-изменения (не утверждены) */
function _ts2GenDoc_(folderCode, title, sections, meta) {
  var json = JSON.stringify({ title: title, meta: meta, sections: sections, schemaVersion: TS2_SCHEMA_VERSION }), hash = _ts2Sha_(json);
  var out = { fileId: '', pdfFileId: '', jsonFileId: '', hash: hash }, createdDocId = '';
  try {
    var folder = _ts2Folder_(folderCode), doc = DocumentApp.create(title), b = doc.getBody(); createdDocId = doc.getId();
    try { var org = _mcOrg_(); if (org && org.name) b.appendParagraph(org.name + (org.inn ? ', ИНН ' + org.inn : '')).setHeading(DocumentApp.ParagraphHeading.SUBTITLE); } catch (e) {}
    b.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.TITLE);
    b.appendParagraph(meta.statusLine || ('Статус: ПОДГОТОВЛЕНО СИСТЕМОЙ — ТРЕБУЕТ УТВЕРЖДЕНИЯ ПРЕДПРИЯТИЕМ. Версия: ' + meta.version + '. Задание: ' + meta.job + '.') + ' Контрольная сумма: ' + hash.slice(0, 16));
    sections.forEach(function (s) {
      b.appendParagraph(s.title).setHeading(DocumentApp.ParagraphHeading.HEADING2);
      if (s.text) b.appendParagraph(s.text);
      if (s.rows && s.rows.length) b.appendTable([s.head].concat(s.rows.map(function (r) { return r.map(function (v) { return String(v === undefined || v === null ? '' : v); }); })));
    });
    if (meta.footer !== false) b.appendParagraph('Источник каждого значения указан в графе «Источник». Значения с пометкой REQUIRES_SOURCE система не заполняет — их вносит и подтверждает предприятие.');
    b.appendParagraph('Утверждаю: ____________________ / ____________________ /   «___» ____________ 20___ г.');
    doc.saveAndClose();
    var f = DriveApp.getFileById(doc.getId());
    try { f.moveTo(folder); } catch (moveError) { try { f.setTrashed(true); } catch (trashError) {} throw new Error('DOCUMENT_MOVE_FAILED: ' + String(moveError.message || moveError)); }
    if (typeof _tsTenantMode_ === 'function' && _tsTenantMode_()) _tsTenantAssertFileWithin_(doc.getId(), folderCode);
    out.fileId = doc.getId();
    out.pdfFileId = folder.createFile(f.getAs('application/pdf').setName(title + '.pdf')).getId();
    out.jsonFileId = folder.createFile(title + '.json', json, 'application/json').getId();
  } catch (e) { if (createdDocId) { try { DriveApp.getFileById(createdDocId).setTrashed(true); } catch (cleanupError) {} } out.error = String(e && e.message || e); }
  return out;
}
function _ts2GenApply_(job) {
  return _withLock_(function () {
    var j = _ts2Find_('DOCUMENT_GENERATION_JOBS', 'generationJobId', job); if (!j) throw new Error('NOT_FOUND: задание не найдено');
    if (j.status !== 'PREVIEW') return _ts2GenCard_(job, true);                 // идемпотентно
    var iss = _ts2Rows_('DOCUMENT_GENERATION_ISSUES', function (i) { return i.generationJobId === job && i.status === 'OPEN'; });
    if (iss.some(function (i) { return i.severity === 'BLOCKER'; })) throw new Error('VALIDATION: есть блокирующие проблемы ТТК — устраните их и повторите предпросмотр');
    var a = _ts2GenAnalyze_(j.ttkId, String(j.generationType).split('+'));
    if (a.ttkVersionId !== j.ttkVersionId) throw new Error('VALIDATION: ТТК изменилась после предпросмотра — сформируйте предпросмотр заново');
    var backupId = _ts2Backup_('PRE_GENERATION', 'ttk ' + a.code), ent = _ts2Ent_(), now = _ts2Iso_(), actor = _ts2Actor_().name, links = [], created = 0, rules = 0;
    var src = function (field) { var q = a.f[field]; return q ? 'ТТК ' + a.code + ' · ' + q.sourceText.slice(0, 80) + (q.status !== 'ACCEPTED' ? ' (' + q.status + ')' : '') : 'REQUIRES_SOURCE'; };
    var val = function (field, fmt) { var q = a.f[field]; return q ? (fmt ? fmt(q) : String(q.normalizedValue)) : 'REQUIRES_SOURCE'; };
    var link = function (type, id, field, srcType, srcId) { links.push({ linkId: _ts2Id_('DOCUMENT_SOURCE_LINKS'), enterpriseId: ent, targetDocumentType: type, targetDocumentId: id, sourceType: srcType || 'TTK', sourceId: srcId || a.code, sourceField: field, relation: 'DERIVED_FROM', createdAt: now }); };
    // процессы, опасности, ККТ
    var pid = {}, kkt = [];
    a.processes.forEach(function (p) { var id = _ts2Id_('HACCP_PROCESSES_V2'); pid[p.key] = id; _ts2Insert_('HACCP_PROCESSES_V2', { processId: id, enterpriseId: ent, processCode: p.processCode, name: p.name, sourceTtkId: a.code, operationOrder: p.operationOrder, workshopId: a.dish.workshop || '', status: 'REQUIRES_ENTERPRISE_APPROVAL', createdAt: now }); });
    var hz = {}; a.hazards.forEach(function (h) { var id = _ts2Id_('HACCP_HAZARDS_V2'); hz[h.process] = hz[h.process] || id; _ts2Insert_('HACCP_HAZARDS_V2', { hazardId: id, enterpriseId: ent, processId: pid[h.process], hazardType: h.hazardType, description: h.description, masterHazardCode: h.masterHazardCode, confidence: h.confidence, status: 'REQUIRES_ENTERPRISE_APPROVAL', basis: h.basis, createdAt: now }); });
    a.controls.forEach(function (c) { var id = _ts2Id_('HACCP_CONTROLS_V2'); c.id = id; kkt.push(c);
      _ts2Insert_('HACCP_CONTROLS_V2', { controlId: id, enterpriseId: ent, processId: pid[c.process], hazardId: hz[c.process] || '', name: c.name, isCcp: true, criticalLimit: c.criticalLimit || '', limitSource: c.limitSource, monitoringMethod: c.monitoringMethod, frequency: c.frequency,
        responsibleRole: c.responsibleRole, journalCode: c.journalCode, correctiveAction: c.correctiveAction, sourceTtkId: a.code, sourceStoId: '', sourcePpkId: '', status: c.status, createdAt: now }); });
    var ccpRows = kkt.map(function (c) { return [c.name, c.criticalLimit || 'REQUIRES_SOURCE', c.limitSource, c.monitoringMethod, c.journalCode, c.correctiveAction]; });
    var ccpHead = ['ККТ', 'Критический предел', 'Источник', 'Мониторинг', 'Журнал', 'Корректирующее действие'];
    var opRows = a.processes.map(function (p) { return [p.operationOrder, p.name, p.sourceText.slice(0, 160), 'ТТК ' + a.code + ', «Технология»']; });
    var hzRows = a.hazards.map(function (h) { return [h.process, { B: 'биологическая', C: 'химическая', P: 'физическая', A: 'аллерген' }[h.hazardType], h.description, h.basis]; });
    var compRows = a.dish.comp.map(function (c) { return [c.name, c.qty, c.unit, c.netto || '', 'ТТК ' + a.code + ', «Состав»']; });
    var res = { tu: null, sto: null, ppk: null };
    // ТУ — по группе продукции (категория), новая версия при каждом изменении
    if (a.types.indexOf('TU') >= 0) {
      var group = a.dish.category || 'Прочая продукция', prevTu = _ts2Rows_('TU_DOCUMENTS', function (d) { return d.productGroup === group && d.status !== 'SUPERSEDED' && d.status !== 'REJECTED'; }).pop();
      var tuId = _ts2Id_('TU_DOCUMENTS'), tuVer = prevTu ? Number(prevTu.version || 1) + 1 : 1, tuNum = prevTu ? prevTu.tuNumber : 'ТУ ' + _ts2Ent_().slice(-6) + '-' + tuId.slice(-4);
      var tuTitle = 'Изменение ТУ «' + group + '» — ' + a.name + ' (версия ' + tuVer + ')';
      var g = _ts2GenDoc_('GEN_TU', tuTitle, [
        { title: '1. Наименование и область применения', head: ['Поле', 'Значение', 'Источник'], rows: [['Наименование', a.name, src('name')], ['Группа продукции', group, src('category')], ['Выход', val('yield') + ' ' + (a.f.yield ? a.f.yield.unit : ''), src('yield')]] },
        { title: '2. Рецептура', head: ['Сырьё', 'Брутто', 'Ед.', 'Нетто', 'Источник'], rows: compRows },
        { title: '3. Условия и сроки хранения', head: ['Показатель', 'Значение', 'Источник'], rows: [['Срок годности, ч', val('shelfLifeHours', null) !== 'REQUIRES_SOURCE' ? val('shelfLifeHours') : val('shelfLifeText'), a.f.shelfLifeHours ? src('shelfLifeHours') : src('shelfLifeText')],
          ['Условия хранения', val('storageConditions', function (q) { var o = _ts2Json_(q.normalizedValue, {}); return 'от ' + o.min + ' до ' + o.max + ' °C'; }), src('storageConditions')]] },
        { title: '4. Аллергены', head: ['Аллергены', 'Источник'], rows: [[a.allergens.join(', ') || 'не выявлены по составу', 'словарь аллергенов по составу ТТК ' + a.code]] },
        { title: '5. Показатели безопасности', text: 'Микробиологические показатели и порядок лабораторного контроля — по программе производственного контроля и ТР ТС 021/2011. Значения вносит предприятие по протоколам испытаний (REQUIRES_SOURCE).' }
      ], { version: tuVer, job: job, ttk: a.ttkVersionId });
      _ts2Insert_('TU_DOCUMENTS', { tuId: tuId, enterpriseId: ent, tuNumber: tuNum, title: tuTitle, productGroup: group, version: tuVer, status: 'REQUIRES_ENTERPRISE_APPROVAL', sourceTtkIds: a.code, sourceNormIds: '', fileId: g.fileId, validFrom: '', validTo: '', approvedBy: '', approvedAt: '', createdAt: now, generationJobId: job, pdfFileId: g.pdfFileId, hash: g.hash });
      ['name', 'category', 'yield', 'composition', 'shelfLife', 'storageConditions', 'allergens'].forEach(function (fl) { link('TU', tuId, fl); }); res.tu = tuId; created++;
    }
    // СТО — по цеху: новая версия стандарта цеха с добавленной ТТК
    if (a.types.indexOf('STO') >= 0) {
      var wsName = a.dish.workshop || 'Производство', prevSto = _ts2Rows_('STO_DOCUMENTS', function (d) { return d.workshopId === wsName && d.status !== 'SUPERSEDED' && d.status !== 'REJECTED'; }).pop();
      var stoId = _ts2Id_('STO_DOCUMENTS'), stoVer = prevSto ? Number(prevSto.version || 1) + 1 : 1, ttks = prevSto ? String(prevSto.sourceTtkIds).split(',').filter(Boolean) : [];
      if (ttks.indexOf(a.code) < 0) ttks.push(a.code);
      var stoTitle = 'Изменение СТО «' + wsName + '» — ' + a.name + ' (версия ' + stoVer + ')';
      var gs = _ts2GenDoc_('GEN_STO', stoTitle, [
        { title: '1. Технологический процесс', head: ['№', 'Операция', 'Описание', 'Источник'], rows: opRows },
        { title: '2. Опасные факторы', head: ['Операция', 'Тип', 'Опасность', 'Основание'], rows: hzRows },
        { title: '3. Контрольные точки', head: ccpHead, rows: ccpRows },
        { title: '4. ТТК в составе стандарта', text: ttks.join(', ') }
      ], { version: stoVer, job: job, ttk: a.ttkVersionId });
      _ts2Insert_('STO_DOCUMENTS', { stoId: stoId, enterpriseId: ent, stoNumber: prevSto ? prevSto.stoNumber : 'СТО ' + stoId.slice(-6), title: stoTitle, processCode: a.processes.map(function (p) { return p.key; }).join(','), workshopId: wsName, version: stoVer, status: 'REQUIRES_ENTERPRISE_APPROVAL',
        sourceTtkIds: ttks.join(','), sourceEquipmentIds: '', sourceRuleIds: TS2_MASTER_HAZARDS_ ? 'MASTER_HAZARDS@' + TS2_SCHEMA_VERSION : '', fileId: gs.fileId, approvedBy: '', approvedAt: '', createdAt: now, generationJobId: job, pdfFileId: gs.pdfFileId, hash: gs.hash });
      ['technology', 'operations', 'hazards', 'ccp'].forEach(function (fl) { link('STO', stoId, fl); }); res.sto = stoId; created++;
    }
    // ППК — первичная или дополнение по ТТК (новая версия, прежняя не перезаписывается)
    if (a.types.indexOf('PPK') >= 0) {
      var prevPpk = _ts2Rows_('PPK_DOCUMENTS', function (d) { return d.status !== 'SUPERSEDED' && d.status !== 'REJECTED'; }).pop();
      var ppkId = _ts2Id_('PPK_DOCUMENTS'), ppkVer = prevPpk ? Number(prevPpk.version || 1) + 1 : 1, chg = prevPpk ? 'TTK_ADDENDUM' : 'INITIAL';
      // Мастер-промт 4.0, этап 4: единственный генератор ППК — V65; здесь — приложение по ТТК к действующей ППК V65
      var v65 = null; try { if (typeof _v65Objs_ === 'function') v65 = _v65Objs_('PPK').filter(function (x) { return String(x.Status) === 'ACTIVE'; }).pop() || null; } catch (e) {}
      var ppkTitle = 'Приложение к ППК' + (v65 ? ' ' + v65.PPKID + ' (версия ' + v65.Version + ')' : '') + ': ТТК «' + a.name + '» (редакция ' + ppkVer + ')';
      var gp = _ts2GenDoc_('GEN_PPK', ppkTitle, [
        { title: '1. Основание', text: 'Приложение к программе производственного контроля' + (v65 ? ' ' + v65.PPKID + ' «' + (v65.Name || '') + '»' : ' (действующая ППК ещё не введена — раздел «ППК»)') + (chg === 'INITIAL' ? '' : '; заменяет редакцию ' + prevPpk.version + ' (' + prevPpk.ppkId + ')') + ': ТТК ' + a.code + ' «' + a.name + '». Мероприятия по этой ТТК входят в ППК через анализ опасностей (ХАССП).' },
        { title: '2. Критические контрольные точки', head: ccpHead, rows: ccpRows },
        { title: '3. Опасные факторы', head: ['Операция', 'Тип', 'Опасность', 'Основание'], rows: hzRows },
        { title: '4. Журналы и периодичность', head: ['Журнал', 'Периодичность', 'Ответственный'], rows: kkt.map(function (c) { return [c.journalCode, c.frequency, c.responsibleRole]; }) }
      ], { version: ppkVer, job: job, ttk: a.ttkVersionId, base: prevPpk ? prevPpk.ppkId : '' });
      _ts2Insert_('PPK_DOCUMENTS', { ppkId: ppkId, enterpriseId: ent, name: ppkTitle, version: ppkVer, baseVersionId: prevPpk ? prevPpk.ppkId : '', changeType: chg, changeReason: 'ТТК ' + a.ttkVersionId + (v65 ? '; приложение к ППК ' + v65.PPKID : '; действующей ППК нет — приложение войдёт в ППК при её формировании (раздел «ППК»)'), status: 'REQUIRES_ENTERPRISE_APPROVAL', sourceTtkIds: a.code,
        sourceStoIds: res.sto || '', sourceHaccpProcessIds: Object.keys(pid).map(function (k) { return pid[k]; }).join(','), fileId: gp.fileId, approvedBy: '', approvedAt: '', validFrom: '', validTo: '', createdAt: now, generationJobId: job, pdfFileId: gp.pdfFileId, hash: gp.hash });
      ['ccp', 'hazards', 'journals'].forEach(function (fl) { link('PPK', ppkId, fl); }); if (res.sto) link('PPK', ppkId, 'process', 'STO', res.sto); res.ppk = ppkId; created++;
    }
    _ts2InsertMany_('DOCUMENT_SOURCE_LINKS', links);
    // правила событий по ККТ — созданы неактивными до утверждения (ТЗ 2.2 §8)
    kkt.forEach(function (c) {
      var rid = 'EVR-TTK-' + a.code + '-' + c.process; if (_ts2Find_('EVENT_RULES', 'eventRuleId', rid)) return;
      _ts2Insert_('EVENT_RULES', { eventRuleId: rid, enterpriseId: ent, eventType: c.eventType, sourceEntityType: 'PRODUCTION_OUTPUT', sourceEvent: c.eventType, createsRecordType: 'HACCP_FACT', journalCode: c.journalCode, haccpControlPointId: c.id,
        requiredConfirmation: false, measurementMode: 'SENSOR_OR_DERIVED_OR_PENDING', defaultResult: 'RECORDED_FROM_RELEASE', notificationRuleId: 'EXCEPTIONS_ONLY', active: false, version: 1, title: c.name, sourceTtkId: a.code }); rules++;
    });
    _ts2Update_('DOCUMENT_GENERATION_JOBS', 'generationJobId', job, { status: 'APPLIED', completedAt: _ts2Iso_(), backupId: backupId, createdDocumentCount: created, createdRuleCount: rules });
    if (!_ts2Rows_('APPROVAL_QUEUE', function (q) { return q.objectType === 'GENERATION_PACKAGE' && q.objectId === job; }).length)
      _ts2Insert_('APPROVAL_QUEUE', { approvalId: _ts2Id_('APPROVAL_QUEUE'), enterpriseId: ent, objectType: 'GENERATION_PACKAGE', objectId: job, title: 'ТУ/СТО/ППК по ТТК «' + a.name + '»', reason: 'Документы подготовлены системой из ТТК — утвердите одной кнопкой', preparedBySystem: true, requiredRole: 'Ответственный за ХАССП', status: 'PENDING', approvedBy: '', approvedAt: '', comment: '' });
    _ts2Audit_('GENERATION_APPLY', 'GENERATION_JOB', job, { status: 'PREVIEW' }, { status: 'APPLIED', documents: res, rules: rules, backupId: backupId }, 'ТТК ' + a.ttkVersionId);
    return _ts2GenCard_(job, false);
  });
}
/** Проверка перед утверждением пакета: блокирующие проблемы и конфликты не дают утвердить (ТЗ 2.2 §10). */
function _ts2GenCheck_(job) {
  var j = _ts2Find_('DOCUMENT_GENERATION_JOBS', 'generationJobId', job); if (!j) throw new Error('NOT_FOUND: задание не найдено');
  if (j.status !== 'APPLIED') throw new Error('VALIDATION: пакет в статусе ' + j.status);
  var b = _ts2Rows_('DOCUMENT_GENERATION_ISSUES', function (i) { return i.generationJobId === job && i.status === 'OPEN' && (i.severity === 'BLOCKER' || i.severity === 'CONFLICT'); });
  if (b.length) throw new Error('VALIDATION: утверждение заблокировано — ' + b.map(function (i) { return i.message; }).join('; '));
  return j;
}
function _ts2GenApprove_(job) {
  _ts2GenCheck_(job);
  var a = _ts2Actor_(), now = _ts2Iso_(), who = a.name + ' (' + a.role + ')';
  [['TU_DOCUMENTS', 'tuId', 'productGroup'], ['STO_DOCUMENTS', 'stoId', 'workshopId'], ['PPK_DOCUMENTS', 'ppkId', '']].forEach(function (t) {
    _ts2Rows_(t[0], function (d) { return d.generationJobId === job; }).forEach(function (d) {
      _ts2Rows_(t[0], function (o) { return o[t[1]] !== d[t[1]] && o.status === 'APPROVED' && (!t[2] || o[t[2]] === d[t[2]]); }).forEach(function (o) { _ts2Update_(t[0], t[1], o[t[1]], { status: 'SUPERSEDED' }); });
      var patch = { status: 'APPROVED', approvedBy: who, approvedAt: now }; if (t[0] !== 'STO_DOCUMENTS') patch.validFrom = now.slice(0, 10);
      _ts2Update_(t[0], t[1], d[t[1]], patch);
    });
  });
  var ttk = _ts2Find_('DOCUMENT_GENERATION_JOBS', 'generationJobId', job).ttkId;
  _ts2Rows_('EVENT_RULES', function (r) { return r.sourceTtkId === ttk && String(r.active) !== 'true'; }).forEach(function (r) { _ts2Update_('EVENT_RULES', 'eventRuleId', r.eventRuleId, { active: true }); });
  var procs = {}; _ts2Rows_('HACCP_PROCESSES_V2', function (r) { return r.sourceTtkId === ttk && r.status === 'REQUIRES_ENTERPRISE_APPROVAL'; }).forEach(function (r) { procs[r.processId] = true; _ts2Update_('HACCP_PROCESSES_V2', 'processId', r.processId, { status: 'APPROVED' }); });
  _ts2Rows_('HACCP_HAZARDS_V2', function (r) { return procs[r.processId] && r.status === 'REQUIRES_ENTERPRISE_APPROVAL'; }).forEach(function (r) { _ts2Update_('HACCP_HAZARDS_V2', 'hazardId', r.hazardId, { status: 'APPROVED' }); });
  _ts2Rows_('HACCP_CONTROLS_V2', function (c) { return c.sourceTtkId === ttk && c.status === 'AUTO_PREPARED'; }).forEach(function (c) { _ts2Update_('HACCP_CONTROLS_V2', 'controlId', c.controlId, { status: 'APPROVED' }); });
  _ts2Update_('DOCUMENT_GENERATION_JOBS', 'generationJobId', job, { status: 'APPROVED' });
  _ts2Audit_('GENERATION_APPROVE', 'GENERATION_JOB', job, { status: 'APPLIED' }, { status: 'APPROVED', by: who }, '');
  return { job: job, status: 'APPROVED' };
}
function _ts2GenResolveIssue_(issueId, resolution) {
  var i = _ts2Find_('DOCUMENT_GENERATION_ISSUES', 'issueId', issueId); if (!i) throw new Error('NOT_FOUND: проблема не найдена');
  if (!String(resolution || '').trim()) throw new Error('VALIDATION: опишите решение');
  if (i.severity === 'BLOCKER') throw new Error('VALIDATION: блокирующая проблема устраняется исправлением ТТК и новым предпросмотром');
  _ts2Update_('DOCUMENT_GENERATION_ISSUES', 'issueId', issueId, { status: 'RESOLVED', resolvedBy: _ts2Actor_().name, resolvedAt: _ts2Iso_(), suggestedAction: String(i.suggestedAction) + ' | решение: ' + resolution });
  _ts2Audit_('GENERATION_ISSUE_RESOLVE', 'GENERATION_ISSUE', issueId, { status: 'OPEN' }, { status: 'RESOLVED' }, resolution);
  return { issueId: issueId };
}

/* ------------------------------------------------------------------ API */
function ts2GenPreview(token, code, types) { try { _requireAuth_(token, 'ppk_edit|ttk_edit'); return _ok_(_ts2GenPreview_(code, types)); } catch (e) { return _failFrom_(e); } }
function ts2GenCard(token, job) { try { _requireAuth_(token); return _ok_(_ts2GenCard_(job, false)); } catch (e) { return _failFrom_(e); } }
function ts2GenApply(token, job) { try { _requireAuth_(token, 'ppk_edit|ttk_edit'); return _ok_(_ts2GenApply_(job)); } catch (e) { return _failFrom_(e); } }
function ts2GenApprove(token, job) {
  try {
    _requireAuth_(token, 'ppk_approve|haccp_approve');
    var q = _ts2Rows_('APPROVAL_QUEUE', function (x) { return x.objectType === 'GENERATION_PACKAGE' && x.objectId === job && x.status === 'PENDING'; })[0];
    if (q) return _ok_(_ts2ApproveQueue_(q.approvalId, true, 'утверждено одной кнопкой'));
    return _ok_(_ts2GenApprove_(job));
  } catch (e) { return _failFrom_(e); }
}
function ts2GenResolveIssue(token, issueId, resolution) { try { _requireAuth_(token, 'ppk_edit|haccp_approve'); return _ok_(_ts2GenResolveIssue_(issueId, resolution)); } catch (e) { return _failFrom_(e); } }
function ts2GenList(token) {
  try {
    _requireAuth_(token); _ts2EnsureSchema_(false);
    var jobs = _ts2Rows_('DOCUMENT_GENERATION_JOBS').reverse().slice(0, 100).map(function (j) { var s = _ts2Json_(j.summaryJson, {}); return { id: j.generationJobId, ttkId: j.ttkId, name: s.name, status: j.status, types: j.generationType, issues: j.createdIssueCount, documents: j.createdDocumentCount, at: j.startedAt }; });
    var dishes = []; try { dishes = _ts2Dishes_().map(function (d) { return { code: d.code, name: d.name, category: d.category, workshop: d.workshop }; }); } catch (e) {}
    return _ok_({ jobs: jobs, dishes: dishes, tu: _ts2Rows_('TU_DOCUMENTS').reverse(), sto: _ts2Rows_('STO_DOCUMENTS').reverse(), ppk: _ts2Rows_('PPK_DOCUMENTS').reverse() });
  } catch (e) { return _failFrom_(e); }
}
