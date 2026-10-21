import { handler, requireSession } from '@/server/http/route';
import { listDishes, createDish } from '@/server/ops/recipes';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listDishes(requireSession(c).user.id, c.params.orgId));
export const POST = handler<P>(async (c) => createDish(requireSession(c).user.id, c.params.orgId, await c.body()));
