import { handler, requireSession } from '@/server/http/route';
import { updatePlan } from '@/server/ops/haccp';

type P = { orgId: string; planId: string };

export const PATCH = handler<P>(async (c) => updatePlan(requireSession(c).user.id, c.params.orgId, c.params.planId, await c.body()));
