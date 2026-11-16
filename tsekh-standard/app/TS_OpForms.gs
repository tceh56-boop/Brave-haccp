/**
 * ЦЕХ Стандарт — формы первичных документов общественного питания (унифицированные формы ОП,
 * постановление Госкомстата России от 25.12.1998 № 132).
 *
 * Полный перечень ОП-1…ОП-25 с форматами листов (А4, А4 альбомный, А3 альбомный, разворот 2×А4 альбомных) — TS_OP_FORMS_,
 * печатный перечень — tsOpCatalog. Формы заполняются из данных системы, где они есть:
 *   продажи за день — ОП-10, 11, 12, план по продажам прошлой недели — ОП-2, расход по нормам ТТК — ОП-13 (специи и соль), ОП-17;
 *   состав ТТК — ОП-1 (калькуляция), ОП-25 (потребность в сырье); остатки склада — ОП-16, 18; сотрудники — ОП-21;
 *   разделка — ОП-23; опись требований ОП-3 — ОП-7; движение изделий по продажам за период — ОП-24.
 *   Остальные (ОП-3, 4, 5, 6, 8, 9, 14, 15, 19, 20, 22) заполняются вручную с подсказками и подстановкой цен.
 *
 * Что подставляется само:
 *   • организация, ОКПО, структурное подразделение, руководитель для «Утверждаю» — из «Настройки → Организация»
 *     (подразделение можно сменить в документе, например «Горячий цех» или «Буфет»);
 *   • строки — из данных системы: продажи (Ж_Продажи), остатки склада (Склад_Остатки), сотрудники, акты разбора,
 *     ранее составленные требования (для описи ОП-7);
 *   • цены: учётная цена товара — средняя цена склада; цена продажи блюда — «Цены_Меню» (меню, договор банкета),
 *     иначе цена из продажи; учётная цена блюда — нормативная себестоимость порции по действующей ТТК.
 *     Цены нет — строка помечается «нет цены», ноль молча не ставится. Суммы и итог прописью считает сервер.
 * Логотипов и названий сторонних организаций в формах нет: печатается только то, что задано в настройках клиента.
 */
var TS_OP_SHEET_ = 'Формы_ОП';
var TS_OP_HEAD_ = ['Номер', 'Форма', 'Дата', 'Подразделение', 'Данные', 'Сумма', 'Составил', 'Создано'];
var TS_OP_OKEI_ = { 'г': '163', 'кг': '166', 'мл': '111', 'л': '112', 'шт': '796', 'порц': '639', 'упак': '778' };

// cols: [ключ, заголовок, тип] — тип: text | num (количество) | money (цена/сумма, считается) | auto (служебное) | calc (считается по calc)
// format: формат листа из перечня форм — A4 (книжный), A4L (альбомный), A3L (А3 альбомный), 2A4L (разворот из двух листов А4 альбомных)
// calc: { поле: { of: [[поле, знак], …], need: 'поле' } } — поле = сумма полей со знаком; need — пустое, пока не заполнено это поле
// period: даты «с … по …» (params from/to); qtyOptional: количество может быть 0 (ведомости движения); dropEmpty: строки без количества не сохраняются
var TS_OP_FORMATS_ = {
  A4: { label: 'А4', page: 'A4 portrait', width: 760 },
  A4L: { label: 'А4 альбомный', page: 'A4 landscape', width: 1060 },
  A3L: { label: 'А3 альбомный', page: 'A3 landscape', width: 1520 },
  '2A4L': { label: '2 листа А4 альбомных (разворот)', page: 'A4 landscape', width: 1060, split: true }
};
var TS_OP_MOVE_ = { qty: { of: [['open', 1], ['in', 1], ['out', -1]] } };
var TS_OP_FORMS_ = {
  OP1: { code: 'ОП-1', okud: '0330501', title: 'Калькуляционная карточка', format: 'A4L', source: 'ttk', approve: true, params: ['date', 'division', 'dish', 'portions'],
    paramLabels: { dish: 'Блюдо (изделие) по ТТК', portions: 'Количество порций' },
    help: 'Состав блюда по действующей ТТК на указанное число порций, цены продуктов — средние цены склада. В итоге — себестоимость порции, цена продажи из меню и наценка.',
    cols: [['name', 'Продукт, наименование', 'text'], ['code', 'Код', 'text'], ['unit', 'Ед. изм.', 'text'], ['qty', 'Норма закладки', 'num'],
      ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма, руб. коп.', 'money']],
    signs: ['Заведующий производством', 'Калькуляцию составил', 'Бухгалтер'] },
  OP2: { code: 'ОП-2', okud: '0330502', title: 'План-меню', format: 'A4', source: 'plan', approve: true, dropEmpty: true, qtyTotal: true, params: ['date', 'division'],
    help: 'План выпуска блюд на день. Заполняется по продажам того же дня недели неделю назад; количество можно поправить, блюда без количества в план не попадут.',
    cols: [['name', 'Блюдо, наименование', 'text'], ['code', '№ ТТК', 'text'], ['qty', 'Количество, порц.', 'num'], ['salePrice', 'Цена продажи', 'money'], ['saleSum', 'Сумма, руб. коп.', 'money']],
    signs: ['Заведующий производством', 'Калькулятор', 'Бухгалтер'] },
  OP3: { code: 'ОП-3', okud: '0330503', title: 'Требование в кладовую', format: 'A4', source: 'stock', approve: false, params: ['date', 'division', 'recipient'],
    help: 'Товары, которые кухня берёт из кладовой. Наименование выбирается из склада, цена — средняя учётная цена склада.',
    cols: [['name', 'Товар, наименование', 'text'], ['code', 'Код', 'text'], ['unit', 'Ед. изм.', 'text'], ['okei', 'Код по ОКЕИ', 'auto'],
      ['qtyReq', 'Затребовано', 'num'], ['qty', 'Отпущено', 'num'], ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма, руб. коп.', 'money']],
    signs: ['Затребовал', 'Разрешил', 'Отпустил', 'Получил'] },
  OP4: { code: 'ОП-4', okud: '0330504', title: 'Накладная на отпуск товара', format: 'A4L', source: 'stock', approve: false, params: ['date', 'division', 'recipient'],
    paramLabels: { recipient: 'Получатель (кому отпущено)' },
    help: 'Отпуск товаров из кладовой в другое подразделение (буфет, филиал). Цена — средняя учётная цена склада.',
    cols: [['name', 'Товар, наименование', 'text'], ['code', 'Код', 'text'], ['unit', 'Ед. изм.', 'text'], ['okei', 'Код по ОКЕИ', 'auto'],
      ['qty', 'Количество', 'num'], ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма, руб. коп.', 'money']],
    signs: ['Отпуск разрешил', 'Отпустил', 'Получил'] },
  OP5: { code: 'ОП-5', okud: '0330505', title: 'Закупочный акт', format: 'A4', source: 'manual', approve: true, params: ['date', 'division', 'seller', 'sellerDoc', 'sellerAddress'],
    paramLabels: { seller: 'Продавец (ФИО)', sellerDoc: 'Паспорт продавца (серия, номер, кем и когда выдан)', sellerAddress: 'Адрес продавца' },
    help: 'Закупка продуктов у граждан (рынок, фермер без документов). Цена — договорная, вводится вручную.',
    cols: [['name', 'Товар, наименование', 'text'], ['unit', 'Ед. изм.', 'text'], ['okei', 'Код по ОКЕИ', 'auto'], ['qty', 'Количество', 'num'],
      ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма, руб. коп.', 'money']],
    signs: ['Закупку произвёл', 'Деньги получил (продавец)'] },
  OP6: { code: 'ОП-6', okud: '0330506', title: 'Дневной заборный лист', format: 'A4L', source: 'stock', approve: false, params: ['date', 'division', 'recipient'],
    help: 'Продукты, взятые кухней из кладовой в течение дня (дозабор). Цена — средняя учётная цена склада.',
    cols: [['name', 'Продукт, наименование', 'text'], ['code', 'Код', 'text'], ['unit', 'Ед. изм.', 'text'], ['okei', 'Код по ОКЕИ', 'auto'],
      ['qty', 'Отпущено', 'num'], ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма, руб. коп.', 'money']],
    signs: ['Отпустил', 'Получил'] },
  OP7: { code: 'ОП-7', okud: '0330507', title: 'Опись дневных заборных листов (накладных)', format: 'A4', source: 'op3list', period: true, approve: false, params: ['from', 'to', 'division'],
    help: 'Опись требований в кладовую (ОП-3), составленных в системе за период. Суммы берутся из самих требований.',
    cols: [['date', 'Дата', 'text'], ['docNo', 'Номер документа', 'text'], ['sender', 'Подразделение', 'text'], ['sum', 'Сумма по учётным ценам, руб. коп.', 'money']],
    signs: ['Опись сдал (материально ответственное лицо)', 'Опись принял (бухгалтер)'] },
  OP8: { code: 'ОП-8', okud: '0330508', title: 'Акт о бое, ломе и утрате посуды и приборов', format: 'A4L', source: 'stock', approve: true, qtyTotal: true, params: ['date', 'division'],
    help: 'Разбитая, сломанная или утраченная посуда и приборы. Цена — учётная цена склада, если посуда заведена на склад; иначе введите вручную.',
    cols: [['name', 'Посуда, приборы — наименование', 'text'], ['code', 'Код', 'text'], ['unit', 'Ед. изм.', 'text'], ['qty', 'Количество', 'num'],
      ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма, руб. коп.', 'money'], ['culprit', 'Виновное лицо (ФИО, должность)', 'text'], ['reason', 'Обстоятельства', 'text']],
    signs: ['Материально ответственное лицо', 'Председатель комиссии', 'Члены комиссии'] },
  OP9: { code: 'ОП-9', okud: '0330509', title: 'Ведомость учета движения посуды и приборов', format: 'A4L', source: 'stock', period: true, approve: false, qtyOptional: true, qtyTotal: true,
    params: ['from', 'to', 'division'], calc: TS_OP_MOVE_,
    help: 'Остаток на начало + поступило − выбыло = остаток на конец (считается сам). Цена — учётная цена склада или вручную.',
    cols: [['name', 'Посуда, приборы — наименование', 'text'], ['code', 'Код', 'text'], ['price', 'Цена, руб. коп.', 'money'], ['open', 'Остаток на начало', 'num'],
      ['in', 'Поступило', 'num'], ['out', 'Выбыло', 'num'], ['qty', 'Остаток на конец', 'calc'], ['sum', 'Сумма остатка, руб. коп.', 'money']],
    signs: ['Материально ответственное лицо', 'Бухгалтер'] },
  OP10: { code: 'ОП-10', okud: '0330510', title: 'Акт о реализации и отпуске изделий кухни', format: 'A4L', source: 'sales', approve: true, params: ['date', 'division'],
    help: 'Изделия кухни, реализованные за день (журнал продаж). Цена продажи — из меню или продажи, учётная — себестоимость по ТТК.',
    cols: [['name', 'Изделие, наименование', 'text'], ['code', 'Код', 'text'], ['ttk', '№ ТТК', 'text'], ['qty', 'Количество, порц.', 'num'],
      ['salePrice', 'Цена продажи', 'money'], ['saleSum', 'Сумма по ценам продажи', 'money'], ['price', 'Учётная цена', 'money'], ['sum', 'Сумма по учётным ценам', 'money']],
    signs: ['Заведующий производством', 'Бухгалтер'] },
  OP11: { code: 'ОП-11', okud: '0330511', title: 'Акт о продаже и отпуске изделий кухни', format: 'A4', source: 'sales', approve: true, params: ['date', 'division', 'recipient'],
    help: 'Отпуск изделий кухни в буфет, на раздачу или в другое подразделение. Получатель указывается в документе.',
    cols: [['name', 'Изделие, наименование', 'text'], ['code', 'Код', 'text'], ['qty', 'Количество, порц.', 'num'],
      ['salePrice', 'Цена продажи', 'money'], ['saleSum', 'Сумма по ценам продажи', 'money'], ['price', 'Учётная цена', 'money'], ['sum', 'Сумма по учётным ценам', 'money']],
    signs: ['Сдал (заведующий производством)', 'Принял'] },
  OP12: { code: 'ОП-12', okud: '0330512', title: 'Акт о реализации готовых изделий кухни за наличный расчет', format: 'A4', source: 'sales', approve: true, params: ['date', 'division'],
    help: 'Готовые изделия, проданные за наличный расчёт за день. Цена — продажная (меню или продажа).',
    cols: [['name', 'Изделие, наименование', 'text'], ['code', 'Код', 'text'], ['qty', 'Количество, порц.', 'num'], ['salePrice', 'Цена продажи', 'money'], ['saleSum', 'Сумма, руб. коп.', 'money']],
    signs: ['Заведующий производством', 'Кассир'] },
  OP13: { code: 'ОП-13', okud: '0330513', title: 'Контрольный расчет расхода специй и соли', format: 'A4', source: 'spices', approve: true, params: ['date', 'division'],
    help: 'Расход соли и специй по нормам ТТК на блюда, проданные за день (журнал продаж). Цена — средняя учётная цена склада.',
    cols: [['name', 'Специи, соль — наименование', 'text'], ['unit', 'Ед. изм.', 'text'], ['qty', 'Расход по нормам', 'num'],
      ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма, руб. коп.', 'money']],
    signs: ['Заведующий производством', 'Калькулятор', 'Бухгалтер'] },
  OP14: { code: 'ОП-14', okud: '0330514', title: 'Ведомость учета движения продуктов и тары на кухне', format: 'A4', source: 'stock', period: true, approve: false, qtyOptional: true,
    params: ['from', 'to', 'division'], calc: TS_OP_MOVE_,
    help: 'Продукты и тара на кухне: остаток на начало + получено − израсходовано = остаток на конец (считается сам). Цена — учётная цена склада.',
    cols: [['name', 'Продукт, тара — наименование', 'text'], ['unit', 'Ед. изм.', 'text'], ['price', 'Цена, руб. коп.', 'money'], ['open', 'Остаток на начало', 'num'],
      ['in', 'Получено', 'num'], ['out', 'Израсходовано', 'num'], ['qty', 'Остаток на конец', 'calc'], ['sum', 'Сумма остатка, руб. коп.', 'money']],
    signs: ['Заведующий производством', 'Бухгалтер'] },
  OP15: { code: 'ОП-15', okud: '0330515', title: 'Акт о снятии остатков продуктов, полуфабрикатов и готовых изделий кухни', format: 'A3L', source: 'stock', approve: true, params: ['date', 'division'],
    help: 'Фактические остатки на кухне на конец дня (продукты, полуфабрикаты, готовые изделия). Цена — учётная цена склада или вручную.',
    cols: [['name', 'Продукты, полуфабрикаты, изделия — наименование', 'text'], ['code', 'Код', 'text'], ['unit', 'Ед. изм.', 'text'], ['okei', 'Код по ОКЕИ', 'auto'],
      ['qty', 'Фактический остаток', 'num'], ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма, руб. коп.', 'money']],
    signs: ['Заведующий производством', 'Председатель комиссии', 'Члены комиссии'] },
  OP16: { code: 'ОП-16', okud: '0330516', title: 'Ведомость учета остатков продуктов и товаров на складе (в кладовой)', format: 'A4L', source: 'balance', approve: false, params: ['date', 'division'],
    help: 'Остатки склада на дату с учётными ценами; нулевые остатки не попадают.',
    cols: [['name', 'Продукт, товар — наименование', 'text'], ['code', 'Код', 'text'], ['unit', 'Ед. изм.', 'text'], ['okei', 'Код по ОКЕИ', 'auto'],
      ['qty', 'Остаток', 'num'], ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма, руб. коп.', 'money']],
    signs: ['Заведующий складом (кладовщик)', 'Бухгалтер'] },
  OP17: { code: 'ОП-17', okud: '0330517', title: 'Контрольный расчет расхода продуктов по нормам рецептур на выпущенные изделия', format: 'A4L', source: 'normuse', approve: true,
    params: ['date', 'division'], calc: { diff: { of: [['fact', 1], ['qty', -1]], need: 'fact' } },
    help: 'Расход продуктов по нормам ТТК на блюда, проданные за день. Введите фактический расход — отклонение посчитается само (плюс — перерасход, минус — экономия).',
    cols: [['name', 'Продукт, наименование', 'text'], ['unit', 'Ед. изм.', 'text'], ['qty', 'Расход по нормам', 'num'], ['fact', 'Фактический расход', 'num'],
      ['diff', 'Отклонение (+ перерасход, − экономия)', 'calc'], ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма по нормам, руб. коп.', 'money']],
    signs: ['Заведующий производством', 'Калькулятор', 'Бухгалтер'] },
  OP18: { code: 'ОП-18', okud: '0330518', title: 'Акт о передаче товаров и тары при смене материально ответственного лица', format: 'A4', source: 'balance', approve: true, params: ['date', 'division', 'from', 'to'],
    help: 'Остатки склада на дату передачи с учётными ценами. Сдающее и принимающее лицо указываются в документе.',
    paramLabels: { from: 'Сдаёт (ФИО)', to: 'Принимает (ФИО)' },
    cols: [['name', 'Товар, тара — наименование', 'text'], ['code', 'Код', 'text'], ['unit', 'Ед. изм.', 'text'], ['okei', 'Код по ОКЕИ', 'auto'],
      ['qty', 'Количество', 'num'], ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма, руб. коп.', 'money']],
    signs: ['Сдал', 'Принял', 'Председатель комиссии', 'Члены комиссии'] },
  OP19: { code: 'ОП-19', okud: '0330519', title: 'Журнал учета столовой посуды и приборов, выдаваемых под отчет работникам организации', format: '2A4L', source: 'manual', approve: false,
    params: ['date', 'division'], calc: { short: { of: [['qty', 1], ['ret', -1]], need: 'ret' } },
    help: 'Выдача посуды и приборов работникам под отчёт и их возврат. Печатается разворотом на двух листах А4: слева выдача, справа возврат. Недостача считается сама.',
    cols: [['issueDate', 'Дата выдачи', 'text'], ['person', 'Работник (ФИО)', 'text'], ['tab', 'Табельный номер', 'text'], ['name', 'Посуда, приборы — наименование', 'text'],
      ['qty', 'Выдано, шт.', 'num'], ['retDate', 'Дата возврата', 'text'], ['ret', 'Возвращено, шт.', 'num'], ['short', 'Недостача, шт.', 'calc'],
      ['signGot', 'Подпись в получении', 'text'], ['signRet', 'Подпись принявшего', 'text']],
    signs: ['Материально ответственное лицо'] },
  OP20: { code: 'ОП-20', okud: '0330520', title: 'Заказ-счет', format: 'A4', source: 'dishes', approve: false, qtyTotal: true, params: ['date', 'division', 'customer', 'table'],
    paramLabels: { customer: 'Заказчик', table: 'Стол / номер заказа' },
    help: 'Счёт посетителю или заказчику банкета. Цена — из меню (или последней продажи).',
    cols: [['name', 'Блюдо, изделие — наименование', 'text'], ['code', 'Код', 'text'], ['qty', 'Количество, порц.', 'num'], ['salePrice', 'Цена, руб. коп.', 'money'], ['saleSum', 'Сумма, руб. коп.', 'money']],
    signs: ['Официант', 'Заказчик'] },
  OP21: { code: 'ОП-21', okud: '0330521', title: 'Акт на отпуск питания сотрудникам организации', format: 'A4', source: 'staff', approve: true, params: ['date', 'division', 'dish'],
    help: 'Список работающих сотрудников. Стоимость порции — цена выбранного блюда (рациона) из меню; без блюда — укажите цену вручную.',
    cols: [['name', 'Фамилия, имя, отчество', 'text'], ['tab', 'Табельный номер', 'text'], ['position', 'Должность', 'text'], ['qty', 'Количество порций', 'num'],
      ['salePrice', 'Стоимость порции', 'money'], ['saleSum', 'Сумма, руб. коп.', 'money']],
    signs: ['Заведующий производством', 'Ответственный за отпуск питания', 'Бухгалтер'] },
  OP22: { code: 'ОП-22', okud: '0330522', title: 'Акт на отпуск питания по безналичному расчету', format: 'A4', source: 'dishes', approve: true, qtyTotal: true, params: ['date', 'division', 'customer', 'contract'],
    paramLabels: { customer: 'Получатель (организация)', contract: 'Договор, основание' },
    help: 'Питание, отпущенное другой организации по договору (оплата по безналичному расчёту). Цена — из меню или договора («Цены меню»).',
    cols: [['name', 'Блюдо, рацион — наименование', 'text'], ['code', 'Код', 'text'], ['qty', 'Количество, порц.', 'num'], ['salePrice', 'Цена, руб. коп.', 'money'], ['saleSum', 'Сумма, руб. коп.', 'money']],
    signs: ['Отпуск произвёл (заведующий производством)', 'Получил (представитель получателя)', 'Бухгалтер'] },
  OP23: { code: 'ОП-23', okud: '0330523', title: 'Акт о разделке мяса-сырья на полуфабрикаты', format: 'A3L', source: 'disassembly', approve: true, params: ['date', 'division'],
    help: 'Акты зачистки и разделки за день: взятое сырьё, полученные полуфабрикаты и отходы. Стоимость сырья — цена партии, полуфабрикатам — по массе выхода.',
    cols: [['kind', 'Вид', 'auto'], ['name', 'Наименование', 'text'], ['code', 'Партия / код', 'text'], ['unit', 'Ед. изм.', 'text'], ['qty', 'Количество', 'num'],
      ['pct', '% выхода', 'auto'], ['price', 'Цена, руб. коп.', 'money'], ['sum', 'Сумма, руб. коп.', 'money']],
    signs: ['Заведующий производством', 'Разделку провёл', 'Члены комиссии'] },
  OP24: { code: 'ОП-24', okud: '0330524', title: 'Ведомость учета движения готовых изделий в кондитерском и других цехах', format: 'A4L', source: 'dishmove', period: true, approve: false,
    qtyOptional: true, qtyTotal: true, params: ['from', 'to', 'division'], calc: TS_OP_MOVE_,
    help: 'Готовые изделия цеха: остаток на начало + изготовлено − отпущено = остаток на конец. «Отпущено» заполняется по продажам за период, «изготовлено» — тем же количеством; поправьте при необходимости.',
    cols: [['name', 'Изделие, наименование', 'text'], ['code', 'Код', 'text'], ['salePrice', 'Цена продажи', 'money'], ['open', 'Остаток на начало', 'num'],
      ['in', 'Изготовлено', 'num'], ['out', 'Отпущено', 'num'], ['qty', 'Остаток на конец', 'calc'], ['saleSum', 'Сумма остатка по ценам продажи', 'money']],
    signs: ['Заведующий производством', 'Бухгалтер'] },
  OP25: { code: 'ОП-25', okud: '0330525', title: 'Наряд-заказ на изготовление кондитерских и других изделий', format: 'A3L', source: 'dishes', approve: true, qtyTotal: true,
    params: ['date', 'division', 'customer', 'due'], paramLabels: { customer: 'Заказчик (подразделение, организация)', due: 'Срок исполнения' },
    help: 'Заказ цеху на изготовление изделий. Цена — из меню (или последней продажи). Ниже таблицы печатается потребность в сырье по нормам ТТК.',
    cols: [['name', 'Изделие, наименование', 'text'], ['code', '№ ТТК', 'text'], ['qty', 'Заказано, шт. (порц.)', 'num'], ['salePrice', 'Цена продажи', 'money'], ['saleSum', 'Сумма, руб. коп.', 'money'],
      ['done', 'Изготовлено', 'num']],
    signs: ['Заказ выдал', 'Заказ принял (мастер, бригадир)', 'Выполненный заказ принял'] }
};

/* ------------------------------------------------------------------ служебное */
function _tsOpSheet_() { return _bcSheet_(TS_OP_SHEET_, TS_OP_HEAD_); }
function _tsOpE_(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function _tsOpNum_(x) { if (typeof x === 'number') return isFinite(x) ? x : 0; var n = parseFloat(String(x === null || x === undefined ? '' : x).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
function _tsOpR2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function _tsOpR4_(x) { return Math.round((Number(x) || 0) * 10000) / 10000; }
function _tsOpR6_(x) { return Math.round((Number(x) || 0) * 1e6) / 1e6; }
function _tsOpR3_(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }
function _tsOpMoney_(x, unitPrice) { var v = unitPrice ? _tsOpR4_(x) : _tsOpR2_(x), s = (unitPrice && v !== _tsOpR2_(v) ? String(v) : v.toFixed(2)).split('.'); return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + s[1]; }
function _tsOpQty_(x) { return String(_tsOpR3_(x)).replace('.', ','); }
function _tsOpKey_(s) { try { return _prodKey_(s); } catch (e) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); } }
function _tsOpIsoDay_(d) { return Utilities.formatDate(d, _mcTz_(), 'yyyy-MM-dd'); }
function _tsOpRuDay_(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '.' + m[2] + '.' + m[1] : String(iso || ''); }
function _tsOpParseDay_(x) {
  if (x === '' || x === null || x === undefined) return null;
  if (Object.prototype.toString.call(x) === '[object Date]') return isNaN(x.getTime()) ? null : _tsOpIsoDay_(x);
  var s = String(x).replace(/^'/, '').trim(), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : null;
}
/** Лист как массив объектов по заголовкам (лист может отсутствовать). */
function _tsOpRows_(name) {
  var sh = _book_().getSheetByName(name); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x || '').trim(); });
  return v.slice(1).filter(function (r) { return r.some(function (x) { return x !== '' && x !== null; }); })
    .map(function (r) { var o = {}; h.forEach(function (k, i) { if (k && !(k in o)) o[k] = r[i]; }); return o; });
}
function _tsOpWho_(s) { return s ? String(s.fullName || s.name || '') : ''; }

/* ------------------------------------------------------------------ реквизиты */
/** Шапка формы: организация, ОКПО, подразделение, руководитель — из настроек; подразделение можно заменить. */
function _tsOpOrg_(division) {
  var o = {};
  try { if (typeof _mcOrg_ === 'function') o = _mcOrg_() || {}; } catch (e) { o = {}; }
  var orgLine = [o.name || o.shortName || '', o.inn ? 'ИНН ' + o.inn : '', o.actualAddress || o.legalAddress || ''].filter(String).join(', ');
  return { name: String(o.name || o.shortName || ''), line: orgLine, okpo: String(o.okpo || ''), inn: String(o.inn || ''),
    division: String(division || o.division || o.objectName || ''), director: String(o.directorName || o.responsibleName || ''),
    directorPosition: String(o.directorPosition || (o.directorName ? 'Руководитель' : o.responsiblePosition) || 'Руководитель'),
    missing: [o.name ? '' : 'наименование организации', o.okpo ? '' : 'ОКПО'].filter(String) };
}

/* ------------------------------------------------------------------ цены */
var _TS_OP_CACHE_ = null;
function _tsOpCache_() { return _TS_OP_CACHE_ || (_TS_OP_CACHE_ = { menu: null, sales: null, dish: {}, stock: null }); }
function _tsOpDish_(nameOrCode) { try { return typeof _v64DishOf_ === 'function' ? _v64DishOf_(nameOrCode) : null; } catch (e) { return null; } }
/** Учётная цена товара за единицу unit — средняя цена склада. */
function _tsOpStockPrice_(name, unit) { try { return _tsOpR6_(_currentAvgPrice_(name, unit || 'г') || 0); } catch (e) { return 0; } }
/** Цена продажи блюда на дату: «Цены_Меню» (меню / договор) → последняя продажа в журнале продаж. */
function _tsOpSalePrice_(name, iso) {
  var C = _tsOpCache_(), at = iso ? new Date(iso + 'T12:00:00') : new Date();
  try { if (typeof _v64MenuPrices_ === 'function') { C.menu = C.menu || _v64MenuPrices_(); var p = _v64PriceFor_(C.menu, name, null, at); if (p && p.price > 0) return { price: _tsOpR2_(p.price), source: 'меню' }; } } catch (e) {}
  C.sales = C.sales || _tsOpRows_('Ж_Продажи');
  var k = _tsOpKey_(name), last = null, lastDay = '';
  // последняя по дате продажа не позже даты документа (журнал может быть не отсортирован)
  C.sales.forEach(function (r) { var pr = _tsOpNum_(r['Цена']), d = _tsOpParseDay_(r['Дата']) || ''; if (pr > 0 && _tsOpKey_(r['Блюдо']) === k && (!iso || !d || d <= iso) && d >= lastDay) { last = pr; lastDay = d; } });
  return last ? { price: _tsOpR2_(last), source: 'продажа' } : { price: 0, source: '' };
}
/** Учётная цена порции блюда — нормативная себестоимость по ТТК и текущим ценам склада. */
function _tsOpDishCost_(name) {
  var C = _tsOpCache_(), k = _tsOpKey_(name);
  if (k in C.dish) return C.dish[k];
  var c = 0; try { if (typeof _v64NormCost_ === 'function') { var r = _v64NormCost_(name); c = r && !(r.missing && r.missing.length) ? r.cost : (r && r.cost > 0 ? r.cost : 0); } } catch (e) { c = 0; }
  return (C.dish[k] = _tsOpR2_(c));
}
function _tsOpStock_() {
  var C = _tsOpCache_(); if (C.stock) return C.stock;
  return (C.stock = _tsOpRows_('Склад_Остатки').map(function (r) {
    return { name: String(r['Продукт'] || ''), unit: String(r['Ед.изм'] || 'г'), qty: _tsOpNum_(r['Остаток']), price: _tsOpR2_(_tsOpNum_(r['Сред.цена']) || _tsOpNum_(r['Цена послед.закупки'])) };
  }).filter(function (x) { return x.name; }));
}

/** Откуда берётся учётная цена: dish — себестоимость порции по ТТК, stock — средняя цена склада, none — только вручную. */
function _tsOpPricing_(f) {
  return f.pricing || ({ sales: 'dish', plan: 'dish', dishes: 'dish', dishmove: 'dish', stock: 'stock', balance: 'stock', ttk: 'stock', spices: 'stock', normuse: 'stock' })[f.source] || 'none';
}
/** Какой список подсказывать в поле «наименование»: products — склад, dishes — блюда, none — без подсказок. */
function _tsOpNames_(f) {
  if (f.names) return f.names;
  if (f.source === 'staff' || f.source === 'op3list') return 'none';
  return _tsOpPricing_(f) === 'dish' ? 'dishes' : 'products';
}
function _tsOpBlank_(v) { return v === '' || v === null || v === undefined; }
/** Расчётные поля (остаток на конец, отклонение, недостача) по описанию calc формы. */
function _tsOpCalc_(f, r) {
  Object.keys(f.calc || {}).forEach(function (k) {
    var c = f.calc[k];
    if (c.need && _tsOpBlank_(r[c.need])) { r[k] = ''; return; }
    r[k] = _tsOpR3_(c.of.reduce(function (s, x) { return s + x[1] * _tsOpNum_(r[x[0]]); }, 0));
  });
}
/** Подставить цену в строку, если её не ввели; пересчитать суммы. Возвращает строку с флагом noPrice. */
function _tsOpPriceRow_(f, row, iso) {
  var r = {}; Object.keys(row || {}).forEach(function (k) { r[k] = row[k]; });
  var has = function (k) { return f.cols.some(function (c) { return c[0] === k; }); };
  if (_tsOpPricing_(f) === 'dish' && r.name && (has('code') && !r.code || has('ttk') && !r.ttk)) { var dd = _tsOpDish_(r.name); if (dd) { if (has('code') && !r.code) r.code = dd.code; if (has('ttk') && !r.ttk) r.ttk = dd.code; } }
  f.cols.forEach(function (c) { if (c[2] === 'num' && c[0] !== 'qty' && c[0] !== 'qtyReq' && !_tsOpBlank_(r[c[0]])) r[c[0]] = _tsOpR3_(_tsOpNum_(r[c[0]])); });
  _tsOpCalc_(f, r);
  r.qty = _tsOpR3_(_tsOpNum_(r.qty)); if (has('qtyReq')) r.qtyReq = r.qtyReq === '' || r.qtyReq === undefined ? r.qty : _tsOpR3_(_tsOpNum_(r.qtyReq));
  if (has('okei')) r.okei = TS_OP_OKEI_[String(r.unit || '').toLowerCase()] || '';
  var src = [];
  if (has('salePrice')) {
    var sp = _tsOpNum_(r.salePrice);
    if (!(sp > 0) && r.name && f.source !== 'staff') { var s = _tsOpSalePrice_(r.name, iso); sp = s.price; if (sp > 0) src.push('цена продажи — ' + s.source); }
    r.salePrice = _tsOpR6_(sp); r.saleSum = _tsOpR2_(sp * r.qty);
  }
  if (has('price')) {
    var p = _tsOpNum_(r.price);
    if (!(p > 0) && r.name && r.kind !== 'отходы') {
      var how = _tsOpPricing_(f);
      if (how === 'dish') { p = _tsOpDishCost_(r.name); if (p > 0) src.push('учётная — себестоимость по ТТК'); }
      else if (how === 'stock') { p = _tsOpStockPrice_(r.name, r.unit); if (p > 0) src.push('учётная — средняя цена склада'); }
    }
    r.price = _tsOpR6_(p); r.sum = r.kind === 'отходы' ? 0 : _tsOpR2_(p * r.qty);
  }
  if (f.source === 'op3list') r.sum = _tsOpR2_(_tsOpNum_(r.sum));
  var need = (has('salePrice') && !(r.salePrice > 0)) || (has('price') && r.kind !== 'отходы' && !(r.price > 0));
  var moved = r.qty > 0 || (f.calc && f.calc.qty && f.calc.qty.of.some(function (x) { return _tsOpNum_(r[x[0]]) > 0; }));
  r.noPrice = !!(r.name && moved && need && f.source !== 'op3list');
  r.priceSource = src.join('; ');
  return r;
}
function _tsOpTotals_(f, rows) {
  var t = { qty: 0, sum: 0, saleSum: 0 };
  rows.forEach(function (r) { if (r.kind === 'отходы' || r.kind === 'полуфабрикат') return; t.qty += _tsOpNum_(r.qty); t.sum += _tsOpNum_(r.sum); t.saleSum += _tsOpNum_(r.saleSum); });
  t.qty = _tsOpR3_(t.qty); t.sum = _tsOpR2_(t.sum); t.saleSum = _tsOpR2_(t.saleSum);
  var has = function (k) { return f.cols.some(function (c) { return c[0] === k; }); };
  t.main = has('saleSum') ? t.saleSum : t.sum;
  return t;
}

/* ------------------------------------------------------------------ заполнение из данных */
/** Продажи за период по блюдам: { ключ: { name, qty, prices: { цена: количество } } }. */
function _tsOpSalesAgg_(from, to) {
  var agg = {};
  _tsOpRows_('Ж_Продажи').forEach(function (r) {
    var d = _tsOpParseDay_(r['Дата']); if (!d || d < from || d > to || !String(r['Блюдо'] || '').trim()) return;
    var nm = String(r['Блюдо']).trim(), k = _tsOpKey_(nm), q = _tsOpNum_(r['Количество']); if (!(q > 0)) return;
    var a = agg[k] || (agg[k] = { name: nm, qty: 0, prices: {} });
    a.qty += q; var pr = _tsOpNum_(r['Цена']); if (pr > 0) a.prices[pr] = (a.prices[pr] || 0) + q;
  });
  return agg;
}
var TS_OP_SPICE_RE_ = /(^|\s)(соль|перец|специ|приправ|лавров|корица|гвоздик|паприк|кориандр|тмин|мускат|ванил|куркум|карри|зира|орегано|хмели|розмарин|тимьян|чабрец|кардамон|бадьян|майоран|базилик сушен|укроп сушен|петрушка сушен|чеснок сушен|горчица порош)/i;
/** Расход продуктов по нормам ТТК на изделия: list — [{ name, qty }]; только — фильтр по названию продукта. */
function _tsOpNormUse_(list, only) {
  var use = {};
  list.forEach(function (a) {
    var d = _tsOpDish_(a.name); if (!d) return;
    (d.ing || []).forEach(function (x) {
      var nm = String(x[0] || ''), u = x[2] || 'г', q = (Number(x[1]) || 0) * a.qty; if (!nm || !(q > 0) || (only && !only(nm))) return;
      var k = _tsOpKey_(nm) + '|' + u, o = use[k] || (use[k] = { name: nm, unit: u, qty: 0 }); o.qty += q;
    });
  });
  return Object.keys(use).map(function (k) { var o = use[k]; o.qty = _tsOpR3_(o.qty); return o; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
}
function _tsOpIsSpice_(nm) { return TS_OP_SPICE_RE_.test(nm) && !/болгарск|сладк|свеж|фарширов/i.test(nm); }
function _tsOpAggList_(agg) { return Object.keys(agg).map(function (k) { return agg[k]; }); }
function _tsOpShiftDay_(iso, days) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function _tsOpFill_(form, p) {
  var f = TS_OP_FORMS_[form], iso = _tsOpParseDay_(p.date) || _tsOpParseDay_(p.to) || _tsOpIsoDay_(new Date()), rows = [];
  var from = _tsOpParseDay_(p.from) || iso, to = _tsOpParseDay_(p.to) || iso;
  if (f.source === 'sales') {
    var agg = _tsOpSalesAgg_(iso, iso);
    Object.keys(agg).forEach(function (k) {
      var a = agg[k], d = _tsOpDish_(a.name), pl = Object.keys(a.prices);
      // разные цены в один день — отдельные строки, чтобы сумма совпала с журналом продаж; продажа без цены — цена из меню
      var code = d ? d.code : '', priced = 0;
      pl.forEach(function (pr) { priced += a.prices[pr]; rows.push({ name: a.name, code: code, ttk: code, qty: a.prices[pr], salePrice: Number(pr) }); });
      if (a.qty - priced > 0.0001) rows.push({ name: a.name, code: code, ttk: code, qty: a.qty - priced, salePrice: 0 });
    });
    rows = rows.filter(function (r) { return r.qty > 0; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  } else if (f.source === 'balance') {
    rows = _tsOpStock_().filter(function (x) { return x.qty > 0; }).map(function (x) { return { name: x.name, unit: x.unit, qty: x.qty, price: x.price }; })
      .sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  } else if (f.source === 'staff') {
    var price = 0; if (p.dish) price = _tsOpSalePrice_(p.dish, iso).price;
    rows = _tsOpRows_('Сотрудники').filter(function (r) { var a = String(r['Активен']); return !/^(false|нет|0)$/i.test(a); })
      .map(function (r) { return { name: [r['Фамилия'], r['Имя'], r['Отчество']].filter(function (x) { return String(x || '').trim(); }).join(' '), tab: String(r['Табельный номер'] || ''), position: String(r['Должность'] || ''), qty: 1, salePrice: price }; })
      .filter(function (r) { return r.name; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  } else if (f.source === 'disassembly') {
    var lines = {}, batches = {};
    _tsOpRows_('Разбор_Строки').forEach(function (r) { var a = String(r['АктID'] || ''); (lines[a] = lines[a] || []).push(r); });
    _tsOpRows_('Склад_Партии').forEach(function (r) { var id = String(r['ID'] || r['BatchID'] || ''); if (id) batches[id] = r; });
    var bPrice = function (id) { var b = batches[id]; return b ? _tsOpNum_(b['Цена за ед.']) : 0; };
    _tsOpRows_('Разбор_Акты').forEach(function (a) {
      if (_tsOpParseDay_(a['Дата']) !== iso || String(a['Тип'] || '') === 'DEFROST') return;
      var id = String(a['ID'] || ''), unit = String(a['ЕдИзм'] || 'г'), taken = _tsOpNum_(a['Взято'] || a['ИсходныйВес']), src = String(a['ПартияИсточник'] || '');
      var pr = bPrice(src); if (!(pr > 0)) pr = _tsOpStockPrice_(String(a['Продукт'] || ''), unit);
      var cost = taken * pr, ls = lines[id] || [];
      var outs = ls.filter(function (x) { return /product|выход/i.test(String(x['Тип'])); }), wastes = ls.filter(function (x) { return /waste|отход/i.test(String(x['Тип'])); });
      var P = outs.reduce(function (s, x) { return s + _tsOpNum_(x['Вес']); }, 0);
      rows.push({ kind: 'сырьё', name: String(a['Продукт'] || ''), code: src, unit: unit, qty: taken, pct: '', price: _tsOpR4_(pr) });
      outs.forEach(function (x) { var w = _tsOpNum_(x['Вес']); rows.push({ kind: 'полуфабрикат', name: String(x['Название'] || ''), code: String(x['НовыйBatchID'] || ''), unit: unit, qty: w,
        pct: taken > 0 ? _tsOpR2_(w / taken * 100) : '', price: w > 0 && P > 0 ? _tsOpR6_(cost / P) : 0 }); });
      wastes.forEach(function (x) { var w = _tsOpNum_(x['Вес']); rows.push({ kind: 'отходы', name: String(x['Название'] || 'Отходы'), code: '', unit: unit, qty: w, pct: taken > 0 ? _tsOpR2_(w / taken * 100) : '', price: 0 }); });
    });
  } else if (f.source === 'ttk') {
    var dish = p.dish ? _tsOpDish_(p.dish) : null, portions = _tsOpNum_(p.portions) || 1;
    if (dish) rows = (dish.ing || []).filter(function (x) { return String(x[0] || '').trim() && Number(x[1]) > 0; })
      .map(function (x) { return { name: String(x[0]), code: '', unit: x[2] || 'г', qty: _tsOpR3_(Number(x[1]) * portions) }; });
  } else if (f.source === 'plan') {
    // план на день — по продажам того же дня недели неделю назад
    var wk = _tsOpShiftDay_(iso, -7);
    rows = _tsOpAggList_(_tsOpSalesAgg_(wk, wk)).map(function (a) { var d = _tsOpDish_(a.name); return { name: a.name, code: d ? d.code : '', qty: _tsOpR3_(a.qty) }; })
      .sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  } else if (f.source === 'dishmove') {
    rows = _tsOpAggList_(_tsOpSalesAgg_(from, to)).map(function (a) { var d = _tsOpDish_(a.name), q = _tsOpR3_(a.qty); return { name: a.name, code: d ? d.code : '', open: 0, in: q, out: q }; })
      .sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  } else if (f.source === 'spices' || f.source === 'normuse') {
    rows = _tsOpNormUse_(_tsOpAggList_(_tsOpSalesAgg_(iso, iso)), f.source === 'spices' ? _tsOpIsSpice_ : null)
      .map(function (o) { return f.source === 'normuse' ? { name: o.name, unit: o.unit, qty: o.qty, fact: '' } : o; });
  } else if (f.source === 'op3list') {
    _tsOpRows_(TS_OP_SHEET_).forEach(function (r) {
      var d = _tsOpParseDay_(r['Дата']); if (String(r['Форма']) !== 'ОП-3' || !d || d < from || d > to) return;
      rows.push({ date: _tsOpRuDay_(d), docNo: String(r['Номер']), sender: String(r['Подразделение'] || ''), sum: _tsOpNum_(r['Сумма']) });
    });
  }
  return rows.map(function (r) { return _tsOpPriceRow_(f, r, iso); });
}

/* ------------------------------------------------------------------ API */
/** Список форм, реквизиты из настроек, подсказки (товары склада, блюда, подразделения) и составленные документы. */
function tsOpList(token) {
  try {
    _requireAuth_(token); _TS_OP_CACHE_ = null;
    var org = _tsOpOrg_('');
    var forms = Object.keys(TS_OP_FORMS_).map(function (k) {
      var f = TS_OP_FORMS_[k], fm = TS_OP_FORMATS_[f.format] || TS_OP_FORMATS_.A4;
      return { key: k, code: f.code, title: f.title, okud: f.okud, format: f.format, formatLabel: fm.label, help: f.help, params: f.params, paramLabels: f.paramLabels || {}, cols: f.cols,
        source: f.source, period: !!f.period, calc: f.calc || null, names: _tsOpNames_(f), qtyOptional: !!f.qtyOptional };
    });
    var dishes = []; try { var D = _v64Dishes_(); dishes = Object.keys(D.byCode).map(function (c) { return D.byCode[c]; }).filter(function (d) { return !d.semi; }).map(function (d) { return d.name; }).sort(); } catch (e) {}
    var divisions = []; try { var ws = _dishWorkshopMap_() || {}; Object.keys(ws).forEach(function (k) { var v = String(ws[k] || '').trim(); if (v && divisions.indexOf(v) < 0) divisions.push(v); }); } catch (e) {}
    if (org.division && divisions.indexOf(org.division) < 0) divisions.unshift(org.division);
    var issued = _tsOpRows_(TS_OP_SHEET_).map(function (r) { return { no: String(r['Номер']), form: String(r['Форма']), date: _tsOpParseDay_(r['Дата']) || '', division: String(r['Подразделение'] || ''), sum: _tsOpNum_(r['Сумма']), who: String(r['Составил'] || '') }; }).reverse().slice(0, 200);
    return _ok_({ forms: forms, org: org, products: _tsOpStock_().map(function (x) { return { name: x.name, unit: x.unit }; }), dishes: dishes, divisions: divisions, issued: issued });
  } catch (e) { return _failFrom_(e); }
}
/** Заполнить форму из данных системы (без сохранения): строки с ценами и итоги. */
function tsOpPrefill(token, form, params) {
  try {
    _requireAuth_(token); _TS_OP_CACHE_ = null;
    var f = TS_OP_FORMS_[form]; if (!f) return _fail_('VALIDATION', 'Неизвестная форма');
    params = typeof params === 'string' ? JSON.parse(params || '{}') : (params || {});
    var rows = _tsOpFill_(form, params);
    return _ok_({ rows: rows, totals: _tsOpTotals_(f, rows), noPrice: rows.filter(function (r) { return r.noPrice; }).length, org: _tsOpOrg_(params.division) });
  } catch (e) { return _failFrom_(e); }
}
/** Цена для строки, добавленной вручную: учётная и продажная. */
function tsOpPrice(token, form, name, unit, date) {
  try {
    _requireAuth_(token);
    var f = TS_OP_FORMS_[form]; if (!f) return _fail_('VALIDATION', 'Неизвестная форма');
    unit = String(unit || '');
    if (!unit && _tsOpPricing_(f) === 'stock') { var st = _tsOpStock_().filter(function (x) { return _tsOpKey_(x.name) === _tsOpKey_(name); })[0]; if (st) unit = st.unit; }
    var r = _tsOpPriceRow_(f, { name: String(name || ''), unit: unit, qty: 1, code: (_tsOpDish_(name) || {}).code || '' }, _tsOpParseDay_(date));
    return _ok_({ code: r.code || '', unit: r.unit || '', okei: r.okei || '', price: r.price || 0, salePrice: r.salePrice || 0, source: r.priceSource, noPrice: r.noPrice });
  } catch (e) { return _failFrom_(e); }
}
/** Сохранить документ: номер по форме и году, пустые цены подставляются, суммы и итог считаются здесь. */
function tsOpCreate(token, form, doc) {
  try {
    var s = _requireAuth_(token); _TS_OP_CACHE_ = null;
    var f = TS_OP_FORMS_[form]; if (!f) return _fail_('VALIDATION', 'Неизвестная форма');
    doc = typeof doc === 'string' ? JSON.parse(doc || '{}') : (doc || {});
    var p = doc.params || {}, iso = _tsOpParseDay_(p.date) || (f.period && _tsOpParseDay_(p.to)) || _tsOpIsoDay_(new Date());
    var rows = (doc.rows || []).filter(function (r) { return r && String(r.name || r.docNo || '').trim(); }).map(function (r) { return _tsOpPriceRow_(f, r, iso); });
    if (f.dropEmpty) rows = rows.filter(function (r) { return r.qty > 0; });
    if (!rows.length) return _fail_('VALIDATION', 'В документе нет строк');
    if (f.source !== 'op3list' && f.source !== 'disassembly' && !f.qtyOptional && rows.some(function (r) { return !(r.qty > 0); })) return _fail_('VALIDATION', 'Укажите количество в каждой строке');
    if (f.qtyOptional && rows.some(function (r) { return r.qty < 0; })) return _fail_('VALIDATION', 'Остаток на конец не может быть отрицательным — проверьте строки');
    var totals = _tsOpTotals_(f, rows), org = _tsOpOrg_(p.division), info = _tsOpInfo_(f, p, rows, totals, iso);
    return _withLock_(function () {
      var y = iso.slice(0, 4), n = _tsOpRows_(TS_OP_SHEET_).filter(function (r) { return String(r['Форма']) === f.code && String(_tsOpParseDay_(r['Дата']) || '').slice(0, 4) === y; }).length + 1;
      var no = f.code + '/' + y + '/' + n, who = _tsOpWho_(s);
      var data = { form: form, n: n, params: p, rows: rows, totals: totals, org: org, who: who, info: info };
      _tsOpSheet_().appendRow([no, f.code, iso, org.division, JSON.stringify(data), totals.main, who, new Date()]);
      try { if (typeof _ts2Audit_ === 'function') _ts2Audit_('OP_FORM_CREATE', 'Формы_ОП', no, null, { form: f.code, sum: totals.main }, f.title + ' № ' + n); } catch (e) {}
      return _ok_({ no: no, n: n, totals: totals, noPrice: rows.filter(function (r) { return r.noPrice; }).length, html: _tsOpHtml_(data) });
    });
  } catch (e) { return _failFrom_(e); }
}
/** Справочные строки под таблицей: для ОП-1 — себестоимость порции, цена продажи и наценка; для ОП-25 — потребность в сырье по ТТК. */
function _tsOpInfo_(f, p, rows, totals, iso) {
  var info = {};
  if (f.source === 'ttk') {
    var portions = _tsOpNum_(p.portions) || 1, cost = _tsOpR2_(totals.sum / portions), sale = p.dish ? _tsOpSalePrice_(p.dish, iso).price : 0;
    info.portions = portions; info.cost = cost; info.salePrice = sale; info.markup = cost > 0 && sale > 0 ? _tsOpR2_((sale / cost - 1) * 100) : null;
  }
  if (f.code === 'ОП-25') {
    info.needs = _tsOpNormUse_(rows.map(function (r) { return { name: r.name, qty: r.qty }; }), null)
      .map(function (o) { var pr = _tsOpStockPrice_(o.name, o.unit); return { name: o.name, unit: o.unit, qty: o.qty, price: pr, sum: _tsOpR2_(pr * o.qty) }; });
  }
  return info;
}
function _tsOpLoad_(no) {
  var r = _tsOpRows_(TS_OP_SHEET_).filter(function (x) { return String(x['Номер']) === String(no); })[0];
  if (!r) return null; try { return JSON.parse(r['Данные'] || '{}'); } catch (e) { return null; }
}
/** Печатный перечень всех форм ОП-1…ОП-25 с кодами ОКУД и форматами листов. */
function tsOpCatalog(token) {
  try { _requireAuth_(token); return _ok_({ html: _tsOpCatalogHtml_() }); } catch (e) { return _failFrom_(e); }
}
/** Печатная форма сохранённого документа. */
function tsOpGet(token, no) {
  try { _requireAuth_(token); var d = _tsOpLoad_(no); if (!d) return _fail_('NOT_FOUND', 'Документ не найден'); return _ok_({ no: no, html: _tsOpHtml_(d) }); }
  catch (e) { return _failFrom_(e); }
}
/** PDF сохранённого документа в папку «Отчёты» на Диске клиента. */
function tsOpPdf(token, no) {
  try {
    _requireAuth_(token); var d = _tsOpLoad_(no); if (!d) return _fail_('NOT_FOUND', 'Документ не найден');
    var f = TS_OP_FORMS_[d.form], name = (f.code + ' ' + f.title + ' № ' + d.n + ' от ' + _tsOpRuDay_(d.params && d.params.date || '')).replace(/[\\\/:*?"<>|]+/g, ' ').slice(0, 150) + '.pdf';
    var html = '<html><head><meta charset="utf-8"></head><body>' + _tsOpHtml_(d) + '</body></html>';
    var pdf = Utilities.newBlob(html, 'text/html', 'op.html').getAs('application/pdf').setName(name);
    var file = _mcReportsFolder_().createFile(pdf);
    return _ok_({ url: file.getUrl(), name: name });
  } catch (e) { return _failFrom_(e); }
}

/* ------------------------------------------------------------------ сумма прописью */
function _tsOpWords_(n, fem) {
  var u = [['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'], ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']];
  var teen = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  var tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  var hund = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  var h = Math.floor(n / 100), t = Math.floor(n % 100 / 10), o = n % 10, w = [hund[h]];
  if (t === 1) w.push(teen[o]); else { w.push(tens[t]); w.push(u[fem ? 1 : 0][o]); }
  return w.filter(String).join(' ');
}
function _tsOpPlural_(n, f1, f2, f5) { n = Math.abs(n) % 100; var a = n % 10; if (n > 10 && n < 20) return f5; if (a > 1 && a < 5) return f2; if (a === 1) return f1; return f5; }
function _tsOpRubWords_(sum) {
  var v = _tsOpR2_(sum), rub = Math.floor(v), kop = Math.round((v - rub) * 100);
  var groups = [['', '', '', false], ['тысяча', 'тысячи', 'тысяч', true], ['миллион', 'миллиона', 'миллионов', false], ['миллиард', 'миллиарда', 'миллиардов', false]], parts = [], i = 0, x = rub;
  if (x === 0) parts.push('ноль');
  while (x > 0 && i < groups.length) { var g = x % 1000; if (g) { var w = _tsOpWords_(g, groups[i][3]); if (i) w += ' ' + _tsOpPlural_(g, groups[i][0], groups[i][1], groups[i][2]); parts.unshift(w); } x = Math.floor(x / 1000); i++; }
  var s = parts.join(' ').replace(/\s+/g, ' ').trim();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s + ' ' + _tsOpPlural_(rub, 'рубль', 'рубля', 'рублей') + ' ' + ('0' + kop).slice(-2) + ' ' + _tsOpPlural_(kop, 'копейка', 'копейки', 'копеек');
}

/* ------------------------------------------------------------------ печатная форма */
function _tsOpHtml_(d) {
  var f = TS_OP_FORMS_[d.form], E = _tsOpE_, p = d.params || {}, org = d.org || _tsOpOrg_(p.division), rows = d.rows || [], t = d.totals || _tsOpTotals_(f, rows);
  var fm = TS_OP_FORMATS_[f.format] || TS_OP_FORMATS_.A4, info = d.info || {}, labels = f.paramLabels || {};
  var cell = 'border:1px solid #000;padding:2px 4px;', small = 'font-size:8px;color:#333;text-align:center;border-top:1px solid #000;';
  var codes = '<table style="border-collapse:collapse;margin-left:auto;font-size:10px"><tr><td></td><td style="' + cell + 'text-align:center;width:90px">Код</td></tr>' +
    '<tr><td style="text-align:right;padding-right:6px">Форма по ОКУД</td><td style="' + cell + 'text-align:center;font-weight:bold">' + f.okud + '</td></tr>' +
    '<tr><td style="text-align:right;padding-right:6px">по ОКПО</td><td style="' + cell + 'text-align:center">' + E(org.okpo) + '</td></tr>' +
    '<tr><td style="text-align:right;padding-right:6px">Вид операции</td><td style="' + cell + '">&nbsp;</td></tr></table>';
  var head = '<div style="text-align:right;font-size:9px">Унифицированная форма № ' + f.code + '<br>Утверждена постановлением Госкомстата России<br>от 25.12.98 № 132</div>' +
    '<table style="width:100%;border-collapse:collapse;margin-top:6px"><tr><td style="vertical-align:bottom;font-size:11px">' +
    '<div style="border-bottom:1px solid #000;min-height:15px;font-weight:bold">' + E(org.line || 'наименование организации не заполнено — Настройки → Организация') + '</div><div style="' + small + 'border:0">организация</div>' +
    '<div style="border-bottom:1px solid #000;min-height:15px;margin-top:4px">' + E(org.division) + '</div><div style="' + small + 'border:0">структурное подразделение</div>' +
    '</td><td style="width:230px;vertical-align:top">' + codes + '</td></tr></table>';
  var approve = f.approve ? '<div style="margin:6px 0 0 auto;width:300px;font-size:11px"><b>УТВЕРЖДАЮ</b><br>' + E(org.directorPosition) +
    '<br>____________ ' + E(org.director || '____________________') + '<br>«____» ______________ 20___ г.</div>' : '';
  var title = '<table style="border-collapse:collapse;margin:10px auto 4px;font-size:11px"><tr><td rowspan="2" style="font:bold 14px Arial;padding-right:12px">' + E(f.title.toUpperCase()) + '</td>' +
    '<td style="' + cell + 'text-align:center">Номер документа</td><td style="' + cell + 'text-align:center">Дата составления</td></tr>' +
    '<tr><td style="' + cell + 'text-align:center;font-weight:bold">' + E(d.n) + '</td><td style="' + cell + 'text-align:center;font-weight:bold">' + E(_tsOpRuDay_(p.date || p.to || '')) + '</td></tr></table>';
  var extra = [];
  if (p.recipient) extra.push(labels.recipient ? E(labels.recipient) + ': <b>' + E(p.recipient) + '</b>' : (f.source === 'sales' ? 'Получатель' : 'Получатель (подразделение)') + ': <b>' + E(p.recipient) + '</b>');
  if (f.period) extra.push('за период с <b>' + E(_tsOpRuDay_(p.from)) + '</b> по <b>' + E(_tsOpRuDay_(p.to)) + '</b>');
  if (f.source === 'balance' && !f.period && (p.from || p.to || labels.from)) extra.push('Сдаёт: <b>' + E(p.from || '__________') + '</b> · Принимает: <b>' + E(p.to || '__________') + '</b>');
  if (f.source === 'staff' && p.dish) extra.push('Рацион (блюдо): <b>' + E(p.dish) + '</b>');
  // прочие реквизиты формы (продавец, заказчик, договор, срок, блюдо и число порций) — с подписями из описания формы
  f.params.forEach(function (k) { if (['date', 'division', 'recipient', 'from', 'to'].indexOf(k) >= 0 || (k === 'dish' && f.source === 'staff') || _tsOpBlank_(p[k]) || String(p[k]).trim() === '') return; extra.push(E(labels[k] || k) + ': <b>' + E(p[k]) + '</b>'); });
  var sumCols = { sum: t.sum, saleSum: t.saleSum }, qtyTotal = f.source === 'sales' || f.source === 'staff' || f.qtyTotal;
  var fmtCell = function (r, c) {
    var v = r[c[0]], k = c[0], money = c[2] === 'money', num = c[2] === 'num' || c[2] === 'calc', txt;
    if (money) txt = v === '' || v === undefined || (!(Number(v) > 0) && r.noPrice && /rice/.test(k)) ? (r.noPrice && /rice/.test(k) ? 'нет цены' : '') : _tsOpMoney_(v, /rice/.test(k));
    else if (num) txt = _tsOpBlank_(v) ? '' : _tsOpQty_(v);
    else txt = k === 'pct' && v !== '' && v !== undefined ? String(v).replace('.', ',') : v;
    return '<td style="' + cell + (money || num || k === 'pct' ? 'text-align:right;' : '') + (txt === 'нет цены' ? 'color:#a33;' : '') + '">' + E(txt) + '</td>';
  };
  // таблица по набору колонок; для разворота 2А4L — две половины на разных листах, нумерация граф сквозная
  var table = function (cols, offset) {
    var th = '<tr><th style="' + cell + 'width:24px">№</th>' + cols.map(function (c) { return '<th style="' + cell + 'font-weight:normal;font-size:9px">' + E(c[1]) + '</th>'; }).join('') + '</tr>' +
      '<tr><td style="' + cell + 'text-align:center;font-size:8px">1</td>' + cols.map(function (c, i) { return '<td style="' + cell + 'text-align:center;font-size:8px">' + (offset + i + 2) + '</td>'; }).join('') + '</tr>';
    var body = rows.map(function (r, i) { return '<tr><td style="' + cell + 'text-align:center">' + (i + 1) + '</td>' + cols.map(function (c) { return fmtCell(r, c); }).join('') + '</tr>'; }).join('');
    var tot = '<tr><td style="' + cell + '"></td>' + cols.map(function (c, i) {
      if (i === 0) return '<td style="' + cell + 'font-weight:bold">Итого</td>';
      if (c[0] in sumCols) return '<td style="' + cell + 'text-align:right;font-weight:bold">' + _tsOpMoney_(sumCols[c[0]]) + '</td>';
      if (c[0] === 'qty' && qtyTotal) return '<td style="' + cell + 'text-align:right;font-weight:bold">' + _tsOpQty_(t.qty) + '</td>';
      return '<td style="' + cell + '"></td>';
    }).join('') + '</tr>';
    return '<table style="width:100%;border-collapse:collapse;font-size:10px">' + th + body + tot + '</table>';
  };
  var tables;
  if (fm.split) {
    var half = Math.ceil(f.cols.length / 2);
    tables = '<div style="font-size:9px;color:#333;margin:2px 0">Левая сторона разворота (лист 1)</div>' + table(f.cols.slice(0, half), 0) +
      '<div style="page-break-before:always;break-before:page;font-size:9px;color:#333;margin:10px 0 2px">Правая сторона разворота (лист 2) — ' + E(f.code) + ' № ' + E(d.n) + '</div>' + table(f.cols.slice(half), half);
  } else tables = table(f.cols, 0);
  var hasMoney = f.cols.some(function (c) { return c[0] in sumCols; });
  var words = hasMoney ? '<p style="font-size:11px;margin:8px 0">Итого на сумму: <b>' + E(_tsOpRubWords_(t.main)) + '</b>' + (f.source === 'sales' && t.sum ? ' (по учётным ценам — ' + E(_tsOpMoney_(t.sum)) + ' руб.)' : '') + '</p>' : '';
  var calcBox = '';
  if (f.source === 'ttk') {
    calcBox = '<p style="font-size:11px;margin:4px 0">Себестоимость (стоимость сырьевого набора) 1 порции: <b>' + E(_tsOpMoney_(info.cost || 0)) + '</b> руб.' +
      ' · Цена продажи 1 порции: <b>' + (info.salePrice > 0 ? E(_tsOpMoney_(info.salePrice)) + '</b> руб.' : 'не задана</b> («Экономика → Цены меню»)') +
      (info.markup !== null && info.markup !== undefined ? ' · Наценка: <b>' + E(String(info.markup).replace('.', ',')) + ' %</b>' : '') + '</p>';
  }
  if (info.needs && info.needs.length) {
    calcBox += '<div style="font-size:11px;margin:8px 0 2px;font-weight:bold">Потребность в сырье по нормам ТТК</div><table style="width:100%;border-collapse:collapse;font-size:10px">' +
      '<tr><th style="' + cell + 'font-weight:normal">Продукт</th><th style="' + cell + 'font-weight:normal">Ед. изм.</th><th style="' + cell + 'font-weight:normal">Количество</th>' +
      '<th style="' + cell + 'font-weight:normal">Цена, руб. коп.</th><th style="' + cell + 'font-weight:normal">Сумма, руб. коп.</th></tr>' +
      info.needs.map(function (x) { return '<tr><td style="' + cell + '">' + E(x.name) + '</td><td style="' + cell + '">' + E(x.unit) + '</td><td style="' + cell + 'text-align:right">' + _tsOpQty_(x.qty) +
        '</td><td style="' + cell + 'text-align:right">' + (x.price > 0 ? _tsOpMoney_(x.price, true) : '') + '</td><td style="' + cell + 'text-align:right">' + (x.sum > 0 ? _tsOpMoney_(x.sum) : '') + '</td></tr>'; }).join('') + '</table>';
  }
  var np = rows.filter(function (r) { return r.noPrice; }).length;
  var warn = np ? '<p style="font-size:10px;color:#a33">Без цены строк: ' + np + '. Укажите цену в меню («Экономика → Цены меню») или приход на склад — тогда она подставится сама.</p>' : '';
  var signs = '<table style="width:100%;margin-top:18px;font-size:11px;border-collapse:collapse">' + f.signs.map(function (s, i) {
    return '<tr><td style="width:34%;padding:8px 6px 0 0">' + E(s) + '</td><td style="padding-top:8px"><div style="border-bottom:1px solid #000;min-height:14px"></div><div style="' + small + 'border:0">должность</div></td>' +
      '<td style="padding:8px 6px 0"><div style="border-bottom:1px solid #000;min-height:14px"></div><div style="' + small + 'border:0">подпись</div></td>' +
      '<td style="padding-top:8px"><div style="border-bottom:1px solid #000;min-height:14px"></div><div style="' + small + 'border:0">расшифровка подписи</div></td></tr>';
  }).join('') + '</table>';
  var foot = '<div style="margin-top:12px;font-size:8px;color:#666">Составил: ' + E(d.who || '') + ' · формат ' + E(fm.label) + ' · сформировано в ЦЕХ Стандарт</div>';
  return '<style>@page{size:' + fm.page + ';margin:10mm}</style><div style="font:11px/1.35 Arial,sans-serif;color:#000;max-width:' + fm.width + 'px">' + head + approve + title +
    (extra.length ? '<div style="font-size:11px;margin:4px 0 6px">' + extra.join(' · ') + '</div>' : '') +
    tables + words + calcBox + warn + signs + foot + '</div>';
}

/** Перечень форм первичной учётной документации (ОП-1…ОП-25) с форматами листов — для печати. */
function _tsOpCatalogHtml_() {
  var cell = 'border:1px solid #000;padding:3px 6px;';
  return '<style>@page{size:A4 portrait;margin:12mm}</style><div style="font:11px/1.35 Arial,sans-serif;color:#000;max-width:760px">' +
    '<h3 style="text-align:center;margin:0 0 8px">ПЕРЕЧЕНЬ ФОРМ ПЕРВИЧНОЙ УЧЕТНОЙ ДОКУМЕНТАЦИИ</h3>' +
    '<div style="text-align:center;font-size:10px;margin-bottom:8px">по учёту операций в общественном питании (постановление Госкомстата России от 25.12.1998 № 132)</div>' +
    '<table style="width:100%;border-collapse:collapse"><tr><th style="' + cell + '">Номер формы</th><th style="' + cell + '">Наименование формы</th><th style="' + cell + '">Код по ОКУД</th><th style="' + cell + '">Формат</th></tr>' +
    Object.keys(TS_OP_FORMS_).map(function (k) { var f = TS_OP_FORMS_[k]; return '<tr><td style="' + cell + 'white-space:nowrap">' + _tsOpE_(f.code) + '</td><td style="' + cell + '">' + _tsOpE_(f.title) +
      '</td><td style="' + cell + 'text-align:center">' + f.okud + '</td><td style="' + cell + 'white-space:nowrap">' + _tsOpE_(TS_OP_FORMATS_[f.format].label) + '</td></tr>'; }).join('') + '</table></div>';
}
