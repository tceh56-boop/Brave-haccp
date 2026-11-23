/** MON CHEF V36 — TTK MASTER + RECIPE GRAPH
 * Source of truth: Google Drive TTK files.
 * Does not silently approve imported data. Import status is REVIEW until validated.
 */
var MC_V36={
 MASTER:'ТТК_Master_V36', ING:'ТТК_Состав_V36', PROC:'ТТК_Технология_V36', LINK:'ТТК_Связи_V36', ALIAS:'ТТК_Алиасы_V36', LOG:'ТТК_Импорт_V36'
};
var MC_V36_HEADERS={
 MASTER:['TTK_ID','DriveFileID','DriveURL','FileName','DrivePath','Category','Subcategory','Type','ProductName','Yield','Format','PrimaryRaw','DocumentDate','PrintDate','FileHash','SourceFormat','ParseStatus','ValidationStatus','ImportedAt','LastSeenAt','Version','Notes'],
 ING:['TTK_ID','LineNo','RawName','Unit','GrossQty','NetQty','CookedQty','NetPerYield','IsSemiFinished','MatchedTTK_ID','MatchStatus','SourceRow'],
 PROC:['TTK_ID','StepNo','OperationText','TemperatureText','TimeText','StorageText','PackagingText','SourceRow'],
 LINK:['LinkID','ParentTTK_ID','ChildTTK_ID','ChildName','LinkType','Qty','Unit','Confidence','MatchMethod','Status','CreatedAt'],
 ALIAS:['Alias','CanonicalName','TTK_ID','Type','Status','Comment'],
 LOG:['RunID','DriveFolderID','StartedAt','FinishedAt','Scanned','Imported','Updated','Skipped','Errors','Status','Notes']
};
function _v36Sheet_(n,h){var s=_book_().getSheetByName(n);if(!s){s=_book_().insertSheet(n);s.getRange(1,1,1,h.length).setValues([h]);s.setFrozenRows(1);}return s;}
function _v36Init_(){Object.keys(MC_V36_HEADERS).forEach(function(k){_v36Sheet_(MC_V36[k],MC_V36_HEADERS[k]);});}
function setupV36TtkMaster(token){try{_requireAuth_(token,'journals');_v36Init_();return _ok_({initialized:true,sheets:Object.keys(MC_V36).map(function(k){return MC_V36[k];})},'V36_SETUP');}catch(e){return _failFrom_(e);}}
function _v36Norm_(s){return String(s||'').toLowerCase().replace(/ё/g,'е').replace(/п\s*[/\\-]?\s*ф/g,'пф').replace(/[«»"'`]/g,'').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();}
function _v36Hash_(text){var b=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8);return b.map(function(x){x=x<0?x+256:x;var h=x.toString(16);return h.length===1?'0'+h:h;}).join('');}
function _v36Id_(prefix,key){return prefix+'-'+_v36Hash_(key).substring(0,16).toUpperCase();}
function _v36Rows_(sheet){var s=_book_().getSheetByName(sheet);if(!s||s.getLastRow()<2)return[];return s.getRange(2,1,s.getLastRow()-1,s.getLastColumn()).getValues();}
function _v36Path_(file){var parts=[];var p=file.getParents();while(p.hasNext()){var f=p.next();parts.unshift(f.getName());}return parts.join(' / ');}
function _v36CellText_(row,i){return row && row[i]!==undefined && row[i]!==null?String(row[i]).trim():'';}
function _v36XmlRows_(text){
  var root=XmlService.parse(text).getRootElement();
  var ss=XmlService.getNamespace('urn:schemas-microsoft-com:office:spreadsheet');
  var ws=root.getChildren('Worksheet',ss)[0];
  if(!ws) throw new Error('Worksheet не найден');
  var table=ws.getChild('Table',ss); if(!table) throw new Error('Table не найден');
  var out=[]; table.getChildren('Row',ss).forEach(function(r){
    var cells=[], col=1;
    r.getChildren('Cell',ss).forEach(function(c){
      var idx=c.getAttribute('Index',ss); if(idx) col=Number(idx.getValue());
      var d=c.getChild('Data',ss); cells[col-1]=d?d.getText():''; col++;
    });
    out.push(cells);
  }); return out;
}
function _v36FirstAfterLabel_(rows,label){
  for(var i=0;i<rows.length;i++){
    var r=rows[i]; for(var j=0;j<r.length;j++) if(String(r[j]||'').trim()===label){
      for(var k=j+1;k<r.length;k++) if(String(r[k]||'').trim()) return String(r[k]).trim();
      for(var q=i+1;q<Math.min(i+3,rows.length);q++) for(var z=0;z<rows[q].length;z++) if(String(rows[q][z]||'').trim()) return String(rows[q][z]).trim();
    }
  } return '';
}
function _v36Extract_(file){
  var name=file.getName(), blob=file.getBlob(), text=blob.getDataAsString('UTF-8'), rows=_v36XmlRows_(text);
  var title=_v36FirstAfterLabel_(rows,'Наименование блюда:'), yieldText=_v36FirstAfterLabel_(rows,'Выход в готовом виде:'), format=_v36FirstAfterLabel_(rows,'Формат подачи:'), raw=_v36FirstAfterLabel_(rows,'Основное сырьё:'), printDate='';
  rows.forEach(function(r){for(var i=0;i<r.length;i++){var t=String(r[i]||'').trim();if(t.indexOf('Дата печати:')===0)printDate=t.replace('Дата печати:','').trim();}});
  var header=-1, hmap={};
  for(var i=0;i<rows.length;i++){
    var r=rows[i].map(function(x){return String(x||'').trim();});
    if(r.indexOf('№')>=0 && r.indexOf('Наименование')>=0){header=i;r.forEach(function(v,ix){if(v)hmap[v]=ix;});break;}
  }
  var ingredients=[];
  if(header>=0){
    var nameCol=hmap['Наименование'], unitCol=hmap['Ед. изм.'], grossCol=hmap['Вес брутто'], netCol=hmap['Вес нетто'], cookedCol=hmap['Вес готового продукта'], perCol=hmap['Вес нетто на'];
    for(var j=header+1;j<rows.length;j++){
      var r=rows[j], n=String(r[nameCol]||'').trim(), no=String(r[0]||'').trim();
      if(/^Технология приготовления/i.test(r.join(' '))||r.some(function(x){return String(x||'').trim()==='Технология приготовления и оформления блюда';})) break;
      if(!n){if(ingredients.length) break; continue;}
      if(/^\d+\s*$/.test(no)) ingredients.push({line:no,name:n,unit:String(r[unitCol]||'').trim(),gross:String(r[grossCol]||'').trim(),net:String(r[netCol]||'').trim(),cooked:String(r[cookedCol]||'').trim(),perYield:String(r[perCol]||'').trim(),row:j+1});
    }
  }
  var techStart=-1;
  for(var k=0;k<rows.length;k++){if(rows[k].some(function(x){return String(x||'').trim()==='Технология приготовления и оформления блюда';})){techStart=k+1;break;}}
  var tech=[];
  if(techStart>=0){for(var q=techStart;q<rows.length;q++){var t=rows[q].map(function(x){return String(x||'').trim();}).filter(Boolean).join(' ');if(t)tech.push({text:t,row:q+1});}}
  return {title:title||name.replace(/\.xls$/i,''),yieldText:yieldText,format:format,raw:raw,printDate:printDate,ingredients:ingredients,technology:tech,rows:rows};
}
function _v36Category_(path){var parts=path.split(' / '), names=parts.slice(); var rootIdx=-1; for(var i=0;i<names.length;i++) if(/^\d+\s+/.test(names[i])){rootIdx=i;break;} return {category:rootIdx>=0?names[rootIdx]:(names.length>1?names[names.length-2]:''),subcategory:rootIdx>=0&&names.length>rootIdx+2?names[rootIdx+1]:'',type:rootIdx>=0&&names.length>rootIdx+3?names[rootIdx+2]:''};}
function _v36IsPF_(name,path){return /полуфабрик|\bп\s*[/\\-]?\s*ф\b|\bпф\b/i.test(name+' '+path);}
function _v36Num_(x){if(x===null||x===undefined||x==='')return '';var n=Number(String(x).replace(/\s/g,'').replace(',','.'));return isFinite(n)?n:String(x);}
function _v36Upsert_(sheet,keyCol,key,values){var s=_book_().getSheetByName(sheet), data=s.getDataRange().getValues(), idx=-1;for(var i=1;i<data.length;i++){if(String(data[i][keyCol-1])===String(key)){idx=i+1;break;}}if(idx<0){s.appendRow(values);return s.getLastRow();}s.getRange(idx,1,1,values.length).setValues([values]);return idx;}
function _v36CollectFiles_(folder,out,limit){
  var files=folder.getFiles(); while(files.hasNext() && out.length<limit) out.push(files.next());
  if(out.length>=limit)return;
  var subs=folder.getFolders(); while(subs.hasNext()&&out.length<limit)_v36CollectFiles_(subs.next(),out,limit);
}
function v36ImportDriveFolder(folderId,token,limit){var op=null;try{op=_beginOp_(token,'journals','V36_IMPORT','Import TTK from Google Drive',null,null);}catch(e){return _failFrom_(e);}try{return _withLock_(function(){_v36Init_();var fid=folderId||'1j0_1g9T78Hns_lBLxvQKdvwadJtVeD7d', max=Number(limit||1000), folder=DriveApp.getFolderById(fid), all=[];_v36CollectFiles_(folder,all,max);var ing=_book_().getSheetByName(MC_V36.ING),proc=_book_().getSheetByName(MC_V36.PROC),now=new Date(),seen=0,imp=0,skip=0,err=0,notes=[];var imap={};_v36Rows_(MC_V36.MASTER).forEach(function(x){imap[String(x[0])]=x;});all.forEach(function(f){if(seen>=max)return;seen++;var nm=f.getName();if(!/\.xls$|\.xlsx$/i.test(nm)){skip++;return;}try{var path=_v36Path_(f),id=_v36Id_('TTK',f.getId()),hash=_v36Hash_(f.getBlob().getBytes().map(function(b){return String.fromCharCode(b<0?b+256:b);}).join('')),ext=/\.xlsx$/i.test(nm)?'XLSX':'XLS_SPREADSHEETML',data=null;if(ext==='XLS_SPREADSHEETML')data=_v36Extract_(f);var cat=_v36Category_(path),title=data?data.title:nm.replace(/\.xlsx?$/i,''),mvals=[id,f.getId(),f.getUrl(),nm,path,cat.category,cat.subcategory,cat.type,title,data?data.yieldText:'',data?data.format:'',data?data.raw:'',data?'': '',data?data.printDate:'',hash,ext,data?'PARSED':'METADATA_ONLY','REVIEW',now,now,'1.0',''];_v36Upsert_(MC_V36.MASTER,1,id,mvals);if(data){var iv=ing.getDataRange().getValues();for(var rr=iv.length-1;rr>=1;rr--)if(String(iv[rr][0])===id)ing.deleteRow(rr+1);data.ingredients.forEach(function(x){ing.appendRow([id,x.line,x.name,x.unit,_v36Num_(x.gross),_v36Num_(x.net),_v36Num_(x.cooked),_v36Num_(x.perYield),_v36IsPF_(x.name,path),'','',''+x.row]);});var pv=proc.getDataRange().getValues();for(var pp=pv.length-1;pp>=1;pp--)if(String(pv[pp][0])===id)proc.deleteRow(pp+1);data.technology.forEach(function(x,ix){proc.appendRow([id,ix+1,x.text,'','','','',x.row]);});}imp++;}catch(ex){err++;notes.push(nm+': '+String(ex));}});var log=_book_().getSheetByName(MC_V36.LOG);log.appendRow([op.id,fid,now,new Date(),seen,imp,0,skip,err,err?'PARTIAL':'OK',notes.slice(0,20).join('\n')]);_endOp_(op);return _ok_({folderId:fid,scanned:seen,imported:imp,updated:0,skipped:skip,errors:err,notes:notes.slice(0,20)},op.id);});}catch(e){if(op)_endOp_(op,'FAILED');return _failFrom_(e,op&&op.id);}}
function v36BuildRecipeLinks(token){try{_requireAuth_(token,'journals');_v36Init_();var masters=_v36Rows_(MC_V36.MASTER), ings=_v36Rows_(MC_V36.ING), aliases=_v36Rows_(MC_V36.ALIAS), map={};masters.forEach(function(m){map[_v36Norm_(m[8])]=m[0];});aliases.forEach(function(a){if(String(a[4]).toUpperCase()!=='DISABLED'&&a[1])map[_v36Norm_(a[0])]=a[2]||map[_v36Norm_(a[1])];});var links=_book_().getSheetByName(MC_V36.LINK), old=links.getDataRange().getValues();for(var i=old.length-1;i>=1;i--)links.deleteRow(i+1);var out=0,unmatched=[];ings.forEach(function(x){var n=_v36Norm_(x[2]), child=map[n];if(child&&child!==x[0]){links.appendRow([_v36Id_('LINK',x[0]+'|'+child+'|'+x[1]),x[0],child,x[2],'INGREDIENT_AS_TTK',x[5]||x[4],x[3],'1','EXACT_NORMALIZED','REVIEW',new Date()]);out++;}else if(_v36IsPF_(x[2],'')){unmatched.push({parent:x[0],name:x[2],line:x[1]});}});return _ok_({linksCreated:out,unmatchedSemiFinished:unmatched.length,unmatched:unmatched.slice(0,200)},'V36_LINKS');}catch(e){return _failFrom_(e);}}
function v36GetDashboard(token){try{_requireAuth_(token,'journals');_v36Init_();var m=_v36Rows_(MC_V36.MASTER),i=_v36Rows_(MC_V36.ING),p=_v36Rows_(MC_V36.PROC),l=_v36Rows_(MC_V36.LINK);return _ok_({masterCount:m.length,ingredientRows:i.length,processRows:p.length,links:l.length,parsed:m.filter(function(x){return x[16]==='PARSED';}).length,review:m.filter(function(x){return x[17]!=='APPROVED';}).length,semiFinishedLinks:l.filter(function(x){return /ПФ|полуфабрик/i.test(String(x[3]));}).length,master:m.slice(0,50)},'V36_DASH');}catch(e){return _failFrom_(e);}}
