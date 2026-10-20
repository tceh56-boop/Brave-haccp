const { chromium } = require('playwright');
const path = require('path');
const OUT = process.argv[2] || '/tmp/shots';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const url = 'file://' + path.resolve(__dirname, '../../dist/demo/sanlab-demo-standalone.html');
  await page.goto(url);
  await page.waitForSelector('[data-demo-user]', { timeout: 30000 });
  await page.screenshot({ path: OUT + '/00-login.png' });
  const roles = ['owner', 'coord', 'qc', 'finance', 'lab'];
  for (const r of roles) {
    await page.click(`[data-demo-user="${r}@sanlab.demo"]`);
    await page.waitForSelector('.kpis, .card', { timeout: 15000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/10-home-${r}.png`, fullPage: true });
    const menu = await page.$$eval('.nav button[data-k]', bs => bs.map(b => b.getAttribute('data-k')));
    for (const k of menu) {
      if (k === 'home') continue;
      await page.click(`.nav button[data-k="${k}"]`);
      await page.waitForTimeout(600);
      const err = await page.$('.content .alert.bad');
      if (err) errors.push(`${r}/${k}: ` + (await err.innerText()));
      if (r === 'owner') await page.screenshot({ path: `${OUT}/20-${r}-${k}.png`, fullPage: true });
    }
    await page.click('[data-a="demoSwitch"]');
    await page.waitForSelector('[data-demo-user]');
  }
  console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
