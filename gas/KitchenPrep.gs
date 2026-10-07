// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — KitchenPrep.gs (волна 3, M9): заготовочный лист смены.
 *
 * Шеф задаёт норму запаса полуфабриката на начало смены (PREP_PARS). На дату система
 * прогнозирует продажи блюд по тому же дню недели за последние 4 недели (если в эти дни
 * продаж не было — по среднему за 28 дней), раскладывает блюда по ТТК до полуфабрикатов
 * и считает: к заготовке = прогноз + норма − годный остаток (FEFO, без просрочки).
 * Повар отмечает «Сделано» с фактическим количеством — это обычная задача производства
 * (Production.gs): сырьё списывается, партия ПФ приходуется и маркируется.
 *
 * Количество ПФ — в его единице (кг/л/шт); рецепт ПФ задан на 1 единицу (как в Production.gs).
 */

var PREP_WEEKS_ = 4;

function _prepNum_(v) { var n = Number(v); return isFinite(n) ? n : 0; }

function _prepAssertDate_(date) {
  var d = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Дата должна быть в формате ГГГГ-ММ-ДД.');
  return d;
}

/** Порции блюд на дату: среднее по тому же дню недели за 4 недели, иначе среднее за 28 дней. */
function _prepDishForecast_(session, date) {
  var from = _dpAddDays_(date, -7 * PREP_WEEKS_), to = _dpAddDays_(date, -1);
  var sameDays = {};
  for (var w = 1; w <= PREP_WEEKS_; w++) sameDays[_dpAddDays_(date, -7 * w)] = true;
  var byDish = {};
  getSales_(session.organization_id, session.location_id, from, to).forEach(function (s) {
    var day = String(s.дата || '').slice(0, 10);
    if (!s.dish_id || day < from || day > to) return;
    var d = byDish[s.dish_id] || (byDish[s.dish_id] = { all: 0, same: 0 });
    var q = _prepNum_(s.qty);
    d.all += q;
    if (sameDays[day]) d.same += q;
  });
  var out = {};
  Object.keys(byDish).forEach(function (id) {
    var d = byDish[id];
    var portions = d.same > 0 ? d.same / PREP_WEEKS_ : d.all / (7 * PREP_WEEKS_);
    if (portions > 0) out[id] = { portions: portions, method: d.same > 0 ? 'день_недели' : 'среднее' };
  });
  return out;
}

/** Потребность в ПФ (в его единицах) на qty родителя; вложенные ПФ учитываются (до 5 уровней). */
function _prepAddPfNeed_(parentType, parentId, qty, needs, depth) {
  if (depth > 5 || qty <= 0) return;
  getRecipeLines_(parentType, parentId).forEach(function (line) {
    if (String(line.product_id).indexOf('PF-') !== 0) return;
    var q = normalizeQty_(_prepNum_(line.брутто), line.единица) * qty;
    if (q <= 0) return;
    needs[line.product_id] = (needs[line.product_id] || 0) + q;
    _prepAddPfNeed_('PF', line.product_id, q, needs, depth + 1);
  });
}

function _prepPars_(session) {
  var pars = {};
  findRows_('PREP_PARS', function (r) {
    return r.organization_id === session.organization_id && r.location_id === session.location_id && r.статус !== 'архив';
  }).forEach(function (r) { pars[r.pf_id] = r; });
  return pars;
}

/** Расчёт листа на дату без записи. */
function _prepCompute_(session, date) {
  var forecast = _prepDishForecast_(session, date);
  var needs = {};
  Object.keys(forecast).forEach(function (dishId) { _prepAddPfNeed_('DISH', dishId, forecast[dishId].portions, needs, 0); });
  var pars = _prepPars_(session);
  var ids = {};
  Object.keys(needs).concat(Object.keys(pars)).forEach(function (id) { ids[id] = true; });
  return Object.keys(ids).map(function (pfId) {
    var pf = getSemiFinishedById_(pfId);
    if (!pf || pf.organization_id !== session.organization_id) return null;
    var need = round2_(needs[pfId] || 0), par = round2_(_prepNum_(pars[pfId] && pars[pfId].норма));
    var stock = _dpFefoStock_(pfId, session.location_id, date).qty;
    return { pf_id: pfId, название: pf.название, единица: pf.единица || 'кг', прогноз: need, норма: par, остаток: round2_(stock),
      к_заготовке: round2_(Math.max(0, need + par - stock)) };
  }).filter(Boolean).sort(function (a, b) { return b.к_заготовке - a.к_заготовке || String(a.название).localeCompare(String(b.название)); });
}

function _prepRows_(session, date) {
  return findRows_('PREP_LISTS', function (r) {
    return r.organization_id === session.organization_id && r.location_id === session.location_id && String(r.дата).slice(0, 10) === date;
  });
}

/** Лист на дату: сохранённый (если сформирован) или предварительный расчёт. */
function prepGetList_(data, session) {
  var date = data.date ? _prepAssertDate_(data.date) : todayDateStr_();
  var saved = _prepRows_(session, date);
  if (saved.length) {
    return { date: date, сформирован: true, rows: saved.map(function (r) {
      return { prep_id: r.prep_id, pf_id: r.pf_id, название: r.название, единица: r.единица, прогноз: _prepNum_(r.прогноз), норма: _prepNum_(r.норма),
        остаток: _prepNum_(r.остаток), к_заготовке: _prepNum_(r.к_заготовке), сделано: _prepNum_(r.сделано), статус: r.статус, production_id: r.production_id };
    }).sort(function (a, b) { return (a.статус === 'сделано') - (b.статус === 'сделано') || b.к_заготовке - a.к_заготовке; }) };
  }
  return { date: date, сформирован: false, rows: _prepCompute_(session, date) };
}

/** Формирует (или пересчитывает) лист: строки «сделано» не трогает, остальные обновляет. */
function prepBuildList_(data, session) {
  var date = data.date ? _prepAssertDate_(data.date) : todayDateStr_();
  return withLock_(function () {
    var existing = {};
    _prepRows_(session, date).forEach(function (r) { existing[r.pf_id] = r; });
    var created = 0, updated = 0;
    _prepCompute_(session, date).forEach(function (c) {
      var r = existing[c.pf_id];
      var fields = { название: c.название, единица: c.единица, прогноз: c.прогноз, норма: c.норма, остаток: c.остаток, к_заготовке: c.к_заготовке, обновлено: nowIso_() };
      if (r) {
        if (r.статус === 'сделано') return;
        updateRow_('PREP_LISTS', r, fields); updated++;
      } else {
        if (c.к_заготовке <= 0) return;
        fields.prep_id = generateId_('PREP_LISTS'); fields.organization_id = session.organization_id; fields.location_id = session.location_id;
        fields.дата = date; fields.pf_id = c.pf_id; fields.сделано = 0; fields.статус = 'к_заготовке'; fields.user_id = session.user_id; fields.production_id = '';
        insertRow_('PREP_LISTS', fields); created++;
      }
    });
    auditLog_(session.user_id, 'Заготовочный лист сформирован', 'PREP_LISTS:' + date, null, created + '/' + updated, 'success', session.cascade_id || '');
    var res = prepGetList_({ date: date }, session);
    res.создано = created; res.обновлено = updated;
    return res;
  });
}

/** «Сделано»: задача производства ПФ сразу в «готово» — списание сырья и партия ПФ с маркировкой. */
function prepMarkDone_(data, session) {
  return withLock_(function () {
    var row = findOne_('PREP_LISTS', 'prep_id', data.prepId);
    assertOwnedByOrg_(session, row, 'PREP_LISTS:' + data.prepId);
    if (row.location_id !== session.location_id) throw new Error('Строка относится к другой точке.');
    if (row.статус === 'сделано') throw new Error('Заготовка «' + row.название + '» уже отмечена.');
    var qty = round2_(_prepNum_(data.qty));
    if (!(qty > 0)) throw new Error('Укажите сколько заготовлено (больше нуля).');
    var pf = getSemiFinishedById_(row.pf_id);
    var task = createProductionTask_(session.location_id, 'PF', row.pf_id, qty, session.user_id, pf ? pf.workshop_id : '', session);
    var result;
    try {
      result = advanceProductionStatus_(task.production_id, 'готово', session);
    } catch (e) {
      advanceProductionStatus_(task.production_id, 'отменено', session);
      throw e;
    }
    updateRow_('PREP_LISTS', row, { сделано: qty, статус: 'сделано', production_id: task.production_id, user_id: session.user_id, обновлено: nowIso_() });
    var done = findOne_('PRODUCTION', 'production_id', task.production_id);
    return { prep_id: row.prep_id, сделано: qty, production_id: task.production_id, batch_id: done ? done.batch_id : '', статус: result.статус };
  });
}

function prepSkip_(data, session) {
  return withLock_(function () {
    var row = findOne_('PREP_LISTS', 'prep_id', data.prepId);
    assertOwnedByOrg_(session, row, 'PREP_LISTS:' + data.prepId);
    if (row.location_id !== session.location_id) throw new Error('Строка относится к другой точке.');
    if (row.статус === 'сделано') throw new Error('Заготовка уже сделана.');
    updateRow_('PREP_LISTS', row, { статус: row.статус === 'пропущено' ? 'к_заготовке' : 'пропущено', user_id: session.user_id, обновлено: nowIso_() });
    return { prep_id: row.prep_id, статус: row.статус === 'пропущено' ? 'к_заготовке' : 'пропущено' };
  });
}

/** Нормы: все ПФ организации с текущей нормой точки. */
function prepGetPars_(session) {
  var pars = _prepPars_(session);
  return getSemiFinishedList_(session.organization_id).map(function (pf) {
    return { pf_id: pf.pf_id, название: pf.название, единица: pf.единица || 'кг', норма: pars[pf.pf_id] ? _prepNum_(pars[pf.pf_id].норма) : 0 };
  }).sort(function (a, b) { return String(a.название).localeCompare(String(b.название)); });
}

function prepSavePar_(data, session) {
  return withLock_(function () {
    var pf = getSemiFinishedById_(data.pfId);
    assertOwnedByOrg_(session, pf, 'SEMI_FINISHED:' + data.pfId);
    var norm = Number(data.норма);
    if (!isFinite(norm) || norm < 0) throw new Error('Норма должна быть числом не меньше нуля.');
    norm = round2_(norm);
    var cur = _prepPars_(session)[pf.pf_id];
    if (cur) {
      updateRow_('PREP_PARS', cur, { норма: norm, обновлено: nowIso_(), user_id: session.user_id });
    } else {
      insertRow_('PREP_PARS', { par_id: generateId_('PREP_PARS'), organization_id: session.organization_id, location_id: session.location_id,
        pf_id: pf.pf_id, норма: norm, статус: 'активна', обновлено: nowIso_(), user_id: session.user_id });
    }
    auditLog_(session.user_id, 'Норма заготовки', 'SEMI_FINISHED:' + pf.pf_id, cur ? cur.норма : null, norm, 'success', session.cascade_id || '');
    return { pf_id: pf.pf_id, норма: norm };
  });
}
