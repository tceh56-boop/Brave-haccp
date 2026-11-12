'use strict';
// Перенос предприятия из Google: опись + архив Диска → предприятие с теми же ID, данными и рабочими ссылками.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tsekh-import-'));
const tenants = require('../lib/tenants');
const { readZip, rewriteLinks } = require('../lib/importer');
const { makeUtilities } = require('../lib/gas/utilities');
const { Blob } = require('../lib/gas/blob');

test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

const ID = (s) => (s + '_'.repeat(33)).slice(0, 33); // ID Диска: 33 символа
const ROOT = ID('root1'); const TTK = ID('ttkfolder'); const PHOTO = ID('photofolder');
const BASE = ID('basesheet'); const DOC = ID('docfile'); const JPG = ID('jpgfile'); const JPG2 = ID('jpgfile2'); const LOST = ID('lostfile');

async function xlsxBytes() {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Журнал');
  ws.addRow(['Дата', 'Блюдо', 'Фото']);
  ws.addRow([new Date(Date.UTC(2026, 10, 1, 7)), 'Борщ', `https://drive.google.com/file/d/${JPG}/view?usp=sharing`]);
  ws.addRow([new Date(Date.UTC(2026, 10, 2, 7)), 'Щи', `https://drive.google.com/file/d/${ID('unknown')}/view`]);
  wb.addWorksheet('Сотрудники').addRow(['Иванов', 'Повар']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function docxBytes() {
  const U = makeUtilities();
  const f = (name, text) => new Blob(Buffer.from(text, 'utf8'), 'text/xml', name);
  return U.zip([
    f('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    f('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    f('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>ТТК Борщ</w:t></w:r></w:p></w:body></w:document>'),
  ], 'd.docx')._buffer();
}

test('readZip читает каталог архива и ссылки переписываются только для перенесённых ID', () => {
  const U = makeUtilities();
  const z = U.zip([new Blob(Buffer.from('один'), 'text/plain', 'Папка/а.txt'), new Blob(Buffer.from('два'), 'text/plain', 'Папка/б (1).txt')], 'x.zip')._buffer();
  const e = readZip(z);
  assert.deepStrictEqual([...e.keys()], ['Папка/а.txt', 'Папка/б (1).txt']);
  assert.strictEqual(e.get('Папка/б (1).txt')().toString(), 'два');
  const known = new Map([[JPG, 'image/jpeg']]);
  assert.strictEqual(rewriteLinks(`см. https://drive.google.com/file/d/${JPG}/view?usp=sharing`, known, 'https://x.ru/t/a'), `см. https://x.ru/t/a/file/${JPG}`);
  assert.strictEqual(rewriteLinks(`https://drive.google.com/open?id=${JPG}`, known, 'https://x.ru/t/a'), `https://x.ru/t/a/file/${JPG}`);
  const other = `https://drive.google.com/file/d/${ID('other')}/view`;
  assert.strictEqual(rewriteLinks(other, known, 'https://x.ru/t/a'), other);
});

test('импорт предприятия из Google: папки, таблица-база, документ, фото, свойства, триггеры', async () => {
  const U = makeUtilities();
  const R = 'ЦЕХ Стандарт — Кафе';
  const zip = U.zip([
    new Blob(await xlsxBytes(), null, `${R}/ЦЕХ база.xlsx`),
    new Blob(docxBytes(), null, `${R}/02_ТТК/ТТК Борщ.docx`),
    new Blob(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), null, `${R}/13_Фото/борщ.jpg`),
    new Blob(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]), null, `${R}/13_Фото/борщ (1).jpg`),
  ], 'drive.zip')._buffer();
  const manifest = {
    format: 'tsekh-cloud-export/1', timeZone: 'Asia/Yekaterinburg', owner: 'owner@example.ru',
    rootId: ROOT, rootName: R, sheetId: BASE, sheetInRoot: true, sheetName: 'ЦЕХ база',
    properties: { TS_TENANT_ROOT_ID: ROOT, SHEET_ID: BASE, TS_TENANT_MODE: '1', YANDEX_FOLDER_ID: 'b1gtest', DEPLOYMENT_ID: 'AKfy-old', MC_JOB_STATE: 'x',
      TS2_TTK_FOLDER: `https://drive.google.com/drive/folders/${TTK}` },
    items: [
      { id: TTK, name: '02_ТТК', mime: 'application/vnd.google-apps.folder', parent: ROOT, path: `${R}/02_ТТК` },
      { id: PHOTO, name: '13_Фото', mime: 'application/vnd.google-apps.folder', parent: ROOT, path: `${R}/13_Фото` },
      { id: BASE, name: 'ЦЕХ база', mime: 'application/vnd.google-apps.spreadsheet', parent: ROOT, path: `${R}/ЦЕХ база` },
      { id: DOC, name: 'ТТК Борщ', mime: 'application/vnd.google-apps.document', parent: TTK, path: `${R}/02_ТТК/ТТК Борщ` },
      { id: JPG, name: 'борщ.jpg', mime: 'image/jpeg', parent: PHOTO, path: `${R}/13_Фото/борщ.jpg` },
      { id: JPG2, name: 'борщ.jpg', mime: 'image/jpeg', parent: PHOTO, path: `${R}/13_Фото/борщ.jpg` },
      { id: LOST, name: 'нет в архиве.pdf', mime: 'application/pdf', parent: ROOT, path: `${R}/нет в архиве.pdf` },
    ],
  };
  const r = tenants.importFromGoogle({ slug: 'kafe-import', manifest, zips: [zip] });
  assert.strictEqual(r.folders, 3);
  assert.strictEqual(r.books, 1);
  assert.strictEqual(r.docs, 1);
  assert.strictEqual(r.files, 2);
  assert.deepStrictEqual(r.missing, [`${R}/нет в архиве.pdf`]);
  assert.strictEqual(r.links, 1);
  assert.deepStrictEqual(r.triggers, ['installAllTriggers: ок', 'installTsTriggers: ок']);

  const t = tenants.get('kafe-import');
  const p = t.store.props();
  assert.strictEqual(p.TS_TENANT_ROOT_ID, ROOT);
  assert.strictEqual(p.TS_TENANT_SHEET_ID, BASE);
  assert.strictEqual(p.YANDEX_FOLDER_ID, 'b1gtest');
  assert.strictEqual(p.TS_CLOUD, '1');
  assert.ok(!('DEPLOYMENT_ID' in p) && !('MC_JOB_STATE' in p), 'свойства проекта Google не переносятся');
  assert.strictEqual(p.TS2_TTK_FOLDER, `${t.baseUrl}/folder/${TTK}`);

  // код приложения видит те же ID: таблица-база, документ, фото в папке
  const seen = t.execute(() => () => {
    const ss = t.spreadsheetApp().openById(BASE);
    const v = ss.getSheetByName('Журнал').getDataRange().getValues();
    const D = require('../lib/gas/drive').makeDrive(t);
    const photos = []; const it = D.getFolderById(PHOTO).getFiles(); while (it.hasNext()) photos.push(it.next().getId());
    return { sheets: ss.getSheets().map((s) => s.getName()), v, doc: t.documentApp().openById(DOC).getBody().getText(), photos: photos.sort(),
      jpg2: D.getFileById(JPG2).getBlob().getBytes().slice(-3) };
  });
  assert.deepStrictEqual(seen.sheets, ['Журнал', 'Сотрудники']);
  assert.ok(seen.v[1][0] instanceof Date);
  assert.strictEqual(seen.v[1][1], 'Борщ');
  assert.strictEqual(seen.v[1][2], `${t.baseUrl}/file/${JPG}`);
  assert.match(seen.v[2][2], /^https:\/\/drive\.google\.com\//, 'ссылка на неперенесённый файл остаётся как была');
  assert.match(seen.doc, /ТТК Борщ/);
  assert.deepStrictEqual(seen.photos, [JPG, JPG2].sort());
  assert.deepStrictEqual(seen.jpg2, [4, 5, 6]);
});

test('повторный импорт в то же предприятие запрещён, неудачный импорт не оставляет предприятия', () => {
  assert.throws(() => tenants.importFromGoogle({ slug: 'kafe-import', manifest: { format: 'tsekh-cloud-export/1', items: [] }, zips: [] }), /уже есть/);
  const bad = { format: 'tsekh-cloud-export/1', rootId: ID('r2'), rootName: 'Кафе 2', sheetId: ID('s2'), sheetInRoot: false, properties: {}, items: [] };
  assert.throws(() => tenants.importFromGoogle({ slug: 'kafe-bad', manifest: bad, zips: [] }), /--xlsx/);
  assert.strictEqual(tenants.readCfg('kafe-bad'), null);
});
