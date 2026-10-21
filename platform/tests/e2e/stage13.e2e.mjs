// Сквозной сценарий этапа 13 в браузере: п/ф и блюдо с ТТК → мероприятие из меню → блюдо «на гостя» → потребность и
// нехватка → смена числа гостей → п/ф в производство и заказ на нехватку → лист для кухни → подтверждение →
// мероприятие сегодня: «Проведено» с фактическими порциями и списанием по ТТК.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage13.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const stamp = Date.now().toString(36);
const owner = { name: 'Анна Шеф', email: `ev13.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
await P.fill('#name', `Ресторан «Банкет ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname, orgId = base.split('/').pop();
const [site] = await call('GET', `/orgs/${orgId}/sites`);

const later = new Date(Date.now() + 2 * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });

step('сырьё, поставщик, п/ф «Бульон» и блюдо «Суп» с утверждёнными ТТК');
const beef = await call('POST', `/orgs/${orgId}/products`, { name: 'Говядина на кости', unit: 'кг' });
const onion = await call('POST', `/orgs/${orgId}/products`, { name: 'Лук репчатый', unit: 'кг' });
const farm = await call('POST', `/orgs/${orgId}/suppliers`, { name: 'ООО «Фермер»' });
const rec = await call('POST', `/orgs/${orgId}/receipts`, { siteId: site.id, supplierId: farm.id });
const exp = new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10), ok = { packaging: true, labeling: true, documents: true, quality: true };
await call('POST', `/orgs/${orgId}/receipts/${rec.id}/lines`, { productId: beef.id, quantity: 3, unitPrice: 700, lotNo: 'Г-2', expiresAt: exp, expiryBasis: 'маркировка изготовителя', checks: ok, decision: 'accepted' });
await call('POST', `/orgs/${orgId}/receipts/${rec.id}/lines`, { productId: onion.id, quantity: 3, unitPrice: 40, lotNo: 'Л-1', expiresAt: exp, expiryBasis: 'маркировка изготовителя', checks: ok, decision: 'accepted' });
await call('POST', `/orgs/${orgId}/receipts/${rec.id}/complete`, {});
async function ttk(name, kind, yieldG, lines, salePrice) {
  const d = await call('POST', `/orgs/${orgId}/dishes`, { name, kind, salePrice });
  const v = (await call('GET', `/orgs/${orgId}/dishes/${d.id}`)).current.version.id;
  await call('PATCH', `/orgs/${orgId}/ttk/${v}`, { yieldG, portionG: kind === 'dish' ? yieldG : undefined, technology: 'Приготовить по технологии предприятия.', storageConditions: 'при +2…+6 °C', shelfLife: '24 часа' });
  for (const l of lines) await call('POST', `/orgs/${orgId}/ttk/${v}/lines`, l);
  await call('POST', `/orgs/${orgId}/ttk/${v}/submit`, {}); await call('POST', `/orgs/${orgId}/ttk/${v}/approve`, {});
  return d;
}
const broth = await ttk('Бульон говяжий', 'semi', 1000, [{ productId: beef.id, unit: 'кг', brutto: 0.8, netto: 0.7 }, { productId: onion.id, unit: 'кг', brutto: 0.2, netto: 0.18 }]);
const stew = await ttk('Суп с луком', 'dish', 300, [{ subDishId: broth.id, unit: 'г', brutto: 250, netto: 250 }, { productId: onion.id, unit: 'г', brutto: 50, netto: 50 }], 300);

step('план-меню: новое мероприятие через меню');
await P.goto(`${BASE}${base}`);
await P.click('.hamburger');
await P.click('.sidemenu.open .menu-item:has-text("План-меню")');
await P.waitForSelector('h2:has-text("Новое мероприятие")');
await P.fill('#et', 'Юбилей'); await P.fill('#ed', later); await P.fill('#eh', '18:00'); await P.fill('#eg', '20'); await P.fill('#ef', 'банкет');
await P.click('button:has-text("Создать мероприятие")');
await P.waitForURL(/\/events\/[0-9a-f-]{36}$/);
await P.waitForSelector('h1:has-text("Юбилей")');

step('меню: суп на гостя → 20 порций; потребность и нехватка');
await P.selectOption('select[aria-label="Блюдо"]', stew.id);
await P.fill('#iq', '1'); await P.fill('#in', 'горячее');
await P.click('button:has-text("Добавить в меню")');
await P.waitForSelector('li:has-text("Суп с луком"):has-text("20 порц. (1 на гостя)")');
await P.waitForSelector('li:has-text("Говядина на кости") .badge.crit:has-text("не хватает 1 кг")');
await P.waitForSelector('li:has-text("Бульон говяжий"):has-text("нужно 5 кг")');

step('гостей 23 — порции и потребность пересчитаны');
await P.fill('input[aria-label="Гостей"]', '23');
await P.click('button:has-text("Изменить число гостей")');
await P.waitForSelector('li:has-text("Суп с луком"):has-text("23 порц.")');
await P.waitForSelector('li:has-text("Говядина на кости") .badge.crit:has-text("не хватает 1,6 кг")');
await shot(P, 'мероприятие');

step('п/ф в производство, заказ на нехватку');
await P.click('button:has-text("В производство 5,75 кг")');
await P.waitForSelector('a.objrow:has-text("Бульон говяжий · 5,75 кг")');
await P.waitForFunction((id) => document.querySelector('select[aria-label="Поставщик"]')?.value === id, farm.id, { timeout: 5000 });
await P.click('button:has-text("Черновик заказа на нехватку")');
await P.waitForURL(/\/purchasing\/[0-9a-f-]{36}$/);
await P.waitForSelector('tr:has-text("Говядина на кости"):has-text("1,6 кг")');
await P.waitForSelector('pre:has-text("под мероприятие № 1")');
await P.goBack();
await P.waitForSelector('li:has-text("Говядина на кости"):has-text("заказано 1,6") .badge.ok');

step('лист для кухни и подтверждение');
await P.click('a:has-text("Лист для кухни")');
await P.waitForSelector('.tu-doc td:has-text("Суп с луком")');
await shot(P, 'лист_кухни');
await P.goBack();
await P.click('button:has-text("Подтвердить мероприятие")');
await P.waitForSelector('.badge:text-is("Подтверждено")');

step('мероприятие сегодня: «Проведено» с фактическими порциями — списание по ТТК');
const ev2 = await call('POST', `/orgs/${orgId}/events`, { siteId: site.id, title: 'Обед для группы', eventDate: today, guests: 2 });
await call('POST', `/orgs/${orgId}/events/${ev2.id}/items`, { dishId: stew.id, portions: 2 });
await call('POST', `/orgs/${orgId}/events/${ev2.id}/confirm`, {});
await P.goto(`${BASE}${base}/events/${ev2.id}`);
await P.fill('input[aria-label="Факт: Суп с луком"]', '3');
await P.click('button:has-text("Проведено — списать по ТТК")');
await P.waitForSelector('text=Мероприятие проведено. Списаний: 2.');
await P.waitForSelector('.badge.ok:text-is("Проведено")');
await P.waitForSelector('.kv:has-text("Выручка"):has-text("900 ₽")');
await shot(P, 'проведено');
await P.goto(`${BASE}${base}/events`);
await P.click('.tabs button:has-text("Проведённые")');
await P.waitForSelector('a.objrow:has-text("Обед для группы") .badge:text-is("Проведено")');

await browser.close(); await db.end();
if (errors.length) throw new Error(`ошибки страницы: ${errors.join('; ')}`);
console.log('OK: этап 13 (план-меню: меню, потребность, заказ и п/ф под мероприятие, проведение со списанием) пройден в браузере');
