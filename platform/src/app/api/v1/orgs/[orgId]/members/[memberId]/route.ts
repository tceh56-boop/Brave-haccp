import { handler, requireSession } from '@/server/http/route';
import { changeMember } from '@/server/org/organizations';

type P = { orgId: string; memberId: string };
export const PATCH = handler<P>(async (c) => changeMember(requireSession(c).user.id, c.params.orgId, c.params.memberId, await c.body()));
