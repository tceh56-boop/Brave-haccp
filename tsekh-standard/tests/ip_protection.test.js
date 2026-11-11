/* Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович */
// P1-2, критерий 1: клиент не получает исходный код ядра. В браузер уходят только страницы app/*.html —
// в них не должно быть секретов, подписи лицензии, обращений к серверным сервисам Google и серверных расчётов.
// Запуск: node tests/ip_protection.test.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const app = path.join(__dirname, '..', 'app'), html = fs.readdirSync(app).filter(f => f.endsWith('.html'));
const FORBIDDEN = [/computeHmac/, /LICENSE_SECRET/, /TS_LICENSE_(KEY|SECRET|STATE)/, /getScriptProperties/, /\bUtilities\./, /MASTER_SCRIPT_ID/, /\bSpreadsheetApp\./, /\bDriveApp\./, /\bUrlFetchApp\./, /\bPropertiesService\./];
let bad = [];
html.forEach(f => { const s = fs.readFileSync(path.join(app, f), 'utf8'); FORBIDDEN.forEach(re => { if (re.test(s)) bad.push(f + ': ' + re); }); });
assert.deepStrictEqual(bad, [], 'в страницах браузера — серверный код или секреты:\n' + bad.join('\n'));
// расчёты (себестоимость, сроки после вскрытия, FEFO-списание) — вызовы сервера, а не формулы в браузере
const con = fs.readFileSync(path.join(app, 'Console.html'), 'utf8'), card = fs.readFileSync(path.join(app, 'BatchCard.html'), 'utf8');
assert(/run\('getDishCost'/.test(con) && /call\('calculatePostOpeningExpiry'/.test(card) && /call\('useBatch'/.test(card), 'расчёты выполняет сервер');
// сервер: подпись лицензии и секреты — только в .gs
const gs = fs.readdirSync(app).filter(f => f.endsWith('.gs')).map(f => fs.readFileSync(path.join(app, f), 'utf8')).join('\n');
assert(/function _tsHmac_/.test(gs) && /TS_LICENSE_SECRET/.test(gs));
console.log('OK: страниц браузера ' + html.length + ' — без секретов, подписи лицензии и серверных сервисов; расчёты на сервере');
