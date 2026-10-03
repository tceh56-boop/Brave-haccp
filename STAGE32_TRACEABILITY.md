# ЦЕХ CORE100 — Stage 32: Unified Traceability & Reconciliation

## Назначение
Единый read-only граф сквозной трассируемости поверх существующих первичных таблиц.

Цепочка:
`закупка/приход → партия → склад → производство → расход → отход → HACCP → продажа → себестоимость → Recall`

Stage 32 не изменяет первичные бизнес-данные автоматически.

## API
- `GET_UNIFIED_BATCH_TRACEABILITY`
- `GET_UNIFIED_SALE_TRACEABILITY`
- `GET_UNIFIED_PRODUCTION_TRACEABILITY`
- `RUN_TRACEABILITY_RECONCILIATION`
- `GET_TRACEABILITY_SUMMARY`
- `GET_TRACEABILITY_RUN`

## Reconciliation
Проверяются:
- остаток партии против складских движений;
- выход производства против выходной партии;
- наличие фактического расхода у завершённого производства;
- отрицательные количества;
- ссылки партия→продукт;
- ссылки продажа→блюдо;
- продажи без фактического расхода;
- HACCP evidence с отсутствующей партией.

Все расхождения только диагностируются. Исправление выполняется через существующий reconciliation workflow Stage 31.

## Ограничения
- graph/reconciliation limit: 500 records;
- количественный tolerance: 0.01;
- tenant/location scope обязателен;
- финансовые суммы не перепроводятся автоматически.
