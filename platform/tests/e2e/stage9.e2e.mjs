// Сквозной сценарий этапа 9 в браузере: правило «срок после вскрытия» у товара → приёмка → «Этикетки партий»
// (QR, запись в журнал) → вскрытие тары с новым сроком и этикеткой → журнал маркировки → переход по QR-коду.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage9.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const stamp = Date.now().toString(36);
const owner = { name: 'Ольга Владелец', email: `owner9.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
const post = async (path, data) => {
  const r = await (await P.request.post(`${BASE}/api/v1${path}`, { data, headers: { origin: BASE } })).json();
  if (!r.ok) throw new Error(`${path}: ${r.error?.message}`);
  return r.data;
};

step('владелец: регистрация и предприятие');
await P.goto(`${BASE}/register`);
await P.fill('#fullName', owner.name); await P.fill('#email', owner.email); await P.fill('#password', owner.pass);
await P.click('button:has-text("Зарегистрироваться")'); await P.waitForSelector('text=Проверьте почту');
await P.goto(BASE + await link(owner.email, 'verify_email')); await P.waitForSelector('text=Email подтверждён');
await P.goto(`${BASE}/login`); await P.fill('#email', owner.email); await P.fill('#password', owner.pass); await P.click('button:has-text("Войти")'); await P.waitForURL('**/app');
await P.fill('#name', `Кафе «Этикетка ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname;
const orgId = base.split('/').pop();
const [site] = await (await P.request.get(`${BASE}/api/v1/orgs/${orgId}/sites`)).json().then((r) => r.data);

step('товар и правило «срок после вскрытия» с основанием');
const cream = await post(`/orgs/${orgId}/products`, { name: 'Сливки 33%', unit: 'л' });
await P.goto(`${BASE}${base}/setup`);
const li = P.locator('li', { hasText: 'Сливки 33%' }).first();
await li.locator('button:has-text("изменить")').click();
await li.locator('input').first().fill('48');
await li.locator('input').nth(1).fill('маркировка изготовителя: после вскрытия 48 ч при +2…+6 °C');
await li.locator('button:has-text("Сохранить")').click();
await P.waitForSelector('text=после вскрытия: 48 ч');

step('приёмка и «Этикетки партий»: QR, запись в журнал');
const rec = await post(`/orgs/${orgId}/receipts`, { siteId: site.id, documentNo: `УПД-${stamp}` });
const exp = new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10);
await post(`/orgs/${orgId}/receipts/${rec.id}/lines`, { productId: cream.id, quantity: 4, lotNo: 'С-77', expiresAt: exp, expiryBasis: 'маркировка изготовителя',
  checks: { packaging: true, labeling: true, documents: true, quality: true }, decision: 'accepted' });
await post(`/orgs/${orgId}/receipts/${rec.id}/complete`, {});
await P.goto(`${BASE}${base}/receipts/${rec.id}`);
await P.click('button:has-text("Этикетки партий (1)")');
await P.waitForURL(/\/labels\/print\?ids=/);
await P.waitForSelector('.lb .lb-qr svg');
await P.waitForSelector('.lb:has-text("Сливки 33%"):has-text("С-77")');
const code = (await P.locator('.lb-code').first().textContent()).trim();
if (!/^[A-Z2-9]{8}$/.test(code)) throw new Error(`код этикетки: ${code}`);
await P.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
await P.selectOption('#lf', 'a4'); await P.fill('#lc', '2');
await shot(P, 'печать_a4');
await P.click('button:text-is("Печать")');
await P.waitForSelector('text=В журнал записано этикеток: 2');
await P.waitForFunction(() => window.__printed > 0, null, { timeout: 5000 });   // окно печати браузера вызвано

step('вскрытие тары: новый срок по правилу товара и этикетка «Вскрыто»');
await P.goto(`${BASE}/l/${code}`);
await P.waitForURL(/\/lots\/[0-9a-f-]{36}$/);
await P.waitForSelector('h1:has-text("Сливки 33%")');
await P.click('button:text-is("Вскрыть тару")');
await P.fill('#oq', '0,5');
if (await P.inputValue('#oh') !== '48') throw new Error('срок после вскрытия не подставился из правила товара');
await P.click('button:has-text("Вскрыть и напечатать этикетку")');
await P.waitForURL(/\/labels\/print\?ids=/);
await P.waitForSelector('.lb:has-text("Вскрыто")');
await shot(P, 'этикетка_вскрыто');
await P.goBack(); await P.waitForSelector('text=Вскрыто');
await shot(P, 'партия');

step('журнал маркировки через меню');
await P.click('.hamburger'); await P.click('.menu-item:has-text("Маркировка")');
await P.waitForSelector('h2:has-text("Журнал печати")');
await P.waitForSelector(`td:has-text("${code}")`);

await browser.close(); await db.end();
if (errors.length) throw new Error(`ошибки страницы: ${errors.join('; ')}`);
console.log('OK: этап 9 (маркировка, вскрытие тары, QR) пройден в браузере');
