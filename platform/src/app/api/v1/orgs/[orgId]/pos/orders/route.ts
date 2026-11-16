import { handler, requireSession } from '@/server/http/route';
import { createOrder } from '@/server/ops/pos';

type P = { orgId: string };

export const POST = handler<P>(async (c) => createOrder(requireSession(c).user.id, c.params.orgId, await c.body()));
