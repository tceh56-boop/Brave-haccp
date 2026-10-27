/**
 * MON CHEF — подписание журналов (ТЗ §9–§13, §43, §53–§54, §60).
 *
 * Ядро подписи — signJournal / validateJournalBeforeSigning / verifyJournalSignature (Code.gs).
 * Здесь — полная проверка перед подписью (§12) и недостающие функции §43:
 *   prepareJournalForSigning — карточка подписи: название журнала (не J-код), период, записей, проблемы;
 *   revokeJournalSignature   — отзыв подписи: только администратор, с причиной; строка подписи
 *                              не удаляется (статус REVOKED), период снова открыт для записи;
 *   getJournalSignature      — подпись по ID или последняя по журналу;
 *   getJournalIntegrity      — целостность подписей журнала: пересчёт хеша периода и сверка.
 *
 * §12: подпись НЕ срабатывает, если найдены проблемы: нет записей; пропущенные проверки
 * (ожидаемые и просроченные); не заполнены дата или измерение; измерение не числом;
 * незакрытые отклонения журнала за период; незакрытые корректирующие действия по ним.
 */
var MC_SIGN_OPEN_DEV_ = /устранен|закрыт|отмен|closed|cancel/i;

function _mcSignDate_(x) { try { return _mcDateOnly_(x); } catch (e) { return null; } }

/** Список проблем журнала за период. Пусто — можно подписывать. */
function _mcSignProblems_(j, periodFrom, periodTo) {
  var problems = [], from = _mcSignDate_(periodFrom), to = _mcSignDate_(periodTo), today = _mcSignDate_(new Date());
  var inP = function (d) { d = _mcSignDate_(d); return !!d && (!from || d >= from) && (!to || d <= to); };
  var rows = _mcPeriodRows_(j, periodFrom, periodTo);
  if (!rows.length) problems.push('В периоде нет записей');
  // 3, 9: незаполненные обязательные поля и ошибки данных
  var empty = 0, bad = 0, firstEmpty = '', firstBad = '';
  rows.forEach(function (row, idx) {
    j.columns.forEach(function (col, c) {
      var lc = String(col).toLowerCase(), v = row[c];
      if (/^дата/.test(lc) && (v === '' || v === null)) { empty++; if (!firstEmpty) firstEmpty = 'запись ' + (idx + 1) + ': нет даты'; }
      if (/t°|температур/.test(lc) && !/режим|норма|способ|допуст/.test(lc)) {
        if (v === '' || v === null) { empty++; if (!firstEmpty) firstEmpty = 'запись ' + (idx + 1) + ': не заполнено «' + col + '»'; }
        else if (!isFinite(parseFloat(String(v).replace(',', '.').replace(/^\+/, '')))) { bad++; if (!firstBad) firstBad = 'запись ' + (idx + 1) + ': «' + col + '» = «' + v + '» — не число'; }
      }
    });
  });
  if (empty) problems.push('Не заполнены обязательные поля: ' + empty + (firstEmpty ? ' (' + firstEmpty + ')' : ''));
  if (bad) problems.push('Ошибки в данных: ' + bad + (firstBad ? ' (' + firstBad + ')' : ''));
  // 2, 7: пропущенные контрольные точки и нарушения сроков
  try {
    var pv = _pendSheet_().getDataRange().getValues(), missed = 0, waiting = 0;
    for (var i = 1; i < pv.length; i++) {
      if (!pv[i][0] || String(pv[i][2]) !== String(j.id) || !inP(pv[i][5])) continue;
      var st = String(pv[i][8] || '');
      if (st === 'просрочено') missed++;
      else if (st === 'ожидает' && _mcSignDate_(pv[i][5]) < today) waiting++;
    }
    if (missed) problems.push('Пропущено проверок (просрочено): ' + missed);
    if (waiting) problems.push('Проверок без ответа за прошедшие дни: ' + waiting);
  } catch (e) {}
  // 4, 5: незакрытые отклонения и корректирующие действия
  try {
    var dv = _devSheet_().getDataRange().getValues(), open = [], ids = {};
    for (var k = 1; k < dv.length; k++) {
      if (!dv[k][0] || String(dv[k][2]) !== String(j.id) || !inP(dv[k][11])) continue;
      ids[dv[k][0]] = true;
      if (!MC_SIGN_OPEN_DEV_.test(String(dv[k][7] || ''))) open.push(String(dv[k][3] || '') + (dv[k][4] ? ' — ' + dv[k][4] : ''));
    }
    if (open.length) problems.push('Незакрытых отклонений: ' + open.length + ' (' + open.slice(0, 3).join('; ') + (open.length > 3 ? '…' : '') + ')');
    var cv = _corrSheet_().getDataRange().getValues(), openCa = 0;
    for (var m = 1; m < cv.length; m++) if (cv[m][0] && ids[cv[m][1]] && !/выполнено|закрыт|done|closed/i.test(String(cv[m][5] || ''))) openCa++;
    if (openCa) problems.push('Незакрытых корректирующих действий: ' + openCa);
  } catch (e) {}
  return { rows: rows, problems: problems };
}

/** Карточка подписи (ТЗ §58, §60): название журнала, период, записей, кто подписывает, проблемы. */
function prepareJournalForSigning(journalId, periodFrom, periodTo, token) {
  try {
    var s = _requireAuth_(token, 'journals');
    var j = _mcJournal_(journalId); if (!j) return coreErr('JOURNAL_NOT_FOUND', 'Журнал не найден');
    var signed = _mcHasSignedPeriod_(journalId, periodFrom, periodTo);
    var pr = _mcSignProblems_(j, periodFrom, periodTo), a = _author_(s);
    return coreOk({ journalId: j.id, journalName: j.name, periodFrom: periodFrom || '', periodTo: periodTo || '', recordCount: pr.rows.length,
      status: signed ? 'SIGNED' : pr.problems.length ? 'DRAFT' : 'READY_TO_SIGN', problems: pr.problems, canSign: !signed && !pr.problems.length,
      signer: { name: a.фио, position: a.должность, role: a.роль }, note: 'Внутреннее подтверждение сотрудником системы — не квалифицированная электронная подпись (ТЗ §15).',
      message: signed ? 'Период уже подписан' : pr.problems.length ? 'Журнал нельзя подписать. Найдено проблем: ' + pr.problems.length : 'Журнал готов к подписанию' });
  } catch (e) { return coreErr('SIGN_PREPARE_ERROR', String(e)); }
}

/** Отзыв подписи (ТЗ §11 статус REVOKED): администратор, причина обязательна, строка остаётся. */
function revokeJournalSignature(signatureId, reason, token) {
  try {
    var s = _requireAuth_(token, 'journals');
    var admin = s.dev === true || _mcRbHasExact_(s, 'haccp_approve');   // этап 10.7: директор
    if (!admin) return coreErr('FORBIDDEN', '403 — отозвать подпись может только директор');
    if (!String(reason || '').trim()) return coreErr('VALIDATION', 'Укажите причину отзыва подписи');
    return _withLock_(function () {
      var sh = _mcSignatureSheet_(), v = sh.getDataRange().getValues();
      for (var i = 1; i < v.length; i++) {
        if (String(v[i][0]) !== String(signatureId)) continue;
        if (String(v[i][14]) !== 'SIGNED') return coreErr('NOT_SIGNED', 'Подпись уже не действует (' + v[i][14] + ')');
        sh.getRange(i + 1, 15).setValue('REVOKED');
        try { _audit_({ session: s, tenant: _defaultTenant_(), id: signatureId, type: 'REVOKE_SIGNATURE' }, 'REVOKE_SIGNATURE', 'Журнал', v[i][2], 'SIGNED',
          { status: 'REVOKED', reason: String(reason), revokedBy: _mcSessionFullName_(s), journalId: v[i][1], periodFrom: v[i][3], periodTo: v[i][4] }); } catch (e) {}
        return coreOk({ signatureId: signatureId, journalName: v[i][2], status: 'REVOKED', note: 'Период снова открыт для записей. Отзыв записан в журнал аудита.' });
      }
      return coreErr('SIGNATURE_NOT_FOUND', 'Подпись не найдена');
    });
  } catch (e) { return coreErr('SIGN_REVOKE_ERROR', String(e)); }
}

function _mcSigRowObj_(r) {
  return { signatureId: r[0], journalId: r[1], journalName: r[2], periodFrom: r[3], periodTo: r[4], version: r[5], recordCount: r[6],
    signedByUserId: r[7], signedByName: r[8], signedByRole: r[9], signedAt: r[10], signatureType: r[11], documentHash: r[12],
    previousHash: r[13], status: r[14], pdfFileId: r[15], verificationCode: r[16] };
}
/** Подпись по ID; если передан ID журнала — последняя действующая подпись журнала. */
function getJournalSignature(idOrJournal, token) {
  try {
    _requireAuth_(token, 'journals');
    var v = _mcSignatureSheet_().getDataRange().getValues(), hit = null;
    for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(idOrJournal)) hit = v[i];
    if (!hit) for (var k = v.length - 1; k >= 1; k--) if (String(v[k][1]) === String(idOrJournal) && String(v[k][14]) === 'SIGNED') { hit = v[k]; break; }
    return hit ? coreOk(_mcSigRowObj_(hit)) : coreErr('SIGNATURE_NOT_FOUND', 'Подпись не найдена');
  } catch (e) { return coreErr('SIGNATURE_ERROR', String(e)); }
}

/** Целостность подписанных периодов журнала (ТЗ §41): пересчёт хеша и сверка — VALID / INVALID. */
function getJournalIntegrity(journalId, token) {
  try {
    _requireAuth_(token, 'journals');
    var v = _mcSignatureSheet_().getDataRange().getValues(), out = [];
    for (var i = 1; i < v.length; i++) {
      if (!v[i][0] || String(v[i][1]) !== String(journalId) || String(v[i][14]) !== 'SIGNED') continue;
      var r = {}; try { r = JSON.parse(_mcVerifyJournalSignature_(v[i][0])); } catch (e) { r = { success: false }; }
      var d = r.data || {};
      out.push({ signatureId: v[i][0], periodFrom: v[i][3], periodTo: v[i][4], signedBy: v[i][8], signedAt: v[i][10], result: r.success && (d.valid === true || d.status === 'VALID') ? 'VALID' : 'INVALID', detail: d });
    }
    return coreOk({ journalId: journalId, journalName: _journalName_(journalId), signatures: out, valid: out.every(function (x) { return x.result === 'VALID'; }) });
  } catch (e) { return coreErr('JOURNAL_INTEGRITY_ERROR', String(e)); }
}

/* ===== Подписанный PDF журнала (ТЗ §38) и QR «Проверить документ» (§39–§41) =====
   PDF: организация, объект, название журнала (не J-код), период, версия, записей, статус, ФИО и
   должность подписавшего, дата и время, ID документа, хеш, код проверки; J-код — только внизу,
   в технической информации. QR ведёт на страницу проверки ?verify=КОД: она показывает только
   реквизиты подписи и результат сверки хеша — доступа к системе не даёт (это не QR инспектора). */
function _mcEsc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _mcFmtDt_(d) { try { return Utilities.formatDate(d instanceof Date ? d : new Date(d), _mcTz_(), 'dd.MM.yyyy HH:mm'); } catch (e) { return String(d || ''); } }
function _mcFmtD_(d) { try { return d ? Utilities.formatDate(d instanceof Date ? d : new Date(d), _mcTz_(), 'dd.MM.yyyy') : ''; } catch (e) { return String(d || ''); } }
function _mcSigVerifyUrl_(code) { var u = ''; try { u = ScriptApp.getService().getUrl() || ''; } catch (e) {} return u ? u + '?verify=' + encodeURIComponent(code) : ''; }
function _mcSignedFolder_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('MC_SIGNED_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = _docsFolder_().createFolder('Подписанные журналы'); p.setProperty('MC_SIGNED_FOLDER_ID', f.getId()); return f;
}
function _mcSignerPosition_(userId) {
  if (!userId) return '';
  try { var e = JSON.parse(getEmployeesFull_()).filter(function (x) { return String(x.id) === String(userId); })[0]; return e ? e.position || '' : ''; } catch (x) { return ''; }
}
function _mcSignedPdfCore_(signatureId) {
  var sh = _mcSignatureSheet_(), v = sh.getDataRange().getValues(), row = -1;
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(signatureId)) { row = i; break; }
  if (row < 0) throw new Error('Подпись не найдена');
  var s = v[row], j = _mcJournal_(String(s[1])); if (!j) throw new Error('Журнал не найден');
  var rows = _mcPeriodRows_(j, s[3], s[4]), p = PropertiesService.getScriptProperties();
  var org = p.getProperty('ORG_NAME') || '— (свойство ORG_NAME не задано)', obj = p.getProperty('LOCATION_NAME') || '— (свойство LOCATION_NAME не задано)';
  var url = _mcSigVerifyUrl_(s[16]), pos = _mcSignerPosition_(s[7]);
  var meta = [['Организация', org], ['Объект', obj], ['Журнал', j.name], ['Период', _mcFmtD_(s[3]) + ' — ' + _mcFmtD_(s[4])], ['Версия', s[5]], ['Количество записей', s[6]],
    ['Статус', String(s[14]) === 'SIGNED' ? 'ПОДПИСАН' : s[14]], ['Подписал', s[8] + (pos ? ', ' + pos : '') + (s[9] ? ' (' + s[9] + ')' : '')], ['Дата и время подписания', _mcFmtDt_(s[10])],
    ['ID документа', s[0]], ['Hash документа', s[12]], ['Код проверки', s[16]]];
  var cols = j.columns || [];
  var h = '<html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:9px;color:#111}h1{font-size:15px;margin:0 0 8px}table{border-collapse:collapse}' +
    '.m td{padding:2px 8px 2px 0;font-size:10px;vertical-align:top}.m td:first-child{color:#555}.r{width:100%}.r th,.r td{border:1px solid #bbb;padding:2px 3px;text-align:left;vertical-align:top}.r th{background:#f2ece4}' +
    '.foot{margin-top:10px;color:#666;font-size:8px}</style></head><body>' +
    '<h1>' + _mcEsc_(j.name) + '</h1><table style="width:100%"><tr><td style="vertical-align:top"><table class="m">' + meta.map(function (m) { return '<tr><td>' + _mcEsc_(m[0]) + '</td><td><b>' + _mcEsc_(m[1]) + '</b></td></tr>'; }).join('') + '</table></td>' +
    (url ? '<td style="width:150px;text-align:center;vertical-align:top">' + _mcQrHtmlTable_(url, 3) + '<div style="font-size:9px;margin-top:4px"><b>Проверить документ</b></div><div style="font-size:7px;color:#666;word-break:break-all">' + _mcEsc_(url) + '</div></td>' : '') + '</tr></table>' +
    '<p style="font-size:9px;color:#444">Подпись — внутреннее подтверждение ответственного в системе MON CHEF, не квалифицированная электронная подпись.</p>' +
    '<table class="r"><tr>' + cols.map(function (c) { return '<th>' + _mcEsc_(c) + '</th>'; }).join('') + '<th>Запись внёс</th></tr>' +
    rows.map(function (r) { var a = _journalAuthorOf_(j, r); return '<tr>' + cols.map(function (c, k) { var x = r[k]; return '<td>' + _mcEsc_(x instanceof Date ? _mcFmtDt_(x) : x) + '</td>'; }).join('') + '<td>' + _mcEsc_(a ? a.фио + ' · ' + a.внесено : '') + '</td></tr>'; }).join('') + '</table>' +
    '<div class="foot">Техническая информация: технический ID журнала ' + _mcEsc_(j.id) + ' · версия формата подписи ' + _mcEsc_(s[5]) + ' · предыдущий hash ' + _mcEsc_(s[13] || '—') + ' · сформировано ' + _mcEsc_(_mcFmtDt_(new Date())) + '</div></body></html>';
  var name = j.name + ' ' + _mcFmtD_(s[3]) + '–' + _mcFmtD_(s[4]) + ' (подписан).pdf';
  var file = _mcSignedFolder_().createFile(Utilities.newBlob(h, 'text/html', 'j.html').getAs('application/pdf').setName(name));
  sh.getRange(row + 1, 16).setValue(file.getId());
  return { fileId: file.getId(), url: file.getUrl(), name: name, verifyUrl: url };
}
/** Сформировать (или переформировать) подписанный PDF по подписи. */
function createSignedJournalPdf(signatureId, token) {
  try {
    var s = _requireAuth_(token, 'journals');
    var r = _mcSignedPdfCore_(signatureId);
    try { _audit_({ session: s, tenant: _defaultTenant_(), id: signatureId, type: 'SIGNED_PDF' }, 'SIGNED_PDF', 'Журнал', signatureId, null, { fileId: r.fileId }); } catch (e) {}
    return coreOk(r);
  } catch (e) { return coreErr('SIGNED_PDF_ERROR', String(e)); }
}
/** Публичная страница проверки по коду из QR подписанного PDF (ТЗ §39, §41). */
function _mcVerifyPage_(code) {
  var c = String(code || '').trim().toUpperCase(), sig = null;
  try { var v = _mcSignatureSheet_().getDataRange().getValues(); for (var i = 1; i < v.length; i++) if (c && String(v[i][16]).toUpperCase() === c) { sig = v[i]; break; } } catch (e) {}
  var body;
  if (!sig) body = '<div class="st bad">Документ с таким кодом проверки не найден</div><p>Проверьте код или обратитесь в организацию, выдавшую документ.</p>';
  else {
    var res = {}; try { res = JSON.parse(_mcVerifyJournalSignature_(sig[0])).data || {}; } catch (e) {}
    var ok = res.valid === true, active = String(sig[14]) === 'SIGNED';
    body = '<div class="st ' + (ok && active ? 'ok' : 'bad') + '">' + (!active ? 'Подпись отозвана или не действует' : ok ? 'Документ подлинный: содержимое совпадает с подписанным' : 'ВНИМАНИЕ: содержимое не совпадает с подписанным (hash изменился)') + '</div>' +
      '<table>' + [['Документ', sig[2]], ['Период', _mcFmtD_(sig[3]) + ' — ' + _mcFmtD_(sig[4])], ['Версия', sig[5]], ['Записей', sig[6]], ['Статус', active ? 'ПОДПИСАН' : sig[14]],
        ['Подписал', sig[8] + (sig[9] ? ' (' + sig[9] + ')' : '')], ['Дата подписи', _mcFmtDt_(sig[10])], ['Целостность', ok ? 'VALID' : 'INVALID'], ['Hash', sig[12]], ['Код проверки', sig[16]]]
        .map(function (r) { return '<tr><td>' + _mcEsc_(r[0]) + '</td><td>' + _mcEsc_(r[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<p class="n">Страница подтверждает только реквизиты и целостность документа. Доступа к системе она не даёт.</p>';
    try { _auditSheet_().appendRow([new Date(), '', 'проверка по QR', 'публичная страница', '', '', '', 'VERIFY_DOCUMENT', 'Подпись', sig[0], '', ok ? 'VALID' : 'INVALID', 'PUBLIC']); } catch (e) {}
  }
  var html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Проверка документа</title><style>' +
    'body{font-family:Arial,sans-serif;background:#f5efe5;margin:0;color:#241c17}.w{max-width:640px;margin:0 auto;padding:20px}h1{font-size:20px;color:#6e1423}' +
    '.st{padding:14px;border-radius:12px;font-weight:700;margin:12px 0}.ok{background:#e3f2e8;color:#1d6b45}.bad{background:#f8e1df;color:#9d2637}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px}' +
    'td{padding:8px 10px;border-bottom:1px solid #eadfdc;font-size:14px;word-break:break-all}td:first-child{color:#766a5d;width:40%}.n{color:#766a5d;font-size:13px}</style></head><body><div class="w"><h1>MON CHEF — проверка документа</h1>' + body + '</div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Проверка документа').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
