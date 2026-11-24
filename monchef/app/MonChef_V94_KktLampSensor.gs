/**
 * MonChef V94 — касса: загрузка Z-отчёта; бактерицидные лампы: паспорт облучателя через распознавание;
 * датчики температуры — заглушка (24.11.2026).
 *
 *  Z-отчёт (отчёт о закрытии смены ККТ): фото, PDF или текст → распознавание (Yandex Vision, как накладные и акты 3-Д) →
 *  черновик: номер смены, дата и время закрытия, РН и ЗН ККТ, ФН, ФД, ФП, ИНН, число чеков, приход (всего, наличными,
 *  безналичными), возврат прихода, расход, возврат расхода — только то, что найдено в тексте отчёта, с исходной строкой.
 *  Человек проверяет каждое поле и записывает. После записи — сверка с журналом продаж за дату смены (выручка по Z-отчёту
 *  = приход − возврат прихода). Строка с ФИО кассира в сохранённом тексте скрывается. MON CHEF не является кассой:
 *  чеки не пробивает, Z-отчёт не заменяет фискальный документ, финансовых проводок не делает.
 *
 *  Паспорт облучателя: снимок или PDF паспорта → модель, изготовитель, заводской номер, дата выпуска, тип установки,
 *  тип, число и мощность ламп, ресурс лампы (с цитатой строки паспорта), производительность, режим. После подтверждения —
 *  ресурс лампы в реестре «Лампы_Регламент» берётся из паспорта. Ресурсы, внесённые раньше без паспорта (в том числе
 *  значения по умолчанию 8000 и 9000 ч), помечаются «не подтверждён паспортом».
 *
 *  Датчики температуры: реестр датчиков по объектам контроля и адаптер-заглушка — данные не принимаются
 *  (SENSOR_NOT_CONNECTED), пока нет образца выгрузки логгеров; температуры вносит сотрудник, как раньше.
 */
var MC_V94_Z_ = 'Касса_Z_Отчёты_V94', MC_V94_Z_HEAD_ = ['ZID', 'Дата смены', 'Закрыта', 'Смена №', 'РН ККТ', 'ЗН ККТ', 'ФН', 'ФД', 'ФП', 'ИНН', 'Чеков', 'Приход', 'Наличными',
  'Безналичными', 'Возврат прихода', 'Расход', 'Возврат расхода', 'Выручка', 'LocationID', 'Источник', 'Файл', 'FileID', 'SHA-256', 'Распознано (JSON)', 'Сверка (JSON)', 'Статус',
  'Записал', 'Записано', 'Создал', 'Создано', 'Причина аннулирования', 'OperationID'];
var MC_V94_LP_ = 'Лампы_Паспорта_V94', MC_V94_LP_HEAD_ = ['PassportID', 'Установка', 'Помещение', 'Модель', 'Изготовитель', 'Заводской №', 'Дата выпуска', 'Тип установки', 'Тип ламп',
  'Ламп в установке', 'Мощность лампы, Вт', 'Ресурс лампы, ч', 'Строка паспорта о ресурсе', 'Производительность', 'Режим облучения', 'Источник', 'Файл', 'FileID', 'SHA-256', 'Распознано (JSON)',
  'Статус', 'Подтвердил', 'Подтверждено', 'Создал', 'Создано', 'OperationID'];
var MC_V94_SN_ = 'Датчики_V94', MC_V94_SN_HEAD_ = ['SensorID', 'ObjectID', 'Объект контроля', 'Тип датчика', 'Модель', 'Серийный №', 'Статус', 'Комментарий', 'Добавил', 'Добавлено', 'OperationID'];
var MC_V94_ZST_RU_ = { DRAFT: 'черновик', POSTED: 'записан', CANCELLED: 'отменён', ANNULLED: 'аннулирован' };
var MC_V94_SENSOR_MSG_ = 'Датчик не подключён: образца выгрузки логгеров нет — температуры вносит сотрудник, как раньше';

/* ---------------- права, меню ---------------- */
(function () {
  try { MC_RB_MODULES_.kkt = 'cash_view|finance_view|finance_edit|revenue_view'; MC_RB_MODULE_RU_.kkt = 'Касса: Z-отчёты'; } catch (e) {}
  try { MC_RB_MODULES_.lampdocs = 'journals|haccp|haccp_view|sanitation'; MC_RB_MODULE_RU_.lampdocs = 'Паспорта ламп и датчики'; } catch (e) {}
  try { ['kkt', 'lampdocs'].forEach(function (k) { if (MC_UI_VIEWS_.indexOf(k) < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat([k]); }); } catch (e) {}
  try { var o = _mcViewOfParams_; _mcViewOfParams_ = function (params) { if (params && (params.kkt === '1' || params.zreport === '1')) return 'kkt'; if (params && (params.lampdocs === '1' || params.sensors === '1')) return 'lampdocs'; return o.apply(this, arguments); }; } catch (e) {}
  try {
    var sec = function (k, btn) { var orig = _UI_BUILDERS_[k]; if (typeof orig !== 'function') return; _UI_BUILDERS_[k] = function (token, opts, s) { var r = orig(token, opts, s) || {}; r.actions = (r.actions || []).concat([btn]); return r; }; };
    sec('finance', { label: 'Касса: Z-отчёты и сверка с журналом продаж', module: 'kkt' });
    sec('home', { label: 'Касса: Z-отчёты', module: 'kkt' });
    sec('sanitation', { label: 'Бактерицидные лампы: паспорта; датчики температуры', module: 'lampdocs' });
    sec('equipment', { label: 'Паспорта бактерицидных ламп, датчики температуры', module: 'lampdocs' });
  } catch (e) {}
  try { var a = MC_RB_GRANTABLE_.cash_view || (MC_RB_GRANTABLE_.cash_view = []); ['Администратор', 'Администратор площадки', 'Руководитель смены', 'Бухгалтер / экономист'].forEach(function (r) { if (a.indexOf(r) < 0) a.push(r); }); } catch (e) {}
})();

/* ---------------- общие ---------------- */
function _v94S_(x) { return String(x === undefined || x === null ? '' : x).replace(/[   ]/g, ' ').replace(/[ \t]+/g, ' ').trim(); }
function _v94J_(x) { return typeof x === 'string' ? JSON.parse(x || '{}') : (x || {}); }
function _v94Sha_(bytes) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
function _v94Amt_(s) { if (s === undefined || s === null) return null; var m = /[-−]?\d[\d\s]*(?:[.,]\d{1,2})?/.exec(String(s).replace(/[  ]/g, ' ')); if (!m) return null; var n = Number(m[0].replace(/\s/g, '').replace(',', '.').replace('−', '-')); return isFinite(n) ? Math.round(n * 100) / 100 : null; }
function _v94Num_(x) { if (x === '' || x === null || x === undefined) return null; var n = Number(String(x).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; }
function _v94Fail_(op, code, msg) { try { _endOp_(op, 'FAILED'); } catch (e) {} return _fail_(code, msg, op && op.id); }
/** Файл из data:URL: проверка типа, SHA-256, распознавание. */
function _v94File_(dataUrl) {
  var m = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl || '')); if (!m) return { error: 'Файл не прочитан — выберите фото или PDF' };
  if (!/^(image\/(jpeg|png)|application\/pdf)$/i.test(m[1])) return { error: 'Нужен снимок (JPEG, PNG) или PDF' };
  var bytes = Utilities.base64Decode(m[2]);
  return { mime: m[1], bytes: bytes, sha: _v94Sha_(bytes) };
}
function _v94Ocr_(dataUrl) {
  var ocr = _yandexVisionRecognize_(String(dataUrl));
  if (ocr.error === 'pd-off') return { error: ocr.message || 'Внешнее распознавание выключено — вставьте текст или заполните вручную' };   // V100
  if (ocr.error) return { error: ocr.error === 'no-key' ? 'Распознавание снимков не настроено (ключ Yandex Vision, как для накладных) — вставьте текст или заполните вручную' : 'Текст на снимке не распознан: ' + ocr.error };
  return { text: String(ocr.fullText || '') };
}

/* ======================= КАССА: Z-ОТЧЁТ ======================= */
function _v94ZRows_() { return _v92Rows_(MC_V94_Z_); }
/** Разбор текста Z-отчёта. Только найденное в тексте; у каждого поля — исходная строка. */
function _v94ZParse_(text) {
  var L = String(text || '').split(/\r?\n/).map(_v94S_).filter(String), f = { src: {} }, put = function (k, v, line) { if (v === null || v === undefined || v === '' || f[k] !== undefined) return; f[k] = v; f.src[k] = line; };
  var amtEnd = function (l) { var m = /(?:=|:)?\s*([-−]?\d[\d ]*(?:[.,]\d{2}))\s*(?:₽|руб\.?|р\.)?\s*$/i.exec(l); return m ? _v94Amt_(m[1]) : null; };
  var sec = '', secLine = '', nonReset = false;   // \b в JS не работает с кириллицей — границы слов задаются явно
  L.forEach(function (l, i) {
    var u = l.toUpperCase().replace(/Ё/g, 'Е');
    var m;
    if ((m = /СМЕН[АЫ]\s*(?:№|N|#|НОМЕР)\s*:?\s*(\d{1,6})/.exec(u)) || (m = /^СМЕНА\s*:?\s*(\d{1,6})\b/.exec(u))) put('shift', m[1], l);
    if ((m = /(\d{2})[.\/](\d{2})[.\/](\d{2,4})\s*(\d{1,2}):(\d{2})/.exec(l))) { var y = m[3].length === 2 ? '20' + m[3] : m[3]; put('closedAt', y + '-' + m[2] + '-' + m[1] + ' ' + ('0' + m[4]).slice(-2) + ':' + m[5], l); }
    if ((m = /РН\s*ККТ\s*[:№]?\s*([\d ]{10,24})/.exec(u))) put('kktRn', m[1].replace(/\s/g, ''), l);
    if ((m = /ЗН\s*ККТ\s*[:№]?\s*([0-9A-ZА-Я]{6,20})/.exec(u))) put('kktZn', m[1], l);
    if ((m = /(?:^|\s)ФН\s*[:№]?\s*(\d{16})/.exec(u))) put('fn', m[1], l);
    if ((m = /(?:^|\s)ФД\s*[:№]?\s*(\d{1,10})\b/.exec(u))) put('fd', m[1], l);
    if ((m = /(?:^|\s)ФПД?\s*[:№]?\s*(\d{6,12})\b/.exec(u))) put('fp', m[1], l);
    if ((m = /ИНН\s*:?\s*(\d{12}|\d{10})\b/.exec(u))) put('inn', m[1], l);
    // разделы счётчиков: ПРИХОД / ВОЗВРАТ ПРИХОДА / РАСХОД / ВОЗВРАТ РАСХОДА
    if (/НЕОБНУЛЯ|НАРАСТАЮЩ/.test(u)) { nonReset = true; sec = 'skip'; return; }
    if (nonReset) return;   // необнуляемые суммы ККТ — не итоги смены
    var head = /^(?:ИТОГ[О]?\s+|СУММА\s+)?(ВОЗВРАТ\s+ПРИХОДА|ВОЗВРАТ\s+РАСХОДА|ПРИХОД|РАСХОД)(?![А-ЯA-Z])/.exec(u);
    if (head) {
      sec = { 'ПРИХОД': 'income', 'ВОЗВРАТ ПРИХОДА': 'refund', 'РАСХОД': 'expense', 'ВОЗВРАТ РАСХОДА': 'expenseRefund' }[head[1].replace(/\s+/g, ' ')]; secLine = l;
      var a0 = amtEnd(l); if (a0 !== null && !/ЧЕК/.test(u)) put(sec, a0, l);
      return;
    }
    if (/^(?:СЧЕТЧИКИ|ИТОГИ|КОЛ-ВО|ОТЧЕТ|ОТЧЁТ)/.test(u) && !/ЧЕК/.test(u)) return;
    if ((m = /(?:ЧЕКОВ|КОЛ(?:ИЧЕСТВО|-ВО)\s+(?:КАССОВЫХ\s+)?ЧЕКОВ)[^\d\n]{0,30}(\d{1,6})(?!\d)/.exec(u)) && (!sec || sec === 'income')) put('checks', Number(m[1]), l);
    if (!sec || sec === 'skip') return;
    var a = amtEnd(l); if (a === null) return;
    if (/НАЛИЧН/.test(u) && !/БЕЗНАЛ/.test(u)) { if (sec === 'income') put('cash', a, l); return; }
    if (/БЕЗНАЛ|ЭЛЕКТРОН|КАРТ/.test(u)) { if (sec === 'income') put('card', a, l); return; }
    if (/^(?:СУММА|ИТОГ|ВСЕГО|ОБОРОТ)/.test(u)) put(sec, a, secLine + ' / ' + l);
  });
  if (f.income !== undefined && f.refund === undefined) f.refundMissing = true;
  return f;
}
function _v94ZWarn_(f) {
  var w = [];
  if (!f.shift) w.push('номер смены не найден'); if (!f.fn && !f.kktZn) w.push('нет ФН и заводского номера ККТ — повтор отчёта не распознать'); if (!f.fd) w.push('номер фискального документа (ФД) не найден');
  if (f.income === undefined || f.income === null) w.push('сумма прихода не найдена — внесите по отчёту');
  if (f.refundMissing) w.push('возвраты прихода в тексте не найдены — проверьте по отчёту (0, если возвратов не было)');
  if (f.cash !== undefined && f.card !== undefined && f.income !== undefined && Math.abs(f.cash + f.card - f.income) > 0.01) w.push('наличные + безналичные (' + _v92Money_(f.cash + f.card) + ') не равны приходу (' + _v92Money_(f.income) + ') — проверьте');
  return w;
}
function _v94MaskText_(t) { return String(t || '').split(/\r?\n/).map(function (l) { return /кассир|оператор|администратор|ФИО/i.test(l) ? l.replace(/(кассир|оператор|администратор|ФИО)\s*:?.*$/i, '$1: [скрыто]') : l; }).join('\n'); }
/** Сверка с журналом продаж за дату смены: выручка Z (приход − возврат) против суммы продаж журнала. */
function _v94ZRecon_(date, net, tol) {
  var S = _v93Sales_(), all = 0, hall = 0, banq = 0, n = 0;
  S.rows.forEach(function (r) { if (r.day !== date) return; n++; all += r.sum || 0; if (r.ch === 'hall') hall += r.sum || 0; else banq += r.sum || 0; });
  var diff = net === null ? null : Math.round((net - all) * 100) / 100, t = tol === undefined ? 0.01 : tol;
  return { date: date, journalTotal: Math.round(all * 100) / 100, journalHall: Math.round(hall * 100) / 100, journalBanquet: Math.round(banq * 100) / 100, journalRows: n, z: net, diff: diff,
    diffPct: diff !== null && all > 0 ? Math.round(diff / all * 10000) / 100 : null, status: !n ? 'NO_SALES' : diff === null ? 'NO_DATA' : Math.abs(diff) <= t ? 'MATCH' : 'MISMATCH', tolerance: t };
}
function _v94ZTol_() { var n = _v94Num_(PropertiesService.getScriptProperties().getProperty('MC_V94_Z_TOL')); return n === null || n < 0 ? 0.01 : n; }
function _v94ZCan_(s) { return { upload: _mcRbHasExact_(s, 'cash_view|finance_edit'), annul: _mcRbHasExact_(s, 'finance_edit'), money: _mcRbHasExact_(s, 'cash_view|finance_view|revenue_view|finance_edit') }; }
function _v94ZView_(r, money) {
  var f = {}, rc = null; try { f = JSON.parse(String(r['Распознано (JSON)'] || '{}')); } catch (e) {} try { rc = JSON.parse(String(r['Сверка (JSON)'] || 'null')); } catch (e) {}
  var m = function (k) { return money ? (r[k] === '' ? null : Number(r[k])) : null; };
  return { id: String(r.ZID), date: _v93Iso_(r['Дата смены']), closedAt: String(r['Закрыта'] || ''), shift: String(r['Смена №'] || ''), kktRn: String(r['РН ККТ'] || ''), kktZn: String(r['ЗН ККТ'] || ''), fn: String(r['ФН'] || ''),
    fd: String(r['ФД'] || ''), fp: String(r['ФП'] || ''), inn: String(r['ИНН'] || ''), checks: r['Чеков'] === '' ? null : Number(r['Чеков']), income: m('Приход'), cash: m('Наличными'), card: m('Безналичными'), refund: m('Возврат прихода'),
    expense: m('Расход'), expenseRefund: m('Возврат расхода'), net: m('Выручка'), source: String(r['Источник'] || ''), fileName: String(r['Файл'] || ''), sha: String(r['SHA-256'] || '').slice(0, 16), status: String(r['Статус']),
    statusRu: MC_V94_ZST_RU_[r['Статус']] || r['Статус'], by: String(r['Записал'] || r['Создал'] || ''), recon: rc && !money ? { status: rc.status, journalRows: rc.journalRows } : rc, fields: money ? f : { src: {} },
    warnings: String(r['Статус']) === 'DRAFT' ? _v94ZWarn_(f) : [], annulReason: String(r['Причина аннулирования'] || '') };
}
function v94KktData(token) {
  var op = null; try { op = _beginOp_(token, 'cash_view|finance_view|finance_edit|revenue_view', 'V94_KKT_VIEW', 'Касса', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var s = op.session, can = _v94ZCan_(s), R = _v94ZRows_(), p = PropertiesService.getScriptProperties();
    var drafts = R.filter(function (r) { return r['Статус'] === 'DRAFT'; }).reverse().map(function (r) { return _v94ZView_(r, can.money); });
    var posted = R.filter(function (r) { return r['Статус'] === 'POSTED' || r['Статус'] === 'ANNULLED'; }).reverse().slice(0, 60).map(function (r) { return _v94ZView_(r, can.money); });
    var y = _v89AddDays_(_v71Day_(new Date()), -1);
    _endOp_(op);
    return _ok_({ can: can, drafts: drafts, posted: posted, ocr: !!(p.getProperty('YANDEX_API_KEY') && p.getProperty('YANDEX_FOLDER_ID')), tolerance: _v94ZTol_(), yesterday: y,
      yesterdayLoaded: R.some(function (r) { return r['Статус'] === 'POSTED' && _v93Iso_(r['Дата смены']) === y; }),
      note: 'MON CHEF не является кассой: чеки не пробивает, Z-отчёт хранится как документ и сверяется с журналом продаж; финансовых проводок нет.' }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Разобрать Z-отчёт: {data: dataURL снимка/PDF, fileName} или {text} или {manual: true} → черновик. */
function v94ZParse(json, token) {
  var op = null; try { op = _beginOp_(token, 'cash_view|finance_edit', 'V94_Z_PARSE', 'Касса', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (op.session.dev) return _v94Fail_(op, 'FORBIDDEN', 'Технический доступ записей не делает');
    var d = _v94J_(json), text = '', file = null, sha = '', src = 'MANUAL';
    if (d.data) {
      var F = _v94File_(d.data); if (F.error) return _v94Fail_(op, 'VALIDATION', F.error);
      var dup = _v94ZRows_().filter(function (r) { return String(r['SHA-256']) === F.sha && /POSTED|DRAFT/.test(r['Статус']); })[0];
      if (dup) return _v94Fail_(op, 'DUPLICATE', 'Этот файл уже загружен: Z-отчёт ' + dup.ZID + ' (' + (MC_V94_ZST_RU_[dup['Статус']] || dup['Статус']) + ')');
      var o = _v94Ocr_(d.data); if (o.error) return _v94Fail_(op, 'STATE', o.error);
      text = o.text; src = 'PHOTO'; sha = F.sha;
      file = _mcFolder_('reports', true).createFile(Utilities.newBlob(F.bytes, F.mime, 'Z-отчёт — ' + (_v94S_(d.fileName) || Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH-mm'))));
    } else if (d.text) { text = String(d.text).slice(0, 20000); src = 'TEXT'; }
    else if (d.manual !== true) return _v94Fail_(op, 'VALIDATION', 'Выберите снимок или PDF Z-отчёта, вставьте текст или нажмите «Заполнить вручную»');
    var f = text ? _v94ZParse_(text) : { src: {} }; f.source = src; f.text = _v94MaskText_(text).slice(0, 4000);
    var date = f.closedAt ? f.closedAt.slice(0, 10) : '';
    if (date && f.closedAt && Number(f.closedAt.slice(11, 13)) < 6) { f.dateHint = 'смена закрыта после полуночи — дата смены, вероятно, ' + _v93Dmy_(_v89AddDays_(date, -1)) + '; проверьте'; }
    var id = _v76Id_('ZR'), who = _v93Who_(op), c = _v92Cfg_();
    _withLock_(function () {
      _v93Write_(MC_V94_Z_, MC_V94_Z_HEAD_, { ZID: id, 'Дата смены': date ? "'" + date : '', 'Закрыта': f.closedAt || '', 'Смена №': f.shift || '', 'РН ККТ': f.kktRn || '', 'ЗН ККТ': f.kktZn || '', 'ФН': f.fn || '', 'ФД': f.fd || '',
        'ФП': f.fp || '', 'ИНН': f.inn || '', 'Чеков': f.checks === undefined ? '' : f.checks, 'Приход': f.income === undefined ? '' : f.income, 'Наличными': f.cash === undefined ? '' : f.cash, 'Безналичными': f.card === undefined ? '' : f.card,
        'Возврат прихода': f.refund === undefined ? '' : f.refund, 'Расход': f.expense === undefined ? '' : f.expense, 'Возврат расхода': f.expenseRefund === undefined ? '' : f.expenseRefund, LocationID: c.LocationID || '',
        'Источник': src, 'Файл': file ? file.getName() : '', FileID: file ? file.getId() : '', 'SHA-256': sha, 'Распознано (JSON)': JSON.stringify(f), 'Статус': 'DRAFT', 'Создал': who, 'Создано': new Date(), OperationID: op.id });
    });
    _audit_(op, 'V94_Z_PARSE', MC_V94_Z_, id, null, { источник: src, файл: file ? file.getId() : '', смена: f.shift || '', фд: f.fd || '' });
    _endOp_(op); return _ok_({ id: id, fields: f, warnings: _v94ZWarn_(f), fileId: file ? file.getId() : '' }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Записать проверенный Z-отчёт и сверить с журналом продаж. */
function v94ZPost(json, token) {
  var op = null; try { op = _beginOp_(token, 'cash_view|finance_edit', 'V94_Z_POST', 'Касса', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (op.session.dev) return _v94Fail_(op, 'FORBIDDEN', 'Технический доступ записей не делает');
    var d = _v94J_(json), x = _v94ZRows_().filter(function (r) { return String(r.ZID) === String(d.id || ''); })[0];
    if (!x) return _v94Fail_(op, 'NOT_FOUND', 'Черновик Z-отчёта не найден');
    if (x['Статус'] !== 'DRAFT') return _v94Fail_(op, 'VALIDATION', 'Z-отчёт уже ' + (MC_V94_ZST_RU_[x['Статус']] || x['Статус']));
    var date = String(d.date || ''), today = _v71Day_(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return _v94Fail_(op, 'VALIDATION', 'Дата смены — по отчёту, не позже сегодняшней');
    var shift = _v94S_(d.shift), fn = _v94S_(d.fn).replace(/\s/g, ''), zn = _v94S_(d.kktZn).replace(/\s/g, ''), fd = _v94S_(d.fd).replace(/\s/g, '');
    if (!/^\d{1,6}$/.test(shift)) return _v94Fail_(op, 'VALIDATION', 'Укажите номер смены по отчёту');
    if (!fn && !zn) return _v94Fail_(op, 'VALIDATION', 'Укажите ФН или заводской номер ККТ по отчёту — без них повторную загрузку не распознать');
    if (fn && !/^\d{16}$/.test(fn)) return _v94Fail_(op, 'VALIDATION', 'Номер ФН — 16 цифр');
    var num = function (k, req) { var v = _v94Num_(d[k]); if (v === null) return req ? NaN : null; return v; };
    var income = num('income', true), refund = num('refund'), cash = num('cash'), card = num('card'), expense = num('expense'), expRef = num('expenseRefund'), checks = num('checks');
    if (!(income >= 0)) return _v94Fail_(op, 'VALIDATION', 'Укажите сумму прихода по отчёту (число ≥ 0)');
    if ([refund, cash, card, expense, expRef].some(function (v) { return v !== null && !(v >= 0); })) return _v94Fail_(op, 'VALIDATION', 'Суммы — числа ≥ 0');
    if (refund === null) return _v94Fail_(op, 'VALIDATION', 'Укажите возврат прихода по отчёту (0, если возвратов не было)');
    if (d.confirm !== true) return _v94Fail_(op, 'VALIDATION', 'Подтвердите, что сверили поля с Z-отчётом');
    var same = _v94ZRows_().filter(function (r) { return r['Статус'] === 'POSTED' && ((fn && fd && String(r['ФН']) === fn && String(r['ФД']) === fd) || ((zn || fn) && String(r['Смена №']) === shift && (String(r['ЗН ККТ']) === zn || String(r['ФН']) === fn))); })[0];
    if (same) return _v94Fail_(op, 'DUPLICATE', 'Этот Z-отчёт уже записан: ' + same.ZID + ' (смена № ' + same['Смена №'] + ', ' + _v93Dmy_(_v93Iso_(same['Дата смены'])) + ')');
    var net = Math.round((income - refund) * 100) / 100, rc = _v94ZRecon_(date, net, _v94ZTol_()), who = _v93Who_(op), F = {}; try { F = JSON.parse(String(x['Распознано (JSON)'] || '{}')); } catch (e) {}
    var warn = []; if (cash !== null && card !== null && Math.abs(cash + card - income) > 0.01) warn.push('наличные + безналичные не равны приходу');
    return _withLock_(function () {
      var o = x; o['Дата смены'] = "'" + date; o['Смена №'] = shift; o['РН ККТ'] = _v94S_(d.kktRn).replace(/\s/g, ''); o['ЗН ККТ'] = zn; o['ФН'] = fn; o['ФД'] = fd; o['ФП'] = _v94S_(d.fp).replace(/\s/g, ''); o['ИНН'] = _v94S_(d.inn);
      o['Закрыта'] = _v94S_(d.closedAt) || x['Закрыта']; o['Чеков'] = checks === null ? '' : checks; o['Приход'] = income; o['Наличными'] = cash === null ? '' : cash; o['Безналичными'] = card === null ? '' : card;
      o['Возврат прихода'] = refund; o['Расход'] = expense === null ? '' : expense; o['Возврат расхода'] = expRef === null ? '' : expRef; o['Выручка'] = net; o['Сверка (JSON)'] = JSON.stringify(rc);
      o['Статус'] = 'POSTED'; o['Записал'] = who; o['Записано'] = new Date(); o.OperationID = op.id;
      _v93Write_(MC_V94_Z_, MC_V94_Z_HEAD_, o);
      try { PropertiesService.getScriptProperties().setProperty('MC_V94_KKT_ON', '1'); } catch (e) {}
      if (x.FileID) try { DriveApp.getFileById(String(x.FileID)).setName('Z-отчёт смена № ' + shift + ' от ' + _v93Dmy_(date)); } catch (e) {}
      var changed = ['shift', 'fn', 'fd', 'income', 'refund'].filter(function (k) { return F[k] !== undefined && String(F[k]) !== String({ shift: shift, fn: fn, fd: fd, income: income, refund: refund }[k]); });
      _audit_(op, 'V94_Z_POST', MC_V94_Z_, String(x.ZID), { распознано: { смена: F.shift, приход: F.income, возврат: F.refund } }, { дата: date, смена: shift, фн: fn, фд: fd, выручка: net, сверка: rc.status, расхождение: rc.diff, исправлено_человеком: changed });
      _endOp_(op);
      return _ok_({ id: String(x.ZID), net: net, recon: rc, warnings: warn, note: rc.status === 'MISMATCH' ? 'Расхождение с журналом продаж: ' + _v92Money_(rc.diff) + ' — проверьте продажи за ' + _v93Dmy_(date) + ' (не внесены, внесены дважды, отменены в кассе).' : '' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v94ZCancel(json, token) {
  var op = null; try { op = _beginOp_(token, 'cash_view|finance_edit', 'V94_Z_CANCEL', 'Касса', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v94J_(json), x = _v94ZRows_().filter(function (r) { return String(r.ZID) === String(d.id || ''); })[0];
    if (!x) return _v94Fail_(op, 'NOT_FOUND', 'Черновик не найден');
    if (x['Статус'] !== 'DRAFT') return _v94Fail_(op, 'VALIDATION', 'Отменить можно черновик; записанный отчёт аннулирует бухгалтер с причиной');
    return _withLock_(function () { x['Статус'] = 'CANCELLED'; x.OperationID = op.id; _v93Write_(MC_V94_Z_, MC_V94_Z_HEAD_, x); _audit_(op, 'V94_Z_CANCEL', MC_V94_Z_, String(x.ZID), 'DRAFT', 'CANCELLED'); _endOp_(op); return _ok_({ id: String(x.ZID), status: 'CANCELLED' }, op.id); });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Аннулировать записанный Z-отчёт (загружен не тот отчёт): только бухгалтер / директор, с причиной. Запись остаётся в истории. */
function v94ZAnnul(json, token) {
  var op = null; try { op = _beginOp_(token, 'finance_edit', 'V94_Z_ANNUL', 'Касса', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v94J_(json), why = _v94S_(d.reason), x = _v94ZRows_().filter(function (r) { return String(r.ZID) === String(d.id || ''); })[0];
    if (!x) return _v94Fail_(op, 'NOT_FOUND', 'Z-отчёт не найден');
    if (x['Статус'] !== 'POSTED') return _v94Fail_(op, 'VALIDATION', 'Аннулировать можно записанный отчёт');
    if (why.length < 5) return _v94Fail_(op, 'VALIDATION', 'Укажите причину (например, «загружен отчёт другой кассы»)');
    return _withLock_(function () { x['Статус'] = 'ANNULLED'; x['Причина аннулирования'] = why + ' — ' + _v93Who_(op); x.OperationID = op.id; _v93Write_(MC_V94_Z_, MC_V94_Z_HEAD_, x);
      _audit_(op, 'V94_Z_ANNUL', MC_V94_Z_, String(x.ZID), 'POSTED', { status: 'ANNULLED', reason: why }); _endOp_(op); return _ok_({ id: String(x.ZID), status: 'ANNULLED' }, op.id); });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v94ZFor_(date) { return _v94ZRows_().filter(function (r) { return r['Статус'] === 'POSTED' && _v93Iso_(r['Дата смены']) === date; }); }
function _v94KktOn_() { try { return PropertiesService.getScriptProperties().getProperty('MC_V94_KKT_ON') === '1'; } catch (e) { return false; } }

/* ======================= БАКТЕРИЦИДНЫЕ ЛАМПЫ: ПАСПОРТ ======================= */
function _v94LpRows_() { return _v92Rows_(MC_V94_LP_); }
/** Разбор паспорта облучателя. Только найденное в тексте; ресурс — со строкой паспорта. */
function _v94LampParse_(text) {
  var L = String(text || '').split(/\r?\n/).map(_v94S_).filter(String), f = { src: {} }, put = function (k, v, line) { if (v === null || v === undefined || v === '' || f[k] !== undefined) return; f[k] = v; f.src[k] = line; };
  var lifeCand = [];
  L.forEach(function (l) {
    var u = l.toUpperCase().replace(/Ё/g, 'Е'), m;
    if ((m = /(?:МОДЕЛЬ|МАРКА|ТИП ИЗДЕЛИЯ|НАИМЕНОВАНИЕ ИЗДЕЛИЯ)\s*:?\s*(.{3,60})/i.exec(l))) put('model', _v94S_(m[1]).replace(/[«»"]/g, ''), l);
    if ((m = /(?:^|[^А-ЯЁA-Z0-9])((?:ОБН|ОБРН|ОРУБ|ОБП|ОРБ|ОБР|РБ|СИБЭСТ|ДЕЗАР|АРМЕД|КРИСТАЛЛ|ТИОН)[-\s]?\d[0-9A-ZА-ЯЁ.,×х-]*)/i.exec(l))) put('model', _v94S_(m[1]).replace(/[,.]$/, ''), l);   // марка и цифра: «ОБРН-2х15», не слово «Обрабатываемая»
    if ((m = /(?:ИЗГОТОВИТЕЛЬ|ПРОИЗВОДИТЕЛЬ)\s*:?\s*(.{3,80})/i.exec(l))) put('manufacturer', _v94S_(m[1]), l);
    if ((m = /(?:ЗАВОДСКОЙ|СЕРИЙНЫЙ)\s*(?:НОМЕР|№|N)\s*:?\s*([0-9A-ZА-Я][0-9A-ZА-Я\-\/]{1,20})/.exec(u))) put('serial', m[1], l);
    if ((m = /ДАТА\s+(?:ВЫПУСКА|ИЗГОТОВЛЕНИЯ)\s*:?\s*(\d{2}[.\/]\d{2}[.\/]\d{4}|\d{2}[.\/]\d{4}|[А-Я]+\s+\d{4})/.exec(u))) put('made', m[1], l);
    if ((m = /(?:^|[^А-ЯЁA-Z0-9])((?:TUV|ДБ|ДКБ|ДРБ|HNS)[\s-]?\d{1,3}\s*(?:W|ВТ)?)/i.exec(l)) && /ЛАМП/.test(u)) put('lampType', _v94S_(m[1]), l);
    if ((m = /(?:КОЛИЧЕСТВО|ЧИСЛО)\s+ЛАМП[^\d]{0,15}(\d{1,2})\b/.exec(u))) put('lampCount', Number(m[1]), l);
    if ((m = /(\d{1,2})\s*[XХ×]\s*(\d{1,3})\s*ВТ/.exec(u))) { put('lampCount', Number(m[1]), l); put('lampPower', Number(m[2]), l); }
    if ((m = /МОЩНОСТЬ\s+(?:ЛАМПЫ|ЛАМП)[^\d]{0,20}(\d{1,3}(?:[.,]\d)?)\s*ВТ/.exec(u))) put('lampPower', Number(m[1].replace(',', '.')), l);
    if ((m = /ПРОИЗВОДИТЕЛЬНОСТЬ[^\d]{0,30}(\d{1,4}(?:[.,]\d)?)\s*М\s*(?:3|³|КУБ)/.exec(u))) put('productivity', m[1].replace('.', ',') + ' м³/ч', l);
    if ((m = /(?:ВРЕМЯ\s+ОБЛУЧЕНИЯ|РЕЖИМ\s+РАБОТЫ|ПРОДОЛЖИТЕЛЬНОСТЬ\s+(?:ОБЛУЧЕНИЯ|РАБОТЫ))\s*:?\s*(.{3,80})/i.exec(l))) put('regime', _v94S_(m[1]), l);
    if ((m = /(?:СРОК\s+СЛУЖБЫ|РЕСУРС|НАРАБОТКА)[^\d]{0,60}?(\d[\d\s]{2,6})\s*(?:Ч(?![А-ЯЁ])|ЧАС)/.exec(u))) lifeCand.push({ v: Number(m[1].replace(/\s/g, '')), line: l, lamp: /ЛАМП/.test(u) });
  });
  // тип изделия — по заголовку паспорта (первые строки), а не по общему тексту инструкции
  var title = L.slice(0, 6).join(' ').toUpperCase().replace(/Ё/g, 'Е');
  if (/РЕЦИРКУЛЯТОР/.test(title)) put('kind', 'рециркулятор (облучатель закрытого типа)', L.slice(0, 6).join(' '));
  else if (/ОБЛУЧАТЕЛ/.test(title)) put('kind', /ЗАКРЫТОГО/.test(title) ? 'облучатель закрытого типа' : /КОМБИНИРОВАНН/.test(title) ? 'облучатель комбинированного типа' : 'облучатель открытого типа', L.slice(0, 6).join(' '));
  else if (/ЛАМП/.test(title)) put('kind', 'бактерицидная лампа (паспорт лампы)', L.slice(0, 6).join(' '));
  var mm = /(?:СЕРИИ|СЕРИЯ)\s+([A-ZА-Я0-9][A-ZА-Я0-9-]{1,20})/i.exec(L.join('\n')); if (mm) f.series = mm[1];
  var T = _v94LampTable_(L);
  if (T.models.length > 1) {
    f.models = T.models; f.tableNote = T.note;
    var lifes = T.models.map(function (m) { return m.life; }).filter(function (x) { return x > 0; });
    if (lifes.length === T.models.length && lifes.every(function (x) { return x === lifes[0]; })) { f.life = lifes[0]; f.src.life = T.lifeLine + ' — таблица «Технические характеристики», одинаково для всех ' + T.models.length + ' моделей'; }
    else if (lifes.length) f.lifeByModel = true;
    if (!f.model && f.series) f.model = 'серия ' + f.series + ' — выберите модель из таблицы';
  }
  if (f.life === undefined) {
    var lc = lifeCand.filter(function (c) { return c.lamp; })[0] || (lifeCand.length === 1 ? lifeCand[0] : null);
    if (lc && lc.v > 0) { f.life = lc.v; f.src.life = lc.line; }
    else if (lifeCand.length > 1) f.lifeAmbiguous = lifeCand.map(function (c) { return c.line; });
  }
  return f;
}
/** Таблица моделей в паспорте серии («Технические характеристики»): коды моделей (в том числе разорванные на две строки)
 *  и строки значений по столбцам — срок службы, мощность, площадь, сеанс, тип лампы. Значения — только из текста. */
function _v94LampTable_(L) {
  var tok = function (l) { return String(l).split(/[\s|\[\]{}]+/).filter(String); }, code = /^[A-ZА-ЯЁ0-9]{2,}(?:-[A-ZА-ЯЁ0-9]*){2,}$/i, tail = /^[A-ZА-ЯЁ0-9]{1,6}-[A-ZА-ЯЁ0-9]{1,6}$/i;
  var models = [], at = -1;
  for (var i = 0; i < L.length && !models.length; i++) {
    var t = tok(L[i]).filter(function (x) { return code.test(x); }); if (t.length < 2) continue;
    if (t.every(function (x) { return /-$/.test(x); }) && i + 1 < L.length) { var u = tok(L[i + 1]).filter(function (x) { return tail.test(x); }); if (u.length === t.length) { models = t.map(function (x, j) { return x + u[j]; }); at = i + 1; continue; } }
    models = t.map(function (x) { return x.replace(/-$/, ''); }); at = i;
  }
  var N = models.length, out = { models: [], note: '', lifeLine: '' }; if (N < 2) return out;
  var num = function (x) { var m = /^[<>]?(-?\d+(?:[.,]\d+)?)$/.exec(x); return m ? Number(m[1].replace(',', '.')) : null; };
  var nums = function (l) { return tok(l).map(num).filter(function (x) { return x !== null; }); };
  var M = models.map(function (c) { return { code: c }; });
  var setRow = function (key, vals, line) { if (vals.length < N) return; vals = vals.slice(-N); M.forEach(function (m, j) { if (m[key] === undefined) m[key] = vals[j]; }); if (key === 'life' && !out.lifeLine) out.lifeLine = line; };
  for (var k = at + 1; k < L.length; k++) {
    var l = L[k], v = nums(l), prev = k > 0 && nums(L[k - 1]).length < 2 ? L[k - 1] : '', next = k + 1 < L.length && nums(L[k + 1]).length < 2 ? L[k + 1] : '';
    var kw = /СРОК\s+СЛУЖБЫ|РЕСУРС|ИЗЛУЧЕНИ|ПОТРЕБЛЯЕМ|МОЩНОСТ|ПЛОЩАД|СЕАНС|МИНУТ/, u = (l + ' ' + prev).toUpperCase(); if (!kw.test(u)) u = (l + ' ' + prev + ' ' + next).toUpperCase();
    if (/ТИП\s+ЛАМП/.test(l.toUpperCase())) { var ty = tok(l).filter(function (x) { return /^[TТ]\d{1,2}$/i.test(x); }).map(function (x) { return x.replace(/^Т/i, 'T'); }); if (ty.length >= N) M.forEach(function (m, j) { m.lampType = ty.slice(-N)[j]; }); continue; }
    if (v.length >= N) {
      if (/СРОК\s+СЛУЖБЫ|РЕСУРС/.test(u)) setRow('life', v, l);
      else if (/ИЗЛУЧЕНИ/.test(u) && /МОЩНОСТ/.test(u)) setRow('uvc', v, l);
      else if (/ПОТРЕБЛЯЕМ|МОЩНОСТ/.test(u)) setRow('power', v, l);
      else if (/СЕАНС|МИНУТ/.test(u)) setRow('session', v, l);
      else if (/ПЛОЩАД/.test(u)) setRow('area', v, l);
    } else if (!v.length && /СРОК\s+СЛУЖБЫ/.test(l.toUpperCase())) {   // значения по одной ячейке в строке
      var col = []; for (var q = k + 1; q < L.length && col.length < N; q++) { var w = nums(L[q]); if (w.length === 1 && tok(L[q]).length === 1) col.push(w[0]); else break; }
      if (col.length === N) setRow('life', col, l);
    }
  }
  out.models = M; out.note = 'таблица моделей: ' + N + ' (' + models.slice(0, 3).join(', ') + (N > 3 ? ', …' : '') + ')';
  return out;
}
function _v94LampWarn_(f) {
  var w = [];
  if (!f.life) w.push(f.lifeByModel ? 'срок службы различается по моделям — выберите модель из таблицы паспорта' : f.lifeAmbiguous ? 'в паспорте несколько сроков (' + f.lifeAmbiguous.length + ') — выберите ресурс именно лампы' : 'ресурс (срок службы) лампы в тексте не найден — внесите по паспорту');
  if (f.models && f.models.length > 1) w.push('паспорт серии: ' + f.models.length + ' моделей — выберите вашу модель (код на лампе или упаковке)');
  else if (!f.model) w.push('модель не найдена');
  if (!f.serial) w.push('заводской номер в паспорте не найден — у ламп его часто нет; дата производства — на корпусе лампы');
  return w;
}
function _v94LampCan_(s) { return !!s && !s.dev && _mcRbHasExact_(s, 'journals|haccp'); }
/** Реестр ламп с отметкой паспорта: ресурс подтверждён, если есть подтверждённый паспорт этой установки. */
function _v94LampState_() {
  var P = {}; _v94LpRows_().forEach(function (p) { if (p['Статус'] === 'CONFIRMED') P[String(p['Установка'])] = p; });
  var sh = _book_().getSheetByName('Лампы_Регламент'), reg = [];
  if (sh && sh.getLastRow() > 1) { var v = sh.getDataRange().getValues(); for (var i = 1; i < v.length; i++) if (v[i][0]) reg.push({ name: String(v[i][0]), daily: Number(v[i][1]) || 0, life: Number(v[i][2]) || 0, active: v[i][3] !== false }); }
  return reg.map(function (l) { var p = P[l.name]; return { name: l.name, life: l.life, active: l.active, passportId: p ? String(p.PassportID) : '', passportLife: p ? Number(p['Ресурс лампы, ч']) : null,
    confirmed: !!(p && Number(p['Ресурс лампы, ч']) === l.life), note: p ? (Number(p['Ресурс лампы, ч']) === l.life ? 'по паспорту ' + p.PassportID : 'ресурс в реестре отличается от паспорта') : 'не подтверждён паспортом' }; });
}
function v94LampData(token) {
  var op = null; try { op = _beginOp_(token, 'journals|haccp|haccp_view|sanitation', 'V94_LAMP_VIEW', 'Санитария', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var s = op.session, R = _v94LpRows_(), p = PropertiesService.getScriptProperties();
    var view = function (r) { var f = {}; try { f = JSON.parse(String(r['Распознано (JSON)'] || '{}')); } catch (e) {}
      return { id: String(r.PassportID), lamp: String(r['Установка'] || ''), room: String(r['Помещение'] || ''), model: String(r['Модель'] || ''), manufacturer: String(r['Изготовитель'] || ''), serial: String(r['Заводской №'] || ''),
        made: String(r['Дата выпуска'] || ''), kind: String(r['Тип установки'] || ''), lampType: String(r['Тип ламп'] || ''), lampCount: r['Ламп в установке'] === '' ? null : Number(r['Ламп в установке']),
        lampPower: r['Мощность лампы, Вт'] === '' ? null : Number(r['Мощность лампы, Вт']), life: r['Ресурс лампы, ч'] === '' ? null : Number(r['Ресурс лампы, ч']), lifeQuote: String(r['Строка паспорта о ресурсе'] || ''),
        productivity: String(r['Производительность'] || ''), regime: String(r['Режим облучения'] || ''), source: String(r['Источник'] || ''), fileName: String(r['Файл'] || ''), status: String(r['Статус']),
        by: String(r['Подтвердил'] || r['Создал'] || ''), fields: f, warnings: r['Статус'] === 'DRAFT' ? _v94LampWarn_(f) : [] }; };
    var sens = _v92Rows_(MC_V94_SN_).map(function (r) { return { id: String(r.SensorID), objectId: String(r.ObjectID), object: String(r['Объект контроля']), type: String(r['Тип датчика']), model: String(r['Модель']), serial: String(r['Серийный №']),
      status: String(r['Статус']), statusRu: 'не подключён — показания вручную', comment: String(r['Комментарий'] || '') }; });
    var objs = []; try { var ov = _book_().getSheetByName(MC_T_OBJ_SHEET_); if (ov && ov.getLastRow() > 1) objs = ov.getDataRange().getValues().slice(1).filter(function (r) { return r[0] && String(r[7] || 'ACTIVE') !== 'ARCHIVED'; }).map(function (r) { return { id: String(r[0]), name: String(r[2]), type: String(r[1]) }; }); } catch (e) {}
    _endOp_(op);
    return _ok_({ can: _v94LampCan_(s), drafts: R.filter(function (r) { return r['Статус'] === 'DRAFT'; }).reverse().map(view), passports: R.filter(function (r) { return r['Статус'] === 'CONFIRMED'; }).reverse().map(view),
      lamps: _v94LampState_(), sensors: sens, objects: objs, sensorMsg: MC_V94_SENSOR_MSG_, ocr: !!(p.getProperty('YANDEX_API_KEY') && p.getProperty('YANDEX_FOLDER_ID')) }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v94LampParse(json, token) {
  var op = null; try { op = _beginOp_(token, 'journals|haccp', 'V94_LAMP_PARSE', 'Санитария', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_v94LampCan_(op.session)) return _v94Fail_(op, 'FORBIDDEN', 'Технический доступ записей не делает');
    var d = _v94J_(json), text = '', file = null, sha = '', src = 'MANUAL';
    if (d.data) {
      var F = _v94File_(d.data); if (F.error) return _v94Fail_(op, 'VALIDATION', F.error);
      var dup = _v94LpRows_().filter(function (r) { return String(r['SHA-256']) === F.sha && /DRAFT|CONFIRMED/.test(r['Статус']); })[0];
      if (dup) return _v94Fail_(op, 'DUPLICATE', 'Этот паспорт уже загружен: ' + dup.PassportID + (dup['Установка'] ? ' («' + dup['Установка'] + '»)' : ''));
      var o = _v94Ocr_(d.data); if (o.error) return _v94Fail_(op, 'STATE', o.error);
      text = o.text; src = 'PHOTO'; sha = F.sha;
      file = _mcFolder_('company', true).createFile(Utilities.newBlob(F.bytes, F.mime, 'Паспорт облучателя — ' + (_v94S_(d.fileName) || Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH-mm'))));
    } else if (d.text) { text = String(d.text).slice(0, 30000); src = 'TEXT'; }
    else if (d.manual !== true) return _v94Fail_(op, 'VALIDATION', 'Выберите снимок или PDF паспорта, вставьте текст или нажмите «Заполнить вручную»');
    var f = text ? _v94LampParse_(text) : { src: {} }; f.source = src; f.text = text.slice(0, 6000);
    var id = _v76Id_('LPP'), who = _v93Who_(op);
    _withLock_(function () {
      _v93Write_(MC_V94_LP_, MC_V94_LP_HEAD_, { PassportID: id, 'Установка': _v94S_(d.lamp), 'Модель': f.model || '', 'Изготовитель': f.manufacturer || '', 'Заводской №': f.serial || '', 'Дата выпуска': f.made || '', 'Тип установки': f.kind || '',
        'Тип ламп': f.lampType || '', 'Ламп в установке': f.lampCount || '', 'Мощность лампы, Вт': f.lampPower || '', 'Ресурс лампы, ч': f.life || '', 'Строка паспорта о ресурсе': f.src.life || '', 'Производительность': f.productivity || '',
        'Режим облучения': f.regime || '', 'Источник': src, 'Файл': file ? file.getName() : '', FileID: file ? file.getId() : '', 'SHA-256': sha, 'Распознано (JSON)': JSON.stringify(f), 'Статус': 'DRAFT', 'Создал': who, 'Создано': new Date(), OperationID: op.id });
    });
    _audit_(op, 'V94_LAMP_PARSE', MC_V94_LP_, id, null, { источник: src, модель: f.model || '', ресурс: f.life || '', файл: file ? file.getId() : '' });
    _endOp_(op); return _ok_({ id: id, fields: f, warnings: _v94LampWarn_(f) }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Подтвердить паспорт: ресурс лампы в реестре — по паспорту. */
function v94LampConfirm(json, token) {
  var op = null; try { op = _beginOp_(token, 'journals|haccp', 'V94_LAMP_CONFIRM', 'Санитария', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_v94LampCan_(op.session)) return _v94Fail_(op, 'FORBIDDEN', 'Технический доступ записей не делает');
    var d = _v94J_(json), x = _v94LpRows_().filter(function (r) { return String(r.PassportID) === String(d.id || ''); })[0];
    if (!x) return _v94Fail_(op, 'NOT_FOUND', 'Черновик паспорта не найден');
    if (x['Статус'] !== 'DRAFT') return _v94Fail_(op, 'VALIDATION', 'Паспорт уже ' + (x['Статус'] === 'CONFIRMED' ? 'подтверждён' : 'отменён'));
    var lamp = _v94S_(d.lamp), life = _v94Num_(d.life), model = _v94S_(d.model), quote = _v94S_(d.lifeQuote), F = {}; try { F = JSON.parse(String(x['Распознано (JSON)'] || '{}')); } catch (e) {}
    // паспорт серии: модель выбирается из таблицы; пустые поля — из её столбца
    var pick = (F.models || []).filter(function (m) { return String(m.code) === String(d.modelCode || ''); })[0];
    if ((F.models || []).length > 1 && !pick && (!model || /выберите модель/i.test(model))) return _v94Fail_(op, 'VALIDATION', 'Паспорт серии: выберите модель из таблицы паспорта (код на лампе или упаковке)');
    if (pick) { if (!model || /выберите модель/i.test(model)) model = String(pick.code); if (life === null && pick.life) life = pick.life; if (!quote && F.src && F.src.life) quote = String(F.src.life).replace(/ — таблица.*$/, '') + ' — таблица «Технические характеристики», модель ' + pick.code;
      if (_v94Num_(d.lampPower) === null && pick.power) d.lampPower = pick.power; if (!_v94S_(d.lampType) && pick.lampType) d.lampType = pick.lampType;
      if (!_v94S_(d.regime) && pick.session) d.regime = 'сеанс ' + pick.session + ' мин' + (pick.area ? ' на площади до ' + pick.area + ' м²' : '') + ' (по паспорту)'; }
    if (lamp.length < 3) return _v94Fail_(op, 'VALIDATION', 'Укажите установку: название и место (например, «Облучатель №1, холодный цех»)');
    if (model.length < 2) return _v94Fail_(op, 'VALIDATION', 'Укажите модель по паспорту');
    if (!(life > 0 && life <= 100000)) return _v94Fail_(op, 'VALIDATION', 'Укажите ресурс (срок службы) лампы в часах по паспорту');
    if (quote.length < 5) return _v94Fail_(op, 'VALIDATION', 'Укажите строку паспорта, где сказано о ресурсе лампы (раздел, пункт или цитата)');
    if (d.confirm !== true) return _v94Fail_(op, 'VALIDATION', 'Подтвердите, что сверили поля с паспортом');
    var other = _v94LpRows_().filter(function (r) { return r['Статус'] === 'CONFIRMED' && String(r['Установка']) === lamp; })[0];
    if (other && !d.replace) return _v94Fail_(op, 'VALIDATION', 'У установки «' + lamp + '» уже есть паспорт ' + other.PassportID + ' — замените его явно («заменить паспорт»)');
    var who = _v93Who_(op), num = function (k) { var v = _v94Num_(d[k]); return v === null ? '' : v; };
    return _withLock_(function () {
      if (other) { other['Статус'] = 'REPLACED'; _v93Write_(MC_V94_LP_, MC_V94_LP_HEAD_, other); }
      var o = x; o['Установка'] = lamp; o['Помещение'] = _v94S_(d.room); o['Модель'] = model; o['Изготовитель'] = _v94S_(d.manufacturer); o['Заводской №'] = _v94S_(d.serial); o['Дата выпуска'] = _v94S_(d.made);
      o['Тип установки'] = _v94S_(d.kind); o['Тип ламп'] = _v94S_(d.lampType); o['Ламп в установке'] = num('lampCount'); o['Мощность лампы, Вт'] = num('lampPower'); o['Ресурс лампы, ч'] = life; o['Строка паспорта о ресурсе'] = quote;
      o['Производительность'] = _v94S_(d.productivity); o['Режим облучения'] = _v94S_(d.regime); o['Статус'] = 'CONFIRMED'; o['Подтвердил'] = who; o['Подтверждено'] = new Date(); o.OperationID = op.id;
      _v93Write_(MC_V94_LP_, MC_V94_LP_HEAD_, o);
      // реестр ламп: ресурс — по паспорту
      var sh = _lampRegimenSheet_(), v = sh.getDataRange().getValues(), row = 0, before = null;
      if (String(v[0][5] || '') !== 'Паспорт (V94)') sh.getRange(1, 6).setValue('Паспорт (V94)');
      for (var i = 1; i < v.length; i++) if (String(v[i][0]) === lamp) { row = i + 1; before = v[i][2]; }
      if (row) { sh.getRange(row, 3).setValue(life); sh.getRange(row, 5).setValue(new Date()); sh.getRange(row, 6).setValue(String(x.PassportID)); }
      else sh.appendRow([lamp, 0, life, true, new Date(), String(x.PassportID)]);
      var changed = ['model', 'serial', 'life'].filter(function (k) { return F[k] !== undefined && String(F[k]) !== String({ model: model, serial: _v94S_(d.serial), life: life }[k]); });
      _audit_(op, 'V94_LAMP_CONFIRM', MC_V94_LP_, String(x.PassportID), { ресурс_в_реестре: before, распознано: { модель: F.model, ресурс: F.life } }, { установка: lamp, модель: model, ресурс: life, строка: quote, исправлено_человеком: changed });
      _endOp_(op); return _ok_({ id: String(x.PassportID), lamp: lamp, life: life, registry: row ? 'обновлён ресурс' : 'добавлена установка' }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v94LampCancel(json, token) {
  var op = null; try { op = _beginOp_(token, 'journals|haccp', 'V94_LAMP_CANCEL', 'Санитария', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v94J_(json), x = _v94LpRows_().filter(function (r) { return String(r.PassportID) === String(d.id || ''); })[0];
    if (!x) return _v94Fail_(op, 'NOT_FOUND', 'Черновик не найден'); if (x['Статус'] !== 'DRAFT') return _v94Fail_(op, 'VALIDATION', 'Отменить можно черновик');
    return _withLock_(function () { x['Статус'] = 'CANCELLED'; x.OperationID = op.id; _v93Write_(MC_V94_LP_, MC_V94_LP_HEAD_, x); _audit_(op, 'V94_LAMP_CANCEL', MC_V94_LP_, String(x.PassportID), 'DRAFT', 'CANCELLED'); _endOp_(op); return _ok_({ id: String(x.PassportID), status: 'CANCELLED' }, op.id); });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
// экран «Бактерицидные лампы»: у каждой лампы — источник ресурса (паспорт или «не подтверждён паспортом»)
(function (g) {
  var orig = g.getLampsStatus; if (typeof orig !== 'function') return;
  g.getLampsStatus = function (token) {
    var r = orig.apply(this, arguments), o = typeof r === 'string' ? JSON.parse(r) : r;
    try { if (o && (o.success || o.ok) && Array.isArray(o.data)) { var st = {}; _v94LampState_().forEach(function (l) { st[l.name] = l; }); o.data.forEach(function (l) { var x = st[l.лампа] || {}; l.паспорт = x.passportId || ''; l.ресурс_подтверждён = !!x.confirmed; l.ресурс_источник = x.note || 'не подтверждён паспортом'; }); } } catch (e) {}
    return typeof r === 'string' ? JSON.stringify(o) : o;
  };
})(this);

/* ======================= ДАТЧИКИ ТЕМПЕРАТУРЫ: ЗАГЛУШКА ======================= */
/** Адаптер выгрузки логгеров. Пока нет образца выгрузки — данные не принимаются. */
function _v94SensorAdapter_(payload) { return { status: 'NOT_CONNECTED', message: MC_V94_SENSOR_MSG_, accepted: 0 }; }
function v94SensorSave(json, token) {
  var op = null; try { op = _beginOp_(token, 'haccp|journals', 'V94_SENSOR_SAVE', 'Температуры', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (op.session.dev) return _v94Fail_(op, 'FORBIDDEN', 'Технический доступ записей не делает');
    var d = _v94J_(json), objId = _v94S_(d.objectId), type = _v94S_(d.type), obj = null;
    try { var ov = _book_().getSheetByName(MC_T_OBJ_SHEET_); if (ov) ov.getDataRange().getValues().slice(1).forEach(function (r) { if (String(r[0]) === objId) obj = { id: objId, name: String(r[2]) }; }); } catch (e) {}
    if (!obj) return _v94Fail_(op, 'VALIDATION', 'Выберите объект контроля (холодильник, склад, витрина) — «Температуры → Объекты контроля»');
    if (type.length < 2) return _v94Fail_(op, 'VALIDATION', 'Укажите тип датчика (логгер, Wi-Fi-датчик и т. п.)');
    var id = _v76Id_('SNS');
    return _withLock_(function () {
      _v93Write_(MC_V94_SN_, MC_V94_SN_HEAD_, { SensorID: id, ObjectID: obj.id, 'Объект контроля': obj.name, 'Тип датчика': type, 'Модель': _v94S_(d.model), 'Серийный №': _v94S_(d.serial), 'Статус': 'NOT_CONNECTED',
        'Комментарий': _v94S_(d.comment), 'Добавил': _v93Who_(op), 'Добавлено': new Date(), OperationID: op.id });
      _audit_(op, 'V94_SENSOR_SAVE', MC_V94_SN_, id, null, { объект: obj.name, тип: type });
      _endOp_(op); return _ok_({ id: id, status: 'NOT_CONNECTED', message: MC_V94_SENSOR_MSG_ }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Приём показаний датчиков — заглушка: ничего не записывает, пока адаптер не подключён. */
function v94SensorImport(json, token) {
  var op = null; try { op = _beginOp_(token, 'haccp|journals', 'V94_SENSOR_IMPORT', 'Температуры', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var r = _v94SensorAdapter_(_v94J_(json));
    _audit_(op, 'V94_SENSOR_IMPORT', MC_V94_SN_, '', null, { status: r.status });
    if (r.status !== 'OK') return _v94Fail_(op, 'SENSOR_NOT_CONNECTED', r.message);
    _endOp_(op); return _ok_(r, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ======================= «Моя смена», блок кассы, письма, риски ======================= */
try {
  MC_V87_SOURCES_.push(function (ctx) {
    var s = ctx.s, out = []; if (!s || s.dev) return out;
    var today = _v71Day_(new Date()), y = _v89AddDays_(today, -1), mod = function (m, l) { return _v87ModOk_(s, m) ? { kind: 'open', module: m, label: l } : null; };
    if (_mcRbHasExact_(s, 'cash_view|finance_edit') && _v94KktOn_() && !_v94ZFor_(y).length)
      out.push({ key: 'V94|z|' + y, group: 'now', source: 'Касса', title: 'Загрузить Z-отчёт за ' + _v93Dmy_(y), detail: 'Фото или PDF отчёта о закрытии смены — система распознает поля, вы проверите и запишете; затем сверка с журналом продаж.', who: 'кассир, администратор', act: mod('kkt', 'Касса: Z-отчёты') });
    if (_mcRbHasExact_(s, 'finance_view|finance_edit')) _v94ZRows_().filter(function (r) { var d = _v93Iso_(r['Дата смены']); return r['Статус'] === 'POSTED' && d >= _v89AddDays_(today, -7); }).forEach(function (r) {
      var rc = null; try { rc = JSON.parse(String(r['Сверка (JSON)'] || 'null')); } catch (e) {} if (!rc || rc.status !== 'MISMATCH') return;
      out.push({ key: 'V94|zdiff|' + r.ZID, group: 'now', source: 'Касса', title: 'Z-отчёт и журнал продаж за ' + _v93Dmy_(rc.date) + ' расходятся на ' + _v92Money_(rc.diff), detail: 'Z-отчёт ' + _v92Money_(rc.z) + ', журнал продаж ' + _v92Money_(rc.journalTotal) + ' (' + rc.journalRows + ' строк). Проверьте невнесённые, двойные и отменённые продажи.', who: 'бухгалтер', act: mod('kkt', 'Касса: Z-отчёты') });
    });
    if (_mcRbHasExact_(s, 'journals|haccp') && _book_().getSheetByName('Лампы_Регламент')) {
      var nc = _v94LampState_().filter(function (l) { return l.active && !l.confirmed; });
      if (nc.length) out.push({ key: 'V94|lamp', group: 'later', source: 'Бактерицидные лампы', title: 'Ресурс ламп не подтверждён паспортом: ' + nc.length, detail: nc.slice(0, 4).map(function (l) { return l.name + ' (' + (l.life || '—') + ' ч)'; }).join('; ') + '. Загрузите паспорт облучателя — ресурс возьмётся из паспорта.', who: 'ответственный за ХАССП', act: mod('lampdocs', 'Паспорта ламп') });
    }
    return out;
  });
} catch (e) {}
(function (g) {
  var ob = g._v92Blocks_; if (typeof ob !== 'function') return;
  g._v92Blocks_ = function (s, role, staffed, covers, ctx) {
    var B = ob.apply(this, arguments);
    try {
      var b = B.filter(function (x) { return x.id === 'cash'; })[0]; if (!b) return B;
      var today = _v71Day_(new Date()), Z = _v94ZRows_().filter(function (r) { return r['Статус'] === 'POSTED'; }).sort(function (a, c) { return _v93Iso_(a['Дата смены']) < _v93Iso_(c['Дата смены']) ? 1 : -1; })[0];
      if (!Z) return B;
      var rc = null; try { rc = JSON.parse(String(Z['Сверка (JSON)'] || 'null')); } catch (e) {}
      var money = _mcRbHasExact_(s, 'cash_view|revenue_view|finance_view');
      b.rows = [['Последний Z-отчёт', 'смена № ' + Z['Смена №'] + ' за ' + _v93Dmy_(_v93Iso_(Z['Дата смены'])) + ' (записал ' + (Z['Записал'] || '—') + ')'],
        ['Приход / возврат прихода', money ? _v92Money_(Number(Z['Приход'])) + ' / ' + _v92Money_(Number(Z['Возврат прихода'])) : 'сумма скрыта'],
        ['Наличными / безналичными', money ? (Z['Наличными'] === '' ? '—' : _v92Money_(Number(Z['Наличными']))) + ' / ' + (Z['Безналичными'] === '' ? '—' : _v92Money_(Number(Z['Безналичными']))) : 'сумма скрыта'],
        ['Сверка с журналом продаж', rc ? (rc.status === 'MATCH' ? 'сходится' : rc.status === 'MISMATCH' ? 'расхождение ' + (money ? _v92Money_(rc.diff) : '') : rc.status === 'NO_SALES' ? 'продаж в журнале нет' : 'нет данных') : 'нет данных']];
      b.prio = rc && rc.status === 'MISMATCH' ? 'IMPORTANT' : 'NORMAL'; b.prioRu = MC_V92_PRIO_RU_[b.prio];
      b.notes = ['Z-отчёт — документ ККТ; MON CHEF чеки не пробивает и финансовых проводок по нему не делает.'];
    } catch (e) {}
    return B;
  };
})(this);
(function (g) {
  var orig = g._v89Render_; if (typeof orig !== 'function') return;
  g._v89Render_ = function (D, V, att) {
    var r = orig.apply(this, arguments);
    try {
      if (!V.F) return r;
      var day = D.shift && D.shift.date ? D.shift.date : _v71Day_(new Date()), Z = _v94ZFor_(day).concat(_v94ZFor_(_v89AddDays_(day, -1)))[0]; if (!Z) return r;
      var rc = null; try { rc = JSON.parse(String(Z['Сверка (JSON)'] || 'null')); } catch (e) {}
      var t = 'Касса (Z-отчёт смены № ' + Z['Смена №'] + ' за ' + _v93Dmy_(_v93Iso_(Z['Дата смены'])) + '): приход ' + _v92Money_(Number(Z['Приход'])) + ', возврат ' + _v92Money_(Number(Z['Возврат прихода'])) + ', выручка ' + _v92Money_(Number(Z['Выручка'])) +
        (rc ? '; сверка с журналом продаж — ' + (rc.status === 'MATCH' ? 'сходится' : rc.status === 'MISMATCH' ? 'расхождение ' + _v92Money_(rc.diff) : 'нет данных') : '');
      var i = r.html.lastIndexOf('</div>'), h = '<p style="margin:3px 0">' + _v89E_(t) + '</p>'; r.html = i >= 0 ? r.html.slice(0, i) + h + r.html.slice(i) : r.html + h; r.text += '\n' + t;
    } catch (e) {}
    return r;
  };
})(this);
