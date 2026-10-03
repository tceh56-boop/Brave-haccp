// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Suppliers.gs
 * Раунд 8. АУДИТ ПЕРЕД КОДОМ нашёл: таблица SUPPLIERS существовала в CONFIG.SCHEMA/
 * ID_PREFIXES с самого начала проекта (продукт уже ссылается на неё через
 * PRODUCTS.поставщик_id), но НИ ОДНОЙ функции CRUD для неё не было нигде в проекте —
 * поле повсюду висело как нефункционирующая ссылка. ТЗ §13/§36/§37 требуют реальную
 * связь поставщик→продукт→документы, поэтому этот файл сначала закрывает существующий
 * пробел (это не новая фича “сверх ТЗ” — это то, без чего §13 в принципе невозможен),
 * а не создаёт параллельную сущность.
 */

function createSupplier_(data, userId, session) {
  if (!data.organizationId) throw new Error('createSupplier_: organizationId обязателен.');
  if (!data.название) throw new Error('Название поставщика обязательно.');
  var supplier = {
    supplier_id: generateId_('SUPPLIERS'),
    organization_id: data.organizationId,
    название: data.название,
    контакты: data.контакты || ''
  };
  insertRow_('SUPPLIERS', supplier);
  var loc=(findRows_('LOCATIONS',function(l){return l.organization_id===supplier.organization_id;})[0]||{}).location_id;
  detectAndRequestPpkReview_(supplier.organization_id,loc,'SUPPLIER_CHANGED','SUPPLIERS',supplier.supplier_id,userId,session,'Изменен/добавлен поставщик.');
  auditLog_(userId, 'Создан поставщик', 'SUPPLIERS:' + supplier.supplier_id, null, data.название, 'success', session ? session.cascade_id : '');
  return supplier;
}

function getSuppliers_(organizationId) {
  return findRows_('SUPPLIERS', function (r) { return r.organization_id === organizationId; });
}

function getSupplierById_(supplierId) {
  return findOne_('SUPPLIERS', 'supplier_id', supplierId);
}

function updateSupplier_(supplierId, patch, userId, session) {
  return withLock_(function () {
    var supplier = getSupplierById_(supplierId);
    if (!supplier) throw new Error('Поставщик не найден: ' + supplierId);
    if (session) assertOwnedByOrg_(session, supplier, 'SUPPLIERS:' + supplierId); // ТЗ P0.1
    var applied = {};
    if (patch.название) applied.название = patch.название;
    if (patch.контакты !== undefined) applied.контакты = patch.контакты;
    updateRow_('SUPPLIERS', supplier, applied);
    auditLog_(userId, 'Изменён поставщик', 'SUPPLIERS:' + supplierId, null, JSON.stringify(applied), 'success', session ? session.cascade_id : '');
    return getSupplierById_(supplierId);
  });
}
