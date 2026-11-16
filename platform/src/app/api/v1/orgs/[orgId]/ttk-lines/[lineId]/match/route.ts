import { handler, requireSession } from '@/server/http/route';
import { matchLine } from '@/server/ops/recipes';

type P = { orgId: string; lineId: string };

export const POST = handler<P>(async (c) => matchLine(requireSession(c).user.id, c.params.orgId, c.params.lineId, await c.body()));
