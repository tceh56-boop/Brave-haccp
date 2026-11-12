'use strict';
/**
 * UrlFetchApp: синхронный HTTP-запрос, как в Apps Script. Node умеет только асинхронный fetch, поэтому запрос
 * выполняет короткоживущий дочерний процесс (fetch_worker.js), а основной ждёт его ответа (execFileSync).
 * Так работают Yandex Vision, YandexGPT, Меркурий, ЮKassa и проверка лицензии.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const { Blob, toBuffer } = require('./blob');

const WORKER = path.join(__dirname, 'fetch_worker.js');

function buildRequest(url, p = {}) {
  const method = String(p.method || 'get').toUpperCase();
  const headers = {};
  Object.keys(p.headers || {}).forEach((k) => { headers[k] = String(p.headers[k]); });
  let body = null;
  if (p.payload !== undefined && p.payload !== null && method !== 'GET') {
    const pl = p.payload;
    if (typeof pl === 'string') { body = Buffer.from(pl, 'utf8'); headers['Content-Type'] = headers['Content-Type'] || p.contentType || 'application/x-www-form-urlencoded'; }
    else if (pl && typeof pl.getBytes === 'function') { body = pl._buffer ? pl._buffer() : toBuffer(pl.getBytes()); headers['Content-Type'] = headers['Content-Type'] || p.contentType || pl.getContentType() || 'application/octet-stream'; }
    else if (Array.isArray(pl)) { body = toBuffer(pl); headers['Content-Type'] = headers['Content-Type'] || p.contentType || 'application/octet-stream'; }
    else if (typeof pl === 'object') {
      const hasBlob = Object.values(pl).some((v) => v && typeof v.getBytes === 'function');
      if (hasBlob) {
        const boundary = '----tsekh' + Date.now().toString(16);
        const parts = [];
        for (const [k, v] of Object.entries(pl)) {
          if (v && typeof v.getBytes === 'function') {
            parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"; filename="${v.getName() || 'file'}"\r\nContent-Type: ${v.getContentType() || 'application/octet-stream'}\r\n\r\n`));
            parts.push(v._buffer ? v._buffer() : toBuffer(v.getBytes())); parts.push(Buffer.from('\r\n'));
          } else parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
        }
        parts.push(Buffer.from(`--${boundary}--\r\n`));
        body = Buffer.concat(parts); headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
      } else {
        body = Buffer.from(new URLSearchParams(Object.entries(pl).map(([k, v]) => [k, String(v)])).toString(), 'utf8');
        headers['Content-Type'] = headers['Content-Type'] || p.contentType || 'application/x-www-form-urlencoded';
      }
    }
  }
  return { url: String(url), method, headers, body: body ? body.toString('base64') : null, redirect: p.followRedirects === false ? 'manual' : 'follow',
    insecure: p.validateHttpsCertificates === false, mute: !!p.muteHttpExceptions };
}

class HTTPResponse {
  constructor(r) { this._r = r; this._b = Buffer.from(r.body || '', 'base64'); }
  getResponseCode() { return this._r.status; }
  getContentText(charset) { return this._b.toString(charset && /1251/.test(charset) ? 'latin1' : 'utf8'); }
  getContent() { return Array.from(this._b, (b) => (b > 127 ? b - 256 : b)); }
  getBlob() { return new Blob(this._b, this._r.headers['content-type'] || null, null); }
  getAs(t) { return this.getBlob().getAs(t); }
  getHeaders() { const o = {}; for (const k of Object.keys(this._r.headers)) o[k.replace(/(^|-)([a-z])/g, (m, a, b) => a + b.toUpperCase())] = this._r.headers[k]; return o; }
  getAllHeaders() { return this.getHeaders(); }
}

function run(reqs, timeoutMs) {
  const out = execFileSync(process.execPath, [WORKER], { input: JSON.stringify(reqs), maxBuffer: 200 * 1024 * 1024, timeout: timeoutMs, env: process.env });
  return JSON.parse(out.toString('utf8'));
}

function makeUrlFetch(tenant) {
  const local = (req) => /^https:\/\/(www|script)\.googleapis\.com\//.test(req.url);
  const one = (req) => {
    const res = local(req) ? require('./googleapi').handle(req.url, req, tenant, api) : run([req], 120000)[0];
    if (res.error) throw new Error(`Адрес недоступен: ${req.url} (${res.error})`);
    if (res.status >= 400 && !req.mute) throw new Error(`Запрос к ${req.url} вернул код ${res.status}. Ответ сервера: ${Buffer.from(res.body || '', 'base64').toString('utf8').slice(0, 500)}`);
    return new HTTPResponse(res);
  };
  const api = {
    fetch: (url, params) => one(buildRequest(url, params)),
    fetchAll: (list) => {
      const reqs = list.map((x) => (typeof x === 'string' ? buildRequest(x) : buildRequest(x.url, x)));
      if (reqs.some(local)) return reqs.map((r) => one(r));
      return run(reqs, 180000).map((res, i) => {
        if (res.error) throw new Error(`Адрес недоступен: ${reqs[i].url} (${res.error})`);
        if (res.status >= 400 && !reqs[i].mute) throw new Error(`Запрос к ${reqs[i].url} вернул код ${res.status}`);
        return new HTTPResponse(res);
      });
    },
    getRequest: (url, params) => { const r = buildRequest(url, params); return { url: r.url, method: r.method.toLowerCase(), headers: r.headers, payload: r.body ? Buffer.from(r.body, 'base64').toString('utf8') : '' }; },
  };
  return api;
}

module.exports = { makeUrlFetch, buildRequest };
