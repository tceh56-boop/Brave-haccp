// Вспомогательный процесс для cloud_test: данные на имитации таблицы → выгрузка CloudExport.gs в stdout.
process.env.TSEKH_BACKEND = '';
const { ctx: G } = require('../../replica/tests/harness.js');
G.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', 'SS');
G.PropertiesService.getScriptProperties().setProperty('TELEGRAM_BOT_TOKEN', '123:секрет');
G.PropertiesService.getScriptProperties().setProperty('ENVIRONMENT', 'PROD');
G.initializeDatabase();
G.insertRow_('ORGANIZATIONS', { organization_id: 'ORG-1', название: 'Кафе', статус: 'активна' });
G.insertRow_('LOCATIONS', { location_id: 'LOC-1', organization_id: 'ORG-1', название: 'Точка', статус: 'активна' });
G.insertRow_('USERS', { user_id: 'USR-EXP', organization_id: 'ORG-1', location_ids: 'LOC-1', имя: 'Анна', роль: 'КАССИР', статус: 'активен', pin_hash: G.hashPin_('482915', 'sx'), pin_salt: 'sx', failed_attempts: 0, lockout_count: 0 });
G.insertRow_('BATCHES', { batch_id: 'B-EXP', product_id: 'P-1', location_id: 'LOC-1', количество: 1, срок_годности: new Date('2099-01-01T00:00:00Z'), статус: 'активна' });
let t = G.processOperation('LOGIN', { userId: 'USR-EXP', pin: '482915' }).data;
const tok = t.requires_location ? G.processOperation('SELECT_LOCATION', { locationId: 'LOC-1' }, t.token).data.token : t.token;
const r = G.processOperation('POS_OPEN_SHIFT', { cashStart: 1000 }, tok);
if (!r.ok) throw new Error(r.error);
process.stdout.write(JSON.stringify(G.buildCloudExport_()));
