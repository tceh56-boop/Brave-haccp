// Базовый стенд: организация «Кафе «Тест»», сотрудники «… Тест» по ролям.
const { boot } = require('./gasemu');
const NAMES = { 'UAT Директор': 'Директорова Тест', 'UAT Админ': 'Админов Тест', 'UAT Шеф-повар': 'Шефова Тест', 'UAT Повар 1 (горячий цех)': 'Поварова Тест (горячий цех)', 'UAT Повар 2 (холодный цех)': 'Холодова Тест (холодный цех)',
  'UAT Кладовщик': 'Складов Тест', 'UAT Технолог HACCP': 'Технологова Тест', 'UAT Бухгалтер': 'Счетова Тест', 'UAT Калькулятор': 'Калькин Тест', 'UAT Менеджер': 'Менеджеров Тест', 'UAT Лаборант': 'Пробирка Тест' };
function seedBase() {
  const E = boot({ now: '2026-10-20T09:05:00+05:00' }), c = E.ctx;
  c.runAllMigrations();
  const s = c.seedUatData();
  const org = c.findOne_('ORGANIZATIONS', 'organization_id', s.organization_id); c.updateRow_('ORGANIZATIONS', org, { 'название': 'ООО «Кафе Тест»', 'ИНН': '5600000000' });
  const loc = c.findOne_('LOCATIONS', 'location_id', s.location_id); c.updateRow_('LOCATIONS', loc, { 'название': 'Кафе «Тест», ул. Пробная, 1', 'адрес': 'г. Оренбург, ул. Пробная, 1' });
  const cred = {};
  s.credentials.forEach(x => { const u = c.findOne_('USERS', 'user_id', x.user_id); c.updateRow_('USERS', u, { 'имя': NAMES[x.name] || x.name }); x.name = NAMES[x.name] || x.name; (cred[x.role] = cred[x.role] || []).push(x); });
  ['WORKSHOPS', 'EQUIPMENT'].forEach(k => c.findRows_(k, () => true).forEach(r => { if (/\(UAT\)/.test(r['название'])) c.updateRow_(k, r, { 'название': r['название'].replace(' (UAT)', '') }); }));
  c.findRows_('SAFETY_DOCUMENTS', () => true).forEach(r => c.updateRow_('SAFETY_DOCUMENTS', r, { title: 'Инструкция по охране труда при работе с фритюрницей (тест)' }));
  c.findRows_('SAFETY_TESTS', () => true).forEach(r => c.updateRow_('SAFETY_TESTS', r, { title: 'Тест по работе с фритюрницей' }));
  c.findRows_('SAFETY_TEST_QUESTIONS', () => true).forEach(r => c.updateRow_('SAFETY_TEST_QUESTIONS', r, { question_text: String(r.question_text).replace('[UAT] ', '') }));
  const api = (role, a, d, i) => { const u = cred[role][i || 0]; if (!u.token) { const L = c.api('LOGIN', { pin: u.pin, userId: u.user_id }); if (!L.ok) throw new Error(L.error); u.token = L.data.token; } const r = c.api(a, d || {}, u.token); if (!r.ok) throw new Error(role + ' ' + a + ': ' + r.error); return r.data; };
  return { E, c, cred, org: s.organization_id, loc: s.location_id, api };
}
module.exports = { seedBase };
