import { handler, requireSession } from '@/server/http/route';
import { getJob } from '@/server/ops/ai';

type P = { orgId: string; jobId: string };

export const GET = handler<P>(async (c) => getJob(requireSession(c).user.id, c.params.orgId, c.params.jobId));
