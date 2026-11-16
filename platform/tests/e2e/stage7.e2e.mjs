// Сквозной сценарий этапа 7 в браузере (без ключа AI): вопрос по требованиям → найденное утверждённое требование
// с реквизитами (источник, пункт, редакция, дата проверки); вопрос без требования в реестре → честный отказ;
// карточка отклонения → AI-панель показывает требования реестра; журнал AI для руководителя.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage7.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const SHOTS = process.env.SHOTS_DIR || null;
const stamp = Date.now().toString(36);
const owner = { name: 'Ольга Владелец', email: `owner7.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);

step('владелец: регистрация и предприятие');
await P.goto(`${BASE}/register`);
await P.fill('#fullName', owner.name); await P.fill('#email', owner.email); await P.fill('#password', owner.pass);
await P.click('button:has-text("Зарегистрироваться")'); await P.waitForSelector('text=Проверьте почту');
await P.goto(BASE + await link(owner.email, 'verify_email')); await P.waitForSelector('text=Email подтверждён');
await P.goto(`${BASE}/login`); await P.fill('#email', owner.email); await P.fill('#password', owner.pass); await P.click('button:has-text("Войти")'); await P.waitForURL('**/app');
await P.fill('#name', `Кафе «AI ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname;
const orgId = base.split('/').pop();
const [site] = await call(`/orgs/${orgId}/sites`);

step('реестр: утверждённое требование и правило объекта со ссылкой на него');
const { version } = await call(`/orgs/${orgId}/regulatory/sources`, { code: 'ПК-03', kind: 'Внутренний', title: 'Процедура контроля холодильного хранения мяса', binding: 'mandatory', edition: 'ред. 1', effectiveFrom: day(-10) });
const req = await call(`/orgs/${orgId}/regulatory/versions/${version.id}/requirements`, { clause: 'п. 2', text: 'Охлаждённое мясо хранят при температуре от 0 до +4 °C.', scope: 'холодильное хранение мяса', processes: ['storage'] });
await call(`/orgs/${orgId}/regulatory/versions/${version.id}/check`, { evidence: 'Сверено с приказом директора № 12 от 01.10.2026 (оригинал в папке ХАССП)', nextCheckAt: day(180) });
await call(`/orgs/${orgId}/regulatory/versions/${version.id}/approve`, {});
await call(`/orgs/${orgId}/regulatory/requirements/${req.id}/applicability`, { applicable: true, rationale: 'кафе хранит охлаждённое мясо' });
const obj = await call(`/orgs/${orgId}/objects`, { siteId: site.id, name: 'Камера мяса', kind: 'fridge' });
const rule = await call(`/orgs/${orgId}/objects/${obj.id}/rules`, { minValue: 0, maxValue: 4, frequencyHours: 4, requirementId: req.id, reaction: 'Повторить замер; проверить дверь.', allowIsolation: false });
await call(`/orgs/${orgId}/rules/${rule.id}/approve`, {});
const m = await call(`/orgs/${orgId}/measurements`, { controlObjectId: obj.id, value: 7.5 });

step('вопрос по требованиям: найдено утверждённое требование с реквизитами');
await P.goto(`${BASE}${base}`);
await P.click('text=AI-помощник: вопрос по требованиям');
await P.waitForSelector('text=AI не подключён (нет ключа API)');
await P.fill('#aq', 'При какой температуре хранить охлаждённое мясо?');
await P.click('button:has-text("Спросить")');
await P.waitForSelector('.note:has-text("ПК-03, п. 2")');
await P.waitForSelector('text=ред. 1 · Действует');
if (await P.locator('text=ред. ред.').count()) throw new Error('редакция задвоена');
await P.waitForSelector('text=проверено');
await shot(P, 'вопрос_реестр');

step('вопрос без требования в реестре — без выдуманного ответа');
await P.fill('#aq', 'Как часто менять масло во фритюрнице?');
await P.click('button:has-text("Спросить")');
await P.waitForSelector('text=Мои запросы');
const none = await call(`/orgs/${orgId}/ai/ask`, { question: 'Как часто менять масло во фритюрнице?' });
if (none.sources.length || none.answer) throw new Error('без требования в реестре ответа быть не должно');

step('карточка отклонения: AI-панель и требования реестра');
await P.goto(`${BASE}${base}/incidents/${m.incidentId}`);
await P.click('button:has-text("Объяснить с AI")');
await P.waitForSelector('.note:has-text("ПК-03, п. 2")');
await shot(P, 'отклонение_ai');

step('журнал AI для руководителя');
await P.goto(`${BASE}${base}/assistant/log`);
await P.waitForSelector('td:has-text("Отклонение")');
await P.waitForSelector('td:has-text("AI не подключён")');

if (errors.length) throw new Error('ошибки страницы: ' + errors.join('; '));
console.log('OK: этап 7 (AI-помощник: реестр, цитаты, журнал) пройден в браузере');
await browser.close(); await db.end();
