/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
/**
 * ЦЕХ Стандарт Admin — реестр нормативов поставщика (единый для всех клиентов) и уведомления о сроках.
 *
 *   • MASTER_NORMS — документы, их статус и срок «Действует до». Эталон заполняется из встроенного реестра
 *     системы (NormsSeed.gs, генерируется при сборке); дальше реестр ведёт администратор в разделе «Нормативы».
 *   • Отсчёт: для каждого действующего документа — сколько дней осталось. За 180, 90, 30, 14, 7 и 1 день и в день
 *     окончания — уведомление в разделе «Нормативы» и письмо администраторам (каждый порог — один раз).
 *   • Документ отмечен «УТРАТИЛ СИЛУ» (или срок продлён, или добавлен новый) — версия реестра меняется, системы
 *     клиентов забирают её при ежедневной проверке лицензии (action norms.registry): отменённый документ у клиента
 *     получает «УТРАТИЛ СИЛУ» в течение суток. Какая версия у какого клиента — видно в разделе (из usage.report).
 */
var NORMS_STATUSES_ = ['ДЕЙСТВУЕТ', 'УТРАТИЛ СИЛУ', 'ПРОВЕРИТЬ'];
var NORMS_THRESHOLDS_ = [180, 90, 30, 14, 7, 1, 0];

function normsVersion_() { return String(getSetting('NORMS_VERSION', '') || ''); }
function normsBump_(why) { var v = isoDay() + '.' + Date.now(); setSetting('NORMS_VERSION', v, 'Версия реестра нормативов (меняется при каждой правке) — ' + String(why || '').slice(0, 80)); return v; }
function normDay_(v) { if (!v) return ''; var d = v instanceof Date ? v : new Date(v); return isNaN(d) ? String(v).slice(0, 10) : isoDay(d); }
function normDaysLeft_(validTo) { var d = normDay_(validTo); return d ? daysBetween(isoDay(), d) : null; }

/** Дописать в реестр документы из встроенного реестра выпуска; отменённые в выпуске — отменить и здесь. */
function normsSeed_() {
  if (typeof MASTER_NORMS_SEED_ === 'undefined') return 0;
  if (getSetting('NORMS_SEED_VER', '') === MASTER_NORMS_SEED_VER_ && readAll('MASTER_NORMS').length) return 0;
  return withLock(function () {
    var have = {}, n = 0; readAll('MASTER_NORMS').forEach(function (r) { have[r.code] = r; });
    MASTER_NORMS_SEED_.forEach(function (r) {
      var cur = have[r[0]];
      if (!cur) { insert('MASTER_NORMS', { code: r[0], group: r[1], document: r[2], title: r[3], requires: r[4], whereInSystem: r[5], status: r[6], link: r[7], validTo: r[8], replacedBy: '', changedAt: new Date(), changedBy: 'выпуск ' + MASTER_NORMS_SEED_VER_, note: '' }); n++; return; }
      var patch = {};
      if (r[6] === 'УТРАТИЛ СИЛУ' && cur.status !== 'УТРАТИЛ СИЛУ') { patch.status = 'УТРАТИЛ СИЛУ'; patch.requires = r[4]; }
      if (r[8] && !normDay_(cur.validTo)) patch.validTo = r[8];
      if (Object.keys(patch).length) { patch.changedAt = new Date(); patch.changedBy = 'выпуск ' + MASTER_NORMS_SEED_VER_; update('MASTER_NORMS', r[0], patch); n++; }
    });
    setSetting('NORMS_SEED_VER', MASTER_NORMS_SEED_VER_, 'Встроенный реестр нормативов последнего выпуска');
    if (n || !normsVersion_()) normsBump_('выпуск ' + MASTER_NORMS_SEED_VER_);
    return n;
  });
}

/* ------------------------------------------------------------------ уведомления */
function normsAlertTo_() {
  var to = String(getSetting('NORMS_ALERT_EMAIL', '') || '').trim();
  if (to) return to;
  return readAll('Users').filter(function (u) { return u['Статус'] !== 'BLOCKED' && (u['Роль'] === 'SUPER_ADMIN' || u['Роль'] === 'MANAGER'); }).map(function (u) { return u['Email']; }).filter(Boolean).join(',');
}
/** Уведомление: запись в ADMIN_ALERTS (без повторов по ключу) и письмо администраторам. */
function normsAlert_(kind, code, text, key) {
  if (readAll('ADMIN_ALERTS').some(function (a) { return a.dedupKey === key; })) return false;
  insert('ADMIN_ALERTS', { alertId: newId('ALR'), at: new Date(), kind: kind, objectId: code, text: text, status: 'OPEN', closedAt: '', closedBy: '', dedupKey: key });
  logEvent('NORMS', 'система', code, text);
  var to = normsAlertTo_();
  if (to) { try { MailApp.sendEmail({ to: to, name: 'ЦЕХ Стандарт Admin', subject: 'Нормативы: ' + text.slice(0, 90), htmlBody: mailHtml_('Реестр нормативов', text + '\n\nРаздел «Нормативы» админ-панели: проверьте замену или продление и обновите документ — системы клиентов получат изменение в течение суток.') }); } catch (e) { logError('normsAlert', e.message, code); } }
  return true;
}
/** Ежедневно (dailyJob) и при открытии раздела: пороги срока действия. */
function normsCheck_() {
  normsSeed_();
  var n = 0;
  readAll('MASTER_NORMS').forEach(function (r) {
    if (r.status !== 'ДЕЙСТВУЕТ') return;
    var left = normDaysLeft_(r.validTo); if (left === null) return;
    var t = NORMS_THRESHOLDS_.filter(function (x) { return left <= x; }).pop(); if (t === undefined) return;
    var vt = normDay_(r.validTo), d = fmtDate(new Date(vt + 'T12:00:00'), 'dd.MM.yyyy');
    var text = left < 0 ? r.document + ': срок действия истёк ' + d + ' (' + -left + ' дн. назад) — укажите замену или продление'
      : left === 0 ? r.document + ': сегодня последний день действия (' + d + ') — укажите замену или продление'
      : r.document + ': действует до ' + d + ', осталось ' + left + ' дн.';
    if (normsAlert_(left <= 0 ? 'NORM_EXPIRED' : 'NORM_EXPIRING', r.code, text, r.code + '|' + vt + '|' + t)) n++;
  });
  return n;
}

/* ------------------------------------------------------------------ экран «Нормативы» */
function adminNorms(token) {
  try {
    requireRole(token, 'clients.view');
    try { normsCheck_(); } catch (e) { logError('normsCheck', e.message, ''); }
    var ver = normsVersion_(), norms = readAll('MASTER_NORMS').map(function (r) {
      var o = {}; SHEETS.MASTER_NORMS.forEach(function (k) { o[k] = r[k]; }); o.validTo = normDay_(r.validTo); o.daysLeft = r.status === 'ДЕЙСТВУЕТ' ? normDaysLeft_(r.validTo) : null; return o; });
    var orgs = {}; readAll('Organizations').forEach(function (o) { orgs[o['ID']] = o['Название']; });
    var clients = readAll('ENTERPRISE_AUTOMATION_PROFILES').map(function (p) {
      return { orgId: p.orgId, name: orgs[p.orgId] || p.orgId, normsVersion: String(p.normsVersion || ''), normsExpired: p.normsExpired === '' ? null : Number(p.normsExpired), updatedAt: p.updatedAt, upToDate: String(p.normsVersion || '') === ver }; });
    var alerts = readAll('ADMIN_ALERTS').filter(function (a) { return a.status === 'OPEN' && /^NORM_/.test(a.kind); }).reverse();
    return ok({ version: ver, today: isoDay(), norms: norms, alerts: alerts, clients: clients, statuses: NORMS_STATUSES_, thresholds: NORMS_THRESHOLDS_, alertTo: normsAlertTo_() });
  } catch (e) { return fail(e); }
}
/** Добавить или изменить документ. Смена статуса на «УТРАТИЛ СИЛУ» — уведомление; любая правка — новая версия для клиентов. */
function adminNormSave(token, n) {
  try {
    var s = requireRole(token, 'releases'); n = n || {}; req(n, ['code', 'document', 'status']);
    var code = String(n.code).trim().toUpperCase();
    if (!/^[A-ZА-Я]{2}-\d{2,3}$/.test(code)) throw new Error('VALIDATION: код документа — две буквы и номер, например SN-10');
    if (NORMS_STATUSES_.indexOf(n.status) < 0) throw new Error('VALIDATION: статус — ДЕЙСТВУЕТ, УТРАТИЛ СИЛУ или ПРОВЕРИТЬ');
    var vt = String(n.validTo || '').slice(0, 10); if (vt && !/^\d{4}-\d{2}-\d{2}$/.test(vt)) throw new Error('VALIDATION: срок действия — дата ГГГГ-ММ-ДД');
    if (n.status === 'УТРАТИЛ СИЛУ' && !String(n.replacedBy || '').trim()) throw new Error('VALIDATION: укажите, чем заменён документ (или «не заменён»)');
    return withLock(function () {
      var cur = findBy('MASTER_NORMS', 'code', code), row = { code: code, group: String(n.group || (cur && cur.group) || 'Прочее'), document: String(n.document).trim(), title: String(n.title || ''), requires: String(n.requires || ''),
        whereInSystem: String(n.whereInSystem || ''), status: n.status, link: String(n.link || ''), validTo: vt, replacedBy: String(n.replacedBy || ''), changedAt: new Date(), changedBy: s.email, note: String(n.note || '') };
      if (cur) update('MASTER_NORMS', code, row); else insert('MASTER_NORMS', row);
      var what = !cur ? 'добавлен' : cur.status !== n.status ? cur.status + ' → ' + n.status : normDay_(cur.validTo) !== vt ? 'срок ' + (normDay_(cur.validTo) || '—') + ' → ' + (vt || '—') : 'изменён';
      logEvent('NORMS', s.email, code, row.document + ': ' + what);
      if (n.status === 'УТРАТИЛ СИЛУ' && (!cur || cur.status !== 'УТРАТИЛ СИЛУ')) normsAlert_('NORM_REPEALED', code, row.document + ' утратил силу' + (row.replacedBy ? ', заменён: ' + row.replacedBy : '') + '. Клиенты получат изменение в течение суток.', code + '|REPEALED|' + isoDay());
      readAll('ADMIN_ALERTS').filter(function (a) { return a.status === 'OPEN' && a.objectId === code && a.kind !== 'NORM_REPEALED'; }).forEach(function (a) { update('ADMIN_ALERTS', a.alertId, { status: 'DONE', closedAt: new Date(), closedBy: s.email }); });
      var ver = normsBump_(code + ' ' + what);
      return ok({ code: code, version: ver, what: what });
    });
  } catch (e) { return fail(e); }
}
function adminAlertClose(token, alertId) {
  try { var s = requireRole(token, 'clients.view'); withLock(function () { update('ADMIN_ALERTS', alertId, { status: 'DONE', closedAt: new Date(), closedBy: s.email }); }); return ok(true); } catch (e) { return fail(e); }
}
function adminNormsAlertEmail(token, email) {
  try { requireRole(token, 'settings'); var e = String(email || '').trim(); if (e && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+(,[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+)*$/.test(e)) throw new Error('VALIDATION: адрес указан с ошибкой');
    setSetting('NORMS_ALERT_EMAIL', e, 'Кому писать о сроках нормативов (пусто — администраторам Super Admin и Manager)'); return ok({ to: normsAlertTo_() }); } catch (e2) { return fail(e2); }
}

/* ------------------------------------------------------------------ API для систем клиентов */
function normsForClient_(have) {
  normsSeed_();
  var ver = normsVersion_();
  if (have && have === ver) return { ok: true, version: ver, norms: null };
  return { ok: true, version: ver, norms: readAll('MASTER_NORMS').map(function (r) { return { code: r.code, group: r.group, document: r.document, title: r.title, requires: r.requires, whereInSystem: r.whereInSystem, status: r.status, link: r.link, validTo: normDay_(r.validTo), replacedBy: r.replacedBy }; }) };
}
