import { handler, requireSession } from '@/server/http/route';
import { verifyRecord } from '@/server/ops/sanitation';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => verifyRecord(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
