// Идемпотентная миграция Core 100%. Не переписывает существующие данные.
function migrateCore100Schema_(){
  var changed=[];
  ['OPERATIONS','CASCADES','EVENTS','OPERATION_STEPS'].forEach(function(key){
    if(!CONFIG.SCHEMA[key]) return;
    var sheetName=CONFIG.SHEETS[key]; var sheet=getDatabase_().getSheetByName(sheetName);
    if(!sheet){ sheet=getDatabase_().insertSheet(sheetName); sheet.getRange(1,1,1,CONFIG.SCHEMA[key].length).setValues([CONFIG.SCHEMA[key]]); changed.push(key+'.CREATED'); return; }
    var last=sheet.getLastColumn();
    var headers=last?sheet.getRange(1,1,1,last).getValues()[0]:[];
    CONFIG.SCHEMA[key].forEach(function(h){
      if(headers.indexOf(h)===-1){sheet.getRange(1,headers.length+1).setValue(h);headers.push(h);changed.push(key+'.'+h);}
    });
  });
  return {ok:true,changed:changed};
}
