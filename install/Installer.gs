/**
 * ЦЕХ — установщик. Вставляется в ПУСТОЙ проект Apps Script (Расширения → Apps Script в таблице).
 * Скачивает все файлы gas/ из GitHub и записывает их в этот же проект через Apps Script API.
 * ВНИМАНИЕ: заменяет ВСЕ файлы проекта (включая этот) содержимым репозитория.
 */
var TSEKH_REPO_ = 'tceh56-boop/Brave-haccp';
var TSEKH_REF_ = 'claude/new-session-jd6imq';

function installTsekh() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());

  var tree = JSON.parse(UrlFetchApp.fetch('https://api.github.com/repos/' + TSEKH_REPO_ + '/git/trees/' + TSEKH_REF_ + '?recursive=1',
    { headers: { Accept: 'application/vnd.github+json' } }).getContentText());
  var paths = tree.tree.filter(function (t) {
    return t.type === 'blob' && /^gas\/[^\/]+\.(gs|html|json)$/.test(t.path);
  }).map(function (t) { return t.path; });
  if (!paths.length) throw new Error('В репозитории не найдено файлов gas/.');

  var responses = UrlFetchApp.fetchAll(paths.map(function (p) {
    return { url: 'https://raw.githubusercontent.com/' + TSEKH_REPO_ + '/' + tree.sha + '/' + encodeURI(p), muteHttpExceptions: true };
  }));
  var files = paths.map(function (p, i) {
    if (responses[i].getResponseCode() !== 200) throw new Error('Не скачан ' + p + ': HTTP ' + responses[i].getResponseCode());
    var base = p.replace(/^gas\//, '');
    var name = base.replace(/\.(gs|html|json)$/, '');
    var type = /\.html$/.test(base) ? 'HTML' : /\.json$/.test(base) ? 'JSON' : 'SERVER_JS';
    return { name: name, type: type, source: responses[i].getContentText() };
  });
  if (!files.some(function (f) { return f.type === 'JSON' && f.name === 'appsscript'; })) throw new Error('Нет gas/appsscript.json.');

  var res = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId() + '/content', {
    method: 'put', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ files: files })
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Apps Script API: HTTP ' + res.getResponseCode() + ' — ' + res.getContentText().slice(0, 500) +
      '\nПроверьте, что Apps Script API включён: https://script.google.com/home/usersettings');
  }
  Logger.log('Установлено файлов: ' + files.length + ' (коммит ' + tree.sha.slice(0, 7) + '). Обновите страницу редактора и запустите setupProduction().');
}
