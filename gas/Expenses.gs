// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Expenses.gs
 * Раунд 11, продолжение («Доделай оставшиеся 4 пункта») — операционные расходы
 * (аренда, зарплата, коммунальные, налоги и т.п.), впервые дающие GET_PNL
 * (SalesAnalytics.gs) возможность честно посчитать ЧИСТУЮ прибыль. До этого
 * изменения getPnl_ явно документировал границу: "система не учитывает
 * операционные расходы нигде" (CHANGELOG §39.3/39.8/39.10) — это тот самый
 * пробел, который этот файл закрывает.
 *
 * ЧЕСТНАЯ ГРАНИЦА, ФЛАГУЮ ЯВНО (не молча, как приближение без объяснения):
 * calcExpensesForPeriod_ ниже — это ОЦЕНКА, не бухгалтерски точный расчёт.
 *   - 'разовый' расход учитывается ПОЛНОСТЬЮ, если его дата попадает в период
 *     (dateFrom..dateTo включительно) — здесь неоднозначности нет.
 *   - 'ежемесячный' расход (аренда, ЗП и т.п.) — точной "календарной" разбивки
 *     по месяцам с разным числом дней система не делает. Вместо этого — простое
 *     приближение "дневная ставка": сумма / 30 × (число дней пересечения периода
 *     запроса с периодом действия расхода, начиная с его даты). Это НЕ то же
 *     самое, что бухгалтерский метод начисления по фактическому числу дней в
 *     конкретном месяце — расхождение на несколько процентов при выборке
 *     произвольного (не месячного) периода ожидаемо и не является ошибкой кода.
 *     Если Денису нужна точная посуточная/помесячная бухгалтерия — это отдельное,
 *     более крупное решение (учёт закрытых периодов, возможно интеграция с 1С),
 *     не тихо подменяется этим приближением.
 * Это явно отражено в возвращаемом примечании GET_PNL (SalesAnalytics.gs), а не
 * только в этом докстринге — пользователь интерфейса должен видеть границу
 * там, где видит цифру, а не только в коде.
 */

var EXPENSE_PERIODICITY = ['разовый', 'ежемесячный'];

/**
 * ТЗ — создать запись расхода. locationId может быть пустым ('' или undefined) —
 * тогда расход относится ко всей организации (тот же смысл "org-wide", что уже
 * применён к NOTIFICATION_SETTINGS.location_id).
 */
function createExpense_(data, userId, session) {
  return withLock_(function () {
    var категория = String(data.категория || '').trim();
    if (!категория) throw new Error('Не указана категория расхода.');
    var сумма = Number(data.сумма);
    if (!(сумма > 0)) throw new Error('Сумма расхода должна быть положительным числом.');
    var периодичность = data.периодичность || 'разовый';
    if (EXPENSE_PERIODICITY.indexOf(периодичность) === -1) {
      throw new Error('Недопустимая периодичность расхода: ' + периодичность + ' (допустимо: ' + EXPENSE_PERIODICITY.join(', ') + ').');
    }
    var дата = data.дата || nowIso_().slice(0, 10);
    var locationId = data.locationId || '';
    // ТЗ P0.1 — тот же приём, что и везде в проекте (Journals.gs/LabTests.gs/Notifications.gs):
    // точка должна принадлежать своей организации.
    if (locationId) assertOwnedByOrg_(session, findOne_('LOCATIONS', 'location_id', locationId), 'LOCATIONS:' + locationId);
    // Внешний P0-аудит, п.3 (продолжение, раунд 12) — org-проверка выше не защищает от
    // ЧУЖОЙ ТОЧКИ ТОЙ ЖЕ организации: без этой проверки сотрудник одной точки мог создать
    // расход, отнесённый на СОСЕДНЮЮ точку, к которой не имеет отношения (тот же класс,
    // что уже закрыт для NOTIFICATION_SETTINGS/LAB_TEST_DEFINITIONS/JOURNAL_DEFINITIONS).
    if (locationId) assertLocationAllowed_(session, locationId, 'LOCATIONS:' + locationId);

    var row = {
      expense_id: generateId_('EXPENSES'),
      organization_id: session.organization_id,
      location_id: locationId,
      категория: категория,
      сумма: round2_(сумма),
      периодичность: периодичность,
      дата: дата,
      user_id: userId,
      создано: nowIso_()
    };
    insertRow_('EXPENSES', row);
    auditLog_(userId, 'Создан расход', 'EXPENSES:' + row.expense_id, null, категория + ': ' + сумма + ' (' + периодичность + ')', 'success', session.cascade_id);
    return row;
  });
}

/**
 * ТЗ — список расходов организации/точки. locationId необязателен: не задан —
 * все расходы организации (и org-wide, и по всем точкам); задан — только
 * org-wide (location_id === '') и расходы именно этой точки — та же семантика
 * "точка видит и свои, и общие", что уже применена к NOTIFICATION_SETTINGS.
 *
 * Фильтр по датам НАМЕРЕННО не одинаков для 'разовый' и 'ежемесячный' — он
 * зеркалит логику calcExpensesForPeriod_ (иначе список расходов периода и сумма,
 * вычтенная из чистой прибыли того же периода в GET_PNL, разошлись бы: 'ежемесячный'
 * расход, начатый до dateFrom, всё ещё "активен" и учтён в P&L — значит, обязан
 * быть виден в списке за этот период тоже, иначе пользователь увидит вычет в
 * P&L, не понимая, откуда он взялся).
 */
function getExpenses_(organizationId, locationId, dateFrom, dateTo) {
  return findRows_('EXPENSES', function (r) {
    if (r.organization_id !== organizationId) return false;
    if (locationId && r.location_id && r.location_id !== locationId) return false;
    if (!dateFrom && !dateTo) return true; // без фильтра — полный список (для управления/редактирования)
    if (r.периодичность === 'ежемесячный') {
      if (dateTo && String(r.дата) > dateTo) return false; // начался позже конца периода — ещё не активен
      return true; // активен с даты начала и бессрочно вперёд, см. calcExpensesForPeriod_
    }
    if (dateFrom && String(r.дата) < dateFrom) return false;
    if (dateTo && String(r.дата) > dateTo) return false;
    return true;
  }).sort(function (a, b) { return String(b.дата).localeCompare(String(a.дата)); });
}

/**
 * ТЗ — сумма расходов за период (см. докстринг файла про приближение для
 * 'ежемесячный'). locationId — та же семантика, что и getExpenses_.
 */
function calcExpensesForPeriod_(organizationId, locationId, dateFrom, dateTo) {
  if (!dateFrom || !dateTo) throw new Error('calcExpensesForPeriod_: нужны обе даты периода.');
  var periodStart = new Date(dateFrom + 'T00:00:00Z');
  var periodEnd = new Date(dateTo + 'T00:00:00Z');
  // Все расходы организации (без ограничения по dateFrom/dateTo здесь — 'ежемесячный'
  // расход с датой ДО периода запроса всё ещё может пересекаться с ним).
  var all = findRows_('EXPENSES', function (r) {
    if (r.organization_id !== organizationId) return false;
    if (locationId && r.location_id && r.location_id !== locationId) return false;
    return true;
  });

  var total = 0;
  var detail = [];
  all.forEach(function (r) {
    var expDate = new Date(String(r.дата) + 'T00:00:00Z');
    var сумма = Number(r.сумма) || 0;
    var included = 0;
    if (r.периодичность === 'разовый') {
      if (expDate >= periodStart && expDate <= periodEnd) included = сумма;
    } else {
      // 'ежемесячный' — действует НАЧИНАЯ с даты расхода, бессрочно вперёд (расход
      // "закрывается" не автоматически, а только если его больше не создают на
      // следующий месяц — то же допущение, что для recurring-платежей в большинстве
      // простых бухгалтерских инструментов без отдельного модуля "договоров").
      var overlapStart = expDate > periodStart ? expDate : periodStart;
      var overlapEnd = periodEnd;
      if (overlapEnd >= overlapStart) {
        var days = Math.floor((overlapEnd - overlapStart) / 86400000) + 1;
        included = round2_(сумма / 30 * days);
      }
    }
    if (included > 0) {
      total += included;
      detail.push({ expense_id: r.expense_id, категория: r.категория, периодичность: r.периодичность, сумма_за_период: round2_(included) });
    }
  });

  return { всего: round2_(total), детально: detail };
}
