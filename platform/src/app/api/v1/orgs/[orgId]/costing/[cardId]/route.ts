import { handler, requireSession } from '@/server/http/route';
import { getCosting } from '@/server/ops/costing';

type P = { orgId: string; cardId: string };

export const GET = handler<P>(async (c) => getCosting(requireSession(c).user.id, c.params.orgId, c.params.cardId));
