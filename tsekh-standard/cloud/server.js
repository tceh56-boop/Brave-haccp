'use strict';
/**
 * ЦЕХ Стандарт — сервер для Yandex Cloud.
 *
 *   https://домен/t/<код предприятия>/exec   — веб-приложение предприятия (то, что было script.google.com/macros/s/…/exec)
 *   https://домен/t/<код>/rpc                 — вызовы google.script.run со страниц
 *   https://домен/t/<код>/file/<id>           — файлы «Диска» предприятия (ссылки из журналов, документов, фото)
 *   https://домен/admin/exec                  — админ-панель поставщика (лицензии, подписки, ЮKassa)
 *
 * Код Apps Script синхронный: долгий вызов (распознавание, PDF) занимает процесс целиком. Поэтому запросы
 * обслуживают несколько процессов (WORKERS, по умолчанию по числу ядер), а триггеры и почта — отдельный процесс.
 */
const cluster = require('cluster');
const http = require('http');
const os = require('os');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8080);
const WORKERS = Math.max(1, Number(process.env.WORKERS || Math.min(4, os.cpus().length)));
const MAX_BODY = Number(process.env.MAX_BODY_MB || 50) * 1024 * 1024;

if (cluster.isPrimary && process.env.SINGLE_PROCESS !== '1') {
  console.log(`ЦЕХ Стандарт: порт ${PORT}, процессов для запросов: ${WORKERS}, плюс планировщик`);
  const roles = new Map();
  const fork = (role) => { const w = cluster.fork({ ROLE: role }); roles.set(w.id, role); };
  for (let i = 0; i < WORKERS; i++) fork('web');
  fork('scheduler');
  cluster.on('exit', (w, code, sig) => {
    const role = roles.get(w.id) || 'web';
    roles.delete(w.id);
    console.error(`процесс ${w.process.pid} (${role}) завершился: ${sig || code}; перезапускаю`);
    setTimeout(() => fork(role), 1000);
  });
  return;
}

if (process.env.ROLE === 'scheduler') {
  require('./lib/scheduler').start();
} else {
  startWeb();
  if (process.env.SINGLE_PROCESS === '1') require('./lib/scheduler').start();
}

function startWeb() {
  const tenants = require('./lib/tenants');
  const { clientShim } = require('./lib/client');
  const { Blob } = require('./lib/gas/blob');
  const { MIME_SHEET } = require('./lib/gas/spreadsheet');

  const send = (res, code, body, type = 'text/html; charset=utf-8', extra = {}) => {
    res.writeHead(code, { 'content-type': type, 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', ...extra });
    res.end(body);
  };
  const page = (title, html) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
    `<body style="font:16px system-ui,Arial;max-width:560px;margin:48px auto;padding:0 16px;color:#111">${html}</body></html>`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Слишком большой запрос'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  /** e для doGet/doPost — как в Apps Script. */
  const event = (url, body, type) => {
    const parameter = {}; const parameters = {};
    const add = (k, v) => { if (parameter[k] === undefined) parameter[k] = v; (parameters[k] = parameters[k] || []).push(v); };
    url.searchParams.forEach((v, k) => add(k, v));
    if (body && /application\/x-www-form-urlencoded/.test(type || '')) new URLSearchParams(body.toString('utf8')).forEach((v, k) => add(k, v));
    const e = { parameter, parameters, queryString: url.search.replace(/^\?/, ''), contextPath: '', contentLength: body ? body.length : -1, pathInfo: '' };
    if (body) e.postData = { contents: body.toString('utf8'), type: (type || '').split(';')[0], length: body.length, name: 'postData', getDataAsString: () => body.toString('utf8'), getBytes: () => Array.from(body) };
    return e;
  };

  /** Ответ веб-приложения → HTTP. HtmlOutput оборачивается в страницу с google.script.run. */
  const respond = (res, t, url, out) => {
    if (out && out._kind === 'html') {
      const meta = out._meta.map(([n, c]) => `<meta name="${esc(n)}" content="${esc(c)}">`).join('');
      const params = Object.fromEntries(url.searchParams);
      let body = out._content;
      const head = `<meta charset="utf-8">${meta}<title>${esc(out._title || 'ЦЕХ Стандарт')}</title>${out._favicon ? `<link rel="icon" href="${esc(out._favicon)}">` : ''}${clientShim(t.baseUrl + '/rpc', params)}`;
      body = /<head[^>]*>/i.test(body) ? body.replace(/<head[^>]*>/i, (m) => m + head) : `<!doctype html><html lang="ru"><head>${head}</head><body>${body}</body></html>`;
      const xfo = out._xfo === 'ALLOWALL' ? {} : { 'x-frame-options': 'SAMEORIGIN' };
      return send(res, 200, body, 'text/html; charset=utf-8', xfo);
    }
    if (out && out._kind === 'text') {
      const extra = out._download ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(out._download)}` } : {};
      return send(res, 200, out._text, `${out._mime}; charset=utf-8`, extra);
    }
    if (out && typeof out.getBytes === 'function') return send(res, 200, out._buffer ? out._buffer() : Buffer.from(out.getBytes()), out.getContentType() || 'application/octet-stream');
    return send(res, 200, page('ЦЕХ Стандарт', '<p>Скрипт завершён, но не вернул ничего для отображения.</p>'));
  };

  const fromJson = (v) => {
    if (Array.isArray(v)) return v.map(fromJson);
    if (v && typeof v === 'object') {
      if (v.__blob) return new Blob(Buffer.from(v.__blob.data || '', 'base64'), v.__blob.type || 'application/octet-stream', v.__blob.name || 'file');
      const o = {}; for (const k of Object.keys(v)) o[k] = fromJson(v[k]); return o;
    }
    return v;
  };

  const errorText = (e) => String((e && e.message) || e).replace(/^Error:\s*/, '');

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');
    if (url.pathname === '/' || url.pathname === '') {
      return send(res, 200, page('ЦЕХ Стандарт', '<h1>ЦЕХ Стандарт</h1><p>Порядок. Контроль. Развитие.</p><p>Откройте ссылку на систему вашего предприятия — её выдаёт директор или поставщик.</p>'));
    }
    let slug; let rest;
    if (parts[0] === 't' && parts[1]) { slug = parts[1]; rest = parts.slice(2); } else if (parts[0] === 'admin') { slug = tenants.ADMIN_SLUG; rest = parts.slice(1); } else return send(res, 404, page('Не найдено', '<h2>Страница не найдена</h2>'));
    const t = tenants.get(slug);
    if (!t) return send(res, 404, page('Не найдено', '<h2>Предприятие не найдено</h2><p>Проверьте ссылку.</p>'));
    const action = rest[0] || 'exec';

    if (action === 'exec' && (req.method === 'GET' || req.method === 'HEAD')) {
      const out = t.execute('doGet', [event(url, null)]);
      return respond(res, t, url, out);
    }
    if (action === 'exec' && req.method === 'POST') {
      const body = await readBody(req);
      const out = t.execute('doPost', [event(url, body, req.headers['content-type'])]);
      return respond(res, t, url, out);
    }
    if (action === 'rpc' && req.method === 'POST') {
      const body = await readBody(req);
      let msg; try { msg = JSON.parse(body.toString('utf8')); } catch (e) { return send(res, 400, JSON.stringify({ ok: false, error: { message: 'Неверный запрос' } }), 'application/json'); }
      const fn = String(msg.fn || '');
      // как в Apps Script: функции с подчёркиванием в конце закрыты для вызова со страницы
      if (!/^[A-Za-z$][A-Za-z0-9_$]*$/.test(fn) || fn.endsWith('_') || ['doGet', 'doPost', 'eval', 'Function'].includes(fn)) {
        return send(res, 200, JSON.stringify({ ok: false, error: { name: 'ScriptError', message: `Функция ${fn} недоступна` } }), 'application/json');
      }
      try {
        const value = t.execute(fn, fromJson(Array.isArray(msg.args) ? msg.args : []));
        return send(res, 200, JSON.stringify({ ok: true, value: value === undefined ? null : value }), 'application/json; charset=utf-8', { 'cache-control': 'no-store' });
      } catch (e) {
        t.store.log('ERROR', `${fn}: ${errorText(e)}${e.where ? '\n' + e.where.split('\n').slice(0, 4).join('\n') : ''}`);
        return send(res, 200, JSON.stringify({ ok: false, error: { name: 'ScriptError', message: errorText(e) } }), 'application/json; charset=utf-8');
      }
    }
    if ((action === 'file' || action === 'sheet') && rest[1] && req.method === 'GET') {
      const f = t.store.file(rest[1]);
      if (!f || f.trashed) return send(res, 404, page('Файл не найден', '<h2>Файл не найден</h2>'));
      if (f.mime === MIME_SHEET) {
        const blob = t.execute(() => () => t.spreadsheetApp().openById(f.id).getBlob());
        return send(res, 200, blob._buffer(), 'text/csv; charset=utf-8', { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name + '.csv')}` });
      }
      if (f.mime === 'application/vnd.google-apps.document') {
        const html = t.execute(() => () => require('./lib/gas/services').makeDocumentApp(t).openById(f.id).getBlob().getDataAsString());
        return send(res, 200, html);
      }
      const disp = url.searchParams.get('download') ? 'attachment' : 'inline';
      return send(res, 200, t.store.readBlob(f.id), f.mime || 'application/octet-stream', { 'content-disposition': `${disp}; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'cache-control': 'private, max-age=300' });
    }
    if (action === 'folder' && rest[1]) {
      const f = t.store.file(rest[1]);
      if (!f || f.mime !== 'application/vnd.google-apps.folder') return send(res, 404, page('Папка не найдена', '<h2>Папка не найдена</h2>'));
      const kids = t.store.filesWhere('trashed = 0 and exists (select 1 from json_each(files.parents) where value = ?)', f.id);
      const items = kids.map((k) => `<li><a href="${t.baseUrl}/${k.mime === 'application/vnd.google-apps.folder' ? 'folder' : 'file'}/${k.id}">${esc(k.name)}</a></li>`).join('');
      return send(res, 200, page(f.name, `<h2>${esc(f.name)}</h2><ul>${items || '<li>Папка пуста</li>'}</ul>`));
    }
    return send(res, 404, page('Не найдено', '<h2>Страница не найдена</h2>'));
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      const code = e.code === 413 ? 413 : 500;
      console.error(new Date().toISOString(), req.method, req.url.split('?')[0], errorText(e), e.where ? e.where.split('\n').slice(0, 3).join(' | ') : '');
      if (!res.headersSent) send(res, code, page('Ошибка', `<h2>Ошибка</h2><p>${esc(errorText(e))}</p>`));
      else res.end();
    });
  });
  server.keepAliveTimeout = 5000; // соединение браузера не «прилипает» надолго к одному занятому процессу
  server.listen(PORT, () => console.log(`процесс ${process.pid}: http://0.0.0.0:${PORT}`));
}
