/**
 * ЦЕХ Стандарт — настройки организации (ТЗ «Итоговая структура…», §9) и общая шапка PDF.
 *
 * Хранится: название, юридический и фактический адрес, ИНН, КПП, ОГРН/ОГРНИП, банковские реквизиты,
 * ответственное лицо, телефон, электронная почта и логотип. Эти данные и логотип подставляются
 * в каждый PDF, который формирует система (отчёты, ППК, ТУ, протоколы, акты, подписанные журналы,
 * снимки журналов, документы), и в шапку бланков журналов.
 *
 * Ничего не придумывается: пустое поле остаётся пустым, в PDF вместо него — строка «не заполнено».
 * ИНН, ОГРН/ОГРНИП, БИК и счета проверяются по контрольным числам — опечатка не попадёт в документы.
 * Хранение: свойство скрипта MC_ORG_SETTINGS (JSON) и файл логотипа на Диске (MC_ORG_LOGO).
 * Прежние свойства (MC_ORG_NAME, ORG_NAME, MC_ORG_INN, MC_ORG_ADDRESS, LOCATION_NAME) обновляются
 * из настроек — старые экраны и журналы видят те же реквизиты.
 * Изменение — с правом org_edit (Директор, технический доступ), каждое — в журнал аудита (было → стало).
 */
var MC_ORG_KEY_ = 'MC_ORG_SETTINGS', MC_ORG_LOGO_KEY_ = 'MC_ORG_LOGO';
// [ключ, подпись, обязательное для полноты реквизитов]
var MC_ORG_FIELDS_ = [
  ['name', 'Полное наименование', true], ['shortName', 'Краткое наименование', false], ['objectName', 'Объект (название предприятия питания)', false],
  ['legalAddress', 'Юридический адрес', true], ['actualAddress', 'Фактический адрес объекта', true],
  ['inn', 'ИНН', true], ['kpp', 'КПП', false], ['ogrn', 'ОГРН / ОГРНИП', false], ['okpo', 'ОКПО (для форм ОП)', false],
  ['division', 'Структурное подразделение (для форм ОП)', false], ['directorName', 'Руководитель (ФИО, для «Утверждаю»)', false], ['directorPosition', 'Должность руководителя', false],
  ['bank', 'Банк', false], ['bik', 'БИК', false], ['account', 'Расчётный счёт', false], ['corrAccount', 'Корреспондентский счёт', false],
  ['responsibleName', 'Ответственное лицо (ФИО)', true], ['responsiblePosition', 'Должность ответственного', false],
  ['phone', 'Телефон', true], ['email', 'Электронная почта', true]
];
var MC_ORG_LOGO_MAX_ = 400 * 1024;
var MC_ORG_LOGO_MIME_ = ['image/png', 'image/jpeg'];

/* ---------------- чтение ---------------- */
function _mcOrgRaw_() {
  var p = PropertiesService.getScriptProperties(), o = {};
  try { o = JSON.parse(p.getProperty(MC_ORG_KEY_) || '{}') || {}; } catch (e) { o = {}; }
  return o;
}
/** Реквизиты организации. Если настройки ещё не сохранялись — то, что было в прежних свойствах (из ППК V35). */
function _mcOrg_() {
  var o = _mcOrgRaw_(), out = {};
  MC_ORG_FIELDS_.forEach(function (f) { out[f[0]] = String(o[f[0]] === undefined || o[f[0]] === null ? '' : o[f[0]]).trim(); });
  if (!out.name) {
    var p = PropertiesService.getScriptProperties();
    out.name = String(p.getProperty('MC_ORG_NAME') || p.getProperty('ORG_NAME') || '').trim();
    if (!out.inn) out.inn = String(p.getProperty('MC_ORG_INN') || '').trim();
    if (!out.actualAddress) out.actualAddress = String(p.getProperty('MC_ORG_ADDRESS') || '').trim();
    out.legacy = !!out.name;
  }
  out.updatedAt = o.updatedAt || ''; out.updatedBy = o.updatedBy || '';
  return out;
}
function _mcOrgLogoMeta_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(MC_ORG_LOGO_KEY_) || 'null'); } catch (e) { return null; } }
/** Полнота реквизитов: чего не хватает для документов (логотип рекомендуется, но не обязателен). */
function _mcOrgCompleteness_(o) {
  o = o || _mcOrg_();
  var missing = MC_ORG_FIELDS_.filter(function (f) { return f[2] && !o[f[0]]; }).map(function (f) { return f[1]; });
  var logo = _mcOrgLogoMeta_();
  return { complete: !missing.length, missing: missing, logo: !!(logo && logo.fileId), status: missing.length ? 'MISSING_EVIDENCE' : 'PASS' };
}

/* ---------------- проверки реквизитов ---------------- */
function _mcOrgDigits_(s) { return String(s || '').replace(/\s+/g, ''); }
function _mcOrgInnOk_(inn) {
  var s = _mcOrgDigits_(inn); if (!/^\d{10}$|^\d{12}$/.test(s)) return false;
  var d = s.split('').map(Number), c = function (w) { var t = 0; for (var i = 0; i < w.length; i++) t += w[i] * d[i]; return (t % 11) % 10; };
  if (s.length === 10) return c([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  return c([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && c([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
}
function _mcOrgModStr_(s, m) { var r = 0; for (var i = 0; i < s.length; i++) r = (r * 10 + Number(s[i])) % m; return r; }
function _mcOrgOgrnOk_(v) {
  var s = _mcOrgDigits_(v);
  if (/^\d{13}$/.test(s)) return (_mcOrgModStr_(s.slice(0, 12), 11) % 10) === Number(s[12]);
  if (/^\d{15}$/.test(s)) return (_mcOrgModStr_(s.slice(0, 14), 13) % 10) === Number(s[14]);
  return false;
}
function _mcOrgKey713_(s) { var w = [7, 1, 3], t = 0; for (var i = 0; i < s.length; i++) t += (Number(s[i]) * w[i % 3]) % 10; return t % 10 === 0; }
/** Проверка реквизитов. Возвращает список ошибок (пусто — всё верно). Пустые необязательные поля не проверяются. */
function _mcOrgValidate_(o) {
  var e = [];
  if (o.inn && !_mcOrgInnOk_(o.inn)) e.push('ИНН: 10 цифр (организация) или 12 (ИП), контрольное число не сходится — проверьте цифры');
  if (o.kpp && !/^\d{4}[\dA-Z]{2}\d{3}$/.test(_mcOrgDigits_(o.kpp))) e.push('КПП: 9 знаков');
  if (o.kpp && _mcOrgDigits_(o.inn).length === 12) e.push('КПП у индивидуального предпринимателя (ИНН из 12 цифр) не указывается');
  if (o.okpo && !/^(\d{8}|\d{10})$/.test(_mcOrgDigits_(o.okpo))) e.push('ОКПО: 8 цифр (организация) или 10 (ИП)');
  if (o.ogrn && !_mcOrgOgrnOk_(o.ogrn)) e.push('ОГРН (13 цифр) или ОГРНИП (15 цифр): контрольное число не сходится');
  var bik = _mcOrgDigits_(o.bik);
  if (o.bik && !/^04\d{7}$/.test(bik)) e.push('БИК: 9 цифр, начинается с 04');
  if (o.account) {
    var acc = _mcOrgDigits_(o.account);
    if (!/^\d{20}$/.test(acc)) e.push('Расчётный счёт: 20 цифр');
    else if (!/^04\d{7}$/.test(bik)) e.push('Для проверки расчётного счёта укажите БИК банка');
    else if (!_mcOrgKey713_(bik.slice(-3) + acc)) e.push('Расчётный счёт не соответствует БИК (контрольный ключ) — проверьте цифры');
  }
  if (o.corrAccount) {
    var ks = _mcOrgDigits_(o.corrAccount);
    if (!/^301\d{17}$/.test(ks)) e.push('Корреспондентский счёт: 20 цифр, начинается с 301');
    else if (/^04\d{7}$/.test(bik) && !_mcOrgKey713_('0' + bik.slice(4, 6) + ks)) e.push('Корреспондентский счёт не соответствует БИК — проверьте цифры');
  }
  if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(o.email).trim())) e.push('Электронная почта указана неверно');
  if (o.phone) { var ph = String(o.phone).replace(/\D/g, ''); if (ph.length < 10 || ph.length > 12) e.push('Телефон: 10–11 цифр, например +7 912 345-67-89'); }
  ['name', 'legalAddress', 'actualAddress', 'responsibleName'].forEach(function (k) { if (o[k] && String(o[k]).length > 300) e.push('Слишком длинное поле: ' + k); });
  return e;
}

/* ---------------- API ---------------- */
/** Реквизиты, полнота и сведения о логотипе (для экрана «Настройки → Организация»). */
function mcOrgGet(token) {
  try {
    _requireAuth_(token);
    var o = _mcOrg_(), logo = _mcOrgLogoMeta_(), c = _mcOrgCompleteness_(o);
    return _ok_({ settings: o, fields: MC_ORG_FIELDS_.map(function (f) { return { key: f[0], label: f[1], required: !!f[2] }; }),
      completeness: c, logo: logo ? { name: logo.name, mime: logo.mime, size: logo.size, sha256: logo.sha256, at: logo.at, by: logo.by, dataUri: _mcOrgLogoDataUri_() } : null });
  } catch (e) { return _failFrom_(e); }
}

/** Сохранить реквизиты. Пустое поле в запросе — очистить; поле, которого нет в запросе, — не менять. */
function mcOrgSave(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'org_edit', 'ORG_SETTINGS_SAVE', 'Организация', 'ORG', null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    return _withLock_(function () {
      var before = _mcOrgRaw_(), next = {};
      MC_ORG_FIELDS_.forEach(function (f) {
        var k = f[0], v = Object.prototype.hasOwnProperty.call(d, k) ? d[k] : before[k];
        v = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
        if (/^(inn|kpp|ogrn|okpo|bik|account|corrAccount)$/.test(k)) v = v.replace(/\s+/g, '').toUpperCase();
        next[k] = v;
      });
      var errs = _mcOrgValidate_(next);
      if (errs.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', errs.join('; '), op.id); }
      var who = op.session && op.session.dev ? MC_RB_TECH_ : ((op.session && (op.session.fullName || op.session.name)) || '');
      next.updatedAt = new Date().toISOString(); next.updatedBy = who;
      var p = PropertiesService.getScriptProperties();
      p.setProperty(MC_ORG_KEY_, JSON.stringify(next));
      // прежние свойства — для журналов, подписанных PDF и экранов, которые их читают
      if (next.name) { p.setProperty('MC_ORG_NAME', next.name); p.setProperty('ORG_NAME', next.name); }
      p.setProperty('MC_ORG_INN', next.inn || '');
      p.setProperty('MC_ORG_ADDRESS', next.actualAddress || next.legalAddress || '');
      if (next.objectName || next.actualAddress) p.setProperty('LOCATION_NAME', [next.objectName, next.actualAddress].filter(String).join(', '));
      var changed = MC_ORG_FIELDS_.filter(function (f) { return String(before[f[0]] || '') !== String(next[f[0]] || ''); }).map(function (f) { return f[1]; });
      var bOut = {}, aOut = {};
      MC_ORG_FIELDS_.forEach(function (f) { if (String(before[f[0]] || '') !== String(next[f[0]] || '')) { bOut[f[0]] = before[f[0]] || ''; aOut[f[0]] = next[f[0]] || ''; } });
      _audit_(op, 'ORG_SETTINGS_SAVE', 'Организация', 'ORG', bOut, aOut);
      _endOp_(op);
      return _ok_({ settings: _mcOrg_(), changed: changed, completeness: _mcOrgCompleteness_() }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

function _mcOrgFolder_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('MC_ORG_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = _docsFolder_().createFolder('Организация'); p.setProperty('MC_ORG_FOLDER_ID', f.getId()); return f;
}

/** Загрузить логотип (PNG или JPEG до 400 КБ, base64 из браузера). Прежний файл уходит в корзину Диска. */
function mcOrgSetLogo(b64, mime, fileName, token) {
  var op = null;
  try { op = _beginOp_(token, 'org_edit', 'ORG_LOGO_SET', 'Организация', 'LOGO', null); } catch (e) { return _failFrom_(e); }
  try {
    mime = String(mime || '').toLowerCase();
    if (MC_ORG_LOGO_MIME_.indexOf(mime) < 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Логотип: файл PNG или JPEG', op.id); }
    var raw = String(b64 || '').replace(/^data:[^,]+,/, '');
    if (!raw) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Файл логотипа пуст', op.id); }
    var bytes = Utilities.base64Decode(raw);
    if (!bytes.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Файл логотипа пуст', op.id); }
    if (bytes.length > MC_ORG_LOGO_MAX_) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Логотип больше 400 КБ — уменьшите изображение', op.id); }
    var b0 = bytes[0] & 255, b1 = bytes[1] & 255;
    var isPng = b0 === 0x89 && b1 === 0x50, isJpg = b0 === 0xFF && b1 === 0xD8;
    if ((mime === 'image/png' && !isPng) || (mime === 'image/jpeg' && !isJpg)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Содержимое файла не похоже на ' + (mime === 'image/png' ? 'PNG' : 'JPEG'), op.id); }
    return _withLock_(function () {
      var prev = _mcOrgLogoMeta_();
      var name = 'Логотип организации' + (mime === 'image/png' ? '.png' : '.jpg');
      var file = _mcOrgFolder_().createFile(Utilities.newBlob(bytes, mime, name));
      if (prev && prev.fileId) { try { DriveApp.getFileById(prev.fileId).setTrashed(true); } catch (e) {} }
      var who = op.session && op.session.dev ? MC_RB_TECH_ : ((op.session && (op.session.fullName || op.session.name)) || '');
      var meta = { fileId: file.getId(), name: String(fileName || name).slice(0, 120), mime: mime, size: bytes.length,
        sha256: _bkHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)), at: new Date().toISOString(), by: who };
      PropertiesService.getScriptProperties().setProperty(MC_ORG_LOGO_KEY_, JSON.stringify(meta));
      _MC_ORG_LOGO_URI_ = null;
      _audit_(op, 'ORG_LOGO_SET', 'Организация', meta.fileId, prev ? { fileId: prev.fileId, sha256: prev.sha256 } : null, { fileId: meta.fileId, sha256: meta.sha256, size: meta.size });
      _endOp_(op);
      return _ok_({ logo: meta }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

function mcOrgRemoveLogo(token) {
  var op = null;
  try { op = _beginOp_(token, 'org_edit', 'ORG_LOGO_REMOVE', 'Организация', 'LOGO', null); } catch (e) { return _failFrom_(e); }
  try {
    var prev = _mcOrgLogoMeta_();
    if (!prev) { _endOp_(op); return _ok_({ removed: false }, op.id); }
    PropertiesService.getScriptProperties().deleteProperty(MC_ORG_LOGO_KEY_);
    _MC_ORG_LOGO_URI_ = null;
    _audit_(op, 'ORG_LOGO_REMOVE', 'Организация', prev.fileId, { fileId: prev.fileId, sha256: prev.sha256 }, null);
    _endOp_(op);
    return _ok_({ removed: true }, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/** Как будет выглядеть шапка документов (HTML) — для предпросмотра на экране настроек. */
function mcOrgHeaderPreview(token) {
  try { _requireAuth_(token); return _ok_({ html: _mcOrgHeaderHtml_('Образец документа', 'Так реквизиты и логотип выглядят в PDF') }); } catch (e) { return _failFrom_(e); }
}

/* ---------------- шапка и PDF ---------------- */
var _MC_ORG_LOGO_URI_ = null;
function _mcOrgLogoDataUri_() {
  if (_MC_ORG_LOGO_URI_ !== null) return _MC_ORG_LOGO_URI_;
  var m = _mcOrgLogoMeta_(), uri = '';
  if (m && m.fileId) { try { var b = DriveApp.getFileById(m.fileId).getBlob(); uri = 'data:' + (m.mime || b.getContentType()) + ';base64,' + Utilities.base64Encode(b.getBytes()); } catch (e) { uri = ''; } }
  return (_MC_ORG_LOGO_URI_ = uri);
}
function _mcOrgEsc_(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
/** Строка реквизитов одной строкой (бланки журналов, подписи). */
function _mcOrgLine_(o) {
  o = o || _mcOrg_();
  return [o.name, o.inn ? 'ИНН ' + o.inn + (o.kpp ? ' / КПП ' + o.kpp : '') : '', o.ogrn ? (o.ogrn.length === 15 ? 'ОГРНИП ' : 'ОГРН ') + o.ogrn : '',
    o.actualAddress ? 'адрес: ' + o.actualAddress : ''].filter(String).join(', ');
}
/** Шапка документа: логотип, наименование, адреса, ИНН/КПП/ОГРН, банк, ответственный, контакты; затем заголовок. */
function _mcOrgHeaderHtml_(title, subtitle) {
  var o = _mcOrg_(), c = _mcOrgCompleteness_(o), logo = _mcOrgLogoDataUri_(), E = _mcOrgEsc_;
  var row = function (l, v) { return v ? '<div><span style="color:#666">' + E(l) + ':</span> ' + E(v) + '</div>' : ''; };
  var bank = [o.bank, o.bik ? 'БИК ' + o.bik : '', o.account ? 'р/с ' + o.account : '', o.corrAccount ? 'к/с ' + o.corrAccount : ''].filter(String).join(', ');
  var req = [o.inn ? 'ИНН ' + o.inn : '', o.kpp ? 'КПП ' + o.kpp : '', o.ogrn ? (o.ogrn.length === 15 ? 'ОГРНИП ' : 'ОГРН ') + o.ogrn : ''].filter(String).join(' · ');
  var h = '<table style="width:100%;border-collapse:collapse;border-bottom:2px solid #a87b22;margin-bottom:10px;font-family:Arial,sans-serif"><tr>' +
    (logo ? '<td style="width:96px;vertical-align:top;padding:0 10px 6px 0"><img src="' + logo + '" style="max-width:90px;max-height:64px"></td>' : '') +
    '<td style="vertical-align:top;font-size:9px;line-height:1.35;padding-bottom:6px">' +
    '<div style="font-size:12px;font-weight:bold">' + E(o.name || 'Наименование организации не заполнено (Настройки → Организация)') + '</div>' +
    (o.objectName ? '<div>' + E(o.objectName) + '</div>' : '') +
    row('Юридический адрес', o.legalAddress) + row('Фактический адрес', o.actualAddress) + (req ? '<div>' + E(req) + '</div>' : '') + row('Банк', bank) +
    row('Ответственный', [o.responsibleName, o.responsiblePosition].filter(String).join(', ')) + row('Телефон', o.phone) + row('Эл. почта', o.email) +
    (c.complete ? '' : '<div style="color:#a33">Не заполнено в настройках организации: ' + E(c.missing.join(', ')) + '</div>') +
    '</td></tr></table>';
  if (title) h += '<h1 style="font-family:Arial,sans-serif;font-size:15px;margin:6px 0 2px">' + E(title) + '</h1>';
  if (subtitle) h += '<div style="font-family:Arial,sans-serif;font-size:10px;color:#555;margin-bottom:8px">' + E(subtitle) + '</div>';
  return h;
}
function _mcOrgFooterHtml_(extra) {
  var o = _mcOrg_();
  return '<div style="margin-top:14px;border-top:1px solid #bbb;padding-top:4px;font-family:Arial,sans-serif;font-size:8px;color:#666">' +
    'Сформировано в ЦЕХ Стандарт ' + Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH:mm') + (o.name ? ' · ' + _mcOrgEsc_(o.name) : '') + (extra ? ' · ' + _mcOrgEsc_(extra) : '') + '</div>';
}
/** Полный HTML документа: шапка с реквизитами и логотипом, тело, подвал. */
function _mcPdfHtml_(title, bodyHtml, opts) {
  opts = opts || {};
  return '<html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:9px;color:#111;margin:18px}' +
    'h2{font-size:12px;margin:12px 0 4px}h3{font-size:10px;margin:10px 0 3px}table.r{width:100%;border-collapse:collapse;margin:4px 0}' +
    'table.r th,table.r td{border:1px solid #bbb;padding:2px 4px;text-align:left;vertical-align:top}table.r th{background:#f2ece4}' +
    'td.n,th.n{text-align:right}.muted{color:#666}.bad{color:#a33}.ok{color:#2d6a2d}.sign{margin-top:24px;font-size:10px}' + (opts.css || '') + '</style></head><body' + (opts.landscape ? ' style="width:1000px"' : '') + '>' +
    _mcOrgHeaderHtml_(title, opts.subtitle) + bodyHtml + _mcOrgFooterHtml_(opts.footer) + '</body></html>';
}
function _mcReportsFolder_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('MC_REPORTS_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = _docsFolder_().createFolder('Отчёты'); p.setProperty('MC_REPORTS_FOLDER_ID', f.getId()); return f;
}
/** Сохранить PDF (шапка организации подставляется сама). Возвращает файл, ссылку и SHA-256 содержимого. */
function _mcPdfSave_(title, bodyHtml, opts) {
  opts = opts || {};
  var html = _mcPdfHtml_(title, bodyHtml, opts);
  var name = String(opts.fileName || title).replace(/[\\\/:*?"<>|]+/g, ' ').slice(0, 150) + '.pdf';
  var pdf = Utilities.newBlob(html, 'text/html', 'doc.html').getAs('application/pdf').setName(name);
  var folder = opts.folder || _mcReportsFolder_();
  var file = folder.createFile(pdf);
  var hash = _bkHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pdf.getBytes()));
  return { fileId: file.getId(), url: file.getUrl(), name: name, sha256: hash };
}
