/**
 * MON CHEF V24 — TTK -> PRODUCTION DEPENDENCY ENGINE
 *
 * Слой между ТТК и производственным диспетчером:
 * блюдо -> П/Ф -> П/Ф следующего уровня -> сырьё.
 *
 * V24 не списывает склад и не создаёт фиктивные факты. Он строит
 * исполнимый план зависимостей. Фактический расход выполняется V23/ядром
 * производства после сканирования и подтверждения.
 */
var MC_V24_DEP = 'Производственные_Зависимости_V24';

function _mcV24Sheet_(){
  var sh=_book_().getSheetByName(MC_V24_DEP);
  if(!sh){sh=_book_().insertSheet(MC_V24_DEP);sh.appendRow([
    'DependencyID','PlanID','ParentProductionID','ProductionDate','DueTime',
    'Level','TaskType','TTKCode','Name','RequiredQty','Unit','StockAvailable',
    'ToProduce','BanquetIDs','Status','CreatedAt','CreatedBy','Source'
  ]);sh.setFrozenRows(1);}
  return sh;
}
function _mcV24Date_(d){return Utilities.formatDate(new Date(d),_mcTz_(),'yyyy-MM-dd');}
function _mcV24Num_(x){return Number(String(x==null?'':x).replace(',','.'))||0;}
function _mcV24Norm_(s){return _normNameServer_(String(s||''));}

function _mcV24BuildTree_(code, qty, idx, pfStock, raw, nodes, path, level, parentId, meta){
  var dish=idx.dishByCode[code];
  if(!dish) return {missingTTK:true};
  var children=[];
  (dish.ing||[]).forEach(function(ing){
    var name=String(ing[0]||'').trim(), amount=_mcV24Num_(ing[1])*qty, unit=ing[2]||'г';
    if(!name||amount<=0)return;
    var sub=_findSubDish_(name,idx.dishByNormName,idx.dishByLooseName);
    if(sub && sub.ing && sub.ing.length && path.indexOf(sub.code)<0){amount=_mcV24Num_(ing[3]!==undefined?ing[3]:ing[1])*qty; // п/ф в блюдо — по нетто
      
      var key=_prodKey_(name)+'|'+unit;
      var available=_mcV24Num_(pfStock[key]);
      var fromStock=Math.min(amount,Math.max(0,available));
      pfStock[key]=Math.max(0,available-fromStock);
      var remain=amount-fromStock;
      var node={level:level,taskType:'SEMI',code:sub.code,name:sub.name,required:amount,unit:unit,stockAvailable:fromStock,toProduce:remain,children:[],parentCode:code};
      var base=_subYield_(sub);
      if(remain>0.0001 && base>0){
        node.children=_mcV24BuildTreeChildren_(sub,remain/base,idx,pfStock,raw,nodes,path.concat(sub.code),level+1,sub.code,meta);
      }
      nodes.push(node);
      children.push(node);
    } else {
      var k=_prodKey_(name)+'|'+unit;
      raw[k]=(raw[k]||0)+amount;
      var rmeta=meta[k]||(meta[k]={name:name,unit:unit});
      rmeta.name=name;rmeta.unit=unit;
      children.push({level:level,taskType:'RAW',name:name,required:amount,unit:unit,toProduce:0});
    }
  });
  return {code:code,name:dish.name,qty:qty,children:children};
}
function _mcV24BuildTreeChildren_(dish,mult,idx,pfStock,raw,nodes,path,level,parentId,meta){
  var children=[];
  (dish.ing||[]).forEach(function(ing){
    var name=String(ing[0]||'').trim(), amount=_mcV24Num_(ing[1])*mult, unit=ing[2]||'г';
    if(!name||amount<=0)return;
    var sub=_findSubDish_(name,idx.dishByNormName,idx.dishByLooseName);
    if(sub && sub.ing && sub.ing.length && path.indexOf(sub.code)<0){amount=_mcV24Num_(ing[3]!==undefined?ing[3]:ing[1])*mult; // п/ф в блюдо — по нетто
      
      var key=_prodKey_(name)+'|'+unit, available=_mcV24Num_(pfStock[key]);
      var fromStock=Math.min(amount,Math.max(0,available));pfStock[key]=Math.max(0,available-fromStock);
      var remain=amount-fromStock;
      var node={level:level,taskType:'SEMI',code:sub.code,name:sub.name,required:amount,unit:unit,stockAvailable:fromStock,toProduce:remain,children:[],parentCode:parentId};
      var base=_subYield_(sub);
      if(remain>0.0001&&base>0)node.children=_mcV24BuildTreeChildren_(sub,remain/base,idx,pfStock,raw,nodes,path.concat(sub.code),level+1,sub.code,meta);
      nodes.push(node);children.push(node);
    } else {
      var k2=_prodKey_(name)+'|'+unit;raw[k2]=(raw[k2]||0)+amount;meta[k2]=meta[k2]||{name:name,unit:unit};children.push({level:level,taskType:'RAW',name:name,required:amount,unit:unit,toProduce:0});
    }
  });
  return children;
}

function getTTKProductionTree(code,qty,token){
  try{
    _requireAuth_(token,'kanban');
    var idx=_buildDishIndexes_(), q=_mcV24Num_(qty); if(!code||q<=0)return _fail_('VALIDATION','Укажите код ТТК и количество');
    if(!idx.dishByCode[code])return _fail_('NOT_FOUND','ТТК не найдена');
    var raw={},meta={},nodes=[],stock=_loadPfStockMap_();
    var tree=_mcV24BuildTree_(code,q,idx,stock,raw,nodes,[],0,null,meta);
    return _ok_({code:code,qty:q,tree:tree,dependencies:nodes,raw:Object.keys(raw).map(function(k){return {key:k,name:meta[k].name,unit:meta[k].unit,qty:raw[k]};})});
  }catch(e){return _failFrom_(e);}
}

function _mcV24CollectWeeklyItems_(fromDate,token){
  var plan=_mcV14Build_(fromDate,token,false), idx=_buildDishIndexes_();
  var roots=[];
  (plan.production||[]).filter(function(t){return String(t.taskType||'DISH')==='DISH';}).forEach(function(t){
    roots.push({code:t.code,name:t.name,qty:_mcV24Num_(t.qty),unit:t.unit||'порц.',productionDate:t.productionDate,dueTime:t.dueTime||'',banquets:t.banquets||[],source:'WEEKLY:'+plan.planId});
  });
  return {plan:plan,idx:idx,roots:roots};
}

function buildWeeklyTTKDependencyPlan(fromDate,token){
  try{
    _requireAuth_(token,'kanban');
    var pack=_mcV24CollectWeeklyItems_(fromDate,token), idx=pack.idx, stock=_loadPfStockMap_(), raw={},meta={},nodes=[];
    pack.roots.forEach(function(root){
      var treeNodes=[];_mcV24BuildTree_(root.code,root.qty,idx,stock,raw,treeNodes,[],0,root.code,meta);
      treeNodes.forEach(function(n){n.root=root;nodes.push(n);});
    });
    var grouped={};nodes.filter(function(n){return n.taskType==='SEMI'&&n.toProduce>0.0001;}).forEach(function(n){
      var key=(n.code||_prodKey_(n.name))+'|'+n.unit, g=grouped[key];
      if(!g)g=grouped[key]={code:n.code,name:n.name,unit:n.unit,qty:0,level:n.level,banquets:[],dates:[],roots:[]};
      g.qty+=n.toProduce;g.level=Math.min(g.level,n.level);
      if(n.root){(n.root.banquets||[]).forEach(function(id){if(g.banquets.indexOf(id)<0)g.banquets.push(id);});g.dates.push(n.root.productionDate);g.roots.push(n.root.code);}
    });
    var deps=Object.keys(grouped).map(function(k){var g=grouped[k];var date=g.dates.sort()[0]||pack.plan.weekFrom;var d=new Date(date+'T00:00:00');d.setDate(d.getDate()-1);return Object.assign(g,{productionDate:_mcV24Date_(d),status:'TODO'});});
    deps.sort(function(a,b){return a.productionDate.localeCompare(b.productionDate)||b.level-a.level||a.name.localeCompare(b.name,'ru');});
    var rawOut=Object.keys(raw).map(function(k){return {key:k,name:meta[k].name,unit:meta[k].unit,qty:raw[k]};});
    return _ok_({planId:pack.plan.planId,weekFrom:pack.plan.weekFrom,weekTo:pack.plan.weekTo,dependencies:deps,raw:rawOut,roots:pack.roots});
  }catch(e){return _failFrom_(e);}
}

function publishWeeklyTTKDependencyPlan(fromDate,token){
  try{
    _requireAuth_(token,'kanban');
    var built=buildWeeklyTTKDependencyPlan(fromDate,token), data=built.data||{};
    var planId=data.planId||('WP'+Date.now()), sh=_mcV24Sheet_(), now=new Date(), actor=_mcV20Actor_(token);
    var rows=(data.dependencies||[]).map(function(d){return [_mcV22Id_('DEP'),planId,'',d.productionDate,'',d.level,'SEMI',d.code,d.name,d.qty,d.unit,d.stockAvailable||0,d.qty,d.banquets.join(','),'TODO',now,actor,'TTK_DEPENDENCY'];});
    if(rows.length)sh.getRange(sh.getLastRow()+1,1,rows.length,18).setValues(rows);
    return _ok_({planId:planId,count:rows.length,dependencies:data.dependencies||[],raw:data.raw||[]});
  }catch(e){return _failFrom_(e);}
}

function getWeeklyTTKDependencyPlan(fromDate,token){
  try{
    _requireAuth_(token,'kanban');var sh=_mcV24Sheet_(),v=sh.getDataRange().getValues(),monday=_mcV24Date_(_mcV14Monday_(new Date(fromDate||new Date()))),out=[];
    for(var i=1;i<v.length;i++)if(String(v[i][1])===String('WP'+'' )||true){
      if(v[i][1]&&String(v[i][3]).slice(0,10)){out.push({dependencyId:v[i][0],planId:v[i][1],productionDate:v[i][3],level:v[i][5],taskType:v[i][6],code:v[i][7],name:v[i][8],qty:_mcV24Num_(v[i][9]),unit:v[i][10],stockAvailable:_mcV24Num_(v[i][11]),toProduce:_mcV24Num_(v[i][12]),banquets:v[i][13],status:v[i][14]});}
    }
    return _ok_({weekFrom:monday,rows:out});
  }catch(e){return _failFrom_(e);}
}
