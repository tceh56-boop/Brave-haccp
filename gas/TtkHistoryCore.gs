// ЦЕХ — TtkHistoryCore.gs
// История карты: версии ТТК (и техкарт ПФ), изменения из файлов (импорт/Google Диск),
// сравнение любых двух версий, возврат к прежней версии. Перенос MonChef_TtkHistory.gs:
// «вернуть версию N» не переписывает историю, а создаёт новую версию-черновик — копию N;
// утверждает её технолог обычным порядком.

function _thTtkState_(v) {
  var lines = []; try { lines = JSON.parse(v.recipe_snapshot_json || '[]'); } catch (e) { lines = []; }
  return { technology: v.технология || '', storage: v.условия_хранения || '', shelf: v.срок_реализации || '', serving: v.режим_подачи || '',
    lines: lines.map(function (l) { return { name: l.ingredient_name || l.product_id, unit: l.единица, brutto: Number(l.брутто) || 0, netto: Number(l.нетто) || 0 }; }) };
}

function _thPfState_(c) {
  return { technology: c.технология || '', storage: c.условия_хранения || '', shelf: c.срок_хранения_часов === '' || c.срок_хранения_часов === undefined ? '' : c.срок_хранения_часов + ' ч' };
}

function _thVersion_(type, id, session) {
  var row = type === 'PF' ? findOne_('PF_TECH_CARDS', 'pf_tech_id', id) : findOne_('TTK_VERSIONS', 'ttk_version_id', id);
  assertOwnedByOrg_(session, row, (type === 'PF' ? 'PF_TECH_CARDS:' : 'TTK_VERSIONS:') + id);
  return row;
}

/** Сравнить две версии одной карты (ТТК блюда или техкарты ПФ): [{label, before, after}]. */
function compareTtkVersions_(data, session) {
  var type = data.type === 'PF' ? 'PF' : 'DISH';
  var a = _thVersion_(type, data.fromId, session), b = _thVersion_(type, data.toId, session);
  if (type === 'PF' ? a.pf_id !== b.pf_id : a.dish_id !== b.dish_id) throw new Error('Версии относятся к разным картам.');
  var changes = type === 'PF' ? ttkStateDiff_(_thPfState_(a), _thPfState_(b)) : ttkStateDiff_(_thTtkState_(a), _thTtkState_(b));
  return { type: type, from: { id: data.fromId, version: a.version, status: a.status }, to: { id: data.toId, version: b.version, status: b.status }, changes: changes };
}

/** История карты: версии и изменения, пришедшие из файлов (с разницей «было → стало»). */
function getTtkHistory_(data, session) {
  var type = data.type === 'PF' ? 'PF' : 'DISH', id = data.id;
  var ent = type === 'PF' ? getSemiFinishedById_(id) : findOne_('DISHES', 'dish_id', id);
  assertOwnedByOrg_(session, ent, (type === 'PF' ? 'SEMI_FINISHED:' : 'DISHES:') + id);
  var versions = (type === 'PF' ? findRows_('PF_TECH_CARDS', function (c) { return c.pf_id === id; }) : findRows_('TTK_VERSIONS', function (v) { return v.dish_id === id; }))
    .sort(function (x, y) { return Number(y.version) - Number(x.version); })
    .map(function (v) { return { id: type === 'PF' ? v.pf_tech_id : v.ttk_version_id, version: v.version, status: v.status, источник: v.источник || '', created_at: String(v.created_at || ''), created_by: v.created_by || '', approved_at: String(v.approved_at || ''), approved_by: v.approved_by || '' }; });
  var files = findRows_('TTK_IMPORT_ROWS', function (r) { return r.organization_id === session.organization_id && r.entity_id === id && r.status === 'CONFIRMED'; })
    .map(function (r) { return { row_id: r.row_id, source_path: r.source_path, change_kind: r.change_kind || 'NEW', decided_at: String(r.decided_at || ''), decided_by: r.decided_by || '', diff: _tiJson_(r.diff_json, []) }; });
  var pending = findRows_('TTK_IMPORT_ROWS', function (r) { return r.organization_id === session.organization_id && r.entity_id === id && r.change_kind === 'CHANGED' && r.status === 'PREVIEW'; })
    .map(function (r) { return { row_id: r.row_id, import_id: r.import_id, source_path: r.source_path, diff: _tiJson_(r.diff_json, []) }; });
  var drive = findRows_('TTK_DRIVE_FILES', function (f) { return f.organization_id === session.organization_id && f.entity_id === id; })
    .map(function (f) { return { path: f.path, sync_state: f.sync_state, removed_at: String(f.removed_at || ''), modified_at: f.modified_at ? new Date(Number(f.modified_at)).toISOString() : '' }; });
  return { type: type, id: id, name: ent.название, versions: versions, file_changes: files, pending_changes: pending, drive_files: drive };
}

/**
 * Вернуть версию N: новая версия-черновик с полями N. Для ТТК блюда с applyRecipe рецептура
 * тоже возвращается к составу N (снимок рецептуры версии). Если уже есть черновик — сначала
 * его нужно утвердить или изменить: второй черновик запутает технолога.
 */
function restoreTtkVersion_(data, session) {
  return withLock_(function () {
    var type = data.type === 'PF' ? 'PF' : 'DISH';
    var src = _thVersion_(type, data.id, session);
    if (type === 'PF') {
      var pfCards = findRows_('PF_TECH_CARDS', function (c) { return c.pf_id === src.pf_id; });
      if (pfCards.some(function (c) { return c.status === 'черновик'; })) throw new Error('У ПФ уже есть черновик техкарты — утвердите или измените его.');
      var steps = []; try { steps = JSON.parse(src.технологические_этапы_json || '[]'); } catch (e) { steps = []; }
      var pfRow = savePfTechDraft_({ pfId: src.pf_id, источник: 'Возврат к версии ' + src.version + (src.источник ? ' (' + src.источник + ')' : ''), технология: src.технология, steps: steps, условия_хранения: src.условия_хранения, срок_хранения_часов: src.срок_хранения_часов }, session);
      auditLog_(session.user_id, 'Возврат к версии техкарты ПФ', 'PF_TECH_CARDS:' + pfRow.pf_tech_id, 'v' + src.version, 'v' + pfRow.version, 'success', session.cascade_id || '');
      return { type: type, id: pfRow.pf_tech_id, version: pfRow.version, from: src.version };
    }
    var versions = findRows_('TTK_VERSIONS', function (v) { return v.dish_id === src.dish_id; });
    if (versions.some(function (v) { return v.status === 'черновик' || v.status === 'на_согласовании'; })) throw new Error('У блюда уже есть черновик или версия на согласовании — завершите её.');
    var recipe = null;
    if (data.applyRecipe) {
      var snap = []; try { snap = JSON.parse(src.recipe_snapshot_json || '[]'); } catch (e) { snap = []; }
      if (!snap.length) throw new Error('В версии ' + src.version + ' нет снимка рецептуры.');
      recipe = applyRecipeTarget_('DISH', src.dish_id, snap.map(function (l) {
        var ing = String(l.product_id).indexOf('PF-') === 0 ? getSemiFinishedById_(l.product_id) : getProductById_(l.product_id);
        assertOwnedByOrg_(session, ing, 'INGREDIENT:' + l.product_id);
        return { ingredientId: l.product_id, qty: Number(l.брутто), net: Number(l.нетто), unit: l.единица, loss: Number(l.потери_процент) || 0 };
      }), session);
    }
    var st = []; try { st = JSON.parse(src.технологические_этапы_json || '[]'); } catch (e) { st = []; }
    var row = createTtkVersion_({ dishId: src.dish_id, источник: 'Возврат к версии ' + src.version + (src.источник ? ' (' + src.источник + ')' : ''), область_применения: src.область_применения,
      технология: src.технология, условия_хранения: src.условия_хранения, срок_реализации: src.срок_реализации, показатели_качества: src.показатели_качества,
      технологическиеЭтапы: st, режим_подачи: src.режим_подачи }, session);
    auditLog_(session.user_id, 'Возврат к версии ТТК', 'TTK_VERSIONS:' + row.ttk_version_id, 'v' + src.version, 'v' + row.version + (recipe ? ' + рецептура' : ''), 'success', session.cascade_id || '');
    return { type: type, id: row.ttk_version_id, version: row.version, from: src.version, recipe: recipe };
  });
}
