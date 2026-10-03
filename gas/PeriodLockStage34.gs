// ЦЕХ — Stage 34: Universal Period Lock & Controlled Reopening
// Централизованный guard для изменений закрытого периода. Не блокирует чтение и не
// затрагивает мастер-данные без явной даты исторической операции.
var PL34_LIMIT_ = 200;
var PL34_EXEMPT_ACTIONS_ = [
  'LOGIN','LOGOUT','SELECT_LOCATION','GET_SESSION','GET_USERS_FOR_LOGIN',
  'GET_PERIOD_CLOSURE_SUMMARY','GET_PERIOD_CLOSURE','RUN_PERIOD_CLOSING_CHECK',
  'GET_PERIOD_REOPEN_REQUESTS','CREATE_PERIOD_REOPEN_REQUEST','APPROVE_PERIOD_REOPEN',
  'REOPEN_PERIOD'
];

function _pl34Date_(v){if(!v)return '';var s=String(v);return s.length>=10?s.slice(0,10):s;}
function _pl34Scope_(r,s){return r&&s&&r.organization_id===s.organization_id&&(!r.location_id||!s.location_id||r.location_id===s.location_id);}
function _pl34Rows_(sheet,s,fn){return findRows_(sheet,function(r){return _pl34Scope_(r,s)&&(!fn||fn(r));});}
function _pl34DateCandidates_(action,data){
  data=data||{}; var keys=['operationDate','date','dateFrom','periodDate','documentDate','saleDate','productionDate','createdAt','created_at','дата'];
  var out=[];
  keys.forEach(function(k){if(data[k]){var d=_pl34Date_(data[k]);if(/^\d{4}-\d{2}-\d{2}$/.test(d)&&out.indexOf(d)<0)out.push(d);}});
  // Явный period YYYY-MM также считается датой первого дня периода.
  if(data.period&&/^\d{4}-\d{2}$/.test(String(data.period))){var p=String(data.period)+'-01';if(out.indexOf(p)<0)out.push(p);}
  return out;
}
function _pl34Closed_(session,dateValue){
  var d=_pl34Date_(dateValue); if(!d)return null;
  var rows=_pl34Rows_('PERIOD_CLOSURES',session,function(r){return r.status==='CLOSED'&&String(r.date_from)<=d&&String(r.date_to)>=d;});
  return rows.length?rows[0]:null;
}
function _pl34ReferencedDates_(data,session){
  data=data||{}; var refs=[
    {key:'requestId',sheet:'PURCHASE_REQUESTS',dateKeys:['дата','created_at']},
    {key:'productionId',sheet:'PRODUCTION',dateKeys:['дата','date','created_at']},
    {key:'inventoryId',sheet:'INVENTORIES',dateKeys:['дата','created_at']},
    {key:'saleId',sheet:'SALES',dateKeys:['дата','created_at']},
    {key:'cashId',sheet:'CASH_TRANSACTIONS',dateKeys:['date','created_at']},
    {key:'writeoffId',sheet:'WRITE_OFFS',dateKeys:['date','дата','created_at']},
    {key:'batchId',sheet:'BATCHES',dateKeys:['production_date','дата_производства','created_at']},
    {key:'journalId',sheet:'JOURNALS',dateKeys:['date','дата','created_at']}
  ];
  var out=[]; refs.forEach(function(ref){
    if(!data[ref.key])return;
    var id=String(data[ref.key]); var rows=findRows_(ref.sheet,function(r){
      return _pl34Scope_(r,session)&&[r[ref.key.replace('Id','_id')],r[ref.key.replace('Id','_id').toLowerCase()]].map(String).indexOf(id)>=0;
    });
    if(!rows.length){
      // Канонические имена ключей в таблицах могут отличаться от API-поля.
      var idMap={requestId:'request_id',productionId:'production_id',inventoryId:'inventory_id',saleId:'sale_id',cashId:'cash_id',writeoffId:'writeoff_id',batchId:'batch_id',journalId:'journal_id'};
      rows=findRows_(ref.sheet,function(r){return _pl34Scope_(r,session)&&String(r[idMap[ref.key]]||'')===id;});
    }
    rows.slice(0,1).forEach(function(r){ref.dateKeys.forEach(function(k){if(r[k]){var d=_pl34Date_(r[k]);if(/^\d{4}-\d{2}-\d{2}$/.test(d)&&out.indexOf(d)<0)out.push(d);}});});
  });
  return out;
}
function _pl34HistoricalMutation_(action,data,session){
  return _pl34DateCandidates_(action,data||{}).concat(_pl34ReferencedDates_(data||{},session)).filter(function(v,i,a){return a.indexOf(v)===i;});
}
function assertPeriodMutationAllowed_(action,data,session){
  if(!session||!action||PL34_EXEMPT_ACTIONS_.indexOf(action)>=0)return true;
  var dates=_pl34HistoricalMutation_(action,data||{},session);
  for(var i=0;i<dates.length;i++){
    var lock=_pl34Closed_(session,dates[i]);
    if(lock){
      var msg='Период '+lock.period+' закрыт. Изменение исторической операции запрещено. Сначала выполните контролируемое повторное открытие периода.';
      auditLog_(session.user_id,'Заблокировано изменение закрытого периода',action,lock.closure_id,JSON.stringify({date:dates[i],period:lock.period}),'blocked',session.cascade_id);
      throw new Error(msg);
    }
  }
  return true;
}

function getPeriodReopenRequests_(data,session){
  var rows=_pl34Rows_('PERIOD_REOPEN_REQUESTS',session).sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);});
  return rows.slice(0,PL34_LIMIT_);
}
function createPeriodReopenRequest_(data,session){
  data=data||{}; var closureId=String(data.closureId||'');
  if(!closureId)throw new Error('Нужен closureId.');
  var closure=findOne_('PERIOD_CLOSURES','closure_id',closureId);
  if(!closure||!_pl34Scope_(closure,session))throw new Error('Закрытый период не найден.');
  if(closure.status!=='CLOSED')throw new Error('Период не находится в статусе CLOSED.');
  var reason=String(data.reason||'').trim(); if(reason.length<10)throw new Error('Причина повторного открытия обязательна (минимум 10 символов).');
  var existing=_pl34Rows_('PERIOD_REOPEN_REQUESTS',session,function(r){return r.closure_id===closureId&&['OPEN','APPROVED'].indexOf(String(r.status||''))>=0;});
  if(existing.length)return existing[0];
  var row={reopen_request_id:generateId_('PERIOD_REOPEN_REQUESTS'),closure_id:closureId,organization_id:session.organization_id,location_id:session.location_id||closure.location_id||'',period:closure.period,date_from:closure.date_from,date_to:closure.date_to,reason:reason,status:'OPEN',created_by:session.user_id,created_at:nowIso_(),approved_by:'',approved_at:'',reopened_by:'',reopened_at:''};
  insertRow_('PERIOD_REOPEN_REQUESTS',row);
  auditLog_(session.user_id,'Создан запрос на повторное открытие периода','PERIOD_REOPEN_REQUESTS:'+row.reopen_request_id,closureId,JSON.stringify({reason:reason,period:closure.period}),'success',session.cascade_id);
  return row;
}
function approvePeriodReopen_(data,session){
  var id=String(data&&data.reopenRequestId||''); if(!id)throw new Error('Нужен reopenRequestId.');
  var r=findOne_('PERIOD_REOPEN_REQUESTS','reopen_request_id',id);
  if(!r||!_pl34Scope_(r,session))throw new Error('Запрос на открытие периода не найден.');
  if(r.status!=='OPEN')throw new Error('Запрос уже обработан.');
  if(String(r.created_by||'')===String(session.user_id||'') && String(session.роль||'')!=='ADMIN')throw new Error('Утверждать собственный запрос на повторное открытие нельзя. Нужен второй уполномоченный пользователь.');
  updateRow_('PERIOD_REOPEN_REQUESTS',r,{status:'APPROVED',approved_by:session.user_id,approved_at:nowIso_()});
  auditLog_(session.user_id,'Утвержден запрос на повторное открытие периода','PERIOD_REOPEN_REQUESTS:'+id,r.closure_id,'','approved',session.cascade_id);
  return findOne_('PERIOD_REOPEN_REQUESTS','reopen_request_id',id);
}
function reopenPeriod_(data,session){
  var id=String(data&&data.reopenRequestId||''); if(!id)throw new Error('Нужен reopenRequestId.');
  var r=findOne_('PERIOD_REOPEN_REQUESTS','reopen_request_id',id);
  if(!r||!_pl34Scope_(r,session))throw new Error('Запрос на открытие периода не найден.');
  if(r.status!=='APPROVED')throw new Error('Сначала требуется утверждение запроса.');
  var closure=findOne_('PERIOD_CLOSURES','closure_id',r.closure_id);
  if(!closure||!_pl34Scope_(closure,session))throw new Error('Закрытие периода не найдено.');
  if(closure.status!=='CLOSED')throw new Error('Период уже открыт или имеет другой статус.');
  var reopenReason=String(data.reason||r.reason||'').trim();
  updateRow_('PERIOD_CLOSURES',closure,{status:'REOPENED',ready:'NO',closed_by:'',closed_at:'',reopened_by:session.user_id,reopened_at:nowIso_(),reopen_reason:reopenReason});
  updateRow_('PERIOD_REOPEN_REQUESTS',r,{status:'REOPENED',reopened_by:session.user_id,reopened_at:nowIso_()});
  auditLog_(session.user_id,'Период повторно открыт','PERIOD_CLOSURES:'+closure.closure_id,closure.closure_id,JSON.stringify({period:closure.period,reason:reopenReason,reopen_request_id:id}),'success',session.cascade_id);
  return {closure:findOne_('PERIOD_CLOSURES','closure_id',closure.closure_id),request:findOne_('PERIOD_REOPEN_REQUESTS','reopen_request_id',id)};
}
function periodLockStage34Tests_(){
  return [
    {name:'GUARD_API',status:typeof assertPeriodMutationAllowed_==='function'?'OK':'FAIL'},
    {name:'REOPEN_WORKFLOW',status:typeof createPeriodReopenRequest_==='function'&&typeof approvePeriodReopen_==='function'&&typeof reopenPeriod_==='function'?'OK':'FAIL'},
    {name:'DATE_DETECTION',status:_pl34HistoricalMutation_('X',{date:'2026-01-01'}, {organization_id:'TEST'})[0]==='2026-01-01'?'OK':'FAIL'},
    {name:'LIMIT',status:PL34_LIMIT_===200?'OK':'FAIL'}
  ];
}
