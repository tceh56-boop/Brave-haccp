import { handler, requireSession } from '@/server/http/route';
import { economics } from '@/server/ops/pos';

type P = { orgId: string };

export const GET = handler<P>(async (c) => {
  const q = c.req.nextUrl.searchParams;
  return economics(requireSession(c).user.id, c.params.orgId, { siteId: q.get('siteId') || null, from: q.get('from'), to: q.get('to') });
});
