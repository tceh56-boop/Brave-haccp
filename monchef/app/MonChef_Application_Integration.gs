/**
 * MON CHEF — Unified Application Integration
 *
 * Пользовательский слой над существующими операционными модулями.
 * Внутренние номера релизов не являются частью UI.
 */
var MC_APP_MODULES = [
  {id:'dashboard', name:'Сводка', icon:'▦', desc:'Состояние кухни, склада и контроля'},
  {id:'banquets', name:'Банкеты', icon:'♜', desc:'Заказы, меню, потребность и закрытие'},
  {id:'planning', name:'Планирование', icon:'◷', desc:'Неделя, потребность и производственные окна'},
  {id:'production', name:'Производство', icon:'♨', desc:'Задания, П/Ф, выпуск и отбор'},
  {id:'stock', name:'Склад', icon:'◇', desc:'Приёмка, партии, FEFO, ревизии'},
  {id:'shortage', name:'Дефициты', icon:'!', desc:'Дефицит → излишек → ТТК → остаточный выпуск'},
  {id:'surplus', name:'Излишки', icon:'↑', desc:'Поиск безопасного использования излишков'},
  {id:'ttk', name:'ТТК и ППК', icon:'≡', desc:'Рецептуры, граф рецептов и HACCP'},
  {id:'haccp', name:'HACCP', icon:'✓', desc:'Контроли, факты, отклонения и действия'},
  {id:'sanitation', name:'Санитария', icon:'✦', desc:'Чек-листы, дезсредства и контроль'},
  {id:'purchases', name:'Закупки', icon:'▤', desc:'Потребность, поставки и приёмка'},
  {id:'control', name:'Контроль', icon:'◉', desc:'ProductID, ресурсы, безопасность и готовность'}
];

// google.script.run не передаёт на клиент объекты Date (весь ответ отклоняется),
// поэтому всё, что уходит в интерфейс, приводится к простому JSON.
function _mcAppPlain_(x){ return x === undefined ? null : JSON.parse(JSON.stringify(x)); }
function _mcAppData_(x){ var v = typeof x === 'string' ? JSON.parse(x) : x; return v && v.data !== undefined && (v.success === true || v.ok === true) ? v.data : v; }
function _mcAppSurplus_(token){
  var d = v50GetDashboard('', '', 7, token);
  if (d && Array.isArray(d.uncoveredDemand)) d.uncoveredDemand = d.uncoveredDemand.length;
  return d;
}

function _mcAppSafe_(fn, fallback){
  try { return fn(); } catch(e) { return fallback; }
}
function mcGetApplicationModules(){ return MC_APP_MODULES; }
function mcGetApplicationSnapshot(token){
  var out={ok:true,generatedAt:new Date(),modules:MC_APP_MODULES,metrics:{},errors:[]};
  function add(id, fn){
    try { out.metrics[id]=fn(); }
    catch(e){ out.errors.push({module:id,message:String(e&&e.message||e)}); out.metrics[id]={ok:false,error:String(e&&e.message||e)}; }
  }
  add('dashboard',function(){return JSON.parse(getDashboard(token,7));});
  add('stock',function(){return {stock:JSON.parse(getStockBalances()),revision:v49GetDashboard(),resource:v54GetDashboard(token)};});
  add('production',function(){return {orders:_mcAppData_(getProductionOrders('',token))||[],dispatcher:(v57GetDispatcher()||{}).rows||[]};});
  add('shortage',function(){return {bridge:v51GetDashboard('', '', token),ttk:v52GetDashboard('', '', token)};});
  add('surplus',function(){return _mcAppSurplus_(token);});
  add('ttk',function(){return {productUnits:v53GetDashboard(token)};});
  add('control',function(){return {resource:v54Readiness(token),release:v63GetReleaseStatus()};});
  add('haccp',function(){return {dashboard:JSON.parse(getDashboard(token,1))};});
  return _mcAppPlain_(out);
}

function mcGetModuleSnapshot(moduleId, token){ return _mcAppPlain_(_mcGetModuleSnapshot_(moduleId, token)); }
function _mcGetModuleSnapshot_(moduleId, token){
  switch(String(moduleId||'')){
    case 'dashboard': return JSON.parse(getDashboard(token,7));
    case 'stock': return {stock:JSON.parse(getStockBalances()),revision:v49GetDashboard(),resource:v54GetDashboard(token)};
    case 'production': return {orders:_mcAppData_(getProductionOrders('',token))||[],dispatcher:(v57GetDispatcher()||{}).rows||[]};
    case 'shortage': return {bridge:v51GetDashboard('', '', token),ttk:v52GetDashboard('', '', token)};
    case 'surplus': return _mcAppSurplus_(token);
    case 'ttk': return {productUnits:v53GetDashboard(token)};
    case 'haccp': return {dashboard:JSON.parse(getDashboard(token,1))};
    case 'sanitation': return _mcAppSafe_(function(){return {dashboard:JSON.parse(getDashboard(token,1))};},{ok:false,error:'Не удалось получить санитарный контур'});
    case 'purchases': return _mcAppSafe_(function(){return {dashboard:JSON.parse(getDashboard(token,7))};},{ok:false,error:'Не удалось получить закупочный контур'});
    case 'control': return {resource:v54Readiness(token),release:v63GetReleaseStatus()};
    case 'banquets': return _mcAppSafe_(function(){return {events:getEvents()};},{ok:false,error:'Не удалось получить банкеты'});
    case 'planning': return _mcAppSafe_(function(){return {events:getEvents(),production:v57GetDispatcher()};},{ok:false,error:'Не удалось получить планирование'});
    default: return {ok:false,error:'Неизвестный модуль'};
  }
}

function mcRunModuleAction(action, token){ return _mcAppPlain_(_mcRunModuleAction_(action, token)); }
function _mcRunModuleAction_(action, token){
  switch(String(action||'')){
    case 'refresh_dispatcher': return v57BuildWeeklyDispatcher(token);
    case 'analyze_surplus': return v50AnalyzeSurplus('', '', 7, token);
    case 'build_deficit_plan': return v51BuildDispatchPlan('', '', token);
    case 'recalculate_ttk': return v52RecalculateDeficits('', '', token);
    case 'check_resources': return v54Readiness(token);
    case 'release_status': return v63GetReleaseStatus();
    default: return {ok:false,error:'Неизвестное действие'};
  }
}
