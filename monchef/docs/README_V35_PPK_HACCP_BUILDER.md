# Mon Chef V35 — PPK / HACCP PLAN BUILDER

V35 builds a DRAFT PPK and HACCP plan from enterprise-defined processes, hazards, controls and monitoring parameters.

## Regulatory architecture
- Mandatory layer: applicable SanPiN / TR TS 021/2011 requirements recorded in the normative engine.
- Methodological layer: HACCP principles and applicable GOST references.
- Enterprise layer: actual processes, zones, equipment, TTK, approved limits, monitoring and corrective actions.

The system does **not** invent critical limits, laboratory frequencies or sanitary norms. Missing values create blocking gaps.

## Sheets
- ППК_V35
- Процессы_ППК_V35
- Опасности_ХАССП_V35
- CCP_OPRP_V35
- Мониторинг_ХАССП_V35
- Верификация_ХАССП_V35
- Пробелы_ППК_V35

## UI
`?ppk=1&token=...`

## Workflow
1. Create DRAFT.
2. Define real enterprise processes.
3. Add hazard analysis.
4. Define CCP/OPRP/control measures.
5. Enter approved critical limits and monitoring methods.
6. Validate.
7. Blocking gaps prevent ACTIVE.
8. Approval changes status to ACTIVE.

This is a software control mechanism, not a legal certification of the enterprise.
