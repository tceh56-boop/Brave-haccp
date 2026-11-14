// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
/**
 * ЦЕХ Стандарт V75 — «ЦЕХ Финансы и Экономика», этап 5: деньги (Cash Flow) и загрузка банковской выписки.
 *
 * Решения 14.11.2026: без кассовой интеграции; банковская выписка загружается файлом. Точка = предприятие.
 *
 * Первичные записи:
 *  • ДС_Счета — касса и расчётные счета: начальный остаток на дату;
 *  • ДС_Движения — одно движение денег — одна запись: поступление или выплата, сумма, статья ДДС, контрагент, ИНН,
 *    назначение, документ. Источник — ввод вручную или строка выписки. Ключ содержания (ExtKey) не даёт загрузить
 *    ту же операцию дважды (повторная загрузка той же или пересекающейся выписки добавляет только новые строки);
 *  • ДС_Импорт — каждая загрузка выписки: файл, период, сколько добавлено, сколько повторов, сверка остатков из выписки;
 *  • ДС_Правила — правила разнесения по статьям (ИНН или текст назначения → статья), из «запомнить» при разнесении.
 *
 * Разнесение при загрузке: ИНН поставщика из справочника → «Оплата поставщикам продуктов»; правила; типовые слова
 * (эквайринг, комиссия банка, аренда, зарплата, налоги, инкассация); иначе «Не разнесено» — с сигналом, не наугад.
 * Перевод между своими счетами (инкассация) в поступления и выплаты не входит.
 *
 * Отчёт: остаток на начало, поступления и выплаты по статьям (операционная, инвестиционная, финансовая деятельность),
 * остаток на конец по каждому счёту, сверка с остатком из выписки, выручка по продажам против поступлений выручки,
 * долги поставщикам (накладные приёмки − оплаты, по давности). Движения идут в журнал V64 (этап «Деньги»),
 * оттуда — в реестр операций и дневные итоги. Записи в закрытом финансовом периоде не принимаются.
 * Управленческий учёт денег, бухгалтерию не заменяет.
 */
var MC_V75 = {
  ACC: ['ДС_Счета', ['AccountID', 'Name', 'Type', 'BankAccount', 'OpeningBalance', 'OpeningDate', 'Status', 'CreatedAt', 'CreatedBy', 'OperationID']],
  MOVE: ['ДС_Движения', ['MoveID', 'AccountID', 'Date', 'Direction', 'Amount', 'Category', 'Counterparty', 'CounterpartyINN', 'Purpose', 'DocNo', 'Source', 'ImportID', 'ExtKey',
    'TransferID', 'Status', 'CreatedAt', 'CreatedBy', 'CancelReason', 'OperationID']],
  IMP: ['ДС_Импорт', ['ImportID', 'AccountID', 'FileName', 'Format', 'PeriodFrom', 'PeriodTo', 'Lines', 'Added', 'Duplicates', 'ClosedSkipped', 'Errors', 'Uncategorized',
    'StatementOpening', 'StatementClosing', 'At', 'By', 'OperationID']],
  RULE: ['ДС_Правила', ['RuleID', 'MatchType', 'Match', 'Category', 'Status', 'CreatedAt', 'CreatedBy']]
};
var MC_V75_UNCAT = 'Не разнесено', MC_V75_TRANSFER = 'Перевод между счетами', MC_V75_SUPPLIER = 'Оплата поставщикам продуктов';
var MC_V75_ACT_RU = { OPER: 'Операционная деятельность', INV: 'Инвестиционная деятельность', FIN: 'Финансовая деятельность', TRANSFER: 'Переводы между своими счетами', NONE: 'Не разнесено' };
/** Статьи ДДС: activity — вид деятельности, dir — для каких движений (пусто — для любых). */
var MC_V75_CATS = [
  { c: 'Выручка: наличные', a: 'OPER', d: 'IN' }, { c: 'Выручка: эквайринг (карты)', a: 'OPER', d: 'IN' }, { c: 'Выручка: безнал, банкеты и договоры', a: 'OPER', d: 'IN' },
  { c: 'Возврат от поставщиков', a: 'OPER', d: 'IN' }, { c: 'Прочие поступления', a: 'OPER', d: 'IN' },
  { c: MC_V75_SUPPLIER, a: 'OPER', d: 'OUT' }, { c: 'ФОТ: выплаты сотрудникам', a: 'OPER', d: 'OUT' }, { c: 'Налоги и взносы', a: 'OPER', d: 'OUT' }
].concat(MC_V64_EXP_CATS.filter(function (c) { return c !== 'Фонд оплаты труда' && c !== 'Амортизация оборудования'; }).map(function (c) { return { c: c, a: 'OPER', d: 'OUT' }; })).concat([
  { c: 'Покупка оборудования', a: 'INV', d: 'OUT' }, { c: 'Займы и кредиты: получение', a: 'FIN', d: 'IN' }, { c: 'Займы и кредиты: возврат и проценты', a: 'FIN', d: 'OUT' },
  { c: 'Собственник: взнос', a: 'FIN', d: 'IN' }, { c: 'Собственник: выплата', a: 'FIN', d: 'OUT' },
  { c: MC_V75_TRANSFER, a: 'TRANSFER', d: '' }, { c: MC_V75_UNCAT, a: 'NONE', d: '' }]);
/** Типовые слова назначения платежа → статья (порядок важен). */
var MC_V75_HINTS = [
  [/инкассац|взнос наличн|внесение наличн|перевод собственных|перевод между счет|перевод со сч/i, '', MC_V75_TRANSFER],
  [/эквайр|возмещение по операциям|по операциям с (банковскими|платежными) картами|зачисление средств по операциям/i, 'IN', 'Выручка: эквайринг (карты)'],
  [/комисси|обслуживание сч|плата за (ведение|обслуживание)/i, 'OUT', 'Банковская комиссия'],
  [/аренд/i, 'OUT', 'Аренда'],
  [/заработн|зарплат|аванс по|отпускн|расчет при увольнен|расчёт при увольнен/i, 'OUT', 'ФОТ: выплаты сотрудникам'],
  [/ндфл|страховые взнос|единый налоговый|енп|налог |казначейств|уфк по/i, 'OUT', 'Налоги и взносы'],
  [/электроэнерг|водоснабж|теплоснаб|коммунальн|газоснаб|вывоз (тко|мусора)/i, 'OUT', 'Коммунальные услуги'],
  [/возврат.*поставщик|возврат излишне|возврат денежных средств/i, 'IN', 'Возврат от поставщиков']
];

/* ---------------- служебное ---------------- */
function _v75Sh_(k) { return _v64Sheet_(MC_V75[k][0], MC_V75[k][1]); }
function _v75Row_(k, o) { return MC_V75[k][1].map(function (c) { return o[c] === undefined || o[c] === null ? '' : o[c]; }); }
function _v75Append_(k, o) { _v75Sh_(k).appendRow(_v75Row_(k, o)); _V64_TAB_ = {}; }
function _v75Find_(k, id) {
  var sh = _v75Sh_(k), h = MC_V75[k][1], v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) { var o = {}; h.forEach(function (c, j) { o[c] = v[i][j]; }); return { sh: sh, row: i + 1, o: o, h: h }; }
  return null;
}
function _v75Set_(f, o) { Object.keys(o).forEach(function (c) { var j = f.h.indexOf(c); if (j >= 0) f.sh.getRange(f.row, j + 1).setValue(o[c]); }); _V64_TAB_ = {}; }
function _v75Norm_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'`]/g, '').replace(/\s+/g, ' ').trim(); }
function _v75Inn_(s) { var x = String(s || '').replace(/\D/g, ''); return x.length === 10 || x.length === 12 ? x : ''; }
function _v75Day_(x) {
  if (!x && x !== 0) return null;
  var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(x).trim());
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  var d = _v64Date_(x); return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null;
}
function _v75Amt_(x) { var n = Number(String(x === undefined || x === null ? '' : x).replace(/\s| /g, '').replace(',', '.')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; }
function _v75Cat_(c) { for (var i = 0; i < MC_V75_CATS.length; i++) if (MC_V75_CATS[i].c === c) return MC_V75_CATS[i]; return null; }
function _v75Closed_(d) { var p = null; try { p = _v64ClosedPeriodOf_(d); } catch (e) {} return p ? 'Дата ' + _v64Day_(d) + ' в закрытом финансовом периоде ' + (p.id || '') : ''; }
function _v75Key_(acc, day, dir, amount, doc, inn, purpose) {
  return _v72Hash_([String(acc), _v64Day_(day), dir, Number(amount).toFixed(2), String(doc || '').trim(), String(inn || ''), _v75Norm_(purpose).replace(/[^0-9a-zа-я]/g, '').slice(0, 120)]);
}
function _v75Accounts_() {
  var t = _v64Tab_(MC_V75.ACC[0]); if (!t.exists) return [];
  return t.rows.map(function (r) { return { id: String(_v64G_(t, r, 'AccountID')), name: String(_v64G_(t, r, 'Name')), type: String(_v64G_(t, r, 'Type', 'BANK')), bankAccount: String(_v64G_(t, r, 'BankAccount')).replace(/\D/g, ''),
    opening: _v64Num_(_v64G_(t, r, 'OpeningBalance')), openingDate: _v75Day_(_v64G_(t, r, 'OpeningDate')), status: String(_v64G_(t, r, 'Status', 'ACTIVE')) }; }).filter(function (a) { return a.id && a.status === 'ACTIVE'; });
}
function _v75Moves_() {
  var t = _v64Tab_(MC_V75.MOVE[0]); if (!t.exists) return [];
  return t.rows.map(function (r) { return { id: String(_v64G_(t, r, 'MoveID')), account: String(_v64G_(t, r, 'AccountID')), date: _v75Day_(_v64G_(t, r, 'Date')), dir: String(_v64G_(t, r, 'Direction')),
    amount: _v64Num_(_v64G_(t, r, 'Amount')), category: String(_v64G_(t, r, 'Category', MC_V75_UNCAT)), counterparty: String(_v64G_(t, r, 'Counterparty')), inn: String(_v64G_(t, r, 'CounterpartyINN')),
    purpose: String(_v64G_(t, r, 'Purpose')), doc: String(_v64G_(t, r, 'DocNo')), source: String(_v64G_(t, r, 'Source')), importId: String(_v64G_(t, r, 'ImportID')), key: String(_v64G_(t, r, 'ExtKey')),
    transfer: String(_v64G_(t, r, 'TransferID')), status: String(_v64G_(t, r, 'Status', 'ACTIVE')) }; }).filter(function (m) { return m.id; });
}
function _v75Rules_() {
  var t = _v64Tab_(MC_V75.RULE[0]); if (!t.exists) return [];
  return t.rows.map(function (r) { return { id: String(_v64G_(t, r, 'RuleID')), type: String(_v64G_(t, r, 'MatchType')), match: String(_v64G_(t, r, 'Match')), category: String(_v64G_(t, r, 'Category')),
    status: String(_v64G_(t, r, 'Status', 'ACTIVE')) }; }).filter(function (x) { return x.status === 'ACTIVE' && x.match; });
}
/** Справочник поставщиков: ИНН → название, нормализованное название → название. */
function _v75Suppliers_() {
  var byInn = {}, byName = {};
  try { (typeof _mdSuppliers_ === 'function' ? _mdSuppliers_() : []).forEach(function (s) { var n = String(s.name || ''); if (s.inn) byInn[String(s.inn).replace(/\D/g, '')] = n; byName[_v75Norm_(n)] = n; }); } catch (e) {}
  return { byInn: byInn, byName: byName };
}
/** Статья для движения: правило по ИНН → поставщик из справочника → правило по тексту → типовые слова → «Не разнесено». */
function _v75Guess_(m, rules, sup) {
  var inn = _v75Inn_(m.inn), text = _v75Norm_(m.counterparty + ' ' + m.purpose), ok = function (c) { var x = _v75Cat_(c); return x && (!x.d || x.d === m.dir) ? c : ''; };
  for (var i = 0; i < rules.length; i++) if (rules[i].type === 'INN' && inn && rules[i].match === inn && ok(rules[i].category)) return { category: rules[i].category, by: 'правило ' + rules[i].id };
  if (inn && sup.byInn[inn] && m.dir === 'OUT') return { category: MC_V75_SUPPLIER, by: 'поставщик из справочника' };
  for (var j = 0; j < rules.length; j++) if (rules[j].type === 'TEXT' && text.indexOf(_v75Norm_(rules[j].match)) >= 0 && ok(rules[j].category)) return { category: rules[j].category, by: 'правило ' + rules[j].id };
  for (var k = 0; k < MC_V75_HINTS.length; k++) { var h = MC_V75_HINTS[k]; if ((!h[1] || h[1] === m.dir) && h[0].test(m.purpose + ' ' + m.counterparty)) return { category: h[2], by: 'по назначению платежа' }; }
  if (m.dir === 'OUT' && sup.byName[_v75Norm_(m.counterparty)]) return { category: MC_V75_SUPPLIER, by: 'поставщик из справочника' };
  return { category: MC_V75_UNCAT, by: '' };
}

/* ---------------- разбор выписки ---------------- */
/** Формат обмена «1С: Предприятие — Клиент банка» (1CClientBankExchange). */
function _v75Parse1C_(text) {
  var lines = String(text).split(/\r?\n/), acc = '', head = {}, docs = [], cur = null, sec = null;
  lines.forEach(function (ln) {
    ln = ln.replace(/^﻿/, ''); var i = ln.indexOf('='), k = i > 0 ? ln.slice(0, i).trim() : ln.trim(), v = i > 0 ? ln.slice(i + 1).trim() : '';
    if (k === 'СекцияРасчСчет') { sec = {}; return; }
    if (k === 'КонецРасчСчет') { if (sec) { head = sec; if (sec['РасчСчет']) acc = sec['РасчСчет']; } sec = null; return; }
    if (k === 'СекцияДокумент') { cur = { _kind: v }; return; }
    if (k === 'КонецДокумента') { if (cur) docs.push(cur); cur = null; return; }
    if (cur) cur[k] = v; else if (sec) sec[k] = v; else if (k === 'РасчСчет' && !acc) acc = v; else if (k === 'ДатаНачала' || k === 'ДатаКонца') head[k] = head[k] || v;
  });
  acc = String(acc).replace(/\D/g, '');
  var rows = docs.map(function (d) {
    var pa = String(d['ПлательщикСчет'] || d['ПлательщикРасчСчет'] || '').replace(/\D/g, ''), ra = String(d['ПолучательСчет'] || d['ПолучательРасчСчет'] || '').replace(/\D/g, '');
    var dir = acc && ra === acc ? 'IN' : acc && pa === acc ? 'OUT' : d['ДатаПоступило'] ? 'IN' : 'OUT';
    var who = dir === 'IN' ? (d['Плательщик1'] || d['Плательщик'] || '') : (d['Получатель1'] || d['Получатель'] || '');
    return { date: _v75Day_(dir === 'IN' ? (d['ДатаПоступило'] || d['Дата']) : (d['ДатаСписано'] || d['Дата'])), dir: dir, amount: _v75Amt_(d['Сумма']),
      counterparty: String(who).replace(/^ИНН\s*\d+\s*/i, '').trim(), inn: _v75Inn_(dir === 'IN' ? d['ПлательщикИНН'] : d['ПолучательИНН']), purpose: d['НазначениеПлатежа'] || '',
      doc: d['Номер'] || '', kind: d._kind || '' };
  });
  return { format: '1C', account: acc, from: _v75Day_(head['ДатаНачала']), to: _v75Day_(head['ДатаКонца']),
    opening: head['НачальныйОстаток'] !== undefined ? _v75Amt_(head['НачальныйОстаток']) : null, closing: head['КонечныйОстаток'] !== undefined ? _v75Amt_(head['КонечныйОстаток']) : null, rows: rows };
}
function _v75CsvSplit_(line, sep) {
  var out = [], cur = '', q = false;
  for (var i = 0; i < line.length; i++) { var ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur); return out.map(function (x) { return x.trim(); });
}
/** Таблица CSV из интернет-банка: Дата; Сумма (со знаком) или Приход/Расход; Контрагент; ИНН; Назначение; Номер. */
function _v75ParseCsv_(text) {
  var lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (lines.length < 2) throw new Error('В файле нет строк с операциями');
  var h0 = lines[0], sep = [';', '\t', ','].sort(function (a, b) { return h0.split(b).length - h0.split(a).length; })[0];
  var H = _v75CsvSplit_(h0, sep).map(_v75Norm_), col = function (re, not) { for (var i = 0; i < H.length; i++) if (re.test(H[i]) && !(not && not.test(H[i]))) return i; return -1; };
  var c = { date: col(/дата/), sum: col(/^сумма/, /приход|расход|поступ|списан|дебет|кредит/), inn: col(/инн/), inc: col(/приход|поступ|кредит/), out: col(/расход|списан|дебет/),
    who: col(/контрагент|плательщик|получатель|наименование|корреспондент/, /инн|сч[её]т/), purpose: col(/назначение|описание|комментарий|основание/), doc: col(/номер|^№|документ/), dir: col(/направлен|^тип|вид операции/) };
  if (c.date < 0 || (c.sum < 0 && c.inc < 0 && c.out < 0)) throw new Error('Не нашёл колонки «Дата» и «Сумма» (или «Приход» / «Расход») в первой строке файла');
  var rows = [], errors = [];
  lines.slice(1).forEach(function (l, n) {
    var x = _v75CsvSplit_(l, sep), g = function (i) { return i >= 0 ? (x[i] || '') : ''; }, dir = '', amt = NaN;
    if (c.inc >= 0 && _v75Amt_(g(c.inc))) { dir = 'IN'; amt = Math.abs(_v75Amt_(g(c.inc))); }
    else if (c.out >= 0 && _v75Amt_(g(c.out))) { dir = 'OUT'; amt = Math.abs(_v75Amt_(g(c.out))); }
    else if (c.sum >= 0) { var s = _v75Amt_(g(c.sum)); if (isFinite(s)) { amt = Math.abs(s); dir = s < 0 ? 'OUT' : 'IN';
      if (c.dir >= 0) { var dv = _v75Norm_(g(c.dir)); if (/расход|списан|дебет|out/.test(dv)) dir = 'OUT'; else if (/приход|поступ|кредит|in/.test(dv)) dir = 'IN'; } } }
    var d = _v75Day_(g(c.date));
    if (!d || !(amt > 0)) { errors.push('строка ' + (n + 2) + ': нет даты или суммы'); return; }
    rows.push({ date: d, dir: dir, amount: amt, counterparty: g(c.who), inn: _v75Inn_(g(c.inn)), purpose: g(c.purpose), doc: g(c.doc), kind: '' });
  });
  var ds = rows.map(function (r) { return r.date.getTime(); });
  return { format: 'CSV', account: '', from: ds.length ? new Date(Math.min.apply(null, ds)) : null, to: ds.length ? new Date(Math.max.apply(null, ds)) : null, opening: null, closing: null, rows: rows, errors: errors };
}
function _v75Parse_(text) { return /1CClientBankExchange/.test(String(text).slice(0, 500)) ? _v75Parse1C_(text) : _v75ParseCsv_(text); }

/* ---------------- журнал V64 и итоги ---------------- */
/** Строки этапа «Деньги» (вызывается из _v64Build_): действующие движения. */
function _v75CashLines_(push) {
  _v75Moves_().forEach(function (m) {
    if (m.status !== 'ACTIVE' || !m.date) return;
    push({ date: m.date, stage: 'CASH', dir: m.dir, objType: 'CASH_MOVE', objId: m.id, product: m.category, qty: '', unit: '', price: '', amount: _v64R2_(m.amount), source: MC_V75.MOVE[0],
      ref: m.doc || m.id, trace: 'NOT_APPLICABLE', flags: m.category === MC_V75_UNCAT ? ['UNCATEGORIZED'] : [], transfer: m.category === MC_V75_TRANSFER,
      note: (m.dir === 'IN' ? 'поступление' : 'выплата') + (m.counterparty ? ' · ' + m.counterparty : '') + (m.purpose ? ' · ' + m.purpose : '') });
  });
}
function _v75Balance_(acc, moves, beforeDay) {
  var b = acc.opening;
  moves.forEach(function (m) { if (m.account !== acc.id || m.status !== 'ACTIVE' || !m.date) return; if (acc.openingDate && m.date < acc.openingDate) return; if (m.date >= beforeDay) return; b += m.dir === 'IN' ? m.amount : -m.amount; });
  return _v64R2_(b);
}
/** Накладные приёмки и оплаты → долги поставщикам на дату (оплаты гасят самые старые накладные). */
function _v75Payables_(asOf, moves) {
  var t = _v64Tab_('Приёмка_Партии'), sup = _v75Suppliers_(), S = {}, key = function (name, inn) {
    var n = inn && sup.byInn[inn] ? sup.byInn[inn] : (sup.byName[_v75Norm_(name)] || String(name || '').trim()); return { k: _v75Norm_(n), name: n }; };
  if (t.exists) t.rows.forEach(function (r) {
    var name = String(_v64G_(t, r, 'Поставщик')), inv = String(_v64G_(t, r, ['Накладная', 'DocumentID накладной'])) || String(_v64G_(t, r, 'BatchID'));
    var d = _v75Day_(_v64G_(t, r, 'Дата накладной')); if (!name || !d || d > asOf) return;
    var a = _v64Num_(_v64G_(t, r, 'Стоимость')) || _v64Num_(_v64G_(t, r, 'Цена за ед.')) * _v64Num_(_v64G_(t, r, 'Кол-во'));
    var s = key(name, ''), x = S[s.k] || (S[s.k] = { supplier: s.name, invoices: {}, paid: 0, refunds: 0 });
    var iv = x.invoices[inv] || (x.invoices[inv] = { invoice: inv, date: d, amount: 0 }); iv.amount += a; if (d < iv.date) iv.date = d;
  });
  moves.forEach(function (m) {
    if (m.status !== 'ACTIVE' || !m.date || m.date > asOf) return;
    var pay = m.dir === 'OUT' && m.category === MC_V75_SUPPLIER, ref = m.dir === 'IN' && m.category === 'Возврат от поставщиков';
    if (!pay && !ref) return;
    var s = key(m.counterparty, _v75Inn_(m.inn)), x = S[s.k] || (S[s.k] = { supplier: s.name, invoices: {}, paid: 0, refunds: 0 });
    if (pay) x.paid += m.amount; else x.refunds += m.amount;
  });
  var out = Object.keys(S).map(function (k) {
    var x = S[k], inv = Object.keys(x.invoices).map(function (i) { return x.invoices[i]; }).sort(function (a, b) { return a.date - b.date; });
    var invoiced = inv.reduce(function (a, i) { return a + i.amount; }, 0), left = x.paid - x.refunds, unpaid = [];
    inv.forEach(function (i) { var cover = Math.min(Math.max(left, 0), i.amount); left -= cover; if (i.amount - cover > 0.009) unpaid.push({ invoice: i.invoice, date: _v64Day_(i.date), rest: _v64R2_(i.amount - cover), days: Math.round((asOf - i.date) / 86400000) }); });
    var debt = _v64R2_(invoiced - x.paid + x.refunds);
    return { supplier: x.supplier, invoiced: _v64R2_(invoiced), paid: _v64R2_(x.paid), refunds: _v64R2_(x.refunds), debt: debt, prepaid: debt < 0 ? -debt : 0, invoices: inv.length, unpaid: unpaid,
      oldestDays: unpaid.length ? unpaid[0].days : 0, oldestDate: unpaid.length ? unpaid[0].date : '' };
  }).filter(function (x) { return Math.abs(x.debt) >= 0.01 || x.invoices; }).sort(function (a, b) { return b.debt - a.debt; });
  return out;
}
/** Кратко для сводки руководителя: остаток денег на конец дня toIso, не разнесено, долги поставщикам. */
function _v75Brief_(toIso) {
  var accs = _v75Accounts_(); if (!accs.length) return null;
  var moves = _v75Moves_(), to = _v75Day_(toIso), next = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
  var bal = accs.map(function (a) { return { name: a.name, balance: _v75Balance_(a, moves, next) }; }), pay = _v75Payables_(to, moves);
  return { balance: _v64R2_(bal.reduce(function (s, a) { return s + a.balance; }, 0)), negative: bal.filter(function (a) { return a.balance < 0; }),
    uncategorized: moves.filter(function (m) { return m.status === 'ACTIVE' && m.category === MC_V75_UNCAT; }).length,
    debt: _v64R2_(pay.reduce(function (s, p) { return s + Math.max(p.debt, 0); }, 0)), overdue30: pay.filter(function (p) { return p.oldestDays > 30; }) };
}

/* ---------------- чтение ---------------- */
/** Деньги за период: счета, Cash Flow по статьям, по дням, движения, неразнесённые, долги поставщикам, загрузки. */
function v75GetCash(token, fromDate, toDate) {
  try {
    _requireAuth_(token, 'finance_view');
    _v64Drop_();
    var rg = _v64Range_(fromDate, toDate), from = _v75Day_(rg.fromIso), to = _v75Day_(rg.toIso), next = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
    var accs = _v75Accounts_(), moves = _v75Moves_(), inP = function (m) { return m.status === 'ACTIVE' && m.date && m.date >= from && m.date <= to; };
    var accounts = accs.map(function (a) {
      var o = _v75Balance_(a, moves, from), c = _v75Balance_(a, moves, next), mv = moves.filter(function (m) { return m.account === a.id && inP(m); });
      return { id: a.id, name: a.name, type: a.type, typeRu: a.type === 'CASH' ? 'касса' : 'банк', bankAccount: a.bankAccount, opening: o,
        inflow: _v64R2_(mv.filter(function (m) { return m.dir === 'IN'; }).reduce(function (s, m) { return s + m.amount; }, 0)),
        outflow: _v64R2_(mv.filter(function (m) { return m.dir === 'OUT'; }).reduce(function (s, m) { return s + m.amount; }, 0)), closing: c };
    });
    var flow = {}, P = moves.filter(inP);
    P.forEach(function (m) {
      var c = _v75Cat_(m.category) || { c: m.category, a: 'NONE' }, k = c.a + '|' + c.c, x = flow[k] || (flow[k] = { activity: c.a, activityRu: MC_V75_ACT_RU[c.a] || c.a, category: c.c, inflow: 0, outflow: 0, count: 0 });
      if (m.dir === 'IN') x.inflow += m.amount; else x.outflow += m.amount; x.count++;
    });
    var order = ['OPER', 'INV', 'FIN', 'NONE', 'TRANSFER'];
    var flowRows = Object.keys(flow).map(function (k) { var x = flow[k]; x.inflow = _v64R2_(x.inflow); x.outflow = _v64R2_(x.outflow); x.net = _v64R2_(x.inflow - x.outflow); return x; })
      .sort(function (a, b) { return order.indexOf(a.activity) - order.indexOf(b.activity) || b.inflow - a.inflow || b.outflow - a.outflow; });
    var act = {}; order.forEach(function (a) { act[a] = { activity: a, activityRu: MC_V75_ACT_RU[a], inflow: 0, outflow: 0, net: 0 }; });
    flowRows.forEach(function (x) { var y = act[x.activity] || act.NONE; y.inflow += x.inflow; y.outflow += x.outflow; y.net += x.net; });
    var activities = order.map(function (a) { var y = act[a]; y.inflow = _v64R2_(y.inflow); y.outflow = _v64R2_(y.outflow); y.net = _v64R2_(y.net); return y; }).filter(function (y) { return y.inflow || y.outflow; });
    var real = P.filter(function (m) { return m.category !== MC_V75_TRANSFER; });
    var totals = { opening: _v64R2_(accounts.reduce(function (s, a) { return s + a.opening; }, 0)), closing: _v64R2_(accounts.reduce(function (s, a) { return s + a.closing; }, 0)),
      inflow: _v64R2_(real.filter(function (m) { return m.dir === 'IN'; }).reduce(function (s, m) { return s + m.amount; }, 0)),
      outflow: _v64R2_(real.filter(function (m) { return m.dir === 'OUT'; }).reduce(function (s, m) { return s + m.amount; }, 0)),
      uncategorized: P.filter(function (m) { return m.category === MC_V75_UNCAT; }).length };
    totals.net = _v64R2_(totals.inflow - totals.outflow);
    var byDay = {}; real.forEach(function (m) { var d = _v64Day_(m.date), x = byDay[d] || (byDay[d] = { day: d, inflow: 0, outflow: 0 }); if (m.dir === 'IN') x.inflow += m.amount; else x.outflow += m.amount; });
    var days = Object.keys(byDay).sort().map(function (d) { var x = byDay[d]; x.inflow = _v64R2_(x.inflow); x.outflow = _v64R2_(x.outflow); x.net = _v64R2_(x.inflow - x.outflow); return x; });
    var accName = {}; accs.forEach(function (a) { accName[a.id] = a.name; });
    var list = P.slice().sort(function (a, b) { return b.date - a.date; }).slice(0, 1000).map(function (m) { return { id: m.id, date: _v64Day_(m.date), account: accName[m.account] || m.account, dir: m.dir,
      dirRu: m.dir === 'IN' ? 'поступление' : 'выплата', amount: m.amount, category: m.category, counterparty: m.counterparty, inn: m.inn, purpose: m.purpose, doc: m.doc, source: m.source === 'BANK_IMPORT' ? 'выписка' : 'вручную' }; });
    // выручка по продажам (P&L) против поступлений выручки — расхождение = долги покупателей, неинкассированная касса или ошибка ввода
    var rev = null; try { rev = _v72Sum_(rg.fromIso, rg.toIso).totals.revenue; } catch (e) {}
    var cashRev = _v64R2_(real.filter(function (m) { return m.dir === 'IN' && /^Выручка/.test(m.category); }).reduce(function (s, m) { return s + m.amount; }, 0));
    var pay = _v75Payables_(to, moves), imps = _v64Tab_(MC_V75.IMP[0]);
    var imports = imps.exists ? imps.rows.map(function (r) { var o = {}; MC_V75.IMP[1].forEach(function (c) { o[c] = _v64G_(imps, r, c); }); o.At = o.At ? String(o.At) : ''; o.PeriodFrom = o.PeriodFrom ? _v64Day_(_v64Date_(o.PeriodFrom)) : ''; o.PeriodTo = o.PeriodTo ? _v64Day_(_v64Date_(o.PeriodTo)) : ''; return o; }).reverse().slice(0, 50) : [];
    var warnings = [];
    if (!accs.length) warnings.push({ level: 'gold', code: 'NO_ACCOUNTS', text: 'Нет счетов: заведите кассу и расчётный счёт с остатком на дату или загрузите выписку — счёт заведётся сам.' });
    if (totals.uncategorized) warnings.push({ level: 'gold', code: 'UNCATEGORIZED', text: 'Не разнесено по статьям: ' + totals.uncategorized + ' — разнесите, иначе Cash Flow по статьям неполный.' });
    accounts.filter(function (a) { return a.closing < 0; }).forEach(function (a) { warnings.push({ level: 'red', code: 'NEGATIVE', text: 'Отрицательный остаток «' + a.name + '»: ' + a.closing + ' ₽ — не внесены поступления или неверный начальный остаток.' }); });
    pay.filter(function (p) { return p.oldestDays > 30; }).forEach(function (p) { warnings.push({ level: 'gold', code: 'DEBT_OLD', text: 'Долг поставщику «' + p.supplier + '» ' + p.debt + ' ₽, самая старая неоплаченная накладная — ' + p.oldestDays + ' дн.' }); });
    return _ok_({ from: rg.fromIso, to: rg.toIso, accounts: accounts, totals: totals, activities: activities, flow: flowRows, byDay: days, moves: list,
      uncategorized: list.filter(function (m) { return m.category === MC_V75_UNCAT; }), payables: pay, imports: imports, rules: _v75Rules_(),
      revenueVsCash: { revenue: rev, cashRevenue: cashRev, diff: rev === null ? null : _v64R2_(rev - cashRev) }, warnings: warnings,
      categories: MC_V75_CATS.map(function (c) { return { category: c.c, activity: c.a, dir: c.d }; }),
      note: 'Управленческий учёт денег: поступления и выплаты по статьям. Переводы между своими счетами не входят в поступления и выплаты.' });
  } catch (e) { return _failFrom_(e); }
}

/* ---------------- запись ---------------- */
/** Счёт: касса или расчётный счёт. json: {name, type: CASH|BANK, bankAccount, openingBalance, openingDate}. */
function v75SaveAccount(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V75_ACCOUNT', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), type = String(d.type || 'BANK').toUpperCase(), name = String(d.name || '').trim(), no = String(d.bankAccount || '').replace(/\D/g, ''), ob = _v75Amt_(d.openingBalance || 0), od = _v75Day_(d.openingDate);
    if (!name) return _v64Fail_(op, 'VALIDATION', 'Укажите название счёта');
    if (type !== 'CASH' && type !== 'BANK') return _v64Fail_(op, 'VALIDATION', 'Вид счёта: CASH (касса) или BANK (банк)');
    if (type === 'BANK' && no && no.length !== 20) return _v64Fail_(op, 'VALIDATION', 'Номер расчётного счёта — 20 цифр');
    if (!isFinite(ob)) return _v64Fail_(op, 'VALIDATION', 'Начальный остаток — число');
    if (!od) return _v64Fail_(op, 'VALIDATION', 'Укажите дату начального остатка');
    return _withLock_(function () {
      _V64_TAB_ = {};
      var dup = _v75Accounts_().filter(function (a) { return (no && a.bankAccount === no) || _v75Norm_(a.name) === _v75Norm_(name); })[0];
      if (dup) return _v64Fail_(op, 'DUPLICATE', 'Такой счёт уже есть: ' + dup.name);
      var id = _v64Id_('ACC');
      _v75Append_('ACC', { AccountID: id, Name: name, Type: type, BankAccount: no, OpeningBalance: ob, OpeningDate: od, Status: 'ACTIVE', CreatedAt: new Date(), CreatedBy: _v64Who_(op), OperationID: op.id });
      _audit_(op, 'V75_ACCOUNT', MC_V75.ACC[0], id, null, { name: name, type: type, bankAccount: no, opening: ob, openingDate: _v64Day_(od) });
      _endOp_(op);
      return _ok_({ accountId: id }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/**
 * Движение вручную (касса, банк). json: {accountId, date, direction: IN|OUT, amount, category, counterparty, inn, purpose, docNo, allowDuplicate}.
 * Перевод между своими счетами: {accountId (откуда), toAccountId, date, amount} — две записи с одним TransferID.
 */
function v75AddMove(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V75_MOVE', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), date = _v75Day_(d.date) || _v75Day_(new Date()), amount = _v75Amt_(d.amount), dir = String(d.direction || 'IN').toUpperCase();
    if (!(amount > 0)) return _v64Fail_(op, 'VALIDATION', 'Сумма должна быть больше нуля');
    if (date > _v75Day_(new Date())) return _v64Fail_(op, 'VALIDATION', 'Движение будущей датой не вносится');
    var cl = _v75Closed_(date); if (cl) return _v64Fail_(op, 'CLOSED_PERIOD', cl);
    return _withLock_(function () {
      _V64_TAB_ = {};
      var accs = _v75Accounts_(), acc = accs.filter(function (a) { return a.id === String(d.accountId); })[0], who = _v64Who_(op), now = new Date();
      if (!acc) return _v64Fail_(op, 'VALIDATION', 'Выберите счёт');
      if (d.toAccountId) {
        var to = accs.filter(function (a) { return a.id === String(d.toAccountId); })[0];
        if (!to || to.id === acc.id) return _v64Fail_(op, 'VALIDATION', 'Выберите другой счёт, на который перевод');
        var tid = _v64Id_('TRF'), base = { Date: date, Amount: amount, Category: MC_V75_TRANSFER, Purpose: d.purpose || ('перевод: ' + acc.name + ' → ' + to.name), DocNo: d.docNo || '', Source: 'MANUAL', TransferID: tid,
          Status: 'ACTIVE', CreatedAt: now, CreatedBy: who, OperationID: op.id };
        var a1 = _v64Id_('MOV'), a2 = _v64Id_('MOV');
        _v75Append_('MOVE', Object.assign({}, base, { MoveID: a1, AccountID: acc.id, Direction: 'OUT', Counterparty: to.name, ExtKey: _v75Key_(acc.id, date, 'OUT', amount, tid, '', '') }));
        _v75Append_('MOVE', Object.assign({}, base, { MoveID: a2, AccountID: to.id, Direction: 'IN', Counterparty: acc.name, ExtKey: _v75Key_(to.id, date, 'IN', amount, tid, '', '') }));
        _audit_(op, 'V75_TRANSFER', MC_V75.MOVE[0], tid, null, { from: acc.name, to: to.name, amount: amount, date: _v64Day_(date) });
        _endOp_(op);
        return _ok_({ transferId: tid, moves: [a1, a2] }, op.id);
      }
      if (dir !== 'IN' && dir !== 'OUT') return _v64Fail_(op, 'VALIDATION', 'Направление: IN (поступление) или OUT (выплата)');
      var m = { dir: dir, inn: d.inn || '', counterparty: d.counterparty || '', purpose: d.purpose || '' };
      var cat = String(d.category || '').trim() || _v75Guess_(m, _v75Rules_(), _v75Suppliers_()).category, cc = _v75Cat_(cat);
      if (!cc) return _v64Fail_(op, 'VALIDATION', 'Статья ДДС не из списка: ' + cat);
      if (cc.d && cc.d !== dir) return _v64Fail_(op, 'VALIDATION', 'Статья «' + cat + '» — для ' + (cc.d === 'IN' ? 'поступлений' : 'выплат'));
      var key = _v75Key_(acc.id, date, dir, amount, d.docNo, _v75Inn_(d.inn), d.purpose);
      var dup = _v75Moves_().filter(function (x) { return x.status === 'ACTIVE' && x.key === key; })[0];
      if (dup && !(d.allowDuplicate === true || d.allowDuplicate === 'true')) return _v64Fail_(op, 'DUPLICATE', 'Такое движение уже есть: ' + dup.id + ' (' + _v64Day_(dup.date) + ', ' + dup.amount + ' ₽). Если это вторая операция — подтвердите.');
      if (dup) key = key + '-' + Utilities.getUuid().slice(0, 4);
      var id = _v64Id_('MOV');
      _v75Append_('MOVE', { MoveID: id, AccountID: acc.id, Date: date, Direction: dir, Amount: amount, Category: cat, Counterparty: m.counterparty, CounterpartyINN: _v75Inn_(d.inn), Purpose: m.purpose, DocNo: d.docNo || '',
        Source: 'MANUAL', ExtKey: key, Status: 'ACTIVE', CreatedAt: now, CreatedBy: who, OperationID: op.id });
      _audit_(op, 'V75_MOVE', MC_V75.MOVE[0], id, null, { account: acc.name, date: _v64Day_(date), dir: dir, amount: amount, category: cat });
      _endOp_(op);
      return _ok_({ moveId: id, category: cat }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/**
 * Загрузить банковскую выписку. json: {text, fileName, accountId?}. Формат 1С (1CClientBankExchange) или CSV.
 * Счёт — по номеру из выписки (нет такого — заводится с остатком на начало из выписки) или выбранный.
 * Уже загруженные операции пропускаются; операции закрытого периода не загружаются (в отчёте загрузки).
 */
function v75ImportStatement(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V75_IMPORT', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), text = String(d.text || '');
    if (!text.trim()) return _v64Fail_(op, 'VALIDATION', 'Файл пустой');
    var S; try { S = _v75Parse_(text); } catch (pe) { return _v64Fail_(op, 'VALIDATION', 'Не удалось прочитать выписку: ' + (pe.message || pe)); }
    if (!S.rows.length) return _v64Fail_(op, 'VALIDATION', 'В выписке нет операций');
    return _withLock_(function () {
      _V64_TAB_ = {};
      var who = _v64Who_(op), now = new Date(), accs = _v75Accounts_(), acc = null, created = '';
      if (d.accountId) acc = accs.filter(function (a) { return a.id === String(d.accountId); })[0];
      if (!acc && S.account) acc = accs.filter(function (a) { return a.bankAccount === S.account; })[0];
      if (acc && S.account && acc.bankAccount && acc.bankAccount !== S.account) return _v64Fail_(op, 'VALIDATION', 'Выписка по счёту ' + S.account + ', а выбран «' + acc.name + '» (' + acc.bankAccount + ')');
      if (!acc) {
        if (!S.account) return _v64Fail_(op, 'VALIDATION', 'В файле нет номера счёта — выберите счёт, к которому относится выписка');
        if (S.opening === null || !S.from) return _v64Fail_(op, 'VALIDATION', 'Счёта ' + S.account + ' нет, а в выписке нет остатка на начало — заведите счёт с остатком вручную');
        created = _v64Id_('ACC');
        _v75Append_('ACC', { AccountID: created, Name: 'Р/с …' + S.account.slice(-4), Type: 'BANK', BankAccount: S.account, OpeningBalance: S.opening, OpeningDate: S.from, Status: 'ACTIVE', CreatedAt: now, CreatedBy: who, OperationID: op.id });
        acc = { id: created, name: 'Р/с …' + S.account.slice(-4), bankAccount: S.account, opening: S.opening, openingDate: S.from };
      }
      var have = {}; _v75Moves_().forEach(function (m) { if (m.status === 'ACTIVE') have[m.key] = true; });
      var rules = _v75Rules_(), sup = _v75Suppliers_(), impId = _v64Id_('IMP'), rows = [], dups = 0, closed = 0, uncat = 0, errors = (S.errors || []).slice();
      S.rows.forEach(function (r, i) {
        if (!r.date || !(r.amount > 0)) { errors.push('операция ' + (i + 1) + ': нет даты или суммы'); return; }
        var key = _v75Key_(acc.id, r.date, r.dir, r.amount, r.doc, r.inn, r.purpose);
        if (have[key]) { dups++; return; }
        if (_v75Closed_(r.date)) { closed++; return; }
        have[key] = true;
        var g = _v75Guess_(r, rules, sup); if (g.category === MC_V75_UNCAT) uncat++;
        rows.push(_v75Row_('MOVE', { MoveID: _v64Id_('MOV') + '-' + (i + 1), AccountID: acc.id, Date: r.date, Direction: r.dir, Amount: r.amount, Category: g.category, Counterparty: r.counterparty, CounterpartyINN: r.inn,
          Purpose: r.purpose, DocNo: r.doc, Source: 'BANK_IMPORT', ImportID: impId, ExtKey: key, Status: 'ACTIVE', CreatedAt: now, CreatedBy: who, OperationID: op.id }));
      });
      var sh = _v75Sh_('MOVE'); if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, MC_V75.MOVE[1].length).setValues(rows);
      _V64_TAB_ = {};
      // сверка: остаток на конец по выписке против расчёта по загруженным движениям
      var check = null;
      if (S.closing !== null && S.to) { var nx = new Date(S.to.getFullYear(), S.to.getMonth(), S.to.getDate() + 1), calc = _v75Balance_(acc, _v75Moves_(), nx);
        check = { statementClosing: S.closing, computedClosing: calc, diff: _v64R2_(calc - S.closing), ok: Math.abs(calc - S.closing) < 0.01 }; }
      _v75Append_('IMP', { ImportID: impId, AccountID: acc.id, FileName: d.fileName || '', Format: S.format, PeriodFrom: S.from || '', PeriodTo: S.to || '', Lines: S.rows.length, Added: rows.length, Duplicates: dups,
        ClosedSkipped: closed, Errors: errors.length, Uncategorized: uncat, StatementOpening: S.opening === null ? '' : S.opening, StatementClosing: S.closing === null ? '' : S.closing, At: now, By: who, OperationID: op.id });
      _audit_(op, 'V75_IMPORT', MC_V75.IMP[0], impId, null, { account: acc.name, file: d.fileName || '', lines: S.rows.length, added: rows.length, duplicates: dups, closedSkipped: closed });
      _endOp_(op);
      return _ok_({ importId: impId, account: acc.name, accountCreated: !!created, format: S.format, from: S.from ? _v64Day_(S.from) : '', to: S.to ? _v64Day_(S.to) : '', lines: S.rows.length,
        added: rows.length, duplicates: dups, closedSkipped: closed, uncategorized: uncat, errors: errors.slice(0, 20), check: check }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Разнести движение по статье. json: {moveId, category, remember}. remember — правило (ИНН или контрагент) и разнести такие же неразнесённые. */
function v75SetCategory(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V75_CATEGORY', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), cat = String(d.category || '').trim(), cc = _v75Cat_(cat);
    if (!cc) return _v64Fail_(op, 'VALIDATION', 'Статья ДДС не из списка');
    return _withLock_(function () {
      _V64_TAB_ = {};
      var f = _v75Find_('MOVE', d.moveId);
      if (!f || String(f.o.Status) !== 'ACTIVE') return _v64Fail_(op, 'NOT_FOUND', 'Движение не найдено');
      if (f.o.TransferID) return _v64Fail_(op, 'VALIDATION', 'Перевод между своими счетами не разносится — отмените его, если это не перевод');
      if (cc.d && cc.d !== String(f.o.Direction)) return _v64Fail_(op, 'VALIDATION', 'Статья «' + cat + '» — для ' + (cc.d === 'IN' ? 'поступлений' : 'выплат'));
      var cl = _v75Closed_(f.o.Date); if (cl) return _v64Fail_(op, 'CLOSED_PERIOD', cl);
      var before = String(f.o.Category), who = _v64Who_(op), more = 0, rule = '';
      _v75Set_(f, { Category: cat });
      if (d.remember === true || d.remember === 'true') {
        var inn = _v75Inn_(f.o.CounterpartyINN), match = inn || String(f.o.Counterparty || '').trim();
        if (match) {
          rule = _v64Id_('RUL');
          _v75Append_('RULE', { RuleID: rule, MatchType: inn ? 'INN' : 'TEXT', Match: match, Category: cat, Status: 'ACTIVE', CreatedAt: new Date(), CreatedBy: who });
          var sh = _v75Sh_('MOVE'), h = MC_V75.MOVE[1], v = sh.getDataRange().getValues(), c = function (n) { return h.indexOf(n); };
          for (var i = 1; i < v.length; i++) {
            if (String(v[i][c('Status')]) !== 'ACTIVE' || String(v[i][c('Category')]) !== MC_V75_UNCAT || String(v[i][c('Direction')]) !== String(f.o.Direction)) continue;
            var same = inn ? _v75Inn_(v[i][c('CounterpartyINN')]) === inn : _v75Norm_(v[i][c('Counterparty')]) === _v75Norm_(match);
            if (same && !_v75Closed_(v[i][c('Date')])) { sh.getRange(i + 1, c('Category') + 1).setValue(cat); more++; }
          }
          _V64_TAB_ = {};
        }
      }
      _audit_(op, 'V75_CATEGORY', MC_V75.MOVE[0], String(d.moveId), { category: before }, { category: cat, rule: rule, alsoApplied: more });
      _endOp_(op);
      return _ok_({ moveId: String(d.moveId), category: cat, ruleId: rule, alsoApplied: more }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Отменить движение (перевод — обе записи). json: {moveId, reason}. */
function v75CancelMove(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'finance_edit', 'V75_CANCEL', 'Экономика', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), reason = String(d.reason || '').trim();
    if (!reason) return _v64Fail_(op, 'VALIDATION', 'Укажите причину отмены');
    return _withLock_(function () {
      _V64_TAB_ = {};
      var f = _v75Find_('MOVE', d.moveId);
      if (!f || String(f.o.Status) !== 'ACTIVE') return _v64Fail_(op, 'NOT_FOUND', 'Действующее движение не найдено');
      var cl = _v75Closed_(f.o.Date); if (cl) return _v64Fail_(op, 'CLOSED_PERIOD', cl);
      var ids = [String(d.moveId)];
      if (f.o.TransferID) _v75Moves_().forEach(function (m) { if (m.transfer === String(f.o.TransferID) && m.id !== String(d.moveId) && m.status === 'ACTIVE') ids.push(m.id); });
      ids.forEach(function (id) { _v75Set_(_v75Find_('MOVE', id), { Status: 'CANCELLED', CancelReason: reason }); });
      _audit_(op, 'V75_CANCEL', MC_V75.MOVE[0], ids.join(','), { status: 'ACTIVE' }, { status: 'CANCELLED', reason: reason });
      _endOp_(op);
      return _ok_({ cancelled: ids }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
