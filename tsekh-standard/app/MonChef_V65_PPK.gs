/**
 * ЦЕХ Стандарт V65 — создание и ведение программы производственного контроля (ТЗ «Итоговая структура…», §15).
 *
 * ППК — версионируемый документ: DRAFT (Черновик) → REVIEW (На проверке) → APPROVED (Утверждён) → ACTIVE (Действует) → ARCHIVED.
 * Одновременно действует одна версия на период: ввод новой в действие архивирует прежнюю.
 * Листы: ППК_V30 (версии), ППК_Разделы, ППК_Мероприятия, ППК_График, ППК_Согласование — колонки по ТЗ §15.4.
 *
 * Генератор собирает разделы и мероприятия из данных предприятия (реквизиты, зоны, процессы и опасности, ККТ, мониторинг,
 * санитария, лабораторный план, вода, вредители, отходы, оборудование и поверки, медкнижки, журналы, нормативы) и
 * НИЧЕГО НЕ ПРИДУМЫВАЕТ: нет предела, метода или ответственного — мероприятие остаётся с пустым полем, а проверка полноты
 * показывает пробел. Пока проверка не пройдена, ППК в статусе «На проверке» и утверждению не подлежит.
 * Разделы, отредактированные человеком, генератор не перезаписывает. PDF — с логотипом и реквизитами из настроек.
 */
var MC_V65 = {
  PPK: ['ППК_V30', ['PPKID', 'Name', 'Version', 'DateFrom', 'DateTo', 'Status', 'Responsible', 'ApprovedBy', 'ApprovedAt', 'FileID', 'Hash', 'Notes', 'CreatedAt', 'CreatedBy']],
  SEC: ['ППК_Разделы', ['SectionID', 'PPKID', 'SectionCode', 'SectionName', 'Sequence', 'Text', 'OwnerRole', 'Status', 'Version', 'SourceRequirementIDs', 'UpdatedAt', 'UpdatedBy']],
  ACT: ['ППК_Мероприятия', ['ControlPlanID', 'PPKID', 'ProcessID', 'AreaID', 'Object', 'Parameter', 'Normative', 'Frequency', 'Method', 'ResponsibleRole', 'JournalID', 'EvidenceType', 'CorrectiveAction', 'Active', 'StartDate', 'EndDate']],
  SCH: ['ППК_График', ['ScheduleID', 'PPKID', 'ControlPlanID', 'Period', 'DueDate', 'AssignedTo', 'Status', 'FactID', 'DeviationID', 'CompletedAt', 'CompletedBy']],
  APR: ['ППК_Согласование', ['ApprovalID', 'PPKID', 'Stage', 'Decision', 'Comment', 'EmployeeID', 'EmployeeName', 'Role', 'DateTime', 'FileID', 'Hash']]
};
var MC_V65_ST_RU = { DRAFT: 'Черновик', REVIEW: 'На проверке', APPROVED: 'Утверждён', ACTIVE: 'Действует', ARCHIVED: 'Архивирован' };
// Содержание ППК (§15.3): код, название, роль-владелец, требования-основания
var MC_V65_SECTIONS = [
  ['TITLE', 'Титульный лист', 'Директор', ''], ['ORG', 'Сведения об организации', 'Директор', ''], ['OBJECT', 'Описание объекта', 'Директор', ''],
  ['RESP', 'Распределение ответственности', 'Директор', 'REQ-HACCP-001'], ['SANREGIME', 'Санитарный режим', 'Ответственный за ХАССП', ''],
  ['INCOMING', 'Входной контроль сырья', 'Ответственный за ХАССП', ''], ['STORAGE', 'Контроль хранения', 'Шеф-повар', ''],
  ['PROCESS', 'Контроль технологических процессов', 'Шеф-повар', ''], ['HACCP', 'ХАССП и ККТ', 'Ответственный за ХАССП', 'REQ-HACCP-001'],
  ['FINISHED', 'Контроль готовой продукции', 'Шеф-повар', ''], ['LAB', 'Программа лабораторных исследований', 'Ответственный за ХАССП', ''],
  ['WATER', 'Контроль воды и среды', 'Ответственный за ХАССП', ''], ['DISINF', 'Контроль дезсредств', 'Ответственный за ХАССП', ''],
  ['PERSONNEL', 'Медицинские осмотры и обучение персонала', 'Директор', ''], ['WASTE', 'Обращение с отходами', 'Ответственный за ХАССП', ''],
  ['PEST', 'Борьба с вредителями', 'Ответственный за ХАССП', ''], ['EQUIP', 'Поверка оборудования', 'Ответственный за ХАССП', ''],
  ['DEVREG', 'Порядок регистрации отклонений', 'Ответственный за ХАССП', ''], ['CAPA', 'Корректирующие действия', 'Ответственный за ХАССП', ''],
  ['VERIFY', 'Порядок верификации', 'Ответственный за ХАССП', ''], ['JOURNALS', 'Перечень журналов', 'Ответственный за ХАССП', ''],
  ['NORMS', 'Перечень нормативных документов', 'Ответственный за ХАССП', ''], ['APPROVAL', 'Лист согласования и утверждения', 'Директор', '']
];
// Шаги мастера (§15.2) → откуда берутся данные
var MC_V65_WIZARD = [
  ['Реквизиты организации', 'Настройки → Организация', 'ORG'], ['Адрес объекта и производственных зон', 'Настройки → Организация; Санитария: зоны', 'OBJECT'],
  ['Виды деятельности', 'раздел «Описание объекта» (вводится)', 'OBJECT'], ['Цеха и помещения', 'ТТК: цеха; места хранения; зоны санитарии', 'OBJECT'],
  ['Перечень оборудования', 'Оборудование: реестр', 'EQUIP'], ['Источники водоснабжения', 'Вода: источники', 'WATER'], ['Поставщики и категории сырья', 'Закупки: поставщики', 'INCOMING'],
  ['ТТК и технологические процессы', 'ХАССП: процессы; ТТК', 'PROCESS'], ['ККТ и ХАССП', 'ХАССП: опасности, ККТ, мониторинг', 'HACCP'], ['Санитарные программы', 'Санитария: зоны и планы', 'SANREGIME'],
  ['Программа лабораторного контроля', 'Лаборатория: план', 'LAB'], ['Программа контроля персонала', 'Персонал: медкнижки, обучение', 'PERSONNEL'],
  ['Программа обращения с отходами', 'Санитария: отходы', 'WASTE'], ['Дезинсекция и дератизация', 'Санитария: вредители', 'PEST'],
  ['Контроль оборудования и средств измерений', 'Оборудование: поверка', 'EQUIP'], ['Ответственные лица', 'Персонал: роли', 'RESP'],
  ['Графики и периодичность', 'Мероприятия ППК', 'JOURNALS'], ['Документы-основания и нормативные ссылки', 'Нормативы и требования', 'NORMS'], ['Утверждение и выпуск PDF', 'Согласование', 'APPROVAL']
];

function _v65Sh_(k) { return _v64Sheet_(MC_V65[k][0], MC_V65[k][1]); }
function setupV65Ppk(token) { try { _requireAuth_(token, 'ppk_view|ppk_edit'); Object.keys(MC_V65).forEach(_v65Sh_); return _ok_({ initialized: true, sheets: Object.keys(MC_V65).map(function (k) { return MC_V65[k][0]; }) }, 'V65_SETUP'); } catch (e) { return _failFrom_(e); } }
function _v65Objs_(k) {
  var sh = _book_().getSheetByName(MC_V65[k][0]); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(String);
  return v.slice(1).map(function (r, i) { var o = { _row: i + 2 }; h.forEach(function (c, j) { o[c] = r[j]; }); return o; }).filter(function (o) { return o[h[0]] !== '' && o[h[0]] !== null; });
}
function _v65Rows_(name) {   // произвольный лист как объекты по заголовку
  var sh = _book_().getSheetByName(name); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x || '').trim(); });
  return v.slice(1).filter(function (r) { return r.some(function (x) { return x !== '' && x !== null; }); }).map(function (r) { var o = {}; h.forEach(function (c, j) { if (c && !(c in o)) o[c] = r[j]; }); return o; });
}
function _v65Get_(id) { return _v65Objs_('PPK').filter(function (x) { return String(x.PPKID) === String(id); })[0] || null; }
function _v65SetCell_(k, rowNo, col, val) { _v65Sh_(k).getRange(rowNo, MC_V65[k][1].indexOf(col) + 1).setValue(val); }
function _v65Fmt_(d) { var x = _v64Date_(d); return x ? Utilities.formatDate(x, _mcTz_(), 'dd.MM.yyyy') : ''; }
function _v65Bool_(x) { return x === true || /^(true|да|1|yes)$/i.test(String(x || '').trim()); }
function _v65On_(x) { return !(x === false || /^(false|нет|0|no)$/i.test(String(x === undefined || x === null ? '' : x).trim())); }
function _v65Fail_(op, code, msg) { _endOp_(op, 'FAILED'); return _fail_(code, msg, op.id); }
function _v65Who_(op) { var s = op && op.session; return { id: s ? String(s.user_id || '') : '', name: s ? (s.dev ? MC_RB_TECH_ : (s.fullName || s.name || '')) : '', role: s ? (s.dev ? MC_RB_TECH_ : (s.role || '')) : '' }; }
function _v65Approval_(ppkId, stage, decision, comment, op, fileId, hash) {
  var w = _v65Who_(op), id = 'APR-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  _v65Sh_('APR').appendRow([id, ppkId, stage, decision, String(comment || '').slice(0, 45000), w.id, w.name, w.role, new Date(), fileId || '', hash || '']);
  return id;
}
function _v65J_(re) { try { var j = (JOURNALS || []).filter(function (x) { return re.test(String(x.name || '')) || re.test(String(x.sheetName || '')); })[0]; return j ? j.id : ''; } catch (e) { return ''; } }

/* ---------------- генерация разделов из данных ---------------- */
function _v65Data_() {
  var D = {};
  D.org = _mcOrg_(); D.orgC = _mcOrgCompleteness_(D.org);
  D.processes = _v65Rows_('HACCP_Процессы_V30').filter(function (p) { return String(p.Status) !== 'ARCHIVED'; });
  D.hazards = _v65Rows_('HACCP_Опасности_V30'); D.ccp = _v65Rows_('HACCP_ТочкиКонтроля_V30').filter(function (c) { return String(c.Status) !== 'ARCHIVED'; });
  D.mon = _v65Rows_('HACCP_Мониторинг_V30').filter(function (m) { return _v65On_(m.Enabled); }); D.ctl = _v65Rows_('HACCP_Контроли').filter(function (c) { return _v65On_(c.Enabled); });
  D.zones = _v65Rows_('Санитария_Зоны_V42').filter(function (z) { return _v65On_(z.Active); }); D.sanPlans = _v65Rows_('Санитария_Планы_V42');
  D.lab = _v65Rows_('Лаборатория_План').filter(function (l) { return _v65On_(l['Активен'] === undefined ? l.Active : l['Активен']); });
  D.wsrc = _v65Rows_('Вода_Источники'); D.wplan = _v65Rows_('Вода_План').filter(function (w) { return _v65On_(w['Активен']); });
  D.pest = _v65Rows_('Вредители_План'); D.waste = _v65Rows_('Отходы'); D.eq = _v65Rows_('Оборудование_Реестр');
  D.med = _v65Rows_('Медкнижки').filter(function (m) { return _v65On_(m['Активна']); }); D.train = _v65Rows_('Персонал_Обучение');
  D.docs = _v65Rows_('Нормативы_V33'); D.req = _v65Rows_('Требования_V33');
  D.sup = _v65Rows_('Поставщики'); D.places = _v65Rows_('Склад_Места_V22').filter(function (p) { return _v65On_(p['Активно']); });
  D.dis = _v65Rows_('Дезсредства_V41');
  D.emp = []; try { var st = _mcRbEmpState_(); Object.keys(st).forEach(function (k) { if (st[k].active !== false && !st[k].hidden) D.emp.push({ id: k, name: st[k].name, role: st[k].role, position: st[k].position }); }); } catch (e) {}
  D.shops = []; try { var ws = _dishWorkshopMap_() || {}; Object.keys(ws).forEach(function (c) { if (ws[c] && D.shops.indexOf(ws[c]) < 0) D.shops.push(ws[c]); }); } catch (e) {}
  D.journals = []; try { D.journals = (JOURNALS || []).map(function (j) { return { id: j.id, name: j.name }; }); } catch (e) {}
  return D;
}
function _v65List_(arr, f, empty) { return arr.length ? arr.map(function (x, i) { return (i + 1) + '. ' + f(x); }).join('\n') : (empty || '— нет данных в системе'); }
function _v65SectionText_(code, D, ppk, acts) {
  var o = D.org, byRole = function (r) { return D.emp.filter(function (e) { return e.role === r; }).map(function (e) { return e.name; }).join(', ') || '— не назначен'; };
  var actsOf = function (re) { return acts.filter(function (a) { return re.test(String(a.Object) + ' ' + String(a.Parameter) + ' ' + String(a.EvidenceType)); }); };
  var actLine = function (a) { return a.Object + ' — ' + a.Parameter + (a.Normative ? ' (норматив: ' + a.Normative + ')' : '') + '; периодичность: ' + (a.Frequency || '— не задана') + '; ответственный: ' + (a.ResponsibleRole || '— не назначен') + (a.JournalID ? '; журнал ' + a.JournalID : ''); };
  switch (code) {
    case 'TITLE': return 'Программа производственного контроля\n' + (o.name || '— наименование организации не заполнено') + (o.objectName ? '\n' + o.objectName : '') +
      '\nВерсия ' + ppk.Version + ', период действия: ' + _v65Fmt_(ppk.DateFrom) + ' — ' + (_v65Fmt_(ppk.DateTo) || 'до замены новой версией') + '\nУтверждает: ' + (o.responsibleName ? o.responsibleName + (o.responsiblePosition ? ', ' + o.responsiblePosition : '') : '— ответственное лицо не указано в настройках');
    case 'ORG': return ['Наименование: ' + (o.name || '—'), 'Юридический адрес: ' + (o.legalAddress || '—'), 'Фактический адрес: ' + (o.actualAddress || '—'),
      'ИНН: ' + (o.inn || '—') + (o.kpp ? ', КПП: ' + o.kpp : '') + (o.ogrn ? ', ОГРН/ОГРНИП: ' + o.ogrn : ''), 'Ответственное лицо: ' + (o.responsibleName || '—') + (o.responsiblePosition ? ', ' + o.responsiblePosition : ''),
      'Телефон: ' + (o.phone || '—') + ', эл. почта: ' + (o.email || '—')].join('\n') + (D.orgC.complete ? '' : '\nНЕ ЗАПОЛНЕНО: ' + D.orgC.missing.join(', '));
    case 'OBJECT': return 'Объект: ' + (o.objectName || o.name || '—') + ', адрес: ' + (o.actualAddress || '—') + '\nЦеха (по ТТК): ' + (D.shops.join(', ') || '— не указаны') +
      '\nЗоны и помещения (санитария): ' + (D.zones.map(function (z) { return z.AreaName + (z.Workshop ? ' (' + z.Workshop + ')' : ''); }).join(', ') || '— не заведены') +
      '\nМеста хранения: ' + (D.places.map(function (p) { return p['Название'] + (p['ТемператураМин'] !== '' || p['ТемператураМакс'] !== '' ? ' (' + p['ТемператураМин'] + '…' + p['ТемператураМакс'] + ' °C)' : ''); }).join(', ') || '—') +
      '\nВиды деятельности: укажите в этом разделе (например, производство и реализация продукции общественного питания, обслуживание банкетов).';
    case 'RESP': return ['Директор: ' + byRole('Директор'), 'Ответственный за ХАССП: ' + byRole('Ответственный за ХАССП'), 'Шеф-повар: ' + byRole('Шеф-повар'), 'Су-шеф: ' + byRole('Су-шеф'),
      'Ответственное лицо организации (настройки): ' + (o.responsibleName || '—')].join('\n') + '\nОтветственные за мероприятия — в таблице мероприятий (роль).';
    case 'SANREGIME': return 'Зоны и периодичность уборки:\n' + _v65List_(D.zones, function (z) { return z.AreaName + ': ' + (z.Frequency || '— периодичность не задана'); }, '— зоны не заведены (Санитария → зоны)') +
      '\nДезсредства применяются только по утверждённым режимам (концентрация, экспозиция, смывание).';
    case 'INCOMING': return 'Каждая партия проходит входной контроль: температура, органолептика, упаковка и маркировка, ВСД и документы; до решения — карантин.\nПоставщики (' + D.sup.length + '):\n' +
      _v65List_(D.sup, function (s) { return s['Название'] + (s['ИНН'] ? ', ИНН ' + s['ИНН'] : '') + (s['Категории'] ? ' — ' + s['Категории'] : '') + (s['Статус'] ? ' [' + s['Статус'] + ']' : ''); }, '— поставщики не заведены');
    case 'STORAGE': return 'Места хранения и температурные режимы:\n' + _v65List_(D.places, function (p) { return p['Название'] + ': ' + (p['ТемператураМин'] === '' && p['ТемператураМакс'] === '' ? 'режим не задан' : p['ТемператураМин'] + '…' + p['ТемператураМакс'] + ' °C'); }) +
      '\nFEFO, учёт вскрытия, пересчёт срока после вскрытия и дефроста — по утверждённым правилам; повторная заморозка запрещена.\n' + actsOf(/температур|хранен/i).map(actLine).join('\n');
    case 'PROCESS': return 'Технологические процессы (' + D.processes.length + '):\n' + _v65List_(D.processes, function (p) { return (p.Code || p.ProcessID) + ' — ' + p.Name + (p.Responsible ? '; ответственный: ' + p.Responsible : ''); }, '— процессы не описаны (ХАССП → процессы)') +
      '\nПроизводство — только по утверждённой ТТК; п/ф в ТТК указывается как отдельный ингредиент.';
    case 'HACCP': return 'Опасности: ' + D.hazards.filter(function (h) { return String(h.Status) !== 'ARCHIVED'; }).length + ', критические контрольные точки и ОПРП: ' + D.ccp.length + '.\n' + _v65List_(D.ccp, function (c) { return (c.Type || 'ККТ') + ' «' + c.ControlPoint + '»: предел ' + (c.CriticalLimit ? c.CriticalLimit + ' ' + (c.LimitUnit || '') : '— не задан') +
      '; мониторинг: ' + (c.MonitoringMethod || '—') + ', ' + (c.Frequency || 'периодичность не задана') + '; ответственный: ' + (c.Responsible || '—') + '; корректирующее действие: ' + (c.CorrectiveAction || '—'); }, '— ККТ не определены (ХАССП → точки контроля)') + (typeof _hzlSectionText_ === 'function' ? (function () { try { return _hzlSectionText_(); } catch (e) { return ''; } })() : '');
    case 'FINISHED': return 'Бракераж готовой продукции — каждая партия (журнал ' + (_v65J_(/бракераж.*готов/i) || 'бракеража') + '); суточная проба — от каждой партии блюда; допуск к выдаче — только при пройденном бракераже, пробе и закрытых ККТ.';
    case 'LAB': return 'План лабораторных исследований (' + D.lab.length + '):\n' + _v65List_(D.lab, function (l) { return (l.ObjectName || l['Объект контроля']) + ' — ' + (l.Indicator || l['Вид исследования']) + '; норматив: ' + (l.Normative || l['Норматив'] || '—') +
      '; метод: ' + (l.Method || '— не указан') + '; периодичность: ' + ((l.FrequencyDays || l['Периодичность, дней']) ? 'раз в ' + (l.FrequencyDays || l['Периодичность, дней']) + ' дн.' : '— не задана') + '; лаборатория: ' + (l.Laboratory || l['Лаборатория'] || '—'); }, '— план не составлен (Лаборатория → план)');
    case 'WATER': return 'Источники водоснабжения:\n' + _v65List_(D.wsrc, function (w) { return w['Название'] + ' (' + (w['Тип'] || '') + '), точка отбора: ' + (w['Точка отбора'] || '—'); }, '— источники не заведены') +
      '\nПлан контроля воды:\n' + _v65List_(D.wplan, function (w) { return w['Показатель'] + ': раз в ' + w['Периодичность, дней'] + ' дн., норматив ' + (w['Норматив'] || '—') + ', лаборатория ' + (w['Лаборатория'] || '—'); });
    case 'DISINF': return 'Дезсредства (' + D.dis.length + '): ' + (D.dis.map(function (d) { return d.ProductName || d['Наименование'] || ''; }).filter(String).join(', ') || '— не заведены') + '\nКонтроль концентрации рабочих растворов — при каждом приготовлении (журнал ' + (_v65J_(/концентрац/i) || 'концентрации') + ').';
    case 'PERSONNEL': { var t0 = new Date(), exp = D.med.filter(function (m) { var d = _v64Date_(m['Следующий медосмотр']); return d && d < t0; });
      return 'Медицинские книжки: ' + D.med.length + (exp.length ? ', просрочен медосмотр: ' + exp.map(function (m) { return m['Сотрудник']; }).join(', ') : '') + '\nОбучение и инструктажи: записей ' + D.train.length + '\nЕжедневный допуск к работе — журнал ' + (_v65J_(/гигиен|здоров/i) || 'здоровья') + '.'; }
    case 'WASTE': return 'Вывоз отходов: пищевые — не реже чем через ' + MC_WASTE_MAX_DAYS_['пищевые'] + ' сут., ТКО — ' + MC_WASTE_MAX_DAYS_['ТКО'] + ' сут., фритюрное масло — ' + MC_WASTE_MAX_DAYS_['масло фритюрное'] + ' сут. (по договорам и документам вывоза).\nЗаписей учёта отходов: ' + D.waste.length + '.';
    case 'PEST': return 'Дезинсекция и дератизация:\n' + _v65List_(D.pest, function (p) { return p['Вид работ'] + ' — ' + (p['Подрядчик'] || 'подрядчик не указан') + ', договор ' + (p['Договор №'] || '—') + ' до ' + (_v65Fmt_(p['Действует до']) || '—') + ', раз в ' + (p['Периодичность, дней'] || '—') + ' дн.'; }, '— договоры не заведены (Санитария → вредители)');
    case 'EQUIP': { var meas = D.eq.filter(function (e) { return /да|true/i.test(String(e['Измерительный (да/нет)'])); });
      return 'Оборудование: ' + D.eq.length + ', средства измерений: ' + meas.length + '\n' + _v65List_(meas, function (e) { return e['Наименование'] + ' ' + (e['Модель'] || '') + ' № ' + (e['Заводской №'] || '—') + ': поверка до ' + (_v65Fmt_(e['Следующая поверка']) || '— не указано'); }, '— средства измерений не заведены'); }
    case 'DEVREG': return 'Отклонение регистрируется в системе в момент обнаружения (замер вне предела, несоответствие протокола, нарушение условий): автоматически создаётся запись отклонения с OperationID, связью с партией и сотрудником; партия при критическом отклонении блокируется до решения ответственного.';
    case 'CAPA': return 'По каждому отклонению назначается корректирующее действие с ответственным и сроком; выполнение подтверждается доказательством; закрытие — только после проверки результата.\n' + _v65List_(D.ccp.filter(function (c) { return c.CorrectiveAction; }), function (c) { return c.ControlPoint + ': ' + c.CorrectiveAction; }, '');
    case 'VERIFY': return 'Верификация: проверка выполнения мероприятий по графику ППК, анализ отклонений и корректирующих действий, результаты лабораторных исследований, внутренние проверки. Периодичность и ответственный — в мероприятиях с видом доказательства «VERIFICATION».';
    case 'JOURNALS': return _v65List_(D.journals, function (j) { return j.id + ' — ' + j.name; });
    case 'NORMS': return _v65List_(D.docs.filter(function (d) { return String(d.Status) === 'ACTIVE'; }), function (d) { return d.Number + ' «' + d.Title + '»' + (d.EffectiveFrom ? ', действует с ' + _v65Fmt_(d.EffectiveFrom) : '') + (d.EffectiveTo ? ' до ' + _v65Fmt_(d.EffectiveTo) : ''); }, '— нормативный реестр пуст');
    case 'APPROVAL': return 'Лист согласования и утверждения формируется из записей согласования (этап, решение, сотрудник, роль, дата, файл и хеш).';
  }
  return '';
}

/* ---------------- мероприятия из данных ---------------- */
function _v65AutoActivities_(ppkId, D, ppk) {
  var out = [], n = 0, from = ppk.DateFrom || '', to = ppk.DateTo || '';
  var add = function (o) { n++; out.push([('CP-A-' + ('000' + n).slice(-3)) + '-' + String(ppkId).slice(-6), ppkId, o.process || '', o.area || '', o.object || '', o.parameter || '', o.normative || '', o.frequency || '', o.method || '',
    o.role || '', o.journal || '', o.evidence || 'FACT', o.ca || '', true, from, to]); };
  D.ccp.forEach(function (c) {
    var m = D.mon.filter(function (x) { return String(x.ControlID) === String(c.ControlID); })[0];
    add({ process: c.ProcessID, object: c.ControlPoint, parameter: (c.Type || 'ККТ') + (m ? ': ' + m.Parameter : ''), normative: c.CriticalLimit ? c.CriticalLimit + ' ' + (c.LimitUnit || '') : '',
      frequency: c.Frequency || (m && m.Frequency) || '', method: c.MonitoringMethod || '', role: c.Responsible || (m && m.Responsible) || '', journal: (m && m.JournalID) || c.RecordSource || '', evidence: 'FACT', ca: c.CorrectiveAction || '' });
  });
  D.mon.forEach(function (m) { if (D.ccp.some(function (c) { return String(c.ControlID) === String(m.ControlID); })) return;
    add({ object: m.Object, parameter: m.Parameter, normative: (m.TargetMin !== '' || m.TargetMax !== '') ? (m.TargetMin + '…' + m.TargetMax + ' ' + (m.Unit || '')) : '', frequency: m.Frequency, role: m.Responsible, journal: m.JournalID, evidence: 'FACT' }); });
  // Мастер-промт 4.0, этап 4: значимые опасности операций ТТК под мерой предприятия (без ККТ) — карта рисков
  if (typeof _hzlActivities_ === 'function') { try { _hzlActivities_().forEach(add); } catch (e) {} }
  D.ctl.forEach(function (c) {
    add({ object: c.Object || c.Name, parameter: c.Question || c.Name, normative: (c.Min !== '' || c.Max !== '') && (c.Min || c.Max) ? (c.Min + '…' + c.Max + ' ' + (c.Unit || '')) : '',
      frequency: c.ScheduleType === 'в_заданное_время' ? 'ежедневно в ' + c.Parameter : (c.ScheduleType || ''), role: c.Responsible, journal: c.JournalID, evidence: 'FACT', ca: c.Notes || '' });
  });
  // санитарные планы V42: по зоне — конкретные операции с утверждённым режимом дезсредства вместо общей «обработки зоны»
  var planByZone = {}; (D.sanPlans || []).forEach(function (sp) { if (/CANCEL|ARCHIV/i.test(String(sp.Status || ''))) return; var k = String(sp.AreaID || ''), t = String(sp.TaskName || '').trim(); if (!t) return;
    planByZone[k] = planByZone[k] || {}; if (!planByZone[k][t]) planByZone[k][t] = sp; });
  D.zones.forEach(function (z) { var pl = planByZone[String(z.AreaID)]; if (!pl) return;
    Object.keys(pl).forEach(function (t) { var sp = pl[t]; add({ area: z.AreaID, object: z.AreaName, parameter: 'Санитарная обработка: ' + t + (sp.RegimeID ? ' (режим ' + sp.RegimeID + ')' : ''), frequency: z.Frequency || '',
      role: sp.AssignedTo || 'Ответственный за ХАССП', journal: _v65J_(/уборк|санитар|мойк/i), evidence: 'CHECKLIST', method: 'чек-лист санитарной обработки; режим — из утверждённого реестра дезсредств', ca: 'повторная обработка, проверка концентрации раствора' }); }); });
  D.zones.forEach(function (z) { if (planByZone[String(z.AreaID)]) return; add({ area: z.AreaID, object: z.AreaName, parameter: 'Санитарная обработка зоны', frequency: z.Frequency || '', role: 'Ответственный за ХАССП', journal: _v65J_(/уборк|санитар|мойк/i), evidence: 'CHECKLIST', method: 'чек-лист санитарии' }); });
  D.lab.forEach(function (l) { var f = l.FrequencyDays || l['Периодичность, дней'];
    add({ object: l.ObjectName || l['Объект контроля'], parameter: 'Лабораторное исследование: ' + (l.Indicator || l['Вид исследования']), normative: l.Normative || l['Норматив'] || '', frequency: f ? 'раз в ' + f + ' дней' : '',
      method: l.Method || '', role: l.ResponsibleRole || l['Ответственный'] || '', journal: 'LAB:' + (l.PlanID || l.ID), evidence: 'LAB_PROTOCOL', ca: 'при несоответствии — блокировка партии, повторное исследование, отклонение и корректирующее действие' }); });
  D.wplan.forEach(function (w) { var s = D.wsrc.filter(function (x) { return x.SourceID === w.SourceID; })[0];
    add({ object: 'Вода: ' + (s ? s['Название'] : w.SourceID), parameter: w['Показатель'], normative: w['Норматив'] || '', frequency: w['Периодичность, дней'] ? 'раз в ' + w['Периодичность, дней'] + ' дней' : '', method: 'лабораторное исследование', role: w['Ответственный'] || '', evidence: 'LAB_PROTOCOL' }); });
  D.pest.forEach(function (p) { add({ object: 'Зоны: ' + (p['Зоны'] || '—'), parameter: p['Вид работ'], frequency: p['Периодичность, дней'] ? 'раз в ' + p['Периодичность, дней'] + ' дней' : '', method: 'акт подрядчика', role: 'Ответственный за ХАССП', journal: _v65J_(/дезинсекц|дератизац/i), evidence: 'ACT' }); });
  D.eq.filter(function (e) { return /да|true/i.test(String(e['Измерительный (да/нет)'])); }).forEach(function (e) {
    add({ object: e['Наименование'] + ' № ' + (e['Заводской №'] || '—'), parameter: 'Поверка средства измерений', normative: e['Следующая поверка'] ? 'поверка до ' + _v65Fmt_(e['Следующая поверка']) : '', frequency: 'по сроку поверки', method: 'свидетельство о поверке', role: 'Ответственный за ХАССП', evidence: 'CERTIFICATE' }); });
  D.places.forEach(function (p) { if (p['ТемператураМин'] === '' && p['ТемператураМакс'] === '') return;
    add({ area: p.LocationID, object: p['Название'], parameter: 'Температура хранения', normative: p['ТемператураМин'] + '…' + p['ТемператураМакс'] + ' °C', frequency: 'ежедневно', method: 'термометр из реестра приборов', role: 'Шеф-повар', journal: _v65J_(/температур.*холод|холодильн/i), evidence: 'FACT', ca: 'перенос продукции, оценка безопасности, заявка на ремонт' }); });
  add({ object: 'Каждая партия сырья', parameter: 'Входной контроль: температура, органолептика, упаковка, маркировка, документы', frequency: 'при каждой приёмке', method: 'осмотр, термометр-щуп, документы', role: 'Шеф-повар', journal: _v65J_(/бракераж.*сыр|входн/i), evidence: 'FACT', ca: 'карантин, возврат поставщику' });
  add({ object: 'Каждая партия готовой продукции', parameter: 'Бракераж и суточная проба', frequency: 'каждая партия', method: 'органолептическая оценка', role: 'Шеф-повар', journal: _v65J_(/бракераж.*готов/i), evidence: 'FACT', ca: 'запрет выдачи, утилизация' });
  add({ object: 'Персонал', parameter: 'Медицинские осмотры и гигиеническая аттестация', frequency: 'по сроку медицинской книжки', method: 'медицинская книжка', role: 'Директор', journal: 'Медкнижки', evidence: 'DOCUMENT', ca: 'отстранение от работы до прохождения' });
  add({ object: 'Персонал', parameter: 'Ежедневный осмотр на допуск к работе', frequency: 'ежедневно', method: 'осмотр, опрос', role: 'Шеф-повар', journal: _v65J_(/гигиен|здоров/i), evidence: 'FACT', ca: 'отстранение от работы' });
  if ((D.dis || []).length) add({ object: 'Рабочие растворы дезсредств', parameter: 'Концентрация рабочего раствора', frequency: 'при каждом приготовлении', method: 'тест-полоски / по инструкции средства', role: 'Ответственный за ХАССП', journal: _v65J_(/концентрац/i), evidence: 'FACT', ca: 'приготовить раствор заново' });
  add({ object: 'Программа производственного контроля', parameter: 'Верификация выполнения ППК', frequency: 'ежемесячно', method: 'анализ графика, отклонений, протоколов', role: 'Ответственный за ХАССП', evidence: 'VERIFICATION' });
  return out;
}

/* ---------------- проверка полноты (§15.5) ---------------- */
function _v65Check_(ppkId) {
  var D = _v65Data_(), acts = _v65Objs_('ACT').filter(function (a) { return String(a.PPKID) === String(ppkId) && _v65On_(a.Active); }), secs = _v65Objs_('SEC').filter(function (s) { return String(s.PPKID) === String(ppkId); });
  var today = new Date(), res = [];
  var push = function (code, title, issues, emptyStatus) { res.push({ code: code, title: title, status: issues.length ? (emptyStatus || 'REVIEW') : 'PASS', issues: issues.slice(0, 50), count: issues.length }); };
  // 1. зоны и санитарные мероприятия
  var z = []; if (!D.zones.length) z.push('зоны и помещения не заведены (Санитария → зоны)');
  D.zones.forEach(function (x) { if (!acts.some(function (a) { return String(a.AreaID) === String(x.AreaID) && /CHECKLIST|санитар/i.test(a.EvidenceType + ' ' + a.Parameter); })) z.push('зона «' + x.AreaName + '» без санитарного мероприятия'); else if (!x.Frequency) z.push('зона «' + x.AreaName + '»: не задана периодичность уборки'); });
  push('ZONES', 'Все зоны имеют санитарные мероприятия', z, D.zones.length ? 'REVIEW' : 'MISSING_EVIDENCE');
  // 2. процессы → опасности и меры
  var p = []; if (!D.processes.length) p.push('технологические процессы не описаны');
  D.processes.forEach(function (x) { var hz = D.hazards.filter(function (h) { return String(h.ProcessID) === String(x.ProcessID); });
    if (!hz.length) p.push('процесс «' + x.Name + '»: не проанализированы опасности'); else if (hz.some(function (h) { return !String(h.PreventiveMeasure || '').trim(); })) p.push('процесс «' + x.Name + '»: есть опасность без меры контроля'); });
  push('HAZARDS', 'Для каждого процесса есть опасности и меры контроля', p, D.processes.length ? 'REVIEW' : 'MISSING_EVIDENCE');
  // 2а. Мастер-промт 4.0, этап 3: операции действующих ТТК связаны с анализом опасностей, значимые — под контролем
  if (typeof _hzlGaps_ === 'function') { var tg = []; try { tg = _hzlGaps_(); } catch (e) { tg = ['связь ТТК → ХАССП не проверена: ' + e.message]; } push('TTK_HACCP', 'Операции действующих ТТК учтены в анализе опасностей', tg); }
  // 3. ККТ: предел, частота, ответственный, журнал
  // ККТ не требуются безусловно: если анализ опасностей документирован (по каждой опасности решено «значима/нет»,
  // у значимых есть мера управления и доказательство), отсутствие ККТ обосновано (ОППУ / программы предварительных условий).
  var c = [];
  if (!D.ccp.length) {
    var hzAll = D.hazards.filter(function (h) { return String(h.Status) !== 'ARCHIVED'; });
    var undecided = hzAll.filter(function (h) { return !String(h.Significant === undefined ? '' : h.Significant).trim(); });
    var sig = hzAll.filter(function (h) { return _v65Bool_(h.Significant); }), uncontrolled = sig.filter(function (h) { return !String(h.ExistingControl || '').trim() || !String(h.Evidence || '').trim(); });
    if (!D.processes.length || !hzAll.length) c.push('ККТ не определены и анализ опасностей не документирован (ХАССП → процессы и опасности)');
    else { undecided.forEach(function (h) { c.push('опасность «' + h.Hazard + '»: не решено, значима ли (обоснование отсутствия ККТ)'); });
      uncontrolled.forEach(function (h) { c.push('значимая опасность «' + h.Hazard + '»: без ККТ нужна мера управления (ОППУ) и доказательство'); }); }
  }
  D.ccp.forEach(function (x) { var m = D.mon.filter(function (y) { return String(y.ControlID) === String(x.ControlID); })[0], miss = [];
    if (!String(x.CriticalLimit || '').trim()) miss.push('критический предел'); if (!String(x.Frequency || (m && m.Frequency) || '').trim()) miss.push('частота');
    if (!String(x.Responsible || (m && m.Responsible) || '').trim()) miss.push('ответственный'); if (!String((m && m.JournalID) || x.RecordSource || '').trim()) miss.push('журнал');
    if (miss.length) c.push('ККТ «' + x.ControlPoint + '»: нет — ' + miss.join(', ')); });
  push('CCP', D.ccp.length ? 'Для каждой ККТ есть предел, частота, ответственный и журнал' : 'ККТ не определены — отсутствие обосновано анализом опасностей', c, D.ccp.length || D.hazards.length ? 'REVIEW' : 'MISSING_EVIDENCE');
  // 4. лабораторные показатели: метод и периодичность
  var l = []; if (!D.lab.length) l.push('нет программы лабораторных исследований (Лаборатория → план)');
  D.lab.forEach(function (x) { var nm = (x.ObjectName || x['Объект контроля']) + ' / ' + (x.Indicator || x['Вид исследования']);
    if (!String(x.Method || '').trim()) l.push(nm + ': не указан метод исследования'); if (!(Number(x.FrequencyDays || x['Периодичность, дней']) > 0)) l.push(nm + ': не задана периодичность'); });
  push('LAB', 'Для каждого лабораторного показателя есть метод и периодичность', l, D.lab.length ? 'REVIEW' : 'MISSING_EVIDENCE');
  // 5. ответственные
  var r = [], roles = {}; if (!D.org.responsibleName) r.push('в настройках организации не указано ответственное лицо');
  if (!D.emp.some(function (e) { return e.role === 'Ответственный за ХАССП'; })) r.push('нет сотрудника с ролью «Ответственный за ХАССП»');
  acts.forEach(function (a) { if (!String(a.ResponsibleRole || '').trim()) r.push('мероприятие «' + a.Object + ' — ' + a.Parameter + '»: не назначен ответственный'); else roles[a.ResponsibleRole] = 1; });
  Object.keys(roles).forEach(function (k) { if (MC_RB_ROLES_.indexOf(k) >= 0 && !D.emp.some(function (e) { return e.role === k; })) r.push('роль «' + k + '» указана ответственной, но сотрудника с этой ролью нет'); });
  push('RESP', 'Назначены ответственные сотрудники', r);
  // 6. документы и поверки действуют
  var dv = [];
  D.eq.forEach(function (e) { if (!/да|true/i.test(String(e['Измерительный (да/нет)']))) return; var d = _v64Date_(e['Следующая поверка']);
    if (!d) dv.push('средство измерений «' + e['Наименование'] + '»: не указан срок поверки'); else if (d < today) dv.push('средство измерений «' + e['Наименование'] + '»: поверка просрочена с ' + _v65Fmt_(d)); });
  D.docs.forEach(function (d) { var to = _v64Date_(d.EffectiveTo); if (String(d.Status) === 'ACTIVE' && to && to < today) dv.push('нормативный документ ' + d.Number + ' отмечен действующим, но срок истёк ' + _v65Fmt_(to)); });
  D.med.forEach(function (m) { var d = _v64Date_(m['Следующий медосмотр']); if (d && d < today) dv.push('медкнижка: ' + m['Сотрудник'] + ' — медосмотр просрочен с ' + _v65Fmt_(d)); });
  D.pest.forEach(function (x) { var d = _v64Date_(x['Действует до']); if (d && d < today) dv.push('договор дезинсекции/дератизации ' + (x['Договор №'] || '') + ' истёк ' + _v65Fmt_(d)); });
  push('DOCS', 'Документы и поверки действуют', dv);
  // 7. конфликтующие версии требований
  var cf = [], seen = {}, docSt = {}; D.docs.forEach(function (d) { docSt[d.DocID] = String(d.Status); });
  D.docs.filter(function (d) { return String(d.Status) === 'ACTIVE'; }).forEach(function (d) { var k = String(d.Number).trim(); if (seen['D|' + k]) cf.push('два действующих документа с номером ' + k); seen['D|' + k] = 1; });
  // одно требование (RequirementID) действует дважды; разные требования с одной ссылкой на пункт — не конфликт
  D.req.filter(function (q) { return _v65On_(q.Active); }).forEach(function (q) { var k = String(q.RequirementID); if (seen['R|' + k]) cf.push('требование ' + k + ' действует в двух версиях'); seen['R|' + k] = 1;
    if (docSt[q.DocID] && !/^(ACTIVE|GUIDANCE)$/.test(docSt[q.DocID])) cf.push('требование ' + q.RequirementID + ' ссылается на недействующий документ ' + q.DocID + ' (' + docSt[q.DocID] + ')'); });
  push('CONFLICTS', 'Нет конфликтующих версий требований', cf);
  // 8. реквизиты организации
  push('ORG', 'Заполнены реквизиты организации', D.orgC.missing.map(function (m) { return 'не заполнено: ' + m; }), 'MISSING_EVIDENCE');
  // разделы содержания
  var s = []; MC_V65_SECTIONS.forEach(function (x) { var sec = secs.filter(function (y) { return y.SectionCode === x[0]; })[0]; if (!sec || !String(sec.Text || '').trim()) s.push('раздел «' + x[1] + '» не заполнен'); });
  if (!acts.length) s.push('нет мероприятий производственного контроля');
  push('SECTIONS', 'Обязательные разделы ППК заполнены', s, 'MISSING_EVIDENCE');
  var ok = res.every(function (x) { return x.status === 'PASS'; });
  return { status: ok ? 'PASS' : 'REVIEW', checks: res, blocking: res.filter(function (x) { return x.status !== 'PASS'; }).length, at: new Date().toISOString() };
}

/* ---------------- API: версии ---------------- */
function v65CreatePpk(json, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_edit', 'V65_CREATE', 'ППК', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json), from = _v64DateArg_(d.dateFrom, new Date(), 'Действует с'), to = _v64DateArg_(d.dateTo, '', 'Действует по');
    if (to && to < from) return _v65Fail_(op, 'VALIDATION', 'Дата окончания раньше начала');
    return _withLock_(function () {
      Object.keys(MC_V65).forEach(_v65Sh_);
      var all = _v65Objs_('PPK'), ver = all.reduce(function (a, x) { return Math.max(a, Number(x.Version) || 0); }, 0) + 1, base = d.basedOn ? _v65Get_(d.basedOn) : null;
      if (d.basedOn && !base) return _v65Fail_(op, 'NOT_FOUND', 'Исходная версия ППК не найдена');
      var id = 'PPK-' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyyMMdd') + '-' + Utilities.getUuid().slice(0, 6).toUpperCase(), w = _v65Who_(op);
      _v65Sh_('PPK').appendRow([id, String(d.name || 'Программа производственного контроля'), ver, from, to || '', 'DRAFT', d.responsible || (_mcOrg_().responsibleName || w.name), '', '', '', '', d.notes || (base ? 'на основе версии ' + base.Version : ''), new Date(), w.name]);
      var secRows = MC_V65_SECTIONS.map(function (x, i) { var old = base ? _v65Objs_('SEC').filter(function (s) { return String(s.PPKID) === String(base.PPKID) && s.SectionCode === x[0]; })[0] : null;
        return ['SEC-' + Utilities.getUuid().slice(0, 8).toUpperCase(), id, x[0], x[1], i + 1, old ? old.Text : '', x[2], old && old.Status === 'EDITED' ? 'EDITED' : 'AUTO', 1, x[3], new Date(), w.name]; });
      _v65Sh_('SEC').getRange(_v65Sh_('SEC').getLastRow() + 1, 1, secRows.length, MC_V65.SEC[1].length).setValues(secRows);
      if (base) { var manual = _v65Objs_('ACT').filter(function (a) { return String(a.PPKID) === String(base.PPKID) && /^CP-M-/.test(a.ControlPlanID); });
        if (manual.length) _v65Sh_('ACT').getRange(_v65Sh_('ACT').getLastRow() + 1, 1, manual.length, MC_V65.ACT[1].length).setValues(manual.map(function (a) { return MC_V65.ACT[1].map(function (c) { return c === 'PPKID' ? id : c === 'ControlPlanID' ? 'CP-M-' + Utilities.getUuid().slice(0, 8).toUpperCase() : a[c]; }); })); }
      _v65Approval_(id, 'Создание версии', 'DRAFT', base ? 'на основе ' + base.PPKID : '', op);
      _audit_(op, 'V65_CREATE', 'ППК', id, null, { version: ver, basedOn: d.basedOn || '' }); _endOp_(op);
      return _ok_({ ppkId: id, version: ver, status: 'DRAFT', note: 'Черновик создан. Нажмите «Сформировать из данных», затем проверьте разделы и отправьте на проверку.' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v65Editable_(p) { return p && (p.Status === 'DRAFT' || p.Status === 'REVIEW'); }
/** Сформировать разделы (кроме отредактированных людьми) и мероприятия из данных предприятия; проверить полноту. */
function v65Generate(ppkId, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_edit', 'V65_GENERATE', 'ППК', ppkId, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var p = _v65Get_(ppkId); if (!p) return _v65Fail_(op, 'NOT_FOUND', 'ППК не найдена');
      if (!_v65Editable_(p)) return _v65Fail_(op, 'VALIDATION', 'Формировать можно черновик или версию на проверке (сейчас «' + (MC_V65_ST_RU[p.Status] || p.Status) + '»)');
      // этап 4: перед формированием связь ТТК → ХАССП пересчитывается (ППК отражает действующие ТТК)
      if (typeof _hzlSync_ === 'function') { try { _hzlSync_(); } catch (e) { _log_('WARN', 'связь ТТК → ХАССП: ' + e.message); } }
      var D = _v65Data_(), w = _v65Who_(op);
      // мероприятия: автоматические заменяются, добавленные вручную остаются
      var ash = _v65Sh_('ACT'), av = ash.getDataRange().getValues(), keep = [av[0]];
      for (var i = 1; i < av.length; i++) if (!(String(av[i][1]) === String(ppkId) && /^CP-A-/.test(String(av[i][0])))) keep.push(av[i]);
      var auto = _v65AutoActivities_(ppkId, D, p);
      ash.clearContents(); var all = keep.concat(auto);
      ash.getRange(1, 1, all.length, MC_V65.ACT[1].length).setValues(all.map(function (r) { var x = r.slice(0, MC_V65.ACT[1].length); while (x.length < MC_V65.ACT[1].length) x.push(''); return x; }));
      var acts = _v65Objs_('ACT').filter(function (a) { return String(a.PPKID) === String(ppkId); });
      // разделы
      var secs = _v65Objs_('SEC').filter(function (s) { return String(s.PPKID) === String(ppkId); }), updated = 0, kept = 0;
      secs.forEach(function (s) { if (s.Status === 'EDITED') { kept++; return; } var txt = _v65SectionText_(s.SectionCode, D, p, acts);
        if (String(s.Text) !== txt) { _v65SetCell_('SEC', s._row, 'Text', txt); _v65SetCell_('SEC', s._row, 'Version', (Number(s.Version) || 1) + (s.Text ? 1 : 0)); _v65SetCell_('SEC', s._row, 'UpdatedAt', new Date()); _v65SetCell_('SEC', s._row, 'UpdatedBy', w.name + ' (генератор)'); updated++; }
        _v65SetCell_('SEC', s._row, 'Status', 'AUTO'); });
      var chk = _v65Check_(ppkId);
      if (chk.status !== 'PASS' && p.Status === 'DRAFT') { /* черновик остаётся черновиком; на проверке — остаётся на проверке */ }
      _v65Approval_(ppkId, 'Проверка полноты', chk.status, chk.checks.filter(function (x) { return x.status !== 'PASS'; }).map(function (x) { return x.title + ': ' + x.issues.slice(0, 5).join('; '); }).join(' | ') || 'все проверки пройдены', op);
      _audit_(op, 'V65_GENERATE', 'ППК', ppkId, null, { activities: auto.length, sectionsUpdated: updated, sectionsKept: kept, check: chk.status, blocking: chk.blocking }); _endOp_(op);
      return _ok_({ ppkId: ppkId, activities: auto.length, manualActivities: keep.filter(function (r, k) { return k > 0 && String(r[1]) === String(ppkId); }).length, sectionsUpdated: updated, sectionsKeptEdited: kept, check: chk }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v65SaveSection(json, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_edit', 'V65_SECTION', 'ППК', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json);
    return _withLock_(function () {
      var p = _v65Get_(d.ppkId); if (!_v65Editable_(p)) return _v65Fail_(op, 'VALIDATION', 'Разделы меняются только в черновике или версии на проверке');
      var s = _v65Objs_('SEC').filter(function (x) { return String(x.PPKID) === String(d.ppkId) && x.SectionCode === d.sectionCode; })[0]; if (!s) return _v65Fail_(op, 'NOT_FOUND', 'Раздел не найден');
      var txt = String(d.text || '').trim(); if (!txt) return _v65Fail_(op, 'VALIDATION', 'Текст раздела пуст');
      var w = _v65Who_(op);
      _v65SetCell_('SEC', s._row, 'Text', txt); _v65SetCell_('SEC', s._row, 'Status', 'EDITED'); _v65SetCell_('SEC', s._row, 'Version', (Number(s.Version) || 1) + 1); _v65SetCell_('SEC', s._row, 'UpdatedAt', new Date()); _v65SetCell_('SEC', s._row, 'UpdatedBy', w.name);
      if (d.sourceRequirementIds !== undefined) _v65SetCell_('SEC', s._row, 'SourceRequirementIDs', String(d.sourceRequirementIds));
      _audit_(op, 'V65_SECTION', 'ППК', d.ppkId, { section: d.sectionCode, version: s.Version }, { section: d.sectionCode, version: (Number(s.Version) || 1) + 1, chars: txt.length }); _endOp_(op);
      return _ok_({ sectionCode: d.sectionCode, version: (Number(s.Version) || 1) + 1, status: 'EDITED' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Добавить или изменить мероприятие (добавленные вручную генератор не трогает). */
function v65SaveActivity(json, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_edit', 'V65_ACTIVITY', 'ППК', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(json);
    return _withLock_(function () {
      var p = _v65Get_(d.ppkId); if (!_v65Editable_(p)) return _v65Fail_(op, 'VALIDATION', 'Мероприятия меняются только в черновике или версии на проверке');
      if (!String(d.object || '').trim() || !String(d.parameter || '').trim()) return _v65Fail_(op, 'VALIDATION', 'Укажите объект и показатель контроля');
      var row = { PPKID: d.ppkId, ProcessID: d.processId || '', AreaID: d.areaId || '', Object: d.object, Parameter: d.parameter, Normative: d.normative || '', Frequency: d.frequency || '', Method: d.method || '',
        ResponsibleRole: d.responsibleRole || '', JournalID: d.journalId || '', EvidenceType: d.evidenceType || 'FACT', CorrectiveAction: d.correctiveAction || '', Active: d.active === false ? false : true, StartDate: p.DateFrom, EndDate: p.DateTo };
      var ex = d.controlPlanId ? _v65Objs_('ACT').filter(function (a) { return a.ControlPlanID === d.controlPlanId && String(a.PPKID) === String(d.ppkId); })[0] : null;
      var id = ex ? ex.ControlPlanID : 'CP-M-' + Utilities.getUuid().slice(0, 8).toUpperCase(); row.ControlPlanID = id;
      if (ex && /^CP-A-/.test(id)) { row.ControlPlanID = 'CP-M-' + Utilities.getUuid().slice(0, 8).toUpperCase(); _v65SetCell_('ACT', ex._row, 'Active', false); }   // правка автоматического → ручная копия
      var vals = MC_V65.ACT[1].map(function (c) { return row[c] === undefined ? '' : row[c]; });
      if (ex && !/^CP-A-/.test(id)) _v65Sh_('ACT').getRange(ex._row, 1, 1, vals.length).setValues([vals]); else _v65Sh_('ACT').appendRow(vals);
      _audit_(op, 'V65_ACTIVITY', 'ППК', d.ppkId, ex || null, row); _endOp_(op);
      return _ok_({ controlPlanId: row.ControlPlanID }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v65Check(ppkId, token) { try { _requireAuth_(token, 'ppk_view|ppk_edit|ppk_approve'); if (!_v65Get_(ppkId)) return _fail_('NOT_FOUND', 'ППК не найдена'); return _ok_(_v65Check_(ppkId)); } catch (e) { return _failFrom_(e); } }
/** Отправить на проверку: статус «На проверке» (REVIEW); утвердить можно, когда проверка полноты пройдена. */
function v65Submit(ppkId, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_edit', 'V65_SUBMIT', 'ППК', ppkId, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var p = _v65Get_(ppkId); if (!p) return _v65Fail_(op, 'NOT_FOUND', 'ППК не найдена'); if (p.Status !== 'DRAFT') return _v65Fail_(op, 'VALIDATION', 'Отправить можно только черновик');
      var chk = _v65Check_(ppkId);
      _v65SetCell_('PPK', p._row, 'Status', 'REVIEW');
      _v65Approval_(ppkId, 'Отправлено на проверку', chk.status, chk.status === 'PASS' ? 'проверка полноты пройдена' : 'пробелов: ' + chk.blocking + ' — утверждение невозможно до устранения', op);
      _audit_(op, 'V65_SUBMIT', 'ППК', ppkId, 'DRAFT', { status: 'REVIEW', check: chk.status }); _endOp_(op);
      return _ok_({ ppkId: ppkId, status: 'REVIEW', check: chk }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v65Html_(ppkId, draft) {
  var p = _v65Get_(ppkId), E = _mcOrgEsc_, secs = _v65Objs_('SEC').filter(function (s) { return String(s.PPKID) === String(ppkId); }).sort(function (a, b) { return a.Sequence - b.Sequence; });
  var acts = _v65Objs_('ACT').filter(function (a) { return String(a.PPKID) === String(ppkId) && _v65On_(a.Active); }), apr = _v65Objs_('APR').filter(function (a) { return String(a.PPKID) === String(ppkId); });
  var h = (draft ? '<div class="bad" style="font-size:12px;font-weight:bold">ПРОЕКТ — не утверждён (' + E(MC_V65_ST_RU[p.Status] || p.Status) + ')</div>' : '') +
    '<div class="muted">Версия ' + E(p.Version) + ' · период ' + E(_v65Fmt_(p.DateFrom)) + ' — ' + E(_v65Fmt_(p.DateTo) || 'до замены') + ' · ' + E(p.PPKID) + '</div>';
  secs.forEach(function (s, i) {
    h += '<h2>' + (i + 1) + '. ' + E(s.SectionName) + '</h2><div style="white-space:pre-wrap">' + E(s.Text || '— не заполнено') + '</div>';
    if (s.SectionCode === 'HACCP' || s.SectionCode === 'VERIFY') return;
    if (s.SectionCode === 'JOURNALS') {
      h += '<h3>Мероприятия производственного контроля</h3><table class="r"><tr><th>№</th><th>Объект</th><th>Показатель</th><th>Норматив</th><th>Периодичность</th><th>Метод</th><th>Ответственный</th><th>Журнал</th><th>Доказательство</th><th>Корректирующее действие</th></tr>' +
        acts.map(function (a, k) { return '<tr><td>' + (k + 1) + '</td><td>' + E(a.Object) + '</td><td>' + E(a.Parameter) + '</td><td>' + E(a.Normative || '—') + '</td><td>' + E(a.Frequency || '—') + '</td><td>' + E(a.Method || '—') + '</td><td>' + E(a.ResponsibleRole || '—') + '</td><td>' + E(a.JournalID || '') + '</td><td>' + E(a.EvidenceType) + '</td><td>' + E(a.CorrectiveAction || '') + '</td></tr>'; }).join('') + '</table>';
    }
    if (s.SectionCode === 'APPROVAL') h += '<table class="r"><tr><th>Этап</th><th>Решение</th><th>Сотрудник</th><th>Роль</th><th>Дата</th><th>Комментарий</th></tr>' + apr.map(function (a) { return '<tr><td>' + E(a.Stage) + '</td><td>' + E(a.Decision) + '</td><td>' + E(a.EmployeeName) + '</td><td>' + E(a.Role) + '</td><td>' + E(_v65Fmt_(a.DateTime)) + '</td><td>' + E(String(a.Comment || '').slice(0, 300)) + '</td></tr>'; }).join('') + '</table>' +
      '<div class="sign">Утверждаю: ____________________ / ' + E(_mcOrg_().responsibleName || '________________') + '</div>';
  });
  return h;
}
/** PDF ППК (логотип и реквизиты — из настроек). Утверждённая версия — со своим файлом и хешем; черновик — с пометкой «ПРОЕКТ». */
function v65PpkPdf(ppkId, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_view|ppk_edit|ppk_approve', 'V65_PDF', 'ППК', ppkId, null); } catch (e) { return _failFrom_(e); }
  try { var p = _v65Get_(ppkId); if (!p) return _v65Fail_(op, 'NOT_FOUND', 'ППК не найдена');
    if (p.FileID && (p.Status === 'APPROVED' || p.Status === 'ACTIVE' || p.Status === 'ARCHIVED')) { _endOp_(op); return _ok_({ fileId: p.FileID, url: DriveApp.getFileById(p.FileID).getUrl(), sha256: p.Hash, approved: true }, op.id); }
    var f = _mcPdfSave_(String(p.Name), _v65Html_(ppkId, true), { fileName: 'ППК v' + p.Version + ' (проект) ' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd HH-mm'), folder: _v65Folder_() });
    _audit_(op, 'V65_PDF', 'ППК', ppkId, null, { fileId: f.fileId, sha256: f.sha256, draft: true }); _endOp_(op); f.approved = false; return _ok_(f, op.id);
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function _v65Folder_() { var pr = PropertiesService.getScriptProperties(), id = pr.getProperty('MC_PPK_FOLDER_ID'); if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} } var f = _docsFolder_().createFolder('ППК'); pr.setProperty('MC_PPK_FOLDER_ID', f.getId()); return f; }
/** Утвердить: только «На проверке» и только при пройденной проверке полноты; выпускается PDF с хешем. */
function v65Approve(json, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_approve', 'V65_APPROVE', 'ППК', null, null); } catch (e) { return _failFrom_(e); }
  try {
    var d = _v64Json_(typeof json === 'string' && !/^\s*\{/.test(json) ? JSON.stringify({ ppkId: json }) : json);
    return _withLock_(function () {
      var p = _v65Get_(d.ppkId); if (!p) return _v65Fail_(op, 'NOT_FOUND', 'ППК не найдена');
      if (p.Status !== 'REVIEW') return _v65Fail_(op, 'VALIDATION', 'Утверждается версия «На проверке» (сейчас «' + (MC_V65_ST_RU[p.Status] || p.Status) + '»)');
      var chk = _v65Check_(d.ppkId);
      if (chk.status !== 'PASS') { _v65Approval_(d.ppkId, 'Утверждение', 'REFUSED', 'не пройдена проверка полноты: ' + chk.checks.filter(function (x) { return x.status !== 'PASS'; }).map(function (x) { return x.title; }).join('; '), op);
        _endOp_(op, 'FAILED'); return JSON.stringify({ success: false, error: { code: 'PPK_REVIEW', message: 'ППК остаётся «На проверке»: не пройдено проверок — ' + chk.blocking + '. ' + chk.checks.filter(function (x) { return x.status !== 'PASS'; }).map(function (x) { return x.title + ' (' + x.issues.slice(0, 2).join('; ') + ')'; }).join(' · '), operation_id: op.id }, data: { check: chk } }); }
      var w = _v65Who_(op);
      _v65SetCell_('PPK', p._row, 'ApprovedBy', w.name + (w.role ? ', ' + w.role : '')); _v65SetCell_('PPK', p._row, 'ApprovedAt', new Date()); _v65SetCell_('PPK', p._row, 'Status', 'APPROVED');
      _v65Approval_(d.ppkId, 'Утверждение', 'APPROVED', d.comment || '', op);
      var f = _mcPdfSave_(String(p.Name), _v65Html_(d.ppkId, false), { fileName: 'ППК v' + p.Version + ' утверждена ' + Utilities.formatDate(new Date(), _mcTz_(), 'yyyy-MM-dd'), folder: _v65Folder_() });
      _v65SetCell_('PPK', p._row, 'FileID', f.fileId); _v65SetCell_('PPK', p._row, 'Hash', f.sha256);
      _v65Approval_(d.ppkId, 'Выпуск PDF', 'ISSUED', f.name, op, f.fileId, f.sha256);
      _audit_(op, 'V65_APPROVE', 'ППК', d.ppkId, 'REVIEW', { status: 'APPROVED', fileId: f.fileId, sha256: f.sha256 }); _endOp_(op);
      return _ok_({ ppkId: d.ppkId, status: 'APPROVED', fileId: f.fileId, url: f.url, sha256: f.sha256, note: 'Утверждена. Введите в действие — прежняя действующая версия уйдёт в архив.' }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v65Return(json, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_approve', 'V65_RETURN', 'ППК', null, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v64Json_(json); if (!String(d.comment || '').trim()) return _v65Fail_(op, 'VALIDATION', 'Укажите, что доработать');
    return _withLock_(function () { var p = _v65Get_(d.ppkId); if (!p || p.Status !== 'REVIEW') return _v65Fail_(op, 'VALIDATION', 'Вернуть на доработку можно версию «На проверке»');
      _v65SetCell_('PPK', p._row, 'Status', 'DRAFT'); _v65Approval_(d.ppkId, 'Возврат на доработку', 'RETURNED', d.comment, op);
      _audit_(op, 'V65_RETURN', 'ППК', d.ppkId, 'REVIEW', { status: 'DRAFT', comment: d.comment }); _endOp_(op); return _ok_({ ppkId: d.ppkId, status: 'DRAFT' }, op.id); });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Ввести в действие: одна действующая версия на период — пересекающаяся действующая уходит в архив; строится график. */
function v65Activate(ppkId, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_approve', 'V65_ACTIVATE', 'ППК', ppkId, null); } catch (e) { return _failFrom_(e); }
  try {
    return _withLock_(function () {
      var p = _v65Get_(ppkId); if (!p) return _v65Fail_(op, 'NOT_FOUND', 'ППК не найдена'); if (p.Status !== 'APPROVED') return _v65Fail_(op, 'VALIDATION', 'В действие вводится утверждённая версия');
      var from = _v64Date_(p.DateFrom) || new Date(), archived = [];
      _v65Objs_('PPK').forEach(function (x) { if (x.PPKID === p.PPKID || x.Status !== 'ACTIVE') return; var to = _v64Date_(x.DateTo);
        if (!to || to >= from) { _v65SetCell_('PPK', x._row, 'Status', 'ARCHIVED'); _v65SetCell_('PPK', x._row, 'DateTo', new Date(from.getTime() - 86400000)); _v65Approval_(x.PPKID, 'Архивирование', 'ARCHIVED', 'заменена версией ' + p.Version, op); archived.push(x.PPKID); } });
      // задачи архивных версий с датой с момента ввода новой версии отменяются (история выполненных сохраняется)
      var cancelled = 0; _v65Objs_('SCH').forEach(function (sc) { if (archived.indexOf(sc.PPKID) < 0) return; var dd = _v64Date_(sc.DueDate);
        if ((String(sc.Status) === 'PLANNED' && dd && dd >= from) || String(sc.Status) === 'EVENT_RULE') { _v65SetCell_('SCH', sc._row, 'Status', 'CANCELLED'); cancelled++; } });
      _v65SetCell_('PPK', p._row, 'Status', 'ACTIVE'); _v65Approval_(ppkId, 'Ввод в действие', 'ACTIVE', (archived.length ? 'в архив: ' + archived.join(', ') : '') + (cancelled ? '; отменено задач прежней версии: ' + cancelled : ''), op);
      PropertiesService.getScriptProperties().setProperty('MC_ORG_PPK', String(ppkId));
      var sch = _v65BuildSchedule_(ppkId, null, null);
      // этап 5: чек-листы и способ исполнения мероприятий действующей ППК (задачи — на экране «Сейчас»)
      if (typeof _clgBuild_ === 'function') { try { _clgBuild_(); } catch (e) { _log_('WARN', 'чек-листы ППК: ' + e.message); } }
      _audit_(op, 'V65_ACTIVATE', 'ППК', ppkId, 'APPROVED', { status: 'ACTIVE', archived: archived, schedule: sch.created }); _endOp_(op);
      return _ok_({ ppkId: ppkId, status: 'ACTIVE', archived: archived, scheduleCreated: sch.created }, op.id);
    });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
function v65Archive(json, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_approve', 'V65_ARCHIVE', 'ППК', null, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v64Json_(json); if (!String(d.comment || '').trim()) return _v65Fail_(op, 'VALIDATION', 'Укажите причину архивирования');
    return _withLock_(function () { var p = _v65Get_(d.ppkId); if (!p || p.Status === 'ARCHIVED') return _v65Fail_(op, 'VALIDATION', 'Версия не найдена или уже в архиве');
      _v65SetCell_('PPK', p._row, 'Status', 'ARCHIVED'); if (!p.DateTo) _v65SetCell_('PPK', p._row, 'DateTo', new Date()); _v65Approval_(d.ppkId, 'Архивирование', 'ARCHIVED', d.comment, op);
      _audit_(op, 'V65_ARCHIVE', 'ППК', d.ppkId, p.Status, { status: 'ARCHIVED', comment: d.comment }); _endOp_(op); return _ok_({ ppkId: d.ppkId, status: 'ARCHIVED' }, op.id); });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- график ---------------- */
function _v65Interval_(f) {
  var s = String(f || '').toLowerCase(), m;
  if (/при |кажд(ая|ой|ую) парт|каждой приёмк|при каждом|по событию|по сроку/.test(s)) return 0;
  if ((m = /раз в\s*(\d+)\s*(дн|сут)/.exec(s))) return +m[1];
  if ((m = /каждые\s*(\d+)\s*(дн|сут)/.exec(s))) return +m[1];
  if (/ежедневн|в день|daily|ежедн/.test(s)) return 1; if (/еженедел|weekly|раз в неделю/.test(s)) return 7; if (/ежемесяч|раз в месяц|monthly/.test(s)) return 30;
  if (/ежекварт|раз в квартал/.test(s)) return 91; if (/полгода|раз в 6 мес/.test(s)) return 182; if (/ежегод|раз в год|yearly/.test(s)) return 365;
  return 0;
}
function _v65BuildSchedule_(ppkId, from, to) {
  var p = _v65Get_(ppkId), acts = _v65Objs_('ACT').filter(function (a) { return String(a.PPKID) === String(ppkId) && _v65On_(a.Active); });
  var now = new Date(), f = _v64Date_(from) || new Date(Math.max((_v64Date_(p.DateFrom) || now).getTime(), new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()));
  var t = _v64Date_(to) || new Date(f.getTime() + 31 * 86400000), pt = _v64Date_(p.DateTo); if (pt && pt < t) t = pt;
  f = new Date(f.getFullYear(), f.getMonth(), f.getDate()); t = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  var have = {}; _v65Objs_('SCH').forEach(function (s) { var dd = _v64Date_(s.DueDate); have[s.ControlPlanID + '|' + (dd ? _v64Day_(dd) : 'EVENT')] = 1; });
  var rows = [];
  // событийные мероприятия («при каждой приёмке», «по событию», «по сроку»): одна строка-правило без даты, исполнение —
  // по факту события (журналы, автозаписи); не превращаются в ежедневные задачи и не теряются из графика
  acts.forEach(function (a) { if (_v65Interval_(a.Frequency) || !String(a.Frequency || '').trim()) return; var k = a.ControlPlanID + '|EVENT'; if (have[k]) return; have[k] = 1;
    rows.push(['SCH-' + Utilities.getUuid().slice(0, 8).toUpperCase(), ppkId, a.ControlPlanID, 'по событию: ' + String(a.Frequency).slice(0, 60), '', a.ResponsibleRole || '', 'EVENT_RULE', '', '', '', '']); });
  acts.forEach(function (a) { var iv = _v65Interval_(a.Frequency); if (!iv) return;
    for (var d = new Date(f); d <= t; d = new Date(d.getTime() + iv * 86400000)) { var k = a.ControlPlanID + '|' + _v64Day_(d); if (have[k]) continue; have[k] = 1;
      rows.push(['SCH-' + Utilities.getUuid().slice(0, 8).toUpperCase(), ppkId, a.ControlPlanID, iv === 1 ? 'день' : iv === 7 ? 'неделя' : iv >= 28 && iv <= 31 ? 'месяц' : iv + ' дн.', d, a.ResponsibleRole || '', 'PLANNED', '', '', '', '']); } });
  if (rows.length) _v65Sh_('SCH').getRange(_v65Sh_('SCH').getLastRow() + 1, 1, rows.length, MC_V65.SCH[1].length).setValues(rows);
  return { created: rows.length, from: _v64Day_(f), to: _v64Day_(t) };
}
function v65BuildSchedule(json, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_edit|ppk_approve', 'V65_SCHEDULE', 'ППК', null, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v64Json_(json); return _withLock_(function () { var p = _v65Get_(d.ppkId); if (!p || (p.Status !== 'ACTIVE' && p.Status !== 'APPROVED')) return _v65Fail_(op, 'VALIDATION', 'График строится для утверждённой или действующей ППК');
    var r = _v65BuildSchedule_(d.ppkId, d.from, d.to); _audit_(op, 'V65_SCHEDULE', 'ППК', d.ppkId, null, r); _endOp_(op); return _ok_(r, op.id); }); } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}
/** Есть ли запись журнала в день (поиск по колонке «Дата» листа журнала). */
function _v65JournalHas_(jid, day) {
  try { var j = (JOURNALS || []).filter(function (x) { return x.id === jid; })[0]; if (!j) return '';
    var sh = _book_().getSheetByName(j.sheetName); if (!sh || sh.getLastRow() < 2) return '';
    var v = sh.getDataRange().getValues(), c = v[0].map(String).indexOf('Дата'); if (c < 0) return '';
    for (var i = v.length - 1; i >= 1; i--) { var d = _v64Date_(v[i][c]); if (d && _v64Day_(d) === day) return jid + ':' + (i + 1); } } catch (e) {}
  return '';
}
/** График с фактическим состоянием: выполнено (запись журнала, протокол, отметка), просрочено, запланировано. */
function _v65ScheduleState_(ppkId, from, to) {
  var acts = {}; _v65Objs_('ACT').forEach(function (a) { acts[a.ControlPlanID] = a; });
  var labs = _v65Rows_('Лаборатория_Исследования'), today = _v64Day_(new Date()), out = [];
  _v65Objs_('SCH').filter(function (s) { return String(s.PPKID) === String(ppkId); }).forEach(function (s) {
    var dd = _v64Date_(s.DueDate), day = dd ? _v64Day_(dd) : ''; if (from && day < from) return; if (to && day > to) return;
    if (String(s.Status) === 'CANCELLED') return;
    var a = acts[s.ControlPlanID] || {}, st = String(s.Status), ev = s.FactID || '';
    if (st !== 'DONE' && a.JournalID && day <= today) { ev = /^LAB:/.test(a.JournalID) ? (labs.filter(function (l) { var sd = _v64Date_(l.SamplingDate || l['Дата отбора']); return (String(l.PlanID || l['ID плана']) === a.JournalID.slice(4)) && sd && _v64Day_(sd) <= day && _v64Day_(sd) > _v64Day_(new Date(dd.getTime() - (_v65Interval_(a.Frequency) || 1) * 86400000)); })[0] || {}).ResearchID || '' : _v65JournalHas_(a.JournalID, day); if (ev) st = 'DONE'; }
    if (st === 'PLANNED' && day < today) st = 'OVERDUE';
    out.push({ scheduleId: s.ScheduleID, controlPlanId: s.ControlPlanID, object: a.Object || '', parameter: a.Parameter || '', due: day, period: s.Period, role: s.AssignedTo, status: st, evidence: ev, completedBy: s.CompletedBy || '', journal: a.JournalID || '' });
  });
  return out.sort(function (x, y) { return x.due < y.due ? -1 : x.due > y.due ? 1 : 0; });
}
function v65GetSchedule(ppkId, fromDate, toDate, token) {
  try { _requireAuth_(token, 'ppk_view|ppk_edit|ppk_approve|journals'); var items = _v65ScheduleState_(ppkId, fromDate ? _v64Day_(_v64Date_(fromDate)) : '', toDate ? _v64Day_(_v64Date_(toDate)) : '');
    var c = { PLANNED: 0, DONE: 0, OVERDUE: 0 }; items.forEach(function (x) { c[x.status] = (c[x.status] || 0) + 1; });
    return _ok_({ ppkId: ppkId, counts: c, items: items }); } catch (e) { return _failFrom_(e); }
}
/** Отметить выполнение мероприятия с доказательством (FactID, номер акта/протокола) — запись делает сотрудник, не технический доступ. */
function v65CompleteScheduleItem(json, token) {
  var op = null; try { op = _beginOp_(token, 'ppk_edit|journals|haccp', 'V65_DONE', 'ППК', null, null); } catch (e) { return _failFrom_(e); }
  try { var d = _v64Json_(json); if (!String(d.evidence || '').trim()) return _v65Fail_(op, 'VALIDATION', 'Укажите доказательство: номер записи журнала, акта или протокола');
    return _withLock_(function () { var s = _v65Objs_('SCH').filter(function (x) { return x.ScheduleID === d.scheduleId; })[0]; if (!s) return _v65Fail_(op, 'NOT_FOUND', 'Пункт графика не найден');
      if (String(s.Status) === 'DONE') return _v65Fail_(op, 'VALIDATION', 'Пункт уже выполнен');
      if (String(s.Status) === 'EVENT_RULE') return _v65Fail_(op, 'VALIDATION', 'Событийное мероприятие исполняется записью события (приёмка, производство, журнал), а не отметкой в графике');
      if (String(s.Status) === 'CANCELLED') return _v65Fail_(op, 'VALIDATION', 'Пункт отменён: относится к архивной версии ППК');
      if (typeof _clgTaskFor_ === 'function' && _clgTaskFor_(s.PPKID, s.ControlPlanID)) return _v65Fail_(op, 'VALIDATION', 'Мероприятие исполняется на экране «Сейчас» по чек-листу — отметка в графике ставится автоматически по факту выполнения');
      var due = _v64Date_(s.DueDate); if (due && due > new Date()) return _v65Fail_(op, 'VALIDATION', 'Срок пункта ещё не наступил — выполнение не отмечается заранее');
      var w = _v65Who_(op); _v65SetCell_('SCH', s._row, 'Status', 'DONE'); _v65SetCell_('SCH', s._row, 'FactID', String(d.evidence)); _v65SetCell_('SCH', s._row, 'CompletedAt', new Date()); _v65SetCell_('SCH', s._row, 'CompletedBy', w.name);
      if (d.deviationId) _v65SetCell_('SCH', s._row, 'DeviationID', String(d.deviationId));
      _audit_(op, 'V65_DONE', 'ППК_График', d.scheduleId, s.Status, { status: 'DONE', evidence: d.evidence }); _endOp_(op); return _ok_({ scheduleId: d.scheduleId, status: 'DONE' }, op.id); });
  } catch (e) { _endOp_(op, 'FAILED'); return _failFrom_(e, op && op.id); }
}

/* ---------------- чтение ---------------- */
function v65GetPpkList(token) {
  try { _requireAuth_(token, 'ppk_view|ppk_edit|ppk_approve');
    return _ok_({ items: _v65Objs_('PPK').map(function (p) { return { ppkId: p.PPKID, name: p.Name, version: p.Version, from: _v65Fmt_(p.DateFrom), to: _v65Fmt_(p.DateTo), status: p.Status, statusRu: MC_V65_ST_RU[p.Status] || p.Status,
      responsible: p.Responsible, approvedBy: p.ApprovedBy, approvedAt: _v65Fmt_(p.ApprovedAt), fileId: p.FileID, hash: p.Hash }; }).reverse(), wizard: MC_V65_WIZARD.map(function (w) { return { step: w[0], source: w[1], section: w[2] }; }) });
  } catch (e) { return _failFrom_(e); }
}
function v65GetPpk(ppkId, token) {
  try { _requireAuth_(token, 'ppk_view|ppk_edit|ppk_approve'); var p = _v65Get_(ppkId); if (!p) return _fail_('NOT_FOUND', 'ППК не найдена');
    var fmtRow = function (o) { var x = {}; Object.keys(o).forEach(function (k) { if (k !== '_row') { var v = o[k]; x[k] = Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, _mcTz_(), 'yyyy-MM-dd HH:mm') : v; } }); return x; };
    var sched = _v65ScheduleState_(ppkId, '', ''), cnt = { PLANNED: 0, DONE: 0, OVERDUE: 0 }; sched.forEach(function (x) { cnt[x.status] = (cnt[x.status] || 0) + 1; });
    return _ok_({ ppk: fmtRow(p), statusRu: MC_V65_ST_RU[p.Status] || p.Status, sections: _v65Objs_('SEC').filter(function (s) { return String(s.PPKID) === String(ppkId); }).sort(function (a, b) { return a.Sequence - b.Sequence; }).map(fmtRow),
      activities: _v65Objs_('ACT').filter(function (a) { return String(a.PPKID) === String(ppkId); }).map(fmtRow), approvals: _v65Objs_('APR').filter(function (a) { return String(a.PPKID) === String(ppkId); }).map(fmtRow),
      schedule: { counts: cnt, overdue: sched.filter(function (x) { return x.status === 'OVERDUE'; }).slice(0, 100) }, check: _v65Check_(ppkId), wizard: MC_V65_WIZARD.map(function (w) { return { step: w[0], source: w[1], section: w[2] }; }) });
  } catch (e) { return _failFrom_(e); }
}
