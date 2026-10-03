// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — Journals.gs (v2, ТЗ §14/§16/§21)
 * Журналы + автоматическое планирование записей по слотам смены — перенесённый паттерн
 * из Brave HACCP (computeSlotTimes_/generateAutoJournalSlots), адаптированный под
 * мультиточечную/мультицеховую схему.
 *
 * Неизменный дизайн-принцип Дениса, сохранённый и в v2: система НЕ заполняет журналы
 * сама (это была бы фальсификация) — она создаёт "ожидающие" слоты по расписанию, а
 * сотрудник подтверждает их одним тапом (или правит значение). v2 добавляет: лимиты
 * задаются в JOURNAL_DEFINITIONS отдельно на каждый журнал/точку/цех (НЕ единой
 * "универсальной нормой" на всю систему — ТЗ §16), а нарушение лимита не "чинится"
 * автоматически — создаётся JOURNAL_DEVIATIONS + CORRECTIVE_ACTIONS и уведомление;
 * решение и фактическое исправление остаются за человеком.
 *
 * v2 — ИСПРАВЛЕНА КРИТИЧЕСКАЯ ОШИБКА дедупликации: раньше ключ дедупликации был
 * journal_type + slot_time БЕЗ ДАТЫ. Из-за этого "занятый" вчерашний слот навсегда
 * блокировал генерацию сегодняшнего того же слота (10:00 "температура" за вчера ==
 * 10:00 "температура" за сегодня для старого ключа). Новый ключ:
 *   organization_id + location_id + workshop_id + journal_type + date + slot_time
 * — хранится явно в столбце dedup_key (Config.gs) для быстрого поиска.
 */

/**
 * Раунд 12 (P0.5, §46) — добавлен необязательный cascadeId (8-й параметр, в конце —
 * чтобы не менять позиции существующих аргументов ни у одного из 6 вызывающих). Записи,
 * созданные плановыми триггерами (авто-журналы по расписанию), законно вызываются без
 * cascadeId — у триггера нет вызова processOperation() и, соответственно, нет cascade;
 * записи, созданные ВНУТРИ мутирующего вызова API с сессией (ADD_JOURNAL_ENTRY,
 * SUBMIT_JOURNAL_VALUE, CONFIRM_AUTO_JOURNAL, списание с причиной брак/санитария,
 * закрытие инвентаризации), теперь передают его.
 */
function addJournalEntry_(locationId, journalType, value, userId, organizationId, workshopId, definitionId, cascadeId, ppkId, ppkVersion) {
  var entry = {
    journal_id: generateId_('JOURNALS'),
    organization_id: organizationId || '',
    location_id: locationId,
    workshop_id: workshopId || '',
    тип_журнала: journalType,
    definition_id: definitionId || '',
    значение: value,
    статус: 'заполнено',
    user_id: userId || '',
    дата: nowIso_(),
    deviation_id: '',
    cascade_id: cascadeId || '',
    ppk_id: ppkId || '',
    ppk_version: ppkVersion || '',
    тип_ответа: (arguments.length > 10 && arguments[10]) || 'ЧИСЛО',
    текст_вопроса: (arguments.length > 11 && arguments[11]) || '',
    ожидаемый_ответ: (arguments.length > 12 && arguments[12]) || 'ДА'
  };
  insertRow_('JOURNALS', entry);
  return entry;
}

function getJournalEntries_(locationId, journalType) {
  return findRows_('JOURNALS', function (r) {
    return (!locationId || r.location_id === locationId) && (!journalType || r.тип_журнала === journalType);
  });
}

/** hh:mm -> минуты от полуночи. */
function _hmToMin_(hm) {
  var parts = String(hm).split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function todayDateStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Etc/UTC', 'yyyy-MM-dd');
}

/**
 * Делит рабочие часы точки на N слотов, корректно обрабатывая смены через полночь
 * (например 10:00–00:00). Возвращает массив времён слотов в минутах от полуночи.
 */
function computeSlotTimes_(startHM, endHM, intervalsCount) {
  var start = _hmToMin_(startHM);
  var end = _hmToMin_(endHM);
  if (end <= start) end += 24 * 60; // смена через полночь
  var span = end - start;
  var slots = [];
  for (var i = 0; i < intervalsCount; i++) {
    slots.push(start + Math.round(span * i / intervalsCount));
  }
  return slots;
}

// ---------- JOURNAL_DEFINITIONS (ТЗ §16 — лимиты настраиваются, не хардкодятся) ----------

function getJournalDefinitions_(organizationId, locationId) {
  return findRows_('JOURNAL_DEFINITIONS', function (r) {
    return r.organization_id === organizationId && (!locationId || !r.location_id || r.location_id === locationId) &&
      r.статус !== 'архив';
  });
}

/**
 * P0.6 — НАЙДЕНО ПРИ АУДИТЕ: organization_id этой записи резолвится из session на
 * стороне API.gs (session.organization_id) — саму организацию подменить нельзя. Но
 * location_id/workshop_id/equipment_id приходят от клиента и раньше НИКАК не
 * проверялись: организация А могла создать у СЕБЯ (organization_id верный) норму/
 * лимит журнала, ссылающуюся на location_id/workshop_id/equipment_id ЧУЖОЙ организации
 * Б. Норма журнала — это конфигурация, которая затем реально управляет эскалациями
 * (CORRECTIVE_ACTIONS, уведомления вплоть до ДИРЕКТОРА), так что ссылка "наружу" из неё
 * — та же по сути дыра, что и остальные P0.1-подмены ID, только в конфигурационном
 * объекте, а не в складской/финансовой транзакции. session необязателен только для
 * внутренних вызовов (сейчас таких в проекте нет — createJournalDefinition_ вызывается
 * только из API.gs); прямой вызов из API ОБЯЗАН передавать session.
 *
 * Внешний P0-аудит, п.3 (продолжение, раунд 12) — org-проверка выше (assertOwnedByOrg_)
 * защищает от ЧУЖОЙ ОРГАНИЗАЦИИ, но не от ЧУЖОЙ ТОЧКИ ТОЙ ЖЕ организации: пользователь,
 * назначенный не на все точки (например, ДИРЕКТОР одной точки в мультилокационной сети),
 * мог создать норму журнала для точки/цеха/оборудования, к которым не имеет отношения.
 * Тот же класс, что уже закрыт для NOTIFICATION_SETTINGS/LAB_TEST_DEFINITIONS.
 */
function createJournalDefinition_(data, actorUserId, session) {
  if (!data.organization_id || !data.journal_type) throw new Error('createJournalDefinition_: organization_id и journal_type обязательны.');
  if (session) {
    if (data.location_id) {
      assertOwnedByOrg_(session, findOne_('LOCATIONS', 'location_id', data.location_id), 'LOCATIONS:' + data.location_id);
      assertLocationAllowed_(session, data.location_id, 'LOCATIONS:' + data.location_id);
    }
    if (data.workshop_id) {
      var ws = findOne_('WORKSHOPS', 'workshop_id', data.workshop_id);
      assertOwnedByOrg_(session, ws ? findOne_('LOCATIONS', 'location_id', ws.location_id) : null, 'WORKSHOPS:' + data.workshop_id);
      if (ws) assertLocationAllowed_(session, ws.location_id, 'WORKSHOPS:' + data.workshop_id);
    }
    if (data.equipment_id) {
      var eq = findOne_('EQUIPMENT', 'equipment_id', data.equipment_id);
      assertOwnedByOrg_(session, eq ? findOne_('LOCATIONS', 'location_id', eq.location_id) : null, 'EQUIPMENT:' + data.equipment_id);
      if (eq) assertLocationAllowed_(session, eq.location_id, 'EQUIPMENT:' + data.equipment_id);
    }
  }
  var def = {
    definition_id: generateId_('JOURNAL_DEFINITIONS'),
    organization_id: data.organization_id,
    location_id: data.location_id || '',
    workshop_id: data.workshop_id || '',
    journal_type: data.journal_type,
    название: data.название || data.journal_type,
    периодичность: data.периодичность || 'по_слотам_смены', // по_слотам_смены | разово_в_смену | ежедневно
    роль_ответственная: data.роль_ответственная || '',
    equipment_id: data.equipment_id || '',
    мин_норма: data.мин_норма === undefined ? '' : data.мин_норма,
    макс_норма: data.макс_норма === undefined ? '' : data.макс_норма,
    мин_предупреждение: data.мин_предупреждение === undefined ? '' : data.мин_предупреждение,
    макс_предупреждение: data.макс_предупреждение === undefined ? '' : data.макс_предупреждение,
    единица: data.единица || '',
    source_type: data.source_type || 'не_задано', // ттк | регламент | санпин | не_задано
    source_document: data.source_document || '',
    обязательность: data.обязательность !== false,
    статус: 'активен',
    ppk_id: data.ppk_id || '',
    ppk_version: data.ppk_version || '',
    тип_ответа: data.тип_ответа || 'ЧИСЛО',
    текст_вопроса: data.текст_вопроса || '',
    ожидаемый_ответ: data.ожидаемый_ответ || 'ДА',
    уровень_при_нет: data.уровень_при_нет || 'критическое',
    напомнить_за_минут: Number(data.напомнить_за_минут || 0)
  };
  insertRow_('JOURNAL_DEFINITIONS', def);
  auditLog_(actorUserId, 'Создан журнал/норма', 'JOURNAL_DEFINITIONS:' + def.definition_id, null, def.название, 'success');
  return def;
}

/**
 * Внешний P0-аудит, п.3 (продолжение, раунд 12) — та же защита от mass assignment, что
 * и в updateWorkshop_/updateEquipment_: organization_id/location_id/workshop_id/
 * equipment_id из клиентского patch теперь игнорируются — их можно задать только при
 * создании нормы (createJournalDefinition_, где они уже проверяются на принадлежность
 * своей организации/точке). Также добавлена проверка assertLocationAllowed_ на case,
 * когда у нормы задан свой location_id — иначе сотрудник одной точки мог изменить
 * (не только создать) норму, относящуюся к соседней точке той же организации.
 */
function updateJournalDefinition_(definitionId, patch, session) {
  return withLock_(function () { // P0.2 (ТЗ §18) — норма/лимит журнала влияет на все последующие оценки отклонений
    var def = findOne_('JOURNAL_DEFINITIONS', 'definition_id', definitionId);
    assertOwnedByOrg_(session, def, 'JOURNAL_DEFINITIONS:' + definitionId); // ТЗ P0.1
    if (def && def.location_id) assertLocationAllowed_(session, def.location_id, 'JOURNAL_DEFINITIONS:' + definitionId);
    var safePatch = _stripProtectedFields_(patch, ['organization_id', 'location_id', 'workshop_id', 'equipment_id']);
    updateRow_('JOURNAL_DEFINITIONS', def, safePatch);
    auditLog_(session.user_id, 'Изменена норма журнала', 'JOURNAL_DEFINITIONS:' + definitionId, null, JSON.stringify(safePatch), 'success', session.cascade_id);
    return findOne_('JOURNAL_DEFINITIONS', 'definition_id', definitionId);
  });
}

// ---------- Планирование "ожидающих" слотов ----------

/**
 * Планировщик журналов: сначала использует явные JOURNAL_TRIGGERS, а для старых
 * определений сохраняет обратную совместимость со схемой периодичности/слотов.
 * Рабочие часы берутся из SETTINGS точки: смена_начало, смена_конец,
 * слотов_в_смену. Никаких фактов в журнал не записывает.
 */
function getJournalTriggers_(organizationId, locationId, definitionId) {
  return findRows_('JOURNAL_TRIGGERS', function(t){
    return t.organization_id===organizationId && (!locationId || t.location_id===locationId) &&
      (!definitionId || t.definition_id===definitionId) && String(t.активен).toLowerCase()!=='нет' && t.активен!==false;
  });
}

function createJournalTrigger_(data, actorUserId, session) {
  if (!data.definition_id) throw new Error('Не указан definition_id журнала.');
  var def=findOne_('JOURNAL_DEFINITIONS','definition_id',data.definition_id);
  assertOwnedByOrg_(session, def, 'JOURNAL_DEFINITIONS:'+data.definition_id);
  if (def.location_id) assertLocationAllowed_(session, def.location_id, 'JOURNAL_DEFINITIONS:'+data.definition_id);
  var allowed=['НА_СТАРТЕ','НА_ФИНИШЕ','КАЖДЫЕ_N_МИНУТ','ФИКСИРОВАННОЕ_ВРЕМЯ','СЛОТЫ_СМЕНЫ'];
  var mode=data.режим || 'СЛОТЫ_СМЕНЫ';
  if(allowed.indexOf(mode)===-1) throw new Error('Недопустимый режим триггера: '+mode);
  var t={trigger_id:generateId_('JOURNAL_TRIGGERS'),organization_id:def.organization_id,location_id:def.location_id||data.location_id||session.location_id,workshop_id:def.workshop_id||data.workshop_id||'',definition_id:def.definition_id,journal_type:def.journal_type,название:data.название||def.название,режим:mode,время:data.время||'',интервал_минут:Number(data.интервал_минут||0),смещение_минут:Number(data.смещение_минут||0),активен:data.активен!==false,тип_ответа:data.тип_ответа||def.тип_ответа||'ЧИСЛО',текст_вопроса:data.текст_вопроса||def.текст_вопроса||'',ожидаемый_ответ:data.ожидаемый_ответ||def.ожидаемый_ответ||'ДА',уровень_при_нет:data.уровень_при_нет||def.уровень_при_нет||'критическое'};
  if(mode==='КАЖДЫЕ_N_МИНУТ' && t.интервал_минут<=0) throw new Error('Для КАЖДЫЕ_N_МИНУТ нужен интервал_минут > 0.');
  if(mode==='ФИКСИРОВАННОЕ_ВРЕМЯ' && !/^\d{1,2}:\d{2}$/.test(t.время)) throw new Error('Для ФИКСИРОВАННОЕ_ВРЕМЯ укажите время HH:mm.');
  insertRow_('JOURNAL_TRIGGERS',t); auditLog_(actorUserId,'Создан триггер журнала','JOURNAL_TRIGGERS:'+t.trigger_id,null,JSON.stringify(t),'success',session.cascade_id); return t;
}

function getJournalTriggerSchedule_(loc, def, triggers) {
  var startHM=_getLocationSetting_(loc.location_id,'смена_начало',loc.organization_id)||'10:00';
  var endHM=_getLocationSetting_(loc.location_id,'смена_конец',loc.organization_id)||'22:00';
  var start=_hmToMin_(startHM), end=_hmToMin_(endHM); if(end<=start) end+=1440;
  var out=[];
  triggers.forEach(function(t){
    var mode=t.режим||'СЛОТЫ_СМЕНЫ', times=[];
    if(mode==='НА_СТАРТЕ') times=[start+Number(t.смещение_минут||0)];
    else if(mode==='НА_ФИНИШЕ') times=[end+Number(t.смещение_минут||0)];
    else if(mode==='ФИКСИРОВАННОЕ_ВРЕМЯ') times=[_hmToMin_(t.время)];
    else if(mode==='КАЖДЫЕ_N_МИНУТ') { var step=Number(t.интервал_минут); for(var m=start+Number(t.смещение_минут||0);m<end;m+=step) times.push(m); }
    else { var count=Number(_getLocationSetting_(loc.location_id,'слотов_в_смену',loc.organization_id))||4; times=computeSlotTimes_(startHM,endHM,count); }
    times.forEach(function(tm){ out.push({trigger:t,slotMin:tm}); });
  });
  return out;
}

function generateJournalSlotsForLocation_(loc) {
  var dateStr=todayDateStr_();
  var defs=getJournalDefinitions_(loc.organization_id,loc.location_id).filter(function(d){return d.обязательность;});
  var created=[];
  defs.forEach(function(def){
    var triggers=getJournalTriggers_(loc.organization_id,loc.location_id,def.definition_id);
    if(!triggers.length){
      triggers=[{trigger_id:'LEGACY',режим:def.периодичность==='разово_в_смену'?'НА_СТАРТЕ':def.периодичность==='ежедневно'?'НА_СТАРТЕ':'СЛОТЫ_СМЕНЫ',тип_ответа:def.тип_ответа||'ЧИСЛО',текст_вопроса:def.текст_вопроса||'',ожидаемый_ответ:def.ожидаемый_ответ||'ДА',уровень_при_нет:def.уровень_при_нет||'критическое'}];
    }
    getJournalTriggerSchedule_(loc,def,triggers).forEach(function(x){
      var made=_createPendingIfNew_(loc.organization_id,loc.location_id,def.workshop_id,def.journal_type,def.definition_id,dateStr,x.slotMin,x.trigger.trigger_id,x.trigger);
      if(made) created.push(made);
    });
  });
  return created;
}

function _createPendingIfNew_(organizationId,locationId,workshopId,journalType,definitionId,dateStr,slotMin,triggerId,trigger) {
  var dedupKey=[organizationId,locationId,workshopId||'',journalType,dateStr,slotMin,triggerId||''].join('|');
  var exists=findRows_('AUTO_JOURNAL_PENDING',function(r){return r.dedup_key===dedupKey;})[0]; if(exists) return null;
  var pending={pending_id:generateId_('AUTO_JOURNAL_PENDING'),organization_id:organizationId,location_id:locationId,workshop_id:workshopId||'',journal_type:journalType,definition_id:definitionId||'',date:dateStr,slot_time:slotMin,статус:'ожидание',dedup_key:dedupKey,trigger_id:triggerId||'',тип_ответа:(trigger&&trigger.тип_ответа)||'ЧИСЛО',текст_вопроса:(trigger&&trigger.текст_вопроса)||'',ожидаемый_ответ:(trigger&&trigger.ожидаемый_ответ)||'ДА',уровень_при_нет:(trigger&&trigger.уровень_при_нет)||'критическое'};
  insertRow_('AUTO_JOURNAL_PENDING',pending); return pending;
}

function getPendingAutoJournals_(locationId) { return findRows_('AUTO_JOURNAL_PENDING',function(r){return r.location_id===locationId&&r.статус==='ожидание';}); }

/**
 * Сотрудник подтверждает слот, вводя РЕАЛЬНОЕ измеренное значение (система никогда не
 * подставляет его сама). Если для этого журнала настроены лимиты (JOURNAL_DEFINITIONS),
 * значение проверяется против них:
 *   - в пределах нормы            → просто запись в JOURNALS;
 *   - в "предупредительной" зоне  → запись + уведомление ответственному, без принудительного
 *                                    корректирующего действия;
 *   - за критическим пределом     → запись + JOURNAL_DEVIATIONS + CORRECTIVE_ACTIONS
 *                                    (статус "ожидание", назначается ответственной роли) +
 *                                    уведомление (email + внутреннее).
 * Если лимиты НЕ настроены — система не имеет права придумывать норму: значение просто
 * сохраняется, отклонение не оценивается, и в ответе явно возвращается предупреждение
 * "лимит не настроен" — администратору стоит донастроить JOURNAL_DEFINITIONS.
 */
function confirmAutoJournal_(pendingId, value, userId, session) {
  return withLock_(function () { // P0.2 (ТЗ §18) — запись + оценка лимита + возможное открытие отклонения как одна операция
    var pending = findOne_('AUTO_JOURNAL_PENDING', 'pending_id', pendingId);
    if (session) assertOwnedByLocation_(session, pending, 'AUTO_JOURNAL_PENDING:' + pendingId); // ТЗ P0.1
    else if (!pending) throw new Error('Ожидающая запись не найдена: ' + pendingId);
    if (value === undefined || value === null || value === '') {
      throw new Error('Не указано измеренное значение. Система не может подтвердить журнал без реального измерения (ТЗ §16).');
    }
    var defForEntry=findOne_('JOURNAL_DEFINITIONS','definition_id',pending.definition_id)||{};
    var entry = addJournalEntry_(pending.location_id, pending.journal_type, value, userId, pending.organization_id, pending.workshop_id, pending.definition_id, session ? session.cascade_id : '', defForEntry.ppk_id, defForEntry.ppk_version, pending.тип_ответа, pending.текст_вопроса, pending.ожидаемый_ответ);
    updateRow_('AUTO_JOURNAL_PENDING', pending, { статус: 'подтверждено' });

    pending._session = session || null; var evalResult = _evaluateJournalValue_(pending, entry, value, userId);
    return { entry: entry, оценка: evalResult };
  });
}

/** То же самое, но без предварительного "ожидающего" слота — ручная разовая запись с оценкой лимитов. */
function submitJournalValue_(data, userId, session) {
  return withLock_(function () { // P0.2 (ТЗ §18)
    if (!data.definition_id) {
      var entry = addJournalEntry_(data.location_id, data.journal_type, data.value, userId, data.organization_id, data.workshop_id, '', session ? session.cascade_id : '', data.ppk_id || '', data.ppk_version || '');
      return { entry: entry, оценка: { лимит_настроен: false, сообщение: 'Лимит не настроен. Требуется подтверждение ответственного лица.' } };
    }
    var def = findOne_('JOURNAL_DEFINITIONS', 'definition_id', data.definition_id);
    if (session) assertOwnedByOrg_(session, def, 'JOURNAL_DEFINITIONS:' + data.definition_id); // ТЗ P0.1
    else if (!def) throw new Error('Норма журнала не найдена: ' + data.definition_id);
    var entry2 = addJournalEntry_(data.location_id, def.journal_type, data.value, userId, def.organization_id, def.workshop_id, def.definition_id, session ? session.cascade_id : '', def.ppk_id || '', def.ppk_version || '');
    var evalResult = _evaluateJournalValue_({ organization_id: def.organization_id, location_id: data.location_id, workshop_id: def.workshop_id, _session: session || null }, entry2, data.value, userId, def);
    return { entry: entry2, оценка: evalResult };
  });
}

function _evaluateJournalValue_(pending, entry, value, userId, defArg) {
  var def = defArg || (pending.definition_id ? findOne_('JOURNAL_DEFINITIONS', 'definition_id', pending.definition_id) : null);
  if (!def || (String(pending.тип_ответа||def.тип_ответа||'ЧИСЛО').toUpperCase() !== 'ДА_НЕТ' && def.мин_норма === '' && def.макс_норма === '' && def.мин_предупреждение === '' && def.макс_предупреждение === '')) {
    return { лимит_настроен: false, сообщение: 'Срок/лимит не настроен. Требуется подтверждение ответственного лица.' };
  }
  var responseType=String(pending.тип_ответа||def.тип_ответа||'ЧИСЛО').toUpperCase();
  var level = null;
  var violatedLimit = null;
  if(responseType==='ДА_НЕТ') {
    var normalized=String(value).trim().toUpperCase();
    if(normalized!=='ДА' && normalized!=='НЕТ') throw new Error('Для журнала типа ДА_НЕТ допустим только ответ ДА или НЕТ.');
    if(normalized!==String(pending.ожидаемый_ответ||def.ожидаемый_ответ||'ДА').trim().toUpperCase()) {
      level=pending.уровень_при_нет||def.уровень_при_нет||'критическое'; violatedLimit='ожидаемый_ответ';
    }
  } else {
    var v = Number(value);
    if(isNaN(v)) throw new Error('Для числового журнала требуется фактическое измеренное число.');
  // P0.6 — НАЙДЕНЫ И ИСПРАВЛЕНЫ ДВЕ СВЯЗАННЫЕ ОШИБКИ в определении "какой именно предел
  // нарушен" (поле предел_нарушен ниже):
  //   1) "Ложный ноль" — было "Number(def.мин_норма) && v < ...", а Number(0) в JS —
  //      ложь. Для журнала с легитимной нижней границей РОВНО 0 (например, минимальная
  //      температура холодильника 0°C) выражение всегда считало "мин_норма не задана" и
  //      приписывало нарушение к макс_норма, даже когда факт нарушения был именно про
  //      минимум.
  //   2) предел_нарушен раньше ВСЕГДА сравнивался с мин_норма/макс_норма (критическими
  //      порогами), даже для уровня "предупреждение" — то есть для отклонения в
  //      предупредительной зоне (между мин_предупреждение и мин_норма, например) поле
  //      могло не отражать реально сработавший порог вообще, а просто дефолтиться в
  //      "макс_норма", потому что критический минимум формально не был нарушен.
  // Теперь порог, который реально сработал, фиксируется В ТОТ ЖЕ МОМЕНТ, когда
  // определяется level — по той паре порогов, что действительно относится к этому уровню.
  if (responseType!=='ДА_НЕТ' && def.мин_норма !== '' && v < Number(def.мин_норма)) {
    level = 'критическое'; violatedLimit = 'мин_норма';
  } else if (responseType!=='ДА_НЕТ' && def.макс_норма !== '' && v > Number(def.макс_норма)) {
    level = 'критическое'; violatedLimit = 'макс_норма';
  } else if (responseType!=='ДА_НЕТ' && def.мин_предупреждение !== '' && v < Number(def.мин_предупреждение)) {
    level = 'предупреждение'; violatedLimit = 'мин_предупреждение';
  } else if (responseType!=='ДА_НЕТ' && def.макс_предупреждение !== '' && v > Number(def.макс_предупреждение)) {
    level = 'предупреждение'; violatedLimit = 'макс_предупреждение';
  }
  }
  if (!level) return { лимит_настроен: true, отклонение: false };

  var deviation = {
    deviation_id: generateId_('JOURNAL_DEVIATIONS'),
    journal_id: entry.journal_id,
    definition_id: def.definition_id,
    уровень: level,
    значение: value,
    предел_нарушен: violatedLimit,
    дата: nowIso_(),
    статус: 'открыто',
    corrective_action_id: ''
  };
  insertRow_('JOURNAL_DEVIATIONS', deviation);
  // Секондарные фичи, раунд 2 (Архитектура v4 §2, Events.gs) — DEVIATION_CREATED.
  _emitEventSafe_({ organizationId: pending.organization_id, locationId: pending.location_id, type: 'DEVIATION_CREATED', source: 'backend', entityType: 'JOURNAL_DEVIATIONS', entityId: deviation.deviation_id, operationId: '', payload: { journalId: entry.journal_id, level: level, value: value, violatedLimit: violatedLimit } });
  // P0.6 — НАЙДЕНА И ИСПРАВЛЕНА ОШИБКА, ЛОМАВШАЯ ЛЮБОЕ ОТКЛОНЕНИЕ ЦЕЛИКОМ: entry —
  // это объект, только что возвращённый addJournalEntry_ через insertRow_, у которого
  // (как и у любого свежесозданного через insertRow_ объекта, см. Database.gs) НЕТ
  // __row — он проставляется только при чтении через findOne_/findRows_. updateRow_
  // требует __row и бросает исключение при его отсутствии — то есть КАЖДЫЙ РАЗ, когда
  // введённое значение реально нарушало лимит (что и есть весь смысл этой функции),
  // весь вызов падал с ошибкой ДО того, как уведомление/корректирующее действие
  // успевали создаться, и клиент получал INTERNAL_ERROR вместо честной фиксации
  // отклонения. Обнаружено только сейчас, потому что ни один более ранний раунд не
  // писал тест, реально пересекающий порог лимита (только "лимит не настроен"/
  // "в пределах нормы" сценарии) — сам факт отклонения журнала был, по сути, никогда
  // не задействован. Перечитываем запись через findOne_ (как и везде в проекте)
  // ПЕРЕД updateRow_, вместо использования уже устаревшей ссылки entry.
  var entryRow = findOne_('JOURNALS', 'journal_id', entry.journal_id);
  updateRow_('JOURNALS', entryRow, { deviation_id: deviation.deviation_id });

  var actionId = '';
  if (level === 'критическое') {
    var action = {
      action_id: generateId_('CORRECTIVE_ACTIONS'),
      deviation_id: deviation.deviation_id,
      описание: 'Критическое отклонение по журналу "' + def.название + '": значение ' + value + ' ' + (def.единица || '') + '. Требуется корректирующее действие согласно ' + (def.source_document || 'внутреннему регламенту') + '.',
      source_document: def.source_document || '',
      ответственный_роль: def.роль_ответственная || 'ШЕФ-ПОВАР',
      ответственный_id: '',
      статус: 'ожидание',
      результат: '',
      дата: nowIso_()
    };
    insertRow_('CORRECTIVE_ACTIONS', action);
    // P0.6 — тот же класс ошибки, что и на entry чуть выше: deviation тоже только что
    // создан через insertRow_ (строка 291) и тоже без __row — перечитываем перед update.
    var deviationRow = findOne_('JOURNAL_DEVIATIONS', 'deviation_id', deviation.deviation_id);
    updateRow_('JOURNAL_DEVIATIONS', deviationRow, { corrective_action_id: action.action_id });
    actionId = action.action_id;
    // Секондарные фичи, раунд 1 (Архитектура v4 §6, Tasks.gs) — та же корректирующая
    // задача теперь появляется и в единой таблице TASKS (витрина поверх уже
    // существующего CORRECTIVE_ACTIONS, не замена).
    _createTaskForCorrectiveAction_(pending.organization_id, pending.location_id, action.action_id,
      'Критическое отклонение: ' + def.название, action.описание, action.ответственный_роль, userId);

    // Fail-safe HACCP: критическое нарушение журнала автоматически становится
    // критической ситуацией. Система не придумывает норматив — использует уже
    // рассчитанный JOURNAL_DEFINITIONS и оставляет решение человеку.
    if (typeof createCriticalIncident_ === 'function') {
      try {
        createCriticalIncident_({
          entityType: 'JOURNAL', entityId: entry.journal_id,
          severity: 'КРИТИЧЕСКОЕ',
          title: 'Критическое отклонение HACCP: ' + def.название,
          description: 'Измерение ' + value + ' ' + (def.единица || '') + ', нарушен предел ' + violatedLimit + '.',
          requiredAction: action.описание,
          haccpFlag: true, ppkId: def.ppk_id || '',
          deviationId: deviation.deviation_id,
          responsibleRole: action.ответственный_роль,
          priority: 'критический'
        }, pending._session || {organization_id:pending.organization_id, location_id:pending.location_id, user_id:userId, cascade_id:''});
      } catch (incidentError) {
        // Критический HACCP-контур fail-closed: если инцидент не создан,
        // нельзя сообщать об успешной обработке критического отклонения.
        throw new Error('Критическое отклонение зафиксировано, но аварийный инцидент не создан: ' + incidentError.message);
      }
    }
  }

  // P0.6 — НАЙДЕНА И ИСПРАВЛЕНА ОШИБКА: обе ветки тернарного оператора здесь буквально
  // отправляли ОДИН И ТОТ ЖЕ тип уведомления (JOURNAL_DEVIATION) независимо от уровня —
  // "предупреждение" маршрутизировалось и подсчитывалось системой как настоящее
  // критическое отклонение. Новый тип JOURNAL_DEVIATION_WARNING (Config.gs) — раздельная
  // маршрутизация/получатели для двух реально разных по срочности событий.
  notify_(pending.organization_id, pending.location_id,
    level === 'критическое' ? CONFIG.NOTIFICATION_TYPES.JOURNAL_DEVIATION : CONFIG.NOTIFICATION_TYPES.JOURNAL_DEVIATION_WARNING,
    'Отклонение (' + level + ') в журнале "' + def.название + '": ' + value + ' ' + (def.единица || '') + ' — вне нормы.',
    'journal_deviation|' + deviation.deviation_id);
  auditLog_(userId, 'Отклонение журнала', 'JOURNALS:' + entry.journal_id, def.мин_норма + '..' + def.макс_норма, value, level === 'критическое' ? 'critical' : 'warning');

  return { лимит_настроен: true, отклонение: true, уровень: level, deviation_id: deviation.deviation_id, corrective_action_id: actionId };
}

function completeCorrectiveAction_(actionId, result, userId, session) {
  return withLock_(function () { // P0.2 (ТЗ §18) — закрытие действия + закрытие отклонения как одна операция
    var action = findOne_('CORRECTIVE_ACTIONS', 'action_id', actionId);
    if (!action) throw new Error('Корректирующее действие не найдено: ' + actionId);
    if (session) {
      // ТЗ P0.1 — action не хранит organization_id напрямую, org резолвится через ровно
      // ОДИН из двух источников (см. P0.6, Config.gs::SCHEMA.CORRECTIVE_ACTIONS): либо
      // deviation_id → JOURNAL_DEVIATIONS → JOURNALS.organization_id (критическое
      // отклонение введённого значения), либо pending_id → AUTO_JOURNAL_PENDING, у
      // которой organization_id/location_id есть напрямую (пропущенное измерение,
      // escalateOverdueJournals_) — раньше проверялся ТОЛЬКО первый путь, из-за чего
      // корректирующее действие по просрочке (после того, как эта функция начала их
      // создавать) вообще не могло быть закрыто ни при какой сессии: findOne_ по пустому
      // deviation_id вернул бы null, а assertOwnedByOrg_(session, null, ...) отказывает
      // ВСЕГДА, безусловно (fail-closed).
      var scopeEntity = null;
      if (action.deviation_id) {
        var deviationForScope = findOne_('JOURNAL_DEVIATIONS', 'deviation_id', action.deviation_id);
        scopeEntity = deviationForScope ? findOne_('JOURNALS', 'journal_id', deviationForScope.journal_id) : null;
      } else if (action.pending_id) {
        scopeEntity = findOne_('AUTO_JOURNAL_PENDING', 'pending_id', action.pending_id);
      }
      assertOwnedByOrg_(session, scopeEntity, 'CORRECTIVE_ACTIONS:' + actionId);
    }
    updateRow_('CORRECTIVE_ACTIONS', action, { статус: 'выполнено', результат: result, ответственный_id: userId || action.ответственный_id });
    var deviation = findOne_('JOURNAL_DEVIATIONS', 'deviation_id', action.deviation_id);
    if (deviation) updateRow_('JOURNAL_DEVIATIONS', deviation, { статус: 'закрыто' });
    auditLog_(userId, 'Выполнено корректирующее действие', 'CORRECTIVE_ACTIONS:' + actionId, null, result, 'success', session ? session.cascade_id : '');
    return { статус: 'выполнено' };
  });
}

function getDeviations_(organizationId, onlyOpen) {
  return findRows_('JOURNAL_DEVIATIONS', function (r) {
    if (onlyOpen && r.статус !== 'открыто') return false;
    if (!organizationId) return true;
    var journal = findOne_('JOURNALS', 'journal_id', r.journal_id);
    return journal && journal.organization_id === organizationId;
  });
}

// ---------- Напоминания и просрочка (ТЗ §21 — только напоминают, никогда не подставляют значение) ----------

/** Слоты, чьё время уже наступило (30+ минут назад), но всё ещё "в ожидании" — напоминание, не автозаполнение. */
function remindPendingJournals_() {
  var pending = findRows_('AUTO_JOURNAL_PENDING', function (r) { return r.статус === 'ожидание'; });
  var todayMin = _hmToMin_(Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Etc/UTC', 'HH:mm'));
  pending.forEach(function (p) {
    if (p.date !== todayDateStr_()) return;
    if (Number(p.slot_time) % 1440 > todayMin - 30) return; // слот ещё не наступил либо только что
    notify_(p.organization_id, p.location_id, CONFIG.NOTIFICATION_TYPES.JOURNAL_OVERDUE,
      'Напоминание: не заполнен журнал "' + p.journal_type + '" (слот ' + p.date + ' ' + Math.floor(p.slot_time / 60) + ':' + ('0' + (p.slot_time % 60)).slice(-2) + ').',
      'journal_reminder|' + p.pending_id);
  });
}

/**
 * Слоты за ПРОШЛЫЕ дни, всё ещё "в ожидании" — точно пропущены, эскалация с созданием
 * корректирующего действия.
 *
 * P0.6 — НАЙДЕНО ПРИ АУДИТЕ: докстринг всегда обещал "эскалацию с созданием
 * корректирующего действия", но до этого раунда функция реально делала только
 * уведомление + смену статуса на "просрочено" + запись в аудит — CORRECTIVE_ACTIONS
 * НИКОГДА не создавался. Пропущенное измерение (например, никто не проверил
 * температуру холодильника вовремя) молча оставалось просто уведомлением, которое
 * можно закрыть/пропустить, без обязательного назначенного действия с ответственным —
 * то же самое "заявлено, но не реализовано", что запрещено сдавать без явной пометки
 * по правилам этого раунда. Теперь создаётся настоящий CORRECTIVE_ACTIONS (через
 * pending_id — см. Config.gs::SCHEMA.CORRECTIVE_ACTIONS, у пропущенного слота нет
 * JOURNAL_DEVIATIONS, отклонять нечего, значения не было вовсе), назначенный роли
 * ответственного за этот журнал (JOURNAL_DEFINITIONS.роль_ответственная, если норма
 * настроена) — так же, как критическое отклонение уже делает в _evaluateJournalValue_.
 */
function escalateOverdueJournals_() {
  var today = todayDateStr_();
  var overdue = findRows_('AUTO_JOURNAL_PENDING', function (r) { return r.статус === 'ожидание' && r.date < today; });
  overdue.forEach(function (p) {
    updateRow_('AUTO_JOURNAL_PENDING', p, { статус: 'просрочено' });

    var def = p.definition_id ? findOne_('JOURNAL_DEFINITIONS', 'definition_id', p.definition_id) : null;
    var action = {
      action_id: generateId_('CORRECTIVE_ACTIONS'),
      deviation_id: '',
      pending_id: p.pending_id,
      описание: 'Пропущена запись журнала "' + p.journal_type + '" за ' + p.date + ' (слот ' + Math.floor(p.slot_time / 60) + ':' + ('0' + (p.slot_time % 60)).slice(-2) + ') — измерение не было выполнено вовремя. Требуется зафиксировать причину и, если нужно, фактическое измерение задним числом согласно ' + (def && def.source_document ? def.source_document : 'внутреннему регламенту') + '.',
      source_document: def ? (def.source_document || '') : '',
      ответственный_роль: (def && def.роль_ответственная) || 'ШЕФ-ПОВАР',
      ответственный_id: '',
      статус: 'ожидание',
      результат: '',
      дата: nowIso_()
    };
    insertRow_('CORRECTIVE_ACTIONS', action);
    // Секондарные фичи, раунд 1 (Архитектура v4 §6, Tasks.gs) — та же логика, что и
    // в _evaluateJournalValue_ выше: витрина в единую таблицу TASKS.
    _createTaskForCorrectiveAction_(p.organization_id, p.location_id, action.action_id,
      'Пропущено измерение: ' + p.journal_type, action.описание, action.ответственный_роль, null);

    notify_(p.organization_id, p.location_id, CONFIG.NOTIFICATION_TYPES.JOURNAL_OVERDUE,
      'Просрочена запись журнала "' + p.journal_type + '" за ' + p.date + ' — не была заполнена вовремя.',
      'journal_overdue|' + p.pending_id);
    auditLog_(null, 'Просрочен журнал', 'AUTO_JOURNAL_PENDING:' + p.pending_id, null, action.action_id, 'warning');
  });
}
