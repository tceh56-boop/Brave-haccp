/**
 * MON CHEF V101 — Restaurant Service: раздел «Зал» главного окна.
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Раздел только показывает данные модуля бронирования и ведёт на страницу «Зал и бронирование» (?hall=1).
 * Файл загружается после MonChef_UISections.gs (там переобъявляется UI_SECTIONS).
 */
(function () {
  try { if (UI_SECTIONS.indexOf('hall') < 0) UI_SECTIONS.push('hall'); } catch (e) {}
  try {
    _UI_BUILDERS_.hall = function (token, opts, s) {
      var today = _rsToday_(), now = _rsAbsMin_(today, _rsNowHm_()), tidx = _uiTry_(_rsTablesIdx_, {});
      var list = _uiTry_(function () { return _rsBookingsBetween_('', _rsAbsMin_(today, '00:00'), _rsAbsMin_(today, '00:00') + 8 * 24 * 60); }, []);
      var act = list.filter(function (b) { return MC_RS_BK_FINAL_.indexOf(b.status) < 0; });
      var td = act.filter(function (b) { return b.date === today; }).sort(function (a, b) { return a.startAbs - b.startAbs; });
      var row = function (b) {
        return { date: b.date.split('-').reverse().join('.'), time: b.start + '–' + b.end, guest: b.guest, guests: b.guests,
          tables: b.tables.map(function (t) { return tidx[t] ? tidx[t].number : '?'; }).join(', ') || '—', status: MC_RS_BK_RU_[b.status] || b.status };
      };
      var cols = [_uiCol_('date', 'Дата'), _uiCol_('time', 'Время'), _uiCol_('guest', 'Гость'), _uiCol_('guests', 'Гостей', 'num'), _uiCol_('tables', 'Столы'), _uiCol_('status', 'Статус', 'status')];
      return {
        title: 'Зал', subtitle: 'Схема зала, бронирование гостей и предзаказ. Предзаказ — не продажа: склад не списывается.',
        kpis: [
          { label: 'Брони сегодня', value: td.length, hint: td.reduce(function (n, b) { return n + b.guests; }, 0) + ' гостей', tone: 'gold' },
          { label: 'Скоро', value: td.filter(function (b) { return b.startAbs >= now && b.startAbs - now <= 120 && MC_RS_BK_BLOCK_.indexOf(b.status) >= 0; }).length, hint: 'в ближайшие 2 часа', tone: 'wine' },
          { label: 'Лист ожидания', value: act.filter(function (b) { return b.status === 'WAITING'; }).length, hint: 'на неделю' },
          { label: 'На 7 дней', value: act.filter(function (b) { return b.date > today; }).length, hint: 'предстоящих броней' }
        ],
        tabs: [{ title: 'Сегодня', columns: cols, rows: td.map(row) },
          { title: 'Неделя', columns: cols, rows: act.filter(function (b) { return b.date > today; }).sort(function (a, b) { return a.startAbs - b.startAbs; }).map(row) }],
        actions: [{ label: 'Зал и бронирование', module: 'hall' }].concat(s && _mcRbHasExact_(s, 'menu_publish') ? [{ label: 'Гостевое меню', module: 'menuedit' }] : []).concat(s && _mcRbHasExact_(s, 'kitchen_queue|bar_queue|stopgo_kitchen|stopgo_bar') ? [{ label: 'Кухня, бар и Stop/Go', module: 'kds' }] : [])
      };
    };
  } catch (e) {}
  // ссылки в разделах главного окна (как V97): редактор ролей — «Настройки» и «Персонал», гостевое меню — «Меню и ТТК»
  try {
    var sec = function (k, btn, need) { var orig = _UI_BUILDERS_[k]; if (typeof orig !== 'function') return; _UI_BUILDERS_[k] = function (token, opts, s) { var r = orig(token, opts, s) || {}; if (!s || _mcRbHasExact_(s, need)) r.actions = (r.actions || []).concat([btn]); return r; }; };
    sec('settings', { label: 'Редактор ролей', module: 'roles' }, 'roles_edit');
    sec('personnel', { label: 'Редактор ролей', module: 'roles' }, 'roles_edit');
    sec('menu', { label: 'Гостевое меню (Reels)', module: 'menuedit' }, 'menu_publish');
    sec('production', { label: 'Экран кухни и бара, Stop/Go', module: 'kds' }, 'kitchen_queue|bar_queue|stopgo_kitchen|stopgo_bar');
  } catch (e) {}
})();
