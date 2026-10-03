# ЦЕХ — Stage 27: Automation Workflow Engine

## Контур
Событие -> правило -> decision -> workflow -> SLA -> эскалация -> результат.

Workflow не обходит Stage 25: денежные, складские, производственные и compliance-действия выполняются только существующим согласованным контуром.

## SLA
Каждый workflow имеет общий SLA и три стандартных шага: APPROVAL, ACTION, CONTROL. Просроченный шаг получает OVERDUE, просроченный workflow — ESCALATED. Повторная обработка идемпотентна.

## Безопасность
Создание/завершение workflow требует `automation_approve`; просмотр — `dashboard`. Scope организации/точки проверяется на каждой операции.
