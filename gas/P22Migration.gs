// P22 schema migration. Adds missing columns without rewriting existing business data.
function migrateP22Schema_(){
  var changed=[];
  ['EVENTS','P22_ERRORS','P22_RECOVERY','P21_JOURNAL_LINKS'].forEach(function(key){
    var sheet=getSheet_(key), expected=CONFIG.SCHEMA[key];
    var last=sheet.getLastColumn();
    var headers=last?sheet.getRange(1,1,1,last).getValues()[0]:[];
    expected.forEach(function(h){if(headers.indexOf(h)===-1){sheet.getRange(1,headers.length+1).setValue(h);headers.push(h);changed.push(key+'.'+h);}});
  });
  return {ok:true,changed:changed};
}
