/**
 * San.Lab — установщик.
 * Создаёт на вашем Google Диске проект Apps Script «San.Lab CRM» из готовой сборки dist/gas.
 *
 * 1. script.google.com → «Новый проект» → вставьте этот файл вместо Code.gs.
 * 2. «Настройки проекта» (шестерёнка слева) → включите «Показывать файл манифеста appsscript.json».
 * 3. Вернитесь в «Редактор» → откройте appsscript.json → замените его содержимое на:
 *
 *    {
 *      "timeZone": "Asia/Yekaterinburg",
 *      "runtimeVersion": "V8",
 *      "exceptionLogging": "STACKDRIVER",
 *      "oauthScopes": [
 *        "https://www.googleapis.com/auth/drive",
 *        "https://www.googleapis.com/auth/drive.scripts",
 *        "https://www.googleapis.com/auth/script.external_request"
 *      ]
 *    }
 *
 * 4. Сохраните, выберите функцию install → «Выполнить» → выдайте разрешения заново.
 * 5. В журнале появится ссылка на созданный проект. Откройте его и продолжайте по README (setup → развёртывание).
 *
 * Обновление уже установленной системы: выберите функцию update → «Выполнить».
 * Код проекта «San.Lab CRM» заменится новой сборкой; база, папки, настройки и триггеры не меняются.
 * После обновления: в проекте San.Lab CRM «Развернуть» → «Управление развёртываниями» → ✎ → Версия: «Новая версия» → «Развернуть».
 */

var SANLAB_SOURCE = 'https://raw.githubusercontent.com/tceh56-boop/Brave-haccp/claude/awesome-clarke-gz52h1/sanlab/install/project.json';
var SANLAB_FOLDER_ID = '1xrp-uHBNm3vc3VZKnPJ_bmYEyjtcZyIE'; // папка «San.Lab CRM»; пусто — корень Диска
var SANLAB_PROJECT_NAME = 'San.Lab CRM';

function install() {
  var resp = UrlFetchApp.fetch(SANLAB_SOURCE, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Не удалось скачать сборку: HTTP ' + resp.getResponseCode());
  var json = resp.getContentText('UTF-8');
  var files = JSON.parse(json).files;
  Logger.log('Скачано файлов проекта: ' + files.length);

  var parents = [];
  if (SANLAB_FOLDER_ID) parents.push(DriveApp.getFolderById(SANLAB_FOLDER_ID).getId());
  else DriveApp.getRootFolder();

  var boundary = 'sanlab_' + Utilities.getUuid();
  var meta = { name: SANLAB_PROJECT_NAME, mimeType: 'application/vnd.google-apps.script', parents: parents };
  var body = '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: application/vnd.google-apps.script+json\r\n\r\n' + json + '\r\n' +
    '--' + boundary + '--';

  var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'post',
    contentType: 'multipart/related; boundary=' + boundary,
    payload: Utilities.newBlob(body).getBytes(),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Drive отказал в создании проекта: ' + res.getContentText());
  var id = JSON.parse(res.getContentText()).id;
  Logger.log('Готово. Проект создан: https://script.google.com/d/' + id + '/edit');
  Logger.log('Дальше: откройте проект → функция setup → «Выполнить» → «Развернуть» → «Веб-приложение».');
}

function update() {
  var resp = UrlFetchApp.fetch(SANLAB_SOURCE, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Не удалось скачать сборку: HTTP ' + resp.getResponseCode());
  var json = resp.getContentText('UTF-8');
  Logger.log('Скачано файлов проекта: ' + JSON.parse(json).files.length);

  var it = SANLAB_FOLDER_ID ? DriveApp.getFolderById(SANLAB_FOLDER_ID).getFilesByType('application/vnd.google-apps.script')
                            : DriveApp.getFilesByType('application/vnd.google-apps.script');
  var target = null;
  while (it.hasNext()) { var f = it.next(); if (f.getName() === SANLAB_PROJECT_NAME && !f.isTrashed()) { target = f; break; } }
  if (!target) throw new Error('Проект «' + SANLAB_PROJECT_NAME + '» не найден. Сначала выполните install.');

  var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files/' + target.getId() + '?uploadType=media', {
    method: 'patch',
    contentType: 'application/vnd.google-apps.script+json',
    payload: Utilities.newBlob(json).getBytes(),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Drive отказал в обновлении проекта: ' + res.getContentText());
  Logger.log('Готово. Проект обновлён: https://script.google.com/d/' + target.getId() + '/edit');
  Logger.log('Теперь в проекте San.Lab CRM: «Развернуть» → «Управление развёртываниями» → ✎ → Версия: «Новая версия» → «Развернуть». Ссылка для сотрудников не изменится.');
}
