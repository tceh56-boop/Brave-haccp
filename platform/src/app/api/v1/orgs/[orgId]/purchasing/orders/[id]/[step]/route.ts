import { handler, requireSession } from '@/server/http/route';
import { stepOrder, cancelOrder, startReceiptFromOrder } from '@/server/ops/purchasing';

type P = { orgId: string; id: string; step: string };

/** send, confirm — переходы; cancel — отмена с причиной; receive — начать приёмку по заказу. */
export const POST = handler<P>(async (c) => {
  const uid = requireSession(c).user.id, { orgId, id, step } = c.params;
  if (step === 'cancel') return cancelOrder(uid, orgId, id, await c.body());
  if (step === 'receive') return startReceiptFromOrder(uid, orgId, id);
  return stepOrder(uid, orgId, id, step);
});
