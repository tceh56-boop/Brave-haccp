// Заявки поставщикам: карточка поставщика (контактное лицо, e-mail), сборка заявок по поставщикам, письмо и PDF.
// Запуск: node tests/supplier_orders.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), { make } = require('./gas_mock');
const root = path.join(__dirname, '..'), G = make('kitchen@example.com');
const book = (() => { const sh = {}; const mk = n => { const s = { data: [], getName: () => n, getLastRow: () => s.data.length, setFrozenRows() {}, setColumnWidth() {},
  appendRow(r) { s.data.push(r.slice()); },
  getRange(r, c, nr = 1, nc = 1) { return {
    setValues(v) { v.forEach((row, i) => { s.data[r - 1 + i] = s.data[r - 1 + i] || []; row.forEach((x, j) => { s.data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
    getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((s.data[r - 1 + i] || [])[c - 1 + j]) ?? ''); o.push(row); } return o; },
    getValue() { return ((s.data[r - 1] || [])[c - 1]) ?? ''; }, setValue(v) { s.data[r - 1] = s.data[r - 1] || []; s.data[r - 1][c - 1] = v; return this; }, setFontWeight() { return this; } }; },
  getDataRange() { const w = Math.max(1, ...s.data.map(r => r.length)); return s.getRange(1, 1, Math.max(1, s.data.length), w); } }; return s; };
  return { getSheetByName: n => sh[n] || null, insertSheet: n => (sh[n] = mk(n)), _sh: sh }; })();
const mails = [], saved = [], audit = [];
let session = { name: 'Закупкина Анна', role: 'Шеф-повар' };
G.MailApp = { sendEmail: (to, subj, body, opt) => mails.push({ to, subj, body, opt }), getRemainingDailyQuota: () => 100 };
G.HtmlService = { createHtmlOutput: h => ({ getBlob: () => ({ getAs: t => ({ type: t, html: h, setName(n) { this.name = n; return this; } }) }) }) };
G.Utilities.formatDate = (d, tz, f) => { const x = new Date(d), p = n => String(n).padStart(2, '0'); return f.replace('yyyy', x.getFullYear()).replace('MM', p(x.getMonth() + 1)).replace('dd', p(x.getDate())); };
Object.assign(G, {
  _book_: () => book, _mcTz_: () => 'Europe/Moscow', _withLock_: f => f(), _log_: () => {},
  _ok_: d => JSON.stringify({ success: true, data: d }), _fail_: (c, m) => JSON.stringify({ success: false, error: { code: c, message: m } }),
  _failFrom_: e => JSON.stringify({ success: false, error: { message: String(e.message || e) } }), _requireAuth_: () => session,
  _beginOp_: () => ({ id: 'OP', session }), _endOp_: () => {}, _audit_: (op, a, t, id, b, af) => audit.push([a, id, b, af]),
  _bcSheet_: (n, head) => { let s = book.getSheetByName(n); if (!s) { s = book.insertSheet(n); s.appendRow(head); } return s; },
  _v53Hash_: k => require('crypto').createHash('md5').update(k).digest('hex').slice(0, 8).toUpperCase(),
  _mcOrg_: () => ({ name: 'ООО «Кухня»', shortName: 'Кухня', inn: '7701234567', actualAddress: 'Москва, ул. Тестовая, 1', phone: '+7 900 000-00-00', email: 'office@kitchen.example' }),
  _tsTreeFolder_: (code, sub) => ({ createFile: b => { saved.push([code, sub, b.name]); return { getUrl: () => 'https://drive/' + b.name }; } }),
  _ts2Audit_: (a, t, id, b, af, txt) => audit.push([a, id, af, txt]),
  _dstr_: d => String(d), _dstr2_: d => String(d || ''),
  getStockBalances: () => JSON.stringify([
    { name: 'Филе куриное', unit: 'кг', qty: 2, minQty: 10, lastPrice: 400, isSemi: false },
    { name: 'Сливки 33%', unit: 'л', qty: 0, minQty: 5, lastPrice: 500, isSemi: false },
    { name: 'Соус демиглас', unit: 'л', qty: 0, minQty: 2, isSemi: true },
    { name: 'Мука', unit: 'кг', qty: 30, minQty: 10, isSemi: false }]),
  _getLastSupplier_: n => ({ 'Филе куриное': 'ООО «Птица»', 'Сливки 33%': 'Молочник' })[n] || ''
});
// функции заказов — из Code.gs как есть
const code = fs.readFileSync(path.join(root, 'app', 'Code.gs'), 'utf8');
const fn = name => { const i = code.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = code.indexOf('{', i); for (; j < code.length; j++) { if (code[j] === '{') d++; else if (code[j] === '}' && --d === 0) break; } return code.slice(i, j + 1); };
const ctx = vm.createContext(G);
vm.runInContext('var _PO_LAST_TS_ = 0;\n' + ['_supplierOrdersSheet_', '_nextOrderId_', '_createSupplierOrder_core_', 'getSupplierOrderById', '_updateOrderStatus_', 'getSupplierOrders'].map(fn).join('\n'), ctx);
['MonChef_MasterData.gs', 'TS_SupplierOrders.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, 'app', f), 'utf8'), ctx, { filename: f }));
const C = ctx, J = s => { const r = JSON.parse(s); if (!r.success) throw new Error(r.error.message); return r.data; }, F = s => JSON.parse(s);
let n = 0; const t = (name, f) => { f(); n++; console.log('  ✓ ' + name); };

t('карточка поставщика: организация, контактное лицо, телефон, e-mail для заявок; старый лист дополняется колонками', () => {
  book.insertSheet('Поставщики').appendRow(['SupplierID', 'Название', 'ИНН', 'Адрес', 'Контакты', 'Категории', 'Документы', 'Статус', 'Комментарий', 'Создан', 'Обновлено', 'Кто']);
  book.getSheetByName('Поставщики').appendRow(['SUP-OLD', 'Молочник', '', '', '+7 111', '', '', 'REVIEW', '', '', '', '']);
  const r = J(C.mcSaveSupplier(JSON.stringify({ name: 'ООО «Птица»', inn: '7712345678', contactPerson: 'Петрова Мария Ивановна', phone: '+7 495 111-22-33', email: 'zakaz@ptica.example', deliveryDays: 'пн, ср, пт до 10:00' }), 't'));
  assert.strictEqual(r.status, 'ACTIVE');
  assert.strictEqual(book.getSheetByName('Поставщики').data[0][14], 'E-mail для заявок', 'заголовки новых колонок дописаны в старый лист');
  const s = C._mdSuppliers_().find(x => x.name === 'ООО «Птица»');
  assert(s.contactPerson === 'Петрова Мария Ивановна' && s.email === 'zakaz@ptica.example' && s.phone && s.deliveryDays, JSON.stringify(s));
  assert.strictEqual(F(C.mcSaveSupplier(JSON.stringify({ name: 'Ошибка', email: 'zakaz@' }), 't')).success, false, 'e-mail с ошибкой не сохраняется');
  assert.strictEqual(C._mdSuppliers_().find(x => x.id === 'SUP-OLD').email, '', 'старая строка читается без ошибок');
});
let orders;
t('предложение: товары ниже минимума с последним поставщиком; полуфабрикаты и товары выше минимума не закупаются', () => {
  const d = J(C.tsOrderDraft('t'));
  assert.deepStrictEqual(d.lines.map(l => l.name).sort(), ['Сливки 33%', 'Филе куриное']);
  const f = d.lines.find(l => l.name === 'Филе куриное'); assert(f.qty === 8 && f.supplier === 'ООО «Птица»' && f.supplierId);
  assert(d.suppliers.some(s => s.email === 'zakaz@ptica.example'));
});
t('сборка: по одной заявке на поставщика; ошибки строк — без частичного создания', () => {
  assert.strictEqual(F(C.tsOrdersBuild('t', JSON.stringify([{ name: 'Филе куриное', qty: 8, unit: 'кг', supplier: '' }]), '', '')).success, false, 'строка без поставщика');
  assert.strictEqual(book.getSheetByName('Заказы_Поставщикам'), null, 'ничего не создано');
  orders = J(C.tsOrdersBuild('t', JSON.stringify([
    { name: 'Филе куриное', qty: 8, unit: 'кг', supplier: 'ООО «Птица»', price: 400 }, { name: 'Бедро куриное', qty: 5, unit: 'кг', supplier: 'ООО «Птица»' },
    { name: 'Сливки 33%', qty: 5, unit: 'л', supplier: 'Молочник' }, { name: '', qty: 1, supplier: 'Молочник' }]), '2026-11-14', 'к выходным')).orders;
  assert.strictEqual(orders.length, 2); assert.notStrictEqual(orders[0].orderId, orders[1].orderId, 'разные номера заявок');
  const p = orders.find(o => o.supplier === 'ООО «Птица»');
  assert(p.lines === 2 && p.email === 'zakaz@ptica.example' && p.contactPerson === 'Петрова Мария Ивановна');
  assert.strictEqual(orders.find(o => o.supplier === 'Молочник').email, '');
});
t('письмо: обращение к контактному лицу, позиции без цен, срок и адрес, подпись и ответ на почту организации', () => {
  const id = orders.find(o => o.supplier === 'ООО «Птица»').orderId, L = J(C.tsOrderLetter('t', id));
  assert.strictEqual(L.to, 'zakaz@ptica.example'); assert.strictEqual(L.cc, 'office@kitchen.example');
  assert(/Заявка № PO\d+ от \d\d\.\d\d\.\d{4} — Кухня, поставка 14\.11\.2026/.test(L.subject), L.subject);
  assert(/Здравствуйте, Петрова Мария Ивановна!/.test(L.html) && /Бедро куриное/.test(L.html) && /Москва, ул\. Тестовая, 1/.test(L.html) && /Закупкина Анна/.test(L.html) && /к выходным/.test(L.html));
  assert(!/400/.test(L.html), 'цены в письмо не попадают');
  if (process.env.SO_DUMP) fs.writeFileSync(process.env.SO_DUMP, '<meta charset="utf-8"><body style="background:#fff;padding:20px"><div style="font:13px Arial;color:#555;margin-bottom:10px">Кому: ' + L.to + ' · Копия: ' + L.cc + '<br>Тема: ' + L.subject + '</div>' + L.html + '</body>'); assert.strictEqual(L.missing.length, 0);
  assert(/e-mail для заявок/.test(J(C.tsOrderLetter('t', orders.find(o => o.supplier === 'Молочник').orderId)).missing.join()));
});
t('отправка: письмо с почты системы с PDF, копия и ответ — на почту организации, PDF в папке, заказ «Отправлен», аудит', () => {
  const id = orders.find(o => o.supplier === 'ООО «Птица»').orderId, r = J(C.tsOrderSend('t', id, 'Просим привезти до 10:00'));
  const m = mails.pop(); assert(m.to === 'zakaz@ptica.example' && m.opt.cc === 'office@kitchen.example' && m.opt.replyTo === 'office@kitchen.example' && m.opt.name === 'Кухня');
  assert(m.opt.attachments[0].type === 'application/pdf' && /^Заявка PO\d+ — ООО «Птица»/.test(m.opt.attachments[0].name) && /Просим привезти до 10:00/.test(m.opt.htmlBody));
  assert.deepStrictEqual(saved[0].slice(0, 2), ['PRODUCTS', 'Заявки поставщикам']);
  assert.strictEqual(JSON.parse(C.getSupplierOrderById(id)).status, 'sent');
  const row = book.getSheetByName('Заказы_Поставщикам').data.find(x => x[0] === id); assert(/zakaz@ptica\.example, копия office@/.test(row[13]) && row[14] && row[12]);
  assert(audit.some(a => a[0] === 'SUPPLIER_ORDER_EMAIL' && a[1] === id)); assert(r.file);
});
t('без e-mail поставщика — понятный отказ; пакетная отправка: ошибка одного не мешает остальным', () => {
  const mol = orders.find(o => o.supplier === 'Молочник').orderId, pt = orders.find(o => o.supplier === 'ООО «Птица»').orderId;
  assert(/нет e-mail для заявок/.test(F(C.tsOrderSend('t', mol)).error.message));
  const before = mails.length, res = J(C.tsOrdersSendMany('t', JSON.stringify([mol, pt]))).results;
  assert(!res[0].ok && res[1].ok && mails.length === before + 1, JSON.stringify(res));
});
t('отменённый заказ письмом не отправляется; заблокированный поставщик не попадает в заявку', () => {
  const pt = orders.find(o => o.supplier === 'ООО «Птица»').orderId; C._updateOrderStatus_(pt, 'cancelled');
  assert(/отменён/.test(F(C.tsOrderSend('t', pt)).error.message));
  J(C.mcSaveSupplier(JSON.stringify({ id: C._mdSuppliers_().find(x => x.name === 'Молочник').id, name: 'Молочник', status: 'BLOCKED' }), 't'));
  assert(/заблокирован/.test(F(C.tsOrdersBuild('t', JSON.stringify([{ name: 'Сливки', qty: 1, unit: 'л', supplier: 'Молочник' }]), '', '')).error.message));
  assert(!J(C.tsOrderDraft('t')).suppliers.some(s => s.name === 'Молочник'));
});
t('карточка поставщика: реквизиты, заказы с письмом, поставки с входным контролем, документы и договоры со сроками, сводка', () => {
  const sup = C._mdSuppliers_().find(x => x.name === 'ООО «Птица»'), day = d => { const x = new Date(); x.setDate(x.getDate() + d); return x; };
  const add = (name, head, rows) => { const s = book.getSheetByName(name) || book.insertSheet(name); if (!s.data.length) s.appendRow(head); rows.forEach(r => s.appendRow(r)); };
  const bh = ['ID', 'Продукт', 'Ед.изм', 'Кол-во', 'Получено', 'Срок годности', 'Цена за ед.', 'Источник', 'Использовано', 'Остаток', 'Статус', '', '', '', '', '', '', 'ProductID', 'SupplierID'];
  const b = (id, prod, rec, src, sid) => [id, prod, 'кг', 10, rec, day(5), 400, src, 0, 10, 'ACTIVE', '', '', '', '', '', '', 'P', sid];
  add('Склад_Партии', bh, [b('MC-1', 'Филе куриное', day(-3), 'Приход', sup.id), b('MC-2', 'Бедро куриное', day(-1), 'Приход', sup.id), b('B-OLD', 'Окорочка', day(-30), 'Приход: ООО «Птица»', ''), b('MC-3', 'Сливки', day(-2), 'Приход', 'SUP-X')]);
  add('Входной_Контроль', ['ControlID', 'BatchID', 'Продукт', 'Источник', 'Документ', 'Этап', 't', 'mn', 'mx', 'О', 'У', 'Решение', 'Причины'], [['IC1', 'MC-1', '', '', '', '', '', '', '', '', '', 'RELEASED', ''], ['IC2', 'MC-2', '', '', '', '', '', '', '', '', '', 'QUARANTINE', 't° 9 °C выше нормы']]);
  add('Документы_Сырьё', ['DocumentID', 'Тип', 'Номер', 'Дата', 'Действует до', 'SupplierID', 'Поставщик', 'ProductID', 'Продукт', 'BatchID', 'FileID', 'Hash', 'Статус'],
    [['D1', 'Декларация', 'ЕАЭС N RU Д-1', day(-300), day(10), sup.id, '', '', 'Филе куриное', '', '', '', 'ПРОВЕРЕН'], ['D2', 'Сертификат', 'С-2', day(-500), day(-1), '', 'ООО «Птица»', '', 'Бедро', '', '', '', ''], ['D3', 'Декларация', 'X', '', day(100), 'SUP-X', '', '', '', '', '', '', '']]);
  add('ЦС_Договоры', ['ID', 'Номер', 'Дата', 'Контрагент', 'ИНН', 'Вид', 'Предмет', 'Сумма', 'Начало', 'Окончание', 'Автопролонгация', 'Ответственный', 'Файл', 'Статус'],
    [['C1', '12/П', '', 'ООО Птица', '7712345678', 'Поставка продуктов', '', '', day(-200), day(200), 'нет', '', '', 'ACTIVE'], ['C2', '1', '', 'Другой', '7700000001', 'Аренда', '', '', '', day(5), 'нет', '', '', '']]);
  const c = J(C.tsSupplierCard('t', sup.id));
  assert.strictEqual(c.supplier.contactPerson, 'Петрова Мария Ивановна');
  assert(c.orders.length === 1 && c.orders[0].sentTo.includes('zakaz@ptica.example') && c.orders[0].file && c.orders[0].status === 'cancelled', JSON.stringify(c.orders));
  assert.deepStrictEqual(c.batches.map(x => x.id), ['MC-2', 'MC-1', 'B-OLD'], 'партии поставщика (по ID и старые по названию), новые сверху');
  assert(c.batches[0].control === 'QUARANTINE' && /9 °C/.test(c.batches[0].reasons) && c.batches[1].control === 'RELEASED');
  assert.deepStrictEqual(c.documents.map(d => d.id + ':' + d.term), ['D1:EXPIRING', 'D2:EXPIRED']);
  assert.deepStrictEqual(c.contracts.map(x => x.id + ':' + x.term), ['C1:OK'], 'договор по ИНН');
  assert(c.summary.batches === 3 && c.summary.rejected === 1 && c.summary.docsProblems === 2 && c.summary.ordersSum === 0 && c.summary.orders === 1);
  assert(/не найден/.test(F(C.tsSupplierCard('t', 'SUP-NONE')).error.message));
});
console.log('Заявки поставщикам: ' + n + ' сценариев пройдено');
