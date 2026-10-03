/**
 * MON CHEF — установщик на Google Диск.
 *
 * Берёт архив MonChef_*.zip из папки установки на Диске, создаёт отдельный проект
 * Apps Script «MonChef» (или обновляет уже созданный), записывает в него все
 * .gs/.html файлы пакета и appsscript.json, публикует веб-приложение и раскладывает
 * остальные файлы (логотипы, README, демо) в подпапку «Файлы пакета».
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
// true — система работает с КОПИЕЙ рабочей таблицы (пилот, как требует README пакета);
// false — с самой рабочей таблицей из SHEET_ID в Code.gs. Копия создаётся один раз и переиспользуется.
var MC_USE_SHEET_COPY_ = true;
var MC_API_ = 'https://script.googleapis.com/v1/projects';

function installMonChef() {
  var folder = DriveApp.getFolderById(MC_INSTALL_FOLDER_ID_);
  var zip = mcFindZip_(folder);
  var entries = mcUnzip_(zip);
  ['Code.gs', 'App.html', 'appsscript.json'].forEach(function (n) {
    if (!entries[n]) throw new Error('В архиве ' + zip.getName() + ' нет файла ' + n + '.');
  });
  var patchLog = mcApplyPatches_(folder, entries);
  var projectFiles = mcProjectFiles_(entries);
  var props = PropertiesService.getScriptProperties();
  var code = entries['Code.gs'].getDataAsString('UTF-8');
  var sheetMatch = code.match(/var\s+SHEET_ID\s*=\s*'([^']+)'/);
  if (!sheetMatch) throw new Error('В Code.gs не найдена константа SHEET_ID.');
  var sheetId = sheetMatch[1];
  if (MC_USE_SHEET_COPY_) {
    var copyId = props.getProperty('MC_SHEET_COPY_ID');
    if (!copyId) {
      var original = DriveApp.getFileById(sheetId);
      copyId = original.makeCopy(original.getName() + ' — пилот MonChef', folder).getId();
      props.setProperty('MC_SHEET_COPY_ID', copyId);
    }
    code = code.split(sheetId).join(copyId);
    sheetId = copyId;
  }

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

  mcApi_('put', '/' + scriptId + '/content', { files: projectFiles.map(function (n) {
    return {
      name: n.replace(/\.(gs|html|json)$/, ''),
      type: /\.json$/.test(n) ? 'JSON' : /\.html$/.test(n) ? 'HTML' : 'SERVER_JS',
      // Пустой файл API может отвергнуть (в пакете пуст Surplus.html) — оставляем комментарий.
      source: (n === 'Code.gs' ? code : entries[n].getDataAsString('UTF-8')) || (/\.html$/.test(n) ? '<!-- пустой файл пакета -->' : '// пустой файл пакета')
    };
  }) });

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

  var fixedZip = patchLog.applied ? mcSaveFixedZip_(folder, zip, entries) : null;

  var assets = mcSubfolder_(folder, 'Файлы пакета');
  Object.keys(entries).forEach(function (n) {
    if (projectFiles.indexOf(n) >= 0) return;
    var old = assets.getFilesByName(n);
    while (old.hasNext()) old.next().setTrashed(true);
    assets.createFile(entries[n].setName(n));
  });

  Logger.log([
    'MonChef установлен (версия ' + versionNumber + ', файлов в проекте: ' + projectFiles.length + ').',
    'Пропущены как дубли: ' + (mcSkipped_(entries).join(', ') || 'нет') + '.',
    'Исправления: применено ' + patchLog.applied + ', уже были ' + patchLog.already + ', не подошли ' + patchLog.failed.length +
      (patchLog.failed.length ? ' (' + patchLog.failed.join('; ') + ')' : '') + '.',
    fixedZip ? 'Исправленный архив: ' + fixedZip.getUrl() : 'Исправленный архив не создавался.',
    'Проект:            https://script.google.com/d/' + scriptId + '/edit',
    'Веб-приложение:    ' + webAppUrl,
    'Таблица' + (MC_USE_SHEET_COPY_ ? ' (копия для пилота): ' : ' (рабочая): ') + 'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit',
    'Дальше: в проекте MonChef выполните setupProductionReleaseStack и разрешите доступ, затем v61RunStructuralTests',
    'и installAllTriggers (ставит все автозапуски двумя триггерами). Вход в систему с полным доступом — ПИН создателя.'
  ].join('\n'));
  return { scriptId: scriptId, versionNumber: versionNumber, webAppUrl: webAppUrl, sheetId: sheetId };
}

// Файлы пакета, которые не идут в проект: старые снимки Code.gs, модули, уже вшитые
// в Code.gs целиком (их функции объявлены дважды), и автономное демо.
var MC_SKIP_ = [/^Code_V\d+\.gs$/, /^MonChef_V55_63_PRODUCTION_RELEASE\.gs$/, /^mon_cher_demo\.html$/];

// Исправления к пакету: файл MonChefPatches.json в папке установки.
// { "replace": [{ "file", "find", "replace" }], "replaceAll": [{ "file", "find", "replace" }],
//   "add": [{ "file", "content" }] }
// Правка, которая уже внесена (найден только новый текст), пропускается.
function mcApplyPatches_(folder, entries) {
  var log = { applied: 0, already: 0, failed: [] };
  var it = folder.getFilesByName('MonChefPatches.json');
  if (!it.hasNext()) return log;
  var spec = JSON.parse(it.next().getBlob().getDataAsString('UTF-8'));
  var text = {};
  function src(n) { if (!(n in text)) text[n] = entries[n] ? entries[n].getDataAsString('UTF-8') : null; return text[n]; }
  (spec.replace || []).forEach(function (p) {
    var s = src(p.file);
    if (s === null) { log.failed.push(p.file + ': нет файла'); return; }
    var n = s.split(p.find).length - 1;
    if (n === 1) { text[p.file] = s.replace(p.find, function () { return p.replace; }); log.applied++; }
    else if (n === 0 && s.indexOf(p.replace) >= 0) log.already++;
    else log.failed.push(p.file + ': ' + (p.note || p.find.slice(0, 40)));
  });
  (spec.replaceAll || []).forEach(function (p) {
    var s = src(p.file);
    if (s === null) { log.failed.push(p.file + ': нет файла'); return; }
    if (s.indexOf(p.find) < 0) { log.already++; return; }
    text[p.file] = s.split(p.find).join(p.replace); log.applied++;
  });
  (spec.add || []).forEach(function (a) {
    if (src(a.file) === a.content) { log.already++; return; }
    text[a.file] = a.content; log.applied++;
  });
  Object.keys(text).forEach(function (n) {
    if (text[n] !== null) entries[n] = Utilities.newBlob(text[n], 'text/plain', n);
  });
  return log;
}

function mcSaveFixedZip_(folder, zip, entries) {
  var name = zip.getName().replace(/(_FIXED)?\.zip$/i, '') + '_FIXED.zip';
  var old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  var blobs = Object.keys(entries).sort().map(function (n) { return entries[n].copyBlob().setName(n); });
  return folder.createFile(Utilities.zip(blobs, name));
}

function mcProjectFiles_(entries) {
  var names = Object.keys(entries).filter(function (n) {
    return (/\.(gs|html)$/.test(n) || n === 'appsscript.json') && !MC_SKIP_.some(function (re) { return re.test(n); });
  }).sort();
  // Code.gs первым: модули опираются на его глобальные объявления.
  return ['appsscript.json', 'Code.gs'].concat(names.filter(function (n) { return n !== 'appsscript.json' && n !== 'Code.gs'; }));
}

function mcSkipped_(entries) {
  return Object.keys(entries).filter(function (n) { return MC_SKIP_.some(function (re) { return re.test(n); }); });
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
