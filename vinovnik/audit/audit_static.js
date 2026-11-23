/**
 * Статический и загрузочный аудит сборки MON CHEF (node audit/audit_static.js [папка app]).
 * Проверяет: синтаксис .gs и скриптов .html; повторы функций верхнего уровня; вызовы сервера со страниц —
 * есть ли функция и пропустит ли её шлюз; захардкоженные ID и ключи; загрузку проекта и построение разделов
 * главного окна под каждой ролью. Итог — audit/out/static.json и сводка в консоль.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = path.resolve(process.argv[2] || path.join(__dirname, '..', 'app'));
const { load, projectFiles } = require('../test/gas_mock');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const R = { app: APP, files: {}, syntax: [], dupFns: [], clientCalls: { missing: [], adminOnly: [], ok: 0 }, ids: [], secrets: [], load: null, sections: [], gate: {} };

const files = fs.readdirSync(APP);
const gs = projectFiles(APP), html = files.filter(f => /\.html$/.test(f));
R.files = { total: files.length, gs: files.filter(f => /\.gs$/.test(f)).length, loaded: gs.length, html: html.length,
  md: files.filter(f => /\.md$/.test(f)).length, pdf: files.filter(f => /\.pdf$/.test(f)).length, other: files.filter(f => !/\.(gs|html|md|pdf)$/.test(f)) };

// 1. синтаксис
const src = {};
gs.forEach(f => { src[f] = fs.readFileSync(path.join(APP, f), 'utf8'); try { new vm.Script(src[f], { filename: f }); } catch (e) { R.syntax.push(f + ': ' + e.message); } });
const htmlSrc = {};
html.forEach(f => {
  const t = htmlSrc[f] = fs.readFileSync(path.join(APP, f), 'utf8');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi; let m, k = 0;
  while ((m = re.exec(t))) { k++; const code = m[1].replace(/<\?[!=]?[\s\S]*?\?>/g, 'null'); try { new vm.Script(code, { filename: f + '#' + k }); } catch (e) { R.syntax.push(f + ' (скрипт ' + k + '): ' + e.message); } }
});

// 2. повторы функций верхнего уровня (последняя по порядку загрузки побеждает — переопределения намеренные и нет)
const where = {};
gs.forEach(f => { const re = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm; let m; while ((m = re.exec(src[f]))) (where[m[1]] = where[m[1]] || []).push(f); });
Object.keys(where).forEach(n => { if (where[n].length > 1) R.dupFns.push({ fn: n, files: where[n] }); });

// 3. вызовы сервера со страниц
const gate = src['zzz_MonChef_Gate.gs'] || '';
const arr = name => { const m = new RegExp('var ' + name + ' = (\\[[^\\n]*\\]);').exec(gate); return m ? JSON.parse(m[1]) : []; };
// списки шлюза — после загрузки проекта (модули дописывают свои функции в списки при загрузке)
let G0 = null; try { G0 = load(APP).ctx; } catch (e) { G0 = null; }
const garr = n => G0 && Array.isArray(G0[n]) ? G0[n] : arr(n);
const CL = new Set(garr('MC_GATE_CLIENT_')), PUB = new Set(garr('MC_GATE_PUBLIC_')), RAW = new Set(garr('MC_GATE_RAW_')), PORTAL = new Set(garr('MC_GATE_PORTAL_'));
R.gate = { client: CL.size, mut: garr('MC_GATE_MUT_').length, public: PUB.size, raw: RAW.size, trigger: garr('MC_GATE_TRIGGER_').length };
const called = {};
html.forEach(f => {
  const t = htmlSrc[f], pats = [/\brun\(\s*'([A-Za-z0-9_]+)'/g, /\bvCall\(\s*'([A-Za-z0-9_]+)'/g, /\bvDo\([^,]+,\s*'([A-Za-z0-9_]+)'/g, /google\.script\.run(?:\.with\w+\([^)]*\))*\.([A-Za-z0-9_]+)\(/g, /\bfn:\s*'([A-Za-z0-9_]+)'/g];
  pats.forEach(re => { let m; while ((m = re.exec(t))) { const n = m[1]; if (/^with/.test(n)) continue; (called[n] = called[n] || new Set()).add(f); } });
  let fm; const fre = /(?:fns|callFns):\s*(\{[^}]*\}|\[[^\]]*\])/g;
  while ((fm = fre.exec(t))) (fm[1].match(/'([A-Za-z0-9_]+)'/g) || []).forEach(q => { const n = q.slice(1, -1); if (/^[a-z]+$/.test(n) && !where[n]) return; (called[n] = called[n] || new Set()).add(f); });
});
Object.keys(called).sort().forEach(n => {
  const pages = [...called[n]].join(', ');
  if (!where[n] && !/^(apply|call)$/.test(n)) R.clientCalls.missing.push(n + ' — ' + pages);
  else if (where[n] && !CL.has(n) && !PUB.has(n) && !RAW.has(n) && !PORTAL.has(n) && !/_$/.test(n)) R.clientCalls.adminOnly.push(n + ' — ' + pages);
  else R.clientCalls.ok++;
});

// 4. ID и ключи в коде
gs.forEach(f => {
  const lines = src[f].split('\n');
  lines.forEach((l, i) => {
    if (/AIza[0-9A-Za-z_-]{30,}|Api-Key\s+[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|AQVN[A-Za-z0-9_-]{20,}/.test(l)) R.secrets.push(f + ':' + (i + 1));
    const m = l.match(/['"]1[A-Za-z0-9_-]{24,60}['"]/g);
    if (m && !/^\s*(\/\/|\*)/.test(l)) m.forEach(x => R.ids.push(f + ':' + (i + 1) + ' ' + x));
  });
});

// 5. загрузка и разделы главного окна под ролями
try {
  const env = load(APP); R.load = 'OK';
  const g = env.ctx, book = env.book, J = x => typeof x === 'string' ? JSON.parse(x) : x;
  const sh = book.insertSheet('Сотрудники');
  sh.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'Дата рождения', 'Телефон', 'Адрес', 'ПИН-код', 'Сан. книжка №', 'Срок сан. книжки', 'Посл. мед. осмотр', 'Активен', 'Цвет', 'Ставка/час', 'Создан']);
  const d = o => { const x = new Date(); x.setDate(x.getDate() + o); return x; };
  const roles = Object.keys(g.MC_RB_MATRIX_);
  roles.forEach((r, i) => sh.appendRow(['Тест' + i, 'Роль', '', r, r, '', '', '', String(3000 + i), 'СК', d(300), d(-30), true, '', '', new Date()]));
  roles.forEach((r, i) => {
    let tok = ''; try { tok = J(g.loginWithPin(String(3000 + i), 'dev' + i)).token; } catch (e) { R.sections.push({ role: r, error: 'вход: ' + e.message }); return; }
    if (!tok) { R.sections.push({ role: r, error: 'вход не выдал ключ' }); return; }
    const me = J(g.uiMe(tok)) || {}, secs = (me.sections || me.data && me.data.sections || []);
    const bad = [];
    (g.UI_SECTIONS || []).forEach(s => {
      try { const x = g.uiData(tok, s, {}); if (x && x.ok === false && !/доступ|прав/i.test(JSON.stringify(x.error || x.message || ''))) bad.push(s + ': ' + JSON.stringify(x.error || x.message).slice(0, 160)); }
      catch (e) { bad.push(s + ': ' + String(e.message || e).slice(0, 160)); }
    });
    R.sections.push({ role: r, sections: Array.isArray(secs) ? secs.length : Object.keys(secs).length, errors: bad });
  });
} catch (e) { R.load = 'ОШИБКА: ' + String(e.message || e).slice(0, 600); }

fs.writeFileSync(path.join(OUT, 'static.json'), JSON.stringify(R, null, 1));
console.log('Файлов', R.files.total, '· .gs', R.files.gs, '(загружается', R.files.loaded + ') · .html', R.files.html, '· .md', R.files.md, '· .pdf', R.files.pdf);
console.log('Синтаксис: ошибок', R.syntax.length); R.syntax.forEach(x => console.log('  ✗ ' + x));
console.log('Повторы функций:', R.dupFns.length);
console.log('Вызовы со страниц: найдено', R.clientCalls.ok, '· нет на сервере', R.clientCalls.missing.length, '· только для технического доступа', R.clientCalls.adminOnly.length);
R.clientCalls.missing.forEach(x => console.log('  нет: ' + x)); R.clientCalls.adminOnly.forEach(x => console.log('  админ: ' + x));
console.log('ID в коде:', R.ids.length, '· похожие на ключи:', R.secrets.length);
console.log('Загрузка:', R.load);
R.sections.forEach(s => console.log('  ' + s.role + ': разделов ' + (s.sections || 0) + (s.error ? ' · ' + s.error : '') + (s.errors && s.errors.length ? ' · ошибки: ' + s.errors.join(' | ') : '')));
