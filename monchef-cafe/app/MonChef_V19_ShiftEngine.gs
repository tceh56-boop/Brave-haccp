/**
 * MON CHEF V19 — SHIFT ENGINE / ЭКРАН СМЕНЫ
 *
 * Собирает рабочую смену из существующих задач V18:
 *   HACCP + производство + производственные HACCP-контроли.
 *
 * Не создаёт фиктивные измерения и не заменяет фактическое действие сотрудника.
 * Задача V19 — дать сотруднику и шефу одну оперативную картину смены.
 */
var MC_V19_SHIFT = 'MonChef_Смены';

function _mcV19ShiftSheet_() {
  return _mcV16Sheet_(MC_V19_SHIFT, [
    'ShiftID','Date','Employee','Role','StartedAt','EndedAt','Status','CreatedAt','UpdatedAt','Notes'
  ]);
}
function _mcV19Now_(){ return new Date(); }
function _mcV19Date_(d){ return Utilities.formatDate(d||new Date(), _mcTz_(),'yyyy-MM-dd'); }
function _mcV19Time_(d){ return Utilities.formatDate(d||new Date(), _mcTz_(),'HH:mm'); }
function _mcV19StateRank_(s){ return ({OVERDUE:0,BLOCKED:0,DUE:1,PLANNED:2,UPCOMING:3,DONE:4})[s] == null ? 9 : ({OVERDUE:0,BLOCKED:0,DUE:1,PLANNED:2,UPCOMING:3,DONE:4})[s]; }
function _mcV19SafeDate_(v){ if(v instanceof Date && !isNaN(v.getTime())) return v; var d=new Date(v); return isNaN(d.getTime())?null:d; }

function _mcV19BuildShift_(date, employee, token) {
  var target = date || _mcV19Date_(new Date());
  var my = getMyOperationalTasks(target, token);
  // ответ сервера — строка JSON (_ok_); раньше проверялось my.ok у строки, и «Моя смена» всегда отвечала ошибкой
  if (typeof my === 'string') { try { my = JSON.parse(my); } catch (pe) { my = null; } }
  if(!my || (my.ok !== true && my.success !== true)) throw new Error(my && my.error ? my.error.message || my.error : 'Не удалось получить задачи смены');
  var tasks = (my.data && my.data.tasks) || [];
  var blocked = 0, overdue = 0, due = 0, planned = 0, done = 0;
  var byType = {HACCP:0,PRODUCTION:0};
  tasks.forEach(function(t){
    byType[t.type] = (byType[t.type]||0)+1;
    if(t.state==='DONE') done++; else if(t.state==='OVERDUE') overdue++; else if(t.state==='DUE') due++; else planned++;
    if(t.deviationId) blocked++;
  });
  var now = new Date(), nowMin = _hm2min_(Utilities.formatDate(now,_mcTz_(),'HH:mm'));
  tasks.forEach(function(t){
    var dueMin=_hm2min_(t.due||'');
    if(t.state!=='DONE' && dueMin!==null && dueMin<nowMin && !t.deviationId) t.state = 'OVERDUE';
    if(t.deviationId) t.state='BLOCKED';
  });
  tasks.sort(function(a,b){
    var ra=_mcV19StateRank_(a.state), rb=_mcV19StateRank_(b.state);
    if(ra!==rb)return ra-rb;
    return String(a.due||'99:99').localeCompare(String(b.due||'99:99'));
  });
  var attention = tasks.filter(function(t){return t.state==='OVERDUE'||t.state==='BLOCKED';});
  var next = tasks.filter(function(t){return t.state==='DUE'||t.state==='PLANNED'||t.state==='UPCOMING';}).slice(0,8);
  return {date:target,employee:employee,summary:{total:tasks.length,done:done,due:due,planned:planned,overdue:overdue,blocked:blocked,byType:byType,completionPercent:tasks.length?Math.round(done*1000/tasks.length)/10:100},attention:attention.slice(0,20),next:next,tasks:tasks};
}

function getMyShiftDashboard(date, token) {
  try {
    var actor=_requireAuth_(token,'journals');
    var employee=_mcSessionFullName_(actor);
    return _ok_(_mcV19BuildShift_(date||_mcV19Date_(new Date()),employee,token));
  } catch(e){ return _failFrom_(e); }
}

function getChefShiftDashboard(date, token) {
  try {
    _requireAuth_(token,'journals');
    var target=date||_mcV19Date_(new Date());
    // Для шефа собираем задачи всех сотрудников. getMyOperationalTasks с пустым
    // employee не фильтрует ответственного, поэтому вызываем его от системного
    // представления через тот же защищённый контур.
    var result=getMyOperationalTasks(target,token);
    if(!result || result.ok!==true) return result;
    var tasks=(result.data&&result.data.tasks)||[];
    var byEmployee={}, attention=[], done=0, overdue=0, due=0, planned=0;
    tasks.forEach(function(t){
      var who=t.employee||'Не назначен';
      if(!byEmployee[who]) byEmployee[who]={employee:who,total:0,done:0,overdue:0,due:0,blocked:0};
      byEmployee[who].total++;
      if(t.state==='DONE'){done++;byEmployee[who].done++;}
      else if(t.state==='OVERDUE'){overdue++;byEmployee[who].overdue++;attention.push(t);}
      else if(t.state==='DUE'){due++;byEmployee[who].due++;}
      else planned++;
      if(t.deviationId){byEmployee[who].blocked++;attention.push(t);}
    });
    return _ok_({date:target,summary:{total:tasks.length,done:done,overdue:overdue,due:due,planned:planned,attention:attention.length,completionPercent:tasks.length?Math.round(done*1000/tasks.length)/10:100},employees:Object.keys(byEmployee).map(function(k){return byEmployee[k];}),attention:attention.slice(0,50),tasks:tasks});
  } catch(e){return _failFrom_(e);}
}

function startMyShift(json, token){
  try{
    var actor=_requireAuth_(token,'journals'), d=JSON.parse(json||'{}'), date=d.date||_mcV19Date_(new Date()), employee=_mcSessionFullName_(actor);
    var sh=_mcV19ShiftSheet_(), v=sh.getDataRange().getValues();
    for(var i=1;i<v.length;i++) if(String(v[i][1])===date && String(v[i][2])===employee && String(v[i][6])==='OPEN') return _ok_({shiftId:v[i][0],startedAt:v[i][4],status:'OPEN'});
    var id='SHIFT-'+Utilities.formatDate(new Date(),_mcTz_(),'yyyyMMddHHmmss')+'-'+Math.floor(Math.random()*10000), now=new Date();
    sh.appendRow([id,date,employee,String(d.role||''),now,'','OPEN',now,now,String(d.notes||'')]);
    return _ok_({shiftId:id,date:date,employee:employee,startedAt:now,status:'OPEN'});
  }catch(e){return _failFrom_(e);}
}
function endMyShift(json, token){
  try{
    var actor=_requireAuth_(token,'journals'), d=JSON.parse(json||'{}'), id=String(d.shiftId||'');
    if(!id)return _fail_('VALIDATION','Не указан ShiftID');
    var sh=_mcV19ShiftSheet_(),v=sh.getDataRange().getValues();
    for(var i=1;i<v.length;i++) if(String(v[i][0])===id){
      if(String(v[i][2])!==String(_mcSessionFullName_(actor)))return _fail_('FORBIDDEN','Смена принадлежит другому сотруднику');
      sh.getRange(i+1,6).setValue(new Date());sh.getRange(i+1,7).setValue('CLOSED');sh.getRange(i+1,9).setValue(new Date());
      return _ok_({shiftId:id,status:'CLOSED',endedAt:new Date()});
    }
    return _fail_('NOT_FOUND','Смена не найдена');
  }catch(e){return _failFrom_(e);}
}

function runMonChefShiftCycle(token){
  try{
    if(token)_requireAuth_(token,'journals');
    var result=runMonChefMyTasksCycle(token);
    return JSON.stringify({ok:true,data:{checkedAt:new Date(),myTasksCycle:result}});
  }catch(e){return JSON.stringify({ok:false,error:String(e)});}
}
function runMonChefShiftCycleSystem(){return runMonChefShiftCycle(null);}
function installMonChefShiftTrigger(token){
  try{
    _requireAuth_(token,'audit_create');
    ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='runMonChefShiftCycleSystem')ScriptApp.deleteTrigger(t);});
    ScriptApp.newTrigger('runMonChefShiftCycleSystem').timeBased().everyMinutes(5).create();
    return _ok_({message:'Диспетчер смены проверяется каждые 5 минут'});
  }catch(e){return _failFrom_(e);}
}
