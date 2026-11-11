# API_CONTRACT_2.0 — контракт обмена «система предприятия ↔ админ-панель»

Транспорт: HTTPS POST на адрес веб-приложения админ-панели, тело — JSON, ответ — JSON `{ok: true|false, …}`. Apps Script не передаёт заголовки и IP клиента, поэтому подлинность определяется только подписью в теле.

## 1. Подписи

| Тип запроса | Подпись | Защита от повтора |
|---|---|---|
| `license.check` | ответ админ-панели: `sig = HMAC-SHA256(JSON(license) + "|" + nonce, секрет лицензии)`; клиент сверяет | `nonce` ≥ 16 символов, одноразовый (кэш 6 ч); повтор → `REPLAY` |
| служебные (`ttk.library`, `release.check`, `support.*`, `usage.report`, `tech.event`, `reconciliation.template`, `seed.package`) | запрос клиента: `sig = HMAC-SHA256(key + "|" + ts, секрет)` | `ts` в окне ±10 мин; одна подпись на одно действие (кэш 15 мин); `ts` у клиента строго возрастает |
| платёжные уведомления `?hook=payment&t=…` | токен вебхука + подпись провайдера (ЮMoney — SHA-1; ЮKassa — статус перепроверяется через API) | `WEBHOOK_EVENTS`: SHA-256 тела события; повтор → `duplicate` |
| `api.clients` | API-ключ (в таблице — только хеш), права `read`/`*` | — |

Секрет лицензии и ключ хранятся у клиента только в свойствах скрипта; в админ-панели ключ — хешем (`License Key` = SHA-256) и маской, секрет — в свойствах скрипта `LIC_SECRET_<хеш>`.

## 2. Методы

### license.check
Запрос: `{action, key, nonce, version, stats:{sheets, rows, ttk, staff, autoRecords, mode, seedVersion, schemaVersion, lastBackup}, scriptId, appUrl}`.
Ответ: `{ok, license:{key, enterpriseId, plan, status: ACTIVE|GRACE|EXPIRED|BLOCKED, expiresAt, graceUntil, org, features[], limits{}, channel: stable|pilot, message, commands[], notices[], supportRequests[], update}, sig}`.
Клиент: `GRACE` — работа сохраняется с предупреждением; `EXPIRED`/`BLOCKED` — только чтение; без связи > 7 дней — только чтение.

### release.check → `{ok, channel, release:{version, notes, schemaVersion}}`
### support.request `{subject, text, author}` → `{ok, ticketId}`
### support.consent `{sessionId, allow, by, diagKey?, revoke?}` → `{ok, status: GRANTED|DENIED|REVOKED, expiresAt}`
`diagKey` — временный ключ диагностики (64 hex), передаётся только при разрешении; в админ-панели хранится в свойствах скрипта `DIAG_<sessionId>`, удаляется при закрытии или отзыве.
### usage.report `{metrics, version}` → `{ok}` — допустимые ключи метрик: sheets, rows, ttk, staff, autoRecords, expectationsOpen, exceptionsOpen, readiness, schemaVersion, mode (прочие отбрасываются).
### tech.event `{level, code, message, version}` → `{ok}` — сообщение ≤ 500 символов; клиент заранее вырезает адреса почты и числа длиннее 3 цифр.
### reconciliation.template → `{ok, rules[], profiles[], reconciliation[]}`
### seed.package → `{ok, package, templates[], eventRules[], hazards[]}`
### ttk.library → `{ok, items[]}` (тариф Pro Max)

## 3. Обратный канал: диагностика

`GET <App URL клиента>?diag=<diagKey>` → JSON только для чтения: версия, лицензия (тариф, статус), обезличенные метрики, листы (имя и число строк), отсутствующие листы схемы, имена триггеров, сводка сверки по правилам, последние резервные копии, целостность аудита, очередь технических ошибок. Строк таблиц и персональных данных нет. Каждое чтение — запись `SUPPORT_DIAGNOSTICS_READ` в аудит предприятия. Ключ хранится у клиента хешем и истекает (≤ 8 ч); директор отзывает его досрочно («Подписка → Отозвать доступ»).

## 4. Коды ошибок

`Лицензия не найдена или отозвана`, `REPLAY`, `Подпись запроса не принята` (неверная подпись, окно времени, повтор, лицензия не ACTIVE), `Запрос доступа не найден`, `unknown action`, `internal error` (подробности — только в журнале ошибок админ-панели).

## 5. Совместимость

Новые поля добавляются только в конец объектов; клиент игнорирует неизвестные поля. Удаление или переименование поля — только с новой мажорной версией и периодом поддержки обеих.

## 6. Вход датчиков (система предприятия)

`POST <App URL предприятия>` с телом `{"device": "SNS-000001", "token": "<ключ устройства>", "value": 4.2, "humidity": 55}`.
Ответ: `{ok, result: PASS|FAIL|REVIEW, stored, closed}` или `{ok:false, error}`.

- Ключ выдаётся при подключении датчика («Настройка и готовность → шаг 4 → Подключить датчик»), показывается один раз; в таблице `SENSOR_DEVICES` — только SHA-256. Отключение датчика делает ключ недействительным.
- Не больше 30 запросов в минуту на датчик; значение — от −60 до 350 °C, влажность — 0–100 %.
- В журнал попадает показание не чаще раза в 15 минут, а также каждое отклонение и первое показание после отклонения; уведомление об отклонении — не чаще раза в час по объекту.
- Показание закрывает открытые задачи замера по объекту в окне −2 ч … +30 мин. Если датчик молчит, задача остаётся повару: система значение не подставляет.
- Прочие POST-запросы к системе предприятия отклоняются (`unknown request`).
