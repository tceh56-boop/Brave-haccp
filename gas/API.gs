// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — API.gs (v2)
 * Единый диспетчер действий — это и есть processOperation() из ТЗ §4/§27.
 * ЕДИНСТВЕННОЕ место, откуда фронтенд достаёт/меняет данные. Любое новое действие
 * добавляется СЮДА (в ACTION_HANDLERS) и в CONFIG.ACTION_MODULE (Config.gs) —
 * если действия нет в CONFIG.ACTION_MODULE, оно отклоняется до вызова обработчика
 * (fail-closed, ТЗ §18).
 *
 * Конвейер processOperation() (ТЗ §4), в порядке шагов:
 *   1. проверить пользователя (сессия)      → resolveSession_
 *   2. проверить, выбрана ли точка           → LOCATION_OPTIONAL_ACTIONS (v2, ТЗ §1)
 *   3. проверить права                       → userCanAccessModule_ + CONFIG.ACTION_MODULE
 *   4. проверить корректность данных          → делегируется обработчику (throw = отказ)
 *   5-9. записать/пересчитать/обновить        → сам обработчик действия (получает cascade_id)
 *   10. запись в историю                       → обработчики сами вызывают auditLog_
 *   11. обновить интерфейс                     → ответ уходит клиенту как JSON
 *   12. уведомление при необходимости          → обработчики сами вызывают notify_
 *
 * v2 — ВАЖНО (ТЗ §18/§59): ни одно поле, присланное клиентом (роль, organization_id,
 * location_id "по мнению фронтенда"), никогда не используется для решения о правах —
 * везде ниже используется ТОЛЬКО session.* (то, что сервер сам положил в кэш при логине/
 * выборе точки). Скрыть кнопку на фронтенде — это удобство интерфейса, не защита; здесь —
 * настоящая проверка (ТЗ §60).
 */

// Действия, разрешённые ДО выбора точки (организационно-административные и сам логин-флоу).
var LOCATION_OPTIONAL_ACTIONS = [
  'GET_SESSION', 'SELECT_LOCATION', 'LOGOUT',
  'GET_ORGANIZATIONS', 'CREATE_ORGANIZATION', 'GET_LOCATIONS', 'CREATE_LOCATION',
  'GET_USERS', 'CREATE_USER', 'CREATE_POSITION', 'GET_POSITIONS', 'UPDATE_POSITION', 'UPDATE_EMPLOYEE_PROFILE', 'TRANSFER_EMPLOYEE', 'GET_EMPLOYEE_READINESS', 'GET_EMPLOYEE_EQUIPMENT_PERMISSIONS', 'CHANGE_PIN', 'RESET_PIN', 'DEACTIVATE_USER', 'ACTIVATE_USER',
  'GET_BACKUPS', 'CREATE_BACKUP'
];

var ACTION_HANDLERS = {
  // ---------- Вход/сессия ----------
  LOGIN: function (data) { return loginWithPin_(data.pin, data.userId); },
  GET_SESSION: function (data, session) { return getSessionInfo_(session); },
  SELECT_LOCATION: function (data, session) { return selectLocation_(session, data.locationId); },
  LOGOUT: function (data, session) { return logout_(session); },

  // ---------- Пользователи ----------
  CREATE_USER: function (data, session) { return createUser_({ organization_id: session.organization_id, location_ids: data.location_ids, имя: data.имя, email: data.email, телефон: data.teleфон || data.телефон, роль: data.роль, position_id:data.positionId||'', workshop_id:data.workshopId||'', job_type:data.jobType||'', equipment_ids:data.equipmentIds||[], pin: data.pin, actorUserId: session.user_id, session: session }); },
  CREATE_POSITION: function (data, session) { return createPosition_(data||{}, session); },
  GET_POSITIONS: function (data, session) { return getPositions_(session); },
  UPDATE_POSITION: function (data, session) { return updatePosition_(data.positionId, data.patch||{}, session); },
  UPDATE_EMPLOYEE_PROFILE: function (data, session) { return updateEmployeeProfile_(data.employeeId, data||{}, session); },
  TRANSFER_EMPLOYEE: function (data, session) { return transferEmployee_(data.employeeId, data||{}, session); },
  GET_EMPLOYEE_READINESS: function (data, session) { return getEmployeeSafetyReadiness_(data.employeeId||session.user_id, session); },
  GET_EMPLOYEE_EQUIPMENT_PERMISSIONS: function (data, session) { return getEmployeeEquipmentPermissions_(data.employeeId||session.user_id, session); },
  CHECK_EMPLOYEE_OPERATION_SAFETY: function (data, session) { return checkEmployeeOperationSafety_(data||{}, session); },
  CHANGE_PIN: function (data, session) { return changePin_(session, data.userId || session.user_id, data.newPin); },
  RESET_PIN: function (data, session) { return resetPin_(session, data.userId, data.newPin); },
  DEACTIVATE_USER: function (data, session) { return deactivateUser_(session, data.userId); },
  ACTIVATE_USER: function (data, session) { return activateUser_(session, data.userId); },
  GET_USERS: function (data, session) { return getUsers_(session.organization_id); },

  // ---------- Организации/точки ----------
  // ТЗ P0.1 — раньше отдавал ВСЕ организации системы (полный список арендаторов) любому
  // пользователю с модулем 'organizations'. Теперь всегда только собственная организация
  // сессии — обычному пользователю видеть список чужих организаций не нужно никогда.
  GET_ORGANIZATIONS: function (data, session) { return getOrganizations_(session.organization_id); },
  CREATE_ORGANIZATION: function (data, session) { return createOrganization_({ название: data.название, ИНН: data.ИНН, ОГРН: data.ОГРН, тип: data.тип, actorUserId: session.user_id }); },
  GET_LOCATIONS: function (data, session) { return getLocations_(session.organization_id); },
  CREATE_LOCATION: function (data, session) { return createLocation_({ organization_id: session.organization_id, название: data.название, адрес: data.адрес, actorUserId: session.user_id }); },

  // ---------- Дашборд ----------
  GET_DASHBOARD: function (data, session) { return getDashboard_(session.organization_id, session.location_id); },
  GET_CONTROL_TOWER: function (data, session) { return getControlTower_(data || {}, session); },
  GET_AUTOMATION_DECISIONS: function (data, session) { return getAutomationDecisions_(session, data || {}); },
  GET_CONFIGURATION: function (data, session) { return getConfiguration_(data || {}, session); },
  CREATE_CONFIGURATION_REVISION: function (data, session) { return createConfigurationRevision_(data || {}, session); },
  APPROVE_CONFIGURATION_REVISION: function (data, session) { return approveConfigurationRevision_(data && data.versionId, session); },
  ACTIVATE_CONFIGURATION_REVISION: function (data, session) { return activateConfigurationRevision_(data && data.versionId, session); },
  ROLLBACK_CONFIGURATION: function (data, session) { return rollbackConfiguration_(data && data.versionId, session); },
  GET_POLICY_DECISION: function (data, session) { return getPolicyDecision_(data || {}, session); },
  GET_POLICY_CATALOG: function (data, session) { return getPolicyCatalog_(session); },
  GET_MASTER_DATA: function (data, session) { return getMasterData_(data || {}, session); },
  RUN_DATA_QUALITY_AUDIT: function (data, session) { return runDataQualityAudit_(data || {}, session); },
  GET_RECONCILIATION_CASES: function (data, session) { return getReconciliationCases_(data || {}, session); },
  CREATE_RECONCILIATION_CASE: function (data, session) { return createReconciliationCase_(data || {}, session); },
  RESOLVE_RECONCILIATION_CASE: function (data, session) { return resolveReconciliationCase_(data || {}, session); },
  GET_MASTER_DATA_DUPLICATES: function (data, session) { return getMasterDataDuplicates_(data || {}, session); },
  CREATE_MASTER_DATA_ALIAS: function (data, session) { return createMasterDataAlias_(data || {}, session); },
  RESOLVE_MASTER_DATA_DUPLICATE: function (data, session) { return resolveMasterDataDuplicate_(data || {}, session); },
  RUN_AUTOMATION_DECISIONS: function (data, session) { return buildAutomationDecisions_(session); },
  APPROVE_AUTOMATION_DECISION: function (data, session) { return approveAutomationDecision_(data.decisionId, session); },
  REJECT_AUTOMATION_DECISION: function (data, session) { return rejectAutomationDecision_(data.decisionId, session, data.reason); },
  GET_EVENT_AUTOMATION_RULES: function (data, session) { return getEventAutomationRules_(session, data || {}); },
  CREATE_EVENT_AUTOMATION_RULE: function (data, session) { return createEventAutomationRule_(data || {}, session); },
  SET_EVENT_AUTOMATION_RULE_STATUS: function (data, session) { return setEventAutomationRuleStatus_(data.ruleId, data.status, session); },
  RUN_EVENT_AUTOMATION: function (data, session) { return withLock_(function(){ return dispatchEventAutomationBatch_(session, data && data.limit); }); },
  GET_AUTOMATION_WORKFLOWS: function (data, session) { return getAutomationWorkflows_(session, data || {}); },
  CREATE_AUTOMATION_WORKFLOW: function (data, session) { return createAutomationWorkflow_(data || {}, session); },
  COMPLETE_AUTOMATION_WORKFLOW_STEP: function (data, session) { return completeAutomationWorkflowStep_(data.stepId, data.result, session); },
  RUN_AUTOMATION_WORKFLOW_SLA: function (data, session) { return runAutomationWorkflowSla_(session, data && data.limit); },

  // ---------- Продукты/рецепты ----------
  GET_PRODUCTS: function (data, session) { return getProducts_(session.organization_id); },
  // РАУНД 10: createProduct_ всегда принимал и проверял на уникальность штрихкод (см.
  // Products.gs), но это действие ни разу не пробрасывало data.штрихкод дальше — любой
  // продукт, созданный через API, всегда получал пустой штрихкод. Добавлено пробрасывание.
  CREATE_PRODUCT: function (data, session) { var r = createProduct_({ organization_id: session.organization_id, название: data.название, категория_id: data.категория_id, единица: data.единица, закупочная_цена: data.цена, поставщик_id: data.поставщик_id, срок_хранения_дней: data.срок_хранения_дней, мин_остаток: data.мин_остаток, штрихкод: data.штрихкод, userId: session.user_id }); invalidateProductIndex_(session.organization_id); return r; },
  UPDATE_PRODUCT_PRICE: function (data, session) { return updateProductPrice_(data.productId, data.newPrice, session.user_id, session); },
  GET_PRICE_HISTORY: function (data, session) { return getPriceHistory_(data.productId, session, data.limit); },
  GET_PRICE_CASCADE: function (data, session) { return getPriceCascade_(data.productId, session); },
  GET_ANALYTICS_DASHBOARD: function (data, session) { return getAnalyticsDashboard_(session, data || {}); },
  GET_DISH_ANALYTICS: function (data, session) { return getDishAnalytics_(session.organization_id, resolveLocationScope_(session, data.locationId), data.dateFrom, data.dateTo); },
  GET_PRODUCT_ANALYTICS: function (data, session) { return getProductAnalytics_(session.organization_id, resolveLocationScope_(session, data.locationId), data.dateFrom, data.dateTo); },
  GET_DISH_ANALYTICS_DETAIL: function (data, session) { return getDishAnalyticsDetail_(data.dishId, session.organization_id, resolveLocationScope_(session, data.locationId), data.dateFrom, data.dateTo); },
  GET_PRODUCT_ANALYTICS_DETAIL: function (data, session) { return getProductAnalyticsDetail_(data.productId, session.organization_id, resolveLocationScope_(session, data.locationId), data.dateFrom, data.dateTo); },
  CREATE_DISH: function (data, session) { return createDish_({ organization_id: session.organization_id, название: data.название, категория_id: data.категория_id, выход: data.выход, цена_продажи: data.цена_продажи }, session.user_id); },
  // РАУНД 10: до этого раунда блюдо нельзя было отредактировать вообще (см. комментарий
  // над updateDish_ в FoodCost.gs) — переименовать, поправить категорию/выход/цену продажи
  // после создания было физически невозможно. patch намеренно НЕ принимает
  // себестоимость/food_cost/маржа — они всегда только каскадный расчёт от состава рецепта.
  UPDATE_DISH: function (data, session) { return updateDish_(data.dishId, data.patch || {}, session); },
  // Раунд 9 — восполнен пробел (см. комментарий у getDishes_ в FoodCost.gs): без этого
  // действия блюдо можно было создать, но никогда больше не увидеть списком.
  GET_DISHES: function (data, session) { return getDishes_(session.organization_id); },
  // Раунд 9 — восполнен пробел (см. комментарий у getSemiFinishedList_ в SemiFinished.gs):
  // createSemiFinished_ существовал в коде, но не был подключён ни к одному действию.
  CREATE_SEMI_FINISHED: function (data, session) { return createSemiFinished_({ organization_id: session.organization_id, workshop_id: data.workshopId, название: data.название, выход: data.выход, единица: data.единица, потери_процент: data.потериПроцент, срок_хранения_часов: data.срокХраненияЧасов, условия_хранения: data.условияХранения }); },
  GET_SEMI_FINISHED: function (data, session) { return getSemiFinishedList_(session.organization_id); },
  // P0.2 — addRecipeLine_ теперь сама выполняет каскадный пересчёт (внутри своего же
  // withLock_) и возвращает его результат; раньше recalcParentCost_ вызывался тут
  // отдельным незащищённым шагом СНАРУЖИ, а его результат вообще терялся (см. Recipes.gs).
  ADD_RECIPE_LINE: function (data, session) { return addRecipeLine_(data.parentType, data.parentId, data.ingredientId, data.брутто, data.нетто, data.единица, data.потериПроцент, session); },
  GET_RECIPES: function (data, session) { return getRecipeLines_(data.parentType, data.parentId, session); },
  UPDATE_RECIPE: function (data, session) { return updateRecipeLine_(data.recipeId, data.patch, session); },
  // P0.4 — найдено при аудите: createTechCard_/getTechCards_ (FoodCost.gs) существовали
  // с самого начала проекта, но ни разу не были подключены ни к одному действию — ТТК
  // нельзя было создать или прочитать через API вообще. Подключено здесь.
  CREATE_TECH_CARD: function (data, session) { return createTechCard_(data.dishId, { технология: data.технология, фото_url: data.фото_url }, session.user_id, session); },
  GET_TECH_CARDS: function (data, session) { return getTechCards_(data.dishId, session); },
  CREATE_TTK_VERSION: function (data, session) { return createTtkVersion_(data || {}, session); },
  GET_TTK_VERSIONS: function (data, session) { return getTtkVersions_(data.dishId, session); },
  GET_TTK_CONTEXT: function (data, session) { return getTtkContext_(data.dishId, session); },
  GET_TTK_EDITOR_CONTEXT: function (data, session) { return getTtkEditorContext_(data.dishId, session, data.ttkVersionId); },
  UPDATE_TTK_DRAFT: function (data, session) { return updateTtkDraft_(data.ttkVersionId, data || {}, session); },
  SUBMIT_TTK_FOR_APPROVAL: function (data, session) { return submitTtkForApproval_(data.ttkVersionId, session); },
  APPROVE_TTK_VERSION: function (data, session) { return approveTtkVersion_(data.ttkVersionId, session); },
  CREATE_BREAKDOWN_PLAN: function (data, session) { return createBreakdownPlan_(data || {}, session); },
  GET_BREAKDOWN_PLANS: function (data, session) { return getBreakdownPlans_(session, data && data.inputProductId); },
  APPROVE_BREAKDOWN_PLAN: function (data, session) { return approveBreakdownPlan_(data.planId, session); },
  GET_BREAKDOWN_TASKS: function (data, session) { return getBreakdownTasks_(session, data && data.status); },
  START_BREAKDOWN_ACT: function (data, session) { return startBreakdownAct_(data.actId, session); },
  COMPLETE_BREAKDOWN_ACT: function (data, session) { return completeBreakdownAct_(data || {}, session); },
  GET_BREAKDOWN_TRACE: function (data, session) { return getBreakdownActTrace_(data.actId, session); },
  CREATE_BREAKDOWN_PLAN_STEP: function (data, session) { return createBreakdownPlanStep_(data || {}, session); },
  GET_BREAKDOWN_PLAN_MAP: function (data, session) { return getBreakdownPlanMap_(data.planId, session); },
  CREATE_TTK_HACCP_LINK: function (data, session) { return createTtkHaccpLink_(data || {}, session); },
  CREATE_TTK_SANPIN_LINK: function (data, session) { return createTtkSanpinLink_(data || {}, session); },

  // P0.6 (ТЗ §6, "механизм восстановления") — та же категория пробела, что и у
  // CREATE_TECH_CARD выше: CascadeEngine.gs::getCascade_ существовал с P0.2, но не был
  // подключён ни к одному действию. GET_CASCADE — посмотреть одну операцию (например,
  // по cascade_id из ответа processOperation, если что-то показалось не так клиенту),
  // с проверкой принадлежности организации сессии (см. getCascadeForSession_,
  // CascadeEngine.gs); GET_RECOVERY_CASCADES — список операций СВОЕЙ организации в
  // статусе RECOVERY_REQUIRED (см. API.gs::processOperation catch-блок и
  // CascadeEngine.gs::_cascadeHasPartialWrites_) — то, что ТЗ P0.6 называет "recovery
  // record", здесь виден директору/админу как список для ручного разбора, а не
  // автоматически что-то чинит сам.
  GET_CASCADE: function (data, session) { return getCascadeForSession_(data.cascadeId, session); },
  GET_RECOVERY_CASCADES: function (data, session) { return getCascadesByStatus_(session.organization_id, 'RECOVERY_REQUIRED'); },
  CREATE_SAFETY_DOCUMENT: function (data, session) { return createSafetyDocument_(data || {}, session); },
  GET_SAFETY_DOCUMENTS: function (data, session) { return getSafetyDocuments_(session, data || {}); },
  UPDATE_SAFETY_DOCUMENT: function (data, session) { return updateSafetyDocument_(data.documentId, data.patch || {}, session); },
  UPLOAD_SAFETY_DOCUMENT: function (data, session) { return uploadSafetyDocumentFile_(data || {}, session); },
  CREATE_SAFETY_DOCUMENT_VERSION: function (data, session) { return createSafetyDocumentVersion_(data || {}, session); },
  APPROVE_SAFETY_DOCUMENT: function (data, session) { return approveSafetyDocument_(data.documentId, session); },
  ACTIVATE_SAFETY_DOCUMENT: function (data, session) { return activateSafetyDocument_(data.documentId, session); },
  ARCHIVE_SAFETY_DOCUMENT: function (data, session) { return archiveSafetyDocument_(data.documentId, session); },
  GET_SAFETY_DOCUMENT_VERSIONS: function (data, session) { return getSafetyDocumentVersions_(data.documentId, session); },
  CREATE_SAFETY_BRIEFING_TYPE: function (data, session) { return createSafetyBriefingType_(data || {}, session); },
  GET_SAFETY_BRIEFING_TYPES: function (data, session) { return getSafetyBriefingTypes_(session); },
  CREATE_SAFETY_REQUIREMENT: function (data, session) { return createSafetyRequirement_(data || {}, session); },
  CREATE_REQUIREMENT_RULE: function (data, session) { return createRequirementRule_(data || {}, session); },
  GET_REQUIREMENT_RULES: function (data, session) { return getRequirementRules_(session); },
  GET_SAFETY_REQUIREMENTS: function (data, session) { return getSafetyRequirements_(session); },
  CREATE_SAFETY_EMPLOYEE_CONTEXT: function (data, session) { return createSafetyEmployeeContext_(data || {}, session); },
  GET_SAFETY_EMPLOYEE_CONTEXT: function (data, session) { return getSafetyEmployeeContext_(data.employeeId || session.user_id, session); },
  SYNC_SAFETY_ASSIGNMENTS: function (data, session) { return syncSafetyAssignments_(session, data.employeeId || session.user_id); },
  GET_MY_SAFETY_ASSIGNMENTS: function (data, session) { return getMySafetyAssignments_(session); },
  OPEN_SAFETY_ASSIGNMENT: function (data, session) { return openSafetyAssignment_(data.assignmentId, session); },
  START_SAFETY_BRIEFING: function (data, session) { return startSafetyBriefing_(data.assignmentId, session); },
  REASSIGN_SAFETY_BRIEFING: function (data, session) { return reassignSafetyBriefing_(data.assignmentId, data || {}, session); },
  CREATE_SAFETY_TEST: function (data, session) { return createSafetyTest_(data || {}, session); },
  ADD_SAFETY_QUESTION: function (data, session) { return addSafetyQuestion_(data || {}, session); },
  APPROVE_SAFETY_TEST: function (data, session) { return approveSafetyTest_(data.testId, session); },
  ACTIVATE_SAFETY_TEST: function (data, session) { return activateSafetyTest_(data.testId, session); },
  GET_SAFETY_TESTS: function (data, session) { return getSafetyTests_(session, data.instructionId); },
  GET_SAFETY_QUESTIONS: function (data, session) { return getSafetyQuestions_(session, data.testId); },
  START_SAFETY_TEST: function (data, session) { return startSafetyTest_(data.assignmentId, session); },
  COMPLETE_SAFETY_TEST: function (data, session) { return completeSafetyTest_(data || {}, session); },
  GET_SAFETY_TEST_ATTEMPTS: function (data, session) { return getSafetyTestAttempts_(session, data || {}); },
  CONFIRM_SAFETY_ASSIGNMENT: function (data, session) { return confirmSafetyAssignment_(data || {}, session); },
  GET_SAFETY_BRIEFING_LOG: function (data, session) { return getSafetyBriefingLog_(session, data || {}); },
  GET_SAFETY_EMPLOYEE_CARD: function (data, session) { return getSafetyEmployeeCard_(data.employeeId || session.user_id, session); },
  GET_SAFETY_INSTRUCTION_CARD: function (data, session) { return getSafetyInstructionCard_(data.documentId, session); },
  GET_SAFETY_DASHBOARD: function (data, session) { return getSafetyDashboard_(session); },
  PROCESS_SAFETY_DEADLINES: function (data, session) { return processSafetyDeadlines_(session.organization_id); },
  CHECK_SAFETY_REQUIREMENT: function (data, session) { return checkSafetyRequirement_(data || {}, session); },
  GET_SAFETY_EMERGENCY: function (data, session) { return getSafetyEmergencyInstructions_(session); },
  GET_SAFETY_FINAL_GATE: function (data, session) { return getSafetyFinalGate_(session); },
  CREATE_SAFETY_QR: function (data, session) { return createSafetyQr_(data || {}, session); },
  GET_SAFETY_BY_QR: function (data, session) { return getSafetyByQr_(data.token, session); },
  GET_SAFETY_REPORT: function (data, session) { return getSafetyReport_(session, data.type, data.filters || {}); },
  EXPORT_SAFETY_CSV: function (data, session) { return exportSafetyCsv_(session, data.type, data.filters || {}); },

  GET_P22_COVERAGE: function (data, session) { return getP22CoverageReport_(session, data || {}); },
  GET_P21_JOURNAL_MAP: function (data, session) { return getP21JournalMap_(); },
  GET_P21_AUTOMATION_CONTRACT: function (data, session) { return getP21AutomationContract_(); },
  GET_P21_COVERAGE: function (data, session) { return getP21CoverageReport_(session, data || {}); },
  GET_P21_FINAL_GATE: function (data, session) { return getP21FinalGate_(session, data || {}); },
  GET_P22_FINAL_GATE: function (data, session) { return getP22FinalGate_(session, data || {}); },
  GET_P22_RECOVERY: function (data, session) { return getP22Recovery_(session, data || {}); },
  RETRY_P22_RECOVERY: function (data, session) { return p22RetryRecovery_(session, data || {}); },
  GET_PRODUCTION_READINESS: function (data, session) { return productionReadinessCheck(); },
  SCAN_AND_RECEIVE_INVOICE: function (data, session) { return scanAndReceiveInvoice_(data || {}, session); },
  SCAN_INVOICE_PREVIEW: function (data, session) { return createInvoiceIntakeDraftHardened_(data || {}, session); },
  GET_INVOICE_INTAKE_DRAFT: function (data, session) { return getInvoiceIntakeDraft_(session, data || {}); },
  CONFIRM_INVOICE_RECEIPT: function (data, session) { return confirmInvoiceReceiptHardening_(data || {}, session); },
  RESOLVE_INVOICE_INTAKE_LINE: function (data, session) { return resolveInvoiceIntakeLine_(data || {}, session); },
  APPEND_INVOICE_INTAKE_PAGE: function (data, session) { return appendInvoiceIntakePage_(data || {}, session); },
  GET_DOCUMENT_INTEGRITY_DASHBOARD: function (data, session) { return getDocumentIntegrityDashboard_(session); },
  CHECK_DOCUMENT_INTEGRITY: function (data, session) { return _documentIntegrityCheck_(data.document || {}, data.lines || [], session, data.draftId || ''); },
  RUN_HACCP_DECISION_ENGINE: function (data, session) { return recordHaccpDecision_(data || {}, session); },
  GET_HACCP_DECISIONS: function (data, session) { return findRows_('HACCP_DECISIONS', function(r){return r.organization_id===session.organization_id && (!data.batchId || r.batch_id===data.batchId);}); },
  GET_EMERGENCY_CENTER: function (data, session) { return getEmergencyCenter_(session); },
  GENERATE_TTK_A4_PDF: function (data, session) { return generateTtkA4Pdf_(session, data || {}); },
  GENERATE_PPK_INSPECTION_A4_PDF: function (data, session) { return generatePpkInspectionA4Pdf_(session, data || {}); },
  ENQUEUE_OFFLINE_OPERATION: function (data, session) { return enqueueOfflineOperationHardened_(data || {}, session); },
  SYNC_OFFLINE_QUEUE: function (data, session) { return syncOfflineQueueHardened_(data || {}, session); },
  GET_RECURSIVE_BATCH_COST_TRACE: function (data, session) { return getRecursiveBatchCostTraceHardened_(session, data || {}); },
  RELEASE_SEMI_FINISHED_QUALITY: function (data, session) { return releaseSemiFinishedQuality_(data || {}, session); },
  GET_DEPLOYMENT_READINESS: function (data, session) { return getDeploymentReadiness_(session); },
  GET_OPERATIONAL_READINESS_STAGE12: function (data, session) { return getOperationalReadinessStage12_(session); },
  GET_OPERATIONAL_READINESS_STAGE13: function (data, session) { return getOperationalReadinessStage13_(session); },
  RUN_ENTERPRISE_E2E_TEST: function (data, session) { return runEnterpriseEndToEndTest_(session); },
  GET_HACCP_DASHBOARD: function (data, session) { return getHaccpComplianceDashboard_(session); },
  GET_PPK_FINAL_GATE: function (data, session) { return getEnterpriseFinalGate_(session); },

  // ---------- Продажи (раунд 11 — Sales.gs, по запросу Дениса "Реализуй все три
  // направления": ручной ввод, CSV-импорт, API-синк кассы — все три опираются на
  // createSale_/upsertSaleFromExternal_ этого модуля) ----------
  CREATE_SALE: function (data, session) { return createSale_({ dishId: data.dishId, qty: data.qty, цена_продажи: data.цена_продажи, дата: data.дата, locationId: session.location_id, источник: 'ручной_ввод' }, session.user_id, session); },
  CREATE_SALE_AND_FULFILL: function (data, session) { return createSaleAndFulfill_({ dishId:data.dishId, qty:data.qty, цена_продажи:data.цена_продажи, дата:data.дата, источник:data.источник||'продажа_по_ТТК' }, session.user_id, session); },
  FULFILL_SALE: function (data, session) { return fulfillSaleByTtk_(data.saleId, session); },

  // ---------- Касса (Pos.gs, replica/architecture.md M1) ----------
  POS_GET_MENU: function (data, session) { return posGetMenu_(session); },
  POS_GET_SHIFT: function (data, session) { return posGetShift_(session); },
  POS_OPEN_SHIFT: function (data, session) { return posOpenShift_(data || {}, session); },
  POS_CLOSE_SHIFT: function (data, session) { return posCloseShift_(data || {}, session); },
  POS_CREATE_ORDER: function (data, session) { return posCreateOrder_(data || {}, session); },
  POS_ADD_LINE: function (data, session) { return posAddLine_(data || {}, session); },
  POS_UPDATE_LINE: function (data, session) { return posUpdateLine_(data || {}, session); },
  POS_GET_ORDER: function (data, session) { return posGetOrder_(data || {}, session); },
  POS_GET_ORDERS: function (data, session) { return posGetOrders_(data || {}, session); },
  POS_PAY: function (data, session) { return posPay_(data || {}, session); },
  POS_CANCEL_ORDER: function (data, session) { return posCancelOrder_(data || {}, session); },
  POS_FULFILL_PENDING: function (data, session) { return posFulfillPendingSales_(session, Number(data && data.limit) || POS_FULFILL_BATCH_LIMIT_); },
  POS_GET_FLOOR: function (data, session) { return posGetFloor_(session); },
  POS_SAVE_HALL: function (data, session) { return posSaveHall_(data || {}, session); },
  POS_SAVE_TABLE: function (data, session) { return posSaveTable_(data || {}, session); },
  POS_SEND_TO_KITCHEN: function (data, session) { return posSendToKitchen_(data || {}, session); },
  POS_PRECHECK: function (data, session) { return posPrecheck_(data || {}, session); },
  POS_REOPEN_ORDER: function (data, session) { return posReopenOrder_(data || {}, session); },
  POS_MOVE_ORDER: function (data, session) { return posMoveOrder_(data || {}, session); },
  POS_GET_KITCHEN_QUEUE: function (data, session) { return posGetKitchenQueue_(session); },
  POS_MARK_LINE_READY: function (data, session) { return posMarkLineReady_(data || {}, session); },
  POS_GET_MODIFIERS: function (data, session) { return posGetModifiers_(session); },
  POS_SAVE_MODIFIER_GROUP: function (data, session) { return posSaveModifierGroup_(data || {}, session); },
  POS_SAVE_MODIFIER: function (data, session) { return posSaveModifier_(data || {}, session); },
  POS_LINK_DISH_MODIFIERS: function (data, session) { return posLinkDishModifiers_(data || {}, session); },
  // Волна 3, M9 — заготовочный лист (KitchenPrep.gs)
  PREP_GET_LIST: function (data, session) { return prepGetList_(data || {}, session); },
  PREP_BUILD_LIST: function (data, session) { return prepBuildList_(data || {}, session); },
  PREP_MARK_DONE: function (data, session) { return prepMarkDone_(data || {}, session); },
  PREP_SKIP: function (data, session) { return prepSkip_(data || {}, session); },
  PREP_GET_PARS: function (data, session) { return prepGetPars_(session); },
  PREP_SAVE_PAR: function (data, session) { return prepSavePar_(data || {}, session); },
  POS_GET_STOP_LIST: function (data, session) { return posGetStopList_(session); },
  POS_SET_STOP: function (data, session) { return posSetStop_(data || {}, session); },
  POS_CLEAR_STOP: function (data, session) { return posClearStop_(data || {}, session); },
  POS_RECALC_STOP_LIST: function (data, session) { return posRecalcStopList_(session); },
  POS_REFUND: function (data, session) { return posRefund_(data || {}, session); },
  POS_GET_STAFF_REPORT: function (data, session) { return posGetStaffReport_(data || {}, session); },
  POS_GET_SHIFTS: function (data, session) { return posGetShifts_(data || {}, session); },
  POS_FIND_GUEST: function (data, session) { return posFindGuest_(data || {}, session); },
  POS_SAVE_GUEST: function (data, session) { return posSaveGuest_(data || {}, session); },
  POS_ATTACH_GUEST: function (data, session) { return posAttachGuest_(data || {}, session); },
  POS_GET_GUEST: function (data, session) { return posGetGuest_(data || {}, session); },
  POS_GET_GUESTS: function (data, session) { return posGetGuests_(data || {}, session); },
  POS_ADJUST_BONUS: function (data, session) { return posAdjustBonus_(data || {}, session); },
  POS_ANONYMIZE_GUEST: function (data, session) { return posAnonymizeGuest_(data || {}, session); },
  POS_GET_LOYALTY_SETTINGS: function (data, session) { return posGetLoyaltySettings_(session); },
  POS_SAVE_LOYALTY_SETTINGS: function (data, session) { return posSaveLoyaltySettings_(data || {}, session); },
  POS_GET_TIP_LINKS: function (data, session) { return posGetTipLinks_(session); },
  POS_SAVE_TIP_LINK: function (data, session) { return posSaveTipLink_(data || {}, session); },
  POS_GET_QRMENU: function (data, session) { return posGetQrMenu_(session); },
  POS_PUBLISH_QRMENU: function (data, session) { return posPublishQrMenu_(session); },
  POS_SAVE_QRMENU_SETTINGS: function (data, session) { return posSaveQrMenuSettings_(data || {}, session); },
  POS_DISCARD_EMPTY_ORDER: function (data, session) { return posDiscardEmptyOrder_(data || {}, session); },

  // ---------- Stage 20: дашборд руководителя и каталог отчётов (ReportsDashboard.gs) ----------
  GET_EXECUTIVE_DASHBOARD: function (data, session) { return getExecutiveDashboard_(session, data || {}); },
  GET_MANAGEMENT_REPORTS: function (data, session) { return getManagementReports_(session, data || {}); },
  GET_SALE_TRACE: function (data, session) { return getSaleTrace_(session, data || {}); },
  GET_SALES: function (data, session) { return getSales_(session.organization_id, resolveLocationScope_(session, data.locationId), data.dateFrom, data.dateTo); },
  IMPORT_SALES_PREVIEW: function (data, session) { return importSalesPreview_(session.organization_id, session.location_id, data.rows, data.fileName, session.user_id); },
  IMPORT_SALES_COMMIT: function (data, session) { return importSalesCommit_(data.importId, session.user_id, session); },
  GET_SALES_IMPORT_BATCHES: function (data, session) { return getSalesImportBatches_(session.organization_id); },
  GET_SALES_IMPORT_ROWS: function (data, session) { return getSalesImportRows_(data.importId, data.statusFilter, session); },
  RESOLVE_SALES_IMPORT_ROW: function (data, session) { return resolveSalesImportRow_(data.rowId, data.decision, data.dishId, session); },

  // ---------- Склад ----------
  GET_WAREHOUSE: function (data, session) {
    return getProducts_(session.organization_id).map(function (p) {
      return { product_id: p.product_id, название: p.название, остаток: round2_(getStockLevel_(p.product_id, session.location_id)), единица: p.единица };
    });
  },
  RECEIVE_GOODS: function (data, session) { return receiveGoods_(data.productId, session.location_id, data.qty, data.price, data.expiryDate, session.user_id, session, { declarationId: data.declarationId, certificateId: data.certificateId, veterinaryDocumentId: data.veterinaryDocumentId, supplierId: data.supplierId }, data.productionDate); },
  RECEIVE_GOODS_BATCH: function (data, session) { return receiveGoodsBatch_(data.lines, session.location_id, session.user_id, session); },
  // P0.3 — fromLocationId ВСЕГДА session.location_id (откуда сессия, а не что пришлёт клиент, ТЗ P0.1); toLocationId — клиентский, проверяется на принадлежность той же организации внутри transferStock_.
  TRANSFER_STOCK: function (data, session) { return transferStock_(data.productId, session.location_id, data.toLocationId, data.qty, session.user_id, session); },
  FIND_PRODUCT_BY_BARCODE: function (data, session) { return findProductByBarcode_(session.organization_id, data.barcode); },
  GENERATE_LABEL: function (data, session) { return generateBatchLabel_(data.batchId, session); },
  GET_LABEL: function (data, session) { return generateBatchLabel_(data.batchId, session); },
  GET_MARKING_JOURNAL: function (data, session) { return getMarkingJournal_(data || {}, session); },
  CREATE_LABEL_PRINT_JOB: function (data, session) { return createLabelPrintJob_(data || {}, session); },
  VERIFY_LABEL_PRINT: function (data, session) { return verifyLabelPrint_(data || {}, session); },
  OPEN_CONTAINER: function (data, session) { return openContainer_(data || {}, session); },
  GET_BATCH_BY_QR: function (data, session) { return getBatchByQr_(data.qrPayload, session); },
  CONFIRM_BATCH_SHELF_LIFE: function (data, session) { return confirmBatchShelfLife_(data.batchId, data.expiryIso, session.user_id, session); },

  // ---------- Списания/закупки/производство/инвентаризация ----------
  CREATE_WRITEOFF: function (data, session) { return createWriteOff_({ productId: data.productId, locationId: session.location_id, qty: data.qty, reasonId: data.reasonId, userId: session.user_id, session: session }); },
  GET_WRITEOFFS: function (data, session) { return getWriteOffs_(session.location_id, data.since); },

  CREATE_PURCHASE_REQUEST: function (data, session) { return createPurchaseRequest_(session.location_id, data.productId, data.qty, session.user_id, session); },
  GET_PURCHASE_REQUESTS: function (data, session) { return getPurchaseRequests_(session.location_id); },
  UPDATE_PURCHASE_REQUEST_STATUS: function (data, session) { return updatePurchaseRequestStatus_(data.requestId, data.status, session); },

  CREATE_PRODUCTION_TASK: function (data, session) { return createProductionTask_(session.location_id, data.parentType, data.parentId, data.qty, session.user_id, data.workshopId, session); },
  ADVANCE_PRODUCTION: function (data, session) { return advanceProductionStatus_(data.productionId, data.newStatus, session); },
  GET_PRODUCTION: function (data, session) { return getProductionTasks_(session.location_id, data.status); },
  GET_PRODUCTION_DISPATCHER: function (data, session) { return getProductionDispatcher_(session, data || {}); },
  DISPATCH_PRODUCTION_TASK: function (data, session) { return dispatchProductionTask_(data || {}, session); },
  RECORD_PRODUCTION_YIELD_DEVIATION: function (data, session) { return recordProductionYieldDeviation_(data || {}, session); },
  GET_PRODUCTION_YIELD_DEVIATIONS: function (data, session) { return getProductionYieldDeviations_(session, data || {}); },
  GET_SEMI_FINISHED_PASSPORT: function (data, session) { return getSemiFinishedPassport_(session, data || {}); },
  CREATE_RECALL_CASE: function (data, session) { return createRecallCase_(data || {}, session); },
  CLOSE_RECALL_CASE: function (data, session) { return closeRecallCase_(data.recallId, session); },
  GET_RECALL_CASE: function (data, session) { return getRecallCase_(session, data || {}); },
  GET_HACCP_EVIDENCE: function (data, session) { return getHaccpEvidence_(session, data || {}); },
  CAPTURE_HACCP_EVIDENCE: function (data, session) { return recordHaccpEvidence_(data || {}, session); },
  GET_ACTUAL_COST_TRACE: function (data, session) { return getActualCostTrace_(session, data || {}); },
  GET_BATCH_COST_TRACE: function (data, session) { return getBatchCostTrace_(session, data || {}); },
  CREATE_PRODUCTION_PLAN: function (data, session) { return createProductionPlan_(data || {}, session); },
  GET_PRODUCTION_PLAN: function (data, session) { return getProductionPlan_(data.planId, session); },
  APPROVE_PRODUCTION_PLAN: function (data, session) { return approveProductionPlan_(data.planId, session); },
  GET_MOBILE_PRODUCTION_BOARD: function (data, session) { return getMobileProductionBoard_(session, data || {}); },
  GET_BATCH_PASSPORT: function (data, session) { return getBatchPassport_(session, data || {}); },
  GENERATE_PPK_INSPECTION_PACKET: function (data, session) { return generateInspectionPacket_(session, data || {}); },
  GET_PPK_INSPECTION_PACKET: function (data, session) { return getInspectionPacket_(session, data || {}); },
  GET_PRODUCTION_ENTERPRISE_DASHBOARD: function (data, session) { return getProductionEnterpriseDashboard_(session, data || {}); },
  GET_PRODUCTION_WASTE: function (data, session) { return getProductionWaste_(session, data || {}); },
  GET_PRODUCTION_DISPATCH_PLAN: function (data, session) { return getProductionDispatchPlan_(data || {}, session); },
  CREATE_PRODUCTION_DISPATCH_PLAN: function (data, session) { return createProductionDispatchPlan_(data || {}, session); },
  APPROVE_PRODUCTION_DISPATCH_PLAN: function (data, session) { return approveProductionDispatchPlan_(data.dispatchPlanId, session); },
  SET_PRODUCTION_DISPATCH_CONFIG: function (data, session) { return setProductionDispatchConfig_(data || {}, session); },
  GET_WASTE_TRACE: function (data, session) { return getWasteTrace_(session, data || {}); },

  START_INVENTORY: function (data, session) { return startInventory_(session.location_id, session.user_id, session); },
  SUBMIT_INVENTORY_LINE: function (data, session) { return submitInventoryLine_(data.inventoryId, data.productId, data.participok, data.factQty, session.user_id, session); },
  CLOSE_INVENTORY: function (data, session) { return closeInventory_(data.inventoryId, session); },
  GET_INVENTORY: function (data, session) { return getInventorySummary_(data.inventoryId, session); },
  CREATE_ADJUSTMENT_FROM_INVENTORY: function (data, session) { return createAdjustmentFromInventoryLine_(data.lineId, session); },

  // ---------- Журналы/нормы/отклонения ----------
  ADD_JOURNAL_ENTRY: function (data, session) { return addJournalEntry_(session.location_id, data.journalType, data.value, session.user_id, session.organization_id, data.workshopId, '', session.cascade_id); },
  GET_JOURNALS: function (data, session) { return getJournalEntries_(session.location_id, data.journalType); },
  GET_PENDING_JOURNALS: function (data, session) { return getPendingAutoJournals_(session.location_id); },
  CONFIRM_AUTO_JOURNAL: function (data, session) { return confirmAutoJournal_(data.pendingId, data.value, session.user_id, session); },
  SUBMIT_JOURNAL_VALUE: function (data, session) { return submitJournalValue_({ organization_id: session.organization_id, location_id: session.location_id, workshop_id: data.workshopId, journal_type: data.journalType, definition_id: data.definitionId, value: data.value }, session.user_id, session); },
  GET_DEVIATIONS: function (data, session) { return getDeviations_(session.organization_id, data.onlyOpen); },
  // P0.6 — найдено при аудите: раньше здесь БЫЛО ЕЩЁ и CREATE_CORRECTIVE_ACTION,
  // размеченное на ТУ ЖЕ функцию completeCorrectiveAction_, что и COMPLETE_CORRECTIVE_ACTION
  // ниже — то есть действие с именем "создать" на самом деле пыталось ЗАКРЫТЬ
  // существующее действие по actionId, а не создать новое (своей функции создания
  // корректирующего действия вручную, в обход отклонения журнала, в проекте никогда не
  // было). Ни в одном фронтенде (Index.html/demo.html) оно не вызывается — снято как
  // мёртвый и вводящий в заблуждение дубликат, а не переименовано в скрытую новую
  // возможность (создание отдельного corrective action вручную — это НОВАЯ функциональность,
  // не входит в рамки P0-исправлений; если она нужна — отдельное решение с Денисом).
  COMPLETE_CORRECTIVE_ACTION: function (data, session) { return completeCorrectiveAction_(data.actionId, data.result, session.user_id, session); },
  GET_JOURNAL_DEFINITIONS: function (data, session) { return getJournalDefinitions_(session.organization_id, session.location_id); },
  CREATE_JOURNAL_DEFINITION: function (data, session) { return createJournalDefinition_({ organization_id: session.organization_id, location_id: data.location_id, workshop_id: data.workshop_id, journal_type: data.journal_type, название: data.название, периодичность: data.периодичность, роль_ответственная: data.роль_ответственная, equipment_id: data.equipment_id, мин_норма: data.мин_норма, макс_норма: data.макс_норма, мин_предупреждение: data.мин_предупреждение, макс_предупреждение: data.макс_предупреждение, единица: data.единица, source_type: data.source_type, source_document: data.source_document, обязательность: data.обязательность, тип_ответа: data.тип_ответа, текст_вопроса: data.текст_вопроса, ожидаемый_ответ: data.ожидаемый_ответ, уровень_при_нет: data.уровень_при_нет, напомнить_за_минут: data.напомнить_за_минут }, session.user_id, session); },
  CREATE_JOURNAL_TRIGGER: function (data, session) { return createJournalTrigger_(data || {}, session.user_id, session); },
  GET_JOURNAL_TRIGGERS: function (data, session) { return getJournalTriggers_(session.organization_id, session.location_id, data && data.definitionId); },
  UPDATE_JOURNAL_DEFINITION: function (data, session) { return updateJournalDefinition_(data.definitionId, data.patch, session); },
  COMPLETE_CHECKLIST: function (data, session) { return addJournalEntry_(session.location_id, data.checklistType, data.result, session.user_id, session.organization_id, '', '', session.cascade_id); },

  // ---------- Цеха/оборудование ----------
  GET_WORKSHOPS: function (data, session) { return getWorkshops_(session.location_id); },
  CREATE_WORKSHOP: function (data, session) { return createWorkshop_({ location_id: session.location_id, название: data.название, тип: data.тип, цвет: data.цвет, описание: data.описание, ответственный_id: data.ответственный_id }, session.user_id); },
  UPDATE_WORKSHOP: function (data, session) { return updateWorkshop_(data.workshopId, data.patch, session); },
  GET_WORKSHOP_COLOR_PRESET: function () { return getWorkshopColorPreset_(); },
  GET_EQUIPMENT: function (data, session) { return getEquipment_(session.location_id, data.workshopId); },
  CREATE_EQUIPMENT: function (data, session) { return createEquipment_({ location_id: session.location_id, workshop_id: data.workshopId, название: data.название, тип: data.тип, номер: data.номер, мин_температура: data.минТемпература, макс_температура: data.максТемпература, дата_проверки: data.датаПроверки, следующая_проверка: data.следующаяПроверка, ответственный_id: data.ответственныйId }, session.user_id, session); },
  UPDATE_EQUIPMENT: function (data, session) { return updateEquipment_(data.equipmentId, data.patch, session); },
  // Раунд 11 — честно указано в отчёте раунда 10 ("оборудование — без истории
  // обслуживания и авторасчёта просрочки ТО"). getEquipment_ теперь сам добавляет
  // просрочено/дней_до_проверки на каждую строку (см. Equipment.gs), здесь — сам журнал.
  LOG_EQUIPMENT_MAINTENANCE: function (data, session) { return logEquipmentMaintenance_({ equipmentId: data.equipmentId, дата: data.дата, тип: data.тип, описание: data.описание, следующая_проверка: data.следующаяПроверка }, session.user_id, session); },
  GET_EQUIPMENT_MAINTENANCE_LOG: function (data, session) { return getEquipmentMaintenanceLog_(data.equipmentId, session); },

  // ---------- Экономика/отчёты/AI ----------
  GET_ECONOMICS: function (data, session) { return recalcEconomics_(session.organization_id, session.location_id); },
  GET_MANAGEMENT_ECONOMICS: function (data, session) { return getManagementEconomics_(session.organization_id, resolveLocationScope_(session, data.locationId), data.dateFrom, data.dateTo); },
  GET_LOSS_ENGINE: function (data, session) { return getLossEngine_(session.organization_id, resolveLocationScope_(session, data.locationId), data.dateFrom, data.dateTo); },
  GET_MANAGEMENT_ACTIONS: function (data, session) { return getManagementActions_(session.organization_id, resolveLocationScope_(session, data.locationId), data.dateFrom, data.dateTo); },
  CALCULATE_DEMAND_PLAN: function (data, session) { return calculateDemandPlan_(data || {}, session); },
  CREATE_DEMAND_PLAN: function (data, session) { return createDemandPlan_(data || {}, session); },
  GET_DEMAND_PLAN: function (data, session) { return getDemandPlan_(data.planId, session); },
  RELEASE_DEMAND_PURCHASES: function (data, session) { return releaseDemandPurchases_(data.planId, session); },
  RELEASE_DEMAND_PRODUCTION: function (data, session) { return releaseDemandProduction_(data.planId, session); },
  GET_REPORTS: function (data, session) { return getReports_(session.organization_id, data.тип); },
  GENERATE_DAILY_REPORT: function (data, session) { return generateDailyReport_(session.organization_id, session.location_id); },
  // Раунд 11 — честно указано в отчёте раунда 10 ("история/график экономики во
  // времени, недельные/месячные отчёты, экспорт в файл"). Недельный/месячный отчёт
  // теперь обогащён настоящим P&L/ABC-анализом (SalesAnalytics.gs) — раньше такие
  // данные структурно не могли существовать без модели продаж (см. Sales.gs).
  GENERATE_WEEKLY_REPORT: function (data, session) { return generateWeeklyReport_(session.organization_id, session.location_id, data.dateFrom, data.dateTo); },
  GENERATE_MONTHLY_REPORT: function (data, session) { return generateMonthlyReport_(session.organization_id, session.location_id, data.dateFrom, data.dateTo); },
  GET_PNL: function (data, session) { return getPnl_(session.organization_id, resolveLocationScope_(session, data.locationId), data.dateFrom, data.dateTo); },
  GET_ABC_ANALYSIS: function (data, session) { return getAbcAnalysis_(session.organization_id, resolveLocationScope_(session, data.locationId), data.dateFrom, data.dateTo); },
  GET_CALCULATIONS_HISTORY: function (data, session) { return getCalculationsHistory_(session.organization_id, resolveLocationScope_(session, data.locationId), data.dateFrom, data.dateTo); },
  // Раунд 11, продолжение («Доделай оставшиеся 4 пункта») — операционные расходы (Expenses.gs),
  // без которых GET_PNL был структурно ограничен валовой прибылью (см. докстринг Expenses.gs).
  CREATE_EXPENSE: function (data, session) { return createExpense_(data, session.user_id, session); },
  CREATE_BUDGET_PLAN: function (data, session) { return createBudgetPlan_(data || {}, session); },
  GET_BUDGET_PLANS: function (data, session) { return getBudgetPlans_(data || {}, session); },
  RECORD_CASH_TRANSACTION: function (data, session) { return recordCashTransaction_(data || {}, session); },
  GET_CASH_FLOW: function (data, session) { return getCashFlow_(data || {}, session); },
  GET_PLAN_FACT: function (data, session) { return getPlanFact_(data || {}, session); },
  GET_CASH_FORECAST: function (data, session) { return getCashForecast_(data || {}, session); },
  GET_EXPENSES: function (data, session) { return getExpenses_(session.organization_id, resolveLocationScope_(session, data.locationId), data.dateFrom, data.dateTo); },
  GET_AI_RECOMMENDATIONS: function (data, session) { return getAiRecommendations_(session.organization_id, session.location_id); },

  // ---------- Уведомления ----------
  GET_NOTIFICATIONS: function (data, session) { return getNotifications_(session.location_id, data.onlyUnread); },
  MARK_NOTIFICATION_READ: function (data, session) { return markNotificationRead_(data.notificationId, session); },
  // Раунд 11 — data.locationId необязателен (см. getNotificationSettings_): не передан —
  // все настройки организации разом (прежнее поведение), '' — только org-wide, конкретный
  // ID — только настройки этой точки. Честно указано в отчёте раунда 10 ("без выбора
  // конкретной точки").
  // Внешний P0-аудит, п.3 — явно переданный data.locationId (не пустая строка "org-wide" и
  // не undefined "без фильтра") теперь проверяется на принадлежность session.allowed_locations
  // до использования — см. assertLocationAllowed_ (Auth.gs).
  GET_NOTIFICATION_SETTINGS: function (data, session) { if (data.locationId) assertLocationAllowed_(session, data.locationId, 'LOCATION_SCOPE'); return getNotificationSettings_(session.organization_id, data.locationId); },
  UPDATE_NOTIFICATION_SETTINGS: function (data, session) { return updateNotificationSetting_(session.organization_id, data.locationId || '', data.type, data.patch, session); },

  // ---------- План-меню (банкеты) ----------
  GET_PLAN_MENU_EVENTS: function (data, session) { return getPlanMenuEvents_(session.location_id); },
  CREATE_PLAN_MENU_EVENT: function (data, session) { return createPlanMenuEvent_({ organization_id: session.organization_id, location_id: session.location_id, название: data.название, дата: data.дата, время: data.время, гостей: data.гостей, ответственный_id: data.ответственный_id }, session.user_id); },
  // РАУНД 10: раньше getPlanMenuItems_() существовала, но не была подключена ни к какому
  // действию — фронтенд не мог получить список позиций уже созданного мероприятия обратно
  // ни при каких условиях. Подключено сюда, тот же модуль 'plan_menu', что и остальные
  // действия План-меню.
  GET_PLAN_MENU_ITEMS: function (data, session) { return getPlanMenuItems_(data.eventId, session); },
  ADD_PLAN_MENU_ITEM: function (data, session) { return addPlanMenuItem_(data.eventId, data.dishId, data.порцийНаГостя, session.user_id, session); },
  UPDATE_PLAN_MENU_GUESTS: function (data, session) { return updatePlanMenuGuests_(data.eventId, data.гостей, session.user_id, session); },
  CALC_PLAN_MENU_NEEDS: function (data, session) { return calcPlanMenuNeeds_(data.eventId, session); },
  GENERATE_PLAN_MENU_PURCHASE_REQUESTS: function (data, session) { return generatePlanMenuPurchaseRequests_(data.eventId, session.user_id, session); },

  // ---------- Бэкап ----------
  GET_BACKUPS: function () { return getBackups_(); },
  CREATE_BACKUP: function (data, session) { return createBackup_(session.user_id); },

  // ---------- Задачи (Секондарные фичи, раунд 1 — Архитектура v4 §6) ----------
  CREATE_TASK: function (data, session) { return createTask_({ organizationId: session.organization_id, locationId: session.location_id, type: data.type, title: data.title, description: data.description, responsibleRole: data.responsibleRole, responsibleId: data.responsibleId, priority: data.priority, dueAt: data.dueAt, userId: session.user_id, session: session }); },
  GET_TASKS: function (data, session) { return getTasks_(session.organization_id, session.location_id, { type: data.type, status: data.status }); },
  COMPLETE_TASK: function (data, session) { return completeTask_(data.taskId, data.result, session.user_id, session); },

  // Секондарные фичи, раунд 3 (Архитектура v4 §8) — Лабораторный модуль v2.
  CREATE_LAB_TEST: function (data, session) { return createLabTest_({ organizationId: session.organization_id, locationId: session.location_id, workshopId: data.workshopId, definitionId: data.definitionId, targetType: data.targetType, targetId: data.targetId, targetName: data.targetName, productId: data.productId, lotId: data.lotId, productionId: data.productionId, recipeId: data.recipeId, hazardId: data.hazardId, ccpId: data.ccpId, testType: data.testType, lab: data.lab, protocol: data.protocol, sampleDate: data.sampleDate, resultDate: data.resultDate, nextDate: data.nextDate, result: data.result, conclusion: data.conclusion, responsibleRole: data.responsibleRole, responsibleId: data.responsibleId, params: data.params, userId: session.user_id, session: session }); },
  GET_LAB_TESTS: function (data, session) { return getLabTests_(session.organization_id, session.location_id, { result: data.result, definitionId: data.definitionId }); },
  CREATE_LAB_TEST_DEFINITION: function (data, session) { return createLabTestDefinition_({ organization_id: session.organization_id, location_id: data.locationId, workshop_id: data.workshopId, target_type: data.targetType, target_id: data.targetId, target_name: data.targetName, тип_исследования: data.testType, периодичность_дней: data.periodDays, роль_ответственная: data.responsibleRole, ответственный_id: data.responsibleId, дни_на_повтор_при_fail: data.retestDaysOnFail, source_document: data.sourceDocument, следующая_дата: data.nextDate }, session.user_id, session); },
  GET_LAB_TEST_DEFINITIONS: function (data, session) { return getLabTestDefinitions_(session.organization_id, session.location_id); },
  UPDATE_LAB_TEST_DEFINITION: function (data, session) { return updateLabTestDefinition_(data.definitionId, data.patch, session); },

  // Секондарные фичи, раунд 4 (Архитектура v4 §7) — версионирование ППК.
  CREATE_PPK_VERSION: function (data, session) { return createPpkVersion_({ organizationId: session.organization_id, effectiveFrom: data.effectiveFrom, data: data.data, userId: session.user_id, session: session }); },
  GET_PPK_VERSIONS: function (data, session) { return getPpkVersions_(session.organization_id, { status: data.status }); },
  GET_CURRENT_PPK: function (data, session) { return getCurrentPpk_(session.organization_id); },
  UPDATE_PPK_VERSION: function (data, session) { return updatePpkVersion_(data.ppkId, { data: data.data, effectiveFrom: data.effectiveFrom }, session); },
  SUBMIT_PPK_VERSION_FOR_REVIEW: function (data, session) { return submitPpkVersionForReview_(data.ppkId, session); },
  APPROVE_PPK_VERSION: function (data, session) { return approvePpkVersion_(data.ppkId, session); },
  ARCHIVE_PPK_VERSION: function (data, session) { return archivePpkVersion_(data.ppkId, session); },
  GET_PPK_GENERATOR_CONTEXT: function (data, session) { return getPpkGeneratorContext_(session, data || {}); },
  GENERATE_PPK: function (data, session) { return generatePpk_(session, data || {}); },
  GET_PPK_MODEL: function (data, session) { return getPpkModel_(session, data || {}); },
  GET_PPK_FLOW: function (data, session) { var m=getPpkModel_(session,data||{}); return {processes:m.processes,stages:m.stages,flows:m.flows}; },
  BUILD_PRODUCT_FLOW: function (data, session) { return buildProductFlow_(session, {productId:data.productId,locationId:session.location_id}); },
  BUILD_HAZARD_ANALYSIS: function (data, session) { return buildPpkHazardAnalysis_(session, {ppkId:data.ppkId,locationId:session.location_id}); },
  GET_PPK_HAZARDS: function (data, session) { return getPpkHazards_(session,data||{}); },
  CONFIRM_PPK_HAZARD: function (data, session) { return confirmPpkHazard_(session,data||{}); },
  GET_PPK_CONTROLS: function (data, session) { return getPpkControls_(session,data||{}); },
  GENERATE_PPK_CONTROLS: function (data, session) { return generatePpkControls_(session,{ppkId:data.ppkId,locationId:session.location_id}); },
  CREATE_PPK_CONTROL: function (data, session) { var c=_ppkCtx_(session,session.location_id), p=findOne_('PPK_VERSIONS','ppk_id',data.ppkId); assertOwnedByOrg_(session,p,'PPK_VERSIONS:'+data.ppkId); if(p.status!=='DRAFT') throw new Error('Контроль можно создать только в черновике ППК.'); _ppkAssertRef_(session,'PPK_PROCESSES','process_id',data.processId||'',data.ppkId,'PPK_PROCESSES:'+(data.processId||'')); _ppkAssertRef_(session,'PPK_FLOW_STAGES','stage_id',data.stageId||'',data.ppkId,'PPK_FLOW_STAGES:'+(data.stageId||'')); _ppkAssertRef_(session,'PRODUCTS','product_id',data.productId||'',data.ppkId,'PRODUCTS:'+(data.productId||'')); _ppkAssertRef_(session,'HAZARD_ANALYSIS','hazard_id',data.hazardId||'',data.ppkId,'HAZARD_ANALYSIS:'+(data.hazardId||'')); var row={control_id:_ppkId_('PPK_CONTROLS'),ppk_id:data.ppkId,organization_id:session.organization_id,location_id:c.locationId,process_id:data.processId||'',stage_id:data.stageId||'',product_id:data.productId||'',hazard_id:data.hazardId||'',point_type:data.pointType||'PRP',control_name:data.controlName||'',purpose:data.purpose||'',risk_description:data.riskDescription||'',critical_limit_ref:'',monitoring_parameter:data.monitoringParameter||'',monitoring_method:data.monitoringMethod||'',frequency:data.frequency||'',responsible_role:data.responsibleRole||'',journal_definition_id:'',corrective_action:data.correctiveAction||'',verification_method:data.verificationMethod||'',status:'DRAFT',human_confirmed:false,confirmed_by:'',confirmed_at:'',source:'USER',created_at:nowIso_()}; if(PPK_POINT_TYPES.indexOf(row.point_type)<0) throw new Error('Недопустимый pointType.'); insertRow_('PPK_CONTROLS',row); auditLog_(session.user_id,'Создана контрольная точка ППК','PPK_CONTROLS:'+row.control_id,'',JSON.stringify(row),'success',session.cascade_id); return row; },
  CONFIRM_PPK_CONTROL: function (data, session) { return confirmPpkControl_(session,data||{}); },
  CREATE_PPK_CRITICAL_LIMIT: function (data, session) { return createPpkCriticalLimit_(session,data||{}); },
  APPROVE_PPK_CRITICAL_LIMIT: function (data, session) { return approvePpkCriticalLimit_(session,data||{}); },
  GENERATE_PPK_JOURNALS: function (data, session) { return generatePpkJournals_(session,data||{}); },
  GET_PPK_COMPLIANCE: function (data, session) { return getPpkCompliance_(session,data||{}); },
  GET_PPK_VERIFICATION: function (data, session) { return getPpkVerification_(session,data||{}); },
  CREATE_PPK_VERIFICATION: function (data, session) { return createPpkVerification_(session,data||{}); },
  COMPLETE_PPK_VERIFICATION: function (data, session) { return completePpkVerification_(session,data||{}); },
  GET_PPK_REVIEWS: function (data, session) { return getPpkReviews_(session,data||{}); },
  REQUEST_PPK_REVIEW: function (data, session) { return requestPpkReview_(session,data||{}); },
  RESOLVE_PPK_REVIEW: function (data, session) { return resolvePpkReview_(session,data||{}); },
  GET_PPK_IMPACT_ANALYSIS: function (data, session) { return getPpkImpactAnalysis_(session,data||{}); },
  RECORD_PPK_CHANGE: function (data, session) { return recordPpkChange_(session,data||{}); },
  GET_PPK_TRACEABILITY: function (data, session) { return getPpkTraceability_(session,data||{}); },
  GET_PPK_TRACEABILITY_BY_PRODUCT: function (data, session) { return getPpkTraceabilityByProduct_(session,data||{}); },
  GET_UNIFIED_BATCH_TRACEABILITY: function (data, session) { return getUnifiedBatchTraceability_(data||{},session); },
  GET_UNIFIED_SALE_TRACEABILITY: function (data, session) { return getUnifiedSaleTraceability_(data||{},session); },
  GET_UNIFIED_PRODUCTION_TRACEABILITY: function (data, session) { return getUnifiedProductionTraceability_(data||{},session); },
  RUN_TRACEABILITY_RECONCILIATION: function (data, session) { return runTraceabilityReconciliation_(data||{},session); },
  GET_TRACEABILITY_SUMMARY: function (data, session) { return getTraceabilitySummary_(data||{},session); },
  GET_TRACEABILITY_RUN: function (data, session) { return getTraceabilityRun_(data||{},session); },
  GET_PERIOD_CLOSURE_SUMMARY: function (data, session) { return getPeriodClosureSummary_(data||{},session); },
  RUN_PERIOD_CLOSING_CHECK: function (data, session) { return runPeriodClosingCheck_(data||{},session); },
  GET_PERIOD_CLOSURE: function (data, session) { return getPeriodClosure_(data||{},session); },
  APPROVE_PERIOD_CLOSURE: function (data, session) { return approvePeriodClosure_(data||{},session); },
  CLOSE_PERIOD: function (data, session) { return closePeriod_(data||{},session); },
  GET_PERIOD_REOPEN_REQUESTS: function (data, session) { return getPeriodReopenRequests_(data||{},session); },
  VERIFY_AUDIT_EVIDENCE: function (data, session) { return verifyAuditEvidence35_(data || {}, session); },
  GET_AUDIT_EVIDENCE: function (data, session) { return getAuditEvidence35_(data || {}, session); },
  SEAL_AUDIT_EVIDENCE: function (data, session) { return sealAuditEvidenceSnapshot35_(data || {}, session); },
  CREATE_COMPLIANCE_EVIDENCE_PACK: function (data, session) { return createComplianceEvidencePack_(data || {}, session); },
  GET_COMPLIANCE_EVIDENCE_PACK: function (data, session) { return getComplianceEvidencePack_(data || {}, session); },
  VERIFY_COMPLIANCE_EVIDENCE_PACK: function (data, session) { return verifyComplianceEvidencePack_(data || {}, session); },
  GET_COMPLIANCE_CONTROLS: function (data, session) { return getComplianceControls_(data || {}, session); },
  GET_COMPLIANCE_CONTROL: function (data, session) { return getComplianceControl_(data || {}, session); },
  GET_COMPLIANCE_MATRIX: function (data, session) { return runComplianceMatrix_(data || {}, session); },
  GET_COMPLIANCE_MATRIX_SUMMARY: function (data, session) { return getComplianceMatrixSummary_(data || {}, session); },
  CREATE_COMPLIANCE_CONTROL: function (data, session) { return createComplianceControl_(data || {}, session); },
  LINK_COMPLIANCE_CONTROL: function (data, session) { return linkComplianceControl_(data || {}, session); },
  GET_COMPLIANCE_COCKPIT: function (data, session) { return getComplianceCockpit_(data || {}, session); },
  GET_COMPLIANCE_COCKPIT_SUMMARY: function (data, session) { return getComplianceCockpitSummary_(data || {}, session); },
  GET_ENTERPRISE_BOARD_PACK: function (data, session) { return getEnterpriseBoardPack_(data || {}, session); },
  GET_ENTERPRISE_BOARD_PACKS: function (data, session) { return getEnterpriseBoardPacks_(data || {}, session); },
  CREATE_ENTERPRISE_BOARD_PACK: function (data, session) { return createEnterpriseBoardPack_(data || {}, session); },
  VERIFY_ENTERPRISE_BOARD_PACK: function (data, session) { return verifyEnterpriseBoardPack_(data || {}, session); },
  GET_KPI_METRIC_CATALOG: function (data, session) { return getKpiMetricCatalog_(session); },
  GET_KPI_TARGETS: function (data, session) { return getKpiTargets_(data || {}, session); },
  CREATE_KPI_TARGET: function (data, session) { return createKpiTarget_(data || {}, session); },
  RUN_KPI_VARIANCE: function (data, session) { return runKpiVariance_(data || {}, session); },
  GET_KPI_VARIANCES: function (data, session) { return getKpiVariances_(data || {}, session); },
  CREATE_KPI_ACTION: function (data, session) { return createKpiAction_(data || {}, session); },
  GET_KPI_ACTIONS: function (data, session) { return getKpiActions_(data || {}, session); },
  COMPLETE_KPI_ACTION: function (data, session) { return completeKpiAction_(data || {}, session); },
  GET_CAPA_CASES: function (data, session) { return getCapaCases_(data || {}, session); },
  GET_CAPA_CASE: function (data, session) { return getCapaCase_(data || {}, session); },
  CREATE_CAPA_CASE: function (data, session) { return createCapaCase_(data || {}, session); },
  CREATE_CAPA_ACTION: function (data, session) { return createCapaAction_(data || {}, session); },
  UPDATE_CAPA_CASE: function (data, session) { return updateCapaCase_(data || {}, session); },
  COMPLETE_CAPA_ACTION: function (data, session) { return completeCapaAction_(data || {}, session); },
  VERIFY_CAPA_CASE: function (data, session) { return verifyCapaCase_(data || {}, session); },
  RUN_CAPA_SLA: function (data, session) { return runCapaSla_(session, data && data.limit); },
  CREATE_PERIOD_REOPEN_REQUEST: function (data, session) { return createPeriodReopenRequest_(data||{},session); },
  APPROVE_PERIOD_REOPEN: function (data, session) { return approvePeriodReopen_(data||{},session); },
  REOPEN_PERIOD: function (data, session) { return reopenPeriod_(data||{},session); },
  GET_PPK_DOCUMENT: function (data, session) { return getPpkDocument_(session,data||{}); },
  GENERATE_PPK_DOCUMENT: function (data, session) { return generatePpkDocument_(session,data||{}); },

  // Секондарные фичи, раунд 5 (Архитектура v4 §12 п.5) — Нормативная база / HACCP Engine.
  CREATE_RULE: function (data, session) { return createRule_({ organizationId: session.organization_id, ruleType: data.ruleType, scopeType: data.scopeType, scopeId: data.scopeId, minValue: data.minValue, maxValue: data.maxValue, unit: data.unit, sourceDocument: data.sourceDocument, effectiveFrom: data.effectiveFrom, userId: session.user_id, session: session }); },
  GET_RULES: function (data, session) { return getRules_(session.organization_id, { ruleType: data.ruleType, scopeType: data.scopeType, status: data.status }); },
  GET_ACTIVE_RULE: function (data, session) { return getActiveRule_(session.organization_id, data.ruleType, data.scopeType, data.scopeId, data.asOfDate); },
  GET_RULE_HISTORY: function (data, session) { return getRuleHistory_(session.organization_id, data.ruleType, data.scopeType, data.scopeId); },
  ARCHIVE_RULE: function (data, session) { return archiveRule_(data.ruleId, session); },

  // Секондарные фичи, раунд 6 (Архитектура v4 §3, §12 п.6) — интеграции (адаптерная
  // архитектура + честные заглушки).
  // Раунд 11, продолжение: маскируем apiLogin_enc (и легаси apiLogin) перед
  // отправкой клиенту — см. докстринг _maskIntegrationForClient_ в Integrations.gs.
  GET_INTEGRATIONS: function (data, session) { return getIntegrations_(session.organization_id).map(_maskIntegrationForClient_); },
  UPDATE_INTEGRATION_SETTINGS: function (data, session) { return updateIntegrationSettings_(data.integrationId, data.settings, session); },
  ENABLE_INTEGRATION: function (data, session) { return enableIntegration_(data.integrationId, session); },
  DISABLE_INTEGRATION: function (data, session) { return disableIntegration_(data.integrationId, session); },
  TEST_INTEGRATION_CONNECTION: function (data, session) { var i = findOne_('INTEGRATIONS','integration_id',data.integrationId); if (i && (i.system === 'r_keeper' || i.system === '1c')) return testExternalRestIntegration_(data.integrationId, session); return testIntegrationConnection_(data.integrationId, session); },
  PULL_INTEGRATION_DATA: function (data, session) { var i = findOne_('INTEGRATIONS','integration_id',data.integrationId); if (i && (i.system === 'r_keeper' || i.system === '1c')) return pullExternalRestIntegration_(data.integrationId, session); return pullIntegration_(data.integrationId, session); },
  PUSH_INTEGRATION_DATA: function (data, session) { var i = findOne_('INTEGRATIONS','integration_id',data.integrationId); if (i && (i.system === 'r_keeper' || i.system === '1c')) return pushExternalRestIntegration_(data.integrationId, data.payload, session); return pushIntegration_(data.integrationId, data.payload, session); },
  CREATE_INTEGRATION_MAPPING: function (data, session) { return createIntegrationMapping_({ integrationId: data.integrationId, externalId: data.externalId, externalType: data.externalType, internalType: data.internalType, internalId: data.internalId }, session); },
  GET_INTEGRATION_MAPPINGS: function (data, session) { return getIntegrationMappings_(data.integrationId, session); },
  TEST_TELEGRAM_CONNECTION: function (data, session) { return testTelegramConnection_(session, data.chatId); },
  GET_SYSTEM_HEALTH: function (data, session) { return getSystemHealth_(session); },
  GET_CRITICAL_INCIDENTS: function (data, session) { return getCriticalIncidents_(session, data || {}); },
  CREATE_CRITICAL_INCIDENT: function (data, session) { return createCriticalIncident_(data || {}, session); },
  RESOLVE_CRITICAL_INCIDENT: function (data, session) { return resolveCriticalIncident_(data || {}, session); },
  GET_QUARANTINE_CASES: function (data, session) { return getQuarantineCases_(session, data || {}); },
  RELEASE_QUARANTINE: function (data, session) { return releaseQuarantine_(data || {}, session); },
  GET_CRITICAL_INCIDENT_DASHBOARD: function (data, session) { return getCriticalIncidentDashboard_(session); },
  RESOLVE_RECOVERY_MANUALLY: function (data, session) { return resolveRecoveryManually_(data.cascadeId, data.note, session); },
  // Раунд 11 — РЕАЛЬНАЯ (не заглушка) синхронизация продаж с iiko, ТОЛЬКО для system
  // === 'iiko' (см. Integrations.gs::syncIikoSales_ докстринг — НЕ проверено вживую
  // против настоящего аккаунта iiko, формат ответа iikoCloud API — лучшее
  // предположение). Для r_keeper остаётся честная заглушка PULL_INTEGRATION_DATA выше
  // (нет универсального публичного API — нужна документация конкретной инсталляции).
  SYNC_IIKO_SALES: function (data, session) { return syncIikoSales_(data.integrationId, data.dateFrom, data.dateTo, session); },

  // Секондарные фичи, раунд 7 (Архитектура v4 §5, §12 п.7) — ЦЕХ AI, чат-мок поверх
  // уже существующих действий (см. AiOrchestrator.gs — принцип "AI действует правами
  // спросившего" и стейтлес-подтверждение критических операций, без реального LLM).
  AI_COPILOT: function (data, session) { return getOperationsCopilot_(data || {}, session); },
  AI_CHAT: function (data, session) { return processAiChatMessage_(data.message, data.confirm, session); },

  // Раунд 8 — ТЗ «Справочник продуктов + Декларации соответствия + Документы продукта».
  // Product Master (глобальный + организационный).
  GET_GLOBAL_PRODUCTS: function (data, session) { return getGlobalProducts_({ category: data.category, q: data.q, includeArchived: data.includeArchived }); },
  GET_GLOBAL_PRODUCT: function (data, session) { return getGlobalProductById_(data.globalProductId); },
  CREATE_GLOBAL_PRODUCT: function (data, session) { return createGlobalProduct_(data, session.user_id); },
  UPDATE_GLOBAL_PRODUCT: function (data, session) { return updateGlobalProduct_(data.globalProductId, data.patch, session.user_id, data.reason); },
  SEARCH_PRODUCTS: function (data, session) { return searchProducts_(session.organization_id, data.q); },
  GET_PRODUCT_CARD: function (data, session) { return getProductCard_(data.productId, session); },
  SET_PRODUCT_NUTRIENTS: function (data, session) { return updateGlobalProduct_(data.globalProductId, data.nutrients, session.user_id, 'обновление пищевой ценности'); },
  SET_PRODUCT_ALLERGENS: function (data, session) { return setProductAllergen_(data.globalProductId, data.allergen, data.source, data.verified, data.notes, session.user_id); },
  SET_PRODUCT_SHELF_LIFE: function (data, session) { return setProductShelfLife_(data.globalProductId, data.storageMode, data.rawText, data.duration, data.durationUnit, data.source, data.verified, session.user_id); },
  SET_PRODUCT_SPOILAGE_SIGNS: function (data, session) { return setProductSpoilageSign_(data.globalProductId, data.signText, data.source, data.verified, session.user_id); },
  GET_PRODUCT_VERSIONS: function (data, session) { return getProductVersions_(data.entityType || 'GLOBAL_PRODUCTS', data.entityId); },
  LINK_PRODUCT_TO_GLOBAL: function (data, session) { return linkProductToGlobal_(data.productId, data.globalProductId, session.user_id, session); },

  // Поставщики (закрытие пробела — таблица SUPPLIERS существовала без CRUD, см. Suppliers.gs).
  CREATE_SUPPLIER: function (data, session) { return createSupplier_({ organizationId: session.organization_id, название: data.название, контакты: data.контакты }, session.user_id, session); },
  GET_SUPPLIERS: function (data, session) { return getSuppliers_(session.organization_id); },
  UPDATE_SUPPLIER: function (data, session) { return updateSupplier_(data.supplierId, data.patch, session.user_id, session); },

  // Приёмка — проверка соответствия (ТЗ §15), под тем же модулем, что и сам приход.
  CHECK_RECEIPT_COMPLIANCE: function (data, session) { return checkReceiptCompliance_(session.organization_id, data.productId, data.supplierId, session); },

  // Декларации соответствия.
  CREATE_DECLARATION: function (data, session) { return createDeclaration_({ organizationId: session.organization_id, productId: data.productId, supplierId: data.supplierId, registrationNumber: data.registrationNumber, documentType: data.documentType, status: data.status, issueDate: data.issueDate, effectiveFrom: data.effectiveFrom, effectiveTo: data.effectiveTo, applicant: data.applicant, manufacturer: data.manufacturer, manufacturerCountry: data.manufacturerCountry, productName: data.productName, productGroup: data.productGroup, technicalRegulation: data.technicalRegulation, conformityScheme: data.conformityScheme, certificationBody: data.certificationBody, registrationAuthority: data.registrationAuthority, documentUrl: data.documentUrl }, session.user_id, session); },
  GET_DECLARATIONS: function (data, session) { return getDeclarations_(session.organization_id, { status: data.status, productId: data.productId, supplierId: data.supplierId }); },
  GET_DECLARATION: function (data, session) { return getDeclarationById_(data.declarationId, session); },
  UPDATE_DECLARATION: function (data, session) { return updateDeclaration_(data.declarationId, data.patch, session.user_id, session); },
  VERIFY_DECLARATION: function (data, session) { return verifyDeclaration_(data.declarationId, { source: data.source, url: data.url, method: data.method, result: data.result, resultText: data.resultText }, session.user_id, session); },
  SET_DECLARATION_STATUS: function (data, session) { return setDeclarationStatus_(data.declarationId, data.status, session.user_id, session); },
  LINK_DECLARATION_PRODUCT: function (data, session) { return linkDeclarationProduct_(data.declarationId, data.productId, data.relationType, session.user_id, session); },
  UNLINK_DECLARATION_PRODUCT: function (data, session) { return unlinkDeclarationProduct_(data.linkId, session.user_id, session); },

  // Документы.
  UPLOAD_DECLARATION_FILE: function (data, session) { return uploadDeclarationFile_(data.declarationId, data.base64Data, data.fileName, data.mimeType, session.user_id, session); },
  UPLOAD_SUPPLIER_DOCUMENT: function (data, session) { return uploadSupplierDocument_({ organizationId: session.organization_id, supplierId: data.supplierId, productId: data.productId, declarationId: data.declarationId, docType: data.docType, base64Data: data.base64Data, fileName: data.fileName, mimeType: data.mimeType }, session.user_id, session); },
  GET_SUPPLIER_DOCUMENTS: function (data, session) { return getSupplierDocuments_(session.organization_id, { supplierId: data.supplierId, productId: data.productId, declarationId: data.declarationId, docType: data.docType }); },

  // OCR (ТЗ §11).
  RUN_DECLARATION_OCR: function (data, session) { return runDeclarationOcr_(data.declarationId, data.base64Image, data.mimeType, session.organization_id, session.user_id, session); },
  RUN_PRODUCT_LABEL_OCR: function (data, session) { return recognizeProductLabelOcr_(data.base64Image, data.mimeType, session.user_id, session); },
  CREATE_GLOBAL_PRODUCT_FROM_OCR: function (data, session) { return createGlobalProductFromOcr_(data.ocrResult, session.user_id, session); },
  CREATE_PRODUCT_FROM_OCR: function (data, session) { return createOrganizationProductFromOcr_(data.ocrResult, data, session); },
  MATCH_PRODUCT_FROM_LABEL: function (data, session) { return matchProductFromLabelApi_(data.ocrResult, session); },
  GET_OCR_RESULT: function (data, session) { return getOcrResult_(data.ocrId, session); },
  CONFIRM_OCR_RESULT: function (data, session) { return confirmOcrResult_(data.ocrId, data.confirmedFields, session.user_id, session); },

  // Compliance-профили/регуляторные источники/дашборд/режим блокировки.
  CREATE_COMPLIANCE_PROFILE: function (data, session) { return createComplianceProfile_({ organizationId: data.global ? '' : session.organization_id, category: data.category, productType: data.productType, requirements: data.requirements, blockMode: data.blockMode }, session.user_id, session); },
  GET_COMPLIANCE_PROFILES: function (data, session) { return getComplianceProfiles_(session.organization_id); },
  UPDATE_COMPLIANCE_PROFILE: function (data, session) { return updateComplianceProfile_(data.profileId, data.patch, session.user_id, session); },
  SET_COMPLIANCE_BLOCK_MODE: function (data, session) { return setComplianceBlockMode_(session.organization_id, data.mode, session.user_id, session); },
  GET_COMPLIANCE_BLOCK_MODE: function (data, session) { return { block_mode: getComplianceBlockMode_(session.organization_id) }; },
  CREATE_REGULATORY_SOURCE: function (data, session) { return createRegulatorySource_(data, session.user_id); },
  GET_REGULATORY_SOURCES: function (data, session) { return getRegulatorySources_(); },
  UPDATE_REGULATORY_SOURCE: function (data, session) { return updateRegulatorySource_(data.sourceId, data.patch, session.user_id); },
  GET_COMPLIANCE_DASHBOARD: function (data, session) { return getComplianceDashboard_(session.organization_id); },

  // Импорт продуктов (ТЗ §27-§30). rows — уже разобранный на фронтенде JSON (см. ProductImport.gs докстринг за границей реализации).
  IMPORT_PRODUCTS_PREVIEW: function (data, session) { return importProductsPreview_(session.organization_id, data.rows, data.fileName, session.user_id); },
  IMPORT_PRODUCTS_COMMIT: function (data, session) { return importProductsCommit_(data.importId, session.user_id, session); },
  GET_IMPORT_BATCHES: function (data, session) { return getImportBatches_(session.organization_id); },
  GET_IMPORT_ROWS: function (data, session) { return getImportRows_(data.importId, data.statusFilter, session); },
  RESOLVE_DUPLICATE_CANDIDATE: function (data, session) { return resolveDuplicateCandidate_(data.rowId, data.decision, session.user_id, session); },
  CREATE_MANAGEMENT_ACTION: function (data, session) { return createManagementAction_(data || {}, session); },
  GET_MANAGEMENT_ACTION_BACKLOG: function (data, session) { return getManagementActions42_(data || {}, session); },
  COMPLETE_MANAGEMENT_ACTION: function (data, session) { return completeManagementAction_(data || {}, session); },
  RUN_MANAGEMENT_ORCHESTRATOR: function (data, session) { return orchestrateManagementActions42_(data || {}, session); },
  CREATE_WORKFORCE_PLAN: function (data, session) { return createWorkforcePlan_(data || {}, session); },
  GET_WORKFORCE_PLANS: function (data, session) { return getWorkforcePlans_(data || {}, session); },
  GET_WORKFORCE_CAPACITY: function (data, session) { return getWorkforceCapacity_(data || {}, session); },
  RUN_SUPPLIER_SCORECARDS: function (data, session) { return runSupplierScorecards_(data || {}, session); },
  CREATE_PROCUREMENT_ACTION: function (data, session) { return createProcurementAction_(data || {}, session); },
  CREATE_INVENTORY_POLICY: function (data, session) { return createInventoryPolicy_(data || {}, session); },
  GET_INVENTORY_SIGNALS: function (data, session) { return getInventorySignals_(data || {}, session); },
  CREATE_CAPACITY_PLAN: function (data, session) { return createCapacityPlan_(data || {}, session); },
  GET_CAPACITY_OVERVIEW: function (data, session) { return getCapacityOverview_(data || {}, session); },
  GET_MENU_ENGINEERING: function (data, session) { return getMenuEngineering_(data || {}, session); },
  CREATE_SCENARIO_PLAN: function (data, session) { return createScenarioPlan_(data || {}, session); },
  RUN_SCENARIO: function (data, session) { return runScenario_(data || {}, session); },
  CREATE_EXECUTION_PLAN: function (data, session) { return createExecutionPlan_(data || {}, session); },
  ADD_EXECUTION_ITEM: function (data, session) { return addExecutionItem_(data || {}, session); },
  GET_EXECUTION_PLANS: function (data, session) { return getExecutionPlan_(data || {}, session); },
  GET_ENTERPRISE_COMMAND_CENTER: function (data, session) { return getEnterpriseCommandCenter_(data || {}, session); },
  GET_CUSTOMER_SALES_INTELLIGENCE: function (data, session) { return getCustomerSalesIntelligence61_(data || {}, session); },
  RUN_DEMAND_SENSING: function (data, session) { return runDemandSensing62_(data || {}, session); },
  RUN_MATERIAL_REQUIREMENTS: function (data, session) { return runMaterialRequirements63_(data || {}, session); },
  GET_COST_TO_SERVE: function (data, session) { return getCostToServe64_(data || {}, session); },
  GET_CHANNEL_MARGINS: function (data, session) { return getChannelMargin65_(data || {}, session); },
  GET_DYNAMIC_MENU_SIGNALS: function (data, session) { return getDynamicMenuSignals66_(data || {}, session); },
  GET_LABOR_FORECAST: function (data, session) { return getLaborForecast67_(data || {}, session); },
  GET_PROCUREMENT_FORECAST: function (data, session) { return getProcurementForecast68_(data || {}, session); },
  GET_ENTERPRISE_FORECAST: function (data, session) { return getEnterpriseForecast69_(data || {}, session); },
  GET_DIGITAL_TWIN_V2: function (data, session) { return getDigitalTwinV270_(data || {}, session); },
  RUN_AUTONOMOUS_PLANNING: function (data, session) { return runAutonomousPlanning71_(data || {}, session); },
  GET_PLANNING_PROPOSALS: function (data, session) { return getPlanningProposals72_(data || {}, session); },
  CREATE_PLANNING_APPROVAL_GATE: function (data, session) { return createPlanningApprovalGate73_(data || {}, session); },
  APPROVE_PLANNING_GATE: function (data, session) { return approvePlanningGate74_(data || {}, session); },
  REJECT_PLANNING_GATE: function (data, session) { return rejectPlanningGate74_(data || {}, session); },
  RECORD_PLANNING_OUTCOME: function (data, session) { return recordPlanningOutcome75_(data || {}, session); },
  GET_PLANNING_OUTCOMES: function (data, session) { return getPlanningOutcomes76_(data || {}, session); },
  GET_AUTONOMOUS_PLAN_SUMMARY: function (data, session) { return getAutonomousPlanSummary77_(data || {}, session); },
  VERIFY_AUTONOMOUS_PLANNING_GUARD: function () { return verifyAutonomousPlanningGuard78_(); },
  GET_AUTONOMOUS_PLANNING_ALERTS: function (data, session) { return getAutonomousPlanningAlerts79_(data || {}, session); },
  GET_AUTONOMOUS_PLANNING_COMMAND_CENTER: function (data, session) { return getAutonomousPlanningCommandCenter80_(data || {}, session); },
  CREATE_EXECUTION_GATEWAY_REQUEST: function (data, session) { return createExecutionGateway81_(data || {}, session); },
  GET_EXECUTION_GATEWAY_REQUESTS: function (data, session) { return getExecutionGatewayRequests82_(data || {}, session); },
  RUN_EXECUTION_PREFLIGHT: function (data, session) { return runExecutionPreflight83_(data || {}, session); },
  EXECUTE_APPROVED_PROPOSAL: function (data, session) { return executeApprovedProposal84_(data || {}, session); },
  GET_EXECUTION_OUTCOMES: function (data, session) { return getExecutionOutcome85_(data || {}, session); },
  RUN_EXECUTION_RECONCILIATION: function (data, session) { return runExecutionReconciliation86_(data || {}, session); },
  GET_EXECUTION_QUALITY_GATE: function (data, session) { return getExecutionQualityGate87_(data || {}, session); },
  GET_EXECUTION_FINANCIAL_PREVIEW: function (data, session) { return getExecutionFinancialPreview88_(data || {}, session); },
  GET_EXECUTION_ALERTS: function (data, session) { return getExecutionAlerts89_(data || {}, session); },
  GET_AUTONOMOUS_OPERATIONS_COMMAND_CENTER: function (data, session) { return getAutonomousOperationsCommandCenter90_(data || {}, session); },
  GET_CORE100_HARDENING_STATUS: function (data, session) { return getCore100HardeningStatus_(data || {}, session); },  PUBLISH_CORE100_EVENT: function (data, session) { return publishCore100Event91_(data || {}, session); },
  GET_CORE100_EVENTS: function (data, session) { return getCore100Events91_(data || {}, session); },
  CREATE_CORE100_WORKFLOW: function (data, session) { return createCore100Workflow92_(data || {}, session); },
  GET_CORE100_WORKFLOWS: function (data, session) { return getCore100Workflows92_(data || {}, session); },
  ADVANCE_CORE100_WORKFLOW: function (data, session) { return advanceCore100Workflow92_(data || {}, session); },
  ENTERPRISE_SEARCH: function (data, session) { return enterpriseSearch93_(data || {}, session); },
  GET_DEPLOYMENT_HEALTH_CORE100: function (data, session) { return getDeploymentHealth94_(data || {}, session); },
  VERIFY_BACKUP_CORE100: function (data, session) { return verifyBackup95_(data || {}, session); },
  RUN_CORE100_UAT: function (data, session) { return runCore100Uat96_(data || {}, session); },
  GET_CORE100_UAT: function (data, session) { return getCore100Uat96_(data || {}, session); },
  CREATE_DEPLOYMENT_EVIDENCE: function (data, session) { return createDeploymentEvidence97_(data || {}, session); },
  GET_DISASTER_RECOVERY_CORE100: function (data, session) { return getDisasterRecovery98_(data || {}, session); },
  RUN_CORE100_GO_LIVE_GATE: function (data, session) { return runGoLiveGate99_(data || {}, session); },
  GET_CORE100_GO_LIVE_GATES: function (data, session) { return getGoLiveGates99_(data || {}, session); },
  GET_CORE100_FINAL_COMMAND_CENTER: function (data, session) { return getCore100FinalCommandCenter100_(data || {}, session); },

  CREATE_SHIFT_PLAN: function (data, session) { return createShiftPlan51_(data || {}, session); },
  GET_SHIFT_PLANS: function (data, session) { return getShiftPlans51_(data || {}, session); },
  CREATE_SHIFT_ASSIGNMENT: function (data, session) { return createShiftAssignment51_(data || {}, session); },
  GET_SHIFT_DISPATCHER: function (data, session) { return getShiftDispatcher51_(data || {}, session); },
  GET_LABOR_PRODUCTIVITY: function (data, session) { return getLaborProductivity52_(data || {}, session); },
  GET_PROCUREMENT_CYCLE: function (data, session) { return getProcurementCycle53_(data || {}, session); },
  CREATE_PROCUREMENT_CYCLE_ACTION: function (data, session) { return createProcurementCycleAction53_(data || {}, session); },
  GET_WORKSHOP_PERFORMANCE: function (data, session) { return getWorkshopPerformance54_(data || {}, session); },
  CREATE_PRODUCTION_CALENDAR: function (data, session) { return createProductionCalendar55_(data || {}, session); },
  ADD_PRODUCTION_CALENDAR_ITEM: function (data, session) { return addProductionCalendarItem55_(data || {}, session); },
  GET_PRODUCTION_CALENDAR: function (data, session) { return getProductionCalendar55_(data || {}, session); },
  GET_UNIT_ECONOMICS: function (data, session) { return getUnitEconomics56_(data || {}, session); },
  GET_DIGITAL_TWIN: function (data, session) { return getDigitalTwin57_(data || {}, session); },
  RUN_EXECUTION_SCENARIO: function (data, session) { return runExecutionScenario58_(data || {}, session); },
  GET_OPERATIONAL_ALERTS: function (data, session) { return getOperationalAlerts59_(data || {}, session); },
  GET_DIGITAL_FACTORY_COMMAND_CENTER: function (data, session) { return getDigitalFactoryCommandCenter60_(data || {}, session); }
};

/**
 * Единственная точка входа для ЛЮБОГО изменения/чтения данных из фронтенда.
 * action не найден в CONFIG.ACTION_MODULE -> отказ, даже если обработчик существует
 * (защита от "забыли добавить в карту прав, но обработчик уже есть").
 */
// P0.2 (ТЗ §7) — действия, начинающиеся с GET_, плюс сессионные действия без записи
// данных: чтение идемпотентно само по себе (повтор ничего не портит), поэтому для них
// НЕ создаётся ни OPERATIONS-заявка на идемпотентность, ни CASCADES-запись — это была
// бы запись в таблицу на каждое чтение, ощутимая лишняя нагрузка на Sheets без пользы.
// Эвристика по префиксу имени действия не идеальна (пара действий без записи данных,
// например FIND_PRODUCT_BY_BARCODE/CALC_PLAN_MENU_NEEDS, не начинаются с GET_ и потому
// по этой эвристике будут ОШИБОЧНО учтены как "мутирующие" — лишняя, но БЕЗВРЕДНАЯ
// запись в OPERATIONS/CASCADES; обратного случая — настоящая запись данных,
// classified как read-only — в текущем списке действий нет, проверено вручную по
// каждому обработчику). Точный per-action реестр — из TODO дальнейших этапов.
var CASCADE_EXEMPT_ACTIONS = ['LOGIN', 'LOGOUT', 'SELECT_LOCATION', 'GET_SESSION', 'GET_USERS_FOR_LOGIN'];
function _isMutatingAction_(action) {
  if (CASCADE_EXEMPT_ACTIONS.indexOf(action) !== -1) return false;
  return action.indexOf('GET_') !== 0;
}

function processOperation(action, data, token) {
  var session = null;
  if (action !== 'LOGIN' && action !== 'GET_USERS_FOR_LOGIN') {
    session = resolveSession_(token);
    if (!session) {
      return userError_('Сессия истекла или недействительна. Войдите заново.', CONFIG.ERROR_CODES.UNAUTHORIZED);
    }
    // Внешний P0-аудит, п.2 — НАЙДЕНО: deactivateUser_ раньше только менял USERS.статус,
    // но ничего не делал с уже выданными токенами — сотрудник, отключённый администратором,
    // продолжал работать с валидным токеном до истечения TTL сессии (был 12ч, теперь тем
    // более — см. Auth.gs, сессия теперь реально доживает до полных 12ч через SESSIONS).
    // Пользователь запрашивается заново на КАЖДЫЙ вызов (а не берётся из кэша сессии) —
    // отключение вступает в силу на следующем же запросе, без отдельного отзыва токена.
    var sessionUser = getUserById_(session.user_id);
    if (!sessionUser || sessionUser.статус !== 'активен') {
      return userError_('Учётная запись отключена. Обратитесь к администратору.', CONFIG.ERROR_CODES.UNAUTHORIZED);
    }
    if (!session.location_id && LOCATION_OPTIONAL_ACTIONS.indexOf(action) === -1) {
      return userError_('Сначала выберите точку (SELECT_LOCATION).', CONFIG.ERROR_CODES.VALIDATION_ERROR);
    }
    var moduleName = CONFIG.ACTION_MODULE[action];
    if (!moduleName) {
      return userError_('Действие не зарегистрировано в системе прав.', CONFIG.ERROR_CODES.FORBIDDEN);
    }
    // НАЙДЕНО этим раундом тестирования (не в бэкенде раунда 8 — обнаружено фронтенд-e2e-тестом,
    // который реально перезагружает страницу с сохранённым токеном, как настоящий браузер):
    // модуль 'auth' (GET_SESSION/SELECT_LOCATION/LOGOUT) не входит ни в один ROLE_MODULES,
    // кроме 'ADMIN': 'all' — то есть ЛЮБОЙ не-ADMIN пользователь получал
    // 'Недостаточно прав для этого действия' на GET_SESSION. boot() в Index.html при этом
    // тихо стирает localStorage-токен и требует новый вход по PIN — то есть КАЖДАЯ
    // перезагрузка страницы принудительно разлогинивала не-ADMIN сотрудников, хотя их сессия
    // была ещё действительна. Это управление собственной сессией, а не бизнес-модуль — доступно
    // любой аутентифицированной роли без исключения, поэтому проверка модуля для него пропускается.
    if (moduleName !== 'auth') {
      if (!userCanAccessAction_(sessionUser, action, moduleName)) {
        auditLog_(session.user_id, 'Отказ в доступе', action, null, null, 'forbidden');
        return userError_('Недостаточно прав для этого действия.', CONFIG.ERROR_CODES.FORBIDDEN);
      }
    }
    // RBAC v2: единый серверный location scope для любого API-запроса,
    // который явно передаёт locationId/location_id. Это закрывает обход через
    // обработчики, где раньше не было отдельного resolveLocationScope_.
    if (moduleName !== 'auth' && data && (data.locationId || data.location_id)) {
      try { assertLocationAllowed_(session, data.locationId || data.location_id, 'ROLE_LOCATION_SCOPE'); }
      catch (e) { auditLog_(session.user_id, 'Отказ по области данных', action, null, null, 'forbidden'); return userError_(e.message || 'Недостаточно прав для этой точки.', CONFIG.ERROR_CODES.FORBIDDEN); }
    }
  }

  var handler = ACTION_HANDLERS[action];
  if (!handler) {
    return userError_('Неизвестное действие: ' + action, CONFIG.ERROR_CODES.NOT_FOUND);
  }

  var mutating = _isMutatingAction_(action);

  if (mutating && typeof assertPeriodMutationAllowed_ === 'function') {
    try { assertPeriodMutationAllowed_(action, data || {}, session); }
    catch (periodLockErr) {
      return userError_(periodLockErr.message || 'Изменение закрытого периода запрещено.', CONFIG.ERROR_CODES.FORBIDDEN);
    }
  }

  // P0.2 (ТЗ §7) — идемпотентность. Клиент может прислать data.operationId, чтобы
  // безопасно повторить отправку после обрыва связи/таймаута, не опасаясь дубля.
  // Если не прислал — генерируем свой на этот единственный вызов (тогда защиты от
  // дублирования именно этого вызова нет, но у ответа всё равно есть operation_id для
  // трассировки — см. Idempotency.gs про честную границу этого механизма).
  var operationId = (data && data.operationId) ? String(data.operationId) : newOperationId_();
  var requestHash = (typeof core100RequestHash_ === 'function') ? core100RequestHash_(action, data || {}) : '';
  if (mutating) {
    try {
      var claim = claimOperation_(operationId, action, session, requestHash);
      if (claim.cached) {
        return claim.cached; // повтор того же operationId — отдаём прежний результат, обработчик не запускаем снова
      }
    } catch (claimErr) {
      logP22Error_(claimErr, {module:'IDEMPOTENCY', functionName:'claimOperation_', operationId:operationId, organizationId:session?session.organization_id:'', locationId:session?session.location_id:'', userId:session?session.user_id:'', errorCode:classifyErrorCode_(claimErr), retryable:false});
      var claimEnvelope=userError_(humanizeError_(action, claimErr), classifyErrorCode_(claimErr));
      claimEnvelope.operation_id=operationId; claimEnvelope.cascade_id='';
      return claimEnvelope;
    }
  }

  // P0.2 (ТЗ §4-5) — один вызов processOperation = один cascade_id. Кладём его в
  // session.cascade_id — так он доступен внутри обработчика и всего, что он вызовет,
  // без изменения сигнатуры каждой функции (session и так прокидывается почти всюду
  // после P0.1). Для read-only действий cascade не заводим (см. CASCADE_EXEMPT_ACTIONS
  // выше) — cascade_id в ответе будет пустой строкой.
  var cascadeId = '';
  if (mutating) {
    cascadeId = createCascade_(session, action, operationId);
    if (session) {
      session.cascade_id = cascadeId;
      // P0.3 (ТЗ §8) — складские проводки (Warehouse.gs::_recordOp_) читают
      // session.operation_id, чтобы связать WAREHOUSE_OPS-строку с КОНКРЕТНЫМ вызовом
      // API, который её породил (тем же способом, что уже прокидывается cascade_id).
      session.operation_id = operationId;
    }
  }

  try {
    var result = handler(data || {}, session);
    // P22: после первичной операции создаём ЕДИНЫЙ канонический event и запускаем
    // центральную оркестрацию зависимых пересчётов. Предметные модули остаются
    // владельцами своих расчётов; оркестратор не создаёт второй источник истины.
    var p22Orchestration = null;
    if (mutating) {
      // КРИТИЧЕСКОЕ ПРАВИЛО CORE 100%: ошибка производного каскада не отменяет уже
      // совершённую первичную операцию. Оркестратор сам переводит event/cascade в
      // recovery и возвращает состояние; исключение наружу не выбрасывается.
      p22Orchestration = p22RunOrchestration_(action, data || {}, session, operationId, cascadeId, result);
    }
    // P0.6 (ТЗ §6, статус PARTIAL) — см. докстринг cascadePartial_ (CascadeEngine.gs):
    // несколько обработчиков (receiveGoodsBatch_/importProductsCommit_/
    // importSalesCommit_) намеренно не бросают исключение, даже если часть строк не
    // прошла — единообразно возвращают result.ошибки как массив. Ответ клиенту
    // (envelope.ok) не меняется, это влияет только на статус CASCADES.
    if (mutating) {
      if (p22Orchestration && p22Orchestration.status === 'RECOVERY_REQUIRED') {
        cascadeMarkForRecovery_(cascadeId, p22Orchestration.message || 'Ошибка производного каскада.');
      } else if (result && Array.isArray(result.ошибки) && result.ошибки.length > 0) {
        cascadePartial_(cascadeId);
      } else {
        cascadeSuccess_(cascadeId);
      }
    }
    var envelope = userSuccess_(stripSecrets_(result));
    envelope.operation_id = operationId;
    envelope.cascade_id = cascadeId;
    envelope.event_id = p22Orchestration && p22Orchestration.event ? p22Orchestration.event.event_id : '';
    if (p22Orchestration && p22Orchestration.status === 'RECOVERY_REQUIRED') {
      envelope.recovery_required = true;
      envelope.operation_status = 'RECOVERY_REQUIRED';
    }
    if (mutating) {
      var finalStatus = p22Orchestration && p22Orchestration.status === 'RECOVERY_REQUIRED' ? 'RECOVERY_REQUIRED' : ((result && Array.isArray(result.ошибки) && result.ошибки.length) ? 'PARTIALLY_COMPLETED' : 'COMPLETED');
      completeOperation_(operationId, finalStatus, envelope);
    }
    return envelope;
  } catch (err) {
    logSystemError_(action, session ? session.user_id : null, action, err);
    if (typeof logP22Error_ === 'function') {
      logP22Error_(err, {module:'API', functionName:'processOperation', operationId:operationId, organizationId:session?session.organization_id:'', locationId:session?session.location_id:'', userId:session?session.user_id:'', errorCode:classifyErrorCode_(err), retryable:true});
    }
    // P0.6 (ТЗ §6, "1. Не заявлять пользователю «данные не изменены», если они
    // частично изменились" + "2. Создавать recovery record") — раньше ЛЮБАЯ ошибка
    // мутирующего действия помечала cascade как FAILED, даже если часть записей до
    // сбоя уже реально прошла (например, склад уже списан, а сам документ списания —
    // ещё нет). cascadeMarkForRecovery_ существовал с P0.2, но ни разу не вызывался
    // (см. CascadeEngine.gs). Теперь: если по эвристике _cascadeHasPartialWrites_ видно,
    // что операция успела что-то записать до падения — cascade садится в
    // RECOVERY_REQUIRED вместо FAILED, с текстом ошибки в поле "ошибка" (ЭТА строка
    // CASCADES и есть recovery record — п.2 ТЗ). Настоящего автоматического
    // восстановления/компенсирующей отмены (п.5 ТЗ) это НЕ реализует — см. докстринг
    // _cascadeHasPartialWrites_ и changelog: "механизм восстановления" (п.3 ТЗ) здесь
    // — это то, что RECOVERY_REQUIRED-операции теперь вообще ВИДНЫ и ОТЛИЧИМЫ от
    // обычных сбоев (через GET_CASCADE/GET_RECOVERY_CASCADES, см. ниже), а не то, что
    // они чинятся сами.
    if (mutating) {
      if (_cascadeHasPartialWrites_(cascadeId)) {
        cascadeMarkForRecovery_(cascadeId, String(err && err.message || err));
        if (typeof p22RecoveryCreate_ === 'function') {
          p22RecoveryCreate_(operationId, '', cascadeId, session, classifyErrorCode_(err), String(err && err.message || err), true);
        }
      } else {
        cascadeFail_(cascadeId, String(err && err.message || err));
      }
    }
    var errEnvelope = userError_(humanizeError_(action, err), classifyErrorCode_(err));
    errEnvelope.operation_id = operationId;
    errEnvelope.cascade_id = cascadeId;
    if (mutating) completeOperation_(operationId, 'FAILED', errEnvelope);
    return errEnvelope;
  }
}

// Публичное (без сессии) — список сотрудников для экрана выбора перед вводом PIN.
ACTION_HANDLERS.GET_USERS_FOR_LOGIN = function (data) { return getUsersForLogin_(data.organizationId); };

/** ТЗ §24 — пользователь никогда не видит техническую ошибку Apps Script напрямую. */
function humanizeError_(action, err) {
  var known = String(err && err.message || err);
  // ТЗ P0.1 — FORBIDDEN_SCOPE (Auth.gs::_denyScope_) уже сформулирован понятно для
  // пользователя, но начинается с латинского кода ошибки, поэтому проверяем его ДО
  // общей проверки "начинается с кириллицы" ниже. P0.2: та же логика для
  // LOCK_TIMEOUT/DUPLICATE_OPERATION (Database.gs::withLock_/Idempotency.gs) — оба тоже
  // уже сформулированы по-русски после префикса-кода, просто показываем как есть.
  if (known.indexOf('FORBIDDEN_SCOPE') === 0) return known;
  if (known.indexOf('LOCK_TIMEOUT') === 0) return known;
  if (known.indexOf('DUPLICATE_OPERATION') === 0) return known;
  if (known.indexOf('IDEMPOTENCY_KEY_REUSED_') === 0) return known;
  if (known.indexOf('SAFETY_ACCESS_REQUIRED') === 0) return known; // блокировка по допуску: показываем причину, а не общую ошибку
  // Внешний P0-аудит, п.2 (продолжение раунда 12) — НАЙДЕНО ПРИ ТЕСТИРОВАНИИ (не в самом
  // документе аудита): все PIN-связанные ошибки (Auth.gs::_loginAgainstUser_/
  // loginWithPinBlind_, Users.gs::createUser_/changePin_) написаны по-русски, но
  // НАЧИНАЮТСЯ С ЛАТИНСКОГО "PIN" — проверка "начинается с кириллицы" ниже их не ловила,
  // и понятное сообщение ("PIN временно заблокирован, повторите через N мин.") тихо
  // подменялось бесполезным общим "Не удалось выполнить операцию" — пользователь с
  // ВЕРНЫМ PIN на заблокированной учётке не понимал, что учётка временно заблокирована,
  // а не что он ошибся паролем. Тот же приём, что для FORBIDDEN_SCOPE/LOCK_TIMEOUT выше.
  if (known.indexOf('PIN') === 0) return known;
  // Ошибки валидации (недостаток остатка, дубликат заявки и т.п.) уже написаны по-русски
  // понятным языком в самих модулях — их можно показать как есть.
  if (/^[А-Яа-я]/.test(known)) return known;
  return 'Не удалось выполнить операцию (' + action + '). Данные не изменены. Повторите операцию.';
}

/**
 * P0.2 (ТЗ §17) — классифицирует исключение в один из CONFIG.ERROR_CODES по тому же
 * префиксу сообщения, который уже используется humanizeError_ выше (единый источник
 * соглашения "код: текст"). Честно: для обычных throw new Error('...') из бизнес-логики
 * модулей (без префикса-кода) нет отдельной пометки "это именно validation, а не
 * internal" — почти все такие сообщения в проекте по факту являются проверками
 * входных данных/состояния (не найдено, недостаточно остатка, короткий PIN и т.п.),
 * поэтому по умолчанию они классифицируются как VALIDATION_ERROR, если написаны
 * по-русски понятным текстом (см. тот же кириллический тест), и как INTERNAL_ERROR —
 * если нет (значит это непредвиденная техническая ошибка, а не намеренная проверка).
 */
function classifyErrorCode_(err) {
  var msg = String(err && err.message || err);
  if (msg.indexOf('FORBIDDEN_SCOPE') === 0) return CONFIG.ERROR_CODES.FORBIDDEN_SCOPE;
  if (msg.indexOf('DUPLICATE_OPERATION') === 0) return CONFIG.ERROR_CODES.DUPLICATE_OPERATION;
  if (msg.indexOf('IDEMPOTENCY_KEY_REUSED_') === 0) return CONFIG.ERROR_CODES.IDEMPOTENCY_KEY_REUSED;
  if (msg.indexOf('SAFETY_ACCESS_REQUIRED') === 0) return CONFIG.ERROR_CODES.FORBIDDEN; // штатная блокировка, не внутренняя ошибка
  if (msg.indexOf('LOCK_TIMEOUT') === 0) return CONFIG.ERROR_CODES.LOCK_TIMEOUT;
  if (msg.indexOf('CASCADE_FAILED') === 0) return CONFIG.ERROR_CODES.CASCADE_FAILED;
  if (msg.indexOf('RECOVERY_REQUIRED') === 0) return CONFIG.ERROR_CODES.RECOVERY_REQUIRED;
  if (/^[А-Яа-я]/.test(msg)) return CONFIG.ERROR_CODES.VALIDATION_ERROR;
  return CONFIG.ERROR_CODES.INTERNAL_ERROR;
}
