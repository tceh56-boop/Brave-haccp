import { handler, requireSession } from '@/server/http/route';
import { menuReport, type ReportKind } from '@/server/ops/menureports';
import { Errors } from '@/server/http/errors';

type P = { orgId: string };

export const GET = handler<P>(async (c) => {
  const q = c.req.nextUrl.searchParams, kind = q.get('kind') as ReportKind;
  if (!['info', 'calories', 'bookmarks'].includes(kind)) throw Errors.validation('Вид отчёта: info, calories, bookmarks.');
  return menuReport(requireSession(c).user.id, c.params.orgId, kind, q.get('groupId'));
});
