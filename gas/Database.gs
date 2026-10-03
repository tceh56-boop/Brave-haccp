// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Database.gs
 * Единый generic-движок поверх Google Sheets (паттерн Database.gs из Brave Admin).
 * Ни один модуль ЦЕХ не должен звать SpreadsheetApp напрямую в обход этого файла —
 * это и есть "правило единого источника" (ТЗ §29) на уровне доступа к данным.
 *
 * Правила производительности (ТЗ §25), встроенные сюда с самого начала:
 * - batch getValues()/setValues(), никогда чтение по одной ячейке/строке
 * - CacheService для чтения справочников
 * - PropertiesService для настроек (см. Config.gs::getDatabase_)
 * - LockService на любую операцию записи
 */

var _sheetCache_ = {}; // sheet object cache в пределах одного вызова (не путать с CacheService)

/** Низкоуровневый доступ к листу по логическому ключу CONFIG.SHEETS. */
function getSheet_(sheetKey) {
  var sheetName = CONFIG.SHEETS[sheetKey];
  if (!sheetName) throw new Error('Неизвестный лист: ' + sheetKey);
  if (_sheetCache_[sheetName]) return _sheetCache_[sheetName];

  var ss = getDatabase_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Лист "' + sheetName + '" не найден — запусти initializeDatabase().');
  _sheetCache_[sheetName] = sheet;
  return sheet;
}

/**
 * Читает весь лист одним batch-запросом и возвращает массив объектов по заголовкам.
 * Кэшируется в CacheService на CONFIG.CACHE_TTL_SECONDS — вызывай invalidateCache_(sheetKey)
 * сразу после любой записи в этот лист.
 */
function getAllRows_(sheetKey) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'rows_' + sheetKey;
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var sheet = getSheet_(sheetKey);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    // Пропускаем полностью пустые строки (частый мусор в Sheets)
    var isEmpty = row.every(function (cell) { return cell === '' || cell === null; });
    if (isEmpty) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c];
    }
    obj.__row = i + 1; // 1-based номер строки в листе, для точечного update/delete
    rows.push(obj);
  }

  cache.put(cacheKey, JSON.stringify(rows), CONFIG.CACHE_TTL_SECONDS);
  return rows;
}

function invalidateCache_(sheetKey) {
  CacheService.getScriptCache().remove('rows_' + sheetKey);
}

/** Находит строки по предикату. predicate(rowObj) -> boolean. Не читает лист повторно. */
function findRows_(sheetKey, predicate) {
  return getAllRows_(sheetKey).filter(predicate);
}

function findOne_(sheetKey, idField, idValue) {
  var rows = findRows_(sheetKey, function (r) { return r[idField] === idValue; });
  return rows.length ? rows[0] : null;
}

/**
 * Вставляет строку. obj — объект с ключами = заголовкам CONFIG.SCHEMA[sheetKey].
 * Недостающие поля пишутся пустой строкой (никогда undefined в Sheets-ячейке).
 * Оборачивается в LockService на вызывающей стороне (см. withLock_) для операций
 * из processOperation() — сам по себе insertRow_ лок не берёт, чтобы не блокировать
 * дважды при вызове из уже залоченного конвейера.
 */
function insertRow_(sheetKey, obj) {
  var sheet = getSheet_(sheetKey);
  var headers = CONFIG.SCHEMA[sheetKey];
  if (!headers) throw new Error('Нет схемы для ' + sheetKey + ' в CONFIG.SCHEMA.');

  var row = headers.map(function (h) {
    var v = obj[h];
    return (v === undefined || v === null) ? '' : v;
  });
  sheet.appendRow(row);
  invalidateCache_(sheetKey);
  return obj;
}

/** Точечное обновление строки по __row (полученному из getAllRows_/findOne_), только изменённые поля. */
function updateRow_(sheetKey, rowObj, patch) {
  if (!rowObj || !rowObj.__row) throw new Error('updateRow_: rowObj без __row — сначала найди строку через findOne_.');
  var sheet = getSheet_(sheetKey);
  var headers = CONFIG.SCHEMA[sheetKey];

  var current = sheet.getRange(rowObj.__row, 1, 1, headers.length).getValues()[0];
  var changed = false;
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    if (Object.prototype.hasOwnProperty.call(patch, h) && patch[h] !== current[i]) {
      current[i] = patch[h];
      changed = true;
    }
  }
  if (changed) {
    sheet.getRange(rowObj.__row, 1, 1, headers.length).setValues([current]);
    invalidateCache_(sheetKey);
  }
  return changed;
}

/**
 * Оборачивает функцию в LockService (ТЗ §19/P0.2 §18 — атомарность/защита от
 * одновременных операций). Использовать на каждую операцию, меняющую склад/партии/
 * инвентаризацию/производство/себестоимость/документы, а не на отдельные
 * insertRow_/updateRow_ по отдельности.
 *
 * P0.2 — ИСПРАВЛЕНА НАЙДЕННАЯ ПРИ АУДИТЕ ОШИБКА: withLock_ не был реентерабельным,
 * хотя уже существовали (и после этого раунда стало больше) цепочки вызовов, где
 * залоченная функция изнутри зовёт другую залоченную функцию в той же самой цепочке
 * вызовов — например createWriteOff_() → (внутри своего withLock_) → suggestPurchase_()
 * → createPurchaseRequest_() (тоже withLock_()). Без реентерабельности внутренний вызов
 * снимал бы общий скрипт-лок через releaseLock() ДО завершения внешней операции —
 * открывая окно, где вторая параллельная операция могла бы вклиниться в середину ещё не
 * завершённой первой. _lockDepth_ считает вложенность одного и того же вызова стека:
 * реальный лок берётся/освобождается только на глубине 0, вложенные withLock_ внутри
 * него просто выполняются без повторного захвата и без преждевременного releaseLock().
 */
var _lockDepth_ = 0;
function withLock_(fn) {
  if (_lockDepth_ > 0) {
    _lockDepth_++;
    try {
      return fn();
    } finally {
      _lockDepth_--;
    }
  }
  var lock = LockService.getScriptLock();
  var gotLock = lock.tryLock(10000); // 10 секунд ожидания
  if (!gotLock) {
    throw new Error('LOCK_TIMEOUT: Система занята другой операцией, повтори через несколько секунд.');
  }
  _lockDepth_++;
  try {
    return fn();
  } finally {
    _lockDepth_--;
    lock.releaseLock();
  }
}

/**
 * Создаёт (если отсутствуют) все листы схемы с заголовками из CONFIG.SCHEMA.
 * Запускать один раз вручную из редактора Apps Script после привязки SPREADSHEET_ID.
 * Идемпотентна: повторный запуск не трогает уже существующие листы с данными.
 */
function ensureSchemaColumns_(sheetKey) {
  var sheet = getSheet_(sheetKey);
  var headers = CONFIG.SCHEMA[sheetKey] || [];
  if (!headers.length) return [];
  var current = sheet.getDataRange().getValues()[0] || []; if (!current.length) current = [''];
  var missing = headers.filter(function(h){ return current.indexOf(h) === -1; });
  if (missing.length) {
    var start = current.length + 1;
    sheet.getRange(1,start,1,missing.length).setValues([missing]);
  }
  return missing;
}

function initializeDatabase() {
  var ss = getDatabase_();
  var created = [];
  var skipped = [];

  Object.keys(CONFIG.SHEETS).forEach(function (sheetKey) {
    var sheetName = CONFIG.SHEETS[sheetKey];
    var headers = CONFIG.SCHEMA[sheetKey];
    if (!headers) {
      Logger.log('Пропущен ' + sheetKey + ': нет записи в CONFIG.SCHEMA');
      return;
    }
    var sheet = ss.getSheetByName(sheetName);
    if (sheet) {
      skipped.push(sheetName);
      return;
    }
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    created.push(sheetName);
  });

  // Убираем технический "Sheet1", если он остался пустым от создания таблицы
  var defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('Лист1');
  if (defaultSheet && defaultSheet.getDataRange().getA1Notation() === 'A1' && defaultSheet.getRange('A1').getValue() === '') {
    ss.deleteSheet(defaultSheet);
  }

  var msg = 'Создано листов: ' + created.length + ' (' + created.join(', ') + ').\n' +
    'Уже существовало: ' + skipped.length + ' (' + skipped.join(', ') + ').';
  Logger.log(msg);
  return msg;
}
