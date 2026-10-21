import { handler, requireSession } from '@/server/http/route';
import { newVersion } from '@/server/ops/recipes';

type P = { orgId: string; dishId: string };

export const POST = handler<P>(async (c) => newVersion(requireSession(c).user.id, c.params.orgId, c.params.dishId, await c.body()));
