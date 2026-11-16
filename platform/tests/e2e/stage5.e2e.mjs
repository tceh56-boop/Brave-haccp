// Сквозной сценарий этапа 5 в браузере: замер → строка в J01 → подпись за период → новая запись делает подпись
// недействительной; ручная запись в J40 видна в J02; исправление с причиной; печатная форма и CSV.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage5.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const SHOTS = process.env.SHOTS_DIR || null;
const stamp = Date.now().toString(36);
const owner = { name: 'Ольга Владелец', email: `owner5.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
await P.fill('#name', `Кафе «Журнал ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname;
const orgId = base.split('/').pop();

step('подготовка: холодильник с утверждённым правилом и замер');
const [site] = await call(`/orgs/${orgId}/sites`);
const obj = await call(`/orgs/${orgId}/objects`, { siteId: site.id, name: 'Холодильник №1 (мясо)', kind: 'fridge' });
const rule = await call(`/orgs/${orgId}/objects/${obj.id}/rules`, { minValue: 2, maxValue: 6, frequencyHours: 4, sourceRef: 'Процедура ПК-03, п. 2', reaction: 'Повторить замер через 15 минут; проверить дверь и уплотнитель.', allowIsolation: false });
await call(`/orgs/${orgId}/rules/${rule.id}/approve`, {});
await call(`/orgs/${orgId}/measurements`, { controlObjectId: obj.id, value: 4.1 });

step('журнал J01 собран из замера; подпись за период');
await P.click('text=Журналы J01–J53');
await P.waitForSelector('text=Заполняются из операций');
await shot(P, 'журналы');
await P.click('a.objrow:has-text("J01")');
await P.waitForSelector('td:text("4,1 °C")');
await P.click('button:has-text("Подписать журнал за период")');
await P.waitForSelector('.okbox:has-text("Подписано: Ольга Владелец")');
await shot(P, 'J01_подписан');

step('новый замер — подпись недействительна');
await call(`/orgs/${orgId}/measurements`, { controlObjectId: obj.id, value: 3.7 });
await P.reload(); await P.waitForSelector('td:text("3,7 °C")');
await P.waitForSelector('text=Журнал изменился после подписи');

step('печатная форма и CSV');
const q = `siteId=${site.id}&from=${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })}&to=${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })}`;
const html = await (await P.request.get(`${BASE}/api/v1/orgs/${orgId}/journals/J01?${q}&format=html`)).text();
if (!html.includes('ЖУРНАЛ ТЕМПЕРАТУРНОГО РЕЖИМА') || !html.includes('4,1 °C')) throw new Error('печатная форма без данных');
const csv = await P.request.get(`${BASE}/api/v1/orgs/${orgId}/journals/J01?${q}&format=csv`);
if (!csv.headers()['content-type'].includes('text/csv') || !(await csv.text()).includes('3,7 °C')) throw new Error('CSV без данных');

step('ручная запись в J40 видна в J02; исправление с причиной');
await P.goto(`${BASE}${base}/journals/J40`);
await P.waitForSelector('text=Запись сохраняется в J02');
await P.fill('#v0', new Date().toLocaleDateString('ru-RU')); await P.fill('#v2', 'Борщ'); await P.fill('#v3', 'отлично');
await P.click('button:has-text("Сохранить запись")');
await P.waitForSelector('td:text("Борщ")');
await P.goto(`${BASE}${base}/journals/J02`);
await P.waitForSelector('td:text("Борщ")');
await P.click('button:has-text("Исправить")');
await P.fill('#f3', 'хорошо'); await P.fill('#fr', 'ошибся оценкой');
await P.click('button:has-text("Сохранить исправление")');
await P.waitForSelector('td:text("хорошо")');
await P.waitForSelector('td:has-text("исправлено: ошибся оценкой")');
await shot(P, 'J02_исправление');

if (errors.length) throw new Error('ошибки страницы: ' + errors.join('; '));
console.log('OK: этап 5 (журналы) пройден в браузере');
await browser.close(); await db.end();
