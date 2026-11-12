import { handler, requireSession } from '@/server/http/route';
import { addOrderLine, payOrder, refundOrder, cancelOrder } from '@/server/ops/pos';
import { Errors } from '@/server/http/errors';

type P = { orgId: string; orderId: string; op: string };

const OPS = { lines: addOrderLine, pay: payOrder, refund: refundOrder, cancel: cancelOrder } as const;

export const POST = handler<P>(async (c) => {
  const fn = OPS[c.params.op as keyof typeof OPS];
  if (!fn) throw Errors.notFound();
  return fn(requireSession(c).user.id, c.params.orgId, c.params.orderId, await c.body());
});
