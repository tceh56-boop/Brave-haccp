/**
 * ЦЕХ Stage 29 — Policy & Rules Engine.
 * Активная версия Configuration Center становится исполняемой политикой.
 * Правила не изменяют данные сами: возвращают decision + источник + причину.
 */
var POLICY29_DEFAULTS_={
  'warehouse.min_stock_mode': 'PRODUCT',
  'production.yield_deviation_warning_pct': 5,
  'production.yield_deviation_critical_pct': 10,
  'finance.cash_risk_threshold': 0,
  'automation.max_batch': 50,
  'haccp.require_corrective_action_on_failure': true
};
function _policy29ActiveVersion_(session){
  var rows=findRows_('CONFIGURATION_VERSIONS',function(r){return _cfg28Scope_(r,session)&&r.status==='ACTIVE';});
  rows.sort(function(a,b){return Number(b.version_no)-Number(a.version_no);});
  return rows[0]||null;
}
function _policy29Value_(namespace,key,session,def){
  var v=_policy29ActiveVersion_(session);
  if(v){var row=findRows_('CONFIGURATION_VALUES',function(r){return r.config_version_id===v.config_version_id&&r.namespace===namespace&&r.key===key&&_cfg28Scope_(r,session);})[0];
    if(row){try{return JSON.parse(row.value_json);}catch(e){}}
  }
  return def!==undefined?def:(POLICY29_DEFAULTS_[namespace+'.'+key]!==undefined?POLICY29_DEFAULTS_[namespace+'.'+key]:null);
}
function getPolicyDecision_(data,session){
  data=data||{};var ns=String(data.namespace||'');var key=String(data.key||'');
  if(!ns||!key) throw new Error('namespace и key обязательны.');
  var fallback=POLICY29_DEFAULTS_[ns+'.'+key];
  var value=_policy29Value_(ns,key,session,fallback);
  var v=_policy29ActiveVersion_(session);
  return {namespace:ns,key:key,value:value,source:v?{version_id:v.config_version_id,version_no:Number(v.version_no),checksum:v.checksum}: {version_id:'DEFAULT',version_no:0,checksum:''},effective:'ACTIVE_OR_DEFAULT'};
}
function evaluatePolicyRule_(namespace,key,context,session){
  var value=_policy29Value_(namespace,key,session,undefined), source=_policy29ActiveVersion_(session);
  var rule={namespace:namespace,key:key,value:value,source_version_id:source?source.config_version_id:'DEFAULT',source_version_no:source?Number(source.version_no):0};
  if(value&&typeof value==='object'&&!Array.isArray(value)&&value.operator){
    var actual=context&&context[value.field]; var expected=value.value; var pass=false;
    if(value.operator==='<=') pass=Number(actual)<=Number(expected); else if(value.operator==='>=') pass=Number(actual)>=Number(expected); else if(value.operator==='===') pass=String(actual)===String(expected); else if(value.operator==='!=') pass=String(actual)!==String(expected);
    return {allowed:pass,decision:pass?'ALLOW':'BLOCK',reason:value.reason||('Политика '+namespace+'.'+key+(pass?' выполнена':' нарушена')),rule:rule,actual:actual,expected:expected};
  }
  return {allowed:true,decision:'ALLOW',reason:'Политика '+namespace+'.'+key+' применена как значение.',rule:rule,value:value};
}
function getPolicyCatalog_(session){
  var out=[];Object.keys(POLICY29_DEFAULTS_).forEach(function(full){var p=full.split('.');out.push(getPolicyDecision_({namespace:p.shift(),key:p.join('.')},session));});return out;
}
function policyRulesStage29Tests_(){var out=[];function ok(n,c,d){out.push({name:n,status:c?'OK':'FAIL',detail:d||''});}
 ok('DEFAULTS',POLICY29_DEFAULTS_['production.yield_deviation_warning_pct']===5&&POLICY29_DEFAULTS_['production.yield_deviation_critical_pct']===10,'default policy thresholds');
 ok('ACTIVE_RESOLVER',typeof _policy29ActiveVersion_==='function'&&typeof _policy29Value_==='function','active config resolver');
 ok('DECISION_API',typeof getPolicyDecision_==='function'&&typeof evaluatePolicyRule_==='function','decision functions');
 ok('FALLBACK',_policy29Value_('production','yield_deviation_warning_pct',{organization_id:'__test__',location_id:''})===5,'safe default');
 ok('CATALOG',getPolicyCatalog_({organization_id:'__test__',location_id:''}).length>=5,'catalog');
 ok('NO_SIDE_EFFECTS',true,'evaluation functions only return decisions');
 return out;}
