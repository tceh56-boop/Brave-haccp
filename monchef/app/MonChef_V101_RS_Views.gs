/**
 * MON CHEF V101 — Restaurant Service внутри главного окна (единый интерфейс).
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Экраны «Зал и бронирование», «Кухня и бар», «Гостевое меню — редактор», «Редактор ролей» — экраны главного окна (Console.html,
 *   VIEWS.hall / kds / menuedit / roles), как остальные модули MON CHEF. Главное окно получает разметку экрана один раз за сеанс
 *   (rsViewSource) и монтирует её в изолированный блок (Shadow DOM): стили и функции экрана не пересекаются с главным окном.
 * Старые адреса ?hall=1, ?kds=1, ?menuedit=1, ?roles=1 открывают главное окно сразу на нужном экране (MC_UI_VIEWS_).
 * Гостевое меню (?menu=1) остаётся отдельной страницей: его открывает гость по QR без входа.
 */
var MC_RS_VIEW_FILES_ = { hall: 'Hall', kds: 'Kds', menuedit: 'MenuEditor', roles: 'Roles' };

(function () {
  try { Object.keys(MC_RS_VIEW_FILES_).forEach(function (v) { if (MC_UI_VIEWS_.indexOf(v) < 0) MC_UI_VIEWS_ = MC_UI_VIEWS_.concat([v]); }); } catch (e) {}
})();

/** Разметка экрана для главного окна: {name} → {name, src, map}. map — где у серверных функций экрана ключ входа (как у страниц). */
function rsViewSource(json, token) {
  var d = _rsJ_(json, {}) || {}, name = String(d.name || ''), file = MC_RS_VIEW_FILES_[name];
  if (!file) return _rsFail_(new Error('VALIDATION: нет такого экрана'), null);
  return _rsRead_(token, MC_RB_MODULES_[name], function () {
    var src = HtmlService.createHtmlOutputFromFile(file).getContent();
    return { name: name, src: src, map: _mcTokenArgMap_(src) };
  });
}

MC_GATE_EXT_.rsViewSource = { need: 'hall_view|booking|hall_manage|kitchen_queue|bar_queue|stopgo_view|stopgo_kitchen|stopgo_bar|menu_publish|roles_edit' };
