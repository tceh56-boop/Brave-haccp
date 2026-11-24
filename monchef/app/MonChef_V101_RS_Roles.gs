/**
 * MON CHEF V101 — Restaurant Service: роли и права зала.
 *
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович.
 *
 * Как V92: роли и права добавляются в карты MonChef_Rbac.gs при загрузке, ядро ролей не переписывается.
 *  • «Администратор» (существующая роль — администратор зала: банкеты) получает зал, бронирование и настройку зала;
 *  • «Официант» — новая роль: схема зала, каталог, свои заказы, отправка на кухню и в бар, разделение счёта;
 *    бронирование и подтверждение оплаты — индивидуальным правом от директора;
 *  • «Директор» — все права зала;
 *  • «Администратор площадки» и «Руководитель смены» (V92) — права зала выдаёт директор индивидуально.
 * Роли бармена и менеджера бара добавляются на этапе 6 (бар).
 */
var MC_RS_PERMS_ = [
  ['hall_view', 'Зал — схема зала, столы и бронирования (просмотр)', 'Зал'],
  ['booking', 'Бронирование — создание, изменение, статусы, предзаказ', 'Зал'],
  ['hall_manage', 'Зал — настройка залов и столов, курсы, досдача незавершённых операций', 'Зал'],
  ['order_edit', 'Заказ зала — открыть стол, добавить и изменить блюда (свои заказы)', 'Зал'],
  ['order_send', 'Заказ зала — отправить на кухню и в бар, команда «следующий курс»', 'Зал'],
  ['order_all', 'Заказы зала — все официанты: перенос стола, смена официанта, закрытие, отмена', 'Зал'],
  ['bill_split', 'Внутренние счета — разделить, объединить, перенести позиции', 'Зал'],
  ['discount', 'Скидка и сервисный сбор в счёте (вручную, с причиной)', 'Зал'],
  ['payment_confirm', 'Подтверждение оплаты счёта (по кассе; сверка с Z-отчётом)', 'Зал'],
  ['menu_publish', 'Гостевое меню — фото, видео, GIF, описания, публикация, заказ гостей по QR', 'Зал'],
  ['roles_edit', 'Редактор ролей — права ролей и новые роли (с причиной, в аудите)', 'Персонал'],
  ['kitchen_queue', 'Экран кухни — принять, готовить, готово, выдано, проблема, отмена с расходом', 'Производство'],
  ['bar_queue', 'Экран бара — те же действия для барных заданий', 'Производство'],
  ['stopgo_view', 'Stop/Go — просмотр (зал)', 'Производство'],
  ['stopgo_kitchen', 'Stop/Go кухни — поставить STOP / LIMITED / проверку, вернуть GO', 'Производство'],
  ['stopgo_bar', 'Stop/Go бара — поставить STOP / LIMITED / проверку, вернуть GO', 'Производство'],
  ['stopgo_approve', 'Stop/Go — снять «на проверке» (решение ответственного)', 'Производство'],
  ['shop_meat', 'Задания мясного цеха', 'Производство'],
  ['shop_fish', 'Задания рыбного цеха', 'Производство'],
  ['shop_veg', 'Задания овощного цеха', 'Производство'],
  ['shop_prep', 'Задания заготовочного цеха', 'Производство'],
  ['shop_bar', 'Задания и заготовки бара (цех «Бар»)', 'Производство'],
  ['bar_manage', 'Бар — рецептуры (просмотр с технологией), заготовки, контроль барменов', 'Производство']
];
var MC_RS_ROLES_NEW_ = ['Официант', 'Бармен', 'Менеджер бара'];
var MC_RS_MATRIX_ADD_ = {
  'Директор': ['hall_view', 'booking', 'hall_manage', 'order_edit', 'order_send', 'order_all', 'bill_split', 'discount', 'payment_confirm', 'menu_publish', 'roles_edit'],
  'Администратор': ['hall_view', 'booking', 'hall_manage', 'catalog', 'order_edit', 'order_send', 'order_all', 'bill_split', 'discount', 'payment_confirm', 'menu_publish'],
  'Официант': ['hall_view', 'catalog', 'order_edit', 'order_send', 'bill_split', 'stopgo_view'],
  'Шеф-повар': ['kitchen_queue', 'stopgo_kitchen', 'stopgo_approve', 'stopgo_view', 'hall_view'],
  'Су-шеф': ['kitchen_queue', 'stopgo_kitchen', 'stopgo_approve', 'stopgo_view', 'hall_view'],
  'Повар горячего цеха': ['kitchen_queue', 'stopgo_kitchen', 'stopgo_view'],
  'Повар холодного цеха': ['kitchen_queue', 'stopgo_kitchen', 'stopgo_view'],
  'Повар': ['kitchen_queue', 'stopgo_kitchen', 'stopgo_view'],
  'Кондитер': ['kitchen_queue', 'stopgo_kitchen', 'stopgo_view'],
  // ТЗ §8.1: бармен — барное меню, барные задания, свои заготовки и партии, барные остатки (просмотр), Stop/Go бара.
  // Запрещено по умолчанию: закупочные цены и себестоимость (costs), утверждение ТТК, финансы, сотрудники.
  'Бармен': ['catalog', 'bar_queue', 'shop_bar', 'kanban', 'batch_use', 'stock_view', 'labels', 'stopgo_bar', 'stopgo_view', 'checklists'],
  // ТЗ §8.2: менеджер бара — бармен + распределение заданий, доступность, заготовки, подтверждение производства, рецептуры
  'Менеджер бара': ['catalog', 'bar_queue', 'shop_bar', 'kanban', 'batch_use', 'stock_view', 'labels', 'stopgo_bar', 'stopgo_view', 'checklists',
    'bar_manage', 'prod_manage', 'plan', 'stock', 'stopgo_approve', 'ttk_history', 'hall_view']
};
['kitchen_queue', 'bar_queue', 'stopgo_view', 'stopgo_kitchen', 'stopgo_bar', 'stopgo_approve', 'bar_manage'].forEach(function (k) { MC_RS_MATRIX_ADD_['Директор'].push(k); });
MC_RS_MATRIX_ADD_['Администратор'].push('stopgo_view');

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
  grant('payment_confirm', ['Официант', 'Кассир', 'Руководитель смены', 'Администратор площадки']);
  grant('discount', ['Руководитель смены', 'Администратор площадки']);
  grant('order_all', ['Руководитель смены', 'Администратор площадки']);
  grant('order_edit', ['Руководитель смены', 'Администратор площадки']);
  grant('menu_publish', ['Шеф-повар', 'Су-шеф', 'Администратор площадки']);
  grant('bar_queue', ['Администратор', 'Руководитель смены']); grant('stopgo_bar', ['Администратор', 'Руководитель смены']);
  grant('costs', ['Менеджер бара']); grant('receiving', ['Бармен', 'Менеджер бара']); grant('procurement', ['Менеджер бара']);   // себестоимость бара — по праву от директора (§8.2)
  // бармен и менеджер бара работают с продуктами — медицинский допуск, цех «Бар»
  try { ['Бармен', 'Менеджер бара'].forEach(function (r) { if (MC_FOOD_ROLES_.indexOf(r) < 0) MC_FOOD_ROLES_.push(r); }); } catch (e) {}
  try { MC_RB_SHOPS_['Бармен'] = ['Бар']; MC_RB_SHOPS_['Менеджер бара'] = ['Бар']; } catch (e) {}
  grant('kitchen_queue', ['Руководитель смены']); grant('stopgo_approve', ['Руководитель смены']);
  ['shop_meat', 'shop_fish', 'shop_veg', 'shop_prep'].forEach(function (k) { grant(k, ['Повар горячего цеха', 'Повар холодного цеха', 'Повар', 'Кондитер']); });
  // работа с продуктами на кухне и в баре — только с медицинским допуском (как журналы и производство)
  try { ['kitchen_queue', 'bar_queue'].forEach(function (k) { if (MC_GATE_MED_PERMS_.indexOf(k) < 0) MC_GATE_MED_PERMS_.push(k); }); } catch (e) {}
  // раздел главного окна и страница
  try { MC_RB_SECTIONS_.hall = 'hall_view|booking|hall_manage'; } catch (e) {}
  try { MC_RB_MODULES_.hall = 'hall_view|booking|hall_manage'; MC_RB_MODULE_RU_.hall = 'Зал и бронирование'; } catch (e) {}
  try { MC_RB_MODULES_.menuedit = 'menu_publish'; MC_RB_MODULE_RU_.menuedit = 'Гостевое меню — редактор'; } catch (e) {}
  try { MC_RB_MODULES_.roles = 'roles_edit'; MC_RB_MODULE_RU_.roles = 'Редактор ролей'; } catch (e) {}
  try { MC_RB_MODULES_.kds = 'kitchen_queue|bar_queue|stopgo_view|stopgo_kitchen|stopgo_bar'; MC_RB_MODULE_RU_.kds = 'Кухня, бар и Stop/Go'; } catch (e) {}
})();
