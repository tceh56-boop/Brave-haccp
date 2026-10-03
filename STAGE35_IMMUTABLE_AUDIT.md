# ЦЕХ CORE100 — Stage 35: Immutable Audit & Evidence Vault

## Назначение

Stage 35 не заменяет `AUDIT_LOG`. Он добавляет доказательный слой, позволяющий обнаружить изменение или удаление аудиторских записей после их создания.

## Модель

`AUDIT_LOG` → canonical snapshot → SHA-256(record) → `AUDIT_EVIDENCE_VAULT.previous_hash` → следующий record.

Для каждой организации ведётся отдельная hash-chain. Генезис: `SHA-256("TSEKH-AUDIT-GENESIS-v35")`.

## Что защищается

В snapshot входят: `log_id`, `user_id`, действие, объект, старое/новое значение, дата, результат и `cascade_id`.

Если строку `AUDIT_LOG` изменить или удалить вручную, проверка evidence выявит соответственно `RECORD_HASH_MISMATCH` или `AUDIT_LOG_MISSING`.

## API

- `GET_AUDIT_EVIDENCE` — bounded просмотр evidence.
- `VERIFY_AUDIT_EVIDENCE` — проверка всей цепочки организации.
- `SEAL_AUDIT_EVIDENCE` — создание checkpoint с текущим head hash.

`SEAL_AUDIT_EVIDENCE` требует `audit_admin`; ДИРЕКТОР получает этот модуль, ADMIN — через `all`.

## Ограничения

Hash-chain обнаруживает постфактум изменение данных, но не делает Google Sheet физически неизменяемым. Для production необходимо ограничить редакторский доступ к таблице и периодически выполнять verification.

Автоматическое удаление/исправление `AUDIT_LOG` не выполняется.
