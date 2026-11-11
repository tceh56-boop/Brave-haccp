/**
 * Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович
 * ЦЕХ Стандарт — Stage 4: контроль целостности tenant-хранилища.
 * Проверяет принадлежность Drive-ресурсов дереву текущего предприятия; ничего не перемещает и не удаляет.
 */
function _ts4Check_(name, fn, out) {
  try { var detail = fn(); out.push({ check: name, status: 'PASS', detail: detail === undefined ? '' : detail }); }
  catch (e) { out.push({ check: name, status: 'FAIL', detail: String(e && e.message || e) }); }
}
function _ts4ParentIds_(item, isFile) {
  var ids = [], it = item.getParents(); while (it.hasNext()) ids.push(it.next().getId()); return ids;
}
function _ts4TenantIntegrity_() {
  var out = [], tenant = typeof _tsTenantMode_ === 'function' && _tsTenantMode_();
  if (!tenant) return { mode: 'LEGACY', status: 'WARN', checks: [{ check: 'TENANT_MODE', status: 'WARN', detail: 'Приложение работает не в tenant-режиме; проверка изоляции SaaS не подтверждена' }] };
  _ts4Check_('TENANT_CONFIG', function () {
    if (!TS_TENANT_CONFIG_ || TS_TENANT_CONFIG_.mode !== '1' || !TS_TENANT_CONFIG_.rootFolderId || !TS_TENANT_CONFIG_.spreadsheetId || !TS_TENANT_CONFIG_.enterpriseId || !TS_TENANT_CONFIG_.ownerEmail) throw new Error('неполная конфигурация tenant');
    return { enterpriseId: TS_TENANT_CONFIG_.enterpriseId, ownerEmail: TS_TENANT_CONFIG_.ownerEmail };
  }, out);
  _ts4Check_('CUSTOMER_ROOT', function () {
    var id = _tsTenantRootId_(), f = DriveApp.getFolderById(id);
    if (f.isTrashed()) throw new Error('корневая папка в корзине');
    var owner = f.getOwner && f.getOwner(), email = owner && owner.getEmail ? String(owner.getEmail()).toLowerCase() : '';
    if (email && TS_TENANT_CONFIG_.ownerEmail && email !== String(TS_TENANT_CONFIG_.ownerEmail).toLowerCase()) throw new Error('владелец корня не совпадает с подтверждённым владельцем');
    if (!email) return { id: id, ownerCheck: 'UNAVAILABLE (Shared Drive или ограничение API)' };
    if (email !== String(TS_TENANT_CONFIG_.ownerEmail).toLowerCase()) throw new Error('владелец корня не подтверждён');
    return { id: id, ownerEmail: email };
  }, out);
  _ts4Check_('CUSTOMER_SPREADSHEET', function () {
    var id = _tsTenantSpreadsheetId_(), f = DriveApp.getFileById(id);
    if (f.isTrashed()) throw new Error('таблица в корзине');
    var parents = _ts4ParentIds_(f, true), rootId = _tsTenantRootId_();
    if (parents.indexOf(rootId) < 0) throw new Error('таблица не находится непосредственно в корне предприятия');
    var owner = f.getOwner && f.getOwner(), email = owner && owner.getEmail ? String(owner.getEmail()).toLowerCase() : '';
    if (email && TS_TENANT_CONFIG_.ownerEmail && email !== String(TS_TENANT_CONFIG_.ownerEmail).toLowerCase()) throw new Error('владелец таблицы не совпадает с подтверждённым владельцем');
    if (email && email !== String(TS_TENANT_CONFIG_.ownerEmail).toLowerCase()) throw new Error('владелец таблицы не подтверждён');
    return { id: id, parent: rootId, ownerCheck: email ? 'PASS' : 'UNAVAILABLE' };
  }, out);
  _ts4Check_('DRIVE_TREE', function () {
    var checked = 0;
    TS2_DRIVE_TREE_.forEach(function (spec) {
      var f = _ts2Folder_(spec[0]);
      if (spec[0] !== 'ROOT') {
        var parent = spec[1] ? _ts2Folder_(spec[1]) : null;
        if (!parent) throw new Error('у папки ' + spec[0] + ' отсутствует родитель');
        var ps = f.getParents(), ok = false; while (ps.hasNext()) if (ps.next().getId() === parent.getId()) ok = true;
        if (!ok) throw new Error('папка ' + spec[0] + ' находится вне ожидаемого родителя');
      }
      checked++;
    });
    return { foldersChecked: checked };
  }, out);
  _ts4Check_('REGISTERED_DOCUMENT_FILES', function () {
    var rows = _ts2Rows_('FILES'), checked = 0, limit = Math.min(rows.length, 500), failures = [];
    for (var i = 0; i < limit; i++) {
      var r = rows[i]; if (!r.googleFileId) continue;
      try { _tsTenantAssertFileWithin_(r.googleFileId, 'INBOX'); checked++; }
      catch (e) { failures.push(String(r.fileId || r.googleFileId)); }
    }
    if (failures.length) throw new Error('файлы вне INBOX: ' + failures.slice(0, 10).join(', '));
    return { checked: checked, total: rows.length, truncated: rows.length > limit };
  }, out);
  _ts4Check_('BACKUP_FILES', function () {
    var rows = _ts2Rows_('BACKUP_CATALOG'), checked = 0, failures = [];
    rows.slice(-200).forEach(function (r) {
      if (!r.fileId) return;
      try { _tsTenantAssertFileWithin_(r.fileId, r.backupType === 'MONTH_ARCHIVE' ? 'ARCHIVE' : 'SYS_BACKUPS'); checked++; }
      catch (e) { failures.push(String(r.backupId || r.fileId)); }
    });
    if (failures.length) throw new Error('резервные копии вне разрешённых папок: ' + failures.slice(0, 10).join(', '));
    return { checked: checked, total: rows.length, sampledLast: 200 };
  }, out);
  var fail = out.filter(function (x) { return x.status === 'FAIL'; }).length;
  return { mode: 'TENANT', enterpriseId: _ts2Ent_(), checkedAt: _ts2Iso_(), status: fail ? 'FAIL' : 'PASS', checks: out, summary: { passed: out.length - fail, failed: fail } };
}
function ts4TenantIntegrityCheck(token) {
  try { _requireAuth_(token); return _ok_(_ts4TenantIntegrity_()); }
  catch (e) { return _failFrom_(e); }
}
