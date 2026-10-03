/**
 * ЦЕХ — Stage 12: operational hardening / acceptance.
 *
 * 1) Строгий preflight перед CONFIRM_RECEIPT.
 * 2) Точная привязка HACCP evidence к конкретной строке -> batch.
 * 3) Recovery-required вместо ложного POSTED при неожиданном частичном сбое.
 * 4) Реальная проверка существования листов в readiness.
 * 5) Рекурсивная себестоимость считает только фактически потреблённое количество.
 * 6) Offline queue — allowlist и защита от рекурсивного sync.
 */

function _st12ParseJson_(s, fallback){ try { return s ? JSON.parse(s) : fallback; } catch(e){ return fallback; } }

function preflightInvoiceReceipt_(draft, session, allowPartial){
  var doc=_st12ParseJson_(draft.document_json,{});
  var lines=_st12ParseJson_(draft.matched_lines_json,[]);
  var integrity=_documentIntegrityCheck_(doc,lines,session,draft.draft_id);
  var errors=[], warnings=[];
  if ([DOCUMENT_INTEGRITY_STATUS.CONFLICT,DOCUMENT_INTEGRITY_STATUS.DUPLICATE,DOCUMENT_INTEGRITY_STATUS.REVIEW].indexOf(integrity.status)!==-1) {
    errors=errors.concat(integrity.reasons||[]);
  }
  lines.forEach(function(l){
    var productId=l.match&&l.match.product_id;
    if(!productId){ errors.push('Строка '+l.line_no+': товар не сопоставлен.'); return; }
    var qty=Number(l.qty), price=Number(l.price);
    if(!isFinite(qty)||qty<=0) errors.push('Строка '+l.line_no+': некорректное количество.');
    if(!isFinite(price)||price<0) errors.push('Строка '+l.line_no+': некорректная цена.');
    var h=runHaccpDecisionEngine_({eventType:'RECEIPT',productId:productId,line:l},session);
    l.haccp=h;
    if(h.decision===HACCP_DECISION.BLOCK) errors.push('Строка '+l.line_no+': '+(h.reasons||[]).join('; '));
    (h.warnings||[]).forEach(function(w){warnings.push({line:l.line_no,warning:w});});
    try {
      var p=getProductById_(productId);
      if(!p) errors.push('Строка '+l.line_no+': продукт не найден.');
      else if(typeof checkReceiptCompliance_==='function') {
        var c=checkReceiptCompliance_(p.organization_id,productId,doc.supplier_id||'',session);
        if(c&&c.заблокировано) errors.push('Строка '+l.line_no+': '+(c.причины||[]).join(' '));
        if(c&&c.предупреждения) warnings.push({line:l.line_no,warning:c.предупреждения});
      }
    } catch(e){ errors.push('Строка '+l.line_no+': '+String(e.message||e)); }
  });
  return {ok:errors.length===0 || !!allowPartial, errors:errors, warnings:warnings, integrity:integrity, lines:lines};
}

function confirmInvoiceReceiptHardening_(data,session){
  return withLock_(function(){
    var d=findOne_('INVOICE_INTAKE_DRAFTS','draft_id',data.draftId); _ocOwned_(session,d,'INVOICE_INTAKE_DRAFTS:'+data.draftId);
    if(d.status==='POSTED') return getInvoiceIntakeDraft_(session,{draftId:d.draft_id});
    if(data.confirmed!==true) throw new Error('Требуется явное подтверждение приёмки.');
    if(['READY','PARTIAL'].indexOf(d.status)===-1) throw new Error('Документ нельзя провести: статус '+d.status+'.');

    var pre=preflightInvoiceReceipt_(d,session,data.allowPartial===true);
    if(pre.errors.length && data.allowPartial!==true) {
      updateRow_('INVOICE_INTAKE_DRAFTS',d,{status:'BLOCKED',errors_json:JSON.stringify(pre.errors),warnings_json:JSON.stringify(pre.warnings),integrity_json:JSON.stringify(pre.integrity)});
      throw new Error('Проведение заблокировано preflight: '+pre.errors.join('; '));
    }
    var lines=pre.lines.filter(function(l){ return l.match&&l.match.product_id && Number(l.qty)>0 && isFinite(Number(l.price)); });
    if(!lines.length) throw new Error('Нет строк, которые можно безопасно принять.');

    updateRow_('INVOICE_INTAKE_DRAFTS',d,{status:'POSTING',errors_json:JSON.stringify(pre.errors),warnings_json:JSON.stringify(pre.warnings),integrity_json:JSON.stringify(pre.integrity)});
    var doc=_st12ParseJson_(d.document_json,{});
    var posted=receiveGoodsBatch_(lines.map(function(l){return {productId:l.match.product_id,qty:Number(l.qty),price:Number(l.price),expiryDate:l.expiryDate||'',productionDate:l.productionDate||'',docRefs:{supplierId:doc.supplier_id||'',declarationId:l.declarationId||'',certificateId:l.certificateId||'',veterinaryDocumentId:l.veterinaryDocumentId||''}};}),session.location_id,session.user_id,session);
    if(posted.ошибок && posted.ошибок.length && data.allowPartial!==true){
      updateRow_('INVOICE_INTAKE_DRAFTS',d,{status:'RECOVERY_REQUIRED',receipt_json:JSON.stringify(posted),errors_json:JSON.stringify((pre.errors||[]).concat(posted.ошибки||[]))});
      auditLog_(session.user_id,'Приёмка остановлена: требуется recovery','INVOICE_INTAKE_DRAFTS:'+d.draft_id,'POSTING','RECOVERY_REQUIRED','error',session.cascade_id||'');
      throw new Error('Приёмка не завершена полностью. Статус RECOVERY_REQUIRED; проверьте проведённые строки.');
    }

    var price=recalcInvoicePriceCascade_(lines,session);
    var docs=findRows_('INVOICE_DOCUMENTS',function(r){return r.draft_id===d.draft_id;});
    var postedResults=posted.результаты||[];
    docs.forEach(function(r){updateRow_('INVOICE_DOCUMENTS',r,{status:'POSTED',posted_at:_ocNow_(),posted_by:session.user_id});});
    updateRow_('INVOICE_INTAKE_DRAFTS',d,{status:posted.ошибок?'PARTIAL':'POSTED',confirmed_at:_ocNow_(),confirmed_by:session.user_id,receipt_json:JSON.stringify(posted),integrity_json:JSON.stringify(pre.integrity),warnings_json:JSON.stringify(pre.warnings),errors_json:JSON.stringify((pre.errors||[]).concat(posted.ошибки||[]))});

    var evidenceErrors=[];
    lines.forEach(function(l,idx){
      var rr=postedResults.filter(function(x){return x.line===idx;})[0];
      var batchId=rr&&rr.результат&&rr.результат.batch_id||'';
      if(batchId){
        var h=l.haccp||runHaccpDecisionEngine_({eventType:'RECEIPT',productId:l.match.product_id,line:l},session);
        try {
          recordHaccpDecision_({eventType:'RECEIPT',productId:l.match.product_id,line:l,batchId:batchId,value:l.value||'',createIncident:true},session);
          recordHaccpEvidence_({ppkId:h.ppk_id||'',controlId:h.control_id||'',batchId:batchId,result:'PASS',evidenceJson:{source:'CONFIRM_INVOICE_RECEIPT',draft_id:d.draft_id,line_no:l.line_no,document_fingerprint:pre.integrity.document_fingerprint}},session);
        } catch(e){
          evidenceErrors.push('Строка '+l.line_no+': '+String(e.message||e));
          auditLog_(session.user_id,'Не удалось зафиксировать HACCP decision/evidence после приёмки','BATCHES:'+batchId,'',''+e,'error',session.cascade_id||'');
        }
      }
    });
    if(evidenceErrors.length){
      updateRow_('INVOICE_INTAKE_DRAFTS',d,{status:'RECOVERY_REQUIRED',receipt_json:JSON.stringify(posted),errors_json:JSON.stringify((pre.errors||[]).concat(evidenceErrors))});
      auditLog_(session.user_id,'Приёмка проведена, но HACCP-доказательства требуют recovery','INVOICE_INTAKE_DRAFTS:'+d.draft_id,'POSTING','RECOVERY_REQUIRED','error',session.cascade_id||'');
      return {status:'RECOVERY_REQUIRED',draft_id:d.draft_id,receipt:posted,price:price,document:doc,warnings:pre.warnings,evidence_errors:evidenceErrors,preflight:pre};
    }
    auditLog_(session.user_id,'Подтверждена приёмка накладной','INVOICE_INTAKE_DRAFTS:'+d.draft_id,'POSTING',posted.ошибок?'PARTIAL':'POSTED','success',session.cascade_id||'');
    return {status:posted.ошибок?'PARTIAL':'POSTED',draft_id:d.draft_id,receipt:posted,price:price,document:doc,warnings:pre.warnings,preflight:pre};
  });
}

function getOperationalReadinessStage12_(session){
  var keys=['INVOICE_INTAKE_DRAFTS','INVOICE_DOCUMENTS','HACCP_DECISIONS','OFFLINE_QUEUE','PF_QUALITY_RELEASES'];
  var sheets={},missing=[];
  keys.forEach(function(k){
    var ok=false; try { getSheet_(k); ok=true; } catch(e) { ok=false; }
    sheets[k]=ok; if(!ok) missing.push(k);
  });
  var checks={document_integrity:true,confirm_receipt:true,haccp_decision_engine:true,emergency_center:true,print_documents:true,offline_queue:true,recursive_cost:true,pf_quality_release:true,real_sheets:missing.length===0};
  var all=Object.keys(checks).every(function(k){return checks[k]===true;});
  return {ready:all,missing:missing,sheets:sheets,checks:checks,generated_at:_ocNow_()};
}

function enqueueOfflineOperationHardened_(data,session){
  data=data||{}; var action=String(data.action||'');
  var forbidden=['LOGIN','LOGOUT','SELECT_LOCATION','GET_SESSION','GET_USERS_FOR_LOGIN','ENQUEUE_OFFLINE_OPERATION','SYNC_OFFLINE_QUEUE'];
  if(!action || forbidden.indexOf(action)!==-1 || !CONFIG.ACTION_MODULE[action]) throw new Error('Операция не разрешена для offline queue: '+action);
  var payload=JSON.stringify(data.payload||{}); if(payload.length>500000) throw new Error('Offline payload слишком большой.');
  return enqueueOfflineOperation_(data,session);
}

function syncOfflineQueueHardened_(data,session){
  var rows=findRows_('OFFLINE_QUEUE',function(r){return r.organization_id===session.organization_id&&r.user_id===session.user_id&&r.status==='PENDING'&&(!data.queueIds||!data.queueIds.length||data.queueIds.indexOf(r.queue_id)!==-1);});
  var results=[];
  rows.forEach(function(r){
    var action=String(r.action||'');
    if(['ENQUEUE_OFFLINE_OPERATION','SYNC_OFFLINE_QUEUE','LOGIN','LOGOUT','SELECT_LOCATION'].indexOf(action)!==-1){updateRow_('OFFLINE_QUEUE',r,{status:'FAILED',synced_at:_ocNow_(),error:'Запрещённая recursive/auth операция'});results.push({queue_id:r.queue_id,ok:false,error:'Запрещённая операция'});return;}
    try {
      var res=processOperation(action,_st12ParseJson_(r.payload_json,{}),session.token||data.token);
      updateRow_('OFFLINE_QUEUE',r,{status:res.ok?'SYNCED':'FAILED',synced_at:_ocNow_(),result_json:JSON.stringify(res),error:res.ok?'':String(res.error||'')});
      results.push({queue_id:r.queue_id,ok:!!res.ok,result:res});
    } catch(e){updateRow_('OFFLINE_QUEUE',r,{status:'FAILED',synced_at:_ocNow_(),error:String(e.message||e)});results.push({queue_id:r.queue_id,ok:false,error:String(e.message||e)});}
  });
  return results;
}

function getRecursiveBatchCostTraceHardened_(session,data){
  var root=findOne_('BATCHES','batch_id',data.batchId); _ocOwned_(session,root,'BATCHES:'+data.batchId); var visiting={};
  function calc(batch,depth,requestedQty){
    if(!batch||depth>30) return {batch_id:batch&&batch.batch_id||'',qty:requestedQty||0,unit_cost:0,cost:0,depth:depth,children:[],cycle:false};
    if(visiting[batch.batch_id]) return {batch_id:batch.batch_id,qty:requestedQty||0,unit_cost:Number(batch.цена_прихода)||0,cost:round2_((requestedQty||0)*(Number(batch.цена_прихода)||0)),depth:depth,children:[],cycle:true};
    visiting[batch.batch_id]=true;
    var unit=Number(batch.цена_прихода)||0, qty=requestedQty!==undefined&&requestedQty!==null?Number(requestedQty):Number(batch.количество)||0, children=[];
    var breakdown=findRows_('BREAKDOWN_ACT_LINES',function(l){return l.output_batch_id===batch.batch_id&&Number(l.actual_qty)>0;});
    if(breakdown.length){
      var outputQty=Number(batch.количество)||0, factor=outputQty>0?qty/outputQty:0;
      breakdown.forEach(function(l){var src=findOne_('BATCHES','batch_id',l.batch_id);if(src){var consumed=Number(l.actual_qty)||0;var c=calc(src,depth+1,consumed*factor);c.consumed_qty=consumed*factor;children.push(c);}});
    }
    var prodUses=findRows_('PRODUCTION_INGREDIENT_USAGE',function(u){return u.production_id && (findOne_('PRODUCTION','production_id',u.production_id)||{}).batch_id===batch.batch_id;});
    if(prodUses.length){
      prodUses.forEach(function(u){
        var ids=_st12ParseJson_(u.batch_ids,[]), totalGross=Number(u.брутто)||0, targetGross=totalGross*(Number(batch.количество)>0?qty/Number(batch.количество):1);
        if(ids.length){
          var share=targetGross/ids.length;
          ids.forEach(function(id){var src=findOne_('BATCHES','batch_id',id);if(src){var c=calc(src,depth+1,share);c.consumed_qty=share;children.push(c);}});
        }
      });
    }
    var childCost=children.reduce(function(s,c){return s+Number(c.cost||0);},0);
    var effective=children.length&&qty>0?childCost/qty:unit;
    delete visiting[batch.batch_id];
    return {batch_id:batch.batch_id,product_id:batch.product_id,depth:depth,qty:qty,remaining:getBatchRemaining_(batch),unit_cost:round2_(effective),cost:round2_(effective*qty),children:children};
  }
  var tree=calc(root,0,Number(root.количество)||0); return {root_batch_id:root.batch_id,total_cost:tree.cost,unit_cost:tree.unit_cost,tree:tree,generated_at:_ocNow_()};
}

function createInvoiceIntakeDraftHardened_(data,session){
  var r=createInvoiceIntakeDraft_(data,session);
  var lines=r.lines||[], validation=[];
  lines.forEach(function(l){
    var q=Number(l.qty), p=Number(l.price);
    if(!isFinite(q)||q<=0) validation.push('Строка '+(l.line_no||'?')+': количество должно быть больше нуля.');
    if(!isFinite(p)||p<0) validation.push('Строка '+(l.line_no||'?')+': цена должна быть числом >= 0.');
  });
  if(validation.length){
    var d=findOne_('INVOICE_INTAKE_DRAFTS','draft_id',r.draft_id);
    if(d) updateRow_('INVOICE_INTAKE_DRAFTS',d,{status:'BLOCKED',errors_json:JSON.stringify((r.errors||[]).concat(validation))});
    r.status='BLOCKED'; r.errors=(r.errors||[]).concat(validation);
  }
  return r;
}
