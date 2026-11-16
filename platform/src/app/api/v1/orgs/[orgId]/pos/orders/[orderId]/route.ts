import { handler, requireSession } from '@/server/http/route';
import { getOrder } from '@/server/ops/pos';

type P = { orgId: string; orderId: string };

export const GET = handler<P>(async (c) => getOrder(requireSession(c).user.id, c.params.orgId, c.params.orderId));
