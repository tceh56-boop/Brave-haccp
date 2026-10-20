/**
 * San.Lab — Validation.gs
 * Ошибки, проверки, утилиты дат и чисел. Общий файл ядра.
 */

function AppError(code, message, details) {
  this.name = 'AppError';
  this.code = code;
  this.message = message;
  this.details = details || null;
}
AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;

function fail(code, message, details) { throw new AppError(code, message, details); }
function denied(message) { throw new AppError('ACCESS_DENIED', message || 'Нет доступа к этой записи или действию'); }
function notFound(what) { throw new AppError('NOT_FOUND', (what ? what + ': з' : 'З') + 'апись не найдена или нет доступа'); }

var V = {
  str: function (v) { return v === null || v === undefined ? '' : String(v).replace(/^\s+|\s+$/g, ''); },
  isEmpty: function (v) { return v === null || v === undefined || (typeof v === 'string' && V.str(v) === ''); },
  required: function (obj, fields, labels) {
    var missing = [];
    for (var i = 0; i < fields.length; i++) {
      if (V.isEmpty(obj[fields[i]])) missing.push((labels && labels[fields[i]]) || fields[i]);
    }
    if (missing.length) fail('VALIDATION', 'Заполните обязательные поля: ' + missing.join(', '), { missing: missing });
  },
  oneOf: function (value, dict, label) {
    if (!dict.hasOwnProperty(value)) fail('VALIDATION', 'Недопустимое значение поля «' + label + '»: ' + value);
  },
  num: function (v, label, opts) {
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
    if (isNaN(n)) fail('VALIDATION', 'Поле «' + label + '» должно быть числом');
    if (opts && opts.positive && n <= 0) fail('VALIDATION', 'Поле «' + label + '» должно быть больше нуля');
    if (opts && opts.nonNegative && n < 0) fail('VALIDATION', 'Поле «' + label + '» не может быть отрицательным');
    return Math.round(n * 100) / 100;
  },
  date: function (v, label) {
    if (V.isEmpty(v)) fail('VALIDATION', 'Укажите «' + label + '»');
    var d = new Date(v);
    if (isNaN(d.getTime())) fail('VALIDATION', 'Неверная дата в поле «' + label + '»');
    return d.toISOString();
  },
  inn: function (v) {
    var s = V.str(v);
    if (s && !/^(\d{10}|\d{12})$/.test(s)) fail('VALIDATION', 'ИНН должен содержать 10 или 12 цифр');
    return s;
  },
  email: function (v) {
    var s = V.str(v).toLowerCase();
    if (s && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) fail('VALIDATION', 'Неверный формат e-mail');
    return s;
  },
  bool: function (v) { return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1' || v === 'да'; }
};

/* ---------- Даты (ISO-строки в ядре) ---------- */
var DAY_MS = 86400000;
function isoAddDays(iso, days) { return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString(); }
function isoAddHours(iso, h) { return new Date(new Date(iso).getTime() + h * 3600000).toISOString(); }
function isBefore(a, b) { return new Date(a).getTime() < new Date(b).getTime(); }

/* Сдвиг часового пояса для группировки по дням (минуты), берётся из TZ-настройки при наличии */
var TZ_OFFSET_MIN = 300; // Asia/Yekaterinburg, Оренбург (UTC+5)
function localDayKey(iso) {
  if (!iso) return '';
  var d = new Date(new Date(iso).getTime() + TZ_OFFSET_MIN * 60000);
  return d.toISOString().slice(0, 10);
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function fmtDT(iso) {
  if (!iso) return '—';
  var d = new Date(new Date(iso).getTime() + TZ_OFFSET_MIN * 60000);
  return pad2(d.getUTCDate()) + '.' + pad2(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear() + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}
function fmtD(iso) { return iso ? fmtDT(iso).slice(0, 10) : '—'; }
function fmtMoney(n) {
  var v = Math.round((Number(n) || 0) * 100) / 100;
  var parts = v.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (parts[1] === '00' ? parts[0] : parts.join(',')) + ' ₽';
}

/* ---------- Коллекции ---------- */
function indexBy(arr, key) { var m = {}; for (var i = 0; i < arr.length; i++) m[arr[i][key]] = arr[i]; return m; }
function groupBy(arr, key) { var m = {}; for (var i = 0; i < arr.length; i++) { var k = arr[i][key]; (m[k] = m[k] || []).push(arr[i]); } return m; }
function filterBy(arr, fn) { var out = []; for (var i = 0; i < arr.length; i++) if (fn(arr[i])) out.push(arr[i]); return out; }
function pick(obj, keys) { var o = {}; for (var i = 0; i < keys.length; i++) if (obj.hasOwnProperty(keys[i])) o[keys[i]] = obj[keys[i]]; return o; }
function sumBy(arr, key) { var s = 0; for (var i = 0; i < arr.length; i++) s += Number(arr[i][key]) || 0; return Math.round(s * 100) / 100; }
function sortBy(arr, key, desc) {
  return arr.slice().sort(function (a, b) {
    var x = a[key] || '', y = b[key] || '';
    if (x < y) return desc ? 1 : -1;
    if (x > y) return desc ? -1 : 1;
    return 0;
  });
}
function csvList(s) { return V.str(s) ? V.str(s).split(/\s*,\s*/) : []; }
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
function safeJson(s, fallback) { try { return JSON.parse(s); } catch (e) { return fallback; } }
function shortJson(obj) {
  if (obj === null || obj === undefined) return '';
  var s = JSON.stringify(obj);
  return s.length > 4000 ? s.slice(0, 4000) + '…' : s;
}
/* Поля, которые никогда не пишутся в аудит и не уходят клиенту */
var SECRET_FIELDS = ['pin_hash', 'snapshot_json'];
function stripSecrets(obj) {
  if (!obj) return obj;
  var o = {};
  for (var k in obj) if (obj.hasOwnProperty(k) && SECRET_FIELDS.indexOf(k) < 0) o[k] = obj[k];
  return o;
}
function diffObj(oldO, newO) {
  var a = {}, b = {};
  for (var k in newO) {
    if (!newO.hasOwnProperty(k) || SECRET_FIELDS.indexOf(k) >= 0 || k === 'updated_at' || k === 'row_version') continue;
    var ov = oldO ? oldO[k] : undefined;
    if (String(ov === undefined || ov === null ? '' : ov) !== String(newO[k] === null || newO[k] === undefined ? '' : newO[k])) { a[k] = ov; b[k] = newO[k]; }
  }
  return { oldV: a, newV: b };
}
