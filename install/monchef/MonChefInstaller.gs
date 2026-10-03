/**
 * MON CHEF — установщик на Google Диск.
 *
 * Берёт архив MonChef_*.zip из папки установки на Диске, создаёт отдельный проект
 * Apps Script «MonChef» (или обновляет уже созданный), записывает в него
 * Code.gs, App.html, appsscript.json, публикует веб-приложение и раскладывает
 * остальные файлы пакета (логотипы, README, демо) в подпапку «Файлы пакета».
 *
 * Повторный запуск обновляет тот же проект и то же развёртывание —
 * ссылка на веб-приложение не меняется. Перед каждой перезаписью текущее
 * содержимое проекта сохраняется в папку установки (backup_*.json).
 *
 * Требуется включённый Apps Script API: https://script.google.com/home/usersettings
 */

// Папка «MonChef — установка» на Диске: сюда кладётся архив.
var MC_INSTALL_FOLDER_ID_ = '199_Kpd04nbT8T4UCwfk3imarDHGJGvHw';
// Оставьте пустым, чтобы создать новый проект. Укажите ID существующего проекта,
// чтобы обновить его (резервная копия содержимого сохраняется автоматически).
var MC_TARGET_SCRIPT_ID_ = '';
var MC_PROJECT_TITLE_ = 'MonChef';
var MC_API_ = 'https://script.googleapis.com/v1/projects';

function installMonChef() {
  var folder = DriveApp.getFolderById(MC_INSTALL_FOLDER_ID_);
  var zip = mcFindZip_(folder);
  var entries = mcUnzip_(zip);
  ['Code.gs', 'App.html', 'appsscript.json'].forEach(function (n) {
    if (!entries[n]) throw new Error('В архиве ' + zip.getName() + ' нет файла ' + n + '.');
  });

  var props = PropertiesService.getScriptProperties();
  var scriptId = MC_TARGET_SCRIPT_ID_ || props.getProperty('MC_SCRIPT_ID');
  if (scriptId) {
    var current = mcApi_('get', '/' + scriptId + '/content');
    folder.createFile(Utilities.newBlob(JSON.stringify(current, null, 1), 'application/json',
      'backup_' + scriptId + '_' + mcStamp_() + '.json'));
  } else {
    scriptId = mcApi_('post', '', { title: MC_PROJECT_TITLE_ }).scriptId;
    DriveApp.getFileById(scriptId).moveTo(folder);
  }
  props.setProperty('MC_SCRIPT_ID', scriptId);

  mcApi_('put', '/' + scriptId + '/content', { files: [
    { name: 'appsscript', type: 'JSON', source: entries['appsscript.json'].getDataAsString('UTF-8') },
    { name: 'Code', type: 'SERVER_JS', source: entries['Code.gs'].getDataAsString('UTF-8') },
    { name: 'App', type: 'HTML', source: entries['App.html'].getDataAsString('UTF-8') }
  ] });

  var description = zip.getName() + ' · ' + mcStamp_();
  var versionNumber = mcApi_('post', '/' + scriptId + '/versions', { description: description }).versionNumber;
  var config = { scriptId: scriptId, versionNumber: versionNumber, manifestFileName: 'appsscript', description: description };
  var deployments = (mcApi_('get', '/' + scriptId + '/deployments').deployments || []).filter(function (d) {
    return d.deploymentConfig && d.deploymentConfig.versionNumber;
  });
  var saved = props.getProperty('MC_DEPLOYMENT_ID');
  var existing = deployments.filter(function (d) { return d.deploymentId === saved; })[0] || deployments[0];
  var deployment = existing
    ? mcApi_('put', '/' + scriptId + '/deployments/' + existing.deploymentId, { deploymentConfig: config })
    : mcApi_('post', '/' + scriptId + '/deployments', config);
  props.setProperty('MC_DEPLOYMENT_ID', deployment.deploymentId);
  var webApp = (deployment.entryPoints || []).filter(function (e) { return e.entryPointType === 'WEB_APP'; })[0];
  var webAppUrl = webApp ? webApp.webApp.url : '(веб-приложение не найдено в манифесте)';

  var assets = mcSubfolder_(folder, 'Файлы пакета');
  Object.keys(entries).forEach(function (n) {
    if (n === 'Code.gs' || n === 'App.html' || n === 'appsscript.json') return;
    var old = assets.getFilesByName(n);
    while (old.hasNext()) old.next().setTrashed(true);
    assets.createFile(entries[n].setName(n));
  });

  Logger.log([
    'MonChef установлен (версия ' + versionNumber + ').',
    'Проект:            https://script.google.com/d/' + scriptId + '/edit',
    'Веб-приложение:    ' + webAppUrl,
    'Дальше: откройте проект, выполните installJournalTriggers() и разрешите доступ,',
    'затем шаги «Порядок первого запуска» из README (createSystemBackup → validateMigrations → …).'
  ].join('\n'));
  return { scriptId: scriptId, versionNumber: versionNumber, webAppUrl: webAppUrl };
}

function mcFindZip_(folder) {
  var it = folder.getFiles(), best = null;
  while (it.hasNext()) {
    var f = it.next();
    if (!/\.zip$/i.test(f.getName())) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  if (!best) throw new Error('В папке «' + folder.getName() + '» нет .zip-архива MonChef. Загрузите его и запустите снова.');
  return best;
}

function mcUnzip_(file) {
  var out = {};
  Utilities.unzip(file.getBlob().setContentType('application/zip')).forEach(function (b) {
    var name = String(b.getName()).split('/').pop();
    if (name && !/^\._|^\.DS_Store$/.test(name)) out[name] = b;
  });
  return out;
}

function mcApi_(method, path, body) {
  var options = {
    method: method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  };
  if (body) options.payload = JSON.stringify(body);
  var res = UrlFetchApp.fetch(MC_API_ + path, options);
  if (res.getResponseCode() >= 300) {
    throw new Error('Apps Script API ' + method.toUpperCase() + ' ' + path + ': HTTP ' + res.getResponseCode() + ' — ' +
      res.getContentText().slice(0, 500) + '\nПроверьте, что Apps Script API включён: https://script.google.com/home/usersettings');
  }
  return JSON.parse(res.getContentText() || '{}');
}

function mcSubfolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function mcStamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
}
