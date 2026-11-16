import { handler, requireSession } from '@/server/http/route';
import { approveGroupTechSpec } from '@/server/ops/groupTechSpec';

type P = { orgId: string; id: string };

export const POST = handler<P>(async (c) => approveGroupTechSpec(requireSession(c).user.id, c.params.orgId, c.params.id, await c.body()));
