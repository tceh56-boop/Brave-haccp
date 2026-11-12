import { handler, requireSession } from '@/server/http/route';
import { openShift, closeShift } from '@/server/ops/pos';
import { Errors } from '@/server/http/errors';

type P = { orgId: string; op: string };

export const POST = handler<P>(async (c) => {
  const u = requireSession(c).user.id;
  if (c.params.op === 'open') return openShift(u, c.params.orgId, await c.body());
  if (c.params.op === 'close') return closeShift(u, c.params.orgId, await c.body());
  throw Errors.notFound();
});
