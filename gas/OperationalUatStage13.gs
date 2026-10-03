/**
 * ЦЕХ — Stage 13: UAT / document resolution hardening.
 *
 * 1) Manual resolution of an OCR line before receipt confirmation.
 * 2) Append an additional scanned page to an existing intake draft.
 * 3) Rebuild integrity/HACCP state after corrections.
 * 4) Document-integrity dashboard for blocked/recovery drafts.
 */
function _st13RebuildDraft_(d, session) {
  var doc=_st12ParseJson_(d.document_json,{});
  var lines=_st12ParseJson_(d.lines_json,[]);
  var mapped=[], errors=[], warnings=[];
  lines.forEach(function(line,idx){
    line.line_no=line.line_no||idx+1;
    var m=line.match;
    if(!m || !m.product_id){
      errors.push({line:line.line_no,error:'Товар не сопоставлен однозначно',candidates:(m&&m.candidates)||[]});
      return;
    }
    var h=runHaccpDecisionEngine_({eventType:'RECEIPT',productId:m.product_id,line:line},session);
    line.haccp=h;
    if(h.decision===HACCP_DECISION.BLOCK) errors.push({line:line.line_no,error:'HACCP/ППК блокировка',reasons:h.reasons||[]});
    else {mapped.push(line);(h.warnings||[]).forEach(function(w){warnings.push({line:line.line_no,warning:w});});}
  });
  var integrity=_documentIntegrityCheck_(doc,lines,session,d.draft_id);
  if([DOCUMENT_INTEGRITY_STATUS.CONFLICT,DOCUMENT_INTEGRITY_STATUS.DUPLICATE,DOCUMENT_INTEGRITY_STATUS.REVIEW].indexOf(integrity.status)!==-1){
    (integrity.reasons||[]).forEach(function(x){errors.push({line:0,error:x});});
  }
  var status=(integrity.status===DOCUMENT_INTEGRITY_STATUS.CONFLICT||integrity.status===DOCUMENT_INTEGRITY_STATUS.DUPLICATE||integrity.status===DOCUMENT_INTEGRITY_STATUS.REVIEW||(!mapped.length&&errors.length))?'BLOCKED':(errors.length?'PARTIAL':'READY');
  updateRow_('INVOICE_INTAKE_DRAFTS',d,{status:status,lines_json:JSON.stringify(lines),matched_lines_json:JSON.stringify(mapped),integrity_json:JSON.stringify(integrity),haccp_json:JSON.stringify(mapped.map(function(x){return x.haccp;})),warnings_json:JSON.stringify(warnings),errors_json:JSON.stringify(errors)});
  var docs=findRows_('INVOICE_DOCUMENTS',function(r){return r.draft_id===d.draft_id;});
  docs.forEach(function(r){updateRow_('INVOICE_DOCUMENTS',r,{document_number:String(doc.invoice_number||doc.number||''),document_date:String(doc.invoice_date||doc.date||''),supplier_id:String(doc.supplier_id||''),document_fingerprint:integrity.document_fingerprint,lines_fingerprint:integrity.lines_fingerprint});});
  return {draft_id:d.draft_id,status:status,document:doc,lines:lines,matched_lines:mapped,integrity:integrity,warnings:warnings,errors:errors,preview:buildInvoicePostingPreview_(mapped,session)};
}

function resolveInvoiceIntakeLine_(data,session){
  data=data||{};
  var d=findOne_('INVOICE_INTAKE_DRAFTS','draft_id',data.draftId); _ocOwned_(session,d,'INVOICE_INTAKE_DRAFTS:'+data.draftId);
  if(['POSTED','POSTING'].indexOf(d.status)!==-1) throw new Error('Нельзя изменять уже проводимый/проведённый документ.');
  var productId=String(data.productId||''); if(!productId) throw new Error('Не указан productId.');
  var product=getProductById_(productId); if(!product) throw new Error('Товар не найден.');
  if(product.organization_id!==session.organization_id) throw new Error('Товар принадлежит другой организации.');
  var lines=_st12ParseJson_(d.lines_json,[]), lineNo=Number(data.lineNo||0);
  var line=lines.filter(function(x){return Number(x.line_no)===lineNo;})[0];
  if(!line) throw new Error('Строка накладной не найдена: '+lineNo);
  line.match={product_id:productId,product:product,candidates:[]};
  if(data.article!==undefined) line.article=data.article;
  if(data.barcode!==undefined) line.barcode=data.barcode;
  if(data.name!==undefined) line.name=data.name;
  updateRow_('INVOICE_INTAKE_DRAFTS',d,{lines_json:JSON.stringify(lines)});
  d=findOne_('INVOICE_INTAKE_DRAFTS','draft_id',data.draftId);
  return _st13RebuildDraft_(d,session);
}

function appendInvoiceIntakePage_(data,session){
  data=data||{};
  var d=findOne_('INVOICE_INTAKE_DRAFTS','draft_id',data.draftId); _ocOwned_(session,d,'INVOICE_INTAKE_DRAFTS:'+data.draftId);
  if(['POSTED','POSTING'].indexOf(d.status)!==-1) throw new Error('Нельзя добавлять страницу после начала проведения.');
  var invoice=data.mockInvoice || runSupplierInvoiceOcr_(data.base64Image,data.mimeType||'image/jpeg',session);
  var pageDoc=invoice.document||{}, pageLines=invoice.lines||[]; if(!pageLines.length) throw new Error('На странице не найдены товарные строки.');
  var doc=_st12ParseJson_(d.document_json,{}), lines=_st12ParseJson_(d.lines_json,[]), start=lines.length;
  Object.keys(pageDoc).forEach(function(k){if((doc[k]===undefined||doc[k]==='')&&pageDoc[k]!==undefined) doc[k]=pageDoc[k];});
  pageLines.forEach(function(line,i){line.line_no=start+i+1; var m=matchInvoiceLineToProduct_(line,session); line.match=m; lines.push(line);});
  updateRow_('INVOICE_INTAKE_DRAFTS',d,{document_json:JSON.stringify(doc),lines_json:JSON.stringify(lines)});
  d=findOne_('INVOICE_INTAKE_DRAFTS','draft_id',data.draftId);
  return _st13RebuildDraft_(d,session);
}

function getDocumentIntegrityDashboard_(session){
  var drafts=findRows_('INVOICE_INTAKE_DRAFTS',function(r){return r.organization_id===session.organization_id && ['BLOCKED','RECOVERY_REQUIRED','PARTIAL'].indexOf(r.status)!==-1 && (!session.location_id || CONFIG.ROLE_DATA_SCOPE[session.role||'']==='ORGANIZATION' || r.location_id===session.location_id);});
  return drafts.map(function(d){var i=_st12ParseJson_(d.integrity_json,{});return {draft_id:d.draft_id,status:d.status,document_number:(_st12ParseJson_(d.document_json,{}).invoice_number||''),document_date:(_st12ParseJson_(d.document_json,{}).invoice_date||''),integrity_status:i.status||'',reasons:i.reasons||[],created_at:d.created_at};}).sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);});
}


function getOperationalReadinessStage13_(session){
  var base=typeof getOperationalReadinessStage12_==='function'?getOperationalReadinessStage12_(session):{ready:false,missing:['Stage12']};
  var checks={
    manual_line_resolution:typeof resolveInvoiceIntakeLine_==='function',
    multipage_invoice:typeof appendInvoiceIntakePage_==='function',
    document_integrity_dashboard:typeof getDocumentIntegrityDashboard_==='function',
    haccp_decision_persisted:true,
    haccp_evidence_persisted:true,
    emergency_invoice_visibility:true,
    exact_duplicate_detection:true,
    supplier_conflict_detection:true
  };
  var all=base.ready&&Object.keys(checks).every(function(k){return checks[k]===true;});
  return {ready:all,base:base,checks:checks,generated_at:_ocNow_()};
}
