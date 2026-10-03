// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Declarations.gs
 * Раунд 8 — ТЗ §7-§12, §18-§19. DECLARATION_OF_CONFORMITY как отдельная сущность
 * (НЕ текстовое поле в PRODUCTS, ТЗ §7).
 *
 * ТЗ §8 — часть статусов ВЫЧИСЛЯЕТСЯ по датам (ACTIVE/EXPIRING/EXPIRED), часть
 * УСТАНАВЛИВАЕТСЯ ВРУЧНУЮ человеком и не переписывается автоматом (DRAFT/SUSPENDED/
 * REVOKED/CANCELLED/UNDER_REVIEW/VERIFICATION_REQUIRED) — см. DECLARATION_MANUAL_STATUSES.
 * ЧЕСТНО (ТЗ §8/§46): "ACTIVE" здесь означает ТОЛЬКО "документ найден и его срок не
 * истёк по датам, которые внёс пользователь" — НЕ юридическое подтверждение
 * соответствия. Формулировки в интерфейсе должны следовать этому же принципу (см.
 * Index.html/CHANGELOG за явным списком разрешённых фраз, ТЗ §46).
 */

var DECLARATION_MANUAL_STATUSES = ['DRAFT', 'SUSPENDED', 'REVOKED', 'CANCELLED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED'];
var DECLARATION_DATE_STATUSES = ['ACTIVE', 'EXPIRING', 'EXPIRED'];
var DECLARATION_ALL_STATUSES = DECLARATION_MANUAL_STATUSES.concat(DECLARATION_DATE_STATUSES);
var DECLARATION_EXPIRING_WINDOW_DAYS = 30; // настраиваемо в будущем через SETTINGS, сейчас константа (ТЗ §18 упоминает пороги уведомлений отдельно от самого порога EXPIRING)
var DECLARATION_EXPIRY_THRESHOLDS_DAYS = [90, 60, 30, 14, 7, 0]; // ТЗ §18

/** Статус, вычисленный ПО ДАТАМ (не трогает ручные статусы) — используется и при создании, и при перечитывании. */
function _computeDeclarationDateStatus_(effectiveTo) {
  if (!effectiveTo) return 'ACTIVE'; // ТЗ не требует effective_to обязательным — бессрочная считается действующей
  var daysLeft = Math.floor((new Date(effectiveTo).getTime() - Date.now()) / 86400000);
  if (daysLeft < 0) return 'EXPIRED';
  if (daysLeft <= DECLARATION_EXPIRING_WINDOW_DAYS) return 'EXPIRING';
  return 'ACTIVE';
}

/** Применяется при чтении: если текущий статус — из "ручной" группы, не трогаем его; иначе пересчитываем по датам. */
function _refreshDeclarationStatus_(row) {
  if (DECLARATION_MANUAL_STATUSES.indexOf(row.статус) !== -1) return row;
  var computed = _computeDeclarationDateStatus_(row.effective_to);
  if (computed !== row.статус) {
    updateRow_('DECLARATIONS', row, { статус: computed, updated_at: nowIso_() });
    row.статус = computed;
  }
  return row;
}

function createDeclaration_(data, userId, session) {
  return withLock_(function () {
    if (!data.organizationId) throw new Error('createDeclaration_: organizationId обязателен.');
    if (!data.registrationNumber) throw new Error('Регистрационный номер декларации обязателен.');
    if (data.productId && session) {
      assertOwnedByOrg_(session, getProductById_(data.productId), 'PRODUCTS:' + data.productId);
    }
    if (data.supplierId && session) {
      assertOwnedByOrg_(session, getSupplierById_(data.supplierId), 'SUPPLIERS:' + data.supplierId);
    }
    var decl = {
      declaration_id: generateId_('DECLARATIONS'),
      organization_id: data.organizationId,
      product_id: data.productId || '',
      supplier_id: data.supplierId || '',
      registration_number: data.registrationNumber,
      document_type: data.documentType || 'DECLARATION',
      статус: data.status || _computeDeclarationDateStatus_(data.effectiveTo),
      issue_date: data.issueDate || '',
      effective_from: data.effectiveFrom || '',
      effective_to: data.effectiveTo || '',
      applicant: data.applicant || '',
      manufacturer: data.manufacturer || '',
      manufacturer_country: data.manufacturerCountry || '',
      product_name: data.productName || '',
      product_group: data.productGroup || '',
      technical_regulation: data.technicalRegulation || '',
      conformity_scheme: data.conformityScheme || '',
      certification_body: data.certificationBody || '',
      registration_authority: data.registrationAuthority || '',
      document_url: data.documentUrl || '',
      file_id: data.fileId || '',
      document_hash: data.documentHash || '',
      verification_status: 'VERIFICATION_REQUIRED', // ТЗ §9/§46 — никогда не ACTIVE-юридически только от загрузки файла
      verification_source: '', verification_url: '', verification_date: '', verification_method: '', verification_result: '',
      created_at: nowIso_(), updated_at: nowIso_(), verified_at: '', verified_by: ''
    };
    insertRow_('DECLARATIONS', decl);
    auditLog_(userId, 'Добавлена декларация соответствия', 'DECLARATIONS:' + decl.declaration_id, null, decl.registration_number, 'success', session ? session.cascade_id : '');
    return decl;
  });
}

/**
 * P0.1, НАЙДЕНО ПРИ НАПИСАНИИ ТЕСТОВ РАУНДА 8: до этой правки GET_DECLARATION
 * (API.gs) вызывал эту функцию БЕЗ session — любая организация, зная (или
 * перебрав) чужой declarationId, могла прочитать декларацию другой организации
 * (номер, производителя, статус проверки и т.д.) в обход multi-tenant изоляции.
 * session теперь необязателен (внутренние вызовы без него — например, из
 * updateDeclaration_/setDeclarationStatus_/verifyDeclaration_ — уже проверили
 * владение декларацией САМИ до вызова), но API.gs::GET_DECLARATION обязан его
 * передавать.
 */
function getDeclarationById_(declarationId, session) {
  var row = findOne_('DECLARATIONS', 'declaration_id', declarationId);
  if (!row) return null;
  if (session) assertOwnedByOrg_(session, row, 'DECLARATIONS:' + declarationId);
  return _refreshDeclarationStatus_(row);
}

function getDeclarations_(organizationId, filters) {
  filters = filters || {};
  return findRows_('DECLARATIONS', function (r) {
    if (r.organization_id !== organizationId) return false;
    if (filters.status && r.статус !== filters.status) return false;
    if (filters.productId && r.product_id !== filters.productId) return false;
    if (filters.supplierId && r.supplier_id !== filters.supplierId) return false;
    return true;
  }).map(_refreshDeclarationStatus_);
}

/** Все декларации продукта — прямые (DECLARATIONS.product_id) и через DECLARATION_PRODUCTS (группы/варианты, ТЗ §12). */
function getDeclarationsForProduct_(organizationId, productId) {
  var direct = getDeclarations_(organizationId, { productId: productId });
  var linkedIds = findRows_('DECLARATION_PRODUCTS', function (l) { return l.product_id === productId && l.relation_type !== 'REMOVED'; })
    .map(function (l) { return l.declaration_id; });
  // ВАЖНО: НЕ linkedIds.map(getDeclarationById_) — Array.map передаёт (элемент, индекс,
  // массив), и индекс попал бы в getDeclarationById_ вторым аргументом (session) —
  // assertOwnedByOrg_ получил бы "session" без .organization_id и ложно отклонял бы
  // FORBIDDEN_SCOPE каждую связанную декларацию начиная со второй (индекс 1, 2, …).
  var linked = linkedIds.map(function (id) { return getDeclarationById_(id); }).filter(function (d) { return d && d.organization_id === organizationId; });
  var seen = {};
  return direct.concat(linked).filter(function (d) {
    if (seen[d.declaration_id]) return false;
    seen[d.declaration_id] = true;
    return true;
  });
}

/** ТЗ §15/§34 — агрегированный статус набора деклараций продукта для приёмки/карточки/дашборда. */
function summarizeDeclarationStatuses_(declarations) {
  if (!declarations || !declarations.length) {
    return { уровень: 'GREY', причина: 'Документы по продукту не найдены в системе.' };
  }
  var active = declarations.filter(function (d) { return d.статус === 'ACTIVE'; });
  var expiring = declarations.filter(function (d) { return d.статус === 'EXPIRING'; });
  var expired = declarations.filter(function (d) { return d.статус === 'EXPIRED'; });
  var unverified = declarations.filter(function (d) { return d.verification_status === 'VERIFICATION_REQUIRED'; });
  if (active.length && !expired.length) {
    return { уровень: expiring.length ? 'YELLOW' : 'GREEN', причина: expiring.length ? 'Есть действующая декларация, но срок истекает.' : 'Есть действующая декларация.', требуется_проверка: unverified.length > 0 };
  }
  if (expired.length && !active.length) {
    return { уровень: 'RED', причина: 'Действующей декларации нет — найденные истекли.' };
  }
  return { уровень: expiring.length ? 'YELLOW' : 'GREY', причина: 'Смешанный статус документов — проверьте вручную.', требуется_проверка: unverified.length > 0 };
}

function updateDeclaration_(declarationId, patch, userId, session) {
  return withLock_(function () {
    var decl = findOne_('DECLARATIONS', 'declaration_id', declarationId);
    if (!decl) throw new Error('Декларация не найдена: ' + declarationId);
    if (session) assertOwnedByOrg_(session, decl, 'DECLARATIONS:' + declarationId);
    var applied = { updated_at: nowIso_() };
    ['registration_number', 'document_type', 'issue_date', 'effective_from', 'effective_to', 'applicant', 'manufacturer',
      'manufacturer_country', 'product_name', 'product_group', 'technical_regulation', 'conformity_scheme',
      'certification_body', 'registration_authority', 'document_url'].forEach(function (f) {
      var camel = f.replace(/_([a-z])/g, function (_, c) { return c.toUpperCase(); });
      if (patch[camel] !== undefined) applied[f] = patch[camel];
    });
    // Правки дат — критично для версионирования (ТЗ §31: изменение срока хранения/
    // условий фиксируется историей; для деклараций аналог — срок действия).
    if (applied.effective_to !== undefined && applied.effective_to !== decl.effective_to) {
      _writeProductVersion_('DECLARATIONS', declarationId, 'effective_to', decl.effective_to, applied.effective_to, userId, 'manual', 'ручное изменение срока действия');
    }
    updateRow_('DECLARATIONS', decl, applied);
    auditLog_(userId, 'Изменена декларация', 'DECLARATIONS:' + declarationId, null, Object.keys(applied).join(','), 'success', session ? session.cascade_id : '');
    return getDeclarationById_(declarationId);
  });
}

/** ТЗ §8 — ручная установка одного из "ручных" статусов, либо 'AUTO' — вернуть под автоматический пересчёт по датам. */
function setDeclarationStatus_(declarationId, newStatus, userId, session) {
  return withLock_(function () {
    var decl = findOne_('DECLARATIONS', 'declaration_id', declarationId);
    if (!decl) throw new Error('Декларация не найдена: ' + declarationId);
    if (session) assertOwnedByOrg_(session, decl, 'DECLARATIONS:' + declarationId);
    var resolved = newStatus === 'AUTO' ? _computeDeclarationDateStatus_(decl.effective_to) : newStatus;
    if (newStatus !== 'AUTO' && DECLARATION_ALL_STATUSES.indexOf(newStatus) === -1) {
      throw new Error('Недопустимый статус декларации: "' + newStatus + '". Разрешено: ' + DECLARATION_ALL_STATUSES.join(', ') + ', AUTO.');
    }
    var old = decl.статус;
    updateRow_('DECLARATIONS', decl, { статус: resolved, updated_at: nowIso_() });
    auditLog_(userId, 'Изменён статус декларации', 'DECLARATIONS:' + declarationId, old, resolved, 'success', session ? session.cascade_id : '');
    return getDeclarationById_(declarationId);
  });
}

/**
 * ТЗ §9 — проверка документа. ВАЖНО (§9/§46): вызов этой функции НЕ проверяет ничего
 * реально сам (нет подключения к официальному реестру ФСА/ФГИС в этом раунде,
 * см. CHANGELOG за честным списком "не реализовано") — она лишь ЗАПИСЫВАЕТ, что
 * человек (или в будущем — реальный API) проверил документ, и КАК именно.
 * verificationSource должен быть одним из перечисленных в ТЗ §9.
 */
var DECLARATION_VERIFICATION_SOURCES = ['MANUAL', 'OFFICIAL_REGISTER', 'API', 'DOCUMENT_SCAN', 'SUPPLIER', 'ADMIN_VERIFIED'];
function verifyDeclaration_(declarationId, verification, userId, session) {
  return withLock_(function () {
    var decl = findOne_('DECLARATIONS', 'declaration_id', declarationId);
    if (!decl) throw new Error('Декларация не найдена: ' + declarationId);
    if (session) assertOwnedByOrg_(session, decl, 'DECLARATIONS:' + declarationId);
    if (DECLARATION_VERIFICATION_SOURCES.indexOf(verification.source) === -1) {
      throw new Error('Недопустимый источник проверки: "' + verification.source + '". Разрешено: ' + DECLARATION_VERIFICATION_SOURCES.join(', ') + '.');
    }
    var applied = {
      verification_status: verification.result === false ? 'REJECTED' : 'VERIFIED',
      verification_source: verification.source,
      verification_url: verification.url || '',
      verification_date: nowIso_(),
      verification_method: verification.method || '',
      verification_result: verification.result === false ? 'не подтверждён' : (verification.resultText || 'подтверждён'),
      verified_at: nowIso_(),
      verified_by: userId || '',
      updated_at: nowIso_()
    };
    updateRow_('DECLARATIONS', decl, applied);
    auditLog_(userId, 'Проверка декларации', 'DECLARATIONS:' + declarationId, decl.verification_status, applied.verification_status, 'success', session ? session.cascade_id : '');
    return getDeclarationById_(declarationId);
  });
}

/** ТЗ §12 — связь декларации с группой/несколькими SKU. relationType: DIRECT/GROUP/VARIANT. */
function linkDeclarationProduct_(declarationId, productId, relationType, userId, session) {
  return withLock_(function () {
    var decl = findOne_('DECLARATIONS', 'declaration_id', declarationId);
    if (!decl) throw new Error('Декларация не найдена: ' + declarationId);
    if (session) assertOwnedByOrg_(session, decl, 'DECLARATIONS:' + declarationId);
    var product = getProductById_(productId);
    if (!product) throw new Error('Продукт не найден: ' + productId);
    if (session) assertOwnedByOrg_(session, product, 'PRODUCTS:' + productId);
    if (['DIRECT', 'GROUP', 'VARIANT'].indexOf(relationType) === -1) {
      throw new Error('Недопустимый relation_type: "' + relationType + '". Разрешено: DIRECT, GROUP, VARIANT.');
    }
    var link = { link_id: generateId_('DECLARATION_PRODUCTS'), declaration_id: declarationId, product_id: productId, relation_type: relationType };
    insertRow_('DECLARATION_PRODUCTS', link);
    auditLog_(userId, 'Декларация связана с продуктом', 'DECLARATION_PRODUCTS:' + link.link_id, null, declarationId + '->' + productId, 'success', session ? session.cascade_id : '');
    return link;
  });
}

function unlinkDeclarationProduct_(linkId, userId, session) {
  return withLock_(function () {
    var link = findOne_('DECLARATION_PRODUCTS', 'link_id', linkId);
    if (!link) throw new Error('Связь не найдена: ' + linkId);
    if (session) {
      var decl = findOne_('DECLARATIONS', 'declaration_id', link.declaration_id);
      assertOwnedByOrg_(session, decl, 'DECLARATIONS:' + link.declaration_id);
    }
    updateRow_('DECLARATION_PRODUCTS', link, { relation_type: 'REMOVED' });
    auditLog_(userId, 'Связь декларации с продуктом удалена', 'DECLARATION_PRODUCTS:' + linkId, null, null, 'success', session ? session.cascade_id : '');
    return { link_id: linkId, relation_type: 'REMOVED' };
  });
}

/**
 * ТЗ §18 — многоступенчатые уведомления об истечении. Запускается ежедневным
 * триггером (declarationExpiryTrigger_, Main.gs). idempotencyKey включает дату — одно
 * уведомление на порог в день, не спамит каждый час.
 */
function checkDeclarationExpiries_() {
  var all = findRows_('DECLARATIONS', function (r) { return !!r.effective_to && DECLARATION_MANUAL_STATUSES.indexOf(r.статус) === -1; });
  var today = todayDateStr_();
  all.forEach(function (d) {
    var daysLeft = Math.floor((new Date(d.effective_to).getTime() - Date.now()) / 86400000);
    var typeKey = null;
    if (DECLARATION_EXPIRY_THRESHOLDS_DAYS.indexOf(daysLeft) !== -1) {
      typeKey = 'DECLARATION_EXPIRING_' + (daysLeft === 0 ? 'TODAY' : daysLeft);
    } else if (daysLeft < 0 && daysLeft % 7 === 0) {
      // после истечения — напоминаем раз в неделю, а не каждый день (ТЗ §18 "после окончания", без указания частоты)
      typeKey = 'DECLARATION_EXPIRED';
    }
    if (!typeKey || !CONFIG.NOTIFICATION_TYPES[typeKey]) return;
    var msg = 'Декларация №' + d.registration_number + ' (' + (d.product_name || d.product_id) + ') ' +
      (daysLeft >= 0 ? 'истекает через ' + daysLeft + ' дн.' : 'истекла ' + Math.abs(daysLeft) + ' дн. назад.');
    notify_(d.organization_id, '', CONFIG.NOTIFICATION_TYPES[typeKey], msg, 'declaration_expiry|' + d.declaration_id + '|' + daysLeft + '|' + today);
  });
}
