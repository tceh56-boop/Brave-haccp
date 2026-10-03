/** Ядро ХАССП/ППК: нормативная связь, контроль при приёмке, отклонения и готовность. */
var HACCP_CONTROL_TYPES=['PRP','ППОПМ','КТ','ККТ'];
function getPpkReceiptControls_(organizationId, locationId, productId){
  var current=typeof getCurrentPpk_==='function'?getCurrentPpk_(organizationId):null;
  if(!current)return [];
  var controls=findRows_('PPK_CONTROLS',function(c){return c.ppk_id===current.ppk_id&&c.organization_id===organizationId&&(!c.location_id||c.location_id===locationId)&&(!c.product_id||c.product_id===productId)&&c.status!=='ARCHIVED';});
  return controls.map(function(c){
    var limit=c.critical_limit_ref?findOne_('PPK_CRITICAL_LIMITS','limit_id',c.critical_limit_ref):null;
    return {control_id:c.control_id,point_type:c.point_type,name:c.control_name,blocked:false,warning:false,reason:'',limit:limit||null};
  });
}
function getPpkReadiness_(organizationId, locationId){
  var current=typeof getCurrentPpk_==='function'?getCurrentPpk_(organizationId):null;
  if(!current)return {ready:false,score:0,missing:['Действующая версия ППК']};
  var missing=[];
  ['PPK_PROCESSES','PPK_FLOW_STAGES','HAZARD_ANALYSIS','PPK_CONTROLS','PPK_VERIFICATION'].forEach(function(t){if(findRows_(t,function(r){return r.ppk_id===current.ppk_id;}).length===0)missing.push(t);});
  return {ready:missing.length===0,score:missing.length?Math.max(0,100-missing.length*20):100,missing:missing,ppk_id:current.ppk_id,version:current.version};
}
function createHaccpDeviation_(data,session){
  var row={deviation_id:generateId_('JOURNAL_DEVIATIONS'),journal_id:data.journalId||'',definition_id:data.definitionId||'',уровень:data.level||'critical',значение:data.value||'',предел_нарушен:data.limitBreached||true,дата:nowIso_(),статус:'OPEN',corrective_action_id:''};
  insertRow_('JOURNAL_DEVIATIONS',row); auditLog_(session.user_id,'Зарегистрировано отклонение ХАССП','JOURNAL_DEVIATIONS:'+row.deviation_id,null,JSON.stringify(row),'success',session.cascade_id||''); return row;
}
function getHaccpComplianceDashboard_(session){return {ppk:getPpkReadiness_(session.organization_id,session.location_id),open_deviations:findRows_('JOURNAL_DEVIATIONS',function(d){return d.статус==='OPEN';}).length,generated_at:nowIso_()};}
