// Сквозной сценарий этапа 6 (часть 1) в браузере: товары с ценой закупки → блюдо → ТТК (выход, технология, состав) →
// согласование и утверждение → цена продажи → себестоимость и фудкост → импорт карт из архива → сопоставление сырья.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage6.e2e.mjs (архив ТТК загружен: npm run import:ttk)
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const SHOTS = process.env.SHOTS_DIR || null;
const stamp = Date.now().toString(36);
const owner = { name: 'Ольга Владелец', email: `owner6.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
const step = (s) => console.log('•', s);
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
P.on('dialog', (d) => d.accept());
async function call(path, body) {
  const r = body === undefined ? await P.request.get(`${BASE}/api/v1${path}`) : await P.request.post(`${BASE}/api/v1${path}`, { data: body, headers: { origin: BASE } });
  const j = await r.json(); if (!j.ok) throw new Error(`${path}: ${j.error.message}`); return j.data;
}
const inDays = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);

step('владелец: регистрация и предприятие');
await P.goto(`${BASE}/register`);
await P.fill('#fullName', owner.name); await P.fill('#email', owner.email); await P.fill('#password', owner.pass);
await P.click('button:has-text("Зарегистрироваться")'); await P.waitForSelector('text=Проверьте почту');
await P.goto(BASE + await link(owner.email, 'verify_email')); await P.waitForSelector('text=Email подтверждён');
await P.goto(`${BASE}/login`); await P.fill('#email', owner.email); await P.fill('#password', owner.pass); await P.click('button:has-text("Войти")'); await P.waitForURL('**/app');
await P.fill('#name', `Кафе «Меню ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname;
const orgId = base.split('/').pop();
const [site] = await call(`/orgs/${orgId}/sites`);

step('товары и приёмка с ценой');
const beef = await call(`/orgs/${orgId}/products`, { name: 'Говядина вырезка', unit: 'кг' });
const onion = await call(`/orgs/${orgId}/products`, { name: 'Лук репчатый', unit: 'кг' });
const sup = await call(`/orgs/${orgId}/suppliers`, { name: 'ООО «Поставщик»' });
const rec = await call(`/orgs/${orgId}/receipts`, { siteId: site.id, supplierId: sup.id });
await P.goto(`${BASE}${base}/receipts/${rec.id}`);
await P.waitForSelector('#up');   // поле «Цена за единицу» в форме приёмки; строки ниже — через API
await call(`/orgs/${orgId}/receipts/${rec.id}/lines`, { productId: onion.id, quantity: 5, unitPrice: 40, lotNo: 'O-1', expiresAt: inDays(10), expiryBasis: 'маркировка', checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
await call(`/orgs/${orgId}/receipts/${rec.id}/lines`, { productId: beef.id, quantity: 10, unitPrice: 800, lotNo: 'B-1', expiresAt: inDays(5), expiryBasis: 'маркировка', checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
await call(`/orgs/${orgId}/receipts/${rec.id}/complete`, {});

step('блюдо и ТТК: выход, технология, состав');
await P.goto(`${BASE}${base}`);
await P.click('.hamburger'); await P.click('.menu-item:has-text("Блюда и ТТК")');
await P.click('button:has-text("Новое блюдо или полуфабрикат")');
await P.fill('#dn', 'Бефстроганов');   // папка необязательна
await P.click('button:has-text("Создать")');
await P.waitForURL(/\/menu\/[0-9a-f-]{36}$/);
await P.fill('#yg', '150'); await P.fill('#pg', '150');
await P.fill('#tc', 'Говядину нарезать брусочками, обжарить, добавить лук, тушить в соусе 10 минут.');
await P.fill('#sc', 'при +2…+6 °C'); await P.fill('#sl', '2 часа на раздаче при +65 °C');
await P.click('form:has(#tc) button:has-text("Сохранить")');
await P.waitForSelector('dd:has-text("Нет состава")').catch(() => {});
for (const [id, unit, b, nn] of [[beef.id, 'кг', '0,15', '0,12'], [onion.id, 'г', '30', '25']]) {
  await P.selectOption('#al-pick', `p:${id}`); await P.selectOption('#al-u', unit); await P.fill('#al-b', b); await P.fill('#al-n', nn);
  await P.click('form:has(#al-pick) button:has-text("Добавить")');
  await P.waitForSelector(`td:has-text("${id === beef.id ? 'Говядина' : 'Лук'}")`);
}
await P.waitForSelector('text=Всё заполнено — можно отправлять на согласование.');
await P.click('button:has-text("Отправить на согласование")');
await P.click('button:has-text("Утвердить версию 1")');
await P.waitForSelector('.badge.ok:text("Утверждена")');

step('цена продажи и фудкост');
await P.fill('#sp', '450'); await P.click('form:has(#sp) button:has-text("Сохранить")');
await P.waitForSelector('dd:has-text("121,2 ₽")');
await P.waitForSelector('dd:has-text("26,9 %")');
await shot(P, 'блюдо_утверждено');

step('архив: поиск, импорт черновиками');
await P.goto(`${BASE}${base}/menu/archive`);
await P.fill('input[aria-label="Поиск карты"]', 'Холодец');
await P.waitForSelector('b:text("Холодец домашний 70/10/10г банкет")');
for (const c of await P.locator('input[type=checkbox]').all()) await c.check();
await P.click('button:has-text("Импортировать выбранные")');
await P.waitForSelector('text=Импортировано блюд: 2');
await shot(P, 'архив_импорт');

step('сопоставление сырья: один раз на название');
await P.goto(`${BASE}${base}/menu/match`);
await P.waitForSelector('b:text("Хрен сливочный")');
const before = await P.locator('.card b').count();
await P.locator('.card:has(b:text("Хрен сливочный")) button:has-text("Создать")').click();
await P.waitForFunction((n) => document.querySelectorAll('.card b').length === n - 1, before);
await shot(P, 'сопоставление');

if (errors.length) throw new Error('ошибки страницы: ' + errors.join('; '));
console.log('OK: этап 6 (блюда, ТТК, себестоимость, архив) пройден в браузере');
await browser.close(); await db.end();
