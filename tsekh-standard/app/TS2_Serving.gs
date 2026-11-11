/**
 * ЦЕХ Стандарт 2.1 — раздача и кейтеринг по СанПиН 2.3/2.4.4282-26.
 *   п. 32 — готовые блюда, требующие разогрева, не более 3 часов на раздаче с момента изготовления;
 *   п. 54 — комплектование контейнеров для кейтеринга не ранее чем за 3 часа до начала мероприятия;
 *   п. 55 — изотермические ёмкости с ярлыком (предприятие и адрес, дата и час изготовления, время окончания раздачи,
 *           наименование, ФИО ответственного); горячие блюда в изотермических ёмкостях — не более 3 часов, включая перевозку.
 * Выдача банкета (issueV28Banquet) создаёт задачи на контроль этих сроков; ярлыки печатаются из карточки банкета.
 * Время изготовления берётся только из факта производства; если его нет — на ярлыке поле для ручной записи.
 */
var TS2_SERVE_HOURS_ = 3, TS2_SANPIN_REF_ = 'СанПиН 2.3/2.4.4282-26';

function _ts2Event_(id) { try { return (JSON.parse(getEvents()) || []).filter(function (e) { return String(e.id) === String(id); })[0] || null; } catch (e) { return null; } }
function _ts2IsCatering_(e) { return !!e && (e.catering === true || e.catering === 'true' || /выезд|кейтеринг|catering|доставк/i.test([e.format, e.place, e.comment, e.name].join(' '))); }
/** Начало мероприятия: дата банкета + первое время «ЧЧ:ММ» из поля времени. */
function _ts2EventStart_(e) {
  if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ''))) return null;
  var m = /(\d{1,2})[:.](\d{2})/.exec(String(e.time || '')); if (!m) return null;
  var p = String(e.date).split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), Number(m[1]), Number(m[2]));
}
function _ts2HHMM_(d) { return Utilities.formatDate(d, _mcTz_(), 'HH:mm'); }
function _ts2Expect2_(key, title, due, role, journal, objectId) {
  if (_ts2Find_('JOURNAL_EXPECTATIONS', 'idempotencyKey', key)) return false;
  _ts2Insert_('JOURNAL_EXPECTATIONS', { expectationId: _ts2Id_('JOURNAL_EXPECTATIONS'), enterpriseId: _ts2Ent_(), journalCode: journal, eventRuleId: 'SERVING', objectType: 'BANQUET', objectId: objectId,
    productionId: '', batchId: '', dueAt: _ts2Iso_(due), responsibleRole: role, status: 'OPEN', confirmationMode: 'CONFIRM', measurementRequired: false, completedAt: '', completedBy: '', factId: '', title: title, idempotencyKey: key });
  return true;
}
/** Выдача банкета: контроль 3 часов на раздаче (п. 32); для кейтеринга — 3 часа в изотермических ёмкостях (п. 55) и проверка п. 54. */
function _ts2OnBanquetIssue_(eventId, at) {
  var e = _ts2Event_(eventId); if (!e) return { skipped: 'банкет не найден' };
  at = at || new Date();
  var due = new Date(at.getTime() + TS2_SERVE_HOURS_ * 3600000), hourKey = Utilities.formatDate(at, _mcTz_(), "yyyy-MM-dd'T'HH"), cat = _ts2IsCatering_(e), out = { catering: cat, created: 0 };
  var name = (e.format || e.name || 'банкет') + ' ' + eventId;
  if (cat) {
    if (_ts2Expect2_([_ts2Ent_(), 'CATER55', eventId, hourKey].join('|'), 'Кейтеринг «' + name + '»: горячие блюда в изотермических ёмкостях с ' + _ts2HHMM_(at) + ' — не более 3 часов, включая перевозку (' + TS2_SANPIN_REF_ + ', п. 55). Ярлыки на ёмкостях есть?', due, 'Су-шеф', 'J-RELEASE', eventId)) out.created++;
    var st = _ts2EventStart_(e);
    if (st && at.getTime() < st.getTime() - TS2_SERVE_HOURS_ * 3600000)
      _ts2Exception_('CATERING_EARLY', 'Кейтеринг «' + name + '»: комплектование начато в ' + _ts2HHMM_(at) + ', раньше чем за 3 часа до начала (' + _ts2HHMM_(st) + ') — ' + TS2_SANPIN_REF_ + ', п. 54', eventId);
  } else if (_ts2Expect2_([_ts2Ent_(), 'SERVE32', eventId, hourKey].join('|'), 'Раздача «' + name + '»: блюда, выданные в ' + _ts2HHMM_(at) + ' и требующие разогрева, — не более 3 часов на раздаче (' + TS2_SANPIN_REF_ + ', п. 32). Сняты с раздачи?', due, 'Су-шеф', 'J-RELEASE', eventId)) out.created++;
  return out;
}
/** Последнее завершённое производство блюда за сутки до выдачи — «дата и час изготовления» для ярлыка. */
function _ts2MadeAt_(dishName, before) {
  try {
    var v = _productionSheet_().getDataRange().getValues(), best = null, from = before.getTime() - 24 * 3600000;
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][PROD_COL_.name]).trim().toLowerCase() !== String(dishName).trim().toLowerCase() || String(v[i][PROD_COL_.status]) !== 'COMPLETED') continue;
      var f = v[i][PROD_COL_.finish], d = f instanceof Date ? f : new Date(f);
      if (!isNaN(d) && d.getTime() <= before.getTime() + 60000 && d.getTime() >= from && (!best || d > best)) best = d;
    }
    return best;
  } catch (e) { return null; }
}
/** Ярлыки изотермических ёмкостей (п. 55) — HTML для печати, по одному на позицию банкета. */
function _ts2CateringLabels_(eventId, responsible) {
  var e = _ts2Event_(eventId); if (!e) throw new Error('NOT_FOUND: банкет не найден');
  var org = {}; try { org = _mcOrg_(); } catch (x) {}
  var issue = _ts2Rows_('AUTO_RECORDS', function (r) { return r.eventType === 'RELEASE_TO_HALL' && String(r.sourceId).indexOf(String(eventId) + '|') === 0; }).pop();
  var issuedAt = issue ? new Date(issue.createdAt) : new Date(), gaps = [];
  if (!org.name || !(org.actualAddress || org.legalAddress)) gaps.push('название и адрес предприятия (Настройки → Организация)');
  var esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmt = function (d) { return Utilities.formatDate(d, _mcTz_(), 'dd.MM.yyyy HH:mm'); }, line = '__________________';
  var labels = (e.items || []).filter(function (it) { return it && it.name; }).map(function (it) {
    var made = _ts2MadeAt_(it.name, issuedAt), end = made ? new Date(made.getTime() + TS2_SERVE_HOURS_ * 3600000) : null;
    if (!made) gaps.push('время изготовления «' + it.name + '» (нет завершённого производства за сутки) — впишите от руки');
    return '<div class="lb"><div class="org">' + esc(org.name || line) + '<br><small>' + esc(org.actualAddress || org.legalAddress || line) + '</small></div>' +
      '<div class="nm">' + esc(it.name) + (it.qty ? ' — ' + esc(it.qty) + ' порц.' : '') + '</div>' +
      '<table><tr><td>Изготовлено</td><td><b>' + (made ? fmt(made) : line) + '</b></td></tr><tr><td>Окончание раздачи</td><td><b>' + (end ? fmt(end) : line) + '</b></td></tr>' +
      '<tr><td>Ответственный</td><td><b>' + esc(responsible || line) + '</b></td></tr></table><div class="ft">' + TS2_SANPIN_REF_ + ', п. 55 · ' + esc((e.format || 'Банкет') + ' ' + eventId) + '</div></div>';
  });
  if (!labels.length) throw new Error('VALIDATION: в банкете нет позиций');
  var css = '@page{size:A4;margin:8mm}body{font:11pt Arial,sans-serif;margin:0}.lb{display:inline-block;width:88mm;height:58mm;box-sizing:border-box;border:1.5px dashed #555;margin:2mm;padding:3mm;vertical-align:top;page-break-inside:avoid}' +
    '.org{font-size:9pt}.nm{font-size:13pt;font-weight:700;margin:2mm 0}table{width:100%;font-size:10pt;border-collapse:collapse}td{padding:1px 0}.ft{font-size:7pt;color:#555;margin-top:1mm}';
  return { html: '<!doctype html><html><head><meta charset="utf-8"><title>Ярлыки ' + esc(eventId) + '</title><style>' + css + '</style></head><body>' + labels.join('') + '</body></html>', count: labels.length, gaps: gaps, catering: _ts2IsCatering_(e) };
}
function ts2CateringLabels(token, eventId) {
  try { var s = _requireAuth_(token, 'banquets'); var r = _ts2CateringLabels_(eventId, s && (s.name || s.fullName) || ''); _ts2Audit_('CATERING_LABELS', 'BANQUET', eventId, undefined, { count: r.count, gaps: r.gaps.length }, ''); return _ok_(r); }
  catch (e) { return _failFrom_(e); }
}
