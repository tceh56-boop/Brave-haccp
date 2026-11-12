/**
 * MON CHEF — V4 Integration / Migration Engine
 *
 * Назначение:
 * 1) безопасная миграция существующих журналов в FACTS;
 * 2) контроль подписания всех журналов за конкретный период;
 * 3) единый отчёт готовности к подписанию;
 * 4) сводка целостности и дублей FACTS;
 * 5) техническая диагностика после установки.
 *
 * Важно: исходные строки журналов НЕ удаляются и НЕ переписываются.
 */

var MC_V4_MIGRATION_SHEET = 'Миграция_Фактов';

function _mcV4MigrationSheet_() {
  return _mcEnsureSheet_(MC_V4_MIGRATION_SHEET, [
    'MigrationID','JournalID','RowNumber','FactID','MigratedAt','Status','Message'
  ]);
}

function _mcV4MigrationIndex_() {
  var sh = _mcV4MigrationSheet_();
  var v = sh.getDataRange().getValues();
  var idx = {};
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][5]) !== 'OK') continue;
    idx[String(v[i][1]) + '|' + String(v[i][2])] = String(v[i][3] || '');
  }
  return idx;
}

function _mcV4RowFact_(j, row, rowNumber) {
  var map = {};
  j.columns.forEach(function(c, i) { map[c] = row[i]; });
  var dateValue = row[1] || new Date();
  var batch = map['Партия'] || map['Партия №'] || map['batch'] || '';
  var equipment = map['Наименование оборудования'] || map['Оборудование'] || '';
  var value = JSON.stringify(map);
  return {
    factType: 'JOURNAL_ENTRY',
    objectType: 'JOURNAL',
    objectId: j.id,
    operationType: 'MIGRATED_ROW',
    dateTime: dateValue,
    value: value,
    unit: '',
    result: 'RECORDED',
    source: 'MIGRATION:' + j.id,
    batchId: batch,
    ttkId: map['Код ТТК'] || map['TTKID'] || '',
    ccpId: map['ККТ'] || '',
    equipmentId: equipment,
    status: 'MIGRATED'
  };
}

function migrateExistingJournalsToFacts(token, maxRowsPerJournal) {
  try {
    var session = _requireAuth_(token, 'journals');
    var maxRows = Math.max(1, Math.min(Number(maxRowsPerJournal) || 5000, 20000));
    var migration = _mcV4MigrationSheet_();
    var existing = _mcV4MigrationIndex_();
    var migrated = 0, skipped = 0, errors = [];

    (JOURNALS || []).forEach(function(j) {
      var sh = _book_().getSheetByName(j.sheetName);
      if (!sh || sh.getLastRow() < 2) return;
      var v = sh.getDataRange().getValues();
      var limit = Math.min(v.length, maxRows + 1);
      for (var r = 1; r < limit; r++) {
        try {
          var row = v[r];
          if (!row.some(function(x) { return x !== '' && x !== null; })) continue;
          var key = String(j.id) + '|' + String(r + 1);
          if (existing[key]) { skipped++; continue; }
          var fact = _mcV4RowFact_(j, row, r + 1);
          var created = _mcCreateFactInternal_(fact, session);
          existing[key] = created.factId;
          migration.appendRow([_mcUuid_(), j.id, r + 1, created.factId, new Date(), 'OK', '']);
          migrated++;
        } catch (rowErr) {
          errors.push(j.id + ':' + (r + 1) + ' — ' + String(rowErr));
          migration.appendRow([_mcUuid_(), j.id, r + 1, '', new Date(), 'ERROR', String(rowErr)]);
        }
      }
    });

    return coreOk({ migrated: migrated, skipped: skipped, errors: errors.slice(0, 100), actor: _mcSessionFullName_(session) });
  } catch (e) { return coreErr('FACT_MIGRATION_ERROR', String(e)); }
}

function getJournalSigningStatus(periodFrom, periodTo, token) {
  try {
    _requireAuth_(token, 'journals');
    var from = String(periodFrom || '');
    var to = String(periodTo || '');
    var signatures = _mcSignatureSheet_().getDataRange().getValues();
    var signed = {};
    for (var i = 1; i < signatures.length; i++) {
      if (String(signatures[i][14]) !== 'SIGNED') continue;
      signed[String(signatures[i][1]) + '|' + String(signatures[i][3]) + '|' + String(signatures[i][4])] = signatures[i];
    }
    var rows = (JOURNALS || []).map(function(j) {
      var s = signed[String(j.id) + '|' + from + '|' + to];
      return {
        journalId: j.id,
        journalName: j.name,
        required: !!j.required,
        signed: !!s,
        signedBy: s ? s[8] : '',
        signedByRole: s ? s[9] : '',
        signedAt: s ? s[10] : '',
        signatureId: s ? s[0] : '',
        status: s ? 'SIGNED' : 'NOT_SIGNED'
      };
    });
    return coreOk({ periodFrom: from, periodTo: to, total: rows.length, signed: rows.filter(function(x){return x.signed;}).length, unsigned: rows.filter(function(x){return !x.signed;}).length, journals: rows });
  } catch (e) { return coreErr('JOURNAL_SIGNING_STATUS_ERROR', String(e)); }
}

function getJournalIntegrityReport(token) {
  try {
    _requireAuth_(token, 'journals');
    var result = { journals: [], signatures: [], facts: { total: 0, duplicateCandidates: 0 }, errors: [] };
    var factValues = _mcFactsSheet_().getDataRange().getValues();
    result.facts.total = Math.max(0, factValues.length - 1);
    var seen = {};
    for (var i = 1; i < factValues.length; i++) {
      if (!factValues[i][0]) continue;
      var key = [factValues[i][2], factValues[i][3], factValues[i][4], factValues[i][5], factValues[i][9]].join('|');
      if (seen[key]) result.facts.duplicateCandidates++;
      seen[key] = true;
    }
    (JOURNALS || []).forEach(function(j) {
      var sh = _book_().getSheetByName(j.sheetName);
      var count = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
      result.journals.push({ id: j.id, name: j.name, records: count, sheetExists: !!sh });
    });
    var sv = _mcSignatureSheet_().getDataRange().getValues();
    for (var s = 1; s < sv.length; s++) if (sv[s][0]) {
      result.signatures.push({ signatureId: sv[s][0], journalId: sv[s][1], journalName: sv[s][2], status: sv[s][14], signedBy: sv[s][8], signedAt: sv[s][10], hash: sv[s][12] });
    }
    return coreOk(result);
  } catch (e) { return coreErr('INTEGRITY_REPORT_ERROR', String(e)); }
}

function getV4SystemHealth(token) {
  try {
    _requireAuth_(token, 'journals');
    var required = ['Факты','Журналы_Подписи','Проверки','Проверки_Доступ','Корректировки','DOCUMENT_REGISTRY','Правила_Автоматизации'];
    var ss = _book_();
    var sheets = required.map(function(n){ return {name:n, exists:!!ss.getSheetByName(n)}; });
    var missing = sheets.filter(function(x){return !x.exists;}).map(function(x){return x.name;});
    return coreOk({ status: missing.length ? 'NEEDS_SETUP' : 'READY', sheets: sheets, missing: missing, journalCount: (JOURNALS || []).length });
  } catch (e) { return coreErr('SYSTEM_HEALTH_ERROR', String(e)); }
}
