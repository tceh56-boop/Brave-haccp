import { handler, requireSession } from '@/server/http/route';
import { confirm, decideGo } from '@/server/ops/readiness';
import { Errors } from '@/server/http/errors';

type P = { orgId: string; op: string };

export const POST = handler<P>(async (c) => {
  const u = requireSession(c).user.id;
  if (c.params.op === 'confirm') return confirm(u, c.params.orgId, await c.body());
  if (c.params.op === 'decide') return decideGo(u, c.params.orgId, await c.body());
  throw Errors.notFound();
});
