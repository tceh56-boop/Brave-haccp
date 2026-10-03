// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — SalesAnalytics.gs
 * Раунд 11 — настоящий P&L и ABC-анализ по продажам, впервые в проекте возможные
 * благодаря Sales.gs (модель продаж, построенная по прямому запросу Дениса
 * "Реализуй все три направления" в ответ на честно указанный в отчёте раунда 10
 * пробел). Раунд 10 строил ЗАМЕНИТЕЛЬ ("food-cost/margin leaderboard" — рейтинг
 * блюд по теоретической марже рецепта, честно помеченный в CHANGELOG §38.2/§38.5
 * как НЕ настоящий ABC-анализ, т.к. считал по себестоимости рецепта, а не по
 * фактической выручке от продаж) — этот файл заменяет его настоящим расчётом.
 *
 * ЧЕСТНАЯ ГРАНИЦА (ОБНОВЛЕНО В РАУНДЕ 11, ПРОДОЛЖЕНИЕ — «Доделай оставшиеся 4
 * пункта»): изначально getPnl_ считал ТОЛЬКО валовую прибыль (выручка минус
 * себестоимость проданных блюд) — операционных расходов система не знала совсем.
 * Теперь, когда появился Expenses.gs, getPnl_ ДОПОЛНИТЕЛЬНО считает чистую
 * прибыль = валовая прибыль − расходы за период (calcExpensesForPeriod_). Это
 * ВСЁ РАВНО ПРИБЛИЖЕНИЕ, не бухгалтерски точный расчёт — см. докстринг
 * Expenses.gs про метод "сумма/30 × дней" для ежемесячных расходов. Оба числа
 * (валовая и чистая прибыль) возвращаются РЯДОМ, не подменяют друг друга —
 * старый код/отчёты, читающие только валовую_прибыль, продолжают работать
 * без изменений.
 * Списания (WRITE_OFFS) по-прежнему показаны отдельной строкой ("потери_от_списаний"),
 * а не вычтены автоматически — вычитать их значило бы молча смешивать две разные
 * по природе величины (потери сырья vs операционные расходы) без явного решения
 * Дениса, как их сочетать.
 */

/**
 * ТЗ — реальный P&L за период. dateFrom/dateTo — строки 'YYYY-MM-DD' (включительно),
 * не заданы — весь доступный период.
 */
function getPnl_(organizationId, locationId, dateFrom, dateTo) {
  var sales = getSales_(organizationId, locationId, dateFrom, dateTo);
  var revenue = 0, cogs = 0, qtyTotal = 0;
  sales.forEach(function (s) {
    revenue += Number(s.сумма) || 0;
    cogs += Number(s.себестоимость_на_момент) || 0;
    qtyTotal += Number(s.qty) || 0;
  });
  var grossProfit = revenue - cogs;
  var grossMarginPct = revenue > 0 ? round2_(grossProfit / revenue * 100) : 0;

  var writeoffs = getWriteOffs_(locationId, null).filter(function (w) {
    if (dateFrom && String(w.дата) < dateFrom) return false;
    if (dateTo && String(w.дата) > dateTo) return false;
    return true;
  });
  var writeoffSum = writeoffs.reduce(function (s, w) { return s + (Number(w.сумма) || 0); }, 0);

  var result = {
    период_с: dateFrom || '', период_по: dateTo || '',
    выручка: round2_(revenue),
    себестоимость_проданного: round2_(cogs),
    валовая_прибыль: round2_(grossProfit),
    валовая_маржа_pct: grossMarginPct,
    количество_продаж: sales.length,
    количество_позиций: round2_(qtyTotal),
    потери_от_списаний: round2_(writeoffSum)
  };

  // Раунд 11, продолжение — чистая прибыль = валовая прибыль − расходы за период
  // (Expenses.gs). Требует ОБЕИХ границ периода (calcExpensesForPeriod_ не умеет
  // "весь доступный период" — прорейт ежемесячных расходов без границ периода
  // не определён математически). Без обеих дат честно возвращаем только валовую
  // прибыль, как и раньше, с объяснением почему.
  if (dateFrom && dateTo) {
    var expensesInfo = calcExpensesForPeriod_(organizationId, locationId, dateFrom, dateTo);
    result.расходы_за_период = expensesInfo.всего;
    result.расходы_детально = expensesInfo.детально;
    result.чистая_прибыль = round2_(grossProfit - expensesInfo.всего);
    result.чистая_маржа_pct = revenue > 0 ? round2_(result.чистая_прибыль / revenue * 100) : 0;
    result.примечание = 'Валовая прибыль = выручка − себестоимость проданных блюд. Чистая прибыль = валовая прибыль − операционные расходы за период (Expenses.gs) — ПРИБЛИЖЕНИЕ: ежемесячные расходы прорейтированы по формуле сумма/30 × дней пересечения периода, это не бухгалтерски точный расчёт по календарным месяцам (см. докстринг Expenses.gs).';
  } else {
    result.примечание = 'Валовая прибыль = выручка − себестоимость проданных блюд. Чистая прибыль не рассчитана: для нее нужны обе границы периода (dateFrom и dateTo) — без них операционные расходы (Expenses.gs) нельзя корректно распределить по периоду.';
  }

  return result;
}

/**
 * ТЗ — классический ABC/Pareto-анализ по выручке (заменяет плейсхолдер раунда 10).
 * A — блюда, дающие первые ~80% накопленной выручки; B — следующие ~15% (до 95%);
 * C — оставшиеся ~5%. Блюда без единой продажи за период в анализ не попадают
 * (честно — по ним просто нет данных за этот период, не "категория C с нулём").
 */
function getAbcAnalysis_(organizationId, locationId, dateFrom, dateTo) {
  var sales = getSales_(organizationId, locationId, dateFrom, dateTo);
  var byDish = {};
  sales.forEach(function (s) {
    if (!byDish[s.dish_id]) byDish[s.dish_id] = { dish_id: s.dish_id, выручка: 0, себестоимость: 0, qty: 0 };
    byDish[s.dish_id].выручка += Number(s.сумма) || 0;
    byDish[s.dish_id].себестоимость += Number(s.себестоимость_на_момент) || 0;
    byDish[s.dish_id].qty += Number(s.qty) || 0;
  });

  var list = Object.keys(byDish).map(function (id) { return byDish[id]; });
  list.sort(function (a, b) { return b.выручка - a.выручка; });

  var totalRevenue = list.reduce(function (s, r) { return s + r.выручка; }, 0);
  var cumulative = 0;
  list.forEach(function (r) {
    var dish = findOne_('DISHES', 'dish_id', r.dish_id);
    r.название = dish ? dish.название : '(блюдо удалено/недоступно)';
    r.доля_pct = totalRevenue > 0 ? round2_(r.выручка / totalRevenue * 100) : 0;
    cumulative += r.доля_pct;
    r.накопленный_pct = round2_(cumulative);
    r.валовая_прибыль = round2_(r.выручка - r.себестоимость);
    r.категория = cumulative <= 80 ? 'A' : (cumulative <= 95 ? 'B' : 'C');
    r.выручка = round2_(r.выручка);
    r.себестоимость = round2_(r.себестоимость);
    r.qty = round2_(r.qty);
  });

  return { период_с: dateFrom || '', период_по: dateTo || '', общая_выручка: round2_(totalRevenue), блюда: list };
}
