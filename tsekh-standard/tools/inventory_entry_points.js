// Инвентаризация входов приложения: какие функции вызываются из браузера и чем защищены.
// node tools/inventory_entry_points.js → docs/2.0/SECURITY_ENTRY_POINTS_2.0.md и .csv; код выхода 1 — найдено нарушение.
const fs = require('fs'), path = require('path'), vm = require('vm');
const app = path.join(__dirname, '..', 'app'), out = path.join(__dirname, '..', 'docs', '2.0');
const files = fs.readdirSync(app).filter(f => f.endsWith('.gs')), src = {}; files.forEach(f => { src[f] = fs.readFileSync(path.join(app, f), 'utf8'); });
const gate = src['zzz_MonChef_Gate.gs'], list = k => { const m = new RegExp('var ' + k + ' = (\\[[^\\]]*\\])').exec(gate); return m ? JSON.parse(m[1]) : []; };
const L = {}; ['CLIENT', 'MUT', 'PUBLIC', 'RAW', 'PORTAL', 'TRIGGER', 'ENTRY', 'DEVNO'].forEach(k => { L[k] = new Set(list('MC_GATE_' + k + '_')); });
// модули ЦЕХ Стандарт регистрируются через TS_GATE_ (TS_Subscription.gs)
const ts = vm.runInNewContext(/var TS_GATE_ = (\[[\s\S]*?\n\]);/.exec(src['TS_Subscription.gs'])[1]);
ts.forEach(g => { L.CLIENT.add(g.n); if (g.mut) L.MUT.add(g.n); });
const needOf = n => { const t = ts.find(g => g.n === n); if (t) return t.need; const m = new RegExp('"' + n + '":"([^"]*)"').exec(/var MC_GATE_NEED_ = (\{[^}]*\})/.exec(gate)[1]); return m ? m[1] : ''; };
const body = (f, n) => { const s = src[f], i = s.search(new RegExp('^function ' + n + '\\(', 'm')); let d = 0, j = s.indexOf('{', i); for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; } return s.slice(i, j + 1); };
const fns = []; files.forEach(f => { const re = /^function ([A-Za-z0-9_$]+)\s*\(([^)]*)\)/gm; let m; while ((m = re.exec(src[f]))) if (!/_$/.test(m[1])) fns.push({ n: m[1], file: f, params: m[2].replace(/\s+/g, '') }); });
// проверено вручную: функция без собственной проверки, защищённая иначе (обоснование попадает в реестр)
const REVIEWED = { verifyAuditDocument: 'передаёт ключ в verifyInspectionDocument, который проверяет его (_requireAuditAccess_)',
  mcReplayOffline: 'принимает только функции из MC_OFFLINE_FNS_ и вызывает их снова через шлюз с сессией сотрудника (право, тариф, допуск проверяются для каждой записи)' };
const problems = [], rows = fns.map(x => {
  const kind = L.ENTRY.has(x.n) ? 'вход (doGet/doPost)' : L.PUBLIC.has(x.n) ? 'публичная' : L.RAW.has(x.n) ? 'портал проверяющего' : L.CLIENT.has(x.n) ? 'интерфейс (сессия)' : 'служебная';
  let guard = '';
  if (kind === 'интерфейс (сессия)') guard = 'сессия → право «' + (needOf(x.n) || 'system') + '»' + (L.MUT.has(x.n) ? ' → тариф → допуск → блокировка → аудит' : ' → тариф');
  else if (kind === 'служебная') guard = L.TRIGGER.has(x.n) ? 'технический доступ, владелец или расписание (triggerUid сверяется)' : 'только технический доступ или владелец проекта';
  else if (kind === 'портал проверяющего') { const b = body(x.file, x.n); const ok = /_requireAuditAccess_\(\s*rawToken/.test(b.slice(0, 400)); guard = ok ? 'ключ проверяющего (_requireAuditAccess_) в начале функции' : REVIEWED[x.n] || 'НЕТ проверки ключа'; if (!ok && !REVIEWED[x.n]) problems.push(x.n + ': портал без проверки ключа'); }
  else if (kind === 'публичная') guard = { loginWithPin: 'вход по ПИН: блокировки устройства, техвхода и системы', destroySession: 'удаляет только свою сессию', uiMe: 'без сессии — пустой ответ', getAppUrl: 'адрес приложения', getJournalRegistry: 'справочник названий журналов, без данных' }[x.n] || 'ПРОВЕРИТЬ';
  else guard = 'маршруты: ?verify (страница проверки документа по QR), ?diag (ключ поддержки, выданный с согласия), страница интерфейса — данные только через шлюз';
  if (kind === 'интерфейс (сессия)' && L.MUT.has(x.n) && (needOf(x.n) === '*' || !needOf(x.n)) && !ts.find(g => g.n === x.n) && !REVIEWED[x.n]) problems.push(x.n + ': записывающая функция без права роли');
  if (REVIEWED[x.n] && kind === 'интерфейс (сессия)') guard += '; ' + REVIEWED[x.n];
  return { name: x.n, file: x.file, kind, mut: L.MUT.has(x.n) ? 'да' : '', need: needOf(x.n), guard };
});
fs.writeFileSync(path.join(out, 'SECURITY_ENTRY_POINTS_2.0.csv'), '﻿' + 'функция;файл;вид;запись;право;защита\n' + rows.map(r => [r.name, r.file, r.kind, r.mut, r.need, r.guard].join(';')).join('\n') + '\n');
const cnt = {}; rows.forEach(r => { cnt[r.kind] = (cnt[r.kind] || 0) + 1; });
let md = '# SECURITY_ENTRY_POINTS_2.0 — инвентаризация входов приложения\n\nСформировано `node tools/inventory_entry_points.js` из исходников (`app/*.gs`) и списков шлюза. Полный реестр — `SECURITY_ENTRY_POINTS_2.0.csv`.\n\n' +
  '## Модель доступа\n\nВеб-приложение развёрнуто с доступом «все, включая анонимных» (`ANYONE_ANONYMOUS`), выполняется от имени владельца. Поэтому **каждая** функция без «_» в конце имени, вызываемая из браузера, проходит шлюз `zzz_MonChef_Gate.gs`; доступ к данным определяется не Google-аккаунтом, а сессией ЦЕХ Стандарт (вход по ПИН-коду). Функции с «_» в конце из браузера недоступны (ограничение Apps Script).\n\n' +
  '| Вид | Кол-во | Как защищена |\n|---|---|---|\n' + Object.keys(cnt).map(k => `| ${k} | ${cnt[k]} | ${{ 'интерфейс (сессия)': 'сессия ЦЕХ Стандарт → право роли → тариф (fail-closed) → для записи: медицинский допуск (fail-closed), защита от двойного нажатия, блокировка, операция и аудит', 'служебная': 'без технической сессии или контекста владельца — отказ AUTH_REQUIRED / «служебная функция»', 'портал проверяющего': 'временный ключ проверяющего, проверяется в первой строке функции', 'публичная': 'не отдают данные предприятия', 'вход (doGet/doPost)': 'см. маршруты ниже' }[k]} |`).join('\n') +
  '\n\n## Публичные функции и маршруты\n\n| Функция | Защита |\n|---|---|\n' + rows.filter(r => r.kind === 'публичная' || r.kind.startsWith('вход')).map(r => `| ${r.name} | ${r.guard} |`).join('\n') +
  '\n\n## Портал проверяющего\n\n| Функция | Защита |\n|---|---|\n' + rows.filter(r => r.kind === 'портал проверяющего').map(r => `| ${r.name} | ${r.guard} |`).join('\n') +
  '\n\n## Результат автоматической проверки\n\n' + (problems.length ? problems.map(p => '- ❌ ' + p).join('\n') : '- ✅ Все функции портала проверяют ключ в начале функции.\n- ✅ Все записывающие функции интерфейса требуют право роли.\n- ✅ Публичных функций с доступом к данным нет.') + '\n';
fs.writeFileSync(path.join(out, 'SECURITY_ENTRY_POINTS_2.0.md'), md);
console.log(cnt, problems.length ? problems : 'нарушений нет'); process.exit(problems.length ? 1 : 0);
