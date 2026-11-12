import { handler, requireSession } from '@/server/http/route';
import { listActs, createAct } from '@/server/ops/controlacts';

type P = { orgId: string; dishId: string };

export const GET = handler<P>(async (c) => listActs(requireSession(c).user.id, c.params.orgId, c.params.dishId));
export const POST = handler<P>(async (c) => createAct(requireSession(c).user.id, c.params.orgId, c.params.dishId, await c.body()));
