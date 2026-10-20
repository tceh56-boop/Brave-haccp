// Сквозной сценарий этапа 2 в браузере (экран телефона):
// настройка объекта и утверждение правила → приёмка (партия со сроком и без) → замер вне предела →
// отклонение на дашборде → действие с изоляцией → подтверждение другим ответственным → сроки партий.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage2.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const SHOTS = process.env.SHOTS_DIR || null;
const stamp = Date.now().toString(36);
const P = 'Кухня-2026-пароль';
const people = { owner: { name: 'Ольга Владелец', email: `owner2.${stamp}@example.test` }, cook: { name: 'Иван Повар', email: `cook2.${stamp}@example.test` }, haccp: { name: 'Мария ХАССП', email: `haccp2.${stamp}@example.test` } };
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
const errors = [];
async function page() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', timezoneId: 'Europe/Moscow', isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); return p;
}
async function signup(p, u) {
  await p.goto(`${BASE}/register`);
  await p.fill('#fullName', u.name); await p.fill('#email', u.email); await p.fill('#password', P);
  await p.click('button:has-text("Зарегистрироваться")'); await p.waitForSelector('text=Проверьте почту');
  await p.goto(BASE + await link(u.email, 'verify_email')); await p.waitForSelector('text=Email подтверждён');
  await p.goto(`${BASE}/login`); await p.fill('#email', u.email); await p.fill('#password', P);
  await p.click('button:has-text("Войти")'); await p.waitForURL('**/app');
}
const today = (d = 0) => new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);

const O = await page();
step('владелец: регистрация и предприятие');
await signup(O, people.owner);
await O.fill('#name', `Столовая «Смена ${stamp}»`); await O.click('button:has-text("Создать предприятие")');
await O.waitForURL(/\/app\/[0-9a-f-]{36}$/); const base = new URL(O.url()).pathname;

step('владелец: объект контроля, правило с основанием, утверждение');
await O.goto(BASE + base + '/setup');
await O.fill('#on', 'Холодильник №1 (мясо)'); await O.selectOption('#ok', 'fridge'); await O.fill('#ol', 'горячий цех');
await O.click('button:has-text("Добавить объект")');
await O.click('text=Холодильник №1 (мясо)');
await O.waitForSelector('text=не утверждён');
await O.fill('#rmin', '2'); await O.fill('#rmax', '6'); await O.fill('#rfr', '4');
await O.fill('#rsrc', 'Процедура ПК-03 «Контроль холодильного оборудования», п. 2 (утв. 01.10.2026)');
await O.fill('#rre', 'Повторить замер через 15 минут; проверить дверь и уплотнитель; при повторном отклонении изолировать продукцию и сообщить ответственному.');
await O.check('text=Процедура разрешает изолировать продукцию при отклонении');
await O.click('button:has-text("Сохранить проект")');
await O.click('button:has-text("Утвердить")');
await O.waitForSelector('text=действует');
await shot(O, 'объект_правило');
const objectUrl = O.url();

step('владелец: товары и поставщик');
await O.goto(BASE + base + '/setup');
for (const [name, unit] of [['Говядина охлаждённая', 'кг'], ['Сливки 33%', 'л']]) {
  await O.fill('input[aria-label="Название товара"]', name); await O.selectOption('select[aria-label="Единица"]', unit); await O.click('form:has(input[aria-label="Название товара"]) button');
  await O.waitForSelector(`li:has-text("${name}")`);
}
await O.fill('input[aria-label="Поставщик"]', 'ООО «Мясной двор»'); await O.click('form:has(input[aria-label="Поставщик"]) button');
await O.waitForSelector('li:has-text("Мясной двор")');
await shot(O, 'настройка');

step('владелец: приглашения повару и ответственному ХАССП');
await O.goto(BASE + base);
await O.click('role=tab[name="Приглашения"]');
for (const [u, role] of [[people.cook, 'line_staff'], [people.haccp, 'haccp_lead']]) {
  await O.fill('#ie', u.email); await O.fill('#in', u.name); await O.selectOption('#ir', role);
  await O.click('button:has-text("Отправить приглашение")'); await O.waitForSelector(`text=Приглашение отправлено на ${u.email}`);
}
async function join(u) {
  const p = await page(); await signup(p, u);
  await p.goto(BASE + await link(u.email, 'invitation')); await p.click('button:has-text("Принять приглашение")');
  await p.waitForURL(/\/app\/[0-9a-f-]{36}$/); return p;
}
const C = await join(people.cook);
const H = await join(people.haccp);

step('повар: экран смены и приёмка');
await C.goto(BASE + base + '/shift');
await C.waitForSelector('text=Холодильник №1 (мясо)');
await shot(C, 'смена');
await C.click('a.tile:has-text("Приёмка")');
await C.selectOption('#sup', { label: 'ООО «Мясной двор»' }); await C.fill('#dn', 'УПД-1024');
await C.click('button:has-text("Начать приёмку")'); await C.waitForSelector('text=Добавить товар');
await C.selectOption('#pr', { label: 'Говядина охлаждённая (кг)' }); await C.fill('#q', '12,5'); await C.fill('#ln', 'M-0412');
await C.fill('#ex', today(5)); await C.fill('#t', '3,1'); await C.selectOption('#so', { label: 'Холодильник №1 (мясо)' });
for (const label of ['Упаковка цела', 'Маркировка есть и читается', 'Документы в порядке', 'Качество (вид, запах)']) await C.locator(`div:has(> div:text("${label}")) button:has-text("Да")`).click();
await shot(C, 'приёмка_строка');
await C.click('button:has-text("Принять")'); await C.waitForSelector('li:has-text("Говядина охлаждённая")');
await C.selectOption('#pr', { label: 'Сливки 33% (л)' }); await C.fill('#q', '6'); await C.fill('#ln', 'S-77');
await C.selectOption('#so', { label: 'Холодильник №1 (мясо)' });
for (const label of ['Упаковка цела', 'Маркировка есть и читается', 'Документы в порядке', 'Качество (вид, запах)']) await C.locator(`div:has(> div:text("${label}")) button:has-text("Да")`).click();
await C.click('button:has-text("Принять")'); await C.waitForSelector('li:has-text("Сливки 33%")');
await C.click('button:has-text("Завершить приёмку")');
await C.waitForSelector('text=Срок не подтверждён у 1');
await shot(C, 'приёмка_итог');

step('повар: замер вне предела');
await C.goto(objectUrl);
await C.fill('#v', '9,2'); await C.click('button:has-text("Сохранить замер")');
await C.waitForSelector('text=Вне предела');
await shot(C, 'замер_отклонение');

step('ХАССП: дашборд проблем → карточка → действие с изоляцией');
await H.goto(BASE + base + '/problems');
await H.waitForSelector('text=Температура вне предела: Холодильник №1 (мясо)');
await H.waitForSelector('text=Срок не подтверждён: Сливки 33%');
await shot(H, 'проблемы');
await H.click('text=Температура вне предела: Холодильник №1 (мясо)');
await H.waitForURL(/\/incidents\//);
await H.click('button:has-text("Взять в работу")');
await H.waitForSelector('text=В работе');
await H.fill('#an', 'Дверь была неплотно закрыта, уплотнитель заменён. Продукция изолирована до решения.');
await H.check('text=Изолировать затронутые продукты');
await H.click('button:has-text("Записать действие")');
await H.waitForSelector('text=Ожидает подтверждения другим ответственным');
await shot(H, 'отклонение_действие');
const incidentUrl = H.url();

step('владелец: подтверждение закрытия');
await O.goto(incidentUrl);
await O.click('button:has-text("Подтвердить закрытие")');
await O.waitForSelector('text=Закрытие подтверждено');
await shot(O, 'отклонение_закрыто');

step('повар: сроки партий');
await C.goto(BASE + base + '/lots');
await C.waitForSelector('text=Карантин');
// Обе партии лежали в изолированном холодильнике: карантин важнее, чем «срок не подтверждён».
if (await C.locator('a.objrow:has-text("Карантин")').count() !== 2) throw new Error('ожидались 2 партии в карантине');
await shot(C, 'сроки');
await C.click('a.objrow:has-text("Сливки 33%")');
await C.waitForSelector('text=Партию использовать нельзя');
await C.waitForSelector('text=не подтверждён');
await shot(C, 'партия');

await browser.close(); await db.end();
if (errors.length) { console.error('ошибки страниц:', errors); process.exit(1); }
console.log('E2E этапа 2: пройдено');
