import { handler, requireSession } from '@/server/http/route';
import { setUnitConversion } from '@/server/ops/stock';

type P = { orgId: string };

export const POST = handler<P>(async (c) => setUnitConversion(requireSession(c).user.id, c.params.orgId, await c.body()));
