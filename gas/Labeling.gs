// ЦЕХ — маркировка, этикетки и прослеживаемость HACCP.
// Внутренняя маркировка не заменяет государственный код маркировки там, где он обязателен.

var MARKING_TYPES_ = ['PRODUCT_BATCH','SEMI_FINISHED','DISH','OPENED_CONTAINER'];
var MARKING_OPERATIONS_ = ['CREATE','PRINT','VERIFY','APPLY','REPRINT','REVOKE','OPEN_CONTAINER'];

function _parseShelfLifeTextHours_(text) {
  var s = String(text || '').toLowerCase().replace(/,/g,'.');
  var m = s.match(/(\d+(?:\.\d+)?)\s*(час|часа|часов|ч\b)/i);
  if (m) return Number(m[1]);
  m = s.match(/(\d+(?:\.\d+)?)\s*(сут|сутки|день|дня|дней|дн\b)/i);
  if (m) return Number(m[1]) * 24;
  m = s.match(/(\d+(?:\.\d+)?)\s*(мин|минут)/i);
  if (m) return Number(m[1]) / 60;
  return null;
}

function _markingProduct_(batch) {
  if (!batch) return null;
  return String(batch.product_id || '').indexOf('PF-') === 0 ? getSemiFinishedById_(batch.product_id) : getProductById_(batch.product_id) || findOne_('DISHES','dish_id',batch.product_id);
}
function _markingAssertBatch_(batchId, session) {
  var b = findOne_('BATCHES','batch_id',batchId);
  if (!b) throw new Error('Партия не найдена: ' + batchId);
  if (session) assertOwnedByLocation_(session,b,'BATCHES:'+batchId);
  return b;
}
function _markingEvidence_(marking, operation, result, session, extra) {
  var evidence = null;
  try {
    evidence = recordHaccpEvidence_({batchId:marking.batch_id, productionId:(extra&&extra.productionId)||'', result:result,
      evidence:{event:'MARKING_TRACEABILITY', operation:operation, marking_id:marking.marking_id, marking_type:marking.marking_type,
        code:marking.code, status:marking.status, timestamp:nowIso_(), reason:(extra&&extra.reason)||'', metadata:(extra&&extra.metadata)||{}}}, session);
  } catch(e) { logSystemError_('_markingEvidence_','', 'marking_haccp_evidence', e); }
  return evidence;
}
function _markingJournal_(params, session) {
  var evidence = _markingEvidence_(params.marking, params.operation, params.status === 'FAIL' ? 'FAIL' : 'PASS', session, params);
  var row = {journal_id:generateId_('MARKING_JOURNAL'),organization_id:session.organization_id,location_id:session.location_id||'',workshop_id:params.workshopId||'',batch_id:params.marking.batch_id,marking_id:params.marking.marking_id,product_id:params.marking.product_id,ttk_version_id:params.ttkVersionId||'',production_id:params.productionId||'',marking_type:params.marking.marking_type,marking_code:params.marking.code,operation:params.operation,status:params.status||'PASS',operator_id:session.user_id,timestamp:nowIso_(),print_job_id:params.printJobId||'',evidence_id:evidence?evidence.evidence_id:'',cascade_id:session.cascade_id||'',api_operation_id:session.operation_id||'',reason:params.reason||'',metadata_json:JSON.stringify(params.metadata||{})};
  insertRow_('MARKING_JOURNAL',row);
  return {journal:row,evidence:evidence};
}
function createBatchMarking_(data, session) {
  var batch=_markingAssertBatch_(data.batchId,session);
  var type=data.markingType||batch.marking_type||'PRODUCT_BATCH';
  if (MARKING_TYPES_.indexOf(type)===-1) throw new Error('Недопустимый тип маркировки: '+type);
  var existing=findRows_('MARKINGS',function(m){return m.batch_id===batch.batch_id&&m.status!=='REVOKED';});
  if(existing.length) return existing[0];
  var m={marking_id:generateId_('MARKINGS'),organization_id:session.organization_id,location_id:batch.location_id,batch_id:batch.batch_id,product_id:batch.product_id,marking_type:type,code:'TSEKH:'+batch.batch_id,status:'READY',source:'INTERNAL',external_id:'',issued_at:nowIso_(),applied_at:'',verified_at:'',printed_at:'',reprint_count:0,revoked_at:'',created_by:session.user_id,created_at:nowIso_(),metadata_json:JSON.stringify({ttk_version_id:data.ttkVersionId||'',production_id:data.productionId||'',storage:data.storage||'',shelf_life_confirmed:data.shelfLifeConfirmed!==false})};
  insertRow_('MARKINGS',m); _markingJournal_({marking:m,operation:'CREATE',status:'PASS',ttkVersionId:data.ttkVersionId,productionId:data.productionId,workshopId:batch.workshop_id,metadata:{source:data.source||'system'}},session); return findOne_('MARKINGS','marking_id',m.marking_id);
}
function _getMarking_(markingId,session){var m=findOne_('MARKINGS','marking_id',markingId); if(!m) throw new Error('Маркировка не найдена: '+markingId); if(session&&m.organization_id!==session.organization_id) _denyScope_(session,'MARKINGS:'+markingId,'organization'); return m;}
function getMarkingJournal_(data,session){
  var rows=findRows_('MARKING_JOURNAL',function(r){return r.organization_id===session.organization_id && (!data.batchId||r.batch_id===data.batchId) && (!data.markingId||r.marking_id===data.markingId) && (!data.operation||r.operation===data.operation);});
  return rows.sort(function(a,b){return new Date(b.timestamp)-new Date(a.timestamp);});
}
function createLabelPrintJob_(data,session){
  var batch=_markingAssertBatch_(data.batchId,session); var m=null;
  if(data.markingId) m=_getMarking_(data.markingId,session); else { var ms=findRows_('MARKINGS',function(x){return x.batch_id===batch.batch_id&&x.status!=='REVOKED';}); m=ms[0]||createBatchMarking_({batchId:batch.batch_id,markingType:data.markingType||batch.marking_type},session); }
  var qty=Math.max(1,Number(data.quantity)||1); var job={print_job_id:generateId_('LABEL_PRINT_JOBS'),organization_id:session.organization_id,location_id:batch.location_id,label_type:m.marking_type,status:'READY_TO_PRINT',requested_by:session.user_id,requested_at:nowIso_(),printed_at:'',verified_at:'',reason:data.reason||'',cascade_id:session.cascade_id||''}; insertRow_('LABEL_PRINT_JOBS',job);
  for(var i=1;i<=qty;i++) insertRow_('LABEL_PRINT_ITEMS',{item_id:generateId_('LABEL_PRINT_ITEMS'),print_job_id:job.print_job_id,batch_id:batch.batch_id,marking_id:m.marking_id,label_number:i,status:'READY',printed_at:'',verified_at:'',error:''});
  var model=generateBatchLabel_(batch.batch_id,session); model.marking=m; model.print_job=job; model.quantity_labels=qty;
  _markingJournal_({marking:m,operation: data.reprint ? 'REPRINT':'PRINT',status:'PASS',printJobId:job.print_job_id,productionId:data.productionId||'',ttkVersionId:data.ttkVersionId||'',workshopId:batch.workshop_id,metadata:{quantity:qty}},session);
  m=findOne_('MARKINGS','marking_id',m.marking_id); job=findOne_('LABEL_PRINT_JOBS','print_job_id',job.print_job_id);
  updateRow_('MARKINGS',m,{printed_at:nowIso_(),status:'PRINTED',reprint_count:Number(m.reprint_count||0)+(data.reprint?1:0)}); updateRow_('LABEL_PRINT_JOBS',job,{status:'PRINTED',printed_at:nowIso_()});
  model.marking=m; model.print_job=findOne_('LABEL_PRINT_JOBS','print_job_id',job.print_job_id);
  return model;
}
function verifyLabelPrint_(data,session){
  var m=_getMarking_(data.markingId,session); var ok=data.verified===true; var batch=_markingAssertBatch_(m.batch_id,session);
  if(ok){updateRow_('MARKINGS',m,{status:'VERIFIED',verified_at:nowIso_()}); var rows=findRows_('LABEL_PRINT_ITEMS',function(x){return x.marking_id===m.marking_id&&(!data.printJobId||x.print_job_id===data.printJobId);}); rows.forEach(function(x){updateRow_('LABEL_PRINT_ITEMS',x,{status:'VERIFIED',verified_at:nowIso_()});}); if(data.printJobId){var job=findOne_('LABEL_PRINT_JOBS','print_job_id',data.printJobId); if(job) updateRow_('LABEL_PRINT_JOBS',job,{status:'VERIFIED',verified_at:nowIso_()});} _markingJournal_({marking:m,operation:'VERIFY',status:'PASS',printJobId:data.printJobId||'',workshopId:batch.workshop_id,reason:data.reason||'',metadata:{scan:data.scan||''}},session); return generateBatchLabel_(batch.batch_id,session);}
  updateRow_('MARKINGS',m,{status:'BLOCKED'}); _markingJournal_({marking:m,operation:'VERIFY',status:'FAIL',printJobId:data.printJobId||'',workshopId:batch.workshop_id,reason:data.reason||'Не прошла проверка этикетки',metadata:{scan:data.scan||''}},session);
  if(typeof createCriticalIncident_==='function'){try{createCriticalIncident_({entityType:'BATCH',entityId:batch.batch_id,batchId:batch.batch_id,severity:'КРИТИЧЕСКОЕ',code:'MARKING_VERIFY_FAIL',название:'Ошибка проверки маркировки',описание:data.reason||'Этикетка не прошла проверку.',haccpFlag:true,ответственныйРоль:'ТЕХНОЛОГ_HACCP',blockMode:true},session);}catch(e){logSystemError_('verifyLabelPrint_',session.user_id,'marking_critical_incident',e);}}
  throw new Error('Проверка маркировки не пройдена. Партия требует разбирательства.');
}
function openContainer_(data,session){
  return withLock_(function(){
    var source=_markingAssertBatch_(data.batchId,session); if(String(source.статус)==='КАРАНТИН') throw new Error('Нельзя вскрывать тару партии в карантине.');
    var qty=Number(data.quantity); if(!(qty>0)) throw new Error('Количество вскрываемой тары должно быть больше нуля.');
    var remaining=getBatchRemaining_(source); if(remaining+0.000001<qty) throw new Error('Недостаточно остатка партии для вскрытия: '+remaining);
    var expiry=data.expiryDate||''; var openedAt=data.openedAt||nowIso_();
    if(!expiry){ var rule=typeof getActiveRule_==='function'?getActiveRule_(session.organization_id,'СРОК_ПОСЛЕ_ВСКРЫТИЯ_ЧАСЫ','product',source.product_id,openedAt.slice(0,10)):null; if(rule){var h=Number(rule.макс_значение||rule.мин_значение); if(h>0) expiry=new Date(new Date(openedAt).getTime()+h*3600000).toISOString();} }
    if(!expiry) throw new Error('Срок годности после вскрытия не задан. Укажите expiryDate или заведите утверждённый норматив СРОК_ПОСЛЕ_ВСКРЫТИЯ_ЧАСЫ.');
    if(source.срок_годности && new Date(expiry)>new Date(source.срок_годности)) expiry=source.срок_годности;
    var consume=consumeStock_(source.product_id,source.location_id,qty,OP_TYPES.ISSUE,session.user_id,session);
    var childId=generateId_('BATCHES'); var child={batch_id:childId,product_id:source.product_id,location_id:source.location_id,workshop_id:source.workshop_id||'',количество:qty,цена_прихода:Number(source.цена_прихода)||0,дата_прихода:openedAt,дата_производства:source.дата_производства||'',срок_годности:expiry,статус:'активна',партия_номер:generateBatchNumber_(childId,new Date(openedAt)),ответственный_id:session.user_id,declaration_id:source.declaration_id||'',certificate_id:source.certificate_id||'',veterinary_document_id:source.veterinary_document_id||'',cascade_id:session.cascade_id||'',source_batch_id:source.batch_id,marking_type:'OPENED_CONTAINER'}; insertRow_('BATCHES',child);
    var marking=createBatchMarking_({batchId:childId,markingType:'OPENED_CONTAINER',source:'OPEN_CONTAINER'},session); var model=generateBatchLabel_(childId,session); model.marking=marking; model.opened_from_batch_id=source.batch_id; model.opened_at=openedAt; model.opened_quantity=qty; model.source_remaining_after=round2_(getBatchRemaining_(source)); model.consumption=consume; model.label_reason='ВСКРЫТИЕ ТАРЫ';
    _markingJournal_({marking:marking,operation:'OPEN_CONTAINER',status:'PASS',workshopId:child.workshop_id,metadata:{source_batch_id:source.batch_id,opened_at:openedAt,quantity:qty,expiry:expiry}},session);
    return model;
  });
}
