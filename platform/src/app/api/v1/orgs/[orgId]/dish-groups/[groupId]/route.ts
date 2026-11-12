import { handler, requireSession } from '@/server/http/route';
import { getGroup, updateGroup, deleteGroup } from '@/server/ops/dishgroups';

type P = { orgId: string; groupId: string };

export const GET = handler<P>(async (c) => getGroup(requireSession(c).user.id, c.params.orgId, c.params.groupId));
export const PATCH = handler<P>(async (c) => updateGroup(requireSession(c).user.id, c.params.orgId, c.params.groupId, await c.body()));
export const DELETE = handler<P>(async (c) => deleteGroup(requireSession(c).user.id, c.params.orgId, c.params.groupId));
