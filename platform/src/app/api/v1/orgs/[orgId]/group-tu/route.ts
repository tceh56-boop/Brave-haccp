import { handler, requireSession } from '@/server/http/route';
import { listGroupTechSpecs, createGroupTechSpec } from '@/server/ops/groupTechSpec';

type P = { orgId: string };

export const GET = handler<P>(async (c) => listGroupTechSpecs(requireSession(c).user.id, c.params.orgId));
export const POST = handler<P>(async (c) => createGroupTechSpec(requireSession(c).user.id, c.params.orgId, await c.body()));
