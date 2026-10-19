// ЦЕХ — PfTechCore.gs
// Техкарта полуфабриката: технология, типизированные этапы, условия и срок хранения.
// Версии: черновик → утверждена (предыдущая утверждённая уходит в архив), как у ТТК блюда.
// Рецептура ПФ по-прежнему живёт в RECIPES (parent_type = 'PF').
//
// Утверждение переносит условия и срок хранения в карточку ПФ (SEMI_FINISHED): эти поля
// уже используются складом, маркировкой и расчётом срока блюда. Срок больше нормы
// группы продукции требует обоснования (МУК 4.2.1847-04) — утверждение без отметки
// об обосновании отклоняется.

var PF_TECH_PLACEHOLDER = 'ТРЕБУЕТ ЗАПОЛНЕНИЯ';

function _pftPf_(pfId, session) {
  var pf = getSemiFinishedById_(pfId);
  if (!pf) throw new Error('ПФ не найден: ' + pfId);
  if (session) assertOwnedByOrg_(session, pf, 'SEMI_FINISHED:' + pfId);
  return pf;
}

function _pftCards_(pfId) {
  return findRows_('PF_TECH_CARDS', function (r) { return r.pf_id === pfId; }).sort(function (a, b) { return Number(b.version || 0) - Number(a.version || 0); });
}

function _pftSteps_(card) {
  var steps = []; try { steps = JSON.parse(card && card.технологические_этапы_json || '[]'); } catch (e) { steps = []; }
  if (!steps.length && card && card.технология) steps = parseTechnologySteps_(card.технология);
  return steps;
}

/** Действующие этапы ПФ: утверждённая карта, иначе последний черновик. Используется расчётами ТУ/срока. */
function getPfTechSteps_(pfId) {
  var cards = _pftCards_(pfId);
  var c = cards.filter(function (x) { return x.status === 'утверждена'; })[0] || cards.filter(function (x) { return x.status === 'черновик'; })[0];
  return c ? _pftSteps_(c) : [];
}

function _pftCleanSteps_(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map(function (s) { return { stage: String(s.stage || ''), step_type: TECH_STEP_TYPES[s.step_type] ? s.step_type : techStepType_(s), description: String(s.description || ''), temperature: String(s.temperature || ''), time: String(s.time || '') }; });
}

/** Список ПФ организации с состоянием техкарты (одна выборка PF_TECH_CARDS на всех). */
function getPfTechList_(session) {
  var cards = {};
  findRows_('PF_TECH_CARDS', function (c) { return c.organization_id === session.organization_id; }).forEach(function (c) { (cards[c.pf_id] = cards[c.pf_id] || []).push(c); });
  return getSemiFinishedList_(session.organization_id).map(function (pf) {
    var list = (cards[pf.pf_id] || []).sort(function (a, b) { return Number(b.version || 0) - Number(a.version || 0); });
    var approved = list.filter(function (c) { return c.status === 'утверждена'; })[0], draft = list.filter(function (c) { return c.status === 'черновик'; })[0];
    return { pf_id: pf.pf_id, название: pf.название, выход: pf.выход, единица: pf.единица, срок_хранения_часов: pf.срок_хранения_часов, условия_хранения: pf.условия_хранения,
      tech_status: approved ? 'утверждена' : (draft ? 'черновик' : 'нет'), tech_version: (approved || draft || {}).version || '', has_draft: !!draft };
  });
}

/** Контекст редактора техкарты ПФ: карточка, версии, рецептура, этапы, срок по нормам, ККТ. */
function getPfTechContext_(data, session) {
  var pf = _pftPf_(data.pfId, session);
  var cards = _pftCards_(pf.pf_id);
  var selected = data.pfTechId ? cards.filter(function (c) { return c.pf_tech_id === data.pfTechId; })[0] : cards[0];
  var steps = data.parse && data.technology ? parseTechnologySteps_(data.technology) : (data.steps ? _pftCleanSteps_(data.steps) : _pftSteps_(selected));
  var shelf = calcShelfLife_('PF', pf.pf_id, session, steps);
  var strip = function (r) { if (!r) return null; var o = {}; Object.keys(r).forEach(function (k) { if (k !== '__row') o[k] = r[k]; }); return o; };
  return {
    pf: strip(pf), versions: cards.map(strip), selected: strip(selected), steps: steps, step_types: TECH_STEP_TYPES,
    recipes: getRecipeLines_('PF', pf.pf_id, session).map(strip),
    shelf_life: shelf, ccp: proposeCcp_('PF', pf.pf_id, session, steps),
    proposals: selected ? findRows_('TTK_CCP_PROPOSALS', function (r) { return r.pf_tech_id === selected.pf_tech_id && r.status !== 'ЗАМЕНЕНО'; }).map(strip) : [],
    journals: typeof getCcpJournalsFor_ === 'function' ? getCcpJournalsFor_(pf.pf_id, session) : []
  };
}

function _pftValidate_(data, forApproval) {
  var steps = _pftCleanSteps_(data.steps || []);
  if (String(data.технология || '').trim().length < 10 && !steps.length) throw new Error('Опишите технологию или добавьте этапы.');
  if (forApproval) {
    if (!data.условия_хранения || String(data.условия_хранения).indexOf(PF_TECH_PLACEHOLDER) !== -1) throw new Error('Укажите условия хранения ПФ.');
    if (!(Number(data.срок_хранения_часов) > 0)) throw new Error('Укажите срок хранения ПФ в часах.');
  }
  return steps;
}

/** Создать черновик (новую версию) или обновить существующий черновик. */
function savePfTechDraft_(data, session) {
  return withLock_(function () {
    var pf = _pftPf_(data.pfId, session);
    var steps = _pftValidate_(data, false);
    var hours = data.срок_хранения_часов === '' || data.срок_хранения_часов === undefined ? '' : Number(String(data.срок_хранения_часов).replace(',', '.'));
    if (hours !== '' && !(hours > 0)) throw new Error('Срок хранения — положительное число часов.');
    var fields = { источник: String(data.источник || 'Собственная разработка'), технология: String(data.технология || ''), технологические_этапы_json: JSON.stringify(steps), условия_хранения: String(data.условия_хранения || ''), срок_хранения_часов: hours };
    var row;
    if (data.pfTechId) {
      row = findOne_('PF_TECH_CARDS', 'pf_tech_id', data.pfTechId); assertOwnedByOrg_(session, row, 'PF_TECH_CARDS:' + data.pfTechId);
      if (row.pf_id !== pf.pf_id) throw new Error('Техкарта относится к другому ПФ.');
      if (row.status !== 'черновик') throw new Error('Редактировать можно только черновик. Создайте новую версию.');
      updateRow_('PF_TECH_CARDS', row, fields);
      row = findOne_('PF_TECH_CARDS', 'pf_tech_id', row.pf_tech_id);
    } else {
      var next = _pftCards_(pf.pf_id).reduce(function (m, r) { return Math.max(m, Number(r.version) || 0); }, 0) + 1;
      row = { pf_tech_id: generateId_('PF_TECH_CARDS'), pf_id: pf.pf_id, organization_id: session.organization_id, version: next, status: 'черновик', created_at: nowIso_(), created_by: session.user_id, approved_at: '', approved_by: '', archived_at: '' };
      Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
      insertRow_('PF_TECH_CARDS', row);
      auditLog_(session.user_id, 'Создана техкарта ПФ', 'PF_TECH_CARDS:' + row.pf_tech_id, '', 'v' + next, 'success', session.cascade_id || '');
    }
    return row;
  });
}

/**
 * Утверждение: проверка условий/срока, сверка срока с нормой (сверх нормы — только с
 * отметкой об обосновании), архив предыдущей версии, перенос хранения в карточку ПФ.
 */
function approvePfTech_(data, session) {
  return withLock_(function () {
    var row = findOne_('PF_TECH_CARDS', 'pf_tech_id', data.pfTechId); assertOwnedByOrg_(session, row, 'PF_TECH_CARDS:' + data.pfTechId);
    if (row.status !== 'черновик') throw new Error('Утвердить можно только черновик.');
    var pf = _pftPf_(row.pf_id, session);
    var steps = _pftValidate_({ технология: row.технология, steps: _pftSteps_(row), условия_хранения: row.условия_хранения, срок_хранения_часов: row.срок_хранения_часов }, true);
    var shelf = calcShelfLife_('PF', pf.pf_id, session, steps);
    var hours = Number(row.срок_хранения_часов);
    if (shelf.hours !== null && hours > shelf.hours && !data.labJustification) throw new Error('Срок ' + hours + ' ч больше нормы (' + shelf.hours + ' ч, ' + (shelf.limiting ? shelf.limiting.source : '') + '). Укажите обоснование: протокол испытаний по МУК 4.2.1847-04.');
    _pftCards_(pf.pf_id).filter(function (c) { return c.status === 'утверждена'; }).forEach(function (c) { updateRow_('PF_TECH_CARDS', c, { status: 'архив', archived_at: nowIso_() }); });
    updateRow_('PF_TECH_CARDS', row, { status: 'утверждена', approved_at: nowIso_(), approved_by: session.user_id, источник: data.labJustification ? String(row.источник || '') + ' | обоснование срока: ' + data.labJustification : row.источник });
    updateRow_('SEMI_FINISHED', pf, { условия_хранения: row.условия_хранения, срок_хранения_часов: hours, обновлено: nowIso_() });
    if (typeof detectAndRequestPpkReview_ === 'function') detectAndRequestPpkReview_(session.organization_id, session.location_id, 'PROCESS_CHANGED', 'PF_TECH_CARDS', row.pf_tech_id, session.user_id, session, 'Утверждена техкарта ПФ «' + pf.название + '»: проверить контрольные точки ППК.');
    auditLog_(session.user_id, 'Утверждена техкарта ПФ', 'PF_TECH_CARDS:' + row.pf_tech_id, 'черновик', 'утверждена', 'success', session.cascade_id || '');
    return findOne_('PF_TECH_CARDS', 'pf_tech_id', row.pf_tech_id);
  });
}

/** Предложения ККТ для техкарты ПФ (та же таблица и тот же порядок принятия, что у ТТК блюда). */
function generatePfCcpProposals_(data, session) {
  return withLock_(function () {
    var row = findOne_('PF_TECH_CARDS', 'pf_tech_id', data.pfTechId); assertOwnedByOrg_(session, row, 'PF_TECH_CARDS:' + data.pfTechId);
    var steps = _pftSteps_(row);
    return _tnSaveProposals_('pf_tech_id', row.pf_tech_id, 'PF', row.pf_id, proposeCcp_('PF', row.pf_id, session, steps), session);
  });
}

/** Для импорта архива: черновик техкарты ПФ из этапов карты; срок — по нормам или заглушка. */
function createPfTechFromImport_(pfId, technology, steps, sourcePath, session) {
  var shelf = calcShelfLife_('PF', pfId, session, steps);
  var hasNorm = shelf.hours !== null;
  return savePfTechDraft_({ pfId: pfId, источник: 'Архив ТТК: ' + sourcePath, технология: technology, steps: steps,
    условия_хранения: hasNorm ? shelf.conditions : PF_TECH_PLACEHOLDER, срок_хранения_часов: hasNorm ? shelf.hours : '' }, session);
}

function migratePfTechSchema_() {
  var changed = [];
  ['PF_TECH_CARDS', 'TTK_CCP_PROPOSALS'].forEach(function (key) {
    var sheet = getSheet_(key), expected = CONFIG.SCHEMA[key];
    var last = sheet.getLastColumn();
    var headers = last ? sheet.getRange(1, 1, 1, last).getValues()[0] : [];
    expected.forEach(function (h) { if (headers.indexOf(h) === -1) { sheet.getRange(1, headers.length + 1).setValue(h); headers.push(h); changed.push(key + '.' + h); } });
  });
  return { ok: true, changed: changed };
}
