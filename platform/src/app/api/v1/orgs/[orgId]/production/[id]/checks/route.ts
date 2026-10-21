import { handler, requireSession } from '@/server/http/route';
import { recordCheck } from '@/server/ops/production';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => recordCheck(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
