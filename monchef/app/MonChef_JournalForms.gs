/**
 * MON CHEF — этап 10.8. Журналы: одно действие — несколько записей.
 * Собственность Слепцова Дениса Владимировича.
 * Разработчик кода — Слепцов Денис Владимирович
 *
 * Сотрудник вносит один раз — в базовый журнал. Формы ХАССП, которые повторяют те же данные
 * (КТ-5 холодильники, ККТ-1 приёмка, КТ-6 растворы, КТ-7 здоровье, КТ-8 3-Д, КТ-9 ротация),
 * получают копию строки автоматически. Вопрос задаётся один раз — по базовой строке; копия
 * обновляется при каждом изменении базовой (ответ, исправление). Запись «в форму» напрямую
 * уходит в базовый журнал — двух разных записей об одном событии не бывает.
 *
 * Копия связана с базовой строкой: в колонке «Источник записи» — «копия J03 стр. 12».
 */
var MC_J_MIRROR_ = {
  J01: { J25: { 'Время (утро/вечер)': 'Время', 'Наименование оборудования': 'Оборудование', 'Установленный режим': 'Режим',
    'Подпись ответственного': 'Подпись', 'Примечания / корректирующие действия': 'Корректирующие действия' } },
  J03: { J21: { 'ФИО ответственного': 'ФИО', 'Должность': null } },
  J05: { J29: { 'Дата проверки': 'Дата', 'Наименование сырья': 'Сырьё', 'Дата изготовления': 'Дата изг.',
    'Дата ближайшей реализации': 'Дата реализации', 'Результат проверки': 'Результат' } },
  J07: { J27: { 'ФИО сотрудника': 'ФИО', 'Кожа рук (гнойнички)': 'Кожа рук', 'Признаки ОРВИ': 'ОРВИ', 'Жалобы/травмы': 'Жалобы',
    'Допуск к работе (да/нет)': 'Допуск', 'Подпись медработника': 'Подпись' } },
  J08: { J27: { 'Описание травмы/жалобы': 'Жалобы', 'Принятые меры': null, 'ФИО медработника': null } },
  J14: { J28: { 'Площадь/помещение': 'Площадь', 'Договор №': 'Договор', 'Подпись ответственного': 'Подпись', 'Подпись представителя': null } },
  J15: { J26: { 'Тип раствора': 'Раствор', 'Норма концентрации': 'Норма %', 'Факт (тест-полоска)': 'Факт %', 'Соответствие (да/нет)': 'Соответствие' } }
};
/** Форма → базовый журнал (J27 — из осмотра J07; травмы J08 вносятся в J08). */
var MC_J_BASE_OF_ = { J25: 'J01', J21: 'J03', J29: 'J05', J27: 'J07', J28: 'J14', J26: 'J15' };

function _mcJById_(id) {
  var list = typeof JOURNALS !== 'undefined' ? JOURNALS : [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
function _mcJournalBase_(id) { return MC_J_BASE_OF_[String(id || '')] || ''; }
function _mcMirrorKey_(baseId, row) { return 'копия ' + baseId + ' стр. ' + row; }

/** Запись, присланная в форму-копию, переводится в колонки базового журнала. */
function _mcToBaseEntry_(formId, baseId, entry) {
  var m = (MC_J_MIRROR_[baseId] || {})[formId] || {}, rev = {}, out = {}, bj = _mcJById_(baseId);
  Object.keys(m).forEach(function (bc) { if (m[bc]) rev[m[bc]] = bc; });
  Object.keys(entry || {}).forEach(function (k) {
    if (rev[k]) out[rev[k]] = entry[k];
    else if (bj && bj.columns.indexOf(k) >= 0 && m[k] === undefined) out[k] = entry[k];
    else if (!bj || !/^[А-ЯЁа-яё№]/.test(k)) out[k] = entry[k];   // служебные поля (_employeeName, equipmentId…)
  });
  return out;
}

/** Обновить (или создать) копии базовой строки во всех формах. Возвращает число форм. */
function _mcMirrorRow_(baseId, rowIdx) {
  var map = MC_J_MIRROR_[baseId];
  if (!map || !(rowIdx > 1)) return 0;
  var bj = _mcJById_(baseId), bsh = bj ? _book_().getSheetByName(bj.sheetName) : null;
  if (!bsh || rowIdx > bsh.getLastRow()) return 0;
  var bn = bj.columns.length, A = (typeof JOURNAL_AUTHOR_COLS !== 'undefined' ? JOURNAL_AUTHOR_COLS.length : 5);
  var base = bsh.getRange(rowIdx, 1, 1, bn + A).getValues()[0], bval = {};
  bj.columns.forEach(function (c, i) { bval[c] = base[i]; });
  var n = 0;
  Object.keys(map).forEach(function (mid) {
    try {
      var mj = _mcJById_(mid); if (!mj) return;
      var msh = _book_().getSheetByName(mj.sheetName) || _createJournalSheet_(mj);
      var m = map[mid], rev = {}, key = _mcMirrorKey_(baseId, rowIdx), mn = mj.columns.length;
      Object.keys(m).forEach(function (bc) { if (m[bc]) rev[m[bc]] = bc; });
      // запись пачкой: внутри критической секции ключи строк формы помнятся — лист не читается целиком на каждую строку
      var mk = '#MIRROR:' + mj.sheetName, K = _LOCK_DEPTH > 0 ? _MC_RC_[mk] : null, at = -1;
      if (!K) {
        var mv = msh.getDataRange().getValues(); K = {};
        for (var i = 1; i < mv.length; i++) { var kk = String(mv[i][mn + 3] || ''); if (kk) K[kk] = i + 1; }
        if (_LOCK_DEPTH > 0) _MC_RC_[mk] = K;
      }
      if (K[key]) at = K[key];
      var line = mj.columns.map(function (c, k) {
        if (c === '№') return at > 0 ? msh.getRange(at, k + 1).getValue() : msh.getLastRow();
        var bc = rev[c] || (bval[c] !== undefined && m[c] === undefined ? c : null);
        return bc && bval[bc] !== undefined ? bval[bc] : '';
      });
      if (at > 0) msh.getRange(at, 1, 1, mn).setValues([line]);
      else {
        try { _journalAuthorCols_(msh, mj); } catch (e) {}
        msh.appendRow(line.concat([base[bn] || '', base[bn + 1] || '', base[bn + 2] || '', key, base[bn + 4] || '']));
        K[key] = msh.getLastRow();
      }
      n++;
    } catch (e) { try { _log_('WARN', 'форма ' + mid + ' из ' + baseId + ' стр. ' + rowIdx + ': ' + e); } catch (x) {} }
  });
  return n;
}

/* =====================================================================================
 * ПЕЧАТНЫЕ ФОРМЫ J01–J53 (этап 10.8): колонки — из файла заказчика (MC_JF_SPEC_), данные —
 * из базовых журналов и реестров. Форма ничего не придумывает: нет данных — пустая клетка;
 * проверка не выполнена — «НЕ ВЫПОЛНЕНО». У значения — метка источника, внизу — легенда.
 * ===================================================================================== */
var MC_JF_MARKS_ = { 'И': 'измерил человек', 'Д': 'датчик', 'П': 'человек подтвердил «да»', 'С': 'система, из события', 'Р': 'расчёт' };
var MC_JF_ND_ = 'НЕ ВЫПОЛНЕНО';
/**
 * Колонка формы → значение. 'Колонка' — из базового журнала; '@правило:аргументы' — вычисление (см. _jfVal_).
 * b — базовый журнал, o — колонка объекта (для «НЕ ВЫПОЛНЕНО» по расписанию), fact — колонки фактических значений (метка источника).
 */
var MC_JF_MAP_ = {
  J01: { b: 'J01', o: 'Наименование оборудования', fact: ['Фактическая температура, °C'], m: { 'Дата': 'Дата', 'Время': '@time:Время (утро/вечер)', 'Оборудование': 'Наименование оборудования',
    'Норма, °C': 'Установленный режим', 'Фактическая температура, °C': 'Фактическая t°', 'В норме? Да/Нет': '@norm:Фактическая t°|Установленный режим',
    'Ответственный': '@who:Подпись ответственного', 'Отклонение / действие': 'Примечания / корректирующие действия' } },
  J02: { b: 'J02', o: 'Наименование блюда', fact: ['Внешний вид / запах / вкус', 'Решение: допустить/брак'], m: { 'Дата': 'Дата', 'Время выпуска': '@time:Время изготовления', 'Блюдо': 'Наименование блюда',
    'Партия / банкет': 'Партия', 'Внешний вид / запах / вкус': '@join:Органолептика (внешний вид)|Вкус/запах', 'Решение: допустить/брак': 'Решение (отпуск/брак)', 'Ответственный': '@who:ФИО бракера' } },
  J03: { b: 'J03', o: 'Наименование сырья', fact: ['Температура, °C', 'Упаковка / маркировка', 'Принять / отклонить'], m: { 'Дата поставки': 'Дата', 'Продукт': 'Наименование сырья', 'Поставщик': 'Поставщик',
    'Документ / накладная': 'Документы (№, дата)', 'Срок годности': '@exp:Партия', 'Температура, °C': 't° в авто/таре', 'Упаковка / маркировка': '@inpack:Партия', 'Принять / отклонить': 'Решение (принято/брак)',
    'Ответственный': '@who:ФИО ответственного' } },
  J04: { b: 'J04', o: 'Помещение', fact: ['Факт температуры', 'Факт влажности'], m: { 'Дата': 'Дата', 'Время': '@time:Время', 'Помещение / зона': 'Помещение', 'Норма температуры': 'Норма t°',
    'Факт температуры': 't° факт', 'Норма влажности': 'Норма влажности', 'Факт влажности': 'Влажность %', 'Соответствует?': '@norm2:t° факт|Норма t°|Влажность %|Норма влажности', 'Ответственный': '@who:Подпись' } },
  J05: { b: 'J05', o: 'Наименование сырья', fact: ['FIFO соблюдён?'], m: { 'Дата проверки': 'Дата проверки', 'Продукт': 'Наименование сырья', 'Партия': 'Партия', 'Поступило': 'Дата изготовления',
    'Срок годности': 'Срок годности', 'Остаток': 'Количество', 'Статус срока': 'Результат проверки', 'FIFO соблюдён?': 'Действия', 'Действие / ответственный': '@who:Подпись' } },
  J06: { b: 'J06', o: 'Наименование блюда', fact: ['Количество'], m: { 'Дата': 'Дата', 'Блюдо': 'Наименование блюда', 'Витаминный препарат': 'Витамин (C, B1, B2)',
    'Количество': '@join:Доза на порцию|Количество порций', 'Ответственный': '@who:ФИО повара' } },
  J07: { b: 'J07', o: 'ФИО сотрудника', fact: ['Допуск к работе'], m: { 'Дата': 'Дата', 'Сотрудник': 'ФИО сотрудника', 'Должность': 'Должность', 'Результат осмотра': '@med:t° тела|Кожа рук (гнойнички)|Признаки ОРВИ',
    'Жалобы / признаки': '@med:Жалобы/травмы', 'Допуск к работе': 'Допуск к работе (да/нет)', 'Кто осмотрел': '@who:Подпись медработника', 'Время / подпись': '@time:Время' } },
  J08: { b: 'J08', o: 'ФИО', fact: [], m: { 'Дата / время': '@dt:Дата|Время', 'Сотрудник': 'ФИО', 'Событие': '@const:травма / заболевание', 'Описание': '@med:Описание травмы/жалобы',
    'Первая помощь / меры': 'Принятые меры', 'Ответственный': '@who:ФИО медработника' } },
  J09: { b: 'J09', o: 'Инвентарь/тара', fact: ['Факт выполнения'], m: { 'Дата': 'Дата', 'Время': '@time:Время', 'Инвентарь / тара': 'Инвентарь/тара', 'Способ обработки': 'Способ мойки',
    'Средство / концентрация': '@join:Средство|Концентрация', 'Факт выполнения': 'Результат', 'Ответственный': '@who:ФИО' } },
  J10: { b: 'J10', o: 'Помещение/зона', fact: ['Выполнено?'], m: { 'Дата': 'Дата', 'Помещение / зона': 'Помещение/зона', 'Вид уборки': '@const:генеральная', 'Плановое время': '@plan:План/Факт',
    'Фактическое время': '@fact:План/Факт', 'Средство': '@join:Средство|Концентрация', 'Выполнено?': '@done:План/Факт', 'Исполнитель': '@who:Ответственный', 'Проверил': 'Проверил' } },
  J11: { b: 'J11', o: 'Пункт чек-листа', fact: ['Статус'], m: { 'Дата': 'Дата', 'Зона / пункт проверки': 'Пункт чек-листа', 'Статус': 'Статус (✓/✗)', 'Время подтверждения': 'Время (08:00)',
    'Ответственный': '@who:ФИО', 'Замечание / действие': 'Комментарий' } },
  J12: { b: 'J12', o: 'Пункт чек-листа', fact: ['Статус'], m: { 'Дата': 'Дата', 'Зона / пункт проверки': 'Пункт чек-листа', 'Статус': 'Статус (✓/✗)', 'Время подтверждения': 'Время (22:00)',
    'Ответственный': '@who:ФИО', 'Замечание / действие': 'Комментарий' } },
  J13: { b: 'J13', o: 'Пункт чек-листа', fact: ['Результат / замечания'], m: { 'Дата по плану': 'Дата', 'Работы по уборке': 'Пункт чек-листа', 'Плановая дата': 'Понедельник',
    'Исполнитель': '@who:ФИО', 'Результат / замечания': '@join:Статус|Комментарий' } },
  J14: { b: 'J14', o: 'Площадь/помещение', fact: ['Результат'], m: { 'Дата': 'Дата', 'Вид мероприятия': 'Вид обработки', 'Зона / объект': 'Площадь/помещение', 'Исполнитель / организация': 'Организация',
    'Средство / препарат': 'Препарат', 'Результат': 'Эффективность', 'Подтверждение': '@join:Договор №|Сертификат' } },
  J15: { b: 'J15', o: 'Средство', fact: ['Фактическая концентрация'], m: { 'Дата': 'Дата', 'Время': '@time:Время', 'Средство': '@join:Средство|Тип раствора', 'Требуемая концентрация': 'Норма концентрации',
    'Фактическая концентрация': 'Факт (тест-полоска)', 'Соответствует?': 'Соответствие (да/нет)', 'Корректирующее действие': 'Действия', 'Ответственный': '@who:ФИО' } },
  J16: { b: 'J16', o: 'ФИО сотрудника', fact: [], m: { 'Дата': 'Дата', 'Сотрудник': 'ФИО сотрудника', 'Должность': 'Должность', 'Тема инструктажа': 'Тема инструктажа', 'Инструктирующий': '@who:ФИО инструктирующего' } },
  J17: { b: 'J17', o: 'ФИО', fact: [], m: { 'Дата': 'Дата', 'Сотрудник': 'ФИО', 'Должность': 'Должность', 'Тема обучения': 'Тема (ХАССП/ТБ)', 'Формат': 'Содержание', 'Ответственный': '@author' } },
  J18: { b: 'J18', o: 'Оборудование', fact: [], m: { 'Дата / время': '@dt:Дата|Время', 'Оборудование': 'Оборудование', 'Неисправность': 'Описание неисправности', 'Заявитель': '@who:ФИО',
    'Выполненные работы': 'Принятые меры', 'Допуск к работе': 'Результат' } },
  J19: { b: 'J19', o: 'Термометр (№, тип)', fact: ['Эталонное значение, °C', 'Показание прибора, °C'], m: { 'Дата': 'Дата', 'Термометр / ID': 'Термометр (№, тип)', 'Эталонное значение, °C': 'Показания эталона',
    'Показание прибора, °C': 'Показания термометра', 'Отклонение': 'Погрешность', 'Соответствует?': 'Годен (да/нет)', 'Ответственный': '@who:ФИО' } },
  J20: { b: 'J20', o: 'Весы (№, тип)', fact: ['Показание весов'], m: { 'Дата': 'Дата', 'Весы / ID': 'Весы (№, тип)', 'Контрольная масса': 'Эталонный вес', 'Показание весов': 'Показания весов',
    'Отклонение': 'Погрешность', 'Соответствует?': 'Годен (да/нет)', 'Ответственный': '@who:ФИО' } },
  J21: { b: 'J03', o: 'Наименование сырья', fact: ['Температура, °C', 'Органолептика', 'Решение'], m: { 'Дата / время': '@dt:Дата|Время', 'Продукт': 'Наименование сырья', 'Поставщик': 'Поставщик',
    'Партия / накладная': '@join:Партия|Документы (№, дата)', 'Температура, °C': 't° в авто/таре', 'Органолептика': 'Органолептика', 'Документы соответствуют?': '@indoc:Партия', 'Решение': 'Решение (принято/брак)',
    'Отклонение / действие': '@indev:Партия', 'Принял': '@who:ФИО ответственного' } },
  J22: { b: 'J22', o: 'Блюдо/ПФ', fact: ['Температура в центре, °C'], m: { 'Дата': 'Дата', 'Блюдо / продукт': 'Блюдо/ПФ', 'Температура в центре, °C': '@join:Факт t° (изм. 1)|Факт t° (изм. 2)',
    'Время / длительность': '@join:Время|Время достижения', 'Критический предел': 'Норма t° в центре', 'Соответствует?': 'Решение (отпуск/повтор)', 'Измерил': '@who:ФИО повара' } },
  J23: { b: 'J23', o: 'Наименование продукции', fact: ['Начальная температура, °C', 'Промежуточная температура, °C', 'Конечная температура, °C'], m: { 'Дата': 'Дата', 'Продукт / блюдо': 'Наименование продукции',
    'Партия': 'Партия', 'Время начала': 'Время начала', 'Начальная температура, °C': 'Начальная t°', 'Промежуточная температура, °C': 't° через 2 часа', 'Конечная температура, °C': 'Конечная t°',
    'Время окончания': 'Время окончания', 'Предел / результат': 'Соответствие (да/нет)', 'Ответственный': '@who:ФИО' } },
  J24: { b: 'J24', o: 'Блюдо', fact: ['Температура до, °C', 'Температура после, °C'], m: { 'Дата': 'Дата', 'Блюдо': 'Блюдо', 'Партия': 'Партия', 'Температура до, °C': 't° до разогрева',
    'Температура после, °C': 't° после разогрева', 'Время разогрева': 'Время разогрева', 'Соответствует?': 'Решение', 'Ответственный': '@who:ФИО повара' } },
  J25: { b: 'J01', o: 'Наименование оборудования', fact: ['Фактическая температура'], m: { 'Дата': 'Дата', 'Время / событие': '@time:Время (утро/вечер)', 'Оборудование': 'Наименование оборудования',
    'Установленный предел': 'Установленный режим', 'Фактическая температура': 'Фактическая t°', 'Источник данных': '@src', 'Статус': '@stat:Фактическая t°|Установленный режим',
    'Уведомление создано?': '@notif:Примечания / корректирующие действия', 'Ответственный / действие': '@join:Подпись ответственного|Примечания / корректирующие действия' } },
  J26: { b: 'J15', o: 'Средство', fact: ['Фактическая концентрация'], m: { 'Дата': 'Дата', 'Время': '@time:Время', 'Средство': '@join:Средство|Тип раствора', 'Норма концентрации': 'Норма концентрации',
    'Фактическая концентрация': 'Факт (тест-полоска)', 'Соответствует?': 'Соответствие (да/нет)', 'Действие': 'Действия', 'Ответственный': '@who:ФИО' } },
  J27: { b: 'J07', b2: 'J08', o: 'ФИО сотрудника', fact: ['Решение о допуске'], m: { 'Дата / время': '@dt:Дата|Время', 'Сотрудник': '@first:ФИО сотрудника|ФИО', 'Тип события': '@kind',
    'Описание / признаки': '@med:t° тела|Кожа рук (гнойнички)|Признаки ОРВИ|Жалобы/травмы|Описание травмы/жалобы', 'Решение о допуске': 'Допуск к работе (да/нет)', 'Принятые меры': 'Принятые меры',
    'Ответственный': '@who:Подпись медработника' } },
  J28: { b: 'J14', o: 'Площадь/помещение', fact: ['Результат'], m: { 'Дата': 'Дата', 'Зона / точка контроля': 'Площадь/помещение', 'Проведённое мероприятие': '@join:Вид обработки|Препарат',
    'Исполнитель': 'Организация', 'Результат': 'Эффективность', 'Ответственный': '@who:Подпись ответственного' } },
  J29: { b: 'J05', o: 'Наименование сырья', fact: ['FIFO соблюдён?'], m: { 'Дата / время проверки': 'Дата проверки', 'Продукт': 'Наименование сырья', 'Партия': 'Партия', 'Срок годности': 'Срок годности',
    'Остаток': 'Количество', 'Статус': 'Результат проверки', 'FIFO соблюдён?': 'Действия', 'Ответственный': '@who:Подпись' } },
  J30: { b: 'J30', st: true, fact: [], m: { 'ID схемы': '№', 'Название процесса': '@join:Блюдо|Этап', 'Основание изменения': 'Описание', 'Ответственный': '@author', 'Ссылка / файл': 'Ссылка на документ' } },
  J31: { b: 'J31', st: true, fact: [], m: { 'ID риска': '№', 'Процесс / этап': 'Этап', 'Описание опасности': '@join:Биологическая опасность|Химическая|Физическая', 'Тяжесть': 'Оценка риска',
    'Меры управления': 'Контроль', 'Ответственный': '@author' } },
  J32: { b: 'J32', st: true, fact: [], m: { 'ККТ / КТ': 'ККТ', 'Опасность': 'Опасность', 'Критический предел': 'Критический предел', 'Метод мониторинга': 'Мониторинг (кто/как/частота)',
    'Корректирующее действие': 'Корректирующие действия', 'Ответственный': '@author' } },
  J33: { b: 'J33', o: 'Объект проверки', fact: ['Результат'], m: { 'Дата': 'Дата', 'Объект / процесс проверки': 'Объект проверки', 'Результат': 'Результат', 'Выявленное несоответствие': 'Отклонения',
    'Корректирующее действие': 'Корректирующие действия', 'Проверил': '@who:ФИО' } },
  J35: { b: 'J35', fact: [], m: { 'ID документа': '№', 'Название документа': 'Документ', 'Версия': 'Версия', 'Дата создания': 'Дата', 'Автор / изменил': '@who:ФИО', 'Ссылка / файл': 'Место хранения' } },
  J36: { b: 'J36', o: 'Блюдо', fact: [], m: { 'Дата / время': '@dt:Дата|Время', 'Заказ / чек': '@order:ФИО продавца', 'Блюдо': 'Блюдо', 'Количество': 'Количество', 'Цена': 'Цена', 'Сумма': 'Сумма',
    'Канал продаж': '@channel', 'Источник данных': '@src' } },
  J37: { b: 'J37', o: 'Наименование лампы / расположение', fact: ['Наработка, ч'], m: { 'Дата': 'Дата', 'Лампа / ID': 'Наименование лампы / расположение', 'Помещение': '@room:Наименование лампы / расположение',
    'Время включения': 'Время включения', 'Время выключения': 'Время выключения', 'Наработка, ч': '@lamp:Время работы (час)', 'Общий ресурс, ч': 'Срок службы лампы (час)', 'Остаток ресурса, ч': 'Остаток до замены (час)',
    'Обслуживание / замена': 'Решение', 'Ответственный': '@who:ФИО ответственного' } },
  J38: { b: 'J38', o: 'Тип жарочного оборудования', fact: ['Показатель качества / тест', 'Результат проверки'], m: { 'Дата': 'Дата', 'Фритюр / оборудование': 'Тип жарочного оборудования', 'Масло / партия': 'Вид фритюрного жира',
    'Время начала использования': 'Время начала использования жира', 'Показатель качества / тест': 'Органолептическая оценка жира на начало жарки', 'Результат проверки': 'Органолептическая оценка жира по окончании жарки',
    'Количество заменённого масла': 'Утилизированный жир, кг', 'Ответственный': '@who:ФИО контролёра', 'Примечание': 'Примечания / корректирующие действия' } },
  J39: { b: 'J03', o: 'Наименование сырья', fact: ['Внутр. темп-ра продукта (для скоропортящихся и замороженных продуктов)', 'Принят / Отклонить, П/О'], m: { 'Дата поставки': 'Дата', 'Наименование продукции': 'Наименование сырья',
    'Годен до': '@exp:Партия', 'Производитель / поставщик': 'Поставщик', 'ТТН, документы соответствия': 'Документы (№, дата)', 'Объем и номер партии': '@qty:Партия',
    'Внутр. темп-ра продукта (для скоропортящихся и замороженных продуктов)': 't° в авто/таре', 'Соответствие товара сопроводительной документации': '@indoc:Партия',
    'Соответствие внешнего вида упаковки, маркировки требованиям НД': '@inpack:Партия', 'Принят / Отклонить, П/О': '@po:Решение (принято/брак)', 'Корректирующие действия для забракованного товара': '@indev:Партия',
    'Ответственный': '@who:ФИО ответственного' } },
  J40: { b: 'J02', o: 'Наименование блюда', fact: ['Органолептическая оценка (включая оценку степени готовности)'], m: { 'Дата, время изготовления': '@dt:Дата|Время изготовления', 'Время снятия бракеража': '@entered',
    'Наименование блюд (изделий)': 'Наименование блюда', 'Органолептическая оценка (включая оценку степени готовности)': '@join:Органолептика (внешний вид)|Вкус/запах',
    'Разрешение к реализации (время)': 'Решение (отпуск/брак)', 'Ответственный исполнитель (ФИО, должность)': '@join:ФИО повара|Должность', 'ФИО лица, проводившего бракераж': 'ФИО бракера' } },
  J41: { b: 'J38', o: 'Тип жарочного оборудования', fact: ['Органолептическая оценка качества жира на начало жарки', 'Органолептическая оценка качества жира по окончании жарки'], m: {
    'Дата, время начала использования фритюрного жира': '@dt:Дата|Время начала использования жира', 'Вид фритюрного жира': 'Вид фритюрного жира',
    'Органолептическая оценка качества жира на начало жарки': 'Органолептическая оценка жира на начало жарки', 'Тип жарочного оборудования': 'Тип жарочного оборудования', 'Вид продукции': 'Вид продукции',
    'Время окончания фритюрной жарки': 'Время окончания жарки', 'Органолептическая оценка качества жира по окончании жарки': 'Органолептическая оценка жира по окончании жарки',
    'Переходящий остаток, кг': 'Переходящий остаток жира, кг', 'Утилизированный, кг': 'Утилизированный жир, кг', 'Должность, ФИО контролера': '@join:Должность|ФИО контролёра' } },
  J43: { b: 'J04', o: 'Помещение', fact: ['Т, °C', 'ВВ, %'], m: { 'Дата': 'Дата', 'Помещение': 'Помещение', 'Время': '@time:Время', 'Т, °C': 't° факт', 'ВВ, %': 'Влажность %',
    'Норма Т / ВВ': '@join:Норма t°|Норма влажности', 'Фамилия ответственного лица': '@who:Подпись' } }
};

function _jfTz_() { return _mcTz_(); }
function _jfIsDate_(x) { return Object.prototype.toString.call(x) === '[object Date]' && !isNaN(x.getTime()); }
function _jfIso_(x) {
  if (_jfIsDate_(x)) return x.getFullYear() < 1901 ? '' : Utilities.formatDate(x, _jfTz_(), 'yyyy-MM-dd');
  var s = String(x || '').trim(), m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? m[0] : '';
}
function _jfFmt_(x) {
  if (x === null || x === undefined) return '';
  if (_jfIsDate_(x)) {
    if (x.getFullYear() < 1901) return Utilities.formatDate(x, _jfTz_(), 'HH:mm');
    var hm = Utilities.formatDate(x, _jfTz_(), 'HH:mm');
    return Utilities.formatDate(x, _jfTz_(), 'dd.MM.yyyy') + (hm === '00:00' ? '' : ' ' + hm);
  }
  var s = String(x);
  if (/^#(ERROR|REF|N\/A|VALUE|NAME)/i.test(s)) return '';    // ошибка формулы в старых данных — не значение
  return s;
}
function _jfRu_(iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : ''; }
/** Строка J37 начислена расписанием, а не отмечена человеком: источник «расписание», «расчёт по регламенту» или нет ни ответственного, ни автора. */
function _jfLampAuto_(rec) { var f = String(rec.v['ФИО ответственного'] || ''); return /расписание/.test(rec.src || '') || /регламент/.test(f) || (!f.trim() && !_jfAuthorFio_(rec)); }
function _jfAuthorFio_(rec) { return (rec.au && rec.au.фио && rec.au.фио !== 'Система') ? rec.au.фио : ''; }

/** Строки базового журнала за период: { row, d, v:{колонка:значение}, au, src }. */
function _jfBaseRows_(bid, from, to, ignorePeriod) {
  var j = _mcJById_(bid), sh = j ? _book_().getSheetByName(j.sheetName) : null;
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), dc = -1, out = [];
  for (var k = 0; k < j.columns.length; k++) if (/^дата/i.test(j.columns[k])) { dc = k; break; }
  for (var i = 1; i < v.length; i++) {
    if (!v[i].slice(0, j.columns.length).some(function (x) { return x !== '' && x !== null; })) continue;
    var d = dc >= 0 ? _jfIso_(v[i][dc]) : '';
    if (!ignorePeriod && dc >= 0 && (!d || d < from || d > to)) continue;
    var rec = { row: i + 1, d: d, v: {}, au: _journalAuthorOf_(j, v[i]), j: bid };
    j.columns.forEach(function (c, n) { rec.v[c] = v[i][n]; });
    rec.src = rec.au ? String(rec.au.источник || '') : '';
    out.push(rec);
  }
  return out;
}

/** Контекст формы: проверки без ответа, ответы на адресные вопросы, исправления, партии, права. */
function _jfCtx_(bids, from, to, s) {
  var ctx = { nd: {}, pa: {}, sched: [], corr: {}, med: !s || _mcRbHasExact_(s, 'medical_view'), lateMin: _mcLateMin_(), today: Utilities.formatDate(new Date(), _jfTz_(), 'yyyy-MM-dd'),
    nowHm: Utilities.formatDate(new Date(), _jfTz_(), 'HH:mm') };
  var want = {}; bids.forEach(function (b) { want[b] = true; });
  try {
    var pv = _pendSheet_().getDataRange().getValues();
    for (var i = 1; i < pv.length; i++) {
      var jid = String(pv[i][2]); if (!want[jid]) continue;
      var d = _jfIso_(pv[i][5]); if (!d || d < from || d > to) continue;
      var st = String(pv[i][8]), row = Number(pv[i][16]) || 0, col = Number(pv[i][17]) || 0;
      if (st === 'выполнено') { if (row && col) ctx.pa[jid + '|' + row + '|' + col] = { ans: String(pv[i][9]), val: pv[i][10] }; continue; }
      if (st === 'отменено') continue;
      var overdue = d < ctx.today || (d === ctx.today && _hm2min_(pv[i][7]) !== null && _hm2min_(pv[i][7]) < _hm2min_(ctx.nowHm));
      if (!overdue) continue;
      if (row && col) ctx.nd[jid + '|' + row + '|' + col] = true;
      else ctx.sched.push({ j: jid, d: d, hm: String(pv[i][6] || ''), obj: String(pv[i][3] || ''), q: String(pv[i][4] || ''), dev: String(pv[i][13] || '') });
    }
  } catch (e) {}
  try {
    var cv = _mcCorrectionsSheet_().getDataRange().getValues();
    for (var c = 1; c < cv.length; c++) if (want[String(cv[c][1])] && String(cv[c][13]) === 'APPROVED') {
      var key = cv[c][1] + '|' + Number(cv[c][5]), o = {}; try { o = JSON.parse(cv[c][7] || '{}'); } catch (e) {}
      ctx.corr[key] = Object.assign(ctx.corr[key] || {}, o);
    }
  } catch (e) {}
  return ctx;
}
function _jfBatch_(ctx, id) {
  if (!ctx.batches) {
    ctx.batches = {}; ctx.inctl = {};
    try { var bv = _stockBatchesSheet_().getDataRange().getValues(); for (var i = 1; i < bv.length; i++) if (bv[i][0]) ctx.batches[String(bv[i][0])] = { qty: bv[i][3], unit: bv[i][2], exp: bv[i][5] }; } catch (e) {}
    try { var ic = _book_().getSheetByName(MC_BC_IN_); if (ic) ic.getDataRange().getValues().slice(1).forEach(function (r) { ctx.inctl[String(r[1])] = { doc: r[4], pack: r[10], dec: r[11], why: r[12], act: r[13] }; }); } catch (e) {}
  }
  return { b: ctx.batches[String(id)] || null, c: ctx.inctl[String(id)] || null };
}
function _jfMark_(rec, col, ctx) {
  var j = _mcJById_(rec.j), ci = j ? j.columns.indexOf(col) : -1;
  var p = ci >= 0 ? ctx.pa[rec.j + '|' + rec.row + '|' + (ci + 1)] : null;
  if (p) return (p.ans === 'да' && (p.val === '' || p.val === 'да')) ? 'П' : 'И';
  var s = rec.src || '';
  if (/подтвержд/.test(s)) return 'П';
  if (/датчик/.test(s)) return 'Д';
  if (/замер|интерфейс|корректирующее/.test(s)) return 'И';
  return 'С';
}
function _jfLimits_(normText) {
  var t = String(normText || ''), m = /допустимо\s*([^;]+)/i.exec(t);
  return _tRangeOf_((m ? m[1] : t).replace(/…|\.\.\./g, ' … '));
}
function _jfIn_(val, normText) {
  var f = _tNum_(String(val === undefined ? '' : val).replace(/\s*%$/, '')), r = _jfLimits_(normText);
  if (f === null || (r.min === null && r.max === null)) return null;
  return !((r.min !== null && f < r.min) || (r.max !== null && f > r.max));
}

/** Значение клетки формы. Возвращает { v, m } (m — метка источника). */
function _jfVal_(expr, rec, ctx) {
  if (!expr) return { v: '' };
  var g = function (c) { return _jfFmt_(rec.v[c]); };
  if (expr.charAt(0) !== '@') {
    var val = g(expr);
    if (val === '') { var j = _mcJById_(rec.j), ci = j ? j.columns.indexOf(expr) : -1; if (ci >= 0 && ctx.nd[rec.j + '|' + rec.row + '|' + (ci + 1)]) return { v: MC_JF_ND_, nd: true }; }
    return { v: val, col: expr };
  }
  var p = expr.indexOf(':'), op = p > 0 ? expr.slice(1, p) : expr.slice(1), args = p > 0 ? expr.slice(p + 1).split('|') : [];
  switch (op) {
    case 'const': return { v: args.join('|') };
    case 'join': return { v: args.map(g).filter(function (x) { return x !== ''; }).join('; '), col: args[0] };
    case 'first': for (var a = 0; a < args.length; a++) if (g(args[a])) return { v: g(args[a]) }; return { v: '' };
    case 'dt': return { v: [g(args[0]), g(args[1])].filter(Boolean).join(' ') };
    case 'who': return { v: g(args[0]) || _jfAuthorFio_(rec) };
    case 'author': return { v: _jfAuthorFio_(rec) };
    case 'entered': return { v: rec.au ? String(rec.au.внесено || '') : '' };
    case 'time': {
      var t = g(args[0]); if (!t || !rec.au || !rec.au.внесено || !rec.d) return { v: t };
      var m = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/.exec(String(rec.au.внесено)), tm = /(\d{1,2}):(\d{2})/.exec(t);
      if (!m || !tm) return { v: t };
      var ev = new Date(+rec.d.slice(0, 4), +rec.d.slice(5, 7) - 1, +rec.d.slice(8, 10), +tm[1], +tm[2]), en = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
      if ((en.getTime() - ev.getTime()) / 60000 > ctx.lateMin) return { v: t + ' / внесено ' + (m[3] + '-' + m[2] + '-' + m[1] === rec.d ? '' : m[1] + '.' + m[2] + ' ') + m[4] + ':' + m[5] + (_jfAuthorFio_(rec) ? ' ' + _jfAuthorFio_(rec) : ''), late: true };
      return { v: t };
    }
    case 'norm': { var ok = _jfIn_(rec.v[args[0]], rec.v[args[1]]); return ok === null ? { v: '' } : { v: ok ? 'Да' : 'Нет', m: 'Р', dev: !ok }; }
    case 'norm2': {
      var a1 = _jfIn_(rec.v[args[0]], rec.v[args[1]]), a2 = String(rec.v[args[3]] || '') ? _jfIn_(rec.v[args[2]], rec.v[args[3]]) : true;
      if (a1 === null || a2 === null) return { v: '' };
      return { v: a1 && a2 ? 'Да' : 'Нет', m: 'Р', dev: !(a1 && a2) };
    }
    case 'stat': { var s1 = _jfIn_(rec.v[args[0]], rec.v[args[1]]); return s1 === null ? { v: '' } : { v: s1 ? 'в норме' : 'вне предела', m: 'Р', dev: !s1 }; }
    case 'notif': return { v: /отклонение/i.test(String(rec.v[args[0]] || '')) ? 'да' : 'нет' };
    case 'src': { var s2 = rec.src || ''; return { v: /подтвержд/.test(s2) ? 'подтверждение сотрудника' : /датчик/.test(s2) ? 'датчик' : /замер|интерфейс/.test(s2) ? 'замер сотрудника' : s2 ? 'система: ' + s2 : '' }; }
    case 'po': { var dv = g(args[0]).toLowerCase(); return { v: /брак|отклон|не соотв|^нет/.test(dv) ? 'О' : /принят|соотв|^да/.test(dv) ? 'П' : '', col: args[0] }; }
    case 'med': { var mv = args.map(g).filter(Boolean).join('; '); return { v: mv && !ctx.med ? 'скрыто (медицинские данные)' : mv }; }
    case 'room': { var rm = /\(([^)]+)\)/.exec(g(args[0])); return { v: rm ? rm[1] : '' }; }
    case 'lamp': return _jfLampAuto_(rec) ? { v: 'начислено по регламенту — не подтверждено', dev: true } : { v: g(args[0]), col: args[0] };
    case 'kind': return { v: rec.j === 'J08' ? 'травма / заболевание' : 'осмотр перед работой' };
    case 'order': { var om = /банкет[а-я]*\s+([^)\s«]+)/i.exec(g(args[0])); return { v: om ? 'банкет ' + om[1] : '' }; }
    case 'channel': return { v: /банкет/i.test(rec.src + ' ' + JSON.stringify(rec.v)) ? 'выдача банкета' : '' };
    case 'exp': { var b = _jfBatch_(ctx, rec.v[args[0]]).b; return b && b.exp ? { v: _jfFmt_(b.exp instanceof Date ? b.exp : String(b.exp)), m: 'С' } : { v: '' }; }
    case 'qty': { var bq = _jfBatch_(ctx, rec.v[args[0]]).b; return { v: [bq ? (bq.qty + ' ' + (bq.unit || '')) : '', g(args[0])].filter(function (x) { return String(x).trim(); }).join(', ') }; }
    case 'inpack': { var c1 = _jfBatch_(ctx, rec.v[args[0]]).c; return c1 && c1.pack !== '' && c1.pack !== undefined ? { v: _jfFmt_(c1.pack), m: 'И' } : { v: '' }; }
    case 'indoc': { var c2 = _jfBatch_(ctx, rec.v[args[0]]).c; return c2 && c2.doc ? { v: _jfFmt_(c2.doc) } : { v: '' }; }
    case 'indev': { var c3 = _jfBatch_(ctx, rec.v[args[0]]).c; return c3 ? { v: [c3.why, c3.act].map(_jfFmt_).filter(Boolean).join('; ') } : { v: '' }; }
    case 'plan': return { v: /план/i.test(g(args[0])) ? _jfRu_(rec.d) : '' };
    case 'fact': return { v: /факт|выполн/i.test(g(args[0])) ? _jfRu_(rec.d) : '' };
    case 'done': { var dn = g(args[0]); return { v: /факт|выполн/i.test(dn) ? 'да' : /план/i.test(dn) ? '' : dn, col: args[0] }; }
  }
  return { v: '' };
}

/** Строки табличной формы по карте MC_JF_MAP_. */
function _jfTableRows_(id, sp, map, from, to, s) {
  var bids = [map.b].concat(map.b2 ? [map.b2] : []), ctx = _jfCtx_(bids, from, to, s), recs = [];
  bids.forEach(function (b) { recs = recs.concat(_jfBaseRows_(b, from, to, !!map.st)); });
  var cols = sp.c, out = [], dateCol = cols.filter(function (c) { return /дата/i.test(c); })[0], timeCol = cols.filter(function (c) { return /^время/i.test(c) || /время \/ событие/i.test(c); })[0];
  recs.forEach(function (rec) {
    var corr = ctx.corr[rec.j + '|' + rec.row]; if (corr) Object.keys(corr).forEach(function (k) { rec.v[k] = corr[k]; });
    var row = { d: rec.d, ref: rec.j + ' стр. ' + rec.row, corrected: !!corr, cells: [] };
    cols.forEach(function (c) {
      var x = _jfVal_(map.m[c] || '', rec, ctx);
      if (!x.m && map.fact.indexOf(c) >= 0 && x.v !== '' && !x.nd && x.col) x.m = _jfMark_(rec, x.col, ctx);
      if (x.nd) row.nd = true; if (x.late) row.late = true; if (x.dev) row.dev = true;
      row.cells.push({ v: x.v, m: x.m || '' });
    });
    // строка есть, а фактических значений нет: за прошедший день — «НЕ ВЫПОЛНЕНО», за сегодня — «ожидает» (пустая строка выглядела бы как запись)
    var fi = map.fact.map(function (c) { return cols.indexOf(c); }).filter(function (k) { return k >= 0; });
    if (fi.length && fi.every(function (k) { return row.cells[k].v === ''; })) {
      if (rec.d && rec.d < ctx.today) { row.cells[fi[0]] = { v: MC_JF_ND_, m: '' }; row.nd = true; } else row.cells[fi[0]] = { v: 'ожидает', m: '' };
    }
    if (/не соответствует|вне предела|отклонение|брак/i.test(row.cells.map(function (x) { return x.v; }).join(' '))) row.dev = true;
    row.t = timeCol ? row.cells[cols.indexOf(timeCol)].v : '';
    out.push(row);
  });
  // проверки по расписанию без ответа — строкой «НЕ ВЫПОЛНЕНО» (пустая строка с датой выглядела бы как запись)
  if (map.o) ctx.sched.forEach(function (p) {
    if (p.j !== map.b) return;
    var row = { d: p.d, ref: 'проверка по графику ' + p.hm, nd: true, cells: [], t: p.hm }, factCol = map.fact[0];
    cols.forEach(function (c) {
      var e = map.m[c] || '', v = '';
      if (c === dateCol) v = _jfRu_(p.d) + (/время/i.test(c) ? ' ' + p.hm : '');
      else if (c === timeCol) v = p.hm;
      else if (e === map.o || e === '@first:' + map.o + '|ФИО') v = p.obj;
      else if (c === factCol) v = MC_JF_ND_;
      row.cells.push({ v: v, m: '' });
    });
    if (!factCol || cols.indexOf(factCol) < 0) row.cells[row.cells.length - 1].v = MC_JF_ND_ + ': ' + p.q;
    out.push(row);
  });
  out.sort(function (a, b) { return (a.d + ' ' + a.t) < (b.d + ' ' + b.t) ? -1 : (a.d + ' ' + a.t) > (b.d + ' ' + b.t) ? 1 : 0; });
  return out;
}

/* ---------- формы с особым источником ---------- */
function _jfDays_(from) { var y = +from.slice(0, 4), m = +from.slice(5, 7); return new Date(y, m, 0).getDate(); }
function _jfMonthRange_(from) { var y = from.slice(0, 4), m = from.slice(5, 7); return { from: y + '-' + m + '-01', to: y + '-' + m + '-' + ('0' + _jfDays_(from)).slice(-2), y: +y, m: +m }; }
var MC_JF_MONTHS_ = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** J34 — из реестра отклонений и корректирующих действий (одна запись на отклонение). */
function _jfJ34_(from, to) {
  var dv = _devSheet_().getDataRange().getValues(), ca = _corrSheet_().getDataRange().getValues(), acts = {}, out = [];
  for (var k = 1; k < ca.length; k++) { var id = String(ca[k][1]); (acts[id] = acts[id] || []).push(ca[k]); }
  for (var i = 1; i < dv.length; i++) {
    if (!dv[i][0]) continue;
    var d = _jfIso_(dv[i][11]); if (!d || d < from || d > to) continue;
    var a = acts[String(dv[i][0])] || [], auto = a.filter(function (x) { return /^Проверить отклонение/.test(String(x[2])); }), human = a.filter(function (x) { return !/^Проверить отклонение/.test(String(x[2])); });
    var jn = String(dv[i][2] || ''), closed = dv[i][12] ? _jfFmt_(dv[i][12]) : '';
    out.push({ d: d, t: '', ref: String(dv[i][0]), dev: !closed, cells: [String(dv[i][0]), _jfFmt_(dv[i][11]), (jn ? _journalName_(jn) : '') + (dv[i][3] ? ' — ' + dv[i][3] : ''), _jfFmt_(dv[i][4]) + (dv[i][5] !== '' ? ' (' + dv[i][5] + ')' : ''),
      auto.length ? 'да: ' + _jfFmt_(auto[0][0]) : 'нет', '', human.map(function (x) { return _jfFmt_(x[2]); }).join('; '), _jfFmt_(dv[i][10]), human.map(function (x) { return _jfFmt_(x[4]); }).filter(Boolean).join('; '),
      closed ? closed + (human.length ? ' / ' + _jfFmt_(human[human.length - 1][7]) : '') : 'открыто'].map(function (v) { return { v: v, m: '' }; }) });
  }
  return out;
}
/** Объекты температурного контроля журнала (холодильники — J01, помещения — J04). */
function _jfTempObjects_(jid) { try { return _tObjects_().filter(function (o) { return o.journalId === jid; }); } catch (e) { return []; } }
/** J42 — сетка «холодильник × дни месяца» из записей J01. В клетке — значения за день с меткой; «н/в» — проверка не выполнена. */
function _jfJ42_(from, s) {
  var R = _jfMonthRange_(from), n = _jfDays_(from), recs = _jfBaseRows_('J01', R.from, R.to), ctx = _jfCtx_(['J01'], R.from, R.to, s), rows = {}, order = [], who = {}, codes = {}, codeN = 0;
  var add = function (name) { if (!rows[name]) { rows[name] = []; for (var d = 0; d < n; d++) rows[name].push([]); order.push(name); } return rows[name]; };
  _jfTempObjects_('J01').filter(function (o) { return o.status === 'ACTIVE' && o.type !== 'HOT_HOLDING'; }).forEach(function (o) { add(o.name); });
  recs.forEach(function (rec) {
    var name = String(rec.v['Наименование оборудования'] || ''), t = _jfFmt_(rec.v['Фактическая t°']); if (!name) return;
    var day = +rec.d.slice(8, 10) - 1; if (t !== '') add(name)[day].push(t + ' ' + _jfMark_(rec, 'Фактическая t°', ctx));
    var f = _jfAuthorFio_(rec); if (f) { if (!codes[f]) codes[f] = 'С' + (++codeN); who[day] = who[day] || {}; who[day][codes[f]] = true; }
  });
  ctx.sched.forEach(function (p) { if (p.j === 'J01' && rows[p.obj]) rows[p.obj][+p.d.slice(8, 10) - 1].push('н/в ' + p.hm); });
  var out = order.map(function (name) { return { d: R.from, cells: [{ v: name }].concat(rows[name].map(function (x) { return { v: x.join(' / ') }; })), nd: rows[name].some(function (x) { return x.join(' ').indexOf('н/в') >= 0; }) }; });
  var wr = [{ v: 'Ответственный (код)' }]; for (var d2 = 0; d2 < n; d2++) wr.push({ v: who[d2] ? Object.keys(who[d2]).join(', ') : '' });
  out.push({ d: R.from, cells: wr, foot: true });
  return { rows: out, cols: ['Наименование или номер ХК'].concat(_jfSeq_(n)), notes: ['Месяц: ' + MC_JF_MONTHS_[R.m - 1] + ' ' + R.y + ' г.', 'Коды: ' + (Object.keys(codes).map(function (f) { return codes[f] + ' – ' + f; }).join('; ') || '—'), 'н/в — проверка по графику не выполнена.'] };
}
function _jfSeq_(n) { var a = []; for (var i = 1; i <= n; i++) a.push(String(i)); return a; }
/** J44 — «сотрудник × дни»: «+» допущен, «−» не допущен, «н/в» осмотр не проведён. Медицинских подробностей нет. */
function _jfJ44_(from, s) {
  var R = _jfMonthRange_(from), n = _jfDays_(from), recs = _jfBaseRows_('J07', R.from, R.to), tr = _jfBaseRows_('J08', R.from, R.to), ctx = _jfCtx_(['J07'], R.from, R.to, s), rows = {}, pos = {}, order = [], meas = {};
  recs.forEach(function (rec) {
    var nm = String(rec.v['ФИО сотрудника'] || '').replace(/\s+/g, ' ').trim(); if (!nm) return;
    if (!rows[nm]) { rows[nm] = []; for (var d = 0; d < n; d++) rows[nm].push(''); order.push(nm); pos[nm] = _jfFmt_(rec.v['Должность']).trim(); }
    var a = String(rec.v['Допуск к работе (да/нет)'] || '').toLowerCase(), day = +rec.d.slice(8, 10) - 1;
    var ci = _mcJById_('J07').columns.indexOf('Допуск к работе (да/нет)') + 1;
    rows[nm][day] = /не соотв|^нет|не допущ/.test(a) ? '−' : a ? '+' : (ctx.nd['J07|' + rec.row + '|' + ci] ? 'н/в' : rows[nm][day]);
  });
  tr.forEach(function (rec) { var nm = String(rec.v['ФИО'] || '').replace(/\s+/g, ' ').trim(); if (nm && rec.v['Принятые меры']) (meas[nm] = meas[nm] || []).push(_jfRu_(rec.d) + ': ' + _jfFmt_(rec.v['Принятые меры'])); });
  return { rows: order.map(function (nm, i) { return { d: R.from, nd: rows[nm].indexOf('н/в') >= 0, dev: rows[nm].indexOf('−') >= 0, cells: [{ v: String(i + 1) }, { v: nm }, { v: pos[nm] }].concat(rows[nm].map(function (x) { return { v: x }; })).concat([{ v: ctx.med ? (meas[nm] || []).join('; ') : ((meas[nm] || []).length ? 'есть записи (медицинские данные)' : '') }]) }; }),
    cols: ['№ п/п', 'Ф.И.О. работника', 'Должность'].concat(_jfSeq_(n)).concat(['Принятые меры']), notes: ['Месяц: ' + MC_JF_MONTHS_[R.m - 1] + ' ' + R.y + ' г.', '«+» — здоров, допущен; «−» — не допущен; «н/в» — осмотр не проведён.'] };
}
/** Уборки: генеральные (J10) и выполненные задачи санитарии. */
function _jfCleanings_(from, to) {
  var out = [];
  _jfBaseRows_('J10', from, to).forEach(function (rec) { if (!/факт|выполн/i.test(String(rec.v['План/Факт'] || ''))) return;
    out.push({ d: rec.d, t: '', room: _jfFmt_(rec.v['Помещение/зона']), kind: 'Г', what: 'Генеральная уборка', agent: [_jfFmt_(rec.v['Средство']), _jfFmt_(rec.v['Концентрация'])].filter(Boolean).join(' '), who: _jfFmt_(rec.v['Ответственный']) || _jfAuthorFio_(rec) }); });
  try {
    var areas = {}, ds = {};
    (_book_().getSheetByName('Санитария_Зоны_V42') || { getDataRange: function () { return { getValues: function () { return []; } }; } }).getDataRange().getValues().slice(1).forEach(function (r) { areas[String(r[0])] = String(r[1] || r[0]); });
    (_book_().getSheetByName('Дезсредства_V41') || { getDataRange: function () { return { getValues: function () { return []; } }; } }).getDataRange().getValues().slice(1).forEach(function (r) { ds[String(r[0])] = String(r[2] || r[0]); });
    var ex = _book_().getSheetByName('Санитария_Выполнение_V42'); if (ex) ex.getDataRange().getValues().slice(1).forEach(function (r) {
      var d = _jfIso_(r[2]); if (!d || d < from || d > to) return;
      var m = String(r[8] || '') + ' ' + String(r[14] || '');
      out.push({ d: d, t: _jfIsDate_(r[2]) ? Utilities.formatDate(r[2], _jfTz_(), 'HH:mm') : '', room: areas[String(r[4])] || String(r[4] || ''), kind: /генер/i.test(m) ? 'Г' : 'Т',
        what: /дезинф/i.test(m) ? 'Дезинфекция' : 'Влажная уборка', agent: ds[String(r[6])] || String(r[6] || ''), who: String(r[3] || '') });
    });
  } catch (e) {}
  return out;
}
function _jfJ46_(from) {
  var R = _jfMonthRange_(from), n = _jfDays_(from), rows = {}, order = [];
  _jfCleanings_(R.from, R.to).forEach(function (c) {
    var k = c.room || '—'; if (!rows[k]) { rows[k] = { agent: {}, days: [] }; for (var d = 0; d < n; d++) rows[k].days.push(''); order.push(k); }
    var day = +c.d.slice(8, 10) - 1; if (c.agent) rows[k].agent[c.agent] = true;
    rows[k].days[day] = rows[k].days[day] === 'Г' || c.kind === 'Г' ? 'Г' : 'Т';
  });
  return { rows: order.map(function (k) { return { d: R.from, cells: [{ v: k }, { v: Object.keys(rows[k].agent).join(', ') }].concat(rows[k].days.map(function (x) { return { v: x }; })) }; }),
    cols: ['Наименование помещения', 'Моющие и дезинфицирующие средства'].concat(_jfSeq_(n)), notes: ['Месяц: ' + MC_JF_MONTHS_[R.m - 1] + ' ' + R.y + ' г.', 'Т — текущая; Г — генеральная уборка.'] };
}
function _jfJ47_(from, to) {
  return _jfCleanings_(from, to).filter(function (c) { return c.kind === 'Т'; }).map(function (c) {
    return { d: c.d, t: c.t, cells: [_jfRu_(c.d), c.what, c.t, c.room, c.agent, c.who].map(function (v) { return { v: v }; }) };
  });
}
/** J48 — «помещение × месяцы», строки «План» и «Факт» из журнала генеральных уборок (J10). */
function _jfJ48_(from) {
  var y = from.slice(0, 4), recs = _jfBaseRows_('J10', y + '-01-01', y + '-12-31'), rows = {}, order = [];
  recs.forEach(function (rec) {
    var room = _jfFmt_(rec.v['Помещение/зона']) || '—', pf = /план/i.test(String(rec.v['План/Факт'] || '')) ? 'План' : /факт|выполн/i.test(String(rec.v['План/Факт'] || '')) ? 'Факт' : '';
    if (!pf) return;
    if (!rows[room]) { rows[room] = { 'План': [], 'Факт': [] }; for (var m = 0; m < 12; m++) { rows[room]['План'].push([]); rows[room]['Факт'].push([]); } order.push(room); }
    rows[room][pf][+rec.d.slice(5, 7) - 1].push(rec.d.slice(8, 10));
  });
  var out = [];
  order.forEach(function (room) { ['План', 'Факт'].forEach(function (pf) { out.push({ d: from, cells: [{ v: pf === 'План' ? room : '' }, { v: pf }].concat(rows[room][pf].map(function (x) { return { v: x.join(', ') }; })) }); }); });
  return { rows: out, cols: ['Помещение', ''].concat(['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']), notes: ['График и учёт генеральных уборок в ' + y + ' г. В клетке — числа месяца.'] };
}
/** J45 — медкнижки (медицинские данные — только с правом «медкнижки»). */
function _jfJ45_(s) {
  if (s && !_mcRbHasExact_(s, 'medical_view')) return { rows: [], notes: ['Форма содержит медицинские данные — доступна с правом «Медкнижки: просмотр».'] };
  var items = []; try { items = _medList_(); } catch (e) {}
  return { rows: items.map(function (x, i) { return { d: '', dev: /просроч|нет/i.test(String(x.status || '')), cells: [String(i + 1), x.name, x.position, x.number || '',
    [x.exam, x.examNext].filter(Boolean).join(' / '), [x.att, x.attNext].filter(Boolean).join(' / '), x.notes || ''].map(function (v) { return { v: _jfFmt_(v) }; }) }; }),
    notes: ['В клетке: дата прохождения / срок действия. Исследования по специалистам вносятся в медкнижку; в системе хранятся даты медосмотра и аттестации.'] };
}
/** J51 — работа бактерицидных установок: только отметки человека (начисление «по регламенту» не выдаётся за работу). */
function _jfJ51_(from, to) {
  return _jfBaseRows_('J37', from, to).map(function (rec) {
    var on = _jfFmt_(rec.v['Время включения']), off = _jfFmt_(rec.v['Время выключения']), a = _hm2min_(on), b = _hm2min_(off), sched = _jfLampAuto_(rec);
    var dur = sched ? 'начислено по регламенту — не подтверждено' : (a !== null && b !== null ? String((b - a + 1440) % 1440) : '');
    return { d: rec.d, t: on, dev: sched, cells: [_jfFmt_(rec.v['Наименование лампы / расположение']), _jfRu_(rec.d), sched ? '' : on, sched ? '' : off, dur,
      [_jfFmt_(rec.v['Срок службы лампы (час)']), _jfFmt_(rec.v['Остаток до замены (час)'])].filter(Boolean).join(' / '), _jfFmt_(rec.v['ФИО ответственного']) || _jfAuthorFio_(rec)].map(function (v) { return { v: v }; }) };
  });
}
/** J53 — план обучения: обучение из «Персонал → Обучение» (назначено ≠ пройдено). */
function _jfJ53_(from, to) {
  var v = []; try { v = _trainingSheet_().getDataRange().getValues().slice(1); } catch (e) {}
  var today = Utilities.formatDate(new Date(), _jfTz_(), 'yyyy-MM-dd');
  return v.filter(function (r) { return r[0]; }).map(function (r, i) {
    var d = _jfIso_(r[5]), till = _jfIso_(r[6]);
    return { d: d, dev: !!till && till < today, cells: [String(i + 1), _jfFmt_(r[2]), _jfFmt_(r[1]), _jfFmt_(r[4]) || _jfFmt_(r[3]), _jfFmt_(r[3]), _jfRu_(d), _jfRu_(till), till && till < today ? 'просрочено' : d ? 'пройдено' : 'запланировано'].map(function (x) { return { v: x }; }) };
  });
}

/* ---------- новые данные: J49 санитарный день, J50 потребность в дезсредствах, J52 выдача СИЗ ---------- */
var MC_JF_SANDAY_SHEET_ = 'Санитарный_день', MC_JF_SANDAY_HEAD_ = ['ID', 'Дата проведения', '№ п/п', 'Действие', 'Отметка времени', 'Выполнено', 'Комментарий', 'Сотрудник', 'Внесено', 'OperationID'];
var MC_JF_DSNEED_SHEET_ = 'Дезсредства_Потребность', MC_JF_DSNEED_HEAD_ = ['ID', 'Объект', 'Площадь, м2', 'Вид обработки (Т/Г)', 'Кратность в месяц', 'Средство', 'Концентрация, %', 'Расход раствора, л/м2', 'Активно', 'Кто', 'Обновлено'];
var MC_JF_PPE_SHEET_ = 'Выдача_СИЗ', MC_JF_PPE_HEAD_ = ['ID', 'Дата выдачи', 'Масок на неделю', 'Пар обуви на неделю', 'Получил (должность, ФИО)', 'Выдал', 'Внесено', 'OperationID'];

function mcSanitaryDaySave(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'sanitation|checklists', 'SANITARY_DAY_SAVE', 'Санитария', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), date = _jfIso_(d.date || '') || Utilities.formatDate(new Date(), _jfTz_(), 'yyyy-MM-dd');
    var items = (d.items || []).filter(function (x) { return x && x.n; });
    if (!items.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Отметьте выполненные пункты санитарного дня', op.id); }
    if (date > Utilities.formatDate(new Date(), _jfTz_(), 'yyyy-MM-dd')) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Дата санитарного дня позже сегодняшней', op.id); }
    var known = {}; MC_JF_SANDAY_.forEach(function (x) { if (/\./.test(x[0])) known[x[0]] = x[1]; });   // «1. ПИЩЕВАЯ ЗОНА» — раздел, не действие
    var bad = items.filter(function (x) { return !known[String(x.n)] || (x.time && _hm2min_(x.time) === null); });
    if (bad.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Неизвестный пункт или время: ' + bad.map(function (x) { return x.n; }).join(', '), op.id); }
    return _withLock_(function () {
      var sh = _bcSheet_(MC_JF_SANDAY_SHEET_, MC_JF_SANDAY_HEAD_), who = (op.session && (op.session.fullName || op.session.name)) || '';
      items.forEach(function (x) { sh.appendRow(['SD-' + Date.now() + '-' + Utilities.getUuid().slice(0, 6), _jfRu_(date), String(x.n), known[String(x.n)], x.time || '', x.done === false ? 'нет' : 'да', String(x.comment || ''), who, new Date(), op.id]); });
      _audit_(op, 'SANITARY_DAY_SAVE', 'Санитария', date, null, { пунктов: items.length });
      _endOp_(op);
      return _ok_({ date: date, items: items.length }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function mcDisinfectantNeedSave(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'sanitation', 'DS_NEED_SAVE', 'Санитария', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), num = function (x) { var n = Number(String(x === undefined ? '' : x).replace(',', '.')); return String(x === undefined ? '' : x).trim() !== '' && isFinite(n) && n >= 0 ? n : null; };
    var area = num(d.area), freq = num(d.freq), conc = num(d.conc), cons = num(d.cons);
    if (!String(d.object || '').trim() || !String(d.agent || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите объект и дезинфицирующее средство', op.id); }
    if (area === null || freq === null || conc === null || cons === null) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Площадь, кратность, концентрация и расход — числа (по инструкции к средству)', op.id); }
    if (['Т', 'Г'].indexOf(String(d.kind || '')) < 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Вид обработки: Т (текущая) или Г (генеральная)', op.id); }
    return _withLock_(function () {
      var sh = _bcSheet_(MC_JF_DSNEED_SHEET_, MC_JF_DSNEED_HEAD_), v = sh.getDataRange().getValues(), row = -1, id = d.id || 'DN-' + Date.now();
      for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) { row = i + 1; break; }
      var vals = [id, String(d.object).trim(), area, d.kind, freq, String(d.agent).trim(), conc, cons, d.active === false ? false : true, (op.session && (op.session.fullName || op.session.name)) || '', new Date()];
      if (row > 0) sh.getRange(row, 1, 1, vals.length).setValues([vals]); else sh.appendRow(vals);
      _audit_(op, 'DS_NEED_SAVE', 'Санитария', id, null, { объект: vals[1], средство: vals[5] });
      _endOp_(op);
      return _ok_({ id: id }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function mcPpeIssueSave(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'personnel|haccp', 'PPE_ISSUE', 'Персонал', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), date = _jfIso_(d.date || '') || Utilities.formatDate(new Date(), _jfTz_(), 'yyyy-MM-dd');
    var masks = Number(d.masks || 0), shoes = Number(d.shoes || 0);
    if (!String(d.receiver || '').trim()) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Кому выдано: должность и ФИО', op.id); }
    if (!(masks >= 0 && shoes >= 0) || masks + shoes <= 0 || masks % 1 || shoes % 1) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Количество — целые числа, хотя бы одно больше нуля', op.id); }
    if (date > Utilities.formatDate(new Date(), _jfTz_(), 'yyyy-MM-dd')) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Дата выдачи позже сегодняшней', op.id); }
    return _withLock_(function () {
      var id = 'PPE-' + Date.now(), who = (op.session && (op.session.fullName || op.session.name)) || '';
      _bcSheet_(MC_JF_PPE_SHEET_, MC_JF_PPE_HEAD_).appendRow([id, _jfRu_(date), masks, shoes, String(d.receiver).trim(), who, new Date(), op.id]);
      _audit_(op, 'PPE_ISSUE', 'Персонал', id, null, { кому: String(d.receiver).trim(), маски: masks, обувь: shoes });
      _endOp_(op);
      return _ok_({ id: id }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _jfSheetRows_(name, head) { var sh = _book_().getSheetByName(name); return sh && sh.getLastRow() > 1 ? sh.getDataRange().getValues().slice(1).filter(function (r) { return r[0]; }) : []; }
function _jfJ49_(from, to) {
  return _jfSheetRows_(MC_JF_SANDAY_SHEET_).filter(function (r) { var d = _jfIso_(r[1]); return d >= from && d <= to; }).map(function (r) {
    return { d: _jfIso_(r[1]), t: _jfFmt_(r[4]), dev: r[5] === 'нет', cells: [_jfFmt_(r[1]), _jfFmt_(r[2]), _jfFmt_(r[3]), r[5] === 'нет' ? 'не выполнено' + (r[6] ? ': ' + r[6] : '') : _jfFmt_(r[4]), _jfFmt_(r[7])].map(function (v) { return { v: v }; }) };
  });
}
function _jfJ50_() {
  var r2 = function (x) { return Math.round(x * 1000) / 1000; };
  return _jfSheetRows_(MC_JF_DSNEED_SHEET_).filter(function (r) { return r[8] !== false; }).map(function (r) {
    var vol = r2(Number(r[2]) * Number(r[7])), one = r2(vol * Number(r[6]) / 100), month = r2(one * Number(r[4]));
    return { d: '', cells: [{ v: _jfFmt_(r[1]) }, { v: _jfFmt_(r[2]) }, { v: _jfFmt_(r[3]) }, { v: _jfFmt_(r[4]) }, { v: _jfFmt_(r[5]) }, { v: _jfFmt_(r[6]) }, { v: _jfFmt_(r[7]) },
      { v: String(vol), m: 'Р' }, { v: String(one), m: 'Р' }, { v: String(month), m: 'Р' }, { v: String(r2(month * 12)), m: 'Р' }] };
  });
}
function _jfJ52_(from, to) {
  return _jfSheetRows_(MC_JF_PPE_SHEET_).filter(function (r) { var d = _jfIso_(r[1]); return d >= from && d <= to; }).map(function (r) {
    return { d: _jfIso_(r[1]), cells: [_jfFmt_(r[1]), _jfFmt_(r[2]), _jfFmt_(r[3]), _jfFmt_(r[4]), _jfFmt_(r[5])].map(function (v) { return { v: v }; }) };
  });
}

/* ---------- шапка, сборка формы, API ---------- */
/** Название предприятия: из утверждённого ППК (свойство MC_ORG_NAME заполняется при утверждении); пока нет — прочерк для бланка. */
function _jfOrg_() {
  var n = ''; try { n = String(PropertiesService.getScriptProperties().getProperty('MC_ORG_NAME') || ''); } catch (e) {}
  return n || 'ООО «______________»';
}
/** Собрать форму: { id, title, purpose, fill, org, cols, rows, notes, legend, period, counts }. */
function _jfBuild_(id, from, to, s, q) {
  var sp = MC_JF_SPEC_[id]; if (!sp) throw new Error('NOT_FOUND: форма ' + id + ' не найдена');
  q = q || {};
  var res = { rows: [], cols: sp.c.slice(), notes: [] }, map = MC_JF_MAP_[id];
  if (map) res.rows = _jfTableRows_(id, sp, map, from, to, s);
  else if (id === 'J34') res.rows = _jfJ34_(from, to);
  else if (id === 'J42') res = _jfJ42_(from, s);
  else if (id === 'J44') res = _jfJ44_(from, s);
  else if (id === 'J46') res = _jfJ46_(from);
  else if (id === 'J47') res.rows = _jfJ47_(from, to);
  else if (id === 'J48') res = _jfJ48_(from);
  else if (id === 'J45') { var r45 = _jfJ45_(s); res.rows = r45.rows; res.notes = r45.notes; }
  else if (id === 'J49') res.rows = _jfJ49_(from, to);
  else if (id === 'J50') res.rows = _jfJ50_();
  else if (id === 'J51') res.rows = _jfJ51_(from, to);
  else if (id === 'J52') res.rows = _jfJ52_(from, to);
  else if (id === 'J53') res.rows = _jfJ53_(from, to);
  res.notes = res.notes || [];
  var na = _mcJournalNA_()[id];
  if (na) res.notes.unshift('Не применяется на предприятии: ' + na.reason + ' (отметил ' + na.who + ', ' + na.date + '; пересмотр до ' + na.review + ')');
  if (id === 'J43') res.notes = _jfTempObjects_('J04').filter(function (o) { return o.status === 'ACTIVE'; }).map(function (o) {
    return 'Нормы: ' + o.name + ' — Т ' + _tNormText_(o.setpoint, o.min, o.max, '°C') + (o.hMin !== null || o.hMax !== null ? '; ВВ ' + _tNormText_(o.hSet, o.hMin, o.hMax, '%') : '') + '; контроль ' + _tTimes_(o).join(', ');
  });
  // место для подписи на бумаге в каждой строке (ответ 3)
  var grid = sp.k === 'grid' || sp.k === 'year';
  if (!grid && !res.cols.some(function (c) { return /подпис|подтвержд/i.test(c); })) { res.cols.push('Подпись'); res.rows.forEach(function (r) { if (!r.foot) r.cells.push({ v: '' }); }); }
  // фильтры
  var txt = function (r) { return r.cells.map(function (c) { return c.v; }).join(' ').toLowerCase(); };
  if (q.object) res.rows = res.rows.filter(function (r) { return txt(r).indexOf(String(q.object).toLowerCase()) >= 0; });
  if (q.who) res.rows = res.rows.filter(function (r) { return txt(r).indexOf(String(q.who).toLowerCase()) >= 0; });
  if (q.mark) res.rows = res.rows.filter(function (r) { return r.cells.some(function (c) { return c.m === q.mark; }); });
  if (q.status === 'nd') res.rows = res.rows.filter(function (r) { return r.nd; });
  if (q.status === 'dev') res.rows = res.rows.filter(function (r) { return r.dev; });
  if (q.status === 'late') res.rows = res.rows.filter(function (r) { return r.late; });
  if (q.status === 'corr') res.rows = res.rows.filter(function (r) { return r.corrected; });
  var dated = res.rows.filter(function (r) { return r.d && !r.foot; }).map(function (r) { return r.d; }).sort();
  return { id: id, notApplicable: na || null, title: sp.t, name: sp.n, purpose: sp.p, fill: sp.f, overlaps: sp.o, kind: sp.k, org: _jfOrg_(), cols: res.cols, widths: sp.w || [], rows: res.rows, notes: res.notes,
    legend: MC_JF_MARKS_, rule: MC_JF_RULE_, period: { from: from, to: to }, started: dated[0] ? _jfRu_(dated[0]) : '', ended: dated.length ? _jfRu_(dated[dated.length - 1]) : '',
    counts: { rows: res.rows.filter(function (r) { return !r.foot; }).length, nd: res.rows.filter(function (r) { return r.nd; }).length, dev: res.rows.filter(function (r) { return r.dev; }).length,
      late: res.rows.filter(function (r) { return r.late; }).length, corrected: res.rows.filter(function (r) { return r.corrected; }).length } };
}
function mcJournalForms(token) {
  try {
    _requireAuth_(token, 'journals|haccp_view|audit_view');
    var na = _mcJournalNA_();
    return _ok_({ forms: Object.keys(MC_JF_SPEC_).sort().map(function (k) { var sp = MC_JF_SPEC_[k], m = MC_JF_MAP_[k];
      return { id: k, title: sp.t, name: sp.n, purpose: sp.p, fill: sp.f, overlaps: sp.o, kind: sp.k, base: m ? m.b : '', newData: ['J49', 'J50', 'J52'].indexOf(k) >= 0, notApplicable: na[k] || null }; }),
      sanday: MC_JF_SANDAY_, legend: MC_JF_MARKS_ });
  } catch (e) { return _failFrom_(e); }
}
function mcJournalForm(json, token) {
  try {
    var s = _requireAuth_(token, 'journals|haccp_view|audit_view'), d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {});
    var now = Utilities.formatDate(new Date(), _jfTz_(), 'yyyy-MM-dd'), from = _jfIso_(d.from) || now.slice(0, 8) + '01', to = _jfIso_(d.to) || now;
    if (from > to) return _fail_('VALIDATION', 'Начало периода позже конца');
    return _ok_(_jfBuild_(String(d.id || ''), from, to, s, d));
  } catch (e) { return _failFrom_(e); }
}

/* =====================================================================================
 * GOOGLE ДИСК (этап 10.8): журналы в оформлении бланков предприятия.
 *  • текущий месяц — «MON CHEF — Журналы / 2026 / 10 Октябрь 2026», обновляется каждую ночь и кнопкой;
 *  • в последний день месяца — архив «MON CHEF — Архив / Сентябрь 2026 г / 01 Журналы» (Google-таблица + PDF);
 *  • рабочие записи в таблице MON CHEF не удаляются никогда; срок хранения архива — 3 года (в манифесте).
 * ===================================================================================== */
var MC_JF_DRIVE_ROOT_ = 'MON CHEF — Журналы', MC_JF_RETAIN_YEARS_ = 3;
var MC_JF_MONTHS_CAP_ = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

/** План листа: значения, объединения и стили — по бланку (строки 1–2 шапка, 4 назначение, 6 название, 8 колонки, с 9 записи). */
function _jfLayout_(f) {
  var sp = MC_JF_SPEC_[f.id] || {}, T = Math.max(f.cols.length, 4), vals = [], merges = [], st = [], heights = {}, widths = [];
  var put = function (r, c, v) { while (vals.length < r) vals.push([]); vals[r - 1][c - 1] = v; };
  var sty = function (r, c, nr, nc, o) { o.r = r; o.c = c; o.nr = nr; o.nc = nc; st.push(o); };
  put(1, 1, f.org); merges.push([1, 1, 2, 2]); sty(1, 1, 2, 2, { size: 11, bold: true, h: 'center', wrap: true, border: true });
  put(1, 3, 'СИСТЕМА ХАССП'); merges.push([1, 3, 1, T - 3]); sty(1, 3, 1, T - 3, { size: 11, bold: true, h: 'center', border: true });
  put(2, 3, f.title); merges.push([2, 3, 1, T - 3]); sty(2, 3, 1, T - 3, { size: 10, bold: true, h: 'center', wrap: true, border: true });
  put(1, T, 'Начат: ' + (f.started || '__________') + '\nОкончен: ' + (f.ended || '__________') + '\nСтр. — внизу листа'); merges.push([1, T, 2, 1]); sty(1, T, 2, 1, { size: 9, h: 'center', wrap: true, border: true });
  put(4, 1, f.id + '  |  Назначение: ' + (f.purpose || '—') + '  |  Тип заполнения: ' + (f.fill || '—')); merges.push([4, 1, 1, T]); sty(4, 1, 1, T, { size: 9, bg: sp.f4 || '#DDEBF7', wrap: true, border: true });
  put(6, 1, f.title); merges.push([6, 1, 1, T]); sty(6, 1, 1, T, { size: 12, bold: true, h: 'center', wrap: true });
  heights[1] = 26; heights[2] = 34; heights[4] = 32; heights[6] = 30; heights[8] = 58;
  var r = 7;
  (f.notes || []).forEach(function (n) { put(r, 1, n); merges.push([r, 1, 1, T]); sty(r, 1, 1, T, { size: 9, wrap: true }); r++; });
  var H = Math.max(8, r + 1);
  if (H > 8) { heights[H] = 58; delete heights[8]; }
  f.cols.forEach(function (c, i) { put(H, i + 1, c); });
  sty(H, 1, 1, f.cols.length, { size: 9, bold: true, bg: '#D9E1F2', h: 'center', wrap: true, border: true });
  var first = H + 1;
  f.rows.forEach(function (row, k) {
    row.cells.forEach(function (c, i) { put(first + k, i + 1, String(c.v === undefined ? '' : c.v) + (c.m ? ' ' + c.m : '')); });
    var long = row.cells.some(function (c) { return String(c.v || '').length > 38; });
    if (!long) heights[first + k] = 27;
    if (row.nd) sty(first + k, 1, 1, f.cols.length, { bg: '#FDECEA' }); else if (row.foot) sty(first + k, 1, 1, f.cols.length, { bg: '#F3F3F3', bold: true });
  });
  if (!f.rows.length) { put(first, 1, 'Записей за период нет'); merges.push([first, 1, 1, f.cols.length]); heights[first] = 27; }
  var last = first + Math.max(f.rows.length, 1) - 1;
  sty(first, 1, last - first + 1, f.cols.length, { size: 9, wrap: true, border: true, text: true });
  var e = last + 2;
  put(e, 1, f.rule); merges.push([e, 1, 1, T]); sty(e, 1, 1, T, { size: 8, color: '#555555', wrap: true }); heights[e] = 34;
  put(e + 1, 1, 'Метки источника: ' + Object.keys(f.legend).map(function (k) { return k + ' — ' + f.legend[k]; }).join('; ') + '. «Внесено позже»: время замера / время внесения.');
  merges.push([e + 1, 1, 1, T]); sty(e + 1, 1, 1, T, { size: 8, color: '#555555', wrap: true });
  put(e + 3, 1, 'Ответственный за ХАССП: ______________________ / подпись ____________ / дата ____________'); merges.push([e + 3, 1, 1, T]); sty(e + 3, 1, 1, T, { size: 9 });
  for (var w = 0; w < T; w++) widths.push(Math.round(((sp.w || [])[w] || (sp.k === 'grid' && w > 2 ? 4.5 : 18)) * 7 + 5));
  vals = vals.map(function (row) { var out = []; for (var i = 0; i < T; i++) out.push(row[i] === undefined ? '' : row[i]); return out; });
  return { T: T, vals: vals, merges: merges, styles: st, heights: heights, widths: widths, header: H };
}
function _jfApplyLayout_(sh, L) {
  sh.clear();
  try { sh.getRange(1, 1, Math.max(sh.getMaxRows(), 1), Math.max(sh.getMaxColumns(), 1)).breakApart(); } catch (e) {}
  sh.getRange(1, 1, L.vals.length, L.T).setNumberFormat('@').setValues(L.vals).setFontFamily('Arial').setFontSize(9).setVerticalAlignment('middle');
  L.merges.forEach(function (m) { if (m[2] * m[3] > 1) sh.getRange(m[0], m[1], m[2], m[3]).merge(); });
  L.styles.forEach(function (o) {
    var g = sh.getRange(o.r, o.c, o.nr, o.nc);
    if (o.size) g.setFontSize(o.size); if (o.bold) g.setFontWeight('bold'); if (o.bg) g.setBackground(o.bg); if (o.color) g.setFontColor(o.color);
    if (o.h) g.setHorizontalAlignment(o.h); if (o.wrap) g.setWrap(true); if (o.border) g.setBorder(true, true, true, true, true, true, '#444444', SpreadsheetApp.BorderStyle ? SpreadsheetApp.BorderStyle.SOLID : null);
  });
  L.widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  Object.keys(L.heights).forEach(function (r) { sh.setRowHeight(Number(r), Math.round(L.heights[r] * 4 / 3)); });
  sh.setFrozenRows(L.header);   // шапка таблицы повторяется на каждой странице PDF (fzr=true)
  try { sh.setHiddenGridlines(true); } catch (e) {}
}
function _jfFolder_(parent, name) { var it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function _jfDriveRoot_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('MC_JF_DRIVE_ROOT_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(MC_JF_DRIVE_ROOT_), f = it.hasNext() ? it.next() : DriveApp.createFolder(MC_JF_DRIVE_ROOT_);
  p.setProperty('MC_JF_DRIVE_ROOT_ID', f.getId());
  return f;
}
function _jfMonthLabel_(iso) { return iso.slice(5, 7) + ' ' + MC_JF_MONTHS_CAP_[+iso.slice(5, 7) - 1] + ' ' + iso.slice(0, 4); }
function _jfFileName_(f, iso) { return _mcV8SafeFileName_(f.id + ' ' + (f.name || f.title) + ' — ' + MC_JF_MONTHS_[+iso.slice(5, 7) - 1] + ' ' + iso.slice(0, 4)); }
/** Записать форму в Google-таблицу (та же таблица перезаписывается) и PDF той же формы. */
function _jfWriteToFolder_(f, folder, name) {
  var it = folder.getFilesByName(name), ss = null, file = null;
  while (it.hasNext()) { var x = it.next(); try { if (!ss && /spreadsheet/.test(String(x.getMimeType ? x.getMimeType() : 'spreadsheet'))) { ss = SpreadsheetApp.openById(x.getId()); file = x; } } catch (e) {} }
  if (!ss) { ss = SpreadsheetApp.create(name); file = DriveApp.getFileById(ss.getId()); try { file.moveTo(folder); } catch (e) { folder.addFile(file); try { DriveApp.getRootFolder().removeFile(file); } catch (e2) {} } }
  var sh = ss.getSheets()[0]; try { sh.setName(f.id); } catch (e) {}
  _jfApplyLayout_(sh, _jfLayout_(f));
  SpreadsheetApp.flush();
  var pdfId = '', pdfErr = '';
  try {
    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&gid=' + sh.getSheetId() +
      '&size=A4&portrait=false&fitw=true&top_margin=0.4&bottom_margin=0.4&left_margin=0.25&right_margin=0.25&gridlines=false&fzr=true&sheetnames=false&printtitle=false&pagenum=CENTER&horizontal_alignment=CENTER';
    var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var old = folder.getFilesByName(name + '.pdf'); while (old.hasNext()) { try { old.next().setTrashed(true); } catch (e) {} }
      pdfId = folder.createFile(resp.getBlob().setName(name + '.pdf')).getId();
    } else pdfErr = 'PDF: код ' + resp.getResponseCode();
  } catch (e) { pdfErr = 'PDF: ' + e; }
  return { id: f.id, name: name, sheetId: ss.getId(), url: ss.getUrl ? ss.getUrl() : '', pdfId: pdfId, pdfError: pdfErr, rows: f.counts.rows };
}
/**
 * Выгрузить формы месяца в папку. opts: { ids, iso (любой день месяца), folder, final, skipEmpty, budgetMs }.
 * Возвращает { files, skipped, left } — left: формы, на которые не хватило времени (дописываются следующим запуском).
 */
function _jfExportMonth_(opts) {
  var t0 = Date.now(), R = _jfMonthRange_(opts.iso), to = opts.final ? R.to : (R.to < Utilities.formatDate(new Date(), _jfTz_(), 'yyyy-MM-dd') ? R.to : Utilities.formatDate(new Date(), _jfTz_(), 'yyyy-MM-dd'));
  var ids = (opts.ids && opts.ids.length ? opts.ids : Object.keys(MC_JF_SPEC_).sort()), res = { files: [], skipped: [], left: [], errors: [] };
  for (var i = 0; i < ids.length; i++) {
    if (opts.budgetMs && Date.now() - t0 > opts.budgetMs) { res.left = ids.slice(i); break; }
    try {
      if (_mcJournalNA_()[ids[i]]) { res.skipped.push(ids[i] + ' (не применяется)'); continue; }
      var f = _jfBuild_(ids[i], R.from, to, null, {});
      if (opts.skipEmpty && !f.counts.rows) { res.skipped.push(ids[i]); continue; }
      var name = _jfFileName_(f, R.from);
      if (opts.final && opts.folder.getFilesByName(name + '.pdf').hasNext()) { res.skipped.push(ids[i] + ' (уже в архиве)'); continue; }
      res.files.push(_jfWriteToFolder_(f, opts.folder, name));
    } catch (e) { res.errors.push({ id: ids[i], error: String(e) }); }
  }
  return res;
}
/** Кнопка «Сформировать на Диске»: выбранные формы текущего (или указанного) месяца. */
function mcJournalsToDrive(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'audit_view', 'JOURNALS_TO_DRIVE', 'Журналы', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), iso = _jfIso_(d.from) || Utilities.formatDate(new Date(), _jfTz_(), 'yyyy-MM-dd');
    var ids = (d.ids || []).filter(function (x) { return MC_JF_SPEC_[x]; });
    if (!ids.length) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Выберите форму', op.id); }
    var folder = _jfFolder_(_jfFolder_(_jfDriveRoot_(), iso.slice(0, 4)), _jfMonthLabel_(iso));
    var r = _jfExportMonth_({ ids: ids, iso: iso, folder: folder, budgetMs: 240000 });
    _audit_(op, 'JOURNALS_TO_DRIVE', 'Журналы', ids.join(','), null, { месяц: iso.slice(0, 7), файлов: r.files.length, ошибок: r.errors.length });
    _endOp_(op, r.errors.length && !r.files.length ? 'FAILED' : 'COMPLETED');
    if (r.errors.length && !r.files.length) return _fail_('INTERNAL', r.errors.map(function (x) { return x.id + ': ' + x.error; }).join('; '), op.id);
    return _ok_({ folder: folder.getName(), folderUrl: folder.getUrl(), files: r.files, errors: r.errors }, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Ночное обновление текущего месяца на Диске (по расписанию). Пустые формы не создаются; не уложилось — продолжит следующий запуск. */
function refreshJournalsOnDrive() {
  var p = PropertiesService.getScriptProperties(), iso = Utilities.formatDate(new Date(), _jfTz_(), 'yyyy-MM-dd');
  var left = []; try { left = JSON.parse(p.getProperty('MC_JF_DRIVE_LEFT') || '[]'); } catch (e) {}
  var folder = _jfFolder_(_jfFolder_(_jfDriveRoot_(), iso.slice(0, 4)), _jfMonthLabel_(iso));
  var r = _jfExportMonth_({ ids: left.length ? left : null, iso: iso, folder: folder, skipEmpty: true, budgetMs: 270000 });
  p.setProperty('MC_JF_DRIVE_LEFT', JSON.stringify(r.left));
  p.setProperty('MC_JF_DRIVE_LAST', JSON.stringify({ at: new Date().toISOString(), files: r.files.length, left: r.left.length, errors: r.errors.length }));
  return JSON.stringify({ ok: true, files: r.files.length, skipped: r.skipped.length, left: r.left.length, errors: r.errors });
}
/** Дата, до которой архив хранится (по закону — 3 года). */
function _jfRetainUntil_(iso) { var y = +iso.slice(0, 4) + MC_JF_RETAIN_YEARS_, m = iso.slice(5, 7); return _jfRu_(y + '-' + m + '-' + ('0' + new Date(y, +m, 0).getDate()).slice(-2)); }

/* =====================================================================================
 * «НЕ ПРИМЕНЯЕТСЯ» (этап 10.8): журнал, который предприятию не нужен (витаминизация, фритюр, продажи без кассы),
 * отмечается ответственным за ХАССП с причиной. Проверки по нему не ставятся, на Диск он не выгружается,
 * в списке форм — со статусом. Раз в год — напоминание пересмотреть решение.
 * ===================================================================================== */
var MC_JNA_SHEET_ = 'Журналы_Неприменимые', MC_JNA_HEAD_ = ['Журнал', 'Причина', 'Кто', 'Дата', 'Пересмотр до', 'Активно'];
function _mcJournalNA_() {
  var out = {}; _jfSheetRows_(MC_JNA_SHEET_).forEach(function (r) { if (r[5] !== false && String(r[5]) !== 'нет') out[String(r[0])] = { reason: String(r[1]), who: String(r[2]), date: _jfFmt_(r[3]), review: _jfFmt_(r[4]) }; });
  return out;
}
function mcJournalNotApplicable(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp', 'JOURNAL_NOT_APPLICABLE', 'Журналы', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), id = String(d.id || ''), on = d.on !== false, reason = String(d.reason || '').trim();
    if (!MC_JF_SPEC_[id]) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Журнал не найден', op.id); }
    if (on && !reason) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Укажите причину: почему журнал не применяется на предприятии', op.id); }
    if (on && ['J01', 'J02', 'J03', 'J07', 'J21', 'J22', 'J23', 'J24', 'J25', 'J34'].indexOf(id) >= 0) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Журнал ' + id + ' обязателен для кухни с ККТ — «не применяется» к нему не ставится', op.id); }
    return _withLock_(function () {
      var sh = _bcSheet_(MC_JNA_SHEET_, MC_JNA_HEAD_), v = sh.getDataRange().getValues(), who = (op.session && (op.session.fullName || op.session.name)) || '', now = new Date();
      for (var i = v.length - 1; i >= 1; i--) if (String(v[i][0]) === id && v[i][5] !== false) sh.getRange(i + 1, 6).setValue(false);
      if (on) sh.appendRow([id, reason, who, now, new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()), true]);
      _audit_(op, on ? 'JOURNAL_NOT_APPLICABLE' : 'JOURNAL_APPLICABLE', 'Журналы', id, null, { причина: reason });
      _endOp_(op);
      return _ok_({ id: id, notApplicable: on, reason: reason }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* =====================================================================================
 * J33 ВЕРИФИКАЦИЯ (этап 10.8): раз в месяц система делает выборку — до 10 случайных записей каждого журнала ККТ
 * за прошлый месяц. Результат и вывод вносит ответственный за ХАССП; выборка без результата — «НЕ ВЫПОЛНЕНО».
 * ===================================================================================== */
var MC_J33_CCP_ = { 'ККТ-1 входной контроль (J21)': 'J03', 'ККТ-2 тепловая обработка (J22)': 'J22', 'ККТ-3 охлаждение (J23)': 'J23', 'ККТ-4 разогрев (J24)': 'J24' };
function _mcVerificationSample_(iso, op) {
  var R = _jfMonthRange_(iso), j = _mcJById_('J33'), sh = _book_().getSheetByName(j.sheetName) || _createJournalSheet_(j), made = 0, now = new Date();
  var have = sh.getDataRange().getValues().slice(1).map(function (r) { return String(r[2] || ''); }).join('\n');
  Object.keys(MC_J33_CCP_).forEach(function (label) {
    var obj = label + ' — выборка за ' + MC_JF_MONTHS_[R.m - 1] + ' ' + R.y;
    if (have.indexOf(obj) >= 0) return;                       // выборка месяца уже сделана
    var rows = _jfBaseRows_(MC_J33_CCP_[label], R.from, R.to).map(function (x) { return x.row; });
    for (var k = rows.length - 1; k > 0; k--) { var q = Math.floor(Math.random() * (k + 1)), t = rows[k]; rows[k] = rows[q]; rows[q] = t; }
    var pick = rows.slice(0, 10).sort(function (a, b) { return a - b; });
    var vals = { 'Дата': Utilities.formatDate(now, _mcTz_(), 'dd.MM.yyyy'), 'Объект проверки': obj + (pick.length ? ': строки ' + pick.join(', ') : ': записей нет') };
    _mcJournalAppendTo_(sh, op, 'выборка системы', j.columns.map(function (c) { return c === '№' ? sh.getLastRow() : (vals[c] !== undefined ? vals[c] : ''); }));
    made++;
  });
  return made;
}
/** Ежемесячно (1-го числа): выборка для верификации за прошлый месяц. */
function autoVerificationSample() {
  var now = new Date(), prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return _mcVerificationSample_(Utilities.formatDate(prev, _mcTz_(), 'yyyy-MM-dd'), null);
}
/** Результат верификации по строке J33: результат, несоответствия, корректирующее действие — вносит человек. */
function mcVerificationResult(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp', 'J33_RESULT', 'Журналы', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), res = String(d.result || '').trim();
    if (!res) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Внесите результат проверки — система вывод не делает', op.id); }
    return _withLock_(function () {
      var j = _mcJById_('J33'), sh = _book_().getSheetByName(j.sheetName), row = Number(d.row);
      if (!sh || !(row > 1) || row > sh.getLastRow()) { _endOp_(op, 'FAILED'); return _fail_('NOT_FOUND', 'Строка верификации не найдена', op.id); }
      var cur = sh.getRange(row, 1, 1, j.columns.length).getValues()[0];
      if (String(cur[j.columns.indexOf('Результат')] || '')) { _endOp_(op, 'FAILED'); return _fail_('VALIDATION', 'Результат уже внесён — исправление через «Исправления журналов»', op.id); }
      _mcAssertJournalPeriodOpen_('J33', cur[j.columns.indexOf('Дата')]);
      var who = (op.session && (op.session.fullName || op.session.name)) || '', set = function (c, v) { var k = j.columns.indexOf(c); if (k >= 0) cur[k] = v; };
      set('Результат', res); set('Отклонения', String(d.deviations || '').trim()); set('Корректирующие действия', String(d.actions || '').trim()); set('ФИО', who);
      sh.getRange(row, 1, 1, j.columns.length).setValues([cur]);
      _audit_(op, 'J33_RESULT', 'Журналы', 'J33 стр. ' + row, null, { результат: res });
      _endOp_(op);
      return _ok_({ row: row }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function mcVerificationSampleNow(json, token) {
  var op = null;
  try { op = _beginOp_(token, 'haccp', 'J33_SAMPLE', 'Журналы', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), iso = _jfIso_(d.month) || Utilities.formatDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), _mcTz_(), 'yyyy-MM-dd');
    var n = _withLock_(function () { return _mcVerificationSample_(iso, op); });
    _endOp_(op);
    return _ok_({ created: n, month: iso.slice(0, 7) }, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* =====================================================================================
 * ЧЕК-ЛИСТЫ СМЕНЫ (этап 10.8, ответ 8): вход сотрудника ничем не блокируется. После первого входа кухни за день
 * формируется задача — чек-лист открытия смены (J11); к концу смены — чек-лист закрытия (J12). Каждый пункт —
 * адресная проверка «да/нет». Пункты ХАССП — критические: «нет» открывает критическое отклонение. Остальное не блокирует.
 * Пункты — лист «Чеклисты_Смены» (заполняется из стандартного списка, правится ответственным за ХАССП).
 * ===================================================================================== */
var MC_SCL_SHEET_ = 'Чеклисты_Смены', MC_SCL_HEAD_ = ['ID', 'Тип (открытие/закрытие)', 'Пункт', 'ХАССП (да/нет)', 'Активно', 'Обновлено'];
function _mcShiftChecklistItems_(kind) {
  var sh = _bcSheet_(MC_SCL_SHEET_, MC_SCL_HEAD_);
  if (sh.getLastRow() < 2 && typeof CLEANING_CHECKLISTS !== 'undefined') {
    var seed = [];
    // температуры холодильников спрашиваются по каждому объекту («Холодильник №5: +2 °C?») — в чек-лист не дублируем
    (CLEANING_CHECKLISTS.open || []).filter(function (x) { return !/t°\s*в холодильник/i.test(x); }).forEach(function (x, i) { seed.push(['SCL-O' + (i + 1), 'открытие', x, /грызун|насеком|дез\.|дезинф/i.test(x) ? 'да' : 'нет', true, new Date()]); });
    (CLEANING_CHECKLISTS.close || []).forEach(function (x, i) { seed.push(['SCL-C' + (i + 1), 'закрытие', x, 'нет', true, new Date()]); });
    if (seed.length) sh.getRange(2, 1, seed.length, MC_SCL_HEAD_.length).setValues(seed);
  }
  return _jfSheetRows_(MC_SCL_SHEET_).filter(function (r) { return String(r[1]) === kind && r[4] !== false && String(r[4]) !== 'нет'; })
    .map(function (r) { return { id: String(r[0]), text: String(r[2]), haccp: String(r[3]) === 'да' || r[3] === true }; });
}
/** Создать чек-лист смены на сегодня (один раз в день). kind: 'открытие' | 'закрытие'. */
function _mcShiftChecklist_(kind, op) {
  var jid = kind === 'открытие' ? 'J11' : 'J12', j = _mcJById_(jid), today = Utilities.formatDate(new Date(), _mcTz_(), 'dd.MM.yyyy');
  var sh = _book_().getSheetByName(j.sheetName);
  if (sh && sh.getLastRow() > 1) {
    var dc = j.columns.indexOf('Дата'), n = j.columns.length, v = sh.getDataRange().getDisplayValues();
    for (var i = v.length - 1; i >= 1; i--) if (String(v[i][dc]) === today && /автозаполнение/.test(String(v[i][n + 3] || ''))) return { created: 0, already: true };
  }
  var items = _mcShiftChecklistItems_(kind), hm = Utilities.formatDate(new Date(), _mcTz_(), 'HH:mm'), tcol = j.columns.filter(function (c) { return /^Время/.test(c); })[0];
  items.forEach(function (it) {
    var filled = { 'Дата': today, 'Пункт чек-листа': it.text }; filled[tcol] = hm;
    _autoJournalRow_(jid, filled, [{ колонка: 'Статус (✓/✗)', вопрос: (kind === 'открытие' ? 'Открытие смены: ' : 'Закрытие смены: ') + it.text + (it.haccp ? ' (ХАССП)' : '') + ' — выполнено?',
      режим: 'да_нет', критическая: it.haccp, срок_минут: kind === 'открытие' ? 60 : 90 }], op, it.text);
  });
  return { created: items.length, kind: kind };
}
/** После входа сотрудника кухни — чек-лист открытия смены, если его сегодня ещё нет. Ошибки входу не мешают. */
function _mcShiftChecklistOnLogin_(session, op) {
  if (!session || session.dev || !_mcRbHasExact_(session, 'checklists|journals')) return null;
  var sh = _shift_(), now = _hm2min_(Utilities.formatDate(new Date(), _mcTz_(), 'HH:mm')), s0 = _hm2min_(sh.start), e0 = _hm2min_(sh.end);
  if (now === null || s0 === null || e0 === null || now < s0 - 120 || now >= e0) return null;
  return _withLock_(function () { return _mcShiftChecklist_('открытие', op && op.id ? op : { id: '', session: session }); });
}
/** По расписанию: за 60 минут до конца смены — чек-лист закрытия. */
function mcShiftClosingTick() {
  var sh = _shift_(), now = _hm2min_(Utilities.formatDate(new Date(), _mcTz_(), 'HH:mm')), e0 = _hm2min_(sh.end);
  if (now === null || e0 === null || now < e0 - 60) return JSON.stringify({ ok: true, skipped: 'рано' });
  return JSON.stringify({ ok: true, result: _mcShiftChecklist_('закрытие', null) });
}
