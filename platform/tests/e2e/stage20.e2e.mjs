// Сквозной сценарий договоров в браузере: обязательные для ППК → внесение договора с PDF из формы →
// карточка «действует» → продление → расторжение; DOCX добавляется в карточке; готовность видит договоры.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage20.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const stamp = Date.now().toString(36);
const owner = { name: 'Анна Шеф', email: `ct20.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
await P.fill('#name', `Кафе «Договоры ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname, orgId = base.split('/').pop();
const [site] = await call('GET', `/orgs/${orgId}/sites`);

import fs from 'node:fs';
const mskDay = (n) => new Date(Date.now() + n * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const tmp = fs.mkdtempSync('/tmp/ct20-');
fs.writeFileSync(`${tmp}/dogovor.pdf`, '%PDF-1.4\n% договор дезинсекции\n');
fs.writeFileSync(`${tmp}/dopsoglashenie.docx`, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from('[Content_Types].xml word/document.xml')]));

step('раздел «Договоры» из меню: обязательные для ППК не закрыты');
await P.goto(`${BASE}${base}`);
await P.click('.hamburger');
await P.click('.sidemenu.open .menu-item:has-text("Договоры")');
await P.waitForSelector('h2:has-text("Обязательные для ППК")');
if (await P.locator('button:has-text("Внести")').count() !== 3) throw new Error('ожидалось 3 незакрытых обязательных договора');
await shot(P, 'договоры_пусто');

step('внести договор дезинсекции с файлом из формы');
await P.locator('button:has-text("Внести")').first().click();
if (await P.inputValue('#ck') !== 'pest_control') throw new Error('вид не подставлен');
await P.selectOption('#cs', site.id);
await P.fill('#cc', 'ООО «Дезконтроль»'); await P.fill('#ci', '7701234567'); await P.fill('#cn', 'Д-15');
await P.fill('#cf', mskDay(-5)); await P.fill('#ct', mskDay(20));
await P.fill('#cj', 'дератизация ежемесячно, дезинсекция по заявке');
await P.setInputFiles('input[aria-label="Файл договора"]', `${tmp}/dogovor.pdf`);
await P.waitForSelector('button:has-text("Файл: dogovor.pdf")');
await shot(P, 'договор_форма');
await P.click('button:has-text("Сохранить договор")');
await P.waitForURL(/\/contracts\/[0-9a-f-]{36}$/);
await P.waitForSelector('a:has-text("dogovor.pdf")');
await P.waitForSelector('.badge.warn:has-text("истекает")');

step('продление на год — статус «до …»');
await P.click('button:has-text("Изменить / продлить")');
await P.fill('#eu', mskDay(365));
await P.click('button:text-is("Сохранить")');
await P.waitForSelector(`.badge.ok:has-text("до ${mskDay(365).split('-').reverse().join('.')}")`);

step('доп. соглашение DOCX в карточке');
await P.setInputFiles('input[aria-label="Файл доказательства"]', `${tmp}/dopsoglashenie.docx`);
await P.waitForSelector('a:has-text("dopsoglashenie.docx")');
await shot(P, 'договор_карточка');

step('задача продления создана');
const t = await db.query(`select title from tasks where organization_id = $1 and kind = 'contract_renew' and status = 'open'`, [orgId]);
if (t.rowCount !== 1) throw new Error('нет задачи продления');

step('список: дезинсекция закрыта, две обязательные — нет');
await P.goto(`${BASE}${base}/contracts`);
await P.waitForSelector('a.objrow:has-text("ООО «Дезконтроль»") .badge.ok');
if (await P.locator('button:has-text("Внести")').count() !== 2) throw new Error('ожидалось 2 незакрытых');
await shot(P, 'договоры_список');

step('расторжение с причиной');
await P.click('a.objrow:has-text("ООО «Дезконтроль»")');
await P.click('button:has-text("Расторгнуть")');
await P.fill('#td', mskDay(0)); await P.fill('#tr', 'смена исполнителя');
await P.click('button:text-is("Расторгнуть")');
await P.waitForSelector('.badge:has-text("расторгнут")');
if (await P.locator('button:has-text("Изменить / продлить")').count()) throw new Error('расторгнутый договор можно менять');

step('готовность к пилоту видит договоры');
await P.goto(`${BASE}${base}/readiness`);
await P.waitForSelector('text=Договоры для ППК');
await shot(P, 'готовность');

if (errors.length) throw new Error('ошибки страницы: ' + errors.join('; '));
console.log('OK');
await browser.close(); await db.end();
