/**
 * ЦЕХ Стандарт Admin — резервные копии, обновления системы, база отработанных ТТК, настройки.
 */
/* ------------------------- резервные копии ------------------------- */
function adminBackups(token, orgId) {
  try { requireRole(token, 'backups.view'); return ok(readAll('Backups').filter(function (b) { return !orgId || b['OrgID'] === orgId; }).reverse()); } catch (e) { return fail(e); }
}
/**
 * Резервная копия: orgId пусто — копия базы админ-панели; иначе — копия таблицы клиента, если она доступна
 * этому аккаунту (Google Drive ID в карточке), а если нет — команда клиенту сделать копию у себя
 * (выполнится при следующей проверке лицензии, результат появится в списке).
 */
function adminBackupCreate(token, orgId) {
  try {
    var s = requireRole(token, 'backups.create'), stamp = Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd_HH-mm'), folder = docsFolder_('Резервные копии');
    if (!orgId) {
      var f = DriveApp.getFileById(db().getId()).makeCopy('ADMIN BACKUP ' + stamp, folder);
      insert('Backups', { 'ID': newId('BK'), 'Дата': new Date(), 'OrgID': '', 'Клиент': 'База админ-панели', 'Размер': f.getSize(), 'Drive File ID': f.getId(), 'Ссылка': f.getUrl(), 'Кто': s.email, 'Статус': 'OK' });
      logEvent('BACKUP', s.email, 'admin', 'Копия базы админ-панели');
      return ok({ url: f.getUrl() });
    }
    var o = findBy('Organizations', 'ID', orgId); if (!o) throw new Error('NOT_FOUND: клиент не найден');
    if (o['Google Drive ID']) {
      try {
        var c = DriveApp.getFileById(o['Google Drive ID']).makeCopy('BACKUP ' + o['Название'] + ' ' + stamp, folder);
        insert('Backups', { 'ID': newId('BK'), 'Дата': new Date(), 'OrgID': orgId, 'Клиент': o['Название'], 'Размер': c.getSize(), 'Drive File ID': c.getId(), 'Ссылка': c.getUrl(), 'Кто': s.email, 'Статус': 'OK' });
        logEvent('BACKUP', s.email, orgId, 'Копия таблицы клиента');
        return ok({ url: c.getUrl() });
      } catch (e) { /* нет доступа — команда клиенту */ }
    }
    withLock(function () { queueCommand_(orgId, 'backup'); });
    logEvent('BACKUP', s.email, orgId, 'Команда клиенту: сделать резервную копию');
    return ok({ queued: true });
  } catch (e) { return fail(e); }
}
/** Восстановить базу админ-панели из копии: текущая база сохраняется, ADMIN_SHEET_ID переключается на копию-восстановление. */
function adminBackupRestore(token, id) {
  try {
    var s = requireRole(token, 'settings'), b = findBy('Backups', 'ID', id); if (!b) throw new Error('NOT_FOUND: копия не найдена');
    if (b['OrgID']) throw new Error('VALIDATION: копию таблицы клиента восстанавливает клиент (файл: ' + b['Ссылка'] + ')');
    var cur = db().getId(), restored = DriveApp.getFileById(b['Drive File ID']).makeCopy('ЦЕХ Стандарт Admin — восстановлено ' + isoDay(), docsFolder_());
    logEvent('BACKUP', s.email, id, 'Восстановление базы из копии; прежняя база: ' + cur);
    PropertiesService.getScriptProperties().setProperty('ADMIN_SHEET_ID', restored.getId());
    _DB_ = null;
    logEvent('BACKUP', s.email, id, 'База восстановлена из копии ' + fmtDate(b['Дата'], 'dd.MM.yyyy HH:mm'));
    return ok({ sheetId: restored.getId() });
  } catch (e) { return fail(e); }
}
function adminBackupDelete(token, id) {
  try {
    var s = requireRole(token, 'settings'), b = findBy('Backups', 'ID', id); if (!b) throw new Error('NOT_FOUND: копия не найдена');
    try { DriveApp.getFileById(b['Drive File ID']).setTrashed(true); } catch (e) {}
    withLock(function () { removeRow('Backups', id); });
    logEvent('DELETE', s.email, id, 'Удалена резервная копия');
    return ok(true);
  } catch (e) { return fail(e); }
}
/* ------------------------- обновления ------------------------- */
function adminUpdates(token) {
  try { requireRole(token, 'dashboard'); return ok({ current: getSetting('CURRENT_VERSION', '1.0.0'), list: readAll('Updates').reverse(), master: !!PropertiesService.getScriptProperties().getProperty('MASTER_SCRIPT_ID') }); }
  catch (e) { return fail(e); }
}
/** Опубликовать версию: клиенты увидят уведомление «Доступно обновление» при проверке лицензии. */
function adminUpdatePublish(token, u) {
  try {
    var s = requireRole(token, 'updates'); u = u || {}; req(u, ['version', 'description']);
    if (!/^\d+\.\d+\.\d+$/.test(u.version)) throw new Error('VALIDATION: версия вида 1.2.3');
    if (findBy('Updates', 'Версия', u.version)) throw new Error('VALIDATION: такая версия уже есть');
    insert('Updates', { 'Версия': u.version, 'Дата': new Date(), 'Описание': u.description, 'Статус': 'PUBLISHED', 'Опубликовал': s.email, 'Обновлено клиентов': 0, 'Ссылка на сборку': u.link || '' });
    setSetting('CURRENT_VERSION', u.version, 'Текущая версия клиентской системы');
    logEvent('UPDATE', s.email, u.version, 'Опубликована версия: ' + u.description);
    return ok(true);
  } catch (e) { return fail(e); }
}
/**
 * Обновить код клиентов через Apps Script API: содержимое проекта-эталона (MASTER_SCRIPT_ID) записывается
 * в проект клиента (Script ID из карточки), создаётся версия, развёртывание клиента (ID из App URL) переводится на неё.
 * Работает для проектов, к которым у этого аккаунта есть доступ на редактирование (обычно — развёрнутых поставщиком).
 * orgIds пусто — все активные клиенты.
 */
function adminUpdateClients(token, orgIds, version) {
  try {
    var s = requireRole(token, 'updates'), master = PropertiesService.getScriptProperties().getProperty('MASTER_SCRIPT_ID');
    if (!master) throw new Error('VALIDATION: не задано свойство MASTER_SCRIPT_ID (проект-эталон ЦЕХ Стандарт)');
    var api = 'https://script.googleapis.com/v1/projects/', auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
    var call = function (method, path, body) {
      var r = UrlFetchApp.fetch(api + path, { method: method, headers: auth, contentType: 'application/json', muteHttpExceptions: true, payload: body ? JSON.stringify(body) : undefined });
      if (r.getResponseCode() >= 300) throw new Error('HTTP ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
      return JSON.parse(r.getContentText() || '{}');
    };
    var content = call('get', master + '/content');
    var orgs = readAll('Organizations').filter(function (o) { return o['Статус'] === 'ACTIVE' && o['Script ID'] && (!orgIds || !orgIds.length || orgIds.indexOf(o['ID']) >= 0); });
    var done = 0, results = [];
    orgs.forEach(function (o) {
      try {
        // таблица клиента: константа SHEET_ID в Code.gs эталона заменяется на таблицу клиента
        var files = content.files.map(function (f) {
          if (f.name === 'Code' && o['Google Drive ID']) f = { name: f.name, type: f.type, source: f.source.replace(/var\s+SHEET_ID\s*=\s*'[^']+'/, "var SHEET_ID        = '" + o['Google Drive ID'] + "'") };
          return f;
        });
        call('put', o['Script ID'] + '/content', { files: files });
        var ver = call('post', o['Script ID'] + '/versions', { description: 'ЦЕХ Стандарт ' + (version || '') });
        var dep = (/\/macros\/s\/([\w-]+)\/exec/.exec(String(o['App URL'] || '')) || [])[1];
        if (dep) call('put', o['Script ID'] + '/deployments/' + dep, { deploymentConfig: { scriptId: o['Script ID'], versionNumber: ver.versionNumber, manifestFileName: 'appsscript', description: 'ЦЕХ Стандарт ' + (version || '') } });
        done++; results.push({ org: o['Название'], ok: true, note: dep ? 'версия ' + ver.versionNumber + ' опубликована' : 'код обновлён; развёртывание обновит владелец' });
      } catch (e) { results.push({ org: o['Название'], ok: false, note: String(e.message || e) }); logError(o['ID'], 'Обновление клиента: ' + e.message, ''); }
    });
    if (version && findBy('Updates', 'Версия', version)) { var u = findBy('Updates', 'Версия', version); withLock(function () { update('Updates', version, { 'Обновлено клиентов': Number(u['Обновлено клиентов'] || 0) + done }); }); }
    logEvent('UPDATE', s.email, version || '', 'Обновлено клиентов: ' + done + ' из ' + orgs.length);
    return ok({ done: done, total: orgs.length, results: results });
  } catch (e) { return fail(e); }
}
/* ------------------------- база отработанных ТТК ------------------------- */
function adminTtkList(token, q) {
  try {
    requireRole(token, 'ttk.view'); q = String(q || '').toLowerCase();
    return ok(readAll('TTK_Library').filter(function (t) { return !q || (t['Название'] + ' ' + t['Категория']).toLowerCase().indexOf(q) >= 0; }).map(function (t) {
      return { id: t['ID'], name: t['Название'], category: t['Категория'], yield: t['Выход'], kcal: t['Ккал'], status: t['Статус'], source: t['Источник'], updated: t['Обновлено'] };
    }));
  } catch (e) { return fail(e); }
}
function adminTtkGet(token, id) {
  try { requireRole(token, 'ttk.view'); var t = findBy('TTK_Library', 'ID', id); if (!t) throw new Error('NOT_FOUND: карта не найдена'); return ok(t); } catch (e) { return fail(e); }
}
/** Сохранить карту. t — поля листа TTK_Library; «Состав (JSON)» — [{name, brutto, netto, unit}]. */
function adminTtkSave(token, t) {
  try {
    var s = requireRole(token, 'ttk.edit'); t = t || {}; req(t, ['Название']);
    var ing = []; try { ing = JSON.parse(t['Состав (JSON)'] || '[]'); } catch (e) { throw new Error('VALIDATION: состав — JSON-массив [{"name":"…","brutto":100,"netto":90,"unit":"г"}]'); }
    if (!Array.isArray(ing) || !ing.length) throw new Error('VALIDATION: добавьте состав');
    t['Обновлено'] = new Date(); t['Статус'] = t['Статус'] || 'DRAFT';
    withLock(function () { if (t['ID'] && findBy('TTK_Library', 'ID', t['ID'])) update('TTK_Library', t['ID'], t); else { t['ID'] = newId('TTK'); insert('TTK_Library', t); } });
    logEvent('CHANGE', s.email, t['ID'], 'База ТТК: ' + t['Название'] + ' (' + t['Статус'] + ')');
    return ok({ id: t['ID'] });
  } catch (e) { return fail(e); }
}
/** Импорт CSV (разделитель «;»): Название;Категория;Выход;Продукт:брутто:нетто:ед|…;Технология;Б;Ж;У;Ккал;Срок;Хранение;Источник */
function adminTtkImportCsv(token, csv) {
  try {
    var s = requireRole(token, 'ttk.edit'), lines = String(csv || '').split(/\r?\n/).filter(function (l) { return l.trim(); }), n = 0;
    withLock(function () {
      lines.forEach(function (l, i) {
        var c = l.split(';'); if (i === 0 && /назв/i.test(c[0])) return; if (!c[0]) return;
        var ing = String(c[3] || '').split('|').filter(Boolean).map(function (x) { var p = x.split(':'); return { name: p[0], brutto: Number(String(p[1] || '').replace(',', '.')) || 0, netto: Number(String(p[2] || '').replace(',', '.')) || 0, unit: p[3] || 'г' }; });
        insert('TTK_Library', { 'ID': newId('TTK'), 'Название': c[0], 'Категория': c[1] || '', 'Выход': c[2] || '', 'Состав (JSON)': JSON.stringify(ing), 'Технология': c[4] || '', 'Белки': c[5] || '', 'Жиры': c[6] || '', 'Углеводы': c[7] || '', 'Ккал': c[8] || '', 'Срок годности': c[9] || '', 'Условия хранения': c[10] || '', 'Источник': c[11] || 'импорт', 'Статус': 'DRAFT', 'Обновлено': new Date() });
        n++;
      });
    });
    logEvent('CHANGE', s.email, 'TTK_Library', 'Импорт CSV: ' + n + ' карт (черновики)');
    return ok({ imported: n });
  } catch (e) { return fail(e); }
}
/** Для клиентов Pro Max: только опубликованные карты. */
function ttkLibraryForClient_(org) {
  var t = tariff(org['Тариф']);
  if (org['Тариф'] !== 'pro_max') return { ok: false, error: 'База отработанных ТТК входит в тариф Pro Max' };
  return { ok: true, items: readAll('TTK_Library').filter(function (x) { return x['Статус'] === 'PUBLISHED'; }).map(function (x) {
    var ing = []; try { ing = JSON.parse(x['Состав (JSON)'] || '[]'); } catch (e) {}
    return { id: x['ID'], name: x['Название'], category: x['Категория'], yield: x['Выход'], ingredients: ing, method: x['Технология'], protein: x['Белки'], fat: x['Жиры'], carbs: x['Углеводы'], kcal: x['Ккал'], shelfLife: x['Срок годности'], storage: x['Условия хранения'], source: x['Источник'] };
  }) };
}
/* ------------------------- настройки ------------------------- */
var SECRET_PROPS = ['YOOKASSA_SHOP_ID', 'YOOKASSA_SECRET', 'YOOMONEY_WALLET', 'YOOMONEY_NOTIFY_SECRET', 'MASTER_SCRIPT_ID', 'WEBHOOK_TOKEN'];
function adminSettings(token) {
  try {
    var s = requireRole(token, 'settings.view'), p = PropertiesService.getScriptProperties();
    var props = SECRET_PROPS.map(function (k) { var v = p.getProperty(k) || ''; return { key: k, set: !!v, masked: v ? v.slice(0, 3) + '…' + v.slice(-2) : '' }; });
    return ok({ tariffs: tariffs(), provider: getSetting('PAYMENT_PROVIDER', 'manual'), returnUrl: getSetting('PAYMENT_RETURN_URL', ''), vendor: getSetting('VENDOR', { name: 'ЦЕХ Стандарт', inn: '', bank: '', account: '' }),
      mailQuota: MailApp.getRemainingDailyQuota(), webAppUrl: webAppUrl(), webhookUrl: webAppUrl() ? webAppUrl() + '?hook=payment&t=' + (p.getProperty('WEBHOOK_TOKEN') || '') : '', props: props, sheetId: db().getId(),
      apiKeys: readAll('API_Keys').map(function (k) { return { id: k['ID'], name: k['Название'], rights: k['Права'], created: k['Создан'], used: k['Последнее использование'], status: k['Статус'] }; }), canEdit: can(s, 'settings') });
  } catch (e) { return fail(e); }
}
function adminSettingsSave(token, x) {
  try {
    var s = requireRole(token, 'settings'); x = x || {};
    if (x.tariffs) {
      x.tariffs.forEach(function (t) { if (!t.code || !t.name || !(Number(t.setup) >= 0) || !(Number(t.monthly) >= 0)) throw new Error('VALIDATION: у тарифа должны быть код, название и цены'); t.setup = Number(t.setup); t.monthly = Number(t.monthly); });
      setSetting('TARIFFS', x.tariffs, 'Тарифы и цены');
    }
    if (x.provider) { if (['manual', 'yookassa', 'yoomoney'].indexOf(x.provider) < 0) throw new Error('VALIDATION: провайдер manual, yookassa или yoomoney'); setSetting('PAYMENT_PROVIDER', x.provider, 'Платёжная система'); }
    if (x.returnUrl !== undefined) setSetting('PAYMENT_RETURN_URL', x.returnUrl, 'Куда вернуть клиента после оплаты');
    if (x.vendor) setSetting('VENDOR', x.vendor, 'Реквизиты поставщика для счетов');
    var p = PropertiesService.getScriptProperties();
    Object.keys(x.props || {}).forEach(function (k) { if (SECRET_PROPS.indexOf(k) >= 0 && String(x.props[k]).trim()) p.setProperty(k, String(x.props[k]).trim()); });
    logEvent('CHANGE', s.email, 'settings', 'Изменены настройки: ' + Object.keys(x).join(', '));
    return ok(true);
  } catch (e) { return fail(e); }
}
/** API-ключ для внешних интеграций (показывается один раз; хранится хэш). */
function adminApiKeyCreate(token, name, rights) {
  try {
    var s = requireRole(token, 'settings'), key = 'tsk_' + randomToken(32), id = newId('KEY');
    insert('API_Keys', { 'ID': id, 'Название': name || 'ключ', 'Хэш ключа': sha256(key), 'Права': rights || 'read', 'Создан': new Date(), 'Статус': 'ACTIVE' });
    logEvent('CHANGE', s.email, id, 'Создан API-ключ ' + name);
    return ok({ id: id, key: key });
  } catch (e) { return fail(e); }
}
function adminApiKeyRevoke(token, id) {
  try { var s = requireRole(token, 'settings'); withLock(function () { update('API_Keys', id, { 'Статус': 'REVOKED' }); }); logEvent('CHANGE', s.email, id, 'API-ключ отозван'); return ok(true); }
  catch (e) { return fail(e); }
}
