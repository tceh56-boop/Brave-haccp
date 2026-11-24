/**
 * MON CHEF V101 — Restaurant Service: редактор ролей для директора (решение владельца, этап 5).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Права по умолчанию задаёт код (MonChef_Rbac.gs, V92, V101). Директор с правом «roles_edit» меняет их:
 *   • включает или выключает право у роли (лист «Роли_Матрица_V1»: каждое изменение — строка с причиной,
 *     прежняя запись по той же паре «роль — право» становится «заменена»; ничего не удаляется);
 *   • заводит свою роль на основе существующей (лист «Роли_Свои_V1»): права и цех основы, медицинский допуск,
 *     если основа — роль кухни; роль в архив — только когда за ней нет действующих сотрудников.
 * Ограничения: право «system» (технический доступ) не выдаётся никому; у «Директора» нельзя снять «roles_edit»,
 *   «grants» и «personnel» — иначе предприятие останется без управления правами; технический доступ — не роль.
 * Применение: файл загружается после всех модулей и до шлюза, изменения кладутся поверх карт ролей
 * (кэш на 6 часов, сбрасывается при каждом изменении). Сессии берут права роли при каждом вызове — изменение
 * действует сразу, без повторного входа. Ограничение: журналы ХАССП своя роль ведёт по индивидуальным правам
 * и по ролям журнала основы не наследует.
 */
var MC_RS_RM_SHEET_ = 'Роли_Матрица_V1', MC_RS_RM_HEAD_ = ['RuleID', 'Роль', 'Право', 'Разрешено', 'Причина', 'Изменил', 'Изменено', 'Статус', 'OperationID'];
var MC_RS_RC_SHEET_ = 'Роли_Свои_V1', MC_RS_RC_HEAD_ = ['Роль', 'Основа', 'Описание', 'Статус', 'Создал', 'Создано', 'Причина', 'OperationID'];
var MC_RS_RM_LOCK_ = { 'Директор': ['roles_edit', 'grants', 'personnel'] };
var MC_RS_RM_NEVER_ = ['system'];
var MC_RS_RM_CACHE_ = 'mc_rs_rolematrix';

/* Права и роли по умолчанию (до правок директора) — снимок в момент загрузки этого файла. */
var MC_RS_RB_DEFAULT_ = (function () {
  try { var m = {}; Object.keys(MC_RB_MATRIX_).forEach(function (r) { m[r] = MC_RB_MATRIX_[r].slice(); }); return { matrix: m, roles: MC_RB_ROLES_.slice() }; }
  catch (e) { return { matrix: {}, roles: [] }; }
})();

function _rsRmSheet_(name, head) {
  var ss = _book_(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]); sh.setFrozenRows(1); }
  return sh;
}
function _rsRmRows_(name, head) {
  var sh = _book_().getSheetByName(name); if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues().map(function (r, i) { var o = { _row: i + 2 }; head.forEach(function (h, j) { o[h] = r[j]; }); return o; }).filter(function (o) { return o[head[0]] !== ''; });
}
/** Правки директора: {custom:[{role, base, description}], rules:{роль:{право: true|false}}} — из кэша или листов. */
function _rsRmLoad_(fresh) {
  var c = null;
  if (!fresh) { try { c = CacheService.getScriptCache(); var hit = c.get(MC_RS_RM_CACHE_); if (hit) return JSON.parse(hit); } catch (e) {} }
  var out = { custom: [], rules: {} };
  try {
    _rsRmRows_(MC_RS_RC_SHEET_, MC_RS_RC_HEAD_).forEach(function (r) { if (String(r['Статус']) === 'ACTIVE') out.custom.push({ role: String(r['Роль']), base: String(r['Основа']), description: String(r['Описание'] || '') }); });
    _rsRmRows_(MC_RS_RM_SHEET_, MC_RS_RM_HEAD_).forEach(function (r) {
      if (String(r['Статус']) !== 'ACTIVE') return;
      var role = String(r['Роль']); (out.rules[role] = out.rules[role] || {})[String(r['Право'])] = r['Разрешено'] === true || String(r['Разрешено']) === 'true';
    });
  } catch (e) {}
  try { (c || CacheService.getScriptCache()).put(MC_RS_RM_CACHE_, JSON.stringify(out), 21600); } catch (e) {}
  return out;
}
/** Наложить правки на карты ролей (от снимка по умолчанию — повторное применение не накапливает изменения). */
function _rsRmApply_(o) {
  Object.keys(MC_RS_RB_DEFAULT_.matrix).forEach(function (r) { MC_RB_MATRIX_[r] = MC_RS_RB_DEFAULT_.matrix[r].slice(); });
  (o.custom || []).forEach(function (cr) {
    var base = MC_RS_RB_DEFAULT_.matrix[cr.base]; if (!base) return;
    if (MC_RB_ROLES_.indexOf(cr.role) < 0) MC_RB_ROLES_.push(cr.role);
    try { if (typeof MC_ROLES !== 'undefined' && MC_ROLES.indexOf(cr.role) < 0) MC_ROLES.push(cr.role); } catch (e) {}
    MC_RB_MATRIX_[cr.role] = base.slice();
    try { if (MC_RB_SHOPS_[cr.base]) MC_RB_SHOPS_[cr.role] = MC_RB_SHOPS_[cr.base].slice(); } catch (e) {}
    try { if (MC_FOOD_ROLES_.indexOf(cr.base) >= 0 && MC_FOOD_ROLES_.indexOf(cr.role) < 0) MC_FOOD_ROLES_.push(cr.role); } catch (e) {}
  });
  Object.keys(o.rules || {}).forEach(function (role) {
    var a = MC_RB_MATRIX_[role]; if (!a) return;
    Object.keys(o.rules[role]).forEach(function (perm) {
      if (MC_RS_RM_NEVER_.indexOf(perm) >= 0) return;
      if (!o.rules[role][perm] && (MC_RS_RM_LOCK_[role] || []).indexOf(perm) >= 0) return;
      var i = a.indexOf(perm);
      if (o.rules[role][perm] && i < 0) a.push(perm); else if (!o.rules[role][perm] && i >= 0) a.splice(i, 1);
    });
  });
}
(function () { try { _rsRmApply_(_rsRmLoad_(false)); } catch (e) {} })();
function _rsRmChanged_() { try { CacheService.getScriptCache().remove(MC_RS_RM_CACHE_); } catch (e) {} try { _mcRbDrop_(); } catch (e) {} _rsRmApply_(_rsRmLoad_(true)); }

/** Редактор: права (по разделам), роли с правами сейчас и по умолчанию, история. */
function rsRolesGet(json, token) {
  return _rsRead_(token, 'roles_edit', function () {
    var o = _rsRmLoad_(true), custom = {}; o.custom.forEach(function (c) { custom[c.role] = c; });
    var emp = {}; try { var st = _mcRbEmpState_(); Object.keys(st).forEach(function (k) { if (st[k].active !== false && !st[k].hidden) emp[st[k].role] = (emp[st[k].role] || 0) + 1; }); } catch (e) {}
    var hist = _rsRmRows_(MC_RS_RM_SHEET_, MC_RS_RM_HEAD_).slice(-200).reverse().map(function (r) {
      return { role: String(r['Роль']), perm: String(r['Право']), allow: r['Разрешено'] === true || String(r['Разрешено']) === 'true', reason: String(r['Причина'] || ''), by: String(r['Изменил'] || ''),
        at: _rsIsDate_(r['Изменено']) ? Utilities.formatDate(r['Изменено'], _mcTz_(), 'dd.MM.yyyy HH:mm') : '', status: String(r['Статус']) };
    });
    return {
      perms: MC_RB_PERMS_.filter(function (p) { return MC_RS_RM_NEVER_.indexOf(p[0]) < 0; }).map(function (p) { return { key: p[0], ru: p[1], section: p[2] }; }),
      roles: MC_RB_ROLES_.map(function (r) {
        var base = custom[r] ? custom[r].base : r;
        return { name: r, custom: !!custom[r], base: custom[r] ? base : '', description: custom[r] ? custom[r].description : '', employees: emp[r] || 0,
          perms: (MC_RB_MATRIX_[r] || []).slice(), defaults: (MC_RS_RB_DEFAULT_.matrix[base] || []).slice(), locked: MC_RS_RM_LOCK_[r] || [] };
      }), history: hist
    };
  });
}
/** Права роли. {idem, role, perms: {право: true|false}, reason} — пишутся только изменения. */
function rsRoleSave(json, token) {
  return _rsMutate_(token, 'roles_edit', 'RS_ROLE_SAVE', json, function (c) {
    var d = c.d, role = _rsS_(d.role), reason = _rsS_(d.reason).slice(0, 300);
    if (!MC_RB_MATRIX_[role] || MC_RB_ROLES_.indexOf(role) < 0) return { fail: ['VALIDATION', 'Роль не найдена'] };
    if (!reason) return { fail: ['VALIDATION', 'Укажите причину изменения прав'] };
    var known = {}; MC_RB_PERMS_.forEach(function (p) { known[p[0]] = p[1]; });
    var want = d.perms || {}, cur = MC_RB_MATRIX_[role], changes = [];
    Object.keys(want).forEach(function (k) {
      if (!known[k]) throw new Error('VALIDATION: неизвестное право ' + k);
      if (MC_RS_RM_NEVER_.indexOf(k) >= 0) throw new Error('VALIDATION: право «' + known[k] + '» — только технический доступ');
      var on = !!want[k];
      if (!on && (MC_RS_RM_LOCK_[role] || []).indexOf(k) >= 0) throw new Error('VALIDATION: у роли «' + role + '» нельзя снять «' + known[k] + '» — предприятие останется без управления правами');
      if (on !== (cur.indexOf(k) >= 0)) changes.push({ perm: k, allow: on });
    });
    if (!changes.length) return { data: { role: role, changed: 0 } };
    var sh = _rsRmSheet_(MC_RS_RM_SHEET_, MC_RS_RM_HEAD_), rows = _rsRmRows_(MC_RS_RM_SHEET_, MC_RS_RM_HEAD_), now = new Date(), who = _rsWho_(c.s);
    changes.forEach(function (ch) {
      rows.forEach(function (r) { if (String(r['Статус']) === 'ACTIVE' && String(r['Роль']) === role && String(r['Право']) === ch.perm) sh.getRange(r._row, 8).setValue('SUPERSEDED'); });
      sh.appendRow([_rsId_('RR'), role, ch.perm, ch.allow, reason, who, now, 'ACTIVE', c.op.id]);
    });
    _rsRmChanged_();
    var after = { role: role, changes: changes.map(function (x) { return (x.allow ? '+' : '−') + x.perm; }), reason: reason };
    return { data: { role: role, changed: changes.length, perms: MC_RB_MATRIX_[role].slice() },
      plan: [{ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ROLE', role, null, 'ROLE_PERMS_CHANGED', null, after) }],
      audit: { action: 'RS_ROLE_PERMS_CHANGED', entity: MC_RS_RM_SHEET_, id: role, after: after } };
  });
}
/** Новая роль на основе существующей. {idem, name, base, description, reason} */
function rsRoleCreate(json, token) {
  return _rsMutate_(token, 'roles_edit', 'RS_ROLE_CREATE', json, function (c) {
    var d = c.d, name = _rsS_(d.name).replace(/[<>"']/g, ''), base = _rsS_(d.base), reason = _rsS_(d.reason).slice(0, 300);
    if (name.length < 3 || name.length > 40) return { fail: ['VALIDATION', 'Название роли — от 3 до 40 символов'] };
    var taken = MC_RB_ROLES_.concat(MC_RB_RETIRED_ || [], [MC_RB_TECH_, MC_RB_LEGACY_COOK_], Object.keys(MC_RB_LEGACY_ || {})).map(function (x) { return String(x).toLowerCase(); });
    if (taken.indexOf(name.toLowerCase()) >= 0) return { fail: ['VALIDATION', 'Роль «' + name + '» уже есть'] };
    if (!MC_RS_RB_DEFAULT_.matrix[base]) return { fail: ['VALIDATION', 'Основа — одна из существующих ролей'] };
    if (!reason) return { fail: ['VALIDATION', 'Укажите причину'] };
    _rsRmSheet_(MC_RS_RC_SHEET_, MC_RS_RC_HEAD_).appendRow([name, base, _rsS_(d.description).slice(0, 200), 'ACTIVE', _rsWho_(c.s), new Date(), reason, c.op.id]);
    _rsRmChanged_();
    var after = { role: name, base: base, perms: (MC_RB_MATRIX_[name] || []).length };
    return { data: after, plan: [{ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ROLE', name, null, 'ROLE_CREATED', null, after) }], audit: { action: 'RS_ROLE_CREATED', entity: MC_RS_RC_SHEET_, id: name, after: after } };
  });
}
/** Своя роль — в архив (нет действующих сотрудников с этой ролью). {idem, name, reason} */
function rsRoleArchive(json, token) {
  return _rsMutate_(token, 'roles_edit', 'RS_ROLE_ARCHIVE', json, function (c) {
    var name = _rsS_(c.d.name), reason = _rsS_(c.d.reason).slice(0, 300);
    var r = _rsRmRows_(MC_RS_RC_SHEET_, MC_RS_RC_HEAD_).filter(function (x) { return String(x['Роль']) === name && String(x['Статус']) === 'ACTIVE'; })[0];
    if (!r) return { fail: ['VALIDATION', 'В архив можно отправить только свою роль'] };
    if (!reason) return { fail: ['VALIDATION', 'Укажите причину'] };
    var st = _mcRbEmpState_(), n = Object.keys(st).filter(function (k) { return st[k].role === name && st[k].active !== false; }).length;
    if (n) return { fail: ['VALIDATION', 'С этой ролью работают сотрудники (' + n + ') — сначала назначьте им другую'] };
    _book_().getSheetByName(MC_RS_RC_SHEET_).getRange(r._row, 4).setValue('ARCHIVED');
    var i = MC_RB_ROLES_.indexOf(name); if (i >= 0) MC_RB_ROLES_.splice(i, 1); delete MC_RB_MATRIX_[name];
    _rsRmChanged_();
    return { data: { role: name }, plan: [{ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'ROLE', name, null, 'ROLE_ARCHIVED', null, { reason: reason }) }], audit: { action: 'RS_ROLE_ARCHIVED', entity: MC_RS_RC_SHEET_, id: name, after: { reason: reason } } };
  });
}

var MC_GATE_EXT_ = (typeof MC_GATE_EXT_ !== 'undefined' && MC_GATE_EXT_) || {};
MC_GATE_EXT_.rsRolesGet = { need: 'roles_edit' };
MC_GATE_EXT_.rsRoleSave = { need: 'roles_edit', mut: true };
MC_GATE_EXT_.rsRoleCreate = { need: 'roles_edit', mut: true };
MC_GATE_EXT_.rsRoleArchive = { need: 'roles_edit', mut: true };
