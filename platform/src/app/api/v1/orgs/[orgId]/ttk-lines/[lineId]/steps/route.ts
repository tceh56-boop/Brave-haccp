import { handler, requireSession } from '@/server/http/route';
import { setLineSteps } from '@/server/ops/processing';

type P = { orgId: string; lineId: string };

export const POST = handler<P>(async (c) => setLineSteps(requireSession(c).user.id, c.params.orgId, c.params.lineId, await c.body()));
