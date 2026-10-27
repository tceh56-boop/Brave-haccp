/**
 * MON CHEF V18 — MY TASKS / SHIFT DISPATCHER
 *
 * Единая очередь действий сотрудника: производство + HACCP + контроль.
 * Это не новый журнал. Модуль собирает уже существующие операционные задачи
 * и показывает человеку только то, что нужно сделать сегодня.
 */
var MC_V18_TASK_TYPES = {
  HACCP: 'HACCP',
  PRODUCTION: 'PRODUCTION'
};

function _mcV18Date_(d) {
  var x = d instanceof Date ? d : new Date(d);
  if (isNaN(x.getTime())) return '';
  return Utilities.formatDate(x, _mcTz_(), 'yyyy-MM-dd');
}
function _mcV18Time_(d) {
  var x = d instanceof Date ? d : new Date(d);
  if (isNaN(x.getTime())) return '';
  return Utilities.formatDate(x, _mcTz_(), 'HH:mm');
}
function _mcV18Today_() { return _mcV18Date_(new Date()); }
function _mcV18Norm_(s) { return String(s || '').trim().toLowerCase(); }
function _mcV18DueState_(date, due, deadline, status) {
  if (String(status) === 'ВЫПОЛНЕНО' || String(status).toLowerCase() === 'done' || String(status).toLowerCase() === 'completed') return 'DONE';
  var today = _mcV18Today_();
  if (String(date) < today) return 'OVERDUE';
  if (String(date) > today) return 'UPCOMING';
  var now = Number(Utilities.formatDate(new Date(), _mcTz_(), 'HH')) * 60 + Number(Utilities.formatDate(new Date(), _mcTz_(), 'mm'));
  var dl = _hm2min_(deadline || due);
  var du = _hm2min_(due);
  if (dl !== null && now > dl) return 'OVERDUE';
  if (du !== null && now >= Math.max(0, du - 30)) return 'DUE';
  return 'PLANNED';
}
function _mcV18IsMine_(responsible, employee) {
  var r = _mcV18Norm_(responsible), e = _mcV18Norm_(employee);
  if (!r || r === 'все' || r === 'система') return true;
  if (!e) return true;
  return r === e || r.indexOf(e) >= 0 || e.indexOf(r) >= 0;
}

function getMyOperationalTasks(date, token) {
  try {
    var actor = _requireAuth_(token, 'journals');
    var target = date || _mcV18Today_();
    var employee = _mcSessionFullName_(actor);
    var out = [], hDone = 0, hOver = 0, hDue = 0, pDone = 0, pOver = 0, pDue = 0;

    // HACCP equipment + production-created HACCP tasks.
    try { _mcV16GenerateEquipmentTasks_(); } catch (ignore1) {}
    try { _mcV17ProcessProduction_(); } catch (ignore2) {}
    var hs = _mcV16TasksSheet_(), hv = hs.getDataRange().getValues();
    for (var i = 1; i < hv.length; i++) {
      if (!hv[i][0]) continue;
      var d = hv[i][4] instanceof Date ? _mcV18Date_(hv[i][4]) : String(hv[i][4] || '').slice(0, 10);
      if (d !== target) continue;
      var responsible = '';
      try {
        var eq = _mcV16EquipmentSheet_().getDataRange().getValues();
        for (var ei = 1; ei < eq.length; ei++) if (String(eq[ei][0]) === String(hv[i][2])) { responsible = String(eq[ei][5] || ''); break; }
      } catch (ignore3) {}
      if (!_mcV18IsMine_(responsible, employee)) continue;
      var st = _mcV18DueState_(d, hv[i][5], hv[i][6], hv[i][7]);
      var done = st === 'DONE';
      if (done) hDone++; else if (st === 'OVERDUE') hOver++; else hDue++;
      out.push({
        type: MC_V18_TASK_TYPES.HACCP, id: String(hv[i][0]), controlId: String(hv[i][1] || ''),
        title: String(hv[i][3] || 'Контроль HACCP'), object: String(hv[i][2] || ''),
        date: d, due: String(hv[i][5] || ''), deadline: String(hv[i][6] || ''), status: String(hv[i][7] || ''),
        state: st, unit: String(hv[i][9] || ''), fact: hv[i][8], employee: String(hv[i][10] || ''),
        deviationId: String(hv[i][12] || ''), action: 'COMPLETE_HACCP'
      });
    }

    // Production board tasks: дата в Канбан_Задачи — рабочая дата производства.
    var ks = _kanbanSheet_(), kv = ks.getDataRange().getValues();
    for (var r = 1; r < kv.length; r++) {
      if (!kv[r][0]) continue;
      var kd = kv[r][2] instanceof Date ? _mcV18Date_(kv[r][2]) : String(kv[r][2] || '').slice(0, 10);
      if (kd !== target) continue;
      var kst = String(kv[r][9] || '');
      if (kst === 'done' || kst === 'выполнено' || kst === 'CANCELLED') {
        if (kst !== 'done' && kst !== 'выполнено') continue;
      }
      var assignedK = String(kv[r][10] || '');
      if (!_mcV18IsMine_(assignedK, employee)) continue;
      var kstate = (kst === 'done' || kst === 'выполнено') ? 'DONE' : 'DUE';
      if (kstate === 'DONE') pDone++; else pDue++;
      var kdTime = String(kv[r][13] || '');
      out.push({
        type: MC_V18_TASK_TYPES.PRODUCTION, id: String(kv[r][0]), operationId: String(kv[r][1] || ''),
        title: 'Производство: ' + String(kv[r][5] || kv[r][4] || 'Задача кухни'), object: String(kv[r][4] || ''),
        date: kd, due: kdTime, deadline: kdTime, status: kst, state: kstate, unit: 'порц.', planned: kv[r][6],
        actual: '', employee: assignedK, batchId: '', action: kstate === 'DONE' ? 'NONE' : 'COMPLETE_KANBAN'
      });
    }
    out.sort(function(a, b) {
      var order = {OVERDUE: 0, DUE: 1, PLANNED: 2, UPCOMING: 3, DONE: 4};
      var oa = order[a.state] == null ? 9 : order[a.state], ob = order[b.state] == null ? 9 : order[b.state];
      if (oa !== ob) return oa - ob;
      return String(a.due || '99:99').localeCompare(String(b.due || '99:99'));
    });
    return _ok_({date: target, employee: employee, summary: {total: out.length, due: hDue + pDue, overdue: hOver + pOver, done: hDone + pDone}, tasks: out});
  } catch (e) { return _failFrom_(e); }
}

function completeMyOperationalTask(json, token) {
  try {
    var d = JSON.parse(json || '{}');
    if (!d.type || !d.id) return _fail_('VALIDATION', 'Не указана задача');
    var actor = _requireAuth_(token, 'journals');
    var employee = _mcSessionFullName_(actor);
    if (d.type === MC_V18_TASK_TYPES.HACCP) return completeHaccpEquipmentTask(JSON.stringify({id:d.id, value:d.value, employee:employee}), token);
    if (d.type === MC_V18_TASK_TYPES.PRODUCTION) return updateKanbanTask(d.id, 'done', employee, token);
    return _fail_('VALIDATION', 'Неизвестный тип задачи');
  } catch (e) { return _failFrom_(e); }
}

function runMonChefMyTasksCycle(token) {
  try {
    if (token) _requireAuth_(token, 'journals');
    var h = 0, p = 0;
    try { h = _mcV16GenerateEquipmentTasks_(); } catch (ignore1) {}
    try { p = _mcV17ProcessProduction_(); } catch (ignore2) {}
    try { _mcV16NotifyEquipmentTasks_(); } catch (ignore3) {}
    return JSON.stringify({ok:true, data:{haccpTasksAdded:h, productionHaccpTasksAdded:p, checkedAt:new Date()}});
  } catch (e) { return JSON.stringify({ok:false,error:String(e)}); }
}
function runMonChefMyTasksCycleSystem() { return runMonChefMyTasksCycle(null); }
function installMonChefMyTasksTrigger(token) {
  try {
    _requireAuth_(token, 'audit_create');
    ScriptApp.getProjectTriggers().forEach(function(t) { if (t.getHandlerFunction() === 'runMonChefMyTasksCycleSystem') ScriptApp.deleteTrigger(t); });
    ScriptApp.newTrigger('runMonChefMyTasksCycleSystem').timeBased().everyMinutes(5).create();
    return _ok_({message:'Диспетчер задач смены проверяется каждые 5 минут'});
  } catch (e) { return _failFrom_(e); }
}
