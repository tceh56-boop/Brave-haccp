/**
 * MON CHEF — данные для фирменного интерфейса (Console.html).
 *
 * Интерфейс ничего не считает сам: каждый раздел собирается из уже существующих
 * функций системы (банкеты, ТТК, склад, производство, ХАССП, модули V14–V63)
 * и отдаётся в одном формате:
 *   { ok, title, kpis:[{label,value,hint,tone}], tabs:[{title, columns:[{k,l,t}], rows:[…]}],
 *     actions:[{label, module|fn}] }  — только экраны нового интерфейса
 * Типы колонок t: text | num | date | status | pct.
 */

var UI_SECTIONS = ['home', 'banquets', 'menu', 'planning', 'production', 'stock', 'revisions',
  'surplus', 'deficits', 'picking', 'issue', 'haccp', 'reports', 'settings'];

var UI_CACHE_TTL_ = { reports: 300, documents: 300, inspection: 300 }, UI_CACHE_TTL_DEFAULT_ = 120;
/* Значение в CacheService — до 100 КБ; большой экран (меню ТТК) хранится частями по 30 000 символов
   (кириллица — 2 байта на символ). Части пишутся одним putAll и читаются одним getAll;
   если хоть одной части нет — экран собирается заново. */
var UI_CACHE_CHUNK_ = 30000, UI_CACHE_MAX_ = 600000;
function _uiCachePut_(cc, ck, out, ttl) {
  try {
    if (out.length > UI_CACHE_MAX_) return;
    if (out.length <= UI_CACHE_CHUNK_) { cc.put(ck, out, ttl); return; }
    var parts = {}, n = Math.ceil(out.length / UI_CACHE_CHUNK_);
    for (var i = 0; i < n; i++) parts[ck + '_' + i] = out.slice(i * UI_CACHE_CHUNK_, (i + 1) * UI_CACHE_CHUNK_);
    parts[ck] = '#parts:' + n;
    cc.putAll(parts, ttl);
  } catch (e) {}
}
function _uiCacheGet_(cc, ck) {
  var v = cc.get(ck); if (!v || v.indexOf('#parts:') !== 0) return v;
  var n = parseInt(v.slice(7), 10), keys = []; for (var i = 0; i < n; i++) keys.push(ck + '_' + i);
  var got = cc.getAll(keys), out = '';
  for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; out += got[keys[j]]; }
  return out;
}
function uiData(token, section, opts) {
  var s;
  try { s = _requireAuth_(token); } catch (e) { return { ok: false, auth: true, error: String(e.message || e) }; }
  section = UI_SECTIONS.indexOf(section) >= 0 ? section : 'home';
  // этап 10.7: раздел только при праве (MC_RB_SECTIONS_); попытка — в аудит
  if (!_mcRbSectionAllowed_(s, section)) {
    _mcRbAuditDenied_(s, 'section:' + section, MC_RB_SECTIONS_[section] || 'system', '');
    return { ok: false, forbidden: true, http: 403, section: section, error: '403 — недостаточно прав: раздел недоступен для вашей роли' };
  }
  try {
    // Кэш готового экрана (ТЗ: скорость). Ключ — раздел, пользователь, параметры и «поколение данных»:
    // любая запись в таблицу (любым пользователем или по расписанию) меняет поколение, и все
    // сохранённые экраны сразу устаревают. Срок жизни — страховка от правок таблицы вручную и
    // от «стареющих» по времени сведений (просрочки), поэтому короткий.
    var gen = _mcRcOn_() ? _mcGen_() : '', ttl = UI_CACHE_TTL_[section] || UI_CACHE_TTL_DEFAULT_, cc = null, ck = '';
    if (gen) {
      try {
        var who = String(s.user_id || s.userId || s.name || s.fullName || '') + '|' + String(s.role || '');
        ck = 'mc_ui3_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, [section, who, JSON.stringify(opts || {}), gen].join('#'), Utilities.Charset.UTF_8));
        cc = CacheService.getScriptCache(); var hit = _uiCacheGet_(cc, ck); if (hit) { var hv = JSON.parse(hit); hv.cached = true; return hv; }
      } catch (e) { cc = null; }
    }
    var wrote0 = _MC_RC_WROTE_;
    var res = _UI_BUILDERS_[section](token, opts || {}, s);
    _uiAccessFilter_(res, s);   // этап 10.7: кнопки, плитки и переходы — только доступные; цены — только с правом «себестоимость»
    res.ok = true; res.section = section;
    var out = JSON.stringify(_uiPlain_(res)); // без Date: google.script.run их не пропускает
    // не кэшировать, если сам раздел что-то записал (данные сменили поколение)
    if (cc && _MC_RC_WROTE_ === wrote0) _uiCachePut_(cc, ck, out, ttl);
    return JSON.parse(out);
  } catch (e) {
    return { ok: false, section: section, error: String(e && e.message || e) };
  }
}

/** Этап 10.7: убрать из экрана то, на что у сотрудника нет права (интерфейс показывает только доступное). */
function _uiAccessFilter_(res, s) {
  if (!res || !s || s.dev) return res;
  var secOk = function (g) { return !g || !g.sec || _mcRbSectionAllowed_(s, g.sec); };
  var modOk = function (m) { return _mcRbHasExact_(s, MC_RB_MODULES_[m] || 'system'); };
  if (res.actions) res.actions = res.actions.filter(function (a) { return a.module ? modOk(a.module) : a.fn ? _mcRbHasExact_(s, MC_RB_UI_FN_[a.fn] || '*') : true; });
  if (res.kpis) res.kpis = res.kpis.filter(function (k) { return secOk(k.go); });
  if (res.readiness && !_mcRbSectionAllowed_(s, 'inspection')) delete res.readiness;
  if (res.readiness && res.readiness.items) res.readiness.items.forEach(function (x) { if (x.go && ((x.go.module && !modOk(x.go.module)) || !secOk(x.go))) delete x.go; });
  var money = !_mcRbHasExact_(s, 'costs');
  (res.tabs || []).forEach(function (t) {
    var drop = {};
    if (money && t.columns) t.columns = t.columns.filter(function (c) { if (/₽/.test(String(c.l || ''))) { drop[c.k] = 1; return false; } return true; });
    (t.rows || []).forEach(function (r) { Object.keys(drop).forEach(function (k) { delete r[k]; }); if (r && r._go && !secOk(r._go)) delete r._go; });
  });
  return res;
}

// Текущий пользователь (для шапки) по токену.
function uiMe(token) {
  try {
    var s = _requireAuth_(token);
    var a = _mcRbAccess_(s);   // этап 10.7: разделы, страницы и права — интерфейс показывает только доступное
    a.ok = true; return a;
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// ---------------------------------------------------------------- helpers
function _uiJ_(x) {
  if (x === null || x === undefined) return null;
  var v = x;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return null; } }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (v.success === false || v.ok === false) return null;
    if ('data' in v && (v.success === true || v.ok === true)) return v.data;
  }
  return v;
}
function _uiArr_(x) { var v = _uiJ_(x); return Array.isArray(v) ? v : []; }
function _uiTry_(fn, dflt) { try { var v = fn(); return v === undefined || v === null ? dflt : v; } catch (e) { return dflt; } }
function _uiSheetRows_(name, limit) {
  var sh = _book_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0], out = [];
  for (var i = v.length - 1; i >= 1 && out.length < (limit || 300); i--) {
    if (!v[i].some(function (x) { return x !== '' && x !== null; })) continue;
    var o = {}; h.forEach(function (k, j) { o[k] = v[i][j] instanceof Date ? _uiDate_(v[i][j]) : v[i][j]; });
    out.push(o);
  }
  return out;
}
function _uiDate_(d) {
  if (!(d instanceof Date) || isNaN(d)) return d ? String(d) : '';
  return Utilities.formatDate(d, _mcTz_(), 'dd.MM.yyyy');
}
function _uiToday_() { return Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd'); }
function _uiIso_(s) {
  // 'дд.мм.гггг' или 'гггг-мм-дд' → 'гггг-мм-дд' для сравнения
  s = String(s || '');
  var m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s); if (m) return m[3] + '-' + m[2] + '-' + m[1];
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? m[0] : '';
}
function _uiRu_(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : (iso || ''); }
function _uiMonday_(d) { d = new Date(d); var w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return Utilities.formatDate(d, _mcTz_(), 'yyyy-MM-dd'); }
function _uiStatusRu_(s) {
  var map = { PLANNED: 'Запланировано', IN_PROGRESS: 'В работе', DONE: 'Выполнено', COMPLETED: 'Выполнено',
    PARTIAL: 'Частично', CANCELLED: 'Отменено', OPEN: 'Открыто', CLOSED: 'Закрыто', READY: 'Готово',
    SHORTAGE: 'Нехватка', CRITICAL: 'Критический', HIGH: 'Высокий', MEDIUM: 'Средний', LOW: 'Низкий',
    SUGGESTED: 'Рекомендация', APPROVED: 'Утверждено', RESERVED: 'В резерве', PICKED: 'Отобрано',
    todo: 'Не начато', in_progress: 'В работе', done: 'Выполнено', active: 'Активна', expired: 'Просрочена',
    consumed: 'Израсходована', DRAFT: 'Черновик', REVIEW: 'На проверке', EXCESS: 'Излишек', NORMAL: 'Обычный',
    SENT: 'Отправлен', CONFIRMED: 'Подтверждён', RECEIVED: 'Принят', FAILED: 'Не выполнено', NEW: 'Новое' };
  return map[s] || map[String(s).toUpperCase()] || String(s || '');
}
function _uiCol_(k, l, t) { return { k: k, l: l, t: t || 'text' }; }
// Даты для экрана: «21.08.2026», время (в таблице хранится как 30.12.1899 15:00) — «15:00».
// Без этого Date уходил в интерфейс в мировом времени: полночь по Москве
// превращалась в предыдущий день, а время — в «1899-12-30T12:00:00Z».
var _UI_DSTR_ = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2} \d{4} \d{2}:\d{2}:\d{2} GMT/;
function _uiFmtDate_(d) {
  var tz = _mcTz_();
  if (d.getFullYear() < 1901) return _mcTimeStr_(d);
  var hm = Utilities.formatDate(d, tz, 'HH:mm');
  return Utilities.formatDate(d, tz, 'dd.MM.yyyy') + (hm === '00:00' ? '' : ' ' + hm);
}
function _uiPlain_(x) {
  if (x === null || x === undefined) return x;
  if (Object.prototype.toString.call(x) === '[object Date]') return isNaN(x.getTime()) ? '' : _uiFmtDate_(x);
  if (typeof x === 'string') { if (/^1899-12-3[01]T\d{2}:\d{2}/.test(x)) return _mcTimeStr_(x); if (_UI_DSTR_.test(x)) { var d = new Date(x); return isNaN(d.getTime()) ? x : _uiFmtDate_(d); } return x; }
  if (Array.isArray(x)) return x.map(_uiPlain_);
  if (typeof x === 'object') { var o = {}; Object.keys(x).forEach(function (k) { o[k] = _uiPlain_(x[k]); }); return o; }
  return x;
}

// ---------------------------------------------------------------- sections
var _UI_BUILDERS_ = {

  home: function (token, opts, s) {
    var today = _uiToday_();
    // этап 10.7: главная собирает только то, что сотруднику доступно (администратор — банкеты; повар — свой цех)
    var can = function (sec) { return !s || _mcRbSectionAllowed_(s, sec); };
    var evs = can('banquets') ? _uiArr_(_uiTry_(getEvents, '[]')) : [];
    var upcoming = evs.filter(function (e) { return _uiIso_(e.date) >= today; })
      .sort(function (a, b) { return _uiIso_(a.date) < _uiIso_(b.date) ? -1 : 1; });
    var orders = can('production') ? _uiArr_(_uiTry_(function () { return getProductionOrders('', token); }, null)).filter(function (o) { return !s || _mcRbShopAllowed_(s, o.workshop); }) : [];
    var inWork = orders.filter(function (o) { return o.status === 'IN_PROGRESS' || o.status === 'PLANNED'; });
    var stock = can('stock') ? _uiArr_(_uiTry_(getStockBalances, '[]')) : [];
    var low = stock.filter(function (x) { return x.minQty > 0 && x.qty < x.minQty; });
    var checks = s && !_mcRbHasExact_(s, 'journals|haccp_view') ? [] : _uiArr_(_uiTry_(function () { return getPendingChecks(token); }, null));
    var kanban = can('production') ? _uiArr_(_uiTry_(function () { return getKanbanTasks(_uiRu_(today), ''); }, '[]')).filter(function (t) { return !s || _mcRbShopAllowed_(s, t.workshop); }) : [];
    var tasks = checks.slice(0, 6).map(function (c) {
    return {
      time: c['время'] || '', task: (c['журнал'] || '') + (c['объект'] ? ' — ' + c['объект'] : ''), status: c['статус'] || 'Ожидает', _go: { sec: 'haccp', tab: 0 } };
    }).concat(kanban.slice(0, 6).map(function (t) {
      return { time: t.dueTime || '', task: t.dishName + (t.stepText ? ' — ' + t.stepText : ''), status: _uiStatusRu_(t.status), _go: { sec: 'production', tab: 1, q: String(t.dishName || '') } };
    }));
    var readiness = can('inspection') ? _uiTry_(function () { return _mcReadinessCached_(); }, null) : null;
    var me = s ? _mcRbAccess_(s) : null;
    return {
      readiness: readiness,
      title: 'Главная', subtitle: me && me.note ? me.note : (me && me.shop && me.shop.length ? 'Цех: ' + me.shop.filter(function (x) { return /^(Холодный|Горячий|Кондитерский) цех$/.test(x); }).join(', ') + ' — показаны задания своего цеха' : ''),
      kpis: [
        { label: 'Банкеты', value: upcoming.length, hint: 'предстоящих', tone: 'wine', go: { sec: 'banquets', tab: 0, q: 'Запланирован' } },
        { label: 'Производство', value: inWork.length + kanban.filter(function (t) { return t.status === 'in_progress'; }).length, hint: 'в работе', tone: 'gold', go: { sec: 'production', tab: 1, q: 'В работе' } },
        { label: 'Склад', value: low.length, hint: 'ниже минимума', tone: low.length ? 'red' : 'green', go: { sec: 'stock', tab: 0, q: 'Ниже минимума' } },
        { label: 'ХАССП', value: checks.length, hint: 'ожидают проверки', tone: checks.length ? 'red' : 'green', go: { sec: 'haccp', tab: 0 } }
      ].filter(function (k) { return k.label !== 'ХАССП' || !s || _mcRbHasExact_(s, 'journals|haccp_view'); }).concat(_uiHaccpTodayKpi_(s)),
      tabs: [
        { title: 'Сегодняшние задачи', columns: [_uiCol_('time', 'Время'), _uiCol_('task', 'Задача'), _uiCol_('status', 'Статус', 'status')], rows: tasks },
        { title: 'Ближайшие банкеты', columns: [_uiCol_('date', 'Дата', 'date'), _uiCol_('name', 'Мероприятие'), _uiCol_('guests', 'Гостей', 'num')],
          rows: upcoming.slice(0, 8).map(function (e) { return { date: e.date, name: e.format || e.name || 'Банкет', guests: e.guests || '',
            _go: { sec: 'banquets', tab: 0, q: String(e.date || '') } }; }) }
      ].filter(function (t) { return t.title === 'Ближайшие банкеты' ? can('banquets') : (can('production') || !s || _mcRbHasExact_(s, 'journals|haccp_view')); }),
      actions: [{ label: 'Моя смена', module: 'myshift' }, { label: 'Задания кухни', module: 'kanban' }, { label: '✓ Чек-листы', module: 'checklistrun' }, { label: 'Задачи', module: 'tasks' }]
    };
  },

  banquets: function (token) {
    var evs = _uiArr_(_uiTry_(getEvents, '[]'));
    var dash = _uiArr_(_uiTry_(function () { return getV28BanquetDashboard(token); }, null));
    var ready = {}; dash.forEach(function (d) { ready[d.id] = d; });
    var today = _uiToday_();
    var rows = evs.map(function (e) {
      var d = ready[e.id];
      var st = d ? (d.complete ? 'Выдано' : d.ready ? 'Готово к выдаче' : d.shortages ? 'Нехватка' : 'В процессе')
        : (_uiIso_(e.date) < today ? 'Прошёл' : 'Запланирован');
      var pct = d && d.rows ? Math.round((d.rows - d.shortages) / d.rows * 100) : 0;
      return { _banq: e.id, date: e.date, time: e.time || '', name: e.format || e.name || 'Банкет', guests: e.guests || '', status: st, progress: pct, responsible: e.responsible || '' };
    }).sort(function (a, b) { return _uiIso_(a.date) < _uiIso_(b.date) ? 1 : -1; });
    var upcoming = rows.filter(function (r) { return _uiIso_(r.date) >= today; });
    return {
      title: 'Банкеты',
      kpis: [{ label: 'Предстоящих', value: upcoming.length, go: { sec: 'banquets', tab: 0, q: 'Запланирован' } }, { label: 'Всего', value: rows.length },
        { label: 'Гостей впереди', value: upcoming.reduce(function (s, r) { return s + (parseInt(r.guests, 10) || 0); }, 0) }],
      tabs: [{ title: 'Все банкеты', detail: 'banq', columns: [_uiCol_('date', 'Дата', 'date'), _uiCol_('name', 'Название'), _uiCol_('guests', 'Гостей', 'num'),
        _uiCol_('status', 'Статус', 'status'), _uiCol_('progress', 'Готовность', 'pct'), _uiCol_('responsible', 'Ответственный')], rows: rows }],
      actions: [{ label: '+ Новый банкет', fn: 'banqNew' }, { label: '📷 Скан бланка', fn: 'banqScanPick' }, { label: 'Выдача', module: 'fulfillment' }, { label: 'Закрытие', module: 'closure' }, { label: 'Журнал продаж', module: 'sales' }]
    };
  },

  menu: function (token, opts) {
    var idx = _buildDishIndexes_();
    var codes = Object.keys(idx.dishByCode);
    // «Состав» (тысячи строк) отдаётся отдельным запросом, когда вкладку открыли
    if (opts && opts.tab === 'sostav') {
      var r1s = function (x) { return Math.round((Number(x) || 0) * 10) / 10; }, out = [];
      codes.forEach(function (code) {
        var d = idx.dishByCode[code];
        d.ing.forEach(function (x) {
          var sub = _findSubDish_(x[0], idx.dishByNormName, idx.dishByLooseName);
          var isPf = !!sub || /п\s*[\/\-]\s*ф/i.test(String(x[0]));
          out.push({ _code: code, dish: d.name, ing: x[0], brutto: r1s(x[1]), netto: r1s(x[3]), out: r1s(x[4]), unit: x[2],
            kind: sub ? 'П/Ф' : (isPf ? 'П/Ф без карточки' : 'Продукт') });
        });
      });
      return { title: 'Меню и ТТК', partial: 'sostav', rows: out };
    }
    var pa = _uiJ_(_uiTry_(function () { return getTTKPendingApproval(token); }, null)) || {};
    var pending = (pa['карты'] || []).filter(function (p) { return (p['ожидают'] || []).length; });
    var pend = {}; pending.forEach(function (p) { pend[p['код']] = true; });
    var costs = {};
    _uiTry_(function () {
      var c = _uiJ_(getDishesCosts(JSON.stringify(codes.slice(0, 300)), token));
      if (c && !c.forbidden) Object.keys(c).forEach(function (k) { costs[k] = c[k] && (c[k].cost || c[k].total || c[k]); });
    }, null);
    var r1 = function (x) { return Math.round((Number(x) || 0) * 10) / 10; };
    var rows = [], sost = [], noCard = {};
    codes.forEach(function (code) {
      var d = idx.dishByCode[code], cost = costs[code];
      var pfCount = 0;
      d.ing.forEach(function (x) {
        var sub = _findSubDish_(x[0], idx.dishByNormName, idx.dishByLooseName);
        var isPf = !!sub || /п\s*[\/\-]\s*ф/i.test(String(x[0]));
        if (isPf) pfCount++;
        if (isPf && !sub) noCard[x[0]] = (noCard[x[0]] || []).concat(d.name);
        sost.push(1);
      });
      rows.push({ _code: code, name: d.name, cat: '', yield: d.yieldBase ? r1(d.yieldBase) : '', yu: d.yieldBase ? d.yieldUnit : '',
        ing: d.ing.length, pf: pfCount, cost: typeof cost === 'number' ? Math.round(cost) : '',
        status: pend[code] ? 'На согласовании' : (d.semi ? 'Полуфабрикат' : 'Активно') });
    });
    // папка ttk, в которой лежит карточка (после синхронизации), иначе категория
    var tree = _uiTry_(function () { var t = JSON.parse(getTTKTree()); return t && t.ok ? t : null; }, null);
    var synced = !!(tree && tree.synced);
    var known = {}; if (synced) tree.folders.forEach(function (f) { known[f.path] = true; });
    rows.forEach(function (r) {
      var d = idx.dishByCode[r._code];
      r._path = synced ? (d.path === tree.appPath ? '__app__' : (known[d.path] ? d.path : '')) : (d.cat || 'Без категории');
      r.cat = synced ? (r._path === '__app__' ? 'Созданы в приложении' : (r._path ? r._path : tree.rootName)) : (d.cat || '');
    });
    // карты, где состав записан дважды подряд — сырьё по ним считается вдвое (исправление — черновик версии)
    var dbl = codes.filter(function (c) { return _pwDoubled_(idx.dishByCode[c]); }).map(function (c) { var d = idx.dishByCode[c];
      return { _code: c, name: d.name, rows: d.ing.length, half: d.ing.length / 2, status: pend[c] ? 'Черновик на согласовании' : 'Состав задвоен' }; });
    var miss = Object.keys(noCard).map(function (n) { return { ing: n, used: noCard[n].slice(0, 3).join(', ') + (noCard[n].length > 3 ? ' и ещё ' + (noCard[n].length - 3) : ''), status: 'Нет карточки' }; });
    return {
      title: 'Меню и ТТК', subtitle: 'Нажмите на блюдо — состав и раскладка до сырья с учётом полуфабрикатов',
      kpis: [{ label: 'Блюд', go: { sec: 'menu', tab: 1 }, value: rows.filter(function (r) { return r.status !== 'Полуфабрикат'; }).length },
        { label: 'Полуфабрикатов', go: { sec: 'menu', tab: 1, q: 'Полуфабрикат' }, value: codes.filter(function (c) { return idx.dishByCode[c].semi; }).length },
        { label: 'На согласовании', go: { sec: 'menu', tab: 5 }, value: pending.length, tone: pending.length ? 'gold' : '' },
        { label: 'П/Ф без карточки', go: { sec: 'menu', tab: 3 }, value: miss.length, tone: miss.length ? 'red' : 'green' },
        { label: 'Задвоенный состав', go: { sec: 'menu', tab: 4 }, value: dbl.length, tone: dbl.length ? 'red' : 'green', hint: dbl.length ? 'сырьё по ним считается вдвое' : '' }],
      tabs: [
        { title: 'Папки ТТК', detail: 'dish', tree: { synced: synced, rootName: synced ? tree.rootName : 'ttk', rootId: synced ? tree.rootId : '',
            updated: synced ? tree.updated : '', folders: synced ? tree.folders : [] },
          columns: [_uiCol_('name', 'Блюдо'), _uiCol_('cat', 'Папка')], rows: [], rowsOf: 1 },
        { title: 'Блюда', detail: 'dish', columns: [_uiCol_('name', 'Блюдо'), _uiCol_('cat', synced ? 'Папка ТТК' : 'Категория'), _uiCol_('yield', 'Выход', 'num'), _uiCol_('yu', 'Ед.'),
          _uiCol_('ing', 'Ингр.', 'num'), _uiCol_('pf', 'В т.ч. п/ф', 'num'), _uiCol_('cost', 'Себестоимость, ₽', 'num'), _uiCol_('status', 'Статус', 'status')], rows: rows },
        { title: 'Состав', detail: 'dish', columns: [_uiCol_('dish', 'Блюдо'), _uiCol_('ing', 'Ингредиент'), _uiCol_('brutto', 'Брутто', 'num'), _uiCol_('netto', 'Нетто', 'num'),
          _uiCol_('out', 'Выход', 'num'), _uiCol_('unit', 'Ед.'), _uiCol_('kind', 'Тип', 'status')], rows: [], lazy: 'sostav', total: sost.length },
        { title: 'П/Ф без карточки', columns: [_uiCol_('ing', 'Полуфабрикат в составе'), _uiCol_('used', 'Где используется'), _uiCol_('status', 'Статус', 'status')], rows: miss },
        { title: 'Задвоенный состав', detail: 'dish', columns: [_uiCol_('name', 'Карта'), _uiCol_('rows', 'Строк сейчас', 'num'), _uiCol_('half', 'Должно быть', 'num'), _uiCol_('status', 'Статус', 'status')], rows: dbl },
        { title: 'На согласовании', columns: [_uiCol_('name', 'Блюдо'), _uiCol_('current', 'Действующая версия'), _uiCol_('version', 'Новая версия'), _uiCol_('status', 'Статус', 'status'), _uiCol_('author', 'Автор')],
          rows: pending.map(function (p) { var w = p['ожидают'][p['ожидают'].length - 1] || {};
            return { name: p['название'] || p['код'], current: p['действующая'] || '—', version: w['версия'] || '', status: w['статус'] || '', author: w['автор'] || '' }; }) }
      ],
      actions: (dbl.some(function (x) { return x.status === 'Состав задвоен'; }) ? [{ label: '✎ Исправить задвоенные карты', fn: 'ttkFixDoubled' }] : []).concat([{ label: '⟳ Синхронизировать с ttk', fn: 'syncTtk' }, { label: '+ Добавить блюдо', fn: 'dishNew' }, { label: '🖼 Фото блюд', fn: 'dpOpen' }, { label: 'Мастер ТТК', module: 'ttkmaster' }, { label: 'Аллергены', module: 'allergens' }, { label: 'КБЖУ продуктов', module: 'nutrition' }, { label: 'ТТК → ППК', module: 'ttkppk' }])
    };
  },

  planning: function (token) {
    var plan = _uiJ_(_uiTry_(function () { return getWeeklyOperationalPlan(_uiMonday_(new Date()), token); }, null)) || {};
    var purchase = plan.purchase || [], pf = plan.pfShortages || [], evs = plan.events || [];
    var row = function (p) {
      var pct = p.required ? Math.min(100, Math.round((p.stock || 0) / p.required * 100)) : 100;
      return { name: p.name, unit: p.unit || '', required: Math.round((p.required || 0) * 100) / 100, stock: Math.round((p.stock || 0) * 100) / 100,
        shortage: Math.round((p.shortage || 0) * 100) / 100, cover: pct, status: p.shortage > 0 ? 'Дефицит' : 'Достаточно' };
    };
    var cols = [_uiCol_('name', 'Позиция'), _uiCol_('required', 'Потребность', 'num'), _uiCol_('stock', 'Склад', 'num'),
      _uiCol_('shortage', 'Дефицит', 'num'), _uiCol_('unit', 'Ед.'), _uiCol_('cover', 'Покрытие', 'pct'), _uiCol_('status', 'Статус', 'status')];
    return {
      title: 'Планирование',
      subtitle: plan.weekFrom ? 'Неделя ' + _uiRu_(plan.weekFrom) + ' — ' + _uiRu_(plan.weekTo) : '',
      kpis: [{ label: 'Банкетов на неделе', value: evs.length }, { label: 'Закупить', go: { sec: 'planning', tab: 1 }, value: purchase.filter(function (p) { return p.shortage > 0; }).length, tone: 'gold' },
        { label: 'Произвести П/Ф', go: { sec: 'production', tab: 0 }, value: pf.filter(function (p) { return p.shortage > 0; }).length, tone: 'wine' }],
      // «Неделя» — банкеты по дням, каждый раскрывается с посчитанными ТТК и закупкой (из Mon Cher)
      tabs: [{ title: 'Неделя', panel: 'week', columns: [], rows: [] }, { title: 'Закупка', columns: cols, rows: purchase.map(row) }, { title: 'Полуфабрикаты', columns: cols, rows: pf.map(row) }],
      actions: [{ label: 'Диспетчер недели', module: 'weekly' }, { label: 'Единый диспетчер', module: 'dispatcher' }]
    };
  },

  production: function (token, opts, s) {
    // этап 10.7: повар и кондитер видят задания и выпуски своего цеха (п/ф без цеха — оба цеха поваров)
    var mine = function (w) { return !s || _mcRbShopAllowed_(s, w); };
    var orders = _uiArr_(_uiTry_(function () { return getProductionOrders('', token); }, null)).filter(function (o) { return mine(o.workshop); });
    var tasks = _uiArr_(_uiTry_(function () { return getKanbanTasks('', ''); }, '[]')).filter(function (t) { return mine(t.workshop); });
    return {
      title: 'Производство',
      kpis: [{ label: 'Заданий в работе', go: { sec: 'production', tab: 1, q: 'В работе' }, value: tasks.filter(function (t) { return t.status === 'in_progress'; }).length, tone: 'gold' },
        { label: 'Не начато', go: { sec: 'production', tab: 1, q: 'Не начато' }, value: tasks.filter(function (t) { return t.status === 'todo'; }).length },
        { label: 'Выпусков', go: { sec: 'production', tab: 2 }, value: orders.length }],
      tabs: [
        // производство п/ф: потребность банкетов → план → начать → замеры ККТ → выпуск → этикетка (из Mon Cher)
        { title: 'Полуфабрикаты', panel: 'prod', columns: [], rows: [] },
        { title: 'Задания', columns: [_uiCol_('date', 'Дата', 'date'), _uiCol_('time', 'Время'), _uiCol_('dish', 'Продукт'), _uiCol_('qty', 'Кол-во', 'num'),
          _uiCol_('status', 'Статус', 'status'), _uiCol_('who', 'Исполнитель')],
          rows: tasks.slice(0, 300).map(function (t) { return { date: t.date, time: t.dueTime || '', dish: t.dishName + (t.stepText ? ' — ' + t.stepText : ''), qty: t.qty, status: _uiStatusRu_(t.status), who: t.assignedTo || '' }; }) },
        { title: 'Выпуск П/Ф', columns: [_uiCol_('start', 'Начало', 'date'), _uiCol_('name', 'Продукт'), _uiCol_('planned', 'План', 'num'), _uiCol_('actual', 'Факт', 'num'),
          _uiCol_('unit', 'Ед.'), _uiCol_('workshop', 'Цех'), _uiCol_('status', 'Статус', 'status')],
          rows: orders.map(function (o) { return { start: o.start, name: o.name, planned: o.planned, actual: o.actual === null ? '' : o.actual, unit: o.unit, workshop: o.workshop, status: _uiStatusRu_(o.status) }; }) }
      ],
      actions: [{ label: 'Задания кухни', module: 'kanban' }, { label: 'Бракераж', module: 'brakerage' }, { label: 'Очередь печати', module: 'printqueue' }, { label: 'Моя смена', module: 'myshift' }, { label: 'Производственные задачи', module: 'productiontasks' }, { label: 'Планировщик', module: 'scheduler' }, { label: 'Производственный выпуск', module: 'execution' }, { label: 'Отбор сырья', module: 'picking' }, { label: 'Приход п/ф', module: 'pfincome' }, { label: 'Задачи', module: 'tasks' }, { label: '🏷 Этикетка вручную', module: 'labels' }]
    };
  },

  stock: function () {
    var bal = _uiArr_(_uiTry_(getStockBalances, '[]'));
    var batches = _uiArr_(_uiTry_(function () { return getStockBatches(true); }, '[]'));
    var orders = _uiArr_(_uiTry_(function () { return getSupplierOrders(''); }, '[]'));
    var cnt = {}; batches.forEach(function (b) { cnt[String(b.name).toLowerCase()] = (cnt[String(b.name).toLowerCase()] || 0) + 1; });
    var bc = _uiTry_(function () { return _bcControlList_(); }, null) || { quarantine: [], recheck: [], blocked: [], expired: [] };
    var ctl = [].concat(bc.quarantine.map(function (x) { x.st = x.last && x.last.decision === 'QUARANTINE' ? 'Карантин' : 'Ждёт входного контроля'; return x; }),
      bc.recheck.map(function (x) { x.st = 'Повторный контроль'; return x; }), bc.blocked.map(function (x) { x.st = 'Брак'; return x; }),
      bc.expired.map(function (x) { x.st = 'Просрочена'; return x; }));
    return {
      title: 'Склад',
      kpis: [{ label: 'Позиций', value: bal.length, go: { sec: 'stock', tab: 0 } }, { label: 'Ниже минимума', value: bal.filter(function (x) { return x.minQty > 0 && x.qty < x.minQty; }).length, tone: 'red', go: { sec: 'stock', tab: 0, q: 'Ниже минимума' } },
        { label: 'Истекает ≤ 3 дн.', value: batches.filter(function (b) { return b.daysLeft !== null && b.daysLeft <= 3; }).length, tone: 'gold', go: { sec: 'stock', tab: 1, q: 'Истекает' } },
        { label: 'Контроль партий', value: bc.quarantine.length + bc.recheck.length, hint: 'карантин и повторный контроль', tone: bc.quarantine.length + bc.recheck.length ? 'red' : '', go: { sec: 'stock', tab: 3 } }],
      tabs: [
        { title: 'Остатки', columns: [_uiCol_('name', 'Продукт'), _uiCol_('qty', 'Остаток', 'num'), _uiCol_('unit', 'Ед.'), _uiCol_('batches', 'Партии', 'num'),
          _uiCol_('min', 'Минимум', 'num'), _uiCol_('status', 'Статус', 'status')],
          rows: bal.map(function (x) { return { name: x.name, qty: Math.round(x.qty * 100) / 100, unit: x.unit, batches: cnt[String(x.name).toLowerCase()] || 0, min: x.minQty || '',
            status: x.minQty > 0 && x.qty < x.minQty ? 'Ниже минимума' : (x.qty <= 0 ? 'Нет в наличии' : 'В норме') }; }) },
        { title: 'Партии', columns: [_uiCol_('name', 'Продукт'), _uiCol_('remain', 'Остаток', 'num'), _uiCol_('unit', 'Ед.'), _uiCol_('received', 'Получено', 'date'),
          _uiCol_('expiry', 'Годен до', 'date'), _uiCol_('days', 'Дней', 'num'), _uiCol_('status', 'Статус', 'status')],
          rows: batches.map(function (b) { return { name: b.name, remain: b.remain, unit: b.unit, received: b.received, expiry: b.expiry, days: b.daysLeft === null ? '' : b.daysLeft,
            status: b.daysLeft !== null && b.daysLeft < 0 ? 'Просрочена' : (b.daysLeft !== null && b.daysLeft <= 3 ? 'Истекает' : 'В норме') }; }) },
        { title: 'Поступления', columns: [_uiCol_('date', 'Дата', 'date'), _uiCol_('supplier', 'Поставщик'), _uiCol_('items', 'Позиций', 'num'), _uiCol_('total', 'Сумма, ₽', 'num'), _uiCol_('status', 'Статус', 'status')],
          rows: orders.map(function (o) { return { date: o.date, supplier: o.supplier, items: (o.items || []).length, total: o.total, status: _uiStatusRu_(o.status) }; }) },
        { title: 'Контроль партий', columns: [_uiCol_('name', 'Продукт'), _uiCol_('qty', 'Остаток', 'num'), _uiCol_('unit', 'Ед.'), _uiCol_('received', 'Получено', 'date'),
          _uiCol_('doc', 'Документ'), _uiCol_('why', 'Причина'), _uiCol_('status', 'Статус', 'status')],
          rows: ctl.map(function (x) { return { name: x.product, qty: x.qty, unit: x.unit, received: x.received, doc: x.docRef, why: x.last && x.last.reasons ? x.last.reasons : '', status: x.st }; }) }
      ],
      actions: [{ label: '+ Приход', module: 'income' }, { label: 'Партия: QR, сроки, места', module: 'batch' }, { label: 'Обработка сырья: дефрост, зачистка, разбор', module: 'processing' }, { label: 'Заказы поставщикам', module: 'orders' }, { label: 'Контроль партий', module: 'batchcontrol' }, { label: 'Поставщики', module: 'suppliers' }, { label: 'Документы, ВСД, маркировка', module: 'supplydocs' }, { label: 'Норма запаса', module: 'minstock' }, { label: 'Нормы отходов', module: 'wastenorms' }, { label: 'Изменения цен', module: 'prices' }, { label: '➖ Списание', module: 'writeoff' }, { label: 'Приход п/ф', module: 'pfincome' }, { label: 'Журнал склада', module: 'stockops' }]   // места, FEFO и этикетки — в карточке партии («Партия: QR, сроки, места»)
    };
  },

  revisions: function () {
    var docs = _uiSheetRows_(V49_REV.DOC), lines = _uiSheetRows_(V49_REV.LINE, 500);
    return {
      title: 'Ревизии',
      kpis: [{ label: 'Ревизий', value: docs.length }, { label: 'Излишков', value: lines.filter(function (x) { return x.VarianceType === 'EXCESS'; }).length, tone: 'gold', go: { sec: 'revisions', tab: 1 } },
        { label: 'Недостач', value: lines.filter(function (x) { return x.VarianceType === 'SHORTAGE'; }).length, tone: 'red', go: { sec: 'revisions', tab: 1 } }],
      tabs: [
        { title: 'Ревизии', columns: [_uiCol_('date', 'Дата', 'date'), _uiCol_('place', 'Склад'), _uiCol_('who', 'Ответственный'), _uiCol_('status', 'Статус', 'status')],
          rows: docs.map(function (d) { return { date: d.CreatedAt || d.Date || d.StartedAt || '', place: d.Location || d.LocationID || d.Scope || 'Основной', who: d.CreatedBy || d.Responsible || '', status: _uiStatusRu_(d.Status) }; }) },
        { title: 'Расхождения', columns: [_uiCol_('product', 'Продукт'), _uiCol_('sys', 'По учёту', 'num'), _uiCol_('fact', 'Факт', 'num'), _uiCol_('diff', 'Разница', 'num'), _uiCol_('type', 'Тип', 'status')],
          rows: lines.map(function (l) { return { product: l.Product, sys: l.SystemQty, fact: l.CountedQty, diff: l.VarianceQty, type: _uiStatusRu_(l.VarianceType) }; }) }
      ],
      actions: [{ label: '+ Новая ревизия', module: 'revision' }]
    };
  },

  surplus: function (token) {
    var a = _uiTry_(function () { return v50AnalyzeSurplus(null, null, 7, token); }, {}) || {};
    var sur = a.surplus || [], rec = a.recommendations || [];
    return {
      title: 'Излишки',
      kpis: [{ label: 'Партий с излишком', value: sur.length, tone: 'gold', go: { sec: 'surplus', tab: 0 } }, { label: 'Рекомендаций', value: rec.length, go: { sec: 'surplus', tab: 1 } },
        { label: 'С риском', value: sur.filter(function (x) { return x.Risk === 'HIGH' || x.Risk === 'CRITICAL'; }).length, tone: 'red' }],
      tabs: [
        { title: 'Партии', columns: [_uiCol_('product', 'Продукт'), _uiCol_('qty', 'Кол-во', 'num'), _uiCol_('unit', 'Ед.'), _uiCol_('expiry', 'Срок годности', 'date'), _uiCol_('risk', 'Риск', 'status')],
          rows: sur.map(function (x) { return { product: x.Product, qty: Math.round(x.Qty * 100) / 100, unit: x.Unit, expiry: _uiDate_(x.Expiry instanceof Date ? x.Expiry : null) || x.Expiry, risk: _uiStatusRu_(x.Risk) }; }) },
        { title: 'Рекомендации', columns: [_uiCol_('product', 'Продукт'), _uiCol_('qty', 'Предложено', 'num'), _uiCol_('unit', 'Ед.'), _uiCol_('action', 'Действие'), _uiCol_('priority', 'Приоритет', 'status')],
          rows: rec.map(function (x) { return { product: x.Product, qty: Math.round(x.SuggestedQty * 100) / 100, unit: x.Unit, action: x.Action, priority: _uiStatusRu_(x.Priority) }; }) }
      ],
      actions: [{ label: 'Дефициты и излишки', module: 'deficitbridge' }]
    };
  },

  deficits: function (token) {
    var r = _uiTry_(function () { return v48AnalyzeDeficits(null, null, token); }, {}) || {};
    var rows = r.rows || [];
    return {
      title: 'Дефициты',
      kpis: [{ label: 'Дефицитов', go: { sec: 'deficits', tab: 0 }, value: rows.length, tone: rows.length ? 'red' : 'green' },
        { label: 'Критических', go: { sec: 'deficits', tab: 0, q: 'Критич' }, value: rows.filter(function (x) { return x.severity === 'CRITICAL'; }).length, tone: 'red' }],
      tabs: [{ title: 'Список', columns: [_uiCol_('product', 'Продукт / блюдо'), _uiCol_('need', 'Нужно', 'num'), _uiCol_('have', 'Есть', 'num'),
        _uiCol_('deficit', 'Дефицит', 'num'), _uiCol_('reason', 'Причина'), _uiCol_('date', 'Банкет', 'date'), _uiCol_('severity', 'Статус', 'status')],
        rows: rows.map(function (x) { return { product: x.productName, need: x.requiredQty, have: Math.max(x.producedQty, x.reservedQty), deficit: x.deficitQty,
          reason: x.reasonText, date: x.banquetDate, severity: _uiStatusRu_(x.severity) }; }) }],
      actions: [{ label: 'Перерасчёт по ТТК', module: 'ttkrecalc' }, { label: 'Дефициты и излишки', module: 'deficitbridge' }]
    };
  },

  picking: function () {
    var rows = _uiSheetRows_(MC_V23_PICK, 400);
    return {
      title: 'Отбор',
      kpis: [{ label: 'Строк отбора', go: { sec: 'picking', tab: 0 }, value: rows.length }, { label: 'Ожидают', value: rows.filter(function (x) { return x.Status !== 'PICKED' && x.Status !== 'CANCELLED'; }).length, tone: 'gold' }],
      tabs: [{ title: 'Задания', columns: [_uiCol_('date', 'Создано', 'date'), _uiCol_('product', 'Продукт'), _uiCol_('plan', 'План', 'num'), _uiCol_('fact', 'Отобрано', 'num'),
        _uiCol_('unit', 'Ед.'), _uiCol_('place', 'Место'), _uiCol_('status', 'Статус', 'status')],
        rows: rows.map(function (x) { return { date: x.CreatedAt, product: x.Product, plan: x.QtyPlanned, fact: x.QtyPicked, unit: x.Unit, place: x.LocationID, status: _uiStatusRu_(x.Status) }; }) }],
      actions: [{ label: 'Отбор сырья', module: 'picking' }]
    };
  },

  issue: function (token) {
    var d = _uiArr_(_uiTry_(function () { return getV28BanquetDashboard(token); }, null));
    return {
      title: 'Выдача',
      kpis: [{ label: 'Банкетов', go: { sec: 'issue', tab: 0 }, value: d.length }, { label: 'Готово к выдаче', go: { sec: 'issue', tab: 0, q: 'Готово' }, value: d.filter(function (x) { return x.ready && !x.complete; }).length, tone: 'green' },
        { label: 'С нехваткой', go: { sec: 'issue', tab: 0, q: 'Нехватка' }, value: d.filter(function (x) { return x.shortages; }).length, tone: 'red' }],
      tabs: [{ title: 'Банкеты', columns: [_uiCol_('date', 'Дата', 'date'), _uiCol_('time', 'Время'), _uiCol_('name', 'Банкет'), _uiCol_('guests', 'Гостей', 'num'), _uiCol_('status', 'Статус', 'status')],
        rows: d.map(function (x) { return { date: x.date, time: x.time, name: x.format, guests: x.guests, status: x.complete ? 'Выдано' : x.ready ? 'Готово' : x.shortages ? 'Нехватка' : 'Не начато' }; }) }],
      actions: [{ label: 'Выдача', module: 'fulfillment' }, { label: 'Закрытие банкета', module: 'closure' }]
    };
  },

  haccp: function (token, opts) {
    // «Подписание» (ТЗ §53) читает листы всех журналов — считается только когда вкладку открыли
    if (opts && opts.tab === 'signing') {
      var b0 = _mcSigningBoard_();
      try { CacheService.getScriptCache().put('mc_signboard', JSON.stringify({ total: b0.total, signed: b0.signed, ready: b0.ready, problems: b0.problems }), 21600); } catch (e) {}
      return { title: 'ХАССП', partial: 'signing', rows: b0.rows.map(function (r) { return { name: r.name, period: r.period, records: r.records, status: r.status, signed: r.signed, problems: r.problems, responsible: r.responsible, _tech: r.id }; }) };
    }
    var checks = _uiArr_(_uiTry_(function () { return getPendingChecks(token); }, null));
    var cfg = _uiArr_(_uiTry_(getJournalsConfig, '[]'));
    var dev = _uiArr_(_uiTry_(function () { return getJournalDeviations(100, token); }, null));
    // медкнижки — персональные данные: вкладка только для тех, кому их можно видеть
    var med = _uiTry_(function () { var r = JSON.parse(getMedBooks(token)); return r && r.ok ? r : null; }, null);
    var res = {
      title: 'ХАССП',
      kpis: [{ label: 'Ожидают проверки', value: checks.length, tone: checks.length ? 'red' : 'green', go: { sec: 'haccp', tab: 0 } }, { label: 'Журналов', value: cfg.length, go: { sec: 'haccp', tab: 1 } },
        { label: 'Отклонений', value: dev.length, tone: dev.length ? 'red' : 'green', go: { sec: 'haccp', tab: 2 } }],
      tabs: [
        { title: 'Контрольные точки', columns: [_uiCol_('time', 'Время'), _uiCol_('journal', 'Журнал'), _uiCol_('object', 'Объект'), _uiCol_('q', 'Вопрос'), _uiCol_('status', 'Статус', 'status')],
          rows: checks.map(function (c) { return { time: c['время'] || '', journal: c['журнал'] || '', object: c['объект'] || '', q: c['вопрос'] || '', status: c['статус'] || 'Ожидает' }; }) },
        // ТЗ §3, §75: в интерфейсе — название журнала; J-код только технический (в карточке строки)
        { title: 'Журналы', columns: [_uiCol_('name', 'Журнал'), _uiCol_('freq', 'Периодичность'), _uiCol_('role', 'Ответственный')],
          rows: cfg.map(function (j) { return { name: j.name, freq: j.frequency, role: j.role, _tech: j.id }; }) },
        { title: 'Отклонения', columns: [_uiCol_('date', 'Дата', 'date'), _uiCol_('journal', 'Журнал'), _uiCol_('text', 'Отклонение'), _uiCol_('status', 'Статус', 'status')],
          rows: dev.map(function (x) { return { date: x['когда'] || '', journal: x['журнал'] || '', text: [x['объект'], x['факт'], x['значение']].filter(function (v) { return v !== '' && v !== undefined && v !== null; }).join(' · '),
            status: x['критическая'] ? 'Критическая' : (x['статус'] || '') }; }) }
      ],
      actions: [{ label: 'ХАССП — сегодня', module: 'haccptoday' }, { label: 'Журналы', module: 'journals' }, { label: 'Температуры', module: 'temperatures' }, { label: 'Исправления журналов', module: 'corrections' }, { label: 'Контроли ХАССП', module: 'haccptasks' }, { label: 'Суточные пробы', module: 'samples' }, { label: 'Бракераж', module: 'brakerage' }, { label: 'Контур ХАССП за 7 дней', module: 'haccpcontour' }, { label: '✓ Чек-листы: выполнить', module: 'checklistrun' }, { label: 'Санитария', module: 'sanitationauto' }, { label: 'Шаблоны чек-листов', module: 'checklists' }, { label: 'Дезсредства', module: 'disinfectants' }, { label: 'Бактерицидные лампы', module: 'lamps' }, { label: 'Вопросы журналов', module: 'journaltriggers' }, { label: 'События → контроли', module: 'haccpevents' }, { label: 'Моя смена', module: 'myshift' }, { label: 'Приборы и поверка', module: 'equipment' }, { label: 'Вода, отходы, вредители', module: 'environment' }]
    };
    // ТЗ §17: KPI шефа — фактическое состояние данных, без «100 %», если данных нет (§52)
    var kp = _uiTry_(_mcChefKpi_, null), sb = _uiTry_(function () { var x = CacheService.getScriptCache().get('mc_signboard'); return x ? JSON.parse(x) : { total: (typeof JOURNALS !== 'undefined' ? JOURNALS.length : 0), signed: null, ready: null, problems: null }; }, null);
    if (kp) {
      var pc = function (v, n, what) { return v === null ? { value: 'нет данных', hint: what } : { value: v + '%', hint: what + ': ' + n }; };
      var k1 = pc(kp.done, kp.doneDue, 'проверок со сроком сегодня'), k2 = pc(kp.ccp, kp.ccpN, 'замеров ККТ за 7 дн.'), k3 = pc(kp.temp, kp.tempN, 'замеров t° за 7 дн.');
      res.kpis = [{ label: 'Выполнение', value: k1.value, hint: k1.hint, tone: kp.done === null ? '' : kp.done < 90 ? 'red' : 'green', go: { sec: 'haccp', tab: 0 } },
        { label: 'ККТ в норме', value: k2.value, hint: k2.hint, tone: kp.ccp === null ? '' : kp.ccp < 100 ? 'red' : 'green' },
        { label: 'Температуры', value: k3.value, hint: k3.hint, tone: kp.temp === null ? '' : kp.temp < 95 ? 'gold' : 'green' },
        { label: 'Отклонения', value: kp.devOpen, tone: kp.devOpen ? 'red' : 'green', go: { sec: 'haccp', tab: 2 } },
        { label: 'Открытые корректирующие', value: kp.caOpen, tone: kp.caOpen ? 'red' : 'green', go: { sec: 'haccp', tab: 2 } }].concat(res.kpis.slice(0, 0));
    }
    if (sb) {
      var known = sb.ready !== null;
      res.kpis.push({ label: 'Журналы готовы к подписанию', value: known ? sb.ready : 'открыть', tone: sb.ready ? 'gold' : '', hint: known ? 'есть проблемы: ' + sb.problems : 'вкладка «Подписание»', go: { sec: 'haccp', tab: 3 } },
        { label: 'Журналы подписаны', value: known ? sb.signed + ' из ' + sb.total : '—', go: { sec: 'haccp', tab: 3, q: 'Подписан' } });
      res.tabs.push({ title: 'Подписание', lazy: 'signing', total: sb.total, columns: [_uiCol_('name', 'Журнал'), _uiCol_('period', 'Период'), _uiCol_('records', 'Записей', 'num'), _uiCol_('status', 'Состояние', 'status'),
        _uiCol_('signed', 'Подписал'), _uiCol_('problems', 'Проблемы'), _uiCol_('responsible', 'Ответственный')], rows: [] });
      res.actions.unshift({ label: 'Подписать журналы', module: 'journals' });
    }
    if (med) {
      var bad = med.counts.overdue, soon = med.counts.soon, nod = med.counts.nodata;
      res.kpis.push({ label: bad ? 'Медкнижки просрочены' : soon ? 'Медкнижки истекают' : nod ? 'Медкнижки без данных' : 'Медкнижки',
        value: bad || soon || nod || '✓', tone: bad ? 'red' : (soon || nod) ? 'gold' : 'green', go: { sec: 'haccp', tab: res.tabs.length, q: bad ? 'Просрочено' : soon ? 'Истекает' : '' },
        hint: 'из ' + med.items.length + ' сотрудн.' + (bad && soon ? ' · истекают ' + soon : '') + (nod ? ' · без данных ' + nod : '') });
      var dmy = function (iso) { return iso ? iso.split('-').reverse().join('.') : ''; };
      var left = function (d) { return d === null || d === undefined ? '' : d < 0 ? 'просрочено ' + (-d) + ' дн.' : 'через ' + d + ' дн.'; };
      res.tabs.push({ title: 'Медкнижки', detail: 'med',
        columns: [_uiCol_('name', 'Сотрудник'), _uiCol_('position', 'Должность'), _uiCol_('number', '№ книжки'),
          _uiCol_('exam', 'Медосмотр до'), _uiCol_('att', 'Аттестация до'), _uiCol_('left', 'Срок'), _uiCol_('status', 'Статус', 'status')],
        rows: med.items.map(function (x) { return { _med: x.name, name: x.name, position: x.position, number: x.number,
          exam: dmy(x.examNext), att: dmy(x.attNext), left: left(x.daysLeft), status: x.status }; }) });
      res.med = med;
      res.actions.unshift({ label: '+ Медкнижка', fn: 'openMed' });
    }
    return res;
  },

  reports: function (token) {
    var d = _uiJ_(_uiTry_(function () { return getDashboard(token, 30); }, null)) || {};
    var g = function (a, b) { return d[a] && d[a][b] !== undefined ? d[a][b] : ''; };
    var rub = function (v) { return v === '' ? '' : Math.round(Number(v) || 0).toLocaleString('ru-RU') + ' ₽'; };
    var L = {
      'stock.positions': 'Позиций на складе', 'stock.value': 'Стоимость склада, ₽', 'stock.low_stock_count': 'Ниже минимума',
      'expiry.totalActive': 'Активных партий', 'expiry.expiringSoon': 'Истекает срок', 'expiry.expired': 'Просрочено партий',
      'reservations.active_positions': 'Позиций в резерве', 'events.total': 'Банкетов всего', 'events.upcoming': 'Банкетов впереди',
      'events.upcoming_portions': 'Порций впереди', 'movements.operations': 'Складских операций', 'movements.income_sum': 'Приход, ₽',
      'movements.consumption_sum': 'Расход, ₽', 'movements.writeoff_sum': 'Списания, ₽', 'movements.writeoff_share': 'Доля списаний, %',
      'cost.snapshots': 'Расчётов себестоимости', 'cost.food_cost_note': 'Фудкост', 'activity.actions': 'Действий сотрудников',
      'operations.completed': 'Операций выполнено', 'operations.failed': 'Операций с ошибкой', 'checks.ожидают': 'Проверок ждут',
      'checks.просрочено': 'Проверок просрочено', 'checks.выполнено': 'Проверок выполнено', 'deviations.открыто': 'Отклонений открыто',
      'deviations.критических': 'Критических отклонений', 'lab.несоответствий': 'Лаборатория: несоответствий',
      'personnel.просрочено_обучение': 'Просрочено обучение', 'documents.просрочено': 'Просрочено документов',
      'ttk.без_утверждённой_версии': 'ТТК без утверждённой версии', 'ttk.ждут_согласования': 'ТТК ждут согласования',
      'notifications.critical': 'Критических уведомлений', 'шлюз': 'Шлюз выпуска'
    };
    var rows = [];
    Object.keys(L).forEach(function (k) {
      var p = k.split('.'), v = p.length === 2 ? g(p[0], p[1]) : d[p[0]];
      if (v === '' || v === undefined || v === null) return;
      rows.push({ k: L[k], v: /₽/.test(L[k]) ? rub(v) : v, s: k === 'шлюз' ? v : '' });
    });
    return {
      title: 'Отчёты', subtitle: 'За ' + (d.period_days || 30) + ' дней · посчитано из операций, вручную не вводится',
      kpis: [
        { label: 'Стоимость склада', go: { sec: 'stock', tab: 0 }, value: rub(g('stock', 'value')), tone: 'gold' },
        { label: 'Приход', value: rub(g('movements', 'income_sum')), hint: 'за период' },
        { label: 'Списания', value: rub(g('movements', 'writeoff_sum')), tone: 'red' },
        { label: 'Банкетов впереди', go: { sec: 'banquets', tab: 0, q: 'Запланирован' }, value: g('events', 'upcoming'), tone: 'wine' },
        { label: 'Проверок ждут', go: { sec: 'haccp', tab: 0 }, value: g('checks', 'ожидают'), tone: 'gold' },
        { label: 'Шлюз выпуска', value: d['шлюз'] || '—', tone: d['шлюз'] === 'ОТКРЫТ' ? 'green' : 'red' }
      ],
      tabs: [{ title: 'Показатели', columns: [_uiCol_('k', 'Показатель'), _uiCol_('v', 'Значение'), _uiCol_('s', '', 'status')], rows: rows }],
      actions: [{ label: 'Выпуск и пилот', module: 'productionrelease' }]
    };
  },

  settings: function (token) {
    var emp = _uiArr_(_uiTry_(getEmployees, '[]'));
    var sched = _uiTry_(getSchedulerStatus, []);
    return {
      title: 'Настройки',
      kpis: [{ label: 'Сотрудников', go: { sec: 'settings', tab: 0 }, value: emp.length }, { label: 'Автозадач', go: { sec: 'settings', tab: 1 }, value: sched.length }],
      tabs: [
        { title: 'Сотрудники', columns: [_uiCol_('name', 'ФИО'), _uiCol_('position', 'Должность'), _uiCol_('role', 'Роль'), _uiCol_('status', 'Статус', 'status')],
          rows: emp.map(function (e) { return { name: e.name || e.fullName || '', position: e.position || '', role: e.role || '', status: e.active === false ? 'Неактивен' : 'Активен' }; }) },
        { title: 'Автозапуски', columns: [_uiCol_('fn', 'Задача'), _uiCol_('schedule', 'Расписание'), _uiCol_('last', 'Последний запуск'), _uiCol_('err', 'Ошибка')],
          rows: sched.map(function (s) { return { fn: s.fn, schedule: s.schedule, last: s.lastRun ? _uiDate_(new Date(Number(s.lastRun))) : '—', err: s.lastError || '' }; }) }
      ],
      actions: [{ label: 'Сотрудники', module: 'staff' }, { label: 'Перенос ролей (этап 10.7)', fn: 'rbMigrate' }, { label: 'Код технического доступа', fn: 'rbDevPin' }, { label: 'Товары и единицы', module: 'productunits' }, { label: 'Дезсредства', module: 'disinfectants' }, { label: 'Резервные копии', module: 'backup' }, { label: '🔒 Защита журналов', fn: 'mcProtect' }, { label: 'Связать состав ТТК с продуктами', fn: 'mcTtkIds' }, { label: 'Миграция данных', fn: 'mcMigrate' }]
    };
  }
};

/**
 * Карточка блюда: состав (брутто / нетто / выход в г, мл, шт) и полная раскладка до сырья
 * на заданное число порций. Полуфабрикаты раскладываются рекурсивно по своим карточкам:
 * п/ф берётся в блюдо по нетто и делится на выход своей ТТК; сырьё суммируется по брутто и нетто.
 */
// Фото блюд: имя файла в папке фото = код блюда, название или имя .xls карточки.
// Список папки кэшируется на 5 минут — иначе каждая карточка листала бы всю папку.
function _uiPhotoMap_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('mc_ui_photo_map');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var map = {};
  try {
    var it = DriveApp.getFolderById(PHOTO_FOLDER_ID).getFiles();
    while (it.hasNext()) { var f = it.next(); if (/^image\//.test(f.getMimeType() || '')) map[norm(f.getName())] = f.getId(); }
  } catch (e) {}
  try { cache.put('mc_ui_photo_map', JSON.stringify(map), 300); } catch (e) {}
  return map;
}
function uiDropPhotoCache_() { try { CacheService.getScriptCache().remove('mc_ui_photo_map'); } catch (e) {} }

function uiDishDetail(token, code, portions) {
  var sess;
  try { sess = _requireAuth_(token); } catch (e) { return { ok: false, auth: true, error: String(e.message || e) }; }
  try {
    var idx = _buildDishIndexes_(), d = idx.dishByCode[code];
    if (!d) return { ok: false, error: 'Блюдо не найдено' };
    var perm = (sess && sess.permissions) || {}, admin = !!(sess && sess.dev);   // этап 10.7: полный доступ — только технический
    // описание (F) и имя файла карточки (G) — их нет в индексах
    var meta = {}, dsh = _book_().getSheetByName('Блюда'), dv = dsh ? dsh.getDataRange().getValues() : [];
    for (var mi = 1; mi < dv.length; mi++) if (dv[mi][0]) meta[String(dv[mi][0])] = { method: String(dv[mi][5] || ''), file: String(dv[mi][6] || ''), cat: String(dv[mi][2] || ''), steps: dv[mi][7], shelfH: dv[mi][9],
      path: dv[mi][DISH_C.PATH] === undefined ? '' : String(dv[mi][DISH_C.PATH]), folder: String(dv[mi][DISH_C.FOLDER] || '') };
    var pmap = _uiPhotoMap_();
    var photoOf = function (x) { var m = meta[x.code] || {}; return (typeof _dpPhotoOf_ === 'function' ? _dpPhotoOf_(x.code, x.name, m.file, pmap) : '') || pmap[norm(x.code)] || pmap[norm(x.name)] || (m.file ? pmap[norm(m.file)] : '') || ''; };
    var r2 = function (x) { return Math.round((Number(x) || 0) * 100) / 100; };
    // Дерево для карточки: п/ф входит по нетто, его карточка пересчитывается на нужное количество
    // (нужно ÷ выход карточки п/ф), вложенные п/ф — так же, до сырья.
    var nodesOf = function (ing, k, depth, seen) {
      return ing.map(function (x) {
        var node = { name: x[0], brutto: r2(x[1] * k), netto: r2((x[3] === '' || x[3] === undefined ? x[1] : x[3]) * k), unit: x[2] };
        var sub = depth < 10 ? _findSubDish_(x[0], idx.dishByNormName, idx.dishByLooseName) : null;
        if (sub && sub.ing && sub.ing.length && seen.indexOf(sub.code) < 0) {
          var need = node.netto || node.brutto, y = _subYield_(sub), f = y > 0 ? need / y : 0;
          node.sub = { code: sub.code, name: sub.name, need: r2(need), yield: r2(y), yu: sub.yieldUnit || x[2], f: f,
            method: (meta[sub.code] || {}).method || '', photo: photoOf(sub),
            nodes: f > 0 ? nodesOf(sub.ing, f, depth + 1, seen.concat(sub.code)) : [] };
        }
        return node;
      });
    };
    // блюдо — число порций; п/ф — количество готового п/ф в его единицах (по умолчанию выход карточки)
    var n = Math.max(0.001, Number(portions) || (d.semi ? (_subYield_(d) || 1) : 1));
    var mult = d.semi ? n / (_subYield_(d) || n) : n;
    var r1 = function (x) { return Math.round((Number(x) || 0) * 10) / 10; };
    var raw = {}, tree = [], warn = [];
    (function walk(ing, k, depth, seen, parent) {
      ing.forEach(function (x) {
        var sub = depth < 10 ? _findSubDish_(x[0], idx.dishByNormName, idx.dishByLooseName) : null;
        if (sub && sub.ing && sub.ing.length && seen.indexOf(sub.code) < 0) {
          var need = (x[3] || x[1]) * k, y = _subYield_(sub);
          tree.push({ level: depth, name: x[0], card: sub.name, need: r1(need), unit: x[2], yield: r1(y), yu: sub.yieldUnit, parent: parent });
          if (y > 0) walk(sub.ing, need / y, depth + 1, seen.concat(sub.code), sub.name);
          else warn.push('У п/ф «' + sub.name + '» не найден выход — не разложен');
          return;
        }
        if (/п\s*[\/\-]\s*ф/i.test(String(x[0])) && !sub) warn.push('Нет карточки для «' + x[0] + '» — посчитан как продукт');
        var key = _cleanProdName_(x[0]) + '|' + x[2];
        var a = raw[key] || (raw[key] = { name: _cleanProdName_(x[0]), unit: x[2], brutto: 0, netto: 0, via: {} });
        a.brutto += x[1] * k; a.netto += (x[3] || x[1]) * k; a.via[parent || d.name] = true;
      });
    })(d.ing, mult, 0, [d.code], '');
    var comp = d.ing.map(function (x) {
      var sub = _findSubDish_(x[0], idx.dishByNormName, idx.dishByLooseName);
      return { ing: x[0], brutto: r1(x[1] * mult), netto: r1(x[3] * mult), out: r1(x[4] * mult), unit: x[2], kind: sub ? 'П/Ф' : 'Продукт' };
    });
    var rawRows = Object.keys(raw).map(function (k) { var a = raw[k]; return { name: a.name, brutto: r1(a.brutto), netto: r1(a.netto), unit: a.unit, via: Object.keys(a.via).join(', ') }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
    return JSON.parse(JSON.stringify({ ok: true, code: code, name: d.name, semi: d.semi, portions: n, mult: mult,
      cat: (meta[code] || {}).cat || '', method: (meta[code] || {}).method || '', photo: photoOf(d),
      path: (meta[code] || {}).path || '', folderId: (meta[code] || {}).folder || '', file: (meta[code] || {}).file || '',
      canEdit: admin || perm.ttk_edit === true, canCost: admin || perm.costs === true, canHistory: admin || perm.ttk_history === true, canApprove: admin || perm.ttk_approve === true,
      nodes: nodesOf(d.ing, mult, 0, [d.code]),
      // для правки: состав как в листе (на карточку), без пересчёта на порции
      cardIng: d.ing.map(function (x) { return { name: x[0], unit: x[2], brutto: r2(x[1] * (d.semi ? 1 : d.portions)), netto: r2(x[3] * (d.semi ? 1 : d.portions)) }; }),
      yieldBase: d.yieldBase, yieldUnit: d.yieldUnit, cardPortions: d.portions, warn: warn.filter(function (w, i, a) { return a.indexOf(w) === i; }),
      composition: comp, tree: tree, raw: rawRows,
      // шаги заготовки (лист «Блюда», колонка H): из них строятся задачи кухни по банкету
      steps: (function () { try { var st = JSON.parse(String((meta[code] || {}).steps || '[]')); return Array.isArray(st) ? st.map(String) : []; } catch (e) { return []; } })(),
      // срок реализации для этикеток заданий кухни (лист «Блюда», колонка J): из карты; если пусто — какой срок поставит система и откуда
      shelf: (function () { var h = parseFloat((meta[code] || {}).shelfH); if (h > 0) return { hours: h, src: 'карта' };
        var c = d.cat || '', def = null, src = '';
        try { if (DEFAULT_SHELF_LIFE_HOURS[c]) { def = DEFAULT_SHELF_LIFE_HOURS[c]; src = 'категория «' + c + '»'; } else if (/п\/ф|п-ф/i.test(d.name)) { def = 24; src = 'полуфабрикат по названию'; } else { def = DEFAULT_SHELF_LIFE_FALLBACK; src = 'общий срок по умолчанию'; } } catch (e) {}
        return { hours: null, def: def, src: src }; })(),
      allergens: (function () { try { return _alDishAllergens_(idx, code); } catch (e) { return null; } })(),
      ttk: (function () { try { return _uiTtkState_(code, admin || perm.ttk_approve === true); } catch (e) { return null; } })() }));
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/** Версии карты для карточки блюда: действующая и ожидающие утверждения (с составом черновика). */
function _uiTtkState_(code, canApprove) {
  var v = _ttkVersionsSheet_().getDataRange().getValues(), eff = null, pend = [], latest = 0;
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]) !== String(code)) continue;
    latest = Math.max(latest, Number(v[i][1]) || 0);   // этап 10.7: правка сохраняется только на той версии, которую открыли
    if (v[i][2] === 'действующая') eff = { version: v[i][1], approvedBy: v[i][13] || '', approvedAt: v[i][14] ? _bcDate_(v[i][14]) : '', storage: v[i][10] || '', shelf: v[i][11] || '' };
    if (v[i][2] === 'черновик' || v[i][2] === 'на согласовании') {
      var ing = []; try { ing = JSON.parse(v[i][6] || '[]'); } catch (e) {}
      pend.push({ version: v[i][1], status: v[i][2], author: v[i][8] || '', created: _bcDate_(v[i][9]), name: v[i][3], yield: v[i][4], method: v[i][5],
        ingredients: ing.map(function (x) { return { name: x.name, unit: x.unit || 'г', brutto: x.brutto, netto: x.netto }; }) });
    }
  }
  return { effective: eff, pending: pend.reverse(), canApprove: !!canApprove, latest: latest };
}

/** Этап 10.8: на главной у ХАССП, шефа, су-шефа и директора — итог панели «ХАССП — сегодня» словом (кэш 5 минут). */
function _uiHaccpTodayKpi_(s) {
  try {
    if (!s || !_mcRbHasExact_(s, 'haccp_view')) return [];
    var key = 'mc_htoday_' + String(s.user_id || s.name || ''), c = null;
    try { var x = CacheService.getScriptCache().get(key); c = x ? JSON.parse(x) : null; } catch (e) {}
    if (!c) { var r = _mcHaccpToday_(s); c = { state: r.state, overall: r.overall }; try { CacheService.getScriptCache().put(key, JSON.stringify(c), 300); } catch (e) {} }
    return [{ label: 'ХАССП сегодня', value: c.overall, hint: 'панель: проверки, температуры, сроки, КД…', tone: c.state === 'bad' ? 'red' : c.state === 'ok' ? 'green' : 'gold', go: { module: 'haccptoday' } }];
  } catch (e) { return []; }
}
