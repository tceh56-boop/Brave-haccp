/** ЦЕХ Стандарт V35 — PPK / HACCP PLAN BUILDER
 * Builds draft documents from enterprise facts. Never invents limits or normative values.
 */
var MC_V35={DOC:'ППК_V35',PROC:'Процессы_ППК_V35',HAZ:'Опасности_ХАССП_V35',CCP:'CCP_OPRP_V35',MON:'Мониторинг_ХАССП_V35',VER:'Верификация_ХАССП_V35',GAP:'Пробелы_ППК_V35'};
function _v35Sheet_(n,h){var s=_book_().getSheetByName(n);if(!s){s=_book_().insertSheet(n);s.appendRow(h);s.setFrozenRows(1);}return s;}
function _v35Init_(){
 _v35Sheet_(MC_V35.DOC,['DocumentID','Type','Name','Version','Status','DateFrom','DateTo','Responsible','ApprovedBy','ApprovedAt','SourceVersion','Hash','CreatedAt','CreatedBy']);
 _v35Sheet_(MC_V35.PROC,['ProcessID','Name','Sequence','Area','Equipment','Input','Output','Applicable','Source','Status']);
 _v35Sheet_(MC_V35.HAZ,['HazardID','ProcessID','HazardType','HazardDescription','Cause','PreventiveMeasure','Severity','Likelihood','Significant','Basis','Status']);
 _v35Sheet_(MC_V35.CCP,['ControlID','ProcessID','Type','ControlMeasure','CriticalLimit','Unit','MonitoringMethod','Frequency','ResponsibleRole','CorrectiveAction','VerificationMethod','SourceRequirement','Status']);
 _v35Sheet_(MC_V35.MON,['MonitoringID','ControlID','ObjectType','ObjectID','Parameter','LowerLimit','UpperLimit','Unit','Method','Frequency','ResponsibleRole','EvidenceType','Status']);
 _v35Sheet_(MC_V35.VER,['VerificationID','DocumentID','ControlID','Method','Frequency','Responsible','Result','EvidenceID','PerformedAt','Status','Notes']);
 _v35Sheet_(MC_V35.GAP,['GapID','DocumentID','Category','ObjectType','ObjectID','Description','Severity','Blocking','Status','CreatedAt']);
}
function _v35Rows_(n){var s=_book_().getSheetByName(n);if(!s)return[];var v=s.getDataRange().getValues();return v.length>1?v.slice(1):[];}
function setupV35Ppk(token){try{_requireAuth_(token,'journals');_v35Init_();return _ok_({initialized:true,sheets:Object.keys(MC_V35).map(function(k){return MC_V35[k];})},'V35_SETUP');}catch(e){return _failFrom_(e);}}
// Мастер-промт 4.0, этап 4: раздел заменён V65 (ППК) и V30 (ХАССП) — см. TS_PpkLegacy.gs; данные остаются для просмотра и переноса
function v35CreateDraft(json,token){return _ppkLegacyClosed_('v35CreateDraft');}
// Мастер-промт 4.0, этап 4: раздел заменён V65 (ППК) и V30 (ХАССП) — см. TS_PpkLegacy.gs; данные остаются для просмотра и переноса
function v35AddProcess(json,token){return _ppkLegacyClosed_('v35AddProcess');}
// Мастер-промт 4.0, этап 4: раздел заменён V65 (ППК) и V30 (ХАССП) — см. TS_PpkLegacy.gs; данные остаются для просмотра и переноса
function v35AddHazard(json,token){return _ppkLegacyClosed_('v35AddHazard');}
// Мастер-промт 4.0, этап 4: раздел заменён V65 (ППК) и V30 (ХАССП) — см. TS_PpkLegacy.gs; данные остаются для просмотра и переноса
function v35AddControl(json,token){return _ppkLegacyClosed_('v35AddControl');}
function v35ValidateDocument(documentId,token){try{_requireAuth_(token,'journals');_v35Init_();var docs=_v35Rows_(MC_V35.DOC).filter(function(x){return String(x[0])===String(documentId);});if(!docs.length)throw new Error('Документ не найден');var p=_v35Rows_(MC_V35.PROC).filter(function(x){return String(x[9]).toUpperCase()!=='ARCHIVED'&&String(x[7]).toUpperCase()!=='FALSE';});var h=_v35Rows_(MC_V35.HAZ);var c=_v35Rows_(MC_V35.CCP);var gaps=[];if(!p.length)gaps.push(['Нет технологических процессов','PROCESS','','','', 'Не определён ни один применимый технологический процесс','HIGH',true]);p.forEach(function(pr){var hs=h.filter(function(x){return String(x[1])===String(pr[0]);});if(!hs.length)gaps.push(['Нет анализа опасностей','HAZARD',pr[0],'','', 'Для процесса отсутствует анализ опасностей','HIGH',true]);var cs=c.filter(function(x){return String(x[1])===String(pr[0])&&String(x[12]).toUpperCase()!=='ARCHIVED';});if(!cs.length)gaps.push(['Нет контроля','CONTROL',pr[0],'','', 'Для процесса не определена мера контроля/CCP/OPRP','HIGH',true]);cs.forEach(function(x){if(!String(x[4]||'').trim())gaps.push(['Нет критического предела','CONTROL',pr[0],x[0],'', 'Критический предел не заполнен — значение нельзя придумывать автоматически','HIGH',true]);if(!String(x[6]||'').trim())gaps.push(['Нет мониторинга','CONTROL',pr[0],x[0],'', 'Не задан метод мониторинга','HIGH',true]);if(!String(x[9]||'').trim())gaps.push(['Нет корректирующего действия','CONTROL',pr[0],x[0],'', 'Не задано корректирующее действие','HIGH',true]);});});var gs=_v35Sheet_(MC_V35.GAP,['GapID','DocumentID','Category','ObjectType','ObjectID','Description','Severity','Blocking','Status','CreatedAt']);if(gaps.length){gaps.forEach(function(g){gs.appendRow(['GAP35-'+Utilities.getUuid(),documentId,g[0],g[1],g[2],g[5],g[6],g[7],'OPEN',new Date()]);});}return _ok_({documentId:documentId,valid:gaps.length===0,gapCount:gaps.length,gaps:gaps.map(function(g){return{category:g[0],objectType:g[1],objectId:g[2],description:g[5],severity:g[6],blocking:g[7]};})},'V35_VALIDATE');}catch(e){return _failFrom_(e);}}
// Мастер-промт 4.0, этап 4: раздел заменён V65 (ППК) и V30 (ХАССП) — см. TS_PpkLegacy.gs; данные остаются для просмотра и переноса
function v35Approve(documentId,token){return _ppkLegacyClosed_('v35Approve');}
function v35GetDashboard(token){try{_requireAuth_(token,'journals');_v35Init_();return _ok_({documents:_v35Rows_(MC_V35.DOC),processes:_v35Rows_(MC_V35.PROC),hazards:_v35Rows_(MC_V35.HAZ),controls:_v35Rows_(MC_V35.CCP),gaps:_v35Rows_(MC_V35.GAP).filter(function(x){return String(x[8]).toUpperCase()==='OPEN';})},'V35_DASH');}catch(e){return _failFrom_(e);}}

/* Этап 10.8: реквизиты организации — часть ППК. Шапка журналов («ООО «…»») берётся из утверждённого ППК
   (ответ 7: «шапка организации заполняется после утверждения ППК»). До утверждения в бланке — прочерк. */
function v35SetOrganization(json,token){var op=null;try{op=_beginOp_(token,'haccp','V35_ORG','PPK organization',null,null);}catch(e){return _failFrom_(e);}
  try{var d=typeof json==='string'?JSON.parse(json||'{}'):(json||{});var name=String(d.name||'').trim();
    if(!d.documentId){_endOp_(op,'FAILED');return _fail_('VALIDATION','Укажите документ ППК',op.id);}
    if(!name){_endOp_(op,'FAILED');return _fail_('VALIDATION','Укажите полное наименование организации (например, ООО «Ромашка»)',op.id);}
    if(d.inn&&!/^\d{10}(\d{2})?$/.test(String(d.inn).trim())){_endOp_(op,'FAILED');return _fail_('VALIDATION','ИНН — 10 или 12 цифр',op.id);}
    _v35Init_();if(!_v35Rows_(MC_V35.DOC).some(function(x){return String(x[0])===String(d.documentId);})){_endOp_(op,'FAILED');return _fail_('NOT_FOUND','Документ ППК не найден',op.id);}
    var org={name:name,inn:String(d.inn||'').trim(),address:String(d.address||'').trim()};
    PropertiesService.getScriptProperties().setProperty('MC_PPK_ORG_'+d.documentId,JSON.stringify(org));
    var active=_v35Rows_(MC_V35.DOC).some(function(x){return String(x[0])===String(d.documentId)&&String(x[4])==='ACTIVE';});
    if(active)_v35ApplyOrganization_(d.documentId);
    _audit_(op,'V35_ORG','COMPLIANCE_DOCUMENT',d.documentId,null,org);_endOp_(op);
    return _ok_({documentId:d.documentId,organization:org,inHeader:active},op.id);
  }catch(e){_endOp_(op,'FAILED');return _failFrom_(e,op&&op.id);}}
function _v35ApplyOrganization_(documentId){
  var p=PropertiesService.getScriptProperties(),o=null;
  if(p.getProperty('MC_ORG_SETTINGS')){p.setProperty('MC_ORG_PPK',String(documentId));return true;}   // реквизиты ведутся в «Настройки → Организация» (ТЗ §9) — ППК их не переписываетtry{o=JSON.parse(p.getProperty('MC_PPK_ORG_'+documentId)||'null');}catch(e){}
  if(!o||!o.name)return false;
  p.setProperty('MC_ORG_NAME',o.name);p.setProperty('ORG_NAME',o.name);p.setProperty('MC_ORG_INN',o.inn||'');p.setProperty('MC_ORG_ADDRESS',o.address||'');p.setProperty('MC_ORG_PPK',String(documentId));
  return true;
}
