import { handler, requireSession } from '@/server/http/route';
import { listIncidents, reportProblem } from '@/server/ops/incidents';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listIncidents(requireSession(c).user.id, c.params.orgId, { open: c.req.nextUrl.searchParams.get('open') === '1' }));
export const POST = handler<P>(async (c) => reportProblem(requireSession(c).user.id, c.params.orgId, await c.body()));
