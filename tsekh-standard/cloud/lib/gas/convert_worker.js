'use strict';
// Дочерний процесс конвертации файлов (асинхронные библиотеки → синхронный вызов из кода Apps Script).
//   вход (stdin JSON): { kind: 'xlsx' | 'docx', data: base64 }
//   выход (stdout JSON): xlsx → { sheets: [{ name, rows: [[…]] }] }; docx → { html }
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  try {
    const req = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const buf = Buffer.from(req.data, 'base64');
    if (req.kind === 'xlsx') {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const sheets = [];
      wb.eachSheet((ws) => {
        const rows = [];
        ws.eachRow({ includeEmpty: true }, (row, n) => {
          const out = [];
          row.eachCell({ includeEmpty: true }, (cell, c) => {
            let v = cell.value;
            if (v && typeof v === 'object') {
              if (v instanceof Date) v = { $d: v.getTime() };
              else if ('result' in v) v = v.result instanceof Date ? { $d: v.result.getTime() } : v.result;
              else if (v.richText) v = v.richText.map((t) => t.text).join('');
              else if ('text' in v) v = v.text;
              else v = String(cell.text || '');
            }
            out[c - 1] = v === null || v === undefined ? '' : v;
          });
          rows[n - 1] = out;
        });
        for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
        // объединённые ячейки: значение видно в левой верхней, как в Google после конвертации
        sheets.push({ name: ws.name, rows });
      });
      process.stdout.write(JSON.stringify({ sheets }));
    } else if (req.kind === 'docx') {
      const mammoth = require('mammoth');
      const r = await mammoth.convertToHtml({ buffer: buf });
      process.stdout.write(JSON.stringify({ html: r.value }));
    } else throw new Error('неизвестный вид конвертации: ' + req.kind);
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: String((e && e.message) || e) }));
  }
});
