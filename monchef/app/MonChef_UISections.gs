/**
 * MON CHEF — разделы меню по ТЗ §43 (дополнение к MonChef_UI.gs):
 * Закупки, Санитария, Персонал, Лаборатория, Оборудование, Документы, Проверка.
 * Как и остальные разделы, ничего не считают сами и не вводят — только показывают
 * данные существующих модулей и ведут в их экраны.
 */
UI_SECTIONS = ['home', 'banquets', 'menu', 'planning', 'production', 'stock', 'revisions', 'deficits', 'surplus',
  'procurement', 'issue', 'haccp', 'sanitation', 'personnel', 'lab', 'equipment', 'documents', 'reports', 'inspection', 'settings', 'picking'];

var _UI_ORDER_ST_ = { draft: 'Черновик', sent: 'Отправлен', confirmed: 'Подтверждён', received: 'Принят', partial: 'Частично принят', cancelled: 'Отменён' };
var _UI_SUP_ST_ = { ACTIVE: 'Действует', REVIEW: 'На проверке', BLOCKED: 'Заблокирован' };

_UI_BUILDERS_.procurement = function (token) {
  var orders = _uiArr_(_uiTry_(function () { return getSupplierOrders(''); }, '[]'));
  var sups = _uiTry_(function () { return _mdSuppliers_(); }, []);
  var open = orders.filter(function (o) { return o.status !== 'received' && o.status !== 'cancelled'; });
  return {
    title: 'Закупки', subtitle: 'Заказы поставщикам и реестр поставщиков. Закупка под конкретный банкет — в карточке банкета.',
    kpis: [{ label: 'Заказов в работе', value: open.length, tone: open.length ? 'gold' : '', go: { sec: 'procurement', tab: 0 } },
      { label: 'Черновиков', value: orders.filter(function (o) { return o.status === 'draft'; }).length, go: { sec: 'procurement', tab: 0, q: 'Черновик' } },
      { label: 'Поставщиков', value: sups.length, go: { sec: 'procurement', tab: 1 } },
      { label: 'На проверке', value: sups.filter(function (s) { return s.status === 'REVIEW'; }).length, tone: 'gold', go: { sec: 'procurement', tab: 1, q: 'На проверке' } }],
    tabs: [
      { title: 'Заказы поставщикам', columns: [_uiCol_('id', '№'), _uiCol_('date', 'Создан'), _uiCol_('supplier', 'Поставщик'), _uiCol_('items', 'Позиций', 'num'), _uiCol_('total', 'Сумма, ₽', 'num'), _uiCol_('due', 'Срок'), _uiCol_('status', 'Статус', 'status'), _uiCol_('comment', 'Комментарий')],
        rows: orders.map(function (o) { return { id: o.id, date: o.date, supplier: o.supplier || '—', items: (o.items || []).length, total: o.total, due: _uiDate_(o.dueDate ? new Date(o.dueDate) : null), status: _UI_ORDER_ST_[o.status] || o.status, comment: o.comment || '' }; }) },
      { title: 'Поставщики', columns: [_uiCol_('name', 'Поставщик'), _uiCol_('inn', 'ИНН'), _uiCol_('cat', 'Категории'), _uiCol_('docs', 'Документы'), _uiCol_('status', 'Статус', 'status')],
        rows: sups.map(function (s) { return { name: s.name, inn: s.inn || '—', cat: s.categories || '', docs: s.documents || '', status: _UI_SUP_ST_[s.status] || s.status }; }) }
    ],
    actions: [{ label: '+ Заказ поставщику', module: 'orders' }, { label: '+ Приход', module: 'income' }, { label: 'Партия: QR, сроки, места', module: 'batch' }, { label: 'Обработка сырья: дефрост, зачистка, разбор', module: 'processing' }, { label: 'Закупка и приёмка', module: 'procurement' }, { label: 'Поставщики', module: 'suppliers' }, { label: 'Документы, ВСД, маркировка', module: 'supplydocs' }, { label: 'Контроль партий', module: 'batchcontrol' }]
  };
};

_UI_BUILDERS_.sanitation = function (token) {
  var master = _uiSheetRows_('Дезсредства_V41', 300), regs = _uiSheetRows_('Дезсредства_Режимы_V41', 500), facts = _uiSheetRows_('Дезсредства_Факты_V41', 200);
  var tasks = _uiSheetRows_('Санитария_Задачи_V43', 300), env = _uiTry_(_envState_, { pests: { events: [], plans: [] }, waste: { records: [] } });
  var nameOf = {}; master.forEach(function (m) { nameOf[m.DisinfectantID] = m.ProductName; });
  var openT = tasks.filter(function (t) { return t.Status !== 'DONE' && t.Status !== 'CANCELLED'; });
  var appr = { APPROVED: 'Утверждено', PENDING: 'Ждёт утверждения', REJECTED: 'Отклонено', DRAFT: 'Черновик' };
  return {
    title: 'Санитария', subtitle: 'Дезсредства только по утверждённому режиму; вредители и отходы — с документами.',
    kpis: [{ label: 'Задач уборки открыто', value: openT.length, tone: openT.length ? 'gold' : 'green', go: { sec: 'sanitation', tab: 0 } },
      { label: 'Средств утверждено', value: master.filter(function (m) { return m.ApprovalStatus === 'APPROVED'; }).length + ' из ' + master.length, go: { sec: 'sanitation', tab: 1 } },
      { label: 'Контролей растворов', value: facts.length, go: { sec: 'sanitation', tab: 2 } },
      { label: 'Отходы не вывезены', value: (env.waste.records || []).filter(function (x) { return x.status !== 'ВЫВЕЗЕНО'; }).length, tone: env.waste.overdue ? 'red' : '', go: { sec: 'sanitation', tab: 4 } }],
    tabs: [
      { title: 'Задачи уборки', columns: [_uiCol_('due', 'Срок'), _uiCol_('area', 'Зона'), _uiCol_('who', 'Исполнитель'), _uiCol_('status', 'Статус', 'status')],
        rows: tasks.map(function (t) { return { due: t.DueAt, area: t.AreaID, who: t.AssignedTo || '', status: _uiStatusRu_(t.Status) }; }) },
      { title: 'Дезсредства и режимы', columns: [_uiCol_('name', 'Средство'), _uiCol_('conc', 'Концентрация'), _uiCol_('exp', 'Экспозиция'), _uiCol_('scope', 'Объект'), _uiCol_('status', 'Режим', 'status')],
        rows: regs.map(function (r) { return { name: nameOf[r.DisinfectantID] || r.DisinfectantID, conc: r.ConcentrationRaw, exp: r.ExposureRaw, scope: r.ObjectScope, status: appr[r.ApprovalStatus] || r.ApprovalStatus || 'Ждёт утверждения' }; }) },
      { title: 'Контроль растворов', columns: [_uiCol_('date', 'Дата'), _uiCol_('obj', 'Объект'), _uiCol_('value', 'Значение'), _uiCol_('status', 'Результат', 'status')],
        rows: facts.map(function (f) { return { date: f.DateTime, obj: f.RelatedArea || f.ObjectID, value: f.Value + ' ' + (f.Unit || ''), status: f.Result === 'PASS' ? 'Норма' : f.Result === 'FAIL' ? 'Отклонение' : f.Result }; }) },
      { title: 'Вредители', columns: [_uiCol_('date', 'Дата'), _uiCol_('type', 'Мероприятие'), _uiCol_('zone', 'Зона'), _uiCol_('act', 'Акт'), _uiCol_('status', 'Результат', 'status')],
        rows: (env.pests.events || []).map(function (e) { return { date: e.date, type: e.type, zone: e.zone, act: e.act, status: e.result }; }) },
      { title: 'Отходы', columns: [_uiCol_('date', 'Накоплено'), _uiCol_('type', 'Вид'), _uiCol_('place', 'Место'), _uiCol_('doc', 'Документ вывоза'), _uiCol_('status', 'Статус', 'status')],
        rows: (env.waste.records || []).map(function (w) { return { date: w.at || '', type: w.type || '', place: [w.area, w.container].filter(Boolean).join(' · '), doc: w.document || '', status: w.overdue ? 'Просрочен вывоз' : w.status === 'ВЫВЕЗЕНО' ? 'Вывезено' : 'Накоплено' }; }) }
    ],
    actions: [{ label: '✓ Чек-листы: выполнить', module: 'checklistrun' }, { label: 'Санитария и чек-листы', module: 'sanitationauto' }, { label: 'Дезсредства', module: 'disinfectants' }, { label: 'Вода, отходы, вредители', module: 'environment' }]
  };
};

_UI_BUILDERS_.personnel = function (token, opts, s) {
  var emp = _uiArr_(_uiTry_(function () { return getEmployeesFull(token); }, '[]')).filter(function (e) { return e.active !== false; });
  var tr = _uiArr_(_uiTry_(function () { return getTrainings(token); }, null));
  var foodRoles = typeof MC_FOOD_ROLES_ !== 'undefined' ? MC_FOOD_ROLES_ : [];
  var adm = { ADMITTED: 'Допущен', LIMITED: 'Ограничен', BLOCKED: 'Не допущен', EXPIRED: 'Просрочено' };
  var perm = (s && s.permissions) || {}, canMed = perm.all === true || perm.medical === true || perm.personnel === true;
  var rows = emp.map(function (e) {
    var food = foodRoles.indexOf(String(e.role || '').trim()) >= 0, a = food && canMed ? _uiTry_(function () { return _mcAdmissionByName_(e.fullName); }, null) : null;
    return { name: String(e.fullName || '').replace(/\s+/g, ' ').trim(), position: String(e.position || '').trim(), role: e.role || '', food: food ? 'да' : '', status: !food ? 'Не требуется' : !canMed ? '—' : a ? (adm[a.status] || a.status) : '—' };
  });
  var bad = rows.filter(function (r) { return /Не допущен|Просрочено|Ограничен/.test(r.status); }).length;
  return {
    title: 'Персонал', subtitle: 'Медицинский допуск проверяется при каждой записи в журналы, HACCP, бракераж, производство и склад.',
    kpis: [{ label: 'Сотрудников', value: rows.length, go: { sec: 'personnel', tab: 0 } }, { label: 'С пищевой ролью', value: rows.filter(function (r) { return r.food; }).length },
      { label: 'Без допуска', value: canMed ? bad : '—', tone: bad ? 'red' : 'green', go: { sec: 'personnel', tab: 0, q: 'допущен' } },
      { label: 'Обучение просрочено', value: tr.filter(function (t) { return t.просрочено; }).length, tone: 'gold', go: { sec: 'personnel', tab: 1, q: 'Просрочено' } }],
    tabs: [
      { title: 'Сотрудники и допуск', columns: [_uiCol_('name', 'ФИО'), _uiCol_('position', 'Должность'), _uiCol_('role', 'Роль'), _uiCol_('food', 'Пищевая роль'), _uiCol_('status', 'Медицинский допуск', 'status')], rows: rows },
      { title: 'Обучение', columns: [_uiCol_('who', 'Сотрудник'), _uiCol_('kind', 'Вид'), _uiCol_('topic', 'Тема'), _uiCol_('date', 'Дата'), _uiCol_('till', 'Действует до'), _uiCol_('status', 'Статус', 'status')],
        rows: tr.map(function (t) { return { who: t.сотрудник, kind: t.вид, topic: t.тема, date: t.дата, till: t.действуетДо, status: t.просрочено ? 'Просрочено' : 'Действует' }; }) }
    ],
    actions: [{ label: 'Сотрудники и обучение', module: 'staff' }, { label: 'Медкнижки', fn: 'openMedSec' }]
  };
};

_UI_BUILDERS_.lab = function (token) {
  var plans = _uiArr_(_uiTry_(function () { return getLabPlans(token); }, null)), tests = _uiArr_(_uiTry_(function () { return getLabTests(200, token); }, null));
  var bad = tests.filter(function (t) { return /не соответ/i.test(String(t.результат || '')); });
  return {
    title: 'Лаборатория', subtitle: 'План лабораторного контроля и протоколы. Результат вносится один раз; «не соответствует» открывает отклонение.',
    kpis: [{ label: 'Позиций плана', value: plans.length, go: { sec: 'lab', tab: 0 } }, { label: 'Исследований', value: tests.length, go: { sec: 'lab', tab: 1 } },
      { label: 'Ждут результата', value: tests.filter(function (t) { return !t.результат; }).length, tone: 'gold', go: { sec: 'lab', tab: 1 } },
      { label: 'Не соответствует', value: bad.length, tone: bad.length ? 'red' : 'green', go: { sec: 'lab', tab: 1, q: 'не соответ' } }],
    tabs: [
      { title: 'План контроля', columns: [_uiCol_('obj', 'Объект'), _uiCol_('kind', 'Показатель'), _uiCol_('period', 'Периодичность'), _uiCol_('norm', 'Норматив'), _uiCol_('lab', 'Лаборатория'), _uiCol_('who', 'Ответственный')],
        rows: plans.map(function (p) { return { obj: p.объект, kind: p.вид, period: p.периодичность, norm: p.норматив, lab: p.лаборатория, who: p.ответственный }; }) },
      { title: 'Исследования', columns: [_uiCol_('date', 'Отбор'), _uiCol_('obj', 'Объект'), _uiCol_('kind', 'Показатель'), _uiCol_('prot', 'Протокол'), _uiCol_('status', 'Результат', 'status')],
        rows: tests.map(function (t) { return { date: t.датаОтбора, obj: t.объект, kind: t.вид, prot: t.протокол || '', status: t.результат || 'Ждёт результата' }; }) }
    ],
    actions: [{ label: 'План и исследования', module: 'labs' }]
  };
};

_UI_BUILDERS_.equipment = function () {
  var eq = _uiTry_(_mcEqList_, []), now = Date.now();
  var rows = eq.map(function (e) {
    var left = e.measuring ? e.daysLeft : null;
    return { name: e.name || e.id, model: [e.model, e.serial].filter(Boolean).join(' · '), place: e.location || '', meas: e.measuring ? 'да' : '', till: e.measuring ? (e.nextCalibration || 'не указана') : '—',
      left: left === null || left === undefined ? '' : left < 0 ? 'просрочено ' + (-left) + ' дн.' : 'через ' + left + ' дн.',
      status: e.effective === 'BLOCKED' ? (e.reason ? 'Нельзя: ' + e.reason : 'Нельзя использовать') : e.measuring && left !== null && left <= 30 ? 'Поверка истекает' : e.effective === 'ACTIVE' ? 'Действует' : _uiStatusRu_(e.effective) };
  });
  return {
    title: 'Оборудование', subtitle: 'Измерение прибором с истёкшей поверкой не принимается — в ККТ, журналах, приёмке и пробах.',
    kpis: [{ label: 'Приборов и оборудования', value: rows.length, go: { sec: 'equipment', tab: 0 } },
      { label: 'Нельзя использовать', value: rows.filter(function (r) { return /^Нельзя/.test(r.status); }).length, tone: 'red', go: { sec: 'equipment', tab: 0, q: 'Нельзя' } },
      { label: 'Истекает за 30 дней', value: rows.filter(function (r) { return /истекает/.test(r.status); }).length, tone: 'gold', go: { sec: 'equipment', tab: 0, q: 'истекает' } }],
    tabs: [{ title: 'Реестр', columns: [_uiCol_('name', 'Наименование'), _uiCol_('model', 'Модель / №'), _uiCol_('place', 'Место'), _uiCol_('meas', 'Средство измерения'), _uiCol_('till', 'Поверка до'), _uiCol_('left', 'Срок'), _uiCol_('status', 'Статус', 'status')], rows: rows }],
    actions: [{ label: 'Приборы и поверка', module: 'equipment' }, { label: 'Температуры', module: 'temperatures' }]
  };
};

_UI_BUILDERS_.documents = function (token) {
  var docs = _uiArr_(_uiTry_(function () { return getDocuments('', token); }, null));
  var corr = _uiArr_(_uiTry_(function () { return getJournalCorrections('', token); }, null));
  var sdd = _uiTry_(function () { var j = JSON.parse(mcGetSupplyDocs(token)); return j.data || null; }, null) || { docs: [], batches: [] };
  return {
    title: 'Документы', subtitle: 'Документы предприятия, сроки действия и исправления журналов.',
    kpis: [{ label: 'Документов', value: docs.length, go: { sec: 'documents', tab: 0 } }, { label: 'Просрочено', value: docs.filter(function (d) { return d.просрочен; }).length, tone: 'red', go: { sec: 'documents', tab: 0, q: 'Просрочен' } },
      { label: 'Документы на сырьё', value: sdd.docs.length, go: { sec: 'documents', tab: 1 } },
      { label: 'Без погашенного ВСД', value: sdd.batches.filter(function (b) { return b.vet && b.vetStatus !== 'ПОГАШЕН' && b.status === 'active'; }).length, tone: 'red', go: { sec: 'documents', tab: 1 } },
      { label: 'Исправлений ждут', value: corr.filter(function (c) { return c.status === 'OPEN'; }).length, tone: 'gold', go: { sec: 'documents', tab: 2, q: 'На согласовании' } }],
    tabs: [
      { title: 'Документы', columns: [_uiCol_('cat', 'Категория'), _uiCol_('name', 'Название'), _uiCol_('num', '№'), _uiCol_('date', 'Дата'), _uiCol_('till', 'Действует до'), _uiCol_('status', 'Статус', 'status')],
        rows: docs.map(function (d) { return { cat: d.категория, name: d.название, num: d.номер, date: d.дата, till: d.действуетДо || '—', status: d.просрочен ? 'Просрочен' : 'Действует' }; }) },
      { title: 'Документы на сырьё', columns: [_uiCol_('type', 'Тип'), _uiCol_('num', '№'), _uiCol_('date', 'Дата'), _uiCol_('till', 'Действует до'), _uiCol_('sup', 'Поставщик'), _uiCol_('prod', 'Продукт / партия'), _uiCol_('status', 'Статус', 'status')],
        rows: sdd.docs.map(function (d) { return { type: d['Тип'], num: d['Номер'], date: d['Дата'], till: d['Действует до'] || '—', sup: d['Поставщик'] || '', prod: [d['Продукт'], d.BatchID].filter(Boolean).join(' · '), status: d.expired ? 'Просрочен' : d['Проверил'] ? 'Проверен' : 'Не проверен' }; }) },
      { title: 'Исправления журналов', columns: [_uiCol_('journal', 'Журнал'), _uiCol_('row', 'Строка', 'num'), _uiCol_('reason', 'Причина'), _uiCol_('who', 'Запросил'), _uiCol_('status', 'Статус', 'status')],
        rows: corr.map(function (c) { return { journal: c.journalName, row: c.rowNumber, reason: c.reason, who: c.createdByName, status: c.status === 'OPEN' ? 'На согласовании' : c.status === 'APPROVED' ? 'Утверждено' : 'Отклонено' }; }) }
    ],
    actions: [{ label: 'Документы предприятия', module: 'docs' }, { label: 'Документы на сырьё и ВСД', module: 'supplydocs' }, { label: 'Исправления журналов', module: 'corrections' }]
  };
};

_UI_BUILDERS_.inspection = function (token, opts, s) {
  var r = _uiTry_(_mcReadinessCached_, null) || { items: [], counts: {}, overall: '' };
  var st = { PASS: 'Выполнено', FAIL: 'Не выполнено', REVIEW: 'На проверке', MISSING_EVIDENCE: 'Нет доказательств', NOT_APPLICABLE: 'Не применимо' };
  var sess = _uiArr_(_uiTry_(function () { return listAuditSessions(token); }, null));
  var overallRu = { READY: 'ГОТОВО', READY_WITH_WARNINGS: 'ГОТОВО С ЗАМЕЧАНИЯМИ', NOT_READY: 'НЕ ГОТОВО' };
  return {
    title: 'Проверка', subtitle: 'Готовность по внутреннему контрольному листу. Это не заключение Роспотребнадзора.',
    kpis: [{ label: 'Итог', value: overallRu[r.overall] || r.overall || '—', tone: r.overall === 'READY' ? 'green' : r.overall === 'NOT_READY' ? 'red' : 'gold' },
      { label: 'Выполнено', value: (r.counts || {}).PASS || 0, tone: 'green', go: { sec: 'inspection', tab: 0, q: 'Выполнено' } },
      { label: 'Блокирует', value: r.items.filter(function (x) { return x.blocking && (x.status === 'FAIL' || x.status === 'MISSING_EVIDENCE'); }).length, tone: 'red', go: { sec: 'inspection', tab: 0, q: 'да' } },
      { label: 'Доступов проверяющих', value: sess.length, go: { sec: 'inspection', tab: 1 } }],
    tabs: [
      { title: 'Контрольный лист', columns: [_uiCol_('id', '№'), _uiCol_('area', 'Раздел'), _uiCol_('req', 'Требование'), _uiCol_('detail', 'Факт'), _uiCol_('block', 'Блокирует'), _uiCol_('status', 'Статус', 'status')],
        rows: r.items.map(function (x) { return { _go: x.go && x.go.sec ? x.go : undefined, id: x.id, area: x.area, req: x.requirement, detail: x.detail || '', block: x.blocking && x.status !== 'PASS' && x.status !== 'NOT_APPLICABLE' ? 'да' : '', status: st[x.status] || x.status }; }) },
      { title: 'Доступ проверяющих', columns: [_uiCol_('who', 'Кому'), _uiCol_('from', 'С'), _uiCol_('till', 'До'), _uiCol_('status', 'Статус', 'status')],
        rows: sess.map(function (a) { return { who: [a.inspectorName, a.authority].filter(Boolean).join(' · '), from: _uiDate_(a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt)), till: _uiDate_(a.expiresAt instanceof Date ? a.expiresAt : new Date(a.expiresAt)), status: _uiStatusRu_(a.status) }; }) }
    ],
    actions: [{ label: 'Проверить сейчас', fn: 'inspRerun' }, { label: 'Сформировать пакет проверки', fn: 'inspPackage' }, { label: 'Доступ проверяющего (QR)', module: 'inspectors' }, { label: 'Целостность аудита и истории ТТК', fn: 'auditVerify' }]
  };
};
