/**
 * ЦЕХ Стандарт Admin — точка входа и первичная установка.
 *
 * Установка (один раз, из редактора Apps Script под аккаунтом владельца):
 *   1. setupAdmin()  — создаёт таблицу-базу со всеми листами, тарифы по умолчанию, токен webhook
 *                      и первого Super Admin (email владельца). Временный пароль — в журнале выполнения.
 *   2. installTriggers() — ежедневная задача (напоминания, снимок аналитики).
 *   3. Развернуть → Новое развёртывание → Веб-приложение: «Запуск от: я», «Доступ: все» (нужно для API клиентов
 *      и уведомлений об оплате). Вход в панель защищён паролем и ролями.
 */
function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate().setTitle(APP_NAME).addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);
}
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

function setupAdmin() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('ADMIN_SHEET_ID');
  if (!id) {
    var ss = SpreadsheetApp.create('ЦЕХ Стандарт Admin — база');
    id = ss.getId(); p.setProperty('ADMIN_SHEET_ID', id);
    try { DriveApp.getFileById(id).moveTo(docsFolder_()); } catch (e) {}
  }
  _DB_ = null;
  Object.keys(SHEETS).forEach(function (n) { sheet(n); });
  var first = db().getSheetByName('Лист1') || db().getSheetByName('Sheet1'); if (first && db().getSheets().length > 1) db().deleteSheet(first);
  if (!findBy('System_Settings', 'Ключ', 'TARIFFS')) setSetting('TARIFFS', DEFAULT_TARIFFS, 'Тарифы и цены: подключение (разово) и обслуживание в месяц');
  if (!findBy('System_Settings', 'Ключ', 'PAYMENT_PROVIDER')) setSetting('PAYMENT_PROVIDER', 'manual', 'manual | yookassa | yoomoney');
  if (!p.getProperty('WEBHOOK_TOKEN')) p.setProperty('WEBHOOK_TOKEN', randomToken(24));
  var email = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(), msg = 'База: https://docs.google.com/spreadsheets/d/' + id;
  if (email && !findBy('Users', 'Email', email)) {
    var pwd = randomToken(6) + '-' + randomToken(6), salt = Utilities.getUuid();
    insert('Users', { 'Email': email, 'Имя': 'Владелец', 'Роль': 'SUPER_ADMIN', 'Статус': 'ACTIVE', 'Хэш пароля': hashPassword(pwd, salt), 'Соль': salt, 'Создан': new Date() });
    msg += '\nSuper Admin: ' + email + '\nВременный пароль: ' + pwd + '  (смените после входа: «Профиль → Сменить пароль»)';
  }
  logEvent('CHANGE', 'установка', 'setup', 'Установка / проверка структуры базы');
  Logger.log(msg);
  return msg;
}
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyJob') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(9).create();
  Logger.log('Ежедневная задача dailyJob — 9:00');
}
/** Сброс пароля владельца из редактора (если забыт). */
function resetOwnerPassword() {
  var email = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(), pwd = randomToken(6) + '-' + randomToken(6), salt = Utilities.getUuid();
  update('Users', email, { 'Хэш пароля': hashPassword(pwd, salt), 'Соль': salt, 'Статус': 'ACTIVE' });
  Logger.log('Новый пароль ' + email + ': ' + pwd);
}
