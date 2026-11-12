#!/usr/bin/env node
'use strict';
/**
 * Управление предприятиями на сервере (вместо установщика на Google Диске).
 *
 *   node tools/tenant.js create <код> --name "Кафе Урал" --email director@kafe.ru [--tz Asia/Yekaterinburg] [--pin 123456]
 *                              [--key TS-XXXX-XXXX-XXXX]   — ключ из админ-панели; секрет берётся из LICENSE_SECRET (не из командной строки)
 *   node tools/tenant.js list
 *   node tools/tenant.js run <код> <функция> [аргументы JSON…]   — выполнить функцию проекта (как «Выполнить» в редакторе)
 *   node tools/tenant.js pin <код> <6 цифр>                       — первичный код технического доступа (patch 0.1)
 *   node tools/tenant.js props <код> [КЛЮЧ=значение …]            — посмотреть или задать свойства скрипта
 *   node tools/tenant.js triggers <код>
 *   node tools/tenant.js log <код> [N]
 *   node tools/tenant.js admin --email you@domain.ru                — создать админ-панель поставщика и выполнить setupAdmin
 */
const tenants = require('../lib/tenants');

const [cmd, ...rest] = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i]; else pos.push(rest[i]); }
const need = (slug) => { const t = tenants.get(slug); if (!t) { console.error(`Предприятие «${slug}» не найдено`); process.exit(1); } return t; };
const SECRET = /SECRET|PASSWORD|TOKEN|API_KEY|PIN_HASH|_KEY$/i;

function main() {
  switch (cmd) {
    case 'create': {
      const [slug] = pos;
      const base = (process.env.APP_URL || 'http://localhost:8080').replace(/\/$/, '');
      const license = flags.key ? { key: flags.key, secret: flags.secret || process.env.LICENSE_SECRET || '', adminUrl: flags['admin-url'] || base + '/admin/exec' } : null;
      const r = tenants.create({ slug, name: flags.name, ownerEmail: flags.email, timeZone: flags.tz, license });
      console.log(`Предприятие создано: ${slug}`);
      console.log(`  Ссылка для сотрудников: ${(process.env.APP_URL || 'http://localhost:8080').replace(/\/$/, '')}/t/${slug}/exec`);
      console.log(`  Папка: ${r.root}\n  Таблица-база: ${r.sheet}`);
      r.triggers.forEach((x) => console.log('  ' + x));
      if (flags.pin) console.log('  ' + setPin(slug, flags.pin));
      else console.log('  Задайте код технического доступа: node tools/tenant.js pin ' + slug + ' <6 цифр>');
      break;
    }
    case 'list':
      for (const c of tenants.list()) console.log(`${c.slug}\t${c.kind || 'tenant'}\t${c.name}\t${c.ownerEmail || ''}\t${c.created || ''}${c.disabled ? '\tОТКЛЮЧЕНО' : ''}`);
      break;
    case 'run': {
      const [slug, fn, ...args] = pos;
      const t = need(slug);
      const r = t.execute(fn, args.map((a) => { try { return JSON.parse(a); } catch (e) { return a; } }));
      console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
      break;
    }
    case 'pin': console.log(setPin(pos[0], pos[1])); break;
    case 'props': {
      const t = need(pos[0]);
      if (pos.length > 1) { for (const kv of pos.slice(1)) { const i = kv.indexOf('='); t.store.setProp(kv.slice(0, i), kv.slice(i + 1)); } console.log('Сохранено'); }
      const p = t.store.props();
      for (const k of Object.keys(p).sort()) if (!k.startsWith('__')) console.log(`${k} = ${SECRET.test(k) ? '••••••' : p[k].slice(0, 120)}`);
      break;
    }
    case 'triggers': {
      const t = need(pos[0]);
      for (const x of t.store.triggers()) console.log(`${x.handler}\t${x.kind}\t${JSON.stringify(x.spec)}\tпоследний запуск: ${x.last_run ? new Date(x.last_run).toISOString() : '—'}${x.last_error ? '\tошибка: ' + x.last_error : ''}`);
      break;
    }
    case 'log': {
      const t = need(pos[0]);
      const rows = t.store.db.prepare('select * from log order by id desc limit ?').all(Number(pos[1] || 50)).reverse();
      for (const r of rows) console.log(`${new Date(r.at).toISOString()} ${r.level} ${r.msg}`);
      break;
    }
    case 'admin': {
      const t = tenants.createAdmin({ ownerEmail: flags.email });
      console.log(`Админ-панель: ${(process.env.APP_URL || 'http://localhost:8080').replace(/\/$/, '')}/admin/exec`);
      try { const r = t.execute('setupAdmin'); console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2)); } catch (e) { console.log('setupAdmin: ' + e.message); }
      try { t.execute('installTriggers'); console.log('Триггеры админ-панели установлены'); } catch (e) { console.log('installTriggers: ' + e.message); }
      console.log('Временный пароль — в журнале: node tools/tenant.js log _admin 20');
      break;
    }
    default:
      console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(3, 15).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
  }
}

function setPin(slug, pin) {
  if (!/^\d{6}$/.test(String(pin || ''))) throw new Error('Код — ровно 6 цифр');
  return String(need(slug).execute('mcRbBootstrapDevPin_', [String(pin)]));
}

try { main(); } catch (e) { console.error('Ошибка: ' + e.message + (e.where ? '\n' + e.where.split('\n').slice(0, 4).join('\n') : '')); process.exit(1); }
