/**
 * MON CHEF V101 — Restaurant Service: экран кухни и бара (KDS), подача гостю, замена (ТЗ Restaurant Service 1.0, модули 4–5, этап 4).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Задания приходят из заказа официанта (rsOrderSend). Статусы задания:
 *   НОВЫЙ (NEW) → ПРИНЯТ (ACCEPTED) → ГОТОВИТСЯ (COOKING) → ГОТОВО (READY) → ВЫДАНО (ISSUED);
 *   ОЖИДАЕТ КУРСА (WAIT_COURSE) — начать нельзя, пока официант не запустит курс; ПРОБЛЕМА (PROBLEM); ОТМЕНА (CANCELLED).
 * Позиция заказа следует за заданием: принят / готовится → «готовится», готово → «готово» (официант видит сразу, уведомление
 *   «Официанту»), проблема → «проблема». ВЫДАНО — кухня отдала блюдо на раздаче (время, кто выдал, результат);
 *   ПОДАНО — официант подтвердил подачу гостю. Готовность и подача — разные события.
 * Цех: кухня видит задания своих цехов (права shop_hot / shop_cold / shop_pastry / shop_meat / shop_fish / shop_veg / shop_prep,
 *   shop_all — все; права цехов настраиваются в редакторе ролей); бар — задания цеха «Бар» (право bar_queue).
 * Отмена: до начала приготовления — без расхода; после начала — кухня фиксирует расход (полностью / частично с описанием),
 *   позиция отменяется, расход записывается в позицию («Расход при отмене») и проводится по складу на этапе 7.
 *   Официант не отменяет начатое сам — отправляет кухне запрос отмены с причиной.
 * Обновление экранов: метка «данные изменились» (mc_gen) — экран спрашивает её раз в 10–15 с и загружает данные только при изменении.
 */
var MC_RS_TK_RU_ = { NEW: 'новый', ACCEPTED: 'принят', COOKING: 'готовится', READY: 'готово', ISSUED: 'выдано', PROBLEM: 'проблема', CANCELLED: 'отменён', WAIT_COURSE: 'ожидает курса' };
var MC_RS_SHOP_PERMS_ = { shop_hot: 'Горячий цех', shop_cold: 'Холодный цех', shop_pastry: 'Кондитерский цех', shop_meat: 'Мясной цех', shop_fish: 'Рыбный цех', shop_veg: 'Овощной цех', shop_prep: 'Заготовочный цех', shop_bar: 'Бар' };
var MC_RS_KDS_DONE_MIN_ = 30;   // выданные и отменённые задания видны на экране ещё 30 минут

/** Цеха сотрудника: null — все. */
function _rsShopsOf_(s) {
  if (!s || s.dev) return null;
  var p = s.permissions || {}; if (p.shop_all) return null;
  var out = []; Object.keys(MC_RS_SHOP_PERMS_).forEach(function (k) { if (p[k]) out.push(MC_RS_SHOP_PERMS_[k]); });
  if (p.shop_hot || p.shop_cold) out = out.concat(MC_RB_SHARED_SHOPS_ || []);
  return out.length ? out : null;
}
function _rsCanTicket_(s, t) {
  var dept = String(t['Подразделение'] || t.dept);
  if (dept === 'BAR') return _mcRbHasExact_(s, 'bar_queue');
  if (!_mcRbHasExact_(s, 'kitchen_queue')) return false;
  var sh = _rsShopsOf_(s), w = _rsS_(t['Цех'] !== undefined ? t['Цех'] : t.shop);
  return !sh || sh.indexOf(w) >= 0 || (!w && sh.indexOf('') >= 0);
}
function _rsTk_(r) {
  var ts = function (x) { return _rsIsDate_(x) ? x.getTime() : null; }, hm = function (x) { return _rsIsDate_(x) ? Utilities.formatDate(x, _mcTz_(), 'HH:mm') : ''; };
  return { id: String(r.TicketID), itemId: String(r.OrderItemID), orderId: String(r.OrderID), table: String(r['Стол'] || ''), dept: String(r['Подразделение']), shop: String(r['Цех'] || ''),
    code: String(r.DishCode), ttk: parseInt(r.TTKVersion, 10) || 0, name: String(r['Название']), qty: _rsNum_(r['Кол-во']) || 0, weight: String(r['Вес'] || ''), course: parseInt(r['Курс'], 10) || 0,
    modifiers: _rsJ_(r['Модификаторы'], []) || [], comment: String(r['Комментарий'] || ''), priority: parseInt(r['Приоритет'], 10) || 0, status: String(r['Статус']), statusRu: MC_RS_TK_RU_[r['Статус']] || r['Статус'],
    acceptedBy: String(r['Принял'] || ''), acceptedAt: hm(r['Принято']), startedAt: hm(r['Готовить начал']), readyAt: hm(r['Готово']), issuedAt: hm(r['Выдано']), cook: String(r['Исполнитель'] || ''),
    problem: String(r['Проблема'] || ''), cancelRequest: String(r['Запрос отмены'] || ''), createdMs: ts(r.CreatedAt), updatedMs: ts(r.UpdatedAt), version: parseInt(r.Version, 10) || 1 };
}
/** Метка «данные изменились» — экраны кухни, бара и зала опрашивают её вместо полной загрузки. */
function rsGen(json, token) {
  return _rsRead_(token, 'kitchen_queue|bar_queue|stopgo_view|hall_view|order_edit', function () { return { gen: typeof _mcGen_ === 'function' ? _mcGen_() : '' }; });
}
/** Экран кухни или бара. {dept: KITCHEN|BAR, shop, gen} — gen совпал → {same:true}. */
function rsKdsData(json, token) {
  return _rsRead_(token, 'kitchen_queue|bar_queue|stopgo_view', function (s) {
    var d = _rsJ_(json, {}) || {}, gen = typeof _mcGen_ === 'function' ? _mcGen_() : '';
    if (d.gen && d.gen === gen) return { same: true, gen: gen };
    var dept = d.dept === 'BAR' ? 'BAR' : 'KITCHEN', now = Date.now(), lim = now - MC_RS_KDS_DONE_MIN_ * 60000;
    var can = dept === 'BAR' ? _mcRbHasExact_(s, 'bar_queue') : _mcRbHasExact_(s, 'kitchen_queue');
    var all = can ? _rsRows_(MC_RS_SH_.QUEUE).filter(function (r) { return String(r['Подразделение']) === dept && _rsCanTicket_(s, r); }) : [];
    var shops = []; all.forEach(function (r) { var w = String(r['Цех'] || ''); if (w && shops.indexOf(w) < 0) shops.push(w); });
    var list = all.map(_rsTk_).filter(function (t) {
      if (d.shop && t.shop !== d.shop) return false;
      if (['ISSUED', 'CANCELLED'].indexOf(t.status) >= 0) return t.updatedMs && t.updatedMs >= lim;
      return true;
    });
    list.forEach(function (t) { t.waitMin = t.createdMs ? Math.max(0, Math.round((now - t.createdMs) / 60000)) : 0; delete t.createdMs; delete t.updatedMs; });
    // этап 6: рецепт на карточке (состав на порцию и технология из ТТК) — для активных заданий
    try { var codes = []; list.forEach(function (t) { if (['CANCELLED', 'ISSUED'].indexOf(t.status) < 0 && codes.indexOf(t.code) < 0) codes.push(t.code); });
      var rec = typeof _rsRecipeIdx_ === 'function' ? _rsRecipeIdx_(codes) : {}; list.forEach(function (t) { if (rec[t.code]) t.recipe = rec[t.code]; }); } catch (e) {}
    try { if (typeof _rsCcpAttach_ === 'function') _rsCcpAttach_(list); } catch (e) {}   // этап 9: ККТ блюда — замеры на карточке
    var rank = { PROBLEM: 0, NEW: 1, ACCEPTED: 2, COOKING: 3, READY: 4, WAIT_COURSE: 5, ISSUED: 6, CANCELLED: 7 };
    list.sort(function (a, b) { return (rank[a.status] - rank[b.status]) || (b.priority - a.priority) || (b.waitMin - a.waitMin); });
    return { gen: gen, dept: dept, can: { act: can, stop: _mcRbHasExact_(s, dept === 'BAR' ? 'stopgo_bar' : 'stopgo_kitchen'), approve: _mcRbHasExact_(s, 'stopgo_approve') },
      shops: shops.sort(), myShops: _rsShopsOf_(s), tickets: list, me: _rsWho_(s) };
  });
}
function _rsLoadTicket_(c) {
  var r = _rsRows_(MC_RS_SH_.QUEUE).filter(function (x) { return String(x.TicketID) === String(c.d.ticketId); })[0];
  if (!r) return { fail: ['NOT_FOUND', 'Задание не найдено'] };
  if (!_rsCanTicket_(c.s, r)) return { fail: ['FORBIDDEN', 'Это задание другого цеха или подразделения'] };
  _rsCheckVersion_(r, c.d.version);
  var it = _rsRows_(MC_RS_SH_.ITEMS).filter(function (x) { return String(x.OrderItemID) === String(r.OrderItemID); })[0];
  return { row: r, tk: _rsTk_(r), item: it };
}
/**
 * Действие с заданием. {idem, ticketId, version, action: accept | start | ready | issue | problem | resolve, reason, result}
 */
function rsTicketAct(json, token) {
  var res = _rsMutate_(token, 'kitchen_queue|bar_queue', 'RS_TICKET_ACT', json, function (c) {
    var L = _rsLoadTicket_(c); if (L.fail) return L;
    var a = String(c.d.action || ''), st = L.tk.status, to = null, now = new Date(), who = _rsWho_(c.s), reason = _rsS_(c.d.reason).slice(0, 300);
    var NEXT = { accept: { NEW: 'ACCEPTED' }, start: { NEW: 'COOKING', ACCEPTED: 'COOKING' }, ready: { ACCEPTED: 'READY', COOKING: 'READY' }, issue: { READY: 'ISSUED' },
      problem: { NEW: 'PROBLEM', ACCEPTED: 'PROBLEM', COOKING: 'PROBLEM' }, resolve: { PROBLEM: L.row['Готовить начал'] ? 'COOKING' : 'ACCEPTED' } };
    if (!NEXT[a]) return { fail: ['VALIDATION', 'Неизвестное действие'] };
    to = NEXT[a][st];
    if (!to) return { fail: ['VALIDATION', st === 'WAIT_COURSE' ? 'Курс ещё не запущен официантом — готовить рано' : 'Из статуса «' + (MC_RS_TK_RU_[st] || st) + '» это действие недоступно'] };
    if (a === 'problem' && !reason) return { fail: ['VALIDATION', 'Опишите проблему — её увидит официант'] };
    var t = _rsCopy_(L.row); t['Статус'] = to;
    if (a === 'accept' || (a === 'start' && !t['Принято'])) { t['Принял'] = who; t['Принято'] = now; }
    if (a === 'start') { t['Готовить начал'] = now; t['Исполнитель'] = who; }
    if (a === 'ready') { t['Готово'] = now; if (!t['Исполнитель']) t['Исполнитель'] = who; if (!t['Готовить начал']) t['Готовить начал'] = now; }
    if (a === 'issue') { t['Выдано'] = now; t['Выдал'] = who; t['Результат выдачи'] = _rsS_(c.d.result).slice(0, 200) || 'выдано официанту'; }
    if (a === 'problem') t['Проблема'] = reason;
    if (a === 'resolve') t['Проблема'] = (t['Проблема'] ? t['Проблема'] + ' → решено: ' : 'решено: ') + (reason || 'продолжаем');
    // этап 6: «Готовить» — проверка наличия партий (без списания); «Готово» — списание ингредиентов по ТТК (V71, FEFO), себестоимость
    var cons = null, warn = '';
    if (a === 'start') { try { warn = _rsConsumeText_(_rsConsume_(L.row, L.item, true)); } catch (e) { warn = ''; } }
    if (to === 'READY' && typeof _rsCcpGate_ === 'function') {   // этап 9: обязательные ККТ блюда — до «Готово»
      var cg = _rsCcpGate_(String(L.row.DishCode), String(L.row.TicketID));
      if (!cg.ok) return { fail: ['CCP_REQUIRED', '«Готово» заблокировано — ККТ: ' + _tccpBlockText_(cg)] };
    }
    if (to === 'READY') {
      cons = _rsConsume_(L.row, L.item, false);
      if (cons.status !== 'ALREADY') { t['Списано по партиям'] = JSON.stringify({ status: cons.status, portions: cons.portions, lines: cons.lines, short: cons.short, unreleased: cons.unreleased }).slice(0, 45000); t['Себестоимость, коп'] = cons.costKop; }
      warn = _rsConsumeText_(cons);
    }
    _rsStamp_(t, c.s, c.op, false);
    var plan = [{ sheet: MC_RS_SH_.QUEUE, row: t }], itemTo = { ACCEPTED: 'COOKING', COOKING: 'COOKING', READY: 'READY', PROBLEM: 'PROBLEM' }[to];
    if (L.item && itemTo && ['SERVED', 'CANCELLED'].indexOf(String(L.item['Статус'])) < 0) { var it = _rsCopy_(L.item); it['Статус'] = itemTo; _rsStamp_(it, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.ITEMS, row: it }); }
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'TICKET', L.tk.id, { order: L.tk.orderId }, 'TICKET_' + to, { status: st }, { status: to, by: who, reason: reason, result: t['Результат выдачи'] || '' }) });
    try {
      if (to === 'READY') _notify_('RS_READY', 'info', 'Готово: стол № ' + L.tk.table, L.tk.name + ' × ' + L.tk.qty + (L.tk.dept === 'BAR' ? ' (бар)' : ''), 'Официант', 'RS_RDY_' + L.tk.id, c.op);
      if (to === 'PROBLEM') _notify_('RS_PROBLEM', 'warning', 'Проблема: стол № ' + L.tk.table, L.tk.name + ' — ' + reason, 'Официант', 'RS_PRB_' + L.tk.id + '_' + now.getTime(), c.op);
    } catch (e) {}
    if (cons && cons.short && cons.short.length) { try { _notify_('RS_SHORT', 'warning', 'Списание не полностью: ' + L.tk.name, warn, L.tk.dept === 'BAR' ? 'Менеджер бара' : 'Шеф-повар', 'RS_SH_' + L.tk.id, c.op); } catch (e) {} }
    return { data: { ticket: _rsTk_(t), warning: warn, stock: cons ? { status: cons.status, lines: (cons.lines || []).length, short: (cons.short || []).length } : null }, plan: plan,
      audit: { action: 'RS_TICKET_' + to, entity: MC_RS_SH_.QUEUE, id: L.tk.id, before: { status: st }, after: { status: to, reason: reason, stock: cons ? cons.status : '', costKop: cons ? cons.costKop : '' } } };
  });
  // этап 9: после «Готово» — хватит ли партий на следующую порцию (предложение STOP)
  try { var x = JSON.parse(res); if (x && x.success && x.data && x.data.ticket && x.data.ticket.status === 'READY' && typeof _rsStopWatch_ === 'function') _rsStopWatch_([x.data.ticket.code], null, null); } catch (e) {}
  return res;
}
/**
 * Отмена задания кухней. {idem, ticketId, version, reason, consumption: NONE | FULL | PARTIAL, note}
 * Начатое (готовится, готово, проблема после начала) — только с фиксацией расхода; не начатое — без расхода.
 */
function rsTicketCancel(json, token) {
  return _rsMutate_(token, 'kitchen_queue|bar_queue', 'RS_TICKET_CANCEL', json, function (c) {
    var L = _rsLoadTicket_(c); if (L.fail) return L;
    var st = L.tk.status, reason = _rsS_(c.d.reason).slice(0, 300), mode = String(c.d.consumption || 'NONE').toUpperCase(), note = _rsS_(c.d.note).slice(0, 300);
    if (['CANCELLED', 'ISSUED'].indexOf(st) >= 0) return { fail: ['VALIDATION', st === 'ISSUED' ? 'Блюдо уже выдано — отмена через официанта (возврат)' : 'Задание уже отменено'] };
    if (!reason) return { fail: ['VALIDATION', 'Укажите причину отмены'] };
    var started = !!L.row['Готовить начал'] || st === 'COOKING' || st === 'READY';
    if (['NONE', 'FULL', 'PARTIAL'].indexOf(mode) < 0) return { fail: ['VALIDATION', 'Расход: нет, полностью или частично'] };
    if (started && mode === 'NONE') return { fail: ['VALIDATION', 'Приготовление начато — укажите расход: полностью или частично'] };
    if (mode === 'PARTIAL' && !note) return { fail: ['VALIDATION', 'Частичный расход — опишите, что использовано'] };
    if (L.item && typeof _rsItemPaid_ === 'function' && _rsItemPaid_(String(L.item.OrderItemID))) return { fail: ['VALIDATION', 'Позиция в оплаченном счёте — отмена через возврат'] };
    var now = new Date(), who = _rsWho_(c.s), t = _rsCopy_(L.row);
    t['Статус'] = 'CANCELLED'; t['Проблема'] = 'отмена: ' + reason + (L.row['Запрос отмены'] ? ' (запрос официанта: ' + L.row['Запрос отмены'] + ')' : ''); _rsStamp_(t, c.s, c.op, false);
    var cons = { mode: mode, note: note, code: L.tk.code, ttk: L.tk.ttk, qty: L.tk.qty, weight: L.tk.weight, statusAtCancel: st, started: started, by: who, at: Utilities.formatDate(now, _mcTz_(), 'dd.MM.yyyy HH:mm'),
      posted: false, postNote: mode === 'NONE' ? 'расхода нет' : '' };
    // этап 6: полный расход проводится по складу сразу (по ТТК, FEFO); частичный — актом списания MON CHEF по описанию (не угадываем количества)
    if (mode === 'FULL') {
      var r6 = _rsConsume_(L.row, L.item, false);
      cons.posted = r6.status !== 'NO_TTK'; cons.stock = r6.status === 'ALREADY' ? 'списано при «Готово»' : r6.status;
      if (r6.status !== 'ALREADY') { t['Списано по партиям'] = JSON.stringify({ status: r6.status, portions: r6.portions, lines: r6.lines, short: r6.short }).slice(0, 45000); t['Себестоимость, коп'] = r6.costKop; cons.costKop = r6.costKop; }
      cons.postNote = r6.status === 'NO_TTK' ? 'в ТТК нет состава — списать нечего' : 'списано по ТТК' + (r6.short && r6.short.length ? ', ' + _rsConsumeText_(r6) : '');
    } else if (mode === 'PARTIAL') cons.postNote = 'оформите акт списания по описанию: ' + note + (_rsConsumed_(L.tk.id) ? ' (по ТТК уже списано при «Готово»)' : '');
    var plan = [{ sheet: MC_RS_SH_.QUEUE, row: t }];
    if (L.item && String(L.item['Статус']) !== 'CANCELLED') {
      var it = _rsCopy_(L.item); it['Статус'] = 'CANCELLED'; it['Причина отмены'] = reason; it['Расход при отмене'] = JSON.stringify(cons); _rsStamp_(it, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.ITEMS, row: it });
    }
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'TICKET', L.tk.id, { order: L.tk.orderId }, 'TICKET_CANCELLED', { status: st }, cons) });
    try { _notify_('RS_CANCELLED', 'warning', 'Отменено кухней: стол № ' + L.tk.table, L.tk.name + ' — ' + reason, 'Официант', 'RS_CNL_' + L.tk.id, c.op); } catch (e) {}
    return { data: { ticket: _rsTk_(t), consumption: cons }, plan: plan, audit: { action: 'RS_TICKET_CANCELLED', entity: MC_RS_SH_.QUEUE, id: L.tk.id, before: { status: st }, after: cons } };
  });
}
/** «Подано»: официант подтверждает подачу гостю готовых позиций. Задание «готово» при этом считается выданным. {idem, orderId, itemIds[]} */
function rsItemServe(json, token) {
  return _rsMutate_(token, 'order_edit|order_all', 'RS_ITEM_SERVE', json, function (c) {
    var L = _rsLoadOrder_(c); if (L.fail) return L;
    var ids = (Array.isArray(c.d.itemIds) ? c.d.itemIds : []).map(String); if (!ids.length) return { fail: ['VALIDATION', 'Выберите позиции'] };
    var items = _rsRows_(MC_RS_SH_.ITEMS).filter(function (r) { return String(r.OrderID) === L.o.id && ids.indexOf(String(r.OrderItemID)) >= 0; });
    if (items.length !== ids.length) return { fail: ['NOT_FOUND', 'Позиция не найдена'] };
    var bad = items.filter(function (r) { return String(r['Статус']) !== 'READY'; });
    if (bad.length) return { fail: ['VALIDATION', 'Подать можно только готовое: ' + bad.map(function (r) { return '«' + r['Название'] + '» — ' + (MC_RS_IT_RU_[r['Статус']] || r['Статус']); }).join(', ')] };
    var now = new Date(), who = _rsWho_(c.s), plan = [], q = _rsRows_(MC_RS_SH_.QUEUE);
    items.forEach(function (r) {
      var it = _rsCopy_(r); it['Статус'] = 'SERVED'; it['Подано'] = now; it['Подал'] = who; _rsStamp_(it, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.ITEMS, row: it });
      var tk = q.filter(function (x) { return String(x.TicketID) === String(r.TicketID); })[0];
      if (tk && String(tk['Статус']) === 'READY') { var t = _rsCopy_(tk); t['Статус'] = 'ISSUED'; t['Выдано'] = now; t['Выдал'] = who; t['Результат выдачи'] = 'забрал официант'; _rsStamp_(t, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.QUEUE, row: t }); }
    });
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ORDER', L.o.id, { order: L.o.id }, 'ITEMS_SERVED', null, { items: ids, by: who }) });
    return { data: { served: ids.length }, plan: plan, audit: { action: 'RS_ITEMS_SERVED', entity: MC_RS_SH_.ITEMS, id: L.o.id, after: { items: ids.length } } };
  });
}
/**
 * Замена позиции, которую кухня не может выполнить (STOP, проблема): исходная отменяется без расхода (приготовление не начато),
 * новая — «не отправлено», связана с исходной; решение гостя — в истории. {idem, itemId, version, code, reason}
 */
function rsItemReplace(json, token) {
  return _rsMutate_(token, 'order_edit|order_all', 'RS_ITEM_REPLACE', json, function (c) {
    var L = _rsLoadItem_(c); if (L.fail) return L;
    var it = L.it, reason = _rsS_(c.d.reason).slice(0, 300);
    if (['SENT', 'WAIT_COURSE', 'PROBLEM'].indexOf(it.status) < 0) return { fail: ['VALIDATION', 'Заменить можно отправленную, но не начатую позицию или позицию с проблемой'] };
    if (!reason) return { fail: ['VALIDATION', 'Укажите, что решил гость'] };
    var tk = _rsRows_(MC_RS_SH_.QUEUE).filter(function (x) { return String(x.TicketID) === it.ticketId; })[0];
    if (tk && tk['Готовить начал']) return { fail: ['VALIDATION', 'Кухня уже начала готовить — отмену с расходом подтверждает кухня'] };
    var dish = _rsDishes_()[_rsS_(c.d.code)], price = dish ? _rsPriceIdx_(_rsToday_())[dish.code] : null;
    if (!dish) return { fail: ['VALIDATION', 'Блюдо замены не найдено в каталоге'] };
    if (!price || !price.unit) return { fail: ['VALIDATION', '«' + dish.name + '»: нет цены на сегодня'] };
    if (_rsStopOf_(_rsStopIdx_(), dish.code, dish.dept).status === 'STOP') return { fail: ['VALIDATION', '«' + dish.name + '» тоже на STOP'] };
    var plan = [], now = new Date();
    var old = _rsCopy_(L.row); old['Статус'] = 'CANCELLED'; old['Причина отмены'] = 'замена: ' + reason; old['Расход при отмене'] = JSON.stringify({ mode: 'NONE', note: 'приготовление не начиналось', posted: false });
    _rsStamp_(old, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.ITEMS, row: old });
    if (tk && String(tk['Статус']) !== 'CANCELLED') { var t = _rsCopy_(tk); t['Статус'] = 'CANCELLED'; t['Проблема'] = (t['Проблема'] ? t['Проблема'] + ' → ' : '') + 'замена: ' + reason; _rsStamp_(t, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.QUEUE, row: t }); }
    var row = _rsItemRow_(it.orderId, dish, price, { qty: price.unit.weighted ? 1 : it.qty, amount: price.unit.weighted ? (dish.yield || null) : null, course: it.course, guest: it.guest, comment: it.comment, modifiers: [] }, L.o.guests, 'REPLACE ' + it.id, 0);
    if (price.unit.weighted && !(row['Вес план'] > 0)) return { fail: ['VALIDATION', '«' + dish.name + '» — весовое: добавьте его вручную с весом'] };
    row['Замена для'] = it.id; _rsStamp_(row, c.s, c.op, true); plan.push({ sheet: MC_RS_SH_.ITEMS, row: row });
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ITEM', it.id, { order: it.orderId }, 'ITEM_REPLACED', { code: it.code, name: it.name, status: it.status }, { code: dish.code, name: dish.name, newItem: row.OrderItemID, decision: reason }) });
    return { data: { item: _rsIt_(row) }, plan: plan, audit: { action: 'RS_ITEM_REPLACED', entity: MC_RS_SH_.ITEMS, id: it.id, after: { replacement: dish.code, reason: reason } } };
  });
}

var MC_GATE_EXT_ = (typeof MC_GATE_EXT_ !== 'undefined' && MC_GATE_EXT_) || {};
MC_GATE_EXT_.rsGen = { need: 'kitchen_queue|bar_queue|stopgo_view|hall_view|order_edit' };
MC_GATE_EXT_.rsKdsData = { need: 'kitchen_queue|bar_queue|stopgo_view' };
MC_GATE_EXT_.rsTicketAct = { need: 'kitchen_queue|bar_queue', mut: true };
MC_GATE_EXT_.rsTicketCancel = { need: 'kitchen_queue|bar_queue', mut: true };
MC_GATE_EXT_.rsItemServe = { need: 'order_edit|order_all', mut: true };
MC_GATE_EXT_.rsItemReplace = { need: 'order_edit|order_all', mut: true };
