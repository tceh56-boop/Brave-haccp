/**
 * ЦЕХ Стандарт — подписка и лицензия клиента.
 *
 * Тарифы (цены задаются в админ-панели, здесь — только состав возможностей):
 *   basic      — загрузка ТТК, сроки реализации, КБЖУ, сроки хранения, себестоимость, приёмка, маркировка, экономика;
 *   basic_pro  — всё из basic + журналы, ППК;
 *   pro        — всё из basic_pro + партии, лабораторные исследования, договоры;
 *   pro_max    — всё из pro + AI-ассистент и база отработанных ТТК.
 * Нормативы, охрана труда, должностные инструкции и акты — во всех тарифах.
 *
 * Как работает проверка:
 *   • ключ лицензии (TS_LICENSE_KEY), адрес админ-панели (TS_ADMIN_URL) и секрет подписи (TS_LICENSE_SECRET)
 *     хранятся в свойствах скрипта; вводит их директор на экране «Подписка»;
 *   • раз в 6 часов (и при входе) система спрашивает админ-панель о состоянии лицензии; ответ подписан HMAC-SHA256
 *     секретом лицензии — подделать тариф правкой ответа нельзя;
 *   • админ-панель недоступна — действует последний подтверждённый ответ до 7 дней;
 *   • лицензии нет — пробный период 14 дней с полным составом (pro_max);
 *   • лицензия истекла, заблокирована или пробный период кончился — режим «только чтение»: данные видны,
 *     журналы и отчёты открываются, новые записи не делаются (кроме экрана подписки и входа);
 *   • шлюз (zzz_MonChef_Gate.gs) вызывает _tsPlanGate_ перед каждой функцией из интерфейса.
 * Технический доступ (dev) ограничениями тарифа не останавливается — он нужен для настройки и поддержки.
 */
var TS_VERSION = '1.0.0';
var TS_PLANS_ = {
  basic: { name: 'Basic', order: 1, features: ['ttk', 'shelf_life', 'kbju', 'storage', 'costing', 'receiving', 'labeling', 'economics', 'labor_safety', 'core'] },
  basic_pro: { name: 'Basic Pro', order: 2, features: ['journals', 'ppk'] },
  pro: { name: 'Pro', order: 3, features: ['batches', 'lab', 'contracts'] },
  pro_max: { name: 'Pro Max', order: 4, features: ['ai', 'ttk_library'] }
};
var TS_PLAN_ORDER_ = ['basic', 'basic_pro', 'pro', 'pro_max'];
var TS_FEATURE_NAMES_ = {
  ttk: 'Загрузка ТТК', shelf_life: 'Сроки реализации', kbju: 'КБЖУ', storage: 'Сроки хранения', costing: 'Себестоимость',
  receiving: 'Приёмка', labeling: 'Маркировка', economics: 'Экономика', labor_safety: 'Нормативы и охрана труда', core: 'Базовые функции',
  journals: 'Журналы', ppk: 'ППК', batches: 'Партии', lab: 'Лабораторные исследования', contracts: 'Договоры',
  ai: 'AI-ассистент', ttk_library: 'База отработанных ТТК'
};
// право роли → возможность тарифа (права без записи здесь доступны во всех тарифах)
var TS_PERM_FEATURE_ = {
  journals: 'journals', haccp: 'journals', haccp_view: 'journals', haccp_approve: 'journals', checklists: 'journals',
  sanitation: 'journals', brakerage: 'journals', audit_create: 'journals', audit_view: 'journals', audit_revoke: 'journals',
  ppk_view: 'ppk', ppk_edit: 'ppk', ppk_approve: 'ppk',
  batch_use: 'batches',
  lab: 'lab', lab_view: 'lab', lab_edit: 'lab', lab_approve: 'lab', lab_upload: 'lab', tu_view: 'lab', tu_edit: 'lab', tu_approve: 'lab'
};
// функции, которым нужна другая возможность, чем следует из права (сроки годности, норм-база и складские операции
// по партиям входят в basic, хотя право у них «haccp»/«batch_use»)
var TS_FN_FEATURE_ = {
  v38BuildGaps: 'shelf_life', v38GetDashboard: 'shelf_life', v38ResolveRule: 'shelf_life', v39BuildWindow: 'shelf_life',
  v40BuildTtkProductMap: 'shelf_life', v40GetDashboard: 'shelf_life', v40SeedFromBundle: 'shelf_life',
  setPostOpeningExpiry: 'storage', mcSetProcessedExpiry: 'storage', v70DecideNorm: 'labor_safety',
  mcSaveEquipment: 'core', unblockObject: 'core', notifyResponsible: 'core', resolveCriticalIncident: 'core',
  mcSetVetControlled: 'receiving', mcTemperatureDecision: 'receiving', mcTemperatureRecheck: 'receiving',
  useBatch: 'core', openBatchContainer: 'core'
};
// разделы главного окна → возможность
var TS_SECTION_FEATURE_ = { haccp: 'journals', sanitation: 'journals', inspection: 'journals', lab: 'lab' };
// эти функции работают при любом состоянии лицензии
var TS_ALWAYS_ = ['loginWithPin', 'destroySession', 'uiMe', 'getAppUrl', 'tsGetPlanInfo', 'tsActivateLicense', 'tsRefreshLicense', 'mcReplayOffline', 'tsSupportRequest', 'tsSupportConsent', 'tsSupportRevoke'];
var TS_TRIAL_DAYS_ = 14, TS_CHECK_HOURS_ = 6, TS_OFFLINE_DAYS_ = 7, TS_GRACE_DAYS_ = 3;

/* --------------------------------------------------------------- состав тарифа */
function _tsPlanFeatures_(plan) {
  var out = {}, idx = TS_PLAN_ORDER_.indexOf(plan);
  if (idx < 0) idx = 0;
  for (var i = 0; i <= idx; i++) TS_PLANS_[TS_PLAN_ORDER_[i]].features.forEach(function (f) { out[f] = true; });
  return out;
}
function _tsMinPlanFor_(feature) {
  for (var i = 0; i < TS_PLAN_ORDER_.length; i++) if (TS_PLANS_[TS_PLAN_ORDER_[i]].features.indexOf(feature) >= 0) return TS_PLAN_ORDER_[i];
  return 'basic';
}

/* --------------------------------------------------------------- лицензия */
function _tsProps_() { return PropertiesService.getScriptProperties(); }
function _tsNow_() { return Date.now(); }
function _tsHmac_(text, secret) {
  var raw = Utilities.computeHmacSha256Signature(String(text), String(secret), Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
/** Состояние лицензии: {plan, status, mode, expiresAt, daysLeft, org, message, source}. Кэш — 10 минут. */
function _tsLicense_(force) {
  var cache = null;
  try { cache = CacheService.getScriptCache(); if (!force) { var c = cache.get('ts_license'); if (c) return JSON.parse(c); } } catch (e) {}
  var p = _tsProps_(), key = String(p.getProperty('TS_LICENSE_KEY') || '').trim(), st = null;
  var saved = null; try { saved = JSON.parse(p.getProperty('TS_LICENSE_STATE') || 'null'); } catch (e) {}
  if (!key) {
    var start = Number(p.getProperty('TS_TRIAL_START') || 0);
    if (!start) { start = _tsNow_(); p.setProperty('TS_TRIAL_START', String(start)); }
    var end = start + TS_TRIAL_DAYS_ * 864e5;
    st = end > _tsNow_()
      ? { plan: 'pro_max', status: 'TRIAL', mode: 'full', expiresAt: end, message: 'Пробный период: все возможности. Введите ключ лицензии на экране «Подписка».' }
      : { plan: 'basic', status: 'NO_LICENSE', mode: 'readonly', expiresAt: end, message: 'Пробный период закончился. Данные доступны для просмотра; для работы введите ключ лицензии.' };
    st.source = 'trial';
  } else {
    var stale = !saved || !saved.checkedAt || _tsNow_() - saved.checkedAt > TS_CHECK_HOURS_ * 36e5 || saved.key !== key;
    if (stale || force) { var fresh = _tsCheckRemote_(key); if (fresh) saved = fresh; }
    if (!saved || saved.key !== key) {
      st = { plan: 'basic', status: 'UNVERIFIED', mode: 'readonly', message: 'Ключ лицензии ещё не подтверждён админ-панелью. Проверьте адрес админ-панели и связь.' };
    } else {
      st = { plan: saved.plan, status: saved.status, expiresAt: saved.expiresAt, org: saved.org || '', message: saved.message || '', checkedAt: saved.checkedAt };
      var offlineTooLong = _tsNow_() - saved.checkedAt > TS_OFFLINE_DAYS_ * 864e5;
      var expired = saved.expiresAt && (saved.graceUntil || saved.expiresAt + TS_GRACE_DAYS_ * 864e5) < _tsNow_();
      if (saved.status === 'BLOCKED') { st.mode = 'readonly'; st.message = st.message || 'Лицензия заблокирована. Обратитесь в поддержку ЦЕХ Стандарт.'; }
      else if (expired || saved.status === 'EXPIRED') { st.mode = 'readonly'; st.status = 'EXPIRED'; st.message = 'Подписка истекла. Данные доступны для просмотра; продлите подписку.'; }
      else if (offlineTooLong) { st.mode = 'readonly'; st.status = 'OFFLINE'; st.message = 'Нет связи с админ-панелью больше ' + TS_OFFLINE_DAYS_ + ' дней — подтвердите лицензию.'; }
      else { st.mode = 'full'; if (saved.status === 'GRACE' || (saved.expiresAt && saved.expiresAt < _tsNow_())) { st.status = 'GRACE'; st.message = saved.message || 'Подписка закончилась — идёт льготный период. Продлите подписку.'; } }
    }
    st.source = 'license';
  }
  if (!TS_PLANS_[st.plan]) st.plan = 'basic';
  st.daysLeft = st.expiresAt ? Math.ceil((st.expiresAt - _tsNow_()) / 864e5) : null;
  try { if (cache) cache.put('ts_license', JSON.stringify(st), 600); } catch (e) {}
  return st;
}
/** Запрос в админ-панель. Ответ принимается, только если подпись сходится. */
function _tsCheckRemote_(key) {
  var p = _tsProps_(), url = String(p.getProperty('TS_ADMIN_URL') || '').trim(), secret = String(p.getProperty('TS_LICENSE_SECRET') || '').trim();
  if (!url || !secret) return null;
  try {
    var nonce = Utilities.getUuid(), payload = { action: 'license.check', key: key, nonce: nonce, version: TS_VERSION, stats: _tsUsageStats_() };
    try { payload.appUrl = ScriptApp.getService().getUrl() || ''; payload.scriptId = ScriptApp.getScriptId(); } catch (e) {}
    var r = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true, followRedirects: true });
    if (r.getResponseCode() !== 200) { _log_('WARN', 'лицензия: админ-панель ответила HTTP ' + r.getResponseCode()); return null; }
    var j = JSON.parse(r.getContentText());
    if (!j || !j.ok || !j.license || !j.sig) { _log_('WARN', 'лицензия: ' + (j && j.error || 'пустой ответ')); return null; }
    var body = JSON.stringify(j.license);
    if (_tsHmac_(body + '|' + nonce, secret) !== j.sig) { _log_('WARN', 'лицензия: подпись ответа не сошлась'); return null; }
    var L = j.license;
    if (L.key !== key) return null;
    var state = { key: key, plan: String(L.plan || 'basic'), status: String(L.status || 'ACTIVE'), expiresAt: Number(L.expiresAt || 0),
      org: String(L.org || ''), message: String(L.message || ''), checkedAt: _tsNow_(), notices: L.notices || [],
      enterpriseId: String(L.enterpriseId || ''), graceUntil: Number(L.graceUntil || 0), channel: String(L.channel || 'stable'), supportRequests: L.supportRequests || [] };
    if (state.enterpriseId && typeof _ts2SetCfg_ === 'function') { try { if (_ts2Cfg_('ENTERPRISE_ID', '') !== state.enterpriseId) _ts2SetCfg_('ENTERPRISE_ID', state.enterpriseId, 'LICENSE'); } catch (e) {} }
    if (L.update && L.update.version) state.notices.push({ text: 'Доступно обновление ЦЕХ Стандарт ' + L.update.version + (L.update.notes ? ': ' + L.update.notes : '') + '. Установку выполняет владелец через установщик.' });
    p.setProperty('TS_LICENSE_STATE', JSON.stringify(state));
    try { if (typeof _tsAfterCheck_ === 'function') _tsAfterCheck_(); } catch (e) {}
    (L.commands || []).forEach(function (c) { try { _tsRunCommand_(c); } catch (e) { _log_('WARN', 'команда админ-панели ' + c + ': ' + (e && e.message || e)); } });
    return state;
  } catch (e) { _log_('WARN', 'лицензия: ' + (e && e.message || e)); return null; }
}
/** Команды админ-панели: 'backup' — копия таблицы в папку резервных копий (результат уйдёт со следующей проверкой). */
function _tsRunCommand_(cmd) {
  var p = _tsProps_();
  if (cmd === 'backup') {
    var src = DriveApp.getFileById(_book_().getId()), stamp = Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd_HH-mm');
    var folder = _tsTreeFolder_('BACKUPS', '', ['Бэкапы ЦЕХ Стандарт', 'Бэкапы Mon Chef']);
    var copy = src.makeCopy('BACKUP ЦЕХ Стандарт ' + stamp, folder);
    p.setProperty('TS_LAST_BACKUP', JSON.stringify({ at: Date.now(), fileId: copy.getId(), size: copy.getSize() }));
  }
}
/** Обезличенная статистика для админ-панели: число листов и строк, версия. Без персональных данных. */
function _tsUsageStats_() {
  var out = { sheets: 0, rows: 0, ttk: 0, staff: 0, lastBackup: null };
  try { out.lastBackup = JSON.parse(_tsProps_().getProperty('TS_LAST_BACKUP') || 'null'); } catch (e) {}
  try {
    var ss = _book_(), sh = ss.getSheets(); out.sheets = sh.length;
    sh.forEach(function (s) { out.rows += Math.max(0, s.getLastRow() - 1); });
    var d = ss.getSheetByName('Блюда'); if (d) out.ttk = Math.max(0, d.getLastRow() - 1);
    var e = ss.getSheetByName('Сотрудники'); if (e) out.staff = Math.max(0, e.getLastRow() - 1);
    var ar = ss.getSheetByName('AUTO_RECORDS'); if (ar) out.autoRecords = Math.max(0, ar.getLastRow() - 1);
    if (typeof _ts2Prof_ === 'function' && ss.getSheetByName('AUTOMATION_PROFILE')) { out.mode = _ts2Prof_('mode', ''); out.seedVersion = _ts2Prof_('seedVersion', ''); }
    if (typeof TS2_SCHEMA_VERSION !== 'undefined') out.schemaVersion = TS2_SCHEMA_VERSION;
  } catch (e) {}
  return out;
}

/* --------------------------------------------------------------- шлюз */
/** '' — можно; иначе — текст отказа. Вызывается шлюзом для вызовов из интерфейса. */
function _tsPlanGate_(name, need, isMut, args) {
  if (TS_ALWAYS_.indexOf(name) >= 0) return '';
  var lic = _tsLicense_(false), feats = _tsPlanFeatures_(lic.plan);
  var feature = '';
  if (name === 'uiData' && args && args[1]) feature = TS_SECTION_FEATURE_[String(args[1])] || '';
  else if (TS_FN_FEATURE_[name]) feature = TS_FN_FEATURE_[name];
  else if (TS_GATE_FEATURE_[name]) feature = TS_GATE_FEATURE_[name];
  else if (need && need !== '*') {
    var alts = String(need).split('|'), mapped = alts.map(function (k) { return TS_PERM_FEATURE_[k] || ''; });
    if (mapped.some(function (f) { return !f || feats[f]; })) feature = '';
    else feature = mapped[0];
  }
  if (feature && !feats[feature]) {
    var min = _tsMinPlanFor_(feature);
    return '«' + (TS_FEATURE_NAMES_[feature] || feature) + '» входит в тариф ' + TS_PLANS_[min].name + ' и выше. Ваш тариф: ' +
      TS_PLANS_[lic.plan].name + '. Сменить тариф — «Подписка».';
  }
  if (isMut && lic.mode === 'readonly') return lic.message || 'Режим только чтения: подписка не активна.';
  return '';
}

/* --------------------------------------------------------------- интерфейс */
/** Состояние подписки для интерфейса: тариф, срок, доступные возможности и разделы. */
function tsGetPlanInfo(token) {
  try {
    var s = _requireAuth_(token);
    var lic = _tsLicense_(false), feats = _tsPlanFeatures_(lic.plan), p = _tsProps_();
    var locked = {}; Object.keys(TS_SECTION_FEATURE_).forEach(function (sec) { if (!feats[TS_SECTION_FEATURE_[sec]]) locked[sec] = _tsMinPlanFor_(TS_SECTION_FEATURE_[sec]); });
    var plans = TS_PLAN_ORDER_.map(function (k) {
      return { code: k, name: TS_PLANS_[k].name, features: TS_PLANS_[k].features.filter(function (f) { return f !== 'core'; }).map(function (f) { return TS_FEATURE_NAMES_[f]; }) };
    });
    var saved = null; try { saved = JSON.parse(p.getProperty('TS_LICENSE_STATE') || 'null'); } catch (e) {}
    return _ok_({
      plan: lic.plan, planName: TS_PLANS_[lic.plan].name, status: lic.status, mode: lic.mode, message: lic.message || '',
      expiresAt: lic.expiresAt ? Utilities.formatDate(new Date(lic.expiresAt), _mcTz_(), 'dd.MM.yyyy') : '', daysLeft: lic.daysLeft,
      org: lic.org || '', features: feats, featureNames: TS_FEATURE_NAMES_, lockedSections: locked, plans: plans,
      notices: saved && saved.notices || [], version: TS_VERSION, enterpriseId: saved && saved.enterpriseId || '', channel: saved && saved.channel || 'stable',
      supportRequests: saved && saved.supportRequests || [], supportUntil: Number(p.getProperty('TS_SUPPORT_UNTIL') || 0),
      keyMasked: (function (k) { return k ? k.slice(0, 6) + '…' + k.slice(-4) : ''; })(String(p.getProperty('TS_LICENSE_KEY') || '')),
      adminUrl: String(p.getProperty('TS_ADMIN_URL') || ''), canManage: !!(s.dev || _mcRbHas_(s, 'org_edit'))
    });
  } catch (e) { return _failFrom_(e); }
}
var _TS_CTL_TS_ = 0;
/** Подписанный служебный запрос в админ-панель (поддержка, согласие). */
function _tsControlCall_(payload) {
  var p = _tsProps_(), url = String(p.getProperty('TS_ADMIN_URL') || ''), key = String(p.getProperty('TS_LICENSE_KEY') || ''), secret = String(p.getProperty('TS_LICENSE_SECRET') || '');
  if (!url || !key || !secret) throw new Error('VALIDATION: лицензия не подключена');
  var now = Date.now(); _TS_CTL_TS_ = now > _TS_CTL_TS_ ? now : _TS_CTL_TS_ + 1;   // строго возрастает: две подписи в одну мс не совпадут
  var ts = String(_TS_CTL_TS_); payload.key = key; payload.ts = ts; payload.sig = _tsHmac_(key + '|' + ts, secret);
  var r = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(payload) });
  if (r.getResponseCode() !== 200) throw new Error('Админ-панель ответила HTTP ' + r.getResponseCode());
  var j = JSON.parse(r.getContentText()); if (!j.ok) throw new Error(j.error || 'запрос не принят'); return j;
}
/** Обращение в поддержку ЦЕХ Стандарт (без вложений и персональных данных — только текст). */
function tsSupportRequest(token, subject, text) {
  try { var s = _requireAuth_(token); if (!String(text || '').trim()) return _fail_('VALIDATION', 'Опишите вопрос'); var j = _tsControlCall_({ action: 'support.request', subject: subject, text: text, author: s.role || '' }); return _ok_({ ticketId: j.ticketId }); }
  catch (e) { return _failFrom_(e); }
}
/** Решение предприятия по запросу технического доступа поддержки. Разрешает только директор/администратор. */
function tsSupportConsent(token, sessionId, allow) {
  try {
    var s = _requireAuth_(token, 'org_edit');
    var yes = allow === true || allow === 'true', req = null;
    try { req = (JSON.parse(_tsProps_().getProperty('TS_LICENSE_STATE') || '{}').supportRequests || []).filter(function (x) { return x.sessionId === sessionId; })[0]; } catch (e) {}
    var until = Date.now() + Math.min(480, Number(req && req.minutes) || 60) * 60000, key = yes && typeof _tsDiagIssue_ === 'function' ? _tsDiagIssue_(sessionId, until) : '';
    var j = _tsControlCall_({ action: 'support.consent', sessionId: sessionId, allow: yes, diagKey: key, by: (s.name || '') + ' (' + (s.role || '') + ')' });
    if (j.status === 'GRANTED') _tsProps_().setProperty('TS_SUPPORT_UNTIL', String(j.expiresAt)); else if (typeof _tsDiagRevoke_ === 'function') _tsDiagRevoke_(); else _tsProps_().deleteProperty('TS_SUPPORT_UNTIL');
    try { var st = JSON.parse(_tsProps_().getProperty('TS_LICENSE_STATE') || 'null'); if (st) { st.supportRequests = (st.supportRequests || []).filter(function (x) { return x.sessionId !== sessionId; }); _tsProps_().setProperty('TS_LICENSE_STATE', JSON.stringify(st)); } } catch (e) {}
    if (typeof _ts2Audit_ === 'function') { try { _ts2Audit_('SUPPORT_CONSENT', 'SUPPORT_SESSION', sessionId, undefined, { status: j.status }, ''); } catch (e) {} }
    return _ok_({ status: j.status, expiresAt: j.expiresAt });
  } catch (e) { return _failFrom_(e); }
}
/** Ввести ключ лицензии, адрес админ-панели и секрет. Сразу проверяет ключ. */
function tsActivateLicense(token, key, adminUrl, secret) {
  try {
    var s = _requireAuth_(token, 'org_edit');
    key = String(key || '').trim(); adminUrl = String(adminUrl || '').trim(); secret = String(secret || '').trim();
    if (!/^[A-Z0-9-]{10,64}$/i.test(key)) return _fail_('VALIDATION', 'Ключ лицензии — латинские буквы, цифры и дефисы (например TS-XXXX-XXXX-XXXX)');
    if (adminUrl && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(adminUrl)) return _fail_('VALIDATION', 'Адрес админ-панели — ссылка веб-приложения вида https://script.google.com/macros/s/…/exec');
    var p = _tsProps_();
    p.setProperty('TS_LICENSE_KEY', key);
    if (adminUrl) p.setProperty('TS_ADMIN_URL', adminUrl);
    if (secret) p.setProperty('TS_LICENSE_SECRET', secret);
    try { CacheService.getScriptCache().remove('ts_license'); } catch (e) {}
    var st = _tsLicense_(true);
    try { _audit_({ id: '', type: 'LICENSE', tenant: _defaultTenant_(), session: s }, 'LICENSE_ACTIVATE', 'Подписка', key.slice(0, 6), null, { plan: st.plan, status: st.status }); } catch (e) {}
    if (st.status === 'UNVERIFIED') return _fail_('VALIDATION', 'Ключ сохранён, но админ-панель его не подтвердила. Проверьте ключ, секрет и адрес админ-панели.');
    return _ok_({ plan: st.plan, status: st.status });
  } catch (e) { return _failFrom_(e); }
}
/** Проверить лицензию сейчас (кнопка «Обновить»). */
function tsRefreshLicense(token) {
  try { _requireAuth_(token); var st = _tsLicense_(true); return _ok_({ plan: st.plan, status: st.status, message: st.message }); }
  catch (e) { return _failFrom_(e); }
}
/** Ежедневная проверка по расписанию (installTsTriggers). */
function tsLicenseDailyCheck() { _tsLicense_(true); }
function installTsTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tsLicenseDailyCheck') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tsLicenseDailyCheck').timeBased().everyDays(1).atHour(5).create();
  return 'Создан ежедневный триггер проверки лицензии';
}

/* --------------------------------------------------------------- регистрация в шлюзе */
// Функции модулей ЦЕХ Стандарт для интерфейса: имя, право роли, запись ли это, возможность тарифа.
// Шлюз (zzz_MonChef_Gate.gs) добавляет их в свои списки при загрузке.
var TS_GATE_ = [
  { n: 'tsGetPlanInfo', need: '*' },
  { n: 'tsActivateLicense', need: 'org_edit', mut: true },
  { n: 'tsRefreshLicense', need: '*' },
  { n: 'tsSupportRequest', need: '*', mut: true },
  { n: 'tsSupportConsent', need: 'org_edit', mut: true },
  { n: 'tsSupportRevoke', need: 'org_edit', mut: true },
  { n: 'tsLsGetAll', need: '*', f: 'labor_safety' },
  { n: 'tsLsGetDoc', need: '*', f: 'labor_safety' },
  { n: 'tsLsSaveDoc', need: 'personnel', mut: true, f: 'labor_safety' },
  { n: 'tsLsSaveRecord', need: 'personnel', mut: true, f: 'labor_safety' },
  { n: 'tsLsVerifyNorm', need: 'personnel|haccp_approve', mut: true, f: 'labor_safety' },
  { n: 'ts4TenantIntegrityCheck', need: 'org_edit' },
  { n: 'tsExecStatus', need: 'org_edit' },
  // V43: проверка связей и нарушения (Мастер-промт 4.0, этап 1)
  { n: 'v43ReviewLink', need: 'sanitation|haccp_approve', mut: true },
  { n: 'v43ResolveDeviation', need: 'sanitation|checklists', mut: true },
  { n: 'v43VerifyDeviation', need: 'sanitation|haccp_approve', mut: true },
  { n: 'v43GetLinks', need: 'sanitation|checklists' },
  // Мастер-промт 4.0, этап 2 — анализ процессов ТТК
  { n: 'ttkProcAnalyze', need: 'ttk_edit|haccp|ppk_edit', mut: true },
  { n: 'ttkProcOverview', need: 'ttk_edit|ttk_approve|haccp|ppk_view|ppk_edit' },
  { n: 'ttkProcOf', need: 'ttk_edit|ttk_approve|haccp|ppk_view|ppk_edit' },
  { n: 'ttkProcReview', need: 'ttk_edit|ttk_approve|haccp_approve|ppk_edit', mut: true },
  { n: 'ttkProcSetStatus', need: 'ttk_edit', mut: true },
  { n: 'ttkProcAiSuggest', need: 'ttk_edit|haccp', mut: true },
  { n: 'ttkProcDictionarySave', need: 'ttk_approve|haccp_approve', mut: true },
  // Мастер-промт 4.0, этап 3 — связь ТТК → ХАССП
  { n: 'haccpLinkSync', need: 'haccp|haccp_approve|ppk_edit', mut: true },
  { n: 'haccpLinkMap', need: 'haccp|haccp_view|haccp_approve|ppk_view|ppk_edit' },
  { n: 'haccpHazardDecide', need: 'haccp_approve', mut: true },
  // Мастер-промт 4.0, этап 4 — один генератор ППК; прежние разделы V35/V37 — просмотр и перенос в ХАССП
  { n: 'ppkLegacyState', need: 'haccp|haccp_view|haccp_approve|ppk_view|ppk_edit' },
  { n: 'ppkLegacyImport', need: 'haccp_approve', mut: true },
  // Мастер-промт 4.0, этап 5 — чек-листы из действующей ППК
  { n: 'clgBuild', need: 'ppk_edit|haccp|haccp_approve', mut: true },
  { n: 'clgTemplates', need: 'ppk_view|ppk_edit|haccp|haccp_view|checklists|sanitation' },
  // Мастер-промт 4.0, этап 6 — единый контур нарушений
  { n: 'vioList', need: 'haccp|haccp_view|haccp_approve|prod_manage|sanitation|journals' },
  { n: 'vioCorrect', need: 'haccp|prod_manage|sanitation|journals', mut: true },
  { n: 'vioVerify', need: 'haccp|haccp_approve|prod_manage|sanitation', mut: true },
  { n: 'vioSetVerifyMode', need: 'org_edit', mut: true },
  // Мастер-промт 4.0, этап 7 — санитарный аудит 360° (контрольный лист готовности R01–R28)
  { n: 'a360Run', need: 'audit_create|audit_view|haccp_view|haccp|haccp_approve|ppk_view|ppk_edit' },
  { n: 'a360MigrateViolations', need: 'haccp_approve', mut: true },
  { n: 'v43GetDeviations', need: 'sanitation|checklists' },
  { n: 'tsBackgroundEnable', need: 'org_edit', mut: true },
  { n: 'tsLsNormsSync', need: 'personnel|haccp_approve', mut: true, f: 'labor_safety' },
  { n: 'tsLsCreateAct', need: 'personnel|haccp|documents', mut: true, f: 'labor_safety' },
  { n: 'tsLsGetAct', need: '*', f: 'labor_safety' },
  { n: 'tsContractsList', need: 'documents_view|documents', f: 'contracts' },
  { n: 'tsContractSave', need: 'documents', mut: true, f: 'contracts' },
  { n: 'tsContractUpload', need: 'documents', mut: true, f: 'contracts' },
  { n: 'tsAiAsk', need: '*', mut: true, f: 'ai' },
  { n: 'tsAiHistory', need: '*', f: 'ai' },
  { n: 'tsTtkLibrary', need: 'catalog|ttk_edit', f: 'ttk_library' },
  { n: 'tsTtkLibraryCard', need: 'catalog|ttk_edit', f: 'ttk_library' },
  // ЦЕХ Стандарт 2.0: реестры, импорт, сверка, миграция, резервные копии, журнал аудита
  { n: 'ts2Status', need: '*' },
  { n: 'ts2InstallSchema', need: 'org_edit', mut: true },
  { n: 'ts2VerifyAudit', need: 'audit_view|org_edit' },
  { n: 'ts2Backups', need: 'org_edit' },
  { n: 'ts2CreateBackup', need: 'org_edit', mut: true },
  { n: 'ts2Upload', need: 'documents|ttk_edit', mut: true },
  { n: 'ts2ProcessImport', need: 'documents|ttk_edit', mut: true },
  { n: 'ts2Imports', need: 'documents_view|documents|ttk_edit' },
  { n: 'ts2ReviewImportItem', need: 'documents|ttk_edit', mut: true },
  { n: 'ts2ApplyImport', need: 'documents|ttk_edit', mut: true },
  { n: 'ts2Documents', need: 'documents_view|documents' },
  { n: 'ts2RunReconciliation', need: 'org_edit|haccp_approve|ttk_edit', mut: true },
  { n: 'ts2Reconciliation', need: '*' },
  { n: 'ts2ApproveProposal', need: 'org_edit|haccp_approve|ttk_edit', mut: true },
  { n: 'ts2ApplyProposals', need: 'org_edit|haccp_approve', mut: true },
  { n: 'ts2RollbackProposal', need: 'org_edit', mut: true },
  { n: 'ts2MigrationAnalyze', need: 'org_edit' },
  { n: 'ts2MigrationPreview', need: 'org_edit' },
  { n: 'ts2MigrationExecute', need: 'org_edit', mut: true },
  // 2.1: режим «Готов к работе» (журналы — с тарифа Basic Pro)
  { n: 'ts2InitializeReadyToWork', need: 'org_edit', mut: true, f: 'journals' },
  { n: 'ts2Wizard', need: '*', f: 'journals' },
  { n: 'ts2WizardSave', need: 'org_edit', mut: true, f: 'journals' },
  { n: 'ts2Readiness', need: '*', mut: true, f: 'journals' },
  { n: 'ts2Now', need: '*', mut: true, f: 'journals' },
  { n: 'ts2Confirm', need: 'journals', mut: true, f: 'journals' },
  { n: 'ts2Measure', need: 'journals', mut: true, f: 'journals' },
  { n: 'ts2Exceptions', need: '*', f: 'journals' },
  { n: 'ts2ResolveException', need: 'haccp|haccp_approve', mut: true, f: 'journals' },
  { n: 'ts2ApprovalQueue', need: '*', f: 'journals' },
  { n: 'ts2SystemDoc', need: '*', mut: true, f: 'journals' },
  { n: 'ts2Sensors', need: '*', f: 'journals' },
  { n: 'ts2Archives', need: '*' },
  { n: 'ts2CateringLabels', need: 'banquets', mut: true },
  { n: 'ts2SensorRegister', need: 'org_edit', mut: true, f: 'journals' },
  { n: 'ts2SensorRevoke', need: 'org_edit', mut: true, f: 'journals' },
  { n: 'ts2SensorCalibrate', need: 'org_edit', mut: true, f: 'journals' },
  { n: 'tsOrderDraft', need: 'procurement' },
  { n: 'tsSupplierCard', need: 'procurement' },
  { n: 'tsOrdersBuild', need: 'procurement', mut: true },
  { n: 'tsOrderLetter', need: 'procurement' },
  { n: 'tsOrderSend', need: 'procurement', mut: true },
  { n: 'tsOrdersSendMany', need: 'procurement', mut: true },
  { n: 'ts2ObjectInputMode', need: 'org_edit', mut: true, f: 'journals' },
  { n: 'ts2ApproveQueueItem', need: 'haccp_approve|org_edit|ppk_approve', mut: true },
  { n: 'ts2RequestLaunchProtocol', need: 'org_edit|haccp_approve', mut: true, f: 'journals' },
  // 2.2: ТТК → ТУ / СТО / ППК (ППК — с Basic Pro; ТУ создаются только при тарифе с лабораторией)
  { n: 'ts2GenList', need: '*', f: 'ppk' },
  { n: 'ts2GenPreview', need: 'ppk_edit|ttk_edit', mut: true, f: 'ppk' },
  { n: 'ts2GenCard', need: '*', f: 'ppk' },
  { n: 'ts2GenApply', need: 'ppk_edit|ttk_edit', mut: true, f: 'ppk' },
  { n: 'ts2GenApprove', need: 'ppk_approve|haccp_approve', mut: true, f: 'ppk' },
  { n: 'ts2GenResolveIssue', need: 'ppk_edit|haccp_approve', mut: true, f: 'ppk' }
];
var TS_GATE_FEATURE_ = (function () { var m = {}; TS_GATE_.forEach(function (g) { if (g.f) m[g.n] = g.f; }); return m; })();
