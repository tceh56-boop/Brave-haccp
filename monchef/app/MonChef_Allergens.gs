/**
 * MON CHEF — аллергены: справочник → профиль продукта → автоматический расчёт по ТТК.
 *
 * Справочник — перечень ТР ТС 022/2011 (ст. 4.4, п. 13). Профиль продукта вводит человек
 * по документу (спецификация, маркировка, декларация): «содержит …» или «не содержит».
 * Система профиль НЕ придумывает: по названию продукта она только подсказывает, какие
 * аллергены стоит проверить, — подсказка в расчёт блюда как факт не идёт.
 * Блюдо: состав раскрывается через полуфабрикаты до сырья; аллерген блюда = объединение
 * подтверждённых профилей. Продукты без профиля показываются отдельно — пока они есть,
 * профиль блюда помечен «неполный».
 * Лист «Аллергены_Продукты»: история; действует последняя запись по продукту.
 */
var MC_AL_SHEET_ = 'Аллергены_Продукты';
var MC_AL_HEAD_ = ['ProductID', 'Продукт', 'Аллергены (коды)', 'Статус', 'Основание (документ)', 'Кто', 'Когда', 'OperationID', 'Комментарий'];
var MC_ALLERGENS_ = [
  { code: 'GLUTEN', name: 'Злаки с глютеном', hint: /пшен|мук[аи]|ржан|ячм|овс|манк|булгур|кускус|хлеб|сухар|панко|макарон|спагетти|лапш|паста\b|тесто|блин|соус соев|пиво/ },
  { code: 'CRUSTACEANS', name: 'Ракообразные', hint: /креветк|краб|лобстер|омар|лангуст|рак[иа ]/ },
  { code: 'EGGS', name: 'Яйца', hint: /яйц|яичн|майонез|желток|белок яич/ },
  { code: 'FISH', name: 'Рыба', hint: /рыб|лосос|семг|форел|тунец|треск|судак|сибас|дорадо|анчоус|сельд|икра|масаго|тобико|рыбный соус/ },
  { code: 'PEANUTS', name: 'Арахис', hint: /арахис/ },
  { code: 'SOY', name: 'Соя', hint: /со[яи]\b|соев|тофу|эдамам|мисо/ },
  { code: 'MILK', name: 'Молоко и лактоза', hint: /молок|молоч|сливк|сметан|сыр|творог|масло сливоч|кефир|йогурт|пармез|моцарел|маскарпоне|рикотт|сгущ/ },
  { code: 'NUTS', name: 'Орехи', hint: /орех|миндал|фундук|кешью|фисташ|пекан|макадам|кедров/ },
  { code: 'CELERY', name: 'Сельдерей', hint: /сельдер/ },
  { code: 'MUSTARD', name: 'Горчица', hint: /горчиц|дижон/ },
  { code: 'SESAME', name: 'Кунжут', hint: /кунжут|тахини/ },
  { code: 'SULPHITES', name: 'Диоксид серы и сульфиты (>10 мг/кг)', hint: /вино|винн|уксус винн|курага|изюм|сухофрукт/ },
  { code: 'LUPIN', name: 'Люпин', hint: /люпин/ },
  { code: 'MOLLUSCS', name: 'Моллюски', hint: /кальмар|осьмин|миди|устриц|гребешок|моллюск|каракатиц/ }
];
function _alByCode_() { var m = {}; MC_ALLERGENS_.forEach(function (a) { m[a.code] = a; }); return m; }
function _alKey_(n) { return String(_cleanProdName_(n) || n || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
function _alHints_(name) { var k = _alKey_(name); return MC_ALLERGENS_.filter(function (a) { return a.hint.test(k); }).map(function (a) { return a.code; }); }
function _alSheet_() { return _bcSheet_(MC_AL_SHEET_, MC_AL_HEAD_); }
/** Действующие профили: ключ — нормализованное имя продукта. */
function _alProfiles_() {
  var v = _alSheet_().getDataRange().getValues(), m = {};
  for (var i = 1; i < v.length; i++) {
    if (!v[i][1]) continue;
    m[_alKey_(v[i][1])] = { productId: String(v[i][0] || ''), product: String(v[i][1]), codes: String(v[i][2] || '').split(/[,;\s]+/).filter(Boolean),
      status: String(v[i][3] || ''), basis: String(v[i][4] || ''), who: String(v[i][5] || ''), at: _bcDate_(v[i][6]), op: String(v[i][7] || '') };
  }
  return m;
}
/** Раскрыть блюдо/п/ф до сырья: { продукт → [через что] }. */
function _alRawOf_(idx, d) {
  var raw = {};
  (function walk(ing, depth, seen, via) {
    (ing || []).forEach(function (x) {
      var sub = depth < 10 ? _findSubDish_(x[0], idx.dishByNormName, idx.dishByLooseName) : null;
      if (sub && sub.ing && sub.ing.length && seen.indexOf(sub.code) < 0) { walk(sub.ing, depth + 1, seen.concat(sub.code), sub.name); return; }
      var k = _alKey_(x[0]); if (!k) return;
      var a = raw[k] || (raw[k] = { name: _cleanProdName_(x[0]) || String(x[0]), via: {} });
      a.via[via || d.name] = true;
    });
  })(d.ing, 0, [d.code], '');
  return raw;
}
/** Аллергены блюда по ТТК. Только подтверждённые профили — факт; подсказки отдельно. */
function _alDishAllergens_(idx, code) {
  var d = idx.dishByCode[code]; if (!d) return null;
  var prof = _alProfiles_(), raw = _alRawOf_(idx, d), dir = _alByCode_();
  var found = {}, unknown = [], hints = [];
  Object.keys(raw).forEach(function (k) {
    var p = prof[k], r = raw[k];
    if (p && (p.status === 'CONFIRMED' || p.status === 'NONE')) {
      if (p.status === 'CONFIRMED') p.codes.forEach(function (c) {
        if (!dir[c]) return;
        var f = found[c] || (found[c] = { code: c, name: dir[c].name, products: [] });
        f.products.push(r.name + (Object.keys(r.via)[0] !== d.name ? ' (через ' + Object.keys(r.via).join(', ') + ')' : ''));
      });
    } else {
      unknown.push(r.name);
      var h = _alHints_(r.name); if (h.length) hints.push({ product: r.name, codes: h, names: h.map(function (c) { return dir[c].name; }) });
    }
  });
  var list = MC_ALLERGENS_.filter(function (a) { return found[a.code]; }).map(function (a) { return found[a.code]; });
  return { code: code, name: d.name, allergens: list, unknown: unknown.sort(), hints: hints, products: Object.keys(raw).length, complete: unknown.length === 0 };
}

function mcGetDishAllergens(code, token) {
  try { _requireAuth_(token); var r = _alDishAllergens_(_buildDishIndexes_(), String(code || '')); return r ? _ok_(r) : _fail_('NOT_FOUND', 'Блюдо не найдено'); }
  catch (e) { return _failFrom_(e); }
}
/** Справочник + продукты из ТТК: с профилем и без, с подсказками. */
function mcGetAllergenRegistry(token) {
  try {
    _requireAuth_(token);
    var idx = _buildDishIndexes_(), prof = _alProfiles_(), all = {};
    Object.keys(idx.dishByCode).forEach(function (c) {
      var d = idx.dishByCode[c];
      (d.ing || []).forEach(function (x) {
        if (_findSubDish_(x[0], idx.dishByNormName, idx.dishByLooseName)) return;
        var k = _alKey_(x[0]); if (!k) return;
        var a = all[k] || (all[k] = { key: k, name: _cleanProdName_(x[0]) || String(x[0]), dishes: 0 });
        a.dishes++;
      });
    });
    Object.keys(prof).forEach(function (k) { if (!all[k]) all[k] = { key: k, name: prof[k].product, dishes: 0 }; });
    var items = Object.keys(all).map(function (k) {
      var a = all[k], p = prof[k] || null;
      return { name: a.name, dishes: a.dishes, profile: p, hints: p ? [] : _alHints_(a.name) };
    }).sort(function (a, b) { return (a.profile ? 1 : 0) - (b.profile ? 1 : 0) || b.dishes - a.dishes || a.name.localeCompare(b.name, 'ru'); });
    var done = items.filter(function (x) { return x.profile; }).length;
    return _ok_({ directory: MC_ALLERGENS_.map(function (a) { return { code: a.code, name: a.name }; }), items: items, total: items.length, confirmed: done });
  } catch (e) { return _failFrom_(e); }
}
/** Профиль продукта: человек по документу. status CONFIRMED (есть коды) или NONE (не содержит). */
function mcSetProductAllergens(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'ttk_approve|haccp', 'ALLERGEN_PROFILE', 'Аллергены', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var name = String(d.product || '').trim(), basis = String(d.basis || '').trim(), dir = _alByCode_();
    var codes = (d.codes || []).map(String).filter(function (c, i, a) { return dir[c] && a.indexOf(c) === i; });
    var st = d.status === 'NONE' ? 'NONE' : 'CONFIRMED';
    if (!name) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите продукт', op.id); }
    if (!basis) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите основание: спецификация, маркировка или декларация — без документа профиль не принимается', op.id); }
    if (st === 'CONFIRMED' && !codes.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Отметьте аллергены или выберите «не содержит»', op.id); }
    if (st === 'NONE' && (d.codes || []).length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', '«Не содержит» нельзя сочетать с отмеченными аллергенами', op.id); }
    return _withLock_(function () {
      var prev = _alProfiles_()[_alKey_(name)] || null, who = (op.session && (op.session.fullName || op.session.name)) || '';
      _alSheet_().appendRow([_mdProductId_(name), name, st === 'NONE' ? '' : codes.join(','), st, basis, who, new Date(), op.id, d.note || '']);
      _audit_(op, 'ALLERGEN_PROFILE', 'Аллергены', name, prev ? [prev.status, prev.codes.join(',')] : null, [st, codes.join(','), basis]);
      _endOp_(op, 'COMPLETED');
      return _ok_({ product: name, status: st, codes: codes }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
