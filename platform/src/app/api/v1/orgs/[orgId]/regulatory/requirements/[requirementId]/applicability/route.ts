import { handler, requireSession } from '@/server/http/route';
import { decideApplicability } from '@/server/ops/regulatory';

type P = { orgId: string; requirementId: string };

export const POST = handler<P>(async (c) => decideApplicability(requireSession(c).user.id, c.params.orgId, c.params.requirementId, await c.body()));
