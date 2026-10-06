/**
 * ЦЕХ — установщик. Вставляется в ПУСТОЙ проект Apps Script (Расширения → Apps Script в таблице).
 * Скачивает все файлы gas/ из GitHub и записывает их в этот же проект через Apps Script API.
 * ВНИМАНИЕ: заменяет ВСЕ файлы проекта (включая этот) содержимым репозитория.
 *
 * Закрытый (private) репозиторий: в «Настройки проекта → Свойства скрипта» добавьте
 *   GITHUB_TOKEN — личный токен GitHub (fine-grained), доступ только к этому репозиторию,
 *                  право Contents: Read-only, с ограниченным сроком действия;
 *   TSEKH_REF    — (необязательно) ветка или коммит, по умолчанию — TSEKH_REF_ ниже.
 * Токен хранится только в свойствах этого проекта и в код не попадает. Свойства видят все,
 * у кого есть доступ на редактирование проекта/таблицы, — после установки токен можно удалить.
 */
var TSEKH_REPO_ = 'tceh56-boop/Brave-haccp';
var TSEKH_REF_ = 'claude/new-session-jd6imq';

function tsekhGithubHeaders_(accept) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  var h = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

function installTsekh() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  if (ss) props.setProperty('SPREADSHEET_ID', ss.getId());
  var ref = props.getProperty('TSEKH_REF') || TSEKH_REF_;

  var treeRes = UrlFetchApp.fetch('https://api.github.com/repos/' + TSEKH_REPO_ + '/git/trees/' + encodeURIComponent(ref) + '?recursive=1',
    { headers: tsekhGithubHeaders_('application/vnd.github+json'), muteHttpExceptions: true });
  if (treeRes.getResponseCode() === 404 || treeRes.getResponseCode() === 401) {
    throw new Error('GitHub не отдал репозиторий (HTTP ' + treeRes.getResponseCode() + '). Если репозиторий закрытый, добавьте в свойства скрипта ' +
      'GITHUB_TOKEN (fine-grained токен с правом Contents: Read-only на ' + TSEKH_REPO_ + '). Проверьте и ветку: ' + ref + '.');
  }
  if (treeRes.getResponseCode() !== 200) throw new Error('GitHub: HTTP ' + treeRes.getResponseCode() + ' — ' + treeRes.getContentText().slice(0, 300));
  var tree = JSON.parse(treeRes.getContentText());
  var paths = tree.tree.filter(function (t) {
    return t.type === 'blob' && /^gas\/[^\/]+\.(gs|html|json)$/.test(t.path);
  }).map(function (t) { return t.path; });
  if (!paths.length) throw new Error('В репозитории не найдено файлов gas/.');

  // Через API, а не raw.githubusercontent.com: так работает и закрытый репозиторий (с токеном).
  var responses = UrlFetchApp.fetchAll(paths.map(function (p) {
    return { url: 'https://api.github.com/repos/' + TSEKH_REPO_ + '/contents/' + p.split('/').map(encodeURIComponent).join('/') + '?ref=' + tree.sha,
      headers: tsekhGithubHeaders_('application/vnd.github.raw'), muteHttpExceptions: true };
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
