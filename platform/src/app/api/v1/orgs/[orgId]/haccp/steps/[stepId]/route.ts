import { handler, requireSession } from '@/server/http/route';
import { updateStep, removeStep } from '@/server/ops/haccp';

type P = { orgId: string; stepId: string };

export const PATCH = handler<P>(async (c) => updateStep(requireSession(c).user.id, c.params.orgId, c.params.stepId, await c.body()));
export const DELETE = handler<P>(async (c) => removeStep(requireSession(c).user.id, c.params.orgId, c.params.stepId));
