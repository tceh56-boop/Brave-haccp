'use strict';
/** PropertiesService, CacheService, LockService, Session, MailApp, ScriptApp, ContentService, HtmlService, DocumentApp. */
const fs = require('fs');
const path = require('path');
const { Blob, toBuffer } = require('./blob');

/* ---------- свойства и кэш ---------- */
function makeProperties(store, tenant) {
  const script = {
    getProperty: (k) => store.prop(String(k)),
    setProperty: (k, v) => { store.setProp(String(k), v); return script; },
    deleteProperty: (k) => { store.delProp(String(k)); return script; },
    getProperties: () => store.props(),
    setProperties: (o, del) => { store.setProps(o || {}, !!del); return script; },
    getKeys: () => Object.keys(store.props()),
    deleteAllProperties: () => { store.setProps({}, true); return script; },
  };
  // свойства пользователя и документа в облаке — отдельные пространства имён в тех же свойствах
  const scoped = (prefix) => {
    const s = {
      getProperty: (k) => store.prop(prefix + k),
      setProperty: (k, v) => { store.setProp(prefix + k, v); return s; },
      deleteProperty: (k) => { store.delProp(prefix + k); return s; },
      getProperties: () => { const all = store.props(); const o = {}; for (const k of Object.keys(all)) if (k.startsWith(prefix)) o[k.slice(prefix.length)] = all[k]; return o; },
      setProperties: (o) => { for (const k of Object.keys(o || {})) store.setProp(prefix + k, o[k]); return s; },
      getKeys: () => Object.keys(s.getProperties()),
      deleteAllProperties: () => { for (const k of s.getKeys()) store.delProp(prefix + k); return s; },
    };
    return s;
  };
  return {
    getScriptProperties: () => script,
    getUserProperties: () => scoped('__user:' + tenant.user().getEmail() + ':'),
    getDocumentProperties: () => scoped('__doc:'),
  };
}

function makeCache(store) {
  const mk = (prefix) => ({
    get: (k) => store.cacheGet(prefix + k),
    getAll: (keys) => { const o = {}; (keys || []).forEach((k) => { const v = store.cacheGet(prefix + k); if (v !== null) o[k] = v; }); return o; },
    put: (k, v, ttl) => {
      if (String(v).length > 100 * 1024) throw new Error('Аргумент слишком велик: значение кэша больше 100 КБ');
      store.cachePut(prefix + k, v, ttl);
    },
    putAll: (o, ttl) => { Object.keys(o || {}).forEach((k) => store.cachePut(prefix + k, o[k], ttl)); },
    remove: (k) => store.cacheRemove(prefix + k),
    removeAll: (keys) => (keys || []).forEach((k) => store.cacheRemove(prefix + k)),
  });
  return { getScriptCache: () => mk(''), getUserCache: () => mk('__u:'), getDocumentCache: () => mk('__d:') };
}

/**
 * Блокировки между процессами сервера: строка в таблице lock базы предприятия (вставка атомарна).
 * Перед входом в критическую секцию сбрасываем свои записи и перечитываем листы — как свежие данные в Google.
 */
function makeLock(store) {
  store.db.exec('create table if not exists locks (name text primary key, owner text not null, exp integer not null)');
  const me = `${process.pid}:${Math.random().toString(36).slice(2)}`;
  const held = new Set();
  const acquire = (name, ms) => {
    const until = Date.now() + Math.max(0, Number(ms) || 0);
    const wait = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
      const now = Date.now();
      store.db.prepare('delete from locks where name = ? and exp < ?').run(name, now);
      const r = store.db.prepare('insert or ignore into locks (name, owner, exp) values (?, ?, ?)').run(name, me, now + 6 * 60000);
      if (r.changes === 1 || store.db.prepare('select owner from locks where name = ?').get(name)?.owner === me) {
        held.add(name);
        store.flush();
        store.sheetData.clear();
        return true;
      }
      if (Date.now() >= until) return false;
      Atomics.wait(wait, 0, 0, 50);
    }
  };
  const lock = (name) => ({
    tryLock: (ms) => acquire(name, ms),
    waitLock: (ms) => { if (!acquire(name, ms)) throw new Error('Не удалось получить блокировку: время ожидания истекло'); },
    releaseLock: () => { if (!held.has(name)) return; store.flush(); store.db.prepare('delete from locks where name = ? and owner = ?').run(name, me); held.delete(name); },
    hasLock: () => held.has(name),
  });
  const releaseAll = () => { for (const n of held) store.db.prepare('delete from locks where name = ? and owner = ?').run(n, me); held.clear(); };
  return { service: { getScriptLock: () => lock('script'), getDocumentLock: () => lock('document'), getUserLock: () => lock('user') }, releaseAll };
}

/* ---------- пользователь ---------- */
function makeSession(tenant) {
  return {
    getActiveUser: () => tenant.user(),
    getEffectiveUser: () => tenant.user(),
    getScriptTimeZone: () => tenant.timeZone(),
    getTemporaryActiveUserKey: () => tenant.slug,
    getActiveUserLocale: () => 'ru',
  };
}

/* ---------- почта: письма уходят в очередь, отправляет их отдельный цикл (SMTP Яндекс 360) ---------- */
function makeMail(store, tenant) {
  const limit = Number(process.env.MAIL_DAILY_LIMIT || 1500);
  const blobOut = (b) => ({ name: b.getName() || 'файл', type: b.getContentType() || 'application/octet-stream', data: (b._buffer ? b._buffer() : toBuffer(b.getBytes())).toString('base64') });
  const send = (a, subject, body, opt) => {
    let m = a && typeof a === 'object' ? { ...a } : { to: a, subject, body, ...(opt || {}) };
    if (!m.to && !m.cc && !m.bcc) throw new Error('Не указан получатель письма');
    if (store.mailSentToday() >= limit) throw new Error('Служба вызвана слишком много раз за день: email');
    const atts = (m.attachments || []).map((x) => blobOut(x && typeof x.getBlob === 'function' && !x.getBytes ? x.getBlob() : x));
    const inline = {};
    Object.keys(m.inlineImages || {}).forEach((k) => { inline[k] = blobOut(m.inlineImages[k]); });
    store.queueMail({ to: String(m.to || ''), cc: m.cc || '', bcc: m.bcc || '', subject: String(m.subject || ''), text: String(m.body || ''),
      html: m.htmlBody ? String(m.htmlBody) : '', name: m.name || tenant.mailName(), replyTo: m.replyTo || '', noReply: !!m.noReply, attachments: atts, inline });
  };
  return { sendEmail: send, getRemainingDailyQuota: () => Math.max(0, limit - store.mailSentToday()) };
}

/* ---------- триггеры ---------- */
function makeScriptApp(store, tenant) {
  const WeekDay = { SUNDAY: 'SUNDAY', MONDAY: 'MONDAY', TUESDAY: 'TUESDAY', WEDNESDAY: 'WEDNESDAY', THURSDAY: 'THURSDAY', FRIDAY: 'FRIDAY', SATURDAY: 'SATURDAY' };
  const EventType = { CLOCK: 'CLOCK', ON_OPEN: 'ON_OPEN', ON_EDIT: 'ON_EDIT', ON_FORM_SUBMIT: 'ON_FORM_SUBMIT', ON_CHANGE: 'ON_CHANGE' };
  const trig = (t) => ({
    getHandlerFunction: () => t.handler, getUniqueId: () => t.id, getEventType: () => (t.kind === 'clock' ? 'CLOCK' : t.spec.event || 'ON_CHANGE'),
    getTriggerSource: () => (t.kind === 'clock' ? 'CLOCK' : 'SPREADSHEETS'), getTriggerSourceId: () => t.spec.source || null, isDisabled: () => false,
  });
  const builder = (handler) => {
    const spec = {};
    const clock = {
      everyMinutes: (n) => { spec.every = Number(n) * 60000; return clock; },
      everyHours: (n) => { spec.every = Number(n) * 3600000; return clock; },
      everyDays: (n) => { spec.days = Number(n); return clock; },
      everyWeeks: (n) => { spec.weeks = Number(n); return clock; },
      atHour: (h) => { spec.hour = Number(h); return clock; },
      nearMinute: (m) => { spec.minute = Number(m); return clock; },
      onWeekDay: (d) => { spec.weekday = String(d); return clock; },
      onMonthDay: (d) => { spec.monthday = Number(d); return clock; },
      inTimezone: (tz) => { spec.tz = String(tz); return clock; },
      at: (d) => { spec.at = new Date(d).getTime(); return clock; },
      atDate: (y, m, d) => { spec.at = new Date(y, m - 1, d).getTime(); return clock; },
      after: (ms) => { spec.at = Date.now() + Number(ms); return clock; },
      create: () => {
        if (store.triggers().length >= 20) throw new Error('В этом скрипте слишком много триггеров. Максимум — 20.');
        const id = store.addTrigger(handler, 'clock', spec);
        return trig({ id, handler, kind: 'clock', spec });
      },
    };
    const src = (source) => {
      const s = {};
      ['onOpen', 'onEdit', 'onChange', 'onFormSubmit'].forEach((ev) => { s[ev] = () => s; });
      s.create = () => { const id = store.addTrigger(handler, 'sheet', { source }); return trig({ id, handler, kind: 'sheet', spec: { source } }); };
      return s;
    };
    return { timeBased: () => clock, forSpreadsheet: (x) => src(typeof x === 'string' ? x : x.getId()), forDocument: (x) => src(String(x)), forForm: (x) => src(String(x)), forUserCalendar: (x) => src(String(x)) };
  };
  return {
    newTrigger: builder,
    getProjectTriggers: () => store.triggers().map(trig),
    getUserTriggers: () => store.triggers().map(trig),
    deleteTrigger: (t) => store.deleteTrigger(t.getUniqueId()),
    getService: () => ({ getUrl: () => tenant.execUrl, isEnabled: () => true, enable() {}, disable() {} }),
    getScriptId: () => tenant.slug,
    getOAuthToken: () => '',
    getIdentityToken: () => '',
    invalidateAuth: () => {},
    getAuthorizationInfo: () => ({ getAuthorizationStatus: () => 'NOT_REQUIRED', getAuthorizationUrl: () => null }),
    getInstallationSource: () => 'NONE',
    requireScopes: () => {}, requireAllScopes: () => {},
    WeekDay, EventType,
    TriggerSource: { CLOCK: 'CLOCK', SPREADSHEETS: 'SPREADSHEETS', DOCUMENTS: 'DOCUMENTS', FORMS: 'FORMS', CALENDAR: 'CALENDAR' },
    AuthMode: { FULL: 'FULL', LIMITED: 'LIMITED', NONE: 'NONE', CUSTOM_FUNCTION: 'CUSTOM_FUNCTION' },
    AuthorizationStatus: { REQUIRED: 'REQUIRED', NOT_REQUIRED: 'NOT_REQUIRED' },
    InstallationSource: { NONE: 'NONE', APPS_MARKETPLACE_DOMAIN_ADD_ON: 'APPS_MARKETPLACE_DOMAIN_ADD_ON' },
  };
}

/* ---------- ответы веб-приложения ---------- */
function makeContent() {
  const MimeType = { JSON: 'application/json', TEXT: 'text/plain', CSV: 'text/csv', JAVASCRIPT: 'application/javascript', XML: 'application/xml', ICAL: 'text/calendar', RSS: 'application/rss+xml', ATOM: 'application/atom+xml', VCARD: 'text/vcard' };
  const createTextOutput = (t) => {
    const o = { _kind: 'text', _text: t === undefined ? '' : String(t), _mime: MimeType.TEXT,
      setContent(s) { o._text = String(s); return o; }, append(s) { o._text += String(s); return o; }, getContent: () => o._text,
      setMimeType(m) { o._mime = m; return o; }, getMimeType: () => o._mime, downloadAsFile(n) { o._download = n; return o; }, getFileName: () => o._download || null, clear() { o._text = ''; return o; } };
    return o;
  };
  return { createTextOutput, MimeType };
}

function makeHtml(tenant, scopeLookup) {
  const appDir = tenant.appDir;
  const readFile = (name) => {
    const base = String(name).replace(/\.html$/, '');
    const p = path.join(appDir, base + '.html');
    if (!fs.existsSync(p)) throw new Error(`Файл ${base} не найден`);
    return fs.readFileSync(p, 'utf8');
  };
  const out = (content) => {
    const o = { _kind: 'html', _content: String(content || ''), _title: '', _meta: [], _xfo: null, _favicon: '',
      getContent: () => o._content, setContent(s) { o._content = String(s); return o; }, append(s) { o._content += String(s); return o; }, appendUntrusted(s) { o._content += String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); return o; },
      clear() { o._content = ''; return o; }, getTitle: () => o._title, setTitle(t) { o._title = String(t); return o; },
      addMetaTag(n, c) { o._meta.push([String(n), String(c)]); return o; }, getMetaTags: () => o._meta.map(([n, c]) => ({ getName: () => n, getContent: () => c })),
      setXFrameOptionsMode(m) { o._xfo = m; return o; }, setSandboxMode() { return o; }, setFaviconUrl(u) { o._favicon = String(u); return o; }, getFaviconUrl: () => o._favicon,
      setWidth() { return o; }, setHeight() { return o; }, getWidth: () => 0, getHeight: () => 0,
      getBlob: () => new Blob(o._content, 'text/html', (o._title || 'page') + '.html'), getAs: (t) => o.getBlob().getAs(t), asTemplate: () => template(o._content) };
    return o;
  };
  /** Шаблоны Apps Script: <?= ?> — с экранированием, <?!= ?> — без, <? ?> — код. Видят поля шаблона и функции проекта. */
  const template = (src) => {
    const t = { getRawContent: () => src, getCode: () => compile(src) };
    t.evaluate = () => {
      const code = compile(src);
      const vars = {}; Object.keys(t).forEach((k) => { if (!['evaluate', 'getRawContent', 'getCode', 'getCodeWithComments'].includes(k)) vars[k] = t[k]; });
      const scope = new Proxy(vars, { has: (o, k) => typeof k === 'string' && k !== '__out', get: (o, k) => (k in o ? o[k] : k === Symbol.unscopables ? undefined : scopeLookup(k)) });
      // eslint-disable-next-line no-new-func
      const fn = new Function('__scope', '__esc', `var __out = []; with (__scope) { ${code} } return __out.join('');`);
      return out(fn(scope, (v) => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))));
    };
    return t;
  };
  const compile = (src) => {
    let code = ''; let i = 0;
    const re = /<\?(!?=)?([\s\S]*?)\?>/g; let m;
    while ((m = re.exec(src))) {
      code += `__out.push(${JSON.stringify(src.slice(i, m.index))});\n`;
      if (m[1] === '=') code += `__out.push(__esc(${m[2]}));\n`;
      else if (m[1] === '!=') code += `__out.push(String((${m[2]}) === undefined ? '' : (${m[2]})));\n`;
      else code += m[2] + '\n';
      i = re.lastIndex;
    }
    return code + `__out.push(${JSON.stringify(src.slice(i))});\n`;
  };
  return {
    createHtmlOutput: (x) => out(x && typeof x.getDataAsString === 'function' ? x.getDataAsString() : x),
    createHtmlOutputFromFile: (name) => out(readFile(name)),
    createTemplate: (x) => template(x && typeof x.getDataAsString === 'function' ? x.getDataAsString() : String(x)),
    createTemplateFromFile: (name) => template(readFile(name)),
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT', DENY: 'DENY' },
    SandboxMode: { IFRAME: 'IFRAME', NATIVE: 'NATIVE', EMULATED: 'EMULATED' },
  };
}

/**
 * DocumentApp — то, что использует ЦЕХ Стандарт: создать документ, дописать абзацы с заголовками, прочитать текст,
 * сохранить в PDF. Документ хранится на «Диске» как HTML с типом Google Docs.
 */
function makeDocumentApp(tenant, drive) {
  const MIME_DOC = 'application/vnd.google-apps.document';
  const store = tenant.store;
  const ParagraphHeading = { NORMAL: 'p', TITLE: 'h1', SUBTITLE: 'h2', HEADING1: 'h1', HEADING2: 'h2', HEADING3: 'h3', HEADING4: 'h4', HEADING5: 'h5', HEADING6: 'h6' };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const open = (id) => {
    const meta = store.file(String(id));
    if (!meta) throw new Error('Документ не найден: ' + id);
    let state = { blocks: [] };
    try { state = JSON.parse(store.readBlob(meta.id).toString('utf8') || '{"blocks":[]}'); } catch (e) { state = { blocks: [{ tag: 'p', text: store.readBlob(meta.id).toString('utf8') }] }; }
    const save = () => store.writeBlob(meta.id, Buffer.from(JSON.stringify(state), 'utf8'));
    const html = () => '<html><head><meta charset="utf-8"><style>body{font:12pt "Times New Roman",serif;margin:2cm}table{border-collapse:collapse}td{border:1px solid #000;padding:4px}</style></head><body>' +
      state.blocks.map((b) => (b.tag === 'table' ? '<table>' + b.rows.map((r) => '<tr>' + r.map((c) => `<td>${esc(c)}</td>`).join('') + '</tr>').join('') + '</table>' : `<${b.tag}>${esc(b.text)}</${b.tag}>`)).join('') + '</body></html>';
    const para = (b) => { const p = { setHeading: (h) => { b.tag = h; save(); return p; }, getText: () => b.text, setText: (t) => { b.text = String(t); save(); return p; }, appendText: (t) => { b.text += String(t); save(); return p; },
      setAlignment: () => p, setBold: () => p, setFontSize: () => p, setAttributes: () => p, setSpacingAfter: () => p, setSpacingBefore: () => p, setIndentStart: () => p, setLineSpacing: () => p }; return p; };
    const body = {
      appendParagraph: (t) => { const b = { tag: 'p', text: String(t) }; state.blocks.push(b); save(); return para(b); },
      appendListItem: (t) => { const b = { tag: 'li', text: String(t) }; state.blocks.push(b); save(); return para(b); },
      appendTable: (rows) => { const b = { tag: 'table', rows: (rows || []).map((r) => r.map(String)) }; state.blocks.push(b); save(); return { setBorderWidth() { return this; }, setAttributes() { return this; } }; },
      appendPageBreak: () => body, appendHorizontalRule: () => body,
      getText: () => state.blocks.map((b) => (b.tag === 'table' ? b.rows.map((r) => r.join('\t')).join('\n') : b.text)).join('\n'),
      clear: () => { state.blocks = []; save(); return body; },
      setMarginTop: () => body, setMarginBottom: () => body, setMarginLeft: () => body, setMarginRight: () => body,
      editAsText: () => ({ getText: () => body.getText(), setFontSize: () => {}, setFontFamily: () => {} }),
    };
    const doc = { getId: () => meta.id, getName: () => store.file(meta.id).name, setName: (n) => { store.updateFile(meta.id, { name: String(n) }); return doc; }, getBody: () => body,
      getUrl: () => `${tenant.baseUrl}/file/${meta.id}`, saveAndClose: () => save(), getAs: (t) => new Blob(html(), 'text/html', store.file(meta.id).name + '.html').getAs(t),
      getBlob: () => new Blob(html(), 'text/html', store.file(meta.id).name + '.html'), getHeader: () => null, getFooter: () => null, addHeader: () => body, addFooter: () => body };
    return doc;
  };
  return {
    create: (name) => open(store.addFile({ name: String(name), mime: MIME_DOC, parents: ['root'], bytes: Buffer.from('{"blocks":[]}') })),
    openById: open,
    openByUrl: (u) => open((/\/file\/([A-Za-z0-9_-]+)/.exec(String(u)) || [])[1]),
    ParagraphHeading,
    HorizontalAlignment: { LEFT: 'LEFT', CENTER: 'CENTER', RIGHT: 'RIGHT', JUSTIFY: 'JUSTIFY' },
    Attribute: {}, MIME_DOC,
  };
}

module.exports = { makeProperties, makeCache, makeLock, makeSession, makeMail, makeScriptApp, makeContent, makeHtml, makeDocumentApp };
