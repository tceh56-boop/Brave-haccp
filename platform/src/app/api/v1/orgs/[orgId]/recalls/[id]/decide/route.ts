import { handler, requireSession } from '@/server/http/route';
import { decideRecall } from '@/server/ops/recalls';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => decideRecall(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
