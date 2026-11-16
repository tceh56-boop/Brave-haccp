import { handler, requireSession } from '@/server/http/route';
import { setCountLine } from '@/server/ops/stock';

type P = { orgId: string; countId: string; lineId: string };

export const POST = handler<P>(async (c) => setCountLine(requireSession(c).user.id, c.params.orgId, c.params.countId, c.params.lineId, await c.body()));
