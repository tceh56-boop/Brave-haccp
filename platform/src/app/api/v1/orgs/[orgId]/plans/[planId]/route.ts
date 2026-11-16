import { handler, requireSession } from '@/server/http/route';
import { getPlan, savePlan } from '@/server/ops/floorplan';

type P = { orgId: string; planId: string };

export const GET = handler<P>(async (c) => getPlan(requireSession(c).user.id, c.params.orgId, c.params.planId));
export const PUT = handler<P>(async (c) => savePlan(requireSession(c).user.id, c.params.orgId, c.params.planId, await c.body()));
