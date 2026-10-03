// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Reports.gs
 * Отчёты (ТЗ §10 отчётов "Дневные/Недельные/Месячные/Архив"). MVP: дневной отчёт
 * собирается из уже посчитанных данных (Economics.gs), без отдельного шаблона PDF —
 * печатная форма строится на фронтенде тем же способом, что и акты (window.print),
 * как это принято во всех предыдущих проектах Дениса (см. coding-context).
 */

function generateDailyReport_(organizationId, locationId) {
  var dashboard = getDashboard_(organizationId, locationId);
  var writeoffs = _todayRows_(getWriteOffs_(locationId, null), 'дата');
  var report = {
    report_id: generateId_('REPORTS'),
    organization_id: organizationId || '',
    тип: 'дневной',
    период: new Date().toISOString().slice(0, 10),
    ссылка_на_файл: '', // заполняется, если/когда отчёт выгружается в Drive как PDF
    создано: nowIso_()
  };
  insertRow_('REPORTS', report);
  return {
    report_id: report.report_id,
    период: report.период,
    списания: writeoffs,
    сводка: dashboard.экономика
  };
}

function getReports_(organizationId, тип) {
  return findRows_('REPORTS', function (r) {
    return (!organizationId || r.organization_id === organizationId) && (!тип || r.тип === тип);
  });
}

/**
 * Раунд 11 — честно указано в отчёте раунда 10 ("недельные/месячные отчёты" в списке
 * НЕ реализованного). До этого раунда существовал только generateDailyReport_ (сегодня,
 * жёстко), обобщённого по периоду генератора не было вообще. Теперь обогащён РЕАЛЬНЫМИ
 * данными о выручке/P&L (SalesAnalytics.gs::getPnl_/getAbcAnalysis_), которых раньше
 * структурно не существовало (см. Sales.gs).
 */
function generatePeriodReport_(organizationId, locationId, тип, dateFrom, dateTo) {
  var writeoffs = getWriteOffs_(locationId, null).filter(function (w) {
    return String(w.дата) >= dateFrom && String(w.дата) <= dateTo;
  });
  var pnl = getPnl_(organizationId, locationId, dateFrom, dateTo);
  var abc = getAbcAnalysis_(organizationId, locationId, dateFrom, dateTo);
  var dashboard = getDashboard_(organizationId, locationId);

  var report = {
    report_id: generateId_('REPORTS'),
    organization_id: organizationId || '',
    тип: тип,
    период: dateFrom + ' — ' + dateTo,
    ссылка_на_файл: '', // ТЗ "экспорт в файл" — реализован на фронтенде как клиентский CSV/Blob-экспорт
                         // (см. CHANGELOG раунда 11: в проекте нет прецедента серверной генерации файла
                         // отчёта — DriveApp используется только для бэкапа всей таблицы и для хранения
                         // загруженных документов поставщика, ни один из них не подходит; заводить новый
                         // Drive-паттерн ради одной кнопки экспорта — решение, которое стоило явно
                         // обсудить с Денисом, а не тихо изобрести).
    создано: nowIso_()
  };
  insertRow_('REPORTS', report);
  return {
    report_id: report.report_id,
    тип: тип,
    период: report.период,
    списания: writeoffs,
    p_and_l: pnl,
    abc_анализ: abc,
    сводка: dashboard.экономика
  };
}

/** dateFrom/dateTo — строки 'YYYY-MM-DD'; при отсутствии — последние 7 дней включая сегодня. */
function generateWeeklyReport_(organizationId, locationId, dateFrom, dateTo) {
  if (!dateFrom || !dateTo) {
    var today = new Date();
    var weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
    dateTo = today.toISOString().slice(0, 10);
    dateFrom = weekAgo.toISOString().slice(0, 10);
  }
  return generatePeriodReport_(organizationId, locationId, 'недельный', dateFrom, dateTo);
}

/** dateFrom/dateTo — строки 'YYYY-MM-DD'; при отсутствии — текущий календарный месяц по сегодняшний день. */
function generateMonthlyReport_(organizationId, locationId, dateFrom, dateTo) {
  if (!dateFrom || !dateTo) {
    var today = new Date();
    var firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    dateTo = today.toISOString().slice(0, 10);
    dateFrom = firstOfMonth.toISOString().slice(0, 10);
  }
  return generatePeriodReport_(organizationId, locationId, 'месячный', dateFrom, dateTo);
}
