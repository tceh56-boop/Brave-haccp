import { handler, requireSession } from '@/server/http/route';
import { closeCount } from '@/server/ops/stock';

type P = { orgId: string; countId: string };

export const POST = handler<P>(async (c) => closeCount(requireSession(c).user.id, c.params.orgId, c.params.countId));
