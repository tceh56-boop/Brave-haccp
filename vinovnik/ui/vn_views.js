
/* ==========================================================================
   VINOVNIK — зал: «Моя смена» по зонам (зал, кухня, бар), блокнот официанта, бронирование, план зала,
   стоп/go-лист, электронное меню для гостей и QR-коды. Сервер — Vinovnik_*.gs (шлюз проверяет каждый вызов).
   ========================================================================== */
var VN_TIMER = null;
function vnAuto(id, sec, fn) {
  if (VN_TIMER) clearInterval(VN_TIMER);
  VN_TIMER = setInterval(function () { if (!VIEW || VIEW.id !== id || document.hidden) { if (!VIEW || VIEW.id !== id) { clearInterval(VN_TIMER); VN_TIMER = null; } return; } fn(); }, sec * 1000);
}
function vnMoney(n) { return vNum(n, 2) + ' ₽'; }
function vnZones(d, cur) {
  var Z = (d && d.zones) || []; if (Z.length < 2) return '';
  var mod = { hall: 'vnhall', kitchen: 'vnkitchen', bar: 'vnbar' };
  return '<div class="vnzones">' + Z.map(function (z) { return '<button class="btn' + (z.id === cur ? ' pri' : '') + '" data-mv="__go" data-a="' + mod[z.id] + '">' + esc(z.label) + '</button>'; }).join('') + '</div>';
}
function vnCommon(d) {
  var c = d && d.common; if (!c) return '';
  return '<div class="vncommon"><div><b>Общая «Моя смена»</b>: журналы, здоровье, бракераж, пробы — ' + (c.open ? 'дел сейчас ' + c.open + (c.overdue ? ', просрочено ' + c.overdue : '') : 'всё сделано') + '</div>' +
    '<button class="btn' + (c.overdue ? ' pri' : '') + '" data-mv="__go" data-a="myshift">Открыть</button></div>';
}
function vnStopChips(L) {
  if (!L || !L.length) return '<div class="empty">Стоп/go-лист пуст — всё в продаже</div>';
  return '<div class="vnchips">' + L.map(function (s) {
    var t = s.status === 'STOP' ? 'r' : s.status === 'LIMIT' ? 'a' : 'g';
    return '<span class="chip ' + t + '" title="' + esc(s.reason || '') + '">' + esc(s.statusRu) + (s.status === 'LIMIT' && s.left !== null ? ' ' + s.left : '') + ' · ' + esc(s.name) + '</span>';
  }).join('') + '</div>';
}
function vnStateChip(st) { return vChip({ HOLD: 'ждёт курса', SENT: 'готовится', READY: 'готово', SERVED: 'подано', VOID: 'отменено' }[st] || st, { HOLD: 'b', SENT: 'a', READY: 'g', SERVED: '', VOID: 'r' }[st] || ''); }

/* ---------- Моя смена — Зал ---------- */
VIEWS.vnhall = {
  fns: { serve: 'vnLineStatus', serveAll: 'vnLineStatus', fire: 'vnOrderFire', seat: 'vnBookingStatus' },
  title: 'Моя смена — Зал',
  sub: 'Мои столы, что готово к подаче, какой курс подать следующим, брони на ближайшие часы и стоп/go-лист. Экран обновляется сам.',
  acts: [['Блокнот официанта', 'note'], ['Обновить', 'load']],
  open: function () { this._d = null; this.h.load(); vnAuto('vnhall', 30, function () { VIEWS.vnhall.h.load(true); }); },
  h: {
    load: function (quiet) {
      var V = VIEWS.vnhall; if (!V._d && !quiet) vLoading();
      vCall('vnShiftData', [JSON.stringify({ zone: 'hall' })]).then(function (r) { var e = vErr(r); if (e) { if (!quiet) { vMsg(e, 'err'); vBody(''); } return; } V._d = vData(r) || {}; V.h.draw(); });
    },
    note: function () { openView('vnorder'); },
    draw: function () {
      var d = VIEWS.vnhall._d || {}, S = d.summary || {}, h = vnZones(d, 'hall');
      h += vKpis([['Мои столы', S.orders || 0], ['Подать сейчас', S.toServe || 0, S.toServe ? 'gold' : 'green'], ['Ждут курса', S.held || 0, S.held ? 'wine' : ''], ['Брони впереди', S.bookings || 0], ['В стопе', S.stop || 0, S.stop ? 'red' : 'green', 'go: ' + (S.go || 0)]]);
      h += vnCommon(d);
      if ((d.toServe || []).length) {
        var byT = {}; d.toServe.forEach(function (x) { (byT[x.table] = byT[x.table] || []).push(x); });
        h += vCard('Готово — подать', Object.keys(byT).map(function (t) {
          return '<div class="vnserve"><div class="vnt">Стол ' + esc(t) + '</div><div class="vnl">' + byT[t].map(function (x) {
            return '<div><b>' + esc(x.name) + '</b> × ' + vNum(x.qty) + (x.seat ? ' · гость ' + esc(x.seat) : '') + (x.comment ? ' · <i>' + esc(x.comment) + '</i>' : '') + (x.waitMin >= 3 ? ' ' + vChip('ждёт ' + x.waitMin + ' мин', 'r') : '') + ' ' + vBtn('Подано', 'serve', x.id) + '</div>';
          }).join('') + '</div>' + (byT[t].length > 1 ? vBtn('Подано всё', 'serveAll', byT[t].map(function (x) { return x.id; }).join(','), true) : '') + '</div>';
        }).join(''));
      }
      h += vCard('Мои столы', (d.orders || []).length ? '<div class="vngrid">' + d.orders.map(function (o) {
        var c = o.counts || {};
        return '<div class="vnord"><div class="vnordh"><b>Стол ' + esc(o.table) + '</b><span class="dnote">' + esc(o.guests) + ' гост. · с ' + esc(o.opened) + (d.can && d.can.manage ? ' · ' + esc(o.waiter) : '') + '</span></div>' +
          '<div class="vnchips">' + (c.ready ? vChip('готово ' + c.ready, 'g') : '') + (c.sent ? vChip('готовится ' + c.sent, 'a') : '') + (c.hold ? vChip('ждёт курса ' + c.hold, 'b') : '') + (c.served ? vChip('подано ' + c.served, '') : '') + '</div>' +
          '<div class="vnsum">' + vnMoney(o.sumNow) + '</div><div class="mvbar">' + (o.nextCourse !== null ? vBtn('Подать курс ' + o.nextCourse, 'fire', o.id + '|' + o.nextCourse, true) + ' ' : '') +
          '<button class="btn" data-mv="__go2" data-a="' + esc(o.id) + '">Блокнот</button></div></div>';
      }).join('') + '</div>' : '<div class="empty">Открытых столов нет. Откройте стол в блокноте официанта или отметьте «гости пришли» у брони.</div>', vBtn('+ Открыть стол', 'note', '', true));
      if (d.can && (d.can.booking || d.can.orders)) h += vCard('Брони на сегодня', vTable([{ k: 'from', l: 'Время' }, { k: 'guest', l: 'Гость' }, { k: 'guests', l: 'Гостей', t: 'num' }, { k: 't', l: 'Стол', f: function (b) { return b.tables.join(', '); } }, { k: 'statusRu', l: 'Статус' }, { k: 'note', l: 'Комментарий', f: function (b) { return [b.occasion, b.note].filter(Boolean).join(' · '); } }],
        d.bookings || [], function (b) { return b.status === 'CONFIRMED' ? vBtn('Гости пришли', 'seat', b.id, true) : ''; }, 'Броней впереди нет') + (d.requests ? '<div class="dnote" style="margin-top:6px">Заявок гостей с QR-меню: ' + d.requests + ' — подтверждает администратор в «Бронировании».</div>' : ''));
      h += vCard('Стоп/go-лист', vnStopChips(d.stop), '<button class="btn" data-mv="__go" data-a="vnstop">Открыть</button>');
      vBody(h);
    },
    serve: function (a, btn) { vDo(btn, 'vnLineStatus', [JSON.stringify({ ids: [a], status: 'SERVED' })], 'Отмечено: подано', function () { VIEWS.vnhall.h.load(true); }); },
    serveAll: function (a, btn) { vDo(btn, 'vnLineStatus', [JSON.stringify({ ids: String(a).split(','), status: 'SERVED' })], 'Отмечено: подано всё по столу', function () { VIEWS.vnhall.h.load(true); }); },
    fire: function (a, btn) { var p = String(a).split('|'); vDo(btn, 'vnOrderFire', [JSON.stringify({ order: p[0], course: +p[1] })], function (d) { return 'Курс ' + p[1] + ' подан: на кухню и бар ушло позиций — ' + (d && d.fired || 0); }, function () { VIEWS.vnhall.h.load(true); }); },
    seat: function (a, btn) { vDo(btn, 'vnBookingStatus', [JSON.stringify({ id: a, status: 'SEATED' })], function (d) { return 'Гости за столом. Открыт заказ ' + (d && d.order ? d.order.id : ''); }, function (d) { if (d && d.order) openView('vnorder', d.order.id); }); }
  }
};
document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-mv="__go2"]'); if (!b || !VIEW) return; e.preventDefault(); e.stopPropagation(); openView('vnorder', b.getAttribute('data-a')); }, true);

/* ---------- Моя смена — Кухня и Бар: очередь по столам и курсам ---------- */
function vnQueueView(id, zone, station) {
  return {
    fns: { ready: 'vnLineStatus', readyAll: 'vnLineStatus', back: 'vnLineStatus' },
    title: 'Моя смена — ' + station,
    sub: station === 'Бар' ? 'Очередь бара: что приготовить, для какого стола и курса, комментарии гостя. «Готово» — официант увидит, что можно подавать.'
      : 'Очередь кухни по столам и курсам: количество, вес, номер гостя и комментарий. Курсы, которые официант ещё не подал, — серым. «Готово» — официант увидит, что можно подавать.',
    acts: [['Стоп/go-лист', 'stop'], ['Обновить', 'load']],
    open: function () { this._d = null; this.h.load(); vnAuto(id, 20, function () { VIEWS[id].h.load(true); }); },
    h: {
      load: function (quiet) {
        var V = VIEWS[id]; if (!V._d && !quiet) vLoading();
        vCall('vnShiftData', [JSON.stringify({ zone: zone })]).then(function (r) { var e = vErr(r); if (e) { if (!quiet) { vMsg(e, 'err'); vBody(''); } return; } V._d = vData(r) || {}; V.h.draw(); });
      },
      stop: function () { openView('vnstop'); },
      draw: function () {
        var d = VIEWS[id]._d || {}, q = d.queue || {}, c = q.counts || {}, h = vnZones(d, zone);
        h += vKpis([['Готовится', c.cooking || 0, c.cooking ? 'gold' : 'green'], ['Дольше ' + (q.norm || 20) + ' мин', c.late || 0, c.late ? 'red' : 'green'], ['Готово, ждёт официанта', c.ready || 0], ['Ждут команды', c.held || 0]]);
        h += vnCommon(d);
        var T = q.tickets || [];
        h += T.length ? '<div class="vntickets">' + T.map(function (t) {
          var cook = t.lines.filter(function (l) { return l.status === 'SENT'; });
          return '<div class="vntk ' + t.state + (t.late ? ' late' : '') + '"><div class="vntkh"><b>Стол ' + esc(t.table) + '</b><span>' + esc(t.courseRu) + '</span></div>' +
            '<div class="dnote">' + esc(t.waiter) + ' · ' + esc(t.guests) + ' гост.' + (t.state === 'cooking' ? ' · ' + t.mins + ' мин' : t.state === 'held' ? ' · ждёт команды официанта' : '') + '</div>' +
            t.lines.map(function (l) {
              return '<div class="vntl ' + l.status + '"><div><b>' + vNum(l.qty) + ' × ' + esc(l.name) + '</b>' + (l.weight ? ' <span class="dnote">' + vNum(l.weight) + ' ' + esc(l.weightUnit) + '</span>' : '') + (l.seat ? ' <span class="chip b">гость ' + esc(l.seat) + '</span>' : '') +
                (l.comment ? '<div class="vncm">' + esc(l.comment) + '</div>' : '') + '</div><div>' + (l.status === 'SENT' ? vBtn('Готово', 'ready', l.id, true) : l.status === 'READY' ? vChip('готово', 'g') + ' ' + vBtn('↺', 'back', l.id) : vChip('ждёт', 'b')) + '</div></div>';
            }).join('') + (cook.length > 1 ? '<div class="mvbar">' + vBtn('Готово всё (' + cook.length + ')', 'readyAll', cook.map(function (l) { return l.id; }).join(','), true) + '</div>' : '') + '</div>';
        }).join('') + '</div>' : '<div class="empty">Заказов в очереди нет.</div>';
        h += vCard('Стоп/go-лист' + (station === 'Бар' ? ' бара' : ' кухни'), vnStopChips(d.stop));
        vBody(h);
      },
      ready: function (a, btn) { vDo(btn, 'vnLineStatus', [JSON.stringify({ ids: [a], status: 'READY' })], 'Готово — официант увидит', function () { VIEWS[id].h.load(true); }); },
      readyAll: function (a, btn) { vDo(btn, 'vnLineStatus', [JSON.stringify({ ids: String(a).split(','), status: 'READY' })], 'Готово всё по столу', function () { VIEWS[id].h.load(true); }); },
      back: function (a, btn) { vDo(btn, 'vnLineStatus', [JSON.stringify({ ids: [a], status: 'SENT' })], 'Возвращено в работу', function () { VIEWS[id].h.load(true); }); }
    }
  };
}
VIEWS.vnkitchen = vnQueueView('vnkitchen', 'kitchen', 'Кухня');
VIEWS.vnbar = vnQueueView('vnbar', 'bar', 'Бар');

/* ---------- Блокнот официанта ---------- */
VIEWS.vnorder = {
  fns: { send: 'vnOrderAdd', fire: 'vnOrderFire', serve: 'vnLineStatus', voidL: 'vnLineStatus', close: 'vnOrderClose', doClose: 'vnOrderClose', openT: 'vnOrderOpen', cancelO: 'vnOrderCancel' },
  title: 'Блокнот официанта',
  sub: 'Стол → позиции меню: количество, курс подачи, вес, гость и комментарий. «Отправить» — курс «сразу» и поданные курсы уходят на кухню и бар, остальные ждут команды «Подать курс». Позиции в стопе не добавляются.',
  acts: [['Столы', 'tables'], ['Обновить', 'reload']],
  open: function (arg) { var V = this; V._o = null; V._draft = []; V._f = ''; V._sec = ''; V._menu = null; V.h.boot(arg); },
  h: {
    boot: function (orderId) {
      var V = VIEWS.vnorder; vLoading();
      Promise.all([vCall('vnMenuData', []), orderId ? vCall('vnOrderData', [JSON.stringify({ order: orderId })]) : vCall('vnHallData', [JSON.stringify({})])]).then(function (R) {
        var e = vErr(R[0]) || vErr(R[1]); if (e) { vMsg(e, 'err'); vBody(''); return; }
        V._menu = vData(R[0]) || {}; var d = vData(R[1]) || {};
        if (orderId) { V._o = d.order; V._canManage = d.canManage; V.h.draw(); } else { V._hall = d; V.h.tables(); }
      });
    },
    reload: function () { var V = VIEWS.vnorder; if (V._o) V.h.boot(V._o.id); else V.h.boot(); },
    tables: function () {
      var V = VIEWS.vnorder;
      if (!V._hall) { vCall('vnHallData', [JSON.stringify({})]).then(function (r) { var e = vErr(r); if (e) { vMsg(e, 'err'); return; } V._hall = vData(r); V._o = null; V.h.tables(); }); return; }
      V._o = null;
      var T = V._hall.tables || [], zones = {};
      T.forEach(function (t) { (zones[t.zone] = zones[t.zone] || []).push(t); });
      var h = Object.keys(zones).map(function (z) {
        return vCard(z, '<div class="vnfloor">' + zones[z].map(function (t) {
          return '<button class="vntbl ' + t.state + '" data-mv="pickT" data-a="' + esc(t.table) + '"><b>' + esc(t.table) + '</b><small>' + esc(t.seats) + ' мест</small><span>' + esc(t.order ? t.order.waiter : t.next ? 'бронь ' + t.next.from : t.stateRu) + '</span></button>';
        }).join('') + '</div>');
      }).join('');
      vBody((T.length ? '<div class="dnote" style="margin-bottom:8px">Свободный стол — открыть; занятый — продолжить заказ.</div>' + h : '<div class="empty">В плане зала нет столов. Администратор добавляет их в «План зала».</div>'));
      V._hall = null;
    },
    pickT: function (a) {
      var V = VIEWS.vnorder;
      vCall('vnHallData', [JSON.stringify({})]).then(function (r) {
        var d = vData(r) || {}, t = (d.tables || []).filter(function (x) { return x.table === a; })[0];
        if (t && t.order) { V.h.boot(t.order.id); return; }
        var g = prompt('Стол ' + a + ': сколько гостей?', t && t.next ? t.next.guests : 2); if (g === null) return;
        vDo(null, 'vnOrderOpen', [JSON.stringify({ table: a, guests: g })], 'Стол ' + a + ' открыт', function (o) { V._o = o; V._draft = []; V.h.draw(); });
      });
    },
    draw: function () {
      var V = VIEWS.vnorder, o = V._o, M = (V._menu && V._menu.items) || [], h = '';
      if (!o) { V.h.tables(); return; }
      var C = (V._menu && V._menu.courses) || [[0, 'Сразу'], [1, 'Курс 1'], [2, 'Курс 2'], [3, 'Курс 3'], [4, 'Курс 4'], [5, 'По команде']];
      h += '<div class="vnordtop"><div><h2 style="margin:0">Стол ' + esc(o.table) + '</h2><div class="dnote">' + esc(o.guests) + ' гост. · ' + esc(o.waiter) + ' · открыт ' + esc(o.opened) + ' · ' + esc(o.id) + '</div></div>' +
        '<div class="vnsum">' + vnMoney(o.sumNow || 0) + '</div></div>';
      // текущий заказ по курсам
      var byC = {}; (o.lines || []).forEach(function (l) { (byC[l.course] = byC[l.course] || []).push(l); });
      var cur = Object.keys(byC).sort(function (a, b) { return a - b; }).map(function (k) {
        var L = byC[k], held = L.some(function (l) { return l.status === 'HOLD'; });
        return '<div class="vncourse"><div class="vncth"><b>' + esc(L[0].courseRu) + '</b>' + (held ? ' ' + vBtn('Подать курс ' + k, 'fire', k, true) : '') + '</div>' + L.map(function (l) {
          return '<div class="vnline ' + l.status + '"><div><b>' + vNum(l.qty) + ' × ' + esc(l.name) + '</b>' + (l.weight ? ' <span class="dnote">' + vNum(l.weight) + ' ' + esc(l.weightUnit) + '</span>' : '') + (l.seat ? ' ' + vChip('гость ' + l.seat, 'b') : '') +
            (l.comment ? '<div class="vncm">' + esc(l.comment) + '</div>' : '') + (l.voidReason ? '<div class="dnote">отмена: ' + esc(l.voidReason) + '</div>' : '') + '</div>' +
            '<div class="vnlr">' + vnStateChip(l.status) + ' <span class="dnote">' + vnMoney(l.sum) + '</span> ' + (l.status === 'READY' ? vBtn('Подано', 'serve', l.id) : '') + (l.status !== 'VOID' && l.status !== 'SERVED' ? ' ' + vBtn('✕', 'voidL', l.id) : '') + '</div></div>';
        }).join('') + '</div>';
      }).join('');
      h += vCard('Заказ', cur || '<div class="empty">Позиций пока нет — выберите из меню ниже.</div>',
        vBtn('Закрыть счёт', 'close', '', !!(o.lines || []).length) + ' ' + (V._canManage ? vBtn('Отменить заказ', 'cancelO') : ''));
      // черновик
      var D = V._draft || [];
      if (D.length) h += vCard('Новые позиции — ещё не отправлены', D.map(function (x, i) {
        var m = M.filter(function (y) { return y.code === x.code; })[0] || {};
        return '<div class="vndraft"><div class="vndn"><b>' + esc(m.name) + '</b><span class="dnote">' + esc(m.station) + (m.byWeight ? ' · по весу ' + vnMoney(m.price) + '/' + (m.per || 100) + ' ' + esc(m.yieldUnit) : ' · ' + vnMoney(m.price)) + '</span></div>' +
          '<label>Кол-во<input class="vnq" data-i="' + i + '" data-k="qty" type="number" min="0.5" step="0.5" value="' + esc(x.qty) + '"></label>' +
          '<label>Курс<select class="vnq" data-i="' + i + '" data-k="course">' + C.map(function (c) { return '<option value="' + c[0] + '"' + (+x.course === c[0] ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') + '</select></label>' +
          '<label>Вес, ' + esc(m.yieldUnit || 'г') + '<input class="vnq" data-i="' + i + '" data-k="weight" type="number" min="0" step="10" value="' + esc(x.weight || '') + '"></label>' +
          '<label>Гость<input class="vnq" data-i="' + i + '" data-k="seat" maxlength="4" value="' + esc(x.seat || '') + '" style="width:56px"></label>' +
          '<label class="vnwide">Комментарий<input class="vnq" data-i="' + i + '" data-k="comment" maxlength="200" placeholder="без лука, прожарка medium…" value="' + esc(x.comment || '') + '"></label>' +
          '<button class="btn" data-mv="rm" data-a="' + i + '">✕</button></div>';
      }).join(''), vBtn('Отправить на кухню и бар (' + D.length + ')', 'send', '', true));
      // меню
      var secs = (V._menu && V._menu.sections) || [], f = (V._f || '').toLowerCase();
      var L = M.filter(function (m) { return (!V._sec || m.section === V._sec || (V._sec === '__go' && m.stop && m.stop.status === 'GO')) && (!f || m.name.toLowerCase().indexOf(f) >= 0); });
      h += vCard('Меню', '<input id="vnfind" class="vnfind" placeholder="Поиск по меню" value="' + esc(V._f || '') + '">' +
        '<div class="vnsecs"><button class="chip' + (!V._sec ? ' g' : '') + '" data-mv="sec" data-a="">Все</button><button class="chip' + (V._sec === '__go' ? ' g' : '') + '" data-mv="sec" data-a="__go">Go — предложить</button>' + secs.map(function (s) { return '<button class="chip' + (V._sec === s ? ' g' : '') + '" data-mv="sec" data-a="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div>' +
        '<div class="vnmenu">' + (L.length ? L.map(function (m) {
          var st = m.stop, dis = st && st.status === 'STOP';
          return '<button class="vnitem' + (dis ? ' off' : '') + (st && st.status === 'GO' ? ' go' : '') + '" data-mv="add" data-a="' + esc(m.code) + '"' + (dis ? ' disabled title="' + esc(st.reason) + '"' : '') + '><b>' + esc(m.name) + '</b><span>' + (m.byWeight ? vnMoney(m.price) + '/' + (m.per || 100) + esc(m.yieldUnit) : vnMoney(m.price)) + (m.yield && !m.byWeight ? ' · ' + vNum(m.yield) + ' ' + esc(m.yieldUnit) : '') + '</span>' +
            (st ? '<i class="chip ' + (st.status === 'STOP' ? 'r' : st.status === 'LIMIT' ? 'a' : 'g') + '">' + esc(st.statusRu) + (st.status === 'LIMIT' ? ' ' + st.left : '') + '</i>' : '') + '</button>';
        }).join('') : '<div class="empty">' + (M.length ? 'Ничего не найдено' : 'Меню пусто — администратор добавляет позиции в «Электронное меню».') + '</div>') + '</div>');
      vBody(h);
      var fi = document.getElementById('vnfind'); if (fi) { fi.oninput = function () { V._f = fi.value; var p = fi.selectionStart; V.h.draw(); var n = document.getElementById('vnfind'); if (n) { n.focus(); try { n.setSelectionRange(p, p); } catch (e) {} } }; }
      [].forEach.call(document.querySelectorAll('.vnq'), function (inp) { inp.onchange = inp.oninput = function () { var x = V._draft[+inp.getAttribute('data-i')]; if (x) x[inp.getAttribute('data-k')] = inp.value; }; });
    },
    sec: function (a) { VIEWS.vnorder._sec = a || ''; VIEWS.vnorder.h.draw(); },
    add: function (a) {
      var V = VIEWS.vnorder, m = ((V._menu && V._menu.items) || []).filter(function (x) { return x.code === a; })[0]; if (!m) return;
      if (m.stop && m.stop.status === 'STOP') { vMsg('«' + m.name + '» в стопе: ' + m.stop.reason, 'err'); return; }
      V._draft.push({ code: m.code, qty: 1, course: m.station === 'Бар' ? 0 : 1, weight: m.yield || '', seat: '', comment: '' });
      vMsg('Добавлено в черновик: ' + m.name + ' — укажите курс, вес и комментарий, затем «Отправить»', 'ok'); V.h.draw();
    },
    rm: function (a) { VIEWS.vnorder._draft.splice(+a, 1); VIEWS.vnorder.h.draw(); },
    send: function (a, btn) {
      var V = VIEWS.vnorder; if (!V._draft.length) return;
      vDo(btn, 'vnOrderAdd', [JSON.stringify({ order: V._o.id, lines: V._draft })], function (d) { return 'Отправлено: ' + (d.sent || 0) + ' — на кухню и бар' + (d.held ? ', ждут курса: ' + d.held : '') + ((d.limits || []).some(function (l) { return l.stopped; }) ? '. Лимит исчерпан — позиция ушла в стоп' : ''); },
        function (d) { V._o = d; V._draft = []; vCall('vnMenuData', []).then(function (r) { V._menu = vData(r) || V._menu; V.h.draw(); }); });
    },
    fire: function (a, btn) { var V = VIEWS.vnorder; vDo(btn, 'vnOrderFire', [JSON.stringify({ order: V._o.id, course: +a })], function (d) { return 'Курс ' + a + ' подан: ' + (d.fired || 0) + ' поз.'; }, function (d) { V._o = d; V.h.draw(); }); },
    serve: function (a, btn) { var V = VIEWS.vnorder; vDo(btn, 'vnLineStatus', [JSON.stringify({ ids: [a], status: 'SERVED' })], 'Подано', function (d) { V._o = (d.orders || [])[0] || V._o; V.h.draw(); }); },
    voidL: function (a, btn) {
      var V = VIEWS.vnorder, r = prompt('Причина отмены позиции (гость передумал, ошибка официанта…)'); if (!r) return;
      vDo(btn, 'vnLineStatus', [JSON.stringify({ ids: [a], status: 'VOID', reason: r })], 'Позиция отменена', function (d) { V._o = (d.orders || [])[0] || V._o; V.h.draw(); });
    },
    cancelO: function (a, btn) {
      var V = VIEWS.vnorder, r = prompt('Отменить весь заказ стола ' + V._o.table + '? Причина:'); if (!r) return;
      vDo(btn, 'vnOrderCancel', [JSON.stringify({ order: V._o.id, reason: r })], 'Заказ отменён', function () { V._o = null; V.h.tables(); });
    },
    close: function () {
      var V = VIEWS.vnorder, o = V._o, pay = [['CARD', 'Карта'], ['CASH', 'Наличные'], ['SBP', 'СБП'], ['MIXED', 'Смешанная'], ['STAFF', 'Персонал / за счёт заведения']];
      var f = [['pay', 'Оплата', 'select', 'CARD', pay], ['check', 'Номер чека', 'text', '', 'по кассе']];
      if (V._canManage) f.splice(1, 0, ['disc', 'Скидка, %', 'number', '0']);
      vBody('<div class="card mvcard"><div class="ch"><h3>Счёт: стол ' + esc(o.table) + ' — ' + vnMoney(o.sumNow) + '</h3></div><div class="mvb">' + vForm(f) +
        '<div class="dnote" style="margin:8px 0">Каждая позиция будет проведена продажей: журнал продаж J36, списание склада по ТТК и партиям. Отменённые позиции не проводятся.</div>' +
        '<div class="mvbar">' + vBtn('Закрыть счёт', 'doClose', '', true) + ' <button class="btn" data-mv="back2">Назад к заказу</button></div></div></div>');
    },
    back2: function () { VIEWS.vnorder.h.draw(); },
    doClose: function (a, btn) {
      var V = VIEWS.vnorder, x = { order: V._o.id, payment: vV('pay'), discountPct: vV('disc') || 0, check: vV('check'), force: a === 'force' };
      vDo(btn, 'vnOrderClose', [JSON.stringify(x)], function (d) {
        if (d && d.needForce) return 'Не подано: ' + d.notServed.join('; ');
        return 'Счёт закрыт: ' + vnMoney(d.total) + (d.discount ? ' (скидка ' + vnMoney(d.discount) + ')' : '') + '. Продаж проведено: ' + d.sales.length + (d.errors.length ? '. Не проведено: ' + d.errors.join('; ') : '');
      }, function (d) {
        if (d && d.needForce) { if (confirm('Часть позиций не подана:\n' + d.notServed.join('\n') + '\n\nЗакрыть счёт всё равно?')) V.h.doClose('force', btn); return; }
        V._o = null; setTimeout(function () { V.h.tables(); }, 50);
      });
    }
  }
};

/* ---------- Бронирование столов ---------- */
VIEWS.vnbook = {
  fns: { save: 'vnBookingSave', st: 'vnBookingStatus', confirmReq: 'vnBookingStatus' },
  title: 'Бронирование столов',
  sub: 'Брони по дням и столам: время, гости, телефон, повод, депозит. Пересечения по столу система не допускает. Заявки гостей с QR-меню — сверху: подтвердите, выбрав стол.',
  acts: [['+ Новая бронь', 'form'], ['Обновить', 'load']],
  open: function () { this._edit = null; this.h.load(); },   // день по умолчанию — «сегодня» сервера (пояс предприятия), не часы устройства
  h: {
    load: function () {
      var V = VIEWS.vnbook; vLoading();
      vCall('vnHallData', [JSON.stringify({ date: V._day || '' })]).then(function (r) { var e = vErr(r); if (e) { vMsg(e, 'err'); vBody(''); return; } V._d = vData(r) || {}; V._day = V._d.date; V.h.draw(); });
    },
    day: function (a) { var V = VIEWS.vnbook, p = V._day.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2], 12); d.setDate(d.getDate() + (+a)); V._day = vIso(d); V.h.load(); },
    draw: function () {
      var V = VIEWS.vnbook, d = V._d || {}, B = d.bookings || [], R = d.requests || [], can = d.can || {}, h = '';
      var act = B.filter(function (b) { return b.status === 'CONFIRMED' || b.status === 'SEATED'; });
      h += '<div class="vnday"><button class="btn" data-mv="day" data-a="-1">‹</button><input type="date" id="vnday" value="' + esc(V._day) + '"><button class="btn" data-mv="day" data-a="1">›</button>' +
        (V._day !== d.today ? '<button class="btn" data-mv="today">Сегодня</button>' : '') + '</div>';
      h += vKpis([['Броней', act.length], ['Гостей', act.reduce(function (a, b) { return a + b.guests; }, 0)], ['Заявки гостей', R.length, R.length ? 'gold' : 'green'], ['Столов в зале', (d.tables || []).length]]);
      if (R.length && can.booking) h += vCard('Заявки гостей — подтвердите', R.map(function (b) {
        return '<div class="vnreq"><div><b>' + esc(b.date.split('-').reverse().join('.')) + ' ' + esc(b.from) + '</b> · ' + esc(b.guest) + ' · ' + esc(b.guests) + ' гост. · <a href="tel:' + esc(b.phone) + '">' + esc(b.phone) + '</a>' +
          (b.note ? '<div class="dnote">' + esc(b.note) + '</div>' : '') + '<div class="dnote">' + esc(b.source) + '</div></div>' +
          '<div class="mvbar"><input class="vnreqt" id="rq_' + esc(b.id) + '" placeholder="стол" style="width:70px"> ' + vBtn('Подтвердить', 'confirmReq', b.id, true) + ' ' + vBtn('Отклонить', 'st', b.id + '|CANCELLED') + '</div></div>';
      }).join(''));
      if (V._form) h += V.h.formHtml();
      h += vCard('Шахматка: столы и время', V.h.timeline(d));
      h += vCard('Брони на ' + V._day.split('-').reverse().join('.'), vTable([{ k: 'from', l: 'С' }, { k: 'to', l: 'До' }, { k: 'guest', l: 'Гость' }, { k: 'phone', l: 'Телефон' }, { k: 'guests', l: 'Гостей', t: 'num' }, { k: 't', l: 'Столы', f: function (b) { return b.tables.join(', '); } },
        { k: 'statusRu', l: 'Статус' }, { k: 'n', l: 'Повод, комментарий', f: function (b) { return [b.occasion, b.note, b.deposit ? 'депозит ' + b.deposit + ' ₽' : '', b.reason ? 'причина: ' + b.reason : ''].filter(Boolean).join(' · '); } }],
        B, function (b) {
          if (b.status === 'CONFIRMED') return vBtn('Гости пришли', 'st', b.id + '|SEATED', true) + (can.booking ? ' ' + vBtn('Изменить', 'edit', b.id) + ' ' + vBtn('Не пришли', 'st', b.id + '|NOSHOW') + ' ' + vBtn('Отменить', 'st', b.id + '|CANCELLED') : '');
          if (b.status === 'SEATED') return b.order ? '<button class="btn" data-mv="__go2" data-a="' + esc(b.order) + '">Заказ</button>' : '';
          return '';
        }, 'На этот день броней нет'));
      vBody(h);
      var di = document.getElementById('vnday'); if (di) di.onchange = function () { if (di.value) { V._day = di.value; V.h.load(); } };
      if (V._form) V.h.bindForm();
    },
    today: function () { VIEWS.vnbook._day = VIEWS.vnbook._d.today; VIEWS.vnbook.h.load(); },
    timeline: function (d) {
      var T = d.tables || [], from = 10 * 60, to = 24 * 60, span = to - from, toMin = function (hm) { var p = String(hm || '').split(':'); return +p[0] * 60 + +p[1]; };
      if (!T.length) return '<div class="empty">Столов нет — добавьте их в «План зала».</div>';
      var hours = ''; for (var x = 10; x <= 24; x += 2) hours += '<span style="left:' + ((x * 60 - from) / span * 100) + '%">' + x + ':00</span>';
      return '<div class="vntl2"><div class="vnhrs">' + hours + '</div>' + T.map(function (t) {
        return '<div class="vnrow"><div class="vnrl">' + esc(t.table) + '<small>' + esc(t.seats) + '</small></div><div class="vnrt">' + (t.bookings || []).map(function (b) {
          var a = Math.max(0, toMin(b.from) - from), e = toMin(b.to) <= toMin(b.from) ? span : Math.min(span, toMin(b.to) - from);
          return '<div class="vnbk ' + b.status + '" style="left:' + (a / span * 100) + '%;width:' + Math.max(2, (e - a) / span * 100) + '%" title="' + esc(b.from + '–' + b.to + ' ' + b.guest + ', ' + b.guests + ' гост.') + '">' + esc(b.from + ' ' + b.guest) + '</div>';
        }).join('') + '</div></div>';
      }).join('') + '</div>';
    },
    form: function () { var V = VIEWS.vnbook; V._edit = null; V._form = { date: V._day, from: '19:00', minutes: (V._d.settings || {}).bookDur || 120, guests: 2, tables: [] }; V.h.draw(); },
    edit: function (a) { var V = VIEWS.vnbook, b = (V._d.bookings || []).filter(function (x) { return x.id === a; })[0]; if (!b) return; V._edit = b.id; V._form = { date: b.date, from: b.from, to: b.to, guests: b.guests, guest: b.guest, phone: b.phone, tables: b.tables, source: b.source, deposit: b.deposit, occasion: b.occasion, note: b.note }; V.h.draw(); window.scrollTo(0, 0); },
    formHtml: function () {
      var V = VIEWS.vnbook, f = V._form;
      return vCard(V._edit ? 'Изменить бронь' : 'Новая бронь', vForm([['bd', 'Дата', 'date', f.date], ['bf', 'Время', 'time', f.from], ['bm', 'Длительность, мин', 'number', f.to ? '' : f.minutes], ['bg', 'Гостей', 'number', f.guests],
        ['bn', 'Гость', 'text', f.guest || ''], ['bp', 'Телефон', 'tel', f.phone || '', '+7'], ['bs', 'Источник', 'select', f.source || 'телефон', ['телефон', 'вживую', 'мессенджер', 'сайт', 'агрегатор', 'QR-меню']],
        ['bdep', 'Депозит, ₽', 'number', f.deposit || ''], ['bo', 'Повод', 'text', f.occasion || '', 'день рождения, деловая встреча…'], ['bc', 'Комментарий', 'textarea', f.note || '', 'пожелания гостя', 2]]) +
        '<div class="mvbar" style="margin:8px 0">' + vBtn('Подобрать свободные столы', 'free') + '</div><div id="vnfree">' + (V._free ? V.h.freeHtml() : '') + '</div>' +
        '<div class="mvbar">' + vBtn(V._edit ? 'Сохранить' : 'Забронировать', 'save', '', true) + ' <button class="btn" data-mv="cancelF">Закрыть</button></div>');
    },
    bindForm: function () {},
    cancelF: function () { var V = VIEWS.vnbook; V._form = null; V._free = null; V._edit = null; V.h.draw(); },
    grab: function () { var V = VIEWS.vnbook, f = V._form; f.date = vV('bd'); f.from = vV('bf'); f.minutes = vV('bm'); f.guests = vV('bg'); f.guest = vV('bn'); f.phone = vV('bp'); f.source = vV('bs'); f.deposit = vV('bdep'); f.occasion = vV('bo'); f.note = vV('bc');
      var ch = document.querySelectorAll('.vnfree input:checked'); if (ch.length || document.querySelector('.vnfree')) f.tables = [].map.call(ch, function (c) { return c.value; }); return f; },
    free: function () {
      var V = VIEWS.vnbook, f = V.h.grab(), to = '';
      vCall('vnHallData', [JSON.stringify({ date: f.date, from: f.from, to: to, guests: f.guests, except: V._edit || '' })]).then(function (r) {
        var e = vErr(r); if (e) { vMsg(e, 'err'); return; } V._free = (vData(r) || {}).free || []; document.getElementById('vnfree').innerHTML = V.h.freeHtml();
      });
    },
    freeHtml: function () {
      var V = VIEWS.vnbook, L = V._free || [], sel = (V._form && V._form.tables) || [];
      if (!L.length) return '<div class="empty">На это время свободных столов нет</div>';
      return '<div class="vnfree">' + L.map(function (t) { return '<label class="vnfc' + (t.fits ? '' : ' small') + '"><input type="checkbox" value="' + esc(t.table) + '"' + (sel.indexOf(t.table) >= 0 ? ' checked' : '') + '> Стол ' + esc(t.table) + ' <small>' + esc(t.zone) + ', ' + esc(t.seats) + ' мест' + (t.fits ? '' : ' — мало мест') + '</small></label>'; }).join('') + '</div>';
    },
    save: function (a, btn) {
      var V = VIEWS.vnbook, f = V.h.grab(), x = { id: V._edit || undefined, date: f.date, from: f.from, minutes: f.minutes, guests: f.guests, guest: f.guest, phone: f.phone, source: f.source, deposit: f.deposit, occasion: f.occasion, note: f.note, tables: f.tables };
      if (V._edit && f.to && !f.minutes) x.to = f.to;
      vDo(btn, 'vnBookingSave', [JSON.stringify(x)], function (d) { return 'Бронь ' + d.id + ': ' + d.statusRu + (d.seatsWarn ? '. ' + d.seatsWarn : ''); }, function () { V._form = null; V._free = null; V._edit = null; V._day = f.date || V._day; V.h.load(); });
    },
    st: function (a, btn) {
      var V = VIEWS.vnbook, p = String(a).split('|'), reason = '';
      if (p[1] === 'CANCELLED' || p[1] === 'NOSHOW') { reason = prompt(p[1] === 'NOSHOW' ? 'Гости не пришли — комментарий (звонили, не дозвонились…)' : 'Причина отмены'); if (!reason) return; }
      vDo(btn, 'vnBookingStatus', [JSON.stringify({ id: p[0], status: p[1], reason: reason })], function (d) { return 'Бронь: ' + d.statusRu + (d.order ? '. Открыт заказ стола' : ''); }, function (d) { if (d && d.order) openView('vnorder', d.order.id); else V.h.load(); });
    },
    confirmReq: function (a, btn) {
      var t = String((document.getElementById('rq_' + a) || {}).value || '').trim(); if (!t) { vMsg('Укажите стол для заявки', 'err'); return; }
      vDo(btn, 'vnBookingStatus', [JSON.stringify({ id: a, status: 'CONFIRMED', tables: t })], 'Заявка подтверждена — позвоните гостю', function () { VIEWS.vnbook.h.load(); });
    }
  }
};

/* ---------- План зала ---------- */
VIEWS.vnfloor = {
  fns: { saveT: 'vnTableSave' },
  title: 'План зала',
  sub: 'Столы по залам: свободен, бронь в ближайшие 2 часа, гости за столом. Нажмите на стол — заказ или ближайшая бронь.',
  acts: [['Обновить', 'load']],
  open: function () { this.h.load(); vnAuto('vnfloor', 60, function () { VIEWS.vnfloor.h.load(true); }); },
  h: {
    load: function (quiet) { var V = VIEWS.vnfloor; if (!quiet) vLoading(); vCall('vnHallData', [JSON.stringify({})]).then(function (r) { var e = vErr(r); if (e) { if (!quiet) { vMsg(e, 'err'); vBody(''); } return; } V._d = vData(r) || {}; V.h.draw(); }); },
    draw: function () {
      var V = VIEWS.vnfloor, d = V._d || {}, T = d.tables || [], zones = {}, h = '';
      T.forEach(function (t) { (zones[t.zone] = zones[t.zone] || []).push(t); });
      h += vKpis([['Свободно', T.filter(function (t) { return t.state === 'free'; }).length, 'green'], ['Бронь скоро', T.filter(function (t) { return t.state === 'soon'; }).length, 'gold'], ['Гости', T.filter(function (t) { return t.state === 'busy'; }).length, 'wine'],
        ['Мест всего', T.reduce(function (a, t) { return a + t.seats; }, 0)]]);
      h += Object.keys(zones).map(function (z) {
        return vCard(z, '<div class="vnfloor">' + zones[z].map(function (t) {
          return '<button class="vntbl ' + t.state + '" data-mv="pick" data-a="' + esc(t.table) + '"><b>' + esc(t.table) + '</b><small>' + esc(t.seats) + ' мест</small><span>' + esc(t.order ? t.order.waiter + ' · ' + t.order.guests + ' гост.' : t.next ? t.next.from + ' ' + t.next.guest : t.stateRu) + '</span></button>';
        }).join('') + '</div>');
      }).join('') || '<div class="empty">Столов нет.' + (d.can && d.can.manage ? ' Добавьте их ниже.' : ' Добавляет администратор зала.') + '</div>';
      if (d.can && d.can.manage) h += vCard('Столы: добавить или изменить', vForm([['tn', 'Номер стола', 'text', ''], ['tz', 'Зал', 'text', 'Основной зал'], ['ts', 'Мест', 'number', '4'], ['tc', 'Комментарий', 'text', '', 'у окна, диван…'], ['ta', 'Стол в работе', 'check', true]]) +
        '<div class="mvbar">' + vBtn('Сохранить стол', 'saveT', '', true) + '</div><div class="dnote">Тот же номер — изменить стол; снимите «в работе», чтобы убрать стол из плана.</div>');
      vBody(h);
    },
    pick: function (a) {
      var V = VIEWS.vnfloor, t = (V._d.tables || []).filter(function (x) { return x.table === a; })[0]; if (!t) return;
      if (t.order && V._d.can && V._d.can.orders) { openView('vnorder', t.order.id); return; }
      var msg = 'Стол ' + t.table + ' (' + t.zone + ', ' + t.seats + ' мест): ' + t.stateRu + '.' + (t.bookings.length ? ' Брони: ' + t.bookings.map(function (b) { return b.from + '–' + b.to + ' ' + b.guest + ' (' + b.guests + ')'; }).join('; ') : ' Броней сегодня нет.');
      vMsg(msg, 'ok');
      if (V._d.can && V._d.can.manage) { var f = function (k, v) { var e = document.getElementById('mvf_' + k); if (e) { if (e.type === 'checkbox') e.checked = v; else e.value = v; } }; f('tn', t.table); f('tz', t.zone); f('ts', t.seats); }
    },
    saveT: function (a, btn) { vDo(btn, 'vnTableSave', [JSON.stringify({ table: vV('tn'), zone: vV('tz'), seats: vV('ts'), note: vV('tc'), active: vV('ta') })], 'Стол сохранён', function () { VIEWS.vnfloor.h.load(); }); }
  }
};

/* ---------- Стоп/go-лист ---------- */
VIEWS.vnstop = {
  fns: { put: 'vnStopSave', clear: 'vnStopClear', check: 'vnStopSuggest', apply: 'vnStopSave', applyAll: 'vnStopSave' },
  title: 'Стоп/go-лист',
  sub: 'Стоп — позиции нет (официант не добавит её в заказ, у гостя — «нет в наличии»). Лимит — осталось N порций, уменьшается с каждым заказом, кончился — стоп. Go — предложить гостям в первую очередь. Отметки действуют до конца дня, если не указано иное.',
  acts: [['Проверить по складу', 'check'], ['Обновить', 'load']],
  open: function () { this._sug = null; this.h.load(); },
  h: {
    load: function () { var V = VIEWS.vnstop; vLoading(); vCall('vnMenuData', []).then(function (r) { var e = vErr(r); if (e) { vMsg(e, 'err'); vBody(''); return; } V._m = vData(r) || {}; V.h.draw(); }); },
    draw: function () {
      var V = VIEWS.vnstop, M = (V._m && V._m.items) || [], on = M.filter(function (m) { return m.stop; }), h = '';
      var grp = function (st, title, tone) {
        var L = on.filter(function (m) { return m.stop.status === st; }); if (!L.length) return '';
        return vCard(title + ' — ' + L.length, L.map(function (m) { return '<div class="vnstl"><div><b>' + esc(m.name) + '</b> ' + vChip(m.stop.statusRu + (st === 'LIMIT' ? ' ' + m.stop.left : ''), tone) + ' <span class="dnote">' + esc(m.station) + ' · ' + esc(m.stop.reason || '') + '</span></div>' + vBtn('Снять', 'clear', m.code) + '</div>'; }).join(''));
      };
      h += vKpis([['Стоп', on.filter(function (m) { return m.stop.status === 'STOP'; }).length, 'red'], ['Лимит', on.filter(function (m) { return m.stop.status === 'LIMIT'; }).length, 'gold'], ['Go', on.filter(function (m) { return m.stop.status === 'GO'; }).length, 'green'], ['Позиций в меню', M.length]]);
      h += grp('STOP', 'Стоп', 'r') + grp('LIMIT', 'Лимит', 'a') + grp('GO', 'Go — предложить гостям', 'g');
      if (!on.length) h += '<div class="empty">Отметок нет — всё меню в продаже.</div>';
      if (V._sug) {
        var S = (V._sug.stop || []).concat(V._sug.go || []);
        h += vCard('Предложения по складу и срокам — ' + S.length, S.length ? S.map(function (s, i) { return '<div class="vnstl"><div><b>' + esc(s.name) + '</b> ' + vChip({ STOP: 'стоп', LIMIT: 'лимит ' + (s.left || ''), GO: 'go' }[s.status], s.status === 'STOP' ? 'r' : s.status === 'LIMIT' ? 'a' : 'g') + ' <span class="dnote">' + esc(s.reason) + '</span></div>' + vBtn('Применить', 'apply', i) + '</div>'; }).join('') : '<div class="empty">По складу всё в порядке: все позиции можно приготовить, сроки не поджимают.</div>',
          S.length ? vBtn('Применить все', 'applyAll', '', true) : '');
      }
      h += vCard('Поставить отметку', M.length ? vForm([['sc', 'Позиция', 'select', '', M.map(function (m) { return [m.code, m.name + ' — ' + m.station]; })], ['ss', 'Отметка', 'select', 'STOP', [['STOP', 'Стоп — нет в наличии'], ['LIMIT', 'Лимит — осталось N порций'], ['GO', 'Go — предложить гостям']]],
        ['sl', 'Осталось порций (для лимита)', 'number', ''], ['sr', 'Причина', 'text', '', 'закончился сибас, нет поставки…'], ['su', 'Действует', 'select', 'day', [['day', 'до конца дня'], ['none', 'пока не снимут']]]]) + '<div class="mvbar">' + vBtn('Поставить', 'put', '', true) + '</div>' : '<div class="empty">Меню пусто.</div>');
      vBody(h);
    },
    put: function (a, btn) { vDo(btn, 'vnStopSave', [JSON.stringify({ code: vV('sc'), status: vV('ss'), left: vV('sl'), reason: vV('sr'), until: vV('su') })], 'Отметка поставлена — официанты и меню гостей увидят сразу', function () { VIEWS.vnstop.h.load(); }); },
    clear: function (a, btn) { vDo(btn, 'vnStopClear', [JSON.stringify({ codes: [a] })], 'Отметка снята', function () { VIEWS.vnstop.h.load(); }); },
    check: function (a, btn) { var V = VIEWS.vnstop; vMsg('Проверяю склад по ТТК…'); vCall('vnStopSuggest', []).then(function (r) { var e = vErr(r); if (e) { vMsg(e, 'err'); return; } V._sug = vData(r) || {}; vMsg('Проверено: предложений ' + ((V._sug.stop || []).length + (V._sug.go || []).length), 'ok'); V.h.draw(); }); },
    apply: function (a, btn) { var V = VIEWS.vnstop, S = (V._sug.stop || []).concat(V._sug.go || []), s = S[+a]; if (!s) return; vDo(btn, 'vnStopSave', [JSON.stringify({ code: s.code, status: s.status, left: s.left, reason: s.reason })], 'Применено: ' + s.name, function () { S.splice(+a, 1); V._sug = { stop: S.filter(function (x) { return x.status !== 'GO'; }), go: S.filter(function (x) { return x.status === 'GO'; }) }; V.h.load(); }); },
    applyAll: function (a, btn) { var V = VIEWS.vnstop, S = (V._sug.stop || []).concat(V._sug.go || []); vDo(btn, 'vnStopSave', [JSON.stringify({ items: S.map(function (s) { return { code: s.code, status: s.status, left: s.left, reason: s.reason }; }) })], 'Применено предложений: ' + S.length, function () { V._sug = null; V.h.load(); }); }
  }
};

/* ---------- Электронное меню для гостей ---------- */
VIEWS.vnmenu = {
  fns: { saveI: 'vnMenuSave', addSel: 'vnMenuSync', addAll: 'vnMenuSync', addGoods: 'vnMenuSave', media: 'vnMediaAdd', upload: 'vnMediaUpload', mRm: 'vnMediaRemove', mCover: 'vnMediaRemove', saveS: 'vnSettings' },
  title: 'Электронное меню',
  sub: 'Что видит гость по QR-коду: разделы, цены, выход, описание, теги, фото и видео (лента как в Instagram и Reels). Себестоимость и остатки гостю не показываются. Позиции в стопе — «нет в наличии».',
  acts: [['QR-коды', 'qr'], ['Обновить', 'load']],
  open: function () { this.h.load(); },
  h: {
    qr: function () { openView('vnqr'); },
    load: function () { var V = VIEWS.vnmenu; vLoading(); vCall('vnMenuData', []).then(function (r) { var e = vErr(r); if (e) { vMsg(e, 'err'); vBody(''); return; } V._d = vData(r) || {}; V.h.draw(); }); },
    draw: function () {
      var V = VIEWS.vnmenu, d = V._d || {}, M = d.items || [], S = d.settings || {}, h = '';
      h += vKpis([['Позиций', M.length], ['Видят гости', M.filter(function (m) { return m.guest && m.price > 0; }).length, 'green'], ['С фото или видео', M.filter(function (m) { return (m.media || []).length; }).length, 'gold'], ['Без цены', M.filter(function (m) { return !(m.price > 0); }).length, M.some(function (m) { return !(m.price > 0); }) ? 'red' : 'green']]);
      var bySec = {}; M.forEach(function (m) { (bySec[m.section] = bySec[m.section] || []).push(m); });
      h += Object.keys(bySec).map(function (s) {
        return vCard(s + ' — ' + bySec[s].length, bySec[s].map(function (m) {
          var md = m.media || [];
          return '<details class="vnmi"><summary><span class="vnth">' + (md[0] && md[0].type === 'photo' ? '<img src="' + esc(md[0].src) + '" alt="">' : md[0] ? '▶' : '—') + '</span><b>' + esc(m.name) + '</b> <span class="dnote">' + (m.price > 0 ? vnMoney(m.price) + (m.byWeight ? '/' + m.per + ' ' + esc(m.yieldUnit) : '') : 'без цены') + ' · ' + esc(m.station) + (m.guest ? '' : ' · скрыто от гостей') + ' · медиа: ' + md.length + '</span>' + (m.stop ? ' ' + vChip(m.stop.statusRu, m.stop.status === 'STOP' ? 'r' : m.stop.status === 'GO' ? 'g' : 'a') : '') + '</summary>' +
            '<div class="vnmf" data-c="' + esc(m.code) + '">' +
            '<label>Цена, ₽<input data-k="price" type="number" step="any" value="' + esc(m.price) + '"></label><label>Раздел<input data-k="section" value="' + esc(m.section) + '"></label>' +
            '<label>Станция<select data-k="station"><option' + (m.station === 'Кухня' ? ' selected' : '') + '>Кухня</option><option' + (m.station === 'Бар' ? ' selected' : '') + '>Бар</option></select></label>' +
            '<label>Выход<input data-k="yield" type="number" step="any" value="' + esc(m.yield || '') + '"></label><label>Ед.<input data-k="yieldUnit" value="' + esc(m.yieldUnit) + '" style="width:60px"></label>' +
            '<label>Порядок<input data-k="order" type="number" value="' + esc(m.order) + '" style="width:70px"></label>' +
            '<label class="vnck"><input data-k="byWeight" type="checkbox"' + (m.byWeight ? ' checked' : '') + '> по весу, цена за <input data-k="per" type="number" value="' + esc(m.per || 100) + '" style="width:64px"> ' + esc(m.yieldUnit) + '</label>' +
            '<label class="vnck"><input data-k="guest" type="checkbox"' + (m.guest ? ' checked' : '') + '> показывать гостям</label>' +
            '<label class="vnwide">Описание для гостя<textarea data-k="desc" rows="2">' + esc(m.desc) + '</textarea></label><label class="vnwide">Теги через запятую<input data-k="tags" value="' + esc((m.tags || []).join(', ')) + '" placeholder="хит, новинка, острое, вегетарианское"></label>' +
            '<div class="mvbar vnwide">' + vBtn('Сохранить', 'saveI', m.code, true) + '</div>' +
            '<div class="vnwide vnmedia">' + md.map(function (x, i) {
              return '<div class="vnmd">' + (x.type === 'photo' ? '<img src="' + esc(x.src) + '" alt="">' : '<span>' + (x.type === 'video' ? '🎬 видео' : '▶ ' + esc(x.kind || 'плеер')) + '</span>') + (i ? vBtn('обложка', 'mCover', m.code + '|' + i) : '<i class="chip g">обложка</i>') + vBtn('✕', 'mRm', m.code + '|' + i) + (x.warn ? '<div class="dnote">' + esc(x.warn) + '</div>' : '') + '</div>';
            }).join('') + '</div>' +
            '<div class="vnwide vnaddm"><input data-k="url" placeholder="Ссылка на фото или видео: Google Диск, YouTube Shorts, Rutube, VK, mp4, jpg"> <select data-k="mtype"><option value="">авто</option><option value="photo">фото</option><option value="video">видео</option></select> ' + vBtn('Добавить ссылку', 'media', m.code) +
            '<label class="btn">Загрузить файл<input type="file" accept="image/*,video/*" data-up="' + esc(m.code) + '" hidden></label></div></div></details>';
        }).join(''));
      }).join('') || '<div class="empty">Меню пусто — добавьте блюда из ТТК ниже.</div>';
      var N = d.notInMenu || [];
      if (N.length) h += vCard('Блюда ТТК, которых нет в меню — ' + N.length, '<div class="vnadd">' + N.map(function (x) { return '<label><input type="checkbox" class="vnadd_c" value="' + esc(x.code) + '"> ' + esc(x.name) + ' <small>' + esc(x.section) + ' · ' + esc(x.station) + (x.price ? ' · ' + vnMoney(x.price) : '') + '</small></label>'; }).join('') + '</div>',
        vBtn('Добавить выбранные', 'addSel', '', true) + ' ' + vBtn('Добавить все', 'addAll'));
      h += vCard('Товар без ТТК (вино, вода, покупной десерт)', vForm([['gn', 'Название — как на складе', 'text', ''], ['gs', 'Раздел', 'text', 'Напитки'], ['gst', 'Станция', 'select', 'Бар', ['Бар', 'Кухня']], ['gp', 'Цена, ₽', 'number', ''], ['gy', 'Порция', 'number', '1'], ['gu', 'Ед. порции', 'select', 'шт', ['шт', 'мл', 'г']]]) +
        '<div class="mvbar">' + vBtn('Добавить товар', 'addGoods', '', true) + '</div><div class="dnote">Порция 150 мл — бокал вина: при закрытии счёта со склада спишется 150 мл бутылки. «шт» — бутылка или упаковка целиком.</div>');
      h += vCard('Страница для гостей', vForm([['sn', 'Название', 'text', S.name], ['ssub', 'Подпись', 'text', S.subtitle], ['sph', 'Телефон', 'tel', S.phone], ['sad', 'Адрес', 'text', S.address], ['so', 'Открытие', 'time', S.open], ['scl', 'Закрытие', 'time', S.close],
        ['sbm', 'Бронь, мин по умолчанию', 'number', S.bookDur], ['scm', 'Норма приготовления, мин', 'number', S.serviceTime], ['sgb', 'Заявки на бронь с QR-меню', 'check', S.guestBooking], ['shs', 'Скрывать позиции в стопе', 'check', S.hideStop]]) + '<div class="mvbar">' + vBtn('Сохранить настройки', 'saveS', '', true) + '</div>');
      vBody(h);
      [].forEach.call(document.querySelectorAll('input[data-up]'), function (inp) { inp.onchange = function () { VIEWS.vnmenu.h.upload(inp.getAttribute('data-up'), inp); }; });
    },
    val: function (code, k) { var box = document.querySelector('.vnmf[data-c="' + code + '"]'), e = box && box.querySelector('[data-k="' + k + '"]'); return !e ? undefined : e.type === 'checkbox' ? e.checked : e.value; },
    saveI: function (a, btn) {
      var g = function (k) { return VIEWS.vnmenu.h.val(a, k); };
      vDo(btn, 'vnMenuSave', [JSON.stringify({ items: [{ code: a, price: g('price'), section: g('section'), station: g('station'), yield: g('yield'), yieldUnit: g('yieldUnit'), order: g('order'), byWeight: g('byWeight'), per: g('per'), guest: g('guest'), desc: g('desc'), tags: g('tags') }] })], 'Сохранено', function () { VIEWS.vnmenu.h.load(); });
    },
    addSel: function (a, btn) { var c = [].map.call(document.querySelectorAll('.vnadd_c:checked'), function (x) { return x.value; }); if (!c.length) { vMsg('Отметьте блюда', 'err'); return; } vDo(btn, 'vnMenuSync', [JSON.stringify({ codes: c })], function (d) { return 'Добавлено в меню: ' + d.added; }, function () { VIEWS.vnmenu.h.load(); }); },
    addAll: function (a, btn) { vDo(btn, 'vnMenuSync', [JSON.stringify({ all: true })], function (d) { return 'Добавлено в меню: ' + d.added; }, function () { VIEWS.vnmenu.h.load(); }); },
    addGoods: function (a, btn) { vDo(btn, 'vnMenuSave', [JSON.stringify({ items: [{ code: 'G-' + Date.now().toString(36).toUpperCase(), kind: 'GOODS', name: vV('gn'), section: vV('gs'), station: vV('gst'), price: vV('gp'), yield: vV('gy'), yieldUnit: vV('gu') }] })], 'Товар добавлен в меню', function () { VIEWS.vnmenu.h.load(); }); },
    media: function (a, btn) { var u = VIEWS.vnmenu.h.val(a, 'url'), t = VIEWS.vnmenu.h.val(a, 'mtype'); if (!u) { vMsg('Вставьте ссылку', 'err'); return; } vDo(btn, 'vnMediaAdd', [JSON.stringify({ code: a, url: u, type: t })], 'Добавлено', function () { VIEWS.vnmenu.h.load(); }); },
    upload: function (code, inp) {
      var f = inp.files && inp.files[0]; if (!f) return;
      if (f.size > 40 * 1024 * 1024) { vMsg('Файл больше 40 МБ — загрузите видео на Google Диск или YouTube и добавьте ссылкой', 'err'); return; }
      vMsg('Загружаю ' + f.name + '…');
      var rd = new FileReader(); rd.onload = function () { vDo(null, 'vnMediaUpload', [JSON.stringify({ code: code, name: f.name, mime: f.type, b64: String(rd.result) })], function (d) { return 'Загружено' + (d.warn ? '. ' + d.warn : ''); }, function () { VIEWS.vnmenu.h.load(); }); };
      rd.readAsDataURL(f);
    },
    mRm: function (a, btn) { var p = String(a).split('|'); vDo(btn, 'vnMediaRemove', [JSON.stringify({ code: p[0], index: +p[1] })], 'Убрано из ленты (файл на Диске остался)', function () { VIEWS.vnmenu.h.load(); }); },
    mCover: function (a, btn) { var p = String(a).split('|'); vDo(btn, 'vnMediaRemove', [JSON.stringify({ code: p[0], index: +p[1], cover: true })], 'Обложка изменена', function () { VIEWS.vnmenu.h.load(); }); },
    saveS: function (a, btn) { vDo(btn, 'vnSettings', [JSON.stringify({ name: vV('sn'), subtitle: vV('ssub'), phone: vV('sph'), address: vV('sad'), open: vV('so'), close: vV('scl'), bookMin: vV('sbm'), cookMin: vV('scm'), guestBooking: vV('sgb'), hideStop: vV('shs') })], 'Настройки сохранены', function () { VIEWS.vnmenu.h.load(); }); }
  }
};

/* ---------- QR-коды меню ---------- */
VIEWS.vnqr = {
  title: 'QR-коды меню',
  sub: 'Общий QR для входа и витрины и отдельный QR на каждый стол (гость видит номер стола, заявка на бронь помечается столом). Распечатайте и поставьте на столы.',
  acts: [['Печать', 'print'], ['Обновить', 'load']],
  open: function () { this.h.load(); },
  h: {
    load: function () { var V = VIEWS.vnqr; vLoading(); vCall('vnQrData', []).then(function (r) { var e = vErr(r); if (e) { vMsg(e, 'err'); vBody(''); return; } V._d = vData(r) || {}; V.h.draw(); }); },
    draw: function () {
      var d = VIEWS.vnqr._d || {}, base = d.menuUrl || '';
      if (!base) { vBody('<div class="empty">Адрес веб-приложения неизвестен: QR появится после публикации (установщик публикует веб-приложение сам).</div>'); return; }
      var L = [{ t: '', l: 'Меню — общий' }].concat((d.tables || []).map(function (t) { return { t: t.table, l: 'Стол ' + t.table }; }));
      vBody('<div class="dnote">Адрес меню: <a href="' + esc(base) + '" target="_blank" rel="noopener">' + esc(base) + '</a></div><div class="vnqrs" id="vnqrs">' + L.map(function (x, i) {
        return '<div class="vnqr"><div class="vnqrn">' + esc((d.settings || {}).name || 'VINOVNIK') + '</div><div class="vnqrc" id="qr_' + i + '" data-u="' + esc(base + (x.t ? '&t=' + encodeURIComponent(x.t) : '')) + '"></div><b>' + esc(x.l) + '</b><small>Наведите камеру — меню, фото и видео блюд, бронь стола</small></div>';
      }).join('') + '</div>');
      VIEWS.vnqr.h.render();
    },
    render: function () {
      var go = function () { [].forEach.call(document.querySelectorAll('.vnqrc'), function (el) { el.innerHTML = ''; try { new QRCode(el, { text: el.getAttribute('data-u'), width: 168, height: 168, colorDark: '#4a0c17', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M }); } catch (e) { el.innerHTML = '<a href="' + esc(el.getAttribute('data-u')) + '">ссылка</a>'; } }); };
      if (window.QRCode) { go(); return; }
      var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = go; s.onerror = function () { [].forEach.call(document.querySelectorAll('.vnqrc'), function (el) { el.innerHTML = '<div class="dnote">QR не построен (нет связи с библиотекой) — ссылка: <a href="' + esc(el.getAttribute('data-u')) + '">открыть</a></div>'; }); };
      document.head.appendChild(s);
    },
    print: function () { document.body.classList.add('vnprint'); setTimeout(function () { window.print(); document.body.classList.remove('vnprint'); }, 100); }
  }
};
