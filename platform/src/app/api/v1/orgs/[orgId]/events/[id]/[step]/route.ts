import { handler, requireSession } from '@/server/http/route';
import { Errors } from '@/server/http/errors';
import { confirmEvent, cancelEvent, completeEvent } from '@/server/ops/planmenu';

type P = { orgId: string; id: string; step: string };

/** confirm — подтвердить; cancel — отменить с причиной; complete — «Проведено» со списанием по ТТК. */
export const POST = handler<P>(async (c) => {
  const uid = requireSession(c).user.id, { orgId, id, step } = c.params;
  if (step === 'confirm') return confirmEvent(uid, orgId, id);
  if (step === 'cancel') return cancelEvent(uid, orgId, id, await c.body());
  if (step === 'complete') return completeEvent(uid, orgId, id, await c.body());
  throw Errors.notFound();
});
