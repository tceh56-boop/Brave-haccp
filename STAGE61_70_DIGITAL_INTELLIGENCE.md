# CORE100 Stage 61–70 — Digital Intelligence Layer

## Назначение
Единый слой коммерческой аналитики, demand sensing, MRP, unit economics, labor forecast и Digital Twin 2.0.

## Этапы
- 61 Customer/Sales Intelligence — выручка, объём, себестоимость и contribution по каналу происхождения продажи.
- 62 Demand Sensing — взвешенный прогноз по 7/28/56 дням.
- 63 Material Requirements — потребность сырья по рецептурам и прогнозу спроса с учётом доступных партий.
- 64 Cost-to-Serve — добавочная стоимость обслуживания канала.
- 65 Channel Margin — contribution и доля выручки канала.
- 66 Dynamic Menu Signals — сигналы низкого спроса/отрицательной unit margin; цены автоматически не меняются.
- 67 Labor Forecast — прогноз трудовых часов на основе forecast output и заданного коэффициента.
- 68 Procurement Forecast — список net requirements из MRP.
- 69 Enterprise Forecast — объединённый forecast snapshot без записи факта.
- 70 Digital Twin 2.0 — объединение Stage 60 и нового forecast слоя.

## Безопасность
`GET_*` слой read-only. `RUN_DEMAND_SENSING` и `RUN_MATERIAL_REQUIREMENTS` сохраняют только плановые snapshots. Ни один этап 61–70 не проводит деньги, склад, производство или закупку автоматически.

## Ограничения
Forecast является детерминированным operational forecast, а не гарантией будущего спроса. При отсутствии истории прогноз соответствующего блюда отсутствует.
