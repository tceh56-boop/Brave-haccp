/**
 * MON CHEF — работа без интернета.
 *
 * Интерфейс (App.html, Console.html) складывает записи, сделанные без связи,
 * в очередь на устройстве и отправляет их сюда, когда связь появилась.
 * Сервер выполняет ту же функцию, что и при обычной записи, но время события
 * берёт с устройства (когда запись реально сделали), а не время отправки.
 *
 * Принимаются только функции из списка MC_OFFLINE_FNS_. Время с устройства
 * проверяется: не в будущем и не старше MC_OFFLINE_MAX_DAYS_ дней. Оба времени —
 * записи и отправки — пишутся в журнал системы, чтобы при проверке было видно,
 * какие записи пришли из офлайна.
 */
// Бракераж (решение о выпуске) и медкнижки (допуск к работе) без связи не принимаются:
// решение должно быть подтверждено сервером сразу (ТЗ, раздел 38).
var MC_OFFLINE_FNS_ = ['addJournalEntry', 'answerJournalCheck', 'addSaleEntry',
  'addBactericidalLampReading', 'saveChecklistExecution', 'updateKanbanTask'];
var MC_OFFLINE_MAX_DAYS_ = 14;
var _MC_CLIENT_NOW = null;

// «Сейчас» для записи события: время с устройства при отправке из очереди, иначе текущее
function _mcNow_() { return _MC_CLIENT_NOW ? new Date(_MC_CLIENT_NOW.getTime()) : new Date(); }

var MC_OFFLINE_SHEET_ = 'Офлайн_Синхронизация';
var MC_OFFLINE_HEAD_ = ['ItemID', 'Функция', 'Пользователь', 'Роль', 'Время на устройстве (OriginalClientTimestamp)',
  'Время приёма сервером (SyncTimestamp)', 'Итог', 'Ответ сервера', 'OperationID'];

function _mcOfflineSheet_() {
  var ss = _book_(), sh = ss.getSheetByName(MC_OFFLINE_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(MC_OFFLINE_SHEET_);
    sh.getRange(1, 1, 1, MC_OFFLINE_HEAD_.length).setValues([MC_OFFLINE_HEAD_]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function _mcOfflineFind_(sh, itemId) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === itemId) return sh.getRange(i + 2, 1, 1, MC_OFFLINE_HEAD_.length).getValues()[0];
  return null;
}

/**
 * Отправка записи из офлайн-очереди. Пока запись не принята здесь, она НЕ является
 * фактом контроля: интерфейс показывает её как «ждёт отправки».
 * itemId — номер записи очереди на устройстве: повторная отправка того же номера
 * (обрыв связи после записи, второе устройство) не выполняется второй раз —
 * возвращается прежний итог с признаком duplicate.
 * Каждая принятая или отклонённая запись попадает в лист «Офлайн_Синхронизация»:
 * кто, что, время на устройстве и время отправки.
 */
function mcReplayOffline(fn, argsJson, clientIso, itemId) {
  if (MC_OFFLINE_FNS_.indexOf(String(fn)) < 0) return JSON.stringify({ success: false, error: { code: 'NOT_ALLOWED', message: 'Функция не принимается из офлайн-очереди: ' + fn } });
  var args;
  try { args = JSON.parse(argsJson || '[]'); if (!Array.isArray(args)) throw new Error('args'); }
  catch (e) { return JSON.stringify({ success: false, error: { code: 'VALIDATION', message: 'Повреждённая запись очереди' } }); }
  var now = new Date(), t = new Date(clientIso), id = String(itemId || '').slice(0, 80);
  if (isNaN(t.getTime()) || t.getTime() > now.getTime() + 10 * 60000) t = now;   // часы устройства спешат — берём серверное
  if (now.getTime() - t.getTime() > MC_OFFLINE_MAX_DAYS_ * 86400000) {
    return JSON.stringify({ success: false, error: { code: 'TOO_OLD', message: 'Запись сделана больше ' + MC_OFFLINE_MAX_DAYS_ + ' дней назад — внесите её вручную' } });
  }
  var f = (typeof MC_GLOBAL_ !== 'undefined' ? MC_GLOBAL_ : this)[fn];
  if (typeof f !== 'function') return JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: fn } });
  var sess = (typeof mcGateSession_ === 'function' && mcGateSession_()) || null;
  var who = sess ? (sess.name || sess.fullName || sess.user_id || '') : '', role = sess ? (sess.role || '') : '';
  var tz = _mcTz_(), fmt = function (d) { return Utilities.formatDate(d, tz, 'dd.MM.yyyy HH:mm:ss'); };
  return _withLock_(function () {
    var sh = null;
    try { sh = _mcOfflineSheet_(); } catch (e) {}
    if (sh && id) {
      var prev = _mcOfflineFind_(sh, id);
      if (prev && String(prev[6]) === 'ПРИНЯТО') return JSON.stringify({ success: true, ok: true, duplicate: true, itemId: id,
        message: 'Запись уже была принята ' + prev[5] + ' — повторно не выполняется' });
    }
    _MC_CLIENT_NOW = t;
    try { _MC_LAST_OP_ID = ''; } catch (e) {}
    var res, err = '';
    try { res = f.apply(null, args); }
    catch (e) { err = String(e && e.message || e); }
    finally { _MC_CLIENT_NOW = null; }
    var s = err || (typeof res === 'string' ? res : (function () { try { return JSON.stringify(res); } catch (e) { return ''; } })());
    var failed = !!err || /"(success|ok)"\s*:\s*false|^err/i.test(String(s || '').slice(0, 300));
    var opm = /"(?:operation_id|operationId)"\s*:\s*"([^"]+)"/.exec(String(s || ''));
    var opId = opm ? opm[1] : (typeof _MC_LAST_OP_ID !== 'undefined' ? _MC_LAST_OP_ID : '');
    try { if (sh) sh.appendRow([id || '—', fn, who, role, fmt(t), fmt(now), failed ? 'ОТКЛОНЕНО' : 'ПРИНЯТО', String(s || '').slice(0, 1000), opId]); } catch (e) {}
    try { _log_('INFO', 'офлайн-запись ' + fn + ' [' + id + ']: сделана ' + fmt(t) + ', отправлена ' + fmt(now) + (failed ? ', отклонена' : '')); } catch (e) {}
    if (err) throw new Error(err);
    return res;
  });
}
