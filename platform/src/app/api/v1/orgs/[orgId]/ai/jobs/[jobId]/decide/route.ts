import { handler, requireSession } from '@/server/http/route';
import { decide } from '@/server/ops/ai';

type P = { orgId: string; jobId: string };

export const POST = handler<P>(async (c) => decide(requireSession(c).user.id, c.params.orgId, c.params.jobId, await c.body()));
