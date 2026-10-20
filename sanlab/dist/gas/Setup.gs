/**
 * San.Lab — Setup.gs
 * Установка: база SANITARY_ERP_DB, листы и колонки, папки Drive, настройки, владелец, справочники, триггеры.
 * Резервное копирование и восстановление (раздел 14.3 ТЗ).
 * Все функции можно запускать повторно — существующие данные не перезаписываются.
 */

var DRIVE_TREE = ['00_ADMIN', '01_CLIENTS', '02_VISITS', '03_LABORATORY', '04_DOCUMENT_TEMPLATES', '05_FINANCE', '06_EXPORTS_BACKUPS'];

/* Подписи колонок (заметки к заголовкам листов) */
var COLUMN_LABELS = {
  employee_id: 'ID сотрудника', full_name: 'ФИО', email: 'E-mail (аккаунт Google)', role: 'Роль', active: 'Активен', pin_hash: 'Хеш PIN (не редактировать)',
  client_id: 'ID клиента', legal_name: 'Наименование', inn: 'ИНН', site_id: 'ID объекта', site_name: 'Объект', address: 'Адрес',
  visit_id: 'ID выезда', planned_start: 'План: начало', planned_end: 'План: окончание', actual_start: 'Факт: начало', actual_end: 'Факт: окончание',
  status: 'Статус (код)', calendar_event_id: 'ID события Calendar', drive_folder_id: 'ID папки Drive', drive_file_id: 'ID файла Drive',
  created_at: 'Создано', created_by: 'Кем создано', updated_at: 'Изменено', updated_by: 'Кем изменено', record_status: 'Состояние записи', row_version: 'Версия строки',
  amount: 'Сумма, ₽', operation_type: 'Тип операции', operation_date: 'Дата операции', due_date: 'Срок', payment_status: 'Статус оплаты',
  sample_id: 'ID пробы', result_due_at: 'Ожидаемый срок результата', task_id: 'ID задачи', responsible_id: 'Ответственный', priority: 'Приоритет'
};

function setup() {
  var props = PropertiesService.getScriptProperties();
  var me = Session.getEffectiveUser().getEmail();

  /* 1. Корневая папка и структура Drive (раздел 11 ТЗ) */
  var rootId = props.getProperty('DRIVE_ROOT_ID');
  var root = rootId ? DriveApp.getFolderById(rootId) : DriveApp.createFolder('San.Lab');
  props.setProperty('DRIVE_ROOT_ID', root.getId());
  var sub = {};
  DRIVE_TREE.forEach(function (n) { var it = root.getFoldersByName(n); sub[n] = it.hasNext() ? it.next() : root.createFolder(n); });

  /* 2. Таблица */
  var dbId = props.getProperty('DB_ID'), ss;
  if (dbId) ss = SpreadsheetApp.openById(dbId);
  else {
    ss = SpreadsheetApp.create('SANITARY_ERP_DB');
    props.setProperty('DB_ID', ss.getId());
    var f = DriveApp.getFileById(ss.getId());
    sub['00_ADMIN'].addFile(f); DriveApp.getRootFolder().removeFile(f);
  }
  ss.setSpreadsheetTimeZone(SETTINGS_DEFAULTS.TIMEZONE[0]);
  Object.keys(SCHEMA).forEach(function (name) {
    if (name === 'Requests') return; // идемпотентность хранится в CacheService
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = SCHEMA[name];
    var lastCol = sh.getLastColumn();
    var header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var missing = cols.filter(function (c) { return header.indexOf(c) < 0; });
    if (missing.length) {
      /* Новые колонки дописываются справа — существующие данные не сдвигаются */
      sh.getRange(1, header.filter(String).length + 1, 1, missing.length).setValues([missing]);
    }
    header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#0B2A5B').setFontColor('#FFFFFF');
    header.forEach(function (c, i) {
      if (COLUMN_LABELS[c]) sh.getRange(1, i + 1).setNote(COLUMN_LABELS[c]);
      if (isDateColumn(c)) sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('dd.MM.yyyy HH:mm');
    });
  });
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Лист1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  /* Защита: прямое редактирование только владельцем скрипта (сотрудники работают через интерфейс) */
  ss.getSheets().forEach(function (sh) {
    var pr = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    var p = pr.length ? pr[0] : sh.protect().setDescription('San.Lab: изменения только через приложение');
    p.removeEditors(p.getEditors().filter(function (u) { return u.getEmail() !== me; }));
    if (p.canDomainEdit()) p.setDomainEdit(false);
  });
  Store.resetCache();

  /* 3. Настройки */
  var ctx = { now: new Date().toISOString(), requestId: 'setup', actorId: 'SYSTEM', actorEmail: me, user: { role: 'OWNER', employee_id: 'SYSTEM' } };
  Store.beginBatch();
  Object.keys(SETTINGS_DEFAULTS).forEach(function (k) {
    if (!Store.get('Settings', k)) Store.insert('Settings', { setting_key: k, value: SETTINGS_DEFAULTS[k][0], description: SETTINGS_DEFAULTS[k][1], updated_by: 'SYSTEM', updated_at: ctx.now });
  });
  Store.update('Settings', 'DRIVE_ROOT_ID', { value: root.getId(), updated_at: ctx.now });
  Store.commitBatch();
  Settings.reset();

  /* 4. Владелец системы — текущий пользователь */
  var owner = Auth.byEmail(String(me).toLowerCase());
  Store.beginBatch();
  if (!owner) owner = Repo.create(ctx, 'Employees', { full_name: 'Руководитель (заполните ФИО)', email: String(me).toLowerCase(), role: 'OWNER', active: true }, { action: 'SETUP_OWNER' });
  Store.commitBatch();

  /* 5. Справочники: чек-листы и услуги (критерии — проект, утверждается ответственным) */
  Store.beginBatch();
  Seed.reference(owner);
  Store.commitBatch();

  /* 6. Триггеры */
  installTriggers();
  Store.beginBatch(); Audit.log(ctx, 'SETUP', 'System', 'setup', null, { db: ss.getId(), root: root.getId(), version: APP_VERSION }); Store.commitBatch();
  Logger.log('Готово. База: ' + ss.getUrl() + '\nПапка: ' + root.getUrl() + '\nТеперь: Развернуть → Новое развёртывание → Веб-приложение.');
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['jobDaily', 'jobFrequent', 'jobBackup'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  var hour = Number(Settings.get('VISIT_REMINDER_HOUR')) || 7;
  ScriptApp.newTrigger('jobDaily').timeBased().everyDays(1).atHour(hour).inTimezone(SETTINGS_DEFAULTS.TIMEZONE[0]).create();
  ScriptApp.newTrigger('jobFrequent').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('jobBackup').timeBased().everyDays(1).atHour(2).inTimezone(SETTINGS_DEFAULTS.TIMEZONE[0]).create();
}

/* ---------- Резервные копии (14.3 ТЗ) ---------- */
function backupNow() {
  var props = PropertiesService.getScriptProperties();
  var src = DriveApp.getFileById(props.getProperty('DB_ID'));
  var root = DriveApp.getFolderById(props.getProperty('DRIVE_ROOT_ID'));
  var it = root.getFoldersByName('06_EXPORTS_BACKUPS');
  var folder = it.hasNext() ? it.next() : root.createFolder('06_EXPORTS_BACKUPS');
  var stamp = Utilities.formatDate(new Date(), SETTINGS_DEFAULTS.TIMEZONE[0], 'yyyy-MM-dd_HHmm');
  var copy = src.makeCopy('SANITARY_ERP_DB_backup_' + stamp, folder);
  var keep = Number(Settings.get('BACKUP_KEEP')) || 14;
  var files = [], fi = folder.getFiles();
  while (fi.hasNext()) { var f = fi.next(); if (/^SANITARY_ERP_DB_backup_/.test(f.getName())) files.push(f); }
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(keep).forEach(function (f) { f.setTrashed(true); });
  var ctx = { now: new Date().toISOString(), requestId: 'backup', actorId: 'SYSTEM', actorEmail: 'system' };
  Store.beginBatch(); Audit.log(ctx, 'BACKUP', 'System', copy.getId(), null, { name: copy.getName(), kept: Math.min(files.length, keep) }); Store.commitBatch();
  return copy.getId();
}

/**
 * Восстановление (AT-14). Запускать вручную из редактора:
 *   restoreFromBackup('ID_файла_резервной_копии')
 * Текущая база не удаляется: она переименовывается с пометкой и остаётся для разбора.
 * Счётчики ID не откатываются — ID никогда не переиспользуются.
 */
function restoreFromBackup(backupFileId) {
  if (!backupFileId) throw new Error('Укажите ID файла резервной копии из папки 06_EXPORTS_BACKUPS');
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var old = DriveApp.getFileById(props.getProperty('DB_ID'));
    var stamp = Utilities.formatDate(new Date(), SETTINGS_DEFAULTS.TIMEZONE[0], 'yyyy-MM-dd_HHmm');
    old.setName('SANITARY_ERP_DB_replaced_' + stamp);
    var adminIt = DriveApp.getFolderById(props.getProperty('DRIVE_ROOT_ID')).getFoldersByName('00_ADMIN');
    var restored = DriveApp.getFileById(backupFileId).makeCopy('SANITARY_ERP_DB', adminIt.next());
    props.setProperty('DB_ID', restored.getId());
    Store.resetCache();
    var ctx = { now: new Date().toISOString(), requestId: 'restore', actorId: 'SYSTEM', actorEmail: Session.getEffectiveUser().getEmail() };
    Store.beginBatch(); Audit.log(ctx, 'RESTORE', 'System', restored.getId(), { replaced: old.getId() }, { from_backup: backupFileId }); Store.commitBatch();
    Logger.log('Восстановлено из ' + backupFileId + '. Новая база: ' + restored.getUrl() + '. Прежняя: ' + old.getUrl());
  } finally { lock.releaseLock(); }
}

/* Только для ТЕСТОВОЙ копии: заполнить демо-данными (без писем и событий календаря) */
function seedDemoData() {
  if (Store.all('Visits').length) throw new Error('В базе уже есть выезды — демо-данные загружаются только в пустую тестовую базу');
  INTEGR_DEMO_MODE = true;
  Store.beginBatch();
  Seed.demo({ historyDays: 24 });
  Store.commitBatch();
  Logger.log('Демо-данные загружены. Вход для проверки: PIN-режим, e-mail из листа Employees, PIN 1234.');
}

/* Назначить сотруднику PIN (для AUTH_MODE = PIN) */
function setPin(email, pin) {
  var e = Auth.byEmail(String(email).toLowerCase());
  if (!e) throw new Error('Сотрудник не найден');
  if (!/^\d{4,6}$/.test(String(pin))) throw new Error('PIN — 4–6 цифр');
  Store.beginBatch();
  Store.update('Employees', e.employee_id, { pin_hash: Integr.hash(String(email).toLowerCase() + ':' + pin) });
  Store.commitBatch();
}
