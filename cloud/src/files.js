// Собственность Слепцова Дениса Владимировича.
// Разработчик кода — Слепцов Денис Владимирович

/**
 * Замена Google Диска (DriveApp) для облачной версии.
 * Папки и карточки файлов — в PostgreSQL; содержимое — в Yandex Object Storage (если задан бакет)
 * или прямо в базе (bytea). Ссылка на файл — «files/<id>»: сервер отдаёт его только сотруднику
 * той же организации с действующей сессией (см. server.js).
 *
 * Переменные: TSEKH_S3_BUCKET, TSEKH_S3_ENDPOINT (https://storage.yandexcloud.net),
 * TSEKH_S3_REGION (ru-central1), YC_ACCESS_KEY_ID, YC_SECRET_ACCESS_KEY (статический ключ сервисного аккаунта).
 */
const crypto = require('crypto');
const { sign } = require('./sigv4');

const FILES_SQL = [
  `CREATE TABLE IF NOT EXISTS tsekh_folders (id text PRIMARY KEY, parent_id text, name text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (parent_id, name))`,
  `INSERT INTO tsekh_folders (id, parent_id, name) VALUES ('root', NULL, '') ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS tsekh_files (id text PRIMARY KEY, folder_id text REFERENCES tsekh_folders(id), name text NOT NULL,
     mime text NOT NULL, size integer NOT NULL, sha256 text NOT NULL, organization_id text, storage text NOT NULL,
     s3_key text, data bytea, created_at timestamptz NOT NULL DEFAULT now())`
];

function s3Config(env) {
  env = env || process.env;
  if (!env.TSEKH_S3_BUCKET) return null;
  return { bucket: env.TSEKH_S3_BUCKET, endpoint: (env.TSEKH_S3_ENDPOINT || 'https://storage.yandexcloud.net').replace(/\/+$/, ''),
    region: env.TSEKH_S3_REGION || 'ru-central1', accessKeyId: env.YC_ACCESS_KEY_ID, secretAccessKey: env.YC_SECRET_ACCESS_KEY };
}

function createFiles(db, makeBlob, getOrganizationId, env) {
  const s3 = s3Config(env);
  if (s3 && (!s3.accessKeyId || !s3.secretAccessKey)) throw new Error('Для Object Storage задайте YC_ACCESS_KEY_ID и YC_SECRET_ACCESS_KEY.');

  function s3Request(method, key, body, contentType) {
    const url = s3.endpoint + '/' + s3.bucket + '/' + key.split('/').map(encodeURIComponent).join('/');
    const buf = body ? Buffer.from(body) : Buffer.alloc(0);
    const signed = sign({ method, url, region: s3.region, service: 's3', headers: contentType ? { 'content-type': contentType } : {},
      body: buf, accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey });
    const r = db.fetch(url, { method, headers: signed.headers, payloadBase64: body ? buf.toString('base64') : undefined });
    if (r.status >= 300) throw new Error('Хранилище файлов ответило ' + r.status + ' (' + method + ').');
    return Buffer.from(r.body, 'base64');
  }

  function fileObj(row) {
    const f = {
      getId: () => row.id, getName: () => row.name, getMimeType: () => row.mime, getSize: () => row.size,
      getUrl: () => 'files/' + row.id, getDownloadUrl: () => 'files/' + row.id,
      getDateCreated: () => new Date(row.created_at),
      getBlob() {
        const bytes = row.storage === 's3' ? s3Request('GET', row.s3_key) : db.query('SELECT data FROM tsekh_files WHERE id = $1', [row.id])[0].data;
        return makeBlob(Buffer.from(bytes), row.mime, row.name);
      },
      setSharing() { return f; }, setDescription() { return f; },
      makeCopy() { throw new Error('Копирование файлов в облачной версии не поддерживается.'); }
    };
    return f;
  }

  function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }

  function folderObj(row) {
    const folder = {
      getId: () => row.id, getName: () => row.name, getUrl: () => '',
      getFoldersByName(name) {
        return iter(db.query('SELECT id, parent_id, name FROM tsekh_folders WHERE parent_id = $1 AND name = $2', [row.id, String(name)]).map(folderObj));
      },
      getFolders() { return iter(db.query('SELECT id, parent_id, name FROM tsekh_folders WHERE parent_id = $1 ORDER BY name', [row.id]).map(folderObj)); },
      createFolder(name) {
        const id = crypto.randomUUID();
        db.query('INSERT INTO tsekh_folders (id, parent_id, name) VALUES ($1, $2, $3) ON CONFLICT (parent_id, name) DO NOTHING', [id, row.id, String(name)]);
        return folderObj(db.query('SELECT id, parent_id, name FROM tsekh_folders WHERE parent_id = $1 AND name = $2', [row.id, String(name)])[0]);
      },
      createFile(blobOrName, content, mime) {
        const blob = typeof blobOrName === 'string' ? makeBlob(content || '', mime || 'text/plain', blobOrName) : blobOrName;
        const bytes = Buffer.from(blob.getBytes().map(b => b & 255));
        if (bytes.length > 25 * 1024 * 1024) throw new Error('Файл больше 25 МБ — не сохраняю.');
        const id = crypto.randomUUID(), name = blob.getName() || 'file', type = blob.getContentType() || 'application/octet-stream';
        const sha = crypto.createHash('sha256').update(bytes).digest('hex');
        const org = getOrganizationId() || null;
        if (s3) {
          const key = 'files/' + (org || 'common') + '/' + id;
          s3Request('PUT', key, bytes, type);
          db.query('INSERT INTO tsekh_files (id, folder_id, name, mime, size, sha256, organization_id, storage, s3_key) VALUES ($1,$2,$3,$4,$5,$6,$7,\'s3\',$8)', [id, row.id, name, type, bytes.length, sha, org, key]);
        } else {
          db.query('INSERT INTO tsekh_files (id, folder_id, name, mime, size, sha256, organization_id, storage, data) VALUES ($1,$2,$3,$4,$5,$6,$7,\'pg\',$8)', [id, row.id, name, type, bytes.length, sha, org, '\\x' + bytes.toString('hex')]);
        }
        return fileObj({ id, name, mime: type, size: bytes.length, storage: s3 ? 's3' : 'pg', s3_key: s3 ? 'files/' + (org || 'common') + '/' + id : null, created_at: new Date().toISOString() });
      },
      getFilesByName(name) { return iter(db.query('SELECT id, name, mime, size, storage, s3_key, created_at FROM tsekh_files WHERE folder_id = $1 AND name = $2', [row.id, String(name)]).map(fileObj)); }
    };
    return folder;
  }

  function fileRow(id) {
    return db.query('SELECT id, name, mime, size, storage, s3_key, organization_id, created_at FROM tsekh_files WHERE id = $1', [String(id)])[0] || null;
  }

  const driveApp = {
    getRootFolder: () => folderObj({ id: 'root', parent_id: null, name: '' }),
    getFolderById(id) { const r = db.query('SELECT id, parent_id, name FROM tsekh_folders WHERE id = $1', [String(id)])[0]; if (!r) throw new Error('Папка не найдена.'); return folderObj(r); },
    getFileById(id) { const r = fileRow(id); if (!r) throw new Error('Файл не найден.'); return fileObj(r); },
    createFile(blobOrName, content, mime) { return driveApp.getRootFolder().createFile(blobOrName, content, mime); },
    createFolder(name) { return driveApp.getRootFolder().createFolder(name); },
    getFoldersByName(name) { return driveApp.getRootFolder().getFoldersByName(name); }
  };

  /** Для сервера: файл с содержимым и организацией — проверка доступа делается в server.js. */
  function readForDownload(id) {
    if (!/^[0-9a-f-]{36}$/.test(String(id))) return null;
    const row = fileRow(id);
    if (!row) return null;
    const bytes = row.storage === 's3' ? s3Request('GET', row.s3_key) : Buffer.from(db.query('SELECT data FROM tsekh_files WHERE id = $1', [row.id])[0].data);
    return { name: row.name, mime: row.mime, organization_id: row.organization_id, bytes };
  }

  return { driveApp, readForDownload, migrate: () => db.batch(FILES_SQL.map(sql => ({ sql }))), usesS3: !!s3 };
}

module.exports = { createFiles, s3Config, FILES_SQL };
