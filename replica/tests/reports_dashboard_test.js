// Stage 20 (перенесено): дашборд руководителя и каталог отчётов. Запуск: node replica/tests/reports_dashboard_test.js
const assert = require('assert');
const { ctx: G } = require('./harness.js');
let failures = 0;
function step(name, fn) {
  try { const r = fn(); console.log('OK   ', name); return r; }
  catch (e) { failures++; console.log('FAIL ', name, '—', e && e.message); }
}
function api(a, d, t) { const r = G.processOperation(a, d || {}, t); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; }
function apiErr(a, d, t) { const r = G.processOperation(a, d || {}, t); assert(!r.ok, a + ' должен был вернуть ошибку'); return r.error; }

G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
function mk(id, role, pin) { const s = 's' + id; G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: role, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, s), pin_salt: s, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-D', 'ДИРЕКТОР', '482915'); mk('USR-K', 'КАССИР', '739164'); mk('USR-M', 'МЕНЕДЖЕР', '615283');
G.insertRow_('DISHES', { dish_id: 'DISH-1', organization_id: 'ORG-1', название: 'Борщ', цена_продажи: 350, себестоимость: 100, статус: 'активно' });
G.insertRow_('TASKS', { task_id: 'T-1', organization_id: 'ORG-1', location_id: 'LOC-1', type: 'journal', title: 'Заполнить журнал', status: 'открыта', created_at: G.nowIso_() });
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tD = login('USR-D', '482915'), tK = login('USR-K', '739164'), tM = login('USR-M', '615283');

// Продажи через кассу: 3 борща (1050) — один возвращён (350).
api('POS_OPEN_SHIFT', { cashStart: 0 }, tK);
let v = api('POS_CREATE_ORDER', {}, tK);
v = api('POS_ADD_LINE', { orderId: v.order.order_id, dishId: 'DISH-1', qty: 2, version: v.order.version }, tK);
api('POS_PAY', { orderId: v.order.order_id, version: v.order.version, operationId: 'D1', payments: [{ способ: 'карта', сумма: 700 }] }, tK);
let w = api('POS_CREATE_ORDER', {}, tK);
w = api('POS_ADD_LINE', { orderId: w.order.order_id, dishId: 'DISH-1', qty: 1, version: w.order.version }, tK);
api('POS_PAY', { orderId: w.order.order_id, version: w.order.version, operationId: 'D2', payments: [{ способ: 'нал', сумма: 350 }] }, tK);
api('POS_REFUND', { orderId: w.order.order_id, reason: 'Холодный', method: 'нал', operationId: 'D3' }, tD);

let d;
step('кассир и менеджер без модуля reports не видят дашборд; директор видит', () => {
  assert(/Недостаточно прав/.test(apiErr('GET_EXECUTIVE_DASHBOARD', {}, tK)));
  assert(/Недостаточно прав/.test(apiErr('GET_EXECUTIVE_DASHBOARD', {}, tM)));
  d = api('GET_EXECUTIVE_DASHBOARD', {}, tD);
});
step('период по умолчанию — сегодня по времени скрипта', () => {
  assert.equal(d.period.from, G.todayDateStr_()); assert.equal(d.period.to, G.todayDateStr_());
});
step('выручка P&L учитывает продажи кассы и сторно возврата', () => {
  assert.equal(d.kpi.revenue, 700); assert.equal(d.kpi.gross_profit, 700 - 300);
});
step('блок кассы: продажи, возвраты, нетто, средний чек, смены', () => {
  const p = d.pos;
  assert.deepEqual([p.смен, p.открытых_смен, p.продажи, p.возвраты, p.выручка, p.заказов, p.средний_чек], [1, 1, 1050, 350, 700, 2, 525]);
});
step('открытые задачи считаются (в оригинале «открыта» не совпадала после toUpperCase)', () => {
  assert(d.operations.open_tasks >= 1, 'open_tasks=' + d.operations.open_tasks);
});
step('сбой одного раздела не роняет дашборд — раздел попадает в errors', () => {
  const orig = G.getSafetyDashboard_;
  G.getSafetyDashboard_ = () => { throw new Error('тестовый сбой'); };
  const r = api('GET_EXECUTIVE_DASHBOARD', {}, tD);
  G.getSafetyDashboard_ = orig;
  assert.equal(r.kpi.revenue, 700);
  assert.deepEqual(r.errors.map(e => e.раздел), ['Охрана труда']);
});
step('«последние 7 дней» считаются на сервере от его сегодняшней даты', () => {
  const r = api('GET_EXECUTIVE_DASHBOARD', { days: 6 }, tD);
  const t = new Date(G.todayDateStr_() + 'T12:00:00Z');
  assert.equal(r.period.to, G.todayDateStr_());
  assert.equal(r.period.from, new Date(t.getTime() - 6 * 86400000).toISOString().slice(0, 10));
  assert.equal(r.kpi.revenue, 700);
});
step('прошлый период без продаж — нули', () => {
  const r = api('GET_EXECUTIVE_DASHBOARD', { dateFrom: '2026-01-01', dateTo: '2026-01-31' }, tD);
  assert.equal(r.kpi.revenue, 0); assert.equal(r.pos.смен, 0);
});
step('каталог отчётов: 20 позиций, включая кассу', () => {
  const r = api('GET_MANAGEMENT_REPORTS', {}, tD);
  assert.equal(r.catalog.length, 20);
  ['P_AND_L', 'ABC_XYZ', 'POS_STAFF', 'POS_GUESTS', 'POS_STOP', 'STOCK', 'JOURNALS', 'INCIDENTS', 'COMPLIANCE', 'SAFETY', 'RECALL'].forEach(id => assert(r.catalog.some(c => c.id === id), id));
  assert.equal(r.executive.kpi.revenue, 700);
});
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
