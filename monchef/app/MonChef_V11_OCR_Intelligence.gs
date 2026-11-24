/* ============================================================================
 * MON CHEF V11 — OCR INTELLIGENCE / НОМЕНКЛАТУРА / АДАПТАЦИЯ ПОД РЕАЛЬНЫЕ ЧЕКИ
 *
 * V11 не заменяет V10. Он добавляет над ним:
 *  1) устойчивую очистку OCR-текста от типичных 0/O, Latin/Cyrillic ошибок;
 *  2) классификацию реальных документов (Пятёрочка/Магнит/УПД/счёт/товарный чек);
 *  3) сопоставление строки с номенклатурой через существующий R2 matcher +
 *     второй fuzzy-проход с расстоянием Левенштейна;
 *  4) постоянный словарь подтверждённых пользователем алиасов OCR;
 *  5) supplier-specific aliases (один и тот же товар у разных поставщиков может
 *     печататься по-разному);
 *  6) строгий шлюз: OCR никогда сам не создаёт приход и не обучает словарь.
 *
 * Схема обучения:
 *   OCR -> предложение -> человек исправил -> rememberOcrAlias() -> будущий OCR точнее.
 * ========================================================================== */

var MC_V11_OCR = {
  ALIAS_SHEET: 'OCR_ALIASES',
  LOG_SHEET: 'OCR_REVIEW_LOG',
  ALIAS_HEADERS: ['AliasID','RawText','CanonicalName','Supplier','NormalizedAlias','Hits','CreatedAt','CreatedBy','LastUsedAt','Active'],
  LOG_HEADERS: ['ReviewID','RawText','BeforeName','AfterName','Supplier','DocumentType','CaptureID','ReviewedBy','ReviewedAt','Source'],
  MIN_FUZZY: 0.70
};

function _mcV11EnsureSheets_() {
  var ss = _book_();
  var a = ss.getSheetByName(MC_V11_OCR.ALIAS_SHEET) || ss.insertSheet(MC_V11_OCR.ALIAS_SHEET);
  if (a.getLastRow() === 0) a.appendRow(MC_V11_OCR.ALIAS_HEADERS);
  var l = ss.getSheetByName(MC_V11_OCR.LOG_SHEET) || ss.insertSheet(MC_V11_OCR.LOG_SHEET);
  if (l.getLastRow() === 0) l.appendRow(MC_V11_OCR.LOG_HEADERS);
  return {aliases:a, log:l};
}

function _mcV11Norm_(s) {
  var x = String(s || '').toLowerCase().replace(/ё/g,'е');
  // Только буквенные позиции: не трогаем числа, проценты и цены.
  x = x.replace(/([а-яa-z])[a-z]*/g, function(m){ return m; });
  var map = {'a':'а','c':'с','e':'е','o':'о','p':'р','x':'х','y':'у','k':'к','m':'м','t':'т','b':'в','h':'н'};
  x = x.split('').map(function(ch){ return map[ch] || ch; }).join('');
  x = x.replace(/[«»"'`]/g,' ').replace(/[.,;:()\[\]{}]/g,' ');
  x = x.replace(/\b(шт|штук)\.?\b/g,' шт ')
       .replace(/\b(килограмм|килограмма|килограммов|кг)\.?\b/g,' кг ')
       .replace(/\b(грамм|грамма|гр)\.?\b/g,' г ')
       .replace(/\b(литр|литра|литров|л)\.?\b/g,' л ')
       .replace(/\b(миллилитр|миллилитра|мл)\.?\b/g,' мл ');
  return x.replace(/\s+/g,' ').trim();
}

function _mcV11Words_(s) {
  return _mcV11Norm_(s).split(' ').filter(function(w){return w.length >= 2 && !/^\d+$/.test(w) && !/^(кг|г|л|мл|шт)$/.test(w);});
}

function _mcV11Edit_(a,b) {
  a=String(a||''); b=String(b||'');
  if(a===b)return 0;
  if(!a.length)return b.length; if(!b.length)return a.length;
  var prev=[],cur=[]; for(var j=0;j<=b.length;j++)prev[j]=j;
  for(var i=1;i<=a.length;i++){
    cur[0]=i;
    for(var k=1;k<=b.length;k++){
      var cost=a[i-1]===b[k-1]?0:1;
      cur[k]=Math.min(cur[k-1]+1,prev[k]+1,prev[k-1]+cost);
    }
    var t=prev;prev=cur;cur=t;
  }
  return prev[b.length];
}

function _mcV11TokenSim_(a,b) {
  a=_mcV11Norm_(a); b=_mcV11Norm_(b);
  if(!a||!b)return 0;
  if(a===b)return 1;
  if(a.length>=5&&b.indexOf(a)===0 || b.length>=5&&a.indexOf(b)===0)return 0.92;
  var max=Math.max(a.length,b.length); if(max<4)return 0;
  return 1 - (_mcV11Edit_(a,b)/max);
}

function _mcV11FuzzyScore_(query,candidate) {
  var q=_mcV11Words_(query), c=_mcV11Words_(candidate);
  if(!q.length||!c.length)return 0;
  var matched=0;
  q.forEach(function(w){
    var best=0; c.forEach(function(v){best=Math.max(best,_mcV11TokenSim_(w,v));});
    if(best>=MC_V11_OCR.MIN_FUZZY) matched += best;
  });
  var cover=matched/q.length;
  var exactish=0;
  q.forEach(function(w){if(c.some(function(v){return _mcV11TokenSim_(w,v)>=0.92;}))exactish++;});
  return Math.min(1, cover*0.8 + (exactish/q.length)*0.2);
}

function _mcV11LoadAliases_(supplier) {
  try {
    var sh=_book_().getSheetByName(MC_V11_OCR.ALIAS_SHEET); if(!sh)return [];
    var v=sh.getDataRange().getValues(), out=[];
    for(var i=1;i<v.length;i++){
      if(!v[i][0] || v[i][9]===false)continue;
      var sup=String(v[i][3]||'').trim();
      if(sup && supplier && _mcV11Norm_(sup)!==_mcV11Norm_(supplier))continue;
      out.push({id:v[i][0],raw:v[i][1],canonical:v[i][2],supplier:sup,norm:v[i][4],hits:Number(v[i][5])||0,row:i+1});
    }
    return out;
  }catch(e){return [];}
}

function _mcV11AliasMatch_(rawName,supplier) {
  var aliases=_mcV11LoadAliases_(supplier), q=_mcV11Norm_(rawName), best=null, bestScore=0;
  aliases.forEach(function(a){
    var s=(a.norm===q)?1:_mcV11FuzzyScore_(q,a.norm);
    if(s>bestScore){bestScore=s;best=a;}
  });
  if(best && bestScore>=0.88)return {matched:{name:best.canonical,confidence:1,source:'OCR_ALIASES',aliasId:best.id},score:bestScore};
  return null;
}

function _mcV11ProductFallback_(rawName, topN) {
  var products=[];
  try{products=JSON.parse(getProductNames());}catch(e){products=[];}
  var arr=products.map(function(p){return {name:p.name,unit:p.unit,confidence:Math.round(_mcV11FuzzyScore_(rawName,p.name)*100)/100,source:'FUZZY'};})
    .filter(function(x){return x.confidence>=MC_V11_OCR.MIN_FUZZY;})
    .sort(function(a,b){return b.confidence-a.confidence;});
  return arr.slice(0,topN||5);
}

function _mcV11ResolveProduct_(rawName,supplier) {
  var alias=_mcV11AliasMatch_(rawName,supplier);
  if(alias)return {matched:alias.matched,alternatives:[],source:'OCR_ALIASES'};
  var r={matched:null,alternatives:[],source:'R2'};
  try{r=_matchNomenclature_(rawName,5);}catch(e){}
  if(r.matched && r.matched.confidence>=0.55){r.source='R2';return r;}
  var f=_mcV11ProductFallback_(rawName,5);
  if(f.length && (!r.matched || f[0].confidence>r.matched.confidence)){
    return {matched:f[0],alternatives:f.slice(1),source:'FUZZY'};
  }
  return r;
}

function _mcV11Classify_(text, llmType) {
  var s=String(text||'').toLowerCase().replace(/ё/g,'е');
  if(/универсальн.{0,25}передаточн|\bупд\b/.test(s))return 'UPD';
  if(/счет\s+на\s+оплату|счет на оплату/.test(s))return 'INVOICE';
  if(/платежн.{0,25}поручен|образец заполнения платежного поручения/.test(s))return 'PAYMENT_ORDER';
  if(/формат мероприятия|место проведения|количество персон|пожелания/.test(s))return 'BANQUET_ORDER';
  if(/пятерочка|пятерочка|x5 клуб|ккм|ккт|фн\s*[:№]|фд\s*[:№]|кассовый чек/.test(s))return 'RETAIL_RECEIPT';
  if(/магнит|карта магнит|кассовый чек/.test(s))return 'RETAIL_RECEIPT';
  if(/товарный чек|подпись продавца|наименование товара/.test(s))return 'PRODUCT_RECEIPT';
  return llmType||'UNKNOWN';
}

function _mcV11ParseJsonLlm_(vis) {
  var extracted=_mcV10CallGpt_(_mcV10PackOcrText_(vis),vis.key,vis.folder);
  return extracted;
}

function _mcV11Finalize_(extracted,vis,supplierHint) {
  extracted=extracted||{};
  var rawText=String(vis.layoutText||vis.fullText||'');
  var type=_mcV11Classify_(rawText,extracted.document_type||'unknown');
  var supplier=extracted.supplier||supplierHint||'';
  var warnings=Array.isArray(extracted.warnings)?extracted.warnings.slice():[];
  var items=Array.isArray(extracted.items)?extracted.items:[];
  var total=0, review=0;
  var clean=items.map(function(it,idx){
    var raw=String(it.raw_name||it.name||'').trim();
    var resolved=_mcV11ResolveProduct_(raw,supplier);
    var q=_mcV10NormalizeNumber_(it.quantity), p=_mcV10NormalizeNumber_(it.price), sum=_mcV10NormalizeNumber_(it.sum);
    var mismatch=false;
    if(q!==null&&p!==null&&sum!==null)mismatch=Math.abs(q*p-sum)>Math.max(1,Math.abs(sum)*0.02);
    if(sum===null&&q!==null&&p!==null)sum=Math.round(q*p*100)/100;
    if(p===null&&q!==null&&sum!==null&&q>0)p=Math.round(sum/q*100)/100;
    if(sum!==null)total+=sum;
    var conf=_mcV10NormalizeNumber_(it.confidence); if(conf===null)conf=vis.quality;
    if(resolved.matched)conf=Math.min(1,conf*0.75 + Math.min(1,Number(resolved.matched.confidence)||0)*0.25);
    if(!raw||q===null||q<=0||mismatch||conf<0.75||!resolved.matched)review++;
    if(!resolved.matched)warnings.push('Строка '+(idx+1)+': не удалось уверенно сопоставить с номенклатурой.');
    if(mismatch)warnings.push('Строка '+(idx+1)+': количество × цена не совпадает с суммой.');
    return {
      line_number:it.line_number||idx+1, raw_name:raw,
      normalized_name:String(it.normalized_name||raw).trim(),
      quantity:q, unit:it.unit?String(it.unit).trim():null, price:p, sum:sum,
      vat:_mcV10NormalizeNumber_(it.vat), batch_number:it.batch_number||null,
      expiry_date:_mcV10NormalizeDate_(it.expiry_date), confidence:Math.round(conf*100)/100,
      matched_product:resolved.matched, alternative_matches:resolved.alternatives||[],
      match_source:resolved.source, calculation_mismatch:mismatch,
      requires_manual_review:(!raw||q===null||q<=0||mismatch||conf<0.75||!resolved.matched)
    };
  });
  var docConf=_mcV10NormalizeNumber_(extracted.recognition_confidence); if(docConf===null)docConf=vis.quality;
  if(vis.model===MC_V10_OCR.HANDWRITTEN)warnings.push('Использован режим распознавания рукописного текста.');
  if(vis.quality<0.68)warnings.push('Низкое качество OCR — желательно повторить фото.');
  if(review>0)warnings.push('Есть '+review+' строк(и), требующих проверки перед проведением.');
  return {
    document_type:type, document_number:extracted.document_number||null,
    document_date:_mcV10NormalizeDate_(extracted.document_date), supplier:supplier||null,
    buyer:extracted.buyer||null, total:extracted.total!==null&&extracted.total!==undefined?_mcV10NormalizeNumber_(extracted.total):(total||null),
    recognition_confidence:Math.round(Math.max(0,Math.min(1,docConf))*100)/100,
    items:clean,warnings:warnings,requires_manual_review:review>0||warnings.length>0,
    _debug:{model:vis.model,ocrQuality:vis.quality,ocrPass:vis.model===MC_V10_OCR.HANDWRITTEN?'handwritten':'page',ocrText:vis.layoutText||vis.fullText||'',ocrMarkdown:vis.markdown||'',ocrTextOriginal:vis.fullText||''}
  };
}

function scanInvoiceV11(dataUrl,typeHint) {
  try{
    var vis=_mcV10BestVision_(dataUrl,typeHint||'');
    if(vis.error)return JSON.stringify(vis);
    var ext=_mcV11ParseJsonLlm_(vis);
    if(ext.error)return JSON.stringify(ext);
    return JSON.stringify(_mcV11Finalize_(ext,vis,''));
  }catch(e){return JSON.stringify({error:'exception',body:String(e)});}
}

function scanProductReceiptV11(dataUrl){return scanInvoiceV11(dataUrl,'PRODUCT_RECEIPT');}

/** Запомнить ИМЕННО подтверждённое человеком соответствие OCR -> номенклатура. */
function rememberOcrAlias(rawName,canonicalName,supplier,documentType,captureId,token) {
  try{_requireAuth_(token,'stock');}catch(e){return JSON.stringify({error:'forbidden'});}
  try{
    rawName=String(rawName||'').trim(); canonicalName=String(canonicalName||'').trim(); supplier=String(supplier||'').trim();
    if(!rawName||!canonicalName)return JSON.stringify({error:'validation'});
    var ss=_book_(), sh=ss.getSheetByName(MC_V11_OCR.ALIAS_SHEET)||_mcV11EnsureSheets_().aliases;
    var norm=_mcV11Norm_(rawName), v=sh.getDataRange().getValues(), now=new Date(), found=-1;
    for(var i=1;i<v.length;i++){
      if(_mcV11Norm_(v[i][1])===norm && _mcV11Norm_(v[i][3])===_mcV11Norm_(supplier)){found=i+1;break;}
    }
    var who=''; try{var s=_requireAuth_(token,'stock');who=(s.fullName||s.user_id||'');}catch(e){}
    var id=found>0?String(v[found-1][0]):'OA'+Date.now();
    if(found>0){sh.getRange(found,3).setValue(canonicalName);sh.getRange(found,7).setValue(v[found-1][6]||now);sh.getRange(found,8).setValue(who);sh.getRange(found,10).setValue(true);}
    else sh.appendRow([id,rawName,canonicalName,supplier,norm,0,now,who,'',true]);
    var log=_book_().getSheetByName(MC_V11_OCR.LOG_SHEET)||_mcV11EnsureSheets_().log;
    log.appendRow(['OR'+Date.now(),rawName,rawName,canonicalName,supplier,documentType||'',captureId||'',who,now,'USER_CONFIRM']);
    return JSON.stringify({ok:true,aliasId:id,canonicalName:canonicalName});
  }catch(e){return JSON.stringify({error:String(e)});}
}

function getOcrAliasSuggestions(rawName,supplier,token) {
  try{_requireAuth_(token,'stock');}catch(e){return JSON.stringify({error:'forbidden'});}
  var a=_mcV11AliasMatch_(rawName,supplier); return JSON.stringify(a||{matched:null});
}
