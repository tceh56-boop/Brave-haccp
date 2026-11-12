# Mon Chef V63 — deployment

1. Create a copy of the production spreadsheet before deployment.
2. Upload all `.gs` files from this package into Apps Script; `Code.gs` is already the merged entry point.
3. Upload HTML files referenced by `doGet`, including `ProductionRelease.html` and `ResourceStockV54.html`.
4. Run `setupProductionReleaseStack()` once as administrator.
5. Run `v61RunStructuralTests()`.
6. Run `v55RunMigration(token)` after backup and review of V53 mappings.
7. Create a pilot with `v62CreatePilotPlan(site, owner, token)`.
8. Do not enable full automatic write-off on day one. Keep reservation/issue confirmation for the pilot.
9. Execute the end-to-end banquet acceptance test.
10. Only after pilot acceptance, run `v63EvaluateRelease()` and use the release status as the operational gate.

## Rollback
Keep the pre-release spreadsheet copy. If a migration or production defect is detected, stop write operations, preserve the audit, and restore from the last verified backup. Do not manually edit stock quantities to repair history.
