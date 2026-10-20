/**
 * San.Lab — ClientService.gs
 * Клиенты, объекты, договоры, услуги, сотрудники (раздел 4.1 ТЗ).
 */

function normText(s) { return V.str(s).toLowerCase().replace(/[«»"'.,]/g, '').replace(/\s+/g, ' '); }

var Clients = {
  list: function (ctx, p) {
    var u = ctx.user;
    var siteIds = Auth.visibleSiteIds(u);
    var sites = Store.all('Sites');
    var clientIds = null;
    if (siteIds) {
      clientIds = {};
      for (var i = 0; i < sites.length; i++) if (siteIds[sites[i].site_id]) clientIds[sites[i].client_id] = true;
    }
    var sitesBy = groupBy(sites, 'client_id');
    var emp = indexBy(Store.all('Employees'), 'employee_id');
    var q = normText(p.q);
    var rows = filterBy(Store.all('Clients'), function (c) {
      if (clientIds && !clientIds[c.client_id]) return false;
      if (!p.includeArchived && c.status === 'ARCHIVED') return false;
      if (q && normText(c.legal_name + ' ' + c.inn + ' ' + c.client_id + ' ' + c.contact_person).indexOf(q) < 0) return false;
      return true;
    });
    var fin = Auth.can(u, 'finance.summary') ? Finance.debtByClient() : null;
    return sortBy(rows, 'legal_name').map(function (c) {
      var o = stripSecrets(c);
      o.sites_count = (sitesBy[c.client_id] || []).filter(function (s) { return V.bool(s.active); }).length;
      o.manager_name = emp[c.manager_id] ? emp[c.manager_id].full_name : '';
      if (fin) o.debt = fin[c.client_id] || 0;
      if (u.role === 'SPECIALIST') { o.inn = ''; o.contact_email = ''; o.notes = ''; }
      return o;
    });
  },

  get: function (ctx, p) {
    var u = ctx.user;
    var c = Repo.get('Clients', p.client_id);
    var siteIds = Auth.visibleSiteIds(u);
    var sites = filterBy(Store.all('Sites'), function (s) { return c && s.client_id === c.client_id && (!siteIds || siteIds[s.site_id]); });
    if (!c || (siteIds && !sites.length)) notFound('Клиент');
    var out = { client: stripSecrets(c), sites: sites, contracts: [], visits: [], finance: null, documents: [] };
    if (u.role !== 'SPECIALIST') out.contracts = Repo.where('Contracts', function (x) { return x.client_id === c.client_id; });
    var vis = Visits.list(ctx, { client_id: c.client_id, limit: 50 });
    out.visits = vis.rows;
    if (Auth.can(u, 'finance.summary')) out.finance = Finance.clientCard(c.client_id);
    out.documents = Documents.listFor(ctx, function (d) {
      return (d.entity_type === 'Clients' && d.entity_id === c.client_id) ||
        (d.entity_type === 'Contracts' && out.contracts.some(function (k) { return k.contract_id === d.entity_id; }));
    });
    return out;
  },

  save: function (ctx, p) {
    var d = {
      legal_name: V.str(p.legal_name), inn: V.inn(p.inn), contact_person: V.str(p.contact_person),
      contact_phone: V.str(p.contact_phone), contact_email: V.email(p.contact_email),
      legal_address: V.str(p.legal_address), manager_id: V.str(p.manager_id) || ctx.actorId,
      status: V.str(p.status) || 'ACTIVE', notes: V.str(p.notes)
    };
    V.required(d, ['legal_name'], { legal_name: 'Наименование' });
    V.oneOf(d.status, STATUS.client, 'Статус');
    var dupe = filterBy(Store.all('Clients'), function (c) {
      if (c.client_id === p.client_id) return false;
      return (d.inn && c.inn === d.inn) || normText(c.legal_name) === normText(d.legal_name);
    });
    if (dupe.length) fail('DUPLICATE', 'Клиент уже существует: ' + dupe[0].client_id + ' «' + dupe[0].legal_name + '»', { client_id: dupe[0].client_id });
    if (p.client_id) {
      Repo.must('Clients', p.client_id, 'Клиент');
      return Repo.update(ctx, 'Clients', p.client_id, d, { expectedVersion: p.row_version });
    }
    var c = Repo.create(ctx, 'Clients', d);
    var folder = Files.safeFolder(ctx, ['01_CLIENTS', c.client_id], c.client_id);
    if (folder) c = Repo.update(ctx, 'Clients', c.client_id, { drive_folder_id: folder }, { noAudit: true });
    return c;
  },

  archive: function (ctx, p) {
    var c = Repo.must('Clients', p.client_id, 'Клиент');
    V.required(p, ['reason'], { reason: 'Причина' });
    var open = Repo.where('Visits', function (v) { return v.client_id === c.client_id && ['ASSIGNED', 'RESCHEDULED', 'IN_PROGRESS'].indexOf(v.status) >= 0; });
    if (open.length) fail('BLOCKED', 'У клиента есть незавершённые выезды (' + open.length + '). Отмените или завершите их.');
    return Repo.update(ctx, 'Clients', c.client_id, { status: 'ARCHIVED', notes: V.str(c.notes) + '\nАрхив: ' + p.reason }, { action: 'ARCHIVE' });
  }
};

var Sites = {
  save: function (ctx, p) {
    var d = {
      client_id: V.str(p.client_id), site_name: V.str(p.site_name), address: V.str(p.address),
      contact_name: V.str(p.contact_name), contact_phone: V.str(p.contact_phone),
      service_frequency: V.str(p.service_frequency), contract_id: V.str(p.contract_id),
      service_ids: Array.isArray(p.service_ids) ? p.service_ids.join(',') : V.str(p.service_ids),
      instructions: V.str(p.instructions), active: p.active === undefined ? true : V.bool(p.active)
    };
    V.required(d, ['client_id', 'site_name', 'address'], { client_id: 'Клиент', site_name: 'Название объекта', address: 'Адрес' });
    var client = Repo.must('Clients', d.client_id, 'Клиент');
    if (client.status === 'ARCHIVED') fail('BLOCKED', 'Клиент в архиве');
    if (d.contract_id) {
      var con = Repo.must('Contracts', d.contract_id, 'Договор');
      if (con.client_id !== d.client_id) fail('VALIDATION', 'Договор принадлежит другому клиенту');
    }
    var sids = csvList(d.service_ids);
    for (var i = 0; i < sids.length; i++) Repo.must('Services', sids[i], 'Услуга ' + sids[i]);
    var dupe = filterBy(Store.all('Sites'), function (s) {
      return s.site_id !== p.site_id && s.client_id === d.client_id && normText(s.address) === normText(d.address) && V.bool(s.active);
    });
    if (dupe.length) fail('DUPLICATE', 'Объект с таким адресом уже есть: ' + dupe[0].site_id + ' «' + dupe[0].site_name + '»');
    if (p.site_id) {
      var cur = Repo.must('Sites', p.site_id, 'Объект');
      if (cur.client_id !== d.client_id) fail('VALIDATION', 'Нельзя перенести объект к другому клиенту — создайте новый объект');
      return Repo.update(ctx, 'Sites', p.site_id, d, { expectedVersion: p.row_version });
    }
    var s = Repo.create(ctx, 'Sites', d);
    var folder = Files.safeFolder(ctx, ['01_CLIENTS', d.client_id, s.site_id], s.site_id);
    if (folder) s = Repo.update(ctx, 'Sites', s.site_id, { drive_folder_id: folder }, { noAudit: true });
    return s;
  },
  archive: function (ctx, p) {
    var s = Repo.must('Sites', p.site_id, 'Объект');
    V.required(p, ['reason'], { reason: 'Причина' });
    return Repo.update(ctx, 'Sites', s.site_id, { active: false, instructions: V.str(s.instructions) + '\nАрхив: ' + p.reason }, { action: 'ARCHIVE' });
  }
};

var Contracts = {
  save: function (ctx, p) {
    var d = {
      client_id: V.str(p.client_id), number: V.str(p.number), start_date: V.date(p.start_date, 'Дата начала'),
      end_date: p.end_date ? V.date(p.end_date, 'Дата окончания') : '', terms: V.str(p.terms),
      amount: p.amount ? V.num(p.amount, 'Сумма', { nonNegative: true }) : '', status: V.str(p.status) || 'ACTIVE'
    };
    V.required(d, ['client_id', 'number'], { client_id: 'Клиент', number: 'Номер договора' });
    V.oneOf(d.status, STATUS.contract, 'Статус');
    Repo.must('Clients', d.client_id, 'Клиент');
    if (d.end_date && isBefore(d.end_date, d.start_date)) fail('VALIDATION', 'Дата окончания раньше даты начала');
    var dupe = filterBy(Store.all('Contracts'), function (c) { return c.contract_id !== p.contract_id && c.client_id === d.client_id && normText(c.number) === normText(d.number); });
    if (dupe.length) fail('DUPLICATE', 'Договор с номером ' + d.number + ' у клиента уже есть');
    if (p.contract_id) return Repo.update(ctx, 'Contracts', p.contract_id, d, { expectedVersion: p.row_version });
    return Repo.create(ctx, 'Contracts', d);
  }
};

var Services = {
  list: function (ctx) {
    var all = Store.all('Services');
    if (ctx.user.role !== 'OWNER') all = filterBy(all, function (s) { return V.bool(s.active); });
    var showPrice = Auth.can(ctx.user, 'finance.summary') || ctx.user.role === 'COORDINATOR';
    return sortBy(all, 'name').map(function (s) { var o = stripSecrets(s); if (!showPrice) o.price = ''; return o; });
  },
  save: function (ctx, p) {
    var d = {
      name: V.str(p.name), description: V.str(p.description), price: V.num(p.price || 0, 'Цена', { nonNegative: true }),
      unit: V.str(p.unit) || 'выезд', checklist_id: V.str(p.checklist_id), requires_samples: V.bool(p.requires_samples),
      active: p.active === undefined ? true : V.bool(p.active)
    };
    V.required(d, ['name'], { name: 'Название услуги' });
    if (d.checklist_id) Repo.must('Checklists', d.checklist_id, 'Чек-лист');
    if (p.service_id) return Repo.update(ctx, 'Services', p.service_id, d);
    return Repo.create(ctx, 'Services', d);
  }
};

var Employees = {
  list: function (ctx) {
    var u = ctx.user;
    var teams = indexBy(Store.all('Teams'), 'team_id');
    var rows = Store.all('Employees');
    var visits = Store.all('Visits');
    var full = u.role === 'OWNER';
    return sortBy(rows, 'full_name').map(function (e) {
      var o = { employee_id: e.employee_id, full_name: e.full_name, role: e.role, role_label: ROLES[e.role], active: V.bool(e.active), team_name: teams[e.team_id] ? teams[e.team_id].team_name : '' };
      if (full || u.role === 'COORDINATOR') { o.email = e.email; o.phone = e.phone; }
      if (full) { o.extra_perms = e.extra_perms; o.team_id = e.team_id; o.has_pin = !!e.pin_hash; o.deactivated_at = e.deactivated_at; o.row_version = e.row_version; }
      if (full || u.role === 'COORDINATOR') {
        o.visits_open = filterBy(visits, function (v) { return v.employee_id === e.employee_id && ['ASSIGNED', 'RESCHEDULED', 'IN_PROGRESS', 'AWAITING_REPORT', 'RETURNED'].indexOf(v.status) >= 0; }).length;
      }
      return o;
    });
  },

  save: function (ctx, p) {
    var d = {
      full_name: V.str(p.full_name), email: V.email(p.email), phone: V.str(p.phone), role: V.str(p.role),
      team_id: V.str(p.team_id), extra_perms: Array.isArray(p.extra_perms) ? p.extra_perms.join(',') : V.str(p.extra_perms)
    };
    V.required(d, ['full_name', 'email', 'role'], { full_name: 'ФИО', email: 'E-mail', role: 'Роль' });
    V.oneOf(d.role, ROLES, 'Роль');
    var ex = csvList(d.extra_perms);
    for (var i = 0; i < ex.length; i++) if (!EXTRA_PERMS[ex[i]]) fail('VALIDATION', 'Неизвестное доп. право: ' + ex[i]);
    var dupe = filterBy(Store.all('Employees'), function (e) { return e.employee_id !== p.employee_id && V.str(e.email).toLowerCase() === d.email; });
    if (dupe.length) fail('DUPLICATE', 'Сотрудник с таким e-mail уже есть: ' + dupe[0].employee_id);
    if (p.pin) {
      if (!/^\d{4,6}$/.test(String(p.pin))) fail('VALIDATION', 'PIN — от 4 до 6 цифр');
      d.pin_hash = Integr.hash(d.email + ':' + p.pin);
    }
    if (p.employee_id) {
      var cur = Repo.must('Employees', p.employee_id, 'Сотрудник');
      if (cur.employee_id === ctx.actorId && d.role !== cur.role) fail('BLOCKED', 'Нельзя изменить собственную роль');
      var res = Repo.update(ctx, 'Employees', p.employee_id, d, { expectedVersion: p.row_version, action: cur.role !== d.role ? 'ROLE_CHANGE' : 'UPDATE' });
      return stripSecrets(res);
    }
    d.active = true;
    return stripSecrets(Repo.create(ctx, 'Employees', d));
  },

  /* AT-12: отключение — новые действия запрещены, история сохраняется */
  setActive: function (ctx, p) {
    var e = Repo.must('Employees', p.employee_id, 'Сотрудник');
    var active = V.bool(p.active);
    if (e.employee_id === ctx.actorId && !active) fail('BLOCKED', 'Нельзя отключить собственную учётную запись');
    if (!active) V.required(p, ['reason'], { reason: 'Причина отключения' });
    var res = Repo.update(ctx, 'Employees', e.employee_id, { active: active, deactivated_at: active ? '' : ctx.now }, { action: active ? 'ACCOUNT_ENABLE' : 'ACCOUNT_DISABLE' });
    var open = active ? [] : Repo.where('Visits', function (v) { return v.employee_id === e.employee_id && ['ASSIGNED', 'RESCHEDULED'].indexOf(v.status) >= 0; });
    return { employee: stripSecrets(res), open_visits_to_reassign: open.map(function (v) { return v.visit_id; }) };
  }
};

/* Справочники для форм с учётом прав */
var Lookups = {
  get: function (ctx) {
    var u = ctx.user;
    var siteIds = Auth.visibleSiteIds(u);
    var sites = filterBy(Store.all('Sites'), function (s) { return !siteIds || siteIds[s.site_id]; });
    var cIds = {}; for (var i = 0; i < sites.length; i++) cIds[sites[i].client_id] = true;
    var clients = filterBy(Store.all('Clients'), function (c) { return !siteIds || cIds[c.client_id]; });
    return {
      employees: Store.all('Employees').map(function (e) { return { id: e.employee_id, name: e.full_name, role: e.role, active: V.bool(e.active) }; }),
      clients: clients.map(function (c) { return { id: c.client_id, name: c.legal_name, status: c.status }; }),
      sites: sites.map(function (s) { return { id: s.site_id, name: s.site_name, client_id: s.client_id, address: s.address, active: V.bool(s.active), contract_id: s.contract_id, service_ids: s.service_ids }; }),
      contracts: Auth.isAdminLike(u) || u.role === 'FINANCE' ? Store.all('Contracts').map(function (c) { return { id: c.contract_id, client_id: c.client_id, number: c.number, status: c.status }; }) : [],
      services: Services.list(ctx).map(function (s) { return { id: s.service_id, name: s.name, price: s.price, checklist_id: s.checklist_id, requires_samples: V.bool(s.requires_samples), active: V.bool(s.active) }; }),
      checklists: filterBy(Store.all('Checklists'), function (c) { return V.bool(c.active); }).map(function (c) { return { id: c.checklist_id, name: c.name, version: c.version }; }),
      dict: {
        roles: ROLES, visit: STATUS.visit, task: STATUS.task, lab: STATUS.lab, report: STATUS.report, document: STATUS.document,
        client: STATUS.client, contract: STATUS.contract, payment: STATUS.payment, results: CHECK_RESULTS, severity: SEVERITY,
        priority: PRIORITY, taskSources: TASK_SOURCES, finTypes: FIN_TYPES, expenseCategories: EXPENSE_CATEGORIES,
        docTypes: DOC_TYPES, sampleTypes: SAMPLE_TYPES, labDecisions: LAB_DECISIONS, labFlow: LAB_FLOW, labRequired: LAB_REQUIRED,
        extraPerms: Object.keys(EXTRA_PERMS)
      },
      settings: { photoMaxMb: Settings.num('PHOTO_MAX_MB'), photoTypes: Settings.get('PHOTO_ALLOWED_TYPES'), fileMaxMb: Settings.num('FILE_MAX_MB'), company: Settings.get('COMPANY_NAME'), independentReview: Settings.bool('INDEPENDENT_REVIEW') }
    };
  }
};
