// Сквозной сценарий этапа 18 в браузере: нормы обработки моркови (очистка, варка; данные условные) → утверждение →
// строка ТТК: выход 100 г → шаги «очистка → варка» → брутто и нетто посчитаны по нормам → обработка по умолчанию в новой строке.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage18.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const stamp = Date.now().toString(36);
const owner = { name: 'Ирина Директор', email: `st18.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
await P.fill('#name', `Кафе «Обработка ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname, orgId = base.split('/').pop();
const [site] = await call('GET', `/orgs/${orgId}/sites`);


step('товар и нормы обработки (по основанию, утверждает человек)');
const carrot = await call('POST', `/orgs/${orgId}/products`, { name: 'Морковь свежая', unit: 'кг' });
await P.goto(`${BASE}${base}/menu/processing`);
await P.waitForSelector('h1:has-text("Обработка сырья")');
await P.selectOption('#pp', carrot.id);
await P.waitForSelector('text=Для этого товара норм пока нет');
await P.waitForSelector('text=В ваших картах архива ТТК');
await P.selectOption('#nm', 'clean'); await P.fill('#nl', '20'); await P.fill('#nb', 'Тест: акт контрольной проработки № 1');
await P.click('button:has-text("Внести норму")');
await P.waitForSelector('li:has-text("Очистка: отход 20 %") .badge.warn:has-text("черновик")');
await P.selectOption('#nm', 'boil'); await P.fill('#nl', '3'); await P.fill('#lp', '10'); await P.fill('#lf', '0'); await P.fill('#lc', '10');
await P.click('button:has-text("Внести норму")');
await P.waitForSelector('li:has-text("Варка: потери 3 %")');
for (const name of ['Очистка', 'Варка']) { await P.click(`li:has-text("${name}:") button:has-text("Утвердить")`); await P.waitForSelector(`li:has-text("${name}:") .badge.ok`); }
await shot(P, 'нормы_моркови');

step('строка ТТК: выход 100 г → очистка → варка');
const dish = await call('POST', `/orgs/${orgId}/dishes`, { name: 'Морковь отварная', kind: 'dish' });
await P.goto(`${BASE}${base}/menu/${dish.id}`);
await P.waitForSelector('h2:has-text("Состав")');
await P.selectOption('#al-pick', `p:${carrot.id}`); await P.fill('#al-r', '100');
await P.click('form:has-text("Добавить строку") button:has-text("Добавить")');
await P.waitForSelector('td:has-text("Морковь свежая")');
await P.click('button[aria-label="Обработка Морковь свежая"]');
await P.click('button:has-text("+ шаг обработки")'); await P.selectOption('select[aria-label="Шаг 1"]', 'clean');
await P.waitForSelector('text=по норме: 20 %');
await P.click('button:has-text("+ шаг обработки")'); await P.selectOption('select[aria-label="Шаг 2"]', 'boil');
await P.waitForSelector('text=по норме: 3 %');
await P.waitForSelector('text=выход 100 г');
const pv = await P.textContent('p:has-text("Брутто") b');
if (!/Брутто 128,866 → нетто 103,093 → выход 100 г/.test(pv.replace(/\s/g, ' '))) throw new Error('предпросмотр: ' + pv);
await shot(P, 'шаги_обработки');
await P.click('button:has-text("Пересчитать и сохранить")');
await P.waitForSelector('td:has-text("очистка −20 % → варка −3 %")');
const v = await call('GET', `/orgs/${orgId}/dishes/${dish.id}`);
const ln = v.current.lines[0];
if (Number(ln.brutto) !== 128.866 || Number(ln.netto) !== 103.093 || Number(ln.ready) !== 100) throw new Error('строка: ' + JSON.stringify(ln));
await shot(P, 'строка_с_обработкой');

step('обработка по умолчанию подставляется в новую строку');
const norms = (await call('GET', `/orgs/${orgId}/processing/norms?productId=${carrot.id}`)).norms;
await call('POST', `/orgs/${orgId}/processing/norms/${norms.find((x) => x.method_code === 'clean').id}/default`, { isDefault: true });
await P.reload(); await P.waitForSelector('h2:has-text("Состав")');
await P.selectOption('#al-pick', `p:${carrot.id}`); await P.fill('#al-n', '8');
await P.click('form:has-text("Добавить строку") button:has-text("Добавить")');
await P.waitForFunction(() => document.querySelectorAll('td:first-child').length >= 2 && [...document.querySelectorAll('td')].some((t) => t.textContent === '10'));
const v2 = await call('GET', `/orgs/${orgId}/dishes/${dish.id}`);
if (Number(v2.current.lines[1].brutto) !== 10 || v2.current.lines[1].steps[0]?.method_code !== 'clean') throw new Error('по умолчанию: ' + JSON.stringify(v2.current.lines[1]));

step('подзаголовок: выход по разделам через «/»');
P.once('dialog', (d) => d.accept('Украшение'));
await P.click('button:has-text("+ подзаголовок")');
await P.waitForSelector('tr.heading:has-text("Украшение")');
await P.click('button[aria-label="Выше Украшение"]');
await P.waitForSelector('text=Выход по разделам: 100/8 г');
await shot(P, 'разделы');
const head = await P.textContent('.card:has(h2:has-text("Состав")) b');
if (!/Рецептура № \d+ от \d\d\.\d\d\.\d{4}/.test(await P.textContent('.card b'))) throw new Error('нет номера рецептуры: ' + head);

step('калькуляционная карточка ОП-1: цена вручную с основанием, утверждение, печатная форма');
const salad = await call('POST', `/orgs/${orgId}/dishes`, { name: 'Салат из моркови', kind: 'dish' });
const sv = (await call('GET', `/orgs/${orgId}/dishes/${salad.id}`)).current.version.id;
await call('PATCH', `/orgs/${orgId}/ttk/${sv}`, { technology: 'Морковь натереть, заправить, посолить.', storageConditions: 'при +2…+6 °C', shelfLife: 'по СанПиН', yieldG: 200, portionG: 100 });
await call('POST', `/orgs/${orgId}/ttk/${sv}/lines`, { productId: carrot.id, unit: 'г', brutto: 210, netto: 190 });
await call('POST', `/orgs/${orgId}/ttk/${sv}/submit`, {}); await call('POST', `/orgs/${orgId}/ttk/${sv}/approve`, {});
await P.goto(`${BASE}${base}/menu/${salad.id}`);
await P.click('a:has-text("Калькуляционная карточка (ОП-1)")');
await P.waitForSelector('h2:has-text("Калькуляция № 1")');
await P.waitForSelector('.badge.crit:has-text("нет цены")');
await P.fill('input[aria-label="Цена Морковь свежая"]', '60');
await P.fill('input[aria-label="Основание цены Морковь свежая"]', 'Тест: прайс поставщика');
await P.fill('#cs', '150'); await P.fill('#cacc', 'С. С. Сидоров');
await P.waitForSelector('dd:has-text("7,13 ₽")');   // брутто по обработке по умолчанию: 190 / 0,8 / 2 = 118,75 г
await shot(P, 'калькуляция');
await P.click('button:has-text("Утвердить калькуляцию № 1")');
await P.waitForSelector('text=КАЛЬКУЛЯЦИОННАЯ КАРТОЧКА');
await P.waitForSelector('td:has-text("0,1188")');
await P.waitForSelector('td:has-text("713,00")');
await P.waitForSelector('text=С. С. Сидоров');
await shot(P, 'оп1');

await browser.close(); await db.end();
if (errors.length) throw new Error(`ошибки страницы: ${errors.join('; ')}`);
console.log('✓ этап 18: обработка сырья');
