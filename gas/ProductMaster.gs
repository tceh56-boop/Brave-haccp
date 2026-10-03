// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — ProductMaster.gs
 * Раунд 8 — ТЗ «Справочник продуктов + Декларации соответствия + Документы продукта» (P1).
 *
 * АРХИТЕКТУРНОЕ РЕШЕНИЕ (ТЗ §6, §48, флагую явно — единственная таблица в проекте без
 * organization_id): GLOBAL_PRODUCTS хранит общесправочные данные ОДНОГО продукта как
 * такового — пищевую ценность, условия хранения, аллергены, сроки годности, признаки
 * порчи. Это свойства ингредиента, а не организации: "Морковь" одинакова у организации А
 * и организации Б, и ТЗ §6 прямо разделяет GLOBAL PRODUCT/ORGANIZATION PRODUCT. Ни одно
 * поле в GLOBAL_PRODUCTS не является бизнес-данными предприятия (не цена, не поставщик,
 * не остаток) — поэтому шаринг между организациями здесь НЕ нарушает multi-tenant
 * изоляцию, которая во всём остальном проекте — P0-инвариант (ТЗ §44 "особый тест").
 * PRODUCTS (Products.gs, organization_id-scoped, как и раньше) — это ORGANIZATION PRODUCT,
 * ссылается на GLOBAL_PRODUCTS через global_product_id, но сам продукт по-прежнему можно
 * создать и БЕЗ глобальной привязки (createProduct_ в Products.gs не меняется и не
 * требует global_product_id — обратная совместимость с существующими организациями).
 *
 * Версионирование (ТЗ §31): любое изменение критического поля глобального продукта
 * записывается в PRODUCT_DATA_VERSIONS ДО применения — история не теряется никогда.
 */

var GLOBAL_PRODUCT_CRITICAL_FIELDS = [
  'calories_kcal_100g', 'protein_g_100g', 'fat_g_100g', 'carbohydrate_g_100g', 'fiber_g_100g', 'sugar_g_100g', 'nutrients_json',
  'storage_conditions_text', 'storage_temperature_min', 'storage_temperature_max'
];

/** ТЗ §5 — нормализация для поиска дублей: нижний регистр, схлопнутые пробелы, без пунктуации. НЕ объединяет автоматически. */
function normalizeProductName_(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _writeProductVersion_(entityType, entityId, field, oldValue, newValue, userId, source, reason) {
  if (oldValue === newValue) return;
  insertRow_('PRODUCT_DATA_VERSIONS', {
    version_id: generateId_('PRODUCT_DATA_VERSIONS'),
    entity_type: entityType,
    entity_id: entityId,
    field: field,
    old_value: (oldValue === undefined || oldValue === null) ? '' : String(oldValue),
    new_value: (newValue === undefined || newValue === null) ? '' : String(newValue),
    changed_by: userId || '',
    changed_at: nowIso_(),
    source: source || 'manual',
    reason: reason || ''
  });
}

/**
 * Число или '' — НИКОГДА NaN. Найдено при написании тестов раунда 8: импорт (ТЗ §27)
 * честно помечает нечисловое значение как WARNING на предпросмотре (ProductImport.gs),
 * но БЕЗ этой защиты сам коммит всё равно передавал бы сырую нечисловую строку в
 * Number(...) здесь и тихо писал бы NaN в справочник питательной ценности —
 * WARNING на предпросмотре не должен превращаться в порчу данных после коммита.
 */
function _numOrEmpty_(v) {
  if (v === undefined || v === null || v === '') return '';
  var n = Number(v);
  return isNaN(n) ? '' : n;
}

/**
 * ТЗ §4/§26 — создание глобального продукта. source/source_type/source_date/confidence
 * — обязательны к осмыслению вызывающим кодом (REFERENCE DATA vs VERIFIED BUSINESS DATA,
 * ТЗ §26), но не обязательны технически — если не передано, честно помечаем 'unknown'
 * вместо того чтобы придумать значение.
 */
function createGlobalProduct_(data, userId) {
  if (!data.name) throw new Error('Название продукта обязательно (createGlobalProduct_).');
  var product = {
    global_product_id: generateId_('GLOBAL_PRODUCTS'),
    name: data.name,
    normalized_name: normalizeProductName_(data.name),
    aliases_json: JSON.stringify(data.aliases || []),
    search_name: normalizeProductName_(data.name),
    external_codes_json: JSON.stringify(data.externalCodes || {}),
    category: data.category || '',
    product_type: data.productType || '',
    description: data.description || '',
    status: 'active',
    calories_kcal_100g: _numOrEmpty_(data.caloriesKcal100g),
    protein_g_100g: _numOrEmpty_(data.proteinG100g),
    fat_g_100g: _numOrEmpty_(data.fatG100g),
    carbohydrate_g_100g: _numOrEmpty_(data.carbohydrateG100g),
    fiber_g_100g: _numOrEmpty_(data.fiberG100g),
    sugar_g_100g: _numOrEmpty_(data.sugarG100g),
    nutrients_json: JSON.stringify(data.extraNutrients || {}),
    storage_conditions_text: data.storageConditionsText || '',
    storage_temperature_min: data.storageTemperatureMin === undefined ? '' : data.storageTemperatureMin,
    storage_temperature_max: data.storageTemperatureMax === undefined ? '' : data.storageTemperatureMax,
    storage_humidity: data.storageHumidity || '',
    storage_container: data.storageContainer || '',
    storage_location: data.storageLocation || '',
    light_requirement: data.lightRequirement || '',
    special_conditions: data.specialConditions || '',
    important_notes: data.importantNotes || '',
    source: data.source || 'unknown',
    source_type: data.sourceType || (data.source ? 'REFERENCE' : 'unknown'),
    source_date: data.sourceDate || nowIso_(),
    verified: data.verified ? 'да' : 'нет',
    verified_by: data.verifiedBy || '',
    confidence: data.confidence === undefined ? '' : data.confidence,
    created_at: nowIso_(),
    updated_at: nowIso_()
  };
  insertRow_('GLOBAL_PRODUCTS', product);
  return product;
}

function getGlobalProductById_(globalProductId) {
  return findOne_('GLOBAL_PRODUCTS', 'global_product_id', globalProductId);
}

function getGlobalProducts_(filters) {
  filters = filters || {};
  return findRows_('GLOBAL_PRODUCTS', function (r) {
    if (r.status === 'archived' && !filters.includeArchived) return false;
    if (filters.category && r.category !== filters.category) return false;
    if (filters.q) {
      var needle = normalizeProductName_(filters.q);
      var aliases = [];
      try { aliases = JSON.parse(r.aliases_json || '[]'); } catch (e) { aliases = []; }
      var haystack = r.normalized_name + ' ' + aliases.map(normalizeProductName_).join(' ');
      if (haystack.indexOf(needle) === -1) return false;
    }
    return true;
  });
}

/**
 * ТЗ §31 — критические поля версионируются, некритические (описание/заметки) — нет, чтобы
 * не раздувать историю бессмысленно.
 *
 * Внешний P0-аудит, п.3 (mass assignment, продолжение раунда 12) — у GLOBAL_PRODUCTS нет
 * organization_id (это осознанно ГЛОБАЛЬНЫЙ, общий для всех организаций справочник — не
 * межтенантная дыра), но `global_product_id` — валидное имя столбца схемы, и фильтр по
 * CONFIG.SCHEMA ниже его НЕ отсеивал: patch.global_product_id прошёл бы как обычное поле
 * и подменил бы значение первичного ключа В ТОЙ ЖЕ строке (updateRow_ пишет по номеру
 * строки, не по ID) — эта строка стала бы неотличима от другой по ID, ссылки на старый ID
 * повисли бы. Не межорганизационная утечка, но порча целостности данных — тот же класс
 * риска, что и остальные mass-assignment находки этого раунда. Закрыто.
 */
function updateGlobalProduct_(globalProductId, patch, userId, reason) {
  return withLock_(function () {
    var product = getGlobalProductById_(globalProductId);
    if (!product) throw new Error('Глобальный продукт не найден: ' + globalProductId);
    var applied = {};
    Object.keys(patch || {}).forEach(function (k) {
      if (k === 'global_product_id') return; // первичный ключ не меняется через patch
      if (CONFIG.SCHEMA.GLOBAL_PRODUCTS.indexOf(k) === -1) return; // защита от опечаток в имени поля
      if (GLOBAL_PRODUCT_CRITICAL_FIELDS.indexOf(k) !== -1) {
        _writeProductVersion_('GLOBAL_PRODUCTS', globalProductId, k, product[k], patch[k], userId, 'manual', reason);
      }
      applied[k] = patch[k];
    });
    applied.updated_at = nowIso_();
    if (patch.name) { applied.normalized_name = normalizeProductName_(patch.name); applied.search_name = applied.normalized_name; }
    updateRow_('GLOBAL_PRODUCTS', product, applied);
    auditLog_(userId, 'Изменён глобальный продукт', 'GLOBAL_PRODUCTS:' + globalProductId, null, Object.keys(applied).join(','), 'success', '');
    return getGlobalProductById_(globalProductId);
  });
}

/**
 * ТЗ §5 — поиск кандидатов на дубль. НЕ объединяет сам — только предлагает (см. ТЗ §5
 * DUPLICATE_CANDIDATE: "Объединить / Оставить отдельно / Создать новый продукт" —
 * решение принимает человек, здесь только список кандидатов).
 */
function findDuplicateCandidates_(name, excludeGlobalId) {
  var needle = normalizeProductName_(name);
  if (!needle) return [];
  return getGlobalProducts_({}).filter(function (p) {
    if (p.global_product_id === excludeGlobalId) return false;
    if (p.normalized_name === needle) return true;
    // частичное совпадение — подстрока в любую сторону (ищем "майтаке" в "гриб майтаке" и наоборот)
    return p.normalized_name.indexOf(needle) !== -1 || needle.indexOf(p.normalized_name) !== -1;
  }).map(function (p) {
    return { global_product_id: p.global_product_id, name: p.name, normalized_name: p.normalized_name, match: p.normalized_name === needle ? 'EXACT' : 'PARTIAL' };
  });
}

/** ТЗ §6 — привязка организационного продукта к глобальному (может быть сделана и позже, не только при создании). */
function linkProductToGlobal_(productId, globalProductId, userId, session) {
  return withLock_(function () {
    var product = getProductById_(productId);
    if (!product) throw new Error('Продукт не найден: ' + productId);
    if (session) assertOwnedByOrg_(session, product, 'PRODUCTS:' + productId);
    var global = getGlobalProductById_(globalProductId);
    if (!global) throw new Error('Глобальный продукт не найден: ' + globalProductId);
    var old = product.global_product_id;
    updateRow_('PRODUCTS', product, { global_product_id: globalProductId });
    auditLog_(userId, 'Продукт привязан к глобальному справочнику', 'PRODUCTS:' + productId, old, globalProductId, 'success', session ? session.cascade_id : '');
    return getProductById_(productId);
  });
}

/** ТЗ §32 — поиск по названию/синониму/артикулу/штрихкоду/поставщику среди ORGANIZATION-продуктов организации. */
function searchProducts_(organizationId, query) {
  var needle = normalizeProductName_(query);
  return findRows_('PRODUCTS', function (p) {
    if (p.organization_id !== organizationId || p.активность !== 'да') return false;
    if (!needle) return true;
    var fields = [p.название, p.внутреннее_название, p.артикул, p.штрихкод].filter(Boolean).map(normalizeProductName_);
    var global = p.global_product_id ? getGlobalProductById_(p.global_product_id) : null;
    if (global) {
      var aliases = [];
      try { aliases = JSON.parse(global.aliases_json || '[]'); } catch (e) { aliases = []; }
      fields = fields.concat([global.name].concat(aliases).map(normalizeProductName_));
    }
    return fields.some(function (f) { return f.indexOf(needle) !== -1; });
  });
}

/**
 * ТЗ §20/§33 — полная карточка продукта: организационные данные + глобальный
 * справочник + аллергены + сроки хранения + признаки порчи + статус деклараций.
 * Именно эта агрегация используется ТТК (ТЗ §20 "Если декларация продукта истекла —
 * показывать предупреждение") и карточкой продукта (ТЗ §33).
 */
function getProductCard_(productId, session) {
  var product = getProductById_(productId);
  if (!product) throw new Error('Продукт не найден: ' + productId);
  if (session) assertOwnedByOrg_(session, product, 'PRODUCTS:' + productId);
  var global = product.global_product_id ? getGlobalProductById_(product.global_product_id) : null;
  var allergens = global ? findRows_('PRODUCT_ALLERGENS', function (a) { return a.product_id === global.global_product_id && a.активен !== 'нет'; }) : [];
  var shelfLife = global ? findRows_('PRODUCT_SHELF_LIFE', function (s) { return s.product_id === global.global_product_id && s.активен !== 'нет'; }) : [];
  var spoilage = global ? findRows_('PRODUCT_SPOILAGE_SIGNS', function (s) { return s.product_id === global.global_product_id && s.активен !== 'нет'; }) : [];
  var declarations = getDeclarationsForProduct_(product.organization_id, productId);
  var complianceStatus = summarizeDeclarationStatuses_(declarations);
  return {
    product: product,
    global_product: global,
    аллергены: allergens,
    сроки_хранения: shelfLife,
    признаки_порчи: spoilage,
    декларации: declarations,
    статус_соответствия: complianceStatus
  };
}

/** ТЗ §22 — добавление (не перезапись) подтверждённого/заявленного аллергена. */
function setProductAllergen_(globalProductId, allergen, source, verified, notes, userId) {
  var global = getGlobalProductById_(globalProductId);
  if (!global) throw new Error('Глобальный продукт не найден: ' + globalProductId);
  var row = {
    allergen_id: generateId_('PRODUCT_ALLERGENS'),
    product_id: globalProductId,
    allergen: allergen,
    source: source || 'manual',
    verified: verified ? 'да' : 'нет',
    notes: notes || '',
    активен: 'да'
  };
  insertRow_('PRODUCT_ALLERGENS', row);
  _writeProductVersion_('GLOBAL_PRODUCTS', globalProductId, 'allergen:' + allergen, '', allergen, userId, source || 'manual', 'добавлен аллерген');
  return row;
}

function deactivateProductAllergen_(allergenId, userId) {
  var row = findOne_('PRODUCT_ALLERGENS', 'allergen_id', allergenId);
  if (!row) throw new Error('Запись аллергена не найдена: ' + allergenId);
  updateRow_('PRODUCT_ALLERGENS', row, { активен: 'нет' });
  _writeProductVersion_('GLOBAL_PRODUCTS', row.product_id, 'allergen:' + row.allergen, 'да', 'нет (деактивирован)', userId, 'manual', 'деактивирован аллерген');
  return { allergen_id: allergenId, активен: 'нет' };
}

/** ТЗ §24 — raw_text ВСЕГДА заполнен (источник истины), duration/duration_unit — лучшее возможное разбирание, может быть пустым. */
function setProductShelfLife_(globalProductId, storageMode, rawText, duration, durationUnit, source, verified, userId) {
  var global = getGlobalProductById_(globalProductId);
  if (!global) throw new Error('Глобальный продукт не найден: ' + globalProductId);
  if (['ROOM', 'REFRIGERATOR', 'FREEZER'].indexOf(storageMode) === -1) {
    throw new Error('Недопустимый режим хранения: "' + storageMode + '". Разрешено: ROOM, REFRIGERATOR, FREEZER.');
  }
  var row = {
    shelf_life_id: generateId_('PRODUCT_SHELF_LIFE'),
    product_id: globalProductId,
    storage_mode: storageMode,
    raw_text: rawText || '',
    duration: duration === undefined || duration === null ? '' : duration,
    duration_unit: durationUnit || '',
    temperature_min: '', temperature_max: '',
    source: source || 'manual',
    verified: verified ? 'да' : 'нет',
    notes: '',
    активен: 'да'
  };
  insertRow_('PRODUCT_SHELF_LIFE', row);
  return row;
}

/** ТЗ §25 — справочные признаки порчи, НЕ диагностика. category — best-effort классификация по ключевым словам, не гарантирована. */
var SPOILAGE_CATEGORY_KEYWORDS = {
  dark_spots: ['тёмные пятна', 'темные пятна', 'коричневые пятна', 'бурые пятна'],
  slime: ['слизь', 'ослизнение'],
  bad_smell: ['запах', 'зловон', 'прогорк'],
  color_change: ['изменение цвета', 'потемнение', 'пожелтение', 'посерение'],
  texture_change: ['размягчение', 'дряблость', 'вялость', 'сморщ'],
  mold: ['плесень', 'плесен']
};
function _guessSpoilageCategory_(text) {
  var lower = String(text || '').toLowerCase();
  var found = Object.keys(SPOILAGE_CATEGORY_KEYWORDS).filter(function (cat) {
    return SPOILAGE_CATEGORY_KEYWORDS[cat].some(function (kw) { return lower.indexOf(kw) !== -1; });
  });
  return found.length ? found[0] : '';
}
function setProductSpoilageSign_(globalProductId, signText, source, verified, userId) {
  var global = getGlobalProductById_(globalProductId);
  if (!global) throw new Error('Глобальный продукт не найден: ' + globalProductId);
  var row = {
    spoilage_id: generateId_('PRODUCT_SPOILAGE_SIGNS'),
    product_id: globalProductId,
    sign_text: signText,
    category: _guessSpoilageCategory_(signText), // best-effort, не авторитетно (ТЗ §25 — не автодиагностика)
    source: source || 'manual',
    verified: verified ? 'да' : 'нет',
    активен: 'да'
  };
  insertRow_('PRODUCT_SPOILAGE_SIGNS', row);
  return row;
}

function getProductVersions_(entityType, entityId) {
  return findRows_('PRODUCT_DATA_VERSIONS', function (v) { return v.entity_type === entityType && v.entity_id === entityId; })
    .sort(function (a, b) { return new Date(b.changed_at) - new Date(a.changed_at); });
}
