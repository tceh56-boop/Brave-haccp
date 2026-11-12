# Mon Chef V36 — TTK Master + Recipe Graph

## Purpose
V36 makes Google Drive the source repository for technological cards while Mon Chef keeps a structured master registry for planning, production, HACCP and traceability.

## Sheets
- ТТК_Master_V36 — one row per source file, Drive ID/URL/hash, parsed metadata and validation status.
- ТТК_Состав_V36 — ingredient/semifinished rows extracted from TTK.
- ТТК_Технология_V36 — technology text rows extracted from TTK.
- ТТК_Связи_V36 — detected TTK → TTK semifinished links.
- ТТК_Алиасы_V36 — controlled aliases for names that cannot be matched exactly.
- ТТК_Импорт_V36 — import runs and errors.

## Import
1. Run `setupV36TtkMaster(token)`.
2. Run `v36ImportDriveFolder(folderId, token, limit)`.
3. Run `v36BuildRecipeLinks(token)`.
4. Review rows with `ValidationStatus=REVIEW` before using them for production planning or PPK.

The default folder ID is the TTK folder supplied for this project. The importer records the Drive file ID, URL and SHA-256 hash. It does not overwrite the original Drive file.

## Important
- `.xls` files in the supplied archive are Excel SpreadsheetML XML and are parsed directly.
- `.xlsx` files are currently registered as `METADATA_ONLY`; they require a separate XLSX parser/conversion step before their contents can drive calculations.
- Matching is conservative: normalized exact name first. Ambiguous matches are not silently approved.
- Imported values are not regulatory truth. V36 never invents HACCP critical limits.
