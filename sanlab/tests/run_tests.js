/* San.Lab — приёмочные проверки AT-01…AT-15 на общем ядре (Node, хранилище в памяти). */
var fs = require('fs'), vm = require('vm'), path = require('path');
var ROOT = path.join(__dirname, '..', 'src');
var GASMODE = process.env.PLATFORM === 'gas';
var ORDER = require('./order.json').filter(function (f) { return !GASMODE || f.indexOf('demo/') !== 0; });
if (GASMODE) ORDER = ORDER.concat(['gas/SheetsStore.gs', 'gas/GoogleIntegrations.gs', 'gas/Setup.gs', 'gas/Code.gs']);
var code = ORDER.map(function (f) { return '// ==== ' + f + '\n' + fs.readFileSync(path.join(ROOT, f), 'utf8'); }).join('\n');
var sandbox = { console: console, Buffer: Buffer, Date: Date, Math: Math, JSON: JSON };
if (GASMODE) { var mk = require('./gas_mock.js')(); for (var k in mk) sandbox[k] = mk[k]; }
vm.createContext(sandbox);
vm.runInContext(code + '\nthis.__x = {Api:Api, Store:Store, Integr:Integr, Seed:Seed, Repo:Repo, Settings:Settings, Jobs:Jobs};', sandbox, { filename: 'core.js' });
var X = sandbox.__x, Api = X.Api, Store = X.Store, Integr = X.Integr;
if (GASMODE) {
  var M = sandbox.__mock;
  vm.runInContext('setup(); seedDemoData(); INTEGR_DEMO_MODE = false; Store.resetCache();', sandbox);
  var rawHandle = Api.handle;
  Api = { handle: function (a, p, token, rid) { M.current.email = token; Store.resetCache(); return JSON.parse(JSON.stringify(rawHandle(a, p, token, rid))); } };
  Integr.failNextCalendar = function () { M.failCal.n++; };
  Integr._events = function () { var o = {}; Object.keys(M.events).forEach(function (k) { var m = M.events[k]._d.match(/\[(VIS-\d+)\]/); o[k] = { tag: m ? '[' + m[1] + ']' : '' }; }); return o; };
  X.Seed.demo = function () { return {}; };
}
var results = [], rid = 0;
function call(email, action, payload, requestId) { return Api.handle(action, payload || {}, email, requestId || ('t' + (++rid))); }
function ok(r, label) { if (!r.ok) throw new Error(label + ': ' + r.code + ' ' + r.message + (r.details ? ' ' + JSON.stringify(r.details) : '')); return r.data; }
function expectErr(r, code, label) { if (r.ok || (code && r.code !== code)) throw new Error(label + ': ожидалась ошибка ' + code + ', получено ' + (r.ok ? 'OK' : r.code + ' ' + r.message)); return r; }
function assert(c, label) { if (!c) throw new Error('Проверка не пройдена: ' + label); }
function test(id, name, fn) {
  try { var note = fn(); results.push({ id: id, name: name, ok: true, note: note || '' }); }
  catch (e) { results.push({ id: id, name: name, ok: false, note: e.message }); }
}

var t0 = Date.now();
var seedRes = GASMODE ? {} : X.Seed.demo();
var seedMs = Date.now() - t0;
var S = Store.stats ? Store.stats() : Object.keys(vm.runInContext("SCHEMA", sandbox)).filter(function (t) { return t !== "Requests"; }).reduce(function (o, t) { o[t] = Store.all(t).length; return o; }, {});
console.log('Seed: ' + seedMs + ' мс', JSON.stringify(S));

var OWNER = 'owner@sanlab.demo', COORD = 'coord@sanlab.demo', PETROV = 'petrov@sanlab.demo', IVANOVA = 'ivanova@sanlab.demo', KUZ = 'kuznetsov@sanlab.demo', QC = 'qc@sanlab.demo', FIN = 'finance@sanlab.demo', LAB = 'lab@sanlab.demo';
var emp = function (email) { return Store.all('Employees').filter(function (e) { return e.email === email; })[0]; };
var srvPlan = Store.all('Services').filter(function (s) { return /Плановый/.test(s.name); })[0];
var ctxSite, newVisit;

test('AT-01', 'Создать клиента и объект', function () {
  var c = ok(call(COORD, 'clients.save', { legal_name: 'ООО «Тест-Кухня»', inn: '5610999888', contact_person: 'Тестов' }), 'client');
  assert(/^CLI-\d{6}$/.test(c.client_id), 'формат client_id');
  assert(c.drive_folder_id, 'папка клиента');
  var dup = expectErr(call(COORD, 'clients.save', { legal_name: 'ООО Тест-Кухня', inn: '5610999888' }), 'DUPLICATE', 'дубль клиента');
  ctxSite = ok(call(COORD, 'sites.save', { client_id: c.client_id, site_name: 'Тест-кафе', address: 'Оренбург, ул. Пролетарская, 1' }), 'site');
  assert(/^SITE-\d{6}$/.test(ctxSite.site_id) && ctxSite.client_id === c.client_id && ctxSite.drive_folder_id, 'связь и папка объекта');
  return c.client_id + ', ' + ctxSite.site_id + '; дубль отклонён';
});

test('AT-02', 'Назначить выезд', function () {
  var start = new Date(Date.now() + 3 * 86400000); start.setUTCHours(5, 0, 0, 0);
  var r = ok(call(COORD, 'visits.create', { site_id: ctxSite.site_id, service_id: srvPlan.service_id, employee_id: emp(PETROV).employee_id, planned_start: start.toISOString(), duration_hours: 2 }, 'create-1'), 'create');
  newVisit = r.visit;
  assert(newVisit.status === 'ASSIGNED' && newVisit.calendar_event_id && newVisit.calendar_sync === 'OK', 'статус и событие');
  var again = ok(call(COORD, 'visits.create', { site_id: ctxSite.site_id, service_id: srvPlan.service_id, employee_id: emp(PETROV).employee_id, planned_start: start.toISOString() }, 'create-1'), 'replay');
  assert(again.visit.visit_id === newVisit.visit_id, 'повтор запроса не создал второй выезд');
  var mine = ok(call(PETROV, 'visits.list', { mine: true }), 'list');
  assert(mine.rows.some(function (v) { return v.visit_id === newVisit.visit_id; }), 'сотрудник видит назначение');
  var n = Store.all('Notifications').filter(function (x) { return x.entity_id === newVisit.visit_id && x.type === 'VISIT_ASSIGNED'; }).length;
  assert(n === 1, 'одно уведомление о назначении');
  return newVisit.visit_id + ', событие ' + newVisit.calendar_event_id;
});

test('AT-03', 'Открыть чужой выезд по ID', function () {
  var foreign = Store.all('Visits').filter(function (v) { return v.employee_id === emp(KUZ).employee_id; })[0];
  var r = expectErr(call(PETROV, 'visits.get', { visit_id: foreign.visit_id }), 'NOT_FOUND', 'чужой выезд');
  var site = Store.get('Sites', foreign.site_id);
  assert(r.message.indexOf(site.site_name) < 0 && !r.data, 'данные не раскрыты');
  var none = expectErr(call(PETROV, 'visits.get', { visit_id: 'VIS-999999' }), 'NOT_FOUND', 'несуществующий');
  assert(none.message === r.message, 'одинаковый ответ для «нет» и «нельзя»');
  expectErr(call(PETROV, 'results.save', { visit_id: foreign.visit_id, check_item_id: 'CI-000001', result: 'OK' }), 'NOT_FOUND', 'запись в чужой');
  expectErr(call(FIN, 'visits.get', { visit_id: foreign.visit_id }), 'ACCESS_DENIED', 'финансы без доступа к осмотру');
  return 'ответ: «' + r.message + '»';
});

var flowVisit;
test('AT-04', 'Начать и завершить выезд', function () {
  flowVisit = newVisit;
  var before = Integr.now();
  var s = ok(call(PETROV, 'visits.start', { visit_id: flowVisit.visit_id }), 'start');
  assert(s.visit.status === 'IN_PROGRESS' && s.visit.actual_start >= before, 'серверное время начала');
  var d = ok(call(PETROV, 'visits.get', { visit_id: flowVisit.visit_id }), 'get');
  d.items.forEach(function (it) {
    ok(call(PETROV, 'results.save', { visit_id: flowVisit.visit_id, check_item_id: it.check_item_id, result: 'OK' }), 'result');
    if (String(it.photo_required) === 'true' && it.check_item_id !== d.items.filter(function (x) { return String(x.photo_required) === 'true'; })[0].check_item_id) {
      ok(call(PETROV, 'files.upload', { entity_type: 'Visits', entity_id: flowVisit.visit_id, document_type: 'PHOTO', check_item_id: it.check_item_id, file_name: 'a.jpg', mime_type: 'image/jpeg', data_base64: '/9j/4AAQSkZJRg==' }), 'photo');
    }
  });
  return 'начало ' + s.visit.actual_start;
});

test('AT-05', 'Отправить отчёт без обязательного фото', function () {
  var f = expectErr(call(PETROV, 'visits.finish', { visit_id: flowVisit.visit_id }), 'INCOMPLETE', 'завершение без фото');
  assert(f.details.missing.some(function (m) { return m.code === 'NO_PHOTO'; }), 'указано недостающее фото');
  var d = ok(call(PETROV, 'visits.get', { visit_id: flowVisit.visit_id }), 'get');
  var first = d.items.filter(function (x) { return String(x.photo_required) === 'true'; })[0];
  ok(call(PETROV, 'files.upload', { entity_type: 'Visits', entity_id: flowVisit.visit_id, document_type: 'PHOTO', check_item_id: first.check_item_id, file_name: 'b.jpg', mime_type: 'image/jpeg', data_base64: '/9j/4AAQSkZJRg==' }), 'photo');
  var fin = ok(call(PETROV, 'visits.finish', { visit_id: flowVisit.visit_id }), 'finish');
  assert(fin.visit.status === 'AWAITING_REPORT' && fin.visit.actual_end, 'завершено');
  var log = Store.all('AuditLog').filter(function (l) { return l.entity_id === flowVisit.visit_id && (l.action === 'VISIT_START' || l.action === 'VISIT_FINISH'); });
  assert(log.length === 2 && log.every(function (l) { return l.actor_email === PETROV; }), 'AuditLog старт/финиш (AT-04)');
  /* Отдельный кейс: отправка отчёта, когда фото помечено неактуальным */
  var ph = Store.all('Documents').filter(function (x) { return x.entity_id === flowVisit.visit_id && x.check_item_id === first.check_item_id; })[0];
  ok(call(PETROV, 'files.invalidate', { document_id: ph.document_id, reason: 'Не тот холодильник' }), 'invalidate');
  var sub = expectErr(call(PETROV, 'reports.submit', { visit_id: flowVisit.visit_id }), 'INCOMPLETE', 'отправка без фото');
  ok(call(PETROV, 'files.upload', { entity_type: 'Visits', entity_id: flowVisit.visit_id, document_type: 'PHOTO', check_item_id: first.check_item_id, file_name: 'c.jpg', mime_type: 'image/jpeg', data_base64: '/9j/4AAQSkZJRg==' }), 'photo2');
  assert(Store.get('Documents', ph.document_id).is_actual === false, 'файл не удалён, а помечен');
  return 'блокировка: «' + sub.details.missing[0].text + '»';
});

test('AT-06', 'Повторить запрос старта', function () {
  var v = Store.all('Visits').filter(function (x) { return x.status === 'ASSIGNED' && x.employee_id === emp(KUZ).employee_id; })[0];
  var a = ok(call(KUZ, 'visits.start', { visit_id: v.visit_id }, 'start-x'), 'start1');
  var b = call(KUZ, 'visits.start', { visit_id: v.visit_id }, 'start-x');
  var c = ok(call(KUZ, 'visits.start', { visit_id: v.visit_id }, 'start-y'), 'start3');
  assert(b.ok && b.replayed && c.already, 'повтор безопасен');
  var log = Store.all('AuditLog').filter(function (l) { return l.entity_id === v.visit_id && l.action === 'VISIT_START'; });
  assert(log.length === 1, 'одна запись старта в журнале');
  assert(Store.get('Visits', v.visit_id).actual_start === a.visit.actual_start, 'время старта не перезаписано');
  return v.visit_id + ': 3 запроса → 1 старт';
});

var rep;
test('AT-07', 'Вернуть отчёт', function () {
  rep = ok(call(PETROV, 'reports.submit', { visit_id: flowVisit.visit_id }), 'submit').report;
  var rt = Store.all('Tasks').filter(function (t) { return t.source_type === 'REPORT_REVIEW' && t.source_id === rep.report_id; });
  assert(rt.length === 1, 'контролёр получил задачу на проверку');
  expectErr(call(QC, 'reports.return', { report_id: rep.report_id, comment: '' }), 'VALIDATION', 'без комментария');
  var r = ok(call(QC, 'reports.return', { report_id: rep.report_id, comment: 'Пункт 5: фото термометра нечитаемо, переснимите' }), 'return');
  assert(r.task && r.task.responsible_id === emp(PETROV).employee_id, 'задача исполнителю');
  assert(Store.get('Visits', flowVisit.visit_id).status === 'RETURNED', 'статус выезда');
  var rep2 = ok(call(PETROV, 'reports.submit', { visit_id: flowVisit.visit_id }), 'resubmit').report;
  assert(Number(rep2.version) === 2 && rep2.prev_report_id === rep.report_id, 'новая версия со ссылкой');
  assert(Store.get('Tasks', r.task.task_id).status === 'CLOSED', 'задача исправления закрыта после повторной отправки');
  rep = rep2;
  return 'v1 возвращён → задача ' + r.task.task_id + ' → v2';
});

test('AT-08', 'Утвердить отчёт', function () {
  var a = ok(call(QC, 'reports.approve', { report_id: rep.report_id }), 'approve');
  assert(a.document && a.document.document_type === 'REPORT_PDF' && a.document.approval_status === 'APPROVED' && Number(a.document.version) === 2, 'PDF и версия');
  assert(Store.get('Reports', rep.report_id).document_id === a.document.document_id, 'ссылка отчёт → документ');
  assert(/_Report_v02\.pdf$/.test(a.document.file_name), 'имя файла по шаблону: ' + a.document.file_name);
  var again = ok(call(QC, 'reports.approve', { report_id: rep.report_id }), 'approve2');
  assert(again.already && Store.all('Documents').filter(function (d) { return d.entity_id === flowVisit.visit_id && d.document_type === 'REPORT_PDF'; }).length === 1, 'повтор не создаёт второй PDF');
  expectErr(call(PETROV, 'results.save', { visit_id: flowVisit.visit_id, check_item_id: Store.all('VisitResults').filter(function (x) { return x.visit_id === flowVisit.visit_id; })[0].check_item_id, result: 'NOK', comment: 'x' }), 'INVALID_STATUS', 'утверждённое не правится');
  return a.document.file_name + (a.visit_closed ? ', выезд закрыт' : '');
});

test('AT-09', 'Создать пробу с дедлайном', function () {
  var v = Store.all('Visits').filter(function (x) { return x.status === 'IN_PROGRESS' && x.employee_id === emp(PETROV).employee_id; })[0];
  var s = ok(call(PETROV, 'lab.register', { visit_id: v.visit_id, sample_type: 'Смыв', sample_point: 'Стол раздачи', label_code: 'T-001', collected_at: Integr.now() }), 'register');
  assert(s.status === 'COLLECTED', 'отобрана');
  expectErr(call(PETROV, 'lab.advance', { sample_id: s.sample_id, to: 'SENT' }), 'VALIDATION', 'передача без лаборатории');
  ok(call(PETROV, 'lab.advance', { sample_id: s.sample_id, to: 'SENT', lab_name: 'ИЛЦ', sent_at: Integr.now() }), 'sent');
  expectErr(call(PETROV, 'lab.advance', { sample_id: s.sample_id, to: 'AWAITING' }), 'ACCESS_DENIED', 'специалист не ведёт приём');
  var past = new Date(Date.now() - 86400000).toISOString();
  var a = ok(call(LAB, 'lab.advance', { sample_id: s.sample_id, to: 'AWAITING', result_due_at: past }), 'awaiting');
  assert(a.sample.responsible_id, 'назначен ответственный');
  var list = ok(call(LAB, 'lab.list', { overdue: true }), 'list');
  assert(list.rows.some(function (x) { return x.sample_id === s.sample_id; }), 'проба отображается как просроченная');
  ok(call(OWNER, 'jobs.run', { job: 'daily' }), 'job');
  ok(call(OWNER, 'jobs.run', { job: 'daily' }), 'job2');
  var n = Store.all('Notifications').filter(function (x) { return x.entity_id === s.sample_id && x.type === 'LAB_OVERDUE'; });
  assert(n.length >= 1, 'уведомление о просрочке');
  var perRecipient = {}; n.forEach(function (x) { perRecipient[x.recipient_id] = (perRecipient[x.recipient_id] || 0) + 1; });
  assert(Object.keys(perRecipient).every(function (k) { return perRecipient[k] === 1; }), 'повторный запуск не дублирует уведомление');
  expectErr(call(LAB, 'lab.advance', { sample_id: s.sample_id, to: 'RESULT', result_date: Integr.now(), protocol_no: '1' }), 'VALIDATION', 'результат без протокола');
  return s.sample_id + ': уведомлений ' + n.length;
});

test('AT-10', 'Закрыть критическую задачу без проверки', function () {
  var t = ok(call(OWNER, 'tasks.create', { title: 'Устранить нарушение температуры', responsible_id: emp(IVANOVA).employee_id, priority: 'CRITICAL', due_date: new Date(Date.now() + 86400000).toISOString() }), 'create');
  assert(String(t.verification_required) === 'true', 'критическая → обязательная проверка');
  expectErr(call(IVANOVA, 'tasks.close', { task_id: t.task_id, comment: 'сделано' }), 'VERIFICATION_REQUIRED', 'прямое закрытие');
  expectErr(call(IVANOVA, 'tasks.submit', { task_id: t.task_id, evidence_comment: 'сделано' }), 'VALIDATION', 'без файла-подтверждения');
  var ev = ok(call(IVANOVA, 'files.upload', { entity_type: 'Tasks', entity_id: t.task_id, document_type: 'EVIDENCE', file_name: 'e.jpg', mime_type: 'image/jpeg', data_base64: '/9j/4AAQ' }), 'evidence');
  var s = ok(call(IVANOVA, 'tasks.submit', { task_id: t.task_id, evidence_comment: 'Холодильник отремонтирован, +4 °C', evidence_file_id: ev.document_id }), 'submit');
  assert(s.task.status === 'ON_CHECK', 'передана на проверку, не закрыта');
  expectErr(call(IVANOVA, 'tasks.verify', { task_id: t.task_id, comment: 'ок' }), 'ACCESS_DENIED', 'сам себя не проверяет');
  var v = ok(call(QC, 'tasks.verify', { task_id: t.task_id, comment: 'Проверено на объекте' }), 'verify');
  assert(v.task.status === 'CLOSED' && v.task.verified_by === emp(QC).employee_id && v.task.verified_at, 'закрыта с отметкой проверки');
  return t.task_id + ': закрыта только после проверки';
});

test('AT-11', 'Частично оплатить счёт', function () {
  var cl = Store.all('Clients')[0];
  var inv = ok(call(FIN, 'finance.invoice', { client_id: cl.client_id, amount: 30000, operation_date: Integr.now(), due_date: new Date(Date.now() + 10 * 86400000).toISOString() }), 'invoice');
  assert(/^СЧ-\d{4}-\d{4}$/.test(inv.invoice_no), 'уникальный номер ' + inv.invoice_no);
  var p1 = ok(call(FIN, 'finance.payment', { invoice_id: inv.finance_id, amount: 10000, operation_date: Integr.now() }), 'pay1');
  assert(p1.invoice_state.outstanding === 20000 && p1.invoice_state.status === 'PARTIAL', 'остаток 20 000, частично');
  expectErr(call(FIN, 'finance.payment', { invoice_id: inv.finance_id, amount: 25000 }), 'VALIDATION', 'переплата');
  var p2 = ok(call(FIN, 'finance.payment', { invoice_id: inv.finance_id, amount: 20000, operation_date: Integr.now() }), 'pay2');
  assert(p2.invoice_state.outstanding === 0 && p2.invoice_state.status === 'PAID', 'оплачен');
  expectErr(call(PETROV, 'finance.list', {}), 'ACCESS_DENIED', 'специалист не видит финансы');
  expectErr(call(COORD, 'finance.summary', {}), 'ACCESS_DENIED', 'координатор без отдельного права');
  var v = Store.all('Visits').filter(function (x) { return x.status === 'CLOSED'; })[0];
  var dupe = call(FIN, 'finance.accrue', { client_id: v.client_id, visit_id: v.visit_id, amount: 100, basis: 'x' });
  var first = Store.all('Finance').filter(function (f) { return f.visit_id === v.visit_id; }).length;
  if (first === 0) { ok(dupe, 'accrue'); dupe = call(FIN, 'finance.accrue', { client_id: v.client_id, visit_id: v.visit_id, amount: 100, basis: 'x' }); }
  expectErr(dupe, 'DUPLICATE', 'дублирующее начисление');
  return inv.invoice_no + ': 30 000 → 10 000 → остаток 20 000 → оплачен';
});

test('AT-12', 'Отключить пользователя', function () {
  var k = emp(KUZ);
  var logsBefore = Store.all('AuditLog').filter(function (l) { return l.actor_email === KUZ; }).length;
  var r = ok(call(OWNER, 'employees.setActive', { employee_id: k.employee_id, active: false, reason: 'Увольнение' }), 'disable');
  assert(r.open_visits_to_reassign.length > 0, 'система подсказала выезды для переназначения: ' + r.open_visits_to_reassign.length);
  expectErr(call(KUZ, 'dashboard.get', {}), 'ACCOUNT_DISABLED', 'вход запрещён');
  expectErr(call(KUZ, 'visits.list', {}), 'ACCOUNT_DISABLED', 'действия запрещены');
  assert(Store.all('AuditLog').filter(function (l) { return l.actor_email === KUZ; }).length === logsBefore, 'история сохранена');
  assert(Store.get('Employees', k.employee_id), 'запись сотрудника не удалена');
  expectErr(call(OWNER, 'employees.setActive', { employee_id: emp(OWNER).employee_id, active: false, reason: 'x' }), 'BLOCKED', 'себя отключить нельзя');
  ok(call(OWNER, 'employees.setActive', { employee_id: k.employee_id, active: true }), 'enable');
  return 'история: ' + logsBefore + ' записей сохранено';
});

test('AT-13', 'Ошибка Calendar', function () {
  Integr.failNextCalendar();
  var start = new Date(Date.now() + 5 * 86400000); start.setUTCHours(9, 0, 0, 0);
  var r = ok(call(COORD, 'visits.create', { site_id: ctxSite.site_id, service_id: srvPlan.service_id, employee_id: emp(IVANOVA).employee_id, planned_start: start.toISOString() }), 'create');
  assert(r.visit.calendar_sync === 'ERROR' && !r.visit.calendar_event_id, 'выезд сохранён, синхронизация с ошибкой');
  assert(Store.all('SystemErrors').some(function (e) { return e.entity_id === r.visit.visit_id && e.error_code === 'CALENDAR_ERROR'; }), 'ошибка залогирована');
  var countTag = function () { var ev = Integr._events(), n = 0; for (var k in ev) if (ev[k].tag === '[' + r.visit.visit_id + ']' && !ev[k].cancelled) n++; return n; };
  ok(call(COORD, 'visits.retryCalendar', { visit_id: r.visit.visit_id }), 'retry');
  ok(call(COORD, 'visits.retryCalendar', { visit_id: r.visit.visit_id }), 'retry2');
  var v = Store.get('Visits', r.visit.visit_id);
  assert(v.calendar_sync === 'OK' && countTag() === 1, 'одно событие после повторов (событий: ' + countTag() + ')');
  var resched = ok(call(COORD, 'visits.reschedule', { visit_id: v.visit_id, planned_start: new Date(start.getTime() + 86400000).toISOString(), reason: 'Клиент попросил' }), 'resched');
  assert(resched.visit.calendar_event_id === v.calendar_event_id && countTag() === 1, 'перенос обновил событие, а не создал новое');
  expectErr(call(COORD, 'visits.reschedule', { visit_id: v.visit_id, planned_start: start.toISOString() }), 'VALIDATION', 'причина обязательна');
  return v.visit_id + ': ошибка → повтор → 1 событие';
});

test('AT-14', 'Восстановить резервную копию', function () {
  if (GASMODE) {
    var before = Store.all('Clients').length;
    var copyId = vm.runInContext('backupNow()', sandbox);
    var c1 = ok(call(COORD, 'clients.save', { legal_name: 'ООО «Запись после бэкапа»' }), 'after backup');
    vm.runInContext('restoreFromBackup("' + copyId + '")', sandbox);
    Store.resetCache(); X.Settings.reset();
    var after = Store.all('Clients');
    assert(after.length === before && !after.some(function (x) { return x.client_id === c1.client_id; }), 'база восстановлена на момент копии');
    var c2 = ok(call(COORD, 'clients.save', { legal_name: 'ООО «После восстановления»' }), 'new id');
    assert(c2.client_id !== c1.client_id, 'ID не переиспользован');
    assert(Store.all('AuditLog').some(function (l) { return l.action === 'RESTORE'; }), 'восстановление записано в журнал');
    return 'backupNow → restoreFromBackup: клиентов ' + before + ', ID после восстановления ' + c2.client_id;
  }
  var dump = JSON.parse(JSON.stringify(Store.dump()));
  var before = JSON.stringify(Store.stats());
  Store.reset(); X.Settings.reset();
  assert(Store.all('Visits').length === 0, 'данные очищены');
  Store.load(dump);
  assert(JSON.stringify(Store.stats()) === before, 'все листы восстановлены');
  var d = ok(call(OWNER, 'dashboard.get', {}), 'dashboard after restore');
  var c = ok(call(COORD, 'clients.save', { legal_name: 'ООО «После восстановления»' }), 'new id');
  assert(!dump.tables.Clients.some(function (x) { return x.client_id === c.client_id; }), 'ID не переиспользован');
  return 'листов: ' + Object.keys(dump.tables).length + '; в GAS — копия файла, см. README';
});

test('AT-15', 'Сотрудник утверждает собственный отчёт', function () {
  var q = Store.all('Reports').filter(function (r) { return r.status === 'SUBMITTED'; });
  var own = q.filter(function (r) { return Store.get('Visits', r.visit_id).employee_id === emp(PETROV).employee_id; })[0];
  expectErr(call(PETROV, 'reports.approve', { report_id: own.report_id }), 'ACCESS_DENIED', 'специалист не утверждает');
  /* Руководитель, выполнивший выезд сам, тоже не может утвердить его при независимой проверке */
  var o = emp(OWNER);
  var start = new Date(Date.now() - 2 * 3600000).toISOString();
  var v = ok(call(COORD, 'visits.create', { site_id: ctxSite.site_id, service_id: srvPlan.service_id, employee_id: o.employee_id, planned_start: start, force: true }), 'create').visit;
  ok(call(OWNER, 'visits.start', { visit_id: v.visit_id }), 'start');
  var d = ok(call(OWNER, 'visits.get', { visit_id: v.visit_id }), 'get');
  d.items.forEach(function (it) {
    ok(call(OWNER, 'results.save', { visit_id: v.visit_id, check_item_id: it.check_item_id, result: 'OK' }), 'res');
    if (String(it.photo_required) === 'true') ok(call(OWNER, 'files.upload', { entity_type: 'Visits', entity_id: v.visit_id, document_type: 'PHOTO', check_item_id: it.check_item_id, file_name: 'p.jpg', mime_type: 'image/jpeg', data_base64: '/9j/4AAQ' }), 'ph');
  });
  ok(call(OWNER, 'visits.finish', { visit_id: v.visit_id }), 'finish');
  var r = ok(call(OWNER, 'reports.submit', { visit_id: v.visit_id }), 'submit');
  assert(r.reviewer_id && r.reviewer_id !== o.employee_id, 'проверяющий назначен независимый');
  expectErr(call(OWNER, 'reports.approve', { report_id: r.report.report_id }), 'ACCESS_DENIED', 'руководитель не утверждает свой');
  ok(call(QC, 'reports.approve', { report_id: r.report.report_id }), 'qc approves');
  return 'специалист и руководитель-исполнитель заблокированы; утвердил контролёр';
});

/* Дополнительно: доступность разделов, ошибки, производительность чтения */
test('EXTRA', 'Права ролей и панели', function () {
  ['owner', 'coord', 'petrov', 'qc', 'finance', 'lab'].forEach(function (u) {
    var em = u === 'finance' ? FIN : u + '@sanlab.demo';
    ok(call(em, 'dashboard.get', {}), 'dash ' + u);
    ok(call(em, 'auth.me', {}), 'me ' + u);
    ok(call(em, 'lookups.get', {}), 'lookups ' + u);
  });
  var t = Date.now(); ok(call(OWNER, 'dashboard.get', {}), 'dash'); var ms = Date.now() - t;
  ok(call(OWNER, 'analytics.get', {}), 'analytics');
  ok(call(FIN, 'finance.summary', {}), 'fin summary');
  ok(call(OWNER, 'audit.list', {}), 'audit');
  expectErr(call(QC, 'settings.get', {}), 'ACCESS_DENIED', 'настройки только руководителю');
  expectErr(call('stranger@mail.ru', 'dashboard.get', {}), 'ACCESS_DENIED', 'незарегистрированный');
  var errs = Store.all('SystemErrors').filter(function (e) { return e.error_code === 'INTERNAL'; });
  assert(!errs.length, 'нет внутренних ошибок: ' + (errs[0] && errs[0].details));
  return 'панель руководителя за ' + ms + ' мс';
});

var pass = results.filter(function (r) { return r.ok; }).length;
results.forEach(function (r) { console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id + ' — ' + r.name + ' :: ' + r.note); });
console.log('\nИтого: ' + pass + '/' + results.length);
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify({ seed_ms: seedMs, stats: S, results: results }, null, 1));
process.exit(pass === results.length ? 0 : 1);
