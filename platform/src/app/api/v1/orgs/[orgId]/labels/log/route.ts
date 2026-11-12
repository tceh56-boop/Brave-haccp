import { handler, requireSession } from '@/server/http/route';
import { labelLog } from '@/server/ops/labels';

type P = { orgId: string };

export const GET = handler<P>(async (c) => {
  const q = c.req.nextUrl.searchParams;
  return labelLog(requireSession(c).user.id, c.params.orgId, q.get('siteId') || '', Number(q.get('days') || 7));
});
