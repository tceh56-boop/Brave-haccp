/**
 * MON CHEF — авторство записи журнала (ТЗ §8), перенесено из Mon Cher.
 *
 * Автор записи определяется ТОЛЬКО по сессии вошедшего сотрудника: ФИО, должность, ID.
 * Из браузера автора подставить нельзя (раньше ядро записи брало entry._employeeName).
 * К каждой строке журнала справа дописывается служебный хвост:
 *   «Запись внёс», «Должность внёсшего», «Внесено» (время сервера), «Источник записи», «ID сотрудника».
 * Колонки журнала (j.columns) не меняются — хвост стоит после них, поэтому чтение журналов
 * по схеме колонок работает как раньше. Записи расписания помечаются «Система».
 */
var JOURNAL_AUTHOR_COLS = ['Запись внёс', 'Должность внёсшего', 'Внесено', 'Источник записи', 'ID сотрудника'];

/** Кто вносит запись: токен, сессия или операция ({session}). Без сессии — «Система». */
function _author_(who) {
  var s = null;
  try {
    if (who && typeof who === 'object') s = who.session || who;
    else if (who) s = _getSession_(who);
  } catch (e) { s = null; }
  var name = s ? (s.name || s.fullName || '') : '';
  if (!s || !name) return { фио: 'Система', должность: '', роль: 'Система', id: 'system' };
  var pos = s.position || '';
  if (!pos && s.user_id) {   // сессия заведена до появления должности в токене — берём из листа
    try {
      var e = JSON.parse(getEmployeesFull_()).filter(function (x) { return String(x.id) === String(s.user_id); })[0];
      if (e) pos = e.position || '';
    } catch (err) {}
  }
  return { фио: name, должность: pos, роль: s.role || '', id: s.user_id || '' };
}

function _mcJournalBySheet_(name) {
  var list = (typeof JOURNALS !== 'undefined') ? JOURNALS : [];
  for (var i = 0; i < list.length; i++) if (list[i].sheetName === name) return list[i];
  return null;
}

/** Шапка служебного хвоста — дописывается один раз, если её ещё нет. */
function _journalAuthorCols_(sh, j) {
  var base = (j.columns || []).length;
  var w = Math.max(sh.getLastColumn(), base + JOURNAL_AUTHOR_COLS.length);
  var head = sh.getRange(1, 1, 1, w).getValues()[0].map(function (x) { return String(x || '').trim(); });
  for (var k = 0; k < JOURNAL_AUTHOR_COLS.length; k++) {
    if (head[base + k] !== JOURNAL_AUTHOR_COLS[k]) {
      var r = sh.getRange(1, base + 1, 1, JOURNAL_AUTHOR_COLS.length);
      r.setValues([JOURNAL_AUTHOR_COLS]);
      try { r.setFontWeight('bold'); } catch (e) {}
      break;
    }
  }
  return base + 1;
}

/** Запись строки в лист журнала с автором из сессии. Лист не журнал — обычная запись. */
function _mcJournalAppendTo_(sh, who, source, row) {
  var j = _mcJournalBySheet_(sh.getName());
  if (!j) { sh.appendRow(row); return row; }
  var base = (j.columns || []).length, out = (row || []).slice(0, Math.max(base, 0));
  while (out.length < base) out.push('');
  try { _journalAuthorCols_(sh, j); } catch (e) {}
  var a = _author_(who), tz = _mcTz_();
  out.push(a.фио, a.должность, Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm:ss'), source || 'интерфейс', a.id);
  sh.appendRow(out);
  return out;
}

/** Служебный хвост строки журнала — для экранов и проверки (ТЗ §8). */
function _journalAuthorOf_(j, r) {
  var b = (j.columns || []).length;
  if (!r || r.length <= b || !r[b]) return null;
  return { фио: r[b] || '', должность: r[b + 1] || '', внесено: r[b + 2] || '', источник: r[b + 3] || '', id: r[b + 4] || '' };
}

/** Название журнала для человека (ТЗ §3, §75): J-код — только технический реквизит. */
function _journalName_(id) {
  var list = (typeof JOURNALS !== 'undefined') ? JOURNALS : [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name || String(id || '');
  return String(id || '');
}
