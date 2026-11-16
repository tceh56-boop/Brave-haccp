import { handler, requireSession } from '@/server/http/route';
import { Errors } from '@/server/http/errors';
import { approvePlan, decideRisk } from '@/server/ops/floorplan';

type P = { orgId: string; planId: string; op: string };

export const POST = handler<P>(async (c) => {
  const uid = requireSession(c).user.id, { orgId, planId, op } = c.params;
  if (op === 'approve') return approvePlan(uid, orgId, planId, await c.body());
  if (op === 'risk') return decideRisk(uid, orgId, planId, await c.body());
  throw Errors.notFound();
});
