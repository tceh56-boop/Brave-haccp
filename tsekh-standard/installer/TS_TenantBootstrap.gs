/**
 * Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
 * ЦЕХ Стандарт — первичная регистрация клиентского Google Drive.
 * Запускать ИМЕННО из Google Apps Script проекта, созданного под аккаунтом клиента.
 * Клиент самостоятельно создаёт папку и таблицу, затем явно предоставляет поставщику доступ редактора.
 * Секрет лицензии хранится только в Script Properties этого проекта.
 */
var TS_TENANT_BOOTSTRAP = {
  CONTROL_URL: 'ВСТАВЬТЕ_URL_WEB_APP_CONTROL',
  PROVIDER_EMAIL: 'ВСТАВЬТЕ_EMAIL_ТЕХНИЧЕСКОГО_АККАУНТА_ПОСТАВЩИКА',
  ENTERPRISE_NAME: 'Название предприятия',
  LICENSE_KEY: 'TS-XXXX-XXXX-XXXX',
  LICENSE_SECRET: 'СЕКРЕТ_ЛИЦЕНЗИИ_ИЗ_CONTROL'
};
var TS_TENANT_TREE = [
  '00_Система','01_Организация','02_ТТК_и_Меню','03_Продукты_и_Поставщики','04_Производство',
  '05_Склад_и_Партии','06_ХАССП_и_ППК','07_Охрана_труда','08_Договоры','09_Персонал',
  '10_Лаборатория','11_Оборудование','12_Журналы','13_Фото','14_Резервные_копии','99_Архив'
];
function tsTenantBootstrapStart() {
  var c = TS_TENANT_BOOTSTRAP;
  if (!/^https:\/\//.test(c.CONTROL_URL) || c.CONTROL_URL.indexOf('ВСТАВЬТЕ_') === 0) throw new Error('Заполните CONTROL_URL');
  if (!/@/.test(c.PROVIDER_EMAIL) || c.PROVIDER_EMAIL.indexOf('ВСТАВЬТЕ_') === 0) throw new Error('Заполните PROVIDER_EMAIL');
  if (!/^TS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c.LICENSE_KEY) || c.LICENSE_SECRET.indexOf('СЕКРЕТ_') === 0) throw new Error('Заполните лицензию и секрет');
  var ownerEmail = Session.getEffectiveUser().getEmail();
  if (!ownerEmail) throw new Error('Google не вернул email текущего владельца. Запустите из аккаунта клиента.');
  var props = PropertiesService.getScriptProperties();
  var root = null, ss = null, rootId = props.getProperty('TS_TENANT_ROOT_ID'), sheetId = props.getProperty('TS_TENANT_SHEET_ID');
  if (rootId) { try { root = DriveApp.getFolderById(rootId); if (root.isTrashed()) root = null; } catch (e) { root = null; } }
  if (!root) { root = DriveApp.createFolder('ЦЕХ Стандарт — ' + c.ENTERPRISE_NAME); props.setProperty('TS_TENANT_ROOT_ID', root.getId()); }
  if (sheetId) { try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { ss = null; } }
  if (!ss) { ss = SpreadsheetApp.create('ЦЕХ Стандарт — база — ' + c.ENTERPRISE_NAME); props.setProperty('TS_TENANT_SHEET_ID', ss.getId()); }
  var file = DriveApp.getFileById(ss.getId());
  var inRoot = false, parents = file.getParents(); while (parents.hasNext()) if (parents.next().getId() === root.getId()) inRoot = true;
  if (!inRoot) file.moveTo(root);
  TS_TENANT_TREE.forEach(function (name) { var it = root.getFoldersByName(name); if (!it.hasNext()) root.createFolder(name); });
  // Явное согласие клиента на технический доступ поставщика только к папке и таблице предприятия.
  root.addEditor(c.PROVIDER_EMAIL);
  file.addEditor(c.PROVIDER_EMAIL);
  var payload = { action: 'tenant.bootstrap', rootFolderId: root.getId(), spreadsheetId: ss.getId(), ownerEmail: ownerEmail };
  var result = tsTenantCall_(payload);
  if (!result.ok || !result.ownershipVerified) throw new Error('CONTROL не подтвердил хранилище: ' + JSON.stringify(result));
  PropertiesService.getScriptProperties().setProperties({
    TS_LICENSE_KEY: c.LICENSE_KEY, TS_LICENSE_SECRET: c.LICENSE_SECRET, TS_ADMIN_URL: c.CONTROL_URL,
    TS_TENANT_ROOT_ID: root.getId(), TS2_ROOT_PARENT_ID: root.getId(), TS_TENANT_SHEET_ID: ss.getId(), SHEET_ID: ss.getId(), TS_ENTERPRISE_ID: result.enterpriseId, TS_TENANT_MODE: '1'
  }, true);
  Logger.log('Клиентское хранилище зарегистрировано. Папка: ' + root.getUrl());
  Logger.log('Таблица: ' + ss.getUrl());
  Logger.log('Владелец: ' + ownerEmail + '. Поставщику предоставлен доступ редактора к папке и таблице.');
  return { rootFolderId: root.getId(), spreadsheetId: ss.getId(), enterpriseId: result.enterpriseId, ownerEmail: ownerEmail };
}
function tsTenantCall_(payload) {
  var c = TS_TENANT_BOOTSTRAP, ts = String(Date.now()), p = {};
  Object.keys(payload).forEach(function (k) { p[k] = payload[k]; });
  p.key = c.LICENSE_KEY; p.ts = ts; p.sigV = 2;
  p.sig = tsTenantHmac_(p.key + '|' + ts + '|' + tsTenantCanonical_(p), c.LICENSE_SECRET);
  var r = UrlFetchApp.fetch(c.CONTROL_URL, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(p) });
  if (r.getResponseCode() !== 200) throw new Error('CONTROL HTTP ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
  return JSON.parse(r.getContentText() || '{}');
}
function tsTenantCanonical_(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(tsTenantCanonical_).join(',') + ']';
  return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ':' + tsTenantCanonical_(v[k]); }).join(',') + '}';
}
function tsTenantHmac_(text, secret) {
  return Utilities.computeHmacSha256Signature(String(text), String(secret), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
