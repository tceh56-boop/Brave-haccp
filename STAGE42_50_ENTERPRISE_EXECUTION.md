# ЦЕХ CORE100 — Stage 42–50 Enterprise Execution Suite

Единый релиз следующих этапов, без промежуточных архивов между этапами.

## Stage 42 — Management Action Orchestrator
Единый backlog действий: источник, приоритет, ответственный, SLA, зависимость, evidence и закрытие. KPI Variance автоматически превращается в управленческое действие с идемпотентной защитой от дублей.

## Stage 43 — Workforce Capacity
Планирование требуемых/плановых часов и ориентировочной стоимости труда по точке/цеху. Read-model показывает gap и статус мощности.

## Stage 44 — Supplier Performance
Scorecard поставщиков на основе существующих purchase requests. Результаты сохраняются по периоду и поставщику; повторный запуск обновляет тот же scorecard.

## Stage 45 — Inventory Optimization
Политики min/max/safety stock и FEFO/expiry signals. Слой только диагностический и не выполняет автоматические списания или закупки.

## Stage 46 — Production Capacity
План доступных и плановых часов производства и контроль utilization/capacity overload.

## Stage 47 — Menu Engineering
Сводка продаж по блюдам с quantity, revenue, ingredient cost, margin и margin %. Используются существующие факты SALES.

## Stage 48 — Scenario Planning
What-if расчёты по изменению выручки и себестоимости относительно Board Pack. Сценарий не меняет фактические данные.

## Stage 49 — Execution Plans
Единый операционный план и его items с источником, приоритетом, ответственным, сроком, зависимостями и evidence.

## Stage 50 — Enterprise Command Center
Объединяет Compliance Cockpit, Workforce Capacity, Production Capacity, Inventory Signals, KPI Variances и Management Action backlog в единый статус GREEN / ATTENTION / BLOCKED.

## Безопасность
- Все API проходят существующий `processOperation` и RBAC.
- Для новых действий используется модуль `enterprise_control`.
- ADMIN получает доступ через `all`; DIRECTOR/MANAGER/ACCOUNTANT получают явный модуль.
- Location/tenant scope проверяется сервером.
- Автоматический trigger только создаёт KPI-derived management actions и уведомляет о проблемах; хозяйственные операции автоматически не проводятся.

## Ограничения
Workforce и Supplier scorecard используют только данные, которые реально присутствуют в существующих таблицах. Если исходных данных недостаточно, система возвращает gap/NO_DATA, а не придумывает показатель.

## Проверка
Полная синтаксическая проверка всех GAS-файлов должна выполняться перед деплоем; runtime-проверка Google Sheets требует запуска `initializeDatabase()` и UAT в конкретной таблице.
