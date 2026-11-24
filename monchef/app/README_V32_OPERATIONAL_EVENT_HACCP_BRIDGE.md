# Mon Chef V32 — Operational Event → HACCP Bridge

V32 связывает реальные производственные операции с HACCP-задачами.

## Автоматические события
- `RECEIVING_CONFIRMED` — подтверждённая приёмка;
- `PRODUCTION_STARTED` — начало производства;
- `PRODUCTION_COMPLETED` — выпуск партии.

Поддержаны также конфигурируемые события:
- `COOLING_STARTED`;
- `REHEATING_STARTED`;
- `BANQUET_ISSUE`.

Система не назначает нормативы автоматически. Администратор связывает событие с конкретным утверждённым ControlID и задаёт задержку. Фактическое значение вводится сотрудником через V31.

## Поток
`Операция → событие → триггер → HACCP task → факт V31 → FACT → deviation/corrective action → journal/trace`

## Новые листы
- `HACCP_Триггеры_V32`
- `HACCP_События_V32`

## UI
`?haccpevents=1&token=...`
