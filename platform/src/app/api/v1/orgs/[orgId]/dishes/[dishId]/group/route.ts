import { handler, requireSession } from '@/server/http/route';
import { setDishGroup } from '@/server/ops/dishgroups';

type P = { orgId: string; dishId: string };

export const PUT = handler<P>(async (c) => setDishGroup(requireSession(c).user.id, c.params.orgId, c.params.dishId, await c.body()));
