const assert = require('assert');
const { ctx: G } = require('./harness.js');
function api(a, d, t) { const r = G.processOperation(a, d || {}, t); if (!r.ok) throw new Error(a + ': ' + r.error); return r.data; }
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Тест', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
function mk(id, role, pin) { const s = 's' + id; G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: role, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, s), pin_salt: s, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-D', 'ДИРЕКТОР', '482915'); mk('USR-T', 'ТЕХНОЛОГ_HACCP', '739164'); mk('USR-K', 'КАССИР', '615283');
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tD = login('USR-D', '482915'), tT = login('USR-T', '739164'), tK = login('USR-K', '615283');
const prod = api('CREATE_PRODUCT', { название: 'Свёкла', единица: 'кг', цена: 50 }, tD);
const pid = prod.product_id || (prod.product && prod.product.product_id);
api('RECEIVE_GOODS', { productId: pid, qty: 10, price: 50, expiryDate: '2099-01-01', productionDate: '2026-10-01' }, tD);
const dish = api('CREATE_DISH', { название: 'Борщ', выход: 300, цена_продажи: 350 }, tD);
const did = dish.dish_id;
api('ADD_RECIPE_LINE', { parentType: 'DISH', parentId: did, ingredientId: pid, брутто: 0.2, нетто: 0.16, единица: 'кг' }, tD);
const v = api('CREATE_TTK_VERSION', { dishId: did, технология: 'Свёклу очистить, нарезать соломкой, варить 40 минут', условия_хранения: '+2..+6 °C', срок_реализации: '24 ч' }, tD);
const vid = v.ttk_version_id || (v.version && v.version.ttk_version_id);
api('SUBMIT_TTK_FOR_APPROVAL', { ttkVersionId: vid }, tD);
api('APPROVE_TTK_VERSION', { ttkVersionId: vid }, tT);
const stock0 = G.getStockLevel_(pid, 'LOC-1');
api('POS_OPEN_SHIFT', { cashStart: 0 }, tK);
let o = api('POS_CREATE_ORDER', {}, tK).order;
o = api('POS_ADD_LINE', { orderId: o.order_id, dishId: did, qty: 3, version: o.version }, tK).order;
api('POS_PAY', { orderId: o.order_id, version: o.version, operationId: 'P1', payments: [{ способ: 'карта', сумма: 1050 }] }, tK);
G.posFulfillPendingSalesTrigger_();
const sale = G.findRows_('SALES', s => s.источник === 'касса')[0];
const stock1 = G.getStockLevel_(pid, 'LOC-1');
console.log('sale status:', sale.исполнение_статус, sale.ошибка_исполнения || '', '| stock', JSON.stringify(stock0), '->', JSON.stringify(stock1), '| food cost', sale.food_cost_факт);
assert.equal(sale.исполнение_статус, 'исполнено');
console.log('FULFILL PASSED');
