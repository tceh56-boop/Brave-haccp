import { handler, requireSession } from '@/server/http/route';
import { voidExpense } from '@/server/ops/finance';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => voidExpense(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
