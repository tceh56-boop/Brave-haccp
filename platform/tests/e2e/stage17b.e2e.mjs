// Сквозной сценарий распознавания накладной в приёмке (этап 17, часть 2). Облако подменено локальной заглушкой:
// сервер стенда запускается с YANDEX_API_KEY=e2e-mock, YANDEX_FOLDER_ID=b1ge2emock000,
// YANDEX_OCR_URL=http://127.0.0.1:3999/ocr/v1/recognizeText, YANDEX_LLM_URL=http://127.0.0.1:3999/llm.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage17b.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';
import http from 'node:http';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const stamp = Date.now().toString(36);
const owner = { name: 'Пётр Кладовщик', email: `rc17b.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
const step = (s) => console.log('•', s);
const SHOTS = process.env.SHOTS_DIR || null;
let k = 0;
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${String(++k).padStart(2, '0')}_${name}.png`, fullPage: true }); };
async function link(email, template) {
  for (let i = 0; i < 20; i++) {
    const r = await db.query('select body from outbox_emails where to_email = $1 and template = $2 order by created_at desc limit 1', [email, template]);
    if (r.rows[0]) { const u = new URL(/https?:\/\/\S+/.exec(r.rows[0].body)[0]); return u.pathname + u.search; }
    await new Promise((s) => setTimeout(s, 250));
  }
  throw new Error(`нет письма ${template}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', timezoneId: 'Europe/Moscow', isMobile: true, hasTouch: true });
const P = await ctx.newPage();
const errors = []; P.on('pageerror', (e) => errors.push(e.message));
const call = async (method, path, data) => {
  const res = await P.request.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE } });
  const r = await res.json().catch(async () => { throw new Error(`${method} ${path}: ${res.status()} ${(await res.text()).slice(0, 200)}`); });
  if (!r.ok) throw new Error(`${path}: ${r.error?.message}`);
  return r.data;
};

step('владелец: регистрация и предприятие');
await P.goto(`${BASE}/register`);
await P.fill('#fullName', owner.name); await P.fill('#email', owner.email); await P.fill('#password', owner.pass);
await P.click('button:has-text("Зарегистрироваться")'); await P.waitForSelector('text=Проверьте почту');
await P.goto(BASE + await link(owner.email, 'verify_email')); await P.waitForSelector('text=Email подтверждён');
await P.goto(`${BASE}/login`); await P.fill('#email', owner.email); await P.fill('#password', owner.pass); await P.click('button:has-text("Войти")'); await P.waitForURL('**/app');
await P.fill('#name', `Кафе «Накладные ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname, orgId = base.split('/').pop();
const [site] = await call('GET', `/orgs/${orgId}/sites`);


step('заглушка Vision и YandexGPT (сервер стенда запущен с YANDEX_OCR_URL/YANDEX_LLM_URL на неё)');
const LINES = [
  'Универсальный передаточный документ Счёт-фактура № TEST-0001 от 15 октября 2026 г.',
  'Продавец: ООО "Поставщик-Тест" ИНН/КПП продавца 0000000000/000000000',
  '1 Форель филе с/м трим А 1,2-1,6 (С) кг 16,120 1 385,25 22 330,16 без акциза 22% 4 912,64 27 242,80',
  '2 Тунец филе с/м Лоин 2-6кг кг 3,064 770,00 2 359,28 без акциза 10% 235,93 2 595,21',
  '3 Майонез "Царский" премиум 67% 10 л. шт 1,000 1 137,70 1 137,70 без акциза 22% 250,30 1 388,00',
  'Всего к оплате 25 827,14 X 5 398,87 31 226,01',
];
function annotation(lines) {   // лист снят боком: текст читается снизу вверх
  const UW = 2000, UH = 60 * lines.length + 100, at = (x, y) => ({ x: String(y), y: String(UW - x) });
  return { width: String(UH), height: String(UW), fullText: lines.join('\n'), blocks: lines.map((text, i) => {
    let x = 40; const y = 50 + i * 60;
    return { lines: [{ words: text.split(' ').map((t) => { const w = t.length * 16, v = [at(x, y), at(x + w, y), at(x + w, y + 30), at(x, y + 30)]; x += w + 14; return { text: t, boundingBox: { vertices: v } }; }) }] };
  }) };
}
const EXTRACTION = { document_type: 'upd', document_number: 'TEST-0001', document_date: '2026-10-15', supplier: 'ООО "Поставщик-Тест"', total: 31226.01, recognition_confidence: 0.93, warnings: [], items: [
  { line_number: 1, raw_name: 'Форель филе с/м трим А 1,2-1,6 (С)', quantity: 16.12, unit: 'кг', price: 1385.25, sum: 22330.16, vat: 4912.64, confidence: 0.95 },
  { line_number: 2, raw_name: 'Тунец филе с/м Лоин 2-6кг', quantity: 3.064, unit: 'кг', price: 770, sum: 2359.28, vat: 235.93, confidence: 0.94 },
  { line_number: 3, raw_name: 'Майонез "Царский" премиум 67% 10 л.', quantity: 1, unit: 'шт', price: 1137.7, sum: 1137.7, vat: 250.3, confidence: 0.9 }] };
let llm = 0, ocr = 0;
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('/ocr/')) { ocr++; return res.end(JSON.stringify({ result: { textAnnotation: annotation(LINES) } })); }
    llm++;
    const text = llm % 2 === 1 ? JSON.stringify(EXTRACTION) : JSON.stringify({ ok: true, line_corrections: [], warnings: [] });
    res.end(JSON.stringify({ result: { alternatives: [{ message: { text } }], usage: { totalTokens: '1000' } } }));
  });
});
await new Promise((r) => mock.listen(3999, '127.0.0.1', r));

step('предприятие: распознавание включено, товары, поставщик, приёмка');
await call('POST', `/orgs/${orgId}/recognition`, { enabled: true, kinds: ['upd', 'torg12'], monthlyPages: 20 });
const trout = await call('POST', `/orgs/${orgId}/products`, { name: 'Форель филе с/м трим А', unit: 'кг' });
await call('POST', `/orgs/${orgId}/products`, { name: 'Тунец филе с/м', unit: 'кг' });
const mayo = await call('POST', `/orgs/${orgId}/products`, { name: 'Майонез провансаль ведро', unit: 'шт' });
const sup = await call('POST', `/orgs/${orgId}/suppliers`, { name: 'ООО «Поставщик-Тест»' });
const rec = await call('POST', `/orgs/${orgId}/receipts`, { siteId: site.id, supplierId: sup.id });

step('приёмка: два фото УПД → черновик строк');
await P.goto(`${BASE}${base}/receipts/${rec.id}`);
await P.waitForSelector('h2:has-text("Распознать документ")');
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
await P.setInputFiles('input[aria-label="Файлы документа"]', [{ name: 'лист1.jpg', mimeType: 'image/jpeg', buffer: jpg }, { name: 'лист2.jpg', mimeType: 'image/jpeg', buffer: jpg }]);
await P.click('button:has-text("Распознать (2 файл.)")');
await P.waitForSelector('.kv:has-text("УПД № TEST-0001 от 15.10.2026")');
await P.waitForSelector('text=фото повёрнуто');
await P.waitForSelector('li:has-text("1. Форель филе") .badge.ok');
await P.waitForSelector('li:has-text("3. Майонез") .badge.warn:has-text("проверить")');
if (await P.inputValue('select[aria-label^="Товар: Форель"]') !== trout.id) throw new Error('форель не сопоставлена');
if (await P.inputValue('select[aria-label^="Товар: Майонез"]') !== '') throw new Error('майонез подставлен без человека');
if (ocr !== 2) throw new Error(`страниц OCR: ${ocr}`);
await shot(P, 'распознано');

step('строка → форма приёмки; выбор человека запоминается');
await P.click('li:has-text("1. Форель") button:has-text("В форму")');
await P.waitForFunction((id) => document.querySelector('#pr')?.value === id, trout.id);
if (await P.inputValue('#q') !== '16,12' || await P.inputValue('#up') !== '1385,25') throw new Error('количество или цена не подставились');
await P.selectOption('select[aria-label^="Товар: Майонез"]', mayo.id);
await P.click('li:has-text("3. Майонез") button:has-text("В форму")');
await P.waitForFunction((id) => document.querySelector('#pr')?.value === id, mayo.id);

step('повторное распознавание: майонез сопоставлен по запомненному выбору, документ отмечен как дубль');
await P.click('button:has-text("Распознать (2 файл.)")');
await P.waitForSelector('text=Этот документ уже распознавали');
await P.waitForFunction((id) => document.querySelector('select[aria-label^="Товар: Майонез"]')?.value === id, mayo.id);
const u = (await call('GET', `/orgs/${orgId}/recognition`)).usage.find((x) => x.kind === 'upd');
if (!u || u.pages !== 4 || u.calls !== 2) throw new Error('учёт страниц: ' + JSON.stringify(u));
await shot(P, 'дубль');

mock.close();
await browser.close(); await db.end();
if (errors.length) throw new Error(`ошибки страницы: ${errors.join('; ')}`);
console.log('OK: этап 17, часть 2 (распознавание УПД в приёмке на движке MON CHEF, заглушка облака) пройдена в браузере');
