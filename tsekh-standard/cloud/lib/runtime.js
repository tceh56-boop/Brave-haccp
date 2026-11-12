'use strict';
/**
 * Среда выполнения кода Apps Script на своём сервере.
 *
 * Все файлы .gs проекта склеиваются (в том же порядке, что при установке в Google — по имени) в одну функцию.
 * Каждое выполнение — вызов этой функции заново: как в Apps Script, глобальные переменные живут одно выполнение
 * и не протекают между пользователями. Внутрь передаются наши SpreadsheetApp, DriveApp и остальные службы.
 * Код компилируется один раз на процесс (vm.Script), поэтому новое выполнение стоит миллисекунды.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Store } = require('./store');
const { makeSpreadsheetApp } = require('./gas/spreadsheet');
const { makeDrive } = require('./gas/drive');
const { makeUtilities, makeLogger } = require('./gas/utilities');
const { makeUrlFetch } = require('./gas/urlfetch');
const S = require('./gas/services');

const SERVICES = ['SpreadsheetApp', 'DriveApp', 'PropertiesService', 'CacheService', 'LockService', 'Session', 'MailApp', 'GmailApp', 'ScriptApp',
  'HtmlService', 'ContentService', 'UrlFetchApp', 'Utilities', 'Logger', 'DocumentApp', 'XmlService', 'Drive', 'Sheets', 'Charts', 'CalendarApp', 'FormApp', 'SlidesApp',
  '__tenantConfig', '__cloud'];

/** Склеенный проект: { script, files } — один на каталог исходников. */
const projects = new Map();
function loadProject(dir) {
  if (projects.has(dir)) return projects.get(dir);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort();
  let src = '';
  let line = 1;
  const map = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    map.push({ file: f, from: line });
    src += `\n/* ==== ${f} ==== */\n` + text + '\n';
    line += 2 + text.split('\n').length;
  }
  // Резолвер имён — прямой eval в той же области видимости: так находятся функции для google.script.run и триггеров.
  const wrapped = `(function (${SERVICES.join(', ')}) {\n'use cloud';${src}\n` +
    `;if (typeof TS_TENANT_CONFIG_ !== 'undefined' && __tenantConfig) TS_TENANT_CONFIG_ = __tenantConfig;\n` +
    `return function (__n) { if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(__n)) return undefined; try { return eval(__n); } catch (e) { return undefined; } };\n})`;
  const script = new vm.Script(wrapped, { filename: path.basename(dir) + '.gs.js' });
  const factory = script.runInThisContext();
  const p = { dir, files, factory, map };
  projects.set(dir, p);
  return p;
}

/** Номер строки склеенного файла → «Файл.gs:строка» для понятных ошибок. */
function where(project, stack) {
  return String(stack || '').replace(/\.gs\.js:(\d+)/g, (m, n) => {
    n = Number(n) - 1;
    let hit = project.map[0];
    for (const x of project.map) if (x.from <= n) hit = x;
    return ` ${hit.file}:${n - hit.from}`;
  });
}

const unsupported = (name) => new Proxy({}, { get: (t, k) => (k === Symbol.toPrimitive ? undefined : () => { throw new Error(`Служба ${name}.${String(k)} недоступна в облачной версии ЦЕХ Стандарт`); }) });

class Tenant {
  /**
   * @param {object} cfg  tenant.json: { slug, name, ownerEmail, timeZone, appDir, publicUrl }
   */
  constructor(cfg, dataDir) {
    this.cfg = cfg;
    this.slug = cfg.slug;
    this.dir = path.join(dataDir, cfg.slug);
    this.appDir = cfg.appDir;
    this.store = new Store(this.dir);
    const base = (process.env.APP_URL || 'http://localhost:8080').replace(/\/$/, '');
    this.baseUrl = cfg.kind === 'admin' ? `${base}/admin` : `${base}/t/${cfg.slug}`;
    this.execUrl = `${this.baseUrl}/exec`;
    this._ss = null;
  }
  user() { const e = this.cfg.ownerEmail || ''; return { getEmail: () => e, getUsername: () => e.split('@')[0], getUserLoginId: () => e, toString: () => e }; }
  timeZone() { return this.store.prop('MC_TZ') || this.cfg.timeZone || process.env.TZ_DEFAULT || 'Asia/Yekaterinburg'; }
  mailName() { return this.cfg.mailName || 'ЦЕХ Стандарт'; }
  mainBookId() { return this.store.prop('TS_TENANT_SHEET_ID') || this.store.prop('SHEET_ID') || null; }
  spreadsheetApp() { return this._ss; }
  documentApp() { return this._docs; }

  tenantConfig() {
    if (this.cfg.kind === 'admin') return null;
    const p = this.store.props();
    return { mode: '1', rootFolderId: p.TS_TENANT_ROOT_ID || '', spreadsheetId: p.TS_TENANT_SHEET_ID || '', enterpriseId: p.TS_ENTERPRISE_ID || this.slug,
      ownerEmail: this.cfg.ownerEmail || '', execution: 'USER_DEPLOYING', allowedEmails: [], serviceUrl: this.execUrl };
  }

  /**
   * Одно выполнение: свежая область видимости проекта, вызов функции, запись изменений.
   * fn — функция (получает resolve) или имя функции проекта; args — аргументы.
   */
  execute(fn, args = [], opts = {}) {
    const project = loadProject(this.appDir);
    const store = this.store;
    store.sheetData.clear(); // каждое выполнение читает листы заново — несколько процессов сервера видят одни данные
    const ss = makeSpreadsheetApp(this);
    this._ss = ss;
    const drive = makeDrive(this);
    const lock = S.makeLock(store);
    let resolve = null;
    const lookup = (n) => (resolve ? resolve(n) : undefined);
    const docs = S.makeDocumentApp(this, drive);
    this._docs = docs;
    const services = {
      SpreadsheetApp: ss, DriveApp: drive, PropertiesService: S.makeProperties(store, this), CacheService: S.makeCache(store), LockService: lock.service,
      Session: S.makeSession(this), MailApp: S.makeMail(store, this), GmailApp: unsupported('GmailApp'), ScriptApp: S.makeScriptApp(store, this),
      HtmlService: S.makeHtml(this, lookup), ContentService: S.makeContent(), UrlFetchApp: makeUrlFetch(this), Utilities: makeUtilities(), Logger: makeLogger(store),
      DocumentApp: docs, XmlService: unsupported('XmlService'), Drive: unsupported('Drive (расширенная служба)'), Sheets: unsupported('Sheets (расширенная служба)'),
      Charts: unsupported('Charts'), CalendarApp: unsupported('CalendarApp'), FormApp: unsupported('FormApp'), SlidesApp: unsupported('SlidesApp'),
      __tenantConfig: this.tenantConfig(), __cloud: { slug: this.slug, baseUrl: this.baseUrl, execUrl: this.execUrl, docs },
    };
    // как в Apps Script: new Date(), getHours() и т.п. работают в часовом поясе проекта
    process.env.TZ = this.timeZone();
    const started = Date.now();
    try {
      // `this` на верхнем уровне проекта — глобальный объект Apps Script (MC_GLOBAL_ = this; MC_GLOBAL_[имя]): отдаём функции проекта
      const globalThisProxy = new Proxy({}, {
        get: (o, k) => (typeof k === 'string' ? (k in o ? o[k] : lookup(k)) : undefined),
        has: (o, k) => typeof k === 'string' && (k in o || lookup(k) !== undefined),
        set: (o, k, v) => { o[k] = v; return true; },
      });
      resolve = project.factory.apply(globalThisProxy, SERVICES.map((k) => services[k]));
      const f = typeof fn === 'function' ? fn(resolve) : resolve(String(fn));
      if (typeof f !== 'function') throw new Error(`Функция не найдена: ${fn}`);
      return f(...args);
    } catch (e) {
      if (e && e.stack) e.where = where(project, e.stack);
      throw e;
    } finally {
      try { store.flush(); } finally { lock.releaseAll(); }
      const ms = Date.now() - started;
      if (ms > (opts.slowMs || 20000)) store.log('WARN', `долгое выполнение ${typeof fn === 'string' ? fn : 'функции'}: ${ms} мс`);
    }
  }
}

module.exports = { Tenant, loadProject, where };
