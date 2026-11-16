# Mon Chef V38 — Shelf Life / Realization Rules

V38 adds a rule engine for shelf life, storage and realization conditions of dishes and semi-finished products.

## Principle
Rules are configuration and must not be treated as universal legal constants. An operational rule should have a source/basis and APPROVED status.

Matching priority:
1. TTK_ID
2. product name pattern
3. folder path pattern
4. category

The first match is selected by specificity and then priority.

## Sheets
- `Сроки_Правила_V38` — rules
- `Сроки_Назначения_V38` — future assignment/audit layer
- `Сроки_Расчёт_V38` — calculated expiration/realization timestamps per batch
- `Сроки_Пробелы_V38` — TTKs without an approved rule

## Routes
`?shelflife=1&token=...`

## Important
Do not hard-code old sanitary guidance as current law. Current enterprise rules should be approved against the applicable current normative/technical documentation, product manufacturer data where applicable, and the enterprise's approved PPK/HACCP documentation.

The engine supports separate regimes for chilled/positive-temperature storage and freezing, including separate shelf-life fields. It does not invent values when a rule is missing.
