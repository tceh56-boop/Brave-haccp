import { handler, requireSession } from '@/server/http/route';
import { setSampleOnRelease } from '@/server/ops/production';

type P = { orgId: string; dishId: string };

export const PUT = handler<P>(async (c) => setSampleOnRelease(requireSession(c).user.id, c.params.orgId, c.params.dishId, await c.body()));
