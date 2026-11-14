// Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
/**
 * ЦЕХ Стандарт V73 — технологические инструкции (ТИ) для поваров.
 *
 * ТИ собирается из ТТК, по карточке на блюдо или полуфабрикат (как в образце «ТИ для поваров»):
 *  номер и название (номер = код ТТК) · состав с массой брутто/нетто (полуфабрикаты — со ссылкой «№ код» на свою ТТК) ·
 *  технология приготовления · подача или хранение (условия хранения и срок из действующей версии ТТК, иначе срок из карты
 *  или утверждённой таблицы сроков) · фото блюда · выход.
 * Можно собрать одно блюдо, список кодов, категорию или всё меню; несколько карточек — с оглавлением по категориям.
 * Как ТУ и ППК, система НИЧЕГО НЕ ПРИДУМЫВАЕТ: чего нет в ТТК, в карточке отмечено «не указано в ТТК» и попадает в список пробелов.
 * Срок «по категории» (расчёт системы) в ТИ не подставляется.
 */
var MC_V73_SEMI_CATS_ = /полуфабрикат|п\s*\/\s*ф/i;

function _v73Folder_() { var pr = PropertiesService.getScriptProperties(), id = pr.getProperty('MC_TI_FOLDER_ID'); if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = _docsFolder_().createFolder('ТИ'); pr.setProperty('MC_TI_FOLDER_ID', f.getId()); return f; }
function _v73T_(x) { return String(x === undefined || x === null ? '' : x).trim(); }
function _v73Num_(x) { var n = Number(x); if (!isFinite(n) || !n) return ''; var r = Math.round(n * 10) / 10; return String(r).replace('.', ','); }
/** Технология из колонки «Технология» листа «Блюда» (карточка ТТК). */
function _v73TechMap_() {
  var m = {}; try { var sh = _book_().getSheetByName('Блюда'); if (!sh || sh.getLastRow() < 2) return m;
    sh.getDataRange().getValues().slice(1).forEach(function (r) { if (r[0] !== '') m[String(r[0])] = { tech: _v73T_(r[5]), file: _v73T_(r[6]) }; }); } catch (e) {}
  return m;
}
/** Карточка ТИ одного блюда: только данные системы. */
function _v73Card_(code, techMap, opts) {
  var d = null; try { d = _v64DishOf_(code); } catch (e) {} if (!d) return null;
  var c = { code: String(d.code), name: _v73T_(d.name), cat: _v73T_(d.cat), semi: !!d.semi, version: 0, tech: '', storage: '', shelf: '', shelfSrc: '', ing: [], yieldText: '', photo: '', gaps: [] };
  var tm = techMap[c.code] || {};
  try { c.version = typeof _effectiveTTKVersion_ === 'function' ? _effectiveTTKVersion_(c.code) : 0;
    if (c.version) { var fv = _ttkFindVersion_(_ttkVersionsSheet_(), c.code, c.version); if (fv) { c.tech = _v73T_(fv.data[5]); c.storage = _v73T_(fv.data[10]); c.shelf = _v73T_(fv.data[11]); if (c.shelf) c.shelfSrc = 'ТТК, версия ' + c.version; } } } catch (e) {}
  if (!c.tech) c.tech = tm.tech || '';
  if (!c.shelf) { try { var sl = typeof _shelfLifeFor_ === 'function' ? _shelfLifeFor_(c.code) : null;
    if (sl && sl['часы'] > 0 && sl['источник'] !== 'категория') { c.shelf = 'не более ' + sl['часы'] + ' ч'; c.shelfSrc = sl['источник'] === 'карта' ? 'карта ТТК' : sl['источник']; } } catch (e) {} }
  (d.ing || []).forEach(function (g) { var nm = _v73T_(g[0]); if (!nm) return; var sub = null; try { sub = _v64DishOf_(nm); } catch (e) {}
    var ref = sub && String(sub.code) !== c.code && !/№\s*\S+/.test(nm) ? ' (№ ' + sub.code + ')' : '';
    c.ing.push({ name: nm + ref, brutto: _v73Num_(g[1]), netto: _v73Num_(g[3] === '' || g[3] === undefined ? g[1] : g[3]), unit: _v73T_(g[2]) || 'г' }); });
  var yb = Number(d.yieldBase) || 0; if (yb > 0) c.yieldText = _v73Num_(yb) + ' ' + (d.yieldUnit || 'г') + (c.semi ? '' : ' (1 порция)');
  if (opts.photos !== false) { try { var pid = typeof _dpPhotoOf_ === 'function' ? _dpPhotoOf_(c.code, c.name, tm.file) : ''; if (pid) { var b = DriveApp.getFileById(pid).getBlob(); c.photo = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()); } } catch (e) {} }
  if (!c.ing.length) c.gaps.push('состав');
  if (!c.tech) c.gaps.push('технология');
  if (!c.yieldText) c.gaps.push('выход');
  if (!c.storage) c.gaps.push('условия хранения');
  if (!c.shelf) c.gaps.push('срок реализации');
  if (opts.photos !== false && !c.photo) c.gaps.push('фото');
  return c;
}
function _v73CardHtml_(c) {
  var E = _mcOrgEsc_, no = '<span class="gap">не указано в ТТК</span>', br = function (s) { return E(s).replace(/\n/g, '<br>'); };
  var rows = c.ing.map(function (g) { return '<tr><td>' + E(g.name) + '</td><td class="n">' + E(g.brutto) + '</td><td class="n">' + E(g.netto) + '</td></tr>'; }).join('') || '<tr><td colspan="3">' + no + '</td></tr>';
  var keep = (c.storage ? E(c.storage) : '') + (c.shelf ? (c.storage ? '; ' : '') + 'срок реализации — ' + E(c.shelf) + ' <span class="src">(' + E(c.shelfSrc) + ')</span>' : '');
  return '<div class="ti"><div class="th">№ ' + E(c.code) + '&nbsp;&nbsp;&nbsp;' + E(c.name) + (c.semi && !/п\s*\/\s*ф/i.test(c.name) ? ' (П/Ф)' : '') + (c.version ? '<span class="ver">ТТК, версия ' + E(c.version) + '</span>' : '') + '</div>' +
    '<table class="tg"><tr><td class="cI"><table class="ing"><tr><th>Продукт</th><th class="n">Брутто</th><th class="n">Нетто</th></tr>' + rows +
    '<tr class="out"><td>Выход</td><td colspan="2" class="n">' + (c.yieldText ? E(c.yieldText) : no) + '</td></tr></table><div class="u">Масса, ' + E((c.ing[0] || {}).unit || 'г') + (c.semi ? ', на закладку по ТТК' : ', на 1 порцию') + '</div></td>' +
    '<td class="cT"><div>' + (c.tech ? br(c.tech) : '<b>Технология:</b> ' + no) + '</div><div class="p"><b>' + (c.semi ? 'Хранение' : 'Подача и хранение') + ':</b> ' + (keep || no) + '</div></td>' +
    '<td class="cP">' + (c.photo ? '<img src="' + c.photo + '">' : '<div class="nophoto">МЕСТО ДЛЯ ФОТО</div>') + '</td></tr></table></div>';
}
var MC_V73_CSS_ = '.ti table{font-size:inherit}.ti{page-break-inside:avoid;margin:0 0 14px;font-size:10px}.th{background:#f6a800;font-weight:bold;font-size:12px;padding:4px 6px}.th .ver{float:right;font-weight:normal;font-size:9px}' +
  'table.tg{width:100%;border-collapse:collapse}table.tg>tbody>tr>td,table.tg>tr>td{vertical-align:top;padding:4px 6px 0 0}.cI{width:32%}.cT{width:43%}.cP{width:25%;text-align:center}' +
  'table.ing{width:100%;border-collapse:collapse}table.ing td,table.ing th{border-bottom:1px solid #ddd;padding:2px 3px;text-align:left}table.ing th{color:#666;font-weight:normal}.n{text-align:right;white-space:nowrap}' +
  'tr.out td{background:#fff200;font-weight:bold}.u{color:#888;font-size:8px;margin-top:2px}.p{margin-top:8px}.gap{color:#a33;font-style:italic}.src{color:#888}' +
  '.cP img{max-width:100%;max-height:230px}.nophoto{border:1px dashed #bbb;color:#aaa;padding:60px 4px}h2.cat{background:#f2ece4;padding:3px 6px;margin-top:6px}table.toc td{padding:1px 6px}';

/** Список блюд и категорий для выбора на экране. */
function v73TiList(token) {
  try { _requireAuth_(token, 'catalog|ttk_edit|ttk_approve');
    var D = _v64Dishes_(), items = Object.keys(D.byCode).map(function (k) { var d = D.byCode[k]; return { code: String(d.code), name: _v73T_(d.name), cat: _v73T_(d.cat), semi: !!d.semi, ingredients: (d.ing || []).length }; });
    items.sort(function (a, b) { var na = parseFloat(a.code), nb = parseFloat(b.code); return isFinite(na) && isFinite(nb) && na !== nb ? na - nb : String(a.code).localeCompare(String(b.code)); });
    var cats = []; items.forEach(function (x) { if (x.cat && cats.indexOf(x.cat) < 0) cats.push(x.cat); });
    return _ok_({ items: items, categories: cats });
  } catch (e) { return _failFrom_(e); }
}
/** Собрать ТИ в PDF. json: { codes: [...] } | { category: '…' } | { all: true }; photos: false — без фото. */
function v73TiBuild(json, token) {
  var op = null; try { op = _beginOp_(token, 'catalog|ttk_edit|ttk_approve', 'V73_TI', 'ТИ', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(typeof json === 'string' && !/^\s*\{/.test(json) ? JSON.stringify({ codes: String(json).split(/\s*,\s*/) }) : json), D = _v64Dishes_(), codes = [];
    if (d.all) codes = Object.keys(D.byCode);
    else if (_v73T_(d.category)) codes = Object.keys(D.byCode).filter(function (k) { return _v73T_(D.byCode[k].cat) === _v73T_(d.category); });
    else codes = [].concat(d.codes || []).map(_v73T_).filter(String);
    if (!codes.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите блюдо, категорию или всё меню', op.id); }
    var bad = codes.filter(function (c) { return !D.byCode[c] && !_v64DishOf_(c); }); if (bad.length) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'ТТК не найдены: ' + bad.join(', '), op.id); }
    if (codes.length > 400) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'За раз — не больше 400 карточек: выберите категорию', op.id); }
    var tm = _v73TechMap_(), opts = { photos: d.photos !== false && codes.length <= 120 }, cards = [];
    codes.forEach(function (c) { var x = _v73Card_(c, tm, opts); if (x) cards.push(x); });
    cards.sort(function (a, b) { var sa = MC_V73_SEMI_CATS_.test(a.cat) || a.semi ? 1 : 0, sb = MC_V73_SEMI_CATS_.test(b.cat) || b.semi ? 1 : 0; if (sa !== sb) return sa - sb;
      var na = parseFloat(a.code), nb = parseFloat(b.code); return isFinite(na) && isFinite(nb) && na !== nb ? na - nb : String(a.code).localeCompare(String(b.code)); });
    var E = _mcOrgEsc_, body = '', groups = [];
    cards.forEach(function (c) { var g = c.cat || (c.semi ? 'Полуфабрикаты' : 'Без категории'), last = groups[groups.length - 1]; if (!last || last.name !== g) groups.push(last = { name: g, cards: [] }); last.cards.push(c); });
    if (cards.length > 1) body += '<h2>Оглавление</h2><table class="toc">' + groups.map(function (g) { return '<tr><td colspan="2"><b>' + E(g.name) + '</b></td></tr>' + g.cards.map(function (c) { return '<tr><td>№ ' + E(c.code) + '</td><td>' + E(c.name) + '</td></tr>'; }).join(''); }).join('') + '</table><div style="page-break-after:always"></div>';
    groups.forEach(function (g) { if (cards.length > 1) body += '<h2 class="cat">' + E(g.name) + '</h2>'; body += g.cards.map(_v73CardHtml_).join(''); });
    var title = cards.length === 1 ? 'Технологическая инструкция № ' + cards[0].code + ' «' + cards[0].name + '»' : 'Технологические инструкции для поваров' + (_v73T_(d.category) ? ' — ' + _v73T_(d.category) : '');
    var nums = cards.map(function (c) { return parseFloat(c.code); }).filter(isFinite), range = nums.length > 1 ? ' № ' + Math.min.apply(null, nums) + '–' + Math.max.apply(null, nums) : '';
    var f = _mcPdfSave_(title, body, { landscape: true, css: MC_V73_CSS_, subtitle: cards.length > 1 ? 'Номера совпадают с номерами ТТК' + range + ' · карточек: ' + cards.length : 'Номер совпадает с номером ТТК',
      fileName: (cards.length === 1 ? 'ТИ № ' + cards[0].code + ' ' + cards[0].name : 'ТИ для поваров' + (_v73T_(d.category) ? ' ' + _v73T_(d.category) : '') + range) + ' ' + Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy'), folder: _v73Folder_() });
    var gaps = cards.filter(function (c) { return c.gaps.length; }).map(function (c) { return { code: c.code, name: c.name, gaps: c.gaps }; });
    _audit_(op, 'V73_TI', 'ТИ', cards.length === 1 ? cards[0].code : (d.category || (d.all ? 'всё меню' : codes.length + ' ТТК')), null, { cards: cards.length, fileId: f.fileId, gaps: gaps.length }); _endOp_(op);
    return _ok_({ fileId: f.fileId, url: f.url, name: f.name, sha256: f.sha256, cards: cards.length, photos: opts.photos, gaps: gaps }, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
