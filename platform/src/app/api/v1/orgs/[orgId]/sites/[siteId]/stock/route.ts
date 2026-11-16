import { handler, requireSession } from '@/server/http/route';
import { balances } from '@/server/ops/stock';

type P = { orgId: string; siteId: string };

export const GET = handler<P>(async (c) => balances(requireSession(c).user.id, c.params.orgId, c.params.siteId));
