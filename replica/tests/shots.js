const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const { ctx: G } = require('./harness.js');
const OUT = process.argv[3];
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка на Ленина', статус: 'активна' });
G.insertRow_('USERS', { user_id: 'USR-K', organization_id: 'ORG-1', location_ids: 'LOC-1', имя: 'Анна Кассир', роль: 'МЕНЕДЖЕР', статус: 'активен', pin_hash: G.hashPin_('482915', 's'), pin_salt: 's', failed_attempts: 0, lockout_count: 0 });
[['CAT-1','Супы'],['CAT-2','Горячее'],['CAT-3','Напитки'],['CAT-4','Десерты']].forEach(c => G.insertRow_('CATEGORIES', { category_id: c[0], название: c[1], тип: 'блюдо' }));
[['Борщ с говядиной и сметаной',350,'CAT-1'],['Солянка сборная мясная',390,'CAT-1'],['Суп-лапша куриный',260,'CAT-1'],['Уха по-фински со сливками и лососем',420,'CAT-1'],
 ['Котлета по-киевски',480,'CAT-2'],['Морс клюквенный',120,'CAT-3'],['Медовик',230,'CAT-4']].forEach((d, i) =>
  G.insertRow_('DISHES', { dish_id: 'DISH-' + i, organization_id: 'ORG-1', название: d[0], категория_id: d[2], цена_продажи: d[1], статус: 'активно' }));
let tok = G.processOperation('LOGIN', { userId: 'USR-K', pin: '482915' }).data.token;
const sel = G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, tok); if (sel.ok && sel.data.token) tok = sel.data.token;
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errors = [];
  async function shot(w, h, name, actions) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', e => errors.push(name + ': ' + e.message));
    await page.exposeFunction('__gasApi', (a, d, t) => JSON.parse(JSON.stringify(G.processOperation(a, d, t))));
    await page.addInitScript(t => {
      localStorage.setItem('tsekh_token', t);
      function runner() { let ok = () => {}, fail = () => {}; const r = new Proxy({}, { get(_, k) {
        if (k === 'withSuccessHandler') return f => { ok = f; return r; };
        if (k === 'withFailureHandler') return f => { fail = f; return r; };
        if (k === 'withUserObject') return () => r;
        if (k === 'api') return (a, d, tk) => { window.__gasApi(a, d, tk).then(res => ok(res), e => fail(e)); };
        return () => { setTimeout(() => ok({ ok: true, data: null }), 0); }; } }); return r; }
      window.google = { script: { get run() { return runner(); } } };
    }, tok);
    await page.goto('file://' + process.argv[2] + '/Index.html');
    await page.waitForTimeout(800);
    await page.evaluate(() => navTo('pos'));
    await page.waitForTimeout(500);
    await actions(page);
    await page.screenshot({ path: OUT + '/' + name + '.png', fullPage: false });
    await page.close();
  }
  await shot(1440, 900, 'S05-shift-closed-1440', async () => {});
  await shot(1440, 900, 'S01-cashier-1440', async p => {
    await p.fill('#posCashStart', '3000'); await p.click('text=Открыть смену'); await p.waitForTimeout(500); await p.click('#posCats >> text=Супы'); await p.waitForTimeout(200);
    await p.click('text=Борщ с говядиной'); await p.waitForTimeout(300);
    await p.click('text=Уха по-фински'); await p.waitForTimeout(300);
    await p.click('text=Борщ с говядиной'); await p.waitForTimeout(400);
  });
  await shot(390, 844, 'S01-cashier-390', async p => {
    await p.click('#posCats >> text=Супы'); await p.waitForTimeout(200); await p.click('text=Солянка сборная'); await p.waitForTimeout(400);
  });
  await shot(1440, 900, 'S01-paid-1440', async p => {
    await p.click('#posCats >> text=Супы'); await p.waitForTimeout(200); await p.click('text=Суп-лапша'); await p.waitForTimeout(400);
    await p.fill('#posCashGiven', '500'); await p.dispatchEvent('#posCashGiven', 'input');
    await p.click('#posPayBtn'); await p.waitForTimeout(700);
  });
  await browser.close();
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
})();
