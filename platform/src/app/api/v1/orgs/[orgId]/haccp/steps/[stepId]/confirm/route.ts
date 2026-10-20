import { handler, requireSession } from '@/server/http/route';
import { confirmStep } from '@/server/ops/haccp';

type P = { orgId: string; stepId: string };

export const POST = handler<P>(async (c) => confirmStep(requireSession(c).user.id, c.params.orgId, c.params.stepId, await c.body()));
