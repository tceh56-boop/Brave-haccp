import { handler, requireSession } from '@/server/http/route';
import { writeOff } from '@/server/ops/stock';

type P = { orgId: string; lotId: string };

export const POST = handler<P>(async (c) => writeOff(requireSession(c).user.id, c.params.orgId, { ...((await c.body()) as object), lotId: c.params.lotId }));
