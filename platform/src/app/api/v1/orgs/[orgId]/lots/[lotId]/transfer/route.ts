import { handler, requireSession } from '@/server/http/route';
import { transfer } from '@/server/ops/stock';

type P = { orgId: string; lotId: string };

export const POST = handler<P>(async (c) => transfer(requireSession(c).user.id, c.params.orgId, { ...((await c.body()) as object), lotId: c.params.lotId }));
