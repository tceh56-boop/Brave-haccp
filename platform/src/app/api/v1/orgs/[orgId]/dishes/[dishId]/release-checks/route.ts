import { handler, requireSession } from '@/server/http/route';
import { listReleaseChecks, addReleaseCheck } from '@/server/ops/production';

type P = { orgId: string; dishId: string };

export const GET = handler<P>(async (c) => listReleaseChecks(requireSession(c).user.id, c.params.orgId, c.params.dishId));
export const POST = handler<P>(async (c) => addReleaseCheck(requireSession(c).user.id, c.params.orgId, c.params.dishId, await c.body()));
