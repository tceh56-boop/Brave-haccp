# Mon Chef V48 — Deficit Engine

V48 объясняет дефицит банкетного исполнения по цепочке V47 и создаёт идемпотентную задачу в V44.

## Причины
- NO_PRODUCTION
- PRODUCTION_CANCELLED
- PRODUCTION_NOT_STARTED
- PRODUCTION_INCOMPLETE
- PRODUCTION_SHORTAGE
- RESERVE_MISSING
- ISSUE_PENDING
- FULFILLMENT_GAP

## Принцип
V47 — снимок операционного состояния; V44 — единый центр задач; V27/V28 остаются источниками фактического производства и выдачи. V48 не списывает сырьё и не создаёт производственные факты.

## Route
`?deficits=1`

## Automation
`v48AutomationTick()` можно вызывать из существующего hourly trigger после V47 refresh.
