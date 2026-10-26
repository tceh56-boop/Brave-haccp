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
  lotCream: (await one(`select l.id from lots l join products p on p.id = l.product_id where l.organization_id = $1 and p.name = 'Сливки 33%' order by l.created_at limit 1`, [org.id])).id,
  prodPlanned: (await one(`select id from production_orders where organization_id = $1 and status = 'planned'`, [org.id])).id,
  event: (await one(`select id from plan_events where organization_id = $1`, [org.id])).id,
  sto: (await one(`select id from sto_standards where organization_id = $1`, [org.id])).id,
  card: (await one(`select id from costing_cards where organization_id = $1`, [org.id])).id,
  act: (await one(`select id from control_acts where organization_id = $1`, [org.id])).id,
  mors: (await one(`select id from dishes where organization_id = $1 and name = 'Морс клюквенный'`, [org.id])).id,
  sauce: (await one(`select id from dishes where organization_id = $1 and name = 'Соус сливочный'`, [org.id])).id,
  contract: (await one(`select id from contracts where organization_id = $1 and kind = 'pest_control'`, [org.id])).id,
  meatEq: (await one(`select id from equipment where organization_id = $1 and name = 'Камера мяса Polair'`, [org.id])).id,
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
  await p.addStyleTag({ content: '*{caret-color:transparent!important;transition:none!important}' });
  await p.waitForTimeout(250);
  const boxes = [];
  for (const [i, sel] of marks.entries()) {
    const loc = p.locator(sel).filter({ visible: true }).first();   // закрытое меню разделов не считается
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
      Object.assign(n.style, { position: 'absolute', left: b.x < 14 ? '6px' : '-14px', top: b.y < 14 ? '4px' : '-14px',   // у края экрана — номер внутри рамки
        width: '24px', height: '24px', borderRadius: '50%', background: '#F07A1A', color: '#fff', font: '700 14px/24px Arial', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.35)' });
      f.appendChild(n);
      document.body.appendChild(f);
    }
  }, boxes);
  const H = await p.evaluate(() => Math.max(document.documentElement.scrollHeight, innerHeight));
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
  await p.goto(`${BASE}/login`); await p.fill('#email', 'povar@demo.test'); await p.waitForTimeout(1600);   // логотип доанимирован
  await snap(p, 'login', ['#email', '#password', 'button:has-text("Войти")'], { top: true }); }
{ const p = await as('vladelec'); await go(p, `${B}/problems`, 'h1:has-text("Проблемы")');
  await snap(p, 'topbar', ['.hamburger', '.topbar .logo', '.who'], { top: true, maxH: 600 });
  await p.setViewportSize({ width: 390, height: 1240 });   // всё меню целиком
  await p.click('.hamburger'); await p.waitForTimeout(400);
  await snap(p, 'sidemenu', ['.menu-group:text-is("Оперативное")', '.menu-group:text-is("ХАССП")', '.menu-group:text-is("Меню и продажи")', '.menu-group:text-is("Управление")'], { top: true, maxH: 1700, below: 330 });
  await p.keyboard.press('Escape'); await p.setViewportSize({ width: 390, height: 844 });
  await go(p, B, 'text=Журналы J01');
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
{ const p = await as('shef'); await go(p, `${B}/menu`, 'h2:has-text("Номенклатура")'); await p.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
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

// 10. Маркировка и вскрытие тары
{ const p = await as('sklad'); await go(p, `${B}/lots/${ids.lotCream}`, 'h2:has-text("Маркировка")');
  await snap(p, 'lot_label', ['h2:has-text("Маркировка")', 'button:has-text("Этикетка") >> nth=0', 'button:has-text("Вскрыть тару")'], { maxH: 1400 });
  await p.click('button:has-text("Вскрыть тару")'); await p.locator('#oq').waitFor();
  await snap(p, 'lot_open', ['#oq', '#oh', 'button:has-text("Вскрыть и напечатать этикетку")'], { maxH: 1300 });
  await go(p, `${B}/labels`, 'h2:has-text("Журнал печати")');
  await snap(p, 'labels', ['.chips', 'h2:has-text("Журнал печати")', 'tr:has-text("Молоко")'], { top: true, maxH: 1300 }); }

// 11. Закупки
{ const p = await as('sklad'); await go(p, `${B}/purchasing`, 'h2:has-text("Остатки и потребность")');
  await snap(p, 'purchasing', ['button[role=tab]:has-text("Что заказать")', 'button[role=tab]:has-text("Заказы")', 'button[role=tab]:has-text("Нормы")', '.card:has(h2:has-text("Остатки и потребность")) input >> nth=0', '#sup', 'button:has-text("Создать черновик заказа")'], { top: true, maxH: 2000 }); }

// 12. Производство п/ф
{ const p = await as('shef'); await go(p, `${B}/production`, 'h2:has-text("Новое задание")');
  await snap(p, 'production', ['#pd', 'h2:has-text("План")', 'h2:has-text("Выпущено")', '#ps', '#pk', 'button:has-text("Создать задание")'], { top: true, maxH: 1800 }); }
{ const p = await as('povar'); await go(p, `${B}/production/${ids.prodPlanned}`, 'h2:has-text("Потребность по ТТК")');
  await snap(p, 'production_order', ['button:has-text("Начать")', 'h2:has-text("Потребность по ТТК")', 'h2:has-text("Контроль при выпуске")'], { top: true, maxH: 1500 }); }

// 13. План-меню
{ const p = await as('shef'); await go(p, `${B}/events/${ids.event}`, 'h2:has-text("Потребность по ТТК")');
  await snap(p, 'event', ['a:has-text("Лист для кухни")', 'a:has-text("Требование в кладовую")', 'h2:has-text("Меню")', 'button:has-text("Добавить в меню")', 'h2:has-text("Потребность по ТТК")', 'button:has-text("на нехватку")'], { top: true, maxH: 3000 }); }

// 14. Лаборатория и пробы
{ const p = await as('povar'); await go(p, `${B}/lab`, 'h2:has-text("Отбор пробы")');
  await snap(p, 'lab_sample', ['h2:has-text("Отбор пробы")', '.seg button:has-text("Мероприятие"), button:has-text("Мероприятие") >> nth=0', '#sw', '#st', '#si', 'button:has-text("Отобрать пробу")'], { maxH: 2000, above: 80 }); }
{ const p = await as('haccp'); await go(p, `${B}/lab`, 'button[role=tab]:has-text("Лаборатория")'); await p.click('button[role=tab]:has-text("Лаборатория")');
  await p.locator('h2:has-text("Программа контроля")').waitFor();
  await snap(p, 'lab_program', ['h2:has-text("Программа контроля")', '.badge.crit >> nth=0', 'a:has-text("Д-101"), a:has-text("Микробиология") >> nth=0'], { top: true, maxH: 2000 }); }

// 15. Оборудование
{ const p = await as('shef'); await go(p, `${B}/equipment`, 'a.objrow');
  await snap(p, 'equipment', ['a.objrow:has-text("Камера мяса Polair")', 'a.objrow:has-text("Термометр старый")', '#en', '#ek', 'button:text-is("Добавить")'], { top: true, maxH: 2000 });
  await go(p, `${B}/equipment/${ids.meatEq}`, 'h2:has-text("Записать событие")');
  await snap(p, 'equipment_card', ['.kv', 'h2:has-text("Записать событие")'], { top: true, maxH: 1600 }); }

// 16. Санитария
{ const p = await as('povar'); await go(p, `${B}/sanitation`, 'h2:has-text("Сделать")');
  await snap(p, 'sanitation', ['button[role=tab] >> nth=0', 'h2:has-text("Сделать")', 'button:has-text("Выполнено") >> nth=0', 'h2:has-text("За 7 дней")'], { top: true, maxH: 1600 }); }
{ const p = await as('haccp'); await go(p, `${B}/sanitation`, 'h2:has-text("Проверить")');
  await snap(p, 'sanitation_check', ['h2:has-text("Проверить")', 'button[role=tab]:has-text("План")', 'button[role=tab]:has-text("Дезсредства")'], { top: true, maxH: 1600 }); }

// 17. Персонал
{ const p = await as('haccp'); await go(p, `${B}/staff`, 'h2:has-text("Осмотр перед сменой")');
  await snap(p, 'staff', ['h2:has-text("Медицинский допуск — режим")', 'h2:has-text("Осмотр перед сменой")', 'button:has-text("Допущен") >> nth=0', 'h2:has-text("Сотрудники")', 'h2:has-text("Провести инструктаж")'], { top: true, maxH: 3000 }); }
{ const p = await as('povar'); await go(p, `${B}/staff/me`, 'h2:has-text("Медицинский допуск")');
  await snap(p, 'staff_me', ['h2:has-text("Медицинский допуск")', 'h2:has-text("Инструктажи по должности")', 'h2:has-text("История инструктажей")'], { top: true, maxH: 1700 }); }

// 18. Документы ТТК
{ const p = await as('tehnolog'); await go(p, `${B}/menu`, 'h2:has-text("Номенклатура")');
  await snap(p, 'menu_tiles', ['a.tile:has-text("Обработка сырья")', 'a.tile:has-text("Стандарты организации")', 'a.tile:has-text("Отчёты по меню")', 'button:has-text("+ папка")'], { top: true, maxH: 1000 });
  await go(p, `${B}/menu/${ids.dish}`, 'text=Себестоимость');
  await snap(p, 'dish_docs', ['a:has-text("Документы ТТК")', 'a:has-text("Акты контрольной проработки")', 'a:has-text("Калькуляционная карточка")', 'a:has-text("Технические условия")', 'a:has-text("Технологическая инструкция")'], { maxH: 1000, above: 120 });
  await go(p, `${B}/menu/processing`, '#pp'); await p.locator('#pp option:has-text("Говядина вырезка")').waitFor({ state: 'attached' });
  await p.selectOption('#pp', { label: 'Говядина вырезка (кг)' }); await p.locator('h2:has-text("Новая норма")').waitFor();
  await snap(p, 'processing', ['#pp', '.card:has-text("Зачистка") >> nth=0', 'h2:has-text("Новая норма")', '#nm', '#nl', '#nb', 'button:has-text("Внести норму")'], { top: true, maxH: 2600 });
  await go(p, `${B}/menu/${ids.dish}/ttk-docs`, 'text=Обоснование расчётов');
  await snap(p, 'ttkdocs', ['a.tile:has-text("Технико-технологическая карта")', 'a.tile:has-text("Обоснование расчётов")', 'h2:has-text("Показатели качества")', 'h2:has-text("Сырьё: данные по документам")'], { top: true, maxH: 2000 });
  await go(p, `${B}/menu/${ids.dish}/ti`, 'h2:has-text("Что вписывает технолог")');
  await snap(p, 'ti', ['h2:has-text("Что вписывает технолог")', 'h2:has-text("Утверждение")', 'h2:has-text("Лист регистрации изменений")'], { top: true, maxH: 2600 });
  await go(p, `${B}/menu/reports`, 'button:has-text("Информационный лист")');
  await snap(p, 'reports', ['button:has-text("Информационный лист")', 'button:has-text("Лист калорийности")', 'button:has-text("Закладки для поваров")', 'button:has-text("Содержание ингредиента")', 'button:has-text("Печать / сохранить PDF")'], { top: true, maxH: 1300 }); }
{ const p = await as('shef'); await go(p, `${B}/menu/${ids.dish}/costing`, 'h2:has-text("Утверждённые калькуляции")');
  await snap(p, 'costing', ['h2:has-text("Утверждённые калькуляции")', 'h2:has-text("Калькуляция №")', 'label:has-text("Цена продажи")', 'button:has-text("Утвердить калькуляцию")'], { top: true, maxH: 2400 });
  await go(p, `${B}/menu/${ids.mors}/acts/${ids.act}`, 'button:has-text("Утвердить акт")');
  await snap(p, 'act', ['button:has-text("Сохранить массы")', 'button:has-text("Утвердить акт")', 'button:has-text("Печать")', 'table input >> nth=0'], { top: true, maxH: 2000 }); }

// 19. Договоры
{ const p = await as('vladelec');
  await go(p, `${B}/menu/sto/${ids.sto}`, 'h2:has-text("Состав и разделы")');
  await snap(p, 'sto', ['#sto-group', 'h2:has-text("Состав и разделы")', 'h2:has-text("Утверждение (руководитель)")'], { top: true, maxH: 2600 });
  await go(p, `${B}/contracts`, 'h2:has-text("Обязательные для ППК")');
  await snap(p, 'contracts', ['h2:has-text("Обязательные для ППК")', 'button:has-text("Внести") >> nth=0', 'a.objrow >> nth=0', 'h2:has-text("Внести договор")'], { top: true, maxH: 1500 });
  await go(p, `${B}/contracts/${ids.contract}`, 'h2:has-text("Файлы договора")');
  await snap(p, 'contract', ['.badge >> nth=0', 'button:has-text("Изменить / продлить")', 'button:has-text("Расторгнуть")', 'a:has-text("договор-дезинсекция.pdf")', 'button:has-text("Добавить PDF, DOCX")'], { top: true, maxH: 1800 }); }

// 20. Экономика: P&L, ABC/XYZ, расходы
{ const p = await as('buh'); await go(p, `${B}/economics`, '.chips');
  await p.click('.chips button:has-text("P&L")'); await p.locator('h2:has-text("P&L")').waitFor();
  await snap(p, 'pnl', ['.chips button:has-text("P&L")', '.chips button:has-text("ABC / XYZ")', '.chips button:has-text("Расходы")', 'h2:has-text("P&L")'], { top: true, maxH: 1800 });
  await p.click('.chips button:has-text("Расходы")'); await p.locator('h2:has-text("Новый расход")').waitFor();
  await snap(p, 'expenses', ['h2:has-text("Расходы за период")', '#xc', '#xk', '#xa', 'button:has-text("Добавить расход")'], { top: true, maxH: 2000 }); }

await browser.close(); await db.end();
console.log(missing ? `Готово, не найдено элементов: ${missing}` : 'Готово, все элементы найдены');
if (missing) process.exitCode = 1;
