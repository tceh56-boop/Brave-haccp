import { handler, requireSession } from '@/server/http/route';
import { listEvents, createEvent } from '@/server/ops/planmenu';

type P = { orgId: string };

export const GET = handler<P>(async (c) => {
  const q = c.req.nextUrl.searchParams;
  return listEvents(requireSession(c).user.id, c.params.orgId, q.get('siteId') || '', q.get('period'));
});
export const POST = handler<P>(async (c) => createEvent(requireSession(c).user.id, c.params.orgId, await c.body()));
