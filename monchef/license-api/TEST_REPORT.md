# Отчёт о тестах MonChef License API

Дата: 2026-11-19. Запуск: `node monchef/license-api/tools/run_tests.js` (эмулятор Apps Script, Node v22.23.5).

Итого: **48 из 48** пройдено.

| # | Тест | Результат |
|---|---|---|
| 1 | API: Активная лицензия: CHECK_LICENSE | PASS |
| 2 | API: Неизвестная лицензия: AUTH_FAILED наружу, LICENSE_NOT_FOUND в аудите, уведомление | PASS |
| 3 | API: Неверный clientId | PASS |
| 4 | API: Неверный токен; 5 подряд — уведомление BAD_TOKENS | PASS |
| 5 | API: Нестрогий режим: точные коды наружу | PASS |
| 6 | API: Истёкшая лицензия: LICENSE_EXPIRED и уведомление | PASS |
| 7 | API: Отозванная лицензия: LICENSE_INACTIVE | PASS |
| 8 | API: Статус и срок не раскрываются без верного токена | PASS |
| 9 | API: Запрещённый модуль: MODULE_NOT_ALLOWED и уведомление | PASS |
| 10 | API: Запрещённый документ: DOCUMENT_NOT_ALLOWED (не тот тариф / не в списке) | PASS |
| 11 | API: LIST_DOCUMENTS: только разрешённые, без fileId и ссылок | PASS |
| 12 | API: Выдача разрешённого документа: содержимое и SHA-256 | PASS |
| 13 | API: Несуществующий, черновой и внутренний документ: DOCUMENT_NOT_FOUND | PASS |
| 14 | API: Слишком большой документ: DOCUMENT_TOO_LARGE | PASS |
| 15 | API: Повторный requestId: сохранённый ответ | PASS |
| 16 | API: Повторный GET_DOCUMENT: содержимое не хранится, выдаётся заново | PASS |
| 17 | API: Тот же requestId с другим payload: REQUEST_ID_PAYLOAD_MISMATCH | PASS |
| 18 | API: Параллельные запросы с одним requestId: второй получает PROCESSING | PASS |
| 19 | API: Повтор после временной ошибки выполняется заново | PASS |
| 20 | API: Превышение rate limit: RATE_LIMIT_EXCEEDED | PASS |
| 21 | API: Лимит по операции GET_DOCUMENT | PASS |
| 22 | API: Неизвестная установка при лимите 1: INSTALLATION_NOT_ALLOWED и MULTI_INSTALL | PASS |
| 23 | API: Несовпадение хеша: DOCUMENT_INTEGRITY_FAILED, документ BLOCKED, уведомление | PASS |
| 24 | API: Drive недоступен: SERVICE_UNAVAILABLE, retryable | PASS |
| 25 | API: Таблица недоступна: SERVICE_UNAVAILABLE без текста исключения | PASS |
| 26 | API: fileId вместо documentId: INVALID_REQUEST | PASS |
| 27 | API: Права из запроса не принимаются (status, allowedModules) | PASS |
| 28 | API: Некорректные запросы: не JSON, массив, >100 КБ, длинная строка, без requestId, неизвестная операция | PASS |
| 29 | API: TEST-лицензия видит только тестовые материалы | PASS |
| 30 | API: GET_LIBRARY_VERSION: версия и модули только этой лицензии | PASS |
| 31 | API: Данные другого клиента недоступны | PASS |
| 32 | API: Отсутствие секретов в ответах и журнале | PASS |
| 33 | API: Нельзя перечислить licenseId: ответы для существующей и несуществующей одинаковы | PASS |
| 34 | API: Аудит: одна строка на запрос, без токена | PASS |
| 35 | API: Хеш токена: HMAC-SHA-256, сравнение без раннего выхода | PASS |
| 36 | API: GET не обслуживается | PASS |
| 37 | Клиент: без настройки — NOT_CONFIGURED, к API не обращается | PASS |
| 38 | Клиент: проверка лицензии и загрузка разрешённых документов | PASS |
| 39 | Клиент: повторная синхронизация не загружает неизменённые документы | PASS |
| 40 | Клиент: токен и адрес API не попадают в ответ интерфейсу | PASS |
| 41 | Клиент: API недоступен — GRACE, данные не удаляются, повторы с паузой | PASS |
| 42 | Клиент: паузы растут 5 → 15 → 60 → 360 минут | PASS |
| 43 | Клиент: offline grace period истёк — LIMITED, данные кухни и документы остаются | PASS |
| 44 | Клиент: связь вернулась — режим OK | PASS |
| 45 | Клиент: ответ не JSON / HTTP 500 — как недоступность | PASS |
| 46 | Клиент: лицензия отозвана — BLOCKED, загруженное сохраняется | PASS |
| 47 | Клиент: ключ заменён владельцем — старый не подходит (AUTH_FAILED → BLOCKED) | PASS |
| 48 | Клиент: подменённый ответ (хеш не совпал) не сохраняется | PASS |
