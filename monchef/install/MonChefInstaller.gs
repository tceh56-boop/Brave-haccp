/**
 * MON CHEF — установщик на Google Диск (сборка Integrated Application 1.0 + Restaurant Service).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Что делает installMonChef():
 *  1. Берёт самый свежий архив сборки MonChef*.zip из папки установки на Диске (архив-комплект «Установка_…» не берёт).
 *  2. Создаёт проект Apps Script «MonChef» (первый раз) или обновляет тот же проект; перед перезаписью сохраняет прежний
 *     код в папку установки (backup_*.json).
 *  3. Записывает в проект все .gs/.html файлы сборки и appsscript.json (Code.gs первым, дальше по имени) и файл настроек
 *     установки MonChef_InstallConfig.gs с рабочей таблицей (V99). Code.gs не правится.
 *  4. Публикует новую версию в то же развёртывание: ссылка на веб-приложение не меняется.
 *  5. Остальные файлы сборки (логотипы, описания) кладёт в подпапку «Файлы пакета».
 *
 * Нужен включённый Apps Script API: https://script.google.com/home/usersettings
 * Повторный запуск безопасен: обновляет тот же проект и то же развёртывание.
 */

// ===================== НАСТРОЙКИ (проверьте перед запуском) =====================
// ID папки установки на Диске («MonChef — установка»): часть адреса папки после folders/.
var MC_INSTALL_FOLDER_ID_ = '199_Kpd04nbT8T4UCwfk3imarDHGJGvHw';
// Пусто — установщик сам помнит свой проект «MonChef». ID вписывают, только если проект создавали вручную.
var MC_TARGET_SCRIPT_ID_ = '';
// Рабочая таблица: ссылка или ID. Пусто — таблица из сборки (запасное значение SHEET_ID в Code.gs).
var MC_SHEET_ID_ = '';
// true — система работает с КОПИЕЙ рабочей таблицы (пилот, проверка). false — с самой рабочей таблицей.
var MC_USE_SHEET_COPY_ = true;
// ================================================================================

var MC_PROJECT_TITLE_ = 'MonChef';
var MC_API_ = 'https://script.googleapis.com/v1/projects';
var MC_CONFIG_FILE_ = 'MonChef_InstallConfig';
// Обязательные файлы сборки: без них это не та сборка (или архив-комплект вместо архива сборки).
var MC_REQUIRED_ = ['Code.gs', 'Console.html', 'appsscript.json', 'zzz_MonChef_Gate.gs', 'Hall.html', 'Kds.html', 'MonChef_V101_RS_Core.gs'];
// Файлы, которые не идут в проект: старые снимки Code.gs, модуль, уже вшитый в Code.gs, демо, файл настроек (его пишет установщик).
var MC_SKIP_ = [/^Code_V\d+\.gs$/, /^MonChef_V55_63_PRODUCTION_RELEASE\.gs$/, /^mon_cher_demo\.html$/, /^MonChef_InstallConfig\.gs$/];

function installMonChef() {
  if (!MC_INSTALL_FOLDER_ID_) throw new Error('Не указана папка установки: впишите её ID в MC_INSTALL_FOLDER_ID_ (часть адреса папки после folders/).');
  var folder = DriveApp.getFolderById(MC_INSTALL_FOLDER_ID_);
  var zip = mcFindZip_(folder);
  var entries = mcUnzip_(zip);
  MC_REQUIRED_.forEach(function (n) {
    if (!entries[n]) throw new Error('В архиве ' + zip.getName() + ' нет файла ' + n + '. Загрузите в папку установки сам архив сборки ' +
      '(MonChef_Integrated_Application_1_0_RS.zip из папки «2_Загрузить_на_Диск»), не распаковывая его, — не архив-комплект с инструкцией.');
  });
  var patchLog = mcApplyPatches_(folder, entries, zip.getName());
  var props = PropertiesService.getScriptProperties();

  // Рабочая таблица: настройка установщика → запасное значение из Code.gs.
  var code = entries['Code.gs'].getDataAsString('UTF-8');
  var sheetId = mcSheetIdFrom_(MC_SHEET_ID_);
  if (MC_SHEET_ID_ && !sheetId) throw new Error('MC_SHEET_ID_ не похоже на ссылку или ID таблицы: «' + MC_SHEET_ID_ + '».');
  if (!sheetId) {
    var m = code.match(/var\s+SHEET_ID\s*=\s*'([^']+)'/);
    if (!m) throw new Error('В Code.gs не найдена константа SHEET_ID, а MC_SHEET_ID_ пуст. Впишите ссылку на рабочую таблицу в MC_SHEET_ID_.');
    sheetId = m[1];
  }
  var workId = sheetId;
  DriveApp.getFileById(workId);   // таблица открывается под этой учётной записью — иначе понятная ошибка до записи кода
  if (MC_USE_SHEET_COPY_) {
    var copyId = props.getProperty('MC_SHEET_COPY_ID');
    var copyFrom = props.getProperty('MC_SHEET_COPY_FROM');
    if (copyId && copyFrom && copyFrom !== workId) copyId = '';   // сменили рабочую таблицу — нужна копия новой
    if (!copyId) {
      var original = DriveApp.getFileById(workId);
      copyId = original.makeCopy(original.getName() + ' — пилот MonChef', folder).getId();
      props.setProperty('MC_SHEET_COPY_ID', copyId);
      props.setProperty('MC_SHEET_COPY_FROM', workId);
    }
    sheetId = copyId;
  }

  var projectFiles = mcProjectFiles_(entries);
  var scriptId = MC_TARGET_SCRIPT_ID_ || props.getProperty('MC_SCRIPT_ID');
  if (scriptId) {
    var current = mcApi_('get', '/' + scriptId + '/content');
    folder.createFile(Utilities.newBlob(JSON.stringify(current, null, 1), 'application/json', 'backup_' + scriptId + '_' + mcStamp_() + '.json'));
  } else {
    scriptId = mcApi_('post', '', { title: MC_PROJECT_TITLE_ }).scriptId;
    DriveApp.getFileById(scriptId).moveTo(folder);
  }
  props.setProperty('MC_SCRIPT_ID', scriptId);

  var files = projectFiles.map(function (n) {
    return {
      name: n.replace(/\.(gs|html|json)$/, ''),
      type: /\.json$/.test(n) ? 'JSON' : /\.html$/.test(n) ? 'HTML' : 'SERVER_JS',
      // Пустой файл API может отвергнуть — оставляем комментарий.
      source: entries[n].getDataAsString('UTF-8') || (/\.html$/.test(n) ? '<!-- пустой файл пакета -->' : '// пустой файл пакета')
    };
  });
  files.push({ name: MC_CONFIG_FILE_, type: 'SERVER_JS', source: mcConfigSource_(sheetId, zip.getName()) });
  mcApi_('put', '/' + scriptId + '/content', { files: files });

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
    if (projectFiles.indexOf(n) >= 0 || MC_SKIP_.some(function (re) { return re.test(n); })) return;
    var old = assets.getFilesByName(n);
    while (old.hasNext()) old.next().setTrashed(true);
    assets.createFile(entries[n].setName(n));
  });

  var lines = [
    'MonChef установлен (версия ' + versionNumber + ', файлов в проекте: ' + files.length + ').',
    'Архив: ' + zip.getName() + '.',
    'Пропущены как дубли: ' + (mcSkipped_(entries).join(', ') || 'нет') + '.',
    patchLog.skipped || ('Исправления: применено ' + patchLog.applied + ', уже были ' + patchLog.already + ', не подошли ' + patchLog.failed.length +
      (patchLog.failed.length ? ' (' + patchLog.failed.join('; ') + ')' : '') + '.'),
    fixedZip ? 'Исправленный архив: ' + fixedZip.getUrl() : 'Исправленный архив не создавался.',
    'Проект:            https://script.google.com/d/' + scriptId + '/edit',
    'Веб-приложение:    ' + webAppUrl,
    'Таблица' + (MC_USE_SHEET_COPY_ ? ' (копия для пилота): ' : ' (рабочая): ') + 'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit',
    'Таблица записана в настройки установки (файл проекта ' + MC_CONFIG_FILE_ + '.gs); сменить — «Настройки» → «Настройки установки».',
    'Дальше: откройте проект MonChef, выполните installAllTriggers и разрешите доступ. Затем в веб-приложении — код технического доступа →',
    '«Настройки»: «Миграция данных», «Перенос ролей», «🔒 Защита журналов». Подробно — «1_Инструкция_по_установке».'
  ];
  Logger.log(lines.join('\n'));
  return { scriptId: scriptId, versionNumber: versionNumber, webAppUrl: webAppUrl, sheetId: sheetId, files: files.length, log: lines };
}

/** ID таблицы из ссылки или из самого ID; пусто — если не похоже. */
function mcSheetIdFrom_(s) {
  s = String(s || '').trim();
  if (!s) return '';
  var m = /\/d\/([a-zA-Z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : '';
}

function mcConfigSource_(sheetId, zipName) {
  return [
    '/**',
    ' * MON CHEF — настройки установки. Файл пишет установщик MonChefInstaller.gs при каждой установке; руками не править.',
    ' * Сменить рабочую таблицу — в приложении: «Настройки» → «Настройки установки» (технический доступ) или настройка MC_SHEET_ID_',
    ' * установщика и повторный запуск installMonChef.',
    ' *',
    ' * Собственность Слепцова Дениса Владимировича.',
    ' * Разработчик кода — Слепцов Денис Владимирович.',
    ' */',
    "var MC_INSTALL_SHEET_ID_ = '" + String(sheetId).replace(/[^a-zA-Z0-9_-]/g, '') + "';",
    "var MC_INSTALL_BUILD_ = '" + String(zipName).replace(/[\\']/g, '') + ' · ' + mcStamp_() + "';",
    ''
  ].join('\n');
}

// Исправления к пакету: файл MonChefPatches.json в папке установки.
// { "forArchive": "MonChef_…", "replace": [{ "file", "find", "replace" }], "replaceAll": [...], "add": [{ "file", "content" }] }
// Применяется только к архиву, имя которого начинается с forArchive: старые исправления не затирают новую сборку.
function mcApplyPatches_(folder, entries, zipName) {
  var log = { applied: 0, already: 0, failed: [], skipped: '' };
  var it = folder.getFilesByName('MonChefPatches.json');
  if (!it.hasNext()) return log;
  var spec = JSON.parse(it.next().getBlob().getDataAsString('UTF-8'));
  var targets = [].concat(spec.forArchive || []).map(String);
  if (!targets.some(function (t) { return t && String(zipName).indexOf(t) === 0; })) {
    log.skipped = 'MonChefPatches.json не применён: он ' + (targets.length ? 'для архива «' + targets.join('», «') + '»' : 'без поля forArchive (старый)') +
      ', а установлен «' + zipName + '». Уберите его из папки установки.';
    return log;
  }
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
  Object.keys(text).forEach(function (n) { if (text[n] !== null) entries[n] = Utilities.newBlob(text[n], 'text/plain', n); });
  return log;
}

function mcSaveFixedZip_(folder, zip, entries) {
  var name = zip.getName().replace(/(_FIXED)?\.zip$/i, '') + '_FIXED.zip';
  var old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  var blobs = Object.keys(entries).sort().map(function (n) { return entries[n].copyBlob().setName(n); });
  return folder.createFile(Utilities.zip(blobs, name));
}

/** Файлы проекта: appsscript.json, Code.gs, затем остальные .gs/.html по имени (порядок загрузки модулей). */
function mcProjectFiles_(entries) {
  var names = Object.keys(entries).filter(function (n) {
    return (/\.(gs|html)$/.test(n) || n === 'appsscript.json') && !MC_SKIP_.some(function (re) { return re.test(n); });
  }).sort();
  return ['appsscript.json', 'Code.gs'].concat(names.filter(function (n) { return n !== 'appsscript.json' && n !== 'Code.gs'; }));
}

function mcSkipped_(entries) {
  return Object.keys(entries).filter(function (n) { return MC_SKIP_.some(function (re) { return re.test(n); }) && n !== 'MonChef_InstallConfig.gs'; });
}

/** Самый свежий архив сборки MonChef*.zip в папке установки (не в подпапках). */
function mcFindZip_(folder) {
  var it = folder.getFiles(), best = null;
  while (it.hasNext()) {
    var f = it.next();
    if (!/^MonChef.*\.zip$/i.test(f.getName()) || /_FIXED\.zip$/i.test(f.getName())) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  if (!best) throw new Error('В папке «' + folder.getName() + '» нет .zip-архива MonChef. Загрузите MonChef_Integrated_Application_1_0_RS.zip ' +
    '(не распаковывая) и запустите снова. Имя архива должно начинаться с «MonChef».');
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
  var options = { method: method, muteHttpExceptions: true, contentType: 'application/json', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
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
