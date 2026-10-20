const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const IMG = process.argv[3];
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|fonts/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '../../dist/demo/sanlab-demo-standalone.html'));
  await page.waitForSelector('[data-demo-user]', { timeout: 30000 });
  await page.screenshot({ path: OUT + '/m00-login.png' });
  await page.click('[data-demo-user="petrov@sanlab.demo"]');
  await page.waitForSelector('.kpis'); await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/m01-home.png' });
  await page.click('.li:has-text("Кафе «Вкусно»")'); await page.waitForSelector('.seg'); await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/m02-visit.png' });
  // answer unanswered items
  for (let i = 0; i < 20; i++) {
    const un = await page.$$('.ck:not(:has(.seg button.on))');
    if (!un.length) break;
    const id = await un[0].getAttribute('id');
    if (i === 1) { await page.click(`#${id} .seg button.NOK`); await page.fill(`#${id} textarea`, 'Нет антисептика у раковины горячего цеха'); await page.click(`#${id} [data-a="ckSave"]`); }
    else await page.click(`#${id} .seg button.OK`);
    await page.waitForTimeout(400);
  }
  // photos for required items missing
  for (let i = 0; i < 10; i++) {
    const miss = await page.$$('.ck.miss input[type=file]');
    if (!miss.length) break;
    await miss[0].setInputFiles(IMG); await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: OUT + '/m03-checklist.png', fullPage: true });
  await page.click('[data-a="vFinish"]'); await page.waitForTimeout(800);
  const al = await page.$('.overlay .alert.bad'); if (al) { errors.push('finish: ' + await al.innerText()); await page.screenshot({ path: OUT + '/m03b-err.png' }); await page.click('.overlay [data-m=close]'); }
  await page.waitForTimeout(500);
  await page.click('.actionbar [data-a="vSubmit"]'); await page.waitForSelector('.overlay'); await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/m04-submit.png' });
  await page.click('.overlay [data-m="ok"]'); await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/m05-after.png' });
  const st = await page.textContent('.rec-head .pill'); console.log('status after submit:', st);
  // QC approves on desktop
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.click('[data-a="demoSwitch"]'); await page.click('[data-demo-user="qc@sanlab.demo"]'); await page.waitForTimeout(600);
  await page.click('.nav [data-k="review"]'); await page.waitForTimeout(600);
  await page.click('tr.click:has-text("Кафе «Вкусно»")'); await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/q01-report.png', fullPage: true });
  await page.click('[data-a="repApprove"]'); await page.click('.overlay [data-m="ok"]'); await page.waitForTimeout(800);
  const t = await page.$$eval('.toast', ts => ts.map(x => x.textContent)); console.log('toast:', t.join(' | '));
  console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
