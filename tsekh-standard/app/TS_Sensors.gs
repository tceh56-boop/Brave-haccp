/**
 * ЦЕХ Стандарт 2.1 — датчики температуры и влажности.
 *   Подключение: «Настройка и готовность → Оборудование → Датчик» — система выдаёт адрес и ключ устройства (один раз;
 *   в таблице хранится только SHA-256 ключа). Устройство или шлюз (Home Assistant, ESP, облако датчика) отправляет
 *   POST <адрес системы> с телом {"device": "SNS-000001", "token": "<ключ>", "value": 4.2, "humidity": 61}.
 *   Показание записывается как замер (источник «датчик»): журнал температур, автозапись, закрытие задачи замера.
 *   Чтобы не переполнять таблицу, в журнал попадает не чаще одного показания в 15 минут, а также каждое отклонение.
 *   Отклонение — уведомление ответственному (не чаще раза в час по объекту). Число без датчика система не придумывает:
 *   если датчик молчит, задача замера остаётся повару.
 */
var TS_SNS_STORE_MIN_ = 15, TS_SNS_RATE_PER_MIN_ = 30, TS_SNS_EXC_SEC_ = 3600;

function _tsSnsHash_(token) { return _ts2Sha_('TSSNS|' + String(token || '')); }
function _tsSnsJson_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function _tsSnsEq_(a, b) { a = String(a || ''); b = String(b || ''); if (a.length !== b.length) return false; var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

/** Приём показания. Ответ без подробностей при неверном ключе (не помогает подбору). */
function _tsSnsReceive_(body) {
  var d = body || {}, dev = _ts2Find_('SENSOR_DEVICES', 'deviceId', String(d.device || ''));
  if (!dev || dev.status !== 'ACTIVE' || !_tsSnsEq_(_tsSnsHash_(d.token), dev.tokenHash)) return { ok: false, error: 'устройство не принято' };
  var cache = CacheService.getScriptCache(), rk = 'sns_rate_' + dev.deviceId + '_' + Math.floor(Date.now() / 60000), n = Number(cache.get(rk) || 0);
  if (n >= TS_SNS_RATE_PER_MIN_) return { ok: false, error: 'слишком часто' };
  cache.put(rk, String(n + 1), 120);
  var v = _ts2Num_(d.value), h = d.humidity === undefined || d.humidity === '' ? null : _ts2Num_(d.humidity);
  if (v === null || v < -60 || v > 350) return { ok: false, error: 'значение вне физически возможного диапазона' };
  if (h !== null && (h < 0 || h > 100)) h = null;
  var o = _ts2Find_('MEASUREMENT_OBJECTS', 'objectId', dev.objectId);
  if (!o || o.status !== 'ACTIVE') return { ok: false, error: 'объект замера выведен из работы' };
  var min = o.minValue === '' ? null : Number(o.minValue), max = o.maxValue === '' ? null : Number(o.maxValue);
  var res = (min !== null && v < min) || (max !== null && v > max) ? 'FAIL' : (min === null && max === null ? 'REVIEW' : 'PASS');
  return _withLock_(function () {
    var now = new Date(), last = dev.lastStoredAt ? new Date(dev.lastStoredAt) : null;
    var store = !last || isNaN(last) || now - last >= TS_SNS_STORE_MIN_ * 60000 || res === 'FAIL' || dev.lastResult === 'FAIL';
    var patch = { lastSeenAt: _ts2Iso_(now), lastValue: v, lastResult: res };
    var out = { ok: true, result: res, stored: store };
    if (store) {
      patch.lastStoredAt = _ts2Iso_(now);
      var who = 'Датчик «' + dev.name + '»', unit = '°C', mId = _ts2Id_('MANUAL_MEASUREMENTS');
      _ts2Insert_('MANUAL_MEASUREMENTS', { measurementId: mId, enterpriseId: _ts2Ent_(), measurementType: (TS2_MEASURE_TYPES_[o.objectType] || TS2_MEASURE_TYPES_.OTHER)[0], objectType: o.objectType, objectId: o.objectId,
        value: v, unit: unit, minValue: o.minValue, maxValue: o.maxValue, result: res, employeeId: who, recordedAt: _ts2Iso_(now), source: 'SENSOR', comment: dev.deviceId, photoFileId: '', operationId: '' });
      var ar = _ts2AutoRecord_({ eventType: 'MEASUREMENT', sourceType: 'SENSOR:' + dev.deviceId, sourceId: mId, recordType: 'HACCP_FACT', journalCode: o.objectType === 'ROOM' ? 'J-ROOM' : 'J-STORAGE-T', kktId: '', productionId: '', batchId: '',
        ttkId: '', result: res, measurementMode: 'SENSOR', value: v, unit: unit, confidence: 1, status: 'ACTIVE', idempotencyKey: [_ts2Ent_(), 'SNS', dev.deviceId, Utilities.formatDate(now, _mcTz_(), "yyyy-MM-dd'T'HH:mm")].join('|'),
        operationId: '', confirmedByEmployee: who, confirmedAt: _ts2Iso_(now), ruleVersion: 'SENSOR' });
      // прежний журнал температур: холодильники, морозильники, склад
      if (o.legacyObjectId && typeof _tRecord_ === 'function' && typeof _tObjects_ === 'function') {
        try { var lo = _tObjects_().filter(function (x) { return x.id === String(o.legacyObjectId); })[0];
          if (lo) _tRecord_({ type: lo.type, object: lo.name, objectId: lo.id, equipmentId: lo.equipmentId || '', min: lo.min, max: lo.max, value: v, unit: lo.unit || unit, source: 'датчик ' + dev.deviceId }, { name: who }, ''); } catch (e) {}
      }
      out.closed = _tsSnsCloseTasks_(o, o.objectType === 'ROOM' ? 'ROOM' : o.objectType, now, v, res, ar.autoRecordId, who);
      if (h !== null && o.objectType === 'ROOM') {
        var hr = _ts2Id_('MANUAL_MEASUREMENTS');
        _ts2Insert_('MANUAL_MEASUREMENTS', { measurementId: hr, enterpriseId: _ts2Ent_(), measurementType: 'ROOM_HUMIDITY', objectType: 'ROOM_HUMIDITY', objectId: o.objectId, value: h, unit: '%', minValue: '', maxValue: '',
          result: 'REVIEW', employeeId: who, recordedAt: _ts2Iso_(now), source: 'SENSOR', comment: dev.deviceId, photoFileId: '', operationId: '' });
        out.closedHumidity = _tsSnsCloseTasks_(o, 'ROOM_HUMIDITY', now, h, 'REVIEW', hr, who);
      }
      if (res === 'FAIL') {
        var ek = 'sns_exc_' + o.objectId;
        if (!cache.get(ek)) { cache.put(ek, '1', TS_SNS_EXC_SEC_); _ts2Exception_('TEMP_OUT', 'Датчик: ' + o.name + ' — ' + v + ' °C (норма ' + (min === null ? '…' : min) + '…' + (max === null ? '…' : max) + ')', o.objectId); }
      }
    }
    _ts2Update_('SENSOR_DEVICES', 'deviceId', dev.deviceId, patch);
    return out;
  });
}
/** Закрыть открытые задачи замера по объекту в окне −2 ч … +30 мин от времени показания. */
function _tsSnsCloseTasks_(o, kind, now, v, res, factId, who) {
  var from = _ts2Iso_(new Date(now.getTime() - 2 * 3600000)), to = _ts2Iso_(new Date(now.getTime() + 30 * 60000)), n = 0;
  _ts2FindAll_('JOURNAL_EXPECTATIONS', 'status', 'OPEN', function (e) { return e.objectId === o.objectId && (kind === 'ROOM_HUMIDITY' ? e.objectType === 'ROOM_HUMIDITY' : e.objectType !== 'ROOM_HUMIDITY') && String(e.dueAt) >= from && String(e.dueAt) <= to; })
    .forEach(function (e) { _ts2Update_('JOURNAL_EXPECTATIONS', 'expectationId', e.expectationId, { status: res === 'FAIL' ? 'FAILED' : 'DONE', completedAt: _ts2Iso_(now), completedBy: who, factId: factId }); n++; });
  return n;
}

/** Вход для датчиков (POST). Остальные POST-запросы к системе не принимаются. */
function doPost(e) {
  try {
    var body = {}; try { body = JSON.parse(e && e.postData && e.postData.contents || '{}'); } catch (x) { return _tsSnsJson_({ ok: false, error: 'тело запроса — JSON' }); }
    if (!body.device) return _tsSnsJson_({ ok: false, error: 'unknown request' });
    if (typeof _ts2Prof_ !== 'function' || !_ts2Prof_('mode', '')) return _tsSnsJson_({ ok: false, error: 'режим «Готов к работе» не включён' });
    return _tsSnsJson_(_tsSnsReceive_(body));
  } catch (err) {
    try { if (typeof _tsTechEvent_ === 'function') _tsTechEvent_('SENSOR', 'doPost', err && err.message || err); } catch (x) {}
    return _tsSnsJson_({ ok: false, error: 'internal error' });
  }
}

/* ------------------------------------------------------------------ интерфейс */
function ts2Sensors(token) {
  try {
    _requireAuth_(token); _ts2EnsureSchema_(false);
    var url = ''; try { url = ScriptApp.getService().getUrl(); } catch (e) {}
    var objs = {}; _ts2Rows_('MEASUREMENT_OBJECTS').forEach(function (o) { objs[o.objectId] = o.name; });
    return _ok_({ url: url, devices: _ts2Rows_('SENSOR_DEVICES').map(function (d) { var age = d.lastSeenAt ? (Date.now() - new Date(d.lastSeenAt).getTime()) / 60000 : null;
      return { deviceId: d.deviceId, name: d.name, object: objs[d.objectId] || d.objectId, objectId: d.objectId, status: d.status, lastSeenAt: d.lastSeenAt, lastValue: d.lastValue, lastResult: d.lastResult, silentMin: age === null ? null : Math.round(age) }; }) });
  } catch (e) { return _failFrom_(e); }
}
/** Подключить датчик к объекту. Ключ показывается один раз. */
function ts2SensorRegister(token, objectId, name) {
  try {
    _requireAuth_(token, 'org_edit');
    var o = _ts2Find_('MEASUREMENT_OBJECTS', 'objectId', objectId); if (!o || o.status !== 'ACTIVE') return _fail_('NOT_FOUND', 'Объект замера не найден');
    if (['FRIDGE', 'FREEZER', 'ROOM'].indexOf(o.objectType) < 0) return _fail_('VALIDATION', 'Датчик подключается к холодильнику, морозильнику или помещению');
    if (o.minValue === '' && o.maxValue === '') return _fail_('VALIDATION', 'Сначала укажите допустимый диапазон объекта');
    var key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 16), id = _ts2Id_('SENSOR_DEVICES');
    _ts2Insert_('SENSOR_DEVICES', { deviceId: id, enterpriseId: _ts2Ent_(), objectId: objectId, name: String(name || o.name).slice(0, 80), tokenHash: _tsSnsHash_(key), status: 'ACTIVE', createdAt: _ts2Iso_(), createdBy: _ts2Actor_().name,
      lastSeenAt: '', lastValue: '', lastResult: '', lastStoredAt: '', revokedAt: '' });
    _ts2Audit_('SENSOR_REGISTER', 'SENSOR', id, undefined, { objectId: objectId }, '');
    var url = ''; try { url = ScriptApp.getService().getUrl(); } catch (e) {}
    return _ok_({ deviceId: id, token: key, url: url, example: { device: id, token: key, value: 4.2 } });
  } catch (e) { return _failFrom_(e); }
}
function ts2SensorRevoke(token, deviceId) {
  try {
    _requireAuth_(token, 'org_edit'); var d = _ts2Find_('SENSOR_DEVICES', 'deviceId', deviceId); if (!d) return _fail_('NOT_FOUND', 'Датчик не найден');
    _ts2Update_('SENSOR_DEVICES', 'deviceId', deviceId, { status: 'REVOKED', revokedAt: _ts2Iso_(), tokenHash: '' });
    _ts2Audit_('SENSOR_REVOKE', 'SENSOR', deviceId, { status: d.status }, { status: 'REVOKED' }, '');
    return _ok_({ deviceId: deviceId });
  } catch (e) { return _failFrom_(e); }
}
