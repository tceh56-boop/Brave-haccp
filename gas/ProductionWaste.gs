/**
 * ЦЕХ — ProductionWaste.gs
 * Автоматический учёт брутто/нетто/отходов по утверждённой ТТК.
 *
 * Принцип:
 *   брутто = фактически израсходовано со склада;
 *   нетто   = технологически использовано в блюде;
 *   отход   = брутто - нетто.
 *
 * Все записи получают один cascade_id с производственной операцией.
 */

function _productionWasteTtk_(task, session) {
  if (!task || task.parent_type !== 'DISH' || typeof getCurrentTtk_ !== 'function') return null;
  return getCurrentTtk_(task.parent_id, session) || null;
}

function _recipeNetPerUnit_(line) {
  var gross = Number(line.брутто) || 0;
  var rawNet = line.нетто;
  if (rawNet !== undefined && rawNet !== null && rawNet !== '' && !isNaN(Number(rawNet))) {
    return Number(rawNet);
  }
  var loss = Number(line.потери_процент) || 0;
  if (loss > 0) return gross * (1 - loss / 100);
  return gross;
}

function _assertGrossNet_(gross, net, name) {
  if (gross < -0.0001 || net < -0.0001) throw new Error('Отрицательные брутто/нетто для "' + name + '" недопустимы.');
  if (net - gross > 0.0001) throw new Error('Нетто больше брутто для "' + name + '": ' + net + ' > ' + gross + '. Проверьте ТТК.');
}

function _recordProductionIngredientUsage_(task, line, consumption, gross, net, session, ttk) {
  var product = String(line.product_id).indexOf('PF-') === 0 ? getSemiFinishedById_(line.product_id) : getProductById_(line.product_id);
  var unit = line.единица || (product && product.единица) || '';
  var waste = Math.max(0, gross - net);
  var wasteCost = 0;
  var batchIds = [];
  (consumption.распределение || []).forEach(function(part){
    batchIds.push(part.batch_id);
    if (gross > 0) wasteCost += (waste * (Number(part.количество)||0) / gross) * (Number(part.цена)||0);
  });
  var grossCost = Number(consumption.сумма) || 0;
  var pct = gross > 0 ? round2_(waste / gross * 100) : 0;
  var usage = {
    usage_id: generateId_('PRODUCTION_INGREDIENT_USAGE'),
    organization_id: session.organization_id,
    location_id: task.location_id,
    workshop_id: task.workshop_id || '',
    production_id: task.production_id,
    ttk_version_id: ttk ? ttk.ttk_version_id : '',
    dish_id: task.parent_type === 'DISH' ? task.parent_id : '',
    product_id: line.product_id,
    batch_ids: JSON.stringify(batchIds),
    единица: unit,
    брутто: round2_(gross),
    нетто: round2_(net),
    отход: round2_(waste),
    процент_отхода: pct,
    стоимость_брутто: round2_(grossCost),
    стоимость_отхода: round2_(wasteCost),
    user_id: session.user_id || '',
    дата: nowIso_(),
    cascade_id: session.cascade_id || ''
  };
  insertRow_('PRODUCTION_INGREDIENT_USAGE', usage);

  var journal = null;
  if (waste > 0.0001) {
    var wasteRecord = {
      waste_id: generateId_('WASTE_RECORDS'),
      organization_id: session.organization_id,
      location_id: task.location_id,
      workshop_id: task.workshop_id || '',
      production_id: task.production_id,
      ttk_version_id: ttk ? ttk.ttk_version_id : '',
      dish_id: task.parent_type === 'DISH' ? task.parent_id : '',
      product_id: line.product_id,
      batch_ids: JSON.stringify(batchIds),
      причина: 'Отход по ТТК при первичной/технологической обработке',
      единица: unit,
      брутто: round2_(gross),
      нетто: round2_(net),
      отход: round2_(waste),
      процент_отхода: pct,
      сумма: round2_(wasteCost),
      user_id: session.user_id || '',
      дата: nowIso_(),
      cascade_id: session.cascade_id || '',
      journal_id: ''
    };
    journal = addJournalEntry_(task.location_id, 'Отходы производства', JSON.stringify({
      waste_id:wasteRecord.waste_id, production_id:task.production_id, ttk_version_id:wasteRecord.ttk_version_id,
      dish_id:wasteRecord.dish_id, product_id:line.product_id, batch_ids:batchIds,
      брутто:wasteRecord.брутто, нетто:wasteRecord.нетто, отход:wasteRecord.отход,
      процент_отхода:pct, единица:unit, сумма:wasteRecord.сумма
    }), session.user_id, session.organization_id, task.workshop_id || '', '', session.cascade_id || '', ttk ? ttk.ppk_id : '', '');
    wasteRecord.journal_id = journal.journal_id;
    insertRow_('WASTE_RECORDS', wasteRecord);
  }
  cascadeStep_(session.cascade_id, 'production_ingredient_usage:' + line.product_id);
  return {usage:usage,waste:waste > 0.0001 ? findOne_('WASTE_RECORDS','waste_id',wasteRecord.waste_id) : null,journal:journal};
}

function getProductionWaste_(session, data) {
  var productionId = data && data.productionId ? data.productionId : '';
  var dishId = data && data.dishId ? data.dishId : '';
  var rows = findRows_('WASTE_RECORDS', function(r){
    if (r.organization_id !== session.organization_id) return false;
    if (r.location_id !== session.location_id) return false;
    if (productionId && r.production_id !== productionId) return false;
    if (dishId && r.dish_id !== dishId) return false;
    return true;
  });
  return rows.sort(function(a,b){return new Date(b.дата)-new Date(a.дата);});
}

function getWasteTrace_(session, data) {
  var waste = findOne_('WASTE_RECORDS','waste_id',data.wasteId);
  if (!waste) throw new Error('Запись отхода не найдена.');
  assertOwnedByOrg_(session, findOne_('PRODUCTS','product_id',waste.product_id), 'WASTE_RECORDS:'+data.wasteId);
  if (waste.location_id !== session.location_id) throw new Error('Запись отхода относится к другой точке.');
  var batches = [];
  try { batches = JSON.parse(waste.batch_ids || '[]'); } catch(e) {}
  var batchRows = batches.map(function(id){ return findOne_('BATCHES','batch_id',id); }).filter(Boolean);
  var usage = findRows_('PRODUCTION_INGREDIENT_USAGE',function(r){return r.production_id===waste.production_id && r.product_id===waste.product_id;});
  var journals = waste.journal_id ? [findOne_('JOURNALS','journal_id',waste.journal_id)].filter(Boolean) : [];
  var production = waste.production_id ? findOne_('PRODUCTION','production_id',waste.production_id) : null;
  var sale = waste.sale_id ? findOne_('SALES','sale_id',waste.sale_id) : null;
  if (sale) assertOwnedByOrg_(session, sale, 'SALES:' + waste.sale_id);
  var saleUsage = sale ? findRows_('SALE_INGREDIENT_USAGE',function(r){return r.sale_id===sale.sale_id && r.product_id===waste.product_id;}) : [];
  var ttk = waste.ttk_version_id ? findOne_('TTK_VERSIONS','ttk_version_id',waste.ttk_version_id) : null;
  var ops = findRows_('WAREHOUSE_OPS',function(r){return r.organization_id===session.organization_id && r.location_id===session.location_id && batches.indexOf(r.batch_id)!==-1 && r.cascade_id===waste.cascade_id;});
  return {waste:waste,production:production,sale:sale,sale_usage:saleUsage,ttk:ttk,batches:batchRows,usage:usage,journals:journals,warehouse_ops:ops,cascade_id:waste.cascade_id};
}
