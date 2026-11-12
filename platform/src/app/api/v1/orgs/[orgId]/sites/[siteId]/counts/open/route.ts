import { handler, requireSession } from '@/server/http/route';
import { getOpenCount } from '@/server/ops/stock';

type P = { orgId: string; siteId: string };

export const GET = handler<P>(async (c) => getOpenCount(requireSession(c).user.id, c.params.orgId, c.params.siteId));
