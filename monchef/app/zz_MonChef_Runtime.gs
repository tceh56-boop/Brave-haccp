/**
 * MON CHEF — общие правки времени выполнения. Файл должен идти ПОСЛЕДНИМ
 * в проекте: он оборачивает функции, объявленные в остальных файлах.
 *
 * 1. Функции setup* создают листы и заголовки. Модули вызывают их в начале
 *    почти каждой операции, и цепочка setupV45 → V44 → V43 → чек-листы → V42 → V41
 *    за один показ экрана выполнялась десятки раз (тысячи обращений к таблице,
 *    риск упереться в 6-минутный лимит Google). Теперь каждая setup-функция без
 *    аргументов выполняется один раз за запуск скрипта, повторные вызовы
 *    возвращают тот же результат.
 *
 *    Кроме того, каждый показ экрана — отдельный запуск, и цепочка всё равно
 *    повторялась при каждом открытии раздела. Для автоматических setup-функций
 *    (MC_SETUP_PERSIST_) факт выполнения запоминается в кэше скрипта на 6 часов.
 *    Ключ включает отпечаток текста самих setup-функций: после обновления кода
 *    они выполнятся заново. Ручные (setupJournals, setupAuth,
 *    setupProductionReleaseStack и т.п.) и возвращающие лист не запоминаются.
 */
var MC_SETUP_PERSIST_ = /^setup(V4[1-9]|V5[0-4]|Checklists|DisinfectantsCatalog)[A-Za-z]*$/;
(function (g) {
  var names = Object.keys(g).filter(function (n) { return /^setup/.test(n) && typeof g[n] === 'function' && !g[n].__mcOnce; }).sort();
  // отпечаток кода setup-функций (быстрый хеш без обращений к сервисам Google)
  var h = 5381, src = names.map(function (n) { return n + g[n].toString(); }).join('|');
  for (var i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0;
  var KEY = 'mc_setup_' + (h >>> 0).toString(36), mem = null;
  var cache = function () { try { return CacheService.getScriptCache(); } catch (e) { return null; } };
  var doneMap = function () {
    if (mem) return mem;
    try { var c = cache(), raw = c && c.get(KEY); mem = raw ? JSON.parse(raw) : {}; } catch (e) { mem = {}; }
    return mem;
  };
  var remember = function (name, result) {
    if (result && typeof result === 'object' && (typeof result.getRange === 'function' || typeof result.getSheetByName === 'function')) return;
    var v; try { v = JSON.stringify(result === undefined ? null : result); } catch (e) { return; }
    if (!v || v.length > 3000) v = 'null';
    var m = doneMap(); m[name] = v;
    try { var c = cache(); if (c) c.put(KEY, JSON.stringify(m), 21600); } catch (e) {}
  };
  names.forEach(function (name) {
    var original = g[name], done = false, result, persist = MC_SETUP_PERSIST_.test(name);
    var wrapped = function () {
      if (arguments.length) return original.apply(this, arguments);
      if (done) return result;
      if (persist) {
        var m = doneMap();
        if (Object.prototype.hasOwnProperty.call(m, name)) { done = true; try { result = JSON.parse(m[name]); } catch (e) { result = null; } return result; }
      }
      result = original.apply(this, arguments); done = true;
      if (persist) remember(name, result);
      return result;
    };
    wrapped.__mcOnce = true;
    wrapped.toString = function () { return original.toString(); };   // параметры видны _mcTokenArgMap_
    g[name] = wrapped;
  });
})(this);

/**
 * 2. Очистка дублей пунктов чек-листов. Прежняя версия setupChecklists проверяла
 *    не ту колонку и при каждом вызове дописывала все пункты заново. Функция
 *    оставляет первый пункт для каждой пары «чек-лист + №» и удаляет повторы.
 *    Запускать вручную, сначала на копии таблицы. Возвращает, сколько удалено.
 */
function dedupeChecklistItems() {
  var sh = _clItemsSheet_();
  var v = sh.getDataRange().getValues();
  var seen = {}, keep = [v[0]], removed = [];
  for (var i = 1; i < v.length; i++) {
    var key = String(v[i][1]) + '#' + String(v[i][2]);
    if (seen[key]) { removed.push(String(v[i][0])); continue; }
    seen[key] = true;
    keep.push(v[i]);
  }
  if (removed.length) {
    sh.getRange(2, 1, v.length - 1, v[0].length).clearContent();
    if (keep.length > 1) sh.getRange(2, 1, keep.length - 1, v[0].length).setValues(keep.slice(1));
  }
  var res = { ok: true, before: v.length - 1, after: keep.length - 1, removed: removed.length };
  Logger.log(JSON.stringify(res));
  return res;
}

/**
 * 3. Адрес веб-приложения — для меню «Модули» в главном экране.
 */
function getAppUrl() {
  return ScriptApp.getService().getUrl();
}
