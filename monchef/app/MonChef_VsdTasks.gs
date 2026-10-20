/**
 * MON CHEF — приёмка поварами и гашение ВСД ответственным за ХАССП (этап 10.7, ТЗ §12, §14–§16).
 *
 * Порядок: повар (шеф, су-шеф) принимает товар и проводит входной контроль → если все проверки повара пройдены,
 * а ВСД ещё не погашен (или его нет), партия остаётся в карантине «ждёт гашения ВСД» — без отклонения ХАССП →
 * ответственному за ХАССП — уведомление «Непогашенная накладная» (одно на накладную) → ХАССП получает, сопоставляет
 * и гасит ВСД → партия допускается сама (входной контроль повара + гашение) → уведомление «Выполнено».
 * Отклонённый ВСД закрывает уведомление статусом «Закрыто: ВСД отклонена» — не «Выполнено».
 * Уведомление вручную не закрывается (MC_RB_STICKY_). Не погашено до конца следующего рабочего дня — уведомление
 * директору и письмо на почту владельца таблицы (MC_NOTIFY_EMAIL, по умолчанию — аккаунт, от имени которого работает скрипт).
 *
 * Статусы ВСД по ТЗ §16 (+2 технических, без которых обрыв связи мог бы привести к двойному гашению): MC_VT_ST_.
 */
var MC_VT_ST_ = { NOT_FOUND: 'Не найдена', FOUND: 'Новая', CHECKING: 'Новая', VALID: 'Принята', CONFLICT: 'Ожидает гашения — расхождение',
  READY_TO_CANCEL: 'Ожидает гашения', SENDING: 'Гашение выполняется', UNKNOWN: 'Результат уточняется', CANCELLED: 'Погашена', REJECTED: 'Отклонена', ERROR: 'Ошибка' };
var MC_VT_TYPE_ = 'vsd_unpaid', MC_VT_OVERDUE_ = 'vsd_overdue';

/** Статус ВСД словами ТЗ; привязанный к приёмке и ещё не погашенный — «Ожидает гашения». */
function _vtStatusRu_(rec) {
  if (!rec) return MC_VT_ST_.NOT_FOUND;
  var st = String(rec.status || rec.VSDStatus || 'FOUND');
  if ((st === 'VALID' || st === 'FOUND' || st === 'CHECKING') && rec.batches && rec.batches.length) return MC_VT_ST_.READY_TO_CANCEL;
  return MC_VT_ST_[st] || st;
}
function _vtKey_(supplier, docNo) { return 'vsdinv|' + String(supplier || '').trim() + '|' + String(docNo || '').trim(); }
function _vtFmt_(d) { return d instanceof Date && !isNaN(d.getTime()) ? Utilities.formatDate(d, _mcTz_(), 'dd.MM.yyyy HH:mm') : ''; }

/** Партии накладной, по которым нужен ВСД (подконтрольный продукт или привязан ВСД), и состояние ВСД по каждой. */
function _vtInvoice_(supplier, docNo) {
  var sh = _mcRcvSheet_(), v = sh.getDataRange().getValues(), C = MC_RCV_C_, items = [], recv = null, who = '';
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!r[0]) continue;
    if (String(r[C['Поставщик']] || '').trim() !== String(supplier || '').trim() || String(r[C['Накладная']] || '').trim() !== String(docNo || '').trim()) continue;
    if (r[C['ParentBatchID']]) continue;                     // п/ф и части партии — ВСД у исходной
    var bid = String(r[0]), b = _bcFind_(bid), pid = b ? String(b.v[17] || '') : '', name = String(r[C['Продукт']] || '');
    var controlled = false; try { controlled = _sdVetOn_() && _sdVetControlled_(pid, name); } catch (e) {}
    var vs = _mvRows_().filter(function (x) { return x.batches.indexOf(bid) >= 0; }), rec = vs.filter(function (x) { return x.status !== 'REJECTED'; })[0] || vs[0] || null;
    if (!controlled && !rec) continue;
    var state = !rec ? 'MISSING' : rec.status === 'CANCELLED' ? 'CANCELLED' : rec.status === 'REJECTED' ? 'REJECTED' : 'PENDING';
    var at = r[C['Принято']] instanceof Date ? r[C['Принято']] : null; if (at && (!recv || at < recv)) { recv = at; who = String(r[C['Принял']] || ''); }
    items.push({ batchId: bid, product: name, qty: r[C['Кол-во']], unit: r[C['Ед.']], vsd: rec ? rec['Номер ВСД'] : '', vsdId: rec ? rec.id : '', state: state,
      status: rec ? _vtStatusRu_(rec) : MC_VT_ST_.NOT_FOUND, receivedBy: String(r[C['Принял']] || ''), receivedAt: _vtFmt_(at), cancelledBy: rec ? String(rec['Погасил'] || '') : '',
      cancelledAt: rec && rec['Дата гашения'] instanceof Date ? _vtFmt_(rec['Дата гашения']) : '', batchStatus: b ? String(b.v[10] || '') : '' });
  }
  var open = items.filter(function (x) { return x.state === 'PENDING' || x.state === 'MISSING'; }).length, rejected = items.some(function (x) { return x.state === 'REJECTED'; });
  return { supplier: supplier, docNo: docNo, items: items, open: open, rejected: rejected, receivedAt: recv, receivedBy: who,
    deadline: recv ? _vtDeadline_(recv) : null, status: !items.length ? '' : open ? 'Ожидает гашения' : rejected ? 'Закрыто: ВСД отклонена' : 'Выполнено' };
}
/** Срок гашения: конец следующего рабочего дня после приёмки (MC_VSD_DEADLINE_HOURS — иначе, в часах). */
function _vtDeadline_(at) {
  var h = 0; try { h = parseFloat(PropertiesService.getScriptProperties().getProperty('MC_VSD_DEADLINE_HOURS') || '') || 0; } catch (e) {}
  if (h > 0) return new Date(at.getTime() + h * 3600000);
  var d = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 23, 59, 0);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}
/** Текст уведомления: поставщик, накладная, ВСД, дата, товар, количество, кто принял, когда, статус. */
function _vtText_(s) {
  var lines = s.items.map(function (x) { return '• ' + x.product + ' — ' + x.qty + ' ' + (x.unit || '') + ' · ВСД ' + (x.vsd || '—') + ': ' + x.status +
    (x.state === 'CANCELLED' && x.cancelledBy ? ' (' + x.cancelledBy + (x.cancelledAt ? ', ' + x.cancelledAt : '') + ')' : '') + ' · партия ' + x.batchId; });
  return 'Поставщик: ' + s.supplier + '\nНакладная: ' + s.docNo + '\nПринял: ' + (s.receivedBy || '—') + (s.receivedAt ? ', ' + _vtFmt_(s.receivedAt) : '') +
    (s.deadline && s.open ? '\nПогасить до: ' + _vtFmt_(s.deadline) : '') + '\nСтатус: ' + s.status + '\n' + lines.join('\n');
}
/** Создать или обновить уведомление «Непогашенная накладная» (одно на накладную, адресат — ответственный за ХАССП). */
function _vtRefresh_(supplier, docNo, op) {
  try {
    if (!supplier || !docNo) return null;
    var s = _vtInvoice_(supplier, docNo); if (!s.items.length) return null;
    var sh = _notificationsSheet_(), v = sh.getDataRange().getValues(), key = _vtKey_(supplier, docNo), row = 0;
    for (var i = v.length - 1; i >= 1; i--) if (String(v[i][1]) === key && String(v[i][2]) === MC_VT_TYPE_) { row = i + 1; break; }
    var title = (s.open ? 'Непогашенная накладная' : s.status) + ': ' + supplier + ', № ' + docNo, text = _vtText_(s);
    var status = s.open ? 'NEW' : s.rejected ? 'CLOSED' : 'DONE';
    if (row) {
      sh.getRange(row, 4, 1, 3).setValues([[s.open ? 'warning' : 'info', title, text]]);
      sh.getRange(row, 8).setValue(status);
      if (!s.open) sh.getRange(row, 11).setValue(new Date());
    } else if (s.open) {
      sh.appendRow(['NT' + Date.now() + Math.floor(Math.random() * 100), key, MC_VT_TYPE_, 'warning', title, text, 'Ответственный за ХАССП', 'NEW', (op && op.id) || '', new Date(), '']);
    }
    return s;
  } catch (e) { try { _log_('WARN', 'уведомление о ВСД не обновлено: ' + e); } catch (x) {} return null; }
}
/** Обновить уведомления по накладным этих партий (после гашения, отклонения, привязки ВСД). */
function _vtRefreshBatches_(batchIds, op) {
  var seen = {};
  (batchIds || []).forEach(function (bid) {
    try { var p = _mcBlPass_(bid); if (!p) return; var k = _vtKey_(p.v[MC_RCV_C_['Поставщик']], p.v[MC_RCV_C_['Накладная']]); if (seen[k]) return; seen[k] = 1;
      _vtRefresh_(p.v[MC_RCV_C_['Поставщик']], p.v[MC_RCV_C_['Накладная']], op); } catch (e) {}
  });
}
/** Причины входного контроля, которые относятся только к ВСД (их снимает гашение, а не повар). */
function _vtVetOnly_(reasons) { return reasons.length > 0 && reasons.every(function (x) { return /ВСД|REQUIRES_VET_DOCUMENT/.test(String(x)); }); }

/** После гашения: партии, у которых входной контроль повара пройден и ждали только ВСД, допускаются сами. */
function _vtReleaseHeld_(op, rec) {
  var out = [];
  (rec.batches || []).forEach(function (bid) {
    try {
      var b = _bcFind_(bid); if (!b || String(b.v[10]) !== 'quarantine') return;
      var ic = _bcSheet_(MC_BC_IN_, MC_BC_IN_HEAD_).getDataRange().getValues(), last = null;
      for (var i = ic.length - 1; i >= 1; i--) if (String(ic[i][1]) === String(bid)) { last = ic[i]; break; }
      if (!last || String(last[11]) !== 'HOLD_VSD') return;
      var other = []; try { other = _sdIncomingReasons_(b).filter(function (x) { return !/ВСД|REQUIRES_VET_DOCUMENT/.test(String(x)); }); } catch (e) {}
      if (other.length) return;                                         // кроме ВСД есть другие причины — решает человек
      _bcSetStatus_(b, 'active');
      var basis = 'входной контроль пройден (' + last[14] + ', ' + _vtFmt_(last[16]) + ') + ВСД ' + rec['Номер ВСД'] + ' погашен (' + (rec['Погасил'] || '') + ')';
      _bcRelease_(b, 'INCOMING', 'RELEASE', basis, { name: 'Система (правило: контроль + ВСД)', role: '' }, op && op.id, last[18] || '');
      _mcBlEvent_(op, bid, 'RELEASED_AFTER_VSD', { doc: rec.id, reason: basis });
      out.push(bid);
    } catch (e) {}
  });
  return out;
}

/** Список накладных с непогашенными / ненайденными ВСД для ответственного за ХАССП. */
function mcGetVsdUnpaid(json, token) {
  try {
    var s = _requireAuth_(token); if (!_mcRbHasExact_(s, 'mercury|vsd_cancel|vsd_view')) return _mcRbDenyJson_('Непогашенные накладные видит ответственный за ХАССП.');
    var d = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}), sh = _notificationsSheet_(), v = sh.getDataRange().getValues(), out = [], now = new Date();
    for (var i = v.length - 1; i >= 1; i--) {
      if (String(v[i][2]) !== MC_VT_TYPE_) continue;
      if (!d.all && String(v[i][7]) !== 'NEW') continue;
      var parts = String(v[i][1]).split('|'), inv = _vtInvoice_(parts[1], parts.slice(2).join('|'));
      out.push({ id: v[i][0], supplier: inv.supplier, docNo: inv.docNo, status: inv.status, receivedBy: inv.receivedBy, receivedAt: _vtFmt_(inv.receivedAt),
        deadline: _vtFmt_(inv.deadline), overdue: !!(inv.open && inv.deadline && now > inv.deadline), items: inv.items, created: _vtFmt_(v[i][9]) });
    }
    return _ok_({ invoices: out, canCancel: _mvCanCancel_(s), statuses: MC_VT_ST_ });
  } catch (e) { return _failFrom_(e); }
}

/** Расписание (каждые 30 мин): просроченное гашение → директору и письмом на почту владельца таблицы (один раз на накладную). */
function mcVsdOverdueWatchSystem() {
  try {
    var sh = _notificationsSheet_(), v = sh.getDataRange().getValues(), now = new Date(), props = PropertiesService.getScriptProperties();
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][2]) !== MC_VT_TYPE_ || String(v[i][7]) !== 'NEW') continue;
      var parts = String(v[i][1]).split('|'), inv = _vtInvoice_(parts[1], parts.slice(2).join('|'));
      if (!inv.open) { _vtRefresh_(inv.supplier, inv.docNo, null); continue; }
      if (!inv.deadline || now <= inv.deadline) continue;
      var flag = 'MC_VT_ESC_' + String(v[i][1]).replace(/^vsdinv\|/, '').replace(/[^0-9A-Za-zА-Яа-яЁё_-]+/g, '_').slice(0, 200);   // одна эскалация на накладную
      var flagKey = _mcPropHash_(flag.slice('MC_VT_ESC_'.length));   // отметка — в одном свойстве-словаре MC_VT_ESC (см. MonChef_Scheduler.gs)
      if (_mcPropMapGet_('MC_VT_ESC', flagKey) || props.getProperty(flag)) continue;
      var title = 'Просрочено гашение ВСД: ' + inv.supplier + ', № ' + inv.docNo, text = 'Срок гашения истёк ' + _vtFmt_(inv.deadline) + '. Партии остаются в карантине.\n' + _vtText_(inv);
      _notify_(MC_VT_OVERDUE_, 'critical', title, text, 'Директор', 'vsdesc|' + v[i][1], null);
      var to = ''; try { to = String(props.getProperty('MC_NOTIFY_EMAIL') || '') || Session.getEffectiveUser().getEmail(); } catch (e) {}
      var sent = false; if (to) try { MailApp.sendEmail(to, 'MON CHEF: ' + title, text); sent = true; } catch (e) {}
      _mcPropMapSet_('MC_VT_ESC', flagKey, String(now.getTime()));
      try { _audit_({ id: '', type: 'VSD_OVERDUE', tenant: _defaultTenant_(), session: null }, 'VSD_OVERDUE_ESCALATED', 'Накладная', inv.docNo, null, { supplier: inv.supplier, deadline: _vtFmt_(inv.deadline), email: sent ? to : '' }); } catch (e) {}
    }
  } catch (e) { try { _log_('WARN', 'проверка гашения ВСД: ' + e); } catch (x) {} }
}
