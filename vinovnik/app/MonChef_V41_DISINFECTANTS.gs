/** Mon Chef V41 — Disinfectants / sanitation master.
 * Reference data only until product-specific docs are reviewed.
 */
const V41_DS = {
  MASTER:'Дезсредства_V41',
  REGIME:'Дезсредства_Режимы_V41',
  SOL:'Дезсредства_Растворы_V41',
  TASK:'Дезсредства_Задачи_V41',
  GAP:'Дезсредства_Пробелы_V41',
  FACT:'Дезсредства_Факты_V41'
};
const V41_HEADERS = {
  MASTER:['DisinfectantID','Manufacturer','ProductName','ObjectScope','AllowedForCatering','RegistrationStatus','InstructionFileID','InstructionVersion','ActiveSubstance','Form','SourceStatus','ApprovalStatus','Notes','CreatedAt','UpdatedAt'],
  REGIME:['RegimeID','DisinfectantID','ConcentrationRaw','ExposureRaw','Method','ConsumptionRaw','SolutionShelfLifeRaw','ObjectScope','RinseRequired','SourceFileID','SourceStatus','ApprovalStatus','Notes','CreatedAt'],
  SOL:['SolutionID','DisinfectantID','ProductName','BatchID','ContainerID','Concentration','ConcentrationUnit','Purpose','PreparedAt','ExpiresAt','PreparedBy','ContainerLid','LabelComplete','Status','SourceFactID','Notes'],
  TASK:['TaskID','TaskType','ObjectID','DueAt','AssignedTo','Status','Priority','RelatedSolutionID','RelatedArea','CreatedAt','CompletedAt','CompletedBy','FactID','Notes'],
  GAP:['GapID','DisinfectantID','ProductName','GapType','Description','Severity','Status','CreatedAt'],
  FACT:['FactID','FactType','ObjectID','DateTime','EmployeeID','Value','Unit','Result','Source','DisinfectantID','SolutionID','TaskID','RelatedArea','DeviationID','CreatedAt','Notes']
};
function setupV41Disinfectants(){
  Object.keys(V41_HEADERS).forEach(k=>_v41Sheet_(V41_DS[k],V41_HEADERS[k]));
  return {ok:true,sheets:V41_DS};
}
function _v41Sheet_(name,headers){
  const ss=_book_(); let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);
  if(sh.getLastRow()===0) sh.appendRow(headers);
  return sh;
}
function _v41Id_(p){return 'DS41-'+Utilities.getUuid().slice(0,8).toUpperCase();}
function _v41Rows_(csv){
  const lines=String(csv||'').split(/\r?\n/).filter(x=>x.trim());
  if(!lines.length) return [];
  const delim=lines[0].indexOf(';')>=0?';':',';
  // первая строка — заголовок, только если похожа на заголовок (раньше пропускалась всегда: одна вставленная строка давала «импортировано 0»)
  const head=/производител|средств|manufacturer|product/i.test(lines[0])&&!/\d\s*%/.test(lines[0]);
  return lines.slice(head?1:0).map(line=>line.split(delim).map(x=>x.trim()));
}
function v41ImportDisinfectantsCsv(csv, token){
  setupV41Disinfectants();
  const rows=_v41Rows_(csv), sh=_book_().getSheetByName(V41_DS.MASTER), rg=_book_().getSheetByName(V41_DS.REGIME);
  const now=new Date(), created=[];
  rows.forEach(r=>{
    if(!r[1]) return;
    const id=_v41Id_(r[1]);
    sh.appendRow([id,r[0]||'',r[1]||'',r[2]||'', '', 'REVIEW','','','','', 'IMPORTED_REFERENCE','REVIEW','',now,now]);
    rg.appendRow([_v41Id_('R'),id,r[3]||'',r[4]||'',r[5]||'',r[6]||'',r[7]||'',r[2]||'', '', '', 'IMPORTED_REFERENCE','REVIEW','',now]);
    created.push(id);
  });
  return {ok:true,imported:created.length,ids:created};
}
function v41ApproveDisinfectant(disinfectantId, allowedForCatering, token){
  const sh=_book_().getSheetByName(V41_DS.MASTER); if(!sh) throw new Error('setupV41Disinfectants first');
  const data=sh.getDataRange().getValues(), h=data[0], ix=h.indexOf('DisinfectantID');
  for(let i=1;i<data.length;i++) if(String(data[i][ix])===String(disinfectantId)){
    sh.getRange(i+1,h.indexOf('AllowedForCatering')+1).setValue(allowedForCatering?'YES':'NO');
    sh.getRange(i+1,h.indexOf('ApprovalStatus')+1).setValue(allowedForCatering?'APPROVED':'REJECTED');
    sh.getRange(i+1,h.indexOf('UpdatedAt')+1).setValue(new Date());
    return {ok:true,id:disinfectantId,status:allowedForCatering?'APPROVED':'REJECTED'};
  }
  throw new Error('Disinfectant not found: '+disinfectantId);
}
function v41CreateSolution(p){
  setupV41Disinfectants();
  const sol=p||{}, sh=_book_().getSheetByName(V41_DS.SOL), now=new Date();
  if(!sol.disinfectantId) throw new Error('Выберите дезсредство');
  if(!sol.preparedAt) throw new Error('Укажите время приготовления раствора');
  if(!sol.expiresAt) throw new Error('Срок годности раствора не задан: нужен утверждённый режим или инструкция');
  const reg=_mcDsApprovedRegime_(sol.disinfectantId,sol.regimeId||''), cval=Number(String(sol.concentration||'').replace(',','.').replace('%',''));
  if(!isFinite(cval)||cval<reg.range.min||cval>reg.range.max) throw new Error('REGIME_VIOLATION: концентрация раствора '+(sol.concentration||'—')+' не соответствует утверждённому режиму ('+reg.regime.ConcentrationRaw+')');
  const id=_v41Id_('S');
  sh.appendRow([id,sol.disinfectantId,sol.productName||'',sol.batchId||'',sol.containerId||'',sol.concentration||'',sol.concentrationUnit||'',sol.purpose||'',new Date(sol.preparedAt),new Date(sol.expiresAt),sol.preparedBy||'',!!sol.containerLid,!!sol.labelComplete,'ACTIVE',sol.sourceFactId||'',sol.notes||'']);
  return {ok:true,solutionId:id};
}
function v41RecordControl(p){
  p = (typeof p === 'string' ? JSON.parse(p || '{}') : p) || {};
  if (p.value === undefined || p.value === null || p.value === '') throw new Error('VALIDATION: фактическое значение контроля обязательно');
  setupV41Disinfectants(); const sh=_book_().getSheetByName(V41_DS.FACT), now=new Date();
  // Результат вычисляет сервер по УТВЕРЖДЁННОМУ режиму; присланный клиентом result не принимается
  let dsId=p.disinfectantId||'';
  if(!dsId&&p.solutionId){const so=_v42Find_('Дезсредства_Растворы_V41','SolutionID',p.solutionId);dsId=so?so.DisinfectantID:'';}
  if(!dsId) throw new Error('VALIDATION: укажите дезсредство или рабочий раствор');
  const val=Number(String(p.value).replace(',','.').replace('%',''));
  if(!isFinite(val)) throw new Error('VALIDATION: концентрация должна быть числом (получено «'+p.value+'»)');
  if(p.equipmentId) _mcAssertEquipment_(p.equipmentId);
  const reg=_mcDsApprovedRegime_(dsId,p.regimeId||'');
  const result=(val>=reg.range.min&&val<=reg.range.max)?'PASS':'FAIL';
  const id=_v41Id_('F');
  let devId='';
  if(result==='FAIL'){try{const dv=_mcOpenDeviationAndAction_({journalId:'J15',objectId:p.objectId||dsId,value:val,critical:true,description:'Концентрация '+val+' % вне утверждённого режима '+reg.range.min+'–'+reg.range.max+' %'},null,'DS_CONCENTRATION','Концентрация дезраствора вне утверждённого режима','HIGH');devId=(dv&&(dv.deviationId||dv.id))||'';}catch(e){}try{_notify_('solution_out','warning','Раствор вне нормы',val+' % при режиме '+reg.range.min+'–'+reg.range.max+' %. Нужен повторный замер.','Ответственный за ХАССП','deviation|'+devId,null);}catch(eN){}}
  sh.appendRow([id,p.factType||'DISINFECTANT_CONCENTRATION',p.objectId||'',p.dateTime?new Date(p.dateTime):now,p.employeeId||'',val,'%',result,p.source||'MANUAL',dsId,p.solutionId||'',p.taskId||'',p.relatedArea||'',devId,now,(p.notes||'')+' [режим '+reg.regime.RegimeID+': '+reg.regime.ConcentrationRaw+']']);
  // этап 10.8: замер концентрации — запись журнала J15, КТ-6 (J26) получает копию (одно действие — две формы)
  let jrow=0;
  try{ jrow=_v41JournalRow_(p,dsId,reg,val,result,devId); }catch(e){ try{_log_('WARN','J15 из контроля раствора: '+e);}catch(x){} }
  return {ok:true,factId:id,result:result,regimeId:reg.regime.RegimeID,range:reg.range,deviationId:devId,journalRow:jrow};
}
function _v41JournalRow_(p,dsId,reg,val,result,devId){
  const j=_mcJById_('J15'); if(!j) return 0;
  const sh=_book_().getSheetByName(j.sheetName)||_createJournalSheet_(j), s=(typeof mcGateSession_==='function'?mcGateSession_():null);
  const at=p.dateTime?new Date(p.dateTime):(typeof _mcNow_==='function'?_mcNow_():new Date()), tz=_mcTz_();
  const ds=_v42Find_('Дезсредства_V41','DisinfectantID',dsId)||{}, who=s?(s.fullName||s.name||''):'';
  const vals={'Дата':Utilities.formatDate(at,tz,'dd.MM.yyyy'),'Время':Utilities.formatDate(at,tz,'HH:mm'),'Тип раствора':p.relatedArea||p.purpose||'',
    'Средство':ds.ProductName||dsId,'Норма концентрации':reg.regime.ConcentrationRaw||(reg.range.min+'–'+reg.range.max+' %'),'Факт (тест-полоска)':val+' %',
    'Соответствие (да/нет)':result==='PASS'?'да':'нет','Действия':devId?'отклонение '+devId:(p.notes||''),'ФИО':who,'Подпись':who};
  _mcJournalAppendTo_(sh,s,'замер',j.columns.map(function(c){return c==='№'?sh.getLastRow():(vals[c]!==undefined?vals[c]:'');}));
  const r=sh.getLastRow(); _mcMirrorRow_('J15',r); return r;
}
function v41GetDashboard(){
  const ss=_book_(), out={};
  Object.keys(V41_DS).forEach(k=>{const sh=ss.getSheetByName(V41_DS[k]); out[V41_DS[k]]=sh?Math.max(0,sh.getLastRow()-1):0;});
  return out;
}

/** Единое окно, экран «Дезсредства»: реестр средств и режимов со статусами утверждения (раньше списка не было ни на одном экране). */
function uiDisinfectantRegistry(token){
  try{
    _requireAuth_(token);setupV41Disinfectants();
    var rows=function(name){var sh=_book_().getSheetByName(name);if(!sh)return[];var v=sh.getDataRange().getValues(),h=v[0]||[],out=[];for(var i=1;i<v.length;i++){if(!v[i][0])continue;var o={};h.forEach(function(k,j){o[k]=v[i][j];});out.push(o);}return out;};
    var regs=rows(V41_DS.REGIME),items=rows(V41_DS.MASTER).map(function(d){return{id:String(d.DisinfectantID),manufacturer:String(d.Manufacturer||''),name:String(d.ProductName||''),scope:String(d.ObjectScope||''),
      allowed:String(d.AllowedForCatering||''),registration:String(d.RegistrationStatus||''),substance:String(d.ActiveSubstance||''),approval:String(d.ApprovalStatus||''),
      regimes:regs.filter(function(r){return String(r.DisinfectantID)===String(d.DisinfectantID);}).map(function(r){return{id:String(r.RegimeID),conc:String(r.ConcentrationRaw||''),exposure:String(r.ExposureRaw||''),method:String(r.Method||''),scope:String(r.ObjectScope||''),rinse:String(r.RinseRequired||''),approval:String(r.ApprovalStatus||'')};})};});
    return{ok:true,items:items};
  }catch(e){return{ok:false,error:String(e&&e.message||e)};}
}
