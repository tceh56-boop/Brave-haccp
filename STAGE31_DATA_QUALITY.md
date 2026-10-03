# ЦЕХ CORE100 — Stage 31 Data Quality & Reconciliation Engine

## Назначение

Stage 31 добавляет диагностический слой качества данных поверх существующей модели. Он **не исправляет первичные данные автоматически**.

Контур:

`PRODUCTS / BATCHES / RECIPES / SALES / WAREHOUSE_OPS → audit → issue → reconciliation case → human resolution`

## Контроли

- битые ссылки партия → продукт;
- отрицательные количества партий;
- битые ссылки рецептуры → parent;
- битые ссылки продаж → блюдо;
- отрицательные количества продаж;
- битые ссылки складских операций → партия;
- кандидаты дублей продуктов по нормализованному имени;
- scope организации/точки.

## Безопасность

`RUN_DATA_QUALITY_AUDIT` — только чтение и доступ через dashboard.

Создание/закрытие reconciliation case требует `master_data_admin`.

Никакой автоматической коррекции PRODUCTS/BATCHES/RECIPES/SALES/WAREHOUSE_OPS не выполняется.

## API

- `RUN_DATA_QUALITY_AUDIT`
- `GET_RECONCILIATION_CASES`
- `CREATE_RECONCILIATION_CASE`
- `RESOLVE_RECONCILIATION_CASE`

## Ограничения

Batch limit: 200.

Следующий этап может добавить специализированные reconciliation-процедуры для складских остатков, себестоимости и цепочки traceability, но только через явное подтверждение.
