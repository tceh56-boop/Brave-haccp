// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — AiOrchestrator.gs
 * Секондарные фичи, раунд 7 (Архитектура v4 §5, §12 п.7) — "ЦЕХ AI", чат-мок.
 *
 * ЧЕСТНО, сразу: это НЕ вызов внешней LLM. Как и уже существующий AI.gs (rule-based
 * движок рекомендаций, ТЗ §22), это заранее заданный набор распознаваемых по подстроке
 * русских фраз → фиксированный "инструмент" → готовый форматированный ответ. Реального
 * понимания языка нет — только сопоставление образцов, ровно как архитектурный документ
 * §5 описывает мок-версию этого захода ("пользователь печатает вопрос из ограниченного
 * набора распознаваемых образцов"). У Дениса уже есть ключ Claude API, но он намеренно
 * НЕ используется здесь — подключение настоящего LLM это §12 п.8, отдельный заход, по
 * готовности (см. финальный отчёт этого раунда).
 *
 * КЛЮЧЕВОЕ АРХИТЕКТУРНОЕ РЕШЕНИЕ (закрывает ТЗ §9/§32 — "AI работает только через
 * разрешённые инструменты" / "не может обойти права" — одним и тем же способом, и
 * реализует Открытое решение C, уже принятое Денисом: AI действует ПРАВАМИ
 * СПРАШИВАЮЩЕГО ПОЛЬЗОВАТЕЛЯ, а не отдельной сервисной ролью):
 *
 * Ни один "инструмент" ниже НИ РАЗУ не читает и не пишет базу напрямую — findOne_/
 * findRows_/insertRow_/updateRow_ в этом файле не вызываются вовсе. Каждый инструмент —
 * это вызов processOperation(action, data, session.token), ТОГО ЖЕ шлюза (API.gs), которым
 * пользуется обычный фронтенд, с ТЕМ ЖЕ токеном сессии, что и у спросившего человека
 * (session.token доступен здесь — Auth.gs::_buildSession_ кладёт token прямо внутрь
 * объекта сессии, не только в ключ кэша, см. Auth.gs). Значит: RBAC (ACTION_MODULE/
 * userCanAccessModule_), проверка принадлежности объекта (assertOwnedByOrg_ и т.п. — уже
 * внутри вызываемых обработчиков), аудит (auditLog_) и идемпотентность — всё это
 * отрабатывает ТАК ЖЕ, как если бы человек нажал кнопку в интерфейсе сам. Отдельной
 * "AI-матрицы прав" нет и не нужно: если у роли нет доступа к модулю — AI получает тот
 * же FORBIDDEN, что получил бы человек, и честно передаёт это в ответе (см. паттерн
 * "if (!resp.ok) return {... reply: 'Не удалось ... ' + resp.error}" во всех intent-
 * функциях ниже), а не притворяется, что ничего не нашёл.
 *
 * Подтверждение критических операций (ТЗ §14 "подтверждение критических операций"):
 * без отдельной таблицы "ожидающих действий" — для мутирующих намерений (создание
 * задачи/заявки на закупку) распознавание СНАЧАЛА возвращает needsConfirmation:true с
 * предложенным действием и НЕ вызывает processOperation вовсе; реальный вызов происходит
 * только повторной отправкой ТОГО ЖЕ текста с data.confirm === true. Стейтлес — тот же
 * приём, что уже используют operationId (API.gs::claimOperation_) и подтверждение
 * автозаполнения журналов (Journals.gs::confirmAutoJournal_) — ничего нового
 * изобретать не пришлось.
 *
 * Схема из архитектурного документа §5, реализована буквально:
 *   Пользователь → AI Interface (чат) → processAiChatMessage_ (в моке — распознавание
 *     заранее заданных намерений по подстроке, без реального LLM) → Intent → Tool
 *     (= 1:1 существующее действие ACTION_HANDLERS) → processOperation(action, data,
 *     session.token) → результат → форматированный ответ.
 *
 * ВАЖНО про формат ответа processAiChatMessage_/AI_CHAT: чат-интерфейс не должен падать
 * с общей ошибкой на каждое нераспознанное или частично неудачное сообщение — поэтому
 * ВСЕ ветки ниже возвращают обычный успешный объект {intent, reply, ...}, а не бросают
 * исключение (кроме случаев, когда сама processOperation('AI_CHAT', ...) стандартно
 * отказывает ДО вызова обработчика — сессия/права, см. API.gs — это тот же путь отказа,
 * что и у любого другого действия, здесь ничего специально не меняется).
 */

// Примеры распознаваемых фраз — используются и в подсказке при нераспознанном сообщении,
// и как единственная "документация" мок-возможностей (ТЗ §5: "ограниченный набор
// распознаваемых образцов").
var AI_CHAT_EXAMPLES = [
  'что сегодня нарушено', 'какие задачи просрочены', 'какие есть рекомендации',
  'остатки сыра', 'создай задачу проверить холодильник', 'закажи сыр 10'
];

/**
 * Точка входа. messageText — то, что напечатал пользователь; confirm — true, если это
 * повторная отправка того же текста для подтверждения предложенной мутирующей операции;
 * session — уже разрешённая сессия (session.token обязателен для вызова вложенных
 * инструментов, см. докстринг файла выше).
 */
function processAiChatMessage_(messageText, confirm, session) {
  var text = String(messageText || '').trim();
  if (!text) {
    return { intent: 'EMPTY', reply: 'Сообщение пустое. Примеры того, что я понимаю: ' + AI_CHAT_EXAMPLES.join('; ') + '.' };
  }
  var lower = text.toLowerCase();

  if (lower.indexOf('наруш') !== -1) return _aiIntentDeviations_(session);
  if (lower.indexOf('просрочен') !== -1) return _aiIntentOverdueTasks_(session);
  if (lower.indexOf('рекоменд') !== -1) return _aiIntentRecommendations_(session);
  if (lower.indexOf('остат') !== -1) return _aiIntentStock_(text, lower, session);
  if (lower.indexOf('создай задачу') !== -1 || lower.indexOf('поставь задачу') !== -1) {
    return _aiIntentCreateTask_(text, session, !!confirm);
  }
  if (lower.indexOf('закажи') !== -1 || lower.indexOf('заявку на закупку') !== -1) {
    return _aiIntentCreatePurchaseRequest_(text, session, !!confirm);
  }

  return {
    intent: 'UNRECOGNIZED',
    reply: 'Пока не понимаю такой запрос — это мок без реального ИИ, распознаётся ограниченный набор фраз: ' + AI_CHAT_EXAMPLES.join('; ') + '.'
  };
}

/** "что сегодня нарушено" / "какие нарушения" — GET_DEVIATIONS + (по возможности) GET_JOURNAL_DEFINITIONS для названий. */
function _aiIntentDeviations_(session) {
  var devResp = processOperation('GET_DEVIATIONS', { onlyOpen: true }, session.token);
  if (!devResp.ok) return { intent: 'DEVIATIONS', reply: 'Не удалось получить нарушения: ' + devResp.error };
  var deviations = devResp.data || [];
  if (!deviations.length) return { intent: 'DEVIATIONS', reply: 'На сегодня открытых нарушений нет.', data: deviations };

  // Названия журналов — отдельным вызовом того же способа (GET_JOURNAL_DEFINITIONS), а
  // не прямым чтением JOURNAL_DEFINITIONS: если у роли нет модуля 'journal_admin' — просто
  // честно показываем definition_id как есть, без падения всего ответа целиком.
  var defsById = {};
  var defsResp = processOperation('GET_JOURNAL_DEFINITIONS', {}, session.token);
  if (defsResp.ok) {
    (defsResp.data || []).forEach(function (d) { defsById[d.definition_id] = d.название; });
  }

  var lines = deviations.map(function (d) {
    var name = defsById[d.definition_id] || ('журнал ' + d.definition_id);
    return '• ' + name + ': ' + d.уровень + ' (значение ' + d.значение + ', нарушен предел: ' + (d.предел_нарушен || '—') + ')';
  });
  return { intent: 'DEVIATIONS', reply: 'Открытых нарушений: ' + deviations.length + '.\n' + lines.join('\n'), data: deviations };
}

/** "какие задачи просрочены" — GET_TASKS(status: открыта), просрочку (due_at < сейчас) считаем в самом ответе форматирования, не в новом обработчике. */
function _aiIntentOverdueTasks_(session) {
  var tResp = processOperation('GET_TASKS', { status: 'открыта' }, session.token);
  if (!tResp.ok) return { intent: 'OVERDUE_TASKS', reply: 'Не удалось получить задачи: ' + tResp.error };
  var now = Date.now();
  var overdue = (tResp.data || []).filter(function (t) { return t.due_at && new Date(t.due_at).getTime() < now; });
  if (!overdue.length) return { intent: 'OVERDUE_TASKS', reply: 'Просроченных задач нет.', data: overdue };
  var lines = overdue.map(function (t) {
    return '• [' + t.type + '] ' + t.title + ' — срок был ' + t.due_at + (t.responsible_role ? ', ответственный: ' + t.responsible_role : '');
  });
  return { intent: 'OVERDUE_TASKS', reply: 'Просроченных задач: ' + overdue.length + '.\n' + lines.join('\n'), data: overdue };
}

/** "какие есть рекомендации" — напрямую переиспользует уже существующий AI.gs::getAiRecommendations_ через GET_AI_RECOMMENDATIONS, ничего не дублирует. */
function _aiIntentRecommendations_(session) {
  var rResp = processOperation('GET_AI_RECOMMENDATIONS', {}, session.token);
  if (!rResp.ok) return { intent: 'RECOMMENDATIONS', reply: 'Не удалось получить рекомендации: ' + rResp.error };
  var recs = rResp.data || [];
  if (!recs.length) return { intent: 'RECOMMENDATIONS', reply: 'Сейчас особых поводов для рекомендаций нет — всё в пределах нормы.', data: recs };
  return { intent: 'RECOMMENDATIONS', reply: recs.map(function (r) { return '• ' + r; }).join('\n'), data: recs };
}

/**
 * "остатки" / "остаток <товар>" — GET_WAREHOUSE, с опциональной фильтрацией по названию
 * товара из текста сообщения.
 *
 * ЧЕСТНО про "остатки химии" (буквальный пример из архитектурного документа §5): в
 * текущей схеме ПРОДУКТЫ/CATEGORIES нет ни одного поля, которое отличало бы "химию" от
 * любого другого товара (CATEGORIES.тип — свободный текст, никогда не заполняется никаким
 * реальным обработчиком, createCategory_ вообще не существует в проекте — проверено
 * аудитом перед этим раундом). Поэтому запрос "химии" НЕ фильтруется по несуществующему
 * признаку — вместо того чтобы молча (и неверно) додумать критерий по названию товара,
 * ответ прямо говорит, что такого признака нет, и показывает остатки по всем товарам
 * (или по названию, если оно распознано в тексте).
 */
function _aiIntentStock_(text, lower, session) {
  var wResp = processOperation('GET_WAREHOUSE', {}, session.token);
  if (!wResp.ok) return { intent: 'STOCK', reply: 'Не удалось получить остатки: ' + wResp.error };
  var items = wResp.data || [];

  var chemicalHint = lower.indexOf('хими') !== -1;
  var filterText = text.replace(/остат(?:ок|ки)/gi, '').replace(/хими[а-я]*/gi, '').trim();

  var filtered = items;
  if (filterText) {
    var needle = filterText.toLowerCase();
    filtered = items.filter(function (p) { return p.название.toLowerCase().indexOf(needle) !== -1; });
  }

  var note = chemicalHint
    ? 'В системе пока нет отдельного признака "химия" у товаров (CATEGORIES/PRODUCTS этим не размечаются) — показываю остатки по всем товарам' + (filterText ? ', отфильтрованным по названию из запроса' : '') + ', а не только по химии.\n'
    : '';

  if (!filtered.length) return { intent: 'STOCK', reply: note + 'Товары по запросу не найдены.', data: [] };

  var shown = filtered.slice(0, 20);
  var lines = shown.map(function (p) { return '• ' + p.название + ': ' + p.остаток + ' ' + p.единица; });
  var tail = filtered.length > shown.length ? ('\n… и ещё ' + (filtered.length - shown.length) + ' позиций.') : '';
  return { intent: 'STOCK', reply: note + 'Остатки (' + filtered.length + ' позиций):\n' + lines.join('\n') + tail, data: filtered };
}

/** "создай задачу <текст>" / "поставь задачу <текст>" — мутирующее намерение, требует подтверждения (см. докстринг файла). Тип задачи фиксирован как 'ai' (TASK_TYPES уже включает этот тип именно для этого случая, Tasks.gs), ответственный по умолчанию — сам спросивший. */
function _aiIntentCreateTask_(text, session, confirm) {
  var title = text.replace(/созда[йть]+\s+задачу/i, '').replace(/поставь\s+задачу/i, '').trim();
  if (!title) {
    return { intent: 'CREATE_TASK', reply: 'Не понял текст задачи. Пример: «создай задачу проверить холодильник в мясном цеху».' };
  }
  var proposedData = { type: 'ai', title: title, responsibleId: session.user_id };
  if (!confirm) {
    return {
      intent: 'CREATE_TASK', needsConfirmation: true,
      reply: 'Предлагаю создать задачу (тип "ai", ответственный — вы): «' + title + '». Чтобы подтвердить — отправьте это же сообщение ещё раз с подтверждением.',
      proposedAction: 'CREATE_TASK', proposedData: proposedData
    };
  }
  var cResp = processOperation('CREATE_TASK', proposedData, session.token);
  if (!cResp.ok) return { intent: 'CREATE_TASK', reply: 'Не удалось создать задачу: ' + cResp.error };
  return { intent: 'CREATE_TASK', reply: 'Задача создана: «' + title + '» (task_id ' + cResp.data.task_id + ').', data: cResp.data };
}

/**
 * "закажи <товар> <количество>" / "заявку на закупку <товар> <количество>" — мутирующее
 * намерение, требует подтверждения.
 *
 * P0-класс находка ЭТОГО раунда, найдена собственным тестом раунда (см. CHANGELOG):
 * количество НЕЛЬЗЯ искать как "первое число где угодно в тексте" — названия товаров
 * сами нередко содержат цифры (например "Масло-AI7"), и первое найденное число тогда
 * вырывается ИЗ СЕРЕДИНЫ названия товара, а не из реально указанного количества, ломая
 * и разбор количества, и остаток текста как название (тест "закажи Масло-AI7 7" находил
 * "7" внутри "AI7", а не хвостовую "7" — итог: то и не то число, и название не находится).
 * Количество ищется теперь ТОЛЬКО как отдельный, ЦЕЛИКОМ числовой, ПОСЛЕДНИЙ токен
 * сообщения (после пробельного разделения) — если последнее "слово" не число целиком,
 * значит количество не указано, и додумывать его не нужно.
 */
function _aiIntentCreatePurchaseRequest_(text, session, confirm) {
  var trigger = text.replace(/заявку\s+на\s+закупку/i, '').replace(/закажи/i, '').trim();
  var tokens = trigger.split(/\s+/).filter(Boolean);
  var qty = null;
  var nameTokens = tokens;
  if (tokens.length && /^\d+(?:[.,]\d+)?$/.test(tokens[tokens.length - 1])) {
    qty = Number(tokens[tokens.length - 1].replace(',', '.'));
    nameTokens = tokens.slice(0, -1);
  }
  var nameText = nameTokens.join(' ').trim();
  if (!nameText) {
    return { intent: 'CREATE_PURCHASE_REQUEST', reply: 'Не понял, какой товар. Пример: «закажи сыр 10».' };
  }
  if (qty === null) {
    return { intent: 'CREATE_PURCHASE_REQUEST', reply: 'Не понял количество — укажите его последним числом в сообщении. Пример: «закажи ' + nameText + ' 10».' };
  }

  var pResp = processOperation('GET_PRODUCTS', {}, session.token);
  if (!pResp.ok) return { intent: 'CREATE_PURCHASE_REQUEST', reply: 'Не удалось получить список товаров: ' + pResp.error };
  var needle = nameText.toLowerCase();
  var matches = (pResp.data || []).filter(function (p) { return p.название.toLowerCase().indexOf(needle) !== -1; });

  if (matches.length === 0) {
    return { intent: 'CREATE_PURCHASE_REQUEST', reply: 'Товар "' + nameText + '" не найден.' };
  }
  if (matches.length > 1) {
    return { intent: 'CREATE_PURCHASE_REQUEST', reply: 'Найдено несколько товаров по "' + nameText + '": ' + matches.map(function (p) { return p.название; }).join(', ') + '. Уточните название точнее.' };
  }

  var product = matches[0];
  var proposedData = { productId: product.product_id, qty: qty };
  if (!confirm) {
    return {
      intent: 'CREATE_PURCHASE_REQUEST', needsConfirmation: true,
      reply: 'Предлагаю создать заявку на закупку: «' + product.название + '», ' + qty + ' ' + product.единица + '. Чтобы подтвердить — отправьте это же сообщение ещё раз с подтверждением.',
      proposedAction: 'CREATE_PURCHASE_REQUEST', proposedData: proposedData
    };
  }
  var cResp = processOperation('CREATE_PURCHASE_REQUEST', proposedData, session.token);
  if (!cResp.ok) return { intent: 'CREATE_PURCHASE_REQUEST', reply: 'Не удалось создать заявку: ' + cResp.error };
  return { intent: 'CREATE_PURCHASE_REQUEST', reply: 'Заявка на закупку создана: «' + product.название + '», ' + qty + ' ' + product.единица + '.', data: cResp.data };
}
