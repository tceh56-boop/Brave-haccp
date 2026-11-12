/**
 * ЦЕХ Стандарт 2.1 — датчики температуры и влажности.
 *   Подключение: «Настройка и готовность → Оборудование → Датчик» — система выдаёт адрес и ключ устройства (один раз;
 *   в таблице хранится только SHA-256 ключа). Устройство или шлюз (Home Assistant, ESP, облако датчика) отправляет
 *   POST <адрес системы> с телом {"device": "SNS-000001", "token": "<ключ>", "value": 4.2, "humidity": 61}.
 *   Ввод у объекта замера выбирается: «ручной» или «автоматический (датчик)». Время замеров (checkTimes) одно для обоих:
 *   по нему создаются задачи. При ручном вводе задачу выполняет повар. При автоматическом — показание датчика, пришедшее
 *   от 10 минут до и до 30 минут после времени замера, записывается в журнал температур и закрывает задачу.
 *   В журнал также сразу попадает отклонение (повтор отклонения — не чаще раза в 15 минут) и возврат в норму — при любом вводе.
 *   Остальные показания только обновляют «последнее показание» датчика: таблица не растёт.
 *   Отклонение — уведомление ответственному (не чаще раза в час по объекту). Число без датчика система не придумывает:
 *   если датчик молчит, задача замера остаётся повару.
 * Датчик замолчал больше часа — одно уведомление ответственному (ts2SensorWatchSystem, каждые 15 минут) и проблема сверки R-020.
 * Сверка с поверенным термометром (ts2SensorCalibrate): разница ≤ 1 °C становится поправкой, которая прибавляется
 *   к каждому показанию; больше 1 °C — модуль нужно заменить, поправка не меняется. Сверка раз в 3 месяца (R-021).
 */
var TS_SNS_STORE_MIN_ = 15, TS_SNS_RATE_PER_MIN_ = 30, TS_SNS_EXC_SEC_ = 3600;
var TS_SNS_SILENT_MIN_ = 60, TS_SNS_CAL_DAYS_ = 92, TS_SNS_CAL_MAX_ = 1.0, TS_SNS_CAL_FRESH_MIN_ = 15;
function _tsSnsR1_(x) { return Math.round(Number(x) * 10) / 10; }
/** Состояние датчика: сколько минут молчит и через сколько дней сверка (отрицательно — просрочена). */
function _tsSnsState_(d, now) {
  var seen = d.lastSeenAt ? new Date(d.lastSeenAt) : (d.createdAt ? new Date(d.createdAt) : null);
  var silent = seen && !isNaN(seen) ? Math.max(0, Math.round((now - seen) / 60000)) : null;
  var cal = d.calibratedAt ? new Date(d.calibratedAt) : (d.createdAt ? new Date(d.createdAt) : null);
  var due = cal && !isNaN(cal) ? Math.ceil((cal.getTime() + TS_SNS_CAL_DAYS_ * 86400000 - now.getTime()) / 86400000) : null;
  var txt = silent === null ? '' : silent < 120 ? silent + ' мин' : silent < 2880 ? Math.round(silent / 60) + ' ч' : Math.round(silent / 1440) + ' дн.';
  return { silentMin: silent, silentText: txt, calDueDays: due, neverSeen: !d.lastSeenAt };
}

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
  var raw = _ts2Num_(d.value), h = d.humidity === undefined || d.humidity === '' ? null : _ts2Num_(d.humidity);
  if (raw === null || raw < -60 || raw > 350) return { ok: false, error: 'значение вне физически возможного диапазона' };
  var offset = Number(dev.offset) || 0, v = offset ? _tsSnsR1_(raw + offset) : raw;   // поправка по сверке с поверенным термометром
  var rssi = _ts2Num_(d.rssi);
  if (h !== null && (h < 0 || h > 100)) h = null;
  var o = _ts2Find_('MEASUREMENT_OBJECTS', 'objectId', dev.objectId);
  if (!o || o.status !== 'ACTIVE') return { ok: false, error: 'объект замера выведен из работы' };
  var min = o.minValue === '' ? null : Number(o.minValue), max = o.maxValue === '' ? null : Number(o.maxValue);
  var res = (min !== null && v < min) || (max !== null && v > max) ? 'FAIL' : (min === null && max === null ? 'REVIEW' : 'PASS');
  return _withLock_(function () {
    var now = new Date(), last = dev.lastStoredAt ? new Date(dev.lastStoredAt) : null, auto = _tsSnsAuto_(o);
    var due = auto ? _tsSnsDueTasks_(o, now) : [];
    var failRepeat = res === 'FAIL' && dev.lastResult === 'FAIL' && last && !isNaN(last) && now - last < TS_SNS_STORE_MIN_ * 60000;
    var store = due.length > 0 || (res === 'FAIL' && !failRepeat) || (res !== 'FAIL' && dev.lastResult === 'FAIL');
    var patch = { lastSeenAt: _ts2Iso_(now), lastValue: v, lastResult: res, lastRaw: raw };
    if (rssi !== null && rssi < 0 && rssi > -120) patch.rssi = rssi;
    if (dev.silentNotifiedAt) { patch.silentNotifiedAt = ''; try { _ts2Audit_('SENSOR_BACK', 'SENSOR', dev.deviceId, { silentNotifiedAt: dev.silentNotifiedAt }, { lastSeenAt: patch.lastSeenAt }, 'датчик снова присылает показания'); } catch (e) {} }
    var out = { ok: true, result: res, stored: store, input: auto ? 'SENSOR' : 'MANUAL' };
    if (store) {
      patch.lastStoredAt = _ts2Iso_(now);
      var who = 'Датчик «' + dev.name + '»', unit = '°C', mId = _ts2Id_('MANUAL_MEASUREMENTS');
      _ts2Insert_('MANUAL_MEASUREMENTS', { measurementId: mId, enterpriseId: _ts2Ent_(), measurementType: (TS2_MEASURE_TYPES_[o.objectType] || TS2_MEASURE_TYPES_.OTHER)[0], objectType: o.objectType, objectId: o.objectId,
        value: v, unit: unit, minValue: o.minValue, maxValue: o.maxValue, result: res, employeeId: who, recordedAt: _ts2Iso_(now), source: 'SENSOR', comment: dev.deviceId + (offset ? ' (показание ' + raw + ', поправка ' + (offset > 0 ? '+' : '') + offset + ')' : ''), photoFileId: '', operationId: '' });
      var ar = _ts2AutoRecord_({ eventType: 'MEASUREMENT', sourceType: 'SENSOR:' + dev.deviceId, sourceId: mId, recordType: 'HACCP_FACT', journalCode: o.objectType === 'ROOM' ? 'J-ROOM' : 'J-STORAGE-T', kktId: '', productionId: '', batchId: '',
        ttkId: '', result: res, measurementMode: 'SENSOR', value: v, unit: unit, confidence: 1, status: 'ACTIVE', idempotencyKey: [_ts2Ent_(), 'SNS', dev.deviceId, Utilities.formatDate(now, _mcTz_(), "yyyy-MM-dd'T'HH:mm")].join('|'),
        operationId: '', confirmedByEmployee: who, confirmedAt: _ts2Iso_(now), ruleVersion: 'SENSOR' });
      // прежний журнал температур: холодильники, морозильники, склад
      if (o.legacyObjectId && typeof _tRecord_ === 'function' && typeof _tObjects_ === 'function') {
        try { var lo = _tObjects_().filter(function (x) { return x.id === String(o.legacyObjectId); })[0];
          if (lo) _tRecord_({ type: lo.type, object: lo.name, objectId: lo.id, equipmentId: lo.equipmentId || '', min: lo.min, max: lo.max, value: v, unit: lo.unit || unit, source: 'датчик ' + dev.deviceId }, { name: who }, ''); } catch (e) {}
      }
      out.closed = auto ? _tsSnsCloseTasks_(o, o.objectType === 'ROOM' ? 'ROOM' : o.objectType, now, v, res, ar.autoRecordId, who) : 0;
      if (auto && h !== null && o.objectType === 'ROOM') {
        var hr = _ts2Id_('MANUAL_MEASUREMENTS');
        _ts2Insert_('MANUAL_MEASUREMENTS', { measurementId: hr, enterpriseId: _ts2Ent_(), measurementType: 'ROOM_HUMIDITY', objectType: 'ROOM_HUMIDITY', objectId: o.objectId, value: h, unit: '%', minValue: '', maxValue: '',
          result: 'REVIEW', employeeId: who, recordedAt: _ts2Iso_(now), source: 'SENSOR', comment: dev.deviceId, photoFileId: '', operationId: '' });
        out.closedHumidity = _tsSnsCloseTasks_(o, 'ROOM_HUMIDITY', now, h, 'REVIEW', hr, who);
      }
    }
    if (res === 'FAIL') {   // уведомление об отклонении — при любом вводе, не чаще раза в час по объекту
      var ek = 'sns_exc_' + o.objectId;
      if (!cache.get(ek)) { cache.put(ek, '1', TS_SNS_EXC_SEC_); _ts2Exception_('TEMP_OUT', 'Датчик: ' + o.name + ' — ' + v + ' °C (норма ' + (min === null ? '…' : min) + '…' + (max === null ? '…' : max) + ')', o.objectId); }
    }
    _ts2Update_('SENSOR_DEVICES', 'deviceId', dev.deviceId, patch);
    return out;
  });
}
/** Ввод объекта: автоматический (датчик) или ручной. Пусто — ручной. */
function _tsSnsAuto_(o) { return !!o && o.inputMode === 'SENSOR'; }
/** Окно замера: показание пришло за 10 минут до или в течение 30 минут после времени замера (то же время, что у повара). */
var TS_SNS_WIN_BEFORE_MIN_ = 10, TS_SNS_WIN_AFTER_MIN_ = 30;
function _tsSnsWindow_(now) { return { from: _ts2Iso_(new Date(now.getTime() - TS_SNS_WIN_AFTER_MIN_ * 60000)), to: _ts2Iso_(new Date(now.getTime() + TS_SNS_WIN_BEFORE_MIN_ * 60000)) }; }
function _tsSnsDueTasks_(o, now) {
  var w = _tsSnsWindow_(now);
  return _ts2FindAll_('JOURNAL_EXPECTATIONS', 'status', 'OPEN', function (e) { return e.objectId === o.objectId && e.objectType !== 'ROOM_HUMIDITY' && String(e.dueAt) >= w.from && String(e.dueAt) <= w.to; });
}
/** Закрыть открытые задачи замера по объекту, время которых попадает в окно замера. */
function _tsSnsCloseTasks_(o, kind, now, v, res, factId, who) {
  var w = _tsSnsWindow_(now), from = w.from, to = w.to, n = 0;
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

/** Каждые 15 минут: датчик молчит больше часа — одно уведомление, пока он снова не пришлёт показание. */
function ts2SensorWatchSystem() {
  try { if (!_book_().getSheetByName('SENSOR_DEVICES') || typeof _ts2Prof_ !== 'function' || !_ts2Prof_('mode', '')) return { skipped: true }; } catch (e) { return { skipped: true }; }
  var now = new Date(), n = 0, objs = {};
  _ts2Rows_('MEASUREMENT_OBJECTS').forEach(function (o) { objs[o.objectId] = o.name; });
  _ts2Rows_('SENSOR_DEVICES', function (d) { return d.status === 'ACTIVE' && !d.silentNotifiedAt; }).forEach(function (d) {
    var s = _tsSnsState_(d, now); if (s.silentMin === null || s.silentMin < TS_SNS_SILENT_MIN_) return;
    _ts2Exception_('SENSOR_SILENT', 'Датчик «' + d.name + '» (' + (objs[d.objectId] || d.objectId) + ') ' + (s.neverSeen ? 'ни разу не прислал показание' : 'молчит ' + s.silentText) +
      '. Проверьте питание и Wi-Fi; пока датчик молчит, замер делает повар.', d.objectId);
    _ts2Update_('SENSOR_DEVICES', 'deviceId', d.deviceId, { silentNotifiedAt: _ts2Iso_(now) }); n++;
  });
  return { notified: n };
}
/** Сверка с поверенным термометром по свежему показанию датчика (не старше 15 минут). */
function _tsSnsCalibrate_(deviceId, referenceValue, thermometer, comment, who) {
  var d = _ts2Find_('SENSOR_DEVICES', 'deviceId', deviceId); if (!d || d.status !== 'ACTIVE') throw new Error('NOT_FOUND: датчик не найден или отключён');
  var ref = _ts2Num_(referenceValue); if (ref === null) throw new Error('VALIDATION: укажите показание поверенного термометра');
  thermometer = String(thermometer || '').trim(); if (!thermometer) throw new Error('VALIDATION: укажите термометр, по которому сверяете (название или номер в реестре оборудования)');
  var seen = d.lastSeenAt ? new Date(d.lastSeenAt) : null;
  if (!seen || isNaN(seen) || Date.now() - seen.getTime() > TS_SNS_CAL_FRESH_MIN_ * 60000) throw new Error('VALIDATION: датчик не присылал показаний последние ' + TS_SNS_CAL_FRESH_MIN_ + ' минут — дождитесь свежего показания');
  var raw = d.lastRaw !== '' && d.lastRaw !== undefined ? Number(d.lastRaw) : Number(d.lastValue) - (Number(d.offset) || 0);
  var before = Number(d.offset) || 0, diff = _tsSnsR1_(ref - raw), ok = Math.abs(diff) <= TS_SNS_CAL_MAX_, after = ok ? diff : before, now = _ts2Iso_();
  var row = { calibrationId: _ts2Id_('SENSOR_CALIBRATIONS'), enterpriseId: _ts2Ent_(), deviceId: d.deviceId, objectId: d.objectId, referenceValue: ref, referenceThermometer: thermometer.slice(0, 120),
    sensorRaw: raw, offsetBefore: before, offsetAfter: after, difference: diff, result: ok ? 'OK' : 'REPLACE', calibratedBy: who, calibratedAt: now, comment: String(comment || '').slice(0, 300) };
  _ts2Insert_('SENSOR_CALIBRATIONS', row);
  if (ok) _ts2Update_('SENSOR_DEVICES', 'deviceId', d.deviceId, { offset: after, calibratedAt: now, calibratedBy: who });
  else _ts2Exception_('SENSOR_CALIBRATION_FAIL', 'Датчик «' + d.name + '» расходится с поверенным термометром на ' + diff + ' °C (допустимо ±' + TS_SNS_CAL_MAX_ + ' °C) — замените модуль; до замены замер делает повар', d.objectId);
  _ts2Audit_('SENSOR_CALIBRATE', 'SENSOR', d.deviceId, { offset: before }, { offset: after, difference: diff, result: row.result }, thermometer);
  return row;
}
function ts2SensorCalibrate(token, deviceId, referenceValue, thermometer, comment) {
  try { var s = _requireAuth_(token, 'org_edit'); return _ok_(_tsSnsCalibrate_(deviceId, referenceValue, thermometer, comment, s && (s.name || s.fullName) || _ts2Actor_().name)); }
  catch (e) { return _failFrom_(e); }
}

/** Выбор ввода объекта замера: MANUAL — повар, SENSOR — датчик. Время замеров не меняется. */
function _tsSnsSetInput_(objectId, mode) {
  if (mode !== 'MANUAL' && mode !== 'SENSOR') throw new Error('VALIDATION: ввод — ручной (MANUAL) или автоматический (SENSOR)');
  var o = _ts2Find_('MEASUREMENT_OBJECTS', 'objectId', objectId); if (!o || o.status !== 'ACTIVE') throw new Error('NOT_FOUND: объект замера не найден');
  if (mode === 'SENSOR' && ['FRIDGE', 'FREEZER', 'ROOM'].indexOf(o.objectType) < 0) throw new Error('VALIDATION: автоматический ввод — для холодильника, морозильника или помещения');
  var active = _ts2Rows_('SENSOR_DEVICES', function (x) { return x.objectId === objectId && x.status === 'ACTIVE'; }).length;
  if (mode === 'SENSOR' && !active) throw new Error('VALIDATION: сначала подключите датчик к объекту');
  if ((o.inputMode || 'MANUAL') !== mode) { _ts2Update_('MEASUREMENT_OBJECTS', 'objectId', objectId, { inputMode: mode }); _ts2Audit_('OBJECT_INPUT_MODE', 'MEASUREMENT_OBJECT', objectId, { inputMode: o.inputMode || 'MANUAL' }, { inputMode: mode }, ''); }
  return { objectId: objectId, inputMode: mode, checkTimes: o.checkTimes };
}
function ts2ObjectInputMode(token, objectId, mode) {
  try { _requireAuth_(token, 'org_edit'); return _ok_(_tsSnsSetInput_(objectId, mode)); } catch (e) { return _failFrom_(e); }
}

/* ------------------------------------------------------------------ интерфейс */
function ts2Sensors(token) {
  try {
    _requireAuth_(token); _ts2EnsureSchema_(false);
    var url = ''; try { url = typeof _tsPublicUrl_ === 'function' ? _tsPublicUrl_() : ScriptApp.getService().getUrl(); } catch (e) {}
    var objs = {}, modes = {}; _ts2Rows_('MEASUREMENT_OBJECTS').forEach(function (o) { objs[o.objectId] = o.name; modes[o.objectId] = o.inputMode || 'MANUAL'; });
    return _ok_({ url: url, devices: _ts2Rows_('SENSOR_DEVICES').map(function (d) { var age = d.lastSeenAt ? (Date.now() - new Date(d.lastSeenAt).getTime()) / 60000 : null;
      var st = _tsSnsState_(d, new Date());
      return { deviceId: d.deviceId, name: d.name, object: objs[d.objectId] || d.objectId, objectId: d.objectId, status: d.status, lastSeenAt: d.lastSeenAt, lastValue: d.lastValue, lastResult: d.lastResult, silentMin: age === null ? null : Math.round(age),
        inputMode: modes[d.objectId] || 'MANUAL', rssi: d.rssi === '' || d.rssi === undefined ? null : Number(d.rssi), offset: Number(d.offset) || 0, calibratedAt: d.calibratedAt || '', calDueDays: st.calDueDays, silent: d.status === 'ACTIVE' && st.silentMin !== null && st.silentMin >= TS_SNS_SILENT_MIN_ }; }),
      calibrations: _ts2Tail_('SENSOR_CALIBRATIONS', 20).reverse().map(function (c) { return { at: c.calibratedAt, deviceId: c.deviceId, reference: c.referenceValue, thermometer: c.referenceThermometer, raw: c.sensorRaw, difference: c.difference, offset: c.offsetAfter, result: c.result, by: c.calibratedBy }; }) });
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
    if (o.inputMode !== 'SENSOR') { _ts2Update_('MEASUREMENT_OBJECTS', 'objectId', objectId, { inputMode: 'SENSOR' }); _ts2Audit_('OBJECT_INPUT_MODE', 'MEASUREMENT_OBJECT', objectId, { inputMode: o.inputMode || 'MANUAL' }, { inputMode: 'SENSOR' }, 'подключён датчик'); }
    var url = ''; try { url = typeof _tsPublicUrl_ === 'function' ? _tsPublicUrl_() : ScriptApp.getService().getUrl(); } catch (e) {}
    return _ok_({ deviceId: id, token: key, url: url, example: { device: id, token: key, value: 4.2 } });
  } catch (e) { return _failFrom_(e); }
}
function ts2SensorRevoke(token, deviceId) {
  try {
    _requireAuth_(token, 'org_edit'); var d = _ts2Find_('SENSOR_DEVICES', 'deviceId', deviceId); if (!d) return _fail_('NOT_FOUND', 'Датчик не найден');
    _ts2Update_('SENSOR_DEVICES', 'deviceId', deviceId, { status: 'REVOKED', revokedAt: _ts2Iso_(), tokenHash: '' });
    _ts2Audit_('SENSOR_REVOKE', 'SENSOR', deviceId, { status: d.status }, { status: 'REVOKED' }, '');
    // последний датчик объекта отключён — замеры снова вручную
    if (!_ts2Rows_('SENSOR_DEVICES', function (x) { return x.objectId === d.objectId && x.status === 'ACTIVE'; }).length) {
      var o = _ts2Find_('MEASUREMENT_OBJECTS', 'objectId', d.objectId);
      if (o && o.inputMode === 'SENSOR') { _ts2Update_('MEASUREMENT_OBJECTS', 'objectId', o.objectId, { inputMode: 'MANUAL' }); _ts2Audit_('OBJECT_INPUT_MODE', 'MEASUREMENT_OBJECT', o.objectId, { inputMode: 'SENSOR' }, { inputMode: 'MANUAL' }, 'датчик отключён'); }
    }
    return _ok_({ deviceId: deviceId });
  } catch (e) { return _failFrom_(e); }
}
