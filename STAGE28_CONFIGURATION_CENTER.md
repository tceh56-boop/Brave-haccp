# ЦЕХ CORE100 — Stage 28: Master Data & Configuration Center

## Назначение
Версионируемая конфигурация предприятия без перезаписи истории.

## Контур
`DRAFT -> APPROVED -> ACTIVE -> ROLLED_BACK`

Критические параметры не активируются напрямую: требуется согласование пользователя с модулем `configuration_admin`.

## Хранение
- `CONFIGURATION_VERSIONS` — ревизии, статус, причина, автор, согласующий, время активации, checksum.
- `CONFIGURATION_VALUES` — значения параметров внутри конкретной ревизии.

## Безопасность
- organization/location scope проверяется сервером;
- фронтенд не является источником прав;
- изменение критического параметра не получает отдельного bypass;
- checksum проверяется перед активацией;
- история предыдущих версий не удаляется.

## API
- `GET_CONFIGURATION`
- `CREATE_CONFIGURATION_REVISION`
- `APPROVE_CONFIGURATION_REVISION`
- `ACTIVATE_CONFIGURATION_REVISION`
- `ROLLBACK_CONFIGURATION`

## Важно
Stage 28 не заменяет регламентированный бухгалтерский учёт и не изменяет существующие данные при миграции. Новые листы создаются через общий `initializeDatabase()`/`runAllMigrations()`.
