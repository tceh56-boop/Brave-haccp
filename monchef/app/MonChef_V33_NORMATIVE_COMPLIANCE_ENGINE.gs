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
  ['GOST_R_51705_1_2001','GOST','HISTORICAL','ГОСТ Р 51705.1-2001','Управление качеством пищевых продуктов на основе принципов ХАССП. Общие требования','2001-07-01','2024-11-01',false,'https://protect.gost.ru/','Заменён ГОСТ Р 51705.1-2024 (карточка Росстандарта; нормативный аудит, ДОК_12)'],
  ['GOST_R_51705_1_2024','GOST','GUIDANCE','ГОСТ Р 51705.1-2024','Управление качеством и безопасностью пищевых продуктов на основе принципов ХАССП. Общие требования','2024-11-01','',false,'https://protect.gost.ru/','Заменил ГОСТ Р 51705.1-2001; дата введения — по карточке Росстандарта (найдено поиском, текст не открыт — ДОК_12)'],
  ['SP_2_3_6_4281_26','SANPIN','ACTIVE','СП 2.3.6.4281-26','Требования к торговым объектам и рынкам, реализующим пищевую продукцию (наименование сверить по официальной публикации)','2026-09-01','',false,'http://publication.pravo.gov.ru/document/0001202606020079','Постановление ГГСВ РФ от 02.06.2026 № 17; заменил СП 2.3.6.3668-20; применяется при реализации товаров (торговле) — ДОК_12'],
  ['PRIKAZ_MZ_29N_2021','ORDER','ACTIVE','Приказ Минздрава России от 28.01.2021 № 29н','Порядок обязательных предварительных и периодических медицинских осмотров работников (наименование сверить)','2021-04-01','2027-04-01',true,'','Медосмотры персонала (сноска к п. 24 СанПиН 2.3/2.4.4282-26); срок действия — по страницам Роспотребнадзора (ДОК_12)'],
  ['PRIKAZ_MSH_862_2022','ORDER','ACTIVE','Приказ Минсельхоза России от 13.12.2022 № 862','Ветеринарные правила организации работы по оформлению ветеринарных сопроводительных документов','','',true,'','В ред. приказа от 07.05.2025 № 317 (с 01.09.2025); оформление и гашение ВСД (ДОК_12)'],
  ['FZ_29_2000','LAW','ACTIVE','Федеральный закон от 02.01.2000 № 29-ФЗ','О качестве и безопасности пищевых продуктов','','',true,'http://www.kremlin.ru/acts/bank/14882','Вводится в действие со дня официального опубликования (ст. 30 п. 1). Текст сверен по копии КонсультантПлюс, ред. от 13.07.2020 (сохранена 03.06.2025): ст. 3, 22, 24, 25. Более поздние изменения не сверены.'],
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
 ['REQ-HACCP-002','SANPIN_4282_26','п.4 / ТР ТС 021/2011 ст.10 ч.3 п.1','Выбор технологических процессов и контролируемых этапов','HACCP',true,'PROCESS','FLOW+ANALYSIS','При изменении технологии','Группа безопасности',true,''],
 ['REQ-HACCP-003','SANPIN_4282_26','пп.4, 29, 30 / ТР ТС 021/2011 ст.10 ч.3 п.2','Последовательность и поточность операций для исключения загрязнения','FLOW',true,'PROCESS','FLOW+AUDIT','Постоянно','Шеф/технолог',true,''],
 ['REQ-HACCP-004','SANPIN_4282_26','п.4 / ТР ТС 021/2011 ст.11 ч.3 п.1','Определение опасностей и значимых опасностей','HAZARD',true,'RISK','HAZARD_ANALYSIS','При разработке и пересмотре','Группа безопасности',true,''],
 ['REQ-HACCP-005','SANPIN_4282_26','п.4 / ТР ТС 021/2011 ст.10 ч.3 п.3; ст.11 ч.3 пп.2, 3, 5','Установление критических контрольных точек / мероприятий управления','CCP_OPRP',true,'CONTROL','HACCP_PLAN','При разработке и пересмотре','Группа безопасности',true,''],
 ['REQ-HACCP-006','SANPIN_4282_26','п.4 / ТР ТС 021/2011 ст.11 ч.3 п.4','Мониторинг контролируемых этапов и пищевой продукции','MONITORING',true,'FACT','FACT','По плану мониторинга','Ответственный',true,''],
 ['REQ-HACCP-007','SANPIN_4282_26','п.4','Лабораторные исследования и испытания в составе ППК','LAB',true,'LAB','LAB_REPORT','По ППК','Ответственный за ППК',true,''],
 ['REQ-REC-001','SANPIN_4282_26','п.5','Приёмка только при наличии маркировки и товаросопроводительной документации','RECEIVING',true,'GATE','RECEIVING_RECORD','Каждая поставка','Приёмщик',true,''],
 ['REQ-SAN-001','SANPIN_4282_26','пп.21, 22, 26, 45, 46 / ТР ТС 021/2011 ст.10 ч.3 п.10; ст.11 ч.3 п.7','Уборка, мойка, дезинфекция, дезинсекция и дератизация','SANITATION',true,'TASK','TASK+FACT','По утверждённому графику','Ответственный за санитарию',true,''],
 ['REQ-HYG-001','SANPIN_4282_26','пп.24, 25, 31 / ТР ТС 021/2011 ст.10 ч.3 п.9','Соблюдение работниками правил личной гигиены','PERSONNEL',true,'GATE','CHECKLIST','Перед/в ходе смены','Ответственный смены',true,''],
 ['REQ-EQUIP-001','TRTS_021_2011','ст.10 ч.3 п.5','Функционирование технологического оборудования, обеспечивающее безопасность продукции','EQUIPMENT',true,'CONTROL','CHECKLIST+FACT','По ППК','Ответственный',true,''],
 ['REQ-TRACE-001','TRTS_021_2011','ст.10 ч.3 п.12 / ГОСТ Р ИСО 22000-2019','Прослеживаемость сырья, партий и выпуска','TRACEABILITY',true,'TRACE','TRACE_CHAIN','Каждая партия','Склад/производство',true,'Юридическая обязанность вытекает из ТР ТС; ГОСТ используется как методическая рамка'],
 ['REQ-RECALL-001','TRTS_021_2011','ст.5 ч.4; ст.18 чч.3, 4, 7, 8 / 29-ФЗ ст.3, 24, 25 / ГОСТ Р ИСО 22000-2019 п. 8.9.4, 8.9.5','Изъятие из обращения несоответствующей продукции: блокировка, учёт, решение, утилизация','TRACEABILITY',true,'TRACE','RECALL_RECORD+PDF','При выявлении несоответствия','Ответственный за ХАССП',true,'Отзыв продукции (V74): прослеживание вперёд, блокировка, решения, уведомления, PDF'],
 ['REQ-DOC-001','TRTS_021_2011','ст.10 ч.3 пп.6, 11','Документирование контролируемых этапов и результатов','DOCUMENTATION',true,'RECORD','FACT+DOC','По ППК','Ответственный за ППК',true,''],
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

/** Уточнённые ссылки реестра требований (15.11.2026): пункты сверены с текстом СанПиН 2.3/2.4.4282-26 и ТР ТС 021/2011.
 *  Меняется только строка, в которой осталась прежняя ссылка; ссылку, исправленную на предприятии вручную, не трогаем. */
var MC_V33_REF_FIX_ = [
  ['REQ-HACCP-002','п.4 / ТР ТС 021/2011 ст.10 ч.3','п.4 / ТР ТС 021/2011 ст.10 ч.3 п.1'],
  ['REQ-HACCP-003','п.4 / ТР ТС 021/2011 ст.10 ч.3','пп.4, 29, 30 / ТР ТС 021/2011 ст.10 ч.3 п.2'],
  ['REQ-HACCP-004','п.4 / ТР ТС 021/2011 ст.10 ч.3','п.4 / ТР ТС 021/2011 ст.11 ч.3 п.1'],
  ['REQ-HACCP-005','п.4 / ТР ТС 021/2011 ст.10 ч.3','п.4 / ТР ТС 021/2011 ст.10 ч.3 п.3; ст.11 ч.3 пп.2, 3, 5'],
  ['REQ-HACCP-006','п.4','п.4 / ТР ТС 021/2011 ст.11 ч.3 п.4'],
  ['REQ-SAN-001','п.4','пп.21, 22, 26, 45, 46 / ТР ТС 021/2011 ст.10 ч.3 п.10; ст.11 ч.3 п.7'],
  ['REQ-HYG-001','п.4','пп.24, 25, 31 / ТР ТС 021/2011 ст.10 ч.3 п.9'],
  ['REQ-EQUIP-001','ст.10 ч.3','ст.10 ч.3 п.5'],
  ['REQ-TRACE-001','ст.10 / ГОСТ Р ИСО 22000-2019','ст.10 ч.3 п.12 / ГОСТ Р ИСО 22000-2019'],
  ['REQ-DOC-001','ст.10 ч.3','ст.10 ч.3 пп.6, 11']
];
function _v33FixRefs_() {
  var sh = _book_().getSheetByName(MC_V33.REQ); if (!sh || sh.getLastRow() < 2) return { changed: 0, kept: 0, skipped: 'реестр требований пуст' };
  var v = sh.getDataRange().getValues(), h = v[0], ci = h.indexOf('RequirementID'), cr = h.indexOf('Ref'), changed = [], kept = [];
  if (ci < 0 || cr < 0) return { changed: 0, kept: 0, skipped: 'нет колонок RequirementID / Ref' };
  MC_V33_REF_FIX_.forEach(function (f) {
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][ci]) !== f[0]) continue;
      var cur = String(v[i][cr]);
      if (cur === f[2]) return;
      if (cur === f[1]) { sh.getRange(i + 1, cr + 1).setValue(f[2]); changed.push(f[0] + ': ' + f[1] + ' → ' + f[2]); }
      else kept.push(f[0] + ' (ссылка изменена на предприятии: ' + cur + ')');
      return;
    }
  });
  return { changed: changed.length, kept: kept.length, details: changed.concat(kept) };
}
