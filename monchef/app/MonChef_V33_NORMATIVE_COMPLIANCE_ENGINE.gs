/**
 * MON CHEF V33 — NORMATIVE / HACCP COMPLIANCE ENGINE
 * Нормативная матрица: обязательные НПА отдельно от ГОСТ-методик.
 * Базовая действующая редакция для общепита с 01.09.2026:
 * СанПиН 2.3/2.4.4282-26.
 */
var MC_V33={
 NORM:'Нормативы_V33', REQ:'Требования_V33', CHECK:'Проверки_V33',
 CHANGE:'Изменения_Нормативов_V33'
};
function _v33Sheet_(n,h){var s=_book_().getSheetByName(n);if(!s){s=_book_().insertSheet(n);s.appendRow(h);s.setFrozenRows(1);}return s;}
function _v33Init_(){
 _v33Sheet_(MC_V33.NORM,['DocID','Class','Status','Number','Title','EffectiveFrom','EffectiveTo','Mandatory','SourceURL','Notes']);
 _v33Sheet_(MC_V33.REQ,['RequirementID','DocID','Ref','Title','Domain','Mandatory','ControlType','EvidenceType','Frequency','OwnerRole','Active','Notes']);
 _v33Sheet_(MC_V33.CHECK,['CheckID','RequirementID','ObjectType','ObjectID','CheckedAt','Result','Evidence','DeviationID','Responsible','Status','CreatedAt','CreatedBy']);
 _v33Sheet_(MC_V33.CHANGE,['ChangeID','DocID','DetectedAt','OldStatus','NewStatus','Summary','SourceURL','AppliedAt','AppliedBy']);
}
function _v33Rows_(n){var s=_book_().getSheetByName(n);if(!s)return[];var v=s.getDataRange().getValues();return v.length>1?v.slice(1):[];}
function _v33SeedNorms_(){
 _v33Init_();
 var s=_v33Sheet_(MC_V33.NORM,['DocID','Class','Status','Number','Title','EffectiveFrom','EffectiveTo','Mandatory','SourceURL','Notes']);
 if(s.getLastRow()>1)return;
 var rows=[
  ['SANPIN_4282_26','SANPIN','ACTIVE','СанПиН 2.3/2.4.4282-26','Санитарно-эпидемиологические требования к организации общественного питания населения','2026-09-01','2032-09-01',true,'https://publication.pravo.gov.ru/','Основная действующая санитарная база общепита'],
  ['SANPIN_3590_20','SANPIN','HISTORICAL','СанПиН 2.3/2.4.3590-20','Санитарно-эпидемиологические требования к организации общественного питания населения','2021-01-01','2026-09-01',true,'https://publication.pravo.gov.ru/','Историческая редакция; не использовать для новых проверок'],
  ['TRTS_021_2011','TECH_REG','ACTIVE','ТР ТС 021/2011','О безопасности пищевой продукции','2013-07-01','',true,'https://docs.eaeunion.org/','Обязательные требования безопасности пищевой продукции'],
  ['GOST_R_51705_1_2001','GOST','GUIDANCE','ГОСТ Р 51705.1-2001','Управление качеством пищевых продуктов на основе принципов ХАССП. Общие требования','2001-07-01','',false,'https://protect.gost.ru/','Методическая база; статус обязательности не присваивается автоматически'],
  ['GOST_R_ISO_22000_2019','GOST','GUIDANCE','ГОСТ Р ИСО 22000-2019','Системы менеджмента безопасности пищевой продукции','2020-01-01','',false,'https://protect.gost.ru/','Система менеджмента; используется как добровольная методическая рамка, если иное не установлено договором/НПА'],
  ['GOST_R_55889_2024','GOST','GUIDANCE','ГОСТ Р 55889-2024','Услуги общественного питания. Система менеджмента безопасности продукции общественного питания. Рекомендации по применению ГОСТ Р ИСО 22000-2019','2025-06-01','',false,'https://protect.gost.ru/','Отраслевая рекомендация для интеграции СМБПП'],
  ['GOST_31984_2012','GOST','GUIDANCE','ГОСТ 31984-2012','Услуги общественного питания. Общие требования','2013-07-01','',false,'https://protect.gost.ru/','Общие требования к услугам общественного питания']
 ];
 s.getRange(2,1,rows.length,rows[0].length).setValues(rows);
}
function _v33SeedRequirements_(){
 var s=_v33Sheet_(MC_V33.REQ,['RequirementID','DocID','Ref','Title','Domain','Mandatory','ControlType','EvidenceType','Frequency','OwnerRole','Active','Notes']);
 if(s.getLastRow()>1)return;
 var a=[
 ['REQ-HACCP-001','SANPIN_4282_26','п.4','Производственный контроль на принципах ХАССП','HACCP',true,'SYSTEM','PLAN+FACT','По утверждённому порядку','Ответственный за ППК',true,'Включает организационные мероприятия, лабораторные исследования и испытания'],
 ['REQ-HACCP-002','SANPIN_4282_26','п.4 / ТР ТС 021/2011 ст.10 ч.3','Выбор технологических процессов и контролируемых этапов','HACCP',true,'PROCESS','FLOW+ANALYSIS','При изменении технологии','Группа безопасности',true,''],
 ['REQ-HACCP-003','SANPIN_4282_26','п.4 / ТР ТС 021/2011 ст.10 ч.3','Последовательность и поточность операций для исключения загрязнения','FLOW',true,'PROCESS','FLOW+AUDIT','Постоянно','Шеф/технолог',true,''],
 ['REQ-HACCP-004','SANPIN_4282_26','п.4 / ТР ТС 021/2011 ст.10 ч.3','Определение опасностей и значимых опасностей','HAZARD',true,'RISK','HAZARD_ANALYSIS','При разработке и пересмотре','Группа безопасности',true,''],
 ['REQ-HACCP-005','SANPIN_4282_26','п.4 / ТР ТС 021/2011 ст.10 ч.3','Установление критических контрольных точек / мероприятий управления','CCP_OPRP',true,'CONTROL','HACCP_PLAN','При разработке и пересмотре','Группа безопасности',true,''],
 ['REQ-HACCP-006','SANPIN_4282_26','п.4','Мониторинг контролируемых этапов и пищевой продукции','MONITORING',true,'FACT','FACT','По плану мониторинга','Ответственный',true,''],
 ['REQ-HACCP-007','SANPIN_4282_26','п.4','Лабораторные исследования и испытания в составе ППК','LAB',true,'LAB','LAB_REPORT','По ППК','Ответственный за ППК',true,''],
 ['REQ-REC-001','SANPIN_4282_26','п.5','Приёмка только при наличии маркировки и товаросопроводительной документации','RECEIVING',true,'GATE','RECEIVING_RECORD','Каждая поставка','Приёмщик',true,''],
 ['REQ-SAN-001','SANPIN_4282_26','п.4','Уборка, мойка, дезинфекция, дезинсекция и дератизация','SANITATION',true,'TASK','TASK+FACT','По утверждённому графику','Ответственный за санитарию',true,''],
 ['REQ-HYG-001','SANPIN_4282_26','п.4','Соблюдение работниками правил личной гигиены','PERSONNEL',true,'GATE','CHECKLIST','Перед/в ходе смены','Ответственный смены',true,''],
 ['REQ-EQUIP-001','TRTS_021_2011','ст.10 ч.3','Функционирование технологического оборудования, обеспечивающее безопасность продукции','EQUIPMENT',true,'CONTROL','CHECKLIST+FACT','По ППК','Ответственный',true,''],
 ['REQ-TRACE-001','TRTS_021_2011','ст.10 / ГОСТ Р ИСО 22000-2019','Прослеживаемость сырья, партий и выпуска','TRACEABILITY',true,'TRACE','TRACE_CHAIN','Каждая партия','Склад/производство',true,'Юридическая обязанность вытекает из ТР ТС; ГОСТ используется как методическая рамка'],
 ['REQ-DOC-001','TRTS_021_2011','ст.10 ч.3','Документирование контролируемых этапов и результатов','DOCUMENTATION',true,'RECORD','FACT+DOC','По ППК','Ответственный за ППК',true,''],
 ['REQ-VER-001','GOST_R_ISO_22000_2019','разд. 8-10','Валидация, верификация, актуализация и улучшение СМБПП','VERIFICATION',false,'MANAGEMENT','AUDIT+REPORT','По программе верификации','Руководитель/группа безопасности',true,'ГОСТ-ориентированная функция; обязательность зависит от принятой системой организации рамки'],
 ['REQ-PDCA-001','GOST_R_55889_2024','PDCA','Цикл Планируй-Делай-Проверяй-Действуй для СМБПП общепита','MANAGEMENT',false,'MANAGEMENT','AUDIT+ACTION','Периодически','Руководитель',true,'Отраслевая рекомендация'],
 ['REQ-SERVICE-001','GOST_31984_2012','общие требования','Общие требования к услуге общественного питания','SERVICE',false,'REFERENCE','DOC+AUDIT','При актуализации','Руководитель',true,'']
 ];
 s.getRange(2,1,a.length,a[0].length).setValues(a);
}
function setupV33NormativeEngine(token){try{_requireAuth_(token,'journals');_v33SeedNorms_();_v33SeedRequirements_();return _ok_({initialized:true,activeBase:'СанПиН 2.3/2.4.4282-26',activeFrom:'2026-09-01'},'V33_SETUP');}catch(e){return _failFrom_(e);}}
function v33GetNormativeMatrix(token){try{_requireAuth_(token,'journals');_v33SeedNorms_();_v33SeedRequirements_();return _ok_({documents:_v33Rows_(MC_V33.NORM),requirements:_v33Rows_(MC_V33.REQ)},'V33_MATRIX');}catch(e){return _failFrom_(e);}}
function v33RecordComplianceCheck(json,token){var op=null;try{op=_beginOp_(token,'journals','V33_CHECK','Normative compliance check',null,null);}catch(e){return _failFrom_(e);}try{return _withLock_(function(){_v33SeedNorms_();_v33SeedRequirements_();var d=typeof json==='string'?JSON.parse(json||'{}'):(json||{});if(!d.requirementId||!d.result)throw new Error('requirementId и result обязательны');var id=d.checkId||'H33C-'+Utilities.getUuid();_v33Sheet_(MC_V33.CHECK,['CheckID','RequirementID','ObjectType','ObjectID','CheckedAt','Result','Evidence','DeviationID','Responsible','Status','CreatedAt','CreatedBy']).appendRow([id,d.requirementId,d.objectType||'',d.objectId||'',d.checkedAt?new Date(d.checkedAt):new Date(),String(d.result).toUpperCase(),d.evidence||'',d.deviationId||'',d.responsible||_mcSessionFullName_(op.session),'CLOSED',new Date(),_mcSessionFullName_(op.session)]);_audit_(op,'V33_CHECK','COMPLIANCE_CHECK',id,null,{requirementId:d.requirementId,result:d.result});_endOp_(op);return _ok_({checkId:id},op.id);});}catch(e){if(op)_endOp_(op,'FAILED');return _failFrom_(e,op&&op.id);}}
function v33BuildReadiness(token){try{_requireAuth_(token,'journals');_v33SeedNorms_();_v33SeedRequirements_();var req=_v33Rows_(MC_V33.REQ).filter(function(r){return r[10]!==false;});var checks=_v33Rows_(MC_V33.CHECK);var out=req.map(function(r){var c=checks.filter(function(x){return String(x[1])===String(r[0]);});var last=c.length?c[c.length-1]:null;return{requirementId:r[0],docId:r[1],ref:r[2],title:r[3],domain:r[4],mandatory:r[5]===true||String(r[5]).toUpperCase()==='TRUE',lastResult:last?last[5]:'NO_CHECK',lastCheckedAt:last?last[4]:'',hasEvidence:!!(last&&last[6]),checks:c.length};});return _ok_({activeNorm:'СанПиН 2.3/2.4.4282-26',requirements:out,mandatoryMissing:out.filter(function(x){return x.mandatory&&x.lastResult==='NO_CHECK';}).length},'V33_READINESS');}catch(e){return _failFrom_(e);}}
function v33GetCurrentNormativeInfo(token){try{_requireAuth_(token,'journals');_v33SeedNorms_();var docs=_v33Rows_(MC_V33.NORM);var now=new Date();var active=docs.filter(function(r){return String(r[2])==='ACTIVE';});return _ok_({asOf:now,active:active.map(function(r){return{number:r[3],title:r[4],from:r[5],to:r[6],mandatory:r[7]};}),note:'ГОСТ в матрице не объявляется обязательным без отдельного основания.'},'V33_CURRENT');}catch(e){return _failFrom_(e);}}
