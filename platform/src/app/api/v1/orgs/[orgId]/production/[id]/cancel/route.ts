import { handler, requireSession } from '@/server/http/route';
import { cancelProduction } from '@/server/ops/production';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => cancelProduction(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
