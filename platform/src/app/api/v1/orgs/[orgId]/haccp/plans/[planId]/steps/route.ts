import { handler, requireSession } from '@/server/http/route';
import { addStep } from '@/server/ops/haccp';

type P = { orgId: string; planId: string };

export const POST = handler<P>(async (c) => addStep(requireSession(c).user.id, c.params.orgId, c.params.planId, await c.body()));
