/**
 * MON CHEF V101 — Restaurant Service: роли и права зала.
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Как V92: роли и права добавляются в карты MonChef_Rbac.gs при загрузке, ядро ролей не переписывается.
 *  • «Администратор» (существующая роль — администратор зала: банкеты) получает зал, бронирование и настройку зала;
 *  • «Официант» — новая роль: схема зала, каталог блюд (просмотр); бронирование — индивидуальным правом от директора;
 *  • «Директор» — все права зала;
 *  • «Администратор площадки» и «Руководитель смены» (V92) — права зала выдаёт директор индивидуально.
 * Роли бармена и менеджера бара добавляются на этапе 6 (бар).
 */
var MC_RS_PERMS_ = [
  ['hall_view', 'Зал — схема зала, столы и бронирования (просмотр)', 'Зал'],
  ['booking', 'Бронирование — создание, изменение, статусы, предзаказ', 'Зал'],
  ['hall_manage', 'Зал — настройка залов и столов, досдача незавершённых операций', 'Зал']
];
var MC_RS_ROLES_NEW_ = ['Официант'];
var MC_RS_MATRIX_ADD_ = {
  'Директор': ['hall_view', 'booking', 'hall_manage'],
  'Администратор': ['hall_view', 'booking', 'hall_manage', 'catalog'],
  'Официант': ['hall_view', 'catalog']
};

(function () {
  try { MC_RS_PERMS_.forEach(function (p) { if (!MC_RB_PERMS_.some(function (x) { return x[0] === p[0]; })) MC_RB_PERMS_.push(p); }); } catch (e) {}
  try { MC_RS_ROLES_NEW_.forEach(function (r) { if (MC_RB_ROLES_.indexOf(r) < 0) MC_RB_ROLES_.push(r); if (typeof MC_ROLES !== 'undefined' && MC_ROLES.indexOf(r) < 0) MC_ROLES.push(r); }); } catch (e) {}
  try {
    Object.keys(MC_RS_MATRIX_ADD_).forEach(function (role) {
      var a = MC_RB_MATRIX_[role] || (MC_RB_MATRIX_[role] = []);
      MC_RS_MATRIX_ADD_[role].forEach(function (k) { if (a.indexOf(k) < 0) a.push(k); });
    });
  } catch (e) {}
  var grant = function (perm, roles) { try { var a = MC_RB_GRANTABLE_[perm] || (MC_RB_GRANTABLE_[perm] = []); roles.forEach(function (r) { if (a.indexOf(r) < 0) a.push(r); }); } catch (e) {} };
  grant('booking', ['Официант', 'Администратор площадки', 'Руководитель смены']);
  grant('hall_view', ['Администратор площадки', 'Руководитель смены', 'Шеф-повар', 'Су-шеф']);
  grant('hall_manage', ['Администратор площадки']);
  // раздел главного окна и страница
  try { MC_RB_SECTIONS_.hall = 'hall_view|booking|hall_manage'; } catch (e) {}
  try { MC_RB_MODULES_.hall = 'hall_view|booking|hall_manage'; MC_RB_MODULE_RU_.hall = 'Зал и бронирование'; } catch (e) {}
})();
