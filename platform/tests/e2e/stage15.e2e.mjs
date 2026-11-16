// Сквозной сценарий этапа 15 в браузере: реестр оборудования → термометр с истёкшей поверкой не принимается для замера →
// поверка с документом → замер принят → неисправность холодильника (отклонение) → ремонт с допуском →
// дезсредство с режимом → план с замером концентрации → выполнение вне режима и в режиме → журнал J15.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage15.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const stamp = Date.now().toString(36);
const owner = { name: 'Анна Шеф', email: `eq15.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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
await P.fill('#name', `Кафе «Оборудование ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname, orgId = base.split('/').pop();
const [site] = await call('GET', `/orgs/${orgId}/sites`);

const mskDay = (n) => new Date(Date.now() + n * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });

step('объект контроля «Холодильник №1» с правилом');
const obj = await call('POST', `/orgs/${orgId}/objects`, { siteId: site.id, name: 'Холодильник №1', kind: 'fridge' });

step('оборудование: холодильник (связан с объектом) и термометр с истёкшей поверкой');
await P.goto(`${BASE}${base}`);
await P.click('.hamburger');
await P.click('.sidemenu.open .menu-item:has-text("Оборудование")');
await P.waitForSelector('h2:has-text("Добавить в реестр")');
await P.fill('#en', 'Холодильник Polair'); await P.fill('#es', 'P-77'); await P.fill('#et', '90');
await P.selectOption('#eo', { label: 'Холодильник №1' });
await P.click('button:text-is("Добавить")');
await P.waitForSelector('a.objrow:has-text("Холодильник Polair") .badge.ok');
await P.fill('#en', 'Термометр-щуп ТЦ-1'); await P.selectOption('#ek', 'instrument'); await P.fill('#es', '1101');
await P.fill('#ed', mskDay(-2)); await P.fill('#ef', 'Свидетельство № С-1');
await P.click('button:text-is("Добавить")');
await P.waitForSelector('a.objrow:has-text("Термометр-щуп ТЦ-1") .badge.crit:has-text("поверка")');
await shot(P, 'оборудование');

step('замер: прибор с истёкшей поверкой не выбирается — замер не принят');
await P.goto(`${BASE}${base}/objects/${obj.id}`);
await P.waitForSelector('#instr option:has-text("поверка истекла")', { state: 'attached' });
await P.fill('#v', '4');
await P.click('button:has-text("Сохранить замер")');
await P.waitForSelector('.err:has-text("Выберите прибор")');

step('поверка записью с документом → прибор пригоден, выбирается сам, замер принят');
const instr = (await call('GET', `/orgs/${orgId}/equipment?siteId=${site.id}`)).find((e) => e.name === 'Термометр-щуп ТЦ-1');
await P.goto(`${BASE}${base}/equipment/${instr.id}`);
await P.waitForSelector('.err:has-text("Замеры этим прибором не принимаются")');
await P.click('.chips button:has-text("Поверка")');
await P.fill('#vd', 'Поверка в ЦСМ'); await P.fill('#vc', 'Свидетельство № С-2'); await P.fill('#vn', mskDay(365));
await P.click('button:text-is("Записать")');
await P.waitForSelector('li:has-text("Поверка"):has-text("Свидетельство № С-2")');
await P.waitForSelector('.badge.ok:text-is("исправно")');
await P.goto(`${BASE}${base}/objects/${obj.id}`);
await P.waitForFunction((id) => document.querySelector('#instr')?.value === id, instr.id);
await P.fill('#v', '4');
await P.click('button:has-text("Сохранить замер")');
await P.waitForSelector('text=Последний');

step('неисправность холодильника → отклонение; ремонт с допуском');
const fr = (await call('GET', `/orgs/${orgId}/equipment?siteId=${site.id}`)).find((e) => e.name === 'Холодильник Polair');
await P.goto(`${BASE}${base}/equipment/${fr.id}`);
await P.click('.chips button:has-text("Неисправность")');
await P.fill('#vd', 'Не держит температуру, +12 °C'); await P.fill('#vs', 'в камере мясо — оценить партии');
await P.click('button:text-is("Записать")');
await P.waitForSelector('.badge.crit:text-is("Неисправно")');
await P.waitForSelector('li:has-text("Неисправность") a:has-text("отклонение")');
await P.click('.chips button:has-text("Ремонт")');
await P.fill('#vd', 'Заменён компрессор'); await P.fill('#vp', 'ООО «Холод-Сервис»');
await P.click('button.yes:has-text("Допущено к работе")');
await P.click('button:text-is("Записать")');
await P.waitForSelector('li:has-text("Ремонт") .badge.ok:has-text("допущено")');
await shot(P, 'карточка');

step('санитария: средство с режимом → утверждение → план с замером концентрации');
await P.click('.hamburger');
await P.click('.sidemenu.open .menu-item:has-text("Санитария")');
await P.click('.tabs button:has-text("Дезсредства")');
await P.fill('#dn', 'Ника-Хлор'); await P.fill('#dp', 'поверхности'); await P.fill('#d1', '0,1'); await P.fill('#d2', '0,2'); await P.fill('#de', '30 мин');
await P.fill('#db', 'Инструкция производителя № 12/2024');
await P.click('button:has-text("Добавить черновик")');
await P.click('button:has-text("Утвердить режим")');
await P.waitForSelector('li:has-text("Ника-Хлор") .badge.ok:has-text("утверждено")');
await P.click('.tabs button:has-text("План")');
await P.fill('#pa', 'Горячий цех'); await P.selectOption('#pk', 'disinfection'); await P.fill('#pw', 'Дезинфекция столов');
await P.selectOption('#pd', { label: 'Ника-Хлор' });
await P.check('text=Замер концентрации раствора при выполнении');
await P.click('button:text-is("Добавить")');
await P.waitForSelector('.objrow:has-text("Дезинфекция столов")');

step('выполнение: концентрация вне режима — отклонение; в режиме — отмечено');
await P.click('.tabs button:has-text("Сегодня")');
await P.fill('input[aria-label="Концентрация: Горячий цех"]', '0,05');
await P.click('button:text-is("Выполнено")');
await P.waitForSelector('.okbox:has-text("концентрация вне режима")');
await P.fill('input[aria-label="Концентрация: Горячий цех"]', '0,15');
await P.click('button:text-is("Выполнено")');
await P.waitForSelector('.okbox:has-text("отмечено")');
await shot(P, 'санитария');

step('журнал J15 собран из выполнения');
const j = await call('GET', `/orgs/${orgId}/journals/J15?siteId=${site.id}&from=${mskDay(-1)}&to=${mskDay(1)}`);
if (j.rows.length !== 2 || j.rows[1][6] !== 'да') throw new Error('J15 не собран: ' + JSON.stringify(j.rows));

await browser.close(); await db.end();
if (errors.length) throw new Error(`ошибки страницы: ${errors.join('; ')}`);
console.log('OK: этап 15 (оборудование, поверка приборов, ремонт, санитария, журналы) пройден в браузере');
