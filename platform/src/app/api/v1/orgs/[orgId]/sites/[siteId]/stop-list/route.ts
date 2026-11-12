import { handler, requireSession } from '@/server/http/route';
import { getStopList } from '@/server/ops/pos';

type P = { orgId: string; siteId: string };

export const GET = handler<P>(async (c) => getStopList(requireSession(c).user.id, c.params.orgId, c.params.siteId));
