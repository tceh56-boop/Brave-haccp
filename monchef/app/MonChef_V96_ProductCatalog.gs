/**
 * MON CHEF V96 — справочник продуктов: производитель, штрихкод, статус; разбор групп на ручную проверку.
 *
 * Справочник — лист «Продукты_Справочник» (импорт базы продуктов, см. Code.gs PRODUCTS_DB_SHEET). Строки листа не меняются и не удаляются:
 *   у каждой строки — карточка (лист «Продукты_Карточки_V96»): единица, производитель, штрихкод, статус (ACTIVE / MERGED / ARCHIVED),
 *   вид (сырьё / полуфабрикат, переработанный продукт), кто и когда менял, история изменений.
 * Группы на ручную проверку («Продукты_Группы_V96») строятся тем же алгоритмом, что в аудите справочника (ДОК_12, П2: 318 групп):
 *   точные дубли, одинаковое название с разным типом, похожие названия, латиница / кавычки (марка), полуфабрикаты среди сырья.
 *   Система только предлагает; решение принимает человек с правом «ttk_approve» или «stock» и подтверждает галочкой:
 *   объединить (оставить одну позицию, остальные — «объединена с …»; сопоставления ТТК и склада V53 переводятся на оставленную),
 *   оставить раздельно (с пояснением), отметить полуфабрикатом / сырьём, указать производителя (марка), название верное, в архив.
 *   Решённые группы при пересборке не появляются снова; группа, состав которой изменился, — «справочник изменился».
 * Штрихкод: EAN-8, UPC-A (12), EAN-13, GTIN-14 с проверкой контрольной цифры (GS1); один штрихкод — одна действующая карточка.
 * Единица: г, кг, мл, л, шт, уп — вносит человек (в базе продуктов единицы нет; система её не придумывает).
 */
var MC_V96_CARD_ = 'Продукты_Карточки_V96', MC_V96_CARD_HEAD_ = ['CardID', 'ProductID', '№ в справочнике', 'Название', 'Тип', 'Единица', 'Производитель', 'Штрихкод', 'Статус', 'Вид',
  'Объединена с', 'Причина', 'Изменил', 'Изменено', 'История (JSON)'];
var MC_V96_GRP_ = 'Продукты_Группы_V96', MC_V96_GRP_HEAD_ = ['GroupID', 'Ключ', 'Вид', 'Позиции (JSON)', 'Почему', 'Предложение', 'Статус', 'Решение', 'Оставить', 'Комментарий', 'Решил', 'Решено', 'Создано'];
var MC_V96_UNITS_ = { 'г': 'g', 'кг': 'kg', 'мл': 'ml', 'л': 'l', 'шт': 'pcs', 'уп': 'pack' };
var MC_V96_ST_RU_ = { ACTIVE: 'действует', REVIEW: 'на проверке', MERGED: 'объединена', ARCHIVED: 'в архиве' };
var MC_V96_KINDP_RU_ = { RAW: 'сырьё', SEMI: 'полуфабрикат / переработанный' };
var MC_V96_DEC_RU_ = { MERGE: 'объединить', SEPARATE: 'оставить раздельно', SEMI: 'полуфабрикат / переработанный продукт', RAW: 'это сырьё', BRAND: 'марка — производитель указан',
  NAME_OK: 'название верное (не марка)', ARCHIVE: 'в архив' };
var MC_V96_DEC_BY_KIND_ = { DUP: ['MERGE', 'SEPARATE', 'ARCHIVE'], SAMENAME: ['MERGE', 'SEPARATE', 'ARCHIVE'], SIMILAR: ['MERGE', 'SEPARATE', 'ARCHIVE'],
  LATIN: ['BRAND', 'NAME_OK', 'MERGE', 'SEPARATE', 'ARCHIVE'], PROCESSED: ['SEMI', 'RAW', 'ARCHIVE'] };

/* ---------------- права, меню ---------------- */
(function () {
  try { MC_RB_MODULES_.prodcat = 'catalog|stock|stock_view|ttk_edit|ttk_approve'; MC_RB_MODULE_RU_.prodcat = 'Справочник продуктов'; } catch (e) {}
  try { if (MC_UI_VIEWS_.indexOf('prodcat') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['prodcat']); } catch (e) {}
  try { var o = _mcViewOfParams_; _mcViewOfParams_ = function (params) { if (params && (params.prodcat === '1' || params.products === '1')) return 'prodcat'; return o.apply(this, arguments); }; } catch (e) {}
  try {
    var sec = function (k, btn) { var orig = _UI_BUILDERS_[k]; if (typeof orig !== 'function') return; _UI_BUILDERS_[k] = function (token, opts, s) { var r = orig(token, opts, s) || {}; r.actions = (r.actions || []).concat([btn]); return r; }; };
    sec('stock', { label: 'Справочник продуктов: производитель, штрихкод, статус, группы на разбор', module: 'prodcat' });
    sec('menu', { label: 'Справочник продуктов', module: 'prodcat' });
  } catch (e) {}
})();

/* ---- перенос алгоритма аудита (audit/py/products_audit.py): группы на ручную проверку ---- */
function _v96Norm_(s) {
  s = String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
  s = s.replace(/\([^)]*\)/g, ' ').replace(/[^a-zа-я0-9%]+/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}
/** Доля совпадения строк — как difflib.SequenceMatcher(None, a, b).ratio() (короткие строки, без «мусорных» символов). */
function _v96Ratio_(a, b) {
  var la = a.length, lb = b.length; if (!la && !lb) return 1;
  var b2j = {}; for (var x = 0; x < lb; x++) (b2j[b[x]] = b2j[b[x]] || []).push(x);
  var longest = function (alo, ahi, blo, bhi) {
    var bi = alo, bj = blo, bs = 0, j2 = {};
    for (var i = alo; i < ahi; i++) {
      var nj = {}, js = b2j[a[i]] || [];
      for (var t = 0; t < js.length; t++) { var j = js[t]; if (j < blo) continue; if (j >= bhi) break; var k = nj[j] = (j2[j - 1] || 0) + 1; if (k > bs) { bi = i - k + 1; bj = j - k + 1; bs = k; } }
      j2 = nj;
    }
    while (bi > alo && bj > blo && a[bi - 1] === b[bj - 1]) { bi--; bj--; bs++; }
    while (bi + bs < ahi && bj + bs < bhi && a[bi + bs] === b[bj + bs]) bs++;
    return [bi, bj, bs];
  };
  var q = [[0, la, 0, lb]], m = 0;
  while (q.length) {
    var c = q.pop(), r = longest(c[0], c[1], c[2], c[3]), i0 = r[0], j0 = r[1], k0 = r[2];
    if (k0) { m += k0; if (c[0] < i0 && c[2] < j0) q.push([c[0], i0, c[2], j0]); if (i0 + k0 < c[1] && j0 + k0 < c[3]) q.push([i0 + k0, c[1], j0 + k0, c[3]]); }
  }
  return 2 * m / (la + lb);
}
var MC_V96_KIND_ = { DUP: 'точный дубль', SAMENAME: 'одинаковое название, разный тип', SIMILAR: 'похожие названия', LATIN: 'латиница / кавычки в названии (иностранное название или торговая марка)', PROCESSED: 'полуфабрикат / переработанный продукт' };
/** P: [{no, name, type, key}] в порядке листа → [{kind, items: [индексы P], why}] — тот же порядок и те же группы, что в аудите. */
function _v96Groups_(P) {
  var out = [], add = function (kind, items, why) { out.push({ kind: kind, items: items, why: why }); };
  var byNorm = new Map();
  P.forEach(function (p, i) { var k = _v96Norm_(p.name); if (!byNorm.has(k)) byNorm.set(k, []); byNorm.get(k).push(i); });
  byNorm.forEach(function (v, k) {
    if (!k || v.length < 2) return;
    var types = {}; v.forEach(function (i) { types[String(P[i].type || '').trim()] = 1; });
    var same = Object.keys(types).length === 1;
    add(same ? 'DUP' : 'SAMENAME', v, 'одинаковое нормализованное название' + (same ? '' : '; тип разный — возможно, разные продукты'));
  });
  var stems = function (s) { var o = {}; _v96Norm_(s).split(' ').forEach(function (w) { if (w.length > 2) o[w.slice(0, 5)] = 1; }); return Object.keys(o).sort(); };
  var byStem = new Map();
  byNorm.forEach(function (v, k) { if (!k) return; var st = stems(k).join(' '); if (!byStem.has(st)) byStem.set(st, []); byStem.get(st).push(v[0]); });
  var seen = {};
  byStem.forEach(function (v, st) { if (st && v.length > 1) { add('SIMILAR', v, 'одинаковые основы слов: ' + st); v.forEach(function (i) { seen[_v96Norm_(P[i].name)] = 1; }); } });
  var keys = []; byNorm.forEach(function (v, k) { if (k && !seen[k]) keys.push(k); });
  keys.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  for (var i = 0; i < keys.length; i++) {
    var a = keys[i];
    for (var j = i + 1; j < Math.min(keys.length, i + 40); j++) {
      var b = keys[j]; if (a.slice(0, 3) !== b.slice(0, 3)) break;
      if (2 * Math.min(a.length, b.length) / (a.length + b.length) < 0.9) continue;
      var rt = _v96Ratio_(a, b);
      if (rt >= 0.9) add('SIMILAR', [byNorm.get(a)[0], byNorm.get(b)[0]], 'сходство написания ' + rt.toFixed(2));
    }
  }
  var brand = /[«"“][^»"”]+[»"”]|(?<![\p{L}\p{N}_])[A-Z][a-zA-Z]+(?![\p{L}\p{N}_])|®|™/gu;
  P.forEach(function (p, i) {
    var m = String(p.name).match(brand); if (!m) return;
    var base = _v96Norm_(String(p.name).replace(brand, ' ')), others = (byNorm.get(base) || []).filter(function (x) { return x !== i; });
    var u = {}; m.forEach(function (x) { u[x] = 1; });
    add('LATIN', [i].concat(others), 'в названии: ' + Object.keys(u).sort().join(', ') + (others.length ? '; есть базовый продукт с тем же названием без марки' : ''));
  });
  var pf = /(?<![а-яё])(п\/ф|полуфабрикат|фарш|котлет|пельмен|вареник|тесто|соус|бульон|маринован|копчен|вялен|консерв|паштет|колбас|сосис|ветчин|рулет|пицц|готов)/i;
  P.forEach(function (p, i) {
    var m = pf.exec(String(p.name) + ' ' + String(p.type || ''));
    if (m) add('PROCESSED', [i], 'признак «' + m[1] + '» — проверьте, не объединён ли с сырьём; продукт переработки — другой ТР и другие сроки');
  });
  return out;
}

/* ---------------- справочник и карточки ---------------- */
function _v96Can_(s) { return { edit: !!s && !s.dev && _mcRbHasExact_(s, 'ttk_approve|stock'), view: _mcRbHasExact_(s, 'catalog|stock|stock_view|ttk_edit|ttk_approve') }; }
/** Строки листа «Продукты_Справочник»: [{row, no, name, type, pid, cardId}]. */
function _v96Src_() {
  var sh = _book_().getSheetByName(typeof PRODUCTS_DB_SHEET !== 'undefined' ? PRODUCTS_DB_SHEET : 'Продукты_Справочник'), out = [];
  if (!sh || sh.getLastRow() < 2) return null;
  var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); }), ni = h.indexOf('Название продукта'), ti = h.indexOf('Тип продукта'), no = h.indexOf('№');
  if (ni < 0) return null;
  for (var i = 1; i < v.length; i++) {
    var name = String(v[i][ni] || '').trim(); if (!name) continue;
    var type = ti >= 0 ? String(v[i][ti] || '') : '', n = no >= 0 ? String(v[i][no] === '' || v[i][no] === null ? '' : v[i][no]).trim() : '', pid = _v53Pid_(name, type);
    out.push({ row: i + 1, no: n, name: name, type: type, pid: pid, cardId: pid + '#' + (n || ('r' + (i + 1))) });
  }
  return out;
}
function _v96Cards_() { var m = {}; _v92Rows_(MC_V96_CARD_).forEach(function (r) { m[String(r.CardID)] = r; }); return m; }
function _v96Hist_(r) { try { return JSON.parse(String(r['История (JSON)'] || '[]')); } catch (e) { return []; } }
/** Записать карточку: изменения полей + строка истории. */
function _v96Put_(p, C, ch, who, why) {
  var r = C[p.cardId] || { CardID: p.cardId, ProductID: p.pid, '№ в справочнике': p.no, 'Название': p.name, 'Тип': p.type, 'Статус': 'ACTIVE', 'Вид': '' };
  var diff = {};
  Object.keys(ch).forEach(function (k) { var a = r[k] === undefined || r[k] === null ? '' : String(r[k]), b = ch[k] === undefined || ch[k] === null ? '' : String(ch[k]); if (a !== b) { diff[k] = [a, b]; r[k] = ch[k]; } });
  if (!Object.keys(diff).length && r._row) return { row: r, diff: diff };
  var h = _v96Hist_(r); h.push({ at: Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd HH:mm'), who: who, diff: diff, why: why || '' });
  r['История (JSON)'] = JSON.stringify(h.slice(-30)); r['Изменил'] = who; r['Изменено'] = new Date();
  _v93Write_(MC_V96_CARD_, MC_V96_CARD_HEAD_, r);
  if (!r._row) { var sh = _book_().getSheetByName(MC_V96_CARD_); r._row = sh.getLastRow(); }
  C[p.cardId] = r;
  return { row: r, diff: diff };
}
/** Штрихкод GS1: только цифры, длина 8 / 12 / 13 / 14, контрольная цифра. */
function _v96Barcode_(x) {
  var c = String(x || '').replace(/[\s-]/g, '');
  if (!c) return { code: '' };
  if (!/^\d+$/.test(c)) return { error: 'Штрихкод — только цифры' };
  if ([8, 12, 13, 14].indexOf(c.length) < 0) return { error: 'Штрихкод: 8, 12, 13 или 14 цифр (EAN-8, UPC-A, EAN-13, GTIN-14), у вас ' + c.length };
  var s = 0, d = c.split('').map(Number), last = d.pop();
  for (var i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) s += d[i] * w;
  if ((10 - s % 10) % 10 !== last) return { error: 'Штрихкод ' + c + ': неверная контрольная цифра — проверьте ввод' };
  return { code: c };
}
/** V53: продукт неактивен, если все его карточки объединены или в архиве; сопоставления — на оставленную позицию. */
function _v96SyncV53_(pid, C, src, toPid, who) {
  try {
    setupV53ProductUnits();
    var live = src.some(function (p) { if (p.pid !== pid) return false; var c = C[p.cardId]; return !c || ['MERGED', 'ARCHIVED'].indexOf(String(c['Статус'])) < 0; });
    var sh = _book_().getSheetByName(V53.PRODUCTS), v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (String(v[i][0]) === pid) sh.getRange(i + 1, 7).setValue(live ? 'YES' : 'NO');
    if (!live && toPid && toPid !== pid) {
      var ms = _book_().getSheetByName(V53.MAP), mv = ms ? ms.getDataRange().getValues() : [];
      for (var j = 1; j < mv.length; j++) if (String(mv[j][3]) === pid) { ms.getRange(j + 1, 4).setValue(toPid); ms.getRange(j + 1, 9).setValue(String(mv[j][8] || '') + (mv[j][8] ? '; ' : '') + 'V96: объединено с ' + toPid); ms.getRange(j + 1, 10).setValue(new Date()); ms.getRange(j + 1, 11).setValue(who); }
    }
  } catch (e) {}
}
function _v96SetUnitV53_(pid, unit) {
  try {
    setupV53ProductUnits();
    var sh = _book_().getSheetByName(V53.PRODUCTS), v = sh.getDataRange().getValues(), u = MC_V96_UNITS_[unit] || '', can = u ? ({ g: 'g', kg: 'g', ml: 'ml', l: 'ml', pcs: 'pcs', pack: 'pack' })[u] : '';
    for (var i = 1; i < v.length; i++) if (String(v[i][0]) === pid) { sh.getRange(i + 1, 5).setValue(can); sh.getRange(i + 1, 6).setValue(u ? _v53Dim_(u) : 'UNKNOWN'); }
  } catch (e) {}
}
function _v96Suggest_(kind, items, P) {
  if (kind === 'DUP') { var nos = items.map(function (i) { return P[i].no; }).filter(Boolean); return 'объединить: позиции с одинаковым названием и типом' + (nos.length ? ' — оставить №' + nos[0] : ''); }
  if (kind === 'SAMENAME') return 'сравните тип и описание: один продукт — объединить; разные — оставить раздельно с пояснением';
  if (kind === 'SIMILAR') return 'проверьте написание: опечатка или вариант названия — объединить; разные продукты — оставить раздельно';
  if (kind === 'LATIN') return items.length > 1 ? 'есть базовый продукт без марки: марку — в «Производитель»; позиции объединить или оставить раздельно' : 'марка — укажите производителя; иностранное название продукта — «название верное»';
  return 'переработанный продукт — отметить «полуфабрикат / переработанный» (другие сроки и техрегламент); если это сырьё — «это сырьё»';
}
function _v96GroupView_(g, byCard) {
  var it = []; try { it = JSON.parse(String(g['Позиции (JSON)'] || '[]')); } catch (e) {}
  return { id: String(g.GroupID), kind: String(g['Вид']), kindRu: MC_V96_KIND_[g['Вид']] || g['Вид'], why: String(g['Почему'] || ''), suggest: String(g['Предложение'] || ''), status: String(g['Статус']),
    decision: String(g['Решение'] || ''), decisionRu: MC_V96_DEC_RU_[g['Решение']] || '', keep: String(g['Оставить'] || ''), comment: String(g['Комментарий'] || ''), by: String(g['Решил'] || ''),
    at: g['Решено'] instanceof Date ? Utilities.formatDate(g['Решено'], _mcTz_(), 'dd.MM.yyyy HH:mm') : String(g['Решено'] || ''), decisions: MC_V96_DEC_BY_KIND_[g['Вид']] || [],
    items: it.map(function (x) { var c = byCard[x.cardId] || {}; return { cardId: x.cardId, no: x.no, name: x.name, type: x.type, status: c.status || 'ACTIVE', manufacturer: c.manufacturer || '' }; }) };
}

/** Справочник: карточки, группы, сводка. */
function v96Data(token) {
  var s; try { s = _requireAuth_(token, 'catalog|stock|stock_view|ttk_edit|ttk_approve'); } catch (e) { return _failFrom_(e); }
  try {
    var src = _v96Src_(), can = _v96Can_(s);
    if (!src) return _ok_({ loaded: false, note: 'Лист «' + (typeof PRODUCTS_DB_SHEET !== 'undefined' ? PRODUCTS_DB_SHEET : 'Продукты_Справочник') + '» не загружен — инструкция «Начало работы», шаг «База продуктов»', products: [], groups: [], can: can });
    var C = _v96Cards_(), G = _v92Rows_(MC_V96_GRP_), open = {};
    G.forEach(function (g) { if (String(g['Статус']) !== 'OPEN') return; try { JSON.parse(String(g['Позиции (JSON)'] || '[]')).forEach(function (x) { (open[x.cardId] = open[x.cardId] || []).push(String(g.GroupID)); }); } catch (e) {} });
    var byCard = {}, st = { products: src.length, unit: 0, manufacturer: 0, barcode: 0, merged: 0, archived: 0, semi: 0, review: 0 };
    var products = src.map(function (p) {
      var c = C[p.cardId] || {}, status = String(c['Статус'] || 'ACTIVE'), x = { cardId: p.cardId, pid: p.pid, no: p.no, name: p.name, type: p.type, unit: String(c['Единица'] || ''), manufacturer: String(c['Производитель'] || ''),
        barcode: String(c['Штрихкод'] || ''), status: status, kind: String(c['Вид'] || ''), mergedInto: String(c['Объединена с'] || ''), reason: String(c['Причина'] || ''), by: String(c['Изменил'] || ''), groups: open[p.cardId] || [] };
      if (status === 'ACTIVE' && x.groups.length) x.status = 'REVIEW';
      x.statusRu = MC_V96_ST_RU_[x.status] || x.status; x.kindRu = MC_V96_KINDP_RU_[x.kind] || '';
      if (x.unit) st.unit++; if (x.manufacturer) st.manufacturer++; if (x.barcode) st.barcode++; if (status === 'MERGED') st.merged++; if (status === 'ARCHIVED') st.archived++; if (x.kind === 'SEMI') st.semi++; if (x.status === 'REVIEW') st.review++;
      byCard[p.cardId] = x; return x;
    });
    var groups = G.map(function (g) { return _v96GroupView_(g, byCard); }), gs = { total: groups.length, open: 0, resolved: 0, stale: 0, byKind: {} };
    groups.forEach(function (g) { if (g.status === 'OPEN') gs.open++; else if (g.status === 'RESOLVED') gs.resolved++; else gs.stale++; var k = gs.byKind[g.kind] || (gs.byKind[g.kind] = { ru: g.kindRu, open: 0, total: 0 }); k.total++; if (g.status === 'OPEN') k.open++; });
    return _ok_({ loaded: true, products: products, groups: groups, stats: st, groupStats: gs, built: groups.length > 0, can: can, units: Object.keys(MC_V96_UNITS_), decRu: MC_V96_DEC_RU_ });
  } catch (e) { return _failFrom_(e); }
}

/** Построить / обновить группы на разбор. Решённые остаются решёнными; исчезнувшие открытые — «справочник изменился». */
function v96BuildGroups(token) {
  var op = null; try { op = _beginOp_(token, 'ttk_approve|stock', 'V96_BUILD_GROUPS', 'Справочник продуктов', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var src = _v96Src_();
    if (!src) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Лист «Продукты_Справочник» не загружен', op.id); }
    return _withLock_(function () {
      var G = _v96Groups_(src), old = _v92Rows_(MC_V96_GRP_), byKey = {}, maxN = 0, now = new Date(), seen = {}, added = 0, kept = 0, stale = 0, fresh = [];
      old.forEach(function (g) { byKey[String(g['Ключ'])] = g; var n = parseInt(String(g.GroupID).replace(/\D/g, ''), 10); if (n > maxN) maxN = n; });
      G.forEach(function (g) {
        var ids = g.items.map(function (i) { return src[i].cardId; }), key = g.kind + ':' + ids.slice().sort().join('|');
        if (seen[key]) return; seen[key] = 1;
        if (byKey[key]) { kept++; if (String(byKey[key]['Статус']) === 'STALE') { byKey[key]['Статус'] = 'OPEN'; _v93Write_(MC_V96_GRP_, MC_V96_GRP_HEAD_, byKey[key]); } return; }
        maxN++; added++;
        fresh.push({ GroupID: 'G' + ('000' + maxN).slice(-4), 'Ключ': key, 'Вид': g.kind, 'Позиции (JSON)': JSON.stringify(g.items.map(function (i) { var p = src[i]; return { cardId: p.cardId, pid: p.pid, no: p.no, name: p.name, type: p.type }; })),
          'Почему': g.why, 'Предложение': _v96Suggest_(g.kind, g.items, src), 'Статус': 'OPEN', 'Создано': now });
      });
      if (fresh.length) {   // одной записью: сотни групп на реальном справочнике
        var gsh = _v92Sh_(MC_V96_GRP_, MC_V96_GRP_HEAD_);
        gsh.getRange(gsh.getLastRow() + 1, 1, fresh.length, MC_V96_GRP_HEAD_.length).setValues(fresh.map(function (o) { return MC_V96_GRP_HEAD_.map(function (k) { return o[k] === undefined ? '' : o[k]; }); }));
      }
      old.forEach(function (g) { if (!seen[String(g['Ключ'])] && String(g['Статус']) === 'OPEN') { g['Статус'] = 'STALE'; g['Комментарий'] = 'справочник изменился — группа больше не находится'; _v93Write_(MC_V96_GRP_, MC_V96_GRP_HEAD_, g); stale++; } });
      _audit_(op, 'V96_BUILD_GROUPS', MC_V96_GRP_, '', null, { продуктов: src.length, групп: G.length, новых: added, прежних: kept, устарело: stale });
      _endOp_(op);
      return _ok_({ products: src.length, groups: G.length, added: added, kept: kept, stale: stale }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Карточка продукта: {cardId, unit?, manufacturer?, barcode?, status? ('ACTIVE' | 'ARCHIVED'), kind? ('' | 'RAW' | 'SEMI'), reason?, confirm: true}. */
function v96SaveCard(json, token) {
  var op = null; try { op = _beginOp_(token, 'ttk_approve|stock', 'V96_SAVE_CARD', 'Справочник продуктов', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, f = function (c, m) { _endOp_(op, 'FAILED'); return _fail_(c, m, op.id); };
    if (op.session.dev) return f('FORBIDDEN', 'Технический доступ справочник не меняет');
    if (d.confirm !== true) return f('VALIDATION', 'Подтвердите изменение галочкой');
    return _withLock_(function () {
      var src = _v96Src_() || [], p = src.filter(function (x) { return x.cardId === String(d.cardId || ''); })[0];
      if (!p) return f('NOT_FOUND', 'Продукт не найден в справочнике');
      var C = _v96Cards_(), cur = C[p.cardId] || {}, ch = {}, why = String(d.reason || '').trim(), who = _author_(op).фио;
      if (String(cur['Статус']) === 'MERGED') return f('VALIDATION', 'Позиция объединена с ' + cur['Объединена с'] + ' — правьте оставленную позицию');
      if (d.unit !== undefined) { var u = String(d.unit || '').trim(); if (u && !MC_V96_UNITS_[u]) return f('VALIDATION', 'Единица: ' + Object.keys(MC_V96_UNITS_).join(', ')); ch['Единица'] = u; }
      if (d.manufacturer !== undefined) { var m = String(d.manufacturer || '').replace(/\s+/g, ' ').trim(); if (m && m.length < 2) return f('VALIDATION', 'Производитель — не короче 2 символов'); ch['Производитель'] = m.slice(0, 200); }
      if (d.barcode !== undefined) {
        var b = _v96Barcode_(d.barcode); if (b.error) return f('VALIDATION', b.error);
        if (b.code) { var other = Object.keys(C).filter(function (k) { var c = C[k]; return k !== p.cardId && String(c['Штрихкод']) === b.code && ['MERGED', 'ARCHIVED'].indexOf(String(c['Статус'])) < 0; })[0];
          if (other) return f('DUPLICATE', 'Штрихкод ' + b.code + ' уже у продукта «' + C[other]['Название'] + '» (№' + (C[other]['№ в справочнике'] || '—') + ')'); }
        ch['Штрихкод'] = b.code;
      }
      if (d.kind !== undefined) { var k = String(d.kind || ''); if (k && !MC_V96_KINDP_RU_[k]) return f('VALIDATION', 'Вид: сырьё или полуфабрикат'); ch['Вид'] = k; }
      if (d.status !== undefined) {
        var stt = String(d.status || ''); if (['ACTIVE', 'ARCHIVED'].indexOf(stt) < 0) return f('VALIDATION', 'Статус: действует или в архиве');
        if (stt === 'ARCHIVED' && why.length < 5) return f('VALIDATION', 'Укажите причину, почему продукт в архиве (не короче 5 символов)');
        ch['Статус'] = stt; if (stt === 'ARCHIVED') ch['Причина'] = why; else if (String(cur['Статус']) === 'ARCHIVED') ch['Причина'] = '';
      }
      var r = _v96Put_(p, C, ch, who, why);
      if (ch['Единица'] !== undefined && r.diff['Единица']) _v96SetUnitV53_(p.pid, ch['Единица']);
      if (r.diff['Статус']) _v96SyncV53_(p.pid, C, src, '', who);
      _audit_(op, 'V96_SAVE_CARD', MC_V96_CARD_, p.cardId, null, { продукт: p.name, изменено: r.diff });
      _endOp_(op);
      return _ok_({ cardId: p.cardId, changed: Object.keys(r.diff), card: { unit: r.row['Единица'] || '', manufacturer: r.row['Производитель'] || '', barcode: r.row['Штрихкод'] || '', status: r.row['Статус'], kind: r.row['Вид'] || '' } }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Решения по группам: {items: [{groupId, decision, keep?, cards?, manufacturer?, comment?}], confirm: true}. Каждая группа — отдельно: ошибка одной не мешает другим. */
function v96ResolveGroups(json, token) {
  var op = null; try { op = _beginOp_(token, 'ttk_approve|stock', 'V96_RESOLVE', 'Справочник продуктов', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, items = d.items || [];
    if (op.session.dev) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Технический доступ справочник не меняет', op.id); }
    if (d.confirm !== true) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Подтвердите решение галочкой', op.id); }
    if (!items.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите группы и решение', op.id); }
    if (items.length > 100) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'За один раз — не больше 100 групп', op.id); }
    return _withLock_(function () {
      var src = _v96Src_() || [], byId = {}, C = _v96Cards_(), G = _v92Rows_(MC_V96_GRP_), gi = {}, who = _author_(op).фио, now = new Date(), res = [];
      src.forEach(function (p) { byId[p.cardId] = p; }); G.forEach(function (g) { gi[String(g.GroupID)] = g; });
      items.forEach(function (it) {
        var g = gi[String(it.groupId || '')], dec = String(it.decision || ''), cm = String(it.comment || '').trim(), bad = function (m) { res.push({ groupId: it.groupId, ok: false, error: m }); };
        if (!g) return bad('Группа не найдена');
        if (String(g['Статус']) !== 'OPEN') return bad('Группа уже ' + (String(g['Статус']) === 'RESOLVED' ? 'решена: ' + (MC_V96_DEC_RU_[g['Решение']] || g['Решение']) : 'не актуальна — справочник изменился'));
        if ((MC_V96_DEC_BY_KIND_[g['Вид']] || []).indexOf(dec) < 0) return bad('Для группы «' + MC_V96_KIND_[g['Вид']] + '» такое решение не предусмотрено');
        var pos = []; try { pos = JSON.parse(String(g['Позиции (JSON)'] || '[]')); } catch (e) {}
        var ps = pos.map(function (x) { return byId[x.cardId]; });
        if (ps.some(function (x) { return !x; })) return bad('Позиции группы изменились в справочнике — пересоберите группы');
        var keep = '';
        if (dec === 'MERGE') {
          if (ps.length < 2) return bad('В группе одна позиция — объединять не с чем');
          keep = String(it.keep || ''); var kp = byId[keep];
          if (!kp || pos.every(function (x) { return x.cardId !== keep; })) return bad('Выберите позицию, которая останется');
          if (['MERGED', 'ARCHIVED'].indexOf(String((C[keep] || {})['Статус'])) >= 0) return bad('Оставляемая позиция уже объединена или в архиве');
          ps.forEach(function (p) { if (p.cardId === keep) return; _v96Put_(p, C, { 'Статус': 'MERGED', 'Объединена с': keep, 'Причина': 'группа ' + g.GroupID + (cm ? ': ' + cm : '') }, who, 'объединение, группа ' + g.GroupID);
            _v96SyncV53_(p.pid, C, src, kp.pid, who); });
          _v96Put_(kp, C, { 'Статус': 'ACTIVE' }, who, 'оставлена при объединении, группа ' + g.GroupID);
        } else if (dec === 'SEPARATE') {
          if (cm.length < 5) return bad('Поясните, чем позиции отличаются (не короче 5 символов)');
        } else if (dec === 'SEMI' || dec === 'RAW') {
          ps.forEach(function (p) { _v96Put_(p, C, { 'Вид': dec }, who, 'группа ' + g.GroupID + ': ' + MC_V96_DEC_RU_[dec]); });
        } else if (dec === 'BRAND') {
          var mf = String(it.manufacturer || '').replace(/\s+/g, ' ').trim(); if (mf.length < 2) return bad('Укажите производителя / марку');
          _v96Put_(ps[0], C, { 'Производитель': mf.slice(0, 200) }, who, 'группа ' + g.GroupID + ': марка');
        } else if (dec === 'ARCHIVE') {
          var sel = (it.cards && it.cards.length ? it.cards : pos.map(function (x) { return x.cardId; })).map(String);
          if (sel.some(function (c) { return pos.every(function (x) { return x.cardId !== c; }); })) return bad('В архив — только позиции этой группы');
          if (cm.length < 5) return bad('Укажите причину архива (не короче 5 символов)');
          sel.forEach(function (c) { _v96Put_(byId[c], C, { 'Статус': 'ARCHIVED', 'Причина': 'группа ' + g.GroupID + ': ' + cm }, who, 'в архив'); _v96SyncV53_(byId[c].pid, C, src, '', who); });
        }
        g['Статус'] = 'RESOLVED'; g['Решение'] = dec; g['Оставить'] = keep; g['Комментарий'] = cm; g['Решил'] = who; g['Решено'] = now;
        _v93Write_(MC_V96_GRP_, MC_V96_GRP_HEAD_, g);
        res.push({ groupId: String(g.GroupID), ok: true, decision: dec, decisionRu: MC_V96_DEC_RU_[dec] });
      });
      var okN = res.filter(function (x) { return x.ok; }).length;
      _audit_(op, 'V96_RESOLVE', MC_V96_GRP_, '', null, { решено: okN, ошибок: res.length - okN, решения: res.map(function (x) { return x.groupId + ' ' + (x.ok ? x.decision : 'ошибка: ' + x.error); }) });
      _endOp_(op, okN ? undefined : 'FAILED');
      if (!okN) return _fail_('VALIDATION', res.map(function (x) { return x.groupId + ': ' + x.error; }).join('; '), op.id);
      return _ok_({ resolved: okN, failed: res.length - okN, results: res }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Найти продукт по штрихкоду (приёмка, склад): {code}. */
function v96FindBarcode(json, token) {
  try { _requireAuth_(token, 'catalog|stock|stock_view|receiving|ttk_edit|ttk_approve'); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, b = _v96Barcode_(d.code); if (b.error) return _fail_('VALIDATION', b.error); if (!b.code) return _fail_('VALIDATION', 'Введите штрихкод');
    var C = _v96Cards_(), hit = Object.keys(C).map(function (k) { return C[k]; }).filter(function (c) { return String(c['Штрихкод']) === b.code && ['MERGED', 'ARCHIVED'].indexOf(String(c['Статус'])) < 0; })[0];
    if (!hit) return _fail_('NOT_FOUND', 'Штрихкод ' + b.code + ' в справочнике не найден — укажите его в карточке продукта');
    return _ok_({ code: b.code, cardId: String(hit.CardID), pid: String(hit.ProductID), name: String(hit['Название']), type: String(hit['Тип'] || ''), unit: String(hit['Единица'] || ''), manufacturer: String(hit['Производитель'] || '') });
  } catch (e) { return _failFrom_(e); }
}

/* ---------------- V53: объединённые и архивные продукты не предлагаются для сопоставления ---------------- */
(function () {
  if (typeof _v53ProductIndex_ !== 'function') return;
  var o = _v53ProductIndex_;
  _v53ProductIndex_ = function () {
    var x = o.apply(this, arguments);
    try { Object.keys(x.byName).forEach(function (k) { x.byName[k] = x.byName[k].filter(function (r) { return String(r.Active || 'YES') !== 'NO'; }); if (!x.byName[k].length) delete x.byName[k]; }); } catch (e) {}
    return x;
  };
})();

/* ---------------- «Моя смена»: группы на разбор ---------------- */
try {
  MC_V87_SOURCES_.push(function (ctx) {
    var s = ctx.s; if (!s || s.dev || !_mcRbHasExact_(s, 'ttk_approve|stock') || !_book_().getSheetByName(MC_V96_GRP_)) return [];
    var n = _v92Rows_(MC_V96_GRP_).filter(function (g) { return String(g['Статус']) === 'OPEN'; }).length;
    return n ? [{ key: 'V96|groups', group: 'later', source: 'Справочник продуктов', title: 'Справочник продуктов: групп на разбор — ' + n, detail: 'Дубли, похожие названия, марки и полуфабрикаты среди сырья: объединить, оставить раздельно или отметить. Решения подтверждаются галочкой.',
      act: _v87ModOk_(s, 'prodcat') ? { kind: 'open', module: 'prodcat', label: 'Открыть справочник' } : null }] : [];
  });
} catch (e) {}
