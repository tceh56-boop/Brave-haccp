# ЦЕХ — Stage 37: Compliance Control Matrix & CAPA Engine

Контур CAPA связывает контрольные finding с устранением причин:

`Finding -> CAPA Case -> Root Cause -> Corrective/Preventive Action -> Evidence -> Verification -> Closure`

## Таблицы

- `CAPA_CASES`
- `CAPA_ACTIONS`
- `CAPA_VERIFICATIONS`

## API

- `GET_CAPA_CASES`, `GET_CAPA_CASE`
- `CREATE_CAPA_CASE`, `CREATE_CAPA_ACTION`
- `UPDATE_CAPA_CASE`, `COMPLETE_CAPA_ACTION`
- `VERIFY_CAPA_CASE`
- `RUN_CAPA_SLA`

## Безопасность

CAPA не изменяет исходный finding и хозяйственные данные. Закрытие возможно только после PASS verification. Все действия пишутся в audit trail. SLA trigger только помечает просрочку.
