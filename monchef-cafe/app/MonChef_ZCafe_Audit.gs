/**
 * MON CHEF · КАФЕ — аудит предприятия.
 *
 * Внутренний аудит по данным системы: склад и партии, продажи и меню, экономика, задачи,
 * ХАССП и персонал (контрольный лист готовности к проверке), целостность учёта.
 * Каждая находка — что не так, сколько, на какую сумму, что сделать и где это открыть.
 * Балл раздела: 100 минус вес находок (критичная 25, высокая 12, средняя 5, низкая 2), не ниже 0;
 * итог — среднее по разделам. Прогон сохраняется в «Кафе_Аудит» (история и динамика балла);
 * по критичным и высоким находкам можно сразу поставить задачи в единый центр задач.
 * Это внутренний аудит по записям системы, не заключение надзорного органа или аудиторской фирмы.
 */

var MC_CF_AUD_ = 'Кафе_Аудит';
var MC_CF_AUD_HEAD_ = ['RunID', 'Дата', 'Период, дней', 'Кто', 'Балл', 'Оценка', 'Находок', 'Критичных', 'Высоких', 'Баллы по разделам (JSON)', 'Находки (JSON)', 'Показатели (JSON)', 'OperationID'];
var MC_CF_SEV_ = { CRITICAL: { w: 25, ru: 'критично' }, HIGH: { w: 12, ru: 'высокая' }, MEDIUM: { w: 5, ru: 'средняя' }, LOW: { w: 2, ru: 'низкая' } };
var MC_CF_AREAS_ = ['Склад и партии', 'Продажи и меню', 'Экономика', 'Задачи и планирование', 'ХАССП и персонал', 'Целостность учёта'];

function _cfAudit_(days, who) {
  var now = _mcNow_(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), per = _cfPeriod_({ from: new Date(t0.getTime() - (days - 1) * 864e5), to: t0 });
  var F = [], add = function (area, sev, code, title, detail, todo, go, sum) { F.push({ area: area, sev: sev, sevRu: MC_CF_SEV_[sev].ru, code: code, title: title, detail: detail || '', todo: todo || '', go: go || null, sum: sum === undefined ? null : _cfR2_(sum) }); };
  var M = {}, safe = function (name, fn) { try { fn(); } catch (e) { add('Целостность учёта', 'LOW', 'CHECK_FAILED', 'Проверка «' + name + '» не выполнилась', String(e && e.message || e), 'Повторите аудит; если ошибка повторяется — сообщите администратору системы'); } };
  var fcT = _cafeProp_('MC_CAFE_FC_TARGET', 35), idx = _buildDishIndexes_();

  /* ---------- Склад и партии ---------- */
  safe('склад', function () {
    var A = 'Склад и партии', bv = _stockBatchesSheet_().getDataRange().getValues(), expired = [], noExp = 0, quarantine = [], sumBy = {}, expSum = 0;
    for (var i = 1; i < bv.length; i++) {
      var r = bv[i]; if (!r[0]) continue;
      var st = String(r[10] || 'active'), rem = parseFloat(r[9]) || 0, ex = _parseDate_(r[5]), price = parseFloat(r[6]) || 0;
      if (rem > 0 && (st === 'active' || st === 'quarantine' || st === 'recheck')) {
        var b = _toBaseUnitServer_(rem, r[2] || 'г'), k = _prodKey_(r[1]) + '|' + b.unit; sumBy[k] = (sumBy[k] || 0) + b.qty;
      }
      if (rem > 0 && st === 'active' && ex && ex.getTime && ex.getTime() < t0.getTime()) { expired.push(String(r[1]) + ' (' + r[0] + ', срок ' + _cfRu_(ex) + ')'); expSum += rem * price; }
      if (rem > 0 && st === 'active' && !(ex && ex.getTime)) noExp++;
      var got = _cfDay_(r[4]);
      if (rem > 0 && st === 'quarantine' && got && t0.getTime() - got.getTime() > 2 * 864e5) quarantine.push(String(r[1]) + ' (' + r[0] + ')');
    }
    M.expiredBatches = expired.length;
    if (expired.length) add(A, 'HIGH', 'BATCH_EXPIRED', 'Просроченные партии с остатком: ' + expired.length, expired.slice(0, 12).join('; '), 'Списать актом «Истёк срок годности»; проверить, почему не ушли по FEFO', { module: 'writeoff' }, expSum);
    if (noExp) add(A, 'MEDIUM', 'BATCH_NO_EXPIRY', 'Партии без срока годности: ' + noExp, 'FEFO ставит их в конец очереди, контроль сроков невозможен', 'Внести срок с этикетки или документа в карточке партии', { sec: 'stock' });
    if (quarantine.length) add(A, 'MEDIUM', 'BATCH_QUARANTINE', 'Партии в карантине дольше 2 дней: ' + quarantine.length, quarantine.slice(0, 12).join('; '), 'Принять решение по партии: допуск, возврат или брак', { module: 'batchcontrol' });
    // остатки «Склад_Остатки» против суммы партий
    var bal = JSON.parse(getStockBalances()), diff = [], neg = [], noPrice = [];
    bal.forEach(function (x) {
      var b = _toBaseUnitServer_(x.qty, x.unit || 'г'), k = _prodKey_(x.name) + '|' + b.unit, inB = sumBy[k] || 0;
      if (x.qty < -0.0005) neg.push(x.name + ' (' + x.qty + ' ' + x.unit + ')');
      var d = b.qty - inB, rel = Math.max(Math.abs(b.qty), Math.abs(inB));
      if (Math.abs(d) > 0.5 && rel > 0 && Math.abs(d) / rel > 0.05) diff.push(x.name + ': остаток ' + _cfR3_(x.qty) + ' ' + x.unit + ', в партиях ' + _cfR3_(inB / (_toBaseUnitServer_(1, x.unit || 'г').qty || 1)) + ' ' + x.unit);
      if (x.qty > 0 && !(x.avgPrice > 0)) noPrice.push(x.name);
    });
    M.stockMismatch = diff.length;
    if (neg.length) add(A, 'HIGH', 'STOCK_NEGATIVE', 'Отрицательные остатки: ' + neg.length, neg.slice(0, 12).join('; '), 'Найти пропущенный приход или ошибку списания; провести ревизию позиции', { sec: 'revisions' });
    if (diff.length) add(A, diff.length > 10 ? 'HIGH' : 'MEDIUM', 'STOCK_MISMATCH', 'Остаток не сходится с партиями: ' + diff.length + ' поз.', diff.slice(0, 10).join('; '), 'Провести ревизию: фактический остаток, затем корректировка', { sec: 'revisions' });
    if (noPrice.length) add(A, 'MEDIUM', 'STOCK_NO_PRICE', 'Позиции без цены: ' + noPrice.length, noPrice.slice(0, 15).join(', '), 'Без цены себестоимость и food cost занижены: внесите цены по накладным', { module: 'prices' });
  });

  /* ---------- Продажи и меню ---------- */
  var pnl = null;
  safe('продажи', function () {
    var A = 'Продажи и меню', rows = _cfSalesRows_(per), posted = rows.filter(function (r) { return r.status !== 'CANCELLED'; });
    pnl = _cfPnl_(per); M.revenue = pnl.revenue; M.foodCost = pnl.foodCost; M.operating = pnl.operating;
    if (!posted.length) { add(A, 'HIGH', 'SALES_NONE', 'За ' + days + ' дн. нет ни одной продажи', 'Без продаж не считаются расход, задачи по остаткам и экономика', 'Вносить продажи каждый день («Продажи» → «Ввести продажи»)', { module: 'cafesale' }); return; }
    var dayHas = {}; posted.forEach(function (r) { dayHas[_cfYmd_(r.date)] = 1; });
    var off = String(PropertiesService.getScriptProperties().getProperty('MC_CAFE_DAYS_OFF') || '').split(/[ ,;]+/).map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x >= 0 && x <= 6; });
    // дни до первой продажи в системе не считаются (система ещё не работала)
    var first = null; _cfSalesRows_(null).forEach(function (r) { if (r.date && (!first || r.date < first)) first = r.date; });
    var gaps = [], from = first && first.getTime() > per.from.getTime() ? first : per.from;
    for (var d = new Date(from.getTime()); d.getTime() <= per.to.getTime(); d = new Date(d.getTime() + 864e5)) if (!dayHas[_cfYmd_(d)] && off.indexOf(d.getDay()) < 0 && d.getTime() < t0.getTime()) gaps.push(_cfRu_(d));
    M.daysWithoutSales = gaps.length;
    if (gaps.length) add(A, gaps.length > 3 ? 'HIGH' : 'MEDIUM', 'SALES_GAPS', 'Дни без внесённых продаж: ' + gaps.length, gaps.slice(0, 15).join(', ') + (off.length ? '' : ' (выходные дни задаются свойством MC_CAFE_DAYS_OFF, 0 — воскресенье)'), 'Внести продажи за эти дни (дата в форме ввода) или отметить выходные', { module: 'cafesale' });
    var gapsOpen = _cfGapsOpen_().filter(function (g) { return g.at instanceof Date ? _cfIn_(_cfDay_(g.at), per) : true; }), gapSum = gapsOpen.reduce(function (a, g) { return a + g.sum; }, 0);
    M.openGaps = gapsOpen.length;
    if (gapsOpen.length) add(A, 'HIGH', 'SALES_SHORTAGE', 'Продано больше, чем было на складе по учёту: ' + gapsOpen.length + ' расхожд.', gapsOpen.slice(0, 8).map(function (g) { return g.product + ' ' + g.qty + ' ' + g.unit; }).join('; '),
      'Разобрать: не внесён приход, недостача или неверная ТТК («Расхождения»)', { module: 'cafegaps' }, gapSum);
    var noTtk = {}, neg = {}, hiFc = {};
    posted.forEach(function (r) {
      if (r.kind !== 'dish') return;
      var dd = idx.dishByCode[r.code];
      if (!dd || !dd.ing || !dd.ing.length) noTtk[r.name] = 1;
      if (r.sum > 0 && r.cost > r.sum) neg[r.name] = 1;
      else if (r.sum > 0 && r.cost / r.sum * 100 > fcT * 1.3) hiFc[r.name] = 1;
    });
    if (Object.keys(noTtk).length) add(A, 'HIGH', 'MENU_NO_TTK', 'Продаются блюда без состава ТТК: ' + Object.keys(noTtk).length, Object.keys(noTtk).slice(0, 15).join(', '), 'Заполнить состав ТТК: без него продукты не списываются и себестоимость = 0', { sec: 'menu' });
    if (Object.keys(neg).length) add(A, 'CRITICAL', 'MENU_LOSS', 'Цена ниже себестоимости: ' + Object.keys(neg).length + ' поз.', Object.keys(neg).slice(0, 15).join(', '), 'Пересмотреть цену или ТТК (выход, продукты) — каждая продажа в убыток', { module: 'cafeprices' });
    if (Object.keys(hiFc).length) add(A, 'MEDIUM', 'MENU_HIGH_FC', 'Food cost позиции выше ' + Math.round(fcT * 1.3) + ' %: ' + Object.keys(hiFc).length, Object.keys(hiFc).slice(0, 15).join(', '), 'Поднять цену или снизить себестоимость (меню-инжиниринг: «рабочие лошадки»)', { sec: 'economics', tab: 2 });
    var dogs = (pnl.menu || []).filter(function (x) { return x.cls === 'Собака'; });
    if (dogs.length >= 3) add(A, 'LOW', 'MENU_DOGS', 'Позиции «собаки» (мало продаж и низкая маржа): ' + dogs.length, dogs.slice(0, 12).map(function (x) { return x.name; }).join(', '), 'Убрать из меню или переработать — они держат запасы п/ф и сырья', { sec: 'economics', tab: 2 });
    var cancelShare = pnl.revenue + pnl.cancelRevenue > 0 ? pnl.cancelRevenue / (pnl.revenue + pnl.cancelRevenue) * 100 : 0;
    M.cancelPct = Math.round(cancelShare * 10) / 10;
    if (cancelShare > 3) add(A, 'MEDIUM', 'SALES_CANCEL', 'Доля сторно ' + M.cancelPct + ' % (' + pnl.cancelCount + ')', 'Потери от сторно ' + pnl.lossCancel + ' ₽', 'Разобрать причины сторно: ошибки ввода, возвраты гостей, качество', { module: 'cafesale' }, pnl.lossCancel);
    var noPrice = Object.keys(idx.dishByCode).filter(function (c) { var x = idx.dishByCode[c]; return x && !x.semi; }).length, pr = _cfPrices_(), inPrice = Object.keys(pr).filter(function (k) { return pr[k].active; }).length;
    if (!inPrice) add(A, 'MEDIUM', 'PRICE_EMPTY', 'Прайс кафе не заполнен', 'В меню ' + noPrice + ' блюд, в прайсе — 0', 'Заполнить прайс: цены подставятся в ввод продаж', { module: 'cafeprices' });
  });

  /* ---------- Экономика ---------- */
  safe('экономика', function () {
    var A = 'Экономика'; if (!pnl) pnl = _cfPnl_(per);
    if (pnl.revenue > 0 && pnl.foodCost > fcT) add(A, pnl.foodCost > fcT + 10 ? 'HIGH' : 'MEDIUM', 'FOOD_COST', 'Food cost ' + pnl.foodCost + ' % при цели ' + fcT + ' %', 'Себестоимость ' + pnl.cogs + ' ₽ при выручке ' + pnl.revenue + ' ₽',
      'Проверить цены закупки, выход по ТТК, порционирование; пересмотреть цены позиций с высоким food cost', { sec: 'economics', tab: 2 }, pnl.cogs - pnl.revenue * fcT / 100);
    var woPct = pnl.revenue > 0 ? pnl.writeOffs.total / pnl.revenue * 100 : 0; M.writeOffPct = Math.round(woPct * 10) / 10;
    if (pnl.revenue > 0 && woPct > 2) add(A, woPct > 5 ? 'HIGH' : 'MEDIUM', 'WRITE_OFFS', 'Списания ' + M.writeOffPct + ' % выручки', Object.keys(pnl.writeOffs.byReason).map(function (k) { return k + ': ' + pnl.writeOffs.byReason[k] + ' ₽'; }).join('; '),
      'Снизить потери: нормы остатков п/ф, FEFO, заказ под расход', { sec: 'cafeplan' }, pnl.writeOffs.total);
    if (pnl.revenue > 0 && pnl.operating < 0) add(A, 'CRITICAL', 'LOSS', 'Операционный убыток ' + pnl.operating + ' ₽ за ' + days + ' дн.', 'Выручка ' + pnl.revenue + ' ₽, точка безубыточности ' + (pnl.breakEven === null ? '—' : pnl.breakEven + ' ₽'),
      'Разобрать структуру расходов и меню; план действий по выручке и затратам', { sec: 'economics', tab: 0 }, -pnl.operating);
    var over = pnl.planVsFact.filter(function (x) { return x.plan > 0 && x.fact > x.plan * 1.1; });
    if (over.length) add(A, 'MEDIUM', 'OPEX_OVER', 'Перерасход по статьям: ' + over.length, over.slice(0, 10).map(function (x) { return x.article + ' ' + x.pct + ' %'; }).join('; '), 'Разобрать причины перерасхода и согласовать план', { sec: 'economics', tab: 1 },
      over.reduce(function (a, x) { return a + x.diff; }, 0));
    var exps = _cfExpenses_(per).filter(function (e) { return e.status !== 'CANCELLED'; }), noDoc = exps.filter(function (e) { return !e.doc; });
    M.expenses = exps.length;
    if (noDoc.length) add(A, 'LOW', 'OPEX_NO_DOC', 'Расходы без документа-основания: ' + noDoc.length, noDoc.slice(0, 10).map(function (e) { return e.id + ' ' + e.article + ' ' + e.sum + ' ₽'; }).join('; '), 'Приложить номер чека, акта или счёта', { module: 'cafeexpenses' },
      noDoc.reduce(function (a, e) { return a + e.sum; }, 0));
    if (!exps.length) add(A, 'MEDIUM', 'OPEX_NONE', 'За ' + days + ' дн. не внесено ни одного расхода', 'Прибыль без расходов завышена', 'Вносить расходы по статьям («Экономика» → «+ Расход»)', { module: 'cafeexpenses' });
    else if (t0.getDate() >= 10) {
      var monthPer = _cfPeriod_({ from: new Date(t0.getFullYear(), t0.getMonth(), 1), to: t0 }), had = {};
      _cfExpenses_(monthPer).forEach(function (e) { if (e.status !== 'CANCELLED') had[e.code] = 1; });
      var miss = _cfArticles_().filter(function (a) { return a.active && a.type === 'постоянные' && a.plan > 0 && !had[a.code]; });
      if (miss.length) add(A, 'LOW', 'OPEX_FIXED_MISSING', 'Постоянные статьи без расходов в этом месяце: ' + miss.length, miss.map(function (a) { return a.name; }).join(', '), 'Проверить, не пропущены ли оплаты (аренда, ФОТ, коммунальные)', { module: 'cafeexpenses' });
    }
  });

  /* ---------- Задачи и планирование ---------- */
  safe('задачи', function () {
    var A = 'Задачи и планирование'; setupV44TaskCenter();
    var open = _v44Rows_(V44_TASK.TASK).filter(function (t) { return ['PLANNED', 'READY', 'IN_PROGRESS', 'OVERDUE'].indexOf(String(t.Status)) >= 0; });
    var overdue = open.filter(function (t) { return t.DueAt instanceof Date && t.DueAt.getTime() < now.getTime() - 3600000; });
    M.tasksOpen = open.length; M.tasksOverdue = overdue.length;
    if (overdue.length) add(A, overdue.length > 10 ? 'HIGH' : 'MEDIUM', 'TASKS_OVERDUE', 'Просроченные задачи: ' + overdue.length, overdue.slice(0, 10).map(function (t) { return String(t.Title); }).join('; '), 'Выполнить или закрыть с отклонением и причиной', { module: 'tasks' });
    var st = _cfStockState_({ idx: idx }), zero = st.items.filter(function (x) { return x.type === 'ПФ' && x.status === 'нет в наличии'; }), low = st.items.filter(function (x) { return x.status === 'ниже минимума'; });
    M.pfZero = zero.length; M.belowMin = low.length + zero.length;
    if (zero.length) add(A, 'HIGH', 'PF_ZERO', 'П/ф с расходом, которых нет в наличии: ' + zero.length, zero.slice(0, 12).map(function (x) { return x.name; }).join(', '), 'Приготовить по задачам «План по остаткам»; при частой нехватке — поднять норму', { sec: 'cafeplan' });
    if (low.length > 5) add(A, 'MEDIUM', 'STOCK_LOW', 'Позиции ниже минимума: ' + low.length, low.slice(0, 12).map(function (x) { return x.name; }).join(', '), 'Закупка и заготовка по задачам; проверить нормы', { sec: 'cafeplan' });
    var surplus = st.items.filter(function (x) { return x.status === 'излишек'; });
    if (surplus.length > 5) add(A, 'LOW', 'STOCK_SURPLUS', 'Излишки (запас больше трёх целевых): ' + surplus.length, surplus.slice(0, 12).map(function (x) { return x.name; }).join(', '), 'Сократить закупку: деньги заморожены в запасах, растёт риск списаний', { sec: 'cafeplan', tab: 1 });
  });

  /* ---------- ХАССП и персонал ---------- */
  safe('ХАССП', function () {
    var A = 'ХАССП и персонал', r = _mcReadinessCached_();
    if (!r || !r.items) return;
    M.haccpOverall = r.overall;
    r.items.forEach(function (x) {
      if (x.status !== 'FAIL' && x.status !== 'MISSING_EVIDENCE') return;
      add(A, x.blocking ? 'HIGH' : 'MEDIUM', 'HACCP_' + String(x.id || x.area || '').replace(/\W+/g, '_').slice(0, 30), (x.area || 'ХАССП') + ': ' + (x.requirement || ''), x.detail || '', x.correctiveAction || 'Открыть и устранить', x.go || { sec: 'inspection' });
    });
  });

  /* ---------- Целостность учёта ---------- */
  safe('целостность', function () {
    var A = 'Целостность учёта';
    if (typeof _mcBlChainOk_ === 'function') { var c = _mcBlChainOk_(); if (c && c.ok === false) add(A, 'CRITICAL', 'CHAIN_BATCH', 'Нарушена цепочка истории партий (строка ' + c.row + ')', 'Запись в «Партии_События» изменена вручную', 'Восстановить лист из резервной копии; разобрать, кто правил таблицу (Audit_Log)', { sec: 'settings' }); }
    var sh = _book_().getSheetByName(MC_CF_SALES_);
    if (sh && sh.getLastRow() > 1) {
      var v = sh.getDataRange().getValues(), bad = 0;
      for (var i = 1; i < v.length; i++) { var r = v[i]; if (!r[0]) continue; if (Math.abs((Number(r[9]) || 0) * (Number(r[11]) || 0) - (Number(r[12]) || 0) - (Number(r[13]) || 0)) > 0.02 && Number(r[13]) !== 0) bad++; }
      if (bad) add(A, 'HIGH', 'SALES_EDITED', 'Строки продаж с несходящейся суммой: ' + bad, 'Количество × цена − скидка ≠ сумма — похоже на ручную правку листа «' + MC_CF_SALES_ + '»', 'Исправлять только сторно и новой продажей; проверить Audit_Log', { sec: 'cafesales' });
    }
  });

  // баллы
  var areas = {};
  MC_CF_AREAS_.forEach(function (a) { areas[a] = 100; });
  F.forEach(function (f) { areas[f.area] = Math.max(0, (areas[f.area] === undefined ? 100 : areas[f.area]) - MC_CF_SEV_[f.sev].w); });
  var keys = Object.keys(areas), score = Math.round(keys.reduce(function (a, k) { return a + areas[k]; }, 0) / keys.length);
  var po = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  F.sort(function (a, b) { return (po[a.sev] - po[b.sev]) || a.area.localeCompare(b.area, 'ru'); });
  return { at: now, days: days, period: { from: per.fromIso, to: per.toIso }, who: who || 'Система', score: score, grade: score >= 85 ? 'Хорошо' : score >= 70 ? 'Удовлетворительно' : 'Требует мер',
    areas: keys.map(function (k) { return { area: k, score: areas[k], findings: F.filter(function (f) { return f.area === k; }).length }; }), findings: F, metrics: M,
    critical: F.filter(function (f) { return f.sev === 'CRITICAL'; }).length, high: F.filter(function (f) { return f.sev === 'HIGH'; }).length };
}

function _cfAuditSave_(r, opId) {
  var sh = _cfSheet_(MC_CF_AUD_, MC_CF_AUD_HEAD_), id = 'АУД-' + Utilities.formatDate(r.at, _mcTz_(), 'yyyyMMdd-HHmmss');
  sh.appendRow([id, r.at, r.days, r.who, r.score, r.grade, r.findings.length, r.critical, r.high, JSON.stringify(r.areas), JSON.stringify(r.findings).slice(0, 45000), JSON.stringify(r.metrics).slice(0, 5000), opId || '']);
  return id;
}
function _cfAuditHistory_(limit) {
  var v = _cfSheet_(MC_CF_AUD_, MC_CF_AUD_HEAD_).getDataRange().getValues(), out = [];
  for (var i = v.length - 1; i >= 1 && out.length < (limit || 20); i--) {
    var r = v[i]; if (!r[0]) continue;
    out.push({ runId: String(r[0]), at: r[1] instanceof Date ? Utilities.formatDate(r[1], _mcTz_(), 'dd.MM.yyyy HH:mm') : String(r[1]), days: r[2], who: String(r[3] || ''), score: Number(r[4]) || 0, grade: String(r[5] || ''),
      findings: Number(r[6]) || 0, critical: Number(r[7]) || 0, high: Number(r[8]) || 0, row: i });
  }
  return out;
}
function _cfAuditLast_() {
  var sh = _cfSheet_(MC_CF_AUD_, MC_CF_AUD_HEAD_); if (sh.getLastRow() < 2) return null;
  var r = sh.getRange(sh.getLastRow(), 1, 1, MC_CF_AUD_HEAD_.length).getValues()[0], j = function (x) { try { return JSON.parse(String(x || 'null')); } catch (e) { return null; } };
  return { runId: String(r[0]), at: r[1] instanceof Date ? Utilities.formatDate(r[1], _mcTz_(), 'dd.MM.yyyy HH:mm') : String(r[1]), days: r[2], who: String(r[3] || ''), score: Number(r[4]) || 0, grade: String(r[5] || ''),
    critical: Number(r[7]) || 0, high: Number(r[8]) || 0, areas: j(r[9]) || [], findings: j(r[10]) || [], metrics: j(r[11]) || {} };
}

/** Задачи по критичным и высоким находкам (CAPA): одна задача на находку и прогон. */
function _cfAuditTasks_(r, runId) {
  setupV44TaskCenter();
  // одна задача на находку в неделю: повторный аудит (в том числе еженедельный) не размножает задачи, а обновляет их
  var n = 0, now = _mcNow_(), week = Utilities.formatDate(now, _mcTz_(), 'yyyy') + '-W' + ('0' + Math.ceil(((now - new Date(now.getFullYear(), 0, 1)) / 864e5 + new Date(now.getFullYear(), 0, 1).getDay() + 1) / 7)).slice(-2);
  r.findings.filter(function (f) { return f.sev === 'CRITICAL' || f.sev === 'HIGH'; }).forEach(function (f) {
    _v44UpsertTask_({ sourceType: 'CAFE_AUDIT', sourceId: f.code + '|' + week, title: 'Аудит: ' + f.title, description: (f.detail ? f.detail + '. ' : '') + 'Что сделать: ' + f.todo,
      taskType: 'AUDIT_CAPA', dueAt: new Date(now.getTime() + (f.sev === 'CRITICAL' ? 1 : 3) * 864e5), priority: f.sev === 'CRITICAL' ? 'CRITICAL' : 'HIGH', role: 'Директор', createdBy: 'Аудит предприятия', notes: 'Раздел: ' + f.area + '; аудит ' + runId });
    n++;
  });
  return n;
}

/** Запустить аудит. json: {days, tasks} */
function mcCafeAuditRun(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'ent_audit', 'CAFE_AUDIT_RUN', 'Аудит предприятия', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, days = Math.max(1, Math.min(92, parseInt(d.days, 10) || 30)), who = _author_(op).фио || 'Технический доступ';
    var r = _cfAudit_(days, who);
    return _withLock_(function () {
      var id = _cfAuditSave_(r, op.id), tasks = d.tasks ? _cfAuditTasks_(r, id) : 0;
      _audit_(op, 'CAFE_AUDIT_RUN', 'Аудит предприятия', id, null, { балл: r.score, оценка: r.grade, находок: r.findings.length, критичных: r.critical, высоких: r.high, задач: tasks });
      _endOp_(op);
      var prev = _cfAuditHistory_(2)[1] || null;
      return _ok_({ runId: id, at: Utilities.formatDate(r.at, _mcTz_(), 'dd.MM.yyyy HH:mm'), days: r.days, period: r.period, score: r.score, grade: r.grade, areas: r.areas, findings: r.findings,
        metrics: r.metrics, critical: r.critical, high: r.high, tasks: tasks, prevScore: prev ? prev.score : null }, op.id);
    });
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Экран аудита: последний прогон и история. */
function mcCafeAuditData(token) {
  var s;
  try { s = _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try { return _ok_({ last: _cfAuditLast_(), history: _cfAuditHistory_(30), canRun: _mcRbHasExact_(s, 'ent_audit') }); } catch (e) { return _failFrom_(e); }
}
/** Расписание: еженедельный аудит (понедельник 7:00) с задачами по критичным находкам. */
function cafeAutoAuditSystem() {
  if (!_cafeOn_()) return 'off';
  var r = _cfAudit_(7, 'Система (еженедельно)');
  return _withLock_(function () { var id = _cfAuditSave_(r, ''); var n = _cfAuditTasks_(r, id); return { runId: id, score: r.score, tasks: n }; });
}

_UI_BUILDERS_.entaudit = function (token, opts, s) {
  var last = _cfAuditLast_(), hist = _cfAuditHistory_(12);
  var gone = function (f) { return f.go && f.go.sec ? f.go : null; };
  return {
    title: 'Аудит предприятия', subtitle: 'Внутренний аудит по записям системы: склад и партии, продажи и меню, экономика, задачи, ХАССП и персонал, целостность учёта. Еженедельно — автоматически (понедельник 7:00).',
    kpis: last ? [{ label: 'Балл', value: last.score, hint: last.grade + ' · ' + last.at, tone: last.score >= 85 ? 'green' : last.score >= 70 ? 'gold' : 'red' },
      { label: 'Критичных', value: last.critical, tone: last.critical ? 'red' : 'green' }, { label: 'Высоких', value: last.high, tone: last.high ? 'red' : 'green' },
      { label: 'Находок всего', value: (last.findings || []).length }] : [{ label: 'Аудит', value: 'не проводился', hint: 'запустите первый аудит', tone: 'gold' }],
    tabs: [
      { title: 'Находки', columns: [_uiCol_('sev', 'Важность', 'status'), _uiCol_('area', 'Раздел'), _uiCol_('title', 'Находка'), _uiCol_('todo', 'Что сделать'), _uiCol_('sum', 'Сумма, ₽', 'num')],
        rows: last ? (last.findings || []).map(function (f) { return { sev: f.sevRu, area: f.area, title: f.title + (f.detail ? ' — ' + f.detail : ''), todo: f.todo, sum: f.sum === null ? '' : f.sum, _go: gone(f) }; }) : [] },
      { title: 'Разделы', columns: [_uiCol_('area', 'Раздел'), _uiCol_('score', 'Балл', 'pct'), _uiCol_('findings', 'Находок', 'num')], rows: last ? last.areas : [] },
      { title: 'История', columns: [_uiCol_('at', 'Когда'), _uiCol_('who', 'Кто'), _uiCol_('days', 'Период, дн.', 'num'), _uiCol_('score', 'Балл', 'pct'), _uiCol_('grade', 'Оценка', 'status'), _uiCol_('critical', 'Критичных', 'num'), _uiCol_('high', 'Высоких', 'num')], rows: hist }
    ],
    actions: [{ label: '▶ Провести аудит', module: 'cafeaudit' }]
  };
};
