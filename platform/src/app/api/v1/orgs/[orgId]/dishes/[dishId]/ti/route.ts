import { handler, requireSession } from '@/server/http/route';
import { getTi, approveTi } from '@/server/ops/techinstr';

type P = { orgId: string; dishId: string };

export const GET = handler<P>(async (c) => getTi(requireSession(c).user.id, c.params.orgId, c.params.dishId));
export const POST = handler<P>(async (c) => approveTi(requireSession(c).user.id, c.params.orgId, c.params.dishId, await c.body()));
