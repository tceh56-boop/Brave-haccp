import { handler, requireSession } from '@/server/http/route';
import { listRules, createRule } from '@/server/ops/control';

type P = { orgId: string; objectId: string };

export const GET = handler<P>(async (c) => listRules(requireSession(c).user.id, c.params.orgId, c.params.objectId));
export const POST = handler<P>(async (c) => createRule(requireSession(c).user.id, c.params.orgId, { ...((await c.body()) as object), controlObjectId: c.params.objectId }));
