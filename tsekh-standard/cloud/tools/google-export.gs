/**
 * ЦЕХ Стандарт — опись предприятия для переезда в облако.
 *
 * Как пользоваться (в старом проекте Apps Script предприятия, один раз):
 *   1. Расширения → Apps Script → «+» → Скрипт, назовите файл CloudExport и вставьте этот текст.
 *   2. Выберите функцию tsCloudExport и нажмите «Выполнить». Разрешите доступ к Диску.
 *   3. В корневой папке предприятия появится файл «cloud-manifest.json». Скачайте его.
 *   4. Скачайте корневую папку целиком (правый клик → Скачать): Диск отдаст один или несколько .zip.
 *   5. На сервере: node tools/tenant.js import <код> --manifest cloud-manifest.json --files папка.zip[,папка-2.zip]
 *
 * Опись содержит свойства скрипта, в том числе ключи (Yandex, ЮKassa). Храните её как пароль и удалите после переезда.
 * Файлы опись не копирует: только их ID, имена и места в папках, чтобы на сервере ссылки остались прежними.
 */
function tsCloudExport() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var rootId = props.TS_TENANT_ROOT_ID || props.TS2_ROOT_PARENT_ID || '';
  var sheetId = props.TS_TENANT_SHEET_ID || props.SHEET_ID || '';
  if (!sheetId) { try { sheetId = SpreadsheetApp.getActiveSpreadsheet().getId(); } catch (e) {} }
  if (!rootId && sheetId) { var ps = DriveApp.getFileById(sheetId).getParents(); if (ps.hasNext()) rootId = ps.next().getId(); }
  if (!rootId) throw new Error('Не найдена корневая папка предприятия: задайте свойство TS_TENANT_ROOT_ID');

  var root = DriveApp.getFolderById(rootId), items = [], started = Date.now();
  function walk(folder, path) {
    if (Date.now() - started > 5 * 60 * 1000) throw new Error('Слишком много файлов для одного запуска (больше 5 минут). Напишите в поддержку.');
    var fs = folder.getFiles();
    while (fs.hasNext()) {
      var f = fs.next();
      if (f.getName() === 'cloud-manifest.json') continue;
      items.push({ id: f.getId(), name: f.getName(), mime: f.getMimeType(), parent: folder.getId(), path: path.concat(f.getName()).join('/'),
        size: f.getSize(), created: f.getDateCreated().getTime(), updated: f.getLastUpdated().getTime(), descr: f.getDescription() || '' });
    }
    var ds = folder.getFolders();
    while (ds.hasNext()) {
      var d = ds.next();
      items.push({ id: d.getId(), name: d.getName(), mime: 'application/vnd.google-apps.folder', parent: folder.getId(), path: path.concat(d.getName()).join('/') });
      walk(d, path.concat(d.getName()));
    }
  }
  walk(root, [root.getName()]);

  var mainInRoot = items.some(function (x) { return x.id === sheetId; });
  var manifest = {
    format: 'tsekh-cloud-export/1', exportedAt: new Date().toISOString(), timeZone: Session.getScriptTimeZone(),
    owner: (function () { try { return Session.getEffectiveUser().getEmail(); } catch (e) { return ''; } })(),
    rootId: rootId, rootName: root.getName(), sheetId: sheetId, sheetInRoot: mainInRoot,
    sheetName: sheetId ? SpreadsheetApp.openById(sheetId).getName() : '',
    properties: props, items: items,
  };
  var old = root.getFilesByName('cloud-manifest.json');
  while (old.hasNext()) old.next().setTrashed(true);
  var file = root.createFile('cloud-manifest.json', JSON.stringify(manifest), 'application/json');
  Logger.log('Опись готова: %s файлов и папок. Скачайте: %s', items.length, file.getUrl());
  if (!mainInRoot) Logger.log('Таблица-база лежит вне корневой папки: скачайте её отдельно (Файл → Скачать → .xlsx) и укажите --xlsx.');
  return file.getUrl();
}
