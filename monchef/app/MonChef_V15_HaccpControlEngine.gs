/**
 * MON CHEF V15 — АВТОМАТИЗИРОВАННЫЙ КОНТРОЛЬ HACCP
 *
 * Принцип: система НЕ придумывает показатели и НЕ заполняет измерения за человека.
 * Она планирует контроль, создаёт ожидаемую проверку, напоминает о сроке,
 * показывает просрочку и после фактического ответа использует существующий
 * механизм журналов/отклонений.
 *
 * В качестве рабочего слоя используется существующая инфраструктура:
 * Журналы_Расписание -> Журналы_Ожидания -> answerJournalCheck().
 */

var MC_V15_HACCP_CONTROLS = 'HACCP_Контроли';
var MC_V15_HACCP_EVENTS = 'HACCP_События';

function _mcV15HaccpControlsSheet_() {
  var ss = _book_();
  var sh = ss.getSheetByName(MC_V15_HACCP_CONTROLS);
  if (!sh) {
    sh = ss.insertSheet(MC_V15_HACCP_CONTROLS);
    sh.appendRow([
      'ControlID','Name','Type','JournalID','Object','Question','ScheduleType','Parameter',
      'AnswerMode','Unit','Min','Max','Critical','Responsible','Enabled','ReminderMinutes',
      'LastRun','CreatedAt','Notes'
    ]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _mcV15HaccpEventsSheet_() {
  var ss = _book_();
  var sh = ss.getSheetByName(MC_V15_HACCP_EVENTS);
  if (!sh) {
    sh = ss.insertSheet(MC_V15_HACCP_EVENTS);
    sh.appendRow(['EventID','ControlID','EventType','Object','Status','DueAt','CreatedAt','Details','OperationID']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _mcV15SeedControls_() {
  var sh = _mcV15HaccpControlsSheet_();
  if (sh.getLastRow() > 1) return 0;
  var now = new Date();
  // Этап 10.8: общих проверок «Все холодильники −2…+8» больше нет — предел не из документа, а вопрос дублировал
  // проверку каждого объекта. Температуры спрашиваются по объектам («Температуры → Объекты контроля»).
  var rows = [
    ['HC-OIL-01','Фритюр — контроль масла','OIL','J38','Фритюр №1','Проверить состояние фритюрного масла (цвет, запах, пена, осадок)','в_заданное_время','11:00,16:00','да_нет','', '', '',true,'Шеф-повар',true,60,'При необходимости фиксировать измеренный показатель/причину'],
    ['HC-OIL-02','Фритюр — замена масла','OIL_CHANGE','J38','Фритюр №1','Проверить необходимость замены и заменить масло при достижении регламента','раз_в_неделю','1 11:00','да_нет','', '', '',false,'Шеф-повар',true,120,'Периодичность должна быть настроена по фактическому регламенту предприятия'],
    ['HC-CLEAN-01','Дезрастворы — контроль концентрации','SANITATION','J15','Рабочие растворы','Проверить фактическую концентрацию дезинфицирующего раствора','в_заданное_время','08:30,16:30','да_нет_с_числом_при_нет','%', '', '',true,'Санитарный работник',true,60,'Нормативные пределы задаются для конкретного средства'],
    ['HC-EQ-01','Термометры — калибровка','CALIBRATION','J19','Термометры','Проверить срок и провести калибровку термометров','раз_в_месяц','1 10:00','да_нет','', '', '',false,'Администратор',true,1440,''],
    ['HC-ROT-01','Склад — ротация и сроки годности','ROTATION','J29','Склад','Проверить партии с ближайшим сроком годности и FEFO-ротацию','в_заданное_время','09:00','да_нет','', '', '',false,'Кладовщик',true,120,'Будет дополнено связкой со складом/FEFO']
  ];
  rows.forEach(function(r){ sh.appendRow(r.concat([now])); });
  return rows.length;
}

function _mcV15HaccpUpsertSchedule_(control) {
  var sh = _jtrigSheet_();
  var v = sh.getDataRange().getValues();
  for (var i=1;i<v.length;i++) {
    if (String(v[i][0]) === String(control.ControlID)) return false;
  }
  sh.appendRow([
    control.ControlID, control.JournalID, control.Object, control.Question,
    control.ScheduleType, control.Parameter, control.AnswerMode, control.Unit,
    control.Min === '' ? '' : control.Min, control.Max === '' ? '' : control.Max,
    control.Critical === true, control.Responsible, control.Enabled !== false, new Date()
  ]);
  return true;
}

// Контроль фритюра раньше был заведён на J18 (журнал ремонта оборудования).
// Переносит уже заведённые контроли, их расписание и ещё не отвеченные проверки
// в J38 «Журнал учёта фритюрных жиров». Выполняется один раз; записи, уже
// внесённые в J18, не трогает — это история, её не переписываем.
function _mcV15FixOilJournal_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('MC_FIX_OIL_J38') === '1') return 0;
  var moved = 0, oil = {};
  var cs = _mcV15HaccpControlsSheet_(), cv = cs.getDataRange().getValues();
  for (var i = 1; i < cv.length; i++) {
    if (!(/^OIL/.test(String(cv[i][2])) || /^HC-OIL-/.test(String(cv[i][0])))) continue;
    oil[String(cv[i][0])] = true;
    if (String(cv[i][3]) === 'J18') { cs.getRange(i + 1, 4).setValue('J38'); moved++; }
    // «нет» требовал число без единицы — непонятно какое. Теперь «да/нет», при «нет» — описание факта.
    if (String(cv[i][8]) === 'да_нет_с_числом_при_нет' && !String(cv[i][9] || '').trim()) cs.getRange(i + 1, 9).setValue('да_нет');
  }
  var ts = _jtrigSheet_(), tv = ts.getDataRange().getValues();
  for (var k = 1; k < tv.length; k++) {
    if (!oil[String(tv[k][0])]) continue;
    if (String(tv[k][1]) === 'J18') { ts.getRange(k + 1, 2).setValue('J38'); moved++; }
    if (String(tv[k][6]) === 'да_нет_с_числом_при_нет' && !String(tv[k][7] || '').trim()) ts.getRange(k + 1, 7).setValue('да_нет');
  }
  var ps = _pendSheet_(), pv = ps.getDataRange().getValues();
  for (var p = 1; p < pv.length; p++) if (oil[String(pv[p][1])] && String(pv[p][2]) === 'J18' && String(pv[p][8]) !== 'выполнено') { ps.getRange(p + 1, 3).setValue('J38'); moved++; }
  props.setProperty('MC_FIX_OIL_J38', '1');
  return moved;
}

// Этап 10.8: контроль растворов вносится в J15 (КТ-6 J26 — его копия). Переносит заведённые ранее на J26.
function _mcV15FixCleanJournal_() {
  var n = 0;
  try {
    var cs = _mcV15HaccpControlsSheet_(), cv = cs.getDataRange().getValues();
    for (var i = 1; i < cv.length; i++) if (String(cv[i][0]) === 'HC-CLEAN-01' && String(cv[i][3]) === 'J26') { cs.getRange(i + 1, 4).setValue('J15'); n++; }
    var ts = _jtrigSheet_(), tv = ts.getDataRange().getValues();
    for (var k = 1; k < tv.length; k++) if (String(tv[k][0]) === 'HC-CLEAN-01' && String(tv[k][1]) === 'J26') { ts.getRange(k + 1, 2).setValue('J15'); n++; }
    var ps = _pendSheet_(), pv = ps.getDataRange().getValues();
    for (var p = 1; p < pv.length; p++) if (String(pv[p][1]) === 'HC-CLEAN-01' && String(pv[p][2]) === 'J26' && String(pv[p][8]) !== 'выполнено') { ps.getRange(p + 1, 3).setValue('J15'); n++; }
  } catch (e) {}
  return n;
}

function setupMonChefHaccpAutomation(token) {
  try {
    if (token) _requireAuth_(token, 'journals');
    var seeded = _mcV15SeedControls_();
    _mcV15FixOilJournal_();
    _mcV15FixCleanJournal_();
    var sh = _mcV15HaccpControlsSheet_(), v = sh.getDataRange().getValues(), added=0;
    for (var i=1;i<v.length;i++) {
      if (!v[i][0] || v[i][14] === false) continue;
      if (_mcV15HaccpUpsertSchedule_({
        ControlID:v[i][0], JournalID:v[i][3], Object:v[i][4], Question:v[i][5],
        ScheduleType:v[i][6], Parameter:v[i][7], AnswerMode:v[i][8], Unit:v[i][9],
        Min:v[i][10], Max:v[i][11], Critical:v[i][12]===true, Responsible:v[i][13], Enabled:v[i][14]
      })) added++;
    }
    _mcV15HaccpEventsSheet_();
    var triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(function(t){
      if (t.getHandlerFunction()==='runMonChefHaccpControlCycleSystem') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('runMonChefHaccpControlCycleSystem').timeBased().everyMinutes(15).create();
    return JSON.stringify({ok:true, seeded:seeded, schedulesAdded:added, message:'Автоматический HACCP-контроль установлен.'});
  } catch(e) { return JSON.stringify({ok:false,error:String(e)}); }
}

function getHaccpControlDashboard(token) {
  try {
    _requireAuth_(token, null);
    generateJournalPending();
    var pending = JSON.parse(getPendingChecks(token));
    var checks = pending && pending.data ? pending.data.проверки : (pending.проверки || []);
    var now = new Date(), due=0, overdue=0;
    checks.forEach(function(c){
      var dl = _hm2min_(c.дедлайн), cur = _hm2min_(Utilities.formatDate(now,_mcTz_(),'HH:mm'));
      if (c.статус !== 'выполнено') { if (dl !== null && cur > dl) overdue++; else due++; }
    });
    return JSON.stringify({ok:true,data:{date:Utilities.formatDate(now,_mcTz_(),'yyyy-MM-dd'),total:checks.length,due:due,overdue:overdue,checks:checks}});
  } catch(e) { return JSON.stringify({ok:false,error:String(e)}); }
}

function _mcV15NotifyPending_(checks) {
  var now = new Date(), cur = _hm2min_(Utilities.formatDate(now,_mcTz_(),'HH:mm'));
  (checks||[]).forEach(function(c){
    if (!c || c.статус === 'выполнено') return;
    var dl = _hm2min_(c.дедлайн); if (dl === null) return;
    var overdue = cur > dl;
    var dueSoon = !overdue && cur >= Math.max(0, dl-30);
    if (!overdue && !dueSoon) return;
    var severity = overdue ? (c.критическая ? 'critical' : 'warning') : 'info';
    var title = overdue ? 'Просрочен HACCP-контроль: '+c.объект : 'Скоро HACCP-контроль: '+c.объект;
    var text = c.вопрос+' · план '+c.время+' · дедлайн '+c.дедлайн;
    var nid = _notify_('haccp_control',severity,title,text,c.ответственный||'Шеф-повар','haccp_pending|'+c.id,null);
    if (nid) _mcV15HaccpEventsSheet_().appendRow(['HE'+Date.now()+Math.floor(Math.random()*1000),'',overdue?'OVERDUE':'REMINDER',c.объект,overdue?'OVERDUE':'REMINDER',c.дедлайн,new Date(),text,'']);
  });
}

function runMonChefHaccpControlCycle(token) {
  try {
    if (token) _requireAuth_(token, 'journals');
    _mcV15FixOilJournal_();
    generateJournalPending();
    var pv = _pendSheet_().getDataRange().getValues();
    var tv = _jtrigSheet_().getDataRange().getValues(), trig = {};
    for (var ti=1; ti<tv.length; ti++) if (tv[ti][0]) trig[String(tv[ti][0])] = {режим:tv[ti][6],единица:tv[ti][7],пределМин:tv[ti][8],пределМакс:tv[ti][9],критическая:tv[ti][10]===true};
    var today=Utilities.formatDate(new Date(),_mcTz_(),'yyyy-MM-dd'), checks=[];
    for(var pi=1;pi<pv.length;pi++){
      if(!pv[pi][0]) continue;
      var ds=pv[pi][5] instanceof Date?Utilities.formatDate(pv[pi][5],_mcTz_(),'yyyy-MM-dd'):String(pv[pi][5]||'');
      if(ds!==today || String(pv[pi][8])==='выполнено') continue;
      var t=trig[String(pv[pi][1])]||{};
      checks.push({id:pv[pi][0],журнал:pv[pi][2],объект:pv[pi][3],вопрос:pv[pi][4],время:pv[pi][6],дедлайн:pv[pi][7],статус:pv[pi][8],критическая:!!t.критическая,ответственный:''});
    }
    _mcV15NotifyPending_(checks);
    return JSON.stringify({ok:true,data:{pending:checks.length,checkedAt:new Date()}});
  } catch(e) { return JSON.stringify({ok:false,error:String(e)}); }
}
function runMonChefHaccpControlCycleSystem(){ return runMonChefHaccpControlCycle(null); }

function addHaccpControl(json, token) {
  try {
    _requireAuth_(token,'journals');
    var d=JSON.parse(json||'{}');
    if(!d.Name||!d.JournalID||!d.Object||!d.Question) throw new Error('Name, JournalID, Object и Question обязательны');
    var id=d.ControlID||('HC-'+Date.now());
    var sh=_mcV15HaccpControlsSheet_();
    sh.appendRow([id,d.Name,d.Type||'CUSTOM',d.JournalID,d.Object,d.Question,d.ScheduleType||'в_заданное_время',d.Parameter||'08:00',d.AnswerMode||'да_нет',d.Unit||'',d.Min==null?'':d.Min,d.Max==null?'':d.Max,d.Critical===true,d.Responsible||'Шеф-повар',d.Enabled!==false,d.ReminderMinutes||60,'',new Date(),d.Notes||'']);
    _mcV15HaccpUpsertSchedule_({ControlID:id,JournalID:d.JournalID,Object:d.Object,Question:d.Question,ScheduleType:d.ScheduleType||'в_заданное_время',Parameter:d.Parameter||'08:00',AnswerMode:d.AnswerMode||'да_нет',Unit:d.Unit||'',Min:d.Min==null?'':d.Min,Max:d.Max==null?'':d.Max,Critical:d.Critical===true,Responsible:d.Responsible||'Шеф-повар',Enabled:d.Enabled!==false});
    return JSON.stringify({ok:true,id:id});
  } catch(e){return JSON.stringify({ok:false,error:String(e)});}
}
