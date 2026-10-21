import { handler, requireSession } from '@/server/http/route';
import { approveTechSpec } from '@/server/ops/techspec';

type P = { orgId: string; dishId: string };

export const POST = handler<P>(async (c) => approveTechSpec(requireSession(c).user.id, c.params.orgId, c.params.dishId, await c.body()));
