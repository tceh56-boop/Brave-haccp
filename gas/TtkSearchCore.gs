// ЦЕХ — TtkSearchCore.gs
// Поиск ТТК блюд и техкарт ПФ одним запросом: название (с опечатками), состав, папка/категория,
// технология; фильтры — вид, статус, источник, проблемы. Заменяет прежний каталог, который
// запрашивал версии по каждому блюду отдельно (N запросов на каждое нажатие клавиши).
// Каждое слово запроса должно найтись хотя бы в одном поле; выше — совпадения в названии.

var TTK_SEARCH_LIMIT = 50;

function _tsNorm_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }

/** Совпадение слова запроса со словами поля: 3 — точно/начало слова, 2 — внутри, 1 — опечатка; 0 — нет. */
function _tsTokenHit_(tok, words, text) {
  for (var i = 0; i < words.length; i++) if (words[i].indexOf(tok) === 0) return 3;
  if (tok.length >= 3 && text.indexOf(tok) !== -1) return 2;
  if (tok.length >= 5) {
    // Опечатка: сравнение с началом слова той же длины ±1 (пропущенная или лишняя буква).
    var lim = tok.length >= 8 ? 2 : 1;
    for (var j = 0; j < words.length; j++) {
      var w = words[j]; if (w.length < tok.length - 1) continue;
      for (var d = -1; d <= 1; d++) if (_irEdit_(tok, w.slice(0, tok.length + d)) <= lim) return 1;
    }
  }
  return 0;
}

function _tsLatest_(rows, verKey) {
  var out = {};
  rows.forEach(function (r) {
    var k = r[verKey], x = out[k] || (out[k] = { latest: null, approved: null, draft: false });
    if (!x.latest || Number(r.version) > Number(x.latest.version)) x.latest = r;
    if (r.status === 'утверждена' && (!x.approved || Number(r.version) > Number(x.approved.version))) x.approved = r;
    if (r.status === 'черновик' || r.status === 'на_согласовании') x.draft = true;
  });
  return out;
}

/**
 * data: {q, ingredient, kind: ''|DISH|PF, status: ''|утверждена|черновик|на_согласовании|нет,
 * source: ''|DRIVE|FILE|MANUAL, problem: ''|placeholder|no_ttk|changed|removed, category, offset}.
 */
function searchTtk_(data, session) {
  data = data || {};
  var org = session.organization_id;
  var names = {};
  findRows_('PRODUCTS', function (p) { return p.organization_id === org; }).forEach(function (p) { names[p.product_id] = p.название; });
  var pfs = findRows_('SEMI_FINISHED', function (p) { return p.organization_id === org; });
  pfs.forEach(function (p) { names[p.pf_id] = p.название; });
  var dishes = findRows_('DISHES', function (d) { return d.organization_id === org && d.статус !== 'архив'; });
  var ids = {}; dishes.forEach(function (d) { ids[d.dish_id] = 1; }); pfs.forEach(function (p) { ids[p.pf_id] = 1; });
  var comp = {};
  findRows_('RECIPES', function (r) { return (r.parent_type === 'DISH' || r.parent_type === 'PF') && ids[r.parent_id]; }).forEach(function (r) { (comp[r.parent_id] = comp[r.parent_id] || []).push(names[r.product_id] || ''); });
  var ttk = _tsLatest_(findRows_('TTK_VERSIONS', function (v) { return v.organization_id === org; }), 'dish_id');
  var pft = _tsLatest_(findRows_('PF_TECH_CARDS', function (c) { return c.organization_id === org; }), 'pf_id');
  var src = {}, pending = {};
  findRows_('TTK_IMPORT_ROWS', function (r) { return r.organization_id === org && r.entity_id; }).forEach(function (r) {
    if (r.status === 'CONFIRMED') src[r.entity_id] = { type: r.drive_file_id ? 'DRIVE' : 'FILE', path: r.source_path, category: r.category };
    if (r.status === 'PREVIEW' && r.change_kind === 'CHANGED') pending[r.entity_id] = { row_id: r.row_id, import_id: r.import_id, changes: _tiJson_(r.diff_json, []).length };
  });
  var drive = {};
  findRows_('TTK_DRIVE_FILES', function (f) { return f.organization_id === org && f.entity_id; }).forEach(function (f) { drive[f.entity_id] = { path: f.path, state: f.sync_state }; if (src[f.entity_id]) src[f.entity_id].type = 'DRIVE'; });
  var items = dishes.map(function (d) { return { type: 'DISH', id: d.dish_id, name: d.название, category: (src[d.dish_id] && src[d.dish_id].category) || d.категория_id || '', yield: d.выход, v: ttk[d.dish_id] }; })
    .concat(pfs.map(function (p) { return { type: 'PF', id: p.pf_id, name: p.название, category: (src[p.pf_id] && src[p.pf_id].category) || '', yield: p.выход + ' ' + (p.единица || ''), v: pft[p.pf_id] }; }));
  var q = _tsNorm_(data.q).split(' ').filter(Boolean), ing = _tsNorm_(data.ingredient).split(' ').filter(Boolean);
  var cat = String(data.category || '');
  var facets = { status: {}, kind: { DISH: 0, PF: 0 }, category: {} };
  var out = [];
  items.forEach(function (it) {
    var v = it.v || {}, latest = v.latest, appr = v.approved;
    var status = latest ? latest.status : 'нет';
    var s = src[it.id], dv = drive[it.id], pend = pending[it.id];
    var problems = [];
    if (!latest) problems.push('нет ' + (it.type === 'PF' ? 'техкарты' : 'ТТК'));
    else if (!appr) problems.push('нет утверждённой версии');
    var placeholder = latest && [latest.условия_хранения, latest.срок_реализации].some(function (x) { return String(x || '').indexOf(TTK_FILL_PLACEHOLDER) !== -1; });
    if (placeholder) problems.push('не заполнены хранение/срок');
    if (pend) problems.push('в файле изменения: ' + pend.changes);
    if (dv && dv.state === 'REMOVED') problems.push('файл удалён с Диска');
    if (data.kind && it.type !== data.kind) return;
    if (data.status && status !== data.status && !(data.status === 'утверждена' && appr)) return;
    if (data.source && (s ? s.type : 'MANUAL') !== data.source) return;
    if (data.problem === 'placeholder' && !placeholder) return;
    if (data.problem === 'no_ttk' && latest) return;
    if (data.problem === 'changed' && !pend) return;
    if (data.problem === 'removed' && !(dv && dv.state === 'REMOVED')) return;
    if (cat && String(it.category).indexOf(cat) !== 0) return;
    var nameN = _tsNorm_(it.name), nameW = nameN.split(' ');
    var fields = [
      { key: 'название', w: 10, text: nameN, words: nameW },
      { key: 'состав', w: 4, list: (comp[it.id] || []).map(_tsNorm_) },
      { key: 'категория', w: 3, text: _tsNorm_(it.category + ' ' + (s ? s.path : '')) },
      { key: 'технология', w: 1, text: _tsNorm_(latest ? latest.технология : '') }
    ];
    fields.forEach(function (f) { if (f.text !== undefined) f.words = f.words || f.text.split(' '); });
    var score = 0, matched = {};
    for (var i = 0; i < q.length; i++) {
      var best = 0, bestKey = '';
      fields.forEach(function (f) {
        var h = 0;
        if (f.list) f.list.forEach(function (x) { var hx = _tsTokenHit_(q[i], x.split(' '), x); if (hx > h) { h = hx; if (hx >= 2) matched['состав: ' + x] = 1; } });
        else h = _tsTokenHit_(q[i], f.words, f.text);
        if (h * f.w > best) { best = h * f.w; bestKey = f.key; }
      });
      if (!best) return;
      score += best; if (bestKey !== 'состав') matched[bestKey] = 1;
    }
    for (var j = 0; j < ing.length; j++) {
      var hit = (comp[it.id] || []).map(_tsNorm_).filter(function (x) { return _tsTokenHit_(ing[j], x.split(' '), x) >= 2; });
      if (!hit.length) return;
      hit.forEach(function (x) { matched['состав: ' + x] = 1; });
    }
    if (q.length && nameN === q.join(' ')) score += 100; else if (q.length && nameN.indexOf(q.join(' ')) === 0) score += 50;
    facets.status[status] = (facets.status[status] || 0) + 1; facets.kind[it.type]++;
    var top = String(it.category).split(' / ')[0]; if (top) facets.category[top] = (facets.category[top] || 0) + 1;
    out.push({ type: it.type, id: it.id, name: it.name, category: it.category, yield: it.yield, status: status, version: latest ? latest.version : '',
      version_id: latest ? (it.type === 'PF' ? latest.pf_tech_id : latest.ttk_version_id) : '', approved_version: appr ? appr.version : '', has_draft: !!v.draft,
      ingredients: (comp[it.id] || []).length, source: s ? s.type : 'MANUAL', source_path: dv ? dv.path : (s ? s.path : ''), drive_state: dv ? dv.state : '',
      pending_change: pend || null, problems: problems, matched: Object.keys(matched).slice(0, 4), score: score });
  });
  out.sort(function (a, b) { return b.score - a.score || String(a.name).localeCompare(String(b.name), 'ru'); });
  var offset = Math.max(0, Number(data.offset) || 0);
  return { total: out.length, offset: offset, items: out.slice(offset, offset + TTK_SEARCH_LIMIT), facets: facets };
}
