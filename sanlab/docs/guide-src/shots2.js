/* San.Lab — снимки экранов для инструкции с разметкой (оранжевые рамки и номера). */
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2]; const PHOTO = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const URL = 'file:///home/user/Brave-haccp/sanlab/dist/demo/sanlab-demo-standalone.html';
const log = []; const miss = [];

(async () => {
  const b = await chromium.launch({ args: ['--lang=ru-RU'], env: { ...process.env, LANG: 'ru_RU.UTF-8', LANGUAGE: 'ru' }, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: 'ru-RU', timezoneId: 'Asia/Yekaterinburg' });
  const p = await ctx.newPage();
  p.on('pageerror', e => log.push('pageerror ' + e.message));
  p.setDefaultTimeout(6000);
  await p.goto(URL); await p.waitForSelector('[data-demo-user]', { timeout: 30000 });
  await p.addStyleTag({ content: '.demo-bar{display:none!important} *{caret-color:transparent!important}' });
  const W = ms => p.waitForTimeout(ms || 600);

  async function mark(name, list) {
    const boxes = [];
    for (const sel of list) {
      let bb = null;
      try { const l = p.locator(sel).first(); await l.waitFor({ state: 'visible', timeout: 2500 }); bb = await l.boundingBox(); } catch (e) { }
      if (!bb) miss.push(name + ': ' + sel);
      boxes.push(bb);
    }
    await p.evaluate(({ boxes }) => {
      const old = document.getElementById('mk'); if (old) old.remove();
      const sx = scrollX, sy = scrollY, vw = document.documentElement.clientWidth;
      const c = document.createElement('div'); c.id = 'mk';
      c.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
      boxes.forEach((bb, i) => {
        if (!bb) return;
        const r = document.createElement('div');
        r.style.cssText = `position:absolute;left:${bb.x + sx - 4}px;top:${bb.y + sy - 4}px;width:${bb.width + 8}px;height:${bb.height + 8}px;border:2.5px solid #F37021;border-radius:8px;box-sizing:border-box`;
        const n = document.createElement('div'); n.textContent = i + 1;
        const nx = Math.min(bb.x + sx + bb.width - 8, sx + vw - 26), ny = Math.max(bb.y + sy - 15, sy + 2);
        n.style.cssText = `position:absolute;left:${nx}px;top:${ny}px;width:22px;height:22px;border-radius:11px;background:#F37021;color:#fff;font:700 13px Inter,Arial,sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.35)`;
        c.append(r, n);
      });
      document.body.append(c);
    }, { boxes });
  }
  const unmark = () => p.evaluate(() => { const o = document.getElementById('mk'); if (o) o.remove(); });
  /* target: 'view' | 'full' | 'modal' | CSS-локатор элемента */
  async function shot(name, marks, target) {
    await W(350);
    if (marks && marks.length) await mark(name, marks);
    await W(150);
    const path = `${OUT}/${name}.png`;
    if (!target || target === 'view') await p.screenshot({ path });
    else if (target === 'full') await p.screenshot({ path, fullPage: true });
    else {
      const sel = target === 'modal' ? '.overlay .modal' : target;
      const el = p.locator(sel).first(); const bb = await el.boundingBox();
      const pad = 18; const vp = p.viewportSize();
      const clip = { x: Math.max(0, bb.x - pad), y: Math.max(0, bb.y - pad) };
      clip.width = Math.min(vp.width - clip.x, bb.width + pad * 2); clip.height = Math.min(vp.height - clip.y, bb.height + pad * 2);
      await p.screenshot({ path, clip });
    }
    await unmark();
  }
  const modalOpen = async () => { await p.waitForSelector('.overlay .modal', { timeout: 6000 }); await W(500); };
  const close = async () => { const c = await p.$('.overlay [data-m="close"]'); if (c) await c.click(); else await p.keyboard.press('Escape'); await W(400); };
  const step = async (name, fn) => { try { await fn(); log.push('ok ' + name); } catch (e) { log.push('FAIL ' + name + ': ' + e.message.split('\n')[0]); try { await unmark(); await close(); } catch (_) { } } };
  const as = async (u) => {
    await p.evaluate(() => { document.querySelectorAll('.overlay,.drop').forEach(o => o.remove()); });
    await p.evaluate(() => A.demoSwitch()); await p.waitForSelector('[data-demo-user]');
    await p.click(`[data-demo-user="${u}@sanlab.demo"]`); await W(1300);
  };
  const nav = async (k) => {
    const mobile = p.viewportSize().width < 800;
    const t = p.locator(`.tabbar [data-k="${k}"]`);
    if (mobile && await t.isVisible().catch(() => false)) await t.click();
    else if (!mobile) await p.click(`.side .nav button[data-k="${k}"]`);
    else await p.evaluate(k => { const bt = document.querySelector(`.nav button[data-k="${k}"]`); bt && bt.click(); }, k);
    await W(900); await p.evaluate(() => scrollTo(0, 0));
  };
  const top = () => p.evaluate(() => scrollTo(0, 0));
  const M = n => `.overlay [name="${n}"]`;
  const OK = '.overlay [data-m="ok"]';

  /* ===== 1. Вход и главный экран ===== */
  await step('login', async () => {
    await p.evaluate(() => pinLogin(document.getElementById('app'), { mode: 'PIN', company: 'San.Lab' }));
    await p.fill('[name=email]', 'petrov@sanlab.ru'); await p.fill('[name=pin]', '1234');
    await shot('a01-login', ['[name=email]', '[name=pin]', '[data-a=pinGo]']);
  });
  await step('home', async () => { await as('owner'); await shot('a02-home', ['.side .nav', '.search', '[data-a=bell]', '.kpis', '.content .card >> nth=0', '.me']); });
  await step('bell', async () => { await p.click('[data-a=bell]'); await W(700); await shot('a03-bell', ['.drop', '[data-a=readAll]']); await p.click('[data-a=bell]'); await W(); });
  await step('search', async () => { await p.fill('#gsearch', 'VIS-000040'); await W(500); await shot('a04-search', ['.search']); await p.fill('#gsearch', ''); await p.keyboard.press('Escape'); await W(); });

  /* ===== 2. Клиенты ===== */
  await step('clients', async () => { await nav('clients'); await shot('b01-clients', ['[data-a=clientNew]', '.content input >> nth=0', '.content label:has-text("архив")', '.content [data-a=go] >> nth=0']); });
  await step('clientNew', async () => {
    await p.click('[data-a=clientNew]'); await modalOpen();
    await p.fill(M('legal_name'), 'ООО «Пример»'); await p.fill(M('inn'), '5610000000');
    await shot('b02-client-new', [M('legal_name'), M('inn'), M('status'), M('contact_person'), M('manager_id'), OK], 'modal'); await close();
  });
  await step('client card', async () => {
    await p.click('.content [data-a="go"]:has-text("ООО «Вкусно»")'); await W(1000);
    await shot('b03-client-card', ['[data-a=clientEdit]', '[data-a=siteNew]', '[data-a=contractNew]', '[data-a=visitFromSite] >> nth=0', '.content .card:has-text("Расчёты")'], 'full');
  });
  await step('siteNew', async () => {
    await p.click('[data-a=siteNew]'); await modalOpen();
    await shot('b04-site-new', [M('site_name'), M('address'), M('contact_name'), M('service_frequency'), M('contract_id'), '.overlay .row:has([name=service_ids])', M('instructions')], 'modal'); await close();
  });
  await step('contractNew', async () => {
    await p.click('[data-a=contractNew]'); await modalOpen();
    await shot('b05-contract-new', [M('number'), M('status'), M('start_date'), M('end_date'), M('amount'), M('terms')], 'modal'); await close();
  });

  /* ===== 3. Выезды ===== */
  await step('visits', async () => {
    await nav('visits');
    await shot('c01-visits', ['.content .chips:has([data-k=view])', '.content .chips:has([data-k=period])', '.content [data-k=status]', '.content [data-k=employee_id]', '.content label:has([data-k=attention])', '[data-a=visitNew]', '.content tr:has-text("не начат вовремя") >> nth=0']);
  });
  await step('week', async () => { await p.click('.content [data-k=view][data-v=week], .content [data-k=view]:has-text("Неделя")'); await W(900); await shot('c02-visits-week', []); await p.click('.content [data-k=view]:has-text("Список")'); await W(800); });
  await step('visitNew', async () => {
    await p.click('[data-a=visitNew]'); await modalOpen();
    await shot('c03-visit-new', [M('client_id'), M('site_id'), M('service_id'), M('employee_id'), M('planned_start'), M('duration_hours'), M('instructions'), OK], 'modal'); await close();
  });
  await step('visit card', async () => {
    await p.click('.content [data-a="go"]:has-text("VIS-000040")'); await W(1000);
    await shot('c04-visit-card', ['.content .rec-head .pill >> nth=0', '[data-a=visitResched]', '[data-a=visitCancel]', '.content .tabs']);
  });
  await step('resched', async () => { await p.click('[data-a=visitResched]'); await modalOpen(); await shot('c05-resched', [M('planned_start'), M('employee_id'), M('reason'), OK], 'modal'); await close(); });
  await step('cancel', async () => { await p.click('[data-a=visitCancel]'); await modalOpen(); await shot('c06-cancel', [M('reason'), OK], 'modal'); await close(); });

  /* ===== 4–7. Специалист, телефон ===== */
  await step('spec home', async () => {
    await p.setViewportSize({ width: 390, height: 844 });
    await as('petrov'); await shot('d01-spec-home', ['.kpis', '.content .card:has-text("сегодня") >> nth=0', '.tabbar']);
  });
  await step('myvisits', async () => { await nav('myvisits'); await shot('d02-myvisits', ['.content .chips >> nth=0', '.content [data-a=go] >> nth=0']); });
  await step('assigned', async () => {
    await p.click('.content [data-a="go"]:has-text("Ресторан «Премьер»")'); await W(1100);
    await shot('d03-visit-assigned', ['.content .rec-head .pill >> nth=0', '[data-a=vStart]', '.content .tabs', '.content .alert >> nth=0']);
  });
  await step('info tab', async () => { await p.click('.tabs [data-v=info]'); await W(800); await shot('d03b-visit-info', ['.content .card:has-text("Контакт на объекте") >> nth=-1']); });
  await step('inwork', async () => {
    await nav('myvisits'); await p.click('.content [data-a="go"]:has-text("Кафе «Вкусно»")'); await W(1200); await top();
    await shot('d04-visit-inwork', ['[data-a=vFinish]', '.content .tabs', '.content .alert >> nth=0', '.ck >> nth=0']);
  });
  let ckId = null;
  await step('nok', async () => {
    const un = await p.$$('.ck:not(:has(.seg button.on))'); ckId = await un[0].getAttribute('id'); const q = '#' + ckId;
    await p.click(`${q} .seg button.NOK`); await W(700);
    await p.fill(`${q} textarea`, 'Нет антисептика у раковины горячего цеха'); await W(300);
    await p.$eval(q, e => e.scrollIntoView({ block: 'center' })); await W(300);
    await shot('d05-ck-nok', [`${q} .seg`, `${q} textarea`, `${q} select`, `${q} [data-a=ckSave]`, `${q} .saving`], q);
    await p.click(`${q} [data-a=ckSave]`); await W(900);
    const fi = await p.$(`${q} input[type=file]`); if (fi) { await fi.setInputFiles(PHOTO); await W(1800); }
    await p.$eval(q, e => e.scrollIntoView({ block: 'center' })); await W(300);
    await shot('d06-ck-photo', [`${q} .thumb >> nth=0`, `${q} label:has(input[type=file])`], q);
  });
  await step('ok item', async () => {
    const un = await p.$$('.ck:not(:has(.seg button.on))'); const id = await un[0].getAttribute('id'); const q = '#' + id;
    await p.click(`${q} .seg button.OK`); await W(700); await p.$eval(q, e => e.scrollIntoView({ block: 'center' })); await W(300);
    await shot('d07-ck-ok', [`${q} .seg button.OK`], q);
  });
  await step('samples tab', async () => {
    await top(); await p.click('.tabs [data-v=samples]'); await W(800);
    await shot('d08-samples-tab', ['.tabs [data-v=samples]', '[data-a=sampleNew]']);
  });
  await step('sample new', async () => {
    await p.click('[data-a=sampleNew]'); await modalOpen();
    await p.selectOption(M('sample_type'), 'Смыв').catch(() => { }); await p.fill(M('sample_point'), 'Руки повара, горячий цех');
    await shot('d09-sample-new', [M('sample_type'), M('sample_point'), M('label_code'), M('collected'), OK], 'modal');
    await p.click(OK); await W(1200);
    await shot('d10-sample-done', ['.content table tr >> nth=1, .content .li >> nth=0']);
  });
  await step('answer all', async () => {
    await p.click('.tabs [data-v=check]'); await W(800);
    for (let i = 0; i < 25; i++) { const un = await p.$$('.ck:not(:has(.seg button.on))'); if (!un.length) break; const id = await un[0].getAttribute('id'); await p.click(`#${id} .seg button.OK`); await W(350); }
    for (let i = 0; i < 10; i++) { const m = await p.$$('.ck.miss input[type=file]'); if (!m.length) break; await m[0].setInputFiles(PHOTO); await W(1300); }
  });
  await step('finish', async () => {
    await top(); await p.click('[data-a=vFinish]'); await W(900);
    if (await p.$('.overlay .modal')) { await shot('d11-finish-confirm', [OK], 'modal'); await p.click(OK).catch(() => close()); }
    await W(1000); await top();
    await shot('d12-after-finish', ['.content .rec-head .pill >> nth=0', '.actionbar [data-a=vSubmit]', '[data-a=vPreview]']);
  });
  await step('preview', async () => { await p.click('[data-a=vPreview]'); await W(1200); await modalOpen(); await shot('d13-preview', [], 'modal'); await close(); });
  await step('submit', async () => {
    await p.click('.actionbar [data-a=vSubmit]'); await modalOpen(); await shot('d14-submit', ['.overlay .alert >> nth=0', OK], 'modal');
    await p.click(OK); await W(1200); await top(); await shot('d15-submitted', ['.content .rec-head .pill >> nth=0', '.content .card:has-text("Версия 1") >> nth=-1']);
  });
  await step('spec tasks', async () => { await nav('tasks'); await shot('d16-spec-tasks', ['.content .chips >> nth=0', '.content [data-a=go] >> nth=0']); });

  /* ===== 8. Контролёр ===== */
  await step('qc list', async () => {
    await p.setViewportSize({ width: 1280, height: 800 });
    await as('qc'); await nav('review');
    await shot('e01-review', ['.content .chips >> nth=0', '.content tr.click:has-text("VIS-000039")', '.content th:has-text("Итог")']);
  });
  await step('qc report', async () => {
    await p.click('.content tr.click:has-text("VIS-000039")'); await W(1300); await top();
    await shot('e02-report', ['[data-a=repReturn]', '[data-a=repApprove]', '.content .ck:has(.seg button.NOK.on), .content .nok >> nth=0']);
  });
  await step('qc return', async () => { await p.click('[data-a=repReturn]'); await modalOpen(); await p.fill(M('comment'), 'Пункт 5: на фото не читается термометр. Переснимите и укажите температуру.'); await shot('e03-return', [M('comment'), M('due_date'), OK], 'modal'); await close(); });
  await step('qc approve', async () => { await p.click('[data-a=repApprove]'); await modalOpen(); await shot('e04-approve', ['.overlay .alert >> nth=0', M('comment'), OK], 'modal'); await close(); });

  /* ===== 9. Лаборатория ===== */
  await step('lab list', async () => { await as('lab'); await nav('lab'); await shot('f01-lab', ['.content .chips >> nth=0', '[data-a=labOver]', '.content input >> nth=0', '.content tr:has-text("просрочено") >> nth=0']); });
  await step('lab collected', async () => {
    await p.click('.content [data-a=labF]:has-text("Отобраны")'); await W(800);
    await p.click('.content [data-a=go] >> nth=0'); await W(1100); await top();
    await shot('f02-lab-sample', ['.content .steps', '[data-a=labNext]', '[data-a=labCancel]', '.content dl >> nth=0']);
    await p.click('[data-a=labNext]'); await modalOpen();
    await shot('f03-lab-sent', ['.overlay .modal input >> nth=0', '.overlay .modal input >> nth=1', OK], 'modal'); await close();
  });
  await step('lab result', async () => {
    await nav('lab'); await p.click('.content [data-a=labF]:has-text("В лаборатории")'); await W(800);
    await p.click('.content [data-a=go] >> nth=0'); await W(1100); await top();
    await shot('f04-lab-awaiting', ['.content .steps', '.content .alert >> nth=0', '[data-a=labNext]']);
    await p.click('[data-a=labNext]'); await modalOpen();
    await shot('f05-lab-result', [M('file'), M('protocol_no'), M('result_date'), M('result_summary'), OK], 'modal'); await close();
  });
  await step('lab review', async () => {
    await nav('lab'); await p.click('.content [data-a=labF]:has-text("К рассмотрению")'); await W(800);
    await p.click('.content [data-a=go] >> nth=0'); await W(1100); await top();
    await p.click('[data-a=labReview]'); await modalOpen();
    await shot('f06-lab-review', ['.overlay .alert >> nth=0', M('decision'), M('decision_comment'), M('task_responsible_id'), M('priority'), OK], 'modal'); await close();
  });

  /* ===== 10. Задачи ===== */
  await step('tasks', async () => { await as('owner'); await nav('tasks'); await p.click('.content [data-a=vf]:has-text("Все открытые")'); await W(800); await shot('g01-tasks', ['.content .chips >> nth=0', '[data-a=taskNew]', '.content th:has-text("Источник")', '.content tr:has-text("просроч") >> nth=0']); });
  await step('taskNew', async () => {
    await p.click('[data-a=taskNew]'); await modalOpen();
    await shot('g02-task-new', [M('title'), M('description'), M('responsible_id'), M('due_date'), M('priority'), M('source_type'), M('site_id'), M('verification_required'), OK], 'modal'); await close();
  });
  await step('task exec', async () => {
    await as('kuznetsov'); await nav('tasks'); await p.click('.content [data-a="go"]:has-text("Устранить") >> nth=0'); await W(1000);
    await shot('g03-task-new-card', ['.content .pill >> nth=0', '[data-a=taskStart]', '.content .alert >> nth=0']);
    await p.click('[data-a=taskStart]'); await W(900); const o = await p.$(OK); if (o) await o.click(); await W(900);
    await shot('g04-task-inwork', ['.content .pill >> nth=0', '[data-a=taskSubmit]']);
    await p.click('[data-a=taskSubmit]'); await modalOpen();
    await shot('g05-task-submit', ['.overlay .alert >> nth=0', M('evidence_comment'), M('file'), OK], 'modal'); await close();
  });
  await step('task verify', async () => {
    await as('owner'); await nav('tasks'); await p.click('.content [data-a=vf]:has-text("На проверку мне")'); await W(800);
    await p.click('.content [data-a=go] >> nth=0'); await W(1000);
    await shot('g06-task-verify', ['.content .card >> nth=0', '[data-a=taskVerify]', '[data-a=taskReject]', '[data-a=taskCancel]']);
  });

  /* ===== 11. Финансы ===== */
  await step('fin', async () => {
    await as('finance'); await nav('finance');
    await shot('h01-fin', ['.content .chips >> nth=0', '[data-a=finOp]:has-text("Начисление")', '[data-a=finOp]:has-text("Счёт")', '[data-a=finOp]:has-text("Поступление")', '[data-a=finOp]:has-text("Расход")', '[data-a=finOp]:has-text("Корректировка")', '.kpis']);
  });
  const fop = async (t, n, marks) => step(n, async () => { await p.click(`[data-a=finOp]:has-text("${t}")`); await modalOpen(); await shot(n, marks, 'modal'); await close(); });
  await fop('Начисление', 'h02-accrual', [M('client_id'), M('contract_id'), M('service_id'), M('amount'), M('operation_date'), M('basis'), OK]);
  await fop('Счёт', 'h03-invoice', [M('client_id'), M('amount'), M('invoice_no'), M('operation_date'), M('due_date'), M('basis'), M('file'), OK]);
  await fop('Поступление', 'h04-payment', [M('invoice_id'), M('client_id'), M('amount'), M('operation_date'), M('basis'), OK]);
  await fop('Расход', 'h05-expense', [M('category'), M('amount'), M('operation_date'), M('basis'), M('file')]);
  await fop('Корректировка', 'h06-adjust', [M('invoice_id'), M('client_id'), M('amount'), M('basis'), OK]);
  await step('invoices', async () => { await p.click('.content [data-a=vf]:has-text("Счета")'); await W(800); await shot('h07-invoices', ['.content input >> nth=0', '.content th:has-text("Остаток")', '[data-a=finPay] >> nth=0']); });
  await step('notaccrued', async () => { await p.click('.content [data-a=vf]:has-text("Не начислено")'); await W(800); await shot('h08-notaccrued', ['[data-a=finAccrueVisit] >> nth=0']); });
  await step('adjust approve', async () => { await as('owner'); await nav('finance'); await p.click('.content [data-a=vf]:has-text("Все операции")'); await W(800); await shot('h09-adjust-approve', ['[data-a=finAdjOk] >> nth=0', '[data-a=finAdjNo] >> nth=0']); });

  /* ===== 12–14. Администрирование ===== */
  await step('staff', async () => { await nav('staff'); await shot('i01-staff', ['[data-a=empNew]', '[data-a=empEdit] >> nth=0', '[data-a=empToggle] >> nth=0']); });
  await step('empNew', async () => { await p.click('[data-a=empNew]'); await modalOpen(); await shot('i02-emp-new', [M('full_name'), M('email'), M('phone'), M('role'), M('pin'), '.overlay .row:has([name=extra_perms])', OK], 'modal'); await close(); });
  await step('params', async () => { await nav('settings'); await p.click('.content [data-a=vf]:has-text("Параметры")'); await W(800); await shot('i03-params', ['.content .chips >> nth=0', 'text=AUTH_MODE', '[data-a=setSave]']); });
  await step('checklists', async () => { await p.click('.content [data-a=vf]:has-text("Чек-листы")'); await W(800); await shot('i04-checklists', ['.content [data-a=chkVersion]:has-text("Чек-лист")', '.content [data-a=chkVersion]:has-text("Новая версия") >> nth=0']); });
  await step('chkVersion', async () => { await p.click('.content [data-a=chkVersion]:has-text("Новая версия") >> nth=0'); await modalOpen(); await shot('i05-chk-version', ['.overlay .alert >> nth=0', M('name'), M('source'), '.overlay #ckrows .ck >> nth=0'], 'modal'); await close(); });
  await step('services', async () => { await p.click('.content [data-a=vf]:has-text("Услуги")'); await W(800); await shot('i06-services', ['[data-a=srvEdit] >> nth=0']); });
  await step('srvEdit', async () => { await p.click('[data-a=srvEdit] >> nth=0'); await modalOpen(); await shot('i07-srv-edit', [M('name'), M('price'), M('unit'), M('checklist_id'), M('requires_samples'), M('active')], 'modal'); await close(); });
  await step('errors', async () => { await p.click('.content [data-a=vf]:has-text("Ошибки")'); await W(800); await shot('i08-errors', ['[data-a=jobRun]', '[data-a=errOk] >> nth=0']); });
  await step('documents', async () => { await nav('documents'); await shot('i09-documents', ['.content select >> nth=0', '.content input[type=search], .content input >> nth=0', '.content label:has-text("неактуал")', '.content [data-a=openFile] >> nth=0']); });
  await step('analytics', async () => { await nav('analytics'); await shot('i10-analytics', ['[data-a=anPer] >> nth=0', '.content select >> nth=0', '[data-a=anCsv]', '.kpis']); });
  await step('audit', async () => { await nav('audit'); await shot('i11-audit', ['.content input >> nth=0', '.content tr >> nth=1']); });

  console.log(log.join('\n')); console.log('MISSING MARKS:\n' + miss.join('\n'));
  await b.close();
})();
