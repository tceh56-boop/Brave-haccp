/**
 * ЦЕХ — Setup.gs (первичная настройка рабочей установки)
 *
 * setupProduction() — запускается ОДИН раз из редактора Apps Script после установки кода:
 *  1. Привязывает SPREADSHEET_ID (если скрипт открыт из таблицы — берёт её).
 *  2. Ставит ENVIRONMENT = PROD, если он ещё не задан.
 *  3. Создаёт листы и колонки (runAllMigrations).
 *  4. Если в системе нет ни одного активного сотрудника — создаёт организацию, точку и
 *     первого ДИРЕКТОРА со случайным PIN. PIN выводится в журнал выполнения ОДИН раз.
 * Повторный запуск безопасен: миграции идемпотентны, второй директор не создаётся.
 */
function setupProduction() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SPREADSHEET_ID')) {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (!active) throw new Error('SPREADSHEET_ID не задан, а скрипт не привязан к таблице. Задайте Script Property SPREADSHEET_ID.');
    props.setProperty('SPREADSHEET_ID', active.getId());
  }
  if (!props.getProperty('ENVIRONMENT')) props.setProperty('ENVIRONMENT', 'PROD');

  var migrations = runAllMigrations();
  var director = createFirstDirector_();
  if (director.created) {
    Logger.log('=== Первый вход: ДИРЕКТОР «' + director.name + '», PIN ' + director.pin + ' — сохраните и смените после входа ===');
  } else {
    Logger.log('setupProduction: активные сотрудники уже есть — первый директор не создавался.');
  }
  Logger.log('Дальше: installTriggers(), затем «Начать развёртывание» → «Веб-приложение».');
  return { ok: true, migrations: migrations, director: director };
}

function createFirstDirector_() {
  var active = findRows_('USERS', function (u) { return u['статус'] === 'активен'; });
  if (active.length) return { created: false };
  var org = createOrganization_({ 'название': 'ЦЕХ' });
  var loc = createLocation_({ organization_id: org.organization_id, 'название': 'Точка 1' });
  var res = _uatCreateUser_({ organization_id: org.organization_id, location_ids: [loc.location_id], 'имя': 'Директор', 'роль': 'ДИРЕКТОР', actorUserId: '' });
  return { created: true, name: res.user['имя'], user_id: res.user.user_id, pin: res.pin, organization_id: org.organization_id, location_id: loc.location_id };
}
