'use strict';
// Дочерний процесс UrlFetchApp: читает запросы (JSON) из stdin, выполняет их параллельно, пишет ответы в stdout.
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  const reqs = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const out = await Promise.all(reqs.map(async (r) => {
    try {
      if (r.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      const res = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body ? Buffer.from(r.body, 'base64') : undefined, redirect: r.redirect, signal: AbortSignal.timeout(110000) });
      const buf = Buffer.from(await res.arrayBuffer());
      const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
      return { status: res.status, headers, body: buf.toString('base64') };
    } catch (e) {
      return { error: String((e && e.cause && e.cause.code) || (e && e.message) || e) };
    }
  }));
  process.stdout.write(JSON.stringify(out));
});
