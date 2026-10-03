# ЦЕХ — Stage 41: KPI Targets & Variance Management

Управленческий слой `Plan → Fact → Variance → Action → Owner → Deadline`.

## Принцип

KPI targets не являются бухгалтерскими нормативами. Они используются для управления и не меняют первичные факты.

## Метрики

- revenue — MIN
- gross_margin_pct — MIN
- prime_cost_pct — MAX
- operating_profit — MIN
- cash_net — MIN
- writeoffs — MAX
- compliance_score — MIN

## API

`GET_KPI_METRIC_CATALOG`, `GET_KPI_TARGETS`, `CREATE_KPI_TARGET`, `RUN_KPI_VARIANCE`, `GET_KPI_VARIANCES`, `CREATE_KPI_ACTION`, `GET_KPI_ACTIONS`, `COMPLETE_KPI_ACTION`.

## Автоматизация

`kpiTargetsStage41Trigger_` запускается ежедневно, рассчитывает отклонения предыдущего завершённого месяца и уведомляет только при `ATTENTION`.
