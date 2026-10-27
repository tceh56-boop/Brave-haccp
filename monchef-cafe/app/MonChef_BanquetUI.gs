/**
 * MON CHEF — банкет в новом интерфейсе: карточка банкета с закупкой, новый банкет, скан бланка.
 *
 * uiBanquetDetail — банкет целиком: данные, меню (блюда по ТТК), потребность в продуктах
 *   (раскладка ТТК через п/ф до сырья, готовые п/ф со склада учитываются), остаток, резерв
 *   других банкетов, сколько купить, оценка суммы по средней цене склада, заказы поставщикам
 *   по этому банкету.
 * uiBanquetScan   — распознавание бланка (тот же OCR, что в прежнем интерфейсе) + сопоставление
 *   строк с ТТК. Результат — только черновик: человек проверяет и сохраняет.
 * uiBanquetSaveBlank — фото бланка на Диск (приватно), ID файла хранится в банкете.
 * uiDishList      — список блюд для формы банкета.
 * Сохранение банкета — прежний saveEvent (резерв продуктов, канбан, себестоимость).
 */
function uiDishList(token) {
  try {
    _requireAuth_(token);
    var idx = _buildDishIndexes_(), arch = typeof _ttkArchived_ === 'function' ? _ttkArchived_() : {};   // этап 10.7: карты в архиве в новые банкеты не предлагаются
    var out = Object.keys(idx.dishByCode).filter(function (k) { return !arch[k]; }).map(function (k) { var d = idx.dishByCode[k]; return { code: d.code, name: d.name, semi: d.semi }; })
      .sort(function (a, b) { return (a.semi ? 1 : 0) - (b.semi ? 1 : 0) || a.name.localeCompare(b.name, 'ru'); });
    return { ok: true, dishes: out };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

/* ---------- подбор ТТК для строки бланка (2026-10) ----------
 * Шаги: 1) точное название; 2) синоним, сохранённый человеком (лист «ТТК_Синонимы»); 3) без веса/знаков/«п/ф»;
 * 4) без ремарок («требуется гарнир», «заказ от 2х тарелок», «1шт»), с исправлением типичных ошибок OCR
 *    (латиница вместо кириллицы, «0» вместо «о», удвоенные буквы «свинная/свиная»);
 * 5) нечёткий поиск по ВСЕМ картам (слова + триграммы) → до 30 кандидатов → переоценка по составу:
 *    основной продукт (курица/свинина/лосось…), вид блюда (салат/рулетики/филе…), состав в скобках против
 *    ингредиентов ТТК; полуфабрикаты ниже. Цена НЕ используется.
 * Статусы: подтверждена (шаги 1–4) · предполагаемая (один явный лидер — выбран, но помечен) ·
 *          несколько вариантов (не выбирается) · не найдена · не требуется (услуга, примечание).
 * Неоднозначное никогда не подтверждается автоматически. */
var BQM_MAIN_ = { 'курица': /кур(ин|иц)|цыпл|бройл/, 'говядина': /говя|телят|ростбиф|вырезк|теляч/, 'свинина': /свин|буженин|корейк/, 'утка': /утк|утин/, 'индейка': /индей/,
  'баранина': /баран|ягнят/, 'лосось/сёмга': /лосос|семг|форел/, 'судак': /судак/, 'тунец': /тунц|тунец/, 'скумбрия': /скумбр/, 'сельдь': /сельд/, 'креветки': /кревет/,
  'икра': /икр[аоы]/, 'грибы': /гриб|шампин|опят|маслят/, 'язык': /язык/, 'колбасы': /колбас|салями|хамон/, 'конина': /конин/, 'фрукты': /фрукт|клубник/ };
var BQM_TYPE_ = { 'салат': /^салат/, 'суп': /^суп|^бульон|^борщ/, 'рулетики/рулет': /^рулет|^рулад/, 'блинчики': /^блин/, 'ассорти': /^ассорти|^плато|^платтер|^сет(?![а-я])|^сэт|^трио|^закуск/,
  'канапе/брускеты': /^канап|^брускет/, 'пицца': /^пицц/, 'манты/голубцы': /^мант|^голубц|^пельмен/, 'горячее мясо': /^стейк|^филе|^медальон|^шашлык|^шашлычк|^казан|^кебаб|^буженин|^утка|^куриное|^тунец/,
  'гарнир': /^картоф|^пюре|^рис(?![а-я])|^овощи/, 'хлеб': /^булочк|^багет|^мини\s+багет|^хлеб/, 'напиток': /^вода|^морс|^сок|^бон\s*аква|^лимонад|^чай|^кофе/, 'десерт': /^десерт|^торт|^пирож|^чизкейк/ };
var BQM_STOP_ = { 'с': 1, 'и': 1, 'из': 1, 'на': 1, 'в': 1, 'со': 1, 'под': 1, 'для': 1, 'по': 1, 'от': 1, 'за': 1, 'к': 1, 'без': 1, 'или': 1, 'а': 1 };
function _bqmNorm_(s) {
  var lat = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', u: 'и', n: 'п' };
  return String(s || '').toLowerCase().replace(/ё/g, 'е')
    .replace(/[a-z]/g, function (c) { return lat[c] || c; })
    .replace(/(^|[а-я])0(?=[а-я])/g, '$1о').replace(/([а-я])3(?=[а-я])/g, '$1з')
    .replace(/["«»“”'`]/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Название без ремарок кухни/зала: «(требуется гарнир)», «заказ от 2х тарелок», «(стоимость за 1шт)», «1шт», «подаются в баночках». */
function _bqmCore_(s) {
  return _bqmNorm_(s).replace(/\((?:[^()]*?)(требуется|гарнир|заказ|стоимость|подает|подают|подаёт|подаю|баночк|порци|персон|сезон|может|могут)[^()]*\)?/g, ' ')
    .replace(/заказ от \d+\s*х?\s*(штук|тарелок|порций|шт)\.?/g, ' ').replace(/\(?\s*требуется\s+гарнир\s*\)?/g, ' ').replace(/\(?\s*гарнир не требуется\s*\)?/g, ' ')
    .replace(/(^|[^а-яa-z0-9])\d+\s*(шт|гр|г|мл|л|литр|кг)(?![а-яa-z])\.?/g, '$1 ').replace(/[(),.;:\\\/№+\-–—]/g, ' ').replace(/(.)\1+/g, '$1').replace(/\s+/g, ' ').trim();
}
/** Слова названия для сравнения: без скобок-состава, веса, «банкет», «п/ф»; «сэт» = «сет». */
function _bqmWords_(s, keepPar) {
  var n = keepPar ? _bqmCore_(s) : _bqmCore_(String(s || '').replace(/\([^)]*\)?/g, ' '));
  return n.replace(/(^| )сэт(?= |$)/g, '$1сет').replace(/(^| )(банкет\S*|пф|п ф)(?= |$)/g, ' ').split(' ').filter(function (w) { return w && !BQM_STOP_[w] && !/^\d/.test(w) && w.length > 1; });
}
function _bqmStems_(s) { return _bqmWords_(s, true).filter(function (w) { return w.length > 2; }).map(function (w) { return w.slice(0, 5); }); }
/** Слово с бланка и слово карты совпадают: равны, общее начало 5 букв, или одно — сокращение другого («копч» — «копченой», «делик» — «деликатесных»). */
function _bqmWEq_(a, b) {
  if (a === b) return true;
  var m = Math.min(a.length, b.length);
  if (m >= 5 && a.slice(0, 5) === b.slice(0, 5)) return true;
  return m >= 3 && (a.indexOf(b) === 0 || b.indexOf(a) === 0);
}
/** Доля совпавших слов (Дайс с жадным сопоставлением) и сами совпавшие слова. */
function _bqmDice_(A, B) {
  var used = {}, hit = [];
  A.forEach(function (a) { for (var j = 0; j < B.length; j++) if (!used[j] && _bqmWEq_(a, B[j])) { used[j] = 1; hit.push(a); break; } });
  return { d: A.length + B.length ? 2 * hit.length / (A.length + B.length) : 0, hit: hit };
}
/** Выход: «90/10» → [90,10,100], «1литр» → [1000], «200мл» → [200]; из названия карты — числа с «г/гр/мл» и дроби «40/15». */
function _bqmYields_(s) {
  var t = String(s || '').toLowerCase().replace(/\\/g, '/'), out = [];
  var m = /(\d+(?:[.,]\d+)?)\s*(литр|л)(?![а-я])/.exec(t); if (m) out.push(Math.round(parseFloat(m[1].replace(',', '.')) * 1000));
  (t.match(/\d+(?:\/\d+)+/g) || []).forEach(function (f) { var p = f.split('/').map(Number); p.forEach(function (x) { out.push(x); }); out.push(p.reduce(function (a, b) { return a + b; }, 0)); });
  (t.match(/\d+(?:[.,]\d+)?\s*(?:г|гр|мл)(?![а-я])/g) || []).forEach(function (f) { out.push(parseFloat(f.replace(',', '.'))); });
  if (!out.length && /^\s*\d+\s*$/.test(t)) out.push(+t);
  return out.filter(function (x) { return x > 0; });
}
function _bqmTri_(a, b) {
  a = a.replace(/\s/g, ''); b = b.replace(/\s/g, ''); if (!a || !b) return 0; if (a === b) return 1;
  var g = function (s) { var m = {}; for (var i = 0; i < s.length - 2; i++) m[s.substr(i, 3)] = (m[s.substr(i, 3)] || 0) + 1; return m; }, A = g(a), B = g(b), x = 0, na = 0, nb = 0;
  Object.keys(A).forEach(function (k) { na += A[k]; if (B[k]) x += Math.min(A[k], B[k]); }); Object.keys(B).forEach(function (k) { nb += B[k]; });
  return na + nb ? 2 * x / (na + nb) : 0;
}
function _bqmTags_(s, dict) { var n = _bqmNorm_(s), out = []; Object.keys(dict).forEach(function (k) { if (dict[k].test(n)) out.push(k); }); return out; }
function _bqmTypeOf_(s) { var n = _bqmCore_(s); for (var k in BQM_TYPE_) if (BQM_TYPE_[k].test(n)) return k; return ''; }
/** Синонимы, сохранённые людьми: ключ (название бланка без ремарок) → код ТТК. */
function _bqAliasSheet_() {
  var ss = _book_(), sh = ss.getSheetByName('ТТК_Синонимы');
  if (!sh) { sh = ss.insertSheet('ТТК_Синонимы'); sh.appendRow(['Ключ', 'Название на бланке', 'Код ТТК', 'Название ТТК', 'Кто сохранил', 'Когда', 'Раз подтверждено']); sh.setFrozenRows(1); sh.getRange(1, 1, 1, 7).setBackground('#6e1423').setFontColor('#ffffff').setFontWeight('bold'); }
  return sh;
}
function _bqAliases_() {
  var m = {};
  try { var sh = _book_().getSheetByName('ТТК_Синонимы'); if (sh) sh.getDataRange().getValues().slice(1).forEach(function (r) { if (r[0] && r[2]) m[String(r[0])] = String(r[2]); }); } catch (e) {}
  return m;
}
function _bqMatch_(idx, row, ctx) {
  ctx = ctx || {};
  var name = String((row && row.name) || '').trim(), kind = (row && row.kind) || 'dish';
  var res = { status: 'не найдена', method: '', confidence: 0, code: '', name: '', cands: [], reasons: [] };
  if (!name) { res.reasons.push('нет названия'); return res; }
  var arch = ctx.arch || {}, dishes = ctx.dishes || Object.keys(idx.dishByCode).filter(function (k) { return !arch[k]; }).map(function (k) { return idx.dishByCode[k]; });
  var ok = function (d, method, conf, why) { res.status = 'подтверждена'; res.method = method; res.confidence = conf; res.code = d.code; res.name = d.name; res.reasons.push(why); return res; };
  var d = idx.dishByNormName[_normNameServer_(name)];
  if (d && !arch[d.code]) return ok(d, 'точное название', 1, 'название совпадает с картой ТТК');
  var key = _bqmCore_(name), al = (ctx.aliases || {})[key];
  if (al && idx.dishByCode[al] && !arch[al]) return ok(idx.dishByCode[al], 'синоним', 0.98, 'сохранённый синоним: «' + name + '» → ' + idx.dishByCode[al].name);
  d = _findSubDish_(name, idx.dishByNormName, idx.dishByLooseName);
  if (d && !arch[d.code]) return ok(d, 'без веса и знаков', 0.95, 'совпадает без веса, «п/ф» и знаков');
  var exact = dishes.filter(function (x) { return _bqmCore_(x.name) === key && key.length >= 4; });
  if (exact.length === 1) return ok(exact[0], 'без ремарок и опечаток OCR', 0.92, 'совпадает без ремарок («требуется гарнир», «заказ от…») и типичных ошибок распознавания');
  // широкий набор кандидатов → переоценка по составу
  var wA = _bqmWords_(name), wAp = _bqmWords_(name, true), mainA = _bqmTags_(name, BQM_MAIN_), typeA = _bqmTypeOf_(name);
  var inPar = (String(name).match(/\(([^)]*)\)?/) || [])[1] || '', parW = _bqmWords_(inPar, true), yA = _bqmYields_(row && row.yield);
  var keyNP = wA.join(' ');
  var scored = dishes.map(function (x) {
    var wB = _bqmWords_(x.name), d1 = _bqmDice_(wA, wB), d2 = _bqmDice_(wAp, wB), dd = d1.d >= d2.d ? d1 : d2;
    // название карты короче («Вителло Тонато 50 г» для «Вителло Тонатто с трюфельным маслом»): доля слов карты, найденных в бланке
    var cover = wB.length ? _bqmDice_(wB, wA).hit.length / wB.length : 0;
    var tri = Math.max(_bqmTri_(keyNP, wB.join(' ')), _bqmTri_(key, _bqmCore_(x.name)));
    var base = Math.max(0.55 * dd.d + 0.45 * tri, wB.length >= 2 ? 0.5 * cover + 0.3 * tri + 0.2 * dd.d : 0);
    return { x: x, base: base, common: dd.hit };
  }).filter(function (o) { return o.base >= 0.2; }).sort(function (a, b) { return b.base - a.base; }).slice(0, 30);
  scored.forEach(function (o) {
    var why = [], sc = o.base, mainB = _bqmTags_(o.x.name, BQM_MAIN_), typeB = _bqmTypeOf_(o.x.name);
    if (o.common.length) why.push('общие слова: ' + o.common.slice(0, 4).join(', '));
    if (mainA.length && mainB.length) {
      var same = mainA.filter(function (m) { return mainB.indexOf(m) >= 0; });
      if (same.length) { sc += 0.08; why.push('основной продукт: ' + same.join(', ') + ' ✓'); } else { sc -= 0.25; why.push('другой основной продукт: ' + mainB.join(', ') + ' вместо ' + mainA.join(', ')); }
    }
    if (typeA && typeB) { if (typeA === typeB) { sc += 0.06; why.push('вид блюда: ' + typeA + ' ✓'); } else { sc -= 0.2; why.push('другой вид блюда: ' + typeB); } }
    if (parW.length && o.x.ing && o.x.ing.length) {
      var ingW = []; o.x.ing.forEach(function (g) { _bqmWords_(g[0], true).forEach(function (w) { ingW.push(w); }); });
      var hit = _bqmDice_(parW, ingW).hit;
      if (hit.length) { sc += Math.min(0.12, hit.length * 0.03); why.push('состав совпадает: ' + hit.slice(0, 4).join(', ')); }
    }
    if (yA.length) {
      var yB = _bqmYields_(o.x.name).concat(o.x.yieldBase && /^(г|мл)$/.test(o.x.yieldUnit) ? [Math.round(o.x.yieldBase)] : []);
      if (yB.some(function (v) { return yA.indexOf(v) >= 0; })) { sc += 0.06; why.push('выход совпадает'); }
      else if (yB.some(function (v) { return yA.some(function (a) { return a >= 20 && Math.abs(v - a) / a <= 0.12; }); })) { sc += 0.03; why.push('выход близкий'); }
    }
    if (o.x.semi) { sc -= 0.15; why.push('это полуфабрикат'); }
    o.score = Math.max(0, Math.min(1, Math.round(sc * 100) / 100)); o.why = why;
  });
  scored.sort(function (a, b) { return b.score - a.score; });
  res.cands = scored.filter(function (o) { return o.score >= 0.4; }).slice(0, 6).map(function (o) { return { code: o.x.code, name: o.x.name, score: o.score, reasons: o.why }; });
  if (kind === 'service' || kind === 'note') { res.status = 'не требуется'; res.reasons.push(kind === 'service' ? 'услуга — ТТК не нужна' : 'примечание — не блюдо'); return res; }
  // соперник лидера — следующая карта блюда (полуфабрикат с тем же названием не мешает выбрать блюдо)
  var t = scored[0], t2 = scored.slice(1).filter(function (o) { return !(t && !t.x.semi && o.x.semi); })[0];
  if (t && (t.score >= 0.6 && (!t2 || t.score - t2.score >= 0.12) || t.score >= 0.5 && (!t2 || t.score - t2.score >= 0.2))) {
    res.status = 'предполагаемая'; res.method = 'похожее название'; res.confidence = t.score; res.code = t.x.code; res.name = t.x.name;
    res.reasons = ['похоже на «' + t.x.name + '» (' + Math.round(t.score * 100) + '%) — подтвердите'].concat(t.why);
  } else if (res.cands.filter(function (c) { return c.score >= 0.45; }).length >= 2) {
    res.status = 'несколько вариантов'; res.method = 'похожие названия'; res.confidence = t.score; res.reasons = ['несколько похожих карт — выберите'];
  } else res.reasons.push(res.cands.length ? 'уверенного совпадения нет — выберите из похожих или вручную' : 'похожих карт нет — выберите вручную или создайте ТТК');
  return res;
}
/** Совместимость: прежний вызов {dish, cands}. Предполагаемая карта не считается найденной. */
function _bqMatchDish_(idx, name) {
  var m = _bqMatch_(idx, { name: name });
  return { dish: m.status === 'подтверждена' ? idx.dishByCode[m.code] : null, cands: m.cands.map(function (c) { return { code: c.code, name: c.name }; }) };
}

function uiBanquetScan(token, dataUrl) {
  var sess = null, t0 = Date.now();
  try {
    sess = _requireAuth_(token, 'banquets');
    if (!/^data:(image\/|application\/pdf)/.test(String(dataUrl || ''))) return { ok: false, error: 'Нужна фотография бланка (JPEG, PNG) или PDF' };
    var res = _scanOneBlank_(dataUrl), who = (sess && (sess.user_id || sess.id)) || '';
    if (res.error) { _bqLog_({ user: who, file: _bqFileSig_(dataUrl), mode: 'ошибка OCR', error: _bqScanErr_(res), ms: Date.now() - t0 }); return { ok: false, scanError: res, error: _bqScanErr_(res) }; }
    var idx = _buildDishIndexes_(), arch = typeof _ttkArchived_ === 'function' ? _ttkArchived_() : {};
    var ctx = { arch: arch, aliases: _bqAliases_(), dishes: Object.keys(idx.dishByCode).filter(function (k) { return !arch[k]; }).map(function (k) { return idx.dishByCode[k]; }) };
    var items = (res.items || []).map(function (it) {
      var q = it.qty === null || it.qty === undefined || it.qty === '' ? null : parseFloat(String(it.qty).replace(',', '.'));
      var m = _bqMatch_(idx, it, ctx), confirmed = m.status === 'подтверждена';
      return { row_id: it.row_id || '', page_number: it.page || it.page_number || 1, name: String(it.name || ''), name_ocr: it.name_ocr || '', qty: isFinite(q) ? q : null, price: it.price === undefined ? null : it.price,
        yield: it.yield || '', sum: it.sum === undefined ? null : it.sum, note: it.note || '', kind: it.kind || 'dish', status: it.status || '', warnings: it.warnings || [], qty_by_sum: it.qty_by_sum || null, info: it.info || [], qty_printed: it.qty_printed === undefined ? null : it.qty_printed,
        source: it.source || '', code: confirmed ? m.code : '', match: confirmed ? m.name : '', suggest: m.status === 'предполагаемая' ? { code: m.code, name: m.name } : null,
        match_status: m.status, match_method: m.method, match_confidence: m.confidence, ttk_id: m.code || '', match_candidates: m.cands, cands: m.cands, match_reasons: m.reasons,
        review_required: !!(it.review_required || !confirmed && m.status !== 'не требуется') };
    });
    var m = res.meta || {}, dt = _bqDateRu_(m.date);
    var out = { ok: true, items: items, mode: res.mode || '', warnings: res.warnings || [], completeness: res.completeness || null,
      tableFound: !!(res.table && res.table.ok), orient: (res.table && res.table.diag && res.table.diag.orient) || 0,
      meta: { date: dt.iso, dateRaw: m.date || '', dateNote: dt.note, time: m.time || '', format: m.format || '', place: m.place || '', guests: parseInt(m.guests, 10) || '', guestsRaw: m.guests || '', contact: m.contact || '', payment: m.payment || '', comment: m.comment || '' },
      matched: items.filter(function (x) { return x.code; }).length, total: items.length,
      needReview: items.filter(function (x) { return x.review_required; }).length };
    _bqLog_({ user: who, file: _bqFileSig_(dataUrl), mode: res.mode, items: items.map(function (x) { return { row_id: x.row_id, status: x.status, match_status: x.match_status, warnings: x.warnings, qty: x.qty, sum: x.sum, code: x.code }; }),
      completeness: res.completeness, gpt: res.gpt, ms: Date.now() - t0 });
    return out;
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
/** Сохранить синонимы после ручного выбора блюда для строки бланка: «как написано на бланке» → карта ТТК. */
function uiBanquetAliasSave(token, json) {
  try {
    var sess = _requireAuth_(token, 'banquets'), list = JSON.parse(json || '[]'), idx = _buildDishIndexes_(), who = (sess && (sess.fullName || sess.name || sess.user_id)) || '';
    if (!Array.isArray(list)) return { ok: false, error: 'Нужен список' };
    var n = 0;
    _withLock_(function () {
      var sh = _bqAliasSheet_(), v = sh.getDataRange().getValues(), at = {};
      for (var i = 1; i < v.length; i++) at[String(v[i][0])] = i + 1;
      list.slice(0, 200).forEach(function (a) {
        var key = _bqmCore_(a && a.scanned), d = a && idx.dishByCode[a.code];
        if (!key || key.length < 3 || !d) return;
        if (at[key]) { var r = at[key], cnt = String(v[r - 1][2]) === String(d.code) ? (Number(v[r - 1][6]) || 1) + 1 : 1; sh.getRange(r, 2, 1, 6).setValues([[String(a.scanned).slice(0, 300), d.code, d.name, who, new Date(), cnt]]); }
        else { sh.appendRow([key, String(a.scanned).slice(0, 300), d.code, d.name, who, new Date(), 1]); at[key] = sh.getLastRow(); }
        n++;
      });
    });
    return { ok: true, saved: n };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
/**
 * Проверка доступа к Yandex Cloud для скана бланков (заказчик: «создать роль»). Ничего не пишет, ключи не показывает.
 * Два коротких запроса от имени сервисного аккаунта ключа YANDEX_API_KEY: распознавание маленькой картинки «Проверка 123»
 * (роль ai.vision.user) и ответ YandexGPT из одного слова (роль ai.languageModels.user). По коду ответа — что сделать.
 */
var BQ_CHECK_IMG_ = 'iVBORw0KGgoAAAANSUhEUgAAAQQAAAAwCAAAAADS/1vZAAAFK0lEQVR42u2af0xVZRjHP0fkwgURUrmCliKoMC1N3UDUstV0pqJiNnNIQ5e5CcqyFqXLLB2N1GWpUxdoGmo/jdzyBzhm/kwrExZqIggaaCAJCMIF7n36494D98IVcHChP87zz7v3fd7vzrPPeZ7zPufcqwia9dAQaBA0CBoEDYIGQYOgQdAgaBA0CBoEDcIjQ9io2Fn3xpWXGjfOVemlTgt3R4/10/k+t7nKumDMTJgU4O715LLszriaNNqGhzm6wXItMXiqczc1qsF/NAvW5cOOX82+HG6py/HdnKBKYNSWX1+3zdi53xU/yHnLtXBqGQD6iC3nbtUWpAab1nzZyZlgC0G63WKbMmHWFcu4H9bY7bnnz5hOzoT/rf0YYhkXDOGEncMnghxnnw4LlZlcenmAPmR1pXXlytJhHr1GxBeofkVRFPchC85Y3eUfTeirG/BS5kPkC5U5AGR4KDFmqD8eHzpQ13diUmV74x1Iuf1CTx5zdjlEMeOoHoCAfBER2eZikbl/ZfWrRZwsIiInfK3zFY7lUcwWEUnXE2MSkc9VeWB+6+WgWr0vM+wWqgcR7fxyuPfq9Eu1RRvcCyLrgEOxptHHqioOBtYuPGvxzxCR0gO+8rYJyJ5eGpR6p+5aPJ9tdiS3WsbsmkUpPQC3mXuz7j7I3dQ/f0H7btmBUmY1zczFP0y6GZDo/ExgnllE5CAki5iCCK4QESk2EGa91SIikgp3RWQSA0pERGQtPvdbyq2ZkK5nsdnuVlxx4Vx7MqHIwFCjOpkM4PNGiTg/E5QkBSByAvvgXB7regP4v8v5XJtd9fTrCzmn2WCphwSv8oyW8sY8eC3ZvhcLGc2Zdtywmrklrvt0dkuVWX92Qds8LNAyTuMCXKDHi5bpTDjfuOfuvjddNwMnUaZYHxmjuNhSrjIYuF1lULr+WYOboigXud12rHXzzispoY3TE1J/49uxmVN2dRhCz7Y2DLKOT1Bd7VlCH2snGwAlAPykADyeMgcoQvxBEATKWsoBsmfXUJS02rJ6albjs762zVAb5h9WdkbbBR8QEBlxJC7CtwtfoBQe+nPV35FxAg1gMpnMZhGgrqUc4EbNoq2stWRRzfzywTtyKhpExrd99YZX0ti6pPmqyypqMpxeDjfVjhpPD/rzr/UNpgAMjadDVVYM2/aAH72aHnjJLeUALEqJjWiIug+QeVtJXzqitwvtKAZT1Pd8usxhppY5HUJuvmU8SiiEYj5mmR6GsMY9nqN2j+QQTKbqVGtygPAUhV3+ecsthPoMB+ByYZsMor9h0woHjmvg53QIkiAAaWeJgvAg3q8G+CeRsGF226iEMeOJr2xFDmBQoN8Xyp6vAW/K8gHql7cVhXnxAZJWOnAYP0D3vNP7hHDDvCxj8UZ3njKKSBqMO15dmTaUnqeb+oTq7BhYJyJZXgzZmWesvHY8YWS5A7naMcpKfApF7rgxMr3ifkb40DHEttYnmJdAoq2rYcR7P1+vMhbsHQVrO9wntN02H3G31N51ERHZam2b3Zq1zYyvFhH5ZVBTq+lIrkIwPs0zJhFrW2n4fWJzCGE2FSVi+8jwFhGpbzohVndBs8S0M3P7uw1/JysIgNjsJUF6j5DlV+fbHlWGF3ac9AAIu7p9mp/OO3jqxzk+juSq6fbrTyVC/JEp3m6Bcb+NfeST/a9Ppgd76Xwnrrq8vlO/LDmyqGbvK49oHZR3lWkfWrWvzRoEDYJdQ6/9e03LBA2CBkGDoEHQIGgQNAgahFbtP1+MADzOkYn6AAAAAElFTkSuQmCC';
function _bqCheckAdvice_(svc, code, body) {
  var role = svc === 'gpt' ? 'ai.languageModels.user' : 'ai.vision.user', scope = svc === 'gpt' ? 'yc.ai.languageModels.execute или yc.ai.foundationModels.execute' : 'yc.ai.vision.execute или yc.ai.foundationModels.execute';
  var b = String(body || '').toLowerCase();
  if (code === 200) return '';
  if (code === 401) return 'Ключ YANDEX_API_KEY не принят (неверный, удалён или истёк срок). Создайте новый API-ключ сервисного аккаунта и замените свойство скрипта.';
  if (code === 403) return 'Нет доступа: сервисному аккаунту ключа не выдана роль ' + role + ' на каталог YANDEX_FOLDER_ID' + (/billing|платеж|payment/.test(b) ? ' или не привязан платёжный аккаунт' : '') +
    '. Консоль Yandex Cloud → каталог → «Права доступа» → «Назначить роли» → сервисный аккаунт → добавить роль ' + role + '. Если ключ создан с ограниченной областью действия — нужна область ' + scope + '.';
  if (code === 400) return 'Запрос отклонён: проверьте YANDEX_FOLDER_ID (ID каталога, вида b1g…)' + (svc === 'gpt' ? ' и BANQUET_GPT_MODEL (по умолчанию yandexgpt/latest)' : '') + '.';
  if (code === 404) return svc === 'gpt' ? 'Модель не найдена: проверьте BANQUET_GPT_MODEL (по умолчанию yandexgpt/latest) и YANDEX_FOLDER_ID.' : 'Адрес сервиса не найден — сообщите разработчику.';
  if (code === 429) return 'Превышена квота запросов Yandex Cloud — повторите позже или увеличьте квоту каталога.';
  if (code >= 500) return 'Сервис Yandex временно недоступен (код ' + code + ') — повторите через несколько минут.';
  return 'Неожиданный ответ сервиса (код ' + code + ').';
}
function uiYandexCheck(token) {
  try {
    _requireAuth_(token, 'banquet_scan');
    var props = PropertiesService.getScriptProperties();
    var key = _clean1_(props.getProperty('YANDEX_API_KEY')), folder = _clean1_(props.getProperty('YANDEX_FOLDER_ID'));
    var model = String(props.getProperty('BANQUET_GPT_MODEL') || 'yandexgpt/latest');
    var out = { ok: false, keySet: !!key, folderSet: !!folder, folderLooksRight: /^b1g[a-z0-9]{10,}$/.test(folder || ''), model: model, ocr: null, gpt: null, roles: ['ai.vision.user — распознавание фото (Vision OCR)', 'ai.languageModels.user — YandexGPT (уточнение названий и разбор текста)'] };
    if (!key || !folder) { out.summary = 'Не заданы свойства скрипта: ' + [!key ? 'YANDEX_API_KEY' : '', !folder ? 'YANDEX_FOLDER_ID' : ''].filter(Boolean).join(', ') + ' (Расширения → Apps Script → Настройки проекта → Свойства скрипта).'; return out; }
    // 1) Vision OCR
    var t0 = Date.now(), o = { ok: false, code: 0 };
    try {
      var r = UrlFetchApp.fetch(MC_OCR_URL_ + 'recognizeText', { method: 'post', contentType: 'application/json', headers: _mcOcrHeaders_(key, folder),
        payload: JSON.stringify({ mimeType: 'PNG', languageCodes: ['ru', 'en'], model: 'page', content: BQ_CHECK_IMG_ }), muteHttpExceptions: true });
      o.code = r.getResponseCode();
      if (o.code === 200) { var ann = (JSON.parse(r.getContentText()).result || {}).textAnnotation || {}; o.text = String(ann.fullText || '').trim().slice(0, 60); o.ok = true; o.readOk = /проверка/i.test(o.text); }
      else o.action = _bqCheckAdvice_('ocr', o.code, r.getContentText().slice(0, 300));
    } catch (e1) { o.action = 'Запрос не выполнен: ' + String(e1.message || e1).slice(0, 120); }
    o.ms = Date.now() - t0; out.ocr = o;
    // 2) YandexGPT
    var t1 = Date.now(), g = { ok: false, code: 0 };
    try {
      var body = { modelUri: 'gpt://' + folder + '/' + model, completionOptions: { stream: false, temperature: 0, maxTokens: '10' }, messages: [{ role: 'system', text: 'Ответь одним словом.' }, { role: 'user', text: 'Скажи: готово' }] };
      var r2 = UrlFetchApp.fetch(BQG_.URL, { method: 'post', contentType: 'application/json', headers: { Authorization: 'Api-Key ' + key, 'x-folder-id': folder }, payload: JSON.stringify(body), muteHttpExceptions: true });
      g.code = r2.getResponseCode();
      if (g.code === 200) { var alt = ((JSON.parse(r2.getContentText()).result || {}).alternatives || [])[0]; g.text = alt && alt.message ? String(alt.message.text || '').slice(0, 40) : ''; g.ok = true; }
      else g.action = _bqCheckAdvice_('gpt', g.code, r2.getContentText().slice(0, 300));
    } catch (e2) { g.action = 'Запрос не выполнен: ' + String(e2.message || e2).slice(0, 120); }
    g.ms = Date.now() - t1; out.gpt = g;
    out.ok = o.ok && g.ok;
    out.summary = out.ok ? 'Доступ есть: распознавание фото и YandexGPT отвечают — скан бланков работает полностью.' :
      o.ok ? 'Распознавание фото работает, YandexGPT — нет (код ' + g.code + '): бланки собираются таблицей по координатам, но названия не уточняются моделью. ' + (g.action || '') :
      'Распознавание фото не работает (код ' + o.code + ') — скан бланков недоступен. ' + (o.action || '');
    return out;
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

function _bqScanErr_(r) {
  if (r.error === 'no-key') return 'Скан не настроен: в свойствах скрипта нужны YANDEX_API_KEY и YANDEX_FOLDER_ID';
  if (r.error === 'ocr') return 'Сервис распознавания вернул код ' + (r.code || '?') + (r.code == 403 ? ' — нет доступа (роль ai.vision.user, биллинг)' : r.code == 401 ? ' — неверный YANDEX_API_KEY' : r.code == 400 ? ' — проверьте YANDEX_FOLDER_ID' : '');
  if (r.error === 'empty') return 'Текст на фото не распознан — снимите бланк ровно, ближе и при хорошем свете';
  if (r.error === 'format') return 'Не удалось прочитать изображение';
  return 'Не удалось распознать бланк (' + r.error + ')';
}
/** «12.10.2026», «12.10.26», «2026-10-12», «17 октября» → ISO; иначе пусто (дату вводит человек). Без года — ближайший (см. _bqDateRu_). */
function _bqDate_(s) { return _bqDateRu_(s).iso; }
function uiBanquetSaveBlank(token, dataUrl, label) {
  try { _requireAuth_(token, 'banquets'); var r = JSON.parse(saveBlankPhoto(dataUrl, label)); return r.error ? { ok: false, error: r.error } : { ok: true, fileId: r.fileId }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}

function uiBanquetDetail(token, id) {
  var sess;
  try { sess = _requireAuth_(token); } catch (e) { return { ok: false, auth: true, error: String(e.message || e) }; }
  try {
    var ev = JSON.parse(getEvents()).filter(function (e) { return String(e.id) === String(id); })[0];
    if (!ev) return { ok: false, error: 'Банкет не найден' };
    var perm = (sess && sess.permissions) || {}, all = perm.all === true;
    var idx = _buildDishIndexes_();
    var menu = (ev.items || []).map(function (it) { var d = idx.dishByCode[it.code]; return { code: it.code, name: d ? d.name : (it.name || it.code), qty: Number(it.qty) || 0, found: !!d, yieldBase: d ? d.yieldBase : 0, yu: d ? d.yieldUnit : '', note: it.note || '' }; });
    // потребность: ТТК → п/ф → сырьё; готовые п/ф на складе закрывают свою часть
    var ex = _explodeEventItems_(ev.items || [], true);
    // склад: физический остаток и средняя цена в базовой единице
    var stock = {};
    try {
      JSON.parse(getStockBalances()).forEach(function (b) {
        var base = _toBaseUnitServer_(Number(b.qty) || 0, b.unit), one = _toBaseUnitServer_(1, b.unit).qty || 1;
        var k = _prodKey_(b.name) + '|' + base.unit, s = stock[k] || (stock[k] = { qty: 0, price: 0 });
        s.qty += base.qty; if (Number(b.avgPrice) > 0) s.price = Number(b.avgPrice) / one;
      });
    } catch (e) {}
    // резервы: всего и этого банкета
    var resAll = {}, resThis = {};
    _reservationsSheet_().getDataRange().getValues().slice(1).forEach(function (r) {
      if (r[7] !== 'ACTIVE') return;
      var k = _prodKey_(r[4]) + '|' + (r[5] || 'г'), q = parseFloat(r[6]) || 0;
      resAll[k] = (resAll[k] || 0) + q;
      if (String(r[2]) === String(id)) resThis[k] = (resThis[k] || 0) + q;
    });
    var r3 = function (x) { return Math.round((Number(x) || 0) * 1000) / 1000; };
    var rows = Object.keys(ex.acc).map(function (key) {
      var sep = key.lastIndexOf('|'), name = key.slice(0, sep), unit = key.slice(sep + 1), need = ex.acc[key];
      var k = _prodKey_(name) + '|' + unit, s = stock[k] || { qty: 0, price: 0 };
      // ТЗ §3/§8: в расчёт — только допущенные непросроченные партии, с синонимами по ProductID
      var phys = s.qty; try { phys = _mcAvailableBase_(name, unit, false); } catch (e) {}
      s = { qty: phys, price: s.price };
      var others = Math.max(0, (resAll[k] || 0) - (resThis[k] || 0));
      var avail = Math.max(0, s.qty - others), buy = Math.max(0, need - avail);
      return { name: _cleanProdName_(name), unit: unit, need: r3(need), stock: r3(s.qty), otherReserved: r3(others), available: r3(avail), toBuy: r3(buy),
        price: s.price ? Math.round(s.price * 10000) / 10000 : 0, sum: s.price ? Math.round(buy * s.price * 100) / 100 : 0, status: buy > 0.0005 ? 'купить' : 'хватает' };
    }).sort(function (a, b) { return (b.toBuy > 0) - (a.toBuy > 0) || a.name.localeCompare(b.name, 'ru'); });
    var pf = Object.keys(ex.pfUsed || {}).map(function (key) { var sep = key.lastIndexOf('|'); return { name: key.slice(0, sep), unit: key.slice(sep + 1), qty: r3(ex.pfUsed[key]) }; });
    // заказы поставщикам по банкету (в комментарии заказа — ID банкета)
    var orders = [];
    try {
      _supplierOrdersSheet_().getDataRange().getValues().slice(1).forEach(function (o) {
        if (o[0] && String(o[6] || '').indexOf(String(id)) >= 0) orders.push({ id: o[0], date: _dstr_(o[1]), supplier: o[2], status: o[3], sum: o[5], due: o[7] ? _dstr_(o[7]) : '', items: (function () { try { return JSON.parse(o[4] || '[]').length; } catch (e) { return 0; } })() });
      });
    } catch (e) {}
    var buyRows = rows.filter(function (r) { return r.toBuy > 0; });
    return JSON.parse(JSON.stringify({ ok: true,
      event: { id: ev.id, date: ev.date, time: ev.time || '', name: ev.format || ev.name || 'Банкет', place: ev.place || '', guests: ev.guests || '', contact: ev.contact || '', comment: ev.comment || '', status: ev.status || '', blankId: ev.blankId || '' },
      raw: ev, menu: menu, purchase: rows, pfFromStock: pf, orders: orders,
      totals: { products: rows.length, toBuy: buyRows.length, sum: Math.round(buyRows.reduce(function (a, r) { return a + r.sum; }, 0) * 100) / 100, noPrice: buyRows.filter(function (r) { return !r.price; }).length },
      canEdit: all || perm.banquets === true, canOrder: all || (perm.procurement === true && perm.stock === true) }));
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
