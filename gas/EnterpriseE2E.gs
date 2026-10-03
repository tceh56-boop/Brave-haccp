/** Сквозной тест предприятия без внешних API. Использует mockInvoice и dryRun. */
function runEnterpriseEndToEndTest_(session){
  var mock={document:{invoice_id:'E2E-TEST-001',date:new Date().toISOString().slice(0,10),supplier_id:''},lines:[{line_no:1,name:'Тестовый продукт ЦЕХ',qty:10,unit:'кг',price:250,productionDate:new Date().toISOString().slice(0,10),expiryDate:'2099-12-31',barcode:'',article:''}]};
  var r=scanAndReceiveInvoice_({mockInvoice:mock,dryRun:true},session);
  return {test:'ENTERPRISE_E2E_INVOICE_INTAKE',status:r.status,checks:{invoice_parsed:!!r.document.invoice_id,line_count:r.lines.length,haccp_gate:r.lines.every(function(l){return l.haccp&&!l.haccp.blocked;}),price_chain:r.preview.reduce(function(s,l){return s+l.amount;},0),cascade_id:session.cascade_id||''},result:r};
}
function getEnterpriseFinalGate_(session){var h=getHaccpComplianceDashboard_(session); return {ready:h.ppk.ready&&h.open_deviations===0,haccp:h,generated_at:nowIso_()};}
