// Сквозной сценарий этапа 11 в браузере: п/ф с утверждённой ТТК → ТУ «проект» с замечаниями → пищевая ценность и
// аллергены сырья по документу → параметры (микробиология, ОКПД2, ОКПО) → санитарные правила в реестре →
// «готов к испытаниям» → утверждение с протоколом → документ ТУ утверждённой версии.
// Запуск: BASE_URL=http://localhost:3100 node tests/e2e/stage11.e2e.mjs
import { chromium } from 'playwright';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_dev' }); await db.connect();
const stamp = Date.now().toString(36);
const owner = { name: 'Мария Технолог', email: `tech11.${stamp}@example.test`, pass: 'Кухня-2026-пароль' };
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

step('регистрация и предприятие');
await P.goto(`${BASE}/register`);
await P.fill('#fullName', owner.name); await P.fill('#email', owner.email); await P.fill('#password', owner.pass);
await P.click('button:has-text("Зарегистрироваться")'); await P.waitForSelector('text=Проверьте почту');
await P.goto(BASE + await link(owner.email, 'verify_email')); await P.waitForSelector('text=Email подтверждён');
await P.goto(`${BASE}/login`); await P.fill('#email', owner.email); await P.fill('#password', owner.pass); await P.click('button:has-text("Войти")'); await P.waitForURL('**/app');
await P.fill('#name', `Кафе «ТУ ${stamp}»`); await P.click('button:has-text("Создать предприятие")'); await P.waitForURL(/\/app\/[0-9a-f-]{36}$/);
const base = new URL(P.url()).pathname, orgId = base.split('/').pop();
const me = (await db.query('select id from users where email = $1', [owner.email])).rows[0].id;

step('п/ф «Соус бешамель» с утверждённой ТТК');
const pr = {};
for (const [key, name] of [['milk', 'Молоко 3,2%'], ['flour', 'Мука пшеничная'], ['butter', 'Масло сливочное 82,5%'], ['salt', 'Соль поваренная']]) pr[key] = (await call('POST', `/orgs/${orgId}/products`, { name, unit: 'кг' })).id;
const dish = await call('POST', `/orgs/${orgId}/dishes`, { name: 'Соус бешамель', kind: 'semi' });
const v = (await call('GET', `/orgs/${orgId}/dishes/${dish.id}`)).current.version.id;
await call('PATCH', `/orgs/${orgId}/ttk/${v}`, { yieldG: 1000, technology: 'Муку обжарить на масле, влить горячее молоко, варить 10 минут, посолить.', storageConditions: 'при +2…+6 °C', shelfLife: '24 часа', shelfLifeHours: 24 });
for (const [key, kg] of [['milk', 0.9], ['flour', 0.06], ['butter', 0.06], ['salt', 0.01]]) await call('POST', `/orgs/${orgId}/ttk/${v}/lines`, { productId: pr[key], unit: 'кг', brutto: kg, netto: kg });
await call('POST', `/orgs/${orgId}/ttk/${v}/submit`, {}); await call('POST', `/orgs/${orgId}/ttk/${v}/approve`, {});

step('ТУ: проект с замечаниями');
await P.goto(`${BASE}${base}/menu/${dish.id}`);
await P.click('a:has-text("Технические условия (ТУ)")');
await P.waitForSelector('h1:has-text("Технические условия")');
await P.waitForSelector('.badge:text("Проект")');
await P.waitForSelector('text=Нет пищевой ценности');
await shot(P, 'ту_проект');

step('молоко: пищевая ценность и аллергены по документу через экран');
const milk = P.locator('li', { has: P.locator('b:text-is("Молоко 3,2%")') });
await milk.locator('button:has-text("внести по документу")').click();
await P.fill(`#kcal-${pr.milk}`, '60'); await P.fill(`#protein-${pr.milk}`, '2,9'); await P.fill(`#fat-${pr.milk}`, '3,2'); await P.fill(`#carbs-${pr.milk}`, '4,7');
await P.fill(`#nb-${pr.milk}`, 'маркировка изготовителя на упаковке');
await P.click('button:has-text("Сохранить пищевую ценность")');
await milk.locator('.badge:text("по документу")').waitFor();
const milkChip = milk.locator('.chips button:has-text("молоко")');
if (await milkChip.getAttribute('aria-pressed') !== 'true') await milkChip.click();          // подсказка по названию уже отмечена
await P.fill(`#ab-${pr.milk}`, 'состав на маркировке');
await P.click('button:has-text("Сохранить профиль аллергенов")');
await milk.locator('text=Аллергены: молоко и продукты его переработки').waitFor();

step('остальное сырьё (API), параметры ТУ через экран');
const doc = 'маркировка изготовителя';
await call('POST', `/orgs/${orgId}/products/${pr.flour}/nutrition`, { kcal: 334, protein: 10.3, fat: 1.1, carbs: 70, basis: doc });
await call('POST', `/orgs/${orgId}/products/${pr.butter}/nutrition`, { kcal: 748, protein: 0.5, fat: 82.5, carbs: 0.8, basis: doc });
await call('POST', `/orgs/${orgId}/products/${pr.salt}/nutrition`, { kcal: 0, protein: 0, fat: 0, carbs: 0, basis: doc });
await call('POST', `/orgs/${orgId}/products/${pr.flour}/allergens`, { allergens: ['gluten'], basis: doc });
await call('POST', `/orgs/${orgId}/products/${pr.butter}/allergens`, { allergens: ['milk'], basis: doc });
await call('POST', `/orgs/${orgId}/products/${pr.salt}/allergens`, { allergens: [], basis: 'спецификация: не содержит' });
await P.reload(); await P.waitForSelector('h2:has-text("Параметры ТУ")');
await P.fill('#to', '10.85.19'); await P.fill('#tk', '12345678'); await P.fill('#ts', '7');
for (const code of ['KMAFANM', 'BGKP', 'ECOLI', 'SAUREUS', 'PROTEUS', 'SALMONELLA', 'LISTERIA', 'YEAST_MOLD']) await P.fill(`#m-${code}`, code === 'YEAST_MOLD' ? 'не нормируется' : code === 'KMAFANM' ? '1×10⁴' : '1,0');
await P.click('button:has-text("Сохранить параметры")');
await P.waitForSelector('text=Сохранено, расчёт обновлён');
await P.waitForSelector('text=нет утверждённых действующих санитарных правил');
await P.waitForSelector('td:has-text("на 100 г") >> xpath=.. >> text=105');

step('санитарные правила утверждены в реестре → «готов к испытаниям» → утверждение с протоколом');
const s = (await db.query(`insert into reg_sources (organization_id, code, kind, title, binding) values ($1, 'СанПиН 2.3/2.4.4282-26', 'СанПиН', 'СанПиН 2.3/2.4.4282-26 (санитарные требования к организациям общественного питания)', 'mandatory') returning id`, [orgId])).rows[0];
await db.query(`insert into reg_source_versions (organization_id, source_id, edition, effective_from, workflow_status, last_checked_at, checked_by, check_evidence, approved_by, owner_user_id, next_check_at)
  values ($1, $2, 'утв. 02.06.2026 № 18', '2026-09-01', 'approved', now(), $3, 'сверено с официальной публикацией', $3, $3, now() + interval '90 days')`, [orgId, s.id, me]);
await P.reload();
await P.waitForSelector('.badge:text("Готов к испытаниям")');
await P.fill('#lp', 'Протокол № 15 от 20.10.2026, ИЛЦ «Тест»');
await P.click('button:text-is("Утвердить ТУ")');
await P.waitForSelector('li:has-text("Версия 1"):has-text("ТУ 10.85.19-007-12345678")');
await shot(P, 'ту_готово');

step('документ утверждённой версии');
await P.click('li:has-text("Версия 1") a:has-text("документ")');
await P.waitForSelector('.tu-stamp:text("УТВЕРЖДЕНО · версия 1")');
await P.waitForSelector('.tu-doc h1:text("Соус бешамель")');
await P.waitForSelector('.tu-doc td:text("Молоко 3,2%")');
await P.waitForSelector('.tu-doc td:text("СанПиН 2.3/2.4.4282-26")');
await shot(P, 'ту_документ');

await browser.close(); await db.end();
if (errors.length) throw new Error(`ошибки страницы: ${errors.join('; ')}`);
console.log('OK: этап 11 (технические условия: расчёт, данные по документам, утверждение, документ) пройден в браузере');
