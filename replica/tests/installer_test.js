// Установщик install/Installer.gs с закрытым репозиторием (имитация GitHub). Запуск: node replica/tests/installer_test.js
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
function run(props, privateRepo) {
  const calls = [], put = {};
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => body });
  const authOk = h => !privateRepo || (h && h.Authorization === 'Bearer ghp_test');
  const C = { JSON, String, encodeURIComponent, Logger: { log: m => { put.log = m; } },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getId: () => 'SS1' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    ScriptApp: { getScriptId: () => 'SCRIPT', getOAuthToken: () => 'oauth' },
    UrlFetchApp: {
      fetch: (url, o) => {
        calls.push({ url, headers: o && o.headers });
        if (url.indexOf('script.googleapis.com') !== -1) { put.files = JSON.parse(o.payload).files; return resp(200, '{}'); }
        if (!authOk(o.headers)) return resp(404, '{"message":"Not Found"}');
        return resp(200, JSON.stringify({ sha: 'abc1234def', tree: [{ type: 'blob', path: 'gas/appsscript.json' }, { type: 'blob', path: 'gas/Pos.gs' }, { type: 'blob', path: 'qrmenu/Code.gs' }] }));
      },
      fetchAll: reqs => reqs.map(r => { calls.push({ url: r.url, headers: r.headers }); return authOk(r.headers) ? resp(200, '// ' + r.url) : resp(404, ''); })
    } };
  vm.createContext(C);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../install/Installer.gs'), 'utf8'), C);
  try { C.installTsekh(); return { calls, put }; } catch (e) { return { calls, put, error: e.message }; }
}
// 1. Закрытый репозиторий без токена — понятная ошибка.
let r = run({}, true);
assert(/GITHUB_TOKEN/.test(r.error), r.error);
// 2. С токеном и веткой из свойств — файлы через api.github.com с авторизацией, только gas/.
r = run({ GITHUB_TOKEN: 'ghp_test', TSEKH_REF: 'claude/amazing-cori-nctye5' }, true);
assert(!r.error, r.error);
assert(r.calls[0].url.indexOf('/git/trees/claude%2Famazing-cori-nctye5') !== -1);
const files = r.calls.filter(c => c.url.indexOf('/contents/') !== -1);
assert.equal(files.length, 2);
assert(files.every(c => c.url.startsWith('https://api.github.com/repos/tceh56-boop/Brave-haccp/contents/gas/') && c.headers.Authorization === 'Bearer ghp_test'));
assert(!r.calls.some(c => c.url.indexOf('raw.githubusercontent.com') !== -1));
assert.deepEqual(r.put.files.map(f => f.name).sort(), ['Pos', 'appsscript']);
// 3. Публичный репозиторий без токена — работает как раньше.
r = run({}, false);
assert(!r.error, r.error);
console.log('INSTALLER PASSED');
