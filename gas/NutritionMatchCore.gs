// ЦЕХ — NutritionMatchCore.gs
// Сопоставление сырья организации с базой КБЖУ (GLOBAL_PRODUCTS), как синхронизация
// ТТК с «Продукты_Справочник» в MON CHEF: названия ингредиентов («Лук репчатый
// очищенный П/Ф», «Сливки молочные 22 %») почти никогда не совпадают с базой дословно,
// поэтому сравниваем по ключевым словам (обрезанным до 5 букв — грубая замена
// лемматизации: «помидоры» и «помидор» → «помид»).
//
// Уровни уверенности: «точно» — тот же набор слов; «частично» — слова одного названия
// входят в другое; «похоже» — много общих слов, нужна проверка; «не найдено».
// Система ПРЕДЛАГАЕТ, привязку подтверждает человек (APPLY_NUTRITION_MATCHES).
// Сама база загружается импортом (Соответствие → Импорт, формат MON CHEF).

var NM_STOP = {};
('п ф пф очищенный очищенная очищенное очищенные зачищенный зачищенная зачищенное зачищенные ' +
 'без с со рассола кожи кости и на для от из свежий свежая свежее свежие ' +
 'отварной отварная отварное отварные жареный жареная жареное жареные ' +
 'маринованный маринованная маринованное маринованные консервированный консервированная консервированное консервированные ' +
 'копченый копченая копченое копченые тушка тушки шт кг г гр мл л ' +
 'охлажденный охлажденная охлажденное охлажденные замороженный замороженная замороженное замороженные ' +
 'крупа готовый готовая готовое новый новая произ произв собственного полуфабрикат ассортименте зачистка вес пакетах разделанная разделанный')
  .split(' ').forEach(function (w) { if (w) NM_STOP[w] = true; });

// Синонимы целых фраз — до разбиения на слова. Границы слов заданы явно:
// \b в JS не считает кириллицу буквами.
var NM_PHRASE_ALIASES = [
  [/(^|[^а-я])масло растительное(?=$|[^а-я])/g, '$1масло подсолнечное'],
  [/^черри$/, 'помидор'],
  [/^яйцо$/, 'яйца куриные'],
  [/(^|[^а-я])мука в\/с(?=$|[^а-я])/g, '$1мука пшеничная'],
  [/(^|[^а-я])мука 1\/с(?=$|[^а-я])/g, '$1мука пшеничная'],
  [/^мука$/, 'мука пшеничная'],
  [/(^|[^а-я])икра красная(?=$|[^а-я])/g, '$1икра красная лососевая']
];

var NM_METHOD_RANK = { 'точно': 3, 'частично': 2, 'похоже': 1 };

/** Слова названия: words — целиком, tokens — обрезанные до 5 букв (без скобок), full — со словами из скобок. */
function _nmParse_(name) {
  var s = String(name || '').toLowerCase().replace(/ё/g, 'е').trim();
  NM_PHRASE_ALIASES.forEach(function (p) { s = s.replace(p[0], p[1]); });
  var split = function (txt) {
    return txt.replace(/\d+[.,]?\d*\s*(г|гр|кг|мл|л|%|шт)(?=$|[^а-я])/g, ' ').replace(/[^a-zа-я0-9]+/g, ' ')
      .split(/\s+/).filter(function (t) { return t.length >= 2 && !NM_STOP[t] && !/^\d+$/.test(t); });
  };
  var stems = function (words) {
    var seen = {}, out = [];
    words.forEach(function (t) { var st = t.length > 5 ? t.slice(0, 5) : t; if (!seen[st]) { seen[st] = true; out.push(st); } });
    return out;
  };
  var main = split(s.replace(/\([^)]*\)/g, ' ')), all = split(s);
  return { words: all, tokens: stems(main), full: stems(all) };
}

function _nmTokens_(name) { return _nmParse_(name).tokens; }

/** Похожесть слов целиком: сумма общих начал (отличает «сельдерей» от «сельдь»). */
function _nmPrefix_(wa, wb) {
  return wa.reduce(function (sum, a) {
    return sum + wb.reduce(function (best, b) { var k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return Math.max(best, k); }, 0);
  }, 0);
}

function _nmHasKbju_(g) {
  return [g.protein_g_100g, g.fat_g_100g, g.carbohydrate_g_100g].every(function (v) { return v !== '' && v !== null && v !== undefined && !isNaN(Number(v)); });
}

/** Индекс базы: только записи с полным Б/Ж/У, с обратным индексом по словам. */
function _nmIndex_() {
  var entries = [], inverted = {};
  getGlobalProducts_({}).filter(_nmHasKbju_).forEach(function (g) {
    var parsed = _nmParse_(g.name), tokens = parsed.tokens;
    if (!tokens.length) return;
    var i = entries.length;
    entries.push({ g: g, tokens: tokens, full: parsed.full, words: parsed.words });
    tokens.forEach(function (t) { (inverted[t] = inverted[t] || []).push(i); });
  });
  return { entries: entries, inverted: inverted };
}

function _nmScore_(a, b) {
  var setA = {}, setB = {};
  a.forEach(function (t) { setA[t] = true; });
  b.forEach(function (t) { setB[t] = true; });
  var inter = a.filter(function (t) { return setB[t]; }).length;
  var aInB = inter === a.length, bInA = inter === b.length;
  var jac = inter / (a.length + b.length - inter);
  if (aInB && bInA) return { method: 'точно', score: 1 };
  if ((aInB || bInA) && jac >= 0.34) return { method: 'частично', score: jac };
  if (jac >= 0.5) return { method: 'похоже', score: jac };
  return null;
}

/** Лучшие кандидаты для названия: сначала по уровню уверенности, затем по доле общих слов. */
function _nmCandidates_(name, idx, limit) {
  var parsed = _nmParse_(name), tokens = parsed.tokens;
  if (!tokens.length) return [];
  var cand = {};
  tokens.forEach(function (t) { (idx.inverted[t] || []).forEach(function (i) { cand[i] = true; }); });
  var out = [];
  Object.keys(cand).forEach(function (i) {
    var e = idx.entries[i], s = _nmScore_(tokens, e.tokens);
    if (!s) return;
    var fullHit = parsed.full.filter(function (t) { return e.full.indexOf(t) !== -1; }).length;
    out.push({ e: e, method: s.method, score: s.score, full: fullHit, prefix: _nmPrefix_(parsed.words, e.words) });
  });
  // Уровень уверенности → совпадение со словами из скобок («Зелень (петрушка, укроп)»)
  // → похожесть слов целиком → доля общих слов → более короткое название базы.
  out.sort(function (x, y) {
    return (NM_METHOD_RANK[y.method] - NM_METHOD_RANK[x.method]) || (y.full - x.full) || (y.prefix - x.prefix) ||
      (y.score - x.score) || (x.e.tokens.length - y.e.tokens.length);
  });
  return out.slice(0, limit || 5).map(function (c) {
    var g = c.e.g;
    return { global_product_id: g.global_product_id, name: g.name, method: c.method, score: Math.round(c.score * 100) / 100,
      kcal: g.calories_kcal_100g, protein: g.protein_g_100g, fat: g.fat_g_100g, carbohydrate: g.carbohydrate_g_100g,
      verified: g.verified === 'да', source: g.source || '' };
  });
}

/** Сырьё рецептуры блюда/ПФ с раскрытием вложенных ПФ (без повторов). */
function _nmRecipeProducts_(parentType, parentId, depth, visited, out) {
  if (depth > 10) return;
  getRecipeLines_(parentType, parentId).forEach(function (l) {
    var id = String(l.product_id || '');
    if (!id) return;
    if (id.indexOf('PF-') === 0) {
      if (visited[id]) return;
      visited[id] = true;
      _nmRecipeProducts_('PF', id, depth + 1, visited, out);
      return;
    }
    if (out.ids[id]) return;
    var p = getProductById_(id);
    if (p) { out.ids[id] = true; out.list.push(p); }
  });
}

/**
 * Предложения привязки к базе КБЖУ. data: {dishId} | {pfId} | {all:true} (всё сырьё организации).
 * Уже привязанные к записи с КБЖУ продукты не предлагаются заново, только считаются.
 */
function getNutritionMatches_(data, session) {
  data = data || {};
  var products;
  if (data.all) {
    products = findRows_('PRODUCTS', function (p) { return p.organization_id === session.organization_id && p.активность !== 'нет'; });
  } else {
    var type = data.pfId ? 'PF' : 'DISH', id = data.pfId || data.dishId;
    if (!id) throw new Error('Укажите блюдо или ПФ.');
    var entity = type === 'PF' ? getSemiFinishedById_(id) : findOne_('DISHES', 'dish_id', id);
    assertOwnedByOrg_(session, entity, (type === 'PF' ? 'SEMI_FINISHED:' : 'DISHES:') + id);
    var acc = { ids: {}, list: [] }, visited = {};
    if (type === 'PF') visited[id] = true;
    _nmRecipeProducts_(type, id, 0, visited, acc);
    products = acc.list;
  }
  var idx = _nmIndex_();
  var stats = { total: 0, linked: 0, exact: 0, partial: 0, guess: 0, not_found: 0, no_kbju_needed: 0 };
  var items = [];
  products.forEach(function (p) {
    var name = p.название || p.product_id;
    stats.total++;
    if (_tsIsSalt_(name) || /(^|[^а-яё])вода([^а-яё]|$)/i.test(name)) { stats.no_kbju_needed++; return; }
    var linked = p.global_product_id ? getGlobalProductById_(p.global_product_id) : null;
    if (linked && _nmHasKbju_(linked)) {
      stats.linked++;
      return;
    }
    var cands = _nmCandidates_(name, idx, 5);
    var method = cands.length ? cands[0].method : 'не найдено';
    stats[{ 'точно': 'exact', 'частично': 'partial', 'похоже': 'guess', 'не найдено': 'not_found' }[method]]++;
    items.push({ product_id: p.product_id, name: name, method: method, candidates: cands,
      linked_without_kbju: linked ? linked.name : '' });
  });
  items.sort(function (a, b) { return ((NM_METHOD_RANK[b.method] || 0) - (NM_METHOD_RANK[a.method] || 0)) || String(a.name).localeCompare(String(b.name), 'ru'); });
  return { base_size: idx.entries.length, stats: stats, items: items };
}

/** Подтверждённые человеком привязки: [{productId, globalProductId}]. */
function applyNutritionMatches_(data, session) {
  var links = (data && data.links) || [];
  if (!links.length) throw new Error('Не отмечено ни одной привязки.');
  var done = [], errors = [];
  links.forEach(function (l) {
    try {
      var g = getGlobalProductById_(l.globalProductId);
      if (!g || !_nmHasKbju_(g)) throw new Error('в записи базы нет КБЖУ');
      linkProductToGlobal_(l.productId, l.globalProductId, session.user_id, session);
      done.push(l.productId);
    } catch (e) {
      errors.push({ product_id: l.productId, error: e.message });
    }
  });
  return { linked: done.length, errors: errors };
}
