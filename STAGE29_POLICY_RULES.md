# ЦЕХ Stage 29 — Policy & Rules Engine

Configuration Center теперь является источником исполняемых политик.

## Контур

`ACTIVE configuration -> policy resolver -> decision -> existing operation`

Политики читаются только из активной версии конфигурации текущей организации/точки. При отсутствии активной настройки применяется безопасный встроенный default. История конфигурации не изменяется.

## Подключённые политики

- `production.yield_deviation_warning_pct`
- `production.yield_deviation_critical_pct`
- `warehouse.min_stock_override`

Производственный контроль использует policy thresholds вместо жёстко заданного порога. Склад может использовать org/location scoped override минимального остатка.

## Безопасность

Policy Engine не выполняет операции и не изменяет данные. Он возвращает decision, значение, версию и checksum источника. Все реальные действия продолжают проходить существующий `processOperation`, RBAC, lock/idempotency и audit.
