import { handler, requireSession } from '@/server/http/route';
import { listExpenses, addExpense } from '@/server/ops/finance';

type P = { orgId: string };

export const GET = handler<P>(async (c) => {
  const q = c.req.nextUrl.searchParams;
  return listExpenses(requireSession(c).user.id, c.params.orgId, { from: q.get('from'), to: q.get('to'), siteId: q.get('siteId') || null });
});
export const POST = handler<P>(async (c) => addExpense(requireSession(c).user.id, c.params.orgId, await c.body()));
