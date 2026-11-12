'use strict';
/** Blob Apps Script (Utilities.newBlob, файлы Диска, ответы UrlFetchApp). Байты — Buffer; наружу, как в Google, — Byte[] со знаком. */
const { htmlToPdf } = require('../pdf');

const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
function toBuffer(data, charset) {
  if (data === null || data === undefined) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return Buffer.from(data);
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.from(data.map((b) => b & 255));
  if (data && typeof data.getBytes === 'function') return Buffer.from(data.getBytes().map((b) => b & 255));
  return Buffer.from(String(data), charset === 'windows-1251' ? 'latin1' : 'utf8');
}

class Blob {
  constructor(data, contentType, name) {
    this._b = toBuffer(data);
    this._type = contentType || null;
    this._name = name || null;
  }
  getBytes() { return toSigned(this._b); }
  _buffer() { return this._b; }
  setBytes(d) { this._b = toBuffer(d); return this; }
  getDataAsString(charset) { return this._b.toString(charset && /1251/.test(charset) ? 'latin1' : 'utf8'); }
  setDataFromString(s) { this._b = Buffer.from(String(s), 'utf8'); return this; }
  getContentType() { return this._type; }
  setContentType(t) { this._type = t; return this; }
  setContentTypeFromExtension() { return this; }
  getName() { return this._name; }
  setName(n) { this._name = n; return this; }
  getSize() { return this._b.length; }
  isGoogleType() { return false; }
  copyBlob() { return new Blob(this._b, this._type, this._name); }
  getBlob() { return this; }
  getAllBlobs() { return [this]; }
  /** Перевод в PDF. В Apps Script так печатают HTML — здесь то же делает Chromium внутри контейнера. */
  getAs(type) {
    if (String(type).toLowerCase() !== 'application/pdf') {
      if (String(type) === this._type) return this.copyBlob();
      throw new Error(`Перевод файла в ${type} в облачной версии не поддерживается`);
    }
    if (this._type === 'application/pdf') return this.copyBlob();
    const pdf = htmlToPdf(this.getDataAsString());
    const name = this._name ? String(this._name).replace(/\.[^.]+$/, '') + '.pdf' : null;
    return new Blob(pdf, 'application/pdf', name);
  }
}

module.exports = { Blob, toBuffer, toSigned };
