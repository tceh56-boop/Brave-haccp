'use strict';
/** Utilities, Logger, console — то, что Apps Script даёт без внешних сервисов. */
const crypto = require('crypto');
const zlib = require('zlib');
const { Blob, toBuffer, toSigned } = require('./blob');

const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const RU_MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const RU_DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const RU_DAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

/** Части даты в часовом поясе tz (как видит человек в этом поясе). */
function partsIn(date, tz) {
  const d = new Date(date);
  if (isNaN(d.getTime())) throw new Error('Неверная дата');
  let f;
  try {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Europe/Moscow', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  } catch (e) {
    // GMT+5 и подобные
    const m = /^(?:GMT|UTC)([+-]\d{1,2})(?::?(\d{2}))?$/.exec(String(tz || ''));
    const off = m ? (Number(m[1]) * 60 + Math.sign(Number(m[1]) || 1) * Number(m[2] || 0)) : 180;
    const x = new Date(d.getTime() + off * 60000);
    return { y: x.getUTCFullYear(), M: x.getUTCMonth() + 1, d: x.getUTCDate(), H: x.getUTCHours(), m: x.getUTCMinutes(), s: x.getUTCSeconds(), wd: x.getUTCDay(), ms: d.getUTCMilliseconds(), off };
  }
  const p = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  const y = Number(p.year), M = Number(p.month), dd = Number(p.day), H = Number(p.hour) % 24, mi = Number(p.minute), s = Number(p.second);
  const off = Math.round((Date.UTC(y, M - 1, dd, H, mi, s) - (d.getTime() - d.getUTCMilliseconds())) / 60000);
  return { y, M, d: dd, H, m: mi, s, wd, ms: d.getUTCMilliseconds(), off };
}

/** Utilities.formatDate: шаблоны Java SimpleDateFormat (yyyy, MM, dd, HH, mm, ss, 'T', EEE, Z, XXX…). */
function formatDate(date, tz, pattern) {
  const p = partsIn(date, tz);
  const pad = (n, w) => String(n).padStart(w, '0');
  const offStr = (colon) => { const sgn = p.off < 0 ? '-' : '+'; const a = Math.abs(p.off); return sgn + pad(Math.floor(a / 60), 2) + (colon ? ':' : '') + pad(a % 60, 2); };
  let out = '';
  const s = String(pattern);
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j === i + 1) { out += "'"; i += 2; continue; }
      out += s.slice(i + 1, j < 0 ? s.length : j);
      i = j < 0 ? s.length : j + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(c)) { out += c; i++; continue; }
    let n = 1; while (s[i + n] === c) n++;
    i += n;
    switch (c) {
      case 'y': out += n === 2 ? pad(p.y % 100, 2) : pad(p.y, n); break;
      case 'Y': out += n === 2 ? pad(p.y % 100, 2) : pad(p.y, n); break;
      case 'M': out += n >= 4 ? RU_MONTHS[p.M - 1] : n === 3 ? RU_MONTHS_NOM[p.M - 1].slice(0, 3) : pad(p.M, n); break;
      case 'L': out += n >= 4 ? RU_MONTHS_NOM[p.M - 1] : pad(p.M, n); break;
      case 'd': out += pad(p.d, n); break;
      case 'H': out += pad(p.H, n); break;
      case 'k': out += pad(p.H || 24, n); break;
      case 'h': out += pad(p.H % 12 || 12, n); break;
      case 'm': out += pad(p.m, n); break;
      case 's': out += pad(p.s, n); break;
      case 'S': out += pad(p.ms, 3).slice(0, n); break;
      case 'E': out += n >= 4 ? RU_DAYS_FULL[p.wd] : RU_DAYS[p.wd]; break;
      case 'u': out += String(p.wd === 0 ? 7 : p.wd); break;
      case 'a': out += p.H < 12 ? 'AM' : 'PM'; break;
      case 'Z': out += offStr(false); break;
      case 'X': out += p.off === 0 ? 'Z' : offStr(n >= 3); break;
      case 'z': out += 'GMT' + offStr(true); break;
      case 'D': { const start = Date.UTC(p.y, 0, 1); out += pad(Math.floor((Date.UTC(p.y, p.M - 1, p.d) - start) / 86400000) + 1, n); break; }
      case 'w': { const t = new Date(Date.UTC(p.y, p.M - 1, p.d)); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3);
        const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); out += pad(1 + Math.round(((t - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7), n); break; }
      default: out += c.repeat(n);
    }
  }
  return out;
}

/** Разбор CSV как в Utilities.parseCsv (кавычки, переводы строк внутри кавычек). */
function parseCsv(text, delim = ',') {
  const rows = []; let row = []; let f = ''; let q = false;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/** ZIP без сжатия-зависимостей: deflate из zlib, формат по спецификации PKZIP. */
function makeZip(blobs, name) {
  const crcTable = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals = []; const central = []; let offset = 0;
  for (const bl of blobs) {
    const data = bl._buffer ? bl._buffer() : toBuffer(bl.getBytes());
    const fname = Buffer.from(String(bl.getName() || 'file'), 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(fname.length, 26);
    locals.push(lh, fname, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(fname.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, fname);
    offset += 30 + fname.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(blobs.length, 8); end.writeUInt16LE(blobs.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Blob(Buffer.concat([...locals, cd, end]), 'application/zip', name || 'archive.zip');
}

function unzip(blob) {
  const b = blob._buffer ? blob._buffer() : toBuffer(blob.getBytes());
  const out = []; let i = 0;
  while (i + 30 <= b.length && b.readUInt32LE(i) === 0x04034b50) {
    const method = b.readUInt16LE(i + 8), csize = b.readUInt32LE(i + 18), nlen = b.readUInt16LE(i + 26), xlen = b.readUInt16LE(i + 28);
    const name = b.slice(i + 30, i + 30 + nlen).toString('utf8');
    const data = b.slice(i + 30 + nlen + xlen, i + 30 + nlen + xlen + csize);
    if (!name.endsWith('/')) out.push(new Blob(method === 8 ? zlib.inflateRawSync(data) : data, null, name));
    i += 30 + nlen + xlen + csize;
  }
  return out;
}

const ALG = { MD2: 'md5', MD5: 'md5', SHA_1: 'sha1', SHA_256: 'sha256', SHA_384: 'sha384', SHA_512: 'sha512' };
const MAC = { HMAC_MD5: 'md5', HMAC_SHA_1: 'sha1', HMAC_SHA_256: 'sha256', HMAC_SHA_384: 'sha384', HMAC_SHA_512: 'sha512' };
const bytesOf = (v) => (Array.isArray(v) ? Buffer.from(v.map((x) => x & 255)) : Buffer.from(String(v), 'utf8'));

function makeUtilities() {
  return {
    DigestAlgorithm: Object.fromEntries(Object.keys(ALG).map((k) => [k, k])),
    MacAlgorithm: Object.fromEntries(Object.keys(MAC).map((k) => [k, k])),
    Charset: { UTF_8: 'UTF-8', US_ASCII: 'US-ASCII' },
    formatDate,
    formatString: (fmt, ...a) => { let i = 0; return String(fmt).replace(/%[sd%]/g, (m) => (m === '%%' ? '%' : String(a[i++]))); },
    getUuid: () => crypto.randomUUID(),
    sleep: (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(Number(ms) || 0, 300000)); },
    computeDigest: (alg, value) => toSigned(crypto.createHash(ALG[alg] || 'sha256').update(bytesOf(value)).digest()),
    computeHmacSha256Signature: (value, key) => toSigned(crypto.createHmac('sha256', bytesOf(key)).update(bytesOf(value)).digest()),
    computeHmacSignature: (alg, value, key) => toSigned(crypto.createHmac(MAC[alg] || 'sha256', bytesOf(key)).update(bytesOf(value)).digest()),
    base64Encode: (v) => bytesOf(v).toString('base64'),
    base64EncodeWebSafe: (v) => bytesOf(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64Decode: (s) => toSigned(Buffer.from(String(s), 'base64')),
    base64DecodeWebSafe: (s) => toSigned(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: (data, type, name) => new Blob(data, type, name),
    parseCsv,
    zip: makeZip,
    unzip,
    gzip: (blob, name) => new Blob(zlib.gzipSync(blob._buffer ? blob._buffer() : toBuffer(blob.getBytes())), 'application/x-gzip', name || null),
    ungzip: (blob) => new Blob(zlib.gunzipSync(blob._buffer ? blob._buffer() : toBuffer(blob.getBytes()))),
    jsonStringify: (o) => JSON.stringify(o),
    jsonParse: (s) => JSON.parse(s),
  };
}

function makeLogger(store) {
  const lines = [];
  return {
    log: (...a) => { const m = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); lines.push(m); store.log('INFO', m); return this; },
    getLog: () => lines.join('\n'),
    clear: () => { lines.length = 0; },
  };
}

module.exports = { makeUtilities, makeLogger, formatDate, partsIn, parseCsv };
