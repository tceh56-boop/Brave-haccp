// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

// Поток базы данных: выполняет запросы асинхронно и будит основной поток (см. syncpg.js).
const { workerData } = require('worker_threads');
const { Client } = require('pg');

const { connectionString, flag, port } = workerData;
const client = new Client({ connectionString, application_name: 'tsekh-cloud' });
const ready = client.connect();

function reply(msg) {
  port.postMessage(msg);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}

async function handle(op) {
  if (op.type === 'query') {
    await ready;
    const r = await client.query(op.sql, op.params);
    return { rows: r.rows };
  }
  if (op.type === 'batch') {
    await ready;
    const out = [];
    for (const it of op.items) out.push({ rows: (await client.query(it.sql, it.params || [])).rows });
    return out;
  }
  if (op.type === 'fetch') {
    const o = op.options;
    const res = await fetch(op.url, { method: (o.method || 'get').toUpperCase(), headers: o.headers || {},
      body: o.payloadBase64 !== undefined ? Buffer.from(o.payloadBase64, 'base64')
        : o.payload === undefined ? undefined : (typeof o.payload === 'string' ? o.payload : JSON.stringify(o.payload)) });
    const buf = Buffer.from(await res.arrayBuffer());
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, headers, body: buf.toString('base64') };
  }
  if (op.type === 'close') { await client.end().catch(() => {}); return true; }
  throw new Error('Неизвестная операция потока базы: ' + op.type);
}

port.on('message', op => {
  handle(op).then(result => reply({ result }), err => reply({ error: err && err.message || String(err), code: err && err.code }));
});
