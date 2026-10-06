// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — публичное QR-меню (отдельный проект Apps Script, этап M8).
 *
 * Зачем отдельный проект: основное приложение ЦЕХ открыто только владельцу (access: MYSELF),
 * а гостю нужна страница без входа. Этот проект разворачивается с доступом «Все» и умеет ровно
 * одно: по ключу точки (?m=…) показать снимок меню из листа PUBLIC_MENU. Права — только чтение
 * таблиц (spreadsheets.readonly); другие листы код не открывает. Снимок собирает основное
 * приложение (Pos.gs::_posPublicMenuData_) — без себестоимости, поставщиков и сотрудников.
 *
 * Установка: см. qrmenu/README.md. В свойствах этого проекта нужен SPREADSHEET_ID — тот же,
 * что у основного ЦЕХ.
 */

var QRMENU_SHEET_ = 'PUBLIC_MENU';
var QRMENU_CACHE_SECONDS_ = 60;

function doGet(e) {
  var p = (e && e.parameter) || {};
  var data = qrmenuLoad_(String(p.m || ''));
  var html = data ? qrmenuRender_(data, String(p.t || '')) : qrmenuNotFound_();
  return HtmlService.createHtmlOutput(html)
    .setTitle(data && data.заведение ? data.заведение + ' — меню' : 'Меню')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Снимок меню по ключу точки. Ключ — 32 hex-символа; выключенное меню не отдаётся. */
function qrmenuLoad_(token) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  var cache = CacheService.getScriptCache();
  var hit = cache.get('qrmenu_' + token);
  if (hit) return hit === 'none' ? null : JSON.parse(hit);
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Не задан SPREADSHEET_ID в свойствах проекта QR-меню.');
  var sheet = SpreadsheetApp.openById(id).getSheetByName(QRMENU_SHEET_);
  if (!sheet) return null;
  var values = sheet.getDataRange().getValues();
  var head = values[0] || [];
  var col = function (name) { return head.indexOf(name); };
  var iToken = col('token'), iJson = col('json'), iOn = col('включено');
  var data = null;
  for (var r = 1; r < values.length; r++) {
    if (values[r][iToken] !== token) continue;
    var on = values[r][iOn];
    if (on === false || String(on) === 'false') break;
    try { data = JSON.parse(values[r][iJson]); } catch (err) { data = null; }
    break;
  }
  try { cache.put('qrmenu_' + token, data ? JSON.stringify(data) : 'none', QRMENU_CACHE_SECONDS_); } catch (err) { /* слишком большое — без кэша */ }
  return data;
}

function qrmenuEsc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function qrmenuMoney_(n) {
  var v = Math.round((Number(n) || 0) * 100) / 100;
  var parts = v.toFixed(v % 1 ? 2 : 0).split('.');
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (parts[1] ? ',' + parts[1] : '') + ' ₽';
}

var QRMENU_CSS_ = [
  ':root{--bg:#F1E6D8;--card:#FFFFFF;--ink:#1A1410;--muted:#6E5E50;--brand:#3B2A20;--accent:#F5A623;--line:#E5DDD3;}',
  '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;}',
  'header{background:var(--brand);color:#fff;padding:16px;position:sticky;top:0;z-index:2}',
  'header h1{margin:0;font-size:20px;color:var(--accent);letter-spacing:.5px}header p{margin:4px 0 0;font-size:13px;opacity:.85}',
  'nav{display:flex;gap:6px;overflow-x:auto;padding:10px 16px;background:var(--bg);position:sticky;top:68px;z-index:1;-webkit-overflow-scrolling:touch}',
  'nav a{flex:none;padding:8px 14px;border-radius:20px;border:1px solid var(--brand);color:var(--brand);text-decoration:none;font-size:14px;background:var(--card)}',
  'main{max-width:720px;margin:0 auto;padding:0 16px 32px}h2{font-size:18px;margin:18px 0 8px;scroll-margin-top:130px}',
  '.dish{background:var(--card);border-radius:14px;padding:14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.06)}',
  '.top{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.name{font-weight:700;font-size:16px;overflow-wrap:anywhere}',
  '.price{font-weight:800;white-space:nowrap}.meta{color:var(--muted);font-size:13px;margin-top:4px}',
  '.allerg{font-size:13px;margin-top:6px;padding:6px 8px;border-radius:8px;background:#FFF6E5}',
  '.var{font-size:13px;color:var(--muted);margin-top:6px}.var b{color:var(--ink);font-weight:600}',
  'footer{color:var(--muted);font-size:12px;text-align:center;padding:16px}.empty{padding:40px 16px;text-align:center}'
].join('');

function qrmenuRender_(data, tableId) {
  var e = qrmenuEsc_;
  var table = tableId && data.столы && data.столы[tableId] ? data.столы[tableId] : '';
  var groups = {}, order = [];
  (data.блюда || []).forEach(function (d) {
    if (!groups[d.категория]) { groups[d.категория] = []; order.push(d.категория); }
    groups[d.категория].push(d);
  });
  var nav = order.length > 1 ? '<nav aria-label="Категории">' + order.map(function (c, i) { return '<a href="#c' + i + '">' + e(c) + '</a>'; }).join('') + '</nav>' : '';
  var body = order.map(function (c, i) {
    return '<h2 id="c' + i + '">' + e(c) + '</h2>' + groups[c].map(function (d) {
      var meta = [];
      if (d.выход) meta.push('выход ' + e(d.выход) + ' г');
      if (d.пищевая_ценность) meta.push(e(d.пищевая_ценность));
      var vars = (d.варианты || []).map(function (g) {
        return '<div class="var"><b>' + e(g.группа) + ':</b> ' + g.список.map(function (m) {
          var dl = Number(m.цена_delta) || 0;
          return e(m.название) + (dl ? ' (' + (dl > 0 ? '+' : '−') + qrmenuMoney_(Math.abs(dl)) + ')' : '');
        }).join(', ') + '</div>';
      }).join('');
      return '<article class="dish"><div class="top"><span class="name">' + e(d.название) + '</span><span class="price">' + qrmenuMoney_(d.цена) + '</span></div>' +
        (meta.length ? '<div class="meta">' + meta.join(' · ') + '</div>' : '') +
        (d.аллергены ? '<div class="allerg">Аллергены: ' + e(d.аллергены) + '</div>' : '') + vars + '</article>';
    }).join('');
  }).join('');
  var updated = data.обновлено ? new Date(data.обновлено) : null;
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>' + QRMENU_CSS_ + '</style></head><body>' +
    '<header><h1>' + e(data.заведение || 'Меню') + '</h1><p>' + (table ? 'Стол ' + e(table) + ' · ' : '') + 'Чтобы заказать, позовите официанта</p></header>' +
    nav + '<main>' + (body || '<p class="empty">Меню скоро появится.</p>') + '</main>' +
    '<footer>Цены в рублях. Наличие блюд обновляется каждые 15 минут' +
    (updated ? ' · обновлено ' + e(Utilities.formatDate(updated, 'Europe/Moscow', 'dd.MM HH:mm')) : '') + '.</footer></body></html>';
}

function qrmenuNotFound_() {
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>' + QRMENU_CSS_ + '</style></head><body>' +
    '<header><h1>Меню</h1></header><main><p class="empty">Меню не найдено или временно выключено. Попросите меню у официанта.</p></main></body></html>';
}
