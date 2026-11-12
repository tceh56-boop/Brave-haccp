/**
 * ЦЕХ Стандарт — договоры (тариф Pro и выше).
 * Реестр договоров предприятия: поставка, услуги (дезинсекция, вывоз отходов, лаборатория, обслуживание оборудования,
 * стирка спецодежды), аренда, банкетные договоры. Файл договора — в папке «Договоры» на Диске.
 * Система напоминает об окончании договора за 30 дней (плашка на экране).
 * Лист «ЦС_Договоры»: одна строка — договор, правка перезаписывает строку (история — в аудите шлюза).
 */
var TS_CT_SHEET_ = 'ЦС_Договоры';
var TS_CT_HEAD_ = ['ID', 'Номер', 'Дата', 'Контрагент', 'ИНН', 'Вид', 'Предмет', 'Сумма', 'Начало', 'Окончание', 'Автопролонгация', 'Ответственный', 'Файл', 'Статус', 'Комментарий', 'Кто внёс', 'Когда'];
var TS_CT_KINDS_ = ['Поставка продуктов', 'Дезинсекция и дератизация', 'Вывоз отходов', 'Лабораторные исследования', 'Обслуживание оборудования',
  'Стирка спецодежды', 'Медосмотры', 'Аренда', 'Банкет / мероприятие', 'Обучение', 'Прочее'];

function _tsCtSheet_() { return _bcSheet_(TS_CT_SHEET_, TS_CT_HEAD_); }
function _tsCtRows_() {
  var v = _tsCtSheet_().getDataRange().getValues(), h = v[0], out = [];
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    var o = { _row: i + 1 }; h.forEach(function (c, j) { o[c] = v[i][j] instanceof Date ? Utilities.formatDate(v[i][j], _mcTz_(), 'yyyy-MM-dd') : v[i][j]; });
    out.push(o);
  }
  return out;
}
function _tsCtState_(r, today) {
  if (String(r['Статус']) === 'РАСТОРГНУТ') return 'РАСТОРГНУТ';
  var end = String(r['Окончание'] || '');
  if (!end) return 'ДЕЙСТВУЕТ';
  if (end < today) return String(r['Автопролонгация']) === 'да' ? 'ПРОДЛЁН АВТОМАТИЧЕСКИ' : 'ИСТЁК';
  if (end <= _tsIsoPlusMonths_(today, 1)) return 'ИСТЕКАЕТ';
  return 'ДЕЙСТВУЕТ';
}
/** Реестр договоров с состоянием сроков. */
function tsContractsList(token) {
  try {
    _requireAuth_(token);
    var today = Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd');
    var rows = _tsCtRows_().map(function (r) { r.state = _tsCtState_(r, today); return r; });
    rows.sort(function (a, b) { return String(a['Окончание'] || '9999') < String(b['Окончание'] || '9999') ? -1 : 1; });
    return _ok_({ rows: rows, kinds: TS_CT_KINDS_, expiring: rows.filter(function (r) { return r.state === 'ИСТЕКАЕТ' || r.state === 'ИСТЁК'; }).length });
  } catch (e) { return _failFrom_(e); }
}
/** Создать или изменить договор (rec.ID — правка). */
function tsContractSave(token, rec) {
  try {
    var s = _requireAuth_(token); rec = rec || {};
    var miss = ['Номер', 'Дата', 'Контрагент', 'Вид'].filter(function (k) { return !String(rec[k] || '').trim(); });
    if (miss.length) return _fail_('VALIDATION', 'Заполните: ' + miss.join(', '));
    if (rec['ИНН'] && !/^\d{10}(\d{2})?$/.test(String(rec['ИНН']).trim())) return _fail_('VALIDATION', 'ИНН — 10 или 12 цифр');
    if (rec['Начало'] && rec['Окончание'] && String(rec['Окончание']) < String(rec['Начало'])) return _fail_('VALIDATION', 'Окончание раньше начала');
    var sh = _tsCtSheet_(), rows = _tsCtRows_(), old = rec.ID ? rows.filter(function (r) { return String(r.ID) === String(rec.ID); })[0] : null;
    var id = old ? old.ID : 'CT-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyMMddHHmmss');
    var line = TS_CT_HEAD_.map(function (h) {
      if (h === 'ID') return id; if (h === 'Кто внёс') return String(s.name || ''); if (h === 'Когда') return new Date();
      if (h === 'Файл' && !rec[h] && old) return old[h];
      return rec[h] !== undefined ? String(rec[h]) : old ? old[h] : (h === 'Статус' ? 'ДЕЙСТВУЕТ' : '');
    });
    if (old) sh.getRange(old._row, 1, 1, line.length).setValues([line]); else sh.appendRow(line);
    return _ok_({ id: id });
  } catch (e) { return _failFrom_(e); }
}
/** Прикрепить файл договора (PDF/фото, data URL). */
function tsContractUpload(token, id, dataUrl, fileName) {
  try {
    _requireAuth_(token);
    var r = _tsCtRows_().filter(function (x) { return String(x.ID) === String(id); })[0];
    if (!r) return _fail_('NOT_FOUND', 'Договор не найден');
    var m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ''));
    if (!m) return _fail_('VALIDATION', 'Файл не прочитан');
    if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(m[1])) return _fail_('VALIDATION', 'Допустимы PDF, JPG, PNG, WEBP');
    var bytes = Utilities.base64Decode(m[2]); if (bytes.length > 15 * 1024 * 1024) return _fail_('VALIDATION', 'Файл больше 15 МБ');
    var p = PropertiesService.getScriptProperties(), fid = p.getProperty('TS_CONTRACTS_FOLDER_ID'), folder = null;
    if (fid) try { folder = DriveApp.getFolderById(fid); } catch (e) { folder = null; }
    if (!folder) { folder = _docsFolder_().createFolder('Договоры'); p.setProperty('TS_CONTRACTS_FOLDER_ID', folder.getId()); }
    var name = String(r['Номер']).replace(/[\\/:*?"<>|]/g, '_') + ' — ' + String(r['Контрагент']).slice(0, 60) + ' — ' + String(fileName || 'договор').slice(0, 80);
    var file = folder.createFile(Utilities.newBlob(bytes, m[1], name));
    _tsCtSheet_().getRange(r._row, TS_CT_HEAD_.indexOf('Файл') + 1).setValue(file.getUrl());
    return _ok_({ url: file.getUrl() });
  } catch (e) { return _failFrom_(e); }
}
