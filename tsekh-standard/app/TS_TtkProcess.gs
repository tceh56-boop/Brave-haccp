/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
/**
 * ЦЕХ Стандарт — TTK_PROCESS_ANALYZER (Мастер-промт 4.0, этап 2).
 *
 * Источник — основной реестр ТТК: листы «Блюда» + «Состав» (второй реестр не создаётся; импорт V36 — канал загрузки).
 * Статус ТТК — колонка «Статус ТТК» листа «Блюда» (пусто или ACTIVE — действует, DRAFT — черновик, ARCHIVED — архив).
 * В активную модель попадают только действующие ТТК; черновик анализируется отдельно с пометкой DRAFT_ANALYSIS.
 *
 * Распознавание (уровни): 1 — основное правило справочника, 2 — синонимы, 3 — разбор текста по предложениям,
 * 4 — вложенные ТТК (полуфабрикаты: ингредиент совпадает с названием другой ТТК) с защитой от циклов,
 * 5 — подсказка ЦЕХ AI для неоднозначных формулировок (по кнопке; не утверждает).
 * Неоднозначное (несколько операций одной категории в одном предложении) и найденное только по синонимам
 * с низкой уверенностью — REVIEW_REQUIRED. Значения режимов не придумываются.
 *
 * Филиал = отдельное предприятие со своей таблицей (решение владельца): locationId = organizationId.
 */
var TTKP_DICT_VER_ = '2026-11-11.1';
// [code, название, категория, основное правило, синонимы, связанные этапы, опасности (MH-…), меры, параметры, доказательства, признак применимости]
var TTKP_DICT_ = [
  // первичная обработка
  ['RECEIVE', 'Приёмка', 'PRIMARY', 'приёмк|приемк', 'принима[ею]т|поступа[ею]т', 'STORE', 'MH-B-STORAGE', 'входной контроль', 'температура при приёмке', 'FACT,DOCUMENT', 'сырьё от поставщика'],
  ['STORE', 'Хранение', 'PRIMARY', 'хран(ят|ить|ение|ится|ят)', 'держат в холод', 'RECEIVE', 'MH-B-STORAGE', 'температурный режим хранения', 'температура хранения,срок', 'FACT', ''],
  ['DEFROST', 'Размораживание', 'PRIMARY', 'размор|дефрост', 'оттаива', 'STORE', 'MH-B-DEFROST', 'режим размораживания', 'температура,время', 'FACT', 'замороженное сырьё'],
  ['WASH', 'Мойка', 'PRIMARY', 'промы|мыть|моют|ополаск', 'замачив', '', 'MH-P-WASH,MH-B-CROSS', 'обработка сырья в отдельной зоне', '', 'CHECKLIST', ''],
  ['PEEL', 'Очистка', 'PRIMARY', 'очист|очищ', 'снима[ею]т кожур|снять кожур|чист(ят|ить)', 'WASH', 'MH-P-WASH', '', '', 'CHECKLIST', ''],
  ['BUTCHER', 'Разделка', 'PRIMARY', 'разделк|разделыв', 'потрош|обвалк|жилов', 'CUT', 'MH-B-CROSS', 'раздельный инвентарь', '', 'CHECKLIST', 'мясо, птица, рыба'],
  ['CUT', 'Нарезка', 'PRIMARY', 'нарез|нареж', 'шинку|измельч|натир|рубят|рубить|кубик|соломк', '', 'MH-P-METAL,MH-B-CROSS', 'исправность инвентаря и оборудования', '', 'CHECKLIST', ''],
  ['PORTION', 'Порционирование', 'PRIMARY', 'порцион', 'взвешива', 'ASSEMBLY', 'MH-B-RECONT', '', 'масса порции', 'FACT', ''],
  ['VACUUM', 'Вакуумирование', 'PRIMARY', 'вакуум', '', 'STORE,SOUSVIDE', 'MH-B-STORAGE', 'целостность упаковки, маркировка', 'дата, срок', 'FACT', 'вакуумный упаковщик'],
  // тепловая обработка
  ['BOIL', 'Варка', 'THERMAL', 'вар(ят|ить|ка|ки)|отвар', 'кипят|довест\\w* до кип|бульон', 'COOL', 'MH-B-THERMAL', 'тепловая обработка до готовности', 'температура в толще,время', 'FACT', ''],
  ['FRY', 'Жарка', 'THERMAL', 'обжар|жар(ят|ить|ь|ен)', 'пассер|на сковор|гриль', 'COOL', 'MH-B-THERMAL', 'тепловая обработка до готовности', 'температура в толще', 'FACT', ''],
  ['BAKE', 'Запекание', 'THERMAL', 'запек|запеч', 'выпек|в духов|в печ', 'COOL', 'MH-B-THERMAL', 'тепловая обработка до готовности', 'температура в толще,время', 'FACT', ''],
  ['STEW', 'Томление', 'THERMAL', 'томит|томлен|туш(ат|ить|ен)', 'припуск', 'COOL', 'MH-B-THERMAL', 'тепловая обработка до готовности', 'температура,время', 'FACT', ''],
  ['SOUSVIDE', 'Су-вид', 'THERMAL', 'су-?вид|sous.?vide', 'вакуум\\w* .{0,30}(водян\\w* бан|при t)', 'VACUUM,BLAST', 'MH-B-THERMAL', 'режим (температура и время) по документу предприятия', 'температура воды,время,температура в толще', 'FACT', 'вакуумная упаковка'],
  ['PASTEUR', 'Пастеризация', 'THERMAL', 'пастериз', '', 'COOL', 'MH-B-THERMAL', '', 'температура,время', 'FACT', ''],
  ['BLANCH', 'Бланширование', 'THERMAL', 'бланш', 'ошпар', 'COOL', 'MH-B-THERMAL', '', 'время', 'FACT', ''],
  ['STEAM', 'Приготовление на пару', 'THERMAL', 'на пару', 'пароконвект|паров\\w* режим', 'COOL', 'MH-B-THERMAL', 'тепловая обработка до готовности', 'температура в толще', 'FACT', ''],
  ['DEEPFRY', 'Фритюр', 'THERMAL', 'фритюр', 'во фритюре|в кипящем масле', '', 'MH-B-THERMAL,MH-C-OIL', 'контроль фритюрного жира', 'качество жира,температура', 'FACT', 'фритюрница'],
  // охлаждение и хранение
  ['COOL', 'Охлаждение', 'COLD', 'охлад|охлажд', 'остуд', 'STORE', 'MH-B-COOLING', 'режим охлаждения', 'температура,время', 'FACT', ''],
  ['BLAST', 'Шоковое охлаждение', 'COLD', 'шоков', 'бласт|шок-?фриз', 'STORE', 'MH-B-COOLING', 'режим шокового охлаждения', 'температура в толще,время', 'FACT', 'шкаф шоковой заморозки'],
  ['FREEZE', 'Замораживание', 'COLD', 'замор(аж|оз|ажив)', 'заморозить', 'STORE', 'MH-B-STORAGE', 'режим замораживания', 'температура', 'FACT', ''],
  ['REHEAT', 'Повторный нагрев', 'COLD', 'разогр|регенер', 'подогре', 'SALE', 'MH-B-REHEAT', 'разогрев до температуры по документу предприятия', 'температура в толще', 'FACT', ''],
  ['HOTHOLD', 'Горячее хранение', 'COLD', 'мармит|горяч\\w* (хранен|состоян)', 'термобокс|поддержива\\w* температур', 'SALE', 'MH-B-STORAGE', 'время на раздаче', 'температура,время', 'FACT', ''],
  ['COLDHOLD', 'Холодное хранение', 'COLD', 'хран\\w* .{0,40}(холодильн|охлажд)', 'при t\\s*[+]?\\d', 'SALE', 'MH-B-STORAGE', 'температура хранения', 'температура', 'FACT', ''],
  ['SALE', 'Реализация', 'COLD', 'реализ', 'отпуск|подают|подава', '', 'MH-B-STORAGE', 'срок реализации', 'время', 'FACT', ''],
  // дополнительные процессы
  ['FERMENT', 'Ферментация', 'EXTRA', 'фермент|брожен', 'квас(ят|ить|ят)|закваск', 'STORE', 'MH-B-STORAGE', 'режим ферментации по документу предприятия', 'температура,время,pH', 'FACT', ''],
  ['MARINATE', 'Маринование', 'EXTRA', 'маринов|маринад', '', 'STORE', 'MH-B-MARINATE', 'температура маринования', 'температура,время', 'FACT', ''],
  ['CURE', 'Посол', 'EXTRA', 'посол|засол', 'просол|солят', 'STORE', 'MH-B-STORAGE', 'режим посола по документу предприятия', 'время,концентрация', 'FACT', ''],
  ['MIX', 'Смешивание', 'EXTRA', 'смеш|перемеш', 'соедин|взби', '', 'MH-B-RECONT', '', '', 'CHECKLIST', ''],
  ['ASSEMBLY', 'Сборка блюда', 'EXTRA', 'собир|сборк', 'выклад|укладыв', 'SALE', 'MH-B-RECONT,MH-A-CROSS', 'гигиена рук и инвентаря', '', 'CHECKLIST', ''],
  ['DECOR', 'Декорирование', 'EXTRA', 'декор|украш', 'оформ', 'SALE', 'MH-B-RECONT', '', '', 'CHECKLIST', ''],
  ['PACK', 'Фасовка', 'EXTRA', 'фасов', 'расфас', 'WRAP', 'MH-B-RECONT', 'маркировка', 'масса,дата', 'FACT', ''],
  ['WRAP', 'Упаковка', 'EXTRA', 'упаков', 'плёнк|пленк|контейнер|ланч-?бокс', 'STORE', 'MH-B-RECONT', 'целостность упаковки, маркировка', 'дата,срок', 'FACT', ''],
  ['TRANSPORT', 'Транспортировка', 'EXTRA', 'транспорт', 'доставк|перевоз', 'SALE', 'MH-B-STORAGE', 'температура при перевозке', 'температура,время', 'FACT', 'доставка, кейтеринг']
];
var TTKP_PARAM_OPS_ = ['BOIL', 'FRY', 'BAKE', 'STEW', 'SOUSVIDE', 'PASTEUR', 'DEEPFRY', 'COOL', 'BLAST', 'REHEAT', 'STEAM'];
var TTKP_STATUS_COL_ = 'Статус ТТК';

function _ttkpNorm_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s*п\s*[\/\-]\s*ф(?![а-яё])/g, '').replace(/[«»"'`().,]/g, ' ').replace(/\s+/g, ' ').trim(); }
/** Справочник: строки листа (поставщик + предприятие). Пустой лист заполняется из TTKP_DICT_, новые строки поставщика дописываются. */
function _ttkpDict_() {
  var rows = _ts2Rows_('TTK_PROCESS_DICTIONARY'), have = {};
  rows.forEach(function (r) { have[r.code] = 1; });
  var add = TTKP_DICT_.filter(function (d) { return !have[d[0]]; }).map(function (d) {
    return { processId: 'PRC-' + d[0], code: d[0], name: d[1], category: d[2], detectionRule: d[3], synonyms: d[4], relatedStages: d[5], hazards: d[6], controlMeasures: d[7], requiredParams: d[8], evidenceTypes: d[9],
      applicability: d[10], dictVersion: TTKP_DICT_VER_, active: true, source: 'поставщик', updatedAt: _ts2Iso_(), updatedBy: 'ЦЕХ Стандарт' }; });
  if (add.length) { _ts2InsertMany_('TTK_PROCESS_DICTIONARY', add); rows = _ts2Rows_('TTK_PROCESS_DICTIONARY'); }
  return rows.filter(function (r) { return String(r.active) !== 'false' && r.active !== false; }).map(function (r) {
    var re = function (s) { try { return s ? new RegExp(s, 'i') : null; } catch (e) { return null; } };
    return { id: r.processId, code: r.code, name: r.name, category: r.category, main: re(r.detectionRule), syn: re(r.synonyms) };
  });
}
/** Реестр ТТК с колонкой статуса (колонка дописывается в конец листа «Блюда» один раз). */
function _ttkpRegistry_() {
  var sh = _book_().getSheetByName('Блюда'); if (!sh) throw new Error('VALIDATION: лист «Блюда» не найден');
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String), sc = head.indexOf(TTKP_STATUS_COL_);
  if (sc < 0) { sc = head.length; sh.getRange(1, sc + 1).setValue(TTKP_STATUS_COL_); }
  var st = {}; if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sc + 1).getValues().forEach(function (r) { if (r[0]) st[String(r[0])] = String(r[sc] || '').trim().toUpperCase() || 'ACTIVE'; });
  return _ts2Dishes_().map(function (d) { d.status = st[d.code] || 'ACTIVE'; return d; });
}
function _ttkpVersion_(d) { return d.code + '@' + _ts2Sha_(JSON.stringify([d.code, d.name, d.category, d.yield, d.method, d.shelfHours, d.workshop, d.comp])).slice(0, 12); }
/** Операции одной ТТК по её тексту (уровни 1–3). */
function _ttkpOps_(d, dict) {
  var txt = String(d.method || ''), sentences = txt.split(/(?<=[.;!?\n])\s*/).map(function (x) { return x.trim(); }).filter(Boolean), out = [];
  sentences.forEach(function (snt, i) {
    var hits = [];
    dict.forEach(function (p) { if (p.main && p.main.test(snt)) hits.push({ p: p, method: 'DICTIONARY', conf: 0.95 }); else if (p.syn && p.syn.test(snt)) hits.push({ p: p, method: 'SYNONYM', conf: 0.8 }); });
    // неоднозначность: несколько операций одной категории в одном предложении, найденных только по синонимам
    var byCat = {}; hits.forEach(function (h) { (byCat[h.p.category] = byCat[h.p.category] || []).push(h); });
    hits.forEach(function (h) {
      var amb = byCat[h.p.category].length > 1 && byCat[h.p.category].some(function (x) { return x !== h && x.method === 'DICTIONARY'; }) && h.method === 'SYNONYM';
      var alt = / или /i.test(snt) && byCat[h.p.category].length > 1;
      out.push({ p: h.p, method: h.method, conf: amb || alt ? 0.6 : h.conf, review: amb || alt || h.method === 'SYNONYM' && byCat[h.p.category].length > 1, text: snt.slice(0, 400), step: 'S' + (i + 1), seq: i + 1 });
    });
  });
  return out;
}
/** Граф вложенных ТТК: ингредиент, совпадающий с названием другой ТТК (п/ф). */
function _ttkpIndex_(reg) { var by = {}; reg.forEach(function (d) { var k = _ttkpNorm_(d.name); if (k && !by[k]) by[k] = d; }); return by; }
function _ttkpChildren_(d, idx) {
  var out = [], seen = {};
  d.comp.forEach(function (c) { var x = idx[_ttkpNorm_(c.name)]; if (x && x.code !== d.code && !seen[x.code]) { seen[x.code] = 1; out.push(x); } });
  return out;
}
/** Обход вложенных ТТК: каждая карта один раз; цикл — замечание, без бесконечной рекурсии. */
function _ttkpWalk_(root, idx) {
  var res = { nodes: [], cycles: [] }, visited = {};
  (function walk(d, path) {
    _ttkpChildren_(d, idx).forEach(function (ch) {
      if (path.indexOf(ch.code) >= 0) { res.cycles.push(path.concat([ch.code]).join(' → ')); return; }
      if (visited[ch.code]) return; visited[ch.code] = 1;
      res.nodes.push({ d: ch, parent: d.code, depth: path.length });
      walk(ch, path.concat([ch.code]));
    });
  })(root, [root.code]);
  return res;
}
/** Замечания полноты: «Требуется заполнение ТТК». Ничего не дописывается в карту. */
function _ttkpIssues_(d, ops, walk, idx, usedAsSemi) {
  var codes = {}; ops.forEach(function (o) { codes[o.p.code] = 1; });
  var txt = String(d.method || ''), out = [];
  var add = function (code, msg) { out.push({ code: code, message: msg }); };
  if (!txt.trim()) add('NO_TECHNOLOGY', 'Нет описания технологии — операции не определить');
  var thermal = Object.keys(codes).some(function (c) { return ['BOIL', 'FRY', 'BAKE', 'STEW', 'SOUSVIDE', 'PASTEUR', 'BLANCH', 'STEAM', 'DEEPFRY'].indexOf(c) >= 0; });
  var stored = codes.STORE || codes.COLDHOLD || usedAsSemi || (Number(d.shelfHours) > 0);
  if (thermal && stored && !codes.COOL && !codes.BLAST && !codes.HOTHOLD) add('NO_COOLING_STAGE', 'После тепловой обработки продукт хранится, но этап охлаждения не описан');
  if (!/хран[^.]{0,80}(\d\s*°|[+\-−]\s*\d|\d\s*град)/i.test(txt) && (stored || usedAsSemi)) add('NO_STORAGE_CONDITIONS', 'Не указана температура хранения');
  TTKP_PARAM_OPS_.forEach(function (c) {
    if (!codes[c]) return; var snt = ops.filter(function (o) { return o.p.code === c; }).map(function (o) { return o.text; }).join(' ');
    if (!/\d+\s*(°|град|мин|час|ч(?![а-яё])|сек)/i.test(snt)) add('NO_PARAMS', 'Операция «' + ops.filter(function (o) { return o.p.code === c; })[0].p.name + '»: не указаны параметры (температура или время)');
  });
  if (!(Number(d.shelfHours) > 0) && !/срок\s+(реализации|годности|хранения)[^.]{0,40}\d/i.test(txt)) add('NO_SHELF_LIFE', 'Не указан срок реализации');
  if (usedAsSemi && stored && !codes.WRAP && !codes.PACK && !codes.VACUUM && !/гастроем|контейнер|ёмкост|емкост|тар[аеуы]/i.test(txt)) add('NO_PACKAGING', 'Полуфабрикат хранится, но не указан способ упаковки (тара)');
  d.comp.forEach(function (c) { if (/п\s*[\/\-]\s*ф|полуфабрикат/i.test(c.name) && !idx[_ttkpNorm_(c.name)]) add('SEMI_LINK_MISSING', 'Ингредиент «' + c.name + '» — полуфабрикат, но его ТТК в реестре не найдена'); });
  walk.cycles.forEach(function (cy) { add('CYCLE', 'Циклическая ссылка между ТТК: ' + cy); });
  return out;
}

/** Анализ: одна ТТК или все действующие. Повторный запуск идемпотентен: решения проверяющих сохраняются,
 *  исчезнувшие операции — SUPERSEDED (история не удаляется), новые — добавляются. Возвращает разницу. */
function _ttkpAnalyze_(codes, opts) {
  opts = opts || {};
  var reg = _ttkpRegistry_(), idx = _ttkpIndex_(reg.filter(function (d) { return d.status !== 'ARCHIVED'; })), dict = _ttkpDict_(), ent = _ts2Ent_(), now = _ts2Iso_();
  var semiUsed = {}; reg.forEach(function (d) { if (d.status === 'ACTIVE') _ttkpChildren_(d, idx).forEach(function (c) { semiUsed[c.code] = 1; }); });
  var targets = reg.filter(function (d) { return codes ? codes.indexOf(d.code) >= 0 : d.status === 'ACTIVE'; });
  if (codes && !targets.length) throw new Error('NOT_FOUND: ТТК не найдена: ' + codes.join(', '));
  var draft = function (d) { return d.status !== 'ACTIVE'; };
  var ownOps = {}; var opsOf = function (d) { if (!ownOps[d.code]) ownOps[d.code] = _ttkpOps_(d, dict); return ownOps[d.code]; };
  var want = {}, wantIssues = {}, summary = [];
  targets.forEach(function (d) {
    var ver = _ttkpVersion_(d), ops = opsOf(d), walk = _ttkpWalk_(d, idx), rows = [];
    var mk = function (o, parent, method) {
      var key = [d.code, o.p.code, parent || '', _ts2Sha_(o.text).slice(0, 10)].join('|');
      return { key: key, row: { organizationId: ent, locationId: ent, ttkId: d.code, ttkVersion: ver, processId: o.p.id, processCode: o.p.code, sourceStepId: (parent ? parent + ':' : '') + o.step, sourceText: o.text,
        operationSequence: o.seq, parentTtkId: parent || '', confidence: method === 'NESTED' ? Math.min(o.conf, 0.9) : o.conf, detectionMethod: method || o.method,
        reviewStatus: draft(d) ? 'DRAFT_ANALYSIS' : (o.review || o.conf < 0.8 ? 'REVIEW_REQUIRED' : 'DETECTED'), rowKey: key } };
    };
    ops.forEach(function (o) { rows.push(mk(o, '', o.method)); });
    // в карту пишутся операции прямых п/ф; глубже — раскрывается при чтении (_ttkpProcessesOf_): лист растёт линейно, а не квадратично
    _ttkpChildren_(d, idx).forEach(function (ch) { opsOf(ch).forEach(function (o) { rows.push(mk(o, ch.code, 'NESTED')); }); });
    rows.forEach(function (r) { want[r.key] = r.row; });
    _ttkpIssues_(d, ops, walk, idx, !!semiUsed[d.code]).forEach(function (is) { var k = [d.code, is.code, _ts2Sha_(is.message).slice(0, 8)].join('|'); wantIssues[k] = { organizationId: ent, ttkId: d.code, ttkVersion: ver, code: is.code, message: is.message, issueKey: k, draft: draft(d) }; });
    summary.push({ ttkId: d.code, name: d.name, status: d.status, version: ver, processes: ops.map(function (o) { return o.p.code; }).filter(function (c, i, a) { return a.indexOf(c) === i; }),
      nested: walk.nodes.map(function (n) { return n.d.code; }), cycles: walk.cycles });
  });
  var scope = {}; targets.forEach(function (d) { scope[d.code] = 1; });
  // сверка с прежним результатом — по всей таблице одним проходом
  return _withLock_(function () {
    var diff = { added: [], removed: [], kept: 0 }, seen = {}, ins = [];
    var map = _ttkpTable_('TTK_PROCESS_MAP');
    map.rows.forEach(function (r) {
      if (!scope[r.ttkId] || r.reviewStatus === 'SUPERSEDED') return;
      var w = want[r.rowKey];
      if (w) { seen[r.rowKey] = 1; diff.kept++;
        var keepDecision = r.reviewStatus === 'CONFIRMED' || r.reviewStatus === 'REJECTED';
        map.set(r, { ttkVersion: w.ttkVersion, operationSequence: w.operationSequence, confidence: w.confidence, reviewStatus: keepDecision ? r.reviewStatus : w.reviewStatus }, now); }
      else { map.set(r, { reviewStatus: 'SUPERSEDED' }, now); diff.removed.push(r.ttkId + ':' + r.processCode + (r.parentTtkId ? ' (из ' + r.parentTtkId + ')' : '')); }
    });
    Object.keys(want).forEach(function (k) { if (seen[k]) return; var w = want[k]; w.createdAt = now; w.updatedAt = now; w.reviewNote = ''; ins.push(w); diff.added.push(w.ttkId + ':' + w.processCode + (w.parentTtkId ? ' (из ' + w.parentTtkId + ')' : '')); });
    map.flush();
    var ids = _ttkpIds_('TTK_PROCESS_MAP', ins.length); ins.forEach(function (w, i) { w.id = ids[i]; });
    if (ins.length) _ts2InsertMany_('TTK_PROCESS_MAP', ins);
    // замечания: новые открываются, исчезнувшие — RESOLVED
    var iss = _ttkpTable_('TTK_PROCESS_ISSUES'), seenI = {}, insI = [];
    iss.rows.forEach(function (r) { if (!scope[r.ttkId]) return; if (wantIssues[r.issueKey]) { seenI[r.issueKey] = 1; if (r.status !== 'OPEN') iss.set(r, { status: 'OPEN', resolvedAt: '' }); }
      else if (r.status === 'OPEN') iss.set(r, { status: 'RESOLVED', resolvedAt: now }); });
    iss.flush();
    Object.keys(wantIssues).forEach(function (k) { if (seenI[k]) return; var w = wantIssues[k]; insI.push({ organizationId: w.organizationId, ttkId: w.ttkId, ttkVersion: w.ttkVersion, code: w.code,
      message: (w.draft ? '[черновик] ' : '') + w.message, status: 'OPEN', issueKey: k, createdAt: now, resolvedAt: '' }); });
    var idsI = _ttkpIds_('TTK_PROCESS_ISSUES', insI.length); insI.forEach(function (w, i) { w.issueId = idsI[i]; });
    if (insI.length) _ts2InsertMany_('TTK_PROCESS_ISSUES', insI);
    try { if (diff.added.length || diff.removed.length) _ts2Audit_('TTK_PROCESS_ANALYZE', 'TTK', codes ? codes.join(',') : 'ALL', undefined, { added: diff.added.length, removed: diff.removed.length, ttk: targets.length }, 'анализ процессов ТТК'); } catch (e) {}
    return { analyzed: targets.length, rows: Object.keys(want).length, added: diff.added, removed: diff.removed, kept: diff.kept, openIssues: Object.keys(wantIssues).length, ttk: summary, dictVersion: TTKP_DICT_VER_ };
  });
}
/** Лист целиком в памяти: изменения копятся и пишутся одним вызовом (сотни ТТК — без построчной записи). */
function _ttkpTable_(name) {
  var sh = _ts2Sheet_(name), h = _ts2Head_(sh), rows = _ts2Rows_(name), dirty = false;
  return { rows: rows, set: function (r, patch, now) {
    var ch = Object.keys(patch).some(function (k) { return String(r[k]) !== String(patch[k]); }); if (!ch) return;
    Object.keys(patch).forEach(function (k) { r[k] = patch[k]; }); if (now && h.indexOf('updatedAt') >= 0) r.updatedAt = now; r._dirty = true; dirty = true; },
    flush: function () { if (!dirty) return; var first = rows[0]._row, last = rows[rows.length - 1]._row, v = sh.getRange(first, 1, last - first + 1, h.length).getValues();
      rows.forEach(function (r) { if (r._dirty) v[r._row - first] = h.map(function (k) { return _ts2Cell_(r[k]); }); });
      sh.getRange(first, 1, v.length, h.length).setValues(v); dirty = false; } };
}
/** n идентификаторов одним обращением к счётчику (а не n блокировок). */
function _ttkpIds_(name, n) {
  if (!n) return [];
  var prefix = TS2_ENTERPRISE_SCHEMA_[name].prefix;
  return _withLock_(function () {
    var sh = _ts2Sheet_('ID_COUNTERS'), cur = _ts2Find_('ID_COUNTERS', 'counterCode', prefix), from = cur ? Number(cur.lastNumber || 0) : 0;
    if (cur) sh.getRange(cur._row, 4, 1, 3).setValues([[from + n, new Date(), _ts2Actor_().name]]); else sh.appendRow([prefix, prefix, '', n, new Date(), _ts2Actor_().name]);
    var out = []; for (var i = 1; i <= n; i++) out.push(prefix + '-' + ('00000' + (from + i)).slice(-6)); return out;
  });
}
/** Процессы ТТК для генератора ППК: собственные и всех вложенных п/ф (на любую глубину, с защитой от циклов),
 *  без отклонённых, устаревших и черновых. Каждая строка — с ttkId карты, где операция описана (parentTtkId). */
function _ttkpProcessesOf_(ttkId) {
  var by = {}; _ts2Rows_('TTK_PROCESS_MAP').forEach(function (r) { if (['SUPERSEDED', 'REJECTED', 'DRAFT_ANALYSIS'].indexOf(r.reviewStatus) < 0) (by[r.ttkId] = by[r.ttkId] || []).push(r); });
  var out = [], seen = {};
  (function walk(id, own) {
    if (seen[id]) return; seen[id] = 1;
    var rows = by[id] || [], kids = {};
    rows.forEach(function (r) { if (!r.parentTtkId) { if (own) out.push(r); } else kids[r.parentTtkId] = 1; });
    if (own) rows.forEach(function (r) { if (r.parentTtkId) out.push(r); });
    Object.keys(kids).forEach(function (k) { if (!seen[k]) { (by[k] || []).forEach(function (r) { if (r.parentTtkId && !seen[r.parentTtkId]) out.push(r); }); walk(k, false); } });
  })(String(ttkId), true);
  return out;
}
/** Активная производственная модель: процессы всех действующих ТТК (для ППК, этапы 3–4). */
function _ttkpActiveModel_() {
  var by = {}; _ts2Rows_('TTK_PROCESS_MAP').forEach(function (r) { if (['SUPERSEDED', 'REJECTED', 'DRAFT_ANALYSIS'].indexOf(r.reviewStatus) >= 0) return;
    var p = by[r.processCode] = by[r.processCode] || { processCode: r.processCode, processId: r.processId, ttk: {}, review: 0 }; p.ttk[r.ttkId] = 1; if (r.reviewStatus === 'REVIEW_REQUIRED') p.review++; });
  return Object.keys(by).map(function (k) { var p = by[k]; return { processCode: k, processId: p.processId, ttkCount: Object.keys(p.ttk).length, ttk: Object.keys(p.ttk), reviewRequired: p.review }; });
}

/* ------------------------------------------------------------------ API */
function ttkProcAnalyze(token, ttkId) {
  try { _requireAuth_(token, 'ttk_edit|haccp|ppk_edit'); _ts2EnsureSchema_(false); return _ok_(_ttkpAnalyze_(ttkId ? [String(ttkId)] : null)); } catch (e) { return _failFrom_(e); }
}
function ttkProcOverview(token) {
  try {
    _requireAuth_(token, 'ttk_edit|ttk_approve|haccp|ppk_view|ppk_edit'); _ts2EnsureSchema_(false);
    var reg = _ttkpRegistry_(), map = _ts2Rows_('TTK_PROCESS_MAP'), iss = _ts2FindAll_('TTK_PROCESS_ISSUES', 'status', 'OPEN'), dict = _ttkpDict_();
    var names = {}; dict.forEach(function (p) { names[p.code] = p.name; });
    var cnt = { ACTIVE: 0, DRAFT: 0, ARCHIVED: 0 }; reg.forEach(function (d) { cnt[d.status] = (cnt[d.status] || 0) + 1; });
    return _ok_({ ttk: cnt, analyzed: Object.keys(map.reduce(function (a, r) { if (r.reviewStatus !== 'SUPERSEDED') a[r.ttkId] = 1; return a; }, {})).length,
      model: _ttkpActiveModel_().map(function (p) { p.name = names[p.processCode] || p.processCode; return p; }).sort(function (a, b) { return b.ttkCount - a.ttkCount; }),
      review: map.filter(function (r) { return r.reviewStatus === 'REVIEW_REQUIRED'; }).slice(0, 200).map(function (r) { return { id: r.id, ttkId: r.ttkId, process: names[r.processCode] || r.processCode, text: r.sourceText, parent: r.parentTtkId, confidence: r.confidence, method: r.detectionMethod, note: r.reviewNote }; }),
      issues: iss.slice(0, 300).map(function (i) { return { ttkId: i.ttkId, code: i.code, message: i.message }; }), issuesTotal: iss.length,
      dictionary: dict.map(function (p) { return { code: p.code, name: p.name, category: p.category }; }), dictVersion: TTKP_DICT_VER_ });
  } catch (e) { return _failFrom_(e); }
}
function ttkProcOf(token, ttkId) {
  try { _requireAuth_(token, 'ttk_edit|ttk_approve|haccp|ppk_view|ppk_edit');
    return _ok_({ ttkId: ttkId, rows: _ts2FindAll_('TTK_PROCESS_MAP', 'ttkId', String(ttkId), function (r) { return r.reviewStatus !== 'SUPERSEDED'; }).map(function (r) { return { id: r.id, process: r.processCode, text: r.sourceText, parent: r.parentTtkId, status: r.reviewStatus, method: r.detectionMethod, confidence: r.confidence }; }),
      issues: _ts2FindAll_('TTK_PROCESS_ISSUES', 'ttkId', String(ttkId), function (i) { return i.status === 'OPEN'; }).map(function (i) { return { code: i.code, message: i.message }; }) }); }
  catch (e) { return _failFrom_(e); }
}
/** Проверка операции человеком: подтвердить, отклонить или заменить операцию из справочника. */
function ttkProcReview(token, id, decision, processCode, note) {
  try {
    var s = _requireAuth_(token, 'ttk_edit|ttk_approve|haccp_approve|ppk_edit'); decision = String(decision || '').toUpperCase();
    if (['CONFIRMED', 'REJECTED'].indexOf(decision) < 0) return _fail_('VALIDATION', 'Решение — CONFIRMED или REJECTED');
    var r = _ts2Find_('TTK_PROCESS_MAP', 'id', String(id)); if (!r) return _fail_('NOT_FOUND', 'Строка анализа не найдена');
    var patch = { reviewStatus: decision, reviewNote: ((s && (s.name || s.fullName)) || '') + ', ' + _ts2Iso_().slice(0, 10) + (note ? ': ' + String(note).slice(0, 200) : ''), updatedAt: _ts2Iso_() };
    if (processCode) { var p = _ttkpDict_().filter(function (x) { return x.code === String(processCode); })[0]; if (!p) return _fail_('VALIDATION', 'Нет операции «' + processCode + '» в справочнике'); patch.processCode = p.code; patch.processId = p.id; patch.detectionMethod = 'MANUAL'; }
    _ts2Update_('TTK_PROCESS_MAP', 'id', r.id, patch);
    _ts2Audit_('TTK_PROCESS_REVIEW', 'TTK_PROCESS_MAP', r.id, { status: r.reviewStatus, process: r.processCode }, { status: decision, process: patch.processCode || r.processCode }, note || '');
    return _ok_({ id: r.id, status: decision });
  } catch (e) { return _failFrom_(e); }
}
/** Статус ТТК в реестре: ACTIVE / DRAFT / ARCHIVED. */
function ttkProcSetStatus(token, ttkId, status) {
  try {
    _requireAuth_(token, 'ttk_edit'); status = String(status || '').toUpperCase(); if (['ACTIVE', 'DRAFT', 'ARCHIVED'].indexOf(status) < 0) return _fail_('VALIDATION', 'Статус — ACTIVE, DRAFT или ARCHIVED');
    _ttkpRegistry_(); var sh = _book_().getSheetByName('Блюда'), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String), sc = head.indexOf(TTKP_STATUS_COL_), v = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
    for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(ttkId)) { var was = String(sh.getRange(i + 1, sc + 1).getValue() || 'ACTIVE'); sh.getRange(i + 1, sc + 1).setValue(status);
      _ts2Audit_('TTK_STATUS', 'TTK', String(ttkId), { status: was }, { status: status }, ''); return _ok_({ ttkId: ttkId, status: status }); }
    return _fail_('NOT_FOUND', 'ТТК не найдена');
  } catch (e) { return _failFrom_(e); }
}
/** Уровень 5: подсказка ЦЕХ AI для неоднозначной операции — только предложение, решение принимает человек. */
function ttkProcAiSuggest(token, id) {
  try {
    _requireAuth_(token, 'ttk_edit|haccp'); var r = _ts2Find_('TTK_PROCESS_MAP', 'id', String(id)); if (!r) return _fail_('NOT_FOUND', 'Строка анализа не найдена');
    var dict = _ttkpDict_(), list = dict.map(function (p) { return p.code + ' — ' + p.name; }).join('; ');
    var q = 'Классифицируй технологическую операцию из ТТК. Ответь одним кодом из списка и одной фразой-объяснением в формате «КОД: объяснение». Если ни один не подходит — «НЕТ: объяснение». Не указывай температуры и сроки.\nСписок: ' + list + '\nТекст: «' + r.sourceText + '»';
    var a = JSON.parse(tsAiAsk(token, q, [], ''));
    if (!a.success) return _fail_('VALIDATION', a.error && a.error.message || 'ЦЕХ AI недоступен');
    var m = /^\s*([A-Z_]+)\s*:\s*(.*)$/m.exec(a.data.answer || ''), code = m && dict.some(function (p) { return p.code === m[1]; }) ? m[1] : '';
    _ts2Update_('TTK_PROCESS_MAP', 'id', r.id, { reviewNote: 'ЦЕХ AI предлагает: ' + (code || 'нет подходящей операции') + (m ? ' — ' + String(m[2]).slice(0, 200) : ''), updatedAt: _ts2Iso_() });
    return _ok_({ id: r.id, suggested: code, explanation: m ? m[2] : a.data.answer, note: 'Предложение не утверждено: подтвердите или выберите операцию' });
  } catch (e) { return _failFrom_(e); }
}
/** Справочник процессов: добавить или изменить операцию предприятия (правила — регулярные выражения, проверяются). */
function ttkProcDictionarySave(token, item) {
  try {
    var s = _requireAuth_(token, 'ttk_approve|haccp_approve'); item = typeof item === 'string' ? JSON.parse(item) : item || {};
    var code = String(item.code || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,23}$/.test(code)) return _fail_('VALIDATION', 'Код операции — латиница, цифры и «_» (2–24 символа)');
    if (!String(item.name || '').trim()) return _fail_('VALIDATION', 'Укажите название операции');
    if (['PRIMARY', 'THERMAL', 'COLD', 'EXTRA'].indexOf(String(item.category)) < 0) return _fail_('VALIDATION', 'Категория — PRIMARY, THERMAL, COLD или EXTRA');
    var bad = ['detectionRule', 'synonyms'].filter(function (k) { try { if (item[k]) new RegExp(item[k], 'i'); return false; } catch (e) { return true; } });
    if (bad.length) return _fail_('VALIDATION', 'Ошибка в правиле распознавания: ' + bad.join(', '));
    if (!item.detectionRule) return _fail_('VALIDATION', 'Укажите правило распознавания');
    _ttkpDict_();
    var cur = _ts2Find_('TTK_PROCESS_DICTIONARY', 'code', code), who = (s && (s.name || s.fullName)) || '';
    var patch = { name: String(item.name).slice(0, 80), category: item.category, detectionRule: item.detectionRule, synonyms: item.synonyms || '', relatedStages: item.relatedStages || '', hazards: item.hazards || '', controlMeasures: item.controlMeasures || '',
      requiredParams: item.requiredParams || '', evidenceTypes: item.evidenceTypes || '', applicability: item.applicability || '', active: item.active !== false, updatedAt: _ts2Iso_(), updatedBy: who };
    if (cur) { patch.source = cur.source === 'поставщик' ? 'поставщик, изменено предприятием' : cur.source; _ts2Update_('TTK_PROCESS_DICTIONARY', 'code', code, patch); }
    else { patch.processId = 'PRC-' + code; patch.code = code; patch.dictVersion = TTKP_DICT_VER_; patch.source = 'предприятие'; _ts2Insert_('TTK_PROCESS_DICTIONARY', patch); }
    _ts2Audit_('TTK_DICT_SAVE', 'TTK_PROCESS_DICTIONARY', code, cur ? { rule: cur.detectionRule, active: cur.active } : undefined, { rule: patch.detectionRule, active: patch.active }, '');
    return _ok_({ code: code, created: !cur, note: 'Справочник изменён. Запустите анализ ТТК заново.' });
  } catch (e) { return _failFrom_(e); }
}
