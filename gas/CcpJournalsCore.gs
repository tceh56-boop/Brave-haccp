// ЦЕХ — CcpJournalsCore.gs
// Журналы контроля из ККТ/КТ, принятых технологом в ТТК блюда и техкартах ПФ.
//
// Цепочка: предложение ККТ (TTK_CCP_PROPOSALS) → решение технолога → контроль и предел
// в черновике ППК → утверждение ППК → журнал (JOURNAL_DEFINITIONS) с нормой из предела.
// Журналы создаются только для УТВЕРЖДЁННОЙ ППК: контроль из черновика ещё не действует.
// При утверждении новой версии журналы ККТ прежней версии уходят в архив.
//
// Периодичность берётся из ККТ:
//  - «каждая партия» → периодичность «по_партии»: запись ожидается при выпуске каждой
//    партии блюда/ПФ (createCcpBatchPending_ вызывается из _completeProduction_), а не
//    по слотам смены;
//  - «каждые N ч» → триггер КАЖДЫЕ_N_МИНУТ; «2 раза в смену» → начало и конец смены;
//  - PRP (аллергены) → вопрос ДА/НЕТ раз в смену;
//  - приёмка сырья из ТТК журнал не получает: это общий журнал приёмки, а не блюда.

var CCP_BATCH_PERIODICITY = 'по_партии';

function _cjSchedule_(frequency) {
  var f = String(frequency || '').toLowerCase();
  if (/парти/.test(f)) return { periodicity: CCP_BATCH_PERIODICITY, triggers: [] };
  var h = f.match(/кажд\S*\s+(\d+(?:[.,]\d+)?)\s*ч/);
  if (h) return { periodicity: 'по_слотам_смены', triggers: [{ режим: 'КАЖДЫЕ_N_МИНУТ', интервал_минут: Math.round(Number(h[1].replace(',', '.')) * 60) }] };
  if (/2 раза в смену/.test(f)) return { periodicity: 'по_слотам_смены', triggers: [{ режим: 'НА_СТАРТЕ', смещение_минут: 30 }, { режим: 'НА_ФИНИШЕ', смещение_минут: -60 }] };
  return { periodicity: 'разово_в_смену', triggers: [{ режим: 'НА_СТАРТЕ', смещение_минут: 30 }] };
}

function _cjLimitText_(l) {
  if (!l) return '';
  var a = [];
  if (l.min_value !== '' && l.min_value !== null && l.min_value !== undefined) a.push('не ниже ' + l.min_value);
  if (l.max_value !== '' && l.max_value !== null && l.max_value !== undefined) a.push('не выше ' + l.max_value);
  return a.join(', ') + (a.length && l.unit ? ' ' + l.unit : '');
}

function _cjParent_(proposal) {
  var isPf = proposal && proposal.parent_type === 'PF';
  var e = proposal ? (isPf ? getSemiFinishedById_(proposal.dish_id) : findOne_('DISHES', 'dish_id', proposal.dish_id)) : null;
  return { type: isPf ? 'PF' : 'DISH', id: proposal ? proposal.dish_id : '', name: e ? e.название : '' };
}

/**
 * Журналы для утверждённой ППК: по одному на каждый подтверждённый контроль из ТТК/техкарт
 * ПФ (кроме приёмки). Повторный вызов не дублирует. Журналы ККТ прежних версий — в архив.
 */
function generateCcpJournals_(data, session) {
  return withLock_(function () {
    var ppk = data.ppkId ? findOne_('PPK_VERSIONS', 'ppk_id', data.ppkId) : getCurrentPpk_(session.organization_id);
    if (!ppk) throw new Error('Нет утверждённой ППК.');
    assertOwnedByOrg_(session, ppk, 'PPK_VERSIONS:' + ppk.ppk_id);
    if (ppk.status !== 'APPROVED') throw new Error('Журналы ККТ создаются только для утверждённой ППК (статус ' + ppk.status + ').');
    var controls = findRows_('PPK_CONTROLS', function (c) { return c.ppk_id === ppk.ppk_id && c.status === 'CONFIRMED' && String(c.source || '').indexOf('TTK_PROPOSAL:') === 0; });
    var out = { ppk_id: ppk.ppk_id, created: [], existing: 0, skipped: [], archived: 0 };
    controls.forEach(function (c) {
      var proposal = findOne_('TTK_CCP_PROPOSALS', 'proposal_id', String(c.source).split(':')[1]);
      if (proposal && proposal.step_type === 'RECEIVING') { out.skipped.push(c.control_name + ': приёмка — общий журнал приёмки'); return; }
      var src = 'PPK_CONTROL:' + c.control_id;
      var existing = findRows_('JOURNAL_DEFINITIONS', function (d) { return d.organization_id === ppk.organization_id && d.source_document === src && d.статус !== 'архив'; })[0];
      if (existing) { out.existing++; return; }
      var limit = c.critical_limit_ref ? findOne_('PPK_CRITICAL_LIMITS', 'limit_id', c.critical_limit_ref) : null;
      var parent = _cjParent_(proposal);
      var sch = _cjSchedule_(c.frequency);
      var isPrp = c.point_type === 'PRP';
      var def = createJournalDefinition_({
        organization_id: ppk.organization_id, location_id: c.location_id || session.location_id, journal_type: 'ККТ_' + (proposal ? proposal.step_type : 'КОНТРОЛЬ'),
        название: c.point_type + ': ' + c.control_name + (parent.name ? ' — ' + parent.name : ''),
        периодичность: isPrp ? 'разово_в_смену' : sch.periodicity, роль_ответственная: c.responsible_role || 'ШЕФ-ПОВАР',
        мин_норма: limit ? limit.min_value : '', макс_норма: limit ? limit.max_value : '', единица: limit ? limit.unit : '',
        source_type: 'ттк_ккт', source_document: src, обязательность: true, ppk_id: ppk.ppk_id, ppk_version: ppk.version,
        тип_ответа: isPrp ? 'ДА_НЕТ' : 'ЧИСЛО',
        текст_вопроса: isPrp ? (c.control_name + (parent.name ? ' (' + parent.name + ')' : '') + ': выполняется?') : (c.monitoring_parameter + (limit ? ', норма: ' + _cjLimitText_(limit) : '') + (parent.name ? ' — ' + parent.name : '')),
        ожидаемый_ответ: 'ДА', уровень_при_нет: c.point_type === 'ККТ' ? 'критическое' : 'предупреждение'
      }, session.user_id, session);
      updateRow_('JOURNAL_DEFINITIONS', findOne_('JOURNAL_DEFINITIONS', 'definition_id', def.definition_id), { parent_type: parent.type, parent_id: parent.id, ccp_proposal_id: proposal ? proposal.proposal_id : '' });
      (isPrp ? [{ режим: 'НА_СТАРТЕ', смещение_минут: 30 }] : sch.triggers).forEach(function (t) {
        createJournalTrigger_({ definition_id: def.definition_id, режим: t.режим, интервал_минут: t.интервал_минут || '', смещение_минут: t.смещение_минут || 0 }, session.user_id, session);
      });
      updateRow_('PPK_CONTROLS', findOne_('PPK_CONTROLS', 'control_id', c.control_id), { journal_definition_id: def.definition_id });
      out.created.push({ definition_id: def.definition_id, название: def.название, периодичность: def.периодичность });
    });
    // Журналы ККТ прежних версий ППК — в архив (контроль действует только в утверждённой версии).
    findRows_('JOURNAL_DEFINITIONS', function (d) { return d.organization_id === ppk.organization_id && d.source_type === 'ттк_ккт' && d.ppk_id && d.ppk_id !== ppk.ppk_id && d.статус !== 'архив'; }).forEach(function (d) {
      updateRow_('JOURNAL_DEFINITIONS', d, { статус: 'архив' }); out.archived++;
    });
    auditLog_(session.user_id, 'Журналы ККТ сформированы', 'PPK_VERSIONS:' + ppk.ppk_id, '', JSON.stringify({ created: out.created.length, archived: out.archived }), 'success', session.cascade_id || '');
    return out;
  });
}

/**
 * Выпуск партии блюда/ПФ: по каждому действующему журналу ККТ «по партии» для этого
 * продукта создаётся ожидающая запись. Значение вводит сотрудник (система его не
 * подставляет); выход за предел → отклонение и корректирующее действие (_evaluateJournalValue_).
 */
function createCcpBatchPending_(task, batch, session) {
  var defs = findRows_('JOURNAL_DEFINITIONS', function (d) {
    return d.organization_id === (session ? session.organization_id : task.organization_id) && d.статус === 'активен' && d.source_type === 'ттк_ккт' &&
      d.периодичность === CCP_BATCH_PERIODICITY && d.parent_id === task.parent_id && (!d.location_id || d.location_id === task.location_id);
  });
  var now = new Date(), slotMin = now.getHours() * 60 + now.getMinutes();
  return defs.map(function (d) {
    return _createPendingIfNew_(d.organization_id, task.location_id, d.workshop_id || task.workshop_id || '', d.journal_type, d.definition_id, todayDateStr_(), slotMin, 'BATCH:' + batch.batch_id,
      { тип_ответа: d.тип_ответа, текст_вопроса: 'Партия ' + (batch.партия_номер || batch.batch_id) + ': ' + d.текст_вопроса, ожидаемый_ответ: d.ожидаемый_ответ, уровень_при_нет: d.уровень_при_нет });
  }).filter(Boolean);
}

/** Журналы ККТ блюда/ПФ для редактора ТТК/техкарты: что действует и сколько отклонений. */
function getCcpJournalsFor_(parentId, session) {
  var defs = findRows_('JOURNAL_DEFINITIONS', function (d) { return d.organization_id === session.organization_id && d.source_type === 'ттк_ккт' && d.parent_id === parentId && d.статус === 'активен'; });
  return defs.map(function (d) {
    var dev = findRows_('JOURNAL_DEVIATIONS', function (x) { return x.definition_id === d.definition_id && (x.статус === 'OPEN' || x.статус === 'открыто'); }).length;
    // Записи журнала только дописываются в конец листа: последняя по порядку — самая свежая
    // (сортировка по дате не различает записи одной секунды).
    var entries = findRows_('JOURNALS', function (j) { return j.definition_id === d.definition_id; });
    var last = entries[entries.length - 1];
    return { definition_id: d.definition_id, название: d.название, периодичность: d.периодичность, норма: _cjLimitText_({ min_value: d.мин_норма, max_value: d.макс_норма, unit: d.единица }), тип_ответа: d.тип_ответа, открытых_отклонений: dev, последняя_запись: last ? { значение: last.значение, дата: last.дата, статус: last.статус } : null };
  });
}

function migrateCcpJournalsSchema_() {
  return { ok: true, changed: typeof ensureSchemaColumns_ === 'function' ? ensureSchemaColumns_('JOURNAL_DEFINITIONS') : [] };
}
