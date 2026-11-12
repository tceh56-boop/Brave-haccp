import { handler, requireSession } from '@/server/http/route';
import { getStaffCard } from '@/server/ops/staff';

type P = { orgId: string; userId: string };

/** userId = me — своя карточка. */
export const GET = handler<P>(async (c) => {
  const uid = requireSession(c).user.id;
  return getStaffCard(uid, c.params.orgId, c.params.userId === 'me' ? uid : c.params.userId);
});
