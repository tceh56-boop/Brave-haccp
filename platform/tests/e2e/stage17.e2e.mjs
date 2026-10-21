// Сквозной сценарий настройки распознавания (этап 17, часть 1): экран без ключей на сервере, виды документов, лимит.
// Обращений к Yandex Cloud не делает. Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage17.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const stamp = Date.now().toString(36);
const owner = { name: 'Ольга Владелец', email: `rc17.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
await P.fill('#name', `Кафе «Распознавание ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname, orgId = base.split('/').pop();
const [site] = await call('GET', `/orgs/${orgId}/sites`);

step('настройка распознавания: без ключей на сервере — «не настроено», включить нельзя');
await P.click('.hamburger');
await P.click('.sidemenu.open .menu-item:has-text("Распознавание документов")');
await P.waitForSelector('h2:has-text("Подключение Yandex Cloud")');
await P.waitForSelector('.badge.warn:has-text("не настроено")');
await P.waitForSelector('text=YANDEX_API_KEY');
if (!(await P.locator('input[type=checkbox]').isDisabled())) throw new Error('включение доступно без ключей');
step('виды документов и лимит сохраняются');
await P.click('.chips button:has-text("Банкетный бланк")');
await P.fill('#lm', '150');
await P.click('button:text-is("Сохранить")');
await P.waitForSelector('.okbox:has-text("Сохранено")');
await P.reload();
await P.waitForFunction(() => document.querySelector('#lm')?.value === '150');
await shot(P, 'распознавание');
await browser.close(); await db.end();
if (errors.length) throw new Error(`ошибки страницы: ${errors.join('; ')}`);
console.log('OK: этап 17, настройка распознавания, пройдена в браузере');
