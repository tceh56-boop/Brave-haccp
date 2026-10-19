// ЦЕХ — TtkImportCore.gs
// Импорт архива ТТК: предпросмотр → правка технологом → подтверждение.
//
// Файлы архива (Excel) разбирает tools/ttk_archive/extract_ttk_archive.py — Apps Script
// не читает .xls (та же граница, что у импорта продуктов). Сюда приходит JSON карт.
// Сервер раскладывает технологию на этапы (parseTechnologySteps_), предлагает режим подачи,
// сопоставляет сырьё с номенклатурой и с другими картами архива. Ничего не создаёт до
// подтверждения технологом: подтверждение создаёт блюдо/ПФ, рецептуру и черновик ТТК.
//
// Решения (флагую явно):
//  - «ПФ» без своей карты в архиве («Чеснок очищенный П/Ф», «Зелень очищенная П/Ф») по
//    умолчанию предлагаются как новый продукт — это очищенное сырьё. Технолог может
//    сопоставить их с существующим продуктом/ПФ.
//  - Строка с единицей «порция» — ссылка на другую карту архива (соус, гарнир в ассорти).
//    Такая карта импортируется как ПФ, количество = порции × выход карты.
//  - Одноимённые карты с одинаковым составом помечаются DUPLICATE; с разным — предупреждение.
//  - ТТК без текста технологии не создаётся (createTtkVersion_ требует технологию): блюдо
//    и рецептура импортируются, ТТК — нет, это видно в результате.
//  - Срок/условия хранения: из расчёта по нормам, иначе заглушка TTK_FILL_PLACEHOLDER,
//    с которой ТТК нельзя отправить на утверждение.

var TTK_IMPORT_CHUNK_MAX = 60;
var TTK_IMPORT_CONFIRM_MAX = 10;

function _tiNorm_(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е')
    .replace(/п\s*[\/\-]?\s*ф(?![а-я])/g, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*(?:кг|гр|г|мл|л|шт)(?![а-я])/g, ' ')
    .replace(/[^a-zа-я0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function _tiJson_(v, fb) { try { return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }

function _tiIsPfName_(name) { return /п\s*[\/\-]?\s*ф(?![а-яё])/i.test(String(name || '')); }

function _tiFingerprint_(card) {
  return (card.lines || []).map(function (l) { return _tiNorm_(l.name) + ':' + l.unit + ':' + (l.netto || l.brutto || 0); }).sort().join('|');
}

/** Индекс номенклатуры организации по нормализованному названию. */
function _tiOrgIndex_(organizationId) {
  var products = {}, pfs = {}, dishes = {};
  findRows_('PRODUCTS', function (p) { return p.organization_id === organizationId && p.активность !== 'нет'; }).forEach(function (p) {
    [p.название, p.внутреннее_название].forEach(function (n) { var k = _tiNorm_(n); if (k && !products[k]) products[k] = p.product_id; });
  });
  findRows_('SEMI_FINISHED', function (p) { return p.organization_id === organizationId; }).forEach(function (p) { var k = _tiNorm_(p.название); if (k && !pfs[k]) pfs[k] = p.pf_id; });
  findRows_('DISHES', function (d) { return d.organization_id === organizationId; }).forEach(function (d) { var k = _tiNorm_(d.название); if (k && !dishes[k]) dishes[k] = d.dish_id; });
  // Справочник КБЖУ платформы: связываем только однозначное совпадение названия.
  var globals = {}, ambiguous = {};
  findRows_('GLOBAL_PRODUCTS', function (g) { return g.status !== 'archived'; }).forEach(function (g) {
    var k = _tiNorm_(g.name); if (!k) return;
    if (globals[k] && globals[k] !== g.global_product_id) ambiguous[k] = true; else globals[k] = g.global_product_id;
  });
  Object.keys(ambiguous).forEach(function (k) { delete globals[k]; });
  return { products: products, pfs: pfs, dishes: dishes, globals: globals };
}

/** Сопоставление строки сырья: существующий ПФ/продукт → карта архива → новый продукт. */
function _tiMapLine_(line, idx, archiveNames) {
  var k = _tiNorm_(line.name);
  if (line.is_portion_ref || line.unit === 'порция') {
    if (archiveNames[k]) return { type: 'ARCHIVE', norm: k, note: 'вложенная карта архива' };
    return { type: 'UNRESOLVED', note: 'единица «порция», но карта «' + line.name + '» не найдена в архиве и системе' };
  }
  if (idx.pfs[k]) return { type: 'PF', id: idx.pfs[k] };
  if (idx.products[k]) return { type: 'PRODUCT', id: idx.products[k] };
  if (archiveNames[k]) return { type: 'ARCHIVE', norm: k, note: 'ПФ из архива' };
  return { type: 'NEW_PRODUCT', note: _tiIsPfName_(line.name) ? 'ПФ без своей карты — будет создан как продукт (очищенное сырьё)' : 'новый продукт' };
}

/**
 * Загрузка порции карт в предпросмотр. data: {importId?, sourceName, cards:[...],
 * allNames:[...все названия карт загрузки], refNames:[...названия, на которые ссылаются как на порцию/ПФ]}.
 */
function previewTtkImport_(data, session) {
  return withLock_(function () {
    var cards = Array.isArray(data.cards) ? data.cards : [];
    if (!cards.length) throw new Error('Нет карт для импорта.');
    if (cards.length > TTK_IMPORT_CHUNK_MAX) throw new Error('Не более ' + TTK_IMPORT_CHUNK_MAX + ' карт за один вызов.');
    var batch;
    if (data.importId) {
      batch = findOne_('TTK_IMPORT_BATCHES', 'import_id', data.importId); assertOwnedByOrg_(session, batch, 'TTK_IMPORT_BATCHES:' + data.importId);
    } else {
      batch = { import_id: generateId_('TTK_IMPORT_BATCHES'), organization_id: session.organization_id, source_name: String(data.sourceName || 'архив ТТК'), status: 'PREVIEW', total: 0, created_by: session.user_id, created_at: nowIso_() };
      insertRow_('TTK_IMPORT_BATCHES', batch);
    }
    var archiveNames = {}, refNames = {};
    (data.allNames || cards.map(function (c) { return c.name; })).forEach(function (n) { archiveNames[_tiNorm_(n)] = true; });
    (data.refNames || []).forEach(function (n) { refNames[_tiNorm_(n)] = true; });
    var idx = _tiOrgIndex_(session.organization_id);
    var existing = findRows_('TTK_IMPORT_ROWS', function (r) { return r.import_id === batch.import_id; });
    var seen = {};
    existing.forEach(function (r) { seen[r.norm_name + '#' + r.fingerprint] = r.row_id; seen[r.norm_name] = seen[r.norm_name] || r.row_id; });
    var created = [];
    cards.forEach(function (card) {
      var norm = _tiNorm_(card.name), fp = _tiFingerprint_(card);
      var catText = (card.category_path || []).join(' / ');
      var isPf = _tiIsPfName_(card.name) || /^08/.test((card.category_path || [])[0] || '') || !!refNames[norm];
      var steps = card.technology ? parseTechnologySteps_(card.technology) : [];
      var mapping = (card.lines || []).map(function (l) { return _tiMapLine_(l, idx, archiveNames); });
      var warnings = (card.issues || []).slice();
      var status = 'PREVIEW', dupOf = '';
      if (seen[norm + '#' + fp]) { status = 'DUPLICATE'; dupOf = seen[norm + '#' + fp]; }
      else if (seen[norm]) warnings.push('Есть одноимённая карта с другим составом — проверьте, какая актуальна.');
      if (!isPf && idx.dishes[norm]) warnings.push('Блюдо с таким названием уже есть в системе.');
      if (isPf && idx.pfs[norm]) warnings.push('ПФ с таким названием уже есть в системе.');
      if (refNames[norm] && !_tiIsPfName_(card.name)) warnings.push('На карту ссылаются другие карты как на компонент — импортируется как ПФ.');
      var row = {
        row_id: generateId_('TTK_IMPORT_ROWS'), import_id: batch.import_id, organization_id: session.organization_id,
        source_path: card.source_path || '', category: catText, name: card.name || '', norm_name: norm, fingerprint: fp,
        kind: isPf ? 'PF' : 'DISH', yield_g: card.yield_g || '', yield_source: card.yield_source || '', basis: card.basis || '',
        serving_mode: isPf ? '' : guessServingMode_('', catText, steps),
        card_json: JSON.stringify({ lines: card.lines || [], technology: card.technology || '', yield_raw: card.yield_raw || '', production_basis: card.production_basis || '', format: card.format || '' }),
        steps_json: JSON.stringify(steps), mapping_json: JSON.stringify(mapping), warnings_json: JSON.stringify(warnings),
        status: status, duplicate_of: dupOf, link_existing: false, entity_id: '', ttk_version_id: '', result_json: '',
        decided_by: '', decided_at: '', created_at: nowIso_()
      };
      insertRow_('TTK_IMPORT_ROWS', row);
      seen[norm + '#' + fp] = seen[norm + '#' + fp] || row.row_id; seen[norm] = seen[norm] || row.row_id;
      created.push(row.row_id);
    });
    updateRow_('TTK_IMPORT_BATCHES', findOne_('TTK_IMPORT_BATCHES', 'import_id', batch.import_id), { total: existing.length + created.length });
    return { import_id: batch.import_id, added: created.length, total: existing.length + created.length };
  });
}

/** Блокеры подтверждения строки (считаются на лету: ссылки на архив зависят от других строк). */
function _tiBlockers_(row, rowsByNorm) {
  var b = [], card = _tiJson_(row.card_json, {}), mapping = _tiJson_(row.mapping_json, []);
  if (!(Number(row.yield_g) > 0)) b.push('Не задан выход.');
  if (!(card.lines || []).length) b.push('Нет строк сырья.');
  mapping.forEach(function (m, i) {
    var l = (card.lines || [])[i] || {};
    if (m.type === 'UNRESOLVED') b.push('Строка «' + l.name + '»: ' + (m.note || 'не сопоставлена') + '.');
    if (m.type === 'ARCHIVE') {
      var ref = _tiResolveRef_(rowsByNorm, m.norm, row.row_id);
      if (!ref) b.push('Строка «' + l.name + '»: другой карты с таким названием в архиве нет — сопоставьте вручную.');
      else if (ref.status !== 'CONFIRMED') b.push('Сначала подтвердите ПФ «' + ref.name + '».');
    }
    if (m.type !== 'SKIP' && !(Number(l.brutto) > 0 || Number(l.netto) > 0)) b.push('Строка «' + l.name + '»: нет количества.');
  });
  return b;
}

function _tiRowsByNorm_(importId) {
  var rows = findRows_('TTK_IMPORT_ROWS', function (r) { return r.import_id === importId; });
  var by = {};
  rows.forEach(function (r) { (by[r.norm_name] = by[r.norm_name] || []).push(r); });
  return { rows: rows, by: by };
}

/**
 * Карта архива, на которую ссылается строка: не сама карта (у «Зельц 200 г» строка
 * «Зельц п/ф» после нормализации совпадает с собственным названием), приоритет —
 * подтверждённая, затем ПФ, затем не дубликат и не пропущенная.
 */
function _tiResolveRef_(by, norm, selfId) {
  var list = (by[norm] || []).filter(function (r) { return r.row_id !== selfId && r.status !== 'SKIPPED'; });
  var score = function (r) { return (r.status === 'CONFIRMED' ? 4 : 0) + (r.kind === 'PF' ? 2 : 0) + (r.status !== 'DUPLICATE' ? 1 : 0); };
  list.sort(function (a, b) { return score(b) - score(a); });
  return list[0] || null;
}

function _tiRowView_(r, by, full) {
  var warnings = _tiJson_(r.warnings_json, []), steps = _tiJson_(r.steps_json, []);
  var v = { row_id: r.row_id, name: r.name, category: r.category, kind: r.kind, yield_g: r.yield_g, yield_source: r.yield_source, serving_mode: r.serving_mode,
    status: r.status, duplicate_of: r.duplicate_of, entity_id: r.entity_id, ttk_version_id: r.ttk_version_id, warnings: warnings,
    steps_count: steps.length, has_thermal: steps.some(function (s) { return techStepType_(s) === 'THERMAL'; }),
    blockers: r.status === 'PREVIEW' ? _tiBlockers_(r, by) : [], link_existing: r.link_existing === true || r.link_existing === 'TRUE' };
  if (full) { v.card = _tiJson_(r.card_json, {}); v.steps = steps; v.mapping = _tiJson_(r.mapping_json, []); v.result = _tiJson_(r.result_json, null); v.source_path = r.source_path; }
  return v;
}

function getTtkImports_(session) {
  return findRows_('TTK_IMPORT_BATCHES', function (b) { return b.organization_id === session.organization_id; }).map(function (b) { var o = {}; Object.keys(b).forEach(function (k) { if (k !== '__row') o[k] = b[k]; }); return o; }).reverse();
}

function getTtkImport_(data, session) {
  var batch = findOne_('TTK_IMPORT_BATCHES', 'import_id', data.importId); assertOwnedByOrg_(session, batch, 'TTK_IMPORT_BATCHES:' + data.importId);
  var x = _tiRowsByNorm_(batch.import_id);
  var rows = x.rows.map(function (r) { return _tiRowView_(r, x.by, false); });
  var stat = { total: rows.length, ready: 0, waiting_pf: 0, blocked: 0, confirmed: 0, skipped: 0, duplicate: 0, error: 0 };
  rows.forEach(function (r) {
    if (r.status === 'CONFIRMED') stat.confirmed++; else if (r.status === 'SKIPPED') stat.skipped++; else if (r.status === 'DUPLICATE') stat.duplicate++; else if (r.status === 'ERROR') stat.error++;
    else if (!r.blockers.length) stat.ready++;
    else if (r.blockers.every(function (b) { return b.indexOf('Сначала подтвердите ПФ') === 0; })) stat.waiting_pf++;
    else stat.blocked++;
  });
  return { batch: { import_id: batch.import_id, source_name: batch.source_name, status: batch.status, created_at: batch.created_at }, stats: stat, rows: rows };
}

function getTtkImportRow_(data, session) {
  var r = findOne_('TTK_IMPORT_ROWS', 'row_id', data.rowId); assertOwnedByOrg_(session, r, 'TTK_IMPORT_ROWS:' + data.rowId);
  return _tiRowView_(r, _tiRowsByNorm_(r.import_id).by, true);
}

/** Правка технологом: вид, выход, режим подачи, этапы, сопоставление строк, связь с существующим объектом. */
function updateTtkImportRow_(data, session) {
  return withLock_(function () {
    var r = findOne_('TTK_IMPORT_ROWS', 'row_id', data.rowId); assertOwnedByOrg_(session, r, 'TTK_IMPORT_ROWS:' + data.rowId);
    if (['PREVIEW', 'DUPLICATE', 'ERROR', 'SKIPPED'].indexOf(r.status) === -1) throw new Error('Строку в статусе ' + r.status + ' менять нельзя.');
    var patch = {}, card = _tiJson_(r.card_json, {});
    if (data.kind !== undefined) { if (['DISH', 'PF'].indexOf(data.kind) === -1) throw new Error('kind: DISH или PF.'); patch.kind = data.kind; }
    if (data.name !== undefined) { if (!String(data.name).trim()) throw new Error('Пустое название.'); patch.name = String(data.name).trim(); patch.norm_name = _tiNorm_(patch.name); }
    if (data.yield_g !== undefined) { var y = Number(String(data.yield_g).replace(',', '.')); if (!(y > 0)) throw new Error('Выход должен быть положительным числом.'); patch.yield_g = y; patch.yield_source = 'технолог'; }
    if (data.serving_mode !== undefined) { if (['HOT', 'COLD', ''].indexOf(data.serving_mode) === -1) throw new Error('Режим подачи: HOT, COLD или пусто.'); patch.serving_mode = data.serving_mode; }
    if (data.steps !== undefined) {
      if (!Array.isArray(data.steps)) throw new Error('steps — массив.');
      patch.steps_json = JSON.stringify(data.steps.map(function (s) { return { stage: String(s.stage || ''), step_type: TECH_STEP_TYPES[s.step_type] ? s.step_type : techStepType_(s), description: String(s.description || ''), temperature: String(s.temperature || ''), time: String(s.time || '') }; }));
    }
    if (data.mapping !== undefined) {
      if (!Array.isArray(data.mapping) || data.mapping.length !== (card.lines || []).length) throw new Error('mapping должен соответствовать строкам карты.');
      data.mapping.forEach(function (m, i) {
        if (['PRODUCT', 'PF', 'ARCHIVE', 'NEW_PRODUCT', 'SKIP'].indexOf(m.type) === -1) throw new Error('Строка ' + (i + 1) + ': недопустимый тип сопоставления.');
        if (m.type === 'PRODUCT') assertOwnedByOrg_(session, getProductById_(m.id), 'PRODUCTS:' + m.id);
        if (m.type === 'PF') assertOwnedByOrg_(session, getSemiFinishedById_(m.id), 'SEMI_FINISHED:' + m.id);
      });
      patch.mapping_json = JSON.stringify(data.mapping.map(function (m) { return { type: m.type, id: m.id || '', norm: m.norm || '', note: m.note || '' }; }));
    }
    if (data.link_existing !== undefined) patch.link_existing = !!data.link_existing;
    if (r.status !== 'PREVIEW' && data.reopen) { patch.status = 'PREVIEW'; patch.duplicate_of = ''; }
    updateRow_('TTK_IMPORT_ROWS', r, patch);
    return getTtkImportRow_({ rowId: r.row_id }, session);
  });
}

function skipTtkImportRow_(data, session) {
  var r = findOne_('TTK_IMPORT_ROWS', 'row_id', data.rowId); assertOwnedByOrg_(session, r, 'TTK_IMPORT_ROWS:' + data.rowId);
  if (r.status === 'CONFIRMED') throw new Error('Подтверждённую карту пропустить нельзя.');
  if (!data.reason) throw new Error('Укажите причину.');
  updateRow_('TTK_IMPORT_ROWS', r, { status: 'SKIPPED', result_json: JSON.stringify({ reason: data.reason }), decided_by: session.user_id, decided_at: nowIso_() });
  return { row_id: r.row_id, status: 'SKIPPED' };
}

function _tiBaseUnit_(unit) { return unit === 'л' || unit === 'мл' ? 'л' : unit === 'шт' ? 'шт' : 'кг'; }

/** Подтверждение одной строки (внутри общего lock): создание объекта, рецептуры, черновика ТТК. */
function _tiConfirmOne_(r, by, session, cache) {
  var blockers = _tiBlockers_(r, by);
  if (blockers.length) throw new Error(blockers.join(' '));
  var card = _tiJson_(r.card_json, {}), mapping = _tiJson_(r.mapping_json, []), steps = _tiJson_(r.steps_json, []);
  var result = { created_products: [], recipe_lines: 0, skipped_lines: [], ttk: '' };
  var idx = cache.idx;
  var linkExisting = r.link_existing === true || r.link_existing === 'TRUE';
  var entityId = r.kind === 'PF' ? idx.pfs[r.norm_name] : idx.dishes[r.norm_name];
  if (entityId && !linkExisting) throw new Error((r.kind === 'PF' ? 'ПФ' : 'Блюдо') + ' «' + r.name + '» уже есть в системе. Отметьте «связать с существующим» или переименуйте.');
  var fresh = !entityId;
  if (fresh) {
    // ПФ ведётся в кг: себестоимость ПФ — за единицу выхода, а строки архива — в кг (см. normalizeQty_).
    if (r.kind === 'PF') { entityId = createSemiFinished_({ organization_id: session.organization_id, название: r.name, выход: Number(r.yield_g) / 1000, единица: 'кг' }).pf_id; idx.pfs[r.norm_name] = entityId; }
    else { entityId = createDish_({ organization_id: session.organization_id, название: r.name, категория_id: r.category, выход: Number(r.yield_g) }, session.user_id).dish_id; idx.dishes[r.norm_name] = entityId; }
  } else if (getRecipeLines_(r.kind === 'PF' ? 'PF' : 'DISH', entityId).length) {
    result.note = 'Связано с существующим объектом: рецептура не менялась.';
  }
  if (fresh || !result.note) {
    (card.lines || []).forEach(function (l, i) {
      var m = mapping[i] || { type: 'NEW_PRODUCT' };
      if (m.type === 'SKIP') { result.skipped_lines.push(l.name); return; }
      var qty = Number(l.brutto) > 0 ? Number(l.brutto) : Number(l.netto), net = Number(l.netto) > 0 ? Number(l.netto) : qty, unit = l.unit;
      var ingredientId;
      if (m.type === 'PRODUCT' || m.type === 'PF') ingredientId = m.id;
      else if (m.type === 'ARCHIVE') {
        var ref = _tiResolveRef_(by, m.norm, r.row_id); ingredientId = ref.entity_id;
        if (unit === 'порция') { qty = qty * Number(ref.yield_g) / 1000; net = net * Number(ref.yield_g) / 1000; unit = 'кг'; }
      } else {
        var k = _tiNorm_(l.name);
        ingredientId = idx.products[k];
        if (!ingredientId) {
          var gid = idx.globals[k] || '';
          ingredientId = createProduct_({ organization_id: session.organization_id, название: String(l.name).trim(), единица: _tiBaseUnit_(unit), global_product_id: gid, userId: session.user_id }).product_id;
          idx.products[k] = ingredientId; result.created_products.push(l.name + (gid ? ' (КБЖУ из справочника)' : ''));
        }
      }
      if (unit === 'порция') unit = 'шт';
      var loss = qty > 0 && net < qty ? Math.round((1 - net / qty) * 1000) / 10 : 0;
      addRecipeLine_(r.kind === 'PF' ? 'PF' : 'DISH', entityId, ingredientId, qty, net, unit, loss, session);
      result.recipe_lines++;
    });
  }
  if (r.kind === 'PF' && typeof createPfTechFromImport_ === 'function') {
    if (String(card.technology || '').trim().length >= 10 || steps.length) result.pf_tech = createPfTechFromImport_(entityId, card.technology || '', steps, r.source_path || r.name, session).pf_tech_id;
    else result.pf_tech_skipped = 'Нет текста технологии — техкарта ПФ не создана.';
  }
  if (r.kind === 'DISH') {
    if (String(card.technology || '').trim().length >= 10) {
      var shelf = typeof calcShelfLife_ === 'function' ? calcShelfLife_('DISH', entityId, session, steps, r.serving_mode) : null;
      var ttk = createTtkVersion_({
        dishId: entityId, источник: 'Архив ТТК: ' + (r.source_path || r.name), область_применения: r.name, технология: card.technology,
        условия_хранения: shelf && shelf.hours !== null ? shelf.conditions : TTK_FILL_PLACEHOLDER,
        срок_реализации: shelf && shelf.hours !== null ? shelf.text : TTK_FILL_PLACEHOLDER,
        технологическиеЭтапы: steps, режим_подачи: r.serving_mode
      }, session);
      result.ttk = ttk.ttk_version_id;
    } else result.ttk_skipped = 'Нет текста технологии — ТТК не создана, заполните в редакторе.';
  }
  updateRow_('TTK_IMPORT_ROWS', r, { status: 'CONFIRMED', entity_id: entityId, ttk_version_id: result.ttk || '', result_json: JSON.stringify(result), decided_by: session.user_id, decided_at: nowIso_() });
  r.status = 'CONFIRMED'; r.entity_id = entityId;
  return result;
}

/** Подтверждение выбранных строк: сначала ПФ, затем блюда; ошибка одной строки не останавливает остальные. */
function confirmTtkImportRows_(data, session) {
  return withLock_(function () {
    var ids = Array.isArray(data.rowIds) ? data.rowIds : [];
    if (!ids.length) throw new Error('Не выбраны строки.');
    if (ids.length > TTK_IMPORT_CONFIRM_MAX) throw new Error('Не более ' + TTK_IMPORT_CONFIRM_MAX + ' карт за один вызов (ограничение времени Apps Script).');
    var rows = ids.map(function (id) { var r = findOne_('TTK_IMPORT_ROWS', 'row_id', id); assertOwnedByOrg_(session, r, 'TTK_IMPORT_ROWS:' + id); return r; });
    var importId = rows[0].import_id;
    if (rows.some(function (r) { return r.import_id !== importId; })) throw new Error('Строки из разных импортов.');
    rows.sort(function (a, b) { return (a.kind === 'PF' ? 0 : 1) - (b.kind === 'PF' ? 0 : 1); });
    var cache = { idx: _tiOrgIndex_(session.organization_id) };
    var out = [];
    rows.forEach(function (r) {
      if (r.status !== 'PREVIEW') { out.push({ row_id: r.row_id, name: r.name, ok: false, error: 'Статус ' + r.status }); return; }
      var by = _tiRowsByNorm_(importId).by;
      try { out.push({ row_id: r.row_id, name: r.name, ok: true, result: _tiConfirmOne_(r, by, session, cache) }); }
      catch (e) { out.push({ row_id: r.row_id, name: r.name, ok: false, error: String(e.message || e) }); }
    });
    auditLog_(session.user_id, 'Импорт архива ТТК: подтверждение', 'TTK_IMPORT_BATCHES:' + importId, '', JSON.stringify(out.map(function (o) { return o.name + ':' + (o.ok ? 'ok' : o.error); })), 'success', session.cascade_id || '');
    return out;
  });
}

function migrateTtkImportSchema_() {
  var changed = [];
  ['TTK_IMPORT_BATCHES', 'TTK_IMPORT_ROWS'].forEach(function (key) {
    var sheet = getSheet_(key), expected = CONFIG.SCHEMA[key];
    var last = sheet.getLastColumn();
    var headers = last ? sheet.getRange(1, 1, 1, last).getValues()[0] : [];
    expected.forEach(function (h) { if (headers.indexOf(h) === -1) { sheet.getRange(1, headers.length + 1).setValue(h); headers.push(h); changed.push(key + '.' + h); } });
  });
  return { ok: true, changed: changed };
}
