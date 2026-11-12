import { handler, requireSession } from '@/server/http/route';
import { listBudget, setBudget } from '@/server/ops/econReports';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listBudget(requireSession(c).user.id, c.params.orgId, c.req.nextUrl.searchParams.get('month')));
export const POST = handler<P>(async (c) => setBudget(requireSession(c).user.id, c.params.orgId, await c.body()));
