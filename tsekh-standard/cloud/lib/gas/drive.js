'use strict';
/**
 * DriveApp поверх хранилища предприятия: папки и файлы — записи в базе, содержимое — файлы на диске сервера
 * (каталог предприятия, копируется в Object Storage вместе с базой). Таблицы — тоже «файлы» (тип Google Sheets),
 * поэтому резервная копия makeCopy() таблицы работает так же, как в Google.
 */
const { Blob, toBuffer } = require('./blob');
const { MIME_SHEET } = require('./spreadsheet');

const MIME_FOLDER = 'application/vnd.google-apps.folder';
const ROOT = 'root';

function iter(list) {
  let i = 0;
  return { hasNext: () => i < list.length, next: () => { if (i >= list.length) throw new Error('Больше элементов нет'); return list[i++]; }, getContinuationToken: () => String(i) };
}

function makeDrive(tenant) {
  const store = tenant.store;
  const ensureRoot = () => { if (!store.file(ROOT)) store.addFile({ id: ROOT, name: 'Мой диск', mime: MIME_FOLDER, parents: [] }); };
  ensureRoot();
  const url = (id, folder) => `${tenant.baseUrl}/${folder ? 'folder' : 'file'}/${id}`;
  const user = () => tenant.user();
  const children = (pid, folders, extra) => store.filesWhere(`trashed = 0 and mime ${folders ? '=' : '<>'} ? and exists (select 1 from json_each(files.parents) where value = ?)${extra ? ' and ' + extra.sql : ''}`,
    MIME_FOLDER, pid, ...(extra ? extra.args : [])).map((f) => (folders ? new Folder(f.id) : new File(f.id)));

  class Item {
    constructor(id) { this._id = id; }
    _m() { const f = store.file(this._id); if (!f) throw new Error('Файл не найден: ' + this._id); return f; }
    getId() { return this._id; }
    getName() { return this._m().name; }
    setName(n) { store.updateFile(this._id, { name: String(n) }); if (this._m().mime === MIME_SHEET) store.renameBook(this._id, String(n)); return this; }
    getDescription() { return this._m().descr; }
    setDescription(d) { store.updateFile(this._id, { descr: String(d || '') }); return this; }
    getDateCreated() { return new Date(this._m().created); }
    getLastUpdated() { return new Date(this._m().updated); }
    isTrashed() { return !!this._m().trashed; }
    setTrashed(b) { store.updateFile(this._id, { trashed: b ? 1 : 0 }); return this; }
    isStarred() { return !!this._m().starred; }
    setStarred(b) { store.updateFile(this._id, { starred: b ? 1 : 0 }); return this; }
    getParents() { return iter(this._m().parents.filter((p) => store.file(p)).map((p) => new Folder(p))); }
    moveTo(folder) { store.updateFile(this._id, { parents: [folder.getId()] }); return this; }
    getOwner() { return user(); }
    getEditors() { return [user()]; }
    getViewers() { return []; }
    addEditor() { return this; }
    addEditors() { return this; }
    addViewer() { return this; }
    removeEditor() { return this; }
    removeViewer() { return this; }
    setSharing() { return this; }
    getSharingAccess() { return 'PRIVATE'; }
    getSharingPermission() { return 'NONE'; }
    setShareableByEditors() { return this; }
    isShareableByEditors() { return false; }
    getAccess() { return 'OWNER'; }
    getSize() { return this._m().size; }
  }

  class File extends Item {
    getUrl() { return url(this._id, false); }
    getDownloadUrl() { return url(this._id, false) + '?download=1'; }
    getMimeType() { return this._m().mime; }
    getBlob() { const m = this._m(); return new Blob(m.mime === MIME_SHEET ? tenant.spreadsheetApp().openById(this._id).getBlob()._buffer() : store.readBlob(this._id), m.mime, m.name); }
    getAs(type) { return this.getBlob().getAs(type); }
    setContent(s) { store.writeBlob(this._id, Buffer.from(String(s), 'utf8')); return this; }
    getThumbnail() { const m = this._m(); return /^image\//.test(m.mime) ? new Blob(store.readBlob(this._id), m.mime, m.name) : null; }
    makeCopy(a, b) {
      let name = this.getName(); let folder = null;
      if (typeof a === 'string') { name = a; folder = b || null; } else if (a) folder = a;
      const m = this._m();
      const parents = folder ? [folder.getId()] : m.parents;
      if (m.mime === MIME_SHEET) {
        const id = store.copyBook(this._id, name, parents);
        return new File(id);
      }
      return new File(store.addFile({ name, mime: m.mime, parents, bytes: store.readBlob(this._id), descr: m.descr }));
    }
    getTargetId() { return null; }
    getResourceKey() { return null; }
  }

  class Folder extends Item {
    getUrl() { return url(this._id, true); }
    getFiles() { return iter(children(this._id, false)); }
    getFolders() { return iter(children(this._id, true)); }
    getFilesByName(n) { return iter(children(this._id, false, { sql: 'name = ?', args: [String(n)] })); }
    getFoldersByName(n) { return iter(children(this._id, true, { sql: 'name = ?', args: [String(n)] })); }
    getFilesByType(t) { return iter(children(this._id, false, { sql: 'mime = ?', args: [String(t)] })); }
    searchFiles(q) { return iter(searchIn(this._id, q, false)); }
    searchFolders(q) { return iter(searchIn(this._id, q, true)); }
    createFolder(n) { return new Folder(store.addFile({ name: String(n), mime: MIME_FOLDER, parents: [this._id] })); }
    createFile(a, content, mime) { return createFileIn(this._id, a, content, mime); }
    addFile(f) { const m = store.file(f.getId()); if (m && !m.parents.includes(this._id)) store.updateFile(m.id, { parents: m.parents.concat(this._id) }); return this; }
    removeFile(f) { const m = store.file(f.getId()); if (m) store.updateFile(m.id, { parents: m.parents.filter((p) => p !== this._id) }); return this; }
    addFolder(f) { return this.addFile(f); }
    removeFolder(f) { return this.removeFile(f); }
  }

  function createFileIn(parent, a, content, mime) {
    if (a && typeof a === 'object' && typeof a.getBytes === 'function') {
      const b = a._buffer ? a._buffer() : toBuffer(a.getBytes());
      return new File(store.addFile({ name: a.getName() || 'Без названия', mime: a.getContentType() || 'application/octet-stream', parents: [parent], bytes: b }));
    }
    return new File(store.addFile({ name: String(a), mime: mime || 'text/plain', parents: [parent], bytes: Buffer.from(String(content === undefined ? '' : content), 'utf8') }));
  }

  /** Подмножество языка запросов Диска: title/name = / contains, mimeType =, trashed =. */
  function searchIn(parent, q, folders) {
    const conds = []; const args = [];
    String(q || '').split(/\s+and\s+/i).forEach((part) => {
      let m;
      if ((m = /^(?:title|name)\s*=\s*['"](.*)['"]$/i.exec(part.trim()))) { conds.push('name = ?'); args.push(m[1].replace(/\\'/g, "'")); }
      else if ((m = /^(?:title|name)\s+contains\s+['"](.*)['"]$/i.exec(part.trim()))) { conds.push('name like ?'); args.push('%' + m[1].replace(/\\'/g, "'") + '%'); }
      else if ((m = /^mimeType\s*=\s*['"](.*)['"]$/i.exec(part.trim()))) { conds.push('mime = ?'); args.push(m[1]); }
    });
    const extra = conds.length ? { sql: conds.join(' and '), args } : null;
    if (parent) return children(parent, folders, extra);
    return store.filesWhere(`trashed = 0 and mime ${folders ? '=' : '<>'} ?${extra ? ' and ' + extra.sql : ''}`, MIME_FOLDER, ...(extra ? extra.args : [])).map((f) => (folders ? new Folder(f.id) : new File(f.id)));
  }

  const byId = (id, folder) => {
    const f = store.file(String(id || ''));
    if (!f || (folder && f.mime !== MIME_FOLDER) || (!folder && f.mime === MIME_FOLDER)) {
      throw new Error(`Не удалось найти ${folder ? 'папку' : 'файл'} с ID ${id}. Возможно, он не существует или у вас нет доступа.`);
    }
    return folder ? new Folder(f.id) : new File(f.id);
  };

  const DA = {
    getFileById: (id) => byId(id, false),
    getFolderById: (id) => byId(id, true),
    getFileByIdAndResourceKey: (id) => byId(id, false),
    getRootFolder: () => new Folder(ROOT),
    createFolder: (n) => new Folder(store.addFile({ name: String(n), mime: MIME_FOLDER, parents: [ROOT] })),
    createFile: (a, content, mime) => createFileIn(ROOT, a, content, mime),
    getFilesByName: (n) => iter(store.filesWhere('trashed = 0 and mime <> ? and name = ?', MIME_FOLDER, String(n)).map((f) => new File(f.id))),
    getFoldersByName: (n) => iter(store.filesWhere('trashed = 0 and mime = ? and name = ?', MIME_FOLDER, String(n)).map((f) => new Folder(f.id))),
    getFiles: () => iter(store.filesWhere('trashed = 0 and mime <> ?', MIME_FOLDER).map((f) => new File(f.id))),
    getFolders: () => iter(store.filesWhere('trashed = 0 and mime = ? and id <> ?', MIME_FOLDER, ROOT).map((f) => new Folder(f.id))),
    getFilesByType: (t) => iter(store.filesWhere('trashed = 0 and mime = ?', String(t)).map((f) => new File(f.id))),
    searchFiles: (q) => iter(searchIn(null, q, false)),
    searchFolders: (q) => iter(searchIn(null, q, true)),
    getTrashedFiles: () => iter(store.filesWhere('trashed = 1 and mime <> ?', MIME_FOLDER).map((f) => new File(f.id))),
    getStorageUsed: () => store.db.prepare('select coalesce(sum(size), 0) s from files').get().s,
    getStorageLimit: () => 50 * 1024 ** 3,
    enforceSingleParent: () => {},
    Access: { ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', DOMAIN: 'DOMAIN', DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK', PRIVATE: 'PRIVATE' },
    Permission: { VIEW: 'VIEW', EDIT: 'EDIT', COMMENT: 'COMMENT', OWNER: 'OWNER', ORGANIZER: 'ORGANIZER', NONE: 'NONE' },
  };
  return DA;
}

module.exports = { makeDrive, MIME_FOLDER };
