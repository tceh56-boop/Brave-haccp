// Сквозной сценарий этапа 8 в браузере: заголовки безопасности и проверка состояния → готовность к пилоту
// (не готово) → подтверждение ответственного → «Не запускаем» → памятки по ролям → выгрузка «Мои данные».
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage8.e2e.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const SHOTS = process.env.SHOTS_DIR || null;
const stamp = Date.now().toString(36);
const owner = { name: 'Ольга Владелец', email: `owner8.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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

step('заголовки безопасности и проверка состояния');
const page = await fetch(`${BASE}/login`);
for (const [h, v] of [['x-frame-options', 'DENY'], ['x-content-type-options', 'nosniff'], ['referrer-policy', 'same-origin']]) {
  if (page.headers.get(h) !== v) throw new Error(`заголовок ${h}: ${page.headers.get(h)}`);
}
if (page.headers.get('x-powered-by')) throw new Error('сервер раскрывает x-powered-by');
const health = await (await fetch(`${BASE}/api/v1/health`)).json();
if (health.status !== 'ok' || health.migrations < 10) throw new Error(`health: ${JSON.stringify(health)}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', timezoneId: 'Europe/Moscow', isMobile: true, hasTouch: true, acceptDownloads: true });
const P = await ctx.newPage();
const errors = []; P.on('pageerror', (e) => errors.push(e.message));

step('владелец: регистрация и предприятие');
await P.goto(`${BASE}/register`);
await P.fill('#fullName', owner.name); await P.fill('#email', owner.email); await P.fill('#password', owner.pass);
await P.click('button:has-text("Зарегистрироваться")'); await P.waitForSelector('text=Проверьте почту');
await P.goto(BASE + await link(owner.email, 'verify_email')); await P.waitForSelector('text=Email подтверждён');
await P.goto(`${BASE}/login`); await P.fill('#email', owner.email); await P.fill('#password', owner.pass); await P.click('button:has-text("Войти")'); await P.waitForURL('**/app');
await P.fill('#name', `Кафе «Пилот ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname;

step('готовность: новая организация не готова, «Запускаем» недоступно');
await P.click('.hamburger'); await P.click('.menu-item:has-text("Готовность к пилоту")');
await P.waitForSelector('text=Запуск невозможен');
await P.waitForSelector('li:has-text("План ХАССП утверждён") .badge:text("Не готово")');
await P.waitForSelector('li:has-text("Изоляция организаций") .badge:text("Готово")');
if (await P.locator('button:text-is("Запускаем")').isEnabled()) throw new Error('«Запускаем» должно быть недоступно');

step('подтверждение ответственного и решение «Не запускаем»');
const row = P.locator('li:has-text("Сотрудники пилота прошли инструктаж")');
await row.locator('button:has-text("Подтвердить")').click();
await row.locator('input').fill('Инструктаж 21.10.2026 провела О. Владелец, лист ознакомления в папке ХАССП');
await row.locator('button:has-text("Сохранить")').click();
await P.waitForSelector('li:has-text("Сотрудники пилота прошли инструктаж") .badge:text("Готово")');
await P.fill('#dn', 'Не запускаем: нет плана ХАССП, объектов контроля и второго ответственного');
await P.click('button:text-is("Не запускаем")');
await P.waitForSelector('.badge:text("Не запускаем")');
await shot(P, 'готовность');

step('памятки по ролям и «Мои данные»');
await P.goto(`${BASE}${base}/guide`);
await P.waitForSelector('summary:has-text("Руководитель / владелец")');
await P.goto(`${BASE}${base}`);
const [dl] = await Promise.all([P.waitForEvent('download'), P.click('a:has-text("Мои данные")')]);
const data = JSON.parse(readFileSync(await dl.path(), 'utf8'));
if (data.user.email !== owner.email || JSON.stringify(data).includes('password_hash')) throw new Error('выгрузка «Мои данные» неверна');

if (errors.length) throw new Error('ошибки страницы: ' + errors.join('; '));
console.log('OK: этап 8 (готовность, Go/No-Go, памятки, мои данные, заголовки) пройден в браузере');
await browser.close(); await db.end();
