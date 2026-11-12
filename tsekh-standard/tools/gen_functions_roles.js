// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// ДОК_8 «Функции сервера × роли» — из настоящих данных: карта шлюза (zzz_MonChef_Gate.gs), функции ЦЕХ Стандарт (TS_GATE_),
// матрица прав ролей (MonChef_Rbac.gs). Шлюз проверяет право роли строго (_mcRbHasExact_), технический доступ — всё, кроме списка DEVNO.
// node tools/gen_functions_roles.js → docs/ДОК_8_Функции_и_роли.md и .csv
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..'), app = path.join(root, 'app'), docs = path.join(root, 'docs');
const read = f => fs.readFileSync(path.join(app, f), 'utf8');
const gate = read('zzz_MonChef_Gate.gs');
const list = k => { const m = new RegExp('var ' + k + ' = (\\[[^\\]]*\\])').exec(gate); return m ? JSON.parse(m[1]) : []; };
const needMap = JSON.parse(/var MC_GATE_NEED_ = (\{[^}]*\})/.exec(gate)[1]);
const ts = vm.runInNewContext(/var TS_GATE_ = (\[[\s\S]*?\n\]);/.exec(read('TS_Subscription.gs'))[1]);
const ctx = vm.createContext({}); vm.runInContext(read('MonChef_Rbac.gs'), ctx);
const PERMS = vm.runInContext('MC_RB_PERMS_', ctx), MATRIX = vm.runInContext('MC_RB_MATRIX_', ctx);
const ROLES = [['Д', 'Директор'], ['А', 'Администратор'], ['Ш', 'Шеф-повар'], ['СШ', 'Су-шеф'], ['К', 'Кондитер'], ['Пх', 'Повар холодного цеха'], ['Пг', 'Повар горячего цеха'], ['Х', 'Ответственный за ХАССП']];
const DEVNO = new Set(list('MC_GATE_DEVNO_'));
const desc = {}, group = {}; PERMS.forEach(p => { desc[p[0]] = p[1]; group[p[0]] = p[2]; });
const fns = new Map(); list('MC_GATE_CLIENT_').forEach(n => fns.set(n, needMap[n] || ''));
ts.forEach(g => fns.set(g.n, g.need || ''));
const keys = need => String(need || '').split('|').map(s => s.trim()).filter(Boolean);
const right = need => need === '*' || need === '' ? 'любой вошедший' : need === 'system' ? 'только технический доступ' : keys(need).map(k => desc[k] || k).join(' или ');
const sect = need => need === '*' || need === '' ? 'Общее (любой вошедший)' : need === 'system' ? 'Настройки (технический доступ)' : (keys(need).map(k => group[k]).find(Boolean) || 'Прочее');
const allowed = (role, need) => need === '*' || need === '' || (need !== 'system' && keys(need).some(k => (MATRIX[role] || []).indexOf(k) >= 0));
const rows = [...fns.entries()].map(([n, need]) => ({ n, need, sect: sect(need), right: right(need), cells: ROLES.map(r => allowed(r[1], need) ? '✓' : '—').concat([DEVNO.has(n) ? '✗' : '✓']) }));
const order = ['Общее (любой вошедший)'].concat([...new Set(PERMS.map(p => p[2]))], ['Прочее', 'Настройки (технический доступ)']);
rows.sort((a, b) => order.indexOf(a.sect) - order.indexOf(b.sect) || a.n.localeCompare(b.n));
const cnt = ROLES.map((r, i) => r[0] + ': ' + rows.filter(x => x.cells[i] === '✓').length).concat(['Т: ' + rows.filter(x => x.cells[8] === '✓').length]);
const D = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
const NEW4 = ts.filter(g => /^(ttkProc|haccp(Link|Hazard)|ppkLegacy|clg|vio|a360)/.test(g.n)).map(g => g.n);
let md = '# ЦЕХ Стандарт — функции сервера × роли\n\nСобственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.\n\n' +
  'Каждая функция, которую вызывают экраны, проходит единый шлюз (zzz_MonChef_Gate.gs). Таблица собрана автоматически (`node tools/gen_functions_roles.js`) из карты шлюза, списка функций ЦЕХ Стандарт (TS_GATE_) и матрицы прав ролей на ' + D + ': ✓ — разрешено, — — ответ 403 и запись ACCESS_DENIED в аудит. Т — технический доступ (✗ — запись ХАССП, технический доступ её не делает).\n' +
  'Для журналов дополнительно действует список ролей журнала (ДОК_2, раздел 5), для ККТ — цех и тепловая обработка (ДОК_2, раздел 7). Индивидуальные права (ДОК_2, раздел 3) добавляют разрешение конкретному сотруднику. Функции модулей тарифа дополнительно проверяют тариф предприятия.\n\n' +
  'Колонки: ' + ROLES.map(r => r[0] + ' — ' + r[1]).join(', ') + ', Т — технический доступ.\n\n' +
  '**Всего функций: ' + rows.length + '.**\n\nРазрешено функций по ролям: ' + cnt.join(' · ') + '.\n\n' +
  '**Цепочка контроля (Мастер-промт 4.0), ' + NEW4.length + ' функций:** ' + NEW4.join(', ') + '. Анализ опасностей (решение «значима / не значима»), перенос прежних разделов ППК и нарушений — ответственный за ХАССП и директор; утверждение и ввод ППК — директор (право «ППК: утверждение»).\n';
order.forEach(s => {
  const r = rows.filter(x => x.sect === s); if (!r.length) return;
  md += '\n## ' + s + ' (' + r.length + ')\n\n| Функция | Право | ' + ROLES.map(x => x[0]).join(' | ') + ' | Т |\n|---|---|' + ROLES.map(() => ':-:').join('|') + '|:-:|\n' +
    r.map(x => '| ' + x.n + ' | ' + x.right + ' | ' + x.cells.join(' | ') + ' |').join('\n') + '\n';
});
fs.writeFileSync(path.join(docs, 'ДОК_8_Функции_и_роли.md'), md);
fs.writeFileSync(path.join(docs, 'ДОК_8_Функции_и_роли.csv'), '﻿Функция;Право (шлюз);' + ROLES.map(r => r[0]).join(';') + ';Т\n' + rows.map(x => [x.n, x.need || '*'].concat(x.cells).join(';')).join('\n') + '\n');
console.log('ДОК_8: функций ' + rows.length + '; ' + cnt.join(' · ') + '; цепочка 4.0: ' + NEW4.length);
