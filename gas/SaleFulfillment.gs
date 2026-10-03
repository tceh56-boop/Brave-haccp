// ЦЕХ — SaleFulfillment.gs
// Полный цикл реализации блюда: продажа -> ТТК -> расход сырья -> брутто/нетто -> отход -> журнал -> прослеживаемость.
// Для блюд, приготовляемых под продажу, это отдельный безопасный сценарий. Он не меняет
// историческую семантику CREATE_SALE: для включения фактического складского исполнения
// используется CREATE_SALE_AND_FULFILL или FULFILL_SALE.

function _saleFulfillmentRecipe_(dishId, session) {
  var ttk = typeof getCurrentTtk_ === 'function' ? getCurrentTtk_(dishId, session) : null;
  if (!ttk) throw new Error('Нельзя выполнить продажу по ТТК: нет утверждённой ТТК для блюда.');
  var recipe = getRecipeLines_('DISH', dishId, session);
  if (!recipe.length) throw new Error('В ТТК отсутствует рецептура блюда.');
  return { ttk: ttk, recipe: recipe };
}

function _saleGrossNetLines_(recipe, qty) {
  return recipe.map(function(line) {
    var grossPerUnit = Number(line.брутто) || 0;
    var netPerUnit = typeof _recipeNetPerUnit_ === 'function' ? _recipeNetPerUnit_(line) : (Number(line.нетто) || grossPerUnit);
    var ingredient = String(line.product_id).indexOf('PF-') === 0 ? getSemiFinishedById_(line.product_id) : getProductById_(line.product_id);
    _assertGrossNet_(grossPerUnit, netPerUnit, ingredient ? ingredient.название : line.product_id);
    return {
      line: line,
      gross: round2_(grossPerUnit * qty),
      net: round2_(netPerUnit * qty),
      product_id: line.product_id,
      единица: line.единица || (ingredient && ingredient.единица) || '',
      name: ingredient ? ingredient.название : line.product_id
    };
  }).filter(function(x){ return x.gross > 0; });
}

function _preflightSaleFulfillment_(lines, locationId) {
  lines.forEach(function(x) {
    var available = getUsableStockLevel_(x.product_id, locationId);
    if (available + 0.0001 < x.gross) {
      throw new Error('Недостаточно годного остатка для продажи: "' + x.name + '" — нужно ' + round2_(x.gross) + ', доступно ' + round2_(available) + '. Ничего не списано.');
    }
  });
}

function _recordSaleIngredientUsage_(sale, item, consumption, ttk, session) {
  var batchIds = [];
  var grossCost = Number(consumption.сумма) || 0;
  var waste = Math.max(0, item.gross - item.net);
  var wasteCost = 0;
  (consumption.распределение || []).forEach(function(part){
    batchIds.push(part.batch_id);
    if (item.gross > 0) wasteCost += (waste * (Number(part.количество)||0) / item.gross) * (Number(part.цена)||0);
  });
  wasteCost = round2_(wasteCost);
  var pct = item.gross > 0 ? round2_(waste / item.gross * 100) : 0;
  var usage = {
    usage_id: generateId_('SALE_INGREDIENT_USAGE'),
    organization_id: session.organization_id,
    location_id: sale.location_id,
    sale_id: sale.sale_id,
    ttk_version_id: ttk.ttk_version_id,
    dish_id: sale.dish_id,
    product_id: item.product_id,
    batch_ids: JSON.stringify(batchIds),
    единица: item.единица,
    брутто: item.gross,
    нетто: item.net,
    отход: round2_(waste),
    процент_отхода: pct,
    стоимость_брутто: round2_(grossCost),
    стоимость_отхода: wasteCost,
    user_id: session.user_id || '',
    дата: nowIso_(),
    cascade_id: session.cascade_id || ''
  };
  insertRow_('SALE_INGREDIENT_USAGE', usage);

  var wasteRecord = null;
  var journal = null;
  if (waste > 0.0001) {
    wasteRecord = {
      waste_id: generateId_('WASTE_RECORDS'),
      organization_id: session.organization_id,
      location_id: sale.location_id,
      workshop_id: '',
      production_id: '',
      sale_id: sale.sale_id,
      ttk_version_id: ttk.ttk_version_id,
      dish_id: sale.dish_id,
      product_id: item.product_id,
      batch_ids: JSON.stringify(batchIds),
      причина: 'Отход по ТТК при исполнении продажи',
      единица: item.единица,
      брутто: item.gross,
      нетто: item.net,
      отход: round2_(waste),
      процент_отхода: pct,
      сумма: wasteCost,
      user_id: session.user_id || '',
      дата: nowIso_(),
      cascade_id: session.cascade_id || '',
      journal_id: ''
    };
    journal = addJournalEntry_(sale.location_id, 'Отходы производства', JSON.stringify({
      waste_id:wasteRecord.waste_id, sale_id:sale.sale_id, ttk_version_id:ttk.ttk_version_id,
      dish_id:sale.dish_id, product_id:item.product_id, batch_ids:batchIds,
      брутто:item.gross, нетто:item.net, отход:round2_(waste), процент_отхода:pct,
      единица:item.единица, сумма:wasteCost, источник:'продажа_по_ТТК'
    }), session.user_id, session.organization_id, '', '', session.cascade_id || '', ttk.ppk_id || '', '');
    wasteRecord.journal_id = journal.journal_id;
    insertRow_('WASTE_RECORDS', wasteRecord);
  }
  cascadeStep_(session.cascade_id, 'sale_ingredient_usage:' + item.product_id);
  return { usage:usage, waste:wasteRecord, journal:journal, grossCost:grossCost, wasteCost:wasteCost };
}

function fulfillSaleByTtk_(saleId, session) {
  return withLock_(function(){
    var sale = findOne_('SALES','sale_id',saleId);
    if (!sale) throw new Error('Продажа не найдена: ' + saleId);
    assertOwnedByOrg_(session, sale, 'SALES:' + saleId);
    if (sale.location_id !== session.location_id) throw new Error('Продажа относится к другой точке.');
    if (sale.исполнение_статус === 'исполнено') return getSaleTrace_(session,{saleId:saleId});
    if (sale.исполнение_статус === 'в_работе') throw new Error('Исполнение продажи уже выполняется.');

    var prepared = _saleFulfillmentRecipe_(sale.dish_id, session);
    var lines = _saleGrossNetLines_(prepared.recipe, Number(sale.qty));
    _preflightSaleFulfillment_(lines, sale.location_id);
    updateRow_('SALES', sale, {исполнение_статус:'в_работе', ttk_version_id:prepared.ttk.ttk_version_id});

    var results = [];
    var actualCost = 0;
    var wasteCost = 0;
    try {
      lines.forEach(function(item){
        var consumption = consumeStock_(item.product_id, sale.location_id, item.gross, OP_TYPES.ISSUE, session.user_id, session);
        var r = _recordSaleIngredientUsage_(sale, item, consumption, prepared.ttk, session);
        actualCost += r.grossCost;
        wasteCost += r.wasteCost;
        results.push(r);
      });
      var revenue = Number(sale.сумма) || 0;
      var factFoodCost = revenue > 0 ? round2_(actualCost / revenue * 100) : 0;
      updateRow_('SALES', sale, {
        исполнение_статус:'исполнено', исполнено_в:nowIso_(), ttk_version_id:prepared.ttk.ttk_version_id,
        фактическая_себестоимость_сырья:round2_(actualCost), стоимость_отходов:round2_(wasteCost),
        food_cost_факт:factFoodCost
      });
      auditLog_(session.user_id,'Продажа исполнена по ТТК','SALES:'+sale.sale_id,'в_работе','исполнено','success',session.cascade_id||'');
      cascadeStep_(session.cascade_id,'sale_fulfillment');
      if (typeof recordHaccpEvidence_ === 'function') { try { recordHaccpEvidence_({batchId:(results[0]&&results[0].usage&&JSON.parse(results[0].usage.batch_ids||'[]')[0])||'',result:'PASS',evidence:{event:'SALE_FULFILLMENT',sale_id:sale.sale_id,dish_id:sale.dish_id,ttk_version_id:prepared.ttk.ttk_version_id,actual_cost:round2_(actualCost),food_cost_fact:factFoodCost,cascade_id:session.cascade_id||''}},session); } catch(e) {} }
      return {sale:findOne_('SALES','sale_id',saleId),ttk:prepared.ttk,ingredient_usage:results.map(function(x){return x.usage;}),waste:results.map(function(x){return x.waste;}).filter(Boolean),actual_cost:round2_(actualCost),waste_cost:round2_(wasteCost),food_cost_fact:factFoodCost};
    } catch (e) {
      var fresh = findOne_('SALES','sale_id',saleId);
      if (fresh) updateRow_('SALES',fresh,{исполнение_статус:'ошибка_исполнения',ошибка_исполнения:String(e.message||e),ttk_version_id:prepared.ttk.ttk_version_id});
      throw e;
    }
  });
}

function createSaleAndFulfill_(data, userId, session) {
  return withLock_(function(){
    var dish = findOne_('DISHES','dish_id',data.dishId);
    assertOwnedByOrg_(session,dish,'DISHES:'+data.dishId);
    var qty = Number(data.qty);
    if (!qty || qty <= 0) throw new Error('Количество должно быть положительным числом.');
    var price = data.цена_продажи !== undefined && data.цена_продажи !== null && data.цена_продажи !== '' ? Number(data.цена_продажи) : Number(dish.цена_продажи)||0;
    if (isNaN(price) || price < 0) throw new Error('Некорректная цена продажи.');
    var prepared = _saleFulfillmentRecipe_(dish.dish_id,session);
    var lines = _saleGrossNetLines_(prepared.recipe,qty);
    _preflightSaleFulfillment_(lines,session.location_id);

    var sale = createSale_({dishId:dish.dish_id,qty:qty,цена_продажи:price,дата:data.дата,locationId:session.location_id,источник:data.источник||'продажа_по_ТТК'},userId,session);
    var saleRow = findOne_('SALES','sale_id',sale.sale_id);
    updateRow_('SALES',saleRow,{исполнение_статус:'подготовлено',ttk_version_id:prepared.ttk.ttk_version_id});
    return fulfillSaleByTtk_(sale.sale_id,session);
  });
}

function getSaleTrace_(session,data) {
  var sale=findOne_('SALES','sale_id',data.saleId);
  if (!sale) throw new Error('Продажа не найдена.');
  assertOwnedByOrg_(session,sale,'SALES:'+data.saleId);
  if (sale.location_id !== session.location_id) throw new Error('Продажа относится к другой точке.');
  var usage=findRows_('SALE_INGREDIENT_USAGE',function(r){return r.sale_id===sale.sale_id;});
  var wastes=findRows_('WASTE_RECORDS',function(r){return r.sale_id===sale.sale_id;});
  var journals=wastes.map(function(w){return w.journal_id?findOne_('JOURNALS','journal_id',w.journal_id):null;}).filter(Boolean);
  var batchIds=[];
  usage.forEach(function(u){try{JSON.parse(u.batch_ids||'[]').forEach(function(id){if(batchIds.indexOf(id)===-1)batchIds.push(id);});}catch(e){}});
  var batches=batchIds.map(function(id){return findOne_('BATCHES','batch_id',id);}).filter(Boolean);
  var ops=findRows_('WAREHOUSE_OPS',function(r){return r.cascade_id===sale.cascade_id && r.organization_id===session.organization_id && r.location_id===session.location_id && batchIds.indexOf(r.batch_id)!==-1;});
  var ttk=sale.ttk_version_id?findOne_('TTK_VERSIONS','ttk_version_id',sale.ttk_version_id):null;
  return {sale:sale,ttk:ttk,ingredient_usage:usage,waste:wastes,journals:journals,batches:batches,warehouse_ops:ops,cascade_id:sale.cascade_id||''};
}
