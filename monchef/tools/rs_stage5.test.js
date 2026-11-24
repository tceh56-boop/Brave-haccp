// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
// Restaurant Service, этап 5: гостевое меню (публикация, медиа через приложение, публичная витрина, заявки гостей) и редактор ролей.
// Drive — имитация в памяти. Запуск: node monchef/tools/rs_stage5.test.js
const assert = require('assert');
const crypto = require('crypto');
const { boot } = require('./gasemu');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); } }
const J = s => (typeof s === 'string' ? JSON.parse(s) : s);
let seq = 0; const key = () => 'st5-key-' + (++seq);

const E = boot({ now: '2026-11-25T08:00:00Z' }), C = E.ctx, ss = E.ss;
// ---- Drive в памяти ----
const files = {}, folders = {}; let fid = 0;
const blobOf = (bytes, mime, name) => ({ getBytes: () => Array.from(bytes), getContentType: () => mime, getName: () => name });
const mkFolder = name => { const id = 'FOLD' + (++fid), f = { id, name, kids: {} };
  f.api = { getId: () => id, getName: () => name, createFolder: n => { const k = mkFolder(n); f.kids[n] = k; return k.api; },
    getFoldersByName: n => { let used = false; return { hasNext: () => !used && !!f.kids[n], next: () => { used = true; return f.kids[n].api; } }; },
    createFile: blob => { const fid2 = 'FILE' + (++fid), b = Buffer.from(blob.getBytes().map(x => (x < 0 ? x + 256 : x))); files[fid2] = { bytes: b, mime: blob.getContentType(), name: blob.getName ? blob.getName() : '', trashed: false };
      return { getId: () => fid2 }; } };
  folders[id] = f; return f; };
C.DriveApp = {
  createFolder: n => mkFolder(n).api, getFolderById: id => { if (!folders[id]) throw new Error('нет папки'); return folders[id].api; },
  getFileById: id => { const f = files[id]; if (!f) throw new Error('нет файла'); return { getBlob: () => blobOf(f.bytes, f.mime, f.name), setTrashed: v => { f.trashed = v; } }; }
};
// ---- данные ----
const emp = ss.insertSheet('Сотрудники');
emp.appendRow(['Фамилия', 'Имя', 'Отчество', 'Должность', 'Роль', 'ДР', 'Телефон', 'Адрес', 'ПИН-код', '', '', '', 'Активен']);
emp.appendRow(['Директорова', 'Анна', '', 'Директор', 'Директор', '', '', '', '1111', '', '', '', true]);
emp.appendRow(['Админов', 'Пётр', '', 'Администратор', 'Администратор', '', '', '', '2222', '', '', '', true]);
emp.appendRow(['Официантов', 'Иван', '', 'Официант', 'Официант', '', '', '', '3333', '', '', '', true]);
emp.appendRow(['Поваров', 'Олег', '', 'Повар', 'Повар горячего цеха', '', '', '', '4444', '', '', '', true]);
emp.appendRow(['Встречаева', 'Ольга', '', 'Хостес', 'Официант', '', '', '', '6666', '', '', '', true]);
const ds = ss.insertSheet('Блюда');
ds.appendRow(['Код', 'Название', 'Категория', 'Выход', '', '', '', '', 'Цех', '', '', '', 'Выход, г/мл/шт', 'Ед. выхода']);
[['D002', 'Сырная тарелка', 'Закуски', 'Холодный цех', 250, 'г'], ['D003', 'Цезарь', 'Салаты', 'Холодный цех', 220, 'г'], ['B001', 'Негрони', 'Коктейли', 'Бар', 120, 'мл'], ['D007', 'Секретное блюдо', 'Горячее', 'Горячий цех', 300, 'г']]
  .forEach(r => ds.appendRow([r[0], r[1], r[2], r[4], '', '', '', '', r[3], '', '', '', r[4], r[5]]));
const sostav = ss.insertSheet('Состав');
sostav.appendRow(['Код', 'Продукт', 'Группа', '', 'Брутто', 'Нетто', 'Выход', 'Ед.']);
[['D002', 'Сыр пармезан', 120], ['D002', 'Мёд', 30], ['D002', 'Грецкий орех', 25], ['D003', 'Салат романо', 80], ['D003', 'Курица филе', 100]].forEach(r => sostav.appendRow([r[0], r[1], '', '', r[2], r[2], r[2], 'г']));
const pr = ss.insertSheet('Цены_Меню');
pr.appendRow(['PriceID', 'DishCode', 'DishName', 'Price', 'Unit', 'Source', 'EventID', 'DateFrom', 'DateTo', 'Status']);
[['P2', 'D002', 890, 'порц.'], ['P3', 'D003', 650, 'порц.'], ['P6', 'B001', 700, 'порц.']].forEach(r => pr.appendRow([r[0], r[1], '', r[2], r[3], 'MENU', '', '2026-11-01', '', 'ACTIVE']));
const tv = ss.insertSheet('ТТК_Версии'); tv.appendRow(['Код блюда', 'Версия', 'Статус']); ['D002', 'D003', 'B001'].forEach(c => tv.appendRow([c, 1, 'действующая']));
const al = ss.insertSheet('Аллергены_Продукты');
al.appendRow(['ProductID', 'Продукт', 'Аллергены (коды)', 'Статус', 'Основание (документ)', 'Кто', 'Когда', 'OperationID', 'Комментарий']);
al.appendRow(['', 'Сыр пармезан', 'MILK', 'CONFIRMED', 'спецификация', '', '', '', '']);
al.appendRow(['', 'Мёд', '', 'NONE', 'спецификация', '', '', '', '']);
al.appendRow(['', 'Грецкий орех', 'NUTS', 'CONFIRMED', 'маркировка', '', '', '', '']);
// КБЖУ V73: у сыра — все значения утверждены, у цезаря — нет (расчёт V73 подменён)
C.calculateKBZHU = code => JSON.stringify(code === 'D002' ? { perPortion: { kcal: 612, protein: 38.5, fat: 41.2, carbs: 18.4 }, hasMissingData: false } : { perPortion: { kcal: 300, protein: 1, fat: 1, carbs: 1 }, hasMissingData: true });

const login = pin => J(C.loginWithPin(pin, 'dev-' + pin)).token;
const DIR = login('1111'), ADM = login('2222'), WAI = login('3333'), COOK = login('4444');
const call = (fn, tok, d) => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; return J(C[fn](JSON.stringify(d || {}), tok)); };
const pub = (fn, d) => { C._mcRcDrop_(); C._BOOK_CACHE_ = null; return J(C[fn](JSON.stringify(d || {}))); };
const ok = r => { assert.strictEqual(r.success, true, JSON.stringify(r)); return r.data; };
const err = (r, code) => { assert.notStrictEqual(r.success, true, 'ожидался отказ: ' + JSON.stringify(r).slice(0, 300)); if (code) assert.strictEqual(r.error && r.error.code, code, JSON.stringify(r)); return r; };
function upload(tok, code, bytes, mime, name) {
  const st = ok(call('rsMediaUploadStart', tok, { code, name, mime, size: bytes.length }));
  for (let i = 0; i < st.parts; i++) ok(call('rsMediaUploadPart', tok, { uploadId: st.uploadId, index: i, data: bytes.slice(i * st.chunk, (i + 1) * st.chunk).toString('base64') }));
  return ok(call('rsMediaUploadFinish', tok, { idem: key(), uploadId: st.uploadId })).media;
}
const hall = ok(call('rsHallSave', ADM, { idem: key(), name: 'Основной зал', width: 8, height: 5 }));
const T12 = ok(call('rsTableSave', ADM, { idem: key(), hallId: hall.id, number: '12', seatsMax: 4, x: 1, y: 1 }));

console.log('Restaurant Service — этап 5');
t('права: редактор меню — директор и администратор; официант и повар — нет', () => {
  ok(call('rsMenuAdmin', ADM)); ok(call('rsMenuAdmin', DIR));
  err(call('rsMenuAdmin', WAI)); err(call('rsMenuAdmin', COOK));
});
t('без входа закрытые функции меню недоступны; публичные — доступны', () => {
  err(J(C.rsMenuAdmin(JSON.stringify({}))));
  assert.strictEqual(pub('rsPublicMenu', {}).success, true);
});
let photo, video;
const png = crypto.randomBytes(5 * 1024 * 1024 + 123), mp4 = crypto.randomBytes(9 * 1024 * 1024 + 7);
t('загрузка частями: фото 5 МБ (2 части) и видео 9 МБ (3 части) — файл собран без потерь, SHA-256 записан', () => {
  photo = upload(ADM, 'D002', png, 'image/png', 'syr.png');
  video = upload(ADM, 'D002', mp4, 'video/mp4', 'syr.mp4');
  assert.strictEqual(photo.type, 'PHOTO'); assert.strictEqual(video.type, 'VIDEO'); assert.strictEqual(photo.cover, true); assert.strictEqual(video.cover, false);
  const rows = ss.getSheetByName('МедиаМеню_V1').getDataRange().getValues(), h = rows[0];
  const r = rows.find(x => x[0] === photo.id); assert.strictEqual(r[h.indexOf('SHA-256')], crypto.createHash('sha256').update(png).digest('hex'));
  assert.ok(Buffer.compare(files[r[h.indexOf('FileID')]].bytes, png) === 0);
  assert.ok(Object.values(files).filter(f => !f.trashed).length === 2, 'временные части удалены');
  assert.ok(!('fileId' in photo), 'ID файла Drive наружу не отдаётся');
});
t('загрузка: чужой формат, превышение размера — отказ', () => {
  err(call('rsMediaUploadStart', ADM, { code: 'D002', name: 'x.exe', mime: 'application/x-msdownload', size: 10 }));
  err(call('rsMediaUploadStart', ADM, { code: 'D002', name: 'x.png', mime: 'image/png', size: 9 * 1024 * 1024 }));
  err(call('rsMediaUploadStart', ADM, { code: 'D002', name: 'x.mp4', mime: 'video/mp4', size: 31 * 1024 * 1024 }));
});
t('публикация: без цены и без медиа — отказ; сыр — опубликован', () => {
  err(call('rsMenuSave', ADM, { idem: key(), code: 'D007', action: 'publish' }), 'VALIDATION');
  err(call('rsMenuSave', ADM, { idem: key(), code: 'D003', action: 'publish' }), 'VALIDATION');
  const r = ok(call('rsMenuSave', ADM, { idem: key(), code: 'D002', category: 'Закуски к вину', description: 'Три сыра с мёдом и орехами', order: 1, action: 'publish' }));
  assert.strictEqual(r.pub.status, 'PUBLISHED');
});
t('снимок: состав без граммовок, КБЖУ — только утверждённое, аллергены по ТТК', () => {
  const m = ok(pub('rsPublicMenu', {})), d = m.dishes.find(x => x.id === 'D002');
  assert.deepStrictEqual(d.composition, ['Сыр пармезан', 'Мёд', 'Грецкий орех']);
  assert.deepStrictEqual(d.kbju, { kcal: 612, protein: 38.5, fat: 41.2, carbs: 18.4, per: 'порция' });
  assert.deepStrictEqual(d.allergens.sort(), ['Молоко и лактоза', 'Орехи'].sort()); assert.strictEqual(d.allergensComplete, true);
  assert.strictEqual(d.priceKop, 89000); assert.strictEqual(d.category, 'Закуски к вину'); assert.strictEqual(d.media.length, 2);
});
t('КБЖУ не утверждено — «КБЖУ не определено», а не нули', () => {
  upload(ADM, 'D003', crypto.randomBytes(2000), 'image/jpeg', 'c.jpg');
  ok(call('rsMenuSave', ADM, { idem: key(), code: 'D003', action: 'publish' }));
  const d = ok(pub('rsPublicMenu', {})).dishes.find(x => x.id === 'D003');
  assert.strictEqual(d.kbju, null); assert.strictEqual(d.kbjuNote, 'КБЖУ не определено');
  assert.strictEqual(d.allergensComplete, false, 'профили салата и курицы не заведены');
});
t('публичное меню не раскрывает внутренние данные', () => {
  const j = JSON.stringify(ok(pub('rsPublicMenu', {})));
  ['fileId', 'FileID', 'cost', 'Себестоимость', 'PriceID', 'OperationID', 'CreatedBy', 'Брутто', 'brutto', 'ttk', 'Секретное блюдо', 'D007', 'Официантов'].forEach(w => assert.ok(j.indexOf(w) < 0, 'утечка: ' + w));
  assert.ok(!/\b120\b/.test(JSON.stringify(ok(pub('rsPublicMenu', {})).dishes.find(x => x.id === 'D002').composition)), 'граммовки нет');
});
t('медиа гостю — частями через приложение, собирается в исходный файл', () => {
  const parts = []; let p0 = ok(pub('rsPublicMedia', { id: video.id, part: 0 })); parts.push(p0.data);
  for (let i = 1; i < p0.parts; i++) parts.push(ok(pub('rsPublicMedia', { id: video.id, part: i })).data);
  assert.strictEqual(p0.parts, 5); assert.strictEqual(p0.mime, 'video/mp4');
  assert.ok(Buffer.compare(Buffer.concat(parts.map(b => Buffer.from(b, 'base64'))), mp4) === 0);
});
t('скрытое медиа и медиа неопубликованного блюда гостю не отдаются', () => {
  const m7 = upload(ADM, 'D007', crypto.randomBytes(1000), 'image/png', 's.png');
  err(pub('rsPublicMedia', { id: m7.id, part: 0 }));
  const cur = ok(call('rsMenuAdmin', ADM)).dishes.find(x => x.code === 'D002').media.find(x => x.id === video.id);
  ok(call('rsMediaUpdate', ADM, { idem: key(), id: video.id, version: cur.version, status: 'HIDDEN' }));
  err(pub('rsPublicMedia', { id: video.id, part: 0 }));
  ok(pub('rsPublicMedia', { id: photo.id, part: 0 }));
  err(pub('rsPublicMedia', { id: 'MED-ЛЮБОЙ', part: 0 }));
});
t('STOP: блюдо видно, но «сейчас нет»; цена берётся на сегодня', () => {
  const sg = ss.insertSheet('СтопГО_V1'); sg.appendRow(['StopID', 'DishCode', 'Подразделение', 'Статус', 'Остаток', 'Актуально']); sg.appendRow(['S1', 'D003', 'KITCHEN', 'STOP', '', true]);
  C.CacheService.getScriptCache().remove('rs_pub_menu');
  const d = ok(pub('rsPublicMenu', {})).dishes.find(x => x.id === 'D003'); assert.strictEqual(d.available, false);
  assert.ok(!JSON.stringify(d).includes('KITCHEN'), 'подразделение и причина STOP не раскрываются');
});
t('снять с публикации — блюдо пропадает у гостя', () => {
  const v = ok(call('rsMenuAdmin', ADM)).dishes.find(x => x.code === 'D003').pub.version;
  ok(call('rsMenuSave', ADM, { idem: key(), code: 'D003', version: v, action: 'unpublish' }));
  assert.ok(!ok(pub('rsPublicMenu', {})).dishes.some(x => x.id === 'D003'));
});
let qr;
t('заявка гостя: по умолчанию выключено; без QR стола — отказ', () => {
  qr = ok(call('rsHallData', ADM, {})).tables[0].qr; assert.ok(/^[a-z0-9]{12}$/.test(qr));
  assert.strictEqual(ok(pub('rsPublicMenu', { t: qr })).guestOrder, false);
  err(pub('rsGuestRequest', { idem: key(), t: qr, items: [{ id: 'D002', qty: 1 }] }));
  ok(call('rsMenuSettings', ADM, { idem: key(), guestOrder: true, title: 'Ресторан' }));
  const m = ok(pub('rsPublicMenu', { t: qr })); assert.strictEqual(m.guestOrder, true); assert.strictEqual(m.table.number, '12'); assert.strictEqual(m.title, 'Ресторан');
  assert.strictEqual(ok(pub('rsPublicMenu', {})).guestOrder, false, 'по общей ссылке — только просмотр');
  err(pub('rsGuestRequest', { idem: key(), t: 'aaaaaaaaaaaa', items: [{ id: 'D002', qty: 1 }] }));
});
let gr;
t('заявка гостя: принята сервером один раз, неопубликованное блюдо — отказ, лимит ожидающих — 3', () => {
  const k = key();
  gr = ok(pub('rsGuestRequest', { idem: k, t: qr, items: [{ id: 'D002', qty: 2, comment: 'без мёда' }], comment: 'побыстрее' }));
  assert.strictEqual(ok(pub('rsGuestRequest', { idem: k, t: qr, items: [{ id: 'D002', qty: 2 }] })).requestId, gr.requestId);
  err(pub('rsGuestRequest', { idem: key(), t: qr, items: [{ id: 'D007', qty: 1 }] }));
  ok(pub('rsGuestRequest', { idem: key(), t: qr, items: [{ id: 'D002', qty: 1 }] }));
  ok(pub('rsGuestRequest', { idem: key(), t: qr, items: [{ id: 'D002', qty: 1 }] }));
  err(pub('rsGuestRequest', { idem: key(), t: qr, items: [{ id: 'D002', qty: 1 }] }));
  assert.ok(!ss.getSheetByName('ОчередьПроизводства_V1') || ss.getSheetByName('ОчередьПроизводства_V1').getLastRow() <= 1, 'на кухню без официанта не ушло');
});
t('официант принимает заявку — заказ стола, позиции «не отправлено»; отклонение — с причиной', () => {
  const l = ok(call('rsGuestRequests', WAI, {})); assert.strictEqual(l.length, 3);
  const r0 = l.find(x => x.id === gr.requestId);
  const a = ok(call('rsGuestRequestDecide', WAI, { idem: key(), id: r0.id, version: r0.version, accept: true }));
  const o = ok(call('rsOrderGet', WAI, { id: a.orderId }));
  assert.strictEqual(o.items.length, 1); assert.strictEqual(o.items[0].status, 'DRAFT'); assert.strictEqual(o.items[0].qty, 2); assert.strictEqual(o.items[0].comment, 'без мёда');
  const r1 = l.find(x => x.id !== gr.requestId);
  err(call('rsGuestRequestDecide', WAI, { idem: key(), id: r1.id, version: r1.version, accept: false }), 'VALIDATION');
  ok(call('rsGuestRequestDecide', WAI, { idem: key(), id: r1.id, version: r1.version, accept: false, reason: 'гость за столом передумал' }));
  assert.strictEqual(ok(call('rsGuestRequests', WAI, {})).length, 1);
});
t('редактор ролей: только директор; снять право у роли — действует сразу; вернуть — тоже', () => {
  err(call('rsRolesGet', ADM));
  const g = ok(call('rsRolesGet', DIR)); assert.ok(g.roles.find(r => r.name === 'Администратор').perms.includes('booking'));
  err(call('rsRoleSave', DIR, { idem: key(), role: 'Администратор', perms: { booking: false } }), 'VALIDATION');   // без причины
  ok(call('rsRoleSave', DIR, { idem: key(), role: 'Администратор', perms: { booking: false }, reason: 'брони ведёт хостес' }));
  err(call('rsBookingCreate', ADM, { idem: key(), tables: [T12.id], guest: 'Х', date: '2026-11-26', start: '19:00', duration: 60, guests: 2 }));
  ok(call('rsRoleSave', DIR, { idem: key(), role: 'Администратор', perms: { booking: true }, reason: 'вернули' }));
  ok(call('rsBookingCreate', ADM, { idem: key(), tables: [T12.id], guest: 'Х', date: '2026-11-26', start: '19:00', duration: 60, guests: 2 }));
  const h = ok(call('rsRolesGet', DIR)).history; assert.strictEqual(h.length, 2); assert.strictEqual(h.filter(x => x.status === 'ACTIVE').length, 1);
});
t('редактор ролей: нельзя снять у директора управление правами и выдать «system»', () => {
  err(call('rsRoleSave', DIR, { idem: key(), role: 'Директор', perms: { roles_edit: false }, reason: 'тест' }));
  err(call('rsRoleSave', DIR, { idem: key(), role: 'Официант', perms: { system: true }, reason: 'тест' }));
});
t('своя роль «Хостес» на основе «Официант» + право бронирования; в архив — только без сотрудников', () => {
  ok(call('rsRoleCreate', DIR, { idem: key(), name: 'Хостес', base: 'Официант', description: 'встречает гостей', reason: 'новая должность' }));
  err(call('rsRoleCreate', DIR, { idem: key(), name: 'Хостес', base: 'Официант', reason: 'дубль' }));
  ok(call('rsRoleSave', DIR, { idem: key(), role: 'Хостес', perms: { booking: true }, reason: 'хостес ведёт брони' }));
  emp.getRange(6, 5).setValue('Хостес'); C._mcRbDrop_();
  const HOST = login('6666');
  ok(call('rsBookingCreate', HOST, { idem: key(), tables: [T12.id], guest: 'Гость хостес', date: '2026-11-27', start: '19:00', duration: 60, guests: 2 }));
  err(call('rsRoleSave', HOST, { idem: key(), role: 'Хостес', perms: { discount: true }, reason: 'сам себе' }));
  err(call('rsRoleArchive', DIR, { idem: key(), name: 'Хостес', reason: 'не нужна' }), 'VALIDATION');
  assert.ok(ok(call('rsRolesGet', DIR)).roles.find(r => r.name === 'Хостес').custom);
});
t('изменения ролей, публикации и заявок — в аудите', () => {
  const a = ss.getSheetByName('Audit_Log').getDataRange().getValues().map(r => r[7]);
  ['RS_MEDIA_UPLOADED', 'RS_MENU_PUBLISH', 'RS_MENU_UNPUBLISH', 'RS_ROLE_PERMS_CHANGED', 'RS_ROLE_CREATED', 'RS_GUEST_REQUEST_ACCEPTED', 'RS_GUEST_REQUEST_REJECTED'].forEach(x => assert.ok(a.includes(x), x));
});

console.log(`\nИтого: ${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);
