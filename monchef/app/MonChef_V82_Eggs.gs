/**
 * MonChef V82 — яйца: куриные и перепелиные (а также индюшиные, цесариные, страусиные) (17.11.2026).
 *
 * Основание — ГОСТ 31654-2012 «Яйца куриные пищевые. Технические условия» и ГОСТ 31655-2012 «Яйца пищевые (индюшиные,
 * цесариные, перепелиные, страусиные). Технические условия» (тексты присланы предприятием 17.11.2026, сверено по тексту);
 * СанПиН 2.3/2.4.4282-26, приложение 6 (питание детей); ТР ТС 021/2011 (ст. 7, микробиологические нормативы).
 *
 *  1. Приёмка яиц: вид птицы, класс (Д / С), категория (для куриных), дата сортировки, скорлупа, маркировка — отмечает человек;
 *     скорлупа или маркировка «не соответствует» → карантин той же проверкой; срок на маркировке сверяется с ГОСТ для класса.
 *  2. Обработка яиц — только по утверждённому режиму дезсредства, в назначении которого указаны яйца; запись одним нажатием;
 *     срок хранения мытых яиц — не более 12 сут (ГОСТ 31654 п. 8.2.1, ГОСТ 31655 п. 8.2.2).
 *  3. Блюда с яйцами из ТТК; где яйцо сырое или недостаточно прогретое — решает человек; для таких блюд — опасность
 *     «сальмонеллы» в анализе опасностей (оценку делает группа ХАССП).
 *  4. Питание детей (настройка предприятия): яйца водоплавающих птиц и блюда из прил. 6 СанПиН — предупреждение.
 * Значения из ГОСТ показываются с пунктом и страницей; то, чего в документах нет, система не подставляет.
 */
var MC_V82_SRC_ = {
  G54: 'ГОСТ 31654-2012 «Яйца куриные пищевые»', G55: 'ГОСТ 31655-2012 «Яйца пищевые (индюшиные, цесариные, перепелиные, страусиные)»',
  SP: 'СанПиН 2.3/2.4.4282-26, приложение 6', TR: 'ТР ТС 021/2011'
};
var MC_V82_KINDS_ = {
  CHICKEN: { name: 'куриные', gost: 'G54', classes: { 'Д': 7, 'С': 25 }, classRef: 'п. 3.1, 3.2, с. 2', store: '0…20 °C, влажность 85–88 %; при −2…0 °C — не более 90 сут', storeRef: 'п. 8.2.1, с. 7',
    marking: 'на диетических — вид (Д), категория и дата сортировки; на столовых — вид (С) и категория', markRef: 'п. 5.3.3, с. 3', categories: true },
  QUAIL: { name: 'перепелиные', gost: 'G55', classes: { 'Д': 11, 'С': 30 }, classRef: 'п. 4.2, с. 2', store: '0…8 °C, влажность 75–80 %', storeRef: 'п. 8.2.1, с. 7',
    marking: 'перепелиные яйца не маркируют (п. 5.3.1); на потребительской таре — вид, класс, дата сортировки, число яиц, срок годности и условия хранения', markRef: 'п. 5.3.1, 5.3.4, с. 3–4' },
  TURKEY: { name: 'индюшиные', gost: 'G55', classes: { 'Д': 7, 'С': 25 }, classRef: 'п. 4.2, с. 2', store: '0…8 °C, влажность 80–85 %', storeRef: 'п. 8.2.1, с. 7', marking: 'на диетических — класс (Д) и дата сортировки; на столовых — класс (С)', markRef: 'п. 5.3.3, с. 4' },
  GUINEA: { name: 'цесариные', gost: 'G55', classes: { 'Д': 30, 'С': 90 }, classRef: 'п. 4.2, с. 2', store: '0…8 °C, влажность 80–85 %', storeRef: 'п. 8.2.1, с. 7', marking: 'на диетических — класс (Д) и дата сортировки; на столовых — класс (С)', markRef: 'п. 5.3.3, с. 4' },
  OSTRICH: { name: 'страусиные', gost: 'G55', classes: { 'Д': 10, 'С': 30 }, classRef: 'п. 4.2, с. 2', store: '0…8 °C, влажность 65–70 %', storeRef: 'п. 8.2.1, с. 7', marking: 'на диетических — класс (Д) и дата сортировки; на столовых — класс (С)', markRef: 'п. 5.3.3, с. 4' },
  WATERFOWL: { name: 'водоплавающих птиц (утиные, гусиные)', gost: '', classes: {}, store: '', marking: '' }
};
var MC_V82_SHELL_ = { G54: 'Скорлупа чистая, без пятен крови и помета, неповрежденная (ГОСТ 31654-2012, п. 5.2.3, с. 3)', G55: 'Скорлупа чистая, без пятен крови и помета, неповрежденная (ГОСТ 31655-2012, п. 5.2.3, с. 3)' };
var MC_V82_WASH_DAYS_ = 12, MC_V82_WASH_REF_ = { G54: 'ГОСТ 31654-2012, п. 8.2.1, с. 7: мытые яйца — не более 12 сут', G55: 'ГОСТ 31655-2012, п. 8.2.2, с. 7: мытые яйца — не более 12 сут' };
var MC_V82_CHILD_ = [
  { re: /(утин|утк|гусин|гус[ьяи]|водоплава)/i, text: 'Яйца и мясо водоплавающих птиц', ref: 'СанПиН 2.3/2.4.4282-26, прил. 6, п. 7; ТР ТС 021/2011, ст. 7 (п. 7, 8)' },
  { re: /макарон\S*.*(по-флотски|с рубленым яйцом)/i, text: 'Макароны по-флотски (с фаршем), макароны с рубленым яйцом', ref: 'СанПиН 2.3/2.4.4282-26, прил. 6, п. 14' }
];
var MC_V82_SALM_ = { hazard: 'Сальмонеллы (Salmonella spp.) — яйца в скорлупе', acceptable: 'не допускаются в 125 г сырых яиц (5 образцов по 25 г, анализ в желтках)',
  basis: 'ТР ТС 021/2011, микробиологические нормативы безопасности (патогенные), группа «Яйца птицы и продукты их переработки»' };
var MC_V82_ACC_ = 'Яйца_Приёмка_V82', MC_V82_ACC_HEAD_ = ['Время', 'BatchID', 'Продукт', 'Вид птицы', 'Класс', 'Категория', 'Дата сортировки', 'Скорлупа', 'Маркировка', 'Предупреждения', 'Решение', 'Сотрудник', 'OperationID'];
var MC_V82_PROC_ = 'Ж_Обработка_Яиц_V82', MC_V82_PROC_HEAD_ = ['Дата', 'Время', 'Партия', 'Яйца', 'Количество', 'Ед.', 'Средство', 'Концентрация', 'Экспозиция', 'Способ', 'Хранить мытые до', 'Основание срока', 'ФИО', 'Должность', 'OperationID', 'Для чего', 'Расход (ID)'];
var MC_V82_DISH_ = 'Яйца_Блюда_V82', MC_V82_DISH_HEAD_ = ['Код', 'Блюдо', 'Яйцо в блюде', 'Пояснение', 'Изменил', 'Изменено'];
var MC_V82_VIEW_ = 'haccp|haccp_view|stock|ttk_approve|journals';

function _v82Kind_(name) {
  var n = String(name || '').toLowerCase().replace(/ё/g, 'е');
  if (!/яйц|яиц/.test(n) || /меланж|порош|майонез|лапш|макарон|печень|паштет/.test(n)) return null;
  if (/утин|утк|гусин|гус[ьяи]/.test(n)) return 'WATERFOWL';
  if (/перепел/.test(n)) return 'QUAIL';
  if (/индюш|индейк/.test(n)) return 'TURKEY';
  if (/цесар/.test(n)) return 'GUINEA';
  if (/страус/.test(n)) return 'OSTRICH';
  return 'CHICKEN';   // «яйца куриные», «яйцо С1», «яйца» без вида — проверяет принимающий (поле «Вид птицы»)
}
function _v82Rule_(kind) {
  var k = MC_V82_KINDS_[kind]; if (!k) return null;
  return { kind: kind, name: k.name, doc: k.gost ? MC_V82_SRC_[k.gost] : '', classes: k.classes, classRef: k.classRef || '', store: k.store, storeRef: k.storeRef || '', marking: k.marking, markRef: k.markRef || '',
    shell: k.gost ? MC_V82_SHELL_[k.gost] : '', categories: !!k.categories, washDays: k.gost ? MC_V82_WASH_DAYS_ : null, washRef: k.gost ? MC_V82_WASH_REF_[k.gost] : '',
    producerExpiry: k.gost ? (k.gost === 'G54' ? 'Срок годности устанавливает производитель (ГОСТ 31654-2012, п. 8.2.3, с. 7)' : 'Срок годности устанавливает производитель (ГОСТ 31655-2012, п. 8.2.4, с. 7)') : '' };
}
// подсказка из названия товара («Яйца куриные С0», «Д1») — только предзаполнение, отметку делает принимающий по маркировке
function _v82Hint_(name, kind) {
  var m = /(?:^|[^а-яё])([ДС])\s*([ВО0123])?(?![а-яё])/i.exec(String(name || '').replace(/^яйц\S*/i, ''));
  if (!m) return null; var cls = m[1].toUpperCase(), cat = m[2] ? m[2].toUpperCase().replace('0', 'О') : '';
  return { cls: cls, cat: kind === 'CHICKEN' ? cat : '' };
}
function _v82Props_() { return PropertiesService.getScriptProperties(); }
function _v82Children_() { return _v82Props_().getProperty('MC_V82_CHILDREN') === 'да'; }
function _v82Day_(d) { return d instanceof Date ? Utilities.formatDate(d, _mcTz_(), 'dd.MM.yyyy') : String(d || ''); }
function _v82Rows_(name, head) {
  var sh = _book_().getSheetByName(name); if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues().map(function (r, i) { var o = { _row: i + 2 }; head.forEach(function (h, j) { o[h] = r[j]; }); return o; });
}
function _v82Fail_(op, code, msg) { _endOp_(op, 'FAILED'); return _fail_(code, msg, op.id); }

/* ---------------- 1. приёмка ---------------- */
// «Контроль партий»: у партии яиц — правила ГОСТ по виду птицы
(function () {
  if (typeof _bcControlList_ !== 'function') return;
  var orig = _bcControlList_;
  _bcControlList_ = function () {
    var out = orig.apply(this, arguments);
    try { var ch = _v82Children_(); ['quarantine', 'recheck'].forEach(function (k) { (out[k] || []).forEach(function (it) { var kd = _v82Kind_(it.product); if (kd) { it.egg = _v82Rule_(kd); it.egg.children = ch; it.egg.hint = _v82Hint_(it.product, kd); } }); }); } catch (e) {}
    return out;
  };
})();
// входной контроль партии яиц: обязательные отметки по ГОСТ; «не соответствует» → карантин той же проверкой
try {
  var _v82o_inc_ = mcRecordIncomingControl;
  mcRecordIncomingControl = function (json, token) {
    var d = {}; try { d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}); } catch (e) { return _v82o_inc_(json, token); }
    var b = null; try { b = _bcFind_(d.batchId); } catch (e) {}
    var kind = b ? _v82Kind_(b.v[1]) : null;
    if (!kind) return _v82o_inc_(json, token);
    if (d.eggKind && MC_V82_KINDS_[d.eggKind]) kind = d.eggKind;
    var R = _v82Rule_(kind), bad = function (m) { return JSON.stringify({ success: false, error: { code: 'VALIDATION', message: 'Яйца: ' + m } }); };
    var warn = [];
    if (kind === 'WATERFOWL') {
      warn.push('яйца водоплавающих птиц — ' + (_v82Children_() ? 'в питании детей не допускаются (' + MC_V82_CHILD_[0].ref + ')' : 'ГОСТ 31654/31655 на них не распространяется'));
    } else {
      if (!/^(PASS|FAIL)$/.test(String(d.eggShell || ''))) return bad('отметьте скорлупу — ' + R.shell);
      if (!/^(PASS|FAIL)$/.test(String(d.eggMarking || ''))) return bad('отметьте маркировку — ' + R.marking + ' (' + R.doc + ', ' + R.markRef + ')');
      if (!/^(Д|С)$/.test(String(d.eggClass || ''))) return bad('укажите ' + (kind === 'CHICKEN' ? 'вид' : 'класс') + ' по маркировке: Д — диетические, С — столовые');
      if (R.categories && !/^(В|О|1|2|3)$/.test(String(d.eggCategory || ''))) return bad('укажите категорию куриных яиц по маркировке: В, О, 1, 2 или 3 (ГОСТ 31654-2012, п. 5.3.3)');
      if (d.eggClass === 'Д' && !d.eggSorted) return bad('у диетических яиц укажите дату сортировки с маркировки (' + R.markRef + ')');
      if (d.eggShell === 'FAIL') { d.organoleptic = 'FAIL'; warn.push('скорлупа не соответствует (' + R.shell + ')'); }
      if (d.eggMarking === 'FAIL') { d.packaging = 'FAIL'; warn.push('маркировка не соответствует (' + R.doc + ', ' + R.markRef + ')'); }
      var sorted = d.eggSorted ? _mcDateOnly_(d.eggSorted) : null, exp = b.v[5] instanceof Date ? b.v[5] : (b.v[5] ? _parseDate_(b.v[5]) : null), max = R.classes[d.eggClass];
      if (sorted && exp && max) { var days = Math.round((exp.getTime() - sorted.getTime()) / 864e5);
        if (days > max) warn.push('на маркировке срок ' + days + ' сут от сортировки — больше, чем ГОСТ допускает для класса «' + d.eggClass + '» (' + max + ' сут, ' + R.doc + ', ' + R.classRef + '); проверьте'); }
      if (sorted && d.eggClass === 'Д' && max && Date.now() - sorted.getTime() > max * 864e5) warn.push('с даты сортировки прошло больше ' + max + ' сут — это уже не диетические яйца (' + R.doc + ', ' + R.classRef + ')');
    }
    var r = _v82o_inc_(JSON.stringify(d), token);
    try {
      var x = typeof r === 'string' ? JSON.parse(r) : r;
      if (x && (x.ok || x.success) && x.data) {
        var who = _author_(token);
        _bcSheet_(MC_V82_ACC_, MC_V82_ACC_HEAD_).appendRow([new Date(), String(b.v[0]), String(b.v[1]), R.name, d.eggClass || '', d.eggCategory || '', d.eggSorted ? _v82Day_(_mcDateOnly_(d.eggSorted)) : '',
          d.eggShell || '', d.eggMarking || '', warn.join('; '), String(x.data.decision || ''), who.фио, x.operation_id || '']);
        x.data.eggWarnings = warn; return typeof r === 'string' ? JSON.stringify(x) : x;
      }
    } catch (e) {}
    return r;
  };
} catch (e) {}

/* ---------------- 2. обработка яиц ---------------- */
function _v82Regimes_() {
  var R = {}; _v82Rows_(V41_DS.REGIME, V41_HEADERS.REGIME).forEach(function (r) { R[String(r.RegimeID)] = r; });
  var M = {}; _v82Rows_(V41_DS.MASTER, V41_HEADERS.MASTER).forEach(function (m) { M[String(m.DisinfectantID)] = m; });
  return Object.keys(R).map(function (k) { var r = R[k], m = M[String(r.DisinfectantID)] || {}, scope = [r.ObjectScope, r.Method, r.Notes].join(' ');   // назначение — у режима (по инструкции), не у средства в целом
    return { id: k, product: String(m.ProductName || ''), conc: String(r.ConcentrationRaw || ''), exposure: String(r.ExposureRaw || ''), method: String(r.Method || ''), scope: String(r.ObjectScope || ''),
      approved: String(r.ApprovalStatus) === 'APPROVED' && String(m.ApprovalStatus) === 'APPROVED' && String(m.AllowedForCatering) === 'YES', eggs: /яйц|яиц/i.test(scope) }; });
}
function _v82Regime_() { var id = _v82Props_().getProperty('MC_V82_EGG_REGIME'); return id ? _v82Regimes_().filter(function (r) { return r.id === id; })[0] || null : null; }
/** Режим обработки яиц: {regimeId} — только утверждённый режим, в назначении которого указаны яйца. Ответственный за ХАССП. */
function v82SetRegime(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp|haccp_approve', 'EGG_REGIME_SET', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), r = _v82Regimes_().filter(function (x) { return x.id === String(d.regimeId || ''); })[0];
    if (!r) return _v82Fail_(op, 'NOT_FOUND', 'Режим не найден');
    if (!r.approved) return _v82Fail_(op, 'VALIDATION', 'Режим не утверждён — утвердите его в «Дезсредства»');
    if (!r.eggs) return _v82Fail_(op, 'VALIDATION', 'В назначении режима (по инструкции к средству) не указана обработка яиц — выберите другой режим или внесите режим для яиц из инструкции');
    _v82Props_().setProperty('MC_V82_EGG_REGIME', r.id);
    if (!_v82Props_().getProperty('MC_V82_EGG_REGIME_AT')) _v82Props_().setProperty('MC_V82_EGG_REGIME_AT', String(Date.now()));   // с этого момента расход яиц ждёт записи об обработке (V83)
    _audit_(op, 'EGG_REGIME_SET', 'ХАССП', r.id, null, { средство: r.product, концентрация: r.conc, экспозиция: r.exposure });
    _endOp_(op); return _ok_(r, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Обработаны яйца: {batchId, qty, confirm: true}. Строка журнала; срок хранения мытых — не более 12 сут по ГОСТ. */
function v82ProcessEggs(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'journals', 'EGG_PROCESS', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (op.session && op.session.dev) return _v82Fail_(op, 'FORBIDDEN', 'Технический доступ записей не делает');
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), reg = _v82Regime_();
    if (!reg) return _v82Fail_(op, 'STATE', 'Режим обработки яиц не выбран — его выбирает ответственный за ХАССП (экран «Яйца» → «Обработка»)');
    if (!reg.approved) return _v82Fail_(op, 'STATE', 'Выбранный режим больше не утверждён — обратитесь к ответственному за ХАССП');
    var b = _bcFind_(d.batchId); if (!b) return _v82Fail_(op, 'NOT_FOUND', 'Партия не найдена');
    var kind = _v82Kind_(b.v[1]); if (!kind || kind === 'WATERFOWL') return _v82Fail_(op, 'VALIDATION', '«' + b.v[1] + '» — не яйца, на которые распространяется ГОСТ 31654/31655');
    if (String(b.v[10] || 'active') !== 'active') return _v82Fail_(op, 'VALIDATION', 'Партия не допущена (статус «' + b.v[10] + '»)');
    var qty = parseFloat(String(d.qty === undefined ? '' : d.qty).replace(',', '.')); if (!(qty > 0) || qty > (parseFloat(b.v[9]) || 0) + 0.0005) return _v82Fail_(op, 'VALIDATION', 'Количество — от 0 до остатка партии (' + b.v[9] + ' ' + b.v[2] + ')');
    if (d.confirm !== true) return _v82Fail_(op, 'VALIDATION', 'Подтвердите, что обработали яйца по режиму: ' + reg.product + ', ' + reg.conc + ', ' + reg.exposure);
    var R = _v82Rule_(kind), now = new Date(), lim = new Date(now.getTime() + MC_V82_WASH_DAYS_ * 864e5), exp = b.v[5] instanceof Date ? b.v[5] : (b.v[5] ? _parseDate_(b.v[5]) : null), until = exp && exp < lim ? exp : lim, a = _author_(op);
    return _withLock_(function () {
      _bcSheet_(MC_V82_PROC_, MC_V82_PROC_HEAD_).appendRow([_v82Day_(now), "'" + Utilities.formatDate(now, _mcTz_(), 'HH:mm'), String(b.v[0]), String(b.v[1]), qty, String(b.v[2] || ''), reg.product, reg.conc, reg.exposure, reg.method,
        _v82Day_(until), R.washRef, a.фио, a.должность, op.id, 'партия на складе (до использования)', '']);
      var changed = !exp || until.getTime() < exp.getTime();
      if (changed) b.sh.getRange(b.row, 6).setValue(until);
      _audit_(op, 'EGG_PROCESS', 'ХАССП', String(b.v[0]), exp ? { годен_до: _v82Day_(exp) } : null, { обработано: qty, средство: reg.product, режим: reg.conc + ' / ' + reg.exposure, хранить_до: _v82Day_(until) });
      _endOp_(op); return _ok_({ batchId: String(b.v[0]), until: _v82Day_(until), expiryChanged: changed, basis: R.washRef }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- 3. блюда с яйцами ---------------- */
function _v82EggIng_(n) { return /яйц|яиц|желток|белок яич|меланж/i.test(String(n || '')); }
function _v82Dishes_() {
  var idx = _buildDishIndexes_(), byName = idx.dishByNormName, marks = {}, out = [];
  _v82Rows_(MC_V82_DISH_, MC_V82_DISH_HEAD_).forEach(function (r) { marks[String(r['Код'])] = { mode: String(r['Яйцо в блюде']), note: String(r['Пояснение'] || ''), by: String(r['Изменил'] || '') }; });
  var eggsOf = function (d, depth) {
    var E = []; (d.ing || []).forEach(function (g) { var n = String(g[0] || ''); if (_v82EggIng_(n)) E.push(n); else if (depth < 2) { var s = _findSubDish_(n, byName, idx.dishByLooseName); if (s && s !== d) eggsOf(s, depth + 1).forEach(function (x) { E.push(x + ' (в «' + s.name + '»)'); }); } });
    return E;
  };
  Object.keys(idx.dishByCode).forEach(function (c) {
    var d = idx.dishByCode[c], E = eggsOf(d, 0), child = MC_V82_CHILD_.filter(function (r) { return r.re.test(d.name) || (d.ing || []).some(function (g) { return r.re.test(String(g[0] || '')); }); });
    if (!E.length && !child.length) return;
    var m = marks[String(c)] || {};
    out.push({ code: String(c), name: String(d.name), semi: !!d.semi, eggs: E, mode: m.mode || '', note: m.note || '', by: m.by || '', child: child.map(function (r) { return r.text + ' (' + r.ref + ')'; }) });
  });
  return out.sort(function (a, b) { return (a.mode === 'RAW' ? 0 : a.mode ? 2 : 1) - (b.mode === 'RAW' ? 0 : b.mode ? 2 : 1) || a.name.localeCompare(b.name, 'ru'); });
}
/** Отметка блюда: {code, mode: 'RAW' (сырое или недостаточно прогретое яйцо) | 'COOKED', note}. Ответственный за ХАССП или шеф-повар. */
function v82MarkDish(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp|ttk_approve', 'EGG_DISH_MARK', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), dish = _v82Dishes_().filter(function (x) { return x.code === String(d.code || ''); })[0];
    if (!dish) return _v82Fail_(op, 'NOT_FOUND', 'Блюдо с яйцами не найдено в ТТК');
    if (!/^(RAW|COOKED)$/.test(String(d.mode || ''))) return _v82Fail_(op, 'VALIDATION', 'Отметьте: яйцо сырое / недостаточно прогретое или проходит тепловую обработку');
    if (d.mode === 'COOKED' && String(d.note || '').trim().length < 3) return _v82Fail_(op, 'VALIDATION', 'Укажите, какая тепловая обработка по ТТК (например: варка вкрутую, запекание)');
    var who = _author_(op).фио;
    _withLock_(function () {
      var sh = _bcSheet_(MC_V82_DISH_, MC_V82_DISH_HEAD_), ex = _v82Rows_(MC_V82_DISH_, MC_V82_DISH_HEAD_).filter(function (r) { return String(r['Код']) === dish.code; })[0];
      var row = [dish.code, dish.name, d.mode, String(d.note || ''), who, new Date()];
      if (ex) sh.getRange(ex._row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
    });
    _audit_(op, 'EGG_DISH_MARK', 'ХАССП', dish.code, null, { блюдо: dish.name, яйцо: d.mode, пояснение: d.note || '' });
    _endOp_(op); return _ok_({ code: dish.code, mode: d.mode }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v82SalmDescribed_() {
  try { var sh = _book_().getSheetByName(MC_V30.HAZARD); if (!sh || sh.getLastRow() < 2) return false; return sh.getDataRange().getValues().slice(1).some(function (r) { return r.some(function (c) { return /сальмонел|salmonell/i.test(String(c || '')); }); }); } catch (e) { return false; }
}

/* ---------------- 4. питание детей ---------------- */
/** {children: true|false} — предприятие организует питание детей. Директор. */
function v82SetChildren(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp_approve|system', 'EGG_CHILDREN_SET', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), on = d.children === true;
    _v82Props_().setProperty('MC_V82_CHILDREN', on ? 'да' : 'нет');
    _audit_(op, 'EGG_CHILDREN_SET', 'ХАССП', '', null, { питание_детей: on });
    _endOp_(op); return _ok_({ children: on }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- экран ---------------- */
function v82Data(token) {
  var op = null;
  try { op = _beginOp_(token, MC_V82_VIEW_, 'EGG_VIEW', 'ХАССП', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var v = _stockBatchesSheet_().getDataRange().getValues(), batches = [];
    for (var i = 1; i < v.length; i++) { var k = v[i][0] && _v82Kind_(v[i][1]); if (!k || k === 'WATERFOWL' || String(v[i][10] || 'active') !== 'active' || !((parseFloat(v[i][9]) || 0) > 0)) continue;
      batches.push({ id: String(v[i][0]), product: String(v[i][1]), qty: v[i][9], unit: String(v[i][2] || ''), expiry: v[i][5] instanceof Date ? _v82Day_(v[i][5]) : String(v[i][5] || ''), kind: k }); }
    var acc = _v82Rows_(MC_V82_ACC_, MC_V82_ACC_HEAD_).reverse().slice(0, 30).map(function (r) { return { at: r['Время'] instanceof Date ? Utilities.formatDate(r['Время'], _mcTz_(), 'dd.MM HH:mm') : '', batch: String(r.BatchID), product: String(r['Продукт']),
      kind: String(r['Вид птицы']), cls: String(r['Класс']), cat: String(r['Категория']), sorted: String(r['Дата сортировки'] || ''), shell: String(r['Скорлупа']), marking: String(r['Маркировка']), warn: String(r['Предупреждения'] || ''), decision: String(r['Решение']), by: String(r['Сотрудник']) }; });
    var proc = _v82Rows_(MC_V82_PROC_, MC_V82_PROC_HEAD_).reverse().slice(0, 30).map(function (r) { var o = {}; MC_V82_PROC_HEAD_.forEach(function (h) { o[h] = r[h] instanceof Date ? (h === 'Время' ? Utilities.formatDate(r[h], _mcTz_(), 'HH:mm') : _v82Day_(r[h])) : String(r[h] === undefined ? '' : r[h]).replace(/^'/, ''); }); return o; });
    var dishes = _v82Dishes_(), raw = dishes.filter(function (x) { return x.mode === 'RAW'; });
    var rules = ['CHICKEN', 'QUAIL', 'TURKEY', 'GUINEA', 'OSTRICH'].map(_v82Rule_);
    var s = op.session || {}, can = function (spec) { return _mcRbHasExact_(s, spec); };
    _endOp_(op);
    return _ok_({ rules: rules, children: _v82Children_(), childRules: MC_V82_CHILD_.map(function (r) { return { text: r.text, ref: r.ref }; }), regimes: _v82Regimes_().filter(function (r) { return r.approved; }), regime: _v82Regime_(),
      batches: batches, acceptances: acc, processed: proc, dishes: dishes, rawCount: raw.length, salmonella: _v82SalmDescribed_(), salm: MC_V82_SALM_, rawNames: raw.map(function (x) { return x.name; }),
      can: { regime: can('haccp|haccp_approve'), process: !s.dev && can('journals'), mark: can('haccp|ttk_approve'), children: can('haccp_approve|system') } }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  var orig = _UI_BUILDERS_.haccp; if (typeof orig !== 'function') return;
  _UI_BUILDERS_.haccp = function (token, opts, s) { var r = orig(token, opts, s) || {}; try { r.actions = (r.actions || []).concat([{ label: 'Яйца', module: 'eggs' }]); } catch (e) {} return r; };
})();
try { if (MC_UI_VIEWS_.indexOf('eggs') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['eggs']); } catch (e) {}
