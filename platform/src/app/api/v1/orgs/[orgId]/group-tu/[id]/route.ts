import { handler, requireSession } from '@/server/http/route';
import { getGroupTechSpec, updateGroupTechSpec } from '@/server/ops/groupTechSpec';

type P = { orgId: string; id: string };

export const GET = handler<P>(async (c) => getGroupTechSpec(requireSession(c).user.id, c.params.orgId, c.params.id));
export const PATCH = handler<P>(async (c) => updateGroupTechSpec(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
