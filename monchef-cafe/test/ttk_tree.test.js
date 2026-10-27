/**
 * Дерево папок ТТК и СТО в MonChef (node test/ttk_tree.test.js): создание папок на Диске (имитация),
 * загрузка СТО в правила сроков V38, и главное — каждая из 234 карт, положенная в свою папку,
 * получает по правилам V38 ровно тот режим СТО, который ей назначен.
 */
'use strict';
const path = require('path'), assert = require('assert');
const { load } = require('./gas_mock');
const env = load(path.join(__dirname, '..', 'app'));
const g = env.ctx, book = env.book;
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓ ' + m); };
const J = x => typeof x === 'string' ? JSON.parse(x) : x;
const data = (x, w) => { const r = J(x); if (!(r && r.success)) throw new Error(w + ': ' + JSON.stringify(r).slice(0, 400)); return r.data; };

// Google Диск: папки в памяти
let fid = 0; const folders = {};
function mkFolder(name, parent) {
  const f = { id: 'F' + (++fid), name, parent, kids: [],
    getId() { return this.id; }, getName() { return this.name; }, getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; },
    getFoldersByName(n) { const l = this.kids.filter(k => k.name === n); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
    createFolder(n) { const k = mkFolder(n, this); this.kids.push(k); return k; },
    files: [], getFiles() { const l = this.files.slice(); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
    getFilesByName(n) { const l = this.files.filter(x => x.getName() === n); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
    createFile(b) { const f = { n: b.getName(), getName() { return this.n; }, getLastUpdated: () => new Date(), getBlob: () => ({ setContentType() {} }) }; this.files.push(f); return f; } };
  folders[f.id] = f; return f;
}
const driveRoot = mkFolder('Мой диск / Кафе', null);
g.DriveApp = { getFolderById: id => { if (!folders[id]) throw new Error('нет доступа к папке ' + id); return folders[id]; } };

const day = o => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + o); return d; };
const sh = book.insertSheet('Сотрудники');
sh.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'Дата рождения', 'Телефон', 'Адрес', 'ПИН-код', 'Сан. книжка №', 'Срок сан. книжки', 'Посл. мед. осмотр', 'Активен', 'Цвет', 'Ставка/час', 'Создан']);
[['Петров', 'Олег', '', 'Директор', 'Директор', '2222'], ['Иванова', 'Анна', '', 'Шеф-повар', 'Шеф-повар', '1111'], ['Кузнецов', 'Илья', '', 'Повар горячего цеха', 'Повар горячего цеха', '4444']]
  .forEach(e => sh.appendRow([e[0], e[1], e[2], e[3], e[4], '', '', '', e[5], 'СК', day(300), day(-30), true, '', '', new Date()]));
const login = p => J(g.loginWithPin(p, 'dev' + p)).token;
const dir = login('2222'), chef = login('1111'), cook = login('4444');

const T = g.MC_TTK_TREE_;
ok(T.folders.length === 25 && T.folders.reduce((a, f) => a + f.cards.length, 0) === 234, 'дерево: 25 папок, 234 карты');

console.log('Данные экрана');
let d = data(g.mcCafeTtkTreeData(chef), 'данные');
ok(d.rules.total > 25 && d.rules.loaded === 0 && d.canInstall && !d.canApprove, 'правил СТО ' + d.rules.total + ', не загружены; шеф может загрузить черновики, ввести в действие — нет');
ok(J(g.mcCafeTtkTreeInstall(JSON.stringify({ folders: true, rootId: driveRoot.id }), cook)).success === false, 'повар не создаёт дерево (403)');

console.log('Папки на Диске');
d = data(g.mcCafeTtkTreeInstall(JSON.stringify({ folders: true, rootId: 'https://drive.google.com/drive/folders/' + driveRoot.id + '?usp=sharing' }), chef), 'папки');
const expect = 1 + 3 + 2 + 25;   // корень, «00»+«СТО»+«99», «01»+«02», 25 групп
ok(d.drive.created === expect && d.drive.missing.length === 0, 'создано папок: ' + d.drive.created + ' (корень, общие, архив, 2 раздела, 25 групп); ссылка на папку принята');
d = data(g.mcCafeTtkTreeInstall(JSON.stringify({ folders: true }), chef), 'папки 2');
ok(d.drive.created === 0 && d.drive.exists === expect, 'повторный запуск ничего не создаёт и не трогает (корень запомнен)');
const top = driveRoot.kids.find(k => k.name === 'ТТК кафе');
ok(top.kids.find(k => k.name === '02 Полуфабрикаты').kids.some(k => k.name === '02.13 Полуфабрикаты из яиц и творога'), 'путь «ТТК кафе/02 Полуфабрикаты/02.13 …» на Диске');

console.log('Правила сроков V38');
ok(J(g.mcCafeTtkTreeInstall(JSON.stringify({ approve: true }), chef)).success === false, 'шеф не вводит правила в действие (нужно «Утверждение плана ХАССП»)');
d = data(g.mcCafeTtkTreeInstall(JSON.stringify({ rules: true }), chef), 'черновики');
ok(d.rules.added === d.rules.added && d.rules.status === 'DRAFT', 'правила загружены черновиками: ' + d.rules.added);
d = data(g.mcCafeTtkTreeInstall(JSON.stringify({ approve: true }), dir), 'утверждение');
ok(d.rules.updated > 0 && d.rules.added === 0 && d.rules.status === 'APPROVED', 'директор ввёл правила в действие, повторная загрузка обновляет, не дублирует');
const rules = book.getSheetByName(g.MC_V38.RULE).getDataRange().getValues().slice(1);
ok(rules.every(r => r[18] && r[17] === 'СТО предприятия'), 'у каждого правила — источник (номер СТО и режим)');

console.log('Каждая карта получает режим своего СТО');
let wrong = [], cnt = 0;
T.folders.forEach(f => f.cards.forEach(c => {
  const ttk = { id: 'T' + c.n, name: c.name, path: T.root + '/' + f.top + '/' + f.dir + '/ТТК ' + String(c.n).padStart(3, '0') + ' ' + c.name + '.docx', category: '' };
  let best = null;
  rules.forEach(r => { const h = g._v38Match_(r, ttk); if (h && (!best || h.score > best.h.score || (h.score === best.h.score && Number(r[1]) > Number(best.r[1])))) best = { r, h }; });
  cnt++;
  const want = f.sto + ', режим ' + c.regime + ' ';
  if (!best || String(best.r[18]).indexOf(want) !== 0) wrong.push(c.n + ' ' + c.name + ' → ' + (best ? best.r[18] : 'нет правила') + ' (ожидался ' + want + ')');
}));
ok(wrong.length === 0, 'все ' + cnt + ' карт: правило = режим своего СТО' + (wrong.length ? '\n    ' + wrong.join('\n    ') : ''));
const ttkPf = { id: 'X', name: 'Сырники (полуфабрикат)', path: 'ТТК кафе/02 Полуфабрикаты/02.13 Полуфабрикаты из яиц и творога/x', category: '' };
const ttkDish = { id: 'Y', name: 'Сырники с кремом из карамели', path: 'ТТК кафе/01 Блюда/01.01 Завтраки, каши, блюда из яиц и творога/x', category: '' };
const pick = t => { let b = null; rules.forEach(r => { const h = g._v38Match_(r, t); if (h && (!b || h.score > b.h.score || (h.score === b.h.score && Number(r[1]) > Number(b.r[1])))) b = { r, h }; }); return b && b.r; };
ok(pick(ttkPf)[9] === 24 && pick(ttkDish)[6] === 'SERVE_NOW', 'правило п/ф «Сырники» не задевает блюдо «Сырники с кремом»');
const crab = pick({ id: 'Z', name: 'Масса для краб-кейков', path: 'ТТК кафе/02 Полуфабрикаты/02.06 Рыба и морепродукты/x', category: '' });
ok(crab[9] === 24, 'конфликт внутри папки: «Масса для краб-кейков» — 24 ч (не 48 ч «Краб-кейка»)');
const unknownPf = pick({ id: 'N', name: 'Новый соус', path: 'ТТК кафе/02 Полуфабрикаты/02.01 Соусы горячие, бульоны, основы супов/x', category: '' });
ok(unknownPf[9] === 72 && unknownPf[13] === -18 && unknownPf[14] === 720, 'новая карта в папке 02.01 сразу получает СТО папки: 72 ч, заморозка −18 °С 30 сут');

if (process.env.TTK_ZIP) {   // архив сборки: TTK_ZIP="…/ТТК кафе.zip" node test/ttk_tree.test.js
console.log('Раскладка карт из архива');
const zipNames = require('child_process').execSync('unzip -Z1 ' + JSON.stringify(process.env.TTK_ZIP || ''), { encoding: 'utf8' }).split('\n').filter(Boolean);
top.createFile({ getName: () => 'ТТК кафе.zip' });
g.Utilities.unzip = () => zipNames.map(n => { let nm = n; return { getName: () => nm, setName(x) { nm = x; return this; } }; });
d = data(g.mcCafeTtkUnpack(chef), 'распаковка');
const docs = zipNames.filter(n => !/\/$/.test(n)).length;
ok(d.created === docs && d.left === 0, 'разложено файлов: ' + d.created + ' из архива ' + d.zip);
const pf = top.kids.find(k => k.name === '02 Полуфабрикаты').kids.find(k => k.name.startsWith('02.04'));
ok(pf.files.some(f => /^ТТК 069 /.test(f.getName())) && pf.files.some(f => /^_СТО 02.04-2026/.test(f.getName())), 'в папке 02.04 — карта № 69 и её СТО');
Object.keys(env.cache).filter(k => /^mc_gate_/.test(k)).forEach(k => delete env.cache[k]);   // прошло больше 15 с — не «двойное нажатие»
d = data(g.mcCafeTtkUnpack(chef), 'распаковка 2');
ok(d.created === 0 && d.skipped === docs, 'повторная раскладка ничего не дублирует');

} else console.log('  (раскладка из архива пропущена: задайте TTK_ZIP)');

console.log('Интерфейс');
d = data(g.mcCafeTtkTreeData(dir), 'данные 2');
ok(d.rules.approved === d.rules.total && d.drive && d.drive.exists === expect && d.deviations.length > 0, 'экран: правила в действии ' + d.rules.approved + '/' + d.rules.total + ', папки на Диске, отклонений карт ' + d.deviations.length);
const menu = g.uiData(dir, 'menu', {});
ok(menu.ok && menu.actions.some(a => a.module === 'cafettk'), 'в разделе «Меню и ТТК» — кнопка «Дерево папок и СТО»');
console.log('\nДерево ТТК: проверок пройдено ' + passed);
