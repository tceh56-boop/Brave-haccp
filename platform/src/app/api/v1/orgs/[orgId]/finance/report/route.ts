import { NextResponse } from 'next/server';
import { handler, requireSession } from '@/server/http/route';
import { econReport } from '@/server/ops/econReports';
import { tableCsv, tableXlsx, tableHtml } from '@/server/ops/tableExport';

type P = { orgId: string };

/** Управленческий отчёт: JSON для экрана; format=csv | xlsx | html — экспорт (ТЗ доработки, 9.5). */
export const GET = handler<P>(async (c) => {
  const q = c.req.nextUrl.searchParams;
  const r = await econReport(requireSession(c).user.id, c.params.orgId, { kind: q.get('kind'), from: q.get('from'), to: q.get('to'), siteId: q.get('siteId') || null });
  const name = encodeURIComponent(`${r.table.title}_${q.get('from')}_${q.get('to')}`);
  const fmt = q.get('format');
  if (fmt === 'csv') return new NextResponse(tableCsv(r.table), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${name}.csv` } });
  if (fmt === 'xlsx') return new NextResponse(new Uint8Array(tableXlsx(r.table, r.org, r.subtitle)), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename*=UTF-8''${name}.xlsx` } });
  if (fmt === 'html') return new NextResponse(tableHtml(r.table, r.org, r.subtitle, r.generated), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } });
  return r;
});
