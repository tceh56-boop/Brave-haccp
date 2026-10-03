// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — AI.gs
 * "AI-Директор" (ТЗ §22). Честно: это MVP на детерминированных правилах (rule-based),
 * а не вызов внешней LLM — правила ниже воспроизводят ровно те примеры рекомендаций,
 * что перечислены в ТЗ §22. Подключение реального LLM (как в Brave HACCP AI.gs через
 * UrlFetchApp к Claude API) — расширение этой же точки входа, не отдельный модуль.
 * Явное ограничение ТЗ §22 соблюдено: ничего здесь не меняет финансовые данные сама —
 * только формирует текст рекомендации.
 */

var WRITEOFF_SPIKE_THRESHOLD_PCT = 15;
var FOODCOST_DEVIATION_THRESHOLD_PCT = 5;

function getAiRecommendations_(organizationId, locationId) {
  var recommendations = [];

  // "Остаток сыра ниже установленного минимума."
  getProducts_(organizationId).forEach(function (p) {
    var stock = getStockLevel_(p.product_id, locationId);
    if (stock < Number(p.мин_остаток)) {
      recommendations.push('Остаток "' + p.название + '" (' + round2_(stock) + ' ' + p.единица + ') ниже установленного минимума (' + p.мин_остаток + ').');
    }
  });

  // "Увеличилось списание курицы на 18%." — сравнение суммы списаний сегодня со средним за предыдущие 7 дней.
  var allWriteoffs = getWriteOffs_(locationId, null);
  var byProduct = {};
  allWriteoffs.forEach(function (w) {
    byProduct[w.product_id] = byProduct[w.product_id] || [];
    byProduct[w.product_id].push(w);
  });
  Object.keys(byProduct).forEach(function (productId) {
    var rows = byProduct[productId];
    var today = _todayRows_(rows, 'дата').reduce(function (s, w) { return s + Number(w.количество); }, 0);
    var last7 = rows.filter(function (w) {
      var d = new Date(w.дата);
      var diffDays = (Date.now() - d.getTime()) / 86400000;
      return diffDays > 0 && diffDays <= 7;
    });
    var avgPerDay = last7.length ? last7.reduce(function (s, w) { return s + Number(w.количество); }, 0) / 7 : 0;
    if (avgPerDay > 0 && today > avgPerDay * (1 + WRITEOFF_SPIKE_THRESHOLD_PCT / 100)) {
      var product = getProductById_(productId);
      var pct = round2_((today - avgPerDay) / avgPerDay * 100);
      recommendations.push('Увеличилось списание "' + (product ? product.название : productId) + '" на ' + pct + '% относительно среднего за 7 дней.');
    }
  });

  // "Food Cost блюда вырос из-за увеличения цены сыра. Рекомендуется проверить ТТК и закупочную цену."
  // P0.7 — НАЙДЕНА И ИСПРАВЛЕНА УТЕЧКА МЕЖДУ ОРГАНИЗАЦИЯМИ: запрос не был отфильтрован
  // по organizationId (параметр этой же функции) — сканировались ВСЕ блюда ВСЕХ
  // организаций, и рекомендации с чужими названиями блюд и чужим food cost могли попасть
  // в ответ GET_AI_RECOMMENDATIONS любой организации. Та же ошибка и по той же причине,
  // что и в Economics.gs::recalcEconomics_ — findRows_ по умолчанию ничем не фильтрует.
  findRows_('DISHES', function (r) { return r.organization_id === organizationId && r.статус !== 'архив'; }).forEach(function (dish) {
    var fc = Number(dish.food_cost || 0);
    var targetFc = 30; // ориентир по умолчанию; в будущем — настраиваемый норматив на блюдо/категорию
    if (fc > targetFc + FOODCOST_DEVIATION_THRESHOLD_PCT) {
      recommendations.push('Food Cost блюда "' + dish.название + '" (' + fc + '%) выше нормы (' + targetFc + '%). Рекомендуется проверить ТТК и закупочные цены ингредиентов.');
    }
  });

  return recommendations;
}
