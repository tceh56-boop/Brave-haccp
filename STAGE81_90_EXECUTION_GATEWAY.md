# ЦЕХ CORE100 — Stage 81–90 Execution Gateway

Замыкает цикл `plan → approval → preflight → execution → outcome → reconciliation`.

Execution разрешается только для APPROVED proposal и READY request. Preflight требует quality/HACCP/financial gates. Поддержаны безопасные adapters для закупочного запроса, production task и shift assignment; остальные типы блокируются до отдельного adapter.

Автоматического исполнения по trigger нет.
