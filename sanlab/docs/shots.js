const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const URL = 'file:///home/user/Brave-haccp/sanlab/dist/demo/sanlab-demo-standalone.html';
const texts = {}; const log = [];

(async () => {
  const b = await chromium.launch({ args: ['--lang=ru-RU'], env: { ...process.env, LANG: 'ru_RU.UTF-8', LANGUAGE: 'ru' }, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, locale: 'ru-RU', timezoneId: 'Asia/Yekaterinburg' });
  const p = await ctx.newPage();
  p.on('pageerror', e => log.push('pageerror ' + e.message));
  await p.goto(URL); await p.waitForSelector('[data-demo-user]', { timeout: 30000 });
  await p.addStyleTag({ content: '.demo-bar{display:none!important}' });
  const W = ms => p.waitForTimeout(ms || 700);
  const shot = async (n, full) => { await W(400); await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: !!full }); };
  const modal = async (n) => {
    await p.waitForSelector('.overlay .modal', { timeout: 5000 }); await W(500);
    const m = await p.$('.overlay .modal');
    texts[n] = await m.innerText();
    const fields = await p.$$eval('.overlay .modal label, .overlay .modal .field', ls => ls.map(l => l.innerText.split('\n')[0].trim()).filter(Boolean));
    texts[n + '_fields'] = [...new Set(fields)];
    await m.screenshot({ path: `${OUT}/${n}.png` });
  };
  const close = async () => { const c = await p.$('.overlay [data-m="close"]'); if (c) await c.click(); else await p.keyboard.press('Escape'); await W(400); };
  const step = async (name, fn) => { try { await fn(); log.push('ok ' + name); } catch (e) { log.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); try { await close(); } catch (_) { } } };
  const as = async (u) => {
    await p.evaluate(() => { const o = document.querySelector('.overlay'); if (o) o.remove(); });
    await p.evaluate(() => A.demoSwitch()); await p.waitForSelector('[data-demo-user]');
    await p.click(`[data-demo-user="${u}@sanlab.demo"]`); await W(1200);
  };
  const nav = async (k) => { await p.click(`.nav button[data-k="${k}"]`); await W(900); };
  const txt = async (n) => { texts[n] = await p.innerText('.content'); };

  /* 1. Вход */
  await step('pin', async () => {
    await p.evaluate(() => pinLogin(document.getElementById('app'), { mode: 'PIN', company: 'San.Lab' })); await shot('01-login-pin');
  });

  /* 2. Руководитель */
  await step('owner home', async () => { await as('owner'); await shot('02-owner-home'); await txt('02-owner-home'); });
  await step('bell', async () => { await p.click('[data-a="bell"]'); await W(); await shot('03-bell'); await p.keyboard.press('Escape'); await p.click('.page-title, h1').catch(() => { }); await W(); });
  await step('clients', async () => { await nav('clients'); await shot('10-clients'); await txt('10-clients'); });
  await step('clientNew', async () => { await p.click('[data-a="clientNew"]'); await modal('11-client-new'); await close(); });
  await step('client card', async () => { await p.click('.content [data-a="go"]:has-text("ООО «Вкусно»")'); await W(1000); await shot('12-client-card', true); await txt('12-client-card'); });
  await step('siteNew', async () => { await p.click('[data-a="siteNew"]'); await modal('13-site-new'); await close(); });
  await step('contractNew', async () => { await p.click('[data-a="contractNew"]'); await modal('14-contract-new'); await close(); });
  await step('visits', async () => { await nav('visits'); await shot('20-visits'); });
  await step('visits month', async () => { await p.click('[data-a="vf"]:has-text("Месяц")'); await W(); await p.click('[data-a="vf"]:has-text("Неделя") >> nth=0'); await W(); await shot('21-visits-week'); await p.click('[data-a="vf"]:has-text("Список")'); await W(); });
  await step('visitNew', async () => { await p.click('[data-a="visitNew"]'); await modal('22-visit-new'); await close(); });
  await step('visit card', async () => { await p.click('.content [data-a="go"]:has-text("VIS-000040")'); await W(1000); await shot('23-visit-card', true); await txt('23-visit-card'); });
  await step('resched', async () => { await p.click('[data-a="visitResched"]'); await modal('24-visit-resched'); await close(); });
  await step('cancel', async () => { await p.click('[data-a="visitCancel"]'); await modal('25-visit-cancel'); await close(); });

  /* 3. Специалист — телефон */
  await step('spec', async () => {
    await p.setViewportSize({ width: 390, height: 844 });
    await as('petrov'); await shot('30-spec-home'); await txt('30-spec-home');
    await nav('myvisits').catch(async () => { await p.click('[data-a="burger"]'); await W(); await nav('myvisits'); });
    await shot('31-spec-myvisits');
  });
  await step('spec start', async () => {
    await p.click('.content [data-a="go"]:has-text("Ресторан «Премьер»")'); await W(1000); await shot('32-spec-visit-assigned'); await txt('32-spec-visit-assigned');
    await p.click('[data-a="vStart"]'); await W(); if (await p.$('.overlay .modal')) await modal('33-spec-start-confirm'); await close();
  });
  await step('spec checklist', async () => {
    await p.evaluate(() => A.back && A.back()); await W(800);
    await p.evaluate(() => A.go(document.createElement('button'))).catch(() => { });
    await nav('myvisits').catch(() => { });
    await p.click('.content [data-a="go"]:has-text("Кафе «Вкусно»")'); await W(1200); await shot('34-spec-visit-inwork'); await txt('34-spec-visit-inwork');
    const un = await p.$$('.ck:not(:has(.seg button.on))');
    if (un.length) {
      const id = await un[0].getAttribute('id'); const q = '#' + id;
      await p.click(`${q} .seg button.NOK`); await W(700);
      await p.fill(`${q} textarea`, 'Нет антисептика у раковины горячего цеха'); await W(300);
      await p.$eval(q, e => e.scrollIntoView({ block: 'center' })); await W(300);
      await (await p.$(q)).screenshot({ path: `${OUT}/35-spec-ck-nok.png` });
      texts['35-spec-ck-nok'] = await p.innerText(q);
      await p.click(`${q} [data-a="ckSave"]`); await W(900);
      const fi = await p.$(`${q} input[type=file]`); if (fi) { await fi.setInputFiles(process.argv[3]); await W(1800); }
      await p.$eval(q, e => e.scrollIntoView({ block: 'center' })); await W(300);
      await (await p.$(q)).screenshot({ path: `${OUT}/36-spec-ck-photo.png` });
      texts['36-spec-ck-photo'] = await p.innerText(q);
    }
  });
  await step('spec waive', async () => { const w = await p.$('[data-a="ckWaive"]'); if (w) { await w.click(); await modal('38-spec-waive'); await close(); } });
  await step('spec sample', async () => { await p.click('.tabs [data-v="samples"]'); await W(800); await shot('39a-spec-samples-tab'); await p.click('[data-a="sampleNew"]'); await modal('39-spec-sample-new'); await close(); });
  await step('spec answer all', async () => { await p.click('.tabs [data-v="check"]').catch(() => { }); await W(800);
    for (let i = 0; i < 25; i++) { const un = await p.$$('.ck:not(:has(.seg button.on))'); if (!un.length) break; const id = await un[0].getAttribute('id'); await p.click(`#${id} .seg button.OK`); await W(350); }
    for (let i = 0; i < 10; i++) { const miss = await p.$$('.ck.miss input[type=file]'); if (!miss.length) break; await miss[0].setInputFiles(process.argv[3]); await W(1200); }
    await p.evaluate(() => window.scrollTo(0, 0)); await shot('40-spec-checklist-full', true);
  });
  await step('spec finish', async () => { await p.click('[data-a="vFinish"]'); await W(900); if (await p.$('.overlay .modal')) { await modal('41-spec-finish'); const okb = await p.$('.overlay [data-m="ok"]'); if (okb) await okb.click(); else await close(); } await W(900); await shot('42-spec-after-finish'); });
  await step('spec preview', async () => { const pv = await p.$('[data-a="vPreview"]'); if (pv) { await pv.click(); await W(1200); if (await p.$('.overlay .modal')) { await modal('43-spec-preview'); await close(); } } });
  await step('spec submit', async () => { await p.click('[data-a="vSubmit"]'); await modal('44-spec-submit'); await p.click('.overlay [data-m="ok"]'); await W(1000); await shot('45-spec-submitted'); });
  await step('spec tasks', async () => { await nav('tasks').catch(async () => { await p.click('[data-a="burger"]'); await W(); await nav('tasks'); }); await shot('46-spec-tasks'); });

  /* 4. Контролёр */
  await step('qc', async () => {
    await p.setViewportSize({ width: 1280, height: 800 });
    await as('qc'); await nav('review'); await shot('50-qc-review'); await txt('50-qc-review');
    await p.click('.content [data-a="go"]:has-text("Кафе «Вкусно»")').catch(async () => { await p.click('.content tr.click >> nth=0'); });
    await W(1200); await shot('51-qc-report'); await txt('51-qc-report');
  });
  await step('qc return', async () => { await p.click('[data-a="repReturn"]'); await modal('52-qc-return'); await close(); });
  await step('qc approve', async () => { await p.click('[data-a="repApprove"]'); await modal('53-qc-approve'); await close(); });

  /* 5. Лаборатория */
  await step('lab', async () => {
    await as('lab'); await nav('lab'); await shot('60-lab'); await txt('60-lab');
    await p.click('.content [data-a="go"] >> nth=0'); await W(1000); await shot('61-lab-sample', true); await txt('61-lab-sample');
  });
  await step('lab next', async () => { await p.click('[data-a="labNext"]'); await modal('62-lab-next'); await close(); });
  await step('lab inlab', async () => {
    await nav('lab'); await p.click('[data-a="labF"]:has-text("Отобраны")'); await W(); await p.click('.content [data-a="go"] >> nth=0'); await W(1000);
    await shot('63-lab-sample-inlab', true); await p.click('[data-a="labNext"]'); await modal('64-lab-result'); await close();
  });
  await step('lab review', async () => {
    await nav('lab'); await p.click('[data-a="labF"]:has-text("К рассмотрению")'); await W(); await p.click('.content [data-a="go"] >> nth=0'); await W(1000);
    await shot('65-lab-sample-review', true); const r = await p.$('[data-a="labReview"]'); if (r) { await r.click(); await modal('66-lab-review'); await close(); }
  });

  /* 6. Задачи */
  await step('tasks', async () => { await as('owner'); await nav('tasks'); await p.click('[data-a="vf"]:has-text("Все открытые")'); await W(); await shot('70-tasks'); });
  await step('taskNew', async () => { await p.click('[data-a="taskNew"]'); await modal('71-task-new'); await close(); });
  await step('task card', async () => { await p.click('.content [data-a="go"]:has-text("Устранить") >> nth=0'); await W(1000); await shot('72-task-card', true); await txt('72-task-card'); });
  await step('task specialist submit', async () => {
    await as('kuznetsov'); await nav('tasks'); await p.click('.content [data-a="go"]:has-text("Устранить") >> nth=0'); await W(1000);
    const s = await p.$('[data-a="taskStart"]'); if (s) { await s.click(); await W(900); const o = await p.$('.overlay [data-m="ok"]'); if (o) await o.click(); await W(900); }
    await shot('73-task-exec', true);
    const sb = await p.$('[data-a="taskSubmit"]'); if (sb) { await sb.click(); await modal('74-task-submit'); await close(); }
  });

  /* 7. Финансы */
  await step('fin', async () => { await as('finance'); await nav('finance'); await shot('80-fin-summary', true); await txt('80-fin-summary'); });
  const ops = [['Начисление', '81-fin-accrual'], ['Счёт', '82-fin-invoice'], ['Поступление', '83-fin-payment'], ['Расход', '84-fin-expense'], ['Корректировка', '85-fin-adjust']];
  for (const [t, n] of ops) await step(n, async () => { await p.click(`[data-a="finOp"]:has-text("${t}")`); await modal(n); await close(); });
  await step('fin invoices', async () => { await p.click('[data-a="vf"]:has-text("Счета")'); await W(); await shot('86-fin-invoices'); await txt('86-fin-invoices'); });
  await step('fin pay', async () => { const b2 = await p.$('[data-a="finPay"]'); if (b2) { await b2.click(); await modal('87-fin-pay'); await close(); } });
  await step('fin notaccrued', async () => { await p.click('[data-a="vf"]:has-text("Не начислено")'); await W(); await shot('88-fin-notaccrued'); });

  /* 8. Администрирование */
  await step('staff', async () => { await as('owner'); await nav('staff'); await shot('90-staff'); });
  await step('empNew', async () => { await p.click('[data-a="empNew"]'); await modal('91-emp-new'); await close(); });
  await step('settings params', async () => { await nav('settings'); await p.click('[data-a="vf"]:has-text("Параметры")'); await W(); await shot('92-settings-params'); await txt('92-settings-params'); });
  await step('settings checklists', async () => { await p.click('[data-a="vf"]:has-text("Чек-листы")'); await W(); await shot('93-settings-checklists'); });
  await step('settings services', async () => { await p.click('[data-a="vf"]:has-text("Услуги")'); await W(); await shot('94-settings-services'); });
  await step('settings errors', async () => { await p.click('[data-a="vf"]:has-text("Ошибки")'); await W(); await shot('95-settings-errors'); });
  await step('documents', async () => { await nav('documents'); await shot('96-documents'); });
  await step('analytics', async () => { await nav('analytics'); await shot('97-analytics', true); });
  await step('audit', async () => { await nav('audit'); await shot('98-audit'); });

  fs.writeFileSync(OUT + '/texts.json', JSON.stringify(texts, null, 1));
  console.log(log.join('\n'));
  await b.close();
})();
