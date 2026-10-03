# ЦЕХ — Stage 36: Evidence & Compliance Pack Generator

Доказательный пакет периода собирает контроль закрытия, hash-chain audit evidence, трассируемость и открытые reconciliation cases.

## Принцип

Пакет read-only относительно хозяйственных данных. Формирование не закрывает период, не проводит деньги и не исправляет расхождения.

## API

- `CREATE_COMPLIANCE_EVIDENCE_PACK`
- `GET_COMPLIANCE_EVIDENCE_PACK`
- `VERIFY_COMPLIANCE_EVIDENCE_PACK`

## Статусы

- `REVIEW_REQUIRED` — пакет содержит незакрытые контрольные условия или период не закрыт.
- `COMPLIANT` — период закрыт, audit evidence valid и нет открытых reconciliation cases.
- `BROKEN` — при последующей проверке контрольный hash отличается.

JSON manifest сохраняется в Drive при наличии DriveApp; ссылка и file_id сохраняются в `COMPLIANCE_EVIDENCE_PACKS`.
