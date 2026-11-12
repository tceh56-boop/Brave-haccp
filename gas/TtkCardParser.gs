// ЦЕХ — TtkCardParser.gs
// Разбор карты ТТК из таблицы ячеек (строки × колонки) в карту импорта — тот же формат,
// что даёт tools/ttk_archive/extract_ttk_archive.py, и те же правила (это перенос скрипта):
//   A — «Технологическая карта» с колонками брутто / нетто / вес готового / нетто на порцию или 1 кг;
//   B — короткая карта «Наименование ингредиента / Ед.изм. / Брутто» без выхода и технологии.
// Таблица ячеек приходит из файла Диска (TtkDriveCore.gs): XML-таблица FastReport (.xls архива)
// читается напрямую, Google Таблица — как есть, Excel/ODS/Word/PDF — после конвертации Диском.
// Здесь только данные карты и проверки их качества; этапы технологии, нормы и ККТ считает сервер.

var TTK_CARD_UNIT_DIM = { 'г': 'mass', 'гр': 'mass', 'кг': 'mass', 'мл': 'vol', 'л': 'vol', 'шт': 'pcs', 'порция': 'portion' };
// Метки шапки в одной ячейке с значением («Наименование блюда: Борщ») — так приходят Word/PDF.
var TTK_CARD_INLINE_LABEL = /^(Наименование блюда|Наименование изделия|Организация|Выход в готовом виде|Выход готового блюда|Основание производства)\s*:\s*(.+)$/i;

/** Целое для текста замечания: половина — к чётному (как «%.0f» в скрипте архива). */
function _tcR0_(x) { var f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); }

function _tcStr_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

function _tcNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v).trim().replace(',', '.');
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : null;
}

function _tcUnit_(u) {
  var s = String(u || '').trim().toLowerCase().replace(/\.+$/, '');
  return s === 'гр' ? 'г' : s;
}

/** «Соус тар-тар 90 гр» → 90; «Зельц 200 г» → 200. Только явные г/кг, без догадок по «60-10». */
function _tcGramsFromName_(name) {
  var m = /(\d+(?:[.,]\d+)?)\s*(кг|гр|г)(?![а-яё])/i.exec(String(name || ''));
  if (!m) return null;
  var v = Number(m[1].replace(',', '.'));
  return m[2].toLowerCase() === 'кг' ? v * 1000 : v;
}

/** «160/160/40 (2 шт)» → 360 г; «200 гр» → 200; «1 кг» → 1000. null, если не распознано. */
function _tcParseYield_(raw) {
  var s = String(raw || '').toLowerCase().replace(/,/g, '.').replace(/\(.*?\)/g, ' ');
  if (!s.trim()) return null;
  var kg = /(\d+(?:\.\d+)?)\s*кг/.exec(s);
  if (kg) return Number(kg[1]) * 1000;
  var src = s.indexOf('шт') !== -1 && s.indexOf('/') === -1 ? s.split('шт')[0] : s;
  var parts = src.match(/\d+(?:\.\d+)?/g);
  if (!parts) return null;
  return parts.reduce(function (a, p) { return a + Number(p); }, 0);
}

function _tcCells_(row) {
  var out = [];
  (row || []).forEach(function (v, i) { if (v !== null && v !== undefined && v !== '') out.push([i, v]); });
  return out;
}

/**
 * Таблица ячеек → карта импорта. grid — массив строк, строка — массив значений (число или
 * строка, пустые — null/''); sourcePath — путь файла от корня папки («Салаты/Цезарь.xls»).
 */
function parseTtkCardGrid_(grid, sourcePath) {
  var rows = (grid || []).map(function (r) {
    // «Метка: значение» в одной ячейке → две ячейки (как в таблице FastReport).
    var c = _tcCells_(r);
    if (c.length === 1 && typeof c[0][1] === 'string') {
      var m = TTK_CARD_INLINE_LABEL.exec(c[0][1].trim());
      if (m) { var x = (r || []).slice(); x[c[0][0]] = m[1] + ':'; x.splice(c[0][0] + 1, 0, m[2].trim()); return x; }
    }
    return r || [];
  });
  var path = String(sourcePath || '');
  var folders = path.split('/').slice(0, -1).filter(Boolean);
  var card = { source_path: path, category_path: folders, name: '', organization: '', yield_raw: '', yield_g: null, basis: '', production_basis: '', format: '', lines: [], totals: {}, technology: '', issues: [] };
  var headerIdx = null, cols = {};
  for (var i = 0; i < rows.length; i++) {
    var c = _tcCells_(rows[i]);
    if (!c.length) continue;
    var first = _tcStr_(c[0][1]), val = c.length > 1 ? _tcStr_(c[1][1]) : '';
    var lab = first.replace(/\s+/g, ' ');
    if (/^наименование (блюда|изделия):?$/i.test(lab)) card.name = val;
    else if (/^организация:?$/i.test(lab)) card.organization = val;
    else if (/^выход (в готовом виде|готового блюда):?$/i.test(lab)) card.yield_raw = val;
    else if (/^основание производства:?$/i.test(lab)) card.production_basis = val;
    else if (headerIdx === null && c.some(function (x) { return /брутто/i.test(String(x[1])); }) && c.some(function (x) { return String(x[1]).indexOf('Наименование') !== -1; })) {
      headerIdx = i;
      c.forEach(function (x) {
        var h = String(x[1]).toLowerCase(), j = x[0];
        if (h.indexOf('№') === 0) cols.no = j;
        else if (h.indexOf('наименование') !== -1) cols.name = j;
        else if (h.indexOf('ед') !== -1) cols.unit = j;
        else if (h.indexOf('брутто') !== -1) cols.brutto = j;
        else if (h.indexOf('готов') !== -1) cols.ready = j;
        else if (h.indexOf('нетто на') !== -1) cols.per_basis = j;
        else if (h.indexOf('нетто') !== -1) cols.netto = j;
      });
      card.format = cols.netto !== undefined ? 'A' : 'B';
    }
  }
  if (headerIdx === null) { card.issues.push('Не найдена таблица сырья'); return card; }
  var k = headerIdx + 1;
  if (k < rows.length) {
    var bc = _tcCells_(rows[k]);
    if (bc.length === 1 && /порц|кг/.test(String(bc[0][1]).toLowerCase())) { card.basis = _tcStr_(bc[0][1]); k++; }
  }
  var techMode = false, tech = [];
  var at = function (r, key) { return cols[key] !== undefined && cols[key] < r.length ? r[cols[key]] : null; };
  for (; k < rows.length; k++) {
    var r = rows[k], cc = _tcCells_(r);
    if (!cc.length) continue;
    var f = _tcStr_(cc[0][1]);
    if (f.indexOf('Технология приготовления') === 0) {
      techMode = true;
      var rest = f.indexOf(':') !== -1 ? f.slice(f.indexOf(':') + 1).trim() : '';
      if (rest) tech.push(rest);
      cc.slice(1).forEach(function (x) { tech.push(_tcStr_(x[1])); });
      continue;
    }
    if (techMode) {
      if (['Директор', 'Шеф-повар', 'Калькулятор'].indexOf(f) !== -1 || f.indexOf('Дата печати') === 0) break;
      cc.forEach(function (x) { tech.push(_tcStr_(x[1])); });
      continue;
    }
    var no = _tcNum_(at(r, 'no')), name = at(r, 'name');
    if (no !== null && name !== null && name !== '') {
      var unit = _tcUnit_(at(r, 'unit'));
      card.lines.push({ no: Math.trunc(no), name: _tcStr_(name), unit: unit, brutto: _tcNum_(at(r, 'brutto')), netto: _tcNum_(at(r, 'netto')),
        ready: _tcNum_(at(r, 'ready')), per_basis: _tcNum_(at(r, 'per_basis')),
        is_pf: /п\s*\/?\s*ф(?![а-яё])/.test(String(name).toLowerCase()),
        // единица «порция» — ссылка на другую ТТК (соус, гарнир, рулетики в ассорти)
        is_portion_ref: unit === 'порция', portion_g: unit === 'порция' ? _tcGramsFromName_(name) : null });
    } else if (no === null && card.lines.length && !card.totals.raw && cc.some(function (x) { return typeof x[1] === 'number'; })) {
      card.totals = { raw: cc.map(function (x) { return _tcNum_(x[1]); }) };
    }
  }
  card.technology = tech.filter(Boolean).join(' ').trim();
  card.yield_g = _tcParseYield_(card.yield_raw);
  card.yield_source = card.yield_g ? 'карта' : '';
  if (card.yield_g === null && _tcGramsFromName_(card.name)) { card.yield_g = _tcGramsFromName_(card.name); card.yield_source = 'название'; }
  if (card.yield_g === null && card.basis === '1 кг') {
    // «нетто на 1 кг» = нетто / выход (кг): выход = нетто / нетто_на_1кг; медиана по строкам
    var ratios = card.lines.filter(function (l) { return l.netto && l.per_basis && (l.unit === 'кг' || l.unit === 'л'); })
      .map(function (l) { return l.netto / l.per_basis * 1000; }).sort(function (a, b) { return a - b; });
    if (ratios.length) { card.yield_g = Math.round(ratios[Math.floor(ratios.length / 2)] * 10) / 10; card.yield_source = 'пересчёт «нетто на 1 кг»'; }
  }
  if (card.yield_g === null && card.basis === '1 порция') {
    var ready = card.lines.filter(function (l) { return ['кг', 'л', 'г', 'мл'].indexOf(l.unit) !== -1; })
      .reduce(function (s, l) { return s + (l.ready || 0) * (l.unit === 'кг' || l.unit === 'л' ? 1000 : 1); }, 0);
    if (ready > 0) { card.yield_g = Math.round(ready * 10) / 10; card.yield_source = 'сумма веса готового'; }
  }
  _tcCheck_(card);
  return card;
}

/** Только проверки качества данных карты; нормативные выводы делает сервер. */
function _tcCheck_(card) {
  var iss = card.issues, dims = {};
  if (!card.lines.length) iss.push('Нет строк сырья');
  if (!card.technology) iss.push('Нет текста технологии');
  if (card.format === 'B') iss.push('Короткий формат: нет нетто и выхода');
  else if (card.yield_g === null) iss.push('Выход не указан и не определяется косвенно');
  else if (card.yield_source !== 'карта') iss.push('Выход не указан в карте, взят из: ' + card.yield_source + ' (' + _tcR0_(card.yield_g) + ' г) — подтвердить');
  card.lines.forEach(function (l) {
    var d = TTK_CARD_UNIT_DIM[l.unit] || '?';
    (dims[d] = dims[d] || {})[l.unit] = true;
    if (l.brutto !== null && l.netto !== null && l.netto > l.brutto + 1e-9) iss.push('Нетто больше брутто: ' + l.name);
    if (l.is_portion_ref && !l.portion_g) iss.push('Вложенная ТТК без массы порции: ' + l.name);
    if (card.format === 'A' && !l.netto) iss.push('Нулевое нетто: ' + l.name);
    if (!TTK_CARD_UNIT_DIM.hasOwnProperty(l.unit)) iss.push('Неизвестная единица «' + l.unit + '»: ' + l.name);
  });
  Object.keys(dims).forEach(function (d) {
    var units = Object.keys(dims[d]).sort();
    if (units.length > 1) iss.push('Смешаны единицы ' + units.join('/') + ' в одной карте — итоговые суммы в карте некорректны');
  });
  if (card.format === 'A' && card.yield_g) {
    var mass = card.lines.filter(function (l) { return ['кг', 'л', 'г', 'мл'].indexOf(l.unit) !== -1; })
      .reduce(function (s, l) { return s + (l.netto || 0) * (l.unit === 'кг' || l.unit === 'л' ? 1000 : 1); }, 0);
    if (mass && card.yield_g > mass * 1.02) iss.push('Выход (' + _tcR0_(card.yield_g) + ' г) больше закладки нетто (' + _tcR0_(mass) + ' г) — нет компонента или ошибка единиц');
  }
  var names = card.lines.map(function (l) { return l.name.toLowerCase(); }), cnt = {};
  names.forEach(function (n) { cnt[n] = (cnt[n] || 0) + 1; });
  var dup = Object.keys(cnt).filter(function (n) { return cnt[n] > 1; }).sort();
  if (dup.length) iss.push('Повтор ингредиента: ' + dup.join(', '));
}

// ---------- XML-таблица FastReport (.xls архива ТТК) ----------

function _tcXmlText_(s) {
  return String(s || '').replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(Number(d)); })
    .replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** XML Spreadsheet 2003 (первый лист) → таблица ячеек с настоящими номерами колонок (ss:Index, MergeAcross). */
function ttkXmlSpreadsheetGrid_(xml) {
  var s = String(xml || ''), ws = /<Worksheet[\s\S]*?<\/Worksheet>/i.exec(s);
  if (ws) s = ws[0];
  var grid = [], rowNo = -1, re = /<Row\b([^>]*?)(\/>|>([\s\S]*?)<\/Row>)/gi, m;
  while ((m = re.exec(s)) !== null) {
    var ri = /ss:Index="(\d+)"/.exec(m[1]);
    rowNo = ri ? Number(ri[1]) - 1 : rowNo + 1;
    var row = [], col = -1, cre = /<Cell\b([^>]*?)(\/>|>([\s\S]*?)<\/Cell>)/gi, c;
    while ((c = cre.exec(m[3] || '')) !== null) {
      var ci = /ss:Index="(\d+)"/.exec(c[1]);
      col = ci ? Number(ci[1]) - 1 : col + 1;
      var d = /<(?:ss:)?Data\b([^>]*)>([\s\S]*?)<\/(?:ss:)?Data>/i.exec(c[3] || '');
      if (d) {
        var txt = _tcXmlText_(d[2]);
        row[col] = /Type="Number"/i.test(d[1]) && txt.trim() !== '' && isFinite(Number(txt)) ? Number(txt) : txt;
      }
      var across = /ss:MergeAcross="(\d+)"/.exec(c[1]);
      if (across) col += Number(across[1]);
    }
    for (var j = 0; j < row.length; j++) if (row[j] === undefined) row[j] = null;
    grid[rowNo] = row;
  }
  for (var k = 0; k < grid.length; k++) if (!grid[k]) grid[k] = [];
  return grid;
}
