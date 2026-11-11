# CONTROL_SCHEMA_2.0 — схема управляющего контура (админ-панель)

Сформировано из `admin/Config.gs`. Управляющий контур хранит только служебные сведения о предприятиях: лицензии (ключ — хешем и маской), подписки, платежи, релизы, задания обновления, обращения и согласия. Рабочие данные предприятия (ТТК, журналы, сотрудники) сюда не попадают.

| Лист | Колонки |
|---|---|
| Users | Email, Имя, Роль, Статус, Хэш пароля, Соль, Последний вход, Создан |
| Organizations | ID, Название, Email, Телефон, ИНН, Адрес, Дата регистрации, Тариф, Статус, Окончание подписки, Сотрудников, ТТК, Журналов, Размер базы, Версия, Последний вход, Google Drive ID, License Key, Script ID, App URL, Менеджер, Комментарий, Команды, EnterpriseID, Канал обновлений |
| Licenses | License Key, OrgID, Организация, Статус, Активирована, Дата окончания, Устройств, Последняя проверка, Последний IP, Версия клиента, Создана, Кто создал, Маска ключа, EnterpriseID |
| Subscriptions | ID, OrgID, Организация, Тариф, Статус, Начало, Окончание, Автоплатеж, Способ оплаты, Подключение, Обслуживание в месяц, Следующее списание, История |
| Payments | ID, Дата, OrgID, Клиент, Сумма, Статус, Платежная система, ID платежа, Invoice, Назначение, Месяцев, Тариф, Комментарий, Ссылка на оплату |
| Invoices | Номер, Дата, OrgID, Клиент, Сумма, Назначение, Статус, PaymentID, Файл |
| Logs | Дата, Тип, Администратор, Объект, Описание |
| Notifications | ID, Дата, Канал, Группа, Тема, Текст, Получателей, Статус, Кто |
| Errors | Дата, Источник, Сообщение, Детали |
| Backups | ID, Дата, OrgID, Клиент, Размер, Drive File ID, Ссылка, Кто, Статус |
| Analytics | Дата, Клиентов, Активных, Новых, Ушедших, MRR, ARR, Выручка за день |
| System_Settings | Ключ, Значение, Описание |
| API_Keys | ID, Название, Хэш ключа, Права, Создан, Последнее использование, Статус |
| Updates | Версия, Дата, Описание, Статус, Опубликовал, Обновлено клиентов, Ссылка на сборку |
| TTK_Library | ID, Название, Категория, Выход, Состав (JSON), Технология, Белки, Жиры, Углеводы, Ккал, Срок годности, Условия хранения, Источник, Статус, Обновлено |
| ENTERPRISE_RESOURCES | resourceId, enterpriseId, orgId, resourceType, googleId, url, status, createdAt, checkedAt, note |
| ENTERPRISE_CONTACTS | contactId, enterpriseId, orgId, role, name, email, phone, isPrimary, createdAt |
| ENTERPRISE_ONBOARDING | stepId, enterpriseId, orgId, stepCode, status, startedAt, completedAt, resultJson, errorMessage, by |
| FEATURE_CATALOG | featureCode, name, minPlan, description, limitsJson, status |
| APP_RELEASES | releaseId, version, channel, status, notes, schemaVersion, createdAt, createdBy, promotedAt, promotedBy, masterScriptId, rollbackOf |
| UPDATE_JOBS | jobId, releaseId, version, enterpriseId, orgId, status, createdAt, createdBy, backupRequestedAt, backupConfirmedAt, startedAt, completedAt, errorMessage, previousVersion |
| UPDATE_RESULTS | resultId, jobId, orgId, step, status, at, details |
| MASTER_DOCUMENT_TEMPLATES | templateId, title, documentType, approvalMode, defaultStatus, requiresLocalApproval, approverRole, version, status |
| MASTER_EVENT_RULES | eventRuleId, eventType, createsRecordType, journalCode, measurementMode, title, version, status |
| MASTER_SEED_PACKAGES | packageId, version, enterpriseType, templatesJson, rulesJson, zonesJson, status, createdAt |
| MASTER_RULES | ruleId, ruleCode, domain, severity, name, requiresHumanApproval, version, status |
| MASTER_HAZARDS | hazardCode, operation, hazardType, description, version, status |
| IMPORT_PROFILES | profileId, documentType, fieldsJson, minConfidence, version, status |
| RECONCILIATION_PROFILES | profileId, name, ruleIds, version, status |
| SUPPORT_TICKETS | ticketId, enterpriseId, orgId, subject, text, status, createdAt, createdBy, assignedTo, resolvedAt, resolution |
| SUPPORT_SESSIONS | sessionId, enterpriseId, orgId, ticketId, reason, scope, minutes, status, requestedBy, requestedAt, consentBy, consentAt, expiresAt, closedAt |
| TECH_EVENTS | eventId, enterpriseId, orgId, level, code, message, version, at |
| AGGREGATED_USAGE | usageId, enterpriseId, orgId, date, metricsJson, version |
| WEBHOOK_EVENTS | rawEventHash, provider, receivedAt, result, invoice, externalId |
| DATA_REQUESTS | requestId, enterpriseId, orgId, requestType, status, requestedAt, requestedBy, completedAt, resultFileId, comment |
| CONSENTS | consentId, enterpriseId, orgId, consentType, objectId, grantedBy, grantedAt, expiresAt, revokedAt, evidence |
| ENTERPRISE_AUTOMATION_PROFILES | enterpriseId, orgId, mode, seedVersion, enterpriseType, readiness, updatedAt, normsVersion, normsExpired |
| MASTER_NORMS | code, group, document, title, requires, whereInSystem, status, link, validTo, replacedBy, changedAt, changedBy, note |
| ADMIN_ALERTS | alertId, at, kind, objectId, text, status, closedAt, closedBy, dedupKey |

## Роли администраторов

| Роль | Права |
|---|---|
| Super Admin (SUPER_ADMIN) | * |
| Manager (MANAGER) | dashboard, clients.view, clients.edit, subs.view, subs.edit, payments.view, payments.edit, licenses.view, licenses.edit, notify.send, analytics, backups.view, logs.view, ttk.view, provision, support, data_requests |
| Support (SUPPORT) | dashboard, clients.view, subs.view, licenses.view, notify.send, logs.view, backups.view, backups.create, ttk.view, support, data_requests |
| Developer (DEVELOPER) | dashboard, clients.view, licenses.view, updates, logs.view, backups.view, backups.create, settings.view, ttk.view, ttk.edit, analytics, releases, provision, support |

## API (doPost)

| action | Защита | Назначение |
|---|---|---|
| license.check | одноразовый nonce, ответ подписан HMAC-SHA256 | статус, тариф, возможности, enterpriseId, льготный период, команды, запросы поддержки, доступный релиз |
| ttk.library | HMAC(key\|ts), окно 10 мин, повтор подписи отклоняется | база отработанных ТТК (Pro Max) |
| release.check | то же | доступная версия в канале предприятия |
| support.request | то же | обращение в поддержку |
| support.consent | то же | решение предприятия по запросу доступа (CONSENTS) |
| usage.report | то же | обезличенная статистика (AGGREGATED_USAGE) |
| tech.event | то же | технические ошибки (TECH_EVENTS) |
| reconciliation.template | то же | эталонные правила сверки и профили импорта |
| seed.package | то же | пакет первоначальной настройки |
| api.clients | API-ключ (хеш в API_Keys) | список клиентов для внешних систем |
| ?hook=payment&t=… | токен + подпись провайдера + WEBHOOK_EVENTS (повтор не обрабатывается) | уведомления ЮMoney/ЮKassa |
