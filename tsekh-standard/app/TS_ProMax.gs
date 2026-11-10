/**
 * ЦЕХ Стандарт — тариф Pro Max: AI-ассистент и база отработанных ТТК.
 *
 * AI-ассистент — YandexGPT с ключами предприятия (YANDEX_API_KEY, YANDEX_FOLDER_ID — те же, что для скана бланков).
 *   Отвечает на вопросы технолога, шеф-повара, ответственного за ХАССП и охрану труда. В подсказку передаётся
 *   реестр нормативов системы и, если выбрано, состав ТТК — ассистент ссылается только на них и всегда просит сверить
 *   ответ с первоисточником. Ответ ассистента — совет, а не запись ХАССП: в журналы он сам ничего не пишет.
 *   Вопросы и ответы — в листе «ЦС_AI_Журнал» (кто, когда, вопрос, ответ) для разбора.
 *
 * База отработанных ТТК — библиотека проверенных карт, которую ведёт поставщик системы в админ-панели.
 *   Система загружает её по ключу лицензии (запрос подписан секретом лицензии) и хранит копию в листе
 *   «ЦС_База_ТТК» (обновление раз в сутки). Карту можно открыть и добавить в свои ТТК (createDish) —
 *   дальше она живёт как обычная карта предприятия: проверка, утверждение, версии.
 */
var TS_AI_LOG_ = 'ЦС_AI_Журнал', TS_AI_HEAD_ = ['Когда', 'Кто', 'Роль', 'Вопрос', 'Ответ', 'ТТК в контексте'];
var TS_LIB_SHEET_ = 'ЦС_База_ТТК', TS_LIB_HEAD_ = ['ID', 'Название', 'Категория', 'Выход, г', 'Состав (JSON)', 'Технология', 'Белки', 'Жиры', 'Углеводы', 'Ккал', 'Срок годности', 'Условия хранения', 'Источник', 'Обновлено'];

/* ------------------------------------------------------------------ AI-ассистент */
function _tsAiSystem_(ttkText) {
  var norms = '';
  try { _tsLsSeed_(); norms = _tsLsRows_('norms').map(function (r) { return '- ' + r['Документ'] + ' — ' + r['Название'] + ' [' + r['Статус'] + ']'; }).join('\n'); } catch (e) {}
  return 'Ты — AI-ассистент системы «ЦЕХ Стандарт» для предприятий общественного питания в России: технолог, специалист по ХАССП, ' +
    'санитарным правилам и охране труда. Отвечай по-русски, кратко и по делу, списком шагов, где это уместно. ' +
    'Ссылайся только на документы из реестра ниже; если нужной нормы в реестре нет или ты не уверен в цифре — прямо скажи, что её нужно ' +
    'проверить по первоисточнику, и не придумывай номера пунктов, температуры и сроки. Не давай медицинских и юридических заключений — ' +
    'только ориентиры для сотрудника. В конце ответа одной строкой: «Сверьте с первоисточником перед применением».\n\n' +
    'Реестр нормативов предприятия:\n' + norms + (ttkText ? '\n\nТехнико-технологическая карта, о которой спрашивают:\n' + ttkText : '');
}
/** Вопрос ассистенту. history — до 6 последних реплик [{role:'user'|'assistant', text}]; ttkCode — код ТТК для контекста. */
function tsAiAsk(token, question, history, ttkCode) {
  try {
    var s = _requireAuth_(token);
    question = String(question || '').trim();
    if (question.length < 3) return _fail_('VALIDATION', 'Задайте вопрос');
    if (question.length > 2000) question = question.slice(0, 2000);
    var p = PropertiesService.getScriptProperties();
    var key = _clean1_(p.getProperty('YANDEX_API_KEY')), folder = _clean1_(p.getProperty('YANDEX_FOLDER_ID'));
    if (!key || !folder) return _fail_('VALIDATION', 'AI-ассистент не настроен: в свойствах скрипта нужны YANDEX_API_KEY и YANDEX_FOLDER_ID (те же, что для скана бланков).');
    var ttkText = ttkCode ? _tsTtkText_(String(ttkCode)) : '';
    var msgs = [{ role: 'system', text: _tsAiSystem_(ttkText) }];
    (Array.isArray(history) ? history.slice(-6) : []).forEach(function (h) {
      if (h && (h.role === 'user' || h.role === 'assistant') && h.text) msgs.push({ role: h.role, text: String(h.text).slice(0, 2000) });
    });
    msgs.push({ role: 'user', text: question });
    var model = String(p.getProperty('TS_AI_MODEL') || 'yandexgpt/latest');
    var r = UrlFetchApp.fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Api-Key ' + key, 'x-folder-id': folder },
      payload: JSON.stringify({ modelUri: 'gpt://' + folder + '/' + model, completionOptions: { stream: false, temperature: 0.2, maxTokens: '1500' }, messages: msgs })
    });
    var code = r.getResponseCode();
    if (code !== 200) return _fail_('INTERNAL', typeof _bqCheckAdvice_ === 'function' ? (_bqCheckAdvice_('gpt', code, r.getContentText()) || 'YandexGPT ответил HTTP ' + code) : 'YandexGPT ответил HTTP ' + code);
    var j = JSON.parse(r.getContentText()), alt = j.result && j.result.alternatives && j.result.alternatives[0];
    var answer = alt && alt.message ? String(alt.message.text || '').trim() : '';
    if (!answer) return _fail_('INTERNAL', 'Пустой ответ ассистента — повторите вопрос');
    try { _bcSheet_(TS_AI_LOG_, TS_AI_HEAD_).appendRow([new Date(), String(s.name || ''), String(s.role || ''), question, answer, ttkCode || '']); } catch (e) {}
    return _ok_({ answer: answer });
  } catch (e) { return _failFrom_(e); }
}
/** Последние вопросы текущего сотрудника. */
function tsAiHistory(token) {
  try {
    var s = _requireAuth_(token), sh = _bcSheet_(TS_AI_LOG_, TS_AI_HEAD_), v = sh.getDataRange().getValues(), out = [];
    for (var i = v.length - 1; i >= 1 && out.length < 30; i--) if (String(v[i][1]) === String(s.name || '')) out.push({ at: Utilities.formatDate(new Date(v[i][0]), _mcTz_(), 'dd.MM HH:mm'), q: v[i][3], a: v[i][4] });
    return _ok_(out);
  } catch (e) { return _failFrom_(e); }
}
/** Состав ТТК предприятия текстом (листы «Блюда» и «Состав»). */
function _tsTtkText_(code) {
  try {
    var ss = _book_(), d = ss.getSheetByName('Блюда'), c = ss.getSheetByName('Состав'); if (!d || !c) return '';
    var dv = d.getDataRange().getValues(), row = null;
    for (var i = 1; i < dv.length; i++) if (String(dv[i][0]) === code) { row = dv[i]; break; }
    if (!row) return '';
    var lines = c.getDataRange().getValues().filter(function (x) { return String(x[0]) === code; }).map(function (x) { return '  ' + x[1] + ' — ' + x[3] + ' ' + x[2]; });
    return 'ТТК ' + code + ' «' + row[1] + '», выход: ' + (row[3] || '—') + '\nСостав:\n' + lines.join('\n') + (row[5] ? '\nТехнология: ' + String(row[5]).slice(0, 1500) : '');
  } catch (e) { return ''; }
}

/* ------------------------------------------------------------------ база отработанных ТТК */
function _tsLibSheet_() { return _bcSheet_(TS_LIB_SHEET_, TS_LIB_HEAD_); }
/** Загрузить библиотеку из админ-панели (не чаще раза в сутки, force — сейчас). */
function _tsLibSync_(force) {
  var p = PropertiesService.getScriptProperties(), last = Number(p.getProperty('TS_LIB_SYNCED') || 0);
  if (!force && Date.now() - last < 864e5 && _tsLibSheet_().getLastRow() > 1) return { synced: false };
  var url = String(p.getProperty('TS_ADMIN_URL') || ''), key = String(p.getProperty('TS_LICENSE_KEY') || ''), secret = String(p.getProperty('TS_LICENSE_SECRET') || '');
  if (!url || !key || !secret) return { synced: false, error: 'Лицензия не подключена — база ТТК загружается из админ-панели по ключу лицензии.' };
  var ts = String(Date.now()), sig = _tsHmac_(key + '|' + ts, secret);
  var r = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ action: 'ttk.library', key: key, ts: ts, sig: sig }) });
  if (r.getResponseCode() !== 200) return { synced: false, error: 'Админ-панель ответила HTTP ' + r.getResponseCode() };
  var j = JSON.parse(r.getContentText());
  if (!j.ok) return { synced: false, error: j.error || 'база ТТК недоступна' };
  var rows = (j.items || []).map(function (x) {
    return [x.id, x.name, x.category || '', x.yield || '', JSON.stringify(x.ingredients || []), x.method || '', x.protein || '', x.fat || '', x.carbs || '', x.kcal || '', x.shelfLife || '', x.storage || '', x.source || 'ЦЕХ Стандарт', new Date()];
  });
  _withLock_(function () {
    var sh = _tsLibSheet_(); if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, TS_LIB_HEAD_.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, TS_LIB_HEAD_.length).setValues(rows);
  });
  p.setProperty('TS_LIB_SYNCED', String(Date.now()));
  return { synced: true, count: rows.length };
}
/** Поиск по базе отработанных ТТК: название, категория. */
function tsTtkLibrary(token, query, refresh) {
  try {
    _requireAuth_(token);
    var sync = { synced: false };
    try { sync = _tsLibSync_(!!refresh); } catch (e) { sync = { synced: false, error: String(e.message || e) }; }
    var v = _tsLibSheet_().getDataRange().getValues(), q = String(query || '').toLowerCase().replace(/ё/g, 'е').trim(), out = [], cats = {};
    for (var i = 1; i < v.length; i++) {
      if (!v[i][0]) continue;
      cats[v[i][2] || 'Без категории'] = (cats[v[i][2] || 'Без категории'] || 0) + 1;
      var hay = (String(v[i][1]) + ' ' + String(v[i][2])).toLowerCase().replace(/ё/g, 'е');
      if (q && hay.indexOf(q) < 0) continue;
      if (out.length < 200) out.push({ id: v[i][0], name: v[i][1], category: v[i][2], yield: v[i][3], kcal: v[i][9], source: v[i][12] });
    }
    return _ok_({ items: out, total: v.length - 1, categories: cats, sync: sync });
  } catch (e) { return _failFrom_(e); }
}
/** Полная карта из базы: состав, технология, КБЖУ, сроки. */
function tsTtkLibraryCard(token, id) {
  try {
    _requireAuth_(token);
    var v = _tsLibSheet_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) {
      var ing = []; try { ing = JSON.parse(v[i][4] || '[]'); } catch (e) {}
      return _ok_({ id: v[i][0], name: v[i][1], category: v[i][2], yield: v[i][3], ingredients: ing, method: v[i][5], protein: v[i][6], fat: v[i][7], carbs: v[i][8], kcal: v[i][9], shelfLife: v[i][10], storage: v[i][11], source: v[i][12] });
    }
    return _fail_('NOT_FOUND', 'Карта не найдена в базе');
  } catch (e) { return _failFrom_(e); }
}
