/**
 * San.Lab — Seed.gs
 * Справочники (чек-листы, услуги) и демонстрационные данные.
 * Данные создаются через те же сервисы, что и в работе, — значит проходят все проверки и пишутся в аудит.
 * В рабочей среде запускайте только Seed.reference(); Seed.demo() — для тестовой копии.
 */

var SEED_PDF_B64 = 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAxMzkgPj4Kc3RyZWFtCkJUIC9GMSAxNCBUZiA2MCA3NjAgVGQgKExBQk9SQVRPUlkgVEVTVCBSRVBPUlQgLSBERU1PKSBUaiAwIC0yNCBUZCAvRjEgMTAgVGYgKFNhbi5MYWIgZGVtbyBwcm90b2NvbC4gTm90IGEgcmVhbCBsYWJvcmF0b3J5IGRvY3VtZW50LikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDA0MzEgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo1MDEKJSVFT0YK';
var SEED_JPG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDsaKKK0IP/2Q==';

var Seed = {
  rng: function (seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  },

  ctx: function (emp, now) { return { now: now, requestId: 'seed', actorId: emp.employee_id, actorEmail: emp.email, user: emp }; },

  /* Локальное время Оренбурга (UTC+5) → ISO */
  at: function (base, dayOffset, hh, mm) {
    var k = localDayKey(base).split('-');
    return new Date(Date.UTC(Number(k[0]), Number(k[1]) - 1, Number(k[2]) + dayOffset, hh, mm || 0) - TZ_OFFSET_MIN * 60000).toISOString();
  },

  photo: function (label, i) { return Integr.demoPhoto ? Integr.demoPhoto(label, i) : SEED_JPG_B64; },

  CHECKLISTS: [
    { key: 'plan', name: 'Плановый санитарный осмотр', source: 'СанПиН 2.3/2.4.3590-20, СП 2.3.6.3668-20 (критерии утверждаются ответственным специалистом)', items: [
      ['Помещения и оборудование', 'Чистота производственных помещений и оборудования', 'NORMAL', true],
      ['Помещения и оборудование', 'Целостность покрытий стен, пола и потолка', 'NORMAL', false],
      ['Помещения и оборудование', 'Работа приточно-вытяжной вентиляции', 'NORMAL', false],
      ['Помещения и оборудование', 'Раковины для мытья рук: мыло, антисептик, одноразовые полотенца', 'HIGH', false],
      ['Температурный режим', 'Температура в холодильном оборудовании +2…+6 °C', 'CRITICAL', true],
      ['Температурный режим', 'Морозильное оборудование не выше −18 °C', 'HIGH', true],
      ['Температурный режим', 'Журнал учёта температурного режима ведётся', 'NORMAL', false],
      ['Хранение сырья', 'Товарное соседство сырья и готовой продукции соблюдается', 'CRITICAL', true],
      ['Хранение сырья', 'Сроки годности сырья не нарушены', 'CRITICAL', true],
      ['Хранение сырья', 'Маркировка полуфабрикатов: дата, время изготовления, срок', 'HIGH', true],
      ['Персонал', 'Санитарная одежда персонала чистая, волосы убраны', 'NORMAL', false],
      ['Персонал', 'Личные медицинские книжки с действующими отметками', 'HIGH', false],
      ['Персонал', 'Журнал здоровья ведётся ежедневно', 'HIGH', false],
      ['Дезинфекция и отходы', 'Дезсредства промаркированы, рабочие растворы с датой приготовления', 'HIGH', false],
      ['Дезинфекция и отходы', 'Отходы удаляются своевременно, контейнеры с крышками', 'NORMAL', false],
      ['Дезинфекция и отходы', 'Нет признаков присутствия грызунов и насекомых', 'CRITICAL', true]
    ] },
    { key: 'lab', name: 'Отбор проб (смывы, вода)', source: 'Программа производственного контроля объекта', items: [
      ['Подготовка', 'Точки отбора определены программой производственного контроля', 'NORMAL', false],
      ['Отбор', 'Смывы с рук персонала отобраны', 'NORMAL', true],
      ['Отбор', 'Смывы с оборудования и инвентаря отобраны', 'NORMAL', true],
      ['Отбор', 'Проба воды отобрана из точки водоразбора', 'NORMAL', true],
      ['Транспортировка', 'Пробы промаркированы, условия транспортировки соблюдены', 'HIGH', true],
      ['Документы', 'Акт отбора проб подписан представителем объекта', 'HIGH', true]
    ] },
    { key: 'haccp', name: 'Аудит ХАССП и ППК', source: 'ТР ТС 021/2011 ст. 10, ГОСТ Р 51705.1-2024', items: [
      ['Документация', 'Программа производственного контроля утверждена и актуальна', 'HIGH', false],
      ['Документация', 'Критические контрольные точки определены', 'HIGH', false],
      ['Мониторинг', 'Мониторинг ККТ ведётся и документируется', 'CRITICAL', true],
      ['Мониторинг', 'Корректирующие действия по отклонениям ККТ зафиксированы', 'HIGH', false],
      ['Прослеживаемость', 'Входной контроль сырья, документы поставщиков в наличии', 'HIGH', true],
      ['Персонал', 'Обучение персонала по ХАССП подтверждено', 'NORMAL', false],
      ['Санитария', 'Графики уборки и дезинфекции выполняются', 'NORMAL', false],
      ['Верификация', 'Верификация плана ХАССП проводится по графику', 'NORMAL', false]
    ] }
  ],

  /* Справочники для рабочей среды */
  reference: function (ownerEmp) {
    var ctx = Seed.ctx(ownerEmp, Integr.now());
    var ids = {};
    if (Store.all('Checklists').length) {
      Store.all('Checklists').forEach(function (c) { if (V.bool(c.active)) { Seed.CHECKLISTS.forEach(function (d) { if (d.name === c.name) ids[d.key] = c.checklist_id; }); } });
    } else {
      Seed.CHECKLISTS.forEach(function (d) {
        var r = Checklists.saveVersion(ctx, { name: d.name, source: d.source, items: d.items.map(function (i) { return { section: i[0], text: i[1], severity: i[2], photo_required: i[3] }; }) });
        ids[d.key] = r.checklist.checklist_id;
      });
    }
    var srv = {};
    if (!Store.all('Services').length) {
      srv.plan = Services.save(ctx, { name: 'Плановый санитарный осмотр', price: 6500, unit: 'выезд', checklist_id: ids.plan, description: 'Осмотр объекта по чек-листу, фотофиксация, отчёт' }).service_id;
      srv.lab = Services.save(ctx, { name: 'Отбор проб на лабораторные исследования', price: 4800, unit: 'выезд', checklist_id: ids.lab, requires_samples: true, description: 'Смывы, вода, продукция по программе ПК' }).service_id;
      srv.haccp = Services.save(ctx, { name: 'Аудит ХАССП и ППК', price: 18000, unit: 'выезд', checklist_id: ids.haccp, description: 'Проверка системы ХАССП и производственного контроля' }).service_id;
      srv.unplanned = Services.save(ctx, { name: 'Внеплановая проверка', price: 8000, unit: 'выезд', checklist_id: ids.plan, description: 'Проверка по жалобе или запросу клиента' }).service_id;
      srv.sub = Services.save(ctx, { name: 'Санитарное сопровождение (абонемент)', price: 25000, unit: 'месяц', checklist_id: ids.plan, description: 'Ежемесячное сопровождение, документы и консультации' }).service_id;
    } else {
      Store.all('Services').forEach(function (s) { if (/Плановый/.test(s.name)) srv.plan = s.service_id; if (/проб/.test(s.name)) srv.lab = s.service_id; if (/ХАССП/.test(s.name)) srv.haccp = s.service_id; if (/Внеплан/.test(s.name)) srv.unplanned = s.service_id; if (/абонемент/.test(s.name)) srv.sub = s.service_id; });
    }
    return { checklists: ids, services: srv };
  },

  EMPLOYEES: [
    ['Иванов Андрей Александрович', 'owner@sanlab.demo', 'OWNER', '+7 922 500-10-01'],
    ['Соколова Марина Игоревна', 'coord@sanlab.demo', 'COORDINATOR', '+7 922 500-10-02'],
    ['Петров Алексей Сергеевич', 'petrov@sanlab.demo', 'SPECIALIST', '+7 922 500-10-03'],
    ['Иванова Светлана Андреевна', 'ivanova@sanlab.demo', 'SPECIALIST', '+7 922 500-10-04'],
    ['Кузнецов Дмитрий Викторович', 'kuznetsov@sanlab.demo', 'SPECIALIST', '+7 922 500-10-05'],
    ['Смирнова Ольга Владимировна', 'qc@sanlab.demo', 'QC', '+7 922 500-10-06'],
    ['Белова Наталья Петровна', 'finance@sanlab.demo', 'FINANCE', '+7 922 500-10-07'],
    ['Орлов Илья Романович', 'lab@sanlab.demo', 'LAB', '+7 922 500-10-08']
  ],

  CLIENTS: [
    { name: 'ООО «Вкусно»', inn: '5610123456', person: 'Гаврилова Елена', phone: '+7 3532 40-11-22', sites: [['Кафе «Вкусно»', 'Оренбург, ул. Советская, 27', 'Администратор Ирина', 'Вход со двора, пропуск у охраны']] },
    { name: 'ООО «Премьер Групп»', inn: '5612034567', person: 'Ахметов Рустам', phone: '+7 3532 44-55-66', sites: [['Ресторан «Премьер»', 'Оренбург, пр. Победы, 114', 'Шеф-повар Тимур', 'Осмотр до 12:00, после — банкеты'], ['Банкетный зал «Премьер-Холл»', 'Оренбург, ул. Чкалова, 53', 'Управляющая Анна', '']] },
    { name: 'МАУ «Комбинат питания»', inn: '5609087654', person: 'Дронова Татьяна', phone: '+7 3532 31-20-20', sites: [['Столовая «Здоровье»', 'Оренбург, ул. Терешковой, 10', 'Заведующая производством', 'Санитарный день — пятница']] },
    { name: 'ИП Арутюнян Г. С.', inn: '561100223344', person: 'Арутюнян Гор', phone: '+7 987 100-20-30', sites: [['Кафе «Уют»', 'Оренбург, ул. Володарского, 20', 'Гор', '']] },
    { name: 'ООО «Аромат»', inn: '5638011223', person: 'Лебедева Ксения', phone: '+7 3532 99-88-77', sites: [['Ресторан «Аромат»', 'Оренбург, ул. Ленинская, 45', 'Су-шеф Павел', 'Парковка с ул. Кирова']] },
    { name: 'ООО «Колос»', inn: '5603045678', person: 'Мельников Сергей', phone: '+7 3532 70-70-10', sites: [['Пекарня «Колос»', 'Оренбург, ул. Салмышская, 34/2', 'Технолог Валентина', 'Цех работает с 5:00']] }
  ],

  /* Демонстрационный набор: ~70 дней истории + текущее состояние на сегодня */
  demo: function (opts) {
    opts = opts || {};
    var histDays = opts.historyDays || 68;
    var base = Integr.now();
    var rnd = Seed.rng(20261020);
    var A = function (d, h, m) { return Seed.at(base, d, h, m); };
    var sys = { now: A(-80, 9), requestId: 'seed', actorId: 'SYSTEM', actorEmail: 'system', user: { role: 'OWNER', employee_id: 'SYSTEM' } };
    var E = {};
    Seed.EMPLOYEES.forEach(function (e, i) {
      var r = Repo.create(sys, 'Employees', { full_name: e[0], email: e[1], role: e[2], phone: e[3], active: true, pin_hash: Integr.hash(e[1] + ':1234') });
      E[['owner', 'coord', 'petrov', 'ivanova', 'kuz', 'qc', 'fin', 'lab'][i]] = r;
    });
    var C = function (key, d, h, m) { return Seed.ctx(E[key], A(d, h || 10, m || 0)); };
    var ref = Seed.reference(E.owner);
    var srv = ref.services;

    var clients = [], sites = [], contracts = {};
    Seed.CLIENTS.forEach(function (c, i) {
      var ctx = C('coord', -78 + i, 11);
      var cl = Clients.save(ctx, { legal_name: c.name, inn: c.inn, contact_person: c.person, contact_phone: c.phone, manager_id: E.coord.employee_id });
      clients.push(cl);
      var con = Contracts.save(ctx, { client_id: cl.client_id, number: (12 + i) + '/2026-СС', start_date: A(-75, 9), end_date: A(290, 9), amount: 25000 * 12, terms: 'Санитарное сопровождение, ежемесячно; лабораторные исследования по программе ПК', status: 'ACTIVE' });
      contracts[cl.client_id] = con.contract_id;
      c.sites.forEach(function (s) {
        sites.push(Sites.save(ctx, { client_id: cl.client_id, site_name: s[0], address: s[1], contact_name: s[2], instructions: s[3], contract_id: con.contract_id, service_frequency: '2 раза в месяц', service_ids: [srv.plan, srv.lab, srv.haccp].join(',') }));
      });
    });

    var specs = ['petrov', 'ivanova', 'kuz'];
    var made = [];
    var photoN = 0;

    /* Полный цикл выезда до нужной стадии */
    function runVisit(o) {
      var site = sites[o.site], empKey = o.emp;
      var startH = o.h, startM = o.m || 0;
      var cc = C('coord', o.d - 3, 9, 30);
      var res = Visits.create(cc, { site_id: site.site_id, service_id: o.service, employee_id: E[empKey].employee_id, planned_start: A(o.d, startH, startM), duration_hours: o.service === srv.haccp ? 3 : 2, instructions: o.instr || '', force: true });
      var v = res.visit;
      made.push(v);
      if (o.stage === 'ASSIGNED') return v;
      if (o.stage === 'RESCHEDULED') { Visits.reschedule(C('coord', o.d - 1, 17), { visit_id: v.visit_id, planned_start: A(o.d + 1, startH, startM), reason: o.reason || 'Перенос по просьбе клиента', force: true }); return v; }
      var lateMin = Math.floor(rnd() * 30) - 5;
      var sc = C(empKey, o.d, startH, startM + lateMin);
      Visits.start(sc, { visit_id: v.visit_id });
      var items = Checklists.items(v.checklist_id);
      var nItems = o.stage === 'IN_PROGRESS' ? Math.floor(items.length / 2) : items.length;
      for (var i = 0; i < nItems; i++) {
        var it = items[i];
        var roll = rnd();
        var result = 'OK', comment = '';
        if (o.nok && o.nok.indexOf(i) >= 0) { result = 'NOK'; }
        else if (!o.clean && roll < 0.08) { result = 'NOK'; }
        else if (roll > 0.97 && it.severity !== 'CRITICAL') { result = 'NA'; comment = 'Оборудование не используется, выведено из эксплуатации'; }
        if (result === 'NOK') comment = Seed.nokText(it.text, rnd);
        var ic = Seed.ctx(E[empKey], isoAddHours(sc.now, 0.1 + i * 0.05));
        Results.save(ic, { visit_id: v.visit_id, check_item_id: it.check_item_id, result: result, comment: comment });
        if (V.bool(it.photo_required) && result !== 'NA') {
          photoN++;
          Files.upload(ic, { entity_type: 'Visits', entity_id: v.visit_id, document_type: 'PHOTO', check_item_id: it.check_item_id, file_name: 'IMG_' + (4000 + photoN) + '.jpg', mime_type: 'image/jpeg', data_base64: Seed.photo(it.text, photoN) });
        }
      }
      if (o.service === srv.lab && o.stage !== 'IN_PROGRESS') {
        var types = [['Смыв', 'Руки повара, горячий цех'], ['Смыв', 'Разделочная доска «СМ»'], ['Вода', 'Кран, моечная']];
        o.samples = [];
        for (var k = 0; k < (o.nSamples || 2); k++) {
          var smp = Lab.register(Seed.ctx(E[empKey], isoAddHours(sc.now, 1)), { visit_id: v.visit_id, sample_type: types[k][0], sample_point: types[k][1], label_code: v.visit_id.replace('VIS-', 'M') + '-' + (k + 1), collected_at: isoAddHours(sc.now, 1) });
          o.samples.push(smp);
        }
      }
      if (o.stage === 'IN_PROGRESS') return v;
      var fc = Seed.ctx(E[empKey], isoAddHours(sc.now, 1.2 + rnd()));
      Visits.finish(fc, { visit_id: v.visit_id });
      if (o.stage === 'AWAITING_REPORT') return v;
      var subc = Seed.ctx(E[empKey], isoAddHours(fc.now, 1 + rnd() * 2));
      var rep = Reports.submit(subc, { visit_id: v.visit_id }).report;
      if (o.stage === 'IN_REVIEW') return v;
      var qc = Seed.ctx(E.qc, isoAddHours(subc.now, 18 + rnd() * 10));
      if (o.ret) {
        Reports['return'](qc, { report_id: rep.report_id, comment: o.retText || 'Пункт «Температура в холодильном оборудовании»: на фото не читается показание термометра. Переснимите крупно и укажите фактическую температуру в комментарии.' });
        if (o.stage === 'RETURNED') return v;
        var fx = Seed.ctx(E[empKey], isoAddHours(qc.now, 3));
        var r0 = Repo.where('VisitResults', function (r) { return r.visit_id === v.visit_id; })[0];
        Results.save(fx, { visit_id: v.visit_id, check_item_id: r0.check_item_id, result: r0.result, comment: (r0.comment ? r0.comment + '. ' : '') + 'Показание термометра +4 °C, фото заменено' });
        rep = Reports.submit(Seed.ctx(E[empKey], isoAddHours(fx.now, 0.5)), { visit_id: v.visit_id }).report;
        qc = Seed.ctx(E.qc, isoAddHours(fx.now, 20));
      }
      Reports.approve(qc, { report_id: rep.report_id });
      return v;
    }

    /* История */
    var plan = [];
    for (var d = -histDays; d <= -4; d += 2) {
      var siteIdx = Math.floor(rnd() * sites.length);
      var r = rnd();
      var service = r < 0.62 ? srv.plan : r < 0.85 ? srv.lab : srv.haccp;
      plan.push({ d: d, h: 9 + Math.floor(rnd() * 7), m: rnd() < 0.5 ? 0 : 30, site: siteIdx, service: service, emp: specs[Math.floor(rnd() * 3)], stage: 'APPROVED', ret: rnd() < 0.18 });
    }
    plan.forEach(function (o) { runVisit(o); });

    /* Состояние «сейчас» */
    var cur = [
      { d: -3, h: 10, site: 4, service: srv.plan, emp: 'kuz', stage: 'RETURNED', ret: true, nok: [4], retText: 'Пункт «Температура в холодильном оборудовании +2…+6 °C»: не указана фактическая температура и не видно термометра на фото. Уточните показание и приложите читаемое фото.' },
      { d: -2, h: 11, site: 2, service: srv.haccp, emp: 'petrov', stage: 'IN_REVIEW', nok: [2] },
      { d: -2, h: 15, site: 6, service: srv.plan, emp: 'ivanova', stage: 'AWAITING_REPORT', clean: true },
      { d: -1, h: 10, m: 30, site: 5, service: srv.lab, emp: 'kuz', stage: 'IN_REVIEW', clean: true, nSamples: 3 },
      { d: 0, h: 9, m: 30, site: 3, service: srv.lab, emp: 'ivanova', stage: 'IN_REVIEW', clean: true, nSamples: 2 },
      { d: 0, h: 10, site: 0, service: srv.plan, emp: 'petrov', stage: 'IN_PROGRESS', clean: true },
      { d: 0, h: 11, m: 30, site: 4, service: srv.unplanned, emp: 'kuz', stage: 'ASSIGNED', instr: 'Жалоба посетителя на температуру блюд. Проверить раздачу и холодильники.' },
      { d: 0, h: 14, site: 1, service: srv.haccp, emp: 'petrov', stage: 'ASSIGNED' },
      { d: 0, h: 16, m: 30, site: 6, service: srv.lab, emp: 'ivanova', stage: 'ASSIGNED' },
      { d: 1, h: 10, site: 2, service: srv.plan, emp: 'kuz', stage: 'ASSIGNED' },
      { d: 1, h: 13, site: 3, service: srv.plan, emp: 'petrov', stage: 'RESCHEDULED', reason: 'Санитарный день на объекте, перенос по просьбе заведующей' },
      { d: 2, h: 9, site: 0, service: srv.lab, emp: 'ivanova', stage: 'ASSIGNED' },
      { d: 2, h: 15, site: 5, service: srv.plan, emp: 'petrov', stage: 'ASSIGNED' },
      { d: 3, h: 10, m: 30, site: 1, service: srv.plan, emp: 'kuz', stage: 'ASSIGNED' },
      { d: 4, h: 11, site: 4, service: srv.haccp, emp: 'ivanova', stage: 'ASSIGNED' },
      { d: 6, h: 10, site: 6, service: srv.plan, emp: 'petrov', stage: 'ASSIGNED' }
    ];
    cur.forEach(function (o, i) {
      if (i === 13 && Integr.failNextCalendar) Integr.failNextCalendar();
      runVisit(o);
    });

    /* Лаборатория: провести пробы прошлых выездов по циклу */
    var allSamples = sortBy(Store.all('LabSamples'), 'created_at');
    var hist = filterBy(allSamples, function (s) { return (new Date(base) - new Date(s.collected_at)) / DAY_MS >= 5; });
    var stopAwaiting = {}, stopResult = {};
    if (hist.length > 3) { stopAwaiting[hist[hist.length - 1].sample_id] = true; stopResult[hist[hist.length - 2].sample_id] = true; stopResult[hist[hist.length - 3].sample_id] = true; }
    allSamples.forEach(function (s, i) {
      var t0 = s.collected_at;
      var age = (new Date(base) - new Date(t0)) / DAY_MS;
      var lc = function (h) { return Seed.ctx(E.lab, isoAddHours(t0, h)); };
      if (age < 0.4) return;
      Lab.advance(lc(3), { sample_id: s.sample_id, to: 'SENT', lab_name: 'ИЛЦ ФБУЗ «Центр гигиены и эпидемиологии»', sent_at: isoAddHours(t0, 3) });
      if (age < 1.2) return;
      Lab.advance(lc(20), { sample_id: s.sample_id, to: 'ACCEPTED', accepted_at: isoAddHours(t0, 20), lab_order_no: 'З-' + (3100 + i) });
      Lab.advance(lc(21), { sample_id: s.sample_id, to: 'AWAITING', responsible_id: E.lab.employee_id, result_due_at: isoAddDays(t0, s.sample_type === 'Вода' ? 5 : 3) });
      if (age < 5 || stopAwaiting[s.sample_id]) return;
      var rc = lc(24 * (s.sample_type === 'Вода' ? 4.5 : 2.8));
      var doc = Files.upload(rc, { entity_type: 'LabSamples', entity_id: s.sample_id, document_type: 'LAB_PROTOCOL', file_name: 'protocol.pdf', mime_type: 'application/pdf', data_base64: SEED_PDF_B64, document_no: 'П-' + (5200 + i) });
      var bad = i % 7 === 3;
      Lab.advance(rc, { sample_id: s.sample_id, to: 'RESULT', result_date: rc.now, protocol_no: 'П-' + (5200 + i), result_file_id: doc.document_id, result_summary: s.sample_type === 'Вода' ? 'ОМЧ, ОКБ, E. coli — в пределах нормативов' : (bad ? 'Обнаружены БГКП' : 'БГКП не обнаружены') });
      if (stopResult[s.sample_id]) return;
      Lab.review(Seed.ctx(E.qc, isoAddHours(rc.now, 6)), { sample_id: s.sample_id, decision: bad ? 'NONCOMPLIANT' : 'COMPLIANT', decision_comment: bad ? 'БГКП в смыве — провести внеочередную дезинфекцию инвентаря, повторный отбор через 7 дней' : '' });
    });

    /* Корректирующие задачи: большинство старых выполнено и проверено */
    Store.all('Tasks').forEach(function (t, i) {
      if (t.source_type !== 'CHECKLIST' && t.source_type !== 'LAB') return;
      var age = (new Date(base) - new Date(t.created_at)) / DAY_MS;
      if (age < 5) return;
      var resp = Repo.get('Employees', t.responsible_id);
      var tc = Seed.ctx(resp, isoAddHours(t.created_at, 30));
      Tasks.start(tc, { task_id: t.task_id });
      var ev = Files.upload(tc, { entity_type: 'Tasks', entity_id: t.task_id, document_type: 'EVIDENCE', file_name: 'fix.jpg', mime_type: 'image/jpeg', data_base64: Seed.photo('Устранено', i + 500) });
      Tasks.submit(tc, { task_id: t.task_id, evidence_comment: 'Нарушение устранено, объект подтвердил. Фото приложено.', evidence_file_id: ev.document_id });
      if (age < 9 && i % 2 === 0) return;
      Tasks.verify(Seed.ctx(E.qc, isoAddHours(t.created_at, 52)), { task_id: t.task_id, comment: 'Проверено по фото и при повторном визите' });
    });
    Tasks.create(C('coord', -12, 12), { title: 'Продлить договор и согласовать график на I квартал', description: 'Клиент просит перейти на еженедельные осмотры', responsible_id: E.coord.employee_id, site_id: sites[6].site_id, priority: 'NORMAL', due_date: A(-2, 18), source_type: 'CLIENT' });
    Tasks.create(C('owner', -1, 9), { title: 'Обновить чек-лист плановой проверки под новую форму ППК', description: 'Учесть пункты по маркировке и прослеживаемости', responsible_id: E.qc.employee_id, priority: 'NORMAL', due_date: A(5, 18) });
    Tasks.create(C('owner', -6, 9), { title: 'Сверить поступления по ООО «Премьер Групп» с банком', responsible_id: E.fin.employee_id, priority: 'HIGH', due_date: A(-1, 18) });

    /* Финансы: начисления по утверждённым выездам, счета раз в месяц, оплаты, расходы */
    var services = indexBy(Store.all('Services'), 'service_id');
    var approved = filterBy(Store.all('Visits'), function (v) { return v.status === 'APPROVED' || v.status === 'CLOSED'; });
    approved.forEach(function (v, i) {
      if (i % 9 === 4) return;
      var when = isoAddDays(v.actual_end, 1);
      if (isBefore(base, when)) return;
      Finance.accrue(Seed.ctx(E.fin, when), { client_id: v.client_id, contract_id: contracts[v.client_id], visit_id: v.visit_id, amount: services[v.service_id].price, operation_date: when, basis: 'Выезд ' + v.visit_id + ', ' + services[v.service_id].name });
    });
    for (var mBack = 2; mBack >= 0; mBack--) {
      clients.forEach(function (cl, ci) {
        if (ci > 3) return;
        var day = -mBack * 30 - 3;
        Finance.accrue(Seed.ctx(E.fin, A(day, 10)), { client_id: cl.client_id, contract_id: contracts[cl.client_id], service_id: srv.sub, amount: 25000, operation_date: A(day, 10), force: true, basis: 'Абонентское сопровождение, договор ' + (12 + ci) + '/2026-СС' });
      });
    }
    var accr = groupBy(filterBy(Store.all('Finance'), function (f) { return f.operation_type === 'ACCRUAL'; }), 'client_id');
    clients.forEach(function (cl, ci) {
      var list = sortBy(accr[cl.client_id] || [], 'operation_date');
      var byMonth = {};
      list.forEach(function (f) { var m = String(f.operation_date).slice(0, 7); (byMonth[m] = byMonth[m] || []).push(f); });
      Object.keys(byMonth).sort().forEach(function (m, mi, arr) {
        var sum = sumBy(byMonth[m], 'amount');
        var last = byMonth[m][byMonth[m].length - 1].operation_date;
        var invDate = isoAddDays(last, 2);
        if (isBefore(base, invDate)) return;
        var inv = Finance.invoice(Seed.ctx(E.fin, invDate), { client_id: cl.client_id, contract_id: contracts[cl.client_id], amount: sum, operation_date: invDate, due_date: isoAddDays(invDate, 10), basis: 'Услуги санитарного сопровождения за ' + m });
        var isLast = mi === arr.length - 1;
        var payDate = isLast && ci !== 1 && ci !== 4 ? isoAddHours(invDate, 20) : isoAddDays(invDate, 4 + ci);
        if (isBefore(base, payDate)) return;
        if (isLast && (ci === 1 || ci === 4)) return;
        if (isLast && ci === 2) { Finance.payment(Seed.ctx(E.fin, payDate), { invoice_id: inv.finance_id, amount: Math.round(sum * 0.4), operation_date: payDate, basis: 'Частичная оплата, п/п ' + (700 + ci) }); return; }
        if (mi === 0 && ci === 1) { Finance.payment(Seed.ctx(E.fin, payDate), { invoice_id: inv.finance_id, amount: Math.round(sum / 2), operation_date: payDate, basis: 'п/п ' + (600 + ci) }); Finance.payment(Seed.ctx(E.fin, isoAddDays(payDate, 6)), { invoice_id: inv.finance_id, amount: sum - Math.round(sum / 2), operation_date: isoAddDays(payDate, 6), basis: 'п/п ' + (640 + ci) }); return; }
        Finance.payment(Seed.ctx(E.fin, payDate), { invoice_id: inv.finance_id, amount: sum, operation_date: payDate, basis: 'п/п ' + (500 + ci * 10 + mi) });
      });
    });
    [[-62, 'Лаборатория', 38400, 'Счёт ИЛЦ за исследования'], [-58, 'Аренда', 35000, 'Аренда офиса'], [-55, 'Транспорт', 14200, 'ГСМ, служебные авто'], [-50, 'Расходные материалы', 7800, 'Тампоны, пробирки, термоконтейнеры'],
      [-31, 'Лаборатория', 41200, 'Счёт ИЛЦ за исследования'], [-28, 'Аренда', 35000, 'Аренда офиса'], [-25, 'Транспорт', 15600, 'ГСМ, служебные авто'], [-22, 'Связь и ПО', 4900, 'Связь, Google Workspace'],
      [-6, 'Лаборатория', 29800, 'Счёт ИЛЦ за исследования'], [-3, 'Аренда', 35000, 'Аренда офиса'], [-2, 'Транспорт', 9100, 'ГСМ, служебные авто']].forEach(function (x) {
      Finance.expense(Seed.ctx(E.fin, A(x[0], 12)), { category: x[1], amount: x[2], operation_date: A(x[0], 12), basis: x[3] });
    });
    var someInv = filterBy(Store.all('Finance'), function (f) { return f.operation_type === 'INVOICE'; })[2];
    if (someInv) Finance.adjust(Seed.ctx(E.fin, A(-1, 15)), { invoice_id: someInv.finance_id, amount: -1500, operation_date: A(-1, 15), basis: 'Скидка за перенос выезда по вине исполнителя (письмо клиента от ' + fmtD(A(-2, 9)) + ')' });

    /* Уведомления прошлых дней считаем прочитанными и отправленными */
    var cutoff = A(-1, 0);
    Store.all('Notifications').forEach(function (n) { if (isBefore(n.created_at, cutoff)) Store.update('Notifications', n.notification_id, { read_at: n.created_at, status: 'SENT', sent_at: n.created_at, attempts: 1 }); });
    return { employees: E, visits: made.length };
  },

  nokText: function (text, rnd) {
    var map = [
      [/Температура в холод/, ['В холодильнике №2 (молочная продукция) +9 °C', 'Холодильная камера мясного цеха +8 °C, термометр не поверен']],
      [/Морозильное/, ['Морозильный ларь −12 °C, наледь на стенках']],
      [/Товарное соседство/, ['Сырое мясо хранится на одной полке с готовыми салатами', 'Яйцо в коробах рядом с готовой выпечкой']],
      [/Сроки годности/, ['Сметана с истёкшим сроком (2 уп.) не изъята', 'Полуфабрикаты без даты изготовления в морозильнике']],
      [/Маркировка/, ['Гастроёмкости без маркировки времени приготовления']],
      [/грызунов/, ['Следы грызунов в складском помещении, нет контейнеров с приманкой']],
      [/Раковины/, ['Нет антисептика у раковины горячего цеха']],
      [/медицинские книжки/, ['У 2 сотрудников просрочена отметка о профосмотре']],
      [/Дезсредства/, ['Рабочий раствор без даты приготовления']],
      [/ККТ/, ['Журнал мониторинга ККТ не заполнялся 3 дня']]
    ];
    for (var i = 0; i < map.length; i++) if (map[i][0].test(text)) return map[i][1][Math.floor(rnd() * map[i][1].length)];
    return 'Выявлено несоответствие, требуется устранение';
  }
};
