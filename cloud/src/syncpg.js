// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * Синхронный доступ к PostgreSQL для кода ЦЕХ.
 *
 * Код gas/*.gs написан синхронно (так устроен Apps Script): findRows_() сразу возвращает строки.
 * Драйвер pg асинхронный, поэтому запросы выполняет отдельный поток (pg-worker.js), а основной
 * поток ждёт ответа через Atomics.wait и забирает его receiveMessageOnPort. Так бизнес-логика
 * переносится в облако без переписывания.
 *
 * Пока поток ждёт базу, процесс не обслуживает другие запросы — как в Apps Script.
 * Масштабирование — несколькими экземплярами контейнера (Serverless Containers).
 */
const path = require('path');
const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');

const WAIT_MS = Number(process.env.TSEKH_DB_TIMEOUT_MS || 30000);

function createSyncPg(connectionString) {
  const flag = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(path.join(__dirname, 'pg-worker.js'), {
    workerData: { connectionString, flag, port: port2 },
    transferList: [port2]
  });
  worker.unref();
  let closed = false;

  function call(op) {
    if (closed) throw new Error('Соединение с базой закрыто.');
    Atomics.store(flag, 0, 0);
    port1.postMessage(op);
    const r = Atomics.wait(flag, 0, 0, WAIT_MS);
    if (r === 'timed-out') throw new Error('База данных не ответила за ' + Math.round(WAIT_MS / 1000) + ' с.');
    const msg = receiveMessageOnPort(port1);
    if (!msg) throw new Error('Нет ответа от потока базы данных.');
    if (msg.message.error) {
      const e = new Error(msg.message.error);
      e.code = msg.message.code;
      throw e;
    }
    return msg.message.result;
  }

  return {
    /** Один запрос: строки результата. */
    query(sql, params) { return call({ type: 'query', sql, params: params || [] }).rows; },
    /** Несколько запросов подряд одним обращением к потоку (меньше накладных расходов). */
    batch(items) { return call({ type: 'batch', items }).map(r => r.rows); },
    /** Синхронный HTTP для UrlFetchApp. */
    fetch(url, options) { return call({ type: 'fetch', url, options: options || {} }); },
    close() {
      if (closed) return;
      try { call({ type: 'close' }); } catch (e) { /* поток уже остановлен */ }
      closed = true;
      worker.terminate();
    }
  };
}

module.exports = { createSyncPg };
