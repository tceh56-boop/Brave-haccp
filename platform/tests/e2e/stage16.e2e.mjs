// Сквозной сценарий этапа 16 в браузере: режим допуска «блокировать» → повар без ЛМК не вносит замер → ЛМК внесена →
// замер принят → осмотр перед сменой «не допущен» → замер закрыт → тема и инструктаж → повар подтверждает у себя → J07, J17.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage16.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const stamp = Date.now().toString(36);
const owner = { name: 'Ирина Директор', email: `st16.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
await P.fill('#name', `Кафе «Персонал ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname, orgId = base.split('/').pop();
const [site] = await call('GET', `/orgs/${orgId}/sites`);

const mskDay = (n) => new Date(Date.now() + n * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
async function member(role, name) {
  const u = { email: `${role}.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
  await call('POST', `/orgs/${orgId}/invitations`, { email: u.email, role, fullName: name });
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(`${BASE}/register`);
  await p2.fill('#fullName', name); await p2.fill('#email', u.email); await p2.fill('#password', u.pass);
  await p2.click('button:has-text("Зарегистрироваться")'); await p2.waitForSelector('text=Проверьте почту');
  await p2.goto(BASE + await link(u.email, 'verify_email')); await p2.waitForSelector('text=Email подтверждён');
  await p2.goto(`${BASE}/login`); await p2.fill('#email', u.email); await p2.fill('#password', u.pass);
  await p2.click('button:has-text("Войти")'); await p2.waitForURL('**/app');
  await p2.goto(BASE + await link(u.email, 'invitation'));
  await p2.click('button:has-text("Принять приглашение")');
  await p2.waitForURL(/\/app\/[0-9a-f-]{36}$/);
  return { ...u, page: p2 };
}

step('повар приглашён и вошёл');
const cook = await member('line_staff', 'Сергей Повар');
const obj = await call('POST', `/orgs/${orgId}/objects`, { siteId: site.id, name: 'Холодильник №1', kind: 'fridge' });

step('режим допуска «Блокировать» — повар без ЛМК не вносит замер');
await P.goto(`${BASE}${base}/staff`);
await P.click('.chips button:has-text("Блокировать")');
await P.waitForSelector('.chips button[aria-pressed="true"]:has-text("Блокировать")');
await cook.page.goto(`${BASE}${base}/objects/${obj.id}`);
await cook.page.fill('#v', '4');
await cook.page.click('button:has-text("Сохранить замер")');
await cook.page.waitForSelector('.err:has-text("Нет медицинского допуска")');

step('ЛМК внесена — замер принят');
await P.click('a.objrow:has-text("Сергей Повар")');
await P.click('button:has-text("Внести по ЛМК")');
await P.fill('#mb', 'ЛМК 77-123'); await P.fill('#m1', mskDay(-30)); await P.fill('#m2', mskDay(335)); await P.fill('#m4', mskDay(700));
await P.click('button:text-is("Сохранить")');
await P.waitForSelector('.badge.ok:has-text("ЛМК: допущен")');
await cook.page.click('button:has-text("Сохранить замер")');
await cook.page.waitForSelector('text=Последний');

step('осмотр перед сменой: не допущен — замер снова закрыт');
await P.goto(`${BASE}${base}/staff`);
await P.click('li:has-text("Сергей Повар") button:has-text("Есть признаки")');
await P.fill('input[aria-label="Признаки"]', 'насморк, температура 37,5');
await P.fill('input[aria-label="Меры"]', 'отстранён, направлен к врачу');
await P.click('button:has-text("Не допущен")');
await P.waitForSelector('a.objrow:has-text("Сергей Повар") .badge.crit:has-text("не допущен")');
await cook.page.fill('#v', '4');
await cook.page.click('button:has-text("Сохранить замер")');
await cook.page.waitForSelector('.err:has-text("не допущены")');

step('тема инструктажа и проведение');
await P.fill('#tt', 'Охрана труда повара'); await P.fill('#tm', 'ИОТ-01, ред. 2026'); await P.fill('#tp', '6');
await P.click('.chips button:text-is("Сотрудник цеха")');
await P.click('button:has-text("Добавить тему")');
await P.waitForSelector('li:has-text("Охрана труда повара")');
await P.selectOption('#bt', { label: 'Охрана труда: Охрана труда повара' });
await P.selectOption('#bk', 'primary');
await P.click('.chips button:text-is("Сергей Повар")');
await P.click('button:has-text("Записать инструктаж")');
await P.waitForSelector('.okbox:has-text("Записано: 1")');
await shot(P, 'персонал');

step('повар подтверждает ознакомление у себя');
await cook.page.goto(`${BASE}${base}/staff/me`);
await cook.page.waitForSelector('h1:has-text("Мой допуск и инструктажи")');
await cook.page.click('button:has-text("Подтверждаю")');
await cook.page.waitForSelector('text=ознакомлен(а)');
await cook.page.waitForSelector('li:has-text("Охрана труда повара") .badge.ok:has-text("пройден")');
await shot(cook.page, 'мой_допуск');

step('журналы J07 и J17');
const j07 = await call('GET', `/orgs/${orgId}/journals/J07?siteId=${site.id}&from=${mskDay(-1)}&to=${mskDay(1)}`);
const j17 = await call('GET', `/orgs/${orgId}/journals/J17?siteId=${site.id}&from=${mskDay(-1)}&to=${mskDay(1)}`);
if (j07.rows.length !== 1 || !j07.rows[0][5].startsWith('не допущен')) throw new Error('J07: ' + JSON.stringify(j07.rows));
if (j17.rows.length !== 1 || !j17.rows[0][6].startsWith('подтверждено')) throw new Error('J17: ' + JSON.stringify(j17.rows));

await browser.close(); await db.end();
if (errors.length) throw new Error(`ошибки страницы: ${errors.join('; ')}`);
console.log('OK: этап 16 (допуск, осмотр перед сменой, инструктажи, подтверждение сотрудником) пройден в браузере');
