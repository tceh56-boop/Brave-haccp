/**
 * MON CHEF — KPI шефа (ТЗ §17) и сводка подписания журналов (ТЗ §53, §58).
 *
 * Все показатели — фактическое состояние данных (§52): если данных нет, пишется «нет данных»,
 * а не 100 %. Период: выполнение — сегодня; ККТ и температуры — 7 дней; подписание — текущий месяц.
 */
function _mcPct_(ok, all) { return all ? Math.round(ok / all * 100) : null; }
function _mcDay0_(d) { var x = d instanceof Date ? new Date(d.getTime()) : new Date(d); if (isNaN(x.getTime())) return null; x.setHours(0, 0, 0, 0); return x; }

function _mcChefKpi_() {
  var now = new Date(), today = _mcDay0_(now), weekAgo = new Date(today.getTime() - 6 * 86400000), tz = _mcTz_();
  var todayIso = Utilities.formatDate(now, tz, 'yyyy-MM-dd'), hm = Utilities.formatDate(now, tz, 'HH:mm');
  var out = { done: null, doneDue: 0, ccp: null, ccpN: 0, temp: null, tempN: 0, devOpen: 0, caOpen: 0 };
  try {   // выполнение сегодняшних проверок, срок которых уже наступил
    var pv = _pendSheet_().getDataRange().getValues(), due = 0, ok = 0;
    for (var i = 1; i < pv.length; i++) {
      if (!pv[i][0]) continue;
      var d = pv[i][5] instanceof Date ? Utilities.formatDate(pv[i][5], tz, 'yyyy-MM-dd') : String(pv[i][5]).slice(0, 10);
      if (d !== todayIso || String(pv[i][6] || '99:99') > hm) continue;
      due++; if (String(pv[i][8]) === 'выполнено') ok++;
    }
    out.done = _mcPct_(ok, due); out.doneDue = due;
  } catch (e) {}
  try {   // ККТ в норме — факты HACCP за 7 дней
    var fv = _v31Rows_(MC_V31.FACT), n = 0, okc = 0;
    fv.forEach(function (r) { var t = _mcDay0_(r[9]); if (!t || t < weekAgo) return; n++; if (String(r[7]) === 'OK') okc++; });
    out.ccp = _mcPct_(okc, n); out.ccpN = n;
  } catch (e) {}
  try {   // температуры в режиме — единый реестр за 7 дней
    var tv = _tSheet_().getDataRange().getValues(), tn = 0, tok = 0;
    for (var k = 1; k < tv.length; k++) { var tt = _mcDay0_(tv[k][10]); if (!tv[k][0] || !tt || tt < weekAgo) continue; var res = String(tv[k][11]); if (res === 'OK' || res === 'DEVIATION') { tn++; if (res === 'OK') tok++; } }
    out.temp = _mcPct_(tok, tn); out.tempN = tn;
  } catch (e) {}
  try { var dv = _devSheet_().getDataRange().getValues(); for (var a = 1; a < dv.length; a++) if (dv[a][0] && !MC_SIGN_OPEN_DEV_.test(String(dv[a][7] || ''))) out.devOpen++; } catch (e) {}
  try { var cv = _corrSheet_().getDataRange().getValues(); for (var b = 1; b < cv.length; b++) if (cv[b][0] && /^открыт/i.test(String(cv[b][5] || ''))) out.caOpen++; } catch (e) {}
  return out;
}

/** Состояние подписания журналов за текущий месяц: подписан / готов / есть проблемы / нет записей. */
function _mcSigningBoard_() {
  var now = new Date(), tz = _mcTz_();
  var from = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth(), 1), tz, 'yyyy-MM-dd'), to = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var sv = []; try { sv = _mcSignatureSheet_().getDataRange().getValues(); } catch (e) {}
  var rows = [];
  (typeof JOURNALS !== 'undefined' ? JOURNALS : []).forEach(function (j) {
    var sig = null;
    for (var i = sv.length - 1; i >= 1; i--) if (String(sv[i][1]) === String(j.id) && String(sv[i][14]) === 'SIGNED' && String(_mcFormatDateIso_(_mcDateOnly_(sv[i][4]))) >= from) { sig = sv[i]; break; }
    var st, problems = [], count = 0;
    try { var pr = _mcSignProblems_(j, from, to); count = pr.rows.length; problems = pr.problems; } catch (e) { problems = []; count = 0; }
    if (sig) st = 'Подписан';
    else if (!count) st = 'Нет записей';
    else st = problems.length ? 'Есть проблемы: ' + problems.length : 'Готов к подписанию';
    rows.push({ id: j.id, name: j.name, period: from.split('-').reverse().join('.') + ' — ' + to.split('-').reverse().join('.'), records: count, status: st,
      signed: sig ? (sig[8] + ' · ' + _mcFmtDt_(sig[10]) + ' · период по ' + _mcFmtD_(sig[4])) : '', problems: sig ? '' : problems.join('; '), responsible: j.role || '' });
  });
  return { from: from, to: to, rows: rows,
    total: rows.length, signed: rows.filter(function (r) { return r.status === 'Подписан'; }).length,
    ready: rows.filter(function (r) { return r.status === 'Готов к подписанию'; }).length,
    problems: rows.filter(function (r) { return /^Есть проблемы/.test(r.status); }).length };
}
