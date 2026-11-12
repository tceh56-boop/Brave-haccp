import { handler, requireSession } from '@/server/http/route';
import { getOrder, editOrder } from '@/server/ops/purchasing';

type P = { orgId: string; id: string };

export const GET = handler<P>(async (c) => getOrder(requireSession(c).user.id, c.params.orgId, c.params.id));
export const PATCH = handler<P>(async (c) => editOrder(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
