// Страница «Поставщики»: список → карточка поставщика → изменить / добавить → новая заявка из карточки.
// Запуск: node tests/supplier_card.browser.test.js [папка для снимков]
const { chromium } = require('playwright'), path = require('path'), assert = require('assert');
const SHOTS = process.argv[2] || '';
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    window.__calls = []; window.confirm = () => true;
    const S = [{ id: 'SUP-1', name: 'ООО «Птица»', inn: '7712345678', address: 'Москва, ул. Складская, 5', contactPerson: 'Петрова Мария Ивановна', phone: '+7 495 111-22-33', email: 'zakaz@ptica.example', deliveryDays: 'пн, ср, пт до 10:00', categories: 'мясо, птица', status: 'ACTIVE' },
      { id: 'SUP-2', name: 'Молочник', inn: '', contactPerson: '', email: '', status: 'REVIEW' }];
    const card = { supplier: S[0], summary: { orders: 3, ordersActive: 1, ordersSum: 48200, batches: 12, lastDelivery: '2026-11-10', rejected: 1, docsProblems: 1 },
      orders: [{ id: 'PO1794412567084', date: '2026-11-11', status: 'sent', lines: 2, total: 5200, dueDate: '2026-11-14', sentAt: '2026-11-11', sentTo: 'zakaz@ptica.example, копия office@kitchen.example', file: 'https://drive.google.com/x' },
        { id: 'PO1794000000000', date: '2026-11-03', status: 'received', lines: 4, total: 21800, dueDate: '2026-11-05', sentAt: '', sentTo: '', file: '' }],
      batches: [{ id: 'MC-20261110-000004', product: 'Бедро куриное', qty: 15, unit: 'кг', received: '2026-11-10', expiry: '2026-11-15', control: 'QUARANTINE', reasons: 't° 9 °C при норме 0…4 °C' },
        { id: 'MC-20261105-000002', product: 'Филе куриное', qty: 20, unit: 'кг', received: '2026-11-05', expiry: '2026-11-11', control: 'RELEASED', reasons: '' }],
      documents: [{ id: 'D1', type: 'Декларация', number: 'ЕАЭС N RU Д-RU.РА01.В.12345', date: '2025-12-01', validTo: '2026-11-30', product: 'Мясо птицы', term: 'EXPIRING' }],
      contracts: [{ id: 'C1', number: '12/П-2026', kind: 'Поставка продуктов', start: '2026-01-10', end: '2026-12-31', auto: 'да', term: 'OK' }] };
    const D = { mcGetSuppliers: () => JSON.stringify({ success: true, data: S }), tsSupplierCard: () => JSON.stringify({ success: true, data: card }),
      mcSaveSupplier: j => { const d = JSON.parse(j); return JSON.stringify({ success: true, data: { id: d.id || 'SUP-NEW', status: 'ACTIVE', note: '' } }); },
      tsOrdersBuild: () => JSON.stringify({ success: true, data: { orders: [{ orderId: 'PO9', supplier: 'ООО «Птица»', lines: 1, email: 'zakaz@ptica.example' }] } }),
      tsOrderSend: () => JSON.stringify({ success: true, data: { to: 'zakaz@ptica.example' } }) };
    function mk(s) { s = s || {}; return new Proxy({}, { get(t, k) {
      if (k === 'withSuccessHandler') return f => mk(Object.assign({}, s, { ok: f })); if (k === 'withFailureHandler') return f => mk(Object.assign({}, s, { fl: f }));
      return (...a) => setTimeout(() => { window.__calls.push(k + ':' + JSON.stringify(a)); (s.ok || (() => {}))(D[k] ? D[k](...a) : '{}'); }, 5); } }); }
    window.google = { script: { run: mk() } };
  });
  await p.goto('file://' + path.join(__dirname, '..', 'app', 'Suppliers.html') + '?token=x'); await p.waitForTimeout(300);
  const calls = () => p.evaluate(() => window.__calls.join('\n')), text = () => p.textContent('#view');
  assert(/нет e-mail для заявок/.test(await text()), 'в списке видно, у кого нет e-mail');
  await p.fill('#q', 'молоч'); await p.waitForTimeout(100); assert(!/Птица/.test(await text()) && /Молочник/.test(await text()), 'поиск'); await p.fill('#q', '');
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'suppliers_list.png') });
  await p.click('.row:has-text("ООО «Птица»")'); await p.waitForTimeout(300);
  const t = (await text()).replace(/\s/g, ' ');
  ['Петрова Мария Ивановна', 'zakaz@ptica.example', 'пн, ср, пт до 10:00', 'PO1794412567084', 'PDF заявки', 'Бедро куриное', 'карантин', 't° 9 °C', 'истекает', '12/П-2026', '48 200'].forEach(x => assert(t.includes(x), 'в карточке: ' + x));
  assert(await p.$('a[href="tel:+74951112233"]') && await p.$('a[href="mailto:zakaz@ptica.example"]'), 'позвонить / написать');
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'supplier_card.png'), fullPage: true });
  // изменить
  await p.click('button:has-text("Изменить")'); await p.waitForTimeout(100);
  assert.strictEqual(await p.inputValue('#cp'), 'Петрова Мария Ивановна', 'форма заполнена из карточки');
  await p.fill('#cp', 'Иванов Пётр'); await p.click('button:has-text("Сохранить")'); await p.waitForTimeout(400);
  assert(/mcSaveSupplier:\["\{\\"id\\":\\"SUP-1\\".*Иванов Пётр/.test(await calls()), 'правка уходит на сервер с тем же ID');
  assert(/Изменения сохранены/.test(await p.textContent('#msg')) && /Заявки и заказы/.test(await text()), 'после сохранения — снова карточка');
  // новая заявка из карточки с письмом
  await p.click('button:has-text("+ Новая заявка")'); await p.fill('#no input[placeholder="Товар"]', 'Филе куриное'); await p.fill('#no input[placeholder="Кол-во"]', '8');
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'supplier_card_order.png') });
  await p.click('button:has-text("Создать и отправить письмо")'); await p.waitForTimeout(400);
  assert(/tsOrdersBuild:.*Филе куриное.*ООО «Птица»/.test(await calls()) && /tsOrderSend:\["x","PO9",""\]/.test(await calls()), 'заявка на этого поставщика и письмо');
  assert(/Заявка PO9 отправлена на zakaz@ptica.example/.test(await p.textContent('#msg')));
  // новый поставщик
  await p.click('button:has-text("Все поставщики")'); await p.click('button:has-text("+ Поставщик")');
  await p.fill('#n', 'ИП Овощев'); await p.fill('#em', 'ovoshi@example.com'); await p.fill('#cp', 'Овощев Иван'); await p.click('button:has-text("Сохранить")'); await p.waitForTimeout(400);
  assert(/mcSaveSupplier:\["\{\\"id\\":\\"\\",\\"name\\":\\"ИП Овощев\\"/.test(await calls()) && /Поставщик добавлен/.test(await p.textContent('#msg')));
  assert.strictEqual(errs.length, 0, 'ошибки страницы: ' + errs.join('; '));
  await b.close(); console.log('OK: карточка поставщика — список, просмотр, изменение, добавление, заявка из карточки');
})().catch(e => { console.error(e); process.exit(1); });
