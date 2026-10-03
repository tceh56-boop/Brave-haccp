// Собственность Слепцова Дениса Владимировича.

/** Раунд: дата производства партии. Идемпотентно добавляет колонку в BATCHES. */
function migrateBatchProductionDateSchema_() {
  ensureSchemaColumns_('BATCHES');
  return { ok: true, sheet: 'BATCHES', added: ['дата_производства'] };
}
