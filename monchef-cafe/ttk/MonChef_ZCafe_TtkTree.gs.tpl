/**
 * MON CHEF · КАФЕ — дерево папок ТТК и СТО групп продукции.
 *
 * Файл собран генератором monchef-cafe/ttk/gen_monchef_gas.py из того же описания, что и документы
 * (monchef-cafe/ttk/ttk_tree.py): папки, их СТО (режимы: температура, срок охлаждённого и замороженного),
 * распределение карт сборника № 1–234. Править описание — там, затем пересобрать.
 *
 *   • mcCafeTtkTreeData    — дерево, нормы СТО, отклонения карт, состояние папок на Диске и правил сроков;
 *   • mcCafeTtkTreeInstall — создаёт недостающие папки дерева на Google Диске (ничего не удаляет и не переносит)
 *     и загружает СТО в правила сроков V38: правило папки — по шаблону пути (DrivePath карты), особые режимы —
 *     по наименованию полуфабриката. Правила загружаются черновиками; «ввести в действие» (APPROVED) может
 *     только право «Утверждение плана ХАССП» — тогда партии п/ф получают срок годности из СТО своей папки.
 */
var MC_TTK_TREE_ = /*@@TREE@@*/{};
var MC_TTK_RULE_PREFIX_ = 'STO-';

(function () {
  if (typeof MC_CAFE_GATE_ !== 'undefined') {
    MC_CAFE_GATE_.mcCafeTtkTreeData = ['catalog|ttk_edit|haccp|haccp_view', false];
    MC_CAFE_GATE_.mcCafeTtkTreeInstall = ['ttk_approve|haccp|haccp_approve', true];
    MC_CAFE_GATE_.mcCafeTtkUnpack = ['ttk_approve|haccp|haccp_approve', true];
  }
  if (typeof MC_RB_MODULES_ !== 'undefined') { MC_RB_MODULES_.cafettk = 'catalog|ttk_edit|haccp|haccp_view'; if (typeof MC_RB_MODULE_RU_ !== 'undefined') MC_RB_MODULE_RU_.cafettk = 'Дерево папок ТТК и СТО'; }
  if (typeof _UI_BUILDERS_ !== 'undefined' && _UI_BUILDERS_.menu && !_UI_BUILDERS_.menu.__ttkTree) {
    var orig = _UI_BUILDERS_.menu;
    _UI_BUILDERS_.menu = function () { var r = orig.apply(this, arguments); try { (r.actions = r.actions || []).push({ label: 'Дерево папок и СТО', module: 'cafettk' }); } catch (e) {} return r; };
    _UI_BUILDERS_.menu.__ttkTree = true;
  }
})();

function _ttkTreeFolders_() { return MC_TTK_TREE_.folders || []; }
function _ttkFmtH_(h) { if (h === null || h === undefined || h === '') return '—'; return h > 72 && h % 24 === 0 ? (h / 24) + ' сут' : String(h).replace('.', ',') + ' ч'; }
function _ttkNameKey_(s) { return String(s || '').replace(/\s*\((полуфабрикат[^)]*|на \d+[^)]*)\)\s*/gi, ' ').replace(/[«»"]/g, '').replace(/\s+/g, ' ').trim(); }

function _ttkNorm_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim(); }

/**
 * Правила V38 из СТО:
 *   • правило папки — режим по умолчанию, по шаблону пути (DrivePath карты содержит имя папки);
 *   • правило особого режима — по папке И наименованию (сопоставление V38 дополнено ниже: при заданных
 *     шаблоне папки и наименовании нужны оба совпадения), поэтому «Сырники (п/ф)» не задевает блюдо «Сырники с кремом»;
 *   • если наименование особого режима входит в имя другой карты той же папки («Краб-кейк» ⊂ «Масса для краб-кейков»),
 *     для той карты добавляется своё правило с более высоким приоритетом.
 */
function _ttkStoRules_() {
  var out = [];
  _ttkTreeFolders_().forEach(function (f) {
    var def = f.regimes[0], dish = f.kind === 'dish';
    var mk = function (id, r, extra) {
      return Object.assign({ ruleId: id, priority: 20, folderPattern: f.dir, productPattern: '', category: '', ttkId: '',
        regime: dish ? 'SERVE_NOW' : 'CHILLED', storageMinC: r.min === null ? '' : r.min, storageMaxC: r.max === null ? '' : r.max,
        shelfLifeHours: dish || r.hours === null ? '' : r.hours, realizationHours: dish && /1 ч/.test(r.note) ? 1 : '',
        freezeAllowed: !dish && !!r.frozen, freezeMinC: '', freezeMaxC: r.frozen ? -18 : '', freezeShelfLifeHours: r.frozen ? r.frozen * 24 : '',
        packagingRequired: dish ? '' : 'закрытая маркированная тара', afterOpenHours: '', sourceType: 'СТО предприятия', sourceRef: f.sto + ', режим ' + r.id + ' (' + r.what + ')',
        sourceDate: MC_TTK_TREE_.year, notes: (r.temp + (r.note ? '; ' + r.note : '')).slice(0, 400), folder: f.code, regimeId: r.id }, extra);
    };
    var reg = function (id) { return f.regimes.filter(function (x) { return x.id === id; })[0]; };
    out.push(mk(MC_TTK_RULE_PREFIX_ + f.code + '-' + def.id, def, {}));
    var special = [];
    f.cards.forEach(function (c) {
      if (c.regime === def.id) return;
      var p = _ttkNameKey_(c.name);
      special.push({ n: c.n, p: _ttkNorm_(p), regime: c.regime });
      out.push(mk(MC_TTK_RULE_PREFIX_ + f.code + '-' + c.regime + '-' + c.n, reg(c.regime), { productPattern: p, priority: 30 }));
    });
    f.cards.forEach(function (c) {
      var nm = _ttkNorm_(c.name), wrong = special.some(function (x) { return x.n !== c.n && x.regime !== c.regime && nm.indexOf(x.p) >= 0; });
      if (wrong) out.push(mk(MC_TTK_RULE_PREFIX_ + f.code + '-' + c.regime + '-' + c.n + 'X', reg(c.regime), { productPattern: c.name, priority: 40 }));
    });
  });
  return out;
}

// Сопоставление правил сроков V38: правило с шаблоном папки И наименованием срабатывает только при обоих совпадениях
// (приоритетнее правила одной папки). Остальное — как в V38.
if (typeof _v38Match_ === 'function' && !_v38Match_.__cafe) {
  var _ttkV38MatchOrig_ = _v38Match_;
  _v38Match_ = function (r, ttk) {
    if (String(r[2] || '') && String(r[5] || '') && !String(r[4] || '')) {
      if (String(r[20] || '').toUpperCase() !== 'APPROVED') return null;
      var folder = _v38Norm_(ttk.path), name = _v38Norm_(ttk.name);
      return folder.indexOf(_v38Norm_(r[2])) >= 0 && name.indexOf(_v38Norm_(r[5])) >= 0 ? { score: 800, type: 'FOLDER_PRODUCT' } : null;
    }
    return _ttkV38MatchOrig_(r, ttk);
  };
  _v38Match_.__cafe = true;
}

function _ttkRuleRows_() {
  try { if (typeof _v38Init_ === 'function') _v38Init_(); } catch (e) {}
  var sh = _book_().getSheetByName(typeof MC_V38 !== 'undefined' ? MC_V38.RULE : 'Сроки_Правила_V38');
  if (!sh || sh.getLastRow() < 2) return { sh: sh, byId: {} };
  var v = sh.getDataRange().getValues(), byId = {};
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).indexOf(MC_TTK_RULE_PREFIX_) === 0) byId[String(v[i][0])] = { row: i + 1, status: String(v[i][20] || '') };
  return { sh: sh, byId: byId };
}

/** Корень дерева на Диске: свойство MC_TTK_ROOT_ID (папка, в которой лежит или будет «ТТК кафе»). */
function _ttkRootId_() { try { return String(PropertiesService.getScriptProperties().getProperty('MC_TTK_ROOT_ID') || ''); } catch (e) { return ''; } }
function _ttkChild_(parent, name, create) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return { f: it.next(), created: false };
  return create ? { f: parent.createFolder(name), created: true } : { f: null, created: false };
}
/** Обход дерева на Диске: что есть, чего нет; create — создать недостающее. */
function _ttkDriveWalk_(rootId, create) {
  var root = DriveApp.getFolderById(rootId), top = _ttkChild_(root, MC_TTK_TREE_.root, create), res = { url: '', exists: 0, created: 0, missing: [] };
  if (!top.f) { res.missing.push(MC_TTK_TREE_.root); return res; }
  res.url = top.f.getUrl(); top.created ? res.created++ : res.exists++;
  var need = [[MC_TTK_TREE_.common], [MC_TTK_TREE_.common, 'СТО'], [MC_TTK_TREE_.archive]];
  _ttkTreeFolders_().forEach(function (f) { need.push([f.top]); need.push([f.top, f.dir]); });
  var seen = {};
  need.forEach(function (p) {
    var k = p.join('/'); if (seen[k]) return; seen[k] = 1;
    var cur = top.f;
    for (var i = 0; i < p.length; i++) {
      var x = _ttkChild_(cur, p[i], create);
      if (!x.f) { res.missing.push(MC_TTK_TREE_.root + '/' + p.slice(0, i + 1).join('/')); return; }
      if (i === p.length - 1) x.created ? res.created++ : res.exists++;
      cur = x.f;
    }
  });
  return res;
}

function mcCafeTtkTreeData(token) {
  var s;
  try { s = _requireAuth_(token); } catch (e) { return _failFrom_(e); }
  try {
    var rules = _ttkStoRules_(), rr = _ttkRuleRows_(), loaded = 0, approved = 0;
    rules.forEach(function (r) { var x = rr.byId[r.ruleId]; if (x) { loaded++; if (x.status.toUpperCase() === 'APPROVED') approved++; } });
    var rootId = _ttkRootId_(), drive = null;
    if (rootId) { try { drive = _ttkDriveWalk_(rootId, false); } catch (e) { drive = { error: 'Папка корня недоступна: ' + String(e.message || e) }; } }
    return _ok_({
      root: MC_TTK_TREE_.root, year: MC_TTK_TREE_.year, rootId: rootId, drive: drive,
      folders: _ttkTreeFolders_().map(function (f) {
        return { code: f.code, name: f.name, kind: f.kind, top: f.top, dir: f.dir, sto: f.sto, shops: f.shops, cards: f.cards.length,
          regimes: f.regimes.map(function (r) { return { id: r.id, what: r.what, temp: r.temp, chilled: f.kind === 'dish' ? 'сразу' : _ttkFmtH_(r.hours), frozen: r.frozen ? r.frozen + ' сут' : '—', note: r.note,
            cards: f.cards.filter(function (c) { return c.regime === r.id; }).map(function (c) { return c.n + ' ' + c.name; }) }; }) };
      }),
      deviations: MC_TTK_TREE_.deviations || [], rules: { total: rules.length, loaded: loaded, approved: approved },
      canInstall: _mcRbHasExact_(s, 'ttk_approve|haccp|haccp_approve'), canApprove: _mcRbHasExact_(s, 'haccp_approve')
    });
  } catch (e) { return _failFrom_(e); }
}

/** json: {rootId?, folders: bool, rules: bool, approve: bool} */
function mcCafeTtkTreeInstall(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'ttk_approve|haccp|haccp_approve', 'CAFE_TTK_TREE', 'Дерево ТТК', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _mcBlJson_(json) || {}, out = { drive: null, rules: null };
    if (d.approve && !_mcRbHasExact_(op.session, 'haccp_approve')) { _endOp_(op, 'FAILED'); return _fail_('FORBIDDEN', 'Вводить правила сроков в действие может только право «Утверждение плана ХАССП»', op.id); }
    if (d.folders) {
      var rootId = String(d.rootId || _ttkRootId_() || '').replace(/^.*\/folders\//, '').replace(/[?#].*$/, '').trim();
      if (!rootId) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите папку на Диске, в которой создать «' + MC_TTK_TREE_.root + '» (ссылка или ID)', op.id); }
      try { out.drive = _ttkDriveWalk_(rootId, true); } catch (e) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Папка недоступна: ' + String(e.message || e), op.id); }
      PropertiesService.getScriptProperties().setProperty('MC_TTK_ROOT_ID', rootId);
    }
    if (d.rules || d.approve) {
      out.rules = _withLock_(function () {
        var rr = _ttkRuleRows_(), sh = rr.sh, added = 0, updated = 0, now = new Date();
        _ttkStoRules_().forEach(function (r) {
          var x = rr.byId[r.ruleId], status = d.approve ? 'APPROVED' : (x && x.status ? x.status : 'DRAFT');
          var row = [r.ruleId, r.priority, r.folderPattern, r.category, r.ttkId, r.productPattern, r.regime, r.storageMinC, r.storageMaxC, r.shelfLifeHours, r.realizationHours,
            r.freezeAllowed ? 'TRUE' : 'FALSE', r.freezeMinC, r.freezeMaxC, r.freezeShelfLifeHours, r.packagingRequired, r.afterOpenHours, r.sourceType, r.sourceRef, r.sourceDate, status, r.notes, now, now];
          if (x) { row[22] = sh.getRange(x.row, 23).getValue() || now; sh.getRange(x.row, 1, 1, row.length).setValues([row]); updated++; }
          else { sh.appendRow(row); added++; }
        });
        return { added: added, updated: updated, status: d.approve ? 'APPROVED' : 'DRAFT' };
      });
    }
    _audit_(op, 'CAFE_TTK_TREE', 'Дерево ТТК', MC_TTK_TREE_.root, null, out);
    _endOp_(op);
    return _ok_(out, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/**
 * Разложить карты из архива: «ТТК кафе*.zip» (сборка build_ttk_tree.py) лежит в папке «ТТК кафе» или в корне.
 * Файлы архива раскладываются по своим путям в дереве; файл с тем же именем в папке не перезаписывается.
 * Большой архив — частями: через 4,5 мин работа останавливается, повторный запуск продолжает с того же места.
 */
function mcCafeTtkUnpack(token) {
  var op = null;
  try { op = _beginOp_(token, 'ttk_approve|haccp|haccp_approve', 'CAFE_TTK_UNPACK', 'Дерево ТТК', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var rootId = _ttkRootId_();
    if (!rootId) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Сначала создайте папки на Диске (укажите корень)', op.id); }
    _ttkDriveWalk_(rootId, true);
    var root = DriveApp.getFolderById(rootId), top = _ttkChild_(root, MC_TTK_TREE_.root, false).f, zip = null;
    [top, root].forEach(function (f) {
      if (zip || !f) return;
      var it = f.getFiles();
      while (it.hasNext()) { var x = it.next(); if (/^ТТК кафе.*\.zip$/i.test(x.getName()) && (!zip || x.getLastUpdated() > zip.getLastUpdated())) zip = x; }
    });
    if (!zip) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Архив «' + MC_TTK_TREE_.root + '.zip» не найден: загрузите его в папку «' + MC_TTK_TREE_.root + '» на Диске', op.id); }
    var blob = zip.getBlob(); blob.setContentType('application/zip');
    var parts = Utilities.unzip(blob), t0 = Date.now(), cache = {}, out = { files: parts.length, created: 0, skipped: 0, left: 0, zip: zip.getName() };
    var dirOf = function (segs) {
      var k = segs.join('/'); if (cache[k]) return cache[k];
      var cur = top; segs.forEach(function (s) { cur = _ttkChild_(cur, s, true).f; });
      return (cache[k] = cur);
    };
    for (var i = 0; i < parts.length; i++) {
      var name = String(parts[i].getName() || ''); if (!name || /\/$/.test(name)) continue;
      if (Date.now() - t0 > 270000) { out.left = parts.length - i; break; }
      var segs = name.split('/').filter(Boolean); if (segs[0] === MC_TTK_TREE_.root) segs.shift();
      var base = segs.pop(), dir = dirOf(segs);
      if (dir.getFilesByName(base).hasNext()) { out.skipped++; continue; }
      dir.createFile(parts[i].setName(base)); out.created++;
    }
    _audit_(op, 'CAFE_TTK_UNPACK', 'Дерево ТТК', zip.getName(), null, out);
    _endOp_(op);
    return _ok_(out, op.id);
  } catch (e) { if (op) _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
