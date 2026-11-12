/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// Эталон реестра нормативов для админ-панели — из того же списка, что встроен в систему клиента (app/TS_LaborSafety.gs).
// Запуск: node tools/gen_norms_seed.js  → admin/NormsSeed.gs (не править вручную)
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..'), c = {}; vm.createContext(c);
vm.runInContext(fs.readFileSync(path.join(root, 'app', 'TS_LaborSafety.gs'), 'utf8'), c);
const rows = c.TS_LS_NORMS_.map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7] || '', r[8] || '']);
const out = '/** Сгенерировано tools/gen_norms_seed.js из app/TS_LaborSafety.gs — не править вручную. Версия встроенного реестра: ' + c.TS_LS_NORMS_VER_ + ' */\n' +
  'var MASTER_NORMS_SEED_VER_ = ' + JSON.stringify(c.TS_LS_NORMS_VER_) + ';\n' +
  'var MASTER_NORMS_SEED_ = [\n' + rows.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n];\n';
fs.writeFileSync(path.join(root, 'admin', 'NormsSeed.gs'), out);
console.log('admin/NormsSeed.gs: ' + rows.length + ' документов, версия ' + c.TS_LS_NORMS_VER_);
