// Снимки экранов ЦЕХ Стандарт для руководства (новые модули и вход) с нумерованными метками, как в руководстве MonChef.
// node tools/manual_shots.js <путь к app/Console.html> <папка результата>
// Данные на снимках проверочные («… Тест»), сервер подменяется заглушкой.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [, , CONSOLE, OUT, PLAN = 'pro_max'] = process.argv;
const PLANS = { basic: ['Basic', 1], basic_pro: ['Basic Pro', 2], pro: ['Pro', 3], pro_max: ['Pro Max', 4] };
fs.mkdirSync(OUT, { recursive: true });

const fakeInit = () => {
  const plans = [{ code: 'basic', name: 'Basic', features: ['Загрузка ТТК', 'Сроки реализации', 'КБЖУ', 'Сроки хранения', 'Себестоимость', 'Приёмка', 'Маркировка', 'Экономика', 'Нормативы и охрана труда'] },
    { code: 'basic_pro', name: 'Basic Pro', features: ['Журналы', 'ППК'] }, { code: 'pro', name: 'Pro', features: ['Партии', 'Лабораторные исследования', 'Договоры'] }, { code: 'pro_max', name: 'Pro Max', features: ['AI-ассистент', 'База отработанных ТТК'] }];
  const LV = { ttk: 1, shelf_life: 1, kbju: 1, storage: 1, costing: 1, receiving: 1, labeling: 1, economics: 1, labor_safety: 1, core: 1, journals: 2, ppk: 2, batches: 3, lab: 3, contracts: 3, ai: 4, ttk_library: 4 };
  const allF = {}; Object.keys(LV).forEach(k => { if (LV[k] <= window.__LVL) allF[k] = true; });
  const locked = {}; if (window.__LVL < 2) { locked.haccp = 'basic_pro'; locked.sanitation = 'basic_pro'; locked.inspection = 'basic_pro'; } if (window.__LVL < 3) locked.lab = 'pro';
  const norms = [
    ['OT-02', 'Охрана труда', 'Постановление Правительства РФ от 24.12.2021 № 2464', 'О порядке обучения по охране труда и проверки знания требований охраны труда', 'Инструктажи: вводный, первичный, повторный (не реже 1 раза в 6 месяцев)', 'Инструктажи', 'ПРОВЕРИТЬ'],
    ['OT-03', 'Охрана труда', 'Приказ Минтруда России от 29.10.2021 № 772н', 'Требования к правилам и инструкциям по охране труда', 'Структура инструкции', 'Инструкции по ОТ', 'ДЕЙСТВУЕТ'],
    ['UT-01', 'Условия труда', 'Федеральный закон от 28.12.2013 № 426-ФЗ', 'О специальной оценке условий труда', 'СОУТ не реже 1 раза в 5 лет', 'СОУТ', 'ПРОВЕРИТЬ'],
    ['SN-01', 'СанПиН', 'СанПиН 2.3/2.4.3590-20', 'Требования к организации общественного питания населения', 'Приёмка, хранение, технология, гигиена', 'ХАССП, журналы, приёмка', 'ДЕЙСТВУЕТ']
  ].map(r => ({ 'Код': r[0], 'Группа': r[1], 'Документ': r[2], 'Название': r[3], 'Что требует': r[4], 'Где в системе': r[5], 'Статус': r[6], 'Проверил': r[6] === 'ДЕЙСТВУЕТ' ? 'Шефова Тест' : '', 'Дата проверки': r[6] === 'ДЕЙСТВУЕТ' ? '2026-11-10' : '' }));
  const acts = [{ code: 'MICRO', name: 'Справка о рассмотрении причин микроповреждения (микротравмы)', basis: 'ТК РФ ст. 226; приказ Минтруда № 632н', fields: [['victim', 'Работник (ФИО, должность)'], ['when', 'Дата и время', 'datetime-local'], ['place', 'Место'], ['what', 'Характер микроповреждения'], ['firstaid', 'Оказанная первая помощь'], ['circumstances', 'Обстоятельства', 'textarea'], ['causes', 'Причины', 'textarea'], ['measures', 'Мероприятия по предупреждению', 'textarea']] },
    { code: 'N1', name: 'Акт о несчастном случае на производстве (форма Н-1)', basis: '', fields: [] }];
  const D = {
    uiMe: () => ({ ok: true, name: 'Шефова Тест', role: 'Директор', sections: ['home', 'banquets', 'menu', 'planning', 'production', 'stock', 'finance', 'haccp', 'sanitation', 'personnel', 'lab', 'documents', 'reports', 'inspection', 'settings'], perms: {}, modules: {} }),
    getAppUrl: () => '', uiData: () => ({ ok: true, kpis: [], tabs: [] }),
    tsGetPlanInfo: () => JSON.stringify({ success: true, data: { plan: window.__PLAN || 'pro_max', planName: window.__PLANNAME || 'Pro Max', status: 'ACTIVE', mode: 'full', expiresAt: '31.12.2026', daysLeft: 51, message: '', features: allF, featureNames: { contracts: 'Договоры', ai: 'AI-ассистент', ttk_library: 'База отработанных ТТК' }, lockedSections: locked, plans, notices: [], version: '1.0.0', keyMasked: 'TS-K7QM…H2PX', adminUrl: 'https://script.google.com/macros/s/…/exec', canManage: true } }),
    tsLsGetAll: () => JSON.stringify({ success: true, data: { norms, ot: [{ code: 'ИОТ-01', who: 'Повар', ver: '1', approved: '2026-11-01' }, { code: 'ИОТ-05', who: 'Работа с ножами', ver: '1', approved: '' }], jobs: [{ code: 'ДИ-03', name: 'Повар', ver: '2', approved: '2026-11-01' }],
      haccp: [], briefings: [{ 'Дата': '2026-11-02', 'Сотрудник': 'Поварова Тест', 'Должность': 'Повар', 'Вид': 'Первичный', 'Инструкции': 'ИОТ-01, ИОТ-05', 'Провёл': 'Шефова Тест', 'Следующий до': '2027-05-02' }], sout: [], ppe: [], actsIssued: [{ no: 'ОТ-2026-001', kind: 'Справка о рассмотрении причин микроповреждения (микротравмы)', date: '2026-11-05', who: 'Шефова Тест' }],
      actTypes: acts, alerts: [{ kind: 'Инструктаж', what: 'Кондитерова Тест', due: '2026-11-08', overdue: true }, { kind: 'СИЗ', what: 'Поварова Тест: фартук', due: '2026-11-25', overdue: false }] } }),
    tsLsGetDoc: () => JSON.stringify({ success: true, data: { kind: 'ot', org: 'ООО «Тест»', row: { 'Код': 'ИОТ-01', 'Профессия / вид работ': 'Повар', 'Название': 'Инструкция по охране труда для повара', 'Текст': '1. ОБЩИЕ ТРЕБОВАНИЯ ОХРАНЫ ТРУДА\n1.1. К работе допускаются лица, прошедшие медосмотр, вводный и первичный инструктаж…\n\n2. ТРЕБОВАНИЯ ОХРАНЫ ТРУДА ПЕРЕД НАЧАЛОМ РАБОТЫ\n2.1. Надеть спецодежду…', 'Версия': '1', 'Утверждена': '2026-11-01', 'Основание': 'Приказ Минтруда № 772н' } } }),
    tsContractsList: () => JSON.stringify({ success: true, data: { kinds: ['Поставка продуктов', 'Дезинсекция и дератизация', 'Вывоз отходов', 'Лабораторные исследования'], expiring: 1, rows: [
      { ID: 'CT-1', 'Номер': 'П-14/26', 'Дата': '2026-01-10', 'Контрагент': 'ООО «Мясной двор»', 'Вид': 'Поставка продуктов', 'Сумма': 1200000, 'Окончание': '2026-12-01', 'Файл': 'https://drive.google.com', state: 'ИСТЕКАЕТ' },
      { ID: 'CT-2', 'Номер': 'Д-3', 'Дата': '2026-02-01', 'Контрагент': 'ООО «Дезсервис»', 'Вид': 'Дезинсекция и дератизация', 'Сумма': 36000, 'Окончание': '2027-01-31', 'Файл': '', state: 'ДЕЙСТВУЕТ' }] } }),
    tsAiAsk: () => JSON.stringify({ success: true, data: { answer: '1. Разлейте бульон в неглубокие гастроёмкости (слой до 5–7 см).\n2. Охлаждайте в шкафу шоковой заморозки или в ванне со льдом, помешивая.\n3. Зафиксируйте температуру в толще в журнале.\nТочные пределы — в вашей ППК и СанПиН 2.3/2.4.3590-20.\nСверьте с первоисточником перед применением.' } }),
    tsTtkLibrary: () => JSON.stringify({ success: true, data: { total: 3, categories: { 'Супы': 1, 'Горячие блюда': 2 }, sync: { synced: false }, items: [
      { id: 'T1', name: 'Борщ украинский', category: 'Супы', yield: 300, kcal: 112 }, { id: 'T2', name: 'Котлета по-киевски', category: 'Горячие блюда', yield: 150, kcal: 389 }, { id: 'T3', name: 'Бефстроганов', category: 'Горячие блюда', yield: 200, kcal: 276 }] } }),
    tsTtkLibraryCard: () => JSON.stringify({ success: true, data: { id: 'T1', name: 'Борщ украинский', category: 'Супы', yield: 300, protein: 4.1, fat: 5.3, carbs: 11.8, kcal: 112, source: 'ЦЕХ Стандарт',
      ingredients: [{ name: 'Говядина', brutto: 80, netto: 59, unit: 'г' }, { name: 'Свёкла', brutto: 60, netto: 48, unit: 'г' }, { name: 'Капуста белокочанная', brutto: 50, netto: 40, unit: 'г' }], method: 'Свёклу тушат с томатом… Подают со сметаной.', storage: '+2…+6 °C', shelfLife: '24 ч' } })
  };
  function mk() { let ok = () => {}, fl = () => {}; const o = new Proxy({}, { get(t, k) {
    if (k === 'withSuccessHandler') return f => { ok = f; return o; }; if (k === 'withFailureHandler') return f => { fl = f; return o; }; if (k === 'withUserObject') return () => o;
    return (...a) => setTimeout(() => { try { ok(D[k] ? D[k](...a) : { ok: true, data: [] }); } catch (e) { fl(e); } }, 10);
  } }); return o; }
  window.google = { script: { get run() { return mk(); } } };
};

const MARK = (boxes) => {
  // метки как в руководстве MonChef: оранжевая рамка и номер в кружке
  document.querySelectorAll('.__mk').forEach(e => e.remove());
  boxes.forEach((b, i) => {
    const r = b.getBoundingClientRect ? b.getBoundingClientRect() : b;
    const f = document.createElement('div'); f.className = '__mk';
    Object.assign(f.style, { position: 'fixed', left: (r.left - 4) + 'px', top: (r.top - 4) + 'px', width: (r.width + 8) + 'px', height: (r.height + 8) + 'px', border: '3px solid #e8731a', borderRadius: '10px', zIndex: 99999, pointerEvents: 'none', boxSizing: 'border-box' });
    const c = document.createElement('div'); c.className = '__mk'; c.textContent = String(i + 1);
    Object.assign(c.style, { position: 'fixed', left: (r.left + r.width - 8) + 'px', top: (r.top - 16) + 'px', width: '26px', height: '26px', borderRadius: '50%', background: '#e8731a', color: '#fff', font: '700 15px Arial', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000, border: '2px solid #fff' });
    document.body.append(f, c);
  });
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, locale: 'ru-RU' });
  const p = await ctx.newPage();
  await p.addInitScript(([n, l]) => { window.__PLAN = n; window.__LVL = l[1]; window.__PLANNAME = l[0]; }, [PLAN, PLANS[PLAN]]);
  await p.addInitScript(fakeInit);
  const shot = async (name, sels, clip) => {
    await p.evaluate(() => document.querySelectorAll('.__mk').forEach(e => e.remove()));
    const els = [];
    for (const s of sels) { const h = await p.$(s); if (!h) throw new Error('нет элемента ' + s + ' для ' + name); els.push(h); }
    await p.evaluate((list) => window.__mark(list), els);
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(OUT, name + '.png'), clip: clip || undefined, fullPage: !clip });
  };
  await p.goto('file://' + CONSOLE);
  await p.evaluate(`window.__mark = ${MARK.toString()}`);
  // вход
  await shot('login', ['#pad', '#pad button[data-k="Войти"]'], { x: 400, y: 120, width: 600, height: 640 });
  // главное окно
  await p.evaluate(() => { localStorage.setItem('mc_token', 'x'); TOKEN = 'x'; start(null); });
  await p.waitForTimeout(600);
  const view = async (id) => { await p.click(`button[data-ts="${id}"]`); await p.waitForTimeout(500); };
  await view('tsPlan');
  await shot('plan', ['#tsPlanBadge', '.kpis', '.pwdays', '#mvf_key', 'button[data-mv="activate"]'], { x: 0, y: 0, width: 1400, height: 900 });
  await view('tsLabor');
  await shot('labor_norms', ['.mvcard', '.tabs', 'button[data-mv="verify"]'], { x: 0, y: 0, width: 1400, height: 900 });
  await p.click('button[data-mv="tab"][data-a="brief"]'); await p.waitForTimeout(300);
  await shot('labor_brief', ['#mvf_Сотрудник', '#mvf_Вид', '#mvf_Инструкции', 'button[data-mv="save"]'], { x: 230, y: 0, width: 1170, height: 900 });
  await p.click('button[data-mv="tab"][data-a="ot"]'); await p.waitForTimeout(300);
  await p.click('button[data-mv="doc"]'); await p.waitForTimeout(400);
  await shot('labor_doc', ['textarea[data-tsk="Текст"]', 'input[data-tsk="Утверждена"]', '#tsDocSave', '#tsDocPrint'], { x: 200, y: 0, width: 1200, height: 900 });
  await p.evaluate(() => closeMdl());
  await p.click('button[data-mv="tab"][data-a="acts"]'); await p.waitForTimeout(300);
  await shot('labor_acts', ['#tsActType', '#mvf_act_victim', 'button[data-mv="act"]'], { x: 230, y: 0, width: 1170, height: 900 });
  const lvl = PLANS[PLAN][1];
  if (lvl >= 3) {
  await view('tsContracts');
  await shot('contracts', ['.kpis', '#mvf_Номер', 'button[data-mv="save"]', 'button[data-mv="upload"]'], null);
  }
  if (lvl >= 4) {
  await view('tsAi');
  await p.fill('#mvf_q', 'Как правильно охладить бульон после варки?');
  await p.click('button[data-mv="ask"]'); await p.waitForTimeout(500);
  await shot('ai', ['#tsChat', '#mvf_q', '#mvf_ttk', 'button[data-mv="ask"]'], { x: 230, y: 0, width: 1170, height: 900 });
  await view('tsTtkLib');
  await shot('ttklib', ['#mvf_lq', 'button[data-mv="refresh"]', 'button[data-mv="card"]'], { x: 230, y: 0, width: 1170, height: 700 });
  await p.click('button[data-mv="card"]'); await p.waitForTimeout(400);
  await shot('ttklib_card', ['.kb', '#tsLibAdd'], { x: 200, y: 0, width: 1200, height: 900 });
  }
  await b.close();
  console.log('снимки готовы:', fs.readdirSync(OUT).length);
})().catch(e => { console.error(e); process.exit(1); });
