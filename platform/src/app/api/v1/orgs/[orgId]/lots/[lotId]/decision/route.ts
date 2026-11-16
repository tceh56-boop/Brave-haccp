import { handler, requireSession } from '@/server/http/route';
import { decideQuarantine } from '@/server/ops/lots';

type P = { orgId: string; lotId: string };

export const POST = handler<P>(async (c) => decideQuarantine(requireSession(c).user.id, c.params.orgId, c.params.lotId, await c.body()));
