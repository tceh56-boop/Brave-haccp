import { handler, requireSession } from '@/server/http/route';
import { listJobs } from '@/server/ops/ai';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listJobs(requireSession(c).user.id, c.params.orgId, { mine: c.req.nextUrl.searchParams.get('mine') === '1' }));
