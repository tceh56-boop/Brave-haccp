import { handler, requireSession } from '@/server/http/route';
import { pnl } from '@/server/ops/finance';

type P = { orgId: string };

export const GET = handler<P>(async (c) => {
  const q = c.req.nextUrl.searchParams;
  return pnl(requireSession(c).user.id, c.params.orgId, { from: q.get('from'), to: q.get('to'), siteId: q.get('siteId') || null });
});
