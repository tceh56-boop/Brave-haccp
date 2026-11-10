# Mon Chef V31 — HACCP FACT Bridge

V31 closes the operational loop between the V30 HACCP master data and actual measurements.

## Flow
`HACCP control → expected task → employee enters actual value → FACT → result → deviation/corrective action → journal/trace`

The system never invents measurement values.

### Main functions
- `setupV31HaccpBridge(token)`
- `v31CreateMonitoringTask(json, token)`
- `v31GetOpenTasks(token)`
- `v31RecordHaccpFact(json, token)`
- `v31GetFacts(controlId, limit, token)`
- `v31BuildControlReadiness(token)`

## Sheets
- `HACCP_Факты_V31`
- `HACCP_Ожидания_V31`
- `HACCP_Действия_V31`

## Principle
A temperature such as `+4.2°C` must come from the employee/device input. V31 only evaluates it against configured limits. Limits are enterprise configuration and must be approved for the applicable process/equipment/documentation.
