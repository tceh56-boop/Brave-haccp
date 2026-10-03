/**
 * ЦЕХ — Stage 11: production-grade operational closure.
 * 1) Invoice scan draft / confirm receipt
 * 2) Document integrity
 * 3) HACCP decision engine
 * 4) Emergency center
 * 5) A4/PDF PPK + TTK
 * 6) Offline mobile queue
 * 7) Recursive batch cost
 * 8) Semi-finished quality release
 * 9) Deployment readiness + acceptance gates
 */

var DOCUMENT_INTEGRITY_STATUS = { OK:'OK', DUPLICATE:'DUPLICATE', CONFLICT:'CONFLICT', REVIEW:'REVIEW' };
var HACCP_DECISION = { PASS:'PASS', WARNING:'WARNING', BLOCK:'BLOCK' };

function _ocHash_(s){
  s=String(s||'');
  try { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s)); }
  catch(e){ var h=0; for(var i=0;i<s.length;i++) h=((h<<5)-h)+s.charCodeAt(i)|0; return String(h); }
}
function _ocNorm_(s){return String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();}
function _ocDocFingerprint_(doc){
  doc=doc||{};
  return _ocHash_([_ocNorm_(doc.supplier_id||doc.supplier||''),_ocNorm_(doc.invoice_number||doc.number||''),String(doc.invoice_date||doc.date||''),_ocNorm_(doc.recipient_id||doc.recipient||'')].join('|'));
}
function _ocLineFingerprint_(lines){
  return _ocHash_((lines||[]).map(function(l){return [_ocNorm_(l.article||''),_ocNorm_(l.barcode||''),_ocNorm_(l.name||''),Number(l.qty||0),Number(l.price||0),String(l.expiryDate||'')].join('|');}).sort().join('||'));
}
function _ocNow_(){return nowIso_();}
function _ocOwned_(session,row,key){ if(!row) throw new Error('Объект не найден: '+key); var org=row.organization_id||''; if(!org && String(key).indexOf('BATCHES:')===0){ var prod=String(row.product_id||'').indexOf('PF-')===0?(typeof getSemiFinishedById_==='function'?getSemiFinishedById_(row.product_id):null):(typeof getProductById_==='function'?getProductById_(row.product_id):null); org=prod&&prod.organization_id||''; } if(org!==session.organization_id) throw new Error('Объект не найден или принадлежит другой организации: '+key); if(row.location_id && session.location_id && row.location_id!==session.location_id && CONFIG.ROLE_DATA_SCOPE[session.role||'']==='LOCATION') throw new Error('Нет доступа к точке: '+key); return row; }

function _documentIntegrityCheck_(doc, lines, session, draftId){
  var fp=_ocDocFingerprint_(doc), lfp=_ocLineFingerprint_(lines);
  var all=findRows_('INVOICE_DOCUMENTS',function(r){return r.organization_id===session.organization_id;});
  var same=all.filter(function(r){return r.document_fingerprint===fp && r.document_number===String(doc.invoice_number||doc.number||'');});
  var conflicts=all.filter(function(r){return r.document_number===String(doc.invoice_number||doc.number||'') && r.document_date===String(doc.invoice_date||doc.date||'') && r.document_fingerprint!==fp;});
  var result={status:DOCUMENT_INTEGRITY_STATUS.OK,document_fingerprint:fp,lines_fingerprint:lfp,duplicates:same,conflicts:conflicts,reasons:[]};
  if(conflicts.length){result.status=DOCUMENT_INTEGRITY_STATUS.CONFLICT;result.reasons.push('Одинаковый номер/дата документа уже зарегистрирован с другим составом реквизитов.');}
  else {
    var postedSame=same.filter(function(r){return r.draft_id!==draftId && r.status==='POSTED';});
    var postedSameLines=postedSame.filter(function(r){return r.lines_fingerprint===lfp;});
    var postedDifferentLines=postedSame.filter(function(r){return r.lines_fingerprint!==lfp;});
    if(postedDifferentLines.length){result.status=DOCUMENT_INTEGRITY_STATUS.CONFLICT;result.conflicts=postedDifferentLines;result.reasons.push('Одинаковый номер документа уже проведён, но состав товарных строк отличается.');}
    else if(postedSameLines.length){result.status=DOCUMENT_INTEGRITY_STATUS.DUPLICATE;result.reasons.push('Документ с тем же номером, датой и составом уже проведён.');}
  }
  if(!doc.invoice_number) {result.status=DOCUMENT_INTEGRITY_STATUS.REVIEW;result.reasons.push('Не распознан номер документа.');}
  if(!doc.invoice_date) {result.status=DOCUMENT_INTEGRITY_STATUS.REVIEW;result.reasons.push('Не распознана дата документа.');}
  if(!lines.length) {result.status=DOCUMENT_INTEGRITY_STATUS.REVIEW;result.reasons.push('Нет товарных строк.');}
  return result;
}

function createInvoiceIntakeDraft_(data, session){
  data=data||{};
  var invoice=data.mockInvoice || runSupplierInvoiceOcr_(data.base64Image,data.mimeType||'image/jpeg',session);
  var doc=invoice.document||{}, lines=invoice.lines||[];
  if(!lines.length) throw new Error('В документе не найдены товарные строки.');
  var integrity=_documentIntegrityCheck_(doc,lines,session,'');
  var mapped=[], errors=[], warnings=[];
  lines.forEach(function(line,i){
    line.line_no=line.line_no||i+1;
    var m=matchInvoiceLineToProduct_(line,session); line.match=m;
    if(!m.product_id){errors.push({line:line.line_no,error:'Товар не найден однозначно',candidates:m.candidates||[]});return;}
    var h=runHaccpDecisionEngine_({eventType:'RECEIPT',productId:m.product_id,line:line},session);
    line.haccp=h;
    if(h.decision===HACCP_DECISION.BLOCK) errors.push({line:line.line_no,error:'HACCP/ППК блокировка',reasons:h.reasons});
    else {mapped.push(line);(h.warnings||[]).forEach(function(w){warnings.push({line:line.line_no,warning:w});});}
  });
  var status=(integrity.status===DOCUMENT_INTEGRITY_STATUS.CONFLICT||integrity.status===DOCUMENT_INTEGRITY_STATUS.DUPLICATE||integrity.status===DOCUMENT_INTEGRITY_STATUS.REVIEW||errors.length&&!mapped.length)?'BLOCKED':(errors.length?'PARTIAL':'READY');
  var draft={draft_id:generateId_('INVOICE_INTAKE_DRAFTS'),organization_id:session.organization_id,location_id:session.location_id,status:status,document_json:JSON.stringify(doc),lines_json:JSON.stringify(lines),matched_lines_json:JSON.stringify(mapped),integrity_json:JSON.stringify(integrity),haccp_json:JSON.stringify(mapped.map(function(x){return x.haccp;})),warnings_json:JSON.stringify(warnings),errors_json:JSON.stringify(errors),operation_id:data.operationId||'',created_at:_ocNow_(),created_by:session.user_id,confirmed_at:'',confirmed_by:'',receipt_json:'',cascade_id:session.cascade_id||''};
  insertRow_('INVOICE_INTAKE_DRAFTS',draft);
  insertRow_('INVOICE_DOCUMENTS',{document_id:generateId_('INVOICE_DOCUMENTS'),organization_id:session.organization_id,location_id:session.location_id,draft_id:draft.draft_id,status:'DRAFT',document_number:String(doc.invoice_number||doc.number||''),document_date:String(doc.invoice_date||doc.date||''),supplier_id:String(doc.supplier_id||''),document_fingerprint:integrity.document_fingerprint,lines_fingerprint:integrity.lines_fingerprint,created_at:_ocNow_(),created_by:session.user_id,posted_at:'',posted_by:''});
  return {draft_id:draft.draft_id,status:status,document:doc,lines:lines,matched_lines:mapped,integrity:integrity,warnings:warnings,errors:errors,preview:buildInvoicePostingPreview_(mapped,session)};
}

function getInvoiceIntakeDraft_(session,data){var d=findOne_('INVOICE_INTAKE_DRAFTS','draft_id',data.draftId);_ocOwned_(session,d,'INVOICE_INTAKE_DRAFTS:'+data.draftId);return {draft:d,document:JSON.parse(d.document_json||'{}'),lines:JSON.parse(d.lines_json||'[]'),matched_lines:JSON.parse(d.matched_lines_json||'[]'),integrity:JSON.parse(d.integrity_json||'{}'),haccp:JSON.parse(d.haccp_json||'[]'),warnings:JSON.parse(d.warnings_json||'[]'),errors:JSON.parse(d.errors_json||'[]'),receipt:d.receipt_json?JSON.parse(d.receipt_json):null};}

function confirmInvoiceReceipt_(data,session){
  return withLock_(function(){
    var d=findOne_('INVOICE_INTAKE_DRAFTS','draft_id',data.draftId);_ocOwned_(session,d,'INVOICE_INTAKE_DRAFTS:'+data.draftId);
    if(d.status==='POSTED') return getInvoiceIntakeDraft_(session,{draftId:d.draft_id});
    if(d.status!=='READY' && !(d.status==='PARTIAL'&&data.allowPartial===true)) throw new Error('Документ нельзя провести: статус '+d.status+'.');
    if(data.confirmed!==true) throw new Error('Требуется явное подтверждение приёмки.');
    var doc=JSON.parse(d.document_json||'{}'), lines=JSON.parse(d.matched_lines_json||'[]');
    var integrity=_documentIntegrityCheck_(doc,lines,session,d.draft_id);
    if(integrity.status===DOCUMENT_INTEGRITY_STATUS.CONFLICT||integrity.status===DOCUMENT_INTEGRITY_STATUS.DUPLICATE) throw new Error('Проведение заблокировано проверкой целостности документа: '+integrity.reasons.join('; '));
    lines.forEach(function(l){var h=runHaccpDecisionEngine_({eventType:'RECEIPT',productId:l.match.product_id,line:l},session);if(h.decision===HACCP_DECISION.BLOCK)throw new Error('Проведение заблокировано HACCP по строке '+l.line_no+': '+h.reasons.join('; '));});
    var posted=receiveGoodsBatch_(lines.map(function(l){return {productId:l.match.product_id,qty:Number(l.qty),price:Number(l.price),expiryDate:l.expiryDate||'',productionDate:l.productionDate||'',docRefs:{supplierId:doc.supplier_id||'',declarationId:l.declarationId||'',certificateId:l.certificateId||'',veterinaryDocumentId:l.veterinaryDocumentId||''}};}),session.location_id,session.user_id,session);
    if(posted.ошибок) throw new Error('Приёмка завершилась с ошибками. Требуется recovery: '+JSON.stringify(posted.ошибки));
    var price=recalcInvoicePriceCascade_(lines,session);
    var docs=findRows_('INVOICE_DOCUMENTS',function(r){return r.draft_id===d.draft_id;});
    docs.forEach(function(r){updateRow_('INVOICE_DOCUMENTS',r,{status:'POSTED',posted_at:_ocNow_(),posted_by:session.user_id});});
    updateRow_('INVOICE_INTAKE_DRAFTS',d,{status:'POSTED',confirmed_at:_ocNow_(),confirmed_by:session.user_id,receipt_json:JSON.stringify(posted),integrity_json:JSON.stringify(integrity)});
    lines.forEach(function(l){recordHaccpEvidence_({ppkId:(l.haccp&&l.haccp.ppk_id)||'',controlId:(l.haccp&&l.haccp.control_id)||'',batchId:(posted.результаты&&posted.результаты[0]&&posted.результаты[0].результат&&posted.результаты[0].результат.batch_id)||'',result:'PASS',evidenceJson:{source:'CONFIRM_INVOICE_RECEIPT',draft_id:d.draft_id,line_no:l.line_no}},session);});
    auditLog_(session.user_id,'Подтверждена приёмка накладной','INVOICE_INTAKE_DRAFTS:'+d.draft_id,'READY','POSTED','success',session.cascade_id||'');
    return {status:'POSTED',draft_id:d.draft_id,receipt:posted,price:price,document:doc};
  });
}

function runHaccpDecisionEngine_(ctx,session){
  ctx=ctx||{}; var out={decision:HACCP_DECISION.PASS,reasons:[],warnings:[],controls:[],ppk_id:'',control_id:'',critical_limit:null};
  var current=typeof getCurrentPpk_==='function'?getCurrentPpk_(session.organization_id):null;
  if(!current){out.decision=HACCP_DECISION.BLOCK;out.reasons.push('Нет действующей версии ППК.');return out;}
  out.ppk_id=current.ppk_id;
  var controls=findRows_('PPK_CONTROLS',function(c){return c.ppk_id===current.ppk_id&&c.status!=='ARCHIVED'&&(!c.location_id||c.location_id===session.location_id)&&(!c.product_id||c.product_id===ctx.productId);});
  controls.forEach(function(c){
    var lim=c.critical_limit_ref?findOne_('PPK_CRITICAL_LIMITS','limit_id',c.critical_limit_ref):null;
    var r={control_id:c.control_id,name:c.control_name,point_type:c.point_type,limit:lim};out.controls.push(r);
    if(!out.control_id) out.control_id=c.control_id; if(!out.critical_limit) out.critical_limit=lim;
    var line=ctx.line||{};
    if(lim){
      var raw = ctx.value!==undefined && ctx.value!=='' ? ctx.value : (lim.value_field && line[lim.value_field]!==undefined ? line[lim.value_field] : (lim.parameter && line[lim.parameter]!==undefined ? line[lim.parameter] : '')); var value=Number(raw);
      if(!isNaN(value)){
        var min=lim.min_value!==''&&lim.min_value!=null?Number(lim.min_value):null, max=lim.max_value!==''&&lim.max_value!=null?Number(lim.max_value):null;
        if((min!==null&&!isNaN(min)&&value<min)||(max!==null&&!isNaN(max)&&value>max)){out.decision=HACCP_DECISION.BLOCK;out.reasons.push('Критический предел нарушен: '+(c.control_name||c.control_id));}
      }
    }
  });
  if(ctx.line&&ctx.line.expiryDate&&String(ctx.line.expiryDate)<new Date().toISOString().slice(0,10)){out.decision=HACCP_DECISION.BLOCK;out.reasons.push('Срок годности истёк.');}
  if(ctx.eventType==='RECEIPT' && (!ctx.line||!ctx.line.expiryDate)) out.warnings.push('Срок годности не подтверждён документом.');
  return out;
}

function recordHaccpDecision_(data,session){
  var d=runHaccpDecisionEngine_(data,session);var row={decision_id:generateId_('HACCP_DECISIONS'),organization_id:session.organization_id,location_id:session.location_id,event_type:data.eventType||'',ppk_id:d.ppk_id,control_id:d.control_id,batch_id:data.batchId||'',production_id:data.productionId||'',journal_id:data.journalId||'',value:data.value||'',decision:d.decision,reasons_json:JSON.stringify(d.reasons),warnings_json:JSON.stringify(d.warnings),created_at:_ocNow_(),created_by:session.user_id,cascade_id:session.cascade_id||''};insertRow_('HACCP_DECISIONS',row);if(d.decision===HACCP_DECISION.BLOCK&&data.createIncident!==false&&typeof createCriticalIncident_==='function'){createCriticalIncident_({entityType:data.batchId?'BATCH':'HACCP',entityId:data.batchId||data.productionId||data.journalId||'',severity:'КРИТИЧЕСКОЕ',title:'Критическое HACCP-отклонение',description:d.reasons.join('; '),haccpFlag:true,ppkId:d.ppk_id,controlId:d.control_id,batchId:data.batchId||'',productionId:data.productionId||'',deviationId:data.deviationId||'',blockMode:true},session);}return {decision:d,row:row};}

function getEmergencyCenter_(session){
  var inc=typeof getCriticalIncidents_==='function'?getCriticalIncidents_(session,{}):[];
  var q=typeof getQuarantineCases_==='function'?getQuarantineCases_(session,{status:'КАРАНТИН'}):[];
  var dev=findRows_('JOURNAL_DEVIATIONS',function(r){return r.статус==='OPEN'||r.статус==='открыто';});
  var tasks=findRows_('TASKS',function(r){return r.organization_id===session.organization_id&&(r.status==='OPEN'||r.статус==='открыта'||r.статус==='в работе');});
  var equip=findRows_('EQUIPMENT',function(r){return r.organization_id===session.organization_id&&(r.статус==='АВАРИЯ'||r.статус==='FAULT'||r.авария==='Да');});
  var intake=[]; try { intake=getDocumentIntegrityDashboard_(session).slice(0,100); } catch(e) { intake=[]; }
  return {generated_at:_ocNow_(),critical_incidents:inc.filter(function(x){return ['КРИТИЧЕСКОЕ','БЛОКИРОВКА'].indexOf(x.severity)!==-1&&['ОТКРЫТ','НА_РАССМОТРЕНИИ'].indexOf(x.status)!==-1;}).slice(0,100),quarantines:q.slice(0,100),deviations:dev.slice(0,100),overdue_tasks:tasks.filter(function(t){return t.срок_выполнения&&new Date(t.срок_выполнения)<new Date();}).slice(0,100),equipment_incidents:equip.slice(0,100),invoice_intake:intake};
}

function _ocPrintHtml_(title,meta,sections){
  var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
  var body=sections.map(function(s){return '<h2>'+esc(s.title)+'</h2><pre>'+esc(JSON.stringify(s.data,null,2))+'</pre>';}).join('');
  return '<!doctype html><html><head><meta charset="UTF-8"><style>@page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;font-size:10pt;color:#111}h1{font-size:18pt}h2{font-size:12pt;border-bottom:1px solid #888;padding-bottom:3px}pre{white-space:pre-wrap;font-family:Arial;font-size:8pt;border:1px solid #ddd;padding:6px} .meta{color:#555}</style></head><body><h1>'+esc(title)+'</h1><div class="meta">'+esc(meta||'')+'</div>'+body+'</body></html>';
}
function generateTtkA4Pdf_(session,data){
  var ttk=getCurrentTtk_(data.dishId,session); if(!ttk) throw new Error('Нет утверждённой ТТК.');
  var ctx=getTtkContext_(data.dishId,session), dish=ctx.dish, esc=function(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');};
  var steps=[]; try{steps=JSON.parse(ttk.технологические_этапы_json||'[]');if(!Array.isArray(steps))steps=[];}catch(e){steps=[];}
  var recipes=(ctx.recipes||[]).map(function(r){var x=String(r.product_id||'').indexOf('PF-')===0?getSemiFinishedById_(r.product_id):getProductById_(r.product_id);return {name:x?(x.название||r.product_id):r.product_id,brutto:r.брутто,netto:r.нетто,unit:r.единица||'',loss:r.потери_процент||0};});
  var org=findOne_('ORGANIZATIONS','organization_id',session.organization_id), orgName=org?(org.название||org.name||'Организация'):'';
  var recipeHtml=recipes.map(function(r,i){return '<tr><td>'+esc(i+1)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.brutto)+'</td><td>'+esc(r.netto)+'</td><td>'+esc(r.unit)+'</td><td>'+esc(r.loss)+'%</td></tr>';}).join('');
  var stepsHtml=steps.map(function(x,i){return '<tr><td>'+esc(i+1)+'</td><td>'+esc(x.stage)+'</td><td>'+esc(x.description)+'</td><td>'+esc(x.temperature)+'</td><td>'+esc(x.time)+'</td></tr>';}).join('');
  var haccpHtml=(ctx.haccp_links||[]).map(function(h){return '<tr><td>'+esc(h.control_id||'')+'</td><td>'+esc(h.control_type||'')+'</td><td>'+esc(h.stage_id||'')+'</td><td>'+esc(h.critical_limit_id||'')+'</td></tr>';}).join('');
  var sanpinHtml=(ctx.sanpin_links||[]).map(function(h){return '<tr><td>'+esc(h.requirement_id||'')+'</td><td>'+esc(h.clause||'')+'</td><td>'+esc(h.source_document||'')+'</td></tr>';}).join('');
  var html='<!doctype html><html><head><meta charset="UTF-8"><style>@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;font-size:9pt;color:#111;line-height:1.35}h1{font-size:16pt;text-align:center;margin:4px 0}h2{font-size:11pt;margin:13px 0 5px;border-bottom:1px solid #777;padding-bottom:3px}.meta{text-align:center;color:#555;margin-bottom:10px}table{width:100%;border-collapse:collapse;margin:5px 0 10px}th,td{border:1px solid #888;padding:4px 5px;vertical-align:top}th{background:#f2f2f2}.kv td:first-child{width:28%;font-weight:bold}.sign{margin-top:22px;display:flex;justify-content:space-between}.small{font-size:8pt;color:#555}</style></head><body>'+
    '<div style="text-align:center;font-weight:bold">'+esc(orgName)+'</div><h1>ТЕХНОЛОГИЧЕСКАЯ КАРТА №'+esc(String(ttk.version).padStart(3,'0'))+'</h1><div class="meta">'+esc(dish.название)+' · версия '+esc(ttk.version)+' · утверждена '+esc(ttk.approved_at||'')+'</div>'+    '<h2>1. Основные сведения</h2><table class="kv"><tr><td>Наименование</td><td>'+esc(dish.название)+'</td></tr><tr><td>Категория</td><td>'+esc(dish.категория_id||'')+'</td></tr><tr><td>Выход</td><td>'+esc(dish.выход)+'</td></tr><tr><td>Источник / основание</td><td>'+esc(ttk.источник||'')+'</td></tr><tr><td>Область применения</td><td>'+esc(ttk.область_применения||'')+'</td></tr></table>'+    '<h2>2. Состав сырья</h2><table><tr><th>№</th><th>Ингредиент</th><th>Брутто</th><th>Нетто</th><th>Ед.</th><th>Потери</th></tr>'+recipeHtml+'</table>'+    '<h2>3. Технологический процесс</h2><table><tr><th>№</th><th>Этап</th><th>Описание</th><th>Температура</th><th>Время</th></tr>'+stepsHtml+'</table><div>'+esc(ttk.технология||'')+'</div>'+    '<h2>4. Хранение и качество</h2><table class="kv"><tr><td>Условия хранения</td><td>'+esc(ttk.условия_хранения||'')+'</td></tr><tr><td>Срок реализации / хранения</td><td>'+esc(ttk.срок_реализации||'')+'</td></tr><tr><td>Органолептические показатели</td><td>'+esc(ttk.показатели_качества||'')+'</td></tr><tr><td>Пищевая ценность</td><td>'+esc(ttk.пищевая_ценность||'')+'</td></tr><tr><td>Аллергенная информация</td><td>'+esc(ttk.аллергенная_информация||'')+'</td></tr></table>'+    '<h2>5. HACCP</h2><table><tr><th>Контроль</th><th>Тип</th><th>Этап</th><th>Критический предел</th></tr>'+haccpHtml+'</table>'+    '<h2>6. Нормативные связи</h2><table><tr><th>Требование</th><th>Пункт</th><th>Источник</th></tr>'+sanpinHtml+'</table>'+    '<div class="sign"><span>Разработал: __________________</span><span>Утвердил: __________________</span></div><div class="small">Сформировано системой «ЦЕХ» · '+esc(_ocNow_())+'</div></body></html>';
  var out={document_type:'TTK_A4',html:html,generated_at:_ocNow_()};
  try{var blob=Utilities.newBlob(html,'text/html','ttk.html').getAs(MimeType.PDF).setName('TTK_'+data.dishId+'_v'+ttk.version+'.pdf');out.base64=Utilities.base64Encode(blob.getBytes());out.mimeType='application/pdf';out.fileName=blob.getName();}catch(e){out.pdf_error=String(e.message||e);}
  return out;
}
function generatePpkInspectionA4Pdf_(session,data){
  var p=getInspectionPacket_(session,data);var html=_ocPrintHtml_('Инспекционный пакет ППК','ППК '+p.packet.ppk_id+' • '+p.packet.generated_at,Object.keys(p.sections).map(function(k){return {title:k,data:p.sections[k]};}));
  var out={document_type:'PPK_INSPECTION_A4',html:html,generated_at:_ocNow_()};try{var blob=Utilities.newBlob(html,'text/html','ppk.html').getAs(MimeType.PDF).setName('PPK_INSPECTION_'+p.packet.packet_id+'.pdf');out.base64=Utilities.base64Encode(blob.getBytes());out.mimeType='application/pdf';out.fileName=blob.getName();}catch(e){out.pdf_error=String(e.message||e);}return out;
}

function enqueueOfflineOperation_(data,session){
  var row={queue_id:generateId_('OFFLINE_QUEUE'),organization_id:session.organization_id,location_id:session.location_id,user_id:session.user_id,operation_id:String(data.operationId||newOperationId_()),action:String(data.action||''),payload_json:JSON.stringify(data.payload||{}),status:'PENDING',created_at:_ocNow_(),synced_at:'',result_json:'',error:''};insertRow_('OFFLINE_QUEUE',row);return row;}
function syncOfflineQueue_(data,session){
  var ids=data.queueIds||[];var rows=findRows_('OFFLINE_QUEUE',function(r){return r.organization_id===session.organization_id&&r.user_id===session.user_id&&r.status==='PENDING'&&(!ids.length||ids.indexOf(r.queue_id)!==-1);});var results=[];rows.forEach(function(r){try{var res=processOperation(r.action,JSON.parse(r.payload_json||'{}'),session.token||data.token);updateRow_('OFFLINE_QUEUE',r,{status:res.ok?'SYNCED':'FAILED',synced_at:_ocNow_(),result_json:JSON.stringify(res),error:res.ok?'':String(res.error||'')});results.push({queue_id:r.queue_id,ok:!!res.ok,result:res});}catch(e){updateRow_('OFFLINE_QUEUE',r,{status:'FAILED',synced_at:_ocNow_(),error:String(e.message||e)});results.push({queue_id:r.queue_id,ok:false,error:String(e.message||e)});}});return results;}

function getRecursiveBatchCostTrace_(session,data){
  var root=findOne_('BATCHES','batch_id',data.batchId);_ocOwned_(session,root,'BATCHES:'+data.batchId);var visited={};
  function calc(batch,depth){
    if(!batch||depth>20)return {batch_id:batch&&batch.batch_id||'',unit_cost:0,qty:0,cost:0,depth:depth,children:[],cycle:false};
    if(visited[batch.batch_id]) return {batch_id:batch.batch_id,unit_cost:Number(batch.цена_прихода)||0,qty:Number(batch.количество)||0,cost:(Number(batch.количество)||0)*(Number(batch.цена_прихода)||0),depth:depth,children:[],cycle:true};
    visited[batch.batch_id]=true;
    var qty=Number(batch.количество)||0, unit=Number(batch.цена_прихода)||0, children=[], composed=false;
    var breakdown=findRows_('BREAKDOWN_ACT_LINES',function(l){return l.output_batch_id===batch.batch_id&&Number(l.actual_qty||0)>0;});
    if(breakdown.length){composed=true;breakdown.forEach(function(l){var src=findOne_('BATCHES','batch_id',l.batch_id);if(src){var c=calc(src,depth+1);c.consumed_qty=Number(l.actual_qty)||0;children.push(c);}});}
    var prodUses=findRows_('PRODUCTION_INGREDIENT_USAGE',function(u){return u.production_id && (findOne_('PRODUCTION','production_id',u.production_id)||{}).batch_id===batch.batch_id;});
    if(prodUses.length){composed=true;prodUses.forEach(function(u){var ids=[];try{ids=JSON.parse(u.batch_ids||'[]');}catch(e){} ids.forEach(function(id){var src=findOne_('BATCHES','batch_id',id);if(src){var c=calc(src,depth+1);c.consumed_qty=Number(u.брутто)||0;children.push(c);}});});}
    var totalInput=children.reduce(function(s,c){return s+(Number(c.cost)||0);},0);
    var effectiveUnit=composed&&qty>0?totalInput/qty:unit;
    return {batch_id:batch.batch_id,product_id:batch.product_id,depth:depth,qty:qty,remaining:getBatchRemaining_(batch),unit_cost:round2_(effectiveUnit),cost:round2_(effectiveUnit*qty),children:children};
  }
  var tree=calc(root,0);return {root_batch_id:root.batch_id,total_cost:tree.cost,unit_cost:tree.unit_cost,tree:tree,generated_at:_ocNow_()};
}

function releaseSemiFinishedQuality_(data,session){
  var batch=findOne_('BATCHES','batch_id',data.batchId);_ocOwned_(session,batch,'BATCHES:'+data.batchId);if(String(batch.product_id||'').indexOf('PF-')!==0) throw new Error('Партия не является полуфабрикатом.'); if(typeof assertNoBlockingIncidentForBatch_==='function') assertNoBlockingIncidentForBatch_(batch.batch_id,session);
  if(!data.decision||['RELEASE','REJECT','QUARANTINE'].indexOf(String(data.decision).toUpperCase())===-1) throw new Error('Решение quality release: RELEASE/REJECT/QUARANTINE.');
  var decision=String(data.decision).toUpperCase();var status=decision==='RELEASE'?'активна':decision==='REJECT'?'ЗАБРАКОВАНА':'КАРАНТИН';
  updateRow_('BATCHES',batch,{статус:status});var row={release_id:generateId_('PF_QUALITY_RELEASES'),organization_id:session.organization_id,location_id:session.location_id,batch_id:batch.batch_id,decision:decision,reason:String(data.reason||''),evidence_json:JSON.stringify(data.evidence||{}),created_at:_ocNow_(),created_by:session.user_id,cascade_id:session.cascade_id||''};insertRow_('PF_QUALITY_RELEASES',row);auditLog_(session.user_id,'Решение quality release PF','PF_QUALITY_RELEASES:'+row.release_id,batch.статус,status,'success',session.cascade_id||'');return {release:row,batch:findOne_('BATCHES','batch_id',batch.batch_id)};
}

function getDeploymentReadiness_(session){
  var requiredSheets=['INVOICE_INTAKE_DRAFTS','INVOICE_DOCUMENTS','HACCP_DECISIONS','OFFLINE_QUEUE','PF_QUALITY_RELEASES'];var missing=[];requiredSheets.forEach(function(k){if(!CONFIG.SCHEMA[k])missing.push(k);});
  var ppk=typeof getPpkReadiness_==='function'?getPpkReadiness_(session.organization_id,session.location_id):{ready:false,missing:['HACCP engine']};
  return {ready:missing.length===0&&ppk.ready,missing:missing,ppk:ppk,checks:{document_integrity:true,confirm_receipt:true,haccp_decision_engine:true,emergency_center:true,print_documents:true,offline_queue:true,recursive_cost:true,pf_quality_release:true},generated_at:_ocNow_()};
}
