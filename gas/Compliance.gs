// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Compliance.gs
 * Раунд 8 — ТЗ §15/§16/§17/§19/§34. Контроль соответствия при приёмке, конфигурируемые
 * профили обязательных документов, регуляторные источники, дашборд комплаенса.
 *
 * ТЗ §46 — ВАЖНОЕ ЮРИДИЧЕСКОЕ ОГРАНИЧЕНИЕ: этот файл НИКОГДА не формулирует "продукт
 * соответствует законодательству РФ". Формулировки — только "документ загружен",
 * "документ проверен пользователем", "требуется проверка", "срок истёк/истекает".
 * Разрешённый режим при отсутствии действующей декларации — WARNING по умолчанию для
 * новой организации (явное решение Дениса, флаг ТЗ §19) — предупреждает, но не
 * останавливает работу; переключается на BLOCKING через SET_COMPLIANCE_BLOCK_MODE.
 */

var COMPLIANCE_BLOCK_MODES = ['WARNING', 'BLOCKING'];
var COMPLIANCE_DEFAULT_BLOCK_MODE = 'WARNING'; // ТЗ §19 — явное решение Дениса при постановке задачи
var COMPLIANCE_REQUIREMENT_TYPES = ['DECLARATION_REQUIRED', 'CERTIFICATE_REQUIRED', 'VET_DOCUMENT_REQUIRED', 'MARKING_REQUIRED', 'NO_DOCUMENT_REQUIRED', 'MANUAL_REVIEW'];

/** Универсальный upsert одной org-wide настройки (location_id пусто) — тот же SETTINGS, что уже используется _getLocationSetting_. */
function _setOrgSetting_(organizationId, key, value) {
  var existing = findRows_('SETTINGS', function (r) { return r.organization_id === organizationId && !r.location_id && r.ключ === key; })[0];
  if (existing) {
    updateRow_('SETTINGS', existing, { значение: value });
  } else {
    insertRow_('SETTINGS', { organization_id: organizationId, location_id: '', ключ: key, значение: value });
  }
}

function getComplianceBlockMode_(organizationId) {
  var v = _getLocationSetting_(null, 'compliance_block_mode', organizationId);
  return (v && COMPLIANCE_BLOCK_MODES.indexOf(v) !== -1) ? v : COMPLIANCE_DEFAULT_BLOCK_MODE;
}

function setComplianceBlockMode_(organizationId, mode, userId, session) {
  if (COMPLIANCE_BLOCK_MODES.indexOf(mode) === -1) {
    throw new Error('Недопустимый режим: "' + mode + '". Разрешено: ' + COMPLIANCE_BLOCK_MODES.join(', ') + '.');
  }
  _setOrgSetting_(organizationId, 'compliance_block_mode', mode);
  auditLog_(userId, 'Изменён режим блокировки комплаенса', 'ORG:' + organizationId, null, mode, 'success', session ? session.cascade_id : '');
  return { organization_id: organizationId, block_mode: mode };
}

/** ТЗ §16 — профиль обязательных документов. organizationId='' — применяется как дефолт для ЛЮБОЙ организации без своего профиля (не зашито в код, настраивается через эти же действия). */
function createComplianceProfile_(data, userId, session) {
  return withLock_(function () {
    if (!data.category && !data.productType) throw new Error('Профиль должен относиться хотя бы к категории или типу продукта.');
    var requirements = data.requirements || [];
    requirements.forEach(function (r) {
      if (COMPLIANCE_REQUIREMENT_TYPES.indexOf(r) === -1) throw new Error('Недопустимое требование: "' + r + '". Разрешено: ' + COMPLIANCE_REQUIREMENT_TYPES.join(', ') + '.');
    });
    var profile = {
      profile_id: generateId_('PRODUCT_COMPLIANCE_PROFILES'),
      organization_id: data.organizationId || '',
      category: data.category || '',
      product_type: data.productType || '',
      requirements_json: JSON.stringify(requirements),
      block_mode: data.blockMode && COMPLIANCE_BLOCK_MODES.indexOf(data.blockMode) !== -1 ? data.blockMode : '',
      created_at: nowIso_(), updated_at: nowIso_()
    };
    insertRow_('PRODUCT_COMPLIANCE_PROFILES', profile);
    auditLog_(userId, 'Создан профиль комплаенса', 'PRODUCT_COMPLIANCE_PROFILES:' + profile.profile_id, null, profile.category || profile.product_type, 'success', session ? session.cascade_id : '');
    return profile;
  });
}

function getComplianceProfiles_(organizationId) {
  return findRows_('PRODUCT_COMPLIANCE_PROFILES', function (r) { return r.organization_id === organizationId || r.organization_id === ''; });
}

function updateComplianceProfile_(profileId, patch, userId, session) {
  return withLock_(function () {
    var profile = findOne_('PRODUCT_COMPLIANCE_PROFILES', 'profile_id', profileId);
    if (!profile) throw new Error('Профиль не найден: ' + profileId);
    if (session && profile.organization_id) assertOwnedByOrg_(session, profile, 'PRODUCT_COMPLIANCE_PROFILES:' + profileId);
    var applied = { updated_at: nowIso_() };
    if (patch.requirements) applied.requirements_json = JSON.stringify(patch.requirements);
    if (patch.blockMode !== undefined) applied.block_mode = patch.blockMode;
    updateRow_('PRODUCT_COMPLIANCE_PROFILES', profile, applied);
    auditLog_(userId, 'Изменён профиль комплаенса', 'PRODUCT_COMPLIANCE_PROFILES:' + profileId, null, null, 'success', session ? session.cascade_id : '');
    return findOne_('PRODUCT_COMPLIANCE_PROFILES', 'profile_id', profileId);
  });
}

/** Профиль, применимый к конкретному продукту: свой органазации > глобальный дефолт > MANUAL_REVIEW (безопасный дефолт, не блокирует пустую конфигурацию — ТЗ §16). */
function resolveComplianceRequirements_(organizationId, category, productType) {
  var profiles = getComplianceProfiles_(organizationId);
  function findBy(orgScope) {
    return profiles.filter(function (p) { return p.organization_id === orgScope; })
      .filter(function (p) { return (p.category && p.category === category) || (p.product_type && p.product_type === productType); })
      .sort(function (a, b) { return (b.category === category ? 1 : 0) - (a.category === category ? 1 : 0); })[0];
  }
  var match = findBy(organizationId) || findBy('');
  if (!match) return { requirements: ['MANUAL_REVIEW'], block_mode: '', source: 'default' };
  var requirements = [];
  try { requirements = JSON.parse(match.requirements_json || '[]'); } catch (e) { requirements = ['MANUAL_REVIEW']; }
  return { requirements: requirements, block_mode: match.block_mode || '', source: match.profile_id };
}

function createRegulatorySource_(data, userId) {
  var source = {
    source_id: generateId_('REGULATORY_SOURCES'),
    name: data.name, type: data.type || '', url: data.url || '', version: data.version || '',
    effective_from: data.effectiveFrom || '', effective_to: data.effectiveTo || '',
    status: data.status || 'active', last_checked: '', notes: data.notes || ''
  };
  if (!source.name) throw new Error('Название регуляторного источника обязательно.');
  insertRow_('REGULATORY_SOURCES', source);
  auditLog_(userId, 'Добавлен регуляторный источник', 'REGULATORY_SOURCES:' + source.source_id, null, source.name, 'success', '');
  return source;
}

function getRegulatorySources_() {
  return findRows_('REGULATORY_SOURCES', function () { return true; });
}

function updateRegulatorySource_(sourceId, patch, userId) {
  return withLock_(function () {
    var source = findOne_('REGULATORY_SOURCES', 'source_id', sourceId);
    if (!source) throw new Error('Источник не найден: ' + sourceId);
    var applied = {};
    ['name', 'type', 'url', 'version', 'status', 'notes'].forEach(function (f) { if (patch[f] !== undefined) applied[f] = patch[f]; });
    if (patch.effectiveFrom !== undefined) applied.effective_from = patch.effectiveFrom;
    if (patch.effectiveTo !== undefined) applied.effective_to = patch.effectiveTo;
    if (patch.lastChecked) applied.last_checked = patch.lastChecked;
    updateRow_('REGULATORY_SOURCES', source, applied);
    auditLog_(userId, 'Изменён регуляторный источник', 'REGULATORY_SOURCES:' + sourceId, null, null, 'success', '');
    return findOne_('REGULATORY_SOURCES', 'source_id', sourceId);
  });
}

/**
 * ТЗ §15 — контроль при приёмке. Возвращает {уровень: GREEN|YELLOW|RED, причины:[...]}.
 * НЕ проверяет реальную юридическую силу документа (ТЗ §46) — только то, что видно в
 * самой системе: есть ли продукт/поставщик/декларация/её статус/срок.
 * Пункт 9 ТЗ ("нет ли критического расхождения между документом и товаром") ЧЕСТНО НЕ
 * реализован — в системе нет источника данных для автоматического сравнения текста
 * документа с фактическим товаром (это и есть то, для чего в будущем нужен бы был
 * реальный OCR + сверка, а не просто хранение файла), см. CHANGELOG.
 */
function checkReceiptCompliance_(organizationId, productId, supplierId, session) {
  var причины = [];
  var product = getProductById_(productId);
  if (!product) return { уровень: 'RED', причины: ['Продукт не найден в справочнике.'] };
  if (session) assertOwnedByOrg_(session, product, 'PRODUCTS:' + productId);

  if (!supplierId && !product.поставщик_id) причины.push('Поставщик не указан.');
  var supplier = supplierId || product.поставщик_id ? getSupplierById_(supplierId || product.поставщик_id) : null;
  if ((supplierId || product.поставщик_id) && !supplier) причины.push('Указанный поставщик не найден в справочнике.');

  var global = product.global_product_id ? getGlobalProductById_(product.global_product_id) : null;
  var hasShelfLife = (Number(product.срок_хранения_дней) > 0) || (global && findRows_('PRODUCT_SHELF_LIFE', function (s) { return s.product_id === global.global_product_id && s.активен !== 'нет'; }).length > 0);
  if (!hasShelfLife) причины.push('Срок годности для продукта не задан ни в карточке организации, ни в глобальном справочнике.');

  var req = resolveComplianceRequirements_(organizationId, product.категория_id, global ? global.product_type : '');
  var declarations = getDeclarationsForProduct_(organizationId, productId);
  var declStatus = summarizeDeclarationStatuses_(declarations);

  var needsDeclaration = req.requirements.indexOf('DECLARATION_REQUIRED') !== -1;
  var needsCertificate = req.requirements.indexOf('CERTIFICATE_REQUIRED') !== -1;
  var needsVet = req.requirements.indexOf('VET_DOCUMENT_REQUIRED') !== -1;
  var manualOnly = req.requirements.indexOf('MANUAL_REVIEW') !== -1 || req.requirements.indexOf('NO_DOCUMENT_REQUIRED') !== -1;

  var уровень = 'GREEN';
  if (needsDeclaration) {
    if (declStatus.уровень === 'RED' || declStatus.уровень === 'GREY') { причины.push('Требуется декларация соответствия (' + declStatus.причина + ')'); уровень = 'RED'; }
    else if (declStatus.уровень === 'YELLOW') { причины.push(declStatus.причина); уровень = maxComplianceLevel_(уровень, 'YELLOW'); }
    if (declStatus.требуется_проверка) { причины.push('Есть декларация, но она не проверена (verification_status = VERIFICATION_REQUIRED).'); уровень = maxComplianceLevel_(уровень, 'YELLOW'); }
  }
  if (needsCertificate) {
    var hasCert = getSupplierDocuments_(organizationId, { productId: productId, docType: 'CERTIFICATE' }).length > 0;
    if (!hasCert) { причины.push('Требуется сертификат, документ не найден.'); уровень = maxComplianceLevel_(уровень, 'YELLOW'); }
  }
  if (needsVet) {
    var hasVet = getSupplierDocuments_(organizationId, { productId: productId, docType: 'VETERINARY' }).length > 0;
    if (!hasVet) { причины.push('Требуется ветеринарный документ, документ не найден.'); уровень = maxComplianceLevel_(уровень, 'YELLOW'); }
  }
  if (manualOnly && !needsDeclaration && !needsCertificate && !needsVet) {
    причины.push('Для этой категории документы не настроены как обязательные (профиль: ' + (req.source === 'default' ? 'по умолчанию, требуется ручная проверка' : req.requirements.join(', ')) + ').');
  }
  if (причины.length === 0) причины.push('Проверка пройдена без замечаний.');

  var blockMode = req.block_mode || getComplianceBlockMode_(organizationId);
  return { уровень: уровень, причины: причины, режим_блокировки: blockMode, заблокировано: уровень === 'RED' && blockMode === 'BLOCKING' };
}
function maxComplianceLevel_(a, b) {
  var order = { GREEN: 0, YELLOW: 1, RED: 2, GREY: 1 };
  return order[b] > order[a] ? b : a;
}

/** ТЗ §34 — агрегированный дашборд комплаенса по организации. */
function getComplianceDashboard_(organizationId) {
  var products = getProducts_(organizationId);
  var withDocs = 0, withoutDocs = 0, underReview = 0, expiring30 = 0, expired = 0;
  products.forEach(function (p) {
    var decls = getDeclarationsForProduct_(organizationId, p.product_id);
    if (!decls.length) { withoutDocs++; return; }
    withDocs++;
    if (decls.some(function (d) { return d.verification_status === 'VERIFICATION_REQUIRED'; })) underReview++;
    if (decls.some(function (d) { return d.статус === 'EXPIRING'; })) expiring30++;
    if (decls.some(function (d) { return d.статус === 'EXPIRED'; }) && !decls.some(function (d) { return d.статус === 'ACTIVE'; })) expired++;
  });
  return {
    всего_продуктов: products.length,
    с_документами: withDocs,
    без_документов: withoutDocs,
    на_проверке: underReview,
    истекают_30_дней: expiring30,
    истекли: expired,
    режим_блокировки: getComplianceBlockMode_(organizationId)
  };
}
