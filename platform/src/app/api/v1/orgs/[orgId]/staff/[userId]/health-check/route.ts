import { handler, requireSession } from '@/server/http/route';
import { recordHealthCheck } from '@/server/ops/staff';

type P = { orgId: string; userId: string };

export const POST = handler<P>(async (c) => recordHealthCheck(requireSession(c).user.id, c.params.orgId, c.params.userId, await c.body()));
