// Обход демо-организации под нужными ролями: оранжевые рамки с номерами на элементах, снимки в shots/.
// Номер рамки = номер шага в content.mjs. Не найденный элемент печатается как «!! не найдено» — поправьте метку.
// Запуск: DATABASE_URL=…/ceh_demo BASE_URL=http://localhost:3200 node tools/manual/tour.mjs  (после npm run demo:seed)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'shots');
mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.BASE_URL || 'http://localhost:3200';
const PASS = 'Демо-ЦЕХ-2026';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_demo' }); await db.connect();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const org = await one(`select o.id from organizations o join memberships m on m.organization_id = o.id join users u on u.id = m.user_id where u.email = 'vladelec@demo.test'`);
const B = `/app/${org.id}`;
const ids = {
  incidentClosed: (await one(`select id from incidents where organization_id = $1 and kind = 'temperature_deviation'`, [org.id])).id,
  capa: (await one(`select id from capas where organization_id = $1`, [org.id])).id,
  meatFridge: (await one(`select id from control_objects where organization_id = $1 and name = 'Камера мяса'`, [org.id])).id,
  dish: (await one(`select id from dishes where organization_id = $1 and name = 'Бефстроганов'`, [org.id])).id,
  openOrder: (await one(`select id from pos_orders where organization_id = $1 and status = 'open'`, [org.id])).id,
  lotSoon: (await one(`select l.id from lots l join products p on p.id = l.product_id where l.organization_id = $1 and p.name = 'Сливки 33%'`, [org.id])).id,
  site: (await one(`select id from sites where organization_id = $1`, [org.id])).id,
};

const browser = await chromium.launch();
const contexts = {};
let missing = 0;
async function as(login) {
  if (contexts[login]) return contexts[login];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', timezoneId: 'Europe/Moscow', isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`);
  await p.fill('#email', `${login}@demo.test`); await p.fill('#password', PASS);
  await p.click('button:has-text("Войти")'); await p.waitForURL('**/app**');
  contexts[login] = p;
  return p;
}

/** Рамки с номерами на элементах и снимок области вокруг них. */
async function snap(p, name, marks, { above = 150, below = 70, maxH = 1500, top = false } = {}) {
  await p.addStyleTag({ content: '.bottomnav{display:none!important} .with-bottomnav{padding-bottom:0!important} *{caret-color:transparent!important;transition:none!important}' });
  await p.waitForTimeout(250);
  const boxes = [];
  for (const [i, sel] of marks.entries()) {
    const loc = p.locator(sel).first();
    try { await loc.waitFor({ state: 'visible', timeout: 8000 }); } catch { console.log(`!! не найдено: ${name} [${i + 1}] ${sel}`); missing++; continue; }
    const b = await loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; });
    boxes.push({ n: i + 1, ...b });
  }
  await p.evaluate((bs) => {
    for (const b of bs) {
      const f = document.createElement('div');
      f.className = 'tour-mark';
      Object.assign(f.style, { position: 'absolute', left: `${b.x - 4}px`, top: `${b.y - 4}px`, width: `${b.w + 8}px`, height: `${b.h + 8}px`, border: '3px solid #F07A1A', borderRadius: '9px', zIndex: 9999, pointerEvents: 'none', boxShadow: '0 0 0 2px rgba(255,255,255,.7)' });
      const n = document.createElement('div');
      n.textContent = String(b.n);
      Object.assign(n.style, { position: 'absolute', left: '-14px', top: '-14px', width: '24px', height: '24px', borderRadius: '50%', background: '#F07A1A', color: '#fff', font: '700 14px/24px Arial', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.35)' });
      f.appendChild(n);
      document.body.appendChild(f);
    }
  }, boxes);
  const H = await p.evaluate(() => document.documentElement.scrollHeight);
  const minY = boxes.length ? Math.min(...boxes.map((b) => b.y)) : 0, maxY = boxes.length ? Math.max(...boxes.map((b) => b.y + b.h)) : 800;
  let y = top ? 0 : Math.max(0, minY - above);
  let h = Math.min(Math.max(maxY + below - y, 560), maxH, H - y);
  await p.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true, clip: { x: 0, y, width: 390, height: h } });
  await p.evaluate(() => document.querySelectorAll('.tour-mark').forEach((e) => e.remove()));
  console.log('снимок', name);
}
const go = async (p, url, wait) => { await p.goto(BASE + url); if (wait) await p.locator(wait).first().waitFor({ timeout: 15000 }); else await p.waitForLoadState('networkidle'); };

// 1. Вход и главное
{ const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU' })).newPage();
  await p.goto(`${BASE}/login`); await p.fill('#email', 'povar@demo.test');
  await snap(p, 'login', ['#email', '#password', 'button:has-text("Войти")'], { top: true }); }
{ const p = await as('vladelec'); await go(p, B, 'text=Журналы J01');
  await snap(p, 'management', ['a:has-text("Журналы J01")', 'a:has-text("План ХАССП")', 'a:has-text("Касса")', 'a:has-text("Готовность к пилоту")', 'a:has-text("Памятки по ролям")'], { top: true, maxH: 1300 }); }

// 2. Смена повара: экран смены, замер, сообщение, задачи
{ const p = await as('povar'); await go(p, `${B}/shift`, '#temps');
  await snap(p, 'shift', ['a.tile:has-text("Температура")', 'a.tile:has-text("Проблемы")', 'a.tile:has-text("Сообщить")', '#temps'], { top: true });
  await go(p, `${B}/objects/${ids.meatFridge}`, '#v');
  await p.fill('#v', '3,8');
  await snap(p, 'measure', ['#v', 'label:has-text("Замер сделан раньше")', '#cm', 'button:has-text("Сохранить замер")'], { top: true });
  await go(p, `${B}/report`, '#w'); await p.fill('#w', 'Не закрывается дверь холодильника молочного');
  await snap(p, 'report', ['#w', 'button:has-text("Отправить")'], { top: true });
}
{ const p = await as('shef'); await go(p, `${B}/tasks`, 'h1:has-text("Задачи")');
  await snap(p, 'tasks', ['button:has-text("Мои")', 'button:has-text("Все по предприятию")', '.card'], { top: true }); }

// 3. Отклонения: дашборд, карточка, CAPA
{ const p = await as('haccp'); await go(p, `${B}/problems`, 'h1:has-text("Проблемы")');
  await snap(p, 'problems', ['.card.prob >> nth=0', '.card.prob >> nth=1'], { top: true });
  await go(p, `${B}/incidents/${ids.incidentClosed}`, 'text=Ход работы');
  await snap(p, 'incident', ['h1', 'text=Открыть CAPA', 'button:has-text("Объяснить с AI")', 'a:has-text("термометр.jpg")', 'h2:has-text("Ход работы")'], { top: true, maxH: 2200 });
  await go(p, `${B}/capa/${ids.capa}`, '#rootCause');
  await snap(p, 'capa', ['#rootCause', '#correctiveAction', '#preventiveAction', '#effectivenessCriterion', 'button:has-text("Отправить на проверку эффективности")'], { maxH: 2200, above: 260 }); }

// 4. Склад: приёмка, сроки, партия, расход
{ const p = await as('sklad');
  const rec = await (await p.request.post(`${BASE}/api/v1/orgs/${org.id}/receipts`, { data: { siteId: ids.site, documentNo: 'УПД-102' }, headers: { origin: BASE } })).json();
  await go(p, `${B}/receipts/${rec.data.id}`, '#pr');
  await p.selectOption('#pr', { label: 'Говядина вырезка (кг)' }); await p.fill('#q', '5'); await p.fill('#ln', 'Г-0430');
  await snap(p, 'receipt', ['#pr', '#q', '#ex', '#up', '.seg >> nth=0', 'button:text-is("Принять")'], { top: true, maxH: 2300 });
  await go(p, `${B}/lots`, 'a.objrow');
  await snap(p, 'lots', ['a.objrow:has-text("Картофель")', 'a.objrow:has-text("Сливки")', 'a.objrow:has-text("Молоко")'], { top: true });
  await go(p, `${B}/stock`, 'a.objrow');
  await snap(p, 'stock', ['a.tile:has-text("Расход")', 'a.tile:has-text("Сроки")', 'a.tile:has-text("Приёмка")', 'a.objrow >> nth=0'], { top: true }); }
{ const p = await as('povar'); await go(p, `${B}/stock/consume`, '#p');
  await p.selectOption('#p', { label: 'Сливки 33% (л)' }).catch(async () => p.selectOption('#p', { index: 1 }));
  await p.fill('#q', '0,5'); await p.fill('#pu', 'соус к бефстроганову');
  await snap(p, 'consume', ['#p', '#q', '#pu', 'button:has-text("Списать в расход")'], { top: true }); }

// 5. Журналы
{ const p = await as('shef'); await go(p, `${B}/journals`, 'text=Заполняются из операций');
  await snap(p, 'journals', ['h2:has-text("Заполняются из операций")', 'a.objrow:has-text("J01")', 'h2:has-text("Ручные записи")'], { top: true, maxH: 1200 });
  await go(p, `${B}/journals/J01`, 'table');
  await snap(p, 'journal_j01', ['.chips', 'table', 'a:has-text("Печать")', '.okbox'], { top: true, maxH: 2000 }); }
{ const p = await as('povar'); await go(p, `${B}/journals/J02`, '#v0');
  await snap(p, 'journal_manual', ['#v2', '#v3', '#occ', 'button:has-text("Сохранить запись")', 'button:has-text("Исправить")'], { above: 120, maxH: 2600 }); }

// 6. План ХАССП, реестр, AI, пакет
{ const p = await as('tehnolog'); await go(p, `${B}/haccp`, 'text=1. Этапы процесса');
  await snap(p, 'haccp', ['.badge:text("Утверждён")', 'h2:has-text("1. Этапы процесса")', 'text=О-01 · Тепловая обработка', 'text=Предложение системы', '.badge.crit:text("ККТ")'], { top: true, maxH: 2600 }); }
{ const p = await as('haccp'); await go(p, `${B}/regulatory`, 'a.objrow');
  await snap(p, 'regulatory', ['a.objrow:has-text("ПК-03")', '.badge:text("Требует проверки") >> nth=0', 'button:has-text("Профиль предприятия")'], { top: true, maxH: 1400 });
  await go(p, `${B}/assistant`, '#aq'); await p.fill('#aq', 'При какой температуре хранить охлаждённое мясо?'); await p.click('button:has-text("Спросить")');
  await p.locator('.note:has-text("ПК-03")').first().waitFor({ timeout: 15000 });
  await snap(p, 'assistant', ['#aq', '.note:has-text("ПК-03")'], { top: true, maxH: 2000 });
  await go(p, `${B}/pack`, '#pf');
  await snap(p, 'pack', ['#pf', '#pt', 'a:has-text("Скачать пакет")'], { top: true }); }

// 7. Блюда и ТТК
{ const p = await as('shef'); await go(p, `${B}/menu`, 'a.objrow');
  await snap(p, 'menu', ['a.tile:has-text("Архив ТТК")', 'a.tile:has-text("Сопоставить сырьё")', 'a.objrow:has-text("Бефстроганов")', 'a.objrow:has-text("Холодец домашний")'], { top: true, maxH: 1600 });
  await go(p, `${B}/menu/${ids.dish}`, 'text=Себестоимость');
  await snap(p, 'dish', ['#sp', '.badge:text("Утверждена")', 'h2:has-text("Состав")', 'h2:has-text("Себестоимость")', 'h2:has-text("КБЖУ")', 'button:has-text("Изменить — новая версия")'], { top: true, maxH: 3000 }); }
{ const p = await as('tehnolog'); await go(p, `${B}/menu/archive`, 'a.objrow, .objrow');
  await p.fill('input[aria-label="Поиск карты"]', 'холодец'); await p.waitForTimeout(800);
  await snap(p, 'archive', ['input[aria-label="Поиск карты"]', '.chips', '.objrow >> nth=0', 'button:has-text("Карта") >> nth=0'], { top: true, maxH: 1500 });
  await go(p, `${B}/menu/match`, '.card');
  await snap(p, 'match', ['.card >> nth=0', 'select >> nth=0', 'button:has-text("Создать") >> nth=0'], { top: true, maxH: 1200 }); }

// 8. Касса
{ const p = await as('kassa'); await go(p, `${B}/pos`, 'text=Смена открыта');
  await snap(p, 'pos', ['text=Смена открыта', 'input[aria-label="Стол"]', 'button:has-text("Новый заказ")', 'a.objrow >> nth=0', 'button:has-text("Закрыть смену")'], { top: true, maxH: 2000 });
  await go(p, `${B}/pos/${ids.openOrder}`, 'button.tile');
  await p.fill('#p-cash', '200');
  await snap(p, 'order', ['button.tile:has-text("Морс")', 'button.tile:has-text("Компот")', '#p-cash', 'text=Сдача', 'button:has-text("Оплатить")'], { top: true, maxH: 2200 }); }
{ const p = await as('shef'); await go(p, `${B}/stop-list`, 'h1:has-text("Стоп-лист")');
  await snap(p, 'stoplist', ['li:has-text("Компот")', 'button:has-text("Снять") >> nth=0', '#sd', 'button:has-text("В стоп")'], { top: true, maxH: 1800 }); }
{ const p = await as('buh'); await go(p, `${B}/sales`, 'text=Ждут списания');
  await snap(p, 'sales', ['li:has-text("Компот")', 'button:has-text("Повторить списание")', '#csv', 'button:has-text("Загрузить")'], { top: true, maxH: 2200 });
  await go(p, `${B}/economics`, '.tile');
  await snap(p, 'economics', ['.tile >> nth=0', '.tile >> nth=2', '.note, .okbox', 'h2:has-text("Блюда")'], { top: true, maxH: 2000 }); }

// 9. Руководитель: готовность к пилоту; все: памятки
{ const p = await as('vladelec'); await go(p, `${B}/readiness`, 'h2');
  await snap(p, 'readiness', ['.tiles', '.err, .okbox', 'li:has-text("Сотрудники пилота прошли инструктаж")', 'button:has-text("Подтвердить") >> nth=0'], { top: true, maxH: 2400 }); }
{ const p = await as('povar'); await go(p, `${B}/guide`, 'summary');
  await snap(p, 'guide', ['summary:has-text("Сотрудник цеха")', 'h3:has-text("Каждую смену")'], { top: true, maxH: 1600 }); }

await browser.close(); await db.end();
console.log(missing ? `Готово, не найдено элементов: ${missing}` : 'Готово, все элементы найдены');
if (missing) process.exitCode = 1;
