/**
 * ЦЕХ Стандарт Admin — общие помощники: ответы, даты, идентификаторы, подписи.
 */
function ok(data) { return { ok: true, data: data === undefined ? null : data }; }
function fail(e) {
  var msg = String(e && e.message || e), code = 'ERROR';
  ['AUTH', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'BUSY'].forEach(function (k) { if (msg.indexOf(k + ':') === 0) { code = k; msg = msg.slice(k.length + 1).trim(); } });
  if (code === 'ERROR') logError('admin', msg, e && e.stack);
  return { ok: false, code: code, error: msg };
}
function tz() { return Session.getScriptTimeZone() || 'Europe/Moscow'; }
function fmtDate(d, f) { if (!d) return ''; var x = d instanceof Date ? d : new Date(d); return isNaN(x) ? '' : Utilities.formatDate(x, tz(), f || 'dd.MM.yyyy'); }
function isoDay(d) { return fmtDate(d || new Date(), 'yyyy-MM-dd'); }
function addMonths(d, m) { var x = new Date(d instanceof Date ? d.getTime() : new Date(d).getTime()); x.setMonth(x.getMonth() + m); return x; }
function daysBetween(a, b) { return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 864e5); }
function newId(prefix) { return prefix + '-' + Utilities.formatDate(new Date(), 'UTC', 'yyMMddHHmmss') + '-' + Math.floor(Math.random() * 9000 + 1000); }
function randomToken(n) {
  var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '', b = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  for (var i = 0; i < n; i++) s += abc.charAt(parseInt(b.substr((i * 2) % 60, 2), 16) % abc.length);
  return s;
}
function hex(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function sha256(text) { return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)); }
function hmac(text, secret) { return hex(Utilities.computeHmacSha256Signature(String(text), String(secret), Utilities.Charset.UTF_8)); }
/** Сравнение строк за постоянное время (подписи, хэши). */
function safeEqual(a, b) { a = String(a || ''); b = String(b || ''); if (a.length !== b.length) return false; var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
function money(n) { return (Number(n) || 0).toLocaleString('ru-RU') + ' ₽'; }
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function req(obj, keys) { var miss = keys.filter(function (k) { return obj[k] === undefined || obj[k] === null || String(obj[k]).trim() === ''; }); if (miss.length) throw new Error('VALIDATION: заполните ' + miss.join(', ')); }
function webAppUrl() { try { return ScriptApp.getService().getUrl(); } catch (e) { return ''; } }
