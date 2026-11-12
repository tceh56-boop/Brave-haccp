// Сквозной сценарий этапа 12 в браузере: остаток и расход → норма запаса (вручную с основанием) → «Что заказать» →
// черновик заказа → правка позиции → «Отправлен» → «Принять поставку» → приёмка с подстановкой из заказа →
// заказ «принят» с расхождением; блокировка поставщика в настройке; раздел в меню.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage12.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const stamp = Date.now().toString(36);
const owner = { name: 'Пётр Закупщик', email: `buy12.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
await P.fill('#name', `Кафе «Закупки ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname, orgId = base.split('/').pop();
const [site] = await call('GET', `/orgs/${orgId}/sites`);

step('товар, поставщики, приёмка 10 кг по 500 ₽ и расход 2,8 кг');
const beef = await call('POST', `/orgs/${orgId}/products`, { name: 'Говядина вырезка', unit: 'кг' });
const farm = await call('POST', `/orgs/${orgId}/suppliers`, { name: 'ООО «Фермер»' });
await call('POST', `/orgs/${orgId}/suppliers`, { name: 'ООО «Сомнительный»' });
const rec = await call('POST', `/orgs/${orgId}/receipts`, { siteId: site.id, supplierId: farm.id });
const exp = new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10), ok = { packaging: true, labeling: true, documents: true, quality: true };
await call('POST', `/orgs/${orgId}/receipts/${rec.id}/lines`, { productId: beef.id, quantity: 10, unitPrice: 500, lotNo: 'Г-1', expiresAt: exp, expiryBasis: 'маркировка изготовителя', checks: ok, decision: 'accepted' });
await call('POST', `/orgs/${orgId}/receipts/${rec.id}/complete`, {});
await call('POST', `/orgs/${orgId}/stock/consume`, { siteId: site.id, productId: beef.id, quantity: 2.8, purpose: 'горячий цех', operationId: randomUUID() });

step('настройка: блокировка поставщика с причиной');
await P.goto(`${BASE}${base}/setup`);
const row = P.locator('li:has-text("ООО «Сомнительный»")');
await row.locator('button:has-text("изменить")').click();
await row.locator('input[id^="sbl-"]').fill('две поставки с нарушением температуры');
await row.locator('button:has-text("Сохранить")').click();
await P.waitForSelector('li:has-text("ООО «Сомнительный»") .badge.crit:has-text("заблокирован")');

step('закупки: позиция видна с расходом, без нормы ничего не предлагается');
await P.goto(`${BASE}${base}/purchasing`);
await P.waitForSelector('li:has-text("Говядина вырезка"):has-text("остаток 7,2 кг"):has-text("хватит 72 дн."):has-text("норма не задана")');
if (await P.locator('li:has-text("Говядина вырезка") .badge.warn').count()) throw new Error('без нормы предложен заказ');

step('нормы: ручная норма 20 кг с основанием');
await P.click('.tabs button:has-text("Нормы")');
await P.selectOption('#np', beef.id);
await P.click('.chips button:has-text("Вручную")');
await P.fill('#mq', '20'); await P.fill('#nb', 'поставка раз в неделю, запас на 7 дней');
await P.click('button:has-text("Сохранить норму")');
await P.waitForSelector('.objrow:has-text("Говядина вырезка"):has-text("20 кг")');
await shot(P, 'нормы');

step('что заказать: 12,8 кг → черновик заказа «Фермеру»');
await P.click('.tabs button:has-text("Что заказать")');
await P.waitForSelector('li:has-text("Говядина вырезка") .badge.warn:has-text("к заказу 12,8 кг")');
if (await P.inputValue('input[aria-label="В заказ: Говядина вырезка"]') !== '12,8') throw new Error('количество не подставлено');
await P.waitForFunction((id) => document.querySelector('#sup')?.value === id, farm.id, { timeout: 5000 }).catch(() => { throw new Error('поставщик последней приёмки не выбран'); });
if (!(await P.locator('#sup option:has-text("ООО «Сомнительный»")').isDisabled())) throw new Error('заблокированный поставщик доступен');
await shot(P, 'что_заказать');
await P.fill('input[aria-label="В заказ: Говядина вырезка"]', '12');
await P.click('button:has-text("Создать черновик заказа")');
await P.waitForURL(/\/purchasing\/[0-9a-f-]{36}$/);
await P.waitForSelector('h1:has-text("Заказ № 1")');
await P.waitForSelector('tr:has-text("Говядина вырезка"):has-text("12 кг")');
await P.waitForSelector('pre:has-text("Говядина вырезка — 12 кг × 500 ₽")');

step('отправлен → принять поставку → приёмка с подстановкой из заказа');
await P.click('button:has-text("Отправлен поставщику")');
await P.waitForSelector('.badge:text-is("Отправлен")');
await shot(P, 'заказ');
await P.click('button:has-text("Принять поставку")');
await P.waitForURL(/\/receipts\/[0-9a-f-]{36}$/);
await P.waitForSelector('h2:has-text("По заказу № 1")');
await P.click('.linkbtn:has-text("Говядина вырезка")');
if (await P.inputValue('#pr') !== beef.id || await P.inputValue('#q') !== '12' || await P.inputValue('#up') !== '500') throw new Error('позиция заказа не подставилась');
await P.fill('#q', '11,5'); await P.fill('#ln', 'Г-2'); await P.fill('#ex', exp);
for (const label of ['Упаковка цела', 'Маркировка есть и читается', 'Документы в порядке', 'Качество (вид, запах)']) await P.locator(`div:has(> div:text-is("${label}")) button.yes`).click();
await P.click('button:text-is("Принять")');
await P.waitForSelector('.badge.warn:has-text("11,5 / 12 кг")');
await shot(P, 'приёмка_по_заказу');
await P.click('button:has-text("Завершить приёмку")');
await P.waitForSelector('text=Приёмка завершена');

step('заказ «принят», расхождение −0,5 кг');
await P.click('a:text-is("заказ")');
await P.waitForURL(/\/purchasing\/[0-9a-f-]{36}$/);
await P.waitForSelector('.badge.ok:text-is("Принят")');
await P.waitForSelector('tr:has-text("Говядина вырезка") .badge.crit:has-text("-0,5")');
await shot(P, 'заказ_принят');

step('меню: раздел «Закупки»');
await P.click('.hamburger');
await P.click('.sidemenu.open .menu-item:has-text("Закупки")');
await P.click('.tabs button:has-text("Заказы")');
await P.waitForSelector('a.objrow:has-text("№ 1 · ООО «Фермер»") .badge:text-is("Принят")');

await browser.close(); await db.end();
if (errors.length) throw new Error(`ошибки страницы: ${errors.join('; ')}`);
console.log('OK: этап 12 (нормы, что заказать, заказ поставщику, приёмка по заказу) пройден в браузере');
