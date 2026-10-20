/* ==========================================================================
   MON CHEF — замер времени обращений на НАСТОЯЩЕЙ таблице (нагрузочный сценарий).
   Собственность Слепцова Дениса Владимировича.

   Модель очереди (ana/load_model.js) считает время по допущениям: чтение и запись листа 0,1–0,5 с.
   Эта функция меряет их на вашей копии, чтобы модель считала по вашим цифрам.

   Как запустить: редактор Apps Script → функция mcLoadCalibrate → «Выполнить» → «Журнал выполнения».
   Скопируйте строку «ЗАМЕР:» из журнала и пришлите разработчику (или сохраните как calib.json рядом с моделью).
   Лучше запускать вне смены: замер берёт общую блокировку на доли секунды.

   Что делает:
     • читает рабочие листы (ничего в них не меняет);
     • пишет 20 строк во временный лист «_замер_нагрузки» и удаляет его в конце (даже при ошибке);
     • берёт и отпускает общую блокировку; читает служебное свойство и кэш.
   Журналы, склад, банкеты, сотрудники не меняются; записей в журналах ХАССП не появляется.
   ========================================================================== */
function mcLoadCalibrate() {
  var ms = function (f) { var a = Date.now(); f(); return Date.now() - a; };
  var med = function (a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[Math.floor(s.length / 2)] : null; };
  var ss = _book_(), out = { at: new Date().toISOString(), единицы: 'мс', чтение: {}, запись: {}, прочее: {} };
  // чтение рабочих листов: первое чтение (без кэша выполнения) и повтор
  ['Склад_Партии', 'Склад_Операции', 'Склад_Остатки', 'Склад_Резервы', 'Состав', 'Audit_Log', 'Операции', 'Банкеты', 'Канбан_Задачи', 'TRACE_LINKS', 'Факты', 'Журналы_Ожидания', 'Ж_Чеклист_Открытие'].forEach(function (n) {
    var sh = ss.getSheetByName(n); if (!sh) return;
    var first = ms(function () { sh.getDataRange().getValues(); }), again = ms(function () { sh.getDataRange().getValues(); });
    out.чтение[n] = { строк: sh.getLastRow(), первое: first, повтор: again };
  });
  // запись во временный лист
  var tmp = null, NAME = '_замер_нагрузки';
  try {
    var old = ss.getSheetByName(NAME); if (old) ss.deleteSheet(old);
    tmp = ss.insertSheet(NAME);
    var row = [new Date(), 'замер', 'MON CHEF', 1, 2, 3, 'текст для ширины строки', '', '', ''];
    var each = [];
    for (var i = 0; i < 10; i++) each.push(ms(function () { tmp.appendRow(row); SpreadsheetApp.flush(); }));
    var buf = ms(function () { for (var j = 0; j < 10; j++) tmp.appendRow(row); SpreadsheetApp.flush(); });
    var upd = []; for (var k = 0; k < 5; k++) upd.push(ms(function () { tmp.getRange(2 + k, 4).setValue(k); SpreadsheetApp.flush(); }));
    var del = []; for (var d = 0; d < 5; d++) del.push(ms(function () { tmp.deleteRow(2); SpreadsheetApp.flush(); }));
    out.запись = { строка_сразу: med(each), строка_пачкой_10_всего: buf, строка_пачкой_10_на_строку: Math.round(buf / 10), правка_ячейки: med(upd), удаление_строки: med(del) };
  } catch (e) { out.запись = { ошибка: String(e) }; }
  finally { try { if (tmp) ss.deleteSheet(tmp); } catch (e2) { out.запись.удалить_лист_вручную = NAME; } }
  // общая блокировка, свойства, кэш
  try { var lk = []; for (var q = 0; q < 3; q++) lk.push(ms(function () { var l = LockService.getScriptLock(); l.waitLock(30000); l.releaseLock(); })); out.прочее.блокировка = med(lk); } catch (e3) { out.прочее.блокировка = 'занята: ' + e3; }
  var pr = []; for (var p = 0; p < 5; p++) pr.push(ms(function () { PropertiesService.getScriptProperties().getProperty('SHIFT_START'); })); out.прочее.свойство = med(pr);
  var ch = []; for (var c = 0; c < 5; c++) ch.push(ms(function () { CacheService.getScriptCache().get('mc_calib_probe'); })); out.прочее.кэш = med(ch);
  // для модели: секунды на одно обращение
  var reads = Object.keys(out.чтение).map(function (n) { return out.чтение[n].первое; });
  out.модель = { r: (med(reads) || 0) / 1000, w: (out.запись.строка_сразу || 0) / 1000, wbuf: (out.запись.строка_пачкой_10_на_строку || 0) / 1000,
                 p: (out.прочее.свойство || 0) / 1000, c: (out.прочее.кэш || 0) / 1000, lk: (typeof out.прочее.блокировка === 'number' ? out.прочее.блокировка : 0) / 1000 };
  Logger.log('ЗАМЕР: ' + JSON.stringify(out));
  return out;
}
