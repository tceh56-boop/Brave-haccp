// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Sales.gs
 * Раунд 11 — модель продаж/заказов (ТЗ по прямому запросу Дениса: в финальном отчёте
 * раунда 10 было честно указано "Настоящий P&L / анализ по продажам структурно
 * невозможен без модели заказов" — Денис ответил "Настрой это все", а на уточняющий
 * вопрос "как заводить данные о продажах — вручную / CSV-импорт из кассы / прямая
 * интеграция с API кассы?" явно ответил "Реализуй все три направления". Этот файл —
 * фундамент для всех трёх: ручной ввод (createSale_ напрямую), CSV-импорт (preview→
 * resolve→commit ниже), и приёмник для API-синхронизации кассы (Integrations.gs::
 * syncIikoSales_ вызывает createSale_ этого файла напрямую — тот же принцип, что и
 * везде в проекте: `_`-функция — общая точка входа для ручного ввода и для интеграций,
 * оба пути проходят ОДНУ и ту же валидацию/каскад, не два разных).
 *
 * СНИМОК СЕБЕСТОИМОСТИ (SALES.себестоимость_на_момент): копируется из
 * DISHES.себестоимость В МОМЕНТ продажи, не пересчитывается позже. Это осознанное
 * архитектурное решение: если рецепт блюда изменится через месяц (другой поставщик,
 * другая цена продукта), уже закрытый P&L за прошлый период не должен задним числом
 * "поплыть" — тот же принцип "не переписывать историю", что и в WRITE_OFFS/AUDIT_LOG
 * по всему проекту.
 *
 * ВНЕШНИЙ_ID: для идемпотентной синхронизации с кассой — повторный SYNC_IIKO_SALES за
 * тот же период не плодит дубли продаж, а обновляет существующую строку (см.
 * upsertSaleFromExternal_ ниже, используется только интеграциями, не ручным вводом/CSV).
 *
 * ГРАНИЦА ИМПОРТА CSV, ЧЕСТНО (тот же принцип, что и в ProductImport.gs): парсинг
 * самого CSV-файла — на фронтенде (переиспользуется существующая parseCsv() из
 * Index.html), сюда приходит уже разобранный JSON-массив строк с оригинальными
 * заголовками колонок источника.
 *
 * У продаж, В ОТЛИЧИЕ от импорта продуктов, НЕТ понятия "дубль": одно и то же блюдо,
 * проданное дважды в один день, — это ДВЕ РАЗНЫЕ законные продажи, не повторный ввод
 * одного и того же объекта. Поэтому статусной ветки DUPLICATE здесь нет вообще —
 * вместо неё REVIEW_REQUIRED используется для строк, где название блюда в файле не
 * нашло точного совпадения в справочнике блюд организации (нужно решение человека:
 * выбрать существующее блюдо вручную или пропустить строку).
 */

/**
 * Дополнено по запросу Дениса ("реализуй то, что не реализовал" — из честного списка
 * раунда 11: "CSV-импорт продаж сопоставляет блюдо только по точному названию, без
 * нечёткого/частичного совпадения"). Тот же принцип частичного совпадения (подстрока в
 * любую сторону), что и ProductMaster.gs::findDuplicateCandidates_ для продуктов — НЕ
 * автоматически применяется (человек всё равно должен подтвердить через
 * RESOLVE_SALES_IMPORT_ROW), только ПОДСКАЗЫВАЕТСЯ как кандидат в getSalesImportRows_
 * ниже, вычисляется на лету при чтении (не персистится в саму строку импорта — схема
 * SALES_IMPORT_ROWS не менялась).
 */
function findDishCandidates_(organizationId, name) {
  var needle = normalizeProductName_(name);
  if (!needle) return [];
  return getDishes_(organizationId).filter(function (d) {
    if (d.статус === 'архив') return false;
    var normalized = normalizeProductName_(d.название);
    return normalized.indexOf(needle) !== -1 || needle.indexOf(normalized) !== -1;
  }).map(function (d) { return { dish_id: d.dish_id, название: d.название }; });
}

/** ТЗ P0.1 + бизнес-валидация. qty/цена — Number, сумма считается здесь же (не доверяем клиентскому "сумма"). */
function createSale_(data, userId, session) {
  return withLock_(function () {
    var dish = findOne_('DISHES', 'dish_id', data.dishId);
    if (session) assertOwnedByOrg_(session, dish, 'DISHES:' + data.dishId);
    else if (!dish) throw new Error('Блюдо не найдено: ' + data.dishId);

    var qty = Number(data.qty);
    if (!qty || qty <= 0) throw new Error('Количество должно быть положительным числом.');
    var price = data.цена_продажи !== undefined && data.цена_продажи !== null && data.цена_продажи !== ''
      ? Number(data.цена_продажи)
      : Number(dish.цена_продажи) || 0;
    if (isNaN(price) || price < 0) throw new Error('Некорректная цена продажи.');

    var organizationId = (session && session.organization_id) || dish.organization_id;
    var locationId = data.locationId || (session && session.location_id) || '';

    var sale = {
      sale_id: generateId_('SALES'),
      organization_id: organizationId,
      location_id: locationId,
      dish_id: dish.dish_id,
      qty: qty,
      цена_продажи: round2_(price),
      сумма: round2_(price * qty),
      себестоимость_на_момент: round2_((Number(dish.себестоимость) || 0) * qty),
      источник: data.источник || 'ручной_ввод',
      внешний_id: data.внешний_id || '',
      дата: data.дата || nowIso_().slice(0, 10),
      user_id: userId || '',
      создано: nowIso_(),
      cascade_id: session ? (session.cascade_id || '') : ''
    };
    insertRow_('SALES', sale);
    auditLog_(userId, 'Создана продажа', 'SALES:' + sale.sale_id, null, dish.название + ' x' + qty, 'success', session ? session.cascade_id : '');
    return sale;
  });
}

/**
 * Используется ТОЛЬКО интеграциями (Integrations.gs::syncIikoSales_) — ручной ввод и
 * CSV-импорт всегда создают новую строку через createSale_ напрямую, у них нет
 * понятия "тот же внешний заказ пришёл повторно". Здесь — есть: повторный синк того
 * же периода из кассы обновляет уже существующую по внешний_id строку вместо
 * дублирования (idempotent, ТЗ архитектурного документа "повторный пул не плодит
 * дубли").
 */
function upsertSaleFromExternal_(data, userId, session) {
  return withLock_(function () {
    if (!data.внешний_id) throw new Error('upsertSaleFromExternal_: внешний_id обязателен для идемпотентного синка.');
    var existing = findOne_('SALES', 'внешний_id', data.внешний_id);
    if (existing && session && existing.organization_id !== session.organization_id) {
      // Чужой внешний_id с тем же значением у другой организации — не должно происходить
      // (внешние id кассы у разных организаций/кассовых аккаунтов не пересекаются на
      // практике), но на всякий случай не перезаписываем чужую продажу — создаём новую.
      existing = null;
    }
    if (existing) {
      var dish = findOne_('DISHES', 'dish_id', data.dishId);
      if (session) assertOwnedByOrg_(session, dish, 'DISHES:' + data.dishId);
      var qty = Number(data.qty) || 0;
      var price = Number(data.цена_продажи) || 0;
      var patch = {
        qty: qty, цена_продажи: round2_(price), сумма: round2_(price * qty),
        себестоимость_на_момент: round2_((Number(dish.себестоимость) || 0) * qty),
        дата: data.дата || existing.дата
      };
      updateRow_('SALES', existing, patch);
      auditLog_(userId, 'Обновлена продажа (синк)', 'SALES:' + existing.sale_id, null, data.внешний_id, 'success', session ? session.cascade_id : '');
      return findOne_('SALES', 'sale_id', existing.sale_id);
    }
    return createSale_(data, userId, session);
  });
}

function getSales_(organizationId, locationId, dateFrom, dateTo) {
  return findRows_('SALES', function (r) {
    if (r.organization_id !== organizationId) return false;
    if (locationId && r.location_id !== locationId) return false;
    if (dateFrom && String(r.дата) < dateFrom) return false;
    if (dateTo && String(r.дата) > dateTo) return false;
    return true;
  }).sort(function (a, b) { return new Date(b.дата) - new Date(a.дата); });
}

// ---------- CSV-импорт продаж: preview → resolve → commit (тот же паттерн, что ProductImport.gs) ----------

var SALES_IMPORT_COLUMN_MAP = {
  'Дата': 'дата', 'дата': 'дата', 'date': 'дата',
  'Блюдо': 'dish_name', 'блюдо': 'dish_name', 'Название блюда': 'dish_name', 'dish': 'dish_name',
  'Кол-во': 'qty', 'Количество': 'qty', 'qty': 'qty',
  'Цена': 'цена_продажи', 'цена': 'цена_продажи', 'price': 'цена_продажи'
};

function importSalesPreview_(organizationId, locationId, rows, fileName, userId) {
  return withLock_(function () {
    if (!Array.isArray(rows) || !rows.length) throw new Error('Нет строк для импорта.');
    var batch = {
      import_id: generateId_('SALES_IMPORT_BATCHES'),
      organization_id: organizationId,
      location_id: locationId || '',
      source_file_name: fileName || '',
      status: 'PREVIEW',
      total_rows: rows.length, valid_rows: 0, warning_rows: 0, error_rows: 0,
      created_by: userId || '', created_at: nowIso_(), committed_at: ''
    };
    insertRow_('SALES_IMPORT_BATCHES', batch);

    var dishes = getDishes_(organizationId).filter(function (d) { return d.статус !== 'архив'; });
    var byNormalizedName = {};
    dishes.forEach(function (d) { byNormalizedName[normalizeProductName_(d.название)] = d; });

    var counts = { VALID: 0, WARNING: 0, ERROR: 0, REVIEW_REQUIRED: 0 };

    rows.forEach(function (raw, idx) {
      var mapped = {};
      Object.keys(raw).forEach(function (k) {
        var target = SALES_IMPORT_COLUMN_MAP[k] || (Object.values(SALES_IMPORT_COLUMN_MAP).indexOf(k) !== -1 ? k : null);
        if (target) mapped[target] = raw[k];
      });

      var messages = [];
      var status = 'VALID';
      var matchedDishId = '';

      if (!mapped.dish_name || !String(mapped.dish_name).trim()) {
        messages.push('Пустое название блюда.'); status = 'ERROR';
      } else {
        var match = byNormalizedName[normalizeProductName_(mapped.dish_name)];
        if (match) {
          matchedDishId = match.dish_id;
        } else {
          messages.push('Блюдо "' + mapped.dish_name + '" не найдено в справочнике блюд организации — требуется решение вручную (RESOLVE_SALES_IMPORT_ROW).');
          status = 'REVIEW_REQUIRED';
        }
      }

      var qty = Number(mapped.qty);
      if (mapped.qty === undefined || mapped.qty === '' || isNaN(qty) || qty <= 0) {
        messages.push('Некорректное или отсутствующее количество: "' + mapped.qty + '".');
        status = status === 'ERROR' ? status : 'ERROR';
      }

      if (mapped.цена_продажи !== undefined && mapped.цена_продажи !== '' && isNaN(Number(mapped.цена_продажи))) {
        messages.push('Нечисловая цена: "' + mapped.цена_продажи + '" — при коммите будет использована текущая цена блюда.');
        status = status === 'ERROR' ? status : 'WARNING';
      } else if (mapped.цена_продажи === undefined || mapped.цена_продажи === '') {
        messages.push('Цена не указана в файле — при коммите будет использована текущая цена блюда.');
        status = status === 'ERROR' ? status : (status === 'REVIEW_REQUIRED' ? status : 'WARNING');
      }

      if (!mapped.дата || !String(mapped.дата).trim()) {
        messages.push('Дата не указана — будет использована сегодняшняя.');
        status = status === 'ERROR' ? status : (status === 'REVIEW_REQUIRED' ? status : 'WARNING');
      }

      counts[status] = (counts[status] || 0) + 1;
      insertRow_('SALES_IMPORT_ROWS', {
        row_id: generateId_('SALES_IMPORT_ROWS'),
        import_id: batch.import_id,
        external_row_number: idx + 1,
        raw_json: JSON.stringify(raw),
        mapped_json: JSON.stringify(mapped),
        row_status: status,
        messages_json: JSON.stringify(messages),
        matched_dish_id: matchedDishId,
        decision: '',
        created_sale_id: ''
      });
    });

    var freshBatch = findOne_('SALES_IMPORT_BATCHES', 'import_id', batch.import_id);
    updateRow_('SALES_IMPORT_BATCHES', freshBatch, {
      status: 'VALIDATED',
      valid_rows: counts.VALID || 0, warning_rows: counts.WARNING || 0,
      error_rows: counts.ERROR || 0
    });
    return getSalesImportBatchSummary_(batch.import_id);
  });
}

function getSalesImportBatchSummary_(importId) {
  var batch = findOne_('SALES_IMPORT_BATCHES', 'import_id', importId);
  if (!batch) throw new Error('Импорт продаж не найден: ' + importId);
  return batch;
}

function getSalesImportBatches_(organizationId) {
  return findRows_('SALES_IMPORT_BATCHES', function (b) { return b.organization_id === organizationId; })
    .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
}

/** P0.1 — тот же класс проверки, что и ProductImport.gs::getImportRows_ (принадлежность через родительский батч). */
function getSalesImportRows_(importId, statusFilter, session) {
  if (session) {
    var batch = findOne_('SALES_IMPORT_BATCHES', 'import_id', importId);
    if (batch) assertOwnedByOrg_(session, batch, 'SALES_IMPORT_BATCHES:' + importId);
  }
  var batchForCandidates = findOne_('SALES_IMPORT_BATCHES', 'import_id', importId);
  return findRows_('SALES_IMPORT_ROWS', function (r) {
    return r.import_id === importId && (!statusFilter || r.row_status === statusFilter);
  }).map(function (r) {
    var mapped = JSON.parse(r.mapped_json || '{}');
    var out = {
      row_id: r.row_id, external_row_number: r.external_row_number,
      mapped: mapped, row_status: r.row_status,
      messages: JSON.parse(r.messages_json || '[]'),
      matched_dish_id: r.matched_dish_id, decision: r.decision
    };
    // Подсказка кандидата — только для нерешённых REVIEW_REQUIRED строк, только для
    // просмотра (не меняет данные, не подставляется в decision автоматически).
    if (r.row_status === 'REVIEW_REQUIRED' && !r.decision && batchForCandidates) {
      out.candidates = findDishCandidates_(batchForCandidates.organization_id, mapped.dish_name);
    }
    return out;
  });
}

/** decision: 'MATCH' (требует dishId — ручной выбор блюда для REVIEW_REQUIRED строки) или 'SKIP'. */
function resolveSalesImportRow_(rowId, decision, dishId, session) {
  var row = findOne_('SALES_IMPORT_ROWS', 'row_id', rowId);
  if (!row) throw new Error('Строка импорта продаж не найдена: ' + rowId);
  if (session) {
    var batch = findOne_('SALES_IMPORT_BATCHES', 'import_id', row.import_id);
    assertOwnedByOrg_(session, batch, 'SALES_IMPORT_BATCHES:' + row.import_id);
  }
  if (['MATCH', 'SKIP'].indexOf(decision) === -1) {
    throw new Error('Недопустимое решение: "' + decision + '". Разрешено: MATCH, SKIP.');
  }
  var patch = { decision: decision };
  if (decision === 'MATCH') {
    if (!dishId) throw new Error('Для решения MATCH нужно указать dishId.');
    var dish = findOne_('DISHES', 'dish_id', dishId);
    if (session) assertOwnedByOrg_(session, dish, 'DISHES:' + dishId);
    patch.matched_dish_id = dishId;
  }
  updateRow_('SALES_IMPORT_ROWS', row, patch);
  return { row_id: rowId, decision: decision };
}

/**
 * ТЗ (мирроринг ProductImport.gs::importProductsCommit_): одна ошибочная строка не
 * портит уже принятые — ошибки копятся в отчёте, не бросают исключение на весь батч.
 * ERROR-строки и строки с decision='SKIP' пропускаются; REVIEW_REQUIRED без явного
 * MATCH-решения тоже пропускается (не создаём продажу по неопознанному блюду молча).
 */
function importSalesCommit_(importId, userId, session) {
  return withLock_(function () {
    var batch = findOne_('SALES_IMPORT_BATCHES', 'import_id', importId);
    if (!batch) throw new Error('Импорт продаж не найден: ' + importId);
    if (session) assertOwnedByOrg_(session, batch, 'SALES_IMPORT_BATCHES:' + importId);
    if (batch.status === 'COMMITTED') throw new Error('Импорт уже был закоммичен ранее.');

    var rows = findRows_('SALES_IMPORT_ROWS', function (r) { return r.import_id === importId; });
    var created = 0, skipped = 0, errors = [];

    rows.forEach(function (r) {
      try {
        if (r.row_status === 'ERROR') { skipped++; return; }
        if (r.decision === 'SKIP') { skipped++; return; }
        var dishId = r.decision === 'MATCH' ? r.matched_dish_id : (r.row_status === 'REVIEW_REQUIRED' ? '' : r.matched_dish_id);
        if (!dishId) { skipped++; return; } // REVIEW_REQUIRED без решения — не коммитим молча

        var mapped = JSON.parse(r.mapped_json || '{}');
        var sale = createSale_({
          dishId: dishId,
          qty: mapped.qty,
          цена_продажи: mapped.цена_продажи,
          дата: mapped.дата,
          locationId: batch.location_id,
          источник: 'csv_импорт'
        }, userId, session);

        updateRow_('SALES_IMPORT_ROWS', r, { created_sale_id: sale.sale_id });
        created++;
      } catch (rowErr) {
        errors.push({ row: r.external_row_number, error: String(rowErr.message || rowErr) });
        skipped++;
      }
    });

    updateRow_('SALES_IMPORT_BATCHES', batch, { status: 'COMMITTED', committed_at: nowIso_() });
    auditLog_(userId, 'Импорт продаж закоммичен', 'SALES_IMPORT_BATCHES:' + importId, null,
      'создано:' + created + ' пропущено:' + skipped, 'success', session ? session.cascade_id : '');
    return { import_id: importId, создано: created, пропущено: skipped, ошибки: errors };
  });
}
