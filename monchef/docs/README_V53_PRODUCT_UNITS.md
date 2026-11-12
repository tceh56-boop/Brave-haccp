# Mon Chef V53 — ProductID + единицы измерения

## Зачем
V52 нельзя безопасно использовать как закупочный расчёт, пока продукт идентифицируется только строковым названием и единицей. V53 вводит стабильный `ProductID`, измерительную размерность и конвертацию.

## Принцип
`Название источника -> сопоставление -> ProductID -> Dimension -> CanonicalUnit -> conversion`

Автоматическое точное совпадение получает `REVIEW`, а не `APPROVED`. Для автоматического планирования требуется ручное подтверждение (`MANUAL`/`APPROVED`).

## Размерности
- MASS: mg / g / kg, каноническая g
- VOLUME: ml / l, каноническая ml
- COUNT: pcs
- PACKAGE: pack

Нельзя автоматически конвертировать массу в штуки, литры в килограммы и т.п.

## Листы
- `Продукты_ID_V53`
- `Продукты_Сопоставление_V53`
- `Продукты_Единицы_V53`
- `Продукты_Аудит_V53`

## UI
`?productunits=1&token=...`

## API
- `setupV53ProductUnits()`
- `v53RebuildProductIds(token)`
- `v53BuildMappings(token)`
- `v53SetManualMapping(sourceType, sourceName, productId, token)`
- `v53ConvertQty(qty, fromUnit, toUnit)`
- `v53NormalizeRequirement(name, qty, unit, sourceType, token)`
- `v53GetDashboard(token)`

## Ограничение
V53 не изменяет склад. Он создаёт идентичность ресурса и безопасный слой сопоставления. Следующим этапом этот слой должен быть подключён к V52/V21 закупкам и V23 отбору.
