/**
 * San.Lab — Repository.gs
 * Тонкий слой над хранилищем (Store): ID, служебные поля, версии строк, настройки.
 * Store реализуется платформой: SheetsStore (Apps Script) или MemoryStore (демо/тесты).
 *   Store.all(table) / Store.get(table,id) / Store.insert(table,obj) / Store.update(table,id,patch) / Store.nextSeq(prefix)
 */

var Repo = {
  key: function (table) { return SCHEMA[table][0]; },

  newId: function (table) {
    var prefix = ID_PREFIX[table];
    var n = Store.nextSeq(prefix);
    var s = String(n);
    while (s.length < 6) s = '0' + s;
    return prefix + '-' + s;
  },

  all: function (table) { return Store.all(table); },
  get: function (table, id) { return id ? Store.get(table, id) : null; },
  must: function (table, id, label) {
    var r = Repo.get(table, id);
    if (!r) notFound(label || TABLE_LABELS[table]);
    return r;
  },
  where: function (table, fn) { return filterBy(Store.all(table), fn); },

  create: function (ctx, table, obj, opts) {
    var cols = SCHEMA[table];
    var key = cols[0];
    var row = {};
    for (var i = 0; i < cols.length; i++) row[cols[i]] = obj.hasOwnProperty(cols[i]) ? obj[cols[i]] : '';
    if (!row[key]) row[key] = Repo.newId(table);
    if (cols.indexOf('created_at') >= 0 && !row.created_at) row.created_at = ctx.now;
    if (cols.indexOf('created_by') >= 0 && !row.created_by) row.created_by = ctx.actorId;
    if (cols.indexOf('updated_at') >= 0) row.updated_at = ctx.now;
    if (cols.indexOf('updated_by') >= 0) row.updated_by = ctx.actorId;
    if (cols.indexOf('record_status') >= 0 && !row.record_status) row.record_status = 'ACTIVE';
    if (cols.indexOf('row_version') >= 0) row.row_version = 1;
    Store.insert(table, row);
    if (!(opts && opts.noAudit)) Audit.log(ctx, (opts && opts.action) || 'CREATE', table, row[key], null, stripSecrets(row));
    return row;
  },

  /* expectedVersion — защита от одновременной правки (row_version) */
  update: function (ctx, table, id, patch, opts) {
    var cur = Repo.must(table, id);
    if (opts && opts.expectedVersion && cur.row_version && Number(opts.expectedVersion) !== Number(cur.row_version)) {
      fail('CONFLICT', 'Запись изменена другим пользователем. Обновите карточку и повторите.');
    }
    var cols = SCHEMA[table];
    var clean = {};
    for (var k in patch) if (patch.hasOwnProperty(k) && cols.indexOf(k) >= 0 && k !== cols[0]) clean[k] = patch[k];
    if (cols.indexOf('updated_at') >= 0) clean.updated_at = ctx.now;
    if (cols.indexOf('updated_by') >= 0) clean.updated_by = ctx.actorId;
    if (cols.indexOf('row_version') >= 0) clean.row_version = (Number(cur.row_version) || 0) + 1;
    var d = diffObj(cur, clean);
    var updated = Store.update(table, id, clean);
    if (!(opts && opts.noAudit)) Audit.log(ctx, (opts && opts.action) || 'UPDATE', table, id, d.oldV, d.newV);
    return updated;
  }
};

/* ---------- Настройки ---------- */
var Settings = {
  _cache: null,
  load: function () {
    if (Settings._cache) return Settings._cache;
    var m = {};
    for (var k in SETTINGS_DEFAULTS) if (SETTINGS_DEFAULTS.hasOwnProperty(k)) m[k] = SETTINGS_DEFAULTS[k][0];
    var rows = Store.all('Settings');
    for (var i = 0; i < rows.length; i++) m[rows[i].setting_key] = String(rows[i].value === null || rows[i].value === undefined ? '' : rows[i].value);
    Settings._cache = m;
    return m;
  },
  reset: function () { Settings._cache = null; },
  get: function (key) { return Settings.load()[key]; },
  bool: function (key) { return V.bool(Settings.get(key)); },
  num: function (key) { return Number(Settings.get(key)) || 0; },
  json: function (key) { return safeJson(Settings.get(key), {}); },

  save: function (ctx, p) {
    var values = p.values || {};
    var changed = [];
    for (var key in values) {
      if (!values.hasOwnProperty(key)) continue;
      if (!SETTINGS_DEFAULTS.hasOwnProperty(key)) fail('VALIDATION', 'Неизвестная настройка: ' + key);
      var v = String(values[key]);
      if (/_JSON$|^TASK_DUE_DAYS$|^LAB_DUE_DAYS$/.test(key) && safeJson(v, null) === null) fail('VALIDATION', 'Настройка ' + key + ' должна быть в формате JSON');
      var existing = Store.get('Settings', key);
      var old = existing ? existing.value : SETTINGS_DEFAULTS[key][0];
      if (String(old) === v) continue;
      if (existing) Store.update('Settings', key, { value: v, updated_by: ctx.actorId, updated_at: ctx.now });
      else Store.insert('Settings', { setting_key: key, value: v, description: SETTINGS_DEFAULTS[key][1], updated_by: ctx.actorId, updated_at: ctx.now });
      Audit.log(ctx, 'SETTING_CHANGE', 'Settings', key, { value: old }, { value: v });
      changed.push(key);
    }
    Settings.reset();
    return { changed: changed };
  },

  list: function () {
    var m = Settings.load(), out = [];
    for (var k in SETTINGS_DEFAULTS) if (SETTINGS_DEFAULTS.hasOwnProperty(k)) out.push({ key: k, value: m[k], description: SETTINGS_DEFAULTS[k][1] });
    return out;
  }
};
