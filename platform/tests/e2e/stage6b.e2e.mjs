// Сквозной сценарий этапа 6 (часть 2) в браузере: смена кассы → заказ (цена с сервера) → оплата со сдачей →
// списание по ТТК → возврат позиции → закрытие смены со сверкой → очередь продаж, импорт внешней кассы и
// сопоставление → стоп-лист → экономика.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage6b.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const SHOTS = process.env.SHOTS_DIR || null;
const stamp = Date.now().toString(36);
const owner = { name: 'Ольга Владелец', email: `owner6b.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
async function call(path, body, method) {
  const r = method === 'PATCH' ? await P.request.patch(`${BASE}/api/v1${path}`, { data: body, headers: { origin: BASE } })
    : body === undefined ? await P.request.get(`${BASE}/api/v1${path}`) : await P.request.post(`${BASE}/api/v1${path}`, { data: body, headers: { origin: BASE } });
  const j = await r.json(); if (!j.ok) throw new Error(`${path}: ${j.error.message}`); return j.data;
}
const inDays = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);

step('владелец: регистрация и предприятие');
await P.goto(`${BASE}/register`);
await P.fill('#fullName', owner.name); await P.fill('#email', owner.email); await P.fill('#password', owner.pass);
await P.click('button:has-text("Зарегистрироваться")'); await P.waitForSelector('text=Проверьте почту');
await P.goto(BASE + await link(owner.email, 'verify_email')); await P.waitForSelector('text=Email подтверждён');
await P.goto(`${BASE}/login`); await P.fill('#email', owner.email); await P.fill('#password', owner.pass); await P.click('button:has-text("Войти")'); await P.waitForURL('**/app');
await P.fill('#name', `Кафе «Касса ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname;
const orgId = base.split('/').pop();
const [site] = await call(`/orgs/${orgId}/sites`);

step('подготовка: сырьё с ценой, блюдо с утверждённой ТТК, блюдо без ТТК');
const beef = await call(`/orgs/${orgId}/products`, { name: 'Говядина', unit: 'кг' });
const sup = await call(`/orgs/${orgId}/suppliers`, { name: 'ООО «Поставщик»' });
const rec = await call(`/orgs/${orgId}/receipts`, { siteId: site.id, supplierId: sup.id });
await call(`/orgs/${orgId}/receipts/${rec.id}/lines`, { productId: beef.id, quantity: 3, unitPrice: 800, lotNo: 'B-1', expiresAt: inDays(5), expiryBasis: 'маркировка', checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
await call(`/orgs/${orgId}/receipts/${rec.id}/complete`, {});
const dish = await call(`/orgs/${orgId}/dishes`, { name: 'Бефстроганов', salePrice: 450 });
const v = (await call(`/orgs/${orgId}/dishes/${dish.id}`)).current.version.id;
await call(`/orgs/${orgId}/ttk/${v}`, { yieldG: 150, portionG: 150, technology: 'Нарезать, обжарить, тушить в соусе 10 минут.', storageConditions: '+2…+6 °C', shelfLife: '2 часа' }, 'PATCH');
await call(`/orgs/${orgId}/ttk/${v}/lines`, { productId: beef.id, unit: 'кг', brutto: 0.15, netto: 0.12 });
await call(`/orgs/${orgId}/ttk/${v}/submit`, {}); await call(`/orgs/${orgId}/ttk/${v}/approve`, {});
await call(`/orgs/${orgId}/dishes`, { name: 'Морс', salePrice: 150 });

step('касса: смена, заказ, оплата со сдачей');
await P.click('text=Касса: смена, заказы, оплата');
await P.fill('#cs', '1000'); await P.click('button:has-text("Открыть смену")');
await P.waitForSelector('text=Смена открыта');
await P.fill('input[aria-label="Стол"]', '3'); await P.click('button:has-text("Новый заказ")');
await P.waitForURL(/\/pos\/[0-9a-f-]{36}$/);
await P.click('button.tile:has-text("Бефстроганов")'); await P.waitForSelector('b:text("450 ₽")');
await P.click('button.tile:has-text("Бефстроганов")'); await P.waitForSelector('b:text("900 ₽")');
await P.click('button.tile:has-text("Морс")'); await P.waitForSelector('text=Оплатить 1050 ₽');
await P.fill('#p-cash', '1100');
await P.waitForSelector('text=Сдача 50 ₽');
await shot(P, 'заказ_оплата');
await P.click('button:has-text("Оплатить 1050 ₽")');
await P.waitForSelector('text=Сдача: 50 ₽');
await P.waitForSelector('text=Часть позиций не списана по ТТК');
const left = Number((await db.query('select sum(quantity) as q from lots where product_id = $1', [beef.id])).rows[0].q);
if (Math.abs(left - 2.7) > 1e-9) throw new Error(`списание по ТТК: осталось ${left}, ожидалось 2,7`);

step('возврат позиции');
await P.locator('label:has-text("Морс") input[type=checkbox]').check();
await P.fill('#rr', 'гость отказался');
await P.click('button:has-text("Вернуть 150 ₽")');
await P.waitForSelector('text=Возврат 150 ₽ проведён');

step('закрытие смены со сверкой');
await P.goto(`${BASE}${base}/pos`);
await P.waitForSelector('text=ожидается в кассе 1900 ₽');
await P.click('button:has-text("Закрыть смену")');
await P.fill('#cf', '1900'); await P.click('form:has(#cf) button:has-text("Закрыть смену")');
await P.waitForSelector('text=Расхождение наличных: 0 ₽');

step('продажи: очередь, импорт внешней кассы, сопоставление');
await P.goto(`${BASE}${base}/sales`);
await P.waitForSelector('li:has-text("Морс") .badge:text("Нет утверждённой ТТК")');
await P.fill('#csv', `ID;дата;наименование;количество;цена\ne-${stamp}-1;21.10.2026 13:05;Бефстроганов порц.;1;450`);
await P.click('button:has-text("Загрузить")');
await P.waitForSelector('text=Загружено 1');
await P.selectOption('select[aria-label="Блюдо для Бефстроганов порц."]', { label: 'Бефстроганов' });
await P.click('.objrow:has-text("Бефстроганов порц.") button:has-text("OK")');
await P.waitForSelector('text=сопоставлено продаж 1, списано 1');
await P.fill('#csv', `e-${stamp}-1;21.10.2026 13:05;Бефстроганов порц.;1;450`);
await P.click('button:has-text("Загрузить")');
await P.waitForSelector('text=Загружено 0, повторов пропущено 1');
await shot(P, 'продажи');

step('стоп-лист и экономика');
await P.goto(`${BASE}${base}/stop-list`);
await P.selectOption('#sd', { label: 'Бефстроганов' }); await P.fill('#sr', 'сломалась плита');
await P.click('button:has-text("В стоп")');
await P.waitForSelector('text=сломалась плита');
await P.goto(`${BASE}${base}/economics`);
await P.waitForSelector('.tile:has-text("1350 ₽")');
await P.waitForSelector('text=Маржа неполная');
await shot(P, 'экономика');

step('экономика: расход, P&L, ABC/XYZ');
await P.click('.chips button:has-text("Расходы")');
await P.waitForSelector('h2:has-text("Новый расход")');
await P.fill('#xa', '30000'); await P.fill('#xt', 'Аренда помещения'); await P.fill('#xb', 'договор аренды (тест)');
await P.click('button:has-text("Добавить расход")');
await P.waitForSelector('li:has-text("Аренда помещения")');
await P.click('.chips button:has-text("P&L")');
await P.waitForSelector('h2:has-text("P&L")');
await P.waitForSelector('dt:has-text("Аренда")');
await P.waitForSelector('text=Данные неполные');
await shot(P, 'pnl');
await P.click('.chips button:has-text("ABC / XYZ")');
await P.waitForSelector('h2:has-text("ABC / XYZ блюд")');
await shot(P, 'abc');

if (errors.length) throw new Error('ошибки страницы: ' + errors.join('; '));
console.log('OK: этап 6 (касса, продажи, стоп-лист, экономика) пройден в браузере');
await browser.close(); await db.end();
