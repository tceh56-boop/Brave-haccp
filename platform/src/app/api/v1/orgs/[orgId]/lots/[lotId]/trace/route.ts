import { handler, requireSession } from '@/server/http/route';
import { trace } from '@/server/ops/stock';

type P = { orgId: string; lotId: string };

export const GET = handler<P>(async (c) => trace(requireSession(c).user.id, c.params.orgId, c.params.lotId));
