/**
 * ЦЕХ — BreakdownCore.gs
 * Акт разбора сырья / дефроста / зачистки / разделки.
 *
 * Идея: приход крупной сырьевой партии может автоматически порождать КАНБАН-задачи
 * по утверждённой карте разбора. Фактическое списание сырья и приход нескольких
 * полуфабрикатов выполняются только при закрытии акта — одним cascade_id.
 */

var BREAKDOWN_STATUSES = ['ПЛАН','В_РАБОТЕ','ЗАКРЫТ','ОТМЕНЁН'];
var BREAKDOWN_TASK_STATUSES = ['ПЛАН','В_РАБОТЕ','ГОТОВО','ОТМЕНЁН'];

function _breakdownPlanOwned_(plan, session) {
  if (!plan) throw new Error('Карта разбора не найдена.');
  if (session) assertOwnedByOrg_(session, plan, 'BREAKDOWN_PLANS:' + plan.plan_id);
  return plan;
}

function _breakdownStepOwned_(step, session) {
  if (!step) throw new Error('Этап карты разбора не найден.');
  if (session) assertOwnedByOrg_(session, step, 'BREAKDOWN_PLAN_STEPS:' + step.step_id);
  return step;
}

function _validateBreakdownStep_(step) {
  if (!step || !String(step.название || '').trim()) throw new Error('У этапа карты разбора должно быть название.');
  var type = String(step.stageType || step.stage_type || 'ЗАЧИСТКА');
  var allowed = ['РАЗМОРОЗКА','ЗАЧИСТКА','РАЗДЕЛКА','НАРЕЗКА','ФОРМОВКА','ТЕПЛОВАЯ_ОБРАБОТКА','ОХЛАЖДЕНИЕ','ФАСОВКА','ДРУГОЕ'];
  if (allowed.indexOf(type) < 0) throw new Error('Неизвестный тип этапа разбора: ' + type);
  if (Number(step.stepNo || step.step_no || 0) <= 0) throw new Error('Номер этапа должен быть больше нуля.');
  if (Number(step.expectedLossPct || step.expected_loss_pct || 0) < 0 || Number(step.expectedLossPct || step.expected_loss_pct || 0) > 100) throw new Error('Процент потерь этапа должен быть от 0 до 100.');
}

function createBreakdownPlanStep_(data, session) {
  return withLock_(function(){
    var plan = _breakdownPlanOwned_(findOne_('BREAKDOWN_PLANS','plan_id',data.planId), session);
    if (plan.status === 'APPROVED') throw new Error('Утверждённую карту нельзя менять. Создайте новую версию.');
    _validateBreakdownStep_(data);
    var existing=findRows_('BREAKDOWN_PLAN_STEPS',function(r){return r.plan_id===plan.plan_id && Number(r.step_no)===Number(data.stepNo);});
    if(existing.length) throw new Error('Этап №'+data.stepNo+' уже существует в карте.');
    var row={
      step_id:generateId_('BREAKDOWN_PLAN_STEPS'), plan_id:plan.plan_id, organization_id:session.organization_id,
      step_no:Number(data.stepNo), stage_type:String(data.stageType||'ЗАЧИСТКА'), название:String(data.название),
      описание:String(data.описание||''), equipment:String(data.equipment||''), temperature_min:data.temperatureMin!==undefined?Number(data.temperatureMin):'',
      temperature_max:data.temperatureMax!==undefined?Number(data.temperatureMax):'', time_minutes:data.timeMinutes!==undefined?Number(data.timeMinutes):'',
      input_basis_qty:data.inputBasisQty!==undefined?Number(data.inputBasisQty):Number(plan.inputBasisQty)||1,
      expected_loss_pct:Number(data.expectedLossPct||0), expected_output_qty:data.expectedOutputQty!==undefined?Number(data.expectedOutputQty):'',
      output_unit:String(data.outputUnit||plan.input_unit||''), haccp_control_id:String(data.haccpControlId||''),
      required_confirmation:data.requiredConfirmation!==false?'Да':'Нет', status:'активен', created_at:nowIso_()
    };
    insertRow_('BREAKDOWN_PLAN_STEPS',row);
    auditLog_(session.user_id,'Добавлен этап карты разбора','BREAKDOWN_PLAN_STEPS:'+row.step_id,'','создан','success',session.cascade_id||'');
    return getBreakdownPlanMap_(plan.plan_id,session);
  });
}

function getBreakdownPlanMap_(planId, session) {
  var bundle=getBreakdownPlan_(planId,session);
  bundle.steps=findRows_('BREAKDOWN_PLAN_STEPS',function(r){return r.plan_id===planId;}).sort(function(a,b){return Number(a.step_no)-Number(b.step_no);});
  bundle.map=bundle.steps.map(function(step){
    var outputs=bundle.outputs.filter(function(o){return Number(o.step_no||o.приоритет||0)===Number(step.step_no);});
    return {step:step,outputs:outputs};
  });
  return bundle;
}

function _breakdownPlanExpected_(plan, qty, session) {
  var steps=findRows_('BREAKDOWN_PLAN_STEPS',function(r){return r.plan_id===plan.plan_id && r.status==='активен';}).sort(function(a,b){return Number(a.step_no)-Number(b.step_no);});
  var current=Number(qty)||0;
  return steps.map(function(step){
    var loss=Number(step.expected_loss_pct)||0;
    var input=current;
    var output=step.expected_output_qty!=='' && step.expected_output_qty!==undefined ? Number(step.expected_output_qty)*(qty/(Number(plan.input_basis_qty)||1)) : input*(1-loss/100);
    current=round2_(output);
    return {step:step,input_qty:round2_(input),expected_loss_qty:round2_(input-output),expected_output_qty:current};
  });
}

function createBreakdownPlan_(data, session) {
  return withLock_(function () {
    if (!data.inputProductId) throw new Error('inputProductId обязателен.');
    var product = getProductById_(data.inputProductId);
    assertOwnedByOrg_(session, product, 'PRODUCTS:' + data.inputProductId);
    var plan = {
      plan_id: generateId_('BREAKDOWN_PLANS'), organization_id: session.organization_id,
      название: data.название || ('Разбор ' + product.название), input_product_id: data.inputProductId,
      input_unit: data.inputUnit || product.единица || 'кг', input_basis_qty: Number(data.inputBasisQty) || 1,
      thaw_loss_pct: Number(data.thawLossPct) || 0, trim_loss_pct: Number(data.trimLossPct) || 0,
      status: data.status || 'DRAFT', version: Number(data.version) || 1,
      workshop_id: data.workshopId || '', created_at: nowIso_(), created_by: session.user_id,
      approved_at: '', approved_by: ''
    };
    insertRow_('BREAKDOWN_PLANS', plan);
    (data.outputs || []).forEach(function (o, idx) {
      _assertBreakdownOutput_(o, session);
      insertRow_('BREAKDOWN_PLAN_OUTPUTS', {
        output_id: generateId_('BREAKDOWN_PLAN_OUTPUTS'), plan_id: plan.plan_id,
        organization_id: session.organization_id, step_no: Number(o.stepNo || o.step_no || o.priority || idx + 1), output_type: o.outputType || 'PF', output_id_ref: o.outputId,
        название: o.название || '', planned_qty: Number(o.plannedQty) || 0,
        единица: o.единица || '', доля_распределения: Number(o.allocationShare) || 0,
        приоритет: Number(o.priority) || idx + 1, task_title: o.taskTitle || ('Получить ' + (o.название || o.outputId)),
        status: 'активна', created_at: nowIso_()
      });
    });
    (data.steps || []).forEach(function(step){
      _validateBreakdownStep_(step);
      var existing=findRows_('BREAKDOWN_PLAN_STEPS',function(r){return r.plan_id===plan.plan_id && Number(r.step_no)===Number(step.stepNo);});
      if(existing.length) throw new Error('Этап №'+step.stepNo+' повторяется в карте.');
      insertRow_('BREAKDOWN_PLAN_STEPS',{
        step_id:generateId_('BREAKDOWN_PLAN_STEPS'),plan_id:plan.plan_id,organization_id:session.organization_id,step_no:Number(step.stepNo),
        stage_type:String(step.stageType||'ЗАЧИСТКА'),название:String(step.название),описание:String(step.описание||''),equipment:String(step.equipment||''),
        temperature_min:step.temperatureMin!==undefined?Number(step.temperatureMin):'',temperature_max:step.temperatureMax!==undefined?Number(step.temperatureMax):'',
        time_minutes:step.timeMinutes!==undefined?Number(step.timeMinutes):'',input_basis_qty:step.inputBasisQty!==undefined?Number(step.inputBasisQty):Number(plan.input_basis_qty)||1,
        expected_loss_pct:Number(step.expectedLossPct||0),expected_output_qty:step.expectedOutputQty!==undefined?Number(step.expectedOutputQty):'',
        output_unit:String(step.outputUnit||plan.input_unit||''),haccp_control_id:String(step.haccpControlId||''),required_confirmation:step.requiredConfirmation!==false?'Да':'Нет',status:'активен',created_at:nowIso_()
      });
    });
    return getBreakdownPlanMap_(plan.plan_id, session);
  });
}

function _assertBreakdownOutput_(o, session) {
  if (!o || !o.outputId) throw new Error('В карте разбора указан полуфабрикат/продукт без outputId.');
  var entity = String(o.outputType || 'PF') === 'PF' ? getSemiFinishedById_(o.outputId) : getProductById_(o.outputId);
  assertOwnedByOrg_(session, entity, 'BREAKDOWN_OUTPUT:' + o.outputId);
  if (Number(o.plannedQty) <= 0) throw new Error('Плановый выход должен быть больше нуля.');
}

function getBreakdownPlan_(planId, session) {
  var plan = _breakdownPlanOwned_(findOne_('BREAKDOWN_PLANS','plan_id',planId), session);
  var outputs = findRows_('BREAKDOWN_PLAN_OUTPUTS', function(r){ return r.plan_id === plan.plan_id; });
  return {plan:plan, outputs:outputs};
}

function getBreakdownPlans_(session, inputProductId) {
  return findRows_('BREAKDOWN_PLANS', function(p){
    return p.organization_id === session.organization_id && (!inputProductId || p.input_product_id === inputProductId);
  }).map(function(p){ return getBreakdownPlan_(p.plan_id, session); });
}

function _activeBreakdownPlanForReceipt_(organizationId, productId) {
  var rows = findRows_('BREAKDOWN_PLANS', function(p){
    return p.organization_id === organizationId && p.input_product_id === productId && p.status === 'APPROVED';
  });
  rows.sort(function(a,b){ return Number(b.version||0)-Number(a.version||0); });
  return rows[0] || null;
}

function approveBreakdownPlan_(planId, session) {
  return withLock_(function(){
    var plan = _breakdownPlanOwned_(findOne_('BREAKDOWN_PLANS','plan_id',planId), session);
    if (plan.status !== 'DRAFT' && plan.status !== 'REVIEW') throw new Error('Утвердить можно только черновик/версию на согласовании.');
    var outputs = findRows_('BREAKDOWN_PLAN_OUTPUTS', function(r){ return r.plan_id===planId && r.status==='активна'; });
    if (!outputs.length) throw new Error('Нельзя утвердить карту разбора без выходов.');
    updateRow_('BREAKDOWN_PLANS', plan, {status:'APPROVED', approved_at:nowIso_(), approved_by:session.user_id});
    auditLog_(session.user_id,'Утверждена карта разбора сырья','BREAKDOWN_PLANS:'+planId,plan.status,'APPROVED','success',session.cascade_id||'');
    return getBreakdownPlan_(planId, session);
  });
}

/** После прихода: если есть утверждённая карта разбора, создаём акт и задачи, но не списываем сырьё. */
function generateBreakdownFromReceipt_(batchId, session) {
  if (!session) return null;
  var batch = findOne_('BATCHES','batch_id',batchId);
  if (!batch) return null;
  var product = getProductById_(batch.product_id);
  if (!product) return null;
  var plan = _activeBreakdownPlanForReceipt_(session.organization_id, batch.product_id);
  if (!plan) return null;
  var outputs = findRows_('BREAKDOWN_PLAN_OUTPUTS', function(r){ return r.plan_id===plan.plan_id && r.status==='активна'; });
  var scale = Number(batch.количество) / (Number(plan.input_basis_qty)||1);
  var act = {
    act_id: generateId_('BREAKDOWN_ACTS'), organization_id: session.organization_id, location_id: batch.location_id,
    workshop_id: plan.workshop_id || batch.workshop_id || '', batch_id: batch.batch_id, plan_id: plan.plan_id,
    input_product_id: batch.product_id, input_qty: Number(batch.количество), input_unit: product.единица || plan.input_unit || '', thawed_qty: '', trim_waste: '', thermal_loss: '',
    other_waste: '', total_waste: '', usable_qty: '', status:'ПЛАН', user_id: session.user_id || '',
    created_at: nowIso_(), closed_at:'', source_cascade_id: session.cascade_id || '', cascade_id: ''
  };
  insertRow_('BREAKDOWN_ACTS', act);
  var tasks = outputs.map(function(o){
    var task = {
      task_id: generateId_('BREAKDOWN_TASKS'), act_id: act.act_id, organization_id: session.organization_id,
      location_id: batch.location_id, workshop_id: plan.workshop_id || batch.workshop_id || '', batch_id: batch.batch_id,
      step_id:(function(){ var st=findRows_('BREAKDOWN_PLAN_STEPS',function(r){return r.plan_id===plan.plan_id && Number(r.step_no)===Number(o.step_no||o.приоритет||0);}); return st.length?st[0].step_id:''; })(),
      output_type:o.output_type, output_id:o.output_id_ref, название:o.название, planned_qty:round2_(Number(o.planned_qty||0)*scale),
      единица:o.единица||'', статус:'ПЛАН', приоритет:Number(o.приоритет)||0, task_title:o.task_title||'',
      production_id:'', created_at:nowIso_(), completed_at:'', cascade_id:session.cascade_id||''
    };
    insertRow_('BREAKDOWN_TASKS',task);
    return task;
  });
  auditLog_(session.user_id,'Автоматически создан акт разбора после прихода','BREAKDOWN_ACTS:'+act.act_id,'','ПЛАН','success',session.cascade_id||'');
  var planMap=getBreakdownPlanMap_(plan.plan_id,session); return {act:act,tasks:tasks,plan:plan,plan_map:planMap.map,steps:planMap.steps,expected:_breakdownPlanExpected_(plan,Number(batch.количество),session)};
}

function getBreakdownTasks_(session, status) {
  return findRows_('BREAKDOWN_TASKS', function(t){ return t.organization_id===session.organization_id && t.location_id===session.location_id && (!status || t.статус===status); });
}

function startBreakdownAct_(actId, session) {
  return withLock_(function(){
    var act=findOne_('BREAKDOWN_ACTS','act_id',actId); assertOwnedByOrg_(session,act,'BREAKDOWN_ACTS:'+actId);
    if (act.status==='ЗАКРЫТ') return getBreakdownActTrace_(actId,session);
    if (act.status==='ОТМЕНЁН') throw new Error('Акт разбора отменён.');
    updateRow_('BREAKDOWN_ACTS',act,{status:'В_РАБОТЕ'});
    findRows_('BREAKDOWN_TASKS',function(t){return t.act_id===actId && t.статус==='ПЛАН';}).forEach(function(t){updateRow_('BREAKDOWN_TASKS',t,{статус:'В_РАБОТЕ'});});
    return getBreakdownActTrace_(actId,session);
  });
}

function _consumeSpecificBreakdownBatch_(batch, qty, userId, session) {
  if (!batch) throw new Error('Исходная партия разбора не найдена.');
  var remaining = getBatchRemaining_(batch);
  if (remaining + 0.0001 < qty) throw new Error('Недостаточно остатка именно в партии ' + batch.batch_id + ': доступно ' + round2_(remaining) + ', требуется ' + round2_(qty) + '.');
  if (_isBatchExpired_(batch)) throw new Error('Исходная партия разбора просрочена и не может быть использована в производстве.');
  var product = getProductById_(batch.product_id);
  if (!product) throw new Error('Исходное сырьё не найдено: ' + batch.product_id);
  if (session) assertOwnedByOrg_(session, product, 'PRODUCTS:' + batch.product_id);
  _recordOp_(product.organization_id, batch.location_id, batch.product_id, OP_TYPES.PRODUCTION, qty, Number(batch.цена_прихода)||0, batch.batch_id, userId, session);
  return {сумма:round2_(qty*(Number(batch.цена_прихода)||0)), остаток_после:getStockLevel_(batch.product_id,batch.location_id), распределение:[{batch_id:batch.batch_id,количество:round2_(qty),цена:Number(batch.цена_прихода)||0}]};
}

function completeBreakdownAct_(data, session) {
  return withLock_(function(){
    var act=findOne_('BREAKDOWN_ACTS','act_id',data.actId); assertOwnedByOrg_(session,act,'BREAKDOWN_ACTS:'+data.actId);
    if (act.status==='ЗАКРЫТ') return getBreakdownActTrace_(act.act_id,session);
    var batch=findOne_('BATCHES','batch_id',act.batch_id); assertOwnedByLocation_(session,batch,'BATCHES:'+act.batch_id);
    var tasks=findRows_('BREAKDOWN_TASKS',function(t){return t.act_id===act.act_id;});
    if (!tasks.length) throw new Error('В акте нет задач.');
    var inputQty=Number(act.input_qty)||0;
    var thawed=data.thawedQty!==undefined ? Number(data.thawedQty) : inputQty;
    var trimWaste=Number(data.trimWaste)||0;
    var thermalLoss=Number(data.thermalLoss)||0;
    var otherWaste=Number(data.otherWaste)||0;
    if (thawed<0 || trimWaste<0 || thermalLoss<0 || otherWaste<0) throw new Error('Потери не могут быть отрицательными.');
    var usable=thawed-trimWaste-thermalLoss-otherWaste;
    if (usable<0 || usable>inputQty+0.0001) throw new Error('Некорректный выход: проверьте разморозку и потери.');
    var plannedTotal=tasks.reduce(function(s,t){return s+(Number(t.planned_qty)||0);},0);
    var actualOutputs=data.outputs||{};
    var actualTotal=0;
    tasks.forEach(function(t){
      var q=actualOutputs[t.task_id]!==undefined ? Number(actualOutputs[t.task_id]) : Number(t.planned_qty)||0;
      if(q<0) throw new Error('Выход задачи не может быть отрицательным.');
      actualTotal+=q;
    });
    if (Math.abs(actualTotal-usable)>0.01) throw new Error('Сумма фактических выходов ('+round2_(actualTotal)+') должна равняться полезному выходу ('+round2_(usable)+').');
    var available=getBatchRemaining_(batch);
    if(available+0.0001<inputQty) throw new Error('В партии недостаточно остатка для разбора: нужно '+round2_(inputQty)+', доступно '+round2_(available)+'.');

    // Один акт = одно фактическое списание исходной партии.
    var consumption=_consumeSpecificBreakdownBatch_(batch,inputQty,session.user_id,session);
    var inputCost=Number(consumption.сумма)||0;
    var outputRows=[];
    tasks.forEach(function(t){
      var q=actualOutputs[t.task_id]!==undefined ? Number(actualOutputs[t.task_id]) : Number(t.planned_qty)||0;
      if(q<=0) { updateRow_('BREAKDOWN_TASKS',t,{статус:'ГОТОВО',planned_qty:0,completed_at:nowIso_()}); return; }
      var entity=String(t.output_type)==='PF'?getSemiFinishedById_(t.output_id):getProductById_(t.output_id);
      assertOwnedByOrg_(session,entity,'BREAKDOWN_OUTPUT:'+t.output_id);
      var unitCost=actualTotal>0 ? inputCost*(q/actualTotal)/q : 0;
      var newBatchId=generateId_('BATCHES'); var shelf=String(t.output_type)==='PF' ? _resolveShelfLife_(entity) : {срок_годности:'',требует_подтверждения:false}; var outBatch={batch_id:newBatchId,product_id:t.output_id,location_id:act.location_id,workshop_id:act.workshop_id||'',количество:q,цена_прихода:round2_(unitCost),дата_прихода:nowIso_(),дата_производства:nowIso_(),срок_годности:shelf.срок_годности||'',статус:'активна',партия_номер:generateBatchNumber_(newBatchId),ответственный_id:session.user_id||'',declaration_id:'',certificate_id:'',veterinary_document_id:'',cascade_id:session.cascade_id||''};
      insertRow_('BATCHES',outBatch);
      _recordOp_(session.organization_id,act.location_id,t.output_id,OP_TYPES.RECEIPT,q,unitCost,outBatch.batch_id,session.user_id,session);
      insertRow_('BREAKDOWN_ACT_LINES',{line_id:generateId_('BREAKDOWN_ACT_LINES'),act_id:act.act_id,organization_id:session.organization_id,batch_id:batch.batch_id,output_batch_id:outBatch.batch_id,output_type:t.output_type,output_id:t.output_id,planned_qty:Number(t.planned_qty)||0,actual_qty:q,единица:t.единица||'',unit_cost:round2_(unitCost),amount:round2_(q*unitCost),created_at:nowIso_(),cascade_id:session.cascade_id||''});
      updateRow_('BREAKDOWN_TASKS',t,{статус:'ГОТОВО',completed_at:nowIso_(),planned_qty:Number(t.planned_qty)||0});
      outputRows.push(outBatch);
    });
    var waste=inputQty-actualTotal;
    var wasteRecord={waste_id:generateId_('WASTE_RECORDS'),organization_id:session.organization_id,location_id:act.location_id,workshop_id:act.workshop_id||'',production_id:'',sale_id:'',ttk_version_id:'',dish_id:'',product_id:batch.product_id,batch_ids:JSON.stringify([batch.batch_id]),причина:'Отход/потери по акту разбора сырья',единица:act.input_unit||'кг',брутто:inputQty,нетто:actualTotal,отход:round2_(waste),процент_отхода:inputQty>0?round2_(waste/inputQty*100):0,сумма:inputCost>0?round2_(inputCost*waste/inputQty):0,user_id:session.user_id||'',дата:nowIso_(),cascade_id:session.cascade_id||'',journal_id:''};
    var journal=addJournalEntry_(act.location_id,'Отходы производства',JSON.stringify({waste_id:wasteRecord.waste_id,act_id:act.act_id,batch_id:batch.batch_id,брутто:inputQty,нетто:actualTotal,отход:waste,разморозка:thawed,зачистка:trimWaste,тепловые_потери:thermalLoss,прочие_потери:otherWaste,источник:'акт_разбора'}),session.user_id,session.organization_id,act.workshop_id||'', '',session.cascade_id||'','','');
    wasteRecord.journal_id=journal.journal_id; insertRow_('WASTE_RECORDS',wasteRecord);
    updateRow_('BREAKDOWN_ACTS',act,{status:'ЗАКРЫТ',thawed_qty:thawed,trim_waste:trimWaste,thermal_loss:thermalLoss,other_waste:otherWaste,total_waste:waste,usable_qty:actualTotal,closed_at:nowIso_(),cascade_id:session.cascade_id||act.cascade_id||''});
    cascadeStep_(session.cascade_id,'breakdown_act:'+act.act_id);
    if (typeof autoHaccpEvidenceForBreakdown_ === 'function') { try { autoHaccpEvidenceForBreakdown_(findOne_('BREAKDOWN_ACTS','act_id',act.act_id), session); } catch(e) {} }
    return getBreakdownActTrace_(act.act_id,session);
  });
}

function getBreakdownActTrace_(actId,session){
  var act=findOne_('BREAKDOWN_ACTS','act_id',actId); assertOwnedByOrg_(session,act,'BREAKDOWN_ACTS:'+actId);
  var plan=findOne_('BREAKDOWN_PLANS','plan_id',act.plan_id);
  var tasks=findRows_('BREAKDOWN_TASKS',function(t){return t.act_id===actId;});
  var lines=findRows_('BREAKDOWN_ACT_LINES',function(l){return l.act_id===actId;});
  var wastes=findRows_('WASTE_RECORDS',function(w){return w.cascade_id===act.cascade_id && w.product_id===act.input_product_id;});
  return {act:act,plan:plan,steps:findRows_('BREAKDOWN_PLAN_STEPS',function(r){return r.plan_id===act.plan_id;}).sort(function(a,b){return Number(a.step_no)-Number(b.step_no);}),tasks:tasks,lines:lines,waste:wastes,source_batch:findOne_('BATCHES','batch_id',act.batch_id),cascade_id:act.cascade_id||''};
}
