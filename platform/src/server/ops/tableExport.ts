import { zip } from './pack';

/**
 * Экспорт табличного отчёта (ТЗ доработки, 9.5): CSV (для Excel), XLSX (Office Open XML, без внешних библиотек),
 * печатная HTML-форма (A4, в PDF — печатью из браузера) с реквизитами организации и пометкой об управленческом характере.
 */

export interface Col { key: string; label: string; type?: 'text' | 'money' | 'num' | 'pct' }
export interface Table { title: string; columns: Col[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> | null; notes?: string[] }
export interface OrgHead { name: string; legal_form: string | null; inn: string | null; legal_address?: string | null }

const cell = (v: unknown, t?: Col['type']) => (v === null || v === undefined || v === '' ? '' : t === 'money' || t === 'num' || t === 'pct' ? Number(v) : String(v));

export function tableCsv(t: Table) {
  const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const num = (v: unknown, c: Col) => (typeof v === 'number' && c.type !== 'text' ? String(v).replace('.', ',') : v);
  const lines = [t.columns.map((c) => q(c.label)).join(';'), ...t.rows.map((r) => t.columns.map((c) => q(num(cell(r[c.key], c.type), c))).join(';'))];
  if (t.totals) lines.push(t.columns.map((c) => q(num(cell(t.totals![c.key], c.type), c))).join(';'));
  return '﻿' + lines.join('\r\n');
}

const x = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const colName = (i: number) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/** XLSX: один лист; шапка (организация, отчёт, примечания), таблица, итоги. Числа — числами, денежный и процентный формат. */
export function tableXlsx(t: Table, head: OrgHead, subtitle: string) {
  const rows: (string | number)[][] = [];
  const styles: number[][] = [];
  const push = (r: (string | number)[], st: number[] = []) => { rows.push(r); styles.push(st); };
  push([orgLine(head)], [1]); push([t.title], [1]); push([subtitle]);
  for (const n of t.notes || []) push([n]);
  push([]);
  push(t.columns.map((c) => c.label), t.columns.map(() => 1));
  const st = (c: Col) => (c.type === 'money' ? 2 : c.type === 'pct' ? 3 : c.type === 'num' ? 4 : 0);
  for (const r of t.rows) push(t.columns.map((c) => cell(r[c.key], c.type) as string | number), t.columns.map(st));
  if (t.totals) push(t.columns.map((c) => cell(t.totals![c.key], c.type) as string | number), t.columns.map((c) => (st(c) || 1)));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => {
    const ref = `${colName(j)}${i + 1}`, s = styles[i][j] ? ` s="${styles[i][j]}"` : '';
    if (v === '' || v === undefined) return '';
    return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}"${s}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${x(String(v))}</t></is></c>`;
  }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Отчет" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.0&quot; %&quot;"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="5"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="4" applyNumberFormat="1"/></cellXfs></styleSheet>` },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ];
  return zip(files.map((f) => ({ name: f.name, data: Buffer.from(f.data, 'utf8') })));
}

function orgLine(h: OrgHead) {
  const name = h.legal_form && h.legal_form !== 'другое' && !h.name.startsWith(h.legal_form) ? `${h.legal_form} «${h.name}»` : h.name;
  return `${name}${h.inn ? `, ИНН ${h.inn}` : ''}${h.legal_address ? `, ${h.legal_address}` : ''}`;
}

const fmt = (v: unknown, t?: Col['type']) => {
  if (v === null || v === undefined || v === '') return '—';
  if (t === 'money') return `${Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (t === 'pct') return `${Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`;
  if (t === 'num') return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  return String(v);
};

/** Печатная форма (A4): реквизиты, название, период, примечания, таблица, итоги, номер страницы. */
export function tableHtml(t: Table, head: OrgHead, subtitle: string, generated: string) {
  const landscape = t.columns.length > 7;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${x(t.title)}</title>
<style>@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:12mm 12mm 16mm;@bottom-right{content:"Страница " counter(page) " из " counter(pages);font:8pt Arial,sans-serif}}
body{font:10pt/1.35 Arial,sans-serif;color:#111}.hdr{font-size:9pt;border-bottom:1px solid #444;padding-bottom:4px;display:flex;justify-content:space-between;gap:12px}
h1{font-size:13pt;text-align:center;margin:10px 0 2px}.sub{text-align:center;font-size:9pt;color:#333;margin-bottom:8px}.note{font-size:8.5pt;margin:3px 0}
table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #666;padding:3px 4px;font-size:8.5pt;vertical-align:top}th{background:#eee}
td.n{text-align:right;white-space:nowrap}tr.tot td{font-weight:700;background:#f4f4f4}.mg{margin-top:10px;font-size:8.5pt;font-weight:700}</style></head><body>
<div class="hdr"><span>${x(orgLine(head))}</span><span>Сформировано: ${x(generated)}</span></div>
<h1>${x(t.title)}</h1><div class="sub">${x(subtitle)}</div>
${(t.notes || []).map((n) => `<div class="note">${x(n)}</div>`).join('')}
<table><thead><tr>${t.columns.map((c) => `<th>${x(c.label)}</th>`).join('')}</tr></thead><tbody>
${t.rows.length ? t.rows.map((r) => `<tr>${t.columns.map((c) => `<td${c.type && c.type !== 'text' ? ' class="n"' : ''}>${x(fmt(r[c.key], c.type))}</td>`).join('')}</tr>`).join('\n') : `<tr><td colspan="${t.columns.length}" style="text-align:center">Данных за период нет</td></tr>`}
${t.totals ? `<tr class="tot">${t.columns.map((c) => `<td${c.type && c.type !== 'text' ? ' class="n"' : ''}>${x(fmt(t.totals![c.key], c.type))}</td>`).join('')}</tr>` : ''}
</tbody></table>
<div class="mg">Отчет управленческий. Не является бухгалтерской или налоговой отчетностью.</div></body></html>`;
}
