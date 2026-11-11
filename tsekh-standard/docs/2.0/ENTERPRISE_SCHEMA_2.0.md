# ENTERPRISE_SCHEMA_2.0 — схема контура предприятия

Версия схемы: **2.2.0**. Сформировано из `app/TS2_Schema.gs` (`node tools/gen_artifacts_2.js`).

Листы создаются функцией «Проверить структуру 2.0» (или `ts2InstallSchema`) в таблице предприятия. Повторный запуск не создаёт дублей; недостающие колонки дописываются справа. Существующие листы ЦЕХ Стандарт (Блюда, Состав, Сотрудники, журналы и т. д.) не переименовываются и не меняются — их читают адаптеры (раздел «Совместимость»).

| Лист | Раздел ТЗ | Префикс ID | Колонки |
|---|---|---|---|
| SYSTEM_CONFIG | 2.0 §7.2 | — | key, value, valueType, scope, isSecret, source, status, updatedAt, updatedBy |
| ID_COUNTERS | 2.0 §7.3 | — | counterCode, prefix, year, lastNumber, updatedAt, updatedBy |
| SCHEMA_VERSION | 2.0 §7.1 | — | version, appliedAt, appliedBy, sheetsCreated, sheetsVerified, notes |
| DRIVE_REGISTRY | 2.0 §7.4 | DRV-000001 | resourceId, enterpriseId, resourceType, logicalCode, name, googleId, parentGoogleId, url, status, lastCheckedAt, hash |
| FILES | 2.0 §7.5 | FILE-ГГГГ-000001 | fileId, enterpriseId, googleFileId, googleUrl, fileName, mimeType, sizeBytes, sha256, parentFolderId, entityType, entityId, documentId, source, uploadedBy, uploadedAt, lastSeenAt, status, isOriginal, isPreview |
| DOCUMENTS | 2.0 §7.6 | DOC-ГГГГ-000001 | documentId, enterpriseId, documentType, title, number, documentDate, validFrom, validTo, counterpartyId, entityType, entityId, currentVersionId, status, sourceFileId, ownerEmployeeId, createdAt, updatedAt |
| DOCUMENT_VERSIONS | 2.0 §7.7 | DOCV-ГГГГ-000001 | documentVersionId, documentId, versionNumber, fileId, extractedTextFileId, extractedDataJsonFileId, sha256, parser, parserVersion, confidence, status, changeSummary, createdAt, createdBy, approvedAt, approvedBy |
| IMPORT_JOBS | 2.0 §7.8 | IMP-ГГГГ-000001 | importJobId, enterpriseId, sourceType, sourceFolderId, fileCount, rowCount, status, stage, profileId, startedAt, completedAt, startedBy, errorCount, warningCount, reportFileId |
| IMPORT_ITEMS | 2.0 §7.9 | IMPI-ГГГГ-000001 | importItemId, importJobId, fileId, rowNumber, sourceObjectType, sourceObjectName, rawDataJson, normalizedDataJson, matchedEntityType, matchedEntityId, confidence, status, issuesJson, reviewedBy, reviewedAt |
| RECONCILIATION_RUNS | 2.0 §7.10 | REC-ГГГГ-000001 | reconciliationRunId, enterpriseId, profileId, scope, sourceSnapshot, startedAt, completedAt, status, passCount, reviewCount, failCount, missingCount, notApplicableCount, reportFileId, createdBy |
| RECONCILIATION_ISSUES | 2.0 §7.11 | ISS-ГГГГ-000001 | issueId, reconciliationRunId, enterpriseId, ruleId, severity, entityType, entityId, sourceDocumentId, fieldName, currentValue, expectedValue, message, suggestedAction, status, ownerRole, assignedTo, dueAt, resolvedAt, resolvedBy, resolutionComment, evidenceFileId |
| CHANGE_PROPOSALS | 2.0 §7.12 | CHG-ГГГГ-000001 | changeProposalId, issueId, enterpriseId, entityType, entityId, operationType, beforeJson, afterJson, reason, basisDocumentId, riskLevel, requiresBackup, requiresApproval, status, createdAt, createdBy, approvedAt, approvedBy, appliedAt, appliedBy, rollbackAvailable, rollbackDataFileId |
| APPROVALS | 2.0 §7.13 | APR-ГГГГ-000001 | approvalId, changeProposalId, enterpriseId, approvalType, requestedFromRole, requestedFromEmployeeId, requestedAt, status, approvedBy, approvedAt, rejectedBy, rejectedAt, comment |
| MIGRATION_MAP | 2.0 §7.14 | MIG-ГГГГ-000001 | migrationMapId, enterpriseId, sourceSystem, sourceSheet, sourceKey, sourceRow, legacyValue, entityType, entityId, mappingMethod, confidence, status, reviewedBy, reviewedAt, notes |
| AUDIT_CHAIN | 2.0 §7.16 (AUDIT_LOG) | AUD-ГГГГ-000001 | auditId, operationId, enterpriseId, actorType, actorId, actorName, actorRole, action, entityType, entityId, beforeJson, afterJson, reason, source, result, createdAt, prevHash, hash |
| BACKUP_CATALOG | 2.0 §7.18 | BKP-ГГГГ-000001 | backupId, enterpriseId, backupType, scope, fileId, fileUrl, createdAt, createdBy, sizeBytes, sha256, schemaVersion, status, restoreTestedAt, restoreResult |
| READINESS_RUNS | 2.0 §7.19 | RDY-ГГГГ-000001 | readinessRunId, enterpriseId, runType, startedAt, completedAt, status, passCount, failCount, reviewCount, missingEvidenceCount, detailsJson, reportFileId, createdBy |
| LOCATIONS | 2.0 §8.1 | LOC-ГГГГ-000001 | locationId, enterpriseId, organizationId, name, address, locationType, status, notApplicableReason, createdAt, createdBy |
| WORKSHOPS | 2.0 §8.1 | WS-000001 | workshopId, enterpriseId, locationId, code, name, zoneType, status, notApplicableReason, legacyName, createdAt, createdBy |
| ROLE_PERMISSIONS | 2.0 §8.2 | — | roleCode, roleName, actionCode, allowed, source, version, updatedAt |
| SYSTEM_DOCUMENTS | 2.1 §11.1 | SDOC-ГГГГ-000001 | documentId, enterpriseId, templateId, templateVersion, documentType, title, approvalMode, status, requiresLocalApproval, localApprovalStatus, source, fileId, validFrom, validTo, createdAt, updatedAt, approvedByEnterprise, approvedAt |
| EVENT_RULES | 2.1 §8.1 | — | eventRuleId, enterpriseId, eventType, sourceEntityType, sourceEvent, createsRecordType, journalCode, haccpControlPointId, requiredConfirmation, measurementMode, defaultResult, notificationRuleId, active, version, title, sourceTtkId |
| AUTO_RECORDS | 2.1 §11.3 | ARC-ГГГГ-000001 | autoRecordId, enterpriseId, eventType, sourceType, sourceId, recordType, journalCode, kktId, productionId, batchId, ttkId, result, measurementMode, value, unit, createdAt, createdBySystem, confidence, status, idempotencyKey, operationId, confirmedByEmployee, confirmedAt, ruleVersion, schemaVersion, prevHash, hash |
| MANUAL_MEASUREMENTS | 2.1 §11.4 | MSR-ГГГГ-000001 | measurementId, enterpriseId, measurementType, objectType, objectId, value, unit, minValue, maxValue, result, employeeId, recordedAt, source, comment, photoFileId, operationId |
| JOURNAL_EXPECTATIONS | 2.1 §11.5 | EXP-ГГГГ-000001 | expectationId, enterpriseId, journalCode, eventRuleId, objectType, objectId, productionId, batchId, dueAt, responsibleRole, status, confirmationMode, measurementRequired, completedAt, completedBy, factId, title, idempotencyKey |
| APPROVAL_QUEUE | 2.1 §11.6 | APQ-ГГГГ-000001 | approvalId, enterpriseId, objectType, objectId, title, reason, preparedBySystem, requiredRole, status, approvedBy, approvedAt, comment |
| MEASUREMENT_OBJECTS | 2.1 §6.3, §10 | OBJ-000001 | objectId, enterpriseId, objectType, name, workshopId, minValue, maxValue, unit, setpoint, checkTimes, legacyObjectId, status, notApplicableReason, lastReplacedAt, resourceHours, createdAt, createdBy, inputMode |
| SENSOR_DEVICES | 2.1 §7.3 (датчики) | SNS-000001 | deviceId, enterpriseId, objectId, name, tokenHash, status, createdAt, createdBy, lastSeenAt, lastValue, lastResult, lastStoredAt, revokedAt, lastRaw, offset, calibratedAt, calibratedBy, rssi, silentNotifiedAt |
| SENSOR_CALIBRATIONS | 2.1 §7.3 (датчики) | SCAL-000001 | calibrationId, enterpriseId, deviceId, objectId, referenceValue, referenceThermometer, sensorRaw, offsetBefore, offsetAfter, difference, result, calibratedBy, calibratedAt, comment |
| AUTOMATION_PROFILE | 2.1 §3, §12 | — | key, value, updatedAt, updatedBy |
| TTK_SOURCE_FACTS | 2.2 §5.1 | TSF-ГГГГ-000001 | sourceFactId, enterpriseId, ttkId, ttkVersionId, fieldCode, rawValue, normalizedValue, unit, confidence, sourceFileId, sourcePage, sourceText, extractionMethod, status, requiresReview, createdAt |
| DOCUMENT_GENERATION_JOBS | 2.2 §5.2 | GEN-ГГГГ-000001 | generationJobId, enterpriseId, ttkVersionId, generationType, profileId, status, startedAt, completedAt, requestedBy, backupId, createdDocumentCount, createdIssueCount, createdRuleCount, errorMessage, reportFileId, ttkId, summaryJson |
| DOCUMENT_GENERATION_ITEMS | 2.2 §5.3 | GENI-ГГГГ-000001 | generationItemId, generationJobId, documentType, sectionCode, fieldCode, value, sourceType, sourceId, confidence, status, requiresApproval, issueId |
| TU_DOCUMENTS | 2.2 §5.4 | TU-ГГГГ-000001 | tuId, enterpriseId, tuNumber, title, productGroup, version, status, sourceTtkIds, sourceNormIds, fileId, validFrom, validTo, approvedBy, approvedAt, createdAt, generationJobId, pdfFileId, hash |
| STO_DOCUMENTS | 2.2 §5.5 | STO-ГГГГ-000001 | stoId, enterpriseId, stoNumber, title, processCode, workshopId, version, status, sourceTtkIds, sourceEquipmentIds, sourceRuleIds, fileId, approvedBy, approvedAt, createdAt, generationJobId, pdfFileId, hash |
| PPK_DOCUMENTS | 2.2 §5.6 | PPK-ГГГГ-000001 | ppkId, enterpriseId, name, version, baseVersionId, changeType, changeReason, status, sourceTtkIds, sourceStoIds, sourceHaccpProcessIds, fileId, approvedBy, approvedAt, validFrom, validTo, createdAt, generationJobId, pdfFileId, hash |
| DOCUMENT_SOURCE_LINKS | 2.2 §5.7 | DSL-ГГГГ-000001 | linkId, enterpriseId, targetDocumentType, targetDocumentId, sourceType, sourceId, sourceField, relation, createdAt |
| DOCUMENT_GENERATION_ISSUES | 2.2 §5.8 | GISS-ГГГГ-000001 | issueId, generationJobId, enterpriseId, severity, sectionCode, fieldCode, message, currentValue, requiredValue, suggestedAction, status, assignedRole, resolvedBy, resolvedAt |
| HACCP_PROCESSES_V2 | 2.2 §7.1 | HPR-ГГГГ-000001 | processId, enterpriseId, processCode, name, sourceTtkId, operationOrder, workshopId, status, createdAt |
| HACCP_HAZARDS_V2 | 2.2 §4 этап 5 | HZ-ГГГГ-000001 | hazardId, enterpriseId, processId, hazardType, description, masterHazardCode, confidence, status, basis, createdAt |
| HACCP_CONTROLS_V2 | 2.2 §7.1 | KKT-ГГГГ-000001 | controlId, enterpriseId, processId, hazardId, name, isCcp, criticalLimit, limitSource, monitoringMethod, frequency, responsibleRole, journalCode, correctiveAction, sourceTtkId, sourceStoId, sourcePpkId, status, createdAt |

## Совместимость: существующие листы → сущности 2.0

| Лист | Сущность |
|---|---|
| Блюда | DISHES |
| Состав | DISH_INGREDIENTS |
| ТТК_Версии | DISH_VERSIONS |
| Продукты_ID_V53 | PRODUCTS |
| Продукты_Справочник | PRODUCTS |
| Поставщики | SUPPLIERS |
| Сотрудники | EMPLOYEES |
| Производство | PRODUCTION_TASKS |
| Склад_Партии | STOCK_BATCHES |
| Склад_Операции | STOCK_OPERATIONS |
| Температуры | TEMPERATURE_MEASUREMENTS |
| Температурные_Объекты | TEMPERATURE_OBJECTS |
| ППК_V30 | HACCP_PROGRAMS |
| HACCP_ТочкиКонтроля_V30 | HACCP_CONTROL_POINTS |
| HACCP_Факты_V31 | HACCP_FACTS |
| Документы | DOCUMENTS |
| Audit_Log | AUDIT_LOG |
| Операции | OPERATIONS |
| Факты | FACTS |
| TRACE_LINKS | TRACE_LINKS |
| Медкнижки | MEDICAL_DOCUMENTS |
| ЦС_Договоры | CONTRACTS |
| ЦС_Нормативы | NORMS_REGISTER |
| ЦС_Инструкции_ОТ | OT_INSTRUCTIONS |
| ЦС_Должностные | JOB_DESCRIPTIONS |
| ЦС_Инструктажи | BRIEFINGS |
| ЦС_СОУТ | SOUT_WORKPLACES |
| ЦС_СИЗ | PPE_ISSUANCE |
| ЦС_Акты | OCCUPATIONAL_ACTS |
| Оборудование_Реестр | EQUIPMENT |
| Лаборатория_План | LAB_PLANS |
| Лаборатория_Исследования | LAB_TESTS |
| Суточные_Пробы | DAILY_SAMPLES |
| Журналы_Ожидания | JOURNAL_EXPECTATIONS (legacy) |

## Действия и права ролей (ROLE_PERMISSIONS)

| Действие | Право роли в системе |
|---|---|
| enterprise.view | * |
| enterprise.edit | org_edit |
| employee.view | personnel |
| employee.edit | personnel |
| role.assign | grants |
| ttk.view | catalog |
| ttk.create | ttk_edit |
| ttk.edit | ttk_edit |
| ttk.submit | ttk_edit |
| ttk.approve | ttk_approve |
| ttk.archive | ttk_approve |
| production.plan | plan_edit |
| production.execute | kanban |
| stock.view | stock_view |
| stock.receive | receiving |
| stock.writeoff | stock |
| haccp.view | haccp_view |
| haccp.record | journals |
| haccp.approve | haccp_approve |
| reconciliation.view | haccp_view|org_edit |
| reconciliation.approve | haccp_approve|org_edit |
| reconciliation.apply | org_edit |
| document.upload | documents |
| document.approve | haccp_approve|org_edit |
| contract.view | documents_view |
| contract.edit | documents |
| report.export | reports |
| backup.create | archive |
| backup.restore | system |
