// Сквозной сценарий этапа 14 в браузере: мероприятие без пробы не закрывается → отбор суточной пробы (масса и температура
// проверяются) → мероприятие проведено → параметры проб утверждены с основанием → программа лабораторного контроля →
// результат «не соответствует» по показателям → карточка результата и отклонение.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage14.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const stamp = Date.now().toString(36);
const owner = { name: 'Игорь ХАССП', email: `lab14.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
await P.fill('#name', `Кафе «Пробы ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname, orgId = base.split('/').pop();
const [site] = await call('GET', `/orgs/${orgId}/sites`);

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });

step('блюдо с ТТК, подтверждённое мероприятие сегодня, холодильник для проб');
const potato = await call('POST', `/orgs/${orgId}/products`, { name: 'Картофель', unit: 'кг' });
const farm = await call('POST', `/orgs/${orgId}/suppliers`, { name: 'ООО «Овощи»' });
const rec = await call('POST', `/orgs/${orgId}/receipts`, { siteId: site.id, supplierId: farm.id });
const exp = new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10), ok = { packaging: true, labeling: true, documents: true, quality: true };
await call('POST', `/orgs/${orgId}/receipts/${rec.id}/lines`, { productId: potato.id, quantity: 10, unitPrice: 30, lotNo: 'К-1', expiresAt: exp, expiryBasis: 'маркировка изготовителя', checks: ok, decision: 'accepted' });
await call('POST', `/orgs/${orgId}/receipts/${rec.id}/complete`, {});
const soup = await call('POST', `/orgs/${orgId}/dishes`, { name: 'Суп картофельный', kind: 'dish', salePrice: 200 });
const v = (await call('GET', `/orgs/${orgId}/dishes/${soup.id}`)).current.version.id;
await call('PATCH', `/orgs/${orgId}/ttk/${v}`, { yieldG: 250, portionG: 250, technology: 'Приготовить по технологии предприятия.', storageConditions: 'при +2…+6 °C', shelfLife: '2 часа' });
await call('POST', `/orgs/${orgId}/ttk/${v}/lines`, { productId: potato.id, unit: 'кг', brutto: 0.1, netto: 0.1 });
await call('POST', `/orgs/${orgId}/ttk/${v}/submit`, {}); await call('POST', `/orgs/${orgId}/ttk/${v}/approve`, {});
const ev = await call('POST', `/orgs/${orgId}/events`, { siteId: site.id, title: 'Обед группы', eventDate: today, guests: 10 });
await call('POST', `/orgs/${orgId}/events/${ev.id}/items`, { dishId: soup.id, perGuest: 1 });
await call('POST', `/orgs/${orgId}/events/${ev.id}/confirm`, {});
await call('POST', `/orgs/${orgId}/objects`, { siteId: site.id, name: 'Холодильник для проб', kind: 'fridge' });

step('мероприятие: без пробы «Проведено» не проходит, ссылка на отбор');
await P.goto(`${BASE}${base}/events/${ev.id}`);
await P.waitForSelector('li:has-text("Суп картофельный") .badge.warn:has-text("нет суточной пробы")');
await P.click('button:has-text("Проведено — списать по ТТК")');
await P.waitForSelector('.err:has-text("Нет суточной пробы: Суп картофельный")');
await P.click('a:has-text("Отобрать суточные пробы")');
await P.waitForURL(/\/lab\?event=/);

step('суточная проба: параметры не утверждены; масса и температура проверяются');
await P.waitForSelector('.badge.warn:has-text("не утверждено")');
await P.waitForSelector('h2:has-text("Нужно отобрать · 1")');
await P.waitForFunction(() => document.querySelector('select[aria-label="Блюдо мероприятия"]')?.value.includes(':'));
await P.selectOption('#so', { label: 'Холодильник для проб' });
await P.fill('#sw', '80'); await P.fill('#st', '4');
await P.click('button:text-is("Отобрать пробу")');
await P.waitForSelector('.err:has-text("не менее 100 г")');
await P.fill('#sw', '150'); await P.fill('#st', '9');
await P.click('button:text-is("Отобрать пробу")');
await P.waitForSelector('.err:has-text("переложите пробу")');
await P.fill('#st', '4');
await P.click('button:text-is("Отобрать пробу")');
await P.waitForSelector('.okbox:has-text("Проба отобрана: Суп картофельный")');
await P.waitForSelector('li:has-text("Суп картофельный — мероприятие № 1") .badge:text-is("хранится")');
await shot(P, 'пробы');

step('мероприятие проводится');
await P.goto(`${BASE}${base}/events/${ev.id}`);
await P.waitForSelector('li:has-text("Суп картофельный") .badge.ok:has-text("проба отобрана")');
await P.click('button:has-text("Проведено — списать по ТТК")');
await P.waitForSelector('.badge.ok:text-is("Проведено")');

step('параметры проб утверждает ХАССП с основанием');
await P.goto(`${BASE}${base}/lab`);
await P.click('button:has-text("Изменить / утвердить")');
await P.fill('#cb', 'СанПиН 2.3/2.4.3590-20; программа ПК, п. 5');
await P.click('button:text-is("Утвердить")');
await P.waitForSelector('text=Основание: СанПиН 2.3/2.4.3590-20; программа ПК, п. 5');

step('лаборатория: исследование в программе, результат «не соответствует» → отклонение');
await P.click('.tabs button:has-text("Лаборатория")');
await P.fill('#pt', 'Смывы на БГКП'); await P.fill('#po', 'Разделочные доски'); await P.fill('#pp', '30'); await P.fill('#pb', 'Программа ПК, п. 6');
await P.click('button:has-text("Добавить в программу")');
await P.waitForSelector('.objrow:has-text("Смывы на БГКП")');
await P.selectOption('#rp', { label: 'Смывы на БГКП — Разделочные доски' });
await P.fill('#rl', 'ИЛЦ «Центр гигиены»'); await P.fill('#rn', '140/26');
await P.click('button:has-text("+ Показатель")');
await P.fill('input[aria-label="Показатель 1"]', 'БГКП'); await P.fill('input[aria-label="Норма 1"]', 'не допускаются'); await P.fill('input[aria-label="Факт 1"]', 'обнаружены');
await P.click('button.no:has-text("Вне нормы")');
await P.waitForSelector('text=Итог по показателям: не соответствует');
await P.fill('#rc', 'Не соответствует по БГКП');
await P.click('button:has-text("Сохранить результат")');
await P.waitForSelector('.okbox:has-text("создано отклонение и задача на повторный отбор")');
await shot(P, 'лаборатория');
await P.click('a.objrow:has-text("Смывы на БГКП")');
await P.waitForURL(/\/lab\/results\/[0-9a-f-]{36}$/);
await P.waitForSelector('td:has-text("обнаружены")');
await P.waitForSelector('h2:has-text("Скан протокола")');
await P.click('a:has-text("Отклонение по несоответствию")');
await P.waitForURL(/\/incidents\/[0-9a-f-]{36}$/);
await P.waitForSelector('text=Не соответствует: Смывы на БГКП');

await browser.close(); await db.end();
if (errors.length) throw new Error(`ошибки страницы: ${errors.join('; ')}`);
console.log('OK: этап 14 (суточные пробы, лабораторный контроль, связь с мероприятием и отклонениями) пройден в браузере');
