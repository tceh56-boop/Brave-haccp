// Сквозной сценарий этапа 1 в браузере (экран телефона): регистрация → подтверждение → предприятие →
// приглашение → принятие → блокировка → аудит. Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage1.e2e.mjs
// Ссылки из писем читаются из очереди outbox_emails (почтовый сервер на стенде не подключён).
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const DB = process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev';
const SHOTS = process.env.SHOTS_DIR || null;
const db = new pg.Client({ connectionString: DB }); await db.connect();
const stamp = Date.now().toString(36);
const owner = { name: 'Ольга Владелец', email: `owner.${stamp}@example.test`, pass: 'Кухня-2026-владелец' };
const cook = { name: 'Иван Повар', email: `cook.${stamp}@example.test`, pass: 'Кухня-2026-повар' };

async function link(email, template) {
  for (let i = 0; i < 20; i++) {
    const r = await db.query('select body from outbox_emails where to_email = $1 and template = $2 order by created_at desc limit 1', [email, template]);
    if (r.rows[0]) return /(\/\S+\?token=[\w-]+)/.exec(r.rows[0].body.replace(/^https?:\/\/[^/]+/m, ''))?.[1] || new URL(/https?:\/\/\S+/.exec(r.rows[0].body)[0]).pathname + new URL(/https?:\/\/\S+/.exec(r.rows[0].body)[0]).search;
    await new Promise((s) => setTimeout(s, 250));
  }
  throw new Error(`нет письма ${template} → ${email}`);
}
const step = (s) => console.log('•', s);
let n = 0;
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}_${name}.png`, fullPage: true }); };

const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', isMobile: true, hasTouch: true };
const errors = [];
async function newUserPage() { const ctx = await browser.newContext(phone); const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); return p; }

async function registerAndVerify(p, u) {
  await p.goto(`${BASE}/register`);
  await p.fill('#fullName', u.name); await p.fill('#email', u.email); await p.fill('#password', u.pass);
  await shot(p, 'регистрация');
  await p.click('button:has-text("Зарегистрироваться")');
  await p.waitForSelector('text=Проверьте почту');
  await p.goto(BASE + await link(u.email, 'verify_email'));
  await p.waitForSelector('text=Email подтверждён');
  await p.goto(`${BASE}/login`);
  await p.fill('#email', u.email); await p.fill('#password', u.pass);
  await p.click('button:has-text("Войти")');
  await p.waitForURL('**/app');
}

const P = await newUserPage();
step('владелец: регистрация и подтверждение email');
await registerAndVerify(P, owner);
await P.waitForSelector('text=Новое предприятие');
step('владелец: создание предприятия');
await P.fill('#name', `Кафе «Тест ${stamp}»`); await P.fill('#inn', '7701234567'); await P.fill('#region', 'Свердловская область');
await shot(P, 'новое_предприятие');
await P.click('button:has-text("Создать предприятие")');
await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const orgUrl = P.url();
await P.waitForSelector('text=Основная площадка');
await shot(P, 'площадки');
step('владелец: приглашение повара');
await P.click('role=tab[name="Приглашения"]');
await P.fill('#ie', cook.email); await P.fill('#in', cook.name); await P.selectOption('#ir', 'line_staff'); await P.fill('#ip', 'Повар горячего цеха');
await P.click('button:has-text("Отправить приглашение")');
await P.waitForSelector(`text=Приглашение отправлено на ${cook.email}`);
await shot(P, 'приглашение');

const C = await newUserPage();
step('повар: регистрация и принятие приглашения');
await registerAndVerify(C, cook);
await C.goto(BASE + await link(cook.email, 'invitation'));
await C.click('button:has-text("Принять приглашение")');
await C.waitForURL(/\/app\/[0-9a-f-]{36}$/);
await C.waitForSelector('text=Сотрудник цеха');
const cookTabs = await C.$$eval('[role=tab]', (t) => t.map((x) => x.textContent));
if (cookTabs.includes('Аудит') || cookTabs.includes('Приглашения')) throw new Error('у сотрудника цеха лишние вкладки: ' + cookTabs);
await shot(C, 'повар_вид');
const forbidden = await C.evaluate(async (u) => (await fetch(u.replace('/app/', '/api/v1/orgs/') + '/audit')).status, orgUrl);
if (forbidden !== 403) throw new Error('аудит доступен повару через API: ' + forbidden);

step('владелец: блокировка повара (увольнение)');
await P.click('role=tab[name="Сотрудники"]');
await P.waitForSelector(`text=${cook.name}`);
P.once('dialog', (d) => d.accept('увольнение'));
await P.locator('li', { hasText: cook.name }).locator('button:has-text("Заблокировать")').click();
await P.waitForSelector('text=Заблокирован: увольнение');
await shot(P, 'сотрудники');
const afterBlock = await C.evaluate(async (u) => (await fetch(u.replace('/app/', '/api/v1/orgs/'))).status, orgUrl);
if (afterBlock !== 404) throw new Error('заблокированный сотрудник видит предприятие: ' + afterBlock);

step('владелец: аудит и проверка целостности');
await P.click('role=tab[name="Аудит"]');
await P.waitForSelector('text=Сотрудник заблокирован');
await P.click('button:has-text("Проверить целостность")');
await P.waitForSelector('text=Цепочка цела');
await shot(P, 'аудит');

await browser.close(); await db.end();
if (errors.length) { console.error('ошибки страниц:', errors); process.exit(1); }
console.log('E2E этапа 1: пройдено');
