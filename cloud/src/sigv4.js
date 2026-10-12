// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * Подпись запросов AWS Signature Version 4 — так авторизуются Yandex Object Storage (S3)
 * и Yandex Cloud Postbox (API, совместимый с SES). Без внешних библиотек.
 */
const crypto = require('crypto');

const sha256hex = data => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// RFC 3986: всё, кроме A-Z a-z 0-9 - _ . ~, кодируется; '/' в пути сохраняется.
function uriEncode(s, keepSlash) {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%2F/g, keepSlash ? '/' : '%2F');
}

function amzDate(d) { return d.toISOString().replace(/[:-]|\.\d{3}/g, ''); }

/**
 * opts: { method, url, region, service, headers, body, accessKeyId, secretAccessKey, date, unsignedPayload }
 * Возвращает заголовки для запроса (исходные + host, x-amz-date, при необходимости x-amz-content-sha256, authorization).
 */
function sign(opts) {
  const u = new URL(opts.url);
  const date = opts.date || new Date();
  const stamp = amzDate(date), day = stamp.slice(0, 8);
  const body = opts.body === undefined || opts.body === null ? '' : opts.body;
  const payloadHash = opts.unsignedPayload ? 'UNSIGNED-PAYLOAD' : sha256hex(body);
  const headers = {};
  Object.keys(opts.headers || {}).forEach(k => { headers[k.toLowerCase()] = String(opts.headers[k]).trim().replace(/\s+/g, ' '); });
  headers.host = u.host;
  headers['x-amz-date'] = stamp;
  if (opts.service === 's3') headers['x-amz-content-sha256'] = payloadHash;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map(k => k + ':' + headers[k] + '\n').join('');
  const signedHeaders = names.join(';');
  const query = [];
  u.searchParams.forEach((v, k) => query.push([uriEncode(k), uriEncode(v)]));
  query.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const path = opts.service === 's3' ? uriEncode(decodeURIComponent(u.pathname), true) : (u.pathname || '/');
  const canonicalRequest = [opts.method.toUpperCase(), path || '/', query.map(q => q[0] + '=' + q[1]).join('&'), canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = day + '/' + opts.region + '/' + opts.service + '/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + opts.secretAccessKey, day), opts.region), opts.service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const out = Object.assign({}, headers);
  delete out.host; // host выставляет HTTP-клиент
  out.authorization = 'AWS4-HMAC-SHA256 Credential=' + opts.accessKeyId + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
  return { headers: out, signature, canonicalRequest, stringToSign };
}

module.exports = { sign, uriEncode, amzDate, sha256hex };
