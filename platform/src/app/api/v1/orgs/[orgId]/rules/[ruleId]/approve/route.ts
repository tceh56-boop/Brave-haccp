import { handler, requireSession } from '@/server/http/route';
import { approveRule } from '@/server/ops/control';

type P = { orgId: string; ruleId: string };

export const POST = handler<P>(async (c) => approveRule(requireSession(c).user.id, c.params.orgId, c.params.ruleId));
