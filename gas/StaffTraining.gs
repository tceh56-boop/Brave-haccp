// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — StaffTraining.gs (волна 3, M10): ознакомление с ТТК и аттестация по блюдам.
 *
 * Повар открывает утверждённую ТТК и подтверждает «Ознакомлен» — фиксируется версия.
 * Утвердили новую версию — прежнее ознакомление становится «устарело», поварам ставится
 * задача (тип briefing). Тест собирается на сервере из самой ТТК (состав, хранение,
 * срок реализации, выход) и вопросов шефа; правильные ответы клиенту не уходят.
 * Аттестован = ознакомлен с текущей версией и сдал тест по ней (не меньше 80 %).
 * Матрица «сотрудник × блюдо» — для шефа и проверяющего HACCP.
 */

var TRAINING_PASS_PCT_ = 80;
var TRAINING_ROLES_ = ['ПОВАР', 'ШЕФ-ПОВАР'];

function _trJson_(s, def) { try { return s ? JSON.parse(s) : def; } catch (e) { return def; } }

function _trDishes_(session) {
  return findRows_('DISHES', function (d) { return d.organization_id === session.organization_id && d.статус !== 'архив'; })
    .map(function (d) { return { dish: d, ttk: _ttkCurrent_(d.dish_id) }; })
    .filter(function (x) { return x.ttk; })
    .sort(function (a, b) { return String(a.dish.название).localeCompare(String(b.dish.название)); });
}

function _trAcks_(session, userId) {
  return findRows_('TTK_ACKS', function (a) { return a.organization_id === session.organization_id && (!userId || a.user_id === userId); });
}

function _trPassed_(session, userId) {
  return findRows_('TRAINING_ATTEMPTS', function (a) {
    return a.organization_id === session.organization_id && (!userId || a.user_id === userId) && a.результат === 'сдано';
  });
}

/** Статус сотрудника по блюду: не_ознакомлен | устарело | ознакомлен | аттестован. */
function _trStatus_(ttk, acks, passed) {
  var cur = acks.filter(function (a) { return a.ttk_version_id === ttk.ttk_version_id; })[0];
  if (!cur) return acks.length ? 'устарело' : 'не_ознакомлен';
  var ok = passed.some(function (p) { return p.ttk_version_id === ttk.ttk_version_id; });
  return ok ? 'аттестован' : 'ознакомлен';
}

function _trComposition_(ttk) {
  return _trJson_(ttk.recipe_snapshot_json, []).map(function (r) {
    var ing = String(r.product_id).indexOf('PF-') === 0 ? getSemiFinishedById_(r.product_id) : getProductById_(r.product_id);
    return { product_id: r.product_id, название: ing ? ing.название : r.product_id, брутто: Number(r.брутто) || 0, нетто: Number(r.нетто) || 0, единица: r.единица || '' };
  });
}

/** Мои блюда: что изучить и мой статус. */
function trainingGetMy_(session) {
  var acks = _trAcks_(session, session.user_id), passed = _trPassed_(session, session.user_id);
  var rows = _trDishes_(session).map(function (x) {
    var mine = acks.filter(function (a) { return a.dish_id === x.dish.dish_id; });
    return { dish_id: x.dish.dish_id, название: x.dish.название, version: Number(x.ttk.version) || 1, статус: _trStatus_(x.ttk, mine, passed) };
  });
  var order = { устарело: 0, не_ознакомлен: 1, ознакомлен: 2, аттестован: 3 };
  rows.sort(function (a, b) { return order[a.статус] - order[b.статус] || String(a.название).localeCompare(String(b.название)); });
  return { rows: rows, итого: rows.length, аттестован: rows.filter(function (r) { return r.статус === 'аттестован'; }).length };
}

/** Карточка ТТК для изучения (текущая утверждённая версия). */
function trainingGetCard_(data, session) {
  var dish = _ttkDish_(data.dishId, session);
  var ttk = _ttkCurrent_(dish.dish_id);
  if (!ttk) throw new Error('У блюда «' + dish.название + '» нет утверждённой ТТК.');
  var mine = _trAcks_(session, session.user_id).filter(function (a) { return a.dish_id === dish.dish_id; });
  return {
    dish_id: dish.dish_id, название: dish.название, выход: dish.выход, ttk_version_id: ttk.ttk_version_id, version: Number(ttk.version) || 1,
    технология: ttk.технология || '', этапы: _trJson_(ttk.технологические_этапы_json, []), условия_хранения: ttk.условия_хранения || '',
    срок_реализации: ttk.срок_реализации || '', аллергены: ttk.аллергенная_информация || '', показатели_качества: ttk.показатели_качества || '',
    состав: _trComposition_(ttk), статус: _trStatus_(ttk, mine, _trPassed_(session, session.user_id))
  };
}

function trainingAck_(data, session) {
  return withLock_(function () {
    var dish = _ttkDish_(data.dishId, session);
    var ttk = _ttkCurrent_(dish.dish_id);
    if (!ttk) throw new Error('У блюда «' + dish.название + '» нет утверждённой ТТК.');
    if (data.ttkVersionId && data.ttkVersionId !== ttk.ttk_version_id) throw new Error('ТТК обновилась — откройте карточку заново.');
    var have = _trAcks_(session, session.user_id).filter(function (a) { return a.ttk_version_id === ttk.ttk_version_id; })[0];
    if (have) return { ack_id: have.ack_id, version: Number(have.version), уже: true };
    var row = { ack_id: generateId_('TTK_ACKS'), organization_id: session.organization_id, location_id: session.location_id || '', user_id: session.user_id,
      dish_id: dish.dish_id, ttk_version_id: ttk.ttk_version_id, version: Number(ttk.version) || 1, подтверждено: nowIso_() };
    insertRow_('TTK_ACKS', row);
    auditLog_(session.user_id, 'Ознакомлен с ТТК', 'TTK_VERSIONS:' + ttk.ttk_version_id, null, 'v' + row.version, 'success', session.cascade_id || '');
    return { ack_id: row.ack_id, version: row.version, уже: false };
  });
}

// ---------- Тест ----------

function _trShuffle_(arr, seed) {
  var a = arr.slice(), s = seed;
  for (var i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; var j = Math.floor(s / 233280 * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

function _trUniq_(arr) { var seen = {}; return arr.filter(function (x) { x = String(x || '').trim(); if (!x || seen[x.toLowerCase()]) return false; seen[x.toLowerCase()] = true; return true; }); }

/** Вопрос с одним верным ответом и 2–3 неверными; без неверных вариантов вопрос не задаётся. */
function _trQuestion_(text, correct, wrong, seed) {
  wrong = _trUniq_(wrong).filter(function (w) { return w.toLowerCase() !== String(correct).trim().toLowerCase(); }).slice(0, 3);
  if (!correct || wrong.length < 2) return null;
  var options = _trShuffle_([String(correct).trim()].concat(wrong), seed);
  return { вопрос: text, варианты: options, верный: options.indexOf(String(correct).trim()) };
}

function _trBuildQuiz_(dish, ttk, session) {
  var others = _trDishes_(session).filter(function (x) { return x.dish.dish_id !== dish.dish_id; });
  var comp = _trComposition_(ttk), inDish = {};
  comp.forEach(function (c) { inDish[c.product_id] = true; });
  var seed = Date.now() % 233280, qs = [];
  if (comp.length) {
    var notIn = findRows_('PRODUCTS', function (p) { return p.organization_id === session.organization_id && !inDish[p.product_id]; }).map(function (p) { return p.название; });
    var pick = comp[seed % comp.length];
    qs.push(_trQuestion_('Что входит в состав блюда «' + dish.название + '»?', pick.название, _trShuffle_(notIn, seed + 1), seed + 2));
    var main = comp.slice().sort(function (a, b) { return b.брутто - a.брутто; })[0];
    var u = main.единица || '';
    var fmt = function (n) { return String(Math.round(n * 1000) / 1000).replace('.', ',') + ' ' + u; };
    var wrongQty = [main.брутто * 0.5, main.брутто * 1.5, main.брутто * 2].map(fmt);
    qs.push(_trQuestion_('Сколько брутто продукта «' + main.название + '» на одну порцию?', fmt(main.брутто), wrongQty, seed + 3));
  }
  qs.push(_trQuestion_('Условия хранения блюда «' + dish.название + '»?', ttk.условия_хранения, others.map(function (x) { return x.ttk.условия_хранения; }).concat(['+18..+25 °C', '−18 °C и ниже']), seed + 4));
  qs.push(_trQuestion_('Срок реализации блюда «' + dish.название + '»?', ttk.срок_реализации, others.map(function (x) { return x.ttk.срок_реализации; }).concat(['72 ч', '6 ч', '5 суток']), seed + 5));
  findRows_('TRAINING_QUESTIONS', function (q) { return q.organization_id === session.organization_id && q.dish_id === dish.dish_id && q.статус !== 'архив'; })
    .forEach(function (q, i) {
      var opts = _trJson_(q.варианты_json, []);
      qs.push(_trQuestion_(q.вопрос, opts[Number(q.верный)], opts.filter(function (o, k) { return k !== Number(q.верный); }), seed + 10 + i));
    });
  return qs.filter(Boolean);
}

function trainingStartQuiz_(data, session) {
  return withLock_(function () {
    var dish = _ttkDish_(data.dishId, session);
    var ttk = _ttkCurrent_(dish.dish_id);
    if (!ttk) throw new Error('У блюда «' + dish.название + '» нет утверждённой ТТК.');
    if (!_trAcks_(session, session.user_id).some(function (a) { return a.ttk_version_id === ttk.ttk_version_id; })) {
      throw new Error('Сначала ознакомьтесь с ТТК «' + dish.название + '».');
    }
    var qs = _trBuildQuiz_(dish, ttk, session);
    if (qs.length < 2) throw new Error('Для теста по «' + dish.название + '» мало данных: заполните в ТТК условия хранения и срок реализации или добавьте вопросы.');
    var row = { attempt_id: generateId_('TRAINING_ATTEMPTS'), organization_id: session.organization_id, location_id: session.location_id || '', user_id: session.user_id,
      dish_id: dish.dish_id, ttk_version_id: ttk.ttk_version_id, вопросы_json: JSON.stringify(qs), правильных: '', всего: qs.length, результат: 'начат', создано: nowIso_(), завершено: '' };
    insertRow_('TRAINING_ATTEMPTS', row);
    return { attempt_id: row.attempt_id, название: dish.название, вопросы: qs.map(function (q) { return { вопрос: q.вопрос, варианты: q.варианты }; }) };
  });
}

function trainingSubmitQuiz_(data, session) {
  return withLock_(function () {
    var a = findOne_('TRAINING_ATTEMPTS', 'attempt_id', data.attemptId);
    assertOwnedByOrg_(session, a, 'TRAINING_ATTEMPTS:' + data.attemptId);
    if (a.user_id !== session.user_id) throw new Error('Это тест другого сотрудника.');
    if (a.результат !== 'начат') throw new Error('Тест уже завершён — начните новый.');
    var qs = _trJson_(a.вопросы_json, []), answers = data.answers || [];
    if (!Array.isArray(answers) || answers.length !== qs.length) throw new Error('Ответьте на все вопросы.');
    var mistakes = [], right = 0;
    qs.forEach(function (q, i) {
      if (Number(answers[i]) === q.верный) right++;
      else mistakes.push({ вопрос: q.вопрос, верно: q.варианты[q.верный] });
    });
    var pct = Math.round(right / qs.length * 100), ok = pct >= TRAINING_PASS_PCT_;
    var current = _ttkCurrent_(a.dish_id);
    if (ok && (!current || current.ttk_version_id !== a.ttk_version_id)) ok = false; // пока сдавал, утвердили новую версию
    updateRow_('TRAINING_ATTEMPTS', a, { правильных: right, результат: ok ? 'сдано' : 'не сдано', завершено: nowIso_() });
    auditLog_(session.user_id, 'Аттестация по ТТК', 'DISHES:' + a.dish_id, null, right + '/' + qs.length, ok ? 'success' : 'failure', session.cascade_id || '');
    return { правильных: right, всего: qs.length, процент: pct, сдано: ok, порог: TRAINING_PASS_PCT_, ошибки: mistakes };
  });
}

// ---------- Шеф ----------

/** Матрица «сотрудник × блюдо» по точке. */
function trainingGetMatrix_(session) {
  var dishes = _trDishes_(session);
  var users = findRows_('USERS', function (u) {
    if (u.organization_id !== session.organization_id || u.статус !== 'активен' || TRAINING_ROLES_.indexOf(u.роль) === -1) return false;
    var locs = String(u.location_ids || '').split(',').map(function (s) { return s.trim(); });
    return !session.location_id || locs.indexOf(session.location_id) !== -1;
  });
  var acks = _trAcks_(session), passed = _trPassed_(session);
  var total = 0, done = 0;
  var rows = users.map(function (u) {
    var myAcks = acks.filter(function (a) { return a.user_id === u.user_id; }), myPass = passed.filter(function (p) { return p.user_id === u.user_id; });
    var cells = dishes.map(function (x) {
      var st = _trStatus_(x.ttk, myAcks.filter(function (a) { return a.dish_id === x.dish.dish_id; }), myPass);
      total++; if (st === 'аттестован') done++;
      return st;
    });
    return { user_id: u.user_id, имя: u.имя, роль: u.роль, статусы: cells, аттестован: cells.filter(function (c) { return c === 'аттестован'; }).length };
  }).sort(function (a, b) { return String(a.имя).localeCompare(String(b.имя)); });
  return { блюда: dishes.map(function (x) { return { dish_id: x.dish.dish_id, название: x.dish.название, version: Number(x.ttk.version) || 1 }; }),
    сотрудники: rows, покрытие_pct: total ? Math.round(done / total * 100) : 0 };
}

function trainingGetQuestions_(data, session) {
  _ttkDish_(data.dishId, session);
  return findRows_('TRAINING_QUESTIONS', function (q) { return q.organization_id === session.organization_id && q.dish_id === data.dishId && q.статус !== 'архив'; })
    .map(function (q) { return { question_id: q.question_id, вопрос: q.вопрос, варианты: _trJson_(q.варианты_json, []), верный: Number(q.верный) }; });
}

function trainingSaveQuestion_(data, session) {
  return withLock_(function () {
    if (data.questionId) {
      var q = findOne_('TRAINING_QUESTIONS', 'question_id', data.questionId);
      assertOwnedByOrg_(session, q, 'TRAINING_QUESTIONS:' + data.questionId);
      if (data.archive) { updateRow_('TRAINING_QUESTIONS', q, { статус: 'архив' }); return { question_id: q.question_id, статус: 'архив' }; }
    }
    var dish = _ttkDish_(data.dishId, session);
    var text = String(data.вопрос || '').trim();
    var opts = (data.варианты || []).map(function (o) { return String(o || '').trim(); }).filter(Boolean);
    var right = Number(data.верный);
    if (text.length < 5) throw new Error('Напишите вопрос (не короче 5 символов).');
    if (opts.length < 3 || _trUniq_(opts).length !== opts.length) throw new Error('Нужно минимум 3 разных варианта ответа.');
    if (!(right >= 0 && right < opts.length)) throw new Error('Отметьте верный вариант.');
    var row = { question_id: generateId_('TRAINING_QUESTIONS'), organization_id: session.organization_id, dish_id: dish.dish_id, вопрос: text.slice(0, 300),
      варианты_json: JSON.stringify(opts.map(function (o) { return o.slice(0, 120); })), верный: right, статус: 'активен', создано: nowIso_(), user_id: session.user_id };
    insertRow_('TRAINING_QUESTIONS', row);
    return { question_id: row.question_id };
  });
}

/** После утверждения новой версии ТТК — задача поварам ознакомиться (одна на версию). */
function trainingOnTtkApproved_(ttkVersionId, session) {
  var ttk = findOne_('TTK_VERSIONS', 'ttk_version_id', ttkVersionId);
  if (!ttk || ttk.status !== 'утверждена') return null;
  var dup = findRows_('TASKS', function (t) { return t.source_entity_id === ttkVersionId && t.type === 'briefing'; });
  if (dup.length) return null;
  var dish = findOne_('DISHES', 'dish_id', ttk.dish_id);
  return createTask_({ organizationId: session.organization_id, locationId: session.location_id || '', type: 'briefing',
    title: 'Ознакомиться с ТТК «' + (dish ? dish.название : ttk.dish_id) + '» v' + ttk.version,
    description: 'Утверждена новая версия ТТК. Откройте «Обучение по ТТК», изучите карточку, подтвердите ознакомление и пройдите тест.',
    responsibleRole: 'ПОВАР', priority: 'обычный', sourceEntityId: ttkVersionId, userId: session.user_id, session: session });
}
