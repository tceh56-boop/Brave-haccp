/**
 * ЦЕХ Стандарт — формы первичных документов общественного питания (унифицированные формы ОП,
 * постановление Госкомстата России от 25.12.1998 № 132).
 *
 * Формы: ОП-3 «Требование в кладовую», ОП-7 «Опись дневных заборных листов», ОП-10 «Акт о реализации и отпуске
 * изделий кухни», ОП-11 «Акт о продаже и отпуске изделий кухни», ОП-12 «Акт о реализации готовых изделий кухни
 * за наличный расчёт», ОП-18 «Акт о передаче товаров и тары при смене материально ответственного лица»,
 * ОП-21 «Акт на отпуск питания сотрудникам организации», ОП-23 «Акт о разделке мяса (сырья) на полуфабрикаты».
 *
 * Что подставляется само:
 *   • организация, ОКПО, структурное подразделение, руководитель для «Утверждаю» — из «Настройки → Организация»
 *     (подразделение можно сменить в документе, например «Горячий цех» или «Буфет»);
 *   • строки — из данных системы: продажи (Ж_Продажи), остатки склада (Склад_Остатки), сотрудники, акты разбора,
 *     ранее составленные требования (для описи ОП-7);
 *   • цены: учётная цена товара — средняя цена склада; цена продажи блюда — «Цены_Меню» (меню, договор банкета),
 *     иначе цена из продажи; учётная цена блюда — нормативная себестоимость порции по действующей ТТК.
 *     Цены нет — строка помечается «нет цены», ноль молча не ставится. Суммы и итог прописью считает сервер.
 * Логотипов и названий сторонних организаций в формах нет: печатается только то, что задано в настройках клиента.
 */
var TS_OP_SHEET_ = 'Формы_ОП';
var TS_OP_HEAD_ = ['Номер', 'Форма', 'Дата', 'Подразделение', 'Данные', 'Сумма', 'Составил', 'Создано'];
var TS_OP_OKEI_ = { 'г': '163', 'кг': '166', 'мл': '111', 'л': '112', 'шт': '796', 'порц': '639', 'упак': '778' };

// cols: [ключ, заголовок, тип] — тип: text | num (количество) | money (цена/сумма, считается) | auto (служебное)
var TS_OP_FORMS_ = {
  OP3: { code: 'ОП-3', okud: '0330503', title: 'Требование в кладовую', source: 'stock', approve: false, params: ['date', 'division', 'recipient'],
    help: 'Товары, которые кухня берёт из кладовой. Наименование выбирается из склада, цена — средняя учётная цена склада.',
    cols: [['name', 'Товар, наименование', 'text'], ['code', 'Код', 'text'], ['unit', 'Ед. изм.', 'text'], ['okei', 'Код по ОКЕИ', 'auto'],
      ['qtyReq', 'Затребовано', 'num'], ['qty', 'Отпущено', 'num'], ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма, руб. коп.', 'money']],
    signs: ['Затребовал', 'Разрешил', 'Отпустил', 'Получил'] },
  OP7: { code: 'ОП-7', okud: '0330507', title: 'Опись дневных заборных листов', source: 'op3list', approve: false, params: ['from', 'to', 'division'],
    help: 'Опись требований в кладовую (ОП-3), составленных в системе за период. Суммы берутся из самих требований.',
    cols: [['date', 'Дата', 'text'], ['docNo', 'Номер документа', 'text'], ['sender', 'Подразделение', 'text'], ['sum', 'Сумма по учётным ценам, руб. коп.', 'money']],
    signs: ['Опись сдал (материально ответственное лицо)', 'Опись принял (бухгалтер)'] },
  OP10: { code: 'ОП-10', okud: '0330510', title: 'Акт о реализации и отпуске изделий кухни', source: 'sales', approve: true, landscape: true, params: ['date', 'division'],
    help: 'Изделия кухни, реализованные за день (журнал продаж). Цена продажи — из меню или продажи, учётная — себестоимость по ТТК.',
    cols: [['name', 'Изделие, наименование', 'text'], ['code', 'Код', 'text'], ['ttk', '№ ТТК', 'text'], ['qty', 'Количество, порц.', 'num'],
      ['salePrice', 'Цена продажи', 'money'], ['saleSum', 'Сумма по ценам продажи', 'money'], ['price', 'Учётная цена', 'money'], ['sum', 'Сумма по учётным ценам', 'money']],
    signs: ['Заведующий производством', 'Бухгалтер'] },
  OP11: { code: 'ОП-11', okud: '0330511', title: 'Акт о продаже и отпуске изделий кухни', source: 'sales', approve: true, params: ['date', 'division', 'recipient'],
    help: 'Отпуск изделий кухни в буфет, на раздачу или в другое подразделение. Получатель указывается в документе.',
    cols: [['name', 'Изделие, наименование', 'text'], ['code', 'Код', 'text'], ['qty', 'Количество, порц.', 'num'],
      ['salePrice', 'Цена продажи', 'money'], ['saleSum', 'Сумма по ценам продажи', 'money'], ['price', 'Учётная цена', 'money'], ['sum', 'Сумма по учётным ценам', 'money']],
    signs: ['Сдал (заведующий производством)', 'Принял'] },
  OP12: { code: 'ОП-12', okud: '0330512', title: 'Акт о реализации готовых изделий кухни за наличный расчёт', source: 'sales', approve: true, params: ['date', 'division'],
    help: 'Готовые изделия, проданные за наличный расчёт за день. Цена — продажная (меню или продажа).',
    cols: [['name', 'Изделие, наименование', 'text'], ['code', 'Код', 'text'], ['qty', 'Количество, порц.', 'num'], ['salePrice', 'Цена продажи', 'money'], ['saleSum', 'Сумма, руб. коп.', 'money']],
    signs: ['Заведующий производством', 'Кассир'] },
  OP18: { code: 'ОП-18', okud: '0330518', title: 'Акт о передаче товаров и тары при смене материально ответственного лица', source: 'balance', approve: true, params: ['date', 'division', 'from', 'to'],
    help: 'Остатки склада на дату передачи с учётными ценами. Сдающее и принимающее лицо указываются в документе.',
    paramLabels: { from: 'Сдаёт (ФИО)', to: 'Принимает (ФИО)' },
    cols: [['name', 'Товар, тара — наименование', 'text'], ['code', 'Код', 'text'], ['unit', 'Ед. изм.', 'text'], ['okei', 'Код по ОКЕИ', 'auto'],
      ['qty', 'Количество', 'num'], ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма, руб. коп.', 'money']],
    signs: ['Сдал', 'Принял', 'Председатель комиссии', 'Члены комиссии'] },
  OP21: { code: 'ОП-21', okud: '0330521', title: 'Акт на отпуск питания сотрудникам организации', source: 'staff', approve: true, params: ['date', 'division', 'dish'],
    help: 'Список работающих сотрудников. Стоимость порции — цена выбранного блюда (рациона) из меню; без блюда — укажите цену вручную.',
    cols: [['name', 'Фамилия, имя, отчество', 'text'], ['tab', 'Табельный номер', 'text'], ['position', 'Должность', 'text'], ['qty', 'Количество порций', 'num'],
      ['salePrice', 'Стоимость порции', 'money'], ['saleSum', 'Сумма, руб. коп.', 'money']],
    signs: ['Заведующий производством', 'Ответственный за отпуск питания', 'Бухгалтер'] },
  OP23: { code: 'ОП-23', okud: '0330523', title: 'Акт о разделке мяса (сырья) на полуфабрикаты', source: 'disassembly', approve: true, landscape: true, params: ['date', 'division'],
    help: 'Акты зачистки и разделки за день: взятое сырьё, полученные полуфабрикаты и отходы. Стоимость сырья — цена партии, полуфабрикатам — по массе выхода.',
    cols: [['kind', 'Вид', 'auto'], ['name', 'Наименование', 'text'], ['code', 'Партия / код', 'text'], ['unit', 'Ед. изм.', 'text'], ['qty', 'Количество', 'num'],
      ['pct', '% выхода', 'auto'], ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма, руб. коп.', 'money']],
    signs: ['Заведующий производством', 'Разделку провёл', 'Члены комиссии'] }
};

/* ------------------------------------------------------------------ служебное */
function _tsOpSheet_() { return _bcSheet_(TS_OP_SHEET_, TS_OP_HEAD_); }
function _tsOpE_(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function _tsOpNum_(x) { if (typeof x === 'number') return isFinite(x) ? x : 0; var n = parseFloat(String(x === null || x === undefined ? '' : x).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
function _tsOpR2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function _tsOpR4_(x) { return Math.round((Number(x) || 0) * 10000) / 10000; }
function _tsOpR6_(x) { return Math.round((Number(x) || 0) * 1e6) / 1e6; }
function _tsOpR3_(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
function _tsOpMoney_(x, unitPrice) { var v = unitPrice ? _tsOpR4_(x) : _tsOpR2_(x), s = (unitPrice && v !== _tsOpR2_(v) ? String(v) : v.toFixed(2)).split('.'); return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + s[1]; }
function _tsOpQty_(x) { return String(_tsOpR3_(x)).replace('.', ','); }
function _tsOpKey_(s) { try { return _prodKey_(s); } catch (e) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); } }
function _tsOpIsoDay_(d) { return Utilities.formatDate(d, _mcTz_(), 'yyyy-MM-dd'); }
function _tsOpRuDay_(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '.' + m[2] + '.' + m[1] : String(iso || ''); }
function _tsOpParseDay_(x) {
  if (x === '' || x === null || x === undefined) return null;
  if (Object.prototype.toString.call(x) === '[object Date]') return isNaN(x.getTime()) ? null : _tsOpIsoDay_(x);
  var s = String(x).replace(/^'/, '').trim(), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : null;
}
/** Лист как массив объектов по заголовкам (лист может отсутствовать). */
function _tsOpRows_(name) {
  var sh = _book_().getSheetByName(name); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x || '').trim(); });
  return v.slice(1).filter(function (r) { return r.some(function (x) { return x !== '' && x !== null; }); })
    .map(function (r) { var o = {}; h.forEach(function (k, i) { if (k && !(k in o)) o[k] = r[i]; }); return o; });
}
function _tsOpWho_(s) { return s ? String(s.fullName || s.name || '') : ''; }

/* ------------------------------------------------------------------ реквизиты */
/** Шапка формы: организация, ОКПО, подразделение, руководитель — из настроек; подразделение можно заменить. */
function _tsOpOrg_(division) {
  var o = {};
  try { if (typeof _mcOrg_ === 'function') o = _mcOrg_() || {}; } catch (e) { o = {}; }
  var orgLine = [o.name || o.shortName || '', o.inn ? 'ИНН ' + o.inn : '', o.actualAddress || o.legalAddress || ''].filter(String).join(', ');
  return { name: String(o.name || o.shortName || ''), line: orgLine, okpo: String(o.okpo || ''), inn: String(o.inn || ''),
    division: String(division || o.division || o.objectName || ''), director: String(o.directorName || o.responsibleName || ''),
    directorPosition: String(o.directorPosition || (o.directorName ? 'Руководитель' : o.responsiblePosition) || 'Руководитель'),
    missing: [o.name ? '' : 'наименование организации', o.okpo ? '' : 'ОКПО'].filter(String) };
}

/* ------------------------------------------------------------------ цены */
var _TS_OP_CACHE_ = null;
function _tsOpCache_() { return _TS_OP_CACHE_ || (_TS_OP_CACHE_ = { menu: null, sales: null, dish: {}, stock: null }); }
function _tsOpDish_(nameOrCode) { try { return typeof _v64DishOf_ === 'function' ? _v64DishOf_(nameOrCode) : null; } catch (e) { return null; } }
/** Учётная цена товара за единицу unit — средняя цена склада. */
function _tsOpStockPrice_(name, unit) { try { return _tsOpR6_(_currentAvgPrice_(name, unit || 'г') || 0); } catch (e) { return 0; } }
/** Цена продажи блюда на дату: «Цены_Меню» (меню / договор) → последняя продажа в журнале продаж. */
function _tsOpSalePrice_(name, iso) {
  var C = _tsOpCache_(), at = iso ? new Date(iso + 'T12:00:00') : new Date();
  try { if (typeof _v64MenuPrices_ === 'function') { C.menu = C.menu || _v64MenuPrices_(); var p = _v64PriceFor_(C.menu, name, null, at); if (p && p.price > 0) return { price: _tsOpR2_(p.price), source: 'меню' }; } } catch (e) {}
  C.sales = C.sales || _tsOpRows_('Ж_Продажи');
  var k = _tsOpKey_(name), last = null;
  C.sales.forEach(function (r) { var pr = _tsOpNum_(r['Цена']), d = _tsOpParseDay_(r['Дата']); if (pr > 0 && _tsOpKey_(r['Блюдо']) === k && (!iso || !d || d <= iso)) last = pr; });
  return last ? { price: _tsOpR2_(last), source: 'продажа' } : { price: 0, source: '' };
}
/** Учётная цена порции блюда — нормативная себестоимость по ТТК и текущим ценам склада. */
function _tsOpDishCost_(name) {
  var C = _tsOpCache_(), k = _tsOpKey_(name);
  if (k in C.dish) return C.dish[k];
  var c = 0; try { if (typeof _v64NormCost_ === 'function') { var r = _v64NormCost_(name); c = r && !(r.missing && r.missing.length) ? r.cost : (r && r.cost > 0 ? r.cost : 0); } } catch (e) { c = 0; }
  return (C.dish[k] = _tsOpR2_(c));
}
function _tsOpStock_() {
  var C = _tsOpCache_(); if (C.stock) return C.stock;
  return (C.stock = _tsOpRows_('Склад_Остатки').map(function (r) {
    return { name: String(r['Продукт'] || ''), unit: String(r['Ед.изм'] || 'г'), qty: _tsOpNum_(r['Остаток']), price: _tsOpR2_(_tsOpNum_(r['Сред.цена']) || _tsOpNum_(r['Цена послед.закупки'])) };
  }).filter(function (x) { return x.name; }));
}

/** Подставить цену в строку, если её не ввели; пересчитать суммы. Возвращает строку с флагом noPrice. */
function _tsOpPriceRow_(f, row, iso) {
  var r = {}; Object.keys(row || {}).forEach(function (k) { r[k] = row[k]; });
  var has = function (k) { return f.cols.some(function (c) { return c[0] === k; }); };
  r.qty = _tsOpR3_(_tsOpNum_(r.qty)); if (has('qtyReq')) r.qtyReq = r.qtyReq === '' || r.qtyReq === undefined ? r.qty : _tsOpR3_(_tsOpNum_(r.qtyReq));
  if (has('okei')) r.okei = TS_OP_OKEI_[String(r.unit || '').toLowerCase()] || '';
  var src = [];
  if (has('salePrice')) {
    var sp = _tsOpNum_(r.salePrice);
    if (!(sp > 0) && r.name && f.source !== 'staff') { var s = _tsOpSalePrice_(r.name, iso); sp = s.price; if (sp > 0) src.push('цена продажи — ' + s.source); }
    r.salePrice = _tsOpR6_(sp); r.saleSum = _tsOpR2_(sp * r.qty);
  }
  if (has('price')) {
    var p = _tsOpNum_(r.price);
    if (!(p > 0) && r.name && r.kind !== 'отходы') {
      if (f.source === 'sales') { p = _tsOpDishCost_(r.name); if (p > 0) src.push('учётная — себестоимость по ТТК'); }
      else if (f.source === 'stock' || f.source === 'balance') { p = _tsOpStockPrice_(r.name, r.unit); if (p > 0) src.push('учётная — средняя цена склада'); }
    }
    r.price = _tsOpR6_(p); r.sum = r.kind === 'отходы' ? 0 : _tsOpR2_(p * r.qty);
  }
  if (f.source === 'op3list') r.sum = _tsOpR2_(_tsOpNum_(r.sum));
  var need = (has('salePrice') && !(r.salePrice > 0)) || (has('price') && r.kind !== 'отходы' && !(r.price > 0));
  r.noPrice = !!(r.name && r.qty > 0 && need && f.source !== 'op3list');
  r.priceSource = src.join('; ');
  return r;
}
function _tsOpTotals_(f, rows) {
  var t = { qty: 0, sum: 0, saleSum: 0 };
  rows.forEach(function (r) { if (r.kind === 'отходы' || r.kind === 'полуфабрикат') return; t.qty += _tsOpNum_(r.qty); t.sum += _tsOpNum_(r.sum); t.saleSum += _tsOpNum_(r.saleSum); });
  t.qty = _tsOpR3_(t.qty); t.sum = _tsOpR2_(t.sum); t.saleSum = _tsOpR2_(t.saleSum);
  var has = function (k) { return f.cols.some(function (c) { return c[0] === k; }); };
  t.main = has('saleSum') ? t.saleSum : t.sum;
  return t;
}

/* ------------------------------------------------------------------ заполнение из данных */
function _tsOpFill_(form, p) {
  var f = TS_OP_FORMS_[form], iso = _tsOpParseDay_(p.date) || _tsOpIsoDay_(new Date()), rows = [];
  if (f.source === 'sales') {
    var agg = {};
    _tsOpRows_('Ж_Продажи').forEach(function (r) {
      if (_tsOpParseDay_(r['Дата']) !== iso || !String(r['Блюдо'] || '').trim()) return;
      var nm = String(r['Блюдо']).trim(), k = _tsOpKey_(nm), q = _tsOpNum_(r['Количество']); if (!(q > 0)) return;
      var a = agg[k] || (agg[k] = { name: nm, qty: 0, prices: {} });
      a.qty += q; var pr = _tsOpNum_(r['Цена']); if (pr > 0) a.prices[pr] = (a.prices[pr] || 0) + q;
    });
    Object.keys(agg).forEach(function (k) {
      var a = agg[k], d = _tsOpDish_(a.name), pl = Object.keys(a.prices);
      // разные цены в один день — отдельные строки, чтобы сумма совпала с журналом продаж; продажа без цены — цена из меню
      var code = d ? d.code : '', priced = 0;
      pl.forEach(function (pr) { priced += a.prices[pr]; rows.push({ name: a.name, code: code, ttk: code, qty: a.prices[pr], salePrice: Number(pr) }); });
      if (a.qty - priced > 0.0001) rows.push({ name: a.name, code: code, ttk: code, qty: a.qty - priced, salePrice: 0 });
    });
    rows = rows.filter(function (r) { return r.qty > 0; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  } else if (f.source === 'balance') {
    rows = _tsOpStock_().filter(function (x) { return x.qty > 0; }).map(function (x) { return { name: x.name, unit: x.unit, qty: x.qty, price: x.price }; })
      .sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  } else if (f.source === 'staff') {
    var price = 0; if (p.dish) price = _tsOpSalePrice_(p.dish, iso).price;
    rows = _tsOpRows_('Сотрудники').filter(function (r) { var a = String(r['Активен']); return !/^(false|нет|0)$/i.test(a); })
      .map(function (r) { return { name: [r['Фамилия'], r['Имя'], r['Отчество']].filter(function (x) { return String(x || '').trim(); }).join(' '), tab: String(r['Табельный номер'] || ''), position: String(r['Должность'] || ''), qty: 1, salePrice: price }; })
      .filter(function (r) { return r.name; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  } else if (f.source === 'disassembly') {
    var lines = {}, batches = {};
    _tsOpRows_('Разбор_Строки').forEach(function (r) { var a = String(r['АктID'] || ''); (lines[a] = lines[a] || []).push(r); });
    _tsOpRows_('Склад_Партии').forEach(function (r) { var id = String(r['ID'] || r['BatchID'] || ''); if (id) batches[id] = r; });
    var bPrice = function (id) { var b = batches[id]; return b ? _tsOpNum_(b['Цена за ед.']) : 0; };
    _tsOpRows_('Разбор_Акты').forEach(function (a) {
      if (_tsOpParseDay_(a['Дата']) !== iso || String(a['Тип'] || '') === 'DEFROST') return;
      var id = String(a['ID'] || ''), unit = String(a['ЕдИзм'] || 'г'), taken = _tsOpNum_(a['Взято'] || a['ИсходныйВес']), src = String(a['ПартияИсточник'] || '');
      var pr = bPrice(src); if (!(pr > 0)) pr = _tsOpStockPrice_(String(a['Продукт'] || ''), unit);
      var cost = taken * pr, ls = lines[id] || [];
      var outs = ls.filter(function (x) { return /product|выход/i.test(String(x['Тип'])); }), wastes = ls.filter(function (x) { return /waste|отход/i.test(String(x['Тип'])); });
      var P = outs.reduce(function (s, x) { return s + _tsOpNum_(x['Вес']); }, 0);
      rows.push({ kind: 'сырьё', name: String(a['Продукт'] || ''), code: src, unit: unit, qty: taken, pct: '', price: _tsOpR4_(pr) });
      outs.forEach(function (x) { var w = _tsOpNum_(x['Вес']); rows.push({ kind: 'полуфабрикат', name: String(x['Название'] || ''), code: String(x['НовыйBatchID'] || ''), unit: unit, qty: w,
        pct: taken > 0 ? _tsOpR2_(w / taken * 100) : '', price: w > 0 && P > 0 ? _tsOpR6_(cost / P) : 0 }); });
      wastes.forEach(function (x) { var w = _tsOpNum_(x['Вес']); rows.push({ kind: 'отходы', name: String(x['Название'] || 'Отходы'), code: '', unit: unit, qty: w, pct: taken > 0 ? _tsOpR2_(w / taken * 100) : '', price: 0 }); });
    });
  } else if (f.source === 'op3list') {
    var from = _tsOpParseDay_(p.from) || iso, to = _tsOpParseDay_(p.to) || iso;
    _tsOpRows_(TS_OP_SHEET_).forEach(function (r) {
      var d = _tsOpParseDay_(r['Дата']); if (String(r['Форма']) !== 'ОП-3' || !d || d < from || d > to) return;
      rows.push({ date: _tsOpRuDay_(d), docNo: String(r['Номер']), sender: String(r['Подразделение'] || ''), sum: _tsOpNum_(r['Сумма']) });
    });
  }
  return rows.map(function (r) { return _tsOpPriceRow_(f, r, iso); });
}

/* ------------------------------------------------------------------ API */
/** Список форм, реквизиты из настроек, подсказки (товары склада, блюда, подразделения) и составленные документы. */
function tsOpList(token) {
  try {
    _requireAuth_(token); _TS_OP_CACHE_ = null;
    var org = _tsOpOrg_('');
    var forms = Object.keys(TS_OP_FORMS_).map(function (k) { var f = TS_OP_FORMS_[k]; return { key: k, code: f.code, title: f.title, okud: f.okud, help: f.help, params: f.params, paramLabels: f.paramLabels || {}, cols: f.cols }; });
    var dishes = []; try { var D = _v64Dishes_(); dishes = Object.keys(D.byCode).map(function (c) { return D.byCode[c]; }).filter(function (d) { return !d.semi; }).map(function (d) { return d.name; }).sort(); } catch (e) {}
    var divisions = []; try { var ws = _dishWorkshopMap_() || {}; Object.keys(ws).forEach(function (k) { var v = String(ws[k] || '').trim(); if (v && divisions.indexOf(v) < 0) divisions.push(v); }); } catch (e) {}
    if (org.division && divisions.indexOf(org.division) < 0) divisions.unshift(org.division);
    var issued = _tsOpRows_(TS_OP_SHEET_).map(function (r) { return { no: String(r['Номер']), form: String(r['Форма']), date: _tsOpParseDay_(r['Дата']) || '', division: String(r['Подразделение'] || ''), sum: _tsOpNum_(r['Сумма']), who: String(r['Составил'] || '') }; }).reverse().slice(0, 200);
    return _ok_({ forms: forms, org: org, products: _tsOpStock_().map(function (x) { return { name: x.name, unit: x.unit }; }), dishes: dishes, divisions: divisions, issued: issued });
  } catch (e) { return _failFrom_(e); }
}
/** Заполнить форму из данных системы (без сохранения): строки с ценами и итоги. */
function tsOpPrefill(token, form, params) {
  try {
    _requireAuth_(token); _TS_OP_CACHE_ = null;
    var f = TS_OP_FORMS_[form]; if (!f) return _fail_('VALIDATION', 'Неизвестная форма');
    params = typeof params === 'string' ? JSON.parse(params || '{}') : (params || {});
    var rows = _tsOpFill_(form, params);
    return _ok_({ rows: rows, totals: _tsOpTotals_(f, rows), noPrice: rows.filter(function (r) { return r.noPrice; }).length, org: _tsOpOrg_(params.division) });
  } catch (e) { return _failFrom_(e); }
}
/** Цена для строки, добавленной вручную: учётная и продажная. */
function tsOpPrice(token, form, name, unit, date) {
  try {
    _requireAuth_(token);
    var f = TS_OP_FORMS_[form]; if (!f) return _fail_('VALIDATION', 'Неизвестная форма');
    unit = String(unit || '');
    if (!unit && (f.source === 'stock' || f.source === 'balance')) { var st = _tsOpStock_().filter(function (x) { return _tsOpKey_(x.name) === _tsOpKey_(name); })[0]; if (st) unit = st.unit; }
    var r = _tsOpPriceRow_(f, { name: String(name || ''), unit: unit, qty: 1, code: (_tsOpDish_(name) || {}).code || '' }, _tsOpParseDay_(date));
    return _ok_({ code: r.code || '', unit: r.unit || '', okei: r.okei || '', price: r.price || 0, salePrice: r.salePrice || 0, source: r.priceSource, noPrice: r.noPrice });
  } catch (e) { return _failFrom_(e); }
}
/** Сохранить документ: номер по форме и году, пустые цены подставляются, суммы и итог считаются здесь. */
function tsOpCreate(token, form, doc) {
  try {
    var s = _requireAuth_(token); _TS_OP_CACHE_ = null;
    var f = TS_OP_FORMS_[form]; if (!f) return _fail_('VALIDATION', 'Неизвестная форма');
    doc = typeof doc === 'string' ? JSON.parse(doc || '{}') : (doc || {});
    var p = doc.params || {}, iso = _tsOpParseDay_(p.date) || _tsOpIsoDay_(new Date());
    var rows = (doc.rows || []).filter(function (r) { return r && String(r.name || r.docNo || '').trim(); }).map(function (r) { return _tsOpPriceRow_(f, r, iso); });
    if (!rows.length) return _fail_('VALIDATION', 'В документе нет строк');
    if (f.source !== 'op3list' && f.source !== 'disassembly' && rows.some(function (r) { return !(r.qty > 0); })) return _fail_('VALIDATION', 'Укажите количество в каждой строке');
    var totals = _tsOpTotals_(f, rows), org = _tsOpOrg_(p.division);
    return _withLock_(function () {
      var y = iso.slice(0, 4), n = _tsOpRows_(TS_OP_SHEET_).filter(function (r) { return String(r['Форма']) === f.code && String(_tsOpParseDay_(r['Дата']) || '').slice(0, 4) === y; }).length + 1;
      var no = f.code + '/' + y + '/' + n, who = _tsOpWho_(s);
      var data = { form: form, n: n, params: p, rows: rows, totals: totals, org: org, who: who };
      _tsOpSheet_().appendRow([no, f.code, iso, org.division, JSON.stringify(data), totals.main, who, new Date()]);
      try { if (typeof _ts2Audit_ === 'function') _ts2Audit_('OP_FORM_CREATE', 'Формы_ОП', no, null, { form: f.code, sum: totals.main }, f.title + ' № ' + n); } catch (e) {}
      return _ok_({ no: no, n: n, totals: totals, noPrice: rows.filter(function (r) { return r.noPrice; }).length, html: _tsOpHtml_(data) });
    });
  } catch (e) { return _failFrom_(e); }
}
function _tsOpLoad_(no) {
  var r = _tsOpRows_(TS_OP_SHEET_).filter(function (x) { return String(x['Номер']) === String(no); })[0];
  if (!r) return null; try { return JSON.parse(r['Данные'] || '{}'); } catch (e) { return null; }
}
/** Печатная форма сохранённого документа. */
function tsOpGet(token, no) {
  try { _requireAuth_(token); var d = _tsOpLoad_(no); if (!d) return _fail_('NOT_FOUND', 'Документ не найден'); return _ok_({ no: no, html: _tsOpHtml_(d) }); }
  catch (e) { return _failFrom_(e); }
}
/** PDF сохранённого документа в папку «Отчёты» на Диске клиента. */
function tsOpPdf(token, no) {
  try {
    _requireAuth_(token); var d = _tsOpLoad_(no); if (!d) return _fail_('NOT_FOUND', 'Документ не найден');
    var f = TS_OP_FORMS_[d.form], name = (f.code + ' ' + f.title + ' № ' + d.n + ' от ' + _tsOpRuDay_(d.params && d.params.date || '')).replace(/[\\\/:*?"<>|]+/g, ' ').slice(0, 150) + '.pdf';
    var html = '<html><head><meta charset="utf-8"></head><body>' + _tsOpHtml_(d) + '</body></html>';
    var pdf = Utilities.newBlob(html, 'text/html', 'op.html').getAs('application/pdf').setName(name);
    var file = _mcReportsFolder_().createFile(pdf);
    return _ok_({ url: file.getUrl(), name: name });
  } catch (e) { return _failFrom_(e); }
}

/* ------------------------------------------------------------------ сумма прописью */
function _tsOpWords_(n, fem) {
  var u = [['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'], ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']];
  var teen = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  var tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  var hund = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  var h = Math.floor(n / 100), t = Math.floor(n % 100 / 10), o = n % 10, w = [hund[h]];
  if (t === 1) w.push(teen[o]); else { w.push(tens[t]); w.push(u[fem ? 1 : 0][o]); }
  return w.filter(String).join(' ');
}
function _tsOpPlural_(n, f1, f2, f5) { n = Math.abs(n) % 100; var a = n % 10; if (n > 10 && n < 20) return f5; if (a > 1 && a < 5) return f2; if (a === 1) return f1; return f5; }
function _tsOpRubWords_(sum) {
  var v = _tsOpR2_(sum), rub = Math.floor(v), kop = Math.round((v - rub) * 100);
  var groups = [['', '', '', false], ['тысяча', 'тысячи', 'тысяч', true], ['миллион', 'миллиона', 'миллионов', false], ['миллиард', 'миллиарда', 'миллиардов', false]], parts = [], i = 0, x = rub;
  if (x === 0) parts.push('ноль');
  while (x > 0 && i < groups.length) { var g = x % 1000; if (g) { var w = _tsOpWords_(g, groups[i][3]); if (i) w += ' ' + _tsOpPlural_(g, groups[i][0], groups[i][1], groups[i][2]); parts.unshift(w); } x = Math.floor(x / 1000); i++; }
  var s = parts.join(' ').replace(/\s+/g, ' ').trim();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s + ' ' + _tsOpPlural_(rub, 'рубль', 'рубля', 'рублей') + ' ' + ('0' + kop).slice(-2) + ' ' + _tsOpPlural_(kop, 'копейка', 'копейки', 'копеек');
}

/* ------------------------------------------------------------------ печатная форма */
function _tsOpHtml_(d) {
  var f = TS_OP_FORMS_[d.form], E = _tsOpE_, p = d.params || {}, org = d.org || _tsOpOrg_(p.division), rows = d.rows || [], t = d.totals || _tsOpTotals_(f, rows);
  var cell = 'border:1px solid #000;padding:2px 4px;', small = 'font-size:8px;color:#333;text-align:center;border-top:1px solid #000;';
  var codes = '<table style="border-collapse:collapse;margin-left:auto;font-size:10px"><tr><td></td><td style="' + cell + 'text-align:center;width:90px">Код</td></tr>' +
    '<tr><td style="text-align:right;padding-right:6px">Форма по ОКУД</td><td style="' + cell + 'text-align:center;font-weight:bold">' + f.okud + '</td></tr>' +
    '<tr><td style="text-align:right;padding-right:6px">по ОКПО</td><td style="' + cell + 'text-align:center">' + E(org.okpo) + '</td></tr>' +
    '<tr><td style="text-align:right;padding-right:6px">Вид операции</td><td style="' + cell + '">&nbsp;</td></tr></table>';
  var head = '<div style="text-align:right;font-size:9px">Унифицированная форма № ' + f.code + '<br>Утверждена постановлением Госкомстата России<br>от 25.12.98 № 132</div>' +
    '<table style="width:100%;border-collapse:collapse;margin-top:6px"><tr><td style="vertical-align:bottom;font-size:11px">' +
    '<div style="border-bottom:1px solid #000;min-height:15px;font-weight:bold">' + E(org.line || 'наименование организации не заполнено — Настройки → Организация') + '</div><div style="' + small + 'border:0">организация</div>' +
    '<div style="border-bottom:1px solid #000;min-height:15px;margin-top:4px">' + E(org.division) + '</div><div style="' + small + 'border:0">структурное подразделение</div>' +
    '</td><td style="width:230px;vertical-align:top">' + codes + '</td></tr></table>';
  var approve = f.approve ? '<div style="margin:6px 0 0 auto;width:300px;font-size:11px"><b>УТВЕРЖДАЮ</b><br>' + E(org.directorPosition) +
    '<br>____________ ' + E(org.director || '____________________') + '<br>«____» ______________ 20___ г.</div>' : '';
  var title = '<table style="border-collapse:collapse;margin:10px auto 4px;font-size:11px"><tr><td rowspan="2" style="font:bold 14px Arial;padding-right:12px">' + E(f.title.toUpperCase()) + '</td>' +
    '<td style="' + cell + 'text-align:center">Номер документа</td><td style="' + cell + 'text-align:center">Дата составления</td></tr>' +
    '<tr><td style="' + cell + 'text-align:center;font-weight:bold">' + E(d.n) + '</td><td style="' + cell + 'text-align:center;font-weight:bold">' + E(_tsOpRuDay_(p.date || '')) + '</td></tr></table>';
  var extra = [];
  if (p.recipient) extra.push((f.source === 'sales' ? 'Получатель' : 'Получатель (подразделение)') + ': <b>' + E(p.recipient) + '</b>');
  if (f.source === 'op3list') extra.push('за период с <b>' + E(_tsOpRuDay_(p.from)) + '</b> по <b>' + E(_tsOpRuDay_(p.to)) + '</b>');
  if (f.source === 'balance') extra.push('Сдаёт: <b>' + E(p.from || '__________') + '</b> · Принимает: <b>' + E(p.to || '__________') + '</b>');
  if (f.source === 'staff' && p.dish) extra.push('Рацион (блюдо): <b>' + E(p.dish) + '</b>');
  var cols = f.cols, th = '<tr><th style="' + cell + 'width:24px">№</th>' + cols.map(function (c) { return '<th style="' + cell + 'font-weight:normal;font-size:9px">' + E(c[1]) + '</th>'; }).join('') + '</tr>' +
    '<tr><td style="' + cell + 'text-align:center;font-size:8px">1</td>' + cols.map(function (c, i) { return '<td style="' + cell + 'text-align:center;font-size:8px">' + (i + 2) + '</td>'; }).join('') + '</tr>';
  var body = rows.map(function (r, i) {
    return '<tr><td style="' + cell + 'text-align:center">' + (i + 1) + '</td>' + cols.map(function (c) {
      var v = r[c[0]], k = c[0], money = c[2] === 'money', num = c[2] === 'num';
      var txt = money ? (v === '' || v === undefined || (!(Number(v) > 0) && r.noPrice && /rice/.test(k)) ? (r.noPrice && /rice/.test(k) ? 'нет цены' : '') : _tsOpMoney_(v, /rice/.test(k))) : num ? _tsOpQty_(v) : (k === 'pct' && v !== '' ? String(v).replace('.', ',') : v);
      return '<td style="' + cell + (money || num || k === 'pct' ? 'text-align:right;' : '') + (txt === 'нет цены' ? 'color:#a33;' : '') + '">' + E(txt) + '</td>';
    }).join('') + '</tr>';
  }).join('');
  var sumCols = { sum: t.sum, saleSum: t.saleSum }, qtyTotal = f.source === 'sales' || f.source === 'staff';
  var tot = '<tr><td style="' + cell + '"></td>' + cols.map(function (c, i) {
    if (i === 0) return '<td style="' + cell + 'font-weight:bold">Итого</td>';
    if (c[0] in sumCols) return '<td style="' + cell + 'text-align:right;font-weight:bold">' + _tsOpMoney_(sumCols[c[0]]) + '</td>';
    if (c[0] === 'qty' && qtyTotal) return '<td style="' + cell + 'text-align:right;font-weight:bold">' + _tsOpQty_(t.qty) + '</td>';
    return '<td style="' + cell + '"></td>';
  }).join('') + '</tr>';
  var words = '<p style="font-size:11px;margin:8px 0">Итого на сумму: <b>' + E(_tsOpRubWords_(t.main)) + '</b>' + (f.source === 'sales' && t.sum ? ' (по учётным ценам — ' + E(_tsOpMoney_(t.sum)) + ' руб.)' : '') + '</p>';
  var np = rows.filter(function (r) { return r.noPrice; }).length;
  var warn = np ? '<p style="font-size:10px;color:#a33">Без цены строк: ' + np + '. Укажите цену в меню («Экономика → Цены меню») или приход на склад — тогда она подставится сама.</p>' : '';
  var signs = '<table style="width:100%;margin-top:18px;font-size:11px;border-collapse:collapse">' + f.signs.map(function (s, i) {
    return '<tr><td style="width:34%;padding:8px 6px 0 0">' + E(s) + '</td><td style="padding-top:8px"><div style="border-bottom:1px solid #000;min-height:14px"></div><div style="' + small + 'border:0">должность</div></td>' +
      '<td style="padding:8px 6px 0"><div style="border-bottom:1px solid #000;min-height:14px"></div><div style="' + small + 'border:0">подпись</div></td>' +
      '<td style="padding-top:8px"><div style="border-bottom:1px solid #000;min-height:14px"></div><div style="' + small + 'border:0">расшифровка подписи</div></td></tr>';
  }).join('') + '</table>';
  var foot = '<div style="margin-top:12px;font-size:8px;color:#666">Составил: ' + E(d.who || '') + ' · сформировано в ЦЕХ Стандарт</div>';
  return '<style>@page{size:A4 ' + (f.landscape ? 'landscape' : 'portrait') + ';margin:10mm}</style><div style="font:11px/1.35 Arial,sans-serif;color:#000;' + (f.landscape ? 'max-width:1060px' : 'max-width:760px') + '">' + head + approve + title +
    (extra.length ? '<div style="font-size:11px;margin:4px 0 6px">' + extra.join(' · ') + '</div>' : '') +
    '<table style="width:100%;border-collapse:collapse;font-size:10px">' + th + body + tot + '</table>' + words + warn + signs + foot + '</div>';
}
