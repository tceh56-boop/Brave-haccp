# Mon Chef V23 — Склад → Производство

V23 связывает FEFO-склад с производственным заданием.

Цикл: производственное задание → потребность → FEFO-резерв → конкретная партия → место хранения → фактический отбор → списание остатка → FACT/TRACE.

Новые функции:
- createProductionPickPlan(productionId, requirements, token)
- getProductionPickPlan(productionId, token)
- confirmProductionPick(pickId, batchId, qty, token)
- scanProductionPick(batchId, token)
- cancelProductionPick(pickId, reason, token)

Важно: V23 не придумывает состав ТТК. Состав потребности передаётся из производственного/ТТК-контура; следующий интеграционный шаг — автоматически получать его из недельного плана и ТТК.
