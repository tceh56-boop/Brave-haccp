import { handler, requireSession } from '@/server/http/route';
import { getDish, updateDish } from '@/server/ops/recipes';

type P = { orgId: string; dishId: string };

export const GET = handler<P>(async (c) => getDish(requireSession(c).user.id, c.params.orgId, c.params.dishId, c.req.nextUrl.searchParams.get('versionId')));
export const PATCH = handler<P>(async (c) => updateDish(requireSession(c).user.id, c.params.orgId, c.params.dishId, await c.body()));
