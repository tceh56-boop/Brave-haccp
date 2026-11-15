// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
/**
 * ЦЕХ Стандарт V77 — интеграция с 1С, этап 3.
 *
 * 1. ЦЕХ → 1С (файлом, работает с любой конфигурацией: «Бухгалтерия», «Общепит», «Розница», УТ):
 *    v77Export1C — таблица CSV (разделитель «;», десятичная запятая, UTF-8 с BOM) для загрузки в табличную часть документа 1С
 *    кнопкой «Загрузить из файла» / обработкой «Загрузка данных из табличного документа»:
 *      • sales     — продажи по дням и блюдам (журнал продаж J36) → «Отчёт о розничных продажах»;
 *      • writeoffs — списания по себестоимости партий (акты списания, списания вручную и по сроку — из журнала экономики V64) → «Списание товаров»;
 *      • purchases — поступления по партиям приёмки (Приёмка_Партии + Склад_Партии, ИНН из справочника поставщиков) → сверка с «Поступлением товаров».
 *    Повторная выгрузка того же периода даёт тот же файл: ЦЕХ ничего не помечает «выгруженным», задвоение в 1С проверяет бухгалтер по номеру/дате.
 * 2. 1С → ЦЕХ (по сети, стандартный интерфейс OData 1С — база должна быть опубликована на веб-сервере, интерфейс OData включён):
 *    v77OneCPull — проведённые документы «Поступление товаров и услуг» за период в лист «Инт_Накладные_1С» (без дублей)
 *    и сверка с приёмкой ЦЕХ тем же правилом, что накладные iiko: поступление в 1С без приёмки в ЦЕХ — товар не прошёл входной контроль.
 *    Партии автоматически не создаются.
 *    Для Basic-авторизации 1С пароль нужен как есть: он хранится в свойствах проекта на сервере ЦЕХ и в экран/аудит не уходит.
 *    Названия объектов OData можно поменять в настройках (names), если конфигурация клиента их называет иначе.
 */
var MC_V77_1C_PROP = 'MC_V77_1C';
var MC_V77_1C_NAMES = { doc: 'Document_ПоступлениеТоваровУслуг', items: 'Товары', item: 'Номенклатура_Key', inNo: 'НомерВходящегоДокумента', partner: 'Контрагент_Key',
  nom: 'Catalog_Номенклатура', partners: 'Catalog_Контрагенты', inn: 'ИНН', units: 'Catalog_КлассификаторЕдиницИзмерения', unit: 'ЕдиницаИзмерения_Key' };
var MC_V77_INV_1C = 'Инт_Накладные_1С';

/* ---------------- ЦЕХ → 1С: выгрузка ---------------- */
function _v77Csv_(head, rows) {
  var cell = function (x) {
    if (typeof x === 'number') return String(Math.round(x * 1000) / 1000).replace('.', ',');
    var s = String(x === undefined || x === null ? '' : x);
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [head].concat(rows).map(function (r) { return r.map(cell).join(';'); }).join('\r\n') + '\r\n';
}
function _v77DayOf_(x) { var d = x instanceof Date ? x : _v64Date_(x); return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null; }
function _v77Export1CSales_(rg) {
  var j = _mcJById_('J36'), sh = _book_().getSheetByName(j.sheetName), agg = {}, idx = _buildDishIndexes_();
  if (sh && sh.getLastRow() > 1) {
    var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x || '').trim(); }), c = function (n) { return h.indexOf(n); };
    for (var i = 1; i < v.length; i++) {
      var r = v[i], dish = String(r[c('Блюдо')] || '').trim(), d = _v77DayOf_(r[c('Дата')]); if (!dish || !d || d < rg.from || d > rg.to) continue;
      var qty = Number(r[c('Количество')]) || 0, sum = Number(r[c('Сумма')]) || 0, k = _v77DayIso_(d) + '|' + dish;
      var a = agg[k] || (agg[k] = { day: d, dish: dish, qty: 0, sum: 0 }); a.qty += qty; a.sum += sum;
    }
  }
  var rows = Object.keys(agg).sort().map(function (k) {
    var a = agg[k], dd = idx.dishByNormName[_normNameServer_(a.dish)];
    return [_v77DayRu_(a.day), a.dish, dd ? String(dd.code) : '', _v77R3_(a.qty), dd ? 'порц' : 'шт', a.qty ? _v77R2_(a.sum / a.qty) : 0, _v77R2_(a.sum)];
  });
  return { head: ['Дата', 'Номенклатура', 'Код', 'Количество', 'Ед.', 'Цена', 'Сумма'], rows: rows, total: _v77R2_(rows.reduce(function (s, r) { return s + r[6]; }, 0)),
    doc: '«Отчёт о розничных продажах» (по дню — отдельный документ или одна строка на блюдо за день)' };
}
function _v77Export1CWriteoffs_(rg) {
  var agg = {};
  _v64Build_(rg).lines.forEach(function (l) {
    if (l.stage !== 'WASTE' || !l.product) return;
    var d = _v77DayOf_(l.date); if (!d) return;
    var reason = MC_V64_WASTE_REASON_RU[l.reason] || l.reason || '', k = [_v77DayIso_(d), l.product, l.unit, reason, l.ref].join('|');
    var a = agg[k] || (agg[k] = { day: d, product: String(l.product), unit: String(l.unit || ''), reason: reason, ref: String(l.ref || ''), qty: 0, sum: 0 });
    a.qty += Number(l.qty) || 0; a.sum += Math.abs(Number(l.amount) || 0);
  });
  var rows = Object.keys(agg).sort().map(function (k) { var a = agg[k]; return [_v77DayRu_(a.day), a.product, _v77R3_(a.qty), a.unit, _v77R2_(a.sum), a.reason, a.ref]; });
  return { head: ['Дата', 'Номенклатура', 'Количество', 'Ед.', 'Сумма', 'Причина', 'Документ ЦЕХ'], rows: rows, total: _v77R2_(rows.reduce(function (s, r) { return s + r[4]; }, 0)),
    doc: '«Списание товаров» (сумма — себестоимость по партиям ЦЕХ)' };
}
function _v77Export1CPurchases_(rg) {
  var bs = _stockBatchesSheet_().getDataRange().getValues(), B = {}, inn = {};
  for (var i = 1; i < bs.length; i++) if (bs[i][0]) B[String(bs[i][0])] = { product: String(bs[i][1] || ''), unit: String(bs[i][2] || ''), qty: Number(bs[i][3]) || 0, price: Number(bs[i][6]) || 0, got: bs[i][4] };
  try { (typeof _mdSuppliers_ === 'function' ? _mdSuppliers_() : []).forEach(function (s) { if (s && s.name) inn[_v77Norm_(s.name)] = String(s.inn || ''); }); } catch (e) {}
  var ps = _book_().getSheetByName('Приёмка_Партии'), rows = [];
  if (ps && ps.getLastRow() > 1) {
    var v = ps.getDataRange().getValues(), h = v[0].map(function (x) { return String(x || '').trim(); }), c = function (n) { return h.indexOf(n); };
    for (var r = 1; r < v.length; r++) {
      var x = v[r], b = B[String(x[c('BatchID')])] || {}, d = _v77DayOf_(x[c('Дата накладной')] || x[c('Принято')] || b.got); if (!d || d < rg.from || d > rg.to) continue;
      var sup = String(x[c('Поставщик')] || ''), qty = Number(x[c('Кол-во')]) || b.qty || 0, price = Number(x[c('Цена за ед.')]) || b.price || 0, sum = Number(x[c('Стоимость')]) || _v77R2_(qty * price);
      rows.push([_v77DayRu_(d), sup, inn[_v77Norm_(sup)] || '', String(x[c('Накладная')] || ''), String(x[c('Продукт')] || b.product || ''), _v77R3_(qty), String(x[c('Ед.')] || b.unit || ''), _v77R2_(price), _v77R2_(sum), String(x[c('BatchID')] || '')]);
    }
  }
  rows.sort(function (a, b) { return a[0].split('.').reverse().join('') < b[0].split('.').reverse().join('') ? -1 : 1; });
  return { head: ['Дата', 'Поставщик', 'ИНН', 'Накладная', 'Номенклатура', 'Количество', 'Ед.', 'Цена', 'Сумма', 'Партия ЦЕХ'], rows: rows, total: _v77R2_(rows.reduce(function (s, r) { return s + r[8]; }, 0)),
    doc: '«Поступление товаров» — для сверки с документами бухгалтерии (поступления в 1С обычно вводятся по документам поставщика)' };
}
/** Выгрузка для 1С. json: {kind: sales|writeoffs|purchases, from, to}. → {fileName, csv, lines, total, doc}. */
function v77Export1C(json, token) {
  try {
    _requireAuth_(token, 'finance_view');
    var d = _v64Json_(json), kind = String(d.kind || ''), rg = _v64Range_(d.from, d.to);
    var f = { sales: _v77Export1CSales_, writeoffs: _v77Export1CWriteoffs_, purchases: _v77Export1CPurchases_ }[kind];
    if (!f) return _fail_('VALIDATION', 'Что выгрузить: продажи, списания или поступления');
    var X = f(rg);   // имя файла латиницей: браузеры и почта не всегда сохраняют кириллицу в имени скачанного файла
    return _ok_({ kind: kind, fileName: 'tsekh_1c_' + kind + '_' + rg.fromIso + '_' + rg.toIso + '.csv', csv: _v77Csv_(X.head, X.rows), lines: X.rows.length, total: X.total, doc: X.doc,
      head: X.head, sample: X.rows.slice(0, 10) });
  } catch (e) { return _failFrom_(e); }
}

/* ---------------- 1С → ЦЕХ: поступления по OData ---------------- */
function _v77OneCCfg_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(MC_V77_1C_PROP) || 'null'); } catch (e) { return null; } }
function _v77OneCPublic_(c) { c = c || {}; return { configured: !!(c.url && c.login), url: c.url || '', login: c.login || '', lastSync: c.lastSync || '', lastError: c.lastError || '', names: c.names || {}, defaultNames: MC_V77_1C_NAMES }; }
function _v77OneCUrl_(u) {
  u = String(u || '').trim().replace(/\s+/g, ''); if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '').replace(/\/odata(\/standard\.odata)?$/i, '');
  return /^https?:\/\/[^\/?#]+/i.test(u) ? u : '';
}
function _v77OneCGet_(cfg, path) {
  var url = cfg.url + '/odata/standard.odata/' + path + (path.indexOf('?') >= 0 ? '&' : '?') + '$format=json';
  var r = UrlFetchApp.fetch(encodeURI(url), { method: 'get', muteHttpExceptions: true, headers: { Authorization: 'Basic ' + Utilities.base64Encode(cfg.login + ':' + cfg.password, Utilities.Charset.UTF_8), Accept: 'application/json' } });
  var code = r.getResponseCode(), t = r.getContentText();
  if (code === 401) throw new Error('1С: неверный логин или пароль');
  if (code === 404) throw new Error('1С: не найдено ' + path.split('?')[0] + ' — проверьте адрес публикации, включён ли OData и состав «Стандартного интерфейса OData»');
  if (code !== 200) throw new Error('1С: сервер ответил ' + code + (t ? ' — ' + t.slice(0, 200) : ''));
  try { return JSON.parse(t); } catch (e) { throw new Error('1С: ответ не JSON — проверьте адрес публикации'); }
}
function _v77OneCDt_(d) { return _v77DayIso_(d) + 'T00:00:00'; }
/** Настройки 1С. json: {url, login, password? (пусто — прежний), names?}. Сохраняет и проверяет доступ. */
function v77OneCSave(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V77_1C_SAVE', 'Интеграции', '1c', null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), old = _v77OneCCfg_() || {}, url = _v77OneCUrl_(d.url), login = String(d.login || '').trim();
    if (!url) return _v64Fail_(op, 'VALIDATION', 'Адрес публикации базы 1С, например https://server/buh');
    if (!login) return _v64Fail_(op, 'VALIDATION', 'Укажите пользователя 1С');
    var pass = d.password ? String(d.password) : (old.url === url && old.login === login ? old.password : '');
    if (pass === undefined || pass === null) pass = '';
    var names = {}; if (d.names && typeof d.names === 'object') Object.keys(MC_V77_1C_NAMES).forEach(function (k) { var v = String(d.names[k] || '').trim(); if (v && v !== MC_V77_1C_NAMES[k]) names[k] = v; });
    var cfg = { url: url, login: login, password: pass, names: names, lastSync: old.lastSync || '', lastError: '' }, N = _v77OneCNames_(cfg), check = { ok: true, message: 'Доступ к 1С есть' };
    try { _v77OneCGet_(cfg, N.doc + '?$top=1&$select=Ref_Key'); } catch (e) { check = { ok: false, message: String(e.message || e) }; cfg.lastError = check.message; }
    PropertiesService.getScriptProperties().setProperty(MC_V77_1C_PROP, JSON.stringify(cfg));
    _audit_(op, 'V77_1C_SAVE', 'Интеграции', '1c', null, { адрес: url, пользователь: login, проверка: check.message });
    _endOp_(op);
    return _ok_({ settings: _v77OneCPublic_(cfg), check: check }, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v77OneCNames_(cfg) { var N = {}; Object.keys(MC_V77_1C_NAMES).forEach(function (k) { N[k] = (cfg.names && cfg.names[k]) || MC_V77_1C_NAMES[k]; }); return N; }
/** Поступления из 1С за период → «Инт_Накладные_1С» и сверка с приёмкой. json: {from, to} (по умолчанию 7 дней). */
function v77OneCPull(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit|receiving|procurement', 'V77_1C_PULL', 'Интеграции', '1c', null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), cfg = _v77OneCCfg_();
    if (!cfg || !cfg.url) return _v64Fail_(op, 'VALIDATION', 'Сначала настройте подключение к 1С');
    var now = _mcNow_(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var from = d.from ? (_v77When_(d.from) || {}).day : new Date(today.getTime() - 6 * 86400000), to = d.to ? (_v77When_(d.to) || {}).day : today;
    if (!from || !to || from > to) return _v64Fail_(op, 'VALIDATION', 'Период не распознан');
    if ((to - from) / 86400000 + 1 > 92) return _v64Fail_(op, 'VALIDATION', 'За один раз — не больше 92 дней');
    var N = _v77OneCNames_(cfg), next = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1), R;
    try {
      var docs = _v77OneCGet_(cfg, N.doc + "?$filter=Date ge datetime'" + _v77OneCDt_(from) + "' and Date lt datetime'" + _v77OneCDt_(next) + "' and Posted eq true and DeletionMark eq false").value || [];
      var need = {}, partners = {}, noms = {}, units = {};
      docs.forEach(function (x) { need[x[N.partner]] = 1; (x[N.items] || []).forEach(function (it) { noms[it[N.item]] = null; if (it[N.unit]) units[it[N.unit]] = null; }); });
      var load = function (cat, ids, sel, put) {
        var keys = Object.keys(ids).filter(function (k) { return k && k !== '00000000-0000-0000-0000-000000000000'; });
        for (var i = 0; i < keys.length; i += 40) {
          var f = keys.slice(i, i + 40).map(function (k) { return "Ref_Key eq guid'" + k + "'"; }).join(' or ');
          (_v77OneCGet_(cfg, cat + '?$select=' + sel + '&$filter=' + f).value || []).forEach(put);
        }
      };
      load(N.partners, need, 'Ref_Key,Description,' + N.inn, function (p) { partners[p.Ref_Key] = { name: String(p.Description || ''), inn: String(p[N.inn] || '') }; });
      load(N.nom, noms, 'Ref_Key,Description,Code', function (p) { noms[p.Ref_Key] = { name: String(p.Description || ''), code: String(p.Code || '').trim() }; });
      try { load(N.units, units, 'Ref_Key,Description', function (p) { units[p.Ref_Key] = String(p.Description || ''); }); } catch (eu) {}
      R = { docs: docs, partners: partners, noms: noms, units: units };
    } catch (e) {
      cfg.lastError = String(e.message || e); cfg.lastSync = new Date().toISOString(); PropertiesService.getScriptProperties().setProperty(MC_V77_1C_PROP, JSON.stringify(cfg));
      _endOp_(op, 'FAILED'); return _fail_('ONEC', cfg.lastError, op.id);
    }
    return _withLock_(function () {
      var sh = _v64Sheet_(MC_V77_INV_1C, MC_V77_INV[1]), H = MC_V77_INV[1], have = {}, rows = [], now2 = new Date();
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { have[String(r[0])] = true; });
      R.docs.forEach(function (x) {
        var p = R.partners[x[N.partner]] || { name: '', inn: '' }, w = _v77When_(x.Date);
        (x[N.items] || []).forEach(function (it, i) {
          var key = '1c:' + x.Ref_Key + ':' + (it.LineNumber || i + 1); if (have[key]) return; have[key] = true;
          var nm = R.noms[it[N.item]] || { name: String(it[N.item] || ''), code: '' }, u = R.units[it[N.unit]];
          var o = { Key: key, DocID: x.Ref_Key, DocNumber: String(x.Number || '').trim(), IncomingNumber: String(x[N.inNo] || '').trim(), Date: w ? _v77DayIso_(w.day) : '', Supplier: p.name, SupplierINN: p.inn,
            Status: 'POSTED', ProductID: String(it[N.item] || ''), Product: nm.name, Article: nm.code, Qty: Number(it['Количество']) || 0, Unit: typeof u === 'string' ? u : '',
            Price: Number(it['Цена']) || 0, Sum: Number(it['Сумма']) || 0, LoadedAt: now2, OperationID: op.id };
          rows.push(H.map(function (h) { var v = o[h]; return v === undefined || v === null ? '' : v; }));
        });
      });
      if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, H.length).setValues(rows);
      var rec = _v77InvRecon_(_v77DayIso_(from), _v77DayIso_(to), MC_V77_INV_1C);
      cfg.lastSync = new Date().toISOString(); cfg.lastError = ''; PropertiesService.getScriptProperties().setProperty(MC_V77_1C_PROP, JSON.stringify(cfg));
      _audit_(op, 'V77_1C_PULL', MC_V77_INV_1C, '1c', null, { период: _v77DayIso_(from) + ' — ' + _v77DayIso_(to), документов: R.docs.length, новых_позиций: rows.length, без_приёмки: rec.notReceived.length });
      _endOp_(op);
      rec.loaded = { documents: R.docs.length, newLines: rows.length };
      rec.note = rec.note.replace('Накладная iiko', 'Поступление в 1С');
      return _ok_(rec, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v77OneCDisconnect(token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V77_1C_OFF', 'Интеграции', '1c', null); } catch (e) { return _failFrom_(e); }
  try { PropertiesService.getScriptProperties().deleteProperty(MC_V77_1C_PROP); _endOp_(op); return _ok_({ settings: _v77OneCPublic_(null) }, op.id); }
  catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
