// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Products.gs
 * Справочник продуктов. Изменение цены здесь запускает каскад пересчёта (ТЗ §32) —
 * сама функция изменения цены не считает себестоимость сама, а делегирует в FoodCost.gs,
 * чтобы правило "один источник расчёта" не размывалось по модулям.
 */

function createProduct_(data) {
  if (!data.organization_id) throw new Error('createProduct_: organization_id обязателен.');
  var barcode = (data.штрихкод || '').toString().trim();
  if (barcode && findOne_('PRODUCTS', 'штрихкод', barcode)) {
    throw new Error('Штрихкод ' + barcode + ' уже присвоен другому продукту.');
  }
  var product = {
    product_id: generateId_('PRODUCTS'),
    organization_id: data.organization_id,
    название: data.название || '',
    категория_id: data.категория_id || '',
    единица: data.единица || 'кг',
    закупочная_цена: Number(data.закупочная_цена) || 0,
    текущая_цена: Number(data.закупочная_цена) || 0,
    поставщик_id: data.поставщик_id || '',
    срок_хранения_дней: Number(data.срок_хранения_дней) || 0,
    мин_остаток: Number(data.мин_остаток) || 0,
    активность: 'да',
    создано: nowIso_(),
    обновлено: nowIso_(),
    штрихкод: barcode,
    global_product_id: data.global_product_id || '',
    артикул: data.артикул || '',
    внутреннее_название: data.внутреннее_название || ''
  };
  insertRow_('PRODUCTS', product);
  recordPriceHistory_({organization_id: product.organization_id, product_id: product.product_id, price_type:'PURCHASE', old_price:0, new_price:product.текущая_цена, source:'PRODUCT_CREATE', supplier_id:product.поставщик_id, user_id:data.userId || '', reason:'Начальная цена продукта'});
  detectAndRequestPpkReview_(product.organization_id, null, 'PRODUCT_ADDED', 'PRODUCTS', product.product_id, data.userId || '', null, 'Добавлена новая номенклатура.');
  return product;
}

function getProducts_(organizationId) {
  return findRows_('PRODUCTS', function (r) {
    return (!organizationId || r.organization_id === organizationId) && r.активность === 'да';
  });
}

function getProductById_(productId) {
  return findOne_('PRODUCTS', 'product_id', productId);
}

/**
 * Поиск продукта по штрихкоду — используется приходом со сканером (камера/фото/
 * USB-сканер-«эмулятор клавиатуры», см. demo.html и ТТК-паттерн Mon Cher). Сканер
 * только НАХОДИТ существующую карточку продукта — количество и цену человек
 * подтверждает сам, штрихкод никогда не создаёт новый продукт молча.
 */
function findProductByBarcode_(organizationId, barcode) {
  var code = (barcode || '').toString().trim();
  if (!code) return null;
  return findRows_('PRODUCTS', function (r) {
    return r.штрихкод === code && r.активность === 'да' && (!organizationId || r.organization_id === organizationId);
  })[0] || null;
}

/**
 * ТЗ §32 — "Пользователь меняет закупочную цену продукта. Система сама пересчитывает всё."
 * Это единственная точка входа для смены цены — вызывать только её, не updateRow_ напрямую.
 *
 * P0.2 — НАЙДЕНА И ИСПРАВЛЕНА ОШИБКА КЛАССА P0.1 (пропущена в предыдущем раунде):
 * productId приходит от клиента (UPDATE_PRODUCT_PRICE в API.gs), но до этого исправления
 * функция не проверяла, что продукт принадлежит организации вызывающего — организация А
 * могла прислать productId организации Б и изменить ЕЙ цену продукта (а значит и
 * себестоимость всех её блюд через каскад). Это ровно тот же класс уязвимости
 * "подмена ID" из ТЗ §1/§21/§22, который закрывался в прошлом раунде — эта конкретная
 * функция была пропущена тогда и найдена только сейчас при аудите перед P0.2.
 */
function updateProductPrice_(productId, newPrice, userId, session) {
  return withLock_(function () {
    var product = getProductById_(productId);
    if (!product) throw new Error('Продукт не найден: ' + productId);
    if (session) assertOwnedByOrg_(session, product, 'PRODUCTS:' + productId); // ТЗ P0.1 (найдено и закрыто в P0.2)
    var oldPrice = product.текущая_цена;
  var normalizedPrice = _assertNonNegativePrice_(newPrice, 'Цена продукта');
    if (Number(normalizedPrice) === Number(oldPrice)) {
      return { changed: false, product: product }; // нет реального изменения — не гоняем каскад впустую (ТЗ §20)
    }

    updateRow_('PRODUCTS', product, { текущая_цена: normalizedPrice, обновлено: nowIso_() });
    recordPriceHistory_({organization_id: product.organization_id, product_id: productId, price_type:'CURRENT', old_price:oldPrice, new_price:normalizedPrice, source:'MANUAL', supplier_id:product.поставщик_id, user_id:userId, cascade_id:session ? session.cascade_id : '', reason:'Ручное изменение цены'});
    auditLog_(userId, 'Изменение цены продукта', 'PRODUCTS:' + productId, oldPrice, normalizedPrice, 'success', session ? session.cascade_id : '');

    var cascade = recalcFoodCostForProduct_(productId);
    recalcEconomics_(product.organization_id, null, session ? session.cascade_id : ''); // P0.7 — organization_id теперь обязателен (см. Economics.gs), цена продукта по-прежнему не привязана к одной точке

    return { changed: true, product_id: productId, старая_цена: oldPrice, новая_цена: normalizedPrice, пересчитано: cascade };
  });
}
