import { handler, requireSession } from '@/server/http/route';
import { updateLine, removeLine } from '@/server/ops/recipes';

type P = { orgId: string; lineId: string };

export const PATCH = handler<P>(async (c) => updateLine(requireSession(c).user.id, c.params.orgId, c.params.lineId, await c.body()));
export const DELETE = handler<P>(async (c) => removeLine(requireSession(c).user.id, c.params.orgId, c.params.lineId));
