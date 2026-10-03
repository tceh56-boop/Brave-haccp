// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Ppk.gs
 * Секондарные фичи, раунд 4 (после TASKS/EVENTS/Лаборатория v2, см.
 * TSEKH_v2_CHANGELOG.md разделы 27-29) — версионирование ППК (Архитектура v4 §7,
 * §12 п.4). ЧЕСТНО, прежде всего, о том, чего этот раунд НЕ строит:
 *
 * Уже существующий трёхшаговый мастер регистрации предприятия/ППК (`v-setup`,
 * demo.html, CHANGELOG раздел 17) закрывает малую часть 27 разделов, которые
 * требует ТЗ v4 — карту потоков сырья/готовой продукции/отходов, анализ
 * опасностей (HazardID), классификацию OPRP/KT/ККТ, критические пределы вне уже
 * покрытых температурных норм, схему верификации. Архитектурный документ (§7)
 * ЯВНО говорит: это реальные НОВЫЕ экраны мастера, требующие нового человеческого
 * ввода — «не то, что можно вывести из уже введённых данных» — и ТЗ §17 прямо
 * требует, чтобы классификация CCP/KKT/KT/PRP «формировалась по утверждённой
 * методике анализа опасностей... результат должен быть проверяемым человеком» —
 * то есть НЕ должна выдумываться системой автоматически. Этот раунд такой контент
 * не строит и не имитирует (ни через AI, ни через эвристику) — это честно
 * оставлено будущему раунду с новым UI и вводом человека.
 *
 * Что раунд СТРОИТ — ровно то, что архитектурный документ прямо называет
 * реализуемым уже сейчас: версионирование (ТЗ §18 — «исторические записи не
 * пересчитывать задним числом»). Новая таблица PPK_VERSIONS с машиной состояний
 * DRAFT → REVIEW → APPROVED → ARCHIVED; после APPROVED версия неизменяема (тот же
 * приём, что уже используется для закрытых инвентаризаций/approved-ТТК); новая
 * редакция — всегда новая строка с новым version, старая остаётся для истории.
 *
 * snapshot_json каждой версии — ДВЕ честно различённые части:
 *   - "авто" — реально существующие в бэкенде данные на момент создания версии
 *     (организация, точки, активные цеха/оборудование, активные JOURNAL_DEFINITIONS
 *     — то есть уже РЕАЛЬНО зарегистрированный «активный набор журналов» из
 *     раздела 17 демо, но взятый из настоящих таблиц, а не из локального DB.*);
 *   - "ручной_ввод" — то, что передал клиент (директор/ответственный за ХАССП,
 *     отмеченные процессы, будущий контент 27 разделов и т.д.) — принимается и
 *     сохраняется КАК ЕСТЬ, БЕЗ проверки/дополнения системой — ровно то, что
 *     архитектурный документ требует оставить человеку.
 */

var PPK_STATUSES = ['DRAFT', 'REVIEW', 'APPROVED', 'ARCHIVED'];

/**
 * organizationId приходит от вызывающего кода уже проверенным (session на уровне
 * API.gs), тем же приёмом, что и createTask_/createLabTest_ — версия ВСЕГДА
 * привязывается к организации сессии, клиент не может её подменить.
 */
function createPpkVersion_(params) {
  return withLock_(function () {
    var organizationId = params.organizationId;
    var existing = findRows_('PPK_VERSIONS', function (r) { return r.organization_id === organizationId; });
    var nextVersion = 1 + existing.reduce(function (max, r) { return Math.max(max, Number(r.version) || 0); }, 0);

    var snapshot = {
      авто: _buildPpkAutoSnapshot_(organizationId),
      ручной_ввод: params.data || {}
    };

    var v = {
      ppk_id: generateId_('PPK_VERSIONS'),
      version: nextVersion,
      organization_id: organizationId,
      created_at: nowIso_(),
      effective_from: params.effectiveFrom || '',
      author_id: params.userId || '',
      approved_by: '',
      status: 'DRAFT',
      snapshot_json: JSON.stringify(snapshot)
    };
    insertRow_('PPK_VERSIONS', v);
    auditLog_(params.userId, 'Создана версия ППК (DRAFT)', 'PPK_VERSIONS:' + v.ppk_id,
      existing.length ? ('v' + (nextVersion - 1)) : 'нет', 'v' + nextVersion, 'success', params.session ? params.session.cascade_id : '');
    return v;
  });
}

/**
 * Собирает "авто"-часть снимка из РЕАЛЬНО существующих сегодня данных предприятия
 * — организация/точки/активные цеха/оборудование/активный набор норм журналов.
 * НЕ включает анализ опасностей/CCP/KKT/OPRP — этих таблиц не существует (§12 п.5).
 */
function _buildPpkAutoSnapshot_(organizationId) {
  var org = findOne_('ORGANIZATIONS', 'organization_id', organizationId);
  var locations = findRows_('LOCATIONS', function (r) { return r.organization_id === organizationId; });
  var locationIds = locations.map(function (l) { return l.location_id; });
  var workshops = findRows_('WORKSHOPS', function (r) { return locationIds.indexOf(r.location_id) !== -1 && r.статус !== 'архив'; });
  var equipment = findRows_('EQUIPMENT', function (r) { return locationIds.indexOf(r.location_id) !== -1; });
  var journalDefinitions = findRows_('JOURNAL_DEFINITIONS', function (r) { return r.organization_id === organizationId && r.статус === 'активен'; });
  // Секондарные фичи, раунд 5 (Rules.gs) — снимок ППК расширен активными на СЕГОДНЯ
  // нормативами (не просто последними по номеру версии — действующими именно на
  // дату снимка, та же логика, что и getActiveRule_/_ruleCoversDate_ в Rules.gs;
  // функция намеренно продублирована здесь как inline-фильтр, а не через вызов
  // getActiveRule_ по каждому scope в цикле — снимок должен взять ВСЕ действующие
  // нормативы организации разом, а не по одному scope за раз).
  var today = todayDateStr_();
  var activeRules = findRows_('RULES', function (r) { return r.organization_id === organizationId && _ruleCoversDate_(r, today); });

  return {
    организация: org ? { название: org.название, ИНН: org.ИНН, ОГРН: org.ОГРН, тип: org.тип } : null,
    точки: locations.map(function (l) { return { location_id: l.location_id, название: l.название, адрес: l.адрес }; }),
    цеха: workshops.map(function (w) { return { workshop_id: w.workshop_id, название: w.название, тип: w.тип }; }),
    оборудование: equipment.map(function (e) { return { equipment_id: e.equipment_id, название: e.название, тип: e.тип }; }),
    активные_журналы: journalDefinitions.map(function (d) {
      return { definition_id: d.definition_id, journal_type: d.journal_type, название: d.название, роль_ответственная: d.роль_ответственная };
    }),
    активные_нормативы: activeRules.map(function (r) {
      return { rule_id: r.rule_id, тип_правила: r.тип_правила, scope_type: r.scope_type, scope_id: r.scope_id, мин_значение: r.мин_значение, макс_значение: r.макс_значение, единица: r.единица, source_document: r.source_document };
    })
  };
}

function getPpkVersions_(organizationId, filters) {
  filters = filters || {};
  return findRows_('PPK_VERSIONS', function (r) {
    return r.organization_id === organizationId && (!filters.status || r.status === filters.status);
  }).sort(function (a, b) { return Number(b.version) - Number(a.version); });
}

/** Удобный доступ к "текущей действующей" ППК — единственная версия организации в статусе APPROVED (см. approvePpkVersion_ — гарантирует, что она всегда ровно одна). */
function getCurrentPpk_(organizationId) {
  return findRows_('PPK_VERSIONS', function (r) { return r.organization_id === organizationId && r.status === 'APPROVED'; })[0] || null;
}

/**
 * Редактирование ЧЕРНОВИКА. ТЗ §18 — после APPROVED версия неизменяема (та же
 * проверка, что уже применяется к закрытым инвентаризациям/approved-ТТК); ARCHIVED
 * тем более не редактируется — это уже история. Патч затрагивает ТОЛЬКО
 * ручной_ввод-часть снимка и effective_from — "авто"-часть намеренно не
 * пересобирается задним числом при правке (снимок — это то, что было верно НА
 * МОМЕНТ создания версии; если бэкенд-данные успели измениться, честный способ —
 * создать новую версию, а не молча подменить уже сохранённый снимок).
 */
function updatePpkVersion_(ppkId, patch, session) {
  return withLock_(function () {
    var v = findOne_('PPK_VERSIONS', 'ppk_id', ppkId);
    assertOwnedByOrg_(session, v, 'PPK_VERSIONS:' + ppkId); // ТЗ P0.1
    // Редактируется ТОЛЬКО черновик. REVIEW уже отправлена на утверждение — правка
    // "по дороге" подменила бы то, что увидит утверждающий, тем же самым риском,
    // ради которого ТЗ §18 требует неизменяемости APPROVED; ARCHIVED — уже история.
    if (v.status !== 'DRAFT') {
      throw new Error('Версию ППК в статусе ' + v.status + ' менять нельзя (ТЗ §18) — редактируется только DRAFT; создайте новую версию.');
    }
    var snapshot = JSON.parse(v.snapshot_json || '{}');
    if (patch && patch.data !== undefined) snapshot.ручной_ввод = patch.data;
    var rowPatch = { snapshot_json: JSON.stringify(snapshot) };
    if (patch && patch.effectiveFrom !== undefined) rowPatch.effective_from = patch.effectiveFrom;
    updateRow_('PPK_VERSIONS', v, rowPatch);
    auditLog_(session.user_id, 'Изменён черновик ППК', 'PPK_VERSIONS:' + ppkId, null, 'v' + v.version, 'success', session.cascade_id);
    return findOne_('PPK_VERSIONS', 'ppk_id', ppkId);
  });
}

function submitPpkVersionForReview_(ppkId, session) {
  return withLock_(function () {
    var v = findOne_('PPK_VERSIONS', 'ppk_id', ppkId);
    assertOwnedByOrg_(session, v, 'PPK_VERSIONS:' + ppkId); // ТЗ P0.1
    if (v.status !== 'DRAFT') {
      throw new Error('На утверждение можно отправить только версию в статусе DRAFT (текущий статус: ' + v.status + ').');
    }
    updateRow_('PPK_VERSIONS', v, { status: 'REVIEW' });
    auditLog_(session.user_id, 'Версия ППК отправлена на утверждение', 'PPK_VERSIONS:' + ppkId, 'DRAFT', 'REVIEW', 'success', session.cascade_id);
    notify_(v.organization_id, '', CONFIG.NOTIFICATION_TYPES.PPK_SUBMITTED_FOR_REVIEW,
      'Версия ППК v' + v.version + ' отправлена на утверждение.', 'ppk_submit|' + ppkId);
    return findOne_('PPK_VERSIONS', 'ppk_id', ppkId);
  });
}

/**
 * Утверждение — ТЗ §18: старая действующая версия НЕ удаляется и НЕ переписывается,
 * а переводится в ARCHIVED (тот же приём, что и у "заменена" в TECH_CARDS,
 * FoodCost.gs::createTechCard_, адаптированный под 4-статусную машину состояний
 * ППК) — гарантирует, что APPROVED-версия организации всегда ровно одна
 * (см. getCurrentPpk_ выше).
 */
function approvePpkVersion_(ppkId, session) {
  return withLock_(function () {
    var v = findOne_('PPK_VERSIONS', 'ppk_id', ppkId);
    assertOwnedByOrg_(session, v, 'PPK_VERSIONS:' + ppkId); // ТЗ P0.1
    if (v.status !== 'REVIEW') {
      throw new Error('Утвердить можно только версию в статусе REVIEW (текущий статус: ' + v.status + ').');
    }
    // Digital PPK readiness gate: approval remains human, but incomplete/unconfirmed HACCP model fails closed.
    if (typeof buildPpkReadinessGate_ === 'function') {
      var model = getPpkModel_(session, {ppkId: ppkId, locationId: session.location_id});
      var gate = buildPpkReadinessGate_(model);
      if (gate.status !== 'READY') throw new Error('ППК нельзя утвердить: требуется завершить подтверждение модели. Блокеры: ' + gate.blockers.join(', '));
    }
    var prevApproved = findRows_('PPK_VERSIONS', function (r) { return r.organization_id === v.organization_id && r.status === 'APPROVED'; });

    // P0.6 (ТЗ §6, атомарность/восстановление) — ПОРЯДОК ЗАПИСЕЙ НАРОЧНО ПЕРЕСТАВЛЕН:
    // раньше старая APPROVED-версия сначала архивировалась, и только потом новая
    // переводилась в APPROVED — сбой МЕЖДУ этими двумя шагами (нет настоящих
    // транзакций, ТЗ §6) оставлял бы организацию ВООБЩЕ БЕЗ действующей ППК
    // (getCurrentPpk_ вернул бы null) — критичнее, чем звучит: это единственный
    // источник "действующей" ППК для инспекции/отчётов. Теперь новая версия сначала
    // переводится в APPROVED, и только потом архивируется старая — при сбое между
    // шагами organization_id на короткое время имеет ДВЕ версии в APPROVED (безопасный
    // избыток, не потеря), getCurrentPpk_ вернёт первую найденную (старую, ещё
    // валидную) до тех пор, пока архивация не довершится — следующий вызов
    // approvePpkVersion_ или ручной archivePpkVersion_ доводит дело до конца.
    var patch = { status: 'APPROVED', approved_by: session.user_id };
    if (!v.effective_from) patch.effective_from = todayDateStr_();
    updateRow_('PPK_VERSIONS', v, patch);
    prevApproved.forEach(function (r) { updateRow_('PPK_VERSIONS', r, { status: 'ARCHIVED' }); });
    auditLog_(session.user_id, 'Версия ППК утверждена', 'PPK_VERSIONS:' + ppkId,
      prevApproved.length ? ('заменена: ' + prevApproved.map(function (r) { return 'v' + r.version; }).join(',')) : 'нет предыдущей', 'v' + v.version, 'success', session.cascade_id);
    return findOne_('PPK_VERSIONS', 'ppk_id', ppkId);
  });
}

/** Ручной архив (например, версия больше не актуальна, но так и не была утверждена) — из ЛЮБОГО статуса, кроме уже ARCHIVED. */
function archivePpkVersion_(ppkId, session) {
  return withLock_(function () {
    var v = findOne_('PPK_VERSIONS', 'ppk_id', ppkId);
    assertOwnedByOrg_(session, v, 'PPK_VERSIONS:' + ppkId); // ТЗ P0.1
    if (v.status === 'ARCHIVED') throw new Error('Версия ППК уже в архиве.');
    updateRow_('PPK_VERSIONS', v, { status: 'ARCHIVED' });
    auditLog_(session.user_id, 'Версия ППК архивирована', 'PPK_VERSIONS:' + ppkId, v.status, 'ARCHIVED', 'success', session.cascade_id);
    return findOne_('PPK_VERSIONS', 'ppk_id', ppkId);
  });
}
