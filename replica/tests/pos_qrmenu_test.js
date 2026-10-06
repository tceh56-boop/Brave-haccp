// Этап M8: QR-меню (снимок в ЦЕХ + публичный проект qrmenu/). Запуск: node replica/tests/pos_qrmenu_test.js
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { ctx: G, sheets } = require('./harness.js');
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
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Кафе «Печка»', статус: 'активна' });
function mk(id, role, pin) { const s = 's' + id; G.insertRow_('USERS', { user_id: id, organization_id: 'ORG-1', location_ids: 'LOC-1', имя: role, роль: role, статус: 'активен', pin_hash: G.hashPin_(pin, s), pin_salt: s, failed_attempts: 0, lockout_count: 0 }); }
mk('USR-M', 'МЕНЕДЖЕР', '482915'); mk('USR-K', 'КАССИР', '739164'); mk('USR-P', 'ПОВАР', '615283');
G.insertRow_('CATEGORIES', { category_id: 'CAT-1', название: 'Супы', тип: 'блюдо' });
G.insertRow_('DISHES', { dish_id: 'DISH-1', organization_id: 'ORG-1', название: 'Борщ', категория_id: 'CAT-1', выход: 300, цена_продажи: 350, себестоимость: 91.5, статус: 'активно' });
G.insertRow_('DISHES', { dish_id: 'DISH-2', organization_id: 'ORG-1', название: 'Солянка <script>alert(1)</script>', категория_id: 'CAT-1', цена_продажи: 390, себестоимость: 120, статус: 'активно' });
G.insertRow_('DISHES', { dish_id: 'DISH-3', organization_id: 'ORG-1', название: 'Уха', категория_id: 'CAT-1', цена_продажи: 420, статус: 'активно' });
G.insertRow_('DISHES', { dish_id: 'DISH-4', organization_id: 'ORG-1', название: 'Служебное', цена_продажи: 0, статус: 'активно' });
G.insertRow_('TTK_VERSIONS', { ttk_version_id: 'TTKV-1', dish_id: 'DISH-1', organization_id: 'ORG-1', version: 1, status: 'утверждена', аллергенная_информация: 'сельдерей', пищевая_ценность: '120 ккал' });
function login(u, p) { const d = api('LOGIN', { userId: u, pin: p }); return d.requires_location ? (api('SELECT_LOCATION', { locationId: 'LOC-1' }, d.token).token || d.token) : d.token; }
const tM = login('USR-M', '482915'), tK = login('USR-K', '739164'), tP = login('USR-P', '615283');
const hall = api('POS_SAVE_HALL', { название: 'Зал' }, tM);
const t7 = api('POS_SAVE_TABLE', { hallId: hall.hall_id, название: '7' }, tM);
api('POS_SET_STOP', { dishId: 'DISH-3', reason: 'Нет рыбы' }, tP);
const URL_OK = 'https://script.google.com/macros/s/AKfycbx_Test-123/exec';

let token;
step('кассир не управляет QR-меню', () => { assert(/Недостаточно прав/.test(apiErr('POS_PUBLISH_QRMENU', {}, tK))); });
step('адрес приложения проверяется', () => {
  assert(/macros\/s/.test(apiErr('POS_SAVE_QRMENU_SETTINGS', { url: 'https://evil.example.com/exec' }, tM)));
  assert(/macros\/s/.test(apiErr('POS_SAVE_QRMENU_SETTINGS', { url: 'http://script.google.com/macros/s/x/exec' }, tM)));
});
step('сохранение адреса публикует меню и даёт ссылки столов', () => {
  const r = api('POS_SAVE_QRMENU_SETTINGS', { url: URL_OK, включено: true }, tM);
  token = G.findRows_('PUBLIC_MENU', () => true)[0].token;
  assert(/^[a-f0-9]{32}$/.test(token));
  assert.equal(r.ссылка_меню, URL_OK + '?m=' + token);
  assert.equal(r.столы[0].ссылка, URL_OK + '?m=' + token + '&t=' + t7.table_id);
  assert.equal(r.блюд, 2);
});
step('снимок: без стопа, без цены 0 и без себестоимости; аллергены из ТТК', () => {
  const row = G.findRows_('PUBLIC_MENU', () => true)[0];
  const data = JSON.parse(row.json);
  assert.deepEqual(data.блюда.map(d => d.id).sort(), ['DISH-1', 'DISH-2']);
  assert(!/91\.5|себестоимость|supplier|поставщик/.test(row.json));
  const borsch = data.блюда.find(d => d.id === 'DISH-1');
  assert.equal(borsch.аллергены, 'сельдерей'); assert.equal(borsch.выход, 300);
  assert.equal(data.заведение, 'Кафе «Печка»'); assert.equal(data.столы[t7.table_id], '7');
});
step('повторная публикация не меняет ключ (напечатанные QR работают)', () => {
  api('POS_CLEAR_STOP', { stopId: G.findRows_('STOP_LIST', s => !s.снято)[0].stop_id }, tP);
  const r = api('POS_PUBLISH_QRMENU', {}, tM);
  assert.equal(G.findRows_('PUBLIC_MENU', () => true).length, 1);
  assert.equal(G.findRows_('PUBLIC_MENU', () => true)[0].token, token);
  assert.equal(r.блюд, 3, 'после снятия стопа уха вернулась');
});
step('фоновое обновление пересобирает снимок', () => {
  api('POS_SET_STOP', { dishId: 'DISH-1', reason: 'Закончился' }, tP);
  G.posFulfillPendingSalesTrigger_();
  const data = JSON.parse(G.findRows_('PUBLIC_MENU', () => true)[0].json);
  assert(!data.блюда.some(d => d.id === 'DISH-1'));
});

// ---- Публичный проект qrmenu/Code.gs в отдельном контексте: читает те же листы ----
const out = { html: null };
const Q = {
  console, JSON, Math, Date, String, Number, Object, Array, RegExp, Error, encodeURIComponent,
  SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n] || null }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'SPREADSHEET_ID' ? 'SS' : null) }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
  Utilities: { formatDate: d => d.toISOString().slice(5, 16).replace('T', ' ') },
  HtmlService: { createHtmlOutput: h => { out.html = h; const o = { setTitle: t => { out.title = t; return o; }, addMetaTag: () => o }; return o; } }
};
vm.createContext(Q);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../qrmenu/Code.gs'), 'utf8'), Q);

step('публичная страница по ключу и столу', () => {
  Q.doGet({ parameter: { m: token, t: t7.table_id } });
  assert(/Кафе «Печка»/.test(out.html) && /Стол 7/.test(out.html));
  assert(/Солянка/.test(out.html) && /Уха/.test(out.html) && !/>Борщ</.test(out.html));
  assert.equal(out.title, 'Кафе «Печка» — меню');
});
step('название блюда экранируется (нет исполняемого script)', () => {
  assert(!/<script>alert/.test(out.html));
  assert(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(out.html));
});
step('неверный ключ и чужие параметры — «не найдено»', () => {
  Q.doGet({ parameter: { m: 'abc' } }); assert(/не найдено/.test(out.html));
  Q.doGet({ parameter: { m: token.replace(/./, c => (c === 'a' ? 'b' : 'a')) } }); assert(/не найдено/.test(out.html));
  Q.doGet({ parameter: { m: token, t: 'чужой-стол' } }); assert(/Солянка/.test(out.html) && !/<p>Стол /.test(out.html), 'неизвестный стол не показывается');
});
step('выключенное меню не показывается', () => {
  api('POS_SAVE_QRMENU_SETTINGS', { url: URL_OK, включено: false }, tM);
  Q.doGet({ parameter: { m: token } }); assert(/выключено/.test(out.html));
  api('POS_SAVE_QRMENU_SETTINGS', { url: URL_OK, включено: true }, tM);
  Q.doGet({ parameter: { m: token } }); assert(/Солянка/.test(out.html));
  fs.writeFileSync(path.join(__dirname, '../../replica/clone-screens/M8-qrmenu.html'), (Q.doGet({ parameter: { m: token, t: t7.table_id } }), out.html));
});
step('публичный проект — только чтение таблиц и доступ «все»', () => {
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, '../../qrmenu/appsscript.json'), 'utf8'));
  assert.deepEqual(man.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  assert.equal(man.webapp.access, 'ANYONE_ANONYMOUS');
});
step('runPosTests_ — все проверки OK', () => {
  const bad = G.runPosTests_().filter(t => t.status !== 'OK'); assert.equal(bad.length, 0, JSON.stringify(bad));
});
console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
process.exit(failures ? 1 : 0);
