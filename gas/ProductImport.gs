// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — ProductImport.gs
 * Раунд 8 — ТЗ §3/§27-§31. Массовый импорт большой базы продуктов В GLOBAL_PRODUCTS
 * (не в организационные PRODUCTS — глобальный справочник по архитектуре, см.
 * ProductMaster.gs) с preview/валидацией/поиском дублей ДО записи в рабочие таблицы.
 *
 * ГРАНИЦА РЕАЛИЗАЦИИ (флагую явно, не тихо): Apps Script не имеет встроенного парсера
 * .xlsx в процессе выполнения без предварительной конвертации через Drive (что само по
 * себе меняет исходный файл и требует отдельного шага). ТЗ §27 п.1 "Загрузка Excel/CSV"
 * реализована как ГРАНИЦА фронтенд/бэкенд: фронтенд разбирает Excel/CSV в массив
 * объектов-строк (например через SheetJS в браузере) и передаёт УЖЕ РАЗОБРАННЫЙ JSON —
 * этот файл начинает работу с шага 2 ТЗ §27 ("Определение колонок/Mapping"), не с
 * шага 1. Это осознанная граница, не сокрытая недоработка — сам разбор файла на
 * сервере Apps Script при текущих ограничениях среды не сделать без риска потери
 * форматирования/времени на конвертацию через Google Docs.
 *
 * Проверено на РЕАЛЬНОМ файле Дениса (Полная_база_продуктов_ИТОГ.xlsx, 1218 строк,
 * 17 колонок) — колонки exactly совпадают с ТЗ §3/§28, см. CHANGELOG.
 */

/** ТЗ §28 — соответствие колонок источника полям импорта. */
var PRODUCT_IMPORT_COLUMN_MAP = {
  '№': 'external_row_number',
  'Название продукта': 'name',
  'Тип продукта': 'product_type',
  'Описание': 'description',
  'Калорийность (ккал/100г)': 'calories_kcal_100g',
  'Белки (г/100г)': 'protein_g_100g',
  'Жиры (г/100г)': 'fat_g_100g',
  'Углеводы (г/100г)': 'carbohydrate_g_100g',
  'Клетчатка (г/100г)': 'fiber_g_100g',
  'Сахара (г/100г)': 'sugar_g_100g',
  'Доп. нутриенты': 'extra_nutrients_raw',
  'Условия хранения': 'storage_conditions',
  'Срок (комнатная t°)': 'shelf_life_room',
  'Срок (холодильник)': 'shelf_life_refrigerator',
  'Срок (морозильник)': 'shelf_life_freezer',
  'Признаки порчи': 'spoilage_signs',
  'Важные замечания': 'notes'
};

/** "Калий: 415; Niacin mg: 8.1" → {"Калий": 415, "Niacin mg": 8.1} — best-effort, сохраняем и исходную строку отдельно на всякий случай парсинга неудачно. */
function _parseExtraNutrients_(raw) {
  var result = {};
  String(raw || '').split(';').forEach(function (part) {
    var m = part.split(':');
    if (m.length < 2) return;
    var key = m[0].trim();
    var value = parseFloat(m.slice(1).join(':').trim().replace(',', '.'));
    if (key && !isNaN(value)) result[key] = value;
  });
  return result;
}

/** "темные пятна; слизь; гнилостный запах" → ["темные пятна","слизь","гнилостный запах"]. */
function _splitSemicolonList_(raw) {
  return String(raw || '').split(';').map(function (s) { return s.trim(); }).filter(Boolean);
}

/** Лучшее возможное разбирание "5-7 дней"/"До 8 месяцев"/"Не более 3-4 часов" — не гарантировано, raw_text всегда сохраняется отдельно (ТЗ §24). */
var SHELF_LIFE_UNIT_WORDS = { 'час': 'hours', 'часов': 'hours', 'часа': 'hours', 'дн': 'days', 'день': 'days', 'дня': 'days', 'дней': 'days', 'месяц': 'months', 'месяца': 'months', 'месяцев': 'months' };
function _parseShelfLifeText_(raw) {
  var text = String(raw || '').toLowerCase();
  var numMatch = text.match(/(\d+)(?:\s*[-–—]\s*(\d+))?/);
  var unitMatch = Object.keys(SHELF_LIFE_UNIT_WORDS).find(function (w) { return text.indexOf(w) !== -1; });
  if (!numMatch) return { duration: '', duration_unit: '' };
  var duration = numMatch[2] ? Number(numMatch[2]) : Number(numMatch[1]); // берём верхнюю границу диапазона как разумную оценку
  return { duration: duration, duration_unit: unitMatch ? SHELF_LIFE_UNIT_WORDS[unitMatch] : '' };
}

/**
 * ТЗ §27 шаг 2-8. rows — массив объектов УЖЕ с русскими заголовками колонок источника
 * (как в файле Дениса) ИЛИ уже с английскими ключами PRODUCT_IMPORT_COLUMN_MAP —
 * функция принимает оба варианта для гибкости фронтенда.
 */
function importProductsPreview_(organizationId, rows, fileName, userId) {
  return withLock_(function () {
    if (!Array.isArray(rows) || !rows.length) throw new Error('Нет строк для импорта.');
    var batch = {
      import_id: generateId_('PRODUCT_IMPORT_BATCHES'),
      organization_id: organizationId,
      source_file_name: fileName || '',
      status: 'PREVIEW',
      total_rows: rows.length, valid_rows: 0, warning_rows: 0, error_rows: 0, duplicate_rows: 0,
      created_by: userId || '', created_at: nowIso_(), committed_at: ''
    };
    insertRow_('PRODUCT_IMPORT_BATCHES', batch);

    var seenInFile = {}; // normalized_name -> external_row_number первого вхождения (дубль ВНУТРИ файла)
    var counts = { VALID: 0, WARNING: 0, ERROR: 0, DUPLICATE: 0, REVIEW_REQUIRED: 0 };

    rows.forEach(function (raw, idx) {
      var mapped = {};
      Object.keys(raw).forEach(function (k) {
        var target = PRODUCT_IMPORT_COLUMN_MAP[k] || (Object.values(PRODUCT_IMPORT_COLUMN_MAP).indexOf(k) !== -1 ? k : null);
        if (target) mapped[target] = raw[k];
      });

      var messages = [];
      var status = 'VALID';

      if (!mapped.name || !String(mapped.name).trim()) {
        messages.push('Пустое название продукта.'); status = 'ERROR';
      }
      ['calories_kcal_100g', 'protein_g_100g', 'fat_g_100g', 'carbohydrate_g_100g', 'fiber_g_100g', 'sugar_g_100g'].forEach(function (f) {
        if (mapped[f] === undefined || mapped[f] === '' || mapped[f] === null) return;
        var n = Number(mapped[f]);
        if (isNaN(n)) { messages.push('Нечисловое значение в поле ' + f + ': "' + mapped[f] + '".'); status = status === 'ERROR' ? status : 'WARNING'; }
        else if (n < 0) { messages.push('Отрицательное значение в поле ' + f + '.'); status = status === 'ERROR' ? status : 'WARNING'; }
      });

      var normalized = mapped.name ? normalizeProductName_(mapped.name) : '';
      var duplicateCandidateId = '';
      if (normalized) {
        if (seenInFile[normalized] !== undefined) {
          messages.push('Дублирует строку №' + seenInFile[normalized] + ' в этом же файле.');
          status = 'DUPLICATE';
        } else {
          seenInFile[normalized] = mapped.external_row_number || (idx + 1);
          var candidates = findDuplicateCandidates_(mapped.name, null);
          if (candidates.length) {
            duplicateCandidateId = candidates[0].global_product_id;
            messages.push('Похож на уже существующий продукт в справочнике: "' + candidates[0].name + '" (' + candidates[0].match + ').');
            if (status === 'VALID') status = 'REVIEW_REQUIRED';
          }
        }
      }

      counts[status] = (counts[status] || 0) + 1;
      insertRow_('PRODUCT_IMPORT_ROWS', {
        row_id: generateId_('PRODUCT_IMPORT_ROWS'),
        import_id: batch.import_id,
        external_row_number: mapped.external_row_number || (idx + 1),
        raw_json: JSON.stringify(raw),
        mapped_json: JSON.stringify(mapped),
        row_status: status,
        messages_json: JSON.stringify(messages),
        duplicate_candidate_global_id: duplicateCandidateId,
        decision: '',
        created_global_id: ''
      });
    });

    // НАЙДЕНО ПРИ ЗАПУСКЕ ТЕСТОВ РАУНДА 8 (тот же класс ошибки, что уже был исправлен
    // ранее в Journals.gs, см. её комментарий "P0.6" там): insertRow_ выше вернул тот
    // же JS-объект batch, который ему передали, БЕЗ поля __row (оно проставляется
    // только при чтении строки листа через findOne_/findRows_/getAllRows_) —
    // updateRow_(batch, ...) на непрочитанном объекте бросал бы исключение. Перечитываем.
    var freshBatch = findOne_('PRODUCT_IMPORT_BATCHES', 'import_id', batch.import_id);
    updateRow_('PRODUCT_IMPORT_BATCHES', freshBatch, {
      status: 'VALIDATED',
      valid_rows: counts.VALID || 0, warning_rows: counts.WARNING || 0,
      error_rows: counts.ERROR || 0, duplicate_rows: (counts.DUPLICATE || 0) + (counts.REVIEW_REQUIRED || 0)
    });
    return getImportBatchSummary_(batch.import_id);
  });
}

function getImportBatchSummary_(importId) {
  var batch = findOne_('PRODUCT_IMPORT_BATCHES', 'import_id', importId);
  if (!batch) throw new Error('Импорт не найден: ' + importId);
  return batch;
}

/**
 * P0.1, найдено при написании тестов раунда 8: importId — клиентский ID, а
 * PRODUCT_IMPORT_ROWS своего organization_id не хранит (принадлежность — через
 * родительский PRODUCT_IMPORT_BATCHES) — без этой проверки чужая организация могла
 * прочитать содержимое чужого импорта (сырые строки исходного файла) по чужому importId.
 */
function getImportRows_(importId, statusFilter, session) {
  if (session) {
    var batch = findOne_('PRODUCT_IMPORT_BATCHES', 'import_id', importId);
    if (batch) assertOwnedByOrg_(session, batch, 'PRODUCT_IMPORT_BATCHES:' + importId);
  }
  return findRows_('PRODUCT_IMPORT_ROWS', function (r) {
    return r.import_id === importId && (!statusFilter || r.row_status === statusFilter);
  }).map(function (r) {
    return {
      row_id: r.row_id, external_row_number: r.external_row_number,
      mapped: JSON.parse(r.mapped_json || '{}'), row_status: r.row_status,
      messages: JSON.parse(r.messages_json || '[]'),
      duplicate_candidate_global_id: r.duplicate_candidate_global_id,
      decision: r.decision
    };
  });
}

/**
 * ТЗ §27 шаг 9-10 + §30 (не перезаписывать без контроля). Коммитит все строки батча,
 * НЕ ERROR и с decision != 'SKIP'. decision по умолчанию: VALID/WARNING/REVIEW_REQUIRED
 * без явного decision → 'CREATE_NEW'; DUPLICATE без явного decision → пропускается
 * (не создаём молча дубль — пользователь должен явно сказать RESOLVE_DUPLICATE_CANDIDATE).
 * Одна ошибочная строка не должна портить уже принятые (тот же принцип, что и у
 * receiveGoodsBatch_ в Warehouse.gs) — ошибки строки копятся в отчёте, не бросают исключение.
 */
function importProductsCommit_(importId, userId, session) {
  return withLock_(function () {
    var batch = findOne_('PRODUCT_IMPORT_BATCHES', 'import_id', importId);
    if (!batch) throw new Error('Импорт не найден: ' + importId);
    if (session) assertOwnedByOrg_(session, batch, 'PRODUCT_IMPORT_BATCHES:' + importId);
    if (batch.status === 'COMMITTED') throw new Error('Импорт уже был закоммичен ранее.');

    var rows = findRows_('PRODUCT_IMPORT_ROWS', function (r) { return r.import_id === importId; });
    var created = 0, merged = 0, skipped = 0, errors = [];

    rows.forEach(function (r) {
      try {
        if (r.row_status === 'ERROR') { skipped++; return; }
        var decision = r.decision || (r.row_status === 'DUPLICATE' ? 'SKIP' : 'CREATE_NEW');
        if (decision === 'SKIP') { skipped++; return; }

        var mapped = JSON.parse(r.mapped_json || '{}');
        if (decision === 'MERGE' && r.duplicate_candidate_global_id) {
          var patch = {};
          ['description'].forEach(function (f) { if (mapped[f]) patch[f] = mapped[f]; });
          if (mapped.calories_kcal_100g !== undefined && mapped.calories_kcal_100g !== '') patch.calories_kcal_100g = Number(mapped.calories_kcal_100g);
          if (mapped.protein_g_100g !== undefined && mapped.protein_g_100g !== '') patch.protein_g_100g = Number(mapped.protein_g_100g);
          if (mapped.fat_g_100g !== undefined && mapped.fat_g_100g !== '') patch.fat_g_100g = Number(mapped.fat_g_100g);
          if (mapped.carbohydrate_g_100g !== undefined && mapped.carbohydrate_g_100g !== '') patch.carbohydrate_g_100g = Number(mapped.carbohydrate_g_100g);
          if (Object.keys(patch).length) updateGlobalProduct_(r.duplicate_candidate_global_id, patch, userId, 'импорт: слияние строки №' + r.external_row_number);
          updateRow_('PRODUCT_IMPORT_ROWS', r, { created_global_id: r.duplicate_candidate_global_id });
          merged++;
          return;
        }

        var global = createGlobalProduct_({
          name: mapped.name, productType: mapped.product_type, description: mapped.description,
          caloriesKcal100g: mapped.calories_kcal_100g, proteinG100g: mapped.protein_g_100g, fatG100g: mapped.fat_g_100g,
          carbohydrateG100g: mapped.carbohydrate_g_100g, fiberG100g: mapped.fiber_g_100g, sugarG100g: mapped.sugar_g_100g,
          extraNutrients: _parseExtraNutrients_(mapped.extra_nutrients_raw),
          storageConditionsText: mapped.storage_conditions,
          importantNotes: mapped.notes,
          source: batch.source_file_name || 'import', sourceType: 'REFERENCE', confidence: 'medium'
        }, userId);

        ['room', 'refrigerator', 'freezer'].forEach(function (mode) {
          var raw = mapped['shelf_life_' + mode];
          if (!raw) return;
          var parsed = _parseShelfLifeText_(raw);
          setProductShelfLife_(global.global_product_id, mode.toUpperCase(), raw, parsed.duration, parsed.duration_unit, batch.source_file_name || 'import', false, userId);
        });
        _splitSemicolonList_(mapped.spoilage_signs).forEach(function (sign) {
          setProductSpoilageSign_(global.global_product_id, sign, batch.source_file_name || 'import', false, userId);
        });

        updateRow_('PRODUCT_IMPORT_ROWS', r, { created_global_id: global.global_product_id, decision: decision });
        created++;
      } catch (rowErr) {
        errors.push({ row: r.external_row_number, error: String(rowErr.message || rowErr) });
        skipped++;
      }
    });

    updateRow_('PRODUCT_IMPORT_BATCHES', batch, { status: 'COMMITTED', committed_at: nowIso_() });
    auditLog_(userId, 'Импорт продуктов закоммичен', 'PRODUCT_IMPORT_BATCHES:' + importId, null,
      'создано:' + created + ' слито:' + merged + ' пропущено:' + skipped, 'success', session ? session.cascade_id : '');
    return { import_id: importId, создано: created, слито: merged, пропущено: skipped, ошибки: errors };
  });
}

/**
 * P0.1, найдено при написании тестов раунда 8: rowId — клиентский ID, эта функция
 * МЕНЯЕТ данные (не только читает) — без проверки чужая организация могла бы
 * переписать decision в чужой строке импорта (принадлежность — через родительский
 * PRODUCT_IMPORT_BATCHES, у самой строки organization_id нет).
 */
function resolveDuplicateCandidate_(rowId, decision, userId, session) {
  var row = findOne_('PRODUCT_IMPORT_ROWS', 'row_id', rowId);
  if (!row) throw new Error('Строка импорта не найдена: ' + rowId);
  if (session) {
    var batch = findOne_('PRODUCT_IMPORT_BATCHES', 'import_id', row.import_id);
    assertOwnedByOrg_(session, batch, 'PRODUCT_IMPORT_BATCHES:' + row.import_id);
  }
  if (['CREATE_NEW', 'MERGE', 'SKIP'].indexOf(decision) === -1) {
    throw new Error('Недопустимое решение: "' + decision + '". Разрешено: CREATE_NEW, MERGE, SKIP.');
  }
  updateRow_('PRODUCT_IMPORT_ROWS', row, { decision: decision });
  return { row_id: rowId, decision: decision };
}

function getImportBatches_(organizationId) {
  return findRows_('PRODUCT_IMPORT_BATCHES', function (b) { return b.organization_id === organizationId; })
    .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
}
