// Генерация машинных артефактов ТЗ 2.0 §21 из кода (схема, дерево Диска, правила сверки, профили импорта, карта миграции).
// Запуск: node tools/gen_artifacts_2.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..'), out = path.join(root, 'docs', '2.0');
const ctx = vm.createContext({ console });
['TS2_Schema.gs', 'TS2_Core.gs', 'TS2_Reconcile.gs', 'TS2_Documents.gs', 'TS2_Ready.gs', 'TS2_Generate.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, 'app', f), 'utf8'), ctx, { filename: f }));
const A = vm.createContext({ console }); fs.readdirSync(path.join(root, 'admin')).filter(f => /^(Config|Control)\.gs$/.test(f)).forEach(f => vm.runInContext(fs.readFileSync(path.join(root, 'admin', f), 'utf8'), A, { filename: f }));
const S = vm.runInContext('TS2_ENTERPRISE_SCHEMA_', ctx), ver = vm.runInContext('TS2_SCHEMA_VERSION', ctx);
// ENTERPRISE_SCHEMA
let md = `# ENTERPRISE_SCHEMA_2.0 — схема контура предприятия\n\nВерсия схемы: **${ver}**. Сформировано из \`app/TS2_Schema.gs\` (\`node tools/gen_artifacts_2.js\`).\n\n` +
  'Листы создаются функцией «Проверить структуру 2.0» (или `ts2InstallSchema`) в таблице предприятия. Повторный запуск не создаёт дублей; недостающие колонки дописываются справа. ' +
  'Существующие листы ЦЕХ Стандарт (Блюда, Состав, Сотрудники, журналы и т. д.) не переименовываются и не меняются — их читают адаптеры (раздел «Совместимость»).\n\n| Лист | Раздел ТЗ | Префикс ID | Колонки |\n|---|---|---|---|\n';
Object.keys(S).forEach(k => { const d = S[k]; md += `| ${k} | ${d.group || ''} | ${d.prefix ? d.prefix + (d.yearly ? '-ГГГГ-000001' : '-000001') : '—'} | ${d.head.join(', ')} |\n`; });
md += '\n## Совместимость: существующие листы → сущности 2.0\n\n| Лист | Сущность |\n|---|---|\n' + vm.runInContext('TS2_LEGACY_MAP_', ctx).map(m => `| ${m[0]} | ${m[1]} |`).join('\n') + '\n';
md += '\n## Действия и права ролей (ROLE_PERMISSIONS)\n\n| Действие | Право роли в системе |\n|---|---|\n' + Object.entries(vm.runInContext('TS2_ACTIONS_', ctx)).map(([a, p]) => `| ${a} | ${p} |`).join('\n') + '\n';
fs.writeFileSync(path.join(out, 'ENTERPRISE_SCHEMA_2.0.md'), md);
// CONTROL_SCHEMA
const SH = vm.runInContext('SHEETS', A);
let cm = '# CONTROL_SCHEMA_2.0 — схема управляющего контура (админ-панель)\n\nСформировано из `admin/Config.gs`. Управляющий контур хранит только служебные сведения о предприятиях: ' +
  'лицензии (ключ — хешем и маской), подписки, платежи, релизы, задания обновления, обращения и согласия. Рабочие данные предприятия (ТТК, журналы, сотрудники) сюда не попадают.\n\n| Лист | Колонки |\n|---|---|\n';
Object.keys(SH).forEach(k => { cm += `| ${k} | ${SH[k].join(', ')} |\n`; });
cm += '\n## Роли администраторов\n\n| Роль | Права |\n|---|---|\n' + Object.entries(vm.runInContext('ROLES', A)).map(([k, r]) => `| ${r.name} (${k}) | ${r.can.join(', ')} |`).join('\n') + '\n';
cm += '\n## API (doPost)\n\n| action | Защита | Назначение |\n|---|---|---|\n| license.check | одноразовый nonce, ответ подписан HMAC-SHA256 | статус, тариф, возможности, enterpriseId, льготный период, команды, запросы поддержки, доступный релиз |\n' +
  '| ttk.library | HMAC(key\\|ts), окно 10 мин, повтор подписи отклоняется | база отработанных ТТК (Pro Max) |\n| release.check | то же | доступная версия в канале предприятия |\n| support.request | то же | обращение в поддержку |\n| support.consent | то же | решение предприятия по запросу доступа (CONSENTS) |\n' +
  '| usage.report | то же | обезличенная статистика (AGGREGATED_USAGE) |\n| tech.event | то же | технические ошибки (TECH_EVENTS) |\n| reconciliation.template | то же | эталонные правила сверки и профили импорта |\n| seed.package | то же | пакет первоначальной настройки |\n| api.clients | API-ключ (хеш в API_Keys) | список клиентов для внешних систем |\n| ?hook=payment&t=… | токен + подпись провайдера + WEBHOOK_EVENTS (повтор не обрабатывается) | уведомления ЮMoney/ЮKassa |\n';
fs.writeFileSync(path.join(out, 'CONTROL_SCHEMA_2.0.md'), cm);
// DRIVE_TREE
const T = vm.runInContext('TS2_DRIVE_TREE_', ctx), kids = p => T.filter(t => t[1] === p);
let tree = 'DRIVE_TREE_2.0 — дерево папок предприятия на Google Диске (app/TS2_Core.gs, TS2_DRIVE_TREE_)\nКаждая папка создаётся по принципу «найти или создать»; ID хранится в листе DRIVE_REGISTRY.\n\n';
const walk = (code, pre) => { const t = T.find(x => x[0] === code); tree += pre + t[2] + '   [' + t[0] + ']\n'; kids(code).forEach((k, i) => walk(k[0], pre.replace(/[├└]── $/, (m) => m[0] === '├' ? '│   ' : '    ') + (i === kids(code).length - 1 ? '└── ' : '├── '))); };
walk('ROOT', '');
tree += '\nПодпапки модулей (TS_DriveTree.gs; прежние папки в корне Диска переносятся сюда один раз, содержимое не копируется, а перемещается):\n' +
  '  00_Входящие_документы / Бланки заявок      — фото бланков банкетов\n' +
  '  01_Организация / Документы                 — документы предприятия\n' +
  '  03_Продукты_и_Поставщики / Накладные        — фото накладных\n' +
  '  03_Продукты_и_Поставщики / Документы на сырьё — декларации, сертификаты, ВСД\n' +
  '  06_ХАССП_и_ППК / Пакеты проверки           — пакеты для проверяющего\n' +
  '  06_ХАССП_и_ППК / ТУ, СТО, ППК              — документы из ТТК (2.2)\n' +
  '  12_Журналы / Листы журналов                — листы журналов J01–J53; бланки месяца — в самой папке\n' +
  '  14_Резервные_копии                         — копии таблицы (BACKUP ЦЕХ Стандарт …)\n' +
  '  99_Архив / <Месяц ГГГГ г>                  — архив месяца: журналы-бланки, реестры, файлы, «журналы событий», манифест\n' +
  '  00_Система / exports                        — выгрузки ТТК и отчётов\n' +
  '\nРабочие данные (журналы событий, склад, партии, ТТК, сотрудники) — в таблице предприятия: ей нужны поиск, одновременная запись\n' +
  'и блокировки, которых нет у файлов в папках. Журналы событий старше двух месяцев выносятся в архив месяца.\n';
fs.writeFileSync(path.join(out, 'DRIVE_TREE_2.0.txt'), tree);
// RECONCILIATION_RULES
fs.writeFileSync(path.join(out, 'RECONCILIATION_RULES_2.0.json'), JSON.stringify({ version: '2.0.0', source: 'app/TS2_Reconcile.gs', severities: ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR'], rules: vm.runInContext('TS2_RULES_', ctx) }, null, 2) + '\n');
// IMPORT_PROFILES
let classify = []; try { classify = vm.runInContext('TS2_CLASSIFY_', ctx); } catch (e) {}
fs.writeFileSync(path.join(out, 'IMPORT_PROFILES_2.0.json'), JSON.stringify({ version: '2.0.0', source: 'app/TS2_Documents.gs, admin/Control.gs', confidence: vm.runInContext('typeof TS2_CONF_!=="undefined"?TS2_CONF_:{}', ctx),
  classification: classify.map(c => Array.isArray(c) ? c.map(x => x instanceof RegExp || (x && x.source !== undefined && x.flags !== undefined) ? String(x) : x) : c), profiles: vm.runInContext('MASTER_IMPORT_PROFILES_', A).map(p => ({ profileId: p[0], documentType: p[1], fields: p[2], minConfidence: p[3] })),
  generationThresholds: vm.runInContext('TS2_GEN_CONF_', ctx), fieldFormat: '{value, raw, confidence, method, sourcePage, requiresReview}' }, null, 2) + '\n');
// MIGRATION_MAP
const M = vm.runInContext('TS2_MIGRATE_', ctx);
let csv = 'sourceSheet,entityType,idPrefix,sourceKeyColumn,newIdFormat,legacySheetChanged\n' + M.map(m => [m[0], m[1], m[2], 'A (первая колонка)', m[2] + '-ГГГГ-000001', 'нет'].join(',')).join('\n') + '\n';
fs.writeFileSync(path.join(out, 'MIGRATION_MAP_2.0.csv'), '﻿' + csv);
console.log('Артефакты 2.0 сформированы в docs/2.0');
