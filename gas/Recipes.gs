// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Recipes.gs
 * Рецептуры/ТТК. Строка рецепта связывает блюдо ИЛИ полуфабрикат (parent_type/parent_id)
 * с ингредиентом — а ингредиентом может быть как сырой продукт (PROD-...), так и другой
 * полуфабрикат (PF-...). Это и даёт "полуфабрикаты как полноценные объекты" из ТЗ §8:
 * PF можно использовать в рецепте блюда точно так же, как обычный продукт.
 */

/**
 * v2 (ТЗ §8/§20) — явное обнаружение циклов ДО записи, а не только защита глубиной
 * пересчёта (MAX_CASCADE_DEPTH в FoodCost.gs, которая лишь не даёт системе зависнуть,
 * но пускает саму порочную запись в таблицу). Полуфабрикат не может входить сам в себя,
 * ни напрямую, ни через цепочку других ПФ (ПФ "Соус A" содержит ПФ "Соус B", который
 * содержит ПФ "Соус A" — тоже цикл, хоть и не прямой).
 */
function _pfDependsOn_(pfId, targetId, visited) {
  if (pfId === targetId) return true;
  visited = visited || {};
  if (visited[pfId]) return false;
  visited[pfId] = true;
  var lines = getRecipeLines_('PF', pfId);
  for (var i = 0; i < lines.length; i++) {
    var ing = lines[i].product_id;
    if (String(ing).indexOf('PF-') === 0 && _pfDependsOn_(ing, targetId, visited)) return true;
  }
  return false;
}

function _assertNoRecipeCycle_(parentType, parentId, ingredientId) {
  if (parentType !== 'PF' || String(ingredientId).indexOf('PF-') !== 0) return;
  if (ingredientId === parentId || _pfDependsOn_(ingredientId, parentId)) {
    throw new Error('Обнаружена циклическая зависимость рецептур: "' + ingredientId + '" уже (прямо или через цепочку) содержит "' + parentId + '" — нельзя использовать его обратно как ингредиент.');
  }
}

/** Организация родителя (DISH/PF) рецептурной строки — общая точка для проверки принадлежности (ТЗ P0.1). */
function _recipeParentOrg_(parentType, parentId) {
  return parentType === 'PF' ? getSemiFinishedById_(parentId) : findOne_('DISHES', 'dish_id', parentId);
}

/**
 * P0.2 (ТЗ §18): обёрнуто в withLock_ — как и updateRecipeLine_, эта функция меняет
 * состав рецепта И запускает каскад пересчёта себестоимости, это должно быть одной
 * защищённой операцией, а не отдельными незащищёнными шагами.
 *
 * P0.2 — ИСПРАВЛЕНА НАЙДЕННАЯ ПРИ АУДИТЕ НЕТОЧНОСТЬ: раньше recalcParentCost_()
 * вызывался СНАРУЖИ, в обработчике ADD_RECIPE_LINE (API.gs), а его результат
 * (что именно пересчиталось) никак не возвращался клиенту — терялся. Теперь пересчёт —
 * часть самой функции (как в updateRecipeLine_), и его результат возвращается вызывающему.
 */
function addRecipeLine_(parentType, parentId, ingredientId, брутто, нетто, единица, потериПроцент, session) {
  return withLock_(function () {
    if (parentType !== 'DISH' && parentType !== 'PF') {
      throw new Error('addRecipeLine_: parent_type должен быть DISH или PF, получено: ' + parentType);
    }
    if (session) {
      assertOwnedByOrg_(session, _recipeParentOrg_(parentType, parentId), parentType + ':' + parentId); // ТЗ P0.1
      // Ингредиент тоже может принадлежать чужой организации (продукт или другой ПФ) — проверяем отдельно.
      var ingredientEntity = String(ingredientId).indexOf('PF-') === 0 ? getSemiFinishedById_(ingredientId) : getProductById_(ingredientId);
      assertOwnedByOrg_(session, ingredientEntity, 'INGREDIENT:' + ingredientId);
    }
    _assertNoRecipeCycle_(parentType, parentId, ingredientId);
    // P0.4 — НАЙДЕНО ПРИ АУДИТЕ: "Number(брутто) || 0" молча превращал отсутствующее,
    // отрицательное или нечисловое значение в 0 — строка рецепта тихо создавалась с
    // нулевым весом (ничего не весит, ничего не стоит, ничего не спишется при
    // производстве) без единой ошибки клиенту. Это не сохранение "пустой" строки для
    // последующего заполнения (для этого есть отдельный сценарий редактирования) — это
    // числовой ввод, который обязан быть положительным, раз строка вообще создаётся.
    var bruttoNum = Number(брутто);
    if (!(bruttoNum > 0)) {
      throw new Error('Брутто должно быть положительным числом (получено: ' + брутто + ').');
    }
    var line = {
      recipe_id: generateId_('RECIPES'),
      parent_type: parentType,
      parent_id: parentId,
      product_id: ingredientId,
      брутто: bruttoNum,
      нетто: Number(нетто) || 0,
      единица: единица || 'г',
      потери_процент: Number(потериПроцент) || 0
    };
    insertRow_('RECIPES', line);
    var cascade = recalcParentCost_(parentType, parentId);
    if (typeof detectAndRequestPpkReview_ === 'function' && session) {
      var parentOrgEntity=_recipeParentOrg_(parentType,parentId);
      var locs=findRows_('LOCATIONS',function(l){return l.organization_id===parentOrgEntity.organization_id;});
      locs.forEach(function(l){detectAndRequestPpkReview_(parentOrgEntity.organization_id,l.location_id,'RECIPE_CHANGED','RECIPES',line.recipe_id,session.user_id,session,'Изменена рецептура.');});
    }
    return { line: line, пересчитано: cascade };
  });
}

function getRecipeLines_(parentType, parentId, session) {
  if (session) assertOwnedByOrg_(session, _recipeParentOrg_(parentType, parentId), parentType + ':' + parentId); // ТЗ P0.1
  return findRows_('RECIPES', function (r) {
    return r.parent_type === parentType && r.parent_id === parentId;
  });
}

/** Цена за единицу ингредиента — не важно, продукт это или полуфабрикат (ТЗ §8). */
function getIngredientUnitPrice_(ingredientId) {
  if (String(ingredientId).indexOf('PF-') === 0) {
    var pf = findOne_('SEMI_FINISHED', 'pf_id', ingredientId);
    return pf ? Number(pf.себестоимость) || 0 : 0;
  }
  var product = getProductById_(ingredientId);
  return product ? Number(product.текущая_цена) || 0 : 0;
}

/** Переводит брутто в базовую единицу расчёта (кг/л/шт), чтобы цена (за кг/л/шт) применялась верно. */
function normalizeQty_(qty, unit) {
  if (unit === 'г' || unit === 'мл') return qty / 1000;
  return qty; // кг, л, шт — уже в базовой единице
}

/** Сумма стоимости всех строк рецепта родителя — ядро себестоимости (используется и DISHES, и SEMI_FINISHED). */
function calcRecipeCost_(parentType, parentId) {
  var lines = getRecipeLines_(parentType, parentId);
  var total = 0;
  lines.forEach(function (line) {
    var price = getIngredientUnitPrice_(line.product_id);
    var qty = normalizeQty_(Number(line.брутто) || 0, line.единица);
    total += price * qty;
  });
  return total;
}

/** Все родители (DISH/PF), где этот ингредиент встречается — нужно для каскада пересчёта (ТЗ §20). */
function findParentsUsingIngredient_(ingredientId) {
  var lines = findRows_('RECIPES', function (r) { return r.product_id === ingredientId; });
  var seen = {};
  var parents = [];
  lines.forEach(function (l) {
    var key = l.parent_type + ':' + l.parent_id;
    if (!seen[key]) {
      seen[key] = true;
      parents.push({ type: l.parent_type, id: l.parent_id });
    }
  });
  return parents;
}

/**
 * Внешний P0-аудит, п.3 (mass assignment, продолжение раунда 12) — НАЙДЕНО: `patch`
 * передавался в updateRow_ без ограничения полей. Два отдельных риска, закрыты по-разному:
 *   1) patch.parent_type/parent_id — клиент мог "переподвесить" строку рецепта на
 *      СОВСЕМ ДРУГОЕ блюдо/ПФ (в т.ч. чужой организации), минуя все проверки владения
 *      выше (та же по сути дыра, что у workshop_id/location_id в WORKSHOPS/EQUIPMENT) —
 *      теперь всегда игнорируются.
 *   2) patch.product_id (смена ингредиента) — легитимное поле, НЕ защищённое ранее: в
 *      отличие от addRecipeLine_, здесь НЕ проверялось, что новый ингредиент принадлежит
 *      той же организации (только проверка цикла). Добавлена та же проверка, что в
 *      addRecipeLine_ (assertOwnedByOrg_ на ингредиент).
 */
function updateRecipeLine_(recipeId, patch, session) {
  return withLock_(function () { // P0.2 (ТЗ §18) — запись + каскад пересчёта себестоимости как одна защищённая операция
    var line = findOne_('RECIPES', 'recipe_id', recipeId);
    if (!line) throw new Error('Строка рецепта не найдена: ' + recipeId);
    if (session) assertOwnedByOrg_(session, _recipeParentOrg_(line.parent_type, line.parent_id), line.parent_type + ':' + line.parent_id); // ТЗ P0.1
    var safePatch = _stripProtectedFields_(patch, ['recipe_id', 'parent_type', 'parent_id']);
    if (safePatch.product_id && safePatch.product_id !== line.product_id) {
      if (session) {
        var ingredientEntity = String(safePatch.product_id).indexOf('PF-') === 0 ? getSemiFinishedById_(safePatch.product_id) : getProductById_(safePatch.product_id);
        assertOwnedByOrg_(session, ingredientEntity, 'INGREDIENT:' + safePatch.product_id);
      }
      _assertNoRecipeCycle_(line.parent_type, line.parent_id, safePatch.product_id);
    }
    // P0.4 — то же требование, что и в addRecipeLine_: брутто не может быть обнулено/
    // сделано отрицательным через патч (та же тихая порча строки рецепта, только на
    // редактировании, а не на создании).
    if (safePatch.брутто !== undefined && !(Number(safePatch.брутто) > 0)) {
      throw new Error('Брутто должно быть положительным числом (получено: ' + safePatch.брутто + ').');
    }
    updateRow_('RECIPES', line, safePatch);
    var cascade = recalcParentCost_(line.parent_type, line.parent_id);
    return { line_id: recipeId, пересчитано: cascade };
  });
}
