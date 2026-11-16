import { handler, requireSession } from '@/server/http/route';
import { listCosting, createCosting } from '@/server/ops/costing';

type P = { orgId: string; dishId: string };

export const GET = handler<P>(async (c) => listCosting(requireSession(c).user.id, c.params.orgId, c.params.dishId));
export const POST = handler<P>(async (c) => createCosting(requireSession(c).user.id, c.params.orgId, c.params.dishId, await c.body()));
