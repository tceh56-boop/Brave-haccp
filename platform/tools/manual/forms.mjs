// Печатные формы для приложения инструкции: страницы печати системы → PDF A4 (как на бумаге) → PNG первых страниц в forms/.
// Запуск: DATABASE_URL=…/ceh_demo BASE_URL=http://localhost:3200 node tools/manual/forms.mjs  (после npm run demo:seed)
import { chromium } from 'playwright';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'forms');
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || 'http://localhost:3200';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_demo' }); await db.connect();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const org = (await one(`select o.id from organizations o join memberships m on m.organization_id = o.id join users u on u.id = m.user_id where u.email = 'vladelec@demo.test'`)).id;
const B = `/app/${org}`;
const dish = async (name) => (await one(`select id from dishes where organization_id = $1 and name = $2`, [org, name])).id;
const strog = await dish('Бефстроганов'), mors = await dish('Морс клюквенный'), sauce = await dish('Соус сливочный');
const site = (await one(`select id from sites where organization_id = $1`, [org])).id;
const card = (await one(`select id from costing_cards where organization_id = $1`, [org])).id;
const act = (await one(`select id from control_acts where organization_id = $1`, [org])).id;
const sto = (await one(`select id from sto_standards where organization_id = $1`, [org])).id;
const ev = (await one(`select id from plan_events where organization_id = $1`, [org])).id;
const labels = (await db.query(`select l.id from labels l join lots t on t.id = l.lot_id join products p on p.id = t.product_id where l.organization_id = $1 and p.name in ('Говядина вырезка', 'Молоко 3,2%') order by p.name limit 2`, [org])).rows.map((r) => r.id);
const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const from = new Date(Date.now() - 6 * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const J = (code) => `/api/v1/orgs/${org}/journals/${code}?siteId=${site}&from=${from}&to=${day}&format=html`;

// [имя файла, кто печатает, адрес, сколько страниц взять, ждать элемент]
export const FORMS = [
  ['j01', 'shef', J('J01'), 1], ['j03', 'shef', J('J03'), 1], ['j02', 'shef', J('J02'), 1], ['j07', 'haccp', J('J07'), 1], ['j10', 'haccp', J('J10'), 1], ['j15', 'haccp', J('J15'), 1],
  ['ttk', 'tehnolog', `${B}/menu/${strog}/ttk-docs/print`, 2, '.tu-doc'], ['basis', 'tehnolog', `${B}/menu/${strog}/ttk-docs/basis`, 1, '.tu-doc'],
  ['costing', 'shef', `${B}/menu/${strog}/costing/${card}`, 1, '.tu-doc'], ['act', 'shef', `${B}/menu/${mors}/acts/${act}`, 1, '.tu-doc'],
  ['ti', 'tehnolog', `${B}/menu/${strog}/ti/print`, 2, '.tu-doc'], ['tu', 'tehnolog', `${B}/menu/${sauce}/tu/print`, 2, '.tu-doc'], ['sto', 'tehnolog', `${B}/menu/sto/${sto}/print`, 2, '.tu-doc'],
  ['event', 'shef', `${B}/events/${ev}/print`, 1], ['requisition', 'shef', `${B}/events/${ev}/requisition`, 1],
  ['labels', 'sklad', `${B}/labels/print?ids=${labels.join(',')}`, 1, '.lb'],
];

const browser = await chromium.launch();
const ctxs = {};
async function as(login) {
  if (ctxs[login]) return ctxs[login];
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`); await p.fill('#email', `${login}@demo.test`); await p.fill('#password', 'Демо-ЦЕХ-2026');
  await p.click('button:has-text("Войти")'); await p.waitForURL('**/app**');
  ctxs[login] = ctx; await p.close();
  return ctx;
}
let bad = 0;
for (const [name, login, url, pages, wait] of FORMS) {
  const p = await (await as(login)).newPage();
  try {
    await p.goto(BASE + url); await p.waitForLoadState('networkidle');
    if (wait) await p.locator(wait).first().waitFor({ timeout: 15000 });
    await p.waitForTimeout(400);
    const pdf = path.join(OUT, `${name}.pdf`);
    await p.pdf({ path: pdf, format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
    execFileSync('pdftoppm', ['-r', '110', '-png', '-f', '1', '-l', String(pages), pdf, path.join(OUT, name)]);
    // пустые поля страницы обрезаются, чтобы форма в инструкции была крупнее
    for (const f of readdirSync(OUT).filter((x) => x.startsWith(name + '-') && x.endsWith('.png'))) execFileSync('convert', [path.join(OUT, f), '-fuzz', '8%', '-trim', '+repage', '-bordercolor', 'white', '-border', '40', path.join(OUT, f)]);
    console.log('форма', name, readdirSync(OUT).filter((f) => f.startsWith(name + '-')).length, 'стр.');
  } catch (e) { console.log(`!! ${name}: ${e.message.split('\n')[0]}`); bad++; }
  await p.close();
}
await browser.close(); await db.end();
if (bad) process.exitCode = 1;
