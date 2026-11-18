import { handler, requireSession } from '@/server/http/route';
import { voidSupplierCredit } from '@/server/ops/money';

type P = { orgId: string; id: string };
export const POST = handler<P>(async (c) => voidSupplierCredit(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
