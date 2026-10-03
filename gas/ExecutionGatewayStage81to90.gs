/** ЦЕХ CORE100 — Stage 81-90 Execution Gateway.
 * Approval -> preflight -> controlled execution -> outcome -> reconciliation.
 * Прямые хозяйственные мутации разрешены только через явный execute request и существующие серверные handlers.
 */
var STAGE81_90_LIMIT_=500;
function _eg90Scope_(r,s){return !!r&&String(r.organization_id||'')===String(s.organization_id||'')&&(!s.location_id||!r.location_id||String(r.location_id)===String(s.location_id));}
function _eg90Loc_(d,s){var l=String((d&&d.locationId)||s.location_id||'');if(l)assertLocationAllowed_(s,l,'EXECUTION_GATEWAY');return l;}
function _eg90Rows_(sh,pred){return (findRows_(sh,pred)||[]).slice(0,STAGE81_90_LIMIT_);}
function _eg90Hash_(v){var b=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(v||''));return b.map(function(x){return ('0'+(x<0?x+256:x).toString(16)).slice(-2);}).join('');}
function _eg90Proposal_(id,s){var r=_eg90Rows_('PLANNING_PROPOSALS',function(x){return _eg90Scope_(x,s)&&x.proposal_id===id;});if(!r.length)throw new Error('Proposal не найден.');return r[0];}
function _eg90Gate_(id,s){var r=_eg90Rows_('APPROVAL_GATES',function(x){return _eg90Scope_(x,s)&&x.approval_gate_id===id;});if(!r.length)throw new Error('Approval gate не найден.');return r[0];}
function _eg90NowMs_(){return Date.now();}
function _eg90Nonce_(){return Utilities.getUuid().replace(/-/g,'');}
function _eg90ProposalFingerprint_(p,g,s){return _eg90Hash_([p.proposal_id,p.status,p.type,p.entity_type,p.entity_id,p.qty,p.approval_gate_id,g.approval_gate_id,g.status,g.proposal_hash,s.organization_id,s.location_id||''].join('|'));}
function _eg90Context_(d,s){var c={};Object.keys(s||{}).forEach(function(k){c[k]=s[k];});c.location_id=_eg90Loc_(d||{},s);return c;}
function _eg90QualityGateServer_(p,s){
  var q=getExecutionQualityGate87_({locationId:s.location_id,proposalId:p.proposal_id},s);
  var openQuarantine=(typeof findRows_==='function'?findRows_('QUARANTINE_CASES',function(r){return _eg90Scope_(r,{organization_id:s.organization_id,location_id:s.location_id})&&['OPEN','ACTIVE','BLOCKED'].indexOf(String(r.status||'').toUpperCase())!==-1;}):[])||[];
  return {status:q.status==='GREEN'&&openQuarantine.length===0?'GREEN':'BLOCKED',critical_incidents:q.open_critical_incidents||0,open_quarantine:openQuarantine.length};
}
function _eg90HaccpGateServer_(p,s){
  var h=typeof getHaccpComplianceDashboard_==='function'?getHaccpComplianceDashboard_(s):null;
  var ready=!!(h&&h.ppk&&h.ppk.ready===true)&&Number(h.open_deviations||0)===0;
  return {status:ready?'GREEN':'BLOCKED',dashboard:h||{available:false}};
}
function _eg90AuthoritativeFinancialPreview_(p,s){
  var qty=Math.max(0,Number(p.qty||0));
  var unitCost=0,unitRevenue=0,source='';
  if(p.type==='PROCUREMENT'){
    var product=getProductById_(String(p.entity_id||''));
    if(!product||String(product.organization_id)!==String(s.organization_id)) return {status:'BLOCKED',reason:'PRODUCT_NOT_FOUND_OR_OUTSIDE_ORG'};
    unitCost=Number(product.текущая_цена||product.закупочная_цена||0); source='PRODUCTS.current_purchase_price';
  }else if(p.type==='PRODUCTION'){
    var dish=findOne_('DISHES','dish_id',String(p.entity_id||''));
    if(!dish||String(dish.organization_id)!==String(s.organization_id)) return {status:'BLOCKED',reason:'DISH_NOT_FOUND_OR_OUTSIDE_ORG'};
    unitCost=Number(dish.себестоимость||0); unitRevenue=Number(dish.цена_продажи||0); source='DISHES.cost_and_sale_price';
  }else if(p.type==='LABOR'){
    unitCost=0; source='LABOR_PROPOSAL_NO_SERVER_RATE';
  }else return {status:'BLOCKED',reason:'UNSUPPORTED_PROPOSAL_TYPE'};
  var estimatedCost=round2_(qty*unitCost),estimatedRevenue=round2_(qty*unitRevenue),margin=round2_(estimatedRevenue-estimatedCost);
  var ok=qty>0&&unitCost>=0&&(p.type!=='PRODUCTION'||unitRevenue>=0);
  return {status:ok?'GREEN':'BLOCKED',proposal_id:p.proposal_id,quantity:qty,unit_cost:round2_(unitCost),unit_revenue:round2_(unitRevenue),estimated_cost:estimatedCost,estimated_revenue:estimatedRevenue,estimated_margin:margin,source:source,calculated_at:nowIso_()};
}
function _eg90EvidenceHash_(pf){return _eg90Hash_({status:pf.status,checks:pf.checks,proposal_fingerprint:pf.proposal_fingerprint,authoritative:pf.authoritative,nonce_expires_at:pf.nonce_expires_at});}
function _eg90Preflight_(p,g,d,s,opts){
  d=d||{};opts=opts||{};
  var quality=_eg90QualityGateServer_(p,s),haccp=_eg90HaccpGateServer_(p,s),finance=_eg90AuthoritativeFinancialPreview_(p,s);
  var checks=[{code:'APPROVAL',ok:g.status==='APPROVED'},{code:'PROPOSAL_STATUS',ok:p.status==='APPROVED'},
    {code:'QUALITY_GATE',ok:quality.status==='GREEN',details:quality},
    {code:'HACCP_GATE',ok:haccp.status==='GREEN',details:haccp},
    {code:'FINANCIAL_PREVIEW',ok:finance.status==='GREEN',details:finance}];
  var status=checks.every(function(x){return x.ok;})?'READY':'BLOCKED';
  var fingerprint=_eg90ProposalFingerprint_(p,g,s);
  return {status:status,checks:checks,proposal_fingerprint:fingerprint,server_calculated_at:nowIso_(),nonce_expires_at:opts.nonceExpiresAt||'',authoritative:true};
}
function _eg90BuildExecutionAdapter_(p){
  var action='',payload={};
  if(p.type==='PROCUREMENT'){action='CREATE_PURCHASE_REQUEST';payload={productId:p.entity_id,qty:p.qty};}
  else if(p.type==='PRODUCTION'){action='CREATE_PRODUCTION_TASK';payload={parentType:'DISH',parentId:p.entity_id,qty:p.qty};}
  else if(p.type==='LABOR'){action='CREATE_SHIFT_ASSIGNMENT';payload={plannedHours:p.qty};}
  else throw new Error('Тип предложения не имеет безопасного execution adapter: '+p.type);
  return {action:action,payload:payload};
}
function createExecutionGateway81_(d,s){
  d=d||{};var ctx=_eg90Context_(d,s),p=_eg90Proposal_(String(d.proposalId||''),ctx),g=_eg90Gate_(String(p.approval_gate_id||''),ctx);
  var expires=new Date(_eg90NowMs_()+5*60*1000).toISOString(),pf=_eg90Preflight_(p,g,null,ctx,{nonceExpiresAt:expires});
  var r={execution_request_id:generateId_('EXECUTION_REQUESTS'),proposal_id:p.proposal_id,approval_gate_id:g.approval_gate_id,organization_id:s.organization_id,location_id:ctx.location_id,status:pf.status,preflight_json:JSON.stringify(pf),preflight_hash:_eg90EvidenceHash_(pf),execution_nonce:pf.status==='READY'?_eg90Nonce_():'',nonce_expires_at:pf.status==='READY'?expires:'',request_fingerprint:pf.proposal_fingerprint,requested_by:s.user_id,requested_at:nowIso_(),executed_by:'',executed_at:'',reference_type:'',reference_id:'',error_message:''};
  insertRow_('EXECUTION_REQUESTS',r);return r;
}
function getExecutionGatewayRequests82_(d,s){d=d||{};var l=_eg90Loc_(d,s);return _eg90Rows_('EXECUTION_REQUESTS',function(r){return _eg90Scope_(r,{organization_id:s.organization_id,location_id:l})&&(!d.status||r.status===d.status);});}
function runExecutionPreflight83_(d,s){
  d=d||{};var ctx=_eg90Context_(d,s),reqId=String(d.executionRequestId||'');
  if(reqId){var reqs=getExecutionGatewayRequests82_({locationId:ctx.location_id},s).filter(function(r){return r.execution_request_id===reqId;});if(!reqs.length)throw new Error('Execution request не найден.');var rr=reqs[0],pp=_eg90Proposal_(rr.proposal_id,ctx),gg=_eg90Gate_(rr.approval_gate_id,ctx);return _eg90Preflight_(pp,gg,null,ctx,{nonceExpiresAt:rr.nonce_expires_at});}
  var p=_eg90Proposal_(String(d.proposalId||''),ctx),g=_eg90Gate_(String(p.approval_gate_id||''),ctx);return _eg90Preflight_(p,g,null,ctx);
}
function executeApprovedProposal84_(d,s){
  d=d||{};var ctx=_eg90Context_(d,s),reqs=getExecutionGatewayRequests82_({locationId:ctx.location_id},s).filter(function(r){return r.execution_request_id===String(d.executionRequestId||'');});
  if(!reqs.length)throw new Error('Execution request не найден.');var r=reqs[0];if(r.status!=='READY')throw new Error('Execution request не READY.');
  if(String(r.requested_by||'')!==String(s.user_id||''))throw new Error('Execution request привязан к другому пользователю. Создайте новый request от текущей сессии.');
  if(!r.execution_nonce||!r.nonce_expires_at||_eg90NowMs_>new Date(r.nonce_expires_at).getTime())throw new Error('Execution nonce истёк. Запустите preflight заново.');
  var p=_eg90Proposal_(r.proposal_id,ctx),g=_eg90Gate_(r.approval_gate_id,ctx),pf=_eg90Preflight_(p,g,null,ctx,{nonceExpiresAt:r.nonce_expires_at});
  if(pf.status!=='READY'||pf.proposal_fingerprint!==r.request_fingerprint)throw new Error('Server preflight не пройден или proposal изменён после approval.');
  if(_eg90EvidenceHash_(pf)!==String(r.preflight_hash||''))throw new Error('Preflight evidence устарел. Создайте новый execution request.');
  var adapter=_eg90BuildExecutionAdapter_(p),action=adapter.action,payload=adapter.payload;
  if(!ACTION_HANDLERS[action])throw new Error('Execution adapter не зарегистрирован: '+action);
  if(!userCanAccessAction_(getUserById_(s.user_id),action,CONFIG.ACTION_MODULE[action]))throw new Error('Недостаточно прав для execution adapter.');
  payload._executionContext={requestId:r.execution_request_id,proposalId:p.proposal_id,nonce:r.execution_nonce,actorUserId:s.user_id};
  var result=processOperation(action,payload,s.token);
  if(!result||result.ok===false)throw new Error((result&&result.error)||'Execution adapter отклонён.');
  r.status='EXECUTED';r.executed_by=s.user_id;r.executed_at=nowIso_();r.reference_type=action;r.reference_id=String((result&&((result.id)||(result.request_id)||(result.task_id)||(result.plan_id)))||'');r.execution_nonce='';r.nonce_expires_at='';updateRow_('EXECUTION_REQUESTS',r);return {request:r,result:result};
}
function getExecutionOutcome85_(d,s){d=d||{};var l=_eg90Loc_(d,s);return _eg90Rows_('EXECUTION_OUTCOMES',function(r){return _eg90Scope_(r,{organization_id:s.organization_id,location_id:l})&&(!d.proposalId||r.proposal_id===d.proposalId);});}
function runExecutionReconciliation86_(d,s){d=d||{};var l=_eg90Loc_(d,s),outs=getExecutionOutcome85_({locationId:l,proposalId:d.proposalId},s),findings=[];outs.forEach(function(o){if(Number(o.actual_qty||0)<0)findings.push({code:'NEGATIVE_OUTCOME',severity:'CRITICAL',outcome_id:o.outcome_id});});return {status:findings.length?'BLOCKED':'GREEN',checked:outs.length,findings:findings};}
function getExecutionQualityGate87_(d,s){d=d||{};var l=_eg90Loc_(d,s),inc=(typeof findRows_==='function'?findRows_('CRITICAL_INCIDENTS',function(r){return _eg90Scope_(r,{organization_id:s.organization_id,location_id:l})&&String(r.status||'')==='OPEN';}):[])||[];return {status:inc.length?'BLOCKED':'GREEN',open_critical_incidents:inc.length};}
function getExecutionFinancialPreview88_(d,s){d=d||{};var p=_eg90Proposal_(String(d.proposalId||''),s);return _eg90AuthoritativeFinancialPreview_(p,s);}
function getExecutionAlerts89_(d,s){var l=_eg90Loc_(d,s),r=getExecutionGatewayRequests82_({locationId:l,status:'READY'},s);return r.map(function(x){return {execution_request_id:x.execution_request_id,proposal_id:x.proposal_id,severity:'HIGH',code:'READY_FOR_EXECUTION'};});}
function getAutonomousOperationsCommandCenter90_(d,s){d=d||{};var l=_eg90Loc_(d,s),a=getExecutionAlerts89_({locationId:l},s),q=getExecutionQualityGate87_({locationId:l},s);return {status:q.status==='BLOCKED'?'BLOCKED':(a.length?'ATTENTION':'GREEN'),generated_at:nowIso_(),location_id:l,ready_requests:a.slice(0,100),quality_gate:q,approval_required:true};}
function autonomousOperationsStage81to90Trigger_(){try{getOrganizations_(null).forEach(function(org){(getLocations_(org.organization_id)||[]).forEach(function(loc){var s={user_id:'system',organization_id:org.organization_id,location_id:loc.location_id,role:'ADMIN',allowed_locations:[loc.location_id]};var cc=getAutonomousOperationsCommandCenter90_({locationId:loc.location_id},s);if(cc.status!=='GREEN')notify_(org.organization_id,loc.location_id,'EXECUTION_GATEWAY','Execution Gateway: '+cc.status,'eg8190|'+loc.location_id);});});}catch(e){logSystemError_('autonomousOperationsStage81to90Trigger_',null,'execution_gateway_81_90',e);}}
function executionGatewayStage81to90Tests_(){return [{name:'CREATE_REQUEST',status:typeof createExecutionGateway81_==='function'?'OK':'FAIL'},{name:'PREFLIGHT',status:typeof runExecutionPreflight83_==='function'?'OK':'FAIL'},{name:'EXECUTE',status:typeof executeApprovedProposal84_==='function'?'OK':'FAIL'},{name:'QUALITY',status:typeof getExecutionQualityGate87_==='function'?'OK':'FAIL'},{name:'FINANCIAL_PREVIEW',status:typeof getExecutionFinancialPreview88_==='function'?'OK':'FAIL'},{name:'COMMAND',status:typeof getAutonomousOperationsCommandCenter90_==='function'?'OK':'FAIL'}];}
