// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — FoodCost.gs
 * Каскадный пересчёт себестоимости/Food Cost/маржи (ТЗ §7, §11, §20, §32).
 * Это единственное место, где считается DISHES.себестоимость/food_cost/маржа —
 * никакой другой модуль не пишет в эти поля напрямую.
 *
 * Глубина рекурсии ограничена (депф ≤ 5, тот же лимит, что и в explodeProductionNeed
 * из Mon Cher) — защита от случайного цикла ПФ-в-ПФ, который иначе повесит пересчёт.
 */

var MAX_CASCADE_DEPTH = 5;

function recalcDishCost_(dishId) {
  var dish = findOne_('DISHES', 'dish_id', dishId);
  if (!dish) return null;
  var cost = calcRecipeCost_('DISH', dishId);
  var price = Number(dish.цена_продажи) || 0;
  var foodCost = price > 0 ? round2_(cost / price * 100) : 0;
  var margin = price > 0 ? round2_(100 - foodCost) : 0;

  updateRow_('DISHES', dish, {
    себестоимость: round2_(cost),
    food_cost: foodCost,
    маржа: margin,
    обновлено: nowIso_()
  });

  return { dish_id: dishId, себестоимость: round2_(cost), food_cost: foodCost, маржа: margin };
}

/**
 * Раунд 9 — восполнен пробел, найденный при аудите перед постройкой интерфейса «Рецепты/
 * Тех.карты»: CREATE_DISH существовал (см. комментарий выше), но способа прочитать список
 * блюд организации не было вообще — тот же класс пробела, что уже описан для CREATE_DISH
 * до его добавления. Без этого действия интерфейс мог бы создать блюдо, но никогда больше
 * его не увидеть. Активной деактивации/удаления блюд в проекте нет (как и везде — только
 * мягкая деактивация через отдельные статусные поля, которых у DISHES для этого не заведено),
 * поэтому здесь возвращаются все блюда организации без фильтра по статусу.
 */
function getDishes_(organizationId) {
  return findRows_('DISHES', function (d) { return d.organization_id === organizationId; });
}

function recalcParentCost_(parentType, parentId, _visited, _depth) {
  var visited = _visited || {};
  var depth = _depth || 0;
  var key = parentType + ':' + parentId;
  if (visited[key] || depth > MAX_CASCADE_DEPTH) return []; // защита от цикла / чрезмерной глубины
  visited[key] = true;

  var results = [];
  if (parentType === 'PF') {
    var unitCost = recalcSemiFinishedCost_(parentId);
    results.push({ type: 'PF', id: parentId, себестоимость_единицы: unitCost });
    // ПФ мог использоваться как ингредиент в других блюдах/ПФ — тянем каскад дальше
    var grandParents = findParentsUsingIngredient_(parentId);
    grandParents.forEach(function (gp) {
      results = results.concat(recalcParentCost_(gp.type, gp.id, visited, depth + 1));
    });
  } else if (parentType === 'DISH') {
    var dishResult = recalcDishCost_(parentId);
    if (dishResult) results.push(dishResult);
  }
  return results;
}

/**
 * ТЗ §7: "Если изменилась цена продукта — пересчитать себестоимость ВСЕХ блюд,
 * где используется этот продукт, без ручного открытия каждой ТТК."
 * Точка входа как для изменения цены продукта (Products.gs), так и для смены
 * состава/выхода рецепта (Recipes.gs::updateRecipeLine_).
 */
function recalcFoodCostForProduct_(productId) {
  var parents = findParentsUsingIngredient_(productId);
  var all = [];
  parents.forEach(function (p) {
    all = all.concat(recalcParentCost_(p.type, p.id, {}, 0));
  });
  return all;
}

/**
 * v2 — восполнен пробел, найденный при аудите: CREATE_DISH был размечен в
 * CONFIG.ACTION_MODULE, но НИ ОДНОЙ функции создания блюда в проекте не было вообще
 * (DISHES можно было только прочитать). Себестоимость/food_cost/маржа проставляются
 * нулями до первой строки рецепта — они и должны быть 0 до заполнения состава, это не
 * ошибка, а честное отражение "рецепта ещё нет".
 */
function createDish_(data, userId) {
  if (!data.organization_id) throw new Error('createDish_: organization_id обязателен.');
  if (!data.название) throw new Error('Укажите название блюда.');
  var dish = {
    dish_id: generateId_('DISHES'),
    organization_id: data.organization_id,
    название: data.название,
    категория_id: data.категория_id || '',
    выход: Number(data.выход) || 1,
    цена_продажи: Number(data.цена_продажи) || 0,
    себестоимость: 0,
    food_cost: 0,
    маржа: 0,
    статус: 'активно',
    version: 1,
    обновлено: nowIso_()
  };
  insertRow_('DISHES', dish);
  auditLog_(userId, 'Создано блюдо', 'DISHES:' + dish.dish_id, null, dish.название, 'success');
  return dish;
}

/**
 * РАУНД 10 — НАЙДЕНО ПРИ АУДИТЕ: до этого раунда блюдо можно было создать (createDish_),
 * пересчитать его себестоимость каскадом (recalcDishCost_ — но это ТОЛЬКО себестоимость/
 * food_cost/маржа, вызывается автоматически), и изменить его СОСТАВ (ADD_RECIPE_LINE/
 * UPDATE_RECIPE — это RECIPES, не DISHES), но не существовало НИ ОДНОЙ функции, меняющей
 * собственные поля блюда (название/категория/выход/цена_продажи) — переименовать блюдо
 * или поправить цену продажи после создания было невозможно вообще. Правит только
 * "витринные" поля — себестоимость/food_cost/маржа НАМЕРЕННО не принимаются через patch
 * (они считаются исключительно каскадом recalcDishCost_ от состава рецепта и цен
 * продуктов — прямая правка через UPDATE_DISH создала бы рассинхрон с реальным составом).
 * Смена цены_продажи здесь ЖЕ пересчитывает food_cost/маржу (они зависят от цены продажи
 * и уже известной себестоимости), чтобы после переименования/смены цены список блюд не
 * показывал устаревший food_cost.
 */
function updateDish_(dishId, patch, session) {
  var dish = findOne_('DISHES', 'dish_id', dishId);
  if (session) assertOwnedByOrg_(session, dish, 'DISHES:' + dishId); // ТЗ P0.1
  else if (!dish) throw new Error('Блюдо не найдено: ' + dishId);
  var safePatch = { обновлено: nowIso_() };
  if (patch.название !== undefined) {
    if (!patch.название) throw new Error('Название блюда не может быть пустым.');
    safePatch.название = patch.название;
  }
  if (patch.категория_id !== undefined) safePatch.категория_id = patch.категория_id;
  if (patch.выход !== undefined) safePatch.выход = Number(patch.выход) || 1;
  if (patch.цена_продажи !== undefined) {
    var price = Number(patch.цена_продажи) || 0;
    safePatch.цена_продажи = price;
    var cost = Number(dish.себестоимость) || 0;
    safePatch.food_cost = price > 0 ? round2_(cost / price * 100) : 0;
    safePatch.маржа = price > 0 ? round2_(100 - safePatch.food_cost) : 0;
  }
  updateRow_('DISHES', dish, safePatch);
  var updated = findOne_('DISHES', 'dish_id', dishId);
  auditLog_(session ? session.user_id : null, 'Изменено блюдо', 'DISHES:' + dishId, dish.название, updated.название, 'success');
  return updated;
}

/**
 * ТЗ §29/§48 — версионирование ТТК: НИКОГДА не перезаписывает и не удаляет предыдущую
 * версию, только добавляет новую строку со следующим номером version и переводит
 * предыдущую активную версию в статус "заменена" (история остаётся читаемой целиком).
 *
 * P0.4 — НАЙДЕНО ПРИ АУДИТЕ: эта функция существовала с самого начала проекта, но
 * НИ РАЗУ не была подключена ни к одному действию в API.gs — создать ТТК через API
 * было физически невозможно (найдено и то же самое для getTechCards_ ниже). Подключено
 * в этом раунде (CREATE_TECH_CARD/GET_TECH_CARDS, API.gs) — вместе с этим добавлен
 * session-параметр и ТЗ P0.1 проверка принадлежности dishId организации сессии
 * (раньше её физически негде было проверять — действия не существовало).
 */
function createTechCard_(dishId, data, userId, session) {
  var dish = findOne_('DISHES', 'dish_id', dishId);
  if (session) assertOwnedByOrg_(session, dish, 'DISHES:' + dishId); // ТЗ P0.1
  else if (!dish) throw new Error('Блюдо не найдено: ' + dishId);
  var previous = findRows_('TECH_CARDS', function (r) { return r.dish_id === dishId && r.status === 'активна'; });
  var nextVersion = 1 + previous.reduce(function (max, r) { return Math.max(max, Number(r.version) || 0); }, 0);

  var ttk = {
    ttk_id: generateId_('TECH_CARDS'),
    dish_id: dishId,
    технология: data.технология || '',
    фото_url: data.фото_url || '',
    version: nextVersion,
    created_at: nowIso_(),
    created_by: userId || '',
    status: 'активна'
  };
  // P0.6 (ТЗ §6, атомарность/восстановление) — ПОРЯДОК ЗАПИСЕЙ НАРОЧНО ПЕРЕСТАВЛЕН:
  // раньше старые версии сначала переводились в 'заменена', и только потом писалась
  // новая строка — сбой ПОСЛЕ этого перевода, но ДО insertRow_ (нет настоящих
  // транзакций, ТЗ §6) оставлял бы блюдо БЕЗ единой активной ТТК вообще. Теперь новая
  // версия сначала СОЗДАЁТСЯ; безопасно — getTechCards_ ниже выбирает по СТАРШЕЙ
  // version, а не по статусу 'активна' (проверено: status='активна' больше нигде по
  // проекту не фильтруется, кроме этой самой функции) — если из-за сбоя старая версия
  // на миг/навсегда останется тоже помеченной 'активна', ничей код от этого не
  // сломается, следующий createTechCard_ для этого блюда сам доведёт пометку до конца.
  insertRow_('TECH_CARDS', ttk);
  previous.forEach(function (r) { updateRow_('TECH_CARDS', r, { status: 'заменена' }); });
  updateRow_('DISHES', dish, { version: nextVersion });
  auditLog_(userId, 'Новая версия ТТК', 'TECH_CARDS:' + dishId, previous.length ? 'v' + (nextVersion - 1) : 'нет', 'v' + nextVersion, 'success', session ? session.cascade_id : '');
  return ttk;
}

function getTechCards_(dishId, session) {
  if (session) assertOwnedByOrg_(session, findOne_('DISHES', 'dish_id', dishId), 'DISHES:' + dishId); // ТЗ P0.1
  return findRows_('TECH_CARDS', function (r) { return r.dish_id === dishId; })
    .sort(function (a, b) { return Number(b.version) - Number(a.version); });
}
