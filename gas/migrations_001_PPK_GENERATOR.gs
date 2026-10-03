/**
 * PPK Generator schema migration.
 * Safe to run repeatedly. Database.initializeDatabase() creates missing sheets from CONFIG.SCHEMA.
 */
function migratePpkGeneratorSchema_() {
  var required=['PPK_PROCESSES','PPK_FLOW_STAGES','PPK_FLOWS','HAZARD_ANALYSIS','PPK_CONTROLS','PPK_CRITICAL_LIMITS','PPK_VERIFICATION','PPK_REVIEW_REQUESTS','PPK_DOCUMENTS'];
  initializeDatabase();
  return required.map(function(k){return {sheet:k,ready:!!CONFIG.SHEETS[k],headers:(CONFIG.SCHEMA[k]||[]).length};});
}
