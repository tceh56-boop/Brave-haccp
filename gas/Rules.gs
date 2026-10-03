// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Rules.gs
 * Секондарные фичи, раунд 5 (после TASKS/EVENTS/Лаборатория v2/ППК-версионирование,
 * см. TSEKH_v2_CHANGELOG.md разделы 27-30) — Нормативная база / HACCP Engine
 * (Архитектура v4 §12 п.5: «обобщение RULES с версиями и источником»).
 *
 * ИСТОЧНИК ИДЕИ: `RULES` была спроектирована ЕЩЁ РАНЬШЕ, в отдельном документе
 * `TSEKH_Architecture_Journals_Chemicals.md` (§2.1), как прямая реализация принципа
 * ТЗ §1/§11/§29 «пределы — не в коде, а в справочнике, с указанием источника
 * документа» — то же самое, что уже делает `JOURNAL_DEFINITIONS` для журналов, но
 * для норм, НЕ привязанных к периодическому журналу (срок хранения продукта, норма
 * разведения средства). В том документе таблица осталась только черновиком — ни
 * demo, ни бэкенд её не реализовали. Этот раунд реализует её в бэкенде, но НЕ как
 * тупую CRUD-таблицу, а как то, что архитектурный документ v4 явно требует —
 * ДВИЖОК с `effective_from`/`effective_to` (§12 п.5: «не просто версия, а отдельный
 * движок»): любая новая версия норматива автоматически закрывает период действия
 * предыдущей (не переписывая и не удаляя её — ТЗ §18 «исторические записи не
 * пересчитывать задним числом»), и можно спросить «какой норматив действовал НА
 * ДАТУ X», а не только «какой действует сейчас».
 *
 * ГРАНИЦА (честно, по итогам собственного разбора старого документа, §2.2.1): RULES
 * — ТОЛЬКО для простых ОДИНОЧНЫХ ЧИСЛОВЫХ пределов (температура хранения, влажность,
 * срок после вскрытия/разморозки в днях и т.п.). Норма разведения химии/экспозиция/
 * режим обработки — НЕ сюда: у реальных данных (см. тот же документ, §2.2.1, разбор
 * файла «ДЕЗ средства.csv») это диапазоны («0,5-3%»), качественные значения
 * («готовый раствор») и составные единицы — сама попытка загнать их в мин/макс
 * числом означала бы либо терять часть инструкции, либо придумывать число, которого
 * производитель не давал (прямой запрет принципа проекта «не подставлять
 * неизмеренное значение»). `CREATE_RULE` ниже поэтому ТРЕБУЕТ хотя бы одно числовое
 * значение (мин или макс) — нечисловые/составные нормативы (`CHEMICAL_APPLICATION_
 * RULES` из того же документа) в этом раунде НЕ строятся: это отдельный, гораздо
 * больший объём работы (полноценный бэкенд «Бытовая химия»), которого нет и в
 * порядке §12 вообще — не молчаливый пропуск, а прямое несоответствие масштабу
 * запрошенного пункта.
 */

var RULE_SCOPE_TYPES = ['product', 'category', 'chemical', 'equipment_type'];

/**
 * organizationId приходит от вызывающего кода уже проверенным (session на уровне
 * API.gs), тем же приёмом, что и весь раунд 3-4. scope_id — ссылка, которую клиент
 * может подменить чужим id, проверяется отдельно (ТЗ P0.1) — но ЧЕСТНО: реально
 * проверяется владение только для scope_type='product' (через PRODUCTS.organization_id)
 * и мягко — существование для 'category' (CATEGORIES — общий для всех организаций
 * справочник БЕЗ organization_id в схеме проекта, проверять здесь нечего, кроме
 * факта существования строки). Для 'chemical'/'equipment_type' НЕТ отдельной
 * структуры, отличающей их от обычного product_id/произвольной строки типа
 * оборудования (см. докстринг файла и CHANGELOG за полным обоснованием) —
 * проверка пропускается, расширяемо на будущее без изменения сигнатуры.
 */
function createRule_(params) {
  return withLock_(function () {
    var organizationId = params.organizationId;
    if (!params.ruleType) throw new Error('Тип норматива (ruleType) обязателен.');
    if (RULE_SCOPE_TYPES.indexOf(params.scopeType) === -1) {
      throw new Error('Недопустимый scope_type норматива: "' + params.scopeType + '". Разрешено: ' + RULE_SCOPE_TYPES.join(', ') + '.');
    }
    if (!params.scopeId) throw new Error('scope_id обязателен — норматив должен ссылаться на конкретный объект.');
    if (!params.sourceDocument) throw new Error('Источник (source_document) обязателен для норматива (ТЗ §29 — нормативная база без источника не заводится).');
    if (params.session) _assertRuleScopeOwned_(params.session, params.scopeType, params.scopeId);

    var minVal = (params.minValue === undefined || params.minValue === '') ? '' : Number(params.minValue);
    var maxVal = (params.maxValue === undefined || params.maxValue === '') ? '' : Number(params.maxValue);
    if (minVal === '' && maxVal === '') {
      throw new Error('Норматив должен иметь хотя бы одно числовое значение (мин или макс) — RULES только для простых числовых пределов (см. докстринг Rules.gs); норма с текстовым/составным значением (например, концентрация раствора) сюда не годится.');
    }
    if (minVal !== '' && isNaN(minVal)) throw new Error('мин_значение должно быть числом.');
    if (maxVal !== '' && isNaN(maxVal)) throw new Error('макс_значение должно быть числом.');

    var sameScope = findRows_('RULES', function (r) {
      return r.organization_id === organizationId && r.тип_правила === params.ruleType &&
        r.scope_type === params.scopeType && r.scope_id === params.scopeId;
    });
    var nextVersion = 1 + sameScope.reduce(function (max, r) { return Math.max(max, Number(r.version) || 0); }, 0);
    var effectiveFrom = params.effectiveFrom || todayDateStr_();

    // Движок версий: закрываем период действия предыдущей ОТКРЫТОЙ (без effective_to)
    // версии ЭТОГО ЖЕ норматива — не удаляя и не переписывая её (ТЗ §18), только
    // проставляя дату окончания. статус у неё остаётся 'действует' — она была
    // действительна ИСТОРИЧЕСКИ, это не то же самое, что 'архив' (ручной отзыв
    // ошибочного/более неактуального норматива, см. archiveRule_).
    //
    // P0.6 (ТЗ §6, атомарность/восстановление) — ПОРЯДОК ЗАПИСЕЙ НАРОЧНО ПЕРЕСТАВЛЕН:
    // раньше сначала закрывался период ДЕЙСТВУЮЩЕГО старого норматива (effective_to),
    // и только потом писалась новая строка — если insertRow_ ниже упал бы ПОСЛЕ
    // закрытия старого (нет настоящих транзакций, ТЗ §6), scope на дату effectiveFrom
    // остался бы БЕЗ ДЕЙСТВУЮЩЕГО норматива вообще (старый уже закрыт, новый не создан)
    // — ровно тот "молчаливо неполный результат", который ТЗ P0.6 требует не допускать.
    // Теперь новая версия сначала СОЗДАЁТСЯ, и только потом закрывается период старой.
    // Это безопасно: getActiveRule_ (см. ниже) при выборе действующего норматива на
    // дату всегда берёт СТАРШУЮ version среди покрывающих эту дату строк — если старая
    // версия останется открытой (effective_to не проставлен из-за сбоя ПОСЛЕ insertRow_),
    // она просто перестаёт быть видимой как "действующая" (новая версия её перекрывает
    // по номеру), никакого провала покрытия не возникает — максимум, "зависшая" открытая
    // старая строка исправляется следующим же createRule_ для этого же scope.
    var rule = {
      rule_id: generateId_('RULES'),
      organization_id: organizationId,
      тип_правила: params.ruleType,
      scope_type: params.scopeType,
      scope_id: params.scopeId,
      мин_значение: minVal,
      макс_значение: maxVal,
      единица: params.unit || '',
      source_document: params.sourceDocument,
      version: nextVersion,
      effective_from: effectiveFrom,
      effective_to: '',
      статус: 'действует'
    };
    insertRow_('RULES', rule);
    if (params.session && params.session.location_id) detectAndRequestPpkReview_(organizationId,params.session.location_id,'RULE_CHANGED','RULES',rule.rule_id,params.userId,params.session,'Изменен норматив.');
    var openPrev = sameScope.filter(function (r) { return r.статус !== 'архив' && !r.effective_to; });
    openPrev.forEach(function (r) { updateRow_('RULES', r, { effective_to: effectiveFrom }); });
    auditLog_(params.userId, 'Создан норматив (RULES)', 'RULES:' + rule.rule_id,
      sameScope.length ? ('v' + (nextVersion - 1)) : 'нет', 'v' + nextVersion, 'success', params.session ? params.session.cascade_id : '');
    return rule;
  });
}

function _assertRuleScopeOwned_(session, scopeType, scopeId) {
  if (scopeType === 'product') {
    assertOwnedByOrg_(session, getProductById_(scopeId), 'PRODUCTS:' + scopeId);
  } else if (scopeType === 'category') {
    if (!findOne_('CATEGORIES', 'category_id', scopeId)) {
      throw new Error('Категория не найдена: ' + scopeId);
    }
  }
  // 'chemical'/'equipment_type' — см. докстринг createRule_: сознательно не проверяются.
}

/** Действует ли норматив НА ДАТУ dateStr (по умолчанию — сегодня): не в архиве, дата в пределах [effective_from, effective_to). */
function _ruleCoversDate_(rule, dateStr) {
  if (rule.статус === 'архив') return false;
  if (rule.effective_from && rule.effective_from > dateStr) return false;
  if (rule.effective_to && rule.effective_to <= dateStr) return false;
  return true;
}

/**
 * Ядро движка: «какой норматив ДЕЙСТВОВАЛ на дату X» (по умолчанию — сегодня), а не
 * только «какой последний по номеру версии» — это и есть разница между просто
 * версионированием (TECH_CARDS/PPK_VERSIONS) и «движком с effective_from/effective_to»,
 * которого явно просит §12 п.5.
 */
function getActiveRule_(organizationId, ruleType, scopeType, scopeId, asOfDate) {
  var dateStr = asOfDate || todayDateStr_();
  var matches = findRows_('RULES', function (r) {
    return r.organization_id === organizationId && r.тип_правила === ruleType &&
      r.scope_type === scopeType && r.scope_id === scopeId && _ruleCoversDate_(r, dateStr);
  });
  matches.sort(function (a, b) { return Number(b.version) - Number(a.version); });
  return matches[0] || null;
}

/** Полная история версий норматива (включая закрытые и архивные) — для аудита/инспекции, не только "текущее". */
function getRuleHistory_(organizationId, ruleType, scopeType, scopeId) {
  return findRows_('RULES', function (r) {
    return r.organization_id === organizationId && r.тип_правила === ruleType &&
      r.scope_type === scopeType && r.scope_id === scopeId;
  }).sort(function (a, b) { return Number(b.version) - Number(a.version); });
}

/** Общий листинг с опциональными фильтрами — для экрана администрирования нормативов. */
function getRules_(organizationId, filters) {
  filters = filters || {};
  return findRows_('RULES', function (r) {
    if (r.organization_id !== organizationId) return false;
    if (filters.ruleType && r.тип_правила !== filters.ruleType) return false;
    if (filters.scopeType && r.scope_type !== filters.scopeType) return false;
    if (filters.status && r.статус !== filters.status) return false;
    return true;
  }).sort(function (a, b) { return Number(b.version) - Number(a.version); });
}

/** Ручной отзыв (норматив введён ошибочно, или объект больше не существует) — из ЛЮБОГО не-архивного статуса. Не путать с автоматическим закрытием effective_to при создании новой версии (createRule_) — это ДРУГОЙ случай: там норматив был верным, просто сменился. */
function archiveRule_(ruleId, session) {
  return withLock_(function () {
    var r = findOne_('RULES', 'rule_id', ruleId);
    assertOwnedByOrg_(session, r, 'RULES:' + ruleId); // ТЗ P0.1
    if (r.статус === 'архив') throw new Error('Норматив уже в архиве.');
    updateRow_('RULES', r, { статус: 'архив' });
    auditLog_(session.user_id, 'Норматив отозван (архив)', 'RULES:' + ruleId, r.статус, 'архив', 'success', session.cascade_id);
    return findOne_('RULES', 'rule_id', ruleId);
  });
}
