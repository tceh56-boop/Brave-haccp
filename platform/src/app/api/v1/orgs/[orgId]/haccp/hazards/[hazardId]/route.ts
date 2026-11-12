import { handler, requireSession } from '@/server/http/route';
import { updateHazard, removeHazard } from '@/server/ops/haccp';

type P = { orgId: string; hazardId: string };

export const PATCH = handler<P>(async (c) => updateHazard(requireSession(c).user.id, c.params.orgId, c.params.hazardId, await c.body()));
export const DELETE = handler<P>(async (c) => removeHazard(requireSession(c).user.id, c.params.orgId, c.params.hazardId));
