# CORE100 Stage 51–60 — Digital Factory Layer

Единый пакет следующих десяти этапов.

## 51 — Shift Dispatcher
Планы смен, назначения сотрудников, контроль недоукомплектованности/перераспределения часов.

## 52 — Labor Productivity
Read-only показатель выпуска на плановый трудовой час.

## 53 — Procurement Cycle
Контроль открытых/просроченных закупочных запросов и создание управленческого действия.

## 54 — Workshop Performance
Сводка операций и выпуска по цехам за период.

## 55 — Production Calendar
Календарь производства и строки календаря с workshop/production plan/qty/priority.

## 56 — Unit Economics
Агрегация продаж по блюдам: количество, выручка, средняя цена.

## 57 — Digital Twin Snapshot
Единый read-model снимок состояния точки поверх Enterprise Command Center, смен, закупок и цехов.

## 58 — Scenario Execution Bridge
Связывает сценарный расчёт с execution layer, но гарантирует `simulation_only=true` и пустой список мутаций.

## 59 — Operational Alerts
Единый набор оперативных сигналов: staffing, procurement и enterprise status.

## 60 — Digital Factory Command Center
Объединяет Digital Twin, labor productivity, unit economics и alerts в статус `GREEN/ATTENTION/BLOCKED`.

## API
- `CREATE_SHIFT_PLAN`
- `GET_SHIFT_PLANS`
- `CREATE_SHIFT_ASSIGNMENT`
- `GET_SHIFT_DISPATCHER`
- `GET_LABOR_PRODUCTIVITY`
- `GET_PROCUREMENT_CYCLE`
- `CREATE_PROCUREMENT_CYCLE_ACTION`
- `GET_WORKSHOP_PERFORMANCE`
- `CREATE_PRODUCTION_CALENDAR`
- `ADD_PRODUCTION_CALENDAR_ITEM`
- `GET_PRODUCTION_CALENDAR`
- `GET_UNIT_ECONOMICS`
- `GET_DIGITAL_TWIN`
- `RUN_EXECUTION_SCENARIO`
- `GET_OPERATIONAL_ALERTS`
- `GET_DIGITAL_FACTORY_COMMAND_CENTER`

## Safety
Новый слой не проводит автоматически деньги, складские движения, списания или фактическое производство. Сценарии остаются simulation-only. Все записи ограничены organization/location scope.
