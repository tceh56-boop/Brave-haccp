# Mon Chef V21 — закупка и приёмка

## Цель
Замкнуть недельный диспетчер в реальный цикл закупки:

`недельный дефицит → заявка → заказ поставщику → ожидаемая поставка → скан накладной/этикеток → сверка → подтверждение → реальные партии → склад → повторный расчёт`.

## Основные функции
- `createWeeklyPurchaseRequests(planId, token)` — создаёт заявки по дефицитам.
- `createSupplierOrdersFromWeeklyPlan(planId, dueDate, token)` — группирует открытые заявки по поставщику и создаёт черновики заказов.
- `startPurchaseReceiving(orderId, documentRef, expectedDate, token)` — открывает сессию приёмки и переносит ожидаемые строки заказа.
- `addPurchaseReceivingLabel(sessionId, labelJson, token)` — добавляет фактически отсканированную этикетку.
- `getPurchaseReceiving(sessionId, token)` — показывает сверку.
- `finalizePurchaseReceiving(sessionId, token)` — только после подтверждения создаёт реальные партии через существующее ядро `_incomeWithBatches_`.
- `getWeeklyPurchaseAfterReceiving(planId, token)` — показывает остаточный дефицит после фактического прихода.
- `runMonChefProcurementCycle(token)` — пересчитывает следующую неделю и создаёт заявки по дефицитам.

## Важное правило
OCR/сканирование само по себе **не делает приход**. Фактический приход создаётся только при `finalizePurchaseReceiving` после серверной проверки ожидаемых/фактических количеств.

## UI
`Procurement.html` доступен через `?procurement=1&token=...`.
