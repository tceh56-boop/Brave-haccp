import { handler, requireSession } from '@/server/http/route';
import { listGroups, createGroup } from '@/server/ops/dishgroups';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listGroups(requireSession(c).user.id, c.params.orgId));
export const POST = handler<P>(async (c) => createGroup(requireSession(c).user.id, c.params.orgId, await c.body()));
