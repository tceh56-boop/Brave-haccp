# Stage 40 — Enterprise KPI & Board Pack Engine

Единый управленческий snapshot поверх существующих read-model:
Management Economics, Loss Engine, Cash Flow, Plan/Fact, Control Tower и Compliance Cockpit.

## Принцип

Board Pack не является бухгалтерской отчётностью и не заменяет регламентированный учёт.
Он не изменяет первичные хозяйственные данные. В `BOARD_PACKS` сохраняется только snapshot
и SHA-256 payload для последующей проверки целостности.

## API

- `GET_ENTERPRISE_BOARD_PACK`
- `GET_ENTERPRISE_BOARD_PACKS`
- `CREATE_ENTERPRISE_BOARD_PACK`
- `VERIFY_ENTERPRISE_BOARD_PACK`

Если период не задан при создании, берётся последний полностью завершённый календарный месяц.

## Статусы

- `GREEN` — нет CRITICAL/HIGH сигналов в Operations/Compliance cockpit.
- `ATTENTION` — есть HIGH сигналы.
- `BLOCKED` — есть CRITICAL сигналы.

Это операционная классификация состояния, а не бухгалтерская или юридическая оценка.

## Состав

- P&L и сравнение с предыдущим равным периодом;
- Cash Flow и 30-дневный cash forecast;
- Plan/Fact;
- Loss Engine;
- Control Tower;
- Compliance Cockpit;
- критические и attention действия.

## Автоматизация

`enterpriseBoardPackStage40Trigger_` запускается ежедневно, формирует snapshot последнего
завершённого месяца и уведомляет только при `ATTENTION/BLOCKED`.
