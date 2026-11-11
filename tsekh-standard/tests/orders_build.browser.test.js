// Экран «Заказы поставщикам → По поставщикам»: предложение, сборка заявок, просмотр и отправка письма.
// Запуск: node tests/orders_build.browser.test.js [папка для снимков]
const { chromium } = require('playwright'), path = require('path'), assert = require('assert');
const SHOTS = process.argv[2] || '';
(async () => {
  const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    window.__calls = [];
    const sup = [{ id: 'SUP-1', name: 'ООО «Птица»', email: 'zakaz@ptica.example', contactPerson: 'Петрова Мария Ивановна', status: 'ACTIVE' }, { id: 'SUP-2', name: 'Молочник', email: '', status: 'ACTIVE' }];
    const letter = '<h2>Заявка № PO1 от 11.11.2026</h2><p>Здравствуйте, Петрова Мария Ивановна!</p><table><tr><td>1</td><td>Филе куриное</td><td>8</td><td>кг</td></tr></table>';
    const D = {
      getSupplierOrders: () => JSON.stringify([]), mcGetSuppliers: () => JSON.stringify({ success: true, data: sup }),
      tsOrderDraft: () => JSON.stringify({ success: true, data: { lines: [{ name: 'Филе куриное', unit: 'кг', qty: 8, stock: 2, min: 10, supplier: 'ООО «Птица»', source: 'ниже минимума' }, { name: 'Сливки 33%', unit: 'л', qty: 5, stock: 0, min: 5, supplier: 'Молочник', source: 'ниже минимума' }], suppliers: sup } }),
      tsOrdersBuild: () => JSON.stringify({ success: true, data: { orders: [{ orderId: 'PO1', supplier: 'ООО «Птица»', lines: 1, email: 'zakaz@ptica.example', contactPerson: 'Петрова Мария Ивановна' }, { orderId: 'PO2', supplier: 'Молочник', lines: 1, email: '' }] } }),
      tsOrderLetter: () => JSON.stringify({ success: true, data: { to: 'zakaz@ptica.example', cc: 'office@kitchen.example', subject: 'Заявка № PO1 от 11.11.2026 — Кухня', html: letter, missing: [], status: 'draft' } }),
      tsOrderSend: () => JSON.stringify({ success: true, data: { to: 'zakaz@ptica.example', cc: 'office@kitchen.example' } }),
      tsOrdersSendMany: () => JSON.stringify({ success: true, data: { results: [{ orderId: 'PO1', ok: true, to: 'zakaz@ptica.example' }] } }) };
    function mk(s) { s = s || {}; return new Proxy({}, { get(t, k) {
      if (k === 'withSuccessHandler') return f => mk(Object.assign({}, s, { ok: f })); if (k === 'withFailureHandler') return f => mk(Object.assign({}, s, { fl: f }));
      return (...a) => setTimeout(() => { window.__calls.push(k + ':' + JSON.stringify(a)); (s.ok || (() => {}))(D[k] ? D[k](...a) : '[]'); }, 5); } }); }
    window.google = { script: { run: mk() } }; window.confirm = () => true;
  });
  await p.goto('file://' + path.join(__dirname, '..', 'app', 'Orders.html') + '?token=x'); await p.waitForTimeout(300);
  const calls = () => p.evaluate(() => window.__calls.join('\n'));
  await p.click('#tabs button:has-text("По поставщикам")'); await p.waitForTimeout(300);
  assert(/Будет заявок: 2/.test(await p.textContent('#body')), 'группировка по поставщикам видна до создания');
  assert(/Нет e-mail для заявок: Молочник/.test(await p.textContent('#body')), 'предупреждение о поставщике без e-mail');
  await p.fill('#bDue', '2026-11-14');
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'orders_build.png'), fullPage: true });
  await p.click('button:has-text("Сформировать заявки")'); await p.waitForTimeout(300);
  assert(/tsOrdersBuild:\["x","\[\{\\"name\\":\\"Филе куриное\\"/.test(await calls()) && /"2026-11-14"/.test(await calls()), 'строки и срок уходят на сервер');
  assert(/Созданы заявки/.test(await p.textContent('#body')));
  await p.click('button:has-text("Письмо")'); await p.waitForTimeout(300);
  assert(/Здравствуйте, Петрова Мария Ивановна!/.test(await p.textContent('#ov')) && /копия и ответ: office@kitchen.example/.test(await p.textContent('#ov')));
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'orders_letter.png') });
  await p.fill('#lNote', 'до 10:00'); await p.click('#ov button:has-text("Отправить")'); await p.waitForTimeout(300);
  assert(/tsOrderSend:\["x","PO1","до 10:00"\]/.test(await calls()), 'отправка с дополнением'); assert(!(await p.$('#ov')), 'окно закрыто');
  assert(/Письмо отправлено на zakaz@ptica.example/.test(await p.textContent('#msg')));
  assert.strictEqual(errs.length, 0, 'ошибки страницы: ' + errs.join('; '));
  await b.close(); console.log('OK: заявки по поставщикам — сборка, просмотр письма, отправка');
})().catch(e => { console.error(e); process.exit(1); });
