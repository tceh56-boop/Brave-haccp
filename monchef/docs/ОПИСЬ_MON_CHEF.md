# MON CHEF — полная функциональная опись модулей и механик

Источник: код `mc_app` (Code.gs 15 564 строк / ~1 МБ, 96 файлов `MonChef_*.gs`, `zz_/zzz_*.gs`, 24 HTML-страницы, Console.html ~755 КБ) и документы ДОК_0–ДОК_8, REPORT_MON_CHEF_READINESS.md (прогон 19.10.2026, статус **NOT_READY** по данным предприятия; T30 — единственный FAIL).
Платформа: Google Apps Script + одна Google-таблица (≈260 листов: 22 журнала СанПиН, 107 служебных листов модулей) + Google Drive + Yandex Vision/YandexGPT + ВетИС.API «Меркурий».
Опись — только чтение, ничего не изменялось.

## Шкала зрелости (оценка по коду, а не по README)

- **✅ работает** — серверная логика полная, есть экран, связи с соседними модулями реально вызываются.
- **🟡 частично** — логика есть, но: нет экрана (только шлюз/сервер), не поставлен в планировщик, зависит от внешних ключей/данных, не проверено на реальном сервисе, либо дублирует более новый модуль.
- **⚪ заглушка** — тонкий слой/имитация, устаревшая обёртка (`return 0`, `return generateJournalPending()`), или код без вызовов.

Метод: перечень публичных функций по каждому файлу (872 функции, из них 512 под шлюзом ДОК_8) сопоставлен с вызовами из HTML-экранов (`run()/vCall()` в Console.html и рабочих страницах), с внутренними перекрёстными вызовами и с реестром планировщика `MC_SCHEDULE`.

## Сквозная схема

```
Банкет (ручной / скан бланка OCR) → меню (ТТК) → раскладка через п/ф до сырья
   → резерв Склад_Резервы (физический склад не трогается) → канбан-задачи из шагов заготовки
   → недельный план / дефициты / закупка (V14, V20, V21, V48–V52)
Приход: накладная (OCR) → партия в КАРАНТИН → входной контроль (+ВСД «Меркурий») → active
   → места хранения, этикетка с QR → FEFO-расход
Производство п/ф: заказ → старт → замеры ККТ (блок без них) → выпуск: FEFO-списание сырья,
   новая партия с себестоимостью, TRACE_LINKS, автобракераж J02, ККТ-журналы J22–J24
   → пересборка резервов банкетов
Выдача (V28): только партия с бракеражем RELEASE + суточной пробой + выполненными ККТ → J36 продажи
Закрытие (V29): обслужено / возврат (в карантин) / брак
Все действия → OperationID → Audit_Log (цепочка хешей) → FACT → правила → отклонение → КД → блокировка объекта → уведомление
```

---

## 1. Склад и приход

### 1.1 Приёмка товара по накладной — ✅ (OCR-часть 🟡)
- **Назначение:** приход по скану накладной/этикетки с созданием партий в карантине и печатью маркировки.
- **Функции:** `stockReceiveSuggest`, `stockReceiveScanInvoice`, `stockReceiveScanLabel`, `stockReceivePhoto`, `scanProductLabel`, `stockReceiveSave`, `createBatchFromReceiving`, `stockReceiveRecent`, `stockReceiveLabelsPrinted` (MonChef_Receiving.gs, экран Income.html); старые `recognizeProductLabel`, `confirmLabelIncome`, `scanInvoice*`, `previewReceiveFromInvoice`.
- **Листы:** Склад_Партии, Приёмка_Партии (паспорт партии), OCR_Этикетки, Документы_Сырьё, Продукты_Справочник, Склад_Операции, Журналы_Ожидания.
- **Механика:** скан (фото/PDF, несколько листов склеиваются по номеру накладной) → строки сопоставляются с номенклатурой (оценка похожести, «проверьте» при неточном совпадении) → ручная правка → «Принять» → по каждой строке `_createBatch_` (номер MC-ГГГГММДД-NNNNNN под блокировкой) со статусом `quarantine`. Срок «годен до»: ручная дата с упаковки всегда главнее; иначе срок из продуктовой матрицы по режиму хранения (из диапазона «3-5 дней» берётся меньшее, ≤72 ч печатается с часами); нет данных — «СРОК НЕ УКАЗАН», дата не выдумывается; просроченный товар не принимается. Кто принял — только из сессии. Хук `_hookПриёмка_` ставит строку J03 (+копия ККТ-1 J21) с адресными вопросами: t° в таре (≤6 °C, критично), органолептика, решение. Изменение цены к прошлой закупке → `priceAlerts`. Запись пачкой под одной блокировкой (`MC_WRITE_BUFFER`).
- **Роли:** Шеф, Су-шеф, повара холодного/горячего цеха, Директор; Кондитер — индивидуально.
- **Ограничения:** распознавание требует ключей Yandex Cloud; на стенде OCR подменён.

### 1.2 OCR-движок документов (V9–V13, PdfOcr) — 🟡
- **Назначение:** распознавание накладных, чеков и этикеток.
- **Функции:** `scanInvoiceV10/V11/V12`, `scanProductReceiptV1x`, `rememberOcrAlias(V12)`, `getOcrAliasSuggestions`, `getOcrAutopilotStats`, `scanInvoiceV13`, `previewReceiveFromInvoiceV13`, `getFiscalQrStats`, `mcV9DocumentProfile/ClassifyDocumentType/ValidateDocumentCapture/DocumentWorkflow`; `_mcOcrAsync_` (PdfOcr), `scanInvoiceSmart`, `_yagptParseInvoice_`.
- **Механика:** Yandex Vision (page + handwritten), многостраничный PDF — асинхронно, координаты страниц сдвигаются для сборки таблицы; V11 чистит текст (0/O, латиница/кириллица), память синонимов; V12 — «отпечатки» поставщиков и второй проход проверки; V13 — фискальный QR чека как дополнительное доказательство (сверка с OCR).
- **Связи:** Приёмка вызывает `scanInvoiceV12` (тот вызывает V11 → V10). **V13 и V9 ни экраном, ни другим модулем не вызываются** — мёртвый код или задел.

### 1.3 Ядро склада: остатки, операции, цены — ✅
- **Функции:** `stockAddIncome`, `stockAddIncomeWithExpiry`, `stockAddSemiProduct(WithExpiry)`, `stockWriteOff`, `getStockBalances`, `getStockOps`, `getStockBatches`, `getExpiringBatches`, `getStockExpirySummary`, `writeOffExpiredBatch`, `getPriceIncreaseLog`, `reconcileStock`, `rebuildStockFromLedger`, `mergeDuplicateProducts`, `getLedgerBalance`, `mcStockOpsData` (журнал склада, экран stockops).
- **Листы:** Склад_Остатки (сводка по названию), Склад_Операции (журнал), Склад_Партии.
- **Механика:** каждая операция пишется в журнал и меняет сводный остаток (`_applyStockDelta_`) и партии; сверка «журнал ↔ остатки» в три шага (сверка без изменений → отчёт → перезапись из журнала); средняя цена остатка и цена последней закупки; лог роста цен в обе стороны.
- **Ограничение:** Склад_Остатки сводится по названию, а не по ProductID.

### 1.4 Норма запаса (минимальный остаток) — ✅
- **Функции:** `previewMinStock`, `recalcMinStock`, `setMinStockMode`, `setMinStockConfig`, `autoRecalcMinStock` (по понедельникам в 06:00).
- **Механика:** оборот за N дней (`_turnoverByProduct_`) × страховой % → норма; «дней запаса» = остаток / расход в день; позиции в режиме «вручную» не пересчитываются.

### 1.5 Заказы поставщикам — ✅
- **Функции:** `createSupplierOrder`, `getSupplierOrders`, `sendSupplierOrder`, `confirmSupplierOrder`, `cancelSupplierOrder`, `receiveSupplierOrder`, `previewReceiveFromInvoice`, `mcOrderUpdateItems`, `mcOrderDelete` (Orders.html).
- **Механика:** статусы заказа, приёмка заказа создаёт партии; сопоставление строк накладной с заказом через `_nameMatchScore_`; заказ у поставщика со статусом BLOCKED не создаётся.

### 1.6 Справочники с ID: поставщики, товары и единицы (MasterData, V53, TtkIds) — ✅
- **Функции:** `mcGetSuppliers`, `mcSaveSupplier`, `mcMigrateSuppliers`; `setupV53ProductUnits`, `v53RebuildProductIds`, `v53BuildMappings`, `v53SetManualMapping`, `v53ConvertQty`, `v53NormalizeRequirement`; `mcMigrateTtkProductIds`.
- **Листы:** Поставщики (SupplierID, ИНН, ACTIVE/REVIEW/BLOCKED), Продукты_ID_V53, Продукты_Сопоставление_V53, Продукты_Единицы_V53.
- **Механика:** стабильный ProductID; синонимы названий (используются только APPROVED); безопасный перевод единиц (кг↔г, л↔мл, шт); каждая партия получает ProductID и SupplierID (`_mdStampBatch_`); новый поставщик из прихода попадает в реестр как REVIEW. Экран «Товары и единицы» (productunits).

### 1.7 Корректировка проведённой накладной — ✅
- **Функции:** `mcReceiptCorrectionCreate`, `mcReceiptCorrectionDecide`, `mcGetReceiptCorrections`. Лист Корректировки_Накладных.
- **Механика:** «правило четырёх глаз»: создаёт Шеф/Су-шеф/Директор с причиной, утверждает Директор с индивидуальным правом `doc_edit`, причём не автор → партия меняется, в историю партии пишется событие CORRECTION, паспорт остаётся как был.

### 1.8 Списание по акту и приход п/ф — ✅
- **Функции:** `mcWriteOffData`, `mcWriteOffPreview`, `mcWriteOffAct`, `mcPfIncomeData`, `mcPfOpeningBalance`. Лист Акты_Списания.
- **Механика:** 7 причин; строка акта — продукт или блюдо/п/ф по ТТК (раскладка до продуктов, готовые п/ф берутся первыми); сначала расчёт, потом проведение по принципу «всё или ничего»; FEFO; просроченное нельзя списать на питание персонала, проработку и представительские; себестоимость — средняя цена; трассировка «списана по акту». «Остаток п/ф на начало» создаёт партию без списания сырья, себестоимость по ТТК.
- **Ограничение:** проведённый акт не отменяется.

### 1.9 Ревизия (V49) — ✅
- **Функции:** `v49CreateRevision`, `v49SeedRevisionFromStock`, `v49AddRevisionLine`, `v49CountRevisionLine`, `v49PostRevisionLine`, `v49CompleteRevision`, `v49GetDashboard`, `v49GetOpenLines`.
- **Механика:** физический пересчёт как источник истины; каждое расхождение → корректировка партии + аудит, без молчаливой перезаписи. Экран revision.

### 1.10 Дефициты, излишки и их связка (V48, V50, V51, V52) — 🟡
- **Функции:** `v48AnalyzeDeficits`, `v48CreateCorrectiveTasks`, `v48ResolveClosedDeficits`; `v50AnalyzeSurplus`, `v50ReserveRecommendation`, `v50ApproveRecommendation`, `v50ReleaseReserve`; `v51FindCoverage`, `v51CoverDeficit`, `v51BuildDispatchPlan`; `v52RecalculateDeficits`, `v52PublishPlans`, `v52ApprovePlan`.
- **Механика:** дефицит банкета объясняется по причине и превращается в одну идемпотентную задачу V44; излишек (партия с риском по сроку) сопоставляется со спросом банкетов и производства — получаются рекомендации и резервы; V51 покрывает дефицит излишком (без молчаливого списания); V52 пересчитывает дефицит обратным ходом по ТТК в план ресурсов (только после утверждения).
- **Почему 🟡:** анализы показываются в разделах «Дефициты» и «Излишки» (uiData), но автотики `v48/v50/v51AutomationTick` **не внесены в MC_SCHEDULE**, а резервы и утверждение рекомендаций V50 (`v50Reserve*`, `v50Approve*`) экраном не вызываются.

### 1.11 Ресурсный движок склада (V54) — 🟡
- **Функции:** `v54MigrateBatchResourceIds`, `stockEngineConsumeSpecificBatch`, `stockEngineAdjustBatch`, `v54CreateReservation`, `v54ReleaseReservation`, `v54GetFreeBatch`, `v54GetDashboard`, `v54Readiness`.
- **Механика:** каноническая единица и ProductID для партии, транзакционный фасад над Склад_Партии.
- **Почему 🟡:** реальный расход идёт через `_fifoConsume_`; фасад `stockEngineConsumeSpecificBatch` упоминается только в структурном тесте V61. Используются миграция (через V55) и дашборд.

### 1.12 Закупочный контур недели (V21) — 🟡
- **Функции:** `createWeeklyPurchaseRequests`, `createSupplierOrdersFromWeeklyPlan`, `startPurchaseReceiving`, `addPurchaseReceivingLabel`, `finalizePurchaseReceiving`, `getWeeklyPurchaseAfterReceiving`. Листы Приемка_V21, Приемка_Строки_V21.
- **Механика:** дефицит → заявка → заказ → ожидаемая поставка → сессия приёмки со сверкой строк.
- **Почему 🟡:** экран показывает только заявки (3 из 10 функций). Сессии приёмки V21 дублируют основную приёмку 1.1. `runMonChefProcurementCycle` не в планировщике.

---

## 2. Партии и FIFO/FEFO

### 2.1 FEFO-ядро расхода — ✅ (одна из центральных механик)
- **Функции:** `_fifoConsume_`, `_mcAvailableBase_`, `getStockAvailability`.
- **Механика:** подбираются партии того же продукта по названию **или по ProductID-синониму**; берутся только `active`, с остатком, с совместимой единицей и **не просроченные** (кроме утилизации с `allowExpired`). Сортировка по сроку годности (FEFO), партии без срока идут последними. Остаток списывается по партиям с переводом единиц (кг/г, л/мл; исправлена ошибка ×1000). Партия с нулевым остатком получает статус `consumed`. Возвращается список фактически использованных партий — он идёт в трассировку.
- **Кто вызывает:** выпуск производства, потребление резерва банкета, списание по акту, выдача V28, обработка сырья.

### 2.2 Жизненный цикл партии — ✅
- **Функции:** `getBatchCard`, `getBatchTimeline`, `getBatchAuditLog`, `getReverseBatchTraceability`, `splitBatch`, `moveBatch`, `openBatchContainer`, `setPostOpeningExpiry`, `calculatePostOpeningExpiry`, `useBatch`, `wasteBatch`, `returnBatch`, `correctBatchOperation`, `printBatchLabel`, `printOpeningLabel`, `mcGetStorageSetup`, `mcSaveStorageLocation`, `mcSeedStorageLocations`, `mcSaveProductStorage`, `mcSuggestPlace`, `mcBatchExpiryBoard`, `mcBatchExpiryWatchSystem` (раз в час). Экран BatchCard.html.
- **Листы:** Склад_Партии, Приёмка_Партии, Партии_События (только дописывание, цепочка SHA-256), Продукты_Хранение, Склад_Места_V22.
- **Механика:** одна партия — одна история. Статусы для людей (QUARANTINE / ACTIVE / OPENED / PARTIALLY_USED / EXPIRED / BLOCKED / RETURNED / CONSUMED / WASTED) выводятся из статуса хранения и истории, поэтому FEFO по-прежнему видит только `active`. После вскрытия действующий срок = min(срок производителя, вскрытие + срок после вскрытия). Срок после вскрытия берётся по порядку: с этикетки → из утверждённого профиля продукта → из утверждённого правила V38; иначе «НЕ ОПРЕДЕЛЁН». Деление и перемещение — по местам хранения с диапазоном t°. Исправление — отдельная операция CORRECTION, не правка. QR на этикетке открывает карточку партии (BarcodeDetector).

### 2.3 Контроль партий: карантин, входной контроль, допуск — ✅
- **Функции:** `mcGetBatchControl`, `mcRecordIncomingControl`, `mcSendBatchToRecheck`, `mcRejectBatch`, `mcGetBatchesForBrakerage`, `mcGetBatchRelease`, `mcSetIncomingControlMode`; внутренние `_bcReleaseState_`, `_bcClosePending_`. Экран BatchControl.html.
- **Листы:** Входной_Контроль, Выпуск_Партий.
- **Механика:** статусы `quarantine → active | recheck | blocked`. Решение **вычисляется** из введённых t°, органолептики, упаковки и документов. Правило REQUIRES_VET_DOCUMENT: без погашенного ВСД партия не допускается. Если в реестре есть термометры, прибор обязателен, а прибор с истёкшей поверкой не принимается. Ответы закрывают вопросы J03/J21 в той же строке журнала. `_bcReleaseState_` — допуск к выдаче: active + не просрочена + бракераж RELEASE + суточная проба + выполненные ККТ.
- **Аварийное отключение:** `MC_INCOMING_CONTROL=off` — пишется в аудит и блокирует готовность.

### 2.4 Места хранения / FEFO-резервы / этикетки V22 — 🟡
- **Функции:** `initMonChefV22Storage`, `importMonChefV22ProductCatalog`, `suggestBatchStorage`, `assignBatchStorage`, `getFEFOBatches`, `reserveFEFO`, `createBatchLabel`, `getBatchLabelData`, `getStorageDashboardV22`. Листы FEFO_Резервы_V22, Склад_Правила_V22, Продукты_V22.
- **Связи:** `getFEFOBatches` и `reserveFEFO` используют V23, V26 и V28; `createBatchLabel` — V27. Подсказку места в интерфейсе даёт новый `mcSuggestPlace`, поэтому `suggestBatchStorage` экраном не вызывается. Собственного экрана нет.

### 2.5 Отбор партий под производство (V23) — 🟡
- **Функции:** `createProductionPickPlan`, `getProductionPickPlan`, `confirmProductionPick`, `scanProductionPick`, `cancelProductionPick`. Лист Отбор_V23.
- **Механика:** FEFO-план отбора, резерв до отбора, подтверждение сканом партии.
- **Почему 🟡:** экран picking показывает план; основной выпуск списывает сырьё сам через `_produceCore_`, так что отбор — параллельный необязательный шаг.

### 2.6 Прослеживаемость (V5, Traceability.gs, V7) — ✅ (ядро) / 🟡 (фасад по ТЗ)
- **Функции:** ядро `_mcCreateTraceLink_` и `_mcTraceGraph_`; `getForwardTrace`, `getReverseTrace`, `getTraceGraph`, `getTraceabilityReport`, `getAuditCanonicalTrace`; фасад `getBatchTraceability`, `getReverseTraceability`, `getProductionChain`, `getRawMaterialTraceability`, `getDishTraceability`; `syncMonChefProductionTrace`, `getBatchFullTrace`.
- **Лист:** TRACE_LINKS (с хешем), BatchRelations — для совместимости.
- **Механика:** связи пишут приёмка, производство («РАСХОДОВАНА_НА», «ВЫПУЩЕНА_ПАРТИЯ», «ПО_ТТК»), обработка («ПРЕОБРАЗОВАНА_В»), пробы, выдача («ВЫДАНА_НА_БАНКЕТ»), списание, «Меркурий» — всего ~45 мест вызова. Прямой и обратный обход графа работает. Фасад Traceability.gs с именами из ТЗ экраном не вызывается (вход только через шлюз).

### 2.7 Автоконтроль сроков (V6) — ✅ (фон)
- **Функции:** `runMonChefControlCycle(System)` (раз в час).
- **Механика:** активная партия с истёкшим сроком → FACT → правило → отклонение и блокировка партии.

---

## 3. Производство и выпуск

### 3.1 Производственные заказы п/ф и выпуск — ✅ (центральная механика)
- **Функции:** `suggestProduction` (потребность в п/ф по банкетам на 7 дней), `planProduction`, `startProduction`, `completeProduction`, `cancelProduction`, `getProductionOrders`, `uiProductionBoard`, `uiPfTtk`; ядро `_produceCore_`, `_pfRawRequirement_`, `_resyncAllReservations_`.
- **Лист:** Производство (план, факт, партия, версия ТТК, себестоимость, распределение).
- **Механика выпуска** (под блокировкой, защита от повторного нажатия):
  1. если обязательные ККТ не выполнены, выпуск блокируется (`_tccpState_`, ответ CCP_REQUIRED);
  2. ТТК раскладывается через п/ф до сырья, готовые п/ф со склада берутся первыми;
  3. каждый продукт списывается по FEFO, а для каждой партии сырья пишется связь «РАСХОДОВАНА_НА»;
  4. выход приходуется новой партией с ценой = себестоимость / выход; создаётся FACT PRODUCTION_OUTPUT и связи с ТТК;
  5. автобракераж J02 — строка «ожидает оценки» и адресная проверка для комиссии;
  6. хук `_hookВыпуск_` по «Карты_ККТ» заводит строки ККТ-2/3/4 (J22–J24) с вопросами о t° в толще; если ККТ карты не заданы, технолог получает уведомление;
  7. витаминизация, если карта помечена;
  8. резервы всех банкетов пересобираются по дате (готовое достаётся ближайшему);
  9. событие PRODUCTION_COMPLETED уходит в V32.

  Если сырьё списано, а выпуск не оприходован, операция уходит в очередь восстановления (`_cascadeMarkForRecovery_`).
- **Роли:** Шеф и Су-шеф планируют и выпускают; повара и кондитер выполняют задания своего цеха.

### 3.2 Обязательные ККТ при выпуске — ✅ (нужны данные плана ХАССП)
- **Функции:** `mcGetTtkCcp`, `mcSetTtkCcp`, `mcGetProductionCcp`, `mcRecordProductionCcp`. Листы ТТК_ККТ, HACCP_ТочкиКонтроля_V30, HACCP_Факты_V31.
- **Механика:** технолог или ответственный за ХАССП назначает карте ККТ из плана. Пока по заказу нет факта в пределах по каждой ККТ, выпуск закрыт. Факт вне предела тоже блокирует: отклонение → КД → повторный замер. Карта без назначенных ККТ выпускается без замеров — это прямо указано в ограничениях.

### 3.3 Канбан / задания кухни — ✅
- **Функции:** `getKanbanTasks`, `getKanbanBoard`, `rebuildKanbanForEvent`, `updateKanbanTask`, `addKanbanTask`, `deleteKanbanTask`, `uiKanbanTasks`, `mcKanbanEvents`, `mcKanbanRebuild`, `savePrepSteps`. Лист Канбан_Задачи.
- **Механика:** при сохранении банкета каждая позиция меню разворачивается в задачи по шагам заготовки (JSON-массив в листе «Блюда»); если шагов нет — одна задача «Приготовить». Перестройка сохраняет выполненные шаги. Статусы todo → in_progress → done, распределение по цехам (`_dishWorkshopMap_`). «Готово» создаёт задание печати этикетки (3.10). Дефрост из обработки сырья тоже попадает в канбан.

### 3.4 Недельное планирование и диспетчер (V14, V20, V24, V25, V47) — ✅ / 🟡
- **V14** `getWeeklyOperationalPlan`, `rebuildWeeklyOperationalPlan`, цикл в 12:00: банкеты → блюда → п/ф и сырьё → закупка → задачи → дефициты (Недельный_План, План_Производства). ✅
- **V20** `getWeeklyDispatcher`, `createWeeklyDispatcherPlan`, `publishWeeklyDispatcherPlan`, `getWeeklyPurchasePlan`, цикл в 10:00 (Недельные_Планы, План_Закупок). ✅ — экран weekly.
- **V24** `getTTKProductionTree`, `buildWeeklyTTKDependencyPlan`: дерево «блюдо → п/ф → п/ф → сырьё». 🟡 — используется только V52, своего экрана нет.
- **V25** `buildV25ProductionSchedule`, `publishV25ProductionSchedule`, `seedV25TTKTimes`: обратный расчёт от времени банкета с длительностью, буфером и временем отбора по ТТК (Времена_ТТК_V25, Производство_План_V25). ✅ — экран scheduler.
- **V47** `v47RefreshDispatcher`, `v47BuildSnapshot`, `v47GetBanquetView`: единый вид «банкет → блюдо/п/ф → производство → партия → резерв → выдача → дефицит». ✅ — экран dispatcher.
- **V26** `buildV26Dispatch` и др. (планировщик + FEFO + закупка) — ⚪: ни экраном, ни модулями не вызывается.

### 3.5 Выпуск и экран смены (V27, V18, V19, V44, V45) — ✅
- **V27** `getV27ProductionBoard`, `startV27Production`, `completeV27Production` — обёртка над `completeProduction` (списание один раз).
- **V18/V19** `getMyOperationalTasks`, `getMyShiftDashboard`, `getChefShiftDashboard`, `startMyShift`, `endMyShift` — «Моя смена»: производство + HACCP + контроль одной очередью, циклы каждые 5 минут.
- **V44** единый центр задач: ручные и автоматические задачи в одном потоке (Задачи_Единый_V44), через `mcTaskCreate/Start/Complete`.
- **V45** задача → реальный производственный заказ → закрытие задачи.

### 3.6 Распределение выпуска по банкетам (V46) — 🟡
- **Функции:** `v46CreateAllocation`, `v46SeedFromProduction`, `v46ReserveAllocation`, `v46IssueAllocation`.
- **Механика:** одна партия на несколько банкетов: распределение не может превысить план, выдача — только после COMPLETED, с FACT, связью трассировки и строкой Выдача_V28. Логика полная, но экрана нет — работает только через шлюз.

### 3.7 Выдача готовой продукции на банкет (V28) — ✅
- **Функции:** `getV28BanquetFulfillment`, `issueV28Banquet`, `getV28BanquetIssueHistory`, `getV28BanquetDashboard`. Лист Выдача_V28.
- **Механика:** нужные готовые партии подбираются по FEFO; выдать можно только партию, прошедшую `_bcReleaseState_` (бракераж «отпуск», суточная проба, ККТ). Выдача пишет продажу J36. Резерв сырья и выдача готового — разные операции, двойного списания нет.

### 3.8 Закрытие банкета (V29) — ✅
- **Функции:** `getV29BanquetClosure`, `closeV29Banquet`, `getV29BanquetDashboard`. Листы Закрытие_V29, Факт_Банкет_V29, Карантин_Возврат_V29.
- **Механика:** по каждому выданному блюду вводятся «обслужено / возврат / брак», невязка контролируется; возврат уходит в карантин до решения ответственного; повторно закрыть нельзя.

### 3.9 Релизный стек V55–V63 (конец Code.gs) — ⚪
- **Функции:** `v55RunMigration`, `v56CreateProductionOrder`, `v57BuildWeeklyDispatcher`, `v58RunBanquetE2E`, `v59BridgeOperationalFact`, `v60Authorize`, `v61RunStructuralTests`, `v62CreatePilotPlan`, `v63EvaluateRelease`.
- **Почему ⚪:** однострочники. V58 E2E записывает 10 этапов со статусом READY без реальных операций; V59 пишет только PENDING; V57 считает дефицит = Qty; V61 проверяет `typeof` функций. Реальную работу выполняет только V55 — миграция через V54. Экран «Выпуск и пилот» доступен только техническому доступу.

### 3.10 Очередь печати этикеток заданий — ✅
- **Функции:** `getPrintQueue`, `getPrintJob`, `markPrintSent`, `confirmPrint`, `reprintPrintJob`. Листы Очередь_Печати, История печати.
- **Механика:** задание создаётся по «Готово» в канбане (защита от дублей); срок = из карты блюда, иначе по категории или 12 ч по умолчанию — это открытое замечание отчёта.

---

## 4. ТТК и полуфабрикаты

### 4.1 Каталог блюд и ТТК, раскладка — ✅
- **Функции:** `getData`, `saveDish`, `createDish`, `uiDishList`, `uiDishDetail`, `getSemiProducts`, `getProductNames`, `exportTTK`, `exportTTKBanquet`, `exportToSheet`; ядро `_buildDishIndexes_`, `_serverExplodeInto_` (рекурсивная раскладка через п/ф с защитой от циклов, поиск п/ф по точному, нормализованному и «свободному» имени), `_findSubDish_`, `_subYield_`.
- **Листы:** Блюда, Состав (брутто/нетто, ProductID, «ТТК п/ф»).
- **Механика:** количество п/ф пересчитывается через выход карты; поддерживается 0,5 порции (раскладка, резервы, канбан, закупка — ровно вдвое меньше).

### 4.2 Синхронизация ТТК с Диска — ✅
- **Функции:** `syncTTK`, `syncTTKScheduled` (05:00), `getTTKTree`, `_walkTTK_`, `_parseCard_`; MonChef_FileFormats.gs.
- **Механика:** обход папки ttk с подпапками; читаются .xls FastReport (XML), xlsx/xlsm/ods/двоичный xls (через конвертацию в Таблицу), csv, docx/odt/rtf и Google Документы, pdf (OCR Диска), txt; разбор карточки до строк состава. Лист ТТК_Папки.
- **Ограничение:** синхронизация обновляет рабочую карту напрямую, минуя черновик.

### 4.3 Версии ТТК и утверждение — ✅
- **Функции:** `getTTKVersions`, `getTTKVersionSnapshot`, `submitTTKVersion`, `approveTTKVersion`, `rejectTTKVersion`, `getTTKPendingApproval`, `migrateTTKToVersions`; `_effectiveTTKVersion_`.
- **Механика:** черновик → на согласовании → действующая → архив. Правка в приложении создаёт черновик, в производство идёт только утверждённая версия (право `ttk_approve`), номер версии фиксируется в заказе и бракераже.

### 4.4 История ТТК — ✅
- **Функции:** `mcTtkHistory`, `mcTtkCompare`, `mcTtkRestoreVersion`, `mcTtkArchive`. Листы ТТК_История (цепочка хешей), ТТК_Архив.
- **Механика:** кто (ФИО, роль), когда, какие поля изменились, было → стало (брутто, нетто, единица, выход, технология, хранение, срок); сравнение двух версий; возврат версии; архив вместо удаления.

### 4.5 Срок реализации, цех, заготовка, задвоения — ✅
- **Функции:** `setDishShelfLife`, `getDishesShelfLife`, `getDefaultShelfLife`; `classifyAllDishesByWorkshop`, `getDishesByWorkshop`, `getWorkshopList` (цех по ключевым словам); `savePrepSteps`; `mcFixDoubledCards` (поиск задвоенного состава).

### 4.6 Себестоимость — ✅ (на пилоте мало цен)
- **Функции:** `getDishCost`, `getDishesCosts`, `snapshotEventCost`, `getCostSnapshot`. Лист Себестоимость_Снимки.
- **Механика:** раскладка до сырья без учёта складских п/ф (себестоимость рецепта стабильна) × средняя цена остатка; позиции без цены помечаются `noPriceData`. Снимок себестоимости банкета фиксируется.

### 4.7 Фото блюд — ✅
- **Функции:** `mcDishPhotoScan`, `mcDishPhotoLink`, `mcDishPhotoUnlink`, `mcDishPhotoThumbs`, `getPhoto`, `savePhoto`. Лист Фото_Блюд.
- **Механика:** папка «Фото блюд» просматривается с подпапками (кеш списка 10 минут); имена с граммовками и пометками сопоставляются с ТТК («уверенная пара» или «из похожих»); привязку подтверждает человек; делаются уменьшенные копии.

### 4.8 Мастер ТТК и ТТК → ППК (V36, V37) — 🟡
- **Функции:** `v36ImportDriveFolder`, `v36BuildRecipeLinks`, `v36GetDashboard`; `v37CreateFromTtk`, `v37AddControl`, `v37Validate`, `v37Approve`.
- **Механика:** импорт с Диска в статусе REVIEW и граф рецептов; рабочая модель ППК/ХАССП по графу ТТК без выдуманных опасностей и пределов. Экраны (ttkmaster, ttkppk) показывают в основном дашборды, рабочие действия V37 экраном не вызываются.

### 4.9 Правила сроков и окна производства (V38, V39, V40) — 🟡
- **Функции:** `v38AddRule`, `v38ResolveRule`, `v38Calculate`, `v38BuildGaps`; `v39BuildWindow`, `v39CheckProductionAt`, `v39BuildBanquetWindows`; `v40SeedFromBundle` (ProductShelfLifeSeed.html, 1218 продуктов), `v40BuildTtkProductMap`, `v40GetProduct`.
- **Механика:** правило срока (по ТТК, шаблону продукта, папке или категории — по приоритету) действует только в статусе APPROVED и с источником; окно производства «не раньше / не позже» относительно банкета; пробелы — ТТК без правила.
- **Почему 🟡:** экранов нет; V38 используется только для срока после вскрытия партии и в V39; V40 ни с чем не связан.

---

## 5. Разбор сырья: зачистка, разбор на п/ф, дефрост

### 5.1 Обработка сырья — ✅
- **Функции:** `mcProcessPreview`, `mcProcessBatch`, `mcSetProcessedExpiry`, `mcSaveProcessingProfile`, `mcSaveProcessingSettings`, `mcGetProcessing`, `mcProcessingSources`, `mcProcDraftSave/List/Delete`, `mcProcTemplateSave`; legacy `createDisassemblyAct`, `getDisassemblyActs`, `getDisassemblyActDetail`, `getBatchLineage`, `getAllWasteNorms`, `saveWasteNorm`, `saveDisassemblyTemplate`. Экран Processing.html.
- **Листы:** Разбор_Акты, Разбор_Строки, BatchRelations, Нормы_Разбора, Шаблоны_Разбора, Обработка_Черновики.
- **Механика:** обрабатывается только допущенная партия (ВСД погашен, срок не истёк, не заблокирована); замороженную сначала нужно разморозить; FEFO-подсказка источника. Баланс: выход + отходы = взятое (±1,5 %); отходы сверяются с нормой; себестоимость сырья переходит на выход. Каждый п/ф — обычная партия MC-… с ParentBatchID и связью «ПРЕОБРАЗОВАНА_В». Срок п/ф — только с этикетки или по утверждённому профилю, более ранний и не позже срока сырья; для фарша срок с этикетки не применяется; без основания — «ждёт решения по сроку». Сохраняются шаблоны и черновики.

### 5.2 Дефрост (ККТ-4 ППК) — ✅
- **Функции:** `mcDefrostStart`, `mcDefrostMeasure`, `mcDefrostFinish`, `mcPublishDefrostTasks`, `mcProcessingWatchSystem` (каждые 30 минут). Лист Дефрост_Замеры.
- **Механика:** только в холодильнике, не дольше 12 ч, замер t° в толще каждые 4 ч; превышение → отклонение и блокировка партии; после дефроста — срок «после размораживания», повторная заморозка запрещена. Предел t° предприятие вводит из своей НД.

### 5.3 План обработки из банкетов — ✅
- **Функция:** `mcProcessingPlan`: сколько сырья разобрать или разморозить под банкеты; дефрост округляется до целых упаковок; задачи дефроста уходят в канбан.

---

## 6. Банкеты, OCR бланков, Канбан

### 6.1 Банкеты (CRUD, резервы) — ✅
- **Функции:** `getEvents`, `saveEvent`, `deleteEvent`, `syncEventStock`, `consumeEventReservations`, `getStockAvailability`, `migrateEventWriteOffsToReservations`. Листы Банкеты (JSON меню, blankIds), Склад_Резервы.
- **Механика:** сохранение банкета под блокировкой → прежние резервы снимаются → новые резервы по раскладке (с учётом готовых п/ф) → перестройка канбана. Физический склад при планировании не меняется; списание по резерву (`consumeEventReservations`) идёт по FEFO.
- **Роли:** Директор и Администратор создают; Шеф и Су-шеф смотрят (создают по индивидуальному праву).

### 6.2 Карточка банкета с закупкой — ✅
- **Функции:** `uiBanquetDetail`, `uiBanquetAliasSave`, `uiDishList`.
- **Механика:** потребность в продуктах через п/ф, остаток, резерв других банкетов, сколько купить, оценка суммы по средней цене, заказы поставщикам по банкету.

### 6.3 Распознавание банкетных бланков — 🟡 (ядро полное, без ключей Yandex не работает)
- **Функции:** `scanBlank`, `scanBlanksMulti`, `uiBanquetScan`, `uiBanquetSaveBlank`, `uiYandexCheck`, `saveBlankPhoto`; MonChef_BanquetOcr.gs (~80 КБ: `_bqRecognize_`, `_bqTable_`, `_bqoSkew_`, `_bqoColumnsByNumbers_`, `_bqgRefine_`, `_bqCompleteness_`, `_bqFracNote_`).
- **Листы:** Скан_Бланков_Журнал (SHA-256 файла, счётчики, вызовы GPT), ТТК_Синонимы.
- **Механика:** таблица собирается **по координатам слов**, а не по высоте строк. Наклон оценивается «веером», учитываются переворот и поворот, столбцы находятся по числам, смещение сетки компенсируется. YandexGPT уточняет только названия, с защитой от перестановки строк и повтором. Проверяется полнота: сумма строк против итога бланка. «0,5» берётся по пометке; дата с прошедшим годом вызывает вопрос. Выбор блюда человеком записывается в ТТК_Синонимы и в следующий раз подставляется сам. OpenCV на клиенте выпрямляет лист; можно сканировать пачкой.
- **Ограничение:** на стенде OCR подменён заглушкой.

### 6.4 Автожурналы по банкетам — ✅
- **Функции:** `autoFillJournalsFromEvents` (раз в час), `processEventJournalsManually`, `getProcessedEvents`. Лист Авто_Журналы_Обработанные.
- **Механика:** для наступивших банкетов заводятся J02, J03 и J36 по фактам банкета, без повторной обработки.

### 6.5 Журнал продаж J36 — ✅
- **Функции:** `addSaleEntry`, `addSaleEntriesBatch`, `getSalesStats`, `mcSaleData`, `mcSaleAdd`; автоматически пишет `_autoSales_` при выдаче. Связи с кассой нет.

---

## 7. ХАССП и журналы

### 7.1 Реестр журналов J01–J53 и листы — ✅
- **Функции:** `setupJournals`, `getJournalsConfig`, `getJournalEntries`, `addJournalEntry`, `getJournalStats`, `getJournalList`, `getJournalRegistry`. Журнал — `JOURNALS[]`: id, категория, частота, роль, колонки. Листы Ж_* (22), КТ*/ККТ* формы ХАССП, Журналы_Настройки.
- **Механика:** у каждой строки служебный «хвост»: кто внёс, должность, время сервера, источник, ID (JournalAuthor.gs — автор только из сессии). Закрытый подписью период не принимает записей (`_mcAssertJournalPeriodOpen_`).

### 7.2 Расписание → ожидаемые проверки → ответ — ✅ (ядро ХАССП-автоматизации)
- **Функции:** `createJournalTrigger`, `getJournalTriggers`, `setJournalTriggerActive`, `seedJournalTriggers`, `generateJournalPending` (05:00), `getPendingChecks`, `answerJournalCheck`, `checkPendingOverdue` (каждые 15 минут), `getJournalsCoverage`. Листы Журналы_Расписание, Журналы_Ожидания.
- **Механика:** система **не заполняет измерения**: она создаёт ожидаемую проверку с дедлайном, напоминает, отмечает просрочку и эскалирует. Ответ (число, «да/нет», «да/нет, при нет — число») записывается в ту же строку и колонку журнала. Режим «темп_да_нет» задаёт вопрос «Холодильник №5: +2 °C?» по установленной t°; ответ «да» ставит метку П, ответ «нет» требует число. Прежние автозаполнения (`autoFillMorning/Evening…`, `_addTempRows_`) превращены в заглушки — ⚪, оставлены как входы для старых триггеров.

### 7.3 Отклонения, корректирующие действия, критические инциденты — ✅
- **Функции:** `getJournalDeviations`, `recordCorrectiveAction`, `resolveCriticalIncident`, `_addCorrectiveAction_`, `_mcOpenDeviationAndAction_`, `getRecoveryQueue`, `getOperationTrace`. Листы Журналы_Отклонения, Корректирующие_Действия, Критические_Инциденты, ХАССП_Корректирующие_Действия.
- **Механика:** ответ вне предела → отклонение; при критической точке — инцидент с карантином или блокировкой объекта и задачей. Закрыть можно только корректирующим действием с доказательством.

### 7.4 Автозаполнение журналов по событиям (хуки) — ✅
- **Функции:** `_hookПриёмка_` (J03 + J21), `_hookВыпуск_` (J22/J23/J24 по Карты_ККТ, норма 74 °C по умолчанию), `_autoBrakerage_` (J02), `_hookВитаминизация_` (J10, Карты_Витаминизация), `autoRotationJournal` (06:00, партии со сроком ≤7 дней → J05 + КТ-9), `autoHealthJournal` (06:00, осмотр каждого активного сотрудника → J07 + КТ-7), `_autoMarking_` (Учёт_Маркировок), `autoLampRun` (наработка ламп).
- **Механика:** система вносит только свои факты (партия, время, поставщик, количество, кто). На каждую неизвестную колонку ставится адресный вопрос; до ответа строка в статусе «ожидает» и в отчётность как выполненная не идёт. За повторный запуск в тот же день дублей нет.

### 7.5 Печатные формы, «одна запись — несколько форм», Диск — ✅ (PDF не проверен на Google)
- **Функции:** `mcJournalForms`, `mcJournalForm`, `mcJournalsToDrive`, `refreshJournalsOnDrive` (03:00), `mcJournalNotApplicable`, `mcSanitaryDaySave` (J49), `mcDisinfectantNeedSave` (J50: площадь × расход × концентрация), `mcPpeIssueSave` (J52), `autoVerificationSample` (1-го числа, выборка J33), `mcVerificationResult`, `mcVerificationSampleNow`, `mcShiftClosingTick` (каждые 30 минут); MonChef_JournalFormsSpec.gs — колонки 53 бланков заказчика.
- **Механика:** базовая запись автоматически копируется в формы ХАССП (КТ-5, ККТ-1, КТ-6, КТ-7, КТ-8, КТ-9) с пометкой «копия J03 стр. 12»; копия обновляется вместе с базовой строкой. Журнал можно отметить «не применяется» с пересмотром через год. Шапка формы — из реквизитов утверждённого ППК.

### 7.6 Чек-листы смены и санитарии — ✅
- **Функции:** `setupChecklists`, `getChecklists`, `create/update/deleteChecklist`, `addChecklistItem`, `saveChecklistExecution`, `getChecklistExecutions`, `getChecklistDailySummary`, `autoCreateChecklistEntries` (раз в час), `mcChecklistRunData`, `mcChecklistHistory`, `dedupeChecklistItems`. Листы Чеклисты_Шаблоны/Пункты/Выполнение, Чеклисты_Смены (J11/J12; ХАССП-пункты критические).
- **Механика:** выполнение пишется в журнал (J09/J11/J12/J13); ✗ требует пояснения; автор — из сессии.

### 7.7 Подписание журналов — ✅ (внутренняя подпись, не КЭП)
- **Функции:** `validateJournalBeforeSigning`, `prepareJournalForSigning`, `signJournal`, `verifyJournalSignature`, `getJournalSignatures`, `getJournalSignature`, `revokeJournalSignature`, `getJournalIntegrity`, `createSignedJournalPdf`; MonChef_QrLib.gs. Лист Журналы_Подписи.
- **Механика:** подпись не срабатывает, если журнал пуст, есть пропущенные проверки, незаполненные измерения, нечисловые значения или незакрытые отклонения и КД. Хеш периода связан с хешем предыдущей подписи (цепочка), выдаётся код проверки; PDF содержит реквизиты и QR. Отзывает подпись только администратор с причиной: статус REVOKED, период снова открыт.

### 7.8 Исправления журналов — ✅
- **Функции:** `createJournalCorrection`, `getJournalCorrections`, `decideJournalCorrection`, `getJournalRowForCorrection` (Corrections.html). Лист Корректировки. Запрос «было → стало» с причиной; решение принимает другой сотрудник.

### 7.9 Уведомления и «ХАССП — сегодня» — ✅
- **Функции:** `getNotifications`, `markNotificationRead`, `runNotificationChecks`, `mcNotifyTick` (каждые 15 минут), `mcNotifySettings`, `mcNotifySettingsSave`, `mcHaccpToday` (HaccpToday.html). Листы Уведомления, Уведомления_Настройки.
- **Механика:** уведомление закрывается **условием** (повторный замер в норме, отклонение устранено), а не прочтением; пока условие не выполнено — повторы и эскалация по настройке типа; «липкие» уведомления вручную не закрываются. Письма уходят владельцу таблицы.

### 7.10 Единый реестр температур — ✅
- **Функции:** `mcSaveTempObject`, `mcRecordTemperature`, `mcTemperatureRecheck`, `mcTemperatureDecision`, `mcGetTemperatures` (Temperatures.html). Листы Температурные_Объекты, Температуры.
- **Механика:** все температуры (журналы, ККТ, входной контроль, пробы) сводятся в одно место без повторных отклонений. Отклонение → партия в карантин → КД → повторный замер → решение RELEASE или REJECT.

### 7.11 План ХАССП и ППК (V30, V35, V33) — ✅ / 🟡
- **V30** `v30SaveProcess/Hazard/Control/Monitoring/Verification/Ppk/Sanitation/PersonCompliance`, `v30GetMasterData`, `v30GetReadiness`, `v30BuildAuditSnapshot`: процессы → опасности (тяжесть × вероятность = риск) → CCP/OPRP → пределы → мониторинг → КД → верификация. ✅ сервер; 🟡 — экрана для плана мониторинга ККТ нет (только технический доступ, ограничение №24).
- **V35** конструктор ППК: `v35CreateDraft`, `v35AddProcess/Hazard/Control`, `v35ValidateDocument`, `v35Approve`, `v35SetOrganization` — ✅ (экран ppkbuilder). Реквизиты организации идут в шапки форм.
- **V33** нормативная матрица (СанПиН 2.3/2.4.4282-26 и др. зашиты в коде): `v33GetNormativeMatrix`, `v33RecordComplianceCheck`, `v33BuildReadiness` — 🟡: реестр нужно сверить с официальной публикацией.
- **V34** правила соответствия и покрытие контроля — ⚪: ни экраном, ни модулями не вызывается.

### 7.12 Факты, правила, блокировки (FullControlEngine, V5, RuleEngine, V31, V32, V7) — ✅ ядро / 🟡 фасады
- **Функции:** `createFact`, `getFacts`, `_mcCreateFactInternal_`; `evaluateFactRulesV5`, `getRuleEvents`, `getBlocks`, `releaseObjectBlock`; фасад по ТЗ `evaluateFact`, `evaluateCCP`, `createDeviationFromFact`, `createCorrectiveAction`, `blockObject`, `unblockObject`, `notifyResponsible` (экраном не вызываются — 🟡); V31 `v31RecordHaccpFact`, `v31CreateMonitoringTask` (вызывает ProductionCcp); V32 `v32EmitOperationalEvent` (старт и завершение производства → HACCP_События_V32 → задачи по HACCP_Триггеры_V32); V7 `runMonChefFullControlCycle` (каждые 30 минут).
- **Листы:** Факты (хеш), RULE_EVENTS, Блокировки, HACCP_Факты_V31, HACCP_Ожидания_V31, HACCP_Действия_V31.
- **Механика:** факт → правила → отклонение и КД → блокировка **конкретного объекта**, а не всей системы → уведомление ответственного.

### 7.13 Контуры HACCP V15, V16, V17 (контроль, оборудование, производственный мост) — 🟡
- **Функции:** `runMonChefHaccpControlCycle`, `runMonChefHaccpControlCenterCycle`, `runMonChefProductionHaccpBridgeCycle` (каждые 5–15 минут), `getHaccpControlDashboard`, `getHaccpControlCenter`, `completeHaccpEquipmentTask`, `upsertHaccpEquipment`, `upsertProductionHaccpRule`. Листы HACCP_Контроли, HACCP_Оборудование, HACCP_Задачи, HACCP_ТТК_Контроли, HACCP_Производственные_События.
- **Почему 🟡:** фоновые циклы работают, но экранов нет (0 вызовов из интерфейса); контур параллелен основному «Журналы_Расписание → Ожидания» (7.2) и ведёт свой лист задач.

### 7.14 Бракераж — ✅
- **Функции:** `addBrakerageEntry`, `getBrakerageEntries`, `getBrakerageStats`, `mcGetBatchesForBrakerage`; автострока при выпуске (3.1). Решение RELEASE или REJECT управляет статусом партии и её выдачей (V28). Экран brakerage в главном окне; ранее в инструкции отмечено отсутствие экрана оценки комиссии.

### 7.15 Санитария и дезсредства (V41, V42, V43, справочник) — ✅ / 🟡
- **V41** `v41ImportDisinfectantsCsv`, `v41ApproveDisinfectant`, `v41CreateSolution`, `v41RecordControl`, `uiDisinfectantRegistry`; `mcApproveDisinfectantRegime`, `mcDsMigrateLegacy` (33 строки старого справочника), `mcDsAdd`. Средство и режим утверждаются отдельно; концентрацию рабочего раствора и его соответствие вычисляет сервер. ✅
- **V42** зоны, планы, выполнение, контроль раствора, остатки дезсредств, алерты — 🟡: экрана нет.
- **V43** связь «пункт чек-листа ↔ средство и режим», генерация санитарных задач, алерты просрочки, `v43AutomationTick` раз в час — ✅ (экран sanitationauto).
- Также Санитарный_день J49, Ж_Генеральные_Уборки, Ж_Мойка_Инвентаря, Ж_Концентрация_Дезрастворов.

### 7.16 Бактерицидные лампы — ✅
- **Функции:** `getLampsStatus`, `setLampRegimen`, `autoLampRun`, `getBactericidalLampsStatus`, `addBactericidalLampReading`, `replaceBactericidalLamp`. Лист Лампы_Регламент. Наработка и остаток ресурса вычисляются, решение «замена» — из остатка. `autoLampSessions` — ⚪ (`return 0`).

### 7.17 Производственная среда: вода, отходы, вредители — ✅
- **Функции:** `mcEnvSaveWaterSource`, `mcEnvSaveWaterPlan`, `mcEnvRecordWaterControl`, `mcEnvWasteAccumulate`, `mcEnvWasteRemove`, `mcEnvSavePestPlan`, `mcEnvRecordPestEvent`, `mcEnvGet` (Environment.html). Листы Вода_*, Отходы, Вредители_*.
- **Механика:** протокол «не соответствует» → отклонение; вывоз отходов без документа не принимается; договор на дезинсекцию проверяется по сроку действия.

---

## 8. Маркировка и этикетки

### 8.1 Этикетки блюд и п/ф — ✅
- **Функции:** `getLabelData`, `getLabelDataBatch`, `saveLabelPrint`, `getLabelHistory`, `getDefaultShelfLife`; `mcLabelData`, `mcLabelMake`, `mcLabelPrinted` (этикетка вручную — без срока по категории).
- **Механика:** этикетка содержит название, тип (п/ф или блюдо), изготовлено и годен до (часы срока), состав, КБЖУ на 100 г и на порцию (флаг неполных данных), ответственного; каждая печать пишется в историю и в Учёт_Маркировок.

### 8.2 Этикетки партий и вскрытия с QR — ✅
- **Функции:** `printBatchLabel`, `printOpeningLabel`, `stockReceiveLabelsPrinted`, `createBatchLabel` (V22). Счётчики печати ведутся в паспорте, событие LABEL_PRINT — в истории партии.

### 8.3 Печать на термопринтер Bluetooth — 🟡
- **Где:** Console.html: Web Bluetooth, изображение этикетки в растр ESC/POS (GS v 0) или TSPL BITMAP — кириллица печатается всегда; формат 58×40 или 50×50 мм. Проверено только на имитации принтера; на iOS — обычная печать через браузер.

### 8.4 Коды маркировки («Честный знак») — 🟡
- **Функции:** `mcAddMarkingCodes`, `mcWithdrawMarking`, `getMarkingLog`, `getMarkingJournal`. Лист Маркировка (GTIN, BatchID, вывод из оборота). Обмена с ГИС «Честный знак» нет — коды вводятся вручную или сканером.

---

## 9. Аллергены — ✅ (механизм работает, данных нет)
- **Функции:** `mcGetAllergenRegistry`, `mcSetProductAllergens`, `mcGetDishAllergens` (Allergens.html и блок в карточке блюда). Лист Аллергены_Продукты.
- **Механика:** справочник ТР ТС 022/2011. Профиль продукта вводит человек по документу («содержит» или «не содержит»), действует последняя запись. По названию система только подсказывает, что проверить. Аллергены блюда = объединение подтверждённых профилей через п/ф до сырья; если хоть у одного продукта нет профиля, блюдо помечается «профиль неполный».
- **Данные:** сейчас 0 из 420 продуктов имеют профиль.
- **Роли:** просмотр — каталог и ХАССП; ввод профилей — ответственный за ХАССП.

## 10. КБЖУ — ✅
- **Функции:** `calculateKBZHU`, `getNutritionData`, `setNutritionItem`, `updateNutritionData`, `syncTTKWithProductDatabase`, `getNutritionFromSync`, `getIngredientStorageInfo`, `suggestExpiryDate`. Листы Справочник_Пищевая_Ценность, Продукты_Справочник (1218 продуктов), ТТК_Сопоставление.
- **Механика:** раскладка до сырья × данные на 100 г → итог, на порцию и по ингредиентам с пометкой недостающих данных. Ингредиенты ТТК сопоставляются с базой продуктов по токенам и мере Жаккара (`_nutriNormalize_`, `_jaccard_`, `_matchProductForIngredient_`). Экран nutrition; данные идут на этикетку.

## 11. Лаборатория и пробы

### 11.1 Лабораторный контроль — ✅
- **Функции:** `createLabPlan`, `getLabPlans`, `createLabTest`, `recordLabResult`, `getLabTests`, `_labOverdue_` (Labs.html). Листы Лаборатория_План, Лаборатория_Исследования.
- **Механика:** план с периодичностью; результат вносится один раз («соответствует» или «не соответствует»), протокол не переписывается; несоответствие → критическое уведомление и отклонение с КД; просрочка плана видна.

### 11.2 Суточные пробы — ✅
- **Функции:** `mcTakeDailySample`, `mcDestroyDailySample`, `mcGetDailySamples` (DailySamples.html). Лист Суточные_Пробы.
- **Механика:** проба берётся только по реальной допущенной партии готовой продукции. Контролируются масса (по умолчанию 100 г), место и t° (2…6 °C), срок хранения (48 ч); уничтожить раньше срока нельзя. Без пробы выдача на банкет закрыта.

### 11.3 Контроль воды — ✅ (см. 7.17).

## 12. Оборудование — ✅ / 🟡
- **Функции:** `mcGetEquipment`, `mcSaveEquipment` (Compliance.gs, Equipment.html). Лист Оборудование_Реестр (поверка, следующая поверка, документ).
- **Механика:** измерение прибором с истёкшей поверкой не принимается — ни в ККТ, ни в журналах, ни в приёмке, ни в пробах. Если в реестре есть термометры, прибор при входном контроле обязателен. Журналы Ж_Проверка_Весов, Ж_Калибровка_Термометров, Ж_Неисправности_Оборудования ведутся через общий механизм журналов.
- **Почему частично 🟡:** HACCP_Оборудование (V16) — параллельный реестр без экрана.

## 13. Документы, ВСД, проверяющие

### 13.1 Документы предприятия и реестр — ✅ / 🟡
- **Функции:** `uploadDocument`, `createDocument`, `getDocuments`, `getDocumentFile`, `_docsExpired_` (Docs.html, лист Документы) — ✅. `registerDocument`, `updateDocumentVersion`, `getDocument`, `getDocumentHistory`, `verifyDocument`, `archiveDocument` (DocumentRegistry.gs, лист DOCUMENT_REGISTRY: хеш, версия, статус DRAFT → APPROVED → ACTIVE → SUPERSEDED → ARCHIVED, документ не удаляется) — 🟡: экраном вызывается 1 функция из 6. `syncDocumentRegistry` сводит документы в реестр для проверяющего.

### 13.2 Документы на сырьё и ветконтроль — ✅
- **Функции:** `mcSaveSupplyDocument`, `mcVerifySupplyDocument`, `mcSetVetControlled`, `mcSaveVetDocument`, `mcGetSupplyDocs` (SupplyDocs.html). Листы Документы_Сырьё (файл приватно, SHA-256, многолистовая накладная), Ветконтроль_Продукты, ВСД.

### 13.3 ФГИС «Меркурий» — ✅ (проверено только на имитаторе ВетИС.API)
- **Функции:** `mcVsdFetch`, `mcVsdPreview`, `mcVsdLink`, `mcVsdCheck`, `mcVsdCancel`, `acceptAndCancelVSD`, `mcVsdSync`, `mcMercurySyncPendingSystem` (каждые 30 минут), `mcVsdReject`, `mcMercuryMapSupplier`, `mcMercuryGetConfig/SaveConfig/TestConnection`, `mcGetVsdList/Card/Audit`. Листы ВСД, Меркурий_Обмен (SHA-256 ответа, без паролей), Меркурий_Поставщики.
- **Механика:** SOAP, асинхронно: submitApplicationRequest → опрос receiveApplicationResult. ВСД получается, сопоставляется со строкой накладной, сверяется (поставщик, получатель, продукт, количество, изготовитель, партия, срок) и гасится (processIncomingConsignment). Статус CANCELLED ставится только по ответу «Меркурия». Статусы SENDING/UNKNOWN защищают от двойного гашения; «Проверить результат» восстанавливает приёмку. Гасит только ответственный за ХАССП. Частичная приёмка и возврат через API не реализованы.

### 13.4 Гашение ВСД после приёмки поваром — ✅
- **Функции:** `mcGetVsdUnpaid`, `mcVsdOverdueWatchSystem` (каждые 30 минут).
- **Механика:** повар принял товар → партия в карантине «ждёт гашения ВСД» → одно уведомление ответственному за ХАССП на накладную → после гашения партия допускается сама. Если не погашено до конца следующего рабочего дня — уведомление директору и письмо.

### 13.5 Портал проверяющего и сессии доступа — ✅
- **Функции:** `createAuditSession`, `createAuditSessionEx`, `revokeAuditSession`, `listAuditSessions`, `getAuditSession`, `getAuditAccessLog` (Inspectors.html); портал Audit.html: `getAuditDashboard`, `getAuditBatches`, `getAuditBatch`, `getAuditDeviations`, `getAuditTemperatures`, `getAuditStaff`, `getAuditEquipment`, `getAuditHaccp`, `getAuditTraceability`, `getAuditCanonicalTrace`, `getAuditRuleState`, `getAuditOperationalState`, `getAuditJournal`, `verifyAuditJournal`, `getInspectionDocuments`, `getAuditDocument`, `getAuditDocumentFile`, `verifyInspectionDocument`, `createInspectionPackage`, `getAuditInspectionPackage`. Листы Проверки (хеш токена, срок, полномочия, основание), Проверки_Доступ.
- **Механика:** временный ключ, только чтение, каждое открытие пишется в журнал доступа; персональные данные минимальны (по персоналу — только «допущен» и срок); собирается пакет проверки.

### 13.6 Готовность к проверке и KPI — ✅
- **Функции:** `mcRunInspectionReadiness` (Готовность_Проверки), `getInspectionReadiness`, `checkReadinessCriteria`, `v30GetReadiness`, `_mcChefKpi_`, `_mcSigningBoard_`, `getDashboard`.
- **Механика:** каждое требование получает статус PASS (с EvidenceID), FAIL (с ID нарушающих записей), REVIEW, MISSING_EVIDENCE или NOT_APPLICABLE; итог — READY, READY_WITH_WARNINGS или NOT_READY. Выключенные карантин или медицинский допуск блокируют готовность (R19). В KPI при отсутствии данных пишется «нет данных», а не 100 %.

### 13.7 Ежемесячный архив на Диск (V8) — ✅ / 🟡
- **Функции:** `archiveMonChefMonthly` (проверяется раз в час, срабатывает в конце месяца), `getMonChefArchiveStatus`, `archiveJournalsMonthly` (обёртка).
- **Механика:** структура «MON CHEF — Архив/Месяц/01 Журналы…99 Служебное», снимок месяца в отдельной таблице и PDF, MANIFEST.json. По этапу 10.8 рабочие записи не удаляются; незавершённые формы дописываются следующим запуском. На настоящем Диске не проверено.

## 14. Аудит и целостность — ✅
- **Функции:** `_audit_`, `_mcChainAppend_`, `_mcChainVerify_`, `mcAuditVerify`, `getAuditLog`, `_createOperation_` и `_closeOperation_` (Операции, OperationID), `mcProtectEvidenceSheets`, `mcOnEditAudit`, `mcInstallEditAudit`, `mcSwitchWatchSystem` (раз в час: следит за переключателями `MC_INCOMING_CONTROL` и `MC_MEDICAL_GATE`), `migrateExistingJournalsToFacts`, `getJournalIntegrityReport`, `getV4SystemHealth`.
- **Листы:** Audit_Log (Hash, PrevHash), Операции, Безопасность_V60.
- **Механика:** каждое действие получает OperationID и запись «было → стало» в цепочке хешей; проверка цепочки находит удаление или подмену строк. Листы-доказательства защищены, а ручная правка в таблице пишется в аудит триггером onEdit. Отказ доступа записывается как ACCESS_DENIED.
- **Ограничение:** владелец скрипта технически может править листы — правка видна, но не запрещена.

## 15. Резервные копии и миграции — ✅
- **Функции:** `mcCreateBackup`, `mcRestoreDrill`, `mcRestoreSheet`, `mcGetBackups` (Backup.html), `createSystemBackup`; `mcRunFullMigration`, `runFullMigration`, `validateMigrations`, `getMigrationStatus`, `migrateAllPinsToHash`, `migrateTTKToVersions`, `mcRbMigrateRoles`, `v55RunMigration`. Листы Резерв_Восстановление, Миграции, Миграция_Ядра_V55.
- **Механика:** копия таблицы в папку «Бэкапы Mon Chef» с манифестом (число строк и столбцов и SHA-256 по каждому листу, общий хеш, оператор). Учение по восстановлению открывает копию и сверяет хеши; можно восстановить отдельный лист. Миграция без резервной копии не начинается; порядок: ПИН → хеш, ТТК → версии, журналы → FACTS, ProductID и т. д.

## 16. Роли и права — ✅
- **Функции:** `loginWithPin`, `destroySession`, `_requireAuth_`, `checkPermission`, `getRolePermissions`, `mcGetAccessAdmin`, `mcGrantPermission`, `mcRevokeGrant`, `mcRbMigrateRoles`, `mcRbSetDevPin`, `mcGetMyAdmission`, `mcMedBookAllowed`; шлюз zzz_MonChef_Gate.gs (`mcGateSession_`). Листы Сотрудники (хеш ПИН), Права_Индивидуальные, Медкнижки.
- **Роли (8 + технический доступ):** Директор, Администратор (только банкеты), Шеф-повар, Су-шеф, Кондитер, Повар холодного цеха, Повар горячего цеха, Ответственный за ХАССП; технический доступ (код, хеш, нарастающая блокировка 15 мин → 1 ч → 24 ч) — без права ХАССП-записей.
- **Сколько функций доступно ролям (ДОК_8):** Д 293, А 35, Ш 378, СШ 378, К 197, Пх 220, Пг 220, Х 286, Т 452 — из 512.
- **Механика шлюза:** сгенерированные карты CLIENT, MUT, PERM, NEED, DEVNO, PORTAL, TRIGGER. Цепочка вызова: интерфейс → сессия → право **текущей** роли (перечитывается при каждом вызове) → индивидуальные права (с причиной и сроком; выдаёт директор из разрешённого списка) → OperationID → блокировка → функция → аудит. Отказ — FORBIDDEN 403 и ACCESS_DENIED. Повторный вызов того же действия в течение 15 с не выполняется. Ограничение по цеху (shop_hot/cold/pastry). Медицинский допуск: пищевая роль без действующей медкнижки не вносит записи журналов, ХАССП, бракеража, производства и склада. ПИН хранится с солью, есть блокировка перебора, сессии — в кеше.
- **Персонал:** `getEmployeesFull`, `createEmployee`, `updateEmployee`, `deleteEmployee`, `addTraining`, `getTrainings`, `getExpiringMedicalDocs`; MedBooks (`saveMedBook`, `archiveMedBook`, `medBooksDailyCheck` в 07:00; статусы «Просрочено», «Истекает за 30 дней», «В порядке») — ✅ (Staff.html, экран медкнижек). Лист «Смены» (ставка/час) — наследие, логики почти нет.

## 17. Интерфейс — ✅
- **Console.html (~755 КБ)** — единое главное окно: 20 разделов (Главная, Банкеты, Меню и ТТК, Планирование, Производство, Склад, Ревизии, Дефициты, Излишки, Закупки, Выдача, HACCP, Санитария, Персонал, Лаборатория, Оборудование, Документы, Отчёты, Проверка, Настройки) и ~42 экрана (VIEWS: myshift, kanban, printqueue, checklists, checklistrun, minstock, nutrition, wastenorms, lamps, journaltriggers, prices, brakerage, haccpevents, writeoff, pfincome, stockops, tasks, labels, haccpcontour, sales, revision, dispatcher, weekly, scheduler, picking, fulfillment, closure, execution, productionrelease, productiontasks, ttkmaster, ttkppk, ppkbuilder, normative, compliance, disinfectants, sanitationauto, deficitbridge, ttkrecalc, productunits, haccptasks и др.). В окне: офлайн-очередь, автоповтор при «30 одновременно», Bluetooth-печать, OpenCV-выпрямление скана, BarcodeDetector для QR, автовыход.
- **Рабочие страницы:** Income, BatchCard, BatchControl, Processing, Journals, Temperatures, HaccpToday, SupplyDocs, Orders, Suppliers, Staff, Docs, Labs, DailySamples, Equipment, Environment, Allergens, Backup, Corrections, Inspectors; портал проверяющего Audit.html.
- **Сервер интерфейса:** MonChef_UI.gs и MonChef_UISections.gs (`uiData` в едином формате kpis/tabs/actions, `uiMe`, `uiDishDetail`) — интерфейс сам ничего не считает. MonChef_Pages.gs встраивает ключ сессии и схему «функция → номер параметра token» в страницы. `doGet` направляет по адресу: старые адреса (`?weekly=1`, `?revision=1`, `?classic=1`…) открывают главное окно на нужном экране; 40 старых страниц удалены. MonChef_Application_Integration.gs — сводка модулей и действия диспетчера.

## 18. Прочее (инфраструктура)
- **Планировщик (MonChef_Scheduler.gs) — ✅.** Два триггера (раз в 5 минут и раз в час) вместо 26, ~35 заданий с бюджетом времени, отметками последнего запуска и ошибок, `getSchedulerStatus`, уборка свойств скрипта (`mcCleanupScriptProperties`). Не поставлены в расписание: V48, V50, V51, V21.
- **Работа без интернета (MonChef_Offline.gs) — ✅.** `mcReplayOffline`: белый список функций, время события берётся с устройства (если часы спешат — серверное), не старше N дней, идемпотентность по itemId. Очередь работает только в главном окне.
- **Блокировки и буфер записи — ✅.** `_withLock_`, кеш чтения (`_mcRc*`), пакетная запись (`_mcWb*`, выключатель `MC_WRITE_BUFFER=off`), каскад и очередь восстановления (`_cascadeStep_`, `getRecoveryQueue`).
- **Тесты на стенде — ✅.** `runSafeTests` (без записи), `runFullTests`, `runConcurrencyChecks`, `mcLoadCalibrate` (замер скорости обращений к таблице).
- **Runtime (zz_MonChef_Runtime.gs) — ✅.** Обёртки setup-функций, `getAppUrl`.
- **Арендатор (tenant) — 🟡.** organization_id, location_id, workshop_id в операциях; по факту одно предприятие (`_defaultTenant_`).

---

## Сводная таблица зрелости

| Контур | ✅ | 🟡 | ⚪ |
|---|---|---|---|
| Склад и приход | приёмка, ядро склада, норма запаса, заказы, справочники и V53, корректировка накладной, списание по акту, ревизия V49 | OCR V9–V13 (V9 и V13 не подключены), дефициты и излишки V48/V50/V51/V52, V54, V21 | — |
| Партии и FEFO | FEFO-ядро, жизненный цикл, контроль партий, трассировка (ядро), автоконтроль сроков V6 | V22, V23, фасад трассировки по ТЗ | — |
| Производство | заказы и выпуск, ККТ при выпуске, канбан, V14, V20, V25, V47, V27, V18, V19, V44, V45, V28, V29, очередь печати | V24, V46 | V26, V55–V63 (кроме миграции) |
| ТТК и п/ф | каталог и раскладка, синхронизация с Диска, версии, история, срок и цех, себестоимость, фото блюд | V36, V37, V38–V40 | — |
| Разбор сырья | обработка, дефрост, план из банкетов | — | — |
| Банкеты | CRUD и резервы, карточка с закупкой, автожурналы, J36 | OCR бланков (нужны ключи Yandex) | — |
| ХАССП и журналы | реестр J01–J53, ожидаемые проверки, отклонения и КД, хуки, формы, чек-листы, подписи, исправления, уведомления, температуры, V35, бракераж, V41, V43, лампы, среда | V30 (нет экрана мониторинга), V33, V15–V17, V42, фасад RuleEngine | V34, старые autoFill*, autoLampSessions |
| Маркировка | этикетки блюд и партий, QR | Bluetooth-печать, «Честный знак» | — |
| Аллергены / КБЖУ | механизм работает (аллергены без данных) / КБЖУ | — | — |
| Лаборатория, пробы | лаборатория, суточные пробы, вода | — | — |
| Оборудование | реестр с запретом просроченной поверки | реестр HACCP_Оборудование V16 | — |
| Документы, проверка | документы, сырьё и ветконтроль, «Меркурий», гашение ВСД, портал проверяющего, готовность | DOCUMENT_REGISTRY без экрана, архив V8 не проверен на Диске | — |
| Аудит, бэкап, права, интерфейс | всё | tenant | — |

## 10 самых сильных механик MON CHEF

1. **FEFO-расход по партиям** с переводом единиц, учётом ProductID-синонимов и запретом брать просроченные и не допущенные партии; единственный путь расхода для производства, банкетов, списаний, выдачи и обработки.
2. **Выпуск п/ф одной операцией:** ТТК раскладывается через п/ф до сырья → FEFO-списание → новая партия с себестоимостью → граф прослеживаемости → автобракераж и ККТ-журналы → пересборка резервов банкетов; без обязательных ККТ выпуск закрыт.
3. **Банкетный контур без двойного учёта:** резерв вместо списания → канбан из шагов заготовки → выдача только при бракераже «отпуск», суточной пробе и ККТ → закрытие с возвратом в карантин.
4. **Приёмка с карантином:** OCR накладной и этикетки → партия в карантине → решение входного контроля вычисляется из замеров (поверенный прибор, документы) → гашение ВСД в «Меркурии» с защитой от двойного гашения → автоматический допуск.
5. **«Система не выдумывает измерения»:** автожурналы вносят только известные факты, а на каждую неизвестную колонку ставят адресный вопрос в ту же строку; одна запись автоматически копируется во все формы ХАССП.
6. **Цепочка отклонения:** факт → правило → отклонение и КД → блокировка конкретного объекта → уведомление, которое закрывается условием (повторный замер в норме) с повторами и эскалацией.
7. **Неизменяемая доказательная база:** цепочки SHA-256 в Audit_Log, Партии_События, ТТК_История и подписях журналов (код проверки, PDF с QR); защита листов и аудит ручных правок; подпись блокируется, пока в журнале есть проблемы.
8. **RBAC-шлюз на все 512 функций:** сессия, право текущей роли, индивидуальные права со сроком, цех, медицинский допуск, OperationID, блокировка, защита от двойного нажатия, 403 с записью в аудит; технический доступ без права ХАССП-записей.
9. **Разбор сырья и дефрост:** баланс веса ±1,5 %, перенос себестоимости, п/ф как дочерние партии, ККТ-4 (≤12 ч, замер каждые 4 ч), сроки только с основанием, план разбора из банкетов.
10. **Распознавание банкетных бланков по координатам слов:** компенсация наклона и поворота, столбцы по числам, YandexGPT только для названий с защитой от перестановок, проверка полноты по итогу, самообучение синонимов ТТК.

Следом идут: портал проверяющего с временным ключом и внутренним контрольным листом готовности (PASS/FAIL/MISSING_EVIDENCE); резервные копии с хеш-манифестом и учением по восстановлению; офлайн-очередь с временем устройства и идемпотентностью; версионирование ТТК с утверждением и сравнением было → стало.

## Главные пробелы (по коду)
- Модули без вызовов, то есть мёртвый код: V9, V13, V26, V34, V40; релизный стек V56–V63 — имитация.
- Фоновые контуры HACCP V15–V17 ведут собственный лист HACCP_Задачи параллельно основному «Журналы_Расписание → Ожидания».
- Не поставлены в планировщик автотики V48, V50, V51 и цикл закупки V21.
- V54 (фасад единого расхода) не используется реальным расходом.
- Склад_Остатки сводится по названию, а не по ProductID.
- Внешние интеграции (Yandex OCR и GPT, «Меркурий», Bluetooth, PDF на Диске) проверены только на имитаторах.
- Нет обмена с «Честным знаком» и кассой; подписи — внутренние, не КЭП.
- Готовность NOT_READY — не хватает данных предприятия: ППК, ККТ, медкнижки, поверки, аллергены, объекты температур.
