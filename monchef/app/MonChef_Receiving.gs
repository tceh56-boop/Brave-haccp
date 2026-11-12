/**
 * MON CHEF — приёмка товара по накладной и маркировка партий.
 *
 * Порядок на экране «Склад → + Приход»: скан накладной (фото или PDF) → проверка строк →
 * исправление вручную → «Принять» → по каждой строке создаётся партия (в карантин до входного
 * контроля) → печать маркировки: продукт, № партии, дата принятия, годен до, кто принял.
 *
 * «Годен до» — одно из двух:
 *   введено вручную (дата с упаковки производителя) — всегда главнее;
 *   по продуктовой матрице (лист «Продукты_Справочник») — срок для выбранного режима хранения
 *   (холодильник / комнатная / морозильник) от момента приёмки.
 * Текст матрицы свободный («3-5 дней», «48 часов при 0...+4°C», «До 6 месяцев», «заморозка 8 мес.»):
 * из диапазона берётся МЕНЬШЕЕ значение, «Не хранить / Не рекомендуется / Не применимо / Не требуется»
 * и «Бессрочно» дату не дают. Срок до 72 часов включительно печатается с часами.
 * Если нет ни ручной даты, ни срока по матрице — на этикетке «СРОК НЕ УКАЗАН», дата не выдумывается.
 * Просроченный на момент приёмки товар (ручная дата раньше сегодняшней) не принимается.
 *
 * Кто принял — только из сессии (ФИО, должность), не из браузера.
 * Реестр приёмки — лист «Приёмка_Партии»: по нему этикетку можно напечатать повторно.
 */
var MC_RCV_SHEET_ = 'Приёмка_Партии';
// Паспорт партии. Первые 17 колонок — этап 10.3; дальше — накладная, оригинальная этикетка, производитель, вскрытие.
var MC_RCV_HEAD_ = ['BatchID', 'Продукт', 'Кол-во', 'Ед.', 'Поставщик', 'Накладная', 'Принято', 'Годен до', 'Срок с часами',
  'Источник срока', 'Основание срока', 'Принял', 'Должность', 'ID сотрудника', 'OperationID', 'Печатей этикетки', 'Последняя печать',
  'SupplierID', 'DocumentID накладной', 'Дата накладной', 'OriginalLabelID', 'Документ этикетки', 'FileID этикетки', 'Изготовитель',
  'Партия изготовителя', 'GTIN/EAN', 'Дата изготовления', 'Дата упаковки', 'Срок производителя', 'Цена за ед.', 'Стоимость', 'Тип хранения',
  'Хранить', 'Сопоставление', 'ParentBatchID', 'Вскрыто', 'Вскрыл', 'Срок после вскрытия', 'Основание срока после вскрытия',
  'Печатей этикетки вскрытия', 'Обновлено', 'Обновил', 'Все этикетки', 'Упаковок по фото', 'Без маркировки', 'По накладной', 'Расхождение',
  'ВСД', 'VSDID', 'Статус ВСД', 'Дата гашения ВСД', 'Погасил ВСД',
  'Обработка', 'Акт обработки', 'Разморожено', 'Дефрост начат', 'Дефрост до'];
var MC_RCV_C_ = {}; MC_RCV_HEAD_.forEach(function (h, i) { MC_RCV_C_[h] = i; });
var MC_RCV_MODES_ = { fridge: 'холодильник', room: 'комнатная', freezer: 'морозильник' };
var MC_RCV_SHORT_H_ = 72;   // срок до 3 суток включительно — на этикетке дата и время

function _mcRcvSheet_() {
  var sh = _bcSheet_(MC_RCV_SHEET_, MC_RCV_HEAD_);
  if (String(sh.getRange(1, MC_RCV_HEAD_.length).getValue() || '') !== MC_RCV_HEAD_[MC_RCV_HEAD_.length - 1])   // лист этапа 10.3 — дописать новые колонки
    sh.getRange(1, 1, 1, MC_RCV_HEAD_.length).setValues([MC_RCV_HEAD_]);
  return sh;
}
function _mcRcvP2_(n) { return ('0' + n).slice(-2); }
function _mcRcvFmt_(d, withTime) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return _mcRcvP2_(d.getDate()) + '.' + _mcRcvP2_(d.getMonth() + 1) + '.' + d.getFullYear() + (withTime ? ' ' + _mcRcvP2_(d.getHours()) + ':' + _mcRcvP2_(d.getMinutes()) : '');
}

/**
 * Срок из текста матрицы → {n, unit: 'h'|'d'|'mo'|'y', text} | {none: 'причина'} | null.
 * Берётся первая часть до «;» (вторая обычно «после вскрытия»), из диапазона — меньшее число.
 */
function _mcRcvShelf_(text) {
  var raw = String(text === null || text === undefined ? '' : text).trim(), t = raw.toLowerCase().replace(/ё/g, 'е');
  if (!t || /^[-—–]+$/.test(t)) return null;
  if (/^не\s*(хран|рекоменд|примен|треб)/.test(t)) return { none: raw };
  if (/бессроч|неогранич/.test(t)) return { none: raw };
  var first = t.split(';')[0];
  var m = /(\d+(?:[.,]\d+)?)(?:\s*[-–—]\s*\d+(?:[.,]\d+)?)?\s*(минут|мин|час|ч(?![а-я])|сут|дн|ден|день|недел|нед|месяц|мес|год|лет)/.exec(first);
  if (!m) return { none: raw };
  var n = parseFloat(m[1].replace(',', '.')), u = m[2], unit = 'd';
  if (!(n > 0)) return { none: raw };
  if (/^мин/.test(u)) { n = n / 60; unit = 'h'; }
  else if (/^(час|ч)/.test(u)) unit = 'h';
  else if (/^(сут|дн|ден)/.test(u)) unit = 'd';
  else if (/^нед/.test(u)) { n = n * 7; unit = 'd'; }
  else if (/^мес/.test(u)) unit = 'mo';
  else unit = 'y';
  return { n: n, unit: unit, text: raw };
}
/** Дата окончания срока от момента приёмки: часы и дни — точно, месяцы и годы — по календарю. */
function _mcRcvUntil_(from, sh) {
  var d = new Date(from.getTime()), n = sh.n;
  if (sh.unit === 'h') d = new Date(d.getTime() + n * 3600000);
  else if (sh.unit === 'd') { d.setDate(d.getDate() + Math.floor(n)); if (n % 1) d = new Date(d.getTime() + (n % 1) * 86400000); }
  else {
    var months = sh.unit === 'y' ? n * 12 : n, whole = Math.floor(months), day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + whole);   // 31 января + 1 месяц = 28/29 февраля, а не 3 марта
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    if (months % 1) d.setDate(d.getDate() + Math.floor((months % 1) * 30));
  }
  var hours = (d.getTime() - from.getTime()) / 3600000, withTime = hours <= MC_RCV_SHORT_H_ + 0.01;
  if (!withTime) d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return { date: d, withTime: withTime, hours: Math.round(hours) };
}
function _mcRcvIso_(d, withTime) {
  return d.getFullYear() + '-' + _mcRcvP2_(d.getMonth() + 1) + '-' + _mcRcvP2_(d.getDate()) + (withTime ? 'T' + _mcRcvP2_(d.getHours()) + ':' + _mcRcvP2_(d.getMinutes()) : '');
}
/** Режим хранения по умолчанию: заморозка — по названию/условиям; сухое/тёмное место — комнатная; иначе холодильник. */
function _mcRcvDefaultMode_(storage, name, modes) {
  var s = (String(storage || '') + ' ' + String(name || '')).toLowerCase().replace(/ё/g, 'е');
  var has = function (k) { return modes[k] && modes[k].until; };
  if (/заморож|морожен|морозил|-\s*18|с\/м|(^|[\s(])зам(\.|\s|$)/.test(s) && has('freezer')) return 'freezer';
  if (/сух|комнат|темн|прохладн/.test(s) && !/холодил|0\.\.\.|\+\s*\d/.test(s) && has('room')) return 'room';
  if (has('fridge')) return 'fridge';
  if (has('room')) return 'room';
  if (has('freezer')) return 'freezer';
  return '';
}

/** Индекс матрицы на одно выполнение. */
var _MC_RCV_DB_ = null;
function _mcRcvDb_() {
  if (_MC_RCV_DB_) return _MC_RCV_DB_;
  var db = (typeof _buildProductDbIndex_ === 'function') ? _buildProductDbIndex_() : null;
  var byName = {};
  if (db) db.entries.forEach(function (e) { byName[String(e.name).trim().toLowerCase()] = e; });
  _MC_RCV_DB_ = { db: db, byName: byName };
  return _MC_RCV_DB_;
}
/** Найти продукт матрицы: точное название → сопоставление ТТК (в т.ч. ручное) → по словам. */
// Слова обработки: «Огурцы» ≠ «Огурцы консервированные». Общий разбор названий (КБЖУ) эти слова отбрасывает —
// для срока годности это недопустимо: у свежих огурцов неделя, у консервированных — годы.
var MC_RCV_PROC_ = /(консерв|марин|солен|солён|квашен|копчен|сушен|сушён|вялен|вялен|заморож|морожен|пюре|паст[аы]|соус|сок[иа]?(?![а-я])|в томате|в масле|сироп|джем|варень|цукат|чипс|хлопь|порошк|сублим)/i;
var MC_RCV_SYN_ = { 'томат': 'помидор', 'томаты': 'помидор', 'черри': 'помидор', 'огурцы': 'огурец', 'груши': 'груша', 'яблоки': 'яблоко', 'морковка': 'морковь', 'лук': 'лук' };
/** Слова обработки должны совпадать в обе стороны: в накладной «солёные» — и в матрице солёные (или консервы). */
function _mcRcvProcOk_(query, entryName) {
  var re = new RegExp(MC_RCV_PROC_.source, 'gi'), a = (String(entryName || '').match(re) || []).map(function (w) { return w.toLowerCase().slice(0, 5); }),
    b = (String(query || '').match(new RegExp(MC_RCV_PROC_.source, 'gi')) || []).map(function (w) { return w.toLowerCase().slice(0, 5); });
  return a.every(function (w) { return b.indexOf(w) >= 0; }) && b.every(function (w) { return a.indexOf(w) >= 0; });
}
/** Запасной поиск: корни слов (4 буквы) и синонимы; без слов обработки, которых нет в накладной. */
function _mcRcvLooseMatch_(name, x) {
  var stem = function (w) { w = MC_RCV_SYN_[w] || w; return w.slice(0, 4); };
  var q = String(name || '').toLowerCase().replace(/ё/g, 'е').split(/[^а-яa-z]+/).filter(function (w) { return w.length >= 3 && !/^(свеж|охла|зам|кг|шт|вес|фас|упак|сорт|кат|пр)$/.test(w.slice(0, 4)); }).map(stem);
  if (!q.length) return null;
  var best = null, bestS = 0;
  x.db.entries.forEach(function (e) {
    if (!_mcRcvProcOk_(name, e.name)) return;
    var t = String(e.name).toLowerCase().replace(/ё/g, 'е').split(/[^а-яa-z]+/).filter(function (w) { return w.length >= 3; }).map(stem);
    if (!t.length) return;
    var hit = q.filter(function (w) { return t.indexOf(w) >= 0; }).length; if (!hit || t.indexOf(q[0]) < 0) return;   // главное слово (первое) обязательно
    var sc = hit / q.length + 0.5 * hit / t.length;
    if (sc > bestS + 1e-9 || (Math.abs(sc - bestS) < 1e-9 && best && e.name.length < best.name.length)) { best = e; bestS = sc; }
  });
  return best && bestS >= 0.75 ? { e: best, method: 'по словам — проверьте' } : null;
}
function _mcRcvMatch_(name, x) {
  var k = String(name || '').trim().toLowerCase();
  if (!k || !x.db) return null;
  if (x.byName[k]) return { e: x.byName[k], method: 'точно' };
  try {
    var mm = (typeof _loadTtkMatchMap_ === 'function') ? _loadTtkMatchMap_()[k] : null;
    if (mm && mm.matchedName && x.byName[String(mm.matchedName).trim().toLowerCase()] && _mcRcvProcOk_(name, mm.matchedName))
      return { e: x.byName[String(mm.matchedName).trim().toLowerCase()], method: 'сопоставление ТТК' + (mm.method === 'ручное' ? ' (ручное)' : '') };
  } catch (e) {}
  var m = _matchProductForIngredient_(name, x.db);
  if (m.entry && _mcRcvProcOk_(name, m.entry.name)) return { e: m.entry, method: m.method };
  return _mcRcvLooseMatch_(name, x);
}
/** Развесной товар без маркировки производителя: овощи, фрукты, ягоды, зелень, грибы (по типу продукта в матрице). */
function _mcRcvProduce_(e) { return !!e && /овощ|фрукт|ягод|зелень|трав|гриб|корнеплод|бахч|цитрус/i.test(String(e.type || '')) && !MC_RCV_PROC_.test(String(e.type || '') + ' ' + e.name); }
/** Подсказка срока для одной строки накладной на момент from. */
function _mcRcvSuggestOne_(name, from, x) {
  var out = { name: String(name || ''), found: false, matched: '', method: '', storage: '', modes: {}, mode: '' };
  var hit = _mcRcvMatch_(name, x);
  if (!hit) return out;
  var e = hit.e;
  out.found = true; out.matched = e.name; out.method = hit.method; out.storage = String(e.storage || ''); out.ptype = String(e.type || ''); out.produce = _mcRcvProduce_(e);
  [['fridge', e.shelfFridge], ['room', e.shelfRoom], ['freezer', e.shelfFreezer]].forEach(function (p) {
    var sh = _mcRcvShelf_(p[1]);
    if (!sh) return;
    if (sh.none) { out.modes[p[0]] = { text: sh.none, until: '' }; return; }
    var u = _mcRcvUntil_(from, sh);
    out.modes[p[0]] = { text: sh.text, until: _mcRcvIso_(u.date, u.withTime), label: _mcRcvFmt_(u.date, u.withTime), withTime: u.withTime, hours: u.hours };
  });
  out.mode = _mcRcvDefaultMode_(out.storage, name, out.modes);
  return out;
}

/** Подсказка «годен до» по матрице для строк накладной. names — JSON-массив названий. */
function stockReceiveSuggest(namesJson, token) {
  try {
    _requireAuth_(token, 'stock');
    var names = typeof namesJson === 'string' ? JSON.parse(namesJson || '[]') : (namesJson || []);
    var x = _mcRcvDb_(), now = new Date();
    if (!x.db) return _ok_({ matrix: false, items: names.map(function (n) { return { name: n, found: false, modes: {}, mode: '' }; }),
      note: 'Лист «' + PRODUCTS_DB_SHEET + '» не найден — срок только вручную' });
    var vetOn = _sdVetOn_(), mc = _mvCfg_();
    return _ok_({ matrix: true, now: _mcRcvIso_(now, true), mercury: { configured: mc.ready }, items: names.slice(0, 200).map(function (n) { var o = _mcRcvSuggestOne_(n, now, x); o.vet = vetOn && _sdVetControlled_('', n); return o; }) });
  } catch (e) { return _failFrom_(e); }
}

/* ===================== Этап 10.4: накладная + оригинальная этикетка → партия ===================== */
/*
 * Реестр распознаваний — лист «OCR_Этикетки» (этикетки и накладные): CaptureID, исходный файл на Диске (SHA-256),
 * полный текст и разобранные поля, статус. Файл сохраняется ДО распознавания: оригинал есть, даже если OCR не сработал.
 * Партия создаётся только после проверки человеком: строки накладной и данные этикетки подтверждаются на экране.
 */
var MC_RCV_LEVELS_ = [[0.90, 'AUTO_ACCEPT'], [0.75, 'REVIEW'], [0, 'MANUAL_CONFIRMATION']];
function _mcRcvLevel_(c) { c = Number(c) || 0; for (var i = 0; i < MC_RCV_LEVELS_.length; i++) if (c >= MC_RCV_LEVELS_[i][0]) return MC_RCV_LEVELS_[i][1]; return 'MANUAL_CONFIRMATION'; }
function _mcRcvCapSheet_() {
  var sh = _labelOcrSheet_();
  if (String(sh.getRange(1, 15).getValue() || '') !== 'Тип') sh.getRange(1, 15, 1, 4).setValues([['Тип', 'FileID', 'Hash', 'BatchID']]);
  return sh;
}
function _mcRcvCapture_(id) {
  if (!id) return null;
  var v = _mcRcvCapSheet_().getDataRange().getValues();
  for (var i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === String(id)) {
    var d = {}; try { d = JSON.parse(v[i][11] || '{}'); } catch (e) {}
    return { row: i + 1, id: String(v[i][0]), status: String(v[i][10] || ''), data: d, type: String(v[i][14] || 'LABEL'), fileId: String(v[i][15] || ''), hash: String(v[i][16] || ''), batchId: String(v[i][17] || '') };
  }
  return null;
}
function _mcRcvCapId_() { var d = new Date(); return 'CAP-' + d.getFullYear() + _mcRcvP2_(d.getMonth() + 1) + _mcRcvP2_(d.getDate()) + '-' + Utilities.getUuid().slice(0, 8); }
function _mcRcvUnit_(u) {
  var x = String(u || '').toLowerCase().replace(/\./g, '').trim();
  if (/^(кг|kg|килограмм)/.test(x)) return 'кг'; if (/^(г|гр|грамм|g)$/.test(x)) return 'г'; if (/^(л|l|литр)/.test(x)) return 'л'; if (/^(мл|ml)/.test(x)) return 'мл';
  if (/^(шт|штук|ед|упак|уп|pcs)/.test(x)) return 'шт'; return x || 'кг';
}
/** Накладная уже принята? Поиск по поставщику и номеру в паспортах партий. */
function _mcRcvAcceptedInvoice_(supplier, docNo) {
  var C = MC_RCV_C_, sup = _mdNorm_(supplier).replace(/\s*\(.*\)\s*$/, ''), num = String(docNo || '').trim().toLowerCase(), out = null;
  if (!num) return null;
  _mcRcvSheet_().getDataRange().getValues().forEach(function (r, i) {
    if (!i || !r[0] || String(r[C['Накладная']]).trim().toLowerCase() !== num || _mdNorm_(r[C['Поставщик']]).replace(/\s*\(.*\)\s*$/, '') !== sup) return;
    out = out || { documentId: String(r[C['DocumentID накладной']] || ''), batches: [], acceptedAt: _mcRcvFmt_(r[C['Принято']] instanceof Date ? r[C['Принято']] : new Date(r[C['Принято']]), true), by: r[C['Принял']] };
    if (!out.documentId && r[C['DocumentID накладной']]) out.documentId = String(r[C['DocumentID накладной']]);
    out.batches.push(String(r[0]) + ' ' + r[C['Продукт']]);
  });
  return out;
}

/** Скан накладной: оригинал сохраняется, OCR V12 (с проверкой повторной накладной), ответ в одном формате для экрана. */
/* Скан накладной — один лист (фото) или PDF. Оригинал сохраняется как снят (dataUrl); на распознавание может уйти
   подготовленная копия ocrUrl (лист выпрямлен и очищен на телефоне). Несколько листов одной накладной склеивает экран
   приёмки, при сохранении все листы привязываются к документу (meta.invoiceCaptureIds).
   Этап 10.8 (скан пачкой): распознавание идёт вне общей блокировки — 5–15 с OCR не задерживают запись у других сотрудников;
   под блокировкой только строки листов. */
function stockReceiveScanInvoice(dataUrl, token, ocrUrl) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'INVOICE_SCAN', 'Приёмка', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var capId = _mcRcvCapId_(), file = _sdFile_(dataUrl, 'Накладная ' + capId), who = _author_(op).фио;
    if (!file) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Файл не распознан: нужен JPEG, PNG или PDF', op.id); }
    var useProc = /^data:image\/(jpeg|png|webp);base64,/.test(String(ocrUrl || '')) && String(ocrUrl).length < 12e6;
    var one = function (u) { try { var raw = scanInvoiceV12(u, '', capId); return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return { error: 'exception', body: String(e) }; } };
    var d = one(useProc ? ocrUrl : dataUrl), err = '', retried = false;
    // по выпрямленной копии ничего не нашлось — повтор по исходному фото (выпрямление могло обрезать лист)
    if (useProc && (!d || (d.error && d.error !== 'no-key') || !(d.items || []).length)) { var d2 = one(dataUrl); if (d2 && !d2.error && (d2.items || []).length) { d = d2; retried = true; } }
    if (!d || d.error) err = err || (d && d.error === 'no-key' ? 'нужны ключи Yandex Cloud в свойствах скрипта (YANDEX_API_KEY, YANDEX_FOLDER_ID)' : 'распознавание не удалось: ' + ((d && (d.body || d.error)) || ''));
    var out = { captureId: capId, fileSaved: true, fileHash: file.hash, ocrError: err, supplier: '', supplierId: '', supplierStatus: '', number: '', date: '', total: null, items: [], warnings: [], confidence: 0, level: 'MANUAL_CONFIRMATION' };
    if (!err) {
      var sup = d.supplier ? _mdResolveSupplier_(d.supplier, false) : null;
      out.supplier = sup ? sup.name : String(d.supplier || ''); out.supplierId = sup ? sup.id : ''; out.supplierStatus = sup ? sup.status : (d.supplier ? 'NEW' : '');
      out.number = String(d.document_number || ''); out.date = String(d.document_date || ''); out.total = d.total; out.warnings = (d.warnings || []).slice(0, 20);
      out.confidence = Number(d.recognition_confidence) || 0; out.level = _mcRcvLevel_(out.confidence);
      out.items = (d.items || []).map(function (it) {
        var m = it.matched_product, conf = Number(it.confidence) || 0;
        return { name: m && Number(m.confidence) >= 0.75 ? String(m.name) : String(it.normalized_name || it.raw_name || ''), rawName: String(it.raw_name || ''),
          qty: it.quantity, unit: _mcRcvUnit_(it.unit), price: it.price, sum: it.sum, vat: it.vat, batchNumber: it.batch_number || '', expiry: it.expiry_date || '',
          article: it.article || '', confidence: conf, level: _mcRcvLevel_(conf), review: !!it.requires_manual_review || _mcRcvLevel_(conf) !== 'AUTO_ACCEPT', mismatch: !!it.calculation_mismatch };
      });
      out.seenBefore = !!(d.duplicate && d.duplicate.duplicate);
    }
    var acc = out.supplier && out.number ? _mcRcvAcceptedInvoice_(out.supplier, out.number) : null;
    out.accepted = acc;   // накладная уже принята — повторно партии не создаются (§38)
    out.ocrPrepared = useProc && !retried; out.ocrRetriedRaw = retried;
    _withLock_(function () {
      _mcRcvCapSheet_().appendRow([capId, op.id, new Date(), who, 'Накладная ' + (out.number || '') + ' ' + (out.supplier || ''), '', out.confidence, '', '', '',
        err ? 'Ошибка OCR' : 'Распознано', JSON.stringify(out), '', '', 'INVOICE', file.fileId, file.hash, '']);
    });
    _audit_(op, 'INVOICE_SCAN', 'Приёмка', capId, null, { file: file.hash, supplier: out.supplier, number: out.number, items: out.items.length, error: err, accepted: !!acc });
    _endOp_(op);
    return _ok_(out, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Оценка распознавания этикетки 0..1 по критическим полям (§36). */
function _mcRcvLabelScore_(p) {
  var w = 0;
  if (p.name) w += 0.2; if (p.expiration_date) w += 0.25; if (p.manufactured_date) w += 0.1; if (p.manufacturer) w += 0.1;
  if (p.storage_temperature_max !== '' && p.storage_temperature_max !== null) w += 0.1; if (p.net_weight_kg !== '' && p.net_weight_kg !== null) w += 0.15; if (p.supplier_batch) w += 0.1;
  if (p.dates_guessed) w -= 0.15; if (p.barcode && !p.barcode_valid) w -= 0.05;
  if ((p.warnings || []).some(function (x) { return /перепутаны/.test(x); })) w -= 0.3;
  return Math.max(0, Math.min(1, Math.round(w * 100) / 100));
}
function _mcRcvNameScore_(a, b) {
  var x = _nutriNormalize_(a), y = _nutriNormalize_(b); if (!x.length || !y.length) return 0;
  var sy = {}; y.forEach(function (t) { sy[t] = 1; }); var inter = x.filter(function (t) { return sy[t]; }).length;
  return inter / Math.min(x.length, y.length);
}
/** Сопоставление этикетки со строкой накладной (§9): MATCHED / REVIEW_REQUIRED / CONFLICT. hard — то, что принять нельзя. */
function _mcRcvMatchLabel_(p, line, now) {
  now = now || new Date(); line = line || {};
  var today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), checks = [], hard = [], conflicts = [], review = [];
  var add = function (field, state, note) { checks.push({ field: field, state: state, note: note }); if (state === 'hard') { hard.push(note); conflicts.push(note); } else if (state === 'conflict') conflicts.push(note); else if (state === 'review') review.push(note); };
  var dt = function (iso) { return iso ? _parseDate_(iso) : null; }, fmt = function (iso) { var d = dt(iso); return d ? _mcRcvFmt_(d) : String(iso || ''); };
  var norm = function (x) { return String(x || '').toUpperCase().replace(/[\s.\-]/g, ''); };
  var idMatch = false;
  if (line.article && p.article) { if (norm(line.article) === norm(p.article)) { add('Артикул', 'ok', p.article); idMatch = true; } else add('Артикул', 'conflict', 'артикул в накладной ' + line.article + ', на этикетке ' + p.article); }
  if (line.barcode && p.barcode) { if (norm(line.barcode) === norm(p.barcode)) { add('Штрихкод', 'ok', p.barcode); idMatch = true; } else add('Штрихкод', 'conflict', 'штрихкод в накладной ' + line.barcode + ', на этикетке ' + p.barcode); }
  if (line.name) {
    var cands = [p.name].concat(p.name_candidates || []).concat(p.matched_product ? [p.matched_product.name] : []).filter(Boolean), best = 0, bestName = '';
    cands.forEach(function (c) { var sc = _mcRcvNameScore_(line.name, c); if (sc > best) { best = sc; bestName = c; } });
    if (best >= 0.3) add('Наименование', 'ok', '«' + line.name + '» ↔ «' + bestName + '»' + (best < 0.5 ? ' (совпало главное слово)' : ''));
    else if (idMatch) add('Наименование', 'ok', 'совпал ' + (line.article ? 'артикул' : 'штрихкод'));
    else add('Наименование', 'review', 'в накладной «' + line.name + '», на этикетке «' + (p.name || '?') + '» — тот ли это товар?');
  }
  if (p.manufacturer) add('Изготовитель', line.manufacturer && _mcRcvNameScore_(line.manufacturer, p.manufacturer) < 0.5 ? 'conflict' : 'ok', p.manufacturer + (line.manufacturer ? ' / в накладной: ' + line.manufacturer : ''));
  else add('Изготовитель', 'review', 'изготовитель на этикетке не найден');
  if (line.batchNumber && p.supplier_batch) add('Партия производителя', norm(line.batchNumber) === norm(p.supplier_batch) ? 'ok' : 'conflict', 'в накладной ' + line.batchNumber + ', на этикетке ' + p.supplier_batch);
  else add('Партия производителя', p.supplier_batch ? 'ok' : 'info', p.supplier_batch || 'на этикетке не указана');
  var unit = _mcRcvUnit_(line.unit), q = parseFloat(String(line.qty || '').replace(',', '.'));
  if (p.net_weight_kg !== '' && p.net_weight_kg !== null && q > 0 && (unit === 'кг' || unit === 'г')) {
    var qKg = unit === 'г' ? q / 1000 : q;
    add('Масса', qKg + 1e-6 < Number(p.net_weight_kg) * 0.98 ? 'conflict' : 'ok', 'на этикетке нетто ' + p.net_weight_kg + ' кг, в накладной ' + q + ' ' + unit + (qKg >= Number(p.net_weight_kg) * 0.98 && Math.abs(qKg - p.net_weight_kg) > 0.01 ? ' (несколько упаковок)' : ''));
  }
  var exp = dt(p.expiration_date), mfg = dt(p.manufactured_date);
  if (!exp) add('Годен до', 'review', p.expiration_date_suggested ? 'на этикетке нет «годен до»; по сроку годности получается ' + fmt(p.expiration_date_suggested) + ' — подтвердите' : 'срок годности на этикетке не найден — введите вручную');
  else if (exp < today0) add('Годен до', 'hard', 'срок годности истёк ' + fmt(p.expiration_date) + ' — такой товар не принимается (возврат поставщику)');
  else add('Годен до', 'ok', fmt(p.expiration_date));
  if (line.expiry && exp && norm(line.expiry) !== norm(p.expiration_date)) add('Годен до (накладная)', 'conflict', 'в накладной ' + fmt(line.expiry) + ', на этикетке ' + fmt(p.expiration_date));
  if (mfg && mfg > now) add('Дата изготовления', 'hard', 'дата изготовления ' + fmt(p.manufactured_date) + ' в будущем — прочитана неверно');
  if (exp && mfg && exp <= mfg) add('Даты', 'hard', 'срок годности не позже даты изготовления — даты перепутаны или прочитаны неверно');
  if (exp && mfg && p.shelf_life !== '' && p.shelf_life_unit) {
    var calc = dt(_lblAddShelf_(p.manufactured_date, p.shelf_life, p.shelf_life_unit));
    if (calc && Math.abs(calc - exp) > 2 * 86400000) add('Срок годности', 'review', 'по сроку «' + p.shelf_life_raw.replace(/\s+/g, ' ') + '» от ' + fmt(p.manufactured_date) + ' получается ' + _mcRcvFmt_(calc) + ', а на этикетке ' + fmt(p.expiration_date));
    else if (calc) add('Срок годности', 'ok', p.shelf_life_raw.replace(/\s+/g, ' ') + ' от ' + fmt(p.manufactured_date) + ' = ' + _mcRcvFmt_(calc));
  }
  if (p.storage_temperature_max === '' || p.storage_temperature_max === null) add('Условия хранения', 'review', 'температура хранения на этикетке не найдена');
  else add('Условия хранения', 'ok', _mcBlRange_(p.storage_temperature_min === '' ? null : p.storage_temperature_min, p.storage_temperature_max));
  if (p.barcode && !p.barcode_valid) add('Штрихкод', 'review', 'контрольная цифра штрихкода ' + p.barcode + ' не сходится — проверьте цифры');
  var level = _mcRcvLevel_(_mcRcvLabelScore_(p));
  return { status: conflicts.length ? 'CONFLICT' : (review.length || level !== 'AUTO_ACCEPT') ? 'REVIEW_REQUIRED' : 'MATCHED', checks: checks, hard: hard, conflicts: conflicts, review: review, level: level, score: _mcRcvLabelScore_(p) };
}
/** Та же этикетка уже принималась (GTIN + партия производителя + срок + поставщик) — §39. */
function _mcRcvLabelDuplicate_(p, supplier) {
  if (!p.barcode && !p.supplier_batch) return null;
  var C = MC_RCV_C_, sup = _mdNorm_(supplier || ''), hit = null, exp = p.expiration_date ? _parseDate_(p.expiration_date) : null;
  _mcRcvSheet_().getDataRange().getValues().forEach(function (r, i) {
    if (!i || hit) return;
    var e = r[C['Срок производителя']] ? _parseDate_(r[C['Срок производителя']]) : null;
    if (String(r[C['GTIN/EAN']] || '') === String(p.barcode || '') && String(r[C['Партия изготовителя']] || '') === String(p.supplier_batch || '') &&
        ((!e && !exp) || (e && exp && e.getTime() === exp.getTime())) && (!sup || _mdNorm_(r[C['Поставщик']]) === sup)) hit = { batchId: String(r[0]), product: r[C['Продукт']], acceptedAt: _mcRcvFmt_(r[C['Принято']] instanceof Date ? r[C['Принято']] : new Date(r[C['Принято']]), true) };
  });
  return hit;
}
/** Разобрать этикетку: Vision → поля → сопоставление с номенклатурой (общая часть с recognizeProductLabel). */
function _mcRcvParseLabel_(text) {
  var p = _parseLabelText_(text), best = null, alts = [];
  try {
    (p.name_candidates.length ? p.name_candidates : [p.name]).slice(0, 6).forEach(function (cand) {
      var r = _matchNomenclature_(cand, 3);
      if (r.matched && (!best || r.matched.confidence > best.confidence)) { best = r.matched; best.from_line = cand; alts = r.alternatives; }
    });
  } catch (e) {}
  p.matched_product = best; p.alternative_matches = alts;
  return p;
}
/** Скан оригинальной этикетки для строки накладной: фото сохраняется без изменений, OCR, сопоставление. */
function stockReceiveScanLabel(dataUrl, lineJson, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'LABEL_SCAN', 'Приёмка', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var line = typeof lineJson === 'string' ? JSON.parse(lineJson || '{}') : (lineJson || {});
    var capId = _mcRcvCapId_(), file = _sdFile_(dataUrl, 'Этикетка производителя ' + capId), who = _author_(op).фио;
    if (!file) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Файл не распознан: нужно фото JPEG/PNG или PDF', op.id); }
    var vis = _yandexVisionRecognize_(dataUrl), out = { labelId: capId, fileSaved: true, fileHash: file.hash, ocrError: '' };
    if (vis.error) {
      out.ocrError = vis.error === 'no-key' ? 'нужны ключи Yandex Cloud в свойствах скрипта' : 'этикетка не распознана (' + vis.error + ') — фото сохранено, данные введите вручную';
      out.fields = null; out.match = { status: 'REVIEW_REQUIRED', checks: [], hard: [], conflicts: [], review: ['этикетка не распознана — проверьте и введите данные вручную'], level: 'MANUAL_CONFIRMATION', score: 0 };
    } else {
      var lines = _visionBlockLines_(vis.ann); if (!lines.length) lines = String(vis.fullText || '').split('\n');
      var p = _mcRcvParseLabel_(lines.join('\n'));
      out.fields = p; out.match = _mcRcvMatchLabel_(p, line); out.duplicateOf = _mcRcvLabelDuplicate_(p, line.supplier || '');
      if (out.duplicateOf) out.match.review.push('такая этикетка (штрихкод, партия производителя, срок) уже принималась: ' + out.duplicateOf.batchId + ' ' + out.duplicateOf.acceptedAt);
    }
    var f = out.fields || {};
    _withLock_(function () {
      _mcRcvCapSheet_().appendRow([capId, op.id, new Date(), who, f.name || '', f.matched_product ? f.matched_product.name : '', out.match.score, f.expiration_date || '', f.manufactured_date || '',
        f.completeness || '', out.ocrError ? 'Ошибка OCR' : 'Требует проверки', JSON.stringify(out.fields || { raw_text: '', ocrError: out.ocrError }), '', '', 'LABEL', file.fileId, file.hash, '']);
    });
    _audit_(op, 'LABEL_SCAN', 'Приёмка', capId, null, { file: file.hash, line: line.name || '', match: out.match.status, expiry: f.expiration_date || '', error: out.ocrError });
    _endOp_(op);
    return _ok_(out, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Фото товара или тары при приёмке (развес без маркировки): сохраняется как доказательство, без распознавания. */
function stockReceivePhoto(dataUrl, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'RECEIVE_PHOTO', 'Приёмка', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var capId = _mcRcvCapId_(), file = _sdFile_(dataUrl, 'Фото товара при приёмке ' + capId);
    if (!file) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Файл не распознан: нужно фото JPEG/PNG', op.id); }
    var fio = _author_(op).фио;
    _withLock_(function () { _mcRcvCapSheet_().appendRow([capId, op.id, new Date(), fio, 'Фото товара', '', '', '', '', '', 'Фото', JSON.stringify({ raw_text: '' }), '', '', 'PHOTO', file.fileId, file.hash, '']); });
    _audit_(op, 'RECEIVE_PHOTO', 'Приёмка', capId, null, { file: file.hash });
    _endOp_(op);
    return _ok_({ photoId: capId, fileHash: file.hash }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function scanProductLabel(dataUrl, lineJson, token) { return stockReceiveScanLabel(dataUrl, lineJson, token); }

/**
 * Создать партии по проверенной накладной (§51): одна операция, одна блокировка.
 * itemsJson: [{name, qty, unit, price, sum, sumAck, expiry (ручная дата), mode (матрица), labelId, label {поправленные поля},
 *              labelConfirmed, conflictReason, location}]
 * metaJson: {docDate, invoiceCaptureId, invoiceCaptureIds (все листы накладной), dupReason}
 * Сначала проверяется всё, потом пишется. Если запись оборвалась — уже созданные партии сторнируются (§47).
 */
function stockReceiveSave(itemsJson, supplier, docNo, metaJson, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'STOCK_RECEIVE', 'Приёмка по накладной', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var items = typeof itemsJson === 'string' ? JSON.parse(itemsJson || '[]') : (itemsJson || []), meta = typeof metaJson === 'string' ? JSON.parse(metaJson || '{}') : (metaJson || {});
    supplier = String(supplier || '').trim(); docNo = String(docNo || '').trim();
    if (!supplier) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите поставщика', op.id); }
    if (!docNo) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите номер накладной', op.id); }
    items = (Array.isArray(items) ? items : []).filter(function (it) { return it && String(it.name || '').trim() && parseFloat(it.qty) > 0; });
    if (!items.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Нет строк с товаром и количеством', op.id); }
    var docDate = meta.docDate ? _parseDate_(meta.docDate) : null;
    if (meta.docDate && !docDate) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Дата накладной не распознана', op.id); }
    var acc = _mcRcvAcceptedInvoice_(supplier, docNo);
    if (acc && !String(meta.dupReason || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('DUPLICATE', 'Накладная № ' + docNo + ' от «' + supplier + '» уже принята ' + acc.acceptedAt + ' (' + acc.by + '): ' + acc.batches.join(', ') + '. Повторно партии не создаются.', op.id); }
    // листы накладной (этап 10.8: несколько фото одной накладной) — первый лист главный, остальные только типа INVOICE
    var capIds = [meta.invoiceCaptureId].concat(Array.isArray(meta.invoiceCaptureIds) ? meta.invoiceCaptureIds : []).map(function (x) { return String(x || ''); })
      .filter(function (x, i, a) { return x && a.indexOf(x) === i; }).slice(0, 30);
    var invCaps = capIds.map(_mcRcvCapture_).filter(function (c, i) { return c && (i === 0 || c.type === 'INVOICE'); }), invCap = invCaps[0] || null;
    var now = new Date(), today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), x = null, bad = [];
    // Строка накладной может состоять из нескольких упаковок: по фото каждой этикетки упаковки группируются по сроку,
    // дате изготовления, партии и изготовителю. Одна группа — одна партия на всё количество строки; несколько групп —
    // отдельная партия на каждую, количество строки распределяется между ними (сумма должна сойтись).
    var parts = [];
    items.forEach(function (it, i) {
      var name = String(it.name).trim(), tag = 'строка ' + (i + 1) + ' «' + name + '»: ', unit = _mcRcvUnit_(it.unit), qty = parseFloat(it.qty);
      var list = Array.isArray(it.labels) ? it.labels : (it.labelId ? [{ labelId: it.labelId, ov: it.label || {} }] : []), labs = [], seen = {};
      list.forEach(function (L, j) {
        var cap = _mcRcvCapture_(L.labelId), lt = tag + 'этикетка ' + (j + 1) + ': ';
        if (seen[L.labelId]) return; seen[L.labelId] = 1;
        if (!cap || cap.type !== 'LABEL') { bad.push(lt + 'фото не найдено'); return; }
        if (cap.status === 'Проведено') { bad.push(lt + 'уже привязана к партии ' + cap.batchId); return; }
        var f = JSON.parse(JSON.stringify(cap.data || {})), ov = L.ov || {};
        ['expiration_date', 'manufactured_date', 'packaging_date', 'supplier_batch', 'manufacturer', 'barcode', 'name', 'article'].forEach(function (k) { if (ov[k] !== undefined && ov[k] !== null) f[k] = String(ov[k]).trim(); });
        ['storage_temperature_min', 'storage_temperature_max', 'net_weight_kg'].forEach(function (k) { if (ov[k] !== undefined && ov[k] !== '' && ov[k] !== null) f[k] = Number(ov[k]); });
        if (ov.storage_temperature_max !== undefined && ov.storage_temperature_max !== '') f.storage_mode = Number(ov.storage_temperature_max) <= -12 ? 'FROZEN' : Number(ov.storage_temperature_max) <= 8 ? 'CHILLED' : 'ROOM';
        f.barcode_valid = f.barcode ? _lblBarcodeValid_(f.barcode) : false;
        var m = _mcRcvMatchLabel_(f, { name: name, qty: qty, unit: unit, article: it.article, barcode: it.barcode, batchNumber: it.batchNumber, expiry: it.lineExpiry, manufacturer: it.manufacturer }, now);
        if (m.hard.length) bad.push(lt + m.hard.join('; '));
        else if (m.conflicts.length && !String(it.conflictReason || '').trim()) bad.push(lt + 'данные этикетки и накладной расходятся: ' + m.conflicts.join('; ') + ' — исправьте или укажите причину');
        labs.push({ cap: cap, f: f, m: m, key: _mcRcvPackKey_(f) });
      });
      if (labs.length && !it.labelConfirmed) bad.push(tag + 'подтвердите данные этикеток (продукт, количество, срок, партия, изготовитель, условия хранения)');
      var groups = [], gi = {};
      labs.forEach(function (L) { if (gi[L.key] === undefined) { gi[L.key] = groups.length; groups.push({ key: L.key, labs: [], net: 0, netKnown: true }); } var g = groups[gi[L.key]]; g.labs.push(L); var n = Number(L.f.net_weight_kg); if (n > 0) g.net += n; else g.netKnown = false; });
      var qKg = unit === 'кг' ? qty : unit === 'г' ? qty / 1000 : null, netAll = groups.reduce(function (a, g) { return a + g.net; }, 0);
      if (qKg !== null && netAll > qKg * 1.02 + 1e-6) bad.push(tag + 'по этикеткам нетто ' + Math.round(netAll * 1000) / 1000 + ' кг — больше, чем в накладной (' + qty + ' ' + unit + '): лишнее фото или ошибка в количестве');
      if (groups.length <= 1) parts.push({ it: it, i: i, qty: qty, labs: labs, groups: groups.length, n: 1, cover: _mcRcvCover_(labs, netAll, qKg, qty, unit) });
      else {
        var given = it.parts || {}, qs = groups.map(function (g) { var v = parseFloat(given[g.key]); return v > 0 ? v : (unit === 'кг' && g.netKnown ? Math.round(g.net * 1000) / 1000 : unit === 'г' && g.netKnown ? Math.round(g.net * 1000) : 0); });
        var tot = qs.reduce(function (a, b) { return a + b; }, 0);
        if (qs.some(function (q) { return !(q > 0); }) || Math.abs(tot - qty) > Math.max(0.001, qty * 0.005))
          bad.push(tag + 'упаковки с разными сроками/партиями (' + groups.map(function (g) { return _mcRcvPackText_(g.labs[0].f) + ': ' + g.labs.length + ' уп.'; }).join('; ') + ') — это ' + groups.length + ' партии. Распределите ' + qty + ' ' + unit + ' между ними (сейчас ' + Math.round(tot * 1000) / 1000 + ')');
        groups.forEach(function (g, k) { parts.push({ it: it, i: i, qty: qs[k], labs: g.labs, groups: groups.length, n: k + 1, cover: _mcRcvCover_(g.labs, g.net, null, qs[k], unit) }); });
      }
    });
    var prepared = parts.map(function (pt) {
      var it = pt.it, i = pt.i, name = String(it.name).trim(), tag = 'строка ' + (i + 1) + ' «' + name + '»' + (pt.groups > 1 ? ' (партия ' + pt.n + ' из ' + pt.groups + ')' : '') + ': ', unit = _mcRcvUnit_(it.unit), qty = pt.qty, price = parseFloat(it.price) || 0;
      var p = { name: name, unit: unit, qty: qty, price: price, exp: '', withTime: false, src: 'NONE', basis: '', label: null, cap: null, caps: [], match: '', storageType: '', store: '', loc: '', locSource: '', locChosen: false, tmin: null, tmax: null, cover: pt.cover };
      var sum = it.sum === '' || it.sum === null || it.sum === undefined ? null : parseFloat(it.sum), rowQty = parseFloat(it.qty);
      // количество по документу (как распознано) и принятое (после исправления) — расхождение фиксируется с причиной
      var docQty = it.docQty === '' || it.docQty === null || it.docQty === undefined ? null : parseFloat(it.docQty), docUnit = it.docUnit ? _mcRcvUnit_(it.docUnit) : unit;
      var sumQty = docQty !== null ? docQty : rowQty;
      if (pt.n === 1 && sum !== null && price > 0 && Math.abs(sumQty * price - sum) > Math.max(1, Math.abs(sum) * 0.02) && !it.sumAck) bad.push(tag + 'количество × цена (' + Math.round(sumQty * price * 100) / 100 + ') не равно сумме ' + sum + ' — исправьте или подтвердите');
      p.docQty = docQty; p.docUnit = docUnit; p.diff = '';
      if (pt.n === 1 && docQty !== null && (docUnit !== unit || Math.abs(docQty - rowQty) > Math.max(0.001, Math.abs(docQty) * 0.005))) {
        if (!String(it.diffReason || '').trim()) bad.push(tag + 'по накладной ' + docQty + ' ' + docUnit + ', принимается ' + rowQty + ' ' + unit + ' — укажите причину расхождения');
        else p.diff = 'по накладной ' + docQty + ' ' + docUnit + ', принято ' + rowQty + ' ' + unit + ' · ' + String(it.diffReason).trim();
      }
      p.total = sum !== null && pt.groups <= 1 && !p.diff ? sum : Math.round(qty * price * 100) / 100;
      // другая единица (шт → кг): стоимость по накладной сохраняется, цена пересчитывается на принятую единицу;
      // та же единица, другое количество (недовес) — стоимость по принятому количеству
      if (p.diff && docUnit !== unit && sum !== null && rowQty > 0) { p.price = Math.round(sum / rowQty * 100) / 100; p.total = sum; p.diff += ' · цена пересчитана: ' + sum + ' ₽ / ' + rowQty + ' ' + unit + ' = ' + p.price + ' ₽/' + unit; }
      p.noLabel = !pt.labs.length && !!it.noLabel; p.photos = [];
      (Array.isArray(it.photoIds) ? it.photoIds : []).forEach(function (pid) { var cp = _mcRcvCapture_(pid); if (cp && cp.type === 'PHOTO' && cp.status !== 'Проведено') p.photos.push(cp); });
      if (pt.labs.length) {
        var f = pt.labs[0].f;
        p.label = f; p.cap = pt.labs[0].cap; p.caps = pt.labs.map(function (L) { return L.cap; });
        var worst = pt.labs.some(function (L) { return L.m.status === 'CONFLICT'; }) ? 'CONFLICT' : pt.labs.some(function (L) { return L.m.status !== 'MATCHED'; }) ? 'REVIEW_REQUIRED' : 'MATCHED';
        var cf = []; pt.labs.forEach(function (L) { cf = cf.concat(L.m.conflicts); });
        p.match = worst + (cf.length ? ': ' + cf.join('; ') + ' · причина: ' + it.conflictReason : '') + ' · ' + pt.cover;
        p.tmin = f.storage_temperature_min === '' || f.storage_temperature_min === undefined ? null : f.storage_temperature_min;
        p.tmax = f.storage_temperature_max === '' || f.storage_temperature_max === undefined ? null : f.storage_temperature_max;
        p.store = _mcBlRange_(p.tmin, p.tmax);
      }
      var manual = String(it.expiry || '').trim();
      if (manual) {
        var d = _parseDate_(manual);
        if (!d) bad.push(tag + 'дата «' + manual + '» не распознана');
        else if (d.getTime() < today0.getTime()) bad.push(tag + 'срок годности истёк ' + _mcRcvFmt_(d) + ' — такой товар не принимается (оформите возврат поставщику)');
        else { p.exp = d; p.src = 'MANUAL'; p.basis = 'введено при приёмке (дата с упаковки)' + (p.label && p.label.expiration_date && _lblDate_(d) !== p.label.expiration_date ? '; OCR этикетки прочитал ' + p.label.expiration_date : ''); }
      } else if (p.label && p.label.expiration_date) {
        p.exp = _parseDate_(p.label.expiration_date); p.src = 'LABEL'; p.basis = 'этикетка производителя: годен до' + (p.label.manufactured_date ? ', изготовлено ' + _mcRcvFmt_(_parseDate_(p.label.manufactured_date)) : '');
      } else if (p.label && p.label.expiration_date_suggested && it.labelConfirmed) {
        p.exp = _parseDate_(p.label.expiration_date_suggested); p.src = 'LABEL'; p.basis = 'этикетка производителя: дата изготовления + «' + String(p.label.shelf_life_raw || '').replace(/\s+/g, ' ') + '» (подтверждено)';
      } else if (it.mode && MC_RCV_MODES_[it.mode]) {
        x = x || _mcRcvDb_();
        var s = _mcRcvSuggestOne_(name, now, x), mm = s.modes[it.mode];
        if (mm && mm.until) { var u = _mcRcvUntil_(now, _mcRcvShelf_(mm.text)); p.exp = u.date; p.withTime = u.withTime; p.src = 'MATRIX'; p.basis = 'матрица: ' + s.matched + ' · ' + MC_RCV_MODES_[it.mode] + ': ' + mm.text; }
      }
      if (p.exp && p.src !== 'MATRIX' && p.exp.getTime() < today0.getTime() && !bad.some(function (b) { return b.indexOf(tag) === 0; })) bad.push(tag + 'срок годности истёк ' + _mcRcvFmt_(p.exp) + ' — такой товар не принимается');
      if (p.noLabel) {
        if (!p.exp) bad.push(tag + 'товар без маркировки: срок не с чего взять — выберите режим хранения из матрицы или введите «годен до»');
        p.match = 'Без маркировки производителя (развес) · основание: накладная № ' + docNo + (docDate ? ' от ' + _mcRcvFmt_(docDate) : '') + (p.photos.length ? ' · фото при приёмке: ' + p.photos.length : '');
      }
      var prof = _mcBlProfile_(name, '');
      if (prof.requiresLabel && !p.label) bad.push(tag + 'для продукта обязательно фото оригинальной этикетки');
      p.storageType = _mcBlStorageType_(p.label, prof, it.mode);
      if (!p.store && prof.tmax !== null) p.store = _mcBlRange_(prof.tmin, prof.tmax);
      if (it.location) {
        var loc = _mcBlLoc_(it.location);
        if (!loc || !loc.active) bad.push(tag + 'место хранения не найдено или отключено');
        else if (!_mcBlTypeFits_(p.storageType, loc.type)) bad.push(tag + 'продукт хранится: ' + (MC_BL_TYPE_RU_[p.storageType] || p.storageType) + ', а «' + loc.name + '» — ' + (MC_BL_TYPE_RU_[loc.type] || loc.type));
        else if (_mcBlTempConflict_(p.tmin, p.tmax, loc)) bad.push(tag + _mcBlTempConflict_(p.tmin, p.tmax, loc));
        else { p.loc = loc.id; p.locSource = 'выбрано при приёмке'; p.locChosen = true; }
      } else { var rl = _mcBlResolveLocation_(name, '', p.storageType, p.tmin, p.tmax); p.loc = rl.id; p.locSource = rl.id ? rl.source : (rl.reason || 'Место хранения не определено'); }
      return p;
    });
    // ВСД «Меркурия», выбранные для строк: найден, не отклонён, ещё не привязан к другой приёмке, один ВСД — одна строка
    var vsdUse = {}, canVsd = _mcRbHasExact_(op.session, 'mercury|vsd_cancel');   // этап 10.7: ВСД при приёмке выбирает только ХАССП; повар — без ВСД
    items.forEach(function (it, i) {
      if (!it.vsdId || !canVsd) return;
      var tag = 'строка ' + (i + 1) + ' «' + String(it.name).trim() + '»: ', vr = _mvFind_(it.vsdId);
      if (!vr) bad.push(tag + 'ВСД не найден — получите его заново');
      else if (vr.batches.length) bad.push(tag + 'ВСД ' + vr['Номер ВСД'] + ' уже привязан к партии ' + vr.batches.join(', ') + ' — приёмка по нему уже завершена');
      else if (vr.status === 'REJECTED') bad.push(tag + 'ВСД ' + vr['Номер ВСД'] + ' отклонён/аннулирован');
      else if (vsdUse[vr.id] !== undefined) bad.push(tag + 'ВСД ' + vr['Номер ВСД'] + ' уже выбран для строки ' + (vsdUse[vr.id] + 1));
      else vsdUse[vr.id] = i;
    });
    if (bad.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', bad.join('; '), op.id); }
    var who = _author_(op);
    return _withLock_(function () {
      var created = [];
      try {
        var income = prepared.map(function (p) {
          return { name: p.name, qty: p.qty, unit: p.unit, price: p.price, expiry: p.exp || '', docRef: 'накладная ' + docNo,
            manufactured: p.label && p.label.manufactured_date || '', supplierBatch: p.label && p.label.supplier_batch || '' };
        });
        var r = _incomeWithBatches_(income, supplier, 'накладная ' + docNo, op);
        created = r.batchIds.slice();
        var supRec = _mdResolveSupplier_(supplier, false), supId = supRec ? supRec.id : '';
        var docId = acc && acc.documentId ? acc.documentId : _mcRcvSaveInvoiceDoc_(op, who, docNo, docDate || now, supId, supplier, invCaps);
        var sh = _mcRcvSheet_(), rows = [], out = [], C = MC_RCV_C_;
        r.batchIds.forEach(function (bid, i) {
          var p = prepared[i], b = _bcFind_(bid), labDocId = '', row = [];
          for (var k = 0; k < MC_RCV_HEAD_.length; k++) row.push('');
          var labDocs = p.caps.map(function (cp) { return _mcRcvSaveLabelDoc_(op, who, bid, { label: p.label, cap: cp, name: p.name }, supId, supplier); });
          labDocId = labDocs[0] || '';
          if (p.loc && b) _mcBlSetLocation_(b, p.loc);
          var set = function (h, val) { row[C[h]] = val === undefined || val === null ? '' : val; };
          set('BatchID', bid); set('Продукт', p.name); set('Кол-во', p.qty); set('Ед.', p.unit); set('Поставщик', supplier); set('Накладная', docNo); set('Принято', now);
          set('Годен до', p.exp || ''); set('Срок с часами', p.withTime ? 'да' : ''); set('Источник срока', p.src); set('Основание срока', p.basis);
          set('Принял', who.фио); set('Должность', who.должность); set('ID сотрудника', who.id); set('OperationID', op.id); set('Печатей этикетки', 0);
          set('SupplierID', supId); set('DocumentID накладной', docId); set('Дата накладной', docDate || ''); set('OriginalLabelID', p.cap ? p.cap.id : ''); set('Документ этикетки', labDocId);
          set('FileID этикетки', p.cap ? p.cap.fileId : ''); set('Изготовитель', p.label ? p.label.manufacturer : ''); set('Партия изготовителя', p.label ? p.label.supplier_batch : '');
          set('GTIN/EAN', p.label ? p.label.barcode : ''); set('Дата изготовления', p.label && p.label.manufactured_date ? _parseDate_(p.label.manufactured_date) : '');
          set('Дата упаковки', p.label && p.label.packaging_date ? _parseDate_(p.label.packaging_date) : ''); set('Срок производителя', p.label && p.label.expiration_date ? _parseDate_(p.label.expiration_date) : (p.src === 'MANUAL' ? p.exp : ''));
          set('Цена за ед.', p.price); set('Стоимость', p.total); set('Тип хранения', p.storageType); set('Хранить', p.store); set('Сопоставление', p.label ? p.match : 'без этикетки');
          set('Печатей этикетки вскрытия', 0); set('Обновлено', now); set('Обновил', who.фио);
          set('Все этикетки', p.caps.concat(p.photos).map(function (cp) { return cp.id; }).join(',')); set('Упаковок по фото', p.caps.length || '');
          set('Без маркировки', p.noLabel ? 'да' : ''); set('По накладной', p.docQty !== null ? p.docQty + ' ' + p.docUnit : ''); set('Расхождение', p.diff);
          if (p.noLabel) set('Сопоставление', p.match);
          rows.push(row);
          _mcBlEvent_(op, bid, 'BATCH_CREATED', { qty: p.qty, unit: p.unit, doc: docId, reason: 'накладная № ' + docNo + ' · ' + supplier, after: { price: p.price, total: p.total } });
          if (p.cap) _mcBlEvent_(op, bid, 'LABEL_CONFIRMED', { doc: labDocs.join(','), qty: p.caps.length, unit: 'уп.', reason: p.match, after: { labels: p.caps.map(function (cp) { return cp.id; }), expiry: p.label.expiration_date || '', mfrBatch: p.label.supplier_batch || '', manufacturer: p.label.manufacturer || '' } });
          _mcBlEvent_(op, bid, 'RECEIVE', { qty: p.qty, unit: p.unit, reason: 'годен до ' + (p.exp ? _mcRcvFmt_(p.exp, p.withTime) : 'не указан') + ' · ' + p.src + (p.basis ? ' · ' + p.basis : '') + (p.noLabel ? ' · без маркировки производителя' : '') + (p.diff ? ' · РАСХОЖДЕНИЕ: ' + p.diff : ''), after: { status: 'QUARANTINE' } });
          p.photos.forEach(function (cp) {
            var pid = 'SD-' + Date.now() + '-' + Utilities.getUuid().slice(0, 4);
            _bcSheet_(MC_SD_DOC_, MC_SD_DOC_HEAD_).appendRow([pid, 'Фото товара при приёмке', cp.id, now, '', supId, supplier, '', p.name, bid, cp.fileId, cp.hash, 'ACTIVE', '', '', who.фио, new Date(), op.id]);
            _mcCreateTraceLink_('RECEIPT_PHOTO', pid, 'ФОТО_ПРИЁМКИ', 'BATCH', bid, { actor: who.фио, source: 'STOCK_RECEIVE' });
            var cs3 = _mcRcvCapSheet_(); cs3.getRange(cp.row, 11).setValue('Проведено'); cs3.getRange(cp.row, 18).setValue(bid);
          });
          if (p.loc) _mcBlEvent_(op, bid, 'STORAGE_ASSIGNED', { to: p.loc, reason: p.locSource, qty: p.qty, unit: p.unit });
          if (docId) _mcCreateTraceLink_('SUPPLIER_DOCUMENT', docId, 'ПОСТАВЛЕНА', 'BATCH', bid, { actor: who.фио, source: 'STOCK_RECEIVE', weight: p.qty, unit: p.unit });
          labDocs.forEach(function (ld) { _mcCreateTraceLink_('ORIGINAL_LABEL', ld, 'ЭТИКЕТКА_ПРОИЗВОДИТЕЛЯ', 'BATCH', bid, { actor: who.фио, source: 'STOCK_RECEIVE' }); });
          if (p.loc) _mcCreateTraceLink_('BATCH', bid, 'PUT_AWAY', 'LOCATION', p.loc, { factId: bid, actor: who.фио, source: 'STOCK_RECEIVE', weight: p.qty, unit: p.unit });
          if (p.locChosen) _mcBlProfileSet_(p.name, b ? String(b.v[17] || '') : '', { defaultLocation: p.loc, type: p.storageType || undefined }, who.фио + ' (место подтверждено при приёмке)');
          p.caps.forEach(function (cp) { var cs = _mcRcvCapSheet_(); cs.getRange(cp.row, 11).setValue('Проведено'); cs.getRange(cp.row, 13, 1, 2).setValues([[who.фио, now]]); cs.getRange(cp.row, 18).setValue(bid); });
        });
        sh.getRange(sh.getLastRow() + 1, 1, rows.length, MC_RCV_HEAD_.length).setValues(rows);
        var vsdOut = {};
        items.forEach(function (it, i) {
          if (!it.vsdId || !canVsd) return;
          var ids = r.batchIds.filter(function (bid, k) { return parts[k].i === i; }), vr = _mvFind_(it.vsdId);
          if (it.vsdConfirm && typeof it.vsdConfirm === 'object') {
            var conf = {}; Object.keys(it.vsdConfirm).forEach(function (k) { var rs = String((it.vsdConfirm[k] || {}).reason || it.vsdConfirm[k] || '').trim(); if (rs && /^(product|producer)$/.test(k)) conf[k] = { reason: rs, by: who.фио, at: _mvIso_(now, true) }; });
            _mvSet_(vr, { 'Подтверждения': conf }); vr.confirm = conf;
          }
          var chk = _mvLink_(op, vr, ids, { docNo: docNo, docId: docId, at: now });
          ids.forEach(function (bid) { vsdOut[bid] = { vsd: _mvView_(vr), summary: chk ? chk.summary : '' }; });
        });
        if (invCaps.length) { var cs2 = _mcRcvCapSheet_(); invCaps.forEach(function (c) { cs2.getRange(c.row, 11).setValue('Проведено'); cs2.getRange(c.row, 13, 1, 2).setValues([[who.фио, now]]); cs2.getRange(c.row, 18).setValue(r.batchIds.join(',')); }); }
        r.batchIds.forEach(function (bid, i) {
          var p = prepared[i], lb = _mcBlLabelData_(bid, 'receipt');
          lb.quantity = p.qty; lb.unit = p.unit; lb.price = p.price; lb.total = p.total; lb.locationNote = p.loc ? p.locSource : p.locSource; lb.originalLabelId = p.cap ? p.cap.id : '';
          lb.vsd = vsdOut[bid] ? vsdOut[bid].vsd : null; lb.vsdSummary = vsdOut[bid] ? vsdOut[bid].summary : '';
          try { var bv = _bcFind_(bid); lb.vetControlled = _sdVetOn_() && _sdVetControlled_(bv ? String(bv.v[17] || '') : '', p.name); } catch (eV) { lb.vetControlled = false; }
          lb.printLabel = true; lb.operationId = op.id; lb.expiryBasis = p.basis; lb.match = p.match; lb.packages = p.caps.length; lb.cover = p.cover; lb.diff = p.diff; lb.photos = p.photos.length;
          out.push(lb);
        });
        _audit_(op, 'STOCK_RECEIVE', 'Приёмка', r.batchIds.join(','), null, { supplier: supplier, doc: docNo, documentId: docId, positions: rows.length, batches: r.batchIds, acceptedBy: who.фио,
          expirySources: prepared.map(function (p) { return p.src; }), vsd: Object.keys(vsdUse), labels: prepared.reduce(function (a, p) { return a + p.caps.length; }, 0), duplicateReason: acc ? meta.dupReason : '' });
        var vt = _vtRefresh_(supplier, docNo, op);   // этап 10.7: ВСД не погашен / не найден → ответственному за ХАССП «Непогашенная накладная»
        _endOp_(op);
        return _ok_({ batches: out, priceAlerts: r.priceAlerts, acceptedBy: who.фио, acceptedAt: _mcRcvFmt_(now, true), documentId: docId,
          vsdTask: vt && vt.items.length ? { status: vt.status, open: vt.open, deadline: _vtFmt_(vt.deadline), note: vt.open ? 'ВСД гасит ответственный за ХАССП — ему отправлено уведомление «Непогашенная накладная». До гашения партии в карантине.' : '' } : null }, op.id);
      } catch (err) {
        _mcRcvRollback_(op, created, err);
        throw err;
      }
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function createBatchFromReceiving(json, token) {
  var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
  return stockReceiveSave(JSON.stringify(d.items || []), d.supplier, d.docNo || d.number, JSON.stringify({ docDate: d.docDate, invoiceCaptureId: d.invoiceCaptureId, dupReason: d.dupReason }), token);
}
/** Ключ группы упаковок: срок, изготовление, партия производителя, изготовитель. */
function _mcRcvPackKey_(f) { return [f.expiration_date || '', f.manufactured_date || '', String(f.supplier_batch || '').toUpperCase().replace(/\s/g, ''), _mdNorm_(f.manufacturer || '').slice(0, 40)].join('|'); }
function _mcRcvPackText_(f) { var d = function (x) { var t = x ? _parseDate_(x) : null; return t ? _mcRcvFmt_(t) : '—'; }; return 'годен до ' + d(f.expiration_date) + (f.supplier_batch ? ', партия ' + f.supplier_batch : '') + ', изг. ' + d(f.manufactured_date); }
/** Покрытие строки фото: «сфотографировано 2 уп. (2,92 кг) из 10 кг». */
function _mcRcvCover_(labs, net, qKg, qty, unit) {
  if (!labs.length) return 'без фото этикетки';
  var r = labs.length + ' уп. по фото' + (net > 0 ? ' (нетто ' + Math.round(net * 1000) / 1000 + ' кг)' : '');
  return r + ' на ' + qty + ' ' + unit + (net > 0 && (unit === 'кг' || unit === 'г') && net < (unit === 'г' ? qty / 1000 : qty) * 0.98 ? ' — остальные упаковки приняты по накладной с теми же данными' : '');
}
/* Накладная на нескольких листах: FileID и Hash — по листам через запятую, в порядке листов (карточка партии показывает каждый лист). */
function _mcRcvSaveInvoiceDoc_(op, who, num, dt, supId, supName, caps) {
  var id = 'SD-' + Date.now() + '-' + Utilities.getUuid().slice(0, 4);
  caps = (Array.isArray(caps) ? caps : caps ? [caps] : []).filter(function (c) { return c && c.fileId; });
  _bcSheet_(MC_SD_DOC_, MC_SD_DOC_HEAD_).appendRow([id, 'Накладная', num, dt, '', supId, supName, '', '', '', caps.map(function (c) { return c.fileId; }).join(','), caps.map(function (c) { return c.hash; }).join(','), 'ACTIVE', '', '', who.фио, new Date(), op.id]);
  return id;
}
function _mcRcvSaveLabelDoc_(op, who, batchId, p, supId, supName) {
  var id = 'SD-' + Date.now() + '-' + Utilities.getUuid().slice(0, 4), d = p.label && p.label.manufactured_date ? _parseDate_(p.label.manufactured_date) : new Date();
  _bcSheet_(MC_SD_DOC_, MC_SD_DOC_HEAD_).appendRow([id, 'Этикетка производителя', (p.label && p.label.supplier_batch) || p.cap.id, d, '', supId, supName, '', p.name, batchId, p.cap.fileId, p.cap.hash, 'ACTIVE', '', '', who.фио, new Date(), op.id]);
  return id;
}
/** Запись оборвалась на середине — созданные партии сторнируются: остаток 0, статус «blocked», склад уменьшен, событие в истории. */
function _mcRcvRollback_(op, created, err) {
  (created || []).forEach(function (bid) {
    try {
      var b = _bcFind_(bid); if (!b) return;
      var q = _mcBlNum_(b.v[9]);
      if (q > 0) _logStockOp_('Сторно приёмки', b.v[1], q, b.v[2], 0, 'Приёмка', 'ошибка записи: ' + String(err && err.message || err).slice(0, 150));
      b.sh.getRange(b.row, 10, 1, 2).setValues([[0, 'blocked']]);
      _mcBlEvent_(op, bid, 'RECEIVE_ROLLBACK', { qty: q, unit: b.v[2], reason: String(err && err.message || err).slice(0, 300), result: 'ROLLED_BACK' });
    } catch (e) {}
  });
  try { _audit_(op, 'RECEIVE_ROLLBACK', 'Приёмка', (created || []).join(','), null, { error: String(err && err.message || err).slice(0, 300) }); } catch (e) {}
}

/** Последние приёмки — для повторной печати маркировки. */
function stockReceiveRecent(token) {
  try {
    _requireAuth_(token, 'stock');
    var v = _mcRcvSheet_().getDataRange().getValues(), C = MC_RCV_C_, out = [];
    for (var i = v.length - 1; i >= 1 && out.length < 80; i--) {
      var r = v[i]; if (!r[0]) continue;
      var lb = _mcBlLabelData_(String(r[0]), r[C['Вскрыто']] ? 'opening' : 'receipt'); if (!lb) continue;
      lb.doc = r[C['Накладная']]; lb.qtyText = lb.qty; lb.printed = Number(r[C['Печатей этикетки']]) || 0;
      lb.lastPrint = r[C['Последняя печать']] ? _mcRcvFmt_(r[C['Последняя печать']] instanceof Date ? r[C['Последняя печать']] : new Date(r[C['Последняя печать']]), true) : '';
      lb.storageStatus = lb.status; lb.vsdNumber = String(r[C['ВСД']] || ''); lb.vsdId = String(r[C['VSDID']] || ''); lb.vsdStatus = String(r[C['Статус ВСД']] || '');
      lb.vsdCancelledAt = r[C['Дата гашения ВСД']] ? _mcRcvFmt_(_mcBlDate_(r[C['Дата гашения ВСД']]) || new Date(r[C['Дата гашения ВСД']]), true) : ''; lb.vsdCancelledBy = String(r[C['Погасил ВСД']] || '');
      out.push(lb);
    }
    return _ok_(out);
  } catch (e) { return _failFrom_(e); }
}

/** Отметить печать этикеток партии: счётчик в паспорте и событие LABEL_PRINT. */
function stockReceiveLabelsPrinted(batchIdsJson, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock', 'RECEIVE_LABEL_PRINT', 'Печать маркировки', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var ids = typeof batchIdsJson === 'string' ? JSON.parse(batchIdsJson || '[]') : (batchIdsJson || []), want = {};
    ids.forEach(function (id) { want[String(id)] = (want[String(id)] || 0) + 1; });
    return _withLock_(function () {
      var sh = _mcRcvSheet_(), v = sh.getDataRange().getValues(), now = new Date(), n = 0, C = MC_RCV_C_;
      for (var i = 1; i < v.length; i++) {
        var k = String(v[i][0]); if (!want[k]) continue;
        sh.getRange(i + 1, C['Печатей этикетки'] + 1, 1, 2).setValues([[(Number(v[i][C['Печатей этикетки']]) || 0) + want[k], now]]); n++;
        _mcBlEvent_(op, k, 'LABEL_PRINT', { qty: want[k], unit: 'шт', reason: 'этикетка партии' });
      }
      _audit_(op, 'RECEIVE_LABEL_PRINT', 'Приёмка', Object.keys(want).join(','), null, { labels: ids.length, batches: n });
      _endOp_(op);
      return _ok_({ marked: n }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
