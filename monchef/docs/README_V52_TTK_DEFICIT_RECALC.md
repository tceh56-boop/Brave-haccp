# Mon Chef V52 — TTK Deficit Recalculation

V52 connects V48 deficit detection to V24 TTK dependency planning.

## Flow
`V48 deficit -> V24 TTK explosion -> existing semi-finished stock -> raw stock check -> residual production -> residual purchase signal`

V52 is planning-first. It does not write off warehouse stock and does not silently change an existing production batch.

## Main sheets
- `Дефициты_ТТК_План_V52`
- `Дефициты_ТТК_Узлы_V52`
- `Дефициты_ТТК_Аудит_V52`

## Functions
- `setupV52TtkDeficitRecalc()`
- `v52RecalculateDeficits(fromDate,toDate,token)`
- `v52PublishPlans(fromDate,toDate,token)`
- `v52ApprovePlan(planId,token)`
- `v52GetDashboard(fromDate,toDate,token)`

## UI
`?ttkrecalc=1&token=...`

## Important rule
Approval creates a V44 production task only for the residual quantity after the available P/F coverage. The raw-material `ToBuy` signal remains planning information until a purchasing workflow explicitly consumes it.

## Known limitation
The current V52 raw-stock comparison is name+unit based. A later version should bind ingredients to stable product IDs / TTK ingredient IDs and unify unit conversion, because kg/g and product aliases must not be treated as different physical resources.
