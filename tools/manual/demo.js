// Демо-данные стенда: всё — через настоящие действия API под нужными ролями.
const { seedBase } = require('./seed');
function seedDemo(opts) {
  const B = seedBase(), c = B.c, api = B.api, log = [];
  const step = (n, f) => { try { const r = f(); log.push('OK ' + n); return r; } catch (e) { log.push('ERR ' + n + ': ' + e.message); return null; } };
  // ТТК из архива (технолог)
  const arch = require('./assets/ttk_cards.json');
  const want = /^(Французская котлета|Сливочный ризотто П|Сырный ролл с каперсами П|Тар тар из лосося 165|Капрезе ди-Буфало)/;
  const cards = arch.cards.filter(x => want.test(x.name));
  step('импорт ТТК', () => { const p = api('ТЕХНОЛОГ_HACCP', 'PREVIEW_TTK_IMPORT', { cards, allNames: arch.names, refNames: ['Сливочный ризотто П/Ф', 'Сырный ролл с каперсами П/Ф'] });
    const rows = c.findRows_('TTK_IMPORT_ROWS', r => r.status !== 'SKIPPED').map(r => r.row_id);
    return api('ТЕХНОЛОГ_HACCP', 'CONFIRM_TTK_IMPORT_ROWS', { rowIds: rows }); });
  // Поставщики и цены
  const sup1 = step('поставщик 1', () => api('ДИРЕКТОР', 'CREATE_SUPPLIER', { 'название': 'ООО «Мясной двор»', 'контакты': '+7 900 000-00-01' }));
  const sup2 = step('поставщик 2', () => api('ДИРЕКТОР', 'CREATE_SUPPLIER', { 'название': 'ИП Овощи Тест', 'контакты': '+7 900 000-00-02' }));
  const prods = c.findRows_('PRODUCTS', p => p.organization_id === B.org);
  const price = { 'фарш': 520, 'говяд': 690, 'курин': 380, 'лосос': 1650, 'семг': 1650, 'сливк': 380, 'масло': 820, 'лук': 45, 'карто': 40, 'сыр': 950, 'рис': 160, 'яйц': 12, 'хлеб': 90, 'моцар': 1100, 'томат': 260, 'помид': 260 };
  prods.forEach(p => { const k = Object.keys(price).find(k => p['название'].toLowerCase().indexOf(k) >= 0); c.updateRow_('PRODUCTS', p, { 'текущая_цена': k ? price[k] : 300, 'поставщик_id': /лук|карто|томат|помид|зелен/i.test(p['название']) ? (sup2 && sup2.supplier_id) : (sup1 && sup1.supplier_id), 'мин_остаток': 2 }); });
  // Приход партий (кладовщик)
  const exp = d => new Date(Date.parse('2026-10-20') + d * 864e5).toISOString().slice(0, 10);
  const batches = [];
  prods.slice(0, 12).forEach((p, i) => step('приход ' + p['название'], () => { const r = api('КЛАДОВЩИК', 'RECEIVE_GOODS', { productId: p.product_id, qty: [5, 3, 2, 10, 4, 6][i % 6], price: Number(p['текущая_цена']) || 300, expiryDate: exp(i % 5 === 0 ? 1 : 4 + i), supplierId: p['поставщик_id'] }); batches.push(r); return r; }));

  // Свои продукты и блюда (шеф-повар)
  const np = (n, u, pr, sid) => step('продукт ' + n, () => api('ДИРЕКТОР', 'CREATE_PRODUCT', { 'название': n, 'единица': u, 'цена': pr, 'поставщик_id': sid, 'мин_остаток': 3, 'срок_хранения_дней': 3 }));
  const chick = np('Филе куриное охлаждённое', 'кг', 380, sup1 && sup1.supplier_id), beef = np('Говядина лопатка охлаждённая', 'кг', 690, sup1 && sup1.supplier_id),
    pot = np('Картофель', 'кг', 40, sup2 && sup2.supplier_id), beet = np('Свёкла', 'кг', 45, sup2 && sup2.supplier_id), cab = np('Капуста белокочанная', 'кг', 35, sup2 && sup2.supplier_id),
    rom = np('Салат Романо', 'кг', 520, sup2 && sup2.supplier_id), milk = np('Молоко 3,2 %', 'л', 90, sup1 && sup1.supplier_id);
  [chick, beef, pot, beet, cab, rom, milk].forEach((p, i) => p && step('приход ' + p['название'], () => batches.push(api('КЛАДОВЩИК', 'RECEIVE_GOODS', { productId: p.product_id, qty: [8, 6, 20, 10, 10, 2, 12][i], price: Number(p['закупочная_цена'] || p['текущая_цена']) || 100, expiryDate: exp([3, 4, 20, 25, 25, 2, 5][i]), supplierId: p['поставщик_id'] }))));
  const dish = (n, pr, lines) => step('блюдо ' + n, () => { const d = api('ШЕФ-ПОВАР', 'CREATE_DISH', { 'название': n, 'выход': 1, 'цена_продажи': pr });
    lines.forEach(([p, b, nt]) => p && api('ШЕФ-ПОВАР', 'ADD_RECIPE_LINE', { parentType: 'DISH', parentId: d.dish_id, ingredientId: p.product_id, 'брутто': b, 'нетто': nt, 'единица': 'кг', 'потериПроцент': Math.round((1 - nt / b) * 100) })); return d; });
  const borsch = dish('Борщ с говядиной', 390, [[beef, 0.08, 0.07], [beet, 0.06, 0.05], [cab, 0.05, 0.04], [pot, 0.05, 0.04]]);
  const caesar = dish('Цезарь с курицей', 520, [[chick, 0.1, 0.09], [rom, 0.06, 0.05]]);
  const pure = dish('Куриная котлета с пюре', 450, [[chick, 0.14, 0.13], [pot, 0.18, 0.15], [milk, 0.03, 0.03]]);
  // Производство (повар): задания в разных статусах
  const ws = c.findRows_('WORKSHOPS', w => w.location_id === B.loc);
  const hot = ws.find(w => /Горяч/.test(w['название'])), cold = ws.find(w => /Холод/.test(w['название']));
  const pt = (d, q, w) => d && step('задание ' + d['название'], () => api('ШЕФ-ПОВАР', 'CREATE_PRODUCTION_TASK', { parentType: 'DISH', parentId: d.dish_id, qty: q, workshopId: w && w.workshop_id }));
  const t1 = pt(borsch, 10, hot), t2 = pt(caesar, 6, cold), t3 = pt(pure, 8, hot);
  t1 && step('в работу', () => api('ПОВАР', 'ADVANCE_PRODUCTION', { productionId: t1.production_id, newStatus: 'в_работе' }));
  t3 && step('в работу 3', () => api('ПОВАР', 'ADVANCE_PRODUCTION', { productionId: t3.production_id, newStatus: 'в_работе' }));
  t3 && step('готово 3', () => api('ПОВАР', 'ADVANCE_PRODUCTION', { productionId: t3.production_id, newStatus: 'готово' }));
  // Списание
  pot && step('списание', () => api('ПОВАР', 'CREATE_WRITEOFF', { productId: pot.product_id, qty: 1.5, reasonId: 'Порча' }));
  // Задачи
  step('задача 1', () => api('ШЕФ-ПОВАР', 'CREATE_TASK', { type: 'cleaning', title: 'Генеральная уборка холодного цеха', description: 'По графику, средство по режиму дезинфекции', responsibleRole: 'ПОВАР' }));
  step('задача 2', () => api('ШЕФ-ПОВАР', 'CREATE_TASK', { type: 'maintenance', title: 'Заменить уплотнитель двери холодильника', responsibleRole: 'ШЕФ-ПОВАР' }));
  // Лаборатория
  step('лаб. расписание', () => api('ТЕХНОЛОГ_HACCP', 'CREATE_LAB_TEST_DEFINITION', { targetType: 'SURFACE', targetName: 'Смывы с рабочих поверхностей горячего цеха', testType: 'микробиология (БГКП)', periodDays: 90, sourceDocument: 'Программа производственного контроля', responsibleRole: 'ТЕХНОЛОГ_HACCP' }));
  step('лаб. результат', () => api('ЛАБОРАНТ', 'CREATE_LAB_TEST', { targetType: 'PRODUCT', targetName: 'Борщ с говядиной', testType: 'микробиология', lab: 'ФБУЗ «Центр гигиены» (тест)', protocol: '№ 125-Т', sampleDate: '2026-10-15', resultDate: '2026-10-18', result: 'pass', conclusion: 'Соответствует' }));
  // Нормативы
  chick && step('норматив', () => api('ТЕХНОЛОГ_HACCP', 'CREATE_RULE', { ruleType: 'температура_хранения', scopeType: 'product', scopeId: chick && chick.product_id, minValue: 0, maxValue: 4, unit: '°C', sourceDocument: 'Условия хранения изготовителя (пример)' }));
  // Декларация
  chick && step('декларация', () => api('ДИРЕКТОР', 'CREATE_DECLARATION', { productId: chick.product_id, supplierId: sup1 && sup1.supplier_id, registrationNumber: 'ЕАЭС N RU Д-RU.ТЕСТ.В.00001/26', documentType: 'Декларация соответствия', status: 'действует', issueDate: '2026-01-10', effectiveFrom: '2026-01-10', effectiveTo: '2027-01-09', manufacturer: 'ООО «Птицефабрика Тест»', technicalRegulation: 'ТР ТС 021/2011' }));
  // Продажи и расходы
  [borsch, caesar, pure].forEach((d, i) => d && step('продажа ' + d['название'], () => api('МЕНЕДЖЕР', 'CREATE_SALE', { dishId: d.dish_id, qty: [14, 9, 11][i], 'дата': '2026-10-19' })));
  step('расход', () => api('ДИРЕКТОР', 'CREATE_EXPENSE', { 'категория': 'Аренда', 'сумма': 120000, 'периодичность': 'ежемесячный', 'дата': '2026-10-01' }));
  // Банкет
  const ev = step('мероприятие', () => api('МЕНЕДЖЕР', 'CREATE_PLAN_MENU_EVENT', { 'название': 'Юбилей, зал «Лофт»', 'дата': '2026-10-24', 'время': '18:00', 'гостей': 25 }));
  ev && [borsch, caesar].forEach(d => d && step('позиция банкета', () => api('МЕНЕДЖЕР', 'ADD_PLAN_MENU_ITEM', { eventId: ev.event_id, dishId: d.dish_id, 'порцийНаГостя': 1 })));
  // Инвентаризация (кладовщик)
  const inv = step('инвентаризация', () => api('КЛАДОВЩИК', 'START_INVENTORY', {}));
  inv && pot && step('строка инв.', () => api('КЛАДОВЩИК', 'SUBMIT_INVENTORY_LINE', { inventoryId: inv.inventory_id, productId: pot.product_id, participok: 'Овощная кладовая', factQty: 17.5 }));
  inv && beet && step('строка инв. 2', () => api('КЛАДОВЩИК', 'SUBMIT_INVENTORY_LINE', { inventoryId: inv.inventory_id, productId: beet.product_id, participok: 'Овощная кладовая', factQty: 10 }));
  // Закупка
  rom && step('заявка', () => api('ДИРЕКТОР', 'CREATE_PURCHASE_REQUEST', { productId: rom.product_id, qty: 3 }));
  // Маркировка
  const bch = c.findRows_('BATCHES', b => chick && b.product_id === chick.product_id)[0];
  bch && step('этикетка', () => api('КЛАДОВЩИК', 'CREATE_LABEL_PRINT_JOB', { batchId: bch.batch_id, quantity: 2 }));

  // Мастер ППК (технолог): предприятие, помещения, оборудование, инвентарь, дезинфекция, журналы
  const T = (a, d) => api('ТЕХНОЛОГ_HACCP', a, d);
  step('ППК предприятие', () => T('SAVE_PPK_ENTERPRISE', { template_code: 'CAFE', format: 'европейская кухня', service_type: 'зал и банкеты', seats: 60, meals_per_day: 350, shifts: 2, work_hours: '10:00–23:00', staff_count: 14, area_m2: 420,
    water_source: 'централизованное, ООО «Водоканал» (тест)', sewage: 'централизованное', ventilation: 'приточно-вытяжная', waste_contractor: 'ООО «Эко Тест», договор № 12', pest_contractor: 'ООО «Дезсервис Тест», договор № 7', lab_contractor: 'ФБУЗ «Центр гигиены» (тест)', medical_org: 'Поликлиника № 1 (тест)',
    responsible: [{ role: 'Ответственный за производственный контроль', name: 'Технологова Тест', position: 'технолог', order: 'Приказ № 5 от 01.10.2026' }, { role: 'Руководитель рабочей группы ХАССП', name: 'Шефова Тест', position: 'шеф-повар', order: 'Приказ № 5 от 01.10.2026' }] }));
  const area = { 'Горячий цех': [24, 52], 'Холодный цех': [14, 34], 'Мясо-рыбный цех': [12, 30], 'Овощной цех': [9, 24], 'Моечная кухонной посуды': [8, 20], 'Моечная столовой посуды': [10, 24], 'Охлаждаемые камеры / холодильная кладовая': [10, 26], 'Кладовая сухих продуктов': [8, 22], 'Загрузочная / зона приёмки': [9, 24], 'Кладовая уборочного инвентаря и дезсредств': [3, 12], 'Помещение / площадка для отходов': [4, 0], 'Обеденный зал': [140, 0], 'Помещения для персонала (гардероб, комната приёма пищи)': [16, 0] };
  step('ППК помещения', () => { const pr = T('PROPOSE_PPK_PREMISES', {}); return T('SAVE_PPK_PREMISES', { premises: pr.map(x => ({ code: x.code, name: x.name, area_m2: area[x.name] ? area[x.name][0] : 10, walls_m2: area[x.name] ? area[x.name][1] : '' })) }); });
  const W = () => T('GET_PPK_WIZARD', {});
  step('ППК оборудование', () => W().premises.forEach(p => { const pr = T('PROPOSE_PPK_EQUIPMENT', { premiseId: p.premise_id }); if (pr.length) T('ADD_PPK_EQUIPMENT', { premiseId: p.premise_id, items: pr.filter(x => !x.existing).map(x => ({ kind_code: x.kind_code, qty: x.suggested, tmin: x.tmin, tmax: x.tmax })) }); }));
  step('ППК старое оборудование', () => { const w = W(), hotP = w.premises.find(p => p.name === 'Горячий цех'), coldP = w.premises.find(p => p.name === 'Холодный цех');
    w.equipment.filter(e => !e.premise_id).forEach(e => T('BIND_PPK_EQUIPMENT', { equipmentId: e.equipment_id, premiseId: /Фритюр/.test(e.name) ? hotP.premise_id : coldP.premise_id, kind_code: /Фритюр/.test(e.name) ? 'FRYER' : 'SLICER' })); });
  step('ППК поверка', () => W().equipment.filter(e => e.verify).forEach(e => T('UPDATE_PPK_EQUIPMENT', { equipmentId: e.equipment_id, patch: { 'следующая_проверка': '2027-03-01' } })));
  step('ППК инвентарь', () => W().premises.forEach(p => { const pr = T('PROPOSE_PPK_INVENTORY', { premiseId: p.premise_id }); if (pr.length) T('ADD_PPK_INVENTORY', { premiseId: p.premise_id, items: pr.map(x => ({ code: x.code, qty: 2 })) }); }));
  const dz = step('дезсредство', () => T('SAVE_PPK_DISINFECTANT', { name: 'Дезхлор-Т (пример)', form: 'LIQUID', active_substance: 'ЧАС', purpose: 'поверхности, инвентарь', concentration_pct: 0.5, rate_ml_m2: 100, exposure_min: 30, instruction_ref: 'Инструкция № 1/24 (пример)' }));
  const dzt = step('дезтаблетки', () => T('SAVE_PPK_DISINFECTANT', { name: 'Хлортаб-Т (пример)', form: 'TABLETS', active_substance: 'NaДХЦ', purpose: 'генеральная уборка', concentration_pct: 0.015, rate_ml_m2: 100, tablet_liters: 10, exposure_min: 60, instruction_ref: 'Инструкция № 5 (пример)' }));
  dz && step('режимы дезинфекции', () => W().premises.filter(p => p.production || /Моечн|камеры/.test(p.name)).forEach(p => { T('SAVE_PPK_DISINFECTION_PLAN', { premiseId: p.premise_id, regimen: 'CURRENT', disinfectantId: dz.disinfectant_id, times_per_month: 30 }); if (dzt) T('SAVE_PPK_DISINFECTION_PLAN', { premiseId: p.premise_id, regimen: 'GENERAL', disinfectantId: dzt.disinfectant_id, times_per_month: 4, include_walls: true }); }));
  step('журналы оборудования', () => T('CREATE_PPK_EQUIPMENT_JOURNALS', {}));
  step('модель ППК', () => T('GENERATE_PPK', {}));
  if (!opts || opts.ppkApproved !== false) step('ППК утверждена', () => {
    const m = T('GET_PPK_MODEL', {}), pid = m.ppk.ppk_id, pn = {}; m.processes.forEach(p => { pn[p.process_id] = p.process_code; });
    m.hazards.forEach(h => { const ccp = h.hazard_type === 'BIO' && pn[h.process_id] === 'THERMAL';
      T('CONFIRM_PPK_HAZARD', { hazardId: h.hazard_id, patch: { likelihood: ccp ? 3 : 1, severity: ccp ? 3 : 2, risk_score: ccp ? 9 : 2, control_measure: ccp ? 'Термообработка до температуры в толще по ТТК' : 'ПРП: санитарный режим, входной контроль, личная гигиена', classification: ccp ? 'ККТ' : 'PRP' } }); });
    T('GENERATE_PPK_CONTROLS', { ppkId: pid });
    const m2 = T('GET_PPK_MODEL', {});
    m2.controls.forEach(x => T('CONFIRM_PPK_CONTROL', { controlId: x.control_id, patch: x.point_type === 'ККТ' ? { monitoring_parameter: 't в толще изделия', monitoring_method: 'термометр-щуп', frequency: 'каждая партия', responsible_role: 'ПОВАР', corrective_action: 'Продолжить термообработку до предела, повторный замер' } : { monitoring_parameter: 'чек-лист ПРП', monitoring_method: 'визуально', frequency: 'ежедневно', responsible_role: 'ШЕФ-ПОВАР', corrective_action: 'Устранить, записать в журнал' } }));
    const ccpc = m2.controls.find(x => x.point_type === 'ККТ');
    if (ccpc) { const L = T('CREATE_PPK_CRITICAL_LIMIT', { ppkId: pid, controlId: ccpc.control_id, parameter: 't в толще, °C', minValue: 75, unit: '°C', sourceDocument: 'ТТК «Французская котлета», технология (пример)' }); T('APPROVE_PPK_CRITICAL_LIMIT', { limitId: L.limit_id }); }
    T('SUBMIT_PPK_VERSION_FOR_REVIEW', { ppkId: pid }); return api('ДИРЕКТОР', 'APPROVE_PPK_VERSION', { ppkId: pid }); });
  // Слоты журналов на сегодня и записи
  step('слоты журналов', () => c.generateJournalSlotsForLocation_(c.findOne_('LOCATIONS', 'location_id', B.loc)));
  const pend = c.findRows_('AUTO_JOURNAL_PENDING', r => r.location_id === B.loc && r.status !== 'выполнено');
  log.push('слотов ' + pend.length);
  const defs = {}; c.findRows_('JOURNAL_DEFINITIONS', () => true).forEach(d => { defs[d.definition_id] = d; });
  let n = 0, dev = 0;
  pend.forEach(r => { const d = defs[r.definition_id] || {}; if (n >= 6) return; const isNum = String(d['тип_ответа'] || 'ЧИСЛО') === 'ЧИСЛО';
    const v = isNum ? (d.journal_type === 'PPK_FRIDGE_TEMP' && !dev ? (dev = 1, 9) : 4) : 'ДА'; step('запись журнала ' + (d['название'] || r.journal_type) + ' = ' + v, () => api('ПОВАР', 'CONFIRM_AUTO_JOURNAL', { pendingId: r.pending_id, value: String(v) })); n++; });
  return { B, log, prods, batches, sup1, sup2, dishes: { borsch, caesar, pure }, prodx: { chick, beef, pot, beet, cab, rom, milk }, tasks: { t1, t2, t3 }, ev, inv, hot, cold };
}
module.exports = { seedDemo };
if (require.main === module) { const D = seedDemo(); console.log(D.log.join('\n')); console.log('продуктов', D.prods.length, 'блюд', D.B.c.findRows_('DISHES', () => true).length, 'ПФ', D.B.c.findRows_('SEMI_FINISHED', () => true).length, 'партий', D.B.c.findRows_('BATCHES', () => true).length); console.log(JSON.stringify(D.batches[0]).slice(0, 400)); }
