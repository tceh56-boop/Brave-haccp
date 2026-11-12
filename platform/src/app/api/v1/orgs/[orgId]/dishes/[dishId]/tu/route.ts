import { handler, requireSession } from '@/server/http/route';
import { getTechSpec, saveTechSpecParams } from '@/server/ops/techspec';

type P = { orgId: string; dishId: string };

export const GET = handler<P>(async (c) => getTechSpec(requireSession(c).user.id, c.params.orgId, c.params.dishId));
export const PUT = handler<P>(async (c) => saveTechSpecParams(requireSession(c).user.id, c.params.orgId, c.params.dishId, await c.body()));
