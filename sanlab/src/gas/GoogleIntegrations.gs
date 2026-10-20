/**
 * San.Lab — GoogleIntegrations.gs (FileService/CalendarService: платформенная часть)
 * Drive, Calendar, PDF, почта, кэш, блокировки, хеширование PIN.
 * Ядро обращается только к объекту Integr — так же устроена имитация в демо.
 */

var INTEGR_DEMO_MODE = false; // true только при заполнении тестовой копии демо-данными: без писем и событий календаря

var Integr = {
  now: function () { return new Date().toISOString(); },

  /* GOOGLE: аккаунт Workspace (Web App «Выполнять от имени: я», «Доступ: пользователи домена»).
     PIN: токен сессии из CacheService после Auth.login. */
  currentEmail: function (token, mode) {
    if (mode === 'PIN') return token ? (CacheService.getScriptCache().get('sess_' + token) || '') : '';
    return Session.getActiveUser().getEmail();
  },

  withLock: function (fn) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new AppError('BUSY', 'Система занята другой операцией. Повторите через несколько секунд.');
    try { return fn(); } finally { lock.releaseLock(); }
  },

  hash: function (s) {
    var props = PropertiesService.getScriptProperties();
    var salt = props.getProperty('PIN_SALT');
    if (!salt) { salt = Utilities.getUuid(); props.setProperty('PIN_SALT', salt); }
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + s, Utilities.Charset.UTF_8);
    return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
  },

  cacheGet: function (k) { return CacheService.getScriptCache().get(k); },
  cachePut: function (k, v, sec) { CacheService.getScriptCache().put(k, String(v), Math.max(1, Math.min(21600, sec))); },

  rootFolder: function () {
    var id = Settings.get('DRIVE_ROOT_ID') || PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_ID');
    if (!id) throw new Error('Не задана корневая папка Drive (DRIVE_ROOT_ID). Запустите setup().');
    return DriveApp.getFolderById(id);
  },

  /* Путь вида ['02_VISITS','VIS-000842','Photos'] → ID папки (создаётся при отсутствии) */
  ensureFolder: function (path) {
    var cache = CacheService.getScriptCache(), key = 'fld_' + path.join('/');
    var hit = cache.get(key);
    if (hit) return hit;
    var folder = Integr.rootFolder();
    for (var i = 0; i < path.length; i++) {
      var it = folder.getFoldersByName(path[i]);
      folder = it.hasNext() ? it.next() : folder.createFolder(path[i]);
    }
    var id = folder.getId();
    cache.put(key, id, 21600);
    return id;
  },

  saveFile: function (folderId, name, mime, b64) {
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, name);
    var file = DriveApp.getFolderById(folderId).createFile(blob);
    return { fileId: file.getId(), size: file.getSize() };
  },

  readFile: function (fileId, thumb) {
    var file = DriveApp.getFileById(fileId);
    var blob = null;
    if (thumb && /^image\//.test(file.getMimeType())) { try { blob = file.getThumbnail(); } catch (e) { blob = null; } }
    if (!blob) blob = file.getBlob();
    if (blob.getBytes().length > 20 * 1048576) throw new Error('Файл слишком большой для просмотра в приложении');
    return { mime: blob.getContentType() || file.getMimeType(), base64: Utilities.base64Encode(blob.getBytes()), name: file.getName() };
  },

  makePdf: function (folderId, name, html) {
    var pdf = Utilities.newBlob(html, 'text/html', name.replace(/\.pdf$/, '.html')).getAs('application/pdf').setName(name);
    var file = DriveApp.getFolderById(folderId).createFile(pdf);
    return { fileId: file.getId(), size: file.getSize() };
  },

  calendar: function (calendarId) {
    var cal = calendarId ? CalendarApp.getCalendarById(calendarId) : CalendarApp.getDefaultCalendar();
    if (!cal) throw new Error('Календарь ' + calendarId + ' недоступен');
    return cal;
  },

  /* Обновить существующее событие; если ID потерян — найти по тегу [VIS-…]; иначе создать */
  calendarUpsert: function (eventId, p) {
    if (INTEGR_DEMO_MODE) return 'demo-' + p.tag;
    var cal = Integr.calendar(p.calendarId), start = new Date(p.start), end = new Date(p.end);
    var ev = eventId ? cal.getEventById(eventId) : null;
    if (!ev) {
      var found = cal.getEvents(new Date(start.getTime() - 14 * 86400000), new Date(end.getTime() + 14 * 86400000), { search: p.tag });
      for (var i = 0; i < found.length; i++) if (String(found[i].getDescription()).indexOf(p.tag) >= 0) { ev = found[i]; break; }
    }
    if (ev) {
      ev.setTitle(p.title); ev.setTime(start, end); ev.setLocation(p.location); ev.setDescription(p.description);
      if (p.guest && !ev.getGuestByEmail(p.guest)) ev.addGuest(p.guest);
      return ev.getId();
    }
    var opts = { location: p.location, description: p.description };
    if (p.guest) { opts.guests = p.guest; opts.sendInvites = true; }
    return cal.createEvent(p.title, start, end, opts).getId();
  },

  calendarCancel: function (eventId, p) {
    if (INTEGR_DEMO_MODE) return;
    var ev = Integr.calendar(p.calendarId).getEventById(eventId);
    if (ev) ev.deleteEvent();
  },

  sendMail: function (to, subject, body) {
    if (INTEGR_DEMO_MODE) return;
    if (!to) throw new Error('Нет адреса получателя');
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Исчерпана дневная квота отправки писем');
    MailApp.sendEmail({ to: to, subject: subject, body: body, name: Settings.get('COMPANY_NAME') || 'San.Lab' });
  }
};
