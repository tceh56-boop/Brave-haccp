# ЦЕХ — CORE100 Hardening Pack 101–105

## Назначение
Закрытие P0/P1 findings из security-аудита CORE100 Stage 100 без изменения базовой бизнес-модели.

## Выполнено

### 101 — Server-side Execution Preflight
- `qualityPassed`, `haccpPassed`, `financialPreviewPassed` от клиента больше не являются источником истины.
- Quality gate пересчитывается сервером по Critical Incidents и Quarantine.
- HACCP gate пересчитывается через текущий PPK/HACCP read model.
- Preflight повторяется непосредственно перед исполнением.

### 102 — Execution Identity Binding
- `processOperation()` вызывается только с `s.token` текущей серверной сессии.
- Отдельный `data.sessionToken` больше не используется.
- Execution Request привязан к `requested_by`.
- Proposal fingerprint фиксируется сервером.
- Добавлен короткоживущий execution nonce (5 минут).

### 103 — Authoritative Financial Preview
- Preview получает закупочную цену из `PRODUCTS` для PROCUREMENT.
- Preview получает себестоимость и цену продажи из `DISHES` для PRODUCTION.
- Клиентские `unitCost` и `estimatedRevenue` больше не используются как authoritative values.
- `GET_EXECUTION_FINANCIAL_PREVIEW` использует тот же серверный расчёт.

### 104 — Frontend Security Hardening
- Закрыты обнаруженные прямые HTML-вставки для критичных справочных данных через `compEsc`.
- Идентификаторы в нескольких inline handlers переведены на `jsArg`.
- `ALLOWALL` заменён на `XFrameOptionsMode.DEFAULT`.

### 105 — Security Evidence
Добавлен `Core100HardeningStage101to105.gs` и API `GET_CORE100_HARDENING_STATUS` для структурной проверки hardening-слоя.

## Важное ограничение
Этот пакет не заменяет реальный Apps Script/Sheets/Drive UAT. Runtime-проверки, конкурентность, квоты, backup restore и adversarial tests должны быть выполнены в тестовой копии рабочей таблицы.
