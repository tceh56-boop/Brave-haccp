/**
 * MON CHEF V72 — унифицированные формы первичной учётной документации общественного питания
 * (утверждены Постановлением Госкомстата России от 25.12.98 № 132):
 *   ОП-3  требование в кладовую            ОП-12 акт о реализации готовых изделий кухни за наличный расчёт
 *   ОП-7  опись дневных заборных листов     ОП-18 акт о передаче товаров и тары при смене материально ответственного лица
 *   ОП-10 акт о реализации и отпуске изделий кухни   ОП-21 акт на отпуск питания сотрудникам организации
 *   ОП-11 акт о продаже и отпуске изделий кухни      ОП-23 акт о разделке мяса-сырья на полуфабрикаты
 *
 * Формы строятся заново по тексту постановления: без чужих логотипов, ссылок и рекламы. Организация, ОКПО, ОКВЭД и подразделение —
 * из «Настройки → Организация»; руководитель — ответственное лицо оттуда же; заведующий производством — шеф-повар из списка сотрудников.
 * Количества и цены — из учёта системы:
 *   • цена продажи — из журнала продаж (фактическая цена строки), для отпуска сотрудникам — из «Цен меню»;
 *   • учётная цена производства — себестоимость порции: по партиям, списанным при продаже (V71) → по последнему выпуску → по нормативу ТТК;
 *   • сырьё и товары — по цене партии (FEFO), остатки — по ценам партий.
 * Чего в системе нет, система не придумывает: поле остаётся пустым («—»), в примечании — почему (подписи, выручка кассы, специи и соль,
 * цены продажи сырья, нормы выхода п/ф без основания).
 * Сформированный документ получает номер (по форме и году), снимок данных и PDF; данные документа после формирования не меняются.
 * Ошибочный документ аннулируется с причиной, номер не используется повторно.
 */
var MC_V72 = { REG: 'Документы_ОП_V72', NORMS: 'Нормы_Выхода_Разделки_V72', FOLDER_PROP: 'MC_OPFORMS_FOLDER_ID' };
var MC_V72_REG_HEAD_ = ['DocID', 'Форма', 'Номер', 'Дата составления', 'Период с', 'Период по', 'Подразделение', 'Получатель', 'Параметры (JSON)', 'Данные (JSON)',
  'Итог по ценам продажи', 'Итог по учётным ценам', 'Статус', 'Создал', 'Создано', 'Файл PDF', 'Ссылка', 'SHA-256', 'OperationID', 'Аннулировал', 'Причина аннулирования'];
var MC_V72_NORM_HEAD_ = ['Сырьё', 'Полуфабрикат', 'Выход по норме, %', 'Основание', 'Внёс', 'Обновлено'];
var MC_V72_FORMS_ = {
  'ОП-3': { okud: '0330503', title: 'ТРЕБОВАНИЕ В КЛАДОВУЮ', name: 'Требование в кладовую', period: 'day' },
  'ОП-7': { okud: '0330507', title: 'ОПИСЬ ДНЕВНЫХ ЗАБОРНЫХ ЛИСТОВ (НАКЛАДНЫХ)', name: 'Опись дневных заборных листов', period: 'day' },
  'ОП-10': { okud: '0330510', title: 'АКТ О РЕАЛИЗАЦИИ И ОТПУСКЕ ИЗДЕЛИЙ КУХНИ', name: 'Акт о реализации и отпуске изделий кухни', period: 'day', wide: true, approve: true },
  'ОП-11': { okud: '0330511', title: 'АКТ О ПРОДАЖЕ И ОТПУСКЕ ИЗДЕЛИЙ КУХНИ', name: 'Акт о продаже и отпуске изделий кухни', period: 'day', approve: true },
  'ОП-12': { okud: '0330512', title: 'АКТ О РЕАЛИЗАЦИИ ГОТОВЫХ ИЗДЕЛИЙ КУХНИ ЗА НАЛИЧНЫЙ РАСЧЕТ', name: 'Акт о реализации готовых изделий кухни за наличный расчёт', period: 'day', approve: true },
  'ОП-18': { okud: '0330518', title: 'АКТ О ПЕРЕДАЧЕ ТОВАРОВ И ТАРЫ ПРИ СМЕНЕ МАТЕРИАЛЬНО ОТВЕТСТВЕННОГО ЛИЦА', name: 'Акт о передаче товаров и тары при смене материально ответственного лица', period: 'moment' },
  'ОП-21': { okud: '0330521', title: 'АКТ НА ОТПУСК ПИТАНИЯ СОТРУДНИКАМ ОРГАНИЗАЦИИ', name: 'Акт на отпуск питания сотрудникам организации', period: 'day', approve: true },
  'ОП-23': { okud: '0330523', title: 'АКТ О РАЗДЕЛКЕ МЯСА - СЫРЬЯ НА ПОЛУФАБРИКАТЫ', name: 'Акт о разделке мяса-сырья на полуфабрикаты', period: 'range', wide: true, approve: true }
};
var MC_V72_ORDER_ = ['ОП-3', 'ОП-7', 'ОП-10', 'ОП-11', 'ОП-12', 'ОП-18', 'ОП-21', 'ОП-23'];
var MC_V72_GONE_ = /^(consumed|expired|returned|written_off|waste|wasted|cancelled)$/;

/* ---------------- листы, мелочи ---------------- */
function _v72Sheet_(name, head) {
  var ss = _book_(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]); sh.setFrozenRows(1); try { sh.getRange(1, 1, 1, head.length).setFontWeight('bold'); } catch (e) {} }
  return sh;
}
function _v72Reg_() { return _v72Sheet_(MC_V72.REG, MC_V72_REG_HEAD_); }
function _v72NormSh_() { return _v72Sheet_(MC_V72.NORMS, MC_V72_NORM_HEAD_); }
function _v72R2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function _v72R3_(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
function _v72Day_(x) {
  if (x === null || x === undefined || x === '') return '';
  var d = x instanceof Date ? x : _parseDate_(x);
  if (!d || !d.getTime || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, _mcTz_(), 'yyyy-MM-dd');
}
function _v72Ru_(iso) { return iso ? String(iso).slice(0, 10).split('-').reverse().join('.') : ''; }
function _v72E_(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _v72Money_(x) { if (x === null || x === undefined || x === '') return ''; var n = Number(x); if (!isFinite(n)) return ''; return n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function _v72Qty_(x) { if (x === null || x === undefined || x === '') return ''; var n = _v72R3_(x); return String(n).replace('.', ','); }
/** Единица для документа: г → кг, мл → л; код ОКЕИ (ОК 015-94). */
function _v72Unit_(qty, unit) {
  var u = String(unit || '').toLowerCase().replace(/\./g, '').trim(), q = Number(qty) || 0;
  if (u === 'г' || u === 'гр') return { qty: q / 1000, unit: 'кг', okei: '166' };
  if (u === 'мл') return { qty: q / 1000, unit: 'л', okei: '112' };
  if (u === 'кг') return { qty: q, unit: 'кг', okei: '166' };
  if (u === 'л') return { qty: q, unit: 'л', okei: '112' };
  if (u === 'шт') return { qty: q, unit: 'шт', okei: '796' };
  if (u === 'упак' || u === 'уп') return { qty: q, unit: 'упак', okei: '778' };
  if (/^порц/.test(u) || u === 'пор') return { qty: q, unit: 'порц.', okei: '' };
  return { qty: q, unit: unit || '', okei: '' };
}
/** Сумма прописью: «Одна тысяча двести рублей 50 копеек». */
function _v72Words_(amount) {
  var n = Math.round((Number(amount) || 0) * 100), neg = n < 0; n = Math.abs(n);
  var rub = Math.floor(n / 100), kop = n % 100;
  var ones = [['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'], ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']];
  var teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  var tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  var hund = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  var forms = [['рубль', 'рубля', 'рублей', 0], ['тысяча', 'тысячи', 'тысяч', 1], ['миллион', 'миллиона', 'миллионов', 0], ['миллиард', 'миллиарда', 'миллиардов', 0]];
  var plural = function (x, f) { x = x % 100; if (x >= 11 && x <= 19) return f[2]; x = x % 10; return x === 1 ? f[0] : (x >= 2 && x <= 4 ? f[1] : f[2]); };
  var tri = function (x, fem) { var o = []; if (hund[Math.floor(x / 100)]) o.push(hund[Math.floor(x / 100)]); var t = x % 100;
    if (t >= 10 && t < 20) o.push(teens[t - 10]); else { if (tens[Math.floor(t / 10)]) o.push(tens[Math.floor(t / 10)]); if (ones[fem][t % 10]) o.push(ones[fem][t % 10]); } return o.join(' '); };
  var words;
  if (rub === 0) words = 'ноль рублей';
  else {
    var parts = [], i = 0, r = rub;
    while (r > 0 && i < forms.length) {
      var g = r % 1000;
      if (i === 0) { var w0 = tri(g, 0); parts.unshift((w0 ? w0 + ' ' : '') + plural(g, forms[0])); }
      else if (g) parts.unshift(tri(g, forms[i][3]) + ' ' + plural(g, forms[i]));
      r = Math.floor(r / 1000); i++;
    }
    words = parts.join(' ');
  }
  words = (neg ? 'минус ' : '') + words;
  return words.charAt(0).toUpperCase() + words.slice(1) + ' ' + ('0' + kop).slice(-2) + ' ' + plural(kop, ['копейка', 'копейки', 'копеек']);
}

/* ---------------- справочные данные ---------------- */
function _v72Batches_() {
  var v = _stockBatchesSheet_().getDataRange().getValues(), m = {};
  for (var i = 1; i < v.length; i++) if (v[i][0]) m[String(v[i][0])] = { id: String(v[i][0]), product: String(v[i][1] || ''), unit: String(v[i][2] || ''), qty: Number(v[i][3]) || 0, received: v[i][4],
    expiry: v[i][5], price: parseFloat(v[i][6]) || 0, remain: parseFloat(v[i][9]) || 0, status: String(v[i][10] || 'active'), pid: String(v[i][17] || '') };
  return m;
}
function _v72Staff_() { try { return JSON.parse(getEmployees() || '[]').filter(function (e) { return e.active !== false; }); } catch (e) { return []; } }
/** Подписанты по умолчанию: руководитель — ответственное лицо организации; заведующий производством — шеф-повар (если он один). */
function _v72Signers_() {
  var o = _mcOrg_(), st = _v72Staff_(), chefs = st.filter(function (e) { return /шеф-повар/i.test(e.position || '') && !/су-шеф/i.test(e.position || ''); });
  return { head: { name: o.responsibleName || '', position: o.responsiblePosition || 'Руководитель' }, chief: chefs.length === 1 ? { name: chefs[0].name, position: chefs[0].position } : { name: '', position: 'Заведующий производством' } };
}
function _v72Sub_(p, form) {
  var o = _mcOrg_();
  if (p.subdivision) return String(p.subdivision);
  if (form === 'ОП-3') return 'Кладовая' + (o.objectName ? ', ' + o.objectName : '');
  return o.objectName || 'Производство (кухня)';
}
/** Учётная цена производства (себестоимость единицы блюда) на день: по партиям, списанным при продаже → по выпуску → по нормативу ТТК. */
function _v72Cost_(dish, day, ctx) {
  ctx = ctx || {};
  var key = _prodKey_(dish), w = ctx.v71 || (ctx.v71 = _v72V71_());
  var rows = (w[key] || []).filter(function (x) { return x.day === day && x.qty > 0 && x.status === 'FULL'; });
  if (rows.length) { var c = rows.reduce(function (a, x) { return a + x.cost; }, 0), q = rows.reduce(function (a, x) { return a + x.qty; }, 0); return { price: _v72R2_(c / q), src: 'по списанным партиям' }; }
  var pr = ctx.prod || (ctx.prod = _v72Prod_()), lst = (pr[key] || []).filter(function (x) { return !x.day || x.day <= day; });
  if (lst.length) return { price: _v72R2_(lst[lst.length - 1].uc), src: 'по выпуску ' + _v72Ru_(lst[lst.length - 1].day) };
  try { var n = _v64NormCost_(dish); if (n.cost > 0) return { price: _v72R2_(n.cost), src: 'по нормативу ТТК' + (n.missing.length ? ' (нет цены: ' + n.missing.join(', ') + ')' : '') }; } catch (e) {}
  return { price: null, src: 'нет себестоимости' };
}
function _v72V71_() {
  var sh = _book_().getSheetByName('Продажи_Списание_V71'), m = {};
  if (!sh || sh.getLastRow() < 2) return m;
  sh.getRange(2, 1, sh.getLastRow() - 1, 14).getValues().forEach(function (r) {
    var day = _v72Day_(r[1]); (m[_prodKey_(r[3])] = m[_prodKey_(r[3])] || []).push({ saleId: String(r[0]), day: day, qty: Number(r[6]) || 0, cost: (Number(r[11]) || 0) + (Number(r[12]) || 0), status: String(r[13]),
      lines: (function () { try { return JSON.parse(r[8] || '[]'); } catch (e) { return []; } })(), code: String(r[5] || ''), kind: String(r[4] || '') });
  });
  return m;
}
function _v72Prod_() {
  var m = {}, sh = typeof _productionSheet_ === 'function' ? _productionSheet_() : null; if (!sh) return m;
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (String(r[PROD_COL_.status]) !== 'COMPLETED') continue;
    var fact = Number(r[PROD_COL_.fact]) || 0, cost = Number(r[PROD_COL_.cost]) || 0; if (!(fact > 0) || !(cost > 0)) continue;
    (m[_prodKey_(r[PROD_COL_.name])] = m[_prodKey_(r[PROD_COL_.name])] || []).push({ day: _v72Day_(r[PROD_COL_.finish]) || _v72Day_(r[PROD_COL_.created]), uc: cost / fact, id: String(r[PROD_COL_.id]), ws: String(r[PROD_COL_.ws] || ''), code: String(r[PROD_COL_.code] || '') });
  }
  return m;
}
/** Строки журнала продаж за день: ручные (зал) и выдача банкета. */
function _v72Sales_(day) {
  var j = _mcJById_('J36'), sh = _book_().getSheetByName(j.sheetName), out = { hall: [], banquet: [] };
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getDataRange().getValues(), c = function (n) { return j.columns.indexOf(n); }, b = j.columns.length;
  for (var i = 1; i < v.length; i++) {
    var r = v[i], dish = String(r[c('Блюдо')] || ''); if (!dish || _v72Day_(r[c('Дата')]) !== day) continue;
    var qty = Number(r[c('Количество')]) || 0, price = Number(r[c('Цена')]) || 0, sum = r[c('Сумма')] === '' ? qty * price : Number(r[c('Сумма')]) || 0, seller = String(r[c('ФИО продавца')] || ''), src = String(r[b + 3] || '');
    var m = /Выдача банкета\s+(\S+)/.exec(seller), sid = /\b(SL-\d{8}-[0-9A-F]{8})\b/.exec(src);
    var x = { dish: dish, qty: qty, price: price, sum: _v72R2_(sum), seller: seller, saleId: sid ? sid[1] : '', event: m ? m[1] : '', row: i + 1 };
    (m ? out.banquet : out.hall).push(x);
  }
  return out;
}
/** Акты списания «Питание персонала» за день: строки акта (блюдо или продукт) и фактическая стоимость списанного. */
function _v72StaffActs_(day) {
  var out = []; if (typeof _woSheet_ !== 'function') return out;
  var v = _woSheet_().getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0] || String(r[2]) !== 'STAFF' || _v72Day_(r[1]) !== day) continue;
    var lines = []; try { lines = JSON.parse(String(r[9] || '[]')); } catch (e) {}
    out.push({ actId: String(r[0]), total: Number(r[6]) || 0, lines: lines, comment: String(r[4] || '') });
  }
  return out;
}
function _v72Workshops_() { try { return _dishWorkshopMap_(); } catch (e) { return {}; } }

/* ---------------- сбор данных по формам ---------------- */
/** ОП-3: сырьё и товары, взятые со склада в производство за день (выпуск, продажа «под заказ», обработка сырья), по получателям. */
function _v72Req_(day) {
  var B = _v72Batches_(), idx = _buildDishIndexes_(), ws = _v72Workshops_(), by = {}, recipients = {};
  var isOwn = function (name) { return !!idx.dishByNormName[_normNameServer_(name)]; };   // п/ф и блюда собственного производства в требование не входят
  var add = function (rcp, bid, qty, unit) {
    var b = B[bid]; if (!b || isOwn(b.product)) return;
    var k = rcp + '|' + _prodKey_(b.product) + '|' + _toBaseUnitServer_(1, unit || b.unit).unit, x = by[k];
    if (!x) x = by[k] = { recipient: rcp, product: _cleanProdName_(b.product), code: b.pid, base: 0, baseUnit: _toBaseUnitServer_(1, unit || b.unit).unit, cost: 0, batches: {} };
    var qb = _toBaseUnitServer_(Number(qty) || 0, unit || b.unit).qty, perBase = b.price / (_toBaseUnitServer_(1, b.unit).qty || 1);
    x.base += qb; x.cost += qb * perBase; x.batches[bid] = true; recipients[rcp] = true;
  };
  // выпуск: связи «партия → производство» за день, цех — из заказа
  var prodWs = {}; try { var pv = _productionSheet_().getDataRange().getValues(); for (var i = 1; i < pv.length; i++) prodWs[String(pv[i][PROD_COL_.id])] = String(pv[i][PROD_COL_.ws] || '') || (ws[pv[i][PROD_COL_.code]] || ''); } catch (e) {}
  var tl = _mcTraceSheet_().getDataRange().getValues();
  for (var t = 1; t < tl.length; t++) {
    var r = tl[t]; if (String(r[3]) !== 'РАСХОДОВАНА_НА' || String(r[4]) !== 'PRODUCTION' || _v72Day_(r[7]) !== day) continue;
    var pid = String(r[5]).replace(/^Производство\s+/, '');
    add(prodWs[pid] || 'Производство', String(r[2]), r[10], r[11]);
  }
  // продажа «под заказ» (V71): сырьё по ТТК
  var w = _v72V71_();
  Object.keys(w).forEach(function (k) { w[k].forEach(function (s) { if (s.day !== day || !/блюдо/.test(s.kind)) return;
    s.lines.forEach(function (l) { if (l.from === 'RAW' || l.from === 'PF') add(ws[s.code] || 'Производство', l.batchId, l.qty, l.unit); }); }); });
  // обработка сырья (зачистка, разбор): взятое из партии
  try {
    var av = _book_().getSheetByName('Разбор_Акты'); av = av ? av.getDataRange().getValues() : [];
    var h = av[0] || [], ci = function (n) { return h.indexOf(n); };
    for (var a = 1; a < av.length; a++) {
      var ar = av[a], type = String(ar[ci('Тип')] || ''); if (!ar[0] || type === 'DEFROST' || _v72Day_(ar[ci('Дата')]) !== day) continue;
      if (/отмен|cancel/i.test(String(ar[ci('Статус')] || ''))) continue;
      add('Обработка сырья', String(ar[ci('ПартияИсточник')]), Number(ar[ci('Взято')]) || Number(ar[ci('ИсходныйВес')]) || 0, String(ar[ci('ЕдИзм')] || ''));
    }
  } catch (e) {}
  var rows = Object.keys(by).map(function (k) { var x = by[k], u = _v72Unit_(x.base, x.baseUnit); return { recipient: x.recipient, product: x.product, code: x.code, unit: u.unit, okei: u.okei, qty: _v72R3_(u.qty), cost: _v72R2_(x.cost), batches: Object.keys(x.batches) }; })
    .sort(function (a, b) { return (a.recipient + a.product).localeCompare(b.recipient + b.product, 'ru'); });
  return { rows: rows, recipients: Object.keys(recipients).sort() };
}

function _v72Build_(form, p) {
  if (typeof _v64Drop_ === 'function') try { _v64Drop_(); } catch (e) {}
  var day = _v72Day_(p.date) || _v72Day_(new Date()), ctx = {}, notes = [], data = { form: form, day: day };
  if (form === 'ОП-3') {
    var rq = _v72Req_(day), rcp = p.recipient || '';
    data.recipients = rq.recipients;
    data.rows = rq.rows.filter(function (r) { return !rcp || r.recipient === rcp; }).map(function (r, i) { return { n: i + 1, product: r.product, code: r.code, unit: r.unit, okei: r.okei, qty: r.qty, note: rcp ? '' : r.recipient, cost: r.cost }; });
    data.recipient = rcp || (rq.recipients.length === 1 ? rq.recipients[0] : 'все цеха');
    data.via = p.via || '';
    data.totals = { cost: _v72R2_(data.rows.reduce(function (a, r) { return a + r.cost; }, 0)) };
    if (!data.rows.length) notes.push('За ' + _v72Ru_(day) + ' сырьё со склада в производство не выдавалось (нет выпусков, продаж «под заказ» и обработки сырья)' + (rcp ? ' для «' + rcp + '»' : '') + '.');
    notes.push('В требование входят сырьё и товары со склада; п/ф и блюда собственного производства не входят. Количество — фактически списанное с партий.');
  } else if (form === 'ОП-7') {
    var reg = _v72RegRows_().filter(function (d) { return d.form === 'ОП-3' && d.date === day && d.status === 'ACTIVE'; });
    data.rows = reg.map(function (d, i) { return { n: i + 1, number: d.number, date: _v72Ru_(d.date), cost: d.cost, sale: null, note: d.recipient }; });
    data.totals = { cost: _v72R2_(data.rows.reduce(function (a, r) { return a + (r.cost || 0); }, 0)) };
    if (!data.rows.length) notes.push('За ' + _v72Ru_(day) + ' нет сформированных требований ОП-3 — сначала сформируйте их.');
    notes.push('Графа 5 «по ценам продажи» не заполняется: цены продажи сырья в системе не ведутся.');
  } else if (form === 'ОП-10' || form === 'ОП-11' || form === 'ОП-12') {
    var s = _v72Sales_(day), prices = _v64MenuPrices_(), m = {};
    var row = function (dish, price) { var k = _prodKey_(dish) + '|' + _v72R2_(price); if (!m[k]) { var d = _v64DishOf_(dish); m[k] = { dish: (d && d.name) || dish, code: d ? d.code : '', price: _v72R2_(price), cash: [0, 0], staff: [0, 0], banq: [0, 0], buf: [0, 0] }; } return m[k]; };
    s.hall.forEach(function (x) { var r = row(x.dish, x.qty ? x.sum / x.qty : x.price); r.cash[0] += x.qty; r.cash[1] += x.sum; });
    s.banquet.forEach(function (x) { var r = row(x.dish, x.qty ? x.sum / x.qty : x.price); r.banq[0] += x.qty; r.banq[1] += x.sum; });
    var staffActs = _v72StaffActs_(day), staffNoPrice = [];
    if (form !== 'ОП-12') staffActs.forEach(function (a) { a.lines.forEach(function (l) { if (l.kind !== 'dish' || l.semi) return;
      var mp = _v64PriceFor_(prices, l.name, '', _parseDate_(day)); if (!mp) { staffNoPrice.push(l.name); return; }
      var r = row(l.name, mp.price); r.staff[0] += Number(l.qty) || 0; r.staff[1] += (Number(l.qty) || 0) * mp.price; }); });
    var rows = Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return a.dish.localeCompare(b.dish, 'ru'); });
    rows.forEach(function (r, i) {
      r.n = i + 1; var c = _v72Cost_(r.dish, day, ctx); r.costPrice = c.price; r.costSrc = c.src;
      r.totalQty = _v72R3_(r.cash[0] + r.staff[0] + r.banq[0] + r.buf[0]); r.totalSum = _v72R2_(r.cash[1] + r.staff[1] + r.banq[1] + r.buf[1]);
      r.costSum = c.price === null ? null : _v72R2_(c.price * (form === 'ОП-12' ? r.cash[0] : r.totalQty));
      ['cash', 'staff', 'banq', 'buf'].forEach(function (g) { r[g] = [_v72R3_(r[g][0]), _v72R2_(r[g][1])]; });
    });
    if (form === 'ОП-12') rows = rows.filter(function (r) { return r.cash[0] > 0; }).map(function (r, i) { r.n = i + 1; return r; });
    data.rows = rows;
    var sum = function (f) { return _v72R2_(rows.reduce(function (a, r) { return a + (f(r) || 0); }, 0)); };
    data.totals = { cash: sum(function (r) { return r.cash[1]; }), staff: sum(function (r) { return r.staff[1]; }), banq: sum(function (r) { return r.banq[1]; }), buf: 0,
      all: sum(function (r) { return form === 'ОП-12' ? r.cash[1] : r.totalSum; }), cost: sum(function (r) { return r.costSum; }),
      cashCost: sum(function (r) { return r.costPrice === null ? 0 : r.costPrice * r.cash[0]; }), staffCost: sum(function (r) { return r.costPrice === null ? 0 : r.costPrice * r.staff[0]; }),
      banqCost: sum(function (r) { return r.costPrice === null ? 0 : r.costPrice * r.banq[0]; }) };
    data.totals.words = _v72Words_(data.totals.all);
    if (form === 'ОП-11') {
      var o21 = _v72RegRows_().filter(function (d) { return d.form === 'ОП-21' && d.date === day && d.status === 'ACTIVE'; });
      data.op21 = o21.length ? { number: o21[o21.length - 1].number, date: _v72Ru_(o21[o21.length - 1].date) } : null;
      if (data.totals.staff && !data.op21) notes.push('Отпуск сотрудникам есть, а акт ОП-21 за этот день не сформирован — сформируйте его, номер попадёт в графу II.');
    }
    if (!rows.length) notes.push('За ' + _v72Ru_(day) + ' нет продаж' + (form === 'ОП-12' ? ' в зал' : ', выдачи банкетов и отпуска сотрудникам') + '.');
    if (staffNoPrice.length) notes.push('Отпуск сотрудникам без цены меню не включён: ' + staffNoPrice.join(', ') + ' — задайте цену в «Экономика → Цены меню».');
    if (rows.some(function (r) { return r.costPrice === null; })) notes.push('Нет себестоимости: ' + rows.filter(function (r) { return r.costPrice === null; }).map(function (r) { return r.dish; }).join(', ') + '.');
    if (form !== 'ОП-12') notes.push('Графа «отпущено буфетам и мелкорозничной сети» — нет такого учёта, 0. Свободная группа граф — «банкеты (по договорам)»: выдача банкетов по ценам договора.');
    notes.push('Справка о специях и соли, выручка кассы и подписи заполняются вручную: этих данных в системе нет.');
  } else if (form === 'ОП-21') {
    var pr2 = _v64MenuPrices_(), acts = _v72StaffActs_(day), r21 = [];
    acts.forEach(function (a) {
      var norm = a.lines.map(function (l) { if (l.kind === 'dish') { var nc = 0; try { nc = _v64NormCost_(l.name).cost * (Number(l.qty) || 0); } catch (e) {} return nc; } try { return (_currentAvgPrice_(l.name, l.unit) || 0) * (Number(l.qty) || 0); } catch (e) { return 0; } });
      var nt = norm.reduce(function (x, y) { return x + y; }, 0);
      a.lines.forEach(function (l, i) {
        var q = Number(l.qty) || 0, d = l.kind === 'dish' ? _v64DishOf_(l.name) : null, mp = l.kind === 'dish' ? _v64PriceFor_(pr2, l.name, '', _parseDate_(day)) : null;
        var share = a.lines.length === 1 ? a.total : (nt > 0 ? a.total * norm[i] / nt : null), u = l.kind === 'dish' ? { qty: q, unit: 'порц.' } : _v72Unit_(q, l.unit);
        r21.push({ dish: l.name, code: d ? d.code : '', qty: _v72R3_(u.qty), unit: u.unit, price: mp ? mp.price : null, sum: mp ? _v72R2_(mp.price * q) : null,
          costPrice: share === null || !q ? null : _v72R2_(share / q), costSum: share === null ? null : _v72R2_(share), note: 'акт ' + a.actId + (a.lines.length > 1 ? ', стоимость распределена по нормативу ТТК' : '') });
      });
    });
    data.rows = r21.map(function (r, i) { r.n = i + 1; return r; });
    data.totals = { sum: _v72R2_(r21.reduce(function (a, r) { return a + (r.sum || 0); }, 0)), cost: _v72R2_(r21.reduce(function (a, r) { return a + (r.costSum || 0); }, 0)) };
    if (!r21.length) notes.push('За ' + _v72Ru_(day) + ' нет актов списания «Питание персонала» (Склад → Списание (акт)).');
    if (r21.some(function (r) { return r.price === null; })) notes.push('Без отпускной цены (нет в «Ценах меню»): ' + r21.filter(function (r) { return r.price === null; }).map(function (r) { return r.dish; }).join(', ') + '.');
    notes.push('Учётная цена — фактическая стоимость списанного по акту (цены партий FEFO).');
  } else if (form === 'ОП-18') {
    var Bm = _v72Batches_(), pack = {}, g = {};
    try { var pn = _v64PackNorms_(); Object.keys(pn).forEach(function (k) { pn[k].forEach(function (n) { pack[_prodKey_(n.item)] = true; }); }); } catch (e) {}
    Object.keys(Bm).forEach(function (id) {
      var b = Bm[id]; if (!(b.remain > 0.0005) || MC_V72_GONE_.test(b.status)) return;
      var tare = !!pack[_prodKey_(b.product)] || /(^|\s)(тара|ящик|коробк|контейнер|ланч-?бокс|стакан(?!.*напит)|крышк|пакет)/i.test(b.product);
      var bu = _toBaseUnitServer_(1, b.unit), k = (tare ? 'T' : 'G') + '|' + _prodKey_(b.product) + '|' + bu.unit, x = g[k];
      if (!x) x = g[k] = { tare: tare, product: _cleanProdName_(b.product), code: b.pid, base: 0, baseUnit: bu.unit, cost: 0, statuses: {} };
      x.base += b.remain * bu.qty; x.cost += b.remain * b.price; x.statuses[b.status] = true;
    });
    var mk = function (tare) { return Object.keys(g).map(function (k) { return g[k]; }).filter(function (x) { return x.tare === tare; }).sort(function (a, b) { return a.product.localeCompare(b.product, 'ru'); })
      .map(function (x, i) { var u = _v72Unit_(x.base, x.baseUnit), wgt = u.unit === 'кг' || u.unit === 'л';
        return { n: i + 1, product: x.product, code: x.code, unit: u.unit, okei: u.okei, mass: wgt ? _v72R3_(u.qty) : '', qty: wgt ? '' : _v72R3_(u.qty), price: u.qty > 0 ? _v72R2_(x.cost / u.qty) : 0, sum: _v72R2_(x.cost),
          note: Object.keys(x.statuses).filter(function (s) { return s !== 'active'; }).map(function (s) { return ({ quarantine: 'в карантине', hold: 'задержана', blocked: 'заблокирована', defrost: 'дефрост' })[s] || s; }).join(', ') }; }); };
    data.goods = mk(false); data.tare = mk(true);
    var sm = function (a) { return _v72R2_(a.reduce(function (x, r) { return x + r.sum; }, 0)); };
    data.totals = { goods: sm(data.goods), tare: sm(data.tare), all: _v72R2_(sm(data.goods) + sm(data.tare)) };
    data.totals.words = _v72Words_(data.totals.all);
    data.at = Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH:mm');
    data.handedBy = p.handedBy || {}; data.receivedBy = p.receivedBy || {}; data.admin = p.admin || {};
    if (!data.goods.length && !data.tare.length) notes.push('На складе нет остатков по партиям.');
    notes.push('Остатки — по партиям склада на момент формирования (' + data.at + '), цена — средняя по ценам партий. Тара — позиции норм упаковки и товары с названием тары; фактическое наличие сверяется пересчётом при передаче.');
  } else if (form === 'ОП-23') {
    var from = _v72Day_(p.from) || day, to = _v72Day_(p.to) || day, Bb = _v72Batches_(), norms = _v72Norms_();
    data.from = from; data.to = to; data.acts = [];
    var av2 = _book_().getSheetByName('Разбор_Акты'), lv = _book_().getSheetByName('Разбор_Строки');
    av2 = av2 ? av2.getDataRange().getValues() : []; lv = lv ? lv.getDataRange().getValues() : [];
    var h2 = av2[0] || [], c2 = function (n) { return h2.indexOf(n); }, hl = lv[0] || [], cl = function (n) { return hl.indexOf(n); }, linesBy = {};
    for (var q = 1; q < lv.length; q++) (linesBy[String(lv[q][0])] = linesBy[String(lv[q][0])] || []).push(lv[q]);
    var pairs = {};
    for (var z = 1; z < av2.length; z++) {
      var ar2 = av2[z], tp = String(ar2[c2('Тип')] || 'CUT'), dd = _v72Day_(ar2[c2('Дата')]);
      if (!ar2[0] || tp === 'DEFROST' || !dd || dd < from || dd > to) continue;
      var src = Bb[String(ar2[c2('ПартияИсточник')])] || {}, unit = String(ar2[c2('ЕдИзм')] || src.unit || 'г'), taken = Number(ar2[c2('Взято')]) || Number(ar2[c2('ИсходныйВес')]) || 0;
      var cost = Number(ar2[c2('Себестоимость')]) || (taken * (src.price || 0)), tu = _v72Unit_(taken, unit), raw = String(ar2[c2('Продукт')] || src.product || '');
      var ls = linesBy[String(ar2[0])] || [], prodBase = ls.filter(function (l) { return !/waste|отход/i.test(String(l[cl('Тип')] || '')); })
        .reduce(function (s0, l) { return s0 + _toBaseUnitServer_(Number(l[cl('Вес')]) || 0, String(l[cl('Ед.')] || '') || unit).qty; }, 0);
      var outs = ls.map(function (l) {
        var isW = /waste|отход/i.test(String(l[cl('Тип')] || '')), wgt = Number(l[cl('Вес')]) || 0, lu = _v72Unit_(wgt, String(l[cl('Ед.')] || '') || unit), nb = Bb[String(l[cl('НовыйBatchID')] || '')] || null;
        var name = String(l[cl('Название')] || ''), nm = isW ? 'отходы' + (l[cl('Причина')] ? ': ' + l[cl('Причина')] : '') + (name ? ' (' + name + ')' : '') : name;
        // цена выхода: стоимость взятого сырья распределяется на полуфабрикаты по массе (правило обработки сырья; отходы — без стоимости)
        var perKg = isW || !(prodBase > 0) ? 0 : cost / prodBase * (_toBaseUnitServer_(1, lu.unit).qty || 1);
        var nk = _prodKey_(raw) + '|' + _prodKey_(name), nr = isW ? null : norms[nk] || null; if (!isW) pairs[nk] = { raw: _cleanProdName_(raw), output: name, norm: nr };
        var normMass = nr ? _v72R3_(tu.qty * nr.pct / 100) : null;
        return { name: nm, code: nb ? nb.pid : '', waste: isW, normPct: nr ? nr.pct : null, normMass: normMass, normSrc: nr ? nr.source : '', mass: _v72R3_(lu.qty), price: isW ? 0 : _v72R2_(perKg), sum: isW ? 0 : _v72R2_(perKg * lu.qty), dev: normMass === null ? null : _v72R3_(lu.qty - normMass) };
      });
      data.acts.push({ actId: String(ar2[0]), date: _v72Ru_(dd), raw: _cleanProdName_(raw), rawCode: src.pid || '', unit: tu.unit, okei: tu.okei, price: tu.qty > 0 ? _v72R2_(cost / tu.qty) : 0, mass: _v72R3_(tu.qty), sum: _v72R2_(cost),
        type: typeof MC_PR_TYPE_RU_ !== 'undefined' ? MC_PR_TYPE_RU_[tp] || tp : tp, outs: outs });
    }
    data.pairs = Object.keys(pairs).map(function (k) { return pairs[k]; });
    data.totals = { raw: _v72R3_(data.acts.reduce(function (a, x) { return a + x.mass; }, 0)), rawSum: _v72R2_(data.acts.reduce(function (a, x) { return a + x.sum; }, 0)),
      out: _v72R3_(data.acts.reduce(function (a, x) { return a + x.outs.filter(function (o) { return !o.waste; }).reduce(function (b, o) { return b + o.mass; }, 0); }, 0)),
      outSum: _v72R2_(data.acts.reduce(function (a, x) { return a + x.outs.reduce(function (b, o) { return b + o.sum; }, 0); }, 0)) };
    if (!data.acts.length) notes.push('За период ' + _v72Ru_(from) + ' — ' + _v72Ru_(to) + ' нет актов зачистки и разбора (Склад → Обработка сырья).');
    if (data.pairs.some(function (x) { return !x.norm; })) notes.push('Выход по норме заполняется, если для пары «сырьё — полуфабрикат» задана норма с основанием (сборник рецептур, ТТК, акт контрольной проработки); без нормы графы «по норме» и «отклонение» пустые.');
    notes.push('Отходы — строками «отходы»: их стоимость перенесена на выход полуфабрикатов (правило системы), поэтому сумма 0.');
  }
  data.notes = notes;
  return data;
}

/* ---------------- нормы выхода при разделке (для ОП-23) ---------------- */
function _v72Norms_() {
  var m = {}, v = _v72NormSh_().getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (v[i][0] && v[i][1] && Number(v[i][2]) > 0) m[_prodKey_(v[i][0]) + '|' + _prodKey_(v[i][1])] = { pct: Number(v[i][2]), source: String(v[i][3] || ''), by: String(v[i][4] || ''), at: v[i][5] };
  return m;
}
function v72SaveYieldNorm(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock|ttk_edit', 'OPFORM_YIELD_NORM', 'Нормы выхода', '', null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, raw = String(d.raw || '').trim(), out = String(d.output || '').trim(), pct = d.pct === '' || d.pct === null || d.pct === undefined ? null : parseFloat(String(d.pct).replace(',', '.')), src = String(d.source || '').trim();
    if (!raw || !out) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите сырьё и полуфабрикат', op.id); }
    if (pct !== null && !(pct > 0 && pct <= 100)) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выход по норме — от 0 до 100 %', op.id); }
    if (pct !== null && !src) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите основание нормы: сборник рецептур, ТТК или акт контрольной проработки', op.id); }
    return _withLock_(function () {
      var sh = _v72NormSh_(), v = sh.getDataRange().getValues(), k = _prodKey_(raw) + '|' + _prodKey_(out), row = 0, before = null, who = _author_(op).фио;
      for (var i = 1; i < v.length; i++) if (_prodKey_(v[i][0]) + '|' + _prodKey_(v[i][1]) === k) { row = i + 1; before = { pct: v[i][2], source: v[i][3] }; break; }
      var vals = [[_cleanProdName_(raw), out, pct === null ? '' : pct, pct === null ? '' : src, who, new Date()]];
      if (row) sh.getRange(row, 1, 1, vals[0].length).setValues(vals); else sh.appendRow(vals[0]);
      _audit_(op, 'OPFORM_YIELD_NORM', 'Нормы выхода', k, before, { pct: pct, source: src });
      _endOp_(op);
      return _ok_({ raw: raw, output: out, pct: pct, source: src }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- HTML форм ---------------- */
function _v72Head_(form, h) {
  var F = MC_V72_FORMS_[form], E = _v72E_, o = h.org, logo = '';
  try { logo = _mcOrgLogoDataUri_(); } catch (e) {}
  var codes = '<table class="codes"><tr><td></td><td class="cb">Код</td></tr><tr><td class="cl">Форма по ОКУД</td><td class="cb">' + F.okud + '</td></tr>' +
    '<tr><td class="cl">по ОКПО</td><td class="cb">' + E(o.okpo || '') + '</td></tr>' + (form === 'ОП-3' ? '<tr><td class="cl"></td><td class="cb"></td></tr>' : '') +
    '<tr><td class="cl"></td><td class="cb"></td></tr><tr><td class="cl">Вид деятельности по ОКДП (ОКВЭД 2)</td><td class="cb">' + E(o.okved || '') + '</td></tr><tr><td class="cl">Вид операции</td><td class="cb"></td></tr></table>';
  var org = '<div class="fld">' + E(o.name || '') + '</div><div class="cap">организация</div><div class="fld">' + E(h.subdivision || '') + '</div><div class="cap">структурное подразделение</div>' +
    (form === 'ОП-3' ? '<div class="fld">' + E(h.recipient || '') + '</div><div class="cap">структурное подразделение «получатель»</div>' : '');
  var top = '<table class="top"><tr><td class="lg">' + (logo ? '<img src="' + logo + '">' : '') + '</td><td class="uf">Унифицированная форма № ' + form + '<br>Утверждена постановлением Госкомстата России<br>от 25.12.98 № 132</td></tr></table>' +
    '<table class="hd"><tr><td class="org">' + org + '</td><td class="cd">' + codes + '</td></tr></table>';
  var appr = F.approve ? '<table class="appr"><tr><td></td><td>УТВЕРЖДАЮ<br>Руководитель<br><div class="fld">' + E(h.head.position || '') + '</div><div class="cap">должность</div>' +
    '<div class="fld2"><span class="sg"></span> <span class="nm">' + E(h.head.name || '') + '</span></div><div class="cap">подпись&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;расшифровка подписи</div>«____» ____________ 20___ г.</td></tr></table>' : '';
  var period = form === 'ОП-23' ? '<td class="nb">Отчётный период<br>с ' + E(_v72Ru_(h.from)) + ' по ' + E(_v72Ru_(h.to)) + '</td>' : '';
  var num = '<table class="num"><tr><td class="tt">' + (/^АКТ/.test(F.title) ? 'АКТ' : '') + '</td><td class="nb">Номер документа<br><b>' + E(h.number || 'без номера (предпросмотр)') + '</b></td><td class="nb">Дата составления<br><b>' + E(_v72Ru_(h.date)) + '</b></td>' + period + '</tr></table>' +
    '<div class="title">' + E(/^АКТ /.test(F.title) ? F.title.replace(/^АКТ /, '') : F.title) + '</div>';
  return top + appr + num;
}
function _v72Sign_(label, who, withPos) {
  who = who || {};
  return '<div class="sig">' + _v72E_(label) + ' ' + (withPos ? '<span class="sl">' + _v72E_(who.position || '') + '</span> ' : '') + '<span class="sl sg"></span> <span class="sl">' + _v72E_(who.name || '') + '</span>' +
    '<div class="sc">' + (withPos ? 'должность&nbsp;&nbsp;&nbsp;&nbsp;' : '') + 'подпись&nbsp;&nbsp;&nbsp;&nbsp;расшифровка подписи</div></div>';
}
var MC_V72_CSS_ = 'body{font-family:Arial,sans-serif;font-size:9px;color:#000;margin:14px}table{border-collapse:collapse}.top{width:100%}.top .lg img{max-height:38px;max-width:120px}' +
  '.top .uf{text-align:right;font-size:8px;vertical-align:top}.hd{width:100%;margin-top:4px}.hd .org{vertical-align:bottom;padding-right:10px}.hd .cd{width:210px;vertical-align:top}' +
  '.codes td{padding:1px 3px;font-size:8px}.codes .cb{border:1px solid #000;width:70px;text-align:center;height:12px}.codes .cl{text-align:right}' +
  '.fld{border-bottom:1px solid #000;min-height:12px;font-size:10px;padding-top:4px}.fld2{border-bottom:1px solid #000;min-height:12px;margin-top:8px}.cap{font-size:7px;text-align:center;color:#333}' +
  '.appr{width:100%;margin-top:6px}.appr td:last-child{width:240px;font-size:9px}.num{margin:8px auto 2px auto}.num td{padding:2px 6px}.num .nb{border:1px solid #000;text-align:center;font-size:8px}.num .tt{font-weight:bold;font-size:11px}' +
  '.title{text-align:center;font-weight:bold;font-size:11px;margin:2px 0 8px}.t{width:100%;margin:4px 0}.t th,.t td{border:1px solid #000;padding:2px 3px;font-size:8px;vertical-align:top}' +
  '.t th{font-weight:normal;text-align:center}.t td.r{text-align:right;white-space:nowrap}.t tr.no td{text-align:center;font-size:7px}.t tr.it td{font-weight:bold}.sig{margin-top:10px;font-size:9px}' +
  '.sl{display:inline-block;min-width:110px;border-bottom:1px solid #000;padding:0 4px}.sg{min-width:80px}.sc{font-size:7px;color:#333;margin-left:120px}.notes{margin-top:10px;font-size:7.5px;color:#444;border-top:1px dashed #999;padding-top:4px}' +
  '.mk{font-size:7px;color:#777;margin-top:6px}@page{size:A4;margin:10mm}';
function _v72Html_(form, data, h) {
  var F = MC_V72_FORMS_[form], E = _v72E_, M = _v72Money_, Q = _v72Qty_, b = '';
  var cell = function (x, r) { return '<td' + (r ? ' class="r"' : '') + '>' + (x === null || x === undefined || x === '' ? '' : E(x)) + '</td>'; };
  var dash = function (x) { return x === null || x === undefined ? '—' : M(x); };
  if (form === 'ОП-3') {
    b += '<div class="sig">Через кого <span class="sl" style="min-width:320px">' + E(data.via || '') + '</span><div class="sc">фамилия, имя, отчество</div></div>';
    b += '<table class="t"><tr><th rowspan="2">Номер по порядку</th><th colspan="2">Продукты и товары</th><th colspan="2">Единица измерения</th><th rowspan="2">Количество</th><th rowspan="2">Примечание</th></tr>' +
      '<tr><th>наименование</th><th>код</th><th>наименование</th><th>код по ОКЕИ</th></tr><tr class="no"><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td></tr>';
    data.rows.forEach(function (r) { b += '<tr>' + cell(r.n) + cell(r.product) + cell(r.code) + cell(r.unit) + cell(r.okei) + cell(Q(r.qty), 1) + cell(r.note) + '</tr>'; });
    b += '</table>' + _v72Sign_('Затребовал заведующий производством', h.chief) + '<div class="sig">Отпуск разрешил:</div>' + _v72Sign_('Руководитель организации', h.head, true);
  } else if (form === 'ОП-7') {
    b += '<div style="text-align:center">за ' + E(_v72Ru_(data.day)) + '</div>';
    b += '<table class="t"><tr><th rowspan="2">Номер по порядку</th><th colspan="2">Заборный лист (накладная)</th><th colspan="2">Сумма, руб. коп.</th><th rowspan="2">Примечание</th></tr>' +
      '<tr><th>номер</th><th>дата</th><th>по учётным ценам кухни</th><th>по ценам продажи</th></tr><tr class="no"><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td></tr>';
    data.rows.forEach(function (r) { b += '<tr>' + cell(r.n) + cell(r.number) + cell(r.date) + cell(M(r.cost), 1) + cell('—', 1) + cell(r.note) + '</tr>'; });
    b += '<tr class="it"><td></td><td colspan="2" style="text-align:right">Итого</td>' + cell(M(data.totals.cost), 1) + cell('—', 1) + '<td></td></tr></table>' + _v72Sign_('Заведующий производством', h.chief);
  } else if (form === 'ОП-10') {
    b += '<div>Комиссия установила:</div><table class="t"><tr><th rowspan="3">Номер калькуляционной карточки</th><th colspan="2">Готовое изделие</th><th rowspan="3">Цена продажи, руб. коп.</th><th colspan="10">Реализовано и отпущено по ценам продажи</th><th colspan="2">По учётным ценам производства</th></tr>' +
      '<tr><th rowspan="2">наименование</th><th rowspan="2">код</th><th colspan="2">за наличный расчёт</th><th colspan="2">отпущено буфетам и мелкорозничной сети</th><th colspan="2">работникам организации</th><th colspan="2">банкеты (по договорам)</th><th colspan="2">всего</th><th rowspan="2">цена, руб. коп.</th><th rowspan="2">сумма, руб. коп.</th></tr>' +
      '<tr><th>кол-во, шт.</th><th>сумма, руб. коп.</th><th>кол-во, шт.</th><th>сумма, руб. коп.</th><th>кол-во, шт.</th><th>сумма, руб. коп.</th><th>кол-во, шт.</th><th>сумма, руб. коп.</th><th>кол-во, шт.</th><th>сумма, руб. коп.</th></tr>' +
      '<tr class="no">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(function (n) { return '<td>' + n + '</td>'; }).join('') + '</tr>';
    var gq = function (g) { return g[0] ? Q(g[0]) : ''; }, gs = function (g) { return g[0] ? M(g[1]) : ''; };   // пустая группа граф — без нулей
    data.rows.forEach(function (r) { b += '<tr>' + cell(r.code) + cell(r.dish) + cell(r.code) + cell(M(r.price), 1) + cell(gq(r.cash), 1) + cell(gs(r.cash), 1) + cell(gq(r.buf), 1) + cell(gs(r.buf), 1) +
      cell(gq(r.staff), 1) + cell(gs(r.staff), 1) + cell(gq(r.banq), 1) + cell(gs(r.banq), 1) + cell(Q(r.totalQty), 1) + cell(M(r.totalSum), 1) + cell(dash(r.costPrice), 1) + cell(dash(r.costSum), 1) + '</tr>'; });
    var T = data.totals;
    b += '<tr class="it"><td colspan="3" style="text-align:right">Итого</td><td class="r">X</td><td></td>' + cell(M(T.cash), 1) + '<td></td>' + cell(M(T.buf), 1) + '<td></td>' + cell(M(T.staff), 1) + '<td></td>' + cell(M(T.banq), 1) + '<td></td>' + cell(M(T.all), 1) + '<td class="r">X</td>' + cell(M(T.cost), 1) + '</tr></table>';
    b += '<div class="sig">Получено за приготовление блюд из продуктов посетителей <span class="sl" style="min-width:200px"></span> руб. ____ коп.</div>' +
      '<div class="sig">Итого реализовано, отпущено и оказано услуг за отчётный день: <b>' + E(T.words) + '</b></div>' +
      '<div class="sig">СПРАВКА: Израсходовано на приготовление блюд: специй ____% к обороту на сумму ________ руб. ___ коп.; соли ____% к обороту на сумму ________ руб. ___ коп.; итого ________ руб. ___ коп.</div>' +
      '<div class="sig">Члены комиссии:</div>' + _v72Sign_('Заведующий производством', h.chief) + _v72Sign_('Марочница', {}) + _v72Sign_('', {}, true) +
      '<div class="sig">Выручка кассы <span class="sl" style="min-width:300px"></span> руб. ____ коп.</div><div class="sig">Стоимость реализованных изделий, указанная в настоящем акте, соответствует кассовым чекам.</div>' + _v72Sign_('Кассир', {}) +
      '<div class="sig">ПРИЛОЖЕНИЕ: Накладные №№ ______________ Сумма реализованного наложения за день ________ руб. ___ коп. Заборные листы №№ ______________</div>' + _v72Sign_('Акт проверил бухгалтер', {});
  } else if (form === 'ОП-11') {
    var T1 = data.totals, line = function (no, name, sale, cost, it) { return '<tr' + (it ? ' class="it"' : '') + '>' + cell(no) + '<td>' + name + '</td>' + cell(sale === null ? '' : M(sale), 1) + cell(cost === null ? '' : M(cost), 1) + '<td></td></tr>'; };
    var cashS = T1.cash, cashC = T1.cashCost, ref = data.op21 ? 'N ' + E(data.op21.number) + ' от ' + E(data.op21.date) : 'N ____ от «__» ________ ____ г.';
    b += '<div>Комиссия установила:</div><table class="t"><tr><th rowspan="2">Номер по порядку</th><th rowspan="2"></th><th colspan="2">Сумма, руб. коп.</th><th rowspan="2">Примечание</th></tr><tr><th>по ценам продажи</th><th>по учётным ценам производства</th></tr>' +
      '<tr class="no"><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td></tr>' +
      line('', '<b>I. Продано за наличный расчёт:</b>', null, null) + line('', 'общие блюда', 0, 0) + line('', 'порционные блюда', cashS, cashC) + line('', 'обеды на дом', 0, 0) + line('', 'Итого продано', cashS, cashC, true) +
      line('', '<b>II. Отпущено</b>', null, null) + line('', '— сотрудникам организации по акту ' + ref, T1.staff, T1.staffCost) + line('', '— в филиалы и буфеты, мелкорозничную сеть', 0, 0) +
      line('', '— банкеты по договорам (выдача)', T1.banq, T1.banqCost) + line('', 'Всего', T1.all, T1.cost, true) + '</table>';
    b += '<div class="sig">СПРАВКА: Израсходовано на приготовление блюд: специй ____% к обороту на сумму ________ руб. ___ коп.; соли ____% к обороту на сумму ________ руб. ___ коп.; итого ________ руб. ___ коп.</div>' +
      '<div class="sig">Члены комиссии:</div>' + _v72Sign_('Заведующий производством (бригадир)', h.chief) + _v72Sign_('', {}, true) + _v72Sign_('', {}, true) +
      '<div class="sig">Выручка кассы <span class="sl" style="min-width:300px"></span> руб. ____ коп.</div><div class="sig">Стоимость реализованных изделий, указанная в настоящем акте, соответствует кассовым чекам.</div>' + _v72Sign_('Кассир', {}) +
      '<div class="sig">ПРИЛОЖЕНИЕ: Накладные №№ ______________ Заборные листы №№ ______________</div>' + _v72Sign_('Акт проверил бухгалтер', {});
  } else if (form === 'ОП-12') {
    b += '<div>Комиссия установила:</div><table class="t"><tr><th rowspan="3">Номер по порядку</th><th rowspan="3">Номер калькуляционной карточки</th><th colspan="2">Готовое изделие</th><th colspan="5">Реализовано</th><th rowspan="3">Примечание</th></tr>' +
      '<tr><th rowspan="2">наименование</th><th rowspan="2">код</th><th rowspan="2">количество, шт.</th><th colspan="2">по ценам фактической реализации</th><th colspan="2">по учётным ценам производства</th></tr>' +
      '<tr><th>цена, руб. коп.</th><th>сумма, руб. коп.</th><th>цена, руб. коп.</th><th>сумма, руб. коп.</th></tr><tr class="no">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return '<td>' + n + '</td>'; }).join('') + '</tr>';
    data.rows.forEach(function (r) { b += '<tr>' + cell(r.n) + cell(r.code) + cell(r.dish) + cell(r.code) + cell(Q(r.cash[0]), 1) + cell(M(r.price), 1) + cell(M(r.cash[1]), 1) + cell(dash(r.costPrice), 1) + cell(dash(r.costSum), 1) + cell(r.costSrc) + '</tr>'; });
    b += '<tr class="it"><td colspan="4" style="text-align:right">Итого</td><td></td><td class="r">X</td>' + cell(M(data.totals.all), 1) + '<td class="r">X</td>' + cell(M(data.totals.cost), 1) + '<td></td></tr></table>';
    b += '<div class="sig">Итого реализовано: <b>' + E(data.totals.words) + '</b></div>' +
      '<div class="sig">СПРАВКА: Израсходовано на приготовление блюд: специй ____% к обороту на сумму ________ руб. ___ коп.; соли ____% к обороту на сумму ________ руб. ___ коп.; итого ________ руб. ___ коп.</div>' +
      '<div class="sig">Члены комиссии:</div>' + _v72Sign_('Заведующий производством (бригадир)', h.chief) + _v72Sign_('', {}, true) + _v72Sign_('', {}, true) +
      '<div class="sig">Выручка кассы <span class="sl" style="min-width:300px"></span> руб. ____ коп.</div><div class="sig">Стоимость реализованных изделий, указанная в настоящем акте, соответствует кассовым чекам.</div>' + _v72Sign_('Кассир', {}) + _v72Sign_('Проверил бухгалтер', {});
  } else if (form === 'ОП-18') {
    var sect = function (title, rows, total) {
      var s = '<tr><td></td><td colspan="8"><b>' + title + '</b></td></tr>';
      if (!rows.length) s += '<tr><td></td><td colspan="8">нет</td></tr>';
      rows.forEach(function (r) { s += '<tr>' + cell(r.n) + cell(r.product) + cell(r.code) + cell(r.unit) + cell(r.okei) + cell(Q(r.mass), 1) + cell(Q(r.qty), 1) + cell(M(r.price), 1) + cell(M(r.sum), 1) + '</tr>'; });
      return s + '<tr class="it"><td></td><td>Итого</td><td class="r">Х</td><td class="r">Х</td><td class="r">Х</td><td></td><td></td><td class="r">Х</td>' + cell(M(total), 1) + '</tr>';
    };
    b += '<div>Установлено (остатки на ' + E(data.at) + '):</div><table class="t"><tr><th rowspan="2">Номер по порядку</th><th colspan="2">Товар, тара</th><th colspan="2">Единица измерения</th><th rowspan="2">Масса</th><th rowspan="2">Количество</th><th rowspan="2">Цена, руб. коп.</th><th rowspan="2">Сумма, руб. коп.</th></tr>' +
      '<tr><th>наименование</th><th>код</th><th>наименование</th><th>код по ОКЕИ</th></tr><tr class="no">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<td>' + n + '</td>'; }).join('') + '</tr>' +
      sect('Товары', data.goods, data.totals.goods) + sect('Тара', data.tare, data.totals.tare) +
      '<tr class="it"><td></td><td>Всего по акту</td><td class="r">Х</td><td class="r">Х</td><td class="r">Х</td><td></td><td></td><td class="r">Х</td>' + cell(M(data.totals.all), 1) + '</tr></table>';
    b += '<div class="sig">Всего по акту на сумму: <b>' + E(data.totals.words) + '</b></div>' + _v72Sign_('Сдал', data.handedBy, true) + _v72Sign_('Принял', data.receivedBy, true) + _v72Sign_('Представитель администрации', data.admin, true);
    var marks = data.goods.concat(data.tare).filter(function (r) { return r.note; });
    if (marks.length) b += '<div class="notes">Отметки о состоянии партий: ' + marks.map(function (r) { return E(r.product + ' — ' + r.note); }).join('; ') + '.</div>';
  } else if (form === 'ОП-21') {
    b += '<div>Установлено:</div><table class="t"><tr><th rowspan="2">Номер по порядку</th><th colspan="2">Блюдо</th><th rowspan="2">Количество, шт.</th><th colspan="2">По отпускным ценам, руб. коп.</th><th colspan="2">По учётным ценам производства, руб. коп.</th><th rowspan="2">Примечание</th></tr>' +
      '<tr><th>наименование</th><th>код</th><th>цена</th><th>сумма</th><th>цена</th><th>сумма</th></tr><tr class="no">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<td>' + n + '</td>'; }).join('') + '</tr>';
    data.rows.forEach(function (r) { b += '<tr>' + cell(r.n) + cell(r.dish) + cell(r.code) + cell(Q(r.qty) + (r.unit && r.unit !== 'порц.' ? ' ' + r.unit : ''), 1) + cell(dash(r.price), 1) + cell(dash(r.sum), 1) + cell(dash(r.costPrice), 1) + cell(dash(r.costSum), 1) + cell(r.note) + '</tr>'; });
    b += '<tr class="it"><td colspan="3" style="text-align:right">Итого</td><td></td><td class="r">Х</td>' + cell(M(data.totals.sum), 1) + '<td class="r">Х</td>' + cell(M(data.totals.cost), 1) + '<td></td></tr></table>';
    b += _v72Sign_('Ответственный за цены', h.prices || {}, true) + _v72Sign_('Составил заведующий производством', h.chief);
  } else if (form === 'ОП-23') {
    b += '<div>В результате разделки мяса-сырья на полуфабрикаты установлено:</div><table class="t"><tr><th colspan="2">Мясо-сырьё, поступившее на разделку</th><th colspan="2">Единица измерения</th><th colspan="3">Расход мяса-сырья</th>' +
      '<th colspan="2">Полуфабрикаты</th><th colspan="4">Выход полуфабрикатов по норме</th><th colspan="3">фактически</th><th rowspan="3">Отклонение (+, -), кг</th></tr>' +
      '<tr><th rowspan="2">наименование, категория</th><th rowspan="2">код</th><th rowspan="2">наименование</th><th rowspan="2">код по ОКЕИ</th><th rowspan="2">цена, руб. коп.</th><th rowspan="2">масса, кг</th><th rowspan="2">сумма, руб. коп.</th>' +
      '<th rowspan="2">наименование</th><th rowspan="2">код</th><th>в процентах</th><th>масса, кг</th><th colspan="2">итого масса, кг</th><th>цена, руб. коп.</th><th>масса, кг</th><th>сумма, руб. коп.</th></tr><tr><th></th><th></th><th colspan="2"></th><th></th><th></th><th></th></tr>' +
      '<tr class="no">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, '12–13', 14, 15, 16, 17].map(function (n, i) { return '<td' + (i === 11 ? ' colspan="2"' : '') + '>' + n + '</td>'; }).join('') + '</tr>';
    data.acts.forEach(function (a) {
      var outs = a.outs.length ? a.outs : [{ name: '—', code: '', mass: '', price: '', sum: '', normPct: null, normMass: null, dev: null }];
      outs.forEach(function (o, i) {
        b += '<tr>' + (i === 0 ? cell(a.raw + ' (акт ' + a.actId + ', ' + a.date + ', ' + a.type + ')') + cell(a.rawCode) + cell(a.unit) + cell(a.okei) + cell(M(a.price), 1) + cell(Q(a.mass), 1) + cell(M(a.sum), 1)
          : '<td></td><td></td><td></td><td></td><td></td><td></td><td></td>') + cell(o.name) + cell(o.code) + cell(o.normPct === null ? '' : String(o.normPct).replace('.', ','), 1) + cell(o.normMass === null ? '' : Q(o.normMass), 1) +
          '<td class="r" colspan="2">' + (o.normMass === null ? '' : Q(o.normMass)) + '</td>' + cell(o.waste ? '' : M(o.price), 1) + cell(Q(o.mass), 1) + cell(o.waste ? '0,00' : M(o.sum), 1) + cell(o.dev === null ? '' : (o.dev > 0 ? '+' : '') + Q(o.dev), 1) + '</tr>';
      });
    });
    b += '<tr class="it"><td colspan="5" style="text-align:right">Итого</td>' + cell(Q(data.totals.raw), 1) + cell(M(data.totals.rawSum), 1) + '<td colspan="7"></td>' + cell(Q(data.totals.out), 1) + cell(M(data.totals.outSum), 1) + '<td></td></tr></table>';
    b += '<div class="sig">Переработано мяса-сырья <b>' + Q(data.totals.raw) + '</b> кг. Выработано полуфабрикатов <b>' + Q(data.totals.out) + '</b> кг.</div>' +
      _v72Sign_('Представитель администрации', {}, true) + _v72Sign_('Заведующий производством', h.chief) + _v72Sign_('Мастер (бригадир)', {}) + _v72Sign_('', {}, true) + _v72Sign_('Проверил бухгалтер', {}) + '<div class="sig">Приложение ____ документов</div>';
    var srcs = data.acts.reduce(function (a, x) { return a.concat(x.outs.filter(function (o) { return o.normSrc; }).map(function (o) { return o.name + ' — ' + o.normPct + '%: ' + o.normSrc; })); }, []);
    if (srcs.length) b += '<div class="notes">Основания норм выхода: ' + E(srcs.filter(function (x, i) { return srcs.indexOf(x) === i; }).join('; ')) + '.</div>';
  }
  var css = MC_V72_CSS_ + (F.wide ? '@page{size:A4 landscape;margin:8mm}body{width:1060px}.t th,.t td{font-size:7.5px}' : '');
  return '<html><head><meta charset="utf-8"><title>' + E(form + ' ' + F.name) + '</title><style>' + css + '</style></head><body>' + _v72Head_(form, h) + b +
    '<div class="mk">Сформировано в MON CHEF ' + E(h.made || Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH:mm')) + (h.docId ? ' · ' + E(h.docId) : ' · предпросмотр, без номера') + '</div></body></html>';
}

/* ---------------- реестр ---------------- */
function _v72RegRows_() {
  var v = _v72Reg_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0]) continue;
    out.push({ row: i + 1, docId: String(r[0]), form: String(r[1]), number: String(r[2]), date: _v72Day_(r[3]), from: _v72Day_(r[4]), to: _v72Day_(r[5]), subdivision: String(r[6] || ''), recipient: String(r[7] || ''),
      sale: r[10] === '' ? null : Number(r[10]), cost: r[11] === '' ? null : Number(r[11]), status: String(r[12] || 'ACTIVE'), by: String(r[13] || ''), at: r[14], url: String(r[16] || ''), fileId: String(r[15] || ''),
      cancelledBy: String(r[19] || ''), cancelReason: String(r[20] || '') });
  }
  return out;
}
function _v72Params_(json) {
  var d = _mcBlJson_(json) || {}, form = String(d.form || '').replace(/^OP/i, 'ОП').replace(/\s/g, '');
  if (!MC_V72_FORMS_[form]) throw new Error('VALIDATION: выберите форму: ' + MC_V72_ORDER_.join(', '));
  var day = _v72Day_(d.date) || _v72Day_(new Date());
  if (day > _v72Day_(new Date())) throw new Error('VALIDATION: дата позже сегодняшней');
  if (form === 'ОП-23') { var f = _v72Day_(d.from) || day, t = _v72Day_(d.to) || day; if (f > t) throw new Error('VALIDATION: начало периода позже конца'); d.from = f; d.to = t; }
  var pick = function (x) { return x && (x.name || x.position) ? { name: String(x.name || '').trim(), position: String(x.position || '').trim() } : null; };
  return { form: form, date: day, from: d.from || '', to: d.to || '', subdivision: String(d.subdivision || '').trim(), recipient: String(d.recipient || '').trim(), via: String(d.via || '').trim(),
    head: pick(d.head), chief: pick(d.chief), prices: pick(d.prices), handedBy: pick(d.handedBy) || {}, receivedBy: pick(d.receivedBy) || {}, admin: pick(d.admin) || {} };
}
function _v72HeadData_(p, extra) {
  var sg = _v72Signers_(), o = _mcOrg_();
  return { org: o, subdivision: _v72Sub_(p, p.form), recipient: p.recipient || '', head: p.head || sg.head, chief: p.chief || sg.chief, prices: p.prices || {}, date: p.date, from: p.from, to: p.to,
    number: extra && extra.number, docId: extra && extra.docId, made: extra && extra.made };
}

/* ---------------- API экрана ---------------- */
/** Экран «Документы ОП»: формы, организация, подписанты, сотрудники, цеха, последние документы. */
function v72Init(token) {
  try {
    _requireAuth_(token, 'stock|finance_view');
    var o = _mcOrg_(), ws = _v72Workshops_(), wl = {};
    Object.keys(ws).forEach(function (k) { if (ws[k]) wl[ws[k]] = true; });
    return _ok_({ forms: MC_V72_ORDER_.map(function (k) { var f = MC_V72_FORMS_[k]; return { id: k, name: f.name, okud: f.okud, period: f.period }; }),
      org: { name: o.name, objectName: o.objectName, okpo: o.okpo || '', okved: o.okved || '', responsibleName: o.responsibleName, responsiblePosition: o.responsiblePosition },
      signers: _v72Signers_(), staff: _v72Staff_().map(function (e) { return { name: e.name, position: e.position }; }),
      workshops: Object.keys(wl).sort().concat(['Обработка сырья', 'Производство']), today: _v72Day_(new Date()),
      docs: _v72RegRows_().slice(-60).reverse(), canCreate: true });
  } catch (e) { return _failFrom_(e); }
}
/** Предпросмотр документа без номера и без записи. */
function v72Preview(json, token) {
  try {
    _requireAuth_(token, 'stock|finance_view');
    var p = _v72Params_(json), data = _v72Build_(p.form, p), h = _v72HeadData_(p);
    if (p.form === 'ОП-3') h.recipient = data.recipient;
    return _ok_({ form: p.form, html: _v72Html_(p.form, data, h), notes: data.notes, recipients: data.recipients || [], pairs: data.pairs || [], rows: (data.rows || data.acts || data.goods || []).length, totals: data.totals });
  } catch (e) { return _failFrom_(e); }
}
/** Сформировать документ: номер по форме и году, снимок данных, PDF в папке «Документы ОП», запись реестра. */
function v72Create(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock|finance_view', 'OPFORM_CREATE', 'Документы ОП', '', null); } catch (e) { return _failFrom_(e); }
  try {
    var p = _v72Params_(json);
    return _withLock_(function () {
      var data = _v72Build_(p.form, p);
      var empty = p.form === 'ОП-18' ? !(data.goods.length + data.tare.length) : p.form === 'ОП-23' ? !data.acts.length : !data.rows.length;
      if (empty) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Документ пустой: ' + (data.notes[0] || 'нет данных за выбранный день'), op.id); }
      var year = (p.date || '').slice(0, 4), regs = _v72RegRows_(), n = regs.filter(function (d) { return d.form === p.form && d.date.slice(0, 4) === year; }).length + 1;
      var number = String(n), docId = p.form.replace('ОП-', 'OP') + '-' + year + '-' + ('000' + n).slice(-4), made = Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH:mm'), who = _author_(op).фио;
      var h = _v72HeadData_(p, { number: number, docId: docId, made: made });
      if (p.form === 'ОП-3') { h.recipient = data.recipient; p.recipient = data.recipient; }
      var html = _v72Html_(p.form, data, h), file = null;
      try {
        var pdf = Utilities.newBlob(html, 'text/html', 'doc.html').getAs('application/pdf').setName(p.form + ' № ' + number + ' от ' + _v72Ru_(p.date) + (p.recipient ? ' ' + p.recipient : '') + '.pdf');
        var f = _v72Folder_().createFile(pdf);
        file = { id: f.getId(), url: f.getUrl(), sha: _bkHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pdf.getBytes())) };
      } catch (pe) { _log_('WARN', 'V72: PDF ' + docId + ' не создан: ' + pe, op.id); }
      var T = data.totals || {}, sale = T.all !== undefined ? T.all : (T.sum !== undefined ? T.sum : ''), cost = T.cost !== undefined ? T.cost : (T.rawSum !== undefined ? T.rawSum : (T.all !== undefined && p.form === 'ОП-18' ? T.all : ''));
      if (p.form === 'ОП-18') sale = '';
      var snap = { params: p, head: { subdivision: h.subdivision, recipient: h.recipient, head: h.head, chief: h.chief, prices: h.prices, org: { name: h.org.name, okpo: h.org.okpo || '', okved: h.org.okved || '' } }, data: data, made: made };
      _v72Reg_().appendRow([docId, p.form, number, p.date, p.from || '', p.to || '', h.subdivision, h.recipient || '', JSON.stringify(p), JSON.stringify(snap), sale, cost, 'ACTIVE', who, new Date(),
        file ? file.id : '', file ? file.url : '', file ? file.sha : '', op.id, '', '']);
      _audit_(op, 'OPFORM_CREATE', 'Документы ОП', docId, null, { форма: p.form, номер: number, дата: p.date, подразделение: h.subdivision, получатель: h.recipient || '', строк: (data.rows || data.acts || []).length, итог: sale, учётная: cost });
      _endOp_(op);
      return _ok_({ docId: docId, form: p.form, number: number, date: p.date, url: file ? file.url : '', pdf: !!file, notes: data.notes }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v72Folder_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty(MC_V72.FOLDER_PROP);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = _docsFolder_().createFolder('Документы ОП (унифицированные формы)'); p.setProperty(MC_V72.FOLDER_PROP, f.getId()); return f;
}
/** Документ из реестра: HTML — из снимка данных (не пересчитывается). */
function v72Get(docId, token) {
  try {
    _requireAuth_(token, 'stock|finance_view');
    var v = _v72Reg_().getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(docId)) {
      var snap = {}; try { snap = JSON.parse(v[i][9] || '{}'); } catch (e) {}
      var p = snap.params || {}, hh = snap.head || {}, org = _mcOrg_(); org.name = (hh.org && hh.org.name) || org.name; org.okpo = (hh.org && hh.org.okpo) || ''; org.okved = (hh.org && hh.org.okved) || '';
      var h = { org: org, subdivision: hh.subdivision, recipient: hh.recipient, head: hh.head || {}, chief: hh.chief || {}, prices: hh.prices || {}, date: p.date, from: p.from, to: p.to, number: String(v[i][2]), docId: String(v[i][0]), made: snap.made };
      var html = _v72Html_(String(v[i][1]), snap.data || {}, h);
      if (String(v[i][12]) === 'CANCELLED') html = html.replace('<body>', '<body><div style="color:#a00;font-weight:bold;border:2px solid #a00;padding:4px;margin-bottom:6px">АННУЛИРОВАН: ' + _v72E_(v[i][20] || '') + '</div>');
      return _ok_({ docId: String(v[i][0]), form: String(v[i][1]), number: String(v[i][2]), status: String(v[i][12]), url: String(v[i][16] || ''), html: html, notes: (snap.data || {}).notes || [] });
    }
    return _fail_('NOT_FOUND', 'Документ не найден');
  } catch (e) { return _failFrom_(e); }
}
/** Аннулировать документ (с причиной). Номер повторно не используется, PDF остаётся в папке, в реестре — «аннулирован». */
function v72Cancel(docId, reason, token) {
  var op = null;
  try { op = _beginOp_(token, 'stock|finance_close', 'OPFORM_CANCEL', 'Документы ОП', docId, null); } catch (e) { return _failFrom_(e); }
  try {
    reason = String(reason || '').trim();
    if (!reason) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину аннулирования', op.id); }
    return _withLock_(function () {
      var sh = _v72Reg_(), v = sh.getDataRange().getValues();
      for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(docId)) {
        if (String(v[i][12]) === 'CANCELLED') { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Документ уже аннулирован', op.id); }
        var who = _author_(op).фио;
        sh.getRange(i + 1, 13).setValue('CANCELLED'); sh.getRange(i + 1, 20, 1, 2).setValues([[who + ', ' + Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy HH:mm'), reason]]);
        _audit_(op, 'OPFORM_CANCEL', 'Документы ОП', docId, 'ACTIVE', { status: 'CANCELLED', reason: reason });
        _endOp_(op);
        return _ok_({ docId: docId, status: 'CANCELLED' }, op.id);
      }
      _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Документ не найден', op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
