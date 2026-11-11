/**
 * ЦЕХ Стандарт — все файлы системы в одном дереве папок предприятия (TS2_DRIVE_TREE_):
 *   «ENT-… — Название / 12_Журналы, 14_Резервные_копии, 99_Архив, 06_ХАССП_и_ППК/Пакеты проверки, 03_Продукты_и_Поставщики/Документы на сырьё».
 * Модули MonChef раньше создавали отдельные папки в корне Диска («ЦЕХ Стандарт — Архив», «— Журналы», «Бэкапы …»).
 * Если дерево предприятия установлено, такие папки переносятся в него один раз: всё содержимое перемещается
 * (файлы не копируются и не теряются), пустая старая папка получает пометку «перенесено». Без дерева — прежнее поведение.
 */
function _tsTreeReady_() { try { return typeof _ts2Folder_ === 'function' && !!_book_().getSheetByName('DRIVE_REGISTRY'); } catch (e) { return false; } }
function _tsChild_(parent, name) { var it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
/** code — логическая папка дерева; sub — подпапка (необязательно); legacy — прежние названия папок в корне Диска. */
function _tsTreeFolder_(code, sub, legacy) {
  legacy = legacy || [];
  if (!_tsTreeReady_()) return typeof _tsBrandFolder_ === 'function' ? _tsBrandFolder_(legacy[0], legacy[1]) : DriveApp.createFolder(legacy[0]);
  var target = _ts2Folder_(code); if (sub) target = _tsChild_(target, sub);
  var p = PropertiesService.getScriptProperties(), flag = 'TS_TREE_MOVED_' + code + (sub ? '_' + sub : '');
  if (p.getProperty(flag) !== '1') {
    var moved = 0;
    legacy.forEach(function (name) {
      if (!name) return;
      var it = DriveApp.getFoldersByName(name);
      while (it.hasNext()) {
        var old = it.next(); if (old.getId() === target.getId()) continue;
        var fs = old.getFolders(); while (fs.hasNext()) { fs.next().moveTo(target); moved++; }
        var fl = old.getFiles(); while (fl.hasNext()) { fl.next().moveTo(target); moved++; }
        try { old.setName(name + ' (перенесено в папку предприятия)'); } catch (e) {}
      }
    });
    p.setProperty(flag, '1');
    if (moved && typeof _ts2Audit_ === 'function') { try { _ts2Audit_('DRIVE_TREE_MOVE', 'DRIVE', code + (sub ? '/' + sub : ''), undefined, { moved: moved, from: legacy }, 'папки MonChef перенесены в дерево предприятия'); } catch (e) {} }
  }
  return target;
}
