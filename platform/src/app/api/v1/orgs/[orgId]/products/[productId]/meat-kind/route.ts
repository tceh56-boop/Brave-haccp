import { handler, requireSession } from '@/server/http/route';
import { setMeatKind } from '@/server/ops/declarations';

type P = { orgId: string; productId: string };

export const POST = handler<P>(async (c) => setMeatKind(requireSession(c).user.id, c.params.orgId, c.params.productId, await c.body()));
