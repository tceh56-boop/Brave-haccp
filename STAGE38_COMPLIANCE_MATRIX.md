# ЦЕХ CORE100 — Stage 38: Compliance Control Matrix

Единый контур `Control → Requirement → Evidence → Finding → CAPA → Verification`.

## API
- GET_COMPLIANCE_CONTROLS
- GET_COMPLIANCE_CONTROL
- GET_COMPLIANCE_MATRIX
- GET_COMPLIANCE_MATRIX_SUMMARY
- CREATE_COMPLIANCE_CONTROL
- LINK_COMPLIANCE_CONTROL

## Seed controls
DQ.MASTER_DATA, TRACE.BATCH, TRACE.RECON, CLOSE.PERIOD, LOCK.PERIOD,
AUDIT.INTEGRITY, EVIDENCE.PACK, CAPA.CLOSURE, HACCP.EVIDENCE.

Matrix is read-only over source data. Links are explicit and tenant-scoped.
Daily trigger produces a read-only health snapshot in execution logs; no business data is changed.
