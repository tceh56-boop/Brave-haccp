/* ============================================================================
 * MON CHEF V12 — OCR AUTOPILOT / SUPPLIER MEMORY / SECOND-PASS VERIFICATION
 *
 * V12 builds on V10+V11 without replacing them.
 *  - supplier fingerprints and supplier-specific aliases
 *  - historical match statistics
 *  - deterministic confidence calibration
 *  - second LLM audit only for suspicious documents
 *  - duplicate-document detection before a stock posting
 *  - no automatic learning without human confirmation
 * ========================================================================== */

var MC_V12_OCR = {
  STATS_SHEET: 'OCR_PRODUCT_STATS',
  SUPPLIER_SHEET: 'OCR_SUPPLIERS',
  DEDUPE_SHEET: 'OCR_DOCUMENT_DEDUPE',
  STATS_HEADERS: ['Key','Supplier','RawNorm','CanonicalName','Hits','LastConfirmedAt','LastConfirmedBy'],
  SUPPLIER_HEADERS: ['SupplierKey','SupplierName','Fingerprint','Hits','LastSeenAt','CreatedAt'],
  DEDUPE_HEADERS: ['DocKey','DocumentType','Supplier','DocumentNumber','DocumentDate','Total','FirstSeenAt','FirstCaptureID','Status'],
  REVIEW_THRESHOLD: 0.78,
  AUTOPASS_THRESHOLD: 0.90
};

function _mcV12EnsureSheets_() {
  var ss=_book_();
  var specs=[
    [MC_V12_OCR.STATS_SHEET,MC_V12_OCR.STATS_HEADERS],
    [MC_V12_OCR.SUPPLIER_SHEET,MC_V12_OCR.SUPPLIER_HEADERS],
    [MC_V12_OCR.DEDUPE_SHEET,MC_V12_OCR.DEDUPE_HEADERS]
  ];
  specs.forEach(function(s){var sh=ss.getSheetByName(s[0])||ss.insertSheet(s[0]);if(sh.getLastRow()===0)sh.appendRow(s[1]);});
  return true;
}

function _mcV12SupplierKey_(s){return _mcV11Norm_(String(s||'')).replace(/[^а-я0-9]+/g,' ').trim();}

function _mcV12Fingerprint_(text){
  var s=String(text||'').toLowerCase().replace(/ё/g,'е');
  var hits=[];
  ['пятерочка','магнит','счет на оплату','универсальный передаточный документ','упд','товарный чек','формат мероприятия','место проведения','платежное поручение'].forEach(function(x){if(s.indexOf(x)>=0)hits.push(x);});
  return hits.join('|');
}

function _mcV12RememberSupplier_(supplier,text,who){
  supplier=String(supplier||'').trim(); if(!supplier)return;
  try{
    var sh=_book_().getSheetByName(MC_V12_OCR.SUPPLIER_SHEET)||_mcV12EnsureSheets_()&&_book_().getSheetByName(MC_V12_OCR.SUPPLIER_SHEET);
    var key=_mcV12SupplierKey_(supplier), fp=_mcV12Fingerprint_(text), v=sh.getDataRange().getValues(), row=-1;
    for(var i=1;i<v.length;i++){if(String(v[i][0])===key){row=i+1;break;}}
    var now=new Date();
    if(row>0){sh.getRange(row,2).setValue(supplier);sh.getRange(row,3).setValue(fp);sh.getRange(row,4).setValue((Number(v[row-1][3])||0)+1);sh.getRange(row,5).setValue(now);}
    else sh.appendRow([key,supplier,fp,1,now,now]);
  }catch(e){}
}

function _mcV12HistoricalScore_(rawName,canonicalName,supplier){
  try{
    var sh=_book_().getSheetByName(MC_V12_OCR.STATS_SHEET); if(!sh)return 0;
    var v=sh.getDataRange().getValues(), rn=_mcV11Norm_(rawName), sup=_mcV12SupplierKey_(supplier), score=0;
    for(var i=1;i<v.length;i++){
      if(_mcV11Norm_(v[i][2])===rn && _mcV12SupplierKey_(v[i][1])===sup && _mcV11Norm_(v[i][3])===_mcV11Norm_(canonicalName)) score=Math.max(score,Math.min(1,0.78+Math.min(0.18,(Number(v[i][4])||0)*0.02)));
    }
    return score;
  }catch(e){return 0;}
}

function _mcV12ResolveProduct_(rawName,supplier){
  var base=_mcV11ResolveProduct_(rawName,supplier), best=base.matched, hist=[];
  if(best&&best.name){
    var hs=_mcV12HistoricalScore_(rawName,best.name,supplier);
    if(hs>0){best=Object.assign({},best,{confidence:Math.max(Number(best.confidence)||0,hs),source:'HISTORY'});}
  }
  // Add historical alias candidates from review log if they differ from the base matcher.
  try{
    var log=_book_().getSheetByName(MC_V11_OCR.LOG_SHEET);
    if(log){var v=log.getDataRange().getValues(),rn=_mcV11Norm_(rawName),sup=_mcV12SupplierKey_(supplier);
      for(var i=1;i<v.length;i++){
        if(_mcV11Norm_(v[i][1])!==rn)continue;
        if(sup && _mcV12SupplierKey_(v[i][4])!==sup)continue;
        var n=String(v[i][3]||'').trim(); if(n&&!hist.some(function(x){return x.name===n;}))hist.push({name:n,confidence:0.82,source:'REVIEW_HISTORY'});
      }
    }
  }catch(e){}
  var alts=(base.alternatives||[]).concat(hist).filter(function(x){return !best||_mcV11Norm_(x.name)!==_mcV11Norm_(best.name);});
  alts.sort(function(a,b){return (Number(b.confidence)||0)-(Number(a.confidence)||0);});
  return {matched:best||null,alternatives:alts.slice(0,5),source:best&&best.source||base.source};
}

function _mcV12Calibrate_(rawConf,visQuality,matchConf,arithOk,docType){
  var c=_mcV10NormalizeNumber_(rawConf); if(c===null)c=Number(visQuality)||0;
  c=Math.max(0,Math.min(1,c));
  if(matchConf!==null&&matchConf!==undefined)c=c*0.78+Math.max(0,Math.min(1,Number(matchConf)||0))*0.22;
  if(arithOk===false)c-=0.14;
  if(docType==='PRODUCT_RECEIPT')c-=0.04;
  if(docType==='RETAIL_RECEIPT'&&arithOk===true)c+=0.03;
  return Math.round(Math.max(0,Math.min(1,c))*100)/100;
}

function _mcV12DocKey_(doc){
  var parts=[doc.document_type||'',doc.supplier||'',doc.document_number||'',doc.document_date||'',_mcV10NormalizeNumber_(doc.total)||''];
  var lines=(doc.items||[]).slice(0,30).map(function(x){return _mcV11Norm_(x.raw_name||x.name)+'|'+(_mcV10NormalizeNumber_(x.quantity)||'')+'|'+(_mcV10NormalizeNumber_(x.sum)||'');}).join('~');
  var s=parts.join('|')+'|'+lines;
  var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,'');
}

function _mcV12CheckDuplicate_(doc,captureId){
  try{
    _mcV12EnsureSheets_();
    var sh=_book_().getSheetByName(MC_V12_OCR.DEDUPE_SHEET), key=_mcV12DocKey_(doc), v=sh.getDataRange().getValues();
    for(var i=1;i<v.length;i++){
      if(String(v[i][0])===key){return {duplicate:true,docKey:key,firstCaptureId:String(v[i][7]||''),status:String(v[i][8]||'')};}
    }
    sh.appendRow([key,doc.document_type||'',doc.supplier||'',doc.document_number||'',doc.document_date||'',doc.total||'',new Date(),captureId||'','SEEN']);
    return {duplicate:false,docKey:key};
  }catch(e){return {duplicate:false,error:String(e)};}
}

function _mcV12AuditPrompt_(){
  return 'Ты проверяешь результат OCR документа кухни. Тебе дан OCR-текст и JSON извлечения. Не переписывай документ целиком. Верни ТОЛЬКО JSON: '+
    '{"ok":true,"document_number":null,"document_date":null,"supplier":null,"total":null,"line_corrections":[],"warnings":[]}. '+
    'line_corrections содержит только реально подтверждаемые исправления: [{"line_number":1,"raw_name":null,"quantity":null,"unit":null,"price":null,"sum":null}]. '+
    'Ничего не угадывай. Если данных недостаточно — оставь null. Проверяй прежде всего числа, номер, дату, поставщика и соответствие quantity*price≈sum.';
}

function _mcV12AuditExtraction_(vis,extracted){
  try{
    var body={modelUri:'gpt://'+vis.folder+'/yandexgpt/latest',completionOptions:{stream:false,temperature:0,maxTokens:2500},messages:[
      {role:'system',text:_mcV12AuditPrompt_()},
      {role:'user',text:'=== OCR ===\n'+_mcV10PackOcrText_(vis)+'\n\n=== EXTRACTED JSON ===\n'+JSON.stringify(extracted)}
    ]};
    var r=UrlFetchApp.fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion',{method:'post',contentType:'application/json',headers:{'Authorization':'Api-Key '+vis.key,'x-folder-id':vis.folder},payload:JSON.stringify(body),muteHttpExceptions:true});
    if(r.getResponseCode()!==200)return {error:'audit-llm'};
    var j=JSON.parse(r.getContentText()),raw=String(j.result.alternatives[0].message.text||'').replace(/```json|```/g,'').trim();
    return JSON.parse(raw);
  }catch(e){return {error:'audit-parse',body:String(e)};}
}

function _mcV12ApplyAudit_(extracted,audit){
  if(!audit||audit.error)return extracted;
  if(audit.document_number && !extracted.document_number)extracted.document_number=audit.document_number;
  if(audit.document_date && !extracted.document_date)extracted.document_date=audit.document_date;
  if(audit.supplier && !extracted.supplier)extracted.supplier=audit.supplier;
  if(audit.total!==null&&audit.total!==undefined&&extracted.total===null)extracted.total=audit.total;
  var corr=Array.isArray(audit.line_corrections)?audit.line_corrections:[];
  var items=Array.isArray(extracted.items)?extracted.items:[];
  corr.forEach(function(c){var n=Number(c.line_number)-1;if(n<0||n>=items.length)return;var it=items[n];['raw_name','quantity','unit','price','sum'].forEach(function(k){if(c[k]!==null&&c[k]!==undefined&&c[k]!=='')it[k]=c[k];});it.confidence=Math.max(Number(it.confidence)||0,0.82);});
  if(Array.isArray(audit.warnings))extracted.warnings=(extracted.warnings||[]).concat(audit.warnings.map(String));
  extracted._audit= audit.ok!==false ? 'SECOND_PASS_OK' : 'SECOND_PASS_WARNINGS';
  return extracted;
}

function _mcV12Finalize_(extracted,vis,supplierHint,captureId){
  extracted=extracted||{};
  var rawText=String(vis.layoutText||vis.fullText||''), type=_mcV11Classify_(rawText,extracted.document_type||'unknown');
  var supplier=String(extracted.supplier||supplierHint||'').trim();
  var items=Array.isArray(extracted.items)?extracted.items:[], warnings=Array.isArray(extracted.warnings)?extracted.warnings.slice():[];
  var total=0,review=0,allArith=true;
  var clean=items.map(function(it,idx){
    var raw=String(it.raw_name||it.name||'').trim(), resolved=_mcV12ResolveProduct_(raw,supplier);
    var q=_mcV10NormalizeNumber_(it.quantity),p=_mcV10NormalizeNumber_(it.price),sum=_mcV10NormalizeNumber_(it.sum),mismatch=false;
    if(q!==null&&p!==null&&sum!==null)mismatch=Math.abs(q*p-sum)>Math.max(1,Math.abs(sum)*0.02);
    if(mismatch)allArith=false;
    if(sum===null&&q!==null&&p!==null)sum=Math.round(q*p*100)/100;
    if(p===null&&q!==null&&sum!==null&&q>0)p=Math.round(sum/q*100)/100;
    if(sum!==null)total+=sum;
    var base=_mcV10NormalizeNumber_(it.confidence);if(base===null)base=vis.quality;
    var mc=resolved.matched?Number(resolved.matched.confidence)||0:null;
    var conf=_mcV12Calibrate_(base,vis.quality,mc,!mismatch,type);
    var needs=!raw||q===null||q<=0||mismatch||conf<MC_V12_OCR.REVIEW_THRESHOLD||!resolved.matched;
    if(needs)review++;
    if(!resolved.matched)warnings.push('Строка '+(idx+1)+': нет уверенного соответствия номенклатуре.');
    if(mismatch)warnings.push('Строка '+(idx+1)+': количество × цена не совпадает с суммой.');
    return {line_number:it.line_number||idx+1,raw_name:raw,normalized_name:String(it.normalized_name||raw).trim(),quantity:q,unit:it.unit?String(it.unit).trim():null,price:p,sum:sum,vat:_mcV10NormalizeNumber_(it.vat),batch_number:it.batch_number||null,expiry_date:_mcV10NormalizeDate_(it.expiry_date),confidence:conf,matched_product:resolved.matched,alternative_matches:resolved.alternatives||[],match_source:resolved.source,calculation_mismatch:mismatch,requires_manual_review:needs};
  });
  var docConf=_mcV12Calibrate_(extracted.recognition_confidence,vis.quality,clean.length?clean.reduce(function(s,x){return s+(x.confidence||0);},0)/clean.length:null,allArith,type);
  if(review)warnings.push('Требуют проверки: '+review+' строк(и).');
  if(vis.quality<0.68)warnings.push('Низкое качество исходного OCR.');
  var doc={document_type:type,document_number:extracted.document_number||null,document_date:_mcV10NormalizeDate_(extracted.document_date),supplier:supplier||null,buyer:extracted.buyer||null,total:extracted.total!==null&&extracted.total!==undefined?_mcV10NormalizeNumber_(extracted.total):(total||null),recognition_confidence:docConf,items:clean,warnings:warnings,requires_manual_review:review>0||warnings.length>0};
  _withLock_(function(){doc.duplicate=_mcV12CheckDuplicate_(doc,captureId||'');_mcV12RememberSupplier_(supplier,rawText,'');});
  doc.autopilot={secondPass:extracted._audit||null,autoAccept:docConf>=MC_V12_OCR.AUTOPASS_THRESHOLD&&review===0&&!doc.duplicate.duplicate,reviewThreshold:MC_V12_OCR.REVIEW_THRESHOLD};
  doc._debug={model:vis.model,ocrQuality:vis.quality,ocrText:vis.layoutText||vis.fullText||'',ocrMarkdown:vis.markdown||'',ocrTextOriginal:vis.fullText||'',secondPass:extracted._audit||null};
  return doc;
}

function scanInvoiceV12(dataUrl,typeHint,captureId){
  try{
    _withLock_(function(){_mcV12EnsureSheets_();});   // этап 10.8: под блокировкой — только запись; OCR и разбор — вне её
    var vis=_mcV10BestVision_(dataUrl,typeHint||''); if(vis.error)return JSON.stringify(vis);
    var ext=_mcV11ParseJsonLlm_(vis); if(ext.error)return JSON.stringify(ext);
    var preliminary=_mcV11Finalize_(ext,vis,'');
    // Второй проход только если документ реально сомнительный: это экономит время/лимит.
    if(preliminary.requires_manual_review || preliminary.recognition_confidence<MC_V12_OCR.AUTOPASS_THRESHOLD){
      var audit=_mcV12AuditExtraction_(vis,ext); ext=_mcV12ApplyAudit_(ext,audit);
    }
    return JSON.stringify(_mcV12Finalize_(ext,vis,'',captureId||''));
  }catch(e){return JSON.stringify({error:'exception',body:String(e)});}
}

function scanProductReceiptV12(dataUrl,captureId){return scanInvoiceV12(dataUrl,'PRODUCT_RECEIPT',captureId);}

function getOcrAutopilotStats(token){
  try{_requireAuth_(token,'stock');}catch(e){return JSON.stringify({error:'forbidden'});}
  try{
    _mcV12EnsureSheets_();
    var a=_book_().getSheetByName(MC_V11_OCR.ALIAS_SHEET),s=_book_().getSheetByName(MC_V12_OCR.STATS_SHEET),d=_book_().getSheetByName(MC_V12_OCR.DEDUPE_SHEET);
    return JSON.stringify({aliases:Math.max(0,(a?a.getLastRow():1)-1),historicalMatches:Math.max(0,(s?s.getLastRow():1)-1),documentsSeen:Math.max(0,(d?d.getLastRow():1)-1)});
  }catch(e){return JSON.stringify({error:String(e)});}
}

function rememberOcrAliasV12(rawName,canonicalName,supplier,documentType,captureId,token){
  var res=rememberOcrAlias(rawName,canonicalName,supplier,documentType,captureId,token);
  try{
    var parsed=JSON.parse(res); if(parsed&&parsed.ok){
      _mcV12EnsureSheets_();
      var sh=_book_().getSheetByName(MC_V12_OCR.STATS_SHEET),v=sh.getDataRange().getValues(),rn=_mcV11Norm_(rawName),sup=String(supplier||''),can=String(canonicalName||''),found=-1;
      var who='';try{who=(_requireAuth_(token,'stock').fullName||'');}catch(e){}
      for(var i=1;i<v.length;i++){if(_mcV11Norm_(v[i][2])===rn&&_mcV12SupplierKey_(v[i][1])===_mcV12SupplierKey_(sup)&&_mcV11Norm_(v[i][3])===_mcV11Norm_(can)){found=i+1;break;}}
      var now=new Date();
      if(found>0){sh.getRange(found,5).setValue((Number(v[found-1][4])||0)+1);sh.getRange(found,6).setValue(now);sh.getRange(found,7).setValue(who);}
      else sh.appendRow(['OS'+Date.now(),sup,rn,can,1,now,who]);
    }
  }catch(e){}
  return res;
}
