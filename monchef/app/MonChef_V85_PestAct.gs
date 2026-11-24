/**
 * MonChef V85 — акт дезинсекции, дератизации, дезинфекции (3-Д) со снимка → журнал J14 (и КТ-8, J28) (18.11.2026).
 *
 * Снимок или PDF акта подрядчика распознаётся (Yandex Vision — как накладные) или вставляется текстом. Система находит в тексте:
 * исполнителя (ООО / ИП / АО …), номер и дату акта, вид работ (дератизация, дезинсекция, дезинфекция), объекты и площадь,
 * средства (нумерованный список после «средств:» / «препараты:»), документы на средства (свидетельство о госрегистрации и т. п.),
 * договор и итоговую фразу акта. Из этого — черновик; человек проверяет и правит каждое поле и записывает: строка J14
 * (зеркально — J28), файл акта — на Диске («03 Документы предприятия / Договоры»), запись в реестре актов.
 *
 *  - Без проверки и подтверждения ничего в журнал не пишется; распознанное — подсказка.
 *  - «Эффективность» система не подставляет: итоговая фраза акта («работы выполнены полностью…») — о приёмке работ, а не
 *    об эффективности обработки; её вносит ответственный, если оценивал.
 *  - Предупреждения (не запрет): в акте нет фактического адреса предприятия из реквизитов; нет договора; нет документов на средства;
 *    нет номера или даты; тот же файл или тот же акт уже записан.
 */
var MC_V85_ = 'Акты_3Д_V85';
var MC_V85_HEAD_ = ['ActID', 'Дата акта', '№ акта', 'Исполнитель', 'Вид обработки', 'Объекты', 'Средства', 'Документы на средства', 'Договор', 'Итог по акту',
  'Эффективность', 'Файл', 'FileID', 'SHA-256', 'Распознано (JSON)', 'Статус', 'Внёс', 'Внесено', 'Записал', 'Записано', 'Строка J14', 'OperationID'];
var MC_V85_KINDS_ = [['дератизация', /дератизац/i], ['дезинсекция', /дезинсекц/i], ['дезинфекция', /дезинфекц/i]];
var MC_V85_MON_ = { 'январ': 1, 'феврал': 2, 'март': 3, 'апрел': 4, 'ма': 5, 'июн': 6, 'июл': 7, 'август': 8, 'сентябр': 9, 'октябр': 10, 'ноябр': 11, 'декабр': 12 };
var MC_V85_ORGFORM_ = /^(?:общество с ограниченной ответственностью|ООО|акционерное общество|АО|ЗАО|ПАО|ОАО|индивидуальный предприниматель|ИП|ФБУЗ|ФГУП|МУП|ГУП)(?![А-Яа-яЁёA-Za-z])/i;   // \b в JS не работает с кириллицей

function _v85S_(x) { return String(x == null ? '' : x).replace(/\s+/g, ' ').trim(); }
function _v85Iso_(y, m, d) { y = +y; m = +m; d = +d; if (!(y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return ''; return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2); }
function _v85Month_(w) { w = String(w || '').toLowerCase(); if (/^\d+$/.test(w)) return +w; var k = Object.keys(MC_V85_MON_).filter(function (p) { return w.indexOf(p) === 0; }).sort(function (a, b) { return b.length - a.length; })[0]; return k ? MC_V85_MON_[k] : 0; }
/** Разбор текста акта → черновик полей. Ничего не додумывает: чего нет в тексте — поле пустое. */
function _v85Parse_(text) {
  var L = String(text || '').replace(/\r/g, '').split('\n').map(function (l) { return l.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim(); }).filter(Boolean);
  var T = L.join('\n'), out = { date: '', number: '', contractor: '', kinds: [], objects: '', area: '', products: [], docs: '', contract: '', result: '' }, m;
  // исполнитель: «Общество с ограниченной ответственностью» + «НАЗВАНИЕ» на следующей строке, или ООО «…» в одной строке
  for (var i = 0; i < Math.min(L.length, 12) && !out.contractor; i++) {
    if (!MC_V85_ORGFORM_.test(L[i])) continue;
    var form = /^(общество с ограниченной ответственностью|ООО)/i.test(L[i]) ? 'ООО' : /^(индивидуальный предприниматель|ИП)(?![А-Яа-яЁё])/i.test(L[i]) ? 'ИП' : (L[i].match(MC_V85_ORGFORM_) || [''])[0].replace(/акционерное общество/i, 'АО');
    var rest = L[i].replace(MC_V85_ORGFORM_, '').trim();
    if (!rest && L[i + 1]) rest = L[i + 1];
    m = /[«"“]([^»"”]+)[»"”]/.exec(rest);
    out.contractor = (form + ' ' + (m ? '«' + m[1].trim() + '»' : rest)).trim();
  }
  // номер и дата акта
  m = /акт[^\n№]{0,60}№\s*([0-9A-Za-zА-Яа-я][0-9A-Za-zА-Яа-я\-\/]*)/i.exec(T);
  if (m && !/^от$/i.test(m[1])) out.number = m[1];
  m = /акт[^\n]{0,80}?от\s*«?\s*(\d{1,2})\s*»?[.\s]+([а-яё]+|\d{1,2})[.\s]+(\d{4})/i.exec(T) || /от\s*«?\s*(\d{1,2})\s*»?[.\s]+([а-яё]+|\d{1,2})[.\s]+(\d{4})/i.exec(T);
  if (m) out.date = _v85Iso_(m[3], _v85Month_(m[2]), m[1]);
  if (!out.date && (m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(T))) out.date = _v85Iso_(m[3], m[2], m[1]);
  // вид работ: «мероприятия по …», «проведена …»; иначе — по всему тексту, кроме строк со средствами
  var prodStart = -1; for (var k = 0; k < L.length; k++) if (/(средств|препарат)[^\n]{0,40}:\s*$/i.test(L[k])) { prodStart = k; break; }
  var phrase = (/(?:мероприяти\S*|работ\S*|обработк\S*)\s+по\s+([^\n:.]+)/i.exec(T) || /проведен\S*\s+([^\n:.]+)/i.exec(T) || [])[1] || '';
  MC_V85_KINDS_.map(function (x) { var mm = x[1].exec(phrase); return mm ? [mm.index, x[0]] : null; }).filter(Boolean).sort(function (p, q) { return p[0] - q[0]; }).forEach(function (x) { out.kinds.push(x[1]); });   // в порядке, как в акте
  if (!out.kinds.length) L.forEach(function (l, j) { if (prodStart >= 0 && j > prodStart && /^\s*(\d+[.)]|[-•])/.test(l)) return; MC_V85_KINDS_.forEach(function (x) { if (x[1].test(l) && out.kinds.indexOf(x[0]) < 0) out.kinds.push(x[0]); }); });
  // объекты: строка «по адресу / объект / помещение» и продолжение до начала описания работ
  for (var a = 0; a < L.length; a++) {
    if (!/по адресу|адрес объекта|^объект|помещени/i.test(L[a]) || MC_V85_ORGFORM_.test(L[a])) continue;
    var parts = [L[a].replace(/^.*?(по адресу|адрес объекта|объект[а-я]*|помещени[а-я]*)\s*[:\-]?\s*/i, '')];
    for (var b = a + 1; b < L.length && b < a + 5 && !/проведен|мероприят|средств|препарат|комисси|выполнен/i.test(L[b]); b++) parts.push(L[b]);
    out.objects = _v85S_(parts.join(' ')); break;
  }
  if ((m = /(\d+(?:[.,]\d+)?)\s*(?:м2|м²|кв\.?\s*м)/i.exec(T))) out.area = m[1].replace(',', '.') + ' м²';
  // средства: нумерованный список после «…средств:» / «препараты:»
  if (prodStart >= 0) for (var p = prodStart + 1; p < L.length; p++) { var mm = /^\s*(?:\d+[.)]|[-•])\s*(.+)$/.exec(L[p]); if (!mm) break; out.products.push(_v85S_(mm[1])); }
  if (!out.products.length) L.forEach(function (l) { if (/[«"][^»"]+[»"]/.test(l) && /(средств|препарат|родентицид|инсектицид|приманк|антисептик|дезинфициру)/i.test(l) && !MC_V85_ORGFORM_.test(l)) out.products.push(_v85S_(l.replace(/^\s*(\d+[.)]|[-•])\s*/, ''))); });
  // документы на средства — только с номером
  var D = []; L.forEach(function (l) { if (/(свидетельств\S*\s+о\s+(государственной\s+)?регистрации|(?:^|[^А-Яа-яЁё])СГР(?![А-Яа-яЁё])|RU\.\d{2}\.|декларац\S*\s+о\s+соответствии|сертификат\S*\s+соответствия)/i.test(l) && /№|RU\./i.test(l)) D.push(_v85S_(l.replace(/^\s*(\d+[.)]|[-•])\s*/, ''))); });
  out.docs = D.join('; ');
  if ((m = /договор\S*\s*(?:№|N)\s*([^\s,;]+)(?:\s*от\s*([\d.]+\s*(?:г\.?)?))?/i.exec(T))) out.contract = '№ ' + m[1] + (m[2] ? ' от ' + m[2].trim() : '');
  for (var r = 0; r < L.length; r++) if (/выполнен/i.test(L[r]) && !/^акт(?![а-яё])/i.test(L[r])) {   /* не заголовок «Акт выполненных работ» */ var s = L[r]; if (!/[.!]$/.test(s) && L[r + 1]) s += ' ' + L[r + 1]; out.result = _v85S_(s); break; }
  return out;
}
function _v85Warn_(f) {
  var W = [];
  if (!f.number) W.push('номер акта не распознан — впишите по акту');
  if (!f.date) W.push('дата акта не распознана — впишите по акту');
  if (!f.contract) W.push('в акте нет номера договора — укажите договор с исполнителем');
  if (!f.docs) W.push('в акте нет документов на средства (свидетельство о госрегистрации, декларация) — запросите у исполнителя или укажите по договору');
  try {
    var adr = String((_mcOrg_() || {}).actualAddress || ''), obj = String(f.objects || '').toLowerCase().replace(/ё/g, 'е');
    if (adr && obj) {
      var keys = adr.toLowerCase().replace(/ё/g, 'е').split(/[^а-яa-z0-9]+/).filter(function (w) { return w.length >= 4 && !/^(улица|проспект|переулок|шоссе|бульвар|область|обл|город|район|дом|корпус|строение|помещение|россия|москва|офис)$/.test(w) && !/^\d+$/.test(w); });
      if (keys.length && !keys.some(function (w) { return obj.indexOf(w) >= 0; })) W.push('в акте нет фактического адреса предприятия («' + adr + '») — проверьте, что акт о вашем объекте');
    }
  } catch (e) {}
  return W;
}
function _v85Rows_() { return _v82Rows_(MC_V85_, MC_V85_HEAD_); }
function _v85Sh_() { return _bcSheet_(MC_V85_, MC_V85_HEAD_); }
function _v85Can_(s) { return !!s && !s.dev && _mcRbJournalAllowed_(s, 'J14'); }
function _v85Day_(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : String(iso || ''); }
function _v85Fields_(r) { var f = {}; try { f = JSON.parse(String(r['Распознано (JSON)'] || '{}')); } catch (e) {} return f; }
function _v85Act_(r) {
  return { id: String(r.ActID), date: r['Дата акта'] instanceof Date ? Utilities.formatDate(r['Дата акта'], _mcTz_(), 'dd.MM.yyyy') : String(r['Дата акта'] || ''), number: String(r['№ акта'] || ''),
    contractor: String(r['Исполнитель'] || ''), kind: String(r['Вид обработки'] || ''), objects: String(r['Объекты'] || ''), products: String(r['Средства'] || ''), docs: String(r['Документы на средства'] || ''),
    contract: String(r['Договор'] || ''), result: String(r['Итог по акту'] || ''), efficacy: String(r['Эффективность'] || ''), file: String(r['Файл'] || ''), fileId: String(r.FileID || ''),
    status: String(r['Статус']), by: String(r['Внёс'] || ''), postedBy: String(r['Записал'] || ''), j14: String(r['Строка J14'] || '') };
}

/** Экран «Акты 3-Д». */
function v85Data(token) {
  var op = null;
  try { op = _beginOp_(token, '*', 'PEST_ACT_VIEW', 'Санитария', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var s = op.session, R = _v85Rows_();
    if (!(s && (s.dev || _mcRbJournalAllowed_(s, 'J14') || _mcRbHasExact_(s, 'haccp_view|sanitation')))) return _v82Fail_(op, 'FORBIDDEN', 'Акты 3-Д ведёт ответственный за ХАССП или директор');
    var drafts = R.filter(function (r) { return String(r['Статус']) === 'DRAFT'; }).reverse().map(function (r) { var a = _v85Act_(r); a.fields = _v85Fields_(r); a.warnings = _v85Warn_(a.fields); return a; });
    var acts = R.filter(function (r) { return String(r['Статус']) === 'POSTED'; }).reverse().slice(0, 50).map(_v85Act_);
    var p = PropertiesService.getScriptProperties();
    _endOp_(op);
    return _ok_({ drafts: drafts, acts: acts, can: _v85Can_(s), ocr: !!(p.getProperty('YANDEX_API_KEY') && p.getProperty('YANDEX_FOLDER_ID')), kinds: MC_V85_KINDS_.map(function (x) { return x[0]; }),
      address: String((_mcOrg_() || {}).actualAddress || '') }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Разобрать акт: {data: dataURL снимка/PDF, fileName} или {text} или {manual: true} → черновик. */
function v85Parse(json, token) {
  var op = null;
  try { op = _beginOp_(token, '*', 'PEST_ACT_PARSE', 'Санитария', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_v85Can_(op.session)) return _v82Fail_(op, op.session && op.session.dev ? 'FORBIDDEN' : 'FORBIDDEN', op.session && op.session.dev ? 'Технический доступ записей не делает' : 'Журнал дезинсекции и дератизации (J14) ведут ответственный за ХАССП и директор');
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), text = '', file = null, sha = '', src = 'MANUAL';
    if (d.data) {
      var m = /^data:([^;]+);base64,(.*)$/.exec(String(d.data)); if (!m) return _v82Fail_(op, 'VALIDATION', 'Файл не прочитан — выберите фото или PDF акта');
      if (!/^(image\/(jpeg|png)|application\/pdf)$/i.test(m[1])) return _v82Fail_(op, 'VALIDATION', 'Нужен снимок (JPEG, PNG) или PDF акта');
      var ocr = _yandexVisionRecognize_(String(d.data));
      if (ocr.error) return _v82Fail_(op, 'STATE', ocr.error === 'no-key' ? 'Распознавание снимков не настроено (ключ Yandex Vision, как для накладных) — вставьте текст акта или заполните вручную' : 'Текст на снимке не распознан (' + ocr.error + ') — переснимите ровно, при хорошем свете, или заполните вручную');
      text = ocr.fullText || ''; src = 'PHOTO';
      var bytes = Utilities.base64Decode(m[2]);
      sha = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
      var dup = _v85Rows_().filter(function (r) { return String(r['SHA-256']) === sha && String(r['Статус']) === 'POSTED'; })[0];
      if (dup) return _v82Fail_(op, 'VALIDATION', 'Этот файл уже записан: акт № ' + dup['№ акта'] + ' от ' + _v85Act_(dup).date + ' (' + dup['Исполнитель'] + ')');
      file = _mcFolder_('contracts', true).createFile(Utilities.newBlob(bytes, m[1], 'Акт 3-Д — ' + (_v85S_(d.fileName) || ('снимок ' + Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH-mm')))));
    } else if (d.text) { text = String(d.text).slice(0, 20000); src = 'TEXT'; }
    else if (d.manual !== true) return _v82Fail_(op, 'VALIDATION', 'Выберите снимок акта, вставьте текст или нажмите «Заполнить вручную»');
    var f = text ? _v85Parse_(text) : { date: '', number: '', contractor: '', kinds: [], objects: '', area: '', products: [], docs: '', contract: '', result: '' };
    f.source = src; f.text = text.slice(0, 4000);
    var id = _v76Id_('A3D'), who = _author_(op).фио;
    _withLock_(function () {
      _v85Sh_().appendRow([id, f.date, f.number, f.contractor, f.kinds.join(', '), f.objects + (f.area ? '; площадь ' + f.area : ''), f.products.join('; '), f.docs, f.contract, f.result, '',
        file ? file.getName() : '', file ? file.getId() : '', sha, JSON.stringify(f), 'DRAFT', who, new Date(), '', '', '', op.id]);
    });
    _audit_(op, 'PEST_ACT_PARSE', 'Санитария', id, null, { источник: src, файл: file ? file.getId() : '', распознано: { исполнитель: f.contractor, номер: f.number, дата: f.date, вид: f.kinds, средств: f.products.length } });
    _endOp_(op); return _ok_({ id: id, fields: f, warnings: _v85Warn_(f), fileId: file ? file.getId() : '' }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Записать проверенный акт: {id, date (yyyy-mm-dd), number, contractor, kind, objects, products, docs, contract, efficacy, confirm: true} → J14 (и J28). */
function v85Post(json, token) {
  var op = null;
  try { op = _beginOp_(token, '*', 'PEST_ACT_POST', 'Санитария', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_v85Can_(op.session)) return _v82Fail_(op, 'FORBIDDEN', op.session && op.session.dev ? 'Технический доступ записей не делает' : 'Журнал дезинсекции и дератизации (J14) ведут ответственный за ХАССП и директор');
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), x = _v85Rows_().filter(function (r) { return String(r.ActID) === String(d.id || ''); })[0];
    if (!x) return _v82Fail_(op, 'NOT_FOUND', 'Черновик акта не найден');
    if (String(x['Статус']) !== 'DRAFT') return _v82Fail_(op, 'VALIDATION', 'Акт уже ' + (String(x['Статус']) === 'POSTED' ? 'записан' : 'отменён'));
    var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d.date || '')), dt = dm ? new Date(+dm[1], +dm[2] - 1, +dm[3]) : null;
    if (!dt || dt.getTime() > Date.now()) return _v82Fail_(op, 'VALIDATION', 'Дата акта — по акту, не позже сегодняшней');
    var kind = _v85S_(d.kind), prod = _v85S_(d.products), org = _v85S_(d.contractor), obj = _v85S_(d.objects);
    if (!kind) return _v82Fail_(op, 'VALIDATION', 'Укажите вид обработки: дератизация, дезинсекция или дезинфекция');
    if (prod.length < 3) return _v82Fail_(op, 'VALIDATION', 'Укажите средства (препараты) по акту');
    if (org.length < 3) return _v82Fail_(op, 'VALIDATION', 'Укажите исполнителя (организацию) по акту');
    if (obj.length < 3) return _v82Fail_(op, 'VALIDATION', 'Укажите, где проводилась обработка (помещения, адрес)');
    if (d.confirm !== true) return _v82Fail_(op, 'VALIDATION', 'Подтвердите, что сверили поля с актом');
    var num = _v85S_(d.number), same = _v85Rows_().filter(function (r) { return String(r['Статус']) === 'POSTED' && num && String(r['№ акта']) === num && _v85S_(r['Исполнитель']).toLowerCase() === org.toLowerCase() && _v85Act_(r).date === _v85Day_(String(d.date)); })[0];
    if (same) return _v82Fail_(op, 'VALIDATION', 'Акт № ' + num + ' от ' + _v85Day_(String(d.date)) + ' этого исполнителя уже записан');
    var a = _author_(op), day = _v85Day_(String(d.date)), F = _v85Fields_(x);
    return _withLock_(function () {
      var o = { 'Дата': day, 'Вид обработки': kind, 'Площадь/помещение': obj, 'Препарат': prod, 'Сертификат': _v85S_(d.docs), 'Организация': org, 'Договор №': _v85S_(d.contract),
        'Подпись представителя': 'в акте № ' + (num || 'б/н') + ' от ' + day, 'Эффективность': _v85S_(d.efficacy) };
      var row = _v81Append_('J14', o, op, 'акт 3-Д ' + (num ? '№ ' + num + ' ' : '') + 'от ' + day + ' · ' + String(x.ActID));
      var sh = _v85Sh_(), H = MC_V85_HEAD_, set = function (h, v) { sh.getRange(x._row, H.indexOf(h) + 1).setValue(v); };
      set('Дата акта', day); set('№ акта', num); set('Исполнитель', org); set('Вид обработки', kind); set('Объекты', obj); set('Средства', prod); set('Документы на средства', _v85S_(d.docs));
      set('Договор', _v85S_(d.contract)); set('Эффективность', _v85S_(d.efficacy)); set('Статус', 'POSTED'); set('Записал', a.фио); set('Записано', new Date()); set('Строка J14', row);
      if (x.FileID) try { DriveApp.getFileById(String(x.FileID)).setName('Акт 3-Д ' + (num ? '№ ' + num + ' ' : '') + 'от ' + day + ' — ' + org); } catch (e) {}
      var changed = ['contractor', 'number', 'objects'].filter(function (k) { return String(F[k] || '') && _v85S_(F[k]) !== _v85S_(d[k]); });
      _audit_(op, 'PEST_ACT_POST', 'Санитария', String(x.ActID), { распознано: { исполнитель: F.contractor, номер: F.number, дата: F.date } }, { j14: row, исполнитель: org, номер: num, дата: day, вид: kind, исправлено_человеком: changed });
      _endOp_(op); return _ok_({ id: String(x.ActID), j14Row: row, date: day, warnings: _v85Warn_({ number: num, date: d.date, contract: _v85S_(d.contract), docs: _v85S_(d.docs), objects: obj }) }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Отменить черновик: {id}. Файл акта остаётся на Диске. */
function v85Cancel(json, token) {
  var op = null;
  try { op = _beginOp_(token, '*', 'PEST_ACT_CANCEL', 'Санитария', null, null); } catch (e) { return _failFrom_(e); }
  try {
    if (!_v85Can_(op.session)) return _v82Fail_(op, 'FORBIDDEN', 'Журнал J14 ведут ответственный за ХАССП и директор');
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), x = _v85Rows_().filter(function (r) { return String(r.ActID) === String(d.id || ''); })[0];
    if (!x || String(x['Статус']) !== 'DRAFT') return _v82Fail_(op, 'NOT_FOUND', 'Черновик не найден');
    _v85Sh_().getRange(x._row, MC_V85_HEAD_.indexOf('Статус') + 1).setValue('CANCELLED');
    _audit_(op, 'PEST_ACT_CANCEL', 'Санитария', String(x.ActID), 'DRAFT', 'CANCELLED');
    _endOp_(op); return _ok_({ id: String(x.ActID) }, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
(function () {
  if (typeof _UI_BUILDERS_ !== 'object') return;
  ['sanitation', 'haccp'].forEach(function (sec) {
    var orig = _UI_BUILDERS_[sec]; if (typeof orig !== 'function') return;
    _UI_BUILDERS_[sec] = function (token, opts, s) { var r = orig(token, opts, s) || {}; try { var ss = s || _getSession_(token); if (ss && (_v85Can_(ss) || ss.dev)) r.actions = (r.actions || []).concat([{ label: 'Акт 3-Д со снимка', module: 'pestact' }]); } catch (e) {} return r; };
  });
})();
try { if (MC_UI_VIEWS_.indexOf('pestact') < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat(['pestact']); } catch (e) {}
