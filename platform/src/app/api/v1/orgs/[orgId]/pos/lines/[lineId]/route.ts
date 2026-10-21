import { handler, requireSession } from '@/server/http/route';
import { setOrderLineQty } from '@/server/ops/pos';

type P = { orgId: string; lineId: string };

export const PATCH = handler<P>(async (c) => setOrderLineQty(requireSession(c).user.id, c.params.orgId, c.params.lineId, await c.body()));
