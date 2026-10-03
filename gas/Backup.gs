// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Backup.gs
 * Резервное копирование (ТЗ §18/§25/§35 тест 12). MVP: реальная копия файла таблицы
 * через Drive API + запись в журнал BACKUPS. Восстановление — вручную через Drive
 * (открыть копию, Файл → Сделать текущей копией БД) — авто-восстановление сознательно
 * не делается на этом этапе: подмена боевой таблицы без участия человека — это ровно
 * тот "рискованный необратимый шаг", который ТЗ §22 просит не делать без подтверждения.
 */

/**
 * Внешний P0-аудит, остаток P0.3 (раунд 12) — НАЙДЕНО: createBackup_ вообще не принимал
 * инициатора и ни разу не писал в auditLog_ — при этом это действие копирует ВСЮ общую
 * таблицу (все организации платформы сразу, см. открытый вопрос в Config.gs про
 * 'ADMIN': 'all' и модуль 'backup') и до этой правки не оставляло ни следа о том, кто именно
 * запросил копию. actorUserId необязателен: ежедневный триггер (dailyBackupTrigger_) вызывает
 * без него — такие записи логируются с пустым user_id и пометкой "плановый", чтобы не путать
 * с ручным вызовом администратором.
 *
 * Это тоже НЕ решает сам вопрос "должен ли рядовой ADMIN арендатора вообще иметь доступ к
 * бэкапу всей платформы" — только даёт теперь возможность увидеть в истории, кто это делал.
 */
function createBackup_(actorUserId) {
  var ss = getDatabase_();
  var file = DriveApp.getFileById(ss.getId());
  var copy = file.makeCopy('ЦЕХ — бэкап ' + new Date().toISOString().slice(0, 19).replace('T', ' '));

  var backup = {
    backup_id: generateId_('BACKUPS'),
    тип: actorUserId ? 'ручной_снапшот' : 'плановый_снапшот',
    ссылка_на_файл: copy.getUrl(),
    статус: 'готов',
    создано: nowIso_()
  };
  insertRow_('BACKUPS', backup);
  auditLog_(actorUserId || null, actorUserId ? 'Создан ручной бэкап (вся платформа)' : 'Создан плановый бэкап (вся платформа)', 'BACKUPS:' + backup.backup_id, null, backup.ссылка_на_файл, 'success');
  return backup;
}

function getBackups_() {
  return findRows_('BACKUPS', function () { return true; })
    .sort(function (a, b) { return new Date(b.создано) - new Date(a.создано); });
}

/** Триггер: ежедневный бэкап (устанавливается installTriggers() в Main.gs). */
function dailyBackupTrigger_() {
  try {
    createBackup_();
  } catch (err) {
    logSystemError_('dailyBackupTrigger_', null, 'backup', err);
  }
}
