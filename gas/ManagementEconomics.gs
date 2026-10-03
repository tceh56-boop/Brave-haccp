// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — ManagementEconomics.gs
 * Этап 19 — управленческая экономика и Loss Engine.
 *
 * Цель: не заменять бухгалтерию, а замкнуть операционные факты в один контур
 * управления: выручка → COGS → списания/потери → OPEX → Prime Cost → результат.
 * Все показатели вычисляются из первичных таблиц; отдельные итоговые значения
 * руками не хранятся.
 */

function _meDate_(v) { return v ? String(v).slice(0, 10) : ''; }
function _meInPeriod_(value, from, to) {
  var d = _meDate_(value);
  return (!from || d >= from) && (!to || d <= to);
}
function _meScope_(row, organizationId, locationId) {
  if (!row || row.organization_id !== organizationId) return false;
  return !locationId || !row.location_id || row.location_id === locationId;
}
function _meSum_(rows, field) {
  return round2_(rows.reduce(function(s, r) { return s + (Number(r[field]) || 0); }, 0));
}

/** Полная управленческая экономика за период. */
function getManagementEconomics_(organizationId, locationId, dateFrom, dateTo) {
  var sales = getSales_(organizationId, locationId, dateFrom, dateTo);
  var revenue = _meSum_(sales, 'сумма');
  var cogs = _meSum_(sales, 'себестоимость_на_момент');

  var writeoffs = findRows_('WRITE_OFFS', function(r) {
    return _meScope_(r, organizationId, locationId) && _meInPeriod_(r.дата, dateFrom, dateTo);
  });
  var writeoffCost = _meSum_(writeoffs, 'сумма');

  var expensesInfo = (dateFrom && dateTo)
    ? calcExpensesForPeriod_(organizationId, locationId, dateFrom, dateTo)
    : { всего: 0, детально: [] };
  var expenses = Number(expensesInfo.всего) || 0;

  // ФОТ выделяем из управленческих расходов по прозрачному правилу категорий.
  var labor = round2_(expensesInfo.детально.reduce(function(s, x) {
    var c = String(x.категория || '').toLowerCase();
    return s + (/(зарп|зп|фот|оплата труда|персонал|страхов)/.test(c) ? Number(x.сумма_за_период || 0) : 0);
  }, 0));

  var grossProfit = revenue - cogs;
  var primeCost = cogs + labor + writeoffCost;
  var operatingProfit = grossProfit - expenses - writeoffCost;

  var stockValue = 0;
  getProducts_(organizationId).forEach(function(p) {
    if (locationId) {
      stockValue += getStockLevel_(p.product_id, locationId) * (Number(p.текущая_цена) || 0);
    } else {
      uniqueLocationsForProduct_(p.product_id).forEach(function(loc) {
        stockValue += getStockLevel_(p.product_id, loc) * (Number(p.текущая_цена) || 0);
      });
    }
  });

  return {
    период: { с: dateFrom || '', по: dateTo || '' },
    выручка: round2_(revenue),
    себестоимость_проданного: round2_(cogs),
    валовая_прибыль: round2_(grossProfit),
    валовая_маржа_pct: revenue > 0 ? round2_(grossProfit / revenue * 100) : 0,
    списания: round2_(writeoffCost),
    операционные_расходы: round2_(expenses),
    фонд_оплаты_труда: labor,
    prime_cost: primeCost,
    prime_cost_pct: revenue > 0 ? round2_(primeCost / revenue * 100) : 0,
    операционная_прибыль: round2_(operatingProfit),
    операционная_маржа_pct: revenue > 0 ? round2_(operatingProfit / revenue * 100) : 0,
    стоимость_склада: round2_(stockValue),
    количество_продаж: sales.length,
    количество_позиций: round2_(sales.reduce(function(s, x) { return s + (Number(x.qty) || 0); }, 0)),
    расходы_детально: expensesInfo.детально,
    методика: dateFrom && dateTo
      ? 'Управленческий расчёт. Ежемесячные расходы распределяются calcExpensesForPeriod_; это не регламентированный бухгалтерский P&L.'
      : 'Без полного периода операционные расходы не распределены; для точного управленческого периода передайте dateFrom и dateTo.'
  };
}

/** Loss Engine: денежные потери по списаниям и отклонениям выхода. */
function getLossEngine_(organizationId, locationId, dateFrom, dateTo) {
  var writeoffs = findRows_('WRITE_OFFS', function(r) {
    return _meScope_(r, organizationId, locationId) && _meInPeriod_(r.дата, dateFrom, dateTo);
  });
  var yieldDeviations = findRows_('PRODUCTION_YIELD_DEVIATIONS', function(r) {
    return _meScope_(r, organizationId, locationId) && _meInPeriod_(r.created_at, dateFrom, dateTo);
  });

  var byReason = {};
  writeoffs.forEach(function(w) {
    var key = String(w.причина || w.reason_id || 'не указана');
    if (!byReason[key]) byReason[key] = { причина: key, сумма: 0, количество: 0 };
    byReason[key].сумма += Number(w.сумма) || 0;
    byReason[key].количество++;
  });

  var deviationAbs = yieldDeviations.reduce(function(s, r) { return s + Math.abs(Number(r.deviation_qty) || 0); }, 0);
  var critical = yieldDeviations.filter(function(r) { return r.level === 'КРИТИЧЕСКОЕ'; }).length;
  var openCorrective = yieldDeviations.filter(function(r) { return r.status === 'OPEN'; }).length;

  var reasons = Object.keys(byReason).map(function(k) {
    byReason[k].сумма = round2_(byReason[k].сумма);
    return byReason[k];
  }).sort(function(a,b) { return b.сумма - a.сумма; });

  return {
    период: { с: dateFrom || '', по: dateTo || '' },
    списания: { сумма: round2_(_meSum_(writeoffs, 'сумма')), количество: writeoffs.length },
    списания_по_причинам: reasons,
    отклонения_выхода: {
      количество: yieldDeviations.length,
      критические: critical,
      открытые: openCorrective,
      абсолютное_отклонение_количества: round2_(deviationAbs)
    },
    топ_потерь: reasons.slice(0, 10),
    примечание: 'Денежная оценка производственных отклонений требует фактической цены партии; поэтому в этом слое количественное отклонение не превращается в выдуманную сумму.'
  };
}

/**
 * Возвращает только управленческие сигналы — не рейтинг и не прогноз.
 * Это список фактов, требующих проверки ответственным сотрудником.
 */
function getManagementActions_(organizationId, locationId, dateFrom, dateTo) {
  var eco = getManagementEconomics_(organizationId, locationId, dateFrom, dateTo);
  var loss = getLossEngine_(organizationId, locationId, dateFrom, dateTo);
  var actions = [];

  if (eco.prime_cost_pct > 70) actions.push({ code: 'PRIME_COST_HIGH', severity: 'HIGH', title: 'Высокая Prime Cost', value: eco.prime_cost_pct, action: 'Проверить себестоимость, ФОТ и списания по периоду.' });
  if (eco.списания > 0 && eco.выручка > 0 && eco.списания / eco.выручка * 100 > 3) actions.push({ code: 'WRITEOFF_RATE_HIGH', severity: 'HIGH', title: 'Списания выше 3% выручки', value: round2_(eco.списания / eco.выручка * 100), action: 'Разобрать причины списаний и проверить FEFO/план производства.' });
  if (loss.отклонения_выхода.критические > 0) actions.push({ code: 'YIELD_CRITICAL', severity: 'CRITICAL', title: 'Есть критические отклонения выхода', value: loss.отклонения_выхода.критические, action: 'Закрыть корректирующие действия и проверить технологию/фактический выход.' });
  if (loss.отклонения_выхода.открытые > 0) actions.push({ code: 'CORRECTIVE_OPEN', severity: 'HIGH', title: 'Открыты корректирующие действия', value: loss.отклонения_выхода.открытые, action: 'Назначить ответственного и закрыть доказательством устранения.' });
  if (eco.валовая_маржа_pct < 55 && eco.выручка > 0) actions.push({ code: 'GROSS_MARGIN_LOW', severity: 'MEDIUM', title: 'Валовая маржа ниже 55%', value: eco.валовая_маржа_pct, action: 'Проверить закупочные цены и фактическую себестоимость продаваемых блюд.' });

  return { generated_at: nowIso_(), actions: actions, экономика: eco, потери: loss };
}

/** Ежедневный контур: только уведомляет о фактах, ничего автоматически не списывает и не меняет. */
function managementEconomicsTrigger_() {
  try {
    getOrganizations_().forEach(function(org) {
      getLocations_(org.organization_id).forEach(function(loc) {
        var today = todayDateStr_();
        var data = getManagementActions_(org.organization_id, loc.location_id, today, today);
        data.actions.forEach(function(a) {
          notify_(org.organization_id, loc.location_id, 'MANAGEMENT_ECONOMICS', a.title + ': ' + a.action + ' Значение: ' + a.value, 'mgmt|' + today + '|' + loc.location_id + '|' + a.code);
        });
      });
    });
  } catch (err) {
    logSystemError_('managementEconomicsTrigger_', null, 'management_economics', err);
  }
}
