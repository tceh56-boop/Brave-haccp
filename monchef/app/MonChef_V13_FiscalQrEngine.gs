/* ============================================================================
 * MON CHEF V13 — FISCAL QR + OCR CROSS-CHECK
 *
 * QR is treated as an additional evidence source, never as a replacement for
 * the photographed document. The client may decode the QR with BarcodeDetector
 * and sends only the parsed payload to Apps Script. The server validates the
 * fiscal fields against OCR and keeps an immutable evidence record.
 * ========================================================================== */

var MC_V13_QR = {
  SHEET: 'OCR_FISCAL_QR',
  HEADERS: ['EvidenceID','CaptureID','DocumentType','QRRaw','FiscalDateTime','Total','FN','FD','FP','Operation','Seller','MatchStatus','Warnings','CreatedAt','CreatedBy'],
  TOLERANCE: 0.02
};

function _mcV13EnsureQrSheet_(){
  var ss=_book_(), sh=ss.getSheetByName(MC_V13_QR.SHEET)||ss.insertSheet(MC_V13_QR.SHEET);
  if(sh.getLastRow()===0)sh.appendRow(MC_V13_QR.HEADERS);
  return sh;
}

function _mcV13ParseQr_(raw){
  raw=String(raw||'').trim();
  var q=raw;
  var qm=q.indexOf('?'); if(qm>=0) q=q.slice(qm+1);
  q=q.replace(/^\?/, '');
  var out={raw:raw};
  q.split('&').forEach(function(pair){
    var p=pair.indexOf('='); if(p<0)return;
    var k=decodeURIComponent(pair.slice(0,p)).toLowerCase();
    var v=decodeURIComponent(pair.slice(p+1).replace(/\+/g,' '));
    if(k)out[k]=v;
  });
  if(out.s)out.total=_mcV10NormalizeNumber_(out.s);
  if(out.t){
    var t=String(out.t).replace(/[^0-9]/g,'');
    if(/^\d{12}$/.test(t)) out.datetime=t.slice(0,4)+'-'+t.slice(4,6)+'-'+t.slice(6,8)+'T'+t.slice(8,10)+':'+t.slice(10,12);
  }
  out.fn=out.fn||null; out.fd=out.i||out.fd||null; out.fp=out.fp||null;
  out.operation=out.n||null;
  out.validShape=!!(out.t&&out.s&&out.fn&&(out.i||out.fd)&&out.fp);
  return out;
}

function _mcV13CompareQrOcr_(qr,doc){
  var warnings=[], score=0, checks=0;
  if(!qr)return {status:'NO_QR',score:0,warnings:[]};
  if(qr.total!==null&&qr.total!==undefined&&doc.total!==null&&doc.total!==undefined){
    checks++; if(Math.abs(Number(qr.total)-Number(doc.total))<=Math.max(0.01,Math.abs(Number(qr.total))*MC_V13_QR.TOLERANCE)){score++;}else warnings.push('Сумма QR не совпадает с OCR.');
  }
  if(qr.datetime&&doc.document_date){checks++; if(String(qr.datetime).slice(0,10)===String(doc.document_date)){score++;}else warnings.push('Дата QR не совпадает с датой OCR.');}
  if(qr.fn){checks++; if(String(doc._debug&&doc._debug.ocrText||'').indexOf(String(qr.fn))>=0)score++; else warnings.push('ФН из QR не найден в OCR-тексте.');}
  if(qr.fd){checks++; if(String(doc._debug&&doc._debug.ocrText||'').indexOf(String(qr.fd))>=0)score++; else warnings.push('ФД из QR не найден в OCR-тексте.');}
  var status=checks===0?'QR_PRESENT_NO_COMPARISON':(score===checks?'QR_MATCH':(score>0?'QR_PARTIAL':'QR_CONFLICT'));
  return {status:status,score:checks?Math.round(score/checks*100)/100:0,warnings:warnings,checks:checks};
}

function _mcV13RememberQr_(qr,doc,captureId,token){
  try{
    var sh=_mcV13EnsureQrSheet_(), auth=null; try{auth=_requireAuth_(token,'stock');}catch(e){}
    var who=auth&&auth.fullName||'';
    var cmp=_mcV13CompareQrOcr_(qr,doc);
    sh.appendRow([
      'QR'+Date.now(),captureId||'',doc.document_type||'',qr.raw||'',qr.datetime||'',qr.total||'',qr.fn||'',qr.fd||'',qr.fp||'',qr.operation||'',doc.supplier||'',cmp.status,cmp.warnings.join(' | '),new Date(),who
    ]);
    return cmp;
  }catch(e){return {status:'QR_LOG_ERROR',score:0,warnings:[String(e)]};}
}

function _mcV13FiscalKey_(qr){
  if(!qr)return '';
  return [qr.fn||'',qr.fd||'',qr.fp||''].join('|');
}

function scanInvoiceV13(dataUrl,typeHint,captureId,qrJson){
  try{
    var base=JSON.parse(scanInvoiceV12(dataUrl,typeHint||'',captureId||''));
    if(base.error)return JSON.stringify(base);
    var qr=null;
    if(qrJson){try{qr=typeof qrJson==='string'?JSON.parse(qrJson):qrJson;}catch(e){}}
    if(qr&&qr.raw){qr=_mcV13ParseQr_(qr.raw);}
    var cmp=_mcV13RememberQr_(qr,base,captureId||'',null);
    base.fiscalQr=qr?{present:true,status:cmp.status,score:cmp.score,warnings:cmp.warnings,fiscalDateTime:qr.datetime||null,total:qr.total===undefined?null:qr.total,fn:qr.fn||null,fd:qr.fd||null,fp:qr.fp||null,operation:qr.operation||null}: {present:false,status:'NO_QR',score:0,warnings:[]};
    base.warnings=(base.warnings||[]).concat(cmp.warnings||[]);
    base.requires_manual_review=!!base.requires_manual_review || cmp.status==='QR_CONFLICT';
    if(cmp.status==='QR_MATCH' && base.autopilot) base.autopilot.autoAccept=!!base.autopilot.autoAccept;
    return JSON.stringify(base);
  }catch(e){return JSON.stringify({error:'v13',body:String(e)});}
}

function previewReceiveFromInvoiceV13(orderId,dataUrl,qrJson){
  try{
    var inv=JSON.parse(scanInvoiceV13(dataUrl,'', 'RCV'+Date.now(), qrJson));
    if(inv.error)return JSON.stringify(inv);
    var order=JSON.parse(getSupplierOrderById(orderId));
    if(order.error)return JSON.stringify({error:'order-not-found'});
    var matched=[],unmatched=[];
    (inv.items||[]).forEach(function(it){
      var best=null,bestScore=0;
      (order.items||[]).forEach(function(ord){var s=_nameMatchScore_(it.raw_name||it.name,ord.name);if(s>bestScore){bestScore=s;best=ord;}});
      if(best&&bestScore>0.3)matched.push({name:best.name,orderedQty:best.qty,orderedUnit:best.unit,receivedQty:it.quantity!==undefined?it.quantity:it.qty,receivedUnit:it.unit||best.unit,price:it.price||best.price,sum:it.sum,expiry:'',matchScore:bestScore,confidence:it.confidence});
      else unmatched.push({name:it.raw_name||it.name,qty:it.quantity!==undefined?it.quantity:it.qty,unit:it.unit,price:it.price,sum:it.sum,confidence:it.confidence});
    });
    return JSON.stringify({matched:matched,unmatched:unmatched,supplier:inv.supplier,date:inv.document_date,number:inv.document_number,fiscalQr:inv.fiscalQr,warnings:inv.warnings||[],_debug:inv._debug});
  }catch(e){return JSON.stringify({error:'preview-v13',body:String(e)});}
}

function getFiscalQrStats(token){
  try{_requireAuth_(token,'stock');}catch(e){return JSON.stringify({error:'forbidden'});}
  try{var sh=_book_().getSheetByName(MC_V13_QR.SHEET);if(!sh)return JSON.stringify({total:0,matched:0,conflicts:0});var v=sh.getDataRange().getValues(),out={total:0,matched:0,conflicts:0,partial:0};for(var i=1;i<v.length;i++){out.total++;var s=String(v[i][11]||'');if(s==='QR_MATCH')out.matched++;else if(s==='QR_CONFLICT')out.conflicts++;else if(s==='QR_PARTIAL')out.partial++;}return JSON.stringify(out);}catch(e){return JSON.stringify({error:String(e)});}
}
