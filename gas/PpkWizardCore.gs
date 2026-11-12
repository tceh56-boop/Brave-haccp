// ЦЕХ — PpkWizardCore.gs
// «Мастер ППК»: цифровое предприятие по шагам, из которого собирается программа
// производственного контроля.
//   предприятие → помещения и зоны (площадь) → оборудование по категориям → инвентарь и
//   маркировка → дезинфекция (расчёт средства по площади) → номенклатура/ТТК → процессы и потоки →
//   опасности → контроль → журналы → документ.
// Правило: система предлагает типовой состав, человек отмечает, что у него есть на самом деле.
// Предложение ничего не создаёт само. Нормы, которые зависят от изготовителя (температуры
// хранения, режимы дезсредств), предлагаются с источником «сверить» или вводятся по инструкции.

var PPK_WZ_SANPIN = 'СанПиН 2.3/2.4.3590-20 (сверьте с действующей редакцией)';

/** Типы предприятий: состав помещений по умолчанию. */
var PPK_WZ_TEMPLATES = {
  RESTAURANT: { name: 'Ресторан полного цикла (работает на сырье)', premises: ['LOADING', 'STORE_DRY', 'STORE_VEG', 'COLD_ROOMS', 'PREP_MEAT', 'PREP_VEG', 'HOT', 'COLD', 'PASTRY', 'WASH_KITCHEN', 'WASH_TABLE', 'SERVICE', 'HALL', 'STAFF_ROOM', 'CLEANING_ROOM', 'WASTE'] },
  CAFE: { name: 'Кафе', premises: ['LOADING', 'STORE_DRY', 'COLD_ROOMS', 'PREP_MEAT', 'PREP_VEG', 'HOT', 'COLD', 'WASH_KITCHEN', 'WASH_TABLE', 'HALL', 'STAFF_ROOM', 'CLEANING_ROOM', 'WASTE'] },
  CANTEEN: { name: 'Столовая', premises: ['LOADING', 'STORE_DRY', 'STORE_VEG', 'COLD_ROOMS', 'PREP_MEAT', 'PREP_VEG', 'HOT', 'COLD', 'WASH_KITCHEN', 'WASH_TABLE', 'SERVICE', 'HALL', 'STAFF_ROOM', 'CLEANING_ROOM', 'WASTE'] },
  FACTORY: { name: 'Фабрика-кухня / заготовочное производство', premises: ['LOADING', 'STORE_DRY', 'STORE_VEG', 'COLD_ROOMS', 'PREP_MEAT', 'PREP_FISH', 'PREP_POULTRY', 'PREP_VEG', 'HOT', 'COLD', 'PASTRY', 'PACKING', 'EXPEDITION', 'WASH_KITCHEN', 'STAFF_ROOM', 'CLEANING_ROOM', 'WASTE'] },
  CATERING: { name: 'Кейтеринг / выездное обслуживание', premises: ['LOADING', 'STORE_DRY', 'COLD_ROOMS', 'PREP_MEAT', 'PREP_VEG', 'HOT', 'COLD', 'PACKING', 'EXPEDITION', 'WASH_KITCHEN', 'STAFF_ROOM', 'CLEANING_ROOM', 'WASTE'] },
  FINISHING: { name: 'Доготовочное кафе (работает на полуфабрикатах)', premises: ['LOADING', 'STORE_DRY', 'COLD_ROOMS', 'HOT', 'COLD', 'WASH_KITCHEN', 'WASH_TABLE', 'HALL', 'STAFF_ROOM', 'CLEANING_ROOM', 'WASTE'] }
};

/** Помещения: зона (сырьё — «грязная», готовая продукция — «чистая»), тип цеха, типовое оснащение. */
var PPK_WZ_PREMISES = {
  LOADING: { name: 'Загрузочная / зона приёмки', zone: 'грязная', ws: 'СКЛАД', equipment: { SCALES_FLOOR: 1, PROBE: 1, TROLLEY: 1, HANDWASH: 1 }, inventory: ['WASTE_BIN', 'CLEAN_PROD'] },
  STORE_DRY: { name: 'Кладовая сухих продуктов', zone: 'нейтральная', ws: 'СКЛАД', equipment: { RACK: 2, PALLET: 2, HYGROMETER: 1 }, inventory: ['CLEAN_PROD'] },
  STORE_VEG: { name: 'Кладовая овощей', zone: 'грязная', ws: 'СКЛАД', equipment: { RACK: 1, PALLET: 2, HYGROMETER: 1 }, inventory: ['CLEAN_PROD'] },
  COLD_ROOMS: { name: 'Охлаждаемые камеры / холодильная кладовая', zone: 'нейтральная', ws: 'СКЛАД', equipment: { FRIDGE: 2, FREEZER: 1, FRIDGE_THERMO: 3, RACK: 1 }, inventory: ['CLEAN_PROD'] },
  PREP_MEAT: { name: 'Мясо-рыбный цех', zone: 'грязная', ws: 'МЯСНОЙ', equipment: { TABLE_SS: 2, SINK: 2, HANDWASH: 1, MEAT_BLOCK: 1, MINCER: 1, FRIDGE: 1, FRIDGE_THERMO: 1, SCALES_TABLE: 1, UV: 1 }, inventory: ['BOARD_SM', 'KNIFE_SM', 'BOARD_SR', 'KNIFE_SR', 'GN_SM', 'GN_SR', 'EGG_BOX', 'WASTE_BIN', 'HAND_KIT', 'CLEAN_PROD'] },
  PREP_FISH: { name: 'Рыбный цех', zone: 'грязная', ws: 'РЫБНЫЙ', equipment: { TABLE_SS: 1, SINK: 2, HANDWASH: 1, FRIDGE: 1, FRIDGE_THERMO: 1, SCALES_TABLE: 1, UV: 1 }, inventory: ['BOARD_SR', 'KNIFE_SR', 'GN_SR', 'WASTE_BIN', 'HAND_KIT', 'CLEAN_PROD'] },
  PREP_POULTRY: { name: 'Цех обработки птицы', zone: 'грязная', ws: 'ПТИЦА', equipment: { TABLE_SS: 1, SINK: 2, HANDWASH: 1, FRIDGE: 1, FRIDGE_THERMO: 1, SCALES_TABLE: 1, UV: 1 }, inventory: ['BOARD_SP', 'KNIFE_SP', 'GN_SP', 'WASTE_BIN', 'HAND_KIT', 'CLEAN_PROD'] },
  PREP_VEG: { name: 'Овощной цех', zone: 'грязная', ws: 'ОВОЩНОЙ', equipment: { TABLE_SS: 1, SINK: 2, HANDWASH: 1, PEELER: 1, VEG_CUTTER: 1, FRIDGE: 1, FRIDGE_THERMO: 1 }, inventory: ['BOARD_SO', 'KNIFE_SO', 'GN_SO', 'WASTE_BIN', 'HAND_KIT', 'CLEAN_PROD'] },
  HOT: { name: 'Горячий цех', zone: 'чистая', ws: 'ГОРЯЧИЙ', equipment: { STOVE: 1, COMBI: 1, FRYER: 1, GRILL: 1, BLAST: 1, TABLE_SS: 2, FRIDGE_TABLE: 1, FRIDGE_THERMO: 1, SINK: 1, HANDWASH: 1, HOOD: 1, PROBE: 1, SCALES_TABLE: 1 }, inventory: ['BOARD_VM', 'KNIFE_VM', 'BOARD_VO', 'KNIFE_VO', 'BOARD_GREEN', 'BOARD_SM', 'GN_VM', 'WASTE_BIN', 'HAND_KIT', 'CLEAN_PROD'] },
  COLD: { name: 'Холодный цех', zone: 'чистая', ws: 'ХОЛОДНЫЙ', equipment: { TABLE_SS: 1, FRIDGE_TABLE: 1, FRIDGE: 1, FRIDGE_THERMO: 2, SLICER: 1, BLENDER: 1, SCALES_TABLE: 1, SINK: 1, HANDWASH: 1, UV: 1, PROBE: 1 }, inventory: ['BOARD_VM', 'KNIFE_VM', 'BOARD_VR', 'KNIFE_VR', 'BOARD_VO', 'KNIFE_VO', 'BOARD_G', 'KNIFE_G', 'BOARD_GREEN', 'BOARD_HERRING', 'BOARD_BREAD', 'KNIFE_BREAD', 'GN_VM', 'WASTE_BIN', 'HAND_KIT', 'CLEAN_PROD'] },
  PASTRY: { name: 'Кондитерский цех', zone: 'чистая', ws: 'КОНДИТЕРСКИЙ', equipment: { MIXER: 1, DOUGH: 1, OVEN: 1, FRIDGE: 1, FRIDGE_THERMO: 1, TABLE_SS: 1, SCALES_TABLE: 1, SINK: 1, HANDWASH: 1, UV: 1 }, inventory: ['BOARD_DOUGH', 'BOARD_CREAM', 'EGG_BOX', 'WASTE_BIN', 'HAND_KIT', 'CLEAN_PROD'] },
  PACKING: { name: 'Участок упаковки и комплектации', zone: 'чистая', ws: 'ЗАГОТОВОЧНЫЙ', equipment: { TABLE_SS: 1, VACUUM: 1, SCALES_TABLE: 1, FRIDGE: 1, FRIDGE_THERMO: 1, HANDWASH: 1, UV: 1 }, inventory: ['HAND_KIT', 'WASTE_BIN', 'CLEAN_PROD'] },
  EXPEDITION: { name: 'Экспедиция', zone: 'чистая', ws: 'СКЛАД', equipment: { FRIDGE: 1, FRIDGE_THERMO: 1, PROBE: 1, RACK: 1 }, inventory: ['CLEAN_PROD'] },
  WASH_KITCHEN: { name: 'Моечная кухонной посуды', zone: 'грязная', ws: 'МОЕЧНЫЙ', equipment: { SINK: 2, RACK: 1, HANDWASH: 1 }, inventory: ['WASH_KIT', 'WASTE_BIN', 'CLEAN_PROD'] },
  WASH_TABLE: { name: 'Моечная столовой посуды', zone: 'грязная', ws: 'МОЕЧНЫЙ', equipment: { DISHWASHER: 1, SINK: 1, RACK: 1, HANDWASH: 1 }, inventory: ['WASH_KIT', 'WASTE_BIN', 'CLEAN_PROD'] },
  SERVICE: { name: 'Раздача', zone: 'чистая', ws: '', equipment: { BAINMARIE: 1, SHOWCASE: 1, FRIDGE_THERMO: 1, PROBE: 1, HANDWASH: 1 }, inventory: ['HAND_KIT'] },
  HALL: { name: 'Обеденный зал', zone: 'нейтральная', ws: '', equipment: { HANDWASH: 1 }, inventory: ['CLEAN_HALL'] },
  STAFF_ROOM: { name: 'Помещения для персонала (гардероб, комната приёма пищи)', zone: 'нейтральная', ws: '', equipment: {}, inventory: ['FIRST_AID'] },
  CLEANING_ROOM: { name: 'Кладовая уборочного инвентаря и дезсредств', zone: 'нейтральная', ws: '', equipment: { SINK: 1, RACK: 1 }, inventory: ['CLEAN_TOILET', 'DISINF_TANK'] },
  WASTE: { name: 'Помещение / площадка для отходов', zone: 'грязная', ws: '', equipment: {}, inventory: ['WASTE_CONTAINER'] },
  OTHER: { name: 'Другое помещение', zone: 'нейтральная', ws: '', equipment: {}, inventory: [] }
};

var PPK_WZ_CATEGORIES = ['ТЕПЛОВОЕ', 'ХОЛОДИЛЬНОЕ', 'НЕЙТРАЛЬНОЕ', 'МЕХАНИЧЕСКОЕ', 'УПАКОВОЧНОЕ', 'МОЕЧНОЕ', 'ВЕСОИЗМЕРИТЕЛЬНОЕ', 'ИЗМЕРИТЕЛЬНОЕ', 'ВЕНТИЛЯЦИЯ', 'ОБЕЗЗАРАЖИВАНИЕ'];

/** Журналы, которые порождает оборудование. Периодичность — значения JOURNAL_DEFINITIONS. */
var PPK_WZ_JOURNALS = {
  FRIDGE_TEMP: { name: 'Журнал учёта температурного режима холодильного оборудования', period: 'по_слотам_смены', role: 'ПОВАР', answer: 'ЧИСЛО', unit: '°C', source: PPK_WZ_SANPIN + ', форма журнала — приложение к СанПиН' },
  FRYING_FAT: { name: 'Журнал учёта использования фритюрных жиров', period: 'разово_в_смену', role: 'ПОВАР', answer: 'ДА_НЕТ', question: 'Фритюрный жир оценён органолептически, замена — по результату оценки', source: PPK_WZ_SANPIN + ', форма журнала — приложение к СанПиН' },
  UV_LAMP: { name: 'Журнал регистрации и контроля работы бактерицидной установки', period: 'ежедневно', role: 'ШЕФ-ПОВАР', answer: 'ДА_НЕТ', question: 'Установка включалась по графику, время работы записано', source: 'Р 3.5.1904-04 и паспорт установки (сверьте)' },
  STORE_TH: { name: 'Журнал учёта температуры и влажности в складских помещениях', period: 'ежедневно', role: 'КЛАДОВЩИК', answer: 'ЧИСЛО', unit: '°C', source: PPK_WZ_SANPIN + ', форма журнала — приложение к СанПиН' }
};

/** Оборудование. Температуры — типовые предложения, сверяются с условиями хранения изготовителя. */
var PPK_WZ_EQUIPMENT = {
  STOVE: { cat: 'ТЕПЛОВОЕ', name: 'Плита' },
  COMBI: { cat: 'ТЕПЛОВОЕ', name: 'Пароконвектомат' },
  OVEN: { cat: 'ТЕПЛОВОЕ', name: 'Жарочный шкаф' },
  FRYER: { cat: 'ТЕПЛОВОЕ', name: 'Фритюрница', journal: 'FRYING_FAT' },
  GRILL: { cat: 'ТЕПЛОВОЕ', name: 'Гриль / жарочная поверхность' },
  PAN: { cat: 'ТЕПЛОВОЕ', name: 'Сковорода электрическая' },
  KETTLE: { cat: 'ТЕПЛОВОЕ', name: 'Котёл пищеварочный' },
  BAINMARIE: { cat: 'ТЕПЛОВОЕ', name: 'Мармит' },
  SOUSVIDE: { cat: 'ТЕПЛОВОЕ', name: 'Су-вид (термостат)' },
  FRIDGE: { cat: 'ХОЛОДИЛЬНОЕ', name: 'Шкаф холодильный', tmin: 2, tmax: 6, journal: 'FRIDGE_TEMP', needs_thermo: true },
  FREEZER: { cat: 'ХОЛОДИЛЬНОЕ', name: 'Шкаф / ларь морозильный', tmax: -18, journal: 'FRIDGE_TEMP', needs_thermo: true },
  BLAST: { cat: 'ХОЛОДИЛЬНОЕ', name: 'Шкаф шоковой заморозки / охлаждения' },
  FRIDGE_TABLE: { cat: 'ХОЛОДИЛЬНОЕ', name: 'Стол холодильный', tmin: 2, tmax: 6, journal: 'FRIDGE_TEMP', needs_thermo: true },
  SHOWCASE: { cat: 'ХОЛОДИЛЬНОЕ', name: 'Витрина холодильная', tmin: 2, tmax: 6, journal: 'FRIDGE_TEMP', needs_thermo: true },
  COLD_ROOM: { cat: 'ХОЛОДИЛЬНОЕ', name: 'Камера холодильная', tmin: 2, tmax: 6, journal: 'FRIDGE_TEMP', needs_thermo: true },
  FREEZE_ROOM: { cat: 'ХОЛОДИЛЬНОЕ', name: 'Камера низкотемпературная', tmax: -18, journal: 'FRIDGE_TEMP', needs_thermo: true },
  ICE: { cat: 'ХОЛОДИЛЬНОЕ', name: 'Льдогенератор' },
  TABLE_SS: { cat: 'НЕЙТРАЛЬНОЕ', name: 'Стол производственный (нержавеющая сталь)' },
  RACK: { cat: 'НЕЙТРАЛЬНОЕ', name: 'Стеллаж' },
  SINK: { cat: 'НЕЙТРАЛЬНОЕ', name: 'Ванна моечная' },
  HANDWASH: { cat: 'НЕЙТРАЛЬНОЕ', name: 'Раковина для мытья рук (с дозаторами мыла и антисептика)' },
  PALLET: { cat: 'НЕЙТРАЛЬНОЕ', name: 'Подтоварник' },
  TROLLEY: { cat: 'НЕЙТРАЛЬНОЕ', name: 'Тележка' },
  MEAT_BLOCK: { cat: 'НЕЙТРАЛЬНОЕ', name: 'Колода / стол для разруба мяса' },
  MINCER: { cat: 'МЕХАНИЧЕСКОЕ', name: 'Мясорубка' },
  VEG_CUTTER: { cat: 'МЕХАНИЧЕСКОЕ', name: 'Овощерезка' },
  PEELER: { cat: 'МЕХАНИЧЕСКОЕ', name: 'Картофелечистка' },
  MIXER: { cat: 'МЕХАНИЧЕСКОЕ', name: 'Миксер планетарный' },
  DOUGH: { cat: 'МЕХАНИЧЕСКОЕ', name: 'Тестомес' },
  SLICER: { cat: 'МЕХАНИЧЕСКОЕ', name: 'Слайсер' },
  BLENDER: { cat: 'МЕХАНИЧЕСКОЕ', name: 'Блендер' },
  VACUUM: { cat: 'УПАКОВОЧНОЕ', name: 'Вакуумный упаковщик' },
  SEALER: { cat: 'УПАКОВОЧНОЕ', name: 'Запайщик лотков' },
  LABELER: { cat: 'УПАКОВОЧНОЕ', name: 'Принтер этикеток / весы с печатью этикеток' },
  DISHWASHER: { cat: 'МОЕЧНОЕ', name: 'Посудомоечная машина' },
  SCALES_FLOOR: { cat: 'ВЕСОИЗМЕРИТЕЛЬНОЕ', name: 'Весы товарные', verify: true },
  SCALES_TABLE: { cat: 'ВЕСОИЗМЕРИТЕЛЬНОЕ', name: 'Весы настольные', verify: true },
  PROBE: { cat: 'ИЗМЕРИТЕЛЬНОЕ', name: 'Термометр-щуп', verify: true },
  FRIDGE_THERMO: { cat: 'ИЗМЕРИТЕЛЬНОЕ', name: 'Термометр для холодильного оборудования', verify: true, thermo: true },
  HYGROMETER: { cat: 'ИЗМЕРИТЕЛЬНОЕ', name: 'Термогигрометр', verify: true, journal: 'STORE_TH' },
  HOOD: { cat: 'ВЕНТИЛЯЦИЯ', name: 'Зонт вытяжной' },
  UV: { cat: 'ОБЕЗЗАРАЖИВАНИЕ', name: 'Облучатель-рециркулятор бактерицидный', journal: 'UV_LAMP' },
  WATER_FILTER: { cat: 'ОБЕЗЗАРАЖИВАНИЕ', name: 'Фильтр для воды' },
  INSECT_LAMP: { cat: 'ОБЕЗЗАРАЖИВАНИЕ', name: 'Ловушка для летающих насекомых' }
};

/** Инвентарь. Буквенная маркировка — традиционная для пищеблоков; цвет — по системе предприятия. */
var PPK_WZ_INVENTORY = {
  BOARD_SM: { cat: 'Разделочный', name: 'Доска разделочная', marking: 'СМ', meaning: 'сырое мясо', color: 'красный' },
  KNIFE_SM: { cat: 'Разделочный', name: 'Нож', marking: 'СМ', meaning: 'сырое мясо', color: 'красный' },
  BOARD_SR: { cat: 'Разделочный', name: 'Доска разделочная', marking: 'СР', meaning: 'сырая рыба', color: 'синий' },
  KNIFE_SR: { cat: 'Разделочный', name: 'Нож', marking: 'СР', meaning: 'сырая рыба', color: 'синий' },
  BOARD_SP: { cat: 'Разделочный', name: 'Доска разделочная', marking: 'СП', meaning: 'сырая птица', color: 'жёлтый' },
  KNIFE_SP: { cat: 'Разделочный', name: 'Нож', marking: 'СП', meaning: 'сырая птица', color: 'жёлтый' },
  BOARD_SO: { cat: 'Разделочный', name: 'Доска разделочная', marking: 'СО', meaning: 'сырые овощи', color: 'зелёный' },
  KNIFE_SO: { cat: 'Разделочный', name: 'Нож', marking: 'СО', meaning: 'сырые овощи', color: 'зелёный' },
  BOARD_VM: { cat: 'Разделочный', name: 'Доска разделочная', marking: 'ВМ', meaning: 'варёное мясо', color: 'коричневый' },
  KNIFE_VM: { cat: 'Разделочный', name: 'Нож', marking: 'ВМ', meaning: 'варёное мясо', color: 'коричневый' },
  BOARD_VR: { cat: 'Разделочный', name: 'Доска разделочная', marking: 'ВР', meaning: 'варёная рыба', color: '' },
  KNIFE_VR: { cat: 'Разделочный', name: 'Нож', marking: 'ВР', meaning: 'варёная рыба', color: '' },
  BOARD_VO: { cat: 'Разделочный', name: 'Доска разделочная', marking: 'ВО', meaning: 'варёные овощи', color: '' },
  KNIFE_VO: { cat: 'Разделочный', name: 'Нож', marking: 'ВО', meaning: 'варёные овощи', color: '' },
  BOARD_G: { cat: 'Разделочный', name: 'Доска разделочная', marking: 'Г', meaning: 'гастрономия', color: 'белый' },
  KNIFE_G: { cat: 'Разделочный', name: 'Нож', marking: 'Г', meaning: 'гастрономия', color: 'белый' },
  BOARD_GREEN: { cat: 'Разделочный', name: 'Доска разделочная', marking: 'Зелень', meaning: 'зелень', color: '' },
  BOARD_HERRING: { cat: 'Разделочный', name: 'Доска разделочная', marking: 'Сельдь', meaning: 'сельдь', color: '' },
  BOARD_BREAD: { cat: 'Разделочный', name: 'Доска разделочная', marking: 'Х', meaning: 'хлеб', color: '' },
  KNIFE_BREAD: { cat: 'Разделочный', name: 'Нож', marking: 'Х', meaning: 'хлеб', color: '' },
  BOARD_DOUGH: { cat: 'Разделочный', name: 'Доска / стол для теста', marking: 'Тесто', meaning: 'тесто', color: '' },
  BOARD_CREAM: { cat: 'Разделочный', name: 'Инвентарь для крема', marking: 'Крем', meaning: 'крем', color: '' },
  GN_SM: { cat: 'Посуда и ёмкости', name: 'Гастроёмкости / кастрюли', marking: 'СМ', meaning: 'сырое мясо', color: '' },
  GN_SR: { cat: 'Посуда и ёмкости', name: 'Гастроёмкости / кастрюли', marking: 'СР', meaning: 'сырая рыба', color: '' },
  GN_SP: { cat: 'Посуда и ёмкости', name: 'Гастроёмкости / кастрюли', marking: 'СП', meaning: 'сырая птица', color: '' },
  GN_SO: { cat: 'Посуда и ёмкости', name: 'Гастроёмкости / кастрюли', marking: 'СО', meaning: 'сырые овощи', color: '' },
  GN_VM: { cat: 'Посуда и ёмкости', name: 'Гастроёмкости для готовой продукции', marking: 'ВМ / ВО', meaning: 'готовая продукция', color: '' },
  EGG_BOX: { cat: 'Посуда и ёмкости', name: 'Ёмкости для санитарной обработки яиц', marking: 'Яйцо', meaning: 'обработка яиц', color: '' },
  WASH_KIT: { cat: 'Моечный', name: 'Ёрши, щётки, губки для мытья посуды', marking: 'Посуда', meaning: 'мытьё посуды', color: '' },
  HAND_KIT: { cat: 'Гигиена рук', name: 'Дозаторы мыла и кожного антисептика, одноразовые полотенца', marking: '', meaning: 'мытьё и обработка рук', color: '' },
  CLEAN_PROD: { cat: 'Уборочный', name: 'Уборочный инвентарь производственных помещений', marking: 'Для производства', meaning: 'уборка цеха', color: '' },
  CLEAN_HALL: { cat: 'Уборочный', name: 'Уборочный инвентарь обеденного зала', marking: 'Зал', meaning: 'уборка зала', color: '' },
  CLEAN_TOILET: { cat: 'Уборочный', name: 'Уборочный инвентарь санузлов (сигнальная маркировка, хранится отдельно)', marking: 'Санузел', meaning: 'уборка санузлов', color: 'сигнальный' },
  DISINF_TANK: { cat: 'Уборочный', name: 'Ёмкости для приготовления дезрастворов (с крышками, мерные)', marking: 'Дезраствор', meaning: 'дезрастворы', color: '' },
  WASTE_BIN: { cat: 'Отходы', name: 'Бак для отходов с крышкой (педальный)', marking: 'Отходы', meaning: 'пищевые отходы', color: '' },
  WASTE_CONTAINER: { cat: 'Отходы', name: 'Контейнер для ТКО с крышкой', marking: 'ТКО', meaning: 'отходы', color: '' },
  FIRST_AID: { cat: 'Прочее', name: 'Аптечка первой помощи', marking: '', meaning: 'первая помощь', color: '' }
};

var PPK_WZ_DISINF_FORMS = { LIQUID: 'Жидкий концентрат', TABLETS: 'Таблетки', POWDER: 'Порошок / гранулы' };
var PPK_WZ_REGIMENS = { CURRENT: 'Текущая уборка', GENERAL: 'Генеральная уборка', EQUIPMENT: 'Оборудование и инвентарь' };

/** Этапы процесса → помещения и оборудование, на которых они проходят. */
var PPK_WZ_STAGE_PREMISES = {
  RECEIPT: { premises: ['LOADING'], cats: ['ВЕСОИЗМЕРИТЕЛЬНОЕ', 'ИЗМЕРИТЕЛЬНОЕ'] },
  STORAGE: { premises: ['STORE_DRY', 'STORE_VEG', 'COLD_ROOMS'], cats: ['ХОЛОДИЛЬНОЕ', 'ИЗМЕРИТЕЛЬНОЕ'] },
  PREPARATION: { premises: ['COLD_ROOMS', 'PREP_MEAT', 'PREP_FISH', 'PREP_POULTRY', 'PREP_VEG'], cats: ['ХОЛОДИЛЬНОЕ'] },
  PRIMARY_PROCESSING: { premises: ['PREP_MEAT', 'PREP_FISH', 'PREP_POULTRY', 'PREP_VEG'], cats: ['МЕХАНИЧЕСКОЕ', 'НЕЙТРАЛЬНОЕ'] },
  TECH_PROCESS: { premises: ['PREP_MEAT', 'PREP_FISH', 'PREP_POULTRY', 'PREP_VEG', 'HOT', 'COLD', 'PASTRY'], cats: ['МЕХАНИЧЕСКОЕ'] },
  PRODUCTION: { premises: ['HOT', 'COLD', 'PASTRY'], cats: ['ТЕПЛОВОЕ', 'МЕХАНИЧЕСКОЕ'] },
  THERMAL: { premises: ['HOT', 'PASTRY'], cats: ['ТЕПЛОВОЕ'] },
  COOLING: { premises: ['HOT', 'COLD', 'PASTRY', 'PACKING'], cats: ['ХОЛОДИЛЬНОЕ'] },
  FINISHED_STORAGE: { premises: ['HOT', 'COLD', 'PASTRY', 'EXPEDITION', 'SERVICE'], cats: ['ХОЛОДИЛЬНОЕ'] },
  ASSEMBLY: { premises: ['COLD', 'SERVICE', 'PACKING'], cats: ['УПАКОВОЧНОЕ', 'ВЕСОИЗМЕРИТЕЛЬНОЕ'] },
  DISTRIBUTION: { premises: ['SERVICE', 'HALL', 'EXPEDITION'], cats: ['ТЕПЛОВОЕ', 'ХОЛОДИЛЬНОЕ'] }
};

// ---------- общие ----------

function _wzCtx_(session, data) {
  var c = _ppkCtx_(session, data && data.locationId);
  return { org: c.organizationId, loc: c.locationId, location: c.location };
}
function _wzNum_(v) { if (v === '' || v === null || v === undefined) return null; var n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
function _wzR_(v, d) { var m = Math.pow(10, d || 0); return Math.round(Number(v) * m) / m; }
function _wzJson_(v, fb) { return _ppkJson_(v, fb); }
function _wzActive_(r) { return r.status !== 'ARCHIVED'; }
function _wzEqActive_(e) { return e.active !== false && e.active !== 'false' && e.статус !== 'выведено'; }

function _wzEnterprise_(c) { return findRows_('PPK_ENTERPRISE', function (r) { return r.organization_id === c.org && r.location_id === c.loc; })[0] || null; }
function _wzPremises_(c) { return findRows_('PREMISES', function (r) { return r.organization_id === c.org && r.location_id === c.loc && _wzActive_(r); }); }
function _wzEquipment_(c) { return findRows_('EQUIPMENT', function (r) { return r.location_id === c.loc && _wzEqActive_(r); }); }
function _wzInventory_(c) { return findRows_('INVENTORY_ITEMS', function (r) { return r.organization_id === c.org && r.location_id === c.loc && _wzActive_(r); }); }
function _wzDisinfectants_(c) { return findRows_('DISINFECTANTS', function (r) { return r.organization_id === c.org && _wzActive_(r); }); }
function _wzPlans_(c) { return findRows_('DISINFECTION_PLANS', function (r) { return r.organization_id === c.org && r.location_id === c.loc && _wzActive_(r); }); }
function _wzPremise_(session, c, premiseId) {
  var p = findOne_('PREMISES', 'premise_id', premiseId);
  if (!p) throw new Error('Помещение не найдено: ' + premiseId);
  assertOwnedByOrg_(session, p, 'PREMISES:' + premiseId);
  if (p.location_id !== c.loc) _denyScope_(session, 'PREMISES:' + premiseId, 'foreign_location');
  return p;
}
function _wzKindOf_(e) { return e.kind_code && PPK_WZ_EQUIPMENT[e.kind_code] ? e.kind_code : ''; }
function _wzCatOf_(e) { var k = _wzKindOf_(e); return e.category || (k ? PPK_WZ_EQUIPMENT[k].cat : ''); }

/** Справочники мастера для экрана. */
function getPpkWizardCatalog_() {
  return { templates: PPK_WZ_TEMPLATES, premises: PPK_WZ_PREMISES, categories: PPK_WZ_CATEGORIES, equipment: PPK_WZ_EQUIPMENT, inventory: PPK_WZ_INVENTORY,
    journals: PPK_WZ_JOURNALS, disinfectant_forms: PPK_WZ_DISINF_FORMS, regimens: PPK_WZ_REGIMENS, workshop_types: CONFIG.WORKSHOP_TYPES };
}

// ---------- шаг 1. Предприятие ----------

var PPK_WZ_ENTERPRISE_FIELDS = ['template_code', 'format', 'service_type', 'seats', 'meals_per_day', 'shifts', 'work_hours', 'staff_count', 'area_m2', 'water_source', 'sewage', 'ventilation',
  'waste_contractor', 'pest_contractor', 'lab_contractor', 'laundry', 'medical_org', 'notes'];

function savePpkEnterprise_(session, data) {
  return withLock_(function () {
    var c = _wzCtx_(session, data), ex = _wzEnterprise_(c), patch = {};
    if (data.template_code && !PPK_WZ_TEMPLATES[data.template_code]) throw new Error('Неизвестный тип предприятия: ' + data.template_code);
    PPK_WZ_ENTERPRISE_FIELDS.forEach(function (k) { if (data[k] !== undefined) patch[k] = String(data[k] === null ? '' : data[k]).trim(); });
    if (data.responsible !== undefined) {
      var resp = (Array.isArray(data.responsible) ? data.responsible : []).map(function (x) { return { role: String(x.role || '').trim(), name: String(x.name || '').trim(), position: String(x.position || '').trim(), order: String(x.order || '').trim() }; }).filter(function (x) { return x.role && x.name; });
      patch.responsible_json = JSON.stringify(resp);
    }
    patch.updated_at = nowIso_();
    var row;
    if (ex) { updateRow_('PPK_ENTERPRISE', ex, patch); row = findOne_('PPK_ENTERPRISE', 'enterprise_id', ex.enterprise_id); }
    else {
      row = { enterprise_id: generateId_('PPK_ENTERPRISE'), organization_id: c.org, location_id: c.loc, status: 'ACTIVE', created_by: session.user_id, created_at: nowIso_() };
      PPK_WZ_ENTERPRISE_FIELDS.forEach(function (k) { row[k] = patch[k] || ''; });
      row.responsible_json = patch.responsible_json || '[]'; row.updated_at = patch.updated_at;
      insertRow_('PPK_ENTERPRISE', row);
    }
    auditLog_(session.user_id, 'Мастер ППК: характеристика предприятия', 'PPK_ENTERPRISE:' + row.enterprise_id, '', JSON.stringify(patch), 'success', session.cascade_id || '');
    return _wzEnterpriseView_(row);
  });
}
function _wzEnterpriseView_(r) {
  if (!r) return null;
  var v = { enterprise_id: r.enterprise_id }; PPK_WZ_ENTERPRISE_FIELDS.forEach(function (k) { v[k] = r[k] === undefined || r[k] === null ? '' : String(r[k]); });
  v.template_name = PPK_WZ_TEMPLATES[r.template_code] ? PPK_WZ_TEMPLATES[r.template_code].name : '';
  v.responsible = _wzJson_(r.responsible_json, []);
  return v;
}

// ---------- шаг 2. Помещения и зоны ----------

/** Предложение помещений по типу предприятия. Уже заведённые отмечены, ничего не создаётся. */
function proposePpkPremises_(session, data) {
  var c = _wzCtx_(session, data), ent = _wzEnterprise_(c), code = (data && data.template_code) || (ent && ent.template_code);
  if (!code || !PPK_WZ_TEMPLATES[code]) throw new Error('Сначала выберите тип предприятия на шаге «Предприятие».');
  var have = _wzPremises_(c);
  return PPK_WZ_TEMPLATES[code].premises.map(function (k) {
    var d = PPK_WZ_PREMISES[k], ex = have.filter(function (p) { return p.code === k; });
    return { code: k, name: d.name, zone: d.zone, workshop_type: d.ws, existing: ex.length, equipment: Object.keys(d.equipment).length, inventory: d.inventory.length };
  });
}

/** Сохранить отмеченные помещения. Для производственных и складских — цех (WORKSHOPS): связывается с существующим того же типа или создаётся. */
function savePpkPremises_(session, data) {
  return withLock_(function () {
    var c = _wzCtx_(session, data), list = (data && data.premises) || [], out = [];
    if (!list.length) throw new Error('Отметьте хотя бы одно помещение.');
    var have = _wzPremises_(c), workshops = findRows_('WORKSHOPS', function (w) { return w.location_id === c.loc && w.статус !== 'архив'; });
    list.forEach(function (x) {
      var code = PPK_WZ_PREMISES[x.code] ? x.code : 'OTHER', d = PPK_WZ_PREMISES[code];
      var name = String(x.name || d.name).trim();
      if (have.some(function (p) { return p.name === name; })) return;
      var area = _wzNum_(x.area_m2), walls = _wzNum_(x.walls_m2);
      if (area !== null && area <= 0) throw new Error('Площадь «' + name + '» — число больше нуля.');
      var zone = ['грязная', 'чистая', 'нейтральная'].indexOf(x.zone) >= 0 ? x.zone : d.zone;
      var wsType = x.workshop_type !== undefined ? x.workshop_type : d.ws, wsId = '';
      if (wsType) {
        var linked = have.map(function (p) { return p.workshop_id; });
        var same = workshops.filter(function (w) { return (w.название === name || w.тип === wsType) && linked.indexOf(w.workshop_id) === -1; });
        var pick = same.filter(function (w) { return w.название === name; })[0] || (same.length === 1 ? same[0] : null);
        if (pick) wsId = pick.workshop_id;
        else { var w = createWorkshop_({ location_id: c.loc, название: name, тип: wsType, описание: 'Создан мастером ППК' }, session.user_id); wsId = w.workshop_id; workshops.push(w); }
      }
      var row = { premise_id: generateId_('PREMISES'), organization_id: c.org, location_id: c.loc, code: code, name: name, zone_class: zone, workshop_id: wsId,
        area_m2: area === null ? '' : area, walls_m2: walls === null ? '' : walls, height_m: _wzNum_(x.height_m) === null ? '' : _wzNum_(x.height_m), floor: String(x.floor || ''), description: String(x.description || ''),
        status: 'ACTIVE', created_by: session.user_id, created_at: nowIso_(), updated_at: nowIso_() };
      insertRow_('PREMISES', row); have.push(row); out.push(row);
    });
    if (out.length) auditLog_(session.user_id, 'Мастер ППК: помещения', 'PREMISES', '', out.map(function (p) { return p.name; }).join(', '), 'success', session.cascade_id || '');
    return { created: out.map(_wzPremiseView_) };
  });
}

function updatePpkPremise_(session, data) {
  return withLock_(function () {
    var c = _wzCtx_(session, data), p = _wzPremise_(session, c, data.premiseId), patch = data.patch || {}, safe = {};
    ['name', 'floor', 'description'].forEach(function (k) { if (patch[k] !== undefined) safe[k] = String(patch[k]).trim(); });
    ['area_m2', 'walls_m2', 'height_m'].forEach(function (k) { if (patch[k] !== undefined) { var n = _wzNum_(patch[k]); if (n !== null && n < 0) throw new Error('Площадь не может быть отрицательной.'); safe[k] = n === null ? '' : n; } });
    if (patch.zone_class !== undefined) { if (['грязная', 'чистая', 'нейтральная'].indexOf(patch.zone_class) === -1) throw new Error('Зона: грязная, чистая или нейтральная.'); safe.zone_class = patch.zone_class; }
    if (safe.name === '') throw new Error('Название помещения обязательно.');
    safe.updated_at = nowIso_();
    updateRow_('PREMISES', p, safe);
    if (safe.name && p.workshop_id) { var w = findOne_('WORKSHOPS', 'workshop_id', p.workshop_id); if (w) updateRow_('WORKSHOPS', w, { название: safe.name, обновлено: nowIso_() }); }
    _wzRecalcPlans_(c, p.premise_id);
    auditLog_(session.user_id, 'Мастер ППК: помещение изменено', 'PREMISES:' + p.premise_id, '', JSON.stringify(safe), 'success', session.cascade_id || '');
    return _wzPremiseView_(findOne_('PREMISES', 'premise_id', p.premise_id));
  });
}

function archivePpkPremise_(session, data) {
  return withLock_(function () {
    var c = _wzCtx_(session, data), p = _wzPremise_(session, c, data.premiseId);
    var eq = _wzEquipment_(c).filter(function (e) { return e.premise_id === p.premise_id; });
    if (eq.length) throw new Error('В помещении числится оборудование (' + eq.length + '). Перенесите или выведите его.');
    updateRow_('PREMISES', p, { status: 'ARCHIVED', updated_at: nowIso_() });
    _wzInventory_(c).filter(function (i) { return i.premise_id === p.premise_id; }).forEach(function (i) { updateRow_('INVENTORY_ITEMS', i, { status: 'ARCHIVED', updated_at: nowIso_() }); });
    _wzPlans_(c).filter(function (x) { return x.premise_id === p.premise_id; }).forEach(function (x) { updateRow_('DISINFECTION_PLANS', x, { status: 'ARCHIVED', updated_at: nowIso_() }); });
    auditLog_(session.user_id, 'Мастер ППК: помещение в архив', 'PREMISES:' + p.premise_id, '', p.name, 'success', session.cascade_id || '');
    return { ok: true };
  });
}

function _wzPremiseView_(p) {
  var d = PPK_WZ_PREMISES[p.code] || PPK_WZ_PREMISES.OTHER;
  return { premise_id: p.premise_id, code: p.code, name: p.name, zone: p.zone_class, workshop_id: p.workshop_id || '', production: !!d.ws && d.ws !== 'СКЛАД',
    area_m2: _wzNum_(p.area_m2), walls_m2: _wzNum_(p.walls_m2), height_m: _wzNum_(p.height_m), floor: p.floor || '', description: p.description || '' };
}

// ---------- шаг 3. Оборудование ----------

/** Типовое оборудование помещения с учётом уже заведённого. */
function proposePpkEquipment_(session, data) {
  var c = _wzCtx_(session, data), p = _wzPremise_(session, c, data.premiseId), d = PPK_WZ_PREMISES[p.code] || PPK_WZ_PREMISES.OTHER;
  var eq = _wzEquipment_(c).filter(function (e) { return e.premise_id === p.premise_id; });
  var kinds = Object.keys(d.equipment);
  return kinds.map(function (k) {
    var cat = PPK_WZ_EQUIPMENT[k], have = eq.filter(function (e) { return e.kind_code === k; }).length;
    return { kind_code: k, category: cat.cat, name: cat.name, suggested: d.equipment[k], existing: have, tmin: cat.tmin === undefined ? '' : cat.tmin, tmax: cat.tmax === undefined ? '' : cat.tmax,
      journal: cat.journal ? PPK_WZ_JOURNALS[cat.journal].name : '', verify: !!cat.verify };
  });
}

/** Добавить оборудование в помещение. Каждая единица — отдельная строка EQUIPMENT с номером. */
function addPpkEquipment_(session, data) {
  return withLock_(function () {
    var c = _wzCtx_(session, data), p = _wzPremise_(session, c, data.premiseId), items = data.items || [], out = [];
    if (!items.length) throw new Error('Отметьте оборудование.');
    var all = _wzEquipment_(c);
    items.forEach(function (x) {
      var k = PPK_WZ_EQUIPMENT[x.kind_code] ? x.kind_code : '', def = k ? PPK_WZ_EQUIPMENT[k] : null;
      var cat = def ? def.cat : String(x.category || '');
      if (PPK_WZ_CATEGORIES.indexOf(cat) === -1) throw new Error('Категория оборудования: ' + PPK_WZ_CATEGORIES.join(', ') + '.');
      var name = String(x.name || (def && def.name) || '').trim(); if (!name) throw new Error('Название оборудования обязательно.');
      var qty = Math.max(1, Math.min(50, Math.floor(_wzNum_(x.qty) || 1)));
      var tmin = x.tmin !== undefined ? _wzNum_(x.tmin) : (def && def.tmin !== undefined ? def.tmin : null), tmax = x.tmax !== undefined ? _wzNum_(x.tmax) : (def && def.tmax !== undefined ? def.tmax : null);
      if (tmin !== null && tmax !== null && tmin > tmax) throw new Error(name + ': нижняя граница температуры выше верхней.');
      var surf = _wzNum_(x.surface_m2);
      for (var i = 0; i < qty; i++) {
        var seq = all.filter(function (e) { return (e.kind_code || '') === k && k; }).length + 1;
        var data2 = { location_id: c.loc, workshop_id: p.workshop_id || '', название: name + (qty > 1 || seq > 1 ? ' №' + seq : ''), тип: name, номер: String(x.number || ''),
          manufacturer: x.manufacturer || '', model: x.model || '', serial_number: x.serial_number || '', inventory_number: x.inventory_number || '',
          calibration_required: def && def.verify ? true : undefined, следующая_проверка: x.next_check || '' };
        if (tmin !== null) data2.мин_температура = tmin;
        if (tmax !== null) data2.макс_температура = tmax;
        var eq = createEquipment_(data2, session.user_id, session);
        var extra = { category: cat, premise_id: p.premise_id, kind_code: k, surface_m2: surf === null ? '' : surf };
        updateRow_('EQUIPMENT', findOne_('EQUIPMENT', 'equipment_id', eq.equipment_id), extra);
        var row = findOne_('EQUIPMENT', 'equipment_id', eq.equipment_id); all.push(row); out.push(_wzEquipmentView_(row));
      }
    });
    _wzRecalcPlans_(c, p.premise_id);
    return { created: out };
  });
}

/** Привязать к помещению оборудование, заведённое раньше без мастера. */
function bindPpkEquipment_(session, data) {
  return withLock_(function () {
    var c = _wzCtx_(session, data), p = _wzPremise_(session, c, data.premiseId), e = findOne_('EQUIPMENT', 'equipment_id', data.equipmentId);
    if (!e || e.location_id !== c.loc) throw new Error('Оборудование не найдено на этой точке.');
    var k = PPK_WZ_EQUIPMENT[data.kind_code] ? data.kind_code : (e.kind_code || ''), cat = k ? PPK_WZ_EQUIPMENT[k].cat : (data.category || e.category || '');
    if (PPK_WZ_CATEGORIES.indexOf(cat) === -1) throw new Error('Укажите вид или категорию оборудования.');
    var patch = { premise_id: p.premise_id, kind_code: k, category: cat };
    if (p.workshop_id) patch.workshop_id = p.workshop_id;
    var surf = _wzNum_(data.surface_m2); if (surf !== null) patch.surface_m2 = surf;
    updateEquipment_(e.equipment_id, patch, session);
    _wzRecalcPlans_(c, p.premise_id);
    return _wzEquipmentView_(findOne_('EQUIPMENT', 'equipment_id', e.equipment_id));
  });
}

function updatePpkEquipment_(session, data) {
  return withLock_(function () {
    var c = _wzCtx_(session, data), e = findOne_('EQUIPMENT', 'equipment_id', data.equipmentId);
    if (!e || e.location_id !== c.loc) throw new Error('Оборудование не найдено на этой точке.');
    var x = data.patch || {}, patch = {};
    ['название', 'номер', 'manufacturer', 'model', 'serial_number', 'inventory_number', 'дата_проверки', 'следующая_проверка'].forEach(function (k) { if (x[k] !== undefined) patch[k] = String(x[k]).trim(); });
    ['мин_температура', 'макс_температура', 'surface_m2'].forEach(function (k) { if (x[k] !== undefined) { var n = _wzNum_(x[k]); patch[k] = n === null ? '' : n; } });
    if (patch.название === '') throw new Error('Название оборудования обязательно.');
    var lo = patch.мин_температура !== undefined ? patch.мин_температура : e.мин_температура, hi = patch.макс_температура !== undefined ? patch.макс_температура : e.макс_температура;
    if (lo !== '' && hi !== '' && Number(lo) > Number(hi)) throw new Error('Нижняя граница температуры выше верхней.');
    updateEquipment_(e.equipment_id, patch, session);
    if (e.premise_id) _wzRecalcPlans_(c, e.premise_id);
    return _wzEquipmentView_(findOne_('EQUIPMENT', 'equipment_id', e.equipment_id));
  });
}

function archivePpkEquipment_(session, data) {
  return withLock_(function () {
    var c = _wzCtx_(session, data), e = findOne_('EQUIPMENT', 'equipment_id', data.equipmentId);
    if (!e || e.location_id !== c.loc) throw new Error('Оборудование не найдено на этой точке.');
    updateEquipment_(e.equipment_id, { active: false, статус: 'выведено' }, session);
    if (e.premise_id) _wzRecalcPlans_(c, e.premise_id);
    return { ok: true };
  });
}

function _wzEquipmentView_(e) {
  var k = _wzKindOf_(e), def = k ? PPK_WZ_EQUIPMENT[k] : null;
  var tmin = e.мин_температура === '' || e.мин_температура === undefined ? null : Number(e.мин_температура), tmax = e.макс_температура === '' || e.макс_температура === undefined ? null : Number(e.макс_температура);
  return { equipment_id: e.equipment_id, name: e.название, kind_code: k, category: _wzCatOf_(e), premise_id: e.premise_id || '', workshop_id: e.workshop_id || '', number: e.номер || '',
    tmin: tmin, tmax: tmax, surface_m2: _wzNum_(e.surface_m2), next_check: String(e.следующая_проверка || ''), verify: !!(def && def.verify), journal_kind: def && def.journal ? def.journal : '',
    manufacturer: e.manufacturer || '', model: e.model || '', serial_number: e.serial_number || '' };
}

// ---------- шаг 4. Инвентарь и маркировка ----------

function proposePpkInventory_(session, data) {
  var c = _wzCtx_(session, data), p = _wzPremise_(session, c, data.premiseId), d = PPK_WZ_PREMISES[p.code] || PPK_WZ_PREMISES.OTHER;
  var have = _wzInventory_(c).filter(function (i) { return i.premise_id === p.premise_id; });
  return d.inventory.map(function (k) {
    var x = PPK_WZ_INVENTORY[k];
    return { code: k, category: x.cat, name: x.name, marking: x.marking, meaning: x.meaning, color: x.color, existing: have.filter(function (i) { return i.code === k; }).length };
  });
}

function addPpkInventory_(session, data) {
  return withLock_(function () {
    var c = _wzCtx_(session, data), p = _wzPremise_(session, c, data.premiseId), items = data.items || [], out = [];
    if (!items.length) throw new Error('Отметьте инвентарь.');
    var have = _wzInventory_(c).filter(function (i) { return i.premise_id === p.premise_id; });
    items.forEach(function (x) {
      var def = PPK_WZ_INVENTORY[x.code] || null, name = String(x.name || (def && def.name) || '').trim();
      if (!name) throw new Error('Название инвентаря обязательно.');
      var marking = x.marking !== undefined ? String(x.marking).trim() : (def ? def.marking : '');
      if (have.some(function (i) { return i.name === name && i.marking === marking; })) return;
      var qty = _wzNum_(x.qty);
      var row = { item_id: generateId_('INVENTORY_ITEMS'), organization_id: c.org, location_id: c.loc, premise_id: p.premise_id, code: def ? x.code : 'CUSTOM', category: String(x.category || (def && def.cat) || 'Прочее'),
        name: name, marking: marking, color: x.color !== undefined ? String(x.color).trim() : (def ? def.color : ''), material: String(x.material || ''), quantity: qty === null ? '' : qty, unit: String(x.unit || 'шт'),
        purpose: def ? def.meaning : String(x.purpose || ''), status: 'ACTIVE', created_by: session.user_id, created_at: nowIso_(), updated_at: nowIso_() };
      insertRow_('INVENTORY_ITEMS', row); have.push(row); out.push(_wzInventoryView_(row));
    });
    if (out.length) auditLog_(session.user_id, 'Мастер ППК: инвентарь', 'PREMISES:' + p.premise_id, '', out.map(function (i) { return i.name + (i.marking ? ' «' + i.marking + '»' : ''); }).join(', '), 'success', session.cascade_id || '');
    return { created: out };
  });
}

function updatePpkInventory_(session, data) {
  return withLock_(function () {
    var c = _wzCtx_(session, data), r = findOne_('INVENTORY_ITEMS', 'item_id', data.itemId); assertOwnedByOrg_(session, r, 'INVENTORY_ITEMS:' + data.itemId);
    if (r.location_id !== c.loc) _denyScope_(session, 'INVENTORY_ITEMS:' + data.itemId, 'foreign_location');
    var x = data.patch || {}, patch = { updated_at: nowIso_() };
    ['name', 'marking', 'color', 'material', 'unit'].forEach(function (k) { if (x[k] !== undefined) patch[k] = String(x[k]).trim(); });
    if (x.quantity !== undefined) { var n = _wzNum_(x.quantity); if (n !== null && n < 0) throw new Error('Количество не может быть отрицательным.'); patch.quantity = n === null ? '' : n; }
    if (patch.name === '') throw new Error('Название инвентаря обязательно.');
    updateRow_('INVENTORY_ITEMS', r, patch);
    return _wzInventoryView_(findOne_('INVENTORY_ITEMS', 'item_id', r.item_id));
  });
}

function removePpkInventory_(session, data) {
  return withLock_(function () {
    var r = findOne_('INVENTORY_ITEMS', 'item_id', data.itemId); assertOwnedByOrg_(session, r, 'INVENTORY_ITEMS:' + data.itemId);
    updateRow_('INVENTORY_ITEMS', r, { status: 'ARCHIVED', updated_at: nowIso_() });
    return { ok: true };
  });
}

function _wzInventoryView_(i) {
  return { item_id: i.item_id, premise_id: i.premise_id, code: i.code, category: i.category, name: i.name, marking: i.marking || '', color: i.color || '', material: i.material || '',
    quantity: _wzNum_(i.quantity), unit: i.unit || 'шт', purpose: i.purpose || '' };
}

// ---------- шаг 5. Дезинфекция: средства и расчёт по площади ----------

/** Дезсредство организации. Режим вводится по инструкции к средству — система его не придумывает. */
function savePpkDisinfectant_(session, data) {
  return withLock_(function () {
    var c = _wzCtx_(session, data), name = String(data.name || '').trim(), form = String(data.form || '');
    if (!name) throw new Error('Укажите название средства, как в инструкции.');
    if (!PPK_WZ_DISINF_FORMS[form]) throw new Error('Форма средства: жидкий концентрат, таблетки или порошок.');
    var conc = _wzNum_(data.concentration_pct), rate = _wzNum_(data.rate_ml_m2), tl = _wzNum_(data.tablet_liters), expo = _wzNum_(data.exposure_min);
    if (conc === null || conc <= 0 || conc > 100) throw new Error('Концентрация рабочего раствора по инструкции, % (больше 0 и не больше 100).');
    if (rate === null || rate <= 0) throw new Error('Норма расхода рабочего раствора по инструкции, мл на 1 м².');
    if (form === 'TABLETS' && (tl === null || tl <= 0)) throw new Error('Для таблеток укажите, на сколько литров воды берётся 1 таблетка для этой концентрации (по инструкции).');
    if (!String(data.instruction_ref || '').trim()) throw new Error('Укажите инструкцию по применению (номер, дата) — источник режима.');
    var ex = data.disinfectantId ? findOne_('DISINFECTANTS', 'disinfectant_id', data.disinfectantId) : null;
    if (ex) assertOwnedByOrg_(session, ex, 'DISINFECTANTS:' + data.disinfectantId);
    var row = { name: name, form: form, active_substance: String(data.active_substance || '').trim(), purpose: String(data.purpose || '').trim(), concentration_pct: conc, rate_ml_m2: rate,
      exposure_min: expo === null ? '' : expo, tablet_liters: tl === null ? '' : tl, instruction_ref: String(data.instruction_ref).trim(), registration: String(data.registration || '').trim(), updated_at: nowIso_() };
    if (ex) updateRow_('DISINFECTANTS', ex, row);
    else { row.disinfectant_id = generateId_('DISINFECTANTS'); row.organization_id = c.org; row.status = 'ACTIVE'; row.created_by = session.user_id; row.created_at = nowIso_(); insertRow_('DISINFECTANTS', row); }
    var id = ex ? ex.disinfectant_id : row.disinfectant_id;
    _wzPlans_(c).filter(function (p) { return p.disinfectant_id === id; }).forEach(function (p) { _wzRecalcPlans_(c, p.premise_id); });
    auditLog_(session.user_id, 'Мастер ППК: дезсредство', 'DISINFECTANTS:' + id, '', JSON.stringify(row), 'success', session.cascade_id || '');
    return _wzDisinfectantView_(findOne_('DISINFECTANTS', 'disinfectant_id', id));
  });
}
function archivePpkDisinfectant_(session, data) {
  return withLock_(function () {
    var c = _wzCtx_(session, data), r = findOne_('DISINFECTANTS', 'disinfectant_id', data.disinfectantId); assertOwnedByOrg_(session, r, 'DISINFECTANTS:' + data.disinfectantId);
    var used = _wzPlans_(c).filter(function (p) { return p.disinfectant_id === r.disinfectant_id; });
    if (used.length) throw new Error('Средство используется в ' + used.length + ' режимах обработки. Сначала замените его там.');
    updateRow_('DISINFECTANTS', r, { status: 'ARCHIVED', updated_at: nowIso_() });
    return { ok: true };
  });
}
function _wzDisinfectantView_(d) {
  return { disinfectant_id: d.disinfectant_id, name: d.name, form: d.form, form_ru: PPK_WZ_DISINF_FORMS[d.form] || d.form, active_substance: d.active_substance || '', purpose: d.purpose || '',
    concentration_pct: _wzNum_(d.concentration_pct), rate_ml_m2: _wzNum_(d.rate_ml_m2), exposure_min: _wzNum_(d.exposure_min), tablet_liters: _wzNum_(d.tablet_liters), instruction_ref: d.instruction_ref || '', registration: d.registration || '' };
}

/**
 * Расчёт одной обработки помещения.
 *   площадь = пол (+ стены, если отмечено) (+ поверхности оборудования, если отмечено);
 *   рабочий раствор, л = площадь × норма расхода (мл/м²) / 1000;
 *   жидкий концентрат, мл = раствор, мл × концентрация % / 100 (концентрация по препарату);
 *   порошок, г = раствор, мл × концентрация % / 100 (1 % ≈ 1 г на 100 мл);
 *   таблетки = раствор, л / (литров на 1 таблетку), с округлением вверх до половины таблетки.
 */
function calcPpkDisinfection_(premise, equipment, dis, plan) {
  var floor = _wzNum_(premise.area_m2), walls = _wzNum_(premise.walls_m2), warnings = [];
  if (floor === null || floor <= 0) return { ok: false, error: 'У помещения «' + premise.name + '» не указана площадь.' };
  var useWalls = plan.include_walls === true || plan.include_walls === 'true', useEq = plan.include_equipment === true || plan.include_equipment === 'true';
  var eqArea = 0, eqNoArea = [];
  if (useEq) equipment.forEach(function (e) { var s = _wzNum_(e.surface_m2); if (s === null) eqNoArea.push(e.название); else eqArea += s; });
  if (useWalls && (walls === null || walls <= 0)) warnings.push('Площадь стен не указана — в расчёт взят только пол.');
  if (eqNoArea.length) warnings.push('Без площади поверхности (не вошли в расчёт): ' + eqNoArea.join(', ') + '.');
  var area = floor + (useWalls && walls ? walls : 0) + eqArea;
  var rate = _wzNum_(dis.rate_ml_m2), conc = _wzNum_(dis.concentration_pct);
  var solMl = area * rate, solL = solMl / 1000, times = Math.max(0, _wzNum_(plan.times_per_month) || 0);
  var out = { ok: true, area: { floor: floor, walls: useWalls && walls ? walls : 0, equipment: _wzR_(eqArea, 2), total: _wzR_(area, 2) }, solution_l: _wzR_(solL, 2), concentration_pct: conc,
    rate_ml_m2: rate, exposure_min: _wzNum_(dis.exposure_min), times_per_month: times, warnings: warnings };
  var verb;
  if (dis.form === 'TABLETS') {
    var tl = _wzNum_(dis.tablet_liters), tabs = Math.ceil((solL / tl) * 2 - 1e-9) / 2;
    out.tablets = tabs; out.water_l = _wzR_(solL, 2); out.per_month = { tablets: _wzR_(tabs * times, 1) };
    verb = tabs + ' табл. на ' + out.water_l + ' л воды';
  } else {
    var amount = solMl * conc / 100;
    if (dis.form === 'POWDER') { out.concentrate_g = _wzR_(amount, 1); out.water_l = _wzR_(solL, 2); out.per_month = { concentrate_g: _wzR_(amount * times, 0) }; verb = out.concentrate_g + ' г средства на ' + out.water_l + ' л воды'; }
    else { out.concentrate_ml = _wzR_(amount, 1); out.water_l = _wzR_((solMl - amount) / 1000, 3); out.per_month = { concentrate_ml: _wzR_(amount * times, 0) }; verb = out.concentrate_ml + ' мл концентрата + ' + (out.water_l < 10 ? _wzR_(solMl - amount, 0) + ' мл' : out.water_l + ' л') + ' воды'; }
  }
  out.text = 'Площадь обработки ' + out.area.total + ' м² × ' + rate + ' мл/м² = ' + out.solution_l + ' л рабочего раствора ' + conc + ' % «' + dis.name + '»: ' + verb + '.' +
    (out.exposure_min ? ' Экспозиция ' + out.exposure_min + ' мин.' : '') + (times ? ' Обработок в месяц: ' + times + '.' : '');
  return out;
}

function savePpkDisinfectionPlan_(session, data) {
  return withLock_(function () {
    var c = _wzCtx_(session, data), p = _wzPremise_(session, c, data.premiseId), d = findOne_('DISINFECTANTS', 'disinfectant_id', data.disinfectantId);
    assertOwnedByOrg_(session, d, 'DISINFECTANTS:' + data.disinfectantId);
    if (!PPK_WZ_REGIMENS[data.regimen]) throw new Error('Вид обработки: текущая, генеральная или оборудование и инвентарь.');
    var times = _wzNum_(data.times_per_month); if (times === null || times < 0 || times > 93) throw new Error('Сколько раз в месяц проводится обработка (0–93).');
    var ex = findRows_('DISINFECTION_PLANS', function (x) { return x.premise_id === p.premise_id && x.regimen === data.regimen && _wzActive_(x); })[0];
    var row = { disinfectant_id: d.disinfectant_id, times_per_month: times, include_walls: data.include_walls === true, include_equipment: data.include_equipment === true, responsible_role: String(data.responsible_role || ''), updated_at: nowIso_() };
    var calc = calcPpkDisinfection_(p, _wzEquipment_(c).filter(function (e) { return e.premise_id === p.premise_id; }), d, row);
    if (!calc.ok) throw new Error(calc.error);
    row.calc_json = JSON.stringify(calc);
    if (ex) updateRow_('DISINFECTION_PLANS', ex, row);
    else { row.plan_id = generateId_('DISINFECTION_PLANS'); row.organization_id = c.org; row.location_id = c.loc; row.premise_id = p.premise_id; row.regimen = data.regimen; row.status = 'ACTIVE'; row.created_by = session.user_id; row.created_at = nowIso_(); insertRow_('DISINFECTION_PLANS', row); }
    var id = ex ? ex.plan_id : row.plan_id;
    auditLog_(session.user_id, 'Мастер ППК: режим дезинфекции', 'DISINFECTION_PLANS:' + id, '', calc.text, 'success', session.cascade_id || '');
    return _wzPlanView_(findOne_('DISINFECTION_PLANS', 'plan_id', id));
  });
}
function removePpkDisinfectionPlan_(session, data) {
  return withLock_(function () {
    var r = findOne_('DISINFECTION_PLANS', 'plan_id', data.planId); assertOwnedByOrg_(session, r, 'DISINFECTION_PLANS:' + data.planId);
    updateRow_('DISINFECTION_PLANS', r, { status: 'ARCHIVED', updated_at: nowIso_() });
    return { ok: true };
  });
}
/** Пересчёт режимов помещения после изменения площади, оборудования или средства. */
function _wzRecalcPlans_(c, premiseId) {
  var p = findOne_('PREMISES', 'premise_id', premiseId); if (!p) return;
  var eq = _wzEquipment_(c).filter(function (e) { return e.premise_id === premiseId; });
  _wzPlans_(c).filter(function (x) { return x.premise_id === premiseId; }).forEach(function (x) {
    var d = findOne_('DISINFECTANTS', 'disinfectant_id', x.disinfectant_id); if (!d) return;
    updateRow_('DISINFECTION_PLANS', x, { calc_json: JSON.stringify(calcPpkDisinfection_(p, eq, d, x)), updated_at: nowIso_() });
  });
}
function _wzPlanView_(x) {
  var d = findOne_('DISINFECTANTS', 'disinfectant_id', x.disinfectant_id);
  return { plan_id: x.plan_id, premise_id: x.premise_id, regimen: x.regimen, regimen_ru: PPK_WZ_REGIMENS[x.regimen] || x.regimen, disinfectant_id: x.disinfectant_id, disinfectant: d ? d.name : '',
    times_per_month: _wzNum_(x.times_per_month), include_walls: x.include_walls === true || x.include_walls === 'true', include_equipment: x.include_equipment === true || x.include_equipment === 'true',
    responsible_role: x.responsible_role || '', calc: _wzJson_(x.calc_json, {}) };
}

// ---------- журналы оборудования ----------

/** Журналы по оборудованию (температура холодильников, фритюрные жиры, бактерицидные установки, склад). */
function createPpkEquipmentJournals_(session, data) {
  return withLock_(function () {
    var c = _wzCtx_(session, data), ppk = getWorkingPpk_(c.org), created = [], skipped = [];
    var defs = findRows_('JOURNAL_DEFINITIONS', function (d) { return d.organization_id === c.org && d.location_id === c.loc && d.статус !== 'архив'; });
    _wzEquipment_(c).forEach(function (e) {
      var k = _wzKindOf_(e); if (!k || !PPK_WZ_EQUIPMENT[k].journal) return;
      var jk = PPK_WZ_EQUIPMENT[k].journal, j = PPK_WZ_JOURNALS[jk];
      if (defs.some(function (d) { return d.equipment_id === e.equipment_id && d.journal_type === 'PPK_' + jk; })) return;
      if (j.answer === 'ЧИСЛО' && e.мин_температура === '' && e.макс_температура === '') { skipped.push(e.название + ': не задан диапазон температуры'); return; }
      var def = createJournalDefinition_({ organization_id: c.org, location_id: c.loc, workshop_id: e.workshop_id || '', journal_type: 'PPK_' + jk, название: j.name + ' — ' + e.название,
        периодичность: j.period, роль_ответственная: j.role, equipment_id: e.equipment_id, мин_норма: e.мин_температура, макс_норма: e.макс_температура, единица: j.unit || '',
        source_type: 'регламент', source_document: 'PPK_WIZARD:' + jk + ' · ' + j.source, обязательность: true, ppk_id: ppk ? ppk.ppk_id : '', ppk_version: ppk ? ppk.version : '',
        тип_ответа: j.answer, текст_вопроса: j.question || '', ожидаемый_ответ: 'ДА' }, session.user_id, session);
      defs.push(def); created.push({ definition_id: def.definition_id, name: def.название });
    });
    return { created: created, skipped: skipped };
  });
}

// ---------- связь с генератором и документом ----------

/** Этапы процесса получают помещения и оборудование, на которых проходят (PPK_FLOW_STAGES). */
function applyPpkWizardBindings_(session, ppkId, locationId) {
  var c = _wzCtx_(session, { locationId: locationId }), prem = _wzPremises_(c); if (!prem.length) return 0;
  var eq = _wzEquipment_(c), n = 0;
  findRows_('PPK_FLOW_STAGES', function (s) { return s.ppk_id === ppkId; }).forEach(function (s) {
    var b = PPK_WZ_STAGE_PREMISES[s.stage_code]; if (!b) return;
    var ps = prem.filter(function (p) { return b.premises.indexOf(p.code) >= 0; });
    var es = eq.filter(function (e) { return ps.some(function (p) { return p.premise_id === e.premise_id; }) && b.cats.indexOf(_wzCatOf_(e)) >= 0; });
    var params = _wzJson_(s.parameters_json, {});
    params.premises = ps.map(function (p) { return { premise_id: p.premise_id, name: p.name, zone: p.zone_class }; });
    params.equipment = es.map(function (e) { return { equipment_id: e.equipment_id, name: e.название, category: _wzCatOf_(e) }; });
    updateRow_('PPK_FLOW_STAGES', s, { parameters_json: JSON.stringify(params), workshop_id: s.workshop_id || (ps[0] && ps[0].workshop_id) || '', equipment_id: s.equipment_id || (es[0] && es[0].equipment_id) || '' });
    n++;
  });
  return n;
}

function _wzT_(columns, rows) { return { columns: columns, rows: rows }; }

/** Разделы документа ППК из цифрового предприятия: текст и таблицы. Пустой раздел — с подсказкой, что заполнить. */
function ppkWizardDocumentSections_(session, locationId) {
  var c = _wzCtx_(session, { locationId: locationId }), ent = _wzEnterpriseView_(_wzEnterprise_(c)), org = findOne_('ORGANIZATIONS', 'organization_id', c.org) || {};
  var prem = _wzPremises_(c), pName = {}; prem.forEach(function (p) { pName[p.premise_id] = p.name; });
  var eq = _wzEquipment_(c), inv = _wzInventory_(c), plans = _wzPlans_(c).map(_wzPlanView_), dis = _wzDisinfectants_(c).map(_wzDisinfectantView_);
  var S = {}, e = ent || {};
  var tr = function (v) { return v === null || v === undefined ? '' : String(v); };
  S['Общие положения'] = { text: ['Программа производственного контроля (ППК) устанавливает порядок контроля соблюдения санитарно-эпидемиологических требований и принципов ХАССП при производстве и обороте пищевой продукции на объекте «' + (c.location.название || '') + '».',
    'Программа построена по данным цифрового предприятия ЦЕХ: помещения, оборудование, инвентарь, номенклатура, технологические карты. При изменении этих данных создаётся запрос на пересмотр ППК.'], empty: false };
  S['Нормативная и документальная база'] = { text: ['Федеральный закон от 30.03.1999 № 52-ФЗ «О санитарно-эпидемиологическом благополучии населения» (ст. 11, 32).', 'ТР ТС 021/2011 «О безопасности пищевой продукции» (ст. 10, 11).', PPK_WZ_SANPIN + '.',
    'Инструкции по применению дезинфицирующих средств: ' + (dis.length ? dis.map(function (d) { return '«' + d.name + '» — ' + d.instruction_ref; }).join('; ') : 'не внесены') + '.', 'Перечень сверяется с действующими редакциями документов при каждом пересмотре ППК.'], empty: false };
  S['Характеристика предприятия'] = { text: [
    'Организация: ' + (org.название || '') + (org.ИНН ? ', ИНН ' + org.ИНН : '') + (org.ОГРН ? ', ОГРН ' + org.ОГРН : '') + '.',
    'Объект: ' + (c.location.название || '') + (c.location.адрес ? ', ' + c.location.адрес : '') + '.',
    e.template_name ? 'Тип предприятия: ' + e.template_name + (e.format ? ' (' + e.format + ')' : '') + '.' : '',
    e.seats ? 'Посадочных мест: ' + e.seats + '.' : '', e.meals_per_day ? 'Мощность: ' + e.meals_per_day + ' блюд (порций) в сутки.' : '',
    e.service_type ? 'Обслуживание: ' + e.service_type + '.' : '', e.work_hours ? 'Режим работы: ' + e.work_hours + (e.shifts ? ', смен: ' + e.shifts : '') + '.' : '',
    e.staff_count ? 'Численность персонала: ' + e.staff_count + '.' : '', e.area_m2 ? 'Общая площадь: ' + e.area_m2 + ' м².' : ''
  ].filter(Boolean), empty: !ent, hint: 'Заполните шаг «Предприятие» мастера ППК.' };
  S['Область применения ППК'] = { text: ent ? ['Программа распространяется на производство и оборот пищевой продукции на объекте «' + (c.location.название || '') + '»: приёмка, хранение, обработка сырья, производство, хранение готовой продукции' + (e.service_type ? ', ' + e.service_type : '') + '.'] : [], empty: !ent, hint: 'Заполните шаг «Предприятие».' };
  S['Ответственные лица'] = { tables: [_wzT_(['Обязанность', 'ФИО', 'Должность', 'Приказ'], (e.responsible || []).map(function (r) { return [r.role, r.name, r.position, r.order]; }))], empty: !(e.responsible || []).length, hint: 'Добавьте ответственных на шаге «Предприятие».' };
  S['Описание помещений и зон'] = { text: prem.length ? ['Помещений: ' + prem.length + ', общая площадь указанных — ' + _wzR_(prem.reduce(function (s, p) { return s + (_wzNum_(p.area_m2) || 0); }, 0), 1) + ' м². Зоны: «грязная» — сырьё и мойка, «чистая» — готовая продукция; потоки не пересекаются.'] : [],
    tables: [_wzT_(['Помещение', 'Зона', 'Площадь пола, м²', 'Стены, м²', 'Оборудования', 'Инвентаря'], prem.map(function (p) { return [p.name, p.zone_class, tr(p.area_m2), tr(p.walls_m2), eq.filter(function (x) { return x.premise_id === p.premise_id; }).length, inv.filter(function (x) { return x.premise_id === p.premise_id; }).length]; }))],
    empty: !prem.length, hint: 'Заведите помещения на шаге «Помещения и зоны».' };
  var eqRows = function (filter) { return eq.filter(filter).map(function (x) { var v = _wzEquipmentView_(x); return [pName[v.premise_id] || '—', v.category || '—', v.name, v.number, v.tmin === null && v.tmax === null ? '' : (v.tmin === null ? '' : v.tmin) + '…' + (v.tmax === null ? '' : v.tmax) + ' °C', v.journal_kind ? PPK_WZ_JOURNALS[v.journal_kind].name : '']; }); };
  var byCat = PPK_WZ_CATEGORIES.map(function (cat) { var n = eq.filter(function (x) { return _wzCatOf_(x) === cat; }).length; return n ? cat.toLowerCase() + ' — ' + n : ''; }).filter(Boolean);
  S['Оборудование'] = { text: eq.length ? ['Единиц оборудования: ' + eq.length + (byCat.length ? ' (' + byCat.join(', ') + ')' : '') + '.'] : [],
    tables: [_wzT_(['Помещение', 'Категория', 'Оборудование', '№', 'Режим', 'Журнал'], eqRows(function () { return true; }).sort(function (a, b) { return (a[0] + a[1]).localeCompare(b[0] + b[1]); }))], empty: !eq.length, hint: 'Добавьте оборудование на шаге «Оборудование».' };
  var meas = eq.filter(function (x) { var k = _wzKindOf_(x); return k && PPK_WZ_EQUIPMENT[k].verify; });
  S['Оборудование и измерительные средства'] = { text: meas.length ? ['Средства измерений подлежат поверке (калибровке) в установленные сроки; дата следующей поверки ведётся в карточке оборудования.'] : [],
    tables: [_wzT_(['Помещение', 'Средство измерения', '№', 'Следующая поверка'], meas.map(function (x) { return [pName[x.premise_id] || '—', x.название, x.номер || '', String(x.следующая_проверка || '') || 'не указана']; }))], empty: !meas.length, hint: 'Добавьте весы и термометры на шаге «Оборудование».' };
  var invRows = inv.map(function (i) { return [pName[i.premise_id] || '—', i.category, i.name, i.marking || '', i.color || '', tr(i.quantity)]; }).sort(function (a, b) { return (a[0] + a[1]).localeCompare(b[0] + b[1]); });
  S['Организация производства'] = { text: inv.length ? ['Разделочный инвентарь и ёмкости промаркированы по виду продукции и закреплены за помещениями. Использование инвентаря не по маркировке не допускается.'] : [],
    tables: [_wzT_(['Помещение', 'Группа', 'Инвентарь', 'Маркировка', 'Цвет', 'Кол-во'], invRows)], empty: !inv.length, hint: 'Заполните шаг «Инвентарь и маркировка».' };
  var clean = inv.filter(function (i) { return i.category === 'Уборочный' || i.category === 'Моечный'; });
  S['Уборка и мойка'] = { tables: [_wzT_(['Помещение', 'Инвентарь', 'Маркировка'], clean.map(function (i) { return [pName[i.premise_id] || '—', i.name, i.marking]; }))], empty: !clean.length, hint: 'Добавьте уборочный инвентарь по зонам.' };
  S['Дезинфекция'] = { text: plans.length ? ['Расход средств рассчитан по площади помещений и норме расхода из инструкций по применению.'] : [],
    tables: [_wzT_(['Средство', 'Форма', 'Концентрация, %', 'Расход, мл/м²', 'Экспозиция, мин', 'Инструкция'], dis.map(function (d) { return [d.name, d.form_ru, tr(d.concentration_pct), tr(d.rate_ml_m2), tr(d.exposure_min), d.instruction_ref]; })),
      _wzT_(['Помещение', 'Обработка', 'Средство', 'Площадь, м²', 'Раствор, л', 'Средства на 1 обработку', 'Раз в месяц', 'В месяц'], plans.map(function (x) {
        var k = x.calc || {}, one = k.tablets !== undefined ? k.tablets + ' табл.' : k.concentrate_g !== undefined ? k.concentrate_g + ' г' : k.concentrate_ml !== undefined ? k.concentrate_ml + ' мл' : (k.error || '');
        var pm = k.per_month || {}, month = pm.tablets !== undefined ? pm.tablets + ' табл.' : pm.concentrate_g !== undefined ? pm.concentrate_g + ' г' : pm.concentrate_ml !== undefined ? pm.concentrate_ml + ' мл' : '';
        return [pName[x.premise_id] || '—', x.regimen_ru, x.disinfectant, tr(k.area && k.area.total), tr(k.solution_l), one, tr(x.times_per_month), month]; }))],
    empty: !plans.length, hint: 'Заполните шаг «Дезинфекция»: средства и режимы по помещениям.' };
  S['Химические средства'] = { text: dis.length ? ['Дезинфицирующие средства применяются по инструкциям; рабочие растворы готовятся в промаркированных ёмкостях, средства хранятся в кладовой уборочного инвентаря отдельно от продуктов.'] : [],
    tables: [_wzT_(['Средство', 'Действующее вещество', 'Назначение', 'Свидетельство о госрегистрации'], dis.map(function (d) { return [d.name, d.active_substance, d.purpose, d.registration]; }))], empty: !dis.length, hint: 'Внесите дезсредства на шаге «Дезинфекция».' };
  var hoods = eq.filter(function (x) { return _wzCatOf_(x) === 'ВЕНТИЛЯЦИЯ'; });
  S['Вентиляция'] = { text: [e.ventilation ? 'Вентиляция: ' + e.ventilation + '.' : ''].filter(Boolean), tables: [_wzT_(['Помещение', 'Оборудование'], hoods.map(function (x) { return [pName[x.premise_id] || '—', x.название]; }))], empty: !e.ventilation && !hoods.length, hint: 'Укажите систему вентиляции на шаге «Предприятие».' };
  S['Вода'] = { text: [e.water_source ? 'Водоснабжение: ' + e.water_source + '.' : '', e.sewage ? 'Водоотведение: ' + e.sewage + '.' : ''].filter(Boolean), empty: !e.water_source, hint: 'Укажите источник водоснабжения на шаге «Предприятие».' };
  S['Pest Control'] = { text: [e.pest_contractor ? 'Дезинсекция и дератизация: ' + e.pest_contractor + '.' : ''].filter(Boolean), empty: !e.pest_contractor, hint: 'Укажите подрядчика дезинсекции и дератизации.' };
  var wasteInv = inv.filter(function (i) { return i.category === 'Отходы'; });
  S['Отходы'] = { text: [e.waste_contractor ? 'Вывоз отходов: ' + e.waste_contractor + '.' : ''].filter(Boolean), tables: [_wzT_(['Помещение', 'Ёмкость', 'Маркировка'], wasteInv.map(function (i) { return [pName[i.premise_id] || '—', i.name, i.marking]; }))], empty: !e.waste_contractor && !wasteInv.length, hint: 'Укажите подрядчика по вывозу отходов и ёмкости для отходов.' };
  S['Лабораторный контроль'] = { text: [e.lab_contractor ? 'Лабораторные исследования: ' + e.lab_contractor + '.' : ''].filter(Boolean), empty: !e.lab_contractor, hint: 'Укажите аккредитованную лабораторию.', keep_body: true };
  S['Медицинский контроль'] = { text: [e.medical_org ? 'Медицинские осмотры: ' + e.medical_org + '.' : ''].filter(Boolean), empty: !e.medical_org, hint: 'Укажите медицинскую организацию.' };
  var jd = findRows_('JOURNAL_DEFINITIONS', function (d) { return d.organization_id === c.org && (!d.location_id || d.location_id === c.loc) && d.статус !== 'архив'; });
  S['Формы журналов'] = { tables: [_wzT_(['Журнал', 'Периодичность', 'Ответственный', 'Норма', 'Источник'], jd.map(function (d) { return [d.название, String(d.периодичность || '').replace(/_/g, ' '), d.роль_ответственная, (d.мин_норма !== '' || d.макс_норма !== '') ? tr(d.мин_норма) + '…' + tr(d.макс_норма) + ' ' + tr(d.единица) : '', String(d.source_document || '').replace(/^PPK_WIZARD:[A-Z_]+ · /, '')]; }))], empty: !jd.length, hint: 'Создайте журналы на шаге «Журналы».' };
  return S;
}

// ---------- состояние мастера ----------

function getPpkWizard_(session, data) {
  data = data || {};
  var c = _wzCtx_(session, data), entRow = _wzEnterprise_(c), ent = _wzEnterpriseView_(entRow), prem = _wzPremises_(c), eq = _wzEquipment_(c), inv = _wzInventory_(c);
  var dis = _wzDisinfectants_(c), plans = _wzPlans_(c), ppk = getWorkingPpk_(c.org);
  var steps = [], add = function (code, title, status, summary, warnings) { steps.push({ code: code, title: title, status: status, summary: summary, warnings: warnings || [] }); };

  var ew = []; if (ent) { if (!ent.template_code) ew.push('Не выбран тип предприятия.'); if (!ent.responsible.length) ew.push('Не назначены ответственные за производственный контроль.'); if (!ent.water_source) ew.push('Не указан источник водоснабжения.'); }
  add('enterprise', 'Предприятие', !ent ? 'TODO' : ew.length ? 'WARN' : 'DONE', ent ? (ent.template_name || 'тип не выбран') + (ent.seats ? ' · ' + ent.seats + ' мест' : '') : 'Не заполнено', ew);

  var pw = [], prod = prem.filter(function (p) { var d = PPK_WZ_PREMISES[p.code]; return d && d.ws && d.ws !== 'СКЛАД'; });
  prem.forEach(function (p) { if (_wzNum_(p.area_m2) === null) pw.push('«' + p.name + '»: не указана площадь — дезинфекцию не рассчитать.'); });
  if (ent && ent.template_code && PPK_WZ_TEMPLATES[ent.template_code]) {
    ['WASH_KITCHEN', 'CLEANING_ROOM', 'WASTE'].forEach(function (k) { if (PPK_WZ_TEMPLATES[ent.template_code].premises.indexOf(k) >= 0 && !prem.some(function (p) { return p.code === k; })) pw.push('Нет помещения «' + PPK_WZ_PREMISES[k].name + '» — укажите, где это организовано.'); });
  }
  add('premises', 'Помещения и зоны', !prem.length ? 'TODO' : pw.length ? 'WARN' : 'DONE', prem.length ? prem.length + ' помещений, ' + _wzR_(prem.reduce(function (s, p) { return s + (_wzNum_(p.area_m2) || 0); }, 0), 1) + ' м²' : 'Не заведены', pw);

  var qw = [], unbound = eq.filter(function (e) { return !e.premise_id; });
  if (unbound.length) qw.push('Без помещения: ' + unbound.length + ' ед. — привяжите к помещению.');
  prod.forEach(function (p) {
    var pe = eq.filter(function (e) { return e.premise_id === p.premise_id; });
    if (!pe.length) { qw.push('«' + p.name + '»: оборудование не заведено.'); return; }
    if (!pe.some(function (e) { return e.kind_code === 'HANDWASH'; })) qw.push('«' + p.name + '»: нет раковины для мытья рук.');
    var cold = pe.filter(function (e) { var k = _wzKindOf_(e); return k && PPK_WZ_EQUIPMENT[k].needs_thermo; }).length, th = pe.filter(function (e) { return e.kind_code === 'FRIDGE_THERMO'; }).length;
    if (cold > th) qw.push('«' + p.name + '»: холодильного оборудования ' + cold + ', термометров ' + th + '.');
  });
  eq.forEach(function (e) {
    var k = _wzKindOf_(e);
    if (k && PPK_WZ_EQUIPMENT[k].journal === 'FRIDGE_TEMP' && e.мин_температура === '' && e.макс_температура === '') qw.push(e.название + ': не задан диапазон температуры.');
    if (k && PPK_WZ_EQUIPMENT[k].verify && !e.следующая_проверка) qw.push(e.название + ': не указана дата следующей поверки.');
  });
  add('equipment', 'Оборудование', !eq.length ? 'TODO' : qw.length ? 'WARN' : 'DONE', eq.length ? PPK_WZ_CATEGORIES.map(function (cat) { var n = eq.filter(function (e) { return _wzCatOf_(e) === cat; }).length; return n ? cat.toLowerCase() + ' ' + n : ''; }).filter(Boolean).join(', ') : 'Не заведено', qw);

  var iw = [];
  prem.forEach(function (p) {
    var d = PPK_WZ_PREMISES[p.code]; if (!d) return;
    var missing = d.inventory.filter(function (k) { return PPK_WZ_INVENTORY[k].cat === 'Разделочный' && !inv.some(function (i) { return i.premise_id === p.premise_id && i.code === k; }); });
    if (missing.length) iw.push('«' + p.name + '»: нет ' + missing.map(function (k) { return PPK_WZ_INVENTORY[k].name.toLowerCase() + ' «' + PPK_WZ_INVENTORY[k].marking + '»'; }).join(', ') + '.');
  });
  add('inventory', 'Инвентарь и маркировка', !inv.length ? 'TODO' : iw.length ? 'WARN' : 'DONE', inv.length ? inv.length + ' позиций' : 'Не заведён', iw);

  var dw = [];
  prod.forEach(function (p) { if (!plans.some(function (x) { return x.premise_id === p.premise_id; })) dw.push('«' + p.name + '»: нет режима дезинфекции.'); });
  plans.forEach(function (x) { var k = _wzJson_(x.calc_json, {}); if (k.ok === false) dw.push(k.error); });
  add('disinfection', 'Дезинфекция', !plans.length ? 'TODO' : dw.length ? 'WARN' : 'DONE', dis.length + ' средств, ' + plans.length + ' режимов', dw);

  var dishes = findRows_('DISHES', function (r) { return r.organization_id === c.org && r.статус !== 'архив'; }), semi = findRows_('SEMI_FINISHED', function (r) { return r.organization_id === c.org; });
  var ttk = findRows_('TTK_VERSIONS', function (r) { return r.organization_id === c.org && r.status === 'утверждена'; }), ttkDish = _ppkUnique_(ttk.map(function (t) { return t.dish_id; }));
  var nw = []; if (dishes.length && ttkDish.length < dishes.length) nw.push('Без утверждённой ТТК: ' + (dishes.length - ttkDish.length) + ' блюд.');
  add('nomenclature', 'Номенклатура и ТТК', !dishes.length ? 'TODO' : nw.length ? 'WARN' : 'DONE', dishes.length + ' блюд, ' + semi.length + ' п/ф, ТТК утверждено ' + ttkDish.length, nw);

  var m = null; try { if (ppk) m = getPpkModel_(session, { ppkId: ppk.ppk_id, locationId: c.loc }); } catch (e) { m = null; }
  add('processes', 'Процессы и потоки', m && m.processes.length ? 'DONE' : 'TODO', m ? m.processes.length + ' процессов, ' + m.flows.length + ' потоков' : 'Модель ППК не собрана', []);
  var hz = m ? m.hazards : [], hzOpen = hz.filter(function (h) { return h.status === 'AI_SUGGESTED'; }).length;
  add('hazards', 'Анализ опасностей', !hz.length ? 'TODO' : hzOpen ? 'WARN' : 'DONE', hz.length ? hz.length + ' опасностей, ждут решения ' + hzOpen : 'Нет', hzOpen ? ['Ждут подтверждения технологом: ' + hzOpen + '.'] : []);
  var ct = m ? m.controls : [], ctOpen = ct.filter(function (x) { return x.status === 'AI_SUGGESTED'; }).length, lmOpen = m ? m.limits.filter(function (x) { return x.status !== 'CONFIRMED'; }).length : 0;
  add('controls', 'Контроль и пределы', !ct.length ? 'TODO' : (ctOpen || lmOpen) ? 'WARN' : 'DONE', ct.length ? ct.length + ' контролей, пределов ' + (m ? m.limits.length : 0) : 'Нет', [ctOpen ? 'Неподтверждённых контролей: ' + ctOpen + '.' : '', lmOpen ? 'Неподтверждённых пределов: ' + lmOpen + '.' : ''].filter(Boolean));
  var jd = findRows_('JOURNAL_DEFINITIONS', function (d) { return d.organization_id === c.org && d.location_id === c.loc && d.статус !== 'архив'; });
  var jw = eq.filter(function (e) { var k = _wzKindOf_(e); return k && PPK_WZ_EQUIPMENT[k].journal && !jd.some(function (d) { return d.equipment_id === e.equipment_id; }); }).map(function (e) { return e.название + ': журнал не создан.'; });
  add('journals', 'Журналы', !jd.length ? 'TODO' : jw.length ? 'WARN' : 'DONE', jd.length + ' журналов', jw);
  var gate = m ? buildPpkReadinessGate_(m) : { status: 'BLOCKED', blockers: ['NO_PPK'] };
  add('document', 'Документ ППК', ppk && ppk.status === 'APPROVED' ? 'DONE' : m && m.document ? 'WARN' : 'TODO', ppk ? 'Версия ' + ppk.version + ' · ' + ppk.status : 'Не собран', gate.status === 'READY' ? [] : ['К утверждению: ' + gate.blockers.join(', ')]);

  var out = { location: { location_id: c.loc, name: c.location.название || '' }, enterprise: ent, premises: prem.map(_wzPremiseView_), equipment: eq.map(_wzEquipmentView_), inventory: inv.map(_wzInventoryView_),
    disinfectants: dis.map(_wzDisinfectantView_), plans: plans.map(_wzPlanView_), steps: steps, journals: jd.map(function (d) { return { definition_id: d.definition_id, name: d.название, period: d.периодичность, role: d.роль_ответственная, equipment_id: d.equipment_id || '', min: d.мин_норма, max: d.макс_норма, unit: d.единица || '', source: d.source_type || '' }; }), ppk: ppk ? { ppk_id: ppk.ppk_id, version: ppk.version, status: ppk.status } : null, gate: gate };
  if (data.withCatalog) out.catalog = getPpkWizardCatalog_();
  return out;
}

// ---------- документ: чтение и печать ----------

function _wzEsc_(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** Читаемый документ ППК: разделы с текстом и таблицами, пустые разделы — с подсказкой. */
function getPpkDocumentView_(session, data) {
  var c = _wzCtx_(session, data), ppk = data && data.ppkId ? findOne_('PPK_VERSIONS', 'ppk_id', data.ppkId) : getWorkingPpk_(c.org);
  if (!ppk) throw new Error('ППК ещё не создана — пройдите шаг «Процессы и потоки».');
  assertOwnedByOrg_(session, ppk, 'PPK_VERSIONS:' + ppk.ppk_id);
  var doc = findRows_('PPK_DOCUMENTS', function (r) { return r.ppk_id === ppk.ppk_id; })[0];
  if (!doc || ppk.status === 'DRAFT') { buildPpkDocumentModel_(session, { ppkId: ppk.ppk_id, locationId: c.loc }); doc = findRows_('PPK_DOCUMENTS', function (r) { return r.ppk_id === ppk.ppk_id; })[0]; }
  var sections = _wzJson_(doc.sections_json, []).map(function (s) { return { number: s.number, title: s.title, text: s.text || [], tables: s.tables || [], empty: !!s.empty, hint: s.hint || '' }; });
  // Документ версии на согласовании/утверждённой не пересобирается; статус на листе утверждения — текущий.
  var ST = { DRAFT: 'черновик', REVIEW: 'на согласовании', APPROVED: 'утверждена', ARCHIVED: 'архив' };
  sections.forEach(function (s) { if (s.title === 'Лист утверждения') { s.text = ['Версия ' + ppk.version + ', статус: ' + (ST[ppk.status] || ppk.status) + (ppk.approved_by ? ', утвердил ' + ppk.approved_by : '') + '.', 'Подписи руководителя и ответственного за производственный контроль — на печатной форме.']; s.empty = false; } });
  var org = findOne_('ORGANIZATIONS', 'organization_id', c.org) || {};
  return { ppk_id: ppk.ppk_id, version: ppk.version, status: ppk.status, approved_by: ppk.approved_by || '', approved_at: String(ppk.approved_at || ''), organization: org.название || '', location: c.location.название || '',
    generated_at: String(doc.generated_at || ''), sections: sections, filled: sections.filter(function (s) { return !s.empty; }).length };
}

function _wzDocHtml_(v) {
  var E = _wzEsc_, st = { DRAFT: 'ЧЕРНОВИК', REVIEW: 'НА СОГЛАСОВАНИИ', APPROVED: 'УТВЕРЖДЕНА', ARCHIVED: 'АРХИВ' }[v.status] || v.status;
  var sign = '<table><tr><th>Должность</th><th>ФИО</th><th>Подпись</th><th>Дата</th></tr><tr><td>Руководитель</td><td></td><td></td><td></td></tr><tr><td>Ответственный за производственный контроль</td><td></td><td></td><td></td></tr></table>';
  var body = v.sections.map(function (s) {
    var h = '<h2>' + E(s.number + '. ' + s.title) + '</h2>';
    (s.text || []).forEach(function (t) { h += '<p>' + E(t) + '</p>'; });
    (s.tables || []).forEach(function (t) { if (!t.rows || !t.rows.length) return; h += '<table><tr>' + t.columns.map(function (x) { return '<th>' + E(x) + '</th>'; }).join('') + '</tr>' + t.rows.map(function (r) { return '<tr>' + r.map(function (x) { return '<td>' + E(x) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>'; });
    if (s.empty) h += '<p class="empty">Раздел не заполнен. ' + E(s.hint) + '</p>';
    if (s.title === 'Лист утверждения') h += sign;
    return h;
  }).join('');
  return '<!doctype html><html><head><meta charset="UTF-8"><title>ППК</title><style>@page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;font-size:10pt;color:#111;line-height:1.4}h1{font-size:15pt;text-align:center;margin:6px 0}h2{font-size:11pt;margin:14px 0 5px;border-bottom:1px solid #777;padding-bottom:2px;page-break-after:avoid}table{width:100%;border-collapse:collapse;margin:4px 0 8px;font-size:8.5pt}th,td{border:1px solid #888;padding:3px 4px;vertical-align:top;text-align:left}th{background:#f2f2f2}.meta{text-align:center;color:#555}.empty{color:#a33;font-style:italic}</style></head><body>' +
    '<div class="meta">' + E(v.organization) + '</div><h1>ПРОГРАММА ПРОИЗВОДСТВЕННОГО КОНТРОЛЯ</h1><div class="meta">' + E(v.location) + ' · версия ' + E(v.version) + ' · ' + E(st) + '</div>' + body + '</body></html>';
}

/** HTML для печати и PDF (через конвертацию Apps Script; если она недоступна — только HTML). */
function printPpkDocument_(session, data) {
  var v = getPpkDocumentView_(session, data || {}), html = _wzDocHtml_(v), out = { html: html, fileName: 'PPK_v' + v.version + '.pdf' };
  try { var blob = Utilities.newBlob(html, 'text/html', 'ppk.html').getAs(MimeType.PDF).setName(out.fileName); out.base64 = Utilities.base64Encode(blob.getBytes()); out.mimeType = 'application/pdf'; }
  catch (e) { out.pdf_error = String(e.message || e); }
  auditLog_(session.user_id, 'Документ ППК распечатан', 'PPK_VERSIONS:' + v.ppk_id, '', 'v' + v.version + ' ' + v.status, 'success', session.cascade_id || '');
  return out;
}

var PPK_WZ_HAZARD_RU = { BIO: 'биологическая', CHEM: 'химическая', PHYSICAL: 'физическая', ALLERGEN: 'аллергенная' };

/** Дополнить разделы документа: данные цифрового предприятия и читаемые таблицы модели ППК. */
function ppkDocumentEnrich_(session, data, sections, ctx, hazards, controls) {
  var wz = {}; try { wz = ppkWizardDocumentSections_(session, data.locationId); } catch (e) { wz = {}; }
  var procs = findRows_('PPK_PROCESSES', function (r) { return r.ppk_id === data.ppkId; }), pn = {}; procs.forEach(function (p) { pn[p.process_id] = p.name; });
  var stages = findRows_('PPK_FLOW_STAGES', function (r) { return r.ppk_id === data.ppkId; }), flows = findRows_('PPK_FLOWS', function (r) { return r.ppk_id === data.ppkId; });
  var limits = findRows_('PPK_CRITICAL_LIMITS', function (r) { return r.ppk_id === data.ppkId; }), sname = {}; stages.forEach(function (s) { sname[s.stage_id] = s.name; sname[s.stage_code] = s.name; });
  var ST = { AI_SUGGESTED: 'предложено, ждёт решения', CONFIRMED: 'подтверждено', DRAFT: 'черновик', REJECTED: 'отклонено' };
  var ctlRows = function (list) { return list.map(function (x) { return [pn[x.process_id] || '', x.point_type, x.control_name, x.monitoring_parameter || '', x.monitoring_method || '', x.frequency || '', x.responsible_role || '', x.corrective_action || '', ST[x.status] || x.status]; }); };
  var ctlCols = ['Этап', 'Тип', 'Контроль', 'Параметр', 'Метод', 'Частота', 'Ответственный', 'Корректирующее действие', 'Статус'];
  var stageRow = function (s) { var p = _wzJson_(s.parameters_json, {}); return [s.name, (p.premises || []).map(function (x) { return x.name; }).join(', '), (p.equipment || []).map(function (x) { return x.name; }).join(', ')]; };
  var own = {
    'Номенклатура продукции': { text: ['Сырьё: ' + ctx.products.length + ' наименований, блюд: ' + ctx.dishes.length + ', полуфабрикатов: ' + ctx.semi_finished.length + '.'], tables: [_wzT_(['Блюдо', 'Выход'], ctx.dishes.map(function (d) { return [d.название, d.выход === undefined ? '' : String(d.выход)]; }))], empty: !ctx.dishes.length && !ctx.products.length, hint: 'Заведите номенклатуру и ТТК.' },
    'Поставщики и входной контроль': { tables: [_wzT_(['Поставщик', 'Контакты'], ctx.suppliers.map(function (x) { return [x.название, x.контакты || '']; }))], empty: !ctx.suppliers.length, hint: 'Заведите поставщиков.' },
    'Технологические процессы': { tables: [_wzT_(['Этап', 'Помещения', 'Оборудование'], stages.slice().sort(function (a, b) { return procs.map(function (p) { return p.process_code; }).indexOf(a.stage_code) - procs.map(function (p) { return p.process_code; }).indexOf(b.stage_code); }).map(stageRow))], empty: !stages.length, hint: 'Соберите модель ППК (шаг «Процессы и потоки»).' },
    'Анализ опасностей HACCP': { text: hazards.length ? ['Опасностей в анализе: ' + hazards.length + ', подтверждено: ' + hazards.filter(function (h) { return h.status === 'CONFIRMED'; }).length + '.'] : [],
      tables: [_wzT_(['Этап', 'Вид', 'Опасность', 'Вероятность', 'Тяжесть', 'Мера управления', 'Тип точки', 'Статус'], hazards.map(function (h) { return [pn[h.process_id] || '', PPK_WZ_HAZARD_RU[h.hazard_type] || h.hazard_type, h.hazard_description, String(h.likelihood || ''), String(h.severity || ''), h.control_measure || '', h.classification || '', ST[h.status] || h.status]; }))], empty: !hazards.length, hint: 'Соберите модель ППК и проведите анализ опасностей.' },
    'Критические пределы': { tables: [_wzT_(['Параметр', 'Мин', 'Макс', 'Ед.', 'Источник', 'Статус'], limits.map(function (l) { return [l.parameter, String(l.min_value), String(l.max_value), l.unit || '', l.source_document || '', ST[l.status] || l.status]; }))], empty: !limits.length, hint: 'Задайте критические пределы с источником.' },
    'Мониторинг': { tables: [_wzT_(ctlCols, ctlRows(controls))], empty: !controls.length, hint: 'Сформируйте контрольные точки.' }
  };
  ['PRP', 'ППОПМ', 'КТ', 'ККТ'].forEach(function (t) { var l = controls.filter(function (x) { return x.point_type === t; }); own[t] = { tables: [_wzT_(ctlCols, ctlRows(l))], empty: !l.length, hint: 'Контрольных точек этого типа нет.' }; });
  [['RAW', 'Потоки сырья'], ['SEMI_FINISHED', 'Потоки полуфабрикатов'], ['FINISHED', 'Потоки готовой продукции'], ['WASTE', 'Потоки отходов']].forEach(function (f) {
    var fl = flows.filter(function (x) { return x.flow_type === f[0]; })[0], codes = fl ? (_wzJson_(fl.route_json, {}).route || []) : [];
    own[f[1]] = { text: codes.length ? [codes.map(function (k) { return sname[k] || k; }).join(' → ')] : [], tables: [_wzT_(['Этап', 'Помещения', 'Оборудование'], codes.map(function (k) { return stages.filter(function (s) { return s.stage_code === k; })[0]; }).filter(Boolean).map(stageRow))], empty: !codes.length, hint: 'Соберите модель ППК.' };
  });
  var stageEq = function (code) { var st = stages.filter(function (x) { return x.stage_code === code; })[0], p = st ? _wzJson_(st.parameters_json, {}) : {}; return { premises: (p.premises || []).map(function (x) { return x.name; }), equipment: (p.equipment || []).map(function (x) { var e = findOne_('EQUIPMENT', 'equipment_id', x.equipment_id) || {}; return [x.name, x.category, (e.мин_температура === '' || e.мин_температура === undefined) && (e.макс_температура === '' || e.макс_температура === undefined) ? '' : String(e.мин_температура === undefined ? '' : e.мин_температура) + '…' + String(e.макс_температура === undefined ? '' : e.макс_температура) + ' °C']; }) }; };
  ['RECEIPT:Приемка сырья', 'STORAGE:Хранение'].forEach(function (x) { var k = x.split(':'), b = stageEq(k[0]); own[k[1]] = { text: b.premises.length ? ['Помещения: ' + b.premises.join(', ') + '.'] : [], tables: [_wzT_(['Оборудование', 'Категория', 'Режим'], b.equipment)], empty: !b.premises.length && !b.equipment.length, hint: 'Заведите помещения приёмки и хранения в мастере и соберите модель ППК.' }; });
  var invAll = findRows_('INVENTORY_ITEMS', function (i) { return i.location_id === data.locationId && i.status !== 'ARCHIVED'; }), hand = invAll.filter(function (i) { return i.code === 'HAND_KIT'; });
  var hw = findRows_('EQUIPMENT', function (e) { return e.location_id === data.locationId && e.kind_code === 'HANDWASH' && e.active !== false; });
  own['Личная гигиена'] = { text: hw.length ? ['Раковин для мытья рук: ' + hw.length + '; у раковин — дозаторы мыла и кожного антисептика, одноразовые полотенца.'] : [], tables: [_wzT_(['Где', 'Средства гигиены рук'], hand.map(function (i) { var p = findOne_('PREMISES', 'premise_id', i.premise_id); return [p ? p.name : '', i.name]; }))], empty: !hw.length && !hand.length, hint: 'Добавьте раковины для рук и средства гигиены в помещения.' };
  var pv = findOne_('PPK_VERSIONS', 'ppk_id', data.ppkId) || {};
  own['Лист утверждения'] = { text: ['Версия ' + (pv.version || '') + ', статус: ' + ({ DRAFT: 'черновик', REVIEW: 'на согласовании', APPROVED: 'утверждена', ARCHIVED: 'архив' }[pv.status] || pv.status || '') + (pv.approved_at ? ', утверждена ' + String(pv.approved_at).slice(0, 10) : '') + '.', 'Подписи руководителя и ответственного за производственный контроль — на печатной форме.'], empty: false };
  own['Блок-схемы движения продукта'] = own['Потоки сырья'] && { text: ['Сырьё: ' + (own['Потоки сырья'].text[0] || '—'), 'Готовая продукция: ' + (own['Потоки готовой продукции'].text[0] || '—'), 'Отходы: ' + (own['Потоки отходов'].text[0] || '—')], empty: !stages.length, hint: 'Соберите модель ППК.' };
  sections.forEach(function (s) {
    var x = wz[s.title] || own[s.title];
    if (x) { s.text = x.text || []; s.tables = (x.tables || []).filter(function (t) { return t.rows && t.rows.length; }); s.empty = !!x.empty && !s.tables.length && !s.text.length; s.hint = x.hint || ''; if (!x.empty || s.tables.length || s.text.length) s.source_status = 'GENERATED_FROM_TSEKH_DATA'; }
    else { s.text = s.text || []; s.tables = s.tables || []; var b = s.body; s.empty = !s.text.length && (!b || (Array.isArray(b) ? !b.length : !Object.keys(b).length)); s.hint = s.empty ? 'Раздел заполняется вручную или на следующих шагах мастера.' : ''; }
  });
  return sections;
}

function migratePpkWizardSchema_() {
  var changed = [];
  ['PPK_ENTERPRISE', 'PREMISES', 'INVENTORY_ITEMS', 'DISINFECTANTS', 'DISINFECTION_PLANS', 'EQUIPMENT'].forEach(function (k) { changed = changed.concat(ensureSchemaColumns_(k) || []); });
  return { ok: true, changed: changed };
}
