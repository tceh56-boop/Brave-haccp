import { handler, requireSession } from '@/server/http/route';
import { setMemberBlocked } from '@/server/org/organizations';

type P = { orgId: string; memberId: string };
export const POST = handler<P>(async (c) => {
  const b = (await c.body()) as { blocked?: unknown; reason?: unknown };
  return setMemberBlocked(requireSession(c).user.id, c.params.orgId, c.params.memberId, b?.blocked !== false, b?.reason);
});
