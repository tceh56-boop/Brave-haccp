// security patch 0.1: нет встроенного технического PIN; первичная настройка однократная; шлюз fail-closed.
// Запуск: node tests/security_patch_0_1.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const app = path.join(__dirname, '..', 'app'), read = f => fs.readFileSync(path.join(app, f), 'utf8');
// 1. Статически: в коде приложения нет старого кода и его констант
const all = fs.readdirSync(app).filter(f => /\.(gs|html)$/.test(f)).map(read).join('\n');
['2258', 'MC_RB_DEV_PIN_DEFAULT_', 'CREATOR_PIN'].forEach(x => assert(!all.includes(x), 'в коде не должно быть ' + x));
// 2. Поведение функций технического PIN (вырезаются из MonChef_Rbac.gs)
const rbac = read('MonChef_Rbac.gs'), pick = n => { const i = rbac.indexOf('function ' + n + '('); assert(i >= 0, n); let d = 0, j = rbac.indexOf('{', i); for (; j < rbac.length; j++) { if (rbac[j] === '{') d++; else if (rbac[j] === '}' && --d === 0) break; } return rbac.slice(i, j + 1); };
const props = {}, ctx = vm.createContext({ PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); } }) },
  _hashPin_: p => crypto.createHash('sha256').update('pin|' + p).digest('hex') });
vm.runInContext("var MC_RB_DEV_PROP_ = 'MC_DEV_PIN_HASH';\n" + ['_mcRbDevHash_', '_mcRbIsDevPin_', 'mcRbBootstrapDevPin_'].map(pick).join('\n'), ctx);
assert.strictEqual(ctx._mcRbDevHash_(), '', 'без настройки секрета нет');
assert.strictEqual(ctx._mcRbIsDevPin_('2258'), false, 'старый код не открывает вход');
assert.strictEqual(ctx._mcRbIsDevPin_(''), false, 'пустой код не открывает вход');
assert.throws(() => ctx.mcRbBootstrapDevPin_('12345'), /6 цифр/); assert.throws(() => ctx.mcRbBootstrapDevPin_('12a456'), /6 цифр/);
assert(/только хеш/.test(ctx.mcRbBootstrapDevPin_('739215')));
assert(!Object.values(props).includes('739215'), 'открытый PIN не сохраняется');
assert.strictEqual(ctx._mcRbIsDevPin_('739215'), true); assert.strictEqual(ctx._mcRbIsDevPin_('2258'), false);
assert.throws(() => ctx.mcRbBootstrapDevPin_('111222'), /уже настроен/, 'повторная первичная настройка запрещена');
// 3. Шлюз: fail-closed ветви на месте; хук событий 2.1 сохранён
const gate = read('zzz_MonChef_Gate.gs');
assert(/PLAN_CHECK_UNAVAILABLE[\s\S]*typeof pg !== 'string'/.test(gate), 'тариф: сбой проверки → отказ');
assert(/COMPLIANCE_CHECK_UNAVAILABLE/.test(gate) && /typeof cg !== 'string'/.test(gate), 'допуск: сбой проверки → отказ');
assert(/_ts2OnGateCall_/.test(gate), 'хук событий 2.1 не потерян');
console.log('OK: security patch 0.1 — встроенного PIN нет, первичная настройка однократная, шлюз fail-closed');
