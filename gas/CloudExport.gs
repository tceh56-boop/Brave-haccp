// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — CloudExport.gs: выгрузка всех данных для переноса в облачную версию (Yandex Cloud).
 *
 * exportForCloud() запускается вручную из редактора Apps Script. Создаёт на Google Диске файл
 * tsekh_export_ГГГГ-ММ-ДД.json: все листы таблицы ЦЕХ строка в строку (даты — с пометкой $d)
 * и свойства скрипта БЕЗ секретов (ключи, токены, пароли в файл не попадают — их задают
 * в Yandex Lockbox). Файл скачать и загрузить командой cloud/src/import.js.
 * Ничего в таблице не меняет.
 */

var CLOUD_EXPORT_SECRET_RE_ = /(KEY|TOKEN|SECRET|PASSWORD|PASS|PIN|SALT|PRIVATE|CREDENTIAL)/i;

function _cloudCell_(v) {
  if (v instanceof Date) return { $d: v.toISOString() };
  return v;
}

function buildCloudExport_() {
  var ss = getDatabase_();
  var sheets = {};
  ss.getSheets().forEach(function (sh) {
    var values = sh.getDataRange().getValues();
    // Хвост пустых строк не переносим.
    while (values.length && values[values.length - 1].every(function (c) { return c === '' || c === null; })) values.pop();
    sheets[sh.getName()] = values.map(function (row) { return row.map(_cloudCell_); });
  });
  var props = PropertiesService.getScriptProperties().getProperties(), safe = {}, skipped = [];
  Object.keys(props).forEach(function (k) {
    if (k === 'SPREADSHEET_ID' || k.indexOf('DAILY_JOB_LAST_RUN_') === 0) return;
    if (CLOUD_EXPORT_SECRET_RE_.test(k)) { skipped.push(k); return; }
    safe[k] = props[k];
  });
  return { format: 'tsekh-cloud-export', version: 1, exported_at: new Date().toISOString(), sheets: sheets, properties: safe, secrets_not_exported: skipped };
}

function exportForCloud() {
  var data = buildCloudExport_();
  var name = 'tsekh_export_' + todayDateStr_() + '.json';
  var file = DriveApp.createFile(Utilities.newBlob(JSON.stringify(data), 'application/json', name));
  var rows = Object.keys(data.sheets).reduce(function (s, k) { return s + Math.max(0, data.sheets[k].length - 1); }, 0);
  Logger.log('Выгрузка готова: ' + name + ' (' + Object.keys(data.sheets).length + ' листов, ' + rows + ' строк). Ссылка: ' + file.getUrl());
  if (data.secrets_not_exported.length) Logger.log('Не выгружены секреты (задайте их в облаке вручную): ' + data.secrets_not_exported.join(', '));
  return { file: name, url: file.getUrl(), sheets: Object.keys(data.sheets).length, rows: rows, secrets_not_exported: data.secrets_not_exported };
}
