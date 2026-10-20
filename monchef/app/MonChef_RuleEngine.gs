/**
 * MON CHEF — движок правил (ТЗ §20–§22, §46). Функции с именами из ТЗ поверх рабочего ядра:
 * факт → правила (V5 _mcEvaluateFactRulesV5_) → отклонение + корректирующее действие →
 * блокировка конкретного объекта (§21: не всей системы) → уведомление ответственного.
 *
 *   evaluateFact(fact)                 — проверка факта по правилам; при отклонении — цепочка §20
 *   evaluateCCP(controlId, value)      — значение против критического предела ККТ, БЕЗ записи
 *   createDeviationFromFact(fact)      — отклонение и КД по факту (ручной вызов ответственного)
 *   createCorrectiveAction(json)       — корректирующее действие по отклонению (recordCorrectiveAction)
 *   blockObject(type, id, reason)      — блокировка объекта (партия, оборудование, ...): HACCP
 *   unblockObject(blockId, reason)     — снятие блокировки с причиной
 *   notifyResponsible(json)            — уведомление ответственной роли
 * Права проверяются здесь же на сервере (§70) — скрытая кнопка защитой не считается.
 */
function _mcHaccpSession_(token) {
  var s = _requireAuth_(token);
  var p = s.permissions || {};
  if (!_mcRbHas_(s, 'haccp|prod_manage')) throw new Error('FORBIDDEN: 403 — нужно право «ХАССП»');
  return s;
}

function evaluateFact(fact, token) { return evaluateFactRulesV5(fact, token); }

/** Предварительная оценка замера ККТ: в пределе или нет. Ничего не записывает. */
function evaluateCCP(controlId, value, token) {
  try {
    _requireAuth_(token);
    var c = null; try { c = _tccpActiveControls_()[String(controlId)] || null; } catch (e) {}
    if (!c) return coreErr('CCP_NOT_FOUND', 'Контрольная точка не найдена или не действует');
    var n = parseFloat(String(value).replace(',', '.'));
    if (!isFinite(n)) return coreErr('VALIDATION', 'Нужно измеренное значение числом');
    var lo = c.min === '' || c.min == null ? null : parseFloat(c.min), hi = c.max === '' || c.max == null ? null : parseFloat(c.max);
    var ok = (lo === null || isNaN(lo) || n >= lo) && (hi === null || isNaN(hi) || n <= hi);
    return coreOk({ controlId: c.id, point: c.point, limit: c.limit || '', min: lo, max: hi, unit: c.unit || '', value: n, result: ok ? 'OK' : 'DEVIATION',
      note: ok ? 'В пределе' : 'Вне критического предела: при записи будет создано отклонение и потребуется корректирующее действие' });
  } catch (e) { return coreErr('CCP_EVALUATE_ERROR', String(e)); }
}

function createDeviationFromFact(fact, token) {
  try {
    var s = _mcHaccpSession_(token), f = typeof fact === 'string' ? JSON.parse(fact || '{}') : (fact || {});
    if (!f.description && !f.fact) return coreErr('VALIDATION', 'Опишите отклонение (что обнаружено)');
    var ids = _mcOpenDeviationAndAction_(f, s, f.ruleId || 'MANUAL', f.description || f.fact, f.critical === true ? 'CRITICAL' : 'NORMAL');
    try { _audit_({ session: s, tenant: _defaultTenant_(), id: ids.deviationId, type: 'CREATE_DEVIATION' }, 'CREATE_DEVIATION', 'HACCP', ids.deviationId, null, { fact: f.factId || '', blockId: ids.blockId || '' }); } catch (e) {}
    try { notifyResponsible({ title: 'Отклонение: ' + (f.objectId || f.batchId || ''), text: f.description || f.fact, role: f.responsibleRole || 'Шеф-повар', severity: f.critical ? 'critical' : 'warning', key: 'dev|' + ids.deviationId }, token, true); } catch (e) {}
    return coreOk(ids);
  } catch (e) { return coreErr('DEVIATION_CREATE_ERROR', String(e)); }
}

function createCorrectiveAction(json, token) { return recordCorrectiveAction(json, token); }

function blockObject(objectType, objectId, reason, token) {
  try {
    var s = _mcHaccpSession_(token);
    if (!objectType || !objectId) return coreErr('VALIDATION', 'Укажите объект блокировки');
    if (!String(reason || '').trim()) return coreErr('VALIDATION', 'Укажите причину блокировки');
    var id = _mcBlockObject_(String(objectType).toUpperCase(), String(objectId), String(reason), { actor: _mcSessionFullName_(s) });
    try { _audit_({ session: s, tenant: _defaultTenant_(), id: id, type: 'BLOCK_OBJECT' }, 'BLOCK_OBJECT', String(objectType), String(objectId), null, { reason: reason, blockId: id }); } catch (e) {}
    return coreOk({ blockId: id, objectType: String(objectType).toUpperCase(), objectId: String(objectId), note: 'Заблокирован только этот объект; остальная работа продолжается (ТЗ §21)' });
  } catch (e) { return coreErr('BLOCK_ERROR', String(e)); }
}

function unblockObject(blockId, reason, token) {
  if (!String(reason || '').trim()) return coreErr('VALIDATION', 'Укажите основание снятия блокировки');
  var r = releaseObjectBlock(blockId, reason, token);
  try { var j = JSON.parse(r); if (j.success) _audit_({ session: _getSession_(token), tenant: _defaultTenant_(), id: blockId, type: 'UNBLOCK_OBJECT' }, 'UNBLOCK_OBJECT', 'Блокировка', blockId, 'ACTIVE', { reason: reason }); } catch (e) {}
  return r;
}

/** Уведомление ответственной роли. internal=true — вызов из кода сервера (уже под правами вызвавшего). */
function notifyResponsible(json, token, internal) {
  try {
    if (internal !== true) _mcHaccpSession_(token);
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    if (!d.title) return coreErr('VALIDATION', 'Нужен заголовок уведомления');
    var id = _notify_(d.type || 'responsible', d.severity || 'warning', String(d.title), String(d.text || ''), d.role || 'Шеф-повар', d.key || ('notify|' + Date.now()), null);
    return coreOk({ notificationId: id || '', role: d.role || 'Шеф-повар' });
  } catch (e) { return coreErr('NOTIFY_ERROR', String(e)); }
}
