# Mon Chef V40 — Product Shelf-Life Master

V40 takes the uploaded `Полная_база_продуктов_ИТОГ(1).xlsx` (1218 products) and creates a controlled reference layer for storage/shelf-life data.

## Important
Imported shelf-life values are marked `IMPORTED_REFERENCE` / `REVIEW`. They are not automatically treated as legally approved shelf lives. This is deliberate: under TR TS 021/2011 shelf life and storage conditions are set by the manufacturer/producer in the applicable normative/technical documentation; during storage and realization the established conditions and shelf life must be observed. Rospotrebnadzor also emphasizes that public-catering dishes need established shelf life and storage conditions.

## Sheets
- `Продукты_Сроки_V40` — 1218 product records and raw + parsed shelf-life values.
- `ТТК_Состав_Продукты_V40` — mapping of actual TTK ingredient rows to product records.
- `Продукты_Сроки_Пробелы_V40` — unmapped ingredients.

## Workflow
1. `?productshelf=1&token=...`
2. Create tables.
3. Load bundled 1218-product seed.
4. Map TTK ingredient rows.
5. Review partial matches and approve product data/TTK-specific rules separately.

Parsed hours are only a machine-readable approximation of the free-text source. The raw source text is retained.
