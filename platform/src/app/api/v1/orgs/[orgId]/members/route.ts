import { handler, requireSession } from '@/server/http/route';
import { listMembers } from '@/server/org/organizations';

type P = { orgId: string };
export const GET = handler<P>(async (c) => listMembers(requireSession(c).user.id, c.params.orgId));
