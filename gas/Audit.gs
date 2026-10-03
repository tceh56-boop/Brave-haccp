// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Audit.gs
 * История изменений (ТЗ §23). Отдельно от SYSTEM_ERRORS (Utils.gs::logSystemError_) —
 * AUDIT_LOG это ЧТО сделал пользователь, SYSTEM_ERRORS это ЧТО сломалось в системе.
 */

/**
 * v2: добавлен необязательный cascade_id (ТЗ §20/§48) — общий идентификатор одной
 * бизнес-операции (например, "смена цены продукта"), который проставляется во ВСЕ записи
 * аудита/склада/списаний, порождённые ЭТОЙ операцией и её каскадом пересчёта. Позволяет
 * найти "всё, что изменилось из-за одного действия" одним фильтром по cascade_id, а не
 * реконструировать цепочку по времени. Параметр необязателен — старые вызовы без него
 * продолжают работать (просто без сквозной трассировки).
 */
function _audit35Hash_(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''));
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function _audit35Canonical_(row) {
  return [row.log_id,row.user_id,row.действие,row.объект,row.старое_значение,row.новое_значение,row.дата,row.результат,row.cascade_id].map(function(v){return v===undefined||v===null?'':String(v);}).join('\u001f');
}

function auditLog_(userId, action, object, oldValue, newValue, result, cascadeId) {
  var row = {
    log_id: generateId_('AUDIT_LOG'),
    user_id: userId || '',
    действие: action,
    объект: object,
    старое_значение: (oldValue === null || oldValue === undefined) ? '' : String(oldValue),
    новое_значение: (newValue === null || newValue === undefined) ? '' : String(newValue),
    дата: nowIso_(),
    результат: result || 'success',
    cascade_id: cascadeId || ''
  };
  // Stage 35: журнал остаётся первичным человекочитаемым аудитом, а доказательство
  // неизменности пишется в отдельный append-only vault. Lock не даёт двум запросам
  // одновременно получить один и тот же previous_hash.
  if (typeof withLock_ === 'function') {
    return withLock_(function(){
      insertRow_('AUDIT_LOG', row);
      if (typeof appendAuditEvidence35_ === 'function') appendAuditEvidence35_(row);
      return row;
    });
  }
  insertRow_('AUDIT_LOG', row);
  if (typeof appendAuditEvidence35_ === 'function') appendAuditEvidence35_(row);
  return row;
}

/** Новый cascade_id для одной бизнес-операции — вызывается один раз в начале обработчика в API.gs. */
function newCascadeId_() {
  return 'CSC-' + Utilities.getUuid();
}

function getAuditByCascade_(cascadeId) {
  return findRows_('AUDIT_LOG', function (r) { return r.cascade_id === cascadeId; });
}

function getAuditLog_(objectFilter, limit) {
  var rows = findRows_('AUDIT_LOG', function (r) {
    return !objectFilter || String(r.объект).indexOf(objectFilter) === 0;
  });
  rows.sort(function (a, b) { return new Date(b.дата) - new Date(a.дата); });
  return limit ? rows.slice(0, limit) : rows;
}
