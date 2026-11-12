import { handler, requireSession } from '@/server/http/route';
import { completeProduction } from '@/server/ops/production';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => completeProduction(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
