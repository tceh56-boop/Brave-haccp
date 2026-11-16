// Сквозной сценарий этапа 5 (часть 2) в браузере: план ХАССП (этапы → подтверждение на месте → опасность → дерево
// решений → ККТ с обоснованием → мониторинг → утверждение) → отклонение → CAPA с фото → пакет для проверки (ZIP).
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage5b.e2e.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const SHOTS = process.env.SHOTS_DIR || null;
const stamp = Date.now().toString(36);
const owner = { name: 'Ольга Владелец', email: `owner5b.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', timezoneId: 'Europe/Moscow', isMobile: true, hasTouch: true, acceptDownloads: true });
const P = await ctx.newPage();
const errors = []; P.on('pageerror', (e) => errors.push(e.message));
P.on('dialog', (d) => d.accept());
async function call(path, body) {
  const r = body === undefined ? await P.request.get(`${BASE}/api/v1${path}`) : await P.request.post(`${BASE}/api/v1${path}`, { data: body, headers: { origin: BASE } });
  const j = await r.json(); if (!j.ok) throw new Error(`${path}: ${j.error.message}`); return j.data;
}

step('владелец: регистрация и предприятие');
await P.goto(`${BASE}/register`);
await P.fill('#fullName', owner.name); await P.fill('#email', owner.email); await P.fill('#password', owner.pass);
await P.click('button:has-text("Зарегистрироваться")'); await P.waitForSelector('text=Проверьте почту');
await P.goto(BASE + await link(owner.email, 'verify_email')); await P.waitForSelector('text=Email подтверждён');
await P.goto(`${BASE}/login`); await P.fill('#email', owner.email); await P.fill('#password', owner.pass); await P.click('button:has-text("Войти")'); await P.waitForURL('**/app');
await P.fill('#name', `Кафе «План ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname;
const orgId = base.split('/').pop();
const [site] = await call(`/orgs/${orgId}/sites`);

step('план ХАССП: область, этапы, подтверждение на месте');
await P.click('text=План ХАССП: опасности, ККТ, мониторинг');
await P.fill('#ps', 'Блюда горячего цеха из мяса птицы; площадка «Основная»'); await P.fill('#pt', 'технолог, шеф, ответственный ХАССП');
await P.click('button:has-text("Создать проект плана")');
for (const name of ['Хранение в холоде', 'Тепловая обработка']) {
  await P.fill('#stn', name); await P.click('button:has-text("Добавить этап")'); await P.waitForSelector(`li:has-text("${name}")`);
}
for (let i = 0; i < 2; i++) {
  await P.click('button:has-text("Подтвердить на месте")');
  await P.locator('input[id^="sn-"]').fill('Проверено на месте с шеф-поваром');
  await P.locator('form:has(input[id^="sn-"]) button:has-text("Подтвердить")').click();
  await P.waitForFunction((n) => document.querySelectorAll('.badge.ok').length >= n, i + 1);
}

step('опасность: оценка, дерево решений → предложение ККТ, решение группы');
await P.click('button:has-text("Добавить опасность")');
await P.selectOption('#hs-new', { label: '2. Тепловая обработка' });
await P.fill('#hd-new', 'Выживание сальмонеллы при недостаточной термообработке мяса птицы');
await P.selectOption('#hl-new', '3'); await P.selectOption('#hv-new', '3');
await P.fill('#hm-new', 'Термообработка до температуры в толще по ТТК, контроль щупом');
await P.click('button:has-text("Добавить"):not(:has-text("опасность")):not(:has-text("этап"))');
await P.waitForSelector('text=О-01 · Тепловая обработка');
await P.click('.seg[aria-label^="Существуют ли меры"] button.yes');
await P.click('.seg[aria-label^="Этап специально предназначен"] button.yes');
await P.waitForSelector('text=Предложение системы: ККТ');
await P.click('.seg[aria-label="Класс меры"] button:text("ККТ")');
await P.locator('textarea[id^="cr-"]').fill('Этап устраняет опасность; последующих этапов, снижающих её, нет.');
await P.click('button:has-text("Назначить")');
await P.waitForSelector('.badge.crit:text("ККТ")');

step('мониторинг ККТ и утверждение');
await P.locator('input[id^="what-"]').fill('Температура в толще продукта');
await P.locator('input[id^="method-"]').fill('Щуп-термометр в самой толстой части');
await P.locator('input[id^="frequency-"]').fill('Каждая партия');
await P.locator('input[id^="criticalLimit-"]').fill('По утверждённой ТТК (вносит технолог)');
await P.locator('select[id^="rr-"]').selectOption('chef');
await P.locator('input[id^="recordForm-"]').fill('J22');
await P.locator('textarea[id^="ca-"]').fill('Продолжить обработку до предела; партию без достижения предела не выпускать.');
await P.click('button:has-text("Сохранить мониторинг")');
await P.waitForSelector('text=Всё заполнено — план можно утверждать.');
await shot(P, 'план_проект');
await P.click('button:has-text("Утвердить версию 1")');
await P.waitForSelector('.badge.ok:text("Утверждён")');
await shot(P, 'план_утверждён');
await P.goto(`${BASE}${base}/journals/J32`); await P.waitForSelector('td:text("О-01")');

step('отклонение → CAPA из карточки, фото, отправка на проверку');
const obj = await call(`/orgs/${orgId}/objects`, { siteId: site.id, name: 'Камера мяса', kind: 'fridge' });
const rule = await call(`/orgs/${orgId}/objects/${obj.id}/rules`, { minValue: 0, maxValue: 4, frequencyHours: 4, sourceRef: 'Процедура ПК-03, п. 2', reaction: 'Повторить замер; проверить дверь.', allowIsolation: false });
await call(`/orgs/${orgId}/rules/${rule.id}/approve`, {});
const m = await call(`/orgs/${orgId}/measurements`, { controlObjectId: obj.id, value: 8.4 });
await P.goto(`${BASE}${base}/incidents/${m.incidentId}`);
await P.click('button:has-text("Открыть CAPA по этому отклонению")');
await P.waitForURL(/\/capa\/[0-9a-f-]{36}$/);
await P.fill('#rootCause', 'Износ уплотнителя двери; замена не запланирована');
await P.fill('#correctiveAction', 'Замена уплотнителя');
await P.fill('#preventiveAction', 'Осмотр уплотнителей раз в месяц в графике ТО');
await P.fill('#effectivenessCriterion', 'Нет отклонений температуры камеры 14 дней');
await P.click('button:has-text("Сохранить")');
await P.waitForSelector('.badge:text("В работе")');
await P.setInputFiles('input[type=file]', { name: 'уплотнитель.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('фото')]) });
await P.waitForSelector('a:text("уплотнитель.jpg")');
await P.fill('#dn', 'Уплотнитель заменён');
await P.click('button:has-text("Отправить на проверку эффективности")');
await P.waitForSelector('text=Проверяет другой ответственный');
await shot(P, 'capa_на_проверке');

step('пакет для проверки: ZIP со сводкой, журналами и фото');
await P.goto(`${BASE}${base}/pack`);
const [dl] = await Promise.all([P.waitForEvent('download'), P.click('a:has-text("Скачать пакет")')]);
const zip = readFileSync(await dl.path());
if (zip.subarray(0, 2).toString() !== 'PK') throw new Error('пакет не ZIP');
const names = zip.toString('utf8');
for (const n of ['index.html', 'journals/J31.html', 'journals/J32.csv', 'checksums.sha256', 'уплотнитель.jpg']) if (!names.includes(n)) throw new Error(`в пакете нет ${n}`);

if (errors.length) throw new Error('ошибки страницы: ' + errors.join('; '));
console.log('OK: этап 5 (план ХАССП, CAPA, доказательства, пакет) пройден в браузере');
await browser.close(); await db.end();
