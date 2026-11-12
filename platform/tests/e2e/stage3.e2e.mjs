// Сквозной сценарий этапа 3 в браузере (экран телефона): товар из справочника MON CHEF → приёмка двух партий →
// остатки → расход по FEFO → перемещение на другую площадку → списание → прослеживаемость → инвентаризация.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage3.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const SHOTS = process.env.SHOTS_DIR || null;
const stamp = Date.now().toString(36);
const owner = { name: 'Ольга Владелец', email: `owner3.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
const api = (path, body, method) => P.evaluate(async ([path, body, method]) => {
  const r = await fetch(`/api/v1${path}`, { method: method || (body ? 'POST' : 'GET'), headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!j.ok) throw new Error(j.error.message); return j.data;
}, [path, body, method]);
const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);

step('владелец: регистрация, предприятие, вторая площадка');
await P.goto(`${BASE}/register`);
await P.fill('#fullName', owner.name); await P.fill('#email', owner.email); await P.fill('#password', owner.pass);
await P.click('button:has-text("Зарегистрироваться")'); await P.waitForSelector('text=Проверьте почту');
await P.goto(BASE + await link(owner.email, 'verify_email')); await P.waitForSelector('text=Email подтверждён');
await P.goto(`${BASE}/login`); await P.fill('#email', owner.email); await P.fill('#password', owner.pass); await P.click('button:has-text("Войти")'); await P.waitForURL('**/app');
await P.fill('#name', `Кухня «Склад ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname; const orgId = base.split('/').pop();
await P.fill('#sn', 'Кафе на набережной'); await P.click('button:has-text("Добавить площадку")'); await P.waitForSelector('text=Кафе на набережной');

step('настройка: товар из справочника MON CHEF и поставщик');
await P.goto(BASE + base + '/setup');
await P.fill('input[aria-label="Поиск в справочнике"]', 'Говядина');
await P.waitForSelector('li:has-text("PROD-")');
await shot(P, 'справочник');
await P.locator('li:has-text("PROD-")').first().locator('button:has-text("Добавить")').click();
await P.waitForSelector('text=добавлен');
await P.fill('input[aria-label="Поставщик"]', 'ООО «Фермер»'); await P.click('form:has(input[aria-label="Поставщик"]) button'); await P.waitForSelector('li:has-text("Фермер")');

step('приёмка двух партий (через API той же сессии)');
const products = await api(`/orgs/${orgId}/products`);
const beef = products[0];
const suppliers = await api(`/orgs/${orgId}/suppliers`);
const sites = await api(`/orgs/${orgId}/sites`);
const main = sites.find((s) => s.name === 'Основная площадка');
const rec = await api(`/orgs/${orgId}/receipts`, { siteId: main.id, supplierId: suppliers[0].id, documentNo: 'УПД-2077' });
const ok = { packaging: true, labeling: true, documents: true, quality: true };
await api(`/orgs/${orgId}/receipts/${rec.id}/lines`, { productId: beef.id, quantity: 4, lotNo: 'L-late', expiresAt: day(6), expiryBasis: 'маркировка изготовителя', checks: ok, decision: 'accepted' });
await api(`/orgs/${orgId}/receipts/${rec.id}/lines`, { productId: beef.id, quantity: 2, lotNo: 'L-early', expiresAt: day(2), expiryBasis: 'маркировка изготовителя', checks: ok, decision: 'accepted' });
await api(`/orgs/${orgId}/receipts/${rec.id}/complete`, {});

step('склад: остатки и расход по FEFO');
await P.goto(BASE + base + '/stock');
await P.selectOption('select[aria-label="Площадка"]', { label: 'Основная площадка' });  // выбор запоминается на устройстве
await P.waitForSelector(`text=${beef.name}`);
await P.waitForSelector('text=можно расходовать: 6 кг');
await shot(P, 'склад');
await P.click('a.tile:has-text("Расход")');
await P.selectOption('#p', beef.id); await P.fill('#q', '3'); await P.fill('#pu', 'заготовка на обед');
await P.click('button:has-text("Списать в расход")');
await P.waitForSelector('text=партия L-early — 2 кг');
await P.waitForSelector('text=партия L-late — 1 кг');
await shot(P, 'расход_fefo');

step('партия: перемещение и списание');
await P.goto(BASE + base + '/lots');
await P.click('a.objrow:has-text("L-late")');
await P.selectOption('#ts', { label: 'Кафе на набережной' }); await P.fill('#tq', '1');
await P.click('button:has-text("Переместить")');
await P.waitForSelector('li:has-text("Перемещено")');
await P.selectOption('#wr', 'spoiled'); await P.fill('#wq', '0,5'); await P.fill('#wc', 'потемнение на срезе');
await P.click('button:has-text("Списать")');
await P.waitForSelector('li:has-text("Списание")');
await shot(P, 'партия_движения');

step('прослеживаемость');
await P.click('a:has-text("Прослеживаемость")');
await P.waitForSelector('text=ООО «Фермер»');
await P.waitForSelector('text=дочерняя партия');
await shot(P, 'прослеживаемость');

step('инвентаризация');
await P.goto(BASE + base + '/stock/count');
await P.click('button:has-text("Начать инвентаризацию")');
await P.waitForSelector('text=по учёту');
const facts = P.locator('input[aria-label^="Факт"]');
for (let i = 0; i < await facts.count(); i++) {
  const li = P.locator('li').filter({ has: facts.nth(i) });
  const expected = (await li.textContent()).match(/по учёту: ([\d,]+)/)[1];
  await facts.nth(i).fill(i === 0 ? '0' : expected);
  await li.locator('button').click();
  await P.waitForTimeout(400);
}
await P.waitForSelector('text=расхождение');
await shot(P, 'инвентаризация');
await P.click('button:has-text("Закрыть и провести расхождения")');
await P.waitForSelector('text=Инвентаризация закрыта');

await browser.close(); await db.end();
if (errors.length) { console.error('ошибки страниц:', errors); process.exit(1); }
console.log('E2E этапа 3: пройдено');
