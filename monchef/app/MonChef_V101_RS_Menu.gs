/**
 * MON CHEF V101 — Restaurant Service: гостевое меню MON CHEF REELS (ТЗ Restaurant Service 1.0, модуль 3, этап 5).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Публикация — по блюдам каталога «Блюда» (второго справочника нет): категория для гостя, описание, порядок, медиа.
 * При публикации собирается СНИМОК блюда (лист «МенюСнимок_V1») только из разрешённых полей:
 *   название, категория, описание, выход (вес / объём), состав — названия продуктов БЕЗ граммовок (решение владельца),
 *   КБЖУ на порцию — только если по всем продуктам есть утверждённые значения V73, иначе «КБЖУ не определено» (не нули),
 *   аллергены — подтверждённые профили; если профиль неполный — «уточняйте у официанта».
 * Цена продажи и STOP/GO подставляются при каждом показе (цена — «Цены_Меню» на сегодня; причина STOP гостю не видна).
 * В публичное меню НЕ попадают: себестоимость, закупочные цены, граммовки и технология ТТК, партии, сотрудники, ID листов.
 *
 * Медиа (фото, видео, GIF) хранятся в закрытой папке Drive владельца и отдаются ТОЛЬКО через приложение
 * (решение владельца: без открытых ссылок). Гостевая страница получает файл частями через rsPublicMedia —
 * и только если он относится к опубликованному блюду. Загрузка — частями (до 4 МБ за вызов) через временные файлы.
 * Можно взять уже привязанное фото блюда («Фото_Блюд», MonChef_DishPhotos.gs) — без повторной загрузки.
 *
 * Заказ гостя (ТЗ §5.5): по умолчанию витрина — только просмотр. Если директор включил заказ, гость, открывший меню по
 * QR-коду стола, отправляет заявку; на кухню она НЕ уходит — официант принимает её в заказ стола или отклоняет.
 */
var MC_RS_MEDIA_TYPES_ = { 'image/jpeg': 'PHOTO', 'image/png': 'PHOTO', 'image/webp': 'PHOTO', 'image/gif': 'GIF', 'video/mp4': 'VIDEO', 'video/webm': 'VIDEO', 'video/quicktime': 'VIDEO' };
var MC_RS_MEDIA_MAX_ = { PHOTO: 8 * 1024 * 1024, GIF: 8 * 1024 * 1024, VIDEO: 30 * 1024 * 1024 };
var MC_RS_UP_CHUNK_ = 4 * 1024 * 1024;          // загрузка: часть файла за вызов
var MC_RS_SERVE_CHUNK_ = 2 * 1024 * 1024;       // показ: часть файла за вызов
var MC_RS_PUB_CACHE_SEC_ = 60;
var MC_RS_PUB_RU_ = { DRAFT: 'не опубликовано', PUBLISHED: 'опубликовано', UNPUBLISHED: 'снято с публикации' };

/* ---------------- Drive ---------------- */
/** Закрытая папка медиа меню (создаётся один раз, ID — в свойствах скрипта). */
function _rsMediaFolder_(sub) {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('MC_RS_MEDIA_FOLDER'), f = null;
  if (id) { try { f = DriveApp.getFolderById(id); } catch (e) { f = null; } }
  if (!f) { f = DriveApp.createFolder('MON CHEF — Меню гостя (медиа)'); p.setProperty('MC_RS_MEDIA_FOLDER', f.getId()); }
  if (!sub) return f;
  var it = f.getFoldersByName(sub); return it.hasNext() ? it.next() : f.createFolder(sub);
}
function _rsHex_(bytes) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join(''); }

/* ---------------- публикация: чтение ---------------- */
function _rsPubObj_(r) { return { code: String(r.DishCode), category: String(r['Категория'] || ''), description: String(r['Описание'] || ''), order: parseInt(r['Порядок'], 10) || 0, status: String(r['Статус'] || 'DRAFT'), version: parseInt(r.Version, 10) || 1, publishedAt: _rsIsDate_(r['Опубликовано']) ? Utilities.formatDate(r['Опубликовано'], _mcTz_(), 'dd.MM.yyyy HH:mm') : '' }; }
function _rsMediaObj_(r) { return { id: String(r.MediaID), code: String(r.DishCode), type: String(r['Тип']), name: String(r['Файл'] || ''), mime: String(r.MIME || ''), size: parseInt(r['Размер'], 10) || 0, cover: r['Обложка'] === true || String(r['Обложка']) === 'true', order: parseInt(r['Порядок'], 10) || 0, status: String(r['Статус'] || 'ACTIVE'), version: parseInt(r.Version, 10) || 1, fileId: String(r.FileID || '') }; }
/** Фото блюд, привязанные раньше (MonChef_DishPhotos): {код: [{fileId, name}]}. */
function _rsDishPhotos_() {
  var out = {};
  try { _dpRows_().forEach(function (r) { var code = String(r['Код блюда'] || ''), act = r['Активно']; if (!code || act === false || String(act) === 'false') return; var fid = String(r['Для карточки FileID'] || r.FileID || ''); if (!fid) return; (out[code] = out[code] || []).push({ fileId: fid, name: String(r['Файл'] || '') }); }); } catch (e) {}
  return out;
}

/** Редактор меню: блюда каталога, их публикация и медиа. Право menu_publish. */
function rsMenuAdmin(json, token) {
  return _rsRead_(token, 'menu_publish', function () {
    var dishes = _rsDishes_(), prices = _rsPriceIdx_(_rsToday_()), pubs = {}, media = {}, photos = _rsDishPhotos_();
    _rsRows_(MC_RS_SH_.MENU_PUB).forEach(function (r) { pubs[String(r.DishCode)] = _rsPubObj_(r); });
    _rsRows_(MC_RS_SH_.MEDIA).forEach(function (r) { var m = _rsMediaObj_(r); if (m.status === 'DELETED') return; delete m.fileId; (media[m.code] = media[m.code] || []).push(m); });
    var title = ''; try { title = PropertiesService.getScriptProperties().getProperty('MC_RS_MENU_TITLE') || ''; } catch (e) {}
    return { guestOrder: _rsGuestOrderOn_(), title: title, dishes: Object.keys(dishes).map(function (k) {
      var d = dishes[k], p = prices[k], pub = pubs[k] || { code: k, category: '', description: '', order: 0, status: 'DRAFT', version: 0 };
      return { code: k, name: d.name, category: d.category, dept: d.dept, yield: d.yield, yunit: d.yunit, priceKop: p ? p.kop : null, priceFor: p ? p.unitText : '',
        pub: pub, media: (media[k] || []).sort(function (a, b) { return a.order - b.order; }), dishPhotos: (photos[k] || []).length };
    }).sort(function (a, b) { return (a.pub.category || a.category) < (b.pub.category || b.category) ? -1 : 1; }) };
  });
}
/** Сохранить публикацию блюда: категория, описание, порядок; action: save | publish | unpublish. {idem, code, version, category, description, order, action} */
function rsMenuSave(json, token) {
  return _rsMutate_(token, 'menu_publish', 'RS_MENU_SAVE', json, function (c) {
    var d = c.d, code = _rsS_(d.code), dish = _rsDishes_()[code];
    if (!dish) return { fail: ['VALIDATION', 'Блюдо не найдено в каталоге'] };
    var rows = _rsRows_(MC_RS_SH_.MENU_PUB), cur = rows.filter(function (r) { return String(r.DishCode) === code; })[0];
    if (cur) _rsCheckVersion_(cur, d.version);
    var o = cur ? JSON.parse(JSON.stringify(cur)) : { DishCode: code, 'Статус': 'DRAFT' }; delete o._row;
    var before = cur ? _rsPubObj_(cur) : null;
    if (d.category !== undefined) o['Категория'] = _rsS_(d.category).slice(0, 40);
    if (d.description !== undefined) o['Описание'] = String(d.description || '').replace(/[<>]/g, '').trim().slice(0, 600);
    if (d.order !== undefined) o['Порядок'] = parseInt(d.order, 10) || 0;
    var plan = [], action = d.action || 'save';
    if (action === 'publish') {
      var price = _rsPriceIdx_(_rsToday_())[code];
      if (!price) return { fail: ['VALIDATION', '«' + dish.name + '»: нет цены в «Ценах меню» — гость увидит блюдо без цены. Сначала цена'] };
      var snap = _rsBuildSnapshot_(code, o);
      if (!snap.media.length) return { fail: ['VALIDATION', '«' + dish.name + '»: добавьте хотя бы одно фото, видео или GIF'] };
      o['Статус'] = 'PUBLISHED'; o['Опубликовал'] = _rsWho_(c.s); o['Опубликовано'] = new Date();
      var sr = _rsRows_(MC_RS_SH_.MENU_SNAP).filter(function (r) { return String(r.DishCode) === code; })[0];
      var sn = sr ? JSON.parse(JSON.stringify(sr)) : { DishCode: code }; delete sn._row;
      sn['Снимок'] = JSON.stringify(snap); sn['Опубликовано'] = new Date(); _rsStamp_(sn, c.s, c.op, !sr);
      if (sn['Снимок'].length > 45000) return { fail: ['VALIDATION', 'Слишком длинное описание или состав'] };
      plan.push({ sheet: MC_RS_SH_.MENU_SNAP, row: sn });
    } else if (action === 'unpublish') {
      if (String(o['Статус']) !== 'PUBLISHED') return { fail: ['VALIDATION', 'Блюдо не опубликовано'] };
      o['Статус'] = 'UNPUBLISHED';
    }
    _rsStamp_(o, c.s, c.op, !cur); plan.unshift({ sheet: MC_RS_SH_.MENU_PUB, row: o });
    var after = _rsPubObj_(o);
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'MENU', code, null, 'MENU_' + action.toUpperCase(), before, after) });
    _rsPubCacheDrop_();
    return { data: { pub: after, snapshot: action === 'publish' ? JSON.parse(plan[1].row['Снимок']) : null }, plan: plan,
      audit: { action: 'RS_MENU_' + action.toUpperCase(), entity: MC_RS_SH_.MENU_PUB, id: code, before: before, after: after } };
  });
}
/** Предпросмотр снимка блюда (как увидит гость), без публикации. {code} */
function rsMenuPreview(json, token) {
  return _rsRead_(token, 'menu_publish', function () {
    var d = _rsJ_(json, {}) || {}, code = _rsS_(d.code); if (!_rsDishes_()[code]) throw new Error('NOT_FOUND: блюдо не найдено');
    var cur = _rsRows_(MC_RS_SH_.MENU_PUB).filter(function (r) { return String(r.DishCode) === code; })[0] || { DishCode: code };
    var snap = _rsBuildSnapshot_(code, cur), p = _rsPriceIdx_(_rsToday_())[code];
    snap.priceKop = p ? p.kop : null; snap.priceFor = p ? p.unitText : ''; snap.stop = 'GO';
    return snap;
  });
}
/** Снимок блюда для гостя — только разрешённые поля. */
function _rsBuildSnapshot_(code, pub) {
  var dishes = _rsDishes_(), dish = dishes[code], idx = null, raw = null;
  try { idx = _buildDishIndexes_(); raw = idx.dishByCode[code]; } catch (e) {}
  var comp = [];
  ((raw && raw.ing) || []).forEach(function (x) { var n = _rsS_(typeof _cleanProdName_ === 'function' ? (_cleanProdName_(x[0]) || x[0]) : x[0]); if (n && comp.indexOf(n) < 0) comp.push(n); });
  var kbju = null, kbjuNote = 'КБЖУ не определено';
  try {
    var k = JSON.parse(calculateKBZHU(code));
    if (k && !k.error && !k.hasMissingData && k.perPortion && k.perPortion.kcal > 0) { kbju = { kcal: k.perPortion.kcal, protein: k.perPortion.protein, fat: k.perPortion.fat, carbs: k.perPortion.carbs, per: 'порция' }; kbjuNote = ''; }
  } catch (e) {}
  var al = null; try { al = idx ? _alDishAllergens_(idx, code) : null; } catch (e) { al = null; }
  var media = _rsRows_(MC_RS_SH_.MEDIA).map(_rsMediaObj_).filter(function (m) { return m.code === code && m.status === 'ACTIVE'; })
    .sort(function (a, b) { return (b.cover ? 1 : 0) - (a.cover ? 1 : 0) || a.order - b.order; }).map(function (m) { return { id: m.id, type: m.type, mime: m.mime, size: m.size }; });
  (_rsDishPhotos_()[code] || []).forEach(function (p, i) { media.push({ id: 'DP-' + code + '-' + i, type: 'PHOTO', mime: 'image/jpeg', size: 0 }); });
  return { code: code, name: dish.name, category: _rsS_(pub['Категория']) || dish.category, description: String(pub['Описание'] || ''), order: parseInt(pub['Порядок'], 10) || 0,
    dept: dish.dept, yield: dish.yield, yunit: dish.yunit, composition: comp, kbju: kbju, kbjuNote: kbjuNote,
    allergens: al ? al.allergens.map(function (a) { return a.name; }) : [], allergensComplete: !!(al && al.complete), media: media };
}

/* ---------------- медиа: загрузка ---------------- */
/** Начать загрузку. {code, name, mime, size} → {uploadId, chunk, parts} */
function rsMediaUploadStart(json, token) {
  return _rsRead_(token, 'menu_publish', function (s) {
    var d = _rsJ_(json, {}) || {}, code = _rsS_(d.code), type = MC_RS_MEDIA_TYPES_[String(d.mime || '').toLowerCase()], size = parseInt(d.size, 10);
    if (!_rsDishes_()[code]) throw new Error('VALIDATION: блюдо не найдено');
    if (!type) throw new Error('VALIDATION: формат — JPEG, PNG, WebP, GIF, MP4, WebM или MOV');
    if (!(size > 0) || size > MC_RS_MEDIA_MAX_[type]) throw new Error('VALIDATION: размер ' + (type === 'VIDEO' ? 'видео — до 30 МБ' : 'фото и GIF — до 8 МБ'));
    var id = Utilities.getUuid().replace(/-/g, ''), parts = Math.ceil(size / MC_RS_UP_CHUNK_);
    CacheService.getScriptCache().put('rs_up_' + id, JSON.stringify({ code: code, name: _rsS_(d.name).slice(0, 120) || 'файл', mime: String(d.mime).toLowerCase(), type: type, size: size, parts: parts, got: {}, by: String(s.user_id || '') }), 3600);
    return { uploadId: id, chunk: MC_RS_UP_CHUNK_, parts: parts };
  });
}
/** Часть файла (base64). {uploadId, index, data} — повтор той же части перезаписывает её. */
function rsMediaUploadPart(json, token) {
  return _rsRead_(token, 'menu_publish', function (s) {
    var d = _rsJ_(json, {}) || {}, c = CacheService.getScriptCache(), k = 'rs_up_' + String(d.uploadId || '').replace(/[^0-9a-f]/g, ''), st = JSON.parse(c.get(k) || 'null');
    if (!st || st.by !== String(s.user_id || '')) throw new Error('VALIDATION: загрузка не найдена или устарела — начните заново');
    var i = parseInt(d.index, 10); if (!(i >= 0 && i < st.parts)) throw new Error('VALIDATION: неверный номер части');
    var bytes = Utilities.base64Decode(String(d.data || ''));
    if (!bytes.length || bytes.length > MC_RS_UP_CHUNK_) throw new Error('VALIDATION: неверный размер части');
    if (st.got[i]) { try { DriveApp.getFileById(st.got[i]).setTrashed(true); } catch (e) {} }
    var f = _rsMediaFolder_('_загрузка').createFile(Utilities.newBlob(bytes, 'application/octet-stream', k + '_' + i));
    st.got[i] = f.getId(); c.put(k, JSON.stringify(st), 3600);
    return { index: i, received: Object.keys(st.got).length, parts: st.parts };
  });
}
/** Завершить загрузку: части → файл в закрытой папке, строка «МедиаМеню_V1». {idem, uploadId, cover} */
function rsMediaUploadFinish(json, token) {
  return _rsMutate_(token, 'menu_publish', 'RS_MEDIA_UPLOAD', json, function (c) {
    var cc = CacheService.getScriptCache(), k = 'rs_up_' + String(c.d.uploadId || '').replace(/[^0-9a-f]/g, ''), st = JSON.parse(cc.get(k) || 'null');
    if (!st || st.by !== String(c.s.user_id || '')) return { fail: ['VALIDATION', 'Загрузка не найдена или устарела — начните заново'] };
    if (Object.keys(st.got).length !== st.parts) return { fail: ['VALIDATION', 'Получены не все части файла'] };
    var all = [];
    for (var i = 0; i < st.parts; i++) { var f = DriveApp.getFileById(st.got[i]); all = all.concat(f.getBlob().getBytes()); }
    if (all.length !== st.size) return { fail: ['VALIDATION', 'Размер файла не совпал — загрузите заново'] };
    var file = _rsMediaFolder_(st.code).createFile(Utilities.newBlob(all, st.mime, st.name));
    for (var j = 0; j < st.parts; j++) { try { DriveApp.getFileById(st.got[j]).setTrashed(true); } catch (e) {} }
    cc.remove(k);
    var exists = _rsRows_(MC_RS_SH_.MEDIA).filter(function (r) { return String(r.DishCode) === st.code && String(r['Статус']) !== 'DELETED'; });
    var row = _rsStamp_({ MediaID: _rsId_('MED'), DishCode: st.code, 'Тип': st.type, FileID: file.getId(), 'Файл': st.name, MIME: st.mime, 'Размер': st.size, 'SHA-256': _rsHex_(all),
      'Обложка': !!c.d.cover || !exists.length, 'Порядок': exists.length + 1, 'Статус': 'ACTIVE', 'Загрузил': _rsWho_(c.s), 'Загружено': new Date() }, c.s, c.op, true);
    var m = _rsMediaObj_(row); delete m.fileId;
    return { data: { media: m }, plan: [{ sheet: MC_RS_SH_.MEDIA, row: row }, { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'MEDIA', row.MediaID, null, 'MEDIA_UPLOADED', null, { dish: st.code, type: st.type, size: st.size, sha256: row['SHA-256'] }) }],
      audit: { action: 'RS_MEDIA_UPLOADED', entity: MC_RS_SH_.MEDIA, id: row.MediaID, after: { dish: st.code, type: st.type, size: st.size } } };
  });
}
/** Медиа: обложка, порядок, скрыть, удалить (файл — в корзину Drive). {idem, id, version, cover, order, status: ACTIVE|HIDDEN|DELETED} */
function rsMediaUpdate(json, token) {
  return _rsMutate_(token, 'menu_publish', 'RS_MEDIA_UPDATE', json, function (c) {
    var d = c.d, rows = _rsRows_(MC_RS_SH_.MEDIA), r = rows.filter(function (x) { return String(x.MediaID) === String(d.id); })[0];
    if (!r || String(r['Статус']) === 'DELETED') return { fail: ['NOT_FOUND', 'Файл не найден'] };
    _rsCheckVersion_(r, d.version);
    var before = _rsMediaObj_(r), o = JSON.parse(JSON.stringify(r)), plan = []; delete o._row;
    if (d.order !== undefined) o['Порядок'] = parseInt(d.order, 10) || 0;
    if (d.status && ['ACTIVE', 'HIDDEN', 'DELETED'].indexOf(d.status) >= 0) o['Статус'] = d.status;
    if (d.cover === true) {
      o['Обложка'] = true;
      rows.forEach(function (x) { if (String(x.DishCode) !== String(r.DishCode) || String(x.MediaID) === String(r.MediaID) || !(x['Обложка'] === true || String(x['Обложка']) === 'true')) return;
        var y = JSON.parse(JSON.stringify(x)); delete y._row; y['Обложка'] = false; _rsStamp_(y, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.MEDIA, row: y }); });
    }
    if (o['Статус'] === 'DELETED') { try { DriveApp.getFileById(String(r.FileID)).setTrashed(true); } catch (e) {} }
    _rsStamp_(o, c.s, c.op, false); plan.unshift({ sheet: MC_RS_SH_.MEDIA, row: o });
    var after = _rsMediaObj_(o); delete after.fileId; delete before.fileId;
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'MEDIA', o.MediaID, null, 'MEDIA_UPDATED', before, after) });
    _rsPubCacheDrop_();
    return { data: { media: after, note: 'Опубликованное блюдо обновится у гостя после «Опубликовать» ещё раз' }, plan: plan, audit: { action: 'RS_MEDIA_UPDATED', entity: MC_RS_SH_.MEDIA, id: o.MediaID, before: before, after: after } };
  });
}
/** Файл медиа для предпросмотра в редакторе (частями). {id, part} */
function rsMediaGet(json, token) {
  return _rsRead_(token, 'menu_publish', function () { var d = _rsJ_(json, {}) || {}; return _rsServeMedia_(String(d.id || ''), parseInt(d.part, 10) || 0, false); });
}

/* ---------------- публичная витрина ---------------- */
function _rsGuestOrderOn_() { try { return PropertiesService.getScriptProperties().getProperty('MC_RS_GUEST_ORDER') === 'on'; } catch (e) { return false; } }
function _rsPubCacheDrop_() { try { CacheService.getScriptCache().remove('rs_pub_menu'); } catch (e) {} }
/** Опубликованные снимки: {код: снимок}. */
function _rsPublished_() {
  var pubs = {}; _rsRows_(MC_RS_SH_.MENU_PUB).forEach(function (r) { if (String(r['Статус']) === 'PUBLISHED') pubs[String(r.DishCode)] = true; });
  var out = {}; _rsRows_(MC_RS_SH_.MENU_SNAP).forEach(function (r) { var k = String(r.DishCode); if (pubs[k]) { var s = _rsJ_(r['Снимок'], null); if (s) out[k] = s; } });
  return out;
}
/**
 * Публичное меню (без входа). {t: код стола из QR (необязательно)} → блюда со снимком, ценой на сегодня и доступностью.
 * Ничего, кроме разрешённых полей, не возвращает; причина STOP не раскрывается.
 */
function rsPublicMenu(json) {
  try {
    var d = _rsJ_(json, {}) || {}, c = CacheService.getScriptCache(), base = null;
    try { base = JSON.parse(c.get('rs_pub_menu') || 'null'); } catch (e) {}
    if (!base) {
      var snaps = _rsPublished_(), prices = _rsPriceIdx_(_rsToday_());
      base = Object.keys(snaps).filter(function (k) { return prices[k]; }).map(function (k) {
        var s = snaps[k], p = prices[k];
        return { id: k, name: s.name, category: s.category, description: s.description, order: s.order, dept: s.dept, yield: s.yield, yunit: s.yunit, composition: s.composition,
          kbju: s.kbju, kbjuNote: s.kbjuNote, allergens: s.allergens, allergensComplete: s.allergensComplete, media: s.media.map(function (m) { return { id: m.id, type: m.type }; }),
          priceKop: p.kop, priceFor: p.unitText, weighted: !!(p.unit && p.unit.weighted) };
      }).sort(function (a, b) { return a.category < b.category ? -1 : a.category > b.category ? 1 : a.order - b.order || (a.name < b.name ? -1 : 1); });
      try { var j = JSON.stringify(base); if (j.length < 95000) c.put('rs_pub_menu', j, MC_RS_PUB_CACHE_SEC_); } catch (e) {}
    }
    var stops = _rsStopIdx_();
    base.forEach(function (x) { var st = _rsStopOf_(stops, x.id, x.dept); x.available = st.status === 'GO' || (st.status === 'LIMITED' && !(st.left === 0)); delete x.dept; });
    var table = null, order = _rsGuestOrderOn_();
    if (d.t) { var t = _rsTableByQr_(String(d.t)); if (t) table = { number: t.number }; }
    var org = ''; try { org = String(PropertiesService.getScriptProperties().getProperty('MC_RS_MENU_TITLE') || ''); } catch (e) {}
    return JSON.stringify({ success: true, data: { title: org || 'Меню', dishes: base, guestOrder: order && !!table, table: table } });
  } catch (e) { return JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'Меню временно недоступно' } }); }
}
function _rsTableByQr_(code) {
  if (!/^[a-z0-9]{12}$/.test(code)) return null;
  var idx = _rsTablesIdx_(); for (var k in idx) if (idx[k].qr === code && idx[k].status === 'ACTIVE') return idx[k];
  return null;
}
/** Публичная выдача медиа частями — только файлы опубликованных блюд. {id, part} */
function rsPublicMedia(json) {
  try { var d = _rsJ_(json, {}) || {}; return JSON.stringify({ success: true, data: _rsServeMedia_(String(d.id || ''), parseInt(d.part, 10) || 0, true) }); }
  catch (e) { return JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Файл недоступен' } }); }
}
function _rsServeMedia_(id, part, publicOnly) {
  var fileId = '', mime = '';
  var dp = /^DP-(.+)-(\d+)$/.exec(id);
  if (publicOnly) {
    var snaps = _rsPublished_(), ok = Object.keys(snaps).some(function (k) { return snaps[k].media.some(function (m) { return m.id === id; }); });
    if (!ok) throw new Error('NOT_FOUND');
  }
  if (dp) { var ph = (_rsDishPhotos_()[dp[1]] || [])[parseInt(dp[2], 10)]; if (!ph) throw new Error('NOT_FOUND'); fileId = ph.fileId; }
  else {
    var r = _rsRows_(MC_RS_SH_.MEDIA).filter(function (x) { return String(x.MediaID) === id; })[0];
    if (!r || String(r['Статус']) === 'DELETED' || (publicOnly && String(r['Статус']) !== 'ACTIVE')) throw new Error('NOT_FOUND');
    fileId = String(r.FileID); mime = String(r.MIME);
  }
  var blob = DriveApp.getFileById(fileId).getBlob(), bytes = blob.getBytes(), parts = Math.max(1, Math.ceil(bytes.length / MC_RS_SERVE_CHUNK_));
  if (part < 0 || part >= parts) throw new Error('NOT_FOUND');
  return { id: id, mime: mime || blob.getContentType(), size: bytes.length, parts: parts, part: part, data: Utilities.base64Encode(bytes.slice(part * MC_RS_SERVE_CHUNK_, (part + 1) * MC_RS_SERVE_CHUNK_)) };
}

/* ---------------- заявка гостя ---------------- */
/** Заявка гостя со стола (без входа). Только при включённом заказе и по QR стола. {idem, t, items:[{id, qty, comment}], comment} */
function rsGuestRequest(json) {
  try {
    var d = _rsJ_(json, {}) || {};
    if (!_rsGuestOrderOn_()) return _fail_('VALIDATION', 'Заказ через меню не включён — позовите официанта');
    var t = _rsTableByQr_(String(d.t || '')); if (!t) return _fail_('VALIDATION', 'Стол не определён — отсканируйте QR-код на столе');
    var key = _rsIdemKey_(d.idem), items = Array.isArray(d.items) ? d.items : [];
    if (!items.length || items.length > 30) return _fail_('VALIDATION', 'В заявке — от 1 до 30 блюд');
    var c = CacheService.getScriptCache(), rk = 'rs_greq_' + t.id, n = parseInt(c.get(rk) || '0', 10);
    if (n >= 10) return _fail_('VALIDATION', 'Слишком много заявок со стола — позовите официанта');
    return _withLock_(function () {
      var rows = _rsRows_(MC_RS_SH_.GUEST_REQ), same = rows.filter(function (r) { return String(r.IdempotencyKey) === key; })[0];
      if (same) return _ok_({ requestId: String(same.RequestID), status: String(same['Статус']), replay: true });
      if (rows.filter(function (r) { return String(r.TableID) === t.id && String(r['Статус']) === 'NEW'; }).length >= 3) return _fail_('VALIDATION', 'Официант ещё не принял прежние заявки — подождите или позовите его');
      var pub = _rsPublished_(), stops = _rsStopIdx_(), out = [];
      for (var i = 0; i < items.length; i++) {
        var x = items[i] || {}, s = pub[_rsS_(x.id)], q = parseInt(x.qty, 10);
        if (!s) return _fail_('VALIDATION', 'Блюдо недоступно для заказа');
        if (!(q >= 1 && q <= 20)) return _fail_('VALIDATION', '«' + s.name + '»: количество — от 1 до 20');
        if (_rsStopOf_(stops, s.code, s.dept).status === 'STOP') return _fail_('VALIDATION', '«' + s.name + '» сейчас недоступно');
        out.push({ code: s.code, name: s.name, qty: q, comment: _rsS_(x.comment).replace(/[<>]/g, '').slice(0, 120) });
      }
      var id = _rsId_('GR'), row = _rsStamp_({ RequestID: id, SiteID: t.siteId, TableID: t.id, 'Стол': t.number, 'Позиции': JSON.stringify(out), 'Комментарий': _rsS_(d.comment).replace(/[<>]/g, '').slice(0, 200),
        'Статус': 'NEW', 'Создано': new Date(), IdempotencyKey: key }, null, null, true);
      _rsTxApply_(null, 'RS_GUEST_REQUEST', [{ sheet: MC_RS_SH_.GUEST_REQ, row: row }, { sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(null, null, 'GUEST_REQUEST', id, null, 'GUEST_REQUEST', null, { table: t.number, items: out }) }]);
      c.put(rk, String(n + 1), 3600);
      try { _notify_('GUEST_REQUEST', 'warning', 'Заявка гостя: стол № ' + t.number, out.map(function (x) { return x.name + ' × ' + x.qty; }).join(', '), 'Официант', 'RS_GR_' + id, null); } catch (e) {}
      return _ok_({ requestId: id, status: 'NEW', note: 'Заявка передана официанту. Блюда начнут готовить после его подтверждения.' });
    });
  } catch (e) { return _failFrom_(e); }
}
/** Заявки гостей площадки, ждущие решения. */
function rsGuestRequests(json, token) {
  return _rsRead_(token, 'order_edit|order_all', function () {
    var d = _rsJ_(json, {}) || {}, siteId = _rsSite_(d.siteId);
    return _rsRows_(MC_RS_SH_.GUEST_REQ).filter(function (r) { return String(r.SiteID) === siteId && String(r['Статус']) === 'NEW'; }).map(function (r) {
      return { id: String(r.RequestID), tableId: String(r.TableID), table: String(r['Стол']), items: _rsJ_(r['Позиции'], []), comment: String(r['Комментарий'] || ''),
        at: _rsIsDate_(r['Создано']) ? Utilities.formatDate(r['Создано'], _mcTz_(), 'HH:mm') : '', version: parseInt(r.Version, 10) || 1 };
    });
  });
}
/** Принять заявку в заказ стола (позиции — «не отправлено», официант отправляет сам) или отклонить с причиной. {idem, id, version, accept, reason, guests} */
function rsGuestRequestDecide(json, token) {
  return _rsMutate_(token, 'order_edit|order_all', 'RS_GUEST_REQUEST_DECIDE', json, function (c) {
    var d = c.d, r = _rsRows_(MC_RS_SH_.GUEST_REQ).filter(function (x) { return String(x.RequestID) === String(d.id); })[0];
    if (!r) return { fail: ['NOT_FOUND', 'Заявка не найдена'] };
    _rsCheckVersion_(r, d.version);
    if (String(r['Статус']) !== 'NEW') return { fail: ['VALIDATION', 'Заявка уже рассмотрена'] };
    var o = JSON.parse(JSON.stringify(r)); delete o._row; var plan = [], orderId = '', made = 0;
    if (!d.accept) {
      var why = _rsS_(d.reason).slice(0, 200); if (!why) return { fail: ['VALIDATION', 'Укажите причину отказа'] };
      o['Статус'] = 'REJECTED'; o['Причина'] = why;
    } else {
      var t = _rsTablesIdx_()[String(r.TableID)]; if (!t) return { fail: ['VALIDATION', 'Стол не найден'] };
      var open = _rsActiveOrders_(t.siteId)[t.id], dishes = _rsDishes_(), prices = _rsPriceIdx_(_rsToday_()), guests = 1;
      if (open) {
        if (!_rsCanOrder_(c.s, { WaiterID: open.waiterId })) return { fail: ['FORBIDDEN', 'На столе заказ официанта ' + open.waiter + ' — принять может он или администратор'] };
        orderId = open.id; guests = open.guests;
      } else {
        guests = Math.max(1, parseInt(d.guests, 10) || 1); orderId = _rsId_('ORD');
        plan.push({ sheet: MC_RS_SH_.ORDERS, row: _rsStamp_({ OrderID: orderId, SiteID: t.siteId, HallID: t.hallId, TableID: t.id, BookingID: '', 'Гостей': guests, 'Официант': _rsWho_(c.s), WaiterID: String(c.s.user_id || ''),
          'Открыт': new Date(), 'Комментарий': 'по заявке гостя', 'Статус': 'OPEN', IdempotencyKey: d.idem }, c.s, c.op, true) });
        for (var g = 1; g <= guests; g++) plan.push({ sheet: MC_RS_SH_.GUESTS, row: _rsStamp_({ GuestID: orderId + '-G' + g, OrderID: orderId, 'Номер': g, 'Метка': '' }, c.s, c.op, true) });
        _rsCourses_().forEach(function (cr) { plan.push({ sheet: MC_RS_SH_.COURSES, row: _rsStamp_({ CourseID: orderId + '-C' + cr.n, OrderID: orderId, 'Номер': cr.n, 'Название': cr.name, 'Статус': 'WAIT' }, c.s, c.op, true) }); });
      }
      var items = _rsJ_(r['Позиции'], []) || [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i], dish = dishes[it.code], p = prices[it.code];
        if (!dish || !p || !p.unit) return { fail: ['VALIDATION', '«' + it.name + '»: нет в каталоге или нет цены — отклоните заявку с причиной'] };
        var row = _rsItemRow_(orderId, dish, p, { qty: p.unit.weighted ? 1 : it.qty, comment: it.comment, modifiers: [] }, guests, 'GUEST ' + o.RequestID, i);
        if (p.unit.weighted && !(row['Вес план'] > 0)) return { fail: ['VALIDATION', '«' + it.name + '» — весовое: добавьте его вручную с весом'] };
        plan.push({ sheet: MC_RS_SH_.ITEMS, row: _rsStamp_(row, c.s, c.op, true) }); made++;
      }
      o['Статус'] = 'ACCEPTED'; o.OrderID = orderId;
    }
    o['Решил'] = _rsWho_(c.s); o['Решено'] = new Date(); _rsStamp_(o, c.s, c.op, false);
    plan.unshift({ sheet: MC_RS_SH_.GUEST_REQ, row: o });
    plan.push({ sheet: MC_RS_SH_.EVENTS, row: _rsEventRow_(c.op, c.s, 'GUEST_REQUEST', o.RequestID, { order: orderId }, 'GUEST_REQUEST_' + o['Статус'], { status: 'NEW' }, { status: o['Статус'], order: orderId, items: made, reason: o['Причина'] || '' }) });
    return { data: { status: o['Статус'], orderId: orderId, items: made }, plan: plan, audit: { action: 'RS_GUEST_REQUEST_' + o['Статус'], entity: MC_RS_SH_.GUEST_REQ, id: o.RequestID, after: { order: orderId, items: made } } };
  });
}
/** Настройки витрины: заказ гостя (вкл/выкл), заголовок. {idem, guestOrder, title} — право menu_publish. */
function rsMenuSettings(json, token) {
  return _rsMutate_(token, 'menu_publish', 'RS_MENU_SETTINGS', json, function (c) {
    var p = PropertiesService.getScriptProperties(), before = { guestOrder: _rsGuestOrderOn_(), title: p.getProperty('MC_RS_MENU_TITLE') || '' };
    if (c.d.guestOrder !== undefined) p.setProperty('MC_RS_GUEST_ORDER', c.d.guestOrder ? 'on' : 'off');
    if (c.d.title !== undefined) p.setProperty('MC_RS_MENU_TITLE', _rsS_(c.d.title).replace(/[<>]/g, '').slice(0, 60));
    var after = { guestOrder: _rsGuestOrderOn_(), title: p.getProperty('MC_RS_MENU_TITLE') || '' };
    return { data: after, audit: { action: 'RS_MENU_SETTINGS', entity: 'Меню гостя', id: '', before: before, after: after } };
  });
}

/** Выдать QR-коды действующим столам, у которых их ещё нет (столы, заведённые до этапа 5). {idem} */
function rsTablesQrIssue(json, token) {
  return _rsMutate_(token, 'menu_publish|hall_manage', 'RS_TABLES_QR', json, function (c) {
    var plan = [];
    _rsRows_(MC_RS_SH_.TABLES).forEach(function (r) { if (String(r['Статус']) !== 'ACTIVE' || String(r['QR-код'] || '')) return;
      var t = JSON.parse(JSON.stringify(r)); delete t._row; t['QR-код'] = _rsQrCode_(); _rsStamp_(t, c.s, c.op, false); plan.push({ sheet: MC_RS_SH_.TABLES, row: t }); });
    return { data: { issued: plan.length }, plan: plan, audit: { action: 'RS_TABLES_QR', entity: MC_RS_SH_.TABLES, id: '', after: { issued: plan.length } } };
  });
}
/** Ссылки и QR-коды гостевого меню: общий и по столам (столы без кода получают его). SVG — для печати на стол. */
function rsMenuQrs(json, token) {
  return _rsRead_(token, 'menu_publish|hall_manage', function () {
    var base = ''; try { base = ScriptApp.getService().getUrl() || ''; } catch (e) {}
    var svg = function (text) {
      try { var m = _mcQrMatrix_(text), n = m.length, d = ''; for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) d += 'M' + (c + 2) + ',' + (r + 2) + 'h1v1h-1z';
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (n + 4) + ' ' + (n + 4) + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>'; }
      catch (e) { return ''; }
    };
    var halls = _rsHallsIdx_(), out = [];
    Object.keys(_rsTablesIdx_()).forEach(function (k) {
      var t = _rsTablesIdx_()[k]; if (t.status !== 'ACTIVE' || !t.qr) return;
      var url = base + '?menu=1&t=' + t.qr; out.push({ table: t.number, hall: halls[t.hallId] ? halls[t.hallId].name : '', url: url, svg: svg(url) });
    });
    out.sort(function (a, b) { return a.hall < b.hall ? -1 : a.hall > b.hall ? 1 : (parseInt(a.table, 10) || 0) - (parseInt(b.table, 10) || 0); });
    var common = base + '?menu=1';
    return { common: { url: common, svg: svg(common) }, tables: out, missing: Object.keys(_rsTablesIdx_()).filter(function (k) { var t = _rsTablesIdx_()[k]; return t.status === 'ACTIVE' && !t.qr; }).length };
  });
}

var MC_GATE_EXT_ = (typeof MC_GATE_EXT_ !== 'undefined' && MC_GATE_EXT_) || {};
MC_GATE_EXT_.rsPublicMenu = { pub: true };
MC_GATE_EXT_.rsPublicMedia = { pub: true };
MC_GATE_EXT_.rsGuestRequest = { pub: true };
MC_GATE_EXT_.rsMenuAdmin = { need: 'menu_publish' };
MC_GATE_EXT_.rsMenuPreview = { need: 'menu_publish' };
MC_GATE_EXT_.rsMediaGet = { need: 'menu_publish' };
MC_GATE_EXT_.rsMediaUploadStart = { need: 'menu_publish' };
MC_GATE_EXT_.rsMediaUploadPart = { need: 'menu_publish' };
MC_GATE_EXT_.rsMediaUploadFinish = { need: 'menu_publish', mut: true };
MC_GATE_EXT_.rsMediaUpdate = { need: 'menu_publish', mut: true };
MC_GATE_EXT_.rsMenuSave = { need: 'menu_publish', mut: true };
MC_GATE_EXT_.rsMenuSettings = { need: 'menu_publish', mut: true };
MC_GATE_EXT_.rsMenuQrs = { need: 'menu_publish|hall_manage' };
MC_GATE_EXT_.rsTablesQrIssue = { need: 'menu_publish|hall_manage', mut: true };
MC_GATE_EXT_.rsGuestRequests = { need: 'order_edit|order_all' };
MC_GATE_EXT_.rsGuestRequestDecide = { need: 'order_edit|order_all', mut: true };
