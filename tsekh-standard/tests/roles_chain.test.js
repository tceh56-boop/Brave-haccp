/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// Права ролей на функции цепочки контроля (Мастер-промт 4.0) — так, как их проверяет шлюз: строго по матрице ролей (_mcRbHasExact_).
// Ловит расхождение «руководство говорит — ответственный за ХАССП, а право есть только у директора». Запуск: node tests/roles_chain.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const app = path.join(__dirname, '..', 'app'), read = f => fs.readFileSync(path.join(app, f), 'utf8');
const ts = vm.runInNewContext(/var TS_GATE_ = (\[[\s\S]*?\n\]);/.exec(read('TS_Subscription.gs'))[1]);
const ctx = vm.createContext({}); vm.runInContext(read('MonChef_Rbac.gs'), ctx);
const M = vm.runInContext('MC_RB_MATRIX_', ctx);
const need = n => { const g = ts.find(x => x.n === n); assert(g, 'нет в шлюзе: ' + n); return g.need; };
const can = (role, n) => String(need(n)).split('|').some(k => (M[role] || []).indexOf(k.trim()) >= 0);
const D = 'Директор', H = 'Ответственный за ХАССП', S = 'Шеф-повар', P = 'Повар горячего цеха', A = 'Администратор';
const expect = [
  ['haccpHazardDecide', [D, H], [S, P, A]], ['haccpLinkSync', [D, H], [P, A]], ['ttkProcAnalyze', [D, H, S], [P, A]], ['ttkProcReview', [D, S], [P, A]],
  ['ttkProcDictionarySave', [D, H, S], [P, A]], ['ppkLegacyImport', [D, H], [S, P, A]], ['clgBuild', [H], [P, A]],
  ['vioCorrect', [H, S, P], [A]], ['vioVerify', [D, H, S], [A]], ['vioSetVerifyMode', [D], [H, S, P, A]],
  ['a360Run', [D, H, S], [P, A]], ['a360MigrateViolations', [D, H], [S, P, A]], ['a360Evidence', [D, H, S], [P, A]]];
let n = 0;
expect.forEach(([fn, yes, no]) => {
  yes.forEach(r => assert(can(r, fn), fn + ': должна быть доступна роли «' + r + '» (право ' + need(fn) + ')'));
  no.forEach(r => assert(!can(r, fn), fn + ': не должна быть доступна роли «' + r + '» (право ' + need(fn) + ')')); n++;
});
// утверждение и ввод ППК — только директор (функции V65 в карте шлюза MonChef)
const gate = read('zzz_MonChef_Gate.gs'), NEED = JSON.parse(/var MC_GATE_NEED_ = (\{[^}]*\})/.exec(gate)[1]);
['v65Approve', 'v65Activate'].forEach(fn => { const k = String(NEED[fn]).split('|'); assert(k.some(x => M[D].includes(x)) && !k.some(x => M[H].includes(x)), fn + ': ' + NEED[fn]); n++; });
console.log('roles_chain: ' + n + ' проверок прав пройдено');
