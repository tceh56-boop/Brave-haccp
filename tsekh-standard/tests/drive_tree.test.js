// Папки модулей MonChef → дерево предприятия: содержимое переносится один раз, ничего не теряется; без дерева — прежние папки.
// Запуск: node tests/drive_tree.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
let n = 0; const all = [];
const folder = (name, parent) => { const f = { id: 'F' + (++n), name, parent, kids: [], files: [], getId() { return f.id; }, getName() { return f.name; }, setName(v) { f.name = v; },
  getFoldersByName: x => { const l = f.kids.filter(k => k.name === x); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
  createFolder: x => { const k = folder(x, f); f.kids.push(k); return k; },
  getFolders: () => { const l = f.kids.slice(); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
  getFiles: () => { const l = f.files.slice(); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; },
  moveTo(t) { f.parent.kids = f.parent.kids.filter(k => k !== f); f.parent = t; t.kids.push(f); } }; all.push(f); return f; };
const root = folder('Мой диск', null);
const file = (name, parent) => { const x = { name, moveTo(t) { parent.files = parent.files.filter(y => y !== x); parent = t; t.files.push(x); } }; parent.files.push(x); return x; };
// у клиента уже есть архивы в старой папке в корне Диска
const old = root.createFolder('MON CHEF — Архив'); old.createFolder('Октябрь 2026 г'); file('README.txt', old);
const tree = root.createFolder('ENT-0001 — Кафе Тест'), arch = tree.createFolder('99_Архив');
const G = make('owner@example.com');
G.DriveApp = { getFoldersByName: x => { const l = all.filter(f => f.name === x); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; }, createFolder: x => root.createFolder(x) };
let treeOn = true; const audits = [];
Object.assign(G, { _book_: () => ({ getSheetByName: x => treeOn && x === 'DRIVE_REGISTRY' ? {} : null }), _ts2Folder_: code => ({ ARCHIVE: arch })[code] || tree.createFolder(code), _ts2Audit_: (...a) => audits.push(a),
  _tsBrandFolder_: (a, b) => { const l = all.filter(f => f.name === a || f.name === b); return l[0] || root.createFolder(a); } });
const ctx = vm.createContext(G); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'TS_DriveTree.gs'), 'utf8'), ctx);
const t = ctx._tsTreeFolder_('ARCHIVE', '', ['ЦЕХ Стандарт — Архив', 'MON CHEF — Архив']);
assert.strictEqual(t, arch, 'архив — в «99_Архив» дерева предприятия');
assert(arch.kids.some(k => k.name === 'Октябрь 2026 г') && arch.files.some(f => f.name === 'README.txt'), 'прежние архивы перенесены, а не скопированы');
assert.strictEqual(old.kids.length + old.files.length, 0); assert(/перенесено в папку предприятия/.test(old.name), 'пустая старая папка помечена');
assert(audits.some(a => a[0] === 'DRIVE_TREE_MOVE'), 'перенос в журнале аудита');
const again = ctx._tsTreeFolder_('ARCHIVE', '', ['ЦЕХ Стандарт — Архив', 'MON CHEF — Архив']); assert.strictEqual(again, arch); assert.strictEqual(audits.length, 1, 'повторно не переносит');
const sub = ctx._tsTreeFolder_('HACCP', 'Пакеты проверки', ['ЦЕХ Стандарт — Пакеты проверки']); assert.strictEqual(sub.name, 'Пакеты проверки'); assert.strictEqual(sub.parent.name, 'HACCP');
treeOn = false; const fb = ctx._tsTreeFolder_('BACKUPS', '', ['Бэкапы ЦЕХ Стандарт', 'Бэкапы Mon Chef']); assert.strictEqual(fb.name, 'Бэкапы ЦЕХ Стандарт', 'без дерева — прежнее поведение');
// исходники: папок MonChef в корне Диска больше не создаётся, когда дерево установлено
const src = fs.readdirSync(path.join(__dirname, '..', 'app')).filter(f => f.endsWith('.gs')).map(f => fs.readFileSync(path.join(__dirname, '..', 'app', f), 'utf8')).join('\n');
['_blanksFolder_', '_invoicesFolder_', '_exportFolder_', '_journalsRootFolder_', '_mcV8ArchiveRoot_', '_jfDriveRoot_'].forEach(fn => {
  const i = src.indexOf('function ' + fn + '('); assert(i >= 0, fn); assert(/_tsTree(Ready|Folder)_/.test(src.slice(i, i + 700)), fn + ' использует дерево предприятия'); });
// прежние имена папок (по ним идёт перенос) не должны быть заменены ребрендингом
["'MON CHEF — Журналы'", "'Mon Chef — Пакеты проверки'", "'Mon Chef — Документы'", "'Документы на сырьё Mon Chef'", "'Бэкапы Mon Chef'", "'Выгрузки Mon Cher'", "'Журналы Mon Cher'", "'MON CHEF — Архив'"]
  .forEach(n => assert(src.includes(n), 'прежнее имя папки для переноса: ' + n));
console.log('OK: папки системы — в дереве предприятия, прежние перенесены без потерь');
