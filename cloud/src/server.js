// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * HTTP-сервер ЦЕХ для Yandex Serverless Containers (или любой виртуальной машины).
 *   GET  /          — интерфейс (gas/Index.html) с заменой google.script.run на fetch('/api')
 *   POST /api       — { action, data, token } → processOperation (права, идемпотентность — как в Apps Script)
 *   POST /cron      — фоновые задачи: таймер Yandex Cloud или вызов с заголовком X-Tsekh-Cron
 *   GET  /health    — проверка живости и доступа к базе
 * Переменные: DATABASE_URL (обязательно), PORT (8080), CRON_SECRET, TSEKH_CRON_FROM_TRIGGER, TSEKH_TZ (Europe/Moscow).
 */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { createRuntime } = require('./runtime');

const PORT = Number(process.env.PORT || 8080);
const MAX_BODY = 15 * 1024 * 1024; // фото накладной для распознавания приходит base64
const GAS_DIR = process.env.TSEKH_GAS_DIR || path.join(__dirname, '../../gas');

// Замена google.script.run: тот же интерфейс цепочки, запрос — обычный fetch к /api.
const CLIENT_SHIM = `<script>
(function () {
  function chain() {
    var ok = function () {}, fail = function () {};
    var c = {
      withSuccessHandler: function (f) { ok = f; return c; },
      withFailureHandler: function (f) { fail = f; return c; },
      withUserObject: function () { return c; },
      api: function (action, data, token) {
        fetch('api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: action, data: data, token: token }) })
          .then(function (r) { if (!r.ok) throw new Error('Сервер ответил ' + r.status); return r.json(); })
          .then(function (res) { ok(res); }, function (e) { fail(e && e.message || String(e)); });
      }
    };
    return c;
  }
  window.TSEKH_CLOUD = true;
  window.google = { script: {} };
  Object.defineProperty(window.google.script, 'run', { get: chain });
  // Ссылки на файлы «files/<id>»: скачиваем с токеном сессии в заголовке (не в адресе) и открываем.
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest && ev.target.closest('a[href^="files/"]');
    if (!a) return;
    ev.preventDefault();
    var w = window.open('', '_blank');
    fetch(a.getAttribute('href'), { headers: { 'X-Tsekh-Token': localStorage.getItem('tsekh_token') || '' } })
      .then(function (r) { if (!r.ok) throw new Error(r.status === 404 ? 'Файл не найден.' : 'Нет доступа к файлу — войдите заново.'); return r.blob(); })
      .then(function (b) { var u = URL.createObjectURL(b); if (w) w.location = u; else location.href = u; },
            function (e) { if (w) w.close(); alert(e.message); });
  }, true);
})();
</script>`;

function loadIndex() {
  const html = fs.readFileSync(path.join(GAS_DIR, 'Index.html'), 'utf8');
  const i = html.indexOf('<head>');
  const withMeta = '<meta name="viewport" content="width=device-width, initial-scale=1">' + CLIENT_SHIM;
  return i === -1 ? withMeta + html : html.slice(0, i + 6) + withMeta + html.slice(i + 6);
}

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store'
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Слишком большой запрос.'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/** Имя задачи из тела: { tick } от своего вызова или формат таймера Yandex Cloud (details.payload). */
function tickFromBody(body) {
  let j = {}; try { j = JSON.parse(body || '{}'); } catch (e) { return ''; }
  if (j.tick) return String(j.tick);
  const m = Array.isArray(j.messages) && j.messages[0];
  return m && m.details && m.details.payload ? String(m.details.payload) : '';
}

function createServer(runtime, options) {
  const opts = options || {};
  const cronSecret = opts.cronSecret !== undefined ? opts.cronSecret : process.env.CRON_SECRET;
  let index = loadIndex();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        if (opts.reloadIndex) index = loadIndex();
        return send(res, 200, index, 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && p === '/health') {
        runtime.db.query('SELECT 1');
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api') {
        let body;
        try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return send(res, e.status || 400, { ok: false, error: e.status ? e.message : 'Неверный формат запроса.' }); }
        if (!body.action || typeof body.action !== 'string') return send(res, 400, { ok: false, error: 'Не указано действие.' });
        return send(res, 200, runtime.runOperation(body.action, body.data || {}, body.token || null));
      }
      const fm = /^\/files\/([0-9a-f-]{36})$/.exec(p);
      if (req.method === 'GET' && fm) {
        const session = runtime.sessionFor(req.headers['x-tsekh-token']);
        if (!session) return send(res, 401, { ok: false, error: 'Войдите в систему, чтобы открыть файл.' });
        const f = runtime.files.readForDownload(fm[1]);
        // Файл чужой организации — «не найден», чтобы не подтверждать его существование.
        if (!f || (f.organization_id && f.organization_id !== session.organization_id)) return send(res, 404, { ok: false, error: 'Файл не найден.' });
        res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': f.bytes.length, 'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent(f.name),
          'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'private, no-store' });
        return res.end(f.bytes);
      }
      if (req.method === 'POST' && p === '/cron') {
        // Доступ: заголовок X-Tsekh-Cron = CRON_SECRET, либо вызов таймера Yandex Cloud при TSEKH_CRON_FROM_TRIGGER=1
        // (контейнер закрыт для публичного доступа, а /cron не выставлен в API Gateway — см. cloud/README.md).
        const raw = await readBody(req);
        const byHeader = cronSecret && safeEqual(req.headers['x-tsekh-cron'], cronSecret);
        const byTrigger = (opts.trustTrigger !== undefined ? opts.trustTrigger : process.env.TSEKH_CRON_FROM_TRIGGER === '1') && /"messages"\s*:/.test(raw);
        if (!byHeader && !byTrigger) return send(res, 403, { ok: false, error: 'Нет доступа.' });
        const tick = tickFromBody(raw);
        return send(res, 200, runtime.runTick(tick));
      }
      return send(res, 404, { ok: false, error: 'Не найдено.' });
    } catch (e) {
      console.error('[ЦЕХ] ошибка запроса', req.method, p, e && e.stack || e);
      return send(res, 500, { ok: false, error: 'Не удалось обработать запрос. Повторите операцию.' });
    }
  });
}

if (require.main === module) {
  if (!process.env.DATABASE_URL) { console.error('Задайте DATABASE_URL (строка подключения к PostgreSQL).'); process.exit(1); }
  const runtime = createRuntime({ gasDir: GAS_DIR });
  createServer(runtime).listen(PORT, () => console.log('[ЦЕХ] сервер на порту ' + PORT));
}

module.exports = { createServer, tickFromBody, CLIENT_SHIM };
