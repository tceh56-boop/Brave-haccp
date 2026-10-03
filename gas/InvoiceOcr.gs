/** OCR накладной. Формат результата нормализован и пригоден для сквозной приёмки. */
var YANDEX_INVOICE_OCR_ENDPOINT = 'https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText';
function runSupplierInvoiceOcr_(base64Image, mimeType, session) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('YANDEX_OCR_API_KEY');
  var folderId = props.getProperty('YANDEX_FOLDER_ID');
  if (!apiKey || !folderId) throw new Error('Распознавание накладной не настроено: задайте YANDEX_OCR_API_KEY и YANDEX_FOLDER_ID.');
  var content = String(base64Image || '').replace(/^data:[^;]+;base64,/,'');
  var response = UrlFetchApp.fetch(YANDEX_INVOICE_OCR_ENDPOINT, {method:'post',contentType:'application/json',headers:{Authorization:'Api-Key '+apiKey,'x-folder-id':folderId},payload:JSON.stringify({mimeType:mimeType,languageCodes:['ru','en'],model:'page',content:content}),muteHttpExceptions:true});
  var code=response.getResponseCode();
  if(code<200||code>=300) throw new Error('Ошибка OCR накладной (код '+code+'): '+response.getContentText().slice(0,500));
  var body=JSON.parse(response.getContentText());
  var text=extractOcrPlainText_(body);
  return parseSupplierInvoiceText_(text, session);
}
function extractOcrPlainText_(body) {
  var a=[]; (function walk(n){ if(!n)return; if(typeof n==='string'){a.push(n);return;} if(Array.isArray(n)){n.forEach(walk);return;} if(typeof n==='object'){if(typeof n.text==='string')a.push(n.text); Object.keys(n).forEach(function(k){if(k!=='text')walk(n[k]);});}})(body); return a.join('\n');
}
function parseSupplierInvoiceText_(text, session) {
  var lines=String(text||'').split(/\r?\n/).map(function(x){return x.trim();}).filter(Boolean), out={document:{invoice_id:'',supplier_id:'',date:'',raw_text:text},lines:[]};
  var inv=String(text).match(/(?:накладн(?:ая|ой)|УПД|счет[- ]?фактур[аы]).{0,50}?(?:№|N)\s*([A-ZА-ЯЁ0-9\-/]+)/i); if(inv)out.document.invoice_id=inv[1];
  var date=String(text).match(/(?:от|дата)\s*(\d{2}[.\-/]\d{2}[.\-/]\d{4})/i); if(date)out.document.date=normalizeDateSimple_(date[1]);
  lines.forEach(function(s){
    var m=s.match(/^\s*(?:\d+[.)]?\s+)?(.+?)\s+(\d+(?:[.,]\d+)?)\s*(кг|г|шт|л|уп|упак\.?)?\s+(\d+(?:[.,]\d+)?)\s*$/i);
    if(!m)return;
    var qty=Number(String(m[2]).replace(',','.')); var price=Number(String(m[4]).replace(',','.')); if(!isFinite(qty)||!isFinite(price))return;
    out.lines.push({name:m[1].trim(),qty:qty,unit:m[3]||'',price:price,barcode:'',article:'',productionDate:'',expiryDate:''});
  });
  return out;
}
function normalizeDateSimple_(s){var p=String(s).replace(/-/g,'.').replace(/\//g,'.').split('.'); return p.length===3?p[2]+'-'+('0'+p[1]).slice(-2)+'-'+('0'+p[0]).slice(-2):s;}
