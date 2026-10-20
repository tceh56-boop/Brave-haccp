// Сквозной сценарий этапа 4 в браузере: стартовый перечень → свой источник → пункт → проверка специалистом →
// утверждение («Действует») → профиль предприятия → решение о применимости → правило контроля со ссылкой на требование.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage4.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const SHOTS = process.env.SHOTS_DIR || null;
const stamp = Date.now().toString(36);
const owner = { name: 'Ольга Владелец', email: `owner4.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', timezoneId: 'Europe/Moscow', isMobile: true, hasTouch: true });
const P = await ctx.newPage();
const errors = []; P.on('pageerror', (e) => errors.push(e.message));
P.on('dialog', (d) => d.accept(d.defaultValue() || 'подтверждено специалистом'));   // обоснование = предложение системы

step('владелец: регистрация и предприятие');
await P.goto(`${BASE}/register`);
await P.fill('#fullName', owner.name); await P.fill('#email', owner.email); await P.fill('#password', owner.pass);
await P.click('button:has-text("Зарегистрироваться")'); await P.waitForSelector('text=Проверьте почту');
await P.goto(BASE + await link(owner.email, 'verify_email')); await P.waitForSelector('text=Email подтверждён');
await P.goto(`${BASE}/login`); await P.fill('#email', owner.email); await P.fill('#password', owner.pass); await P.click('button:has-text("Войти")'); await P.waitForURL('**/app');
await P.fill('#name', `Кафе «Норма ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname;

step('реестр: стартовый перечень — всё «Требует проверки»');
await P.click('text=Нормативный реестр и профиль предприятия');
await P.click('button:has-text("Загрузить стартовый перечень")');
await P.waitForSelector('text=СанПиН 2.3/2.4.4282-26');
if (await P.locator('.badge:text("Действует")').count()) throw new Error('из стартового перечня ничего не должно действовать');
await shot(P, 'реестр');

step('свой источник: пункт → проверка → утверждение');
await P.click('button:has-text("Добавить источник")');
await P.fill('#sc', 'ПК-03'); await P.selectOption('#sk', 'Внутренний'); await P.fill('#st', 'Процедура контроля холодильного оборудования ПК-03');
await P.fill('#se', 'ред. 1'); await P.fill('#sf', day(-5));
await P.click('button:has-text("Создать")');
await P.click('a.objrow:has-text("ПК-03")');
await P.fill('#rc', 'п. 2'); await P.fill('#rs', 'холодильное хранение мяса и рыбы');
await P.fill('#rt', 'Температура в холодильных камерах для мяса и рыбы — от 0 до +4 °C, замер дважды в смену с записью.');
await P.click('button:has-text("Добавить пункт")'); await P.waitForSelector('li:has-text("п. 2")');
await P.fill('#ce', 'Сверено с утверждённым приказом директора № 12 от 01.10.2026 (оригинал в папке ХАССП)'); await P.fill('#cn', day(180));
await P.click('button:has-text("Проверен специалистом")');
await P.click('button:has-text("Утвердить для применения")');
await P.waitForSelector('.badge:text("Действует")');
await shot(P, 'источник_утверждён');

step('профиль: кафе + хранение → применимость');
await P.goto(BASE + base + '/regulatory');
await P.click('role=tab[name="Профиль предприятия"]');
await P.click('.chips button:text("Кафе")'); await P.click('.chips button:text("Хранение")');
await P.click('button:has-text("Сохранить профиль")'); await P.waitForSelector('text=Профиль сохранён');
await P.waitForSelector('text=Предложение системы');
await P.locator('li:has-text("ПК-03, п. 2")').locator('button:text-is("Применимо")').click();
await P.waitForSelector('text=Нет процедуры контроля');
await shot(P, 'профиль');

step('правило контроля со ссылкой на требование');
await P.goto(BASE + base + '/setup');
await P.fill('#on', 'Камера мясная'); await P.click('button:has-text("Добавить объект")');
await P.click('text=Камера мясная');
await P.selectOption('#rreq', { index: 1 });
await P.fill('#rmin', '0'); await P.fill('#rmax', '4'); await P.fill('#rfr', '6');
await P.click('button:has-text("Сохранить проект")'); await P.click('button:has-text("Утвердить")');
await P.waitForSelector('text=ПК-03, п. 2 (ред. ред. 1)');
await P.waitForSelector('dd b:text("от 0 до 4 °C")');   // карточка объекта обновилась после утверждения
await shot(P, 'правило_со_ссылкой');
await P.goto(BASE + base + '/regulatory');
await P.click('role=tab[name="Профиль предприятия"]');
await P.waitForSelector('text=Процедур контроля: 1');

await browser.close(); await db.end();
if (errors.length) { console.error('ошибки страниц:', errors); process.exit(1); }
console.log('E2E этапа 4: пройдено');
