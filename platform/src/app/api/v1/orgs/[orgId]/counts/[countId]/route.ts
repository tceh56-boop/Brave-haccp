import { handler, requireSession } from '@/server/http/route';
import { getCount } from '@/server/ops/stock';

type P = { orgId: string; countId: string };

export const GET = handler<P>(async (c) => getCount(requireSession(c).user.id, c.params.orgId, c.params.countId));
