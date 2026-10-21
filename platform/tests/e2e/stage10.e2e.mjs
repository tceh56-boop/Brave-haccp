// Сквозной сценарий этапа 10 в браузере: п/ф с ТТК и сроком партии → параметр ККТ «температура в толще» →
// задание на производство → «Начать» → замер вне предела (выпуск закрыт, отклонение) → замер в пределах →
// выпуск партии п/ф с этикеткой → карточка партии и израсходованное сырьё.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage10.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const stamp = Date.now().toString(36);
const owner = { name: 'Анна Шеф', email: `chef10.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
await P.fill('#name', `Кафе «Заготовки ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname, orgId = base.split('/').pop();
const [site] = await call('GET', `/orgs/${orgId}/sites`);

step('сырьё на складе и п/ф «Бульон» с утверждённой ТТК (срок партии 48 ч)');
const beef = await call('POST', `/orgs/${orgId}/products`, { name: 'Говядина на кости', unit: 'кг' });
const onion = await call('POST', `/orgs/${orgId}/products`, { name: 'Лук репчатый', unit: 'кг' });
const rec = await call('POST', `/orgs/${orgId}/receipts`, { siteId: site.id, documentNo: `УПД-${stamp}` });
const exp = new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10), ok = { packaging: true, labeling: true, documents: true, quality: true };
await call('POST', `/orgs/${orgId}/receipts/${rec.id}/lines`, { productId: beef.id, quantity: 5, unitPrice: 600, lotNo: 'Г-10', expiresAt: exp, expiryBasis: 'маркировка изготовителя', checks: ok, decision: 'accepted' });
await call('POST', `/orgs/${orgId}/receipts/${rec.id}/lines`, { productId: onion.id, quantity: 2, unitPrice: 40, lotNo: 'Л-10', expiresAt: exp, expiryBasis: 'маркировка изготовителя', checks: ok, decision: 'accepted' });
await call('POST', `/orgs/${orgId}/receipts/${rec.id}/complete`, {});
const dish = await call('POST', `/orgs/${orgId}/dishes`, { name: 'Бульон говяжий', kind: 'semi' });
const v = (await call('GET', `/orgs/${orgId}/dishes/${dish.id}`)).current.version.id;
await call('PATCH', `/orgs/${orgId}/ttk/${v}`, { yieldG: 1000, technology: 'Варить 3 часа на слабом огне, процедить.', storageConditions: 'при +2…+6 °C', shelfLife: '48 часов', shelfLifeHours: 48 });
await call('POST', `/orgs/${orgId}/ttk/${v}/lines`, { productId: beef.id, unit: 'кг', brutto: 0.8, netto: 0.7 });
await call('POST', `/orgs/${orgId}/ttk/${v}/lines`, { productId: onion.id, unit: 'кг', brutto: 0.2, netto: 0.18 });
await call('POST', `/orgs/${orgId}/ttk/${v}/submit`, {}); await call('POST', `/orgs/${orgId}/ttk/${v}/approve`, {});

step('карточка п/ф: параметр ККТ и «Поставить в производство»');
await P.goto(`${BASE}${base}/menu/${dish.id}`);
await P.waitForSelector('text=Срок партии');
await P.fill('#rcmin', '75'); await P.fill('#rcb', 'План ХАССП: ККТ-1, тепловая обработка');
await P.click('button:has-text("Добавить параметр")');
await P.waitForSelector('li:has-text("Температура в толще продукта"):has-text("не ниже 75 °C")');
await shot(P, 'пф_ккт');
await P.click('a:has-text("Поставить в производство")');
await P.waitForURL(/\/production\?dish=/);
if (await P.inputValue('#ps') !== dish.id) throw new Error('п/ф не выбран в задании');
await P.fill('#pk', '2'); await P.fill('#pn', 'к обеду');
await P.click('button:has-text("Создать задание")');
await P.waitForSelector('a.objrow:has-text("Бульон говяжий")');
await shot(P, 'производство');

step('задание: потребность, «Начать», замер вне предела — выпуск закрыт');
await P.click('a.objrow:has-text("Бульон говяжий")');
await P.waitForSelector('h2:has-text("Потребность по ТТК")');
await P.waitForSelector('tr:has-text("Говядина на кости"):has-text("1,6 кг")');
await P.click('button:text-is("Начать")');
await P.waitForSelector('.badge:text("В работе")');
await P.fill('input[aria-label="Замер: Температура в толще продукта"]', '68');
await P.click('button:text-is("Записать")');
await P.waitForSelector('a:text("отклонение")');
await P.waitForSelector('text=Выпуск закрыт');
if (await P.locator('button:has-text("Выпустить партию")').isEnabled()) throw new Error('выпуск должен быть закрыт');

step('замер в пределах и выпуск партии п/ф с этикеткой');
await P.fill('input[aria-label="Замер: Температура в толще продукта"]', '82');
await P.click('button:text-is("Записать")');
await P.waitForSelector('.badge.ok:text("82 °C")');
await P.fill('#ak', '1,9');
await shot(P, 'задание');
await P.click('button:has-text("Выпустить партию")');
await P.waitForURL(/\/labels\/print\?ids=/);
await P.waitForSelector('.lb:has-text("Бульон говяжий")');
await P.goBack();
await P.waitForSelector('h2:has-text("Выпущено")');
await P.waitForSelector('li:has-text("Говядина на кости"):has-text("Г-10")');
await shot(P, 'выпущено');
await P.click('dd a:has-text("ПФ-")');
await P.waitForURL(/\/lots\/[0-9a-f-]{36}$/);
await P.waitForSelector('dd:has-text("ТТК «Бульон говяжий» v1: 48 ч")');
await P.waitForSelector('h2:has-text("Маркировка")');                       // карточка партии загружена

step('меню: раздел «Производство»');
await P.click('.hamburger');
await shot(P, 'меню');
await P.click('.sidemenu.open .menu-item:has-text("Производство")');
await P.waitForSelector('h2:has-text("Выпущено · 1")');

await browser.close(); await db.end();
if (errors.length) throw new Error(`ошибки страницы: ${errors.join('; ')}`);
console.log('OK: этап 10 (производство п/ф, ККТ при выпуске, партия и этикетка) пройден в браузере');
