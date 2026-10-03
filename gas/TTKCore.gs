// ЦЕХ — TTKCore.gs
// ТТК/ТК: версия, утверждение, нормативные связи, HACCP/ППК, Food Cost.
// ТТК хранит документ и процесс; рецептурные строки остаются в RECIPES.

var TTK_STATUSES = ['черновик','на_согласовании','утверждена','архив'];

function _ttkDish_(dishId, session) {
  var dish = findOne_('DISHES', 'dish_id', dishId);
  if (!dish) throw new Error('Блюдо не найдено: ' + dishId);
  if (session) assertOwnedByOrg_(session, dish, 'DISHES:' + dishId);
  return dish;
}

function _ttkRows_(table, predicate) {
  return typeof findRows_ === 'function' ? findRows_(table, predicate) : [];
}

function _ttkCurrent_(dishId) {
  var rows = _ttkRows_('TTK_VERSIONS', function(r){ return r.dish_id === dishId && r.status === 'утверждена'; });
  rows.sort(function(a,b){ return Number(b.version||0)-Number(a.version||0); });
  return rows[0] || null;
}

function getCurrentTtk_(dishId, session) {
  _ttkDish_(dishId, session);
  return _ttkCurrent_(dishId);
}

function _ttkRecipeSnapshot_(dishId, session) {
  var lines = getRecipeLines_('DISH', dishId, session);
  if (!lines.length) throw new Error('Нельзя утвердить ТТК без рецептуры.');
  return lines.map(function(r){
    var ing = String(r.product_id).indexOf('PF-') === 0 ? getSemiFinishedById_(r.product_id) : getProductById_(r.product_id);
    if (!ing) throw new Error('Ингредиент не найден: ' + r.product_id);
    return { recipe_id:r.recipe_id, product_id:r.product_id, брутто:Number(r.брутто)||0, нетто:Number(r.нетто)||0, единица:r.единица||'', потери_процент:Number(r.потери_процент)||0, ingredient_name:ing.название||'' };
  });
}

function _ttkValidate_(dish, data, session) {
  var recipe = _ttkRecipeSnapshot_(dish.dish_id, session);
  if (!(Number(dish.выход) > 0)) throw new Error('У блюда должен быть положительный выход.');
  if (!data.технология || String(data.технология).trim().length < 10) throw new Error('Технология ТТК должна содержать описание процесса.');
  if (!data.условия_хранения) throw new Error('Укажите условия хранения.');
  if (!data.срок_реализации) throw new Error('Укажите срок реализации/хранения.');
  return recipe;
}

function createTtkVersion_(data, session) {
  return withLock_(function(){
    var dish = _ttkDish_(data.dishId, session);
    var recipe = _ttkValidate_(dish, data, session);
    var versions = _ttkRows_('TTK_VERSIONS', function(r){ return r.dish_id === dish.dish_id; });
    var next = versions.reduce(function(m,r){ return Math.max(m, Number(r.version)||0); },0)+1;
    var ppk = typeof getCurrentPpk_ === 'function' ? getCurrentPpk_(session.organization_id) : null;
    var row = {
      ttk_version_id: generateId_('TTK_VERSIONS'), dish_id:dish.dish_id, organization_id:session.organization_id,
      version:next, status:'черновик', источник:data.источник||'Собственная разработка', область_применения:data.область_применения||dish.название,
      технология:String(data.технология), условия_хранения:String(data.условия_хранения), срок_реализации:String(data.срок_реализации),
      показатели_качества:data.показатели_качества||'', пищевая_ценность:data.пишевая_ценность||data.пищевая_ценность||'', аллергенная_информация:data.аллергенная_информация||'',
      технологические_этапы_json:JSON.stringify(Array.isArray(data.технологическиеЭтапы)?data.технологическиеЭтапы:[]),
      ppk_id:ppk ? ppk.ppk_id : '', created_at:nowIso_(), created_by:session.user_id, approved_at:'', approved_by:'', archived_at:'',
      recipe_snapshot_json:JSON.stringify(recipe), cost_snapshot:Number(dish.себестоимость)||0, food_cost_snapshot:Number(dish.food_cost)||0
    };
    insertRow_('TTK_VERSIONS', row);
    if (typeof detectAndRequestPpkReview_ === 'function') detectAndRequestPpkReview_(session.organization_id,session.location_id,'RECIPE_CHANGED','TTK_VERSIONS',row.ttk_version_id,session.user_id,session,'Создана новая версия ТТК; требуется проверка влияния на ППК/HACCP.');
    auditLog_(session.user_id,'Создана версия ТТК','TTK_VERSIONS:'+row.ttk_version_id,'', 'v'+next,'success',session.cascade_id||'');
    return row;
  });
}


function updateTtkDraft_(ttkId, data, session) {
  return withLock_(function(){
    var row=findOne_('TTK_VERSIONS','ttk_version_id',ttkId); assertOwnedByOrg_(session,row,'TTK_VERSIONS:'+ttkId);
    if(row.status!=='черновик') throw new Error('Редактировать можно только черновик ТТК.');
    var dish=_ttkDish_(row.dish_id,session);
    var recipe=_ttkValidate_(dish,data,session);
    var patch={};
    ['источник','область_применения','технология','условия_хранения','срок_реализации','показатели_качества','пищевая_ценность','аллергенная_информация'].forEach(function(k){if(data[k]!==undefined)patch[k]=String(data[k]||'');});
    if(data.технологическиеЭтапы!==undefined) patch.технологические_этапы_json=JSON.stringify(Array.isArray(data.технологическиеЭтапы)?data.технологическиеЭтапы:[]);
    patch.recipe_snapshot_json=JSON.stringify(recipe);
    patch.cost_snapshot=Number(dish.себестоимость)||0;
    patch.food_cost_snapshot=Number(dish.food_cost)||0;
    updateRow_('TTK_VERSIONS',row,patch);
    return findOne_('TTK_VERSIONS','ttk_version_id',ttkId);
  });
}

function submitTtkForApproval_(ttkId, session) {
  var row=findOne_('TTK_VERSIONS','ttk_version_id',ttkId); assertOwnedByOrg_(session,row,'TTK_VERSIONS:'+ttkId);
  if (row.status !== 'черновик') throw new Error('На согласование можно отправить только черновик ТТК.');
  var dish=_ttkDish_(row.dish_id,session);
  var currentRecipe=_ttkRecipeSnapshot_(dish.dish_id,session);
  row.recipe_snapshot_json=JSON.stringify(currentRecipe);
  updateRow_('TTK_VERSIONS',row,{status:'на_согласовании',recipe_snapshot_json:row.recipe_snapshot_json,submitted_at:nowIso_(),submitted_by:session.user_id});
  return findOne_('TTK_VERSIONS','ttk_version_id',ttkId);
}

function approveTtkVersion_(ttkId, session) {
  return withLock_(function(){
    var row=findOne_('TTK_VERSIONS','ttk_version_id',ttkId); assertOwnedByOrg_(session,row,'TTK_VERSIONS:'+ttkId);
    if (row.status !== 'на_согласовании') throw new Error('Утвердить можно только ТТК на согласовании.');
    var dish=_ttkDish_(row.dish_id,session);
    var recipe=_ttkRecipeSnapshot_(dish.dish_id,session);
    if (JSON.stringify(recipe)!==String(row.recipe_snapshot_json||'')) throw new Error('Рецептура изменилась после создания версии ТТК. Создайте новую версию.');
    var current=_ttkCurrent_(dish.dish_id);
    if (current && current.ttk_version_id!==row.ttk_version_id) updateRow_('TTK_VERSIONS',current,{status:'архив',archived_at:nowIso_(),archived_by:session.user_id});
    updateRow_('TTK_VERSIONS',row,{status:'утверждена',approved_at:nowIso_(),approved_by:session.user_id});
    auditLog_(session.user_id,'Утверждена ТТК','TTK_VERSIONS:'+ttkId,'на_согласовании','утверждена','success',session.cascade_id||'');
    return findOne_('TTK_VERSIONS','ttk_version_id',ttkId);
  });
}

function getTtkVersions_(dishId, session) {
  _ttkDish_(dishId,session);
  return _ttkRows_('TTK_VERSIONS',function(r){return r.dish_id===dishId;}).sort(function(a,b){return Number(b.version||0)-Number(a.version||0);});
}


function getTtkEditorContext_(dishId, session, ttkVersionId) {
  var dish=_ttkDish_(dishId,session);
  var versions=getTtkVersions_(dishId,session);
  var selected=null;
  if (ttkVersionId) {
    selected=findOne_('TTK_VERSIONS','ttk_version_id',ttkVersionId);
    assertOwnedByOrg_(session,selected,'TTK_VERSIONS:'+ttkVersionId);
    if (selected.dish_id!==dishId) throw new Error('Версия ТТК относится к другому блюду.');
  } else {
    selected=versions[0]||null;
  }
  var selectedId=selected?selected.ttk_version_id:'';
  var haccp=_ttkRows_('TTK_HACCP_LINKS',function(r){return r.ttk_version_id===selectedId;});
  var sanpin=_ttkRows_('TTK_SANPIN_LINKS',function(r){return r.ttk_version_id===selectedId;});
  var ppk=null, controls=[], limits=[], stages=[];
  try {
    ppk=typeof getCurrentPpk_==='function'?getCurrentPpk_(session.organization_id):null;
    if(ppk){
      controls=typeof getPpkControls_==='function'?getPpkControls_(session,{ppkId:ppk.ppk_id,locationId:session.location_id}):[];
      var model=typeof getPpkModel_==='function'?getPpkModel_(session,{ppkId:ppk.ppk_id,locationId:session.location_id}):null;
      if(model){ limits=model.limits||[]; stages=model.stages||[]; }
    }
  } catch(e) {}
  var stagesJson=selected&&selected.технологические_этапы_json?selected.технологические_этапы_json:'[]';
  var steps=[]; try{steps=JSON.parse(stagesJson||'[]');if(!Array.isArray(steps))steps=[];}catch(e){steps=[];}
  return {dish:dish,versions:versions,selected_ttk:selected,recipes:getRecipeLines_('DISH',dishId,session),haccp_links:haccp,sanpin_links:sanpin,ppk:ppk,ppk_controls:controls,ppk_limits:limits,ppk_stages:stages,technology_steps:steps,food_cost:{себестоимость:Number(dish.себестоимость)||0,food_cost:Number(dish.food_cost)||0,маржа:Number(dish.маржа)||0}};
}

function createTtkHaccpLink_(data, session) {
  var ttk=findOne_('TTK_VERSIONS','ttk_version_id',data.ttkVersionId); assertOwnedByOrg_(session,ttk,'TTK_VERSIONS:'+data.ttkVersionId);
  if (ttk.status==='архив') throw new Error('Нельзя менять архивную ТТК.');
  var ppk=typeof getCurrentPpk_==='function'?getCurrentPpk_(session.organization_id):null;
  var link={link_id:generateId_('TTK_HACCP_LINKS'),organization_id:session.organization_id,ttk_version_id:ttk.ttk_version_id,ppk_id:data.ppkId||(ppk?ppk.ppk_id:''),hazard_id:data.hazardId||'',control_id:data.controlId||'',stage_id:data.stageId||'',control_type:data.controlType||'',critical_limit_id:data.criticalLimitId||'',status:'активна',created_at:nowIso_(),created_by:session.user_id};
  insertRow_('TTK_HACCP_LINKS',link); return link;
}

function createTtkSanpinLink_(data, session) {
  var ttk=findOne_('TTK_VERSIONS','ttk_version_id',data.ttkVersionId); assertOwnedByOrg_(session,ttk,'TTK_VERSIONS:'+data.ttkVersionId);
  var link={link_id:generateId_('TTK_SANPIN_LINKS'),organization_id:session.organization_id,ttk_version_id:ttk.ttk_version_id,requirement_id:data.requirementId||'',clause:data.clause||'',source_document:data.sourceDocument||'',status:'активна',created_at:nowIso_(),created_by:session.user_id};
  insertRow_('TTK_SANPIN_LINKS',link); return link;
}

function getTtkContext_(dishId, session) {
  var dish=_ttkDish_(dishId,session), current=_ttkCurrent_(dishId);
  var ttkId=current?current.ttk_version_id:'';
  return {dish:dish,current_ttk:current,recipes:getRecipeLines_('DISH',dishId,session),haccp_links:_ttkRows_('TTK_HACCP_LINKS',function(r){return r.ttk_version_id===ttkId;}),sanpin_links:_ttkRows_('TTK_SANPIN_LINKS',function(r){return r.ttk_version_id===ttkId;}),food_cost:{себестоимость:Number(dish.себестоимость)||0,food_cost:Number(dish.food_cost)||0,маржа:Number(dish.маржа)||0},production_ready:!!current};
}

function checkTtkProductionGate_(parentType,parentId,session) {
  if (parentType!=='DISH') return {allowed:true,reason:'ПФ не требует ТТК блюда.'};
  // В старых организациях/тестовых контурах ППК ещё может отсутствовать.
  // Жёсткий нормативный gate включаем, когда у организации есть ППК-контур.
  var ppk = typeof getCurrentPpk_ === 'function' ? getCurrentPpk_(session.organization_id) : null;
  if (!ppk) return {allowed:true,legacy:true,reason:'ППК не активирован; действует legacy-режим.'};
  var ttk=_ttkCurrent_(parentId);
  if (!ttk) return {allowed:false,reason:'Нет утверждённой ТТК для блюда при активном ППК.'};
  return {allowed:true,ttk_version_id:ttk.ttk_version_id,version:ttk.version};
}
