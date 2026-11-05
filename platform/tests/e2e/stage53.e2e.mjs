// Сквозной сценарий этапов 1–3 доработки под кухню и ХАССП на мобильном размере (на свежей демо-организации):
// шеф отмечает осмотр повара на экране смены → повар входит и сразу попадает на смену → замер холодильника с карточки →
// задание п/ф: замер ККТ щупом → выпуск → выпуск блюда без бракеража → шеф по задаче проводит бракераж. Повар в «Журналы» не заходит.
// Запуск: BASE_URL=http://localhost:3100 DATABASE_URL=… node tests/e2e/stage53.e2e.mjs (после npm run demo:seed на пустой базе)
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const PASS = 'Демо-ЦЕХ-2026';
const step = (s) => console.log('•', s);
const SHOTS = process.env.SHOTS_DIR || null;
let k = 0;
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${String(++k).padStart(2, '0')}_${name}.png`, fullPage: true }); };
const T = { timeout: 120000 };

const browser = await chromium.launch();
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', timezoneId: 'Europe/Moscow', isMobile: true, hasTouch: true };
async function login(email) {
  const ctx = await browser.newContext(mobile);
  const p = await ctx.newPage();
  p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
  p.visited = []; p.on('framenavigated', (f) => { if (f === p.mainFrame()) p.visited.push(f.url()); });
  await p.goto(`${BASE}/login`, { timeout: 600000 }); await p.fill('#email', email); await p.fill('#password', PASS); await p.click('button:has-text("Войти")');
  await p.waitForURL(/\/shift$/, { timeout: 600000 });   // сотрудник цеха и шеф попадают сразу на экран смены
  await p.waitForSelector('h2:text-is("Что сделать")', { timeout: 600000 });
  return p;
}
const org = (await db.query(`select o.id from organizations o join memberships m on m.organization_id = o.id join users u on u.id = m.user_id where u.email = 'povar@demo.test'`)).rows[0].id;
const cook = (await db.query(`select id from users where email = 'povar@demo.test'`)).rows[0].id;

step('шеф: экран смены, осмотр повара «Допущен»');
const chef = await login('shef@demo.test');
const hc = chef.locator(`li:has-text("Осмотр перед сменой: Сергей Повар") button:has-text("Допущен")`);
if (await hc.count()) { await hc.click(); await chef.waitForSelector('text=Готово.', T); }
await shot(chef, 'chef_shift');

step('владелец (API): новый холодильник с утверждённым правилом — замеров ещё нет, карточка «просрочено»');
const own = await browser.newContext();
const ownApi = async (path, data) => {
  const r = await (await own.request.fetch(`${BASE}/api/v1${path}`, { method: 'POST', data, headers: { origin: BASE } })).json();
  if (!r.ok) throw new Error(`${path}: ${r.error?.message}`);
  return r.data;
};
await ownApi('/auth/login', { email: 'vladelec@demo.test', password: PASS });
const site0 = (await db.query(`select id from sites where organization_id = $1 limit 1`, [org])).rows[0].id;
const obj = await ownApi(`/orgs/${org}/objects`, { siteId: site0, name: 'Холодильник заготовок (e2e)', kind: 'fridge' });
const rule = await ownApi(`/orgs/${org}/objects/${obj.id}/rules`, { minValue: 2, maxValue: 6, frequencyHours: 4, sourceRef: 'Демо: ППК, раздел 4' });
await ownApi(`/orgs/${org}/rules/${rule.id}/approve`, {});

step('повар: вход сразу на смену, замер холодильника с карточки');
const p = await login('povar@demo.test');
await shot(p, 'cook_shift');
const measure = p.locator('li:has(input[aria-label="Температура: Холодильник заготовок (e2e)"])');
await measure.locator('input').fill('4');
await measure.locator('button:has-text("Записать")').click();
await p.waitForSelector('text=Готово.', T);

step('повар: задание «Соус сливочный» с карточки → замер ККТ щупом → выпуск');
await p.locator('li:has-text("Задание: Соус сливочный") a:has-text("Открыть")').first().click();
await p.waitForURL(/\/production\//, T);
await p.click('button:text-is("Начать")'); await p.waitForSelector('#probe', T);
await p.fill('input[aria-label^="Замер:"]', '84'); await p.click('button:text-is("Записать")');
await p.waitForSelector('text=В пределах', T);
await shot(p, 'cook_ccp');
await p.click('button:has-text("Выпустить партию и напечатать этикетку")');
await p.waitForURL(/\/labels\/print/, T);

step('блюдо «Бефстроганов»: шеф ставит задание, повар выпускает без бракеража');
const site = (await db.query(`select id from sites where organization_id = $1 limit 1`, [org])).rows[0].id;
const res = await chef.request.fetch(`${BASE}/api/v1/orgs/${org}/production`, { method: 'POST', headers: { origin: BASE },
  data: { siteId: site, dishId: (await db.query(`select id from dishes where organization_id = $1 and name = 'Бефстроганов'`, [org])).rows[0].id, plannedKg: 0.45,
    plannedFor: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }) } });
const order = (await res.json()).data.id;
await p.goto(`${BASE}/app/${org}/shift`); await p.waitForSelector('text=Задание: Бефстроганов', T);
await p.locator('li:has-text("Задание: Бефстроганов") a:has-text("Открыть")').first().click();
await p.waitForURL(/\/production\//, T);
await p.click('button:text-is("Начать")'); await p.waitForSelector('text=после выпуска партия будет ждать', T);
await p.click('button:has-text("Выпустить партию")'); await p.waitForSelector('text=Ждёт бракеража', T);
await shot(p, 'cook_dish_pending');

step('шеф: задача «Бракераж» на экране смены → «Соответствует» → разрешено к реализации');
await chef.goto(`${BASE}/app/${org}/shift`); await chef.waitForSelector('text=Бракераж: Бефстроганов', T);
await chef.locator('li:has-text("Бракераж: Бефстроганов") a').first().click();
await chef.waitForURL(new RegExp(`/production/${order}`), T);
await chef.click('button:text-is("Соответствует")'); await chef.click('button:has-text("Разрешить к реализации")');
await chef.waitForSelector('text=соответствует — допущено', T);
await shot(chef, 'chef_brakerage');

const journals = p.visited.filter((u) => /\/journals/.test(u));
if (journals.length) throw new Error(`повар заходил в «Журналы»: ${journals.join(', ')}`);
const j = (await db.query(`select count(*)::int as n from production_checks c join production_orders o on o.id = c.order_id where o.organization_id = $1 and c.recorded_by = $2`, [org, cook])).rows[0].n;
if (j < 2) throw new Error('замеры ККТ повара не найдены');
const errs = [...p.errors, ...chef.errors];
if (errs.length) throw new Error(`ошибки страницы: ${errs.join('; ')}`);
console.log('OK: смена → замер → ККТ → выпуск → бракераж, без раздела «Журналы»');
await browser.close(); await db.end();
