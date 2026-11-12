import { handler, requireSession } from '@/server/http/route';
import { getShift } from '@/server/ops/dashboard';

type P = { orgId: string; siteId: string };

export const GET = handler<P>(async (c) => getShift(requireSession(c).user.id, c.params.orgId, c.params.siteId));
