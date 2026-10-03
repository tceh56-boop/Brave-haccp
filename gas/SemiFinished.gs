// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * ЦЕХ — SemiFinished.gs (v2, ТЗ §8/§9/§33)
 * Полуфабрикаты как полноценные объекты: сырьё → рецептура → потери → выход →
 * себестоимость → остаток → использование в блюдах. Себестоимость ПФ считается на
 * единицу ВЫХОДА, а не на весь замес — так её можно напрямую использовать как цену
 * ингредиента в рецепте блюда (см. getIngredientUnitPrice_ в Recipes.gs).
 *
 * v2: добавлены срок хранения/условия хранения на самом ПФ (утверждаются человеком —
 * см. _resolveShelfLife_ ниже) и автогенерация этикетки/QR/номера партии при выпуске
 * (см. Production.gs::_completeProduction_, который создаёт партию и здесь же вызывает
 * generateBatchLabel_).
 */

function createSemiFinished_(data) {
  if (!data.organization_id) throw new Error('createSemiFinished_: organization_id обязателен.');
  var pf = {
    pf_id: generateId_('SEMI_FINISHED'),
    organization_id: data.organization_id,
    workshop_id: data.workshop_id || '',
    название: data.название || '',
    выход: Number(data.выход) || 1,
    единица: data.единица || 'кг',
    потери_процент: Number(data.потери_процент) || 0,
    срок_хранения_часов: data.срок_хранения_часов ? Number(data.срок_хранения_часов) : '',
    условия_хранения: data.условия_хранения || '',
    себестоимость: 0,
    version: 1,
    обновлено: nowIso_()
  };
  insertRow_('SEMI_FINISHED', pf);
  return pf;
}

function getSemiFinishedById_(pfId) {
  return findOne_('SEMI_FINISHED', 'pf_id', pfId);
}

/**
 * Раунд 9 — восполнен пробел, найденный при аудите перед постройкой интерфейса «Рецепты/
 * Тех.карты»: `createSemiFinished_` (выше) не был подключён вообще ни к одному действию
 * `ACTION_HANDLERS`/`CONFIG.ACTION_MODULE` — то есть создать полуфабрикат через API было
 * невозможно в принципе (только напрямую в таблице). Без списка ПФ и без возможности его
 * создать `ADD_RECIPE_LINE`/`CREATE_PRODUCTION_TASK` с `parentType:'PF'` были нерабочими для
 * клиента. Оба пробела закрыты вместе (см. API.gs::CREATE_SEMI_FINISHED/GET_SEMI_FINISHED).
 */
function getSemiFinishedList_(organizationId) {
  return findRows_('SEMI_FINISHED', function (p) { return p.organization_id === organizationId; });
}

/** Пересчёт: полная стоимость замеса / выход = себестоимость единицы ПФ. */
function recalcSemiFinishedCost_(pfId) {
  var pf = getSemiFinishedById_(pfId);
  if (!pf) return null;
  var batchCost = calcRecipeCost_('PF', pfId);
  var unitCost = pf.выход > 0 ? batchCost / pf.выход : batchCost;
  updateRow_('SEMI_FINISHED', pf, { себестоимость: round2_(unitCost), обновлено: nowIso_() });
  return unitCost;
}

/**
 * ГЛАВНОЕ ПРАВИЛО ТЗ §33: система НИКОГДА не придумывает срок годности. Если на самом
 * полуфабрикате (утверждённая карточка) срок не настроен — возвращается null и понятное
 * сообщение; вызывающий код (Production.gs) обязан сохранить партию БЕЗ срока и явно
 * пометить её как требующую подтверждения ответственного лица, а не тихо поставить
 * какое-то число "на всякий случай".
 */
function _resolveShelfLife_(pf) {
  if (!pf || !pf.срок_хранения_часов) {
    return { срок_годности: '', требует_подтверждения: true, сообщение: 'Срок использования не настроен. Требуется подтверждение ответственного лица.' };
  }
  var expires = new Date(Date.now() + Number(pf.срок_хранения_часов) * 3600000).toISOString();
  return { срок_годности: expires, требует_подтверждения: false, сообщение: '' };
}

/** Человек (ответственный) подтверждает/устанавливает срок годности УЖЕ выпущенной партии, если системе было нечего подставить. */
function confirmBatchShelfLife_(batchId, expiryIso, userId, session) {
  return withLock_(function () { // P0.2 (ТЗ §18) — мутация партии
    var batch = findOne_('BATCHES', 'batch_id', batchId);
    if (session) assertOwnedByLocation_(session, batch, 'BATCHES:' + batchId); // ТЗ P0.1
    else if (!batch) throw new Error('Партия не найдена: ' + batchId);
    if (!expiryIso) throw new Error('Укажите фактический срок годности — система не подставляет его сама.');
    updateRow_('BATCHES', batch, { срок_годности: expiryIso, ответственный_id: userId || batch.ответственный_id });
    auditLog_(userId, 'Подтверждён срок годности партии', 'BATCHES:' + batchId, '', expiryIso, 'success', session ? session.cascade_id : '');
    return { batch_id: batchId, срок_годности: expiryIso };
  });
}

/** Человекочитаемый номер партии: ДДММГГ + короткий суффикс от batch_id (уникальность по batch_id уже гарантирована). */
function generateBatchNumber_(batchId, dateObj) {
  var d = dateObj || new Date();
  var datePart = Utilities.formatDate(d, Session.getScriptTimeZone() || 'Etc/UTC', 'yyMMdd');
  var suffix = String(batchId).replace(/[^A-Za-z0-9]/g, '').slice(-5).toUpperCase();
  return datePart + '-' + suffix;
}

/**
 * Данные для печати этикетки + QR (ТЗ §33). QR кодирует batch_id — сканирование должно
 * открывать GET_BATCH_BY_QR и вести на полную историю партии, а не просто показывать текст.
 */
function generateBatchLabel_(batchId, session) {
  var batch = findOne_('BATCHES', 'batch_id', batchId);
  if (session) assertOwnedByLocation_(session, batch, 'BATCHES:' + batchId); // ТЗ P0.1
  else if (!batch) throw new Error('Партия не найдена: ' + batchId);
  var isPf = String(batch.product_id).indexOf('PF-') === 0;
  var parent = isPf ? getSemiFinishedById_(batch.product_id) : getProductById_(batch.product_id);
  var workshop = batch.workshop_id ? findOne_('WORKSHOPS', 'workshop_id', batch.workshop_id) : null;
  var markingRows = typeof findRows_==='function' ? findRows_('MARKINGS', function(m){ return m.batch_id === batch.batch_id && m.status !== 'REVOKED'; }) : [];
  var marking = markingRows[0] || null;
  return {
    batch_id: batch.batch_id,
    партия_номер: batch.партия_номер || generateBatchNumber_(batch.batch_id),
    название: parent ? parent.название : batch.product_id,
    количество: batch.количество,
    единица: parent ? (parent.единица || '') : '',
    дата_изготовления: batch.дата_производства || batch.дата_прихода,
    дата_прихода: batch.дата_прихода,
    срок_годности: batch.срок_годности || '',
    срок_не_настроен: !batch.срок_годности,
    условия_хранения: isPf && parent ? parent.условия_хранения || '' : '',
    цех: workshop ? workshop.название : '',
    ответственный_id: batch.ответственный_id || '',
    qr_payload: batch.batch_id,
    marking_id: marking ? marking.marking_id : '',
    marking_code: marking ? marking.code : '',
    marking_type: marking ? marking.marking_type : (batch.marking_type || 'PRODUCT_BATCH'),
    source_batch_id: batch.source_batch_id || ''
  };
}

/**
 * Сканирование QR (ТЗ §33 п. "полная история по коду") — QR несёт просто batch_id.
 * ТЗ P0.1: партия физически может быть отсканирована кем угодно (это QR на этикетке),
 * но её ПОЛНАЯ история движений (WAREHOUSE_OPS) — внутренние данные организации, поэтому
 * сессия обязательна и партия чужой точки не показывается, даже если QR как-то оказался
 * доступен (например, на упаковке, унесённой с чужого склада).
 */
function getBatchByQr_(qrPayload, session) {
  var batch = findOne_('BATCHES', 'batch_id', qrPayload);
  if (session) assertOwnedByLocation_(session, batch, 'BATCHES:' + qrPayload);
  else if (!batch) throw new Error('Партия с таким кодом не найдена.');
  var label = generateBatchLabel_(batch.batch_id);
  var history = findRows_('WAREHOUSE_OPS', function (op) { return op.batch_id === batch.batch_id; })
    .sort(function (a, b) { return new Date(a.дата) - new Date(b.дата); });
  return {
    этикетка: label,
    остаток: round2_(getBatchRemaining_(batch)),
    история_движений: history
  };
}

function round2_(n) {
  return Math.round(Number(n) * 100) / 100;
}
