# SECURITY_ENTRY_POINTS_2.0 — инвентаризация входов приложения

Сформировано `node tools/inventory_entry_points.js` из исходников (`app/*.gs`) и списков шлюза. Полный реестр — `SECURITY_ENTRY_POINTS_2.0.csv`.

## Модель доступа

Веб-приложение развёрнуто с доступом «все, включая анонимных» (`ANYONE_ANONYMOUS`), выполняется от имени владельца. Поэтому **каждая** функция без «_» в конце имени, вызываемая из браузера, проходит шлюз `zzz_MonChef_Gate.gs`; доступ к данным определяется не Google-аккаунтом, а сессией ЦЕХ Стандарт (вход по ПИН-коду). Функции с «_» в конце из браузера недоступны (ограничение Apps Script).

| Вид | Кол-во | Как защищена |
|---|---|---|
| вход (doGet/doPost) | 1 | см. маршруты ниже |
| служебная | 340 | без технической сессии или контекста владельца — отказ AUTH_REQUIRED / «служебная функция» |
| публичная | 5 | не отдают данные предприятия |
| интерфейс (сессия) | 661 | сессия ЦЕХ Стандарт → право роли → тариф (fail-closed) → для записи: медицинский допуск (fail-closed), защита от двойного нажатия, блокировка, операция и аудит |
| портал проверяющего | 22 | временный ключ проверяющего, проверяется в первой строке функции |

## Публичные функции и маршруты

| Функция | Защита |
|---|---|
| doGet | маршруты: ?verify (страница проверки документа по QR), ?diag (ключ поддержки, выданный с согласия), страница интерфейса — данные только через шлюз |
| destroySession | удаляет только свою сессию |
| loginWithPin | вход по ПИН: блокировки устройства, техвхода и системы |
| getJournalRegistry | справочник названий журналов, без данных |
| uiMe | без сессии — пустой ответ |
| getAppUrl | адрес приложения |

## Портал проверяющего

| Функция | Защита |
|---|---|
| getAuditSession | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditJournal | ключ проверяющего (_requireAuditAccess_) в начале функции |
| verifyAuditJournal | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditBatches | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditDeviations | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditTemperatures | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditStaff | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditEquipment | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditDocumentFile | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditBatch | ключ проверяющего (_requireAuditAccess_) в начале функции |
| verifyAuditDocument | передаёт ключ в verifyInspectionDocument, который проверяет его (_requireAuditAccess_) |
| getInspectionDocuments | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditDocument | ключ проверяющего (_requireAuditAccess_) в начале функции |
| verifyInspectionDocument | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditHaccp | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditTraceability | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getInspectionReadiness | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditDashboard | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditInspectionPackage | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditCanonicalTrace | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditRuleState | ключ проверяющего (_requireAuditAccess_) в начале функции |
| getAuditOperationalState | ключ проверяющего (_requireAuditAccess_) в начале функции |

## Результат автоматической проверки

- ✅ Все функции портала проверяют ключ в начале функции.
- ✅ Все записывающие функции интерфейса требуют право роли.
- ✅ Публичных функций с доступом к данным нет.
