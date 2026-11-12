import { handler, requireSession } from '@/server/http/route';
import { setNorm } from '@/server/ops/purchasing';

type P = { orgId: string };

export const POST = handler<P>(async (c) => setNorm(requireSession(c).user.id, c.params.orgId, await c.body()));
