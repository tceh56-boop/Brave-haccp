import { handler, requireSession } from '@/server/http/route';
import { approveReleaseCheck } from '@/server/ops/production';

type P = { orgId: string; checkId: string };

export const POST = handler<P>(async (c) => approveReleaseCheck(requireSession(c).user.id, c.params.orgId, c.params.checkId));
