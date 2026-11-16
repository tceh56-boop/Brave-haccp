import { handler, requireSession } from '@/server/http/route';
import { Errors } from '@/server/http/errors';
import { recordDone, archivePlan } from '@/server/ops/sanitation';

type P = { orgId: string; id: string; step: string };

/** done — отметить выполнение; archive — исключить из плана с причиной. */
export const POST = handler<P>(async (c) => {
  const uid = requireSession(c).user.id, { orgId, id, step } = c.params;
  if (step === 'done') return recordDone(uid, orgId, id, await c.body());
  if (step === 'archive') return archivePlan(uid, orgId, id, await c.body());
  throw Errors.notFound();
});
