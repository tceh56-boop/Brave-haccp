// Тур по системе для инструкции: снимки с разметкой. node tour.js [группа...]
const {seedDemo}=require('./demo');const {openStand,mark,shoot,unmark}=require('./stand');
const ONLY=process.argv.slice(2);const W=(ms)=>new Promise(r=>setTimeout(r,ms));
const VIEW=v=>({u:['header','#view-'+v]});
(async()=>{const D=seedDemo();const E=D.B.E;
 const {browser,page}=await openStand(E,{viewport:{width:1000,height:3200},scale:2});
 const P=page, sh=(f,a,o)=>shoot(P,require('path').join(__dirname,'shots',f+'.png'),a,o), mk=(m,o)=>mark(P,m,o);
 async function login(role,i){const u=D.B.cred[role][i||0];await P.evaluate(()=>{try{localStorage.clear();}catch(e){}});await P.reload();await W(500);
  await P.evaluate(([id,n,pin])=>{pickUser(id,n);for(const k of pin)pinPress(k);doLogin();},[u.user_id,u.name,u.pin]);await W(900);}
 async function go(v){await P.evaluate(v=>navTo(v),v);await W(900);await P.evaluate(()=>scrollTo(0,0));}
 const G=n=>!ONLY.length||ONLY.indexOf(n)>=0;
 const groups={};
 // ---------- 1. Вход ----------
 groups.login=async()=>{
  await P.evaluate(()=>{try{localStorage.clear();}catch(e){}});await P.reload();await W(600);
  await mk([[{t:'Шефова Тест',tag:'button'},1]]);await sh('01_users',{u:['#loginScreen svg',{t:'Складов Тест',tag:'button'}]});
  const u=D.B.cred['ПОВАР'][0];await P.evaluate(([id,n])=>pickUser(id,n),[u.user_id,u.name]);await W(200);for(const k of u.pin.slice(0,3))await P.evaluate(k=>pinPress(k),k);
  await mk([['#pinDots',1],['#keypad',2],[{t:'Войти',in:'#keypad'},3],[{t:'Выбрать другого',tag:'button'},4]]);await sh('01_pin',{u:['#loginScreen svg','#pinBlock']},{pad:24});
  await login('ШЕФ-ПОВАР');await P.setViewportSize({width:560,height:3200});await W(300);await mk([['header button',1],['.who',2,'left']]);await sh('01_header','header',{pad:0});await P.setViewportSize({width:1000,height:3200});await W(300);
  await P.evaluate(()=>toggleMenu());await W(300);await mk([[{t:'Журналы',in:'#sideMenu'},1],[{t:'Управление',in:'#sideMenu'},2]]);await sh('01_menu',{x:0,y:0,w:600,h:600},{pad:0});await P.evaluate(()=>toggleMenu());await W(300);
 };
 // ---------- 2. Журналы ----------
 groups.journals=async()=>{await login('ПОВАР');await go('journals');
  await mk([[{t:'Журнал регистрации и контроля работы бактерицидной',in:'#view-journals',up:1},1],[{t:'норма 2…6',in:'#view-journals',n:0},2],[{t:'Подтвердить',in:'#view-journals',n:1},3]]);
  await sh('02_journals',{u:['header',{t:'Журнал учёта температурного режима',in:'#view-journals',n:3}]},{pad:6});
 };
 // ---------- 3. Задачи ----------
 groups.tasks=async()=>{await login('ПОВАР');await go('tasks');
  await mk([['#taskStatusFilter',1],[{t:'Критическое отклонение',in:'#tasksList',up:1},2],[{t:'Выполнено',in:'#tasksList',n:3},3],['#taskType',4],[{t:'Создать задачу',tag:'button'},5]]);
  await sh('03_tasks',VIEW('tasks'));
 };

 // ---------- Склад: приход по накладной (распознавание подменено ответом «Яндекса» для демо-накладной) ----------
 const OCR_ROWS=[['Товарная','накладная','№','МД-1043','от','20.10.2026'],['Поставщик:','ООО','«Мясной','двор»'],['1','Филе','куриное','охлаждённое','кг','5','380,00','1900,00'],['2','Говядина','лопатка','охлаждённая','кг','4','690,00','2760,00'],['3','Сливки','молочные','22','%','л','6','380,00','2280,00'],['Итого','6940,00']];
 const word=(t,x,y)=>({text:t,boundingBox:{vertices:[{x:x,y:y},{x:x+60,y:y},{x:x+60,y:y+18},{x:x,y:y+18}]}});
 const ocrBlocks=OCR_ROWS.map((r,i)=>({lines:[{words:r.map((t,j)=>word(t,40+j*110,100+i*40))}]}));
 const llm={document_type:'invoice',document_number:'МД-1043',document_date:'20.10.2026',supplier:'ООО «Мясной двор»',total:6940,recognition_confidence:0.9,warnings:[],items:[
  {line_number:1,raw_name:'Филе куриное охлаждённое',quantity:5,unit:'кг',price:380,sum:1900,confidence:0.92},{line_number:2,raw_name:'Говядина лопатка охлаждённая',quantity:4,unit:'кг',price:690,sum:2760,confidence:0.9},{line_number:3,raw_name:'Сливки молочные 22 %',quantity:6,unit:'л',price:380,sum:2280,confidence:0.88}]};
 let labelMode=false;const resp=o=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(o)});
 E.props.YANDEX_OCR_API_KEY='demo';E.props.YANDEX_FOLDER_ID='demo';
 E.ctx.UrlFetchApp.fetch=(url,o)=>{const p=o&&o.payload?JSON.parse(o.payload):{};
  if(/recognizeText$/.test(url))return labelMode?resp({result:{textAnnotation:{blocks:[],fullText:'Филе куриное охлаждённое\nДата изготовления 19.10.2026\nГоден до 25.10.2026\nХранить при 0…+4 °C'}}}):resp({result:{textAnnotation:{blocks:ocrBlocks,fullText:OCR_ROWS.map(r=>r.join(' ')).join('\n'),width:900,height:400}}});
  if(/completion/.test(url)){const sys=(p.messages&&p.messages[0].text)||'';const out=/проверяешь/.test(sys)?{ok:true,line_corrections:[],warnings:[]}:llm;return resp({result:{alternatives:[{message:{text:JSON.stringify(out)}}]}});}
  throw new Error('Внешние сервисы на стенде отключены');};
 const DOC=require('path').join(__dirname,'assets','invoice.jpg');
 groups.warehouse=async()=>{await login('КЛАДОВЩИК');await go('warehouse');
  await mk([['#invFile',1],[{t:'Распознать',in:'#whInvoiceBlock',tag:'button'},2],[{t:'Незавершённые приходы',tag:'button'},3]]);await sh('05_invoice_start','#whInvoiceBlock');
  await P.setInputFiles('#invFile',DOC);await P.click('#whInvoiceBlock button:has-text("Распознать")');await W(1500);
  // строка 1: этикетка производителя
  labelMode=true;await P.evaluate(()=>{inv.labelLine=1;});await P.setInputFiles('#invLabelFile',DOC);await W(1200);labelMode=false;
  const dates=await P.$$('#invEditor input[type=date]');console.log('   дат в форме',dates.length);
  // строки 2 и 3: даты с упаковки вручную (поля: дата документа, затем по 2 на строку)
  if(dates.length>=7){await dates[4].fill('2026-10-23');await dates[6].fill('2026-10-27');}
  await P.click('#invEditor button:has-text("Сохранить и проверить")');await W(900);
  await mk([[{t:'готов к проводке',in:'#invEditor'},1],[{t:'1. Филе куриное',in:'#invEditor',up:1},2,'left'],[{t:'Этикетка',in:'#invEditor',tag:'button',n:0},3],[{t:'не принимать',in:'#invEditor',tag:'label',n:0},4],[{t:'Сумма принимаемых строк',in:'#invEditor'},5],[{t:'Провести приход',tag:'button'},6]]);
  await sh('05_invoice_draft','#whInvoiceBlock',{maxH:3000});
  await P.click('#invEditor button:has-text("Провести приход")');await W(1500);
  await mk([[{t:'Партии приёмки',in:'#invEditor'},1,'left'],[{t:'Кол-во',in:'#invEditor',tag:'button',n:0},2],[{t:'Цена',in:'#invEditor',tag:'button',n:0},3]]);
  await sh('05_invoice_posted',{u:[{t:'Сумма принимаемых строк',in:'#invEditor'},{t:'Сливки молочные 22 %',in:'#invEditor',tag:'td'},{t:'Цена',in:'#invEditor',tag:'button',n:2}]});
 };
 groups.receive=async()=>{await login('КЛАДОВЩИК');await go('warehouse');
  await mk([['#scanLabelBtn',1],['#rcvBarcodeSearch',2],['#rcvProduct',3],[{u:['#rcvQty','#rcvPrice']},4],[{u:['#rcvProductionDate','#rcvExpiry']},5],['#rcvSupplier',6],[{t:'Оприходовать',tag:'button'},7]]);await sh('05_receive','#whReceiveBlock');
  await mk([['#whTransferBlock',1],['#whCreateProductBlock',2]]);await sh('05_transfer_newprod',{u:['#whTransferBlock','#whCreateProductBlock']});
  await mk([[{t:'Филе куриное охлаждённое',in:'#tblWarehouse',tag:'td',up:1},1]]);await sh('05_stock',{u:[{t:'Склад',in:'#view-warehouse',tag:'h2'},{t:'Говядина лопатка',in:'#tblWarehouse',tag:'td'}]});
  await mk([['#vsdStatusFilter',1],[{t:'Настройки «Меркурия»',tag:'button'},2]]);await sh('06_vsd','#whVsdBlock');
 };

 // ---------- Маркировка ----------
 groups.marking=async()=>{await login('ПОВАР');await go('marking');await W(400);
  const v=await P.$$eval('#markBatchId option',o=>o.map(x=>[x.value,x.textContent]));const pick=v.find(x=>/Филе куриное/.test(x[1]))||v[1];await P.selectOption('#markBatchId',pick[0]);
  await mk([['#markBatchId',1],['#markLabelQty',2],[{t:'Печать',in:'#view-marking',tag:'button'},3],[{t:'Вскрыть тару',tag:'button'},4],[{t:'Журнал маркировки',tag:'button'},5]]);await sh('07_marking_form',VIEW('marking'));
  await P.click('#view-marking button:has-text("Печать")');await W(900);await mk([['#printLabel',1]]);await sh('07_marking_label',{u:['#printLabel',{t:'Проверено',in:'#markResult',tag:'button'}]},{pad:16});
  P.__prompt='1';await P.evaluate(()=>{window.__pr=window.prompt;let i=0;window.prompt=(m,d)=>i++===0?'1':'2026-10-21 12:00';});await P.click('#view-marking button:has-text("Вскрыть тару")');await W(900);await P.evaluate(()=>{window.prompt=window.__pr;});
  await sh('07_marking_open','#markResult',{pad:16});
  await P.click('#view-marking button:has-text("Журнал маркировки")');await W(700);await sh('07_marking_journal','#markResult',{pad:12,maxH:900});
 };
 // ---------- Списание ----------
 groups.writeoff=async()=>{await login('ПОВАР');await go('writeoff');
  await mk([['#woProduct',1],['#woQty',2],['#woReason',3],[{t:'Списать',in:'#view-writeoff',tag:'button'},4]]);await sh('08_writeoff',VIEW('writeoff'));};
 // ---------- Производство ----------
 groups.production=async()=>{await login('ПОВАР');await go('production');
  await mk([['#prodParentType',1],['#prodParentSelect',2],['#prodWorkshopSelect',3],['#prodQty',4],[{t:'Создать задание',tag:'button'},5],[{t:'→ В работе',in:'#productionList',tag:'button'},6],[{t:'→ Готово',in:'#productionList',tag:'button',n:0},7],['#prodStatusFilter',8]]);
  await sh('09_production',VIEW('production'));};
 // ---------- Рецепты ----------
 groups.recipes=async()=>{await login('ШЕФ-ПОВАР');await go('recipes');
  await mk([[{t:'Блюда',in:'#recipesSubnav'},1],[{t:'Полуфабрикаты',in:'#recipesSubnav'},2],['#dishName',3],[{t:'Создать блюдо',tag:'button'},4],[{t:'Борщ с говядиной',in:'#dishesList'},5],[{t:'Состав/ТТК',in:'#dishesList',tag:'button',n:1},6]]);await sh('10_recipes',VIEW('recipes'));
  await P.click('#dishesList button:has-text("Состав/ТТК") >> nth=1');await W(900);
  await mk([['#recipeEditorCost',1],['#ingSelect',2],[{u:['#ingBrutto','#ingNetto']},3],[{t:'Добавить ингредиент',tag:'button'},4],['#tblRecipeLines',5]]);await sh('10_recipe_editor','#recipeEditorCard',{maxH:2200});};
 // ---------- ТТК ----------
 groups.ttk=async()=>{await login('ТЕХНОЛОГ_HACCP');await go('ttk');await W(500);
  await mk([[{t:'Техкарты ПФ',tag:'button'},1],[{t:'Импорт архива ТТК',tag:'button'},2],[{t:'Справочник нормативов',tag:'button'},3],[{t:'+ Новая ТТК',tag:'button'},4],['#ttkSearch',5],['#ttkStatusFilter',6],[{t:'Французская котлета',in:'#ttkCatalog',up:1},7]]);
  await sh('11_ttk_catalog',{u:['header',{t:'Французская котлета',in:'#ttkCatalog',up:1}]});
  await P.click('#ttkCatalog button:has-text("Открыть")');await W(1200);
  await mk([['#ttkStepper',1],['#ttkPane1',2]]);await sh('11_ttk_editor1','#ttkEditorCard',{maxH:1800});
  for(const t of ['Состав','Технология','HACCP','Утверждение']){const b=await P.$('#ttkStepper button:has-text("'+t+'")');if(b){await b.click();await W(700);await sh('11_ttk_step_'+t,'#ttkEditorCard',{maxH:2200});}}
  await go('ttk');await P.click('#view-ttk button:has-text("Импорт архива ТТК")');await W(900);await sh('11_ttk_import','#ttkImportCard',{maxH:2400});
  await go('ttk');await P.click('#view-ttk button:has-text("Справочник нормативов")');await W(900);await sh('11_ttk_norms','#techNormsCard',{maxH:1600});
  await go('ttk');await P.click('#view-ttk button:has-text("Техкарты ПФ")');await W(900);await sh('11_ttk_pf','#pfTechCard',{maxH:1400});
 };
 // ---------- План-меню ----------
 groups.planmenu=async()=>{await login('ШЕФ-ПОВАР');await go('planmenu');
  await mk([['#bqFile',1],[{t:'Распознать бланк',tag:'button'},2],[{u:['#evtName','#evtGuests']},3],[{t:'Создать мероприятие',tag:'button'},4],[{t:'Открыть',in:'#eventsList',tag:'button'},5]]);await sh('12_planmenu',VIEW('planmenu'));
  await P.click('#eventsList button:has-text("Открыть")');await W(900);await P.click('#view-planmenu button:has-text("Рассчитать потребность")');await W(900);
  await mk([['#evtGuestsEdit',1],[{u:['#evtDishSelect','#evtPortionsPerGuest']},2],['#tblEventItems',3],[{t:'Рассчитать потребность в сырье',tag:'button'},4],['#planMenuNeedsResult',5],[{t:'Создать заявки на нехватку',tag:'button'},6]]);await sh('12_event','#eventEditorCard',{maxH:2600});};
 // ---------- Закупки, инвентаризация ----------
 groups.purchasing=async()=>{await login('КЛАДОВЩИК');await go('purchasing');await mk([['#tblPurchasing',1]]);await sh('13_purchasing',VIEW('purchasing'));};
 groups.inventory=async()=>{await login('ПОВАР');await go('inventory');await W(600);
  await mk([['#invStatusLine',1],['#invProduct',2],['#invParticipok',3],['#invFactQty',4],[{t:'Внести строку',tag:'button'},5],['#tblInventoryLines',6],['#invCloseBtn',7]]);await sh('14_inventory',VIEW('inventory'));};
 // ---------- Цеха и оборудование ----------
 groups.workshops=async()=>{await login('ДИРЕКТОР');await go('workshops');
  await mk([[{t:'Цеха',in:'#workshopsSubnav'},1],[{t:'Оборудование',in:'#workshopsSubnav'},2],[{u:['#wsName','#wsType']},3],['#workshopsList',4]]);await sh('15_workshops',VIEW('workshops'),{maxH:1800});
  await P.click('#workshopsSubnav button:has-text("Оборудование")');await W(800);
  await mk([['#eqWorkshopFilter',1],[{t:'Журнал ТО',in:'#equipmentList',tag:'button',n:0},2]]);await sh('15_equipment',{u:['header',{t:'Журнал ТО',in:'#equipmentList',tag:'button',n:5}]});
  const b=await P.$('#equipmentList button:has-text("Журнал ТО")');if(b){await b.click();await W(800);await mk([['#eqMaintType',1],['#eqMaintDate',2],['#eqMaintNextCheck',3],[{t:'Записать событие',tag:'button'},4]]);await sh('15_maint','#eqMaintCard');}
 };

 // ---------- ППК (отдельный стенд: ППК ещё не утверждена) ----------
 groups.ppk=async()=>{const D2=seedDemo({ppkApproved:false});const st=await openStand(D2.B.E,{viewport:{width:1000,height:3200},scale:2});const Q=st.page;
  const lg=async role=>{const u=D2.B.cred[role][0];await Q.evaluate(()=>{try{localStorage.clear();}catch(e){}});await Q.reload();await W(500);await Q.evaluate(([id,n,pin])=>{pickUser(id,n);for(const k of pin)pinPress(k);doLogin();},[u.user_id,u.name,u.pin]);await W(900);};
  const s2=(f,a,o)=>shoot(Q,require('path').join(__dirname,'shots',f+'.png'),a,o), m2=m=>mark(Q,m);
  await lg('ТЕХНОЛОГ_HACCP');await Q.evaluate(()=>navTo('ppk'));await W(1500);
  await m2([['#ppkDashboard',1],['#wzSteps',2],[{t:'Собрать / обновить модель ППК',tag:'button'},3]]);await s2('16_ppk_top',{u:['header','#wzSteps']});
  const step=async(c,f,mk_,area,mh)=>{await Q.evaluate(c=>wzGo(c),c);await W(1200);if(mk_)await m2(mk_);await s2(f,area||'#wzCard',{maxH:mh||2400});};
  await step('enterprise','16_wz_enterprise',[['#wzE_template_code',1],[{t:'Ответственные лица',in:'#wzBody'},2],[{t:'Сохранить и перейти',tag:'button'},3]]);
  await step('premises','16_wz_premises',[[{t:'Пол, м²',in:'#wzBody',tag:'th'},1],[{t:'Предложить помещения',tag:'button'},2],[{t:'Своё помещение',in:'#wzBody'},3]]);
  await Q.evaluate(()=>wzGo('equipment'));await W(900);await Q.click('#wzBody .wz-tabs button:has-text("Горячий цех")');await W(900);
  await m2([['#wzBody .wz-tabs',1],[{t:'ТЕПЛОВОЕ',in:'#wzBody'},2],[{t:'ХОЛОДИЛЬНОЕ',in:'#wzBody'},3]]);await s2('16_wz_equipment','#wzCard',{maxH:1100});
  await m2([[{t:'Предложить типовое оснащение',tag:'button'},4],[{t:'Добавить из каталога',in:'#wzBody'},5]]);await s2('16_wz_equipment2',{u:[{t:'Предложить типовое оснащение',tag:'button'},{t:'Добавить',in:'#wzBody',tag:'button',n:1}]},{pad:14});
  await Q.evaluate(()=>wzGo('inventory'));await W(900);await Q.click('#wzBody .wz-tabs button:has-text("Мясо-рыбный")');await W(900);await m2([[{t:'Маркировка',in:'#wzBody',tag:'th'},1]]);await s2('16_wz_inventory','#wzCard',{maxH:2000});
  await step('disinfection','16_wz_disinfection',[[{t:'Средства',in:'#wzBody',tag:'b'},1],[{t:'Добавить средство',tag:'button'},2]],null,900);
  await m2([[{t:'Мясо-рыбный цех',in:'#wzBody',tag:'b'},3],[{t:'Рассчитать и сохранить',tag:'button'},4]]);await s2('16_wz_disinfection2',{u:[{t:'Мясо-рыбный цех',in:'#wzBody',tag:'b',up:1},{t:'Мясо-рыбный цех',in:'#wzBody',tag:'b',up:1}]},{pad:14});await m2([[{t:'Рассчитать и сохранить',tag:'button'},4]]);await s2('16_wz_disinfection3',{u:[{t:'Помещение',in:'#wzBody',tag:'label'},{t:'Рассчитать и сохранить',tag:'button'}]},{pad:14});
  await step('hazards','16_wz_hazards',[[{u:['#wzBody input[id^=wzH_l_]','#wzBody input[id^=wzH_m_]']},1],[{t:'Подтвердить',in:'#wzBody',tag:'button',n:0},2]],null,700);
  await step('controls','16_wz_controls');
  await step('journals','16_wz_journals',[[{t:'Создать журналы по оборудованию',tag:'button'},1]]);
  await step('document','16_wz_document',[[{t:'Печать',in:'#wzBody',tag:'button'},1],[{t:'PDF',in:'#wzBody',tag:'button'},2],[{t:'Утвердить нельзя',in:'#wzBody'},3]],null,900);
  await st.browser.close();
 };
 // ---------- Лаборатория, нормативы ----------
 groups.lab=async()=>{await login('ЛАБОРАНТ');await go('lab');
  await mk([[{u:['#labDefTarget','#labDefSource']},1],[{t:'Добавить в расписание',tag:'button'},2],['#labDefsList',3],['#labTestDef',4],['#labTestResult',5],[{t:'Сохранить результат',tag:'button'},6],['#labTestsList',7]]);await sh('17_lab',VIEW('lab'));};
 groups.rules=async()=>{await login('ТЕХНОЛОГ_HACCP');await go('rules');
  await mk([['#ruleType',1],[{u:['#ruleScopeType','#ruleScopeId']},2],[{u:['#ruleMin','#ruleUnit']},3],['#ruleSource',4],[{t:'Добавить норматив',tag:'button'},5],['#rulesList',6]]);await sh('18_rules',VIEW('rules'));};
 // ---------- Продукты и декларации ----------
 groups.compliance=async()=>{await login('ДИРЕКТОР');await go('compliance');
  await mk([['#compSubnav',1],['#gpSearch',2],['#orgProductSelect',3],[{t:'Проверить',tag:'button'},4]]);await sh('19_comp_products',VIEW('compliance'),{maxH:2600});
  for(const [t,f] of [['suppliers','19_comp_suppliers'],['declarations','19_comp_declarations'],['profiles','19_comp_profiles'],['dashboard','19_comp_dashboard']]){await P.evaluate(t=>showCompTab(t),t);await W(900);await sh(f,VIEW('compliance'),{maxH:2600});}
 };
 // ---------- Охрана труда ----------
 groups.safety=async()=>{await login('ПОВАР');await go('safety');await W(500);
  await mk([[{t:'Открыть',in:'#safetyAssignments',tag:'button'},1],['#safetyEmergency',2]]);await sh('20_safety',VIEW('safety'));
  await P.click('#safetyAssignments button:has-text("Открыть")');await W(1500);await mk([[{t:'ДА',in:'#safetyOutput',tag:'label',n:0},1],[{t:'Проверить тест',tag:'button'},2]]);await sh('20_safety_test','#safetyOutput',{pad:14});
  await P.check('#safetyOutput input[value="НЕТ"] >> nth=0');await P.check('#safetyOutput input[value="НЕТ"] >> nth=1');await P.click('#safetyOutput button:has-text("Проверить тест")');await W(900);await sh('20_safety_result',{u:['#safetyOutput','#safetyAssignments']},{pad:14});
 };
 // ---------- Главная ----------
 groups.dashboard=async()=>{await login('ДИРЕКТОР');await W(800);
  await mk([[{u:['#kpiWriteoffs','#kpiStock']},1],['#controlTowerCard',2],['#automationDecisionCard',3]]);await sh('21_dashboard_top',{u:['header','#automationDecisionCard']});
  await mk([[{t:'Критические остатки',in:'#view-dashboard',tag:'h2'},4],['#aiList',5]]);await sh('21_dashboard_bottom',{u:[{t:'Критические остатки',in:'#view-dashboard',tag:'h2'},'#aiList']},{pad:16});};
 // ---------- Экономика ----------
 groups.economics=async()=>{await login('ДИРЕКТОР');await go('economics');await W(500);
  await mk([['#economicsSubnav',1],[{t:'Обновить',in:'#view-economics',tag:'button'},2]]);await sh('22_eco_summary',VIEW('economics'));
  for(const [t,f] of [['sales','22_eco_sales'],['dishes','22_eco_pnl'],['analytics','22_eco_abcxyz'],['reports','22_eco_reports']]){await P.evaluate(t=>showEconomicsTab(t),t);await W(1000);
   if(t==='sales'){const b=await P.$('#view-economics button:has-text("Показать")');if(b){await b.click();await W(700);}}
   if(t==='dishes'){const b=await P.$('#view-economics button:has-text("Рассчитать")');if(b){await b.click();await W(900);}}
   if(t==='reports'){const b=await P.$('#view-economics button:has-text("Сформировать дневной")');if(b){await b.click();await W(900);}}
   await sh(f,VIEW('economics'),{maxH:2800});}
 };
 // ---------- Администрирование ----------
 groups.admin=async()=>{await login('ДИРЕКТОР');await go('users');
  await mk([['#usName',1],['#usRole',2],['#usPin',3],['#usLocations',4],[{t:'Создать',in:'#view-users',tag:'button'},5],[{t:'Сбросить PIN',tag:'button',n:3},6],[{t:'Деактивировать',tag:'button',n:3},7]]);await sh('23_users',{u:['header',{t:'Сбросить PIN',tag:'button',n:4}]});
  await go('notifsettings');await mk([['#notifType',1],['#notifLocationSelect',2],[{u:['#notifEnabled','#notifEmailEnabled']},3],['#notifRecipients',4],[{u:['#notifRepeatMinutes','#notifMaxRepeats']},5]]);await sh('23_notif',VIEW('notifsettings'));
  await go('ai');await P.fill('#aiChatInput','Какие продукты скоро закончатся?');await P.click('#view-ai button:has-text("→") >> nth=0');await W(1200);await sh('23_ai',VIEW('ai'));
  await go('integrations');await sh('23_integrations',VIEW('integrations'),{maxH:1400});
  await go('recovery');await sh('23_recovery',VIEW('recovery'));
 };
 for(const g of Object.keys(groups)) if(G(g)){console.log('==',g);try{await groups[g]();}catch(e){console.log('   ОШИБКА',g,e.message.split('\n')[0]);}}
 console.log('page errors',page.errs,'fails',[...new Set(page.__fails||[])].slice(0,8));await browser.close();})();
