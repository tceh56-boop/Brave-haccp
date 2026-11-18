import { handler, requireSession } from '@/server/http/route';
import { voidEventPayment } from '@/server/ops/money';

type P = { orgId: string; id: string };
export const POST = handler<P>(async (c) => voidEventPayment(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
