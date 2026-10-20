/**
 * San.Lab — Code.gs
 * Вход Web App и маршрутизация. Вся логика — в сервисах ядра (Api.handle).
 */

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Index');
  t.bootMode = 'gas';
  return t.evaluate()
    .setTitle('San.Lab — санитарное сопровождение')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/* Единственная функция, вызываемая из браузера (google.script.run.api). Ответ — JSON-строка. */
function api(action, payload, token, requestId) {
  var res = Api.handle(String(action || ''), payload || {}, token || '', requestId || '');
  return JSON.stringify(res);
}

/* ---------- Триггеры ---------- */
function jobDaily() { Api.runJob('daily'); }
function jobFrequent() { Api.runJob('frequent'); }
function jobBackup() { backupNow(); }
