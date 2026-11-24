/**
 * MON CHEF — распознавание банкетного бланка: таблица по координатам слов (2026-10).
 *
 * Почему прежний разбор путал количество. Бланк широкий: от названия до «Суммы» на фото ~400 точек. Телефон
 * держат с наклоном 2–5° (на присланных бланках — 2,6–4,3°), и правый край строки уходит вниз на 15–30 точек —
 * больше высоты строки. Сборка строк «по высоте» (прежний _rebuildTableText_) приклеивала цифры блюда к соседнему
 * названию, и модель получала уже перепутанный текст. Выпрямление на телефоне помогает не всегда: края листа на
 * светлом столе часто не находятся, а найденная рамка таблицы обрезала пометки справа (исправлено в docscan).
 * Здесь:
 *   1) слова Vision выпрямляются: наклон — по профилю строк (перебор углов), трапеция — по столбику цен;
 *   2) колонки — по шапке «цена / выход / Кол-во / Сумма» (с ошибками OCR), без шапки — по столбикам чисел;
 *   3) названия собираются из переносов (продолжение — со строчной буквы, «(», «,», после «и/с/из…»);
 *   4) ряды цифр собираются по колонкам и проверяются арифметикой «цена × кол-во = сумма»;
 *   5) названия и ряды цифр сопоставляются ПО ПОРЯДКУ (динамическое выравнивание); если сетка цифр всё же
 *      сдвинута относительно названий (другой шаблон, остаточный наклон), сдвиг подбирается, но принимается
 *      только при явном выигрыше; лишнее не теряется, а остаётся строкой «на проверку»;
 *   6) пометки справа от «Суммы» («фуршет», «детям», «2-е гор», «0,5 порции») — к своей строке;
 *   7) итог бланка (число справа от шапки и в «Всего»/«Итого») — контроль полноты: сумма строк = итог.
 * Ничего не додумывается: чего нет на фото — null и предупреждение.
 */
var BQO_ = {
  NUM_HDR: [['price', /^цен[аы]?$/], ['yield', /^(в|и)?ыход$/], ['qty', /^кол(-?во)?$|^количество$/], ['sum', /^сумм[аы]?$/]],
  FOOT: /^(всего|итого|налог|ндс|сервис|скидк|выездн|применяется)/,
  META: [['format', /^формат/], ['date', /^дата/], ['time', /^время/], ['place', /^место/], ['guests', /^количество|^кол-во\s*перс/], ['contact', /^контактн/], ['payment', /^произведен|^оплат/], ['comment', /^пожелани/]],
  KIND: [['note', /^(обратите\s+внимание|внимание|примечание)/i],
         ['service', /^услуга|продление\s+работы|обслуживани[ея]\s|аренда|пробков|депозит|сбор\s+за/i],
         ['drink', /^(вода|морс|сок|бон\s*аква|лимонад|компот|чай(?!н)|кофе|напит|минерал|кола|coca|pepsi|пепси|спрайт|фанта|квас|нектар|вино|шампанск|пиво|водка|коньяк)/i],
         ['set', /(^|\s)(сэт|сет|комплексн\S*|ланч|фуд\s*бар|набор|трио|пакет)(\s|$|№)/i]]
};

/* ---------- слова ---------- */
/** Ориентация снимка по направлению чтения: в строке Vision слова идут по порядку чтения — если x убывает,
 *  фото вверх ногами (координаты в системе исходного снимка), если меняется y — фото боком. Бланки с Диска: 3 из 36
 *  сняты вверх ногами. Возвращает поворот, который приводит текст к чтению слева направо: 0 / 90 / 180 / 270. */
function _bqoOrient_(ann) {
  var votes = { 0: 0, 90: 0, 180: 0, 270: 0 }, n = 0;
  ((ann && ann.blocks) || []).forEach(function (b) {
    (b.lines || []).forEach(function (ln) {
      var ws = (ln.words || []).filter(function (w) { return w.boundingBox && w.boundingBox.vertices && w.boundingBox.vertices.length >= 4; });
      if (ws.length < 2) return;
      var c = function (w) { var v = w.boundingBox.vertices, sx = 0, sy = 0; v.forEach(function (p) { sx += Number(p.x) || 0; sy += Number(p.y) || 0; }); return [sx / v.length, sy / v.length]; };
      var a = c(ws[0]), z = c(ws[ws.length - 1]), dx = z[0] - a[0], dy = z[1] - a[1];
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      n++;
      if (Math.abs(dx) >= Math.abs(dy)) votes[dx > 0 ? 0 : 180]++; else votes[dy > 0 ? 270 : 90]++;
    });
  });
  var best = 0; [90, 180, 270].forEach(function (k) { if (votes[k] > votes[best]) best = k; });
  if (n < 6 || votes[best] < n * 0.7) best = 0;
  return { rot: best, lines: n, votes: votes };
}
function _bqoWords_(ann) {
  var out = [], tops = (ann && ann.pageTops) || [0];
  var or = tops.length > 1 ? { rot: 0 } : _bqoOrient_(ann), W = Number(ann && ann.width) || 0, H = Number(ann && ann.height) || 0;
  if (or.rot && (!W || !H)) { var mx = 0, my = 0; ((ann && ann.blocks) || []).forEach(function (b) { (b.lines || []).forEach(function (ln) { (ln.words || []).forEach(function (w) { ((w.boundingBox && w.boundingBox.vertices) || []).forEach(function (p) { mx = Math.max(mx, Number(p.x) || 0); my = Math.max(my, Number(p.y) || 0); }); }); }); }); W = W || mx; H = H || my; }
  // поворот координат: 180 — (W−x, H−y); текст читается сверху вниз (270) — (y, W−x); снизу вверх (90) — (H−y, x)
  var tr = or.rot === 180 ? function (x, y) { return [W - x, H - y]; } : or.rot === 270 ? function (x, y) { return [y, W - x]; } : or.rot === 90 ? function (x, y) { return [H - y, x]; } : null;
  out.orient = or.rot;
  ((ann && ann.blocks) || []).forEach(function (b, bi) {
    (b.lines || []).forEach(function (ln, li) {
      (ln.words || []).forEach(function (w) {
        var v = w.boundingBox && w.boundingBox.vertices, t = String(w.text || '').trim();
        if (!v || v.length < 4 || !t) return;
        var xs = v.map(function (p) { return Number(p.x) || 0; }), ys = v.map(function (p) { return Number(p.y) || 0; });
        if (tr) { var pts = xs.map(function (x, i) { return tr(x, ys[i]); }); xs = pts.map(function (p) { return p[0]; }); ys = pts.map(function (p) { return p[1]; }); }
        var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
        var cy = (y0 + y1) / 2, page = 1;
        for (var k = 1; k < tops.length; k++) if (cy >= tops[k]) page = k + 1;
        out.push({ t: t, x0: x0, x1: x1, y0: y0, y1: y1, cx: (x0 + x1) / 2, cy: cy, h: Math.max(1, y1 - y0), w: Math.max(1, x1 - x0), line: bi + ':' + li, page: page });
      });
    });
  });
  return out;
}
function _bqoMed_(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.floor(s.length / 2)]; }
function _bqoKey_(t) { return String(t || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\-]/g, ''); }
function _bqoIsNum_(t) { return /^[\[\(|'"‘`]?\d[\d\s.,\\\/|]*(гр|г|мл|л|литр|литра|шт|кг|порц)?\.?[\]\)|'"’.,]?$/i.test(String(t).trim()); }
function _bqoClean_(t) { return String(t).trim().replace(/^[\[\](){}|'"‘’`]+|[\[\](){}|'"‘’`.,;:]+$/g, ''); }

/** Наклон фото: перебор углов, при котором центры слов сильнее всего «собираются» в строки (профиль проекции). */
function _bqoSkew_(ws, lo, hi) {
  if (ws.length < 12) return 0;
  lo = lo === undefined ? -0.12 : lo; hi = hi === undefined ? 0.12 : hi;
  var h = _bqoMed_(ws.map(function (w) { return w.h; })) || 10, bin = Math.max(2, h * 0.35), best = 0, bestS = -1;
  for (var s = lo; s <= hi + 1e-4; s += 0.002) {
    var hist = {}, sc = 0;
    ws.forEach(function (w) { var k = Math.round((w.cy - s * w.cx) / bin); hist[k] = (hist[k] || 0) + w.w; });
    Object.keys(hist).forEach(function (k) { sc += hist[k] * hist[k]; });
    if (sc > bestS || (sc === bestS && Math.abs(s) < Math.abs(best))) { bestS = sc; best = s; }
  }
  return Math.round(best * 1000) / 1000;
}
/** Бланки с Диска: лист снят под углом или лежит на стопке — наклон строк вверху и внизу разный («веер», до 3°).
 *  Наклон считается по полосам высоты и приближается прямой s(y) = s0 + k·(y − yMid); одна цифра — если веера нет. */
function _bqoSkewField_(ws) {
  var s0 = _bqoSkew_(ws), out = { s0: s0, k: 0, ym: 0, bands: [] };
  if (ws.length < 150) return out;
  var ys = ws.map(function (w) { return w.cy; }).sort(function (a, b) { return a - b; }), y0 = ys[Math.floor(ys.length * 0.03)], y1 = ys[Math.floor(ys.length * 0.97)], N = 5;
  var pts = [];
  for (var b = 0; b < N; b++) {
    var lo = y0 + (y1 - y0) * b / N, hi = y0 + (y1 - y0) * (b + 1) / N, sub = ws.filter(function (w) { return w.cy >= lo && w.cy < hi; });
    if (sub.length < 25) continue;
    pts.push({ y: (lo + hi) / 2, s: _bqoSkew_(sub, s0 - 0.06, s0 + 0.06), n: sub.length });
  }
  out.bands = pts.map(function (p) { return p.s; });
  if (pts.length < 4) return out;
  var W = 0, my = 0, ms = 0; pts.forEach(function (p) { W += p.n; my += p.y * p.n; ms += p.s * p.n; }); my /= W; ms /= W;
  var sxy = 0, sxx = 0; pts.forEach(function (p) { sxy += p.n * (p.y - my) * (p.s - ms); sxx += p.n * (p.y - my) * (p.y - my); });
  var k = sxx ? sxy / sxx : 0, res = 0;
  pts.forEach(function (p) { res = Math.max(res, Math.abs(ms + k * (p.y - my) - p.s)); });
  // веер принимается, если разница наклонов верх/низ заметна (≥ 0,7°) и полосы ложатся на прямую
  if (Math.abs(k * (y1 - y0)) < 0.012 || res > 0.012) return out;
  out.s0 = ms; out.k = k; out.ym = my;
  return out;
}
function _bqoRotate_(ws, s) {
  if (typeof s === 'object') {
    // переменный наклон: поворот вокруг центра листа по x; s зависит от высоты слова
    var f = s, xm = _bqoMed_(ws.map(function (w) { return w.cx; }));
    ws.forEach(function (w) { var sy = f.s0 + f.k * (w.cy - f.ym), c = 1 / Math.sqrt(1 + sy * sy);
      w.rx = (w.cx + sy * (w.cy - f.ym)) * c; w.ry = (w.cy - sy * (w.cx - xm)) * c; w.rx0 = w.rx - w.w / 2; w.rx1 = w.rx + w.w / 2; });
    return;
  }
  var c = 1 / Math.sqrt(1 + s * s);
  ws.forEach(function (w) { w.rx = (w.cx + s * w.cy) * c; w.ry = (w.cy - s * w.cx) * c; w.rx0 = w.rx - w.w / 2; w.rx1 = w.rx + w.w / 2; });
}
/** Слова → визуальные строки (по выпрямленной высоте), внутри строки — слева направо. */
function _bqoLines_(ws, h) {
  var s = ws.slice().sort(function (a, b) { return a.ry - b.ry; }), lines = [], cur = null;
  s.forEach(function (w) {
    if (cur && Math.abs(w.ry - cur.ry) <= h * 0.55) { cur.ws.push(w); cur.ry = cur.ws.reduce(function (a, x) { return a + x.ry; }, 0) / cur.ws.length; }
    else { cur = { ws: [w], ry: w.ry }; lines.push(cur); }
  });
  lines.forEach(function (l) { l.ws.sort(function (a, b) { return a.rx - b.rx; }); l.text = l.ws.map(function (w) { return w.t; }).join(' ').replace(/\s+([,.)])/g, '$1').replace(/\(\s+/g, '('); l.x0 = l.ws[0].rx0; l.x1 = l.ws[l.ws.length - 1].rx1; l.page = l.ws[0].page; });
  return lines;
}

/* ---------- шапка и колонки ---------- */
/** Расстояние Левенштейна (для заголовков колонок с ошибками OCR). */
function _bqoLev_(a, b) {
  var m = a.length, n = b.length, d = []; if (!m) return n; if (!n) return m;
  for (var i = 0; i <= m; i++) { d[i] = [i]; for (var j = 1; j <= n; j++) d[i][j] = i ? Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)) : j; }
  return d[m][n];
}
/** Вид заголовка колонки: «цена», «выход», «Кол-во», «Сумма» — с латиницей вместо кириллицы и 1–2 ошибками («[Выход», «kon-ao»). */
function _bqoHdrKind_(t) {
  var lat = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', u: 'и', n: 'л', r: 'г' };
  var k = _bqoKey_(t).replace(/[a-z]/g, function (c) { return lat[c] || c; });
  if (k.length < 3) return null;
  for (var i = 0; i < BQO_.NUM_HDR.length; i++) if (BQO_.NUM_HDR[i][1].test(k)) return BQO_.NUM_HDR[i][0];
  var canon = [['price', 'цена', 1], ['yield', 'выход', 1], ['qty', 'кол-во', 2], ['qty', 'колво', 1], ['sum', 'сумма', 1]];
  for (var j = 0; j < canon.length; j++) if (Math.abs(k.length - canon[j][1].length) <= canon[j][2] && _bqoLev_(k, canon[j][1]) <= canon[j][2]) return canon[j][0];
  return null;
}
function _bqoHeader_(ws, h) {
  var cand = ws.filter(function (w) { return !!(w.hk = _bqoHdrKind_(w.t)); });
  var best = null;
  cand.forEach(function (a) {
    var row = cand.filter(function (b) { return Math.abs(b.ry - a.ry) <= h * 1.6; }), cols = {};
    row.forEach(function (b) { var k = b.hk; if (!cols[k] || Math.abs(b.ry - a.ry) < Math.abs(cols[k].ry - a.ry)) cols[k] = b; });
    var keys = ['price', 'yield', 'qty', 'sum'].filter(function (k) { return cols[k]; });
    var ordered = keys.every(function (k, i) { return !i || cols[keys[i - 1]].rx < cols[k].rx; });
    if (keys.length >= 2 && ordered && (!best || keys.length > best.n || (keys.length === best.n && a.ry < best.ry))) best = { n: keys.length, cols: cols, ry: a.ry };
  });
  if (!best) return null;
  var c = best.cols, X = {};
  ['price', 'yield', 'qty', 'sum'].forEach(function (k) { if (c[k]) X[k] = c[k].rx; });
  // недостающие колонки — по соседним (типичные доли ширины)
  if (X.price == null && X.yield != null && X.qty != null) X.price = X.yield - (X.qty - X.yield) * 1.05;
  if (X.sum == null && X.qty != null && X.yield != null) X.sum = X.qty + (X.qty - X.yield) * 1.0;
  if (X.yield == null && X.price != null && X.qty != null) X.yield = (X.price + X.qty) / 2;
  if (X.qty == null && X.yield != null && X.sum != null) X.qty = (X.yield + X.sum) / 2;
  if (X.price == null || X.sum == null) return null;
  if (X.yield == null) X.yield = X.price + (X.sum - X.price) / 3;
  if (X.qty == null) X.qty = X.price + (X.sum - X.price) * 2 / 3;
  var name = ws.filter(function (w) { return /^наименовани/.test(_bqoKey_(w.t)) && w.rx < X.price; })[0];
  var code = ws.filter(function (w) { return _bqoKey_(w.t) === 'код' && w.rx < X.price && Math.abs(w.ry - best.ry) < h * 4; })[0];
  return { X: X, ry: best.ry, nameRy: name ? name.ry : best.ry - h, codeX1: code ? code.rx1 : null, found: best.n, how: 'шапка' };
}
/** Без шапки (второй лист, шапка не прочиталась): колонки по столбикам чисел, проверка арифметикой. */
function _bqoColumnsByNumbers_(ws, h, width) {
  var nums = ws.filter(function (w) { return _bqoIsNum_(w.t) && w.rx > width * 0.35; }).sort(function (a, b) { return a.rx - b.rx; });
  if (nums.length < 6) return null;
  var cl = [], cur = null, gap = Math.max(h * 1.6, 12);
  nums.forEach(function (w) { if (cur && w.rx - cur.last <= gap) { cur.ws.push(w); cur.last = w.rx; } else { cur = { ws: [w], last: w.rx }; cl.push(cur); } });
  cl = cl.filter(function (c) { return c.ws.length >= Math.max(3, nums.length * 0.08); }).map(function (c) { return { x: _bqoMed_(c.ws.map(function (w) { return w.rx; })), n: c.ws.length, ws: c.ws }; });
  if (cl.length < 3) return null;
  var pick = function (ix) { return { price: cl[ix[0]].x, yield: ix.length === 4 ? cl[ix[1]].x : null, qty: cl[ix[ix.length - 2]].x, sum: cl[ix[ix.length - 1]].x }; };
  var tries = [], n = cl.length;
  for (var a = 0; a < n; a++) for (var b = a + 1; b < n; b++) for (var c = b + 1; c < n; c++) { tries.push([a, b, c]); for (var d = c + 1; d < n; d++) tries.push([a, b, c, d]); }
  var best = null;
  tries.forEach(function (ix) {
    var X = pick(ix); if (X.yield == null) X.yield = (X.price + X.qty) / 2;
    var rows = _bqoNumRows_(ws.filter(function (w) { return _bqoIsNum_(w.t); }), X, h, -1e9, 1e9), good = rows.filter(function (r) { return r.arith === 'ok'; }).length;
    if (!best || good > best.good || (good === best.good && ix.length > best.len)) best = { X: X, good: good, len: ix.length };
  });
  if (!best || best.good < 2) return null;
  return { X: best.X, ry: -1e9, nameRy: -1e9, codeX1: null, found: 0, how: 'столбики чисел' };
}

/** Трапеция/поворот, не убранные выпрямлением: столбик цен (выровнен по левому краю) должен быть вертикальным.
 *  По словам-числам у колонки цены — наклон их левого края по высоте; x всех слов поправляется. */
function _bqoDrift_(ws, X, cw, h, hdrY) {
  var pts = ws.filter(function (w) { return _bqoIsNum_(w.t) && /^\d{2,6}$/.test(_bqoClean_(w.t)) && Math.abs(w.rx - X.price) < cw * 0.6 && w.ry > hdrY; });
  if (pts.length < 6) return 0;
  var best = 0, bestN = -1;
  for (var b = -0.06; b <= 0.0601; b += 0.0025) {
    var xs = pts.map(function (w) { return w.rx0 - b * (w.ry - hdrY); }), m = _bqoMed_(xs), n = xs.filter(function (x) { return Math.abs(x - m) < h * 0.5; }).length;
    if (n > bestN || (n === bestN && Math.abs(b) < Math.abs(best))) { bestN = n; best = b; }
  }
  if (Math.abs(best) < 0.004) return 0;
  ws.forEach(function (w) { var dx = best * (w.ry - hdrY); if (w.ry > hdrY) { w.rx -= dx; w.rx0 -= dx; w.rx1 -= dx; } });
  return best;
}

/* ---------- числа ---------- */
function _bqoNum_(t) { var s = _bqoClean_(t).replace(/\s/g, ''); if (!/^\d+([.,]\d+)?$/.test(s)) return null; return parseFloat(s.replace(',', '.')); }
function _bqoColOf_(w, X) {
  var best = null, bd = 1e9;
  ['price', 'yield', 'qty', 'sum'].forEach(function (k) { var d = Math.abs(w.rx - X[k]); if (d < bd) { bd = d; best = k; } });
  return best;
}
/** Числовые слова → ряды. Ряд: цена/выход могут стоять выше кол-ва/суммы (у высоких ячеек) — склеиваются,
 *  если не конфликтуют по колонкам; одиночная «сумма» уходит к ряду выше без суммы. */
function _bqoNumRows_(nws, X, h, yMin, yMax, L) {
  var tok = nws.filter(function (w) { return w.ry > yMin && w.ry < yMax; }).map(function (w) {
    var col = _bqoColOf_(w, X), raw = _bqoClean_(w.t), v = col === 'yield' ? raw : _bqoNum_(w.t);
    return { w: w, col: col, raw: raw, v: v, ry: w.ry };
  }).filter(function (t) { return t.col === 'yield' ? !!t.raw : t.v !== null; });
  // визуальные строки чисел; если в строке два числа одной колонки — это два ряда (наклон/тесные строки): делим по высоте.
  // Склеиваются только куски одного числа вплотную («12 999»).
  var lines0 = _bqoLines_(tok.map(function (t) { t.w.__t = t; return t.w; }), h).map(function (l) { return l.ws.map(function (w) { return w.__t; }); }), lines = [];
  var glue = function (a, b) { return (a.col === 'price' || a.col === 'sum') && a.col === b.col && /^\d{1,3}$/.test(a.raw) && /^\d{3}$/.test(b.raw) && b.w.rx0 - a.w.rx1 < h * 0.8 && Math.abs(a.ry - b.ry) < h * 0.4; };
  var split = function (lt) {
    var seen = {}, dup = false;
    lt.forEach(function (t, i) { if (seen[t.col] !== undefined && !glue(lt[seen[t.col]], t)) dup = true; seen[t.col] = i; });
    if (!dup || lt.length < 2) { lines.push(lt); return; }
    var s2 = lt.slice().sort(function (a, b) { return a.ry - b.ry; }), bi = 1, bg = -1;
    for (var i = 1; i < s2.length; i++) if (s2[i].ry - s2[i - 1].ry > bg) { bg = s2[i].ry - s2[i - 1].ry; bi = i; }
    split(s2.slice(0, bi).sort(function (a, b) { return a.w.rx - b.w.rx; })); split(s2.slice(bi).sort(function (a, b) { return a.w.rx - b.w.rx; }));
  };
  lines0.forEach(split);
  var rows = [], cur = null;
  var has = function (r, k) { return r && r.c[k] !== undefined; };
  lines.forEach(function (lt) {
    var c = {}, ys = [], prev = null;
    lt.forEach(function (t) {
      if (c[t.col] !== undefined && prev && glue(prev, t)) c[t.col] = parseFloat(String(prev.raw) + String(t.raw));
      else if (c[t.col] !== undefined && t.col === 'yield') c.yield = c.yield + ' ' + t.raw;
      else c[t.col] = t.col === 'yield' ? t.raw : t.v;
      ys.push(t.ry); prev = t;
    });
    var y = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length;
    var clash = cur && Object.keys(c).some(function (k) { return has(cur, k); });
    var near = cur && y - cur.yLast <= Math.max(h * 3.6, (L || 0) * 2.6);
    var startsNew = c.price !== undefined || !cur || clash || !near;
    if (startsNew) { cur = { c: c, y0: y, yLast: y, yBot: y, toks: lt.slice() }; rows.push(cur); }
    else { Object.keys(c).forEach(function (k) { cur.c[k] = c[k]; }); cur.yLast = y; cur.yBot = y; cur.toks = cur.toks.concat(lt); }
  });
  // ряд «только кол-во/сумма» сразу над рядом с ценой без них (обратный порядок) — склеить, если сходится арифметика
  for (var i = 0; i + 1 < rows.length; i++) {
    var a = rows[i], b = rows[i + 1];
    if (a.c.price === undefined && b.c.price !== undefined && b.c.qty === undefined && b.c.sum === undefined && b.y0 - a.yLast <= h * 1.6) {
      var m = { price: b.c.price, yield: b.c.yield, qty: a.c.qty, sum: a.c.sum };
      if (m.qty && m.sum && Math.abs(m.price * m.qty - m.sum) <= Math.max(1, m.sum * 0.005)) { b.c = m; b.y0 = Math.min(a.y0, b.y0); b.yBot = Math.max(a.yBot, b.yBot); b.toks = a.toks.concat(b.toks); rows.splice(i, 1); i--; }
    }
  }
  rows.forEach(function (r) {
    var p = r.c.price, q = r.c.qty, s = r.c.sum;
    r.arith = p && q && s ? (Math.abs(p * q - s) <= Math.max(1, s * 0.005) ? 'ok' : 'bad') : 'part';
    // у высоких ячеек кол-во/сумма стоят у нижней границы — опорная высота ряда по ним
    var bottomT = r.toks.filter(function (t) { return t.col === 'qty' || t.col === 'sum'; });
    r.y = bottomT.length ? Math.max.apply(null, bottomT.map(function (t) { return t.ry; })) : r.yBot;
    r.page = r.toks[0].w.page;
  });
  return rows;
}

/* ---------- названия ---------- */
/** Строка продолжает предыдущее название: начинается со строчной буквы, «(», «,», цифры, «)», кавычки+строчной,
 *  или предыдущая строка оборвана на предлоге/союзе/запятой («…хрустящим баклажаном и»). */
function _bqoIsCont_(prevItem, text) {
  var t = String(text).trim(); if (!t) return true;
  var c = t.charAt(0);
  if (/[a-zа-яё]/.test(c)) return true;
  if (/[(,).;:\-–—\d\/\\]/.test(c)) return true;
  if (/^["«'“][a-zа-яё]/.test(t)) return true;
  // незакрытая скобка — не признак: на бланках скобку часто не закрывают («( 6 видов сырокопченых колбас»)
  if (prevItem) {
    var all = prevItem.lines[prevItem.lines.length - 1].text;
    if (/(\s|^)(с|и|из|на|в|со|под|для|по|от|за|к|без)$/i.test(all) || /[,\-–]$/.test(all)) return true;
  }
  return false;
}
function _bqoItems_(lines) {
  var items = [];
  // мусор распознавания (черта таблицы «___», одиночная буква) — не строка бланка
  lines = lines.filter(function (l) { return /[а-яёa-z]{3,}/i.test(l.text) || /[а-яё]{2,}.*\d|\d.*[а-яё]{2,}/i.test(l.text); });
  lines.forEach(function (l) {
    var last = items[items.length - 1];
    if (last && _bqoIsCont_(last, l.text) && l.ry - last.lines[last.lines.length - 1].ry < 3.2 * (last.h || 14)) { last.lines.push(l); }
    else items.push({ lines: [l], h: _bqoMed_(l.ws.map(function (w) { return w.h; })) });
  });
  items.forEach(function (it) {
    it.top = it.lines[0].ry; it.bottom = it.lines[it.lines.length - 1].ry; it.page = it.lines[0].page;
    it.name = it.lines.map(function (l) { return l.text; }).join(' ').replace(/\s+/g, ' ').replace(/\s+([,.)])/g, '$1').trim();
  });
  return items;
}

/* ---------- выравнивание по порядку ---------- */
/** Сопоставить названия (A: top..bottom) и ряды (B: y) по порядку. Перебор сдвига d (ряды цифр ниже/выше названий),
 *  стоимость пары — расстояние от y ряда до [top+d, bottom+d] в межстрочиях; пропуск — 1. */
function _bqoAlign_(A, B, L, prior, w) {
  var GAP = 1.0, best = null; w = w === undefined ? 0.8 : w;
  // пропуск ряда цифр: полный ряд (цена × кол-во = сумма) пропускать дорого, одиночное число (обрывок, «0», «1») — дёшево;
  // иначе при ровных строках «мусорные» ряды склоняют выбор к сдвигу на строку (бланки с Диска, слабый OCR)
  var gapB = B.map(function (b) { if (!b.c) return GAP; var n = ['price', 'qty', 'sum'].filter(function (k) { return b.c[k] !== undefined; }).length; return b.arith === 'ok' ? GAP * 1.2 : n >= 2 ? GAP : n === 1 && b.c.yield === undefined ? GAP * 0.4 : GAP * 0.7; });
  var cost = function (a, b, d) { var lo = a.top + d, hi = a.bottom + d, y = b.y, dist = y < lo ? lo - y : y > hi ? y - hi : 0; var c = dist / L; return c > 1.8 ? Infinity : c * c * 0.6; };
  for (var d = -1.5 * L; d <= 2.5 * L + 0.01; d += L / 8) {
    var n = A.length, m = B.length, D = [], P = [];
    for (var i = 0; i <= n; i++) { D.push([]); P.push([]); for (var j = 0; j <= m; j++) { D[i].push(Infinity); P[i].push(0); } }
    D[0][0] = 0;
    for (i = 0; i <= n; i++) for (j = 0; j <= m; j++) {
      var v = D[i][j]; if (v === Infinity) continue;
      if (i < n && v + GAP < D[i + 1][j]) { D[i + 1][j] = v + GAP; P[i + 1][j] = 1; }
      if (j < m && v + gapB[j] < D[i][j + 1]) { D[i][j + 1] = v + gapB[j]; P[i][j + 1] = 2; }
      if (i < n && j < m) { var c = cost(A[i], B[j], d); if (v + c < D[i + 1][j + 1]) { D[i + 1][j + 1] = v + c; P[i + 1][j + 1] = 3; } }
    }
    var total = D[n][m] + (prior != null ? Math.abs(d - prior) / L * w : 0);
    if (!best || total < best.total - 1e-9) {
      var pairs = [], ii = n, jj = m;
      while (ii > 0 || jj > 0) { var p = P[ii][jj]; if (p === 3) { pairs.push([ii - 1, jj - 1]); ii--; jj--; } else if (p === 1) { pairs.push([ii - 1, -1]); ii--; } else { pairs.push([-1, jj - 1]); jj--; } }
      best = { total: total, d: d, pairs: pairs.reverse() };
    }
  }
  return best;
}

/* ---------- шапка бланка (meta) ---------- */
var BQO_MONTHS_ = ['январ', 'феврал', 'март', 'апрел', 'ма[йя]', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
function _bqoMeta_(ws, hdr, h, L) {
  var top = hdr.nameRy - h * 0.6, xs = hdr.X.price - (hdr.X.yield - hdr.X.price) * 0.9;
  var area = ws.filter(function (w) { return w.ry < top && !/оренбург|влксм|^тел\.?$|^\d{2}-\d{2}-\d{2}$|^ул\.?,?$|^лет$/i.test(w.t); });
  var lab = _bqoLines_(area.filter(function (w) { return w.rx < xs; }), h), val = _bqoLines_(area.filter(function (w) { return w.rx >= xs; }), h);
  var labels = [];
  lab.forEach(function (l) { var k = _bqoKey_(l.ws[0].t); BQO_.META.forEach(function (m) { if (m[1].test(k) && !labels.some(function (x) { return x.key === m[0]; })) labels.push({ key: m[0], top: l.ry, bottom: l.ry, text: l.text }); }); });
  var meta = { format: '', date: '', time: '', place: '', guests: '', contact: '', payment: '', comment: '' }, src = {};
  if (!labels.length || !val.length) return { meta: meta, how: 'не найдена' };
  labels.sort(function (a, b) { return a.top - b.top; });
  var lowest = labels[labels.length - 1].top;
  val = val.filter(function (v) { return v.ry > labels[0].top - L * 0.8 && v.ry < lowest + L * 3.2; });
  var used = {};
  // сначала — по содержанию (дата, время, гости), остальное — по порядку
  var re = { date: new RegExp('\\d{1,2}\\s*(' + BQO_MONTHS_.join('|') + ')|\\d{1,2}[.\\/]\\d{1,2}([.\\/]\\d{2,4})?', 'i'), time: /(^|[^\d])\d{1,2}[:.]\d{2}(?!\d)/, guests: /\d+\s*(гост|персон|чел|взросл|детей|ребен)/i };
  ['date', 'guests', 'time'].forEach(function (k) {
    for (var i = 0; i < val.length; i++) if (!used[i] && re[k].test(val[i].text) && !(k === 'time' && re.date.test(val[i].text) && !re.time.test(val[i].text))) { meta[k] = val[i].text; used[i] = k; src[k] = 'по содержанию'; break; }
  });
  var restL = labels.filter(function (l) { return !meta[l.key]; }), restV = [];
  val.forEach(function (v, i) { if (!used[i]) restV.push({ y: v.ry, v: v, i: i }); });
  var al = _bqoAlign_(restL, restV, L, 0);
  al.pairs.forEach(function (p) { if (p[0] >= 0 && p[1] >= 0) { meta[restL[p[0]].key] = restV[p[1]].v.text; src[restL[p[0]].key] = 'по порядку'; } });
  return { meta: meta, how: 'шапка бланка', src: src };
}

/* ---------- вид строки ---------- */
function _bqoKind_(name) {
  var n = String(name || '').trim();
  for (var i = 0; i < BQO_.KIND.length; i++) if (BQO_.KIND[i][1].test(n)) return BQO_.KIND[i][0];
  return 'dish';
}

/** Главное: аннотация Vision → таблица бланка. {ok, rows[], meta, totals, completeness, diag}. */
function _bqTable_(ann, opts) {
  opts = opts || {};
  var ws = _bqoWords_(ann);
  if (ws.length < 8) return { ok: false, reason: 'мало слов с координатами (' + ws.length + ')', rows: [], diag: { words: ws.length } };
  var pages = {}; ws.forEach(function (w) { (pages[w.page] = pages[w.page] || []).push(w); });
  var all = { ok: false, rows: [], notes: [], meta: null, totals: [], diag: { words: ws.length, pages: [], orient: ws.orient || 0 } }, prevHdr = null;
  Object.keys(pages).sort(function (a, b) { return a - b; }).forEach(function (pg) {
    var r = _bqoPage_(pages[pg], +pg, ann, prevHdr);
    all.diag.pages.push(r.diag);
    if (!r.ok) return;
    all.ok = true; prevHdr = r.hdr;
    if (!all.meta && r.meta) all.meta = r.meta;
    all.rows = all.rows.concat(r.rows); all.totals = all.totals.concat(r.totals);
  });
  if (!all.ok) { all.reason = all.diag.pages.map(function (d) { return d.reason; }).filter(Boolean).join('; ') || 'таблица не найдена'; return all; }
  var n = 0; all.rows.forEach(function (r) { r.row_id = 'p' + r.page + '-r' + ('0' + (++n)).slice(-2); });
  all.completeness = _bqCompleteness_(all.rows, all.totals);
  all.warnings = all.diag.pages.filter(function (d) { return d.lowNumbers; }).map(function (d) { return 'Лист ' + d.page + ': ' + d.lowNumbers + ' — фото, вероятно, нечёткое или с бликом: переснимите бланк ровно, ближе, без тени'; });
  if (ws.orient) all.warnings.push('Фото снято ' + (ws.orient === 180 ? 'вверх ногами' : 'боком') + ' — координаты повернуты на ' + ws.orient + '°, таблица собрана');
  return all;
}

/** Лист: если найден «веер» наклона, лист собирается двумя способами (веер и один наклон) и берётся сборка с лучшей
 *  самопроверкой: сумма строк = итог бланка, затем больше строк, где цена × кол-во = сумма и есть название. */
function _bqoPage_(ws, page, ann, prevHdr) {
  var sf = _bqoSkewField_(ws);
  if (!sf.k) return _bqoPage1_(ws, page, ann, prevHdr, sf.s0, sf);
  var q = function (r) { if (!r.ok) return -1e9; var sum = 0, ok = 0, nn = 0; r.rows.forEach(function (o) { if (typeof o.sum === 'number') sum += o.sum; if (o.name !== null && o.price && o.qty && o.sum && Math.abs(o.price * o.qty - o.sum) <= Math.max(1, o.sum * 0.005)) ok++; if (o.name === null) nn++; });
    var hit = r.totals.some(function (t) { return t.v > 0 && Math.abs(t.v - sum) <= 1; }); return (hit ? 1000 : 0) + ok * 3 - nn; };
  var a = _bqoPage1_(ws, page, ann, prevHdr, sf, sf), qa = q(a), b = _bqoPage1_(ws, page, ann, prevHdr, sf.s0, sf), qb = q(b);
  var r = qa >= qb ? a : b; r.diag.fanUsed = qa >= qb; r.diag.fanScore = qa + ' / ' + qb;
  return r;
}
function _bqoPage1_(ws, page, ann, prevHdr, rot, sf) {
  var h = _bqoMed_(ws.map(function (w) { return w.h; })) || 12, diag = { page: page, words: ws.length };
  _bqoRotate_(ws, rot); diag.skew = Math.round(sf.s0 * 1000) / 1000; if (typeof rot === 'object') diag.fan = Math.round(sf.k * 1e6) / 1e6;
  var width = Math.max.apply(null, ws.map(function (w) { return w.rx1; }));
  var hdr = _bqoHeader_(ws, h);
  if (!hdr && prevHdr && prevHdr.width && Math.abs(prevHdr.width - width) / width < 0.15) hdr = { X: prevHdr.X, ry: -1e9, nameRy: -1e9, codeX1: prevHdr.codeX1, how: 'колонки предыдущего листа' };
  if (!hdr) {
    hdr = _bqoColumnsByNumbers_(ws, h, width);
    if (hdr) {   // без шапки: верх таблицы — первый ряд из 2+ чисел в колонках минус 2,5 строки
      var Xn = hdr.X, cwn = Math.max(8, (Xn.sum - Xn.price) / 3), firstY = Infinity;
      _bqoLines_(ws.filter(function (w) { return _bqoIsNum_(w.t) && w.rx > Xn.price - cwn && w.rx < Xn.sum + cwn; }), h).forEach(function (l) { if (l.ws.length >= 2 && l.ry < firstY) firstY = l.ry; });
      if (firstY < Infinity) { hdr.ry = firstY - h * 3.2; hdr.nameRy = firstY - h * 3.6; }
    }
  }
  if (!hdr) { diag.reason = 'лист ' + page + ': не найдены колонки «цена / Кол-во / Сумма»'; return { ok: false, diag: diag }; }
  hdr.width = width; diag.columns = hdr.how;
  var X = hdr.X, cw = Math.max(8, (X.sum - X.price) / 3);
  _bqoDrift_(ws, X, cw, h, hdr.ry);
  var B = X.price - cw * 0.55, sumR = X.sum + cw * 0.75;
  // межстрочие — по строкам названий
  var body = ws.filter(function (w) { return w.ry > hdr.nameRy + h * 0.5; });
  var isNameW = function (w) { return (w.rx1 <= B + h * 0.3 || (!_bqoIsNum_(w.t) && w.rx < B + cw * 0.5)) && (hdr.codeX1 == null || w.rx > hdr.codeX1 - 2); };
  // цены в колонке выровнены по левому краю: число, начинающееся левее этого края, — часть названия («…расчитан на 10»)
  var pl = body.filter(function (w) { return _bqoIsNum_(w.t) && Math.abs(w.rx - X.price) < cw * 0.45; }).map(function (w) { return w.rx0; }).sort(function (a, b) { return a - b; });
  var priceLeft = pl.length >= 3 ? pl[Math.floor(pl.length * 0.2)] : null;
  var isNameW0 = isNameW;
  isNameW = function (w) { return isNameW0(w) || (priceLeft !== null && _bqoIsNum_(w.t) && w.rx0 < priceLeft - h * 0.7 && w.rx < X.price); };
  var nameLines = _bqoLines_(body.filter(isNameW), h);
  var gaps = []; for (var i = 1; i < nameLines.length; i++) { var g = nameLines[i].ry - nameLines[i - 1].ry; if (g > h * 0.6 && g < h * 3) gaps.push(g); }
  var L = _bqoMed_(gaps) || h * 1.45; diag.lineH = Math.round(L * 10) / 10;
  // низ таблицы: строки подвала «Всего / Налог (НДС) / Сервис (выездное обслуживание) / Скидка / Итого» (рукописный шрифт OCR читает хуже —
  // берётся первое узнанное слово, положение «Всего» выводится по его номеру строки подвала, строки подвала выше ~2 межстрочий)
  // первое слово строки: «Всего», «Налог», «Сервис», «Скидка», «Итого»; в любом месте строки — только «НДС», «ВЫЕЗДНОЕ», «применяется»
  var FW = [[/^всего$/, 0, 1], [/^налог/, 1, 1], [/^ндс$/, 1, 0], [/^сервис/, 2, 1], [/^выездное$/, 2, 0], [/^скидк/, 3, 1], [/^применяется$/, 3, 0], [/^итого/, 4, 1]], foot = null;
  _bqoLines_(body.filter(function (w) { return w.rx < B + cw * 0.5; }), h).forEach(function (l) {
    l.ws.forEach(function (w, wi) {
      var k = _bqoKey_(w.t);
      // опора — самая верхняя узнанная строка подвала («Всего» точнее «Налога», «Налог» точнее «Итого»)
      for (var f = 0; f < FW.length; f++) if (FW[f][0].test(k) && (!FW[f][2] || wi === 0) && (!foot || FW[f][1] < foot.n || (FW[f][1] === foot.n && w.ry < foot.w.ry))) foot = { vsego: w.ry - FW[f][1] * L * 1.8, w: w, k: k, n: FW[f][1] };
    });
  });
  var cut = Infinity, nameLim = Infinity;
  if (foot) { cut = foot.vsego + L * 0.55; nameLim = foot.vsego - L * 0.6; }
  diag.footer = foot ? foot.w.t : '';
  nameLines = nameLines.filter(function (l) { return l.ry < nameLim && !BQO_.FOOT.test(_bqoKey_(l.ws[0].t)) &&
    !/оренбург|влксм|формат\s+меропр|дата\s+провед|время\s+провед|место\s+провед|количество\s+персон|контактное\s+лицо|произведена\s+оплата|пожелания\s+к|^наименование$|^код$/i.test(l.text); });
  // числа таблицы и пометки справа
  var numW = body.filter(function (w) { return !isNameW(w) && _bqoIsNum_(w.t) && w.rx >= B - cw * 0.2 && w.rx <= sumR; });
  var rows = _bqoNumRows_(numW, X, h, hdr.ry + h * 0.5, cut, L);
  // итог справа от шапки и в строках «Всего/Итого»
  var totals = [], hdrTot = [];
  ws.forEach(function (w) {
    var v = _bqoNum_(w.t); if (v === null || v < 100) return;
    if (w.rx > sumR && Math.abs(w.ry - hdr.ry) < L * 2.5) { totals.push({ v: v, where: 'число справа от шапки' }); hdrTot.push(v); }
    else if (cut !== Infinity && w.ry >= cut - 1 && w.ry < cut + L * 7 && Math.abs(w.rx - X.sum) < cw && v > 0) totals.push({ v: v, where: 'строка «Всего/Итого»' });
  });
  // итоговая сумма бланка, попавшая в зону (число в «Сумме» без цены и кол-ва, равное сумме остальных) — не строка.
  // Бланки с Диска: на изогнутом листе число «Всего» стоит выше своей строки и приклеивается к последнему ряду
  // (иногда со случайной «1» в кол-ве) — ряд без цены в конце таблицы с суммой, равной сумме остальных или итогу
  // справа от шапки, — это итог, а не блюдо.
  var others = function (ex) { return rows.reduce(function (a, r) { return a + (r !== ex && typeof r.c.sum === 'number' ? r.c.sum : 0); }, 0); };
  rows = rows.filter(function (r, i) {
    var tail = i >= rows.length - 2, only = r.c.sum !== undefined && r.c.price === undefined && (r.c.qty === undefined || (tail && r.c.qty <= 1));
    if (only && r.c.sum > 0 && (Math.abs(others(r) - r.c.sum) <= Math.max(1, tail ? r.c.sum * 0.002 : 0) || (tail && hdrTot.indexOf(r.c.sum) >= 0 && r.c.sum >= others(r) * 0.5))) { totals.push({ v: r.c.sum, where: 'сумма в конце таблицы' }); return false; }
    return true;
  });
  rows = rows.filter(function (r) { return !(r.c.price === 0 && r.c.qty === undefined && r.c.sum === undefined); });   // «0» от руки в строке «Всего»
  // последний ряд с суммой не меньше всех остальных вместе и без сходящейся арифметики — число «Всего», прочитанное с ошибкой
  // и приклеенное к строке: сумма строки не принимается (предупреждение), чтобы итог не удвоился
  rows.slice(-2).forEach(function (r) {
    var o = others(r), p = r.c.price, q = r.c.qty;
    if (typeof r.c.sum === 'number' && o > 0 && r.c.sum >= o * 0.8 && !(p && q && Math.abs(p * q - r.c.sum) <= Math.max(1, r.c.sum * 0.005))) { r.totalLike = r.c.sum; delete r.c.sum; r.arith = 'part'; }
  });
  var items = _bqoItems_(nameLines);
  // после выпрямления цифры стоят на строке своего названия (у высоких ячеек — у нижней строки): сдвиг 0 — по умолчанию
  var sparse = rows.length < items.length * 0.6;   // цифры прочитаны у малой части строк — сдвиг не подбирается, только ближайшая строка
  var al = _bqoAlign_(items, rows, L, 0, sparse ? 4 : 1.2);
  if (sparse && items.length >= 4) diag.lowNumbers = 'цифры прочитаны только у ' + rows.length + ' из ' + items.length + ' строк';
  diag.shift = Math.round(al.d / L * 100) / 100; diag.items = items.length; diag.numRows = rows.length;
  // пометки справа от «Суммы»
  var noteLines = _bqoLines_(body.filter(function (w) { return w.rx0 > sumR - cw * 0.15 && w.ry < (cut === Infinity ? Infinity : cut + L) && !(Math.abs(w.ry - hdr.ry) < L * 2.5 && _bqoNum_(w.t) !== null && _bqoNum_(w.t) >= 100); }), h)
    .filter(function (l) { return /[а-яa-z]/i.test(l.text) || /^\d+([.,]\d+)?\s*\S/.test(l.text); });
  var out = [];
  al.pairs.forEach(function (p) {
    var it = p[0] >= 0 ? items[p[0]] : null, r = p[1] >= 0 ? rows[p[1]] : null, c = r ? r.c : {};
    out.push({ page: page, name: it ? it.name : null, name_lines: it ? it.lines.map(function (l) { return l.text; }) : [], price: c.price === undefined ? null : c.price, yield: c.yield === undefined ? '' : String(c.yield),
      qty: c.qty === undefined ? null : c.qty, sum: c.sum === undefined ? null : c.sum, note: '', arith: r ? r.arith : 'none', y: r ? r.y : it.bottom + al.d, yTop: it ? it.top : r.y,
      kind: it ? _bqoKind_(it.name) : 'dish', source: 'таблица', warnings: r && r.totalLike ? ['Число ' + r.totalLike + ' в конце таблицы похоже на итог бланка, а не на сумму строки — сумма строки не принята, сверьте с бланком'] : [] });
  });
  noteLines.forEach(function (nl) {
    var best = null, bd = 1e9;
    out.forEach(function (o) { var d = Math.abs(o.y - nl.ry); if (d < bd) { bd = d; best = o; } });
    if (best && bd <= L * 1.1) best.note = (best.note ? best.note + ' ' : '') + nl.text;
  });
  out.forEach(function (o) { _bqCheckRow_(o); delete o.y; delete o.yTop; });
  var meta = _bqoMeta_(ws, hdr, h, L);
  diag.meta = meta.how;
  return { ok: items.length > 0 || rows.length > 0, rows: out, totals: totals, meta: meta.meta, hdr: hdr, diag: diag };
}

/** Проверка строки: арифметика, пропуски. Ничего не исправляет — только статус и предупреждения. */
/** Пометка строки говорит о дробной порции k («0,5 поции», «1/2», «половина порции», «1,5 порц»). */
function _bqFracNote_(o, k) {
  var t = String(o.note || '').toLowerCase().replace(/ё/g, 'е');
  if (!t) return false;
  if (k === 0.5 && /половин|пол\s*-?\s*порц|1\s*\/\s*2/.test(t)) return true;
  var nums = (t.match(/\d*[.,]\d+|\d+\s*\/\s*\d+|\d+/g) || []).map(function (x) { x = x.replace(/\s/g, ''); if (x.indexOf('/') > 0) { var a = x.split('/'); return +a[0] / +a[1]; } return parseFloat(x.replace(',', '.')); });
  return nums.some(function (x) { return Math.abs(x - k) < 1e-9; }) && (k < 1 || /по[рц]|порц|пц/.test(t));
}
function _bqCheckRow_(o) {
  var w = o.warnings = o.warnings || [];
  var p = Number(o.price), q = Number(o.qty), s = Number(o.sum);
  // Дробная порция (заказчик: «0,5 — половина порции от исходной ТТК, считать точно»): в колонке «Кол-во» часто стоит 1,
  // а сумма — за половину и пометка «0,5 порции». Если пометка и сумма говорят одно и то же — кол-во = доля порции.
  if (o.price && o.qty && o.sum && Math.abs(p * q - s) > Math.max(1, s * 0.005)) {
    var kf = Math.round(s / p * 4) / 4;
    if (kf > 0 && Math.abs(s / p - kf) < 0.002 && Math.abs(p * kf - s) <= Math.max(1, s * 0.005) && _bqFracNote_(o, kf)) {
      o.qty_printed = q; o.qty = q = kf; o.qty_by_sum = null;
      (o.info = o.info || []).push('Кол-во ' + String(kf).replace('.', ',') + ' порции — по пометке «' + o.note + '» и сумме: ' + p + ' × ' + String(kf).replace('.', ',') + ' = ' + s + ' (в колонке «Кол-во» на бланке — ' + o.qty_printed + ')');
    }
  }
  if (o.name === null) w.push('Цифры без названия — название не прочитано');
  if (o.name !== null && o.price === null && o.qty === null && o.sum === null && o.kind !== 'note') w.push('Нет цены, количества и суммы');
  if (o.qty === null && o.kind !== 'note') w.push('Количество не прочитано');
  if (o.kind !== 'note' && o.price === null && o.sum !== null) w.push('Цена не прочитана' + (o.qty ? ' (по сумме и кол-ву: ' + String(Math.round(o.sum / o.qty * 100) / 100).replace('.', ',') + ')' : ''));
  if (o.kind !== 'note' && o.sum === null && o.price !== null) w.push('Сумма не прочитана');
  if (o.price && o.qty && o.sum) {
    if (Math.abs(p * q - s) > Math.max(1, s * 0.005)) {
      var k = Math.round(s / p * 100) / 100;
      w.push('Цена × кол-во ≠ сумма: ' + p + ' × ' + q + ' = ' + Math.round(p * q) + ', на бланке ' + s + (k > 0 ? ' (по сумме выходит ' + String(k).replace('.', ',') + ')' : ''));
      o.qty_by_sum = k > 0 ? k : null;
    }
  } else if (o.price && o.sum && o.qty === null) { o.qty_by_sum = Math.round(s / p * 100) / 100; }
  o.status = o.kind === 'note' && !o.price ? 'служебная' : !w.length ? 'распознана' : o.name === null || o.qty === null ? 'неразборчивая' : 'требует проверки';
  return o;
}

/** Полнота: сумма строк против итога бланка. Подтверждается только равенством — иначе «не подтверждена». */
function _bqCompleteness_(rows, totals) {
  var sum = rows.reduce(function (a, r) { return a + (typeof r.sum === 'number' ? r.sum : 0); }, 0);
  var withNum = rows.filter(function (r) { return typeof r.sum === 'number'; }).length;
  var cands = (totals || []).map(function (t) { return t.v; }).filter(function (v, i, a) { return v > 0 && a.indexOf(v) === i; });
  var hit = cands.filter(function (v) { return Math.abs(v - sum) <= 1; })[0];
  var bad = rows.filter(function (r) { return r.status !== 'распознана' && r.status !== 'служебная'; }).length;
  if (hit) return { status: 'подтверждена', rowsSum: sum, total: hit, diff: 0, rows: rows.length, needReview: bad,
    text: 'Полнота подтверждена: сумма по ' + withNum + ' строкам = ' + _bqMoney_(sum) + ' — совпадает с итогом бланка' };
  var tot = cands.length ? Math.max.apply(null, cands) : null;
  return { status: 'не подтверждена', rowsSum: sum, total: tot, diff: tot === null ? null : sum - tot, rows: rows.length, needReview: bad,
    text: tot === null ? 'Полнота не подтверждена: итог на бланке не найден — сверьте число строк с бланком' :
      'Полнота не подтверждена: сумма строк ' + _bqMoney_(sum) + ', итог бланка ' + _bqMoney_(tot) + ' (разница ' + _bqMoney_(Math.abs(sum - tot)) + ') — какая-то строка не прочитана или прочитана неверно' };
}
function _bqMoney_(v) { return String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

/* =====================================================================================
 * YandexGPT. Два режима.
 *  «уточнение» — таблица по координатам собрана: модель получает строки с номерами (p1-r01…) и ТОЛЬКО
 *     исправляет опечатки OCR в названиях, определяет вид строки и разбирает шапку. Строки не добавляет и
 *     не удаляет; числа таблицы главнее (модель может лишь дополнить неполную строку — с пометкой).
 *  «по тексту» — таблицы нет (нет координат/колонок): модель разбирает пронумерованные строки текста (L001…)
 *     по промпту заказчика; длинный текст — частями с шапкой колонок, склейка по номерам строк.
 * Ответ проверяется: JSON, типы, номера строк; при сбое — до 2 повторов; молча на «простой разбор» не уходим.
 * ===================================================================================== */
var BQG_ = { URL: 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion', CHUNK_ROWS: 40, CHUNK_LINES: 70, OVERLAP: 4, RETRIES: 2, MAX_TOKENS: 7500 };

/** Промпт заказчика (банкетные заказы MonChef) с дополнениями под бланки ресторана. */
function _bqgPromptText_() {
  return 'Ты — модуль интеллектуального распознавания банкетных заказов ресторанной системы MonChef. ' +
    'Тебе передан текст OCR одного листа бланка: пронумерованные строки «L001 | текст», собранные по координатам слов слева направо. ' +
    'Твоя задача — извлечь ВСЕ позиции заказа без потерь. Колонки таблицы бланка: Код | Наименование | цена | выход | Кол-во | Сумма, справа от суммы — пометки (фуршет, детям, команда, 1-е/2-е гор, через 1, 0,5 порции). ' +
    'ВАЖНО: фото бланка обычно снято с наклоном, строки собраны по высоте и цифры строки (цена, выход, кол-во, сумма) могут оказаться на соседней строке текста — выше или ниже своего названия. ' +
    'Поэтому сопоставляй названия и ряды цифр ПО ПОРЯДКУ: первый ряд цифр — первому блюду, второй — второму; проверяй себя арифметикой цена × кол-во = сумма. ' +
    'Правила: ' +
    '1) Название может переноситься на 2–4 строки (продолжение начинается со строчной буквы, «(», «,») — склей в одно название, ремарки в скобках («требуется гарнир», «заказ от 2х тарелок») оставь. ' +
    '2) Не придумывай значения: если число не видно — null. Не используй правила «наименьшее число — количество», «наибольшее — сумма». ' +
    '3) Выход храни как на бланке («90/10», «100\\20\\20», «1литр», «200мл», «1шт»). Кол-во бывает дробным («5,3») — верни 5.3. ' +
    '4) Пометку справа от суммы верни в note, в название не включай. ' +
    '5) kind: dish — блюдо; drink — напиток (вода, морс, сок); service — услуга, продление работы, обслуживание; set — набор/сет/комплекс/фуд-бар; note — «Обратите внимание» и т.п. Услуги и примечания тоже верни отдельными позициями. ' +
    '6) Не превращай в позиции: адрес и телефон ресторана, шапку бланка, заголовки колонок, «Всего», «Налог/НДС», «Сервис», «Скидка», «Итого», число-итог справа вверху. ' +
    '7) Шапку бланка (Формат, Дата, Время, Место, Количество персон, Контактное лицо, Оплата, Пожелания) верни в meta как написано; из-за наклона значение тоже может оказаться на соседней строке. ' +
    '8) lines — номера строк L…, из которых взята позиция (название и цифры). ' +
    '9) Если цена × кол-во ≠ сумма или строка нечитаема — всё равно верни позицию и опиши проблему в warnings. ' +
    'Перед ответом проверь себя: каждое название с бланка есть в items ровно один раз; цифры не перепутаны между соседними строками. ' +
    'Приоритеты: не потерять блюдо > не перепутать колонки > не придумывать > валидный JSON. ' +
    'Ответ — ТОЛЬКО JSON без пояснений и без ```: ' +
    '{"meta":{"date":null,"format":null,"time":null,"place":null,"guests":null,"contact":null,"payment":null,"comment":null},' +
    '"items":[{"lines":["L010","L011"],"name":"","price":null,"yield":null,"qty":null,"sum":null,"note":null,"kind":"dish"}],"warnings":[]}';
}
function _bqgPromptRows_() {
  return 'Ты — модуль проверки распознанного банкетного бланка ресторанной системы MonChef. ' +
    'Таблица бланка уже собрана программой по координатам: каждая строка «id | название | цена | выход | кол-во | сумма | пометка». ' +
    'Сопоставление цифр с названиями уже выполнено и проверено арифметикой — НЕ переставляй цифры между строками. ' +
    'Твоя задача по КАЖДОЙ строке: ' +
    '1) name — исправь явные ошибки распознавания букв (латиница вместо кириллицы, «0» вместо «о», склеенные/разорванные слова), сохрани смысл и ремарки в скобках; ничего не добавляй от себя. Если название пустое — null. ' +
    '2) kind: dish | drink | service | set | note (как: блюдо; напиток — вода, морс, сок; услуга/продление работы; набор, сет, комплекс, фуд-бар; примечание «Обратите внимание»). ' +
    '3) Если в строке не хватает числа, но его однозначно даёт арифметика цена × кол-во = сумма — верни его и опиши в warnings; иначе null. Не меняй числа, которые уже стоят. ' +
    '4) Шапку бланка разбери в meta: date, format, time, place, guests, contact, payment, comment — как написано. ' +
    'Верни каждую строку ровно один раз с её id; новых строк не добавляй, строки не удаляй и не объединяй. ' +
    'Ответ — ТОЛЬКО JSON без ```: {"meta":{"date":null,"format":null,"time":null,"place":null,"guests":null,"contact":null,"payment":null,"comment":null},' +
    '"items":[{"id":"p1-r01","name":"","kind":"dish","price":null,"qty":null,"sum":null,"warnings":[]}],"warnings":[]}';
}

/** Один вызов YandexGPT с повторами. Возвращает {obj, raw, calls, error}. Ключ в журнал не пишется. */
function _bqgCall_(sys, user, key, folder, maxTokens, check) {
  var model = String(PropertiesService.getScriptProperties().getProperty('BANQUET_GPT_MODEL') || 'yandexgpt/latest');
  var calls = 0, lastErr = '', raw = '';
  for (var a = 0; a <= BQG_.RETRIES; a++) {
    if (a) Utilities.sleep(a * 1500);
    calls++;
    try {
      var body = { modelUri: 'gpt://' + folder + '/' + model, completionOptions: { stream: false, temperature: 0, maxTokens: String(Math.min(BQG_.MAX_TOKENS, maxTokens)) },
        messages: [{ role: 'system', text: sys + (a ? ' ПРЕДЫДУЩИЙ ОТВЕТ НЕ ПРОШЁЛ ПРОВЕРКУ (' + lastErr + '). Верни строго JSON по схеме.' : '') }, { role: 'user', text: user }] };
      var r = UrlFetchApp.fetch(BQG_.URL, { method: 'post', contentType: 'application/json', headers: { Authorization: 'Api-Key ' + key, 'x-folder-id': folder }, payload: JSON.stringify(body), muteHttpExceptions: true });
      var code = r.getResponseCode();
      if (code !== 200) { lastErr = 'HTTP ' + code; if (code === 400 || code === 401 || code === 403) break; continue; }
      var j = JSON.parse(r.getContentText()), alt = j.result && j.result.alternatives && j.result.alternatives[0];
      raw = alt && alt.message ? String(alt.message.text || '') : '';
      if (alt && /TRUNCATED|LENGTH/i.test(String(alt.status || ''))) { lastErr = 'ответ обрезан по длине'; maxTokens = Math.min(BQG_.MAX_TOKENS, maxTokens * 2); continue; }
      var obj = _bqgJson_(raw);
      if (!obj) { lastErr = 'ответ не JSON'; continue; }
      var bad = check ? check(obj) : '';
      if (bad) { lastErr = bad; continue; }
      return { obj: obj, raw: raw, calls: calls };
    } catch (e) { lastErr = String(e && e.message || e).slice(0, 120); }
  }
  return { obj: null, raw: raw, calls: calls, error: lastErr || 'нет ответа' };
}
/** Текст ответа → объект: снять ```, взять первый целый {...}. */
function _bqgJson_(t) {
  t = String(t || '').replace(/```(?:json)?/gi, '').trim();
  var i = t.indexOf('{'); if (i < 0) return null;
  var depth = 0, inS = false, esc = false;
  for (var k = i; k < t.length; k++) {
    var ch = t.charAt(k);
    if (inS) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inS = false; continue; }
    if (ch === '"') inS = true; else if (ch === '{') depth++; else if (ch === '}') { depth--; if (!depth) { try { return JSON.parse(t.slice(i, k + 1)); } catch (e) { return null; } } }
  }
  return null;
}
function _bqgNum_(v) { if (v === null || v === undefined || v === '') return null; var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; }
function _bqgSim_(a, b) {
  var n = function (s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9]/g, ''); }, g = function (s) { var m = {}; for (var i = 0; i < s.length - 2; i++) m[s.substr(i, 3)] = (m[s.substr(i, 3)] || 0) + 1; return m; };
  a = n(a); b = n(b); if (!a || !b) return 0; if (a === b) return 1;
  var A = g(a), B = g(b), x = 0, na = 0, nb = 0; Object.keys(A).forEach(function (k) { na += A[k]; if (B[k]) x += Math.min(A[k], B[k]); }); Object.keys(B).forEach(function (k) { nb += B[k]; });
  return na + nb ? 2 * x / (na + nb) : 0;
}

/** Режим «уточнение»: строки таблицы → модель (частями по 40 строк) → слияние по id. Таблица меняется только проверяемо. */
function _bqgRefine_(tbl, key, folder) {
  var rows = tbl.rows, info = { calls: 0, chunks: 0, failed: 0, errors: [], meta: null, warnings: [] };
  var metaTxt = Object.keys(tbl.meta || {}).filter(function (k) { return tbl.meta[k]; }).map(function (k) { return k + ': ' + tbl.meta[k]; }).join('\n');
  for (var s = 0; s < rows.length; s += BQG_.CHUNK_ROWS) {
    var part = rows.slice(s, s + BQG_.CHUNK_ROWS), ids = {};
    part.forEach(function (r) { ids[r.row_id] = r; });
    var user = 'Шапка бланка (подпись: значение):\n' + (metaTxt || '(не прочитана)') + '\n\nСтроки' + (rows.length > BQG_.CHUNK_ROWS ? ' (часть ' + (s / BQG_.CHUNK_ROWS + 1) + ' из ' + Math.ceil(rows.length / BQG_.CHUNK_ROWS) + ')' : '') + ':\nid | название | цена | выход | кол-во | сумма | пометка\n' +
      part.map(function (r) { return [r.row_id, r.name === null ? '(нет названия)' : r.name, r.price === null ? '' : r.price, r.yield || '', r.qty === null ? '' : String(r.qty).replace('.', ','), r.sum === null ? '' : r.sum, r.note || ''].join(' | '); }).join('\n');
    var check = function (o) {
      if (!o || !Array.isArray(o.items)) return 'нет массива items';
      var seen = {}, unknown = 0;
      o.items.forEach(function (x) { if (!x || !ids[x.id]) unknown++; else seen[x.id] = 1; });
      var miss = Object.keys(ids).filter(function (k) { return !seen[k]; }).length;
      return miss > part.length * 0.2 ? 'не возвращены строки: ' + miss : '';
    };
    var r = _bqgCall_(_bqgPromptRows_(), user, key, folder, 300 + part.length * 70, check);
    info.calls += r.calls; info.chunks++;
    if (!r.obj) { info.failed++; info.errors.push(r.error); continue; }
    if (!info.meta && r.obj.meta) info.meta = r.obj.meta;
    (r.obj.warnings || []).forEach(function (w) { if (w) info.warnings.push(String(w).slice(0, 200)); });
    var seen = {};
    (r.obj.items || []).forEach(function (x) {
      var row = x && ids[x.id]; if (!row || seen[x.id]) return; seen[x.id] = 1;
      var w = row.warnings = row.warnings || [];
      // название: только правка того же текста (защита от перестановки названий между строками)
      if (x.name && row.name && x.name !== row.name) { if (_bqgSim_(x.name, row.name) >= 0.55) { row.name_ocr = row.name; row.name = String(x.name).trim(); } else w.push('Модель предложила другое название: «' + String(x.name).slice(0, 80) + '» — оставлено как на бланке'); }
      if (x.kind && /^(dish|drink|service|set|note)$/.test(x.kind)) row.kind = x.kind;
      // числа: дополнить пропуск, только если сходится арифметика
      var P = row.price !== null ? row.price : _bqgNum_(x.price), Q = row.qty !== null ? row.qty : _bqgNum_(x.qty), S = row.sum !== null ? row.sum : _bqgNum_(x.sum);
      if ((row.price === null || row.qty === null || row.sum === null) && P && Q && S && Math.abs(P * Q - S) <= Math.max(1, S * 0.005)) {
        ['price', 'qty', 'sum'].forEach(function (k) { if (row[k] === null) { row[k] = k === 'price' ? P : k === 'qty' ? Q : S; w.push('«' + ({ price: 'цена', qty: 'кол-во', sum: 'сумма' })[k] + '» дополнена по арифметике (модель) — проверьте'); } });
        row.source = 'таблица + модель';
      }
      (x.warnings || []).forEach(function (m) { if (m) w.push('Модель: ' + String(m).slice(0, 160)); });
    });
    Object.keys(ids).forEach(function (k) { if (!seen[k]) (ids[k].warnings = ids[k].warnings || []).push('Модель не вернула эту строку — оставлено как в таблице'); });
  }
  rows.forEach(function (r) { r.warnings = (r.warnings || []).filter(function (w, i, a) { return a.indexOf(w) === i; }); var keep = r.warnings.slice(); r.warnings = []; _bqCheckRow_(r); keep.forEach(function (w) { if (r.warnings.indexOf(w) < 0) r.warnings.push(w); }); if (r.warnings.length && r.status === 'распознана') r.status = 'требует проверки'; });
  return info;
}

/** Строки текста по координатам (с наклоном) с номерами L001… — вход для режима «по тексту» и для журнала. */
function _bqTextLines_(ann) {
  var ws = _bqoWords_(ann); if (!ws.length) return String((ann && ann.fullText) || '').split(/\n+/).filter(Boolean).map(function (t, i) { return { id: 'L' + ('00' + (i + 1)).slice(-3), text: t, page: 1 }; });
  var h = _bqoMed_(ws.map(function (w) { return w.h; })) || 12, out = [];
  var pages = {}; ws.forEach(function (w) { (pages[w.page] = pages[w.page] || []).push(w); });
  Object.keys(pages).sort(function (a, b) { return a - b; }).forEach(function (pg) {
    var p = pages[pg], sf = _bqoSkewField_(p); _bqoRotate_(p, sf.k ? sf : sf.s0);
    _bqoLines_(p, h).forEach(function (l) { out.push({ id: 'L' + ('00' + (out.length + 1)).slice(-3), text: l.text, page: +pg }); });
  });
  return out;
}

/** Режим «по тексту»: строки L… частями (с перекрытием и шапкой колонок) → модель → склейка по номерам строк. */
function _bqgFull_(lines, key, folder) {
  var info = { calls: 0, chunks: 0, failed: 0, errors: [], meta: null, warnings: [] }, items = [], taken = {};
  var hdr = lines.filter(function (l) { return /цена/i.test(l.text) && /сумм/i.test(l.text); })[0];
  for (var s = 0; s < lines.length; s += BQG_.CHUNK_LINES - BQG_.OVERLAP) {
    var part = lines.slice(s, s + BQG_.CHUNK_LINES); if (!part.length) break;
    var user = (s > 0 && hdr ? 'Колонки бланка: ' + hdr.text + '\n(часть бланка, продолжение)\n' : '') + part.map(function (l) { return l.id + ' | ' + l.text; }).join('\n');
    var r = _bqgCall_(_bqgPromptText_(), user, key, folder, 400 + part.length * 60, function (o) { return o && Array.isArray(o.items) ? '' : 'нет массива items'; });
    info.calls += r.calls; info.chunks++;
    if (!r.obj) { info.failed++; info.errors.push(r.error); if (s + BQG_.CHUNK_LINES >= lines.length) break; continue; }
    if (!info.meta && r.obj.meta) info.meta = r.obj.meta;
    (r.obj.warnings || []).forEach(function (w) { if (w) info.warnings.push(String(w).slice(0, 200)); });
    (r.obj.items || []).forEach(function (x) {
      if (!x || !x.name) return;
      var ls = (Array.isArray(x.lines) ? x.lines : []).map(String).filter(function (id) { return /^L\d+$/.test(id); });
      // строка из зоны перекрытия, уже взятая предыдущей частью, — та же позиция (склейка по номеру строки, не по названию)
      if (ls.length && ls.every(function (id) { return taken[id]; })) return;
      ls.forEach(function (id) { taken[id] = 1; });
      items.push({ page: 1, name: String(x.name).trim(), name_lines: [], price: _bqgNum_(x.price), yield: x.yield ? String(x.yield) : '', qty: _bqgNum_(x.qty), sum: _bqgNum_(x.sum), note: x.note ? String(x.note) : '',
        kind: /^(dish|drink|service|set|note)$/.test(x.kind) ? x.kind : _bqoKind_(x.name), source: 'модель по тексту', lines: ls });
    });
    if (s + BQG_.CHUNK_LINES >= lines.length) break;
  }
  return { info: info, items: items };
}

/* =====================================================================================
 * Сборка результата: таблица → YandexGPT → запасные пути. Каждая строка — с номером, статусом и причиной;
 * режим и сбои модели видны человеку (без «молчаливой» подмены простым разбором).
 * ===================================================================================== */
function _bqRecognize_(vis, opts) {
  opts = opts || {};
  var t0 = Date.now(), warnings = [], mode = '', gpt = { calls: 0, used: false, error: '' }, items = [], meta = {};
  var ann = vis.ann || {}, tbl = _bqTable_(ann);
  var smart = opts.mode !== 'simple' && !!(vis.key && vis.folder);
  if (tbl.ok) {
    items = tbl.rows; meta = tbl.meta || {}; mode = 'таблица по координатам';
    (tbl.warnings || []).forEach(function (w) { warnings.push(w); });
    if (smart) {
      var info = _bqgRefine_(tbl, vis.key, vis.folder);
      gpt.calls = info.calls; gpt.chunks = info.chunks; gpt.failed = info.failed;
      if (info.failed < info.chunks) { gpt.used = true; mode += ' + YandexGPT'; if (info.meta) meta = _bqMergeMeta_(meta, info.meta); }
      if (info.failed) { gpt.error = info.errors.join('; '); warnings.push('YandexGPT не ответил' + (info.failed < info.chunks ? ' по части строк' : '') + ' (' + gpt.error + ') — названия этих строк не уточнены, проверьте их'); }
      if (/HTTP 40[13]/.test(gpt.error)) warnings.push(/HTTP 403/.test(gpt.error) ? 'Нет доступа к YandexGPT: сервисному аккаунту ключа нужна роль ai.languageModels.user на каталог — кнопка «🔑 Проверить Yandex» покажет, что именно не так' : 'Ключ YANDEX_API_KEY не принят YandexGPT — кнопка «🔑 Проверить Yandex» покажет, что именно не так');
      info.warnings.slice(0, 10).forEach(function (w) { warnings.push('Модель: ' + w); });
    } else warnings.push(opts.mode === 'simple' ? 'Режим PARSE_MODE=simple: YandexGPT не используется' : 'YandexGPT не настроен — названия не уточнены моделью');
  } else {
    warnings.push('Таблица по координатам не собрана: ' + (tbl.reason || 'нет данных'));
    if (smart) {
      var f = _bqgFull_(_bqTextLines_(ann), vis.key, vis.folder);
      gpt.calls = f.info.calls; gpt.chunks = f.info.chunks; gpt.failed = f.info.failed;
      if (f.info.failed) gpt.error = f.info.errors.join('; ');
      if (f.items.length) {
        items = f.items; meta = f.info.meta || {}; mode = 'YandexGPT по тексту'; gpt.used = true;
        warnings.push('Строки разобраны моделью по тексту без координат — количество у каждого блюда сверьте с бланком');
        if (f.info.failed) warnings.push('Часть текста модель не разобрала (' + gpt.error + ') — полнота под вопросом');
        f.info.warnings.slice(0, 10).forEach(function (w) { warnings.push('Модель: ' + w); });
      }
    }
    if (!items.length) {
      var sp = _simpleParse_(vis.layoutText || vis.fullText || ann.fullText || '');
      items = sp.items; meta = _bqMergeMeta_(sp.meta || {}, {}); mode = 'простой разбор строк';
      warnings.push('Распознано без таблицы' + (smart ? ' и без модели' + (gpt.error ? ' (YandexGPT: ' + gpt.error + ')' : '') : '') + ' — это черновик: проверьте каждую строку');
    }
    items.forEach(function (it, i) {
      it.row_id = 't' + ('0' + (i + 1)).slice(-2); it.page = it.page || 1; it.name_lines = it.name_lines || [];
      _bqCheckRow_(it);
      if (mode === 'простой разбор строк' && it.status === 'распознана') { it.status = 'требует проверки'; it.warnings.push('Простой разбор строки — цифры могут относиться к соседнему блюду'); }
    });
  }
  var totals = (tbl.totals || []).concat(_bqTextTotals_(ann, items));
  var completeness = _bqCompleteness_(items, totals);
  items.forEach(function (it) { it.review_required = it.status !== 'распознана' && it.status !== 'служебная'; it.page_number = it.page; it.source_row_id = it.row_id; });
  return { items: items, meta: meta, completeness: completeness, warnings: warnings, mode: mode, gpt: gpt,
    table: { ok: !!tbl.ok, reason: tbl.reason || '', diag: tbl.diag || {} }, ms: Date.now() - t0 };
}
/** Шапка: значения таблицы главнее; модель — если в таблице пусто или это та же строка с исправленными буквами. */
function _bqMergeMeta_(a, b) {
  var out = {}, keys = ['format', 'date', 'time', 'place', 'guests', 'contact', 'payment', 'comment'];
  keys.forEach(function (k) {
    var x = a && a[k] ? String(a[k]).trim() : '', y = b && b[k] ? String(b[k]).trim() : '';
    if (/^(null|none|нет)$/i.test(y)) y = '';
    out[k] = !x ? y : y && _bqgSim_(x, y) >= 0.5 ? y : x;
  });
  return out;
}
/** Итоги из всего текста листа: числа больше любой строки — кандидаты в «итог бланка». */
function _bqTextTotals_(ann, items) {
  var mx = 0; (items || []).forEach(function (r) { if (typeof r.sum === 'number' && r.sum > mx) mx = r.sum; });
  var out = [];
  String((ann && ann.fullText) || '').replace(/\d[\d ]{2,}\d/g, function (m) { var v = parseFloat(m.replace(/\s/g, '')); if (v > mx && v < 1e8) out.push({ v: v, where: 'текст листа' }); return m; });
  _bqoWords_(ann).forEach(function (w) { var v = _bqoNum_(w.t); if (v !== null && v > mx && v < 1e8) out.push({ v: v, where: 'слово листа' }); });
  return out;
}

/** «17 октября», «17.10», «17.10.2026», «2026-10-17» → {iso, note}. Год, если его нет на бланке, — ближайший (не раньше 60 дней назад), с пометкой. */
function _bqDateRu_(s, now) {
  s = String(s || '').toLowerCase().replace(/ё/g, 'е'); now = now || new Date();
  var m = /(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return { iso: m[0], note: '' };
  var d = null, mo = null, y = null;
  m = /(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?/.exec(s);
  if (m) { d = +m[1]; mo = +m[2]; y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null; }
  else { m = new RegExp('(\\d{1,2})\\s*(' + BQO_MONTHS_.join('|') + ')\\S*(?:\\s+(\\d{4}))?').exec(s); if (m) { d = +m[1]; for (var i = 0; i < BQO_MONTHS_.length; i++) if (new RegExp('^' + BQO_MONTHS_[i]).test(m[2])) mo = i + 1; y = m[3] ? +m[3] : null; } }
  if (!d || !mo || d > 31 || mo > 12) return { iso: '', note: '' };
  var note = '';
  if (!y) { y = now.getFullYear(); var cand = new Date(y, mo - 1, d); if (cand.getTime() < now.getTime() - 60 * 864e5) y++; note = 'год на бланке не указан — подставлен ' + y + ', проверьте'; }
  else if (new Date(y, mo - 1, d).getTime() < now.getTime() - 60 * 864e5) note = 'на бланке год ' + y + ' — дата уже прошла, проверьте (бланк мог быть заполнен по старому образцу)';
  return { iso: y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2), note: note };
}

/** Журнал распознавания бланков: без ключей, без контактов и шапки — только счётчики, статусы и причины по строкам. */
function _bqLogSheet_() {
  var ss = _book_(), sh = ss.getSheetByName('Скан_Бланков_Журнал');
  if (!sh) {
    sh = ss.insertSheet('Скан_Бланков_Журнал');
    sh.appendRow(['Время', 'Сотрудник (ID)', 'Файл: КБ / SHA-256', 'Режим', 'Строк', 'С цифрами', 'Распознано', 'Требуют проверки', 'Неразборчивые', 'ТТК найдена', 'Полнота', 'Сумма строк', 'Итог бланка', 'YandexGPT вызовов', 'Ошибка', 'Длительность, мс', 'Строки (JSON)']);
    sh.setFrozenRows(1); sh.getRange(1, 1, 1, 17).setBackground('#6e1423').setFontColor('#ffffff').setFontWeight('bold');
  }
  return sh;
}
function _bqLog_(e) {
  try {
    var rows = (e.items || []).map(function (it) { return { id: it.row_id, s: it.status, ttk: it.match_status || '', why: (it.warnings || []).slice(0, 2).join('; ').slice(0, 160) }; });
    var js = JSON.stringify(rows); if (js.length > 45000) js = js.slice(0, 45000);
    var c = e.completeness || {};
    _bqLogSheet_().appendRow([new Date(), e.user || '', e.file || '', e.mode || '', (e.items || []).length,
      (e.items || []).filter(function (x) { return x.qty !== null || x.sum !== null; }).length,
      (e.items || []).filter(function (x) { return x.status === 'распознана'; }).length,
      (e.items || []).filter(function (x) { return x.status === 'требует проверки'; }).length,
      (e.items || []).filter(function (x) { return x.status === 'неразборчивая'; }).length,
      (e.items || []).filter(function (x) { return x.code; }).length,
      c.status || '', c.rowsSum == null ? '' : c.rowsSum, c.total == null ? '' : c.total, (e.gpt && e.gpt.calls) || 0, String(e.error || (e.gpt && e.gpt.error) || '').slice(0, 300), e.ms || '', js]);
  } catch (err) { try { _log_('WARN', 'Журнал скана бланков: ' + err); } catch (e2) {} }
}
function _bqFileSig_(dataUrl) {
  try {
    var b64 = String(dataUrl).split(',')[1] || '', bytes = Utilities.base64Decode(b64);
    var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
    return Math.round(bytes.length / 1024) + ' КБ / ' + d.slice(0, 12);
  } catch (e) { return ''; }
}
