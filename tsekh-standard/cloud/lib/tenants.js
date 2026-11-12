'use strict';
/**
 * Предприятия на сервере. Каждое — каталог data/<код>/ с tenant.json и базой tenant.sqlite.
 * Код предприятия (slug) — часть адреса: https://домен/t/<код>/exec — это «ссылка на веб-приложение» для сотрудников.
 * Админ-панель поставщика — отдельный «проект» data/_admin с кодом из папки admin/.
 */
const fs = require('fs');
const path = require('path');
const { Tenant } = require('./runtime');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_DIR = process.env.APP_SOURCE_DIR || path.join(ROOT, 'app');
const ADMIN_DIR = process.env.ADMIN_SOURCE_DIR || path.join(ROOT, 'admin');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const ADMIN_SLUG = '_admin';

const TREE = ['00_Система', '01_Организация', '02_ТТК_и_Меню', '03_Продукты_и_Поставщики', '04_Производство', '05_Склад_и_Партии', '06_ХАССП_и_ППК',
  '07_Охрана_труда', '08_Договоры', '09_Персонал', '10_Лаборатория', '11_Оборудование', '12_Журналы', '13_Фото', '14_Резервные_копии', '99_Архив'];

const cache = new Map();
const validSlug = (s) => /^[a-z0-9][a-z0-9-]{1,40}$/.test(String(s || ''));

function readCfg(slug) {
  const p = path.join(DATA_DIR, slug, 'tenant.json');
  if (!fs.existsSync(p)) return null;
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  cfg.appDir = cfg.kind === 'admin' ? ADMIN_DIR : APP_DIR;
  return cfg;
}

function get(slug) {
  if (slug !== ADMIN_SLUG && !validSlug(slug)) return null;
  if (cache.has(slug)) return cache.get(slug);
  const cfg = readCfg(slug);
  if (!cfg || cfg.disabled) return null;
  const t = new Tenant(cfg, DATA_DIR);
  cache.set(slug, t);
  return t;
}

function list() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR).filter((d) => fs.existsSync(path.join(DATA_DIR, d, 'tenant.json'))).map((d) => readCfg(d)).filter(Boolean);
}

function writeCfg(cfg) {
  fs.mkdirSync(path.join(DATA_DIR, cfg.slug), { recursive: true });
  const { appDir, ...rest } = cfg;
  fs.writeFileSync(path.join(DATA_DIR, cfg.slug, 'tenant.json'), JSON.stringify(rest, null, 2));
  cache.delete(cfg.slug);
}

/**
 * Новое предприятие: то же, что в Google делали установщик и TS_TenantBootstrap — корневая папка с деревом,
 * таблица-база, свойства режима предприятия, затем триггеры (installAllTriggers, installTsTriggers).
 */
function create({ slug, name, ownerEmail, timeZone, license }) {
  if (!validSlug(slug)) throw new Error('Код предприятия: латинские буквы, цифры и дефис, 2–41 символ (например, kafe-ural)');
  if (readCfg(slug)) throw new Error(`Предприятие «${slug}» уже есть`);
  writeCfg({ slug, name: name || slug, ownerEmail: ownerEmail || '', timeZone: timeZone || process.env.TZ_DEFAULT || 'Asia/Yekaterinburg', created: new Date().toISOString(), kind: 'tenant' });
  const t = get(slug);
  const ids = t.execute(() => () => {
    const drive = require('./gas/drive').makeDrive(t);
    const root = drive.createFolder('ЦЕХ Стандарт — ' + (name || slug));
    TREE.forEach((n) => root.createFolder(n));
    const ss = t.spreadsheetApp().create('ЦЕХ Стандарт — база — ' + (name || slug));
    t.store.updateFile(ss.getId(), { parents: [root.getId()] });
    ss.setSpreadsheetTimeZone(t.timeZone());
    const p = { TS_TENANT_ROOT_ID: root.getId(), TS2_ROOT_PARENT_ID: root.getId(), TS_TENANT_SHEET_ID: ss.getId(), SHEET_ID: ss.getId(), TS_ENTERPRISE_ID: slug,
      TS_TENANT_MODE: '1', MC_TZ: t.timeZone(), TS_CLOUD: '1' };
    if (license && license.key) Object.assign(p, { TS_LICENSE_KEY: license.key, TS_LICENSE_SECRET: license.secret || '', TS_ADMIN_URL: license.adminUrl || '' });
    t.store.setProps(p, false);
    return { root: root.getId(), sheet: ss.getId() };
  });
  const results = { ...ids, triggers: [] };
  for (const fn of ['installAllTriggers', 'installTsTriggers']) {
    try { t.execute(fn); results.triggers.push(fn + ': ок'); } catch (e) { results.triggers.push(fn + ': ' + e.message); }
  }
  return results;
}

/**
 * Новое предприятие из выгрузки Google (lib/importer): те же ID файлов, таблиц и свойства, затем триггеры.
 * Если импорт не удался, каталог предприятия удаляется — можно исправить причину и запустить снова.
 */
function importFromGoogle({ slug, name, ownerEmail, timeZone, manifest, zips, xlsx, adminUrl, log }) {
  if (!validSlug(slug)) throw new Error('Код предприятия: латинские буквы, цифры и дефис, 2–41 символ (например, kafe-ural)');
  if (readCfg(slug)) throw new Error(`Предприятие «${slug}» уже есть`);
  writeCfg({ slug, name: name || manifest.rootName || slug, ownerEmail: ownerEmail || manifest.owner || '', timeZone: timeZone || manifest.timeZone || process.env.TZ_DEFAULT || 'Asia/Yekaterinburg',
    created: new Date().toISOString(), kind: 'tenant', importedFrom: 'google', importedAt: new Date().toISOString() });
  const t = get(slug);
  let report;
  try {
    report = t.execute(() => () => {
      require('./gas/drive').makeDrive(t); // корень «Мой диск»
      return require('./importer').importGoogle(t, { manifest, zips, xlsx, adminUrl, log });
    });
  } catch (e) {
    try { t.store.db.close(); } catch (e2) { /* закрываем перед удалением */ }
    cache.delete(slug);
    fs.rmSync(path.join(DATA_DIR, slug), { recursive: true, force: true });
    throw e;
  }
  report.triggers = [];
  for (const fn of ['installAllTriggers', 'installTsTriggers']) {
    try { t.execute(fn); report.triggers.push(fn + ': ок'); } catch (e) { report.triggers.push(fn + ': ' + e.message); }
  }
  return report;
}

function createAdmin({ ownerEmail }) {
  if (readCfg(ADMIN_SLUG)) return get(ADMIN_SLUG);
  writeCfg({ slug: ADMIN_SLUG, name: 'ЦЕХ Стандарт Admin', ownerEmail: ownerEmail || '', timeZone: 'Europe/Moscow', created: new Date().toISOString(), kind: 'admin' });
  return get(ADMIN_SLUG);
}

module.exports = { get, list, create, importFromGoogle, createAdmin, writeCfg, readCfg, DATA_DIR, APP_DIR, ADMIN_DIR, ADMIN_SLUG, validSlug };
