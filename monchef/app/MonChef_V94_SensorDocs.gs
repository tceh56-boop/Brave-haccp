/**
 * MON CHEF — документы датчиков температуры (к V94): декларация / сертификат соответствия, свидетельство об утверждении типа или поверке.
 *
 * Документ (снимок, PDF или текст) распознаётся в черновик: вид, номер, дата регистрации, срок действия, техрегламенты, изготовитель,
 *   есть ли модель датчика в перечне. Подтверждает ответственный (галочка) — документ привязывается к датчику.
 * Что подтверждает документ, система пишет прямо: декларация по ТР ТС 020/2011 — электромагнитная совместимость, а не точность измерений.
 *   Чтобы показания датчика шли в журнал температур, нужна проверка по эталонному термометру («Проверка прибора по эталону», J19/J20)
 *   или калибровка / поверка («Средства измерения»). Показания датчика по-прежнему не принимаются, пока нет образца выгрузки (заглушка V94).
 * Персональные данные из документа (лицо, подписавшее декларацию, телефоны, почта) не сохраняются: в лист — только поля и текст без этих строк.
 */
var MC_V94_SD_ = 'Датчики_Документы_V94', MC_V94_SD_HEAD_ = ['DocID', 'SensorID', 'Датчик', 'Вид документа', 'Номер', 'Дата регистрации', 'Действует до', 'Техрегламенты', 'Изготовитель',
  'Модель в перечне', 'Что подтверждает', 'Источник', 'Файл', 'FileID', 'SHA-256', 'Распознано (JSON)', 'Статус', 'Подтвердил', 'Подтверждено', 'Создал', 'Создано', 'OperationID'];
var MC_V94_TR_RU_ = { '020/2011': 'электромагнитная совместимость', '004/2011': 'безопасность низковольтного оборудования', '037/2016': 'ограничение опасных веществ в электротехнике' };

function _v94SdMask_(t) {
  return String(t || '').split(/\r?\n/).filter(function (l) { return !/В\s+лице|Ф\.\s*И\.\s*О|\(подпись\)|М\.П\./i.test(l); })
    .map(function (l) { return l.replace(/[\w.+-]+@[\w.-]+\.\w+/g, '[почта скрыта]').replace(/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}|\+7\s?\d{10}/g, '[телефон скрыт]').replace(/Номер\s+телефона:\s*\S+/gi, 'Номер телефона: [скрыт]')
      .replace(/(?:[А-ЯЁ][А-ЯЁа-яё-]+\s+){1,2}[А-ЯЁ][А-ЯЁа-яё]*(?:ОВИЧ|ЕВИЧ|ИЧ|ОВНА|ЕВНА|ИЧНА|ИНИЧНА)(?![А-ЯЁа-яё])/gi, '[ФИО скрыто]'); }).join('\n');
}
/** Разбор текста документа датчика; model — модель из карточки датчика (для проверки перечня). */
function _v94SdParse_(text, model) {
  var T = String(text || '').replace(/ /g, ' '), U = T.toUpperCase(), f = { src: {}, regs: [] };
  if (/ДЕКЛАРАЦИЯ\s+О\s+СООТВЕТСТВИИ/.test(U)) f.kind = 'декларация о соответствии';
  else if (/СЕРТИФИКАТ\s+СООТВЕТСТВИЯ/.test(U)) f.kind = 'сертификат соответствия';
  else if (/УТВЕРЖДЕНИИ\s+ТИПА/.test(U)) f.kind = 'свидетельство об утверждении типа средства измерений';
  else if (/СВИДЕТЕЛЬСТВО\s+О\s+ПОВЕРКЕ|РЕЗУЛЬТАТ\w*\s+ПОВЕРКИ/.test(U)) f.kind = 'свидетельство о поверке';
  var m = /(ЕАЭС\s*N\s*RU\s*[ДС]-[A-ZА-Я]{2}\.[A-ZА-Я0-9]+\.[A-ZА-Я]\.\d+\/\d{2})/i.exec(T); if (m) { f.number = m[1].replace(/\s+/g, ' '); f.src.number = m[0]; }
  m = /Дата\s+регистрации[^:\n]*:\s*(\d{2}\.\d{2}\.\d{4})/i.exec(T); if (m) { f.regDate = m[1]; f.src.regDate = m[0].replace(/\s+/g, ' '); }
  m = /действительн\S*\s+(?:с\s+даты\s+регистрации\s+)?по\s+(\d{2}\.\d{2}\.\d{4})/i.exec(T); if (m) { f.validTo = m[1]; f.src.validTo = m[0].replace(/\s+/g, ' '); }
  var re = /ТР\s+(?:ТС|ЕАЭС)\s+(\d{3}\/\d{4})/gi, x; while ((x = re.exec(T))) if (f.regs.indexOf(x[1]) < 0) f.regs.push(x[1]);
  m = /Изготовитель:\s*[«"]?\s*([^,«»"\n]{3,120})/i.exec(T); if (m) { f.manufacturer = m[1].replace(/[.\s]+$/, '').trim(); f.src.manufacturer = m[0].replace(/\s+/g, ' ').slice(0, 160); }
  var mdl = String(model || '').trim().toUpperCase();
  if (mdl) {
    var esc = mdl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), series = mdl.replace(/\d+$/, '');
    if (new RegExp('(^|[^A-ZА-Я0-9])' + esc + '([^A-ZА-Я0-9]|$)').test(U)) f.modelListed = 'да — модель ' + mdl + ' в перечне';
    else if (series && series !== mdl && new RegExp('(^|[^A-ZА-Я0-9])' + series.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-ZА-Я0-9]|$)').test(U)) f.modelListed = 'серия ' + series + ' в перечне (модель ' + mdl + ' отдельно не названа)';
    else f.modelListed = 'нет — модели ' + mdl + ' в документе не найдено';
  }
  f.confirms = _v94SdWhat_(f);
  return f;
}
function _v94SdWhat_(f) {
  if (/утверждении типа/.test(f.kind || '')) return 'тип средства измерений утверждён — для журнала нужна ещё действующая поверка или калибровка экземпляра';
  if (/поверке/.test(f.kind || '')) return 'поверка экземпляра — проверьте серийный номер и срок';
  var r = (f.regs || []).map(function (k) { return 'ТР ТС ' + k + (MC_V94_TR_RU_[k] ? ' (' + MC_V94_TR_RU_[k] + ')' : ''); });
  return (r.length ? r.join('; ') : 'техрегламент не распознан') + ' — не подтверждает точность измерений';
}
function _v94SdWarn_(f) {
  var w = [], today = _v71Day_(new Date()), iso = function (d) { var p = String(d || '').split('.'); return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : ''; };
  if (!f.kind) w.push('вид документа не распознан');
  if (!f.number && /декларация|сертификат/.test(f.kind || '')) w.push('номер документа не найден — проверьте по реестру Росаккредитации');
  if (f.validTo && iso(f.validTo) < today) w.push('срок действия истёк ' + f.validTo);
  if (f.modelListed && /^нет/.test(f.modelListed)) w.push(f.modelListed);
  if (!/утверждении типа|поверке/.test(f.kind || '')) w.push('документ не метрологический: для записей в журнал температур — проверка по эталонному термометру («Проверка прибора по эталону», J19/J20) или калибровка / поверка («Средства измерения»)');
  return w;
}
function _v94SdView_(r) {
  var f = {}; try { f = JSON.parse(String(r['Распознано (JSON)'] || '{}')); } catch (e) {}
  return { id: String(r.DocID), sensorId: String(r.SensorID), sensor: String(r['Датчик'] || ''), kind: String(r['Вид документа'] || ''), number: String(r['Номер'] || ''), regDate: String(r['Дата регистрации'] || ''),
    validTo: String(r['Действует до'] || ''), regs: String(r['Техрегламенты'] || ''), manufacturer: String(r['Изготовитель'] || ''), modelListed: String(r['Модель в перечне'] || ''), confirms: String(r['Что подтверждает'] || ''),
    source: String(r['Источник'] || ''), fileName: String(r['Файл'] || ''), status: String(r['Статус']), by: String(r['Подтвердил'] || r['Создал'] || ''), src: f.src || {}, warnings: _v94SdWarn_(f.kind !== undefined ? f : {
      kind: r['Вид документа'], number: r['Номер'], validTo: r['Действует до'], modelListed: r['Модель в перечне'] }) };
}
function _v94SdSensor_(id) { return _v92Rows_(MC_V94_SN_).filter(function (r) { return String(r.SensorID) === String(id || ''); })[0] || null; }

/** Загрузить документ датчика: {sensorId, data | text | manual, fileName?}. Черновик. */
function v94SensorDoc(json, token) {
  var op = null; try { op = _beginOp_(token, 'haccp|journals', 'V94_SENSOR_DOC', 'Температуры', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_v94LampCan_(op.session)) return _v94Fail_(op, 'FORBIDDEN', 'Технический доступ записей не делает');
    var d = _v94J_(json), sn = _v94SdSensor_(d.sensorId), text = '', file = null, sha = '', src = 'MANUAL';
    if (!sn) return _v94Fail_(op, 'VALIDATION', 'Выберите датчик');
    if (d.data) {
      var F = _v94File_(d.data); if (F.error) return _v94Fail_(op, 'VALIDATION', F.error);
      var dup = _v92Rows_(MC_V94_SD_).filter(function (r) { return String(r['SHA-256']) === F.sha && /DRAFT|CONFIRMED/.test(r['Статус']) && String(r.SensorID) === String(sn.SensorID); })[0];
      if (dup) return _v94Fail_(op, 'DUPLICATE', 'Этот документ уже загружен для датчика: ' + dup.DocID);
      var o = _v94Ocr_(d.data); if (o.error) return _v94Fail_(op, 'STATE', o.error);
      text = o.text; src = 'PHOTO'; sha = F.sha;
      file = _mcFolder_('company', true).createFile(Utilities.newBlob(F.bytes, F.mime, 'Документ датчика — ' + (_v94S_(d.fileName) || Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH-mm'))));
    } else if (d.text) { text = String(d.text).slice(0, 30000); src = 'TEXT'; }
    else if (d.manual !== true) return _v94Fail_(op, 'VALIDATION', 'Выберите снимок или PDF документа, вставьте текст или нажмите «Заполнить вручную»');
    var f = text ? _v94SdParse_(text, sn['Модель']) : { src: {}, regs: [] }; f.source = src; f.text = _v94SdMask_(text).slice(0, 6000);
    var id = _v76Id_('SDC'), who = _v93Who_(op);
    _withLock_(function () {
      _v93Write_(MC_V94_SD_, MC_V94_SD_HEAD_, { DocID: id, SensorID: String(sn.SensorID), 'Датчик': String(sn['Объект контроля'] || '') + ' — ' + String(sn['Тип датчика'] || '') + (sn['Модель'] ? ' ' + sn['Модель'] : ''),
        'Вид документа': f.kind || '', 'Номер': f.number || '', 'Дата регистрации': f.regDate || '', 'Действует до': f.validTo || '', 'Техрегламенты': (f.regs || []).map(function (k) { return 'ТР ТС ' + k; }).join(', '),
        'Изготовитель': f.manufacturer || '', 'Модель в перечне': f.modelListed || '', 'Что подтверждает': f.text || f.kind ? _v94SdWhat_(f) : '', 'Источник': src, 'Файл': file ? file.getName() : '', FileID: file ? file.getId() : '', 'SHA-256': sha,
        'Распознано (JSON)': JSON.stringify(f), 'Статус': 'DRAFT', 'Создал': who, 'Создано': new Date(), OperationID: op.id });
    });
    _audit_(op, 'V94_SENSOR_DOC', MC_V94_SD_, id, null, { датчик: sn.SensorID, вид: f.kind || '', номер: f.number || '', источник: src });
    _endOp_(op); return _ok_({ id: id, fields: f, warnings: _v94SdWarn_(f) }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Подтвердить документ датчика: {id, kind, number, regDate, validTo, regs, manufacturer, modelListed, confirm}. */
function v94SensorDocConfirm(json, token) {
  var op = null; try { op = _beginOp_(token, 'haccp|journals', 'V94_SENSOR_DOC_CONFIRM', 'Температуры', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_v94LampCan_(op.session)) return _v94Fail_(op, 'FORBIDDEN', 'Технический доступ записей не делает');
    var d = _v94J_(json), dt = function (x) { return /^\d{2}\.\d{2}\.\d{4}$/.test(_v94S_(x)); };
    if (d.confirm !== true) return _v94Fail_(op, 'VALIDATION', 'Сверьте поля с документом и поставьте галочку');
    var kind = _v94S_(d.kind), number = _v94S_(d.number);
    if (kind.length < 5) return _v94Fail_(op, 'VALIDATION', 'Укажите вид документа');
    if (/декларация|сертификат/i.test(kind) && number.length < 8) return _v94Fail_(op, 'VALIDATION', 'Укажите регистрационный номер документа');
    if (d.regDate && !dt(d.regDate)) return _v94Fail_(op, 'VALIDATION', 'Дата регистрации — ДД.ММ.ГГГГ');
    if (d.validTo && !dt(d.validTo)) return _v94Fail_(op, 'VALIDATION', 'Срок действия — ДД.ММ.ГГГГ');
    return _withLock_(function () {
      var r = _v92Rows_(MC_V94_SD_).filter(function (x) { return String(x.DocID) === String(d.id || ''); })[0];
      if (!r) return _v94Fail_(op, 'NOT_FOUND', 'Черновик не найден');
      if (String(r['Статус']) !== 'DRAFT') return _v94Fail_(op, 'VALIDATION', 'Документ уже ' + (String(r['Статус']) === 'CONFIRMED' ? 'подтверждён' : 'отменён'));
      var f = {}; try { f = JSON.parse(String(r['Распознано (JSON)'] || '{}')); } catch (e) {}
      f.kind = kind; f.number = number; f.regDate = _v94S_(d.regDate); f.validTo = _v94S_(d.validTo); f.manufacturer = _v94S_(d.manufacturer); f.modelListed = _v94S_(d.modelListed) || f.modelListed || '';
      f.regs = String(d.regs || '').match(/\d{3}\/\d{4}/g) || f.regs || [];
      r['Вид документа'] = kind; r['Номер'] = number; r['Дата регистрации'] = f.regDate; r['Действует до'] = f.validTo; r['Техрегламенты'] = f.regs.map(function (k) { return 'ТР ТС ' + k; }).join(', ');
      r['Изготовитель'] = f.manufacturer; r['Модель в перечне'] = f.modelListed; r['Что подтверждает'] = _v94SdWhat_(f); r['Распознано (JSON)'] = JSON.stringify(f);
      r['Статус'] = 'CONFIRMED'; r['Подтвердил'] = _v93Who_(op); r['Подтверждено'] = new Date();
      _v93Write_(MC_V94_SD_, MC_V94_SD_HEAD_, r);
      _audit_(op, 'V94_SENSOR_DOC_CONFIRM', MC_V94_SD_, r.DocID, null, { датчик: r.SensorID, вид: kind, номер: number, действует_до: f.validTo, подтверждает: r['Что подтверждает'] });
      _endOp_(op); return _ok_({ id: String(r.DocID), confirms: r['Что подтверждает'], warnings: _v94SdWarn_(f) }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Отменить черновик: {id}. */
function v94SensorDocCancel(json, token) {
  var op = null; try { op = _beginOp_(token, 'haccp|journals', 'V94_SENSOR_DOC_CANCEL', 'Температуры', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_v94LampCan_(op.session)) return _v94Fail_(op, 'FORBIDDEN', 'Технический доступ записей не делает');
    var d = _v94J_(json);
    return _withLock_(function () {
      var r = _v92Rows_(MC_V94_SD_).filter(function (x) { return String(x.DocID) === String(d.id || ''); })[0];
      if (!r || String(r['Статус']) !== 'DRAFT') return _v94Fail_(op, 'VALIDATION', 'Отменить можно только черновик');
      r['Статус'] = 'CANCELLED'; _v93Write_(MC_V94_SD_, MC_V94_SD_HEAD_, r);
      _audit_(op, 'V94_SENSOR_DOC_CANCEL', MC_V94_SD_, r.DocID, null, null);
      _endOp_(op); return _ok_({ id: String(r.DocID), status: 'CANCELLED' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
// экран «Паспорта ламп и датчики»: документы датчиков — к каждому датчику и черновики
(function () {
  if (typeof v94LampData !== 'function') return;
  var orig = v94LampData;
  v94LampData = function (token) {
    var res = orig(token), o; try { o = JSON.parse(res); } catch (e) { return res; }
    if (!o || !(o.ok || o.success) || !o.data) return res;
    try {
      var R = _v92Rows_(MC_V94_SD_).map(_v94SdView_);
      (o.data.sensors || []).forEach(function (s) { s.docs = R.filter(function (x) { return x.sensorId === s.id && x.status === 'CONFIRMED'; }); });
      o.data.sensorDrafts = R.filter(function (x) { return x.status === 'DRAFT'; }).reverse();
    } catch (e) {}
    return JSON.stringify(o);
  };
})();
