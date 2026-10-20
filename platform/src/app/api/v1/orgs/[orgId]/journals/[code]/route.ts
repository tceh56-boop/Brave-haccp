import { NextResponse } from 'next/server';
import { handler, requireSession } from '@/server/http/route';
import { getJournal, toCsv, toHtml } from '@/server/ops/journals';

type P = { orgId: string; code: string };

/** ?siteId&from&to[&format=csv|html] — журнал за период; csv/html — выгрузка и печатный вид. */
export const GET = handler<P>(async (c) => {
  const q = c.req.nextUrl.searchParams;
  const j = await getJournal(requireSession(c).user.id, c.params.orgId, c.params.code.toUpperCase(), { siteId: q.get('siteId'), from: q.get('from'), to: q.get('to') });
  const name = `${j.form.code}_${j.period.from}_${j.period.to}`;
  if (q.get('format') === 'csv') return new NextResponse(toCsv(j), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"` } });
  if (q.get('format') === 'html') return new NextResponse(toHtml(j), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } });
  return j;
});
